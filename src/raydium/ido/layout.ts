import { GetStructureSchema, publicKey, seq, struct, u64 } from "../../marshmallow";
import { IdoVersion, SnapshotVersion } from "./type";

export const IDO_STATE_LAYOUT_V3 = struct([
  u64("status"),
  u64("nonce"),
  // time
  u64("startTime"),
  u64("endTime"),
  u64("startWithdrawTime"),

  u64("numerator"),
  u64("denominator"),
  u64("quoteDeposited"),
  u64("baseSupply"),

  // TODO rename all Lotteries/Lottery to Tickets/Ticket
  u64("perUserMaxLotteries"),
  u64("perUserMinLotteries"),
  u64("perLotteryMinStake"),
  u64("perLotteryQuoteAmount"),

  // total win lotteries limit
  u64("maxWinLotteries"),
  u64("depositedUsers"),
  u64("raisedLotteries"),
  // digits: number's digit
  // endRange: 0-endRange
  seq(struct([u64("digits"), u64("number"), u64("endRange"), u64()]), 10, "luckyNumbers"),
  publicKey("quoteMint"),
  publicKey("baseMint"),
  publicKey("quoteVault"),
  publicKey("baseVault"),
  publicKey("stakePoolId"),
  publicKey("stakeProgramId"),
  publicKey("snapshotProgramId"),
  publicKey("idoOwner"),

  publicKey("seedId"),
  u64("isWinning"), // 0: not start   1: data is for choose win   2: data is for choose lose   3: all wins
  seq(u64(), 7, "padding"),
]);

export type IdoStateLayoutV3 = GetStructureSchema<typeof IDO_STATE_LAYOUT_V3>;

export const IDO_LEDGER_LAYOUT_V3 = struct([
  u64("state"),
  publicKey("poolId"),
  publicKey("owner"),

  // can only change once
  u64("quoteDeposited"),
  u64("quoteWithdrawn"),
  u64("baseWithdrawn"),

  u64("startNumber"),
  u64("endNumber"),
]);

export type IdoLedgerLayoutV3 = GetStructureSchema<typeof IDO_LEDGER_LAYOUT_V3>;

// version => ido state layout
export const IDO_VERSION_TO_STATE_LAYOUT: {
  [key in IdoVersion]?: typeof IDO_STATE_LAYOUT_V3;
} & {
  [K: number]: typeof IDO_STATE_LAYOUT_V3;
} = {
  3: IDO_STATE_LAYOUT_V3,
};

export function getIdoStateLayout(version: number) {
  const STATE_LAYOUT = IDO_VERSION_TO_STATE_LAYOUT[version];

  if (!STATE_LAYOUT) {
    throw new Error(`invalid version, ${version}`);
  }

  return STATE_LAYOUT;
}

// version => ido ledger layout
export const IDO_VERSION_TO_LEDGER_LAYOUT: {
  [key in IdoVersion]?: typeof IDO_LEDGER_LAYOUT_V3;
} & {
  [K: number]: typeof IDO_LEDGER_LAYOUT_V3;
} = {
  3: IDO_LEDGER_LAYOUT_V3,
};

export function getIdoLedgerLayout(version: number) {
  const LEDGER_LAYOUT = IDO_VERSION_TO_LEDGER_LAYOUT[version];

  if (!LEDGER_LAYOUT) {
    throw new Error(`invalid version, ${version}`);
  }

  return LEDGER_LAYOUT;
}

/* ================= snapshot state layout ================= */
export const SNAPSHOT_STATE_LAYOUT_V1 = struct([u64("maxLotteries")]);

export type SnapshotStateLayoutV1 = GetStructureSchema<typeof SNAPSHOT_STATE_LAYOUT_V1>;

// version => snapshot state layout
export const SNAPSHOT_VERSION_TO_STATE_LAYOUT: {
  [key in SnapshotVersion]?: typeof SNAPSHOT_STATE_LAYOUT_V1;
} & {
  [K: number]: typeof SNAPSHOT_STATE_LAYOUT_V1;
} = {
  1: SNAPSHOT_STATE_LAYOUT_V1,
};

export function getSnapshotStateLayout(version: number) {
  const STATE_LAYOUT = SNAPSHOT_VERSION_TO_STATE_LAYOUT[version];

  if (!STATE_LAYOUT) {
    throw new Error(`invalid version, ${version}`);
  }

  return STATE_LAYOUT;
}
