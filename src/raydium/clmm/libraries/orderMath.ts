import Decimal from "decimal.js";
import { priceToTick, roundTickDown, roundTickUp, tickToPrice } from "./tickMath";

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
  const priceTick = priceToTick(price, mintADecimal, mintBDecimal);
  const orderTick = baseIn ? roundTickUp(priceTick, tickSpacing) : roundTickDown(priceTick, tickSpacing);
  const orderPrice = tickToPrice(orderTick, mintADecimal, mintBDecimal);

  return {
    tick: orderTick,
    price: orderPrice,
  };
};
