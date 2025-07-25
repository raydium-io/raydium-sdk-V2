import BN from "bn.js";
import { LaunchpadPool } from "../layout";
import Decimal from "decimal.js";

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
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
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
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | { virtualA: BN; virtualB: BN; realA: BN; realB: BN };
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
    poolInfo: ReturnType<typeof LaunchpadPool.decode>;
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

  static buyExactIn({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    throw Error();
  }

  static buyExactOut({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    throw Error();
  }

  static sellExactIn({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    throw Error();
  }

  static sellExactOut({
    poolInfo,
    amount,
  }: {
    poolInfo: ReturnType<typeof LaunchpadPool.decode> | PoolBaseAmount;
    amount: BN;
  }): BN {
    throw Error();
  }
}
