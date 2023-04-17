export const API_URLS = {
  BASE_HOST: "https://api.raydium.io/v2",
  TOKEN: "/sdk/token/raydium.mainnet.json",
  COINGECKO: "https://api.coingecko.com/api/v3/simple/price",
  LIQUIDITY: "/sdk/liquidity/mainnet.json",

  FARMS: "/sdk/farm-v2/mainnet.json",
  FARM_ARP: "/main/farm/info",
  FARM_ARP_LINE: "/main/farm-apr-tv",

  AMM_V3: "/ammV3/ammPools",
  AMM_V3_CONFIG: "/ammV3/ammConfigs",
  AMM_V3_LINES: "/ammV3/positionLine",

  INFO: "/main/info",
  VERSION: "/main/version",

  PAIRS: "/main/pairs",
  PRICE: "/main/price",
  RPCS: "/main/rpcs",

  CHAIN_TIME: "/main/chain/time",

  IDO_INFO: "/main/ido/pools",
  IDO_PROJECT_INFO: "/main/ido/project/",
};

export type API_URL_CONFIG = Partial<typeof API_URLS>;
