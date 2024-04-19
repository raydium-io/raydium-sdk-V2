export const API_URLS = {
  BASE_HOST: "https://uapi.raydium.io",
  OWNER_BASE_HOST: "https://owner.raydium.io",

  COINGECKO: "https://api.coingecko.com/api/v3/simple/price",

  FARM_ARP: "/main/farm/info",
  FARM_ARP_LINE: "/main/farm-apr-tv",

  AMM_V3_CONFIG: "/v3/pools/clmm-config",

  VERSION: "/v3/main/version",

  PRICE: "/v2/main/price",

  // api v3
  CHECK_AVAILABILITY: "/v3/main/AvailabilityCheckAPI",
  RPCS: "/v3/main/rpcs",
  INFO: "/v3/main/info",
  STAKE_POOLS: "/v3/main/stake-pools",
  CHAIN_TIME: "/v3/main/chain-time",
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
  POOL_SEARCH_BY_ID: "/v3/pools/info/ids/{ids}",
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
  POOL_SEARCH_LP: "/v3/pools/info/lps/{lp_mints}",
  POOL_KEY_BY_ID: "/v3/pools/key/id/{id}",
  POOLS_KEY: "/v3/pools/key/{type}/{page_size}/{page}",
  POOLS_KEY_BY_MINT: "/v3/pools/key/mint/{mint1}/{type}/{page_size}/{page}",
  POOLS_KEY_BY_MINT_2: "/v3/pools/key/mint/{mint1}/{mint2}/{type}/{page_size}/{page}",
  POOL_LIQUIDITY_LINE: "/v3/pools/line/liquidity/{id}",
  POOL_POSITION_LINE: "/v3/pools/line/position/{id}",
  FARM_INFO: "/v3/farms/info/ids/{ids}",
  FARM_LP_INFO: "/v3/farms/info/lp/{pool_lp}/{page_size}/{page}",
  FARM_LIST: "/v3/farms/info/list/all/{page_size}/{page}",
  FARM_KEYS: "/v3/farms/key/ids/{ids}",
  OWNER_CREATED_FARM: "/v1/create-pool/{owner}",
  OWNER_IDO: "/v1/ido/{owner}",
  OWNER_STAKE_FARMS: "/v1/position/stake/{owner}",
  IDO_KEYS: "/v3/ido/key/ids/{ids}",
  SWAP_HOST: "https://transaction-v1.raydium.io",
  SWAP_COMPUTE: "/compute/",
  SWAP_TX: "/transaction/",
  MINT_PRICE: "/v3/mint/price",
  MIGRATE_CONFIG: "/v3/main/migrate-lp",
};

export const DEV_API_URLS = {
  ...API_URLS,
};

export type API_URL_CONFIG = Partial<typeof API_URLS>;
