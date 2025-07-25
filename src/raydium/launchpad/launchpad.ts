import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  TxVersion,
  MakeTxData,
  LAUNCHPAD_PROGRAM,
  getMultipleAccountsInfoWithCustomFlags,
  getATAAddress,
  MakeMultiTxData,
} from "@/common";
import {
  BuyToken,
  BuyTokenExactOut,
  ClaimAllPlatformFee,
  ClaimCreatorFee,
  ClaimMultipleVaultPlatformFee,
  ClaimMultiVesting,
  ClaimPlatformFee,
  ClaimVaultPlatformFee,
  ClaimVesting,
  CreateLaunchPad,
  CreateMultipleVesting,
  CreatePlatform,
  CreateVesting,
  LaunchpadConfigInfo,
  LaunchpadPoolInfo,
  SellToken,
  SellTokenExactOut,
  UpdatePlatform,
} from "./type";
import {
  getPdaCreatorFeeVaultAuth,
  getPdaCreatorVault,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformFeeVaultAuth,
  getPdaPlatformId,
  getPdaPlatformVault,
  getPdaVestId,
} from "./pda";
import {
  initialize,
  buyExactInInstruction,
  sellExactInInstruction,
  createPlatformConfig,
  updatePlatformConfig,
  claimPlatformFee,
  createVestingAccount,
  claimVestedToken,
  buyExactOutInstruction,
  initializeWithToken2022,
  sellExactOut,
  claimPlatformFeeFromVault,
  claimCreatorFee,
} from "./instrument";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransferFeeConfig,
  createAssociatedTokenAccountIdempotentInstruction,
  getTransferFeeConfig,
  unpackMint,
} from "@solana/spl-token";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { getPdaMetadataKey } from "../clmm";
import { LaunchpadConfig, LaunchpadPool, PlatformConfig } from "./layout";
import { Curve, SwapInfoReturn } from "./curve/curve";
import Decimal from "decimal.js";

export const LaunchpadPoolInitParam = {
  initPriceX64: new BN("515752397214619"),
  supply: new BN(1_000_000_000_000_000),
  totalSellA: new BN(793_100_000_000_000),
  totalFundRaisingB: new BN(85_000_000_000),
  totalLockedAmount: new BN("0"),
  cliffPeriod: new BN("0"),
  unlockPeriod: new BN("0"),
  decimals: 6,
  virtualA: new BN("1073471847374405"),
  virtualB: new BN("30050573465"),
  realA: new BN(0),
  realB: new BN(0),
  protocolFee: new BN(0),
  platformId: new PublicKey("4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4"),
  vestingSchedule: {
    totalLockedAmount: new BN(0),
    cliffPeriod: new BN(0),
    unlockPeriod: new BN(0),
    startTime: new BN(0),
    totalAllocatedShare: new BN(0),
  },
};

const SLIPPAGE_UNIT = new BN(10000);

