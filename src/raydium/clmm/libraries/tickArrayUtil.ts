import { FEE_RATE_DENOMINATOR_VALUE, getMultipleAccountsInfo } from "@/common";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PoolInfoLayout, TickArrayBitmapExtensionLayout, TickArrayLayout, TickLayout } from "../layout";
import { mostSignificantBit, mulDivCeil, mulDivFloor } from "./bigNum";
import {
  BIT_PRECISION,
  BN_ONE,
  BN_ZERO,
  EXTENSION_TICKARRAY_BITMAP_SIZE,
  LOG_B_2_X32,
  LOG_B_P_ERR_MARGIN_LOWER_X64,
  LOG_B_P_ERR_MARGIN_UPPER_X64,
  MAX_SQRT_PRICE_X64,
  MAX_TICK,
  MIN_SQRT_PRICE_X64,
  MIN_TICK,
  Q64,
  TICK_ARRAY_BITMAP_SIZE,
  TICK_ARRAY_SIZE,
  TICK_TO_SQRT_PRICE_FACTORS,
} from "./constants";
import { getPdaExBitmapAccount, getPdaTickArrayAddress } from "./pda";

export interface LimitOrderMatchResult {
  amountIn: BN;
  amountOut: BN;
  ammFeeAmount: BN;
}

export class TickArrayBitmapUtil {
  private static scanLinearBitmap({
    bitmap,
    tickSpacing,
    offset,
    checkInfo,
  }: {
    bitmap: Buffer;
    tickSpacing: number;
    offset: number;
    checkInfo?: { tick: number; valueType: "lte" | "gte" };
  }): number[] {
    const result: number[] = [];
    const totalBits = bitmap.length * 8;

    let startBit = 0;
    let endBit = totalBits - 1;

    if (checkInfo) {
      const threshold = checkInfo.tick / (tickSpacing * TICK_ARRAY_SIZE) - offset;
      if (checkInfo.valueType === "gte") {
        startBit = Math.max(0, Math.ceil(threshold));
      } else {
        endBit = Math.min(totalBits - 1, Math.floor(threshold));
      }
    }

    if (startBit > endBit) return result;

    const startByte = Math.floor(startBit / 8);
    const endByte = Math.floor(endBit / 8);

    for (let i = startByte; i <= endByte; i++) {
      if (!bitmap[i]) continue;

      const jStart = i === startByte ? startBit % 8 : 0;
      const jEnd = i === endByte ? endBit % 8 : 7;
      for (let j = jStart; j <= jEnd; j++) {
        if (bitmap[i] & (1 << j)) {
          result.push((i * 8 + j + offset) * tickSpacing * TICK_ARRAY_SIZE);
        }
      }
    }
    return result;
  }

  private static findPoolBitmap({
    bitmap,
    tickSpacing,
    checkInfo,
  }: {
    bitmap: Buffer;
    tickSpacing: number;
    checkInfo?: { tick: number; valueType: "lte" | "gte" };
  }): number[] {
    if (checkInfo) {
      const _i = Math.floor(checkInfo.tick / TICK_ARRAY_SIZE / tickSpacing);
      if (checkInfo.valueType === "lte" && _i < -512) return [];
      if (checkInfo.valueType === "gte" && _i > 512) return [];
    }
    return this.scanLinearBitmap({ bitmap, tickSpacing, offset: -TICK_ARRAY_BITMAP_SIZE, checkInfo });
  }

  private static findPositiveTickArrayBitmap({
    bitmap,
    tickSpacing,
    checkInfo,
  }: {
    bitmap: Buffer;
    tickSpacing: number;
    checkInfo?: { tick: number; valueType: "lte" | "gte" };
  }): number[] {
    if (checkInfo) {
      const _i = Math.floor(checkInfo.tick / TICK_ARRAY_SIZE / tickSpacing);
      if (checkInfo.valueType === "lte" && _i < 512) return [];
    }
    return this.scanLinearBitmap({ bitmap, tickSpacing, offset: TICK_ARRAY_BITMAP_SIZE, checkInfo });
  }

