import { AccountInfo, PublicKey, RpcResponseAndContext } from "@solana/web3.js";
import BN from "bn.js";

import { createLogger } from "../../common";

import { splAccountLayout } from "./layout";
import { TokenAccount, TokenAccountRaw } from "./types";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const logger = createLogger("Raydium_Util");

export interface ParseTokenAccount {
  solAccountResp?: AccountInfo<Buffer> | null;
  tokenAccountResp: RpcResponseAndContext<
    Array<{
      pubkey: PublicKey;
      account: AccountInfo<Buffer>;
    }>
  >;
}

export function parseTokenAccountResp({ solAccountResp, tokenAccountResp }: ParseTokenAccount): {
  tokenAccounts: TokenAccount[];
  tokenAccountRawInfos: TokenAccountRaw[];
} {
  const tokenAccounts: TokenAccount[] = [];
  const tokenAccountRawInfos: TokenAccountRaw[] = [];

  for (const { pubkey, account } of tokenAccountResp.value) {
    if (account.data.length !== splAccountLayout.span) {
      logger.error("invalid token account layout length", "publicKey", pubkey.toBase58());
      throw new Error("invalid token account layout length");
    }

    const accountInfo = splAccountLayout.decode(account.data);
    const { mint, amount } = accountInfo;

    tokenAccounts.push({
      publicKey: pubkey,
      mint,
      amount,
      isNative: false,
      programId: account.owner
    });
    // todo programId should get from api
    tokenAccountRawInfos.push({ pubkey, accountInfo, programId: account.owner });
  }

  if (solAccountResp) {
    tokenAccounts.push({
      mint: PublicKey.default,
      amount: new BN(solAccountResp.lamports),
      isNative: true,
      programId: solAccountResp.owner
    });
  }

  return {
    tokenAccounts,
    tokenAccountRawInfos,
  };
}
