import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js-light";
import { ApiV3Token } from "../../../api/type";
import { BNDivCeil } from "../../../common";
import { ConstantProductCurve } from "./constantProduct";
import { CpmmFee as Fee } from "./fee";

export enum RoundDirection {
  Floor,
  Ceiling,
}

export type SwapWithoutFeesResult = { destinationAmountSwapped: BN };

export type TradingTokenResult = { tokenAmount0: BN; tokenAmount1: BN };

export type SwapResult = {
  newInputVaultAmount: BN;
  newOutputVaultAmount: BN;
  inputAmount: BN;
  outputAmount: BN;
  tradeFee: BN;
  protocolFee: BN;
  fundFee: BN;
  creatorFee: BN;
};

export enum TradeDirection {
  ZeroForOne,
  OneForZero,
}
export enum TradeDirectionOpposite {
  OneForZero,
  ZeroForOne,
}

export class CurveCalculator {
  static validate_supply(tokenAmount0: BN, tokenAmount1: BN): void {
    if (tokenAmount0.isZero()) throw Error("tokenAmount0 is zero");
    if (tokenAmount1.isZero()) throw Error("tokenAmount1 is zero");
  }

  static swapBaseInput(
    inputAmount: BN,
    inputVaultAmount: BN,
    outputVaultAmount: BN,
    tradeFeeRate: BN,
    creatorFeeRate: BN,
    protocolFeeRate: BN,
    fundFeeRate: BN,
    isCreatorFeeOnInput: boolean,
  ): SwapResult {
    let creatorFee = new BN(0);

    const tradeFee = Fee.tradingFee(inputAmount, tradeFeeRate);

    let inputAmountLessFees;
    if (isCreatorFeeOnInput) {
      creatorFee = Fee.creatorFee(inputAmount, creatorFeeRate);
      inputAmountLessFees = inputAmount.sub(tradeFee).sub(creatorFee);
    } else {
      inputAmountLessFees = inputAmount.sub(tradeFee);
    }

    const protocolFee = Fee.protocolFee(tradeFee, protocolFeeRate);
    const fundFee = Fee.protocolFee(tradeFee, fundFeeRate);

    const outputAmountSwapped = ConstantProductCurve.swapBaseInputWithoutFees(
      inputAmountLessFees,
      inputVaultAmount,
      outputVaultAmount,
    );

    let outputAmount;
    if (isCreatorFeeOnInput) {
      outputAmount = outputAmountSwapped;
    } else {
      creatorFee = Fee.creatorFee(outputAmountSwapped, creatorFeeRate);
      outputAmount = outputAmountSwapped.sub(creatorFee);
    }

    return {
      newInputVaultAmount: inputVaultAmount.add(inputAmountLessFees),
      newOutputVaultAmount: outputVaultAmount.sub(outputAmountSwapped),
      inputAmount,
      outputAmount,
      tradeFee,
      protocolFee,
      fundFee,
      creatorFee,
    };
  }

  static swapBaseOutput(
    outputAmount: BN,
    inputVaultAmount: BN,
    outputVaultAmount: BN,
    tradeFeeRate: BN,
    creatorFeeRate: BN,
    protocolFeeRate: BN,
    fundFeeRate: BN,
    isCreatorFeeOnInput: boolean,
  ): SwapResult {
    let tradeFee;
    let creatorFee = new BN(0);

    let actualOutputAmount;

    if (isCreatorFeeOnInput) {
      actualOutputAmount = outputAmount;
    } else {
      const outAmountWithCreatorFee = Fee.calculatePreFeeAmount(outputAmount, creatorFeeRate);
      creatorFee = outAmountWithCreatorFee.sub(outputAmount);
      actualOutputAmount = outAmountWithCreatorFee;
    }

    const inputAmountSwapped = ConstantProductCurve.swapBaseOutputWithoutFees(
      actualOutputAmount,
      inputVaultAmount,
      outputVaultAmount,
    );

    let inputAmount;
    if (isCreatorFeeOnInput) {
      const inputAmountWithFee = Fee.calculatePreFeeAmount(inputAmountSwapped, tradeFeeRate.add(creatorFeeRate));
      const totalFee = inputAmountWithFee.sub(inputAmountSwapped);
      creatorFee = Fee.splitCreatorFee(totalFee, tradeFeeRate, creatorFeeRate);
      tradeFee = totalFee.sub(creatorFee);
      inputAmount = inputAmountWithFee;
    } else {
      const inputAmountWithFee = Fee.calculatePreFeeAmount(inputAmountSwapped, tradeFeeRate);
      tradeFee = inputAmountWithFee.sub(inputAmountSwapped);
      inputAmount = inputAmountWithFee;
    }

    const protocolFee = Fee.protocolFee(tradeFee, protocolFeeRate);
    const fundFee = Fee.fundFee(tradeFee, fundFeeRate);

    return {
      newInputVaultAmount: inputVaultAmount.add(inputAmountSwapped),
      newOutputVaultAmount: outputAmount.sub(actualOutputAmount),
      inputAmount,
      outputAmount,
      tradeFee,
      protocolFee,
      fundFee,
      creatorFee,
    };
  }
}
