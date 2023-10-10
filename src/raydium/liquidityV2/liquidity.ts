import { PublicKey } from "@solana/web3.js";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  ApiV3PoolInfoConcentratedItem,
  ApiV3PoolInfoStandardItem,
  AmmV4Keys,
  AmmV5Keys,
  ClmmKeys,
} from "../../api/type";
import { Token, TokenAmount, Percent } from "../../module";
import { SOLMint, WSOLMint, solToWSol, PublicKeyish } from "../../common/pubKey";
import { BN_ZERO, BN_ONE, divCeil } from "../../common/bignumber";
import { getATAAddress } from "../../common/pda";
import { addComputeBudget } from "../../common/txTool/txUtils";
import BN from "bn.js";
import Decimal from "decimal.js";
import { AmountSide, AddLiquidityParams } from "./type";
import { MakeTransaction } from "../../raydium/type";
import { makeAddLiquidityInstruction } from "./instruction";
import { InstructionType } from "../../common/txTool/txType";
import { ComputeBudgetConfig } from "../type";
import { removeLiquidityInstruction } from "./instruction";
import { ClmmInstrument } from "../clmm/instrument";

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
    anotherToken,
    slippage,
  }: {
    poolInfo: ApiV3PoolInfoStandardItem;
    amount: TokenAmount;
    anotherToken: Token;
    slippage: Percent;
  }): { anotherAmount: TokenAmount; maxAnotherAmount: TokenAmount } {
    const _amount = amount.token.mint.equals(SOLMint)
      ? this.scope.mintToTokenAmount({ mint: WSOLMint, amount: amount.raw, decimalDone: true })
      : amount;
    const _anotherToken = anotherToken.mint.equals(SOLMint)
      ? this.scope.mintToToken(WSOLMint)
      : new Token({
          mint: anotherToken.mint,
          decimals: anotherToken.decimals,
          symbol: anotherToken.symbol,
          name: anotherToken.name,
        });

    const [baseReserve, quoteReserve] = [
      new BN(new Decimal(poolInfo.mintAmountA).mul(10 ** poolInfo.mintA.decimals).toString()),
      new BN(new Decimal(poolInfo.mintAmountB).mul(10 ** poolInfo.mintB.decimals).toString()),
    ];
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
    const input = solToWSol(_amount.token.mint).toString() === poolInfo.mintA.address ? "base" : "quote";
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

  public async addLiquidity(params: AddLiquidityParams): Promise<MakeTransaction> {
    const { poolInfo, amountInA: _amountInA, amountInB: _amountInB, fixedSide, config } = params;

    const amountInA = this.scope.mintToTokenAmount({
      mint: solToWSol(_amountInA.token.mint),
      amount: _amountInA.toExact(),
    });
    const amountInB = this.scope.mintToTokenAmount({
      mint: solToWSol(_amountInB.token.mint),
      amount: _amountInB.toExact(),
    });

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
      lookupTableAddress: poolKeys.lookupTableAccount ? [new PublicKey(poolKeys.lookupTableAccount)] : [],
    });
    return txBuilder.build();
  }

  public async removeAllLpAndCreateClmmPosition({
    poolInfo,
    clmmPoolInfo,
    removeLpAmount,
    createPositionInfo,
    farmInfo,
    computeBudgetConfig,
    payer,
    tokenProgram,
    getEphemeralSigners,
  }: {
    poolInfo: ApiV3PoolInfoStandardItem;
    clmmPoolInfo: ApiV3PoolInfoConcentratedItem;
    removeLpAmount: BN;
    createPositionInfo: {
      tickLower: number;
      tickUpper: number;
      liquidity: BN;
      amountMaxA: BN;
      amountMaxB: BN;
    };
    farmInfo?: {
      farmId: PublicKeyish;
      amount: BN;
    };
    payer?: PublicKey;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
    getEphemeralSigners?: (k: number) => any;
  }): Promise<MakeTransaction> {
    const { instructions, instructionTypes } = computeBudgetConfig
      ? addComputeBudget(computeBudgetConfig)
      : { instructions: [], instructionTypes: [] };

    if (
      !(poolInfo.mintA.address === clmmPoolInfo.mintA.address || poolInfo.mintA.address === clmmPoolInfo.mintB.address)
    )
      throw Error("mint check error");
    if (
      !(poolInfo.mintB.address === clmmPoolInfo.mintA.address || poolInfo.mintB.address === clmmPoolInfo.mintB.address)
    )
      throw Error("mint check error");

    const txBuilder = this.createTxBuilder();
    const mintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccountRawInfos) {
      if (
        mintToAccount[item.accountInfo.mint.toString()] === undefined ||
        getATAAddress(this.scope.ownerPubKey, item.accountInfo.mint, tokenProgram).publicKey.equals(item.pubkey)
      ) {
        mintToAccount[item.accountInfo.mint.toString()] = item.pubkey;
      }
    }

    const lpTokenAccount = mintToAccount[poolInfo.lpMint.address];
    if (lpTokenAccount === undefined) throw Error("find lp account error in trade accounts");

    const amountIn = removeLpAmount.add(farmInfo?.amount ?? new BN(0));

    const mintBaseUseSOLBalance = poolInfo.mintA.address === Token.WSOL.mint.toString();
    const mintQuoteUseSOLBalance = poolInfo.mintB.address === Token.WSOL.mint.toString();

    const { account: baseTokenAccount, instructionParams: ownerTokenAccountBaseInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintBaseUseSOLBalance,
        createInfo: {
          payer: payer || this.scope.ownerPubKey,
        },
        associatedOnly: true,
      });
    txBuilder.addInstruction(ownerTokenAccountBaseInstruction || {});
    if (baseTokenAccount === undefined) throw new Error("base token account not found");

    const { account: quoteTokenAccount, instructionParams: ownerTokenAccountQuoteInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintQuoteUseSOLBalance,
        createInfo: {
          payer: payer || this.scope.ownerPubKey,
          amount: 0,
        },
        associatedOnly: true,
      });
    txBuilder.addInstruction(ownerTokenAccountQuoteInstruction || {});
    if (quoteTokenAccount === undefined) throw new Error("quote token account not found");

    mintToAccount[poolInfo.mintA.address] = baseTokenAccount;
    mintToAccount[poolInfo.mintB.address] = quoteTokenAccount;

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

    const [tokenAccountA, tokenAccountB] =
      poolInfo.mintA.address === clmmPoolInfo.mintA.address
        ? [baseTokenAccount, quoteTokenAccount]
        : [quoteTokenAccount, baseTokenAccount];

    const clmmPoolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
    const createPositionIns = await ClmmInstrument.openPositionInstructions({
      poolInfo: clmmPoolInfo,
      poolKeys: clmmPoolKeys,
      ownerInfo: {
        feePayer: payer ?? this.scope.ownerPubKey,
        wallet: this.scope.ownerPubKey,
        tokenAccountA,
        tokenAccountB,
      },
      withMetadata: "create",
      ...createPositionInfo,
      getEphemeralSigners,
    });

    const farmKeys = this.scope.farm.allParsedFarmMap.get(farmInfo?.farmId.toString() || "");

    let farmWithdrawData: MakeTransaction<Record<string, any>> | undefined = undefined;

    if (farmInfo !== undefined && farmKeys !== undefined) {
      const rewardTokenAccounts: PublicKey[] = [];
      for (const item of farmKeys.rewardInfos) {
        const rewardIsWsol = item.rewardMint.equals(Token.WSOL.mint);

        const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          mint: item.rewardMint,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !rewardIsWsol,
          createInfo: {
            payer: payer || this.scope.ownerPubKey,
          },
          associatedOnly: true,
        });
        txBuilder.addInstruction(instructionParams || {});
        if (quoteTokenAccount === undefined) throw new Error("quote token account not found");
        rewardTokenAccounts.push(mintToAccount[item.rewardMint.toString()] ?? account);
      }

      farmWithdrawData = await this.scope.farm.withdraw({
        farmId: new PublicKey(farmInfo.farmId),
        amount: farmInfo.amount,
      });
    }

    txBuilder.addInstruction({
      instructions: [...(farmWithdrawData?.transaction.instructions ?? []), removeIns],
      signers: farmWithdrawData?.signers ?? [],
      instructionTypes: [
        ...(farmWithdrawData?.instructionTypes ?? []),
        !poolInfo.pooltype.includes("StablePool")
          ? InstructionType.AmmV4RemoveLiquidity
          : InstructionType.AmmV5RemoveLiquidity,
      ],
      lookupTableAddress:
        poolKeys.lookupTableAccount && poolKeys.lookupTableAccount !== PublicKey.default.toString()
          ? [new PublicKey(poolKeys.lookupTableAccount)]
          : [],
    });

    txBuilder.addInstruction({
      instructions: [...instructions, ...createPositionIns.instructions],
      signers: createPositionIns.signers,
      instructionTypes: [...instructionTypes, ...createPositionIns.instructionTypes],
      lookupTableAddress:
        clmmPoolKeys.lookupTableAccount && clmmPoolKeys.lookupTableAccount !== PublicKey.default.toString()
          ? [new PublicKey(clmmPoolKeys.lookupTableAccount)]
          : [],
    });

    return txBuilder.build();
  }
}
