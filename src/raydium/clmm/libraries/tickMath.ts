import BN from "bn.js"
import Decimal from "decimal.js"
import { mostSignificantBit, mulDivFloor } from "./bigNum"
import {
  BIT_PRECISION,
  LOG_B_2_X32,
  LOG_B_P_ERR_MARGIN_LOWER_X64,
  LOG_B_P_ERR_MARGIN_UPPER_X64,
  MAX_SQRT_PRICE_X64,
  MAX_TICK,
  MIN_SQRT_PRICE_X64,
  MIN_TICK,
  Q64,
  TICK_ARRAY_SIZE,
  TICK_TO_SQRT_PRICE_FACTORS
} from "./constants"

export function isValidTick(tick: number): boolean {
  return tick >= MIN_TICK && tick <= MAX_TICK
}

export function checkTick(tick: number): void {
  if (!isValidTick(tick)) {
    throw new Error(`Tick ${tick} is out of range [${MIN_TICK}, ${MAX_TICK}]`)
  }
}

export function isValidSqrtPrice(sqrtPriceX64: BN): boolean {
  return sqrtPriceX64.gte(MIN_SQRT_PRICE_X64) && sqrtPriceX64.lte(MAX_SQRT_PRICE_X64)
}

export function checkSqrtPrice(sqrtPriceX64: BN): void {
  if (!isValidSqrtPrice(sqrtPriceX64)) {
    throw new Error(`Sqrt price ${sqrtPriceX64.toString()} is out of range`)
  }
}

export function getSqrtPriceAtTick(tick: number): BN {
  checkTick(tick)

  const absTick = Math.abs(tick)

  let ratio = Q64.clone()

  for (const { bit, factor } of TICK_TO_SQRT_PRICE_FACTORS) {
    if ((absTick & (1 << bit)) !== 0) {
      ratio = mulDivFloor(ratio, factor, Q64)
    }
  }

  if (tick > 0) {
    ratio = mulDivFloor(Q64, Q64, ratio)
  }

  return ratio
}

export function getTickAtSqrtPrice(sqrtPriceX64: BN): number {
  checkSqrtPrice(sqrtPriceX64)

  const msb = mostSignificantBit(sqrtPriceX64)

  const msbMinus64 = msb - 64
  let log2pIntegerX32: BN
  if (msbMinus64 >= 0) {
    log2pIntegerX32 = new BN(msbMinus64).shln(32)
  } else {
    log2pIntegerX32 = new BN(-msbMinus64).shln(32).neg()
  }

  let r: BN
  if (msb >= 64) {
    r = sqrtPriceX64.shrn(msb - 63)
  } else {
    r = sqrtPriceX64.shln(63 - msb)
  }

  let log2pFractionX64 = new BN(0)
  let bit = new BN(1).shln(63)

  for (let precision = 0; precision < BIT_PRECISION && !bit.isZero(); precision++) {
    r = r.mul(r)

    const isRMoreThanTwo = r.shrn(127).toNumber()

    r = r.shrn(63 + isRMoreThanTwo)

    if (isRMoreThanTwo) {
      log2pFractionX64 = log2pFractionX64.add(bit)
    }

    bit = bit.shrn(1)
  }

  const log2pFractionX32 = log2pFractionX64.shrn(32)
  const log2pX32 = log2pIntegerX32.add(log2pFractionX32)

  const logSqrt10001X64 = log2pX32.mul(LOG_B_2_X32)

  const tickLowBN = logSqrt10001X64.sub(LOG_B_P_ERR_MARGIN_LOWER_X64)
  const tickHighBN = logSqrt10001X64.add(LOG_B_P_ERR_MARGIN_UPPER_X64)

  const tickLow = signedShrn64(tickLowBN)
  const tickHigh = signedShrn64(tickHighBN)

  if (tickLow === tickHigh) {
    return tickLow
  }

  const sqrtPriceAtTickHigh = getSqrtPriceAtTick(tickHigh)
  if (sqrtPriceAtTickHigh.lte(sqrtPriceX64)) {
    return tickHigh
  }

  return tickLow
}

