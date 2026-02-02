import BN from 'bn.js'
import { PoolInfoLayout, TickArrayLayout, TickLayout } from '../layout'
import { CollectFeeOn, FEE_RATE_DENOMINATOR, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64, Q64 } from './constants'
import { addDelta } from './liquidityMath'
import { computeSwapStep } from './swapMath'
import { getPriceAtTick, getSqrtPriceAtTick, getTickArrayStartIndex } from './tickMath'


/**
 * Calculate tick spacing index from tick (matches Rust tick_spacing_index_from_tick)
 */
function tickSpacingIndexFromTick(tickIndex: number, tickSpacing: number): number {
  if (tickIndex % tickSpacing === 0 || tickIndex >= 0) {
    return Math.floor(tickIndex / tickSpacing)
  } else {
    return Math.floor(tickIndex / tickSpacing) - 1
  }
}

export interface SwapSimulationResult {
  amountIn: BN
  amountOut: BN
  feeAmount: BN
  sqrtPriceX64: BN
  tickCurrent: number
  liquidityEnd: BN
  crossedTicks: number[]
}

export interface LimitOrderMatchResult {
  amountIn: BN
  amountOut: BN
  ammFeeAmount: BN
}

// ============================================
// Fee Collection Mode
// ============================================

/**
 * Determine if fee should be collected from input token
 *
 * @param feeOn - Fee collection mode (0, 1, or 2)
 * @param zeroForOne - Swap direction (true = token0 -> token1)
 * @returns true if fee should be collected from input token
 */
export function isFeeOnInput(feeOn: number, zeroForOne: boolean): boolean {
  switch (feeOn) {
    case CollectFeeOn.FromInput:
      return true
    case CollectFeeOn.TokenOnlyA:
      return zeroForOne  // token0 is input when zeroForOne
    case CollectFeeOn.TokenOnlyB:
      return !zeroForOne // token1 is input when !zeroForOne
    default:
      return true // default to FromInput
  }
}

// ============================================
// Dynamic Fee Calculation
// ============================================

/**
 * Calculate effective fee rate including dynamic fee
 *
 * Uses BN to avoid overflow when calculating squared values
 * and large multiplications.
 */
export function getEffectiveFeeRate(
  baseFeeRate: number,
  dynamicFeeInfo?: {
    volatilityAccumulator: number
    dynamicFeeControl: number
    maxVolatilityAccumulator: number
  },
  tickSpacing?: number
): number {
  if (!dynamicFeeInfo || dynamicFeeInfo.dynamicFeeControl === 0) {
    return baseFeeRate
  }

  const spacing = tickSpacing || 1

  // Use BN to avoid overflow in squared calculation
  const crossedBN = new BN(dynamicFeeInfo.volatilityAccumulator).muln(spacing)
  const squaredBN = crossedBN.mul(crossedBN)

  // dynamic_fee = crossed^2 * control / (100000 * 10000^2)
  // = crossed^2 * control / 10_000_000_000_000
  const controlBN = new BN(dynamicFeeInfo.dynamicFeeControl)
  const denominatorBN = new BN('10000000000000') // 100000 * 10000 * 10000

  // Use ceiling division
  const numerator = squaredBN.mul(controlBN)
  const dynamicFee = numerator.add(denominatorBN.subn(1)).div(denominatorBN).toNumber()

  const totalFee = baseFeeRate + dynamicFee
  return Math.min(totalFee, 100000) // Max 10%
}

// ============================================
// Limit Order Functions
// ============================================

/**
 * Calculate output amount for a limit order
 * output_amount = amount_in * price (rounded down)
 *
 * @param amountIn - Input amount
 * @param tick - Tick where the limit order sits
 * @param zeroForOne - Swap direction
 * @returns Output amount (rounded down)
 */
