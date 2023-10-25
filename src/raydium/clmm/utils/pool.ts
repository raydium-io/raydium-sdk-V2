import { PublicKey, Connection, EpochInfo } from "@solana/web3.js";
import BN from "bn.js";

import {
  ClmmPoolInfo,
  ClmmPoolRewardInfo,
  ClmmPoolRewardLayoutInfo,
  ReturnTypeGetLiquidityAmountOut,
  TickArrayBitmapExtension,
  ReturnTypeFetchExBitmaps,
  ReturnTypeFetchMultiplePoolTickArrays,
  SDKParsedConcentratedInfo,
  ReturnTypeComputeAmountOut,
  ReturnTypeComputeAmountOutFormat,
} from "../type";

import { ApiV3PoolInfoConcentratedItem } from "@/api/type";

import { ReturnTypeFetchMultipleMintInfos } from "@/raydium/type";
import { NEGATIVE_ONE, Q64, ZERO, MAX_TICK, MIN_TICK, MIN_SQRT_PRICE_X64, MAX_SQRT_PRICE_X64 } from "./constants";
import { MathUtil, SwapMath, SqrtPriceMath, LiquidityMath } from "./math";
import { getPdaTickArrayAddress, getPdaExBitmapAccount, getPdaPersonalPositionAddress } from "./pda";
import { TickArray, TickUtils, TICK_ARRAY_BITMAP_SIZE, Tick } from "./tick";
import { TickArrayBitmap, TickArrayBitmapExtensionUtils } from "./tickarrayBitmap";
import { TickQuery } from "./tickQuery";
import { TickArrayBitmapExtensionLayout, PoolInfoLayout, PositionInfoLayout, TickArrayLayout } from "../layout";
import {
  getMultipleAccountsInfo,
  getMultipleAccountsInfoWithCustomFlags,
  getTransferAmountFee,
  getTransferAmountFeeV2,
  minExpirationTime,
  WSOLMint,
  SOLMint,
  getEpochInfo,
  solToWSol,
} from "../../../common";
import { SOL_INFO } from "../../token/constant";
import { TokenAccountRaw } from "../../account/types";
import { splAccountLayout } from "../../account/layout";
import { Price, Percent, TokenAmount, Token } from "../../../module";
import { PositionUtils } from "./position";
import Decimal from "decimal.js";

