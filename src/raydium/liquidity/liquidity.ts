import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  AmmV4Keys,
  AmmV5Keys,
  ApiV3PoolInfoConcentratedItem,
  ApiV3PoolInfoStandardItem,
  FormatFarmInfoOutV6,
} from "../../api/type";
import { AccountLayout, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getMultipleAccountsInfoWithCustomFlags } from "@/common/accountInfo";
import { BN_ZERO, divCeil } from "@/common/bignumber";
import { getATAAddress } from "@/common/pda";
import { BNDivCeil } from "@/common/transfer";
import { MakeMultiTxData, MakeTxData } from "@/common/txTool/txTool";
import { InstructionType, TxVersion } from "@/common/txTool/txType";
import { Percent, Token, TokenAmount } from "../../module";
import {
  FARM_PROGRAM_TO_VERSION,
  FarmLedger,
  createAssociatedLedgerAccountInstruction,
  getAssociatedLedgerAccount,
  getFarmLedgerLayout,
  makeWithdrawInstructionV3,
  makeWithdrawInstructionV5,
  makeWithdrawInstructionV6,
} from "../../raydium/farm";
import { ClmmInstrument } from "../clmm/instrument";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { toToken } from "../token";
import { ComputeBudgetConfig } from "../type";
import { LIQUIDITY_FEES_DENOMINATOR, LIQUIDITY_FEES_NUMERATOR } from "./constant";
import {
  createPoolV4InstructionV2,
  makeAMMSwapInstruction,
  makeAddLiquidityInstruction,
  removeLiquidityInstruction,
} from "./instruction";
import { createPoolFeeLayout, liquidityStateV4Layout } from "./layout";
import { StableLayout, getDxByDyBaseIn, getDyByDxBaseIn, getStablePrice } from "./stable";
import {
  AddLiquidityParams,
  AmmRpcData,
  AmountSide,
  ComputeAmountInParam,
  ComputeAmountOutParam,
  CreatePoolAddress,
  CreatePoolParam,
  CreateMarketAndPoolParam,
  RemoveParams,
  SwapParam,
} from "./type";
import { getAssociatedConfigId, getAssociatedPoolKeys, toAmmComputePoolInfo } from "./utils";

import BN from "bn.js";
import Decimal from "decimal.js";
import { AMM_V4, FEE_DESTINATION_ID, OPEN_BOOK_PROGRAM, WSOLMint } from "@/common";
import { generatePubKey } from "../account";
import { makeCreateMarketInstruction, MarketExtInfo } from "../marketV2";

export default class LiquidityModule extends ModuleBase {
  public stableLayout: StableLayout;

  constructor(params: ModuleBaseProps) {
    super(params);
    this.stableLayout = new StableLayout({ connection: this.scope.connection });
  }

  public async initLayout(): Promise<void> {
    await this.stableLayout.initStableModelLayout();
  }

  public async load(): Promise<void> {
    this.checkDisabled();
  }

  public computePairAmount({
    poolInfo,
    amount,
    // anotherToken,
    slippage,
    baseIn,
  }: {
    poolInfo: ApiV3PoolInfoStandardItem;
    amount: string | Decimal;
    slippage: Percent;
    baseIn?: boolean;
  }): { anotherAmount: TokenAmount; maxAnotherAmount: TokenAmount; minAnotherAmount: TokenAmount; liquidity: BN } {
    const inputAmount = new BN(new Decimal(amount).mul(10 ** poolInfo[baseIn ? "mintA" : "mintB"].decimals).toFixed(0));
    const _anotherToken = toToken(poolInfo[baseIn ? "mintB" : "mintA"]);

    const [baseReserve, quoteReserve] = [
      new BN(new Decimal(poolInfo.mintAmountA).mul(10 ** poolInfo.mintA.decimals).toString()),
      new BN(new Decimal(poolInfo.mintAmountB).mul(10 ** poolInfo.mintB.decimals).toString()),
    ];
    const lpAmount = new BN(
      new Decimal(poolInfo.lpAmount).mul(10 ** poolInfo.lpMint.decimals).toFixed(0, Decimal.ROUND_DOWN),
    );
    this.logDebug("baseReserve:", baseReserve.toString(), "quoteReserve:", quoteReserve.toString());

    this.logDebug(
      "tokenIn:",
      baseIn ? poolInfo.mintA.symbol : poolInfo.mintB.symbol,
      "amountIn:",
      inputAmount.toString(),
      "anotherToken:",
      baseIn ? poolInfo.mintB.symbol : poolInfo.mintA.symbol,
      "slippage:",
      `${slippage.toSignificant()}%`,
      "baseReserve",
      baseReserve.toString(),
      "quoteReserve",
      quoteReserve.toString(),
    );

    // input is fixed
    const input = baseIn ? "base" : "quote";
    this.logDebug("input side:", input);

    // round up
    let amountRaw = BN_ZERO;
    if (!inputAmount.isZero()) {
      amountRaw =
        input === "base"
          ? divCeil(inputAmount.mul(quoteReserve), baseReserve)
          : divCeil(inputAmount.mul(baseReserve), quoteReserve);
    }

    this.logDebug("amountRaw:", amountRaw.toString(), "lpAmount:", lpAmount.toString());

    const liquidity = divCeil(inputAmount.mul(lpAmount), input === "base" ? baseReserve : quoteReserve);

    this.logDebug("liquidity:", liquidity.toString());

    const _slippage = new Percent(new BN(1)).add(slippage);
    const _slippageMin = new Percent(new BN(1)).sub(slippage);
    const slippageAdjustedAmount = _slippage.mul(amountRaw).quotient;
    const slippageAdjustedMinAmount = _slippageMin.mul(amountRaw).quotient;

    const _anotherAmount = new TokenAmount(_anotherToken, amountRaw);
    const _maxAnotherAmount = new TokenAmount(_anotherToken, slippageAdjustedAmount);
    const _minAnotherAmount = new TokenAmount(_anotherToken, slippageAdjustedMinAmount);
    this.logDebug("anotherAmount:", _anotherAmount.toFixed(), "maxAnotherAmount:", _maxAnotherAmount.toFixed());

    return {
      anotherAmount: _anotherAmount,
      maxAnotherAmount: _maxAnotherAmount,
      minAnotherAmount: _minAnotherAmount,
      liquidity,
    };
  }

