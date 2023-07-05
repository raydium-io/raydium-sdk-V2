import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { ApiJsonPairInfo, ApiPoolJsonInfo } from "../../api/type";
import { GetMultipleAccountsInfoConfig } from "../../common/accountInfo";
import { BigNumberish } from "../../common/bignumber";
import { PublicKeyish } from "../../common/pubKey";
import { JsonFileMetaData } from "../../common/json-file";
import { SplToken } from "../token";
import { Percent, Price, Token, TokenAmount, CurrencyAmount } from "../../module";
import { ReplaceType } from "../type";
import Decimal from "decimal.js-light";

export type LiquidityPoolJsonInfo = ApiPoolJsonInfo;

export type PairJsonInfo = ApiJsonPairInfo;
/* ================= pool keys ================= */
export type LiquidityPoolKeysV4 = {
  [T in keyof LiquidityPoolJsonInfo]: string extends LiquidityPoolJsonInfo[T] ? PublicKey : LiquidityPoolJsonInfo[T];
};

export type LiquiditySide = "a" | "b";
export type SwapSide = "in" | "out";
export type AmountSide = "base" | "quote";
/**
 * Full liquidity pool keys that build transaction need
 */
export type LiquidityPoolKeys = LiquidityPoolKeysV4;

export interface LiquidityPoolInfo {
  status: BN;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  baseReserve: BN;
  quoteReserve: BN;
  lpSupply: BN;
  startTime: BN;
}

export type SDKParsedLiquidityInfo = ReplaceType<LiquidityPoolJsonInfo, string, PublicKey> & {
  jsonInfo: LiquidityPoolJsonInfo;
  status: BN;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  baseReserve: BN;
  quoteReserve: BN;
  lpSupply: BN;
  startTime: BN;
};

export interface AmmSource {
  poolKeys: LiquidityPoolKeys;
  poolInfo: LiquidityPoolInfo;
}

export interface SerumSource {
  marketKeys: [];
  bids: [];
  asks: [];
}

export interface LiquidityFetchMultipleInfoParams {
  pools: LiquidityPoolKeys[];
  config?: GetMultipleAccountsInfoConfig;
}

export interface LiquidityComputeAmountOutParams {
  poolKeys: LiquidityPoolKeys;
  poolInfo: LiquidityPoolInfo;
  amountIn: TokenAmount;
  outputToken: Token;
  slippage: Percent;
}

export type LiquidityComputeAmountOutReturn = {
  amountOut: TokenAmount;
  minAmountOut: TokenAmount;
  currentPrice: Price;
  executionPrice: Price | null;
  priceImpact: Percent;
  fee: TokenAmount;
};

export interface LiquiditySwapTransactionParams {
  poolKeys: LiquidityPoolKeys;
  payer?: PublicKey;
  amountIn: TokenAmount;
  amountOut: TokenAmount;
  fixedSide: SwapSide;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
}
export interface LiquiditySwapFixedOutInstructionParamsV4 {
  poolKeys: LiquidityPoolKeys;
  userKeys: {
    tokenAccountIn: PublicKey;
    tokenAccountOut: PublicKey;
    owner: PublicKey;
  };
  // maximum amount in
  maxAmountIn: BigNumberish;
  amountOut: BigNumberish;
}

/**
 * Swap instruction params
 */
export interface LiquiditySwapInstructionParams {
  poolKeys: LiquidityPoolKeys;
  userKeys: {
    tokenAccountIn: PublicKey;
    tokenAccountOut: PublicKey;
    owner: PublicKey;
  };
  amountIn: BigNumberish;
  amountOut: BigNumberish;
  fixedSide: SwapSide;
}

export interface LiquiditySwapFixedInInstructionParamsV4 {
  poolKeys: LiquidityPoolKeys;
  userKeys: {
    tokenAccountIn: PublicKey;
    tokenAccountOut: PublicKey;
    owner: PublicKey;
  };
  amountIn: BigNumberish;
  minAmountOut: BigNumberish;
}

export interface LiquidityAssociatedPoolKeysV4
  extends Omit<
    LiquidityPoolKeysV4,
    "marketBaseVault" | "marketQuoteVault" | "marketBids" | "marketAsks" | "marketEventQueue"
  > {
  nonce: number;
}

/**
 * Associated liquidity pool keys
 * @remarks
 * without partial markets keys
 */
export type LiquidityAssociatedPoolKeys = LiquidityAssociatedPoolKeysV4;

export interface CreatePoolParam {
  programId: PublicKey;
  baseMint: PublicKey;
  baseDecimals: number;
  quoteMint: PublicKey;
  quoteDecimals: number;
  marketId: PublicKey;
  marketProgramId: PublicKey;
  ownerInfo: {
    useSOLBalance?: boolean; // if has WSOL mint
  };
  associatedOnly: boolean;
  checkCreateATAOwner: boolean;
}

