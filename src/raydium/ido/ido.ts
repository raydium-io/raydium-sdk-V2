import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { ApiIdoItem } from "../../api/type";
import { getAssociatedLedgerAccountAddress, getAssociatedSnapshotAddress } from "./pda";
import { getDepositedTickets, isTicketWin, getWinningTickets, getWinningTicketsTailNumbers } from "./utils";
import { getIdoStateLayout, getIdoLedgerLayout, getSnapshotStateLayout } from "./layout";
import { GetIdoMultipleInfoParams, IdoInfo, IdoPoolConfig, SdkIdoInfo, HydratedIdoInfo } from "./type";
import { tryParsePublicKey } from "../../common/pubKey";
import { isMeaningfulNumber } from "../../common/fractionUtil";
import { toTokenPrice } from "../../common/bignumber";
import { getMultipleAccountsInfoWithCustomFlags } from "../../common/accountInfo";
import { Percent } from "../../module/percent";

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js-light";

export default class Ido extends ModuleBase {
  private _idoList: ApiIdoItem[] = [];
  private _idoMap: Map<string, ApiIdoItem> = new Map();
  private _idoSDKList: SdkIdoInfo[] = [];
  private _idoSDKMap: Map<string, SdkIdoInfo> = new Map();
  private _hydratedIdoList: HydratedIdoInfo[] = [];
  private _hydratedIdoMap: Map<string, HydratedIdoInfo> = new Map();

  constructor(params: ModuleBaseProps) {
    super(params);
  }

  get idoData(): {
    list: ApiIdoItem[];
    map: Map<string, ApiIdoItem>;
    sdkList: SdkIdoInfo[];
    sdkMap: Map<string, SdkIdoInfo>;
    hydratedList: HydratedIdoInfo[];
  } {
    return {
      list: this._idoList,
      map: this._idoMap,
      sdkList: this._idoSDKList,
      sdkMap: this._idoSDKMap,
      hydratedList: this._hydratedIdoList,
    };
  }

  public async load(): Promise<void> {
    await this.scope.fetchIdoList();
    this._idoList = this.scope.apiData.idoList?.data || [];
    this._idoMap = new Map(this._idoList.map((ido) => [ido.id, ido]));
    await this.loadIdoSdkInfo();

    const currentBlockChainDate = await this.scope.currentBlockChainTime();
    this._hydratedIdoList = this._idoSDKList.map((ido) => this.hydrateIdoInfo(currentBlockChainDate, ido));
    this._hydratedIdoMap = new Map(this._hydratedIdoList.map((info) => [info.id, info]));
  }

  public async loadIdoSdkInfo(): Promise<SdkIdoInfo[]> {
    const toPub = (key: string): PublicKey => tryParsePublicKey(key) as PublicKey;
    const idoKeyInfos: IdoPoolConfig[] = this._idoList.map((info) => ({
      ...info,
      id: toPub(info.id),
      baseMint: toPub(info.baseMint),
      baseVault: toPub(info.baseVault),
      quoteMint: toPub(info.quoteMint),
      quoteVault: toPub(info.quoteVault),
      programId: toPub(info.programId),
      authority: toPub(info.authority),
      snapshotProgramId: toPub(info.snapshotProgramId),
      seedId: toPub(info.seedId),
      baseToken: this.scope.mintToToken(info.baseMint)!,
      quoteToken: this.scope.mintToToken(info.quoteMint)!,
    }));

    const sdkIdoInfoMap = await this.getMultipleInfo({ poolsConfig: idoKeyInfos });
    this._idoSDKList = Object.keys(sdkIdoInfoMap)
      .map((key) => {
        const info = sdkIdoInfoMap[key];
        const rawInfo = this._idoMap.get(key);
        if (!rawInfo) return undefined;
        return {
          ...info,
          ...rawInfo,
          base: this.scope.token.allTokenMap.get(rawInfo.baseMint),
          quote: this.scope.token.allTokenMap.get(rawInfo.quoteMint),
        };
      })
      .filter((info) => info !== undefined) as SdkIdoInfo[];
    this._idoSDKMap = new Map(this._idoSDKList.map((info) => [info.id, info]));

    return this._idoSDKList;
  }

