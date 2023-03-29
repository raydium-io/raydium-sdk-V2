import axios, { AxiosInstance } from "axios";

import { createLogger, sleep } from "../common";
import { Cluster } from "../solana";

import {
  ApiFarmPools,
  ApiJsonPairInfo,
  ApiLiquidityPools,
  ApiTokens,
  ApiAmmV3PoolInfo,
  ApiAmmV3ConfigInfo,
  ApiIdoItem,
  ApiIdoInfo,
} from "./type";
import { API_URLS, API_URL_CONFIG } from "./url";
import { updateReqHistory } from "./utils";

const logger = createLogger("Raydium_Api");

export async function endlessRetry<T>(name: string, call: () => Promise<T>, interval = 1000): Promise<T> {
  let result: T | undefined;

  while (result == undefined) {
    try {
      logger.debug(`Request ${name} through endlessRetry`);
      result = await call();
    } catch (err) {
      logger.error(`Request ${name} failed, retry after ${interval} ms`, err);
      await sleep(interval);
    }
  }

  return result;
}

export interface ApiProps {
  cluster: Cluster;
  timeout: number;
  logRequests?: boolean;
  logCount?: number;
  urlConfigs?: API_URL_CONFIG;
}

export class Api {
  public cluster: Cluster;

  public api: AxiosInstance;
  public logCount: number;

  public urlConfigs: API_URL_CONFIG;

  constructor({ cluster, timeout, logRequests, logCount, urlConfigs }: ApiProps) {
    this.cluster = cluster;
    this.urlConfigs = urlConfigs || {};
    this.logCount = logCount || 1000;

    this.api = axios.create({ baseURL: this.urlConfigs.BASE_HOST || API_URLS.BASE_HOST, timeout });

    this.api.interceptors.request.use(
      (config) => {
        // before request
        const { method, baseURL, url } = config;

        logger.debug(`${method?.toUpperCase()} ${baseURL}${url}`);

        return config;
      },
      (error) => {
        // request error
        logger.error(`Request failed`);

        return Promise.reject(error);
      },
    );
    this.api.interceptors.response.use(
      (response) => {
        // 2xx
        const { config, data, status } = response;
        const { method, baseURL, url } = config;

        if (logRequests) {
          updateReqHistory({
            status,
            url: `${baseURL}${url}`,
            params: config.params,
            data,
            logCount: this.logCount,
          });
        }

        logger.debug(`${method?.toUpperCase()} ${baseURL}${url}  ${status}`);

        return data;
      },
      (error) => {
        // https://axios-http.com/docs/handling_errors
        // not 2xx
        const { config, response = {} } = error;
        const { status } = response;
        const { method, baseURL, url } = config;

        if (logRequests) {
          updateReqHistory({
            status,
            url: `${baseURL}${url}`,
            params: config.params,
            data: error.message,
            logCount: this.logCount,
          });
        }

        logger.error(`${method.toUpperCase()} ${baseURL}${url} ${status || error.message}`);

        return Promise.reject(error);
      },
    );
  }

  async getTokens(): Promise<ApiTokens> {
    return this.api.get(this.urlConfigs.TOKEN || API_URLS.TOKEN);
  }

  async getLiquidityPools(): Promise<ApiLiquidityPools> {
    return this.api.get(this.urlConfigs.LIQUIDITY || API_URLS.LIQUIDITY);
  }

  async getPairsInfo(): Promise<ApiJsonPairInfo[]> {
    return this.api.get(this.urlConfigs.PAIRS || API_URLS.PAIRS);
  }

  async getFarmPools(): Promise<ApiFarmPools> {
    return this.api.get(this.urlConfigs.FARMS || API_URLS.FARMS);
  }

  async getConcentratedPools(): Promise<ApiAmmV3PoolInfo[]> {
    const res = await this.api.get(this.urlConfigs.AMM_V3 || API_URLS.AMM_V3);
    return res.data;
  }

  async getAmmV3Configs(): Promise<Record<string, ApiAmmV3ConfigInfo>> {
    const res = await this.api.get(this.urlConfigs.AMM_V3_CONFIG || API_URLS.AMM_V3_CONFIG);
    return res.data;
  }

  async getAmmV3PoolLines(poolId: string): Promise<{ price: string; liquidity: string }[]> {
    const res = await this.api.get(`${this.urlConfigs.AMM_V3_LINES || API_URLS.AMM_V3_LINES}?pool_id=${poolId}`);
    return res.data;
  }

  async getCoingeckoPrice(coingeckoIds: string[]): Promise<Record<string, { usd?: number }>> {
    return this.api.get(`${API_URLS.COINGECKO}?ids=${coingeckoIds.join(",")}&vs_currencies=usd`);
  }

  async getRaydiumTokenPrice(): Promise<Record<string, number>> {
    return this.api.get(this.urlConfigs.PRICE || API_URLS.PRICE);
  }

  async getIdoList(): Promise<{ data: ApiIdoItem[]; success: boolean }> {
    return this.api.get(this.urlConfigs.IDO_INFO || API_URLS.IDO_INFO);
  }

  async getIdoInfo(id: string): Promise<ApiIdoInfo> {
    return this.api.get((this.urlConfigs.IDO_PROJECT_INFO || API_URLS.IDO_PROJECT_INFO) + id);
  }

  async getBlockSlotCountForSecond(endpointUrl?: string): Promise<number> {
    if (!endpointUrl) return 2;
    const res: {
      id: string;
      jsonrpc: string;
      result: { numSlots: number; numTransactions: number; samplePeriodSecs: number; slot: number }[];
    } = await this.api.post(endpointUrl, {
      id: "getRecentPerformanceSamples",
      jsonrpc: "2.0",
      method: "getRecentPerformanceSamples",
      params: [4],
    });
    const slotList = res.result.map((data) => data.numSlots);
    return slotList.reduce((a, b) => a + b, 0) / slotList.length / 60;
  }

  async getChainTimeOffset(): Promise<{ chainTime: number; offset: number }> {
    return this.api.get(this.urlConfigs.CHAIN_TIME || API_URLS.CHAIN_TIME);
  }

  async getRpcs(): Promise<{
    rpcs: { batch: boolean; name: string; url: string; weight: number }[];
    strategy: string;
  }> {
    return this.api.get(this.urlConfigs.RPCS || API_URLS.RPCS);
  }
}
