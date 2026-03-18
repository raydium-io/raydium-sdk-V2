import BN from "bn.js";
import { LimitOrderLayout, TickLayout } from "../layout";
import { mulDivCeil } from "./bigNum";
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
    if (remainingAmount.isZero()) return new BN(0);

    let filledAmount;

    if (orderInfo.orderPhase.eq(tickInfo.orderPhase)) {
      filledAmount = new BN(0);
    } else if (orderInfo.orderPhase.add(new BN(1)).eq(tickInfo.orderPhase)) {
      const newRemainingAmount = mulDivCeil(
        orderInfo.totalAmount,
        tickInfo.partFilledOrdersRemaining,
        tickInfo.partFilledOrdersTotal,
      );
      filledAmount = remainingAmount.sub(newRemainingAmount);
    } else if (orderInfo.orderPhase.add(new BN(2)).lte(tickInfo.orderPhase)) {
      filledAmount = remainingAmount;
    } else {
      throw Error("");
    }

    return TickUtil.getLimitOrderOutput({
      amountIn: filledAmount,
      tick: tickInfo.tick,
      zeroForOne: orderInfo.zeroForOne,
    });
  }
}
