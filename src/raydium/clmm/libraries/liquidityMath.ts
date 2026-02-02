import { ApiV3PoolInfoConcentratedItem } from "@/api"
import { getTransferAmountFeeV2, minExpirationTime } from "@/common"
import { EpochInfo } from "@solana/web3.js"
import BN from "bn.js"
import Decimal from "decimal.js"
import { ReturnTypeGetLiquidityAmountOut } from "../type"
import { mulDivFloor } from "./bigNum"
import { BN_ZERO, Q64 } from "./constants"
import {
  getAmountADeltaUnsigned,
  getAmountBDeltaUnsigned,
} from "./sqrtPriceMath"
import { getSqrtPriceAtTick, priceToSqrtPriceX64 } from "./tickMath"


export function addDelta(x: BN, y: BN): BN {
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

export function getLiquidityFromAmountA(
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

export function getLiquidityFromAmountB(
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

export function getLiquidityFromAmounts(
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
    return getLiquidityFromAmountA(sqrtPriceLowerX64, sqrtPriceUpperX64, amountA)
  } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
    const liquidityA = getLiquidityFromAmountA(sqrtPriceCurrentX64, sqrtPriceUpperX64, amountA)
    const liquidityB = getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceCurrentX64, amountB)
    return liquidityA.lt(liquidityB) ? liquidityA : liquidityB
  } else {
    return getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceUpperX64, amountB)
  }
}

export function getLiquidityFromSingleAmountA(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  amountA: BN
): BN {
  if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
    [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
  }

  if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
    return getLiquidityFromAmountA(sqrtPriceLowerX64, sqrtPriceUpperX64, amountA)
  } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
    return getLiquidityFromAmountA(sqrtPriceCurrentX64, sqrtPriceUpperX64, amountA)
  } else {
    return BN_ZERO
  }
}

export function getLiquidityFromSingleAmountB(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  amountB: BN
): BN {
  if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
    [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
  }

  if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
    return BN_ZERO
  } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
    return getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceCurrentX64, amountB)
  } else {
    return getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceUpperX64, amountB)
  }
}

export function getAmountForLiquidityA(
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN,
  roundUp: boolean,
): BN {
  return getAmountADeltaUnsigned(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
}

export function getAmountForLiquidityB(
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN,
  roundUp: boolean,
): BN {
  return getAmountBDeltaUnsigned(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
}

export function getAmountsForLiquidity(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN,
  roundUp: boolean,
): { amountA: BN, amountB: BN } {
  if (sqrtPriceLowerX64.gt(sqrtPriceUpperX64)) {
    [sqrtPriceLowerX64, sqrtPriceUpperX64] = [sqrtPriceUpperX64, sqrtPriceLowerX64]
  }

  let amountA = BN_ZERO
  let amountB = BN_ZERO

  if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
    amountA = getAmountForLiquidityA(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
  } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
    amountA = getAmountForLiquidityA(sqrtPriceCurrentX64, sqrtPriceUpperX64, liquidity, roundUp)
    amountB = getAmountForLiquidityB(sqrtPriceLowerX64, sqrtPriceCurrentX64, liquidity, roundUp)
  } else {
    amountB = getAmountForLiquidityB(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp)
  }

  return { amountA, amountB }
}

export function getDeltaAmountASigned(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  liquidity: BN
): BN {
  if (liquidity.isNeg()) {
    return getAmountForLiquidityA(sqrtPriceAX64, sqrtPriceBX64, liquidity.neg(), false).neg()
  } else {
    return getAmountForLiquidityA(sqrtPriceAX64, sqrtPriceBX64, liquidity, true)
  }
}

export function getDeltaAmountBSigned(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  liquidity: BN
): BN {
  if (liquidity.isNeg()) {
    return getAmountForLiquidityB(sqrtPriceAX64, sqrtPriceBX64, liquidity.neg(), false).neg()
  } else {
    return getAmountForLiquidityB(sqrtPriceAX64, sqrtPriceBX64, liquidity, true)
  }
}

export function getDeltaAmountsSigned(
  tickCurrent: number,
  sqrtPriceX64Current: BN,
  tickLower: number,
  tickUpper: number,
  liquidityDelta: BN
): { amountA: BN, amountB: BN } {
  let amountA = BN_ZERO
  let amountB = BN_ZERO

  if (tickCurrent < tickLower) {
    amountA = getDeltaAmountASigned(
      getSqrtPriceAtTick(tickLower),
      getSqrtPriceAtTick(tickUpper),
      liquidityDelta
    )
  } else if (tickCurrent < tickUpper) {
    amountA = getDeltaAmountASigned(
      sqrtPriceX64Current,
      getSqrtPriceAtTick(tickUpper),
      liquidityDelta
    )
    amountB = getDeltaAmountBSigned(
      getSqrtPriceAtTick(tickLower),
      sqrtPriceX64Current,
      liquidityDelta
    )
  } else {
    amountB = getDeltaAmountBSigned(
      getSqrtPriceAtTick(tickLower),
      getSqrtPriceAtTick(tickUpper),
      liquidityDelta
    )
  }

  return { amountA, amountB }
}

export function isPositionInRange(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN
): boolean {
  return sqrtPriceCurrentX64.gte(sqrtPriceLowerX64) && sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)
}

