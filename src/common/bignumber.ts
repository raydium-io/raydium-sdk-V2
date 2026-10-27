import BN from "bn.js";
import Decimal from "decimal.js";
import { CurrencyAmount, TokenAmount } from "../module/amount";
import { Currency } from "../module/currency";
import { Fraction } from "../module/fraction";
import { Percent } from "../module/percent";
import { Price } from "../module/price";
import { Token } from "../module/token";
import { SplToken, TokenJson } from "../raydium/token/type";
import { parseBigNumberish } from "./constant";
import { BN_ZERO } from "@/raydium";

export const BN_TWO = new BN(2);
export const BN_THREE = new BN(3);
export const BN_FIVE = new BN(5);
export const BN_TEN = new BN(10);
export const BN_100 = new BN(100);
export const BN_1000 = new BN(1000);
export const BN_10000 = new BN(10000);
export type BigNumberish = BN | string | number | bigint;
export type Numberish = number | string | bigint | Fraction | BN;

export function tenExponential(shift: BigNumberish): BN {
  return BN_TEN.pow(parseBigNumberish(shift));
}

// round up
export function divCeil(a: BN, b: BN): BN {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const dm = a.divmod(b);

  // Fast case - exact division
  if (dm.mod.isZero()) return dm.div;

  if (a.isNeg() === b.isNeg()) {
    return dm.div.iaddn(1);
  } else {
    return dm.div; // 負數截尾後本身就是 Ceil 值
  }
}

export function ceilDiv(tokenAmount: BN, feeNumerator: BN, feeDenominator: BN): BN {
  return tokenAmount.mul(feeNumerator).add(feeDenominator).sub(new BN(1)).div(feeDenominator);
}

export function floorDiv(tokenAmount: BN, feeNumerator: BN, feeDenominator: BN): BN {
  return tokenAmount.mul(feeNumerator).div(feeDenominator);
}

export function isDecimal(val: unknown): boolean {
  return val instanceof Decimal;
}
