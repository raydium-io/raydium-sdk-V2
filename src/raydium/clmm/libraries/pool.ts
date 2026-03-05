import { PublicKey } from "@solana/web3.js"
import BN from "bn.js"
import { DynamicFeeInfoLayout, PoolInfoLayout } from "../layout"
import { mulDivFloor } from "./bigNum"
import { BN_ZERO, CollectFeeOn, MAX_TICK, MIN_TICK, Q64, REDUCTION_FACTOR_DENOMINATOR, VOLATILITY_ACCUMULATOR_SCALE } from "./constants"
import { TickArrayBitmapUtil, TickArrayUtil, TickUtil } from "./tickArrayUtil"

export class PoolFee {
  static tickSpacingIndexFromTick(tickIndex: number, tickSpacing: number): number {
    if (tickIndex % tickSpacing == 0 || tickIndex >= 0) {
      return tickIndex / tickSpacing
    } else {
      return tickIndex / tickSpacing - 1
    }
  }
}

export class DynamicFeeInfo {
  static getDynamicFeeInfo({ poolInfo }: { poolInfo: ReturnType<typeof PoolInfoLayout.decode> }) {
    if (poolInfo.dynamicFeeInfo.filterPeriod === 0 &&
      poolInfo.dynamicFeeInfo.decayPeriod === 0 &&
      poolInfo.dynamicFeeInfo.reductionFactor === 0 &&
      poolInfo.dynamicFeeInfo.dynamicFeeControl === 0 &&
      poolInfo.dynamicFeeInfo.maxVolatilityAccumulator === 0 &&
      poolInfo.dynamicFeeInfo.tickSpacingIndexReference === 0 &&
      poolInfo.dynamicFeeInfo.volatilityReference === 0 &&
      poolInfo.dynamicFeeInfo.volatilityAccumulator === 0 &&
      poolInfo.dynamicFeeInfo.lastUpdateTimestamp.isZero()) {
      return undefined
    }
    return poolInfo.dynamicFeeInfo
  }

  static updateReference({ dynamicFeeInfo, tickSpacingIndex, currentTimestamp }: {
    dynamicFeeInfo: ReturnType<typeof DynamicFeeInfoLayout.decode>,
    tickSpacingIndex: number,
    currentTimestamp: number,
  }) {
    const timeSinceReferenceUpdate = currentTimestamp - dynamicFeeInfo.lastUpdateTimestamp.toNumber()

    if (timeSinceReferenceUpdate < dynamicFeeInfo.filterPeriod) {
      //
    } else if (timeSinceReferenceUpdate < dynamicFeeInfo.decayPeriod) {
      dynamicFeeInfo.tickSpacingIndexReference = tickSpacingIndex
      dynamicFeeInfo.volatilityReference = Math.floor((dynamicFeeInfo.volatilityAccumulator * dynamicFeeInfo.reductionFactor) / REDUCTION_FACTOR_DENOMINATOR)
      dynamicFeeInfo.lastUpdateTimestamp = new BN(currentTimestamp)
    } else {
      dynamicFeeInfo.tickSpacingIndexReference = tickSpacingIndex
      dynamicFeeInfo.volatilityReference = 0
      dynamicFeeInfo.lastUpdateTimestamp = new BN(currentTimestamp)
    }
  }

  static updateVolatilityAccumulator({ state, tickSpacingIndex }: {
    state: ReturnType<typeof DynamicFeeInfoLayout.decode>,
    tickSpacingIndex: number,
  }) {
    const indexDelta = Math.abs(state.tickSpacingIndexReference - tickSpacingIndex)
    const volatilityAccumulator = state.volatilityReference + indexDelta * VOLATILITY_ACCUMULATOR_SCALE

    state.volatilityAccumulator = Math.min(volatilityAccumulator, state.maxVolatilityAccumulator)
  }
}


export class PoolUtil {
  static isFeeOnInput(feeOn: number, zeroForOne: boolean): boolean {
    switch (feeOn) {
      case CollectFeeOn.FromInput:
        return true
      case CollectFeeOn.TokenOnlyA:
        return zeroForOne
      case CollectFeeOn.TokenOnlyB:
        return !zeroForOne
      default:
        return true
    }
  }

  static isFeeOnTokenA(poolInfo: ReturnType<typeof PoolInfoLayout.decode>, zeroForOne: boolean) {
    if (poolInfo.feeOn === CollectFeeOn.FromInput) return zeroForOne
    if (poolInfo.feeOn === CollectFeeOn.TokenOnlyA) return true
    return false
  }

  static isOverflowDefaultTickarrayBitmap({ tickSpacing, tickIndexs }: {
    tickSpacing: number,
    tickIndexs: number[],
  }) {
    const { maxTickBoundary, minTickBoundary } = this.tickArrayStartIndexRange({ tickSpacing })
    for (const tickIndex of tickIndexs) {
      const tickarrayStartIndex = TickArrayUtil.getTickArrayStartIndex(tickIndex, tickSpacing)

      if (tickarrayStartIndex >= maxTickBoundary || tickarrayStartIndex < minTickBoundary) {
        return true
      }
    }

    return false
  }


