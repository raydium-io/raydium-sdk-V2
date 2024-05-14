import { PublicKey } from "@solana/web3.js";
import { ApiV3PoolInfoStandardItem, ApiV3Token } from "@/api/type";
import { TxVersion } from "@/common/txTool/txType";
import BN from "bn.js";
import { ComputeBudgetConfig } from "@/raydium/type";
import { SwapResult } from "./curve/calculator";

export interface CpmmConfigInfoInterface {
  bump: number;
  disableCreatePool: boolean;
  index: number;
  tradeFeeRate: BN;
  protocolFeeRate: BN;
  fundFeeRate: BN;
  createPoolFee: BN;

  protocolOwner: PublicKey;
  fundOwner: PublicKey;
}

export interface CpmmPoolInfoInterface {
  configId: PublicKey;
  poolCreator: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;

  mintLp: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;

  mintProgramA: PublicKey;
  mintProgramB: PublicKey;

  observationId: PublicKey;

  bump: number;
  status: number;

  lpDecimals: number;
  mintDecimalA: number;
  mintDecimalB: number;

  lpAmount: BN;
  protocolFeesMintA: BN;
  protocolFeesMintB: BN;
  fundFeesMintA: BN;
  fundFeesMintB: BN;
  openTime: BN;
}

export interface CreateCpmmPoolParam<T> {
  programId: PublicKey;
  poolFeeAccount: PublicKey;
  mintA: Pick<ApiV3Token, "address" | "decimals" | "programId">;
  mintB: Pick<ApiV3Token, "address" | "decimals" | "programId">;
  mintAAmount: BN;
  mintBAmount: BN;
  startTime: BN;

  associatedOnly: boolean;
  checkCreateATAOwner?: boolean;

  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
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
}

export interface AddCpmmLiquidityParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  inputAmount: BN;
  anotherAmount: BN;
  liquidity: BN;
  baseIn: boolean;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
}

export interface WithdrawCpmmLiquidityParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  lpAmount: BN;
  amountMintA: BN;
  amountMintB: BN;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
}

export interface CpmmSwapParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  baseIn: boolean;
  swapResult: SwapResult;

  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
}
