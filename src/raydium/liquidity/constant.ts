import BN from "bn.js";
import { SerumVersion } from "../serum";

export const LIQUIDITY_FEES_NUMERATOR = new BN(25);
export const LIQUIDITY_FEES_DENOMINATOR = new BN(10000);

// liquidity version => serum version
export const LIQUIDITY_VERSION_TO_SERUM_VERSION: {
  [key in 4 | 5]?: SerumVersion;
} = {
  4: 3,
  5: 3,
};
