import { AccountInfo, Commitment, Connection, PublicKey } from "@solana/web3.js";
import { ReturnTypeFetchMultipleMintInfos } from "../raydium/type";
import { WSOLMint, chunkArray, solToWSol } from "./";
import { createLogger } from "./logger";
import { MINT_SIZE, TOKEN_PROGRAM_ID, getTransferFeeConfig, unpackMint } from "@solana/spl-token";

interface MultipleAccountsJsonRpcResponse {
  jsonrpc: string;
  id: string;
  error?: {
    code: number;
    message: string;
  };
  result: {
    context: { slot: number };
    value: { data: Array<string>; executable: boolean; lamports: number; owner: string; rentEpoch: number }[];
  };
}

export interface GetMultipleAccountsInfoConfig {
  batchRequest?: boolean;
  commitment?: Commitment;
  chunkCount?: number;
}

const logger = createLogger("Raydium_accountInfo_util");

export async function getMultipleAccountsInfo(
  connection: Connection,
  publicKeys: PublicKey[],
  config?: GetMultipleAccountsInfoConfig,
): Promise<(AccountInfo<Buffer> | null)[]> {
  const {
    batchRequest,
    commitment = "confirmed",
    chunkCount = 100,
  } = {
    batchRequest: false,
    ...config,
  };

  const chunkedKeys = chunkArray(publicKeys, chunkCount);
  let results: (AccountInfo<Buffer> | null)[][] = new Array(chunkedKeys.length).fill([]);

  if (batchRequest) {
    const batch = chunkedKeys.map((keys) => {
      const args = connection._buildArgs([keys.map((key) => key.toBase58())], commitment, "base64");
      return {
        methodName: "getMultipleAccounts",
        args,
      };
    });

    const _batch = chunkArray(batch, 10);

    const unsafeResponse: MultipleAccountsJsonRpcResponse[] = await (
      await Promise.all(_batch.map(async (i) => await (connection as any)._rpcBatchRequest(i)))
    ).flat();
    results = unsafeResponse.map((unsafeRes: MultipleAccountsJsonRpcResponse) => {
      if (unsafeRes.error)
        logger.logWithError(`failed to get info for multiple accounts, RPC_ERROR, ${unsafeRes.error.message}`);

      return unsafeRes.result.value.map((accountInfo) => {
        if (accountInfo) {
          const { data, executable, lamports, owner, rentEpoch } = accountInfo;

          if (data.length !== 2 && data[1] !== "base64") logger.logWithError(`info must be base64 encoded, RPC_ERROR`);

          return {
            data: Buffer.from(data[0], "base64"),
            executable,
            lamports,
            owner: new PublicKey(owner),
            rentEpoch,
          };
        }
        return null;
      });
    });
  } else {
    try {
      results = (await Promise.all(
        chunkedKeys.map((keys) => connection.getMultipleAccountsInfo(keys, commitment)),
      )) as (AccountInfo<Buffer> | null)[][];
    } catch (error) {
      if (error instanceof Error) {
        logger.logWithError(`failed to get info for multiple accounts, RPC_ERROR, ${error.message}`);
      }
    }
  }

  return results.flat();
}

export async function getMultipleAccountsInfoWithCustomFlags<T extends { pubkey: PublicKey }>(
  connection: Connection,
  publicKeysWithCustomFlag: T[],
  config?: GetMultipleAccountsInfoConfig,
): Promise<({ accountInfo: AccountInfo<Buffer> | null } & T)[]> {
  const multipleAccountsInfo = await getMultipleAccountsInfo(
    connection,
    publicKeysWithCustomFlag.map((o) => o.pubkey),
    config,
  );

  return publicKeysWithCustomFlag.map((o, idx) => ({ ...o, accountInfo: multipleAccountsInfo[idx] }));
}

export enum AccountType {
  Uninitialized,
  Mint,
  Account,
}
export const ACCOUNT_TYPE_SIZE = 1;

export async function fetchMultipleMintInfos({
  connection,
  mints,
  config,
}: {
  connection: Connection;
  mints: PublicKey[];
  config?: { batchRequest?: boolean };
}): Promise<ReturnTypeFetchMultipleMintInfos> {
  if (mints.length === 0) return {};
  const mintInfos = await getMultipleAccountsInfoWithCustomFlags(
    connection,
    mints.map((i) => ({ pubkey: solToWSol(i) })),
    config,
  );

  const mintK: ReturnTypeFetchMultipleMintInfos = {};
  for (const i of mintInfos) {
    if (!i.accountInfo || i.accountInfo.data.length < MINT_SIZE) {
      console.log("invalid mint account", i.pubkey.toBase58());
      continue;
    }
    const t = unpackMint(i.pubkey, i.accountInfo, i.accountInfo?.owner);
    mintK[i.pubkey.toString()] = {
      ...t,
      programId: i.accountInfo?.owner || TOKEN_PROGRAM_ID,
      feeConfig: getTransferFeeConfig(t) ?? undefined,
    };
  }
  mintK[PublicKey.default.toBase58()] = mintK[WSOLMint.toBase58()];

  return mintK;
}
