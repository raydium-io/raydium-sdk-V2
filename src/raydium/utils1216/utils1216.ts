import { Connection, PublicKey, Signer, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { findProgramAddress, forecastTransactionSize, getMultipleAccountsInfo } from "@/common";
import { blob, publicKey, seq, struct, u64, u8 } from "@/marshmallow";
import { Token } from "@/module";
import ModuleBase from "../moduleBase";

export interface SHOW_INFO {
  programId: PublicKey;
  poolId: PublicKey;
  ammId: PublicKey;
  ownerAccountId: PublicKey;
  snapshotLpAmount: BN;

  openTime: number;
  endTime: number;

  project: typeof Utils1216.VERSION_PROJECT[number];

  canClaim: boolean;
  canClaimErrorType: canClaimErrorType;

  tokenInfo: {
    mintAddress: PublicKey;
    mintVault: PublicKey;
    mintDecimals: number;
    perLpLoss: BN;
    debtAmount: BN;
  }[];
}

export type canClaimErrorType = "outOfOperationalTime" | "alreadyClaimIt" | undefined;

export default class Utils1216 extends ModuleBase {
  static CLAIMED_NUM = 3;
  static POOL_LAYOUT = struct([
    blob(8),
    u8("bump"),
    u8("status"),
    u64("openTime"),
    u64("endTime"),
    publicKey("ammId"),

    seq(
      struct([
        u8("mintDecimals"),
        publicKey("mintAddress"),
        publicKey("mintVault"),
        u64("perLpLoss"),
        u64("totalClaimedAmount"),
      ]),
      Utils1216.CLAIMED_NUM,
      "tokenInfo",
    ),
    seq(u64(), 10, "padding"),
  ]);

  static OWNER_LAYOUT = struct([
    blob(8),
    u8("bump"),
    u8("version"),
    publicKey("poolId"),
    publicKey("owner"),
    u64("lpAmount"),

    seq(
      struct([publicKey("mintAddress"), u64("debtAmount"), u64("claimedAmount")]),
      Utils1216.CLAIMED_NUM,
      "tokenInfo",
    ),
    seq(u64(), 4, "padding"),
  ]);

  static DEFAULT_POOL_ID = [
    "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg",
    "AVs9TA4nWDzfPJE9gGVNJMVhcQy3V9PGazuz33BfG2RA",
    "DVa7Qmb5ct9RCpaU7UTpSaf3GVMYz17vNVU67XpdCRut",
    "7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX",
    "6a1CsrpeZubDjEJE9s1CMVheB6HWM5d7m1cj2jkhyXhj",
    "EoNrn8iUhwgJySD1pHu8Qxm5gSQqLK3za4m8xzD2RuEb",
    "AceAyRTWt4PyB2pHqf2qhDgNZDtKVNaxgL8Ru3V4aN1P",
    "6tmFJbMk5yVHFcFy7X2K8RwHjKLr6KVFLYXpgpBNeAxB",
  ].map((i) => new PublicKey(i));

  static SEED_CONFIG = {
    pool: {
      id: Buffer.from("pool_seed", "utf8"),
    },
    owner: {
      id: Buffer.from("user_claim_seed", "utf8"),
    },
  };

  static VERSION_PROJECT = [undefined, "Francium", "Tulip", "Larix"] as const;

  // pda
  static getPdaPoolId(
    programId: PublicKey,
    ammId: PublicKey,
  ): {
    publicKey: PublicKey;
    nonce: number;
  } {
    return findProgramAddress([Utils1216.SEED_CONFIG.pool.id, ammId.toBuffer()], programId);
  }

  static getPdaOwnerId(
    programId: PublicKey,
    poolId: PublicKey,
    owner: PublicKey,
    version: number,
  ): {
    publicKey: PublicKey;
    nonce: number;
  } {
    return findProgramAddress(
      [
        Utils1216.SEED_CONFIG.owner.id,
        poolId.toBuffer(),
        owner.toBuffer(),
        // new BN(version).toBuffer()
        Buffer.from(new BN(version).toArray()),
      ],
      programId,
    );
  }

  static async getAllInfo({
    connection,
    programId,
    poolIds,
    wallet,
    chainTime,
  }: {
    connection: Connection;
    programId: PublicKey;
    poolIds: PublicKey[];
    wallet: PublicKey;
    chainTime: number;
  }): Promise<SHOW_INFO[]> {
    if (poolIds.length === 0) return [];

    const allPoolPda = poolIds.map((id) => Utils1216.getPdaPoolId(programId, id).publicKey);

    const allOwnerPda: PublicKey[] = [];
    for (let itemVersion = 0; itemVersion < Utils1216.VERSION_PROJECT.length; itemVersion++) {
      allOwnerPda.push(
        ...allPoolPda.map((id) => Utils1216.getPdaOwnerId(programId, id, wallet, itemVersion).publicKey),
      );
    }

    const pdaInfo = await getMultipleAccountsInfo(connection, [...allPoolPda, ...allOwnerPda]);

    const info: SHOW_INFO[] = [];
    for (let index = 0; index < pdaInfo.length; index++) {
      const version = Math.floor(index / poolIds.length);
      const i = index % poolIds.length;

      const itemPoolId = allPoolPda[i];
      const itemOwnerId = allOwnerPda[index];
      const itemPoolInfoS = pdaInfo[i];
      const itemOwnerInfoS = pdaInfo[poolIds.length + index];
      if (!(itemPoolInfoS && itemOwnerInfoS)) continue;
      if (
        itemPoolInfoS.data.length !== Utils1216.POOL_LAYOUT.span ||
        itemOwnerInfoS.data.length !== Utils1216.OWNER_LAYOUT.span
      )
        continue;

      const itemPoolInfo = Utils1216.POOL_LAYOUT.decode(itemPoolInfoS.data);
      const itemOwnerInfo = Utils1216.OWNER_LAYOUT.decode(itemOwnerInfoS.data);

      const openTime = itemPoolInfo.openTime.toNumber();
      const endTime = itemPoolInfo.endTime.toNumber();

      const hasCanClaimToken =
        itemOwnerInfo.tokenInfo.map((i) => i.debtAmount.gt(new BN(0))).filter((i) => !i).length !== 3;
      const inCanClaimTime = chainTime > openTime && chainTime < endTime && itemPoolInfo.status === 1;

      const canClaim = hasCanClaimToken && inCanClaimTime;

      info.push({
        programId,
        poolId: itemPoolId,
        ammId: itemPoolInfo.ammId,
        ownerAccountId: itemOwnerId,
        snapshotLpAmount: itemOwnerInfo.lpAmount,

        project: Utils1216.VERSION_PROJECT[version],

        openTime,
        endTime,

        canClaim,
        canClaimErrorType: !hasCanClaimToken ? "alreadyClaimIt" : !inCanClaimTime ? "outOfOperationalTime" : undefined,

        tokenInfo: itemPoolInfo.tokenInfo.map((itemPoolToken, i) => ({
          mintAddress: itemPoolToken.mintAddress,
          mintVault: itemPoolToken.mintVault,
          mintDecimals: itemPoolToken.mintDecimals,
          perLpLoss: itemPoolToken.perLpLoss,
          debtAmount: itemOwnerInfo.tokenInfo[i].debtAmount.add(itemOwnerInfo.tokenInfo[i].claimedAmount),
        })),
      });
    }

    return info;
  }

  public async makeClaimTransaction({
    poolInfo,
    ownerInfo,
    feePayer,
  }: {
    connection: Connection;
    poolInfo: SHOW_INFO;
    ownerInfo: {
      wallet?: PublicKey;
      associatedOnly: boolean;
    };
    feePayer?: PublicKey;
  }): Promise<
    {
      transaction: Transaction;
      signer: Signer[];
    }[]
  > {
    if (!ownerInfo.wallet) this.scope.checkOwner();
    const txBuilder = this.createTxBuilder(feePayer);
    const wallet = ownerInfo.wallet || this.scope.ownerPubKey;

    const ownerVaultList: PublicKey[] = [];
    for (const itemToken of poolInfo.tokenInfo) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        mint: itemToken.mintAddress,
        owner: this.scope.ownerPubKey,
        notUseTokenAccount: itemToken.mintAddress.equals(Token.WSOL.mint),
        createInfo: {
          payer: wallet,
          amount: 0,
        },
        skipCloseAccount: !itemToken.mintAddress.equals(Token.WSOL.mint),

        associatedOnly: itemToken.mintAddress.equals(Token.WSOL.mint) ? false : ownerInfo.associatedOnly,
      });
      instructionParams && txBuilder.addInstruction(instructionParams);
      ownerVaultList.push(account!);
    }

    txBuilder.addInstruction({
      instructions: [
        Utils1216.makeClaimInstruction({
          programId: poolInfo.programId,
          poolInfo,
          ownerInfo: {
            wallet,
            ownerPda: poolInfo.ownerAccountId,
            claimAddress: ownerVaultList,
          },
        }),
      ],
    });
    const { transaction, signers } = txBuilder.build();

    return [
      {
        transaction,
        signer: signers,
      },
    ];
  }

  public async makeClaimAllTransaction({
    poolInfos,
    ownerInfo,
    feePayer,
  }: {
    poolInfos: SHOW_INFO[];
    ownerInfo: {
      wallet?: PublicKey;
      associatedOnly: boolean;
    };
    feePayer?: PublicKey;
  }): Promise<
    {
      transaction: Transaction;
      signer: Signer[];
    }[]
  > {
    const txBuilder = this.createTxBuilder(feePayer);
    const wallet = ownerInfo.wallet || this.scope.ownerPubKey;

    const tempNewVault: { [mint: string]: PublicKey } = {};

    for (const poolInfo of poolInfos) {
      const ownerVaultList: PublicKey[] = [];
      for (const itemToken of poolInfo.tokenInfo) {
        const { account: tempVault, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          mint: itemToken.mintAddress,
          owner: this.scope.ownerPubKey,
          notUseTokenAccount: itemToken.mintAddress.equals(Token.WSOL.mint),
          createInfo: {
            payer: wallet,
            amount: 0,
          },
          skipCloseAccount: !itemToken.mintAddress.equals(Token.WSOL.mint),

          associatedOnly: itemToken.mintAddress.equals(Token.WSOL.mint) ? false : ownerInfo.associatedOnly,
        });
        instructionParams && txBuilder.addInstruction(instructionParams);

        if (tempVault) {
          tempNewVault[itemToken.mintAddress.toString()] = tempVault;
          ownerVaultList.push(tempVault);
        }
      }

      txBuilder.addInstruction({
        instructions: [
          Utils1216.makeClaimInstruction({
            programId: poolInfo.programId,
            poolInfo,
            ownerInfo: {
              wallet,
              ownerPda: poolInfo.ownerAccountId,
              claimAddress: ownerVaultList,
            },
          }),
        ],
      });
    }

    const { transaction, signers } = txBuilder.build();
    const instructions = txBuilder.allInstructions;

    if (forecastTransactionSize(instructions, [wallet, ...signers.map((s) => s.publicKey)])) {
      return [
        {
          transaction,
          signer: signers,
        },
      ];
    } else {
      return [
        {
          transaction: new Transaction().add(...instructions.slice(0, txBuilder.AllTxData.instructions.length - 1)),
          signer: signers,
        },
        {
          transaction: new Transaction().add(...instructions.slice(txBuilder.AllTxData.instructions.length - 1)),
          signer: [],
        },
        { transaction: new Transaction().add(...txBuilder.AllTxData.endInstructions), signer: [] },
      ];
    }
  }

  static makeClaimInstruction({
    programId,
    poolInfo,
    ownerInfo,
  }: {
    programId: PublicKey;

    poolInfo: SHOW_INFO;
    ownerInfo: {
      wallet: PublicKey;
      ownerPda: PublicKey;
      claimAddress: PublicKey[];
    };
  }): TransactionInstruction {
    const dataLayout = struct([]);

    const keys = [
      { pubkey: ownerInfo.wallet, isSigner: true, isWritable: true },
      { pubkey: poolInfo.poolId, isSigner: false, isWritable: true },
      { pubkey: ownerInfo.ownerPda, isSigner: false, isWritable: true },

      ...ownerInfo.claimAddress.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      ...poolInfo.tokenInfo.map(({ mintVault }) => ({ pubkey: mintVault, isSigner: false, isWritable: true })),

      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode({}, data);
    const aData = Buffer.from([...[10, 66, 208, 184, 161, 6, 191, 98], ...data]);

    return new TransactionInstruction({
      keys,
      programId,
      data: aData,
    });
  }
}