export function getLimitOrderOutput(amountIn: BN, tick: number, zeroForOne: boolean): BN {
  if (zeroForOne) {
    // Convert token0 to token1: token1_amount = token0_amount * price / 2^64
    const priceX64 = getPriceAtTick(tick, false)
    return amountIn.mul(priceX64).div(Q64)
  } else {
    // Convert token1 to token0: token0_amount = token1_amount * 2^64 / price
    const priceX64 = getPriceAtTick(tick, true)
    return amountIn.mul(Q64).div(priceX64)
  }
}

/**
 * Calculate input amount for a limit order given output amount
 * input_amount = amount_out / price (rounded up)
 *
 * @param amountOut - Output amount
 * @param tick - Tick where the limit order sits
 * @param zeroForOne - Direction of the LIMIT ORDER (opposite to swap direction)
 * @returns Input amount (rounded up)
 */
export function getLimitOrderInput(amountOut: BN, tick: number, zeroForOne: boolean): BN {
  if (zeroForOne) {
    // Limit order sells token0: need token1 input
    // token1_input = token0_output * price / 2^64 (round up)
    const priceX64 = getPriceAtTick(tick, true)
    return amountOut.mul(priceX64).add(Q64.subn(1)).div(Q64)
  } else {
    // Limit order sells token1: need token0 input
    // token0_input = token1_output * 2^64 / price (round up)
    const priceX64 = getPriceAtTick(tick, false)
    return amountOut.mul(Q64).add(priceX64.subn(1)).div(priceX64)
  }
}

/**
 * Get total unfilled limit order amount on a tick
 */
function getLimitOrderUnfilledAmount(tick: ReturnType<typeof TickLayout.decode>): BN {
  return tick.ordersAmount.add(tick.partFilledOrdersRemaining)
}

/**
 * Check if tick has limit orders
 */
function hasLimitOrders(tick: ReturnType<typeof TickLayout.decode>): boolean {
  return !tick.ordersAmount.isZero() || !tick.partFilledOrdersRemaining.isZero()
}

/**
 * Match limit order during swap
 * Implements the same logic as tick_array.rs match_limit_order()
 *
 * @param tick - Tick state with limit orders
 * @param swapAmount - Remaining swap amount
 * @param swapDirectionZeroForOne - Swap direction
 * @param isBaseInput - true for exact input swap
 * @param feeRate - Fee rate
 * @param isFeeOnInput - Whether fee is collected from input
 * @returns Match result with amounts
 */
