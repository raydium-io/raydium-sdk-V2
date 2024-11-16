import { PublicKey } from "@solana/web3.js";

import { ApiV3Token } from "../../api/type";
import { createLogger } from "../../common/logger";
import { FARM_PROGRAM_ID_V3, FARM_PROGRAM_ID_V4, FARM_PROGRAM_ID_V5, FARM_PROGRAM_ID_V6 } from "../../common/programId";

import {
  FarmLedgerLayout,
  farmLedgerLayoutV3_2,
  farmLedgerLayoutV5_2,
  farmLedgerLayoutV6_1,
  FarmStateLayout,
  farmStateV3Layout,
  farmStateV5Layout,
  farmStateV6Layout,
} from "./layout";

const logger = createLogger("Raydium_farm_config");

export type FarmVersion = 3 | 4 | 5 | 6;
export const FARM_LOCK_MINT = new PublicKey("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R");
export const FARM_LOCK_VAULT = new PublicKey("FrspKwj8i3pNmKwXreTveC4fu7KL5ZbGeXdZBe2XViu1");

/* ================= index ================= */
// version => farm state layout
export const FARM_VERSION_TO_STATE_LAYOUT: {
  [version in FarmVersion]?: FarmStateLayout;
} = {
  3: farmStateV3Layout,
  5: farmStateV5Layout,
  6: farmStateV6Layout,
};

// version => farm ledger layout
export const FARM_VERSION_TO_LEDGER_LAYOUT: {
  [version in FarmVersion]?: FarmLedgerLayout;
} = {
  3: farmLedgerLayoutV3_2,
  5: farmLedgerLayoutV5_2,
  6: farmLedgerLayoutV6_1,
};

export const isValidFarmVersion = (version: number): boolean => [3, 4, 5, 6].indexOf(version) !== -1;

export const validateFarmRewards = (params: {
  version: number;
  rewardInfos: { mint: ApiV3Token }[];
  rewardTokenAccountsPublicKeys: PublicKey[];
}): (() => string | undefined) => {
  const { version, rewardInfos, rewardTokenAccountsPublicKeys } = params;

  const infoMsg = `rewardInfo:${JSON.stringify(rewardInfos)}, rewardAccount:${JSON.stringify(
    rewardTokenAccountsPublicKeys,
  )}`;

  const validator = {
    3: (): string | undefined => {
      if (rewardInfos.length !== 1 || rewardTokenAccountsPublicKeys.length !== 1) {
        return `rewardInfos or rewardTokenAccounts lengths not equal 1: ${infoMsg}`;
      }
    },
    5: (): string | undefined => {
      if (rewardInfos.length !== rewardTokenAccountsPublicKeys.length) {
        return `rewardInfos and rewardTokenAccounts lengths not equal: ${infoMsg}`;
      }
    },
    6: (): string | undefined => {
      if (!rewardTokenAccountsPublicKeys.length || rewardInfos.length !== rewardTokenAccountsPublicKeys.length) {
        return `no rewardTokenAccounts or rewardInfos and rewardTokenAccounts lengths not equal: ${infoMsg}`;
      }
    },
  };

  return validator[version]?.();
};

export const poolTypeV6 = { "Standard SPL": 0, "Option tokens": 1 };

export const FARM_PROGRAM_TO_VERSION: Record<string, 3 | 4 | 5 | 6> = {
  [FARM_PROGRAM_ID_V3.toString()]: 3,
  [FARM_PROGRAM_ID_V4.toString()]: 4,
  [FARM_PROGRAM_ID_V5.toString()]: 5,
  [FARM_PROGRAM_ID_V6.toString()]: 6,
};
