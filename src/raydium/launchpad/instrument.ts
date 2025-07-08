import { PublicKey, SystemProgram, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { publicKey, str, struct, u64, u8 } from "@/marshmallow";
import { RENT_PROGRAM_ID, METADATA_PROGRAM_ID } from "@/common";
import { getPdaCpiEvent } from "./pda";
export const anchorDataBuf = {
  initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  buyExactIn: Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]),
  buyExactOut: Buffer.from([24, 211, 116, 40, 105, 3, 153, 56]),
  sellExactIn: Buffer.from([149, 39, 222, 155, 211, 124, 152, 26]),
  sellExactOut: Buffer.from([95, 200, 71, 34, 8, 9, 11, 166]),
  createVestingAccount: Buffer.from([129, 178, 2, 13, 217, 172, 230, 218]),
  claimVestedToken: Buffer.from([49, 33, 104, 30, 189, 157, 79, 35]),

  createPlatformConfig: Buffer.from([176, 90, 196, 175, 253, 113, 220, 20]),
  claimPlatformFee: Buffer.from([156, 39, 208, 135, 76, 237, 61, 72]),
  updatePlaformConfig: Buffer.from([195, 60, 76, 129, 146, 45, 67, 143]),
};

export function initialize(
  programId: PublicKey,

  payer: PublicKey,
  creator: PublicKey,
  configId: PublicKey,
  platformId: PublicKey,
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

  curveParam: ({ type: "ConstantCurve"; totalSellA: BN } | { type: "FixedCurve" } | { type: "LinearCurve" }) & {
    migrateType: "amm" | "cpmm";
    supply: BN;
    totalFundRaisingB: BN;
  },

  totalLockedAmount: BN,
  cliffPeriod: BN,
  unlockPeriod: BN,
): TransactionInstruction {
  const dataLayout1 = struct([u8("decimals"), str("name"), str("symbol"), str("uri")]);
  const dataLayout3 = struct([u64("totalLockedAmount"), u64("cliffPeriod"), u64("unlockPeriod")]);

  const dataLayout21 = struct([u8("index"), u64("supply"), u64("totalFundRaisingB"), u8("migrateType")]);
  const dataLayout22 = struct([
    u8("index"),
    u64("supply"),
    u64("totalSellA"),
    u64("totalFundRaisingB"),
    u8("migrateType"),
  ]);

  const keys: Array<AccountMeta> = [
    { pubkey: payer, isSigner: true, isWritable: false },
    { pubkey: creator, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: platformId, isSigner: false, isWritable: false },
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
    { pubkey: getPdaCpiEvent(programId).publicKey, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  const data1 = Buffer.alloc(
    Buffer.from(name, "utf-8").length +
    Buffer.from(symbol, "utf-8").length +
    Buffer.from(uri, "utf-8").length +
    4 * 3 +
    1,
  );
  const data3 = Buffer.alloc(dataLayout3.span);
  const data2 = Buffer.alloc(curveParam.type === "ConstantCurve" ? dataLayout22.span : dataLayout21.span);

  dataLayout1.encode({ decimals, name, symbol, uri }, data1);
  if (curveParam.type === "ConstantCurve") {
    dataLayout22.encode({ index: 0, ...curveParam, migrateType: curveParam.migrateType === "amm" ? 0 : 1 }, data2);
  } else if (curveParam.type === "FixedCurve") {
    dataLayout21.encode({ index: 1, ...curveParam, migrateType: curveParam.migrateType === "amm" ? 0 : 1 }, data2);
  } else if (curveParam.type === "LinearCurve") {
    dataLayout21.encode({ index: 2, ...curveParam, migrateType: curveParam.migrateType === "amm" ? 0 : 1 }, data2);
  }

  dataLayout3.encode({ totalLockedAmount, cliffPeriod, unlockPeriod }, data3);

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.initialize, ...data1, ...data2, ...data3]),
  });
}
export function buyExactInInstruction(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  configId: PublicKey,
  platformId: PublicKey,
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
    { pubkey: platformId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },
    { pubkey: getPdaCpiEvent(programId).publicKey, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  if (shareFeeReceiver) {
    keys.push({ pubkey: shareFeeReceiver, isSigner: false, isWritable: true });
  }
  console.log({
    amountB: amountB.toString(),
    minAmountA: minAmountA.toString(),
  });
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
    data: Buffer.from([...anchorDataBuf.buyExactIn, ...data]),
  });
}

export function buyExactOutInstruction(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  configId: PublicKey,
  platformId: PublicKey,
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
  maxAmountB: BN,
  shareFeeRate?: BN,

  shareFeeReceiver?: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([u64("amountA"), u64("maxAmountB"), u64("shareFeeRate")]);

  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: platformId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },

    { pubkey: getPdaCpiEvent(programId).publicKey, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  if (shareFeeReceiver) {
    keys.push({ pubkey: shareFeeReceiver, isSigner: false, isWritable: true });
  }

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountA,
      maxAmountB,
      shareFeeRate: shareFeeRate ?? new BN(0),
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.buyExactOut, ...data]),
  });
}

