import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js-light";
import { ApiV3Token } from "../../../api/type";
import { BNDivCeil } from "../../../common";
import { ConstantProductCurve } from "./constantProduct";
import { CpmmFee } from "./fee";

export enum RoundDirection {
  Floor,
  Ceiling,
}

export type SwapWithoutFeesResult = { destinationAmountSwapped: BN };

export type TradingTokenResult = { tokenAmount0: BN; tokenAmount1: BN };

export type SwapResult = {
  newSwapDestinationAmount: BN;
  sourceAmountSwapped: BN;
  destinationAmountSwapped: BN;
  tradeFee: BN;
};

export class CurveCalculator {
  static validate_supply(tokenAmount0: BN, tokenAmount1: BN): void {
    if (tokenAmount0.isZero()) throw Error("tokenAmount0 is zero");
    if (tokenAmount1.isZero()) throw Error("tokenAmount1 is zero");
  }

  static swap(sourceAmount: BN, swapSourceAmount: BN, swapDestinationAmount: BN, tradeFeeRate: BN): SwapResult {
    const tradeFee = CpmmFee.tradingFee(sourceAmount, tradeFeeRate);

    const sourceAmountLessFees = sourceAmount.sub(tradeFee);

    const { destinationAmountSwapped } = ConstantProductCurve.swapWithoutFees(
      sourceAmountLessFees,
      swapSourceAmount,
      swapDestinationAmount,
    );

    return {
      newSwapDestinationAmount: swapDestinationAmount.sub(destinationAmountSwapped),
      sourceAmountSwapped: sourceAmount,
      destinationAmountSwapped,
      tradeFee,
    };
  }

  static swapBaseOut({
    poolMintA,
    poolMintB,
    tradeFeeRate,
    baseReserve,
    quoteReserve,
    outputMint,
    outputAmount,
  }: {
    poolMintA: ApiV3Token;
    poolMintB: ApiV3Token;
    tradeFeeRate: BN;
    baseReserve: BN;
    quoteReserve: BN;
    outputMint: string | PublicKey;
    outputAmount: BN;
  }): {
    amountRealOut: BN;

    amountIn: BN;
    amountInWithoutFee: BN;

    tradeFee: BN;
    priceImpact: number;
  } {
    const [reserveInAmount, reserveOutAmount, reserveInDecimals, reserveOutDecimals, inputMint] =
      poolMintB.address === outputMint.toString()
        ? [baseReserve, quoteReserve, poolMintA.decimals, poolMintB.decimals, poolMintA.address]
        : [quoteReserve, baseReserve, poolMintB.decimals, poolMintA.decimals, poolMintB.address];
    const currentPrice = new Decimal(reserveOutAmount.toString())
      .div(10 ** reserveOutDecimals)
      .div(new Decimal(reserveInAmount.toString()).div(10 ** reserveInDecimals));
    const amountRealOut = outputAmount.gte(reserveOutAmount) ? reserveOutAmount.sub(new BN(1)) : outputAmount;

    const denominator = reserveOutAmount.sub(amountRealOut);
    const amountInWithoutFee = BNDivCeil(reserveInAmount.mul(amountRealOut), denominator);
    const amountIn = BNDivCeil(amountInWithoutFee.mul(new BN(1_000_000)), new BN(1_000_000).sub(tradeFeeRate));
    const fee = amountIn.sub(amountInWithoutFee);
    const executionPrice = new Decimal(amountRealOut.toString())
      .div(10 ** reserveOutDecimals)
      .div(new Decimal(amountIn.toString()).div(10 ** reserveInDecimals));
    const priceImpact = currentPrice.isZero() ? 0 : executionPrice.sub(currentPrice).div(currentPrice).abs().toNumber();

    return {
      amountRealOut,

      amountIn,
      amountInWithoutFee,

      tradeFee: fee,
      priceImpact,
    };
  }
}
