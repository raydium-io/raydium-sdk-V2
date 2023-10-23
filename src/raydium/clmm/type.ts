import { EpochInfo, Keypair, PublicKey, Signer, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Fraction } from "../../module/fraction";
import { TokenInfo } from "../token/type";
import { TokenAmount, CurrencyAmount, Percent, Price } from "../../module";
import { TickArray } from "./utils/tick";
import { ApiClmmPoolInfo, ApiClmmConfigInfo, ApiV3PoolInfoConcentratedItem, ClmmKeys } from "../../api/type";
import { GetTransferAmountFee, TransferAmountFee } from "../type";
import { ApiV3Token } from "../../api/type";
import { ClmmPositionLayout } from "./layout";

export { ApiClmmPoolInfo, ApiClmmConfigInfo };

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
  observationIndex: number;
  observationUpdateDuration: number;
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

  exBitmapInfo: TickArrayBitmapExtension;
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

export interface HydratedConcentratedInfo extends SDKParsedConcentratedInfo {
  protocolFeeRate: Percent;
  tradeFeeRate: Percent;
  base: TokenInfo | undefined;
  quote: TokenInfo | undefined;
  id: PublicKey;
  userPositionAccount?: UserPositionAccount[];
  name: string;
  idString: string;
  decimals: number;

  ammConfig: ClmmPoolInfo["ammConfig"];
  currentPrice: Fraction;
  rewardInfos: {
    rewardToken: TokenInfo | undefined;
    rewardState: number;
    openTime: number;
    endTime: number;
    lastUpdateTime: number;
    rewardTotalEmissioned: TokenAmount | undefined;
    rewardClaimed: TokenAmount | undefined;
    tokenMint: PublicKey;
    tokenVault: PublicKey;
    creator: PublicKey;
    rewardPerWeek: TokenAmount | undefined;
    rewardPerDay: TokenAmount | undefined;
    perSecond: Decimal;
    remainingRewards?: BN;
  }[];
  tvl: CurrencyAmount;
  feeApr24h: Percent;
  feeApr7d: Percent;
  feeApr30d: Percent;
  totalApr24h: Percent;
  totalApr7d: Percent;
  totalApr30d: Percent;

  volume24h: CurrencyAmount;
  volume7d: CurrencyAmount;
  volume30d: CurrencyAmount;

  fee24hA?: TokenAmount;
  fee24hB?: TokenAmount;
  fee7dA?: TokenAmount;
  fee7dB?: TokenAmount;
  fee30dA?: TokenAmount;
  fee30dB?: TokenAmount;

  volumeFee24h: CurrencyAmount;
  volumeFee7d: CurrencyAmount;
  volumeFee30d: CurrencyAmount;

  rewardApr24h: Percent[];
  rewardApr7d: Percent[];
  rewardApr30d: Percent[];
}

export interface MintInfo {
  programId: PublicKey;
  mint: PublicKey;
  decimals: number;
}

export interface ReturnTypeMakeTransaction {
  signers: (Signer | Keypair)[];
  transaction: Transaction;
  address: { [name: string]: PublicKey };
}

export interface ReturnTypeMakeCreatePoolTransaction {
  signers: (Signer | Keypair)[];
  transaction: Transaction;
  mockPoolInfo: ClmmPoolInfo;
}
export interface ReturnTypeMakeInstructions<T = Record<string, PublicKey>> {
  signers: (Signer | Keypair)[];
  instructions: TransactionInstruction[];
  instructionTypes: string[];
  address: T;
  lookupTableAddress: PublicKey[];
}

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
  realAmountIn: TransferAmountFee;
  amountOut: TransferAmountFee;
  minAmountOut: TransferAmountFee;
  expirationTime: number | undefined;
  currentPrice: Price;
  executionPrice: Price;
  priceImpact: Percent;
  fee: TokenAmount;
  remainingAccounts: PublicKey[];
}
export interface ReturnTypeComputeAmountOut {
  realAmountIn: GetTransferAmountFee;
  amountOut: GetTransferAmountFee;
  minAmountOut: GetTransferAmountFee;
  expirationTime: number | undefined;
  currentPrice: Decimal;
  executionPrice: Decimal;
  priceImpact: Percent;
  fee: BN;
  remainingAccounts: PublicKey[];
}
export interface ReturnTypeFetchMultiplePoolInfos {
  [id: string]: {
    state: ClmmPoolInfo;
    positionAccount?: ClmmPoolPersonalPosition[] | undefined;
  };
}
export interface ReturnTypeFetchMultiplePoolTickArrays {
  [poolId: string]: { [key: string]: TickArray };
}

