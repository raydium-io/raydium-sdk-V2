import { AccountInfo, AccountMeta, PublicKey, Signer, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { bool, publicKey, struct, u16, u32, u64, u8 } from '../marshmallow';
import { ACCOUNT_TYPE_SIZE, AccountType } from './accountInfo';
import { TokenAccountNotFoundError, TokenInvalidAccountOwnerError, TokenInvalidAccountSizeError, TokenInvalidMintError } from './splTokenProxyErr';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const NATIVE_MINT_2022 = new PublicKey('9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP');

/** Check that the token program provided is not `Tokenkeg...`, useful when using extensions */
export function programSupportsExtensions(programId: PublicKey): boolean {
  if (programId.equals(TOKEN_PROGRAM_ID)) {
    return false;
  } else {
    return true;
  }
}

export interface Mint {
  /** Address of the mint */
  address: PublicKey;
  /**
   * Optional authority used to mint new tokens. The mint authority may only be provided during mint creation.
   * If no mint authority is present then the mint has a fixed supply and no further tokens may be minted.
   */
  mintAuthority: PublicKey | null;
  /** Total supply of tokens */
  supply: bigint;
  /** Number of base 10 digits to the right of the decimal place */
  decimals: number;
  /** Is this mint initialized */
  isInitialized: boolean;
  /** Optional authority to freeze token accounts */
  freezeAuthority: PublicKey | null;
  /** Additional data for extension */
  tlvData: Buffer;
}

/** Mint as stored by the program */
export interface RawMint {
  mintAuthorityOption: 1 | 0;
  mintAuthority: PublicKey;
  supply: BN;
  decimals: number;
  isInitialized: boolean;
  freezeAuthorityOption: 1 | 0;
  freezeAuthority: PublicKey;
}

/** Buffer layout for de/serializing a mint */
export const MintLayout = struct([
  u32('mintAuthorityOption'),
  publicKey('mintAuthority'),
  u64('supply'),
  u8('decimals'),
  bool('isInitialized'),
  u32('freezeAuthorityOption'),
  publicKey('freezeAuthority'),
]);

/** TransferFeeConfig as stored by the program */
export interface TransferFee {
  /** First epoch where the transfer fee takes effect */
  epoch: bigint;
  /** Maximum fee assessed on transfers, expressed as an amount of tokens */
  maximumFee: bigint;
  /**
   * Amount of transfer collected as fees, expressed as basis points of the
   * transfer amount, ie. increments of 0.01%
   */
  transferFeeBasisPoints: number;
}

/** Transfer fee extension data for mints. */
export interface TransferFeeConfig {
  /** Optional authority to set the fee */
  transferFeeConfigAuthority: PublicKey;
  /** Withdraw from mint instructions must be signed by this key */
  withdrawWithheldAuthority: PublicKey;
  /** Withheld transfer fee tokens that have been moved to the mint for withdrawal */
  withheldAmount: bigint;
  /** Older transfer fee, used if the current epoch < newerTransferFee.epoch */
  olderTransferFee: TransferFee;
  /** Newer transfer fee, used if the current epoch >= newerTransferFee.epoch */
  newerTransferFee: TransferFee;
}

/** Buffer layout for de/serializing a token account */
export const AccountLayout = struct([
  publicKey('mint'),
  publicKey('owner'),
  u64('amount'),
  u32('delegateOption'),
  publicKey('delegate'),
  u8('state'),
  u32('isNativeOption'),
  u64('isNative'),
  u64('delegatedAmount'),
  u32('closeAuthorityOption'),
  publicKey('closeAuthority'),
]);

export const MINT_SIZE = MintLayout.span;

/** Instructions defined by the program */
export enum TokenInstruction {
  InitializeMint = 0,
  InitializeAccount = 1,
  InitializeMultisig = 2,
  Transfer = 3,
  Approve = 4,
  Revoke = 5,
  SetAuthority = 6,
  MintTo = 7,
  Burn = 8,
  CloseAccount = 9,
  FreezeAccount = 10,
  ThawAccount = 11,
  TransferChecked = 12,
  ApproveChecked = 13,
  MintToChecked = 14,
  BurnChecked = 15,
  InitializeAccount2 = 16,
  SyncNative = 17,
  InitializeAccount3 = 18,
  InitializeMultisig2 = 19,
  InitializeMint2 = 20,
  GetAccountDataSize = 21,
  InitializeImmutableOwner = 22,
  AmountToUiAmount = 23,
  UiAmountToAmount = 24,
  InitializeMintCloseAuthority = 25,
  TransferFeeExtension = 26,
  ConfidentialTransferExtension = 27,
  DefaultAccountStateExtension = 28,
  Reallocate = 29,
  MemoTransferExtension = 30,
  CreateNativeMint = 31,
  InitializeNonTransferableMint = 32,
  InterestBearingMintExtension = 33,
  CpiGuardExtension = 34,
  InitializePermanentDelegate = 35,
  TransferHookExtension = 36,
  // ConfidentialTransferFeeExtension = 37,
  // WithdrawalExcessLamports = 38,
  MetadataPointerExtension = 39,
  GroupPointerExtension = 40,
  GroupMemberPointerExtension = 41,
}
export const initializeAccountInstructionData = struct([u8('instruction')]);

function buildAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  instructionData: Buffer,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: associatedTokenProgramId,
    data: instructionData,
  });
}

