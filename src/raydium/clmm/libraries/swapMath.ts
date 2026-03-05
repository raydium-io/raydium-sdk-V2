import { FEE_RATE_DENOMINATOR_VALUE } from "@/common"
import BN from "bn.js"
import { DynamicFeeInfoLayout, PoolInfoLayout } from "../layout"
import { mulDivCeil, mulDivFloor } from "./bigNum"
import { BN_ZERO, DYNAMIC_FEE_CONTROL_DENOMINATOR, FEE_RATE_DENOMINATOR, MAX_FEE_RATE_NUMERATOR, MAX_TICK, MIN_TICK, Q64, VOLATILITY_ACCUMULATOR_SCALE } from "./constants"
import { LiquidityMathUtil } from "./liquidityMath"
import { DynamicFeeInfo, PoolFee } from "./pool"
import { SqrtPriceMath } from "./sqrtPriceMath"
import { TickUtil } from "./tickArrayUtil"

export interface SwapStepResult {
  sqrtPriceNextX64: BN
  amountIn: BN
  amountOut: BN
  feeAmount: BN
}

interface SwapStateInterface {
  amountSpecifiedRemaining: BN,
  amountCalculated: BN,
  sqrtPriceX64: BN,
  tick: number,
  feeGrowthGlobalX64: BN,
  lpFee: BN,
  protocolFee: BN,
  fundFee: BN,
  liquidity: BN,
  sqrtPriceNextX64: BN,
  tickNext: number,
  baseFeeRate: number,
  tickSpacing: number,
  tickSpacingIndex: number,
  dynamicFeeInfo: ReturnType<typeof DynamicFeeInfoLayout.decode> | undefined,
}
export class SwapState {
  static newValue({ poolInfo, amountSpecified, zeroForOne, feeRate, blockTimestamp }: {
    poolInfo: ReturnType<typeof PoolInfoLayout.decode>,
    amountSpecified: BN,
    zeroForOne: boolean,
    feeRate: number,
    blockTimestamp: number,
  }): SwapStateInterface {
    const state: SwapStateInterface = {
      amountSpecifiedRemaining: amountSpecified,
      amountCalculated: BN_ZERO,
      sqrtPriceX64: poolInfo.sqrtPriceX64,
      tick: poolInfo.tickCurrent,
      feeGrowthGlobalX64: zeroForOne ? poolInfo.feeGrowthGlobalX64A : poolInfo.feeGrowthGlobalX64B,
      lpFee: BN_ZERO,
      protocolFee: BN_ZERO,
      fundFee: BN_ZERO,
      liquidity: poolInfo.liquidity,
      sqrtPriceNextX64: BN_ZERO,
      tickNext: 0,
      baseFeeRate: feeRate,
      tickSpacing: poolInfo.tickSpacing,
      tickSpacingIndex: 0,
      dynamicFeeInfo: DynamicFeeInfo.getDynamicFeeInfo({ poolInfo }),
    }

    if (state.dynamicFeeInfo) {
      state.tickSpacingIndex = PoolFee.tickSpacingIndexFromTick(state.tick, state.tickSpacing)
      DynamicFeeInfo.updateReference({ dynamicFeeInfo: state.dynamicFeeInfo, tickSpacingIndex: state.tickSpacingIndex, currentTimestamp: blockTimestamp })
    }

    return state
  }

  static getTargetPriceBasedOnNextTick({ data, tickNext, zeroForOne, sqrtPriceLimitX64 }: {
    data: SwapStateInterface,
    tickNext: number,
    zeroForOne: boolean,
    sqrtPriceLimitX64: BN,
  }) {
    data.tickNext = tickNext
    if (data.tickNext < MIN_TICK) {
      data.tickNext = MIN_TICK
    } else if (data.tickNext > MAX_TICK) {
      data.tickNext = MAX_TICK
    }

    data.sqrtPriceNextX64 = TickUtil.getSqrtPriceAtTick(data.tickNext)

    let targetPrice: BN

    if ((zeroForOne && data.sqrtPriceNextX64.lt(sqrtPriceLimitX64)) || (!zeroForOne && data.sqrtPriceNextX64.gt(sqrtPriceLimitX64))) {
      targetPrice = sqrtPriceLimitX64
    } else {
      targetPrice = data.sqrtPriceNextX64
    }

    if (zeroForOne) {
      if (data.tick < data.tickNext) throw Error('data.tick < data.tickNext')
      if (data.sqrtPriceX64.lt(data.sqrtPriceNextX64)) throw Error('data.sqrtPriceX64.lt(data.sqrtPriceNextX64)')
      if (data.sqrtPriceX64.lt(targetPrice)) throw Error('data.sqrtPriceX64.lt(targetPrice)')
    } else {
      if (data.tickNext <= data.tick) throw Error('data.tickNext <= data.tick')
      if (data.sqrtPriceNextX64.lt(data.sqrtPriceX64)) throw Error('data.sqrtPriceNextX64.lt(data.sqrtPriceX64)')
      if (targetPrice.lt(data.sqrtPriceX64)) throw Error('targetPrice.lt(data.sqrtPriceX64)')
    }

    return targetPrice
  }