export function sellExactInInstruction(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  configId: PublicKey,
  platformId: PublicKey,
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
    { pubkey: platformId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },
    { pubkey: getPdaCpiEvent(programId).publicKey, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
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
    data: Buffer.from([...anchorDataBuf.sellExactIn, ...data]),
  });
}

export function sellExactOut(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  configId: PublicKey,
  platformId: PublicKey,
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
  maxAmountA: BN,
  shareFeeRate?: BN,

  shareFeeReceiver?: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([u64("amountB"), u64("maxAmountA"), u64("shareFeeRate")]);

  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: configId, isSigner: false, isWritable: false },
    { pubkey: platformId, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: mintB, isSigner: false, isWritable: false },

    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramB, isSigner: false, isWritable: false },

    { pubkey: getPdaCpiEvent(programId).publicKey, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  if (shareFeeReceiver) {
    keys.push({ pubkey: shareFeeReceiver, isSigner: false, isWritable: true });
  }

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amountB,
      maxAmountA,
      shareFeeRate: shareFeeRate ?? new BN(0),
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.sellExactOut, ...data]),
  });
}

export function claimVestedToken(
  programId: PublicKey,

  owner: PublicKey,
  auth: PublicKey,
  poolId: PublicKey,

  vestingRecord: PublicKey,

  userTokenAccountA: PublicKey,
  vaultA: PublicKey,
  mintA: PublicKey,
  tokenProgramA: PublicKey,
): TransactionInstruction {
  const dataLayout = struct([]);

  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: vestingRecord, isSigner: false, isWritable: true },

    { pubkey: vaultA, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountA, isSigner: false, isWritable: true },

    { pubkey: mintA, isSigner: false, isWritable: false },
    { pubkey: tokenProgramA, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({}, data);

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.claimVestedToken, ...data]),
  });
}

export function createVestingAccount(
  programId: PublicKey,

  owner: PublicKey,
  beneficiary: PublicKey,
  poolId: PublicKey,

  vestingRecord: PublicKey,
  shareAmount: BN,
): TransactionInstruction {
  const dataLayout = struct([u64("shareAmount")]);

  const keys: Array<AccountMeta> = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: beneficiary, isSigner: false, isWritable: true },
    { pubkey: poolId, isSigner: false, isWritable: true },

    { pubkey: vestingRecord, isSigner: false, isWritable: true },

    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ shareAmount }, data);

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.createVestingAccount, ...data]),
  });
}

export function claimPlatformFee(
  programId: PublicKey,
  platformClaimFeeWallet: PublicKey,
  auth: PublicKey,
  poolId: PublicKey,
  platformId: PublicKey,
  vaultB: PublicKey,
  userTokenAccountB: PublicKey,
  mintB: PublicKey,
  tokenProgramB: PublicKey,
): TransactionInstruction {
  const keys: Array<AccountMeta> = [
    { pubkey: platformClaimFeeWallet, isSigner: true, isWritable: true },
    { pubkey: auth, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: platformId, isSigner: false, isWritable: true },
    { pubkey: vaultB, isSigner: false, isWritable: true },
    { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
    { pubkey: mintB, isSigner: false, isWritable: true },
    { pubkey: tokenProgramB, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: true },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: true },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data: anchorDataBuf.claimPlatformFee,
  });
}

export function createPlatformConfig(
  programId: PublicKey,

  platformAdmin: PublicKey,
  platformClaimFeeWallet: PublicKey,
  platformLockNftWallet: PublicKey,
  platformId: PublicKey,

  cpConfigId: PublicKey,

  migrateCpLockNftScale: {
    platformScale: BN;
    creatorScale: BN;
    burnScale: BN;
  },
  feeRate: BN,
  name: string,
  web: string,
  img: string,
): TransactionInstruction {
  const dataLayout = struct([
    u64("platformScale"),
    u64("creatorScale"),
    u64("burnScale"),

    u64("feeRate"),
    str("name"),
    str("web"),
    str("img"),
  ]);

  const keys: Array<AccountMeta> = [
    { pubkey: platformAdmin, isSigner: true, isWritable: true },
    { pubkey: platformClaimFeeWallet, isSigner: false, isWritable: false },
    { pubkey: platformLockNftWallet, isSigner: false, isWritable: false },
    { pubkey: platformId, isSigner: false, isWritable: true },
    { pubkey: cpConfigId, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(
    8 * 4 +
    Buffer.from(name, "utf-8").length +
    Buffer.from(web, "utf-8").length +
    Buffer.from(img, "utf-8").length +
    4 * 3,
  );
  dataLayout.encode(
    {
      platformScale: migrateCpLockNftScale.platformScale,
      creatorScale: migrateCpLockNftScale.creatorScale,
      burnScale: migrateCpLockNftScale.burnScale,
      feeRate,
      name,
      web,
      img,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.createPlatformConfig, ...data]),
  });
}

