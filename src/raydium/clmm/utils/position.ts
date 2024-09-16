import BN from "bn.js";

import Decimal from "decimal.js";
import { getTransferAmountFeeV2, minExpirationTime } from "../../../common";
import { ClmmPositionLayout } from "../layout";
import { ClmmPoolInfo, ClmmPoolPersonalPosition, ClmmPoolRewardInfo, GetAmountParams, ReturnTypeGetLiquidityAmountOut } from "../type";
import { Q64 } from "./constants";
import { LiquidityMath, MathUtil, SqrtPriceMath } from "./math";
import { Tick } from "./tick";

export class PositionUtils {
  static getfeeGrowthInside(
    poolState: Pick<ClmmPoolInfo, "tickCurrent" | "feeGrowthGlobalX64A" | "feeGrowthGlobalX64B">,
    tickLowerState: Tick,
    tickUpperState: Tick,
  ): { feeGrowthInsideX64A: BN; feeGrowthInsideBX64: BN } {
    let feeGrowthBelowX64A = new BN(0);
    let feeGrowthBelowX64B = new BN(0);
    if (poolState.tickCurrent >= tickLowerState.tick) {
      feeGrowthBelowX64A = tickLowerState.feeGrowthOutsideX64A;
      feeGrowthBelowX64B = tickLowerState.feeGrowthOutsideX64B;
    } else {
      feeGrowthBelowX64A = poolState.feeGrowthGlobalX64A.sub(tickLowerState.feeGrowthOutsideX64A);
      feeGrowthBelowX64B = poolState.feeGrowthGlobalX64B.sub(tickLowerState.feeGrowthOutsideX64B);
    }

    let feeGrowthAboveX64A = new BN(0);
    let feeGrowthAboveX64B = new BN(0);
    if (poolState.tickCurrent < tickUpperState.tick) {
      feeGrowthAboveX64A = tickUpperState.feeGrowthOutsideX64A;
      feeGrowthAboveX64B = tickUpperState.feeGrowthOutsideX64B;
    } else {
      feeGrowthAboveX64A = poolState.feeGrowthGlobalX64A.sub(tickUpperState.feeGrowthOutsideX64A);
      feeGrowthAboveX64B = poolState.feeGrowthGlobalX64B.sub(tickUpperState.feeGrowthOutsideX64B);
    }

    const feeGrowthInsideX64A = MathUtil.wrappingSubU128(
      MathUtil.wrappingSubU128(poolState.feeGrowthGlobalX64A, feeGrowthBelowX64A),
      feeGrowthAboveX64A,
    );
    const feeGrowthInsideBX64 = MathUtil.wrappingSubU128(
      MathUtil.wrappingSubU128(poolState.feeGrowthGlobalX64B, feeGrowthBelowX64B),
      feeGrowthAboveX64B,
    );
    return { feeGrowthInsideX64A, feeGrowthInsideBX64 };
  }

  static GetPositionFees(
    ammPool: ClmmPoolInfo,
    positionState: ClmmPoolPersonalPosition,
    tickLowerState: Tick,
    tickUpperState: Tick,
  ): { tokenFeeAmountA: BN; tokenFeeAmountB: BN } {
    const { feeGrowthInsideX64A, feeGrowthInsideBX64 } = this.getfeeGrowthInside(
      ammPool,
      tickLowerState,
      tickUpperState,
    );

    const feeGrowthdeltaA = MathUtil.mulDivFloor(
      MathUtil.wrappingSubU128(feeGrowthInsideX64A, positionState.feeGrowthInsideLastX64A),
      positionState.liquidity,
      Q64,
    );
    const tokenFeeAmountA = positionState.tokenFeesOwedA.add(feeGrowthdeltaA);

    const feeGrowthdelta1 = MathUtil.mulDivFloor(
      MathUtil.wrappingSubU128(feeGrowthInsideBX64, positionState.feeGrowthInsideLastX64B),
      positionState.liquidity,
      Q64,
    );
    const tokenFeeAmountB = positionState.tokenFeesOwedB.add(feeGrowthdelta1);

    return { tokenFeeAmountA, tokenFeeAmountB };
  }