  private static findNegativeTickArrayBitmap({
    bitmap,
    tickSpacing,
    count,
    checkInfo,
  }: {
    bitmap: Buffer;
    tickSpacing: number;
    count?: number;
    checkInfo?: { tick: number; valueType: "lte" | "gte" };
  }): number[] {
    const result: number[] = [];

    if (checkInfo) {
      const _i = Math.floor(checkInfo.tick / TICK_ARRAY_SIZE / tickSpacing);
      if (checkInfo.valueType === "gte" && _i >= -512) return result;
    }

    const maxFlatIndex =
      checkInfo?.valueType === "lte" ? Math.floor(checkInfo.tick / (TICK_ARRAY_SIZE * tickSpacing)) + 7680 : Infinity;
    const minFlatIndex =
      checkInfo?.valueType === "gte" ? Math.ceil(checkInfo.tick / (TICK_ARRAY_SIZE * tickSpacing)) + 7680 : 0;

    outer: for (let arrayIndex = 0; arrayIndex < EXTENSION_TICKARRAY_BITMAP_SIZE; arrayIndex++) {
      const reversedIndex = EXTENSION_TICKARRAY_BITMAP_SIZE - 1 - arrayIndex;
      for (let searchIndex = 0; searchIndex < 512; searchIndex++) {
        const flatIndex = arrayIndex * 512 + searchIndex;

        if (flatIndex > maxFlatIndex) break outer;
        if (flatIndex < minFlatIndex) continue;

        const byteOffset = reversedIndex * 64 + Math.floor(searchIndex / 8);
        if (!bitmap[byteOffset]) {
          searchIndex = Math.floor(searchIndex / 8) * 8 + 7;
          continue;
        }
        if (bitmap[byteOffset] & (1 << searchIndex % 8)) {
          const tick = (arrayIndex * 512 + searchIndex - 7680) * TICK_ARRAY_SIZE * tickSpacing;
          result.push(tick);

          if (count !== undefined && result.length >= count) break outer;
        }
      }
    }
    return result;
  }

  static findTickArrayStartIndex({
    tickSpacing,
    poolBitmap,
    tickArrayBitmap,
    findInfo,
  }: {
    tickSpacing: number;
    poolBitmap: ReturnType<typeof PoolInfoLayout.decode>["tickArrayBitmap"];
    tickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>;
    findInfo: { type: "zeroForOne" | "oneForZero"; count?: number; tickArrayCurrent: number } | { type: "all" };
  }): number[] {
    if (findInfo.type === "all") {
      return [
        ...this.findNegativeTickArrayBitmap({ tickSpacing, bitmap: tickArrayBitmap.negativeTickArrayBitmap }),
        ...this.findPoolBitmap({ tickSpacing, bitmap: poolBitmap }),
        ...this.findPositiveTickArrayBitmap({ tickSpacing, bitmap: tickArrayBitmap.positiveTickArrayBitmap }),
      ];
    }

    const tickStart = TickArrayUtil.getTickArrayStartIndex(findInfo.tickArrayCurrent, tickSpacing);
    const { count } = findInfo;

    if (findInfo.type === "oneForZero") {
      const checkInfo = { tick: tickStart, valueType: "gte" } as const;
      const finders = [
        () =>
          this.findNegativeTickArrayBitmap({ tickSpacing, bitmap: tickArrayBitmap.negativeTickArrayBitmap, checkInfo }),
        () => this.findPoolBitmap({ tickSpacing, bitmap: poolBitmap, checkInfo }),
        () =>
          this.findPositiveTickArrayBitmap({ tickSpacing, bitmap: tickArrayBitmap.positiveTickArrayBitmap, checkInfo }),
      ];
      return this.collectUntil(finders, count);
    }

    if (findInfo.type === "zeroForOne") {
      const checkInfo = { tick: tickStart, valueType: "lte" } as const;
      const finders = [
        () =>
          this.findPositiveTickArrayBitmap({
            tickSpacing,
            bitmap: tickArrayBitmap.positiveTickArrayBitmap,
            checkInfo,
          }).sort((a, b) => b - a),
        () => this.findPoolBitmap({ tickSpacing, bitmap: poolBitmap, checkInfo }).sort((a, b) => b - a),
        () =>
          this.findNegativeTickArrayBitmap({
            tickSpacing,
            bitmap: tickArrayBitmap.negativeTickArrayBitmap,
            checkInfo,
          }).sort((a, b) => b - a),
      ];
      return this.collectUntil(finders, count);
    }

    throw new Error("find info type check error");
  }

  private static collectUntil(finders: Array<() => number[]>, count: number | undefined): number[] {
    const collected: number[] = [];
    for (const finder of finders) {
      if (count !== undefined && collected.length >= count) break;
      collected.push(...finder());
    }
    return collected.slice(0, count);
  }

