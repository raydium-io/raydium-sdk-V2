import BN from "bn.js";
import { BigNumberish } from "./bignumber";
import { createLogger } from "./logger";

export enum Rounding {
  ROUND_DOWN,
  ROUND_HALF_UP,
  ROUND_UP,
}

const MAX_SAFE = 0x1fffffffffffff;

export function parseBigNumberish(value: BigNumberish): BN {
  const logger = createLogger("Raydium_parseBigNumberish");
  // BN
  if (value instanceof BN) {
    return value;
  }

  if (typeof value === "string") {
    if (value.match(/^-?[0-9]+$/)) {
      return new BN(value);
    }
    logger.logWithError(`invalid BigNumberish string: ${value}`);
  }

  if (typeof value === "number") {
    if (value % 1) {
      logger.logWithError(`BigNumberish number underflow: ${value}`);
    }

    if (value >= MAX_SAFE || value <= -MAX_SAFE) {
      logger.logWithError(`BigNumberish number overflow: ${value}`);
    }

    return new BN(String(value));
  }

  if (typeof value === "bigint") {
    return new BN(value.toString());
  }
  logger.error(`invalid BigNumberish value: ${value}`);
  return new BN(0); // never reach, because logWithError will throw error
}