import { TransactionInstruction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createInitializeAccountInstruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { MARKET_STATE_LAYOUT_V2 } from "./layout";
import { struct, u16, u32, u64, u8 } from "../../marshmallow";

type Transactions = {
  transaction: Transaction;
  signer?: Keypair[] | undefined;
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
    id: Keypair;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    baseVault: Keypair;
    quoteVault: Keypair;
    vaultOwner: PublicKey;

    requestQueue: Keypair;
    eventQueue: Keypair;
    bids: Keypair;
    asks: Keypair;

    feeRateBps: number;
    vaultSignerNonce: BN;
    quoteDustThreshold: BN;

    baseLotSize: BN;
    quoteLotSize: BN;
  };
}): Promise<Transactions> {
  const tx1 = new Transaction();
  tx1.add(
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.baseVault.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TOKEN_PROGRAM_ID,
    }),
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.quoteVault.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(marketInfo.baseVault.publicKey, marketInfo.baseMint, marketInfo.vaultOwner),
    createInitializeAccountInstruction(marketInfo.quoteVault.publicKey, marketInfo.quoteMint, marketInfo.vaultOwner),
  );

  const tx2 = new Transaction();
  tx2.add(
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.id.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(MARKET_STATE_LAYOUT_V2.span),
      space: MARKET_STATE_LAYOUT_V2.span,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.requestQueue.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(5120 + 12),
      space: 5120 + 12,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.eventQueue.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(262144 + 12),
      space: 262144 + 12,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.bids.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
      space: 65536 + 12,
      programId: marketInfo.programId,
    }),
    SystemProgram.createAccount({
      fromPubkey: wallet,
      newAccountPubkey: marketInfo.asks.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
      space: 65536 + 12,
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
    { transaction: tx1, signer: [marketInfo.baseVault, marketInfo.quoteVault] },
    {
      transaction: tx2,
      signer: [marketInfo.id, marketInfo.requestQueue, marketInfo.eventQueue, marketInfo.bids, marketInfo.asks],
    },
  ];
}