  static findTickArrayAddress(params: {
    programId: PublicKey;
    poolId: PublicKey;
    tickSpacing: number;
    poolBitmap: ReturnType<typeof PoolInfoLayout.decode>["tickArrayBitmap"];
    tickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>;
    findInfo: { type: "zeroForOne" | "oneForZero"; count?: number; tickArrayCurrent: number } | { type: "all" };
  }) {
    return this.findTickArrayStartIndex(params).map(
      (i) => getPdaTickArrayAddress(params.programId, params.poolId, i).publicKey,
    );
  }

  static maxTickInTickarrayBitmap(tickSpacing: number): number {
    return tickSpacing * TICK_ARRAY_SIZE * TICK_ARRAY_BITMAP_SIZE;
  }
}

export class TickArrayUtil {
  static firstinitializedTick({
    data,
    zeroForOne,
  }: {
    data: ReturnType<typeof TickArrayLayout.decode>;
    zeroForOne: boolean;
  }) {
    if (zeroForOne) {
      for (let i = data.ticks.length - 1; i >= 0; i--) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) return data.ticks[i];
      }
    } else {
      for (let i = 0; i < data.ticks.length; i++) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) return data.ticks[i];
      }
    }
  }

  static nextInitalizedTick({
    data,
    currentTickIndex,
    tickSpacing,
    zeroForOne,
  }: {
    data: ReturnType<typeof TickArrayLayout.decode>;
    currentTickIndex: number;
    tickSpacing: number;
    zeroForOne: boolean;
  }) {
    const currentTickArrayStartIndex = this.getTickArrayStartIndex(currentTickIndex, tickSpacing);
    if (currentTickArrayStartIndex !== data.startTickIndex) return undefined;
    const offsetInArray = Math.floor((currentTickIndex - data.startTickIndex) / tickSpacing);

    if (zeroForOne) {
      for (let i = offsetInArray; i >= 0; i--) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) {
          return data.ticks[i];
        }
      }
    } else {
      for (let i = offsetInArray + 1; i < TICK_ARRAY_SIZE; i++) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) {
          return data.ticks[i];
        }
      }
    }
    return undefined;
  }

  static getTickArrayStartIndex(tickIndex: number, tickSpacing: number) {
    const ticksInArray = this.tickCount(tickSpacing);
    const start = Math.floor(tickIndex / ticksInArray);

    return start * ticksInArray;
  }

  static getTickOffsetInArray(tick: number, tickSpacing: number): number {
    if (tick % tickSpacing != 0) {
      throw new Error("tickIndex % tickSpacing not equal 0");
    }
    const startIndex = this.getTickArrayStartIndex(tick, tickSpacing);
    return Math.floor((tick - startIndex) / tickSpacing);
  }

  static tickCount(tickSpacing: number) {
    return TICK_ARRAY_SIZE * tickSpacing;
  }

  static getMinTick(tickSpacing: number): number {
    return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  }

  static getMaxTick(tickSpacing: number): number {
    return Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  }
}

export class TickUtil {
  static isInitialized({ data }: { data: ReturnType<typeof TickLayout.decode> }): boolean {
    return this.hasLiquidity({ data }) || this.hasLimitOrders({ data });
  }

  static hasLimitOrders({ data }: { data: ReturnType<typeof TickLayout.decode> }): boolean {
    return !data.ordersAmount.isZero() || !data.partFilledOrdersRemaining.isZero();
  }

  static hasLiquidity({ data }: { data: ReturnType<typeof TickLayout.decode> }): boolean {
    return !data.liquidityGross.isZero();
  }

  static isValidTick(tick: number): boolean {
    return tick >= MIN_TICK && tick <= MAX_TICK;
  }
  static checkTick(tick: number): void {
    if (!this.isValidTick(tick)) {
      throw new Error(`Tick ${tick} is out of range [${MIN_TICK}, ${MAX_TICK}]`);
    }
  }
  static getSqrtPriceAtTick(tick: number): BN {
    this.checkTick(tick);

    const absTick = Math.abs(tick);

    let ratio = Q64.clone();

    for (const { bit, factor } of TICK_TO_SQRT_PRICE_FACTORS) {
      if ((absTick & (1 << bit)) !== 0) {
        ratio = mulDivFloor(ratio, factor, Q64);
      }
    }

    if (tick > 0) {
      ratio = mulDivFloor(Q64, Q64, ratio);
    }

    return ratio;
  }

