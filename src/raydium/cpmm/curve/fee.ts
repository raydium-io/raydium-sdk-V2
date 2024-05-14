import BN from "bn.js";

export const FEE_RATE_DENOMINATOR_VALUE = new BN(1_000_000);

export function ceilDiv(tokenAmount: BN, feeNumerator: BN, feeDenominator: BN): BN {
  return tokenAmount.mul(feeNumerator).add(feeDenominator).sub(new BN(1)).div(feeDenominator);
}

export function floorDiv(tokenAmount: BN, feeNumerator: BN, feeDenominator: BN): BN {
  return tokenAmount.mul(feeNumerator).div(feeDenominator);
}

export class CpmmFee {
  static tradingFee(amount: BN, tradeFeeRate: BN): BN {
    return ceilDiv(amount, tradeFeeRate, FEE_RATE_DENOMINATOR_VALUE);
  }
  static protocolFee(amount: BN, protocolFeeRate: BN): BN {
    return floorDiv(amount, protocolFeeRate, FEE_RATE_DENOMINATOR_VALUE);
  }
  static fundFee(amount: BN, fundFeeRate: BN): BN {
    return floorDiv(amount, fundFeeRate, FEE_RATE_DENOMINATOR_VALUE);
  }
}