  public async getAmmPoolKeys(poolId: string): Promise<AmmV4Keys | AmmV5Keys> {
    return ((await this.scope.api.fetchPoolKeysById({ idList: [poolId] })) as (AmmV4Keys | AmmV5Keys)[])[0];
  }

  public async addLiquidity<T extends TxVersion>(params: AddLiquidityParams<T>): Promise<MakeTxData<T>> {
    const {
      poolInfo,
      poolKeys: propPoolKeys,
      amountInA,
      amountInB,
      otherAmountMin,
      fixedSide,
      config,
      txVersion,
      computeBudgetConfig,
      txTipConfig,
      feePayer,
    } = params;

    if (this.scope.availability.addStandardPosition === false)
      this.logAndCreateError("add liquidity feature disabled in your region");

    this.logDebug("amountInA:", amountInA, "amountInB:", amountInB);
    if (amountInA.isZero() || amountInB.isZero())
      this.logAndCreateError("amounts must greater than zero", "amountInA & amountInB", {
        amountInA: amountInA.toFixed(),
        amountInB: amountInB.toFixed(),
      });
    const { account } = this.scope;
    const { bypassAssociatedCheck, checkCreateATAOwner } = {
      // default
      ...{ bypassAssociatedCheck: false, checkCreateATAOwner: false },
      // custom
      ...config,
    };
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
      mint: new PublicKey(poolInfo.lpMint.address),
    });

    const tokens = [tokenA, tokenB];
    const _tokenAccounts = [tokenAccountA, tokenAccountB];
    const rawAmounts = [amountInA.raw, amountInB.raw];

    // handle amount a & b and direction
    const sideA = amountInA.token.mint.toBase58() === poolInfo.mintA.address ? "base" : "quote";
    let _fixedSide: AmountSide = "base";
    if (!["quote", "base"].includes(sideA)) this.logAndCreateError("invalid fixedSide", "fixedSide", fixedSide);
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

    const poolKeys = propPoolKeys ?? (await this.getAmmPoolKeys(poolInfo.id));

    const txBuilder = this.createTxBuilder(feePayer);

    const { tokenAccount: _baseTokenAccount, ...baseInstruction } = await account.handleTokenAccount({
      side: "in",
      amount: baseAmountRaw,
      mint: baseToken.mint,
      tokenAccount: baseTokenAccount,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(baseInstruction);
    const { tokenAccount: _quoteTokenAccount, ...quoteInstruction } = await account.handleTokenAccount({
      side: "in",
      amount: quoteAmountRaw,
      mint: quoteToken.mint,
      tokenAccount: quoteTokenAccount,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(quoteInstruction);
    const { tokenAccount: _lpTokenAccount, ...lpInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: new PublicKey(poolInfo.lpMint.address),
      tokenAccount: lpTokenAccount,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(lpInstruction);
    txBuilder.addInstruction({
      instructions: [
        makeAddLiquidityInstruction({
          poolInfo,
          poolKeys: poolKeys as AmmV4Keys | AmmV5Keys,
          userKeys: {
            baseTokenAccount: _baseTokenAccount!,
            quoteTokenAccount: _quoteTokenAccount!,
            lpTokenAccount: _lpTokenAccount!,
            owner: this.scope.ownerPubKey,
          },
          baseAmountIn: baseAmountRaw,
          quoteAmountIn: quoteAmountRaw,
          otherAmountMin: otherAmountMin.raw,
          fixedSide: _fixedSide,
        }),
      ],
      instructionTypes: [
        poolInfo.pooltype.includes("StablePool")
          ? InstructionType.AmmV5AddLiquidity
          : InstructionType.AmmV4AddLiquidity,
      ],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    });
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
    if (txVersion === TxVersion.V0) return (await txBuilder.buildV0()) as MakeTxData<T>;
    return txBuilder.build() as MakeTxData<T>;
  }

  public async removeLiquidity<T extends TxVersion>(params: RemoveParams<T>): Promise<Promise<MakeTxData<T>>> {
    if (this.scope.availability.removeStandardPosition === false)
      this.logAndCreateError("remove liquidity feature disabled in your region");
    const {
      poolInfo,
      poolKeys: propPoolKeys,
      lpAmount,
      baseAmountMin,
      quoteAmountMin,
      config,
      txVersion,
      computeBudgetConfig,
      txTipConfig,
      feePayer,
    } = params;
    const poolKeys = propPoolKeys ?? (await this.getAmmPoolKeys(poolInfo.id));
    const [baseMint, quoteMint, lpMint] = [
      new PublicKey(poolInfo.mintA.address),
      new PublicKey(poolInfo.mintB.address),
      new PublicKey(poolInfo.lpMint.address),
    ];
    this.logDebug("lpAmount:", lpAmount);
    this.logDebug("baseAmountMin:", baseAmountMin);
    this.logDebug("quoteAmountMin:", quoteAmountMin);
    if (lpAmount.isZero()) this.logAndCreateError("amount must greater than zero", "lpAmount", lpAmount.toString());

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

    const txBuilder = this.createTxBuilder(feePayer);
    const { bypassAssociatedCheck, checkCreateATAOwner } = {
      // default
      ...{ bypassAssociatedCheck: false, checkCreateATAOwner: false },
      // custom
      ...config,
    };

    const { tokenAccount: _baseTokenAccount, ...baseInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: baseMint,
      tokenAccount: baseTokenAccount,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(baseInstruction);
    const { tokenAccount: _quoteTokenAccount, ...quoteInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: quoteMint,
      tokenAccount: quoteTokenAccount,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(quoteInstruction);

    txBuilder.addInstruction({
      instructions: [
        removeLiquidityInstruction({
          poolInfo,
          poolKeys,
          userKeys: {
            lpTokenAccount: lpTokenAccount!,
            baseTokenAccount: _baseTokenAccount!,
            quoteTokenAccount: _quoteTokenAccount!,
            owner: this.scope.ownerPubKey,
          },
          lpAmount,
          baseAmountMin,
          quoteAmountMin,
        }),
      ],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
      instructionTypes: [
        poolInfo.pooltype.includes("StablePool")
          ? InstructionType.AmmV5RemoveLiquidity
          : InstructionType.AmmV4RemoveLiquidity,
      ],
    });
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
    if (txVersion === TxVersion.V0) return (await txBuilder.buildV0()) as MakeTxData<T>;
    return txBuilder.build() as MakeTxData<T>;
  }

  public async removeAllLpAndCreateClmmPosition<T extends TxVersion>({
    poolInfo,
    clmmPoolInfo,
    removeLpAmount,
    createPositionInfo,
    farmInfo,
    userFarmLpAmount,
    base,
    computeBudgetConfig,
    payer,
    userAuxiliaryLedgers,
    tokenProgram = TOKEN_PROGRAM_ID,
    checkCreateATAOwner = true,
    getEphemeralSigners,
    txVersion,
    feePayer,
  }: {
    poolInfo: ApiV3PoolInfoStandardItem;
    clmmPoolInfo: ApiV3PoolInfoConcentratedItem;
    removeLpAmount: BN;
    createPositionInfo: {
      tickLower: number;
      tickUpper: number;
      baseAmount: BN;
      otherAmountMax: BN;
    };
    farmInfo?: FormatFarmInfoOutV6;
    userFarmLpAmount?: BN;
    userAuxiliaryLedgers?: PublicKey[];
    base: "MintA" | "MintB";
    payer?: PublicKey;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
    checkCreateATAOwner?: boolean;
    txVersion?: T;
    getEphemeralSigners?: (k: number) => any;
    feePayer?: PublicKey;
  }): Promise<MakeMultiTxData<T>> {
    if (
      this.scope.availability.removeStandardPosition === false ||
      this.scope.availability.createConcentratedPosition === false
    )
      this.logAndCreateError("remove liquidity or create position feature disabled in your region");

    if (
      !(poolInfo.mintA.address === clmmPoolInfo.mintA.address || poolInfo.mintA.address === clmmPoolInfo.mintB.address)
    )
      throw Error("mint check error");
    if (
      !(poolInfo.mintB.address === clmmPoolInfo.mintA.address || poolInfo.mintB.address === clmmPoolInfo.mintB.address)
    )
      throw Error("mint check error");

    const txBuilder = this.createTxBuilder(feePayer);
    const mintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccountRawInfos) {
      if (
        mintToAccount[item.accountInfo.mint.toString()] === undefined ||
        getATAAddress(this.scope.ownerPubKey, item.accountInfo.mint, TOKEN_PROGRAM_ID).publicKey.equals(item.pubkey)
      ) {
        mintToAccount[item.accountInfo.mint.toString()] = item.pubkey;
      }
    }

    const lpTokenAccount = mintToAccount[poolInfo.lpMint.address];
    if (lpTokenAccount === undefined) throw Error("find lp account error in trade accounts");

    const amountIn = removeLpAmount.add(userFarmLpAmount ?? new BN(0));
    const mintBaseUseSOLBalance = poolInfo.mintA.address === Token.WSOL.mint.toString();
    const mintQuoteUseSOLBalance = poolInfo.mintB.address === Token.WSOL.mint.toString();

    const { account: baseTokenAccount, instructionParams: ownerTokenAccountBaseInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintBaseUseSOLBalance
          ? {
            payer: this.scope.ownerPubKey,
          }
          : undefined,
        skipCloseAccount: !mintBaseUseSOLBalance,
        notUseTokenAccount: mintBaseUseSOLBalance,
        associatedOnly: true,
        checkCreateATAOwner,
      });
    txBuilder.addInstruction(ownerTokenAccountBaseInstruction || {});
    if (baseTokenAccount === undefined) throw new Error("base token account not found");

    const { account: quoteTokenAccount, instructionParams: ownerTokenAccountQuoteInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,
        createInfo: mintQuoteUseSOLBalance
          ? {
            payer: this.scope.ownerPubKey!,
            amount: 0,
          }
          : undefined,
        skipCloseAccount: !mintQuoteUseSOLBalance,
        notUseTokenAccount: mintQuoteUseSOLBalance,
        associatedOnly: true,
        checkCreateATAOwner,
      });
    txBuilder.addInstruction(ownerTokenAccountQuoteInstruction || {});
    if (quoteTokenAccount === undefined) throw new Error("quote token account not found");

    mintToAccount[poolInfo.mintA.address] = baseTokenAccount;
    mintToAccount[poolInfo.mintB.address] = quoteTokenAccount;

    if (farmInfo !== undefined && !userFarmLpAmount?.isZero()) {
      const farmVersion = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
      const ledger = getAssociatedLedgerAccount({
        programId: new PublicKey(farmInfo.programId),
        poolId: new PublicKey(farmInfo.id),
        owner: this.scope.ownerPubKey,
        version: farmVersion as 3 | 5 | 6,
      });
      let ledgerInfo: FarmLedger | undefined = undefined;
      const ledgerData = await this.scope.connection.getAccountInfo(ledger);
      if (ledgerData) {
        const ledgerLayout = getFarmLedgerLayout(farmVersion)!;
        ledgerInfo = ledgerLayout.decode(ledgerData.data);
      }
      if (farmVersion !== 6 && !ledgerInfo) {
        const { instruction, instructionType } = createAssociatedLedgerAccountInstruction({
          id: new PublicKey(farmInfo.id),
          programId: new PublicKey(farmInfo.programId),
          version: farmVersion,
          ledger,
          owner: this.scope.ownerPubKey,
        });
        txBuilder.addInstruction({ instructions: [instruction], instructionTypes: [instructionType] });
      }

      const rewardTokenAccounts: PublicKey[] = [];
      for (const item of farmInfo.rewardInfos) {
        const rewardIsWsol = item.mint.address === Token.WSOL.mint.toString();
        if (mintToAccount[item.mint.address]) rewardTokenAccounts.push(mintToAccount[item.mint.address]);
        else {
          const { account: farmRewardAccount, instructionParams: ownerTokenAccountFarmInstruction } =
            await this.scope.account.getOrCreateTokenAccount({
              mint: new PublicKey(item.mint.address),
              tokenProgram,
              owner: this.scope.ownerPubKey,
              skipCloseAccount: !rewardIsWsol,
              createInfo: {
                payer: payer || this.scope.ownerPubKey,
              },
              associatedOnly: true,
              checkCreateATAOwner,
            });
          if (!farmRewardAccount) this.logAndCreateError("farm reward account not found:", item.mint.address);
          ownerTokenAccountFarmInstruction && txBuilder.addInstruction(ownerTokenAccountFarmInstruction);
          rewardTokenAccounts.push(farmRewardAccount!);
        }
      }
      const farmKeys = (await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0];
      const insParams = {
        userAuxiliaryLedgers,
        amount: userFarmLpAmount!,
        owner: this.scope.ownerPubKey,
        farmInfo,
        farmKeys,
        lpAccount: lpTokenAccount,
        rewardAccounts: rewardTokenAccounts,
      };
      const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
      const newInstruction =
        version === 6
          ? makeWithdrawInstructionV6(insParams)
          : version === 5
            ? makeWithdrawInstructionV5(insParams)
            : makeWithdrawInstructionV3(insParams);
      const insType = {
        3: InstructionType.FarmV3Withdraw,
        5: InstructionType.FarmV5Withdraw,
        6: InstructionType.FarmV6Withdraw,
      };
      txBuilder.addInstruction({
        instructions: [newInstruction],
        instructionTypes: [insType[version]],
      });
    }

    const poolKeys = await this.getAmmPoolKeys(poolInfo.id);

    const removeIns = removeLiquidityInstruction({
      poolInfo,
      poolKeys,
      userKeys: {
        lpTokenAccount,
        baseTokenAccount,
        quoteTokenAccount,
        owner: this.scope.ownerPubKey,
      },
      lpAmount: amountIn,
      baseAmountMin: 0,
      quoteAmountMin: 0,
    });

    txBuilder.addInstruction({
      instructions: [removeIns],
      instructionTypes: [
        !poolInfo.pooltype.includes("StablePool")
          ? InstructionType.AmmV4RemoveLiquidity
          : InstructionType.AmmV5RemoveLiquidity,
      ],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    });

    const [tokenAccountA, tokenAccountB] =
      poolInfo.mintA.address === clmmPoolInfo.mintA.address
        ? [baseTokenAccount, quoteTokenAccount]
        : [quoteTokenAccount, baseTokenAccount];

    const clmmPoolKeys = await this.scope.clmm.getClmmPoolKeys(clmmPoolInfo.id);

    const createPositionIns = await ClmmInstrument.openPositionFromBaseInstructions({
      poolInfo: clmmPoolInfo,
      poolKeys: clmmPoolKeys,
      ownerInfo: {
        feePayer: this.scope.ownerPubKey,
        wallet: this.scope.ownerPubKey,
        tokenAccountA,
        tokenAccountB,
      },
      withMetadata: "create",
      ...createPositionInfo,
      base,
      getEphemeralSigners,
    });

    txBuilder.addInstruction({
      instructions: [...createPositionIns.instructions],
      signers: createPositionIns.signers,
      instructionTypes: [...createPositionIns.instructionTypes],
      lookupTableAddress: clmmPoolKeys.lookupTableAccount ? [clmmPoolKeys.lookupTableAccount] : [],
    });

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
  }

  public async createPoolV4<T extends TxVersion>({
    programId,
    marketInfo,
    baseMintInfo,
    quoteMintInfo,
    baseAmount,
    quoteAmount,
    startTime,
    ownerInfo,
    associatedOnly = false,
    checkCreateATAOwner = false,
    tokenProgram,
    txVersion,
    feeDestinationId,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: CreatePoolParam<T>): Promise<MakeTxData<T, { address: CreatePoolAddress }>> {
    const payer = ownerInfo.feePayer || this.scope.owner?.publicKey;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && baseMintInfo.mint.equals(NATIVE_MINT);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && quoteMintInfo.mint.equals(NATIVE_MINT);

    const txBuilder = this.createTxBuilder(feePayer);

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
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
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
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
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
      ammConfigId: poolInfo.configId,
      feeDestinationId,
    };

    const { instruction, instructionType } = createPoolV4InstructionV2({
      ...createPoolKeys,
      userWallet: this.scope.ownerPubKey,
      userCoinVault: ownerTokenAccountBase,
      userPcVault: ownerTokenAccountQuote,
      userLpVault: getATAAddress(this.scope.ownerPubKey, poolInfo.lpMint, tokenProgram).publicKey,

      nonce: poolInfo.nonce,
      openTime: startTime,
      coinAmount: baseAmount,
      pcAmount: quoteAmount,
    });

    txBuilder.addInstruction({
      instructions: [instruction],
      instructionTypes: [instructionType],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
    return txBuilder.versionBuild({
      txVersion,
      extInfo: {
        address: createPoolKeys,
      },
    }) as Promise<MakeTxData<T, { address: CreatePoolAddress }>>;
  }

  public async createMarketAndPoolV4<T extends TxVersion>({
    programId = AMM_V4,
    marketProgram = OPEN_BOOK_PROGRAM,
    feeDestinationId = FEE_DESTINATION_ID,
    tokenProgram,

    baseMintInfo,
    quoteMintInfo,
    baseAmount,
    quoteAmount,
    startTime,

    ownerInfo,
    lowestFeeMarket,
    assignSeed,

    associatedOnly = false,
    checkCreateATAOwner = false,

    lotSize = 1,
    tickSize = 0.01,

    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: CreateMarketAndPoolParam<T>): Promise<
    MakeMultiTxData<T, { address: CreatePoolAddress & MarketExtInfo["address"] }>
  > {
    const wallet = this.scope.ownerPubKey;
    const payer = ownerInfo.feePayer || this.scope.owner?.publicKey;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && baseMintInfo.mint.equals(NATIVE_MINT);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && quoteMintInfo.mint.equals(NATIVE_MINT);

    const seed = assignSeed
      ? `${baseMintInfo.mint.toBase58().slice(0, 7)}-${quoteMintInfo.mint.toBase58().slice(0, 7)}-${assignSeed}`
      : undefined;

    const market = generatePubKey({
      fromPublicKey: wallet,
      programId: marketProgram,
      assignSeed: seed ? `${seed}-market` : seed,
    });
    const requestQueue = generatePubKey({
      fromPublicKey: wallet,
      programId: marketProgram,
      assignSeed: seed ? `${seed}-request` : seed,
    });
    const eventQueue = generatePubKey({
      fromPublicKey: wallet,
      programId: marketProgram,
      assignSeed: seed ? `${seed}-event` : seed,
    });
    const bids = generatePubKey({
      fromPublicKey: wallet,
      programId: marketProgram,
      assignSeed: seed ? `${seed}-bids` : seed,
    });
    const asks = generatePubKey({
      fromPublicKey: wallet,
      programId: marketProgram,
      assignSeed: seed ? `${seed}-asks` : seed,
    });
    const baseVault = generatePubKey({
      fromPublicKey: wallet,
      programId: TOKEN_PROGRAM_ID,
      assignSeed: seed ? `${seed}-baseVault` : seed,
    });
    const quoteVault = generatePubKey({
      fromPublicKey: wallet,
      programId: TOKEN_PROGRAM_ID,
      assignSeed: seed ? `${seed}-quoteVault` : seed,
    });

    const feeRateBps = 0;
    const quoteDustThreshold = new BN(100);
    function getVaultOwnerAndNonce() {
      const vaultSignerNonce = new BN(0);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const vaultOwner = PublicKey.createProgramAddressSync(
            [market.publicKey.toBuffer(), vaultSignerNonce.toArrayLike(Buffer, "le", 8)],
            marketProgram,
          );
          return { vaultOwner, vaultSignerNonce };
        } catch (e) {
          vaultSignerNonce.iaddn(1);
          if (vaultSignerNonce.gt(new BN(25555))) throw Error("find vault owner error");
        }
      }
    }
    const { vaultOwner, vaultSignerNonce } = getVaultOwnerAndNonce();
    const baseLotSize = new BN(Math.round(10 ** baseMintInfo.decimals * lotSize));
    const quoteLotSize = new BN(Math.round(lotSize * 10 ** quoteMintInfo.decimals * tickSize));

    if (baseLotSize.eq(BN_ZERO)) throw Error("lot size is too small");
    if (quoteLotSize.eq(BN_ZERO)) throw Error("tick size or lot size is too small");
    const allTxArr = await makeCreateMarketInstruction({
      connection: this.scope.connection,
      wallet: this.scope.ownerPubKey,
      marketInfo: {
        programId: marketProgram,
        vaultOwner,
        baseMint: baseMintInfo.mint,
        quoteMint: quoteMintInfo.mint,

        id: market,
        baseVault,
        quoteVault,
        requestQueue,
        eventQueue,
        bids,
        asks,

        feeRateBps,
        quoteDustThreshold,
        vaultSignerNonce,
        baseLotSize,
        quoteLotSize,
        lowestFeeMarket,
      },
    });

    const txBuilder = this.createTxBuilder(feePayer);
    txBuilder.addInstruction({
      instructions: allTxArr[0].transaction.instructions,
      signers: allTxArr[0].signer,
    });

    for await (const txData of allTxArr.slice(1, allTxArr.length)) {
      txBuilder.addInstruction({
        instructions: txData.transaction.instructions,
        signers: txData.signer,
        instructionTypes: txData.instructionTypes,
      });
    }

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
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
        assignSeed: mintAUseSOLBalance && seed ? `${seed}-wsol` : undefined,
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
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
        assignSeed: mintBUseSOLBalance && seed ? `${seed}-wsol` : undefined,
      });
    txBuilder.addInstruction(ownerTokenAccountQuoteInstruction || {});

    if (ownerTokenAccountBase === undefined) throw Error("you don't has base token account");
    if (ownerTokenAccountQuote === undefined) throw Error("you don't has quote token account");

    // create pool ins
    const poolInfo = getAssociatedPoolKeys({
      version: 4,
      marketVersion: 3,
      marketId: market.publicKey,
      baseMint: baseMintInfo.mint,
      quoteMint: quoteMintInfo.mint,
      baseDecimals: baseMintInfo.decimals,
      quoteDecimals: quoteMintInfo.decimals,
      programId,
      marketProgramId: marketProgram,
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
      ammConfigId: poolInfo.configId,
      feeDestinationId,
    };

    const { instruction, instructionType } = createPoolV4InstructionV2({
      ...createPoolKeys,
      userWallet: this.scope.ownerPubKey,
      userCoinVault: ownerTokenAccountBase,
      userPcVault: ownerTokenAccountQuote,
      userLpVault: getATAAddress(this.scope.ownerPubKey, poolInfo.lpMint, tokenProgram).publicKey,

      nonce: poolInfo.nonce,
      openTime: startTime,
      coinAmount: baseAmount,
      pcAmount: quoteAmount,
    });

    txBuilder.addInstruction({
      instructions: [instruction],
      instructionTypes: [instructionType],
    });

    const splitIns =
      mintAUseSOLBalance || mintBUseSOLBalance
        ? ([
          ownerTokenAccountBaseInstruction?.instructions?.[0] || ownerTokenAccountQuoteInstruction?.instructions?.[0],
        ].filter((i) => !!i) as TransactionInstruction[])
        : undefined;

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({
        computeBudgetConfig,
        splitIns,
        address: {
          requestQueue: requestQueue.publicKey,
          eventQueue: eventQueue.publicKey,
          bids: bids.publicKey,
          asks: asks.publicKey,
          baseVault: baseVault.publicKey,
          quoteVault: quoteVault.publicKey,
          baseMint: new PublicKey(baseMintInfo.mint),
          quoteMint: new PublicKey(quoteMintInfo.mint),
          ...createPoolKeys,
        },
      }) as Promise<MakeMultiTxData<T, { address: CreatePoolAddress & MarketExtInfo["address"] }>>;

    return txBuilder.sizeCheckBuild({
      computeBudgetConfig,
      splitIns,
      address: {
        requestQueue: requestQueue.publicKey,
        eventQueue: eventQueue.publicKey,
        bids: bids.publicKey,
        asks: asks.publicKey,
        baseVault: baseVault.publicKey,
        quoteVault: quoteVault.publicKey,
        baseMint: new PublicKey(baseMintInfo.mint),
        quoteMint: new PublicKey(quoteMintInfo.mint),
        ...createPoolKeys,
      },
    }) as Promise<MakeMultiTxData<T, { address: CreatePoolAddress & MarketExtInfo["address"] }>>;
  }

  public async getCreatePoolFee({ programId }: { programId: PublicKey }): Promise<BN> {
    const configId = getAssociatedConfigId({ programId });

    const account = await this.scope.connection.getAccountInfo(configId, { dataSlice: { offset: 536, length: 8 } });
    if (account === null) throw Error("get config account error");

    return createPoolFeeLayout.decode(account.data).fee;
  }

  public computeAmountOut({
    poolInfo,
    amountIn,
    mintIn: propMintIn,
    mintOut: propMintOut,
    slippage,
  }: ComputeAmountOutParam): {
    amountOut: BN;
    minAmountOut: BN;
    currentPrice: Decimal;
    executionPrice: Decimal;
    priceImpact: Decimal;
    fee: BN;
  } {
    const [mintIn, mintOut] = [propMintIn.toString(), propMintOut.toString()];
    if (mintIn !== poolInfo.mintA.address && mintIn !== poolInfo.mintB.address) throw new Error("toke not match");
    if (mintOut !== poolInfo.mintA.address && mintOut !== poolInfo.mintB.address) throw new Error("toke not match");

    const { baseReserve, quoteReserve } = poolInfo;

    const reserves = [baseReserve, quoteReserve];
    const mintDecimals = [poolInfo.mintA.decimals, poolInfo.mintB.decimals];

    // input is fixed
    const input = mintIn == poolInfo.mintA.address ? "base" : "quote";
    if (input === "quote") {
      reserves.reverse();
      mintDecimals.reverse();
    }

    const [reserveIn, reserveOut] = reserves;
    const [mintInDecimals, mintOutDecimals] = mintDecimals;
    const isVersion4 = poolInfo.version === 4;
    let currentPrice: Decimal;
    if (isVersion4) {
      currentPrice = new Decimal(reserveOut.toString())
        .div(10 ** mintOutDecimals)
        .div(new Decimal(reserveIn.toString()).div(10 ** mintInDecimals));
    } else {
      const p = getStablePrice(
        this.stableLayout.stableModelData,
        baseReserve.toNumber(),
        quoteReserve.toNumber(),
        false,
      );
      if (input === "quote") currentPrice = new Decimal(1e6).div(p * 1e6);
      else currentPrice = new Decimal(p * 1e6).div(1e6);
    }

    const amountInRaw = amountIn;
    let amountOutRaw = new BN(0);
    let feeRaw = new BN(0);

    if (!amountInRaw.isZero()) {
      if (isVersion4) {
        feeRaw = BNDivCeil(amountInRaw.mul(LIQUIDITY_FEES_NUMERATOR), LIQUIDITY_FEES_DENOMINATOR);
        const amountInWithFee = amountInRaw.sub(feeRaw);

        const denominator = reserveIn.add(amountInWithFee);
        amountOutRaw = reserveOut.mul(amountInWithFee).div(denominator);
      } else {
        feeRaw = amountInRaw.mul(new BN(2)).div(new BN(10000));
        const amountInWithFee = amountInRaw.sub(feeRaw);
        if (input === "quote")
          amountOutRaw = new BN(
            getDyByDxBaseIn(
              this.stableLayout.stableModelData,
              quoteReserve.toNumber(),
              baseReserve.toNumber(),
              amountInWithFee.toNumber(),
            ),
          );
        else {
          amountOutRaw = new BN(
            getDxByDyBaseIn(
              this.stableLayout.stableModelData,
              quoteReserve.toNumber(),
              baseReserve.toNumber(),
              amountInWithFee.toNumber(),
            ),
          );
        }
      }
    }

    const minAmountOutRaw = new BN(new Decimal(amountOutRaw.toString()).mul(1 - slippage).toFixed(0));

    const amountOut = amountOutRaw;
    const minAmountOut = minAmountOutRaw;

    let executionPrice = new Decimal(amountOutRaw.toString()).div(
      new Decimal(amountInRaw.sub(feeRaw).toString()).toFixed(0),
    );
    if (!amountInRaw.isZero() && !amountOutRaw.isZero()) {
      executionPrice = new Decimal(amountOutRaw.toString())
        .div(10 ** mintOutDecimals)
        .div(new Decimal(amountInRaw.sub(feeRaw).toString()).div(10 ** mintInDecimals));
    }

    const priceImpact = currentPrice.sub(executionPrice).div(currentPrice).mul(100);

    const fee = feeRaw;

    return {
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    };
  }

  public computeAmountIn({ poolInfo, amountOut, mintIn, mintOut, slippage }: ComputeAmountInParam): {
    amountIn: BN;
    maxAmountIn: BN;
    currentPrice: Decimal;
    executionPrice: Decimal | null;
    priceImpact: Decimal;
  } {
    const { baseReserve, quoteReserve } = poolInfo;
    if (mintIn.toString() !== poolInfo.mintA.address && mintIn.toString() !== poolInfo.mintB.address)
      this.logAndCreateError("mintIn does not match pool");
    if (mintOut.toString() !== poolInfo.mintA.address && mintOut.toString() !== poolInfo.mintB.address)
      this.logAndCreateError("mintOut does not match pool");
    this.logDebug("baseReserve:", baseReserve.toString());
    this.logDebug("quoteReserve:", quoteReserve.toString());

    const baseIn = mintIn.toString() === poolInfo.mintA.address;
    const [tokenIn, tokenOut] = baseIn ? [poolInfo.mintA, poolInfo.mintB] : [poolInfo.mintB, poolInfo.mintA];

    this.logDebug("currencyOut:", tokenOut.symbol || tokenOut.address);
    this.logDebug(
      "amountOut:",
      new Decimal(amountOut.toString())
        .div(10 ** tokenOut.decimals)
        .toDecimalPlaces(tokenOut.decimals)
        .toString(),
      tokenIn.symbol || tokenIn.address,
    );
    this.logDebug("slippage:", `${slippage * 100}%`);

    const reserves = [baseReserve, quoteReserve];

    // output is fixed
    const output = !baseIn ? "base" : "quote";
    if (output === "base") {
      reserves.reverse();
    }
    this.logDebug("output side:", output);

    const [reserveIn, reserveOut] = reserves;

    const currentPrice = new Decimal(reserveOut.toString())
      .div(10 ** poolInfo[baseIn ? "mintB" : "mintA"].decimals)
      .div(new Decimal(reserveIn.toString()).div(10 ** poolInfo[baseIn ? "mintA" : "mintB"].decimals));
    this.logDebug(
      "currentPrice:",
      `1 ${tokenIn.symbol || tokenIn.address} ≈ ${currentPrice.toString()} ${tokenOut.symbol || tokenOut.address}`,
    );
    this.logDebug(
      "currentPrice invert:",
      `1 ${tokenOut.symbol || tokenOut.address} ≈ ${new Decimal(1).div(currentPrice).toString()} ${tokenIn.symbol || tokenIn.address
      }`,
    );

    let amountInRaw = new BN(0);
    let amountOutRaw = amountOut;
    if (!amountOutRaw.isZero()) {
      // if out > reserve, out = reserve - 1
      if (amountOutRaw.gt(reserveOut)) {
        amountOutRaw = reserveOut.sub(new BN(1));
      }

      const denominator = reserveOut.sub(amountOutRaw);
      const amountInWithoutFee = reserveIn.mul(amountOutRaw).div(denominator);

      amountInRaw = amountInWithoutFee
        .mul(LIQUIDITY_FEES_DENOMINATOR)
        .div(LIQUIDITY_FEES_DENOMINATOR.sub(LIQUIDITY_FEES_NUMERATOR));
    }

    const maxAmountInRaw = new BN(new Decimal(amountInRaw.toString()).mul(1 + slippage).toFixed(0));

    const amountIn = amountInRaw;
    const maxAmountIn = maxAmountInRaw;
    this.logDebug(
      "amountIn:",
      new Decimal(amountIn.toString())
        .div(10 ** tokenIn.decimals)
        .toDecimalPlaces(tokenIn.decimals)
        .toString(),
    );
    this.logDebug(
      "maxAmountIn:",
      new Decimal(maxAmountIn.toString())
        .div(10 ** tokenIn.decimals)
        .toDecimalPlaces(tokenIn.decimals)
        .toString(),
    );

    let executionPrice: Decimal | null = null;
    if (!amountInRaw.isZero() && !amountOutRaw.isZero()) {
      executionPrice = new Decimal(amountOutRaw.toString())
        .div(10 ** tokenOut.decimals)
        .div(new Decimal(amountInRaw.toString()).div(10 ** tokenIn.decimals));
      this.logDebug(
        "executionPrice:",
        `1 ${tokenOut.symbol || tokenOut.address} ≈ ${executionPrice
          .toDecimalPlaces(Math.max(poolInfo.mintA.decimals, poolInfo.mintB.decimals))
          .toString()} ${tokenIn.symbol || tokenIn.address}`,
      );
      this.logDebug(
        "executionPrice invert:",
        `1 ${tokenOut.symbol || tokenOut.address} ≈ ${new Decimal(1)
          .div(executionPrice)
          .toDecimalPlaces(Math.max(poolInfo.mintA.decimals, poolInfo.mintB.decimals))
          .toString()} ${tokenIn.symbol || tokenIn.address}`,
      );
    }

    const exactQuote = currentPrice.mul(amountIn.toString());
    const priceImpact = exactQuote.sub(amountOut.toString()).abs().div(exactQuote);
    this.logDebug("priceImpact:", `${priceImpact.toString()}%`);

    return {
      amountIn,
      maxAmountIn,
      currentPrice,
      executionPrice,
      priceImpact,
    };
  }

  public async swap<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    amountIn,
    amountOut,
    inputMint,
    fixedSide,
    txVersion,
    config,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: SwapParam<T>): Promise<MakeTxData<T>> {
    const txBuilder = this.createTxBuilder(feePayer);
    const { associatedOnly = true, inputUseSolBalance = true, outputUseSolBalance = true } = config || {};

    const [tokenIn, tokenOut] =
      inputMint === poolInfo.mintA.address ? [poolInfo.mintA, poolInfo.mintB] : [poolInfo.mintB, poolInfo.mintA];

    const inputTokenUseSolBalance = inputUseSolBalance && tokenIn.address === WSOLMint.toBase58();
    const outputTokenUseSolBalance = outputUseSolBalance && tokenOut.address === WSOLMint.toBase58();

    const { account: _tokenAccountIn, instructionParams: ownerTokenAccountBaseInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: new PublicKey(tokenIn.address),
        owner: this.scope.ownerPubKey,

        createInfo: inputTokenUseSolBalance
          ? {
            payer: this.scope.ownerPubKey,
            amount: amountIn,
          }
          : undefined,
        skipCloseAccount: !inputTokenUseSolBalance,
        notUseTokenAccount: inputTokenUseSolBalance,
        associatedOnly,
      });
    txBuilder.addInstruction(ownerTokenAccountBaseInstruction || {});

    if (!_tokenAccountIn)
      this.logAndCreateError("input token account not found", {
        token: tokenIn.symbol || tokenIn.address,
        tokenAccountIn: _tokenAccountIn,
        inputTokenUseSolBalance,
        associatedOnly,
      });

    const { account: _tokenAccountOut, instructionParams: ownerTokenAccountQuoteInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: new PublicKey(tokenOut.address),
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey!,
          amount: 0,
        },
        skipCloseAccount: !outputTokenUseSolBalance,
        notUseTokenAccount: outputTokenUseSolBalance,
        associatedOnly: outputTokenUseSolBalance ? false : associatedOnly,
      });
    txBuilder.addInstruction(ownerTokenAccountQuoteInstruction || {});
    if (_tokenAccountOut === undefined)
      this.logAndCreateError("output token account not found", {
        token: tokenOut.symbol || tokenOut.address,
        tokenAccountOut: _tokenAccountOut,
        outputTokenUseSolBalance,
        associatedOnly,
      });

    const poolKeys = propPoolKeys || (await this.getAmmPoolKeys(poolInfo.id));
    let version = 4;
    if (poolInfo.pooltype.includes("StablePool")) version = 5;

    txBuilder.addInstruction({
      instructions: [
        makeAMMSwapInstruction({
          version,
          poolKeys,
          userKeys: {
            tokenAccountIn: _tokenAccountIn!,
            tokenAccountOut: _tokenAccountOut!,
            owner: this.scope.ownerPubKey,
          },
          amountIn,
          amountOut,
          fixedSide,
        }),
      ],
      instructionTypes: [version === 4 ? InstructionType.AmmV4SwapBaseIn : InstructionType.AmmV5SwapBaseIn],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData<T>>;
  }

  public async getRpcPoolInfo(poolId: string): Promise<AmmRpcData> {
    return (await this.getRpcPoolInfos([poolId]))[poolId];
  }

  public async getRpcPoolInfos(
    poolIds: (string | PublicKey)[],
    config?: { batchRequest?: boolean; chunkCount?: number },
  ): Promise<{
    [poolId: string]: AmmRpcData;
  }> {
    const accounts = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      poolIds.map((i) => ({ pubkey: new PublicKey(i) })),
      config,
    );
    const poolInfos: { [poolId: string]: ReturnType<typeof liquidityStateV4Layout.decode> & { programId: PublicKey } } =
      {};

    const needFetchVaults: PublicKey[] = [];

    for (let i = 0; i < poolIds.length; i++) {
      const item = accounts[i];
      if (item === null || !item.accountInfo) throw Error("fetch pool info error: " + String(poolIds[i]));
      const rpc = liquidityStateV4Layout.decode(item.accountInfo.data);
      poolInfos[String(poolIds[i])] = {
        ...rpc,
        programId: item.accountInfo.owner,
      };

      needFetchVaults.push(rpc.baseVault, rpc.quoteVault);
    }

    const vaultInfo: { [vaultId: string]: BN } = {};
    const vaultAccountInfo = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      needFetchVaults.map((i) => ({ pubkey: new PublicKey(i) })),
      config,
    );

    for (let i = 0; i < needFetchVaults.length; i++) {
      const vaultItemInfo = vaultAccountInfo[i].accountInfo;
      if (vaultItemInfo === null) throw Error("fetch vault info error: " + needFetchVaults[i]);

      vaultInfo[String(needFetchVaults[i])] = new BN(AccountLayout.decode(vaultItemInfo.data).amount.toString());
    }

    const returnData: { [poolId: string]: AmmRpcData } = {};

    for (const [id, info] of Object.entries(poolInfos)) {
      const baseReserve = vaultInfo[info.baseVault.toString()].sub(info.baseNeedTakePnl);
      const quoteReserve = vaultInfo[info.quoteVault.toString()].sub(info.quoteNeedTakePnl);
      returnData[id] = {
        ...info,
        baseReserve,
        mintAAmount: vaultInfo[info.baseVault.toString()],
        mintBAmount: vaultInfo[info.quoteVault.toString()],
        quoteReserve,
        poolPrice: new Decimal(quoteReserve.toString())
          .div(new Decimal(10).pow(info.quoteDecimal.toString()))
          .div(new Decimal(baseReserve.toString()).div(new Decimal(10).pow(info.baseDecimal.toString()))),
      };
    }

    return returnData;
  }

  public async getPoolInfoFromRpc({ poolId }: { poolId: string }): Promise<{
    poolRpcData: AmmRpcData;
    poolInfo: ComputeAmountOutParam["poolInfo"];
    poolKeys: AmmV4Keys | AmmV5Keys;
  }> {
    const rpcData = await this.getRpcPoolInfo(poolId);
    const computeData = toAmmComputePoolInfo({ [poolId]: rpcData });
    const poolInfo = computeData[poolId];
    const allKeys = await this.scope.tradeV2.computePoolToPoolKeys({
      pools: [computeData[poolId]],
      ammRpcData: { [poolId]: rpcData },
    });
    return {
      poolRpcData: rpcData,
      poolInfo,
      poolKeys: allKeys[0] as AmmV4Keys | AmmV5Keys,
    };
  }
}
