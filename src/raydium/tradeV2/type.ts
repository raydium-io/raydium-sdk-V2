import { PublicKey, Keypair, Signer, TransactionInstruction, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { TokenAmount, Price, Percent, Token } from "../../module";
import { AmmV3PoolInfo } from "../ammV3";
import { LiquidityPoolJsonInfo } from "../liquidity";
import { TransferAmountFee } from "../type";

export type PoolType = AmmV3PoolInfo | LiquidityPoolJsonInfo;

export interface ComputeAmountOutAmmLayout {
  amountIn: TransferAmountFee;
  amountOut: TransferAmountFee;
  minAmountOut: TransferAmountFee;
  currentPrice: Price | undefined;
  executionPrice: Price | null;
  priceImpact: Percent;
  fee: TokenAmount[];
  routeType: "amm";
  poolKey: PoolType[];
  remainingAccounts: PublicKey[][];
  poolReady: boolean;
  poolType: "CLMM" | "STABLE" | undefined;

  feeConfig?: {
    feeAmount: BN;
    feeAccount: PublicKey;
  };

  expirationTime: number | undefined;
}
export interface ComputeAmountOutRouteLayout {
  amountIn: TransferAmountFee;
  amountOut: TransferAmountFee;
  minAmountOut: TransferAmountFee;
  currentPrice: Price | undefined;
  executionPrice: Price | null;
  priceImpact: Percent;
  fee: TokenAmount[];
  routeType: "route";
  poolKey: PoolType[];
  remainingAccounts: (PublicKey[] | undefined)[];
  minMiddleAmountFee: TokenAmount | undefined;
  middleToken: Token;
  poolReady: boolean;
  poolType: (string | undefined)[];

  feeConfig?: {
    feeAmount: BN;
    feeAccount: PublicKey;
  };

  expirationTime: number | undefined;
}

export type ComputeAmountOutLayout = ComputeAmountOutAmmLayout | ComputeAmountOutRouteLayout;

export type MakeSwapInstructionParam = {
  ownerInfo: {
    wallet: PublicKey;
    // tokenAccountA: PublicKey
    // tokenAccountB: PublicKey

    sourceToken: PublicKey;
    routeToken?: PublicKey;
    destinationToken: PublicKey;
    userPdaAccount?: PublicKey;
  };

  inputMint: PublicKey;
  routeProgram: PublicKey;

  swapInfo: ComputeAmountOutLayout;
};

export interface PoolAccountInfoV4 {
  ammId: string;
  status: BN;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  baseReserve: BN;
  quoteReserve: BN;
  lpSupply: BN;
  startTime: BN;
}

export interface ReturnTypeFetchMultipleInfo {
  [ammId: string]: PoolAccountInfoV4;
}
export type ReturnTypeGetAddLiquidityDefaultPool = LiquidityPoolJsonInfo | undefined;
export interface ReturnTypeMakeSwapInstruction {
  signers: (Keypair | Signer)[];
  instructions: TransactionInstruction[];
  instructionTypes: string[];
  address: { [key: string]: PublicKey };
  lookupTableAddress: PublicKey[];
}
export interface ReturnTypeMakeSwapTransaction {
  transactions: {
    transaction: Transaction;
    signer: (Keypair | Signer)[];
  }[];
  address: { [key: string]: PublicKey };
}

export type RoutePathType = {
  [routeMint: string]: {
    mintProgram: PublicKey;
    in: PoolType[];
    out: PoolType[];
    mDecimals: number;
  };
};

export interface ReturnTypeGetAllRoute {
  directPath: PoolType[];
  addLiquidityPools: LiquidityPoolJsonInfo[];
  routePathDict: RoutePathType;
  needSimulate: LiquidityPoolJsonInfo[];
  needTickArray: AmmV3PoolInfo[];
  needCheckToken: string[];
}
