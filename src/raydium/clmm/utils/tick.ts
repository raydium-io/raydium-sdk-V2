import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

import { ApiV3PoolInfoConcentratedItem } from "../../../api/type";
import { ClmmPoolInfo, TickArrayBitmapExtensionType } from "../type";
import { MAX_TICK, MIN_TICK } from "./constants";
import { SqrtPriceMath, TickMath } from "./math";
import { getPdaTickArrayAddress } from "./pda";
import { TickQuery } from "./tickQuery";

export const TICK_ARRAY_SIZE = 60;
export const TICK_ARRAY_BITMAP_SIZE = 512;

export interface ReturnTypeGetTickPrice {
  tick: number;
  price: Decimal;
  tickSqrtPriceX64: BN;
}

export interface ReturnTypeGetPriceAndTick {
  tick: number;
  price: Decimal;
}

export type Tick = {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX64A: BN;
  feeGrowthOutsideX64B: BN;
  rewardGrowthsOutsideX64: BN[];
};

export type TickArray = {
  address: PublicKey;
  poolId: PublicKey;
  startTickIndex: number;
  ticks: Tick[];
  initializedTickCount: number;
};

export type TickState = {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX64A: BN;
  feeGrowthOutsideX64B: BN;
  tickCumulativeOutside: BN;
  secondsPerLiquidityOutsideX64: BN;
  secondsOutside: number;
  rewardGrowthsOutside: BN[];
};

export type TickArrayState = {
  ammPool: PublicKey;
  startTickIndex: number;
  ticks: TickState[];
  initializedTickCount: number;
};

