import { PublicKey, Signer } from "@solana/web3.js";
import { ComputeBudgetConfig, TxTipConfig } from "../type";
import { TxVersion } from "@/common";
import BN from "bn.js";
import { LaunchpadPool, LaunchpadConfig, PlatformConfig } from "./layout";

export interface CreateLaunchPad<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  name: string;
  symbol: string;
  buyAmount: BN;
  platformId?: PublicKey;

  programId?: PublicKey; // default mainnet
  authProgramId?: PublicKey; // default mainnet
  decimals?: number; // default 6
  mintBDecimals?: number; // default 9
  curType?: number; // default 0
  configId: PublicKey;
  configInfo?: LaunchpadConfigInfo;

  minMintAAmount?: BN; // default calculated by realtime rpc data
  slippage?: BN;

  uri: string;
  migrateType: "amm" | "cpmm";

  supply?: BN;
  totalSellA?: BN;
  totalFundRaisingB?: BN;
  totalLockedAmount?: BN;
  cliffPeriod?: BN;
  unlockPeriod?: BN;

  shareFeeRate?: BN;
  shareFeeReceiver?: PublicKey;
  platformFeeRate?: BN; // for preload usage

  createOnly?: boolean;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  extraSigners?: Signer[];
}

export interface BuyToken<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  buyAmount: BN;

  programId?: PublicKey; // default mainnet
  authProgramId?: PublicKey; // default mainnet
  mintB?: PublicKey; // default SOL
  poolInfo?: LaunchpadPoolInfo; // default calculated from mint
  minMintAAmount?: BN; // default calculated by realtime rpc data
  slippage?: BN;
  shareFeeRate?: BN;
  shareFeeReceiver?: PublicKey;

  configInfo?: LaunchpadConfigInfo; // for preload usage
  platformFeeRate?: BN; // for preload usage

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface SellToken<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  sellAmount: BN;
  slippage?: BN;

  programId?: PublicKey; // default mainnet
  authProgramId?: PublicKey; // default mainnet
  poolInfo?: LaunchpadPoolInfo; // default calculated from mint
  mintB?: PublicKey; // default SOL
  minAmountB?: BN; // default SOL decimals 9

  shareFeeRate?: BN;
  shareFeeReceiver?: PublicKey;

  configInfo?: LaunchpadConfigInfo; // for preload usage
  platformFeeRate?: BN; // for preload usage

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface CreatePlatform<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  platformAdmin: PublicKey;
  platformClaimFeeWallet: PublicKey;
  platformLockNftWallet: PublicKey;
  cpConfigId: PublicKey;

  migrateCpLockNftScale: {
    platformScale: BN;
    creatorScale: BN;
    burnScale: BN;
  };

  feeRate: BN;
  name: string;
  web: string;
  img: string;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface UpdatePlatform<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  platformAdmin: PublicKey;
  platformId?: PublicKey;

  updateInfo:
  | { type: "updateClaimFeeWallet"; value: PublicKey }
  | { type: "updateFeeRate"; value: BN }
  | { type: "updateName" | "updateImg" | "updateWeb"; value: string }
  | { type: "migrateCpLockNftScale"; value: { platformScale: BN; creatorScale: BN; burnScale: BN } }
  | { type: 'updateCpConfigId', value: PublicKey }
  | {
    type: 'updateAll', value: {
      platformClaimFeeWallet: PublicKey,
      platformLockNftWallet: PublicKey,
      cpConfigId: PublicKey,
      migrateCpLockNftScale: {
        platformScale: BN,
        creatorScale: BN,
        burnScale: BN,
      },
      feeRate: BN,
      name: string,
      web: string,
      img: string,
    }
  };

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimPlatformFee<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  authProgramId?: PublicKey;
  platformId: PublicKey;
  platformClaimFeeWallet: PublicKey;
  poolId: PublicKey;

  mintB?: PublicKey;
  vaultB?: PublicKey;
  mintBProgram?: PublicKey;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimAllPlatformFee<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  authProgramId?: PublicKey;
  platformId: PublicKey;
  platformClaimFeeWallet: PublicKey;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface CreateVesting<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  poolId: PublicKey;
  beneficiary: PublicKey;
  shareAmount: BN;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimVesting<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  poolId: PublicKey;
  poolInfo?: LaunchpadPoolInfo;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;

  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export type LaunchpadPoolInfo = ReturnType<typeof LaunchpadPool.decode>;
export type LaunchpadConfigInfo = ReturnType<typeof LaunchpadConfig.decode>;
export type LaunchpadPlatformInfo = ReturnType<typeof PlatformConfig.decode>;
