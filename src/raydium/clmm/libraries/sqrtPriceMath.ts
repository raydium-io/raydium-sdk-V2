import BN from "bn.js"
import { mulDivCeil, mulDivFloor } from "./bigNum"
import { BN_ONE, Q64 } from "./constants"

export function getNextSqrtPriceFromAmountARoundingUp(
  sqrtPriceX64: BN,
  liquidity: BN,
  amount: BN,
  add: boolean
): BN {
  if (amount.isZero()) {
    return sqrtPriceX64
  }

  const numerator = liquidity.shln(64)

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

export function getNextSqrtPriceFromAmountBRoundingDown(
  sqrtPriceX64: BN,
  liquidity: BN,
  amount: BN,
  add: boolean
): BN {
  if (amount.isZero()) {
    return sqrtPriceX64
  }

  if (add) {
    const quotient = mulDivFloor(amount, Q64, liquidity)
    return sqrtPriceX64.add(quotient)
  } else {
    const quotient = mulDivCeil(amount, Q64, liquidity)

    if (sqrtPriceX64.lte(quotient)) {
      throw new Error("Insufficient liquidity for token1 removal")
    }

    return sqrtPriceX64.sub(quotient)
  }
}

export function getNextSqrtPriceFromInput(
  sqrtPriceX64: BN,
  liquidity: BN,
  amountIn: BN,
  zeroForOne: boolean
): BN {
  if (zeroForOne) {
    return getNextSqrtPriceFromAmountARoundingUp(sqrtPriceX64, liquidity, amountIn, true)
  } else {
    return getNextSqrtPriceFromAmountBRoundingDown(sqrtPriceX64, liquidity, amountIn, true)
  }
}

export function getNextSqrtPriceFromOutput(
  sqrtPriceX64: BN,
  liquidity: BN,
  amountOut: BN,
  zeroForOne: boolean
): BN {
  if (zeroForOne) {
    return getNextSqrtPriceFromAmountBRoundingDown(sqrtPriceX64, liquidity, amountOut, false)
  } else {
    return getNextSqrtPriceFromAmountARoundingUp(sqrtPriceX64, liquidity, amountOut, false)
  }
}

export function getAmountADeltaUnsigned(
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN,
  roundUp: boolean
): BN {
  if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
    [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
  }

  const priceDelta = sqrtPriceUpperX64.sub(sqrtPriceLowerX64)
  const numerator = liquidity.mul(priceDelta).shln(64)

  const denominator = sqrtPriceLowerX64.mul(sqrtPriceUpperX64)

  if (roundUp) {
    return mulDivCeil(numerator, BN_ONE, denominator)
  } else {
    return mulDivFloor(numerator, BN_ONE, denominator)
  }
}

export function getAmountBDeltaUnsigned(
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN,
  roundUp: boolean
): BN {
  if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
    [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
  }

  const priceDelta = sqrtPriceUpperX64.sub(sqrtPriceLowerX64)

  if (roundUp) {
    return mulDivCeil(liquidity, priceDelta, Q64)
  } else {
    return mulDivFloor(liquidity, priceDelta, Q64)
  }
}

export function getAmountADeltaSigned(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  liquidity: BN
): BN {
  if (liquidity.isNeg()) {
    return getAmountADeltaUnsigned(sqrtPriceAX64, sqrtPriceBX64, liquidity.neg(), false).neg()
  }
  return getAmountADeltaUnsigned(sqrtPriceAX64, sqrtPriceBX64, liquidity, true)
}

export function getAmountBDeltaSigned(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  liquidity: BN
): BN {
  if (liquidity.isNeg()) {
    return getAmountBDeltaUnsigned(sqrtPriceAX64, sqrtPriceBX64, liquidity.neg(), false).neg()
  }
  return getAmountBDeltaUnsigned(sqrtPriceAX64, sqrtPriceBX64, liquidity, true)
}

