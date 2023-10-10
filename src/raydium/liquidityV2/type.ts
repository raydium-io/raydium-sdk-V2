import { PublicKey } from "@solana/web3.js";
import { TokenAmount } from "../../module/amount";
import { ApiV3PoolInfoStandardItem, AmmV4Keys, AmmV5Keys } from "../../api/type";
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
