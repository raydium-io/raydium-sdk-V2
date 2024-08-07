import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { InstructionType, WSOLMint, fetchMultipleMintInfos, getMultipleAccountsInfoWithCustomFlags } from "@/common";
import { ApiV3PoolInfoConcentratedItem, ClmmKeys } from "@/api/type";
import { MakeTxData, MakeMultiTxData } from "@/common/txTool/txTool";
import { TxVersion } from "@/common/txTool/txType";
import { getATAAddress } from "@/common";
import { toApiV3Token, toFeeConfig } from "@/raydium/token/utils";
import { ReturnTypeFetchMultipleMintInfos, ComputeBudgetConfig } from "@/raydium/type";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { mockV3CreatePoolInfo, MIN_SQRT_PRICE_X64, MAX_SQRT_PRICE_X64 } from "./utils/constants";
import { SqrtPriceMath } from "./utils/math";
import {
  CreateConcentratedPool,
  IncreasePositionFromLiquidity,
  IncreasePositionFromBase,
  DecreaseLiquidity,
  OpenPositionFromBase,
  OpenPositionFromLiquidity,
  InitRewardParams,
  InitRewardsParams,
  SetRewardParams,
  SetRewardsParams,
  CollectRewardParams,
  CollectRewardsParams,
  ManipulateLiquidityExtInfo,
  OpenPositionFromLiquidityExtInfo,
  OpenPositionFromBaseExtInfo,
  ClosePositionExtInfo,
  InitRewardExtInfo,
  HarvestAllRewardsParams,
  ComputeClmmPoolInfo,
  ReturnTypeFetchMultiplePoolTickArrays,
  ClmmRpcData,
} from "./type";
import { ClmmInstrument } from "./instrument";
import { MakeTransaction } from "../type";
import { MathUtil } from "./utils/math";
import { PoolUtils, clmmComputeInfoToApiInfo } from "./utils/pool";
import { getPdaOperationAccount, getPdaPersonalPositionAddress } from "./utils/pda";
import { ClmmPositionLayout, OperationLayout, PositionInfoLayout, PoolInfoLayout, ClmmConfigLayout } from "./layout";
import BN from "bn.js";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export class Clmm extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async getClmmPoolKeys(poolId: string): Promise<ClmmKeys> {
    return ((await this.scope.api.fetchPoolKeysById({ idList: [poolId] })) as ClmmKeys[])[0];
  }

  public async createPool<T extends TxVersion>(
    props: CreateConcentratedPool<T>,
  ): Promise<MakeTxData<T, { mockPoolInfo: ApiV3PoolInfoConcentratedItem; address: ClmmKeys }>> {
    const {
      programId,
      owner = this.scope.owner?.publicKey || PublicKey.default,
      mint1,
      mint2,
      ammConfig,
      initialPrice,
      startTime,
      computeBudgetConfig,
      forerunCreate,
      getObserveState,
      txVersion,
    } = props;
    const txBuilder = this.createTxBuilder();
    const [mintA, mintB, initPrice] = new BN(new PublicKey(mint1.address).toBuffer()).gt(
      new BN(new PublicKey(mint2.address).toBuffer()),
    )
      ? [mint2, mint1, new Decimal(1).div(initialPrice)]
      : [mint1, mint2, initialPrice];

    const initialPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(initPrice, mintA.decimals, mintB.decimals);

    const insInfo = await ClmmInstrument.createPoolInstructions({
      connection: this.scope.connection,
      programId,
      owner,
      mintA,
      mintB,
      ammConfigId: ammConfig.id,
      initialPriceX64,
      startTime,
      forerunCreate: !getObserveState && forerunCreate,
    });

    txBuilder.addInstruction(insInfo);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild<{
      mockPoolInfo: ApiV3PoolInfoConcentratedItem;
      address: ClmmKeys;
      forerunCreate?: boolean;
    }>({
      txVersion,
      extInfo: {
        address: {
          ...insInfo.address,
          programId: programId.toString(),
          id: insInfo.address.poolId.toString(),
          mintA,
          mintB,
          openTime: startTime.toString(),
          vault: { A: insInfo.address.mintAVault.toString(), B: insInfo.address.mintBVault.toString() },
          rewardInfos: [],
          config: {
            id: ammConfig.id.toString(),
            index: ammConfig.index,
            protocolFeeRate: ammConfig.protocolFeeRate,
            tradeFeeRate: ammConfig.tradeFeeRate,
            tickSpacing: ammConfig.tickSpacing,
            fundFeeRate: ammConfig.fundFeeRate,
            description: ammConfig.description,
            defaultRange: 0,
            defaultRangePoint: [],
          },
        },
        mockPoolInfo: {
          type: "Concentrated",
          rewardDefaultPoolInfos: "Clmm",
          id: insInfo.address.poolId.toString(),
          mintA,
          mintB,
          feeRate: ammConfig.tradeFeeRate,
          openTime: startTime.toString(),
          programId: programId.toString(),
          price: initPrice.toNumber(),
          config: {
            id: ammConfig.id.toString(),
            index: ammConfig.index,
            protocolFeeRate: ammConfig.protocolFeeRate,
            tradeFeeRate: ammConfig.tradeFeeRate,
            tickSpacing: ammConfig.tickSpacing,
            fundFeeRate: ammConfig.fundFeeRate,
            description: ammConfig.description,
            defaultRange: 0,
            defaultRangePoint: [],
          },
          ...mockV3CreatePoolInfo,
        },
        forerunCreate,
      },
    }) as Promise<MakeTxData<T, { mockPoolInfo: ApiV3PoolInfoConcentratedItem; address: ClmmKeys }>>;
  }

  public async openPositionFromBase<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    ownerInfo,
    tickLower,
    tickUpper,
    base,
    baseAmount,
    otherAmountMax,
    associatedOnly = true,
    checkCreateATAOwner = false,
    withMetadata = "create",
    getEphemeralSigners,
    computeBudgetConfig,
    txVersion,
  }: OpenPositionFromBase<T>): Promise<MakeTxData<T, OpenPositionFromBaseExtInfo>> {
    if (this.scope.availability.addConcentratedPosition === false)
      this.logAndCreateError("add position feature disabled in your region");

    this.scope.checkOwner();
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | null = null;
    let ownerTokenAccountB: PublicKey | null = null;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();
    const [amountA, amountB] = base === "MintA" ? [baseAmount, otherAmountMax] : [otherAmountMax, baseAmount];

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintAUseSOLBalance || amountA.isZero()
            ? {
                payer: this.scope.ownerPubKey,
                amount: amountA,
              }
            : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintBUseSOLBalance || amountB.isZero()
            ? {
                payer: this.scope.ownerPubKey!,
                amount: amountB,
              }
            : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", {
        ownerTokenAccountA: ownerTokenAccountA?.toBase58(),
        ownerTokenAccountB: ownerTokenAccountB?.toBase58(),
      });

    const poolKeys = propPoolKeys || (await this.getClmmPoolKeys(poolInfo.id));
    const insInfo = await ClmmInstrument.openPositionFromBaseInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        ...ownerInfo,
        feePayer: this.scope.ownerPubKey,
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      tickLower,
      tickUpper,
      base,
      baseAmount,
      otherAmountMax,
      withMetadata,
      getEphemeralSigners,
    });

    txBuilder.addInstruction(insInfo);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild<OpenPositionFromBaseExtInfo>({
      txVersion,
      extInfo: { ...insInfo.address },
    }) as Promise<MakeTxData<T, OpenPositionFromBaseExtInfo>>;
  }

  public async openPositionFromLiquidity<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    ownerInfo,
    amountMaxA,
    amountMaxB,
    tickLower,
    tickUpper,
    liquidity,
    associatedOnly = true,
    checkCreateATAOwner = false,
    withMetadata = "create",
    txVersion,
    getEphemeralSigners,
  }: OpenPositionFromLiquidity<T>): Promise<MakeTxData<T, OpenPositionFromLiquidityExtInfo>> {
    if (this.scope.availability.createConcentratedPosition === false)
      this.logAndCreateError("open position feature disabled in your region");
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | null = null;
    let ownerTokenAccountB: PublicKey | null = null;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toBase58();

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintAUseSOLBalance || amountMaxA.isZero()
            ? {
                payer: this.scope.ownerPubKey,
                amount: amountMaxA,
              }
            : undefined,

        skipCloseAccount: !mintAUseSOLBalance,
        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintBUseSOLBalance || amountMaxB.isZero()
            ? {
                payer: this.scope.ownerPubKey!,
                amount: amountMaxB,
              }
            : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (ownerTokenAccountA === undefined || ownerTokenAccountB === undefined)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const poolKeys = propPoolKeys || (await this.getClmmPoolKeys(poolInfo.id));

    const makeOpenPositionInstructions = await ClmmInstrument.openPositionFromLiquidityInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      tickLower,
      tickUpper,
      liquidity,
      amountMaxA,
      amountMaxB,
      withMetadata,
      getEphemeralSigners,
    });
    txBuilder.addInstruction(makeOpenPositionInstructions);

    return txBuilder.versionBuild<OpenPositionFromLiquidityExtInfo>({
      txVersion,
      extInfo: { address: makeOpenPositionInstructions.address },
    }) as Promise<MakeTxData<T, OpenPositionFromLiquidityExtInfo>>;
  }

  public async increasePositionFromLiquidity<T extends TxVersion>(
    props: IncreasePositionFromLiquidity<T>,
  ): Promise<MakeTxData<T, ManipulateLiquidityExtInfo>> {
    const {
      poolInfo,
      poolKeys: propPoolKeys,
      ownerPosition,
      amountMaxA,
      amountMaxB,
      liquidity,
      ownerInfo,
      associatedOnly = true,
      checkCreateATAOwner = false,
      computeBudgetConfig,
      txVersion,
    } = props;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();
    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,

        createInfo:
          mintAUseSOLBalance || amountMaxA.isZero()
            ? {
                payer: this.scope.ownerPubKey,
                amount: amountMaxA,
              }
            : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});
    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintBUseSOLBalance || amountMaxB.isZero()
            ? {
                payer: this.scope.ownerPubKey!,
                amount: amountMaxB,
              }
            : undefined,
        notUseTokenAccount: mintBUseSOLBalance,
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);
    const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));
    const ins = ClmmInstrument.increasePositionFromLiquidityInstructions({
      poolInfo,
      poolKeys,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      liquidity,
      amountMaxA,
      amountMaxB,
    });
    txBuilder.addInstruction(ins);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild<ManipulateLiquidityExtInfo>({
      txVersion,
      extInfo: { address: ins.address },
    }) as Promise<MakeTxData<T, ManipulateLiquidityExtInfo>>;
  }

  public async increasePositionFromBase<T extends TxVersion>(
    props: IncreasePositionFromBase<T>,
  ): Promise<MakeTxData<T, ManipulateLiquidityExtInfo>> {
    const {
      poolInfo,
      ownerPosition,
      base,
      baseAmount,
      otherAmountMax,
      ownerInfo,
      associatedOnly = true,
      checkCreateATAOwner = false,
      computeBudgetConfig,
      txVersion,
    } = props;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,

        createInfo:
          mintAUseSOLBalance || (base === "MintA" ? baseAmount : otherAmountMax).isZero()
            ? {
                payer: this.scope.ownerPubKey,
                amount: base === "MintA" ? baseAmount : otherAmountMax,
              }
            : undefined,
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo:
          mintBUseSOLBalance || (base === "MintA" ? otherAmountMax : baseAmount).isZero()
            ? {
                payer: this.scope.ownerPubKey!,
                amount: base === "MintA" ? otherAmountMax : baseAmount,
              }
            : undefined,
        notUseTokenAccount: mintBUseSOLBalance,
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});
    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const poolKeys = await this.getClmmPoolKeys(poolInfo.id);
    const ins = ClmmInstrument.increasePositionFromBaseInstructions({
      poolInfo,
      poolKeys,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      base,
      baseAmount,
      otherAmountMax,
    });
    txBuilder.addInstruction(ins);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild<ManipulateLiquidityExtInfo>({
      txVersion,
      extInfo: { address: ins.address },
    }) as Promise<MakeTxData<T, ManipulateLiquidityExtInfo>>;
  }

  public async decreaseLiquidity<T extends TxVersion>(
    props: DecreaseLiquidity<T>,
  ): Promise<MakeTxData<T, ManipulateLiquidityExtInfo & Partial<ClosePositionExtInfo>>> {
    const {
      poolInfo,
      poolKeys: propPoolKeys,
      ownerPosition,
      ownerInfo,
      amountMinA,
      amountMinB,
      liquidity,
      associatedOnly = true,
      checkCreateATAOwner = false,
      computeBudgetConfig,
      txVersion,
    } = props;
    if (this.scope.availability.removeConcentratedPosition === false)
      this.logAndCreateError("remove position feature disabled in your region");
    const txBuilder = this.createTxBuilder();

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;
    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    const rewardAccounts: PublicKey[] = [];
    for (const itemReward of poolInfo.rewardDefaultInfos) {
      const rewardUseSOLBalance = ownerInfo.useSOLBalance && itemReward.mint.address === WSOLMint.toString();

      let ownerRewardAccount: PublicKey | undefined;

      if (itemReward.mint.address === poolInfo.mintA.address) ownerRewardAccount = ownerTokenAccountA;
      else if (itemReward.mint.address === poolInfo.mintB.address) ownerRewardAccount = ownerTokenAccountB;
      else {
        const { account: _ownerRewardAccount, instructionParams: ownerRewardAccountInstructions } =
          await this.scope.account.getOrCreateTokenAccount({
            tokenProgram: new PublicKey(itemReward.mint.programId),
            mint: new PublicKey(itemReward.mint.address),
            notUseTokenAccount: rewardUseSOLBalance,
            owner: this.scope.ownerPubKey,
            createInfo: {
              payer: this.scope.ownerPubKey,
              amount: 0,
            },
            skipCloseAccount: !rewardUseSOLBalance,
            associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
            checkCreateATAOwner,
          });
        ownerRewardAccount = _ownerRewardAccount;
        ownerRewardAccountInstructions && txBuilder.addInstruction(ownerRewardAccountInstructions);
      }

      rewardAccounts.push(ownerRewardAccount!);
    }

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );

    const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));

    const decreaseInsInfo = await ClmmInstrument.decreaseLiquidityInstructions({
      poolInfo,
      poolKeys,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
        rewardAccounts,
      },
      liquidity,
      amountMinA,
      amountMinB,
    });

    txBuilder.addInstruction({
      instructions: decreaseInsInfo.instructions,
      instructionTypes: [InstructionType.ClmmDecreasePosition],
    });

    let extInfo = { ...decreaseInsInfo.address };
    if (ownerInfo.closePosition) {
      const closeInsInfo = await ClmmInstrument.closePositionInstructions({
        poolInfo,
        poolKeys,
        ownerInfo: { wallet: this.scope.ownerPubKey },
        ownerPosition,
      });
      txBuilder.addInstruction({
        endInstructions: closeInsInfo.instructions,
        endInstructionTypes: closeInsInfo.instructionTypes,
      });
      extInfo = { ...extInfo, ...closeInsInfo.address };
    }
    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild<ManipulateLiquidityExtInfo>({
      txVersion,
      extInfo: { address: extInfo },
    }) as Promise<MakeTxData<T, ManipulateLiquidityExtInfo>>;
  }

  public async closePosition<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    ownerPosition,
    txVersion,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys?: ClmmKeys;
    ownerPosition: ClmmPositionLayout;
    txVersion: T;
  }): Promise<MakeTxData<T, ClosePositionExtInfo>> {
    if (this.scope.availability.removeConcentratedPosition === false)
      this.logAndCreateError("remove position feature disabled in your region");
    const txBuilder = this.createTxBuilder();
    const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));
    const ins = ClmmInstrument.closePositionInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: { wallet: this.scope.ownerPubKey },
      ownerPosition,
    });

    return txBuilder.addInstruction(ins).versionBuild<ClosePositionExtInfo>({
      txVersion,
      extInfo: { address: ins.address },
    }) as Promise<MakeTxData<T, ClosePositionExtInfo>>;
  }

  public async initReward<T extends TxVersion>({
    poolInfo,
    ownerInfo,
    rewardInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
    computeBudgetConfig,
    txVersion,
  }: InitRewardParams<T>): Promise<MakeTxData<T, InitRewardExtInfo>> {
    if (rewardInfo.endTime <= rewardInfo.openTime)
      this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);

    const txBuilder = this.createTxBuilder();

    const rewardMintUseSOLBalance =
      ownerInfo.useSOLBalance && rewardInfo.mint.address.toString() === WSOLMint.toString();
    const _baseRewardAmount = rewardInfo.perSecond.mul(rewardInfo.endTime - rewardInfo.openTime);

    const { account: ownerRewardAccount, instructionParams: ownerRewardAccountIns } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(rewardInfo.mint.address),
        mint: new PublicKey(rewardInfo.mint.address),
        notUseTokenAccount: !!rewardMintUseSOLBalance,
        skipCloseAccount: !rewardMintUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: rewardMintUseSOLBalance
          ? {
              payer: ownerInfo.feePayer || this.scope.ownerPubKey,
              amount: new BN(
                new Decimal(_baseRewardAmount.toFixed(0)).gte(_baseRewardAmount)
                  ? _baseRewardAmount.toFixed(0)
                  : _baseRewardAmount.add(1).toFixed(0),
              ),
            }
          : undefined,
        associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerRewardAccountIns && txBuilder.addInstruction(ownerRewardAccountIns);

    if (!ownerRewardAccount)
      this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);
    const poolKeys = await this.getClmmPoolKeys(poolInfo.id);
    const insInfo = ClmmInstrument.initRewardInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccount: ownerRewardAccount!,
      },
      rewardInfo: {
        programId: new PublicKey(rewardInfo.mint.programId),
        mint: new PublicKey(rewardInfo.mint.address),
        openTime: rewardInfo.openTime,
        endTime: rewardInfo.endTime,
        emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
      },
    });
    txBuilder.addInstruction(insInfo);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild<InitRewardExtInfo>({
      txVersion,
      extInfo: { address: insInfo.address },
    }) as Promise<MakeTxData<T, InitRewardExtInfo>>;
  }

  public async initRewards<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    ownerInfo,
    rewardInfos,
    associatedOnly = true,
    checkCreateATAOwner = false,
    computeBudgetConfig,
    txVersion,
  }: InitRewardsParams<T>): Promise<MakeTxData<T, { address: Record<string, PublicKey> }>> {
    for (const rewardInfo of rewardInfos) {
      if (rewardInfo.endTime <= rewardInfo.openTime)
        this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);
    }

    const txBuilder = this.createTxBuilder();
    let address: Record<string, PublicKey> = {};

    for (const rewardInfo of rewardInfos) {
      const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.address === WSOLMint.toString();
      const _baseRewardAmount = rewardInfo.perSecond.mul(rewardInfo.endTime - rewardInfo.openTime);

      const { account: ownerRewardAccount, instructionParams: ownerRewardAccountIns } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: new PublicKey(rewardInfo.mint.programId),
          mint: new PublicKey(rewardInfo.mint.address),
          notUseTokenAccount: !!rewardMintUseSOLBalance,
          skipCloseAccount: !rewardMintUseSOLBalance,
          owner: this.scope.ownerPubKey,
          createInfo: rewardMintUseSOLBalance
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: new BN(
                  new Decimal(_baseRewardAmount.toFixed(0)).gte(_baseRewardAmount)
                    ? _baseRewardAmount.toFixed(0)
                    : _baseRewardAmount.add(1).toFixed(0),
                ),
              }
            : undefined,
          associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      ownerRewardAccountIns && txBuilder.addInstruction(ownerRewardAccountIns);

      if (!ownerRewardAccount)
        this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);

      const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));
      const insInfo = ClmmInstrument.initRewardInstructions({
        poolInfo,
        poolKeys,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccount: ownerRewardAccount!,
        },
        rewardInfo: {
          programId: new PublicKey(rewardInfo.mint.programId),
          mint: new PublicKey(rewardInfo.mint.address),
          openTime: rewardInfo.openTime,
          endTime: rewardInfo.endTime,
          emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
        },
      });
      address = {
        ...address,
        ...insInfo.address,
      };
      txBuilder.addInstruction(insInfo);
    }
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild({
      txVersion,
      extInfo: { address },
    }) as Promise<MakeTxData<T, { address: Record<string, PublicKey> }>>;
  }

  public async setReward<T extends TxVersion>({
    poolInfo,
    ownerInfo,
    rewardInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
    computeBudgetConfig,
    txVersion,
  }: SetRewardParams<T>): Promise<MakeTxData<T, { address: Record<string, PublicKey> }>> {
    if (rewardInfo.endTime <= rewardInfo.openTime)
      this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);

    const txBuilder = this.createTxBuilder();
    const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.equals(WSOLMint);
    const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: rewardInfo.programId,
        mint: rewardInfo.mint,
        notUseTokenAccount: rewardMintUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: rewardMintUseSOLBalance
          ? {
              payer: ownerInfo.feePayer || this.scope.ownerPubKey,
              amount: new BN(
                new Decimal(rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)).gte(
                  rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime),
                )
                  ? rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)
                  : rewardInfo.perSecond
                      .sub(rewardInfo.endTime - rewardInfo.openTime)
                      .add(1)
                      .toFixed(0),
              ),
            }
          : undefined,

        associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);
    if (!ownerRewardAccount)
      this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);
    const poolKeys = await this.getClmmPoolKeys(poolInfo.id);
    const insInfo = ClmmInstrument.setRewardInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccount: ownerRewardAccount!,
      },
      rewardInfo: {
        mint: rewardInfo.mint,
        openTime: rewardInfo.openTime,
        endTime: rewardInfo.endTime,
        emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
      },
    });

    txBuilder.addInstruction(insInfo);
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild<{ address: Record<string, PublicKey> }>({
      txVersion,
      extInfo: { address: insInfo.address },
    }) as Promise<MakeTxData<T, { address: Record<string, PublicKey> }>>;
  }

  public async setRewards<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    ownerInfo,
    rewardInfos,
    associatedOnly = true,
    checkCreateATAOwner = false,
    computeBudgetConfig,
    txVersion,
  }: SetRewardsParams<T>): Promise<MakeTxData<T, { address: Record<string, PublicKey> }>> {
    const txBuilder = this.createTxBuilder();
    let address: Record<string, PublicKey> = {};
    for (const rewardInfo of rewardInfos) {
      if (rewardInfo.endTime <= rewardInfo.openTime)
        this.logAndCreateError("reward time error", "rewardInfo", rewardInfo);

      const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardInfo.mint.address === WSOLMint.toString();
      const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: new PublicKey(rewardInfo.mint.programId),
          mint: new PublicKey(rewardInfo.mint.address),
          notUseTokenAccount: rewardMintUseSOLBalance,
          owner: this.scope.ownerPubKey,
          createInfo: rewardMintUseSOLBalance
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: new BN(
                  new Decimal(rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)).gte(
                    rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime),
                  )
                    ? rewardInfo.perSecond.sub(rewardInfo.endTime - rewardInfo.openTime).toFixed(0)
                    : rewardInfo.perSecond
                        .sub(rewardInfo.endTime - rewardInfo.openTime)
                        .add(1)
                        .toFixed(0),
                ),
              }
            : undefined,
          associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);
      if (!ownerRewardAccount)
        this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);
      const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));
      const insInfo = ClmmInstrument.setRewardInstructions({
        poolInfo,
        poolKeys,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccount: ownerRewardAccount!,
        },
        rewardInfo: {
          mint: new PublicKey(rewardInfo.mint.address),
          openTime: rewardInfo.openTime,
          endTime: rewardInfo.endTime,
          emissionsPerSecondX64: MathUtil.decimalToX64(rewardInfo.perSecond),
        },
      });
      txBuilder.addInstruction(insInfo);
      address = {
        ...address,
        ...insInfo.address,
      };
    }
    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    return txBuilder.versionBuild<{ address: Record<string, PublicKey> }>({
      txVersion,
      extInfo: { address },
    }) as Promise<MakeTxData<T, { address: Record<string, PublicKey> }>>;
  }

  public async collectReward({
    poolInfo,
    ownerInfo,
    rewardMint,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: CollectRewardParams): Promise<MakeTransaction> {
    const rewardInfo = poolInfo!.rewardDefaultInfos.find((i) => i.mint.address === rewardMint.toString());
    if (!rewardInfo) this.logAndCreateError("reward mint error", "not found reward mint", rewardMint);

    const txBuilder = this.createTxBuilder();
    const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardMint.equals(WSOLMint);
    const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(rewardInfo!.mint.programId),
        mint: rewardMint,
        notUseTokenAccount: rewardMintUseSOLBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !rewardMintUseSOLBalance,
        createInfo: {
          payer: ownerInfo.feePayer || this.scope.ownerPubKey,
          amount: 0,
        },
        associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);

    if (!ownerRewardAccount)
      this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);
    const poolKeys = await this.getClmmPoolKeys(poolInfo.id);
    const insInfo = ClmmInstrument.collectRewardInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccount: ownerRewardAccount!,
      },
      rewardMint,
    });
    txBuilder.addInstruction(insInfo);

    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address: insInfo.address });
  }

  public async collectRewards({
    poolInfo,
    ownerInfo,
    rewardMints,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: CollectRewardsParams): Promise<MakeTransaction> {
    const txBuilder = this.createTxBuilder();
    let address: Record<string, PublicKey> = {};

    for (const rewardMint of rewardMints) {
      const rewardInfo = poolInfo!.rewardDefaultInfos.find((i) => i.mint.address === rewardMint.toString());
      if (!rewardInfo) {
        this.logAndCreateError("reward mint error", "not found reward mint", rewardMint);
        continue;
      }

      const rewardMintUseSOLBalance = ownerInfo.useSOLBalance && rewardMint.equals(WSOLMint);
      const { account: ownerRewardAccount, instructionParams: ownerRewardIns } =
        await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: new PublicKey(rewardInfo.mint.programId),
          mint: rewardMint,
          notUseTokenAccount: rewardMintUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !rewardMintUseSOLBalance,
          createInfo: {
            payer: ownerInfo.feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          associatedOnly: rewardMintUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
      if (!ownerRewardAccount)
        this.logAndCreateError("no money", "ownerRewardAccount", this.scope.account.tokenAccountRawInfos);
      ownerRewardIns && txBuilder.addInstruction(ownerRewardIns);
      const poolKeys = await this.getClmmPoolKeys(poolInfo.id);
      const insInfo = ClmmInstrument.collectRewardInstructions({
        poolInfo,
        poolKeys,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccount: ownerRewardAccount!,
        },

        rewardMint,
      });
      txBuilder.addInstruction(insInfo);
      address = { ...address, ...insInfo.address };
    }

    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address });
  }

  public async swap<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    inputMint,
    amountIn,
    amountOutMin,
    priceLimit,
    observationId,
    ownerInfo,
    remainingAccounts,
    associatedOnly = true,
    checkCreateATAOwner = false,
    txVersion,
    computeBudgetConfig,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys?: ClmmKeys;
    inputMint: string | PublicKey;
    amountIn: BN;
    amountOutMin: BN;
    priceLimit?: Decimal;
    observationId: PublicKey;
    ownerInfo: {
      useSOLBalance?: boolean;
      feePayer?: PublicKey;
    };
    remainingAccounts: PublicKey[];
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
    txVersion?: T;
    computeBudgetConfig?: ComputeBudgetConfig;
  }): Promise<MakeTxData<T>> {
    const txBuilder = this.createTxBuilder();
    const baseIn = inputMint.toString() === poolInfo.mintA.address;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toBase58();

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = baseIn ? MIN_SQRT_PRICE_X64.add(new BN(1)) : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    let ownerTokenAccountA: PublicKey | undefined;
    if (!ownerTokenAccountA) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintAUseSOLBalance,
        createInfo:
          mintAUseSOLBalance || !baseIn
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: baseIn ? amountIn : 0,
              }
            : undefined,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
      ownerTokenAccountA = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    let ownerTokenAccountB: PublicKey | undefined;
    if (!ownerTokenAccountB) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintBUseSOLBalance,
        createInfo:
          mintBUseSOLBalance || baseIn
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: baseIn ? 0 : amountIn,
              }
            : undefined,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
      ownerTokenAccountB = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("user do not have token account", {
        tokenA: poolInfo.mintA.symbol || poolInfo.mintA.address,
        tokenB: poolInfo.mintB.symbol || poolInfo.mintB.address,
        ownerTokenAccountA,
        ownerTokenAccountB,
        mintAUseSOLBalance,
        mintBUseSOLBalance,
        associatedOnly,
      });

    const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));
    txBuilder.addInstruction(
      ClmmInstrument.makeSwapBaseInInstructions({
        poolInfo,
        poolKeys,
        observationId,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccountA: ownerTokenAccountA!,
          tokenAccountB: ownerTokenAccountB!,
        },
        inputMint: new PublicKey(inputMint),
        amountIn,
        amountOutMin,
        sqrtPriceLimitX64,
        remainingAccounts,
      }),
    );

    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async swapBaseOut<T extends TxVersion>({
    poolInfo,
    poolKeys: propPoolKeys,
    outputMint,
    amountOut,
    amountInMax,
    priceLimit,
    observationId,
    ownerInfo,
    remainingAccounts,
    associatedOnly = true,
    checkCreateATAOwner = false,
    txVersion,
    computeBudgetConfig,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys?: ClmmKeys;
    outputMint: string | PublicKey;
    amountOut: BN;
    amountInMax: BN;
    priceLimit?: Decimal;
    observationId: PublicKey;
    ownerInfo: {
      useSOLBalance?: boolean;
      feePayer?: PublicKey;
    };
    remainingAccounts: PublicKey[];
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
    txVersion?: T;
    computeBudgetConfig?: ComputeBudgetConfig;
  }): Promise<MakeTxData<T>> {
    const txBuilder = this.createTxBuilder();
    const baseIn = outputMint.toString() === poolInfo.mintB.address;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toBase58();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toBase58();

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 =
        outputMint.toString() === poolInfo.mintB.address
          ? MIN_SQRT_PRICE_X64.add(new BN(1))
          : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    let ownerTokenAccountA: PublicKey | undefined;
    if (!ownerTokenAccountA) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintA.programId,
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintAUseSOLBalance,
        createInfo:
          mintAUseSOLBalance || !baseIn
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: baseIn ? amountInMax : 0,
              }
            : undefined,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
      ownerTokenAccountA = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    let ownerTokenAccountB: PublicKey | undefined;
    if (!ownerTokenAccountB) {
      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolInfo.mintB.programId,
        mint: new PublicKey(poolInfo.mintB.address),
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !mintBUseSOLBalance,
        createInfo:
          mintBUseSOLBalance || baseIn
            ? {
                payer: ownerInfo.feePayer || this.scope.ownerPubKey,
                amount: baseIn ? 0 : amountInMax,
              }
            : undefined,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
      ownerTokenAccountB = account!;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("user do not have token account", {
        tokenA: poolInfo.mintA.symbol || poolInfo.mintA.address,
        tokenB: poolInfo.mintB.symbol || poolInfo.mintB.address,
        ownerTokenAccountA,
        ownerTokenAccountB,
        mintAUseSOLBalance,
        mintBUseSOLBalance,
        associatedOnly,
      });

    const poolKeys = propPoolKeys ?? (await this.getClmmPoolKeys(poolInfo.id));
    txBuilder.addInstruction(
      ClmmInstrument.makeSwapBaseOutInstructions({
        poolInfo,
        poolKeys,
        observationId,
        ownerInfo: {
          wallet: this.scope.ownerPubKey,
          tokenAccountA: ownerTokenAccountA!,
          tokenAccountB: ownerTokenAccountB!,
        },
        outputMint: new PublicKey(outputMint),
        amountOut,
        amountInMax,
        sqrtPriceLimitX64,
        remainingAccounts,
      }),
    );

    txBuilder.addCustomComputeBudget(computeBudgetConfig);

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async harvestAllRewards<T extends TxVersion = TxVersion.LEGACY>({
    allPoolInfo,
    allPositions,
    ownerInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
    programId,
    txVersion,
    computeBudgetConfig,
  }: HarvestAllRewardsParams<T>): Promise<MakeMultiTxData<T>> {
    const ownerMintToAccount: { [mint: string]: PublicKey } = {};
    for (const item of this.scope.account.tokenAccountRawInfos) {
      if (associatedOnly) {
        const ata = getATAAddress(this.scope.ownerPubKey, item.accountInfo.mint, programId).publicKey;
        if (ata.equals(item.pubkey)) ownerMintToAccount[item.accountInfo.mint.toString()] = item.pubkey;
      } else {
        ownerMintToAccount[item.accountInfo.mint.toString()] = item.pubkey;
      }
    }
    const txBuilder = this.createTxBuilder();
    for (const itemInfo of Object.values(allPoolInfo)) {
      if (allPositions[itemInfo.id] === undefined) continue;
      if (
        !allPositions[itemInfo.id].find(
          (i) => !i.liquidity.isZero() || i.rewardInfos.find((ii) => !ii.rewardAmountOwed.isZero()),
        )
      )
        continue;

      const poolInfo = itemInfo;
      const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
      const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

      let ownerTokenAccountA = ownerMintToAccount[poolInfo.mintA.address];
      if (!ownerTokenAccountA) {
        const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: poolInfo.mintA.programId,
          mint: new PublicKey(poolInfo.mintA.address),
          notUseTokenAccount: mintAUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !mintAUseSOLBalance,
          createInfo: {
            payer: ownerInfo.feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerTokenAccountA = account!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }

      let ownerTokenAccountB = ownerMintToAccount[poolInfo.mintB.address];
      if (!ownerTokenAccountB) {
        const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
          tokenProgram: poolInfo.mintB.programId,
          mint: new PublicKey(poolInfo.mintB.address),
          notUseTokenAccount: mintBUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: !mintBUseSOLBalance,
          createInfo: {
            payer: ownerInfo.feePayer || this.scope.ownerPubKey,
            amount: 0,
          },
          associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
          checkCreateATAOwner,
        });
        ownerTokenAccountB = account!;
        instructionParams && txBuilder.addInstruction(instructionParams);
      }

      ownerMintToAccount[poolInfo.mintA.address] = ownerTokenAccountA;
      ownerMintToAccount[poolInfo.mintB.address] = ownerTokenAccountB;

      const rewardAccounts: PublicKey[] = [];
      for (const itemReward of poolInfo.rewardDefaultInfos) {
        const rewardUseSOLBalance = ownerInfo.useSOLBalance && itemReward.mint.address === WSOLMint.toString();
        let ownerRewardAccount = ownerMintToAccount[itemReward.mint.address];
        if (!ownerRewardAccount) {
          const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
            tokenProgram: new PublicKey(itemReward.mint.programId),
            mint: new PublicKey(itemReward.mint.address),
            notUseTokenAccount: rewardUseSOLBalance,
            owner: this.scope.ownerPubKey,
            skipCloseAccount: !rewardUseSOLBalance,
            createInfo: {
              payer: ownerInfo.feePayer || this.scope.ownerPubKey,
              amount: 0,
            },
            associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
          });
          ownerRewardAccount = account!;
          instructionParams && txBuilder.addInstruction(instructionParams);
        }

        ownerMintToAccount[itemReward.mint.address] = ownerRewardAccount;
        rewardAccounts.push(ownerRewardAccount!);
      }

      const poolKeys = await this.getClmmPoolKeys(poolInfo.id);

      for (const itemPosition of allPositions[itemInfo.id]) {
        const insData = ClmmInstrument.decreaseLiquidityInstructions({
          poolInfo,
          poolKeys,
          ownerPosition: itemPosition,
          ownerInfo: {
            wallet: this.scope.ownerPubKey,
            tokenAccountA: ownerTokenAccountA,
            tokenAccountB: ownerTokenAccountB,
            rewardAccounts,
          },
          liquidity: new BN(0),
          amountMinA: new BN(0),
          amountMinB: new BN(0),
        });
        txBuilder.addInstruction(insData);
      }
    }

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
  }

  public async getWhiteListMint({ programId }: { programId: PublicKey }): Promise<PublicKey[]> {
    const accountInfo = await this.scope.connection.getAccountInfo(getPdaOperationAccount(programId).publicKey);
    if (!accountInfo) return [];
    const whitelistMintsInfo = OperationLayout.decode(accountInfo.data);
    return whitelistMintsInfo.whitelistMints.filter((i) => !i.equals(PublicKey.default));
  }

  public async getOwnerPositionInfo({
    programId,
  }: {
    programId: string | PublicKey;
  }): Promise<ReturnType<typeof PositionInfoLayout.decode>[]> {
    await this.scope.account.fetchWalletTokenAccounts();
    const balanceMints = this.scope.account.tokenAccountRawInfos.filter((acc) => acc.accountInfo.amount.eq(new BN(1)));
    const allPositionKey = balanceMints.map(
      (acc) => getPdaPersonalPositionAddress(new PublicKey(programId), acc.accountInfo.mint).publicKey,
    );

    const accountInfo = await this.scope.connection.getMultipleAccountsInfo(allPositionKey);
    const allPosition: ReturnType<typeof PositionInfoLayout.decode>[] = [];
    accountInfo.forEach((positionRes) => {
      if (!positionRes) return;
      const position = PositionInfoLayout.decode(positionRes.data);
      allPosition.push(position);
    });

    return allPosition;
  }

  public async getRpcClmmPoolInfo({ poolId }: { poolId: string | PublicKey }): Promise<ClmmRpcData> {
    return (await this.getRpcClmmPoolInfos({ poolIds: [poolId] }))[String(poolId)];
  }

  public async getRpcClmmPoolInfos({
    poolIds,
    config,
  }: {
    poolIds: (string | PublicKey)[];
    config?: { batchRequest?: boolean; chunkCount?: number };
  }): Promise<{
    [poolId: string]: ClmmRpcData;
  }> {
    const accounts = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      poolIds.map((i) => ({ pubkey: new PublicKey(i) })),
      config,
    );
    const returnData: {
      [poolId: string]: ClmmRpcData;
    } = {};
    for (let i = 0; i < poolIds.length; i++) {
      const item = accounts[i];
      if (item === null || !item.accountInfo) throw Error("fetch pool info error: " + String(poolIds[i]));
      const rpc = PoolInfoLayout.decode(item.accountInfo.data);
      const currentPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
        rpc.sqrtPriceX64,
        rpc.mintDecimalsA,
        rpc.mintDecimalsB,
      ).toNumber();

      returnData[String(poolIds[i])] = {
        ...rpc,
        currentPrice,
        programId: item.accountInfo.owner,
      };
    }
    return returnData;
  }

  public async getComputeClmmPoolInfos({
    clmmPoolsRpcInfo,
    mintInfos,
  }: {
    clmmPoolsRpcInfo: Record<
      string,
      ReturnType<typeof PoolInfoLayout.decode> & { currentPrice: number; programId: PublicKey }
    >;
    mintInfos: ReturnTypeFetchMultipleMintInfos;
  }): Promise<{
    computeClmmPoolInfo: Record<string, ComputeClmmPoolInfo>;
    computePoolTickData: ReturnTypeFetchMultiplePoolTickArrays;
  }> {
    const configSet = new Set(Object.keys(clmmPoolsRpcInfo).map((p) => clmmPoolsRpcInfo[p].ammConfig.toBase58()));
    const res = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      Array.from(configSet).map((s) => ({ pubkey: new PublicKey(s) })),
    );
    const clmmConfigs: Record<string, ReturnType<typeof ClmmConfigLayout.decode>> = {};
    res.forEach((acc) => {
      if (!acc.accountInfo) return;
      clmmConfigs[acc.pubkey.toBase58()] = ClmmConfigLayout.decode(acc.accountInfo.data);
    });
    const computeClmmPoolInfo = await PoolUtils.fetchComputeMultipleClmmInfo({
      connection: this.scope.connection,
      rpcDataMap: clmmPoolsRpcInfo,
      poolList: Object.keys(clmmPoolsRpcInfo).map((poolId) => {
        const [mintA, mintB] = [clmmPoolsRpcInfo[poolId].mintA.toBase58(), clmmPoolsRpcInfo[poolId].mintB.toBase58()];
        return {
          id: poolId,
          programId: clmmPoolsRpcInfo[poolId].programId.toBase58(),
          mintA: toApiV3Token({
            address: mintA,
            decimals: clmmPoolsRpcInfo[poolId].mintDecimalsA,
            programId: mintInfos[mintA].programId.toBase58() || TOKEN_PROGRAM_ID.toBase58(),
            extensions: {
              feeConfig: mintInfos[mintA]?.feeConfig ? toFeeConfig(mintInfos[mintA]?.feeConfig) : undefined,
            },
          }),
          mintB: toApiV3Token({
            address: mintB,
            decimals: clmmPoolsRpcInfo[poolId].mintDecimalsB,
            programId: mintInfos[mintB].programId.toBase58() || TOKEN_PROGRAM_ID.toBase58(),
            extensions: {
              feeConfig: mintInfos[mintB]?.feeConfig ? toFeeConfig(mintInfos[mintB]?.feeConfig) : undefined,
            },
          }),
          price: clmmPoolsRpcInfo[poolId].currentPrice,
          config: {
            ...clmmConfigs[clmmPoolsRpcInfo[poolId].ammConfig.toBase58()],
            id: clmmPoolsRpcInfo[poolId].ammConfig.toBase58(),

            fundFeeRate: 0,
            description: "",
            defaultRange: 0,
            defaultRangePoint: [],
          },
        };
      }),
    });

    const computePoolTickData = await PoolUtils.fetchMultiplePoolTickArrays({
      connection: this.scope.connection,
      poolKeys: Object.values(computeClmmPoolInfo),
    });

    return {
      computeClmmPoolInfo,
      computePoolTickData,
    };
  }

  public async getPoolInfoFromRpc(poolId: string): Promise<{
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    computePoolInfo: ComputeClmmPoolInfo;
    tickData: ReturnTypeFetchMultiplePoolTickArrays;
  }> {
    const rpcData = await this.getRpcClmmPoolInfo({ poolId });

    const mintSet = new Set([rpcData.mintA.toBase58(), rpcData.mintB.toBase58()]);

    const mintInfos = await fetchMultipleMintInfos({
      connection: this.scope.connection,
      mints: Array.from(mintSet).map((m) => new PublicKey(m)),
    });

    const { computeClmmPoolInfo, computePoolTickData } = await this.scope.clmm.getComputeClmmPoolInfos({
      clmmPoolsRpcInfo: { [poolId]: rpcData },
      mintInfos,
    });
    const vaultData = await getMultipleAccountsInfoWithCustomFlags(this.scope.connection, [
      { pubkey: rpcData.vaultA },
      { pubkey: rpcData.vaultB },
    ]);

    const poolInfo = clmmComputeInfoToApiInfo(computeClmmPoolInfo[poolId]);

    if (!vaultData[0].accountInfo || !vaultData[1].accountInfo) throw new Error("pool vault data not found");
    poolInfo.mintAmountA = Number(AccountLayout.decode(vaultData[0].accountInfo.data).amount.toString());
    poolInfo.mintAmountB = Number(AccountLayout.decode(vaultData[1].accountInfo?.data).amount.toString());

    const poolKeys: ClmmKeys = {
      ...computeClmmPoolInfo[poolId],
      id: poolId,
      programId: rpcData.programId.toBase58(),
      openTime: rpcData.startTime.toString(),
      vault: {
        A: rpcData.vaultA.toBase58(),
        B: rpcData.vaultB.toBase58(),
      },
      rewardInfos: [],
      config: poolInfo.config,
    };
    return { poolInfo, poolKeys, computePoolInfo: computeClmmPoolInfo[poolId], tickData: computePoolTickData };
  }
}
