import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

import { createLogger } from "../../common/logger";
import { accountMeta, commonSystemAccountMeta, SOLMint } from "../../common/pubKey";
import { InstructionType } from "../../common/txType";
import { InstructionReturn } from "../type";
import { associatedLedgerAccountLayout, farmRewardLayout, withdrawRewardLayout } from "./layout";
import { FarmRewardInfoConfig, RewardInfoKey } from "./type";

const logger = createLogger("Raydium_farm_instruction");

export function createAssociatedLedgerAccountInstruction(params: {
  version: number;
  id: PublicKey;
  programId: PublicKey;
  ledger: PublicKey;
  owner: PublicKey;
}): InstructionReturn {
  const { version, id, ledger, programId, owner } = params;
  const instruction = { 3: 9, 5: 10 }[version];
  if (!instruction) logger.logWithError(`invalid farm pool version: ${version}`);

  const data = Buffer.alloc(associatedLedgerAccountLayout.span);
  associatedLedgerAccountLayout.encode(
    {
      instruction: instruction!,
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: ledger }),
    accountMeta({ pubkey: owner, isWritable: false }),
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    accountMeta({ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false }),
  ];

  return {
    instruction: new TransactionInstruction({
      programId,
      keys,
      data,
    }),
    instructionType: InstructionType.FarmV3CreateLedger,
  };
}

interface CreateFarmInstruction {
  farmKeyPair: Keypair;
  farmAuthority: PublicKey;
  lpVault: PublicKey;
  lpMint: PublicKey;
  lockVault: PublicKey;
  lockMint: PublicKey;
  lockUserAccount?: PublicKey;
  programId: PublicKey;
  owner: PublicKey;
  rewardInfo: RewardInfoKey[];
  rewardInfoConfig: FarmRewardInfoConfig[];
  nonce: number;
}
export function makeCreateFarmInstruction(params: CreateFarmInstruction): InstructionReturn {
  const data = Buffer.alloc(farmRewardLayout.span);
  farmRewardLayout.encode(
    {
      instruction: 0,
      nonce: new BN(params.nonce),
      rewardTimeInfo: params.rewardInfoConfig,
    },
    data,
  );

  const keys = [
    ...commonSystemAccountMeta,
    accountMeta({ pubkey: params.farmKeyPair.publicKey }),
    accountMeta({ pubkey: params.farmAuthority, isWritable: false }),
    accountMeta({ pubkey: params.lpVault }),
    accountMeta({ pubkey: params.lpMint, isWritable: false }),
    accountMeta({ pubkey: params.lockVault }),
    accountMeta({ pubkey: params.lockMint, isWritable: false }),
    accountMeta({ pubkey: params.lockUserAccount ?? SOLMint }),
    accountMeta({ pubkey: params.owner, isWritable: false, isSigner: true }),
  ];

  for (const item of params.rewardInfo) {
    keys.push(
      ...[
        accountMeta({ pubkey: item.rewardMint, isWritable: false }),
        accountMeta({ pubkey: item.rewardVault }),
        accountMeta({ pubkey: item.userRewardToken }),
      ],
    );
  }

  return {
    instruction: new TransactionInstruction({ programId: params.programId, keys, data }),
    instructionType: InstructionType.FarmV6Create,
  };
}

interface CreatorWithdrawFarmRewardInstruction {
  id: PublicKey;
  programId: PublicKey;
  authority: PublicKey;
  lpVault: PublicKey;
  rewardVault: PublicKey;
  userRewardToken: PublicKey;
  owner: PublicKey;
}

export function makeCreatorWithdrawFarmRewardInstruction(
  params: CreatorWithdrawFarmRewardInstruction,
): InstructionReturn {
  const data = Buffer.alloc(withdrawRewardLayout.span);
  withdrawRewardLayout.encode({ instruction: 5 }, data);

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: params.id }),
    accountMeta({ pubkey: params.authority, isWritable: false }),
    accountMeta({ pubkey: params.lpVault, isWritable: false }),
    accountMeta({ pubkey: params.rewardVault }),
    accountMeta({ pubkey: params.userRewardToken }),
    accountMeta({ pubkey: params.owner, isWritable: false, isSigner: true }),
  ];

  return {
    instruction: new TransactionInstruction({ programId: params.programId, keys, data }),
    instructionType: InstructionType.FarmV6CreatorWithdraw,
  };
}
