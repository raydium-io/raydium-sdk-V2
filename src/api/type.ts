import { FarmRewardInfo, FarmVersion } from "../raydium/farm";

/* ================= token ================= */
export interface ApiTokenInfo {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  icon: string;
  extensions: { coingeckoId?: string; version?: "TOKEN2022" };
}

export type ApiTokenCategory = "official" | "unOfficial" | "unNamed" | "blacklist";

export type ApiTokens = {
  official: ApiTokenInfo[];
  unOfficial: ApiTokenInfo[];
  unNamed: { mint: string; decimals: number; hasFreeze: 0 | 1; extensions: { version?: "TOKEN2022" } }[];
  blacklist: string[];
};

/* ================= liquidity ================= */
export type LiquidityVersion = 4 | 5;

export interface ApiLiquidityPoolInfo {
  // base
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  // version
  version: number;
  programId: string;
  // keys
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  // market version
  marketVersion: number;
  marketProgramId: string;
  // market keys
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
}

export type ApiLiquidityPools = { [key in "official" | "unOfficial"]: ApiLiquidityPoolInfo[] };

export interface ApiJsonPairInfo {
  ammId: string;
  apr24h: number;
  apr7d: number;
  apr30d: number;
  fee7d: number;
  fee7dQuote: number;
  fee24h: number;
  fee24hQuote: number;
  fee30d: number;
  fee30dQuote: number;
  liquidity: number;
  lpMint: string;
  lpPrice: number | null; // lp price directly. (No need to mandually calculate it from liquidity list)
  market: string;
  name: string;
  official: boolean;
  price: number; // swap price forwrard. for example, if pairId is 'ETH-USDC', price is xxx USDC/ETH
  tokenAmountCoin: number;
  tokenAmountLp: number;
  tokenAmountPc: number;
  volume7d: number;
  volume7dQuote: number;
  volume24h: number;
  volume24hQuote: number;
  volume30d: number;
  volume30dQuote: number;
}

/* ================= farm ================= */
export interface FarmRewardInfoV6 {
  rewardMint: string;
  rewardVault: string;
  rewardOpenTime: number;
  rewardEndTime: number;
  rewardPerSecond: number;
  rewardSender: string;
}

export interface ApiStakePoolInfo {
  // base
  id: string;
  symbol: string;
  lpMint: string;
  // version
  version: FarmVersion;
  programId: string;
  // keys
  authority: string;
  lpVault: string;
  rewardInfos: FarmRewardInfo[] | FarmRewardInfoV6[];
  // status
  upcoming: boolean;
}

export interface ApiFarmPoolInfo extends ApiStakePoolInfo {
  baseMint: string;
  quoteMint: string;
}

export interface ApiFarmPools {
  stake: ApiStakePoolInfo[];
  raydium: ApiFarmPoolInfo[];
  fusion: ApiFarmPoolInfo[];
  ecosystem: ApiFarmPoolInfo[];
}

export interface ApiAmmV3ConfigInfo {
  id: string;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  tickSpacing: number;
  fundFeeRate: number;
  fundOwner: string;
  description: string;
}
export interface ApiAmmV3PoolInfo {
  id: string;
  mintA: string;
  mintB: string;
  mintDecimalsA: number;
  mintDecimalsB: number;
  ammConfig: ApiAmmV3ConfigInfo;
  day: {
    volume: number;
    volumeFee: number;
    feeA: number;
    feeB: number;
    feeApr: number;
    rewardApr: {
      A: number;
      B: number;
      C: number;
    };
    apr: number;
    priceMin: number;
    priceMax: number;
  };
  week: {
    volume: number;
    volumeFee: number;
    feeA: number;
    feeB: number;
    feeApr: number;
    rewardApr: {
      A: number;
      B: number;
      C: number;
    };
    apr: number;
    priceMin: number;
    priceMax: number;
  };
  month: {
    volume: number;
    volumeFee: number;
    feeA: number;
    feeB: number;
    feeApr: number;
    rewardApr: {
      A: number;
      B: number;
      C: number;
    };
    apr: number;
    priceMin: number;
    priceMax: number;
  };
  tvl: number;
  lookupTableAccount: string;
}

export type ApiIdoItem = {
  id: string;
  projectName: string;
  projectPosters: string;
  projectDetailLink: string;
  baseMint: string;
  baseVault: string;
  baseSymbol: string;
  baseDecimals: number;
  baseIcon: string;
  quoteMint: string;
  quoteVault: string;
  quoteSymbol: string;
  quoteDecimals: number;
  quoteIcon: string;
  startTime: number; // timestamp (milliseconds)
  endTime: number; // timestamp (milliseconds)
  startWithdrawTime: number; // timestamp (milliseconds)
  stakeTimeEnd: number; // timestamp (milliseconds)
  price: number; // real price
  raise: number; // raise token amount
  maxWinLotteries: number;
  raisedLotteries: number;
  isWinning: number;
  version: 3; // currently only 3, V2 do not support old ido
  snapshotVersion: 1; // currently only 1
  programId: string;
  authority: string;
  snapshotProgramId: string;
  seedId: string;
};

export type ApiIdoInfo = {
  info: ApiIdoItem;
  projectInfo: {
    projectDetails: string;
    projectDocs: {
      tokenomics: string;
      website: string;
    };
    projectSocials: {
      Discord: string;
      Medium: string;
      Telegram: string;
      Twitter: string;
    };
  };
};

/** ====== v3 api types ======= */

export type ApiV3Token = {
  chainId: number;
  address: string;
  programId: string;
  logoURI: string;
  symbol: string;
  name: string;
  decimals: number;
  tags: string[];
  extensions: {
    coingeckoId?: string;
  };
};

export type ApiV3TokenRes = {
  mintList: ApiV3Token[];
  blacklist: ApiV3Token[];
};

export type ApiV3PoolInfoCountItem = {
  volume: number;
  volumeQuote: number;
  volumeFee: number;
  apr: number;
  feeApr: number;
  priceMin: number;
  priceMax: number;
  rewardApr: number[];
};
export type ApiV3PoolInfoBaseItem = {
  id: string;
  mintA: ApiV3Token;
  mintB: ApiV3Token;
  rewardMints: ApiV3Token[];
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  openTime: number;
  tvl: number;

  day: ApiV3PoolInfoCountItem;
  week: ApiV3PoolInfoCountItem;
  month: ApiV3PoolInfoCountItem;
};
export type ApiV3PoolInfoConcentratedItem = ApiV3PoolInfoBaseItem & {
  type: "concentrated";
};
export type ApiV3PoolInfoStandardItem = ApiV3PoolInfoBaseItem & {
  type: "standard";
  farmIds: string[];
  lpPrice: number;
  lpAmount: number;
};
export type ApiV3PoolInfoItem = ApiV3PoolInfoConcentratedItem | ApiV3PoolInfoStandardItem;
