import { PublicKey } from "@solana/web3.js";

import { findProgramAddress } from "./txTool/txUtils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export function getATAAddress(
  owner: PublicKey,
  mint: PublicKey,
  programId?: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress(
    [owner.toBuffer(), (programId ?? TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  );
}
