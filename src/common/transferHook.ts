import { AccountMeta, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, addExtraAccountMetasForExecute, getTransferHook, unpackMint } from "@solana/spl-token";
import BN from "bn.js";

/** One token movement a program will perform on the caller's behalf, as Token-2022's transfer-hook resolution sees it. */
export interface TransferHookLeg {
  mint: PublicKey;
  /** token account the transfer debits */
  source: PublicKey;
  /** token account the transfer credits */
  destination: PublicKey;
  /** authority of `source` (the user, or the pool authority for vault withdrawals) */
  owner: PublicKey;
  amount: BN | number | bigint;
}

/** The active transfer-hook program on a mint, or null for legacy mints, hook-free mints and disabled hooks. */
export async function fetchTransferHookProgram(connection: Connection, mint: PublicKey): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(mint);
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  const hook = getTransferHook(unpackMint(mint, info, TOKEN_2022_PROGRAM_ID));
  if (!hook || hook.programId.equals(PublicKey.default)) return null;
  return hook.programId;
}

/**
 * The extra accounts Token-2022 needs to run a mint's transfer hook for each leg (resolved ExtraAccountMetaList entries,
 * then the hook program and its validation account), deduplicated across legs so they can be appended once as remaining
 * accounts. Legs on mints without an active hook contribute nothing, so this is safe to call unconditionally.
 */
export async function fetchTransferHookAccounts(
  connection: Connection,
  legs: TransferHookLeg[],
): Promise<AccountMeta[]> {
  const byPubkey = new Map<string, AccountMeta>();
  const hookCache = new Map<string, PublicKey | null>();
  for (const leg of legs) {
    const key = leg.mint.toBase58();
    if (!hookCache.has(key)) hookCache.set(key, await fetchTransferHookProgram(connection, leg.mint));
    const hookProgram = hookCache.get(key);
    if (!hookProgram) continue;
    const probe = new TransactionInstruction({ keys: [], programId: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(0) });
    await addExtraAccountMetasForExecute(
      connection,
      probe,
      hookProgram,
      leg.source,
      leg.mint,
      leg.destination,
      leg.owner,
      BigInt(leg.amount.toString()),
    );
    for (const meta of probe.keys) {
      const k = meta.pubkey.toBase58();
      const prev = byPubkey.get(k);
      byPubkey.set(k, {
        pubkey: meta.pubkey,
        isSigner: false, // the outer instruction's signers already sign; never let a resolved meta demand one
        isWritable: (prev?.isWritable ?? false) || meta.isWritable,
      });
    }
  }
  return [...byPubkey.values()];
}
