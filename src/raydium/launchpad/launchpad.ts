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
  ClaimAllPlatformFee,
  ClaimPlatformFee,
  ClaimVesting,
  CreateLaunchPad,
  CreatePlatform,
  CreateVesting,
  LaunchpadConfigInfo,
  LaunchpadPoolInfo,
  SellToken,
  UpdatePlatform,
} from "./type";
import {
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformId,
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
} from "./instrument";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { getPdaMetadataKey } from "../clmm";
import { LaunchpadConfig, LaunchpadPool, PlatformConfig } from "./layout";
import { Curve } from "./curve/curve";
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
    ...extraConfigs
  }: CreateLaunchPad<T>): Promise<
    MakeMultiTxData<T, { address: LaunchpadPoolInfo & { poolId: PublicKey }; outAmount: BN }>
  > {
    const txBuilder = this.createTxBuilder(feePayer);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

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

    console.log(
      `create token: ${mintA.toBase58()}, mintB: ${mintB.toBase58()}, decimals A:${decimals}/B:${mintBDecimals}, config:${configId.toBase58()}`,
    );

    if (symbol.length > 10) this.logAndCreateError("Symbol length should shorter than 11");
    if (!uri) this.logAndCreateError("uri should not empty");
    if (buyAmount.lte(new BN(0))) this.logAndCreateError("buy amount should gt 0:", buyAmount.toString());

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
      console.log("check init params success");
    } catch (e: any) {
      this.logAndCreateError(`check create mint params failed, ${e.message}`);
    }

    txBuilder.addInstruction({
      instructions: [
        initialize(
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
          TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,

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

    let outAmount = new BN(0);
    let splitIns;
    if (extraSigners?.length) txBuilder.addInstruction({ signers: extraSigners });
    if (!extraConfigs.createOnly) {
      const { builder, extInfo } = await this.buyToken({
        programId,
        authProgramId,
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
      });
      txBuilder.addInstruction({ ...builder.AllTxData });
      outAmount = extInfo.outAmount;
      splitIns =
        (this.scope.cluster === "devnet" || txVersion === TxVersion.LEGACY) && extraConfigs.shareFeeReceiver
          ? [builder.allInstructions[0]]
          : undefined;
    }

    txBuilder.addTipInstruction(txTipConfig);

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({
        computeBudgetConfig,
        outAmount,
        splitIns,
        address: {
          ...poolInfo,
          poolId,
        },
      }) as Promise<MakeMultiTxData<T, { address: LaunchpadPoolInfo & { poolId: PublicKey }; outAmount: BN }>>;
    return txBuilder.sizeCheckBuild({
      computeBudgetConfig,
      outAmount,
      splitIns,
      address: {
        ...poolInfo,
        poolId,
      },
    }) as Promise<MakeMultiTxData<T, { address: LaunchpadPoolInfo & { poolId: PublicKey }; outAmount: BN }>>;
  }

  public async buyToken<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintA,
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
  }: BuyToken<T>): Promise<MakeTxData<T, { outAmount: BN }>> {
    if (buyAmount.lte(new BN(0))) this.logAndCreateError("buy amount should gt 0:", buyAmount.toString());
    const txBuilder = this.createTxBuilder(feePayer);
    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;

    let userTokenAccountA: PublicKey | null = null;
    let userTokenAccountB: PublicKey | null = null;

    const mintBUseSOLBalance = mintB.equals(NATIVE_MINT);

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: mintA,
        owner: this.scope.ownerPubKey,

        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: true,
        notUseTokenAccount: false,
        associatedOnly,
        checkCreateATAOwner,
      });
    if (_ownerTokenAccountA) userTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    if (userTokenAccountA === undefined)
      this.logAndCreateError(
        `cannot found mintA(${mintA.toBase58()}) token accounts`,
        "tokenAccounts",
        this.scope.account.tokenAccounts,
      );

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
      [configInfo ? undefined : poolInfo.configId, platformFeeRate ? undefined : poolInfo.platformId]
        .filter(Boolean)
        .map((key) => ({ pubkey: key! })),
    );
    if (!configInfo) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.configId));
      if (!data || !data.accountInfo) this.logAndCreateError("config not found: ", poolInfo.configId.toBase58());
      configInfo = LaunchpadConfig.decode(data!.accountInfo!.data);
    }
    if (!platformFeeRate) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.platformId));
      if (!data || !data.accountInfo) this.logAndCreateError("platform info not found: ", poolInfo.configId.toBase58());
      platformFeeRate = PlatformConfig.decode(data!.accountInfo!.data).feeRate;
    }

    const calculatedAmount = Curve.buyExactIn({
      poolInfo,
      amountB: buyAmount,
      protocolFeeRate: configInfo.tradeFeeRate,
      platformFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
    });

    const decimalAmountA = new Decimal(calculatedAmount.amountA.toString());
    const multiplier = slippage
      ? new Decimal(SLIPPAGE_UNIT.sub(slippage).toNumber() / SLIPPAGE_UNIT.toNumber()).clampedTo(0, 1)
      : new Decimal(1);

    const minMintAAmount =
      propMinMintAAmount ?? (slippage ? new BN(decimalAmountA.mul(multiplier).toFixed(0)) : calculatedAmount.amountA);

    if (calculatedAmount.amountB.lt(buyAmount)) {
      console.log(
        `maximum ${mintA.toBase58()} amount can buy is ${calculatedAmount.amountA.toString()}, input ${mintB.toBase58()} amount: ${calculatedAmount.amountB.toString()}`,
      );
    }

    // let shareATA: PublicKey | undefined;
    // if (shareFeeReceiver) {
    // if (mintB.equals(NATIVE_MINT)) {
    //   const { addresses, ...txInstruction } = await createWSolAccountInstructions({
    //     connection: this.scope.connection,
    //     owner: shareFeeReceiver,
    //     payer: this.scope.ownerPubKey,
    //     amount: 0,
    //     skipCloseAccount: true,
    //   });
    //   txBuilder.addInstruction(txInstruction);
    //   shareATA = addresses.newAccount;
    // } else {
    //   shareATA = getATAAddress(shareFeeReceiver, mintB, TOKEN_PROGRAM_ID).publicKey;
    //   txBuilder.addInstruction({
    //     instructions: [
    //       createAssociatedTokenAccountIdempotentInstruction(this.scope.ownerPubKey, shareATA, shareFeeReceiver!, mintB),
    //     ],
    //   });
    //   // }
    // }
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
          TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          calculatedAmount.amountB.lt(buyAmount) ? calculatedAmount.amountB : buyAmount,
          minMintAAmount,
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
        outAmount: minMintAAmount,
      },
    }) as Promise<MakeTxData<T, { outAmount: BN }>>;
  }

  public async sellToken<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
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
  }: SellToken<T>): Promise<MakeTxData<T, { outAmount: BN }>> {
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;
    const txBuilder = this.createTxBuilder(feePayer);

    if (sellAmount.lte(new BN(0))) this.logAndCreateError("sell amount should be gt 0");

    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);

    let userTokenAccountA: PublicKey | null = null;
    let userTokenAccountB: PublicKey | null = null;

    const mintBUseSOLBalance = mintB.equals(NATIVE_MINT);

    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
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
      [configInfo ? undefined : poolInfo.configId, platformFeeRate ? undefined : poolInfo.platformId]
        .filter(Boolean)
        .map((key) => ({ pubkey: key! })),
    );
    if (!configInfo) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.configId));
      if (!data || !data.accountInfo) this.logAndCreateError("config not found: ", poolInfo.configId.toBase58());
      configInfo = LaunchpadConfig.decode(data!.accountInfo!.data);
    }
    if (!platformFeeRate) {
      const data = allData.find((d) => d.pubkey.equals(poolInfo!.platformId));
      if (!data || !data.accountInfo) this.logAndCreateError("platform info not found: ", poolInfo.configId.toBase58());
      platformFeeRate = PlatformConfig.decode(data!.accountInfo!.data).feeRate;
    }

    const calculatedAmount = Curve.sellExactIn({
      poolInfo,
      amountA: sellAmount,
      protocolFeeRate: configInfo.tradeFeeRate,
      platformFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
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
          TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          calculatedAmount.amountA.lt(sellAmount) ? calculatedAmount.amountA : sellAmount,
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

  public async createPlatformConfig<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    platformAdmin,
    platformClaimFeeWallet,
    platformLockNftWallet,
    cpConfigId,
    migrateCpLockNftScale,
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
          migrateCpLockNftScale,
          feeRate,
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

  public async claimVesting<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    poolId,
    poolInfo: propsPoolInfo,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    associatedOnly = true,
    checkCreateATAOwner = false,
  }: ClaimVesting<T>): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);

    const authProgramId = getPdaLaunchpadAuth(programId).publicKey;
    const vestingRecord = getPdaVestId(programId, poolId, this.scope.ownerPubKey).publicKey;

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
