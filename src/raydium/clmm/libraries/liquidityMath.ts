import BN from "bn.js"
import Decimal from "decimal.js"
import { divRoundingUp, mulDivCeil, mulDivFloor } from "./bigNum"
import { BN_ZERO, Q64, RESOLUTION, U64_MAX } from "./constants"
import { SqrtPriceMath } from "./sqrtPriceMath"


export class LiquidityMathUtil {
  static getDeltaAmountAUnsigned(
    sqrtPriceX64A: BN,
    sqrtPriceX64B: BN,
    liquidity: BN,
    roundUp: boolean
  ): BN {
    if (sqrtPriceX64A.gt(sqrtPriceX64B)) {
      [sqrtPriceX64A, sqrtPriceX64B] = [sqrtPriceX64B, sqrtPriceX64A]
    }

    const numerator1 = liquidity.shln(RESOLUTION)
    const numerator2 = sqrtPriceX64B.sub(sqrtPriceX64A)

    if (!sqrtPriceX64A.gt(BN_ZERO)) throw Error('!sqrtPriceX64A.gt(BN_ZERO)')

    const result = roundUp ? divRoundingUp(mulDivCeil(numerator1, numerator2, sqrtPriceX64B), sqrtPriceX64A) : mulDivFloor(numerator1, numerator2, sqrtPriceX64B).div(sqrtPriceX64A)

    if (result.gt(U64_MAX)) throw Error('MaxTokenOverflow')

    return result
  }

  static getDeltaAmountBUnsigned(
    sqrtPriceX64A: BN,
    sqrtPriceX64B: BN,
    liquidity: BN,
    roundUp: boolean
  ): BN {
    if (sqrtPriceX64A.gt(sqrtPriceX64B)) {
      [sqrtPriceX64A, sqrtPriceX64B] = [sqrtPriceX64B, sqrtPriceX64A]
    }

    const result = roundUp ? mulDivCeil(liquidity, sqrtPriceX64B.sub(sqrtPriceX64A), Q64) : mulDivFloor(liquidity, sqrtPriceX64B.sub(sqrtPriceX64A), Q64)

    if (result.gt(U64_MAX)) throw Error('MaxTokenOverflow')

    return result
  }

  static addDelta(x: BN, y: BN): BN {
    if (y.isNeg()) {
      const absY = y.neg()
      if (x.lt(absY)) {
        throw new Error("Liquidity underflow")
      }
      return x.sub(absY)
    } else {
      return x.add(y)
    }
  }

  static getLiquidityFromAmountA(
    sqrtPriceLowerX64: BN,
    sqrtPriceUpperX64: BN,
    amountA: BN
  ): BN {
    if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
      [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
    }

    const intermediate = mulDivFloor(sqrtPriceLowerX64, sqrtPriceUpperX64, Q64)

    const priceDelta = sqrtPriceUpperX64.sub(sqrtPriceLowerX64)

    return mulDivFloor(amountA, intermediate, priceDelta)
  }

  static getLiquidityFromAmountB(
    sqrtPriceLowerX64: BN,
    sqrtPriceUpperX64: BN,
    amountB: BN
  ): BN {
    if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
      [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
    }

    const priceDelta = sqrtPriceUpperX64.sub(sqrtPriceLowerX64)

    return mulDivFloor(amountB, Q64, priceDelta)
  }

  static getLiquidityFromAmounts(
    sqrtPriceCurrentX64: BN,
    sqrtPriceLowerX64: BN,
    sqrtPriceUpperX64: BN,
    amountA: BN,
    amountB: BN
  ): BN {
    if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
      [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
    }

    if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
      return this.getLiquidityFromAmountA(sqrtPriceLowerX64, sqrtPriceUpperX64, amountA)
    } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
      const liquidityA = this.getLiquidityFromAmountA(sqrtPriceCurrentX64, sqrtPriceUpperX64, amountA)
      const liquidityB = this.getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceCurrentX64, amountB)
      return liquidityA.lt(liquidityB) ? liquidityA : liquidityB
    } else {
      return this.getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceUpperX64, amountB)
    }
  }

  static getAmountForLiquidityA(
    sqrtPriceLowerX64: BN,
    sqrtPriceUpperX64: BN,
    liquidity: BN,
    roundUp: boolean
  ): BN {
    return SqrtPriceMath.getAmountADeltaUnsigned(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
  }

  static getAmountForLiquidityB(
    sqrtPriceLowerX64: BN,
    sqrtPriceUpperX64: BN,
    liquidity: BN,
    roundUp: boolean
  ): BN {
    return SqrtPriceMath.getAmountBDeltaUnsigned(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
  }

  static getAmountsForLiquidity(
    sqrtPriceCurrentX64: BN,
    sqrtPriceLowerX64: BN,
    sqrtPriceUpperX64: BN,
    liquidity: BN,
    roundUp: boolean
  ) {
    if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
      [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
    }

    let amountA = BN_ZERO
    let amountB = BN_ZERO

    if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
      amountA = this.getAmountForLiquidityA(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
    } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
      amountA = this.getAmountForLiquidityA(sqrtPriceCurrentX64, sqrtPriceUpperX64, liquidity, roundUp)
      amountB = this.getAmountForLiquidityB(sqrtPriceLowerX64, sqrtPriceCurrentX64, liquidity, roundUp)
    } else {
      amountB = this.getAmountForLiquidityB(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
    }

    return { amountA, amountB }
  }

  static getAmountsFromLiquidityWithSlippage(
    sqrtPriceCurrentX64: BN,
    sqrtPriceX64A: BN,
    sqrtPriceX64B: BN,
    liquidity: BN,
    amountMax: boolean,
    roundUp: boolean,
    amountSlippage: number,
  ): { amountSlippageA: BN; amountSlippageB: BN } {
    const { amountA, amountB } = this.getAmountsForLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      roundUp,
    );
    const coefficient = amountMax ? 1 + amountSlippage : 1 - amountSlippage;

    const amount0Slippage = new BN(new Decimal(amountA.toString()).mul(coefficient).toFixed(0));
    const amount1Slippage = new BN(new Decimal(amountB.toString()).mul(coefficient).toFixed(0));
    return {
      amountSlippageA: amount0Slippage,
      amountSlippageB: amount1Slippage,
    };
  }
}
