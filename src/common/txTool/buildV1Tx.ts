import {
  PublicKey,
  TransactionInstruction,
  Keypair,
  TransactionMessage as Web3TransactionMessage,
  VersionedTransaction,
  type Signer,
  type AddressLookupTableAccount,
} from "@solana/web3.js"; // 1.x 型別

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
  /** 區塊高度上限，超過後該 blockhash 失效。可傳 number 或 bigint */
  lastValidBlockHeight: number | bigint;
  /**
   * Compute unit 上限。v1 沒有隱含預設值——沒設會被 runtime 當成 0 → 交易直接失敗，
   * 故此為必填。v1 的 compute budget 不再走 ComputeBudget instruction，而是寫進 config mask。
   */
  computeUnitLimit: number;
  /** v1 的優先費（total lamports；注意 v1 已從 micro-lamports/CU 改為 total lamports 計價） */
  priorityFeeLamports?: number | bigint;
}

/**
 * 將 1.x 的 TransactionInstruction 轉為 2.x 的 Instruction 格式
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
 * 使用 2.x 子模組打包 V1 Transaction Message，並回傳 2.x 的 Transaction 物件
 * （內含 messageBytes 與待簽章的 signatures map，交由呼叫端以 2.x API 簽章 / 送出）
 */
export function buildV1Transaction({
  payer,
  recentBlockhash,
  instructions,
  lastValidBlockHeight,
  computeUnitLimit,
  priorityFeeLamports,
}: BuildV1TxParams): Transaction {
  // v1 無隱含預設值：compute unit limit 為 0 會讓交易在 runtime 失敗，這裡先擋下
  if (!Number.isInteger(computeUnitLimit) || computeUnitLimit <= 0) {
    throw new Error(
      `buildV1Transaction: computeUnitLimit 必須為正整數（v1 無隱含預設值，0 會使交易失敗），收到 ${computeUnitLimit}`,
    );
  }

  const payerAddress: Address = address(payer.toBase58());

  // 1~2. 以 const 串接 builder（每個 builder 都回傳更精確的型別，不能重新賦值給同一個變數）
  const lifetimeMessage = setTransactionMessageLifetimeUsingBlockhash(
    {
      blockhash: blockhash(recentBlockhash), // 設定 Blockhash
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
    },
    setTransactionMessageFeePayer(
      payerAddress, // 設定 Payer
      createTransactionMessage({ version: 1 }), // 初始化 V1 Message
    ),
  );

  // 2.5 v1 的 compute budget 寫進 config mask（非 ComputeBudget instruction）；優先費為 total lamports
  const baseMessage = setTransactionMessagePriorityFeeLamports(
    priorityFeeLamports === undefined ? undefined : BigInt(priorityFeeLamports),
    setTransactionMessageComputeUnitLimit(computeUnitLimit, lifetimeMessage),
  );

  // 3. 逐一塞入轉譯後的 Raydium Instructions（用單數版 append，避免 8.x 複數版簽章的 const 型別參數在 TS 4.x 無法解析）
  //    accumulator 以三個介面聯集標註，讓 baseMessage 與每次 append 的結果都能相容賦值
  let message: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithBlockhashLifetime =
    baseMessage;
  for (const ix of instructions) {
    message = appendTransactionMessageInstruction(convertV1InstructionToV2(ix), message);
  }

  // 4. 編譯為 2.x Transaction 物件（保留 v1，全程走 2.x 生態，不再經過 1.x VersionedTransaction）
  return compileTransaction(message);
}

/**
 * 將 1.x 的 Keypair 轉為 2.x 簽章所需的 CryptoKeyPair
 * （Keypair.secretKey 為 64-byte，剛好對應 createKeyPairFromBytes 的輸入）
 */
export function toCryptoKeyPair(keypair: Keypair): Promise<CryptoKeyPair> {
  return createKeyPairFromBytes(keypair.secretKey);
}

/**
 * 將多個 1.x Signer / Keypair（含 64-byte secretKey）批次轉為 2.x 的 CryptoKeyPair
 */
export function signersToCryptoKeyPairs(signers: (Signer | Keypair)[]): Promise<CryptoKeyPair[]> {
  return Promise.all(signers.map((s) => createKeyPairFromBytes(s.secretKey)));
}

/**
 * 用 CryptoKeyPair 對 v1 Transaction 做「部分簽章」（不要求所有 signer 都到齊）。
 * 常見用途：先讓臨時 signer（例如新建帳戶的 keypair）簽好，再交給錢包簽 fee payer。
 */
export async function partialSignV1Transaction(
  transaction: Transaction,
  signers: CryptoKeyPair[],
): Promise<Transaction> {
  return partiallySignTransaction(signers, transaction);
}

/**
 * 用 2.x API 對 buildV1Transaction 產出的 Transaction 進行簽章
 * @param transaction buildV1Transaction 的回傳值
 * @param signers 簽章者（1.x Keypair 請先用 toCryptoKeyPair 轉換）
 * @returns 已完整簽章的 Transaction
 */
export async function signV1Transaction(
  transaction: Transaction,
  signers: CryptoKeyPair[],
): Promise<FullySignedTransaction & Transaction> {
  return signTransaction(signers, transaction);
}

