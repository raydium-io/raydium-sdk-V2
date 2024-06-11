import { PublicKey } from "@solana/web3.js";
import { BN_ZERO, WSOLMint } from "@/common";
import { TxVersion } from "@/common/txTool/txType";
import { MakeTxData } from "@/common/txTool/txTool";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { PoolAccountInfoV4, ReturnTypeGetAddLiquidityDefaultPool } from "./type";
import { BigNumberish, parseBigNumberish } from "@/common/bignumber";
import {
  createWSolAccountInstructions,
  closeAccountInstruction,
  makeTransferInstruction,
} from "../account/instruction";
import { TokenAccount } from "../account/types";
import { ComputeBudgetConfig } from "@/raydium/type";

type LiquidityPoolJsonInfo = any;
export default class TradeV2 extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  static getAddLiquidityDefaultPool({
    addLiquidityPools,
    poolInfosCache,
  }: {
    addLiquidityPools: LiquidityPoolJsonInfo[];
    poolInfosCache: { [ammId: string]: PoolAccountInfoV4 };
  }): ReturnTypeGetAddLiquidityDefaultPool {
    if (addLiquidityPools.length === 0) return undefined;
    if (addLiquidityPools.length === 1) return addLiquidityPools[0];
    addLiquidityPools.sort((a, b) => b.version - a.version);
    if (addLiquidityPools[0].version !== addLiquidityPools[1].version) return addLiquidityPools[0];

    const _addLiquidityPools = addLiquidityPools.filter((i) => i.version === addLiquidityPools[0].version);

    _addLiquidityPools.sort((a, b) => this.comparePoolSize(a, b, poolInfosCache));
    return _addLiquidityPools[0];
  }

  private static comparePoolSize(
    a: LiquidityPoolJsonInfo,
    b: LiquidityPoolJsonInfo,
    ammIdToPoolInfo: { [ammId: string]: PoolAccountInfoV4 },
  ): number {
    const aInfo = ammIdToPoolInfo[a.id];
    const bInfo = ammIdToPoolInfo[b.id];
    if (aInfo === undefined) return 1;
    if (bInfo === undefined) return -1;

    if (a.baseMint === b.baseMint) {
      const sub = aInfo.baseReserve.sub(bInfo.baseReserve);
      return sub.gte(BN_ZERO) ? -1 : 1;
    } else {
      const sub = aInfo.baseReserve.sub(bInfo.quoteReserve);
      return sub.gte(BN_ZERO) ? -1 : 1;
    }
  }

  private async getWSolAccounts(): Promise<TokenAccount[]> {
    this.scope.checkOwner();
    await this.scope.account.fetchWalletTokenAccounts();
    const tokenAccounts = this.scope.account.tokenAccounts.filter((acc) => acc.mint.equals(WSOLMint));
    tokenAccounts.sort((a, b) => {
      if (a.isAssociated) return 1;
      if (b.isAssociated) return -1;
      return a.amount.lt(b.amount) ? -1 : 1;
    });
    return tokenAccounts;
  }

  public async unWrapWSol<T extends TxVersion>(props: {
    amount: BigNumberish;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
    txVersion?: T;
  }): Promise<MakeTxData<T>> {
    const { amount, tokenProgram, txVersion = TxVersion.LEGACY } = props;
    const tokenAccounts = await this.getWSolAccounts();
    const txBuilder = this.createTxBuilder();
    txBuilder.addCustomComputeBudget(props.computeBudgetConfig);
    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount: 0,
    });
    txBuilder.addInstruction(ins);

    const amountBN = parseBigNumberish(amount);
    for (let i = 0; i < tokenAccounts.length; i++) {
      if (amountBN.gte(tokenAccounts[i].amount)) {
        txBuilder.addInstruction({
          instructions: [
            closeAccountInstruction({
              tokenAccount: tokenAccounts[i].publicKey!,
              payer: this.scope.ownerPubKey,
              owner: this.scope.ownerPubKey,
              programId: tokenProgram,
            }),
          ],
        });
        amountBN.sub(tokenAccounts[i].amount);
      } else {
        txBuilder.addInstruction({
          instructions: [
            closeAccountInstruction({
              tokenAccount: tokenAccounts[i].publicKey!,
              payer: this.scope.ownerPubKey,
              owner: this.scope.ownerPubKey,
              programId: tokenProgram,
            }),
          ],
        });
        makeTransferInstruction({
          destination: ins.addresses.newAccount,
          source: tokenAccounts[i].publicKey!,
          amount: amountBN,
          owner: this.scope.ownerPubKey,
          tokenProgram,
        });
      }
    }

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async wrapWSol<T extends TxVersion>(
    amount: BigNumberish,
    tokenProgram?: PublicKey,
    txVersion?: T,
  ): Promise<MakeTxData<T>> {
    const tokenAccounts = await this.getWSolAccounts();

    const txBuilder = this.createTxBuilder();
    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount,
      skipCloseAccount: true,
    });
    txBuilder.addInstruction(ins);

    if (tokenAccounts.length) {
      // already have wsol account
      txBuilder.addInstruction({
        instructions: [
          makeTransferInstruction({
            // destination: ins.signers![0].publicKey,
            destination: tokenAccounts[0].publicKey!,
            source: ins.addresses.newAccount,
            amount,
            owner: this.scope.ownerPubKey,
            tokenProgram,
          }),
        ],
        endInstructions: [
          closeAccountInstruction({
            tokenAccount: ins.addresses.newAccount,
            payer: this.scope.ownerPubKey,
            owner: this.scope.ownerPubKey,
            programId: tokenProgram,
          }),
        ],
      });
    }
    return txBuilder.versionBuild({ txVersion: txVersion ?? TxVersion.LEGACY }) as Promise<MakeTxData<T>>;
  }
}
