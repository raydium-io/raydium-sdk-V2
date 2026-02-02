import { blob, bool, i128, i64, publicKey, s32, seq, struct, u128, u16, u32, u64, u8 } from "../../marshmallow"
import {
  EXTENSION_TICKARRAY_BITMAP_SIZE,
  OBSERVATION_NUM,
  OPERATION_SIZE_USIZE,
  REWARD_NUM,
  TICK_ARRAY_SIZE,
  WHITE_MINT_SIZE_USIZE,
} from "./libraries/constants"

export const ClmmConfigLayout = struct([
  blob(8),
  u8("bump"),
  u16("index"),
  publicKey("owner"),
  u32("protocolFeeRate"),
  u32("tradeFeeRate"),
  u16("tickSpacing"),
  u32("fundFeeRate"),
  seq(u32(), 1),
  publicKey("fundOwner"),
  seq(u64(), 3),
])


export const ObservationItemLayout = struct([u32("blockTimestamp"), i64("tickCumulative"), seq(u64(), 4),])

export const ObservationLayout = struct([
  blob(8),
  bool("initialized"),
  u64("recentEpoch"),
  u16("observationIndex"),
  publicKey("poolId"),
  seq(ObservationItemLayout, OBSERVATION_NUM, "observations"),
  seq(u64(), 4),
])


export const DynamicFeeInfoLayout = struct([
  u16("filterPeriod"),
  u16("decayPeriod"),
  u16("reductionFactor"),
  u32("dynamicFeeControl"),
  u32("maxVolatilityAccumulator"),
  s32("tickSpacingIndexReference"),
  u32("volatilityReference"),
  u32("volatilityAccumulator"),
  u64("lastUpdateTimestamp"),
  seq(u8(), 46),
])

export const RewardInfoLayout = struct([
  u8("state"),
  u64("openTime"),
  u64("endTime"),
  u64("lastUpdateTime"),
  u128("emissionsPerSecondX64"),
  u64("totalEmissioned"),
  u64("claimed"),
  publicKey("mint"),
  publicKey("vault"),
  publicKey("creator"),
  u128("growthGlobalX64"),
])

export const PoolInfoLayout = struct([
  blob(8),
  u8('bump'),
  publicKey("configId"),
  publicKey("creator"),
  publicKey("mintA"),
  publicKey("mintB"),
  publicKey("vaultA"),
  publicKey("vaultB"),
  publicKey("observationId"),

  u8("mintDecimalsA"),
  u8("mintDecimalsB"),
  u16("tickSpacing"),
  u128("liquidity"),
  u128("sqrtPriceX64"),
  s32("tickCurrent"),

  u32(),

  u128("feeGrowthGlobalX64A"),
  u128("feeGrowthGlobalX64B"),
  u64("protocolFeesTokenA"),
  u64("protocolFeesTokenB"),

  u128("swapInAmountTokenA"),
  u128("swapOutAmountTokenB"),
  u128("swapInAmountTokenB"),
  u128("swapOutAmountTokenA"),

  u8("status"),
  u8("feeOn"),
  blob(6),

  seq(RewardInfoLayout, REWARD_NUM, "rewardInfos"),

  seq(u64(), 16, "tickArrayBitmap"),

  u64("totalFeesTokenA"),
  u64("totalFeesClaimedTokenA"),
  u64("totalFeesTokenB"),
  u64("totalFeesClaimedTokenB"),

  u64("fundFeesTokenA"),
  u64("fundFeesTokenB"),

  u64("startTime"),
  u64("recentEpoch"),

  DynamicFeeInfoLayout.replicate('dynamicFeeInfo'),
  seq(u64(), 16),
])

export const PositionRewardInfoLayout = struct([u128("growthInsideLastX64"), u64("rewardAmountOwed")])
export const PersonalPositionLayout = struct([
  blob(8),
  u8("bump"),
  publicKey("nftMint"),
  publicKey("poolId"),

  s32("tickLower"),
  s32("tickUpper"),
  u128("liquidity"),
  u128("feeGrowthInsideLastX64A"),
  u128("feeGrowthInsideLastX64B"),
  u64("tokenFeesOwedA"),
  u64("tokenFeesOwedB"),

  seq(PositionRewardInfoLayout, REWARD_NUM, "rewardInfos"),
  u64("recentEpoch"),
  seq(u64(), 7),
])

export const ProtocolPositionLayout = struct([
  blob(8),
  u8("bump"),
  publicKey("poolId"),
  s32("tickLower"),
  s32("tickUpper"),
  u128("liquidity"),
  u128("feeGrowthInsideLastX64A"),
  u128("feeGrowthInsideLastX64B"),
  u64("tokenFeesOwedA"),
  u64("tokenFeesOwedB"),
  seq(u128(), REWARD_NUM, "rewardGrowthInside"),
  u64("recentEpoch"),
  seq(u64(), 7),
])


export const TickLayout = struct([
  s32("tick"),
  i128("liquidityNet"),
  u128("liquidityGross"),
  u128("feeGrowthOutsideX64A"),
  u128("feeGrowthOutsideX64B"),
  seq(u128(), REWARD_NUM, "rewardGrowthsOutsideX64"),

  u64("orderPhase"),
  u64("ordersAmount"),
  u64("partFilledOrdersTotal"),
  u64("partFilledOrdersRemaining"),
  u64("unsettledFilledOrdersZeroForOne"),
  u64("unsettledFilledOrdersOneForZero"),
  seq(u8(), 4),
])

export const TickArrayLayout = struct([
  blob(8),
  publicKey("poolId"),
  s32("startTickIndex"),
  seq(TickLayout, TICK_ARRAY_SIZE, "ticks"),
  u8("initializedTickCount"),
  u64("recentEpoch"),
  seq(u8(), 107),
])

export const OperationLayout = struct([
  blob(8),
  u8("bump"),
  seq(publicKey(), OPERATION_SIZE_USIZE, "operationOwners"),
  seq(publicKey(), WHITE_MINT_SIZE_USIZE, "whitelistMints"),
])

export const LimitOrderLayout = struct([
  blob(8),
  publicKey("poolId"),
  publicKey("owner"),
  s32("tickIndex"),
  bool("zeroForOne"),
  u64("orderPhase"),
  u64("totalAmount"),
  u64("filledAmount"),
  seq(u64(), 6),
])

export const TickArrayBitmapExtensionLayout = struct([
  blob(8),
  publicKey("poolId"),
  seq(seq(u64(), 8), EXTENSION_TICKARRAY_BITMAP_SIZE, "positiveTickArrayBitmap"),
  seq(seq(u64(), 8), EXTENSION_TICKARRAY_BITMAP_SIZE, "negativeTickArrayBitmap"),
]);

export const DynamicFeeConfigLayout = struct([
  blob(8),
  u16("index"),
  u16("filterPeriod"),
  u16("decayPeriod"),
  u16("reductionFactor"),
  u32("dynamicFeeControl"),
  u32("maxVolatilityAccumulator"),
  seq(u64(), 8),
])

export const LockPositionLayout = struct([
  u64(),
  u8("bump"),
  publicKey("owner"),
  publicKey("poolId"),
  publicKey("positionId"),
  publicKey("nftAccount"),
  seq(u64(), 8),
]);

export const LockClPositionLayoutV2 = struct([
  blob(8),
  u8("bump"),
  publicKey("lockOwner"),
  publicKey("poolId"),
  publicKey("positionId"),
  publicKey("nftAccount"),
  publicKey("lockNftMint"),
  u64("recentEpoch"),
  seq(u64(), 8),
]);
