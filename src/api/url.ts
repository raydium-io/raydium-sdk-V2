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

  VERSION: "/v2/main/version",

  PAIRS: "/v2/main/pairs",
  PRICE: "/v2/main/price",

  IDO_INFO: "/v2/main/ido/pools",
  IDO_PROJECT_INFO: "/v2/main/ido/project/",

  // api v3
  RPCS: "/v3/main/rpcs",
  INFO: "/v3/main/info",
  STAKE_POOLS: "/v3/main/stake-pools",
  CHAIN_TIME: "/v3/main/chain-time",
  TOKEN_LIST: "/v3/mint/list",
  TOKEN_INFO: "/v3/mint/item/{mint}",
  JUP_TOKEN_LIST: "https://token.jup.ag/{type}",
  POOL_LIST: "/v3/pools/info/{type}/{sort}/{order}/{page_size}/{page}",
  POOL_SEARCH_BY_ID: "/v3/pools/info/id/{id}",
  POOL_SEARCH: "/v3/pools/info/search/{search_text}/{type}/{sort}/{order}/{page_size}/{page}",
  POOL_SEARCH_MINT: "/v3/pools/info/mint/{mint1}/{type}/{sort}/{order}/{page_size}/{page}",
  POOL_SEARCH_MINT_2: "/v3/pools/info/mint/{mint1}/{mint2}/{type}/{sort}/{order}/{page_size}/{page}",
  POOL_KEY_BY_ID: "/v3/pools/key/id/{id}",
  POOLS_KEY: "/v3/pools/key/{type}/{page_size}/{page}",
  POOLS_KEY_BY_MINT: "/v3/pools/key/mint/{mint1}/{type}/{page_size}/{page}",
  POOLS_KEY_BY_MINT_2: "/v3/pools/key/mint/{mint1}/{mint2}/{type}/{page_size}/{page}",
  POOL_LIQUIDITY_LINE: "/v3/pools/line/liquidity/{id}",
  POOL_POSITION_LINE: "/v3/pools/line/position/{id}",
  FARM_INFO: "/v3/farms/info/id/{pool_id}",
  FARM_LP_INFO: "/v3/farms/info/lp/{pool_lp}/{page_size}/{page}",
  FARM_LIST: "/v3/farms/info/list/all/{page_size}/{page}",
  FARM_KEYS: "/v3/farms/key/id/{pool_id}",
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
  POOL_LIST: "/v3/pools/info/{type}/{sort}/{order}/{page_size}/{page}",
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
  POOL_SEARCH: "/v3/pools/info/search/{search_text}/{type}/{sort}/{order}/{page_size}/{page}",
  /**
   * mint1/mint2: search pool by mint
   * sort: {liquidity | volume_24h / 7d / 30d | fee_24h / 7d / 30d | apr_24h / 7d / 30d}
   * type: {all | concentrated | standard}
   * order: {desc/asc}
   * page: number
   */
  POOL_SEARCH_MINT: "/v3/pools/info/mint/{mint1}/{type}/{sort}/{order}/{page_size}/{page}",
  POOL_SEARCH_MINT_2: "/v3/pools/info/mint/{mint1}/{mint2}/{type}/{sort}/{order}/{page_size}/{page}",
};

export type API_URL_CONFIG = Partial<typeof API_URLS>;
