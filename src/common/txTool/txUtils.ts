import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  EpochInfo,
  Keypair,
  PublicKey,
  SimulatedTransactionResponse,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { createLogger } from "../logger";
import { CacheLTA } from "./lookupTable";
import { InstructionType } from "./txType";

import { ComputeBudgetConfig } from "../../raydium/type";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const logger = createLogger("Raydium_txUtil");

export const MAX_BASE64_SIZE = 1644;

export function addComputeBudget(config: ComputeBudgetConfig): {
  instructions: TransactionInstruction[];
  instructionTypes: string[];
} {
  const ins: TransactionInstruction[] = [];
  const insTypes: string[] = [];
  if (config.microLamports) {
    ins.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: config.microLamports }));
    insTypes.push(InstructionType.SetComputeUnitPrice);
  }
  if (config.units) {
    ins.push(ComputeBudgetProgram.setComputeUnitLimit({ units: config.units }));
    insTypes.push(InstructionType.SetComputeUnitLimit);
  }

  return {
    instructions: ins,
    instructionTypes: insTypes,
  };
}

export async function getRecentBlockHash(connection: Connection, propsCommitment?: Commitment): Promise<string> {
  const commitment = propsCommitment ?? "confirmed";
  return (await connection.getLatestBlockhash?.({ commitment }))?.blockhash;
}

export async function confirmTransaction(connection: Connection, txId: string): Promise<string> {
  connection.getSignatureStatuses([txId]);
  return new Promise((resolve, reject) => {
    const id = setTimeout(reject, 60 * 1000);
    connection.onSignature(
      txId,
      (signatureResult) => {
        clearTimeout(id);
        if (!signatureResult.err) {
          resolve("");
          return;
        }
        reject(Object.assign(signatureResult.err, { txId }));
      },
      "confirmed",
    );
  });
}

/**
 * Forecast transaction size
 */
export function forecastTransactionSize(instructions: TransactionInstruction[], signers: PublicKey[]): boolean {
  if (instructions.length < 1) logger.logWithError(`no instructions provided: ${instructions.toString()}`);
  if (signers.length < 1) logger.logWithError(`no signers provided:, ${signers.toString()}`);

  const transaction = new Transaction();
  transaction.recentBlockhash = "11111111111111111111111111111111";
  transaction.feePayer = signers[0];
  transaction.add(...instructions);

  try {
    return Buffer.from(transaction.serialize({ verifySignatures: false })).toString("base64").length < MAX_BASE64_SIZE;
  } catch (error) {
    return false;
  }
}

/**
 * Simulates multiple instruction
 */
/**
 * Simulates multiple instruction
 */
export async function simulateMultipleInstruction(
  connection: Connection,
  instructions: TransactionInstruction[],
  keyword: string,
  batchRequest = true,
): Promise<string[]> {
  const feePayer = new PublicKey("RaydiumSimuLateTransaction11111111111111111");

  const transactions: Transaction[] = [];

  let transaction = new Transaction();
  transaction.feePayer = feePayer;

  for (const instruction of instructions) {
    if (!forecastTransactionSize([...transaction.instructions, instruction], [feePayer])) {
      transactions.push(transaction);
      transaction = new Transaction();
      transaction.feePayer = feePayer;
    }
    transaction.add(instruction);
  }
  if (transaction.instructions.length > 0) {
    transactions.push(transaction);
  }

  let results: SimulatedTransactionResponse[] = [];

  try {
    results = await simulateTransaction(connection, transactions, batchRequest);
    if (results.find((i) => i.err !== null)) throw Error("rpc simulateTransaction error");
  } catch (error) {
    if (error instanceof Error) {
      logger.logWithError("failed to simulate for instructions", "RPC_ERROR", {
        message: error.message,
      });
    }
  }

  const logs: string[] = [];
  for (const result of results) {
    logger.debug("simulate result:", result);

    if (result.logs) {
      const filteredLog = result.logs.filter((log) => log && log.includes(keyword));
      logger.debug("filteredLog:", logs);
      if (!filteredLog.length) logger.logWithError("simulate log not match keyword", "keyword", keyword);
      logs.push(...filteredLog);
    }
  }

  return logs;
}