export function getPositionValue(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN
): BN {
  const { amountA, amountB } = getAmountsForLiquidity(
    sqrtPriceCurrentX64,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    liquidity,
    false
  )

  const amountAInTokenB = mulDivFloor(
    amountA,
    sqrtPriceCurrentX64.mul(sqrtPriceCurrentX64),
    Q64.mul(Q64)
  )

  return amountAInTokenB.add(amountB)
}

export function getAmountsFromLiquidityWithSlippage(
  sqrtPriceCurrentX64: BN,
  sqrtPriceX64A: BN,
  sqrtPriceX64B: BN,
  liquidity: BN,
  amountMax: boolean,
  roundUp: boolean,
  amountSlippage: number,
): { amountSlippageA: BN; amountSlippageB: BN } {
  const { amountA, amountB } = getAmountsForLiquidity(
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

export function getAmountsOutFromLiquidity({
  poolInfo,
  tickLower,
  tickUpper,
  liquidity,
  slippage,
  add,
  epochInfo,
  amountAddFee,
}: {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  tickLower: number;
  tickUpper: number;
  liquidity: BN;
  slippage: number;
  add: boolean;

  epochInfo: EpochInfo;
  amountAddFee: boolean;
}): ReturnTypeGetLiquidityAmountOut {
  const sqrtPriceX64 = priceToSqrtPriceX64(
    new Decimal(poolInfo.price),
    poolInfo.mintA.decimals,
    poolInfo.mintB.decimals,
  );

  const sqrtPriceX64A = getSqrtPriceAtTick(tickLower);
  const sqrtPriceX64B = getSqrtPriceAtTick(tickUpper);

  const coefficientRe = add ? 1 + slippage : 1 - slippage;

  const amounts = getAmountsForLiquidity(sqrtPriceX64, sqrtPriceX64A, sqrtPriceX64B, liquidity, add);

  const [amountA, amountB] = [
    getTransferAmountFeeV2(amounts.amountA, poolInfo.mintA.extensions?.feeConfig, epochInfo, amountAddFee),
    getTransferAmountFeeV2(amounts.amountB, poolInfo.mintB.extensions?.feeConfig, epochInfo, amountAddFee),
  ];
  const [amountSlippageA, amountSlippageB] = [
    getTransferAmountFeeV2(
      new BN(new Decimal(amounts.amountA.toString()).mul(coefficientRe).toFixed(0)),
      poolInfo.mintA.extensions?.feeConfig,
      epochInfo,
      amountAddFee,
    ),
    getTransferAmountFeeV2(
      new BN(new Decimal(amounts.amountB.toString()).mul(coefficientRe).toFixed(0)),
      poolInfo.mintB.extensions?.feeConfig,
      epochInfo,
      amountAddFee,
    ),
  ];

  return {
    liquidity,
    amountA,
    amountB,
    amountSlippageA,
    amountSlippageB,
    expirationTime: minExpirationTime(amountA.expirationTime, amountB.expirationTime),
  };
}