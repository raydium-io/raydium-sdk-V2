import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { BigNumberish } from "../../common/bignumber";
import { GetStructureSchema } from "../../marshmallow";

import { splAccountLayout } from "./layout";

export type SplAccountLayout = typeof splAccountLayout;
export type SplAccount = GetStructureSchema<SplAccountLayout>;
export interface TokenAccountRaw {
  programId: PublicKey;
  pubkey: PublicKey;
  accountInfo: SplAccount;
}

export interface TokenAccount {
  publicKey?: PublicKey;
  mint: PublicKey;
  isAssociated?: boolean;
  amount: BN;
  isNative: boolean;
  programId: PublicKey;
}

export interface getCreatedTokenAccountParams {
  mint: PublicKey;
  config?: { associatedOnly?: boolean };
}

export interface HandleTokenAccountParams {
  side: "in" | "out";
  amount: BigNumberish;
  mint: PublicKey;
  programId?: PublicKey;
  tokenAccount?: PublicKey;
  payer?: PublicKey;
  bypassAssociatedCheck: boolean;
  skipCloseAccount?: boolean;
  checkCreateATAOwner?: boolean;
}

export interface GetOrCreateTokenAccountParams {
  mint: PublicKey;
  owner: PublicKey;
  createInfo?: {
    payer: PublicKey;
    amount?: BigNumberish;
  };

  associatedOnly: boolean;
  notUseTokenAccount?: boolean;
  skipCloseAccount?: boolean;
  tokenProgram?: PublicKey | string;
  checkCreateATAOwner?: boolean;
  assignSeed?: string;
}
