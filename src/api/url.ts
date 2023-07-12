export const API_URLS = {
  BASE_HOST: "https://api.raydium.io",
  TOKEN_LIST: "/v3/mint/list",
  TOKEN_INFO: "/v3/mint/item/{mint}",
  TOKEN: "/v2/sdk/token/raydium.mainnet.json",
  COINGECKO: "https://api.coingecko.com/api/v3/simple/price",
  LIQUIDITY: "/v2/sdk/liquidity/mainnet.json",

  FARMS: "/v2/sdk/farm-v2/mainnet.json",
  FARM_ARP: "/main/farm/info",
  FARM_ARP_LINE: "/main/farm-apr-tv",

  AMM_V3: "/v2/ammV3/ammPools",
  AMM_V3_CONFIG: "/v2/ammV3/ammConfigs",
  AMM_V3_LINES: "/v2/ammV3/positionLine",

  INFO: "/v2/main/info",
  VERSION: "/v2/main/version",

  PAIRS: "/v2/main/pairs",
  PRICE: "/v2/main/price",
  RPCS: "/v2/main/rpcs",

  CHAIN_TIME: "/v2/main/chain/time",

  IDO_INFO: "/v2/main/ido/pools",
  IDO_PROJECT_INFO: "/v2/main/ido/project/",
};

export const DEV_API_URLS = {
  ...API_URLS,
  BASE_HOST: "https://api-v3.asdf1234.win",
};

export type API_URL_CONFIG = Partial<typeof API_URLS>;
