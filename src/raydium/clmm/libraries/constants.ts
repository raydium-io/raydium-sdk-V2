import BN from "bn.js"

export const Q64 = new BN(1).shln(64)

export const RESOLUTION = 64

export const Q128 = new BN(1).shln(128)

export const U64_MAX = new BN(1).shln(64).subn(1)

export const U128_MAX = new BN(1).shln(128).subn(1)

export const MIN_TICK = -443636

export const MAX_TICK = 443636

export const MIN_SQRT_PRICE_X64 = new BN("4295048016")

export const MAX_SQRT_PRICE_X64 = new BN("79226673521066979257578248091")

export const LOG_B_2_X32 = new BN("59543866431248")

export const LOG_B_P_ERR_MARGIN_LOWER_X64 = new BN("184467440737095516")

export const LOG_B_P_ERR_MARGIN_UPPER_X64 = new BN("15793534762490258745")

export const BIT_PRECISION = 16

export const TICK_ARRAY_BITMAP_SIZE = 512

export const TICK_ARRAY_SIZE = 60

export const MAGIC_SQRT_10001 = new BN("18446743708227953217")

export const TICK_TO_SQRT_PRICE_FACTORS: { bit: number; factor: BN }[] = [
  { bit: 0, factor: new BN("fffcb933bd6fb800", 16) },     // i=0
  { bit: 1, factor: new BN("fff97272373d4000", 16) },     // i=1
  { bit: 2, factor: new BN("fff2e50f5f657000", 16) },     // i=2
  { bit: 3, factor: new BN("ffe5caca7e10f000", 16) },     // i=3
  { bit: 4, factor: new BN("ffcb9843d60f7000", 16) },     // i=4
  { bit: 5, factor: new BN("ff973b41fa98e800", 16) },     // i=5
  { bit: 6, factor: new BN("ff2ea16466c9b000", 16) },     // i=6
  { bit: 7, factor: new BN("fe5dee046a9a3800", 16) },     // i=7
  { bit: 8, factor: new BN("fcbe86c7900bb000", 16) },     // i=8
  { bit: 9, factor: new BN("f987a7253ac65800", 16) },     // i=9
  { bit: 10, factor: new BN("f3392b0822bb6000", 16) },    // i=10
  { bit: 11, factor: new BN("e7159475a2caf000", 16) },    // i=11
  { bit: 12, factor: new BN("d097f3bdfd2f2000", 16) },    // i=12
  { bit: 13, factor: new BN("a9f746462d9f8000", 16) },    // i=13
  { bit: 14, factor: new BN("70d869a156f31c00", 16) },    // i=14
  { bit: 15, factor: new BN("31be135f97ed3200", 16) },    // i=15
  { bit: 16, factor: new BN("9aa508b5b85a500", 16) },     // i=16
  { bit: 17, factor: new BN("5d6af8dedc582c", 16) },      // i=17
  { bit: 18, factor: new BN("2216e584f5fa", 16) },        // i=18
]

export const FEE_RATE_DENOMINATOR = 1_000_000

export const MAX_FEE_RATE = 100_000

export enum CollectFeeOn {
  FromInput = 0,
  TokenOnlyA = 1,
  TokenOnlyB = 2,
}

export const MAX_FEE_RATE_NUMERATOR = 100_000;
export const VOLATILITY_ACCUMULATOR_SCALE = 10_000;
export const REDUCTION_FACTOR_DENOMINATOR = 10_000;
export const DYNAMIC_FEE_CONTROL_DENOMINATOR = 100_000;

export const TICK_ARRAY_SIZE_USIZE = 60;

export const REWARD_NUM = 3;

export const OBSERVATION_NUM = 100;
export const OBSERVATION_UPDATE_DURATION_DEFAULT = 15;

export const OPERATION_SIZE_USIZE = 10;
export const WHITE_MINT_SIZE_USIZE = 100;

export const EXTENSION_TICKARRAY_BITMAP_SIZE = 14;

export enum PoolStatusBitIndex {
  OpenPositionOrIncreaseLiquidity = 0,
  DecreaseLiquidity = 1,
  CollectFee = 2,
  CollectReward = 3,
  Swap = 4,
  LimitOrder = 5,
}

export enum PoolStatusBitFlag {
  Enable = 0,
  Disable = 1,
}

export enum RewardState {
  Uninitialized = 0,
  Initialized = 1,
  Opening = 2,
  Ended = 3,
}

export enum UpdateAmmConfigParam {
  TradeFeeRate = 0,
  ProtocolFeeRate = 1,
  FundFeeRate = 2,
  NewOwner = 3,
  NewFundOwner = 4,
}

export enum UpdateOperationAccountParam {
  UpdateOperationOwner = 0,
  RemoveOperationOwner = 1,
  UpdateWhitelistMint = 2,
  RemoveWhitelistMint = 3,
}

export const BN_ZERO = new BN(0)
export const BN_ONE = new BN(1)
export const BN_NEGATIVE_ONE = new BN(-1);

export const mockV3CreatePoolInfo = {
  tvl: 0,
  volumeQuote: 0,
  mintAmountA: 0,
  mintAmountB: 0,
  rewardDefaultInfos: [],
  farmUpcomingCount: 0,
  farmOngoingCount: 0,
  farmFinishedCount: 0,

  day: {
    volume: 0,
    volumeQuote: 0,
    volumeFee: 0,
    apr: 0,
    feeApr: 0,
    priceMin: 0,
    priceMax: 0,
    rewardApr: [0],
  },
  week: {
    volume: 0,
    volumeQuote: 0,
    volumeFee: 0,
    apr: 0,
    feeApr: 0,
    priceMin: 0,
    priceMax: 0,
    rewardApr: [0],
  },
  month: {
    volume: 0,
    volumeQuote: 0,
    volumeFee: 0,
    apr: 0,
    feeApr: 0,
    priceMin: 0,
    priceMax: 0,
    rewardApr: [0],
  },
  pooltype: [],
};
