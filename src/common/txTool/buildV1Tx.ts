import {
  PublicKey,
  TransactionInstruction,
  Keypair,
  TransactionMessage as Web3TransactionMessage,
  VersionedTransaction,
  type Signer,
  type AddressLookupTableAccount,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js"; // 1.x types

import { address, type Address } from "@solana/addresses";
import { AccountRole, type Instruction } from "@solana/instructions";
import { createKeyPairFromBytes } from "@solana/keys";
import { blockhash } from "@solana/rpc-types";
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessagePriorityFeeLamports,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  appendTransactionMessageInstruction,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionMessageWithBlockhashLifetime,
} from "@solana/transaction-messages";
import {
  compileTransaction,
  signTransaction,
  partiallySignTransaction,
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  getTransactionDecoder,
  type Transaction,
  type FullySignedTransaction,
  type Base64EncodedWireTransaction,
} from "@solana/transactions";

export interface BuildV1TxParams {
  payer: PublicKey;
  recentBlockhash: string;
  instructions: TransactionInstruction[];
  /** Max block height; the blockhash expires beyond it. Accepts number or bigint */
  lastValidBlockHeight: number | bigint;
  /**
   * Compute unit limit. v1 has no implicit default — leaving it unset makes the runtime treat it as 0,
   * which fails the transaction outright, so it is required here. In v1 the compute budget no longer
   * goes through a ComputeBudget instruction but is written into the config mask.
   */
  computeUnitLimit: number;
  /** v1 priority fee (total lamports; note v1 switched from micro-lamports/CU to total lamports) */
  priorityFeeLamports?: number | bigint;
  /** Loaded accounts data size limit (bytes); in v1 it goes into the config mask, not a ComputeBudget instruction */
  loadedAccountsDataSize?: number;
}

/**
 * Convert a 1.x TransactionInstruction into the 2.x Instruction format
 */
function convertV1InstructionToV2(ix: TransactionInstruction): Instruction {
  return {
    programAddress: address(ix.programId.toBase58()),
    accounts: ix.keys.map((acc) => ({
      address: address(acc.pubkey.toBase58()),
      role: acc.isWritable
        ? acc.isSigner
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.WRITABLE
        : acc.isSigner
        ? AccountRole.READONLY_SIGNER
        : AccountRole.READONLY,
    })),
    data: new Uint8Array(ix.data),
  };
}

/**
 * Build a V1 transaction message with the 2.x submodules and return a 2.x Transaction object
 * (it carries messageBytes and the pending signatures map; the caller signs / sends it with the 2.x API)
 */
export function buildV1Transaction({
  payer,
  recentBlockhash,
  instructions,
  lastValidBlockHeight,
  computeUnitLimit,
  priorityFeeLamports,
  loadedAccountsDataSize,
}: BuildV1TxParams): Transaction {
  // v1 has no implicit default: a compute unit limit of 0 makes the transaction fail at runtime, so reject it up front
  if (!Number.isInteger(computeUnitLimit) || computeUnitLimit <= 0) {
    throw new Error(
      `buildV1Transaction: computeUnitLimit must be a positive integer (v1 has no implicit default, 0 fails the transaction), received ${computeUnitLimit}`,
    );
  }

  const payerAddress: Address = address(payer.toBase58());

  // 1~2. Chain the builders with const (each builder returns a more precise type, so the same variable cannot be reassigned)
  const lifetimeMessage = setTransactionMessageLifetimeUsingBlockhash(
    {
      blockhash: blockhash(recentBlockhash), // set the blockhash
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
    },
    setTransactionMessageFeePayer(
      payerAddress, // set the payer
      createTransactionMessage({ version: 1 }), // initialize the V1 message
    ),
  );

  // 2.5 In v1 the compute budget is written into the config mask (not a ComputeBudget instruction); the priority fee is total lamports
  const baseMessage = setTransactionMessageLoadedAccountsDataSizeLimit(
    loadedAccountsDataSize,
    setTransactionMessagePriorityFeeLamports(
      priorityFeeLamports === undefined ? undefined : BigInt(priorityFeeLamports),
      setTransactionMessageComputeUnitLimit(computeUnitLimit, lifetimeMessage),
    ),
  );

  // 3. Append the converted Raydium instructions one by one (use the singular append: the plural 8.x signature's
  //    const type parameters cannot be resolved by TS 4.x).
  //    The accumulator is annotated as the intersection of three interfaces so both baseMessage and every
  //    append result stay assignable to it.
  let message: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithBlockhashLifetime =
    baseMessage;
  for (const ix of instructions) {
    message = appendTransactionMessageInstruction(convertV1InstructionToV2(ix), message);
  }

  // 4. Compile into a 2.x Transaction object (stays on v1 and entirely inside the 2.x ecosystem, never going through a 1.x VersionedTransaction)
  return compileTransaction(message);
}

