import { Connection, EpochInfo, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

import {
  ClmmPoolInfo,
  ClmmPoolRewardInfo,
  ClmmPoolRewardLayoutInfo,
  ComputeClmmPoolInfo,
  ReturnTypeComputeAmountOut,
  ReturnTypeComputeAmountOutBaseOut,
  ReturnTypeComputeAmountOutFormat,
  ReturnTypeFetchExBitmaps,
  ReturnTypeFetchMultiplePoolTickArrays,
  ReturnTypeGetLiquidityAmountOut,
  SDKParsedConcentratedInfo,
  TickArrayBitmapExtensionType,
} from "../type";

import { ApiV3PoolInfoConcentratedItem, ApiV3Token } from "@/api/type";

import Decimal from "decimal.js";
import {
  getMultipleAccountsInfo,
  getMultipleAccountsInfoWithCustomFlags,
  getTransferAmountFeeV2,
  minExpirationTime,
  solToWSol,
} from "@/common";
import { Percent, Price, Token, TokenAmount } from "@/module";
import { TokenAccountRaw } from "@/raydium/account/types";
import { PoolInfoLayout, PositionInfoLayout, TickArrayBitmapExtensionLayout, TickArrayLayout } from "../layout";
import { MAX_SQRT_PRICE_X64, MAX_TICK, MIN_SQRT_PRICE_X64, MIN_TICK, NEGATIVE_ONE, Q64, ZERO } from "./constants";
import { LiquidityMath, MathUtil, SqrtPriceMath, SwapMath } from "./math";
import { getPdaExBitmapAccount, getPdaPersonalPositionAddress, getPdaTickArrayAddress } from "./pda";
import { PositionUtils } from "./position";
import { TICK_ARRAY_BITMAP_SIZE, Tick, TickArray, TickUtils } from "./tick";
import { TickArrayBitmap, TickArrayBitmapExtensionUtils } from "./tickarrayBitmap";
import { TickQuery } from "./tickQuery";

export class PoolUtils {
  public static getOutputAmountAndRemainAccounts(
    poolInfo: ComputeClmmPoolInfo,
    tickArrayCache: { [key: string]: TickArray },
    inputTokenMint: PublicKey,
    inputAmount: BN,
    sqrtPriceLimitX64?: BN,
    catchLiquidityInsufficient = false,
  ): {
    allTrade: boolean;
    expectedAmountOut: BN;
    remainingAccounts: PublicKey[];
    executionPrice: BN;
    feeAmount: BN;
  } {
    const zeroForOne = inputTokenMint.toBase58() === poolInfo.mintA.address;

    const allNeededAccounts: PublicKey[] = [];
    const {
      isExist,
      startIndex: firstTickArrayStartIndex,
      nextAccountMeta,
    } = this.getFirstInitializedTickArray(poolInfo, zeroForOne);
    if (!isExist || firstTickArrayStartIndex === undefined || !nextAccountMeta) throw new Error("Invalid tick array");

    // try {
    //   const preTick = this.preInitializedTickArrayStartIndex(poolInfo, !zeroForOne)
    //   if (preTick.isExist) {
    //     const { publicKey: address } = getPdaTickArrayAddress(
    //       poolInfo.programId,
    //       poolInfo.id,
    //       preTick.nextStartIndex
    //     );
    //     allNeededAccounts.push(address)
    //   }
    // } catch (e) { /* empty */ }

    allNeededAccounts.push(nextAccountMeta);
    const {
      allTrade,
      amountCalculated: outputAmount,
      accounts: reaminAccounts,
      sqrtPriceX64: executionPrice,
      feeAmount,
    } = SwapMath.swapCompute(
      poolInfo.programId,
      poolInfo.id,
      tickArrayCache,
      poolInfo.tickArrayBitmap,
      poolInfo.exBitmapInfo,
      zeroForOne,
      poolInfo.ammConfig.tradeFeeRate,
      poolInfo.liquidity,
      poolInfo.tickCurrent,
      poolInfo.tickSpacing,
      poolInfo.sqrtPriceX64,
      inputAmount,
      firstTickArrayStartIndex,
      sqrtPriceLimitX64,
      catchLiquidityInsufficient,
    );
    allNeededAccounts.push(...reaminAccounts);
    return {
      allTrade,
      expectedAmountOut: outputAmount.mul(NEGATIVE_ONE),
      remainingAccounts: allNeededAccounts,
      executionPrice,
      feeAmount,
    };
  }

  public static getInputAmountAndRemainAccounts(
    poolInfo: ComputeClmmPoolInfo,
    tickArrayCache: { [key: string]: TickArray },
    outputTokenMint: PublicKey,
    outputAmount: BN,
    sqrtPriceLimitX64?: BN,
  ): { expectedAmountIn: BN; remainingAccounts: PublicKey[]; executionPrice: BN; feeAmount: BN } {
    const zeroForOne = outputTokenMint.toBase58() === poolInfo.mintB.address;

    const allNeededAccounts: PublicKey[] = [];
    const {
      isExist,
      startIndex: firstTickArrayStartIndex,
      nextAccountMeta,
    } = this.getFirstInitializedTickArray(poolInfo, zeroForOne);
    if (!isExist || firstTickArrayStartIndex === undefined || !nextAccountMeta) throw new Error("Invalid tick array");

    try {
      const preTick = this.preInitializedTickArrayStartIndex(poolInfo, zeroForOne);
      if (preTick.isExist) {
        const { publicKey: address } = getPdaTickArrayAddress(poolInfo.programId, poolInfo.id, preTick.nextStartIndex);
        allNeededAccounts.push(address);
      }
    } catch (e) {
      /* empty */
    }

    allNeededAccounts.push(nextAccountMeta);
    const {
      amountCalculated: inputAmount,
      accounts: reaminAccounts,
      sqrtPriceX64: executionPrice,
      feeAmount,
    } = SwapMath.swapCompute(
      poolInfo.programId,
      poolInfo.id,
      tickArrayCache,
      poolInfo.tickArrayBitmap,
      poolInfo.exBitmapInfo,
      zeroForOne,
      poolInfo.ammConfig.tradeFeeRate,
      poolInfo.liquidity,
      poolInfo.tickCurrent,
      poolInfo.tickSpacing,
      poolInfo.sqrtPriceX64,
      outputAmount.mul(NEGATIVE_ONE),
      firstTickArrayStartIndex,
      sqrtPriceLimitX64,
    );
    allNeededAccounts.push(...reaminAccounts);
    return { expectedAmountIn: inputAmount, remainingAccounts: allNeededAccounts, executionPrice, feeAmount };
  }

  public static getFirstInitializedTickArray(
    poolInfo: ComputeClmmPoolInfo,
    zeroForOne: boolean,
  ):
    | { isExist: true; startIndex: number; nextAccountMeta: PublicKey }
    | { isExist: false; startIndex: undefined; nextAccountMeta: undefined } {
    const { isInitialized, startIndex } = PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.tickSpacing, [
      poolInfo.tickCurrent,
    ])
      ? TickArrayBitmapExtensionUtils.checkTickArrayIsInit(
        TickQuery.getArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing),
        poolInfo.tickSpacing,
        poolInfo.exBitmapInfo,
      )
      : TickUtils.checkTickArrayIsInitialized(
        TickUtils.mergeTickArrayBitmap(poolInfo.tickArrayBitmap),
        poolInfo.tickCurrent,
        poolInfo.tickSpacing,
      );

    if (isInitialized) {
      const { publicKey: address } = getPdaTickArrayAddress(poolInfo.programId, poolInfo.id, startIndex);
      return {
        isExist: true,
        startIndex,
        nextAccountMeta: address,
      };
    }
    const { isExist, nextStartIndex } = this.nextInitializedTickArrayStartIndex(
      poolInfo,
      TickQuery.getArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing),
      zeroForOne,
    );
    if (isExist) {
      const { publicKey: address } = getPdaTickArrayAddress(poolInfo.programId, poolInfo.id, nextStartIndex);
      return {
        isExist: true,
        startIndex: nextStartIndex,
        nextAccountMeta: address,
      };
    }
    return { isExist: false, nextAccountMeta: undefined, startIndex: undefined };
  }

  public static preInitializedTickArrayStartIndex(
    poolInfo: ComputeClmmPoolInfo,
    zeroForOne: boolean,
  ): { isExist: boolean; nextStartIndex: number } {
    const currentOffset = Math.floor(poolInfo.tickCurrent / TickQuery.tickCount(poolInfo.tickSpacing));

    const result: number[] = !zeroForOne
      ? TickUtils.searchLowBitFromStart(
        poolInfo.tickArrayBitmap,
        poolInfo.exBitmapInfo,
        currentOffset - 1,
        1,
        poolInfo.tickSpacing,
      )
      : TickUtils.searchHightBitFromStart(
        poolInfo.tickArrayBitmap,
        poolInfo.exBitmapInfo,
        currentOffset + 1,
        1,
        poolInfo.tickSpacing,
      );

    return result.length > 0 ? { isExist: true, nextStartIndex: result[0] } : { isExist: false, nextStartIndex: 0 };
  }

  public static nextInitializedTickArrayStartIndex(
    poolInfo:
      | {
        tickCurrent: number;
        tickSpacing: number;
        tickArrayBitmap: BN[];
        exBitmapInfo: TickArrayBitmapExtensionType;
      }
      | ClmmPoolInfo,
    lastTickArrayStartIndex: number,
    zeroForOne: boolean,
  ): { isExist: boolean; nextStartIndex: number } {
    lastTickArrayStartIndex = TickQuery.getArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { isInit: startIsInit, tickIndex: startIndex } = TickArrayBitmap.nextInitializedTickArrayStartIndex(
        TickUtils.mergeTickArrayBitmap(poolInfo.tickArrayBitmap),
        lastTickArrayStartIndex,
        poolInfo.tickSpacing,
        zeroForOne,
      );
      if (startIsInit) {
        return { isExist: true, nextStartIndex: startIndex };
      }
      lastTickArrayStartIndex = startIndex;

      const { isInit, tickIndex } = TickArrayBitmapExtensionUtils.nextInitializedTickArrayFromOneBitmap(
        lastTickArrayStartIndex,
        poolInfo.tickSpacing,
        zeroForOne,
        poolInfo.exBitmapInfo,
      );
      if (isInit) return { isExist: true, nextStartIndex: tickIndex };

      lastTickArrayStartIndex = tickIndex;

      if (lastTickArrayStartIndex < MIN_TICK || lastTickArrayStartIndex > MAX_TICK)
        return { isExist: false, nextStartIndex: 0 };
    }

    // const tickArrayBitmap = TickUtils.mergeTickArrayBitmap(
    //   poolInfo.tickArrayBitmap
    // );
    // const currentOffset = TickUtils.getTickArrayOffsetInBitmapByTick(
    //   poolInfo.tickCurrent,
    //   poolInfo.tickSpacing
    // );
    // const result: number[] = zeroForOne ? TickUtils.searchLowBitFromStart(
    //   tickArrayBitmap,
    //   currentOffset - 1,
    //   0,
    //   1,
    //   poolInfo.tickSpacing
    // ) : TickUtils.searchHightBitFromStart(
    //   tickArrayBitmap,
    //   currentOffset,
    //   1024,
    //   1,
    //   poolInfo.tickSpacing
    // );

    // return result.length > 0 ? { isExist: true, nextStartIndex: result[0] } : { isExist: false, nextStartIndex: 0 }
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
    rewardInfos: ClmmPoolRewardLayoutInfo[];
  }): Promise<ClmmPoolRewardInfo[]> {
    const nRewardInfo: ClmmPoolRewardInfo[] = [];
    for (let i = 0; i < rewardInfos.length; i++) {
      const _itemReward = rewardInfos[i];
      const apiRewardProgram =
        apiPoolInfo.rewardDefaultInfos[i]?.mint.programId ??
        (await connection.getAccountInfo(_itemReward.tokenMint))?.owner;
      if (apiRewardProgram === undefined) throw Error("get new reward mint info error");

      const itemReward: ClmmPoolRewardInfo = {
        ..._itemReward,
        perSecond: MathUtil.x64ToDecimal(_itemReward.emissionsPerSecondX64),
        remainingRewards: undefined,
        tokenProgramId: new PublicKey(apiRewardProgram),
      };

      if (itemReward.tokenMint.equals(PublicKey.default)) continue;
      if (chainTime <= itemReward.openTime.toNumber() || poolLiquidity.eq(ZERO)) {
        nRewardInfo.push(itemReward);
        continue;
      }

      const latestUpdateTime = new BN(Math.min(itemReward.endTime.toNumber(), chainTime));
      const timeDelta = latestUpdateTime.sub(itemReward.lastUpdateTime);
      const rewardGrowthDeltaX64 = MathUtil.mulDivFloor(timeDelta, itemReward.emissionsPerSecondX64, poolLiquidity);
      const rewardGrowthGlobalX64 = itemReward.rewardGrowthGlobalX64.add(rewardGrowthDeltaX64);
      const rewardEmissionedDelta = MathUtil.mulDivFloor(timeDelta, itemReward.emissionsPerSecondX64, Q64);
      const rewardTotalEmissioned = itemReward.rewardTotalEmissioned.add(rewardEmissionedDelta);
      nRewardInfo.push({
        ...itemReward,
        rewardGrowthGlobalX64,
        rewardTotalEmissioned,
        lastUpdateTime: latestUpdateTime,
      });
    }
    return nRewardInfo;
  }

  public static isOverflowDefaultTickarrayBitmap(tickSpacing: number, tickarrayStartIndexs: number[]): boolean {
    const { maxTickBoundary, minTickBoundary } = this.tickRange(tickSpacing);

    for (const tickIndex of tickarrayStartIndexs) {
      const tickarrayStartIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);

      if (tickarrayStartIndex >= maxTickBoundary || tickarrayStartIndex < minTickBoundary) {
        return true;
      }
    }

    return false;
  }

  public static tickRange(tickSpacing: number): {
    maxTickBoundary: number;
    minTickBoundary: number;
  } {
    let maxTickBoundary = TickArrayBitmap.maxTickInTickarrayBitmap(tickSpacing);
    let minTickBoundary = -maxTickBoundary;

    if (maxTickBoundary > MAX_TICK) {
      maxTickBoundary = TickQuery.getArrayStartIndex(MAX_TICK, tickSpacing) + TickQuery.tickCount(tickSpacing);
    }
    if (minTickBoundary < MIN_TICK) {
      minTickBoundary = TickQuery.getArrayStartIndex(MIN_TICK, tickSpacing);
    }
    return { maxTickBoundary, minTickBoundary };
  }

  public static get_tick_array_offset(tickarrayStartIndex: number, tickSpacing: number): number {
    if (!TickQuery.checkIsValidStartIndex(tickarrayStartIndex, tickSpacing)) {
      throw new Error("No enough initialized tickArray");
    }

    return (tickarrayStartIndex / TickQuery.tickCount(tickSpacing)) * TICK_ARRAY_BITMAP_SIZE;
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
      const currentTickArrayStartIndex = TickUtils.getTickArrayStartIndexByTick(
        itemPoolInfo.tickCurrent,
        itemPoolInfo.tickSpacing,
      );
      const startIndexArray = TickUtils.getInitializedTickArrayInRange(
        itemPoolInfo.tickArrayBitmap,
        itemPoolInfo.exBitmapInfo,
        itemPoolInfo.tickSpacing,
        currentTickArrayStartIndex,
        7,
      );
      for (const itemIndex of startIndexArray) {
        const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(
          itemPoolInfo.programId,
          itemPoolInfo.id,
          itemIndex,
        );
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

  // deprecated, new api doesn't need
  static async fetchPoolsAccountPosition({
    pools,
    connection,
    ownerInfo,
    batchRequest = false,
    updateOwnerRewardAndFee = true,
  }: {
    pools: SDKParsedConcentratedInfo[];
    connection: Connection;
    ownerInfo: { wallet: PublicKey; tokenAccounts: TokenAccountRaw[] };
    batchRequest?: boolean;
    updateOwnerRewardAndFee?: boolean;
  }): Promise<SDKParsedConcentratedInfo[]> {
    const programIds: PublicKey[] = [];

    for (let index = 0; index < pools.length; index++) {
      const accountInfo = pools[index];

      if (accountInfo === null) continue;

      if (!programIds.find((i) => i.equals(accountInfo.state.programId))) programIds.push(accountInfo.state.programId);
    }

    if (ownerInfo) {
      const allMint = ownerInfo.tokenAccounts.map((i) => i.accountInfo.mint);
      const allPositionKey: PublicKey[] = [];
      for (const itemMint of allMint) {
        for (const itemProgramId of programIds) {
          allPositionKey.push(getPdaPersonalPositionAddress(itemProgramId, itemMint).publicKey);
        }
      }
      const positionAccountInfos = await getMultipleAccountsInfo(connection, allPositionKey, { batchRequest });
      const keyToTickArrayAddress: { [key: string]: PublicKey } = {};
      for (const itemAccountInfo of positionAccountInfos) {
        if (itemAccountInfo === null) continue;
        // TODO: add check

        const position = PositionInfoLayout.decode(itemAccountInfo.data);
        const itemPoolId = position.poolId.toString();
        const poolInfoA = pools.find((pool) => pool.state.id.toBase58() === itemPoolId);
        if (poolInfoA === undefined) continue;

        const poolInfo = poolInfoA.state;

        const priceLower = TickUtils._getTickPriceLegacy({
          poolInfo,
          tick: position.tickLower,
          baseIn: true,
        });
        const priceUpper = TickUtils._getTickPriceLegacy({
          poolInfo,
          tick: position.tickUpper,
          baseIn: true,
        });
        const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
          poolInfo.sqrtPriceX64,
          priceLower.tickSqrtPriceX64,
          priceUpper.tickSqrtPriceX64,
          position.liquidity,
          false,
        );

        const leverage = 1 / (1 - Math.sqrt(Math.sqrt(priceLower.price.div(priceUpper.price).toNumber())));

        poolInfoA.positionAccount = [
          ...(poolInfoA.positionAccount ?? []),
          {
            poolId: position.poolId,
            nftMint: position.nftMint,

            priceLower: priceLower.price,
            priceUpper: priceUpper.price,
            amountA,
            amountB,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            liquidity: position.liquidity,
            feeGrowthInsideLastX64A: position.feeGrowthInsideLastX64A,
            feeGrowthInsideLastX64B: position.feeGrowthInsideLastX64B,
            tokenFeesOwedA: position.tokenFeesOwedA,
            tokenFeesOwedB: position.tokenFeesOwedB,
            rewardInfos: position.rewardInfos.map((i) => ({
              ...i,
              pendingReward: new BN(0),
            })),

            leverage,
            tokenFeeAmountA: new BN(0),
            tokenFeeAmountB: new BN(0),
          },
        ];

        const tickArrayLowerAddress = await TickUtils.getTickArrayAddressByTick(
          poolInfoA.state.programId,
          position.poolId,
          position.tickLower,
          poolInfoA.state.tickSpacing,
        );
        const tickArrayUpperAddress = await TickUtils.getTickArrayAddressByTick(
          poolInfoA.state.programId,
          position.poolId,
          position.tickUpper,
          poolInfoA.state.tickSpacing,
        );
        keyToTickArrayAddress[
          `${poolInfoA.state.programId.toString()}-${position.poolId.toString()}-${position.tickLower}`
        ] = tickArrayLowerAddress;
        keyToTickArrayAddress[
          `${poolInfoA.state.programId.toString()}-${position.poolId.toString()}-${position.tickUpper}`
        ] = tickArrayUpperAddress;
      }

      if (updateOwnerRewardAndFee) {
        const tickArrayKeys = Object.values(keyToTickArrayAddress);
        const tickArrayDatas = await getMultipleAccountsInfo(connection, tickArrayKeys, { batchRequest });
        const tickArrayLayout = {};
        for (let index = 0; index < tickArrayKeys.length; index++) {
          const tickArrayData = tickArrayDatas[index];
          if (tickArrayData === null) continue;
          const key = tickArrayKeys[index].toString();
          tickArrayLayout[key] = TickArrayLayout.decode(tickArrayData.data);
        }

        for (const { state, positionAccount } of pools) {
          if (!positionAccount) continue;
          for (const itemPA of positionAccount) {
            const keyLower = `${state.programId.toString()}-${state.id.toString()}-${itemPA.tickLower}`;
            const keyUpper = `${state.programId.toString()}-${state.id.toString()}-${itemPA.tickUpper}`;
            const tickArrayLower = tickArrayLayout[keyToTickArrayAddress[keyLower].toString()];
            const tickArrayUpper = tickArrayLayout[keyToTickArrayAddress[keyUpper].toString()];
            const tickLowerState: Tick =
              tickArrayLower.ticks[TickUtils.getTickOffsetInArray(itemPA.tickLower, state.tickSpacing)];
            const tickUpperState: Tick =
              tickArrayUpper.ticks[TickUtils.getTickOffsetInArray(itemPA.tickUpper, state.tickSpacing)];
            const { tokenFeeAmountA, tokenFeeAmountB } = await PositionUtils.GetPositionFees(
              state,
              itemPA,
              tickLowerState,
              tickUpperState,
            );
            const rewardInfos = await PositionUtils.GetPositionRewards(state, itemPA, tickLowerState, tickUpperState);
            itemPA.tokenFeeAmountA = tokenFeeAmountA.gte(new BN(0)) ? tokenFeeAmountA : new BN(0);
            itemPA.tokenFeeAmountB = tokenFeeAmountB.gte(new BN(0)) ? tokenFeeAmountB : new BN(0);
            for (let i = 0; i < rewardInfos.length; i++) {
              itemPA.rewardInfos[i].pendingReward = rewardInfos[i].gte(new BN(0)) ? rewardInfos[i] : new BN(0);
            }
          }
        }
      }
    }
    return pools;
  }

  static computeAmountOut({
    poolInfo,
    tickArrayCache,
    baseMint,
    epochInfo,
    amountIn,
    slippage,
    priceLimit = new Decimal(0),
    catchLiquidityInsufficient = false,
  }: {
    poolInfo: ComputeClmmPoolInfo;
    tickArrayCache: { [key: string]: TickArray };
    baseMint: PublicKey;

    epochInfo: EpochInfo;

    amountIn: BN;
    slippage: number;
    priceLimit?: Decimal;
    catchLiquidityInsufficient: boolean;
  }): ReturnTypeComputeAmountOut {
    let sqrtPriceLimitX64: BN;
    const isBaseIn = baseMint.toBase58() === poolInfo.mintA.address;
    const [baseFeeConfig, outFeeConfig] = isBaseIn
      ? [poolInfo.mintA.extensions.feeConfig, poolInfo.mintB.extensions.feeConfig]
      : [poolInfo.mintB.extensions.feeConfig, poolInfo.mintA.extensions.feeConfig];

    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = isBaseIn ? MIN_SQRT_PRICE_X64.add(new BN(1)) : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
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
      realAmountIn.amount.sub(realAmountIn.fee ?? ZERO),
      sqrtPriceLimitX64,
      catchLiquidityInsufficient,
    );

    const amountOut = getTransferAmountFeeV2(_expectedAmountOut, outFeeConfig, epochInfo, false);

    const _executionPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      _executionPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
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
    catchLiquidityInsufficient = false,
  }: {
    poolInfo: ComputeClmmPoolInfo;
    tickArrayCache: { [key: string]: TickArray };
    amountIn: BN;
    tokenOut: ApiV3Token;
    slippage: number;
    epochInfo: EpochInfo;
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
  }: {
    poolInfo: ComputeClmmPoolInfo;
    tickArrayCache: { [key: string]: TickArray };
    baseMint: PublicKey;

    epochInfo: EpochInfo;

    amountOut: BN;
    slippage: number;
    priceLimit?: Decimal;
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
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
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
      realAmountOut.amount.sub(realAmountOut.fee ?? ZERO),
      sqrtPriceLimitX64,
    );

    const inMint = isBaseIn ? poolInfo.mintB.address : poolInfo.mintA.address;

    const amountIn = getTransferAmountFeeV2(_expectedAmountIn, feeConfigs[inMint], epochInfo, false);
    // const amountIn = getTransferAmountFee(
    //   _expectedAmountIn,
    //   token2022Infos[inMint.toString()]?.feeConfig,
    //   epochInfo,
    //   true,
    // );

    const _executionPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      _executionPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const executionPrice = isBaseIn ? _executionPrice : new Decimal(1).div(_executionPrice);

    const _maxAmountIn = _expectedAmountIn
      .mul(new BN(Math.floor((1 + slippage) * 10000000000)))
      .div(new BN(10000000000));
    // const maxAmountIn = getTransferAmountFee(
    //   _maxAmountIn,
    //   token2022Infos[inMint.toString()]?.feeConfig,
    //   epochInfo,
    //   true,
    // );
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

    const priceLower = TickUtils.getTickPrice({
      poolInfo,
      tick: positionTickLowerIndex,
      baseIn: true,
    }).price.toNumber();
    const priceUpper = TickUtils.getTickPrice({
      poolInfo,
      tick: positionTickUpperIndex,
      baseIn: true,
    }).price.toNumber();

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

    const sqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(poolInfo.price),
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(positionTickLowerIndex);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(positionTickUpperIndex);

    const { amountSlippageA: poolLiquidityA, amountSlippageB: poolLiquidityB } =
      LiquidityMath.getAmountsFromLiquidityWithSlippage(
        sqrtPriceX64,
        sqrtPriceX64A,
        sqrtPriceX64B,
        poolLiquidity,
        false,
        false,
        0,
      );

    const { amountSlippageA: userLiquidityA, amountSlippageB: userLiquidityB } =
      LiquidityMath.getAmountsFromLiquidityWithSlippage(
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
    const sqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(poolInfo.price),
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(tickLower);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(tickUpper);

    // const coefficient = add ? 1 - slippage : 1 + slippage;
    const addFeeAmount = getTransferAmountFeeV2(
      amount,
      poolInfo[inputA ? "mintA" : "mintB"].extensions?.feeConfig,
      epochInfo,
      !amountHasFee,
    );
    const _amount = new BN(
      new Decimal(addFeeAmount.amount.sub(addFeeAmount.fee ?? ZERO).toString()).toFixed(0) // .mul(coefficient).toFixed(0),
    );

    let liquidity: BN;
    if (sqrtPriceX64.lte(sqrtPriceX64A)) {
      liquidity = inputA
        ? LiquidityMath.getLiquidityFromTokenAmountA(sqrtPriceX64A, sqrtPriceX64B, _amount, !add)
        : new BN(0);
    } else if (sqrtPriceX64.lte(sqrtPriceX64B)) {
      const liquidity0 = LiquidityMath.getLiquidityFromTokenAmountA(sqrtPriceX64, sqrtPriceX64B, _amount, !add);
      const liquidity1 = LiquidityMath.getLiquidityFromTokenAmountB(sqrtPriceX64A, sqrtPriceX64, _amount);
      liquidity = inputA ? liquidity0 : liquidity1;
    } else {
      liquidity = inputA
        ? new BN(0)
        : LiquidityMath.getLiquidityFromTokenAmountB(sqrtPriceX64A, sqrtPriceX64B, _amount);
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
    }
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
    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(tickLower);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(tickUpper);

    const coefficientRe = add ? 1 + slippage : 1 - slippage;

    const amounts = LiquidityMath.getAmountsFromLiquidity(
      SqrtPriceMath.priceToSqrtPriceX64(new Decimal(poolInfo.price), poolInfo.mintA.decimals, poolInfo.mintB.decimals),
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

    return poolList.reduce(
      (acc, cur) => ({
        ...acc,
        [cur.id]: {
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
}

export function getLiquidityFromAmounts({
  poolInfo,
  tickLower,
  tickUpper,
  amountA,
  amountB,
  slippage,
  add,
  epochInfo,
  amountHasFee,
}: {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  tickLower: number;
  tickUpper: number;
  amountA: BN;
  amountB: BN;
  slippage: number;
  add: boolean;
  epochInfo: EpochInfo;
  amountHasFee: boolean;
}): ReturnTypeGetLiquidityAmountOut {
  const [_tickLower, _tickUpper, _amountA, _amountB] =
    tickLower < tickUpper ? [tickLower, tickUpper, amountA, amountB] : [tickUpper, tickLower, amountB, amountA];
  const sqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
    new Decimal(poolInfo.price),
    poolInfo.mintA.decimals,
    poolInfo.mintB.decimals,
  );
  const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(_tickLower);
  const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(_tickUpper);

  const [amountFeeA, amountFeeB] = [
    getTransferAmountFeeV2(_amountA, poolInfo.mintA.extensions?.feeConfig, epochInfo, !amountHasFee),
    getTransferAmountFeeV2(_amountB, poolInfo.mintB.extensions?.feeConfig, epochInfo, !amountHasFee),
  ];

  const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
    sqrtPriceX64,
    sqrtPriceX64A,
    sqrtPriceX64B,
    amountFeeA.amount.sub(amountFeeA.fee ?? ZERO),
    amountFeeB.amount.sub(amountFeeB.fee ?? ZERO),
  );

  return LiquidityMath.getAmountsOutFromLiquidity({
    poolInfo,
    tickLower,
    tickUpper,
    liquidity,
    slippage,
    add,
    epochInfo,
    amountAddFee: !amountHasFee,
  });
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
