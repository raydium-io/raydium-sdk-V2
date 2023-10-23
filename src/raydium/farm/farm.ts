import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { accountMeta, AddInstructionParam, commonSystemAccountMeta } from "../../common";
import { parseBigNumberish, BN_ZERO } from "../../common/bignumber";
import { PublicKeyish, SOLMint, WSOLMint, validateAndParsePublicKey } from "../../common/pubKey";
import { InstructionType } from "../../common/txTool/txType";
import { getATAAddress } from "../../common/pda";
import { FARM_PROGRAM_ID_V6 } from "../../common/programId";

import { Token as RToken } from "../../module/token";
import { createWSolAccountInstructions } from "../account/instruction";
import ModuleBase from "../moduleBase";
import { TOKEN_WSOL } from "../token/constant";
import { MakeTransaction } from "../type";

import {
  FARM_LOCK_MINT,
  FARM_LOCK_VAULT,
  farmDespotVersionToInstruction,
  farmWithdrawVersionToInstruction,
  poolTypeV6,
  validateFarmRewards,
  FARM_PROGRAM_TO_VERSION,
} from "./config";
import {
  createAssociatedLedgerAccountInstruction,
  makeCreateFarmInstruction,
  makeCreatorWithdrawFarmRewardInstruction,
  makeDepositWithdrawInstruction,
} from "./instruction";
import { farmAddRewardLayout, farmRewardRestartLayout, farmStateV6Layout } from "./layout";
import {
  CreateFarm,
  FarmDWParam,
  FarmPoolJsonInfo,
  FarmRewardInfo,
  FarmRewardInfoConfig,
  RewardInfoKey,
  SdkParsedFarmInfo,
  UpdateFarmReward,
  HydratedFarmInfo,
} from "./type";
import {
  calFarmRewardAmount,
  farmRewardInfoToConfig,
  getAssociatedAuthority,
  getAssociatedLedgerAccount,
  getAssociatedLedgerPoolAccount,
  getFarmLedgerLayout,
} from "./util";
import { FormatFarmInfoOut } from "../../api/type";

export default class Farm extends ModuleBase {
  private _farmPools: FarmPoolJsonInfo[] = [];
  private _hydratedFarmPools: HydratedFarmInfo[] = [];
  private _hydratedFarmMap: Map<string, HydratedFarmInfo> = new Map();
  private _sdkParsedFarmPools: SdkParsedFarmInfo[] = [];
  private _sdkParsedFarmMap: Map<string, SdkParsedFarmInfo> = new Map();
  private _lpTokenInfoMap: Map<string, RToken> = new Map();
  public farmAPRs: Record<
    string,
    {
      apr30d: number;
      apr7d: number;
      apr24h: number;
    }
  > = {};

  get allFarms(): FarmPoolJsonInfo[] {
    return this._farmPools;
  }
  get allParsedFarms(): SdkParsedFarmInfo[] {
    return this._sdkParsedFarmPools;
  }
  get allParsedFarmMap(): Map<string, SdkParsedFarmInfo> {
    return this._sdkParsedFarmMap;
  }
  get allHydratedFarms(): HydratedFarmInfo[] {
    return this._hydratedFarmPools;
  }
  get allHydratedFarmMap(): Map<string, HydratedFarmInfo> {
    return this._hydratedFarmMap;
  }

