import {
  Connection,
  ComputeBudgetProgram,
  PublicKey,
  sendAndConfirmTransaction,
  Signer,
  SimulatedTransactionResponse,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import axios from "axios";

import { InstructionType } from "./txType";
import { SignAllTransactions, ComputeBudgetConfig } from "../raydium/type";

import { createLogger } from "./logger";
import { Owner } from "./owner";

const logger = createLogger("Raydium_txTool");

interface SolanaFeeInfo {
  min: number;
  max: number;
  avg: number;
  priorityTx: number;
  nonVotes: number;
  priorityRatio: number;
  avgCuPerBlock: number;
  blockspaceUsageRatio: number;
}
type SolanaFeeInfoJson = {
  "1": SolanaFeeInfo;
  "5": SolanaFeeInfo;
  "15": SolanaFeeInfo;
};

interface TxBuilderInit {
  connection: Connection;
  feePayer: PublicKey;
  owner?: Owner;
  signAllTransactions?: SignAllTransactions;
}

export interface AddInstructionParam {
  instructions?: TransactionInstruction[];
  endInstructions?: TransactionInstruction[];
  signers?: Signer[];
  instructionTypes?: string[];
  endInstructionTypes?: string[];
}

export interface TxBuildData<T = Record<string, any>> {
  transaction: Transaction;
  instructionTypes: string[];
  signers: Signer[];
  execute: () => Promise<string>;
  extInfo: T;
}

export interface ExecuteParam {
  sequentially: boolean;
  onTxUpdate?: (completeTxs: { txId: string; status: "success" | "error" | "sent" }[]) => void;
}
export interface MultiTxBuildData {
  transactions: Transaction[];
  instructionTypes: string[];
  signers: Signer[][];
  execute: (executeParams?: ExecuteParam) => Promise<string[]>;
  extInfo: Record<string, any>;
}

export class TxBuilder {
  private connection: Connection;
  private owner?: Owner;
  private instructions: TransactionInstruction[] = [];
  private endInstructions: TransactionInstruction[] = [];
  private signers: Signer[] = [];
  private instructionTypes: string[] = [];
  private endInstructionTypes: string[] = [];
  private feePayer: PublicKey;
  private signAllTransactions?: SignAllTransactions;

  constructor(params: TxBuilderInit) {
    this.connection = params.connection;
    this.feePayer = params.feePayer;
    this.signAllTransactions = params.signAllTransactions;
    this.owner = params.owner;
  }

  get AllTxData(): {
    instructions: TransactionInstruction[];
    endInstructions: TransactionInstruction[];
    signers: Signer[];
    instructionTypes: string[];
    endInstructionTypes: string[];
  } {
    return {
      instructions: this.instructions,
      endInstructions: this.endInstructions,
      signers: this.signers,
      instructionTypes: this.instructionTypes,
      endInstructionTypes: this.endInstructionTypes,
    };
  }

  get allInstructions(): TransactionInstruction[] {
    return [...this.instructions, ...this.endInstructions];
  }

  public async getComputeBudgetConfig(): Promise<ComputeBudgetConfig | undefined> {
    const json = await axios.get<SolanaFeeInfoJson>(
      `https://solanacompass.com/api/fees?cacheFreshTime=${5 * 60 * 1000}`,
    );
    const { avg } = json?.[15] ?? {};
    if (!avg) return undefined;
    return {
      units: 400000,
      microLamports: Math.min(Math.ceil((avg * 1000000) / 400000), 25000),
    };
  }

  public async calComputeBudget(defaultIns?: TransactionInstruction[]): Promise<void> {
    try {
      const config = await this.getComputeBudgetConfig();
      if (config) {
        const { instructions, instructionTypes } = addComputeBudget(config);
        this.instructions.unshift(...instructions);
        this.instructionTypes.unshift(...instructionTypes);
        return;
      }
      defaultIns && this.instructions.unshift(...defaultIns);
    } catch {
      defaultIns && this.instructions.unshift(...defaultIns);
    }
  }

  public addInstruction({
    instructions = [],
    endInstructions = [],
    signers = [],
    instructionTypes = [],
    endInstructionTypes = [],
  }: AddInstructionParam): TxBuilder {
    this.instructions.push(...instructions);
    this.endInstructions.push(...endInstructions);
    this.signers.push(...signers);
    this.instructionTypes.push(...instructionTypes);
    this.endInstructionTypes.push(...endInstructionTypes);
    return this;
  }

  public build<T = Record<string, any>>(extInfo?: T): TxBuildData<T> {
    const transaction = new Transaction();
    if (this.allInstructions.length) transaction.add(...this.allInstructions);
    transaction.feePayer = this.feePayer;

    return {
      transaction,
      signers: this.signers,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (): Promise<string> => {
        const recentBlockHash = await getRecentBlockHash(this.connection);
        transaction.recentBlockhash = recentBlockHash;
        if (this.owner?.isKeyPair) {
          return sendAndConfirmTransaction(this.connection, transaction, this.signers);
        }
        if (this.signAllTransactions) {
          if (this.signers.length) transaction.partialSign(...this.signers);
          const txs = await this.signAllTransactions([transaction]);
          return await this.connection.sendRawTransaction(txs[0].serialize(), { skipPreflight: true });
        }
        throw new Error("please connect wallet first");
      },
      extInfo: extInfo || ({} as T),
    };
  }

  public buildMultiTx<T = Record<string, any>>(params: {
    extraPreBuildData?: TxBuildData[];
    extInfo?: T;
  }): MultiTxBuildData {
    const { extraPreBuildData = [], extInfo } = params;
    const { transaction } = this.build(extInfo);

    const filterExtraBuildData = extraPreBuildData.filter((data) => data.transaction.instructions.length > 0);

    const allTransactions: Transaction[] = [transaction, ...filterExtraBuildData.map((data) => data.transaction)];
    const allSigners: Signer[][] = [this.signers, ...filterExtraBuildData.map((data) => data.signers)];
    const allInstructionTypes: string[] = [
      ...this.instructionTypes,
      ...filterExtraBuildData.map((data) => data.instructionTypes).flat(),
    ];

    return {
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: allInstructionTypes,
      execute: async (executeParams?: ExecuteParam): Promise<string[]> => {
        const { sequentially, onTxUpdate } = executeParams || {};
        const recentBlockHash = await getRecentBlockHash(this.connection);
        if (this.owner?.isKeyPair) {
          return await Promise.all(
            allTransactions.map(async (tx, idx) => {
              tx.recentBlockhash = recentBlockHash;
              return await sendAndConfirmTransaction(this.connection, tx, allSigners[idx]);
            }),
          );
        }

        if (this.signAllTransactions) {
          const partialSignedTxs = allTransactions.map((tx, idx) => {
            tx.recentBlockhash = recentBlockHash;
            if (allSigners[idx].length) tx.partialSign(...allSigners[idx]);
            return tx;
          });
          const signedTxs = await this.signAllTransactions(partialSignedTxs);

          if (sequentially) {
            let i = 0;
            const processedTxs: { txId: string; status: "success" | "error" | "sent" }[] = [];
            const checkSendTx = async (): Promise<void> => {
              if (!signedTxs[i]) return;
              const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight: true });
              processedTxs.push({ txId, status: "sent" });
              onTxUpdate?.([...processedTxs]);
              i++;
              this.connection.onSignature(
                txId,
                (signatureResult) => {
                  const targetTxIdx = processedTxs.findIndex((tx) => tx.txId === txId);
                  if (targetTxIdx > -1) processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
                  onTxUpdate?.([...processedTxs]);
                  checkSendTx();
                },
                "processed",
              );
              this.connection.getSignatureStatus(txId);
            };
            checkSendTx();
            return [];
          } else {
            const txIds: string[] = [];
            for (let i = 0; i < signedTxs.length; i += 1) {
              const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight: true });
              txIds.push(txId);
            }
            return txIds;
          }
        }
        throw new Error("please connect wallet first");
      },
      extInfo: extInfo || {},
    };
  }

  public sizeCheckBuild(extInfo?: Record<string, any>): MultiTxBuildData {
    const signerKey: { [key: string]: Signer } = this.signers.reduce(
      (acc, cur) => ({ ...acc, [cur.publicKey.toBase58()]: cur }),
      {},
    );

    const allTransactions: Transaction[] = [];
    const allSigners: Signer[][] = [];

    let instructionQueue: TransactionInstruction[] = [];
    this.allInstructions.forEach((item) => {
      const _itemIns = [...instructionQueue, item];
      const _signerStrs = new Set<string>(
        _itemIns.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signer = [..._signerStrs.values()].map((i) => new PublicKey(i));
      if (forecastTransactionSize(_itemIns, [this.feePayer, ..._signer])) {
        instructionQueue.push(item);
      } else {
        allTransactions.push(new Transaction().add(...instructionQueue));
        allSigners.push([..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined));
        instructionQueue = [item];
      }
    });

    if (instructionQueue.length > 0) {
      const _signerStrs = new Set<string>(
        instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      allTransactions.push(new Transaction().add(...instructionQueue));
      allSigners.push([..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined));
    }
    allTransactions.forEach((tx) => (tx.feePayer = this.feePayer));

    return {
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: this.instructionTypes,
      execute: async (): Promise<string[]> => {
        const recentBlockHash = await getRecentBlockHash(this.connection);
        if (this.owner?.isKeyPair) {
          return await Promise.all(
            allTransactions.map(async (tx, idx) => {
              tx.recentBlockhash = recentBlockHash;
              return await sendAndConfirmTransaction(this.connection, tx, allSigners[idx]);
            }),
          );
        }
        if (this.signAllTransactions) {
          const partialSignedTxs = allTransactions.map((tx, idx) => {
            tx.recentBlockhash = recentBlockHash;
            if (allSigners[idx].length) tx.partialSign(...allSigners[idx]);
            return tx;
          });
          const signedTxs = await this.signAllTransactions(partialSignedTxs);

          const txIds: string[] = [];
          for (let i = 0; i < signedTxs.length; i += 1) {
            const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight: true });
            txIds.push(txId);
          }
          return txIds;
        }
        throw new Error("please connect wallet first");
      },
      extInfo: extInfo || {},
    };
  }
}

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
    insTypes.push(InstructionType.SetComputeUnitPrice);
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