export function updatePlatformConfig(
  programId: PublicKey,

  platformAdmin: PublicKey,
  platformId: PublicKey,

  updateInfo:
    | { type: "updateClaimFeeWallet" | "updateLockNftWallet"; value: PublicKey }
    | { type: "updateFeeRate"; value: BN }
    | { type: "updateName" | "updateImg" | "updateWeb"; value: string }
    | { type: "migrateCpLockNftScale"; value: { platformScale: BN; creatorScale: BN; burnScale: BN } }
    | { type: 'updateCpConfigId', value: PublicKey }
    | {
      type: 'updateAll', value: {
        platformClaimFeeWallet: PublicKey,
        platformLockNftWallet: PublicKey,
        cpConfigId: PublicKey,
        migrateCpLockNftScale: {
          platformScale: BN,
          creatorScale: BN,
          burnScale: BN,
        },
        feeRate: BN,
        name: string,
        web: string,
        img: string,
      }
    },
): TransactionInstruction {
  const keys: Array<AccountMeta> = [
    { pubkey: platformAdmin, isSigner: true, isWritable: false },
    { pubkey: platformId, isSigner: false, isWritable: true },
  ];

  let data: Buffer;
  if (updateInfo.type === "updateClaimFeeWallet") {
    const dataLayout = struct([u8("index"), publicKey("value")]);
    data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ index: 0, value: updateInfo.value }, data);
  } else if (updateInfo.type === "updateLockNftWallet") {
    const dataLayout = struct([u8("index"), publicKey("value")]);
    data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ index: 1, value: updateInfo.value }, data);
  } else if (updateInfo.type === "migrateCpLockNftScale") {
    const dataLayout = struct([u8("index"), u64("platformScale"), u64("creatorScale"), u64("burnScale")]);
    data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ index: 2, ...updateInfo.value }, data);
  } else if (updateInfo.type === "updateFeeRate") {
    const dataLayout = struct([u8("index"), u64("value")]);
    data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ index: 3, value: updateInfo.value }, data);
  } else if (updateInfo.type === "updateImg" || updateInfo.type === "updateName" || updateInfo.type === "updateWeb") {
    const dataLayout = struct([u8("index"), str("value")]);
    data = Buffer.alloc(Buffer.from(updateInfo.value, 'utf-8').length + 4 + 1 * 1);
    if (updateInfo.type === "updateName") dataLayout.encode({ index: 4, value: updateInfo.value }, data);
    else if (updateInfo.type === "updateWeb") dataLayout.encode({ index: 5, value: updateInfo.value }, data);
    else if (updateInfo.type === "updateImg") dataLayout.encode({ index: 6, value: updateInfo.value }, data);
  } else if (updateInfo.type === 'updateCpConfigId') {
    keys.push({ pubkey: updateInfo.value, isSigner: false, isWritable: false })

    const dataLayout = struct([u8('index')])
    data = Buffer.alloc(dataLayout.span)
    dataLayout.encode({ index: 7 }, data)
  } else if (updateInfo.type === 'updateAll') {
    console.log('Please note that this update will overwrite all data in the platform account with the new data.')
    keys.push({ pubkey: updateInfo.value.cpConfigId, isSigner: false, isWritable: false })

    const dataLayout = struct([
      u8('index'),
      publicKey('platformClaimFeeWallet'),
      publicKey('platformLockNftWallet'),
      u64('platformScale'),
      u64('creatorScale'),
      u64('burnScale'),

      u64('feeRate'),
      str('name'),
      str('web'),
      str('img'),
    ])
    data = Buffer.alloc(1 + 32 + 32 + 8 * 4 + 4 * 3 + Buffer.from(updateInfo.value.name, 'utf-8').length + Buffer.from(updateInfo.value.web, 'utf-8').length + Buffer.from(updateInfo.value.img, 'utf-8').length)
    dataLayout.encode({
      index: 8,
      platformClaimFeeWallet: updateInfo.value.platformClaimFeeWallet,
      platformLockNftWallet: updateInfo.value.platformLockNftWallet,
      platformScale: updateInfo.value.migrateCpLockNftScale.platformScale,
      creatorScale: updateInfo.value.migrateCpLockNftScale.creatorScale,
      burnScale: updateInfo.value.migrateCpLockNftScale.burnScale,
      feeRate: updateInfo.value.feeRate,
      name: updateInfo.value.name,
      web: updateInfo.value.web,
      img: updateInfo.value.img,
    }, data)
  } else {
    throw Error("updateInfo params type error");
  }

  return new TransactionInstruction({
    keys,
    programId,
    data: Buffer.from([...anchorDataBuf.updatePlaformConfig, ...data]),
  });
}
