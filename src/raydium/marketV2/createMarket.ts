import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import ModuleBase from "../moduleBase";
import { TxVersion } from "@/common/txTool/txType";
import { MakeMultiTxData } from "@/common/txTool/txTool";
import { generatePubKey } from "../account/util";
import { BN_ZERO } from "@/common/bignumber";
import { makeCreateMarketInstruction } from "./instrument";
import { ComputeBudgetConfig } from "@/raydium/type";

interface ExtInfo {
  address: {
    marketId: PublicKey;
    requestQueue: PublicKey;
    eventQueue: PublicKey;
    bids: PublicKey;
    asks: PublicKey;
    baseVault: PublicKey;
    quoteVault: PublicKey;
    baseMint: PublicKey;
    quoteMin: PublicKey;
  };
}

export default class MarketV2 extends ModuleBase {
  public async create<T extends TxVersion>({
    baseInfo,
    quoteInfo,
    lotSize, // 1
    tickSize, // 0.01
    dexProgramId,
    requestQueueSpace,
    eventQueueSpace,
    orderbookQueueSpace,
    txVersion,
    computeBudgetConfig,
  }: {
    baseInfo: {
      mint: PublicKey;
      decimals: number;
    };
    quoteInfo: {
      mint: PublicKey;
      decimals: number;
    };
    lotSize: number;
    tickSize: number;
    dexProgramId: PublicKey;
    eventQueue?: PublicKey;
    requestQueue?: PublicKey;
    requestQueueSpace?: number;
    eventQueueSpace?: number;
    orderbookQueueSpace?: number;
    txVersion?: T;
    computeBudgetConfig?: ComputeBudgetConfig;
  }): Promise<MakeMultiTxData<T, ExtInfo>> {
    const wallet = this.scope.ownerPubKey;
    const market = generatePubKey({ fromPublicKey: wallet, programId: dexProgramId });
    const requestQueue = generatePubKey({ fromPublicKey: wallet, programId: dexProgramId });
    const eventQueue = generatePubKey({ fromPublicKey: wallet, programId: dexProgramId });
    const bids = generatePubKey({ fromPublicKey: wallet, programId: dexProgramId });
    const asks = generatePubKey({ fromPublicKey: wallet, programId: dexProgramId });
    const baseVault = generatePubKey({ fromPublicKey: wallet, programId: TOKEN_PROGRAM_ID });
    const quoteVault = generatePubKey({ fromPublicKey: wallet, programId: TOKEN_PROGRAM_ID });
    const feeRateBps = 0;
    const quoteDustThreshold = new BN(100);
    function getVaultOwnerAndNonce() {
      const vaultSignerNonce = new BN(0);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const vaultOwner = PublicKey.createProgramAddressSync(
            [market.publicKey.toBuffer(), vaultSignerNonce.toArrayLike(Buffer, "le", 8)],
            dexProgramId,
          );
          return { vaultOwner, vaultSignerNonce };
        } catch (e) {
          vaultSignerNonce.iaddn(1);
          if (vaultSignerNonce.gt(new BN(25555))) throw Error("find vault owner error");
        }
      }
    }
    const { vaultOwner, vaultSignerNonce } = getVaultOwnerAndNonce();
    const baseLotSize = new BN(Math.round(10 ** baseInfo.decimals * lotSize));
    const quoteLotSize = new BN(Math.round(lotSize * 10 ** quoteInfo.decimals * tickSize));

    if (baseLotSize.eq(BN_ZERO)) throw Error("lot size is too small");
    if (quoteLotSize.eq(BN_ZERO)) throw Error("tick size or lot size is too small");
    const allTxArr = await makeCreateMarketInstruction({
      connection: this.scope.connection,
      wallet: this.scope.ownerPubKey,
      marketInfo: {
        programId: dexProgramId,
        id: market,
        baseMint: baseInfo.mint,
        quoteMint: quoteInfo.mint,
        baseVault,
        quoteVault,
        vaultOwner,
        requestQueue,
        eventQueue,
        bids,
        asks,

        feeRateBps,
        quoteDustThreshold,
        vaultSignerNonce,
        baseLotSize,
        quoteLotSize,

        requestQueueSpace,
        eventQueueSpace,
        orderbookQueueSpace,
      },
    });
    const txBuilder = this.createTxBuilder();
    // txBuilder.addCustomComputeBudget(computeBudgetConfig);
    txBuilder.addInstruction({
      instructions: allTxArr[0].transaction.instructions,
      signers: allTxArr[0].signer,
    });

    // const extraTxBuildData: any[] = [];

    for await (const txData of allTxArr.slice(1, allTxArr.length)) {
      // const extraTxBuilder = this.createTxBuilder();
      // extraTxBuilder.addCustomComputeBudget(computeBudgetConfig);
      txBuilder.addInstruction({
        instructions: txData.transaction.instructions,
        signers: txData.signer,
        instructionTypes: txData.instructionTypes,
      });

      // const build = await extraTxBuilder.versionBuild({ txVersion });
      // extraTxBuildData.push(build);
    }

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({
        computeBudgetConfig,
        address: {
          marketId: market.publicKey,
          requestQueue: requestQueue.publicKey,
          eventQueue: eventQueue.publicKey,
          bids: bids.publicKey,
          asks: asks.publicKey,
          baseVault: baseVault.publicKey,
          quoteVault: quoteVault.publicKey,
          baseMint: new PublicKey(baseInfo.mint),
          quoteMin: new PublicKey(quoteInfo.mint),
        },
      }) as Promise<MakeMultiTxData<T, ExtInfo>>;

    return txBuilder.sizeCheckBuild({
      computeBudgetConfig,
      address: {
        marketId: market.publicKey,
        requestQueue: requestQueue.publicKey,
        eventQueue: eventQueue.publicKey,
        bids: bids.publicKey,
        asks: asks.publicKey,
        baseVault: baseVault.publicKey,
        quoteVault: quoteVault.publicKey,
        baseMint: new PublicKey(baseInfo.mint),
        quoteMin: new PublicKey(quoteInfo.mint),
      },
    }) as Promise<MakeMultiTxData<T, ExtInfo>>;
  }
}
