import Decimal from "decimal.js";
import { TickUtil } from "./tickArrayUtil";

export const getOrderTick = ({
  baseIn,
  price,
  mintADecimal,
  mintBDecimal,
  tickSpacing,
}: {
  baseIn: boolean;
  price: Decimal;
  tickSpacing: number;
  mintADecimal: number;
  mintBDecimal: number;
}): { tick: number; price: Decimal } => {
  const priceTick = TickUtil.priceToTick(price, mintADecimal, mintBDecimal);
  const orderTick = TickUtil.toTickIndex(priceTick, tickSpacing);
  const orderPrice = TickUtil.tickToPrice(orderTick, mintADecimal, mintBDecimal);

  return {
    tick: orderTick,
    price: orderPrice,
  };
};
