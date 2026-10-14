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
    const totalRate = tradeFeeRate.add(creatorFeeRate);
    // With both rates at zero there is no fee to split; dividing by the zero
    // total rate would throw an opaque BN assertion instead of returning 0.
    if (totalRate.isZero()) return new BN(0);
    return floorDiv(totalFee, creatorFeeRate, totalRate);
  }

  static calculatePreFeeAmount(postFeeAmount: BN, tradeFeeRate: BN): BN {
    if (tradeFeeRate.isZero()) return postFeeAmount;
    // The gross-up divides by (denominator - rate): at a 100% rate the pre-fee
    // amount is undefined, and past it the formula returns negative amounts.
    if (tradeFeeRate.gte(FEE_RATE_DENOMINATOR_VALUE))
      throw Error("tradeFeeRate must be less than the fee rate denominator");

    const numerator = postFeeAmount.mul(FEE_RATE_DENOMINATOR_VALUE);
    const denominator = FEE_RATE_DENOMINATOR_VALUE.sub(tradeFeeRate);

    return numerator.add(denominator).sub(new BN(1)).div(denominator);
  }
}
