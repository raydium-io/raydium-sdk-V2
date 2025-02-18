import { Connection, Keypair, PublicKey, Signer, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { ReturnTypeMakeInstructions } from "@/raydium/type";
import { ApiV3PoolInfoConcentratedItem, ApiV3Token, ClmmKeys } from "@/api/type";
import {
  InstructionType,
  MEMO_PROGRAM_ID,
  MEMO_PROGRAM_ID2,
  METADATA_PROGRAM_ID,
  RENT_PROGRAM_ID,
  createLogger,
  getATAAddress,
  parseBigNumberish,
} from "@/common";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bool, s32, struct, u128, u64, u8 } from "@/marshmallow";
import { ClmmPositionLayout, ObservationInfoLayout } from "./layout";
import {
  ClmmPoolPersonalPosition,
  ClosePositionExtInfo,
  InitRewardExtInfo,
  ManipulateLiquidityExtInfo,
  OpenPositionFromBaseExtInfo,
  OpenPositionFromLiquidityExtInfo,
  ClmmLockAddress,
} from "./type";
import {
  getPdaExBitmapAccount,
  getPdaLockPositionId,
  getPdaMetadataKey,
  getPdaObservationAccount,
  getPdaOperationAccount,
  getPdaPersonalPositionAddress,
  getPdaPoolId,
  getPdaPoolRewardVaulId,
  getPdaPoolVaultId,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
  getPdaLockClPositionIdV2,
  getPdaMintExAccount,
} from "./utils/pda";
import { PoolUtils } from "./utils/pool";
import { TickUtils } from "./utils/tick";
import { ZERO } from "./utils/constants";
ObservationInfoLayout.span; // do not delete this line

const logger = createLogger("Raydium_Clmm");

