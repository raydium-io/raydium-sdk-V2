import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { createInitializeAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { InstructionType } from "@/common/txTool/txType";
import { struct, u16, u32, u64, u8 } from "../../marshmallow";
import { MARKET_STATE_LAYOUT_V2 } from "./layout";

type Transactions = {
  transaction: Transaction;
  signer?: Keypair[] | undefined;
  instructionTypes?: string[];
}[];

export function initializeMarket({
  programId,
  marketInfo,
}: {
  programId: PublicKey;
  marketInfo: {
    id: PublicKey;
    requestQueue: PublicKey;
    eventQueue: PublicKey;
    bids: PublicKey;
    asks: PublicKey;
    baseVault: PublicKey;
    quoteVault: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    authority?: PublicKey;
    pruneAuthority?: PublicKey;

    baseLotSize: BN;
    quoteLotSize: BN;
    feeRateBps: number;
    vaultSignerNonce: BN;
    quoteDustThreshold: BN;
  };
}): TransactionInstruction {
  const dataLayout = struct([
    u8("version"),
    u32("instruction"),
    u64("baseLotSize"),
    u64("quoteLotSize"),
    u16("feeRateBps"),
    u64("vaultSignerNonce"),
    u64("quoteDustThreshold"),
  ]);

  const keys = [
    { pubkey: marketInfo.id, isSigner: false, isWritable: true },
    { pubkey: marketInfo.requestQueue, isSigner: false, isWritable: true },
    { pubkey: marketInfo.eventQueue, isSigner: false, isWritable: true },
    { pubkey: marketInfo.bids, isSigner: false, isWritable: true },
    { pubkey: marketInfo.asks, isSigner: false, isWritable: true },
    { pubkey: marketInfo.baseVault, isSigner: false, isWritable: true },
    { pubkey: marketInfo.quoteVault, isSigner: false, isWritable: true },
    { pubkey: marketInfo.baseMint, isSigner: false, isWritable: false },
    { pubkey: marketInfo.quoteMint, isSigner: false, isWritable: false },
    // Use a dummy address if using the new dex upgrade to save tx space.
    {
      pubkey: marketInfo.authority ? marketInfo.quoteMint : SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ]
    .concat(marketInfo.authority ? { pubkey: marketInfo.authority, isSigner: false, isWritable: false } : [])
    .concat(
      marketInfo.authority && marketInfo.pruneAuthority
        ? { pubkey: marketInfo.pruneAuthority, isSigner: false, isWritable: false }
        : [],
    );

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      version: 0,
      instruction: 0,
      baseLotSize: marketInfo.baseLotSize,
      quoteLotSize: marketInfo.quoteLotSize,
      feeRateBps: marketInfo.feeRateBps,
      vaultSignerNonce: marketInfo.vaultSignerNonce,
      quoteDustThreshold: marketInfo.quoteDustThreshold,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export async function makeCreateMarketInstruction({
  connection,
  wallet,
  marketInfo,
}: {
  connection: Connection;
  wallet: PublicKey;
  marketInfo: {
    programId: PublicKey;
    id: { publicKey: PublicKey; seed: string };
    baseMint: PublicKey;
    quoteMint: PublicKey;
    baseVault: { publicKey: PublicKey; seed: string };
    quoteVault: { publicKey: PublicKey; seed: string };
    vaultOwner: PublicKey;

    requestQueue: { publicKey: PublicKey; seed: string };
    eventQueue: { publicKey: PublicKey; seed: string };
    bids: { publicKey: PublicKey; seed: string };
    asks: { publicKey: PublicKey; seed: string };

    feeRateBps: number;
    vaultSignerNonce: BN;
    quoteDustThreshold: BN;

    baseLotSize: BN;
    quoteLotSize: BN;

    requestQueueSpace?: number;
    eventQueueSpace?: number;
    orderbookQueueSpace?: number;

    lowestFeeMarket?: boolean;
  };
}): Promise<Transactions> {
  const tx1 = new Transaction();
  const accountLamports = await connection.getMinimumBalanceForRentExemption(165);
  tx1.add(
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.baseVault.seed,
      newAccountPubkey: marketInfo.baseVault.publicKey,
      lamports: accountLamports,
      space: 165,
      programId: TOKEN_PROGRAM_ID,
    }),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.quoteVault.seed,
      newAccountPubkey: marketInfo.quoteVault.publicKey,
      lamports: accountLamports,
      space: 165,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(marketInfo.baseVault.publicKey, marketInfo.baseMint, marketInfo.vaultOwner),
    createInitializeAccountInstruction(marketInfo.quoteVault.publicKey, marketInfo.quoteMint, marketInfo.vaultOwner),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.id.seed,
      newAccountPubkey: marketInfo.id.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(MARKET_STATE_LAYOUT_V2.span),
      space: MARKET_STATE_LAYOUT_V2.span,
      programId: marketInfo.programId,
    }),
  );

  const tx2 = new Transaction();
  tx2.add(
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.requestQueue.seed,
      newAccountPubkey: marketInfo.requestQueue.publicKey,
      lamports: marketInfo.lowestFeeMarket
        ? 6208320
        : await connection.getMinimumBalanceForRentExemption(marketInfo.requestQueueSpace ?? 5120 + 12),
      space: marketInfo.lowestFeeMarket ? 764 : marketInfo.requestQueueSpace ?? 5120 + 12,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.eventQueue.seed,
      newAccountPubkey: marketInfo.eventQueue.publicKey,
      lamports: marketInfo.lowestFeeMarket
        ? 79594560
        : await connection.getMinimumBalanceForRentExemption(marketInfo.eventQueueSpace ?? 262144 + 12),
      space: marketInfo.lowestFeeMarket ? 11308 : marketInfo.eventQueueSpace ?? 262144 + 12,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.bids.seed,
      newAccountPubkey: marketInfo.bids.publicKey,
      lamports: marketInfo.lowestFeeMarket
        ? 101977920
        : await connection.getMinimumBalanceForRentExemption(marketInfo.orderbookQueueSpace ?? 65536 + 12),
      space: marketInfo.lowestFeeMarket ? 14524 : marketInfo.orderbookQueueSpace ?? 65536 + 12,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      seed: marketInfo.asks.seed,
      newAccountPubkey: marketInfo.asks.publicKey,
      lamports: marketInfo.lowestFeeMarket
        ? 101977920
        : await connection.getMinimumBalanceForRentExemption(marketInfo.orderbookQueueSpace ?? 65536 + 12),
      space: marketInfo.lowestFeeMarket ? 14524 : marketInfo.orderbookQueueSpace ?? 65536 + 12,
      programId: marketInfo.programId,
    }),
    initializeMarket({
      programId: marketInfo.programId,
      marketInfo: {
        id: marketInfo.id.publicKey,
        requestQueue: marketInfo.requestQueue.publicKey,
        eventQueue: marketInfo.eventQueue.publicKey,
        bids: marketInfo.bids.publicKey,
        asks: marketInfo.asks.publicKey,
        baseVault: marketInfo.baseVault.publicKey,
        quoteVault: marketInfo.quoteVault.publicKey,
        baseMint: marketInfo.baseMint,
        quoteMint: marketInfo.quoteMint,

        baseLotSize: marketInfo.baseLotSize,
        quoteLotSize: marketInfo.quoteLotSize,
        feeRateBps: marketInfo.feeRateBps,
        vaultSignerNonce: marketInfo.vaultSignerNonce,
        quoteDustThreshold: marketInfo.quoteDustThreshold,
      },
    }),
  );

  return [
    {
      transaction: tx1,
      signer: [],
      instructionTypes: [
        InstructionType.CreateAccount,
        InstructionType.CreateAccount,
        InstructionType.InitAccount,
        InstructionType.InitAccount,
      ],
    },
    {
      transaction: tx2,
      signer: [],
      instructionTypes: [
        InstructionType.CreateAccount,
        InstructionType.CreateAccount,
        InstructionType.CreateAccount,
        InstructionType.CreateAccount,
        InstructionType.CreateAccount,
        InstructionType.InitMarket,
      ],
    },
  ];
}
