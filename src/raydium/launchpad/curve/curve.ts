import BN from "bn.js";
import { LaunchPadConstantProductCurve } from "./constantProductCurve";
import { FixedPriceCurve } from "./fixedPriceCurve";
import { CurveBase } from "./curveBase";
import { LaunchpadPoolInfo } from "../type";
import { FEE_RATE_DENOMINATOR_VALUE } from "@/common/fee";
import { LinearPriceCurve } from "./linearPriceCurve";
import { ceilDiv, floorDiv } from "@/common/bignumber";
import Decimal from "decimal.js";

export class Curve {
  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
    curveType,
  }: {
    poolInfo: LaunchpadPoolInfo;
    decimalA: number;
    decimalB: number;
    curveType: number;
  }) {
    const curve = this.getCurve(curveType);
    return curve.getPoolInitPriceByPool({ poolInfo, decimalA, decimalB });
  }
  static getPoolInitPriceByInit({
    a,
    b,
    decimalA,
    decimalB,
    curveType,
  }: {
    a: BN;
    b: BN;
    decimalA: number;
    decimalB: number;
    curveType: number;
  }) {
    const curve = this.getCurve(curveType);
    return curve.getPoolInitPriceByInit({ a, b, decimalA, decimalB });
  }

  static getPrice({
    poolInfo,
    curveType,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo;
    curveType: number;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    const curve = this.getCurve(curveType);
    return curve.getPoolPrice({ poolInfo, decimalA, decimalB });
  }

  static getEndPrice({
    poolInfo,
    curveType,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo;
    curveType: number;
    decimalA: number;
    decimalB: number;
  }) {
    const curve = this.getCurve(curveType);
    return curve.getPoolPrice({ poolInfo, decimalA, decimalB });
  }
  static getPoolEndPriceReal({
    poolInfo,
    curveType,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo;
    curveType: number;
    decimalA: number;
    decimalB: number;
  }) {
    const curve = this.getCurve(curveType);
    return curve.getPoolEndPriceReal({ poolInfo, decimalA, decimalB });
  }

  static buy({
    poolInfo,
    amountB,
    tradeFeeRate,
    curveType,
    shareFeeRate,
  }: {
    poolInfo: LaunchpadPoolInfo;
    amountB: BN;
    tradeFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
  }): {
    realAmountB: BN;
    amountA: BN;
    splitFee: {
      shareFee: BN;
      tradeFee: BN;
    };
  } {
    const feeRate = tradeFeeRate.add(shareFeeRate);
    const _tradeFee = this.calculateFee({ amount: amountB, feeRate });

    const amountLessFeeB = amountB.sub(_tradeFee);

    const curve = this.getCurve(curveType);

    const _amountA = curve.buy({ poolInfo, amount: amountLessFeeB });

    const remainingAmountA = poolInfo.totalSellA.sub(poolInfo.realA);

    let amountA: BN;
    let realAmountB: BN;
    let tradeFee: BN;
    if (_amountA.gt(remainingAmountA)) {
      amountA = remainingAmountA;
      const amountLessFeeB = poolInfo.totalFundRaisingB.sub(poolInfo.realB);
      realAmountB = this.calculatePreFee({ postFeeAmount: amountLessFeeB, feeRate });
      tradeFee = realAmountB.sub(amountLessFeeB);
    } else {
      amountA = _amountA;
      realAmountB = amountB;
      tradeFee = _tradeFee;
    }

    const splitFee = this.splitFee({ tradeFeeAll: tradeFee, tradeFeeRate, shareFeeRate });

    return { realAmountB, amountA, splitFee };
  }

  static sell({
    poolInfo,
    amountA,
    tradeFeeRate,
    curveType,
    shareFeeRate,
  }: {
    poolInfo: LaunchpadPoolInfo;
    amountA: BN;
    tradeFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
  }): {
    realAmountA: BN;
    amountB: BN;
    splitFee: {
      shareFee: BN;
      tradeFee: BN;
    };
  } {
    const curve = this.getCurve(curveType);

    const amountB = curve.sell({ poolInfo, amount: amountA });

    const tradeFee = this.calculateFee({ amount: amountB, feeRate: tradeFeeRate.add(shareFeeRate) });

    const splitFee = this.splitFee({ tradeFeeAll: tradeFee, tradeFeeRate, shareFeeRate });

    return { realAmountA: amountA, amountB: amountB.sub(tradeFee), splitFee };
  }

  static splitFee({
    tradeFeeAll,
    tradeFeeRate,
    shareFeeRate,
  }: {
    tradeFeeAll: BN;
    tradeFeeRate: BN;
    shareFeeRate: BN;
  }): { shareFee: BN; tradeFee: BN } {
    if (shareFeeRate.isZero()) return { shareFee: new BN(0), tradeFee: tradeFeeAll };

    const totalFeeRate = tradeFeeRate.add(shareFeeRate);

    const shareFee = floorDiv(tradeFeeAll, shareFeeRate, totalFeeRate);

    const tradeFee = tradeFeeAll.sub(shareFee);

    return { shareFee, tradeFee };
  }

  static calculateFee({ amount, feeRate }: { amount: BN; feeRate: BN }): BN {
    return ceilDiv(amount, feeRate, FEE_RATE_DENOMINATOR_VALUE);
  }
  static calculatePreFee({ postFeeAmount, feeRate }: { postFeeAmount: BN; feeRate: BN }): BN {
    if (feeRate.isZero()) return postFeeAmount;

    const numerator = postFeeAmount.mul(FEE_RATE_DENOMINATOR_VALUE);
    const denominator = FEE_RATE_DENOMINATOR_VALUE.sub(feeRate);

    return numerator.add(denominator).sub(new BN(1)).div(denominator);
  }

  static getCurve(curveType: number): typeof CurveBase {
    switch (curveType) {
      case 0:
        return LaunchPadConstantProductCurve;
      case 1:
        return FixedPriceCurve;
      case 2:
        return LinearPriceCurve;
    }
    throw Error("find curve error");
  }
}
