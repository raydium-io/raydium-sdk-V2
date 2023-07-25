import { Connection, Keypair, PublicKey, EpochInfo } from "@solana/web3.js";
import BN from "bn.js";
import { merge } from "lodash";

import {
  Api,
  API_URL_CONFIG,
  ApiFarmPools,
  ApiJsonPairInfo,
  ApiLiquidityPools,
  ApiTokens,
  ApiAmmV3PoolInfo,
  ApiIdoItem,
  ApiV3TokenRes,
  ApiV3Token,
  ApiV3PoolInfoItem,
} from "../api";
import { EMPTY_CONNECTION, EMPTY_OWNER } from "../common/error";
import { createLogger, Logger } from "../common/logger";
import { Owner } from "../common/owner";
import { PublicKeyish, WSOLMint, SOLMint } from "../common/pubKey";
import { TokenAmount } from "../module/amount";
import { Token } from "../module/token";
import { Cluster } from "../solana";

import Account, { TokenAccountDataProp } from "./account/account";
import Farm from "./farm/farm";
import Liquidity from "./liquidity/liquidity";
import TokenModule, { MintToTokenAmount } from "./token/token";
import { AmmV3 } from "./ammV3";
import TradeV2 from "./tradeV2/trade";
import Utils1216 from "./utils1216";
import MarketV2 from "./marketV2";
// import Ido from "./ido/ido";

import TokenV2 from "./tokenV2/token";
import { SignAllTransactions, TransferAmountFee } from "./type";

export interface RaydiumLoadParams extends TokenAccountDataProp, Omit<RaydiumApiBatchRequestParams, "api"> {
  /* ================= solana ================= */
  // solana web3 connection
  connection: Connection;
  // solana cluster/network/env
  cluster?: Cluster;
  // user public key
  owner?: PublicKey | Keypair;
  /* ================= api ================= */
  // api request interval in ms, -1 means never request again, 0 means always use fresh data, default is 5 mins (5 * 60 * 1000)
  apiRequestInterval?: number;
  // api request timeout in ms, default is 10 secs (10 * 1000)
  apiRequestTimeout?: number;
  apiCacheTime?: number;
  signAllTransactions?: SignAllTransactions;
  urlConfigs?: API_URL_CONFIG;
  logRequests?: boolean;
  logCount?: number;
  prefetchLiquidity?: boolean;
}

export interface RaydiumApiBatchRequestParams {
  api: Api;
  defaultChainTimeOffset?: number;
  defaultChainTime?: number;
  defaultApiTokens?: ApiTokens;
  defaultApiLiquidityPools?: ApiLiquidityPools;
  defaultApiFarmPools?: ApiFarmPools;
  defaultApiPairsInfo?: ApiJsonPairInfo[];
  defaultApiAmmV3PoolsInfo?: ApiAmmV3PoolInfo[];
  defaultApiIdoList?: ApiIdoItem[];
}

export type RaydiumConstructorParams = Required<RaydiumLoadParams> & RaydiumApiBatchRequestParams;

interface DataBase<T> {
  fetched: number;
  data: T;
}
interface ApiData {
  tokens?: DataBase<ApiTokens>;
  liquidityPools?: DataBase<ApiLiquidityPools>;
  liquidityPairsInfo?: DataBase<ApiJsonPairInfo[]>;
  farmPools?: DataBase<ApiFarmPools>;
  ammV3Pools?: DataBase<ApiAmmV3PoolInfo[]>;
  idoList?: DataBase<ApiIdoItem[]>;

  // v3 data
  tokenList?: { fetched: number; data: ApiV3TokenRes & { jup: ApiV3Token[] } };
  liquidityPoolList?: { fetched: number; data: ApiV3PoolInfoItem[] };
}

const apiCacheData: ApiData = {};
export class Raydium {
  public cluster: Cluster;
  public farm: Farm;
  public account: Account;
  public liquidity: Liquidity;
  public ammV3: AmmV3;
  // public token: TokenModule;
  public tradeV2: TradeV2;
  public utils1216: Utils1216;
  public marketV2: MarketV2;
  // public ido: Ido;
  public token: TokenV2;
  public rawBalances: Map<string, string> = new Map();
  public apiData: ApiData;

  private _connection: Connection;
  private _owner: Owner | undefined;
  public api: Api;
  private _apiCacheTime: number;
  private _signAllTransactions?: SignAllTransactions;
  private logger: Logger;
  private _chainTime?: {
    fetched: number;
    value: {
      chainTime: number;
      offset: number;
    };
  };
  private _epochInfo?: {
    fetched: number;
    value: EpochInfo;
  };

