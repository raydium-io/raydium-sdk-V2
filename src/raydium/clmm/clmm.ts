import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { InstructionType, WSOLMint, getTransferAmountFee, solToWSol } from "@/common";
import { Percent } from "@/module/percent";
import { ApiV3PoolInfoConcentratedItem, ClmmKeys } from "@/api/type";
import { MakeTxData, MultiTxBuildData } from "@/common/txTool/txTool";
import { TxVersion } from "@/common/txTool/txType";
import { getATAAddress } from "@/common";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { mockV3CreatePoolInfo, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64, ONE } from "./utils/constants";
import { SqrtPriceMath } from "./utils/math";
import { PoolUtils } from "./utils/pool";
import {
  CreateConcentratedPool,
  IncreasePositionFromLiquidity,
  IncreasePositionFromBase,
  DecreaseLiquidity,
  OpenPositionFromBase,
  OpenPositionFromLiquidity,
  ReturnTypeGetLiquidityAmountOut,
  SwapInParams,
  GetAmountParams,
  InitRewardParams,
  InitRewardsParams,
  SetRewardParams,
  SetRewardsParams,
  CollectRewardParams,
  CollectRewardsParams,
  ManipulateLiquidityExtInfo,
  ReturnTypeComputeAmountOutBaseOut,
  OpenPositionFromLiquidityExtInfo,
  ClosePositionExtInfo,
  InitRewardExtInfo,
  HarvestAllRewardsParams,
} from "./type";
import { ClmmInstrument } from "./instrument";
import { LoadParams, MakeTransaction, ReturnTypeFetchMultipleMintInfos } from "../type";
import { MathUtil } from "./utils/math";
import { TickArray } from "./utils/tick";
import { getPdaOperationAccount } from "./utils/pda";
import { ClmmPositionLayout, OperationLayout } from "./layout";
import BN from "bn.js";

