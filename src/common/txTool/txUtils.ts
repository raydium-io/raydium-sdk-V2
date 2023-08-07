import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  SimulatedTransactionResponse,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  Keypair,
} from "@solana/web3.js";

import { createLogger } from "../logger";
import { InstructionType } from "./txType";
import { CacheLTA } from "../lookupTable";

import { ComputeBudgetConfig } from "../../raydium/type";

const logger = createLogger("Raydium_txUtil");

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

export async function getRecentBlockHash(connection: Connection): Promise<string> {
  try {
    return (await connection.getLatestBlockhash?.())?.blockhash || (await connection.getRecentBlockhash()).blockhash;
  } catch {
    return (await connection.getRecentBlockhash()).blockhash;
  }
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
    transaction.serialize({ verifySignatures: false });
    return true;
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
}: {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  lookupTableAddressAccount?: CacheLTA;
}): boolean {
  const transactionMessage = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: Keypair.generate().publicKey.toString(),
    instructions,
  });

  const messageV0 = transactionMessage.compileToV0Message(Object.values(lookupTableAddressAccount ?? {}));
  try {
    messageV0.serialize();
    return true;
  } catch (error) {
    return false;
  }
}
