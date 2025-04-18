import { PublicKey } from "@solana/web3.js";
import { findProgramAddress, ProgramAddress } from "@/common";
import { u16ToBytes } from "../clmm";

export const LAUNCHPAD_AUTH_SEED = Buffer.from("vault_auth_seed", "utf8");
export const LAUNCHPAD_CONFIG_SEED = Buffer.from("global_config", "utf8");
export const LAUNCHPAD_POOL_SEED = Buffer.from("pool", "utf8");
export const LAUNCHPAD_POOL_VAULT_SEED = Buffer.from("pool_vault", "utf8");
export const LAUNCHPAD_POOL_VESTING_SEED = Buffer.from("pool_vesting", "utf8");
export const LAUNCHPAD_POOL_PLATFORM_SEED = Buffer.from("platform_config", "utf8");

export function getPdaLaunchpadAuth(programId: PublicKey): ProgramAddress {
  return findProgramAddress([LAUNCHPAD_AUTH_SEED], programId);
}

export function getPdaLaunchpadConfigId(
  programId: PublicKey,
  mintB: PublicKey,
  curveType: number,
  index: number,
): ProgramAddress {
  return findProgramAddress(
    [LAUNCHPAD_CONFIG_SEED, mintB.toBuffer(), u8ToBytes(curveType), u16ToBytes(index)],
    programId,
  );
}

export function getPdaLaunchpadPoolId(programId: PublicKey, mintA: PublicKey, mintB: PublicKey): ProgramAddress {
  return findProgramAddress([LAUNCHPAD_POOL_SEED, mintA.toBuffer(), mintB.toBuffer()], programId);
}

export function getPdaLaunchpadVaultId(programId: PublicKey, poolId: PublicKey, mint: PublicKey): ProgramAddress {
  return findProgramAddress([LAUNCHPAD_POOL_VAULT_SEED, poolId.toBuffer(), mint.toBuffer()], programId);
}

export function u8ToBytes(num: number): Uint8Array {
  const arr = new ArrayBuffer(1);
  const view = new DataView(arr);
  view.setUint8(0, num);
  return new Uint8Array(arr);
}

export function getPdaCpiEvent(programId: PublicKey): ProgramAddress {
  return findProgramAddress([Buffer.from("__event_authority", "utf8")], programId);
}

export function getPdaPlatformId(programId: PublicKey, platformAdminWallet: PublicKey): ProgramAddress {
  return findProgramAddress([LAUNCHPAD_POOL_PLATFORM_SEED, platformAdminWallet.toBuffer()], programId);
}

export function getPdaVestId(programId: PublicKey, poolId: PublicKey, owner: PublicKey): ProgramAddress {
  return findProgramAddress([LAUNCHPAD_POOL_VESTING_SEED, poolId.toBuffer(), owner.toBuffer()], programId);
}