function matchLimitOrder(
  tick: ReturnType<typeof TickLayout.decode>,
  swapAmount: BN,
  swapDirectionZeroForOne: boolean,
  isBaseInput: boolean,
  feeRate: number,
  isFeeOnInput: boolean
): LimitOrderMatchResult {
  const result: LimitOrderMatchResult = {
    amountIn: new BN(0),
    amountOut: new BN(0),
    ammFeeAmount: new BN(0),
  }

  const totalUnfilledAmount = getLimitOrderUnfilledAmount(tick)
  if (swapAmount.isZero() || totalUnfilledAmount.isZero()) {
    return result
  }

  const feeRateBN = new BN(feeRate)
  const feeDenominator = new BN(FEE_RATE_DENOMINATOR)

  if (isBaseInput) {
    // Exact input: swapAmount is the input amount
    if (isFeeOnInput) {
      // fee_amount = swap_amount * fee_rate / FEE_RATE_DENOMINATOR (ceil)
      result.ammFeeAmount = swapAmount.mul(feeRateBN).add(feeDenominator.subn(1)).div(feeDenominator)
      result.amountIn = swapAmount.sub(result.ammFeeAmount)
    } else {
      result.amountIn = swapAmount.clone()
    }

    // Calculate how much limit order tokens we can get
    result.amountOut = getLimitOrderOutput(result.amountIn, tick.tick, swapDirectionZeroForOne)

    // If output exceeds available, recalculate
    if (result.amountOut.gt(totalUnfilledAmount)) {
      result.amountOut = totalUnfilledAmount.clone()
      // Recalculate input needed for this output
      // Note: limit order direction is opposite to swap direction
      result.amountIn = getLimitOrderInput(totalUnfilledAmount, tick.tick, !swapDirectionZeroForOne)

      if (isFeeOnInput) {
        // fee = amount_in * fee_rate / (FEE_RATE_DENOMINATOR - fee_rate) (ceil)
        const feeNumerator = result.amountIn.mul(feeRateBN)
        const feeDenomAdjusted = feeDenominator.subn(feeRate)
        result.ammFeeAmount = feeNumerator.add(feeDenomAdjusted.subn(1)).div(feeDenomAdjusted)
      }
    }
  } else {
    // Exact output: swapAmount is the desired net output
    const netOutput = BN.min(swapAmount, totalUnfilledAmount)

    if (isFeeOnInput) {
      result.amountOut = netOutput.clone()
    } else {
      // total_output = net_output * FEE_RATE_DENOMINATOR / (FEE_RATE_DENOMINATOR - fee_rate) (ceil)
      const grossOutput = netOutput.mul(feeDenominator).add(feeDenominator.subn(feeRate).subn(1)).div(feeDenominator.subn(feeRate))
      result.amountOut = BN.min(grossOutput, totalUnfilledAmount)
    }

    // Calculate input needed
    result.amountIn = getLimitOrderInput(result.amountOut, tick.tick, !swapDirectionZeroForOne)

    if (isFeeOnInput) {
      // fee = amount_in * fee_rate / (FEE_RATE_DENOMINATOR - fee_rate) (ceil)
      const feeNumerator = result.amountIn.mul(feeRateBN)
      const feeDenomAdjusted = feeDenominator.subn(feeRate)
      result.ammFeeAmount = feeNumerator.add(feeDenomAdjusted.subn(1)).div(feeDenomAdjusted)
    }
  }

  // Calculate fee and deduct from output if fee is from output
  if (!isFeeOnInput) {
    result.ammFeeAmount = result.amountOut.mul(feeRateBN).add(feeDenominator.subn(1)).div(feeDenominator)
    result.amountOut = result.amountOut.sub(result.ammFeeAmount)
  }

  return result
}

// ============================================
// Main Swap Simulation
// ============================================

/**
 * Simulate a complete swap across multiple ticks
 *
 * @param pool - Pool state from PoolInfoLayout.decode()
 * @param tickArrays - Array of tick arrays from TickArrayLayout.decode()
 * @param feeRate - Trade fee rate from AmmConfigLayout.decode().tradeFeeRate
 * @param amountSpecified - Amount to swap
 * @param sqrtPriceLimitX64 - Price limit (0 for no limit)
 * @param zeroForOne - Swap direction
 * @param isBaseInput - true for exact input, false for exact output
 * @param blockTimestamp - Optional current block timestamp (defaults to current time)
 * @returns Simulation result
 */
