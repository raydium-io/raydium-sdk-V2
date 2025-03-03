import { EpochInfo, PublicKey } from "@solana/web3.js";
import { createTransferInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import Decimal from "decimal.js";
import { AmmV4Keys, ApiV3Token, ClmmKeys, PoolKeys } from "@/api";
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
import { ClmmRpcData, ComputeClmmPoolInfo, PoolUtils, ReturnTypeFetchMultiplePoolTickArrays } from "../../raydium/clmm";
import { PoolInfoLayout } from "../../raydium/clmm/layout";
import { CpmmPoolInfoLayout, getPdaPoolAuthority } from "../../raydium/cpmm";
import {
  ComputeAmountOutParam,
  getLiquidityAssociatedAuthority,
  liquidityStateV4Layout,
  toAmmComputePoolInfo,
} from "../../raydium/liquidity";
import { ComputeBudgetConfig, ReturnTypeFetchMultipleMintInfos } from "../../raydium/type";
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
    clmmPoolsRpcInfo: Record<string, ClmmRpcData>;
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
    clmmRpcData?: Record<string, ClmmRpcData>;
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
