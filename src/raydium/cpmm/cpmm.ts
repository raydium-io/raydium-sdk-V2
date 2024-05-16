import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { ApiV3PoolInfoStandardItem, CpmmKeys } from "@/api/type";
import { TokenAmount, Percent } from "@/module";
import { toToken } from "../token";
import { BN_ZERO } from "@/common/bignumber";
import { getATAAddress } from "@/common/pda";
import { WSOLMint } from "@/common/pubKey";
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
import { CpmmPoolInfoLayout } from "./layout";
import Decimal from "decimal.js";

export default class CpmmModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(): Promise<void> {
    this.checkDisabled();
  }

  public async getCpmmPoolKeys(poolId: string): Promise<CpmmKeys> {
    return ((await this.scope.api.fetchPoolKeysById({ idList: [poolId] })) as CpmmKeys[])[0];
  }

  public async getRpcPoolInfo(poolId: string): Promise<
    ReturnType<typeof CpmmPoolInfoLayout.decode> & {
      baseReserve: BN;
      quoteReserve: BN;
    }
  > {
    const accountData = await this.scope.connection.getAccountInfo(new PublicKey(poolId));
    if (!accountData) throw new Error(`pool not found: ${poolId}`);
    const poolInfo = CpmmPoolInfoLayout.decode(accountData.data);
    const [poolVaultAState, poolVaultBState] = await this.scope.connection.getMultipleAccountsInfo([
      poolInfo.vaultA,
      poolInfo.vaultB,
    ]);

    if (!poolVaultAState) throw new Error(`pool vaultA info not found: ${poolInfo.vaultA.toBase58()}`);
    if (!poolVaultBState) throw new Error(`pool vaultB info not found: ${poolInfo.vaultB.toBase58()}`);

    return {
      ...poolInfo,
      baseReserve: new BN(AccountLayout.decode(poolVaultAState.data).amount.toString())
        .sub(poolInfo.protocolFeesMintA)
        .sub(poolInfo.fundFeesMintA),
      quoteReserve: new BN(AccountLayout.decode(poolVaultBState.data).amount.toString())
        .sub(poolInfo.protocolFeesMintB)
        .sub(poolInfo.fundFeesMintB),
    };
  }

  public async createPool<T extends TxVersion>({
    programId,
    poolFeeAccount,
    startTime,
    ownerInfo,
    associatedOnly = false,
    checkCreateATAOwner = false,
    txVersion,
    computeBudgetConfig,
    ...params
  }: CreateCpmmPoolParam<T>): Promise<MakeTxData<T, { address: CreateCpmmPoolAddress }>> {
    const payer = ownerInfo.feePayer || this.scope.owner?.publicKey;
    const isFront = params.mintA.address < params.mintB.address;

    const [mintA, mintB] = isFront ? [params.mintA, params.mintB] : [params.mintB, params.mintA];
    const [mintAAmount, mintBAmount] = isFront
      ? [params.mintAAmount, params.mintBAmount]
      : [params.mintBAmount, params.mintAAmount];

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
    const { poolInfo, inputAmount, baseIn, slippage, computeBudgetConfig, config, txVersion } = params;

    if (this.scope.availability.addStandardPosition === false)
      this.logAndCreateError("add liquidity feature disabled in your region");

    if (inputAmount.isZero())
      this.logAndCreateError("amounts must greater than zero", "amountInA", {
        amountInA: inputAmount.toString(),
      });
    const { account } = this.scope;
    const { bypassAssociatedCheck, checkCreateATAOwner } = {
      // default
      ...{ bypassAssociatedCheck: false, checkCreateATAOwner: false },
      // custom
      ...config,
    };
    const rpcPoolData = await this.getRpcPoolInfo(poolInfo.id);
    const { liquidity, anotherAmount: _anotherAmount } = this.computePairAmount({
      poolInfo: {
        ...poolInfo,
        mintAmountA: new Decimal(rpcPoolData.baseReserve.toString()).div(10 ** poolInfo.mintA.decimals).toNumber(),
        mintAmountB: new Decimal(rpcPoolData.quoteReserve.toString()).div(10 ** poolInfo.mintB.decimals).toNumber(),
        lpAmount: new Decimal(rpcPoolData.lpAmount.toString()).div(10 ** poolInfo.lpMint.decimals).toNumber(),
      },
      slippage,
      baseIn,
      amount: new Decimal(inputAmount.toString()).div(
        10 ** (baseIn ? poolInfo.mintA.decimals : poolInfo.mintB.decimals),
      ),
    });
    const anotherAmount = _anotherAmount.raw;
    const mintAUseSOLBalance = poolInfo.mintA.address === NATIVE_MINT.toString();
    const mintBUseSOLBalance = poolInfo.mintB.address === NATIVE_MINT.toString();

    const txBuilder = this.createTxBuilder();
    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];

    const { account: tokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintAUseSOLBalance || (baseIn ? inputAmount : anotherAmount).isZero()
            ? {
                payer: this.scope.ownerPubKey,
                amount: baseIn ? inputAmount : anotherAmount,
              }
            : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: false,
        checkCreateATAOwner,
      });

    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: tokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintBUseSOLBalance || (baseIn ? anotherAmount : inputAmount).isZero()
            ? {
                payer: this.scope.ownerPubKey,
                amount: baseIn ? anotherAmount : inputAmount,
              }
            : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: false,
        checkCreateATAOwner,
      });

    txBuilder.addInstruction(_tokenAccountBInstruction || {});

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
    const { poolInfo, lpAmount, slippage, computeBudgetConfig, txVersion } = params;

    if (this.scope.availability.addStandardPosition === false)
      this.logAndCreateError("add liquidity feature disabled in your region");

    const _slippage = new Percent(new BN(1)).sub(slippage);

    const rpcPoolData = await this.getRpcPoolInfo(poolInfo.id);
    const [amountMintA, amountMintB] = [
      _slippage.mul(lpAmount.mul(rpcPoolData.baseReserve).div(rpcPoolData.lpAmount)).quotient,
      _slippage.mul(lpAmount.mul(rpcPoolData.quoteReserve).div(rpcPoolData.lpAmount)).quotient,
    ];
    const { account } = this.scope;
    const txBuilder = this.createTxBuilder();
    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];

    const mintAUseSOLBalance = mintA.equals(WSOLMint);
    const mintBUseSOLBalance = mintB.equals(WSOLMint);

    let tokenAccountA: PublicKey | undefined = undefined;
    let tokenAccountB: PublicKey | undefined = undefined;
    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : true,
        checkCreateATAOwner: false,
      });
    tokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : true,
        checkCreateATAOwner: false,
      });
    tokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    if (!tokenAccountA || !tokenAccountB)
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
  }): { anotherAmount: TokenAmount; maxAnotherAmount: TokenAmount; liquidity: BN } {
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
    );

    // input is fixed
    const input = baseIn ? "base" : "quote";
    this.logDebug("input side:", input);

    const liquidity = inputAmount.mul(lpAmount).div(input === "base" ? baseReserve : quoteReserve);

    let amountRaw = BN_ZERO;
    if (!inputAmount.isZero()) {
      amountRaw = lpToAmount(liquidity, baseReserve, quoteReserve, lpAmount)[baseIn ? "amountB" : "amountA"];
    }

    const _slippage = new Percent(new BN(1)).add(slippage);
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
}

function lpToAmount(lp: BN, poolAmountA: BN, poolAmountB: BN, supply: BN): { amountA: BN; amountB: BN } {
  let amountA = lp.mul(poolAmountA).div(supply);
  if (!amountA.isZero() && !lp.mul(poolAmountA).mod(supply).isZero()) amountA = amountA.add(new BN(1));
  let amountB = lp.mul(poolAmountB).div(supply);
  if (!amountB.isZero() && !lp.mul(poolAmountB).mod(supply).isZero()) amountB = amountB.add(new BN(1));
  return {
    amountA,
    amountB,
  };
}
