export const API_URLS = {
  BASE_HOST: "https://api.raydium.io",

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

  // api v3
  TOKEN_LIST: "/v3/mint/list",
  TOKEN_INFO: "/v3/mint/item/{mint}",
  JUP_TOKEN_LIST: "https://token.jup.ag/{type}",
  POOL_LIST: "/v3/pools/info/{type}/{sort}/{order}/100/{page}",
  POOL_SEARCH_BY_ID: "/v3/pools/info/id/{id}",
  POOL_SEARCH: "/v3/pools/info/search/{search_text}/{type}/{sort}/{order}/100/{page}",
  POOL_SEARCH_MINT: "/v3/pools/info/mint/{mint1}/{type}/{sort}/{order}/100/{page}",
  POOL_SEARCH_MINT_2: "/v3/pools/info/mint/{mint1}/{mint2}/{type}/{sort}/{order}/100/{page}",
};

export const DEV_API_URLS = {
  ...API_URLS,
  BASE_HOST: "https://api-v3.asdf1234.win",
  TOKEN_LIST: "/v3/mint/list",
  TOKEN_INFO: "/v3/mint/item/{mint}",
  JUP_TOKEN_LIST: "https://token.jup.ag/{type}",
  /**
   * type: {all | concentrated | standard}
   * sort: {liquidity | volume_24h / 7d / 30d | fee_24h / 7d / 30d | apr_24h / 7d / 30d}
   * order: {desc/asc}
   * page: number
   */
  POOL_LIST: "/v3/pools/info/{type}/{sort}/{order}/100/{page}",
  /**
   * id: pool id
   */
  POOL_SEARCH_BY_ID: "/v3/pools/info/id/{id}",
  /**
   * search_text: search text
   * type: {all | concentrated | standard}
   * sort: {liquidity | volume_24h / 7d / 30d | fee_24h / 7d / 30d | apr_24h / 7d / 30d}
   * order: {desc/asc}
   * page: number
   */
  POOL_SEARCH: "/v3/pools/info/search/{search_text}/{type}/{sort}/{order}/100/{page}",
  /**
   * mint1/mint2: search pool by mint
   * sort: {liquidity | volume_24h / 7d / 30d | fee_24h / 7d / 30d | apr_24h / 7d / 30d}
   * type: {all | concentrated | standard}
   * order: {desc/asc}
   * page: number
   */
  POOL_SEARCH_MINT: "/v3/pools/info/mint/{mint1}/{type}/{sort}/{order}/100/{page}",
  POOL_SEARCH_MINT_2: "/v3/pools/info/mint/{mint1}/{mint2}/{type}/{sort}/{order}/100/{page}",
};

export type API_URL_CONFIG = Partial<typeof API_URLS>;
