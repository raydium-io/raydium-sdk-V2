import BN from "bn.js";

import { AccountMeta, PublicKey, TransactionInstruction, Signer, Keypair, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  MEMO_PROGRAM_ID2,
  RENT_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  createLogger,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_AUTH,
  InstructionType,
} from "@/common";
import { getCpmmPdaPoolId, getCpLockPda } from "./pda";

import { struct, u64, bool } from "@/marshmallow";
import { ReturnTypeMakeInstructions } from "@/raydium/type";
import { ApiV3PoolInfoStandardItemCpmm, CpmmKeys } from "@/api";
import { getATAAddress } from "@/common";
import { getPdaMetadataKey } from "../clmm";
import { CpmmLockExtInfo } from "./type";

const logger = createLogger("Raydium_cpmm");
const anchorDataBuf = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  swapBaseInput: [143, 190, 90, 218, 196, 30, 51, 222],
  swapBaseOutput: [55, 217, 98, 86, 163, 74, 180, 173],
  lockCpLiquidity: [216, 157, 29, 78, 38, 51, 31, 26],
  collectCpFee: [8, 30, 51, 199, 209, 184, 247, 133],
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

  const pdaPoolId = getCpmmPdaPoolId(programId, configId, mintA, mintB).publicKey;

  const keys: Array<AccountMeta> = [
    { pubkey: creator, isSigner: true, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: !poolId.equals(pdaPoolId), isWritable: true },
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

export function makeSwapCpmmBaseInInstruction(
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
export function makeSwapCpmmBaseOutInstruction(
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

export async function makeCpmmLockInstruction(props: {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys: CpmmKeys;
  ownerInfo: {
    feePayer: PublicKey;
    wallet: PublicKey;
  };
  feeNftOwner: PublicKey;

  lockProgram: PublicKey;
  lockAuthProgram: PublicKey;
  lpAmount: BN;
  withMetadata?: boolean;
  getEphemeralSigners?: (k: number) => any;
}): Promise<ReturnTypeMakeInstructions<CpmmLockExtInfo>> {
  const { ownerInfo, poolInfo, poolKeys, feeNftOwner, getEphemeralSigners } = props;

  const signers: Signer[] = [];
  const [poolId, lpMint] = [new PublicKey(poolInfo.id), new PublicKey(poolInfo.lpMint.address)];

  let nftMintAccount: PublicKey;
  if (getEphemeralSigners) {
    nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
  } else {
    const _k = Keypair.generate();
    signers.push(_k);
    nftMintAccount = _k.publicKey;
  }

  const { publicKey: nftAccount } = getATAAddress(feeNftOwner, nftMintAccount, TOKEN_PROGRAM_ID);
  const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
  const { publicKey: lockPda } = getCpLockPda(props.lockProgram, nftMintAccount);

  const { publicKey: userLpVault } = getATAAddress(ownerInfo.wallet, lpMint, TOKEN_PROGRAM_ID);
  const { publicKey: lockLpVault } = getATAAddress(props.lockAuthProgram, lpMint, TOKEN_PROGRAM_ID);

  const ins = cpmmLockPositionInstruction({
    programId: props.lockProgram,
    auth: props.lockAuthProgram,
    payer: ownerInfo.feePayer,
    liquidityOwner: ownerInfo.wallet,
    nftOwner: feeNftOwner,
    nftMint: nftMintAccount,
    nftAccount,
    poolId,
    lockPda,
    mintLp: lpMint,
    userLpVault,
    lockLpVault,
    poolVaultA: new PublicKey(poolKeys.vault.A),
    poolVaultB: new PublicKey(poolKeys.vault.B),
    metadataAccount,
    lpAmount: props.lpAmount,
    withMetadata: props.withMetadata ?? true,
  });

  return {
    address: {
      nftMint: nftMintAccount,
      nftAccount,
      metadataAccount,
      lockPda,
      userLpVault,
      lockLpVault,
    },
    instructions: [ins],
    signers,
    instructionTypes: [InstructionType.CpmmLockLp],
    lookupTableAddress: [],
  };
}

export function cpmmLockPositionInstruction({
  programId,
  auth,
  payer,
  liquidityOwner,
  nftOwner,
  nftMint,
  nftAccount,
  poolId,
  lockPda,
  mintLp,
  userLpVault,
  lockLpVault,
  poolVaultA,
  poolVaultB,
  metadataAccount,
  lpAmount,
  withMetadata,
}: {
  programId: PublicKey;
  auth: PublicKey;
  payer: PublicKey;
  liquidityOwner: PublicKey;
  nftOwner: PublicKey;
  nftMint: PublicKey;
  nftAccount: PublicKey;
  poolId: PublicKey;
  lockPda: PublicKey;
  mintLp: PublicKey;
  userLpVault: PublicKey;
  lockLpVault: PublicKey;
  poolVaultA: PublicKey;
  poolVaultB: PublicKey;
  metadataAccount: PublicKey;
  lpAmount: BN;
  withMetadata: boolean;
}): TransactionInstruction {
  const keys = [
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: liquidityOwner, isSigner: true, isWritable: false },
    { pubkey: nftOwner, isSigner: false, isWritable: false },
    { pubkey: nftMint, isSigner: true, isWritable: true },
    { pubkey: nftAccount, isSigner: false, isWritable: true },
    { pubkey: poolId, isSigner: false, isWritable: false },
    { pubkey: lockPda, isSigner: false, isWritable: true },
    { pubkey: mintLp, isSigner: false, isWritable: false },
    { pubkey: userLpVault, isSigner: false, isWritable: true },
    { pubkey: lockLpVault, isSigner: false, isWritable: true },
    { pubkey: poolVaultA, isSigner: false, isWritable: true },
    { pubkey: poolVaultB, isSigner: false, isWritable: true },
    { pubkey: metadataAccount, isSigner: false, isWritable: true },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const dataLayout = struct([u64("lpAmount"), bool("withMetadata")]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      lpAmount,
      withMetadata,
    },
    data,
  );
  const aData = Buffer.from([...anchorDataBuf.lockCpLiquidity, ...data]);
  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}

export function collectCpFeeInstruction({
  programId,
  nftOwner,
  auth,
  nftAccount,
  lockPda,
  poolId,
  mintLp,
  userVaultA,
  userVaultB,
  poolVaultA,
  poolVaultB,
  mintA,
  mintB,
  lockLpVault,
  lpFeeAmount,
  cpmmProgram,
  cpmmAuthProgram,
}: {
  programId: PublicKey;
  nftOwner: PublicKey;
  auth: PublicKey;
  nftMint: PublicKey;
  nftAccount: PublicKey;
  lockPda: PublicKey;
  poolId: PublicKey;
  mintLp: PublicKey;
  userVaultA: PublicKey;
  userVaultB: PublicKey;
  poolVaultA: PublicKey;
  poolVaultB: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  lockLpVault: PublicKey;
  lpFeeAmount: BN;
  cpmmProgram?: PublicKey;
  cpmmAuthProgram?: PublicKey;
}): TransactionInstruction {
  const keys = [
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: nftOwner, isSigner: true, isWritable: false },
    // { pubkey: nftMint, isSigner: false, isWritable: true },
    { pubkey: nftAccount, isSigner: false, isWritable: true },
    { pubkey: lockPda, isSigner: false, isWritable: true },
    { pubkey: cpmmProgram ?? CREATE_CPMM_POOL_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: cpmmAuthProgram ?? CREATE_CPMM_POOL_AUTH, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: mintLp, isSigner: false, isWritable: true },
    { pubkey: userVaultA, isSigner: false, isWritable: true },
    { pubkey: userVaultB, isSigner: false, isWritable: true },
    { pubkey: poolVaultA, isSigner: false, isWritable: true },
    { pubkey: poolVaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },
    { pubkey: lockLpVault, isSigner: false, isWritable: true },
    // { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MEMO_PROGRAM_ID2, isSigner: false, isWritable: false },
  ];
  const dataLayout = struct([u64("lpFeeAmount")]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      lpFeeAmount,
    },
    data,
  );
  const aData = Buffer.from([...anchorDataBuf.collectCpFee, ...data]);
  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}