  static tickArrayStartIndexRange({ tickSpacing }: {
    tickSpacing: number,
  }) {
    let maxTickBoundary = TickArrayBitmapUtil.maxTickInTickarrayBitmap(tickSpacing)
    let minTickBoundary = -maxTickBoundary

    if (maxTickBoundary > MAX_TICK) {
      maxTickBoundary = TickArrayUtil.getTickArrayStartIndex(MAX_TICK, tickSpacing) + TickArrayUtil.tickCount(tickSpacing)
    }
    if (minTickBoundary < MIN_TICK) {
      minTickBoundary = TickArrayUtil.getTickArrayStartIndex(MIN_TICK, tickSpacing)
    }
    return { maxTickBoundary, minTickBoundary }
  }

  public static async updatePoolRewardInfos({
    connection,
    apiPoolInfo,
    chainTime,
    poolLiquidity,
    rewardInfos,
  }: {
    connection: Connection;
    apiPoolInfo: ApiV3PoolInfoConcentratedItem;
    chainTime: number;
    poolLiquidity: BN;
    rewardInfos: ReturnType<typeof RewardInfoLayout.decode>[];
  }): Promise<ClmmPoolRewardInfo[]> {
    const nRewardInfo: ClmmPoolRewardInfo[] = [];
    for (let i = 0; i < rewardInfos.length; i++) {
      const _itemReward = rewardInfos[i];
      const apiRewardProgram =
        apiPoolInfo.rewardDefaultInfos[i]?.mint.programId ?? (await connection.getAccountInfo(_itemReward.mint))?.owner;
      if (apiRewardProgram === undefined) throw Error("get new reward mint info error");

      const itemReward: ClmmPoolRewardInfo = {
        ..._itemReward,
        perSecond: x64ToDecimal(_itemReward.emissionsPerSecondX64),
        remainingRewards: undefined,
        tokenProgramId: new PublicKey(apiRewardProgram),
      };

      if (itemReward.mint.equals(PublicKey.default)) continue;
      if (chainTime <= itemReward.openTime.toNumber() || poolLiquidity.eq(BN_ZERO)) {
        nRewardInfo.push(itemReward);
        continue;
      }

      const latestUpdateTime = new BN(Math.min(itemReward.endTime.toNumber(), chainTime));
      const timeDelta = latestUpdateTime.sub(itemReward.lastUpdateTime);
      const rewardGrowthDeltaX64 = mulDivFloor(timeDelta, itemReward.emissionsPerSecondX64, poolLiquidity);
      const growthGlobalX64 = itemReward.growthGlobalX64.add(rewardGrowthDeltaX64);
      const rewardEmissionedDelta = mulDivFloor(timeDelta, itemReward.emissionsPerSecondX64, Q64);
      const totalEmissioned = itemReward.totalEmissioned.add(rewardEmissionedDelta);
      nRewardInfo.push({
        ...itemReward,
        growthGlobalX64,
        totalEmissioned,
        lastUpdateTime: latestUpdateTime,
      });
    }
    return nRewardInfo;
  }
}

import { ApiV3PoolInfoConcentratedItem } from "@/api"
import { RewardInfoLayout } from "../layout"
import { ComputeClmmPoolInfo } from "../type"
import { x64ToDecimal } from "./bigNum"

import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token"
import { Connection, EpochInfo } from "@solana/web3.js"

import {
  ClmmPoolRewardInfo,
  ReturnTypeComputeAmountOut,
  ReturnTypeComputeAmountOutBaseOut,
  ReturnTypeComputeAmountOutFormat,
  ReturnTypeFetchExBitmaps,
  ReturnTypeFetchMultiplePoolTickArrays,
  ReturnTypeGetLiquidityAmountOut
} from "../type"

import { ApiV3Token } from "@/api/type"

import {
  getMultipleAccountsInfo,
  getMultipleAccountsInfoWithCustomFlags,
  getTransferAmountFeeV2,
  minExpirationTime,
  solToWSol,
} from "@/common"
import { Percent, Price, Token, TokenAmount } from "@/module"
import Decimal from "decimal.js"
import { TickArrayBitmapExtensionLayout, TickArrayLayout } from "../layout"
import { MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64 } from "./constants"
import { LiquidityMathUtil } from "./liquidityMath"
import { getPdaExBitmapAccount, getPdaTickArrayAddress } from "./pda"
import { swapInternal } from "./swapSimulator"

