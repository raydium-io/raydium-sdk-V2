import { ApiV3PoolInfoConcentratedItem, ApiV3Token, ClmmKeys } from "@/api/type";
import { InstructionType, MEMO_PROGRAM_ID, METADATA_PROGRAM_ID, RENT_PROGRAM_ID, getATAAddress } from "@/common";
import { createLogger } from "@/common/logger";
import { bool, s32, struct, u128, u64, u8 } from "@/marshmallow";
import { ReturnTypeMakeInstructions } from "@/raydium/type";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Signer, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { ObservationLayout, PersonalPositionLayout } from "./layout";
import {
  getPdaExBitmapAccount,
  getPdaLockClPositionIdV2,
  getPdaLockPositionId,
  getPdaMetadataKey,
  getPdaObservationAccount,
  getPdaOperationAccount,
  getPdaPersonalPositionAddress,
  getPdaPoolId,
  getPdaPoolRewardVaultId,
  getPdaPoolVaultId,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
} from "./libraries/pda";
import {
  ClmmLockAddress,
  ClmmPoolPersonalPosition,
  ClosePositionExtInfo,
  InitRewardExtInfo,
  ManipulateLiquidityExtInfo,
  OpenPositionFromBaseExtInfo,
  OpenPositionFromLiquidityExtInfo,
} from "./type";

import { sha256 } from "js-sha256";
import { BN_ZERO } from "./libraries/constants";
import { isOverflowDefaultTickarrayBitmap } from "./libraries/tickArrayBitmap";
import { getTickArrayStartIndex } from "./libraries/tickMath";

function getAnchorByte(ixName: string): Buffer {
  const preimage = `global:${ixName}`;
  return Buffer.from(sha256.digest(preimage)).slice(0, 8);
}

ObservationLayout.span; // do not delete this line

const logger = createLogger("Raydium_Clmm");

const insId = {
  createPool: getAnchorByte("create_pool"),
  createCustomizablePool: getAnchorByte("create_customizable_pool"), // todo

  openPositionV2: getAnchorByte("open_position_v2"),
  openPositionWithToken22Nft: getAnchorByte("open_position_with_token22_nft"),
  closePosition: getAnchorByte("close_position"),
  increaseLiquidityV2: getAnchorByte("increase_liquidity_v2"),
  decreaseLiquidityV2: getAnchorByte("decrease_liquidity_v2"),

  initializeReward: getAnchorByte("initialize_reward"),
  setRewardParams: getAnchorByte("set_reward_params"),
  updateRewardInfos: getAnchorByte("update_reward_infos"),
  collectRemainingRewards: getAnchorByte("collect_remaining_rewards"),

  swapV2: getAnchorByte("swap_v2"),

  openLimitOrder: getAnchorByte("open_limit_order"), // todo
  increaseLimitOrder: getAnchorByte("increase_limit_order"), // todo
  decreaseLimitOrder: getAnchorByte("decrease_limit_order"), // todo
  settleLimitOrder: getAnchorByte("settle_limit_order"), // todo
  closeLimitOrder: getAnchorByte("close_limit_order"), // todo
};

const lockInsDataBuf = [188, 37, 179, 131, 82, 150, 84, 73];
const lockHarvestInsDataBuf = [16, 72, 250, 198, 14, 162, 212, 19];

interface CreatePoolInstruction {
  connection: Connection;
  programId: PublicKey;
  owner: PublicKey;
  mintA: ApiV3Token;
  mintB: ApiV3Token;
  ammConfigId: PublicKey;
  initialPriceX64: BN;
  forerunCreate?: boolean;
  extendMintAccount?: PublicKey[];
}

