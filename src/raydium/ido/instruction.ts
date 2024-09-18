import { PublicKey, SYSVAR_CLOCK_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CLOCK_PROGRAM_ID, RENT_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "@/common/pubKey";
import { claimLayout, purchaseLayout } from "./layout";
import {
  ClaimInstructionKeys,
  ClaimInstructionKeysV3,
  IdoClaimInstructionParams,
  PurchaseInstructionKeys,
} from "./type";

export function makePurchaseInstruction({
  programId,
  amount,
  instructionKeys,
}: {
  programId: PublicKey;
  amount: string | number;
  instructionKeys: PurchaseInstructionKeys;
}): TransactionInstruction {
  const keys = [
    // system
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLOCK_PROGRAM_ID, isSigner: false, isWritable: false },
    // pubkeys
    ...Object.entries(instructionKeys).map(([name, pubkey]) => ({
      pubkey,
      isSigner: name === "userOwner",
      isWritable: !["authority", "userOwner", "userIdoCheck", "userStakeInfo"].includes(name),
    })),
  ];

  const data = Buffer.alloc(purchaseLayout.span);
  purchaseLayout.encode({ instruction: 1, amount: Number(amount) }, data);

  return new TransactionInstruction({ keys, programId, data });
}

export function makeClaimInstruction<Version extends "" | "3" = "">(
  { programId }: { programId: PublicKey },
  instructionKeys: Version extends "3" ? ClaimInstructionKeysV3 : ClaimInstructionKeys,
): TransactionInstruction {
  const keys = [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLOCK_PROGRAM_ID, isSigner: false, isWritable: false },
    ...Object.entries(instructionKeys).map(([name, pubkey]) => ({
      pubkey,
      isSigner: name === "userOwner",
      isWritable: !["authority", "userOwner"].includes(name),
    })),
  ];

  const data = Buffer.alloc(claimLayout.span);
  claimLayout.encode({ instruction: 2 }, data);

  return new TransactionInstruction({ keys, programId, data });
}

export function makeClaimInstructionV4(params: IdoClaimInstructionParams): TransactionInstruction {
  const { poolConfig, userKeys, side } = params;

  const tokenAccount = side === "base" ? userKeys.baseTokenAccount : userKeys.quoteTokenAccount;
  const vault = side === "base" ? poolConfig.baseVault : poolConfig.quoteVault;
  const data = Buffer.alloc(claimLayout.span);
  claimLayout.encode(
    {
      instruction: 2,
    },
    data,
  );

  const keys = [
    {
      pubkey: TOKEN_PROGRAM_ID,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: SYSVAR_CLOCK_PUBKEY,
      isWritable: false,
      isSigner: false,
    },
    // ido
    {
      pubkey: poolConfig.id,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: poolConfig.authority,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: vault,
      isWritable: true,
      isSigner: false,
    },
    // user
    {
      pubkey: tokenAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: userKeys.ledgerAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: userKeys.owner,
      isWritable: false,
      isSigner: true,
    },
  ];

  return new TransactionInstruction({
    programId: poolConfig.programId,
    keys,
    data,
  });
}