  public hydrateIdoInfo(currentBlockChainDate: number, idoInfo: SdkIdoInfo): HydratedIdoInfo {
    const thousandBN = new BN(1000);
    const updatedIdoInfo = Object.assign({ ...idoInfo } as SdkIdoInfo, {
      maxWinLotteries: idoInfo.state?.maxWinLotteries.toNumber(),
      startTime: idoInfo.state?.startTime.mul(thousandBN).toNumber(),
      endTime: idoInfo.state?.endTime.mul(thousandBN).toNumber(),
      startWithdrawTime: idoInfo.state?.startWithdrawTime.mul(thousandBN).toNumber(),
      raise: idoInfo.state?.baseSupply
        ? new Decimal(idoInfo.state.baseSupply.toString()).div(10 ** idoInfo.baseDecimals).toNumber()
        : undefined,
    });
    const isUpcoming = currentBlockChainDate < updatedIdoInfo.startTime;
    const isOpen = currentBlockChainDate > updatedIdoInfo.startTime && currentBlockChainDate < updatedIdoInfo.endTime;
    const isClosed = currentBlockChainDate > updatedIdoInfo.endTime;
    const canWithdrawBase = currentBlockChainDate > updatedIdoInfo.startWithdrawTime;

    const depositedTickets = getDepositedTickets(updatedIdoInfo).map((ticketInfo) => ({
      ...ticketInfo,
      isWinning: isTicketWin(ticketInfo.no, updatedIdoInfo),
    }));
    const winningTickets = getWinningTickets(updatedIdoInfo);
    const userEligibleTicketAmount = updatedIdoInfo.snapshot?.maxLotteries;

    const isEligible = userEligibleTicketAmount == null ? undefined : isMeaningfulNumber(userEligibleTicketAmount);

    const totalRaise =
      updatedIdoInfo.base &&
      this.scope.mintToTokenAmount({
        mint: updatedIdoInfo.baseMint,
        amount: updatedIdoInfo.raise,
        decimalDone: true,
      });

    const coinPrice =
      updatedIdoInfo.base &&
      updatedIdoInfo.state &&
      toTokenPrice({
        token: updatedIdoInfo.base!,
        numberPrice: updatedIdoInfo.price,
        decimalDone: true,
      });

    const ticketPrice =
      updatedIdoInfo.quote &&
      updatedIdoInfo.state &&
      this.scope.mintToTokenAmount({
        mint: updatedIdoInfo.quoteMint,
        amount: updatedIdoInfo.state.perLotteryQuoteAmount,
      });
    const depositedTicketCount = updatedIdoInfo.state && updatedIdoInfo.state.raisedLotteries.toNumber();

    const userAllocation =
      updatedIdoInfo.state &&
      depositedTicketCount &&
      new Decimal(winningTickets?.length || 0)
        .div(Math.min(updatedIdoInfo.state.maxWinLotteries.toNumber(), depositedTicketCount))
        .mul(totalRaise?.toExact() || 0);

    const claimableQuote =
      (isClosed &&
        updatedIdoInfo.ledger &&
        updatedIdoInfo.ledger.quoteWithdrawn.isZero() &&
        updatedIdoInfo.quote &&
        this.scope.mintToTokenAmount({
          mint: updatedIdoInfo.quoteMint,
          amount: updatedIdoInfo.ledger.quoteDeposited,
        })) ||
      undefined;

    const filled = updatedIdoInfo.state // SDK
      ? new Percent(updatedIdoInfo.state.raisedLotteries, updatedIdoInfo.state.maxWinLotteries).toFixed()
      : updatedIdoInfo.raisedLotteries && updatedIdoInfo.maxWinLotteries // API
      ? updatedIdoInfo.raisedLotteries / updatedIdoInfo.maxWinLotteries
      : undefined;

    return {
      ...updatedIdoInfo,
      winningTicketsTailNumber: getWinningTicketsTailNumbers(updatedIdoInfo),
      winningTickets,
      depositedTickets,
      userAllocation,
      depositedTicketCount,

      isUpcoming,
      isOpen,
      isClosed,
      canWithdrawBase,

      totalRaise,
      coinPrice,
      ticketPrice,

      filled,

      claimableQuote,
      userEligibleTicketAmount,
      isEligible,
    } as HydratedIdoInfo;
  }

