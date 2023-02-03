import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import ModuleBase from "../moduleBase";
import { TxBuildData } from "../../common/txTool";
import { BN_ZERO } from "../../common/bignumber";
import { makeCreateMarketInstruction } from "./instrument";
import { MakeMultiTransaction } from "../type";

interface ExtInfo {
  extInfo: {
    address: { id: PublicKey };
  };
}

export default class MarketV2 extends ModuleBase {
  public async makeCreateMarketTransaction({
    baseInfo,
    quoteInfo,
    lotSize, // 1
    tickSize, // 0.01
    dexProgramId,
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
  }): Promise<MakeMultiTransaction & ExtInfo> {
    const market = Keypair.generate();
    const requestQueue = Keypair.generate();
    const eventQueue = Keypair.generate();
    const bids = Keypair.generate();
    const asks = Keypair.generate();
    const baseVault = Keypair.generate();
    const quoteVault = Keypair.generate();
    const feeRateBps = 0;
    const quoteDustThreshold = new BN(100);

    function getVaultOwnerAndNonce(): { vaultOwner: PublicKey; vaultSignerNonce: BN } {
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
      },
    });

    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction({
      instructions: allTxArr[0].transaction.instructions,
      signers: allTxArr[0].signer,
    });

    const extraTxBuildData: TxBuildData[] = [];

    for (let i = 1; i < allTxArr.length; i++) {
      const extraTxBuilder = this.createTxBuilder();
      extraTxBuilder.addInstruction({
        instructions: allTxArr[i].transaction.instructions,
        signers: allTxArr[i].signer,
      });
      extraTxBuildData.push(extraTxBuilder.build());
    }

    return txBuilder.buildMultiTx({
      extraPreBuildData: extraTxBuildData,
      extInfo: {
        address: {
          id: market.publicKey,
        },
      },
    }) as MakeMultiTransaction & ExtInfo;
  }
}
