import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { TxVersion, MakeTxData, LAUNCHPAD_PROGRAM } from "@/common";
import { BuyToken, CreateLunchPad, LaunchpadPoolInfo, SellToken } from "./type";
import { getPdaLaunchpadAuth, getPdaLaunchpadConfigId, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId } from "./pad";
import { initialize, buyInstruction, sellInstruction } from "./instrument";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { getPdaMetadataKey } from "../clmm";
import { LaunchpadConfig, LaunchpadPool } from "./layout";
import { Curve } from "./curve/curve";

export const LaunchpadPoolInitParam = {
  initPriceX64: new BN("515752397214619"),
  supply: new BN("1000000000000000"),
  totalSellA: new BN("793100000000000"),
  totalFundRaisingB: new BN("85005359983"),
  totalLockedAmount: new BN("0"),
  cliffPeriod: new BN("0"),
  unlockPeriod: new BN("0"),
  decimals: 6,
  virtualA: new BN("1073374096056445"),
  virtualB: new BN("30010459349"),
  realA: new BN(0),
  realB: new BN(0),
  tradeFee: new BN("10000"),
  migrateFee: new BN("100000000"),
};

const SLIPPAGE_UNIT = new BN(10000);
export default class LaunchpadModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async createLaunchpad<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintA,
    mintB = NATIVE_MINT,
    mintBDecimals = 9,
    decimals = 6,
    name,
    symbol,
    uri,
    migrateType,
    txVersion,
    computeBudgetConfig,
    txTipConfig,
    feePayer,
    buyAmount,
    minMintAAmount,
    slippage,
    associatedOnly = true,
    checkCreateATAOwner = false,

    ...extraConfigs
  }: CreateLunchPad<T>): Promise<MakeTxData<T, { address: LaunchpadPoolInfo; outAmount: BN }>> {
    const txBuilder = this.createTxBuilder(feePayer);

    if (buyAmount.lte(new BN(0))) this.logAndCreateError("buy amount should gt 0:", buyAmount.toString());
    authProgramId = authProgramId ?? getPdaLaunchpadAuth(programId).publicKey;
    const { publicKey: configId } = getPdaLaunchpadConfigId(programId, mintB, 0, 0); // index mock
    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);
    const { publicKey: vaultA } = getPdaLaunchpadVaultId(programId, poolId, mintA);
    const { publicKey: vaultB } = getPdaLaunchpadVaultId(programId, poolId, mintB);
    const { publicKey: metaId } = getPdaMetadataKey(mintA);

    if (symbol.length > 10) this.logAndCreateError("Symbol length should shorter than 11");
    if (!uri) this.logAndCreateError("uri should not empty");

    const initialPriceX64 = LaunchpadPoolInitParam.initPriceX64;
    const supply = extraConfigs?.supply ?? LaunchpadPoolInitParam.supply;
    const totalSellA = extraConfigs?.totalSellA ?? LaunchpadPoolInitParam.totalSellA;
    const totalFundRaisingB = extraConfigs?.totalFundRaisingB ?? LaunchpadPoolInitParam.totalFundRaisingB;

    const poolInfo: LaunchpadPoolInfo = {
      bump: 255,
      status: 0,
      decimals,
      supply,
      totalSellA,
      mintA: new PublicKey(mintA),
      virtualA: LaunchpadPoolInitParam.virtualA,
      virtualB: LaunchpadPoolInitParam.virtualB,
      realA: LaunchpadPoolInitParam.realA,
      realB: LaunchpadPoolInitParam.realB,
      tradeFee: LaunchpadPoolInitParam.tradeFee,
      migrateFee: LaunchpadPoolInitParam.migrateFee,
      migrateType: 0,
      configId,
      vaultA,
      vaultB,
      creator: this.scope.ownerPubKey,
      totalFundRaisingB,
      vestingSchedule: {
        totalLockedAmount: new BN(0),
        cliffPeriod: new BN(0),
        unlockPeriod: new BN(0),
        startTime: new BN(0),
        totalAllocatedShare: new BN(0),
      },
    };

    txBuilder.addInstruction({
      instructions: [
        initialize(
          programId,
          feePayer ?? this.scope.ownerPubKey,
          this.scope.ownerPubKey,
          configId,
          authProgramId,
          poolId,
          mintA,
          mintB,
          vaultA,
          vaultB,
          metaId,
          TOKEN_PROGRAM_ID, // tokenProgramA
          TOKEN_PROGRAM_ID, // tokenProgramB

          decimals,
          name,
          symbol,
          uri || "https://",

          migrateType,

          initialPriceX64,
          supply,
          totalSellA,
          totalFundRaisingB,
          extraConfigs?.totalLockedAmount ?? new BN(0),
          extraConfigs?.cliffPeriod ?? new BN(0),
          extraConfigs?.unlockPeriod ?? new BN(0),
        ),
      ],
    });

    let outAmount = new BN(0);
    if (!extraConfigs.createOnly) {
      const { builder, extInfo } = await this.buyToken({
        programId,
        authProgramId,
        mintA,
        mintB,
        poolInfo,
        buyAmount,
        minMintAAmount,
        slippage,
        associatedOnly,
        checkCreateATAOwner,
      });
      txBuilder.addInstruction({ ...builder.AllTxData });
      outAmount = extInfo.outAmount;
    }

    txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addTipInstruction(txTipConfig);

    return txBuilder.versionBuild<{
      address: LaunchpadPoolInfo;
      outAmount: BN;
    }>({
      txVersion,
      extInfo: {
        address: poolInfo,
        outAmount,
      },
    }) as Promise<MakeTxData<T, { address: LaunchpadPoolInfo; outAmount: BN }>>;
  }

  public async buyToken<T extends TxVersion>({
    programId = LAUNCHPAD_PROGRAM,
    authProgramId,
    mintA,
    mintB = NATIVE_MINT,
    poolInfo: propPoolInfo,
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
      this.logAndCreateError("cannot found mintA token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

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
      this.logAndCreateError("cannot found mintB token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    let poolInfo = propPoolInfo;
    if (!poolInfo) {
      const poolData = await this.scope.connection.getAccountInfo(poolId, { commitment: "confirmed" });
      if (!poolData) this.logAndCreateError("cannot found pool", poolId.toBase58());
      poolInfo = LaunchpadPool.decode(poolData!.data);
    }

    const configData = await this.scope.connection.getAccountInfo(poolInfo.configId);
    const configInfo = LaunchpadConfig.decode(configData!.data);

    const calculatedAmount = Curve.buy({
      poolInfo,
      amountB: buyAmount,
      tradeFeeRate: configInfo.tradeFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
    });

    const minMintAAmount =
      propMinMintAAmount ??
      (slippage
        ? calculatedAmount.amountA.mul(SLIPPAGE_UNIT.sub(slippage)).div(SLIPPAGE_UNIT)
        : calculatedAmount.amountA);

    console.log({
      amountA: calculatedAmount.amountA.toString(),
      minAmountA: minMintAAmount.toString(),
    });

    txBuilder.addInstruction({
      instructions: [
        buyInstruction(
          programId,
          this.scope.ownerPubKey,
          authProgramId,
          poolInfo.configId,
          poolId,
          userTokenAccountA!,
          userTokenAccountB!,
          poolInfo.vaultA,
          poolInfo.vaultB,
          mintA,
          mintB,
          TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          calculatedAmount.realAmountB.lt(buyAmount) ? calculatedAmount.realAmountB : buyAmount,
          minMintAAmount,
          shareFeeRate,
          shareFeeReceiver,
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

    const { publicKey: configId } = getPdaLaunchpadConfigId(programId, mintB, 0, 0); // index mock
    const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mintA, mintB);
    const { publicKey: vaultA } = getPdaLaunchpadVaultId(programId, poolId, mintA);
    const { publicKey: vaultB } = getPdaLaunchpadVaultId(programId, poolId, mintB);

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
      const poolData = await this.scope.connection.getAccountInfo(poolId);
      if (!poolData) this.logAndCreateError("cannot found pool", poolId.toBase58());
      poolInfo = LaunchpadPool.decode(poolData!.data);
    }

    const configData = await this.scope.connection.getAccountInfo(poolInfo.configId);
    const configInfo = LaunchpadConfig.decode(configData!.data);

    const calculatedAmount = Curve.sell({
      poolInfo,
      amountA: sellAmount,
      tradeFeeRate: configInfo.tradeFeeRate,
      curveType: configInfo.curveType,
      shareFeeRate,
    });
    const minAmountB =
      propMinAmountB ??
      (slippage
        ? calculatedAmount.amountB.mul(SLIPPAGE_UNIT.sub(slippage)).div(SLIPPAGE_UNIT)
        : calculatedAmount.amountB);

    if (minAmountB.lte(new BN(0))) this.logAndCreateError("out amount should be gt 0");

    txBuilder.addInstruction({
      instructions: [
        sellInstruction(
          programId,
          this.scope.ownerPubKey,
          authProgramId,
          configId,
          poolId,
          userTokenAccountA!, //userTokenAccountA: PublicKey,
          userTokenAccountB!, //userTokenAccountB: PublicKey,
          vaultA,
          vaultB,
          mintA,
          mintB,
          TOKEN_PROGRAM_ID, //tokenProgramA
          TOKEN_PROGRAM_ID, //tokenProgramB
          calculatedAmount.realAmountA.lt(sellAmount) ? calculatedAmount.realAmountA : sellAmount, // amountA: BN,
          minAmountB, // minAmountB: BN,
          shareFeeRate,
          shareFeeReceiver,
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
}