  public getFarm(farmId: PublicKeyish): FarmPoolJsonInfo {
    const _farmId = validateAndParsePublicKey({ publicKey: farmId });
    const farmInfo = this.allFarms.find((farm) => farm.id === _farmId.toBase58());
    if (!farmInfo) this.logAndCreateError("invalid farm id");
    return farmInfo!;
  }
  public getParsedFarm(farmId: PublicKeyish): SdkParsedFarmInfo {
    const _farmId = validateAndParsePublicKey({ publicKey: farmId });
    const farmInfo = this.allParsedFarms.find((farm) => _farmId.equals(farm.id));
    if (!farmInfo) this.logAndCreateError("invalid farm id");
    return farmInfo!;
  }
  // token account needed
  private async _getUserRewardInfo({ payer, rewardInfo }: { payer: PublicKey; rewardInfo: FarmRewardInfo }): Promise<{
    rewardPubKey?: PublicKey;
    newInstruction?: AddInstructionParam;
  }> {
    if (rewardInfo.rewardMint.equals(SOLMint)) {
      const txInstructions = await createWSolAccountInstructions({
        connection: this.scope.connection,
        owner: this.scope.ownerPubKey,
        payer,
        amount: calFarmRewardAmount(rewardInfo),
      });
      return {
        rewardPubKey: txInstructions.addresses.newAccount,
        newInstruction: txInstructions,
      };
    }

    return {
      rewardPubKey: await this.scope.account.getCreatedTokenAccount({
        mint: rewardInfo.rewardMint,
      })!,
    };
  }

  // token account needed
  public async create({ poolInfo: propPoolInfo, rewardInfos, payer }: CreateFarm): Promise<MakeTransaction> {
    this.checkDisabled();
    this.scope.checkOwner();

    const lpMint = new PublicKey(propPoolInfo.lpMint.address);
    const poolInfo = {
      lpMint,
      lockInfo: { lockMint: FARM_LOCK_MINT, lockVault: FARM_LOCK_VAULT },
      version: 6,
      rewardInfos,
      programId: new PublicKey(propPoolInfo.programId),
    };

    const txBuilder = this.createTxBuilder();
    const payerPubKey = payer ?? this.scope.ownerPubKey;
    const farmKeyPair = Keypair.generate();
    const lamports = await this.scope.connection.getMinimumBalanceForRentExemption(farmStateV6Layout.span);

    txBuilder.addInstruction({
      instructions: [
        SystemProgram.createAccount({
          fromPubkey: payerPubKey,
          newAccountPubkey: farmKeyPair.publicKey,
          lamports,
          space: farmStateV6Layout.span,
          programId: poolInfo.programId,
        }),
      ],
      signers: [farmKeyPair],
    });

    const { publicKey: authority, nonce } = await getAssociatedAuthority({
      programId: new PublicKey(poolInfo.programId),
      poolId: farmKeyPair.publicKey,
    });

    const lpVault = await getAssociatedLedgerPoolAccount({
      programId: poolInfo.programId,
      poolId: farmKeyPair.publicKey,
      mint: poolInfo.lpMint,
      type: "lpVault",
    });

    const rewardInfoConfig: FarmRewardInfoConfig[] = [];
    const rewardInfoKey: RewardInfoKey[] = [];

    for (const rewardInfo of poolInfo.rewardInfos) {
      if (rewardInfo.rewardOpenTime >= rewardInfo.rewardEndTime)
        this.logAndCreateError("start time error", "rewardInfo.rewardOpenTime", rewardInfo.rewardOpenTime.toString());
      if (isNaN(poolTypeV6[rewardInfo.rewardType])) this.logAndCreateError("rewardType error", rewardInfo.rewardType);
      if (Number(rewardInfo.rewardPerSecond.toString()) <= 0)
        this.logAndCreateError("rewardPerSecond error", rewardInfo.rewardPerSecond.toString());

      rewardInfoConfig.push(farmRewardInfoToConfig(rewardInfo));

      const { rewardPubKey, newInstruction } = await this._getUserRewardInfo({
        rewardInfo,
        payer: payerPubKey,
      });
      if (newInstruction) txBuilder.addInstruction(newInstruction);

      if (!rewardPubKey) this.logAndCreateError("cannot found target token accounts", this.scope.account.tokenAccounts);

      const rewardMint = rewardInfo.rewardMint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.mint) : rewardInfo.rewardMint;
      // newRewardInfo.rewardMint.equals(PublicKey.default) ? Token.WSOL.mint : newRewardInfo.rewardMint
      rewardInfoKey.push({
        rewardMint,
        rewardVault: await getAssociatedLedgerPoolAccount({
          programId: poolInfo.programId,
          poolId: farmKeyPair.publicKey,
          mint: rewardMint,
          type: "rewardVault",
        }),
        userRewardToken: rewardPubKey!,
      });
    }

