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

    if (orderInfo.orderPhase.eq(tickInfo.orderPhase)) {
      filledAmount = BN_ZERO;
    } else if (orderInfo.orderPhase.add(BN_ONE).eq(tickInfo.orderPhase)) {
      const newRemainingAmount = mulDivFloor(
        remainingAmount,
        tickInfo.unfilledRatioX64,
        orderInfo.unfilledRatioX64,
      );
      filledAmount = remainingAmount.sub(newRemainingAmount);
      if (filledAmount.gt(BN_ZERO)) {
        orderInfo.unfilledRatioX64 = tickInfo.unfilledRatioX64;
      }
    } else if (orderInfo.orderPhase.add(new BN(2)).lte(tickInfo.orderPhase)) {
      filledAmount = remainingAmount;
    } else {
      throw Error("");
    }

    if (filledAmount.isZero()) return BN_ZERO

    orderInfo.filledAmount = orderInfo.filledAmount.add(filledAmount)

    return TickUtil.getLimitOrderOutput({
      amountIn: filledAmount,
      tick: tickInfo.tick,
      zeroForOne: orderInfo.zeroForOne,
    });
  }
}