export interface CreatePoolV4Param {
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

export interface CreatePoolV4Address {
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

export interface InitPoolParam extends CreatePoolParam {
  baseAmount: TokenAmount;
  quoteAmount: TokenAmount;
  startTime?: BigNumberish;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
  tokenProgram?: PublicKey;
}

export type LiquidityInitPoolInstructionParams = {
  poolKeys: LiquidityAssociatedPoolKeysV4;
  userKeys: {
    lpTokenAccount: PublicKey;
    payer: PublicKey;
  };
  startTime: BigNumberish;
};

/**
 * Add liquidity transaction params
 */
export interface LiquidityAddTransactionParams {
  poolId: PublicKeyish;
  payer?: PublicKey;
  amountInA: TokenAmount;
  amountInB: TokenAmount;
  fixedSide: LiquiditySide;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
}

/* ================= user keys ================= */
/**
 * Full user keys that build transaction need
 */
export interface LiquidityUserKeys {
  baseTokenAccount: PublicKey;
  quoteTokenAccount: PublicKey;
  lpTokenAccount: PublicKey;
  owner: PublicKey;
}

export interface LiquidityAddInstructionParamsV4 {
  poolKeys: LiquidityPoolKeys;
  userKeys: LiquidityUserKeys;
  baseAmountIn: BigNumberish;
  quoteAmountIn: BigNumberish;
  fixedSide: AmountSide;
}

/**
 * Add liquidity instruction params
 */
export type LiquidityAddInstructionParams = LiquidityAddInstructionParamsV4;

export interface LiquidityRemoveInstructionParamsV4 {
  poolKeys: LiquidityPoolKeys;
  userKeys: LiquidityUserKeys;
  amountIn: BigNumberish;
}
export interface LiquidityRemoveTransactionParams {
  poolId: PublicKeyish;
  payer?: PublicKey;
  amountIn: TokenAmount;
  config?: {
    bypassAssociatedCheck?: boolean;
    checkCreateATAOwner?: boolean;
  };
}
/**
 * Remove liquidity instruction params
 */
export type LiquidityRemoveInstructionParams = LiquidityRemoveInstructionParamsV4;

export interface LiquidityComputeAnotherAmountParams {
  poolId: PublicKeyish;
  amount: TokenAmount;
  anotherToken: Token;
  slippage: Percent;
}

export interface LiquidityPoolsJsonFile extends JsonFileMetaData {
  readonly official: LiquidityPoolJsonInfo[];
  readonly unOfficial: LiquidityPoolJsonInfo[];
}

export interface HydratedPairItemInfo {
  ammId: string;
  apr24h: number;
  apr7d: number;
  apr30d: number;
  fee7d: CurrencyAmount; // usd
  fee7dQuote: CurrencyAmount; // usd
  fee24h: CurrencyAmount; // usd
  fee24hQuote: CurrencyAmount; // usd
  fee30d: CurrencyAmount; // usd
  fee30dQuote: CurrencyAmount; // usd
  liquidity: CurrencyAmount; // usd
  lpMint: string;
  market: string;
  name: string;
  official: boolean;

  tokenAmountBase: TokenAmount | null; // renameFrom: tokenAmountCoin. if unknown token, return null
  tokenAmountLp: TokenAmount | null; // renameFrom: tokenAmountLp. if unknown token, return null
  tokenAmountQuote: TokenAmount | null; // renameFrom: tokenAmountPc. if unknown token, return null

  volume7d: CurrencyAmount; // usd
  volume7dQuote: CurrencyAmount; // usd
  volume24h: CurrencyAmount; // usd
  volume24hQuote: CurrencyAmount; // usd
  volume30d: CurrencyAmount; // usd
  volume30dQuote: CurrencyAmount; // usd

  lpPrice: Price | null;
  price: Price | null;

  // customized

  lp?: SplToken;
  base?: SplToken;
  quote?: SplToken;

  basePooled: TokenAmount | undefined; // user's wallet must has pool's lp
  quotePooled: TokenAmount | undefined; // user's wallet must has pool's lp
  sharePercent: Decimal | undefined; // user's wallet must has pool's lp

  isStablePool: boolean;
  isOpenBook: boolean;
}

export interface LiquidityInitPoolInstructionParamsV4 {
  poolKeys: LiquidityAssociatedPoolKeysV4;
  userKeys: {
    lpTokenAccount: PublicKey;
    payer: PublicKey;
  };
  startTime: BigNumberish;
}
