import { PublicKey, Transaction, Keypair, Signer } from "@solana/web3.js";
import BN from "bn.js";
import { AmmSource } from "../liquidity/type";
import { closeAccountInstruction, TokenAccountRaw } from "../account";
import { splitTxAndSigners } from "../../common/txTool";
import { TOKEN_WSOL } from "../token";

export function groupPools(pools: AmmSource[]): AmmSource[][] {
  const grouped: AmmSource[][] = [];

  for (let index = 0; index < pools.length; index++) {
    for (let i = 0; i < pools.length; i++) {
      if (index == i) continue;
      grouped.push([pools[index], pools[i]]);
    }
  }
  return grouped;
}

export function unwarpSol({
  ownerInfo,
  tokenAccounts,
}: {
  ownerInfo: {
    wallet: PublicKey;
    payer: PublicKey;
  };
  tokenAccounts: TokenAccountRaw[];
}): {
  transactions: {
    transaction: Transaction;
    signer: (Signer | Keypair)[];
  }[];
  amount: BN;
} {
  const WSOL_MINT = new PublicKey(TOKEN_WSOL.mint);
  const instructionsInfo = tokenAccounts
    .filter((i) => i.accountInfo.mint.equals(WSOL_MINT))
    .map((i) => ({
      amount: i.accountInfo.amount,
      tx: closeAccountInstruction({ tokenAccount: i.pubkey, owner: ownerInfo.wallet, payer: ownerInfo.payer }),
    }));
  const transactions = splitTxAndSigners({
    instructions: instructionsInfo.map((i) => i.tx),
    signers: [],
    payer: ownerInfo.wallet,
  });
  const amount = instructionsInfo.map((i) => i.amount).reduce((a, b) => a.add(b), new BN(0));

  return { transactions, amount };
}
