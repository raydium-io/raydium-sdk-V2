import BN from "bn.js";
import Decimal from "decimal.js";
import { Q64 } from "./constantProductCurve";
import { MathLaunch } from "./func";
import { MaxU64 } from "@/raydium/clmm";
import { LaunchpadPoolInfo } from "../type";
import { CurveBase, PoolBaseAmount } from "./curveBase";
export class LinearPriceCurve extends CurveBase {
  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo | PoolBaseAmount;
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
    poolInfo: LaunchpadPoolInfo | PoolBaseAmount;
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
    poolInfo: LaunchpadPoolInfo;
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
  }): { a: BN; b: BN; c: BN } {
    const supplyMinusLocked = supply.sub(totalLockedAmount);
    if (supplyMinusLocked.lte(new BN(0))) throw Error("supplyMinusLocked need gt 0");
    const denominator = totalFundRaising.mul(new BN(3)).sub(migrateFee);
    const numerator = totalFundRaising.mul(new BN(2)).mul(supplyMinusLocked);

    const totalSellExpect = numerator.div(denominator);

    // if (!totalSell.eq(totalSellExpect)) throw Error("invalid input");

    const totalSellSquared = totalSellExpect.mul(totalSellExpect);
    const a = totalFundRaising.mul(new BN(2)).mul(Q64).div(totalSellSquared);

    if (!a.gt(new BN(0))) throw Error("a need gt 0");

    if (!MaxU64.gt(a)) throw Error("a need lt u64 max");

    return { a, b: new BN(0), c: totalSellExpect };
  }

  static buyExactIn({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    const newQuote = poolInfo.realB.add(amount);
    const termInsideSqrt = new BN(2).mul(newQuote).mul(Q64).div(poolInfo.virtualA);
    const sqrtTerm = new BN(new Decimal(termInsideSqrt.toString()).sqrt().toFixed(0));
    const amountOut = sqrtTerm.sub(poolInfo.realA);

    return amountOut;
  }

  static buyExactOut({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    const newBase = poolInfo.realA.add(amount);
    const newBaseSquared = newBase.mul(newBase);
    const { div: _newQuoteDiv, mod: _newQuoteMod } = poolInfo.virtualA.mul(newBaseSquared).divmod(new BN(2).mul(Q64));
    const newQuote = _newQuoteMod.isZero() ? _newQuoteDiv : _newQuoteDiv.add(new BN(1));
    return newQuote.sub(poolInfo.realB);
  }

  static sellExactIn({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    const newBase = poolInfo.realA.sub(amount);
    const newBaseSquared = newBase.mul(newBase);

    const { div: _newQuoteDiv, mod: _newQuoteMod } = poolInfo.virtualA.mul(newBaseSquared).divmod(new BN(2).mul(Q64));

    const newQuote = _newQuoteMod.isZero() ? _newQuoteDiv : _newQuoteDiv.add(new BN(1));

    return poolInfo.realB.sub(newQuote);
  }

  static sellExactOut({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    const newB = poolInfo.realB.sub(amount);
    const termInsideSqrt = new BN(2).mul(newB).mul(Q64).div(poolInfo.virtualA);

    const sqrtTerm = new BN(new Decimal(termInsideSqrt.toString()).sqrt().toFixed(0));

    const amountIn = poolInfo.realA.sub(sqrtTerm);

    return amountIn;
  }
}
