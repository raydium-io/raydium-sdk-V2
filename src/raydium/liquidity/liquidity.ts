import { ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { ApiJsonPairInfo } from "../../api";

import {
  BN_ONE,
  BN_ZERO,
  divCeil,
  Numberish,
  parseNumberInfo,
  toBN,
  toTokenPrice,
  toUsdCurrency,
} from "../../common/bignumber";
import { createLogger } from "../../common/logger";
import { PublicKeyish, SOLMint, validateAndParsePublicKey, WSOLMint, solToWSol } from "../../common/pubKey";
import { jsonInfo2PoolKeys } from "../../common/utility";
import { InstructionType } from "../../common/txType";
import { Fraction, Percent, Price, Token, TokenAmount } from "../../module";
import { makeTransferInstruction } from "../account/instruction";
import { getATAAddress } from "../../common/pda";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { SwapExtInfo } from "../trade/type";
import { LoadParams, MakeMultiTransaction, MakeTransaction } from "../type";

import { LIQUIDITY_FEES_DENOMINATOR, LIQUIDITY_FEES_NUMERATOR } from "./constant";
import {
  makeAddLiquidityInstruction,
  makeAMMSwapInstruction,
  makeCreatePoolInstruction,
  makeInitPoolInstruction,
  makeRemoveLiquidityInstruction,
  makeCreatePoolV4InstructionV2,
} from "./instruction";
import { getDxByDyBaseIn, getDyByDxBaseIn, getStablePrice, StableLayout } from "./stable";
import { LpToken, SplToken } from "../token/type";
import {
  AmountSide,
  CreatePoolParam,
  CreatePoolV4Param,
  CreatePoolV4Address,
  InitPoolParam,
  LiquidityAddTransactionParams,
  LiquidityComputeAmountOutParams,
  LiquidityComputeAmountOutReturn,
  LiquidityComputeAnotherAmountParams,
  LiquidityFetchMultipleInfoParams,
  LiquidityPoolInfo,
  LiquidityPoolJsonInfo,
  LiquidityRemoveTransactionParams,
  LiquiditySide,
  LiquiditySwapTransactionParams,
  PairJsonInfo,
  SDKParsedLiquidityInfo,
  HydratedPairItemInfo,
} from "./type";
import {
  getAmountSide,
  getAmountsSide,
  getAssociatedPoolKeys,
  includesToken,
  isValidFixedSide,
  makeSimulationPoolInfo,
} from "./util";
import Decimal from "decimal.js-light";
export default class Liquidity extends ModuleBase {
  private _poolInfos: LiquidityPoolJsonInfo[] = [];
  private _poolInfoMap: Map<string, LiquidityPoolJsonInfo> = new Map();
  private _pairsInfo: PairJsonInfo[] = [];
  private _pairsInfoMap: Map<string, PairJsonInfo> = new Map();
  private _lpTokenMap: Map<string, Token> = new Map();
  private _lpPriceMap: Map<string, Price> = new Map();
  private _officialIds: Set<string> = new Set();
  private _unOfficialIds: Set<string> = new Set();
  private _sdkParseInfoCache: Map<string, SDKParsedLiquidityInfo[]> = new Map();
  private _stableLayout: StableLayout;
  constructor(params: ModuleBaseProps) {
    super(params);
    this._stableLayout = new StableLayout({ connection: this.scope.connection });
  }

  public async load(params?: LoadParams): Promise<void> {
    await this.scope.fetchLiquidity(params?.forceUpdate);
    if (!this.scope.apiData.liquidityPools) return;
    const { data } = this.scope.apiData.liquidityPools;
    const [official, unOfficial] = [data.official || [], data.unOfficial || []];
    this._poolInfos = [...official, ...unOfficial];
    this._officialIds = new Set(
      official.map((info) => {
        const symbol = `${this.scope.token.allTokenMap.get(info.baseMint)?.symbol} - ${
          this.scope.token.allTokenMap.get(info.quoteMint)?.symbol
        }`;
        this._poolInfoMap.set(info.id, info);
        this._lpTokenMap.set(
          info.lpMint,
          new Token({ mint: info.lpMint, decimals: info.lpDecimals, symbol, name: `${symbol} LP` }),
        );
        return info.id;
      }),
    );
    this._unOfficialIds = new Set(
      unOfficial.map((info) => {
        const symbol = `${this.scope.token.allTokenMap.get(info.baseMint)?.symbol} - ${
          this.scope.token.allTokenMap.get(info.quoteMint)?.symbol
        }`;
        this._poolInfoMap.set(info.id, info);
        this._lpTokenMap.set(
          info.lpMint,
          new Token({ mint: info.lpMint, decimals: info.lpDecimals, symbol, name: `${symbol} LP` }),
        );
        return info.id;
      }),
    );
    await this.scope.token.parseAllPoolTokens();
  }

  public async loadPairs(params?: LoadParams): Promise<ApiJsonPairInfo[]> {
    await this.scope.fetchPairs(params?.forceUpdate);
    this._pairsInfo = this.scope.apiData.liquidityPairsInfo?.data || [];
    this._pairsInfoMap = new Map(
      this._pairsInfo.map((pair) => {
        const token = this._lpTokenMap.get(pair.lpMint);
        const price =
          token && pair.lpPrice ? toTokenPrice({ token, numberPrice: pair.lpPrice, decimalDone: true }) : null;
        price && this._lpPriceMap.set(pair.lpMint, price);
        return [pair.ammId, pair];
      }),
    );
    this.scope.farm.farmAPRs = Object.fromEntries(
      this._pairsInfo.map((i) => [i.ammId, { apr30d: i.apr30d, apr7d: i.apr7d, apr24h: i.apr24h }]),
    );

    return this._pairsInfo;
  }

  public hydratedPairInfo(
    pair: ApiJsonPairInfo,
    payload: {
      lpToken?: LpToken;
      lpBalance?: TokenAmount;
      isStable?: boolean;
      isOpenBook?: boolean;
      userCustomTokenSymbol: { [x: string]: { symbol: string; name: string } };
    },
  ): HydratedPairItemInfo {
    const lp = payload.lpToken;
    const base = lp?.base;
    const quote = lp?.quote;
    let newPairName = "";

    const tokenAmountBase = base
      ? this.scope.mintToTokenAmount({ mint: base.mint, amount: pair.tokenAmountCoin }) ?? null
      : null;
    const tokenAmountQuote = quote
      ? this.scope.mintToTokenAmount({ mint: quote.mint, amount: pair.tokenAmountPc }) ?? null
      : null;

    const tokenAmountLp = lp ? new TokenAmount(lp!, pair.tokenAmountLp.toFixed(lp.decimals), false) ?? null : null;

    const lpBalance = payload.lpBalance;
    const calcLpUserLedgerInfoResult = this.computeUserLedgerInfo(
      { tokenAmountBase, tokenAmountQuote, tokenAmountLp },
      { lpToken: lp, baseToken: base, quoteToken: quote, lpBalance },
    );

    const nameParts = pair.name.split("-");
    const basePubString = base?.mint?.toString() || "";
    const quotePubString = quote?.mint?.toString() || "";

    if (base && payload.userCustomTokenSymbol[basePubString]) {
      base.symbol = payload.userCustomTokenSymbol[basePubString].symbol;
      base.name = payload.userCustomTokenSymbol[basePubString].name
        ? payload.userCustomTokenSymbol[basePubString].name
        : base.symbol;
      nameParts[0] = base.symbol;
    } else if (nameParts[0] === "unknown") {
      nameParts[0] = base?.symbol?.substring(0, 6) ?? nameParts[0];
    }

    if (quote && payload.userCustomTokenSymbol[quotePubString]) {
      quote.symbol = payload.userCustomTokenSymbol[quotePubString].symbol;
      quote.name = payload.userCustomTokenSymbol[quotePubString].name
        ? payload.userCustomTokenSymbol[quotePubString].name
        : quote.symbol;
      nameParts[1] = quote.symbol;
    } else if (nameParts[1] === "unknown") {
      nameParts[1] = quote?.symbol?.substring(0, 6) ?? nameParts[0];
    }

    newPairName = nameParts.join("-");

    return {
      ...pair,
      ...{
        fee7d: toUsdCurrency(pair.fee7d),
        fee7dQuote: toUsdCurrency(pair.fee7dQuote),
        fee24h: toUsdCurrency(pair.fee24h),
        fee24hQuote: toUsdCurrency(pair.fee24hQuote),
        fee30d: toUsdCurrency(pair.fee30d),
        fee30dQuote: toUsdCurrency(pair.fee30dQuote),
        volume24h: toUsdCurrency(pair.volume24h),
        volume24hQuote: toUsdCurrency(pair.volume24hQuote),
        volume7d: toUsdCurrency(pair.volume7d),
        volume7dQuote: toUsdCurrency(pair.volume7dQuote),
        volume30d: toUsdCurrency(pair.volume30d),
        volume30dQuote: toUsdCurrency(pair.volume30dQuote),
        tokenAmountBase,
        tokenAmountQuote,
        tokenAmountLp,
        liquidity: toUsdCurrency(Math.round(pair.liquidity)),
        lpPrice: lp && pair.lpPrice ? toTokenPrice({ token: lp, numberPrice: pair.lpPrice }) : null,
        // customized
        lp,
        base,
        quote,
        basePooled: calcLpUserLedgerInfoResult?.basePooled,
        quotePooled: calcLpUserLedgerInfoResult?.quotePooled,
        sharePercent: calcLpUserLedgerInfoResult?.sharePercent,
        price: base ? toTokenPrice({ token: base, numberPrice: pair.price }) : null,
        isStablePool: Boolean(payload.isStable),
        isOpenBook: Boolean(payload.isOpenBook),
        name: newPairName ? newPairName : pair.name,
      },
    };
  }

  public computeUserLedgerInfo(
    pairInfo: {
      tokenAmountBase: TokenAmount | null; // may have decimal
      tokenAmountQuote: TokenAmount | null; // may have decimal
      tokenAmountLp: TokenAmount | null; // may have decimal
    },
    additionalTools: {
      lpToken: SplToken | undefined;
      quoteToken: SplToken | undefined;
      baseToken: SplToken | undefined;
      lpBalance: TokenAmount | undefined;
    },
  ): { basePooled?: TokenAmount; quotePooled?: TokenAmount; sharePercent?: Decimal } {
    if (!pairInfo.tokenAmountBase || !pairInfo.tokenAmountQuote || !pairInfo.tokenAmountLp)
      return { basePooled: undefined, quotePooled: undefined, sharePercent: undefined };
    Decimal.set({ precision: 40 });
    const sharePercent = new Decimal(additionalTools.lpBalance?.toExact() || 0).div(pairInfo.tokenAmountLp.toExact());

    const basePooled =
      additionalTools.baseToken && sharePercent
        ? this.scope.mintToTokenAmount({
            mint: additionalTools.baseToken.mint,
            amount: sharePercent.mul(pairInfo.tokenAmountBase.toExact()).toString(),
          })
        : undefined;
    const quotePooled =
      additionalTools.quoteToken && sharePercent
        ? this.scope.mintToTokenAmount({
            mint: additionalTools.quoteToken.mint,
            amount: sharePercent.mul(pairInfo.tokenAmountQuote.toExact()).toString(),
          })
        : undefined;

    return {
      basePooled,
      quotePooled,
      sharePercent,
    };
  }

  get allPools(): LiquidityPoolJsonInfo[] {
    return this._poolInfos;
  }
  get allPoolIdSet(): { official: Set<string>; unOfficial: Set<string> } {
    return {
      official: this._officialIds,
      unOfficial: this._unOfficialIds,
    };
  }
  get allPoolMap(): Map<string, LiquidityPoolJsonInfo> {
    return this._poolInfoMap;
  }
  get allPairs(): PairJsonInfo[] {
    return this._pairsInfo;
  }
  get allPairsMap(): Map<string, PairJsonInfo> {
    return this._pairsInfoMap;
  }
  get lpTokenMap(): Map<string, Token> {
    return this._lpTokenMap;
  }
  get lpPriceMap(): Map<string, Price> {
    return this._lpPriceMap;
  }

  public async fetchMultipleInfo(params: LiquidityFetchMultipleInfoParams): Promise<LiquidityPoolInfo[]> {
    await this._stableLayout.initStableModelLayout();
    return await makeSimulationPoolInfo({ ...params, connection: this.scope.connection });
  }

  public async sdkParseJsonLiquidityInfo(
    liquidityJsonInfos: LiquidityPoolJsonInfo[],
  ): Promise<SDKParsedLiquidityInfo[]> {
    if (!liquidityJsonInfos.length) return [];

    const key = liquidityJsonInfos.map((jsonInfo) => jsonInfo.id).join("-");
    if (this._sdkParseInfoCache.has(key)) return this._sdkParseInfoCache.get(key)!;
    try {
      const info = await this.fetchMultipleInfo({ pools: liquidityJsonInfos.map(jsonInfo2PoolKeys) });
      const result = info.map((sdkParsed, idx) => ({
        jsonInfo: liquidityJsonInfos[idx],
        ...jsonInfo2PoolKeys(liquidityJsonInfos[idx]),
        ...sdkParsed,
      }));
      this._sdkParseInfoCache.set(key, result);
      return result;
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  public computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    outputToken,
    slippage,
  }: LiquidityComputeAmountOutParams): LiquidityComputeAmountOutReturn {
    this.checkDisabled();
    const logger = createLogger("Raydium_computeAmountOut");
    const tokenIn = amountIn.token;
    const tokenOut = outputToken;

    if (!includesToken(tokenIn, poolKeys) || !includesToken(tokenOut, poolKeys))
      logger.logWithError(
        "token not match with pool",
        "poolKeys",
        poolKeys.id.toBase58(),
        tokenIn.mint.toBase58(),
        tokenOut.mint.toBase58(),
      );

    const { baseReserve, quoteReserve } = poolInfo;
    this.logDebug("baseReserve:", baseReserve.toString(), "quoteReserve:", quoteReserve.toString());
    const inputToken = amountIn.token;
    this.logDebug("inputToken:", inputToken);

    this.logDebug("amountIn:", amountIn.toFixed());
    this.logDebug("outputToken:", outputToken);
    this.logDebug("slippage:", `${slippage.toSignificant()}%`);

    const reserves = [baseReserve, quoteReserve];
    const input = getAmountSide(amountIn, poolKeys);
    if (input === "quote") reserves.reverse();
    this.logDebug("input side:", input);
    const [reserveIn, reserveOut] = reserves;
    let currentPrice;
    if (poolKeys.version === 4) {
      currentPrice = new Price({
        baseToken: inputToken,
        denominator: reserveIn,
        quoteToken: outputToken,
        numerator: reserveOut,
      });
    } else {
      const p = getStablePrice(
        this._stableLayout.stableModelData,
        baseReserve.toNumber(),
        quoteReserve.toNumber(),
        false,
      );
      currentPrice = new Price({
        baseToken: inputToken,
        denominator: input === "quote" ? new BN(p * 1e6) : new BN(1e6),
        quoteToken: outputToken,
        numerator: input === "quote" ? new BN(1e6) : new BN(p * 1e6),
      });
    }
    this.logDebug("currentPrice:", `1 ${inputToken.symbol} ≈ ${currentPrice.toFixed()} ${outputToken.symbol}`);
    this.logDebug(
      "currentPrice invert:",
      `1 ${outputToken.symbol} ≈ ${currentPrice.invert().toFixed()} ${inputToken.symbol}`,
    );
    const amountInRaw = amountIn.raw;
    let amountOutRaw = BN_ZERO;
    let feeRaw = BN_ZERO;
    if (!amountInRaw.isZero()) {
      if (poolKeys.version === 4) {
        feeRaw = amountInRaw.mul(LIQUIDITY_FEES_NUMERATOR).div(LIQUIDITY_FEES_DENOMINATOR);
        const amountInWithFee = amountInRaw.sub(feeRaw);
        const denominator = reserveIn.add(amountInWithFee);
        amountOutRaw = reserveOut.mul(amountInWithFee).div(denominator);
      } else {
        feeRaw = amountInRaw.mul(new BN(2)).div(new BN(10000));
        const amountInWithFee = amountInRaw.sub(feeRaw);
        const convertFn = input === "quote" ? getDyByDxBaseIn : getDxByDyBaseIn;
        amountOutRaw = new BN(
          convertFn(
            this._stableLayout.stableModelData,
            quoteReserve.toNumber(),
            baseReserve.toNumber(),
            amountInWithFee.toNumber(),
          ),
        );
      }
    }

    const _slippage = new Percent(BN_ONE).add(slippage);
    const minAmountOutRaw = _slippage.invert().mul(amountOutRaw).quotient;
    const amountOut = new TokenAmount(outputToken, amountOutRaw);
    const minAmountOut = new TokenAmount(outputToken, minAmountOutRaw);
    this.logDebug("amountOut:", amountOut.toFixed(), "minAmountOut:", minAmountOut.toFixed());

    let executionPrice = new Price({
      baseToken: inputToken,
      denominator: amountInRaw.sub(feeRaw),
      quoteToken: outputToken,
      numerator: amountOutRaw,
    });
    if (!amountInRaw.isZero() && !amountOutRaw.isZero()) {
      executionPrice = new Price({
        baseToken: inputToken,
        denominator: amountInRaw.sub(feeRaw),
        quoteToken: outputToken,
        numerator: amountOutRaw,
      });

      this.logDebug("executionPrice:", `1 ${inputToken.symbol} ≈ ${executionPrice.toFixed()} ${outputToken.symbol}`);
      this.logDebug(
        "executionPrice invert:",
        `1 ${outputToken.symbol} ≈ ${executionPrice.invert().toFixed()} ${inputToken.symbol}`,
      );
    }

    const priceImpactDenominator = executionPrice.denominator.mul(currentPrice.numerator);
    const priceImpactNumerator = executionPrice.numerator
      .mul(currentPrice.denominator)
      .sub(priceImpactDenominator)
      .abs();
    const priceImpact = new Percent(priceImpactNumerator, priceImpactDenominator);

    logger.debug("priceImpact:", `${priceImpact.toSignificant()}%`);
    const fee = new TokenAmount(inputToken, feeRaw);

    return {
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    };
  }

  /**
   * Compute the another currency amount of add liquidity
   *
   * @param params - {@link LiquidityComputeAnotherAmountParams}
   *
   * @returns
   * anotherAmount - token amount without slippage
   * @returns
   * maxAnotherAmount - token amount with slippage
   *
   * @example
   * ```
   * Liquidity.computeAnotherAmount({
   *   // 1%
   *   slippage: new Percent(1, 100)
   * })
   * ```
   */
  public async computePairAmount({
    poolId,
    amount,
    anotherToken,
    slippage,
  }: LiquidityComputeAnotherAmountParams): Promise<{ anotherAmount: TokenAmount; maxAnotherAmount: TokenAmount }> {
    const poolIdPubKey = validateAndParsePublicKey({ publicKey: poolId });
    const poolInfo = this._poolInfoMap.get(poolIdPubKey.toBase58());
    if (!poolInfo) this.logAndCreateError("pool not found", poolIdPubKey.toBase58());
    const parsedInfo = (await this.sdkParseJsonLiquidityInfo([poolInfo!]))[0];
    if (!parsedInfo) this.logAndCreateError("pool parseInfo not found", poolIdPubKey.toBase58());

    const _amount = amount.token.mint.equals(SOLMint)
      ? this.scope.mintToTokenAmount({ mint: WSOLMint, amount: amount.toExact() })
      : amount;
    const _anotherToken = anotherToken.mint.equals(SOLMint) ? this.scope.mintToToken(WSOLMint) : anotherToken;

    const { baseReserve, quoteReserve } = parsedInfo;
    this.logDebug("baseReserve:", baseReserve.toString(), "quoteReserve:", quoteReserve.toString());

    const tokenIn = _amount.token;
    this.logDebug(
      "tokenIn:",
      tokenIn,
      "amount:",
      _amount.toFixed(),
      "anotherToken:",
      _anotherToken,
      "slippage:",
      `${slippage.toSignificant()}%`,
    );

    // input is fixed
    const input = getAmountSide(_amount, jsonInfo2PoolKeys(poolInfo!));
    this.logDebug("input side:", input);

    // round up
    let amountRaw = BN_ZERO;
    if (!_amount.isZero()) {
      amountRaw =
        input === "base"
          ? divCeil(_amount.raw.mul(quoteReserve), baseReserve)
          : divCeil(_amount.raw.mul(baseReserve), quoteReserve);
    }

    const _slippage = new Percent(BN_ONE).add(slippage);
    const slippageAdjustedAmount = _slippage.mul(amountRaw).quotient;

    const _anotherAmount = new TokenAmount(_anotherToken, amountRaw);
    const _maxAnotherAmount = new TokenAmount(_anotherToken, slippageAdjustedAmount);
    this.logDebug("anotherAmount:", _anotherAmount.toFixed(), "maxAnotherAmount:", _maxAnotherAmount.toFixed());

    return {
      anotherAmount: _anotherAmount,
      maxAnotherAmount: _maxAnotherAmount,
    };
  }

  public async swapWithAMM(params: LiquiditySwapTransactionParams): Promise<MakeMultiTransaction & SwapExtInfo> {
    const { poolKeys, payer, amountIn, amountOut, fixedSide, config } = params;
    this.logDebug("amountIn:", amountIn);
    this.logDebug("amountOut:", amountOut);
    if (amountIn.isZero() || amountOut.isZero())
      this.logAndCreateError("amounts must greater than zero", "amounts", {
        amountIn: amountIn.toFixed(),
        amountOut: amountOut.toFixed(),
      });
    const { account } = this.scope;
    const txBuilder = this.createTxBuilder();
    const { bypassAssociatedCheck = false } = config || {};

    const [tokenIn, tokenOut] = [amountIn.token, amountOut.token];
    const tokenAccountIn = await account.getCreatedTokenAccount({
      mint: tokenIn.mint,
      associatedOnly: false,
    });
    const tokenAccountOut = await account.getCreatedTokenAccount({
      mint: tokenOut.mint,
    });

    const [amountInRaw, amountOutRaw] = [amountIn.raw, amountOut.raw];

    const { tokenAccount: _tokenAccountIn, ...inTxInstructions } = await account.handleTokenAccount({
      side: "in",
      amount: amountInRaw,
      mint: tokenIn.mint,
      tokenAccount: tokenAccountIn,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(inTxInstructions);

    const { tokenAccount: _tokenAccountOut, ...outTxInstructions } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: tokenOut.mint,
      tokenAccount: tokenAccountOut,
      payer,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(outTxInstructions);
    const instructionTypes =
      fixedSide === "in"
        ? [poolKeys.version === 4 ? InstructionType.AmmV4SwapBaseIn : InstructionType.AmmV5SwapBaseIn]
        : [poolKeys.version === 4 ? InstructionType.AmmV4SwapBaseOut : InstructionType.AmmV5SwapBaseOut];
    txBuilder.addInstruction({
      instructions: [
        makeAMMSwapInstruction({
          poolKeys,
          userKeys: {
            tokenAccountIn: _tokenAccountIn!,
            tokenAccountOut: _tokenAccountOut!,
            owner: this.scope.ownerPubKey,
          },
          amountIn: amountInRaw,
          amountOut: amountOutRaw,
          fixedSide,
        }),
      ],
      instructionTypes,
    });
    return txBuilder.buildMultiTx({ extInfo: { amountOut } }) as MakeMultiTransaction & SwapExtInfo;
  }

  public async createPoolV4({
    programId,
    marketInfo,
    baseMintInfo,
    quoteMintInfo,
    baseAmount,
    quoteAmount,
    startTime,
    ownerInfo,
    associatedOnly = false,
  }: CreatePoolV4Param): Promise<MakeTransaction & { extInfo: { address: CreatePoolV4Address } }> {
    const payer = ownerInfo.feePayer || this.scope.owner?.publicKey;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && baseMintInfo.mint.equals(Token.WSOL.mint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && quoteMintInfo.mint.equals(Token.WSOL.mint);

    const txBuilder = this.createTxBuilder();

    const { account: ownerTokenAccountBase, instructionParams: ownerTokenAccountBaseInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: baseMintInfo.mint,
        owner: this.scope.ownerPubKey,
        createInfo: mintAUseSOLBalance
          ? {
              payer: payer!,
              amount: baseAmount,
            }
          : undefined,

        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
      });
    txBuilder.addInstruction(ownerTokenAccountBaseInstruction || {});

    const { account: ownerTokenAccountQuote, instructionParams: ownerTokenAccountQuoteInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: quoteMintInfo.mint,
        owner: this.scope.ownerPubKey,
        createInfo: mintBUseSOLBalance
          ? {
              payer: payer!,
              amount: quoteAmount,
            }
          : undefined,

        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
      });
    txBuilder.addInstruction(ownerTokenAccountQuoteInstruction || {});

    if (ownerTokenAccountBase === undefined || ownerTokenAccountQuote === undefined)
      throw Error("you don't has some token account");

    const poolInfo = getAssociatedPoolKeys({
      version: 4,
      marketVersion: 3,
      marketId: marketInfo.marketId,
      baseMint: baseMintInfo.mint,
      quoteMint: quoteMintInfo.mint,
      baseDecimals: baseMintInfo.decimals,
      quoteDecimals: quoteMintInfo.decimals,
      programId,
      marketProgramId: marketInfo.programId,
    });

    const createPoolKeys = {
      programId,
      ammId: poolInfo.id,
      ammAuthority: poolInfo.authority,
      ammOpenOrders: poolInfo.openOrders,
      lpMint: poolInfo.lpMint,
      coinMint: poolInfo.baseMint,
      pcMint: poolInfo.quoteMint,
      coinVault: poolInfo.baseVault,
      pcVault: poolInfo.quoteVault,
      withdrawQueue: poolInfo.withdrawQueue,
      ammTargetOrders: poolInfo.targetOrders,
      poolTempLp: poolInfo.lpVault,
      marketProgramId: poolInfo.marketProgramId,
      marketId: poolInfo.marketId,
    };

    const { instruction, instructionType } = makeCreatePoolV4InstructionV2({
      ...createPoolKeys,
      userWallet: this.scope.ownerPubKey,
      userCoinVault: ownerTokenAccountBase,
      userPcVault: ownerTokenAccountQuote,
      userLpVault: getATAAddress(this.scope.ownerPubKey, poolInfo.lpMint).publicKey,

      nonce: poolInfo.nonce,
      openTime: startTime,
      coinAmount: baseAmount,
      pcAmount: quoteAmount,
    });

    txBuilder.addInstruction({
      instructions: [instruction],
      instructionTypes: [instructionType],
    });

    await txBuilder.calComputeBudget();

    return txBuilder.build<{ address: CreatePoolV4Address }>({
      address: createPoolKeys,
    });
  }

  public async createPool(params: CreatePoolParam): Promise<MakeTransaction> {
    this.checkDisabled();
    this.scope.checkOwner();
    if (params.version !== 4) this.logAndCreateError("invalid version", "poolKeys.version", params.version);
    const txBuilder = this.createTxBuilder();
    const poolKeys = await getAssociatedPoolKeys(params);

    return await txBuilder
      .addInstruction({
        instructions: [makeCreatePoolInstruction({ ...poolKeys, owner: this.scope.ownerPubKey })],
      })
      .build();
  }

  public async initPool(params: InitPoolParam): Promise<MakeTransaction> {
    if (params.version !== 4) this.logAndCreateError("invalid version", "poolKeys.version", params.version);
    const { baseAmount, quoteAmount, startTime = 0, config } = params;
    const poolKeys = await getAssociatedPoolKeys(params);
    const { baseMint, quoteMint, lpMint, baseVault, quoteVault } = poolKeys;
    const txBuilder = this.createTxBuilder();
    const { account } = this.scope;

    const bypassAssociatedCheck = !!config?.bypassAssociatedCheck;
    const baseTokenAccount = await account.getCreatedTokenAccount({
      mint: baseMint,
      associatedOnly: false,
    });
    const quoteTokenAccount = await account.getCreatedTokenAccount({
      mint: quoteMint,
      associatedOnly: false,
    });

    if (!baseTokenAccount && !quoteTokenAccount)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", account.tokenAccounts);

    const lpTokenAccount = await account.getCreatedTokenAccount({
      mint: lpMint,
      associatedOnly: false,
    });

    const { tokenAccount: _baseTokenAccount, ...baseTokenAccountInstruction } = await account.handleTokenAccount({
      side: "in",
      amount: baseAmount.raw,
      mint: baseMint,
      tokenAccount: baseTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(baseTokenAccountInstruction);

    const { tokenAccount: _quoteTokenAccount, ...quoteTokenAccountInstruction } = await account.handleTokenAccount({
      side: "in",
      amount: quoteAmount.raw,
      mint: quoteMint,
      tokenAccount: quoteTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(quoteTokenAccountInstruction);
    const { tokenAccount: _lpTokenAccount, ...lpTokenAccountInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: lpMint,
      tokenAccount: lpTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(lpTokenAccountInstruction);
    // initPoolLayout
    txBuilder.addInstruction({
      instructions: [
        makeTransferInstruction({
          source: _baseTokenAccount!,
          destination: baseVault,
          owner: this.scope.ownerPubKey,
          amount: baseAmount.raw,
        }),
        makeTransferInstruction({
          source: _quoteTokenAccount!,
          destination: quoteVault,
          owner: this.scope.ownerPubKey,
          amount: quoteAmount.raw,
        }),
        makeInitPoolInstruction({
          poolKeys,
          userKeys: { lpTokenAccount: _lpTokenAccount!, payer: this.scope.ownerPubKey },
          startTime,
        }),
      ],
      instructionTypes: [InstructionType.TransferAmount, InstructionType.AmmV4InitPool],
    });

    return txBuilder.build();
  }

  public async addLiquidity(params: LiquidityAddTransactionParams): Promise<MakeTransaction> {
    const { poolId, amountInA: _amountInA, amountInB: _amountInB, fixedSide, config } = params;
    const _poolId = validateAndParsePublicKey({ publicKey: poolId });
    const poolInfo = this.allPools.find((pool) => pool.id === _poolId.toBase58());

    if (!poolInfo) this.logAndCreateError("pool not found", poolId);
    const amountInA = this.scope.mintToTokenAmount({
      mint: solToWSol(_amountInA.token.mint),
      amount: _amountInA.toExact(),
    });
    const amountInB = this.scope.mintToTokenAmount({
      mint: solToWSol(_amountInB.token.mint),
      amount: _amountInB.toExact(),
    });
    const poolKeysList = await this.sdkParseJsonLiquidityInfo([poolInfo!]);
    const poolKeys = poolKeysList[0];
    if (!poolKeys) this.logAndCreateError("pool parse error", poolKeys);

    this.logDebug("amountInA:", amountInA, "amountInB:", amountInB);
    if (amountInA.isZero() || amountInB.isZero())
      this.logAndCreateError("amounts must greater than zero", "amountInA & amountInB", {
        amountInA: amountInA.toFixed(),
        amountInB: amountInB.toFixed(),
      });
    const { account } = this.scope;
    const bypassAssociatedCheck = config?.bypassAssociatedCheck || false;
    const [tokenA, tokenB] = [amountInA.token, amountInB.token];

    const tokenAccountA = await account.getCreatedTokenAccount({
      mint: tokenA.mint,
      associatedOnly: false,
    });
    const tokenAccountB = await account.getCreatedTokenAccount({
      mint: tokenB.mint,
      associatedOnly: false,
    });
    if (!tokenAccountA && !tokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", account.tokenAccounts);

    const lpTokenAccount = await account.getCreatedTokenAccount({
      mint: poolKeys.lpMint,
    });

    const tokens = [tokenA, tokenB];
    const _tokenAccounts = [tokenAccountA, tokenAccountB];
    const rawAmounts = [amountInA.raw, amountInB.raw];

    // handle amount a & b and direction
    const [sideA] = getAmountsSide(amountInA, amountInB, poolKeys);
    let _fixedSide: AmountSide = "base";
    if (!["quote", "base"].includes(sideA) || !isValidFixedSide(fixedSide))
      this.logAndCreateError("invalid fixedSide", "fixedSide", fixedSide);
    if (sideA === "quote") {
      tokens.reverse();
      _tokenAccounts.reverse();
      rawAmounts.reverse();
      _fixedSide = fixedSide === "a" ? "quote" : "base";
    } else if (sideA === "base") {
      _fixedSide = fixedSide === "a" ? "base" : "quote";
    }

    const [baseToken, quoteToken] = tokens;
    const [baseTokenAccount, quoteTokenAccount] = _tokenAccounts;
    const [baseAmountRaw, quoteAmountRaw] = rawAmounts;
    const txBuilder = this.createTxBuilder();

    const { tokenAccount: _baseTokenAccount, ...baseInstruction } = await account.handleTokenAccount({
      side: "in",
      amount: baseAmountRaw,
      mint: baseToken.mint,
      tokenAccount: baseTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(baseInstruction);
    const { tokenAccount: _quoteTokenAccount, ...quoteInstruction } = await account.handleTokenAccount({
      side: "in",
      amount: quoteAmountRaw,
      mint: quoteToken.mint,
      tokenAccount: quoteTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(quoteInstruction);
    const { tokenAccount: _lpTokenAccount, ...lpInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: poolKeys.lpMint,
      tokenAccount: lpTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(lpInstruction);
    txBuilder.addInstruction({
      instructions: [
        makeAddLiquidityInstruction({
          poolKeys,
          userKeys: {
            baseTokenAccount: _baseTokenAccount!,
            quoteTokenAccount: _quoteTokenAccount!,
            lpTokenAccount: _lpTokenAccount!,
            owner: this.scope.ownerPubKey,
          },
          baseAmountIn: baseAmountRaw,
          quoteAmountIn: quoteAmountRaw,
          fixedSide: _fixedSide,
        }),
      ],
      instructionTypes: [
        poolInfo!.version === 4 ? InstructionType.AmmV4AddLiquidity : InstructionType.AmmV5AddLiquidity,
      ],
    });
    return txBuilder.build();
  }

  public async removeLiquidity(params: LiquidityRemoveTransactionParams): Promise<MakeTransaction> {
    const { poolId, amountIn, config } = params;
    const _poolId = validateAndParsePublicKey({ publicKey: poolId });
    const poolInfo = this.allPools.find((pool) => pool.id === _poolId.toBase58());
    if (!poolInfo) this.logAndCreateError("pool not found", poolId);
    const poolKeysList = await this.sdkParseJsonLiquidityInfo([poolInfo!]);
    const poolKeys = poolKeysList[0];
    if (!poolKeys) this.logAndCreateError("pool pass error", poolKeys);

    const { baseMint, quoteMint, lpMint } = poolKeys;
    this.logDebug("amountIn:", amountIn);
    if (amountIn.isZero()) this.logAndCreateError("amount must greater than zero", "amountIn", amountIn.toFixed());
    if (!amountIn.token.mint.equals(lpMint))
      this.logAndCreateError("amountIn's token not match lpMint", "amountIn", amountIn);

    const { account } = this.scope;
    const lpTokenAccount = await account.getCreatedTokenAccount({
      mint: lpMint,
      associatedOnly: false,
    });
    if (!lpTokenAccount) this.logAndCreateError("cannot found lpTokenAccount", "tokenAccounts", account.tokenAccounts);

    const baseTokenAccount = await account.getCreatedTokenAccount({
      mint: baseMint,
    });
    const quoteTokenAccount = await account.getCreatedTokenAccount({
      mint: quoteMint,
    });

    const txBuilder = this.createTxBuilder();
    const bypassAssociatedCheck = config?.bypassAssociatedCheck || false;

    const { tokenAccount: _baseTokenAccount, ...baseInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: baseMint,
      tokenAccount: baseTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(baseInstruction);
    const { tokenAccount: _quoteTokenAccount, ...quoteInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: quoteMint,
      tokenAccount: quoteTokenAccount,
      bypassAssociatedCheck,
    });
    txBuilder.addInstruction(quoteInstruction);

    txBuilder.addInstruction({
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 400000,
        }),
        makeRemoveLiquidityInstruction({
          poolKeys,
          userKeys: {
            lpTokenAccount: lpTokenAccount!,
            baseTokenAccount: _baseTokenAccount!,
            quoteTokenAccount: _quoteTokenAccount!,
            owner: this.scope.ownerPubKey,
          },
          amountIn: amountIn.raw,
        }),
      ],
      instructionTypes: [
        poolKeys!.version === 4 ? InstructionType.AmmV4RemoveLiquidity : InstructionType.AmmV5RemoveLiquidity,
      ],
    });
    return txBuilder.build();
  }

  public lpMintToTokenAmount({
    poolId,
    amount,
    decimalDone,
  }: {
    poolId: PublicKeyish;
    amount: Numberish;
    decimalDone?: boolean;
  }): TokenAmount {
    const poolKey = validateAndParsePublicKey({ publicKey: poolId });
    if (!poolKey) this.logAndCreateError("pool not found");
    const poolInfo = this._poolInfoMap.get(poolKey.toBase58())!;

    const numberDetails = parseNumberInfo(amount);
    const token = new Token({ mint: poolInfo.lpMint, decimals: poolInfo.lpDecimals });
    const amountFraction = decimalDone
      ? new Fraction(numberDetails.numerator, numberDetails.denominator)
      : new Fraction(numberDetails.numerator, numberDetails.denominator).mul(new BN(10).pow(new BN(token.decimals)));
    return new TokenAmount(token, toBN(amountFraction));
  }

  public getFixedSide({ poolId, inputMint }: { poolId: PublicKeyish; inputMint: PublicKeyish }): LiquiditySide {
    const [_poolId, _inputMint] = [
      validateAndParsePublicKey({ publicKey: poolId }),
      validateAndParsePublicKey({ publicKey: inputMint }),
    ];
    const pool = this._poolInfoMap.get(_poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found", _poolId.toBase58());
    let isSideA = pool!.baseMint === _inputMint.toBase58();
    if (_inputMint.equals(WSOLMint) || _inputMint.equals(SOLMint)) isSideA = !isSideA;
    return isSideA ? "a" : "b";
  }
}
