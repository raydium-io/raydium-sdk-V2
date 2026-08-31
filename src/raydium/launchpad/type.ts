import { PublicKey, Signer } from "@solana/web3.js";
import { ComputeBudgetConfig, TxTipConfig } from "../type";
import { TxVersion } from "@/common";
import BN from "bn.js";
import { LaunchpadPool, LaunchpadConfig, PlatformConfig, PlatformCurveRule } from "./layout";
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
  platformVestingScale?: BN; // for preload usage

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
  creatorFeeOn?: CpmmCreatorFeeOn;
  platformAllowConfig?: boolean;

  mintBProgram?: PublicKey;
  transferFeeConfigB?: TransferFeeConfig | undefined;
  skipCheckMintB?: boolean;
}

export interface BuyToken<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  mintAProgram?: PublicKey;
  mintBProgram?: PublicKey;
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
  transferFeeConfigB?: TransferFeeConfig | undefined;
  skipCheckMintA?: boolean;
  skipCheckMintB?: boolean;
  fromCreate?: boolean;
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
  mintBProgram?: PublicKey;
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
  transferFeeConfigB?: TransferFeeConfig | undefined;
  skipCheckMintA?: boolean;
  skipCheckMintB?: boolean;
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
  platformVestingWallet: PublicKey;
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
  platformVestingScale?: BN;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface CreatePlatformAllowConfig<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  platformAdmin: PublicKey;
  platformId: PublicKey;

  configInfo: {
    mintB: string | PublicKey;
    curveType: number;
    index: number;
  };

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
    | { type: "updateVestingWallet"; value: PublicKey }
    | { type: "updatePlatformVestingScale"; value: BN }
    | { type: "updatePlatformCpCreator"; value: PublicKey }
    | { type: "updateRestrictGlobalConfig"; value: BN }
    | {
        type: "updateAll";
        value: {
          platformClaimFeeWallet: PublicKey;
          platformLockNftWallet: PublicKey;
          platformVestingWallet: PublicKey;
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
          platformVestingScale: BN;
        };
      };

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export interface CreatePlatformVestingAccount<T = TxVersion.LEGACY> {
  programId?: PublicKey;

  platformVestingWallet: PublicKey;
  beneficiary: PublicKey;
  platformId: PublicKey;
  poolId: PublicKey;
  vestingRecord?: PublicKey;

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

export interface ClaimMultiCreatorFee<T = TxVersion.LEGACY> {
  programId?: PublicKey;
  mintBList: {
    pubKey: PublicKey;
    programId?: PublicKey;
  }[];
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
}

export type LaunchpadPoolInfo = ReturnType<typeof LaunchpadPool.decode>;
export type LaunchpadConfigInfo = ReturnType<typeof LaunchpadConfig.decode>;
export type LaunchpadPlatformInfo = ReturnType<typeof PlatformConfig.decode>;
export type LaunchpadCurveRuleInfo = ReturnType<typeof PlatformCurveRule.decode>;

export enum LaunchpadCurveRuleField {
  CurveType = 0,
  MigrateType = 1,
  MigrateCpmmFeeOn = 2,
  Supply = 3,
  TotalSellA = 4,
  TotalFundRaisingB = 5,
  TotalLockedAmount = 6,
  CliffPeriod = 7,
  UnlockPeriod = 8,
  /** 0: the base mint belongs to spl token, 1: to token2022, see LaunchpadCurveRuleBaseTokenProgram */
  BaseTokenProgram = 9,
  /** 1 when the base mint carries the transfer fee extension, 0 when it does not */
  TransferFeeEnabled = 10,
  /** the transfer fee rate of the base mint, denominator 10000, 0 without the extension */
  TransferFeeBasisPoints = 11,
  /** the maximum transfer fee of the base mint, 0 without the extension */
  TransferFeeMaximumFee = 12,
  /** derived: totalSellA / supply, denominated in 10^-6 */
  SellRateA = 13,
  /** derived: totalLockedAmount / supply, denominated in 10^-6 */
  LockRate = 14,
  /** derived: supply - totalSellA - totalLockedAmount, the base amount reaching the migrated pool */
  MigrateAmountA = 15,
  /** derived: migrate amount / supply, denominated in 10^-6 */
  MigrateRateA = 16,
  /** derived: totalFundRaisingB / supply, denominated in 10^-6, a band on the graduation valuation */
  FundRaisingRateB = 17,
  /** the block time the pool is created at, in seconds, it lets a group carry a validity window */
  UnixTimestamp = 18,
}

/**
 * The fields that read totalSellA. They are only accepted on a constant product config: the
 * fixed and the linear curve derive the sell amount themselves, so the program refuses
 * these fields when the rule of such a config is written.
 */
export const LAUNCHPAD_CURVE_RULE_CONSTANT_PRODUCT_ONLY_FIELDS = [
  LaunchpadCurveRuleField.TotalSellA,
  LaunchpadCurveRuleField.SellRateA,
  LaunchpadCurveRuleField.MigrateAmountA,
  LaunchpadCurveRuleField.MigrateRateA,
];

export enum LaunchpadCurveRuleOp {
  Eq = 0,
  /** min */
  Gte = 1,
  /** max */
  Lte = 2,
  Neq = 3,
}

export enum LaunchpadCurveRuleBaseTokenProgram {
  SplToken = 0,
  Token2022 = 1,
}

export interface LaunchpadCurveRuleConstraint {
  field: LaunchpadCurveRuleField;
  op: LaunchpadCurveRuleOp;
  value: BN;
}

export const LAUNCHPAD_MAX_CURVE_RULE_GROUPS = 10;
export const LAUNCHPAD_MAX_CONSTRAINTS_PER_GROUP = 25;
export enum CpmmCreatorFeeOn {
  OnlyTokenB,
  BothToken,
}
