import BN from "bn.js";
import { LimitOrderLayout, TickLayout } from "../layout";
import { mulDivFloor } from "./bigNum";
import { BN_ONE, BN_ZERO } from "./constants";
import { TickUtil } from "./tickArrayUtil";

export class LimitOrderMath {
  public static isFullyFilled({ orderInfo }: { orderInfo: ReturnType<typeof LimitOrderLayout.decode> }): boolean {
    return orderInfo.totalAmount.eq(orderInfo.filledAmount);
  }

  public static getUnFilledAmount({ orderInfo }: { orderInfo: ReturnType<typeof LimitOrderLayout.decode> }): BN {
    return orderInfo.totalAmount.sub(orderInfo.filledAmount);
  }

  public static settleFilledOrder({
    orderInfo,
    tickInfo,
  }: {
    orderInfo: ReturnType<typeof LimitOrderLayout.decode>;
    tickInfo: ReturnType<typeof TickLayout.decode>;
  }): BN {
    if (orderInfo.settleBase.isZero()) return BN_ZERO

    if (orderInfo.orderPhase.eq(tickInfo.orderPhase)) {
      return BN_ZERO
    } else if (orderInfo.orderPhase.add(BN_ONE).eq(tickInfo.orderPhase)) {
      const numerator = orderInfo.settleBase.mul(tickInfo.unfilledRatioX64)
      const denominator = orderInfo.unfilledRatioX64

      const idealRemaining = numerator.div(denominator)
      const isExact = numerator.mod(denominator).isZero()

      const totalFilled = orderInfo.settleBase.sub(idealRemaining)
      if (totalFilled.isZero()) return BN_ZERO

      const effectiveFilled = isExact ? totalFilled : totalFilled.sub(BN_ONE)

      const totalOutput = TickUtil.getLimitOrderOutput({ amountIn: effectiveFilled, tick: tickInfo.tick, zeroForOne: orderInfo.zeroForOne })

      const payout = totalOutput.sub(orderInfo.settleOutput)
      // orderInfo.filledAmount = orderInfo.totalAmount.sub(idealRemaining)
      // orderInfo.settleOutput = totalOutput

      return payout
    } else if (orderInfo.orderPhase.add(new BN(2)).lte(tickInfo.orderPhase)) {
      const totalOutput = TickUtil.getLimitOrderOutput({ amountIn: orderInfo.settleBase, tick: tickInfo.tick, zeroForOne: orderInfo.zeroForOne })
      const payout = totalOutput.sub(orderInfo.settleOutput)
      // orderInfo.filledAmount = orderInfo.totalAmount
      // orderInfo.settleBase = BN_ZERO
      // orderInfo.settleOutput = BN_ZERO
      return payout
    } else {
      throw Error('invalid order phase')
    }
  }
}
