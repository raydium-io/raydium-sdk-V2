import { PublicKey } from "@solana/web3.js";
import { TokenAmount } from "../../module/amount";
import { ApiV3PoolInfoStandardItem, AmmV4Keys, AmmV5Keys } from "../../api/type";
import { BigNumberish } from "../../common/bignumber";
import BN from "bn.js";

export type LiquiditySide = "a" | "b";
export type AmountSide = "base" | "quote";

export interface AddLiquidityParams {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  amountInA: TokenAmount;
  amountInB: TokenAmount;
  fixedSide: LiquiditySide;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
}

export interface RemoveParams {
  poolInfo: ApiV3PoolInfoStandardItem;
  payer?: PublicKey;
  amountIn: TokenAmount;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
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
}

export interface CreatePoolParam {
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