  static GetPositionFeesV2(
    ammPool: Pick<ClmmPoolInfo, "tickCurrent" | "feeGrowthGlobalX64A" | "feeGrowthGlobalX64B">,
    positionState: ClmmPositionLayout,
    tickLowerState: Tick,
    tickUpperState: Tick,
  ): { tokenFeeAmountA: BN; tokenFeeAmountB: BN } {
    const { feeGrowthInsideX64A, feeGrowthInsideBX64 } = this.getfeeGrowthInside(
      ammPool,
      tickLowerState,
      tickUpperState,
    );

    const feeGrowthdeltaA = MathUtil.mulDivFloor(
      MathUtil.wrappingSubU128(feeGrowthInsideX64A, positionState.feeGrowthInsideLastX64A),
      positionState.liquidity,
      Q64,
    );
    const tokenFeeAmountA = positionState.tokenFeesOwedA.add(feeGrowthdeltaA);

    const feeGrowthdelta1 = MathUtil.mulDivFloor(
      MathUtil.wrappingSubU128(feeGrowthInsideBX64, positionState.feeGrowthInsideLastX64B),
      positionState.liquidity,
      Q64,
    );
    const tokenFeeAmountB = positionState.tokenFeesOwedB.add(feeGrowthdelta1);

    return { tokenFeeAmountA, tokenFeeAmountB };
  }

  static GetPositionRewardsV2(
    ammPool: Pick<ClmmPoolInfo, "tickCurrent" | "feeGrowthGlobalX64B"> & {
      rewardInfos: { rewardGrowthGlobalX64: BN }[];
    },
    positionState: ClmmPositionLayout,
    tickLowerState: Tick,
    tickUpperState: Tick,
  ): BN[] {
    const rewards: BN[] = [];

    const rewardGrowthsInside = this.getRewardGrowthInsideV2(
      ammPool.tickCurrent,
      tickLowerState,
      tickUpperState,
      ammPool.rewardInfos,
    );
    for (let i = 0; i < rewardGrowthsInside.length; i++) {
      const rewardGrowthInside = rewardGrowthsInside[i];
      const currRewardInfo = positionState.rewardInfos[i];

      const rewardGrowthDelta = MathUtil.wrappingSubU128(rewardGrowthInside, currRewardInfo.growthInsideLastX64);
      const amountOwedDelta = MathUtil.mulDivFloor(rewardGrowthDelta, positionState.liquidity, Q64);
      const rewardAmountOwed = currRewardInfo.rewardAmountOwed.add(amountOwedDelta);
      rewards.push(rewardAmountOwed);
    }
    return rewards;
  }

  static GetPositionRewards(
    ammPool: ClmmPoolInfo,
    positionState: ClmmPoolPersonalPosition,
    tickLowerState: Tick,
    tickUpperState: Tick,
  ): BN[] {
    const rewards: BN[] = [];

    const rewardGrowthsInside = this.getRewardGrowthInside(
      ammPool.tickCurrent,
      tickLowerState,
      tickUpperState,
      ammPool.rewardInfos,
    );
    for (let i = 0; i < rewardGrowthsInside.length; i++) {
      const rewardGrowthInside = rewardGrowthsInside[i];
      const currRewardInfo = positionState.rewardInfos[i];

      const rewardGrowthDelta = MathUtil.wrappingSubU128(rewardGrowthInside, currRewardInfo.growthInsideLastX64);
      const amountOwedDelta = MathUtil.mulDivFloor(rewardGrowthDelta, positionState.liquidity, Q64);
      const rewardAmountOwed = currRewardInfo.rewardAmountOwed.add(amountOwedDelta);
      rewards.push(rewardAmountOwed);
    }
    return rewards;
  }

