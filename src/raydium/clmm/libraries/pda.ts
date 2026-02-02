import { PublicKey } from '@solana/web3.js';
import { findProgramAddress, METADATA_PROGRAM_ID, ProgramAddress } from "../../../common";
import { i32ToBytes, i32ToBytesBE, u16ToBytesBE } from './utils';

export const AMM_CONFIG_SEED = Buffer.from('amm_config', 'utf8')
export const POOL_SEED = Buffer.from('pool', 'utf8')
export const POOL_VAULT_SEED = Buffer.from('pool_vault', 'utf8')
export const POOL_REWARD_VAULT_SEED = Buffer.from('pool_reward_vault', 'utf8')
export const POSITION_SEED = Buffer.from('position', 'utf8')
export const TICK_ARRAY_SEED = Buffer.from('tick_array', 'utf8')
export const OPERATION_SEED = Buffer.from('operation', 'utf8')
export const POOL_TICK_ARRAY_BITMAP_SEED = Buffer.from('pool_tick_array_bitmap_extension', 'utf8')
export const POOL_OBSERVATION_SEED = Buffer.from('observation', 'utf8')
export const SUPPORT_MINT_SEED = Buffer.from('support_mint', 'utf8')
export const DYNAMIC_FEE_CONFIG_SEED = Buffer.from('dynamic_fee_config', 'utf8')
export const LIMIT_ORDER_SEED = Buffer.from('limit_order', 'utf8')


export function getPdaAmmConfigId(programId: PublicKey, index: number): ProgramAddress {
  return findProgramAddress([AMM_CONFIG_SEED, u16ToBytesBE(index)], programId)
}

export function getPdaPoolId(
  programId: PublicKey,
  ammConfigId: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey
): ProgramAddress {
  return findProgramAddress(
    [POOL_SEED, ammConfigId.toBuffer(), mintA.toBuffer(), mintB.toBuffer()],
    programId
  )
}

export function getPdaPoolVaultId(
  programId: PublicKey,
  poolId: PublicKey,
  vaultMint: PublicKey
): ProgramAddress {
  return findProgramAddress(
    [POOL_VAULT_SEED, poolId.toBuffer(), vaultMint.toBuffer()],
    programId
  )
}

export function getPdaPoolRewardVaultId(
  programId: PublicKey,
  poolId: PublicKey,
  rewardMint: PublicKey
): ProgramAddress {
  return findProgramAddress(
    [POOL_REWARD_VAULT_SEED, poolId.toBuffer(), rewardMint.toBuffer()],
    programId
  )
}

export function getPdaTickArrayAddress(
  programId: PublicKey,
  poolId: PublicKey,
  startIndex: number
): ProgramAddress {
  return findProgramAddress(
    [TICK_ARRAY_SEED, poolId.toBuffer(), i32ToBytesBE(startIndex)],
    programId
  )
}

export function getPdaProtocolPositionAddress(
  programId: PublicKey,
  poolId: PublicKey,
  tickLower: number,
  tickUpper: number
): ProgramAddress {
  return findProgramAddress(
    [POSITION_SEED, poolId.toBuffer(), i32ToBytes(tickLower), i32ToBytes(tickUpper)],
    programId
  )
}

export function getPdaPersonalPositionAddress(
  programId: PublicKey,
  nftMint: PublicKey
): ProgramAddress {
  return findProgramAddress([POSITION_SEED, nftMint.toBuffer()], programId)
}

export function getPdaMetadataKey(mint: PublicKey): ProgramAddress {
  return findProgramAddress(
    [
      Buffer.from('metadata', 'utf8'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  )
}

export function getPdaOperationAccount(programId: PublicKey): ProgramAddress {
  return findProgramAddress([OPERATION_SEED], programId)
}

export function getPdaExBitmapAccount(
  programId: PublicKey,
  poolId: PublicKey
): ProgramAddress {
  return findProgramAddress([POOL_TICK_ARRAY_BITMAP_SEED, poolId.toBuffer()], programId)
}

export function getPdaObservationAccount(
  programId: PublicKey,
  poolId: PublicKey
): ProgramAddress {
  return findProgramAddress([POOL_OBSERVATION_SEED, poolId.toBuffer()], programId)
}

export function getPdaMintExAccount(
  programId: PublicKey,
  mintAddress: PublicKey
): ProgramAddress {
  return findProgramAddress([SUPPORT_MINT_SEED, mintAddress.toBuffer()], programId)
}

export function getPdaLimitOrderAddress(
  programId: PublicKey,
  payer: PublicKey,
  poolId: PublicKey,
  tickIndex: number,
  zeroForOne: boolean
): ProgramAddress {
  return findProgramAddress(
    [
      payer.toBuffer(),
      poolId.toBuffer(),
      i32ToBytesBE(tickIndex),
      Buffer.from([zeroForOne ? 1 : 0]),
    ],
    programId
  )
}

export function getPdaDynamicFeeConfigAddress(
  programId: PublicKey,
  index: number
): ProgramAddress {
  return findProgramAddress(
    [DYNAMIC_FEE_CONFIG_SEED, u16ToBytesBE(index)],
    programId
  )
}

export const POOL_LOCK_ID_SEED = Buffer.from("locked_position", "utf8");
export function getPdaLockPositionId(
  programId: PublicKey,
  positionId: PublicKey,
): ProgramAddress {
  return findProgramAddress([POOL_LOCK_ID_SEED, positionId.toBuffer()], programId);
}

export function getPdaLockClPositionIdV2(
  programId: PublicKey,
  lockNftMint: PublicKey,
): ProgramAddress {
  return findProgramAddress([POOL_LOCK_ID_SEED, lockNftMint.toBuffer()], programId);
}