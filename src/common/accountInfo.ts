import { AccountInfo, Commitment, Connection, PublicKey } from "@solana/web3.js";
import { ReturnTypeFetchMultipleMintInfos } from "../raydium/type";
import { WSOLMint, chunkArray, solToWSol } from "./"; // Assuming utility functions are defined here
import { createLogger } from "./logger"; // Assuming logger utility is defined here
import { MINT_SIZE, TOKEN_PROGRAM_ID, getTransferFeeConfig, unpackMint } from "@solana/spl-token";

// --- Type Definitions for External Use and Internal RPC Response ---

/**
 * Configuration options for fetching multiple accounts info.
 * batchRequest is deprecated due to reliance on private RPC methods.
 */
export interface GetMultipleAccountsInfoConfig {
    /** @deprecated: Use standard chunking/parallel requests instead of internal RPC batching. */
    batchRequest?: boolean;
    commitment?: Commitment;
    /** Number of public keys per single RPC call. Default is 100. */
    chunkCount?: number;
}

/**
 * Defines the structure for fetching accounts with custom associated data.
 */
export interface PublicKeyWithCustomFlag {
    pubkey: PublicKey;
    [key: string]: any;
}

const logger = createLogger("Raydium_accountInfo_util");

/**
 * Fetches information for multiple accounts using chunking to manage RPC limits.
 * Avoids internal/private RPC methods for stability.
 *
 * @param connection The Solana Connection object.
 * @param publicKeys An array of PublicKey objects to fetch.
 * @param config Configuration options, including commitment and chunk size.
 * @returns A flattened array of AccountInfo or null for each input key.
 */
export async function getMultipleAccountsInfo(
    connection: Connection,
    publicKeys: PublicKey[],
    config?: GetMultipleAccountsInfoConfig,
): Promise<(AccountInfo<Buffer> | null)[]> {
    const {
        commitment = "confirmed",
        chunkCount = 100,
    } = {
        // batchRequest logic removed due to relying on private methods
        ...config,
    };

    if (publicKeys.length === 0) {
        return [];
    }
    
    // Chunk the keys to adhere to RPC request limits.
    const chunkedKeys = chunkArray(publicKeys, chunkCount);
    let results: (AccountInfo<Buffer> | null)[] = [];

    try {
        // Use Promise.all to fetch chunks in parallel, leveraging the standard RPC method.
        const chunkResults = await Promise.all(
            chunkedKeys.map((keys) => connection.getMultipleAccountsInfo(keys, commitment)),
        );
        
        // Flatten the array of arrays back into a single list of results.
        results = chunkResults.flat();
    } catch (error) {
        // Catch network or generic RPC errors during the standard request process.
        if (error instanceof Error) {
            logger.error(`Failed to get info for multiple accounts due to RPC error: ${error.message}`);
        } else {
            logger.error(`An unknown error occurred while fetching accounts: ${error}`);
        }
    }

    return results;
}

/**
 * Fetches account information and merges it with custom flags provided in the input.
 *
 * @param connection The Solana Connection object.
 * @param publicKeysWithCustomFlag Array of objects containing PublicKey and custom data.
 * @param config Configuration options.
 * @returns Array of merged objects, including the fetched accountInfo.
 */
export async function getMultipleAccountsInfoWithCustomFlags<T extends PublicKeyWithCustomFlag>(
    connection: Connection,
    publicKeysWithCustomFlag: T[],
    config?: GetMultipleAccountsInfoConfig,
): Promise<({ accountInfo: AccountInfo<Buffer> | null } & T)[]> {
    const multipleAccountsInfo = await getMultipleAccountsInfo(
        connection,
        publicKeysWithCustomFlag.map((o) => o.pubkey),
        config,
    );

    // Map the results back to the original objects, attaching the account info.
    return publicKeysWithCustomFlag.map((o, idx) => ({ ...o, accountInfo: multipleAccountsInfo[idx] }));
}

// --- Token Program specific constants ---

export enum AccountType {
    Uninitialized,
    Mint,
    Account,
}
export const ACCOUNT_TYPE_SIZE = 1;

/**
 * Fetches multiple Mint Account Infos, processes the data using SPL-Token utilities,
 * and maps WSOL to a default Public Key (for Raydium specific use cases).
 *
 * @param connection The Solana Connection object.
 * @param mints Array of Mint PublicKeys.
 * @param config Configuration options.
 * @returns An object mapping Mint Public Key string to its parsed Mint information.
 */
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
    
    // 1. Fetch account info for all mints (wrapping SOL to WSOL if necessary for consistency).
    const mintInfosWithFlags = await getMultipleAccountsInfoWithCustomFlags(
        connection,
        mints.map((i) => ({ pubkey: solToWSol(i) })),
        config,
    );

    const mintK: ReturnTypeFetchMultipleMintInfos = {};
    for (const i of mintInfosWithFlags) {
        // 2. Validate account info
        if (!i.accountInfo || i.accountInfo.data.length < MINT_SIZE) {
            logger.warn(`Invalid or uninitialized mint account found: ${i.pubkey.toBase58()}. Skipping.`);
            continue;
        }
        
        // 3. Unpack Mint data using the standard SPL utility.
        const unpackedMint = unpackMint(i.pubkey, i.accountInfo, i.accountInfo.owner);
        
        // 4. Store the unpacked mint info.
        mintK[i.pubkey.toString()] = {
            ...unpackedMint,
            programId: i.accountInfo.owner || TOKEN_PROGRAM_ID,
            feeConfig: getTransferFeeConfig(unpackedMint) ?? undefined,
        };
    }
    
    // 5. Raydium specific alias: Map the default PublicKey to the WSOL Mint info.
    // This is a common pattern in Solana AMM environments where PublicKey.default represents SOL/WSOL.
    if (mintK[WSOLMint.toBase58()]) {
        mintK[PublicKey.default.toBase58()] = mintK[WSOLMint.toBase58()];
    } else {
        logger.warn("WSOL mint information was not successfully fetched or parsed.");
    }

    return mintK;
}
