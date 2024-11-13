import { AccountInfo, GetProgramAccountsResponse, Keypair, PublicKey, RpcResponseAndContext } from "@solana/web3.js";
import BN from "bn.js";
import { createLogger, getATAAddress } from "../../common";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import { splAccountLayout } from "./layout";
import { TokenAccount, TokenAccountRaw } from "./types";

const logger = createLogger("Raydium_Util");

export interface ParseTokenAccount {
  owner: PublicKey;
  solAccountResp?: AccountInfo<Buffer> | null;
  tokenAccountResp: RpcResponseAndContext<GetProgramAccountsResponse>;
}

export function parseTokenAccountResp({ owner, solAccountResp, tokenAccountResp }: ParseTokenAccount): {
  tokenAccounts: TokenAccount[];
  tokenAccountRawInfos: TokenAccountRaw[];
} {
  const tokenAccounts: TokenAccount[] = [];
  const tokenAccountRawInfos: TokenAccountRaw[] = [];

  for (const { pubkey, account } of tokenAccountResp.value) {
    const accountInfo = splAccountLayout.decode(account.data);
    const { mint, amount } = accountInfo;
    tokenAccounts.push({
      publicKey: pubkey,
      mint,
      amount,
      isAssociated: getATAAddress(owner, mint, account.owner).publicKey.equals(pubkey),
      isNative: false,
      programId: account.owner,
    });
    // todo programId should get from api
    tokenAccountRawInfos.push({ pubkey, accountInfo, programId: account.owner });
  }

  if (solAccountResp) {
    tokenAccounts.push({
      mint: PublicKey.default,
      amount: new BN(String(solAccountResp.lamports)),
      isNative: true,
      programId: solAccountResp.owner,
    });
  }

  return {
    tokenAccounts,
    tokenAccountRawInfos,
  };
}

export function generatePubKey({
  fromPublicKey,
  programId = TOKEN_PROGRAM_ID,
  assignSeed,
}: {
  fromPublicKey: PublicKey;
  programId: PublicKey;
  assignSeed?: string;
}): { publicKey: PublicKey; seed: string } {
  const seed = assignSeed ? btoa(assignSeed).slice(0, 32) : Keypair.generate().publicKey.toBase58().slice(0, 32);
  const publicKey = createWithSeed(fromPublicKey, seed, programId);
  return { publicKey, seed };
}

function createWithSeed(fromPublicKey: PublicKey, seed: string, programId: PublicKey): PublicKey {
  const buffer = Buffer.concat([fromPublicKey.toBuffer(), Buffer.from(seed), programId.toBuffer()]);
  const publicKeyBytes = sha256(buffer);
  return new PublicKey(publicKeyBytes);
}
