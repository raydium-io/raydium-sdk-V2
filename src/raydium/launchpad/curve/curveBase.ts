import BN from "bn.js";
import { LaunchpadPool } from "../layout";
import Decimal from "decimal.js";
import { LaunchpadPoolInfo } from "../type";

export interface PoolBaseAmount {
  virtualA: BN;
  virtualB: BN;
  realA: BN;
  realB: BN;
}

export class CurveBase {
  static getPoolInitPriceByPool({
    poolInfo,
    decimalA,
    decimalB,
  }: {
    poolInfo: LaunchpadPoolInfo | PoolBaseAmount;
    decimalA: number;
    decimalB: number;
  }): Decimal {
    throw Error();
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
    throw Error();
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
    throw Error();
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
    throw Error();
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
    throw Error();
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
    throw Error();
  }

  static buyExactIn({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    throw Error();
  }

  static buyExactOut({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    throw Error();
  }

  static sellExactIn({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    throw Error();
  }
  static sellExactOut({ poolInfo, amount }: { poolInfo: LaunchpadPoolInfo | PoolBaseAmount; amount: BN }): BN {
    throw Error();
  }
}