export function swapInternal(
  pool: ReturnType<typeof PoolInfoLayout.decode>,
  tickArrays: ReturnType<typeof TickArrayLayout.decode>[],
  feeRate: number,
  amountSpecified: BN,
  sqrtPriceLimitX64: BN,
  zeroForOne: boolean,
  isBaseInput: boolean,
  blockTimestamp?: number
): SwapSimulationResult {
  // Set default price limit if not specified
  if (sqrtPriceLimitX64.isZero()) {
    sqrtPriceLimitX64 = zeroForOne
      ? new BN(MIN_SQRT_PRICE_X64).addn(1)
      : new BN(MAX_SQRT_PRICE_X64).subn(1)
  }

  // Initialize swap state (convert bigint to BN if needed)
  let amountSpecifiedRemaining = amountSpecified
  let amountCalculated = new BN(0)
  let sqrtPriceX64 = pool.sqrtPriceX64
  let tickCurrent = pool.tickCurrent
  let liquidity = pool.liquidity
  let totalFeeAmount = new BN(0)
  const crossedTicks: number[] = []

  // Dynamic fee state tracking
  const hasDynamicFee = pool.dynamicFeeInfo && pool.dynamicFeeInfo.dynamicFeeControl > 0
  const dynamicFeeControl = hasDynamicFee ? pool.dynamicFeeInfo!.dynamicFeeControl : 0
  const maxVolatilityAccumulator = hasDynamicFee ? pool.dynamicFeeInfo!.maxVolatilityAccumulator : 0
  let tickSpacingIndex = tickSpacingIndexFromTick(tickCurrent, pool.tickSpacing)

  // Apply update_reference logic at start of swap (matches Rust SwapState::new)
  // This may update tickSpacingIndexReference and volatilityReference based on time elapsed
  let tickSpacingIndexReference = hasDynamicFee ? pool.dynamicFeeInfo!.tickSpacingIndexReference : 0
  let volatilityReference = hasDynamicFee ? pool.dynamicFeeInfo!.volatilityReference : 0

  if (hasDynamicFee && pool.dynamicFeeInfo) {
    const currentTimestamp = blockTimestamp ?? Math.floor(Date.now() / 1000)
    const lastUpdateTimestamp = Number(pool.dynamicFeeInfo.lastUpdateTimestamp)
    const filterPeriod = pool.dynamicFeeInfo.filterPeriod
    const decayPeriod = pool.dynamicFeeInfo.decayPeriod
    const reductionFactor = pool.dynamicFeeInfo.reductionFactor

    const timeSinceUpdate = currentTimestamp - lastUpdateTimestamp

    if (timeSinceUpdate < filterPeriod) {
      // High frequency period: no update
    } else if (timeSinceUpdate < decayPeriod) {
      // Decay period: update references with decayed volatility
      tickSpacingIndexReference = tickSpacingIndex
      // volatilityReference = volatilityAccumulator * reductionFactor / 10000
      volatilityReference = Math.floor(pool.dynamicFeeInfo.volatilityAccumulator * reductionFactor / 10000)
    } else {
      // Out of decay window: reset volatility reference to 0
      tickSpacingIndexReference = tickSpacingIndex
      volatilityReference = 0
    }
  }

  // Calculate initial volatility accumulator based on (possibly updated) tick spacing index reference
  // This matches Rust behavior where volatility is recalculated at start of swap
  let volatilityAccumulator = 0
  if (hasDynamicFee) {
    const indexDelta = Math.abs(tickSpacingIndexReference - tickSpacingIndex)
    const newAccumulator = volatilityReference + indexDelta * 10000 // VOLATILITY_ACCUMULATOR_SCALE = 10000
    volatilityAccumulator = Math.min(newAccumulator, maxVolatilityAccumulator)
  }

  // Helper to compute current effective fee rate
  const getCurrentFeeRate = (): number => {
    if (!hasDynamicFee) return feeRate
    return getEffectiveFeeRate(feeRate, {
      volatilityAccumulator,
      dynamicFeeControl,
      maxVolatilityAccumulator,
    }, pool.tickSpacing)
  }

  // Helper to update volatility accumulator (matches Rust logic)
  const updateVolatilityAccumulator = () => {
    if (!hasDynamicFee) return
    const indexDelta = Math.abs(tickSpacingIndexReference - tickSpacingIndex)
    const newAccumulator = volatilityReference + indexDelta * 10000 // VOLATILITY_ACCUMULATOR_SCALE = 10000
    volatilityAccumulator = Math.min(newAccumulator, maxVolatilityAccumulator)
  }

  // Helper to get spacing bounded price (matches Rust get_spacing_bounded_price)
  const getSpacingBoundedPrice = (targetPrice: BN): { isSkipped: boolean; boundedPrice: BN } => {
    if (!hasDynamicFee || liquidity.isZero() || volatilityAccumulator >= maxVolatilityAccumulator) {
      return { isSkipped: true, boundedPrice: targetPrice }
    }

    const tickSpacingI32 = pool.tickSpacing
    const boundedTick = zeroForOne
      ? tickSpacingIndex * tickSpacingI32
      : (tickSpacingIndex + 1) * tickSpacingI32

    const clampedTick = Math.max(-443636, Math.min(443636, boundedTick)) // MIN_TICK, MAX_TICK
    const boundedSqrtPrice = getSqrtPriceAtTick(clampedTick)

    if (zeroForOne) {
      return { isSkipped: false, boundedPrice: BN.max(targetPrice, boundedSqrtPrice) }
    } else {
      return { isSkipped: false, boundedPrice: BN.min(targetPrice, boundedSqrtPrice) }
    }
  }

  // Determine fee collection mode based on pool.feeOn
  // 0 = FromInput, 1 = Token0Only, 2 = Token1Only
  const feeOnInput = isFeeOnInput(pool.feeOn, zeroForOne)

  // Sort tick arrays by start index
  const sortedTickArrays = [...tickArrays].sort((a, b) =>
    zeroForOne ? b.startTickIndex - a.startTickIndex : a.startTickIndex - b.startTickIndex
  )

  // Find current tick array
  const currentTickArrayStart = getTickArrayStartIndex(tickCurrent, pool.tickSpacing)
  let tickArrayIndex = sortedTickArrays.findIndex(ta =>
    ta.startTickIndex === currentTickArrayStart
  )

  if (tickArrayIndex === -1) {
    // No tick array found for current tick
    return {
      amountIn: new BN(0),
      amountOut: new BN(0),
      feeAmount: new BN(0),
      sqrtPriceX64,
      tickCurrent,
      liquidityEnd: liquidity,
      crossedTicks: [],
    }
  }

  // Deep copy tick arrays to track limit order consumption
  const tickArraysCopy = sortedTickArrays.map(ta => ({
    ...ta,
    ticks: ta.ticks.map(t => ({
      ...t,
      ordersAmount: t.ordersAmount.clone(),
      partFilledOrdersRemaining: t.partFilledOrdersRemaining.clone(),
      liquidityNet: t.liquidityNet.clone(),
      liquidityGross: t.liquidityGross.clone(),
    }))
  }))

  // Main swap loop
  while (!amountSpecifiedRemaining.isZero() && !sqrtPriceX64.eq(sqrtPriceLimitX64)) {
    // Find next initialized tick (including limit orders)
    let nextTick: { tick: number; liquidityNet: BN; tickState: ReturnType<typeof TickLayout.decode> } | null = null
    let searchArrayIndex = tickArrayIndex

    while (nextTick === null && searchArrayIndex >= 0 && searchArrayIndex < tickArraysCopy.length) {
      const tickArray = tickArraysCopy[searchArrayIndex]
      nextTick = findNextInitializedTickInArray(tickArray, tickCurrent, zeroForOne)

      if (nextTick === null) {
        // Move to next tick array in swap direction
        // For zeroForOne=true (SELL): sorted descending, so +1 goes to lower tick arrays
        // For zeroForOne=false (BUY): sorted ascending, so +1 goes to higher tick arrays
        searchArrayIndex += 1
        if (searchArrayIndex >= 0 && searchArrayIndex < tickArraysCopy.length) {
          // Get first tick in new array
          const newArray = tickArraysCopy[searchArrayIndex]
          nextTick = getFirstInitializedTick(newArray, zeroForOne)
        }
      }
    }

    // Calculate target price - use price limit if no next tick
    let targetPrice: BN
    let sqrtPriceNextX64: BN

    if (nextTick === null) {
      // No more initialized ticks, swap to price limit
      targetPrice = sqrtPriceLimitX64
      sqrtPriceNextX64 = sqrtPriceLimitX64
    } else {
      sqrtPriceNextX64 = getSqrtPriceAtTick(nextTick.tick)
      targetPrice = zeroForOne
        ? BN.max(sqrtPriceNextX64, sqrtPriceLimitX64)
        : BN.min(sqrtPriceNextX64, sqrtPriceLimitX64)
    }

    // Inner loop: process current tick (AMM liquidity + limit orders)
    let liquidityNext = liquidity

    // Inner loop for tick spacing bounded swaps (when dynamic fee is enabled)
    // This matches Rust's inner loop exactly
    const innerLoopTargetPrice = targetPrice
    while (!amountSpecifiedRemaining.isZero() && !sqrtPriceX64.eq(innerLoopTargetPrice)) {
      // Update volatility accumulator at start of each inner loop (matches Rust line 582)
      updateVolatilityAccumulator()

      // Get current fee rate (may change due to volatility)
      const currentFeeRate = getCurrentFeeRate()

      // Get spacing bounded price
      const { isSkipped, boundedPrice } = getSpacingBoundedPrice(innerLoopTargetPrice)
      const stepTargetPrice = boundedPrice

      // Compute swap step using AMM liquidity
      const isPriceChange = !sqrtPriceX64.eq(stepTargetPrice)
      let stepAmountIn = new BN(0)
      let stepAmountOut = new BN(0)
      let stepFeeAmount = new BN(0)
      let stepSqrtPriceNextX64 = sqrtPriceX64

      if (isPriceChange) {
        const stepResult = computeSwapStep(
          sqrtPriceX64,
          stepTargetPrice,
          liquidity,
          amountSpecifiedRemaining,
          currentFeeRate,
          isBaseInput,
          zeroForOne,
          feeOnInput
        )

        stepAmountIn = stepResult.amountIn
        stepAmountOut = stepResult.amountOut
        stepFeeAmount = stepResult.feeAmount
        stepSqrtPriceNextX64 = stepResult.sqrtPriceNextX64

        // Apply swap amounts
        if (isBaseInput) {
          if (feeOnInput) {
            const amountInConsumed = stepAmountIn.add(stepFeeAmount)
            amountSpecifiedRemaining = amountSpecifiedRemaining.sub(amountInConsumed)
            amountCalculated = amountCalculated.add(stepAmountOut)
          } else {
            amountSpecifiedRemaining = amountSpecifiedRemaining.sub(stepAmountIn)
            amountCalculated = amountCalculated.add(stepAmountOut)
          }
        } else {
          if (feeOnInput) {
            amountSpecifiedRemaining = amountSpecifiedRemaining.sub(stepAmountOut)
            const amountInConsumed = stepAmountIn.add(stepFeeAmount)
            amountCalculated = amountCalculated.add(amountInConsumed)
          } else {
            amountSpecifiedRemaining = amountSpecifiedRemaining.sub(stepAmountOut)
            amountCalculated = amountCalculated.add(stepAmountIn)
          }
        }

        totalFeeAmount = totalFeeAmount.add(stepFeeAmount)
        sqrtPriceX64 = stepSqrtPriceNextX64
      }

      // Check if we've reached the inner target or should exit (matches Rust line 704)
      if (amountSpecifiedRemaining.isZero() || sqrtPriceX64.eq(innerLoopTargetPrice)) {
        break
      }

      // Update tick spacing index at END of loop iteration (matches Rust line 716 update_dynamic_fee_index)
      // This is the key difference: Rust updates tickSpacingIndex AFTER the break check, only when continuing
      if (hasDynamicFee) {
        if (isSkipped) {
          // When skipped, recalculate tickSpacingIndex based on current tick, then update volatility
          const tickIndex = sqrtPriceX64.eq(sqrtPriceNextX64) ? (nextTick?.tick ?? tickCurrent) : tickCurrent
          let newTickSpacingIndex = tickSpacingIndexFromTick(tickIndex, pool.tickSpacing)
          // Special adjustment for !zeroForOne when tick is on spacing boundary
          if (!zeroForOne && tickIndex % pool.tickSpacing === 0) {
            newTickSpacingIndex = newTickSpacingIndex - 1
          }
          tickSpacingIndex = newTickSpacingIndex
          // Update volatility accumulator again after recalculating index
          updateVolatilityAccumulator()
        }
        // Always increment/decrement tickSpacingIndex
        tickSpacingIndex += zeroForOne ? -1 : 1
      }
    }

    // Check if we reached the next tick boundary
    if (nextTick !== null && sqrtPriceX64.eq(sqrtPriceNextX64)) {
      // Try to match limit orders on this tick
      const tickHasLimitOrders = hasLimitOrders(nextTick.tickState)

      if (tickHasLimitOrders && !amountSpecifiedRemaining.isZero()) {
        const currentFeeRate = getCurrentFeeRate()
        const limitOrderResult = matchLimitOrder(
          nextTick.tickState,
          amountSpecifiedRemaining,
          zeroForOne,
          isBaseInput,
          currentFeeRate,
          feeOnInput
        )

        if (!limitOrderResult.amountIn.isZero()) {
          // Apply limit order match amounts
          if (isBaseInput) {
            if (feeOnInput) {
              const amountInConsumed = limitOrderResult.amountIn.add(limitOrderResult.ammFeeAmount)
              amountSpecifiedRemaining = amountSpecifiedRemaining.sub(amountInConsumed)
              amountCalculated = amountCalculated.add(limitOrderResult.amountOut)
            } else {
              amountSpecifiedRemaining = amountSpecifiedRemaining.sub(limitOrderResult.amountIn)
              amountCalculated = amountCalculated.add(limitOrderResult.amountOut)
            }
          } else {
            if (feeOnInput) {
              amountSpecifiedRemaining = amountSpecifiedRemaining.sub(limitOrderResult.amountOut)
              const amountInConsumed = limitOrderResult.amountIn.add(limitOrderResult.ammFeeAmount)
              amountCalculated = amountCalculated.add(amountInConsumed)
            } else {
              amountSpecifiedRemaining = amountSpecifiedRemaining.sub(limitOrderResult.amountOut)
              amountCalculated = amountCalculated.add(limitOrderResult.amountIn)
            }
          }

          totalFeeAmount = totalFeeAmount.add(limitOrderResult.ammFeeAmount)

          // Update the tick's limit order state (consume the matched amount)
          const consumedAmount = limitOrderResult.amountOut
          if (!nextTick.tickState.partFilledOrdersRemaining.isZero()) {
            const consumeFromPart = BN.min(nextTick.tickState.partFilledOrdersRemaining, consumedAmount)
            nextTick.tickState.partFilledOrdersRemaining = nextTick.tickState.partFilledOrdersRemaining.sub(consumeFromPart)
            const remaining = consumedAmount.sub(consumeFromPart)
            if (!remaining.isZero()) {
              nextTick.tickState.ordersAmount = nextTick.tickState.ordersAmount.sub(remaining)
            }
          } else {
            nextTick.tickState.ordersAmount = nextTick.tickState.ordersAmount.sub(consumedAmount)
          }
        }
      }

      // Check if we should cross the tick (only if it has liquidity and no more limit orders)
      const tickStillHasLimitOrders = hasLimitOrders(nextTick.tickState)
      const tickHasLiquidity = !nextTick.tickState.liquidityGross.isZero()

      if (tickHasLiquidity && !tickStillHasLimitOrders) {
        // Crossed tick, update liquidity
        crossedTicks.push(nextTick.tick)

        const liquidityNet = zeroForOne ? nextTick.liquidityNet.neg() : nextTick.liquidityNet
        liquidityNext = addDelta(liquidity, liquidityNet)
      }

      // Update tick based on limit order status and swap direction
      if ((zeroForOne && !tickStillHasLimitOrders) || (!zeroForOne && tickStillHasLimitOrders)) {
        tickCurrent = nextTick.tick - 1
      } else {
        tickCurrent = nextTick.tick
      }

      // Update tick array index
      tickArrayIndex = searchArrayIndex
    }

    liquidity = liquidityNext

    // If we reached the price limit without crossing a tick, exit
    if (nextTick === null) {
      break
    }
  }

  // Calculate final amounts based on fee collection mode
  const amountUsed = amountSpecified.sub(amountSpecifiedRemaining)

  let amountIn: BN
  let amountOut: BN

  if (isBaseInput) {
    if (feeOnInput) {
      // Fee from input: amountUsed = gross input (net input + fee)
      amountIn = amountUsed
      amountOut = amountCalculated
    } else {
      // Fee from output: amountUsed = net input, amountOut includes fee deducted
      amountIn = amountUsed
      amountOut = amountCalculated // amountOut already has fee deducted in computeSwapStep
    }
  } else {
    if (feeOnInput) {
      // Fee from input: amountUsed = gross output, amountCalculated = gross input (net + fee)
      amountIn = amountCalculated
      amountOut = amountUsed
    } else {
      // Fee from output: amountUsed = net output, amountCalculated = net input
      amountIn = amountCalculated
      amountOut = amountUsed
    }
  }

  return {
    amountIn,
    amountOut,
    feeAmount: totalFeeAmount,
    sqrtPriceX64,
    tickCurrent,
    liquidityEnd: liquidity,
    crossedTicks,
  }
}