  static getRewardGrowthInside(
    tickCurrentIndex: number,
    tickLowerState: Tick,
    tickUpperState: Tick,
    rewardInfos: ClmmPoolRewardInfo[],
  ): BN[] {
    const rewardGrowthsInside: BN[] = [];
    for (let i = 0; i < rewardInfos.length; i++) {
      let rewardGrowthsBelow = new BN(0);
      if (tickLowerState.liquidityGross.eqn(0)) {
        rewardGrowthsBelow = rewardInfos[i].rewardGrowthGlobalX64;
      } else if (tickCurrentIndex < tickLowerState.tick) {
        rewardGrowthsBelow = rewardInfos[i].rewardGrowthGlobalX64.sub(tickLowerState.rewardGrowthsOutsideX64[i]);
      } else {
        rewardGrowthsBelow = tickLowerState.rewardGrowthsOutsideX64[i];
      }

      let rewardGrowthsAbove = new BN(0);
      if (tickUpperState.liquidityGross.eqn(0)) {
        //
      } else if (tickCurrentIndex < tickUpperState.tick) {
        rewardGrowthsAbove = tickUpperState.rewardGrowthsOutsideX64[i];
      } else {
        rewardGrowthsAbove = rewardInfos[i].rewardGrowthGlobalX64.sub(tickUpperState.rewardGrowthsOutsideX64[i]);
      }

      rewardGrowthsInside.push(
        MathUtil.wrappingSubU128(
          MathUtil.wrappingSubU128(rewardInfos[i].rewardGrowthGlobalX64, rewardGrowthsBelow),
          rewardGrowthsAbove,
        ),
      );
    }

    return rewardGrowthsInside;
  }

  static getRewardGrowthInsideV2(
    tickCurrentIndex: number,
    tickLowerState: Tick,
    tickUpperState: Tick,
    rewardInfos: Pick<ClmmPoolRewardInfo, "rewardGrowthGlobalX64">[],
  ): BN[] {
    const rewardGrowthsInside: BN[] = [];
    for (let i = 0; i < rewardInfos.length; i++) {
      let rewardGrowthsBelow = new BN(0);
      if (tickLowerState.liquidityGross.eqn(0)) {
        rewardGrowthsBelow = rewardInfos[i].rewardGrowthGlobalX64;
      } else if (tickCurrentIndex < tickLowerState.tick) {
        rewardGrowthsBelow = rewardInfos[i].rewardGrowthGlobalX64.sub(tickLowerState.rewardGrowthsOutsideX64[i]);
      } else {
        rewardGrowthsBelow = tickLowerState.rewardGrowthsOutsideX64[i];
      }

      let rewardGrowthsAbove = new BN(0);
      if (tickUpperState.liquidityGross.eqn(0)) {
        //
      } else if (tickCurrentIndex < tickUpperState.tick) {
        rewardGrowthsAbove = tickUpperState.rewardGrowthsOutsideX64[i];
      } else {
        rewardGrowthsAbove = rewardInfos[i].rewardGrowthGlobalX64.sub(tickUpperState.rewardGrowthsOutsideX64[i]);
      }

      rewardGrowthsInside.push(
        MathUtil.wrappingSubU128(
          MathUtil.wrappingSubU128(rewardInfos[i].rewardGrowthGlobalX64, rewardGrowthsBelow),
          rewardGrowthsAbove,
        ),
      );
    }

    return rewardGrowthsInside;
  }

  static getAmountsFromLiquidity({
    poolInfo,
    ownerPosition,
    liquidity,
    slippage,
    add,
    epochInfo,
  }: GetAmountParams): ReturnTypeGetLiquidityAmountOut {
    const sqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(poolInfo.price),
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickLower);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickUpper);

    const coefficientRe = add ? 1 + slippage : 1 - slippage;

    const amounts = LiquidityMath.getAmountsFromLiquidity(sqrtPriceX64, sqrtPriceX64A, sqrtPriceX64B, liquidity, add);

    const [amountA, amountB] = [
      getTransferAmountFeeV2(amounts.amountA, poolInfo.mintA.extensions?.feeConfig, epochInfo, true),
      getTransferAmountFeeV2(amounts.amountB, poolInfo.mintB.extensions?.feeConfig, epochInfo, true),
    ];
    const [amountSlippageA, amountSlippageB] = [
      getTransferAmountFeeV2(
        new BN(new Decimal(amounts.amountA.toString()).mul(coefficientRe).toFixed(0)),
        poolInfo.mintA.extensions?.feeConfig,
        epochInfo,
        true,
      ),
      getTransferAmountFeeV2(
        new BN(new Decimal(amounts.amountB.toString()).mul(coefficientRe).toFixed(0)),
        poolInfo.mintB.extensions?.feeConfig,
        epochInfo,
        true,
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
}
