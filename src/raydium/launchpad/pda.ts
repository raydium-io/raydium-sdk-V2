import { PublicKey } from "@solana/web3.js";
import { findProgramAddress, ProgramAddress } from "@/common";
import { u16ToBytes, POOL_SEED, POOL_VAULT_SEED } from "../clmm";

export const AUTH_SEED = Buffer.from("vault_auth_seed", "utf8");
export const CONFIG_SEED = Buffer.from("global_config", "utf8");
export const POOL_VESTING_SEED = Buffer.from("pool_vesting", "utf8");
export const PLATFORM_SEED = Buffer.from("platform_config", "utf8");
export const PLATFORM_FEE_VAULT_AUTH_SEED = Buffer.from("platform_fee_vault_auth_seed", "utf8");
export const CREATOR_FEE_VAULT_AUTH_SEED = Buffer.from("creator_fee_vault_auth_seed", "utf8");

export function getPdaLaunchpadAuth(programId: PublicKey): ProgramAddress {
  return findProgramAddress([AUTH_SEED], programId);
}

export function getPdaLaunchpadConfigId(
  programId: PublicKey,
  mintB: PublicKey,
  curveType: number,
  index: number,
): ProgramAddress {
  return findProgramAddress([CONFIG_SEED, mintB.toBuffer(), u8ToBytes(curveType), u16ToBytes(index)], programId);
}

export function getPdaLaunchpadPoolId(programId: PublicKey, mintA: PublicKey, mintB: PublicKey): ProgramAddress {
  return findProgramAddress([POOL_SEED, mintA.toBuffer(), mintB.toBuffer()], programId);
}

export function getPdaLaunchpadVaultId(programId: PublicKey, poolId: PublicKey, mint: PublicKey): ProgramAddress {
  return findProgramAddress([POOL_VAULT_SEED, poolId.toBuffer(), mint.toBuffer()], programId);
}

export function getPdaCpiEvent(programId: PublicKey): ProgramAddress {
  return findProgramAddress([Buffer.from("__event_authority", "utf8")], programId);
}

export function u8ToBytes(num: number) {
  const arr = new ArrayBuffer(1);
  const view = new DataView(arr);
  view.setUint8(0, num);
  return new Uint8Array(arr);
}

// export function u16ToBytes(num: number): Uint8Array<ArrayBuffer> {
//   const arr = new ArrayBuffer(2);
//   const view = new DataView(arr);
//   view.setUint16(0, num, false);
//   return new Uint8Array(arr);
// }

export function getPdaPlatformId(programId: PublicKey, platformAdminWallet: PublicKey): ProgramAddress {
  return findProgramAddress([PLATFORM_SEED, platformAdminWallet.toBuffer()], programId);
}

export function getPdaVestId(programId: PublicKey, poolId: PublicKey, owner: PublicKey): ProgramAddress {
  return findProgramAddress([POOL_VESTING_SEED, poolId.toBuffer(), owner.toBuffer()], programId);
}

export function getPdaPlatformVault(programId: PublicKey, platformId: PublicKey, mintB: PublicKey): ProgramAddress {
  return findProgramAddress([platformId.toBuffer(), mintB.toBuffer()], programId);
}

export function getPdaPlatformFeeVaultAuth(programId: PublicKey): ProgramAddress {
  return findProgramAddress([PLATFORM_FEE_VAULT_AUTH_SEED], programId);
}

export function getPdaCreatorVault(programId: PublicKey, creator: PublicKey, mintB: PublicKey): ProgramAddress {
  return findProgramAddress([creator.toBuffer(), mintB.toBuffer()], programId);
}

export function getPdaCreatorFeeVaultAuth(programId: PublicKey): ProgramAddress {
  return findProgramAddress([CREATOR_FEE_VAULT_AUTH_SEED], programId);
}
