import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { ApiV3PoolInfoStandardItem } from "../../api/type";
import { Token, TokenAmount, Percent } from "../../module";
import { SOLMint, WSOLMint, solToWSol } from "../../common/pubKey";
import { BN_ZERO, BN_ONE, BN_TEN, divCeil } from "../../common/bignumber";
import BN from "bn.js";

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
      ? this.scope.mintToTokenAmount({ mint: WSOLMint, amount: amount.toExact() })
      : amount;
    const _anotherToken = anotherToken.mint.equals(SOLMint)
      ? this.scope.mintToToken(WSOLMint)
      : new Token({
          mint: anotherToken.mint,
          decimals: anotherToken.decimals,
          symbol: anotherToken.symbol,
          name: anotherToken.name,
        });

    const [baseReserve, quoteReserve] = [new BN(poolInfo.mintAmountA), new BN(poolInfo.mintAmountB)];
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
}