  constructor(config: RaydiumConstructorParams) {
    const {
      connection,
      cluster,
      owner,
      api,
      defaultApiTokens,
      defaultApiLiquidityPools,
      defaultApiFarmPools,
      defaultApiPairsInfo,
      defaultApiAmmV3PoolsInfo,
      defaultApiIdoList,
      defaultChainTime,
      defaultChainTimeOffset,
      apiCacheTime,
    } = config;

    this._connection = connection;
    this.cluster = cluster;
    this._owner = owner ? new Owner(owner) : undefined;
    this._signAllTransactions = config.signAllTransactions;

    this.api = api;
    this._apiCacheTime = apiCacheTime || 5 * 60 * 1000;
    this.logger = createLogger("Raydium");
    this.farm = new Farm({ scope: this, moduleName: "Raydium_Farm" });
    this.account = new Account({
      scope: this,
      moduleName: "Raydium_Account",
      tokenAccounts: config.tokenAccounts,
      tokenAccountRawInfos: config.tokenAccountRawInfos,
    });
    this.liquidity = new Liquidity({ scope: this, moduleName: "Raydium_Liquidity" });
    // this.token = new Token({ scope: this, moduleName: "Raydium_token" });
    this.token = new TokenV2({ scope: this, moduleName: "Raydium_tokenV2" });
    this.tradeV2 = new TradeV2({ scope: this, moduleName: "Raydium_tradeV2" });
    this.ammV3 = new AmmV3({ scope: this, moduleName: "Raydium_ammV3" });
    this.utils1216 = new Utils1216({ scope: this, moduleName: "Raydium_utils1216" });
    this.marketV2 = new MarketV2({ scope: this, moduleName: "Raydium_marketV2" });
    // this.ido = new Ido({ scope: this, moduleName: "Raydium_ido" });

    const now = new Date().getTime();

    const [
      apiTokensCache,
      apiLiquidityPoolsCache,
      apiFarmPoolsCache,
      apiLiquidityPairsInfoCache,
      apiAmmV3PoolsCache,
      apiIdoListCache,
    ] = [
      defaultApiTokens ? { fetched: now, data: defaultApiTokens } : apiCacheData.tokens,
      defaultApiLiquidityPools ? { fetched: now, data: defaultApiLiquidityPools } : apiCacheData.liquidityPools,
      defaultApiFarmPools ? { fetched: now, data: defaultApiFarmPools } : apiCacheData.farmPools,
      defaultApiPairsInfo ? { fetched: now, data: defaultApiPairsInfo } : apiCacheData.liquidityPairsInfo,
      defaultApiAmmV3PoolsInfo ? { fetched: now, data: defaultApiAmmV3PoolsInfo } : apiCacheData.ammV3Pools,
      defaultApiIdoList ? { fetched: now, data: defaultApiIdoList } : apiCacheData.idoList,
    ];
    if (defaultChainTimeOffset)
      this._chainTime = {
        fetched: now,
        value: {
          chainTime: defaultChainTime || Date.now() + defaultChainTimeOffset,
          offset: defaultChainTimeOffset,
        },
      };

    this.apiData = {
      ...(apiTokensCache ? { tokens: apiTokensCache } : {}),
      ...(apiLiquidityPoolsCache ? { liquidityPools: apiLiquidityPoolsCache } : {}),
      ...(apiFarmPoolsCache ? { farmPools: apiFarmPoolsCache } : {}),
      ...(apiLiquidityPairsInfoCache ? { liquidityPairsInfo: apiLiquidityPairsInfoCache } : {}),
      ...(apiAmmV3PoolsCache ? { ammV3Pools: apiAmmV3PoolsCache } : {}),
      ...(apiIdoListCache ? { idoList: apiIdoListCache } : {}),
    };
  }

  static async load(config: RaydiumLoadParams): Promise<Raydium> {
    const custom: Required<RaydiumLoadParams> = merge(
      // default
      {
        cluster: "mainnet",
        owner: null,
        apiRequestInterval: 5 * 60 * 1000,
        apiRequestTimeout: 10 * 1000,
      },
      config,
    );
    const { cluster, apiRequestTimeout, logCount, logRequests, urlConfigs, prefetchLiquidity = false } = custom;

    const api = new Api({ cluster, timeout: apiRequestTimeout, urlConfigs, logCount, logRequests });
    const raydium = new Raydium({
      ...custom,
      api,
    });

    await raydium.token.load();
    // if (prefetchLiquidity) await raydium.liquidity.load();

    return raydium;
  }

