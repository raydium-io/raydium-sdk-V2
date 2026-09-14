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
  type SignAllTransactionsByteLevel,
} from "./buildV1Tx";
import { type Transaction as TransactionV1 } from "@solana/transactions";
import { InstructionType, TxVersion } from "./txType";
import {
  addComputeBudget,
  checkLegacyTxSize,
  checkV0TxSize,
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
   * v1（2.x）交易專用的 byte-level 批次錢包簽章。現有的 signAllTransactions 綁定 1.x
   * Transaction/VersionedTransaction 物件，無法簽 v1，故 buildV1 的錢包路徑改用這個。
   */
  signAllTransactionsByteLevel?: SignAllTransactionsByteLevel;
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
  /** 2.x（kit）的 Transaction，內含 messageBytes 與 signatures map */
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
  /** 2.x（kit）的 Transaction 陣列 */
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
 * v1 交易在未指定 loadedAccountsDataSize 時的預設上限（bytes）。
 * 新版 runtime 對「未宣告」的交易套用偏低的預設，複雜交易（如 CLMM，光 programdata 就 ~2MB）會噴
 * MaxLoadedAccountsDataSizeExceeded。此值只是「上限宣告」不影響手續費，設 8MB 覆蓋常見交易並留餘裕。
 * 需要更高可在 computeBudgetConfig.loadedAccountsDataSize 覆寫（上限 64MiB）。
 */
const DEFAULT_LOADED_ACCOUNTS_DATA_SIZE = 8 * 1024 * 1024;

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
  private signAllTransactionsByteLevel?: SignAllTransactionsByteLevel;
  private blockhashCommitment?: Commitment;
  private loopMultiTxStatus: boolean;
  /** 最近一次 addCustomComputeBudget 傳入的設定；供 buildV1 取回（v1 的 compute budget 走 config mask 而非指令） */
  private computeBudgetConfig?: ComputeBudgetConfig;

  constructor(params: TxBuilderInit) {
    this.connection = params.connection;
    this.feePayer = params.feePayer;
    this.signAllTransactions = params.signAllTransactions;
    this.signAllTransactionsByteLevel = params.signAllTransactionsByteLevel;
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
    return {
      instructions: this.instructions,
      endInstructions: this.endInstructions,
      signers: this.signers,
      instructionTypes: this.instructionTypes,
      endInstructionTypes: this.endInstructionTypes,
      lookupTableAddress: this.lookupTableAddress,
    };
  }

  get allInstructions(): TransactionInstruction[] {
    return [...this.instructions, ...this.endInstructions];
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

  public addCustomComputeBudget(config?: ComputeBudgetConfig): boolean {
    if (config) {
      // 留存供 buildV1 取用：v1 交易的 compute budget（含 loadedAccountsDataSize）走 config mask，不吃指令
      this.computeBudgetConfig = config;
      const { instructions, instructionTypes } = addComputeBudget(config);
      this.instructions.unshift(...instructions);
      this.instructionTypes.unshift(...instructionTypes);
      return true;
    }
    return false;
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

  public async calComputeBudget({
    config: propConfig,
    defaultIns,
  }: {
    config?: ComputeBudgetConfig;
    defaultIns?: TransactionInstruction[];
  }): Promise<void> {
    try {
      const config = propConfig || (await this.getComputeBudgetConfig());
      if (this.addCustomComputeBudget(config)) return;
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
      // v1 沒有 ALT，故不吃 lookupTableAddress
      return (await this.buildV1({ ...(extInfo || {}) })) as unknown as MakeTxData<TxVersion.V1, O>;
    return this.build<O>(extInfo) as MakeTxData<TxVersion.LEGACY, O>;
  }

  public build<O = Record<string, any>>(extInfo?: O): MakeTxData<TxVersion.LEGACY, O> {
    const transaction = new Transaction();
    if (this.allInstructions.length) transaction.add(...this.allInstructions);
    transaction.feePayer = this.feePayer;
    if (this.owner?.signer && !this.signers.some((s) => s.publicKey.equals(this.owner!.publicKey)))
      this.signers.push(this.owner.signer);

    return {
      builder: this,
      transaction,
      signers: this.signers,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
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
   * 打包一筆 v1（2.x / kit）交易，對接 buildV1Tx。
   *
   * - keypair 路徑：owner.isKeyPair 時，把所有 signer 轉成 CryptoKeyPair 後用 2.x 簽章。
   * - 錢包路徑：需在建構 TxBuilder 時提供 signAllTransactionsByteLevel（byte-level）；
   *   臨時 signer 先部分簽，再交錢包簽 fee payer。
   *
   * ⚠️ v1 主網啟用日 2026-09-09 前，RPC 尚不接受 v1 交易；且 v1 無 ALT、compute budget
   *    走 config mask（非 instruction），此處已透過 computeUnitLimit 參數處理。
   */
  public async buildV1<O = Record<string, any>>(
    props?: O & {
      recentBlockhash?: string;
      lastValidBlockHeight?: number;
      /** compute unit 上限；未提供時 fallback 到 computeBudgetConfig / getComputeBudgetConfig().units（預設 600000） */
      computeUnitLimit?: number;
      /** v1 優先費（total lamports）；未提供時由 computeBudgetConfig.microLamports × units 換算 */
      priorityFeeLamports?: number | bigint;
      /**
       * v0 風格的 compute budget 設定；會自動換算成 v1 的 computeUnitLimit / priorityFeeLamports。
       * 優先權：明確傳入的 computeUnitLimit / priorityFeeLamports > computeBudgetConfig > getComputeBudgetConfig()
       */
      computeBudgetConfig?: ComputeBudgetConfig;
      /**
       * 是否依交易實際帳戶「量測」loadedAccountsDataSize（會多打 1~2 次 getMultipleAccountsInfo）。
       * 未開啟時走固定預設 8MB。明確指定的 loadedAccountsDataSize 仍優先於量測結果。
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

    // blockhash + lastValidBlockHeight（兩者都需要，直接取 latestBlockhash）
    let recentBlockhash = propRecentBlockhash;
    let lastValidBlockHeight = propLastValidBlockHeight;
    if (!recentBlockhash || lastValidBlockHeight === undefined) {
      const latest = await this.connection.getLatestBlockhash(this.blockhashCommitment);
      recentBlockhash = recentBlockhash ?? latest.blockhash;
      lastValidBlockHeight = lastValidBlockHeight ?? latest.lastValidBlockHeight;
    }

    // compute budget：明確參數優先，否則由 computeBudgetConfig（prop）> addCustomComputeBudget 存下的設定 > getComputeBudgetConfig() 換算
    const budgetConfig = propComputeBudgetConfig ?? this.computeBudgetConfig ?? (await this.getComputeBudgetConfig());

    // computeUnitLimit fallback：v1 無隱含預設值，缺少會使交易失敗
    const computeUnitLimit = propComputeUnitLimit ?? budgetConfig?.units ?? 600000;

    // priorityFeeLamports：v1 要 total lamports；v0 的 microLamports 為每 CU 價格，需 × units 換算（無條件進位）
    let priorityFeeLamports = propPriorityFeeLamports;
    if (priorityFeeLamports === undefined && budgetConfig?.microLamports) {
      const MICRO = BigInt(1_000_000);
      priorityFeeLamports =
        (BigInt(budgetConfig.microLamports) * BigInt(computeUnitLimit) + (MICRO - BigInt(1))) / MICRO;
    }

    if (this.owner?.signer && !this.signers.some((s) => s.publicKey.equals(this.owner!.publicKey)))
      this.signers.push(this.owner.signer);

    // loadedAccountsDataSize 優先權：明確指定 > 量測（autoLoadedAccountsDataSize）> 固定預設 8MB
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

        // keypair 路徑：自持 key，全部 signer 轉 CryptoKeyPair 後簽章
        if (this.owner?.isKeyPair) {
          const keyPairs = await signersToCryptoKeyPairs(this.signers);
          const signedTx = await signV1Transaction(transaction, keyPairs);
          const txId = notSendToRpc
            ? ""
            : await this.connection.sendEncodedTransaction(serializeV1Transaction(signedTx), { skipPreflight });
          if (sendAndConfirm && txId) await confirmTransaction(this.connection, txId);
          return { txId, signedTx };
        }

        // 錢包路徑：臨時 signer 先部分簽，再交錢包（byte-level）簽 fee payer
        if (this.signAllTransactionsByteLevel) {
          const extraSigners = this.signers.filter((s) => !s.publicKey.equals(this.feePayer));
          const partiallySigned = extraSigners.length
            ? await partialSignV1Transaction(transaction, await signersToCryptoKeyPairs(extraSigners))
            : transaction;
          const [signedTx] = await signAllV1TransactionsWithWallet(
            [partiallySigned],
            this.signAllTransactionsByteLevel,
          );
          const txId = notSendToRpc
            ? ""
            : await this.connection.sendEncodedTransaction(serializeV1Transaction(signedTx), { skipPreflight });
          if (sendAndConfirm && txId) await confirmTransaction(this.connection, txId);
          return { txId, signedTx };
        }

        throw new Error("please provide owner in keypair format or signAllTransactionsByteLevel function");
      },
      extInfo: (extInfo || {}) as O,
    };
  }

  /**
   * 打包多筆 v1（2.x / kit）交易，對接 buildV1。與 buildV0MultiTx 對應但全程走 2.x：
   * 簽章用 CryptoKeyPair / byte-level 錢包，送出用 sendEncodedTransaction(base64)。
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

        // 先取得所有已簽章交易（keypair 或 byte-level 錢包）
        let signedTxs: TransactionV1[];
        if (this.owner?.isKeyPair) {
          signedTxs = await Promise.all(
            allTransactions.map(async (tx, idx) => signV1Transaction(tx, await signersToCryptoKeyPairs(allSigners[idx]))),
          );
        } else if (this.signAllTransactionsByteLevel) {
          // 每筆先讓非 fee payer 的臨時 signer 部分簽，再交錢包批次簽 fee payer
          const partiallySigned = await Promise.all(
            allTransactions.map(async (tx, idx) => {
              const extraSigners = allSigners[idx].filter((s) => !s.publicKey.equals(this.feePayer));
              return extraSigners.length
                ? partialSignV1Transaction(tx, await signersToCryptoKeyPairs(extraSigners))
                : tx;
            }),
          );
          signedTxs = await signAllV1TransactionsWithWallet(partiallySigned, this.signAllTransactionsByteLevel);
        } else {
          throw new Error("please provide owner in keypair format or signAllTransactionsByteLevel function");
        }

        // 循序送出：每筆確認後才送下一筆，並透過 onTxUpdate 回報狀態（fire-and-forget，
        // 進度改由 onTxUpdate 的 processedTxs 提供，故立即回傳空 txIds，與 buildV0MultiTx 一致）
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

            // fallback 輪詢：用 getSignatureStatus（以簽章查詢，與交易版本無關）；
            // 不能用 getTransaction——web3.js 1.x 無法反序列化 v1 回應
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

  public async sizeCheckBuild(
    props?: Record<string, any> & { computeBudgetConfig?: ComputeBudgetConfig; splitIns?: TransactionInstruction[] },
  ): Promise<MultiTxBuildData> {
    const { splitIns = [], computeBudgetConfig, ...extInfo } = props || {};
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
        instructionQueue.length < 12 &&
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
}
