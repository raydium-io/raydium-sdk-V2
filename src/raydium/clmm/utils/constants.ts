import BN from "bn.js";

export const ZERO = new BN(0);
export const ONE = new BN(1);
export const NEGATIVE_ONE = new BN(-1);

export const Q64 = new BN(1).shln(64);
export const Q128 = new BN(1).shln(128);

export const MaxU64 = Q64.sub(ONE);

export const U64Resolution = 64;

export const MaxUint128 = Q128.subn(1);

export const MIN_TICK = -443636;
export const MAX_TICK = -MIN_TICK;

export const MIN_SQRT_PRICE_X64: BN = new BN("4295048016");
export const MAX_SQRT_PRICE_X64: BN = new BN("79226673521066979257578248091");

export const MIN_SQRT_PRICE_X64_ADD_ONE: BN = new BN("4295048017");
export const MAX_SQRT_PRICE_X64_SUB_ONE: BN = new BN("79226673521066979257578248090");

// export const MIN_TICK_ARRAY_START_INDEX = -307200;
// export const MAX_TICK_ARRAY_START_INDEX = 306600;

export const BIT_PRECISION = 16;
export const LOG_B_2_X32 = "59543866431248";
export const LOG_B_P_ERR_MARGIN_LOWER_X64 = "184467440737095516";
export const LOG_B_P_ERR_MARGIN_UPPER_X64 = "15793534762490258745";

export const FEE_RATE_DENOMINATOR = new BN(10).pow(new BN(6));

export enum Fee {
  rate_500 = 500, //  500 / 10e6 = 0.0005
  rate_3000 = 3000, // 3000/ 10e6 = 0.003
  rate_10000 = 10000, // 10000 /10e6 = 0.01
}
export const TICK_SPACINGS: { [amount in Fee]: number } = {
  [Fee.rate_500]: 10,
  [Fee.rate_3000]: 60,
  [Fee.rate_10000]: 200,
};

export const mockCreatePoolInfo = {
  version: 6,
  liquidity: ZERO,
  tickCurrent: 0,
  feeGrowthGlobalX64A: ZERO,
  feeGrowthGlobalX64B: ZERO,
  protocolFeesTokenA: ZERO,
  protocolFeesTokenB: ZERO,
  swapInAmountTokenA: ZERO,
  swapOutAmountTokenB: ZERO,
  swapInAmountTokenB: ZERO,
  swapOutAmountTokenA: ZERO,
  tickArrayBitmap: [],

  rewardInfos: [],

  day: {
    volume: 0,
    volumeFee: 0,
    feeA: 0,
    feeB: 0,
    feeApr: 0,
    rewardApr: { A: 0, B: 0, C: 0 },
    apr: 0,
    priceMax: 0,
    priceMin: 0,
  },
  week: {
    volume: 0,
    volumeFee: 0,
    feeA: 0,
    feeB: 0,
    feeApr: 0,
    rewardApr: { A: 0, B: 0, C: 0 },
    apr: 0,
    priceMax: 0,
    priceMin: 0,
  },
  month: {
    volume: 0,
    volumeFee: 0,
    feeA: 0,
    feeB: 0,
    feeApr: 0,
    rewardApr: { A: 0, B: 0, C: 0 },
    apr: 0,
    priceMax: 0,
    priceMin: 0,
  },
  tvl: 0,
};

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

export const U64_IGNORE_RANGE = new BN("18446744073700000000");