export class TickUtils {
  public static getTickArrayAddressByTick(
    programId: PublicKey,
    poolId: PublicKey,
    tickIndex: number,
    tickSpacing: number,
  ): PublicKey {
    const startIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, startIndex);
    return tickArrayAddress;
  }

  public static getTickOffsetInArray(tickIndex: number, tickSpacing: number): number {
    if (tickIndex % tickSpacing != 0) {
      throw new Error("tickIndex % tickSpacing not equal 0");
    }
    const startTickIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const offsetInArray = Math.floor((tickIndex - startTickIndex) / tickSpacing);
    if (offsetInArray < 0 || offsetInArray >= TICK_ARRAY_SIZE) {
      throw new Error("tick offset in array overflow");
    }
    return offsetInArray;
  }

  public static getTickArrayBitIndex(tickIndex: number, tickSpacing: number): number {
    const ticksInArray = TickQuery.tickCount(tickSpacing);

    let startIndex: number = tickIndex / ticksInArray;
    if (tickIndex < 0 && tickIndex % ticksInArray != 0) {
      startIndex = Math.ceil(startIndex) - 1;
    } else {
      startIndex = Math.floor(startIndex);
    }
    return startIndex;
  }

  public static getTickArrayStartIndexByTick(tickIndex: number, tickSpacing: number): number {
    return this.getTickArrayBitIndex(tickIndex, tickSpacing) * TickQuery.tickCount(tickSpacing);
  }

  public static getTickArrayOffsetInBitmapByTick(tick: number, tickSpacing: number): number {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    return Math.abs(compressed);
  }

  public static checkTickArrayIsInitialized(
    bitmap: BN,
    tick: number,
    tickSpacing: number,
  ): {
    isInitialized: boolean;
    startIndex: number;
  } {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    const bitPos = Math.abs(compressed);
    return {
      isInitialized: bitmap.testn(bitPos),
      startIndex: (bitPos - 512) * multiplier,
    };
  }

  public static getNextTickArrayStartIndex(
    lastTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): number {
    return zeroForOne
      ? lastTickArrayStartIndex - tickSpacing * TICK_ARRAY_SIZE
      : lastTickArrayStartIndex + tickSpacing * TICK_ARRAY_SIZE;
  }

  public static mergeTickArrayBitmap(bns: BN[]): BN {
    let b = new BN(0);
    for (let i = 0; i < bns.length; i++) {
      b = b.add(bns[i].shln(64 * i));
    }
    return b;
  }

  public static getInitializedTickArrayInRange(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    tickSpacing: number,
    tickArrayStartIndex: number,
    expectedCount: number,
  ): number[] {
    const tickArrayOffset = Math.floor(tickArrayStartIndex / (tickSpacing * TICK_ARRAY_SIZE));
    return [
      // find right of currenct offset
      ...TickUtils.searchLowBitFromStart(
        tickArrayBitmap,
        exTickArrayBitmap,
        tickArrayOffset - 1,
        expectedCount,
        tickSpacing,
      ),

      // find left of current offset
      ...TickUtils.searchHightBitFromStart(
        tickArrayBitmap,
        exTickArrayBitmap,
        tickArrayOffset,
        expectedCount,
        tickSpacing,
      ),
    ];
  }

  public static getAllInitializedTickArrayStartIndex(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    tickSpacing: number,
  ): number[] {
    // find from offset 0 to 1024
    return TickUtils.searchHightBitFromStart(
      tickArrayBitmap,
      exTickArrayBitmap,
      -7680,
      TICK_ARRAY_BITMAP_SIZE,
      tickSpacing,
    );
  }

  public static getAllInitializedTickArrayInfo(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    tickSpacing: number,
  ): {
    tickArrayStartIndex: number;
    tickArrayAddress: PublicKey;
  }[] {
    const result: {
      tickArrayStartIndex: number;
      tickArrayAddress: PublicKey;
    }[] = [];
    const allInitializedTickArrayIndex: number[] = TickUtils.getAllInitializedTickArrayStartIndex(
      tickArrayBitmap,
      exTickArrayBitmap,
      tickSpacing,
    );
    for (const startIndex of allInitializedTickArrayIndex) {
      const { publicKey: address } = getPdaTickArrayAddress(programId, poolId, startIndex);
      result.push({
        tickArrayStartIndex: startIndex,
        tickArrayAddress: address,
      });
    }
    return result;
  }

  public static getAllInitializedTickInTickArray(tickArray: TickArrayState): TickState[] {
    return tickArray.ticks.filter((i) => i.liquidityGross.gtn(0));
  }

  public static searchLowBitFromStart(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    currentTickArrayBitStartIndex: number,
    expectedCount: number,
    tickSpacing: number,
  ): number[] {
    const tickArrayBitmaps = [
      ...[...exTickArrayBitmap.negativeTickArrayBitmap].reverse(),
      tickArrayBitmap.slice(0, 8),
      tickArrayBitmap.slice(8, 16),
      ...exTickArrayBitmap.positiveTickArrayBitmap,
    ].map((i) => TickUtils.mergeTickArrayBitmap(i));
    const result: number[] = [];
    while (currentTickArrayBitStartIndex >= -7680) {
      const arrayIndex = Math.floor((currentTickArrayBitStartIndex + 7680) / 512);
      const searchIndex = (currentTickArrayBitStartIndex + 7680) % 512;

      if (tickArrayBitmaps[arrayIndex].testn(searchIndex)) result.push(currentTickArrayBitStartIndex);

      currentTickArrayBitStartIndex--;
      if (result.length === expectedCount) break;
    }

    const tickCount = TickQuery.tickCount(tickSpacing);
    return result.map((i) => i * tickCount);
  }

  public static searchHightBitFromStart(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    currentTickArrayBitStartIndex: number,
    expectedCount: number,
    tickSpacing: number,
  ): number[] {
    const tickArrayBitmaps = [
      ...[...exTickArrayBitmap.negativeTickArrayBitmap].reverse(),
      tickArrayBitmap.slice(0, 8),
      tickArrayBitmap.slice(8, 16),
      ...exTickArrayBitmap.positiveTickArrayBitmap,
    ].map((i) => TickUtils.mergeTickArrayBitmap(i));
    const result: number[] = [];
    while (currentTickArrayBitStartIndex < 7680) {
      const arrayIndex = Math.floor((currentTickArrayBitStartIndex + 7680) / 512);
      const searchIndex = (currentTickArrayBitStartIndex + 7680) % 512;

      if (tickArrayBitmaps[arrayIndex].testn(searchIndex)) result.push(currentTickArrayBitStartIndex);

      currentTickArrayBitStartIndex++;
      if (result.length === expectedCount) break;
    }

    const tickCount = TickQuery.tickCount(tickSpacing);
    return result.map((i) => i * tickCount);
  }

  public static checkIsOutOfBoundary(tick: number): boolean {
    return tick < MIN_TICK || tick > MAX_TICK;
  }

  public static nextInitTick(
    tickArrayCurrent: TickArray,
    currentTickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    t: boolean,
  ): Tick | null {
    const currentTickArrayStartIndex = TickQuery.getArrayStartIndex(currentTickIndex, tickSpacing);
    if (currentTickArrayStartIndex != tickArrayCurrent.startTickIndex) {
      return null;
    }
    let offsetInArray = Math.floor((currentTickIndex - tickArrayCurrent.startTickIndex) / tickSpacing);

    if (zeroForOne) {
      while (offsetInArray >= 0) {
        if (tickArrayCurrent.ticks[offsetInArray].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[offsetInArray];
        }
        offsetInArray = offsetInArray - 1;
      }
    } else {
      if (!t) offsetInArray = offsetInArray + 1;
      while (offsetInArray < TICK_ARRAY_SIZE) {
        if (tickArrayCurrent.ticks[offsetInArray].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[offsetInArray];
        }
        offsetInArray = offsetInArray + 1;
      }
    }
    return null;
  }

  public static firstInitializedTick(tickArrayCurrent: TickArray, zeroForOne: boolean): Tick {
    if (zeroForOne) {
      let i = TICK_ARRAY_SIZE - 1;
      while (i >= 0) {
        if (tickArrayCurrent.ticks[i].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[i];
        }
        i = i - 1;
      }
    } else {
      let i = 0;
      while (i < TICK_ARRAY_SIZE) {
        if (tickArrayCurrent.ticks[i].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[i];
        }
        i = i + 1;
      }
    }

    throw Error(`firstInitializedTick check error: ${tickArrayCurrent} - ${zeroForOne}`);
  }

  public static _getTickPriceLegacy({
    poolInfo,
    tick,
    baseIn,
  }: {
    poolInfo: ClmmPoolInfo;
    tick: number;
    baseIn: boolean;
  }): ReturnTypeGetTickPrice {
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    return baseIn
      ? { tick, price: tickPrice, tickSqrtPriceX64 }
      : { tick, price: new Decimal(1).div(tickPrice), tickSqrtPriceX64 };
  }

  public static _getPriceAndTickLegacy({
    poolInfo,
    price,
    baseIn,
  }: {
    poolInfo: ClmmPoolInfo;
    price: Decimal;
    baseIn: boolean;
  }): ReturnTypeGetPriceAndTick {
    const _price = baseIn ? price : new Decimal(1).div(price);

    const tick = TickMath.getTickWithPriceAndTickspacing(
      _price,
      poolInfo.ammConfig.tickSpacing,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  }

  public static getTickPrice({
    poolInfo,
    tick,
    baseIn,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    tick: number;
    baseIn: boolean;
  }): ReturnTypeGetTickPrice {
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    return baseIn
      ? { tick, price: tickPrice, tickSqrtPriceX64 }
      : { tick, price: new Decimal(1).div(tickPrice), tickSqrtPriceX64 };
  }

  public static getPriceAndTick({
    poolInfo,
    price,
    baseIn,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    price: Decimal;
    baseIn: boolean;
  }): ReturnTypeGetPriceAndTick {
    const _price = baseIn ? price : new Decimal(1).div(price);

    const tick = TickMath.getTickWithPriceAndTickspacing(
      _price,
      poolInfo.config.tickSpacing,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  }
}
