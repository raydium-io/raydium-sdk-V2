import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { FormatFarmKeyOut } from "@/api/type";
import { parseBigNumberish } from "@/common";
import { createLogger } from "@/common/logger";
import { getATAAddress } from "@/common/pda";
import {
  accountMeta,
  commonSystemAccountMeta,
  INSTRUCTION_PROGRAM_ID,
  RENT_PROGRAM_ID,
  SOLMint,
} from "@/common/pubKey";
import { InstructionType } from "@/common/txTool/txType";
import { bool, struct, u32, u64, u8 } from "../../marshmallow";
import { InstructionReturn } from "../type";
import { poolTypeV6 } from "./config";
import {
  associatedLedgerAccountLayout,
  dwLayout,
  farmAddRewardLayout,
  farmLedgerLayoutV3_2,
  farmRewardLayout,
  farmRewardRestartLayout,
  withdrawRewardLayout,
} from "./layout";
import {
  getRegistrarAddress,
  getTokenOwnerRecordAddress,
  getVoterAddress,
  getVoterWeightRecordAddress,
  getVotingMintAuthority,
  getVotingTokenMint,
} from "./pda";
import { FarmRewardInfoConfig, RewardInfoKey, RewardType } from "./type";
import { getAssociatedLedgerAccount, getDepositEntryIndex } from "./util";

const logger = createLogger("Raydium_farm_instruction");

const anchorDataBuf = {
  voterStakeRegistryCreateVoter: Buffer.from([6, 24, 245, 52, 243, 255, 148, 25]), // CreateVoter
  voterStakeRegistryCreateDepositEntry: Buffer.from([185, 131, 167, 186, 159, 125, 19, 67]), // CreateDepositEntry
  voterStakeRegistryDeposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]), // Deposit
  voterStakeRegistryWithdraw: Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]), // Withdraw
  voterStakeRegistryUpdateVoterWeightRecord: Buffer.from([45, 185, 3, 36, 109, 190, 115, 169]), // UpdateVoterWeightRecord
};

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
  farmId: PublicKey;
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
    accountMeta({ pubkey: params.farmId }),
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

export function voterStakeRegistryDeposit(
  programId: PublicKey,
  registrar: PublicKey,
  voter: PublicKey,
  voterVault: PublicKey,
  depositToken: PublicKey,
  depositAuthority: PublicKey,

  userStakerInfoV2: PublicKey,
  pool: PublicKey,
  votingMint: PublicKey,
  votingMintAuthority: PublicKey,
  stakeProgramId: PublicKey,

  depositEntryIndex: number,
  amount: BN,
): TransactionInstruction {
  const dataLayout = struct([u8("depositEntryIndex"), u64("amount")]);

  const keys = [
    { pubkey: registrar, isSigner: false, isWritable: false },
    { pubkey: voter, isSigner: false, isWritable: true },
    { pubkey: voterVault, isSigner: false, isWritable: true },
    { pubkey: depositToken, isSigner: false, isWritable: true },
    { pubkey: depositAuthority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },

    { pubkey: userStakerInfoV2, isSigner: false, isWritable: true },
    { pubkey: pool, isSigner: false, isWritable: false },
    { pubkey: votingMint, isSigner: false, isWritable: true },

    { pubkey: votingMintAuthority, isSigner: false, isWritable: false },
    { pubkey: stakeProgramId, isSigner: false, isWritable: false },
    { pubkey: INSTRUCTION_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      depositEntryIndex,
      amount,
    },
    data,
  );
  const aData = Buffer.from([...anchorDataBuf.voterStakeRegistryDeposit, ...data]);

  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}

