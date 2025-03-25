import BN from "bn.js";
import Decimal from "decimal.js";
import { CurveBase } from "./curveBase";
import { LaunchpadPoolInfo } from "../type";

export class FixedPriceCurve extends CurveBase {
  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo;
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
    poolInfo: LaunchpadPoolInfo;
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
    poolInfo: LaunchpadPoolInfo;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    const allSellToken = poolInfo.totalSellA.sub(poolInfo.realA);
    const buyAllTokenUseB = allSellToken.isZero()
      ? new BN(0)
      : this.buyExactOut({
          amount: poolInfo.totalSellA.sub(poolInfo.realA),
          poolInfo,
        });

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
  }): { a: BN; b: BN } {
    if (supply.lte(totalSell.add(totalLockedAmount))) throw Error("supply need gt totalSell");
    if (totalFundRaising.lte(migrateFee)) throw Error("totalFundRaising need gt migrateFee");
    return {
      a: supply.sub(totalSell).sub(totalLockedAmount),
      b: totalFundRaising.sub(migrateFee),
    };
  }

  static buy({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo; amount: BN }): BN {
    return this.getAmountOut({ amountIn: amount, initInput: poolInfo.virtualB, initOutput: poolInfo.virtualA });
  }

  static buyExactOut({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo; amount: BN }): BN {
    return this.getAmountIn({ amountOut: amount, initInput: poolInfo.virtualB, initOutput: poolInfo.virtualA });
  }

  static sell({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo; amount: BN }): BN {
    return this.getAmountOut({ amountIn: amount, initInput: poolInfo.virtualA, initOutput: poolInfo.virtualB });
  }

  static getAmountOut({ amountIn, initInput, initOutput }: { amountIn: BN; initInput: BN; initOutput: BN }): BN {
    const numerator = initOutput.mul(amountIn);
    const amountOut = numerator.div(initInput);
    return amountOut;
  }

  static getAmountIn({ amountOut, initInput, initOutput }: { amountOut: BN; initInput: BN; initOutput: BN }): BN {
    const numerator = initInput.mul(amountOut);
    const amountIn = numerator.div(initOutput);
    return amountIn;
  }
}
