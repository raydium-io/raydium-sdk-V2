import BN from "bn.js";
import { LaunchpadPool } from "../layout";
import Decimal from "decimal.js";

export class CurveBase {
  static getPoolPrice({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode>;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    throw Error();
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
    throw Error();
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
  }): { a: BN; b: BN } {
    throw Error();
  }

  static buy({ poolInfo, amount }: { poolInfo: ReturnType<typeof LaunchpadPool.decode>; amount: BN }): BN {
    throw Error();
  }

  static buyExactOut({ poolInfo, amount }: { poolInfo: ReturnType<typeof LaunchpadPool.decode>; amount: BN }): BN {
    throw Error();
  }

  static sell({ poolInfo, amount }: { poolInfo: ReturnType<typeof LaunchpadPool.decode>; amount: BN }): BN {
    throw Error();
  }
}
