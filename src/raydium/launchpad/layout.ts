import { publicKey, seq, struct, u16, u64, u8 } from "../../marshmallow";

export const LaunchpadConfig = struct([
  u64(),
  u64("epoch"),
  u8("curveType"),
  u16("index"),
  u64("migrateFee"),
  u64("tradeFeeRate"),
  u64("maxShareFeeRate"),
  u64("minSupplyA"),
  u64("maxLockRate"),
  u64("minSellRateA"),
  u64("minMigrateRateA"),
  u64("minFundRaisingB"),
  publicKey("mintB"),
  publicKey("protocolFeeOwner"),
  publicKey("migrateFeeOwner"),
  publicKey("migrateToAmmWallet"),
  publicKey("migrateToCpmmWallet"),
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
  u64("epoch"),
  u8("bump"),
  u8("status"),
  u8("mintDecimalsA"),
  u8("mintDecimalsB"),
  u8("migrateType"),

  u64("supply"),
  u64("totalSellA"),
  u64("virtualA"),
  u64("virtualB"),
  u64("realA"),
  u64("realB"),

  u64("totalFundRaisingB"),
  u64("protocolFee"),
  u64("platformFee"),
  u64("migrateFee"),

  LaunchpadVestingSchedule.replicate("vestingSchedule"),

  publicKey("configId"),
  publicKey("platformId"),
  publicKey("mintA"),
  publicKey("mintB"),
  publicKey("vaultA"),
  publicKey("vaultB"),

  publicKey("creator"),

  seq(u64(), 8),
]);

export const LaunchpadVesting = struct([
  u64(),
  u64("epoch"),
  publicKey("poolId"),
  publicKey("beneficiary"),
  u64("claimedAmount"),
  u64("tokenShareAmount"),
  seq(u64(), 8),
]);

export const PlatformConfig = struct([
  u64(),
  u64("epoch"),
  publicKey("platformClaimFeeWallet"),
  publicKey("platformLockNftWallet"),
  u64("platformScale"),
  u64("creatorScale"),
  u64("burnScale"),
  u64("feeRate"),
  seq(u8(), 64, "name"),
  seq(u8(), 256, "web"),
  seq(u8(), 256, "img"),
  publicKey('cpConfigId'),
  seq(u8(), 224),
]);