  static updateVolatilityAccumulator({ state }: {
    state: SwapStateInterface,
  }) {
    if (!state.dynamicFeeInfo) return

    DynamicFeeInfo.updateVolatilityAccumulator({ state: state.dynamicFeeInfo, tickSpacingIndex: state.tickSpacingIndex })
  }

  static computeDynamicFeeRate({ data, tickSpacing }: {
    data: ReturnType<typeof DynamicFeeInfoLayout.decode>,
    tickSpacing: number,
  }) {
    const crossed = data.volatilityAccumulator * tickSpacing

    const squared = crossed * crossed

    const denominator = DYNAMIC_FEE_CONTROL_DENOMINATOR * VOLATILITY_ACCUMULATOR_SCALE * VOLATILITY_ACCUMULATOR_SCALE

    const feeRate = mulDivCeil(new BN(data.dynamicFeeControl), new BN(squared), new BN(denominator)).toNumber()

    if (feeRate > MAX_FEE_RATE_NUMERATOR) {
      return MAX_FEE_RATE_NUMERATOR
    } else {
      return feeRate
    }
  }

  static getTotalFeeRate({ data }: {
    data: SwapStateInterface,
  }) {
    if (data.dynamicFeeInfo) {
      const dynamicFeeRate = this.computeDynamicFeeRate({ data: data.dynamicFeeInfo, tickSpacing: data.tickSpacing })

      const totalFeeRate = data.baseFeeRate + dynamicFeeRate
      return Math.min(MAX_FEE_RATE_NUMERATOR, totalFeeRate)
    }
    return data.baseFeeRate
  }

