import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TokenInfo } from "./type";

export const SOL_INFO: TokenInfo = {
  chainId: 101,
  address: PublicKey.default.toBase58(),
  programId: TOKEN_PROGRAM_ID.toBase58(),
  decimals: 9,
  symbol: "SOL",
  name: "solana",
  logoURI: `https://img-v1.raydium.io/icon/So11111111111111111111111111111111111111112.png`,
  tags: [],
  priority: 2,
  type: "raydium",
  extensions: {
    coingeckoId: "solana",
  },
};

export const TOKEN_WSOL: TokenInfo = {
  chainId: 101,
  address: "So11111111111111111111111111111111111111112",
  programId: TOKEN_PROGRAM_ID.toBase58(),
  decimals: 9,
  symbol: "WSOL",
  name: "Wrapped SOL",
  logoURI: `https://img-v1.raydium.io/icon/So11111111111111111111111111111111111111112.png`,
  tags: [],
  priority: 2,
  type: "raydium",
  extensions: {
    coingeckoId: "solana",
  },
};