export interface CreateConcentratedPool {
  programId: PublicKey;
  owner?: PublicKey;
  mint1: ApiV3Token;
  mint2: ApiV3Token;
  ammConfig: ClmmConfigInfo;
  initialPrice: Decimal;
  startTime: BN;
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

export interface IncreasePositionFromLiquidity {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerPosition: ClmmPositionLayout;
  ownerInfo: {
    useSOLBalance?: boolean;
  };

  amountMaxA: BN;
  amountMaxB: BN;

  liquidity: BN;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface IncreasePositionFromBase {
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
}

export interface DecreaseLiquidity {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerPosition: ClmmPositionLayout;
  ownerInfo: {
    useSOLBalance?: boolean; // if has WSOL mint
    closePosition?: boolean;
  };

  liquidity: BN;
  amountMinA: BN;
  amountMinB: BN;

  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
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
}

export interface OpenPositionFromBase {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerInfo: {
    useSOLBalance?: boolean; // if has WSOL mint (default: true)
  };
  tickLower: number;
  tickUpper: number;

  base: "MintA" | "MintB";
  baseAmount: BN;
  otherAmountMax: BN;

  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  withMetadata?: "create" | "no-create";
  getEphemeralSigners?: (k: number) => any;
}

export interface OpenPositionFromLiquidity {
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

export interface SwapInParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerInfo: {
    feePayer: PublicKey;
    useSOLBalance?: boolean;
  };
  inputMint: PublicKey;
  amountIn: BN;
  amountOutMin: BN;
  priceLimit?: Decimal;
  remainingAccounts: PublicKey[];
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface GetAmountParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerPosition: ClmmPositionLayout;
  liquidity: BN;
  slippage: number;
  add: boolean;
  epochInfo: EpochInfo;
}

export interface InitRewardParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  rewardInfo: {
    programId: PublicKey;
    mint: PublicKey;
    openTime: number;
    endTime: number;
    perSecond: Decimal;
  };
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;

  programId: PublicKey;
  payer: PublicKey;
  operationId: PublicKey;
  ammConfigId: PublicKey;

  ownerTokenAccount: PublicKey;
  rewardMint: PublicKey;
  rewardVault: PublicKey;

  rewardIndex: number;
  openTime: number;
  endTime: number;
  emissionsPerSecondX64: BN;
}

export interface InitRewardsParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  rewardInfos: {
    programId: PublicKey;
    mint: PublicKey;
    openTime: number;
    endTime: number;
    perSecond: Decimal;
  }[];
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface SetRewardParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
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
}

export interface SetRewardsParams extends Omit<SetRewardParams, "rewardInfo"> {
  rewardInfos: {
    programId: PublicKey;
    mint: PublicKey;
    openTime: number; // If the reward is being distributed, please give 0
    endTime: number; // If no modification is required, enter 0
    perSecond: Decimal;
  }[];
}

export interface CollectRewardParams {
  poolInfo: ApiV3PoolInfoConcentratedItem;
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  rewardMint: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface CollectRewardsParams extends Omit<CollectRewardParams, "rewardMint"> {
  rewardMints: PublicKey[];
}

export interface HarvestAllRewardsParams {
  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean;
  };
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  programId?: PublicKey;
}

export interface ReturnTypeComputeAmountOutBaseOut {
  amountIn: BN;
  maxAmountIn: BN;
  currentPrice: Decimal;
  executionPrice: Decimal;
  priceImpact: Percent;
  fee: BN;
  remainingAccounts: PublicKey[];
}

export interface ReturnTypeMakeTransaction {
  signers: (Signer | Keypair)[];
  transaction: Transaction;
  address: { [name: string]: PublicKey };
}

export interface TickArrayBitmapExtension {
  poolId: PublicKey;
  positiveTickArrayBitmap: BN[][];
  negativeTickArrayBitmap: BN[][];
}

export interface ReturnTypeFetchExBitmaps {
  [exBitmapId: string]: TickArrayBitmapExtension;
}