export function voterStakeRegistryUpdateVoterWeightRecord(
  programId: PublicKey,
  registrar: PublicKey,
  voter: PublicKey,
  voterWeightRecord: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([]);

  const keys = [
    { pubkey: registrar, isSigner: false, isWritable: false },
    { pubkey: voter, isSigner: false, isWritable: false },
    { pubkey: voterWeightRecord, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({}, data);
  const aData = Buffer.from([...anchorDataBuf.voterStakeRegistryUpdateVoterWeightRecord, ...data]);

  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}

export function voterStakeRegistryWithdraw(
  programId: PublicKey,
  registrar: PublicKey,
  voter: PublicKey,
  voterAuthority: PublicKey,
  tokenOwnerRecord: PublicKey,
  voterWeightRecord: PublicKey,
  vault: PublicKey,
  destination: PublicKey,

  userStakerInfoV2: PublicKey,
  pool: PublicKey,
  votingMint: PublicKey,
  votingMintAuthority: PublicKey,
  stakeProgramId: PublicKey,

  depositEntryIndex: number,
  amount: BN,
): TransactionInstruction {
  const dataLayout = struct([u8("depositEntryIndex"), u64("amount")]);

  const keys = [
    { pubkey: registrar, isSigner: false, isWritable: false },
    { pubkey: voter, isSigner: false, isWritable: true },
    { pubkey: voterAuthority, isSigner: true, isWritable: false },
    { pubkey: tokenOwnerRecord, isSigner: false, isWritable: false },

    { pubkey: voterWeightRecord, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },

    { pubkey: userStakerInfoV2, isSigner: false, isWritable: true },
    { pubkey: pool, isSigner: false, isWritable: false },
    { pubkey: votingMint, isSigner: false, isWritable: true },

    { pubkey: votingMintAuthority, isSigner: false, isWritable: false },
    { pubkey: stakeProgramId, isSigner: false, isWritable: false },
    { pubkey: INSTRUCTION_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      depositEntryIndex,
      amount,
    },
    data,
  );
  const aData = Buffer.from([...anchorDataBuf.voterStakeRegistryWithdraw, ...data]);

  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}

export function governanceCreateTokenOwnerRecord(
  programId: PublicKey,
  realm: PublicKey,
  governingTokenOwner: PublicKey,
  governingTokenMint: PublicKey,
  payer: PublicKey,
  tokenOwnerRecordAddress: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([u8("ins")]);

  const keys = [
    { pubkey: realm, isSigner: false, isWritable: false },
    { pubkey: governingTokenOwner, isSigner: false, isWritable: false },

    { pubkey: tokenOwnerRecordAddress, isSigner: false, isWritable: true },

    { pubkey: governingTokenMint, isSigner: false, isWritable: false },

    { pubkey: payer, isSigner: true, isWritable: true },

    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ ins: 23 }, data);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export function voterStakeRegistryCreateVoter(
  programId: PublicKey,
  registrar: PublicKey,
  voter: PublicKey,
  voterWeightRecord: PublicKey,
  voterAuthority: PublicKey,
  payer: PublicKey,

  voterBump: number,
  voterWeightRecordBump: number,
): TransactionInstruction {
  const dataLayout = struct([u8("voterBump"), u8("voterWeightRecordBump")]);

  const keys = [
    { pubkey: registrar, isSigner: false, isWritable: false },
    { pubkey: voter, isSigner: false, isWritable: true },
    { pubkey: voterAuthority, isSigner: true, isWritable: false },
    { pubkey: voterWeightRecord, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: INSTRUCTION_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ voterBump, voterWeightRecordBump }, data);
  const aData = Buffer.from([...anchorDataBuf.voterStakeRegistryCreateVoter, ...data]);

  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}

export function voterStakeRegistryCreateDepositEntry(
  programId: PublicKey,
  registrar: PublicKey,
  voter: PublicKey,
  voterVault: PublicKey,
  voterAuthority: PublicKey,
  payer: PublicKey,
  depositMint: PublicKey,

  depositEntryIndex: number,
  kind: number,
  startTs: BN | undefined,
  periods: number,
  allowClawback: boolean,
): TransactionInstruction {
  const dataLayout = struct([
    u8("depositEntryIndex"),
    u8("kind"),
    u8("option"),
    u64("startTs"),
    u32("periods"),
    bool("allowClawback"),
  ]);

  const keys = [
    { pubkey: registrar, isSigner: false, isWritable: false },
    { pubkey: voter, isSigner: false, isWritable: true },
    { pubkey: voterVault, isSigner: false, isWritable: true },
    { pubkey: voterAuthority, isSigner: true, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: depositMint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      depositEntryIndex,
      kind,
      option: startTs === undefined ? 0 : 1,
      startTs: startTs!,
      periods,
      allowClawback,
    },
    data,
  );
  const aData = Buffer.from([...anchorDataBuf.voterStakeRegistryCreateDepositEntry, ...data]);

  return new TransactionInstruction({
    keys,
    programId,
    data: aData,
  });
}

export async function makeDepositTokenInstruction({
  connection,
  programId,
  governanceProgramId,
  voteWeightAddinProgramId,
  realm,
  communityTokenMint,
  owner,
  poolId,
  tokenProgram,
}: {
  connection: Connection;
  programId: PublicKey;
  governanceProgramId: PublicKey;
  voteWeightAddinProgramId: PublicKey;
  realm: PublicKey;
  communityTokenMint: PublicKey;
  owner: PublicKey;
  poolId: PublicKey;
  tokenProgram?: PublicKey;
}): Promise<TransactionInstruction[]> {
  const registrar = getRegistrarAddress(voteWeightAddinProgramId, realm, communityTokenMint).publicKey;
  const ownerPda = getAssociatedLedgerAccount({ programId, poolId, owner, version: 3 });
  const ownerAccountInfo = await connection.getAccountInfo(ownerPda);
  if (ownerAccountInfo === null) {
    throw Error("user is not staker");
  }
  const ownerInfo = farmLedgerLayoutV3_2.decode(ownerAccountInfo.data);
  const mintAmount = ownerInfo.deposited.sub(ownerInfo.voteLockedBalance);
  console.log("amount", mintAmount.toString());
  if (mintAmount.eq(new BN(0))) {
    throw Error("user do not has new stake amount");
  }

  const votingMint = getVotingTokenMint(programId, poolId).publicKey;
  const votingMintAuthority = getVotingMintAuthority(programId, poolId).publicKey;
  const { publicKey: voter, nonce: voterBump } = getVoterAddress(voteWeightAddinProgramId, registrar, owner);
  const voterVault = getATAAddress(voter, votingMint, tokenProgram).publicKey;

  const { publicKey: voterWeightRecord, nonce: voterWeightRecordBump } = getVoterWeightRecordAddress(
    voteWeightAddinProgramId,
    registrar,
    owner,
  );

  const tokenOwnerRecordAddress = getTokenOwnerRecordAddress(
    governanceProgramId,
    realm,
    communityTokenMint,
    owner,
  ).publicKey;

  const instructions: TransactionInstruction[] = [];

  const depositToken = getATAAddress(owner, votingMint, tokenProgram).publicKey;
  const depositTokenAccountInfo = await connection.getAccountInfo(depositToken);
  if (depositTokenAccountInfo === null) {
    instructions.push(createAssociatedTokenAccountInstruction(owner, depositToken, owner, votingMint));
  }
  const voterAccountInfo = await connection.getAccountInfo(voter);
  if (voterAccountInfo === null) {
    const createTokenOwnerRecodeIns = governanceCreateTokenOwnerRecord(
      governanceProgramId,
      realm,
      owner,
      communityTokenMint,
      owner,
      tokenOwnerRecordAddress,
    );

    instructions.push(
      createTokenOwnerRecodeIns,
      voterStakeRegistryCreateVoter(
        voteWeightAddinProgramId,
        registrar,
        voter,
        voterWeightRecord,
        owner,
        owner,
        voterBump,
        voterWeightRecordBump,
      ),
    );
  }

  const { index: depositEntryIndex, isInit: depositEntryInit } = await getDepositEntryIndex(
    connection,
    registrar,
    voter,
    votingMint,
  );
  if (!depositEntryInit) {
    instructions.push(
      voterStakeRegistryCreateDepositEntry(
        voteWeightAddinProgramId,
        registrar,
        voter,
        voterVault,
        owner,
        owner,
        votingMint,

        depositEntryIndex,
        0,
        undefined,
        0,
        false,
      ),
    );
  }

  instructions.push(
    voterStakeRegistryDeposit(
      voteWeightAddinProgramId,
      registrar,
      voter,
      voterVault,
      depositToken,
      owner,

      ownerPda,
      poolId,
      votingMint,
      votingMintAuthority,
      programId,

      depositEntryIndex,
      mintAmount,
    ),
    voterStakeRegistryUpdateVoterWeightRecord(voteWeightAddinProgramId, registrar, voter, voterWeightRecord),
  );

  return instructions;
}

export async function makeWithdrawTokenInstruction({
  connection,
  programId,
  governanceProgramId,
  voteWeightAddinProgramId,
  realm,
  communityTokenMint,
  owner,
  poolId,
  tokenProgram,
}: {
  connection: Connection;
  programId: PublicKey;

  governanceProgramId: PublicKey;
  voteWeightAddinProgramId: PublicKey;
  realm: PublicKey;
  communityTokenMint: PublicKey;
  owner: PublicKey;
  poolId: PublicKey;
  tokenProgram?: PublicKey;
}): Promise<TransactionInstruction[]> {
  const registrar = getRegistrarAddress(voteWeightAddinProgramId, realm, communityTokenMint).publicKey;
  const ownerPda = getAssociatedLedgerAccount({ programId, poolId, owner, version: 3 });
  const ownerAccountInfo = await connection.getAccountInfo(ownerPda);
  if (ownerAccountInfo === null) {
    throw Error("user is not staker");
  }
  const ownerInfo = farmLedgerLayoutV3_2.decode(ownerAccountInfo.data);
  if (ownerInfo.voteLockedBalance.eq(new BN(0))) {
    throw Error("user has vote locked balance = 0");
  }

  const votingMint = getVotingTokenMint(programId, poolId).publicKey;
  const votingMintAuthority = getVotingMintAuthority(programId, poolId).publicKey;
  const { publicKey: voter } = getVoterAddress(voteWeightAddinProgramId, registrar, owner);
  const voterVault = getATAAddress(voter, votingMint, tokenProgram).publicKey;
  const { publicKey: voterWeightRecord } = getVoterWeightRecordAddress(voteWeightAddinProgramId, registrar, owner);

  const tokenOwnerRecordAddress = getTokenOwnerRecordAddress(
    governanceProgramId,
    realm,
    communityTokenMint,
    owner,
  ).publicKey;

  const instructions: TransactionInstruction[] = [];

  const { index: depositEntryIndex, isInit: depositEntryInit } = await getDepositEntryIndex(
    connection,
    registrar,
    voter,
    votingMint,
  );
  if (!depositEntryInit) throw Error("deposit entry index check error");

  instructions.push(
    voterStakeRegistryWithdraw(
      voteWeightAddinProgramId,
      registrar,
      voter,
      owner,
      tokenOwnerRecordAddress,
      voterWeightRecord,
      voterVault,
      getATAAddress(owner, votingMint, tokenProgram).publicKey,
      ownerPda,
      poolId,
      votingMint,
      votingMintAuthority,
      programId,

      depositEntryIndex,
      ownerInfo.voteLockedBalance,
    ),
  );

  return instructions;
}

export function makeRestartRewardInstruction({
  payer,
  rewardVault,
  userRewardTokenPub,
  farmKeys,
  rewardInfo,
}: {
  payer: PublicKey;
  rewardVault: PublicKey;
  userRewardTokenPub: PublicKey;
  farmKeys: {
    id: PublicKey;
    programId: PublicKey;
    lpVault: PublicKey;
  };
  rewardInfo: {
    openTime: number;
    endTime: number;
    perSecond: string;
  };
}): TransactionInstruction {
  const data = Buffer.alloc(farmRewardRestartLayout.span);
  farmRewardRestartLayout.encode(
    {
      instruction: 3,
      rewardReopenTime: parseBigNumberish(rewardInfo.openTime),
      rewardEndTime: parseBigNumberish(rewardInfo.endTime),
      rewardPerSecond: parseBigNumberish(rewardInfo.perSecond),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: farmKeys.id }),
    accountMeta({ pubkey: farmKeys.lpVault, isWritable: false }),
    accountMeta({ pubkey: rewardVault }),
    accountMeta({ pubkey: userRewardTokenPub! }),
    accountMeta({ pubkey: payer, isWritable: false, isSigner: true }),
  ];

  return new TransactionInstruction({ programId: farmKeys.programId, keys, data });
}

export function makeAddNewRewardInstruction({
  payer,
  userRewardTokenPub,
  farmKeys,
  rewardVault,
  rewardInfo,
}: {
  payer: PublicKey;
  userRewardTokenPub: PublicKey;
  rewardVault: PublicKey;
  farmKeys: {
    id: PublicKey;
    programId: PublicKey;
    authority: PublicKey;
  };
  rewardInfo: {
    mint: PublicKey;
    openTime: number;
    endTime: number;
    perSecond: string;
    rewardType: RewardType;
  };
}): TransactionInstruction {
  const data = Buffer.alloc(farmAddRewardLayout.span);
  farmAddRewardLayout.encode(
    {
      instruction: 4,
      isSet: new BN(1),
      rewardPerSecond: parseBigNumberish(rewardInfo.perSecond),
      rewardOpenTime: parseBigNumberish(rewardInfo.openTime),
      rewardEndTime: parseBigNumberish(rewardInfo.endTime),
      rewardType: parseBigNumberish(poolTypeV6[rewardInfo.rewardType]),
    },
    data,
  );

  const keys = [
    ...commonSystemAccountMeta,
    accountMeta({ pubkey: farmKeys.id }),
    accountMeta({ pubkey: farmKeys.authority, isWritable: false }),
    accountMeta({ pubkey: rewardInfo.mint, isWritable: false }),
    accountMeta({ pubkey: rewardVault }),
    accountMeta({ pubkey: userRewardTokenPub! }),
    accountMeta({ pubkey: payer, isWritable: false, isSigner: true }),
  ];

  return new TransactionInstruction({ programId: farmKeys.programId, keys, data });
}

export function makeDepositWithdrawInstruction(params: {
  instruction: number;
  amount: BN;
  farmInfo: { id: string; programId: string };
  farmKeys: FormatFarmKeyOut;
  lpAccount: PublicKey;
  owner: PublicKey;
  rewardAccounts: PublicKey[];
  deposit?: boolean;
  version: 3 | 5 | 6;
}): TransactionInstruction {
  const { farmInfo, farmKeys, version, lpAccount, rewardAccounts, owner, instruction, amount, deposit } = params;

  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction,
      amount,
    },
    data,
  );

  const keys =
    version === 6
      ? [
          accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
          ...(deposit ? [accountMeta({ pubkey: SystemProgram.programId, isWritable: false })] : []),
          accountMeta({ pubkey: id }),
          accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
          accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
          accountMeta({ pubkey: ledgerAddress }),
          accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
          accountMeta({ pubkey: lpAccount }),
        ]
      : [
          accountMeta({ pubkey: id }),
          accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
          accountMeta({ pubkey: ledgerAddress }),
          accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
          accountMeta({ pubkey: lpAccount }),
          accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
          accountMeta({ pubkey: rewardAccounts[0] }),
          accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[0].vault) }),
          // system
          accountMeta({ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false }),
          accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
        ];

  if (version === 5) {
    for (let index = 1; index < farmKeys.rewardInfos.length; index++) {
      keys.push(accountMeta({ pubkey: rewardAccounts[index] }));
      keys.push(accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[index].vault) }));
    }
  }

  if (version === 6) {
    for (let index = 0; index < farmKeys.rewardInfos.length; index++) {
      keys.push(accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[index].vault) }));
      keys.push(accountMeta({ pubkey: rewardAccounts[index] }));
    }
  }

  return new TransactionInstruction({ programId, keys, data });
}

