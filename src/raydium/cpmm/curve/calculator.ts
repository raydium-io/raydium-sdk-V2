import BN from "bn.js";
import { CpmmFee } from "./fee";
import { ConstantProductCurve } from "./constantProduct";

export enum RoundDirection {
  Floor,
  Ceiling,
}

export type SwapWithoutFeesResult = { sourceAmountSwapped: BN; destinationAmountSwapped: BN };

export type TradingTokenResult = { tokenAmount0: BN; tokenAmount1: BN };

export type SwapResult = {
  newSwapSourceAmount: BN;
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

    const { sourceAmountSwapped, destinationAmountSwapped } = ConstantProductCurve.swapWithoutFees(
      sourceAmountLessFees,
      swapSourceAmount,
      swapDestinationAmount,
    );

    const _sourceAmountSwapped = sourceAmountSwapped.add(tradeFee);
    return {
      newSwapSourceAmount: swapSourceAmount.add(_sourceAmountSwapped),
      newSwapDestinationAmount: swapDestinationAmount.sub(destinationAmountSwapped),
      sourceAmountSwapped: _sourceAmountSwapped,
      destinationAmountSwapped,
      tradeFee,
    };
  }
}
