import {
  Commitment,
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  SignatureResult,
  Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import axios from "axios";

import { Api } from "../../api";
import { ComputeBudgetConfig, SignAllTransactions, TxTipConfig } from "../../raydium/type";
import { Cluster } from "../../solana";
import { Owner } from "../owner";
import { CacheLTA, getDevLookupTableCache, getMainLookupTableCache, getMultipleLookupTableInfo } from "./lookupTable";
import {
  buildV1Transaction,
  calcLoadedAccountsDataSize,
  signV1Transaction,
  serializeV1Transaction,
  signAllV1TransactionsWithWallet,
  signersToCryptoKeyPairs,
  partialSignV1Transaction,
  type SignAllV1Transactions,
} from "./buildV1Tx";
import { isTransactionWithinSizeLimit, type Transaction as TransactionV1 } from "@solana/transactions";
import { InstructionType, TxVersion } from "./txType";
import {
  addComputeBudget,
  checkLegacyTxSize,
  checkV0TxSize,
  checkV1TxSize,
  confirmTransaction,
  getRecentBlockHash,
  printSimulate,
} from "./txUtils";

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

interface ExecuteParams {
  skipPreflight?: boolean;
  recentBlockHash?: string;
  sendAndConfirm?: boolean;
  notSendToRpc?: boolean;
}

interface TxBuilderInit {
  connection: Connection;
  feePayer: PublicKey;
  cluster: Cluster;
  owner?: Owner;
  blockhashCommitment?: Commitment;
  loopMultiTxStatus?: boolean;
  api?: Api;
  signAllTransactions?: SignAllTransactions;
  /**
   * Byte-level batch wallet signer dedicated to v1 (2.x) transactions. The existing signAllTransactions is bound
   * to 1.x Transaction/VersionedTransaction objects and cannot sign v1, so the buildV1 wallet path uses this one.
   */
  signAllV1Transactions?: SignAllV1Transactions;
}

export interface AddInstructionParam {
  addresses?: Record<string, PublicKey>;
  instructions?: TransactionInstruction[];
  endInstructions?: TransactionInstruction[];
  lookupTableAddress?: string[];
  signers?: Signer[];
  instructionTypes?: string[];
  endInstructionTypes?: string[];
}

export interface TxBuildData<T = Record<string, any>> {
  builder: TxBuilder;
  transaction: Transaction;
  instructionTypes: string[];
  signers: Signer[];
  execute: (params?: ExecuteParams) => Promise<{ txId: string; signedTx: Transaction }>;
  extInfo: T;
}

export interface TxV0BuildData<T = Record<string, any>> extends Omit<TxBuildData<T>, "transaction" | "execute"> {
  builder: TxBuilder;
  transaction: VersionedTransaction;
  buildProps?: {
    lookupTableCache?: CacheLTA;
    lookupTableAddress?: string[];
  };
  execute: (params?: ExecuteParams) => Promise<{ txId: string; signedTx: VersionedTransaction }>;
}

export interface TxV1BuildData<T = Record<string, any>> {
  builder: TxBuilder;
  /** A 2.x (kit) Transaction, carrying messageBytes and the signatures map */
  transaction: TransactionV1;
  instructionTypes: string[];
  signers: Signer[];
  execute: (params?: ExecuteParams) => Promise<{ txId: string; signedTx: TransactionV1 }>;
  extInfo: T;
}

type TxUpdateParams = {
  txId: string;
  status: "success" | "error" | "sent";
  signedTx: Transaction | VersionedTransaction | TransactionV1;
};
export interface MultiTxExecuteParam extends ExecuteParams {
  sequentially: boolean;
  skipTxCount?: number;
  onTxUpdate?: (completeTxs: TxUpdateParams[]) => void;
}
export interface MultiTxBuildData<T = Record<string, any>> {
  builder: TxBuilder;
  transactions: Transaction[];
  instructionTypes: string[];
  signers: Signer[][];
  execute: (executeParams?: MultiTxExecuteParam) => Promise<{ txIds: string[]; signedTxs: Transaction[] }>;
  extInfo: T;
}

export interface MultiTxV0BuildData<T = Record<string, any>>
  extends Omit<MultiTxBuildData<T>, "transactions" | "execute"> {
  builder: TxBuilder;
  transactions: VersionedTransaction[];
  buildProps?: {
    lookupTableCache?: CacheLTA;
    lookupTableAddress?: string[];
  };
  execute: (executeParams?: MultiTxExecuteParam) => Promise<{ txIds: string[]; signedTxs: VersionedTransaction[] }>;
}

export interface MultiTxV1BuildData<T = Record<string, any>>
  extends Omit<MultiTxBuildData<T>, "transactions" | "execute"> {
  builder: TxBuilder;
  /** An array of 2.x (kit) Transactions */
  transactions: TransactionV1[];
  execute: (executeParams?: MultiTxExecuteParam) => Promise<{ txIds: string[]; signedTxs: TransactionV1[] }>;
}

export type MakeMultiTxData<T = TxVersion.LEGACY, O = Record<string, any>> = T extends TxVersion.LEGACY
  ? MultiTxBuildData<O>
  : T extends TxVersion.V1
  ? MultiTxV1BuildData<O>
  : MultiTxV0BuildData<O>;

export type MakeTxData<T = TxVersion.LEGACY, O = Record<string, any>> = T extends TxVersion.LEGACY
  ? TxBuildData<O>
  : T extends TxVersion.V1
  ? TxV1BuildData<O>
  : TxV0BuildData<O>;

const LOOP_INTERVAL = 2000;

/**
 * Default loadedAccountsDataSize limit (bytes) for a v1 transaction that does not specify one.
 * The new runtime applies a fairly low default to transactions that do not declare it, and complex transactions
 * (e.g. CLMM, whose programdata alone is ~2MB) hit MaxLoadedAccountsDataSizeExceeded. This value is only a limit
 * declaration and does not affect fees, so 8MB covers common transactions with headroom to spare.
 * Override it via computeBudgetConfig.loadedAccountsDataSize when more is needed (max 64MiB).
 */
const DEFAULT_LOADED_ACCOUNTS_DATA_SIZE = 8 * 1024 * 1024;

/**
 * Compute units budgeted per instruction when sizeCheckBuildV1 derives its default insCountLimit.
 *
 * v1 keeps the 1.4M compute unit ceiling per transaction, so compute - not the 4096 byte size limit - is what
 * actually caps how much can be packed into one transaction. The divisor is back-calculated from the legacy pair
 * (insCountLimit 12, units 600000) rather than measured, so the derived default reproduces the v0 behaviour at the
 * default budget and scales up with it instead of staying hardcoded.
 */
const V1_DEFAULT_CU_PER_INSTRUCTION = 50_000;

export class TxBuilder {
  private connection: Connection;
  private owner?: Owner;
  private instructions: TransactionInstruction[] = [];
  private endInstructions: TransactionInstruction[] = [];
  private lookupTableAddress: string[] = [];
  private signers: Signer[] = [];
  private instructionTypes: string[] = [];
  private endInstructionTypes: string[] = [];
  private feePayer: PublicKey;
  private cluster: Cluster;
  private signAllTransactions?: SignAllTransactions;
  private signAllV1Transactions?: SignAllV1Transactions;
  private blockhashCommitment?: Commitment;
  private loopMultiTxStatus: boolean;
  /** The config last passed to addCustomComputeBudget; read back by buildV1 (in v1 the compute budget goes through the config mask, not an instruction) */
  private computeBudgetConfig?: ComputeBudgetConfig;

  constructor(params: TxBuilderInit) {
    this.connection = params.connection;
    this.feePayer = params.feePayer;
    this.signAllTransactions = params.signAllTransactions;
    this.signAllV1Transactions = params.signAllV1Transactions;
    this.owner = params.owner;
    this.cluster = params.cluster;
    this.blockhashCommitment = params.blockhashCommitment;
    this.loopMultiTxStatus = !!params.loopMultiTxStatus;
  }

  get AllTxData(): {
    instructions: TransactionInstruction[];
    endInstructions: TransactionInstruction[];
    signers: Signer[];
    instructionTypes: string[];
    endInstructionTypes: string[];
    lookupTableAddress: string[];
  } {
    const computeIns = this.getComputeBudgetIns();
    return {
      instructions: [...computeIns.instructions, ...this.instructions],
      endInstructions: this.endInstructions,
      signers: this.signers,
      instructionTypes: [...computeIns.instructionTypes, ...this.instructionTypes],
      endInstructionTypes: this.endInstructionTypes,
      lookupTableAddress: this.lookupTableAddress,
    };
  }

  get allInstructions(): TransactionInstruction[] {
    return [...this.getComputeBudgetIns().instructions, ...this.instructions, ...this.endInstructions];
  }

  public async getComputeBudgetConfig(): Promise<ComputeBudgetConfig | undefined> {
    const json = (
      await axios.get<SolanaFeeInfoJson>(`https://solanacompass.com/api/fees?cacheFreshTime=${5 * 60 * 1000}`)
    ).data;
    const { avg } = json?.[15] ?? {};
    if (!avg) return undefined;
    return {
      units: 600000,
      microLamports: Math.min(Math.ceil((avg * 1000000) / 600000), 25000),
    };
  }

  public setCustomComputeBudget(config?: ComputeBudgetConfig): boolean {
    if (config) {
      // Kept around for buildV1: a v1 transaction's compute budget (including loadedAccountsDataSize) goes through the config mask, not instructions
      this.computeBudgetConfig = config;
      return true;
    }
    return false;
  }

  public getComputeBudgetIns() {
    if (!this.computeBudgetConfig)
      return {
        instructions: [],
        instructionTypes: [],
      };
    const { instructions, instructionTypes } = addComputeBudget(this.computeBudgetConfig);
    return {
      instructions,
      instructionTypes,
    };
  }

  public addTipInstruction(tipConfig?: TxTipConfig): boolean {
    if (tipConfig) {
      this.endInstructions.push(
        SystemProgram.transfer({
          fromPubkey: tipConfig.feePayer ?? this.feePayer,
          toPubkey: new PublicKey(tipConfig.address),
          lamports: BigInt(tipConfig.amount.toString()),
        }),
      );
      this.endInstructionTypes.push(InstructionType.TransferTip);
      return true;
    }
    return false;
  }

  public addInstruction({
    instructions = [],
    endInstructions = [],
    signers = [],
    instructionTypes = [],
    endInstructionTypes = [],
    lookupTableAddress = [],
  }: AddInstructionParam): TxBuilder {
    this.instructions.push(...instructions);
    this.endInstructions.push(...endInstructions);
    this.signers.push(...signers);
    this.instructionTypes.push(...instructionTypes);
    this.endInstructionTypes.push(...endInstructionTypes);
    this.lookupTableAddress.push(...lookupTableAddress.filter((address) => address !== PublicKey.default.toString()));
    return this;
  }

  public async versionBuild<O = Record<string, any>>({
    txVersion,
    extInfo,
    lookupTableAddress,
  }: {
    txVersion?: TxVersion;
    extInfo?: O;
    lookupTableAddress?: string[];
  }): Promise<MakeTxData<TxVersion.LEGACY, O> | MakeTxData<TxVersion.V0, O> | MakeTxData<TxVersion.V1, O>> {
    if (txVersion === TxVersion.V0)
      return (await this.buildV0({ ...(extInfo || {}), lookupTableAddress })) as unknown as MakeTxData<TxVersion.V0, O>;
    if (txVersion === TxVersion.V1)
      // v1 has no ALT, so it does not take lookupTableAddress
      return (await this.buildV1({ ...(extInfo || {}) })) as unknown as MakeTxData<TxVersion.V1, O>;
    return this.build<O>(extInfo) as MakeTxData<TxVersion.LEGACY, O>;
  }

  public build<O = Record<string, any>>(extInfo?: O): MakeTxData<TxVersion.LEGACY, O> {
    const transaction = new Transaction();
    const computeBudgetIns = this.getComputeBudgetIns();
    if (this.allInstructions.length) transaction.add(...computeBudgetIns.instructions, ...this.allInstructions);
    transaction.feePayer = this.feePayer;
    if (this.owner?.signer && !this.signers.some((s) => s.publicKey.equals(this.owner!.publicKey)))
      this.signers.push(this.owner.signer);

    return {
      builder: this,
      transaction,
      signers: this.signers,
      instructionTypes: [...computeBudgetIns.instructionTypes, ...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (params) => {
        const { recentBlockHash: propBlockHash, skipPreflight = true, sendAndConfirm, notSendToRpc } = params || {};
        const recentBlockHash = propBlockHash ?? (await getRecentBlockHash(this.connection, this.blockhashCommitment));
        transaction.recentBlockhash = recentBlockHash;
        if (this.signers.length) transaction.sign(...this.signers);

        printSimulate([transaction]);
        if (this.owner?.isKeyPair) {
          const txId = sendAndConfirm
            ? await sendAndConfirmTransaction(
                this.connection,
                transaction,
                this.signers.find((s) => s.publicKey.equals(this.owner!.publicKey))
                  ? this.signers
                  : [...this.signers, this.owner.signer!],
                { skipPreflight },
              )
            : await this.connection.sendRawTransaction(transaction.serialize(), { skipPreflight });

          return {
            txId,
            signedTx: transaction,
          };
        }
        if (this.signAllTransactions) {
          const txs = await this.signAllTransactions([transaction]);
          if (this.signers.length) {
            for (const item of txs) {
              try {
                item.sign(...this.signers);
              } catch (e) {
                //
              }
            }
          }
          return {
            txId: notSendToRpc ? "" : await this.connection.sendRawTransaction(txs[0].serialize(), { skipPreflight }),
            signedTx: txs[0],
          };
        }
        throw new Error("please provide owner in keypair format or signAllTransactions function");
      },
      extInfo: extInfo || ({} as O),
    };
  }

  public buildMultiTx<T = Record<string, any>>(params: {
    extraPreBuildData?: MakeTxData<TxVersion.LEGACY>[];
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

    if (this.owner?.signer) {
      allSigners.forEach((signers) => {
        if (!signers.some((s) => s.publicKey.equals(this.owner!.publicKey))) this.signers.push(this.owner!.signer!);
      });
    }

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: allInstructionTypes,
      execute: async (executeParams?: MultiTxExecuteParam) => {
        const {
          sequentially,
          onTxUpdate,
          skipTxCount = 0,
          recentBlockHash: propBlockHash,
          skipPreflight = true,
        } = executeParams || {};
        const recentBlockHash = propBlockHash ?? (await getRecentBlockHash(this.connection, this.blockhashCommitment));
        if (this.owner?.isKeyPair) {
          if (sequentially) {
            const txIds: string[] = [];
            let i = 0;
            for (const tx of allTransactions) {
              ++i;
              if (i <= skipTxCount) continue;
              const txId = await sendAndConfirmTransaction(
                this.connection,
                tx,
                this.signers.find((s) => s.publicKey.equals(this.owner!.publicKey))
                  ? this.signers
                  : [...this.signers, this.owner.signer!],
                { skipPreflight },
              );
              txIds.push(txId);
            }

            return {
              txIds,
              signedTxs: allTransactions,
            };
          }
          return {
            txIds: await await Promise.all(
              allTransactions.map(async (tx) => {
                tx.recentBlockhash = recentBlockHash;
                return await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight });
              }),
            ),
            signedTxs: allTransactions,
          };
        }

        if (this.signAllTransactions) {
          const partialSignedTxs = allTransactions.map((tx, idx) => {
            tx.recentBlockhash = recentBlockHash;
            if (allSigners[idx].length) tx.sign(...allSigners[idx]);
            return tx;
          });
          printSimulate(partialSignedTxs);
          const signedTxs = await this.signAllTransactions(partialSignedTxs);
          if (sequentially) {
            let i = 0;
            const processedTxs: TxUpdateParams[] = [];
            const checkSendTx = async (): Promise<void> => {
              if (!signedTxs[i]) return;
              const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight });
              processedTxs.push({ txId, status: "sent", signedTx: signedTxs[i] });
              onTxUpdate?.([...processedTxs]);
              i++;
              let confirmed = false;
              // eslint-disable-next-line
              let intervalId: NodeJS.Timer | null = null,
                subSignatureId: number | null = null;
              const cbk = (signatureResult: SignatureResult): void => {
                intervalId !== null && clearInterval(intervalId);
                subSignatureId !== null && this.connection.removeSignatureListener(subSignatureId);
                const targetTxIdx = processedTxs.findIndex((tx) => tx.txId === txId);
                if (targetTxIdx > -1) {
                  if (processedTxs[targetTxIdx].status === "error" || processedTxs[targetTxIdx].status === "success")
                    return;
                  processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
                }
                onTxUpdate?.([...processedTxs]);
                if (!signatureResult.err) checkSendTx();
              };

              if (this.loopMultiTxStatus)
                intervalId = setInterval(async () => {
                  if (confirmed) {
                    clearInterval(intervalId!);
                    return;
                  }
                  try {
                    const r = await this.connection.getTransaction(txId, {
                      commitment: "confirmed",
                      maxSupportedTransactionVersion: 1,
                    });
                    if (r) {
                      confirmed = true;
                      clearInterval(intervalId!);
                      cbk({ err: r.meta?.err || null });
                      console.log("tx status from getTransaction:", txId);
                    }
                  } catch (e) {
                    confirmed = true;
                    clearInterval(intervalId!);
                    console.error("getTransaction timeout:", e, txId);
                  }
                }, LOOP_INTERVAL);

              subSignatureId = this.connection.onSignature(
                txId,
                (result) => {
                  if (confirmed) {
                    this.connection.removeSignatureListener(subSignatureId!);
                    return;
                  }
                  confirmed = true;
                  cbk(result);
                },
                "confirmed",
              );
              this.connection.getSignatureStatus(txId);
            };
            await checkSendTx();
            return {
              txIds: processedTxs.map((d) => d.txId),
              signedTxs,
            };
          } else {
            const txIds: string[] = [];
            for (let i = 0; i < signedTxs.length; i += 1) {
              const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight });
              txIds.push(txId);
            }
            return {
              txIds,
              signedTxs,
            };
          }
        }
        throw new Error("please provide owner in keypair format or signAllTransactions function");
      },
      extInfo: extInfo || {},
    };
  }

  public async versionMultiBuild<T extends TxVersion, O = Record<string, any>>({
    extraPreBuildData,
    txVersion,
    extInfo,
  }: {
    extraPreBuildData?: MakeTxData<TxVersion.V0>[] | MakeTxData<TxVersion.LEGACY>[] | MakeTxData<TxVersion.V1>[];
    txVersion?: T;
    extInfo?: O;
  }): Promise<MakeMultiTxData<T, O>> {
    if (txVersion === TxVersion.V0)
      return (await this.buildV0MultiTx({
        extraPreBuildData: extraPreBuildData as MakeTxData<TxVersion.V0>[],
        buildProps: extInfo || {},
      })) as MakeMultiTxData<T, O>;
    if (txVersion === TxVersion.V1)
      return (await this.buildV1MultiTx({
        extraPreBuildData: extraPreBuildData as MakeTxData<TxVersion.V1>[],
        buildProps: extInfo || {},
      })) as MakeMultiTxData<T, O>;
    return this.buildMultiTx<O>({
      extraPreBuildData: extraPreBuildData as MakeTxData<TxVersion.LEGACY>[],
      extInfo,
    }) as MakeMultiTxData<T, O>;
  }

  public async buildV0<O = Record<string, any>>(
    props?: O & {
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
      forerunCreate?: boolean;
      recentBlockhash?: string;
    },
  ): Promise<MakeTxData<TxVersion.V0, O>> {
    const {
      lookupTableCache = {},
      lookupTableAddress = [],
      forerunCreate,
      recentBlockhash: propRecentBlockhash,
      ...extInfo
    } = props || {};

    const lookupTableAddressAccount = {
      ...(this.cluster === "devnet"
        ? await getDevLookupTableCache(this.connection)
        : await getMainLookupTableCache(this.connection)),
      ...lookupTableCache,
    };
    const allLTA = Array.from(new Set<string>([...lookupTableAddress, ...this.lookupTableAddress]));
    const needCacheLTA: PublicKey[] = [];
    for (const item of allLTA) {
      if (lookupTableAddressAccount[item] === undefined) needCacheLTA.push(new PublicKey(item));
    }
    const newCacheLTA = await getMultipleLookupTableInfo({ connection: this.connection, address: needCacheLTA });
    for (const [key, value] of Object.entries(newCacheLTA)) lookupTableAddressAccount[key] = value;

    const recentBlockhash = forerunCreate
      ? PublicKey.default.toBase58()
      : propRecentBlockhash ?? (await getRecentBlockHash(this.connection, this.blockhashCommitment));
    const messageV0 = new TransactionMessage({
      payerKey: this.feePayer,
      recentBlockhash,
      instructions: [...this.allInstructions],
    }).compileToV0Message(Object.values(lookupTableAddressAccount));
    if (this.owner?.signer && !this.signers.some((s) => s.publicKey.equals(this.owner!.publicKey)))
      this.signers.push(this.owner.signer);
    const transaction = new VersionedTransaction(messageV0);

    transaction.sign(this.signers);

    return {
      builder: this,
      transaction,
      signers: this.signers,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (params) => {
        const { skipPreflight = true, sendAndConfirm, notSendToRpc } = params || {};
        printSimulate([transaction]);
        if (this.owner?.isKeyPair) {
          const txId = await this.connection.sendTransaction(transaction, { skipPreflight });
          if (sendAndConfirm) {
            await confirmTransaction(this.connection, txId);
          }

          return {
            txId,
            signedTx: transaction,
          };
        }
        if (this.signAllTransactions) {
          const txs = await this.signAllTransactions<VersionedTransaction>([transaction]);
          if (this.signers.length) {
            for (const item of txs) {
              try {
                item.sign(this.signers);
              } catch (e) {
                //
              }
            }
          }
          return {
            txId: notSendToRpc ? "" : await this.connection.sendTransaction(txs[0], { skipPreflight }),
            signedTx: txs[0],
          };
        }
        throw new Error("please provide owner in keypair format or signAllTransactions function");
      },
      extInfo: (extInfo || {}) as O,
    };
  }

  /**
   * Build a single v1 (2.x / kit) transaction on top of buildV1Tx.
   *
   * - Keypair path: when owner.isKeyPair, convert every signer into a CryptoKeyPair and sign with the 2.x API.
   * - Wallet path: requires signAllV1Transactions (byte-level) to be provided when constructing the TxBuilder;
   *   the ephemeral signers partially sign first, then the wallet signs as fee payer.
   *
   * ⚠️ Before the v1 mainnet activation date of 2026-09-09, RPCs do not accept v1 transactions yet; also v1 has no
   *    ALT and its compute budget goes through the config mask (not an instruction), which is handled here via the
   *    computeUnitLimit parameter.
   */
  public async buildV1<O = Record<string, any>>(
    props?: O & {
      recentBlockhash?: string;
      lastValidBlockHeight?: number;
      /** Compute unit limit; falls back to computeBudgetConfig / getComputeBudgetConfig().units (default 600000) when omitted */
      computeUnitLimit?: number;
      /** v1 priority fee (total lamports); derived from computeBudgetConfig.microLamports × units when omitted */
      priorityFeeLamports?: number | bigint;
      /**
       * v0-style compute budget config; it is converted automatically into v1's computeUnitLimit / priorityFeeLamports.
       * Precedence: explicitly passed computeUnitLimit / priorityFeeLamports > computeBudgetConfig > getComputeBudgetConfig()
       */
      computeBudgetConfig?: ComputeBudgetConfig;
      /**
       * Whether to measure loadedAccountsDataSize from the transaction's actual accounts (costs an extra 1~2
       * getMultipleAccountsInfo calls). When disabled, the fixed 8MB default is used. An explicitly specified
       * loadedAccountsDataSize still takes precedence over the measured value.
       */
      autoLoadedAccountsDataSize?: boolean;
    },
  ): Promise<TxV1BuildData<O>> {
    const {
      recentBlockhash: propRecentBlockhash,
      lastValidBlockHeight: propLastValidBlockHeight,
      computeUnitLimit: propComputeUnitLimit,
      priorityFeeLamports: propPriorityFeeLamports,
      computeBudgetConfig: propComputeBudgetConfig,
      autoLoadedAccountsDataSize,
      ...extInfo
    } = props || {};

    // blockhash + lastValidBlockHeight (both are required, so just fetch latestBlockhash)
    let recentBlockhash = propRecentBlockhash;
    let lastValidBlockHeight = propLastValidBlockHeight;
    if (!recentBlockhash || lastValidBlockHeight === undefined) {
      const latest = await this.connection.getLatestBlockhash(this.blockhashCommitment);
      recentBlockhash = recentBlockhash ?? latest.blockhash;
      lastValidBlockHeight = lastValidBlockHeight ?? latest.lastValidBlockHeight;
    }

    // compute budget: explicit params win, otherwise derive from computeBudgetConfig (prop) > the config stored by addCustomComputeBudget > getComputeBudgetConfig()
    const budgetConfig = propComputeBudgetConfig ?? this.computeBudgetConfig ?? (await this.getComputeBudgetConfig());

    // computeUnitLimit fallback: v1 has no implicit default, and a missing one makes the transaction fail
    const computeUnitLimit = propComputeUnitLimit ?? budgetConfig?.units ?? 600000;

    // priorityFeeLamports: v1 wants total lamports; v0's microLamports is a per-CU price, so multiply by units (rounding up)
    let priorityFeeLamports = propPriorityFeeLamports;
    if (priorityFeeLamports === undefined && budgetConfig?.microLamports) {
      const MICRO = BigInt(1_000_000);
      priorityFeeLamports =
        (BigInt(budgetConfig.microLamports) * BigInt(computeUnitLimit) + (MICRO - BigInt(1))) / MICRO;
    }

    if (this.owner?.signer && !this.signers.some((s) => s.publicKey.equals(this.owner!.publicKey)))
      this.signers.push(this.owner.signer);

    // loadedAccountsDataSize precedence: explicitly specified > measured (autoLoadedAccountsDataSize) > the fixed 8MB default
    let loadedAccountsDataSize = budgetConfig?.loadedAccountsDataSize;
    if (loadedAccountsDataSize === undefined && autoLoadedAccountsDataSize) {
      loadedAccountsDataSize = await calcLoadedAccountsDataSize(this.connection, this.allInstructions);
    }
    loadedAccountsDataSize = loadedAccountsDataSize ?? DEFAULT_LOADED_ACCOUNTS_DATA_SIZE;

    const transaction = buildV1Transaction({
      payer: this.feePayer,
      recentBlockhash,
      lastValidBlockHeight,
      computeUnitLimit,
      priorityFeeLamports,
      loadedAccountsDataSize,
      instructions: [...this.allInstructions],
    });

    return {
      builder: this,
      transaction,
      signers: this.signers,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (params) => {
        const { skipPreflight = true, sendAndConfirm, notSendToRpc } = params || {};

        printSimulate([transaction]);
        // Keypair path: we hold the keys, so convert every signer into a CryptoKeyPair and sign
        if (this.owner?.isKeyPair) {
          const keyPairs = await signersToCryptoKeyPairs(this.signers);
          const signedTx = await signV1Transaction(transaction, keyPairs);
          const txId = notSendToRpc
            ? ""
            : await this.connection.sendEncodedTransaction(serializeV1Transaction(signedTx), { skipPreflight });
          if (sendAndConfirm && txId) await confirmTransaction(this.connection, txId);
          return { txId, signedTx };
        }

        // Wallet path: the ephemeral signers partially sign first, then the wallet (byte-level) signs as fee payer
        if (this.signAllV1Transactions) {
          const extraSigners = this.signers.filter((s) => !s.publicKey.equals(this.feePayer));
          const partiallySigned = extraSigners.length
            ? await partialSignV1Transaction(transaction, await signersToCryptoKeyPairs(extraSigners))
            : transaction;
          const [signedTx] = await signAllV1TransactionsWithWallet([partiallySigned], this.signAllV1Transactions);
          const txId = notSendToRpc
            ? ""
            : await this.connection.sendEncodedTransaction(serializeV1Transaction(signedTx), { skipPreflight });
          if (sendAndConfirm && txId) await confirmTransaction(this.connection, txId);
          return { txId, signedTx };
        }

        throw new Error("please provide owner in keypair format or signAllV1Transactions function");
      },
      extInfo: (extInfo || {}) as O,
    };
  }

  /**
   * Build multiple v1 (2.x / kit) transactions on top of buildV1. The counterpart of buildV0MultiTx, but entirely
   * on 2.x: signing uses CryptoKeyPairs / a byte-level wallet, sending uses sendEncodedTransaction(base64).
   */
  public async buildV1MultiTx<T = Record<string, any>>(params: {
    extraPreBuildData?: MakeTxData<TxVersion.V1>[];
    buildProps?: T & {
      recentBlockhash?: string;
      lastValidBlockHeight?: number;
      computeUnitLimit?: number;
      priorityFeeLamports?: number | bigint;
      computeBudgetConfig?: ComputeBudgetConfig;
    };
  }): Promise<MultiTxV1BuildData> {
    const { extraPreBuildData = [], buildProps } = params;
    const { transaction } = await this.buildV1(buildProps);

    const filterExtraBuildData = extraPreBuildData.filter((data) => data.builder.instructions.length > 0);

    const allTransactions: TransactionV1[] = [transaction, ...filterExtraBuildData.map((data) => data.transaction)];
    const allSigners: Signer[][] = [this.signers, ...filterExtraBuildData.map((data) => data.signers)];
    const allInstructionTypes: string[] = [
      ...this.instructionTypes,
      ...filterExtraBuildData.map((data) => data.instructionTypes).flat(),
    ];

    if (this.owner?.signer) {
      allSigners.forEach((signers) => {
        if (!signers.some((s) => s.publicKey.equals(this.owner!.publicKey))) this.signers.push(this.owner!.signer!);
      });
    }

    const sendOne = async (tx: TransactionV1, skipPreflight: boolean): Promise<string> =>
      this.connection.sendEncodedTransaction(serializeV1Transaction(tx), { skipPreflight });

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: allInstructionTypes,
      execute: async (executeParams?: MultiTxExecuteParam) => {
        const { sequentially, onTxUpdate, skipPreflight = true } = executeParams || {};

        // First collect every signed transaction (via keypair or byte-level wallet)
        let signedTxs: TransactionV1[];
        if (this.owner?.isKeyPair) {
          signedTxs = await Promise.all(
            allTransactions.map(async (tx, idx) =>
              signV1Transaction(tx, await signersToCryptoKeyPairs(allSigners[idx])),
            ),
          );
        } else if (this.signAllV1Transactions) {
          // For each transaction, let the non-fee-payer ephemeral signers partially sign first, then let the wallet batch-sign as fee payer
          const partiallySigned = await Promise.all(
            allTransactions.map(async (tx, idx) => {
              const extraSigners = allSigners[idx].filter((s) => !s.publicKey.equals(this.feePayer));
              return extraSigners.length
                ? partialSignV1Transaction(tx, await signersToCryptoKeyPairs(extraSigners))
                : tx;
            }),
          );
          signedTxs = await signAllV1TransactionsWithWallet(partiallySigned, this.signAllV1Transactions);
        } else {
          throw new Error("please provide owner in keypair format or signAllV1Transactions function");
        }

        // Sequential sending: send the next transaction only once the previous one is confirmed, reporting status
        // through onTxUpdate (fire-and-forget: progress is delivered via onTxUpdate's processedTxs, so empty txIds
        // are returned immediately, consistent with buildV0MultiTx)
        if (sequentially) {
          let i = 0;
          const processedTxs: TxUpdateParams[] = [];
          const checkSendTx = async (): Promise<void> => {
            if (!signedTxs[i]) return;
            const tx = signedTxs[i];
            const txId = await sendOne(tx, skipPreflight);
            processedTxs.push({ txId, status: "sent", signedTx: tx });
            onTxUpdate?.([...processedTxs]);
            i++;

            let confirmed = false;
            // eslint-disable-next-line
            let intervalId: NodeJS.Timer | null = null,
              subSignatureId: number | null = null;
            const cbk = (signatureResult: SignatureResult): void => {
              intervalId !== null && clearInterval(intervalId);
              subSignatureId !== null && this.connection.removeSignatureListener(subSignatureId);
              const targetTxIdx = processedTxs.findIndex((t) => t.txId === txId);
              if (targetTxIdx > -1) {
                if (processedTxs[targetTxIdx].status === "error" || processedTxs[targetTxIdx].status === "success")
                  return;
                processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
              }
              onTxUpdate?.([...processedTxs]);
              if (!signatureResult.err) checkSendTx();
            };

            // Fallback polling: use getSignatureStatus (it queries by signature, independent of the transaction
            // version); getTransaction cannot be used — web3.js 1.x cannot deserialize a v1 response
            if (this.loopMultiTxStatus)
              intervalId = setInterval(async () => {
                if (confirmed) {
                  clearInterval(intervalId!);
                  return;
                }
                try {
                  const { value } = await this.connection.getSignatureStatus(txId, { searchTransactionHistory: true });
                  if (value && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) {
                    confirmed = true;
                    clearInterval(intervalId!);
                    cbk({ err: value.err });
                    console.log("tx status from getSignatureStatus:", txId);
                  }
                } catch (e) {
                  confirmed = true;
                  clearInterval(intervalId!);
                  console.error("getSignatureStatus timeout:", e, txId);
                }
              }, LOOP_INTERVAL);

            subSignatureId = this.connection.onSignature(
              txId,
              (result) => {
                if (confirmed) {
                  this.connection.removeSignatureListener(subSignatureId!);
                  return;
                }
                confirmed = true;
                cbk(result);
              },
              "confirmed",
            );
            this.connection.getSignatureStatus(txId);
          };
          checkSendTx();
          return { txIds: [], signedTxs };
        }

        const txIds = await Promise.all(signedTxs.map((tx) => sendOne(tx, skipPreflight)));
        return { txIds, signedTxs };
      },
      extInfo: buildProps || {},
    };
  }

  public async buildV0MultiTx<T = Record<string, any>>(params: {
    extraPreBuildData?: MakeTxData<TxVersion.V0>[];
    buildProps?: T & {
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
      forerunCreate?: boolean;
      recentBlockhash?: string;
    };
  }): Promise<MultiTxV0BuildData> {
    const { extraPreBuildData = [], buildProps } = params;
    const { transaction } = await this.buildV0(buildProps);

    const filterExtraBuildData = extraPreBuildData.filter((data) => data.builder.instructions.length > 0);

    const allTransactions: VersionedTransaction[] = [
      transaction,
      ...filterExtraBuildData.map((data) => data.transaction),
    ];
    const allSigners: Signer[][] = [this.signers, ...filterExtraBuildData.map((data) => data.signers)];
    const allInstructionTypes: string[] = [
      ...this.instructionTypes,
      ...filterExtraBuildData.map((data) => data.instructionTypes).flat(),
    ];

    if (this.owner?.signer) {
      allSigners.forEach((signers) => {
        if (!signers.some((s) => s.publicKey.equals(this.owner!.publicKey))) this.signers.push(this.owner!.signer!);
      });
    }

    allTransactions.forEach(async (tx, idx) => {
      tx.sign(allSigners[idx]);
    });

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: allInstructionTypes,
      buildProps,
      execute: async (executeParams?: MultiTxExecuteParam) => {
        const { sequentially, onTxUpdate, recentBlockHash: propBlockHash, skipPreflight = true } = executeParams || {};
        if (propBlockHash) allTransactions.forEach((tx) => (tx.message.recentBlockhash = propBlockHash));
        printSimulate(allTransactions);
        if (this.owner?.isKeyPair) {
          if (sequentially) {
            const txIds: string[] = [];
            for (const tx of allTransactions) {
              const txId = await this.connection.sendTransaction(tx, { skipPreflight });
              await confirmTransaction(this.connection, txId);
              txIds.push(txId);
            }

            return { txIds, signedTxs: allTransactions };
          }

          return {
            txIds: await Promise.all(
              allTransactions.map(async (tx) => {
                return await this.connection.sendTransaction(tx, { skipPreflight });
              }),
            ),
            signedTxs: allTransactions,
          };
        }

        if (this.signAllTransactions) {
          const signedTxs = await this.signAllTransactions(allTransactions);

          if (sequentially) {
            let i = 0;
            const processedTxs: TxUpdateParams[] = [];
            const checkSendTx = async (): Promise<void> => {
              if (!signedTxs[i]) return;
              const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight });
              processedTxs.push({ txId, status: "sent", signedTx: signedTxs[i] });
              onTxUpdate?.([...processedTxs]);
              i++;

              let confirmed = false;
              // eslint-disable-next-line
              let intervalId: NodeJS.Timer | null = null,
                subSignatureId: number | null = null;
              const cbk = (signatureResult: SignatureResult): void => {
                intervalId !== null && clearInterval(intervalId);
                subSignatureId !== null && this.connection.removeSignatureListener(subSignatureId);
                const targetTxIdx = processedTxs.findIndex((tx) => tx.txId === txId);
                if (targetTxIdx > -1) {
                  if (processedTxs[targetTxIdx].status === "error" || processedTxs[targetTxIdx].status === "success")
                    return;
                  processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
                }
                onTxUpdate?.([...processedTxs]);
                if (!signatureResult.err) checkSendTx();
              };

              if (this.loopMultiTxStatus)
                intervalId = setInterval(async () => {
                  if (confirmed) {
                    clearInterval(intervalId!);
                    return;
                  }
                  try {
                    const r = await this.connection.getTransaction(txId, {
                      commitment: "confirmed",
                      maxSupportedTransactionVersion: 1,
                    });
                    if (r) {
                      confirmed = true;
                      clearInterval(intervalId!);
                      cbk({ err: r.meta?.err || null });
                      console.log("tx status from getTransaction:", txId);
                    }
                  } catch (e) {
                    confirmed = true;
                    clearInterval(intervalId!);
                    console.error("getTransaction timeout:", e, txId);
                  }
                }, LOOP_INTERVAL);

              subSignatureId = this.connection.onSignature(
                txId,
                (result) => {
                  if (confirmed) {
                    this.connection.removeSignatureListener(subSignatureId!);
                    return;
                  }
                  confirmed = true;
                  cbk(result);
                },
                "confirmed",
              );
              this.connection.getSignatureStatus(txId);
            };
            checkSendTx();
            return {
              txIds: [],
              signedTxs,
            };
          } else {
            const txIds: string[] = [];
            for (let i = 0; i < signedTxs.length; i += 1) {
              const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight });
              txIds.push(txId);
            }
            return { txIds, signedTxs };
          }
        }
        throw new Error("please provide owner in keypair format or signAllTransactions function");
      },
      extInfo: buildProps || {},
    };
  }

  public async versionSizeCheckBuild<T extends TxVersion, O = Record<string, any>>(
    props?: Record<string, any> & {
      txVersion?: T;
      computeBudgetConfig?: ComputeBudgetConfig;
      splitIns?: TransactionInstruction[];
      insCountLimit?: number;
      /** v0 only */
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
      /** v1 only */
      computeUnitLimit?: number;
      priorityFeeLamports?: number | bigint;
      recentBlockhash?: string;
      lastValidBlockHeight?: number;
      autoLoadedAccountsDataSize?: boolean;
    },
  ): Promise<MakeMultiTxData<T, O>> {
    const {
      txVersion,
      computeBudgetConfig,
      splitIns,
      insCountLimit,
      lookupTableCache,
      lookupTableAddress,
      computeUnitLimit,
      priorityFeeLamports,
      recentBlockhash,
      lastValidBlockHeight,
      autoLoadedAccountsDataSize,
      ...extInfo
    } = props || {};

    // every branch passes the shared props explicitly so the callee destructures them out and its own default
    // kicks in for the undefined ones (notably insCountLimit, which v1 derives from the compute budget)
    if (txVersion === TxVersion.V1)
      return (await this.sizeCheckBuildV1({
        ...extInfo,
        computeBudgetConfig,
        splitIns,
        insCountLimit,
        computeUnitLimit,
        priorityFeeLamports,
        recentBlockhash,
        lastValidBlockHeight,
        autoLoadedAccountsDataSize,
      })) as MakeMultiTxData<T, O>;

    if (txVersion === TxVersion.V0)
      return (await this.sizeCheckBuildV0({
        ...extInfo,
        computeBudgetConfig,
        splitIns,
        insCountLimit,
        lookupTableCache,
        lookupTableAddress,
      })) as MakeMultiTxData<T, O>;

    return (await this.sizeCheckBuild({
      ...extInfo,
      computeBudgetConfig,
      splitIns,
      insCountLimit,
    })) as MakeMultiTxData<T, O>;
  }

  public async sizeCheckBuild(
    props?: Record<string, any> & {
      computeBudgetConfig?: ComputeBudgetConfig;
      splitIns?: TransactionInstruction[];
      /** Max instruction count per tx (same semantics as sizeCheckBuildV0 / sizeCheckBuildV1) */
      insCountLimit?: number;
    },
  ): Promise<MultiTxBuildData> {
    const { splitIns = [], computeBudgetConfig, insCountLimit = 12, ...extInfo } = props || {};
    const computeBudgetData: { instructions: TransactionInstruction[]; instructionTypes: string[] } =
      computeBudgetConfig
        ? addComputeBudget(computeBudgetConfig)
        : {
            instructions: [],
            instructionTypes: [],
          };

    const signerKey: { [key: string]: Signer } = this.signers.reduce(
      (acc, cur) => ({ ...acc, [cur.publicKey.toBase58()]: cur }),
      {},
    );

    const allTransactions: Transaction[] = [];
    const allSigners: Signer[][] = [];

    let instructionQueue: TransactionInstruction[] = [];
    let splitInsIdx = 0;
    this.allInstructions.forEach((item) => {
      const _itemIns = [...instructionQueue, item];
      const _itemInsWithCompute = computeBudgetConfig ? [...computeBudgetData.instructions, ..._itemIns] : _itemIns;
      const _signerStrs = new Set<string>(
        _itemIns.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signer = [..._signerStrs.values()].map((i) => new PublicKey(i));

      if (
        item !== splitIns[splitInsIdx] &&
        instructionQueue.length < insCountLimit &&
        (checkLegacyTxSize({ instructions: _itemInsWithCompute, payer: this.feePayer, signers: _signer }) ||
          checkLegacyTxSize({ instructions: _itemIns, payer: this.feePayer, signers: _signer }))
      ) {
        // current ins add to queue still not exceed tx size limit
        instructionQueue.push(item);
      } else {
        if (instructionQueue.length === 0) throw Error("item ins too big");
        splitInsIdx += item === splitIns[splitInsIdx] ? 1 : 0;
        // if add computeBudget still not exceed tx size limit
        if (
          checkLegacyTxSize({
            instructions: computeBudgetConfig
              ? [...computeBudgetData.instructions, ...instructionQueue]
              : [...instructionQueue],
            payer: this.feePayer,
            signers: _signer,
          })
        ) {
          allTransactions.push(new Transaction().add(...computeBudgetData.instructions, ...instructionQueue));
        } else {
          allTransactions.push(new Transaction().add(...instructionQueue));
        }
        allSigners.push(
          Array.from(
            new Set<string>(
              instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
            ),
          )
            .map((i) => signerKey[i])
            .filter((i) => i !== undefined),
        );
        instructionQueue = [item];
      }
    });

    if (instructionQueue.length > 0) {
      const _signerStrs = new Set<string>(
        instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signers = [..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined);

      if (
        checkLegacyTxSize({
          instructions: computeBudgetConfig
            ? [...computeBudgetData.instructions, ...instructionQueue]
            : [...instructionQueue],
          payer: this.feePayer,
          signers: _signers.map((s) => s.publicKey),
        })
      ) {
        allTransactions.push(new Transaction().add(...computeBudgetData.instructions, ...instructionQueue));
      } else {
        allTransactions.push(new Transaction().add(...instructionQueue));
      }
      allSigners.push(_signers);
    }
    allTransactions.forEach((tx) => (tx.feePayer = this.feePayer));

    if (this.owner?.signer) {
      allSigners.forEach((signers) => {
        if (!signers.some((s) => s.publicKey.equals(this.owner!.publicKey))) signers.push(this.owner!.signer!);
      });
    }

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: this.instructionTypes,
      execute: async (executeParams?: MultiTxExecuteParam) => {
        const {
          sequentially,
          onTxUpdate,
          skipTxCount = 0,
          recentBlockHash: propBlockHash,
          skipPreflight = true,
        } = executeParams || {};
        const recentBlockHash = propBlockHash ?? (await getRecentBlockHash(this.connection, this.blockhashCommitment));
        allTransactions.forEach(async (tx, idx) => {
          tx.recentBlockhash = recentBlockHash;
          if (allSigners[idx].length) tx.sign(...allSigners[idx]);
        });
        printSimulate(allTransactions);
        if (this.owner?.isKeyPair) {
          if (sequentially) {
            let i = 0;
            const txIds: string[] = [];
            for (const tx of allTransactions) {
              ++i;
              if (i <= skipTxCount) {
                txIds.push("tx skipped");
                continue;
              }
              const txId = await sendAndConfirmTransaction(
                this.connection,
                tx,
                this.signers.find((s) => s.publicKey.equals(this.owner!.publicKey))
                  ? this.signers
                  : [...this.signers, this.owner.signer!],
                { skipPreflight },
              );
              txIds.push(txId);
            }

            return {
              txIds,
              signedTxs: allTransactions,
            };
          }
          return {
            txIds: await Promise.all(
              allTransactions.map(async (tx) => {
                return await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight });
              }),
            ),
            signedTxs: allTransactions,
          };
        }
        if (this.signAllTransactions) {
          const needSignedTx = await this.signAllTransactions(
            allTransactions.slice(skipTxCount, allTransactions.length),
          );
          const signedTxs = [...allTransactions.slice(0, skipTxCount), ...needSignedTx];
          if (sequentially) {
            let i = 0;
            const processedTxs: TxUpdateParams[] = [];
            const checkSendTx = async (): Promise<void> => {
              if (!signedTxs[i]) return;
              if (i < skipTxCount) {
                // success before, do not send again
                processedTxs.push({ txId: "", status: "success", signedTx: signedTxs[i] });
                onTxUpdate?.([...processedTxs]);
                i++;
                checkSendTx();
              }
              const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight });
              processedTxs.push({ txId, status: "sent", signedTx: signedTxs[i] });
              onTxUpdate?.([...processedTxs]);
              i++;

              let confirmed = false;
              // eslint-disable-next-line
              let intervalId: NodeJS.Timer | null = null,
                subSignatureId: number | null = null;
              const cbk = (signatureResult: SignatureResult): void => {
                intervalId !== null && clearInterval(intervalId);
                subSignatureId !== null && this.connection.removeSignatureListener(subSignatureId);
                const targetTxIdx = processedTxs.findIndex((tx) => tx.txId === txId);
                if (targetTxIdx > -1) {
                  if (processedTxs[targetTxIdx].status === "error" || processedTxs[targetTxIdx].status === "success")
                    return;
                  processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
                }
                onTxUpdate?.([...processedTxs]);
                if (!signatureResult.err) checkSendTx();
              };

              if (this.loopMultiTxStatus)
                intervalId = setInterval(async () => {
                  if (confirmed) {
                    clearInterval(intervalId!);
                    return;
                  }
                  try {
                    const r = await this.connection.getTransaction(txId, {
                      commitment: "confirmed",
                      maxSupportedTransactionVersion: 1,
                    });
                    if (r) {
                      confirmed = true;
                      clearInterval(intervalId!);
                      cbk({ err: r.meta?.err || null });
                      console.log("tx status from getTransaction:", txId);
                    }
                  } catch (e) {
                    confirmed = true;
                    clearInterval(intervalId!);
                    console.error("getTransaction timeout:", e, txId);
                  }
                }, LOOP_INTERVAL);

              subSignatureId = this.connection.onSignature(
                txId,
                (result) => {
                  if (confirmed) {
                    this.connection.removeSignatureListener(subSignatureId!);
                    return;
                  }
                  confirmed = true;
                  cbk(result);
                },
                "confirmed",
              );
              this.connection.getSignatureStatus(txId);
            };
            await checkSendTx();
            return {
              txIds: processedTxs.map((d) => d.txId),
              signedTxs,
            };
          } else {
            const txIds: string[] = [];
            for (let i = 0; i < signedTxs.length; i += 1) {
              const txId = await this.connection.sendRawTransaction(signedTxs[i].serialize(), { skipPreflight });
              txIds.push(txId);
            }
            return { txIds, signedTxs };
          }
        }
        throw new Error("please provide owner in keypair format or signAllTransactions function");
      },
      extInfo: extInfo || {},
    };
  }

  public async sizeCheckBuildV0(
    props?: Record<string, any> & {
      computeBudgetConfig?: ComputeBudgetConfig;
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
      splitIns?: TransactionInstruction[];
      insCountLimit?: number;
    },
  ): Promise<MultiTxV0BuildData> {
    const {
      computeBudgetConfig,
      splitIns = [],
      lookupTableCache = {},
      lookupTableAddress = [],
      insCountLimit = 12,
      ...extInfo
    } = props || {};
    const lookupTableAddressAccount = {
      ...(this.cluster === "devnet"
        ? await getDevLookupTableCache(this.connection)
        : await getMainLookupTableCache(this.connection)),
      ...lookupTableCache,
    };
    const allLTA = Array.from(new Set<string>([...this.lookupTableAddress, ...lookupTableAddress]));
    const needCacheLTA: PublicKey[] = [];
    for (const item of allLTA) {
      if (lookupTableAddressAccount[item] === undefined) needCacheLTA.push(new PublicKey(item));
    }
    const newCacheLTA = await getMultipleLookupTableInfo({ connection: this.connection, address: needCacheLTA });
    for (const [key, value] of Object.entries(newCacheLTA)) lookupTableAddressAccount[key] = value;

    const computeBudgetData: { instructions: TransactionInstruction[]; instructionTypes: string[] } =
      computeBudgetConfig
        ? addComputeBudget(computeBudgetConfig)
        : {
            instructions: [],
            instructionTypes: [],
          };

    const blockHash = await getRecentBlockHash(this.connection, this.blockhashCommitment);

    const signerKey: { [key: string]: Signer } = this.signers.reduce(
      (acc, cur) => ({ ...acc, [cur.publicKey.toBase58()]: cur }),
      {},
    );
    const allTransactions: VersionedTransaction[] = [];
    const allSigners: Signer[][] = [];

    let instructionQueue: TransactionInstruction[] = [];
    let splitInsIdx = 0;
    this.allInstructions.forEach((item) => {
      const _itemIns = [...instructionQueue, item];
      const _itemInsWithCompute = computeBudgetConfig ? [...computeBudgetData.instructions, ..._itemIns] : _itemIns;
      if (
        item !== splitIns[splitInsIdx] &&
        instructionQueue.length < insCountLimit &&
        (checkV0TxSize({ instructions: _itemInsWithCompute, payer: this.feePayer, lookupTableAddressAccount }) ||
          checkV0TxSize({ instructions: _itemIns, payer: this.feePayer, lookupTableAddressAccount }))
      ) {
        // current ins add to queue still not exceed tx size limit
        instructionQueue.push(item);
      } else {
        if (instructionQueue.length === 0) throw Error("item ins too big");
        splitInsIdx += item === splitIns[splitInsIdx] ? 1 : 0;
        const lookupTableAddress: undefined | CacheLTA = {};
        for (const item of [...new Set<string>(allLTA)]) {
          if (lookupTableAddressAccount[item] !== undefined) lookupTableAddress[item] = lookupTableAddressAccount[item];
        }
        // if add computeBudget still not exceed tx size limit
        if (
          computeBudgetConfig &&
          checkV0TxSize({
            instructions: [...computeBudgetData.instructions, ...instructionQueue],
            payer: this.feePayer,
            lookupTableAddressAccount,
            recentBlockhash: blockHash,
          })
        ) {
          const messageV0 = new TransactionMessage({
            payerKey: this.feePayer,
            recentBlockhash: blockHash,

            instructions: [...computeBudgetData.instructions, ...instructionQueue],
          }).compileToV0Message(Object.values(lookupTableAddressAccount));
          allTransactions.push(new VersionedTransaction(messageV0));
        } else {
          const messageV0 = new TransactionMessage({
            payerKey: this.feePayer,
            recentBlockhash: blockHash,
            instructions: [...instructionQueue],
          }).compileToV0Message(Object.values(lookupTableAddressAccount));
          allTransactions.push(new VersionedTransaction(messageV0));
        }
        allSigners.push(
          Array.from(
            new Set<string>(
              instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
            ),
          )
            .map((i) => signerKey[i])
            .filter((i) => i !== undefined),
        );
        instructionQueue = [item];
      }
    });

    if (instructionQueue.length > 0) {
      const _signerStrs = new Set<string>(
        instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signers = [..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined);

      if (
        computeBudgetConfig &&
        checkV0TxSize({
          instructions: [...computeBudgetData.instructions, ...instructionQueue],
          payer: this.feePayer,
          lookupTableAddressAccount,
          recentBlockhash: blockHash,
        })
      ) {
        const messageV0 = new TransactionMessage({
          payerKey: this.feePayer,
          recentBlockhash: blockHash,
          instructions: [...computeBudgetData.instructions, ...instructionQueue],
        }).compileToV0Message(Object.values(lookupTableAddressAccount));
        allTransactions.push(new VersionedTransaction(messageV0));
      } else {
        const messageV0 = new TransactionMessage({
          payerKey: this.feePayer,
          recentBlockhash: blockHash,
          instructions: [...instructionQueue],
        }).compileToV0Message(Object.values(lookupTableAddressAccount));
        allTransactions.push(new VersionedTransaction(messageV0));
      }

      allSigners.push(_signers);
    }

    if (this.owner?.signer) {
      allSigners.forEach((signers) => {
        if (!signers.some((s) => s.publicKey.equals(this.owner!.publicKey))) signers.push(this.owner!.signer!);
      });
    }

    allTransactions.forEach((tx, idx) => {
      tx.sign(allSigners[idx]);
    });

    return {
      builder: this,
      transactions: allTransactions,
      buildProps: props,
      signers: allSigners,
      instructionTypes: this.instructionTypes,
      execute: async (executeParams?: MultiTxExecuteParam) => {
        const {
          sequentially,
          onTxUpdate,
          skipTxCount = 0,
          recentBlockHash: propBlockHash,
          skipPreflight = true,
        } = executeParams || {};
        allTransactions.map(async (tx, idx) => {
          if (allSigners[idx].length) tx.sign(allSigners[idx]);
          if (propBlockHash) tx.message.recentBlockhash = propBlockHash;
        });
        printSimulate(allTransactions);
        if (this.owner?.isKeyPair) {
          if (sequentially) {
            let i = 0;
            const txIds: string[] = [];
            for (const tx of allTransactions) {
              ++i;
              if (i <= skipTxCount) {
                console.log("skip tx: ", i);
                txIds.push("tx skipped");
                continue;
              }
              const txId = await this.connection.sendTransaction(tx, { skipPreflight });
              await confirmTransaction(this.connection, txId);

              txIds.push(txId);
            }

            return { txIds, signedTxs: allTransactions };
          }

          return {
            txIds: await Promise.all(
              allTransactions.map(async (tx) => {
                return await this.connection.sendTransaction(tx, { skipPreflight });
              }),
            ),
            signedTxs: allTransactions,
          };
        }
        if (this.signAllTransactions) {
          const needSignedTx = await this.signAllTransactions(
            allTransactions.slice(skipTxCount, allTransactions.length),
          );
          const signedTxs = [...allTransactions.slice(0, skipTxCount), ...needSignedTx];
          if (sequentially) {
            let i = 0;
            const processedTxs: TxUpdateParams[] = [];
            const checkSendTx = async (): Promise<void> => {
              if (!signedTxs[i]) return;
              if (i < skipTxCount) {
                // success before, do not send again
                processedTxs.push({ txId: "", status: "success", signedTx: signedTxs[i] });
                onTxUpdate?.([...processedTxs]);
                i++;
                checkSendTx();
                return;
              }
              const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight });
              processedTxs.push({ txId, status: "sent", signedTx: signedTxs[i] });
              onTxUpdate?.([...processedTxs]);
              i++;

              let confirmed = false;
              // eslint-disable-next-line
              let intervalId: NodeJS.Timer | null = null,
                subSignatureId: number | null = null;
              const cbk = (signatureResult: SignatureResult): void => {
                intervalId !== null && clearInterval(intervalId);
                subSignatureId !== null && this.connection.removeSignatureListener(subSignatureId);
                const targetTxIdx = processedTxs.findIndex((tx) => tx.txId === txId);
                if (targetTxIdx > -1) {
                  if (processedTxs[targetTxIdx].status === "error" || processedTxs[targetTxIdx].status === "success")
                    return;
                  processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
                }
                onTxUpdate?.([...processedTxs]);
                if (!signatureResult.err) checkSendTx();
              };

              if (this.loopMultiTxStatus)
                intervalId = setInterval(async () => {
                  if (confirmed) {
                    clearInterval(intervalId!);
                    return;
                  }
                  try {
                    const r = await this.connection.getTransaction(txId, {
                      commitment: "confirmed",
                      maxSupportedTransactionVersion: 1,
                    });
                    if (r) {
                      confirmed = true;
                      clearInterval(intervalId!);
                      cbk({ err: r.meta?.err || null });
                      console.log("tx status from getTransaction:", txId);
                    }
                  } catch (e) {
                    confirmed = true;
                    clearInterval(intervalId!);
                    console.error("getTransaction timeout:", e, txId);
                  }
                }, LOOP_INTERVAL);

              subSignatureId = this.connection.onSignature(
                txId,
                (result) => {
                  if (confirmed) {
                    this.connection.removeSignatureListener(subSignatureId!);
                    return;
                  }
                  confirmed = true;
                  cbk(result);
                },
                "confirmed",
              );
              this.connection.getSignatureStatus(txId);
            };
            checkSendTx();
            return {
              txIds: [],
              signedTxs,
            };
          } else {
            const txIds: string[] = [];
            for (let i = 0; i < signedTxs.length; i += 1) {
              const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight });
              txIds.push(txId);
            }
            return { txIds, signedTxs };
          }
        }
        throw new Error("please provide owner in keypair format or signAllTransactions function");
      },
      extInfo: extInfo || {},
    };
  }

  /**
   * Differences from sizeCheckBuildV0:
   * - a v1 transaction may be up to 4096 bytes (legacy / v0 cap at 1232), so many more instructions fit per tx.
   *   Note a v1 transaction is additionally capped at 64 unique account addresses, which for account heavy
   *   instructions (a CLMM decreaseLiquidity alone touches ~16) bites long before the 4096 bytes do -
   *   checkV1TxSize reports that case as "does not fit" as well
   * - `insCountLimit` is no longer hardcoded to 12: it defaults to computeUnitLimit / V1_DEFAULT_CU_PER_INSTRUCTION,
   *   which is 12 at the default 600000 units (identical to v0) and 28 at the 1.4M ceiling. Account heavy
   *   instructions get split by the account cap well before the count limit matters, so the limit really only
   *   guards the cheap-instruction case, where compute is the thing worth guarding
   * - a 2.x Transaction is immutable, so nothing is signed here; signing happens inside execute, and the
   *   `recentBlockHash` execute param is ignored (the blockhash is already baked into messageBytes)
   */
  public async sizeCheckBuildV1(
    props?: Record<string, any> & {
      computeBudgetConfig?: ComputeBudgetConfig;
      /** Compute unit limit applied to every split tx; falls back to computeBudgetConfig / getComputeBudgetConfig().units (default 600000) */
      computeUnitLimit?: number;
      /** v1 priority fee (total lamports) applied to every split tx; derived from computeBudgetConfig.microLamports x units when omitted */
      priorityFeeLamports?: number | bigint;
      /** Instructions that must start a new tx (same semantics as sizeCheckBuild / sizeCheckBuildV0) */
      splitIns?: TransactionInstruction[];
      /** Max instruction count per tx; defaults to computeUnitLimit / 50000 (12 at the default 600000 units) */
      insCountLimit?: number;
      recentBlockhash?: string;
      lastValidBlockHeight?: number;
      /**
       * Measure loadedAccountsDataSize from the actual accounts (1~2 extra getMultipleAccountsInfo calls). It is
       * measured once over all instructions and the result is shared by every split tx, since it is only a limit
       * declaration and does not affect fees.
       */
      autoLoadedAccountsDataSize?: boolean;
    },
  ): Promise<MultiTxV1BuildData> {
    const {
      computeBudgetConfig: propComputeBudgetConfig,
      computeUnitLimit: propComputeUnitLimit,
      priorityFeeLamports: propPriorityFeeLamports,
      recentBlockhash: propRecentBlockhash,
      lastValidBlockHeight: propLastValidBlockHeight,
      autoLoadedAccountsDataSize,
      splitIns = [],
      insCountLimit: propInsCountLimit,
      ...extInfo
    } = props || {};

    let recentBlockhash = propRecentBlockhash;
    let lastValidBlockHeight = propLastValidBlockHeight;
    if (!recentBlockhash || lastValidBlockHeight === undefined) {
      const latest = await this.connection.getLatestBlockhash(this.blockhashCommitment);
      recentBlockhash = recentBlockhash ?? latest.blockhash;
      lastValidBlockHeight = lastValidBlockHeight ?? latest.lastValidBlockHeight;
    }

    // same precedence as buildV1: explicit params > computeBudgetConfig (prop) > setCustomComputeBudget > getComputeBudgetConfig()
    const budgetConfig = propComputeBudgetConfig ?? this.computeBudgetConfig ?? (await this.getComputeBudgetConfig());
    const computeUnitLimit = propComputeUnitLimit ?? budgetConfig?.units ?? 600000;
    let priorityFeeLamports = propPriorityFeeLamports;
    if (priorityFeeLamports === undefined && budgetConfig?.microLamports) {
      const MICRO = BigInt(1_000_000);
      priorityFeeLamports =
        (BigInt(budgetConfig.microLamports) * BigInt(computeUnitLimit) + (MICRO - BigInt(1))) / MICRO;
    }

    // budget the instruction count off the compute budget rather than hardcoding it: compute, not size, is what
    // caps a v1 transaction once the 64 account limit has had its say
    const insCountLimit =
      propInsCountLimit ?? Math.max(1, Math.floor(computeUnitLimit / V1_DEFAULT_CU_PER_INSTRUCTION));
    console.log("sizeCheckBuildV1: computeUnitLimit", computeUnitLimit, "insCountLimit", insCountLimit);

    const sourceInstructions = [...this.instructions, ...this.endInstructions];

    let loadedAccountsDataSize = budgetConfig?.loadedAccountsDataSize;
    if (loadedAccountsDataSize === undefined && autoLoadedAccountsDataSize)
      loadedAccountsDataSize = await calcLoadedAccountsDataSize(this.connection, sourceInstructions);
    loadedAccountsDataSize = loadedAccountsDataSize ?? DEFAULT_LOADED_ACCOUNTS_DATA_SIZE;

    const signerKey: { [key: string]: Signer } = this.signers.reduce(
      (acc, cur) => ({ ...acc, [cur.publicKey.toBase58()]: cur }),
      {},
    );

    const buildOne = (instructions: TransactionInstruction[]): TransactionV1 =>
      buildV1Transaction({
        payer: this.feePayer,
        recentBlockhash: recentBlockhash!,
        lastValidBlockHeight: lastValidBlockHeight!,
        computeUnitLimit,
        priorityFeeLamports,
        loadedAccountsDataSize,
        instructions,
      });

    const pickSigners = (instructions: TransactionInstruction[]): Signer[] =>
      Array.from(
        new Set<string>(
          instructions.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
        ),
      )
        .map((i) => signerKey[i])
        .filter((i) => i !== undefined);

    const allTransactions: TransactionV1[] = [];
    const allSigners: Signer[][] = [];

    const pushTx = (instructions: TransactionInstruction[]): void => {
      let transaction: TransactionV1;
      try {
        transaction = buildOne(instructions);
      } catch (e) {
        // a lone instruction is never size checked before it starts a queue, so this is where one that can never
        // be compiled on its own (e.g. over the 64 unique account limit) surfaces
        if (instructions.length === 1) throw Error("item ins too big");
        throw e;
      }
      if (!isTransactionWithinSizeLimit(transaction)) throw Error("item ins too big");
      allTransactions.push(transaction);
      allSigners.push(pickSigners(instructions));
    };

    let instructionQueue: TransactionInstruction[] = [];
    let splitInsIdx = 0;
    sourceInstructions.forEach((item) => {
      if (
        item !== splitIns[splitInsIdx] &&
        instructionQueue.length < insCountLimit &&
        checkV1TxSize({
          instructions: [...instructionQueue, item],
          payer: this.feePayer,
          computeUnitLimit,
          priorityFeeLamports,
          loadedAccountsDataSize,
          recentBlockhash,
          lastValidBlockHeight,
        })
      ) {
        // current ins add to queue still not exceed tx size limit
        instructionQueue.push(item);
      } else {
        if (instructionQueue.length === 0) throw Error("item ins too big");
        splitInsIdx += item === splitIns[splitInsIdx] ? 1 : 0;
        pushTx(instructionQueue);
        instructionQueue = [item];
      }
    });

    if (instructionQueue.length > 0) pushTx(instructionQueue);

    if (this.owner?.signer) {
      allSigners.forEach((signers) => {
        if (!signers.some((s) => s.publicKey.equals(this.owner!.publicKey))) signers.push(this.owner!.signer!);
      });
    }

    const sendOne = async (tx: TransactionV1, skipPreflight: boolean): Promise<string> =>
      this.connection.sendEncodedTransaction(serializeV1Transaction(tx), { skipPreflight });

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (executeParams?: MultiTxExecuteParam) => {
        const { sequentially, onTxUpdate, skipTxCount = 0, skipPreflight = true } = executeParams || {};

        printSimulate(allTransactions);

        // only the transactions that have not been sent yet need signing
        const needSignTxs = allTransactions.slice(skipTxCount);
        const needSignSigners = allSigners.slice(skipTxCount);

        let newSignedTxs: TransactionV1[];
        if (this.owner?.isKeyPair) {
          newSignedTxs = await Promise.all(
            needSignTxs.map(async (tx, idx) =>
              signV1Transaction(tx, await signersToCryptoKeyPairs(needSignSigners[idx])),
            ),
          );
        } else if (this.signAllV1Transactions) {
          // per tx: the non-fee-payer ephemeral signers partially sign first, then the wallet batch-signs as fee payer
          const partiallySigned = await Promise.all(
            needSignTxs.map(async (tx, idx) => {
              const extraSigners = needSignSigners[idx].filter((s) => !s.publicKey.equals(this.feePayer));
              return extraSigners.length
                ? partialSignV1Transaction(tx, await signersToCryptoKeyPairs(extraSigners))
                : tx;
            }),
          );
          newSignedTxs = await signAllV1TransactionsWithWallet(partiallySigned, this.signAllV1Transactions);
        } else {
          throw new Error("please provide owner in keypair format or signAllV1Transactions function");
        }
        const signedTxs = [...allTransactions.slice(0, skipTxCount), ...newSignedTxs];

        if (sequentially) {
          let i = 0;
          const processedTxs: TxUpdateParams[] = [];
          const checkSendTx = async (): Promise<void> => {
            if (!signedTxs[i]) return;
            if (i < skipTxCount) {
              // success before, do not send again
              processedTxs.push({ txId: "", status: "success", signedTx: signedTxs[i] });
              onTxUpdate?.([...processedTxs]);
              i++;
              checkSendTx();
              return;
            }
            const tx = signedTxs[i];
            const txId = await sendOne(tx, skipPreflight);
            processedTxs.push({ txId, status: "sent", signedTx: tx });
            onTxUpdate?.([...processedTxs]);
            i++;

            let confirmed = false;
            // eslint-disable-next-line
            let intervalId: NodeJS.Timer | null = null,
              subSignatureId: number | null = null;
            const cbk = (signatureResult: SignatureResult): void => {
              intervalId !== null && clearInterval(intervalId);
              subSignatureId !== null && this.connection.removeSignatureListener(subSignatureId);
              const targetTxIdx = processedTxs.findIndex((t) => t.txId === txId);
              if (targetTxIdx > -1) {
                if (processedTxs[targetTxIdx].status === "error" || processedTxs[targetTxIdx].status === "success")
                  return;
                processedTxs[targetTxIdx].status = signatureResult.err ? "error" : "success";
              }
              onTxUpdate?.([...processedTxs]);
              if (!signatureResult.err) checkSendTx();
            };

            // getSignatureStatus instead of getTransaction: web3.js 1.x cannot deserialize a v1 response
            if (this.loopMultiTxStatus)
              intervalId = setInterval(async () => {
                if (confirmed) {
                  clearInterval(intervalId!);
                  return;
                }
                try {
                  const { value } = await this.connection.getSignatureStatus(txId, { searchTransactionHistory: true });
                  if (value && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) {
                    confirmed = true;
                    clearInterval(intervalId!);
                    cbk({ err: value.err });
                    console.log("tx status from getSignatureStatus:", txId);
                  }
                } catch (e) {
                  confirmed = true;
                  clearInterval(intervalId!);
                  console.error("getSignatureStatus timeout:", e, txId);
                }
              }, LOOP_INTERVAL);

            subSignatureId = this.connection.onSignature(
              txId,
              (result) => {
                if (confirmed) {
                  this.connection.removeSignatureListener(subSignatureId!);
                  return;
                }
                confirmed = true;
                cbk(result);
              },
              "confirmed",
            );
            this.connection.getSignatureStatus(txId);
          };
          checkSendTx();
          return { txIds: [], signedTxs };
        }

        const txIds: string[] = [];
        for (let i = 0; i < signedTxs.length; i += 1) {
          if (i < skipTxCount) {
            txIds.push("tx skipped");
            continue;
          }
          txIds.push(await sendOne(signedTxs[i], skipPreflight));
        }
        return { txIds, signedTxs };
      },
      extInfo: extInfo || {},
    };
  }
}