/**
 * Check if a tick is initialized (has liquidityGross > 0 OR has limit orders)
 */
function isTickInitialized(tick: ReturnType<typeof TickLayout.decode>): boolean {
  return !tick.liquidityGross.isZero() || hasLimitOrders(tick)
}

/**
 * Find next initialized tick in a single tick array
 */
function findNextInitializedTickInArray(
  tickArray: ReturnType<typeof TickArrayLayout.decode>,
  currentTick: number,
  zeroForOne: boolean
): { tick: number; liquidityNet: BN; tickState: ReturnType<typeof TickLayout.decode> } | null {
  const ticks = tickArray.ticks.filter(t => isTickInitialized(t))

  if (zeroForOne) {
    // Find highest initialized tick <= currentTick
    const candidates = ticks.filter(t => t.tick <= currentTick)
    if (candidates.length === 0) return null
    const best = candidates.reduce((best, t) => t.tick > best.tick ? t : best)
    return { tick: best.tick, liquidityNet: best.liquidityNet, tickState: best }
  } else {
    // Find lowest initialized tick > currentTick
    const candidates = ticks.filter(t => t.tick > currentTick)
    if (candidates.length === 0) return null
    const best = candidates.reduce((best, t) => t.tick < best.tick ? t : best)
    return { tick: best.tick, liquidityNet: best.liquidityNet, tickState: best }
  }
}

/**
 * Get first initialized tick in array based on direction
 */
function getFirstInitializedTick(
  tickArray: ReturnType<typeof TickArrayLayout.decode>,
  zeroForOne: boolean
): { tick: number; liquidityNet: BN; tickState: ReturnType<typeof TickLayout.decode> } | null {
  const ticks = tickArray.ticks.filter(t => isTickInitialized(t))
  if (ticks.length === 0) return null

  if (zeroForOne) {
    // Get highest tick in array
    const best = ticks.reduce((best, t) => t.tick > best.tick ? t : best)
    return { tick: best.tick, liquidityNet: best.liquidityNet, tickState: best }
  } else {
    // Get lowest tick in array
    const best = ticks.reduce((best, t) => t.tick < best.tick ? t : best)
    return { tick: best.tick, liquidityNet: best.liquidityNet, tickState: best }
  }
}
