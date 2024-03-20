import { PublicKey } from "@solana/web3.js";
import { ApiV3Token } from "../../api/type";

export interface PurchaseInstructionKeys {
  // ido
  idoId: PublicKey;
  authority: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  // user
  userQuoteTokenAccount: PublicKey;
  userIdoInfo: PublicKey;
  userStakeInfo?: PublicKey;
  userIdoCheck: PublicKey;
  userOwner: PublicKey;
}

export interface ClaimInstructionKeys {
  // ido
  idoId: PublicKey;
  authority: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  poolBaseTokenAccount: PublicKey;
  // user
  userQuoteTokenAccount: PublicKey;
  userBaseTokenAccount: PublicKey;
  userIdoInfo: PublicKey;
  userOwner: PublicKey;
}
export interface ClaimInstructionKeysV3 {
  // ido
  idoId: PublicKey;
  authority: PublicKey;
  poolTokenAccount: PublicKey; // projectInfo.vault?
  // user
  userTokenAccount: PublicKey; // user token account.mint === projectInfo.mint?
  userIdoInfo: PublicKey;
  userOwner: PublicKey;
}

export type IdoVersion = 3;

export type SnapshotVersion = 1;

export interface IdoPoolConfig {
  id: PublicKey;

  // version: IdoVersion;
  programId: PublicKey;

  // snapshotVersion: SnapshotVersion;
  // snapshotProgramId: PublicKey;

  authority: PublicKey;
  // seedId: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  baseToken: ApiV3Token;
  quoteToken: ApiV3Token;
}

export interface IdoUserKeys {
  baseTokenAccount: PublicKey;
  quoteTokenAccount: PublicKey;
  ledgerAccount: PublicKey;
  // snapshotAccount: PublicKey;
  owner: PublicKey;
}

export interface IdoClaimInstructionParams {
  poolConfig: IdoPoolConfig;
  userKeys: IdoUserKeys;
  side: "base" | "quote";
}