  get owner(): Owner | undefined {
    return this._owner;
  }
  get ownerPubKey(): PublicKey {
    if (!this._owner) throw new Error(EMPTY_OWNER);
    return this._owner.publicKey;
  }
  public setOwner(owner?: PublicKey | Keypair): Raydium {
    this._owner = owner ? new Owner(owner) : undefined;
    return this;
  }
  get connection(): Connection {
    if (!this._connection) throw new Error(EMPTY_CONNECTION);
    return this._connection;
  }
  public setConnection(connection: Connection): Raydium {
    this._connection = connection;
    return this;
  }
  get signAllTransactions(): SignAllTransactions | undefined {
    return this._signAllTransactions;
  }
  public setSignAllTransactions(signAllTransactions?: SignAllTransactions): Raydium {
    this._signAllTransactions = signAllTransactions;
    return this;
  }

  public checkOwner(): void {
    if (!this.owner) {
      this.logger.error(EMPTY_OWNER);
      throw new Error(EMPTY_OWNER);
    }
  }

  private isCacheInvalidate(time: number): boolean {
    return new Date().getTime() - time > this._apiCacheTime;
  }

  public async fetchTokens(forceUpdate?: boolean): Promise<ApiTokens> {
    if (this.apiData.tokens && !this.isCacheInvalidate(this.apiData.tokens.fetched) && !forceUpdate)
      return this.apiData.tokens.data;
    const dataObject = {
      fetched: Date.now(),
      data: await this.api.getTokens(),
      xx: 1,
    };
    this.apiData.tokens = dataObject;
    apiCacheData.tokens = dataObject;

    return dataObject.data;
  }

  public async fetchLiquidity(forceUpdate?: boolean): Promise<ApiLiquidityPools> {
    if (this.apiData.liquidityPools && !this.isCacheInvalidate(this.apiData.liquidityPools.fetched) && !forceUpdate)
      return this.apiData.liquidityPools.data;
    const dataObject = {
      fetched: Date.now(),
      data: await this.api.getLiquidityPools(),
    };
    this.apiData.liquidityPools = dataObject;
    apiCacheData.liquidityPools = dataObject;
    return dataObject.data;
  }

  public async fetchPairs(forceUpdate?: boolean): Promise<ApiJsonPairInfo[]> {
    if (
      this.apiData.liquidityPairsInfo &&
      !this.isCacheInvalidate(this.apiData.liquidityPairsInfo.fetched) &&
      !forceUpdate
    )
      return this.apiData.liquidityPairsInfo?.data || [];
    const dataObject = {
      fetched: Date.now(),
      data: await this.api.getPairsInfo(),
    };
    this.apiData.liquidityPairsInfo = dataObject;
    apiCacheData.liquidityPairsInfo = dataObject;
    return dataObject.data;
  }

  public async fetchFarms(forceUpdate?: boolean): Promise<ApiFarmPools> {
    if (this.apiData.farmPools && !this.isCacheInvalidate(this.apiData.farmPools.fetched) && !forceUpdate)
      return this.apiData.farmPools.data;

    const dataObject = {
      fetched: Date.now(),
      data: await this.api.getFarmPools(),
    };
    this.apiData.farmPools = dataObject;
    apiCacheData.farmPools = dataObject;

    return dataObject.data;
  }

  public async fetchAmmV3Pools(forceUpdate?: boolean): Promise<ApiAmmV3PoolInfo[]> {
    if (this.apiData.ammV3Pools && !this.isCacheInvalidate(this.apiData.ammV3Pools.fetched) && !forceUpdate)
      return this.apiData.ammV3Pools.data;

    const dataObject = {
      fetched: Date.now(),
      data: await this.api.getConcentratedPools(),
    };
    this.apiData.ammV3Pools = dataObject;
    apiCacheData.ammV3Pools = dataObject;

    return dataObject.data;
  }

  public async fetchChainTime(): Promise<void> {
    try {
      const data = await this.api.getChainTimeOffset();
      this._chainTime = {
        fetched: Date.now(),
        value: {
          chainTime: data.chainTime * 1000,
          offset: data.offset * 1000,
        },
      };
    } catch {
      this._chainTime = undefined;
    }
  }