export class ClmmInstrument {
  static createPoolInstruction(
    programId: PublicKey,
    poolId: PublicKey,
    poolCreator: PublicKey,
    ammConfigId: PublicKey,
    observationId: PublicKey,
    mintA: PublicKey,
    vaultA: PublicKey,
    mintProgramIdA: PublicKey,
    mintB: PublicKey,
    vaultB: PublicKey,
    mintProgramIdB: PublicKey,
    tickArrayBitmap: PublicKey,
    sqrtPriceX64: BN,
    supperMintEx: PublicKey[] | undefined,
  ): TransactionInstruction {
    const dataLayout = struct([u128("sqrtPriceX64"), u64("startTime")]);

    const keys = [
      { pubkey: poolCreator, isSigner: true, isWritable: true },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: observationId, isSigner: false, isWritable: true },
      { pubkey: tickArrayBitmap, isSigner: false, isWritable: true },
      { pubkey: mintProgramIdA, isSigner: false, isWritable: false },
      { pubkey: mintProgramIdB, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      ...(supperMintEx ?? []).map((i) => ({ pubkey: i, isSigner: false, isWritable: false })),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ sqrtPriceX64, startTime: BN_ZERO }, data);
    const aData = Buffer.from([...insId.createPool, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static createCustomizablePoolInstruction(
    programId: PublicKey,
    poolId: PublicKey,
    poolCreator: PublicKey,
    ammConfig: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    vaultA: PublicKey,
    vaultB: PublicKey,
    observationId: PublicKey,
    tickArrayBitmap: PublicKey,
    mintProgramIdA: PublicKey,
    mintProgramIdB: PublicKey,
    sqrtPriceX64: BN,
    collectFeeOn: number, // new
    supperMintEx: PublicKey[],
    dynamicFeeConfig?: PublicKey, // new
  ): TransactionInstruction {
    const dataLayout = struct([u128("sqrtPriceX64"), u8("collectFeeOn"), bool("enableDynamicFee")]);

    const keys = [
      { pubkey: poolCreator, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: observationId, isSigner: false, isWritable: true },
      { pubkey: tickArrayBitmap, isSigner: false, isWritable: true },
      { pubkey: mintProgramIdA, isSigner: false, isWritable: false },
      { pubkey: mintProgramIdB, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      ...supperMintEx.map((i) => ({ pubkey: i, isSigner: false, isWritable: false })),
      ...(dynamicFeeConfig ? [{ pubkey: dynamicFeeConfig, isSigner: false, isWritable: false }] : []),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ sqrtPriceX64, collectFeeOn, enableDynamicFee: dynamicFeeConfig !== undefined }, data);
    const aData = Buffer.from([...insId.createCustomizablePool, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static initializeRewardInstruction(
    programId: PublicKey,
    rewardFunder: PublicKey,
    poolId: PublicKey,
    operationId: PublicKey,
    ammConfigId: PublicKey,

    funderTokenAccount: PublicKey,
    tokenProgramId: PublicKey,
    rewardTokenMint: PublicKey,
    rewardTokenVault: PublicKey,

    openTime: BN,
    endTime: BN,
    emissionsPerSecondX64: BN,
  ): TransactionInstruction {
    const dataLayout = struct([u64("openTime"), u64("endTime"), u128("emissionsPerSecondX64")]);

    const keys = [
      { pubkey: rewardFunder, isSigner: true, isWritable: true },
      { pubkey: funderTokenAccount, isSigner: false, isWritable: true },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },

      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: operationId, isSigner: false, isWritable: false },
      { pubkey: rewardTokenMint, isSigner: false, isWritable: false },
      { pubkey: rewardTokenVault, isSigner: false, isWritable: true },

      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ openTime, endTime, emissionsPerSecondX64 }, data);
    const aData = Buffer.from([...insId.initializeReward, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static updateRewardInfosInstruction(programId: PublicKey, poolId: PublicKey): TransactionInstruction {
    const keys = [{ pubkey: poolId, isSigner: false, isWritable: true }];

    const aData = Buffer.from([...insId.updateRewardInfos]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static setRewardParamsInstruction(
    programId: PublicKey,
    authority: PublicKey,
    poolId: PublicKey,
    operationId: PublicKey,
    ammConfigId: PublicKey,

    ownerTokenAccount: PublicKey,
    rewardVault: PublicKey,
    rewardMint: PublicKey,

    rewardIndex: number,
    openTime: BN,
    endTime: BN,
    emissionsPerSecondX64: BN,
  ): TransactionInstruction {
    const dataLayout = struct([u8("rewardIndex"), u128("emissionsPerSecondX64"), u64("openTime"), u64("endTime")]);

    const keys = [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: operationId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: rewardVault, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: rewardMint, isSigner: false, isWritable: true },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ rewardIndex, emissionsPerSecondX64, openTime, endTime }, data);
    const aData = Buffer.from([...insId.setRewardParams, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static closePositionInstruction(
    programId: PublicKey,
    nftOwner: PublicKey,
    positionNftMint: PublicKey,
    positionNftAccount: PublicKey,
    personalPosition: PublicKey,
    nft2022?: boolean,
  ): TransactionInstruction {
    const keys = [
      { pubkey: nftOwner, isSigner: true, isWritable: true },
      { pubkey: positionNftMint, isSigner: false, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },

      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: nft2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const aData = Buffer.from([...insId.closePosition]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static openPositionV2Instruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftMint: PublicKey,
    positionNftAccount: PublicKey,
    metadataAccount: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    personalPosition: PublicKey,
    ownerVaultA: PublicKey,
    ownerVaultB: PublicKey,
    vaultA: PublicKey,
    vaultB: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    tickLower: number,
    tickUpper: number,
    tickArrayLowerStart: number,
    tickArrayUpperStart: number,
    liquidity: BN,
    amountMaxA: BN,
    amountMaxB: BN,
    withMetadata: boolean,
    baseFlag: boolean | null,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      s32("tickLower"),
      s32("tickUpper"),
      s32("tickArrayLowerStart"),
      s32("tickArrayUpperStart"),
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      bool("withMetadata"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionNftOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: true, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: metadataAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: false },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: ownerVaultA, isSigner: false, isWritable: true },
      { pubkey: ownerVaultB, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },

      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        tickLower,
        tickUpper,
        tickArrayLowerStart,
        tickArrayUpperStart,
        liquidity,
        amountMaxA,
        amountMaxB,
        withMetadata,
        optionBaseFlag: baseFlag !== null ? 1 : 0,
        baseFlag: baseFlag ?? false,
      },
      data,
    );
    const aData = Buffer.from([...insId.openPositionV2, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static increaseLiquidityV2Instruction(
    programId: PublicKey,
    nftOwner: PublicKey,
    nftAccount: PublicKey,
    personalPosition: PublicKey,

    poolId: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    ownerVaultA: PublicKey,
    ownerVaultB: PublicKey,
    vaultA: PublicKey,
    vaultB: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,

    liquidity: BN,
    amountMaxA: BN,
    amountMaxB: BN,
    baseFlag: boolean | null,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const keys = [
      { pubkey: nftOwner, isSigner: true, isWritable: false },
      { pubkey: nftAccount, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: false },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: ownerVaultA, isSigner: false, isWritable: true },
      { pubkey: ownerVaultB, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },

      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        liquidity,
        amountMaxA,
        amountMaxB,
        optionBaseFlag: baseFlag !== null ? 1 : 0,
        baseFlag: baseFlag ?? false,
      },
      data,
    );
    const aData = Buffer.from([...insId.increaseLiquidityV2, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static decreaseLiquidityV2Instruction(
    programId: PublicKey,
    nftOwner: PublicKey,
    nftAccount: PublicKey,
    personalPosition: PublicKey,

    poolId: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    ownerVaultA: PublicKey,
    ownerVaultB: PublicKey,
    vaultA: PublicKey,
    vaultB: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    rewardAccounts: {
      poolRewardVault: PublicKey;
      ownerRewardVault: PublicKey;
      rewardMint: PublicKey;
    }[],

    liquidity: BN,
    amountMinA: BN,
    amountMinB: BN,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([u128("liquidity"), u64("amountMinA"), u64("amountMinB")]);

    const keys = [
      { pubkey: nftOwner, isSigner: true, isWritable: false },
      { pubkey: nftAccount, isSigner: false, isWritable: false },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: false },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: ownerVaultA, isSigner: false, isWritable: true },
      { pubkey: ownerVaultB, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },

      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
      ...rewardAccounts
        .map((i) => [
          { pubkey: i.poolRewardVault, isSigner: false, isWritable: true },
          { pubkey: i.ownerRewardVault, isSigner: false, isWritable: true },
          { pubkey: i.rewardMint, isSigner: false, isWritable: false },
        ])
        .flat(),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ liquidity, amountMinA, amountMinB }, data);
    const aData = Buffer.from([...insId.decreaseLiquidityV2, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static swapV2Instruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    ammConfig: PublicKey,
    inputTokenAccount: PublicKey,
    outputTokenAccount: PublicKey,
    inputVault: PublicKey,
    outputVault: PublicKey,
    inputTokenMint: PublicKey,
    outputTokenMint: PublicKey,
    tickArray: PublicKey[],
    observationId: PublicKey,
    amount: BN,
    otherAmountThreshold: BN,
    sqrtPriceLimitX64: BN,
    isBaseInput: boolean,

    tickArrayBitmapExtension?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      u64("amount"),
      u64("otherAmountThreshold"),
      u128("sqrtPriceLimitX64"),
      bool("isBaseInput"),
    ]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: outputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },
      { pubkey: observationId, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: inputTokenMint, isSigner: false, isWritable: false },
      { pubkey: outputTokenMint, isSigner: false, isWritable: false },

      ...(tickArrayBitmapExtension ? [{ pubkey: tickArrayBitmapExtension, isSigner: false, isWritable: true }] : []),
      ...tickArray.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ amount, otherAmountThreshold, sqrtPriceLimitX64, isBaseInput }, data);
    const aData = Buffer.from([...insId.swapV2, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static collectRemainingRewardsInstruction(
    programId: PublicKey,
    rewardFunder: PublicKey,
    poolId: PublicKey,
    funderTokenAccount: PublicKey,
    rewardTokenVault: PublicKey,
    rewardMint: PublicKey,
    rewardIndex: number,
  ): TransactionInstruction {
    const dataLayout = struct([u8("rewardIndex")]);

    const keys = [
      { pubkey: rewardFunder, isSigner: true, isWritable: false },
      { pubkey: funderTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: rewardTokenVault, isSigner: false, isWritable: true },
      { pubkey: rewardMint, isSigner: false, isWritable: false },

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ rewardIndex }, data);
    const aData = Buffer.from([...insId.collectRemainingRewards, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static openPositionWithToken22NftInstruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftMint: PublicKey,
    positionNftAccount: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    personalPosition: PublicKey,
    ownerVaultA: PublicKey,
    ownerVaultB: PublicKey,
    vaultA: PublicKey,
    vaultB: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    tickLower: number,
    tickUpper: number,
    tickArrayLowerStart: number,
    tickArrayUpperStart: number,
    liquidity: BN,
    amountMaxA: BN,
    amountMaxB: BN,
    withMetadata: boolean,
    baseFlag: boolean | null,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      s32("tickLower"),
      s32("tickUpper"),
      s32("tickArrayLowerStart"),
      s32("tickArrayUpperStart"),
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      bool("withMetadata"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionNftOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: true, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: false },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: ownerVaultA, isSigner: false, isWritable: true },
      { pubkey: ownerVaultB, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        tickLower,
        tickUpper,
        tickArrayLowerStart,
        tickArrayUpperStart,
        liquidity,
        amountMaxA,
        amountMaxB,
        withMetadata,
        optionBaseFlag: baseFlag !== null ? 1 : 0,
        baseFlag: baseFlag ?? false,
      },
      data,
    );
    const aData = Buffer.from([...insId.openPositionWithToken22Nft, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static openLimitOrderInstruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    tickArray: PublicKey,
    limitOrder: PublicKey,
    inputTokenAccount: PublicKey,
    inputVault: PublicKey,
    inputVaultMint: PublicKey,
    inputTokenProgram: PublicKey,
    zeroForOne: boolean,
    tickIndex: number,
    amount: BN,
  ): TransactionInstruction {
    const dataLayout = struct([bool("zeroForOne"), s32("tickIndex"), u64("amount")]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: tickArray, isSigner: false, isWritable: true },
      { pubkey: limitOrder, isSigner: false, isWritable: true },
      { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: inputVaultMint, isSigner: false, isWritable: false },
      { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ zeroForOne, tickIndex, amount }, data);
    const aData = Buffer.from([...insId.openLimitOrder, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static increaseLimitOrderInstruction(
    programId: PublicKey,
    owner: PublicKey,
    poolId: PublicKey,
    tickArray: PublicKey,
    limitOrder: PublicKey,
    inputTokenAccount: PublicKey,
    inputVault: PublicKey,
    inputVaultMint: PublicKey,
    inputTokenProgram: PublicKey,
    amount: BN,
  ): TransactionInstruction {
    const dataLayout = struct([u64("amount")]);

    const keys = [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: false },
      { pubkey: tickArray, isSigner: false, isWritable: true },
      { pubkey: limitOrder, isSigner: false, isWritable: true },
      { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: inputVaultMint, isSigner: false, isWritable: false },
      { pubkey: inputTokenProgram, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ amount }, data);
    const aData = Buffer.from([...insId.increaseLimitOrder, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static decreaseLimitOrderInstruction(
    programId: PublicKey,
    owner: PublicKey,
    poolId: PublicKey,
    tickArray: PublicKey,
    limitOrder: PublicKey,
    inputTokenAccount: PublicKey,
    outputTokenAccount: PublicKey,
    inputVault: PublicKey,
    outputVault: PublicKey,
    inputVaultMint: PublicKey,
    outputVaultMint: PublicKey,
    amount: BN,
    amountMin: BN,
    tickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([u64("amount"), u64("amountMin")]);

    const keys = [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: tickArray, isSigner: false, isWritable: true },
      { pubkey: limitOrder, isSigner: false, isWritable: true },
      { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: outputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },
      { pubkey: inputVaultMint, isSigner: false, isWritable: false },
      { pubkey: outputVaultMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ...(tickArrayBitmap ? [{ pubkey: tickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({ amount, amountMin }, data);
    const aData = Buffer.from([...insId.decreaseLimitOrder, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static settleLimitOrderInstruction(
    programId: PublicKey,
    signer: PublicKey,
    poolId: PublicKey,
    tickArray: PublicKey,
    limitOrder: PublicKey,
    outputTokenAccount: PublicKey,
    outputVault: PublicKey,
    outputVaultMint: PublicKey,
    outputTokenProgram: PublicKey,
  ): TransactionInstruction {
    const keys = [
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: tickArray, isSigner: false, isWritable: true },
      { pubkey: limitOrder, isSigner: false, isWritable: true },
      { pubkey: outputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },
      { pubkey: outputVaultMint, isSigner: false, isWritable: false },
      { pubkey: outputTokenProgram, isSigner: false, isWritable: false },
    ];

    const aData = Buffer.from([...insId.settleLimitOrder]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static closeLimitOrderInstruction(
    programId: PublicKey,
    signer: PublicKey,
    rentReceiver: PublicKey,
    limitOrder: PublicKey,
  ): TransactionInstruction {
    const keys = [
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: rentReceiver, isSigner: false, isWritable: true },
      { pubkey: limitOrder, isSigner: false, isWritable: true },
    ];

    const aData = Buffer.from([...insId.closeLimitOrder]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static createPoolInstructions(props: CreatePoolInstruction): ReturnTypeMakeInstructions<{
    poolId: PublicKey;
    observationId: PublicKey;
    exBitmapAccount: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
    mintAProgram: PublicKey;
    mintBProgram: PublicKey;
    mintAVault: PublicKey;
    mintBVault: PublicKey;
  }> {
    const { programId, owner, mintA, mintB, ammConfigId, initialPriceX64, extendMintAccount } = props;
    const [mintAAddress, mintBAddress] = [new PublicKey(mintA.address), new PublicKey(mintB.address)];
    const [mintAProgram, mintBProgram] = [
      new PublicKey(mintA.programId || TOKEN_PROGRAM_ID),
      new PublicKey(mintB.programId || TOKEN_PROGRAM_ID),
    ];

    const { publicKey: poolId } = getPdaPoolId(programId, ammConfigId, mintAAddress, mintBAddress);
    const { publicKey: observationId } = getPdaObservationAccount(programId, poolId);
    const { publicKey: mintAVault } = getPdaPoolVaultId(programId, poolId, mintAAddress);
    const { publicKey: mintBVault } = getPdaPoolVaultId(programId, poolId, mintBAddress);
    const exBitmapAccount = getPdaExBitmapAccount(programId, poolId).publicKey;

    const ins = [
      this.createPoolInstruction(
        programId,
        poolId,
        owner,
        ammConfigId,
        observationId,
        mintAAddress,
        mintAVault,
        mintAProgram,
        mintBAddress,
        mintBVault,
        mintBProgram,
        exBitmapAccount,
        initialPriceX64,
        extendMintAccount,
      ),
    ];

    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.CreateAccount, InstructionType.ClmmCreatePool],
      address: {
        poolId,
        observationId,
        exBitmapAccount,
        mintA: mintAAddress,
        mintB: mintBAddress,
        mintAProgram,
        mintBProgram,
        mintAVault,
        mintBVault,
      },
      lookupTableAddress: [],
    };
  }

  static async openPositionInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    tickLower,
    tickUpper,
    liquidity,
    amountMaxA,
    amountMaxB,
    base,
    withMetadata,
    getEphemeralSigners,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerInfo: {
      feePayer: PublicKey;
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    tickLower: number;
    tickUpper: number;
    liquidity: BN;
    amountMaxA: BN;
    amountMaxB: BN;
    base: "MintA" | "MintB" | null;
    withMetadata: "create" | "no-create";
    getEphemeralSigners?: (k: number) => any;
    nft2022?: boolean;
  }): Promise<ReturnTypeMakeInstructions> {
    const signers: Signer[] = [];
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];

    let nftMintAccount;
    if (getEphemeralSigners) {
      nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      nftMintAccount = _k.publicKey;
    }

    const tickArrayLowerStartIndex = getTickArrayStartIndex(tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = getTickArrayStartIndex(tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(programId, id, tickLower, tickUpper);

    const ins = nft2022
      ? this.openPositionWithToken22NftInstruction(
          programId,
          ownerInfo.feePayer,
          id,
          ownerInfo.wallet,
          nftMintAccount,
          positionNftAccount,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolInfo.mintA.address),
          new PublicKey(poolInfo.mintB.address),

          tickLower,
          tickUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,
          liquidity,
          amountMaxA,
          amountMaxB,
          withMetadata === "create",
          base ? base === "MintA" : base,
          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        )
      : this.openPositionV2Instruction(
          programId,
          ownerInfo.feePayer,
          id,
          ownerInfo.wallet,
          nftMintAccount,
          positionNftAccount,
          metadataAccount,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolInfo.mintA.address),
          new PublicKey(poolInfo.mintB.address),

          tickLower,
          tickUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,
          liquidity,
          amountMaxA,
          amountMaxB,
          withMetadata === "create",
          null,
          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        );

    return {
      signers,
      instructions: [ins],
      instructionTypes: [InstructionType.ClmmOpenPosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
      address: {
        nftMint: nftMintAccount,
        tickArrayLower,
        tickArrayUpper,
        positionNftAccount,
        metadataAccount,
        personalPosition,
        protocolPosition,
      },
    };
  }

  static async openPositionFromBaseInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    tickLower,
    tickUpper,
    base,
    baseAmount,
    otherAmountMax,
    liquidity,
    withMetadata,
    getEphemeralSigners,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerInfo: {
      feePayer: PublicKey;
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    tickLower: number;
    tickUpper: number;

    base: "MintA" | "MintB" | null;
    baseAmount: BN;

    otherAmountMax: BN;
    liquidity: BN;
    withMetadata: "create" | "no-create";
    getEphemeralSigners?: (k: number) => any;
    nft2022?: boolean;
  }): Promise<ReturnTypeMakeInstructions<OpenPositionFromBaseExtInfo>> {
    const signers: Signer[] = [];
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];

    let nftMintAccount: PublicKey;
    if (getEphemeralSigners) {
      nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      nftMintAccount = _k.publicKey;
    }

    const tickArrayLowerStartIndex = getTickArrayStartIndex(tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = getTickArrayStartIndex(tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(programId, id, tickLower, tickUpper);

    const ins = nft2022
      ? this.openPositionWithToken22NftInstruction(
          programId,
          ownerInfo.feePayer,
          id,
          ownerInfo.wallet,
          nftMintAccount,
          positionNftAccount,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolInfo.mintA.address),
          new PublicKey(poolInfo.mintB.address),

          tickLower,
          tickUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,

          liquidity,
          !base || base === "MintA" ? baseAmount : otherAmountMax,
          !base || base === "MintA" ? otherAmountMax : baseAmount,

          withMetadata === "create",

          base ? base === "MintA" : base,

          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        )
      : this.openPositionV2Instruction(
          programId,
          ownerInfo.feePayer,
          id,
          ownerInfo.wallet,
          nftMintAccount,
          positionNftAccount,
          metadataAccount,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolInfo.mintA.address),
          new PublicKey(poolInfo.mintB.address),

          tickLower,
          tickUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,

          BN_ZERO,
          base === "MintA" ? baseAmount : otherAmountMax,
          base === "MintA" ? otherAmountMax : baseAmount,

          withMetadata === "create",

          base === "MintA",

          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        );

    return {
      address: {
        nftMint: nftMintAccount,
        tickArrayLower,
        tickArrayUpper,
        positionNftAccount,
        metadataAccount,
        personalPosition,
        protocolPosition,
      },
      instructions: [ins],
      signers,
      instructionTypes: [InstructionType.ClmmOpenPosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static async openPositionFromLiquidityInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    tickLower,
    tickUpper,
    liquidity,
    amountMaxA,
    amountMaxB,
    base,
    withMetadata,
    getEphemeralSigners,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    tickLower: number;
    tickUpper: number;
    liquidity: BN;
    amountMaxA: BN;
    amountMaxB: BN;
    base: "MintA" | "MintB" | null;
    withMetadata: "create" | "no-create";
    getEphemeralSigners?: (k: number) => any;
    nft2022?: boolean;
  }): Promise<ReturnTypeMakeInstructions<OpenPositionFromLiquidityExtInfo["address"]>> {
    let nftMintAccount: PublicKey;
    const signers: Keypair[] = [];
    if (getEphemeralSigners) {
      nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      nftMintAccount = _k.publicKey;
    }

    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];

    const tickArrayLowerStartIndex = getTickArrayStartIndex(tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = getTickArrayStartIndex(tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(programId, id, tickLower, tickUpper);

    const ins = nft2022
      ? this.openPositionWithToken22NftInstruction(
          programId,
          ownerInfo.wallet,
          id,
          ownerInfo.wallet,
          nftMintAccount,
          positionNftAccount,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolKeys.mintA.address),
          new PublicKey(poolKeys.mintB.address),

          tickLower,
          tickUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,
          liquidity,
          amountMaxA,
          amountMaxB,
          withMetadata === "create",
          base ? base === "MintA" : base,
          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        )
      : this.openPositionV2Instruction(
          programId,
          ownerInfo.wallet,
          id,
          ownerInfo.wallet,
          nftMintAccount,
          positionNftAccount,
          metadataAccount,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolKeys.mintA.address),
          new PublicKey(poolKeys.mintB.address),

          tickLower,
          tickUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,
          liquidity,
          amountMaxA,
          amountMaxB,
          withMetadata === "create",
          null,
          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        );

    return {
      address: {
        nftMint: nftMintAccount,
        tickArrayLower,
        tickArrayUpper,
        positionNftAccount,
        metadataAccount,
        personalPosition,
        protocolPosition,
      },
      instructions: [ins],
      signers,
      instructionTypes: [InstructionType.ClmmOpenPosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static closePositionInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    ownerPosition,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerPosition: ReturnType<typeof PersonalPositionLayout.decode>;
    ownerInfo: {
      wallet: PublicKey;
    };
    nft2022?: boolean;
  }): ReturnTypeMakeInstructions<ClosePositionExtInfo["address"]> {
    const programId = new PublicKey(poolInfo.programId);
    // const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID);
    const positionNftAccount = nft2022
      ? getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_2022_PROGRAM_ID).publicKey
      : getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID).publicKey;
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, ownerPosition.nftMint);

    const ins: TransactionInstruction[] = [];
    ins.push(
      this.closePositionInstruction(
        programId,
        ownerInfo.wallet,
        ownerPosition.nftMint,
        positionNftAccount,
        personalPosition,
        nft2022,
      ),
    );

    return {
      address: {
        positionNftAccount,
        personalPosition,
      },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmClosePosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static increasePositionFromLiquidityInstructions({
    poolInfo,
    poolKeys,
    ownerPosition,
    ownerInfo,
    liquidity,
    amountMaxA,
    amountMaxB,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerPosition: ReturnType<typeof PersonalPositionLayout.decode>;

    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    liquidity: BN;
    amountMaxA: BN;
    amountMaxB: BN;
    nft2022?: boolean;
  }): ReturnTypeMakeInstructions<ManipulateLiquidityExtInfo["address"]> {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    const tickArrayLowerStartIndex = getTickArrayStartIndex(ownerPosition.tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = getTickArrayStartIndex(ownerPosition.tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID);

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      id,
      ownerPosition.tickLower,
      ownerPosition.tickUpper,
    );

    const ins = this.increaseLiquidityV2Instruction(
      programId,
      ownerInfo.wallet,
      positionNftAccount,
      personalPosition,
      id,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      new PublicKey(poolKeys.vault.A),
      new PublicKey(poolKeys.vault.B),
      new PublicKey(poolInfo.mintA.address),
      new PublicKey(poolInfo.mintB.address),

      liquidity,
      amountMaxA,
      amountMaxB,

      null,
      isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(programId, id).publicKey
        : undefined,
    );

    return {
      address: {
        tickArrayLower,
        tickArrayUpper,
        positionNftAccount,
        personalPosition,
        protocolPosition,
      },
      signers: [],
      instructions: [ins],
      instructionTypes: [InstructionType.ClmmIncreasePosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static increasePositionFromBaseInstructions({
    poolInfo,
    poolKeys,
    ownerPosition,
    ownerInfo,
    base,
    baseAmount,
    otherAmountMax,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerPosition: ClmmPoolPersonalPosition;

    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    base: "MintA" | "MintB";
    baseAmount: BN;

    otherAmountMax: BN;
    nft2022?: boolean;
  }): ReturnTypeMakeInstructions<ManipulateLiquidityExtInfo["address"]> {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    const tickArrayLowerStartIndex = getTickArrayStartIndex(ownerPosition.tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = getTickArrayStartIndex(ownerPosition.tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID);

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      id,
      ownerPosition.tickLower,
      ownerPosition.tickUpper,
    );

    return {
      address: {
        tickArrayLower,
        tickArrayUpper,
        positionNftAccount,
        personalPosition,
        protocolPosition,
      },
      instructions: [
        this.increaseLiquidityV2Instruction(
          programId,
          ownerInfo.wallet,
          positionNftAccount,
          personalPosition,
          id,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          new PublicKey(poolKeys.vault.A),
          new PublicKey(poolKeys.vault.B),
          new PublicKey(poolInfo.mintA.address),
          new PublicKey(poolInfo.mintB.address),

          BN_ZERO,
          base === "MintA" ? baseAmount : otherAmountMax,
          base === "MintA" ? otherAmountMax : baseAmount,

          base === "MintA",

          isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        ),
      ],
      signers: [],
      instructionTypes: [InstructionType.ClmmIncreasePosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static decreaseLiquidityInstructions({
    poolInfo,
    poolKeys,
    ownerPosition,
    ownerInfo,
    liquidity,
    amountMinA,
    amountMinB,
    programId,
    nft2022,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerPosition: ReturnType<typeof PersonalPositionLayout.decode>;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
      rewardAccounts: PublicKey[];
    };

    liquidity: BN;
    amountMinA: BN;
    amountMinB: BN;
    programId?: PublicKey;
    nft2022?: boolean;
  }): ReturnTypeMakeInstructions<ManipulateLiquidityExtInfo["address"]> {
    const [poolProgramId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    const tickArrayLowerStartIndex = getTickArrayStartIndex(ownerPosition.tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = getTickArrayStartIndex(ownerPosition.tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(poolProgramId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(poolProgramId, id, tickArrayUpperStartIndex);
    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, programId);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolProgramId, ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolProgramId,
      id,
      ownerPosition.tickLower,
      ownerPosition.tickUpper,
    );

    const rewardAccounts: {
      poolRewardVault: PublicKey;
      ownerRewardVault: PublicKey;
      rewardMint: PublicKey;
    }[] = [];
    for (let i = 0; i < poolInfo.rewardDefaultInfos.length; i++) {
      rewardAccounts.push({
        poolRewardVault: new PublicKey(poolKeys.rewardInfos[i].vault),
        ownerRewardVault: ownerInfo.rewardAccounts[i],
        rewardMint: new PublicKey(poolInfo.rewardDefaultInfos[i].mint.address),
      });
    }

    const ins: TransactionInstruction[] = [];
    const decreaseIns = this.decreaseLiquidityV2Instruction(
      poolProgramId,
      ownerInfo.wallet,
      positionNftAccount,
      personalPosition,
      id,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      new PublicKey(poolKeys.vault.A),
      new PublicKey(poolKeys.vault.B),
      new PublicKey(poolInfo.mintA.address),
      new PublicKey(poolInfo.mintB.address),
      rewardAccounts,

      liquidity,
      amountMinA,
      amountMinB,
      isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(poolProgramId, id).publicKey
        : undefined,
    );
    ins.push(decreaseIns);

    return {
      address: {
        tickArrayLower,
        tickArrayUpper,
        positionNftAccount,
        personalPosition,
        protocolPosition,
      },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmDecreasePosition],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static makeSwapBaseInInstructions({
    poolInfo,
    poolKeys,
    observationId,
    ownerInfo,
    inputMint,
    amountIn,
    amountOutMin,
    sqrtPriceLimitX64,
    remainingAccounts,
  }: {
    poolInfo: Pick<ApiV3PoolInfoConcentratedItem, "id" | "programId" | "mintA" | "mintB" | "config">;
    poolKeys: ClmmKeys;
    observationId: PublicKey;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    inputMint: PublicKey;
    amountIn: BN;
    amountOutMin: BN;
    sqrtPriceLimitX64: BN;

    remainingAccounts: PublicKey[];
  }): ReturnTypeMakeInstructions {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    const [mintAVault, mintBVault] = [new PublicKey(poolKeys.vault.A), new PublicKey(poolKeys.vault.B)];
    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];

    const isInputMintA = poolInfo.mintA.address === inputMint.toString();

    const ins = [
      this.swapV2Instruction(
        programId,
        ownerInfo.wallet,

        id,
        new PublicKey(poolInfo.config.id),

        isInputMintA ? ownerInfo.tokenAccountA : ownerInfo.tokenAccountB,
        isInputMintA ? ownerInfo.tokenAccountB : ownerInfo.tokenAccountA,

        isInputMintA ? mintAVault : mintBVault,
        isInputMintA ? mintBVault : mintAVault,

        isInputMintA ? mintA : mintB,
        isInputMintA ? mintB : mintA,

        remainingAccounts,
        observationId,
        amountIn,
        amountOutMin,
        sqrtPriceLimitX64,
        true,
        getPdaExBitmapAccount(programId, id).publicKey,
      ),
    ];
    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmSwapBaseIn],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
      address: {},
    };
  }

  static makeSwapBaseOutInstructions({
    poolInfo,
    poolKeys,
    observationId,
    ownerInfo,
    outputMint,
    amountOut,
    amountInMax,
    sqrtPriceLimitX64,
    remainingAccounts,
  }: {
    poolInfo: Pick<ApiV3PoolInfoConcentratedItem, "id" | "programId" | "mintA" | "mintB" | "config">;
    poolKeys: ClmmKeys;
    observationId: PublicKey;

    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    outputMint: PublicKey;

    amountOut: BN;
    amountInMax: BN;
    sqrtPriceLimitX64: BN;

    remainingAccounts: PublicKey[];
  }): ReturnTypeMakeInstructions {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    const [mintAVault, mintBVault] = [new PublicKey(poolKeys.vault.A), new PublicKey(poolKeys.vault.B)];
    const [mintA, mintB] = [new PublicKey(poolInfo.mintA.address), new PublicKey(poolInfo.mintB.address)];
    const isInputMintA = poolInfo.mintA.address === outputMint.toBase58();
    const ins = [
      this.swapV2Instruction(
        programId,
        ownerInfo.wallet,

        id,
        new PublicKey(poolInfo.config.id),

        isInputMintA ? ownerInfo.tokenAccountB : ownerInfo.tokenAccountA,
        isInputMintA ? ownerInfo.tokenAccountA : ownerInfo.tokenAccountB,

        isInputMintA ? mintBVault : mintAVault,
        isInputMintA ? mintAVault : mintBVault,

        isInputMintA ? mintB : mintA,
        isInputMintA ? mintA : mintB,

        remainingAccounts,
        observationId,
        amountOut,
        amountInMax,
        sqrtPriceLimitX64,
        false,
        getPdaExBitmapAccount(programId, id).publicKey,
      ),
    ];
    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmSwapBaseOut],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
      address: {},
    };
  }

  static initRewardInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    rewardInfo,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccount: PublicKey;
    };
    rewardInfo: {
      programId: PublicKey;
      mint: PublicKey;
      openTime: number;
      endTime: number;
      emissionsPerSecondX64: BN;
    };
  }): ReturnTypeMakeInstructions<InitRewardExtInfo["address"]> {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    const poolRewardVault = getPdaPoolRewardVaultId(programId, id, rewardInfo.mint).publicKey;
    const operationId = getPdaOperationAccount(programId).publicKey;
    const ins = [
      this.initializeRewardInstruction(
        programId,
        ownerInfo.wallet,
        id,
        operationId,
        new PublicKey(poolInfo.config.id),

        ownerInfo.tokenAccount,
        rewardInfo.programId,
        rewardInfo.mint,
        poolRewardVault,

        new BN(rewardInfo.openTime),
        new BN(rewardInfo.endTime),
        rewardInfo.emissionsPerSecondX64,
      ),
    ];
    return {
      address: { poolRewardVault, operationId },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmInitReward],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static setRewardInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    rewardInfo,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccount: PublicKey;
    };
    rewardInfo: {
      mint: PublicKey;
      openTime: number;
      endTime: number;
      emissionsPerSecondX64: BN;
    };
  }): ReturnTypeMakeInstructions {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];

    let rewardIndex: number | undefined;
    let rewardVault: PublicKey | undefined;
    let rewardMint: PublicKey | undefined;
    for (let index = 0; index < poolInfo.rewardDefaultInfos.length; index++)
      if (poolInfo.rewardDefaultInfos[index].mint.address === rewardInfo.mint.toString()) {
        rewardIndex = index;
        rewardVault = new PublicKey(poolKeys.rewardInfos[index].vault);
        rewardMint = new PublicKey(poolKeys.rewardInfos[index].mint.address);
      }

    if (rewardIndex === undefined || rewardVault === undefined)
      logger.logWithError("reward mint check error", "no reward mint", poolInfo.rewardDefaultInfos);

    const operationId = getPdaOperationAccount(programId).publicKey;

    const ins = [
      this.setRewardParamsInstruction(
        programId,
        ownerInfo.wallet,
        id,
        operationId,
        new PublicKey(poolInfo.config.id),

        ownerInfo.tokenAccount,
        rewardVault!,
        rewardMint!,

        rewardIndex!,
        new BN(rewardInfo.openTime),
        new BN(rewardInfo.endTime),
        rewardInfo.emissionsPerSecondX64,
      ),
    ];
    return {
      address: { rewardVault: rewardVault!, operationId },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmSetReward],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static collectRewardInstructions({
    poolInfo,
    poolKeys,
    ownerInfo,
    rewardMint,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccount: PublicKey;
    };
    rewardMint: PublicKey;
  }): ReturnTypeMakeInstructions {
    const [programId, id] = [new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)];
    let rewardIndex: number | undefined;
    let rewardVault: PublicKey | undefined;
    for (let index = 0; index < poolInfo.rewardDefaultInfos.length; index++)
      if (poolInfo.rewardDefaultInfos[index].mint.address === rewardMint.toString()) {
        rewardIndex = index;
        rewardVault = new PublicKey(poolKeys.rewardInfos[index].vault);
      }

    if (rewardIndex === undefined || rewardVault === undefined)
      logger.logWithError("reward mint check error", "no reward mint", poolInfo.rewardDefaultInfos);

    const ins = [
      this.collectRemainingRewardsInstruction(
        programId,
        ownerInfo.wallet,
        id,

        ownerInfo.tokenAccount,
        rewardVault!,
        rewardMint,

        rewardIndex!,
      ),
    ];
    return {
      address: { rewardVault: rewardVault! },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmCollectReward],
      lookupTableAddress: poolKeys.lookupTableAccount ? [poolKeys.lookupTableAccount] : [],
    };
  }

  static async makeLockPositions({
    programId,
    authProgramId,
    poolProgramId,
    payer,
    wallet,
    nftMint,
    nft2022,
    getEphemeralSigners,
  }: {
    programId: PublicKey;
    authProgramId: PublicKey;
    poolProgramId: PublicKey;
    wallet: PublicKey;
    payer: PublicKey;
    nftMint: PublicKey;
    nft2022?: boolean;
    getEphemeralSigners?: (k: number) => any;
  }): Promise<ReturnTypeMakeInstructions<ClmmLockAddress>> {
    const signers: Signer[] = [];
    let lockNftMint: PublicKey;
    if (getEphemeralSigners) {
      lockNftMint = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      lockNftMint = _k.publicKey;
    }

    const positionNftAccount = nft2022
      ? getATAAddress(wallet, nftMint, TOKEN_2022_PROGRAM_ID).publicKey
      : getATAAddress(wallet, nftMint, TOKEN_PROGRAM_ID).publicKey;
    const { publicKey: positionId } = getPdaPersonalPositionAddress(poolProgramId, nftMint);
    const lockPositionId = getPdaLockClPositionIdV2(programId, lockNftMint).publicKey;
    const lockNftAccount = getATAAddress(wallet, lockNftMint, TOKEN_PROGRAM_ID).publicKey;
    const metadataAccount = getPdaMetadataKey(lockNftMint).publicKey;

    const ins = ClmmInstrument.lockPositionInstructionV2({
      programId,
      auth: authProgramId,
      payer,
      positionOwner: wallet,
      lockOwner: wallet,
      positionNftAccount,
      positionId,
      lockPositionId,
      lockNftMint,
      lockNftAccount,
      metadataAccount,
      withMetadata: true,
      nft2022,

      positionNftMint: nftMint,
      authPositionNftAccount: getATAAddress(authProgramId, nftMint, nft2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)
        .publicKey,
      positionNftProgram: nft2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    });

    return {
      address: {
        positionId,
        lockPositionId,
        lockNftAccount,
        lockNftMint,
        positionNftAccount,
        metadataAccount,
      },
      instructions: [ins],
      signers,
      instructionTypes: [InstructionType.ClmmLockPosition],
      lookupTableAddress: [],
    };
  }

  static lockPositionInstructionV2({
    programId,
    auth,
    payer,
    positionOwner,
    lockOwner,
    positionNftAccount,
    positionId,
    positionNftMint,
    authPositionNftAccount,
    positionNftProgram,
    lockPositionId,
    lockNftMint,
    lockNftAccount,
    metadataAccount,
    withMetadata,
  }: {
    programId: PublicKey;
    auth: PublicKey;
    payer: PublicKey;
    positionOwner: PublicKey;
    lockOwner: PublicKey;
    positionNftAccount: PublicKey;
    positionId: PublicKey;
    positionNftMint: PublicKey;
    authPositionNftAccount: PublicKey;
    positionNftProgram: PublicKey;
    lockPositionId: PublicKey;
    lockNftMint: PublicKey;
    lockNftAccount: PublicKey;
    metadataAccount: PublicKey;
    withMetadata: boolean;
    nft2022?: boolean;
  }): TransactionInstruction {
    const keys = [
      { pubkey: auth, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionOwner, isSigner: true, isWritable: true },
      { pubkey: lockOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: positionId, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: false, isWritable: true },
      { pubkey: authPositionNftAccount, isSigner: false, isWritable: true },
      { pubkey: lockPositionId, isSigner: false, isWritable: true },
      { pubkey: lockNftMint, isSigner: true, isWritable: true },
      { pubkey: lockNftAccount, isSigner: false, isWritable: true },
      { pubkey: metadataAccount, isSigner: false, isWritable: true },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: positionNftProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    const dataLayout = struct([bool("withMetadata")]);
    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        withMetadata,
      },
      data,
    );
    const aData = Buffer.from([...lockInsDataBuf, ...data]);
    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static lockPositionInstruction({
    programId,
    authProgramId,
    poolProgramId,
    owner,
    positionNft,
  }: {
    programId: PublicKey;
    authProgramId: PublicKey;
    poolProgramId: PublicKey;
    owner: PublicKey;
    positionNft: PublicKey;
  }): TransactionInstruction {
    const { publicKey: nftAccount } = getATAAddress(owner, positionNft, TOKEN_PROGRAM_ID);
    const { publicKey: positionId } = getPdaPersonalPositionAddress(poolProgramId, positionNft);

    const keys = [
      { pubkey: authProgramId, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: nftAccount, isSigner: false, isWritable: true },
      { pubkey: positionId, isSigner: false, isWritable: false },
      { pubkey: getPdaLockPositionId(programId, positionId).publicKey, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    return new TransactionInstruction({
      keys,
      programId,
      data: Buffer.from(lockInsDataBuf),
    });
  }

  static harvestLockPositionInstruction(props: {
    poolKeys: ClmmKeys;
    programId: PublicKey;
    authProgramId: PublicKey;
    ownerPosition: ReturnType<typeof PersonalPositionLayout.decode>;
    owner: PublicKey;
    ownerRewardAccounts: PublicKey[];
    userVaultA: PublicKey;
    userVaultB: PublicKey;
  }): TransactionInstruction {
    const [poolProgramId, poolId] = [new PublicKey(props.poolKeys.programId), new PublicKey(props.poolKeys.id)];

    const tickArrayLowerStartIndex = getTickArrayStartIndex(
      props.ownerPosition.tickLower,
      props.poolKeys.config.tickSpacing,
    );
    const tickArrayUpperStartIndex = getTickArrayStartIndex(
      props.ownerPosition.tickUpper,
      props.poolKeys.config.tickSpacing,
    );
    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(poolProgramId, poolId, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(poolProgramId, poolId, tickArrayUpperStartIndex);
    const { publicKey: nftAccount } = getATAAddress(props.owner, props.ownerPosition.nftMint, TOKEN_PROGRAM_ID);
    const { publicKey: positionId } = getPdaPersonalPositionAddress(poolProgramId, props.ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolProgramId,
      poolId,
      props.ownerPosition.tickLower,
      props.ownerPosition.tickUpper,
    );

    const rewardAccounts: {
      poolRewardVault: PublicKey;
      ownerRewardVault: PublicKey;
      rewardMint: PublicKey;
    }[] = [];

    for (let i = 0; i < props.poolKeys.rewardInfos.length; i++) {
      rewardAccounts.push({
        poolRewardVault: new PublicKey(props.poolKeys.rewardInfos[i].vault),
        ownerRewardVault: props.ownerRewardAccounts[i],
        rewardMint: new PublicKey(props.poolKeys.rewardInfos[i].mint.address),
      });
    }

    const remainingAccounts = [
      ...rewardAccounts
        .map((i) => [
          { pubkey: i.poolRewardVault, isSigner: false, isWritable: true },
          { pubkey: i.ownerRewardVault, isSigner: false, isWritable: true },
          { pubkey: i.rewardMint, isSigner: false, isWritable: false },
        ])
        .flat(),
    ];

    const keys = [
      { pubkey: props.authProgramId, isSigner: false, isWritable: false },
      { pubkey: getPdaLockPositionId(props.programId, positionId).publicKey, isSigner: false, isWritable: false },
      { pubkey: poolProgramId, isSigner: false, isWritable: false },
      { pubkey: props.owner, isSigner: true, isWritable: false },
      { pubkey: nftAccount, isSigner: false, isWritable: true },
      { pubkey: positionId, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(props.poolKeys.vault.A), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(props.poolKeys.vault.B), isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: props.userVaultA, isSigner: false, isWritable: true },
      { pubkey: props.userVaultB, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(props.poolKeys.mintA.address), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(props.poolKeys.mintB.address), isSigner: false, isWritable: false },
      ...remainingAccounts,
    ];

    return new TransactionInstruction({
      keys,
      programId: props.programId,
      data: Buffer.from(lockHarvestInsDataBuf),
    });
  }

  static harvestLockPositionInstructionV2({
    programId,
    auth,
    lockPositionId,
    clmmProgram,
    lockOwner,
    lockNftMint,
    lockNftAccount,
    positionNftAccount,
    positionId,
    poolId,
    protocolPosition,
    vaultA,
    vaultB,
    tickArrayLower,
    tickArrayUpper,
    userVaultA,
    userVaultB,
    mintA,
    mintB,
    rewardAccounts,
    exTickArrayBitmap,
  }: {
    programId: PublicKey;
    auth: PublicKey;
    lockPositionId: PublicKey;
    clmmProgram: PublicKey;
    lockOwner: PublicKey;
    lockNftMint: PublicKey;
    lockNftAccount: PublicKey;
    positionNftAccount: PublicKey;
    positionId: PublicKey;
    poolId: PublicKey;
    protocolPosition: PublicKey;
    vaultA: PublicKey;
    vaultB: PublicKey;
    tickArrayLower: PublicKey;
    tickArrayUpper: PublicKey;
    userVaultA: PublicKey;
    userVaultB: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
    rewardAccounts: {
      poolRewardVault: PublicKey;
      ownerRewardVault: PublicKey;
      rewardMint: PublicKey;
    }[];

    exTickArrayBitmap?: PublicKey;
  }): TransactionInstruction {
    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
      ...rewardAccounts
        .map((i) => [
          { pubkey: i.poolRewardVault, isSigner: false, isWritable: true },
          { pubkey: i.ownerRewardVault, isSigner: false, isWritable: true },
          { pubkey: i.rewardMint, isSigner: false, isWritable: false },
        ])
        .flat(),
    ];

    const keys = [
      { pubkey: auth, isSigner: false, isWritable: false },
      { pubkey: lockOwner, isSigner: true, isWritable: false },
      // { pubkey: lockNftMint, isSigner: false, isWritable: false },
      { pubkey: lockNftAccount, isSigner: false, isWritable: true },
      { pubkey: lockPositionId, isSigner: false, isWritable: false },
      { pubkey: clmmProgram, isSigner: false, isWritable: false },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: positionId, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: vaultA, isSigner: false, isWritable: true },
      { pubkey: vaultB, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: userVaultA, isSigner: false, isWritable: true },
      { pubkey: userVaultB, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ];

    return new TransactionInstruction({
      keys,
      programId,
      data: Buffer.from(lockHarvestInsDataBuf),
    });
  }
}
