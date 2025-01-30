import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { parseBigNumberish } from "@/common";

import { FormatFarmKeyOut } from "../../api/type";
import { AddInstructionParam, jsonInfo2PoolKeys } from "@/common";
import { BN_ZERO } from "@/common/bignumber";
import { getATAAddress } from "@/common/pda";
import { FARM_PROGRAM_ID_V6 } from "@/common/programId";
import { SOLMint, solToWSol, WSOLMint } from "@/common/pubKey";
import { MakeMultiTxData, MakeTxData } from "@/common/txTool/txTool";
import { InstructionType, TxVersion } from "@/common/txTool/txType";
import { generatePubKey } from "../account/util";

import Decimal from "decimal.js";
import { FormatFarmInfoOut, FormatFarmKeyOutV6 } from "../../api/type";
import { ComputeBudgetConfig, TxTipConfig } from "../../raydium/type";
import { createWSolAccountInstructions } from "../account/instruction";
import ModuleBase from "../moduleBase";
import { TOKEN_WSOL } from "../token/constant";
import {
  FARM_LOCK_MINT,
  FARM_LOCK_VAULT,
  FARM_PROGRAM_TO_VERSION,
  isValidFarmVersion,
  poolTypeV6,
  validateFarmRewards,
} from "./config";
import {
  createAssociatedLedgerAccountInstruction,
  makeAddNewRewardInstruction,
  makeCreateFarmInstruction,
  makeCreatorWithdrawFarmRewardInstruction,
  makeDepositInstructionV3,
  makeDepositInstructionV5,
  makeDepositInstructionV6,
  makeRestartRewardInstruction,
  makeWithdrawInstructionV3,
  makeWithdrawInstructionV4,
  makeWithdrawInstructionV5,
  makeWithdrawInstructionV6,
} from "./instruction";
import { FarmLedger, farmStateV6Layout } from "./layout";
import {
  CreateFarm,
  CreateFarmExtInfo,
  FarmDWParam,
  FarmRewardInfo,
  FarmRewardInfoConfig,
  RewardInfoKey,
  UpdateFarmReward,
  UpdateFarmRewards,
} from "./type";
import {
  calFarmRewardAmount,
  farmRewardInfoToConfig,
  getAssociatedAuthority,
  getAssociatedLedgerAccount,
  getAssociatedLedgerPoolAccount,
  getFarmLedgerLayout,
} from "./util";

export default class Farm extends ModuleBase {
  // token account needed
  private async _getUserRewardInfo({ payer, rewardInfo }: { payer: PublicKey; rewardInfo: FarmRewardInfo }): Promise<{
    rewardPubKey?: PublicKey;
    newInstruction?: AddInstructionParam;
  }> {
    if (rewardInfo.mint.equals(SOLMint)) {
      const txInstructions = await createWSolAccountInstructions({
        connection: this.scope.connection,
        owner: this.scope.ownerPubKey,
        payer,
        amount: calFarmRewardAmount({
          ...rewardInfo,
          openTime: rewardInfo.openTime.toString(),
          endTime: rewardInfo.endTime.toString(),
        }),
      });
      return {
        rewardPubKey: txInstructions.addresses.newAccount,
        newInstruction: txInstructions,
      };
    }

    return {
      rewardPubKey: await this.scope.account.getCreatedTokenAccount({
        mint: rewardInfo.mint,
        associatedOnly: false,
      })!,
    };
  }

