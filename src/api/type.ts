import { FarmRewardInfo, FarmVersion } from "../raydium/farm";

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

export interface ApiClmmConfigInfo {
  id: string;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  tickSpacing: number;
  fundFeeRate: number;
  defaultRange: number;
  defaultRangePoint: number[];
}

export interface ApiCpmmConfigInfo {
  id: string;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  fundFeeRate: number;
  createPoolFee: string;
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

export interface CpmmLockInfo {
  name: string;
  symbol: string;
  description: string;
  external_url: string;
  collection: {
    name: string;
    family: string;
  };
  image: string;
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  positionInfo: {
    tvlPercentage: number;
    usdValue: number;
    amountA: number;
    amountB: number;
    unclaimedFee: {
      lp: number;
      amountA: number;
      amountB: number;
      usdValue: number;
    };
  };
}

/** ====== v3 api types ======= */
export interface ApiV3PageIns<T> {
  count: number;
  hasNextPage: boolean;
  data: T[];
}

export enum JupTokenType {
  ALL = "all",
  Strict = "strict",
}
export type PoolsApiReturn = ApiV3PageIns<ApiV3PoolInfoItem>;

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

export type ExtensionsItem = {
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
  tags: string[]; // "hasFreeze" | "hasTransferFee" | "token-2022" | "community" | "unknown" ..etc
  extensions: ExtensionsItem;
  freezeAuthority?: string;
  mintAuthority?: string;
};

export type JupToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
  tags: string[];
  daily_volume: number;
  created_at: string;
  freeze_authority: string | null;
  mint_authority: string | null;
  permanent_delegate: string | null;
  minted_at: string;
  extensions: ExtensionsItem;
};

export type ApiV3TokenRes = {
  mintList: ApiV3Token[];
  blacklist: string[];
  whiteList: string[];
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
  rewardDefaultPoolInfos: "Ecosystem" | "Fusion" | "Raydium" | "Clmm";
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  openTime: string;
  tvl: number;

  day: ApiV3PoolInfoCountItem;
  week: ApiV3PoolInfoCountItem;
  month: ApiV3PoolInfoCountItem;
  pooltype: PoolTypeItem[];

  farmUpcomingCount: number;
  farmOngoingCount: number;
  farmFinishedCount: number;

  burnPercent: number;
}
export type ApiV3PoolInfoConcentratedItem = ApiV3PoolInfoBaseItem & {
  type: "Concentrated";
  config: ApiClmmConfigV3;
};
export type ApiV3PoolInfoStandardItem = ApiV3PoolInfoBaseItem & {
  type: "Standard";
  marketId: string;
  configId: string;
  lpPrice: number;
  lpAmount: number;
  lpMint: ApiV3Token;
};

export type ApiV3PoolInfoStandardItemCpmm = ApiV3PoolInfoBaseItem & {
  type: "Standard";
  lpMint: ApiV3Token;
  lpPrice: number;
  lpAmount: number;
  config: ApiCpmmConfigV3;
};

export type ApiV3PoolInfoItem =
  | ApiV3PoolInfoConcentratedItem
  | ApiV3PoolInfoStandardItem
  | ApiV3PoolInfoStandardItemCpmm;

export enum PoolFetchType {
  All = "all",
  Standard = "standard",
  Concentrated = "concentrated",
  AllFarm = "allFarm",
  StandardFarm = "standardFarm",
  ConcentratedFarm = "concentratedFarm",
}

export interface FetchPoolParams {
  type?: PoolFetchType;
  sort?:
    | "liquidity"
    | "volume24h"
    | "volume7d"
    | "volume30d"
    | "fee24h"
    | "fee7d"
    | "fee30d"
    | "apr24h"
    | "apr7d"
    | "apr30d";
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
  openTime: string;
  vault: { A: string; B: string };
}
interface _Amm {
  authority: string;
  openOrders: string;
  targetOrders: string;
  mintLp: ApiV3Token;
}

interface ApiCpmmConfigV3 {
  id: string;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  fundFeeRate: number;
  createPoolFee: string;
}

interface _Cpmm {
  authority: string;
  mintLp: ApiV3Token;
  config: ApiCpmmConfigV3;
  observationId: string;
}
interface _Market {
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
}
export type AmmV4Keys = Base & _Amm & _Market;
export type AmmV5Keys = Base & _Amm & _Market & { modelDataAccount: string };
export type CpmmKeys = Base & _Cpmm;
export interface ClmmRewardType {
  mint: ApiV3Token;
  vault: string;
}
export type ClmmKeys = Base & {
  config: ApiClmmConfigV3;
  rewardInfos: ClmmRewardType[];
  observationId: string;
  exBitmapAccount: string;
};
export type PoolKeys = AmmV4Keys | AmmV5Keys | ClmmKeys | CpmmKeys;

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

export interface RewardKeyInfoV345 {
  mint: ApiV3Token;
  vault: string;
  type: FarmRewardTypeV6Key;
  perSecond: number;
  perBlock: number;
}
export interface RewardKeyInfoV6 {
  mint: ApiV3Token;
  vault: string;
  type: FarmRewardTypeV6Key;
  perSecond: number;
  openTime: string;
  endTime: string;
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
export type FormatFarmKeyOutV345 = FormatFarmKeyOutBase & {
  rewardInfos: RewardKeyInfoV345[];
};
export type FormatFarmKeyOutV6 = FormatFarmKeyOutBase & {
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
export interface RewardInfoV345 {
  mint: ApiV3Token;
  type: FarmRewardTypeV6Key;
  apr: number;
  perSecond: string;
}
export interface RewardInfoV6 {
  mint: ApiV3Token;
  type: FarmRewardTypeV6Key;
  apr: number;
  perSecond: string;
  openTime: string;
  endTime: string;
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

export interface AvailabilityCheckAPI3 {
  all: boolean;
  swap: boolean;
  createConcentratedPosition: boolean;
  addConcentratedPosition: boolean;
  addStandardPosition: boolean;
  removeConcentratedPosition: boolean;
  removeStandardPosition: boolean;
  addFarm: boolean;
  removeFarm: boolean;
}

export type OwnerCreatedFarmInfo = {
  farm: { id: string; programId: string }[];
  clmm: { id: string; programId: string }[];
};

export type OwnerIdoInfo = Record<
  string,
  {
    programId: string;
    poolId: string;
    coin: string;
    pc: string;
  }
>;

export type IdoKeysData = {
  programId: string;
  id: string;
  authority: string;
  projectInfo: {
    mint: ApiV3Token;
    vault: string;
  };
  buyInfo: {
    mint: ApiV3Token;
    vault: string;
  };
};

export interface ApiStakePool {
  programId: string;
  id: string;
  apr: number;
  lpMint: ApiV3Token;
  lpPrice: number;
  symbolMints: ApiV3Token[];
  tvl: number;
  tags: FarmTagsItem[];
  rewardInfos: RewardInfoV345[];
}

export type FarmPositionData = Record<
  string,
  Record<
    string,
    Record<
      string,
      {
        programId: string;
        lpAmount: string;
        version: "V1" | "V2";
      }
    >
  >
>;