/**
 * Convert a 1.x Keypair into the CryptoKeyPair required for 2.x signing
 * (Keypair.secretKey is 64 bytes, exactly what createKeyPairFromBytes expects)
 */
export function toCryptoKeyPair(keypair: Keypair): Promise<CryptoKeyPair> {
  return createKeyPairFromBytes(keypair.secretKey);
}

/**
 * Convert several 1.x Signers / Keypairs (with a 64-byte secretKey) into 2.x CryptoKeyPairs in one batch
 */
export function signersToCryptoKeyPairs(signers: (Signer | Keypair)[]): Promise<CryptoKeyPair[]> {
  return Promise.all(signers.map((s) => createKeyPairFromBytes(s.secretKey)));
}

/**
 * Partially sign a v1 transaction with CryptoKeyPairs (does not require every signer to be present).
 * Typical use: let an ephemeral signer (e.g. the keypair of a newly created account) sign first,
 * then hand the transaction to the wallet to sign as fee payer.
 */
export async function partialSignV1Transaction(
  transaction: Transaction,
  signers: CryptoKeyPair[],
): Promise<Transaction> {
  return partiallySignTransaction(signers, transaction);
}

/**
 * Sign the Transaction produced by buildV1Transaction using the 2.x API
 * @param transaction the return value of buildV1Transaction
 * @param signers the signers (convert 1.x Keypairs with toCryptoKeyPair first)
 * @returns the fully signed Transaction
 */
export async function signV1Transaction(
  transaction: Transaction,
  signers: CryptoKeyPair[],
): Promise<FullySignedTransaction & Transaction> {
  return signTransaction(signers, transaction);
}

/**
 * Serialize a (signed) Transaction into the base64 wire format, ready to pass to the RPC sendTransaction
 *
 * @example send it with @solana/kit (requires installing @solana/kit or @solana/rpc separately)
 * ```ts
 * import { createSolanaRpc } from "@solana/kit";
 * const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
 * const wire = serializeV1Transaction(signedTx);
 * const signature = await rpc.sendTransaction(wire, { encoding: "base64" }).send();
 * ```
 */
