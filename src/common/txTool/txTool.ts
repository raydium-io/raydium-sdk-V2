import {
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import axios from "axios";

import { SignAllTransactions, ComputeBudgetConfig } from "@/raydium/type";
import { TxVersion } from "./txType";
import { Owner } from "../owner";
import { getRecentBlockHash, addComputeBudget, checkLegacyTxSize, checkV0TxSize, printSimulate } from "./txUtils";
import { CacheLTA, getMultipleLookupTableInfo, LOOKUP_TABLE_CACHE } from "./lookupTable";

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
  execute: () => Promise<string>;
  extInfo: T;
}

export interface TxV0BuildData<T = Record<string, any>> extends Omit<TxBuildData<T>, "transaction"> {
  builder: TxBuilder;
  transaction: VersionedTransaction;
  buildProps?: {
    lookupTableCache?: CacheLTA;
    lookupTableAddress?: string[];
  };
}

export interface ExecuteParam {
  sequentially: boolean;
  onTxUpdate?: (completeTxs: { txId: string; status: "success" | "error" | "sent" }[]) => void;
}
export interface MultiTxBuildData {
  builder: TxBuilder;
  transactions: Transaction[];
  instructionTypes: string[];
  signers: Signer[][];
  execute: (executeParams?: ExecuteParam) => Promise<string[]>;
  extInfo: Record<string, any>;
}

export interface MultiTxV0BuildData extends Omit<MultiTxBuildData, "transactions"> {
  builder: TxBuilder;
  transactions: VersionedTransaction[];
  buildProps?: {
    lookupTableCache?: CacheLTA;
    lookupTableAddress?: string[];
  };
}

