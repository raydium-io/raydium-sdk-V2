import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createTransferInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

import { ClmmPoolInfo, ReturnTypeFetchMultiplePoolTickArrays, PoolUtils } from "../clmm";
import {
  forecastTransactionSize,
  jsonInfo2PoolKeys,
  parseSimulateLogToJson,
  parseSimulateValue,
  simulateMultipleInstruction,
  solToWSol,
  TxBuilder,
  BN_ZERO,
  SOLMint,
  PublicKeyish,
  WSOLMint,
  addComputeBudget,
  minExpirationTime,
} from "../../common";
import { Fraction, Percent, Price, Token, TokenAmount } from "../../module";
import { StableLayout, makeSimulatePoolInfoInstruction, LiquidityPoolJsonInfo, LiquidityPoolKeys } from "../liquidity";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  ComputeAmountOutLayout,
  ComputeAmountOutRouteLayout,
  PoolType,
  PoolAccountInfoV4,
  ReturnTypeGetAddLiquidityDefaultPool,
  ReturnTypeFetchMultipleInfo,
  ReturnTypeGetAllRoute,
  RoutePathType,
} from "./type";
import { makeSwapInstruction } from "./instrument";
import { MakeMultiTransaction, MakeTransaction, ReturnTypeFetchMultipleMintInfos, TransferAmountFee } from "../type";
import { InstructionType } from "../../common/txTool/txType";
import { BigNumberish, parseBigNumberish } from "../../common/bignumber";
import {
  createWSolAccountInstructions,
  closeAccountInstruction,
  makeTransferInstruction,
} from "../account/instruction";
import { TokenAccount } from "../account/types";

export default class TradeV2 extends ModuleBase {
  private _stableLayout: StableLayout;

  constructor(params: ModuleBaseProps) {
    super(params);
    this._stableLayout = new StableLayout({ connection: this.scope.connection });
  }

