import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { toTokenInfo } from "../token/utils";
import {
  toPercent,
  toFraction,
  decimalToFraction,
  toUsdCurrency,
  BigNumberish,
  recursivelyDecimalToFraction,
} from "../../common/bignumber";
import { InstructionType, WSOLMint, getATAAddress, getTransferAmountFee } from "../../common";
import { add, mul, div } from "../../common/fractionUtil";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { TokenAmount } from "../../module/amount";
import { Percent } from "../../module/percent";
import { mockCreatePoolInfo, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64, ONE, ZERO } from "./utils/constants";
import { LiquidityMath, SqrtPriceMath } from "./utils/math";
import { PoolUtils } from "./utils/pool";
import { PositionUtils } from "./utils/position";
import {
  CreateConcentratedPool,
  ClmmPoolInfo,
  ApiClmmPoolInfo,
  UserPositionAccount,
  HydratedConcentratedInfo,
  SDKParsedConcentratedInfo,
  IncreasePositionFromLiquidity,
  IncreasePositionFromBase,
  DecreaseLiquidity,
  ClmmPoolPersonalPosition,
  OpenPositionFromBase,
  OpenPositionFromLiquidity,
  ReturnTypeGetAmountsFromLiquidity,
  SwapInParams,
  GetAmountParams,
  InitRewardParams,
  InitRewardsParams,
  SetRewardParams,
  SetRewardsParams,
  CollectRewardParams,
  CollectRewardsParams,
  HarvestAllRewardsParams,
  ReturnTypeComputeAmountOutBaseOut,
} from "./type";
import { ClmmInstrument } from "./instrument";
import { LoadParams, MakeTransaction, MakeMultiTransaction, ReturnTypeFetchMultipleMintInfos } from "../type";
import { MathUtil } from "./utils/math";
import { TickArray } from "./utils/tick";
import { getPdaOperationAccount } from "./utils/pda";
import { OperationLayout } from "./layout";
import BN from "bn.js";
import { EXTENSION_TICKARRAY_BITMAP_SIZE } from "./utils/tickarrayBitmap";