  static getSpacingBoundedPrice({ data, targetPrice, zeroForOne }: {
    data: SwapStateInterface,
    targetPrice: BN,
    zeroForOne: boolean
  }) {
    if (data.dynamicFeeInfo === undefined) return { isSkipped: true, boundedPrice: targetPrice }

    if (data.liquidity.isZero() || data.dynamicFeeInfo.volatilityAccumulator === data.dynamicFeeInfo.maxVolatilityAccumulator) return { isSkipped: true, boundedPrice: targetPrice }

    const tickSpacingI32 = data.tickSpacing
    const boundedTick = zeroForOne ? data.tickSpacingIndex * tickSpacingI32 : (data.tickSpacingIndex + 1) * tickSpacingI32

    const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, boundedTick))
    const boundedSqrtPrice = TickUtil.getSqrtPriceAtTick(clampedTick)

    if (zeroForOne) {
      return { isSkipped: false, boundedPrice: BN.max(targetPrice, boundedSqrtPrice) }
    } else {
      return { isSkipped: false, boundedPrice: BN.min(targetPrice, boundedSqrtPrice) }
    }
  }

  static applySwapAmounts({ state, amountIn, amountOut, feeAmount, isBaseInput, isFeeOnInput, protocolFeeRate, fundFeeRate, }: {
    state: SwapStateInterface,
    amountIn: BN,
    amountOut: BN,
    feeAmount: BN,
    isBaseInput: boolean,
    isFeeOnInput: boolean,
    protocolFeeRate: BN,
    fundFeeRate: BN,
  }) {
    const amountInConsumed = isFeeOnInput ? amountIn.add(feeAmount) : amountIn

    if (isBaseInput) {
      state.amountSpecifiedRemaining = state.amountSpecifiedRemaining.sub(amountInConsumed)
      state.amountCalculated = state.amountCalculated.add(amountOut)
    } else {
      state.amountSpecifiedRemaining = state.amountSpecifiedRemaining.sub(amountOut)
      state.amountCalculated = state.amountCalculated.add(amountInConsumed)
    }

    this.splitFee({ state, feeAmount, protocolFeeRate, fundFeeRate })
  }

  static updateDynamicFeeIndex({ state, zeroForOne, isSkippedTickSpacing }: {
    state: SwapStateInterface,
    zeroForOne: boolean,
    isSkippedTickSpacing: boolean,
  }) {
    if (state.dynamicFeeInfo === undefined) return
    if (isSkippedTickSpacing) {
      const tickIndex = state.sqrtPriceX64.eq(state.sqrtPriceNextX64) ? state.tickNext : state.tick

      let tickSpacingIndex = PoolFee.tickSpacingIndexFromTick(tickIndex, state.tickSpacing)

      if (!zeroForOne && tickIndex % state.tickSpacing === 0) {
        tickSpacingIndex = tickSpacingIndex - 1
      }

      state.tickSpacingIndex = tickSpacingIndex

      if (state.dynamicFeeInfo.volatilityAccumulator !== state.dynamicFeeInfo.maxVolatilityAccumulator) {
        this.updateVolatilityAccumulator({ state })
      }
    }

    state.tickSpacingIndex += zeroForOne ? -1 : 1
  }

  static splitFee({ state, feeAmount, protocolFeeRate, fundFeeRate }: {
    state: SwapStateInterface,
    feeAmount: BN,
    protocolFeeRate: BN,
    fundFeeRate: BN
  }) {
    let remainingFee = feeAmount
    if (protocolFeeRate.gt(BN_ZERO)) {
      const protocolFeeDelta = feeAmount.mul(protocolFeeRate).div(new BN(FEE_RATE_DENOMINATOR_VALUE))
      state.protocolFee = state.protocolFee.add(protocolFeeDelta)
      remainingFee = remainingFee.sub(protocolFeeDelta)
    }

    if (fundFeeRate.gt(BN_ZERO)) {
      const fundFeeDelta = feeAmount.mul(fundFeeRate).div(new BN(FEE_RATE_DENOMINATOR_VALUE))
      state.fundFee = state.fundFee.add(fundFeeDelta)
      remainingFee = remainingFee.sub(fundFeeDelta)
    }

    if (state.liquidity.gt(BN_ZERO)) {
      const feeGrowthGlobalX64Delta = mulDivFloor(remainingFee, Q64, state.liquidity)
      state.feeGrowthGlobalX64 = state.feeGrowthGlobalX64.add(feeGrowthGlobalX64Delta)
      state.lpFee = state.lpFee.add(remainingFee)
    }
  }

  static updateVolatilityAccumulatorOnPrice({ state }: { state: SwapStateInterface, }) {
    if (state.dynamicFeeInfo) {
      const tickIndex = TickUtil.getTickAtSqrtPrice(state.sqrtPriceX64)
      const finalTickSpacingIndex = PoolFee.tickSpacingIndexFromTick(tickIndex, state.tickSpacing)
      if (state.tickSpacingIndex != finalTickSpacingIndex) {
        state.tickSpacingIndex = finalTickSpacingIndex
        this.updateVolatilityAccumulator({ state })
      }
    }
  }
}


export class SwapMathUtil {
  static newSwapComputationResult({ sqrtPriceNextX64 }: { sqrtPriceNextX64?: BN }): SwapStepResult {
    return {
      sqrtPriceNextX64: sqrtPriceNextX64 ?? BN_ZERO,
      amountIn: BN_ZERO,
      amountOut: BN_ZERO,
      feeAmount: BN_ZERO,
    }
  }

  static calculateAmountInRange({ sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, zeroForOne, isBaseInput }: {
    sqrtPriceCurrentX64: BN,
    sqrtPriceTargetX64: BN,
    liquidity: BN,
    zeroForOne: boolean,
    isBaseInput: boolean,
  }) {
    if (isBaseInput) {
      try {
        const result = zeroForOne ? LiquidityMathUtil.getDeltaAmountAUnsigned(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, true) : LiquidityMathUtil.getDeltaAmountBUnsigned(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, true)
        return result
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (e.message === 'MaxTokenOverflow') return null
        throw e
      }
    } else {
      try {
        const result = zeroForOne ? LiquidityMathUtil.getDeltaAmountBUnsigned(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, false) : LiquidityMathUtil.getDeltaAmountAUnsigned(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, false)
        return result
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (e.message === 'MaxTokenOverflow') return null
        throw e
      }
    }
  }