  static getLimitOrderOutput({ amountIn, tick, zeroForOne }: { amountIn: BN; tick: number; zeroForOne: boolean }): BN {
    if (zeroForOne) {
      const priceX64 = TickUtil.getPriceAtTick(tick, false);
      return mulDivFloor(amountIn, priceX64, Q64);
    } else {
      const priceX64 = TickUtil.getPriceAtTick(tick, true);
      return mulDivFloor(amountIn, Q64, priceX64);
    }
  }
  static getLimitOrderInput({ amountOut, tick, zeroForOne }: { amountOut: BN; tick: number; zeroForOne: boolean }): BN {
    if (zeroForOne) {
      const priceX64 = TickUtil.getPriceAtTick(tick, true);
      return mulDivCeil(amountOut, priceX64, Q64);
    } else {
      const priceX64 = TickUtil.getPriceAtTick(tick, false);
      return mulDivCeil(amountOut, Q64, priceX64);
    }
  }

  static limitOrderUnfilledAmount({ tick }: { tick: ReturnType<typeof TickLayout.decode> }): BN {
    return tick.ordersAmount.add(tick.partFilledOrdersRemaining);
  }

  static matchLimitOrder({
    tick,
    swapAmount,
    swapDirectionZeroForOne,
    isBaseInput,
    feeRate,
    isFeeOnInput,
  }: {
    tick: ReturnType<typeof TickLayout.decode>;
    swapAmount: BN;
    swapDirectionZeroForOne: boolean;
    isBaseInput: boolean;
    feeRate: number;
    isFeeOnInput: boolean;
  }): LimitOrderMatchResult {
    const result: LimitOrderMatchResult = {
      amountIn: BN_ZERO,
      amountOut: BN_ZERO,
      ammFeeAmount: BN_ZERO,
    };

    const totalUnfilledAmount = this.limitOrderUnfilledAmount({ tick });
    if (swapAmount.isZero() || totalUnfilledAmount.isZero()) {
      return result;
    }

    if (isBaseInput) {
      if (isFeeOnInput) {
        result.ammFeeAmount = mulDivCeil(swapAmount, new BN(feeRate), FEE_RATE_DENOMINATOR_VALUE);
        result.amountIn = swapAmount.sub(result.ammFeeAmount);
      } else {
        result.amountIn = swapAmount;
      }

      result.amountOut = this.getLimitOrderOutput({
        amountIn: result.amountIn,
        tick: tick.tick,
        zeroForOne: swapDirectionZeroForOne,
      });

      if (result.amountOut.gt(totalUnfilledAmount)) {
        result.amountOut = totalUnfilledAmount;
        result.amountIn = this.getLimitOrderInput({
          amountOut: totalUnfilledAmount,
          tick: tick.tick,
          zeroForOne: !swapDirectionZeroForOne,
        });

        if (isFeeOnInput) {
          result.ammFeeAmount = mulDivCeil(
            result.amountIn,
            new BN(feeRate),
            FEE_RATE_DENOMINATOR_VALUE.sub(new BN(feeRate)),
          );
        }
      }
    } else {
      const netOutput = BN.min(swapAmount, totalUnfilledAmount);

      if (isFeeOnInput) {
        result.amountOut = netOutput;
      } else {
        result.amountOut = BN.min(
          mulDivCeil(netOutput, FEE_RATE_DENOMINATOR_VALUE, FEE_RATE_DENOMINATOR_VALUE.sub(new BN(feeRate))),
          totalUnfilledAmount,
        );
      }

      result.amountIn = this.getLimitOrderInput({
        amountOut: result.amountOut,
        tick: tick.tick,
        zeroForOne: !swapDirectionZeroForOne,
      });

      if (isFeeOnInput) {
        result.ammFeeAmount = mulDivCeil(
          result.amountIn,
          new BN(feeRate),
          FEE_RATE_DENOMINATOR_VALUE.sub(new BN(feeRate)),
        );
      }
    }

    if (result.amountOut.lte(BN_ZERO)) throw Error("result.amountOut.lte(BN_ZERO)");
    if (result.amountIn.lte(BN_ZERO)) throw Error("result.amountIn.lte(BN_ZERO)");

    let consumeFromPartRemaining = BN_ZERO;
    if (tick.partFilledOrdersRemaining.gt(BN_ZERO)) {
      if (tick.partFilledOrdersTotal.lte(BN_ZERO)) throw Error("tick.partFilledOrdersTotal.lte(BN_ZERO)");
      consumeFromPartRemaining = BN.min(tick.partFilledOrdersRemaining, result.amountOut);
      tick.partFilledOrdersRemaining = tick.partFilledOrdersRemaining.sub(consumeFromPartRemaining);
    }
    const amountOutContinueToConsume = result.amountOut.sub(consumeFromPartRemaining);

    if (amountOutContinueToConsume.gt(BN_ZERO)) {
      if (!tick.partFilledOrdersRemaining.isZero()) throw Error("!tick.partFilledOrdersRemaining.isZero()");
      if (tick.ordersAmount.lt(amountOutContinueToConsume)) throw Error("InvalidLimitOrderAmount");

      tick.orderPhase = tick.orderPhase.add(BN_ONE);
      tick.partFilledOrdersTotal = tick.ordersAmount;
      tick.partFilledOrdersRemaining = tick.partFilledOrdersRemaining.add(
        tick.ordersAmount.sub(amountOutContinueToConsume),
      );
      tick.ordersAmount = BN_ZERO;
    }

    if (!isFeeOnInput) {
      result.ammFeeAmount = mulDivCeil(result.amountOut, new BN(feeRate), FEE_RATE_DENOMINATOR_VALUE);
      result.amountOut = result.amountOut.sub(result.ammFeeAmount);
    }

    return result;
  }

