import BN from "bn.js";
import { ceilDiv, floorDiv } from "@/common/bignumber";
import { FEE_RATE_DENOMINATOR_VALUE } from "@/common/fee";

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

  static creatorFee(amount: BN, creatorFeeRate: BN): BN {
    return ceilDiv(amount, creatorFeeRate, FEE_RATE_DENOMINATOR_VALUE);
  }

  static splitCreatorFee(totalFee: BN, tradeFeeRate: BN, creatorFeeRate: BN): BN {
    return floorDiv(totalFee, creatorFeeRate, tradeFeeRate.add(creatorFeeRate));
  }

  static calculatePreFeeAmount(postFeeAmount: BN, tradeFeeRate: BN): BN {
    if (tradeFeeRate.isZero()) return postFeeAmount;

    const numerator = postFeeAmount.mul(FEE_RATE_DENOMINATOR_VALUE);
    const denominator = FEE_RATE_DENOMINATOR_VALUE.sub(tradeFeeRate);

    return numerator.add(denominator).sub(new BN(1)).div(denominator);
  }
}
