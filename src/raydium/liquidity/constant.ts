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

// mainnet only
export const poolLpAuthority = new Set([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  "3uaZBfHPfmpAHW7dsimC1SnyR61X4bJqQZKWmRSCXJxv",
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
]);
