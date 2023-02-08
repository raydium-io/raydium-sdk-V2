export const API_URLS = {
  BASE_HOST: "https://api.raydium.io/v2",
  TOKEN: "/sdk/token/raydium.mainnet.json",
  COINGECKO: "https://api.coingecko.com/api/v3/simple/price",
  LIQUIDITY: "/sdk/liquidity/mainnet.json",
  PAIRS: "/main/pairs",
  FARMS: "/sdk/farm-v2/mainnet.json",
  AMM_V3: "/ammV3/ammPools",
  AMM_V3_CONFIG: "/ammV3/ammConfigs",
  AMM_V3_LINES: "/ammV3/positionLine",
  PRICE: "/main/price",
  CHAIN_TIME: "/main/chain/time",
};

export type API_URL_CONFIG = Partial<typeof API_URLS>;
