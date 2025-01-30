import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { AmmV4Keys, AmmV5Keys, ApiV3PoolInfoStandardItem } from "../../api/type";
import { BigNumberish } from "../../common/bignumber";
import { TxVersion } from "../../common/txTool/txType";
import { TokenAmount } from "../../module/amount";
import { ComputeBudgetConfig, TxTipConfig } from "../../raydium/type";
import { liquidityStateV4Layout } from "./layout";

export type LiquiditySide = "a" | "b";
export type AmountSide = "base" | "quote";

export interface AddLiquidityParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  poolKeys?: AmmV4Keys | AmmV5Keys;
  payer?: PublicKey;
  amountInA: TokenAmount;
  amountInB: TokenAmount;
  otherAmountMin: TokenAmount;
  fixedSide: LiquiditySide;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  txVersion?: T;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface RemoveParams<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  poolKeys?: AmmV4Keys | AmmV5Keys;
  payer?: PublicKey;
  lpAmount: BN;
  baseAmountMin: BN;
  quoteAmountMin: BN;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  txVersion?: T;
  computeBudgetConfig?: ComputeBudgetConfig;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
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
  otherAmountMin: BigNumberish;
  fixedSide: AmountSide;
}

export interface RemoveLiquidityInstruction {
  poolInfo: ApiV3PoolInfoStandardItem;
  poolKeys: AmmV4Keys | AmmV5Keys;
  userKeys: LiquidityUserKeys;
  lpAmount: BigNumberish;
  baseAmountMin: BigNumberish;
  quoteAmountMin: BigNumberish;
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
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export interface CreateMarketAndPoolParam<T> {
  programId?: PublicKey;
  marketProgram?: PublicKey;
  feeDestinationId?: PublicKey;

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
  lowestFeeMarket?: boolean;
  assignSeed?: string;

  lotSize?: number;
  tickSize?: number;

  ownerInfo: {
    feePayer?: PublicKey;
    useSOLBalance?: boolean; // if has WSOL mint
  };
  associatedOnly: boolean;
  checkCreateATAOwner?: boolean;

  tokenProgram?: PublicKey;

  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
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

export interface ComputeAmountOutParam {
  poolInfo: ApiV3PoolInfoStandardItem & {
    baseReserve: BN;
    quoteReserve: BN;
    version: 4 | 5;
    status: number;
  };
  mintIn: string | PublicKey;
  mintOut: string | PublicKey;
  amountIn: BN;
  slippage: number;
}

export interface ComputeAmountInParam {
  poolInfo: ApiV3PoolInfoStandardItem & {
    baseReserve: BN;
    quoteReserve: BN;
    version: 4 | 5;
    status: number;
  };
  mintIn: string | PublicKey;
  mintOut: string | PublicKey;
  amountOut: BN;
  slippage: number;
}

export interface SwapParam<T = TxVersion.LEGACY> {
  poolInfo: ApiV3PoolInfoStandardItem;
  poolKeys?: AmmV4Keys | AmmV5Keys;
  amountIn: BN;
  amountOut: BN;
  inputMint: string;
  fixedSide: SwapSide;
  config?: {
    associatedOnly?: boolean;
    inputUseSolBalance?: boolean;
    outputUseSolBalance?: boolean;
  };
  computeBudgetConfig?: ComputeBudgetConfig;
  txVersion?: T;
  txTipConfig?: TxTipConfig;
  feePayer?: PublicKey;
}

export type AmmRpcData = ReturnType<typeof liquidityStateV4Layout.decode> & {
  baseReserve: BN;
  quoteReserve: BN;
  mintAAmount: BN;
  mintBAmount: BN;
  poolPrice: Decimal;
  programId: PublicKey;
};