export type MakeTxData<T = TxVersion.LEGACY, O = Record<string, any>> = T extends TxVersion.LEGACY
  ? TxBuildData<O>
  : TxV0BuildData<O>;

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
  }: {
    txVersion?: TxVersion;
    extInfo?: O;
  }): Promise<MakeTxData<TxVersion.LEGACY, O> | MakeTxData<TxVersion.V0, O>> {
    if (txVersion === TxVersion.V0) return (await this.buildV0(extInfo || {})) as MakeTxData<TxVersion.V0, O>;
    return this.build<O>(extInfo) as MakeTxData<TxVersion.LEGACY, O>;
  }

  public build<O = Record<string, any>>(extInfo?: O): MakeTxData<TxVersion.LEGACY, O> {
    const transaction = new Transaction();
    if (this.allInstructions.length) transaction.add(...this.allInstructions);
    transaction.feePayer = this.feePayer;

    return {
      builder: this,
      transaction,
      signers: this.signers,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (): Promise<string> => {
        const recentBlockHash = await getRecentBlockHash(this.connection);
        transaction.recentBlockhash = recentBlockHash;
        if (this.signers.length) transaction.sign(...this.signers);
        printSimulate([transaction]);
        if (this.owner?.isKeyPair) {
          return sendAndConfirmTransaction(this.connection, transaction, this.signers);
        }
        if (this.signAllTransactions) {
          const txs = await this.signAllTransactions([transaction]);
          return await this.connection.sendRawTransaction(txs[0].serialize(), { skipPreflight: true });
        }
        throw new Error("please connect wallet first");
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

    return {
      builder: this,
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
            if (allSigners[idx].length) tx.sign(...allSigners[idx]);
            return tx;
          });
          printSimulate(partialSignedTxs);
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
            await checkSendTx();
            return processedTxs.map((d) => d.txId);
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

  public async buildV0<O = Record<string, any>>(
    props?: O & {
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
    },
  ): Promise<MakeTxData<TxVersion.V0, O>> {
    const { lookupTableCache = {}, lookupTableAddress = [], ...extInfo } = props || {};
    const lookupTableAddressAccount = {
      ...LOOKUP_TABLE_CACHE,
      ...lookupTableCache,
    };
    const allLTA = Array.from(new Set<string>([...lookupTableAddress, ...this.lookupTableAddress]));
    const needCacheLTA: PublicKey[] = [];
    for (const item of allLTA) {
      if (lookupTableAddressAccount[item] === undefined) needCacheLTA.push(new PublicKey(item));
    }
    const newCacheLTA = await getMultipleLookupTableInfo({ connection: this.connection, address: needCacheLTA });
    for (const [key, value] of Object.entries(newCacheLTA)) lookupTableAddressAccount[key] = value;

    const messageV0 = new TransactionMessage({
      payerKey: this.feePayer,
      recentBlockhash: await getRecentBlockHash(this.connection),
      instructions: [...this.allInstructions],
    }).compileToV0Message(Object.values(lookupTableAddressAccount));
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign(this.signers);

    return {
      builder: this,
      transaction,
      signers: this.signers,
      instructionTypes: [...this.instructionTypes, ...this.endInstructionTypes],
      execute: async (): Promise<string> => {
        printSimulate([transaction]);
        if (this.owner?.isKeyPair) {
          transaction.sign([this.owner.signer as Signer]);
          return await this.connection.sendTransaction(transaction, { skipPreflight: true });
        }
        if (this.signAllTransactions) {
          const txs = await this.signAllTransactions<VersionedTransaction>([transaction]);
          return await this.connection.sendTransaction(txs[0], { skipPreflight: true });
        }
        throw new Error("please connect wallet first");
      },
      extInfo: (extInfo || {}) as O,
    };
  }

  public async buildV0MultiTx<T = Record<string, any>>(params: {
    extraPreBuildData?: MakeTxData<TxVersion.V0>[];
    buildProps?: T & {
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
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

    allTransactions.forEach(async (tx, idx) => {
      tx.sign(allSigners[idx]);
    });

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: allInstructionTypes,
      buildProps,
      execute: async (executeParams?: ExecuteParam): Promise<string[]> => {
        printSimulate(allTransactions);
        const { sequentially, onTxUpdate } = executeParams || {};
        if (this.owner?.isKeyPair) {
          return await Promise.all(
            allTransactions.map(async (tx) => {
              tx.sign([this.owner!.signer as Signer]);
              return await this.connection.sendTransaction(tx);
            }),
          );
        }

        if (this.signAllTransactions) {
          const signedTxs = await this.signAllTransactions(allTransactions);

          if (sequentially) {
            let i = 0;
            const processedTxs: { txId: string; status: "success" | "error" | "sent" }[] = [];
            const checkSendTx = async (): Promise<void> => {
              if (!signedTxs[i]) return;
              const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight: true });
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
              const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight: true });
              txIds.push(txId);
            }
            return txIds;
          }
        }
        throw new Error("please connect wallet first");
      },
      extInfo: buildProps || {},
    };
  }

  public async sizeCheckBuild(
    props?: Record<string, any> & { autoComputeBudget?: boolean },
  ): Promise<MultiTxBuildData> {
    const { autoComputeBudget = false, ...extInfo } = props || {};

    let computeBudgetData: { instructions: TransactionInstruction[]; instructionTypes: string[] } = {
      instructions: [],
      instructionTypes: [],
    };

    if (autoComputeBudget) {
      const computeConfig = autoComputeBudget ? await this.getComputeBudgetConfig() : undefined;
      computeBudgetData =
        autoComputeBudget && computeConfig
          ? addComputeBudget(computeConfig)
          : { instructions: [], instructionTypes: [] };
    }

    const signerKey: { [key: string]: Signer } = this.signers.reduce(
      (acc, cur) => ({ ...acc, [cur.publicKey.toBase58()]: cur }),
      {},
    );

    const allTransactions: Transaction[] = [];
    const allSigners: Signer[][] = [];

    let instructionQueue: TransactionInstruction[] = [];
    this.allInstructions.forEach((item) => {
      const _itemIns = [...instructionQueue, item];
      const _itemInsWithCompute = autoComputeBudget ? [...computeBudgetData.instructions, ..._itemIns] : _itemIns;
      const _signerStrs = new Set<string>(
        _itemIns.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signer = [..._signerStrs.values()].map((i) => new PublicKey(i));

      if (
        checkLegacyTxSize({ instructions: _itemInsWithCompute, payer: this.feePayer, signers: _signer }) ||
        checkLegacyTxSize({ instructions: _itemIns, payer: this.feePayer, signers: _signer })
      ) {
        // current ins add to queue still not exceed tx size limit
        instructionQueue.push(item);
      } else {
        if (instructionQueue.length === 0) throw Error("item ins too big");

        // if add computeBudget still not exceed tx size limit
        if (
          autoComputeBudget &&
          checkLegacyTxSize({
            instructions: [...computeBudgetData.instructions, ...instructionQueue],
            payer: this.feePayer,
            signers: _signer,
          })
        ) {
          allTransactions.push(new Transaction().add(...computeBudgetData.instructions, ...instructionQueue));
        } else {
          allTransactions.push(new Transaction().add(...instructionQueue));
        }
        allSigners.push([..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined));
        instructionQueue = [item];
      }
    });

    if (instructionQueue.length > 0) {
      const _signerStrs = new Set<string>(
        instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signers = [..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined);

      if (
        autoComputeBudget &&
        checkLegacyTxSize({
          instructions: [...computeBudgetData.instructions, ...instructionQueue],
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

    return {
      builder: this,
      transactions: allTransactions,
      signers: allSigners,
      instructionTypes: this.instructionTypes,
      execute: async (): Promise<string[]> => {
        const recentBlockHash = await getRecentBlockHash(this.connection);
        allTransactions.forEach(async (tx, idx) => {
          tx.recentBlockhash = recentBlockHash;
          tx.sign(...allSigners[idx]);
        });
        printSimulate(allTransactions);
        if (this.owner?.isKeyPair) {
          return await Promise.all(
            allTransactions.map(async (tx, idx) => {
              return await sendAndConfirmTransaction(this.connection, tx, allSigners[idx]);
            }),
          );
        }
        if (this.signAllTransactions) {
          const signedTxs = await this.signAllTransactions(allTransactions);
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

  public async sizeCheckBuildV0(
    props?: Record<string, any> & {
      autoComputeBudget?: boolean;
      lookupTableCache?: CacheLTA;
      lookupTableAddress?: string[];
    },
  ): Promise<MultiTxV0BuildData> {
    const { autoComputeBudget = false, lookupTableCache = {}, lookupTableAddress = [], ...extInfo } = props || {};
    const lookupTableAddressAccount = {
      ...LOOKUP_TABLE_CACHE,
      ...lookupTableCache,
    };
    const allLTA = Array.from(new Set<string>([...this.lookupTableAddress, ...lookupTableAddress]));
    const needCacheLTA: PublicKey[] = [];
    for (const item of allLTA) {
      if (lookupTableAddressAccount[item] === undefined) needCacheLTA.push(new PublicKey(item));
    }
    const newCacheLTA = await getMultipleLookupTableInfo({ connection: this.connection, address: needCacheLTA });
    for (const [key, value] of Object.entries(newCacheLTA)) lookupTableAddressAccount[key] = value;

    let computeBudgetData: { instructions: TransactionInstruction[]; instructionTypes: string[] } = {
      instructions: [],
      instructionTypes: [],
    };

    if (autoComputeBudget) {
      const computeConfig = autoComputeBudget ? await this.getComputeBudgetConfig() : undefined;
      computeBudgetData =
        autoComputeBudget && computeConfig
          ? addComputeBudget(computeConfig)
          : { instructions: [], instructionTypes: [] };
    }

    const blockHash = await getRecentBlockHash(this.connection);

    const signerKey: { [key: string]: Signer } = this.signers.reduce(
      (acc, cur) => ({ ...acc, [cur.publicKey.toBase58()]: cur }),
      {},
    );

    const allTransactions: VersionedTransaction[] = [];
    const allSigners: Signer[][] = [];

    let instructionQueue: TransactionInstruction[] = [];
    this.allInstructions.forEach((item) => {
      const _itemIns = [...instructionQueue, item];
      const _itemInsWithCompute = autoComputeBudget ? [...computeBudgetData.instructions, ..._itemIns] : _itemIns;
      const _signerStrs = new Set<string>(
        _itemIns.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );

      if (
        checkV0TxSize({ instructions: _itemInsWithCompute, payer: this.feePayer, lookupTableAddressAccount }) ||
        checkV0TxSize({ instructions: _itemIns, payer: this.feePayer, lookupTableAddressAccount })
      ) {
        // current ins add to queue still not exceed tx size limit
        instructionQueue.push(item);
      } else {
        if (instructionQueue.length === 0) throw Error("item ins too big");

        const lookupTableAddress: undefined | CacheLTA = {};
        for (const item of [...new Set<string>(allLTA)]) {
          if (lookupTableAddressAccount[item] !== undefined) lookupTableAddress[item] = lookupTableAddressAccount[item];
        }
        // if add computeBudget still not exceed tx size limit
        if (
          autoComputeBudget &&
          checkV0TxSize({
            instructions: [...computeBudgetData.instructions, ...instructionQueue],
            payer: this.feePayer,
            lookupTableAddressAccount,
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
        allSigners.push([..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined));
        instructionQueue = [item];
      }
    });

    if (instructionQueue.length > 0) {
      const _signerStrs = new Set<string>(
        instructionQueue.map((i) => i.keys.filter((ii) => ii.isSigner).map((ii) => ii.pubkey.toString())).flat(),
      );
      const _signers = [..._signerStrs.values()].map((i) => signerKey[i]).filter((i) => i !== undefined);

      if (
        autoComputeBudget &&
        checkV0TxSize({
          instructions: [...computeBudgetData.instructions, ...instructionQueue],
          payer: this.feePayer,
          lookupTableAddressAccount,
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

    return {
      builder: this,
      transactions: allTransactions,
      buildProps: props,
      signers: allSigners,
      instructionTypes: this.instructionTypes,
      execute: async (): Promise<string[]> => {
        allTransactions.map(async (tx, idx) => {
          tx.sign(allSigners[idx]);
        });
        printSimulate(allTransactions);
        if (this.owner?.isKeyPair) {
          return await Promise.all(
            allTransactions.map(async (tx) => {
              return await this.connection.sendTransaction(tx, { skipPreflight: true });
            }),
          );
        }
        if (this.signAllTransactions) {
          const signedTxs = await this.signAllTransactions(allTransactions);

          const txIds: string[] = [];
          for (let i = 0; i < signedTxs.length; i += 1) {
            const txId = await this.connection.sendTransaction(signedTxs[i], { skipPreflight: true });
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
