import BN from "bn.js";

import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SYSTEM_PROGRAM_ID, RENT_PROGRAM_ID, MEMO_PROGRAM_ID2, createLogger } from "@/common";

import { struct, u64 } from "@/marshmallow";
const logger = createLogger("Raydium_cpmm");
const anchorDataBuf = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  swapBaseInput: [143, 190, 90, 218, 196, 30, 51, 222],
  swapBaseOutput: [55, 217, 98, 86, 163, 74, 180, 173],
};

export function makeCreateCpmmPoolInInstruction(
  programId: PublicKey,
  creator: PublicKey,
  configId: PublicKey,
  authority: PublicKey,
  poolId: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
  lpMint: PublicKey,
  userVaultA: PublicKey,
  userVaultB: PublicKey,
  userLpAccount: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  createPoolFeeAccount: PublicKey,
  mintProgramA: PublicKey,
  mintProgramB: PublicKey,
  observationId: PublicKey,

  amountMaxA: BN,
  amountMaxB: BN,
  openTime: BN,
): TransactionInstruction {
  const dataLayout = struct([u64("amountMaxA"), u64("amountMaxB"), u64("openTime")]);

  const keys: Array<AccountMeta> = [
    { pubkey: creator, isSigner: true, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: userVaultA, isSigner: false, isWritable: true },
    { pubkey: userVaultB, isSigner: false, isWritable: true },
    { pubkey: userLpAccount, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: createPoolFeeAccount, isSigner: false, isWritable: true },
    { pubkey: observationId, isSigner: false, isWritable: true },

    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: mintProgramA, isSigner: false, isWritable: false },
    { pubkey: mintProgramB, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountMaxA,
      amountMaxB,
      openTime,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.initialize, ...data]),
  });
}

export function makeDepositCpmmInInstruction(
  programId: PublicKey,
  owner: PublicKey,
  authority: PublicKey,
  poolId: PublicKey,
  userLpAccount: PublicKey,
  userVaultA: PublicKey,
  userVaultB: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
  lpMint: PublicKey,

  lpAmount: BN,
  amountMaxA: BN,
  amountMaxB: BN,
): TransactionInstruction {
  const dataLayout = struct([u64("lpAmount"), u64("amountMaxA"), u64("amountMaxB")]);

  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: userLpAccount, isSigner: false, isWritable: true },
    { pubkey: userVaultA, isSigner: false, isWritable: true },
    { pubkey: userVaultB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
  ];

  const data = Buffer.alloc(dataLayout.span);
  logger.debug("cpmm deposit data", {
    lpAmount: lpAmount.toString(),
    amountMaxA: amountMaxA.toString(),
    amountMaxB: amountMaxB.toString(),
  });
  dataLayout.encode(
    {
      lpAmount,
      amountMaxA,
      amountMaxB,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.deposit, ...data]),
  });
}

export function makeWithdrawCpmmInInstruction(
  programId: PublicKey,
  owner: PublicKey,
  authority: PublicKey,
  poolId: PublicKey,
  userLpAccount: PublicKey,
  userVaultA: PublicKey,
  userVaultB: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey,
  lpMint: PublicKey,

  lpAmount: BN,
  amountMinA: BN,
  amountMinB: BN,
): TransactionInstruction {
  const dataLayout = struct([u64("lpAmount"), u64("amountMinA"), u64("amountMinB")]);

  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: userLpAccount, isSigner: false, isWritable: true },
    { pubkey: userVaultA, isSigner: false, isWritable: true },
    { pubkey: userVaultB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: MEMO_PROGRAM_ID2, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      lpAmount,
      amountMinA,
      amountMinB,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.withdraw, ...data]),
  });
}

export function makeSwapCpmmBaseInInInstruction(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  configId: PublicKey,
  poolId: PublicKey,
  userInputAccount: PublicKey,
  userOutputAccount: PublicKey,
  inputVault: PublicKey,
  outputVault: PublicKey,
  inputTokenProgram: PublicKey,
  outputTokenProgram: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  observationId: PublicKey,

  amountIn: BN,
  amounOutMin: BN,
): TransactionInstruction {
  const dataLayout = struct([u64("amountIn"), u64("amounOutMin")]);

  const keys: Array<AccountMeta> = [
    { pubkey: payer, isSigner: true, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: userInputAccount, isSigner: false, isWritable: true },
    { pubkey: userOutputAccount, isSigner: false, isWritable: true },
    { pubkey: inputVault, isSigner: false, isWritable: true },
    { pubkey: outputVault, isSigner: false, isWritable: true },
    { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: outputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: observationId, isSigner: false, isWritable: true },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountIn,
      amounOutMin,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.swapBaseInput, ...data]),
  });
}
export function makeSwapCpmmBaseOutInInstruction(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  configId: PublicKey,
  poolId: PublicKey,
  userInputAccount: PublicKey,
  userOutputAccount: PublicKey,
  inputVault: PublicKey,
  outputVault: PublicKey,
  inputTokenProgram: PublicKey,
  outputTokenProgram: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  observationId: PublicKey,

  amountInMax: BN,
  amountOut: BN,
): TransactionInstruction {
  const dataLayout = struct([u64("amountInMax"), u64("amountOut")]);

  const keys: Array<AccountMeta> = [
    { pubkey: payer, isSigner: true, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: userInputAccount, isSigner: false, isWritable: true },
    { pubkey: userOutputAccount, isSigner: false, isWritable: true },
    { pubkey: inputVault, isSigner: false, isWritable: true },
    { pubkey: outputVault, isSigner: false, isWritable: true },
    { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: outputTokenProgram, isSigner: false, isWritable: false },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: observationId, isSigner: false, isWritable: true },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountInMax,
      amountOut,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.swapBaseOutput, ...data]),
  });
}
