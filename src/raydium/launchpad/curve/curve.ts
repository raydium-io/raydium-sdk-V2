import BN from "bn.js";
import { LaunchPadConstantProductCurve } from "./constantProductCurve";
import { FixedPriceCurve } from "./fixedPriceCurve";
import { CurveBase } from "./curveBase";
import { LaunchpadPoolInfo } from "../type";
import { FEE_RATE_DENOMINATOR_VALUE } from "@/common/fee";
import { LinearPriceCurve } from "./linearPriceCurve";
import { ceilDiv } from "@/common/bignumber";
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
  }): Decimal {
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
  }): Decimal {
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
  }): Decimal {
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
  }): Decimal {
    const curve = this.getCurve(curveType);
    return curve.getPoolEndPriceReal({ poolInfo, decimalA, decimalB });
  }

  /**
   * @returns Please note that amountA/B is subject to change
   */
  static buyExactIn({
    poolInfo,
    amountB,
    protocolFeeRate,
    platformFeeRate,
    curveType,
    shareFeeRate,
  }: {
    poolInfo: LaunchpadPoolInfo;
    amountB: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
  }): {
    amountA: BN;
    amountB: BN;
    splitFee: { platformFee: BN; shareFee: BN; protocolFee: BN };
  } {
    const feeRate = protocolFeeRate.add(shareFeeRate).add(platformFeeRate);
    const _totalFee = this.calculateFee({ amount: amountB, feeRate });

    const amountLessFeeB = amountB.sub(_totalFee);

    const curve = this.getCurve(curveType);

    const _amountA = curve.buyExactIn({ poolInfo, amount: amountLessFeeB });

    const remainingAmountA = poolInfo.totalSellA.sub(poolInfo.realA);

    let amountA: BN;
    let realAmountB: BN;
    let totalFee: BN;
    if (_amountA.gt(remainingAmountA)) {
      amountA = remainingAmountA;
      const amountLessFeeB = poolInfo.totalFundRaisingB.sub(poolInfo.realB);

      realAmountB = this.calculatePreFee({ postFeeAmount: amountLessFeeB, feeRate });
      totalFee = realAmountB.sub(amountLessFeeB);
    } else {
      amountA = _amountA;
      realAmountB = amountB;
      totalFee = _totalFee;
    }

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate });

    return { amountA, amountB: realAmountB, splitFee };
  }

  /**
   * @returns Please note that amountA/B is subject to change
   */
  static buyExactOut({
    poolInfo,
    amountA,
    protocolFeeRate,
    platformFeeRate,
    curveType,
    shareFeeRate,
  }: {
    poolInfo: LaunchpadPoolInfo;
    amountA: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
  }): {
    amountA: BN;
    amountB: BN;
    splitFee: { platformFee: BN; shareFee: BN; protocolFee: BN };
  } {
    const remainingAmountA = poolInfo.totalSellA.sub(poolInfo.realA);

    let realAmountA = amountA;
    let amountInLessFeeB;
    if (amountA.gte(remainingAmountA)) {
      realAmountA = remainingAmountA;
      amountInLessFeeB = poolInfo.totalFundRaisingB.sub(poolInfo.realB);
    } else {
      const curve = this.getCurve(curveType);
      amountInLessFeeB = curve.buyExactOut({ poolInfo, amount: amountA });
    }

    const totalFeeRate = protocolFeeRate.add(shareFeeRate).add(platformFeeRate);

    const amountB = this.calculatePreFee({ postFeeAmount: amountInLessFeeB, feeRate: totalFeeRate });
    const totalFee = amountB.sub(amountInLessFeeB);

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate });

    return { amountA: realAmountA, amountB, splitFee };
  }

  static sellExactIn({
    poolInfo,
    amountA,
    protocolFeeRate,
    platformFeeRate,
    curveType,
    shareFeeRate,
  }: {
    poolInfo: LaunchpadPoolInfo;
    amountA: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
  }): {
    amountA: BN;
    amountB: BN;
    splitFee: { platformFee: BN; shareFee: BN; protocolFee: BN };
  } {
    const curve = this.getCurve(curveType);

    const amountB = curve.sellExactIn({ poolInfo, amount: amountA });
    const totalFee = this.calculateFee({
      amount: amountB,
      feeRate: protocolFeeRate.add(shareFeeRate).add(platformFeeRate),
    });

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate });

    return { amountA, amountB: amountB.sub(totalFee), splitFee };
  }

  static sellExactOut({
    poolInfo,
    amountB,
    protocolFeeRate,
    platformFeeRate,
    curveType,
    shareFeeRate,
  }: {
    poolInfo: LaunchpadPoolInfo;
    amountB: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
  }): {
    amountA: BN;
    amountB: BN;
    splitFee: { platformFee: BN; shareFee: BN; protocolFee: BN };
  } {
    const totalFeeRate = protocolFeeRate.add(shareFeeRate).add(platformFeeRate);

    const amountOutWithFeeB = this.calculatePreFee({ postFeeAmount: amountB, feeRate: totalFeeRate });
    if (poolInfo.realB.lt(amountOutWithFeeB)) throw Error("Insufficient liquidity");

    const totalFee = amountOutWithFeeB.sub(amountB);

    const curve = Curve.getCurve(curveType);
    const amountA = curve.sellExactOut({ poolInfo, amount: amountB });

    if (amountA.gt(poolInfo.realA)) throw Error();

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate });

    return { amountA, amountB, splitFee };
  }

  static splitFee({
    totalFee,
    protocolFeeRate,
    platformFeeRate,
    shareFeeRate,
  }: {
    totalFee: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    shareFeeRate: BN;
  }): { platformFee: BN; shareFee: BN; protocolFee: BN } {
    const totalFeeRate = protocolFeeRate.add(platformFeeRate).add(shareFeeRate);
    const platformFee = totalFeeRate.isZero() ? new BN(0) : totalFee.mul(platformFeeRate).div(totalFeeRate);
    const shareFee = totalFeeRate.isZero() ? new BN(0) : totalFee.mul(shareFeeRate).div(totalFeeRate);
    const protocolFee = totalFee.sub(platformFee).sub(shareFee);

    return { platformFee, shareFee, protocolFee };
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
