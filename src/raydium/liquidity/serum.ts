import { PublicKey } from "@solana/web3.js";
import { createLogger } from "../../common/logger";
import { SerumVersion } from "../serum";
import { LIQUIDITY_VERSION_TO_SERUM_VERSION } from "./constant";

const logger = createLogger("Raydium_liquidity_serum");

export function getSerumVersion(version: number): SerumVersion {
  const serumVersion = LIQUIDITY_VERSION_TO_SERUM_VERSION[version];
  if (!serumVersion) logger.logWithError("invalid version", "version", version);

  return serumVersion;
}

export function getSerumAssociatedAuthority({ programId, marketId }: { programId: PublicKey; marketId: PublicKey }): {
  publicKey: PublicKey;
  nonce: number;
} {
  const seeds = [marketId.toBuffer()];

  let nonce = 0;
  let publicKey: PublicKey;

  while (nonce < 100) {
    try {
      const seedsWithNonce = seeds.concat(Buffer.from([nonce]), Buffer.alloc(7));
      publicKey = PublicKey.createProgramAddressSync(seedsWithNonce, programId);
    } catch (err) {
      if (err instanceof TypeError) {
        throw err;
      }
      nonce++;
      continue;
    }
    return { publicKey, nonce };
  }

  logger.logWithError("unable to find a viable program address nonce", "params", {
    programId,
    marketId,
  });
  throw new Error("unable to find a viable program address nonce");
}
