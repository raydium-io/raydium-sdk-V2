import { blob, bool, publicKey, seq, struct, u16, u64, u8 } from "../../marshmallow";

export const CpmmConfigInfoLayout = struct([
  blob(8),
  u8("bump"),
  bool("disableCreatePool"),
  u16("index"),
  u64("tradeFeeRate"),
  u64("protocolFeeRate"),
  u64("fundFeeRate"),
  u64("createPoolFee"),

  publicKey("protocolOwner"),
  publicKey("fundOwner"),

  u64("creatorFeeRate"),
  seq(u64(), 15),
]);

export const CpmmPoolInfoLayout = struct([
  blob(8),

  publicKey("configId"),
  publicKey("poolCreator"),
  publicKey("vaultA"),
  publicKey("vaultB"),

  publicKey("mintLp"),
  publicKey("mintA"),
  publicKey("mintB"),

  publicKey("mintProgramA"),
  publicKey("mintProgramB"),

  publicKey("observationId"),

  u8("bump"),
  u8("status"),

  u8("lpDecimals"),
  u8("mintDecimalA"),
  u8("mintDecimalB"),

  u64("lpAmount"),
  u64("protocolFeesMintA"),
  u64("protocolFeesMintB"),
  u64("fundFeesMintA"),
  u64("fundFeesMintB"),
  u64("openTime"),
  u64("epoch"),

  u8("feeOn"),
  bool("enableCreatorFee"),
  seq(u8(), 6),
  u64("creatorFeesMintA"),
  u64("creatorFeesMintB"),

  seq(u64(), 28),
]);

export const CpmmPermission = struct([blob(8), publicKey("configId"), seq(u64(), 30)]);
