import BN from "bn.js"
import { divRoundingUp, mulDivCeil, mulDivFloor } from "./bigNum"
import { BN_ONE, BN_ZERO, Q64, RESOLUTION } from "./constants"

export class SqrtPriceMath {
  static getNextSqrtPriceFromAmountARoundingUp(
    sqrtPriceX64: BN,
    liquidity: BN,
    amount: BN,
    add: boolean
  ): BN {
    if (amount.isZero()) {
      return sqrtPriceX64
    }

    const numerator = liquidity.shln(RESOLUTION)

    if (add) {
      const product = amount.mul(sqrtPriceX64)

      const denominator = numerator.add(product)

      if (denominator.gte(numerator)) {
        return mulDivCeil(numerator, sqrtPriceX64, denominator)
      }

      const quotient = mulDivFloor(numerator, BN_ONE, sqrtPriceX64)
      return mulDivCeil(numerator, BN_ONE, quotient.add(amount))
    } else {
      const product = amount.mul(sqrtPriceX64)

      if (numerator.lte(product)) {
        throw new Error("Insufficient liquidity for token0 removal")
      }

      const denominator = numerator.sub(product)

      return mulDivCeil(numerator, sqrtPriceX64, denominator)
    }
  }

  static getNextSqrtPriceFromAmountBRoundingDown(
    sqrtPriceX64: BN,
    liquidity: BN,
    amount: BN,
    add: boolean
  ): BN {
    if (amount.isZero()) {
      return sqrtPriceX64
    }

    if (add) {
      const quotient = amount.shln(RESOLUTION).div(liquidity)
      return sqrtPriceX64.add(quotient)
    } else {
      const quotient = divRoundingUp(amount.shln(RESOLUTION), liquidity)
      return sqrtPriceX64.sub(quotient)
    }
  }

  static getNextSqrtPriceFromInput(
    sqrtPriceX64: BN,
    liquidity: BN,
    amountIn: BN,
    zeroForOne: boolean
  ): BN {
    if (!sqrtPriceX64.gt(BN_ZERO)) throw Error('sqrtPriceX64.gt(BN_ZERO)')
    if (!liquidity.gt(BN_ZERO)) throw Error('liquidity.gt(BN_ZERO)')

    if (zeroForOne) {
      return this.getNextSqrtPriceFromAmountARoundingUp(sqrtPriceX64, liquidity, amountIn, true)
    } else {
      return this.getNextSqrtPriceFromAmountBRoundingDown(sqrtPriceX64, liquidity, amountIn, true)
    }
  }

  static getNextSqrtPriceFromOutput(
    sqrtPriceX64: BN,
    liquidity: BN,
    amountIn: BN,
    zeroForOne: boolean
  ): BN {
    if (!sqrtPriceX64.gt(BN_ZERO)) throw Error('sqrtPriceX64.gt(BN_ZERO)')
    if (!liquidity.gt(BN_ZERO)) throw Error('liquidity.gt(BN_ZERO)')

    if (zeroForOne) {
      return this.getNextSqrtPriceFromAmountBRoundingDown(sqrtPriceX64, liquidity, amountIn, false)
    } else {
      return this.getNextSqrtPriceFromAmountARoundingUp(sqrtPriceX64, liquidity, amountIn, false)
    }
  }
}