const anchorDataBuf = {
  createPool: [233, 146, 209, 142, 207, 104, 64, 188],
  initReward: [95, 135, 192, 196, 242, 129, 230, 68],
  setRewardEmissions: [112, 52, 167, 75, 32, 201, 211, 137],
  openPosition: [77, 184, 74, 214, 112, 86, 241, 199],
  openPositionWithTokenEx: [77, 255, 174, 82, 125, 29, 201, 46],
  closePosition: [123, 134, 81, 0, 49, 68, 98, 98],
  increaseLiquidity: [133, 29, 89, 223, 69, 238, 176, 10],
  decreaseLiquidity: [58, 127, 188, 62, 79, 82, 196, 96],
  swap: [43, 4, 237, 11, 26, 201, 30, 98], // [248, 198, 158, 145, 225, 117, 135, 200],
  collectReward: [18, 237, 166, 197, 34, 16, 213, 144],
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
    mintVaultA: PublicKey,
    mintProgramIdA: PublicKey,
    mintB: PublicKey,
    mintVaultB: PublicKey,
    mintProgramIdB: PublicKey,
    exTickArrayBitmap: PublicKey,
    sqrtPriceX64: BN,
    extendMintAccount?: PublicKey[],
  ): TransactionInstruction {
    const dataLayout = struct([u128("sqrtPriceX64"), u64("zero")]);

    const keys = [
      { pubkey: poolCreator, isSigner: true, isWritable: true },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },
      { pubkey: mintVaultA, isSigner: false, isWritable: true },
      { pubkey: mintVaultB, isSigner: false, isWritable: true },
      { pubkey: observationId, isSigner: false, isWritable: true },
      { pubkey: exTickArrayBitmap, isSigner: false, isWritable: true },
      { pubkey: mintProgramIdA, isSigner: false, isWritable: false },
      { pubkey: mintProgramIdB, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      ...(extendMintAccount?.map((k) => ({ pubkey: k, isSigner: false, isWritable: false })) || []),
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        sqrtPriceX64,
        zero: ZERO,
      },
      data,
    );
    const aData = Buffer.from([...anchorDataBuf.createPool, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static async createPoolInstructions(props: CreatePoolInstruction): Promise<
    ReturnTypeMakeInstructions<{
      poolId: PublicKey;
      observationId: PublicKey;
      exBitmapAccount: PublicKey;
      mintAVault: PublicKey;
      mintBVault: PublicKey;
    }>
  > {
    const { programId, owner, mintA, mintB, ammConfigId, initialPriceX64, extendMintAccount } = props;
    const [mintAAddress, mintBAddress] = [new PublicKey(mintA.address), new PublicKey(mintB.address)];

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
        new PublicKey(mintA.programId || TOKEN_PROGRAM_ID),
        mintBAddress,
        mintBVault,
        new PublicKey(mintB.programId || TOKEN_PROGRAM_ID),
        exBitmapAccount,
        initialPriceX64,
        extendMintAccount,
      ),
    ];

    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.CreateAccount, InstructionType.ClmmCreatePool],
      address: { poolId, observationId, exBitmapAccount, mintAVault, mintBVault },
      lookupTableAddress: [],
    };
  }

  static openPositionFromLiquidityInstruction(
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
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    tokenVaultA: PublicKey,
    tokenVaultB: PublicKey,
    tokenMintA: PublicKey,
    tokenMintB: PublicKey,

    tickLowerIndex: number,
    tickUpperIndex: number,
    tickArrayLowerStartIndex: number,
    tickArrayUpperStartIndex: number,
    liquidity: BN,
    amountMaxA: BN,
    amountMaxB: BN,
    withMetadata: "create" | "no-create",

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      s32("tickLowerIndex"),
      s32("tickUpperIndex"),
      s32("tickArrayLowerStartIndex"),
      s32("tickArrayUpperStartIndex"),
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      bool("withMetadata"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionNftOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: true, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: metadataAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },
      { pubkey: tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: tokenVaultB, isSigner: false, isWritable: true },

      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: tokenMintA, isSigner: false, isWritable: false },
      { pubkey: tokenMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        tickLowerIndex,
        tickUpperIndex,
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
        liquidity,
        amountMaxA,
        amountMaxB,
        withMetadata: withMetadata === "create",
        baseFlag: false,
        optionBaseFlag: 0,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.openPosition, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static openPositionFromLiquidityInstruction22(
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
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    tokenVaultA: PublicKey,
    tokenVaultB: PublicKey,
    tokenMintA: PublicKey,
    tokenMintB: PublicKey,

    tickLowerIndex: number,
    tickUpperIndex: number,
    tickArrayLowerStartIndex: number,
    tickArrayUpperStartIndex: number,
    liquidity: BN,
    amountMaxA: BN,
    amountMaxB: BN,
    withMetadata: "create" | "no-create",

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      s32("tickLowerIndex"),
      s32("tickUpperIndex"),
      s32("tickArrayLowerStartIndex"),
      s32("tickArrayUpperStartIndex"),
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      bool("withMetadata"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionNftOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: true, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },
      { pubkey: tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: tokenVaultB, isSigner: false, isWritable: true },

      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: tokenMintA, isSigner: false, isWritable: false },
      { pubkey: tokenMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        tickLowerIndex,
        tickUpperIndex,
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
        liquidity,
        amountMaxA,
        amountMaxB,
        withMetadata: withMetadata === "create",
        baseFlag: false,
        optionBaseFlag: 0,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.openPositionWithTokenEx, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(programId, id, tickLower, tickUpper);

    const ins = nft2022
      ? this.openPositionFromLiquidityInstruction22(
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
          withMetadata,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        )
      : this.openPositionFromLiquidityInstruction(
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
          withMetadata,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
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

    base: "MintA" | "MintB";
    baseAmount: BN;

    otherAmountMax: BN;
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

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(programId, id, tickLower, tickUpper);

    const ins = nft2022
      ? this.openPositionFromBaseInstruction22(
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

          withMetadata,

          base,
          baseAmount,

          otherAmountMax,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        )
      : this.openPositionFromBaseInstruction(
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

          withMetadata,

          base,
          baseAmount,

          otherAmountMax,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
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

  static openPositionFromBaseInstruction(
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
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    tokenVaultA: PublicKey,
    tokenVaultB: PublicKey,
    tokenMintA: PublicKey,
    tokenMintB: PublicKey,

    tickLowerIndex: number,
    tickUpperIndex: number,
    tickArrayLowerStartIndex: number,
    tickArrayUpperStartIndex: number,

    withMetadata: "create" | "no-create",
    base: "MintA" | "MintB",
    baseAmount: BN,

    otherAmountMax: BN,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      s32("tickLowerIndex"),
      s32("tickUpperIndex"),
      s32("tickArrayLowerStartIndex"),
      s32("tickArrayUpperStartIndex"),
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      bool("withMetadata"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionNftOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: true, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: metadataAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },
      { pubkey: tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: tokenVaultB, isSigner: false, isWritable: true },

      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: tokenMintA, isSigner: false, isWritable: false },
      { pubkey: tokenMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        tickLowerIndex,
        tickUpperIndex,
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
        liquidity: new BN(0),
        amountMaxA: base === "MintA" ? baseAmount : otherAmountMax,
        amountMaxB: base === "MintA" ? otherAmountMax : baseAmount,
        withMetadata: withMetadata === "create",
        baseFlag: base === "MintA",
        optionBaseFlag: 1,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.openPosition, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static openPositionFromBaseInstruction22(
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
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    tokenVaultA: PublicKey,
    tokenVaultB: PublicKey,
    tokenMintA: PublicKey,
    tokenMintB: PublicKey,

    tickLowerIndex: number,
    tickUpperIndex: number,
    tickArrayLowerStartIndex: number,
    tickArrayUpperStartIndex: number,

    withMetadata: "create" | "no-create",
    base: "MintA" | "MintB",
    baseAmount: BN,

    otherAmountMax: BN,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      s32("tickLowerIndex"),
      s32("tickUpperIndex"),
      s32("tickArrayLowerStartIndex"),
      s32("tickArrayUpperStartIndex"),
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      bool("withMetadata"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: positionNftOwner, isSigner: false, isWritable: false },
      { pubkey: positionNftMint, isSigner: true, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },
      { pubkey: tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: tokenVaultB, isSigner: false, isWritable: true },

      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: tokenMintA, isSigner: false, isWritable: false },
      { pubkey: tokenMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        tickLowerIndex,
        tickUpperIndex,
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
        liquidity: new BN(0),
        amountMaxA: base === "MintA" ? baseAmount : otherAmountMax,
        amountMaxB: base === "MintA" ? otherAmountMax : baseAmount,
        withMetadata: withMetadata === "create",
        baseFlag: base === "MintA",
        optionBaseFlag: 1,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.openPositionWithTokenEx, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, poolInfo.config.tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, poolInfo.config.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(programId, id, tickArrayLowerStartIndex);
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(programId, id, tickArrayUpperStartIndex);

    const { publicKey: positionNftAccount } = nft2022
      ? getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_2022_PROGRAM_ID)
      : getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(programId, id, tickLower, tickUpper);

    const ins = nft2022
      ? this.openPositionFromLiquidityInstruction22(
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
          withMetadata,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(programId, id).publicKey
            : undefined,
        )
      : this.openPositionFromLiquidityInstruction(
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
          withMetadata,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
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

  static closePositionInstruction(
    programId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftMint: PublicKey,
    positionNftAccount: PublicKey,
    personalPosition: PublicKey,
    nft2022?: boolean,
  ): TransactionInstruction {
    const dataLayout = struct([]);

    const keys = [
      { pubkey: positionNftOwner, isSigner: true, isWritable: true },
      { pubkey: positionNftMint, isSigner: false, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },

      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: nft2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({}, data);

    const aData = Buffer.from([...anchorDataBuf.closePosition, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
    ownerPosition: ClmmPositionLayout;
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

  static increasePositionFromLiquidityInstruction(
    programId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftAccount: PublicKey,
    personalPosition: PublicKey,

    poolId: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    mintVaultA: PublicKey,
    mintVaultB: PublicKey,
    mintMintA: PublicKey,
    mintMintB: PublicKey,

    liquidity: BN,
    amountMaxA: BN,
    amountMaxB: BN,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const keys = [
      { pubkey: positionNftOwner, isSigner: true, isWritable: false },
      { pubkey: positionNftAccount, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },
      { pubkey: mintVaultA, isSigner: false, isWritable: true },
      { pubkey: mintVaultB, isSigner: false, isWritable: true },

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: mintMintA, isSigner: false, isWritable: false },
      { pubkey: mintMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        liquidity,
        amountMaxA,
        amountMaxB,
        optionBaseFlag: 0,
        baseFlag: false,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.increaseLiquidity, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
    ownerPosition: ClmmPositionLayout;

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
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      poolInfo.config.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      poolInfo.config.tickSpacing,
    );

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

    const ins = this.increasePositionFromLiquidityInstruction(
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
      PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
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
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      poolInfo.config.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      poolInfo.config.tickSpacing,
    );

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
        this.increasePositionFromBaseInstruction(
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

          base,
          baseAmount,

          otherAmountMax,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
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

  static increasePositionFromBaseInstruction(
    programId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftAccount: PublicKey,
    personalPosition: PublicKey,

    poolId: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    mintVaultA: PublicKey,
    mintVaultB: PublicKey,
    mintMintA: PublicKey,
    mintMintB: PublicKey,

    base: "MintA" | "MintB",
    baseAmount: BN,

    otherAmountMax: BN,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      u128("liquidity"),
      u64("amountMaxA"),
      u64("amountMaxB"),
      u8("optionBaseFlag"),
      bool("baseFlag"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
    ];

    const keys = [
      { pubkey: positionNftOwner, isSigner: true, isWritable: false },
      { pubkey: positionNftAccount, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },
      { pubkey: mintVaultA, isSigner: false, isWritable: true },
      { pubkey: mintVaultB, isSigner: false, isWritable: true },

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: mintMintA, isSigner: false, isWritable: false },
      { pubkey: mintMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        liquidity: new BN(0),
        amountMaxA: base === "MintA" ? baseAmount : otherAmountMax,
        amountMaxB: base === "MintA" ? otherAmountMax : baseAmount,
        baseFlag: base === "MintA",
        optionBaseFlag: 1,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.increaseLiquidity, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }

  static decreaseLiquidityInstruction(
    programId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftAccount: PublicKey,
    personalPosition: PublicKey,

    poolId: PublicKey,
    protocolPosition: PublicKey,
    tickArrayLower: PublicKey,
    tickArrayUpper: PublicKey,
    ownerTokenAccountA: PublicKey,
    ownerTokenAccountB: PublicKey,
    mintVaultA: PublicKey,
    mintVaultB: PublicKey,
    mintMintA: PublicKey,
    mintMintB: PublicKey,
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
      { pubkey: positionNftOwner, isSigner: true, isWritable: false },
      { pubkey: positionNftAccount, isSigner: false, isWritable: false },
      { pubkey: personalPosition, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: protocolPosition, isSigner: false, isWritable: true },
      { pubkey: mintVaultA, isSigner: false, isWritable: true },
      { pubkey: mintVaultB, isSigner: false, isWritable: true },
      { pubkey: tickArrayLower, isSigner: false, isWritable: true },
      { pubkey: tickArrayUpper, isSigner: false, isWritable: true },

      { pubkey: ownerTokenAccountA, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccountB, isSigner: false, isWritable: true },

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: mintMintA, isSigner: false, isWritable: false },
      { pubkey: mintMintB, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        liquidity,
        amountMinA,
        amountMinB,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.decreaseLiquidity, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
    ownerPosition: ClmmPositionLayout;
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
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      poolInfo.config.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      poolInfo.config.tickSpacing,
    );

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
    const decreaseIns = this.decreaseLiquidityInstruction(
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
      PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.config.tickSpacing, [
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

  static swapInstruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    ammConfigId: PublicKey,
    inputTokenAccount: PublicKey,
    outputTokenAccount: PublicKey,
    inputVault: PublicKey,
    outputVault: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    tickArray: PublicKey[],
    observationId: PublicKey,

    amount: BN,
    otherAmountThreshold: BN,
    sqrtPriceLimitX64: BN,
    isBaseInput: boolean,

    exTickArrayBitmap?: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([
      u64("amount"),
      u64("otherAmountThreshold"),
      u128("sqrtPriceLimitX64"),
      bool("isBaseInput"),
    ]);

    const remainingAccounts = [
      ...(exTickArrayBitmap ? [{ pubkey: exTickArrayBitmap, isSigner: false, isWritable: true }] : []),
      ...tickArray.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
    ];

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },

      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: outputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },

      { pubkey: observationId, isSigner: false, isWritable: true },

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: outputMint, isSigner: false, isWritable: false },

      ...remainingAccounts,
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        amount,
        otherAmountThreshold,
        sqrtPriceLimitX64,
        isBaseInput,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.swap, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
      this.swapInstruction(
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
      this.swapInstruction(
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

  static initRewardInstruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    operationId: PublicKey,
    ammConfigId: PublicKey,

    ownerTokenAccount: PublicKey,
    rewardProgramId: PublicKey,
    rewardMint: PublicKey,
    rewardVault: PublicKey,

    openTime: number,
    endTime: number,
    emissionsPerSecondX64: BN,
  ): TransactionInstruction {
    const dataLayout = struct([u64("openTime"), u64("endTime"), u128("emissionsPerSecondX64")]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },

      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: operationId, isSigner: false, isWritable: true },
      { pubkey: rewardMint, isSigner: false, isWritable: false },
      { pubkey: rewardVault, isSigner: false, isWritable: true },

      { pubkey: rewardProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        openTime: parseBigNumberish(openTime),
        endTime: parseBigNumberish(endTime),
        emissionsPerSecondX64,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.initReward, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
    const poolRewardVault = getPdaPoolRewardVaulId(programId, id, rewardInfo.mint).publicKey;
    const operationId = getPdaOperationAccount(programId).publicKey;
    const ins = [
      this.initRewardInstruction(
        programId,
        ownerInfo.wallet,
        id,
        operationId,
        new PublicKey(poolInfo.config.id),

        ownerInfo.tokenAccount,
        rewardInfo.programId,
        rewardInfo.mint,
        poolRewardVault,

        rewardInfo.openTime,
        rewardInfo.endTime,
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

  static setRewardInstruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,
    operationId: PublicKey,
    ammConfigId: PublicKey,

    ownerTokenAccount: PublicKey,
    rewardVault: PublicKey,
    rewardMint: PublicKey,

    rewardIndex: number,
    openTime: number,
    endTime: number,
    emissionsPerSecondX64: BN,
  ): TransactionInstruction {
    const dataLayout = struct([u8("rewardIndex"), u128("emissionsPerSecondX64"), u64("openTime"), u64("endTime")]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: operationId, isSigner: false, isWritable: true },

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },

      { pubkey: rewardVault, isSigner: false, isWritable: true },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: rewardMint, isSigner: false, isWritable: true },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        rewardIndex,
        emissionsPerSecondX64,
        openTime: parseBigNumberish(openTime),
        endTime: parseBigNumberish(endTime),
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.setRewardEmissions, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
      this.setRewardInstruction(
        programId,
        ownerInfo.wallet,
        id,
        operationId,
        new PublicKey(poolInfo.config.id),

        ownerInfo.tokenAccount,
        rewardVault!,
        rewardMint!,

        rewardIndex!,
        rewardInfo.openTime,
        rewardInfo.endTime,
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

  static collectRewardInstruction(
    programId: PublicKey,
    payer: PublicKey,
    poolId: PublicKey,

    ownerTokenAccount: PublicKey,
    rewardVault: PublicKey,
    rewardMint: PublicKey,

    rewardIndex: number,
  ): TransactionInstruction {
    const dataLayout = struct([u8("rewardIndex")]);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: rewardVault, isSigner: false, isWritable: true },
      { pubkey: rewardMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        rewardIndex,
      },
      data,
    );

    const aData = Buffer.from([...anchorDataBuf.collectReward, ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
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
      this.collectRewardInstruction(
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
    ownerPosition: ClmmPositionLayout;
    owner: PublicKey;
    ownerRewardAccounts: PublicKey[];
    userVaultA: PublicKey;
    userVaultB: PublicKey;
  }): TransactionInstruction {
    const [poolProgramId, poolId] = [new PublicKey(props.poolKeys.programId), new PublicKey(props.poolKeys.id)];

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      props.ownerPosition.tickLower,
      props.poolKeys.config.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
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
      { pubkey: MEMO_PROGRAM_ID2, isSigner: false, isWritable: false },
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
      { pubkey: MEMO_PROGRAM_ID2, isSigner: false, isWritable: false },
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
