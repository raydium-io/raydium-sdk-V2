import { Keypair, PublicKey, Signer, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { ApiV3PoolInfoItem, PoolKeys } from "../../api/type";
import { Token, TokenAmount } from "../../module";
import { ComputeClmmPoolInfo } from "../../raydium/clmm/type";
import { ComputeAmountOutParam } from "../../raydium/liquidity/type";
import { CpmmComputeData } from "../cpmm";
import { TransferAmountFee } from "../type";

export interface ComputeAmountOutAmmLayout {
  amountIn: TransferAmountFee;
  amountOut: TransferAmountFee;
  minAmountOut: TransferAmountFee;
  currentPrice: Decimal | undefined;
  executionPrice: Decimal | null;
  priceImpact: Decimal;
  fee: TokenAmount[];
  routeType: "amm";
  poolInfoList: ComputePoolType[];
  remainingAccounts: PublicKey[][];
  poolReady: boolean;
  poolType: "CLMM" | "CPMM" | "STABLE" | undefined;

  feeConfig?: {
    feeAmount: BN;
    feeAccount: PublicKey;
  };

  expirationTime: number | undefined;

  allTrade: boolean;
  slippage: number;
  clmmExPriceX64: (BN | undefined)[];
}
export interface ComputeAmountOutRouteLayout {
  amountIn: TransferAmountFee;
  amountOut: TransferAmountFee;
  minAmountOut: TransferAmountFee;
  currentPrice: Decimal | undefined;
  executionPrice: Decimal | null;
  priceImpact: Decimal;
  fee: TokenAmount[];
  routeType: "route";
  poolInfoList: ComputePoolType[];
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
  allTrade: boolean;
  slippage: number;
  clmmExPriceX64: (BN | undefined)[];
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

  // ComputeAmountOutAmmLayout | ComputeAmountOutRouteLayout;
  swapInfo:
  | (
    | (Omit<ComputeAmountOutAmmLayout, "poolKey"> & {
      poolKey: PoolKeys[];
      poolInfo: ComputePoolType[];
    })
    | (Omit<ComputeAmountOutRouteLayout, "poolKey"> & {
      poolKey: PoolKeys[];
      poolInfo: ComputePoolType[];
    })
  ) & {
    outputMint: PublicKey;
  };
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
  [ammId: string]: ComputeAmountOutParam["poolInfo"];
}
export type ReturnTypeGetAddLiquidityDefaultPool = ApiV3PoolInfoItem | undefined;
export interface ReturnTypeMakeSwapInstruction {
  signers: (Keypair | Signer)[];
  instructions: TransactionInstruction[];
  instructionTypes: string[];
  address: { [key: string]: PublicKey };
  lookupTableAddress: string[];
}
export interface ReturnTypeMakeSwapTransaction {
  transactions: {
    transaction: Transaction;
    signer: (Keypair | Signer)[];
  }[];
  address: { [key: string]: PublicKey };
}

export type BasicPoolInfo = {
  id: PublicKey;
  version: number;
  mintA: PublicKey;
  mintB: PublicKey;
};

export type RoutePathType = {
  [routeMint: string]: {
    skipMintCheck?: boolean;
    mintProgram: PublicKey;
    in: BasicPoolInfo[];
    out: BasicPoolInfo[];
    mDecimals: number;
  };
};

export interface ReturnTypeGetAllRoute {
  directPath: BasicPoolInfo[];
  addLiquidityPools: BasicPoolInfo[];
  routePathDict: RoutePathType;
  needSimulate: BasicPoolInfo[];
  needTickArray: BasicPoolInfo[];
  cpmmPoolList: BasicPoolInfo[];
}

export type ComputePoolType = ComputeAmountOutParam["poolInfo"] | ComputeClmmPoolInfo | CpmmComputeData;
export type ComputeRoutePathType = {
  [routeMint: string]: {
    skipMintCheck?: boolean;
    mintProgram: PublicKey;
    in: ComputePoolType[];
    out: ComputePoolType[];
    mDecimals: number;
  };
};
