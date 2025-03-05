import { PublicKey, SystemProgram, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import BN from "bn.js";
import { struct, u8, u64, u128, str } from "@/marshmallow";
import { RENT_PROGRAM_ID, METADATA_PROGRAM_ID } from "@/common";
const anchorDataBuf = {
  initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  buy: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  sell: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
};

export function initialize(
  programId: PublicKey,

  payer: PublicKey,
  creator: PublicKey,
  configId: PublicKey,
  auth: PublicKey,
  poolId: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  metadataId: PublicKey,
  tokenProgramA: PublicKey,
  tokenProgramB: PublicKey,

  decimals: number,
  name: string,
  symbol: string,
  uri: string,

  migrateType: "amm" | "cpmm",

  initPriceX64: BN,
  supply: BN,
  totalSellA: BN,
  totalFundRaisingB: BN,

  totalLockedAmount: BN,
  cliffPeriod: BN,
  unlockPeriod: BN,
): TransactionInstruction {
  const dataLayout = struct([
    u8("decimals"),
    str("name"),
    str("symbol"),
    str("uri"),
    u128("initPriceX64"),
    u64("supply"),
    u64("totalSellA"),
    u64("totalFundRaisingB"),
    u8("migrateType"),
    u64("totalLockedAmount"),
    u64("cliffPeriod"),
    u64("unlockPeriod"),
  ]);

  const keys: Array<AccountMeta> = [
    { pubkey: payer, isSigner: true, isWritable: false },
    { pubkey: creator, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: true, isWritable: true },
    { pubkey: mintB, isSigner: false, isWritable: false },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: metadataId, isSigner: false, isWritable: true },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },
    { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const data = Buffer.alloc(
    1 +
      16 +
      8 * 3 +
      4 * 3 +
      Buffer.from(name, "utf-8").length +
      Buffer.from(symbol, "utf-8").length +
      Buffer.from(uri, "utf-8").length +
      8 * 3 +
      1,
  );

  dataLayout.encode(
    {
      decimals,
      name,
      symbol,
      uri,

      migrateType: migrateType === "amm" ? 0 : 1,

      initPriceX64,
      supply,
      totalSellA,
      totalFundRaisingB,

      totalLockedAmount,
      cliffPeriod,
      unlockPeriod,
    },
    data,
  );
  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.initialize, ...data]),
  });
}
export function buyInstruction(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  configId: PublicKey,
  poolId: PublicKey,
  userTokenAccountA: PublicKey,
  userTokenAccountB: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
  tokenProgramA: PublicKey,
  tokenProgramB: PublicKey,

  amountB: BN,
  minAmountA: BN,
  shareFeeRate?: BN,

  shareFeeReceiver?: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([u64("amountB"), u64("minAmountA"), u64("shareFeeRate")]);
  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },
  ];

  if (shareFeeReceiver) {
    keys.push({ pubkey: shareFeeReceiver, isSigner: false, isWritable: true });
  }
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountB,
      minAmountA,
      shareFeeRate: shareFeeRate ?? new BN(0),
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.buy, ...data]),
  });
}
export function sellInstruction(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  configId: PublicKey,
  poolId: PublicKey,
  userTokenAccountA: PublicKey,
  userTokenAccountB: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
  tokenProgramA: PublicKey,
  tokenProgramB: PublicKey,

  amountA: BN,
  minAmountB: BN,
  shareFeeRate?: BN,

  shareFeeReceiver?: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([u64("amountA"), u64("minAmountB"), u64("shareFeeRate")]);
  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },
  ];

  if (shareFeeReceiver) {
    keys.push({ pubkey: shareFeeReceiver, isSigner: false, isWritable: true });
  }

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountA,
      minAmountB,
      shareFeeRate: shareFeeRate ?? new BN(0),
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.sell, ...data]),
  });
}
