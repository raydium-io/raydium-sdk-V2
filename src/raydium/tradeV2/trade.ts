import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import { forecastTransactionSize, solToWSol, TxBuilder, BN_ZERO, SOLMint, WSOLMint, addComputeBudget } from "@/common";
import { Token } from "@/module";
import { StableLayout } from "../liquidity/stable";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  ComputeAmountOutLayout,
  ComputeAmountOutRouteLayout,
  PoolAccountInfoV4,
  ReturnTypeGetAddLiquidityDefaultPool,
} from "./type";
import { makeSwapInstruction } from "./instrument";
import { MakeMultiTransaction, MakeTransaction } from "../type";
import { InstructionType } from "@/common/txTool/txType";
import { BigNumberish, parseBigNumberish } from "@/common/bignumber";
import {
  createWSolAccountInstructions,
  closeAccountInstruction,
  makeTransferInstruction,
} from "../account/instruction";
import { TokenAccount } from "../account/types";
import { ComputeBudgetConfig } from "@/raydium/type";

type LiquidityPoolJsonInfo = any;
export default class TradeV2 extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
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

  // public async getAllRouteComputeAmountOut({
  //   inputTokenAmount,
  //   outputToken: orgOut,
  //   directPath,
  //   routePathDict,
  //   simulateCache,
  //   tickCache,
  //   slippage,
  //   chainTime,
  //   feeConfig,
  //   mintInfos,
  // }: {
  //   directPath: PoolType[];
  //   routePathDict: RoutePathType;
  //   simulateCache: ReturnTypeFetchMultipleInfo;
  //   tickCache: ReturnTypeFetchMultiplePoolTickArrays;
  //   inputTokenAmount: TokenAmount;
  //   outputToken: Token;
  //   slippage: Percent;
  //   chainTime: number;
  //   feeConfig?: {
  //     feeBps: BN;
  //     feeAccount: PublicKey;
  //   };
  //   mintInfos: ReturnTypeFetchMultipleMintInfos;
  // }): Promise<{
  //   routes: ComputeAmountOutLayout[];
  //   best?: ComputeAmountOutLayout;
  // }> {
  //   const epochInfo = await this.scope.fetchEpochInfo();
  //   const input = this.scope.solToWsolTokenAmount(inputTokenAmount);
  //   const _amountIn =
  //     feeConfig === undefined ? BN_ZERO : input.raw.mul(new BN(10000 - feeConfig.feeBps.toNumber())).div(new BN(10000));
  //   const amountIn = feeConfig === undefined ? input : new TokenAmount(input.token, _amountIn, true);
  //   const _inFeeConfig =
  //     feeConfig === undefined
  //       ? undefined
  //       : {
  //           feeAmount: _amountIn,
  //           feeAccount: feeConfig.feeAccount,
  //         };

  //   const outputToken = this.scope.mintToToken(solToWSol(orgOut.mint));
  //   const outRoute: ComputeAmountOutLayout[] = [];

  //   for (const itemPool of directPath) {
  //     if (itemPool.version === 6) {
  //       try {
  //         const {
  //           realAmountIn,
  //           amountOut,
  //           minAmountOut,
  //           expirationTime,
  //           currentPrice,
  //           executionPrice,
  //           priceImpact,
  //           fee,
  //           remainingAccounts,
  //         } = await PoolUtils.computeAmountOutFormat({
  //           poolInfo: itemPool as ClmmPoolInfo,
  //           tickArrayCache: tickCache[itemPool.id.toString()],
  //           amountIn,
  //           tokenOut: outputToken,
  //           slippage,
  //           token2022Infos: mintInfos,
  //           epochInfo,
  //         });
  //         outRoute.push({
  //           amountIn: realAmountIn,
  //           amountOut,
  //           minAmountOut,
  //           currentPrice,
  //           executionPrice,
  //           priceImpact,
  //           fee: [fee],
  //           remainingAccounts: [remainingAccounts],
  //           routeType: "amm",
  //           poolKey: [itemPool],
  //           poolReady: (itemPool as ClmmPoolInfo).startTime < chainTime,
  //           poolType: "CLMM",
  //           feeConfig: _inFeeConfig,
  //           expirationTime: minExpirationTime(realAmountIn.expirationTime, expirationTime),
  //         });
  //       } catch (e) {
  //         //
  //       }
  //     } else {
  //       try {
  //         if (![1, 6, 7].includes(simulateCache[itemPool.id as string].status.toNumber())) continue;
  //         // const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } =
  //         //   this.scope.liquidity.computeAmountOut({
  //         //     poolKeys: jsonInfo2PoolKeys(itemPool) as LiquidityPoolKeys,
  //         //     poolInfo: simulateCache[itemPool.id as string],
  //         //     amountIn,
  //         //     outputToken,
  //         //     slippage,
  //         //   });
  //         // outRoute.push({
  //         //   amountIn: { amount: amountIn, fee: undefined, expirationTime: undefined },
  //         //   amountOut: { amount: amountOut, fee: undefined, expirationTime: undefined },
  //         //   minAmountOut: { amount: minAmountOut, fee: undefined, expirationTime: undefined },
  //         //   currentPrice,
  //         //   executionPrice,
  //         //   priceImpact,
  //         //   fee: [fee],
  //         //   routeType: "amm",
  //         //   poolKey: [itemPool],
  //         //   remainingAccounts: [],
  //         //   poolReady: simulateCache[itemPool.id as string].startTime.toNumber() < chainTime,
  //         //   poolType: itemPool.version === 5 ? "STABLE" : undefined,
  //         //   feeConfig: _inFeeConfig,
  //         //   expirationTime: undefined,
  //         // });
  //       } catch (e) {
  //         //
  //       }
  //     }
  //   }
  //   for (const [routeMint, info] of Object.entries(routePathDict)) {
  //     for (const iFromPool of info.in) {
  //       if (!simulateCache[iFromPool.id as string] && !tickCache[iFromPool.id.toString()]) continue;
  //       if (iFromPool.version !== 6 && ![1, 6, 7].includes(simulateCache[iFromPool.id as string].status.toNumber()))
  //         continue;
  //       for (const iOutPool of info.out) {
  //         if (!simulateCache[iOutPool.id as string] && !tickCache[iOutPool.id.toString()]) continue;
  //         if (iOutPool.version !== 6 && ![1, 6, 7].includes(simulateCache[iOutPool.id as string].status.toNumber()))
  //           continue;
  //         try {
  //           const {
  //             amountOut,
  //             minAmountOut,
  //             executionPrice,
  //             priceImpact,
  //             fee,
  //             remainingAccounts,
  //             minMiddleAmountFee,
  //             middleToken,
  //             expirationTime,
  //             realAmountIn,
  //           } = await this.computeAmountOut({
  //             middleMintInfo: {
  //               mint: new PublicKey(routeMint),
  //               decimals: info.mDecimals,
  //             },
  //             amountIn,
  //             currencyOut: outputToken,
  //             slippage,

  //             fromPool: iFromPool,
  //             toPool: iOutPool,
  //             simulateCache,
  //             tickCache,
  //             mintInfos,
  //           });

  //           const infoAPoolOpen =
  //             iFromPool.version === 6
  //               ? (iFromPool as ClmmPoolInfo).startTime < chainTime
  //               : simulateCache[iFromPool.id as string].startTime.toNumber() < chainTime;
  //           const infoBPoolOpen =
  //             iOutPool.version === 6
  //               ? (iOutPool as ClmmPoolInfo).startTime < chainTime
  //               : simulateCache[iOutPool.id as string].startTime.toNumber() < chainTime;

  //           const poolTypeA = iFromPool.version === 6 ? "CLMM" : iFromPool.version === 5 ? "STABLE" : undefined;
  //           const poolTypeB = iOutPool.version === 6 ? "CLMM" : iOutPool.version === 5 ? "STABLE" : undefined;
  //           outRoute.push({
  //             amountIn: realAmountIn,
  //             amountOut,
  //             minAmountOut,
  //             currentPrice: undefined,
  //             executionPrice,
  //             priceImpact,
  //             fee,
  //             routeType: "route",
  //             poolKey: [iFromPool, iOutPool],
  //             remainingAccounts,
  //             minMiddleAmountFee,
  //             middleToken,
  //             poolReady: infoAPoolOpen && infoBPoolOpen,
  //             poolType: [poolTypeA, poolTypeB],
  //             feeConfig: _inFeeConfig,
  //             expirationTime,
  //           });
  //         } catch (e) {
  //           //
  //         }
  //       }
  //     }
  //   }
  //   outRoute.sort((a, b) => (a.amountOut.amount.raw.sub(b.amountOut.amount.raw).gt(BN_ZERO) ? -1 : 1));
  //   const isReadyRoutes = outRoute.filter((i) => i.poolReady);

  //   return {
  //     routes: outRoute,
  //     best: isReadyRoutes.length ? isReadyRoutes[0] : outRoute[0],
  //   };
  // }

  // private async computeAmountOut({
  //   middleMintInfo,
  //   amountIn,
  //   currencyOut,
  //   slippage,

  //   fromPool,
  //   toPool,
  //   simulateCache,
  //   tickCache,
  //   mintInfos,
  // }: {
  //   middleMintInfo: { mint: PublicKey; decimals: number };
  //   amountIn: TokenAmount;
  //   currencyOut: Token;
  //   slippage: Percent;
  //   fromPool: PoolType;
  //   toPool: PoolType;
  //   simulateCache: ReturnTypeFetchMultipleInfo;
  //   tickCache: ReturnTypeFetchMultiplePoolTickArrays;
  //   mintInfos: ReturnTypeFetchMultipleMintInfos;
  // }): Promise<{
  //   minMiddleAmountFee: TokenAmount | undefined;
  //   middleToken: Token;
  //   realAmountIn: TransferAmountFee;
  //   amountOut: TransferAmountFee;
  //   minAmountOut: TransferAmountFee;
  //   executionPrice: Price | null;
  //   priceImpact: Fraction;
  //   fee: TokenAmount[];
  //   remainingAccounts: [PublicKey[] | undefined, PublicKey[] | undefined];
  //   expirationTime: number | undefined;
  // }> {
  //   const epochInfo = await this.scope.fetchEpochInfo();
  //   const middleToken = new Token(middleMintInfo);

  //   let firstPriceImpact: Percent;
  //   let firstFee: TokenAmount;
  //   let firstRemainingAccounts: PublicKey[] | undefined = undefined;
  //   let minMiddleAmountOut: TransferAmountFee;
  //   let firstExpirationTime: number | undefined = undefined;
  //   let realAmountIn: TransferAmountFee = {
  //     amount: amountIn,
  //     fee: undefined,
  //     expirationTime: undefined,
  //   };

  //   const _slippage = new Percent(0, 100);

  //   if (fromPool.version === 6) {
  //     const {
  //       minAmountOut: _minMiddleAmountOut,
  //       priceImpact: _firstPriceImpact,
  //       fee: _firstFee,
  //       remainingAccounts: _firstRemainingAccounts,
  //       expirationTime: _expirationTime,
  //       realAmountIn: _realAmountIn,
  //     } = await PoolUtils.computeAmountOutFormat({
  //       poolInfo: fromPool as ClmmPoolInfo,
  //       tickArrayCache: tickCache[fromPool.id.toString()],
  //       amountIn,
  //       tokenOut: middleToken,
  //       slippage: _slippage,
  //       epochInfo,
  //       token2022Infos: mintInfos,
  //     });
  //     minMiddleAmountOut = _minMiddleAmountOut;
  //     firstPriceImpact = _firstPriceImpact;
  //     firstFee = _firstFee;
  //     firstRemainingAccounts = _firstRemainingAccounts;
  //     firstExpirationTime = _expirationTime;
  //     realAmountIn = _realAmountIn;
  //   } else {
  //     const {
  //       minAmountOut: _minMiddleAmountOut,
  //       priceImpact: _firstPriceImpact,
  //       fee: _firstFee,
  //     } = this.scope.liquidity.computeAmountOut({
  //       poolKeys: jsonInfo2PoolKeys(fromPool) as LiquidityPoolKeys,
  //       poolInfo: simulateCache[fromPool.id as string],
  //       amountIn,
  //       outputToken: middleToken,
  //       slippage: _slippage,
  //     });
  //     minMiddleAmountOut = {
  //       amount: _minMiddleAmountOut,
  //       fee: undefined,
  //       expirationTime: undefined,
  //     };
  //     firstPriceImpact = _firstPriceImpact;
  //     firstFee = _firstFee;
  //   }

  //   let amountOut: TransferAmountFee;
  //   let minAmountOut: TransferAmountFee;
  //   let secondPriceImpact: Percent;
  //   let secondFee: TokenAmount;
  //   let secondRemainingAccounts: PublicKey[] | undefined = undefined;
  //   let secondExpirationTime: number | undefined = undefined;
  //   let realAmountRouteIn: TransferAmountFee = minMiddleAmountOut;

  //   if (toPool.version === 6) {
  //     const {
  //       amountOut: _amountOut,
  //       minAmountOut: _minAmountOut,
  //       priceImpact: _secondPriceImpact,
  //       fee: _secondFee,
  //       remainingAccounts: _secondRemainingAccounts,
  //       expirationTime: _expirationTime,
  //       realAmountIn: _realAmountIn,
  //     } = await PoolUtils.computeAmountOutFormat({
  //       poolInfo: toPool as ClmmPoolInfo,
  //       tickArrayCache: tickCache[toPool.id.toString()],
  //       amountIn: new TokenAmount(
  //         (minMiddleAmountOut.amount as TokenAmount).token,
  //         minMiddleAmountOut.amount.raw.sub(
  //           minMiddleAmountOut.fee === undefined ? BN_ZERO : minMiddleAmountOut.fee.raw,
  //         ),
  //       ),
  //       tokenOut: currencyOut,
  //       slippage,
  //       epochInfo,
  //       token2022Infos: mintInfos,
  //     });
  //     amountOut = _amountOut;
  //     minAmountOut = _minAmountOut;
  //     secondPriceImpact = _secondPriceImpact;
  //     secondFee = _secondFee;
  //     secondRemainingAccounts = _secondRemainingAccounts;
  //     secondExpirationTime = _expirationTime;
  //     realAmountRouteIn = _realAmountIn;
  //   } else {
  //     const {
  //       amountOut: _amountOut,
  //       minAmountOut: _minAmountOut,
  //       priceImpact: _secondPriceImpact,
  //       fee: _secondFee,
  //     } = this.scope.liquidity.computeAmountOut({
  //       poolKeys: jsonInfo2PoolKeys(toPool) as LiquidityPoolKeys,
  //       poolInfo: simulateCache[toPool.id as string],
  //       amountIn: new TokenAmount(
  //         minMiddleAmountOut.amount.token,
  //         minMiddleAmountOut.amount.raw.sub(
  //           minMiddleAmountOut.fee === undefined ? BN_ZERO : minMiddleAmountOut.fee.raw,
  //         ),
  //       ),
  //       outputToken: currencyOut,
  //       slippage,
  //     });
  //     amountOut = {
  //       amount: _amountOut,
  //       fee: undefined,
  //       expirationTime: undefined,
  //     };
  //     minAmountOut = {
  //       amount: _minAmountOut,
  //       fee: undefined,
  //       expirationTime: undefined,
  //     };
  //     secondPriceImpact = _secondPriceImpact;
  //     secondFee = _secondFee;
  //   }

  //   let executionPrice: Price | null = null;
  //   const amountInRaw = amountIn.raw;
  //   const amountOutRaw = amountOut.amount.raw;
  //   const currencyIn = amountIn.token;
  //   if (!amountInRaw.isZero() && !amountOutRaw.isZero()) {
  //     executionPrice = new Price({
  //       baseToken: currencyIn,
  //       denominator: amountInRaw,
  //       quoteToken: currencyOut,
  //       numerator: amountOutRaw,
  //     });
  //   }

  //   return {
  //     minMiddleAmountFee:
  //       minMiddleAmountOut.fee !== undefined
  //         ? new TokenAmount(
  //             middleToken,
  //             (minMiddleAmountOut.fee?.raw ?? new BN(0)).add(realAmountRouteIn.fee?.raw ?? new BN(0)),
  //           )
  //         : undefined,
  //     middleToken,
  //     realAmountIn,
  //     amountOut,
  //     minAmountOut,
  //     executionPrice,
  //     priceImpact: firstPriceImpact.add(secondPriceImpact),
  //     fee: [firstFee, secondFee],
  //     remainingAccounts: [firstRemainingAccounts, secondRemainingAccounts],
  //     expirationTime: minExpirationTime(firstExpirationTime, secondExpirationTime),
  //   };
  // }

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

  public async unWrapWSol(props: {
    amount: BigNumberish;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
  }): Promise<MakeTransaction> {
    const { amount, tokenProgram } = props;
    const tokenAccounts = await this.getWSolAccounts();
    const txBuilder = this.createTxBuilder();
    txBuilder.addCustomComputeBudget(props.computeBudgetConfig);
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
          destination: ins.addresses.newAccount,
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
            source: ins.addresses.newAccount,
            amount,
            owner: this.scope.ownerPubKey,
            tokenProgram,
          }),
        ],
        endInstructions: [
          closeAccountInstruction({
            tokenAccount: ins.addresses.newAccount,
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