  public getAllRoute({
    inputMint,
    outputMint,
    allowedRouteToken2022 = false,
  }: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    allowedRouteToken2022?: boolean;
  }): ReturnTypeGetAllRoute {
    const [input, output] = [solToWSol(inputMint), solToWSol(outputMint)];
    const needSimulate: { [poolKey: string]: LiquidityPoolJsonInfo } = {};
    const needTickArray: { [poolKey: string]: ClmmPoolInfo } = {};
    const needCheckToken: Set<string> = new Set();

    const directPath: PoolType[] = [];

    const routePathDict: RoutePathType = {}; // {[route mint: string]: {in: [] , out: []}}

    for (const pool of this.scope.clmm.pools.sdkParsedData) {
      const itemAmmPool = pool.state;
      if (
        (itemAmmPool.mintA.mint.equals(input) && itemAmmPool.mintB.mint.equals(output)) ||
        (itemAmmPool.mintA.mint.equals(output) && itemAmmPool.mintB.mint.equals(input))
      ) {
        directPath.push(itemAmmPool);
        needTickArray[itemAmmPool.id.toString()] = itemAmmPool;
      }

      if (
        itemAmmPool.mintA.mint.equals(input) &&
        (itemAmmPool.mintB.programId.equals(TOKEN_PROGRAM_ID) || allowedRouteToken2022)
      ) {
        const t = itemAmmPool.mintB.mint.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: itemAmmPool.mintB.programId,
            in: [],
            out: [],
            mDecimals: itemAmmPool.mintB.decimals,
          };
        routePathDict[t].in.push(itemAmmPool);
      }

      if (
        itemAmmPool.mintB.mint.equals(input) &&
        (itemAmmPool.mintA.programId.equals(TOKEN_PROGRAM_ID) || allowedRouteToken2022)
      ) {
        const t = itemAmmPool.mintA.mint.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: itemAmmPool.mintA.programId,
            in: [],
            out: [],
            mDecimals: itemAmmPool.mintA.decimals,
          };
        routePathDict[t].in.push(itemAmmPool);
      }

      if (
        itemAmmPool.mintA.mint.equals(output) &&
        (itemAmmPool.mintB.programId.equals(TOKEN_PROGRAM_ID) || allowedRouteToken2022)
      ) {
        const t = itemAmmPool.mintB.mint.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: itemAmmPool.mintB.programId,
            in: [],
            out: [],
            mDecimals: itemAmmPool.mintB.decimals,
          };
        routePathDict[t].out.push(itemAmmPool);
      }

      if (
        itemAmmPool.mintB.mint.equals(output) &&
        (itemAmmPool.mintA.programId.equals(TOKEN_PROGRAM_ID) || allowedRouteToken2022)
      ) {
        const t = itemAmmPool.mintA.mint.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: itemAmmPool.mintA.programId,
            in: [],
            out: [],
            mDecimals: itemAmmPool.mintA.decimals,
          };
        routePathDict[t].out.push(itemAmmPool);
      }
    }

    const addLiquidityPools: LiquidityPoolJsonInfo[] = [];

    const _inputMint = input.toString();
    const _outputMint = output.toString();
    for (const itemAmmPool of (this.scope.apiData.liquidityPools?.data || {}).official || []) {
      if (
        (itemAmmPool.baseMint === _inputMint && itemAmmPool.quoteMint === _outputMint) ||
        (itemAmmPool.baseMint === _outputMint && itemAmmPool.quoteMint === _inputMint)
      ) {
        directPath.push(itemAmmPool);
        needSimulate[itemAmmPool.id] = itemAmmPool;
        addLiquidityPools.push(itemAmmPool);
      }
      if (itemAmmPool.baseMint === _inputMint) {
        if (routePathDict[itemAmmPool.quoteMint] === undefined)
          routePathDict[itemAmmPool.quoteMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.quoteDecimals,
          };
        routePathDict[itemAmmPool.quoteMint].in.push(itemAmmPool);
      }
      if (itemAmmPool.quoteMint === _inputMint) {
        if (routePathDict[itemAmmPool.baseMint] === undefined)
          routePathDict[itemAmmPool.baseMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.baseDecimals,
          };
        routePathDict[itemAmmPool.baseMint].in.push(itemAmmPool);
      }
      if (itemAmmPool.baseMint === _outputMint) {
        if (routePathDict[itemAmmPool.quoteMint] === undefined)
          routePathDict[itemAmmPool.quoteMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.quoteDecimals,
          };
        routePathDict[itemAmmPool.quoteMint].out.push(itemAmmPool);
      }
      if (itemAmmPool.quoteMint === _outputMint) {
        if (routePathDict[itemAmmPool.baseMint] === undefined)
          routePathDict[itemAmmPool.baseMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.baseDecimals,
          };
        routePathDict[itemAmmPool.baseMint].out.push(itemAmmPool);
      }
    }
    const _insertAddLiquidityPool = addLiquidityPools.length === 0;
    for (const itemAmmPool of (this.scope.apiData.liquidityPools?.data || {}).unOfficial || []) {
      if (
        (itemAmmPool.baseMint === _inputMint && itemAmmPool.quoteMint === _outputMint) ||
        (itemAmmPool.baseMint === _outputMint && itemAmmPool.quoteMint === _inputMint)
      ) {
        directPath.push(itemAmmPool);
        needSimulate[itemAmmPool.id] = itemAmmPool;
        if (_insertAddLiquidityPool) addLiquidityPools.push(itemAmmPool);
      }
      if (itemAmmPool.baseMint === _inputMint) {
        if (routePathDict[itemAmmPool.quoteMint] === undefined)
          routePathDict[itemAmmPool.quoteMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.quoteDecimals,
          };
        routePathDict[itemAmmPool.quoteMint].in.push(itemAmmPool);
      }
      if (itemAmmPool.quoteMint === _inputMint) {
        if (routePathDict[itemAmmPool.baseMint] === undefined)
          routePathDict[itemAmmPool.baseMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.baseDecimals,
          };
        routePathDict[itemAmmPool.baseMint].in.push(itemAmmPool);
      }
      if (itemAmmPool.baseMint === _outputMint) {
        if (routePathDict[itemAmmPool.quoteMint] === undefined)
          routePathDict[itemAmmPool.quoteMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.quoteDecimals,
          };
        routePathDict[itemAmmPool.quoteMint].out.push(itemAmmPool);
      }
      if (itemAmmPool.quoteMint === _outputMint) {
        if (routePathDict[itemAmmPool.baseMint] === undefined)
          routePathDict[itemAmmPool.baseMint] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: itemAmmPool.baseDecimals,
          };
        routePathDict[itemAmmPool.baseMint].out.push(itemAmmPool);
      }
    }

    for (const t of Object.keys(routePathDict)) {
      if (
        routePathDict[t].in.length === 1 &&
        routePathDict[t].out.length === 1 &&
        String(routePathDict[t].in[0].id) === String(routePathDict[t].out[0].id)
      ) {
        delete routePathDict[t];
        continue;
      }
      if (routePathDict[t].in.length === 0 || routePathDict[t].out.length === 0) {
        delete routePathDict[t];
        continue;
      }

      const info = routePathDict[t];

      for (const infoIn of info.in) {
        for (const infoOut of info.out) {
          if (infoIn.version === 6 && needTickArray[infoIn.id.toString()] === undefined) {
            needTickArray[infoIn.id.toString()] = infoIn as ClmmPoolInfo;

            if (infoIn.mintA.programId.equals(TOKEN_2022_PROGRAM_ID)) needCheckToken.add(infoIn.mintA.mint.toString());
            if (infoIn.mintB.programId.equals(TOKEN_2022_PROGRAM_ID)) needCheckToken.add(infoIn.mintB.mint.toString());
          } else if (infoIn.version !== 6 && needSimulate[infoIn.id as string] === undefined) {
            needSimulate[infoIn.id as string] = infoIn as LiquidityPoolJsonInfo;
          }

          if (infoOut.version === 6 && needTickArray[infoOut.id.toString()] === undefined) {
            needTickArray[infoOut.id.toString()] = infoOut as ClmmPoolInfo;

            if (infoOut.mintA.programId.equals(TOKEN_2022_PROGRAM_ID))
              needCheckToken.add(infoOut.mintA.mint.toString());
            if (infoOut.mintB.programId.equals(TOKEN_2022_PROGRAM_ID))
              needCheckToken.add(infoOut.mintB.mint.toString());
          } else if (infoOut.version !== 6 && needSimulate[infoOut.id as string] === undefined) {
            needSimulate[infoOut.id as string] = infoOut as LiquidityPoolJsonInfo;
          }
        }
      }
    }

    for (const item of directPath) {
      if (item.version === 6) {
        if (item.mintA.programId.equals(TOKEN_2022_PROGRAM_ID)) needCheckToken.add(item.mintA.mint.toString());
        if (item.mintB.programId.equals(TOKEN_2022_PROGRAM_ID)) needCheckToken.add(item.mintB.mint.toString());
      }
    }

    return {
      directPath,
      addLiquidityPools,
      routePathDict,
      needSimulate: Object.values(needSimulate),
      needTickArray: Object.values(needTickArray),
      needCheckToken: [...needCheckToken],
    };
  }

  public async fetchPoolAndTickData({
    inputMint,
    outputMint,
    batchRequest = true,
  }: {
    inputMint: PublicKeyish;
    outputMint: PublicKeyish;
    batchRequest?: boolean;
  }): Promise<{
    routes: ReturnTypeGetAllRoute;
    ticks: ReturnTypeFetchMultiplePoolTickArrays;
    poolsInfo: ReturnTypeFetchMultipleInfo;
  }> {
    const [input, output] = [solToWSol(inputMint), solToWSol(outputMint)];
    const routes = this.getAllRoute({ inputMint: input, outputMint: output });
    const ticks = await PoolUtils.fetchMultiplePoolTickArrays({
      connection: this.scope.connection,
      poolKeys: routes.needTickArray,
      batchRequest,
    });
    const poolsInfo = await this.fetchMultipleInfo({
      pools: routes.needSimulate,
      batchRequest,
    });
    return { routes, ticks, poolsInfo };
  }

  public async fetchMultipleInfo({
    pools,
    batchRequest = true,
  }: {
    pools: LiquidityPoolJsonInfo[];
    batchRequest?: boolean;
  }): Promise<ReturnTypeFetchMultipleInfo> {
    if (pools.find((i) => i.version === 5)) await this._stableLayout.initStableModelLayout();

    const instructions = pools.map((pool) => makeSimulatePoolInfoInstruction(jsonInfo2PoolKeys(pool)));

    const logs = await simulateMultipleInstruction(this.scope.connection, instructions, "GetPoolData", batchRequest);

    const poolsInfo: ReturnTypeFetchMultipleInfo = {};
    for (const log of logs) {
      const json = parseSimulateLogToJson(log, "GetPoolData");

      const ammId = JSON.parse(json)["amm_id"];
      const status = new BN(parseSimulateValue(json, "status"));
      const baseDecimals = Number(parseSimulateValue(json, "coin_decimals"));
      const quoteDecimals = Number(parseSimulateValue(json, "pc_decimals"));
      const lpDecimals = Number(parseSimulateValue(json, "lp_decimals"));
      const baseReserve = new BN(parseSimulateValue(json, "pool_coin_amount"));
      const quoteReserve = new BN(parseSimulateValue(json, "pool_pc_amount"));
      const lpSupply = new BN(parseSimulateValue(json, "pool_lp_supply"));
      // TODO fix it when split stable
      let startTime = "0";
      try {
        startTime = parseSimulateValue(json, "pool_open_time");
      } catch (error) {
        //
      }

      poolsInfo[ammId] = {
        ammId,
        status,
        baseDecimals,
        quoteDecimals,
        lpDecimals,
        baseReserve,
        quoteReserve,
        lpSupply,
        startTime: new BN(startTime),
      };
    }

    return poolsInfo;
  }

  static getAddLiquidityDefaultPool({
    addLiquidityPools,
    poolInfosCache,
  }: {
    addLiquidityPools: LiquidityPoolJsonInfo[];
    poolInfosCache: { [ammId: string]: PoolAccountInfoV4 };
  }): ReturnTypeGetAddLiquidityDefaultPool {
    if (addLiquidityPools.length === 0) return undefined;
    if (addLiquidityPools.length === 1) return addLiquidityPools[0];
    addLiquidityPools.sort((a, b) => b.version - a.version);
    if (addLiquidityPools[0].version !== addLiquidityPools[1].version) return addLiquidityPools[0];

    const _addLiquidityPools = addLiquidityPools.filter((i) => i.version === addLiquidityPools[0].version);

    _addLiquidityPools.sort((a, b) => this.comparePoolSize(a, b, poolInfosCache));
    return _addLiquidityPools[0];
  }

  private static comparePoolSize(
    a: LiquidityPoolJsonInfo,
    b: LiquidityPoolJsonInfo,
    ammIdToPoolInfo: { [ammId: string]: PoolAccountInfoV4 },
  ): number {
    const aInfo = ammIdToPoolInfo[a.id];
    const bInfo = ammIdToPoolInfo[b.id];
    if (aInfo === undefined) return 1;
    if (bInfo === undefined) return -1;

    if (a.baseMint === b.baseMint) {
      const sub = aInfo.baseReserve.sub(bInfo.baseReserve);
      return sub.gte(BN_ZERO) ? -1 : 1;
    } else {
      const sub = aInfo.baseReserve.sub(bInfo.quoteReserve);
      return sub.gte(BN_ZERO) ? -1 : 1;
    }
  }

  public async getAllRouteComputeAmountOut({
    inputTokenAmount,
    outputToken: orgOut,
    directPath,
    routePathDict,
    simulateCache,
    tickCache,
    slippage,
    chainTime,
    feeConfig,
    mintInfos,
  }: {
    directPath: PoolType[];
    routePathDict: RoutePathType;
    simulateCache: ReturnTypeFetchMultipleInfo;
    tickCache: ReturnTypeFetchMultiplePoolTickArrays;
    inputTokenAmount: TokenAmount;
    outputToken: Token;
    slippage: Percent;
    chainTime: number;
    feeConfig?: {
      feeBps: BN;
      feeAccount: PublicKey;
    };
    mintInfos: ReturnTypeFetchMultipleMintInfos;
  }): Promise<{
    routes: ComputeAmountOutLayout[];
    best?: ComputeAmountOutLayout;
  }> {
    const epochInfo = await this.scope.fetchEpochInfo();
    const input = this.scope.solToWsolTokenAmount(inputTokenAmount);
    const _amountIn =
      feeConfig === undefined ? BN_ZERO : input.raw.mul(new BN(10000 - feeConfig.feeBps.toNumber())).div(new BN(10000));
    const amountIn = feeConfig === undefined ? input : new TokenAmount(input.token, _amountIn, true);
    const _inFeeConfig =
      feeConfig === undefined
        ? undefined
        : {
            feeAmount: _amountIn,
            feeAccount: feeConfig.feeAccount,
          };

    const outputToken = this.scope.mintToToken(solToWSol(orgOut.mint));
    const outRoute: ComputeAmountOutLayout[] = [];

    for (const itemPool of directPath) {
      if (itemPool.version === 6) {
        try {
          const {
            realAmountIn,
            amountOut,
            minAmountOut,
            expirationTime,
            currentPrice,
            executionPrice,
            priceImpact,
            fee,
            remainingAccounts,
          } = await PoolUtils.computeAmountOutFormat({
            poolInfo: itemPool as ClmmPoolInfo,
            tickArrayCache: tickCache[itemPool.id.toString()],
            amountIn,
            tokenOut: outputToken,
            slippage,
            token2022Infos: mintInfos,
            epochInfo,
          });
          outRoute.push({
            amountIn: realAmountIn,
            amountOut,
            minAmountOut,
            currentPrice,
            executionPrice,
            priceImpact,
            fee: [fee],
            remainingAccounts: [remainingAccounts],
            routeType: "amm",
            poolKey: [itemPool],
            poolReady: (itemPool as ClmmPoolInfo).startTime < chainTime,
            poolType: "CLMM",
            feeConfig: _inFeeConfig,
            expirationTime: minExpirationTime(realAmountIn.expirationTime, expirationTime),
          });
        } catch (e) {
          //
        }
      } else {
        try {
          if (![1, 6, 7].includes(simulateCache[itemPool.id as string].status.toNumber())) continue;
          const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } =
            this.scope.liquidity.computeAmountOut({
              poolKeys: jsonInfo2PoolKeys(itemPool) as LiquidityPoolKeys,
              poolInfo: simulateCache[itemPool.id as string],
              amountIn,
              outputToken,
              slippage,
            });
          outRoute.push({
            amountIn: { amount: amountIn, fee: undefined, expirationTime: undefined },
            amountOut: { amount: amountOut, fee: undefined, expirationTime: undefined },
            minAmountOut: { amount: minAmountOut, fee: undefined, expirationTime: undefined },
            currentPrice,
            executionPrice,
            priceImpact,
            fee: [fee],
            routeType: "amm",
            poolKey: [itemPool],
            remainingAccounts: [],
            poolReady: simulateCache[itemPool.id as string].startTime.toNumber() < chainTime,
            poolType: itemPool.version === 5 ? "STABLE" : undefined,
            feeConfig: _inFeeConfig,
            expirationTime: undefined,
          });
        } catch (e) {
          //
        }
      }
    }
    for (const [routeMint, info] of Object.entries(routePathDict)) {
      for (const iFromPool of info.in) {
        if (!simulateCache[iFromPool.id as string] && !tickCache[iFromPool.id.toString()]) continue;
        if (iFromPool.version !== 6 && ![1, 6, 7].includes(simulateCache[iFromPool.id as string].status.toNumber()))
          continue;
        for (const iOutPool of info.out) {
          if (!simulateCache[iOutPool.id as string] && !tickCache[iOutPool.id.toString()]) continue;
          if (iOutPool.version !== 6 && ![1, 6, 7].includes(simulateCache[iOutPool.id as string].status.toNumber()))
            continue;
          try {
            const {
              amountOut,
              minAmountOut,
              executionPrice,
              priceImpact,
              fee,
              remainingAccounts,
              minMiddleAmountFee,
              middleToken,
              expirationTime,
              realAmountIn,
            } = await this.computeAmountOut({
              middleMintInfo: {
                mint: new PublicKey(routeMint),
                decimals: info.mDecimals,
              },
              amountIn,
              currencyOut: outputToken,
              slippage,

              fromPool: iFromPool,
              toPool: iOutPool,
              simulateCache,
              tickCache,
              mintInfos,
            });

            const infoAPoolOpen =
              iFromPool.version === 6
                ? (iFromPool as ClmmPoolInfo).startTime < chainTime
                : simulateCache[iFromPool.id as string].startTime.toNumber() < chainTime;
            const infoBPoolOpen =
              iOutPool.version === 6
                ? (iOutPool as ClmmPoolInfo).startTime < chainTime
                : simulateCache[iOutPool.id as string].startTime.toNumber() < chainTime;

            const poolTypeA = iFromPool.version === 6 ? "CLMM" : iFromPool.version === 5 ? "STABLE" : undefined;
            const poolTypeB = iOutPool.version === 6 ? "CLMM" : iOutPool.version === 5 ? "STABLE" : undefined;
            outRoute.push({
              amountIn: realAmountIn,
              amountOut,
              minAmountOut,
              currentPrice: undefined,
              executionPrice,
              priceImpact,
              fee,
              routeType: "route",
              poolKey: [iFromPool, iOutPool],
              remainingAccounts,
              minMiddleAmountFee,
              middleToken,
              poolReady: infoAPoolOpen && infoBPoolOpen,
              poolType: [poolTypeA, poolTypeB],
              feeConfig: _inFeeConfig,
              expirationTime,
            });
          } catch (e) {
            //
          }
        }
      }
    }
    outRoute.sort((a, b) => (a.amountOut.amount.raw.sub(b.amountOut.amount.raw).gt(BN_ZERO) ? -1 : 1));
    const isReadyRoutes = outRoute.filter((i) => i.poolReady);

    return {
      routes: outRoute,
      best: isReadyRoutes.length ? isReadyRoutes[0] : outRoute[0],
    };
  }

  private async computeAmountOut({
    middleMintInfo,
    amountIn,
    currencyOut,
    slippage,

    fromPool,
    toPool,
    simulateCache,
    tickCache,
    mintInfos,
  }: {
    middleMintInfo: { mint: PublicKey; decimals: number };
    amountIn: TokenAmount;
    currencyOut: Token;
    slippage: Percent;
    fromPool: PoolType;
    toPool: PoolType;
    simulateCache: ReturnTypeFetchMultipleInfo;
    tickCache: ReturnTypeFetchMultiplePoolTickArrays;
    mintInfos: ReturnTypeFetchMultipleMintInfos;
  }): Promise<{
    minMiddleAmountFee: TokenAmount | undefined;
    middleToken: Token;
    realAmountIn: TransferAmountFee;
    amountOut: TransferAmountFee;
    minAmountOut: TransferAmountFee;
    executionPrice: Price | null;
    priceImpact: Fraction;
    fee: TokenAmount[];
    remainingAccounts: [PublicKey[] | undefined, PublicKey[] | undefined];
    expirationTime: number | undefined;
  }> {
    const epochInfo = await this.scope.fetchEpochInfo();
    const middleToken = new Token(middleMintInfo);

    let firstPriceImpact: Percent;
    let firstFee: TokenAmount;
    let firstRemainingAccounts: PublicKey[] | undefined = undefined;
    let minMiddleAmountOut: TransferAmountFee;
    let firstExpirationTime: number | undefined = undefined;
    let realAmountIn: TransferAmountFee = {
      amount: amountIn,
      fee: undefined,
      expirationTime: undefined,
    };

    const _slippage = new Percent(0, 100);

    if (fromPool.version === 6) {
      const {
        minAmountOut: _minMiddleAmountOut,
        priceImpact: _firstPriceImpact,
        fee: _firstFee,
        remainingAccounts: _firstRemainingAccounts,
        expirationTime: _expirationTime,
        realAmountIn: _realAmountIn,
      } = await PoolUtils.computeAmountOutFormat({
        poolInfo: fromPool as ClmmPoolInfo,
        tickArrayCache: tickCache[fromPool.id.toString()],
        amountIn,
        tokenOut: middleToken,
        slippage: _slippage,
        epochInfo,
        token2022Infos: mintInfos,
      });
      minMiddleAmountOut = _minMiddleAmountOut;
      firstPriceImpact = _firstPriceImpact;
      firstFee = _firstFee;
      firstRemainingAccounts = _firstRemainingAccounts;
      firstExpirationTime = _expirationTime;
      realAmountIn = _realAmountIn;
    } else {
      const {
        minAmountOut: _minMiddleAmountOut,
        priceImpact: _firstPriceImpact,
        fee: _firstFee,
      } = this.scope.liquidity.computeAmountOut({
        poolKeys: jsonInfo2PoolKeys(fromPool) as LiquidityPoolKeys,
        poolInfo: simulateCache[fromPool.id as string],
        amountIn,
        outputToken: middleToken,
        slippage: _slippage,
      });
      minMiddleAmountOut = {
        amount: _minMiddleAmountOut,
        fee: undefined,
        expirationTime: undefined,
      };
      firstPriceImpact = _firstPriceImpact;
      firstFee = _firstFee;
    }

    let amountOut: TransferAmountFee;
    let minAmountOut: TransferAmountFee;
    let secondPriceImpact: Percent;
    let secondFee: TokenAmount;
    let secondRemainingAccounts: PublicKey[] | undefined = undefined;
    let secondExpirationTime: number | undefined = undefined;
    let realAmountRouteIn: TransferAmountFee = minMiddleAmountOut;

    if (toPool.version === 6) {
      const {
        amountOut: _amountOut,
        minAmountOut: _minAmountOut,
        priceImpact: _secondPriceImpact,
        fee: _secondFee,
        remainingAccounts: _secondRemainingAccounts,
        expirationTime: _expirationTime,
        realAmountIn: _realAmountIn,
      } = await PoolUtils.computeAmountOutFormat({
        poolInfo: toPool as ClmmPoolInfo,
        tickArrayCache: tickCache[toPool.id.toString()],
        amountIn: new TokenAmount(
          (minMiddleAmountOut.amount as TokenAmount).token,
          minMiddleAmountOut.amount.raw.sub(
            minMiddleAmountOut.fee === undefined ? BN_ZERO : minMiddleAmountOut.fee.raw,
          ),
        ),
        tokenOut: currencyOut,
        slippage,
        epochInfo,
        token2022Infos: mintInfos,
      });
      amountOut = _amountOut;
      minAmountOut = _minAmountOut;
      secondPriceImpact = _secondPriceImpact;
      secondFee = _secondFee;
      secondRemainingAccounts = _secondRemainingAccounts;
      secondExpirationTime = _expirationTime;
      realAmountRouteIn = _realAmountIn;
    } else {
      const {
        amountOut: _amountOut,
        minAmountOut: _minAmountOut,
        priceImpact: _secondPriceImpact,
        fee: _secondFee,
      } = this.scope.liquidity.computeAmountOut({
        poolKeys: jsonInfo2PoolKeys(toPool) as LiquidityPoolKeys,
        poolInfo: simulateCache[toPool.id as string],
        amountIn: new TokenAmount(
          minMiddleAmountOut.amount.token,
          minMiddleAmountOut.amount.raw.sub(
            minMiddleAmountOut.fee === undefined ? BN_ZERO : minMiddleAmountOut.fee.raw,
          ),
        ),
        outputToken: currencyOut,
        slippage,
      });
      amountOut = {
        amount: _amountOut,
        fee: undefined,
        expirationTime: undefined,
      };
      minAmountOut = {
        amount: _minAmountOut,
        fee: undefined,
        expirationTime: undefined,
      };
      secondPriceImpact = _secondPriceImpact;
      secondFee = _secondFee;
    }

    let executionPrice: Price | null = null;
    const amountInRaw = amountIn.raw;
    const amountOutRaw = amountOut.amount.raw;
    const currencyIn = amountIn.token;
    if (!amountInRaw.isZero() && !amountOutRaw.isZero()) {
      executionPrice = new Price({
        baseToken: currencyIn,
        denominator: amountInRaw,
        quoteToken: currencyOut,
        numerator: amountOutRaw,
      });
    }

    return {
      minMiddleAmountFee:
        minMiddleAmountOut.fee !== undefined
          ? new TokenAmount(
              middleToken,
              (minMiddleAmountOut.fee?.raw ?? new BN(0)).add(realAmountRouteIn.fee?.raw ?? new BN(0)),
            )
          : undefined,
      middleToken,
      realAmountIn,
      amountOut,
      minAmountOut,
      executionPrice,
      priceImpact: firstPriceImpact.add(secondPriceImpact),
      fee: [firstFee, secondFee],
      remainingAccounts: [firstRemainingAccounts, secondRemainingAccounts],
      expirationTime: minExpirationTime(firstExpirationTime, secondExpirationTime),
    };
  }

  private async getWSolAccounts(): Promise<TokenAccount[]> {
    this.scope.checkOwner();
    await this.scope.account.fetchWalletTokenAccounts();
    const tokenAccounts = this.scope.account.tokenAccounts.filter((acc) => acc.mint.equals(WSOLMint));
    tokenAccounts.sort((a, b) => {
      if (a.isAssociated) return 1;
      if (b.isAssociated) return -1;
      return a.amount.lt(b.amount) ? -1 : 1;
    });
    return tokenAccounts;
  }

  public async unWrapWSol(amount: BigNumberish, tokenProgram?: PublicKey): Promise<MakeTransaction> {
    const tokenAccounts = await this.getWSolAccounts();
    const txBuilder = this.createTxBuilder();
    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount: 0,
    });
    txBuilder.addInstruction(ins);

    const amountBN = parseBigNumberish(amount);
    for (let i = 0; i < tokenAccounts.length; i++) {
      if (amountBN.gte(tokenAccounts[i].amount)) {
        txBuilder.addInstruction({
          instructions: [
            closeAccountInstruction({
              tokenAccount: tokenAccounts[i].publicKey!,
              payer: this.scope.ownerPubKey,
              owner: this.scope.ownerPubKey,
              programId: tokenProgram,
            }),
          ],
        });
        amountBN.sub(tokenAccounts[i].amount);
      } else {
        txBuilder.addInstruction({
          instructions: [
            closeAccountInstruction({
              tokenAccount: tokenAccounts[i].publicKey!,
              payer: this.scope.ownerPubKey,
              owner: this.scope.ownerPubKey,
              programId: tokenProgram,
            }),
          ],
        });
        makeTransferInstruction({
          destination: ins.signers![0].publicKey,
          source: tokenAccounts[i].publicKey!,
          amount: amountBN,
          owner: this.scope.ownerPubKey,
          tokenProgram,
        });
      }
    }

    return txBuilder.build();
  }

  public async wrapWSol(amount: BigNumberish, tokenProgram?: PublicKey): Promise<MakeTransaction> {
    const tokenAccounts = await this.getWSolAccounts();

    const txBuilder = this.createTxBuilder();
    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount,
      skipCloseAccount: true,
    });
    txBuilder.addInstruction(ins);

    if (tokenAccounts.length) {
      // already have wsol account
      txBuilder.addInstruction({
        instructions: [
          makeTransferInstruction({
            // destination: ins.signers![0].publicKey,
            destination: tokenAccounts[0].publicKey!,
            source: ins.signers![0].publicKey,
            amount,
            owner: this.scope.ownerPubKey,
            tokenProgram,
          }),
        ],
        endInstructions: [
          closeAccountInstruction({
            tokenAccount: ins.signers![0].publicKey,
            payer: this.scope.ownerPubKey,
            owner: this.scope.ownerPubKey,
            programId: tokenProgram,
          }),
        ],
      });
    }
    return txBuilder.build();
  }

  public async swap({
    swapInfo: orgSwapInfo,
    associatedOnly,
    checkCreateATAOwner,
    checkTransaction,
    routeProgram = new PublicKey("routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS"),
  }: {
    swapInfo: ComputeAmountOutLayout;
    associatedOnly: boolean;
    checkCreateATAOwner: boolean;
    checkTransaction: boolean;
    routeProgram: PublicKey;
  }): Promise<MakeMultiTransaction> {
    const swapInfo = {
      ...orgSwapInfo,
      amountIn: this.scope.solToWsolTransferAmountFee(orgSwapInfo.amountIn),
      amountOut: this.scope.solToWsolTransferAmountFee(orgSwapInfo.amountOut),
      minAmountOut: this.scope.solToWsolTransferAmountFee(orgSwapInfo.minAmountOut),
      middleMint: (orgSwapInfo as ComputeAmountOutRouteLayout).minMiddleAmountFee
        ? solToWSol((orgSwapInfo as ComputeAmountOutRouteLayout).middleToken.mint)
        : undefined,
    };
    const amountIn = swapInfo.amountIn;
    const amountOut = swapInfo.amountOut;
    const useSolBalance =
      amountIn.amount.token.mint.equals(Token.WSOL.mint) || amountIn.amount.token.mint.equals(SOLMint);
    const outSolBalance =
      amountOut.amount.token.mint.equals(Token.WSOL.mint) || amountOut.amount.token.mint.equals(SOLMint);
    const inputMint = amountIn.amount.token.mint;
    const middleMint = swapInfo.middleMint!;
    const outputMint = amountOut.amount.token.mint;
    const txBuilder = this.createTxBuilder();

    const { account: sourceToken, instructionParams: sourceInstructionParams } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: inputMint,
        notUseTokenAccount: useSolBalance,
        createInfo: useSolBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: amountIn.amount.raw,
            }
          : undefined,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !useSolBalance,
        associatedOnly: useSolBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    sourceInstructionParams && txBuilder.addInstruction(sourceInstructionParams);
    if (sourceToken === undefined) throw Error("input account check error");

    const { account: destinationToken, instructionParams: destinationInstructionParams } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: outputMint,
        skipCloseAccount: !outSolBalance,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        owner: this.scope.ownerPubKey,
        associatedOnly,
        checkCreateATAOwner,
      });
    destinationInstructionParams && txBuilder.addInstruction(destinationInstructionParams);

    let routeToken: PublicKey | undefined = undefined;
    if (swapInfo.routeType === "route") {
      const res = await this.scope.account.getOrCreateTokenAccount({
        mint: middleMint,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        owner: this.scope.ownerPubKey,
        associatedOnly: false,
        checkCreateATAOwner,
      });
      routeToken = res.account;
      res.instructionParams && txBuilder.addInstruction(res.instructionParams);
    }

    const ins = await makeSwapInstruction({
      routeProgram,
      inputMint,
      swapInfo,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        sourceToken,
        routeToken,
        destinationToken: destinationToken!,
      },
    });

    const transferIns =
      swapInfo.feeConfig !== undefined
        ? [
            createTransferInstruction(
              sourceToken,
              swapInfo.feeConfig.feeAccount,
              this.scope.ownerPubKey,
              swapInfo.feeConfig.feeAmount.toNumber(),
            ),
          ]
        : [];
    const transferInsType = swapInfo.feeConfig !== undefined ? [InstructionType.TransferAmount] : [];

    // await txBuilder.calComputeBudget();
    const instructions: TransactionInstruction[] = [];
    const instructionsTypes: string[] = [];
    const config = await txBuilder.getComputeBudgetConfig();
    if (config) {
      const { instructions: _ins, instructionTypes: _insType } = addComputeBudget(config);
      instructions.push(..._ins);
      instructionsTypes.push(..._insType);
    }

    const allTxBuilder: TxBuilder[] = [];
    const tempIns = [
      ...instructions,
      ...transferIns,
      ...txBuilder.AllTxData.instructions,
      ...ins.instructions,
      ...txBuilder.AllTxData.endInstructions,
    ];
    const tempInsType = [
      ...instructionsTypes,
      ...transferInsType,
      ...txBuilder.AllTxData.instructionTypes,
      ...ins.instructionTypes,
      ...txBuilder.AllTxData.endInstructionTypes,
    ];
    const tempSigner = [...txBuilder.AllTxData.signers, ...ins.signers];
    if (checkTransaction) {
      if (forecastTransactionSize(tempIns, [this.scope.ownerPubKey, ...tempSigner.map((i) => i.publicKey)])) {
        allTxBuilder.push(
          this.createTxBuilder().addInstruction({
            instructions: tempIns,
            signers: tempSigner,
            instructionTypes: tempInsType,
          }),
        );
      } else {
        if (txBuilder.AllTxData.instructions.length > 0) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: txBuilder.AllTxData.instructions,
              signers: txBuilder.AllTxData.signers,
              instructionTypes: txBuilder.AllTxData.instructionTypes,
            }),
          );
        }
        if (forecastTransactionSize([...instructions, ...transferIns, ...ins.instructions], [this.scope.ownerPubKey])) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: [...instructions, ...transferIns, ...ins.instructions],
              signers: ins.signers,
              instructionTypes: [...instructionsTypes, ...transferInsType, ...ins.instructionTypes],
            }),
          );
        } else if (forecastTransactionSize([...instructions, ...ins.instructions], [this.scope.ownerPubKey])) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: [...instructions, ...ins.instructions],
              signers: ins.signers,
              instructionTypes: ins.instructionTypes,
            }),
          );
        } else if (forecastTransactionSize(ins.instructions, [this.scope.ownerPubKey])) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: [...ins.instructions],
              signers: ins.signers,
              instructionTypes: ins.instructionTypes,
            }),
          );
        } else {
          for (let index = 0; index < ins.instructions.length; index++) {
            allTxBuilder.push(
              this.createTxBuilder().addInstruction({
                instructions: [...instructions, ins.instructions[index]],
                signers: ins.signers,
                instructionTypes: [...instructionsTypes, ins.instructionTypes[index]],
              }),
            );
          }
        }
        if (txBuilder.AllTxData.endInstructions.length > 0) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: txBuilder.AllTxData.endInstructions,
              instructionTypes: txBuilder.AllTxData.endInstructionTypes,
            }),
          );
        }
      }
    } else {
      if (swapInfo.routeType === "amm") {
        allTxBuilder.push(
          this.createTxBuilder().addInstruction({
            instructions: tempIns,
            signers: tempSigner,
            instructionTypes: tempInsType,
          }),
        );
      } else {
        if (txBuilder.AllTxData.instructions.length > 0) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: txBuilder.AllTxData.instructions,
              signers: txBuilder.AllTxData.signers,
              instructionTypes: txBuilder.AllTxData.instructionTypes,
            }),
          );
        }
        allTxBuilder.push(
          this.createTxBuilder().addInstruction({
            instructions: ins.instructions,
            signers: ins.signers,
            instructionTypes: ins.instructionTypes,
          }),
        );
        if (txBuilder.AllTxData.endInstructions.length > 0) {
          allTxBuilder.push(
            this.createTxBuilder().addInstruction({
              instructions: txBuilder.AllTxData.endInstructions,
              instructionTypes: txBuilder.AllTxData.endInstructionTypes,
            }),
          );
        }
      }
    }
    const firstBuilder = allTxBuilder.shift()!;
    return firstBuilder.buildMultiTx({ extraPreBuildData: allTxBuilder.map((builder) => builder.build()) });
  }
}