  private static getPriceAtTick(tick: number, roundUp: boolean): BN {
    const sqrtPriceX64 = this.getSqrtPriceAtTick(tick);

    if (roundUp) {
      return sqrtPriceX64.mul(sqrtPriceX64).add(Q64.subn(1)).div(Q64);
    } else {
      return sqrtPriceX64.mul(sqrtPriceX64).div(Q64);
    }
  }

  static getTickAtSqrtPrice(sqrtPriceX64: BN): number {
    if (!(sqrtPriceX64.gte(MIN_SQRT_PRICE_X64) && sqrtPriceX64.lte(MAX_SQRT_PRICE_X64))) throw Error("SqrtPriceX64");

    const msb = mostSignificantBit(sqrtPriceX64);

    const msbMinus64 = msb - 64;
    let log2pIntegerX32: BN;
    if (msbMinus64 >= 0) {
      log2pIntegerX32 = new BN(msbMinus64).shln(32);
    } else {
      log2pIntegerX32 = new BN(-msbMinus64).shln(32).neg();
    }

    let r: BN;
    if (msb >= 64) {
      r = sqrtPriceX64.shrn(msb - 63);
    } else {
      r = sqrtPriceX64.shln(63 - msb);
    }

    let log2pFractionX64 = new BN(0);
    let bit = new BN(1).shln(63);

    for (let precision = 0; precision < BIT_PRECISION && !bit.isZero(); precision++) {
      r = r.mul(r);

      const isRMoreThanTwo = r.shrn(127).toNumber();

      r = r.shrn(63 + isRMoreThanTwo);

      if (isRMoreThanTwo) {
        log2pFractionX64 = log2pFractionX64.add(bit);
      }

      bit = bit.shrn(1);
    }

    const log2pFractionX32 = log2pFractionX64.shrn(32);
    const log2pX32 = log2pIntegerX32.add(log2pFractionX32);

    const logSqrt10001X64 = log2pX32.mul(LOG_B_2_X32);

    const tickLowBN = logSqrt10001X64.sub(LOG_B_P_ERR_MARGIN_LOWER_X64);
    const tickHighBN = logSqrt10001X64.add(LOG_B_P_ERR_MARGIN_UPPER_X64);

    const tickLow = this.signedShrn64(tickLowBN);
    const tickHigh = this.signedShrn64(tickHighBN);

    if (tickLow === tickHigh) {
      return tickLow;
    }

    const sqrtPriceAtTickHigh = TickUtil.getSqrtPriceAtTick(tickHigh);
    if (sqrtPriceAtTickHigh.lte(sqrtPriceX64)) {
      return tickHigh;
    }

    return tickLow;
  }

  private static signedShrn64(bn: BN): number {
    if (bn.isNeg()) {
      const Q64 = new BN(1).shln(64);
      const result = bn.div(Q64);
      if (!bn.mod(Q64).isZero() && bn.isNeg()) {
        return result.subn(1).toNumber();
      }
      return result.toNumber();
    } else {
      return bn.shrn(64).toNumber();
    }
  }

