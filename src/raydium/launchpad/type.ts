import { PublicKey, Signer } from "@solana/web3.js";
import { ComputeBudgetConfig, TxTipConfig } from "../type";
import { TxVersion } from "@/common";
import BN from "bn.js";
import { LaunchpadPool, LaunchpadConfig, PlatformConfig } from "./layout";
import { TransferFeeConfig } from "@solana/spl-token";

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

  token2022?: boolean;
  transferFeeExtensionParams?: { transferFeeBasePoints: number; maxinumFee: BN };
}

export interface BuyToken<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  mintAProgram?: PublicKey;
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
  transferFeeConfigA?: TransferFeeConfig | undefined;
  skipCheckMintA?: boolean;
}

export interface BuyTokenExactOut<T = TxVersion.LEGACY>
  extends Omit<BuyToken, "buyAmount" | "minMintAAmount" | "txVersion"> {
  maxBuyAmount?: BN;
  outAmount: BN;
  txVersion?: T;
}

export interface SellToken<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  mintAProgram?: PublicKey;
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
  skipCheckMintA?: boolean;
}

export interface SellTokenExactOut<T = TxVersion.LEGACY> extends Omit<SellToken, "sellAmount" | "txVersion"> {
  maxSellAmount?: BN;
  inAmount: BN;
  txVersion?: T;
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

  transferFeeExtensionAuth: PublicKey;
  creatorFeeRate: BN;
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
    | { type: "updateClaimFeeWallet" | "updateLockNftWallet"; value: PublicKey }
    | { type: "updateFeeRate"; value: BN }
    | { type: "updateName" | "updateImg" | "updateWeb"; value: string }
    | { type: "migrateCpLockNftScale"; value: { platformScale: BN; creatorScale: BN; burnScale: BN } }
    | { type: "updateCpConfigId"; value: PublicKey }
    | {
        type: "updateAll";
        value: {
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
          transferFeeExtensionAuth: PublicKey;
          creatorFeeRate: BN;
        };
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

export interface CreateMultipleVesting<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  poolId: PublicKey;
  beneficiaryList: {
    wallet: PublicKey;
    shareAmount: BN;
  }[];

  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimVesting<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  poolId: PublicKey;
  vestingRecord?: PublicKey;
  poolInfo?: LaunchpadPoolInfo;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimMultiVesting<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  poolIdList: PublicKey[];
  vestingRecords?: Record<string, PublicKey>;
  poolsInfo?: Record<
    string,
    {
      mintA: PublicKey;
      vaultA: PublicKey;
    }
  >;

  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimVaultPlatformFee<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  platformId: PublicKey;
  mintB: PublicKey;
  mintBProgram?: PublicKey;

  claimFeeWallet?: PublicKey;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface ClaimMultipleVaultPlatformFee<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  platformList: {
    id: PublicKey;
    mintB: PublicKey;
    mintBProgram?: PublicKey;
    claimFeeWallet?: PublicKey;
  }[];

  unwrapSol?: boolean;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface ClaimCreatorFee<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  mintB: PublicKey;
  mintBProgram?: PublicKey;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export type LaunchpadPoolInfo = ReturnType<typeof LaunchpadPool.decode>;
export type LaunchpadConfigInfo = ReturnType<typeof LaunchpadConfig.decode>;
export type LaunchpadPlatformInfo = ReturnType<typeof PlatformConfig.decode>;
