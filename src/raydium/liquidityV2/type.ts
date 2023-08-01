import { PublicKey } from "@solana/web3.js";
import { TokenAmount } from "../../module/amount";
import { ApiV3PoolInfoStandardItem } from "../../api/type";
import { BigNumberish } from "../../common/bignumber";

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

export interface LiquidityUserKeys {
  baseTokenAccount: PublicKey;
  quoteTokenAccount: PublicKey;
  lpTokenAccount: PublicKey;
  owner: PublicKey;
}

export interface LiquidityAddInstructionParams {
  poolInfo: ApiV3PoolInfoStandardItem;
  userKeys: LiquidityUserKeys;
  baseAmountIn: BigNumberish;
  quoteAmountIn: BigNumberish;
  fixedSide: AmountSide;
}