  static computeSwap(
    sqrtPriceCurrentX64: BN,
    sqrtPriceTargetX64: BN,
    liquidity: BN,
    amountRemaining: BN,
    feeRate: number,
    isBaseInput: boolean,
    zeroForOne: boolean,
    isFeeOnInput: boolean
  ): SwapStepResult {
    const result = this.newSwapComputationResult({})

    if (isBaseInput) {
      const amountForPriceCalc = isFeeOnInput ? mulDivFloor(amountRemaining, new BN(FEE_RATE_DENOMINATOR - feeRate), new BN(FEE_RATE_DENOMINATOR)) : amountRemaining

      const amountIn = this.calculateAmountInRange({ sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, zeroForOne, isBaseInput })

      if (amountIn !== null) result.amountIn = amountIn

      result.sqrtPriceNextX64 = amountIn !== null && amountForPriceCalc.gte(result.amountIn) ? sqrtPriceTargetX64 : SqrtPriceMath.getNextSqrtPriceFromInput(sqrtPriceCurrentX64, liquidity, amountForPriceCalc, zeroForOne)
    } else {
      const amountForPriceCalc = isFeeOnInput
        ? amountRemaining
        : mulDivCeil(
          amountRemaining,
          new BN(FEE_RATE_DENOMINATOR),
          new BN(FEE_RATE_DENOMINATOR - feeRate)
        )

      const amountOut = this.calculateAmountInRange({ sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, zeroForOne, isBaseInput })
      if (amountOut !== null) result.amountOut = amountOut

      result.sqrtPriceNextX64 = amountOut !== null && amountForPriceCalc.gte(result.amountOut) ? sqrtPriceTargetX64 : SqrtPriceMath.getNextSqrtPriceFromOutput(sqrtPriceCurrentX64, liquidity, amountForPriceCalc, zeroForOne)
    }

    if (zeroForOne) {
      if (!result.sqrtPriceNextX64.gte(sqrtPriceTargetX64)) throw Error('!result.sqrtPriceNextX64.gte(sqrtPriceTargetX64)')
    } else {
      if (!sqrtPriceTargetX64.gte(result.sqrtPriceNextX64)) throw Error('!sqrtPriceTargetX64.gte(result.sqrtPriceNextX64)')
    }

    const max = sqrtPriceTargetX64.eq(result.sqrtPriceNextX64)

    if (zeroForOne) {
      if (!(max && isBaseInput)) {
        result.amountIn = LiquidityMathUtil.getDeltaAmountAUnsigned(result.sqrtPriceNextX64, sqrtPriceCurrentX64, liquidity, true)
      }
      if (!(max && !isBaseInput)) {
        result.amountOut = LiquidityMathUtil.getDeltaAmountBUnsigned(result.sqrtPriceNextX64, sqrtPriceCurrentX64, liquidity, false)
      }
    } else {
      if (!(max && isBaseInput)) {
        result.amountIn = LiquidityMathUtil.getDeltaAmountBUnsigned(sqrtPriceCurrentX64, result.sqrtPriceNextX64, liquidity, true)
      }
      if (!(max && !isBaseInput)) {
        result.amountOut = LiquidityMathUtil.getDeltaAmountAUnsigned(sqrtPriceCurrentX64, result.sqrtPriceNextX64, liquidity, false)
      }
    }

    if (isBaseInput) {
      if (isFeeOnInput) {
        if (!result.sqrtPriceNextX64.eq(sqrtPriceTargetX64)) {
          result.feeAmount = amountRemaining.sub(result.amountIn)
        } else {
          result.feeAmount = mulDivCeil(
            result.amountIn,
            new BN(feeRate),
            new BN(FEE_RATE_DENOMINATOR - feeRate)
          )
        }
      } else {
        result.feeAmount = mulDivCeil(result.amountOut, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
        result.amountOut = result.amountOut.sub(result.feeAmount)
      }
    } else {
      if (isFeeOnInput) {
        result.amountOut = BN.min(result.amountOut, amountRemaining)
        result.feeAmount = mulDivCeil(
          result.amountIn,
          new BN(feeRate),
          new BN(FEE_RATE_DENOMINATOR - feeRate)
        )
      } else {
        result.feeAmount = mulDivCeil(result.amountOut, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
        const netOutput = result.amountOut.sub(result.feeAmount)

        if (netOutput.gt(amountRemaining)) {
          result.feeAmount = result.amountOut.sub(amountRemaining)
          result.amountOut = amountRemaining
        } else {
          result.amountOut = netOutput
        }
      }
    }

    return result
  }
}