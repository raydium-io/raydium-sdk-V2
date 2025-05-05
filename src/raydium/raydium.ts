import { Connection, Keypair, PublicKey, EpochInfo, Commitment } from "@solana/web3.js";
import { merge } from "lodash";

import { Api, API_URL_CONFIG, ApiV3TokenRes, ApiV3Token, JupTokenType, AvailabilityCheckAPI3 } from "../api";
import { EMPTY_CONNECTION, EMPTY_OWNER } from "../common/error";
import { createLogger, Logger } from "../common/logger";
import { Owner } from "../common/owner";
import { Cluster } from "../solana";

import Account, { TokenAccountDataProp } from "./account/account";
import Farm from "./farm/farm";
import Liquidity from "./liquidity/liquidity";
import { Clmm } from "./clmm";
import Cpmm from "./cpmm/cpmm";
import TradeV2 from "./tradeV2/trade";
import Utils1216 from "./utils1216";
import MarketV2 from "./marketV2";
import Ido from "./ido";
import Launchpad from "./launchpad/launchpad";

import TokenModule from "./token/token";
import { SignAllTransactions } from "./type";

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
  jupTokenType?: JupTokenType;
  disableFeatureCheck?: boolean;
  disableLoadToken?: boolean;
  blockhashCommitment?: Commitment;
  loopMultiTxStatus?: boolean;
}

export interface RaydiumApiBatchRequestParams {
  api: Api;
  defaultChainTimeOffset?: number;
  defaultChainTime?: number;
}

export type RaydiumConstructorParams = Required<RaydiumLoadParams> & RaydiumApiBatchRequestParams;

interface DataBase<T> {
  fetched: number;
  data: T;
  extInfo?: Record<string, any>;
}
interface ApiData {
  tokens?: DataBase<ApiV3Token[]>;

  // v3 data
  tokenList?: DataBase<ApiV3TokenRes>;
  jupTokenList?: DataBase<ApiV3Token[]>;
}

export class Raydium {
  public cluster: Cluster;
  public farm: Farm;
  public account: Account;
  public liquidity: Liquidity;
  public clmm: Clmm;
  public cpmm: Cpmm;
  public tradeV2: TradeV2;
  public utils1216: Utils1216;
  public marketV2: MarketV2;
  public ido: Ido;
  public token: TokenModule;
  public launchpad: Launchpad;
  public rawBalances: Map<string, string> = new Map();
  public apiData: ApiData;
  public availability: Partial<AvailabilityCheckAPI3>;
  public blockhashCommitment: Commitment;
  public loopMultiTxStatus?: boolean;

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
      defaultChainTime,
      defaultChainTimeOffset,
      apiCacheTime,
      blockhashCommitment = "confirmed",
      loopMultiTxStatus,
    } = config;

    this._connection = connection;
    this.cluster = cluster || "mainnet";
    this._owner = owner ? new Owner(owner) : undefined;
    this._signAllTransactions = config.signAllTransactions;
    this.blockhashCommitment = blockhashCommitment;
    this.loopMultiTxStatus = loopMultiTxStatus;

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
    this.liquidity = new Liquidity({ scope: this, moduleName: "Raydium_LiquidityV2" });
    this.token = new TokenModule({ scope: this, moduleName: "Raydium_tokenV2" });
    this.tradeV2 = new TradeV2({ scope: this, moduleName: "Raydium_tradeV2" });
    this.clmm = new Clmm({ scope: this, moduleName: "Raydium_clmm" });
    this.cpmm = new Cpmm({ scope: this, moduleName: "Raydium_cpmm" });
    this.utils1216 = new Utils1216({ scope: this, moduleName: "Raydium_utils1216" });
    this.marketV2 = new MarketV2({ scope: this, moduleName: "Raydium_marketV2" });
    this.ido = new Ido({ scope: this, moduleName: "Raydium_ido" });
    this.launchpad = new Launchpad({ scope: this, moduleName: "Raydium_lauchpad" });

    this.availability = {};
    const now = new Date().getTime();
    this.apiData = {};

    if (defaultChainTimeOffset)
      this._chainTime = {
        fetched: now,
        value: {
          chainTime: defaultChainTime || Date.now() - defaultChainTimeOffset,
          offset: defaultChainTimeOffset,
        },
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
    const { cluster, apiRequestTimeout, logCount, logRequests, urlConfigs } = custom;

    const api = new Api({ cluster, timeout: apiRequestTimeout, urlConfigs, logCount, logRequests });
    const raydium = new Raydium({
      ...custom,
      api,
    });

    await raydium.fetchAvailabilityStatus(config.disableFeatureCheck ?? true);
    if (!config.disableLoadToken)
      await raydium.token.load({
        type: config.jupTokenType,
      });

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
    this.account.resetTokenAccounts();
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
      console.error(EMPTY_OWNER);
      throw new Error(EMPTY_OWNER);
    }
  }

  private isCacheInvalidate(time: number): boolean {
    return new Date().getTime() - time > this._apiCacheTime;
  }

  public async fetchChainTime(): Promise<void> {
    try {
      const data = await this.api.getChainTimeOffset();
      this._chainTime = {
        fetched: Date.now(),
        value: {
          chainTime: Date.now() + data.offset * 1000,
          offset: data.offset * 1000,
        },
      };
    } catch {
      this._chainTime = undefined;
    }
  }

  public async fetchV3TokenList(forceUpdate?: boolean): Promise<ApiV3TokenRes> {
    if (this.apiData.tokenList && !this.isCacheInvalidate(this.apiData.tokenList.fetched) && !forceUpdate)
      return this.apiData.tokenList.data;
    try {
      const raydiumList = await this.api.getTokenList();
      const dataObject = {
        fetched: Date.now(),
        data: raydiumList,
      };
      this.apiData.tokenList = dataObject;

      return dataObject.data;
    } catch (e) {
      console.error(e);
      return {
        mintList: [],
        blacklist: [],
        whiteList: [],
      };
    }
  }

  public async fetchJupTokenList(forceUpdate?: boolean): Promise<ApiV3Token[]> {
    const prevFetched = this.apiData.jupTokenList;
    if (prevFetched && !this.isCacheInvalidate(prevFetched.fetched) && !forceUpdate) return prevFetched.data;
    try {
      const jupList = await this.api.getJupTokenList();

      this.apiData.jupTokenList = {
        fetched: Date.now(),
        data: jupList.map((t) => ({
          ...t,
          mintAuthority: t.mint_authority || undefined,
          freezeAuthority: t.freeze_authority || undefined,
        })),
      };

      return this.apiData.jupTokenList.data;
    } catch (e) {
      console.error(e);
      return [];
    }
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

  public async fetchAvailabilityStatus(skipCheck?: boolean): Promise<Partial<AvailabilityCheckAPI3>> {
    if (skipCheck) return {};
    try {
      const data = await this.api.fetchAvailabilityStatus();
      const isAllDisabled = data.all === false;
      this.availability = {
        all: data.all,
        swap: isAllDisabled ? false : data.swap,
        createConcentratedPosition: isAllDisabled ? false : data.createConcentratedPosition,
        addConcentratedPosition: isAllDisabled ? false : data.addConcentratedPosition,
        addStandardPosition: isAllDisabled ? false : data.addStandardPosition,
        removeConcentratedPosition: isAllDisabled ? false : data.removeConcentratedPosition,
        removeStandardPosition: isAllDisabled ? false : data.removeStandardPosition,
        addFarm: isAllDisabled ? false : data.addFarm,
        removeFarm: isAllDisabled ? false : data.removeFarm,
      };
      return data;
    } catch {
      return {};
    }
  }
}
