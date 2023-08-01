import { PublicKey, Connection } from "@solana/web3.js";
import { Token, TokenAmount, Price } from "../../module";
import { SplToken } from "../token_old/type";
import { GetMultipleAccountsInfoConfig } from "../../common/accountInfo";
import { BigNumberish } from "../../common/bignumber";
import { IdoStateLayoutV3, IdoLedgerLayoutV3, SnapshotStateLayoutV1 } from "./layout";
import { ApiIdoItem, ApiIdoInfo } from "../../api/type";
import BN from "bn.js";
import Decimal from "decimal.js-light";

export interface SdkIdoInfo extends ApiIdoItem {
  base?: SplToken;
  quote?: SplToken;
  state?: IdoStateLayoutV3;
  ledger?: IdoLedgerLayoutV3;
  snapshot?: SnapshotStateLayoutV1;
}
export type SnapshotVersion = 1;
export type IdoVersion = 3;

export interface IdoPoolConfig {
  id: PublicKey;

  version: IdoVersion;
  programId: PublicKey;

  snapshotVersion: SnapshotVersion;
  snapshotProgramId: PublicKey;

  authority: PublicKey;
  seedId: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  baseToken: Token;
  quoteToken: Token;
}

export interface IdoUserKeys {
  baseTokenAccount: PublicKey;
  quoteTokenAccount: PublicKey;
  ledgerAccount: PublicKey;
  snapshotAccount: PublicKey;
  owner: PublicKey;
}

export interface IdoInfo {
  state?: IdoStateLayoutV3;
  ledger?: IdoLedgerLayoutV3;
  snapshot?: SnapshotStateLayoutV1;
}

export interface IdoLoadParams {
  connection: Connection;
  poolConfig: IdoPoolConfig;
  owner: PublicKey;
  info?: IdoInfo;
  config?: GetMultipleAccountsInfoConfig;
}

/* ================= purchase ================= */
export interface IdoPurchaseInstructionParams {
  poolConfig: IdoPoolConfig;
  userKeys: IdoUserKeys;
  amount: BigNumberish;
}

/* ================= claim ================= */
export interface IdoClaimInstructionParams {
  poolConfig: IdoPoolConfig;
  userKeys: IdoUserKeys;
  side: "base" | "quote";
}

export interface GetIdoInfoParams {
  poolConfig: IdoPoolConfig;
  config?: GetMultipleAccountsInfoConfig;
}

export interface GetIdoMultipleInfoParams extends Omit<GetIdoInfoParams, "poolConfig"> {
  noNeedState?: boolean;
  poolsConfig: IdoPoolConfig[];
}

export type TicketInfo = { no: number; isWinning?: boolean };
export type TicketTailNumberInfo = {
  no: number | string;
  isPartial?: boolean;
};

export interface HydratedIdoInfo extends SdkIdoInfo, ApiIdoItem, Partial<ApiIdoInfo> {
  // privously is
  isUpcoming: boolean;
  isOpen: boolean;
  isClosed: boolean;
  canWithdrawBase: boolean;

  filled?: string;
  totalRaise?: TokenAmount;

  /* coin init price when market open */
  coinPrice?: Price;

  /* how much usdc each ticket */
  ticketPrice?: TokenAmount;

  depositedTicketCount?: number;

  /** only have connection */
  isEligible?: boolean;

  /** only have connection */
  userEligibleTicketAmount?: BN;

  claimableQuote?: TokenAmount;
  winningTickets?: TicketInfo[];
  userAllocation?: Decimal;
  depositedTickets?: TicketInfo[];

  winningTicketsTailNumber?: {
    tickets: TicketTailNumberInfo[];
    isWinning: /* not roll */ 0 | /* not win */ 1 | /* is win */ 2 | /* all win */ 3;
  };
}