export class PoolUtils {
  public static getOutputAmountAndRemainAccounts(
    poolInfo: ComputeClmmPoolInfo,
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> },
    inputTokenMint: PublicKey,
    inputAmount: BN,
    blockTimestamp: number,
    sqrtPriceLimitX64?: BN,
  ): {
    allTrade: boolean;
    expectedAmountOut: BN;
    remainingAccounts: PublicKey[];
    executionPrice: BN;
    feeAmount: BN;
  } {
    const zeroForOne = inputTokenMint.toBase58() === poolInfo.mintA.address;

    const { allTrade, amountCalculated, feeAmount, sqrtPriceX64, accounts } = swapInternal(
      poolInfo.accInfo,
      Object.entries(tickArrayCache).map(i => ({ address: new PublicKey(i[0]), value: i[1] })),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      poolInfo.ammConfig,
      inputAmount,
      sqrtPriceLimitX64 ?? BN_ZERO,
      zeroForOne,
      true,
      blockTimestamp!
    )

    return {
      allTrade,
      expectedAmountOut: amountCalculated,
      remainingAccounts: accounts,
      executionPrice: sqrtPriceX64,
      feeAmount,
    };
  }

  public static getInputAmountAndRemainAccounts(
    poolInfo: ComputeClmmPoolInfo,
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> },
    outputTokenMint: PublicKey,
    outputAmount: BN,
    blockTimestamp: number,
    sqrtPriceLimitX64?: BN,
  ): { allTrade: boolean, expectedAmountIn: BN; remainingAccounts: PublicKey[]; executionPrice: BN; feeAmount: BN } {
    const zeroForOne = outputTokenMint.toBase58() === poolInfo.mintB.address;

    const { allTrade, amountCalculated, feeAmount, sqrtPriceX64, accounts } = swapInternal(
      poolInfo.accInfo,
      Object.entries(tickArrayCache).map(i => ({ address: new PublicKey(i[0]), value: i[1] })),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      poolInfo.ammConfig,
      outputAmount,
      sqrtPriceLimitX64 ?? BN_ZERO,
      zeroForOne,
      false,
      blockTimestamp!
    )

    return {
      allTrade,
      expectedAmountIn: amountCalculated,
      remainingAccounts: accounts,
      executionPrice: sqrtPriceX64,
      feeAmount,
    };
  }


  static async fetchExBitmaps({
    connection,
    exBitmapAddress,
    batchRequest,
  }: {
    connection: Connection;
    exBitmapAddress: PublicKey[];
    batchRequest: boolean;
  }): Promise<ReturnTypeFetchExBitmaps> {
    const fetchedBitmapAccount = await getMultipleAccountsInfoWithCustomFlags(
      connection,
      exBitmapAddress.map((i) => ({ pubkey: i })),
      { batchRequest },
    );

    const returnTypeFetchExBitmaps: ReturnTypeFetchExBitmaps = {};
    for (const item of fetchedBitmapAccount) {
      if (item.accountInfo === null) continue;

      returnTypeFetchExBitmaps[item.pubkey.toString()] = TickArrayBitmapExtensionLayout.decode(item.accountInfo.data);
    }
    return returnTypeFetchExBitmaps;
  }

  static async fetchMultiplePoolTickArrays({
    connection,
    poolKeys,
    batchRequest,
  }: {
    connection: Connection;
    poolKeys: Omit<ComputeClmmPoolInfo, "ammConfig">[];
    batchRequest?: boolean;
  }): Promise<ReturnTypeFetchMultiplePoolTickArrays> {
    const tickArraysToPoolId: { [key: string]: PublicKey } = {};
    const tickArrays: { pubkey: PublicKey }[] = [];
    for (const itemPoolInfo of poolKeys) {
      const startIndexArray = [
        ...TickArrayBitmapUtil.findTickArrayStartIndex({
          tickSpacing: itemPoolInfo.tickSpacing,
          poolBitmap: itemPoolInfo.tickArrayBitmap,
          tickArrayBitmap: itemPoolInfo.exBitmapInfo,
          findInfo: { type: 'zeroForOne', count: 7, tickArrayCurrent: itemPoolInfo.tickCurrent },
        }),
        ...TickArrayBitmapUtil.findTickArrayStartIndex({
          tickSpacing: itemPoolInfo.tickSpacing,
          poolBitmap: itemPoolInfo.tickArrayBitmap,
          tickArrayBitmap: itemPoolInfo.exBitmapInfo,
          findInfo: { type: 'oneForZero', count: 7, tickArrayCurrent: itemPoolInfo.tickCurrent },
        })
      ]

      for (const itemIndex of startIndexArray) {
        const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(
          itemPoolInfo.programId,
          itemPoolInfo.id,
          itemIndex,
        );
        if (tickArraysToPoolId[tickArrayAddress.toString()] !== undefined) continue
        tickArrays.push({ pubkey: tickArrayAddress });
        tickArraysToPoolId[tickArrayAddress.toString()] = itemPoolInfo.id;
      }
    }

    const fetchedTickArrays = await getMultipleAccountsInfoWithCustomFlags(connection, tickArrays, { batchRequest });

    const tickArrayCache: ReturnTypeFetchMultiplePoolTickArrays = {};

    for (const itemAccountInfo of fetchedTickArrays) {
      if (!itemAccountInfo.accountInfo) continue;
      const poolId = tickArraysToPoolId[itemAccountInfo.pubkey.toString()];
      if (!poolId) continue;
      if (tickArrayCache[poolId.toString()] === undefined) tickArrayCache[poolId.toString()] = {};

      const accountLayoutData = TickArrayLayout.decode(itemAccountInfo.accountInfo.data);

      tickArrayCache[poolId.toString()][accountLayoutData.startTickIndex] = {
        ...accountLayoutData,
        address: itemAccountInfo.pubkey,
      };
    }
    return tickArrayCache;
  }

  static computeAmountOut({
    poolInfo,
    tickArrayCache,
    baseMint,
    epochInfo,
    amountIn,
    slippage,
    blockTimestamp,
    priceLimit = new Decimal(0),
  }: {
    poolInfo: ComputeClmmPoolInfo;
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> };
    baseMint: PublicKey;

    epochInfo: EpochInfo;

    amountIn: BN;
    slippage: number;
    priceLimit?: Decimal;
    catchLiquidityInsufficient: boolean;
    blockTimestamp: number;
  }): ReturnTypeComputeAmountOut {
    let sqrtPriceLimitX64: BN;
    const isBaseIn = baseMint.toBase58() === poolInfo.mintA.address;
    const [baseFeeConfig, outFeeConfig] = isBaseIn
      ? [poolInfo.mintA.extensions.feeConfig, poolInfo.mintB.extensions.feeConfig]
      : [poolInfo.mintB.extensions.feeConfig, poolInfo.mintA.extensions.feeConfig];

    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = isBaseIn ? MIN_SQRT_PRICE_X64.add(new BN(1)) : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = TickUtil.priceToSqrtPriceX64(priceLimit, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
    }

    const realAmountIn = getTransferAmountFeeV2(amountIn, baseFeeConfig, epochInfo, false);

    const {
      allTrade,
      expectedAmountOut: _expectedAmountOut,
      remainingAccounts,
      executionPrice: _executionPriceX64,
      feeAmount,
    } = PoolUtils.getOutputAmountAndRemainAccounts(
      poolInfo,
      tickArrayCache,
      baseMint,
      realAmountIn.amount.sub(realAmountIn.fee ?? BN_ZERO),
      blockTimestamp,
      sqrtPriceLimitX64,
    );

    const amountOut = getTransferAmountFeeV2(_expectedAmountOut, outFeeConfig, epochInfo, false);

    const _executionPrice = TickUtil.sqrtPriceX64ToPrice(_executionPriceX64, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
    const executionPrice = isBaseIn ? _executionPrice : new Decimal(1).div(_executionPrice);

    const _minAmountOut = _expectedAmountOut
      .mul(new BN(Math.floor((1 - slippage) * 10000000000)))
      .div(new BN(10000000000));
    const minAmountOut = getTransferAmountFeeV2(_minAmountOut, outFeeConfig, epochInfo, false);

    const poolPrice = isBaseIn ? poolInfo.currentPrice : new Decimal(1).div(poolInfo.currentPrice);

    const _numerator = new Decimal(executionPrice).sub(poolPrice).abs();
    const _denominator = poolPrice;
    const priceImpact = new Percent(
      new Decimal(_numerator).mul(10 ** 15).toFixed(0),
      new Decimal(_denominator).mul(10 ** 15).toFixed(0),
    );

    return {
      allTrade,
      realAmountIn,
      amountOut,
      minAmountOut,
      expirationTime: minExpirationTime(realAmountIn.expirationTime, amountOut.expirationTime),
      currentPrice: poolInfo.currentPrice,
      executionPrice,
      priceImpact,
      fee: feeAmount,
      remainingAccounts,
      executionPriceX64: _executionPriceX64,
    };
  }

  static computeAmountOutFormat({
    poolInfo,
    tickArrayCache,
    amountIn,
    tokenOut: _tokenOut,
    slippage,
    epochInfo,
    blockTimestamp,
    catchLiquidityInsufficient = false,
  }: {
    poolInfo: ComputeClmmPoolInfo;
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> };
    amountIn: BN;
    tokenOut: ApiV3Token;
    slippage: number;
    epochInfo: EpochInfo;
    blockTimestamp: number;
    catchLiquidityInsufficient?: boolean;
  }): ReturnTypeComputeAmountOutFormat {
    const baseIn = _tokenOut.address === poolInfo.mintB.address;
    const [inputMint, outMint] = baseIn ? [poolInfo.mintA, poolInfo.mintB] : [poolInfo.mintB, poolInfo.mintA];
    const [baseToken, outToken] = [
      new Token({
        ...inputMint,
        mint: inputMint.address,
        isToken2022: inputMint.programId === TOKEN_2022_PROGRAM_ID.toBase58(),
      }),
      new Token({
        ...outMint,
        mint: outMint.address,
        isToken2022: outMint.programId === TOKEN_2022_PROGRAM_ID.toBase58(),
      }),
    ];

    const {
      allTrade,
      realAmountIn: _realAmountIn,
      amountOut: _amountOut,
      minAmountOut: _minAmountOut,
      expirationTime,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
      remainingAccounts,
      executionPriceX64,
    } = PoolUtils.computeAmountOut({
      poolInfo,
      tickArrayCache,
      baseMint: new PublicKey(inputMint.address),
      amountIn,
      slippage,
      epochInfo,
      catchLiquidityInsufficient,
      blockTimestamp,
    });

    const realAmountIn = {
      ..._realAmountIn,
      amount: new TokenAmount(baseToken, _realAmountIn.amount),
      fee: _realAmountIn.fee === undefined ? undefined : new TokenAmount(baseToken, _realAmountIn.fee),
    };

    const amountOut = {
      ..._amountOut,
      amount: new TokenAmount(outToken, _amountOut.amount),
      fee: _amountOut.fee === undefined ? undefined : new TokenAmount(outToken, _amountOut.fee),
    };
    const minAmountOut = {
      ..._minAmountOut,
      amount: new TokenAmount(outToken, _minAmountOut.amount),
      fee: _minAmountOut.fee === undefined ? undefined : new TokenAmount(outToken, _minAmountOut.fee),
    };

    const _currentPrice = new Price({
      baseToken,
      denominator: new BN(10).pow(new BN(20 + baseToken.decimals)),
      quoteToken: outToken,
      numerator: currentPrice.mul(new Decimal(10 ** (20 + outToken.decimals))).toFixed(0),
    });
    const _executionPrice = new Price({
      baseToken,
      denominator: new BN(10).pow(new BN(20 + baseToken.decimals)),
      quoteToken: outToken,
      numerator: executionPrice.mul(new Decimal(10 ** (20 + outToken.decimals))).toFixed(0),
    });
    const _fee = new TokenAmount(baseToken, fee);

    return {
      allTrade,
      realAmountIn,
      amountOut,
      minAmountOut,
      expirationTime,
      currentPrice: _currentPrice,
      executionPrice: _executionPrice,
      priceImpact,
      fee: _fee,
      remainingAccounts,
      executionPriceX64,
    };
  }

  static computeAmountIn({
    poolInfo,
    tickArrayCache,
    baseMint,
    epochInfo,
    amountOut,
    slippage,
    priceLimit = new Decimal(0),
    blockTimestamp,
  }: {
    poolInfo: ComputeClmmPoolInfo;
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> };
    baseMint: PublicKey;

    epochInfo: EpochInfo;

    amountOut: BN;
    slippage: number;
    priceLimit?: Decimal;
    blockTimestamp: number;
  }): ReturnTypeComputeAmountOutBaseOut {
    const isBaseIn = baseMint.toBase58() === poolInfo.mintA.address;
    const feeConfigs = {
      [poolInfo.mintA.address]: poolInfo.mintA.extensions.feeConfig,
      [poolInfo.mintB.address]: poolInfo.mintB.extensions.feeConfig,
    };

    let sqrtPriceLimitX64: BN;
    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = !isBaseIn ? MIN_SQRT_PRICE_X64.add(new BN(1)) : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = TickUtil.priceToSqrtPriceX64(priceLimit, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
    }

    const realAmountOut = getTransferAmountFeeV2(amountOut, feeConfigs[baseMint.toString()], epochInfo, true);

    const {
      expectedAmountIn: _expectedAmountIn,
      remainingAccounts,
      executionPrice: _executionPriceX64,
      feeAmount,
    } = PoolUtils.getInputAmountAndRemainAccounts(
      poolInfo,
      tickArrayCache,
      baseMint,
      realAmountOut.amount.sub(realAmountOut.fee ?? BN_ZERO),
      blockTimestamp,
      sqrtPriceLimitX64,
    );

    const inMint = isBaseIn ? poolInfo.mintB.address : poolInfo.mintA.address;

    const amountIn = getTransferAmountFeeV2(_expectedAmountIn, feeConfigs[inMint], epochInfo, false);

    const _executionPrice = TickUtil.sqrtPriceX64ToPrice(_executionPriceX64, poolInfo.mintA.decimals, poolInfo.mintB.decimals);
    const executionPrice = isBaseIn ? _executionPrice : new Decimal(1).div(_executionPrice);

    const _maxAmountIn = _expectedAmountIn
      .mul(new BN(Math.floor((1 + slippage) * 10000000000)))
      .div(new BN(10000000000));

    const maxAmountIn = getTransferAmountFeeV2(_maxAmountIn, feeConfigs[inMint], epochInfo, true);

    const poolPrice = isBaseIn ? poolInfo.currentPrice : new Decimal(1).div(poolInfo.currentPrice);

    const _numerator = new Decimal(executionPrice).sub(poolPrice).abs();
    const _denominator = poolPrice;
    const priceImpact = new Percent(
      new Decimal(_numerator).mul(10 ** 15).toFixed(0),
      new Decimal(_denominator).mul(10 ** 15).toFixed(0),
    );

    return {
      amountIn,
      maxAmountIn,
      realAmountOut,
      expirationTime: minExpirationTime(amountIn.expirationTime, realAmountOut.expirationTime),
      currentPrice: poolInfo.currentPrice,
      executionPrice,
      priceImpact,
      fee: feeAmount,

      remainingAccounts,
    };
  }

  static estimateAprsForPriceRangeMultiplier({
    poolInfo,
    aprType,
    positionTickLowerIndex,
    positionTickUpperIndex,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    aprType: "day" | "week" | "month";

    positionTickLowerIndex: number;
    positionTickUpperIndex: number;
  }): {
    feeApr: number;
    rewardsApr: number[];
    apr: number;
  } {
    const aprInfo = poolInfo[aprType];

    const priceLower = TickUtil.tickToPrice(positionTickLowerIndex, poolInfo.mintA.decimals, poolInfo.mintB.decimals).toNumber()
    const priceUpper = TickUtil.tickToPrice(positionTickUpperIndex, poolInfo.mintA.decimals, poolInfo.mintB.decimals).toNumber()

    const _minPrice = Math.max(priceLower, aprInfo.priceMin);
    const _maxPrice = Math.min(priceUpper, aprInfo.priceMax);

    const sub = _maxPrice - _minPrice;

    const userRange = priceUpper - priceLower;
    const tradeRange = aprInfo.priceMax - aprInfo.priceMin;

    let p: number;

    if (sub <= 0) p = 0;
    else if (userRange === sub) p = tradeRange / sub;
    else if (tradeRange === sub) p = sub / userRange;
    else p = (sub / tradeRange) * (sub / userRange);

    return {
      feeApr: aprInfo.feeApr * p,
      rewardsApr: [(aprInfo.rewardApr[0] ?? 0) * p, (aprInfo.rewardApr[1] ?? 0) * p, (aprInfo.rewardApr[2] ?? 0) * p],
      apr: aprInfo.apr * p,
    };
  }

  static estimateAprsForPriceRangeDelta({
    poolInfo,
    poolLiquidity,
    aprType,
    mintPrice,
    liquidity,
    positionTickLowerIndex,
    positionTickUpperIndex,
    chainTime,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolLiquidity: BN;
    aprType: "day" | "week" | "month";

    mintPrice: { [mint: string]: { value: number } };

    liquidity: BN;
    positionTickLowerIndex: number;
    positionTickUpperIndex: number;

    chainTime: number;
  }): {
    feeApr: number;
    rewardsApr: number[];
    apr: number;
  } {
    const aprTypeDay = aprType === "day" ? 1 : aprType === "week" ? 7 : aprType === "month" ? 30 : 0;
    const aprInfo = poolInfo[aprType];
    const mintPriceA = mintPrice[solToWSol(poolInfo.mintA.address).toString()];
    const mintPriceB = mintPrice[solToWSol(poolInfo.mintB.address).toString()];
    const mintDecimalsA = poolInfo.mintA.decimals;
    const mintDecimalsB = poolInfo.mintB.decimals;

    if (!aprInfo || !mintPriceA || !mintPriceB) return { feeApr: 0, rewardsApr: [0, 0, 0], apr: 0 };

    const sqrtPriceX64 = TickUtil.priceToSqrtPriceX64(
      new Decimal(poolInfo.price),
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    const sqrtPriceX64A = TickUtil.getSqrtPriceAtTick(positionTickLowerIndex);
    const sqrtPriceX64B = TickUtil.getSqrtPriceAtTick(positionTickUpperIndex);

    const { amountSlippageA: poolLiquidityA, amountSlippageB: poolLiquidityB } = LiquidityMathUtil.getAmountsFromLiquidityWithSlippage(
      sqrtPriceX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      poolLiquidity,
      false,
      false,
      0,
    );

    const { amountSlippageA: userLiquidityA, amountSlippageB: userLiquidityB } = LiquidityMathUtil.getAmountsFromLiquidityWithSlippage(
      sqrtPriceX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      false,
      false,
      0,
    );

    const poolTvl = new Decimal(poolLiquidityA.toString())
      .div(new Decimal(10).pow(mintDecimalsA))
      .mul(mintPriceA.value)
      .add(new Decimal(poolLiquidityB.toString()).div(new Decimal(10).pow(mintDecimalsB)).mul(mintPriceB.value));
    const userTvl = new Decimal(userLiquidityA.toString())
      .div(new Decimal(10).pow(mintDecimalsA))
      .mul(mintPriceA.value)
      .add(new Decimal(userLiquidityB.toString()).div(new Decimal(10).pow(mintDecimalsB)).mul(mintPriceB.value));

    const p = new Decimal(1).div(poolTvl.add(userTvl));

    const feesPerYear = new Decimal(aprInfo.volumeFee).mul(365).div(aprTypeDay);
    const feeApr = feesPerYear.mul(p).mul(100).toNumber();

    const SECONDS_PER_YEAR = 3600 * 24 * 365;

    const rewardsApr = poolInfo.rewardDefaultInfos.map((i) => {
      const iDecimal = i.mint.decimals;
      const iPrice = mintPrice[i.mint.address];

      if (
        chainTime < ((i as any).startTime ?? 0) ||
        chainTime > ((i as any).endTime ?? 0) ||
        !i.perSecond ||
        !iPrice ||
        iDecimal === undefined
      )
        return 0;

      return new Decimal(iPrice.value)
        .mul(new Decimal(i.perSecond).mul(SECONDS_PER_YEAR))
        .div(new Decimal(10).pow(iDecimal))
        .mul(p)
        .mul(100)
        .toNumber();
    });

    return {
      feeApr,
      rewardsApr,
      apr: feeApr + rewardsApr.reduce((a, b) => a + b, 0),
    };
  }

  static async getLiquidityAmountOutFromAmountIn({
    poolInfo,
    inputA,
    tickLower,
    tickUpper,
    amount,
    slippage,
    add,
    epochInfo,
    amountHasFee,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    inputA: boolean;
    tickLower: number;
    tickUpper: number;
    amount: BN;
    slippage: number;
    add: boolean;
    epochInfo: EpochInfo;
    amountHasFee: boolean;
  }): Promise<ReturnTypeGetLiquidityAmountOut> {
    const sqrtPriceX64 = TickUtil.priceToSqrtPriceX64(
      new Decimal(poolInfo.price),
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const sqrtPriceX64A = TickUtil.getSqrtPriceAtTick(tickLower);
    const sqrtPriceX64B = TickUtil.getSqrtPriceAtTick(tickUpper);

    // const coefficient = add ? 1 - slippage : 1 + slippage;
    const addFeeAmount = getTransferAmountFeeV2(
      amount,
      poolInfo[inputA ? "mintA" : "mintB"].extensions?.feeConfig,
      epochInfo,
      !amountHasFee,
    );
    const _amount = new BN(
      new Decimal(addFeeAmount.amount.sub(addFeeAmount.fee ?? BN_ZERO).toString()).toFixed(0), // .mul(coefficient).toFixed(0),
    );

    let liquidity: BN;
    if (sqrtPriceX64.lte(sqrtPriceX64A)) {
      liquidity = inputA ? LiquidityMathUtil.getLiquidityFromAmountA(sqrtPriceX64A, sqrtPriceX64B, _amount) : new BN(0);
    } else if (sqrtPriceX64.lte(sqrtPriceX64B)) {
      const liquidity0 = LiquidityMathUtil.getLiquidityFromAmountA(sqrtPriceX64, sqrtPriceX64B, _amount);
      const liquidity1 = LiquidityMathUtil.getLiquidityFromAmountB(sqrtPriceX64A, sqrtPriceX64, _amount);
      liquidity = inputA ? liquidity0 : liquidity1;
    } else {
      liquidity = inputA ? new BN(0) : LiquidityMathUtil.getLiquidityFromAmountB(sqrtPriceX64A, sqrtPriceX64B, _amount);
    }

    const amountFromLiquidity = await PoolUtils.getAmountsFromLiquidity({
      epochInfo,
      poolInfo,
      tickLower,
      tickUpper,
      liquidity,
      slippage,
      add,
    });
    return {
      liquidity,
      amountA: inputA ? addFeeAmount : amountFromLiquidity.amountA,
      amountB: inputA ? amountFromLiquidity.amountB : addFeeAmount,
      amountSlippageA: inputA ? addFeeAmount : amountFromLiquidity.amountSlippageA,
      amountSlippageB: inputA ? amountFromLiquidity.amountSlippageB : addFeeAmount,
      expirationTime: amountFromLiquidity.expirationTime,
    };
  }

  static async getAmountsFromLiquidity({
    epochInfo,
    poolInfo,
    tickLower,
    tickUpper,
    liquidity,
    slippage,
    add,
  }: {
    epochInfo: EpochInfo;
    poolInfo: ApiV3PoolInfoConcentratedItem;
    tickLower: number;
    tickUpper: number;
    liquidity: BN;
    slippage: number;
    add: boolean;
  }): Promise<ReturnTypeGetLiquidityAmountOut> {
    const sqrtPriceX64A = TickUtil.getSqrtPriceAtTick(tickLower);
    const sqrtPriceX64B = TickUtil.getSqrtPriceAtTick(tickUpper);

    const coefficientRe = add ? 1 + slippage : 1 - slippage;

    const amounts = LiquidityMathUtil.getAmountsForLiquidity(
      TickUtil.priceToSqrtPriceX64(new Decimal(poolInfo.price), poolInfo.mintA.decimals, poolInfo.mintB.decimals),
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      add,
    );
    const [amountA, amountB] = [
      getTransferAmountFeeV2(amounts.amountA, poolInfo.mintA.extensions?.feeConfig, epochInfo, true),
      getTransferAmountFeeV2(amounts.amountB, poolInfo.mintB.extensions?.feeConfig, epochInfo, true),
    ];
    const [amountSlippageA, amountSlippageB] = [
      getTransferAmountFeeV2(
        amounts.amountA.muln(coefficientRe),
        poolInfo.mintA.extensions?.feeConfig,
        epochInfo,
        true,
      ),
      getTransferAmountFeeV2(
        amounts.amountB.muln(coefficientRe),
        poolInfo.mintB.extensions?.feeConfig,
        epochInfo,
        true,
      ),
    ];

    return {
      liquidity,
      amountA,
      amountB,
      amountSlippageA,
      amountSlippageB,
      expirationTime: minExpirationTime(amountA.expirationTime, amountB.expirationTime),
    };
  }

  static async fetchComputeMultipleClmmInfo({
    connection,
    poolList,
    rpcDataMap = {},
  }: {
    rpcDataMap?: Record<string, ReturnType<typeof PoolInfoLayout.decode>>;
    connection: Connection;
    poolList: Pick<ApiV3PoolInfoConcentratedItem, "id" | "programId" | "mintA" | "mintB" | "config" | "price">[];
  }): Promise<Record<string, ComputeClmmPoolInfo>> {
    const fetchRpcList = poolList.filter((p) => !rpcDataMap[p.id]).map((p) => new PublicKey(p.id));
    const rpcRes = await getMultipleAccountsInfo(connection, fetchRpcList);
    rpcRes.forEach((r, idx) => {
      if (!r) return;
      rpcDataMap[fetchRpcList[idx].toBase58()] = PoolInfoLayout.decode(r.data);
    });

    const pdaList = poolList.map(
      (poolInfo) => getPdaExBitmapAccount(new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)).publicKey,
    );

    const exBitData = await PoolUtils.fetchExBitmaps({
      connection,
      exBitmapAddress: pdaList,
      batchRequest: false,
    });

    const kv: Record<string, ComputeClmmPoolInfo> = {};

    return poolList.reduce(
      (acc, cur) => ({
        ...acc,
        [cur.id]: {
          accInfo: rpcDataMap[cur.id],
          ...rpcDataMap[cur.id],
          id: new PublicKey(cur.id),
          version: 6,
          programId: new PublicKey(cur.programId),
          mintA: cur.mintA,
          mintB: cur.mintB,
          ammConfig: {
            ...cur.config,
            id: new PublicKey(cur.config.id),
            fundOwner: "",
          },
          currentPrice: new Decimal(cur.price),
          exBitmapAccount: getPdaExBitmapAccount(new PublicKey(cur.programId), new PublicKey(cur.id)).publicKey,
          exBitmapInfo:
            exBitData[getPdaExBitmapAccount(new PublicKey(cur.programId), new PublicKey(cur.id)).publicKey.toBase58()],
          startTime: rpcDataMap[cur.id].startTime.toNumber(),
          rewardInfos: rpcDataMap[cur.id].rewardInfos,
        },
      }),
      {} as Record<string, ComputeClmmPoolInfo>,
    );
  }

  static async fetchComputeClmmInfo({
    connection,
    poolInfo,
    rpcData,
  }: {
    connection: Connection;
    poolInfo: Pick<ApiV3PoolInfoConcentratedItem, "id" | "programId" | "mintA" | "mintB" | "config" | "price">;
    rpcData?: ReturnType<typeof PoolInfoLayout.decode>;
  }): Promise<ComputeClmmPoolInfo> {
    return (
      await this.fetchComputeMultipleClmmInfo({
        connection,
        rpcDataMap: rpcData ? { [poolInfo.id]: rpcData } : undefined,
        poolList: [poolInfo],
      })
    )[poolInfo.id];
  }

  static async fetchTickArrayInfo({
    connection,
    programId,
    poolId,
    tick,
    tickSpacing,
  }: {
    connection: Connection;
    programId: PublicKey;
    poolId: PublicKey;
    tick: number;
    tickSpacing: number;
  }): Promise<ReturnType<typeof TickArrayLayout.decode>> {
    const tickArrayStart = TickArrayUtil.getTickArrayStartIndex(tick, tickSpacing);
    const tickArray = getPdaTickArrayAddress(programId, poolId, tickArrayStart).publicKey;
    const tickData = await connection.getAccountInfo(tickArray);
    if (!tickData) throw new Error(`tick array ${tickArray.toBase58()} not found`);
    return TickArrayLayout.decode(tickData.data);
  }

  static async fetchMultipleTickArrayInfo({
    connection,
    tickInfoList,
  }: {
    connection: Connection;
    tickInfoList: { programId: PublicKey; poolId: PublicKey; tick: number; tickSpacing: number }[];
  }): Promise<(ReturnType<typeof TickArrayLayout.decode> | null)[]> {
    const tickPda = tickInfoList.map((data) => {
      const tickArrayStart = TickArrayUtil.getTickArrayStartIndex(data.tick, data.tickSpacing);
      return getPdaTickArrayAddress(data.programId, data.poolId, tickArrayStart).publicKey;
    });

    const data = await getMultipleAccountsInfo(connection, tickPda);
    return data.map((d) => (d ? TickArrayLayout.decode(d.data) : d));
  }
}

const mockRewardData = {
  volume: 0,
  volumeQuote: 0,
  volumeFee: 0,
  apr: 0,
  feeApr: 0,
  priceMin: 0,
  priceMax: 0,
  rewardApr: [],
};

export function clmmComputeInfoToApiInfo(pool: ComputeClmmPoolInfo): ApiV3PoolInfoConcentratedItem {
  return {
    ...pool,
    type: "Concentrated",
    programId: pool.programId.toString(),
    id: pool.id.toString(),
    rewardDefaultInfos: [],
    rewardDefaultPoolInfos: "Clmm",
    price: pool.currentPrice.toNumber(),
    mintAmountA: 0,
    mintAmountB: 0,
    feeRate: pool.ammConfig.tradeFeeRate,
    openTime: pool.startTime.toString(),
    tvl: 0,

    day: mockRewardData,
    week: mockRewardData,
    month: mockRewardData,
    pooltype: [],

    farmUpcomingCount: 0,
    farmOngoingCount: 0,
    farmFinishedCount: 0,
    burnPercent: 0,
    config: {
      ...pool.ammConfig,
      id: pool.ammConfig.id.toString(),
      defaultRange: 0,
      defaultRangePoint: [],
    },
  };
}