/**
 * 將（已簽章的）Transaction 序列化成 base64 wire format，可直接丟給 RPC 的 sendTransaction
 *
 * @example 使用 @solana/kit 送出（需另外安裝 @solana/kit 或 @solana/rpc）
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
// 錢包（browser plugin）路徑
//
// ⚠️ Browser wallet（Phantom / Backpack…）不會暴露私鑰，只提供 signTransaction /
//    signAllTransactions，且吃的是 web3.js 1.x 的 VersionedTransaction。加上 1.x 與
//    主流錢包目前都不支援 v1 格式，因此錢包路徑一律使用 v0，完全走 1.x 原生 API。
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildV0WalletTxParams {
  payer: PublicKey;
  recentBlockhash: string;
  instructions: TransactionInstruction[];
  /** v0 專屬：可選的 Address Lookup Table，用來壓縮帳戶數量 */
  addressLookupTableAccounts?: AddressLookupTableAccount[];
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 + 錢包（byte-level）簽章路徑
//
// v1 交易的錢包簽章走 Wallet Standard 的 `solana:signTransaction`（吃序列化 bytes），
// 而非舊 wallet-adapter 的 signAllTransactions(VersionedTransaction[])。此處刻意不綁定
// 任何錢包套件——呼叫端把「bytes 進、簽好 bytes 出」的函式傳進來即可。
//
// ⚠️ v1 主網啟用日為 2026-09-09；錢包需內部升級至 web3.js 3.x / kit 8.x 並在其
//    `solana:signTransaction` 的 supportedTransactionVersions 宣告支援 1，才能簽 v1。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * byte-level 的**批次**錢包簽章函式：吃多筆未簽章交易 bytes、回傳對應的已簽章 bytes。
 * 對齊錢包 plugin 的 signAllTransactions 批次語意，但走序列化 bytes 以相容 v1
 * （舊的 SignAllTransactions 綁定 1.x Transaction/VersionedTransaction 物件，無法表示 v1）。
 */
export type SignAllTransactionsByteLevel = (transactionsBytes: Uint8Array[]) => Promise<Uint8Array[]>;

// ── Wallet Standard 轉接（避免硬相依 @wallet-standard/* 套件，以最小結構型別描述）──────────

/** Wallet Standard `solana:signTransaction` 單筆輸入的最小結構 */
export interface WalletStandardSignTransactionInput {
  account: unknown; // Wallet Standard 的 WalletAccount，原樣傳回錢包
  transaction: Uint8Array;
  chain?: string; // e.g. "solana:mainnet"
  options?: Record<string, unknown>;
}
/** Wallet Standard `solana:signTransaction` 單筆輸出的最小結構 */
export interface WalletStandardSignTransactionOutput {
  signedTransaction: Uint8Array;
}
/** Wallet Standard `solana:signTransaction` feature 的 signTransaction 方法（variadic 批次） */
export type WalletStandardSignTransaction = (
  ...inputs: WalletStandardSignTransactionInput[]
) => Promise<WalletStandardSignTransactionOutput[]>;

/**
 * 把 Wallet Standard 的 `solana:signTransaction` feature 轉接成 SignAllTransactionsByteLevel，
 * 讓前端不用自己手寫那層 bytes ↔ input/output 的轉換。
 *
 * @example
 * ```ts
 * const feature = wallet.features["solana:signTransaction"];
 * // 建議先確認錢包宣告支援 v1： feature.supportedTransactionVersions.includes(1)
 * const signAll = walletStandardToByteLevelSigner({
 *   signTransaction: feature.signTransaction,
 *   account,                 // 目前連線的 WalletAccount
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
 * 用 byte-level 的批次錢包簽章對多筆（v1 或任何版本的）2.x Transaction 簽章。
 * 序列化 → 交給錢包的 signAllTransactions 批次簽 → 反序列化回 Transaction[]。
 *
 * @example 把 Wallet Standard 錢包的 solana:signTransaction 包成批次 signer
 * ```ts
 * const feature = wallet.features["solana:signTransaction"];
 * // 建議先確認錢包宣告支援 v1： feature.supportedTransactionVersions.includes(1)
 * const signAllTransactions: SignAllTransactionsByteLevel = async (txsBytes) => {
 *   const outputs = await feature.signTransaction(
 *     ...txsBytes.map((transaction) => ({ account, transaction, chain: "solana:mainnet" })),
 *   );
 *   return outputs.map((o) => o.signedTransaction);
 * };
 * const [signed] = await signAllV1TransactionsWithWallet([tx], signAllTransactions);
 * const wire = serializeV1Transaction(signed); // 再送 RPC
 * ```
 */
export async function signAllV1TransactionsWithWallet(
  transactions: Transaction[],
  signAllTransactions: SignAllTransactionsByteLevel,
): Promise<Transaction[]> {
  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();
  // encode 回傳 ReadonlyUint8Array，執行期本體即為 Uint8Array，直接 cast 交給錢包簽章函式
  const unsignedBytes = transactions.map((tx) => encoder.encode(tx) as Uint8Array);
  const signedBytes = await signAllTransactions(unsignedBytes);
  return signedBytes.map((bytes) => decoder.decode(bytes));
}

/**
 * 單筆版便利函式：底層仍呼叫批次的 signAllTransactions（錢包 plugin 傳進來的就是批次函式）。
 */
export async function signV1TransactionWithWallet(
  transaction: Transaction,
  signAllTransactions: SignAllTransactionsByteLevel,
): Promise<Transaction> {
  const [signed] = await signAllV1TransactionsWithWallet([transaction], signAllTransactions);
  return signed;
}
