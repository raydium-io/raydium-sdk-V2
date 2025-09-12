import { EpochInfo, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  TransferFee,
  TransferFeeConfig,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import BN from "bn.js";
import Decimal from "decimal.js";
import { AmmV4Keys, ApiV3PoolInfoConcentratedItem, ApiV3Token, ClmmKeys, PoolKeys } from "@/api";
import {
  AMM_V4,
  BigNumberish,
  CLMM_PROGRAM_ID,
  CREATE_CPMM_POOL_PROGRAM,
  fetchMultipleMintInfos,
  getMultipleAccountsInfoWithCustomFlags,
  minExpirationTime,
  parseBigNumberish,
  solToWSol,
  WSOLMint,
} from "@/common";
import { MakeMultiTxData, MakeTxData } from "@/common/txTool/txTool";
import { InstructionType, TxVersion } from "@/common/txTool/txType";
import { publicKey, struct } from "../../marshmallow";
import { Price, TokenAmount } from "../../module";
import {
  ClmmInstrument,
  ClmmParsedRpcData,
  ComputeClmmPoolInfo,
  MAX_SQRT_PRICE_X64,
  MIN_SQRT_PRICE_X64,
  PoolUtils,
  ReturnTypeComputeAmountOutBaseOut,
  ReturnTypeComputeAmountOutFormat,
  ReturnTypeFetchMultiplePoolTickArrays,
  SqrtPriceMath,
} from "../../raydium/clmm";
import { PoolInfoLayout } from "../../raydium/clmm/layout";
import { CpmmPoolInfoLayout, getPdaPoolAuthority } from "../../raydium/cpmm";
import {
  ComputeAmountOutParam,
  getLiquidityAssociatedAuthority,
  liquidityStateV4Layout,
  toAmmComputePoolInfo,
} from "../../raydium/liquidity";
import { ComputeBudgetConfig, ReturnTypeFetchMultipleMintInfos, TransferAmountFee } from "../../raydium/type";
import { closeAccountInstruction, createWSolAccountInstructions } from "../account/instruction";
import { TokenAccount } from "../account/types";
import { CpmmComputeData } from "../cpmm";
import { AmmRpcData } from "../liquidity";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { Market, MARKET_STATE_LAYOUT_V3 } from "../serum";
import { toApiV3Token, toToken, toTokenAmount } from "../token";
import { makeSwapInstruction } from "./instrument";
import {
  BasicPoolInfo,
  ComputeAmountOutAmmLayout,
  ComputeAmountOutLayout,
  ComputePoolType,
  ComputeRoutePathType,
  ReturnTypeFetchMultipleInfo,
  ReturnTypeGetAllRoute,
  RoutePathType,
} from "./type";
import {
  buyExactInInstruction,
  Curve,
  getPdaCreatorVault,
  getPdaLaunchpadAuth,
  getPdaPlatformVault,
  LaunchpadConfigInfo,
  LaunchpadPlatformInfo,
  LaunchpadPoolInfo,
  PlatformConfig,
  sellExactInInstruction,
  SwapInfoReturn,
} from "../launchpad";

const ZERO = new BN(0);
export default class TradeV2 extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
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

  public async unWrapWSol<T extends TxVersion>(props: {
    amount: BigNumberish;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
    txVersion?: T;
    feePayer?: PublicKey;
  }): Promise<MakeTxData<T>> {
    const { amount, tokenProgram, txVersion = TxVersion.LEGACY, feePayer } = props;
    const tokenAccounts = await this.getWSolAccounts();
    const txBuilder = this.createTxBuilder(feePayer);
    txBuilder.addCustomComputeBudget(props.computeBudgetConfig);
    // const ins = await createWSolAccountInstructions({
    //   connection: this.scope.connection,
    //   owner: this.scope.ownerPubKey,
    //   payer: this.scope.ownerPubKey,
    //   amount: 0,
    // });
    // txBuilder.addInstruction(ins);

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
      }
    }

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async wrapWSol<T extends TxVersion>(
    amount: BigNumberish,
    tokenProgram?: PublicKey,
    txVersion?: T,
    feePayer?: PublicKey,
  ): Promise<MakeTxData<T>> {
    // const tokenAccounts = await this.getWSolAccounts();

    const txBuilder = this.createTxBuilder(feePayer);

    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount,
      skipCloseAccount: true,
    });
    txBuilder.addInstruction(ins);

    // if (tokenAccounts.length) {
    //   // already have wsol account
    //   txBuilder.addInstruction({
    //     instructions: [
    //       makeTransferInstruction({
    //         destination: tokenAccounts[0].publicKey!,
    //         source: ins.addresses.newAccount,
    //         amount,
    //         owner: this.scope.ownerPubKey,
    //         tokenProgram,
    //       }),
    //     ],
    //     endInstructions: [
    //       closeAccountInstruction({
    //         tokenAccount: ins.addresses.newAccount,
    //         payer: this.scope.ownerPubKey,
    //         owner: this.scope.ownerPubKey,
    //         programId: tokenProgram,
    //       }),
    //     ],
    //   });
    // }
    return txBuilder.versionBuild({ txVersion: txVersion ?? TxVersion.LEGACY }) as Promise<MakeTxData<T>>;
  }

  public async swap<T extends TxVersion>({
    swapInfo,
    swapPoolKeys,
    ownerInfo,
    computeBudgetConfig,
    routeProgram,
    txVersion,
    feePayer,
  }: {
    txVersion: T;
    swapInfo: ComputeAmountOutLayout;
    swapPoolKeys?: PoolKeys[];
    ownerInfo: {
      associatedOnly: boolean;
      checkCreateATAOwner: boolean;
    };
    routeProgram: PublicKey;
    computeBudgetConfig?: ComputeBudgetConfig;
    feePayer?: PublicKey;
  }): Promise<MakeMultiTxData<T>> {
    const txBuilder = this.createTxBuilder(feePayer);
    const amountIn = swapInfo.amountIn;
    const amountOut = swapInfo.amountOut;
    const useSolBalance = amountIn.amount.token.mint.equals(WSOLMint);
    const isOutputSol = amountOut.amount.token.mint.equals(WSOLMint);
    const inputMint = amountIn.amount.token.mint;
    const outputMint = amountOut.amount.token.mint;

    const { account: sourceAcc, instructionParams: sourceAccInsParams } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: amountIn.amount.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        mint: inputMint,
        notUseTokenAccount: useSolBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !useSolBalance,
        createInfo: useSolBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: amountIn.amount.raw,
            }
          : undefined,
        associatedOnly: useSolBalance ? false : ownerInfo.associatedOnly,
        checkCreateATAOwner: ownerInfo.checkCreateATAOwner,
      });

    sourceAccInsParams && txBuilder.addInstruction(sourceAccInsParams);

    if (sourceAcc === undefined) {
      throw Error("input account check error");
    }

    let destinationAcc: PublicKey;
    if (swapInfo.routeType === "route" && !isOutputSol) {
      destinationAcc = this.scope.account.getAssociatedTokenAccount(
        outputMint,
        amountOut.amount.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      );
    } else {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: amountOut.amount.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        mint: outputMint,
        notUseTokenAccount: isOutputSol,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: true,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        associatedOnly: isOutputSol ? false : ownerInfo.associatedOnly,
        checkCreateATAOwner: ownerInfo.checkCreateATAOwner,
      });
      destinationAcc = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    if (isOutputSol) {
      txBuilder.addInstruction({
        endInstructions: [
          closeAccountInstruction({
            owner: this.scope.ownerPubKey,
            payer: this.scope.ownerPubKey,
            tokenAccount: destinationAcc,
            programId: TOKEN_PROGRAM_ID,
          }),
        ],
        endInstructionTypes: [InstructionType.CloseAccount],
      });
    }

    let routeTokenAcc: PublicKey | undefined = undefined;
    if (swapInfo.routeType === "route") {
      const middleMint = swapInfo.middleToken;
      routeTokenAcc = this.scope.account.getAssociatedTokenAccount(
        middleMint.mint,
        middleMint.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      );
    }

    const poolKeys = swapPoolKeys ? swapPoolKeys : await this.computePoolToPoolKeys({ pools: swapInfo.poolInfoList });
    const swapIns = makeSwapInstruction({
      routeProgram,
      inputMint,
      swapInfo: {
        ...swapInfo,
        poolInfo: [...swapInfo.poolInfoList],
        poolKey: poolKeys,
        outputMint,
      },
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        sourceToken: sourceAcc,
        routeToken: routeTokenAcc,
        destinationToken: destinationAcc!,
      },
    });

    if (swapInfo.feeConfig !== undefined) {
      const checkTxBuilder = this.createTxBuilder();
      checkTxBuilder.addInstruction({
        instructions: [
          createTransferInstruction(
            sourceAcc,
            swapInfo.feeConfig.feeAccount,
            this.scope.ownerPubKey,
            swapInfo.feeConfig.feeAmount.toNumber(),
          ),
        ],
        instructionTypes: [InstructionType.TransferAmount],
      });
      checkTxBuilder.addInstruction(swapIns);

      const { transactions } =
        txVersion === TxVersion.V0 ? await checkTxBuilder.sizeCheckBuildV0() : await checkTxBuilder.sizeCheckBuild();
      if (transactions.length < 2) {
        txBuilder.addInstruction({
          instructions: [
            createTransferInstruction(
              sourceAcc,
              swapInfo.feeConfig.feeAccount,
              this.scope.ownerPubKey,
              swapInfo.feeConfig.feeAmount.toNumber(),
            ),
          ],
          instructionTypes: [InstructionType.TransferAmount],
        });
      }
    }
    txBuilder.addInstruction(swapIns);

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig, address: swapIns.address }) as Promise<
        MakeMultiTxData<T>
      >;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig, address: swapIns.address }) as Promise<MakeMultiTxData<T>>;
  }

  public async swapClmmToLaunchMint<T extends TxVersion>({
    inputMint,
    inputAmount,
    fixClmmOut = false,
    clmmPoolId,
    launchPoolId,
    priceLimit,
    slippage = 0.01,
    shareFeeRate = new BN(0),
    shareFeeReceiver,

    launchPlatformInfo,
    slot,
    mintInfo,
    epochInfo: propsEpochInfo,

    ownerInfo = { useSOLBalance: true },
    checkCreateATAOwner = false,
    computeBudgetConfig,
    txVersion,
  }: {
    inputMint: string | PublicKey;
    inputAmount: BN;
    fixClmmOut?: boolean;
    clmmPoolId: string | PublicKey;
    launchPoolId: string | PublicKey;
    priceLimit?: Decimal;
    epochInfo?: EpochInfo;
    slippage: number; // from 0~1
    shareFeeRate?: BN;
    shareFeeReceiver?: PublicKey;

    launchPlatformInfo?: Pick<LaunchpadPlatformInfo, "feeRate" | "creatorFeeRate">;
    slot?: number;
    mintInfo?: ApiV3Token;

    ownerInfo?: {
      useSOLBalance?: boolean;
      feePayer?: PublicKey;
    };
    checkCreateATAOwner?: boolean;
    computeBudgetConfig?: ComputeBudgetConfig;
    txVersion: T;
  }): Promise<
    MakeTxData<
      T,
      {
        routes: { mint: PublicKey; amount: BN; decimal: number }[];
        outAmount: BN;
        minOutAmount: BN;
      }
    >
  > {
    const feePayer = ownerInfo?.feePayer || this.scope.ownerPubKey;
    const epochInfo = propsEpochInfo ?? (await this.scope.fetchEpochInfo());

    const {
      clmmPoolData,
      clmmComputeAmount: { maxClmmAmountIn, clmmAmountOut, remainingAccounts },
      launchPoolInfo,
      launchAuthProgramId,
      launchSwapInfo,
      outAmount,
      minOutAmount,
    } = await this.computeClmmToLaunchAmount({
      inputMint,
      inputAmount,
      fixClmmOut,
      clmmPoolId,
      launchPoolId,
      slippage,
      epochInfo,
      shareFeeRate,
      launchPlatformInfo,
      slot,
      mintInfo,
    });
    const baseIn = inputMint.toString() === clmmPoolData.poolInfo.mintA.address;

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && clmmPoolData.poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && clmmPoolData.poolInfo.mintB.address === WSOLMint.toBase58();
    const tokenAccountMap: Record<string, PublicKey> = {};

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = baseIn ? MIN_SQRT_PRICE_X64.add(new BN(1)) : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        clmmPoolData.poolInfo.mintA.decimals,
        clmmPoolData.poolInfo.mintB.decimals,
      );
    }

    const txBuilder = this.createTxBuilder(feePayer);

    const [clmmMintA, clmmMintB] = [
      new PublicKey(clmmPoolData.poolInfo.mintA.address),
      new PublicKey(clmmPoolData.poolInfo.mintB.address),
    ];
    const [clmmMintAProgram, clmmMintBProgram] = [
      new PublicKey(clmmPoolData.poolInfo.mintA.programId),
      new PublicKey(clmmPoolData.poolInfo.mintB.programId),
    ];

    const ownerTokenAccountA = this.scope.account.getAssociatedTokenAccount(clmmMintA, clmmMintAProgram);
    const ownerTokenAccountB = this.scope.account.getAssociatedTokenAccount(clmmMintB, clmmMintBProgram);

    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          ownerTokenAccountA,
          this.scope.ownerPubKey,
          clmmMintA,
          clmmMintAProgram,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          ownerTokenAccountB,
          this.scope.ownerPubKey,
          clmmMintB,
          clmmMintBProgram,
        ),
      ],
    });

    if ((baseIn && mintAUseSOLBalance) || (!baseIn && mintBUseSOLBalance)) {
      txBuilder.addInstruction({
        instructions: [
          SystemProgram.transfer({
            fromPubkey: this.scope.ownerPubKey,
            toPubkey: baseIn ? ownerTokenAccountA : ownerTokenAccountB,
            lamports: BigInt(maxClmmAmountIn.toString()),
          }),
          createSyncNativeInstruction(baseIn ? ownerTokenAccountA : ownerTokenAccountB),
        ],
      });
    }

    tokenAccountMap[clmmPoolData.poolInfo.mintA.address] = ownerTokenAccountA;
    tokenAccountMap[clmmPoolData.poolInfo.mintB.address] = ownerTokenAccountB;

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("user do not have token account", {
        ownerTokenAccountA,
        ownerTokenAccountB,
      });

    txBuilder.addInstruction(
      fixClmmOut
        ? ClmmInstrument.makeSwapBaseOutInstructions({
            poolInfo: clmmPoolData.poolInfo,
            poolKeys: clmmPoolData.poolKeys,
            observationId: clmmPoolData.computePoolInfo.observationId,
            ownerInfo: {
              wallet: this.scope.ownerPubKey,
              tokenAccountA: ownerTokenAccountA!,
              tokenAccountB: ownerTokenAccountB!,
            },
            outputMint: baseIn ? clmmMintB : clmmMintA,
            amountOut: clmmAmountOut,
            amountInMax: maxClmmAmountIn,
            sqrtPriceLimitX64,
            remainingAccounts,
          })
        : ClmmInstrument.makeSwapBaseInInstructions({
            poolInfo: clmmPoolData.poolInfo,
            poolKeys: clmmPoolData.poolKeys,
            observationId: clmmPoolData.computePoolInfo.observationId,
            ownerInfo: {
              wallet: this.scope.ownerPubKey,
              tokenAccountA: ownerTokenAccountA!,
              tokenAccountB: ownerTokenAccountB!,
            },
            inputMint: new PublicKey(inputMint),
            amountIn: inputAmount,
            amountOutMin: clmmAmountOut,
            sqrtPriceLimitX64,
            remainingAccounts,
          }),
    );

    const launchMintAProgram = launchPoolInfo.mintProgramFlag === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
    const launchTokenAccountA = this.scope.account.getAssociatedTokenAccount(launchPoolInfo.mintA, launchMintAProgram);
    let launchTokenAccountB = tokenAccountMap[launchPoolInfo.mintB.toBase58()];

    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          launchTokenAccountA,
          this.scope.ownerPubKey,
          launchPoolInfo.mintA,
          launchMintAProgram,
        ),
      ],
    });

    if (!launchTokenAccountB) {
      const mintBUseSol = launchPoolInfo.mintB.equals(WSOLMint);
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: launchPoolInfo.mintB,
        notUseTokenAccount: mintBUseSol,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintBUseSol,
        createInfo: mintBUseSol
          ? {
              payer: this.scope.ownerPubKey!,
              amount: clmmAmountOut,
            }
          : undefined,
        associatedOnly: false,
        checkCreateATAOwner,
      });
      launchTokenAccountB = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    txBuilder.addInstruction({
      instructions: [
        buyExactInInstruction(
          launchPoolInfo.programId,
          this.scope.ownerPubKey,
          launchAuthProgramId,
          launchPoolInfo.configId,
          launchPoolInfo.platformId,
          new PublicKey(launchPoolId),
          launchTokenAccountA,
          launchTokenAccountB,
          launchPoolInfo.vaultA,
          launchPoolInfo.vaultB,
          launchPoolInfo.mintA,
          launchPoolInfo.mintB,
          launchMintAProgram,
          TOKEN_PROGRAM_ID,

          getPdaPlatformVault(launchPoolInfo.programId, launchPoolInfo.platformId, launchPoolInfo.mintB).publicKey,
          getPdaCreatorVault(launchPoolInfo.programId, launchPoolInfo.creator, launchPoolInfo.mintB).publicKey,

          launchSwapInfo.amountB.lt(clmmAmountOut) ? launchSwapInfo.amountB : clmmAmountOut,
          minOutAmount,
          shareFeeRate,
          shareFeeReceiver,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild({
      txVersion,
      extInfo: {
        routes: [
          {
            mint: new PublicKey(inputMint),
            amount: fixClmmOut ? maxClmmAmountIn : inputAmount,
            decimal: clmmPoolData.poolInfo[baseIn ? "mintA" : "mintB"].decimals,
          },
          {
            mint: baseIn ? clmmMintB : clmmMintA,
            amount: clmmAmountOut,
            decimal: clmmPoolData.poolInfo[baseIn ? "mintB" : "mintA"].decimals,
          },
          {
            mint: launchPoolInfo.mintA,
            amount: outAmount,
            decimal: launchPoolInfo.mintDecimalsA,
          },
        ],
        outAmount,
        minOutAmount,
      },
    }) as Promise<
      MakeTxData<
        T,
        {
          routes: { mint: PublicKey; amount: BN; decimal: number }[];
          outAmount: BN;
          minOutAmount: BN;
        }
      >
    >;
  }

  public async computeClmmToLaunchAmount({
    inputMint,
    inputAmount,
    fixClmmOut = false,
    clmmPoolId,
    launchPoolId,
    slippage: propsSlippage,
    epochInfo,
    shareFeeRate = new BN(0),

    clmmPoolData: propsClmmPoolData,
    launchPoolInfo: propsLaunchPoolInfo,
    launchPlatformInfo: propsLaunchPlatformInfo,
    slot,
    mintInfo: propsMintInfo,
  }: {
    clmmPoolId: string | PublicKey;
    launchPoolId: string | PublicKey;
    inputMint: string | PublicKey;
    inputAmount: BN;
    fixClmmOut?: boolean;
    slippage: number;
    epochInfo?: EpochInfo;
    shareFeeRate?: BN;

    clmmPoolData?: {
      poolInfo: ApiV3PoolInfoConcentratedItem;
      poolKeys: ClmmKeys;
      computePoolInfo: ComputeClmmPoolInfo;
      tickData: ReturnTypeFetchMultiplePoolTickArrays;
    };
    launchPoolInfo?: LaunchpadPoolInfo & { programId: PublicKey; configInfo: LaunchpadConfigInfo };
    launchPlatformInfo?: Pick<LaunchpadPlatformInfo, "feeRate" | "creatorFeeRate">;
    slot?: number;
    mintInfo?: ApiV3Token;
  }): Promise<{
    clmmPoolData: {
      poolInfo: ApiV3PoolInfoConcentratedItem;
      poolKeys: ClmmKeys;
      computePoolInfo: ComputeClmmPoolInfo;
      tickData: ReturnTypeFetchMultiplePoolTickArrays;
    };
    clmmComputeAmount: { maxClmmAmountIn: BN; clmmAmountOut: BN; remainingAccounts: PublicKey[] };
    clmmComputeInfo: ReturnTypeComputeAmountOutBaseOut | ReturnTypeComputeAmountOutFormat;
    launchPoolInfo: LaunchpadPoolInfo & { programId: PublicKey; configInfo: LaunchpadConfigInfo };
    launchAuthProgramId: PublicKey;
    outAmount: BN;
    minOutAmount: BN;
    launchSwapInfo: SwapInfoReturn;
    launchMintTransferFeeConfig?: TransferFeeConfig;
  }> {
    // split slippage for clmm swap and launch buy
    const slippage =
      propsSlippage > 0
        ? new Decimal(propsSlippage).div(2).toDecimalPlaces(4, Decimal.ROUND_DOWN).toNumber()
        : propsSlippage;
    const clmmPoolData = propsClmmPoolData ?? (await this.scope.clmm.getPoolInfoFromRpc(clmmPoolId.toString()));
    if (
      inputMint.toString() !== clmmPoolData.poolInfo.mintA.address &&
      inputMint.toString() !== clmmPoolData.poolInfo.mintB.address
    )
      throw new Error("input mint does not match clmm pool mints, please check");
    const baseIn = inputMint.toString() === clmmPoolData.poolInfo.mintA.address;
    const tokenOut = clmmPoolData.poolInfo[baseIn ? "mintB" : "mintA"];

    const clmmComputeAmount = fixClmmOut
      ? await PoolUtils.computeAmountIn({
          poolInfo: clmmPoolData.computePoolInfo,
          tickArrayCache: clmmPoolData.tickData[clmmPoolId.toString()],
          amountOut: inputAmount,
          baseMint: new PublicKey(clmmPoolData.poolInfo[baseIn ? "mintB" : "mintA"].address),
          slippage,
          epochInfo: epochInfo ?? (await this.scope.fetchEpochInfo()),
        })
      : await PoolUtils.computeAmountOutFormat({
          poolInfo: clmmPoolData.computePoolInfo,
          tickArrayCache: clmmPoolData.tickData[clmmPoolId.toString()],
          amountIn: inputAmount,
          tokenOut,
          slippage,
          epochInfo: epochInfo ?? (await this.scope.fetchEpochInfo()),
        });

    let launchPoolInfo = propsLaunchPoolInfo;
    if (!launchPoolInfo)
      launchPoolInfo = await this.scope.launchpad.getRpcPoolInfo({ poolId: new PublicKey(launchPoolId) });

    if (tokenOut.address !== launchPoolInfo.mintB.toBase58())
      throw new Error(`clmm swap mint(${tokenOut.address}) != launch pool mintB(${launchPoolInfo.mintB.toBase58()})`);
    let platformInfo = propsLaunchPlatformInfo;
    if (!platformInfo) {
      const data = await this.scope.connection.getAccountInfo(launchPoolInfo.platformId);
      platformInfo = PlatformConfig.decode(data!.data);
    }
    const mintInfo = propsMintInfo ?? (await this.scope.token.getTokenInfo(launchPoolInfo.mintA));
    const authProgramId = getPdaLaunchpadAuth(launchPoolInfo.programId).publicKey;

    const launchMintTransferFeeConfig = mintInfo.extensions.feeConfig
      ? {
          transferFeeConfigAuthority: PublicKey.default,
          withdrawWithheldAuthority: PublicKey.default,
          withheldAmount: BigInt(0),
          olderTransferFee: {
            epoch: BigInt(mintInfo.extensions.feeConfig.olderTransferFee.epoch ?? epochInfo?.epoch ?? 0),
            maximumFee: BigInt(mintInfo.extensions.feeConfig.olderTransferFee.maximumFee),
            transferFeeBasisPoints: mintInfo.extensions.feeConfig.olderTransferFee.transferFeeBasisPoints,
          },
          newerTransferFee: {
            epoch: BigInt(mintInfo.extensions.feeConfig.newerTransferFee.epoch ?? epochInfo?.epoch ?? 0),
            maximumFee: BigInt(mintInfo.extensions.feeConfig.newerTransferFee.maximumFee),
            transferFeeBasisPoints: mintInfo.extensions.feeConfig.newerTransferFee.transferFeeBasisPoints,
          },
        }
      : undefined;

    const launchBuyAmount = fixClmmOut
      ? inputAmount
      : (clmmComputeAmount as ReturnTypeComputeAmountOutFormat).minAmountOut.amount.raw;

    const launchSwapInfo = Curve.buyExactIn({
      poolInfo: launchPoolInfo,
      amountB: launchBuyAmount,
      protocolFeeRate: launchPoolInfo.configInfo.tradeFeeRate,
      platformFeeRate: platformInfo.feeRate,
      curveType: launchPoolInfo.configInfo.curveType,
      shareFeeRate,
      creatorFeeRate: platformInfo.creatorFeeRate,
      transferFeeConfigA: launchMintTransferFeeConfig,
      slot: slot ?? (await this.scope.connection.getSlot()),
    });

    const outAmount = launchSwapInfo.amountA.amount.sub(launchSwapInfo.amountA.fee ?? new BN(0));
    const decimalAmountA = new Decimal(outAmount.toString());

    const SLIPPAGE_UNIT = new BN(10000);
    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.sub(new BN(slippage * 10000)).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(0, 1)
      : new Decimal(1);

    return {
      clmmPoolData,
      clmmComputeAmount: {
        maxClmmAmountIn: fixClmmOut
          ? (clmmComputeAmount as ReturnTypeComputeAmountOutBaseOut).maxAmountIn.amount
          : inputAmount,
        clmmAmountOut: launchBuyAmount,
        remainingAccounts: clmmComputeAmount.remainingAccounts,
      },
      clmmComputeInfo: clmmComputeAmount,

      launchPoolInfo,
      launchAuthProgramId: authProgramId,
      launchMintTransferFeeConfig,
      launchSwapInfo,
      outAmount: launchSwapInfo.amountA.amount.sub(launchSwapInfo.amountA.fee ?? new BN(0)),
      minOutAmount: new BN(decimalAmountA.mul(multiplier).toFixed(0)),
    };
  }

  public async swapLaunchMintToClmm<T extends TxVersion>({
    inputAmount,
    clmmPoolId,
    launchPoolId,
    priceLimit,
    slippage = 0.01,
    shareFeeRate = new BN(0),
    shareFeeReceiver,
    ownerInfo = { useSOLBalance: true },
    checkCreateATAOwner = false,
    computeBudgetConfig,
    txVersion,
  }: {
    inputAmount: BN;
    clmmPoolId: string | PublicKey;
    launchPoolId: string | PublicKey;
    priceLimit?: Decimal;
    slippage: number; // from 0~1
    shareFeeRate?: BN;
    shareFeeReceiver?: PublicKey;
    ownerInfo?: {
      useSOLBalance?: boolean;
      feePayer?: PublicKey;
    };
    checkCreateATAOwner?: boolean;
    computeBudgetConfig?: ComputeBudgetConfig;
    txVersion: T;
  }): Promise<
    MakeTxData<
      T,
      {
        routes: { mint: PublicKey; amount: BN; decimal: number }[];
        outAmount: BN;
        minOutAmount: BN;
      }
    >
  > {
    const feePayer = ownerInfo?.feePayer || this.scope.ownerPubKey;
    const epochInfo = await this.scope.fetchEpochInfo();

    const {
      clmmPoolData,
      clmmComputeAmount: { remainingAccounts },
      launchPoolInfo,
      launchAuthProgramId,
      launchSwapInfo,
      minLaunchOutAmount,
      outAmount,
      minOutAmount,
    } = await this.computeLaunchToClmmAmount({
      inputAmount,
      clmmPoolId,
      launchPoolId,
      slippage,
      epochInfo,
      shareFeeRate,
    });

    const txBuilder = this.createTxBuilder(feePayer);
    const tokenAccountMap: Record<string, PublicKey> = {};

    const launchMintAProgram = launchPoolInfo.mintProgramFlag === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

    const { account: launchTokenAccountA } = await this.scope.account.getOrCreateTokenAccount({
      tokenProgram: launchMintAProgram,
      mint: launchPoolInfo.mintA,
      notUseTokenAccount: false,
      owner: this.scope.ownerPubKey,
      skipCloseAccount: true,
      createInfo: undefined,
      associatedOnly: true,
      checkCreateATAOwner,
    });
    if (!launchTokenAccountA)
      throw new Error(`do not have launch mint(${launchPoolInfo.mintA.toString()}) token account`);

    const mintBUseSol = launchPoolInfo.mintB.equals(WSOLMint);
    const { account: launchTokenAccountB, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
      tokenProgram: TOKEN_PROGRAM_ID,
      mint: launchPoolInfo.mintB,
      notUseTokenAccount: mintBUseSol,
      owner: this.scope.ownerPubKey,
      skipCloseAccount: !mintBUseSol,
      createInfo: {
        payer: this.scope.ownerPubKey!,
        amount: 0,
      },
      associatedOnly: false,
      checkCreateATAOwner,
    });
    instructionParams && txBuilder.addInstruction(instructionParams);
    if (!launchTokenAccountB)
      throw new Error(`do not have launch mint(${launchPoolInfo.mintA.toString()}) token account`);
    tokenAccountMap[launchPoolInfo.mintB.toBase58()] = launchTokenAccountB;

    txBuilder.addInstruction({
      instructions: [
        sellExactInInstruction(
          launchPoolInfo.programId,
          this.scope.ownerPubKey,
          launchAuthProgramId,
          launchPoolInfo.configId,
          launchPoolInfo.platformId,
          new PublicKey(launchPoolId),
          launchTokenAccountA,
          launchTokenAccountB,
          launchPoolInfo.vaultA,
          launchPoolInfo.vaultB,
          launchPoolInfo.mintA,
          launchPoolInfo.mintB,
          launchMintAProgram,
          TOKEN_PROGRAM_ID,

          getPdaPlatformVault(launchPoolInfo.programId, launchPoolInfo.platformId, launchPoolInfo.mintB).publicKey,
          getPdaCreatorVault(launchPoolInfo.programId, launchPoolInfo.creator, launchPoolInfo.mintB).publicKey,

          launchSwapInfo.amountA.amount.lt(inputAmount) ? launchSwapInfo.amountA.amount : inputAmount,
          minLaunchOutAmount,
          shareFeeRate,
          shareFeeReceiver,
        ),
      ],
    });

    const baseIn = launchPoolInfo.mintB.toString() === clmmPoolData.poolInfo.mintA.address;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && clmmPoolData.poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && clmmPoolData.poolInfo.mintB.address === WSOLMint.toBase58();

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = baseIn ? MIN_SQRT_PRICE_X64.add(new BN(1)) : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        clmmPoolData.poolInfo.mintA.decimals,
        clmmPoolData.poolInfo.mintB.decimals,
      );
    }

    const [clmmMintA, clmmMintB] = [
      new PublicKey(clmmPoolData.poolInfo.mintA.address),
      new PublicKey(clmmPoolData.poolInfo.mintB.address),
    ];
    const [clmmMintAProgram, clmmMintBProgram] = [
      new PublicKey(clmmPoolData.poolInfo.mintA.programId),
      new PublicKey(clmmPoolData.poolInfo.mintB.programId),
    ];

    let ownerTokenAccountA = mintAUseSOLBalance
      ? undefined
      : this.scope.account.getAssociatedTokenAccount(clmmMintA, clmmMintAProgram);

    let ownerTokenAccountB = mintBUseSOLBalance
      ? undefined
      : this.scope.account.getAssociatedTokenAccount(clmmMintB, clmmMintBProgram);

    // this means mintA is wsol
    if (!ownerTokenAccountA) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: clmmMintAProgram,
        mint: clmmMintA,
        notUseTokenAccount: true,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: false,
        createInfo: {
          payer: ownerInfo.feePayer || this.scope.ownerPubKey,
          amount: baseIn ? inputAmount : 0,
        },
        associatedOnly: false,
        checkCreateATAOwner,
      });
      ownerTokenAccountA = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    // this means mintB is wsol
    if (!ownerTokenAccountB) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: clmmMintBProgram,
        mint: clmmMintB,
        notUseTokenAccount: true,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: false,
        createInfo: {
          payer: ownerInfo.feePayer || this.scope.ownerPubKey,
          amount: baseIn ? 0 : inputAmount,
        },
        associatedOnly: false,
        checkCreateATAOwner,
      });
      ownerTokenAccountB = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }
    tokenAccountMap[clmmPoolData.poolInfo.mintA.address] = ownerTokenAccountA;
    tokenAccountMap[clmmPoolData.poolInfo.mintB.address] = ownerTokenAccountB;

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("user do not have token account", {
        ownerTokenAccountA,
        ownerTokenAccountB,
      });

    txBuilder.addInstruction(
      ClmmInstrument.makeSwapBaseInInstructions({
        poolInfo: clmmPoolData.poolInfo,
        poolKeys: clmmPoolData.poolKeys,
        observationId: clmmPoolData.computePoolInfo.observationId,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccountA: ownerTokenAccountA!,
          tokenAccountB: ownerTokenAccountB!,
        },
        inputMint: new PublicKey(clmmPoolData.poolKeys[baseIn ? "mintA" : "mintB"].address),
        amountIn: minLaunchOutAmount,
        amountOutMin: minOutAmount,
        sqrtPriceLimitX64,
        remainingAccounts,
      }),
    );

    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild({
      txVersion,
      extInfo: {
        routes: [
          {
            mint: launchPoolInfo.mintA,
            amount: inputAmount,
            decimal: launchPoolInfo.mintDecimalsA,
          },
          {
            mint: launchPoolInfo.mintB,
            amount: minLaunchOutAmount,
            decimal: launchPoolInfo.mintDecimalsB,
          },
          {
            mint: new PublicKey(clmmPoolData.poolKeys[baseIn ? "mintB" : "mintA"].address),
            amount: outAmount,
            decimal: clmmPoolData.poolKeys[baseIn ? "mintB" : "mintA"].decimals,
          },
        ],
        outAmount,
        minOutAmount,
      },
    }) as Promise<
      MakeTxData<
        T,
        {
          routes: { mint: PublicKey; amount: BN; decimal: number }[];
          outAmount: BN;
          minOutAmount: BN;
        }
      >
    >;
  }

  public async computeLaunchToClmmAmount({
    inputAmount,
    clmmPoolId,
    launchPoolId,
    slippage: propsSlippage,
    epochInfo,
    shareFeeRate = new BN(0),

    clmmPoolData: propsClmmPoolData,
    launchPoolInfo: propsLaunchPoolInfo,
    launchPlatformInfo: propsLaunchPlatformInfo,
  }: {
    clmmPoolId: string | PublicKey;
    launchPoolId: string | PublicKey;
    inputAmount: BN;
    slippage: number;
    epochInfo?: EpochInfo;
    shareFeeRate?: BN;

    clmmPoolData?: {
      poolInfo: ApiV3PoolInfoConcentratedItem;
      poolKeys: ClmmKeys;
      computePoolInfo: ComputeClmmPoolInfo;
      tickData: ReturnTypeFetchMultiplePoolTickArrays;
    };
    launchPoolInfo?: LaunchpadPoolInfo & { programId: PublicKey; configInfo: LaunchpadConfigInfo };
    launchPlatformInfo?: LaunchpadPlatformInfo;
  }): Promise<{
    clmmPoolData: {
      poolInfo: ApiV3PoolInfoConcentratedItem;
      poolKeys: ClmmKeys;
      computePoolInfo: ComputeClmmPoolInfo;
      tickData: ReturnTypeFetchMultiplePoolTickArrays;
    };
    clmmComputeAmount: ReturnTypeComputeAmountOutFormat;
    launchPoolInfo: LaunchpadPoolInfo & { programId: PublicKey; configInfo: LaunchpadConfigInfo };
    launchAuthProgramId: PublicKey;
    minLaunchOutAmount: BN;
    outAmount: BN;
    minOutAmount: BN;
    launchSwapInfo: SwapInfoReturn;
    launchMintTransferFeeConfig?: TransferFeeConfig;
  }> {
    // split slippage for clmm swap and launch buy
    const slippage =
      propsSlippage > 0
        ? new Decimal(propsSlippage).div(2).toDecimalPlaces(4, Decimal.ROUND_DOWN).toNumber()
        : propsSlippage;

    let launchPoolInfo = propsLaunchPoolInfo;
    if (!launchPoolInfo)
      launchPoolInfo = await this.scope.launchpad.getRpcPoolInfo({ poolId: new PublicKey(launchPoolId) });

    const inputMint = launchPoolInfo.mintB;

    const clmmPoolData = propsClmmPoolData ?? (await this.scope.clmm.getPoolInfoFromRpc(clmmPoolId.toString()));
    if (
      inputMint.toString() !== clmmPoolData.poolInfo.mintA.address &&
      inputMint.toString() !== clmmPoolData.poolInfo.mintB.address
    )
      throw new Error("input mint does not match clmm pool mints, please check");

    const baseIn = inputMint.toString() === clmmPoolData.poolInfo.mintA.address;
    const tokenOut = clmmPoolData.poolInfo[baseIn ? "mintB" : "mintA"];

    let platformInfo = propsLaunchPlatformInfo;
    if (!platformInfo) {
      const data = await this.scope.connection.getAccountInfo(launchPoolInfo.platformId);
      platformInfo = PlatformConfig.decode(data!.data);
    }
    const mintInfo = await this.scope.token.getTokenInfo(launchPoolInfo.mintA);
    const authProgramId = getPdaLaunchpadAuth(launchPoolInfo.programId).publicKey;

    const launchMintTransferFeeConfig = mintInfo.extensions.feeConfig
      ? {
          transferFeeConfigAuthority: PublicKey.default,
          withdrawWithheldAuthority: PublicKey.default,
          withheldAmount: BigInt(0),
          olderTransferFee: {
            epoch: BigInt(mintInfo.extensions.feeConfig.olderTransferFee.epoch ?? epochInfo?.epoch ?? 0),
            maximumFee: BigInt(mintInfo.extensions.feeConfig.olderTransferFee.maximumFee),
            transferFeeBasisPoints: mintInfo.extensions.feeConfig.olderTransferFee.transferFeeBasisPoints,
          },
          newerTransferFee: {
            epoch: BigInt(mintInfo.extensions.feeConfig.newerTransferFee.epoch ?? epochInfo?.epoch ?? 0),
            maximumFee: BigInt(mintInfo.extensions.feeConfig.newerTransferFee.maximumFee),
            transferFeeBasisPoints: mintInfo.extensions.feeConfig.newerTransferFee.transferFeeBasisPoints,
          },
        }
      : undefined;

    const launchSwapInfo = Curve.sellExactIn({
      poolInfo: launchPoolInfo,
      amountA: inputAmount,
      protocolFeeRate: launchPoolInfo.configInfo.tradeFeeRate,
      platformFeeRate: platformInfo.feeRate,
      curveType: launchPoolInfo.configInfo.curveType,
      shareFeeRate,
      creatorFeeRate: platformInfo.creatorFeeRate,
      transferFeeConfigA: launchMintTransferFeeConfig,
      slot: await this.scope.connection.getSlot(),
    });

    const outAmount = launchSwapInfo.amountB;
    const decimalAmountB = new Decimal(outAmount.toString());

    const SLIPPAGE_UNIT = new BN(10000);
    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.sub(new BN(slippage * 10000)).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(0, 1)
      : new Decimal(1);

    const minLaunchOutAmount = new BN(decimalAmountB.mul(multiplier).toFixed(0));

    const clmmComputeAmount = await PoolUtils.computeAmountOutFormat({
      poolInfo: clmmPoolData.computePoolInfo,
      tickArrayCache: clmmPoolData.tickData[clmmPoolId.toString()],
      amountIn: minLaunchOutAmount,
      tokenOut,
      slippage,
      epochInfo: epochInfo ?? (await this.scope.fetchEpochInfo()),
    });

    return {
      clmmPoolData,
      clmmComputeAmount,

      launchPoolInfo,
      launchAuthProgramId: authProgramId,
      launchMintTransferFeeConfig,
      launchSwapInfo,
      minLaunchOutAmount,
      outAmount: clmmComputeAmount.amountOut.amount.raw,
      minOutAmount: clmmComputeAmount.minAmountOut.amount.raw,
    };
  }

  // get all amm/clmm/cpmm pools data only with id and mint
  public async fetchRoutePoolBasicInfo(programIds?: { amm: PublicKey; clmm: PublicKey; cpmm: PublicKey }): Promise<{
    ammPools: BasicPoolInfo[];
    clmmPools: BasicPoolInfo[];
    cpmmPools: BasicPoolInfo[];
  }> {
    const { amm = AMM_V4, clmm = CLMM_PROGRAM_ID, cpmm = CREATE_CPMM_POOL_PROGRAM } = programIds || {};
    const ammPoolsData = await this.scope.connection.getProgramAccounts(amm, {
      dataSlice: { offset: liquidityStateV4Layout.offsetOf("baseMint"), length: 64 },
    });

    const layoutAmm = struct([publicKey("baseMint"), publicKey("quoteMint")]);
    const ammData = ammPoolsData.map((data) => ({
      id: data.pubkey,
      version: 4,
      mintA: layoutAmm.decode(data.account.data).baseMint,
      mintB: layoutAmm.decode(data.account.data).quoteMint,
    }));

    const layout = struct([publicKey("mintA"), publicKey("mintB")]);
    const clmmPoolsData = await this.scope.connection.getProgramAccounts(clmm, {
      filters: [{ dataSize: PoolInfoLayout.span }],
      dataSlice: { offset: PoolInfoLayout.offsetOf("mintA"), length: 64 },
    });

    const clmmData = clmmPoolsData.map((data) => {
      const clmm = layout.decode(data.account.data);
      return {
        id: data.pubkey,
        version: 6,
        mintA: clmm.mintA,
        mintB: clmm.mintB,
      };
    });

    const cpmmPools = await this.scope.connection.getProgramAccounts(cpmm, {
      dataSlice: { offset: CpmmPoolInfoLayout.offsetOf("mintA"), length: 64 },
    });

    const cpmmData = cpmmPools.map((data) => {
      const clmm = layout.decode(data.account.data);
      return {
        id: data.pubkey,
        version: 7,
        mintA: clmm.mintA,
        mintB: clmm.mintB,
      };
    });

    return {
      clmmPools: clmmData,
      ammPools: ammData,
      cpmmPools: cpmmData,
    };
  }

  // get pools with in routes
  public getAllRoute({
    inputMint,
    outputMint,
    clmmPools,
    ammPools,
    cpmmPools,
  }: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    clmmPools: BasicPoolInfo[];
    ammPools: BasicPoolInfo[];
    cpmmPools: BasicPoolInfo[];
  }): ReturnTypeGetAllRoute {
    inputMint = inputMint.toString() === PublicKey.default.toString() ? WSOLMint : inputMint;
    outputMint = outputMint.toString() === PublicKey.default.toString() ? WSOLMint : outputMint;

    const needSimulate: { [poolKey: string]: BasicPoolInfo } = {};
    const needTickArray: { [poolKey: string]: BasicPoolInfo } = {};
    const cpmmPoolList: { [poolKey: string]: BasicPoolInfo } = {};

    const directPath: BasicPoolInfo[] = [];

    const routePathDict: RoutePathType = {}; // {[route mint: string]: {in: [] , out: []}}

    for (const itemClmmPool of clmmPools ?? []) {
      if (
        (itemClmmPool.mintA.equals(inputMint) && itemClmmPool.mintB.equals(outputMint)) ||
        (itemClmmPool.mintA.equals(outputMint) && itemClmmPool.mintB.equals(inputMint))
      ) {
        directPath.push(itemClmmPool);
        needTickArray[itemClmmPool.id.toString()] = itemClmmPool;
      }

      if (itemClmmPool.mintA.equals(inputMint)) {
        const t = itemClmmPool.mintB.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].in.push(itemClmmPool);
      }
      if (itemClmmPool.mintB.equals(inputMint)) {
        const t = itemClmmPool.mintA.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].in.push(itemClmmPool);
      }
      if (itemClmmPool.mintA.equals(outputMint)) {
        const t = itemClmmPool.mintB.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].out.push(itemClmmPool);
      }
      if (itemClmmPool.mintB.equals(outputMint)) {
        const t = itemClmmPool.mintA.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].out.push(itemClmmPool);
      }
    }

    const addLiquidityPools: BasicPoolInfo[] = [];

    for (const itemAmmPool of ammPools) {
      if (
        (itemAmmPool.mintA.equals(inputMint) && itemAmmPool.mintB.equals(outputMint)) ||
        (itemAmmPool.mintA.equals(outputMint) && itemAmmPool.mintB.equals(inputMint))
      ) {
        directPath.push(itemAmmPool);
        needSimulate[itemAmmPool.id.toBase58()] = itemAmmPool;
        addLiquidityPools.push(itemAmmPool);
      }
      if (itemAmmPool.mintA.equals(inputMint)) {
        if (routePathDict[itemAmmPool.mintB.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintB.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintB.toBase58()].in.push(itemAmmPool);
      }
      if (itemAmmPool.mintB.equals(inputMint)) {
        if (routePathDict[itemAmmPool.mintA.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintA.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintA.toBase58()].in.push(itemAmmPool);
      }
      if (itemAmmPool.mintA.equals(outputMint)) {
        if (routePathDict[itemAmmPool.mintB.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintB.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintB.toBase58()].out.push(itemAmmPool);
      }
      if (itemAmmPool.mintB.equals(outputMint)) {
        if (routePathDict[itemAmmPool.mintA.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintA.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintA.toBase58()].out.push(itemAmmPool);
      }
    }

    for (const itemCpmmPool of cpmmPools) {
      if (
        (itemCpmmPool.mintA.equals(inputMint) && itemCpmmPool.mintB.equals(outputMint)) ||
        (itemCpmmPool.mintA.equals(outputMint) && itemCpmmPool.mintB.equals(inputMint))
      ) {
        directPath.push(itemCpmmPool);
        cpmmPoolList[itemCpmmPool.id.toBase58()] = itemCpmmPool;
      }
      if (itemCpmmPool.mintA.equals(inputMint)) {
        if (routePathDict[itemCpmmPool.mintB.toBase58()] === undefined)
          routePathDict[itemCpmmPool.mintB.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemCpmmPool.mintB.toBase58()].in.push(itemCpmmPool);
      }
      if (itemCpmmPool.mintB.equals(inputMint)) {
        if (routePathDict[itemCpmmPool.mintA.toBase58()] === undefined)
          routePathDict[itemCpmmPool.mintA.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemCpmmPool.mintA.toBase58()].in.push(itemCpmmPool);
      }
      if (itemCpmmPool.mintA.equals(outputMint)) {
        if (routePathDict[itemCpmmPool.mintB.toBase58()] === undefined)
          routePathDict[itemCpmmPool.mintB.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemCpmmPool.mintB.toBase58()].out.push(itemCpmmPool);
      }
      if (itemCpmmPool.mintB.equals(outputMint)) {
        if (routePathDict[itemCpmmPool.mintA.toBase58()] === undefined)
          routePathDict[itemCpmmPool.mintA.toBase58()] = {
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemCpmmPool.mintA.toBase58()].out.push(itemCpmmPool);
      }
    }

    for (const t of Object.keys(routePathDict)) {
      if (
        routePathDict[t].in.length === 1 &&
        routePathDict[t].out.length === 1 &&
        routePathDict[t].in[0].id.equals(routePathDict[t].out[0].id)
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
            needTickArray[infoIn.id.toString()] = infoIn;
          } else if (infoIn.version === 7 && cpmmPoolList[infoIn.id.toString()] === undefined) {
            cpmmPoolList[infoIn.id.toString()] = infoIn;
          } else if (
            (infoIn.version === 4 || infoIn.version === 5) &&
            needSimulate[infoIn.id.toString()] === undefined
          ) {
            needSimulate[infoIn.id.toString()] = infoIn;
          }
          if (infoOut.version === 6 && needTickArray[infoOut.id.toString()] === undefined) {
            needTickArray[infoOut.id.toString()] = infoOut;
          } else if (infoOut.version === 7 && cpmmPoolList[infoOut.id.toString()] === undefined) {
            cpmmPoolList[infoOut.id.toString()] = infoOut;
          } else if (
            (infoOut.version === 4 || infoOut.version === 5) &&
            needSimulate[infoOut.id.toString()] === undefined
          ) {
            needSimulate[infoOut.id.toString()] = infoOut;
          }
        }
      }
    }

    return {
      directPath,
      addLiquidityPools,
      routePathDict,
      needSimulate: Object.values(needSimulate),
      needTickArray: Object.values(needTickArray),
      cpmmPoolList: Object.values(cpmmPoolList),
    };
  }

  // fetch pools detail info in route
  public async fetchSwapRoutesData({
    routes,
    inputMint,
    outputMint,
  }: {
    inputMint: string | PublicKey;
    outputMint: string | PublicKey;
    routes: ReturnTypeGetAllRoute;
  }): Promise<{
    mintInfos: ReturnTypeFetchMultipleMintInfos;
    ammPoolsRpcInfo: Record<string, AmmRpcData>;
    ammSimulateCache: Record<string, ComputeAmountOutParam["poolInfo"]>;
    clmmPoolsRpcInfo: Record<string, ClmmParsedRpcData>;
    computeClmmPoolInfo: Record<string, ComputeClmmPoolInfo>;
    computePoolTickData: ReturnTypeFetchMultiplePoolTickArrays;
    computeCpmmData: Record<string, CpmmComputeData>;
    routePathDict: ComputeRoutePathType;
  }> {
    const mintSet = new Set([
      ...routes.needTickArray.map((p) => [p.mintA.toBase58(), p.mintB.toBase58()]).flat(),
      inputMint.toString(),
      outputMint.toString(),
    ]);

    console.log("fetching amm pools info, total: ", routes.needSimulate.length);
    const ammPoolsRpcInfo = await this.scope.liquidity.getRpcPoolInfos(routes.needSimulate.map((p) => p.id));
    const ammSimulateCache = toAmmComputePoolInfo(ammPoolsRpcInfo);

    let mintInfos: ReturnTypeFetchMultipleMintInfos = {};
    // amm doesn't support token2022 yet, so don't need to fetch mint info
    Object.values(ammSimulateCache).forEach((p) => {
      mintSet.delete(p.mintA.address);
      mintInfos[p.mintA.address] = {
        address: new PublicKey(p.mintA.address),
        programId: TOKEN_PROGRAM_ID,
        mintAuthority: null,
        supply: BigInt(0),
        decimals: p.mintA.decimals,
        isInitialized: true,
        freezeAuthority: null,
        tlvData: Buffer.from("0", "hex"),
        feeConfig: undefined,
      };

      mintSet.delete(p.mintB.address);
      mintInfos[p.mintB.address] = {
        address: new PublicKey(p.mintB.address),
        programId: TOKEN_PROGRAM_ID,
        mintAuthority: null,
        supply: BigInt(0),
        decimals: p.mintB.decimals,
        isInitialized: true,
        freezeAuthority: null,
        tlvData: Buffer.from("0", "hex"),
        feeConfig: undefined,
      };
    });

    console.log("fetching cpmm pools info, total: ", routes.cpmmPoolList.length);
    const cpmmPoolsRpcInfo = await this.scope.cpmm.getRpcPoolInfos(
      routes.cpmmPoolList.map((p) => p.id.toBase58()),
      true,
    );

    Object.values(cpmmPoolsRpcInfo).forEach((p) => {
      const [mintA, mintB] = [p.mintA.toBase58(), p.mintB.toBase58()];
      if (p.mintProgramA.equals(TOKEN_PROGRAM_ID)) {
        mintSet.delete(mintA);
        mintInfos[mintA] = {
          address: p.mintA,
          programId: p.mintProgramA,
          mintAuthority: null,
          supply: BigInt(0),
          decimals: p.mintDecimalA,
          isInitialized: true,
          freezeAuthority: null,
          tlvData: Buffer.from("0", "hex"),
          feeConfig: undefined,
        };
      } else mintSet.add(mintA); // 2022, need to fetch fee config
      if (p.mintProgramB.equals(TOKEN_PROGRAM_ID)) {
        mintSet.delete(mintB);
        mintInfos[mintB] = {
          address: p.mintB,
          programId: p.mintProgramB,
          mintAuthority: null,
          supply: BigInt(0),
          decimals: p.mintDecimalB,
          isInitialized: true,
          freezeAuthority: null,
          tlvData: Buffer.from("0", "hex"),
          feeConfig: undefined,
        };
      } else mintSet.add(mintB); // 2022, need to fetch fee config
    });

    console.log("fetching mints info, total: ", mintSet.size);
    const fetchMintInfoRes = await fetchMultipleMintInfos({
      connection: this.scope.connection,
      mints: Array.from(mintSet).map((m) => new PublicKey(m)),
    });

    mintInfos = {
      ...mintInfos,
      ...fetchMintInfoRes,
    };

    const computeCpmmData = this.scope.cpmm.toComputePoolInfos({
      pools: cpmmPoolsRpcInfo,
      mintInfos,
    });

    console.log("fetching clmm pools info, total:", routes.needTickArray.length);
    const clmmPoolsRpcInfo = await this.scope.clmm.getRpcClmmPoolInfos({
      poolIds: routes.needTickArray.map((p) => p.id),
    });
    const { computeClmmPoolInfo, computePoolTickData } = await this.scope.clmm.getComputeClmmPoolInfos({
      clmmPoolsRpcInfo,
      mintInfos,
    });

    // update route pool mint info
    const routePathDict = Object.keys(routes.routePathDict).reduce((acc, cur) => {
      return {
        ...acc,
        [cur]: {
          ...routes.routePathDict[cur],
          mintProgram: mintInfos[cur].programId,
          mDecimals: mintInfos[cur].decimals,
          in: routes.routePathDict[cur].in.map(
            (p) =>
              ammSimulateCache[p.id.toBase58()] ||
              computeClmmPoolInfo[p.id.toBase58()] ||
              computeCpmmData[p.id.toBase58()],
          ),
          out: routes.routePathDict[cur].out.map(
            (p) =>
              ammSimulateCache[p.id.toBase58()] ||
              computeClmmPoolInfo[p.id.toBase58()] ||
              computeCpmmData[p.id.toBase58()],
          ),
        },
      };
    }, {} as ComputeRoutePathType);

    return {
      mintInfos,

      ammPoolsRpcInfo,
      ammSimulateCache,

      clmmPoolsRpcInfo,
      computeClmmPoolInfo,
      computePoolTickData,

      computeCpmmData,

      routePathDict,
    };
  }

  // compute amount from routes
  public getAllRouteComputeAmountOut({
    inputTokenAmount,
    outputToken: propOutputToken,
    directPath,
    routePathDict,
    simulateCache,
    tickCache,
    slippage,
    chainTime,
    epochInfo,
    feeConfig,
  }: {
    directPath: ComputePoolType[];
    routePathDict: ComputeRoutePathType;
    simulateCache: ReturnTypeFetchMultipleInfo;
    tickCache: ReturnTypeFetchMultiplePoolTickArrays;

    mintInfos: ReturnTypeFetchMultipleMintInfos;

    inputTokenAmount: TokenAmount;
    outputToken: ApiV3Token;
    slippage: number;
    chainTime: number;
    epochInfo: EpochInfo;

    feeConfig?: {
      feeBps: BN;
      feeAccount: PublicKey;
    };
  }): ComputeAmountOutLayout[] {
    const _amountInFee =
      feeConfig === undefined
        ? new BN(0)
        : inputTokenAmount.raw.mul(new BN(feeConfig.feeBps.toNumber())).div(new BN(10000));
    const _amoutIn = inputTokenAmount.raw.sub(_amountInFee);
    const amountIn = new TokenAmount(inputTokenAmount.token, _amoutIn);
    const _inFeeConfig =
      feeConfig === undefined
        ? undefined
        : {
            feeAmount: _amountInFee,
            feeAccount: feeConfig.feeAccount,
          };
    const outputToken = {
      ...propOutputToken,
      address: solToWSol(propOutputToken.address).toString(),
    };
    const outRoute: ComputeAmountOutLayout[] = [];
    for (const itemPool of directPath) {
      try {
        outRoute.push({
          ...this.computeAmountOut({
            itemPool,
            tickCache,
            simulateCache,
            chainTime,
            epochInfo,
            slippage,
            outputToken,
            amountIn,
          }),
          feeConfig: _inFeeConfig,
        });
      } catch (e: any) {
        this.logDebug("direct error", itemPool.version, itemPool.id.toString(), e.message);
        /* empty */
      }
    }
    this.logDebug("direct done");
    for (const [routeMint, info] of Object.entries(routePathDict)) {
      // const routeToken = new Token(info.mintProgram, routeMint, info.mDecimals);
      const routeToken = {
        chainId: 101,
        address: routeMint,
        programId: info.mintProgram.toBase58(),
        logoURI: "",
        symbol: "",
        name: "",
        decimals: info.mDecimals,
        tags: [],
        extensions: {},
      };
      const maxFirstIn = info.in
        .map((i) => {
          try {
            return {
              pool: i,
              data: this.computeAmountOut({
                itemPool: i,
                tickCache,
                simulateCache,
                chainTime,
                epochInfo,
                slippage,
                outputToken: routeToken,
                amountIn,
              }),
            };
          } catch (e: any) {
            this.logDebug("route in error", i.version, i.id.toString(), e.message);
            return undefined;
          }
        })
        .sort((_a, _b) => {
          const a = _a === undefined ? ZERO : _a.data.amountOut.amount.raw.sub(_a.data.amountOut.fee?.raw ?? ZERO);
          const b = _b === undefined ? ZERO : _b.data.amountOut.amount.raw.sub(_b.data.amountOut.fee?.raw ?? ZERO);
          return a.lt(b) ? 1 : -1;
        })[0];
      if (maxFirstIn === undefined) continue;
      const routeAmountIn = new TokenAmount(
        toToken(routeToken),
        maxFirstIn.data.amountOut.amount.raw.sub(maxFirstIn.data.amountOut.fee?.raw ?? ZERO),
      );
      for (const iOutPool of info.out) {
        try {
          const outC = this.computeAmountOut({
            itemPool: iOutPool,
            tickCache,
            simulateCache,
            chainTime,
            epochInfo,
            slippage,
            outputToken,
            amountIn: routeAmountIn,
          });
          outRoute.push({
            ...outC,
            allTrade: maxFirstIn.data.allTrade && outC.allTrade ? true : false,
            amountIn: maxFirstIn.data.amountIn,
            amountOut: outC.amountOut,
            minAmountOut: outC.minAmountOut,
            currentPrice: undefined,
            executionPrice: new Decimal(
              new Price({
                baseToken: maxFirstIn.data.amountIn.amount.token,
                denominator: maxFirstIn.data.amountIn.amount.raw,
                quoteToken: outC.amountOut.amount.token,
                numerator: outC.amountOut.amount.raw.sub(outC.amountOut.fee?.raw ?? ZERO),
              }).toFixed(),
            ),
            priceImpact: new Decimal(maxFirstIn.data.priceImpact.add(outC.priceImpact).toFixed()),
            fee: [maxFirstIn.data.fee[0], outC.fee[0]],
            routeType: "route",
            poolInfoList: [maxFirstIn.pool, iOutPool],
            remainingAccounts: [maxFirstIn.data.remainingAccounts[0], outC.remainingAccounts[0]],
            minMiddleAmountFee: outC.amountOut.fee?.raw
              ? new TokenAmount(
                  (maxFirstIn.data.amountOut.amount as TokenAmount).token,
                  (maxFirstIn.data.amountOut.fee?.raw ?? ZERO).add(outC.amountOut.fee?.raw ?? ZERO),
                )
              : undefined,
            middleToken: (maxFirstIn.data.amountOut.amount as TokenAmount).token,
            poolReady: maxFirstIn.data.poolReady && outC.poolReady,
            poolType: [maxFirstIn.data.poolType, outC.poolType],
            feeConfig: _inFeeConfig,
            expirationTime: minExpirationTime(maxFirstIn.data.expirationTime, outC.expirationTime),
          });
        } catch (e: any) {
          this.logDebug("route out error", iOutPool.version, iOutPool.id.toString(), e.message);
          /* empty */
        }
      }
    }

    return outRoute
      .filter((i) => {
        if (!i.allTrade)
          this.logDebug(`pool ${i.poolInfoList.map((p) => p.id.toString()).join(",")} filter out since not all trade`);
        return i.allTrade;
      })
      .sort((a, b) => (a.amountOut.amount.raw.sub(b.amountOut.amount.raw).gt(ZERO) ? -1 : 1));
  }

  /** trade related utils */

  private computeAmountOut({
    itemPool,
    tickCache,
    simulateCache,
    chainTime,
    epochInfo,
    slippage,
    outputToken,
    amountIn,
  }: {
    itemPool: ComputePoolType;
    tickCache: ReturnTypeFetchMultiplePoolTickArrays;
    simulateCache: ReturnTypeFetchMultipleInfo;
    chainTime: number;
    epochInfo: EpochInfo;
    amountIn: TokenAmount;
    outputToken: ApiV3Token;
    slippage: number;
  }): ComputeAmountOutAmmLayout {
    if (itemPool.version === 6) {
      const {
        allTrade,
        realAmountIn,
        amountOut,
        minAmountOut,
        expirationTime,
        currentPrice,
        executionPrice,
        priceImpact,
        fee,
        remainingAccounts,
        executionPriceX64,
      } = PoolUtils.computeAmountOutFormat({
        poolInfo: itemPool,
        tickArrayCache: tickCache[itemPool.id.toString()],
        amountIn: amountIn.raw,
        tokenOut: outputToken,
        slippage,
        epochInfo,
        catchLiquidityInsufficient: true,
      });
      return {
        allTrade,
        amountIn: realAmountIn,
        amountOut,
        minAmountOut,
        currentPrice: new Decimal(currentPrice.toFixed()),
        executionPrice: new Decimal(executionPrice.toFixed()),
        priceImpact: new Decimal(priceImpact.toFixed()),
        fee: [fee],
        remainingAccounts: [remainingAccounts],
        routeType: "amm",
        poolInfoList: [itemPool],
        poolReady: itemPool.startTime < chainTime,
        poolType: "CLMM",
        slippage,
        clmmExPriceX64: [executionPriceX64],
        expirationTime: minExpirationTime(realAmountIn.expirationTime, expirationTime),
      };
    } else if (itemPool.version === 7) {
      const { allTrade, executionPrice, amountOut, minAmountOut, priceImpact, fee } = this.scope.cpmm.computeSwapAmount(
        {
          pool: itemPool,
          outputMint: outputToken.address,
          amountIn: amountIn.raw,
          slippage,
        },
      );

      return {
        allTrade,
        amountIn: { amount: amountIn, fee: undefined, expirationTime: undefined },
        amountOut: {
          amount: toTokenAmount({
            ...outputToken,
            amount: amountOut,
          }),
          fee: undefined,
          expirationTime: undefined,
        },
        minAmountOut: {
          amount: toTokenAmount({
            ...outputToken,
            amount: minAmountOut,
          }),
          fee: undefined,
          expirationTime: undefined,
        },
        currentPrice: itemPool.poolPrice,
        executionPrice,
        priceImpact,
        fee: [new TokenAmount(amountIn.token, fee)],
        remainingAccounts: [],
        routeType: "amm",
        poolInfoList: [itemPool],
        poolReady: itemPool.openTime.toNumber() < chainTime,
        poolType: "CPMM",
        slippage,
        clmmExPriceX64: [undefined],
        expirationTime: undefined,
      };
    } else {
      if (![1, 6, 7].includes(simulateCache[itemPool.id.toString()].status)) throw Error("swap error");
      const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } =
        this.scope.liquidity.computeAmountOut({
          poolInfo: simulateCache[itemPool.id.toString()],
          amountIn: amountIn.raw,
          mintIn: amountIn.token.mint,
          mintOut: outputToken.address,
          slippage,
        });
      return {
        amountIn: { amount: amountIn, fee: undefined, expirationTime: undefined },
        amountOut: {
          amount: toTokenAmount({
            ...outputToken,
            amount: amountOut,
          }),
          fee: undefined,
          expirationTime: undefined,
        },
        minAmountOut: {
          amount: toTokenAmount({
            ...outputToken,
            amount: minAmountOut,
          }),
          fee: undefined,
          expirationTime: undefined,
        },
        currentPrice,
        executionPrice,
        priceImpact,
        fee: [new TokenAmount(amountIn.token, fee)],
        routeType: "amm",
        poolInfoList: [itemPool],
        remainingAccounts: [],
        poolReady: Number(simulateCache[itemPool.id as string].openTime) < chainTime,
        poolType: itemPool.version === 5 ? "STABLE" : undefined,
        expirationTime: undefined,
        allTrade: true,
        slippage,
        clmmExPriceX64: [undefined],
      };
    }
  }

  public async computePoolToPoolKeys({
    pools,
    clmmRpcData = {},
    ammRpcData = {},
  }: {
    pools: ComputePoolType[];
    clmmRpcData?: Record<string, ClmmParsedRpcData>;
    ammRpcData?: Record<string, AmmRpcData>;
  }): Promise<PoolKeys[]> {
    const clmmFetchKeys = new Set(
      pools.filter((p) => p.version === 6 && !clmmRpcData[p.id.toString()]).map((p) => p.id.toString()),
    );
    if (clmmFetchKeys.size > 0) {
      const clmmData = await this.scope.clmm.getRpcClmmPoolInfos({ poolIds: Array.from(clmmFetchKeys) });
      Object.keys(clmmData).forEach((poolId) => {
        clmmRpcData[poolId] = clmmData[poolId];
      });
    }

    const ammFetchKeys = new Set(
      pools.filter((p) => p.version === 4 && !ammRpcData[p.id.toString()]).map((p) => p.id.toString()),
    );
    if (ammFetchKeys.size > 0) {
      const ammData = await this.scope.liquidity.getRpcPoolInfos(Array.from(ammFetchKeys));
      Object.keys(ammData).forEach((poolId) => {
        ammRpcData[poolId] = ammData[poolId];
      });
    }

    const ammMarketFetchKeys = new Set(
      pools.filter((p) => p.version === 4).map((p) => (p as ComputeAmountOutParam["poolInfo"]).marketId),
    );
    const marketData: Record<
      string,
      {
        marketProgramId: string;
        marketId: string;
        marketAuthority: string;
        marketBaseVault: string;
        marketQuoteVault: string;
        marketBids: string;
        marketAsks: string;
        marketEventQueue: string;
      }
    > = {};
    if (ammMarketFetchKeys.size > 0) {
      const marketAccount = await getMultipleAccountsInfoWithCustomFlags(
        this.scope.connection,
        Array.from(ammMarketFetchKeys).map((p) => ({ pubkey: new PublicKey(p) })),
      );
      marketAccount.forEach((m) => {
        if (!m.accountInfo) return;
        const itemMarketInfo = MARKET_STATE_LAYOUT_V3.decode(m.accountInfo.data);
        marketData[m.pubkey.toBase58()] = {
          marketId: m.pubkey.toString(),
          marketProgramId: m.accountInfo.owner.toString(),
          marketAuthority: Market.getAssociatedAuthority({
            programId: m.accountInfo.owner,
            marketId: m.pubkey,
          }).publicKey.toString(),
          marketBaseVault: itemMarketInfo.baseVault.toString(),
          marketQuoteVault: itemMarketInfo.quoteVault.toString(),
          marketBids: itemMarketInfo.bids.toString(),
          marketAsks: itemMarketInfo.asks.toString(),
          marketEventQueue: itemMarketInfo.eventQueue.toString(),
        };
      });
    }

    const poolKeys: PoolKeys[] = [];
    pools.forEach((pool) => {
      if (pool.version === 6) {
        const rpcInfo = clmmRpcData[pool.id.toString()];
        const clmmKeys: ClmmKeys = {
          programId: pool.programId.toBase58(),
          id: pool.id.toBase58(),
          mintA: pool.mintA,
          mintB: pool.mintB,
          openTime: String(pool.startTime),
          vault: {
            A: rpcInfo.vaultA.toBase58(),
            B: rpcInfo.vaultB.toBase58(),
          },
          config: {
            ...pool.ammConfig,
            id: pool.ammConfig.id.toString(),
            defaultRange: 0,
            defaultRangePoint: [],
          },
          rewardInfos: [],
          observationId: pool.observationId.toBase58(),
          exBitmapAccount: pool.exBitmapAccount.toBase58(),
        };
        poolKeys.push(clmmKeys);
      } else if (pool.version === 4) {
        const rpcInfo = ammRpcData[pool.id.toString()];
        const ammKeys: AmmV4Keys = {
          programId: pool.programId,
          id: pool.id,
          mintA: pool.mintA,
          mintB: pool.mintB,
          openTime: String(pool.openTime),
          vault: {
            A: rpcInfo.baseVault.toBase58(),
            B: rpcInfo.quoteVault.toBase58(),
          },
          authority: getLiquidityAssociatedAuthority({ programId: new PublicKey(pool.programId) }).publicKey.toString(),
          openOrders: rpcInfo.openOrders.toBase58(),
          targetOrders: rpcInfo.targetOrders.toBase58(),
          mintLp: pool.lpMint,
          ...marketData[pool.marketId],
        };
        poolKeys.push(ammKeys);
      } else if (pool.version === 7) {
        poolKeys.push({
          observationId: pool.observationId.toBase58(),
          programId: pool.programId.toBase58(),
          id: pool.id.toBase58(),
          mintA: pool.mintA,
          mintB: pool.mintB,
          openTime: String(pool.openTime),
          authority: getPdaPoolAuthority(pool.programId).publicKey.toBase58(),
          vault: {
            A: pool.vaultA.toBase58(),
            B: pool.vaultB.toBase58(),
          },
          mintLp: toApiV3Token({
            address: pool.mintLp.toBase58(),
            programId: TOKEN_PROGRAM_ID.toBase58(),
            decimals: pool.lpDecimals,
          }),
          config: {
            id: pool.configId.toBase58(),
            ...pool.configInfo,
            protocolFeeRate: pool.configInfo.protocolFeeRate.toNumber(),
            tradeFeeRate: pool.configInfo.tradeFeeRate.toNumber(),
            fundFeeRate: pool.configInfo.fundFeeRate.toNumber(),
            createPoolFee: pool.configInfo.createPoolFee.toString(),
          },
        });
      }
    });
    return poolKeys;
  }
}