    const lockUserAccount = await this.scope.account.getCreatedTokenAccount({
      mint: poolInfo.lockInfo.lockMint,
    });

    if (!lockUserAccount)
      this.logAndCreateError("cannot found lock vault", "tokenAccounts", this.scope.account.tokenAccounts);

    const { instruction, instructionType } = makeCreateFarmInstruction({
      farmKeyPair,
      owner: this.scope.ownerPubKey,
      farmAuthority: authority,
      lpVault,
      lpMint: poolInfo.lpMint,
      lockVault: poolInfo.lockInfo.lockVault,
      lockMint: poolInfo.lockInfo.lockMint,
      lockUserAccount,
      programId: poolInfo.programId,
      rewardInfo: rewardInfoKey,
      rewardInfoConfig,
      nonce,
    });

    return await txBuilder
      .addInstruction({
        instructions: [instruction],
        instructionTypes: [instructionType],
      })
      .build();
  }

  // token account needed
  public async restartReward({ farmId, payer, newRewardInfo }: UpdateFarmReward): Promise<MakeTransaction> {
    const farmInfo = this.getFarm(farmId)!;
    if (farmInfo!.version !== 6) this.logAndCreateError("invalid farm version", farmInfo!.version);

    const poolKeys = {
      id: new PublicKey(farmInfo.id),
      rewardInfos: farmInfo.rewardInfos,
      lpVault: new PublicKey(farmInfo.lpVault),
      programId: new PublicKey(farmInfo.programId),
    };

    if (newRewardInfo.rewardOpenTime >= newRewardInfo.rewardEndTime)
      this.logAndCreateError("start time error", "newRewardInfo", newRewardInfo);

    const payerPubKey = payer || this.scope.ownerPubKey;

    const rewardMint = newRewardInfo.rewardMint.equals(SOLMint)
      ? new PublicKey(TOKEN_WSOL.mint)
      : newRewardInfo.rewardMint;
    const rewardInfo = poolKeys.rewardInfos.find((item) => new PublicKey(item.rewardMint).equals(rewardMint));

    if (!rewardInfo) this.logAndCreateError("configuration does not exist", "rewardMint", rewardMint);

    const rewardVault = rewardInfo!.rewardVault ? new PublicKey(rewardInfo!.rewardVault) : SOLMint;
    const txBuilder = this.createTxBuilder();

    const { rewardPubKey: userRewardTokenPub, newInstruction } = await this._getUserRewardInfo({
      rewardInfo: newRewardInfo,
      payer: payerPubKey,
    });
    if (newInstruction) txBuilder.addInstruction(newInstruction);

    if (!userRewardTokenPub)
      this.logAndCreateError("cannot found target token accounts", this.scope.account.tokenAccounts);

    const data = Buffer.alloc(farmRewardRestartLayout.span);
    farmRewardRestartLayout.encode(
      {
        instruction: 3,
        rewardReopenTime: parseBigNumberish(newRewardInfo.rewardOpenTime),
        rewardEndTime: parseBigNumberish(newRewardInfo.rewardEndTime),
        rewardPerSecond: parseBigNumberish(newRewardInfo.rewardPerSecond),
      },
      data,
    );

    const keys = [
      accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
      accountMeta({ pubkey: poolKeys.id }),
      accountMeta({ pubkey: poolKeys.lpVault, isWritable: false }),
      accountMeta({ pubkey: rewardVault }),
      accountMeta({ pubkey: userRewardTokenPub! }),
      accountMeta({ pubkey: this.scope.ownerPubKey, isWritable: false, isSigner: true }),
    ];

    return txBuilder
      .addInstruction({
        instructions: [new TransactionInstruction({ programId: poolKeys.programId, keys, data })],
        instructionTypes: [InstructionType.FarmV6Restart],
      })
      .build();
  }

  // token account needed
  public async addNewRewardToken(params: UpdateFarmReward): Promise<MakeTransaction> {
    const { farmId, newRewardInfo, payer } = params;
    const farmInfo = this.getFarm(farmId)!;
    if (farmInfo!.version !== 6) this.logAndCreateError("invalid farm version", farmInfo!.version);
    const payerPubKey = payer ?? this.scope.ownerPubKey;
    const txBuilder = this.createTxBuilder();

    const rewardVault = getAssociatedLedgerPoolAccount({
      programId: new PublicKey(farmInfo.programId),
      poolId: new PublicKey(farmInfo.id),
      mint: newRewardInfo.rewardMint.equals(PublicKey.default) ? WSOLMint : newRewardInfo.rewardMint,
      type: "rewardVault",
    });

    const { rewardPubKey: userRewardTokenPub, newInstruction } = await this._getUserRewardInfo({
      rewardInfo: newRewardInfo,
      payer: payerPubKey,
    });
    if (newInstruction) txBuilder.addInstruction(newInstruction);

    if (!userRewardTokenPub)
      this.logAndCreateError("annot found target token accounts", this.scope.account.tokenAccounts);

    const rewardMint = newRewardInfo.rewardMint.equals(SOLMint)
      ? new PublicKey(TOKEN_WSOL.mint)
      : newRewardInfo.rewardMint;
    const data = Buffer.alloc(farmAddRewardLayout.span);
    farmAddRewardLayout.encode(
      {
        instruction: 4,
        isSet: new BN(1),
        rewardPerSecond: parseBigNumberish(newRewardInfo.rewardPerSecond),
        rewardOpenTime: parseBigNumberish(newRewardInfo.rewardOpenTime),
        rewardEndTime: parseBigNumberish(newRewardInfo.rewardEndTime),
      },
      data,
    );

    const keys = [
      ...commonSystemAccountMeta,
      accountMeta({ pubkey: new PublicKey(farmInfo.id) }),
      accountMeta({ pubkey: new PublicKey(farmInfo.authority), isWritable: false }),
      accountMeta({ pubkey: rewardMint, isWritable: false }),
      accountMeta({ pubkey: rewardVault }),
      accountMeta({ pubkey: userRewardTokenPub! }),
      accountMeta({ pubkey: this.scope.ownerPubKey, isWritable: false, isSigner: true }),
    ];

    return await txBuilder
      .addInstruction({
        instructions: [new TransactionInstruction({ programId: new PublicKey(farmInfo.programId), keys, data })],
        instructionTypes: [InstructionType.FarmV6CreatorAddReward],
      })
      .build();
  }

  public async deposit(params: FarmDWParam): Promise<MakeTransaction> {
    const { farmInfo, amount, feePayer, useSOLBalance, associatedOnly = true, checkCreateATAOwner = false } = params;

    if (this.scope.availability.addFarm === false)
      this.logAndCreateError("farm deposit feature disabled in your region");

    const { rewardInfos, programId } = farmInfo;
    const version = FARM_PROGRAM_TO_VERSION[programId];
    const [farmProgramId, farmId] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];
    const farmKeys = await this.scope.api.fetchFarmKeysById({ id: farmInfo.id });

    const ledger = getAssociatedLedgerAccount({
      programId: farmProgramId,
      poolId: farmId,
      owner: this.scope.ownerPubKey,
      version,
    });

    const txBuilder = this.createTxBuilder();
    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccounts) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.mint, item.programId).publicKey;
        if (item.publicKey && ata.equals(item.publicKey)) ownerMintToAccount[item.mint.toString()] = item.publicKey;
      } else {
        ownerMintToAccount[item.mint.toString()] = item.publicKey!;
      }
    }

    const lpMint = farmKeys.lpMint;
    const ownerLpTokenAccount = ownerMintToAccount[lpMint.address];
    if (!ownerLpTokenAccount) this.logAndCreateError("you don't have any lp", "lp zero", ownerMintToAccount);

    const rewardAccounts: PublicKey[] = [];
    for (const itemReward of rewardInfos) {
      const rewardUseSOLBalance = useSOLBalance && itemReward.mint.address === WSOLMint.toString();

      let ownerRewardAccount = ownerMintToAccount[itemReward.mint.address];

      if (!ownerRewardAccount) {
        const { account: _ownerRewardAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          mint: new PublicKey(itemReward.mint.address),
          notUseTokenAccount: rewardUseSOLBalance,
          createInfo: {
            payer: feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !rewardUseSOLBalance,
          associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerRewardAccount = _ownerRewardAccount!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }

      ownerMintToAccount[itemReward.mint.address] = ownerRewardAccount;
      rewardAccounts.push(ownerRewardAccount);
    }

    if (farmInfo.programId !== FARM_PROGRAM_ID_V6.toString() && !ledger) {
      const { instruction, instructionType } = createAssociatedLedgerAccountInstruction({
        id: farmId,
        programId: farmProgramId,
        version,
        ledger,
        owner: this.scope.ownerPubKey,
      });
      txBuilder.addInstruction({ instructions: [instruction], instructionTypes: [instructionType] });
    }

    const errorMsg = validateFarmRewards({
      version,
      rewardInfos,
      rewardTokenAccountsPublicKeys: rewardAccounts,
    });
    if (errorMsg) this.logAndCreateError(errorMsg);

    const newInstruction = makeDepositWithdrawInstruction({
      instruction: farmDespotVersionToInstruction(version),
      amount: parseBigNumberish(amount),
      owner: this.scope.ownerPubKey,
      farmInfo,
      farmKeys,
      lpAccount: ownerLpTokenAccount,
      rewardAccounts,
      deposit: true,
      version,
    });

    const insType = {
      3: InstructionType.FarmV3Deposit,
      5: InstructionType.FarmV5Deposit,
      6: InstructionType.FarmV6Deposit,
    };

    return txBuilder
      .addInstruction({
        instructions: [newInstruction],
        instructionTypes: [insType[version]],
      })
      .build();
  }

  public async withdraw(params: FarmDWParam): Promise<MakeTransaction> {
    const {
      farmInfo,
      amount,
      deposited,
      useSOLBalance,
      feePayer,
      associatedOnly = true,
      checkCreateATAOwner = false,
    } = params;
    const { rewardInfos } = farmInfo;

    if (this.scope.availability.removeFarm === false)
      this.logAndCreateError("farm withdraw feature disabled in your region");

    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    const farmKeys = await this.scope.api.fetchFarmKeysById({ id: farmInfo.id });
    const txBuilder = this.createTxBuilder();

    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccounts) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.mint).publicKey;
        if (item.publicKey && ata.equals(item.publicKey)) ownerMintToAccount[item.mint.toString()] = item.publicKey;
      } else {
        ownerMintToAccount[item.mint.toString()] = item.publicKey!;
      }
    }

    if (!deposited) {
      const ledger = getAssociatedLedgerAccount({
        programId: new PublicKey(farmInfo.programId),
        poolId: new PublicKey(farmInfo.id),
        owner: this.scope.ownerPubKey,
        version,
      });
      const ledgerData = await this.scope.connection.getAccountInfo(ledger);
      if (!ledgerData) this.logAndCreateError("no lp data", { farmId: farmInfo.id, version, ledgerData });
      const ledgerLayout = getFarmLedgerLayout(version)!;
      const ledgerInfo = ledgerLayout.decode(ledgerData!.data);
      if (ledgerInfo.deposited.isZero()) this.logAndCreateError("no deposited lp", { farmId: farmInfo.id });
    } else {
      if (deposited.isZero()) this.logAndCreateError("no deposited lp", { farmId: farmInfo.id });
    }

    const lpMint = farmKeys.lpMint.address;
    const lpMintUseSOLBalance = useSOLBalance && lpMint === WSOLMint.toString();

    let ownerLpTokenAccount = ownerMintToAccount[lpMint.toString()];
    if (!ownerLpTokenAccount) {
      const { account: _ownerRewardAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        mint: new PublicKey(lpMint),
        notUseTokenAccount: lpMintUseSOLBalance,
        createInfo: {
          payer: feePayer || this.scope.ownerPubKey,
          amount: 0,
        },
        owner: this.scope.ownerPubKey,
        skipCloseAccount: true,
        associatedOnly: lpMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
      ownerLpTokenAccount = _ownerRewardAccount!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }
    ownerMintToAccount[lpMint.toString()] = ownerLpTokenAccount;

    const rewardAccounts: PublicKey[] = [];
    for (const itemReward of rewardInfos) {
      const rewardUseSOLBalance = useSOLBalance && itemReward.mint.address === WSOLMint.toString();

      let ownerRewardAccount = ownerMintToAccount[itemReward.mint.address];
      if (!ownerRewardAccount) {
        const { account: _ownerRewardAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          mint: new PublicKey(itemReward.mint.address),
          notUseTokenAccount: rewardUseSOLBalance,
          createInfo: {
            payer: feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !rewardUseSOLBalance,
          associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerRewardAccount = _ownerRewardAccount!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }

      ownerMintToAccount[itemReward.mint.address] = ownerRewardAccount;
      rewardAccounts.push(ownerRewardAccount);
    }

    const errorMsg = validateFarmRewards({
      version,
      rewardInfos,
      rewardTokenAccountsPublicKeys: rewardAccounts,
    });
    if (errorMsg) this.logAndCreateError(errorMsg);

    const newInstruction = makeDepositWithdrawInstruction({
      instruction: farmWithdrawVersionToInstruction(version),
      amount: parseBigNumberish(amount),
      owner: this.scope.ownerPubKey,
      farmInfo,
      farmKeys,
      lpAccount: ownerLpTokenAccount,
      rewardAccounts,
      version,
    });

    const insType = {
      3: InstructionType.FarmV3Withdraw,
      5: InstructionType.FarmV5Withdraw,
      6: InstructionType.FarmV6Withdraw,
    };

    return txBuilder
      .addInstruction({
        instructions: [newInstruction],
        instructionTypes: [insType[version]],
      })
      .build();
  }

  // token account needed
  public async withdrawFarmReward({
    farmId,
    withdrawMint,
  }: {
    farmId: PublicKey;
    withdrawMint: PublicKey;
    payer?: PublicKey;
  }): Promise<MakeTransaction> {
    this.scope.checkOwner();
    const farmInfo = this.getParsedFarm(farmId);
    const { version } = farmInfo;
    if (version !== 6) this.logAndCreateError("invalid farm version", farmInfo!.version);

    const rewardInfo = farmInfo.rewardInfos.find((item) =>
      item.rewardMint.equals(withdrawMint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.mint) : withdrawMint),
    );
    if (!rewardInfo) this.logAndCreateError("withdraw mint error", "rewardInfos", farmInfo);

    const rewardVault = rewardInfo?.rewardVault ?? SOLMint;
    const txBuilder = this.createTxBuilder();

    let userRewardToken: PublicKey;

    if (withdrawMint.equals(SOLMint)) {
      const txInstruction = await createWSolAccountInstructions({
        connection: this.scope.connection,
        owner: this.scope.ownerPubKey,
        payer: this.scope.ownerPubKey,
        amount: calFarmRewardAmount(rewardInfo!),
      });
      userRewardToken = txInstruction.addresses.newAccount;
      txBuilder.addInstruction(txInstruction);
    } else {
      const selectUserRewardToken = await this.scope.account.getCreatedTokenAccount({
        mint: withdrawMint,
      });

      if (selectUserRewardToken === null) {
        userRewardToken = await this.scope.account.getAssociatedTokenAccount(withdrawMint);
        txBuilder.addInstruction({
          instructions: [
            createAssociatedTokenAccountInstruction(
              this.scope.ownerPubKey,
              userRewardToken,
              this.scope.ownerPubKey,
              withdrawMint,
            ),
          ],
          instructionTypes: [InstructionType.CreateATA],
        });
      } else {
        userRewardToken = selectUserRewardToken!;
      }
    }

    const { instruction, instructionType } = makeCreatorWithdrawFarmRewardInstruction({
      programId: farmInfo.programId,
      id: farmInfo.id,
      authority: farmInfo.authority,
      lpVault: farmInfo.lpVault.mint,
      rewardVault,
      userRewardToken,
      owner: this.scope.ownerPubKey,
    });

    return await txBuilder
      .addInstruction({
        instructions: [instruction],
        instructionTypes: [instructionType],
      })
      .build();
  }

  public async harvestAllRewards(params: {
    farmInfo: FormatFarmInfoOut;
    feePayer?: PublicKey;
    useSOLBalance?: boolean;
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
  }): Promise<MakeTransaction> {
    const { farmInfo, useSOLBalance, feePayer, associatedOnly = true, checkCreateATAOwner = false } = params;
    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    const txBuilder = this.createTxBuilder();

    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccounts) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.mint).publicKey;
        if (item.publicKey && ata.equals(item.publicKey)) ownerMintToAccount[item.mint.toString()] = item.publicKey;
      } else {
        ownerMintToAccount[item.mint.toString()] = item.publicKey!;
      }
    }

    for (const { lpVault, wrapped, apiPoolInfo } of Object.values(farmInfo)) {
      if (wrapped === undefined || wrapped.pendingRewards.find((i) => i.gt(BN_ZERO)) === undefined) continue;

      const lpMint = lpVault.mint;
      const lpMintUseSOLBalance = useSOLBalance && lpMint.equals(WSOLMint);
      let ownerLpTokenAccount = ownerMintToAccount[lpMint.toString()];

      if (!ownerLpTokenAccount) {
        const { account: _ownerLpAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          mint: lpMint,
          notUseTokenAccount: lpMintUseSOLBalance,
          createInfo: {
            payer: feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          owner: this.scope.ownerPubKey,
          skipCloseAccount: true,
          associatedOnly: lpMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerLpTokenAccount = _ownerLpAccount!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }
      ownerMintToAccount[lpMint.toString()] = ownerLpTokenAccount;

      const rewardAccounts: PublicKey[] = [];
      for (const itemReward of apiPoolInfo.rewardInfos) {
        const rewardUseSOLBalance = useSOLBalance && itemReward.rewardMint.equals(WSOLMint);

        let ownerRewardAccount = ownerMintToAccount[itemReward.rewardMint.toString()];
        if (!ownerRewardAccount) {
          const { account: _ownerRewardAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
            mint: itemReward.rewardMint,
            notUseTokenAccount: rewardUseSOLBalance,
            createInfo: {
              payer: feePayer || this.scope.ownerPubKey,
              amount: 0,
            },
            owner: this.scope.ownerPubKey,
            skipCloseAccount: !rewardUseSOLBalance,
            associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
            checkCreateATAOwner,
          });
          ownerRewardAccount = _ownerRewardAccount!;
          instructionParams && txBuilder.addInstruction(instructionParams);
        }

        ownerMintToAccount[itemReward.rewardMint.toString()] = ownerRewardAccount;
        rewardAccounts.push(ownerRewardAccount);
      }

      const withdrawInstruction = makeDepositWithdrawInstruction({
        instruction: farmWithdrawVersionToInstruction(version),
        amount: BN_ZERO,
        owner: this.scope.ownerPubKey,
        farmInfo: farmInfo as any, // to do
        lpAccount: ownerLpTokenAccount,
        rewardAccounts,
        version,
        farmKeys: farmInfo as any, // to do
      });

      const insType = {
        3: InstructionType.FarmV3Withdraw,
        5: InstructionType.FarmV5Withdraw,
        6: InstructionType.FarmV6Withdraw,
      };

      txBuilder.addInstruction({
        instructions: [withdrawInstruction],
        instructionTypes: [insType[version]],
      });
    }

    return txBuilder.build();
  }
}
