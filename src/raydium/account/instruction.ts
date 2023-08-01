import {
  createInitializeAccountInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import { BigNumberish, parseBigNumberish } from "../../common";
import { AddInstructionParam } from "../../common/txTool";
import { InstructionType } from "../../common/txType";
import { TOKEN_WSOL } from "../token_old/constant";

import { splAccountLayout } from "./layout";

export function initTokenAccountInstruction(params: {
  mint: PublicKey;
  tokenAccount: PublicKey;
  owner: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const { mint, tokenAccount, owner, programId = TOKEN_PROGRAM_ID } = params;
  return createInitializeAccountInstruction(tokenAccount, mint, owner, programId);
}

export function closeAccountInstruction(params: {
  tokenAccount: PublicKey;
  payer: PublicKey;
  multiSigners?: Signer[];
  owner: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const { tokenAccount, payer, multiSigners = [], owner, programId = TOKEN_PROGRAM_ID } = params;
  return createCloseAccountInstruction(tokenAccount, payer, owner, multiSigners, programId);
}

interface CreateWSolTokenAccount {
  connection: Connection;
  payer: PublicKey;
  owner: PublicKey;
  amount: BigNumberish;
  commitment?: Commitment;
  programId?: PublicKey;
  skipCloseAccount?: boolean;
}
/**
 * WrappedNative account = wsol account
 */
export async function createWSolAccountInstructions(params: CreateWSolTokenAccount): Promise<AddInstructionParam> {
  const { connection, amount, commitment, payer, owner, programId = TOKEN_PROGRAM_ID, skipCloseAccount } = params;

  const balanceNeeded = await connection.getMinimumBalanceForRentExemption(splAccountLayout.span, commitment);
  const lamports = parseBigNumberish(amount).add(new BN(balanceNeeded));
  const newAccount = Keypair.generate();

  return {
    signers: [newAccount],
    instructions: [
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: newAccount.publicKey,
        lamports: lamports.toNumber(),
        space: splAccountLayout.span,
        programId,
      }),
      initTokenAccountInstruction({
        mint: new PublicKey(TOKEN_WSOL.mint),
        tokenAccount: newAccount.publicKey,
        owner,
        programId,
      }),
    ],
    instructionTypes: [InstructionType.CreateAccount, InstructionType.InitAccount],
    endInstructionTypes: skipCloseAccount ? [] : [InstructionType.CloseAccount],
    endInstructions: skipCloseAccount
      ? []
      : [
          closeAccountInstruction({
            tokenAccount: newAccount.publicKey,
            payer,
            owner,
          }),
        ],
  };
}

export function makeTransferInstruction({
  source,
  destination,
  owner,
  amount,
  multiSigners = [],
  tokenProgram = TOKEN_PROGRAM_ID,
}: {
  source: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: BigNumberish;
  multiSigners?: Signer[];
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  return createTransferInstruction(
    source,
    destination,
    owner,
    parseBigNumberish(amount).toNumber(),
    multiSigners,
    tokenProgram,
  );
}
