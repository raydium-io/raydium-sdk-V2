import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { ClmmConfigLayout, PoolInfoLayout, TickArrayLayout } from '../layout'
import { BN_ZERO, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64 } from './constants'
import { LiquidityMathUtil } from './liquidityMath'
import { PoolUtil } from './pool'
import { SwapMathUtil, SwapState } from './swapMath'
import { TickArrayUtil, TickUtil } from './tickArrayUtil'

export interface SwapSimulationResult {
  allTrade: boolean
  amountSpecifiedRemaining: BN
  amountCalculated: BN
  feeAmount: BN
  sqrtPriceX64: BN
  liquidity: BN
  tickCurrent: number
  accounts: PublicKey[]
}

export function swapInternal(
  poolInfo: ReturnType<typeof PoolInfoLayout.decode>,
  tickArrays: { address: PublicKey, value: ReturnType<typeof TickArrayLayout.decode> }[],
  configInfo: ReturnType<typeof ClmmConfigLayout.decode>,
  amountSpecified: BN,
  sqrtPriceLimitX64: BN,
  zeroForOne: boolean,
  isBaseInput: boolean,
  blockTimestamp: number
): SwapSimulationResult {
  if (sqrtPriceLimitX64.isZero()) {
    sqrtPriceLimitX64 = zeroForOne
      ? new BN(MIN_SQRT_PRICE_X64).addn(1)
      : new BN(MAX_SQRT_PRICE_X64).subn(1)
  }

  let tickArrayListIndex = 0

  const _startTickIndex = TickArrayUtil.getTickArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing)
  const { firstItckArrayContainsPoolTick: _firstItckArrayContainsPoolTick, firstValidTickArrayStartIndex } = { firstItckArrayContainsPoolTick: tickArrays[tickArrayListIndex].value.startTickIndex === _startTickIndex, firstValidTickArrayStartIndex: tickArrays[tickArrayListIndex].value.startTickIndex }
  let firstItckArrayContainsPoolTick = _firstItckArrayContainsPoolTick

  let currentValidTIckArrayStrartIndex = firstValidTickArrayStartIndex

  const tickArrayCurrent = tickArrays[tickArrayListIndex]

  const isFeeOnInput = PoolUtil.isFeeOnInput(poolInfo.feeOn, zeroForOne)

  const state = SwapState.newValue({ poolInfo, amountSpecified, zeroForOne, feeRate: configInfo.tradeFeeRate, blockTimestamp, })

  while (!state.amountSpecifiedRemaining.isZero() && !state.sqrtPriceX64.eq(sqrtPriceLimitX64)) {
    const nextInitializedTick = (() => {
      const tickState = TickArrayUtil.nextInitalizedTick({ data: tickArrayCurrent.value, tickSpacing: state.tickSpacing, zeroForOne, currentTickIndex: state.tick })
      if (tickState !== undefined) {
        return tickState
      } else if (!firstItckArrayContainsPoolTick) {
        firstItckArrayContainsPoolTick = true
        return TickArrayUtil.firstinitializedTick({ data: tickArrayCurrent.value, zeroForOne })
      } else {
        const nextTickArrayIndex = tickArrays[++tickArrayListIndex]
        if (nextTickArrayIndex === undefined) {
          return undefined
        }

        currentValidTIckArrayStrartIndex = nextTickArrayIndex.value.startTickIndex
        return TickArrayUtil.firstinitializedTick({ data: nextTickArrayIndex.value, zeroForOne })
      }
    })()

    if (nextInitializedTick === undefined) {
      return {
        allTrade: false,
        amountSpecifiedRemaining: state.amountSpecifiedRemaining,
        amountCalculated: state.amountCalculated,
        feeAmount: state.lpFee.add(state.fundFee).add(state.protocolFee),
        sqrtPriceX64: state.sqrtPriceX64,
        liquidity: state.liquidity,
        tickCurrent: state.tick,
        accounts: tickArrays.slice(0, tickArrayListIndex).map(i => i.address),
      }
    }

    const targetPrice = SwapState.getTargetPriceBasedOnNextTick({
      data: state,
      tickNext: nextInitializedTick.tick,
      zeroForOne,
      sqrtPriceLimitX64,
    })

    let liquidityNext = state.liquidity
    do {
      SwapState.updateVolatilityAccumulator({ state })

      const totalFeeRate = SwapState.getTotalFeeRate({ data: state })
      const { isSkipped: isSkippedTickSpacing, boundedPrice } = SwapState.getSpacingBoundedPrice({ data: state, targetPrice, zeroForOne })

      const isPriceChange = !state.sqrtPriceX64.eq(boundedPrice)

      let swapComputedResult
      if (isPriceChange) {
        swapComputedResult = SwapMathUtil.computeSwap(
          state.sqrtPriceX64,
          boundedPrice,
          state.liquidity,
          state.amountSpecifiedRemaining,
          totalFeeRate,
          isBaseInput,
          zeroForOne,
          isFeeOnInput,
        )

        SwapState.applySwapAmounts({
          state,
          amountIn: swapComputedResult.amountIn,
          amountOut: swapComputedResult.amountOut,
          feeAmount: swapComputedResult.feeAmount,
          isBaseInput,
          isFeeOnInput,
          protocolFeeRate: new BN(configInfo.protocolFeeRate),
          fundFeeRate: new BN(configInfo.fundFeeRate),
        })
      } else {
        swapComputedResult = SwapMathUtil.newSwapComputationResult({ sqrtPriceNextX64: boundedPrice })
      }

      const limitOrderUnfilledAmountBefore = TickUtil.limitOrderUnfilledAmount({ tick: nextInitializedTick })
      if (state.sqrtPriceNextX64.eq(swapComputedResult.sqrtPriceNextX64)) {
        const limitOrderResult = TickUtil.matchLimitOrder({
          tick: nextInitializedTick,
          swapAmount: state.amountSpecifiedRemaining,
          swapDirectionZeroForOne: zeroForOne,
          isBaseInput,
          feeRate: totalFeeRate,
          isFeeOnInput,
        })

        if (limitOrderResult.amountIn.gt(BN_ZERO)) {
          SwapState.applySwapAmounts({
            state,
            amountIn: limitOrderResult.amountIn,
            amountOut: limitOrderResult.amountOut,
            feeAmount: limitOrderResult.ammFeeAmount,
            isBaseInput,
            isFeeOnInput,
            protocolFeeRate: new BN(configInfo.protocolFeeRate),
            fundFeeRate: new BN(configInfo.fundFeeRate),
          })
        }

        if (TickUtil.hasLiquidity({ data: nextInitializedTick }) && !TickUtil.hasLimitOrders({ data: nextInitializedTick })) {
          const liquidityNet = zeroForOne ? nextInitializedTick.liquidityNet.neg() : nextInitializedTick.liquidityNet

          liquidityNext = LiquidityMathUtil.addDelta(state.liquidity, liquidityNet)
        }

        state.tick = (zeroForOne && !TickUtil.hasLimitOrders({ data: nextInitializedTick })) || (!zeroForOne && TickUtil.hasLimitOrders({ data: nextInitializedTick })) ? state.tickNext - 1 : state.tickNext
      } else if (!state.sqrtPriceX64.eq(swapComputedResult.sqrtPriceNextX64)) {
        state.tick = TickUtil.getTickAtSqrtPrice(swapComputedResult.sqrtPriceNextX64)
      }

      state.sqrtPriceX64 = swapComputedResult.sqrtPriceNextX64
      if (state.amountSpecifiedRemaining.isZero() || state.sqrtPriceX64.eq(targetPrice)) {
        const limitOrderUnfilledAmountAfter = TickUtil.limitOrderUnfilledAmount({ tick: nextInitializedTick })

        if (!state.amountSpecifiedRemaining.isZero() && !limitOrderUnfilledAmountAfter.eq(limitOrderUnfilledAmountBefore)) {
          if (!limitOrderUnfilledAmountAfter.isZero()) throw Error('!limitOrderUnfilledAmountAfter.isZero()')
        }
        break
      }
      SwapState.updateDynamicFeeIndex({ state, zeroForOne, isSkippedTickSpacing })

      // eslint-disable-next-line no-constant-condition
    } while (true)
    state.liquidity = liquidityNext
    // SwapState.splitFee({ state, protocolFeeRate: new BN(configInfo.protocolFeeRate), fundFeeRate: new BN(configInfo.fundFeeRate) })
  }
  SwapState.updateVolatilityAccumulatorOnPrice({ state })

  return {
    allTrade: true,
    amountSpecifiedRemaining: BN_ZERO,
    amountCalculated: state.amountCalculated,
    feeAmount: state.lpFee.add(state.fundFee).add(state.protocolFee),
    sqrtPriceX64: state.sqrtPriceX64,
    liquidity: state.liquidity,
    tickCurrent: state.tick,
    accounts: tickArrays.slice(0, tickArrayListIndex).map(i => i.address),
  }
}
