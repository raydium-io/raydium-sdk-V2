import { PublicKey } from "@solana/web3.js";
import { ComputeBudgetConfig, TxTipConfig } from "../type";
import { TxVersion } from "@/common";
import BN from "bn.js";
import { LaunchpadPool } from "./layout";

export interface CreateLunchPad<T = TxVersion.LEGACY> {
  mintA: PublicKey;
  name: string;
  symbol: string;
  buyAmount: BN;

  programId?: PublicKey; // default mainnet
  authProgramId?: PublicKey; // default mainnet
  mintB?: PublicKey; // default SOL
  mintBDecimals?: number; // default SOL decimals 9
  decimals?: number; // default 6
  curType?: number; // default 0
  configIndex?: number; //default 0

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

  createOnly?: boolean;

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
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

  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  txVersion?: T;
  feePayer?: PublicKey;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
}

export type LaunchpadPoolInfo = ReturnType<typeof LaunchpadPool.decode>;
