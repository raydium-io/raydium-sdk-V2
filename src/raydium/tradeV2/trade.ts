import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import { forecastTransactionSize, solToWSol, TxBuilder, BN_ZERO, SOLMint, WSOLMint, addComputeBudget } from "@/common";
import { Token } from "@/module";
import { StableLayout } from "../liquidity/stable";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  ComputeAmountOutLayout,
  ComputeAmountOutRouteLayout,
  PoolAccountInfoV4,
  ReturnTypeGetAddLiquidityDefaultPool,
} from "./type";
import { makeSwapInstruction } from "./instrument";
import { MakeMultiTransaction, MakeTransaction } from "../type";
import { InstructionType } from "@/common/txTool/txType";
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

  public async unWrapWSol(props: {
    amount: BigNumberish;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
  }): Promise<MakeTransaction> {
    const { amount, tokenProgram } = props;
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

    return txBuilder.build();
  }

  public async wrapWSol(amount: BigNumberish, tokenProgram?: PublicKey): Promise<MakeTransaction> {
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
    return txBuilder.build();
  }
}
