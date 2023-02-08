import BN from "bn.js";
import { LiquidityVersion } from "../../api/type";
import { SerumVersion } from "../serum";

export enum LiquidityPoolStatus {
  Uninitialized,
  Initialized,
  Disabled,
  RemoveLiquidityOnly,
  LiquidityOnly,
  OrderBook,
  Swap,
  WaitingForStart,
}

export const LIQUIDITY_FEES_NUMERATOR = new BN(25);
export const LIQUIDITY_FEES_DENOMINATOR = new BN(10000);

// liquidity version => serum version
export const LIQUIDITY_VERSION_TO_SERUM_VERSION: {
  [key in LiquidityVersion]?: SerumVersion;
} & {
  [K: number]: SerumVersion;
} = {
  4: 3,
  5: 3,
};