export function splitTxAndSigners({
  instructions,
  signers,
  payer,
}: {
  instructions: TransactionInstruction[];
  signers: (Signer | Keypair)[];
  payer: PublicKey;
}): {
  transaction: Transaction;
  signer: (Keypair | Signer)[];
}[] {
  const signerKey: { [key: string]: Signer } = {};
  for (const item of signers) signerKey[item.publicKey.toString()] = item;

  const transactions: { transaction: Transaction; signer: (Keypair | Signer)[] }[] = [];

  let itemIns: TransactionInstruction[] = [];

  for (const item of instructions) {
    const _itemIns = [...itemIns, item];
    const _signerStrs = new Set<string>(
      _itemIns.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
    );
    const _signer = [..._signerStrs.values()].map((i) => new PublicKey(i));

    if (forecastTransactionSize(_itemIns, [payer, ..._signer])) {
      itemIns.push(item);
    } else {
      transactions.push({
        transaction: new Transaction().add(...itemIns),
        signer: [..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined),
      });

      itemIns = [item];
    }
  }

  if (itemIns.length > 0) {
    const _signerStrs = new Set<string>(
      itemIns.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
    );
    transactions.push({
      transaction: new Transaction().add(...itemIns),
      signer: [..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined),
    });
  }

  return transactions;
}
