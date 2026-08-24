import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

/**
 * Bit positions inside a launchpad pool's `mintProgramFlag`.
 *
 * The field is a bitfield, not a boolean: bit0 describes mintA and bit1 describes mintB, each
 * holding 0 for the legacy SPL Token program and 1 for Token-2022. Quote mints were legacy only
 * until token2022 quote support landed, so bit1 used to be constant 0.
 */
export enum LaunchpadMintProgramBit {
  MintA = 0,
  MintB = 1,
}

export function getLaunchpadPoolMintProgram(mintProgramFlag: number, bit: LaunchpadMintProgramBit): PublicKey {
  return (mintProgramFlag >> bit) & 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

export function getLaunchpadPoolMintAProgram(mintProgramFlag: number): PublicKey {
  return getLaunchpadPoolMintProgram(mintProgramFlag, LaunchpadMintProgramBit.MintA);
}

export function getLaunchpadPoolMintBProgram(mintProgramFlag: number): PublicKey {
  return getLaunchpadPoolMintProgram(mintProgramFlag, LaunchpadMintProgramBit.MintB);
}

/** The reverse, for pool info the sdk predicts locally instead of reading from chain */
export function toLaunchpadMintProgramFlag({
  mintAProgram,
  mintBProgram,
}: {
  mintAProgram: PublicKey;
  mintBProgram: PublicKey;
}): number {
  return (
    (mintAProgram.equals(TOKEN_2022_PROGRAM_ID) ? 1 << LaunchpadMintProgramBit.MintA : 0) |
    (mintBProgram.equals(TOKEN_2022_PROGRAM_ID) ? 1 << LaunchpadMintProgramBit.MintB : 0)
  );
}
