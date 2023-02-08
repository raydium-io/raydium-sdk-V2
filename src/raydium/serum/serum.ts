import { PublicKey } from "@solana/web3.js";

import { createLogger } from "../../common/logger";

import { SERUM_PROGRAMID_TO_VERSION, SERUM_VERSION_TO_PROGRAMID } from "./id";
import { MARKET_VERSION_TO_STATE_LAYOUT, MarketStateLayout } from "./layout";

const logger = createLogger("Serum");

export class Market {
  /* ================= get version and program id ================= */
  static getProgramId(version: number): PublicKey {
    const programId = SERUM_VERSION_TO_PROGRAMID[version];
    if (!programId) logger.logWithError("invalid version", "version", version);

    return programId;
  }

  static getVersion(programId: PublicKey): number {
    const programIdString = programId.toBase58();

    const version = SERUM_PROGRAMID_TO_VERSION[programIdString];
    if (!version) logger.logWithError("invalid program id", "programId", programIdString);

    return version;
  }

  /* ================= get layout ================= */
  static getStateLayout(version: number): MarketStateLayout {
    const STATE_LAYOUT = MARKET_VERSION_TO_STATE_LAYOUT[version];
    if (!STATE_LAYOUT) logger.logWithError(!!STATE_LAYOUT, "invalid version", "version", version);

    return STATE_LAYOUT;
  }

  static getLayouts(version: number): { state: MarketStateLayout } {
    return { state: this.getStateLayout(version) };
  }

  /* ================= get key ================= */
  static getAssociatedAuthority({ programId, marketId }: { programId: PublicKey; marketId: PublicKey }): {
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

    return { publicKey: PublicKey.default, nonce };
  }
}
