import BN from "bn.js";
import Decimal from "decimal.js";
import { LaunchpadPool } from "../layout";
import { Q64 } from "@/raydium/clmm";
import { CurveBase, PoolBaseAmount } from "./curveBase";
// import { ceilDivBN } from "./fee";
import { ceilDivBN } from "@/common";
import { MathLaunch } from "./func";
import { MaxU64 } from "@/raydium/clmm";

export class LinearPriceCurve extends CurveBase {
  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    return new Decimal(0);
  }
  static getPoolInitPriceByInit({
    a,
    b,
    decimalA,
    decimalB,
  }: {
    a: BN;
    b: BN;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    return new Decimal(0);
  }
  static getPoolPrice({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | { virtualA: BN; virtualB: BN; realA: BN; realB: BN };
    decimalA: number;
    decimalB: number;
  }): Decimal {
    return new Decimal(poolInfo.virtualA.mul(poolInfo.realA).toString())
      .div(MathLaunch._Q64)
      .mul(10 ** (decimalA - decimalB));
  }
  static getPoolEndPrice({
    supply,
    totalSell,
    totalLockedAmount,
    totalFundRaising,
    migrateFee,
    decimalA,
    decimalB,
  }: {
    supply: BN;
    totalSell: BN;
    totalLockedAmount: BN;
    totalFundRaising: BN;
    migrateFee: BN;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    return new Decimal(totalFundRaising.sub(migrateFee).toString())
      .div(supply.sub(totalSell).sub(totalLockedAmount).toString())
      .mul(10 ** (decimalA - decimalB));
  }
  static getPoolEndPriceReal({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode>;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    const allSellToken = poolInfo.totalSellA.sub(poolInfo.realA);
    const buyAllTokenUseB = poolInfo.totalFundRaisingB.sub(poolInfo.realB);

    return new Decimal(poolInfo.virtualB.add(poolInfo.realB).add(buyAllTokenUseB).toString())
      .div(poolInfo.virtualA.sub(poolInfo.realA).add(allSellToken).toString())
      .mul(10 ** (decimalA - decimalB));
  }

  static getInitParam({
    supply,
    totalFundRaising,
    totalSell,
    totalLockedAmount,
    migrateFee,
  }: {
    supply: BN;
    totalSell: BN;
    totalLockedAmount: BN;
    totalFundRaising: BN;
    migrateFee: BN;
  }) {
    const supplyMinusLocked = supply.sub(totalLockedAmount);
    if (supplyMinusLocked.lte(new BN(0))) throw Error("supplyMinusLocked need gt 0");
    const denominator = totalFundRaising.mul(new BN(3)).sub(migrateFee);
    const numerator = totalFundRaising.mul(new BN(2)).mul(supplyMinusLocked);

    const totalSellExpect = numerator.div(denominator);

    // if (!totalSell.eq(totalSellExpect)) throw Error('invalid input')

    const totalSellSquared = totalSellExpect.mul(totalSellExpect);
    const a = totalFundRaising.mul(new BN(2)).mul(Q64).div(totalSellSquared);

    if (!a.gt(new BN(0))) throw Error("a need gt 0");

    if (!MaxU64.gt(a)) throw Error("a need lt u64 max");

    if (a.lt(new BN(0)) || totalSellExpect.lt(new BN(0))) throw Error("invalid input 0");

    return { a, b: new BN(0), c: totalSellExpect };
  }

  static buyExactIn({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    const newQuote = poolInfo.realB.add(amount);
    const termInsideSqrt = new BN(2).mul(newQuote).mul(Q64).div(poolInfo.virtualA);
    const sqrtTerm = new BN(new Decimal(termInsideSqrt.toString()).sqrt().toFixed(0));
    const amountOut = sqrtTerm.sub(poolInfo.realA);

    return amountOut;
  }

  static buyExactOut({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    const newBase = poolInfo.realA.add(amount);
    const newBaseSquared = newBase.mul(newBase);
    const newQuote = ceilDivBN(poolInfo.virtualA.mul(newBaseSquared), new BN(2).mul(Q64));
    return newQuote.sub(poolInfo.realB);
  }

  static sellExactIn({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    const newBase = poolInfo.realA.sub(amount);
    const newBaseSquared = newBase.mul(newBase);
    const newQuote = ceilDivBN(poolInfo.virtualA.mul(newBaseSquared), new BN(2).mul(Q64));
    return poolInfo.realB.sub(newQuote);
  }

  static sellExactOut({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    const newB = poolInfo.realB.sub(amount);
    const termInsideSqrt = new BN(2).mul(newB).mul(Q64).div(poolInfo.virtualA);

    const sqrtTerm = new BN(new Decimal(termInsideSqrt.toString()).sqrt().toFixed(0));

    const amountIn = poolInfo.realA.sub(sqrtTerm);

    return amountIn;
  }
}