export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  return buildAssociatedTokenAccountInstruction(
    payer,
    associatedToken,
    owner,
    mint,
    Buffer.alloc(0),
    programId,
    associatedTokenProgramId
  );
}
export function createInitializeAccountInstruction(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  programId = TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = [
    { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(initializeAccountInstructionData.span);
  initializeAccountInstructionData.encode({ instruction: TokenInstruction.InitializeAccount }, data);

  return new TransactionInstruction({ keys, programId, data });
}
export function addSigners(
  keys: AccountMeta[],
  ownerOrAuthority: PublicKey,
  multiSigners: (Signer | PublicKey)[]
): AccountMeta[] {
  if (multiSigners.length) {
    keys.push({ pubkey: ownerOrAuthority, isSigner: false, isWritable: false });
    for (const signer of multiSigners) {
      keys.push({
        pubkey: signer instanceof PublicKey ? signer : signer.publicKey,
        isSigner: true,
        isWritable: false,
      });
    }
  } else {
    keys.push({ pubkey: ownerOrAuthority, isSigner: true, isWritable: false });
  }
  return keys;
}

export const closeAccountInstructionData = struct([u8('instruction')]);
export function createCloseAccountInstruction(
  account: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  multiSigners: (Signer | PublicKey)[] = [],
  programId = TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = addSigners(
    [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
    ],
    authority,
    multiSigners
  );

  const data = Buffer.alloc(closeAccountInstructionData.span);
  closeAccountInstructionData.encode({ instruction: TokenInstruction.CloseAccount }, data);

  return new TransactionInstruction({ keys, programId, data });
}
export const transferInstructionData = struct([u8('instruction'), u64('amount')]);
export function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: number | bigint,
  multiSigners: (Signer | PublicKey)[] = [],
  programId = TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = addSigners(
    [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
    ],
    owner,
    multiSigners
  );

  const data = Buffer.alloc(transferInstructionData.span);
  transferInstructionData.encode(
    {
      instruction: TokenInstruction.Transfer,
      amount: new BN(String(amount)),
    },
    data
  );

  return new TransactionInstruction({ keys, programId, data });
}

export const MultisigLayout = struct([
  u8('m'),
  u8('n'),
  bool('isInitialized'),
  publicKey('signer1'),
  publicKey('signer2'),
  publicKey('signer3'),
  publicKey('signer4'),
  publicKey('signer5'),
  publicKey('signer6'),
  publicKey('signer7'),
  publicKey('signer8'),
  publicKey('signer9'),
  publicKey('signer10'),
  publicKey('signer11'),
]);

/** Byte length of a multisig */
export const MULTISIG_SIZE = MultisigLayout.span;

export const ACCOUNT_SIZE = AccountLayout.span;

export function unpackMint(address: PublicKey, info: AccountInfo<Buffer> | null, programId = TOKEN_PROGRAM_ID): Mint {
  if (!info) throw new TokenAccountNotFoundError();
  if (!info.owner.equals(programId)) throw new TokenInvalidAccountOwnerError();
  if (info.data.length < MINT_SIZE) throw new TokenInvalidAccountSizeError();

  const rawMint = MintLayout.decode(info.data.slice(0, MINT_SIZE));
  let tlvData = Buffer.alloc(0);
  if (info.data.length > MINT_SIZE) {
    if (info.data.length <= ACCOUNT_SIZE) throw new TokenInvalidAccountSizeError();
    if (info.data.length === MULTISIG_SIZE) throw new TokenInvalidAccountSizeError();
    if (info.data[ACCOUNT_SIZE] != AccountType.Mint) throw new TokenInvalidMintError();
    tlvData = info.data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
  }

  return {
    address,
    mintAuthority: rawMint.mintAuthorityOption ? rawMint.mintAuthority : null,
    supply: BigInt(rawMint.supply.toString()),
    decimals: rawMint.decimals,
    isInitialized: rawMint.isInitialized,
    freezeAuthority: rawMint.freezeAuthorityOption ? rawMint.freezeAuthority : null,
    tlvData,
  };
}

export const TYPE_SIZE = 2;
export const LENGTH_SIZE = 2;

function addTypeAndLengthToLen(len: number): number {
  return len + TYPE_SIZE + LENGTH_SIZE;
}

export function getExtensionData(extension: number, tlvData: Buffer): Buffer | null {
  let extensionTypeIndex = 0;
  while (addTypeAndLengthToLen(extensionTypeIndex) <= tlvData.length) {
    const entryType = tlvData.readUInt16LE(extensionTypeIndex);
    const entryLength = tlvData.readUInt16LE(extensionTypeIndex + TYPE_SIZE);
    const typeIndex = addTypeAndLengthToLen(extensionTypeIndex);
    if (entryType == extension) {
      return tlvData.slice(typeIndex, typeIndex + entryLength);
    }
    extensionTypeIndex = typeIndex + entryLength;
  }
  return null;
}


export const transferFeeLayout = struct([u64('epoch'), u64('maximumFee'), u16('transferFeeBasisPoints')])

/** Buffer layout for de/serializing a transfer fee config extension */
export const TransferFeeConfigLayout = struct([
  publicKey('transferFeeConfigAuthority'),
  publicKey('withdrawWithheldAuthority'),
  u64('withheldAmount'),
  transferFeeLayout.replicate('olderTransferFee'),
  transferFeeLayout.replicate('newerTransferFee'),
]);

export function getTransferFeeConfig(mint: Mint) {
  const extensionData = getExtensionData(1, mint.tlvData);
  if (extensionData !== null) {
    return TransferFeeConfigLayout.decode(extensionData);
  } else {
    return null;
  }
}