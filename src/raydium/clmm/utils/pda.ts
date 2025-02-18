import { PublicKey } from "@solana/web3.js";

import { findProgramAddress, METADATA_PROGRAM_ID } from "../../../common";

import { i32ToBytes, u16ToBytes } from "./util";

export const AMM_CONFIG_SEED = Buffer.from("amm_config", "utf8");
export const POOL_SEED = Buffer.from("pool", "utf8");
export const POOL_VAULT_SEED = Buffer.from("pool_vault", "utf8");
export const POOL_REWARD_VAULT_SEED = Buffer.from("pool_reward_vault", "utf8");
export const POSITION_SEED = Buffer.from("position", "utf8");
export const TICK_ARRAY_SEED = Buffer.from("tick_array", "utf8");
export const OPERATION_SEED = Buffer.from("operation", "utf8");
export const POOL_TICK_ARRAY_BITMAP_SEED = Buffer.from("pool_tick_array_bitmap_extension", "utf8");
export const OBSERVATION_SEED = Buffer.from("observation", "utf8");

export function getPdaAmmConfigId(
  programId: PublicKey,
  index: number,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([AMM_CONFIG_SEED, u16ToBytes(index)], programId);
}

export function getPdaPoolId(
  programId: PublicKey,
  ammConfigId: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POOL_SEED, ammConfigId.toBuffer(), mintA.toBuffer(), mintB.toBuffer()], programId);
}

export function getPdaPoolVaultId(
  programId: PublicKey,
  poolId: PublicKey,
  vaultMint: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POOL_VAULT_SEED, poolId.toBuffer(), vaultMint.toBuffer()], programId);
}

export function getPdaPoolRewardVaulId(
  programId: PublicKey,
  poolId: PublicKey,
  rewardMint: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POOL_REWARD_VAULT_SEED, poolId.toBuffer(), rewardMint.toBuffer()], programId);
}

export function getPdaTickArrayAddress(
  programId: PublicKey,
  poolId: PublicKey,
  startIndex: number,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([TICK_ARRAY_SEED, poolId.toBuffer(), i32ToBytes(startIndex)], programId);
}

export function getPdaProtocolPositionAddress(
  programId: PublicKey,
  poolId: PublicKey,
  tickLower: number,
  tickUpper: number,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress(
    [POSITION_SEED, poolId.toBuffer(), i32ToBytes(tickLower), i32ToBytes(tickUpper)],
    programId,
  );
}

export function getPdaPersonalPositionAddress(
  programId: PublicKey,
  nftMint: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POSITION_SEED, nftMint.toBuffer()], programId);
}

export function getPdaMetadataKey(mint: PublicKey): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress(
    [Buffer.from("metadata", "utf8"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  );
}

export function getPdaOperationAccount(programId: PublicKey): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([OPERATION_SEED], programId);
}

export function getPdaExBitmapAccount(
  programId: PublicKey,
  poolId: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POOL_TICK_ARRAY_BITMAP_SEED, poolId.toBuffer()], programId);
}

export function getPdaObservationAccount(
  programId: PublicKey,
  poolId: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([OBSERVATION_SEED, poolId.toBuffer()], programId);
}

export const POOL_LOCK_ID_SEED = Buffer.from("locked_position", "utf8");
export function getPdaLockPositionId(
  programId: PublicKey,
  positionId: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POOL_LOCK_ID_SEED, positionId.toBuffer()], programId);
}

export function getPdaLockClPositionIdV2(
  programId: PublicKey,
  lockNftMint: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([POOL_LOCK_ID_SEED, lockNftMint.toBuffer()], programId);
}

export const SUPPORT_MINT_SEED = Buffer.from("support_mint", "utf8");
export function getPdaMintExAccount(
  programId: PublicKey,
  mintAddress: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([SUPPORT_MINT_SEED, mintAddress.toBuffer()], programId);
}
