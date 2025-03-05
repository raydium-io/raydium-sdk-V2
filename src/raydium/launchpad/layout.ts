import { publicKey, seq, struct, u64, u8, u16 } from "../../marshmallow";

export const LaunchpadConfig = struct([
  u64(),
  u8("curveType"),
  u16("index"),
  u64("migrateFee"),
  u64("tradeFeeRate"),
  publicKey("feeOwner"),
  publicKey("mintB"),
  seq(u64(), 16),
]);

export const LaunchpadVestingSchedule = struct([
  u64("totalLockedAmount"),
  u64("cliffPeriod"),
  u64("unlockPeriod"),
  u64("startTime"),
  u64("totalAllocatedShare"),
]);

export const LaunchpadPool = struct([
  u64(),
  u8("bump"),
  u8("status"),
  u8("decimals"),
  u8("migrateType"),

  u64("supply"),
  u64("totalSellA"),
  u64("virtualA"),
  u64("virtualB"),
  u64("realA"),
  u64("realB"),
  u64("tradeFee"),
  u64("totalFundRaisingB"),
  u64("migrateFee"),

  LaunchpadVestingSchedule.replicate("vestingSchedule"),

  publicKey("configId"),
  publicKey("mintA"),
  publicKey("vaultA"),
  publicKey("vaultB"),

  publicKey("creator"),

  seq(u64(), 8),
]);

export const LaunchpadVesting = struct([
  u64(),
  publicKey("poolId"),
  publicKey("beneficiary"),
  u64("claimedAmount"),
  u64("tokenShareAmount"),
]);
