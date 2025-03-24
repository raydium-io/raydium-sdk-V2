import BN from "bn.js";
import Decimal from "decimal.js";

export class MathLaunch {
  static _Q64 = new Decimal(new BN(1).shln(64).toString());

  static _multipler(decimals: number): Decimal {
    return new Decimal(10).pow(decimals);
  }

  static getPrice({ priceX64, decimalA, decimalB }: { priceX64: BN; decimalA: number; decimalB: number }): Decimal {
    const priceWithDecimals = new Decimal(priceX64.toString()).div(this._Q64);
    const price = priceWithDecimals.mul(this._multipler(decimalA)).div(this._multipler(decimalB));

    return price;
  }

  static getPriceX64({ price, decimalA, decimalB }: { price: Decimal; decimalA: number; decimalB: number }): BN {
    const priceWithDecimals = price.mul(this._multipler(decimalB)).div(this._multipler(decimalA));
    const priceX64 = new BN(priceWithDecimals.mul(this._Q64).toFixed(0));
    return priceX64;
  }
}

export function checkPoolToAmm({
  supply,
  totalFundRaisingB,
  totalLockedAmount,
  totalSellA,
  migrateType,
  decimalsA,
}: {
  supply: BN;
  totalSellA: BN;
  totalLockedAmount: BN;
  totalFundRaisingB: BN;
  migrateType: "amm" | "cpmm";
  decimalsA: number;
}): boolean {
  const migrateAmountA = supply.sub(totalSellA).sub(totalLockedAmount);
  const liquidity = new BN(new Decimal(migrateAmountA.mul(totalFundRaisingB).toString()).sqrt().toFixed(0));

  if (migrateType === "amm") {
    if (liquidity.gt(new BN(10).pow(new BN(decimalsA)))) return true;
  } else if (migrateType === "cpmm") {
    if (liquidity.gt(new BN(100))) return true;
  } else {
    throw Error("migrate type error");
  }

  return false;
}
