import { EpochInfo, Keypair, PublicKey, Signer, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { ApiClmmConfigInfo, ApiV3PoolInfoConcentratedItem, ApiV3Token, ClmmKeys } from "../../api/type";
import { TxVersion } from "../../common/txTool/txType";
import { Fraction, Percent, Price, TokenAmount } from "../../module";
import { ComputeBudgetConfig, TxTipConfig } from "../../raydium/type";
import { TokenInfo } from "../token/type";
import { GetTransferAmountFee, TransferAmountFee } from "../type";
import { TickArray } from "./utils/tick";

import { ClmmPositionLayout, PoolInfoLayout, LockClPositionLayoutV2 } from "./layout";

export { ApiClmmConfigInfo };

export interface ApiClmmPoint {
  price: string;
  liquidity: string;
}

export interface ApiClmmConfigInfos {
  [configId: string]: ApiClmmConfigInfo;
}

export interface ClmmConfigInfo {
  id: PublicKey;
  index: number;
  protocolFeeRate: number;
  tradeFeeRate: number;
  tickSpacing: number;
  fundFeeRate: number;
  fundOwner: string;
  description: string;
}

export interface ClmmPoolRewardInfo {
  rewardState: number;
  openTime: BN;
  endTime: BN;
  lastUpdateTime: BN;
  emissionsPerSecondX64: BN;
  rewardTotalEmissioned: BN;
  rewardClaimed: BN;
  tokenMint: PublicKey;
  tokenVault: PublicKey;
  creator: PublicKey;
  rewardGrowthGlobalX64: BN;
  perSecond: Decimal;
  remainingRewards: undefined | BN;
  tokenProgramId: PublicKey;
}
export interface ClmmPoolInfo {
  id: PublicKey;
  mintA: {
    programId: PublicKey;
    mint: PublicKey;
    vault: PublicKey;
    decimals: number;
  };
  mintB: {
    programId: PublicKey;
    mint: PublicKey;
    vault: PublicKey;
    decimals: number;
  };

  ammConfig: ClmmConfigInfo;
  observationId: PublicKey;

  creator: PublicKey;
  programId: PublicKey;
  version: 6;

  tickSpacing: number;
  liquidity: BN;
  sqrtPriceX64: BN;
  currentPrice: Decimal;
  tickCurrent: number;
  feeGrowthGlobalX64A: BN;
  feeGrowthGlobalX64B: BN;
  protocolFeesTokenA: BN;
  protocolFeesTokenB: BN;
  swapInAmountTokenA: BN;
  swapOutAmountTokenB: BN;
  swapInAmountTokenB: BN;
  swapOutAmountTokenA: BN;
  tickArrayBitmap: BN[];

  rewardInfos: ClmmPoolRewardInfo[];

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
  lookupTableAccount: PublicKey;

  startTime: number;

  exBitmapInfo: TickArrayBitmapExtensionType;
}

export interface ComputeClmmPoolInfo {
  id: PublicKey;
  version: 6;
  mintA: ApiV3Token;
  mintB: ApiV3Token;

  ammConfig: ClmmConfigInfo;
  observationId: PublicKey;
  exBitmapAccount: PublicKey;

  creator: PublicKey;
  programId: PublicKey;

  tickSpacing: number;
  liquidity: BN;
  sqrtPriceX64: BN;
  currentPrice: Decimal;
  tickCurrent: number;
  feeGrowthGlobalX64A: BN;
  feeGrowthGlobalX64B: BN;
  protocolFeesTokenA: BN;
  protocolFeesTokenB: BN;
  swapInAmountTokenA: BN;
  swapOutAmountTokenB: BN;
  swapInAmountTokenB: BN;
  swapOutAmountTokenA: BN;
  tickArrayBitmap: BN[];

  startTime: number;

  exBitmapInfo: TickArrayBitmapExtensionType;
  rewardInfos: ReturnType<typeof PoolInfoLayout.decode>["rewardInfos"];
}

export interface ReturnTypeMakeHarvestTransaction {
  transactions: {
    transaction: Transaction;
    signer: Signer[];
  }[];
  address: { [key: string]: PublicKey };
}

export interface ClmmPoolPersonalPosition {
  poolId: PublicKey;
  nftMint: PublicKey;

  priceLower: Decimal;
  priceUpper: Decimal;
  amountA: BN;
  amountB: BN;
  tickLower: number;
  tickUpper: number;
  liquidity: BN;
  feeGrowthInsideLastX64A: BN;
  feeGrowthInsideLastX64B: BN;
  tokenFeesOwedA: BN;
  tokenFeesOwedB: BN;
  rewardInfos: {
    growthInsideLastX64: BN;
    rewardAmountOwed: BN;
    pendingReward: BN;
  }[];

  leverage: number;
  tokenFeeAmountA: BN;
  tokenFeeAmountB: BN;
}

export type SDKParsedConcentratedInfo = {
  state: ClmmPoolInfo;
  positionAccount?: ClmmPoolPersonalPosition[];
};

export interface ReturnTypeMakeCreatePoolTransaction {
  signers: (Signer | Keypair)[];
  transaction: Transaction;
  mockPoolInfo: ClmmPoolInfo;
}

export type ManipulateLiquidityExtInfo = {
  address: {
    tickArrayLower: PublicKey;
    tickArrayUpper: PublicKey;
    positionNftAccount: PublicKey;
    personalPosition: PublicKey;
    protocolPosition: PublicKey;
  };
};

export interface ReturnTypeGetLiquidityAmountOut {
  liquidity: BN;
  amountSlippageA: GetTransferAmountFee;
  amountSlippageB: GetTransferAmountFee;
  amountA: GetTransferAmountFee;
  amountB: GetTransferAmountFee;
  expirationTime: number | undefined;
}
export interface ReturnTypeGetAmountsFromLiquidity {
  amountSlippageA: BN;
  amountSlippageB: BN;
}
export interface ReturnTypeComputeAmountOutFormat {
  allTrade: boolean;
  realAmountIn: TransferAmountFee;
  amountOut: TransferAmountFee;
  minAmountOut: TransferAmountFee;
  expirationTime: number | undefined;
  currentPrice: Price;
  executionPrice: Price;
  priceImpact: Percent;
  fee: TokenAmount;
  remainingAccounts: PublicKey[];
  executionPriceX64: BN;
}
export interface ReturnTypeComputeAmountOut {
  allTrade: boolean;
  realAmountIn: GetTransferAmountFee;
  amountOut: GetTransferAmountFee;
  minAmountOut: GetTransferAmountFee;
  expirationTime: number | undefined;
  currentPrice: Decimal;
  executionPrice: Decimal;
  priceImpact: Percent;
  fee: BN;
  remainingAccounts: PublicKey[];
  executionPriceX64: BN;
}

export interface ReturnTypeComputeAmountOutBaseOut {
  amountIn: GetTransferAmountFee;
  maxAmountIn: GetTransferAmountFee;
  realAmountOut: GetTransferAmountFee;
  expirationTime: number | undefined;
  currentPrice: Decimal;
  executionPrice: Decimal;
  priceImpact: Percent;
  fee: BN;
  remainingAccounts: PublicKey[];
}

export interface ReturnTypeFetchMultiplePoolTickArrays {
  [poolId: string]: { [key: string]: TickArray };
}

export interface CreateConcentratedPool<T = TxVersion.LEGACY> {
  programId: PublicKey;
  owner?: PublicKey;
  mint1: ApiV3Token;
  mint2: ApiV3Token;
  ammConfig: ClmmConfigInfo;
  initialPrice: Decimal;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  forerunCreate?: boolean;
  getObserveState?: boolean;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface UserPositionAccount {
  /** transform to SDK function, should not used directlly in UI */
  sdkParsed: ClmmPoolPersonalPosition;
  rewardInfos: {
    pendingReward: TokenAmount | undefined;
    apr24h: Percent;
    apr7d: Percent;
    apr30d: Percent;
  }[];
  inRange: boolean;
  poolId: PublicKey;
  nftMint: PublicKey;
  priceLower: Fraction;
  priceUpper: Fraction;
  amountA?: TokenAmount;
  amountB?: TokenAmount;
  tokenA?: TokenInfo;
  tokenB?: TokenInfo;
  leverage: number;
  tickLower: number;
  tickUpper: number;
  positionPercentA: Percent;
  positionPercentB: Percent;
  tokenFeeAmountA?: TokenAmount;
  tokenFeeAmountB?: TokenAmount;
  getLiquidityVolume: (tokenPrices: Record<string, Price>) => {
    wholeLiquidity: Fraction | undefined;
    baseLiquidity: Fraction | undefined;
    quoteLiquidity: Fraction | undefined;
  };
}

export interface IncreasePositionFromLiquidity<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys?: ClmmKeys;
  ownerPosition: ClmmPositionLayout;
  ownerInfo: {
    useSOLBalance?: boolean;
  };

  amountMaxA: BN;
  amountMaxB: BN;

  liquidity: BN;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface IncreasePositionFromBase<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerPosition: ClmmPoolPersonalPosition;
  ownerInfo: {
    useSOLBalance?: boolean;
  };
  base: "MintA" | "MintB";
  baseAmount: BN;
  otherAmountMax: BN;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface DecreaseLiquidity<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys?: ClmmKeys;
  ownerPosition: ClmmPositionLayout;
  ownerInfo: {
    useSOLBalance?: boolean; // if has WSOL mint
    closePosition?: boolean;
  };

  liquidity: BN;
  amountMinA: BN;
  amountMinB: BN;
  nftAccount?: PublicKey;

  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface LockPosition<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  authProgramId?: PublicKey;
  poolProgramId?: PublicKey;
  ownerPosition: ClmmPositionLayout;
  payer?: PublicKey;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  getEphemeralSigners?: (k: number) => any;
  feePayer?: PublicKey;
}

export interface HarvestLockPosition<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  authProgramId?: PublicKey;
  clmmProgram?: PublicKey;
  poolKeys?: ClmmKeys;
  lockData: ReturnType<typeof LockClPositionLayoutV2.decode>;
  ownerInfo?: {
    useSOLBalance?: boolean; // if has WSOL mint
  };
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface ClmmPoolRewardLayoutInfo {
  rewardState: number;
  openTime: BN;
  endTime: BN;
  lastUpdateTime: BN;
  emissionsPerSecondX64: BN;
  rewardTotalEmissioned: BN;
  rewardClaimed: BN;
  tokenMint: PublicKey;
  tokenVault: PublicKey;
  creator: PublicKey;
  rewardGrowthGlobalX64: BN;
  feePayer?: PublicKey;
}

export interface OpenPositionFromBase<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys?: ClmmKeys;
  ownerInfo: {
    useSOLBalance?: boolean; // if has WSOL mint (default: true)
  };
  tickLower: number;
  tickUpper: number;

  base: "MintA" | "MintB";
  baseAmount: BN;
  otherAmountMax: BN;

  nft2022?: boolean;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  withMetadata?: "create" | "no-create";
  getEphemeralSigners?: (k: number) => any;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface OpenPositionFromBaseExtInfo {
  nftMint: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
  positionNftAccount: PublicKey;
  metadataAccount: PublicKey;
  personalPosition: PublicKey;
  protocolPosition: PublicKey;
}

export interface OpenPositionFromLiquidity<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys?: ClmmKeys;
  ownerInfo: {
    useSOLBalance?: boolean; // if has WSOL mint (default: true)
  };
  amountMaxA: BN;
  amountMaxB: BN;
  tickLower: number;
  tickUpper: number;
  liquidity: BN;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  withMetadata?: "create" | "no-create";
  getEphemeralSigners?: (k: number) => any;
  txVersion?: T;
  computeBudgetConfig;
  nft2022?: boolean;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface OpenPositionFromLiquidityExtInfo {
  address: {
    nftMint: PublicKey;
    tickArrayLower: PublicKey;
    tickArrayUpper: PublicKey;
    positionNftAccount: PublicKey;
    metadataAccount: PublicKey;
    personalPosition: PublicKey;
    protocolPosition: PublicKey;
  };
}

export interface GetAmountParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerPosition: ClmmPositionLayout;
  liquidity: BN;
  slippage: number;
  add: boolean;
  epochInfo: EpochInfo;
}