function signedShrn64(bn: BN): number {
  if (bn.isNeg()) {
    const Q64 = new BN(1).shln(64)
    const result = bn.div(Q64)
    if (!bn.mod(Q64).isZero() && bn.isNeg()) {
      return result.subn(1).toNumber()
    }
    return result.toNumber()
  } else {
    return bn.shrn(64).toNumber()
  }
}

export function getPriceAtTick(tick: number, roundUp: boolean): BN {
  const sqrtPriceX64 = getSqrtPriceAtTick(tick)

  if (roundUp) {
    return sqrtPriceX64.mul(sqrtPriceX64).add(Q64.subn(1)).div(Q64)
  } else {
    return sqrtPriceX64.mul(sqrtPriceX64).div(Q64)
  }
}

export function tickToPrice(tick: number, decimals0: number, decimals1: number): Decimal {
  const sqrtPriceX64 = getSqrtPriceAtTick(tick)
  return sqrtPriceX64ToPrice(sqrtPriceX64, decimals0, decimals1)
}

export function sqrtPriceX64ToPrice(sqrtPriceX64: BN, decimals0: number, decimals1: number): Decimal {
  const sqrtPriceSquared = sqrtPriceX64.mul(sqrtPriceX64)

  const decimalDiff = decimals0 - decimals1

  const DECIMAL_PRECISION = 20
  const PRECISION_MULTIPLIER = new BN(10).pow(new BN(DECIMAL_PRECISION))

  const numerator = sqrtPriceSquared.mul(PRECISION_MULTIPLIER)
  const denominator = new BN(1).shln(128)
  const scaledResult = numerator.div(denominator)

  let resultStr = scaledResult.toString()

  while (resultStr.length <= DECIMAL_PRECISION) {
    resultStr = '0' + resultStr
  }

  const integerPart = resultStr.slice(0, -DECIMAL_PRECISION)
  const decimalPart = resultStr.slice(-DECIMAL_PRECISION)
  const priceStr = integerPart + '.' + decimalPart

  const price = new Decimal(priceStr).mul(new Decimal(10).pow(decimalDiff))

  return price
}

export function priceToTick(price: Decimal, decimals0: number, decimals1: number): number {
  const adjustedPrice = price.div(Math.pow(10, decimals0 - decimals1))

  const tick = adjustedPrice.log().div(new Decimal(1.0001).log()).floor()
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick.toNumber()))
}

export function priceToSqrtPriceX64(price: Decimal, decimals0: number, decimals1: number): BN {
  const adjustedPrice = price.div(Math.pow(10, decimals0 - decimals1))
  const sqrtPrice = adjustedPrice.sqrt()
  const sqrtPriceX64 = sqrtPrice.mul(new Decimal(2).pow(64))

  return new BN(sqrtPriceX64.toFixed(0))
}

export function roundTickDown(tick: number, tickSpacing: number): number {
  if (tick >= 0) {
    return tick - (tick % tickSpacing)
  }
  return tick - (tick % tickSpacing) - (tick % tickSpacing !== 0 ? tickSpacing : 0)
}

export function roundTickUp(tick: number, tickSpacing: number): number {
  if (tick >= 0) {
    return tick + (tickSpacing - (tick % tickSpacing)) % tickSpacing
  }
  return tick - (tick % tickSpacing)
}

export function getTickArrayStartIndex(tick: number, tickSpacing: number): number {
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE
  return roundTickDown(tick, ticksPerArray)
}

export function getTickOffsetInArray(tick: number, tickSpacing: number): number {
  if (tick % tickSpacing != 0) {
    throw new Error('tickIndex % tickSpacing not equal 0')
  }
  const startIndex = getTickArrayStartIndex(tick, tickSpacing)
  return Math.floor((tick - startIndex) / tickSpacing)
}

export function getMinTick(tickSpacing: number): number {
  return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing
}

export function getMaxTick(tickSpacing: number): number {
  return Math.floor(MAX_TICK / tickSpacing) * tickSpacing
}