export class Clmm extends ModuleBase {
  private _clmmPools: ApiClmmPoolInfo[] = [];
  private _clmmPoolMap: Map<string, ApiClmmPoolInfo> = new Map();
  private _clmmSdkParsedPools: SDKParsedConcentratedInfo[] = [];
  private _clmmSdkParsedPoolMap: Map<string, SDKParsedConcentratedInfo> = new Map();
  private _hydratedClmmPools: HydratedConcentratedInfo[] = [];
  private _hydratedClmmPoolsMap: Map<string, HydratedConcentratedInfo> = new Map();
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams): Promise<void> {
    await this.scope.token.load(params);
    await this.scope.fetchClmmPools();
    this._clmmPools = [...(this.scope.apiData.clmmPools?.data || [])];
    this._clmmPools.forEach((pool) => {
      this._clmmPoolMap.set(pool.id, pool);
    });

    const chainTimeOffset = await this.scope.chainTimeOffset();

    const sdkParsed = await PoolUtils.fetchMultiplePoolInfos({
      poolKeys: this._clmmPools,
      connection: this.scope.connection,
      ownerInfo: this.scope.owner
        ? { tokenAccounts: this.scope.account.tokenAccountRawInfos, wallet: this.scope.ownerPubKey }
        : undefined,
      chainTime: (Date.now() + chainTimeOffset) / 1000,
    });
    this._clmmSdkParsedPools = Object.values(sdkParsed);
    this._clmmSdkParsedPoolMap = new Map(Object.entries(sdkParsed));
    this.hydratePoolsInfo();
  }

  get pools(): {
    data: ApiClmmPoolInfo[];
    dataMap: Map<string, ApiClmmPoolInfo>;
    sdkParsedData: SDKParsedConcentratedInfo[];
    sdkParsedDataMap: Map<string, SDKParsedConcentratedInfo>;
    hydratedData: HydratedConcentratedInfo[];
    hydratedDataData: Map<string, HydratedConcentratedInfo>;
  } {
    return {
      data: this._clmmPools,
      dataMap: this._clmmPoolMap,
      sdkParsedData: this._clmmSdkParsedPools,
      sdkParsedDataMap: this._clmmSdkParsedPoolMap,
      hydratedData: this._hydratedClmmPools,
      hydratedDataData: this._hydratedClmmPoolsMap,
    };
  }

  public hydratePoolsInfo(): HydratedConcentratedInfo[] {
    this._hydratedClmmPools = this._clmmSdkParsedPools.map((pool) => {
      const rewardLength = pool.state.rewardInfos.length;
      const [base, quote] = [
        this.scope.token.tokenMap.get(pool.state.mintA.mint.toBase58()) || toTokenInfo(pool.state.mintA),
        this.scope.token.tokenMap.get(pool.state.mintB.mint.toBase58()) || toTokenInfo(pool.state.mintB),
      ];
      const currentPrice = decimalToFraction(pool.state.currentPrice)!;
      const toMintATokenAmount = (amount: BigNumberish, decimalDone = true): TokenAmount | undefined =>
        base ? this.scope.mintToTokenAmount({ mint: base.address, amount, decimalDone }) : undefined;
      const toMintBTokenAmount = (amount: BigNumberish, decimalDone = true): TokenAmount | undefined =>
        quote ? this.scope.mintToTokenAmount({ mint: quote.address, amount, decimalDone }) : undefined;

      const parseReward = (time: "day" | "week" | "month"): Percent[] =>
        [
          toPercent(pool.state[time].rewardApr.A, { alreadyDecimaled: true }),
          toPercent(pool.state[time].rewardApr.B, { alreadyDecimaled: true }),
          toPercent(pool.state[time].rewardApr.C, { alreadyDecimaled: true }),
        ].slice(0, rewardLength);

      return {
        ...pool,
        id: pool.state.id,
        base,
        quote,
        name: (base ? base.symbol : "unknown") + "-" + (quote ? quote?.symbol : "unknown"),
        protocolFeeRate: toPercent(toFraction(pool.state.ammConfig.protocolFeeRate).div(toFraction(10 ** 4)), {
          alreadyDecimaled: true,
        }),
        tradeFeeRate: toPercent(toFraction(pool.state.ammConfig.tradeFeeRate).div(toFraction(10 ** 4)), {
          alreadyDecimaled: true,
        }),
        creator: pool.state.creator,
        ammConfig: pool.state.ammConfig,
        currentPrice,
        decimals: Math.max(base?.decimals || 0, quote?.decimals || 0, 6),

        idString: pool.state.id.toBase58(),
        tvl: toUsdCurrency(pool.state.tvl),

        totalApr24h: toPercent(pool.state.day.apr, { alreadyDecimaled: true }),
        totalApr7d: toPercent(pool.state.week.apr, { alreadyDecimaled: true }),
        totalApr30d: toPercent(pool.state.month.apr, { alreadyDecimaled: true }),
        feeApr24h: toPercent(pool.state.day.feeApr, { alreadyDecimaled: true }),
        feeApr7d: toPercent(pool.state.week.feeApr, { alreadyDecimaled: true }),
        feeApr30d: toPercent(pool.state.month.feeApr, { alreadyDecimaled: true }),
        rewardApr24h: parseReward("day"),
        rewardApr7d: parseReward("week"),
        rewardApr30d: parseReward("month"),

        volume24h: toUsdCurrency(pool.state.day.volume),
        volume7d: toUsdCurrency(pool.state.week.volume),
        volume30d: toUsdCurrency(pool.state.month.volume),

        volumeFee24h: toUsdCurrency(pool.state.day.volumeFee),
        volumeFee7d: toUsdCurrency(pool.state.week.volumeFee),
        volumeFee30d: toUsdCurrency(pool.state.month.volumeFee),

        fee24hA: toMintATokenAmount(pool.state.day.feeA),
        fee24hB: toMintBTokenAmount(pool.state.day.feeB),
        fee7dA: toMintATokenAmount(pool.state.week.feeA),
        fee7dB: toMintBTokenAmount(pool.state.week.feeB),
        fee30dA: toMintATokenAmount(pool.state.month.feeA),
        fee30dB: toMintBTokenAmount(pool.state.month.feeB),

        userPositionAccount: pool.positionAccount?.map((a) => {
          const amountA = toMintATokenAmount(a.amountA, false);
          const amountB = toMintATokenAmount(a.amountB, false);
          const tokenFeeAmountA = toMintATokenAmount(a.tokenFeeAmountA, false);
          const tokenFeeAmountB = toMintBTokenAmount(a.tokenFeeAmountB, false);
          const innerVolumeA = mul(currentPrice, amountA) || 0;
          const innerVolumeB = mul(currentPrice, amountB) || 0;
          const positionPercentA = toPercent(div(innerVolumeA, add(innerVolumeA, innerVolumeB))!);
          const positionPercentB = toPercent(div(innerVolumeB, add(innerVolumeA, innerVolumeB))!);
          const inRange = PositionUtils.checkIsInRange(pool, a);
          const poolRewardInfos = pool.state.rewardInfos;
          return {
            sdkParsed: a,
            ...recursivelyDecimalToFraction(a),
            amountA,
            amountB,
            nftMint: a.nftMint, // need this or nftMint will be buggy, this is only quick fixed
            liquidity: a.liquidity,
            tokenA: base,
            tokenB: quote,
            positionPercentA,
            positionPercentB,
            tokenFeeAmountA,
            tokenFeeAmountB,
            inRange,
            rewardInfos: a.rewardInfos
              .map((info, idx) => {
                const token = this.scope.token.tokenMap.get(poolRewardInfos[idx]?.tokenMint.toBase58());
                const pendingReward = token
                  ? this.scope.mintToTokenAmount({ mint: token.address, amount: info.pendingReward })
                  : undefined;
                if (!pendingReward) return;
                const apr24h =
                  idx === 0
                    ? toPercent(pool.state.day.rewardApr.A, { alreadyDecimaled: true })
                    : idx === 1
                    ? toPercent(pool.state.day.rewardApr.B, { alreadyDecimaled: true })
                    : toPercent(pool.state.day.rewardApr.C, { alreadyDecimaled: true });
                const apr7d =
                  idx === 0
                    ? toPercent(pool.state.week.rewardApr.A, { alreadyDecimaled: true })
                    : idx === 1
                    ? toPercent(pool.state.week.rewardApr.B, { alreadyDecimaled: true })
                    : toPercent(pool.state.week.rewardApr.C, { alreadyDecimaled: true });
                const apr30d =
                  idx === 0
                    ? toPercent(pool.state.month.rewardApr.A, { alreadyDecimaled: true })
                    : idx === 1
                    ? toPercent(pool.state.month.rewardApr.B, { alreadyDecimaled: true })
                    : toPercent(pool.state.month.rewardApr.C, { alreadyDecimaled: true });
                return { pendingReward, apr24h, apr7d, apr30d };
              })
              .filter((info) => Boolean(info?.pendingReward)) as UserPositionAccount["rewardInfos"],
            getLiquidityVolume: (): any => {
              const aPrice = this.scope.token.tokenPriceMap.get(pool.state.mintA.mint.toBase58());
              const bPrice = this.scope.token.tokenPriceMap.get(pool.state.mintB.mint.toBase58());
              const wholeLiquidity = add(mul(amountA, aPrice), mul(amountB, bPrice));
              return {
                wholeLiquidity,
                baseLiquidity: mul(wholeLiquidity, positionPercentA),
                quoteLiquidity: mul(wholeLiquidity, positionPercentB),
              };
            },
          };
        }),

        rewardInfos: pool.state.rewardInfos.map((r) => {
          const rewardToken = this.scope.token.tokenMap.get(r.tokenMint.toBase58());
          return {
            ...r,
            rewardToken,
            openTime: r.openTime.toNumber() * 1000,
            endTime: r.endTime.toNumber() * 1000,
            lastUpdateTime: r.lastUpdateTime.toNumber() * 1000,
            creator: r.creator,
            rewardClaimed: rewardToken
              ? this.scope.mintToTokenAmount({ mint: r.tokenMint, amount: r.rewardClaimed })
              : undefined,
            rewardTotalEmissioned: rewardToken
              ? this.scope.mintToTokenAmount({ mint: r.tokenMint, amount: r.rewardTotalEmissioned })
              : undefined,
            rewardPerWeek:
              rewardToken &&
              this.scope.mintToTokenAmount({
                mint: r.tokenMint,
                amount: r.perSecond.mul(60 * 60 * 24 * 7).toString(),
                decimalDone: true,
              }),
            rewardPerDay:
              rewardToken &&
              this.scope.mintToTokenAmount({
                mint: r.tokenMint,
                amount: r.perSecond.mul(60 * 60 * 24).toString(),
                decimalDone: true,
              }),
          };
        }),
      };
    });
    this._hydratedClmmPoolsMap = new Map(this._hydratedClmmPools.map((pool) => [pool.idString, pool]));
    return this._hydratedClmmPools;
  }

  public getAmountsFromLiquidity({
    poolId,
    ownerPosition,
    liquidity,
    slippage,
    add,
  }: GetAmountParams): ReturnTypeGetAmountsFromLiquidity {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);
    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickLower);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickUpper);

    return LiquidityMath.getAmountsFromLiquidityWithSlippage(
      poolInfo!.sqrtPriceX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      add,
      add,
      slippage,
    );
  }

  public async fetchPoolAccountPosition(updateOwnerRewardAndFee?: boolean): Promise<HydratedConcentratedInfo[]> {
    this._clmmSdkParsedPools = this._clmmSdkParsedPools.map((pool) => {
      delete pool.positionAccount;
      this._clmmSdkParsedPoolMap.set(pool.state.id.toBase58(), pool);
      return pool;
    });
    if (!this.scope.owner) {
      this.hydratePoolsInfo();
      return this._hydratedClmmPools;
    }
    await this.scope.account.fetchWalletTokenAccounts();
    this._clmmSdkParsedPools = await PoolUtils.fetchPoolsAccountPosition({
      pools: this._clmmSdkParsedPools,
      connection: this.scope.connection,
      ownerInfo: { tokenAccounts: this.scope.account.tokenAccountRawInfos, wallet: this.scope.ownerPubKey },
      updateOwnerRewardAndFee,
    });
    this._clmmSdkParsedPoolMap = new Map(this._clmmSdkParsedPools.map((pool) => [pool.state.id.toBase58(), pool]));
    this.hydratePoolsInfo();
    return this._hydratedClmmPools;
  }

  public async createPool(props: CreateConcentratedPool): Promise<MakeTransaction<{ mockPoolInfo: ClmmPoolInfo }>> {
    const {
      programId,
      owner = this.scope.owner?.publicKey || PublicKey.default,
      mint1,
      mint2,
      ammConfig,
      initialPrice,
      startTime,
    } = props;
    const txBuilder = this.createTxBuilder();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const [mintA, mintB, initPrice] = mint1.mint._bn.gt(mint2.mint._bn)
      ? [mint2, mint1, new Decimal(1).div(initialPrice)]
      : [mint1, mint2, initialPrice];

    const initialPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(initPrice, mintA.decimals, mintB.decimals);

    const insInfo = await ClmmInstrument.createPoolInstructions({
      connection: this.scope.connection,
      programId,
      owner,
      mintA,
      mintB,
      ammConfigId: ammConfig.id,
      initialPriceX64,
      startTime,
    });

    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

    return txBuilder.build<{ mockPoolInfo: ClmmPoolInfo }>({
      mockPoolInfo: {
        creator: this.scope.ownerPubKey,
        id: insInfo.address.poolId,
        mintA: {
          programId: mintA.programId,
          mint: mintA.mint,
          vault: insInfo.address.mintAVault,
          decimals: mintA.decimals,
        },
        mintB: {
          programId: mintB.programId,
          mint: mintB.mint,
          vault: insInfo.address.mintBVault,
          decimals: mintB.decimals,
        },
        ammConfig,
        observationId: insInfo.address.observationId,
        programId,
        tickSpacing: ammConfig.tickSpacing,
        sqrtPriceX64: initialPriceX64,
        currentPrice: initPrice,
        ...mockCreatePoolInfo,
        version: 6,
        lookupTableAccount: PublicKey.default,
        startTime: startTime.toNumber(),
        exBitmapInfo: {
          poolId: insInfo.address.poolId,
          positiveTickArrayBitmap: Array.from({ length: EXTENSION_TICKARRAY_BITMAP_SIZE }, (_) =>
            Array.from({ length: 8 }, (_) => new BN(0)),
          ),
          negativeTickArrayBitmap: Array.from({ length: EXTENSION_TICKARRAY_BITMAP_SIZE }, (_) =>
            Array.from({ length: 8 }, (_) => new BN(0)),
          ),
        },
      },
    });
  }

  public async openPositionFromBase({
    poolId,
    ownerInfo,
    tickLower,
    tickUpper,
    base,
    baseAmount,
    otherAmountMax,
    associatedOnly = true,
    checkCreateATAOwner = false,
    withMetadata = "create",
    getEphemeralSigners,
  }: OpenPositionFromBase): Promise<MakeTransaction> {
    this.scope.checkOwner();
    const pool = this._hydratedClmmPoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found:", poolId.toBase58());
    const poolInfo = pool!.state;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | null = null;
    let ownerTokenAccountB: PublicKey | null = null;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);
    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: poolInfo.mintA.mint,
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: base === "MintA" ? baseAmount : otherAmountMax,
            }
          : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: poolInfo.mintB.mint,
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: undefined,
            }
          : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const insInfo = await ClmmInstrument.openPositionFromBaseInstructions({
      poolInfo,
      ownerInfo: {
        ...ownerInfo,
        feePayer: this.scope.ownerPubKey,
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      tickLower,
      tickUpper,
      base,
      baseAmount,
      otherAmountMax,
      withMetadata,
      getEphemeralSigners,
    });
    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build({ address: insInfo.address });
  }

  public async openPositionFromLiquidity({
    poolInfo,
    ownerInfo,
    amountMaxA,
    amountMaxB,
    tickLower,
    tickUpper,
    liquidity,
    associatedOnly = true,
    checkCreateATAOwner = false,
    withMetadata = "create",
    getEphemeralSigners,
  }: OpenPositionFromLiquidity): Promise<MakeTransaction> {
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | null = null;
    let ownerTokenAccountB: PublicKey | null = null;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toBase58();

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: amountMaxA,
            }
          : undefined,

        skipCloseAccount: !mintAUseSOLBalance,
        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintB.programId),
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: amountMaxB,
            }
          : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (ownerTokenAccountA === undefined || ownerTokenAccountB === undefined)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const makeOpenPositionInstructions = await ClmmInstrument.openPositionFromLiquidityInstructions({
      poolInfo: poolInfo as any, // to do
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      tickLower,
      tickUpper,
      liquidity,
      amountMaxA,
      amountMaxB,
      withMetadata,
      getEphemeralSigners,
    });

    txBuilder.addInstruction(makeOpenPositionInstructions);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build({ address: makeOpenPositionInstructions.address });
  }

  public async increasePositionFromLiquidity(props: IncreasePositionFromLiquidity): Promise<MakeTransaction> {
    const {
      poolId,
      ownerPosition,
      amountMaxA,
      amountMaxB,
      liquidity,
      ownerInfo,
      associatedOnly = true,
      checkCreateATAOwner = false,
    } = props;
    const pool = this._hydratedClmmPoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: poolInfo.mintA.mint,
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: amountMaxA,
            }
          : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintB.mint,
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: amountMaxB,
            }
          : undefined,
        notUseTokenAccount: mintBUseSOLBalance,
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const ins = ClmmInstrument.increasePositionFromLiquidityInstructions({
      poolInfo,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      liquidity,
      amountMaxA,
      amountMaxB,
    });
    txBuilder.addInstruction(ins);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build({ address: ins.address });
  }

  public async increasePositionFromBase(props: IncreasePositionFromBase): Promise<MakeTransaction> {
    const {
      poolId,
      ownerPosition,
      base,
      baseAmount,
      otherAmountMax,
      ownerInfo,
      associatedOnly = true,
      checkCreateATAOwner = false,
    } = props;
    const pool = this._hydratedClmmPoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: poolInfo.mintA.mint,
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: base === "MintA" ? baseAmount : otherAmountMax,
            }
          : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintB.mint,
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: base === "MintA" ? otherAmountMax : baseAmount,
            }
          : undefined,
        notUseTokenAccount: mintBUseSOLBalance,
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const ins = ClmmInstrument.increasePositionFromBaseInstructions({
      poolInfo,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      base,
      baseAmount,
      otherAmountMax,
    });
    txBuilder.addInstruction(ins);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build({ address: ins.address });
  }

  public async decreaseLiquidity(props: DecreaseLiquidity): Promise<MakeTransaction> {
    const {
      poolId,
      ownerPosition,
      ownerInfo,
      amountMinA,
      amountMinB,
      liquidity,
      associatedOnly = true,
      checkCreateATAOwner = false,
    } = props;
    const pool = this._hydratedClmmPoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;

    const txBuilder = this.createTxBuilder();

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;
    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: poolInfo.mintA.mint,
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: poolInfo.mintB.mint,
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    const rewardAccounts: PublicKey[] = [];
    for (const itemReward of poolInfo.rewardInfos) {
      const rewardUseSOLBalance = ownerInfo.useSOLBalance && itemReward.tokenMint.equals(WSOLMint);
      const { account: _ownerRewardAccount, instructionParams: ownerRewardAccountInstructions } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: itemReward.tokenProgramId,
          mint: itemReward.tokenMint,
          notUseTokenAccount: rewardUseSOLBalance,
          owner: this.scope.ownerPubKey,
          createInfo: {
            payer: this.scope.ownerPubKey,
            amount: 0,
          },
          skipCloseAccount: !rewardUseSOLBalance,
          associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      ownerRewardAccountInstructions && txBuilder.addInstruction(ownerRewardAccountInstructions);
      _ownerRewardAccount && rewardAccounts.push(_ownerRewardAccount);
    }

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );

    const decreaseInsInfo = await ClmmInstrument.decreaseLiquidityInstructions({
      poolInfo,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
        rewardAccounts,
      },
      liquidity,
      amountMinA,
      amountMinB,
    });

    txBuilder.addInstruction({
      instructions: decreaseInsInfo.instructions,
      instructionTypes: [InstructionType.ClmmDecreasePosition],
    });

    if (ownerInfo.closePosition) {
      const closeInsInfo = await ClmmInstrument.closePositionInstructions({
        poolInfo,
        ownerInfo: { wallet: this.scope.ownerPubKey },
        ownerPosition,
      });
      txBuilder.addInstruction({
        endInstructions: closeInsInfo.instructions,
        endInstructionTypes: closeInsInfo.instructionTypes,
      });
    }
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build({ address: decreaseInsInfo.address });
  }

  public closePosition({
    poolId,
    ownerPosition,
  }: {
    poolId: PublicKey;
    ownerPosition: ClmmPoolPersonalPosition;
  }): MakeTransaction {
    const pool = this._hydratedClmmPoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;
    const txBuilder = this.createTxBuilder();
    const ins = ClmmInstrument.closePositionInstructions({
      poolInfo,
      ownerInfo: { wallet: this.scope.ownerPubKey },
      ownerPosition,
    });
    return txBuilder.addInstruction(ins).build({ address: ins.address });
  }

  public async swapBaseIn({
    poolId,
    ownerInfo,
    inputMint,
    amountIn,
    amountOutMin,
    priceLimit,
    remainingAccounts,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: SwapInParams): Promise<MakeTransaction> {
    this.scope.checkOwner();
    const pool = this._hydratedClmmPoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = inputMint.equals(poolInfo.mintA.mint)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const txBuilder = this.createTxBuilder();
    const isInputMintA = poolInfo.mintA.mint.equals(inputMint);

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: poolInfo.mintA.mint,
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintAUseSOLBalance || !isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? amountIn : 0,
              }
            : undefined,
        skipCloseAccount: !(mintAUseSOLBalance || !isInputMintA),
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: poolInfo.mintB.mint,
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintBUseSOLBalance || isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? 0 : amountIn,
              }
            : undefined,
        skipCloseAccount: !(mintBUseSOLBalance || isInputMintA),
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );

    const insInfo = await ClmmInstrument.makeSwapBaseInInstructions({
      poolInfo,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },

      inputMint,

      amountIn,
      amountOutMin,
      sqrtPriceLimitX64,

      remainingAccounts,
    });
    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build();
  }

  public async swapBaseOut({
    poolId,
    ownerInfo,

    outputMint,
    amountOut,
    amountInMax,
    priceLimit,

    remainingAccounts,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: {
    poolId: string;
    ownerInfo: {
      useSOLBalance?: boolean; // if has WSOL mint
    };

    outputMint: PublicKey;
    amountOut: BN;
    amountInMax: BN;
    priceLimit?: Decimal;
    remainingAccounts: PublicKey[];
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
  }): Promise<MakeTransaction> {
    const poolInfo = this._clmmSdkParsedPoolMap.get(poolId)?.state;
    if (!poolInfo) throw new Error(`pool not found ${poolId}`);

    const txBuilder = this.createTxBuilder();
    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = outputMint.equals(poolInfo.mintB.mint)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const isInputMintA = poolInfo.mintA.mint.equals(outputMint);
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: poolInfo.mintA.mint,
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintAUseSOLBalance || !isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? amountInMax : 0,
              }
            : undefined,
        skipCloseAccount: !(mintAUseSOLBalance || !isInputMintA),
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintB.mint,
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintBUseSOLBalance || isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? 0 : amountInMax,
              }
            : undefined,
        skipCloseAccount: !(mintBUseSOLBalance || isInputMintA),
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    if (!ownerTokenAccountA && !ownerTokenAccountB) {
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );
    }

    const insInfo = ClmmInstrument.swapBaseOutInstructions({
      poolInfo,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },

      outputMint,

      amountOut,
      amountInMax,
      sqrtPriceLimitX64,

      remainingAccounts,
    });

    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build();
  }

  public async initReward({
    poolId,
    ownerInfo,
    rewardInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: InitRewardParams): Promise<MakeTransaction> {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);

    if (rewardInfo.endTime <= rewardInfo.openTime)
      this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);

    const txBuilder = this.createTxBuilder();

    const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.equals(WSOLMint);
    const _baseRewardAmount = rewardInfo.perSecond.mul(rewardInfo.endTime - rewardInfo.openTime);
    const { account: ownerRewardAccount, instructionParams: ownerRewardAccountIns } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: rewardInfo.programId,
        mint: rewardInfo.mint,
        notUseTokenAccount: !!rewardMintUseSOLBalance,
        skipCloseAccount: !rewardMintUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: rewardMintUseSOLBalance
          ? {
              payer: ownerInfo.feePayer || this.scope.ownerPubKey,
              amount: new BN(
                new Decimal(_baseRewardAmount.toFixed(0)).gte(_baseRewardAmount)
                  ? _baseRewardAmount.toFixed(0)
                  : _baseRewardAmount.add(1).toFixed(0),
              ),
            }
          : undefined,
        associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerRewardAccountIns && txBuilder.addInstruction(ownerRewardAccountIns);

    if (!ownerRewardAccount)
      this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);

    const insInfo = ClmmInstrument.initRewardInstructions({
      poolInfo: poolInfo!,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccount: ownerRewardAccount!,
      },
      rewardInfo: {
        programId: rewardInfo.programId,
        mint: rewardInfo.mint,
        openTime: rewardInfo.openTime,
        endTime: rewardInfo.endTime,
        emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
      },
    });
    txBuilder.addInstruction(insInfo);
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address: insInfo.address });
  }

  public async initRewards({
    poolId,
    ownerInfo,
    rewardInfos,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: InitRewardsParams): Promise<MakeTransaction> {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);

    for (const rewardInfo of rewardInfos) {
      if (rewardInfo.endTime <= rewardInfo.openTime)
        this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);
    }

    const txBuilder = this.createTxBuilder();
    let address: Record<string, PublicKey> = {};

    for (const rewardInfo of rewardInfos) {
      const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.equals(WSOLMint);
      const _baseRewardAmount = rewardInfo.perSecond.mul(rewardInfo.endTime - rewardInfo.openTime);
      const { account: ownerRewardAccount, instructionParams: ownerRewardAccountIns } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: rewardInfo.programId,
          mint: rewardInfo.mint,
          notUseTokenAccount: !!rewardMintUseSOLBalance,
          skipCloseAccount: !rewardMintUseSOLBalance,
          owner: this.scope.ownerPubKey,
          createInfo: rewardMintUseSOLBalance
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: new BN(
                  new Decimal(_baseRewardAmount.toFixed(0)).gte(_baseRewardAmount)
                    ? _baseRewardAmount.toFixed(0)
                    : _baseRewardAmount.add(1).toFixed(0),
                ),
              }
            : undefined,
          associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      ownerRewardAccountIns && txBuilder.addInstruction(ownerRewardAccountIns);

      if (!ownerRewardAccount)
        this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);

      const insInfo = ClmmInstrument.initRewardInstructions({
        poolInfo: poolInfo!,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccount: ownerRewardAccount!,
        },
        rewardInfo: {
          programId: rewardInfo.programId,
          mint: rewardInfo.mint,
          openTime: rewardInfo.openTime,
          endTime: rewardInfo.endTime,
          emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
        },
      });
      address = {
        ...address,
        ...insInfo.address,
      };
      txBuilder.addInstruction(insInfo);
    }
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address });
  }

  public async setReward({
    poolId,
    ownerInfo,
    rewardInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: SetRewardParams): Promise<MakeTransaction> {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);

    if (rewardInfo.endTime <= rewardInfo.openTime)
      this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);

    const txBuilder = this.createTxBuilder();
    const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.equals(WSOLMint);
    const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: rewardInfo.programId,
        mint: rewardInfo.mint,
        notUseTokenAccount: rewardMintUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: rewardMintUseSOLBalance
          ? {
              payer: ownerInfo.feePayer || this.scope.ownerPubKey,
              amount: new BN(
                new Decimal(rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)).gte(
                  rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime),
                )
                  ? rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)
                  : rewardInfo.perSecond
                      .sub(rewardInfo.endTime - rewardInfo.openTime)
                      .add(1)
                      .toFixed(0),
              ),
            }
          : undefined,

        associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);
    if (!ownerRewardAccount)
      this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);

    const insInfo = ClmmInstrument.setRewardInstructions({
      poolInfo: poolInfo!,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccount: ownerRewardAccount!,
      },
      rewardInfo: {
        mint: rewardInfo.mint,
        openTime: rewardInfo.openTime,
        endTime: rewardInfo.endTime,
        emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
      },
    });

    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address: insInfo.address });
  }

  public async setRewards({
    poolId,
    ownerInfo,
    rewardInfos,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: SetRewardsParams): Promise<MakeTransaction> {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);

    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction({ instructions: ClmmInstrument.addComputations() });
    let address: Record<string, PublicKey> = {};
    for (const rewardInfo of rewardInfos) {
      if (rewardInfo.endTime <= rewardInfo.openTime)
        this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);

      const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.equals(WSOLMint);
      const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: rewardInfo.programId,
          mint: rewardInfo.mint,
          notUseTokenAccount: rewardMintUseSOLBalance,
          owner: this.scope.ownerPubKey,
          createInfo: rewardMintUseSOLBalance
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: new BN(
                  new Decimal(rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)).gte(
                    rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime),
                  )
                    ? rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)
                    : rewardInfo.perSecond
                        .sub(rewardInfo.endTime - rewardInfo.openTime)
                        .add(1)
                        .toFixed(0),
                ),
              }
            : undefined,
          associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);
      if (!ownerRewardAccount)
        this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);

      const insInfo = ClmmInstrument.setRewardInstructions({
        poolInfo: poolInfo!,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccount: ownerRewardAccount!,
        },
        rewardInfo: {
          mint: rewardInfo.mint,
          openTime: rewardInfo.openTime,
          endTime: rewardInfo.endTime,
          emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
        },
      });
      txBuilder.addInstruction(insInfo);
      address = {
        ...address,
        ...insInfo.address,
      };
    }
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address });
  }

  public async collectReward({
    poolId,
    ownerInfo,
    rewardMint,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: CollectRewardParams): Promise<MakeTransaction> {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);
    const rewardInfo = poolInfo!.rewardInfos.find((i) => i.tokenMint.equals(rewardMint));
    if (!rewardInfo) this.logAndCreateError("reward mint error", "not found reward mint", rewardMint);

    const txBuilder = this.createTxBuilder();
    const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardMint.equals(WSOLMint);
    const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: rewardInfo?.tokenProgramId,
        mint: rewardMint,
        notUseTokenAccount: rewardMintUseSOLBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !rewardMintUseSOLBalance,
        createInfo: {
          payer: ownerInfo.feePayer || this.scope.ownerPubKey,
          amount: 0,
        },
        associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);

    if (!ownerRewardAccount)
      this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);

    const insInfo = ClmmInstrument.collectRewardInstructions({
      poolInfo: poolInfo!,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccount: ownerRewardAccount!,
      },
      rewardMint,
    });
    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address: insInfo.address });
  }

  public async collectRewards({
    poolId,
    ownerInfo,
    rewardMints,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: CollectRewardsParams): Promise<MakeTransaction> {
    const poolInfo = this._hydratedClmmPoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);

    const txBuilder = this.createTxBuilder();
    let address: Record<string, PublicKey> = {};

    for (const rewardMint of rewardMints) {
      const rewardInfo = poolInfo!.rewardInfos.find((i) => i.tokenMint.equals(rewardMint));
      if (!rewardInfo) {
        this.logAndCreateError("reward mint error", "not found reward mint", rewardMint);
        continue;
      }

      const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardMint.equals(WSOLMint);
      const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: rewardInfo.tokenProgramId,
          mint: rewardMint,
          notUseTokenAccount: rewardMintUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !rewardMintUseSOLBalance,
          createInfo: {
            payer: ownerInfo.feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      if (!ownerRewardAccount)
        this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);
      ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);

      const insInfo = ClmmInstrument.collectRewardInstructions({
        poolInfo: poolInfo!,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccount: ownerRewardAccount!,
        },

        rewardMint,
      });
      txBuilder.addInstruction(insInfo);
      address = { ...address, ...insInfo.address };
    }
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address });
  }

  public async harvestAllRewards({
    ownerInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
    programId,
  }: HarvestAllRewardsParams): Promise<MakeMultiTransaction> {
    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccountRawInfos) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.accountInfo.mint, programId).publicKey;
        if (ata.equals(item.pubkey)) ownerMintToAccount[item.accountInfo.mint.toString()] = item.pubkey;
      } else {
        ownerMintToAccount[item.accountInfo.mint.toString()] = item.pubkey;
      }
    }
    const txBuilder = this.createTxBuilder();

    for (const itemInfo of this._hydratedClmmPools) {
      if (itemInfo.positionAccount === undefined) continue;
      if (
        !itemInfo.positionAccount.find(
          (i) =>
            !i.tokenFeeAmountA.isZero() ||
            !i.tokenFeeAmountB.isZero() ||
            i.rewardInfos.find((ii) => !ii.pendingReward.isZero()),
        )
      )
        continue;

      const poolInfo = itemInfo.state;
      const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
      const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

      let ownerTokenAccountA = ownerMintToAccount[poolInfo.mintA.mint.toString()];
      if (!ownerTokenAccountA) {
        const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: poolInfo.mintA.programId,
          mint: poolInfo.mintA.mint,
          notUseTokenAccount: mintAUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: true,
          createInfo: {
            payer: ownerInfo.feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerTokenAccountA = account!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }

      let ownerTokenAccountB = ownerMintToAccount[poolInfo.mintB.mint.toString()];
      if (!ownerTokenAccountB) {
        const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: poolInfo.mintB.programId,
          mint: poolInfo.mintB.mint,
          notUseTokenAccount: mintBUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: true,
          createInfo: {
            payer: ownerInfo.feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerTokenAccountB = account!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }

      ownerMintToAccount[poolInfo.mintA.mint.toString()] = ownerTokenAccountA;
      ownerMintToAccount[poolInfo.mintB.mint.toString()] = ownerTokenAccountB;

      const rewardAccounts: PublicKey[] = [];
      for (const itemReward of poolInfo.rewardInfos) {
        const rewardUseSOLBalance = ownerInfo.useSOLBalance && itemReward.tokenMint.equals(WSOLMint);
        let ownerRewardAccount = ownerMintToAccount[itemReward.tokenMint.toString()];
        if (!ownerRewardAccount) {
          const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
            tokenProgram: itemReward.tokenProgramId,
            mint: itemReward.tokenMint,
            notUseTokenAccount: rewardUseSOLBalance,
            owner: this.scope.ownerPubKey,
            skipCloseAccount: !rewardUseSOLBalance,
            createInfo: {
              payer: ownerInfo.feePayer || this.scope.ownerPubKey,
              amount: 0,
            },
            associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
          });
          ownerRewardAccount = account!;
          instructionParams && txBuilder.addInstruction(instructionParams);
        }

        ownerMintToAccount[itemReward.tokenMint.toString()] = ownerRewardAccount;
        rewardAccounts.push(ownerRewardAccount!);
      }

      for (const itemPosition of itemInfo.positionAccount) {
        txBuilder.addInstruction({
          instructions: ClmmInstrument.decreaseLiquidityInstructions({
            poolInfo,
            ownerPosition: itemPosition,
            ownerInfo: {
              wallet: this.scope.ownerPubKey,
              tokenAccountA: ownerTokenAccountA,
              tokenAccountB: ownerTokenAccountB,
              rewardAccounts,
            },
            liquidity: ZERO,
            amountMinA: ZERO,
            amountMinB: ZERO,
          }).instructions,
        });
      }
    }

    return txBuilder.sizeCheckBuild();
  }

  public async getWhiteListMint({ programId }: { programId: PublicKey }): Promise<PublicKey[]> {
    const accountInfo = await this.scope.connection.getAccountInfo(getPdaOperationAccount(programId).publicKey);
    if (!accountInfo) return [];
    const whitelistMintsInfo = OperationLayout.decode(accountInfo.data);
    return whitelistMintsInfo.whitelistMints.filter((i) => !i.equals(PublicKey.default));
  }

  public async computeAmountIn({
    poolId,
    tickArrayCache,
    baseMint,
    token2022Infos,
    amountOut,
    slippage,
    priceLimit = new Decimal(0),
  }: {
    poolId: string;
    tickArrayCache: { [key: string]: TickArray };
    baseMint: PublicKey;
    token2022Infos: ReturnTypeFetchMultipleMintInfos;
    amountOut: BN;
    slippage: number;
    priceLimit?: Decimal;
  }): Promise<ReturnTypeComputeAmountOutBaseOut> {
    const epochInfo = await this.scope.fetchEpochInfo();
    const poolInfo = this._hydratedClmmPoolsMap.get(poolId)?.state;
    if (!poolInfo) throw new Error(`pool not found ${poolId}`);

    let sqrtPriceLimitX64: BN;
    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = baseMint.equals(poolInfo.mintB.mint)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const realAmountOut = getTransferAmountFee(
      amountOut,
      token2022Infos[baseMint.toString()]?.feeConfig,
      epochInfo,
      true,
    );

    const {
      expectedAmountIn,
      remainingAccounts,
      executionPrice: _executionPriceX64,
      feeAmount,
    } = PoolUtils.getInputAmountAndRemainAccounts(
      poolInfo,
      tickArrayCache,
      baseMint,
      realAmountOut.amount.sub(realAmountOut.fee || new BN(0)),
      sqrtPriceLimitX64,
    );

    const _executionPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      _executionPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const executionPrice = baseMint.equals(poolInfo.mintA.mint) ? _executionPrice : new Decimal(1).div(_executionPrice);

    const maxAmountIn = expectedAmountIn.mul(new BN(Math.floor((1 + slippage) * 10000000000))).div(new BN(10000000000));

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
      amountIn: expectedAmountIn,
      maxAmountIn,
      currentPrice: poolInfo.currentPrice,
      executionPrice,
      priceImpact,
      fee: feeAmount,

      remainingAccounts,
    };
  }
}
