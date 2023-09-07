import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  Connection,
  Keypair,
  Signer,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  createLogger,
  parseBigNumberish,
  RENT_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  InstructionType,
  getATAAddress,
  MEMO_PROGRAM_ID,
} from "../../common";
import { bool, s32, struct, u128, u64, u8 } from "../../marshmallow";
import { MintInfo, ReturnTypeMakeInstructions, ClmmPoolInfo, ClmmPoolPersonalPosition } from "./type";
import { ObservationInfoLayout } from "./layout";
import {
  getPdaPoolId,
  getPdaPoolVaultId,
  getPdaTickArrayAddress,
  getPdaMetadataKey,
  getPdaProtocolPositionAddress,
  getPdaPersonalPositionAddress,
  getPdaOperationAccount,
  getPdaExBitmapAccount,
  getPdaPoolRewardVaulId,
} from "./utils/pda";
import { TickUtils } from "./utils/tick";
import { PoolUtils } from "./utils/pool";
import { generatePubKey } from "../account/util";

const logger = createLogger("Raydium_Clmm");

const anchorDataBuf = {
  createPool: [233, 146, 209, 142, 207, 104, 64, 188],
  initReward: [95, 135, 192, 196, 242, 129, 230, 68],
  setRewardEmissions: [13, 197, 86, 168, 109, 176, 27, 244],
  collectProtocolFee: [136, 136, 252, 221, 194, 66, 126, 89],
  openPosition: [77, 184, 74, 214, 112, 86, 241, 199],
  closePosition: [123, 134, 81, 0, 49, 68, 98, 98],
  increaseLiquidity: [133, 29, 89, 223, 69, 238, 176, 10],
  decreaseLiquidity: [58, 127, 188, 62, 79, 82, 196, 96],
  swap: [248, 198, 158, 145, 225, 117, 135, 200],
  collectReward: [18, 237, 166, 197, 34, 16, 213, 144],
};