export class Clmm extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams): Promise<void> {
    await this.scope.token.load(params);
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
      txVersion,
    } = props;
    const txBuilder = this.createTxBuilder();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const [mintA, mintB, initPrice] = solToWSol(mint1.address)._bn.gt(solToWSol(mint2.address)._bn)
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
    });

    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

    return txBuilder.versionBuild<{ mockPoolInfo: ApiV3PoolInfoConcentratedItem; address: ClmmKeys }>({
      txVersion,
      extInfo: {
        address: {
          ...insInfo.address,
          programId: programId.toString(),
          id: insInfo.address.poolId.toString(),
          mintA,
          mintB,
          openTime: startTime.toNumber(),
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
          id: insInfo.address.poolId.toString(),
          mintA,
          mintB,
          feeRate: ammConfig.tradeFeeRate,
          openTime: startTime.toNumber(),
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
      },
    }) as Promise<MakeTxData<T, { mockPoolInfo: ApiV3PoolInfoConcentratedItem; address: ClmmKeys }>>;
  }

  public async openPositionFromBase({
    poolInfo,
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
  }: OpenPositionFromBase): Promise<MakeTransaction> {
    if (this.scope.availability.addConcentratedPosition === false)
      this.logAndCreateError("add position feature disabled in your region");

    this.scope.checkOwner();
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | null = null;
    let ownerTokenAccountB: PublicKey | null = null;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();
    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: base === "MintA" ? baseAmount : otherAmountMax,
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
        tokenProgram: new PublicKey(poolInfo.mintB.programId),
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: undefined,
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
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build({ address: insInfo.address });
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
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
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
        tokenProgram: new PublicKey(poolInfo.mintB.programId),
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
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

    const poolKeys = propPoolKeys || ((await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys);

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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

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
      ownerPosition,
      amountMaxA,
      amountMaxB,
      liquidity,
      ownerInfo,
      associatedOnly = true,
      checkCreateATAOwner = false,
      txVersion,
    } = props;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
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
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
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
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

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
      txVersion,
    } = props;
    const txBuilder = this.createTxBuilder();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
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
        mint: new PublicKey(poolInfo.mintB.address),
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
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

    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

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
      ownerPosition,
      ownerInfo,
      amountMinA,
      amountMinB,
      liquidity,
      associatedOnly = true,
      checkCreateATAOwner = false,
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
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
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
        tokenProgram: new PublicKey(poolInfo.mintB.programId),
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
      ownerRewardAccountInstructions && txBuilder.addInstruction(ownerRewardAccountInstructions);
      _ownerRewardAccount && rewardAccounts.push(_ownerRewardAccount);
    }

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );

    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;

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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

    return txBuilder.versionBuild<ManipulateLiquidityExtInfo>({
      txVersion,
      extInfo: { address: extInfo },
    }) as Promise<MakeTxData<T, ManipulateLiquidityExtInfo>>;
  }

  public async closePosition<T extends TxVersion>({
    poolInfo,
    ownerPosition,
    txVersion,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    ownerPosition: ClmmPositionLayout;
    txVersion: T;
  }): Promise<MakeTxData<T, ClosePositionExtInfo>> {
    if (this.scope.availability.removeConcentratedPosition === false)
      this.logAndCreateError("remove position feature disabled in your region");
    const txBuilder = this.createTxBuilder();
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
    const ins = ClmmInstrument.closePositionInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: { wallet: this.scope.ownerPubKey },
      ownerPosition,
    });

    return txBuilder.versionBuild<ClosePositionExtInfo>({
      txVersion,
      extInfo: { address: ins.address },
    }) as Promise<MakeTxData<T, ClosePositionExtInfo>>;
  }

  public async swapBaseIn({
    poolInfo,
    ownerInfo,
    inputMint,
    amountIn,
    amountOutMin,
    priceLimit,
    remainingAccounts,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: SwapInParams): Promise<MakeTransaction> {
    this.scope.checkOwner();

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 =
        inputMint.toString() === poolInfo.mintA.address ? MIN_SQRT_PRICE_X64.add(ONE) : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const txBuilder = this.createTxBuilder();
    const isInputMintA = poolInfo.mintA.address === inputMint.toString();

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintAUseSOLBalance || !isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? amountIn : 0,
              }
            : undefined,
        skipCloseAccount: !(mintAUseSOLBalance || !isInputMintA),
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintB.programId),
        mint: new PublicKey(poolInfo.mintB.address),
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintBUseSOLBalance || isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? 0 : amountIn,
              }
            : undefined,
        skipCloseAccount: !(mintBUseSOLBalance || isInputMintA),
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
    const insInfo = await ClmmInstrument.makeSwapBaseInInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },

      inputMint,

      amountIn,
      amountOutMin,
      sqrtPriceLimitX64,

      remainingAccounts,
    });
    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build();
  }

  public async swapBaseOut({
    poolInfo,
    ownerInfo,

    outputMint,
    amountOut,
    amountInMax,
    priceLimit,

    remainingAccounts,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    ownerInfo: {
      useSOLBalance?: boolean; // if has WSOL mint
    };

    outputMint: PublicKey;
    amountOut: BN;
    amountInMax: BN;
    priceLimit?: Decimal;
    remainingAccounts: PublicKey[];
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
  }): Promise<MakeTransaction> {
    const txBuilder = this.createTxBuilder();
    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 =
        outputMint.toString() === poolInfo.mintB.address ? MIN_SQRT_PRICE_X64.add(ONE) : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const isInputMintA = poolInfo.mintA.address == outputMint.toString();
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.address === WSOLMint.toString();
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.address === WSOLMint.toString();

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: new PublicKey(poolInfo.mintA.programId),
        mint: new PublicKey(poolInfo.mintA.address),
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintAUseSOLBalance || !isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? amountInMax : 0,
              }
            : undefined,
        skipCloseAccount: !(mintAUseSOLBalance || !isInputMintA),
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: new PublicKey(poolInfo.mintB.address),
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo:
          mintBUseSOLBalance || isInputMintA
            ? {
                payer: this.scope.ownerPubKey,
                amount: isInputMintA ? 0 : amountInMax,
              }
            : undefined,
        skipCloseAccount: !(mintBUseSOLBalance || isInputMintA),
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    if (!ownerTokenAccountA && !ownerTokenAccountB) {
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );
    }
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
    const insInfo = ClmmInstrument.swapBaseOutInstructions({
      poolInfo,
      poolKeys,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },

      outputMint,

      amountOut,
      amountInMax,
      sqrtPriceLimitX64,

      remainingAccounts,
    });

    txBuilder.addInstruction(insInfo);
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build();
  }

  public async initReward<T extends TxVersion>({
    poolInfo,
    ownerInfo,
    rewardInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
    notAddComputeBudget = false,
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
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    if (!notAddComputeBudget) await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

    return txBuilder.versionBuild<InitRewardExtInfo>({
      txVersion,
      extInfo: { address: insInfo.address },
    }) as Promise<MakeTxData<T, InitRewardExtInfo>>;
  }

  public async initRewards<T extends TxVersion>({
    poolInfo,
    ownerInfo,
    rewardInfos,
    associatedOnly = true,
    checkCreateATAOwner = false,
    notAddComputeBudget = false,
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

      const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    if (!notAddComputeBudget) await txBuilder.calComputeBudget(ClmmInstrument.addComputations());

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
    notAddComputeBudget = false,
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
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    if (!notAddComputeBudget) await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.versionBuild<{ address: Record<string, PublicKey> }>({
      txVersion,
      extInfo: { address: insInfo.address },
    }) as Promise<MakeTxData<T, { address: Record<string, PublicKey> }>>;
  }

  public async setRewards<T extends TxVersion>({
    poolInfo,
    ownerInfo,
    rewardInfos,
    associatedOnly = true,
    checkCreateATAOwner = false,
    notAddComputeBudget = false,
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
      const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    if (!notAddComputeBudget) await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
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
    const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
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
      const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;
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
    await txBuilder.calComputeBudget(ClmmInstrument.addComputations());
    return txBuilder.build<{ address: Record<string, PublicKey> }>({ address });
  }

  public async harvestAllRewards({
    allPoolInfo,
    allPositions,
    ownerInfo,
    associatedOnly = true,
    checkCreateATAOwner = false,
    programId,
  }: HarvestAllRewardsParams): Promise<MultiTxBuildData> {
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
          tokenProgram: new PublicKey(poolInfo.mintA.programId),
          mint: new PublicKey(poolInfo.mintA.address),
          notUseTokenAccount: mintAUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: true,
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
          tokenProgram: new PublicKey(poolInfo.mintB.programId),
          mint: new PublicKey(poolInfo.mintB.address),
          notUseTokenAccount: mintBUseSOLBalance,
          owner: this.scope.ownerPubKey,
          skipCloseAccount: true,
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

      const poolKeys = (await this.scope.api.fetchPoolKeysById({ id: poolInfo.id })) as ClmmKeys;

      for (const itemPosition of allPositions[itemInfo.id]) {
        txBuilder.addInstruction({
          instructions: ClmmInstrument.decreaseLiquidityInstructions({
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
          }).instructions,
        });
      }
    }

    return txBuilder.sizeCheckBuild();
  }

  public async getWhiteListMint({ programId }: { programId: PublicKey }): Promise<PublicKey[]> {
    const accountInfo = await this.scope.connection.getAccountInfo(getPdaOperationAccount(programId).publicKey);
    if (!accountInfo) return [];
    const whitelistMintsInfo = OperationLayout.decode(accountInfo.data);
    return whitelistMintsInfo.whitelistMints.filter((i) => !i.equals(PublicKey.default));
  }

  public async computeAmountIn({
    poolInfo,
    tickArrayCache,
    baseMint,
    token2022Infos,
    amountOut,
    slippage,
    priceLimit = new Decimal(0),
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    tickArrayCache: { [key: string]: TickArray };
    baseMint: PublicKey;
    token2022Infos: ReturnTypeFetchMultipleMintInfos;
    amountOut: BN;
    slippage: number;
    priceLimit?: Decimal;
  }): Promise<ReturnTypeComputeAmountOutBaseOut> {
    const epochInfo = await this.scope.fetchEpochInfo();

    let sqrtPriceLimitX64: BN;
    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 =
        baseMint.toString() === poolInfo.mintB.address ? MIN_SQRT_PRICE_X64.add(ONE) : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const realAmountOut = getTransferAmountFee(
      amountOut,
      token2022Infos[baseMint.toString()]?.feeConfig,
      epochInfo,
      true,
    );

    const {
      expectedAmountIn,
      remainingAccounts,
      executionPrice: _executionPriceX64,
      feeAmount,
    } = PoolUtils.getInputAmountAndRemainAccounts(
      poolInfo as any, // todo
      tickArrayCache,
      baseMint,
      realAmountOut.amount.sub(realAmountOut.fee || new BN(0)),
      sqrtPriceLimitX64,
    );

    const _executionPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      _executionPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const executionPrice =
      baseMint.toString() === poolInfo.mintA.address ? _executionPrice : new Decimal(1).div(_executionPrice);

    const maxAmountIn = expectedAmountIn.mul(new BN(Math.floor((1 + slippage) * 10000000000))).div(new BN(10000000000));

    const poolPrice =
      poolInfo.mintA.address === baseMint.toString() ? poolInfo.price : new Decimal(1).div(poolInfo.price);

    const _numerator = new Decimal(executionPrice).sub(poolPrice).abs();
    const _denominator = poolPrice;
    const priceImpact = new Percent(
      new Decimal(_numerator).mul(10 ** 15).toFixed(0),
      new Decimal(_denominator).mul(10 ** 15).toFixed(0),
    );

    return {
      amountIn: expectedAmountIn,
      maxAmountIn,
      currentPrice: new Decimal(poolInfo.price),
      executionPrice,
      priceImpact,
      fee: feeAmount,

      remainingAccounts,
    };
  }
}
