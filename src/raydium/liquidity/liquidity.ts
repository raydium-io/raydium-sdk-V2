import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ApiV3PoolInfoConcentratedItem,
  ApiV3PoolInfoStandardItem,
  AmmV4Keys,
  AmmV5Keys,
  ClmmKeys,
  FormatFarmInfoOutV6,
} from "@/api/type";
import { Token, TokenAmount, Percent } from "@/module";
import { solToWSol } from "@/common/pubKey";
import { toToken } from "../token";
import { BN_ZERO, BN_ONE, divCeil } from "@/common/bignumber";
import { getATAAddress } from "@/common/pda";
import { InstructionType, TxVersion } from "@/common/txTool/txType";
import { MakeMultiTxData, MakeTxData } from "@/common/txTool/txTool";

import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { AmountSide, AddLiquidityParams, RemoveParams, CreatePoolParam, CreatePoolAddress } from "./type";
import { makeAddLiquidityInstruction } from "./instruction";
import { ComputeBudgetConfig } from "../type";
import { removeLiquidityInstruction, createPoolV4InstructionV2 } from "./instruction";
import { ClmmInstrument } from "../clmm/instrument";
import { getAssociatedPoolKeys, getAssociatedConfigId } from "./utils";
import { createPoolFeeLayout } from "./layout";
import {
  FARM_PROGRAM_TO_VERSION,
  makeWithdrawInstructionV3,
  makeWithdrawInstructionV5,
  makeWithdrawInstructionV6,
} from "@/raydium/farm";

import BN from "bn.js";
import Decimal from "decimal.js";

export default class LiquidityModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
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
    // anotherToken: Token;
    slippage: Percent;
    baseIn?: boolean;
  }): { anotherAmount: TokenAmount; maxAnotherAmount: TokenAmount; liquidity: BN } {
    const inputAmount = new BN(new Decimal(amount).mul(10 ** poolInfo[baseIn ? "mintA" : "mintB"].decimals).toFixed(0));
    const _anotherToken = toToken(poolInfo[baseIn ? "mintB" : "mintA"]);

    const [baseReserve, quoteReserve] = [
      new BN(new Decimal(poolInfo.mintAmountA).mul(10 ** poolInfo.mintA.decimals).toString()),
      new BN(new Decimal(poolInfo.mintAmountB).mul(10 ** poolInfo.mintB.decimals).toString()),
    ];
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

    const liquidity = divCeil(
      inputAmount.mul(new BN(poolInfo.lpAmount).mul(new BN(10).pow(new BN(poolInfo.lpMint.decimals)))),
      new BN(input === "base" ? poolInfo.mintAmountA : poolInfo.mintAmountB).mul(
        new BN(10).pow(new BN(poolInfo[input === "base" ? "mintA" : "mintB"].decimals)),
      ),
    );

    const _slippage = new Percent(BN_ONE).add(slippage);
    const slippageAdjustedAmount = _slippage.mul(amountRaw).quotient;

    const _anotherAmount = new TokenAmount(_anotherToken, amountRaw);
    const _maxAnotherAmount = new TokenAmount(_anotherToken, slippageAdjustedAmount);
    this.logDebug("anotherAmount:", _anotherAmount.toFixed(), "maxAnotherAmount:", _maxAnotherAmount.toFixed());

    return {
      anotherAmount: _anotherAmount,
      maxAnotherAmount: _maxAnotherAmount,
      liquidity,
    };
  }

  public async addLiquidity<T extends TxVersion>(params: AddLiquidityParams<T>): Promise<MakeTxData<T>> {
    const { poolInfo, amountInA, amountInB, fixedSide, config, txVersion } = params;

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

    const poolKeys = await this.scope.api.fetchPoolKeysById({ id: poolInfo.id });

    const txBuilder = this.createTxBuilder();

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
    if (txVersion === TxVersion.V0) (await txBuilder.buildV0()) as MakeTxData<T>;
    return txBuilder.build() as MakeTxData<T>;
  }

  public async removeLiquidity<T extends TxVersion>(params: RemoveParams<T>): Promise<Promise<MakeTxData<T>>> {
    if (this.scope.availability.removeStandardPosition === false)
      this.logAndCreateError("remove liquidity feature disabled in your region");
    const { poolInfo, amountIn, config, txVersion } = params;
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as AmmV4Keys | AmmV5Keys;
    const [baseMint, quoteMint, lpMint] = [
      new PublicKey(poolInfo.mintA.address),
      new PublicKey(poolInfo.mintB.address),
      new PublicKey(poolInfo.lpMint.address),
    ];
    this.logDebug("amountIn:", amountIn);
    if (amountIn.isZero()) this.logAndCreateError("amount must greater than zero", "amountIn", amountIn.toString());

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
          amountIn,
        }),
      ],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
      instructionTypes: [
        poolInfo.pooltype.includes("StablePool")
          ? InstructionType.AmmV5RemoveLiquidity
          : InstructionType.AmmV4RemoveLiquidity,
      ],
    });
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
    tokenProgram = TOKEN_PROGRAM_ID,
    checkCreateATAOwner = true,
    getEphemeralSigners,
    txVersion,
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
    base: "MintA" | "MintB";
    payer?: PublicKey;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
    checkCreateATAOwner?: boolean;
    txVersion?: T;
    getEphemeralSigners?: (k: number) => any;
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

    const txBuilder = this.createTxBuilder();
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
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

    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as AmmV4Keys | AmmV5Keys;

    const removeIns = removeLiquidityInstruction({
      poolInfo,
      poolKeys,
      userKeys: {
        lpTokenAccount,
        baseTokenAccount,
        quoteTokenAccount,
        owner: this.scope.ownerPubKey,
      },
      amountIn,
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

    const clmmPoolKeys = (await this.scope.api.fetchPoolKeysById({ id: clmmPoolInfo.id })) as ClmmKeys;

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

    if (txVersion === TxVersion.V0) return txBuilder.sizeCheckBuildV0() as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuild() as Promise<MakeMultiTxData<T>>;
  }

  // calComputeBudget
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
  }: CreatePoolParam<T>): Promise<MakeTxData<T, { address: CreatePoolAddress }>> {
    const payer = ownerInfo.feePayer || this.scope.owner?.publicKey;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && baseMintInfo.mint.equals(NATIVE_MINT);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && quoteMintInfo.mint.equals(NATIVE_MINT);

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

    return txBuilder.versionBuild({
      txVersion,
      extInfo: {
        address: createPoolKeys,
      },
    }) as Promise<MakeTxData<T, { address: CreatePoolAddress }>>;
  }

  public async getCreatePoolFee({ programId }: { programId: PublicKey }): Promise<BN> {
    const configId = getAssociatedConfigId({ programId });

    const account = await this.scope.connection.getAccountInfo(configId, { dataSlice: { offset: 536, length: 8 } });
    if (account === null) throw Error("get config account error");

    return createPoolFeeLayout.decode(account.data).fee;
  }
}