interface DepositWithdrawParams {
  amount: BN;
  farmInfo: { id: string; programId: string };
  farmKeys: FormatFarmKeyOut;
  lpAccount: PublicKey;
  owner: PublicKey;
  rewardAccounts: PublicKey[];
  userAuxiliaryLedgers?: PublicKey[];
}

export function makeWithdrawInstructionV6(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version: 6,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction: 2,
      amount: parseBigNumberish(amount),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),

    accountMeta({ pubkey: id }),

    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: ledgerAddress }),
    accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: lpAccount }),
  ];

  for (let index = 0; index < farmKeys.rewardInfos.length; index++) {
    keys.push(accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[index].vault) }));
    keys.push(accountMeta({ pubkey: rewardAccounts[index] }));
  }

  return new TransactionInstruction({ programId, keys, data });
}

export function makeWithdrawInstructionV5(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount, userAuxiliaryLedgers } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version: 5,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction: 12,
      amount: parseBigNumberish(amount),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: ledgerAddress }),
    accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: lpAccount }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: rewardAccounts[0] }),
    accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[0].vault) }),
    // system
    accountMeta({ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false }),
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
  ];

  for (let index = 1; index < farmKeys.rewardInfos.length; index++) {
    keys.push(accountMeta({ pubkey: rewardAccounts[index] }));
    keys.push(accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[index].vault) }));
  }

  if (userAuxiliaryLedgers) {
    for (const auxiliaryLedger of userAuxiliaryLedgers) {
      keys.push(accountMeta({ pubkey: auxiliaryLedger }));
    }
  }

  return new TransactionInstruction({ programId, keys, data });
}

