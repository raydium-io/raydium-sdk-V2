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

export interface ApiPoolInfoV4 {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: 4;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  marketVersion: 3;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  lookupTableAccount: string;
}

export interface ApiPoolInfoV5 {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: 5;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  marketVersion: 3;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  modelDataAccount: string;
  lookupTableAccount: string;
}

export type ApiPoolJsonInfo = ApiPoolInfoV4 | ApiPoolInfoV5;

export type ApiLiquidityPools = { [key in "official" | "unOfficial"]: ApiPoolJsonInfo[] };

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

export interface ApiClmmConfigInfo {
  id: string;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  tickSpacing: number;
  fundFeeRate: number;
  fundOwner: string;
  description: string;
}

export interface ApiClmmPoolsItemStatistics {
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
}

export interface ApiClmmPoolInfo {
  id: string;
  mintProgramIdA: string;
  mintProgramIdB: string;
  mintA: string;
  mintB: string;
  mintDecimalsA: number;
  mintDecimalsB: number;
  ammConfig: ApiClmmConfigInfo;
  rewardInfos: {
    mint: string;
    programId: string;
  }[];
  day: ApiClmmPoolsItemStatistics;
  week: ApiClmmPoolsItemStatistics;
  month: ApiClmmPoolsItemStatistics;
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

export enum JupTokenType {
  ALL = "all",
  Strict = "strict",
}
export interface PoolsApiReturn {
  count: number;
  hasNextPage: boolean;
  data: ApiV3PoolInfoItem[];
}

export interface SearchPoolsApiReturn {
  hasNextPage: boolean;
  data: ApiV3PoolInfoItem[];
  bestUse: "id" | "mint" | null;
  search: string;
}

export interface TransferFeeDataBaseType {
  transferFeeConfigAuthority: string;
  withdrawWithheldAuthority: string;
  withheldAmount: string;
  olderTransferFee: {
    epoch: string;
    maximumFee: string;
    transferFeeBasisPoints: number;
  };
  newerTransferFee: {
    epoch: string;
    maximumFee: string;
    transferFeeBasisPoints: number;
  };
}

type TagsItem = "hasFreeze" | "hasTransferFee";
type ExtensionsItem = {
  coingeckoId?: string;
  feeConfig?: TransferFeeDataBaseType;
};

export type ApiV3Token = {
  chainId: number;
  address: string;
  programId: string;
  logoURI: string;
  symbol: string;
  name: string;
  decimals: number;
  tags: TagsItem[];
  extensions: ExtensionsItem;
};

export type ApiV3TokenRes = {
  mintList: ApiV3Token[];
  blacklist: ApiV3Token[];
};

export interface ApiV3PoolInfoCountItem {
  volume: number;
  volumeQuote: number;
  volumeFee: number;
  apr: number;
  feeApr: number;
  priceMin: number;
  priceMax: number;
  rewardApr: number[];
}

type PoolTypeItem = "StablePool" | "OpenBookMarket";

type FarmRewardInfoOld = {
  mint: ApiV3Token;
  perSecond: number;
};

export type PoolFarmRewardInfo = FarmRewardInfoOld & {
  startTime?: number;
  endTime?: number;
};

export interface PoolRewardInfoItem {
  mint: ApiV3Token;
  perSecond?: number;
  startTime?: number;
  endTime?: number;
}

export interface ApiV3PoolInfoBaseItem {
  programId: string;
  id: string;
  mintA: ApiV3Token;
  mintB: ApiV3Token;
  rewardDefaultInfos: PoolFarmRewardInfo[];
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  openTime: number;
  tvl: number;

  day: ApiV3PoolInfoCountItem;
  week: ApiV3PoolInfoCountItem;
  month: ApiV3PoolInfoCountItem;
  pooltype: PoolTypeItem[];

