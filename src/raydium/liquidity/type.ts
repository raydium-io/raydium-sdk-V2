import { PublicKey } from "@solana/web3.js";
import { ApiV3PoolInfoStandardItem, AmmV4Keys, AmmV5Keys, ApiV3Token } from "@/api/type";
import { TxVersion } from "@/common/txTool/txType";
import { BigNumberish } from "@/common/bignumber";
import BN from "bn.js";
import { ComputeBudgetConfig } from "@/raydium/type";
import { TokenAmount } from "@/module/amount";
import { SwapResult } from "./curve/calculator";

export type LiquiditySide = "a" | "b";
export type AmountSide = "base" | "quote";

export interface AddLiquidityParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  amountInA: TokenAmount;
  amountInB: TokenAmount;
  fixedSide: LiquiditySide;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  txVersion?: T;
}

export interface RemoveParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  amountIn: BN;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  txVersion?: T;
}

export interface LiquidityUserKeys {
  baseTokenAccount: PublicKey;
  quoteTokenAccount: PublicKey;
  lpTokenAccount: PublicKey;
  owner: PublicKey;
}

export interface LiquidityAddInstructionParams {
  poolInfo: ApiV3PoolInfoStandardItem;
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: LiquidityUserKeys;
  baseAmountIn: BigNumberish;
  quoteAmountIn: BigNumberish;
  fixedSide: AmountSide;
}

export interface RemoveLiquidityInstruction {
  poolInfo: ApiV3PoolInfoStandardItem;
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: LiquidityUserKeys;
  amountIn: BigNumberish;
}

export interface LiquidityPoolKeys {
  // base
  id: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  // version
  version: 4 | 5;
  programId: PublicKey;
  // keys
  authority: PublicKey;
  nonce: number;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  lpVault: PublicKey;
  openOrders: PublicKey;
  targetOrders: PublicKey;
  withdrawQueue: PublicKey;
  // market version
  marketVersion: 3;
  marketProgramId: PublicKey;
  // market keys
  marketId: PublicKey;
  marketAuthority: PublicKey;
  lookupTableAccount: PublicKey;
  configId: PublicKey;
}

export interface CreatePoolParam<T> {
  programId: PublicKey;
  marketInfo: {
    marketId: PublicKey;
    programId: PublicKey;
  };
  baseMintInfo: {
    mint: PublicKey;
    decimals: number;
  };
  quoteMintInfo: {
    mint: PublicKey;
    decimals: number;
  };

  baseAmount: BN;
  quoteAmount: BN;
  startTime: BN;

  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  associatedOnly: boolean;
  checkCreateATAOwner?: boolean;
  tokenProgram?: PublicKey;
  feeDestinationId: PublicKey;
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
}

export interface CreatePoolAddress {
  programId: PublicKey;
  ammId: PublicKey;
  ammAuthority: PublicKey;
  ammOpenOrders: PublicKey;
  lpMint: PublicKey;
  coinMint: PublicKey;
  pcMint: PublicKey;
  coinVault: PublicKey;
  pcVault: PublicKey;
  withdrawQueue: PublicKey;
  ammTargetOrders: PublicKey;
  poolTempLp: PublicKey;
  marketProgramId: PublicKey;
  marketId: PublicKey;
  ammConfigId: PublicKey;
  feeDestinationId: PublicKey;
}

export interface SwapFixedInInstructionParamsV4 {
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: {
    tokenAccountIn: PublicKey;
    tokenAccountOut: PublicKey;
    owner: PublicKey;
  };
  amountIn: BigNumberish;
  minAmountOut: BigNumberish;
}

export interface SwapFixedOutInstructionParamsV4 {
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: {
    tokenAccountIn: PublicKey;
    tokenAccountOut: PublicKey;
    owner: PublicKey;
  };
  // maximum amount in
  maxAmountIn: BigNumberish;
  amountOut: BigNumberish;
}

export type SwapSide = "in" | "out";
export interface SwapInstructionParams {
  version: number;
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: {
    tokenAccountIn: PublicKey;
    tokenAccountOut: PublicKey;
    owner: PublicKey;
  };
  amountIn: BigNumberish;
  amountOut: BigNumberish;
  fixedSide: SwapSide;
}

export interface InitPoolInstructionParamsV4 {
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: {
    lpTokenAccount: PublicKey;
    payer: PublicKey;
  };
  startTime: BigNumberish;
}

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
  mintA: ApiV3Token;
  mintB: ApiV3Token;
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