export interface InitRewardParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys?: ClmmKeys;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  rewardInfo: {
    mint: ApiV3Token;
    openTime: number;
    endTime: number;
    perSecond: Decimal;
  };
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface InitRewardsParams<T = TxVersion.LEGACY> extends Omit<InitRewardParams<T>, "rewardInfo"> {
  rewardInfos: {
    mint: ApiV3Token;
    openTime: number;
    endTime: number;
    perSecond: Decimal;
  }[];
}

export interface SetRewardParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys?: ClmmKeys;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };

  rewardInfo: {
    programId: PublicKey;
    mint: PublicKey;
    openTime: number; // If the reward is being distributed, please give 0
    endTime: number; // If no modification is required, enter 0
    perSecond: Decimal;
  };
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface SetRewardsParams<T = TxVersion.LEGACY> extends Omit<SetRewardParams<T>, "rewardInfo"> {
  rewardInfos: {
    mint: ApiV3Token;
    openTime: number; // If the reward is being distributed, please give 0
    endTime: number; // If no modification is required, enter 0
    perSecond: Decimal;
  }[];
}

export interface CollectRewardParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  rewardMint: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface CollectRewardsParams<T = TxVersion.LEGACY> extends Omit<CollectRewardParams, "rewardMint"> {
  rewardMints: PublicKey[];
}

