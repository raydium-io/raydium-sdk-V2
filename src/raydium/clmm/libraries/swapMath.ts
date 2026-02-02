import BN from "bn.js"
import { mulDivCeil, mulDivFloor } from "./bigNum"
import { FEE_RATE_DENOMINATOR } from "./constants"
import {
  getAmountADeltaUnsigned,
  getAmountBDeltaUnsigned,
  getNextSqrtPriceFromInput,
  getNextSqrtPriceFromOutput,
} from "./sqrtPriceMath"

export interface SwapStepResult {
  sqrtPriceNextX64: BN
  amountIn: BN
  amountOut: BN
  feeAmount: BN
}

export interface SwapState {
  amountSpecifiedRemaining: BN
  amountCalculated: BN
  sqrtPriceX64: BN
  tick: number
  feeGrowthGlobalX64: BN
  protocolFee: BN
  fundFee: BN
  liquidity: BN
}

export function computeSwapStep(
  sqrtPriceCurrentX64: BN,
  sqrtPriceTargetX64: BN,
  liquidity: BN,
  amountRemaining: BN,
  feeRate: number,
  isBaseInput: boolean,
  zeroForOne: boolean,
  isFeeOnInput: boolean
): SwapStepResult {
  let amountIn = new BN(0)
  let amountOut = new BN(0)
  let sqrtPriceNextX64: BN

  if (isBaseInput) {
    const amountForPriceCalc = isFeeOnInput
      ? mulDivFloor(
        amountRemaining,
        new BN(FEE_RATE_DENOMINATOR - feeRate),
        new BN(FEE_RATE_DENOMINATOR)
      )
      : amountRemaining

    const maxAmountIn = zeroForOne
      ? getAmountADeltaUnsigned(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, true)
      : getAmountBDeltaUnsigned(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, true)

    if (maxAmountIn !== null && amountForPriceCalc.gte(maxAmountIn)) {
      sqrtPriceNextX64 = sqrtPriceTargetX64
      amountIn = maxAmountIn
    } else {
      sqrtPriceNextX64 = getNextSqrtPriceFromInput(
        sqrtPriceCurrentX64,
        liquidity,
        amountForPriceCalc,
        zeroForOne
      )
    }
  } else {
    const amountForPriceCalc = isFeeOnInput
      ? amountRemaining
      : mulDivCeil(
        amountRemaining,
        new BN(FEE_RATE_DENOMINATOR),
        new BN(FEE_RATE_DENOMINATOR - feeRate)
      )

    const maxAmountOut = zeroForOne
      ? getAmountBDeltaUnsigned(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, false)
      : getAmountADeltaUnsigned(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, false)

    if (maxAmountOut !== null && amountForPriceCalc.gte(maxAmountOut)) {
      sqrtPriceNextX64 = sqrtPriceTargetX64
      amountOut = maxAmountOut
    } else {
      sqrtPriceNextX64 = getNextSqrtPriceFromOutput(
        sqrtPriceCurrentX64,
        liquidity,
        amountForPriceCalc,
        zeroForOne
      )
    }
  }

  const max = sqrtPriceTargetX64.eq(sqrtPriceNextX64)

  if (zeroForOne) {
    if (!(max && isBaseInput)) {
      amountIn = getAmountADeltaUnsigned(sqrtPriceNextX64, sqrtPriceCurrentX64, liquidity, true)
    }
    if (!(max && !isBaseInput)) {
      amountOut = getAmountBDeltaUnsigned(sqrtPriceNextX64, sqrtPriceCurrentX64, liquidity, false)
    }
  } else {
    if (!(max && isBaseInput)) {
      amountIn = getAmountBDeltaUnsigned(sqrtPriceCurrentX64, sqrtPriceNextX64, liquidity, true)
    }
    if (!(max && !isBaseInput)) {
      amountOut = getAmountADeltaUnsigned(sqrtPriceCurrentX64, sqrtPriceNextX64, liquidity, false)
    }
  }

  let feeAmount: BN

  if (isBaseInput) {
    if (isFeeOnInput) {
      if (!sqrtPriceNextX64.eq(sqrtPriceTargetX64)) {
        feeAmount = amountRemaining.sub(amountIn)
      } else {
        feeAmount = mulDivCeil(
          amountIn,
          new BN(feeRate),
          new BN(FEE_RATE_DENOMINATOR - feeRate)
        )
      }
    } else {
      feeAmount = mulDivCeil(amountOut, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
      amountOut = amountOut.sub(feeAmount)
    }
  } else {
    if (isFeeOnInput) {
      amountOut = BN.min(amountOut, amountRemaining)
      feeAmount = mulDivCeil(
        amountIn,
        new BN(feeRate),
        new BN(FEE_RATE_DENOMINATOR - feeRate)
      )
    } else {
      feeAmount = mulDivCeil(amountOut, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
      const netOutput = amountOut.sub(feeAmount)

      if (netOutput.gt(amountRemaining)) {
        feeAmount = amountOut.sub(amountRemaining)
        amountOut = amountRemaining
      } else {
        amountOut = netOutput
      }
    }
  }

  return {
    sqrtPriceNextX64,
    amountIn,
    amountOut,
    feeAmount,
  }
}

export function calculateFeeFromInput(amountIn: BN, feeRate: number): BN {
  return mulDivCeil(amountIn, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
}


export function calculateAmountAfterFee(amountIn: BN, feeRate: number): BN {
  return mulDivFloor(
    amountIn,
    new BN(FEE_RATE_DENOMINATOR - feeRate),
    new BN(FEE_RATE_DENOMINATOR)
  )
}

export function calculateAmountBeforeFee(amountAfterFee: BN, feeRate: number): BN {
  return mulDivCeil(
    amountAfterFee,
    new BN(FEE_RATE_DENOMINATOR),
    new BN(FEE_RATE_DENOMINATOR - feeRate)
  )
}

export function calculateDynamicFee(
  baseFeeRate: number,
  volatilityAccumulator: number,
  dynamicFeeControl: number,
  maxFeeRate: number
): number {
  const volatilityBN = new BN(volatilityAccumulator)
  const controlBN = new BN(dynamicFeeControl)
  const dynamicFeeComponent = volatilityBN.mul(controlBN).divn(100_000).toNumber()

  const totalFee = baseFeeRate + dynamicFeeComponent

  return Math.min(totalFee, maxFeeRate)
}

export function updateVolatilityAccumulator(
  currentVolatilityAccumulator: number,
  tickSpacingIndexDelta: number,
  volatilityReference: number,
  maxVolatilityAccumulator: number
): number {
  const absDelta = tickSpacingIndexDelta < 0 ? -tickSpacingIndexDelta : tickSpacingIndexDelta
  const volatility = new BN(absDelta).muln(10_000).toNumber()

  let newAccumulator = volatilityReference + volatility

  newAccumulator = Math.min(newAccumulator, maxVolatilityAccumulator)

  return newAccumulator
}

export function decayVolatilityReference(
  volatilityAccumulator: number,
  timeSinceLastUpdate: number,
  decayPeriod: number,
  reductionFactor: number
): number {
  if (timeSinceLastUpdate < decayPeriod) {
    return volatilityAccumulator
  }

  const periods = Math.floor(timeSinceLastUpdate / decayPeriod)

  let referenceBN = new BN(volatilityAccumulator)
  const reductionBN = new BN(reductionFactor)
  const denominator = new BN(10_000)

  for (let i = 0; i < periods && !referenceBN.isZero(); i++) {
    referenceBN = referenceBN.mul(reductionBN).div(denominator)
  }

  return referenceBN.toNumber()
}


export function initializeSwapState(
  amountSpecified: BN,
  sqrtPriceX64: BN,
  tick: number,
  liquidity: BN
): SwapState {
  return {
    amountSpecifiedRemaining: amountSpecified.abs(),
    amountCalculated: new BN(0),
    sqrtPriceX64,
    tick,
    feeGrowthGlobalX64: new BN(0),
    protocolFee: new BN(0),
    fundFee: new BN(0),
    liquidity,
  }
}

export function calculateFeeGrowth(feeAmount: BN, liquidity: BN): BN {
  if (liquidity.isZero()) {
    return new BN(0)
  }
  return feeAmount.shln(64).div(liquidity)
}

export function splitFee(
  feeAmount: BN,
  protocolFeeRate: number,
  fundFeeRate: number
): { protocolFee: BN, fundFee: BN, lpFee: BN } {
  const protocolFee = mulDivFloor(feeAmount, new BN(protocolFeeRate), new BN(FEE_RATE_DENOMINATOR))
  const fundFee = mulDivFloor(feeAmount, new BN(fundFeeRate), new BN(FEE_RATE_DENOMINATOR))
  const lpFee = feeAmount.sub(protocolFee).sub(fundFee)

  return { protocolFee, fundFee, lpFee }
}
