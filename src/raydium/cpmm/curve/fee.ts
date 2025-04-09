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
}
