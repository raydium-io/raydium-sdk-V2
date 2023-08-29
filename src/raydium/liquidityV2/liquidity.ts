import { PublicKey } from "@solana/web3.js";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { ApiV3PoolInfoStandardItem } from "../../api/type";
import { Token, TokenAmount, Percent } from "../../module";
import { SOLMint, WSOLMint, solToWSol } from "../../common/pubKey";
import { BN_ZERO, BN_ONE, divCeil } from "../../common/bignumber";
import BN from "bn.js";
import Decimal from "decimal.js";
import { AmountSide, AddLiquidityParams } from "./type";
import { MakeTransaction } from "../../raydium/type";
import { makeAddLiquidityInstruction } from "./instruction";
import { InstructionType } from "../../common/txTool/txType";

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
      // lookupTableAddress: [poolKeys.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
    });
    return txBuilder.build();
  }
}