export function makeWithdrawInstructionV4(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount, userAuxiliaryLedgers } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const dataLayout = struct([u8('instruction'), u64('amount')])

  const keys = [
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: userAuxiliaryLedgers![0] }),
    accountMeta({ pubkey: owner, isSigner: true, isWritable: false }),
    accountMeta({ pubkey: lpAccount }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: rewardAccounts[0] }),
    accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[0].vault) }),
    accountMeta({ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false }),
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: rewardAccounts[1] }),
    accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[1].vault) }),
  ]

  const data = Buffer.alloc(dataLayout.span)
  dataLayout.encode(
    {
      instruction: 2,
      amount
    },
    data
  )

  return new TransactionInstruction({
    keys,
    programId,
    data
  })
}

export function makeWithdrawInstructionV3(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount, userAuxiliaryLedgers } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version: 3,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction: 11,
      amount: parseBigNumberish(amount),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: ledgerAddress }),
    accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: lpAccount }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: rewardAccounts[0] }),
    accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[0].vault) }),
    // system
    accountMeta({ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false }),
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
  ];

  if (userAuxiliaryLedgers) {
    for (const auxiliaryLedger of userAuxiliaryLedgers) {
      keys.push(accountMeta({ pubkey: auxiliaryLedger }));
    }
  }

  return new TransactionInstruction({ programId, keys, data });
}

