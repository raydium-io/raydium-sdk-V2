import { EpochInfo, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { ApiCpmmConfigInfo, ApiV3PoolInfoStandardItemCpmm, ApiV3Token, CpmmKeys } from "../../api/type";
import { TxVersion } from "../../common/txTool/txType";
import { Percent } from "../../module";
import { ComputeBudgetConfig, GetTransferAmountFee, TxTipConfig } from "../../raydium/type";
import { SwapResult } from "./curve/calculator";
import { CpmmConfigInfoLayout, CpmmPoolInfoLayout } from "./layout";

export interface CreateCpmmPoolParam<T> {
  poolId?: PublicKey;
  programId: PublicKey;
  poolFeeAccount: PublicKey;
  mintA: Pick<ApiV3Token, "address" | "decimals" | "programId">;
  mintB: Pick<ApiV3Token, "address" | "decimals" | "programId">;
  mintAAmount: BN;
  mintBAmount: BN;
  startTime: BN;
  feeConfig: ApiCpmmConfigInfo;

  associatedOnly: boolean;
  checkCreateATAOwner?: boolean;

  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface CreateCpmmPoolPermissionParam<T> {
  poolId?: PublicKey;
  programId: PublicKey;
  poolFeeAccount: PublicKey;
  mintA: Pick<ApiV3Token, "address" | "decimals" | "programId">;
  mintB: Pick<ApiV3Token, "address" | "decimals" | "programId">;
  mintAAmount: BN;
  mintBAmount: BN;
  startTime: BN;
  feeConfig: ApiCpmmConfigInfo;

  associatedOnly: boolean;
  checkCreateATAOwner?: boolean;

  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
  feeOn: FeeOn;
}

export interface CreateCpmmPoolAddress {
  poolId: PublicKey;
  configId: PublicKey;
  authority: PublicKey;
  lpMint: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  observationId: PublicKey;
  mintA: ApiV3Token;
  mintB: ApiV3Token;
  programId: PublicKey;
  poolFeeAccount: PublicKey;
  feeConfig: ApiCpmmConfigInfo;
}

export interface AddCpmmLiquidityParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys?: CpmmKeys;
  payer?: PublicKey;
  inputAmount: BN;
  baseIn: boolean;
  slippage: Percent;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  computeResult?: {
    inputAmountFee: GetTransferAmountFee;
    anotherAmount: GetTransferAmountFee;
    maxAnotherAmount: GetTransferAmountFee;
    liquidity: BN;
  };
  feePayer?: PublicKey;
}

export interface WithdrawCpmmLiquidityParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys?: CpmmKeys;
  payer?: PublicKey;
  lpAmount: BN;
  slippage: Percent;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  closeWsol?: boolean;
}

export interface CpmmSwapParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys?: CpmmKeys;
  payer?: PublicKey;
  baseIn: boolean;
  fixedOut?: boolean;
  slippage?: number;
  swapResult: Pick<SwapResult, "inputAmount" | "outputAmount">;
  inputAmount: BN;

  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
    associatedOnly?: boolean;
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ComputePairAmountParams {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  baseReserve: BN;
  quoteReserve: BN;
  amount: string | Decimal;
  slippage: Percent;
  epochInfo: EpochInfo;
  baseIn?: boolean;
}

export type CpmmParsedRpcData = ReturnType<typeof CpmmPoolInfoLayout.decode> & {
  baseReserve: BN;
  quoteReserve: BN;
  vaultAAmount: BN;
  vaultBAmount: BN;
  configInfo?: ReturnType<typeof CpmmConfigInfoLayout.decode>;
  poolPrice: Decimal;
  programId: PublicKey;
};

export type CpmmComputeData = {
  id: PublicKey;
  version: 7;
  configInfo: ReturnType<typeof CpmmConfigInfoLayout.decode>;
  mintA: ApiV3Token;
  mintB: ApiV3Token;
  authority: PublicKey;
} & Omit<CpmmParsedRpcData, "configInfo" | "mintA" | "mintB">;

export type CpmmLockExtInfo = {
  nftMint: PublicKey;
  nftAccount: PublicKey;
  metadataAccount: PublicKey;
  lockPda: PublicKey;
  userLpVault: PublicKey;
  lockLpVault: PublicKey;
};

export interface LockCpmmLpParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys?: CpmmKeys;
  lpAmount: BN;
  programId?: PublicKey;
  authProgram?: PublicKey;
  feePayer?: PublicKey;
  feeNftOwner?: PublicKey;
  withMetadata?: boolean;
  getEphemeralSigners?: (k: number) => any;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
}

export interface HarvestLockCpmmLpParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys?: CpmmKeys;

  nftMint: PublicKey;
  lpFeeAmount: BN;

  programId?: PublicKey;
  authProgram?: PublicKey;
  clmmProgram?: PublicKey;

  cpmmProgram?: {
    programId?: PublicKey;
    authProgram?: PublicKey;
  };

  feePayer?: PublicKey;

  withMetadata?: boolean;
  getEphemeralSigners?: (k: number) => any;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  closeWsol?: boolean;
}

export interface HarvestMultiLockCpmmLpParams<T = TxVersion.LEGACY> {
  lockInfo: {
    poolInfo: ApiV3PoolInfoStandardItemCpmm;
    poolKeys?: CpmmKeys;
    nftMint: PublicKey;
    lpFeeAmount: BN;
  }[];

  programId?: PublicKey;
  authProgram?: PublicKey;
  clmmProgram?: PublicKey;

  cpmmProgram?: {
    programId?: PublicKey;
    authProgram?: PublicKey;
  };

  feePayer?: PublicKey;
  withMetadata?: boolean;
  getEphemeralSigners?: (k: number) => any;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  closeWsol?: boolean;
}

export interface CpmmLockNftBasicInfo {
  name: string;
  symbol: string;
  description: string;
  external_url: string;
  collection: {
    name: string;
    family: string;
  };
  image: string;
}

export interface CpmmLockNftInfo extends CpmmLockNftBasicInfo {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  positionInfo: {
    percentage: number;
    usdValue: number;
    unclaimedFee: {
      lp: number;
      amountA: number;
      amountB: number;
      useValue: number;
    };
  };
}

export interface CollectCreatorFees<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys?: CpmmKeys;

  programId?: PublicKey;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
}

export interface CollectMultiCreatorFees<T = TxVersion.LEGACY> {
  poolInfoList: ApiV3PoolInfoStandardItemCpmm[];

  programId?: PublicKey;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
}

export enum FeeOn {
  BothToken,
  OnlyTokenA,
  OnlyTokenB,
}