export interface HarvestAllRewardsParams<T = TxVersion.LEGACY> {
  allPoolInfo: Record<string, ApiV3PoolInfoConcentratedItem>;
  allPositions: Record<string, ClmmPositionLayout[]>;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean;
  };
  lockInfo?: { [poolId: string]: { [positionNft: string]: ReturnType<typeof LockClPositionLayoutV2.decode> } };
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  programId?: PublicKey;
  txVersion?: T;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface TickArrayBitmapExtensionType {
  poolId: PublicKey;
  positiveTickArrayBitmap: BN[][];
  negativeTickArrayBitmap: BN[][];
}

export interface ReturnTypeFetchExBitmaps {
  [exBitmapId: string]: TickArrayBitmapExtensionType;
}

export interface ClosePositionExtInfo {
  address: {
    positionNftAccount: PublicKey;
    personalPosition: PublicKey;
  };
}

export interface InitRewardExtInfo {
  address: {
    poolRewardVault: PublicKey;
    operationId: PublicKey;
  };
}

export type ClmmRpcData = ReturnType<typeof PoolInfoLayout.decode> & { currentPrice: number; programId: PublicKey };

export interface ClmmLockAddress {
  positionId: PublicKey;
  lockPositionId: PublicKey;
  lockNftAccount: PublicKey;
  lockNftMint: PublicKey;
  positionNftAccount: PublicKey;
  metadataAccount: PublicKey;
}