export function makeDepositInstructionV3(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount, userAuxiliaryLedgers } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version: 3,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction: 10,
      amount: parseBigNumberish(amount),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: ledgerAddress }),
    accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: lpAccount }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: rewardAccounts[0] }),
    accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[0].vault) }),
    // system
    accountMeta({ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false }),
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
  ];

  if (userAuxiliaryLedgers) {
    for (const auxiliaryLedger of userAuxiliaryLedgers) {
      keys.push(accountMeta({ pubkey: auxiliaryLedger }));
    }
  }

  return new TransactionInstruction({ programId, keys, data });
}

export function makeDepositInstructionV5(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount, userAuxiliaryLedgers } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version: 5,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction: 11,
      amount: parseBigNumberish(amount),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: ledgerAddress }),
    accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: lpAccount }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: rewardAccounts[0] }),
    accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[0].vault) }),
    // system
    accountMeta({ pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false }),
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
  ];

  for (let index = 1; index < farmKeys.rewardInfos.length; index++) {
    keys.push(accountMeta({ pubkey: rewardAccounts[index] }));
    keys.push(accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[index].vault) }));
  }

  if (userAuxiliaryLedgers) {
    for (const auxiliaryLedger of userAuxiliaryLedgers) {
      keys.push(accountMeta({ pubkey: auxiliaryLedger }));
    }
  }

  return new TransactionInstruction({ programId, keys, data });
}

export function makeDepositInstructionV6(params: DepositWithdrawParams): TransactionInstruction {
  const { farmInfo, farmKeys, lpAccount, rewardAccounts, owner, amount } = params;
  const [programId, id] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];

  const ledgerAddress = getAssociatedLedgerAccount({
    programId,
    poolId: id,
    owner,
    version: 6,
  });

  const data = Buffer.alloc(dwLayout.span);
  dwLayout.encode(
    {
      instruction: 1,
      amount: parseBigNumberish(amount),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    accountMeta({ pubkey: id }),
    accountMeta({ pubkey: new PublicKey(farmKeys.authority), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(farmKeys.lpVault) }),
    accountMeta({ pubkey: ledgerAddress }),
    accountMeta({ pubkey: owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: lpAccount }),
  ];

  for (let index = 0; index < farmKeys.rewardInfos.length; index++) {
    keys.push(accountMeta({ pubkey: new PublicKey(farmKeys.rewardInfos[index].vault) }));
    keys.push(accountMeta({ pubkey: rewardAccounts[index] }));
  }

  return new TransactionInstruction({ programId, keys, data });
}
