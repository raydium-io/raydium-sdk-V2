import BN from "bn.js";
import Decimal from "decimal.js";
import { BNDivCeil } from "@/common";
import { CurveBase } from "./curveBase";
import { Q64 } from "@/raydium/clmm";
import { LaunchpadPoolInfo } from "../type";

export { Q64 };

export class LaunchPadConstantProductCurve extends CurveBase {
  static getPoolPrice({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    return new Decimal(poolInfo.virtualB.add(poolInfo.realB).toString())
      .div(poolInfo.virtualA.sub(poolInfo.realA).toString())
      .mul(10 ** (decimalA - decimalB));
  }
  static getPoolEndPrice({
    initPriceX64,
    supply,
    totalSell,
    totalLockedAmount,
    totalFundRaising,
    migrateFee,
    decimalA,
    decimalB,
  }: {
    initPriceX64: BN;
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

  static getInitParam({
    initPriceX64,
    supply,
    totalFundRaising,
    totalSell,
    totalLockedAmount,
    migrateFee,
  }: {
    initPriceX64: BN;
    supply: BN;
    totalSell: BN;
    totalLockedAmount: BN;
    totalFundRaising: BN;
    migrateFee: BN;
  }) {
    if (supply.lte(totalSell)) throw Error("supply need gt total sell");
    const supplyMinusSellLocked = supply.sub(totalSell).sub(totalLockedAmount);
    if (supplyMinusSellLocked.lte(new BN(0))) throw Error("supplyMinusSellLocked <= 0");

    const tfMinusMf = totalFundRaising.sub(migrateFee);
    if (tfMinusMf.lte(new BN(0))) throw Error("tfMinusMf <= 0");

    const migratePriceX64 = tfMinusMf.mul(Q64).div(supplyMinusSellLocked);

    const numerator = migratePriceX64.mul(totalSell).mul(totalSell).div(Q64);
    const denominator = migratePriceX64.mul(totalSell).div(Q64).sub(totalFundRaising);

    const x0 = numerator.div(denominator);
    const y0 = totalFundRaising.mul(totalFundRaising).div(denominator);

    return {
      a: x0,
      b: y0,
    };
  }

  static buy({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo; amount: BN }): BN {
    return this.getAmountOut({
      amountIn: amount,
      inputReserve: poolInfo.virtualB.add(poolInfo.realB),
      outputReserve: poolInfo.virtualA.sub(poolInfo.realA),
    });
  }

  static buyExactOut({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo; amount: BN }): BN {
    return this.getAmountIn({
      amountOut: amount,
      inputReserve: poolInfo.virtualB.add(poolInfo.realB),
      outputReserve: poolInfo.virtualA.sub(poolInfo.realA),
    });
  }

  static sell({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo; amount: BN }): BN {
    return this.getAmountOut({
      amountIn: amount,
      inputReserve: poolInfo.virtualA.sub(poolInfo.realA),
      outputReserve: poolInfo.virtualB.add(poolInfo.realB),
    });
  }

  static getAmountOut({
    amountIn,
    inputReserve,
    outputReserve,
  }: {
    amountIn: BN;
    inputReserve: BN;
    outputReserve: BN;
  }) {
    const numerator = amountIn.mul(outputReserve);
    const denominator = inputReserve.add(amountIn);
    const amountOut = numerator.div(denominator);
    return amountOut;
  }
  static getAmountIn({
    amountOut,
    inputReserve,
    outputReserve,
  }: {
    amountOut: BN;
    inputReserve: BN;
    outputReserve: BN;
  }) {
    const numerator = inputReserve.mul(amountOut);
    const denominator = outputReserve.sub(amountOut);
    const amountIn = BNDivCeil(numerator, denominator);
    return amountIn;
  }
}
