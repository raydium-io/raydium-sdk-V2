import BN from "bn.js";
import { LimitOrderLayout, TickLayout } from "../layout";
import { mulDivFloor } from "./bigNum";
import { getLimitOrderOutput } from "./swapSimulator";


export class LimitOrderMath {
  public static isFullyFilled({ orderInfo }: { orderInfo: ReturnType<typeof LimitOrderLayout.decode> }): boolean {
    return orderInfo.totalAmount.eq(orderInfo.filledAmount)
  }

  public static getUnFilledAmount({ orderInfo }: { orderInfo: ReturnType<typeof LimitOrderLayout.decode> }): BN {
    return orderInfo.totalAmount.sub(orderInfo.filledAmount)
  }

  public static settleFilledOrder({ orderInfo, tickInfo }: { orderInfo: ReturnType<typeof LimitOrderLayout.decode>, tickInfo: ReturnType<typeof TickLayout.decode> }): BN {
    const remainingAmount = this.getUnFilledAmount({ orderInfo })
    if (remainingAmount.isZero()) return new BN(0)

    let filledAmount

    if (orderInfo.orderPhase.eq(tickInfo.orderPhase)) {
      filledAmount = new BN(0)
    } else if (orderInfo.orderPhase.add(new BN(1)).eq(tickInfo.orderPhase)) {
      if (!tickInfo.partFilledOrdersTotal.gt(new BN(0))) throw Error('')
      const newRemainingAmount = mulDivFloor(
        orderInfo.totalAmount,
        tickInfo.partFilledOrdersRemaining,
        tickInfo.partFilledOrdersTotal,
      )
      filledAmount = remainingAmount.sub(newRemainingAmount)
    } else if (orderInfo.orderPhase.add(new BN(2)).eq(tickInfo.orderPhase)) {
      filledAmount = remainingAmount
    } else {
      throw Error('')
    }

    orderInfo.filledAmount = orderInfo.filledAmount.add(filledAmount)

    return getLimitOrderOutput(filledAmount, tickInfo.tick, orderInfo.zeroForOne)
  }
}