  // token account needed
  public async create<T extends TxVersion>({
    poolInfo: propPoolInfo,
    rewardInfos,
    payer,
    programId = FARM_PROGRAM_ID_V6,
    txVersion,
    feePayer,
  }: CreateFarm<T>): Promise<MakeTxData<T, CreateFarmExtInfo>> {
    this.checkDisabled();
    this.scope.checkOwner();

    const lpMint = new PublicKey(propPoolInfo.lpMint.address);
    const poolInfo = {
      lpMint,
      lockInfo: { lockMint: FARM_LOCK_MINT, lockVault: FARM_LOCK_VAULT },
      version: 6,
      rewardInfos,
      programId,
    };

    const txBuilder = this.createTxBuilder(feePayer);
    const payerPubKey = payer ?? this.scope.ownerPubKey;
    const farmKeyPair = generatePubKey({ fromPublicKey: payerPubKey, programId: poolInfo.programId });
    const lamports = await this.scope.connection.getMinimumBalanceForRentExemption(farmStateV6Layout.span);

    txBuilder.addInstruction({
      instructions: [
        SystemProgram.createAccountWithSeed({
          fromPubkey: payerPubKey,
          basePubkey: payerPubKey,
          seed: farmKeyPair.seed,
          newAccountPubkey: farmKeyPair.publicKey,
          lamports,
          space: farmStateV6Layout.span,
          programId: poolInfo.programId,
        }),
      ],
    });

    const { publicKey: authority, nonce } = getAssociatedAuthority({
      programId: new PublicKey(poolInfo.programId),
      poolId: farmKeyPair.publicKey,
    });

    const lpVault = getAssociatedLedgerPoolAccount({
      programId: poolInfo.programId,
      poolId: farmKeyPair.publicKey,
      mint: poolInfo.lpMint,
      type: "lpVault",
    });

    const rewardInfoConfig: FarmRewardInfoConfig[] = [];
    const rewardInfoKey: RewardInfoKey[] = [];

    for (const rewardInfo of poolInfo.rewardInfos) {
      if (rewardInfo.openTime >= rewardInfo.endTime)
        this.logAndCreateError("start time error", "rewardInfo.rewardOpenTime", rewardInfo.openTime.toString());
      if (isNaN(poolTypeV6[rewardInfo.rewardType])) this.logAndCreateError("rewardType error", rewardInfo.rewardType);
      if (Number(rewardInfo.perSecond) <= 0) this.logAndCreateError("rewardPerSecond error", rewardInfo.perSecond);

      rewardInfoConfig.push(farmRewardInfoToConfig(rewardInfo));

      const { rewardPubKey, newInstruction } = await this._getUserRewardInfo({
        rewardInfo,
        payer: payerPubKey,
      });
      if (newInstruction) txBuilder.addInstruction(newInstruction);

      if (!rewardPubKey) this.logAndCreateError("cannot found target token accounts", this.scope.account.tokenAccounts);

      const rewardMint = rewardInfo.mint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.address) : rewardInfo.mint;
      rewardInfoKey.push({
        rewardMint,
        rewardVault: getAssociatedLedgerPoolAccount({
          programId: poolInfo.programId,
          poolId: farmKeyPair.publicKey,
          mint: rewardMint,
          type: "rewardVault",
        }),
        userRewardToken: rewardPubKey!,
      });
    }