  public async getMultipleInfo({
    poolsConfig,
    noNeedState,
    config,
  }: GetIdoMultipleInfoParams): Promise<{ [key: string]: IdoInfo }> {
    const publicKeys: {
      pubkey: PublicKey;
      version: number;
      key: "state" | /*  pool info  */ "ledger" | /* user info */ "snapshot" /*  user info maxEligibleTickets */;
      poolId: PublicKey;
    }[] = [];

    for (const poolConfig of poolsConfig) {
      if (!noNeedState) {
        publicKeys.push({
          pubkey: poolConfig.id,
          version: poolConfig.version,
          key: "state",
          poolId: poolConfig.id,
        });
      }

      if (this.scope.owner) {
        publicKeys.push({
          pubkey: getAssociatedLedgerAccountAddress({
            programId: poolConfig.programId,
            poolId: poolConfig.id,
            owner: this.scope.owner.publicKey,
          }),
          version: poolConfig.version,
          key: "ledger",
          poolId: poolConfig.id,
        });

        publicKeys.push({
          pubkey: getAssociatedSnapshotAddress({
            programId: poolConfig.snapshotProgramId,
            seedId: poolConfig.seedId,
            owner: this.scope.owner.publicKey,
          }),
          version: poolConfig.snapshotVersion,
          key: "snapshot",
          poolId: poolConfig.id,
        });
      }
    }

    const info: { [key: string]: IdoInfo } = {};

    const accountsInfo = await getMultipleAccountsInfoWithCustomFlags(this.scope.connection, publicKeys, config);
    for (const { pubkey, version, key, poolId, accountInfo } of accountsInfo) {
      if (key === "state") {
        const STATE_LAYOUT = getIdoStateLayout(version);
        if (!accountInfo || accountInfo.data.length !== STATE_LAYOUT.span) {
          this.logAndCreateError("invalid ido state account info", "pools.id", pubkey.toBase58());
        }

        info[poolId.toBase58()] = {
          ...info[poolId.toBase58()],
          ...{ state: STATE_LAYOUT.decode(accountInfo!.data) },
        };
      } else if (key === "ledger") {
        const LEDGER_LAYOUT = getIdoLedgerLayout(version);
        if (accountInfo && accountInfo.data) {
          if (accountInfo.data.length !== LEDGER_LAYOUT.span) {
            this.logAndCreateError("invalid ido ledger account info", "ledger", pubkey.toBase58());
          }

          info[poolId.toBase58()] = {
            ...info[poolId.toBase58()],
            ...{ ledger: LEDGER_LAYOUT.decode(accountInfo.data) },
          };
        }
      } else if (key === "snapshot") {
        const SNAPSHOT_STATE_LAYOUT = getSnapshotStateLayout(version);
        if (accountInfo && accountInfo.data) {
          if (accountInfo.data.length !== SNAPSHOT_STATE_LAYOUT.span) {
            this.logAndCreateError("invalid ido snapshot account info", "snapshot", pubkey.toBase58());
          }

          const decodeResult = SNAPSHOT_STATE_LAYOUT.decode(accountInfo.data);
          info[poolId.toBase58()] = {
            ...info[poolId.toBase58()],
            ...{ snapshot: decodeResult },
          };
        }
      }
    }

    return info;
  }
}