export class PoolUtils {
  public static getOutputAmountAndRemainAccounts(
    poolInfo: ClmmPoolInfo,
    tickArrayCache: { [key: string]: TickArray },
    inputTokenMint: PublicKey,
    inputAmount: BN,
    sqrtPriceLimitX64?: BN,
  ): {
    expectedAmountOut: BN;
    remainingAccounts: PublicKey[];
    executionPrice: BN;
    feeAmount: BN;
  } {
    const zeroForOne = inputTokenMint.equals(poolInfo.mintA.mint);

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
    );
    allNeededAccounts.push(...reaminAccounts);
    return {
      expectedAmountOut: outputAmount.mul(NEGATIVE_ONE),
      remainingAccounts: allNeededAccounts,
      executionPrice,
      feeAmount,
    };
  }

  public static getInputAmountAndRemainAccounts(
    poolInfo: ClmmPoolInfo,
    tickArrayCache: { [key: string]: TickArray },
    outputTokenMint: PublicKey,
    outputAmount: BN,
    sqrtPriceLimitX64?: BN,
  ): { expectedAmountIn: BN; remainingAccounts: PublicKey[]; executionPrice: BN; feeAmount: BN } {
    const zeroForOne = outputTokenMint.equals(poolInfo.mintB.mint);

    const allNeededAccounts: PublicKey[] = [];
    const {
      isExist,
      startIndex: firstTickArrayStartIndex,
      nextAccountMeta,
    } = this.getFirstInitializedTickArray(poolInfo, zeroForOne);
    if (!isExist || firstTickArrayStartIndex === undefined || !nextAccountMeta) throw new Error("Invalid tick array");

    try {
      const preTick = this.preInitializedTickArrayStartIndex(poolInfo, !zeroForOne);
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
    poolInfo: ClmmPoolInfo,
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
    poolInfo: ClmmPoolInfo,
    zeroForOne: boolean,
  ): { isExist: boolean; nextStartIndex: number } {
    const currentOffset =
      Math.floor(poolInfo.tickCurrent / TickQuery.tickCount(poolInfo.tickSpacing)) *
      TickQuery.tickCount(poolInfo.tickSpacing);
    const result: number[] = zeroForOne
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
          exBitmapInfo: TickArrayBitmapExtension;
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
      maxTickBoundary = MAX_TICK;
    }
    if (minTickBoundary < MIN_TICK) {
      minTickBoundary = MIN_TICK;
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

  // deprecated, new api doesn't need
  // static async fetchMultiplePoolInfos({
  //   connection,
  //   poolKeys,
  //   ownerInfo,
  //   chainTime,
  //   batchRequest = false,
  //   updateOwnerRewardAndFee = true,
  // }: {
  //   connection: Connection;
  //   poolKeys: ApiV3PoolInfoConcentratedItem[];
  //   ownerInfo?: { wallet: PublicKey; tokenAccounts: TokenAccountRaw[] };
  //   chainTime: number;
  //   batchRequest?: boolean;
  //   updateOwnerRewardAndFee?: boolean;
  // }): Promise<ReturnTypeFetchMultiplePoolInfos> {
  //   const poolAccountInfos = await getMultipleAccountsInfo(
  //     connection,
  //     poolKeys.map((i) => new PublicKey(i.id)),
  //     { batchRequest },
  //   );
  //   const exBitmapAddress: { [poolId: string]: PublicKey } = {};
  //   for (let index = 0; index < poolKeys.length; index++) {
  //     const apiPoolInfo = poolKeys[index];
  //     const accountInfo = poolAccountInfos[index];

  //     if (accountInfo === null) continue;
  //     exBitmapAddress[apiPoolInfo.id] = getPdaExBitmapAccount(
  //       accountInfo.owner,
  //       new PublicKey(apiPoolInfo.id),
  //     ).publicKey;
  //   }

  //   const exBitmapAccountInfos = await this.fetchExBitmaps({
  //     connection,
  //     exBitmapAddress: Object.values(exBitmapAddress),
  //     batchRequest,
  //   });

  //   const programIds: PublicKey[] = [];

  //   const poolsInfo: ReturnTypeFetchMultiplePoolInfos = {};

  //   const updateRewardInfos: ClmmPoolRewardInfo[] = [];

  //   for (let index = 0; index < poolKeys.length; index++) {
  //     const apiPoolInfo = poolKeys[index];
  //     const accountInfo = poolAccountInfos[index];
  //     const exBitmapInfo = exBitmapAccountInfos[exBitmapAddress[apiPoolInfo.id].toString()];

  //     if (accountInfo === null) continue;

  //     const layoutAccountInfo = PoolInfoLayout.decode(accountInfo.data);
  //     poolsInfo[apiPoolInfo.id] = {
  //       state: {
  //         id: new PublicKey(apiPoolInfo.id),
  //         mintA: {
  //           programId: new PublicKey(apiPoolInfo.mintA.programId),
  //           mint: layoutAccountInfo.mintA,
  //           vault: layoutAccountInfo.vaultA,
  //           decimals: layoutAccountInfo.mintDecimalsA,
  //         },
  //         mintB: {
  //           programId: new PublicKey(apiPoolInfo.mintB.programId),
  //           mint: layoutAccountInfo.mintB,
  //           vault: layoutAccountInfo.vaultB,
  //           decimals: layoutAccountInfo.mintDecimalsB,
  //         },
  //         observationId: layoutAccountInfo.observationId,
  //         ammConfig: {
  //           ...apiPoolInfo.config,
  //           fundOwner: apiPoolInfo.config.id,
  //           id: new PublicKey(apiPoolInfo.config.id),
  //         },

  //         creator: layoutAccountInfo.creator,
  //         programId: accountInfo.owner,
  //         version: 6,

  //         tickSpacing: layoutAccountInfo.tickSpacing,
  //         liquidity: layoutAccountInfo.liquidity,
  //         sqrtPriceX64: layoutAccountInfo.sqrtPriceX64,
  //         currentPrice: SqrtPriceMath.sqrtPriceX64ToPrice(
  //           layoutAccountInfo.sqrtPriceX64,
  //           layoutAccountInfo.mintDecimalsA,
  //           layoutAccountInfo.mintDecimalsB,
  //         ),
  //         tickCurrent: layoutAccountInfo.tickCurrent,
  //         observationIndex: layoutAccountInfo.observationIndex,
  //         observationUpdateDuration: layoutAccountInfo.observationUpdateDuration,
  //         feeGrowthGlobalX64A: layoutAccountInfo.feeGrowthGlobalX64A,
  //         feeGrowthGlobalX64B: layoutAccountInfo.feeGrowthGlobalX64B,
  //         protocolFeesTokenA: layoutAccountInfo.protocolFeesTokenA,
  //         protocolFeesTokenB: layoutAccountInfo.protocolFeesTokenB,
  //         swapInAmountTokenA: layoutAccountInfo.swapInAmountTokenA,
  //         swapOutAmountTokenB: layoutAccountInfo.swapOutAmountTokenB,
  //         swapInAmountTokenB: layoutAccountInfo.swapInAmountTokenB,
  //         swapOutAmountTokenA: layoutAccountInfo.swapOutAmountTokenA,
  //         tickArrayBitmap: layoutAccountInfo.tickArrayBitmap,

  //         rewardInfos: await PoolUtils.updatePoolRewardInfos({
  //           connection,
  //           apiPoolInfo,
  //           chainTime,
  //           poolLiquidity: layoutAccountInfo.liquidity,
  //           rewardInfos: layoutAccountInfo.rewardInfos.filter((i) => !i.tokenMint.equals(PublicKey.default)),
  //         }),

  //         day: apiPoolInfo.day,
  //         week: apiPoolInfo.week,
  //         month: apiPoolInfo.month,
  //         tvl: apiPoolInfo.tvl,
  //         lookupTableAccount: new PublicKey(apiPoolInfo.lookupTableAccount),

  //         startTime: layoutAccountInfo.startTime.toNumber(),

  //         exBitmapInfo,
  //       },
  //     };

  //     if (ownerInfo) {
  //       updateRewardInfos.push(
  //         ...poolsInfo[apiPoolInfo.id].state.rewardInfos.filter((i) => i.creator.equals(ownerInfo.wallet)),
  //       );
  //     }

  //     if (!programIds.find((i) => i.equals(accountInfo.owner))) programIds.push(accountInfo.owner);
  //   }

  //   if (ownerInfo) {
  //     const allMint = ownerInfo.tokenAccounts
  //       .filter((i) => i.accountInfo.amount.eq(new BN(1)))
  //       .map((i) => i.accountInfo.mint);
  //     const allPositionKey: PublicKey[] = [];
  //     for (const itemMint of allMint) {
  //       for (const itemProgramId of programIds) {
  //         allPositionKey.push(getPdaPersonalPositionAddress(itemProgramId, itemMint).publicKey);
  //       }
  //     }
  //     const positionAccountInfos = await getMultipleAccountsInfo(connection, allPositionKey, { batchRequest });

  //     const keyToTickArrayAddress: { [key: string]: PublicKey } = {};
  //     for (const itemAccountInfo of positionAccountInfos) {
  //       if (itemAccountInfo === null) continue;
  //       const position = PositionInfoLayout.decode(itemAccountInfo.data);
  //       const itemPoolId = position.poolId.toString();
  //       const poolInfoA = poolsInfo[itemPoolId];
  //       if (poolInfoA === undefined) continue;

  //       const poolInfo = poolInfoA.state;

  //       const priceLower = TickUtils._getTickPriceLegacy({
  //         poolInfo,
  //         tick: position.tickLower,
  //         baseIn: true,
  //       });
  //       const priceUpper = TickUtils._getTickPriceLegacy({
  //         poolInfo,
  //         tick: position.tickUpper,
  //         baseIn: true,
  //       });
  //       const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
  //         poolInfo.sqrtPriceX64,
  //         priceLower.tickSqrtPriceX64,
  //         priceUpper.tickSqrtPriceX64,
  //         position.liquidity,
  //         false,
  //       );

  //       const leverage = 1 / (1 - Math.sqrt(Math.sqrt(priceLower.price.div(priceUpper.price).toNumber())));

  //       poolsInfo[itemPoolId].positionAccount = [
  //         ...(poolsInfo[itemPoolId].positionAccount ?? []),
  //         {
  //           poolId: position.poolId,
  //           nftMint: position.nftMint,

  //           priceLower: priceLower.price,
  //           priceUpper: priceUpper.price,
  //           amountA,
  //           amountB,
  //           tickLower: position.tickLower,
  //           tickUpper: position.tickUpper,
  //           liquidity: position.liquidity,
  //           feeGrowthInsideLastX64A: position.feeGrowthInsideLastX64A,
  //           feeGrowthInsideLastX64B: position.feeGrowthInsideLastX64B,
  //           tokenFeesOwedA: position.tokenFeesOwedA,
  //           tokenFeesOwedB: position.tokenFeesOwedB,
  //           rewardInfos: position.rewardInfos.map((i) => ({
  //             ...i,
  //             pendingReward: new BN(0),
  //           })),

  //           leverage,
  //           tokenFeeAmountA: new BN(0),
  //           tokenFeeAmountB: new BN(0),
  //         },
  //       ];

  //       const tickArrayLowerAddress = TickUtils.getTickArrayAddressByTick(
  //         poolsInfo[itemPoolId].state.programId,
  //         position.poolId,
  //         position.tickLower,
  //         poolsInfo[itemPoolId].state.tickSpacing,
  //       );
  //       const tickArrayUpperAddress = TickUtils.getTickArrayAddressByTick(
  //         poolsInfo[itemPoolId].state.programId,
  //         position.poolId,
  //         position.tickUpper,
  //         poolsInfo[itemPoolId].state.tickSpacing,
  //       );
  //       keyToTickArrayAddress[
  //         `${poolsInfo[itemPoolId].state.programId.toString()}-${position.poolId.toString()}-${position.tickLower}`
  //       ] = tickArrayLowerAddress;
  //       keyToTickArrayAddress[
  //         `${poolsInfo[itemPoolId].state.programId.toString()}-${position.poolId.toString()}-${position.tickUpper}`
  //       ] = tickArrayUpperAddress;
  //     }

  //     if (updateOwnerRewardAndFee) {
  //       const tickArrayKeys = Object.values(keyToTickArrayAddress);
  //       const tickArrayDatas = await getMultipleAccountsInfo(connection, tickArrayKeys, { batchRequest });
  //       const tickArrayLayout: { [key: string]: TickArray } = {};
  //       for (let index = 0; index < tickArrayKeys.length; index++) {
  //         const tickArrayData = tickArrayDatas[index];
  //         if (tickArrayData === null) continue;
  //         const key = tickArrayKeys[index];
  //         tickArrayLayout[key.toString()] = {
  //           address: key,
  //           ...TickArrayLayout.decode(tickArrayData.data),
  //         };
  //       }

  //       for (const { state, positionAccount } of Object.values(poolsInfo)) {
  //         if (!positionAccount) continue;
  //         for (const itemPA of positionAccount) {
  //           const keyLower = `${state.programId.toString()}-${state.id.toString()}-${itemPA.tickLower}`;
  //           const keyUpper = `${state.programId.toString()}-${state.id.toString()}-${itemPA.tickUpper}`;
  //           const tickArrayLower = tickArrayLayout[keyToTickArrayAddress[keyLower].toString()];
  //           const tickArrayUpper = tickArrayLayout[keyToTickArrayAddress[keyUpper].toString()];
  //           const tickLowerState: Tick =
  //             tickArrayLower.ticks[TickUtils.getTickOffsetInArray(itemPA.tickLower, state.tickSpacing)];
  //           const tickUpperState: Tick =
  //             tickArrayUpper.ticks[TickUtils.getTickOffsetInArray(itemPA.tickUpper, state.tickSpacing)];
  //           const { tokenFeeAmountA, tokenFeeAmountB } = PositionUtils.GetPositionFees(
  //             state,
  //             itemPA,
  //             tickLowerState,
  //             tickUpperState,
  //           );
  //           const rewardInfos = PositionUtils.GetPositionRewards(state, itemPA, tickLowerState, tickUpperState);
  //           itemPA.tokenFeeAmountA = tokenFeeAmountA.gte(ZERO) ? tokenFeeAmountA : ZERO;
  //           itemPA.tokenFeeAmountB = tokenFeeAmountB.gte(ZERO) ? tokenFeeAmountB : ZERO;
  //           for (let i = 0; i < rewardInfos.length; i++) {
  //             itemPA.rewardInfos[i].pendingReward = rewardInfos[i].gte(ZERO) ? rewardInfos[i] : ZERO;
  //           }
  //         }
  //       }
  //     }
  //   }

  //   if (updateRewardInfos.length > 0) {
  //     const vaults = updateRewardInfos.map((i) => i.tokenVault);
  //     const rewardVaultInfos = await getMultipleAccountsInfo(connection, vaults, { batchRequest });
  //     const rewardVaultAmount: { [mint: string]: BN } = {};
  //     for (let index = 0; index < vaults.length; index++) {
  //       const valutKey = vaults[index].toString();
  //       const itemRewardVaultInfo = rewardVaultInfos[index];
  //       if (itemRewardVaultInfo === null) continue;
  //       const info = splAccountLayout.decode(itemRewardVaultInfo.data);
  //       rewardVaultAmount[valutKey] = info.amount;
  //     }
  //     for (const item of updateRewardInfos) {
  //       const vaultAmount = rewardVaultAmount[item.tokenVault.toString()];
  //       item.remainingRewards =
  //         vaultAmount !== undefined ? vaultAmount.sub(item.rewardTotalEmissioned.sub(item.rewardClaimed)) : ZERO;
  //     }
  //   }

  //   return poolsInfo;
  // }

  static async fetchMultiplePoolTickArrays({
    connection,
    poolKeys,
    batchRequest,
  }: {
    connection: Connection;
    poolKeys: ClmmPoolInfo[];
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
    token2022Infos,
    epochInfo,
    amountIn,
    slippage,
    priceLimit = new Decimal(0),
  }: {
    poolInfo: ClmmPoolInfo;
    tickArrayCache: { [key: string]: TickArray };
    baseMint: PublicKey;

    token2022Infos: ReturnTypeFetchMultipleMintInfos;
    epochInfo: EpochInfo;

    amountIn: BN;
    slippage: number;
    priceLimit?: Decimal;
  }): ReturnTypeComputeAmountOut {
    let sqrtPriceLimitX64: BN;
    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = baseMint.equals(poolInfo.mintA.mint)
        ? MIN_SQRT_PRICE_X64.add(new BN(1))
        : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const realAmountIn = getTransferAmountFee(
      amountIn,
      token2022Infos[baseMint.toString()]?.feeConfig,
      epochInfo,
      false,
    );

    const {
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
    );

    const outMint = poolInfo.mintA.mint.equals(baseMint) ? poolInfo.mintB.mint : poolInfo.mintA.mint;
    const amountOut = getTransferAmountFee(
      _expectedAmountOut,
      token2022Infos[outMint.toString()]?.feeConfig,
      epochInfo,
      false,
    );

    const _executionPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      _executionPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const executionPrice = baseMint.equals(poolInfo.mintA.mint) ? _executionPrice : new Decimal(1).div(_executionPrice);

    const _minAmountOut = _expectedAmountOut
      .mul(new BN(Math.floor((1 - slippage) * 10000000000)))
      .div(new BN(10000000000));
    const minAmountOut = getTransferAmountFee(
      _minAmountOut,
      token2022Infos[outMint.toString()]?.feeConfig,
      epochInfo,
      false,
    );

    const poolPrice = poolInfo.mintA.mint.equals(baseMint)
      ? poolInfo.currentPrice
      : new Decimal(1).div(poolInfo.currentPrice);

    const _numerator = new Decimal(executionPrice).sub(poolPrice).abs();
    const _denominator = poolPrice;
    const priceImpact = new Percent(
      new Decimal(_numerator).mul(10 ** 15).toFixed(0),
      new Decimal(_denominator).mul(10 ** 15).toFixed(0),
    );

    return {
      realAmountIn,
      amountOut,
      minAmountOut,
      expirationTime: minExpirationTime(realAmountIn.expirationTime, amountOut.expirationTime),
      currentPrice: poolInfo.currentPrice,
      executionPrice,
      priceImpact,
      fee: feeAmount,

      remainingAccounts,
    };
  }

  static async computeAmountOutFormat({
    poolInfo,
    tickArrayCache,
    token2022Infos,
    amountIn,
    tokenOut: _tokenOut,
    slippage,
    epochInfo,
  }: {
    poolInfo: ClmmPoolInfo;
    tickArrayCache: { [key: string]: TickArray };
    token2022Infos: ReturnTypeFetchMultipleMintInfos;
    amountIn: TokenAmount;
    tokenOut: Token;
    slippage: Percent;
    epochInfo: EpochInfo;
  }): Promise<ReturnTypeComputeAmountOutFormat> {
    const inputMint = amountIn.token.equals(Token.WSOL) ? WSOLMint : amountIn.token.mint;
    const _slippage = slippage.numerator.toNumber() / slippage.denominator.toNumber();
    const tokenOut = _tokenOut.mint.equals(SOLMint)
      ? new Token({ mint: "sol", decimals: SOL_INFO.decimals })
      : _tokenOut;

    const {
      realAmountIn: _realAmountIn,
      amountOut: _amountOut,
      minAmountOut: _minAmountOut,
      expirationTime,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
      remainingAccounts,
    } = await PoolUtils.computeAmountOut({
      poolInfo,
      tickArrayCache,
      baseMint: inputMint,
      amountIn: amountIn.raw,
      slippage: _slippage,
      token2022Infos,
      epochInfo,
    });

    const realAmountIn = {
      ..._realAmountIn,
      amount: new TokenAmount(amountIn.token, _realAmountIn.amount),
      fee: _realAmountIn.fee === undefined ? undefined : new TokenAmount(amountIn.token, _realAmountIn.fee),
    };

    const amountOut = {
      ..._amountOut,
      amount: new TokenAmount(tokenOut, _amountOut.amount),
      fee: _amountOut.fee === undefined ? undefined : new TokenAmount(tokenOut, _amountOut.fee),
    };
    const minAmountOut = {
      ..._minAmountOut,
      amount: new TokenAmount(tokenOut, _minAmountOut.amount),
      fee: _minAmountOut.fee === undefined ? undefined : new TokenAmount(tokenOut, _minAmountOut.fee),
    };

    const _currentPrice = new Price({
      baseToken: amountIn.token,
      denominator: new BN(10).pow(new BN(20 + amountIn.token.decimals)),
      quoteToken: tokenOut,
      numerator: currentPrice.mul(new Decimal(10 ** (20 + tokenOut.decimals))).toFixed(0),
    });
    const _executionPrice = new Price({
      baseToken: amountIn.token,
      denominator: new BN(10).pow(new BN(20 + amountIn.token.decimals)),
      quoteToken: tokenOut,
      numerator: executionPrice.mul(new Decimal(10 ** (20 + tokenOut.decimals))).toFixed(0),
    });
    const _fee = new TokenAmount(amountIn.token, fee);

    return {
      realAmountIn,
      amountOut,
      minAmountOut,
      expirationTime,
      currentPrice: _currentPrice,
      executionPrice: _executionPrice,
      priceImpact,
      fee: _fee,
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
      rewardsApr: [aprInfo.rewardApr[0] ?? 0 * p, aprInfo.rewardApr[1] ?? 0 * p, aprInfo.rewardApr[2] ?? 0 * p],
      apr: aprInfo.apr * p,
    };
  }

  static estimateAprsForPriceRangeDelta({
    poolInfo,
    aprType,
    mintPrice,
    rewardMintDecimals,
    liquidity,
    positionTickLowerIndex,
    positionTickUpperIndex,
    chainTime,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    aprType: "day" | "week" | "month";

    mintPrice: { [mint: string]: Price };

    rewardMintDecimals: { [mint: string]: number };

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
        new BN(0), // to do
        // poolInfo.liquidity,
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
      .mul(mintPriceA.toFixed(mintDecimalsA))
      .add(
        new Decimal(poolLiquidityB.toString())
          .div(new Decimal(10).pow(mintDecimalsB))
          .mul(mintPriceB.toFixed(mintDecimalsB)),
      );
    const userTvl = new Decimal(userLiquidityA.toString())
      .div(new Decimal(10).pow(mintDecimalsA))
      .mul(mintPriceA.toFixed(mintDecimalsA))
      .add(
        new Decimal(userLiquidityB.toString())
          .div(new Decimal(10).pow(mintDecimalsB))
          .mul(mintPriceB.toFixed(mintDecimalsB)),
      );

    const p = userTvl.div(poolTvl.add(userTvl)).div(userTvl);

    const feesPerYear = new Decimal(aprInfo.volumeFee).mul(365).div(aprTypeDay);
    const feeApr = feesPerYear.mul(p).mul(100).toNumber();

    const SECONDS_PER_YEAR = 3600 * 24 * 365;

    const rewardsApr = poolInfo.rewardDefaultInfos.map((i) => {
      const iDecimal = rewardMintDecimals[i.mint.address];
      const iPrice = mintPrice[i.mint.address];

      if (
        chainTime < ((i as any).startTime ?? 0) ||
        chainTime > ((i as any).endTime ?? 0) ||
        !i.perSecond ||
        !iPrice ||
        iDecimal === undefined
      )
        return 0;

      return new Decimal(iPrice.toFixed(iDecimal))
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

  static getLiquidityAmountOutFromAmountIn({
    connection,
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
    connection: Connection;
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

    const coefficient = add ? 1 - slippage : 1 + slippage;
    const addFeeAmount = getTransferAmountFeeV2(
      amount,
      poolInfo[inputA ? "mintA" : "mintB"].extensions.feeConfig,
      epochInfo,
      !amountHasFee,
    );
    const _amount = addFeeAmount.amount.sub(addFeeAmount.fee ?? ZERO).muln(coefficient);

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

    return PoolUtils.getAmountsFromLiquidity({
      connection,
      poolInfo,
      tickLower,
      tickUpper,
      liquidity,
      slippage,
      add,
    });
  }

  static async getAmountsFromLiquidity({
    connection,
    poolInfo,
    tickLower,
    tickUpper,
    liquidity,
    slippage,
    add,
  }: {
    connection: Connection;
    poolInfo: ApiV3PoolInfoConcentratedItem;
    tickLower: number;
    tickUpper: number;
    liquidity: BN;
    slippage: number;
    add: boolean;
  }): Promise<ReturnTypeGetLiquidityAmountOut> {
    const epochInfo = await getEpochInfo(connection);

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
      getTransferAmountFeeV2(amounts.amountA, poolInfo.mintA.extensions.feeConfig, epochInfo, true),
      getTransferAmountFeeV2(amounts.amountB, poolInfo.mintB.extensions.feeConfig, epochInfo, true),
    ];
    const [amountSlippageA, amountSlippageB] = [
      getTransferAmountFeeV2(amounts.amountA.muln(coefficientRe), poolInfo.mintA.extensions.feeConfig, epochInfo, true),
      getTransferAmountFeeV2(amounts.amountB.muln(coefficientRe), poolInfo.mintB.extensions.feeConfig, epochInfo, true),
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
}

export function getLiquidityFromAmounts({
  poolInfo,
  tickLower,
  tickUpper,
  amountA,
  amountB,
  slippage,
  add,
  token2022Infos,
  epochInfo,
}: {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  tickLower: number;
  tickUpper: number;
  amountA: BN;
  amountB: BN;
  slippage: number;
  add: boolean;
  token2022Infos: ReturnTypeFetchMultipleMintInfos;
  epochInfo: EpochInfo;
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

  const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
    sqrtPriceX64,
    sqrtPriceX64A,
    sqrtPriceX64B,
    _amountA,
    _amountB,
  );

  return LiquidityMath.getAmountsOutFromLiquidity({
    poolInfo,
    tickLower,
    tickUpper,
    liquidity,
    slippage,
    add,
    token2022Infos,
    epochInfo,
  });
}