export function serializeV1Transaction(transaction: Transaction): Base64EncodedWireTransaction {
  return getBase64EncodedWireTransaction(transaction);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaded accounts data size measurement
// ─────────────────────────────────────────────────────────────────────────────

/** Protocol limit for loaded accounts data size (64 MiB); the cap for requestLoadedAccountsDataSize */
export const MAX_LOADED_ACCOUNTS_DATA_SIZE = 64 * 1024 * 1024;
/** Upgradeable BPF loader, used to tell whether an executable account has a separate programdata account */
const UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/**
 * Measure the recommended loadedAccountsDataSize (bytes) from the accounts the transaction actually loads.
 *
 * When a v1 transaction does not declare this limit, the runtime applies a fairly low default, and complex
 * transactions (e.g. CLMM, whose programdata alone is ~2MB) hit MaxLoadedAccountsDataSizeExceeded. This helper
 * sums the real data size of every account and program touched by the instructions, adds the size of the
 * programdata account for upgradeable programs, then applies a buffer ratio and caps the result at 64 MiB.
 *
 * Note: it issues 1~2 getMultipleAccountsInfo calls (one extra batch when there is programdata), so an 8MB
 * constant is fine for everyday use; reach for this only when precision matters (e.g. a transaction that
 * touches several large programs).
 *
 * @param connection RPC connection
 * @param instructions all instructions of the transaction (including endInstructions)
 * @param options.bufferRatio multiplier applied to the measured value, default 1.15 (+15% headroom)
 * @param options.extraBytes extra fixed padding (bytes), default 32 * 1024
 * @returns the recommended loadedAccountsDataSize (integer, capped at 64 MiB)
 */
export async function calcLoadedAccountsDataSize(
  connection: Connection,
  instructions: TransactionInstruction[],
  options?: { bufferRatio?: number; extraBytes?: number },
): Promise<number> {
  const bufferRatio = options?.bufferRatio ?? 1.15;
  const extraBytes = options?.extraBytes ?? 32 * 1024;

  // Collect every unique account + program id
  const keys = new Set<string>();
  for (const ix of instructions) {
    keys.add(ix.programId.toBase58());
    for (const acc of ix.keys) keys.add(acc.pubkey.toBase58());
  }
  const keyList = [...keys].map((k) => new PublicKey(k));

  // getMultipleAccountsInfo takes at most 100 keys per call, so fetch in batches
  const infos = await getMultipleAccountsInfoInBatch(connection, keyList);

  let total = 0;
  const programDataKeys: PublicKey[] = [];
  for (let i = 0; i < keyList.length; i++) {
    const info = infos[i];
    if (!info) continue; // does not exist (e.g. an ATA / PDA not created yet) → 0
    total += info.data.length;
    // An upgradeable program has a separate programdata account (holding the actual bytecode) that is loaded too
    if (info.executable && info.owner.equals(UPGRADEABLE_LOADER_ID)) {
      programDataKeys.push(PublicKey.findProgramAddressSync([keyList[i].toBuffer()], UPGRADEABLE_LOADER_ID)[0]);
    }
  }

  if (programDataKeys.length) {
    const pdInfos = await getMultipleAccountsInfoInBatch(connection, programDataKeys);
    for (const pd of pdInfos) if (pd) total += pd.data.length;
  }

  const withBuffer = Math.ceil(total * bufferRatio) + extraBytes;
  return Math.min(withBuffer, MAX_LOADED_ACCOUNTS_DATA_SIZE);
}

/** getMultipleAccountsInfo takes at most 100 keys per call; this splits the input into batches while preserving its order */
async function getMultipleAccountsInfoInBatch(
  connection: Connection,
  keys: PublicKey[],
): Promise<(AccountInfo<Buffer> | null)[]> {
  const BATCH = 100;
  const result: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    result.push(...(await connection.getMultipleAccountsInfo(batch)));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet (browser plugin) path
//
// ⚠️ Browser wallets (Phantom / Backpack…) never expose the private key; they only offer signTransaction /
//    signAllTransactions, and those take a web3.js 1.x VersionedTransaction. Since neither 1.x nor the major
//    wallets support the v1 format yet, the wallet path always uses v0 and stays entirely on the native 1.x API.
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildV0WalletTxParams {
  payer: PublicKey;
  recentBlockhash: string;
  instructions: TransactionInstruction[];
  /** v0 only: optional Address Lookup Tables, used to compress the account count */
  addressLookupTableAccounts?: AddressLookupTableAccount[];
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 + wallet (byte-level) signing path
//
// Wallet signing for v1 transactions goes through Wallet Standard's `solana:signTransaction` (which takes
// serialized bytes) instead of the old wallet-adapter signAllTransactions(VersionedTransaction[]). Nothing here
// is tied to a specific wallet package — the caller just passes in a "bytes in, signed bytes out" function.
//
// ⚠️ v1 goes live on mainnet on 2026-09-09; a wallet can only sign v1 once it has upgraded internally to
//    web3.js 3.x / kit 8.x and declares support for version 1 in the supportedTransactionVersions of its
//    `solana:signTransaction` feature.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Byte-level **batch** wallet signing function: takes several unsigned transaction byte arrays and returns the
 * matching signed ones. It mirrors the batch semantics of a wallet plugin's signAllTransactions but works on
 * serialized bytes for v1 compatibility (the old SignAllTransactions is tied to 1.x Transaction /
 * VersionedTransaction objects, which cannot represent v1).
 */
export type SignAllTransactionsByteLevel = (transactionsBytes: Uint8Array[]) => Promise<Uint8Array[]>;

// ── Wallet Standard adapters (described as minimal structural types to avoid a hard dependency on @wallet-standard/*) ──

/** Minimal shape of a single Wallet Standard `solana:signTransaction` input */
export interface WalletStandardSignTransactionInput {
  account: unknown; // the Wallet Standard WalletAccount, passed back to the wallet as-is
  transaction: Uint8Array;
  chain?: string; // e.g. "solana:mainnet"
  options?: Record<string, unknown>;
}
/** Minimal shape of a single Wallet Standard `solana:signTransaction` output */
export interface WalletStandardSignTransactionOutput {
  signedTransaction: Uint8Array;
}
/** The signTransaction method of the Wallet Standard `solana:signTransaction` feature (variadic batch) */
export type WalletStandardSignTransaction = (
  ...inputs: WalletStandardSignTransactionInput[]
) => Promise<WalletStandardSignTransactionOutput[]>;

/**
 * Adapt a Wallet Standard `solana:signTransaction` feature into a SignAllTransactionsByteLevel so the frontend
 * does not have to hand-write the bytes ↔ input/output conversion layer.
 *
 * @example
 * ```ts
 * const feature = wallet.features["solana:signTransaction"];
 * // Recommended: first check that the wallet declares v1 support: feature.supportedTransactionVersions.includes(1)
 * const signAll = walletStandardToByteLevelSigner({
 *   signTransaction: feature.signTransaction,
 *   account,                 // the currently connected WalletAccount
 *   chain: "solana:mainnet",
 * });
 * const [signed] = await signAllV1TransactionsWithWallet([tx], signAll);
 * ```
 */
export function walletStandardToByteLevelSigner(params: {
  signTransaction: WalletStandardSignTransaction;
  account: unknown;
  chain?: string;
}): SignAllTransactionsByteLevel {
  const { signTransaction, account, chain } = params;
  return async (transactionsBytes) => {
    const outputs = await signTransaction(...transactionsBytes.map((transaction) => ({ account, transaction, chain })));
    return outputs.map((o) => o.signedTransaction);
  };
}

/**
 * Sign several 2.x Transactions (v1 or any version) with a byte-level batch wallet signer.
 * Serialize → let the wallet's signAllTransactions sign the batch → deserialize back into Transaction[].
 *
 * @example wrap a Wallet Standard wallet's solana:signTransaction into a batch signer
 * ```ts
 * const feature = wallet.features["solana:signTransaction"];
 * // Recommended: first check that the wallet declares v1 support: feature.supportedTransactionVersions.includes(1)
 * const signAllTransactions: SignAllTransactionsByteLevel = async (txsBytes) => {
 *   const outputs = await feature.signTransaction(
 *     ...txsBytes.map((transaction) => ({ account, transaction, chain: "solana:mainnet" })),
 *   );
 *   return outputs.map((o) => o.signedTransaction);
 * };
 * const [signed] = await signAllV1TransactionsWithWallet([tx], signAllTransactions);
 * const wire = serializeV1Transaction(signed); // then send it to the RPC
 * ```
 */
export async function signAllV1TransactionsWithWallet(
  transactions: Transaction[],
  signAllTransactions: SignAllTransactionsByteLevel,
): Promise<Transaction[]> {
  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();
  // encode returns a ReadonlyUint8Array whose runtime value is a Uint8Array, so cast it straight to the wallet signer
  const unsignedBytes = transactions.map((tx) => encoder.encode(tx) as Uint8Array);
  const signedBytes = await signAllTransactions(unsignedBytes);
  return signedBytes.map((bytes) => decoder.decode(bytes));
}

/**
 * Single-transaction convenience wrapper: it still calls the batch signAllTransactions underneath
 * (what the wallet plugin hands in is a batch function).
 */
export async function signV1TransactionWithWallet(
  transaction: Transaction,
  signAllTransactions: SignAllTransactionsByteLevel,
): Promise<Transaction> {
  const [signed] = await signAllV1TransactionsWithWallet([transaction], signAllTransactions);
  return signed;
}
