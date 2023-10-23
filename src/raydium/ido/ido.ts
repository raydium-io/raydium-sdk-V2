import ModuleBase from "../moduleBase";
import { TxBuildData } from "../../common/txTool/txTool";
import { generatePubKey } from "../account/util";
import { BN_ZERO } from "../../common/bignumber";
import { makeClaimInstruction } from "./instruction";
import { MakeMultiTransaction } from "../type";

export default class MarketV2 extends ModuleBase {
  public async claim(): Promise<MakeMultiTransaction> {
    const txBuilder = this.createTxBuilder();
    // txBuilder.addInstruction({
    //   instructions: allTxArr[0].transaction.instructions,
    //   signers: allTxArr[0].signer,
    // });

    const extraTxBuildData: TxBuildData[] = [];

    return txBuilder.buildMultiTx({
      extraPreBuildData: extraTxBuildData,
      extInfo: {},
    }) as MakeMultiTransaction;
  }
}