export function parseSimulateLogToJson(log: string, keyword: string): any {
  const results = log.match(/{["\w:,]+}/g);
  if (!results || results.length !== 1) {
    return logger.logWithError(`simulate log fail to match json, keyword: ${keyword}`);
  }

  return results[0];
}

export function parseSimulateValue(log: string, key: string): any {
  const reg = new RegExp(`"${key}":(\\d+)`, "g");

  const results = reg.exec(log);
  if (!results || results.length !== 2) {
    return logger.logWithError(`simulate log fail to match key", key: ${key}`);
  }

  return results[1];
}

export interface ProgramAddress {
  publicKey: PublicKey;
  nonce: number;
}
export function findProgramAddress(
  seeds: Array<Buffer | Uint8Array>,
  programId: PublicKey,
): {
  publicKey: PublicKey;
  nonce: number;
} {
  const [publicKey, nonce] = PublicKey.findProgramAddressSync(seeds, programId);
  return { publicKey, nonce };
}

export async function simulateTransaction(
  connection: Connection,
  transactions: Transaction[],
  batchRequest?: boolean,
): Promise<any[]> {
  let results: any[] = [];
  if (batchRequest) {
    const getLatestBlockhash = await connection.getLatestBlockhash();

    const encodedTransactions: string[] = [];
    for (const transaction of transactions) {
      transaction.recentBlockhash = getLatestBlockhash.blockhash;
      transaction.lastValidBlockHeight = getLatestBlockhash.lastValidBlockHeight;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const message = transaction._compile();
      const signData = message.serialize();

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const wireTransaction = transaction._serialize(signData);
      const encodedTransaction = wireTransaction.toString("base64");

      encodedTransactions.push(encodedTransaction);
    }

    const batch = encodedTransactions.map((keys) => {
      const args = connection._buildArgs([keys], undefined, "base64");
      return {
        methodName: "simulateTransaction",
        args,
      };
    });

    const reqData: { methodName: string; args: any[] }[][] = [];
    const itemReqIndex = 20;
    for (let i = 0; i < Math.ceil(batch.length / itemReqIndex); i++) {
      reqData.push(batch.slice(i * itemReqIndex, (i + 1) * itemReqIndex));
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    results = await (
      await Promise.all(
        reqData.map(async (i) => (await (connection as any)._rpcBatchRequest(i)).map((ii) => ii.result.value)),
      )
    ).flat();
  } else {
    try {
      results = await Promise.all(
        transactions.map(async (transaction) => await (await connection.simulateTransaction(transaction)).value),
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.logWithError("failed to get info for multiple accounts", "RPC_ERROR", {
          message: error.message,
        });
      }
    }
  }

  return results;
}

export function checkLegacyTxSize({
  instructions,
  payer,
  signers,
}: {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  signers: PublicKey[];
}): boolean {
  return forecastTransactionSize(instructions, [payer, ...signers]);
}

export function checkV0TxSize({
  instructions,
  payer,
  lookupTableAddressAccount,
  recentBlockhash = Keypair.generate().publicKey.toString(),
}: {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  lookupTableAddressAccount?: CacheLTA;
  recentBlockhash?: string;
}): boolean {
  const transactionMessage = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions,
  });

  const messageV0 = transactionMessage.compileToV0Message(Object.values(lookupTableAddressAccount ?? {}));
  try {
    const buildLength = Buffer.from(new VersionedTransaction(messageV0).serialize()).toString("base64").length;
    return buildLength < MAX_BASE64_SIZE;
  } catch (error) {
    return false;
  }
}

let epochInfoCache: { time: number; data?: EpochInfo } = {
  time: 0,
  data: undefined,
};

export async function getEpochInfo(connection: Connection): Promise<EpochInfo> {
  if (!epochInfoCache.data || (Date.now() - epochInfoCache.time) / 1000 > 30) {
    const data = await connection.getEpochInfo();
    epochInfoCache = {
      time: Date.now(),
      data,
    };
    return data;
  } else {
    return epochInfoCache.data;
  }
}

export const toBuffer = (arr: Buffer | Uint8Array | Array<number>): Buffer => {
  if (Buffer.isBuffer(arr)) {
    return arr;
  } else if (arr instanceof Uint8Array) {
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  } else {
    return Buffer.from(arr);
  }
};

export const txToBase64 = (transaction: Transaction | VersionedTransaction): string => {
  let serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  if (transaction instanceof VersionedTransaction) serialized = toBuffer(serialized);
  try {
    return serialized instanceof Buffer ? serialized.toString("base64") : Buffer.from(serialized).toString("base64");
  } catch {
    return serialized.toString("base64");
  }
};

export function printSimulate(transactions: Transaction[] | VersionedTransaction[]): string[] {
  const allBase64: string[] = [];
  transactions.forEach((transaction) => {
    if (transaction instanceof Transaction) {
      if (!transaction.recentBlockhash) transaction.recentBlockhash = TOKEN_PROGRAM_ID.toBase58();
      if (!transaction.feePayer) transaction.feePayer = Keypair.generate().publicKey;
    }
    allBase64.push(txToBase64(transaction));
  });
  console.log("simulate tx string:", allBase64);

  return allBase64;
}

export function transformTxToBase64(tx: Transaction | VersionedTransaction): string {
  let serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  if (tx instanceof VersionedTransaction) serialized = toBuffer(serialized);
  return serialized.toString("base64");
}