    const { account: lockUserAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
      mint: new PublicKey(poolInfo.lockInfo.lockMint),
      owner: this.scope.ownerPubKey,
      skipCloseAccount: false,
      createInfo: {
        payer: this.scope.ownerPubKey,
        amount: 0,
      },
      associatedOnly: false,
    });
    instructionParams && txBuilder.addInstruction(instructionParams);
    if (!lockUserAccount)
      this.logAndCreateError("cannot found lock vault", "tokenAccounts", this.scope.account.tokenAccounts);

    const { instruction, instructionType } = makeCreateFarmInstruction({
      farmId: farmKeyPair.publicKey,
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

    return txBuilder
      .addInstruction({
        instructions: [instruction],
        instructionTypes: [instructionType],
      })
      .versionBuild<CreateFarmExtInfo>({
        txVersion,
        extInfo: {
          farmId: farmKeyPair.publicKey,
          farmAuthority: authority,
          lpVault,
          lockUserAccount: lockUserAccount!,
          nonce,
        },
      }) as Promise<MakeTxData<T, CreateFarmExtInfo>>;
  }

  public async restartReward<T extends TxVersion>({
    farmInfo,
    payer,
    newRewardInfo,
    txVersion,
    feePayer,
  }: UpdateFarmReward): Promise<MakeTxData<T>> {
    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    if (version !== 6) this.logAndCreateError("invalid farm version ", version);

    const farmInfoKeys = jsonInfo2PoolKeys((await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0]);

    const farmKeys = {
      id: farmInfoKeys.id,
      rewardInfos: farmInfo.rewardInfos,
      lpVault: farmInfoKeys.lpVault,
      programId: farmInfoKeys.programId,
    };

    if (newRewardInfo.openTime >= newRewardInfo.endTime)
      this.logAndCreateError("start time error", "newRewardInfo", newRewardInfo);

    const payerPubKey = payer || this.scope.ownerPubKey;

    const rewardMint = newRewardInfo.mint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.address) : newRewardInfo.mint;
    const rewardInfoIndex = farmKeys.rewardInfos.findIndex((item) =>
      new PublicKey(item.mint.address).equals(rewardMint),
    );
    const rewardInfo = farmInfoKeys.rewardInfos[rewardInfoIndex];

    if (!rewardInfo) this.logAndCreateError("configuration does not exist", "rewardMint", rewardMint);

    const rewardVault = rewardInfo!.vault ?? SOLMint;
    const txBuilder = this.createTxBuilder(feePayer);

    const { rewardPubKey: userRewardTokenPub, newInstruction } = await this._getUserRewardInfo({
      rewardInfo: newRewardInfo,
      payer: payerPubKey,
    });
    if (newInstruction) txBuilder.addInstruction(newInstruction);

    if (!userRewardTokenPub)
      this.logAndCreateError("cannot found target token accounts", this.scope.account.tokenAccounts);

    return txBuilder
      .addInstruction({
        instructions: [
          makeRestartRewardInstruction({
            payer: this.scope.ownerPubKey,
            rewardVault,
            userRewardTokenPub: userRewardTokenPub!,
            farmKeys,
            rewardInfo: newRewardInfo,
          }),
        ],
        instructionTypes: [InstructionType.FarmV6Restart],
      })
      .versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async restartRewards<T extends TxVersion>({
    farmInfo,
    payer,
    newRewardInfos,
    txVersion,
    feePayer,
  }: UpdateFarmRewards<T>): Promise<MakeTxData<T>> {
    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    if (version !== 6) this.logAndCreateError("invalid farm version ", version);

    const farmInfoKeys = jsonInfo2PoolKeys((await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0]);

    const farmKeys = {
      id: farmInfoKeys.id,
      rewardInfos: farmInfo.rewardInfos,
      lpVault: farmInfoKeys.lpVault,
      programId: farmInfoKeys.programId,
    };

    newRewardInfos.forEach((reward) => {
      if (reward.openTime >= reward.endTime) this.logAndCreateError("start time error", "newRewardInfo", reward);
    });

    const payerPubKey = payer || this.scope.ownerPubKey;
    const txBuilder = this.createTxBuilder(feePayer);

    for (const itemReward of newRewardInfos) {
      const rewardMint = itemReward.mint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.address) : itemReward.mint;
      const rewardInfoIndex = farmKeys.rewardInfos.findIndex((item) =>
        new PublicKey(item.mint.address).equals(rewardMint),
      );
      const rewardInfo = farmInfoKeys.rewardInfos[rewardInfoIndex];
      if (!rewardInfo) this.logAndCreateError("configuration does not exist", "rewardMint", rewardMint);
      const rewardVault = rewardInfo!.vault ?? SOLMint;
      const { rewardPubKey: userRewardTokenPub, newInstruction } = await this._getUserRewardInfo({
        rewardInfo: itemReward,
        payer: payerPubKey,
      });
      if (newInstruction) txBuilder.addInstruction(newInstruction);
      if (!userRewardTokenPub)
        this.logAndCreateError("cannot found target token accounts", this.scope.account.tokenAccounts);
      const ins = makeRestartRewardInstruction({
        payer: this.scope.ownerPubKey,
        rewardVault,
        userRewardTokenPub: userRewardTokenPub!,
        farmKeys,
        rewardInfo: itemReward,
      });
      txBuilder.addInstruction({
        instructions: [ins],
        instructionTypes: [InstructionType.FarmV6Restart],
      });
    }

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async addNewRewardToken<T extends TxVersion>(params: UpdateFarmReward): Promise<MakeTxData<T>> {
    const { txVersion, farmInfo, newRewardInfo, payer, feePayer } = params;
    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    if (version !== 6) this.logAndCreateError("invalid farm version ", version);

    const farmKeys = jsonInfo2PoolKeys((await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0]);
    const payerPubKey = payer ?? this.scope.ownerPubKey;
    const txBuilder = this.createTxBuilder(feePayer);

    const rewardMint = newRewardInfo.mint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.address) : newRewardInfo.mint;

    const rewardVault = getAssociatedLedgerPoolAccount({
      programId: new PublicKey(farmInfo.programId),
      poolId: new PublicKey(farmInfo.id),
      mint: rewardMint,
      type: "rewardVault",
    });

    const { rewardPubKey: userRewardTokenPub, newInstruction } = await this._getUserRewardInfo({
      rewardInfo: newRewardInfo,
      payer: payerPubKey,
    });
    if (newInstruction) txBuilder.addInstruction(newInstruction);

    if (!userRewardTokenPub)
      this.logAndCreateError("annot found target token accounts", this.scope.account.tokenAccounts);

    newRewardInfo.mint = rewardMint;

    return txBuilder
      .addInstruction({
        instructions: [
          makeAddNewRewardInstruction({
            payer: this.scope.ownerPubKey,
            userRewardTokenPub: userRewardTokenPub!,
            farmKeys,
            rewardVault,
            rewardInfo: newRewardInfo,
          }),
        ],
        instructionTypes: [InstructionType.FarmV6CreatorAddReward],
      })
      .versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async addNewRewardsToken<T extends TxVersion>(params: UpdateFarmRewards<T>): Promise<MakeTxData<T>> {
    const { txVersion, farmInfo, newRewardInfos, payer, feePayer } = params;
    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    if (version !== 6) this.logAndCreateError("invalid farm version ", version);

    const farmKeys = jsonInfo2PoolKeys((await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0]);
    const payerPubKey = payer ?? this.scope.ownerPubKey;
    const txBuilder = this.createTxBuilder(feePayer);

    for (const itemReward of newRewardInfos) {
      const rewardMint = itemReward.mint.equals(SOLMint) ? new PublicKey(TOKEN_WSOL.address) : itemReward.mint;
      const rewardVault = getAssociatedLedgerPoolAccount({
        programId: new PublicKey(farmInfo.programId),
        poolId: new PublicKey(farmInfo.id),
        mint: rewardMint,
        type: "rewardVault",
      });
      const { rewardPubKey: userRewardTokenPub, newInstruction } = await this._getUserRewardInfo({
        rewardInfo: itemReward,
        payer: payerPubKey,
      });
      if (newInstruction) txBuilder.addInstruction(newInstruction);
      if (!userRewardTokenPub)
        this.logAndCreateError("cannot found target token accounts", this.scope.account.tokenAccounts);
      const ins = makeAddNewRewardInstruction({
        payer: this.scope.ownerPubKey,
        userRewardTokenPub: userRewardTokenPub!,
        farmKeys,
        rewardVault,
        rewardInfo: { ...itemReward, mint: rewardMint },
      });
      txBuilder.addInstruction({
        instructions: [ins],
        instructionTypes: [InstructionType.FarmV6CreatorAddReward],
      });
    }

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async deposit<T extends TxVersion>(params: FarmDWParam<T>): Promise<MakeTxData<T>> {
    const {
      txVersion,
      farmInfo,
      amount,
      feePayer,
      useSOLBalance,
      associatedOnly = true,
      checkCreateATAOwner = false,
      userAuxiliaryLedgers,
      computeBudgetConfig,
      txTipConfig,
    } = params;

    if (this.scope.availability.addFarm === false)
      this.logAndCreateError("farm deposit feature disabled in your region");

    const { rewardInfos, programId } = farmInfo;
    const version = FARM_PROGRAM_TO_VERSION[programId];
    if (version === 4) this.logAndCreateError("V4 has suspended deposits:", farmInfo.programId);
    if (!isValidFarmVersion(version)) this.logAndCreateError("invalid farm program:", farmInfo.programId);
    const [farmProgramId, farmId] = [new PublicKey(farmInfo.programId), new PublicKey(farmInfo.id)];
    const farmKeys = (await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0];

    const ledger = getAssociatedLedgerAccount({
      programId: farmProgramId,
      poolId: farmId,
      owner: this.scope.ownerPubKey,
      version: version as 3 | 5 | 6,
    });

    const txBuilder = this.createTxBuilder(feePayer);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
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
          tokenProgram: itemReward.mint.programId,
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

    let ledgerInfo: FarmLedger | undefined = undefined;
    const ledgerData = await this.scope.connection.getAccountInfo(ledger);
    if (ledgerData) {
      const ledgerLayout = getFarmLedgerLayout(version)!;
      ledgerInfo = ledgerLayout.decode(ledgerData.data);
    }

    if (farmInfo.programId !== FARM_PROGRAM_ID_V6.toString() && !ledgerInfo) {
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

    const insParams = {
      amount: parseBigNumberish(amount),
      owner: this.scope.ownerPubKey,
      farmInfo,
      farmKeys,
      lpAccount: ownerLpTokenAccount,
      rewardAccounts,
      userAuxiliaryLedgers: userAuxiliaryLedgers?.map((key) => new PublicKey(key)),
    };

    const newInstruction =
      version === 6
        ? makeDepositInstructionV6(insParams)
        : version === 5
          ? makeDepositInstructionV5(insParams)
          : makeDepositInstructionV3(insParams);

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
      .versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async withdraw<T extends TxVersion>(params: FarmDWParam<T>): Promise<MakeTxData<T>> {
    const {
      txVersion,
      farmInfo,
      amount,
      deposited,
      useSOLBalance,
      feePayer,
      associatedOnly = true,
      checkCreateATAOwner = false,
      userAuxiliaryLedgers,
      computeBudgetConfig,
      txTipConfig,
    } = params;
    const { rewardInfos } = farmInfo;

    if (this.scope.availability.removeFarm === false)
      this.logAndCreateError("farm withdraw feature disabled in your region");

    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];

    if (!isValidFarmVersion(version)) this.logAndCreateError("invalid farm program:", farmInfo.programId);

    const farmKeys = (await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0];
    const txBuilder = this.createTxBuilder(feePayer);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccounts) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.mint).publicKey;
        if (item.publicKey && ata.equals(item.publicKey)) ownerMintToAccount[item.mint.toString()] = item.publicKey;
      } else {
        ownerMintToAccount[item.mint.toString()] = item.publicKey!;
      }
    }

    if (version !== 4) {
      const ledger = getAssociatedLedgerAccount({
        programId: new PublicKey(farmInfo.programId),
        poolId: new PublicKey(farmInfo.id),
        owner: this.scope.ownerPubKey,
        version,
      });
      const ledgerData = await this.scope.connection.getAccountInfo(ledger);

      if (!ledgerData) {
        // user has old none ata farm vault and don't have ata vault
        if (version !== 6) {
          const { instruction, instructionType } = createAssociatedLedgerAccountInstruction({
            id: new PublicKey(farmKeys.id),
            programId: new PublicKey(farmKeys.programId),
            version,
            ledger,
            owner: this.scope.ownerPubKey,
          });
          txBuilder.addInstruction({ instructions: [instruction], instructionTypes: [instructionType] });
        }
      } else {
        const ledgerLayout = getFarmLedgerLayout(version)!;
        const ledgerInfo = ledgerLayout.decode(ledgerData!.data);
        if (ledgerInfo.deposited.isZero()) this.logAndCreateError("no deposited lp", { farmId: farmInfo.id });
      }
    }

    if (deposited && deposited.isZero() && !(userAuxiliaryLedgers || []).length)
      this.logAndCreateError("no deposited lp", { farmId: farmInfo.id });

    // if (!deposited && version !== 4) {
    // const ledger = getAssociatedLedgerAccount({
    //   programId: new PublicKey(farmInfo.programId),
    //   poolId: new PublicKey(farmInfo.id),
    //   owner: this.scope.ownerPubKey,
    //   version,
    // });
    // const ledgerData = await this.scope.connection.getAccountInfo(ledger);
    // if (!ledgerData) {
    // user has old not ata farm vault and don't have ata vault
    // if (version !== 6 && (userAuxiliaryLedgers || []).length > 0) {
    //   const { instruction, instructionType } = createAssociatedLedgerAccountInstruction({
    //     id: new PublicKey(farmKeys.id),
    //     programId: new PublicKey(farmKeys.programId),
    //     version,
    //     ledger,
    //     owner: this.scope.ownerPubKey,
    //   });
    //   txBuilder.addInstruction({ instructions: [instruction], instructionTypes: [instructionType] });
    // } else {
    //   this.logAndCreateError("no lp data", { farmId: farmInfo.id, version, ledgerData });
    // }
    // } else {
    //   const ledgerLayout = getFarmLedgerLayout(version)!;
    //   const ledgerInfo = ledgerLayout.decode(ledgerData!.data);
    //   if (ledgerInfo.deposited.isZero()) this.logAndCreateError("no deposited lp", { farmId: farmInfo.id });
    // }
    // } else if (deposited) {
    //   if (deposited.isZero() && !(userAuxiliaryLedgers || []).length)
    //     this.logAndCreateError("no deposited lp", { farmId: farmInfo.id });
    // }

    const lpMint = farmKeys.lpMint.address;
    const lpMintUseSOLBalance = useSOLBalance && lpMint === WSOLMint.toString();

    let ownerLpTokenAccount = ownerMintToAccount[lpMint.toString()];
    if (!ownerLpTokenAccount) {
      const { account: _ownerRewardAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: farmKeys.lpMint.programId,
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
          tokenProgram: itemReward.mint.programId,
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

    const insParams = {
      amount: parseBigNumberish(amount),
      owner: this.scope.ownerPubKey,
      farmInfo,
      farmKeys,
      lpAccount: ownerLpTokenAccount,
      rewardAccounts,
      userAuxiliaryLedgers: userAuxiliaryLedgers?.map((key) => new PublicKey(key)),
    };

    const newInstruction =
      version === 6
        ? makeWithdrawInstructionV6(insParams)
        : version === 5
          ? makeWithdrawInstructionV5(insParams)
          : version === 4
            ? makeWithdrawInstructionV4(insParams)
            : makeWithdrawInstructionV3(insParams);

    const insType = {
      3: InstructionType.FarmV3Withdraw,
      4: InstructionType.FarmV4Withdraw,
      5: InstructionType.FarmV5Withdraw,
      6: InstructionType.FarmV6Withdraw,
    };

    return txBuilder
      .addInstruction({
        instructions: [newInstruction],
        instructionTypes: [insType[version]],
      })
      .versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  // token account needed
  public async withdrawFarmReward<T extends TxVersion>({
    farmInfo,
    withdrawMint,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: {
    farmInfo: FormatFarmInfoOut;
    withdrawMint: PublicKey;
    payer?: PublicKey;
    computeBudgetConfig?: ComputeBudgetConfig;
    txTipConfig?: TxTipConfig;
    txVersion?: T;
    feePayer?: PublicKey;
  }): Promise<MakeTxData<T>> {
    this.scope.checkOwner();
    const farmKeys = jsonInfo2PoolKeys(
      (await this.scope.api.fetchFarmKeysById({ ids: farmInfo.id }))[0] as FormatFarmKeyOutV6,
    );
    const version = FARM_PROGRAM_TO_VERSION[farmInfo.programId];
    if (version !== 6) this.logAndCreateError("invalid farm version", version);

    // const rewardInfoIdx = farmInfo.rewardInfos.findIndex((item) =>
    //   item.mint.address === SOLMint.toString() ? new PublicKey(TOKEN_WSOL.address) : withdrawMint,
    // );
    const rewardInfo = farmKeys.rewardInfos.find((r) => solToWSol(r.mint.address).equals(solToWSol(withdrawMint)));
    if (!rewardInfo) this.logAndCreateError("withdraw mint error", "rewardInfos", farmInfo);

    const rewardVault = rewardInfo?.vault ?? SOLMint;
    const txBuilder = this.createTxBuilder(feePayer);

    let userRewardToken: PublicKey;

    if (withdrawMint.equals(SOLMint) || withdrawMint.equals(PublicKey.default)) {
      const txInstruction = await createWSolAccountInstructions({
        connection: this.scope.connection,
        owner: this.scope.ownerPubKey,
        payer: this.scope.ownerPubKey,
        amount: calFarmRewardAmount({
          ...rewardInfo,
          openTime: rewardInfo!.openTime as unknown as string,
          endTime: rewardInfo!.endTime as unknown as string,
          perSecond: new Decimal(rewardInfo!.perSecond).mul(10 ** rewardInfo!.mint.decimals).toString(),
        }),
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
      programId: farmKeys.programId,
      id: farmKeys.id,
      authority: farmKeys.authority,
      lpVault: farmKeys.lpVault,
      rewardVault,
      userRewardToken,
      owner: this.scope.ownerPubKey,
    });
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);
    return txBuilder
      .addInstruction({
        instructions: [instruction],
        instructionTypes: [instructionType],
      })
      .versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async harvestAllRewards<T extends TxVersion = TxVersion.LEGACY>(params: {
    farmInfoList: Record<string, FormatFarmInfoOut>;
    feePayer?: PublicKey;
    useSOLBalance?: boolean;
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
    userAuxiliaryLedgers?: string[];
    txVersion?: T;
    computeBudgetConfig?: ComputeBudgetConfig;
  }): Promise<MakeMultiTxData<T>> {
    const {
      farmInfoList,
      useSOLBalance,
      feePayer,
      associatedOnly = true,
      checkCreateATAOwner = false,
      userAuxiliaryLedgers,
      txVersion,
      computeBudgetConfig,
    } = params;

    const txBuilder = this.createTxBuilder(feePayer);
    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccounts) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.mint).publicKey;
        if (item.publicKey && ata.equals(item.publicKey)) ownerMintToAccount[item.mint.toString()] = item.publicKey;
      } else {
        ownerMintToAccount[item.mint.toString()] = item.publicKey!;
      }
    }

    const allFarmKeys = await this.scope.api.fetchFarmKeysById({
      ids: Object.values(farmInfoList)
        .map((f) => f.id)
        .join(","),
    });
    const farmKeyMap: { [key: string]: FormatFarmKeyOut } = allFarmKeys.reduce(
      (acc, cur) => ({ ...acc, [cur.id]: cur }),
      {},
    );
    for (const farmInfo of Object.values(farmInfoList)) {
      const { programId, lpMint: farmLpMint, rewardInfos, id } = farmInfo;
      const version = FARM_PROGRAM_TO_VERSION[programId];

      const lpMint = farmLpMint.address;
      const lpMintUseSOLBalance = useSOLBalance && lpMint === WSOLMint.toString();
      let ownerLpTokenAccount = ownerMintToAccount[lpMint];

      if (!ownerLpTokenAccount) {
        const { account: _ownerLpAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: farmLpMint.programId,
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
        ownerLpTokenAccount = _ownerLpAccount!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }
      ownerMintToAccount[lpMint.toString()] = ownerLpTokenAccount;

      const rewardAccounts: PublicKey[] = [];
      for (const itemReward of rewardInfos) {
        const rewardUseSOLBalance = useSOLBalance && itemReward.mint.address === WSOLMint.toString();

        let ownerRewardAccount = ownerMintToAccount[itemReward.mint.address];
        if (!ownerRewardAccount) {
          const { account: _ownerRewardAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
            tokenProgram: itemReward.mint.programId,
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

      const farmKeys = farmKeyMap[id];
      const insParams = {
        amount: BN_ZERO,
        owner: this.scope.ownerPubKey,
        farmInfo,
        farmKeys,
        lpAccount: ownerLpTokenAccount,
        rewardAccounts,
        userAuxiliaryLedgers: userAuxiliaryLedgers?.map((key) => new PublicKey(key)),
      };

      const withdrawInstruction =
        version === 6
          ? makeWithdrawInstructionV6(insParams)
          : version === 5
            ? makeWithdrawInstructionV5(insParams)
            : makeWithdrawInstructionV3(insParams);

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

    if (txVersion === TxVersion.LEGACY)
      return txBuilder.sizeCheckBuild({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
  }
}
