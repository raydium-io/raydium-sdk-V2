import BN from "bn.js";
import Decimal from "decimal.js";
import { LaunchpadPool } from "../layout";
import { CurveBase, PoolBaseAmount } from "./curveBase";
// import { ceilDivBN } from "./fee";
import { ceilDivBN } from "@/common";

export class FixedPriceCurve extends CurveBase {
  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    return new Decimal(poolInfo.virtualB.toString()).div(poolInfo.virtualA.toString()).mul(10 ** (decimalA - decimalB));
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
    return new Decimal(b.toString()).div(a.toString()).mul(10 ** (decimalA - decimalB));
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
    return new Decimal(poolInfo.virtualB.toString()).div(poolInfo.virtualA.toString()).mul(10 ** (decimalA - decimalB));
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
    totalFundRaising: BN;
    totalLockedAmount: BN;
    migrateFee: BN;
  }) {
    const supplyMinusLocked = supply.sub(totalLockedAmount);

    if (supplyMinusLocked.lte(new BN(0))) throw Error("invalid input 1");

    const denominator = new BN(2).mul(totalFundRaising).sub(migrateFee);
    const numerator = totalFundRaising.mul(supplyMinusLocked);
    const totalSellExpect = numerator.div(denominator);

    // if (!totalSell.eq(totalSellExpect)) throw Error('invalid input 2')

    if (totalSellExpect.lt(new BN(0)) || totalFundRaising.lt(new BN(0))) throw Error("invalid input 0");

    return { a: totalSellExpect, b: totalFundRaising, c: totalSellExpect };
  }

  static buyExactIn({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    return this.getAmountOut({ amountIn: amount, initInput: poolInfo.virtualB, initOutput: poolInfo.virtualA });
  }

  static buyExactOut({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    return this.getAmountIn({ amountOut: amount, initInput: poolInfo.virtualB, initOutput: poolInfo.virtualA });
  }

  static sellExactIn({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    return this.getAmountOut({ amountIn: amount, initInput: poolInfo.virtualA, initOutput: poolInfo.virtualB });
  }

  static sellExactOut({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    return this.getAmountIn({ amountOut: amount, initInput: poolInfo.virtualA, initOutput: poolInfo.virtualB });
  }

  static getAmountOut({ amountIn, initInput, initOutput }: { amountIn: BN; initInput: BN; initOutput: BN }) {
    const numerator = initOutput.mul(amountIn);
    const amountOut = numerator.div(initInput);
    return amountOut;
  }

  static getAmountIn({ amountOut, initInput, initOutput }: { amountOut: BN; initInput: BN; initOutput: BN }) {
    const numerator = initInput.mul(amountOut);
    const amountIn = ceilDivBN(numerator, initOutput);
    return amountIn;
  }
}