  static sqrtPriceX64ToPrice(sqrtPriceX64: BN, decimalsA: number, decimalsB: number): Decimal {
    const sqrtPriceSquared = sqrtPriceX64.mul(sqrtPriceX64);

    const decimalDiff = decimalsA - decimalsB;

    const DECIMAL_PRECISION = 20;
    const PRECISION_MULTIPLIER = new BN(10).pow(new BN(DECIMAL_PRECISION));

    const numerator = sqrtPriceSquared.mul(PRECISION_MULTIPLIER);
    const denominator = new BN(1).shln(128);
    const scaledResult = numerator.div(denominator);

    let resultStr = scaledResult.toString();

    while (resultStr.length <= DECIMAL_PRECISION) {
      resultStr = "0" + resultStr;
    }

    const integerPart = resultStr.slice(0, -DECIMAL_PRECISION);
    const decimalPart = resultStr.slice(-DECIMAL_PRECISION);
    const priceStr = integerPart + "." + decimalPart;

    const price = new Decimal(priceStr).mul(new Decimal(10).pow(decimalDiff));

    return price;
  }

  static tickToPrice(tick: number, decimalsA: number, decimalsB: number): Decimal {
    const sqrtPriceX64 = TickUtil.getSqrtPriceAtTick(tick);
    return this.sqrtPriceX64ToPrice(sqrtPriceX64, decimalsA, decimalsB);
  }

  static priceToTick(price: Decimal, decimalsA: number, decimalsB: number): number {
    const adjustedPrice = price.div(Math.pow(10, decimalsA - decimalsB));

    const tick = adjustedPrice.log().div(new Decimal(1.0001).log()).floor();
    return Math.max(MIN_TICK, Math.min(MAX_TICK, tick.toNumber()));
  }

  static priceToSqrtPriceX64(price: Decimal, decimalsA: number, decimalsB: number): BN {
    const adjustedPrice = price.div(Math.pow(10, decimalsA - decimalsB));
    const sqrtPrice = adjustedPrice.sqrt();
    const sqrtPriceX64 = sqrtPrice.mul(new Decimal(2).pow(64));

    return new BN(sqrtPriceX64.toFixed(0));
  }

  static toTickIndex(tick: number, tickSpacing: number) {
    if (tick >= 0) {
      return tick - (tick % tickSpacing);
    }
    return tick - (tick % tickSpacing) - (tick % tickSpacing !== 0 ? tickSpacing : 0);
  }

  static getPriceAndTick({
    price,
    mintADecimals,
    mintBDecimals,
    zeroForOne,
    tickSpacing,
  }: {
    price: Decimal;
    mintADecimals: number;
    mintBDecimals: number;
    zeroForOne: boolean;
    tickSpacing: number;
  }): { tick: number; price: Decimal } {
    let p = price.clamp(1 / 10 ** Math.max(mintADecimals, mintBDecimals), Number.MAX_SAFE_INTEGER);
    if (!zeroForOne) p = new Decimal(1).div(p);
    const newTick = TickUtil.toTickIndex(TickUtil.priceToTick(p, mintADecimals, mintBDecimals), tickSpacing);
    const newPrice = TickUtil.tickToPrice(newTick, mintADecimals, mintBDecimals);
    return {
      price: zeroForOne ? newPrice : new Decimal(1).div(newPrice),
      tick: newTick,
    };
  }
}

/**
 * Fetch tick arrays for swap simulation
 */
export async function fetchTickArrays(
  programId: PublicKey,
  connection: Connection,
  poolId: PublicKey,
  currentTick: number,
  tickSpacing: number,
  tickArrayBitmap: Buffer,
): Promise<{ address: PublicKey; value: ReturnType<typeof TickArrayLayout.decode> }[]> {
  const tickArrays: { address: PublicKey; value: ReturnType<typeof TickArrayLayout.decode> }[] = [];
  const tickArrayBitmapExtension = getPdaExBitmapAccount(programId, poolId).publicKey;
  const tickArrayBitmapExtensionRes = await connection.getAccountInfo(tickArrayBitmapExtension);
  const tickArraysAddress = TickArrayBitmapUtil.findTickArrayAddress({
    programId,
    poolId,
    poolBitmap: tickArrayBitmap,
    tickArrayBitmap: TickArrayBitmapExtensionLayout.decode(tickArrayBitmapExtensionRes!.data),
    tickSpacing,
    findInfo: { type: "zeroForOne", tickArrayCurrent: currentTick },
  });

  const tickArrayRes = await getMultipleAccountsInfo(connection, tickArraysAddress);
  tickArrayRes.forEach((res, idx) => {
    if (res) tickArrays.push({ address: tickArraysAddress[idx], value: TickArrayLayout.decode(res.data) });
  });

  return tickArrays;
}
