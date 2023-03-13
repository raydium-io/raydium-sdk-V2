import { PublicKey } from "@solana/web3.js";
import { findProgramAddress } from "../../common";

export function getAssociatedLedgerAccountAddress({
  programId,
  poolId,
  owner,
}: {
  programId: PublicKey;
  poolId: PublicKey;
  owner: PublicKey;
}): PublicKey {
  const { publicKey } = findProgramAddress(
    [poolId.toBuffer(), owner.toBuffer(), Buffer.from(new Uint8Array(Buffer.from("ido_associated_seed", "utf-8")))],
    programId,
  );
  return publicKey;
}

export function getAssociatedSnapshotAddress({
  programId,
  seedId,
  owner,
}: {
  programId: PublicKey;
  seedId: PublicKey;
  owner: PublicKey;
}): PublicKey {
  const { publicKey } = findProgramAddress([seedId.toBuffer(), owner.toBuffer(), programId.toBuffer()], programId);
  return publicKey;
}
