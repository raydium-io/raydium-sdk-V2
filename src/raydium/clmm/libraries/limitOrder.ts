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
    const remainingAmount = this.getUnFilledAmount({ orderInfo });
    if (remainingAmount.isZero()) return BN_ZERO;

    let filledAmount;
    let isExact;

    if (orderInfo.orderPhase.eq(tickInfo.orderPhase)) {
      filledAmount = BN_ZERO;
      isExact = true;
    } else if (orderInfo.orderPhase.add(BN_ONE).eq(tickInfo.orderPhase)) {
      const numerator = remainingAmount.mul(tickInfo.unfilledRatioX64);
      const denominator = orderInfo.unfilledRatioX64;
      const newRemainingAmount = numerator.div(denominator);
      filledAmount = remainingAmount.sub(newRemainingAmount);
      if (filledAmount.gt(BN_ZERO)) {
        orderInfo.unfilledRatioX64 = tickInfo.unfilledRatioX64;
      }
      isExact = numerator.mod(denominator).isZero();
    } else if (orderInfo.orderPhase.add(new BN(2)).lte(tickInfo.orderPhase)) {
      filledAmount = remainingAmount;
      isExact = true;
    } else {
      throw Error("");
    }

    if (filledAmount.isZero()) return BN_ZERO;

    // for get real executed amount
    // orderInfo.filledAmount = orderInfo.filledAmount.add(filledAmount)

    const effectiveFilledAmount = isExact ? filledAmount : filledAmount.sub(BN_ONE);

    return TickUtil.getLimitOrderOutput({
      amountIn: effectiveFilledAmount,
      tick: tickInfo.tick,
      zeroForOne: orderInfo.zeroForOne,
    });
  }
}
