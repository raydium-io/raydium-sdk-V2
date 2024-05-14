import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ApiV3PoolInfoStandardItem, CpmmKeys } from "@/api/type";
import { TokenAmount } from "@/module";
import { toToken } from "../token";
import { BN_ZERO, divCeil } from "@/common/bignumber";
import { getATAAddress } from "@/common/pda";
import { InstructionType, TxVersion } from "@/common/txTool/txType";
import { MakeTxData } from "@/common/txTool/txTool";

import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  CreateCpmmPoolParam,
  CreateCpmmPoolAddress,
  AddCpmmLiquidityParams,
  WithdrawCpmmLiquidityParams,
  CpmmSwapParams,
} from "./type";
import { getCreatePoolKeys, getPdaObservationId } from "./pda";
import {
  makeCreateCpmmPoolInInstruction,
  makeDepositCpmmInInstruction,
  makeWithdrawCpmmInInstruction,
  makeSwapCpmmBaseInInInstruction,
  makeSwapCpmmBaseOutInInstruction,
} from "./instruction";

import BN from "bn.js";
import Decimal from "decimal.js";

export default class CpmmModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(): Promise<void> {
    this.checkDisabled();
  }

  public computePairAmount({
    poolInfo,
    amount,
    slippage,
    baseIn,
  }: {
    poolInfo: ApiV3PoolInfoStandardItem;
    amount: string | Decimal;
    slippage: string | number; // in percent
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
      `${slippage}%`,
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

    const _slippage = new Decimal(slippage).div(100).add(1);
    const slippageAdjustedAmount = new BN(
      new Decimal(amountRaw.toString()).mul(_slippage).toFixed(0, Decimal.ROUND_DOWN),
    );

    const _anotherAmount = new TokenAmount(_anotherToken, amountRaw);
    const _maxAnotherAmount = new TokenAmount(_anotherToken, slippageAdjustedAmount);
    this.logDebug("anotherAmount:", _anotherAmount.toFixed(), "maxAnotherAmount:", _maxAnotherAmount.toFixed());

    return {
      anotherAmount: _anotherAmount,
      maxAnotherAmount: _maxAnotherAmount,
      liquidity,
    };
  }

  public async getCpmmPoolKeys(poolId: string): Promise<CpmmKeys> {
    return ((await this.scope.api.fetchPoolKeysById({ idList: [poolId] })) as CpmmKeys[])[0];
  }

  public async createPool<T extends TxVersion>({
    programId,
    poolFeeAccount,
    mintA,
    mintB,
    mintAAmount,
    mintBAmount,
    startTime,
    ownerInfo,
    associatedOnly = false,
    checkCreateATAOwner = false,
    txVersion,
    computeBudgetConfig,
  }: CreateCpmmPoolParam<T>): Promise<MakeTxData<T, { address: CreateCpmmPoolAddress }>> {
    const payer = ownerInfo.feePayer || this.scope.owner?.publicKey;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && mintA.address === NATIVE_MINT.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && mintB.address === NATIVE_MINT.toBase58();
    const [mintAPubkey, mintBPubkey] = [new PublicKey(mintA.address), new PublicKey(mintB.address)];

    const txBuilder = this.createTxBuilder();

    const { account: userVaultA, instructionParams: userVaultAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: mintAPubkey,
        tokenProgram: mintA.programId,
        owner: this.scope.ownerPubKey,
        createInfo: mintAUseSOLBalance
          ? {
              payer: payer!,
              amount: mintAAmount,
            }
          : undefined,
        notUseTokenAccount: mintAUseSOLBalance,
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    txBuilder.addInstruction(userVaultAInstruction || {});

    const { account: userVaultB, instructionParams: userVaultBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: new PublicKey(mintB.address),
        tokenProgram: mintB.programId,
        owner: this.scope.ownerPubKey,
        createInfo: mintBUseSOLBalance
          ? {
              payer: payer!,
              amount: mintBAmount,
            }
          : undefined,

        notUseTokenAccount: mintBUseSOLBalance,
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    txBuilder.addInstruction(userVaultBInstruction || {});

    if (userVaultA === undefined || userVaultB === undefined) throw Error("you don't has some token account");

    const poolKeys = getCreatePoolKeys({
      programId,
      mintA: mintAPubkey,
      mintB: mintBPubkey,
    });

    txBuilder.addInstruction({
      instructions: [
        makeCreateCpmmPoolInInstruction(
          programId,
          this.scope.ownerPubKey,
          poolKeys.configId,
          poolKeys.authority,
          poolKeys.poolId,
          mintAPubkey,
          mintBPubkey,
          poolKeys.lpMint,
          userVaultA,
          userVaultB,
          getATAAddress(this.scope.ownerPubKey, poolKeys.lpMint).publicKey,
          poolKeys.vaultA,
          poolKeys.vaultB,
          poolFeeAccount,
          new PublicKey(mintA.programId ?? TOKEN_PROGRAM_ID),
          new PublicKey(mintB.programId ?? TOKEN_PROGRAM_ID),
          poolKeys.observationId,
          mintAAmount,
          mintBAmount,
          startTime,
        ),
      ],
      instructionTypes: [InstructionType.CpmmCreatePool],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild({
      txVersion,
      extInfo: {
        address: { ...poolKeys, mintA, mintB, programId, poolFeeAccount },
      },
    }) as Promise<MakeTxData<T, { address: CreateCpmmPoolAddress }>>;
  }

  public async addLiquidity<T extends TxVersion>(params: AddCpmmLiquidityParams<T>): Promise<MakeTxData<T>> {
    const { poolInfo, inputAmount, anotherAmount, baseIn, liquidity, computeBudgetConfig, config, txVersion } = params;

    if (this.scope.availability.addStandardPosition === false)
      this.logAndCreateError("add liquidity feature disabled in your region");

    if (inputAmount.isZero() || anotherAmount.isZero())
      this.logAndCreateError("amounts must greater than zero", "amountInA & amountInB", {
        amountInA: inputAmount.toString(),
        amountInB: anotherAmount.toString(),
      });
    const { account } = this.scope;
    const { bypassAssociatedCheck, checkCreateATAOwner } = {
      // default
      ...{ bypassAssociatedCheck: false, checkCreateATAOwner: false },
      // custom
      ...config,
    };
    const txBuilder = this.createTxBuilder();
    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];
    const tokenAccountA = await account.getCreatedTokenAccount({
      mint: mintA,
      associatedOnly: false,
    });
    const tokenAccountB = await account.getCreatedTokenAccount({
      mint: mintB,
      associatedOnly: false,
    });
    if (!tokenAccountA && !tokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", account.tokenAccounts);

    const lpTokenAccount = await account.getCreatedTokenAccount({
      mint: new PublicKey(poolInfo.lpMint.address),
    });
    const { tokenAccount: _lpTokenAccount, ...lpInstruction } = await account.handleTokenAccount({
      side: "out",
      amount: 0,
      mint: new PublicKey(poolInfo.lpMint.address),
      tokenAccount: lpTokenAccount,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(lpInstruction);

    const poolKeys = await this.getCpmmPoolKeys(poolInfo.id);

    txBuilder.addInstruction({
      instructions: [
        makeDepositCpmmInInstruction(
          new PublicKey(poolInfo.programId),
          this.scope.ownerPubKey,
          new PublicKey(poolKeys.authority),
          new PublicKey(poolInfo.id),
          _lpTokenAccount!,
          tokenAccountA!,
          tokenAccountB!,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          mintA,
          mintB,
          new PublicKey(poolInfo.lpMint.address),

          liquidity,
          baseIn ? inputAmount : anotherAmount,
          baseIn ? anotherAmount : inputAmount,
        ),
      ],
      instructionTypes: [InstructionType.CpmmAddLiquidity],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    });
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async withdrawLiquidity<T extends TxVersion>(params: WithdrawCpmmLiquidityParams<T>): Promise<MakeTxData<T>> {
    const { poolInfo, lpAmount, amountMintA, amountMintB, computeBudgetConfig, txVersion } = params;

    if (this.scope.availability.addStandardPosition === false)
      this.logAndCreateError("add liquidity feature disabled in your region");

    const { account } = this.scope;
    const txBuilder = this.createTxBuilder();
    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];
    const tokenAccountA = await account.getCreatedTokenAccount({
      mint: mintA,
      associatedOnly: false,
    });
    const tokenAccountB = await account.getCreatedTokenAccount({
      mint: mintB,
      associatedOnly: false,
    });
    if (!tokenAccountA && !tokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", account.tokenAccounts);

    const lpTokenAccount = await account.getCreatedTokenAccount({
      mint: new PublicKey(poolInfo.lpMint.address),
    });

    if (!lpTokenAccount)
      this.logAndCreateError("cannot found lp token account", "tokenAccounts", account.tokenAccounts);

    const poolKeys = await this.getCpmmPoolKeys(poolInfo.id);

    txBuilder.addInstruction({
      instructions: [
        makeWithdrawCpmmInInstruction(
          new PublicKey(poolInfo.programId),
          this.scope.ownerPubKey,
          new PublicKey(poolKeys.authority),
          new PublicKey(poolInfo.id),
          lpTokenAccount!,
          tokenAccountA!,
          tokenAccountB!,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          mintA,
          mintB,
          new PublicKey(poolInfo.lpMint.address),

          lpAmount,
          amountMintA,
          amountMintB,
        ),
      ],
      instructionTypes: [InstructionType.CpmmWithdrawLiquidity],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    });
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async swap<T extends TxVersion>(params: CpmmSwapParams): Promise<MakeTxData<T>> {
    const { poolInfo, baseIn, swapResult, config, computeBudgetConfig, txVersion } = params;

    const { bypassAssociatedCheck, checkCreateATAOwner } = {
      // default
      ...{ bypassAssociatedCheck: false, checkCreateATAOwner: false },
      // custom
      ...config,
    };

    const txBuilder = this.createTxBuilder();

    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];

    const mintATokenAcc = await this.scope.account.getCreatedTokenAccount({
      programId: new PublicKey(poolInfo.mintA.programId ?? TOKEN_PROGRAM_ID),
      mint: mintA,
      associatedOnly: false,
    });

    const mintBTokenAcc = await this.scope.account.getCreatedTokenAccount({
      programId: new PublicKey(poolInfo.mintB.programId ?? TOKEN_PROGRAM_ID),
      mint: mintB,
      associatedOnly: false,
    });

    const { tokenAccount: _mintATokenAcc, ...mintATokenAccInstruction } = await this.scope.account.handleTokenAccount({
      side: baseIn ? "in" : "out",
      amount: baseIn ? swapResult.sourceAmountSwapped : swapResult.destinationAmountSwapped,
      mint: mintA,
      tokenAccount: mintATokenAcc,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(mintATokenAccInstruction);

    const { tokenAccount: _mintBTokenAcc, ...mintBTokenAccInstruction } = await this.scope.account.handleTokenAccount({
      side: baseIn ? "out" : "in",
      amount: baseIn ? swapResult.destinationAmountSwapped : swapResult.sourceAmountSwapped,
      mint: mintB,
      tokenAccount: mintBTokenAcc,
      bypassAssociatedCheck,
      checkCreateATAOwner,
    });
    txBuilder.addInstruction(mintBTokenAccInstruction);

    if (!_mintATokenAcc && !_mintBTokenAcc)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const poolKeys = await this.getCpmmPoolKeys(poolInfo.id);

    txBuilder.addInstruction({
      instructions: [
        baseIn
          ? makeSwapCpmmBaseInInInstruction(
              new PublicKey(poolInfo.programId),
              this.scope.ownerPubKey,
              new PublicKey(poolKeys.authority),
              new PublicKey(poolKeys.id), // todo config id
              new PublicKey(poolInfo.id),
              _mintATokenAcc!,
              _mintBTokenAcc!,
              new PublicKey(poolKeys.vault.A),
              new PublicKey(poolKeys.vault.B),
              new PublicKey(poolInfo.mintA.programId ?? TOKEN_PROGRAM_ID),
              new PublicKey(poolInfo.mintB.programId ?? TOKEN_PROGRAM_ID),
              mintA,
              mintB,
              getPdaObservationId(new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)).publicKey,

              swapResult.sourceAmountSwapped,
              swapResult.destinationAmountSwapped,
            )
          : makeSwapCpmmBaseOutInInstruction(
              new PublicKey(poolInfo.programId),
              this.scope.ownerPubKey,
              new PublicKey(poolKeys.authority),
              new PublicKey(poolKeys.id), // todo config id
              new PublicKey(poolInfo.id),

              _mintBTokenAcc!,
              _mintATokenAcc!,

              new PublicKey(poolKeys.vault.B),
              new PublicKey(poolKeys.vault.A),

              new PublicKey(poolInfo.mintB.programId ?? TOKEN_PROGRAM_ID),
              new PublicKey(poolInfo.mintA.programId ?? TOKEN_PROGRAM_ID),

              mintB,
              mintA,

              getPdaObservationId(new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)).publicKey,

              swapResult.sourceAmountSwapped,
              swapResult.destinationAmountSwapped,
            ),
      ],
      instructionTypes: [baseIn ? InstructionType.CpmmSwapBaseIn : InstructionType.CpmmSwapBaseOut],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }
}
