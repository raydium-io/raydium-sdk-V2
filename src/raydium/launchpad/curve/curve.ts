import { TransferFeeConfig } from "@solana/spl-token";
import BN from "bn.js";
import Decimal from "decimal.js";
import { GetTransferAmountFee } from "@/raydium/type";
import { getTransferAmountFeeFromPre, getTransferAmountFeeFromPost } from "@/common";
import { LaunchpadConfig, LaunchpadPool } from "../layout";
import { LaunchConstantProductCurve } from "./constantProductCurve";
import { CurveBase, PoolBaseAmount } from "./curveBase";
// import { ceilDiv, FEE_RATE_DENOMINATOR_VALUE } from "./fee";
import { ceilDiv, FEE_RATE_DENOMINATOR_VALUE } from "@/common";
import { FixedPriceCurve } from "./fixedPriceCurve";
import { LinearPriceCurve } from "./linearPriceCurve";

export interface SwapInfoReturn {
  amountA: GetTransferAmountFee;
  amountB: BN;
  splitFee: ReturnType<typeof Curve.splitFee>;
}

export class Curve {
  static getPoolCurvePointByPoolInfo({
    curveType,
    pointCount,
    poolInfo,
  }: {
    curveType: number;
    poolInfo: ReturnType<typeof LaunchpadPool.decode>;
    pointCount: number;
  }): {
    price: Decimal;
    totalSellSupply: number;
  }[] {
    return this.getPoolCurvePointByInit({
      curveType,
      pointCount,
      supply: poolInfo.supply,
      totalFundRaising: poolInfo.totalFundRaisingB,
      totalSell: poolInfo.totalSellA,
      totalLockedAmount: poolInfo.vestingSchedule.totalLockedAmount,
      migrateFee: poolInfo.migrateFee,
      decimalA: poolInfo.mintDecimalsA,
      decimalB: poolInfo.mintDecimalsB,
    });
  }
  static getPoolCurvePointByInit({
    curveType,
    pointCount,
    supply,
    totalFundRaising,
    totalSell,
    totalLockedAmount,
    migrateFee,
    decimalA,
    decimalB,
  }: {
    curveType: number;
    supply: BN;
    totalSell: BN;
    totalLockedAmount: BN;
    totalFundRaising: BN;
    migrateFee: BN;
    decimalA: number;
    decimalB: number;
    pointCount: number;
  }): {
    price: Decimal;
    totalSellSupply: number;
  }[] {
    if (pointCount < 3) throw Error("point count < 3");

    const curve = this.getCurve(curveType);
    const initParam = curve.getInitParam({ supply, totalFundRaising, totalSell, totalLockedAmount, migrateFee });
    const initPrice = curve.getPoolInitPriceByInit({ ...initParam, decimalA, decimalB });

    const itemStepBuy = totalFundRaising.div(new BN(pointCount - 1));

    const zero = new BN(0);

    const returnPoints: { price: Decimal; totalSellSupply: number }[] = [{ price: initPrice, totalSellSupply: 0 }];
    const { a, b } = initParam;
    let realA = zero;
    let realB = zero;
    for (let i = 1; i < pointCount; i++) {
      const amountB = i !== pointCount - 1 ? itemStepBuy : totalFundRaising.sub(realB);
      const itemBuy = this.buyExactIn({
        poolInfo: {
          virtualA: a,
          virtualB: b,
          realA,
          realB,
          totalFundRaisingB: totalFundRaising,
          totalSellA: totalSell,
        },
        amountB,
        protocolFeeRate: zero,
        platformFeeRate: zero,
        curveType,
        shareFeeRate: zero,
        creatorFeeRate: zero,
        transferFeeConfigA: undefined,
        slot: 0,
      });
      realA = realA.add(itemBuy.amountA.amount);
      realB = realB.add(itemBuy.amountB);

      const nowPoolPrice = this.getPrice({
        poolInfo: { virtualA: a, virtualB: b, realA, realB },
        decimalA,
        decimalB,
        curveType,
      });
      returnPoints.push({
        price: nowPoolPrice,
        totalSellSupply: new Decimal(realA.toString()).div(10 ** decimalA).toNumber(),
      });
    }

    return returnPoints;
  }

  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
    curveType,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
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
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | { virtualA: BN; virtualB: BN; realA: BN; realB: BN };
    decimalA: number;
    decimalB: number;
    curveType: number;
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
    poolInfo: ReturnType<typeof LaunchpadPool.decode>;
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
    poolInfo: ReturnType<typeof LaunchpadPool.decode>;
    curveType: number;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    const curve = this.getCurve(curveType);
    return curve.getPoolEndPriceReal({ poolInfo, decimalA, decimalB });
  }

  static checkParam({
    supply,
    totalFundRaising,
    totalSell,
    totalLockedAmount,
    decimals,
    config,
    migrateType,
  }: {
    supply: BN;
    totalSell: BN;
    totalLockedAmount: BN;
    totalFundRaising: BN;
    decimals: number;
    config: ReturnType<typeof LaunchpadConfig.decode>;
    migrateType: "amm" | "cpmm";
  }): void {
    if (Number(decimals) !== 6) throw Error("decimals = 6");
    const maxLockedA = supply.mul(config.maxLockRate).div(FEE_RATE_DENOMINATOR_VALUE);
    if (maxLockedA.lt(totalLockedAmount)) throw Error("total lock amount gte max lock amount");

    if (supply.lt(config.minSupplyA.mul(new BN(10 ** decimals)))) throw Error("supply lt min supply");

    const minSellA = supply.mul(config.minSellRateA).div(FEE_RATE_DENOMINATOR_VALUE);
    if (totalSell.lt(minSellA)) throw Error("invalid input");
    if (totalFundRaising.lt(config.minFundRaisingB)) throw Error("total fund raising lt min fund raising");

    const amountMigrate = supply.sub(totalSell).sub(totalLockedAmount);
    const minAmountMigrate = supply.mul(config.minMigrateRateA).div(FEE_RATE_DENOMINATOR_VALUE);

    if (amountMigrate.lt(minAmountMigrate)) throw Error("migrate lt min migrate amoount");

    const migrateAmountA = supply.sub(totalSell).sub(totalLockedAmount);
    const liquidity = new BN(new Decimal(migrateAmountA.mul(totalFundRaising).toString()).sqrt().toFixed(0));

    if (migrateType === "amm") {
      const minLockLp = new BN(10).pow(new BN(decimals));
      if (liquidity.lte(minLockLp)) throw Error("check migrate lp error");
    } else if (migrateType === "cpmm") {
      const minLockLp = new BN(100);
      if (liquidity.lte(minLockLp)) throw Error("check migrate lp error");
    } else {
      throw Error("migrate type error");
    }
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
    creatorFeeRate,
    transferFeeConfigA,
    slot,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | (PoolBaseAmount & { totalSellA: BN; totalFundRaisingB: BN });
    amountB: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
    creatorFeeRate: BN;

    transferFeeConfigA: TransferFeeConfig | undefined;
    slot: number;
  }): SwapInfoReturn {
    const feeRate = this.totalFeeRate({ protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });
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

      const amountLessFeeB = curve.buyExactOut({
        poolInfo,
        amount: amountA,
      });

      realAmountB = this.calculatePreFee({ postFeeAmount: amountLessFeeB, feeRate });
      totalFee = realAmountB.sub(amountLessFeeB);
    } else {
      amountA = _amountA;
      realAmountB = amountB;
      totalFee = _totalFee;
    }

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });

    return {
      amountA: getTransferAmountFeeFromPre(amountA, transferFeeConfigA, slot),
      amountB: realAmountB,
      splitFee,
    };
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
    creatorFeeRate,
    transferFeeConfigA,
    slot,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | (PoolBaseAmount & { totalSellA: BN; totalFundRaisingB: BN });
    amountA: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
    creatorFeeRate: BN;

    transferFeeConfigA: TransferFeeConfig | undefined;
    slot: number;
  }): SwapInfoReturn {
    const remainingAmountA = poolInfo.totalSellA.sub(poolInfo.realA);

    const preAmountA = getTransferAmountFeeFromPost(amountA, transferFeeConfigA, slot);
    let realAmountA = preAmountA.fee ? preAmountA.amount.add(preAmountA.fee) : preAmountA.amount;
    if (amountA.gt(remainingAmountA)) {
      realAmountA = remainingAmountA;
    }

    const curve = this.getCurve(curveType);
    const amountInLessFeeB = curve.buyExactOut({ poolInfo, amount: realAmountA });

    const totalFeeRate = this.totalFeeRate({ protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });

    const amountB = this.calculatePreFee({ postFeeAmount: amountInLessFeeB, feeRate: totalFeeRate });
    const totalFee = amountB.sub(amountInLessFeeB);

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });

    return { amountA: preAmountA, amountB, splitFee };
  }

  static sellExactIn({
    poolInfo,
    amountA: _amountA,
    protocolFeeRate,
    platformFeeRate,
    curveType,
    shareFeeRate,
    creatorFeeRate,
    transferFeeConfigA,
    slot,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amountA: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
    creatorFeeRate: BN;

    transferFeeConfigA: TransferFeeConfig | undefined;
    slot: number;
  }): SwapInfoReturn {
    const curve = this.getCurve(curveType);

    const amountInfoA = getTransferAmountFeeFromPre(_amountA, transferFeeConfigA, slot);
    const amountA = amountInfoA.fee ? amountInfoA.amount.sub(amountInfoA.fee) : amountInfoA.amount;

    const amountB = curve.sellExactIn({ poolInfo, amount: amountA });

    const totalFee = this.calculateFee({
      amount: amountB,
      feeRate: this.totalFeeRate({ protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate }),
    });

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });

    return { amountA: amountInfoA, amountB: amountB.sub(totalFee), splitFee };
  }

  static sellExactOut({
    poolInfo,
    amountB,
    protocolFeeRate,
    platformFeeRate,
    curveType,
    shareFeeRate,
    creatorFeeRate,
    transferFeeConfigA,
    slot,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amountB: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    curveType: number;
    shareFeeRate: BN;
    creatorFeeRate: BN;

    transferFeeConfigA: TransferFeeConfig | undefined;
    slot: number;
  }): SwapInfoReturn {
    const totalFeeRate = this.totalFeeRate({ protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });

    const amountOutWithFeeB = this.calculatePreFee({ postFeeAmount: amountB, feeRate: totalFeeRate });
    if (poolInfo.realB.lt(amountOutWithFeeB)) throw Error("Insufficient liquidity");

    const totalFee = amountOutWithFeeB.sub(amountB);

    const curve = Curve.getCurve(curveType);
    const amountA = curve.sellExactOut({ poolInfo, amount: amountOutWithFeeB });

    if (amountA.gt(poolInfo.realA)) throw Error();

    const splitFee = this.splitFee({ totalFee, protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });

    return { amountA: getTransferAmountFeeFromPost(amountA, transferFeeConfigA, slot), amountB, splitFee };
  }

  static splitFee({
    totalFee,
    protocolFeeRate,
    platformFeeRate,
    shareFeeRate,
    creatorFeeRate,
  }: {
    totalFee: BN;
    protocolFeeRate: BN;
    platformFeeRate: BN;
    shareFeeRate: BN;
    creatorFeeRate: BN;
  }): { platformFee: BN; shareFee: BN; protocolFee: BN; creatorFee: BN } {
    const totalFeeRate = this.totalFeeRate({ protocolFeeRate, platformFeeRate, shareFeeRate, creatorFeeRate });
    const platformFee = totalFeeRate.isZero() ? new BN(0) : totalFee.mul(platformFeeRate).div(totalFeeRate);
    const shareFee = totalFeeRate.isZero() ? new BN(0) : totalFee.mul(shareFeeRate).div(totalFeeRate);
    const creatorFee = totalFeeRate.isZero() ? new BN(0) : totalFee.mul(creatorFeeRate).div(totalFeeRate);

    const protocolFee = totalFee.sub(platformFee).sub(shareFee).sub(creatorFee);

    return { platformFee, shareFee, protocolFee, creatorFee };
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

  static totalFeeRate({
    protocolFeeRate,
    platformFeeRate,
    shareFeeRate,
    creatorFeeRate,
  }: {
    protocolFeeRate: BN;
    platformFeeRate: BN;
    shareFeeRate: BN;
    creatorFeeRate: BN;
  }): BN {
    const totalFeeRate = protocolFeeRate.add(platformFeeRate).add(shareFeeRate).add(creatorFeeRate);
    if (totalFeeRate.gt(new BN(1_000_000))) throw Error("total fee rate gt 1_000_000");
    return protocolFeeRate.add(platformFeeRate).add(shareFeeRate).add(creatorFeeRate);
  }

  static getCurve(curveType: number): typeof CurveBase {
    switch (curveType) {
      case 0:
        return LaunchConstantProductCurve;
      case 1:
        return FixedPriceCurve;
      case 2:
        return LinearPriceCurve;
    }
    throw Error("find curve error");
  }
}