interface CreatePoolInstruction {
  connection: Connection;
  programId: PublicKey;
  owner: PublicKey;
  mintA: MintInfo;
  mintB: MintInfo;
  ammConfigId: PublicKey;
  initialPriceX64: BN;
  startTime: BN;
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
    startTime: BN,
  ): TransactionInstruction {
    const dataLayout = struct([u128("sqrtPriceX64"), u64("startTime")]);

    const keys = [
      { pubkey: poolCreator, isSigner: true, isWritable: true },
      { pubkey: ammConfigId, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: mintA, isSigner: false, isWritable: false },
      { pubkey: mintB, isSigner: false, isWritable: false },
      { pubkey: mintVaultA, isSigner: false, isWritable: true },
      { pubkey: mintVaultB, isSigner: false, isWritable: true },
      { pubkey: observationId, isSigner: false, isWritable: false },
      { pubkey: exTickArrayBitmap, isSigner: false, isWritable: true },
      { pubkey: mintProgramIdA, isSigner: false, isWritable: false },
      { pubkey: mintProgramIdB, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        sqrtPriceX64,
        startTime,
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

  static async createPoolInstructions(props: CreatePoolInstruction): Promise<ReturnTypeMakeInstructions> {
    const { connection, programId, owner, mintA, mintB, ammConfigId, initialPriceX64, startTime } = props;
    const observationId = generatePubKey({ fromPublicKey: owner, programId });
    const ins = [
      SystemProgram.createAccountWithSeed({
        fromPubkey: owner,
        basePubkey: owner,
        seed: observationId.seed,
        newAccountPubkey: observationId.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(ObservationInfoLayout.span),
        space: ObservationInfoLayout.span,
        programId,
      }),
    ];

    const { publicKey: poolId } = getPdaPoolId(programId, ammConfigId, mintA.mint, mintB.mint);
    const { publicKey: mintAVault } = getPdaPoolVaultId(programId, poolId, mintA.mint);
    const { publicKey: mintBVault } = getPdaPoolVaultId(programId, poolId, mintB.mint);

    ins.push(
      this.createPoolInstruction(
        programId,
        poolId,
        owner,
        ammConfigId,
        observationId.publicKey,
        mintA.mint,
        mintAVault,
        mintA.programId,
        mintB.mint,
        mintBVault,
        mintB.programId,
        getPdaExBitmapAccount(programId, poolId).publicKey,
        initialPriceX64,
        startTime,
      ),
    );

    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.CreateAccount, InstructionType.ClmmCreatePool],
      address: { poolId, observationId: observationId.publicKey, mintAVault, mintBVault },
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

  static async openPositionInstructions({
    poolInfo,
    ownerInfo,
    tickLower,
    tickUpper,
    liquidity,
    amountMaxA,
    amountMaxB,
    programId,
    withMetadata,
    getEphemeralSigners,
  }: {
    poolInfo: ClmmPoolInfo;

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
    programId?: PublicKey;
    withMetadata: "create" | "no-create";
    getEphemeralSigners?: (k: number) => any;
  }): Promise<ReturnTypeMakeInstructions> {
    const signers: Signer[] = [];

    const nftMintAKeypair = new Keypair();
    let nftMintAccount;
    if (getEphemeralSigners) {
      nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      nftMintAccount = _k.publicKey;
    }

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, poolInfo.ammConfig.tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, poolInfo.ammConfig.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayLowerStartIndex,
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayUpperStartIndex,
    );

    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, nftMintAKeypair.publicKey, programId);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAKeypair.publicKey);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(
      poolInfo.programId,
      nftMintAKeypair.publicKey,
    );
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolInfo.programId,
      poolInfo.id,
      tickLower,
      tickUpper,
    );

    const ins = this.openPositionFromLiquidityInstruction(
      poolInfo.programId,
      ownerInfo.feePayer,
      poolInfo.id,
      ownerInfo.wallet,
      nftMintAKeypair.publicKey,
      positionNftAccount,
      metadataAccount,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      personalPosition,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.mintA.vault,
      poolInfo.mintB.vault,
      poolInfo.mintA.mint,
      poolInfo.mintB.mint,

      tickLower,
      tickUpper,
      tickArrayLowerStartIndex,
      tickArrayUpperStartIndex,
      liquidity,
      amountMaxA,
      amountMaxB,
      withMetadata,
    );

    return {
      signers: [nftMintAKeypair],
      instructions: [ins],
      instructionTypes: [InstructionType.ClmmOpenPosition],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
      address: {},
    };
  }

  static async openPositionFromBaseInstructions({
    poolInfo,
    ownerInfo,
    tickLower,
    tickUpper,
    base,
    baseAmount,
    otherAmountMax,
    withMetadata,
    getEphemeralSigners,
  }: {
    poolInfo: ClmmPoolInfo;

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
  }): Promise<ReturnTypeMakeInstructions> {
    const signers: Signer[] = [];

    let nftMintAccount: PublicKey;
    if (getEphemeralSigners) {
      nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      nftMintAccount = _k.publicKey;
    }

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, poolInfo.ammConfig.tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, poolInfo.ammConfig.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayLowerStartIndex,
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayUpperStartIndex,
    );

    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolInfo.programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolInfo.programId,
      poolInfo.id,
      tickLower,
      tickUpper,
    );

    const ins = this.openPositionFromBaseInstruction(
      poolInfo.programId,
      ownerInfo.feePayer,
      poolInfo.id,
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
      poolInfo.mintA.vault,
      poolInfo.mintB.vault,
      poolInfo.mintA.mint,
      poolInfo.mintB.mint,

      tickLower,
      tickUpper,
      tickArrayLowerStartIndex,
      tickArrayUpperStartIndex,

      withMetadata,

      base,
      baseAmount,

      otherAmountMax,
      PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(poolInfo.programId, poolInfo.id).publicKey
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
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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

  static async openPositionFromLiquidityInstructions({
    poolInfo,
    ownerInfo,
    tickLower,
    tickUpper,
    liquidity,
    amountMaxA,
    amountMaxB,
    withMetadata,
    getEphemeralSigners,
  }: {
    poolInfo: ClmmPoolInfo;
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
  }): Promise<ReturnTypeMakeInstructions> {
    let nftMintAccount: PublicKey;
    const signers: Keypair[] = [];
    if (getEphemeralSigners) {
      nftMintAccount = new PublicKey((await getEphemeralSigners(1))[0]);
    } else {
      const _k = Keypair.generate();
      signers.push(_k);
      nftMintAccount = _k.publicKey;
    }

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, poolInfo.ammConfig.tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, poolInfo.ammConfig.tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayLowerStartIndex,
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayUpperStartIndex,
    );

    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, nftMintAccount, TOKEN_PROGRAM_ID);
    const { publicKey: metadataAccount } = getPdaMetadataKey(nftMintAccount);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolInfo.programId, nftMintAccount);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolInfo.programId,
      poolInfo.id,
      tickLower,
      tickUpper,
    );

    const ins = this.openPositionFromLiquidityInstruction(
      poolInfo.programId,
      ownerInfo.wallet,
      poolInfo.id,
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
      poolInfo.mintA.vault,
      poolInfo.mintB.vault,
      poolInfo.mintA.mint,
      poolInfo.mintB.mint,

      tickLower,
      tickUpper,
      tickArrayLowerStartIndex,
      tickArrayUpperStartIndex,
      liquidity,
      amountMaxA,
      amountMaxB,
      withMetadata,
      PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(poolInfo.programId, poolInfo.id).publicKey
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
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
    };
  }

  static closePositionInstruction(
    programId: PublicKey,
    positionNftOwner: PublicKey,
    positionNftMint: PublicKey,
    positionNftAccount: PublicKey,
    personalPosition: PublicKey,
  ): TransactionInstruction {
    const dataLayout = struct([]);

    const keys = [
      { pubkey: positionNftOwner, isSigner: true, isWritable: true },
      { pubkey: positionNftMint, isSigner: false, isWritable: true },
      { pubkey: positionNftAccount, isSigner: false, isWritable: true },
      { pubkey: personalPosition, isSigner: false, isWritable: false },

      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
    ownerInfo,
    ownerPosition,
  }: {
    poolInfo: ClmmPoolInfo;
    ownerPosition: ClmmPoolPersonalPosition;
    ownerInfo: {
      wallet: PublicKey;
    };
  }): ReturnTypeMakeInstructions {
    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID);
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolInfo.programId, ownerPosition.nftMint);

    const ins: TransactionInstruction[] = [];
    ins.push(
      this.closePositionInstruction(
        poolInfo.programId,

        ownerInfo.wallet,
        ownerPosition.nftMint,
        positionNftAccount,
        personalPosition,
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
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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
    ownerPosition,
    ownerInfo,
    liquidity,
    amountMaxA,
    amountMaxB,
  }: {
    poolInfo: ClmmPoolInfo;
    ownerPosition: ClmmPoolPersonalPosition;

    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    liquidity: BN;
    amountMaxA: BN;
    amountMaxB: BN;
  }): ReturnTypeMakeInstructions {
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      poolInfo.ammConfig.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      poolInfo.ammConfig.tickSpacing,
    );

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayLowerStartIndex,
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayUpperStartIndex,
    );

    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID);

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolInfo.programId, ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolInfo.programId,
      poolInfo.id,
      ownerPosition.tickLower,
      ownerPosition.tickUpper,
    );

    const ins = this.increasePositionFromLiquidityInstruction(
      poolInfo.programId,
      ownerInfo.wallet,
      positionNftAccount,
      personalPosition,
      poolInfo.id,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.mintA.vault,
      poolInfo.mintB.vault,
      poolInfo.mintA.mint,
      poolInfo.mintB.mint,

      liquidity,
      amountMaxA,
      amountMaxB,
      PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(poolInfo.programId, poolInfo.id).publicKey
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
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
    };
  }

  static increasePositionFromBaseInstructions({
    poolInfo,
    ownerPosition,
    ownerInfo,
    base,
    baseAmount,
    otherAmountMax,
  }: {
    poolInfo: ClmmPoolInfo;
    ownerPosition: ClmmPoolPersonalPosition;

    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    base: "MintA" | "MintB";
    baseAmount: BN;

    otherAmountMax: BN;
  }): ReturnTypeMakeInstructions {
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      poolInfo.ammConfig.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      poolInfo.ammConfig.tickSpacing,
    );

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayLowerStartIndex,
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayUpperStartIndex,
    );

    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, TOKEN_PROGRAM_ID);

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolInfo.programId, ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolInfo.programId,
      poolInfo.id,
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
          poolInfo.programId,
          ownerInfo.wallet,
          positionNftAccount,
          personalPosition,
          poolInfo.id,
          protocolPosition,
          tickArrayLower,
          tickArrayUpper,
          ownerInfo.tokenAccountA,
          ownerInfo.tokenAccountB,
          poolInfo.mintA.vault,
          poolInfo.mintB.vault,
          poolInfo.mintA.mint,
          poolInfo.mintB.mint,

          base,
          baseAmount,

          otherAmountMax,
          PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.tickSpacing, [
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
          ])
            ? getPdaExBitmapAccount(poolInfo.programId, poolInfo.id).publicKey
            : undefined,
        ),
      ],
      signers: [],
      instructionTypes: [InstructionType.ClmmIncreasePosition],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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
    ownerPosition,
    ownerInfo,
    liquidity,
    amountMinA,
    amountMinB,
    programId,
  }: {
    poolInfo: ClmmPoolInfo;
    ownerPosition: ClmmPoolPersonalPosition;

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
  }): ReturnTypeMakeInstructions {
    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      poolInfo.ammConfig.tickSpacing,
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      poolInfo.ammConfig.tickSpacing,
    );

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayLowerStartIndex,
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      poolInfo.programId,
      poolInfo.id,
      tickArrayUpperStartIndex,
    );
    const { publicKey: positionNftAccount } = getATAAddress(ownerInfo.wallet, ownerPosition.nftMint, programId);

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(poolInfo.programId, ownerPosition.nftMint);
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      poolInfo.programId,
      poolInfo.id,
      ownerPosition.tickLower,
      ownerPosition.tickUpper,
    );

    const rewardAccounts: {
      poolRewardVault: PublicKey;
      ownerRewardVault: PublicKey;
      rewardMint: PublicKey;
    }[] = [];
    for (let i = 0; i < poolInfo.rewardInfos.length; i++) {
      rewardAccounts.push({
        poolRewardVault: poolInfo.rewardInfos[0].tokenVault,
        ownerRewardVault: ownerInfo.rewardAccounts[0],
        rewardMint: poolInfo.rewardInfos[i].tokenMint,
      });
    }

    const ins: TransactionInstruction[] = [];
    ins.push(
      this.decreaseLiquidityInstruction(
        poolInfo.programId,
        ownerInfo.wallet,
        positionNftAccount,
        personalPosition,
        poolInfo.id,
        protocolPosition,
        tickArrayLower,
        tickArrayUpper,
        ownerInfo.tokenAccountA,
        ownerInfo.tokenAccountB,
        poolInfo.mintA.vault,
        poolInfo.mintB.vault,
        poolInfo.mintA.mint,
        poolInfo.mintB.mint,
        rewardAccounts,

        liquidity,
        amountMinA,
        amountMinB,
        PoolUtils.isOverflowDefaultTickarrayBitmap(poolInfo.tickSpacing, [
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,
        ])
          ? getPdaExBitmapAccount(poolInfo.programId, poolInfo.id).publicKey
          : undefined,
      ),
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
      instructions: ins,
      instructionTypes: [InstructionType.ClmmDecreasePosition],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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
    ownerInfo,
    inputMint,
    amountIn,
    amountOutMin,
    sqrtPriceLimitX64,
    remainingAccounts,
  }: {
    poolInfo: ClmmPoolInfo;

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
    const isInputMintA = poolInfo.mintA.mint.equals(inputMint);
    const ins = [
      this.swapInstruction(
        poolInfo.programId,
        ownerInfo.wallet,

        poolInfo.id,
        poolInfo.ammConfig.id,

        isInputMintA ? ownerInfo.tokenAccountA : ownerInfo.tokenAccountB,
        isInputMintA ? ownerInfo.tokenAccountB : ownerInfo.tokenAccountA,

        isInputMintA ? poolInfo.mintA.vault : poolInfo.mintB.vault,
        isInputMintA ? poolInfo.mintB.vault : poolInfo.mintA.vault,

        isInputMintA ? poolInfo.mintA.mint : poolInfo.mintB.mint,
        isInputMintA ? poolInfo.mintB.mint : poolInfo.mintA.mint,

        remainingAccounts,
        poolInfo.observationId,
        amountIn,
        amountOutMin,
        sqrtPriceLimitX64,
        true,
        getPdaExBitmapAccount(poolInfo.programId, poolInfo.id).publicKey,
      ),
    ];
    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmSwapBaseIn],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
    ownerInfo,
    rewardInfo,
  }: {
    poolInfo: ClmmPoolInfo;
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
  }): ReturnTypeMakeInstructions {
    const poolRewardVault = getPdaPoolRewardVaulId(poolInfo.programId, poolInfo.id, rewardInfo.mint).publicKey;
    const operationId = getPdaOperationAccount(poolInfo.programId).publicKey;
    const ins = [
      this.initRewardInstruction(
        poolInfo.programId,
        ownerInfo.wallet,
        poolInfo.id,
        operationId,
        poolInfo.ammConfig.id,

        ownerInfo.tokenAccount,
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
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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
    ownerInfo,
    rewardInfo,
  }: {
    poolInfo: ClmmPoolInfo;
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
    let rewardIndex;
    let rewardVault;
    let rewardMint;
    for (let index = 0; index < poolInfo.rewardInfos.length; index++)
      if (poolInfo.rewardInfos[index].tokenMint.equals(rewardInfo.mint)) {
        rewardIndex = index;
        rewardVault = poolInfo.rewardInfos[index].tokenVault;
        rewardMint = poolInfo.rewardInfos[index].tokenMint;
      }

    if (rewardIndex === undefined || rewardVault === undefined)
      logger.logWithError("reward mint check error", "no reward mint", poolInfo.rewardInfos);

    const operationId = getPdaOperationAccount(poolInfo.programId).publicKey;

    const ins = [
      this.setRewardInstruction(
        poolInfo.programId,
        ownerInfo.wallet,
        poolInfo.id,
        operationId,
        poolInfo.ammConfig.id,

        ownerInfo.tokenAccount,
        rewardVault,
        rewardMint,

        rewardIndex,
        rewardInfo.openTime,
        rewardInfo.endTime,
        rewardInfo.emissionsPerSecondX64,
      ),
    ];
    return {
      address: { rewardVault, operationId },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmSetReward],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
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
    ownerInfo,
    rewardMint,
  }: {
    poolInfo: ClmmPoolInfo;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccount: PublicKey;
    };
    rewardMint: PublicKey;
  }): ReturnTypeMakeInstructions {
    let rewardIndex;
    let rewardVault;
    for (let index = 0; index < poolInfo.rewardInfos.length; index++)
      if (poolInfo.rewardInfos[index].tokenMint.equals(rewardMint)) {
        rewardIndex = index;
        rewardVault = poolInfo.rewardInfos[index].tokenVault;
      }

    if (rewardIndex === undefined || rewardVault === undefined)
      logger.logWithError("reward mint check error", "no reward mint", poolInfo.rewardInfos);

    const ins = [
      this.collectRewardInstruction(
        poolInfo.programId,
        ownerInfo.wallet,
        poolInfo.id,

        ownerInfo.tokenAccount,
        rewardVault,
        rewardMint,

        rewardIndex,
      ),
    ];
    return {
      address: { rewardVault },
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmCollectReward],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
    };
  }

  static addComputations(): TransactionInstruction[] {
    return [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1,
      }),
    ];
  }

  static swapBaseOutInstructions({
    poolInfo,
    ownerInfo,
    outputMint,
    amountOut,
    amountInMax,
    sqrtPriceLimitX64,
    remainingAccounts,
  }: {
    poolInfo: ClmmPoolInfo;

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
    const isInputMintA = poolInfo.mintA.mint.equals(outputMint);
    const ins = [
      this.swapInstruction(
        poolInfo.programId,
        ownerInfo.wallet,

        poolInfo.id,
        poolInfo.ammConfig.id,

        isInputMintA ? ownerInfo.tokenAccountB : ownerInfo.tokenAccountA,
        isInputMintA ? ownerInfo.tokenAccountA : ownerInfo.tokenAccountB,

        isInputMintA ? poolInfo.mintB.vault : poolInfo.mintA.vault,
        isInputMintA ? poolInfo.mintA.vault : poolInfo.mintB.vault,

        isInputMintA ? poolInfo.mintA.mint : poolInfo.mintB.mint,
        isInputMintA ? poolInfo.mintB.mint : poolInfo.mintA.mint,

        remainingAccounts,
        poolInfo.observationId,
        amountOut,
        amountInMax,
        sqrtPriceLimitX64,
        false,
      ),
    ];
    return {
      signers: [],
      instructions: ins,
      instructionTypes: [InstructionType.ClmmSwapBaseOut],
      lookupTableAddress: [poolInfo.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
      address: {},
    };
  }
}