export interface SwapInfoReturnExt extends SwapInfoReturn {
  decimalOutAmount: Decimal;
  minDecimalOutAmount: Decimal;
}
export default class LaunchpadModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async createLaunchpad<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    platformId = LaunchpadPoolInitParam.platformId,
    mintA,
    decimals = 6,
    mintBDecimals = 9,
    name,
    symbol,
    uri,
    migrateType,
    configId,

    configInfo: propConfigInfo,
    platformFeeRate,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    buyAmount,
    minMintAAmount,
    slippage,
    associatedOnly = true,
    checkCreateATAOwner = false,
    extraSigners,

    token2022,
    transferFeeExtensionParams,
    ...extraConfigs
  }: CreateLaunchPad<T>): Promise<
    MakeMultiTxData<T, { address: LaunchpadPoolInfo & { poolId: PublicKey }; swapInfo: SwapInfoReturnExt }>
  > {
    const txBuilder = this.createTxBuilder(feePayer);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

    token2022 = !!transferFeeExtensionParams;
    if (token2022) migrateType = "cpmm";
    let configInfo = propConfigInfo;
    if (!configInfo && configId) {
      const r = await this.scope.connection.getAccountInfo(configId);
      if (r) configInfo = LaunchpadConfig.decode(r.data);
    }

    if (!configInfo) this.logAndCreateError("config not found");
    const mintB = configInfo!.mintB;
    const curType = configInfo!.curveType;

    // const { publicKey: configId } = getPdaLaunchpadConfigId(programId, mintB, curType, configIndex);
    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);
    const { publicKey: vaultA } = getPdaLaunchpadVaultId(programId, poolId, mintA);
    const { publicKey: vaultB } = getPdaLaunchpadVaultId(programId, poolId, mintB);
    const { publicKey: metaId } = getPdaMetadataKey(mintA);

    this.logDebug(
      `create token: ${mintA.toBase58()}, mintB: ${mintB.toBase58()}, decimals A:${decimals}/B:${mintBDecimals}, config:${configId.toBase58()}`,
    );

    if (symbol.length > 10) this.logAndCreateError("Symbol length should shorter than 11");
    if (!uri) this.logAndCreateError("uri should not empty");

    const supply = extraConfigs?.supply ?? LaunchpadPoolInitParam.supply;
    const totalSellA = extraConfigs?.totalSellA ?? LaunchpadPoolInitParam.totalSellA;
    const totalFundRaisingB = extraConfigs?.totalFundRaisingB ?? LaunchpadPoolInitParam.totalFundRaisingB;
    const totalLockedAmount = extraConfigs?.totalLockedAmount ?? new BN(0);

    let defaultPlatformFeeRate = platformFeeRate;
    if (!platformFeeRate) {
      const platformData = await this.scope.connection.getAccountInfo(platformId);
      if (!platformData) this.logAndCreateError("platform id not found:", platformId.toString());
      defaultPlatformFeeRate = PlatformConfig.decode(platformData!.data).feeRate;
    }

    const curve = Curve.getCurve(configInfo!.curveType);
    const initParam = curve.getInitParam({
      supply,
      totalFundRaising: totalFundRaisingB,
      totalSell: totalSellA,
      totalLockedAmount,
      migrateFee: configInfo!.migrateFee,
    });

    const poolInfo: LaunchpadPoolInfo = {
      epoch: new BN(896),
      bump: 254,
      status: 0,
      mintDecimalsA: decimals,
      mintDecimalsB: mintBDecimals,
      supply,
      totalSellA,
      mintA: new PublicKey(mintA),
      mintB,
      virtualA: initParam.a,
      virtualB: initParam.b,
      realA: LaunchpadPoolInitParam.realA,
      realB: LaunchpadPoolInitParam.realB,
      migrateFee: configInfo!.migrateFee,
      migrateType: migrateType === "amm" ? 0 : 1,
      protocolFee: LaunchpadPoolInitParam.protocolFee,
      platformFee: defaultPlatformFeeRate!,
      platformId,
      configId,
      vaultA,
      vaultB,
      creator: this.scope.ownerPubKey,
      totalFundRaisingB,
      vestingSchedule: {
        totalLockedAmount,
        cliffPeriod: new BN(0),
        unlockPeriod: new BN(0),
        startTime: new BN(0),
        totalAllocatedShare: new BN(0),
      },
      mintProgramFlag: token2022 ? 1 : 0,
    };

    const initCurve = Curve.getCurve(configInfo!.curveType);
    const { c } = initCurve.getInitParam({
      supply: poolInfo.supply,
      totalFundRaising: poolInfo.totalFundRaisingB,
      totalLockedAmount,
      totalSell: configInfo!.curveType === 0 ? poolInfo.totalSellA : new BN(0),
      migrateFee: configInfo!.migrateFee,
    });

    try {
      Curve.checkParam({
        supply: poolInfo.supply,
        totalFundRaising: poolInfo.totalFundRaisingB,
        totalSell: c,
        totalLockedAmount,
        decimals: poolInfo.mintDecimalsA,
        config: configInfo!,
        migrateType,
      });
      this.logDebug("check init params success");
    } catch (e: any) {
      this.logAndCreateError(`check create mint params failed, ${e.message}`);
    }

    txBuilder.addInstruction({
      instructions: [
        token2022
          ? initializeWithToken2022(
              programId,
              feePayer ?? this.scope.ownerPubKey,
              this.scope.ownerPubKey,
              configId,
              platformId,
              authProgramId,
              poolId,
              mintA,
              mintB,
              vaultA,
              vaultB,

              decimals,
              name,
              symbol,
              uri || "https://",

              {
                type:
                  curType === 0
                    ? "ConstantCurve"
                    : curType === 1
                    ? "FixedCurve"
                    : curType === 2
                    ? "LinearCurve"
                    : "ConstantCurve",
                totalSellA,
                migrateType,
                supply,
                totalFundRaisingB,
              },
              totalLockedAmount,
              extraConfigs?.cliffPeriod ?? new BN(0),
              extraConfigs?.unlockPeriod ?? new BN(0),
              transferFeeExtensionParams,
            )
          : initialize(
              programId,
              feePayer ?? this.scope.ownerPubKey,
              this.scope.ownerPubKey,
              configId,
              platformId,
              authProgramId,
              poolId,
              mintA,
              mintB,
              vaultA,
              vaultB,
              metaId,

              decimals,
              name,
              symbol,
              uri || "https://",

              {
                type:
                  curType === 0
                    ? "ConstantCurve"
                    : curType === 1
                    ? "FixedCurve"
                    : curType === 2
                    ? "LinearCurve"
                    : "ConstantCurve",
                totalSellA,
                migrateType,
                supply,
                totalFundRaisingB,
              },
              totalLockedAmount,
              extraConfigs?.cliffPeriod ?? new BN(0),
              extraConfigs?.unlockPeriod ?? new BN(0),
            ),
      ],
    });

    const epoch = token2022 ? await this.scope.connection.getEpochInfo() : undefined;
    const fee = transferFeeExtensionParams
      ? {
          epoch: BigInt(epoch?.epoch || 0),
          maximumFee: BigInt(transferFeeExtensionParams?.maxinumFee.toString() ?? 0),
          transferFeeBasisPoints: transferFeeExtensionParams?.transferFeeBasePoints ?? 0,
        }
      : undefined;

    let swapInfo: SwapInfoReturn = {
      amountA: {
        amount: new BN(0),
        fee: undefined,
        expirationTime: undefined,
      },
      amountB: new BN(0),
      splitFee: {
        platformFee: new BN(0),
        shareFee: new BN(0),
        protocolFee: new BN(0),
        creatorFee: new BN(0),
      },
    };
    let splitIns;
    if (extraSigners?.length) txBuilder.addInstruction({ signers: extraSigners });
    if (!extraConfigs.createOnly) {
      const { builder, extInfo } = await this.buyToken({
        programId,
        authProgramId,
        mintAProgram: token2022 ? TOKEN_2022_PROGRAM_ID : undefined,
        mintA,
        mintB,
        poolInfo,
        buyAmount,
        minMintAAmount,
        shareFeeRate: extraConfigs.shareFeeRate,
        shareFeeReceiver: extraConfigs.shareFeeReceiver,
        configInfo,
        platformFeeRate: defaultPlatformFeeRate,
        slippage,
        associatedOnly,
        checkCreateATAOwner,
        skipCheckMintA: !fee,
        transferFeeConfigA: fee
          ? {
              transferFeeConfigAuthority: authProgramId,
              withdrawWithheldAuthority: authProgramId,
              withheldAmount: BigInt(0),
              olderTransferFee: fee,
              newerTransferFee: fee,
            }
          : undefined,
      });
      txBuilder.addInstruction({ ...builder.AllTxData });
      swapInfo = { ...extInfo };
      splitIns =
        (this.scope.cluster === "devnet" || txVersion === TxVersion.LEGACY) && extraConfigs.shareFeeReceiver
          ? [builder.allInstructions[0]]
          : undefined;
    }

    txBuilder.addTipInstruction(txTipConfig);

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({
        computeBudgetConfig,
        swapInfo,
        splitIns,
        address: {
          ...poolInfo,
          poolId,
        },
      }) as Promise<
        MakeMultiTxData<T, { address: LaunchpadPoolInfo & { poolId: PublicKey }; swapInfo: SwapInfoReturnExt }>
      >;
    return txBuilder.sizeCheckBuild({
      computeBudgetConfig,
      swapInfo,
      splitIns,
      address: {
        ...poolInfo,
        poolId,
      },
    }) as Promise<
      MakeMultiTxData<T, { address: LaunchpadPoolInfo & { poolId: PublicKey }; swapInfo: SwapInfoReturnExt }>
    >;
  }

  public async buyToken<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintA,
    mintAProgram = TOKEN_PROGRAM_ID,
    mintB = NATIVE_MINT,
    poolInfo: propPoolInfo,

    configInfo: propConfigInfo,
    platformFeeRate,

    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    buyAmount,
    minMintAAmount: propMinMintAAmount,
    slippage,

    shareFeeRate = new BN(0),
    shareFeeReceiver,

    associatedOnly = true,
    checkCreateATAOwner = false,
    transferFeeConfigA: propsTransferFeeConfigA,
    skipCheckMintA = false,
  }: BuyToken<T>): Promise<MakeTxData<T, SwapInfoReturnExt>> {
    if (buyAmount.lte(new BN(0))) this.logAndCreateError("buy amount should gt 0:", buyAmount.toString());
    const txBuilder = this.createTxBuilder(feePayer);
    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

    let transferFeeConfigA = propsTransferFeeConfigA;
    if (!skipCheckMintA) {
      if (!transferFeeConfigA) {
        const mintInfo = await this.scope.connection.getAccountInfo(mintA);
        if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          mintAProgram = mintInfo.owner;
          const onlineData = unpackMint(mintA, mintInfo, mintAProgram);
          transferFeeConfigA = getTransferFeeConfig(onlineData) || undefined;
        }
      } else {
        mintAProgram = TOKEN_2022_PROGRAM_ID;
      }
    }

    const userTokenAccountA = this.scope.account.getAssociatedTokenAccount(mintA, mintAProgram);
    let userTokenAccountB: PublicKey | null = null;
    const mintBUseSOLBalance = mintB.equals(NATIVE_MINT);

    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          userTokenAccountA,
          this.scope.ownerPubKey,
          mintA,
          mintAProgram,
        ),
      ],
    });
    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: mintB,
        owner: this.scope.ownerPubKey,
        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: buyAmount,
            }
          : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) userTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});
    if (userTokenAccountB === undefined)
      this.logAndCreateError(
        `cannot found mintB(${mintB.toBase58()}) token accounts`,
        "tokenAccounts",
        this.scope.account.tokenAccounts,
      );
    let poolInfo = propPoolInfo;
    if (!poolInfo) {
      const poolData = await this.scope.connection.getAccountInfo(poolId, { commitment: "processed" });
      if (!poolData) this.logAndCreateError("cannot found pool:", poolId.toBase58());
      poolInfo = LaunchpadPool.decode(poolData!.data);
    }

    let configInfo = propConfigInfo;
    const allData = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      [configInfo ? undefined : poolInfo.configId, poolInfo.platformId]
        .filter(Boolean)
        .map((key) => ({ pubkey: key! })),
    );
    if (!configInfo) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.configId));
      if (!data || !data.accountInfo) this.logAndCreateError("config not found: ", poolInfo.configId.toBase58());
      configInfo = LaunchpadConfig.decode(data!.accountInfo!.data);
    }
    const platformData = allData.find((d) => d.pubkey.equals(poolInfo!.platformId));
    if (!platformData || !platformData.accountInfo)
      this.logAndCreateError("platform info not found: ", poolInfo.configId.toBase58());
    const platformInfo = PlatformConfig.decode(platformData!.accountInfo!.data);
    platformFeeRate = platformFeeRate || platformInfo.feeRate;

    const calculatedAmount = Curve.buyExactIn({
      poolInfo,
      amountB: buyAmount,
      protocolFeeRate: configInfo.tradeFeeRate,
      platformFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
      creatorFeeRate: platformInfo.creatorFeeRate,
      transferFeeConfigA,
      slot: await this.scope.connection.getSlot(),
    });

    const decimalAmountA = new Decimal(calculatedAmount.amountA.amount.toString()).sub(
      calculatedAmount.amountA.fee?.toString() ?? 0,
    );

    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.sub(slippage).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(0, 1)
      : new Decimal(1);

    const minMintAAmount =
      propMinMintAAmount ??
      (slippage
        ? new BN(decimalAmountA.mul(multiplier).toFixed(0))
        : calculatedAmount.amountA.amount.sub(calculatedAmount.amountA.fee ?? new BN(0)));

    if (calculatedAmount.amountB.lt(buyAmount)) {
      console.log(
        `maximum ${mintA.toBase58()} amount can buy is ${calculatedAmount.amountA.toString()}, input ${mintB.toBase58()} amount: ${calculatedAmount.amountB.toString()}`,
      );
    }

    const shareATA = shareFeeReceiver ? getATAAddress(shareFeeReceiver, mintB, TOKEN_PROGRAM_ID).publicKey : undefined;
    if (shareATA) {
      txBuilder.addInstruction({
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(this.scope.ownerPubKey, shareATA, shareFeeReceiver!, mintB),
        ],
      });
    }

    txBuilder.addInstruction({
      instructions: [
        buyExactInInstruction(
          programId,
          this.scope.ownerPubKey,
          authProgramId,
          poolInfo.configId,
          poolInfo.platformId,
          poolId,
          userTokenAccountA!,
          userTokenAccountB!,
          poolInfo.vaultA,
          poolInfo.vaultB,
          mintA,
          mintB,
          mintAProgram,
          TOKEN_PROGRAM_ID,

          getPdaPlatformVault(programId, poolInfo.platformId, mintB).publicKey,
          getPdaCreatorVault(programId, poolInfo.creator, mintB).publicKey,

          calculatedAmount.amountB.lt(buyAmount) ? calculatedAmount.amountB : buyAmount,
          minMintAAmount,
          shareFeeRate,
          shareATA,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild<SwapInfoReturnExt>({
      txVersion,
      extInfo: {
        ...calculatedAmount,
        decimalOutAmount: decimalAmountA,
        minDecimalOutAmount: new Decimal(minMintAAmount.toString()),
      },
    }) as Promise<MakeTxData<T, SwapInfoReturnExt>>;
  }

  public async buyTokenExactOut<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintA,
    mintAProgram = TOKEN_PROGRAM_ID,
    mintB = NATIVE_MINT,
    poolInfo: propPoolInfo,

    configInfo: propConfigInfo,
    transferFeeConfigA: propsTransferFeeConfigA,
    platformFeeRate,

    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    maxBuyAmount,
    outAmount,
    slippage,

    shareFeeRate = new BN(0),
    shareFeeReceiver,

    associatedOnly = true,
    checkCreateATAOwner = false,
    skipCheckMintA = false,
  }: BuyTokenExactOut<T>): Promise<MakeTxData<T, { outAmount: BN; maxSpentAmount: BN }>> {
    if (outAmount.lte(new BN(0))) this.logAndCreateError("out amount should gt 0:", outAmount.toString());
    const txBuilder = this.createTxBuilder(feePayer);
    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

    let poolInfo = propPoolInfo;
    if (!poolInfo) {
      const poolData = await this.scope.connection.getAccountInfo(poolId, { commitment: "processed" });
      if (!poolData) this.logAndCreateError("cannot found pool:", poolId.toBase58());
      poolInfo = LaunchpadPool.decode(poolData!.data);
    }

    let configInfo = propConfigInfo;
    const allData = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      [configInfo ? undefined : poolInfo.configId, poolInfo.platformId]
        .filter(Boolean)
        .map((key) => ({ pubkey: key! })),
    );
    if (!configInfo) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.configId));
      if (!data || !data.accountInfo) this.logAndCreateError("config not found: ", poolInfo.configId.toBase58());
      configInfo = LaunchpadConfig.decode(data!.accountInfo!.data);
    }
    const platformData = allData.find((d) => d.pubkey.equals(poolInfo!.platformId));
    if (!platformData || !platformData.accountInfo)
      this.logAndCreateError("platform info not found: ", poolInfo.configId.toBase58());
    const platformInfo = PlatformConfig.decode(platformData!.accountInfo!.data);
    platformFeeRate = platformFeeRate || platformInfo.feeRate;

    let transferFeeConfigA = propsTransferFeeConfigA;
    if (!skipCheckMintA) {
      if (!transferFeeConfigA) {
        const mintInfo = await this.scope.connection.getAccountInfo(mintA);
        if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          mintAProgram = mintInfo.owner;
          const onlineData = unpackMint(mintA, mintInfo, mintAProgram);
          transferFeeConfigA = getTransferFeeConfig(onlineData) || undefined;
        }
      } else {
        mintAProgram = TOKEN_2022_PROGRAM_ID;
      }
    }

    const calculatedAmount = Curve.buyExactOut({
      poolInfo,
      amountA: outAmount,
      protocolFeeRate: configInfo.tradeFeeRate,
      platformFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
      creatorFeeRate: platformInfo.creatorFeeRate,
      transferFeeConfigA,
      slot: await this.scope.connection.getSlot(),
    });

    const decimalAmountB = new Decimal(calculatedAmount.amountB.toString());
    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.add(slippage).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(
          0,
          Number.MIN_SAFE_INTEGER,
        )
      : new Decimal(1);

    const maxAmountB =
      maxBuyAmount ?? slippage ? new BN(decimalAmountB.mul(multiplier).toFixed(0)) : calculatedAmount.amountB;

    const userTokenAccountA = this.scope.account.getAssociatedTokenAccount(mintA, mintAProgram);
    let userTokenAccountB: PublicKey | null = null;

    const mintBUseSOLBalance = mintB.equals(NATIVE_MINT);

    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          userTokenAccountA,
          this.scope.ownerPubKey,
          mintA,
          mintAProgram,
        ),
      ],
    });

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: mintB,
        owner: this.scope.ownerPubKey,
        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: calculatedAmount.amountB,
            }
          : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) userTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});
    if (userTokenAccountB === undefined)
      this.logAndCreateError(
        `cannot found mintB(${mintB.toBase58()}) token accounts`,
        "tokenAccounts",
        this.scope.account.tokenAccounts,
      );

    const shareATA = shareFeeReceiver ? getATAAddress(shareFeeReceiver, mintB, TOKEN_PROGRAM_ID).publicKey : undefined;
    if (shareATA) {
      txBuilder.addInstruction({
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(this.scope.ownerPubKey, shareATA, shareFeeReceiver!, mintB),
        ],
      });
    }

    txBuilder.addInstruction({
      instructions: [
        buyExactOutInstruction(
          programId,

          this.scope.ownerPubKey,
          authProgramId,
          poolInfo.configId,
          poolInfo.platformId,
          poolId,
          userTokenAccountA!,
          userTokenAccountB!,
          poolInfo.vaultA,
          poolInfo.vaultB,
          mintA,
          mintB,
          mintAProgram,
          TOKEN_PROGRAM_ID,

          getPdaPlatformVault(programId, poolInfo.platformId, mintB).publicKey,
          getPdaCreatorVault(programId, poolInfo.creator, mintB).publicKey,

          outAmount,
          maxAmountB,
          shareFeeRate,
          shareATA,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild<{ outAmount: BN; maxSpentAmount: BN }>({
      txVersion,
      extInfo: {
        maxSpentAmount: maxAmountB,
        outAmount,
      },
    }) as Promise<MakeTxData<T, { outAmount: BN; maxSpentAmount: BN }>>;
  }

  public async sellToken<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintAProgram = TOKEN_PROGRAM_ID,
    mintA,
    mintB = NATIVE_MINT,
    poolInfo: propPoolInfo,
    configInfo: propConfigInfo,
    platformFeeRate,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    sellAmount,
    minAmountB: propMinAmountB,
    slippage,

    shareFeeRate = new BN(0),
    shareFeeReceiver,

    associatedOnly = true,
    checkCreateATAOwner = false,
    skipCheckMintA = false,
  }: SellToken<T>): Promise<MakeTxData<T, { outAmount: BN }>> {
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;
    const txBuilder = this.createTxBuilder(feePayer);

    if (sellAmount.lte(new BN(0))) this.logAndCreateError("sell amount should be gt 0");

    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);

    let transferFeeConfigA: TransferFeeConfig | undefined;
    if (!skipCheckMintA) {
      const mintInfo = await this.scope.connection.getAccountInfo(mintA);
      if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        mintAProgram = mintInfo.owner;
        const onlineData = unpackMint(mintA, mintInfo, mintAProgram);
        transferFeeConfigA = getTransferFeeConfig(onlineData) || undefined;
      }
    }

    let userTokenAccountA: PublicKey | null = null;
    let userTokenAccountB: PublicKey | null = null;

    const mintBUseSOLBalance = mintB.equals(NATIVE_MINT);

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: mintAProgram,
        mint: mintA,
        owner: this.scope.ownerPubKey,

        createInfo: undefined,
        skipCloseAccount: true,
        notUseTokenAccount: false,
        associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) userTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    if (userTokenAccountA === undefined)
      this.logAndCreateError("cannot found mintA token accounts", "tokenAccounts", this.scope.account.tokenAccounts);
    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: mintB,
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: 0,
            }
          : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) userTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (userTokenAccountB === undefined)
      this.logAndCreateError("cannot found mintB token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    let poolInfo = propPoolInfo;
    if (!poolInfo) {
      const poolData = await this.scope.connection.getAccountInfo(poolId, { commitment: "processed" });
      if (!poolData) this.logAndCreateError("cannot found pool", poolId.toBase58());
      poolInfo = LaunchpadPool.decode(poolData!.data);
    }
    let configInfo = propConfigInfo;
    const allData = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      [configInfo ? undefined : poolInfo.configId, poolInfo.platformId]
        .filter(Boolean)
        .map((key) => ({ pubkey: key! })),
    );
    if (!configInfo) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.configId));
      if (!data || !data.accountInfo) this.logAndCreateError("config not found: ", poolInfo.configId.toBase58());
      configInfo = LaunchpadConfig.decode(data!.accountInfo!.data);
    }

    const platformData = allData.find((d) => d.pubkey.equals(poolInfo!.platformId));
    if (!platformData || !platformData.accountInfo)
      this.logAndCreateError("platform info not found: ", poolInfo.configId.toBase58());
    const platformInfo = PlatformConfig.decode(platformData!.accountInfo!.data);
    platformFeeRate = platformFeeRate || platformInfo.feeRate;

    const calculatedAmount = Curve.sellExactIn({
      poolInfo,
      amountA: sellAmount,
      protocolFeeRate: configInfo.tradeFeeRate,
      platformFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
      creatorFeeRate: platformInfo.creatorFeeRate,
      transferFeeConfigA,
      slot: await this.scope.connection.getSlot(),
    });

    const decimalAmountB = new Decimal(calculatedAmount.amountB.toString());
    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.sub(slippage).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(0, 1)
      : new Decimal(1);

    const minAmountB =
      propMinAmountB ?? (slippage ? new BN(decimalAmountB.mul(multiplier).toFixed(0)) : calculatedAmount.amountB);

    if (minAmountB.lte(new BN(0))) this.logAndCreateError(`out ${mintB.toBase58()} amount should be gt 0`);

    const shareATA = shareFeeReceiver ? getATAAddress(shareFeeReceiver, mintB, TOKEN_PROGRAM_ID).publicKey : undefined;
    if (shareATA) {
      txBuilder.addInstruction({
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(this.scope.ownerPubKey, shareATA, shareFeeReceiver!, mintB),
        ],
      });
    }

    txBuilder.addInstruction({
      instructions: [
        sellExactInInstruction(
          programId,
          this.scope.ownerPubKey,
          authProgramId,
          poolInfo.configId,
          poolInfo.platformId,
          poolId,
          userTokenAccountA!,
          userTokenAccountB!,
          poolInfo.vaultA,
          poolInfo.vaultB,
          mintA,
          mintB,
          mintAProgram,
          TOKEN_PROGRAM_ID,

          getPdaPlatformVault(programId, poolInfo.platformId, mintB).publicKey,
          getPdaCreatorVault(programId, poolInfo.creator, mintB).publicKey,

          calculatedAmount.amountA.amount.lt(sellAmount) ? calculatedAmount.amountA.amount : sellAmount,
          minAmountB,
          shareFeeRate,
          shareATA,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild<{ outAmount: BN }>({
      txVersion,
      extInfo: {
        outAmount: minAmountB,
      },
    }) as Promise<MakeTxData<T, { outAmount: BN }>>;
  }

  public async sellTokenExactOut<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintAProgram = TOKEN_PROGRAM_ID,
    mintA,
    mintB = NATIVE_MINT,
    poolInfo: propPoolInfo,
    configInfo: propConfigInfo,
    platformFeeRate,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    inAmount,
    maxSellAmount,
    slippage,

    shareFeeRate = new BN(0),
    shareFeeReceiver,

    associatedOnly = true,
    checkCreateATAOwner = false,
    skipCheckMintA = false,
  }: SellTokenExactOut<T>): Promise<MakeTxData<T, { maxSellAmount: BN }>> {
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;
    const txBuilder = this.createTxBuilder(feePayer);

    if (maxSellAmount?.lte(new BN(0))) this.logAndCreateError("max sell amount should be gt 0");

    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);

    let transferFeeConfigA: TransferFeeConfig | undefined;
    if (!skipCheckMintA) {
      const mintInfo = await this.scope.connection.getAccountInfo(mintA);
      if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        mintAProgram = mintInfo.owner;
        const onlineData = unpackMint(mintA, mintInfo, mintAProgram);
        transferFeeConfigA = getTransferFeeConfig(onlineData) || undefined;
      }
    }

    let userTokenAccountA: PublicKey | null = null;
    let userTokenAccountB: PublicKey | null = null;

    const mintBUseSOLBalance = mintB.equals(NATIVE_MINT);

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: mintAProgram,
        mint: mintA,
        owner: this.scope.ownerPubKey,

        createInfo: undefined,
        skipCloseAccount: true,
        notUseTokenAccount: false,
        associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) userTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    if (userTokenAccountA === undefined)
      this.logAndCreateError("cannot found mintA token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: mintB,
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: 0,
            }
          : undefined,
        skipCloseAccount: !mintBUseSOLBalance,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountB) userTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (userTokenAccountB === undefined)
      this.logAndCreateError("cannot found mintB token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    let poolInfo = propPoolInfo;
    if (!poolInfo) {
      const poolData = await this.scope.connection.getAccountInfo(poolId, { commitment: "processed" });
      if (!poolData) this.logAndCreateError("cannot found pool", poolId.toBase58());
      poolInfo = LaunchpadPool.decode(poolData!.data);
    }

    let configInfo = propConfigInfo;
    const allData = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      [configInfo ? undefined : poolInfo.configId, poolInfo.platformId]
        .filter(Boolean)
        .map((key) => ({ pubkey: key! })),
    );
    if (!configInfo) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.configId));
      if (!data || !data.accountInfo) this.logAndCreateError("config not found: ", poolInfo.configId.toBase58());
      configInfo = LaunchpadConfig.decode(data!.accountInfo!.data);
    }

    const platformData = allData.find((d) => d.pubkey.equals(poolInfo!.platformId));
    if (!platformData || !platformData.accountInfo)
      this.logAndCreateError("platform info not found: ", poolInfo.configId.toBase58());
    const platformInfo = PlatformConfig.decode(platformData!.accountInfo!.data);
    platformFeeRate = platformFeeRate || platformInfo.feeRate;

    const calculatedAmount = Curve.sellExactOut({
      poolInfo,
      amountB: inAmount,
      protocolFeeRate: configInfo.tradeFeeRate,
      platformFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
      creatorFeeRate: platformInfo.creatorFeeRate,
      transferFeeConfigA,
      slot: await this.scope.connection.getSlot(),
    });

    const decimalAmountA = new Decimal(calculatedAmount.amountA.amount.toString());
    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.add(slippage).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(
          0,
          Number.MAX_SAFE_INTEGER,
        )
      : new Decimal(1);

    const maxSellAmountA =
      maxSellAmount ?? slippage ? new BN(decimalAmountA.mul(multiplier).toFixed(0)) : calculatedAmount.amountA.amount;

    const shareATA = shareFeeReceiver ? getATAAddress(shareFeeReceiver, mintB, TOKEN_PROGRAM_ID).publicKey : undefined;
    if (shareATA) {
      txBuilder.addInstruction({
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(this.scope.ownerPubKey, shareATA, shareFeeReceiver!, mintB),
        ],
      });
    }

    txBuilder.addInstruction({
      instructions: [
        sellExactOut(
          programId,
          this.scope.ownerPubKey,
          authProgramId,
          poolInfo.configId,
          poolInfo.platformId,
          poolId,
          userTokenAccountA!,
          userTokenAccountB!,
          poolInfo.vaultA,
          poolInfo.vaultB,
          mintA,
          mintB,
          mintAProgram,
          TOKEN_PROGRAM_ID,

          getPdaPlatformVault(programId, poolInfo.platformId, mintB).publicKey,
          getPdaCreatorVault(programId, poolInfo.creator, mintB).publicKey,

          inAmount,
          maxSellAmountA,

          shareFeeRate,
          shareATA,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild<{ maxSellAmount: BN }>({
      txVersion,
      extInfo: {
        maxSellAmount: maxSellAmountA,
      },
    }) as Promise<MakeTxData<T, { maxSellAmount: BN }>>;
  }

  public async createPlatformConfig<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    platformAdmin,
    platformClaimFeeWallet,
    platformLockNftWallet,
    cpConfigId,
    migrateCpLockNftScale,
    transferFeeExtensionAuth,
    creatorFeeRate,
    feeRate,
    name,
    web,
    img,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: CreatePlatform<T>): Promise<MakeTxData<T, { platformId: PublicKey }>> {
    const txBuilder = this.createTxBuilder(feePayer);

    const { publicKey: platformId } = getPdaPlatformId(programId, platformAdmin);

    txBuilder.addInstruction({
      instructions: [
        createPlatformConfig(
          programId,
          platformAdmin,
          platformClaimFeeWallet,
          platformLockNftWallet,
          platformId,

          cpConfigId,

          transferFeeExtensionAuth,

          migrateCpLockNftScale,

          feeRate,
          creatorFeeRate,
          name,
          web,
          img,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
      extInfo: {
        platformId,
      },
    }) as Promise<MakeTxData<T, { platformId: PublicKey }>>;
  }

  public async updatePlatformConfig<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    platformAdmin,
    platformId: propsPlatformId,
    updateInfo,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: UpdatePlatform<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);

    const platformId = propsPlatformId ?? getPdaPlatformId(programId, platformAdmin).publicKey;

    txBuilder.addInstruction({
      instructions: [updatePlatformConfig(programId, platformAdmin, platformId, updateInfo)],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData>;
  }

  public async claimPlatformFee<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    platformId,
    poolId,
    platformClaimFeeWallet,

    mintB: propsMintB,
    vaultB: propsVaultB,
    mintBProgram = TOKEN_PROGRAM_ID,

    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: ClaimPlatformFee<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

    let mintB = propsMintB;
    let vaultB = propsVaultB;

    if (!mintB) {
      const poolData = await this.scope.connection.getAccountInfo(poolId, { commitment: "processed" });
      if (!poolData) this.logAndCreateError("cannot found pool:", poolId.toBase58());
      const poolInfo = LaunchpadPool.decode(poolData!.data);

      const configData = await this.scope.connection.getAccountInfo(poolInfo.configId, { commitment: "processed" });
      if (!configData) this.logAndCreateError("cannot found config:", poolInfo.configId.toBase58());
      const configInfo = LaunchpadConfig.decode(configData!.data);

      mintB = configInfo.mintB;
      vaultB = vaultB ?? poolInfo.vaultB;
    }

    if (!mintB || !vaultB) {
      this.logAndCreateError(
        "cannot found mint info, mintB: ",
        mintB.toBase58(),
        ", vaultB: ",
        vaultB?.toBase58() ?? "",
      );
    }

    const userTokenAccountB = getATAAddress(this.scope.ownerPubKey, mintB, TOKEN_PROGRAM_ID).publicKey;
    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          userTokenAccountB,
          this.scope.ownerPubKey,
          mintB,
        ),
      ],
    });

    txBuilder.addInstruction({
      instructions: [
        claimPlatformFee(
          programId,
          platformClaimFeeWallet,
          authProgramId,
          poolId,
          platformId,
          vaultB!,
          userTokenAccountB!,
          mintB,
          mintBProgram,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData>;
  }

  public async claimAllPlatformFee<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    platformId,
    platformClaimFeeWallet,

    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: ClaimAllPlatformFee<T>): Promise<MakeMultiTxData<T>> {
    const txBuilder = this.createTxBuilder(feePayer);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

    const allPlatformPool = await this.scope.connection.getProgramAccounts(programId, {
      filters: [
        { dataSize: LaunchpadPool.span },
        { memcmp: { offset: LaunchpadPool.offsetOf("platformId"), bytes: platformId.toString() } },
      ],
    });

    allPlatformPool.forEach((data) => {
      const pool = LaunchpadPool.decode(data.account.data);
      if (pool.platformFee.lte(new BN(0))) return;

      const userTokenAccountB = getATAAddress(this.scope.ownerPubKey, pool.mintB, TOKEN_PROGRAM_ID).publicKey;
      txBuilder.addInstruction({
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            this.scope.ownerPubKey,
            userTokenAccountB,
            this.scope.ownerPubKey,
            pool.mintB,
          ),
        ],
      });

      txBuilder.addInstruction({
        instructions: [
          claimPlatformFee(
            programId,
            platformClaimFeeWallet,
            authProgramId!,
            data.pubkey,
            platformId,
            pool.vaultB,
            userTokenAccountB!,
            pool.mintB,
            TOKEN_PROGRAM_ID,
          ),
        ],
      });
    });

    txBuilder.addTipInstruction(txTipConfig);

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;

    return txBuilder.sizeCheckBuild({
      computeBudgetConfig,
    }) as Promise<MakeMultiTxData<T>>;
  }

  public async createVesting<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    poolId,
    beneficiary,
    shareAmount,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: CreateVesting<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);

    const poolInfo = await this.getRpcPoolInfo({ poolId });
    if (shareAmount.add(poolInfo.vestingSchedule.totalAllocatedShare).gt(poolInfo.vestingSchedule.totalLockedAmount))
      this.logAndCreateError("share amount exceed total locked amount");

    const vestingRecord = getPdaVestId(programId, poolId, beneficiary).publicKey;
    txBuilder.addInstruction({
      instructions: [
        createVestingAccount(programId, this.scope.ownerPubKey, beneficiary, poolId, vestingRecord, shareAmount),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData>;
  }

  public async createMultipleVesting<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    poolId,
    beneficiaryList,
    txVersion,
    computeBudgetConfig,
    feePayer,
  }: CreateMultipleVesting<T>): Promise<MakeMultiTxData<T>> {
    const txBuilder = this.createTxBuilder(feePayer);
    if (beneficiaryList.length === 0) this.logAndCreateError("beneficiaryList is null");

    const poolInfo = await this.getRpcPoolInfo({ poolId });
    const allShareAmount = beneficiaryList.reduce(
      (acc, cur) => acc.add(cur.shareAmount),
      poolInfo.vestingSchedule.totalAllocatedShare,
    );

    if (allShareAmount.gt(poolInfo.vestingSchedule.totalLockedAmount))
      this.logAndCreateError("share amount exceed total locked amount");

    beneficiaryList.forEach((beneficiary) => {
      const vestingRecord = getPdaVestId(programId, poolId, beneficiary.wallet).publicKey;
      txBuilder.addInstruction({
        instructions: [
          createVestingAccount(
            programId,
            this.scope.ownerPubKey,
            beneficiary.wallet,
            poolId,
            vestingRecord,
            beneficiary.shareAmount,
          ),
        ],
      });
    });

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
  }

  public async claimVesting<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    poolId,
    poolInfo: propsPoolInfo,
    vestingRecord: propsVestingRecord,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: ClaimVesting<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);

    const authProgramId = getPdaLaunchpadAuth(programId).publicKey;
    const vestingRecord = propsVestingRecord || getPdaVestId(programId, poolId, this.scope.ownerPubKey).publicKey;

    let poolInfo = propsPoolInfo;
    if (!poolInfo) {
      const r = await this.scope.connection.getAccountInfo(poolId);
      if (!r) this.logAndCreateError("pool not found");
      poolInfo = LaunchpadPool.decode(r!.data);
    }

    const userTokenAccountA = getATAAddress(this.scope.ownerPubKey, poolInfo.mintA, TOKEN_PROGRAM_ID).publicKey;
    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          userTokenAccountA,
          this.scope.ownerPubKey,
          poolInfo.mintA,
        ),
      ],
    });

    txBuilder.addInstruction({
      instructions: [
        claimVestedToken(
          programId,
          this.scope.ownerPubKey,
          authProgramId,
          poolId,
          vestingRecord,
          userTokenAccountA!,
          poolInfo.vaultA,
          poolInfo.mintA,
          TOKEN_PROGRAM_ID,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData>;
  }

  public async claimMultiVesting<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    poolIdList,
    poolsInfo: propsPoolsInfo = {},
    vestingRecords = {},
    txVersion,
    computeBudgetConfig,
    feePayer,
  }: ClaimMultiVesting<T>): Promise<MakeMultiTxData<T>> {
    const txBuilder = this.createTxBuilder(feePayer);

    let poolsInfo = { ...propsPoolsInfo };
    const authProgramId = getPdaLaunchpadAuth(programId).publicKey;
    const needFetchPools = poolIdList.filter((id) => !poolsInfo[id.toBase58()]);
    if (needFetchPools.length) {
      const fetchedPools = await this.getRpcPoolsInfo({ poolIdList: needFetchPools });
      poolsInfo = {
        ...poolsInfo,
        ...fetchedPools.poolInfoMap,
      };
    }

    poolIdList.forEach((poolId) => {
      const poolIdStr = poolId.toBase58();
      const poolInfo = poolsInfo[poolIdStr];
      if (!poolInfo) this.logAndCreateError(`pool info not found: ${poolIdStr}`);
      const vestingRecord =
        vestingRecords[poolIdStr] || getPdaVestId(programId, poolId, this.scope.ownerPubKey).publicKey;
      const userTokenAccountA = getATAAddress(this.scope.ownerPubKey, poolInfo.mintA, TOKEN_PROGRAM_ID).publicKey;
      txBuilder.addInstruction({
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(
            this.scope.ownerPubKey,
            userTokenAccountA,
            this.scope.ownerPubKey,
            poolInfo.mintA,
          ),
        ],
      });

      txBuilder.addInstruction({
        instructions: [
          claimVestedToken(
            programId,
            this.scope.ownerPubKey,
            authProgramId,
            poolId,
            vestingRecord,
            userTokenAccountA!,
            poolInfo.vaultA,
            poolInfo.mintA,
            TOKEN_PROGRAM_ID,
          ),
        ],
      });
    });

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
  }

  public async claimVaultPlatformFee<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    platformId,
    mintB,
    mintBProgram = TOKEN_PROGRAM_ID,
    claimFeeWallet,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: ClaimVaultPlatformFee<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);

    const platformFeeVault = getPdaPlatformVault(programId, platformId, mintB).publicKey;
    const platformFeeAuth = getPdaPlatformFeeVaultAuth(programId).publicKey;

    const userTokenAccount = this.scope.account.getAssociatedTokenAccount(mintB, mintBProgram);

    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          userTokenAccount,
          this.scope.ownerPubKey,
          mintB,
          mintBProgram,
        ),
        claimPlatformFeeFromVault(
          programId,
          platformId,
          claimFeeWallet ?? this.scope.ownerPubKey,
          platformFeeAuth,
          platformFeeVault,
          userTokenAccount,
          mintB,
          mintBProgram,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData>;
  }

  public async claimMultipleVaultPlatformFee<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    platformList,
    unwrapSol = true,
    txVersion,
    computeBudgetConfig,
    feePayer,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: ClaimMultipleVaultPlatformFee<T>): Promise<MakeMultiTxData<T>> {
    const txBuilder = this.createTxBuilder(feePayer);

    // const platformFeeVault = getPdaPlatformVault(programId, platformId, mintB).publicKey;

    const tokenAccountRecord: Record<string, PublicKey> = {};

    platformList.forEach(async (platform) => {
      const platformFeeAuth = getPdaPlatformFeeVaultAuth(programId).publicKey;
      const platformFeeVault = getPdaPlatformVault(programId, platform.id, platform.mintB).publicKey;
      const useSolBalance = platform.mintB.equals(NATIVE_MINT) && unwrapSol;
      let userTokenAccount: PublicKey | undefined = tokenAccountRecord[platform.mintB.toBase58()];

      if (!userTokenAccount) {
        const { account: _userTokenAccount, instructionParams: _tokenAccountInstruction } =
          await this.scope.account.getOrCreateTokenAccount({
            mint: platform.mintB,
            owner: this.scope.ownerPubKey,
            createInfo: useSolBalance
              ? {
                  payer: this.scope.ownerPubKey!,
                  amount: 0,
                }
              : undefined,
            skipCloseAccount: !useSolBalance,
            notUseTokenAccount: useSolBalance,
            associatedOnly: useSolBalance ? false : associatedOnly,
            checkCreateATAOwner,
          });
        if (_userTokenAccount) userTokenAccount = _userTokenAccount;
        txBuilder.addInstruction(_tokenAccountInstruction || {});
        if (userTokenAccount === undefined)
          this.logAndCreateError(
            `cannot found platform ${platform.id.toBase58()} mintB(${platform.mintB.toBase58()}) token accounts`,
            "tokenAccounts",
            this.scope.account.tokenAccounts,
          );
      }

      txBuilder.addInstruction({
        instructions: [
          claimPlatformFeeFromVault(
            programId,
            platform.id,
            platform.claimFeeWallet ?? this.scope.ownerPubKey,
            platformFeeVault,
            platformFeeAuth,
            userTokenAccount!,
            platform.mintB,
            platform.mintBProgram ?? TOKEN_PROGRAM_ID,
          ),
        ],
      });
    });

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig }) as Promise<MakeMultiTxData<T>>;
  }

  public async claimCreatorFee<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    mintB,
    mintBProgram = TOKEN_PROGRAM_ID,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
  }: ClaimCreatorFee<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);

    const creatorFeeVault = getPdaCreatorVault(programId, this.scope.ownerPubKey, mintB).publicKey;
    const creatorFeeVaultAuth = getPdaCreatorFeeVaultAuth(programId).publicKey;
    const userTokenAccount = this.scope.account.getAssociatedTokenAccount(mintB, mintBProgram);

    txBuilder.addInstruction({
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(
          this.scope.ownerPubKey,
          userTokenAccount,
          this.scope.ownerPubKey,
          mintB,
          mintBProgram,
        ),
        claimCreatorFee(
          programId,
          this.scope.ownerPubKey,
          creatorFeeVaultAuth,
          creatorFeeVault,
          userTokenAccount!,
          mintB,
          mintBProgram,
        ),
      ],
    });

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild({
      txVersion,
    }) as Promise<MakeTxData>;
  }

  public async getRpcPoolInfo({
    poolId,
  }: {
    poolId: PublicKey;
  }): Promise<LaunchpadPoolInfo & { configInfo: LaunchpadConfigInfo }> {
    const data = await this.getRpcPoolsInfo({ poolIdList: [poolId] });

    return data.poolInfoMap[poolId.toBase58()];
  }

  public async getRpcPoolsInfo({
    poolIdList,
    config,
  }: {
    poolIdList: PublicKey[];
    config?: { batchRequest?: boolean; chunkCount?: number };
  }): Promise<{
    poolInfoMap: Record<
      string,
      LaunchpadPoolInfo & {
        poolId: PublicKey;
        configInfo: LaunchpadConfigInfo;
      }
    >;
  }> {
    const accounts = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      poolIdList.map((i) => ({ pubkey: i })),
      config,
    );

    const poolInfoMap: { [poolId: string]: LaunchpadPoolInfo & { poolId: PublicKey } } = {};
    const configKeys: PublicKey[] = [];

    for (let i = 0; i < poolIdList.length; i++) {
      const item = accounts[i];
      if (item === null || !item.accountInfo) throw Error("fetch pool info error: " + poolIdList[i].toBase58());
      const poolInfo = LaunchpadPool.decode(item.accountInfo.data);
      poolInfoMap[poolIdList[i].toBase58()] = {
        ...poolInfo,
        poolId: item.accountInfo.owner,
      };
      configKeys.push(poolInfo.configId);
    }

    const configAccounts = await getMultipleAccountsInfoWithCustomFlags(
      this.scope.connection,
      configKeys.map((i) => ({ pubkey: i })),
      config,
    );

    const configInfoMap: { [poolId: string]: LaunchpadConfigInfo & { configId: PublicKey } } = {};

    for (let i = 0; i < configKeys.length; i++) {
      const item = configAccounts[i];
      if (item === null || !item.accountInfo) throw Error("fetch config info error: " + configKeys[i].toBase58());
      const configInfo = LaunchpadConfig.decode(item.accountInfo.data);
      configInfoMap[configKeys[i].toBase58()] = {
        ...configInfo,
        configId: item.accountInfo.owner,
      };
    }

    return {
      poolInfoMap: Object.keys(poolInfoMap).reduce(
        (acc, cur) => ({
          ...acc,
          [cur]: {
            ...poolInfoMap[cur],
            configInfo: configInfoMap[poolInfoMap[cur].configId.toBase58()],
          },
        }),
        {},
      ),
    };
  }
}