  farmUpcomingCount: number;
  farmOngoingCount: number;
  farmFinishedCount: number;
}
export type ApiV3PoolInfoConcentratedItem = ApiV3PoolInfoBaseItem & {
  type: "Concentrated";
  config: ApiClmmConfigV3;
};
export type ApiV3PoolInfoStandardItem = ApiV3PoolInfoBaseItem & {
  type: "Standard";
  marketId: string;
  lpPrice: number;
  lpAmount: number;
  lpMint: ApiV3Token;
};
export type ApiV3PoolInfoItem = ApiV3PoolInfoConcentratedItem | ApiV3PoolInfoStandardItem;

export interface FetchPoolParams {
  type?: "all" | "concentrated" | "standard";
  sort?:
    | "liquidity"
    | "volume_24h"
    | "volume_7d"
    | "volume_30d"
    | "fee_24h"
    | "fee_7d"
    | "fee_30d"
    | "apr_24h"
    | "apr_7d"
    | "apr_30d";
  order?: "desc" | "asc";
  pageSize?: number;
  page?: number;
}

// liquidity line
export interface Point {
  time: number;
  liquidity: number;
}
export interface LiquidityLineApi {
  count: number;
  line: Point[];
}

// pool key
interface Base {
  programId: string;
  id: string;
  mintA: ApiV3Token;
  mintB: ApiV3Token;
  lookupTableAccount?: string;
  openTime: number;
  vault: { A: string; B: string };
}
interface AmmKeys {
  authority: string;
  openOrders: string;
  targetOrders: string;
  withdrawQueue: string;
  mintLp: ApiV3Token;
  vault: { Lp: string }; // stable Publickey default
}
interface MarketKeys {
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
}
export type AmmV4Keys = Base & AmmKeys & MarketKeys;
export type AmmV5Keys = Base & AmmKeys & MarketKeys & { modelDataAccount: string };
export type ClmmKeys = Base & { config: ApiClmmConfigV3; rewardInfos: ApiV3Token[] };
export type PoolKeys = AmmV4Keys | AmmV5Keys | ClmmKeys;

// clmm config
export interface ApiClmmConfigV3 {
  id: string;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  tickSpacing: number;
  fundFeeRate: number;
  description: string;
  defaultRange: number;
  defaultRangePoint: number[];
}

export interface RpcItemA {
  url: string;
  weight: number;
  batch: boolean;
  name: string;
}
export interface RpcItemB {
  url: string;
  batch: boolean;
  name: string;
}

type RpcStrategy = "speed" | "first";
type RpcTypeWeight = { strategy: "weight"; rpcs: RpcItemA[] };
type RpcTypeOther = { strategy: RpcStrategy; rpcs: RpcItemB[] };
export type RpcType = RpcTypeWeight | RpcTypeOther;

export type FarmRewardTypeV6Key = "Standard SPL" | "Option tokens";

interface RewardKeyInfoV345 {
  mint: ApiV3Token;
  vault: string;
  type: FarmRewardTypeV6Key;
  perSecond: number;
  perBlock: number;
}
interface RewardKeyInfoV6 {
  mint: ApiV3Token;
  vault: string;
  type: FarmRewardTypeV6Key;
  perSecond: number;
  openTime: number;
  endTime: number;
  sender: string;
}
interface FormatFarmKeyOutBase {
  programId: string;
  id: string;
  symbolMints: ApiV3Token[];
  lpMint: ApiV3Token;
  authority: string;
  lpVault: string;
}
type FormatFarmKeyOutV345 = FormatFarmKeyOutBase & {
  rewardInfos: RewardKeyInfoV345[];
};
type FormatFarmKeyOutV6 = FormatFarmKeyOutBase & {
  config: {
    periodMax: number;
    periodMin: number;
    periodExtend: number;
  };
  rewardInfos: RewardKeyInfoV6[];
};
export type FormatFarmKeyOut = FormatFarmKeyOutV345 | FormatFarmKeyOutV6;
// item page farm info
// farm info
interface RewardInfoV345 {
  mint: ApiV3Token;
  type: FarmRewardTypeV6Key;
  apr: number;
  perSecond: number;
}
interface RewardInfoV6 {
  mint: ApiV3Token;
  type: FarmRewardTypeV6Key;
  apr: number;
  perSecond: number;
  openTime: number;
  endTime: number;
}
export type FarmTagsItem = "Ecosystem" | "Farm" | "Fusion" | "Stake";
export interface FormatFarmInfoOutBase {
  programId: string;
  id: string;
  symbolMints: ApiV3Token[];
  lpMint: ApiV3Token;
  tvl: number;
  lpPrice: number;
  apr: number;
  tags: FarmTagsItem[];
}
export type FormatFarmInfoOutV345 = FormatFarmInfoOutBase & {
  rewardInfos: RewardInfoV345[];
};
export type FormatFarmInfoOutV6 = FormatFarmInfoOutBase & {
  rewardInfos: RewardInfoV6[];
};
export type FormatFarmInfoOut = FormatFarmInfoOutV345 | FormatFarmInfoOutV6;