  public async fetchIdoList(forceUpdate?: boolean): Promise<ApiIdoItem[]> {
    if (this.apiData.idoList && !this.isCacheInvalidate(this.apiData.idoList.fetched) && !forceUpdate)
      return this.apiData.idoList.data;

    const dataObject = {
      fetched: Date.now(),
      data: (await this.api.getIdoList()).data,
    };
    this.apiData.idoList = dataObject;
    apiCacheData.idoList = dataObject;
    return dataObject.data;
  }

  public async fetchV3TokenList(forceUpdate?: boolean): Promise<ApiV3TokenRes & { jup: ApiV3Token[] }> {
    if (this.apiData.tokenList && !this.isCacheInvalidate(this.apiData.tokenList.fetched) && !forceUpdate)
      return this.apiData.tokenList.data;
    const raydiumList = await this.api.getTokenList();
    const jupList = await this.api.getJupTokenList();
    const dataObject = {
      fetched: Date.now(),
      data: { ...raydiumList, jup: jupList },
    };
    this.apiData.tokenList = dataObject;
    apiCacheData.tokenList = dataObject;

    return dataObject.data;
  }

  public async fetchV3LiquidityPoolList(forceUpdate?: boolean): Promise<ApiV3PoolInfoItem[]> {
    if (
      this.apiData.liquidityPoolList &&
      !this.isCacheInvalidate(this.apiData.liquidityPoolList.fetched) &&
      !forceUpdate
    )
      return this.apiData.liquidityPoolList.data;
    const data = await this.api.getPoolList();
    const dataObject = {
      fetched: Date.now(),
      data,
    };
    this.apiData.liquidityPoolList = dataObject;
    apiCacheData.liquidityPoolList = dataObject;

    return dataObject.data;
  }

  get chainTimeData(): { offset: number; chainTime: number } | undefined {
    return this._chainTime?.value;
  }

  public async chainTimeOffset(): Promise<number> {
    if (this._chainTime && Date.now() - this._chainTime.fetched <= 1000 * 60 * 5) return this._chainTime.value.offset;
    await this.fetchChainTime();
    return this._chainTime?.value.offset || 0;
  }

  public async currentBlockChainTime(): Promise<number> {
    if (this._chainTime && Date.now() - this._chainTime.fetched <= 1000 * 60 * 5)
      return this._chainTime.value.chainTime;
    await this.fetchChainTime();
    return this._chainTime?.value.chainTime || Date.now();
  }

  public async fetchEpochInfo(): Promise<EpochInfo> {
    if (this._epochInfo && Date.now() - this._epochInfo.fetched <= 1000 * 30) return this._epochInfo.value;
    this._epochInfo = {
      fetched: Date.now(),
      value: await this.connection.getEpochInfo(),
    };
    return this._epochInfo.value;
  }

  public mintToToken(mint: PublicKeyish): Token {
    return this.token.mintToToken(mint);
  }
  public mintToTokenAmount(params: MintToTokenAmount): TokenAmount {
    return this.token.mintToTokenAmount(params);
  }
  // export interface TransferAmountFee {amount: TokenAmount | CurrencyAmount, fee: TokenAmount | CurrencyAmount | undefined, expirationTime: number | undefined}
  public solToWsolTokenAmount(tokenAmount: TokenAmount): TokenAmount {
    if (!tokenAmount.token.mint.equals(SOLMint)) return tokenAmount;
    return this.token.mintToTokenAmount({
      mint: WSOLMint,
      amount: tokenAmount.toExact(),
    });
  }
  public solToWsolTransferAmountFee(tokenAmountFee: TransferAmountFee): TransferAmountFee {
    if (!tokenAmountFee.amount.token.mint.equals(SOLMint)) return tokenAmountFee;
    return {
      amount: this.token.mintToTokenAmount({
        mint: WSOLMint,
        amount: tokenAmountFee.amount.toExact(),
      }),
      fee: tokenAmountFee.fee
        ? this.token.mintToTokenAmount({
            mint: WSOLMint,
            amount: tokenAmountFee.fee.toExact(),
          })
        : tokenAmountFee.fee,
      expirationTime: tokenAmountFee.expirationTime,
    };
  }
  public decimalAmount(params: MintToTokenAmount): BN {
    return this.token.decimalAmount(params);
  }
  public uiAmount(params: MintToTokenAmount): string {
    return this.token.uiAmount(params);
  }
}
