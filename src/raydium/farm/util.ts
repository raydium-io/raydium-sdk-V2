import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { RewardInfoV6 } from "../../api/type";
import { parseBigNumberish } from "../../common";
import { GetMultipleAccountsInfoConfig, getMultipleAccountsInfoWithCustomFlags } from "../../common/accountInfo";
import { DateParam, isDateAfter, isDateBefore } from "../../common/date";
import { createLogger } from "../../common/logger";
import { findProgramAddress, ProgramAddress } from "../../common/txTool/txUtils";
import { jsonInfo2PoolKeys } from "../../common/utility";

import { splAccountLayout } from "../account/layout";
import { SplAccount } from "../account/types";
import { FARM_VERSION_TO_LEDGER_LAYOUT, FARM_VERSION_TO_STATE_LAYOUT, poolTypeV6 } from "./config";
import { FarmLedger, FarmLedgerLayout, FarmState, FarmStateLayout } from "./layout";
import { FarmRewardInfo, FarmRewardInfoConfig } from "./type";

import { Voter, VoterRegistrar } from "./layout";

const logger = createLogger("Raydium.farm.util");
interface AssociatedLedgerPoolAccount {
  programId: PublicKey;
  poolId: PublicKey;
  mint: PublicKey;
  type: "lpVault" | "rewardVault";
}

export function getAssociatedLedgerPoolAccount({
  programId,
  poolId,
  mint,
  type,
}: AssociatedLedgerPoolAccount): PublicKey {
  const { publicKey } = findProgramAddress(
    [
      poolId.toBuffer(),
      mint.toBuffer(),
      Buffer.from(
        type === "lpVault" ? "lp_vault_associated_seed" : type === "rewardVault" ? "reward_vault_associated_seed" : "",
        "utf-8",
      ),
    ],
    programId,
  );
  return publicKey;
}

export function getAssociatedLedgerAccount({
  programId,
  poolId,
  owner,
  version,
}: {
  programId: PublicKey;
  poolId: PublicKey;
  owner: PublicKey;
  version: 6 | 5 | 3;
}): PublicKey {
  const { publicKey } = findProgramAddress(
    [
      poolId.toBuffer(),
      owner.toBuffer(),
      Buffer.from(version === 6 ? "farmer_info_associated_seed" : "staker_info_v2_associated_seed", "utf-8"),
    ],
    programId,
  );
  return publicKey;
}

export const getAssociatedAuthority = ({
  programId,
  poolId,
}: {
  programId: PublicKey;
  poolId: PublicKey;
}): ProgramAddress => findProgramAddress([poolId.toBuffer()], programId);

export function farmRewardInfoToConfig(data: FarmRewardInfo): FarmRewardInfoConfig {
  return {
    isSet: new BN(1),
    rewardPerSecond: parseBigNumberish(data.perSecond),
    rewardOpenTime: parseBigNumberish(data.openTime),
    rewardEndTime: parseBigNumberish(data.endTime),
    rewardType: parseBigNumberish(poolTypeV6[data.rewardType]),
  };
}

export function calFarmRewardAmount(data: Pick<RewardInfoV6, "openTime" | "endTime"> & { perSecond: string }): BN {
  return parseBigNumberish(data.endTime).sub(parseBigNumberish(data.openTime)).mul(parseBigNumberish(data.perSecond));
}

export function getFarmLedgerLayout(version: number): FarmLedgerLayout | undefined {
  const ledgerLayout = FARM_VERSION_TO_LEDGER_LAYOUT[version];
  if (!ledgerLayout) logger.logWithError("invalid version", version);
  return ledgerLayout;
}

export function getFarmStateLayout(version: number): FarmStateLayout | undefined {
  const stateLayout = FARM_VERSION_TO_STATE_LAYOUT[version];
  if (!stateLayout) logger.logWithError("invalid version", version);
  return stateLayout;
}

export function updateFarmPoolInfo(
  poolInfo: FarmState,
  lpVault: SplAccount,
  slot: number,
  chainTime: number,
): FarmState {
  if (poolInfo.version === 3 || poolInfo.version === 5) {
    if (poolInfo.lastSlot.gte(new BN(slot))) return poolInfo;

    const spread = new BN(slot).sub(poolInfo.lastSlot);
    poolInfo.lastSlot = new BN(slot);

    for (const itemRewardInfo of poolInfo.rewardInfos) {
      if (lpVault.amount.eq(new BN(0))) continue;

      const reward = itemRewardInfo.perSlotReward.mul(spread);
      itemRewardInfo.perShareReward = itemRewardInfo.perShareReward.add(
        reward.mul(new BN(10).pow(new BN(poolInfo.version === 3 ? 9 : 15))).div(lpVault.amount),
      );
      itemRewardInfo.totalReward = itemRewardInfo.totalReward.add(reward);
    }
  } else if (poolInfo.version === 6) {
    for (const itemRewardInfo of poolInfo.rewardInfos) {
      if (itemRewardInfo.rewardState.eq(new BN(0))) continue;
      const updateTime = BN.min(new BN(chainTime), itemRewardInfo.rewardEndTime);
      if (itemRewardInfo.rewardOpenTime.gte(updateTime)) continue;
      const spread = updateTime.sub(itemRewardInfo.rewardLastUpdateTime);
      let reward = spread.mul(itemRewardInfo.rewardPerSecond);
      const leftReward = itemRewardInfo.totalReward.sub(itemRewardInfo.totalRewardEmissioned);
      if (leftReward.lt(reward)) {
        reward = leftReward;
        itemRewardInfo.rewardLastUpdateTime = itemRewardInfo.rewardLastUpdateTime.add(
          leftReward.div(itemRewardInfo.rewardPerSecond),
        );
      } else {
        itemRewardInfo.rewardLastUpdateTime = updateTime;
      }
      if (lpVault.amount.eq(new BN(0))) continue;
      itemRewardInfo.accRewardPerShare = itemRewardInfo.accRewardPerShare.add(
        reward.mul(poolInfo.rewardMultiplier).div(lpVault.amount),
      );
      itemRewardInfo.totalRewardEmissioned = itemRewardInfo.totalRewardEmissioned.add(reward);
    }
  }
  return poolInfo;
}

interface FarmPoolsInfo {
  [id: string]: {
    state: FarmState;
    lpVault: SplAccount;
    ledger?: FarmLedger;
    wrapped?: { pendingRewards: BN[] };
  };
}

export interface FarmFetchMultipleInfoParams {
  connection: Connection;
  farmPools: any[];
  owner?: PublicKey;
  config?: GetMultipleAccountsInfoConfig;
  chainTime: number;
}

export async function fetchMultipleFarmInfoAndUpdate({
  connection,
  farmPools,
  owner,
  config,
  chainTime,
}: FarmFetchMultipleInfoParams): Promise<FarmPoolsInfo> {
  let hasNotV6Pool = false;
  let hasV6Pool = false;
  const tenBN = new BN(10);

  const publicKeys: {
    pubkey: PublicKey;
    version: number;
    key: "state" | "lpVault" | "ledger";
    poolId: PublicKey;
  }[] = [];

  for (const poolInfo of farmPools) {
    const pool = jsonInfo2PoolKeys(poolInfo);
    if (pool.version === 6) hasV6Pool = true;
    else hasNotV6Pool = true;

    publicKeys.push(
      {
        pubkey: pool.id,
        version: pool.version,
        key: "state",
        poolId: pool.id,
      },
      {
        pubkey: pool.lpVault,
        version: pool.version,
        key: "lpVault",
        poolId: pool.id,
      },
    );

    if (owner) {
      publicKeys.push({
        pubkey: getAssociatedLedgerAccount({
          programId: pool.programId,
          poolId: pool.id,
          owner,
          version: poolInfo.version as 6 | 5 | 3,
        }),
        version: pool.version,
        key: "ledger",
        poolId: pool.id,
      });
    }
  }

  const poolsInfo: FarmPoolsInfo = {};
  const accountsInfo = await getMultipleAccountsInfoWithCustomFlags(connection, publicKeys, config);
  for (const { pubkey, version, key, poolId, accountInfo } of accountsInfo) {
    const _poolId = poolId.toBase58();
    poolsInfo[_poolId] = { ...poolsInfo[_poolId] };
    if (key === "state") {
      const stateLayout = getFarmStateLayout(version);
      if (!accountInfo || !accountInfo.data || accountInfo.data.length !== stateLayout!.span)
        logger.logWithError(`invalid farm state account info, pools.id, ${pubkey}`);
      poolsInfo[_poolId].state = stateLayout!.decode(accountInfo!.data);
    } else if (key === "lpVault") {
      if (!accountInfo || !accountInfo.data || accountInfo.data.length !== splAccountLayout.span)
        logger.logWithError(`invalid farm lp vault account info, pools.lpVault, ${pubkey}`);
      poolsInfo[_poolId].lpVault = splAccountLayout.decode(accountInfo!.data);
    } else if (key === "ledger") {
      const legerLayout = getFarmLedgerLayout(version)!;
      if (accountInfo && accountInfo.data) {
        if (accountInfo.data.length !== legerLayout.span)
          logger.logWithError(`invalid farm ledger account info, ledger, ${pubkey}`);
        poolsInfo[_poolId].ledger = legerLayout.decode(accountInfo.data);
      }
    }
  }

  const slot = hasV6Pool || hasNotV6Pool ? await connection.getSlot() : 0;

  for (const poolId of Object.keys(poolsInfo)) {
    if (poolsInfo[poolId] === undefined) continue;
    poolsInfo[poolId].state = updateFarmPoolInfo(poolsInfo[poolId].state, poolsInfo[poolId].lpVault, slot, chainTime);
  }

  for (const [poolId, { state, ledger }] of Object.entries(poolsInfo)) {
    if (ledger) {
      const multiplier =
        state.version === 6
          ? state.rewardMultiplier
          : state.rewardInfos.length === 1
            ? tenBN.pow(new BN(9))
            : tenBN.pow(new BN(15));

      const pendingRewards = state.rewardInfos.map((rewardInfo, index) => {
        const rewardDebt = ledger.rewardDebts[index];
        const pendingReward = ledger.deposited
          .mul(state.version === 6 ? rewardInfo.accRewardPerShare : rewardInfo.perShareReward)
          .div(multiplier)
          .sub(rewardDebt);

        return pendingReward;
      });

      poolsInfo[poolId].wrapped = {
        ...poolsInfo[poolId].wrapped,
        pendingRewards,
      };
    }
  }

  return poolsInfo;
}
/** deprecated */
export function judgeFarmType(
  info: any,
  currentTime: DateParam = Date.now(),
): "closed pool" | "normal fusion pool" | "dual fusion pool" | undefined | "upcoming pool" {
  if (info.version === 6) {
    const rewardInfos = info.state.rewardInfos;
    if (rewardInfos.every(({ rewardOpenTime }) => isDateBefore(currentTime, rewardOpenTime.toNumber(), { unit: "s" })))
      return "upcoming pool";
    if (rewardInfos.every(({ rewardEndTime }) => isDateAfter(currentTime, rewardEndTime.toNumber(), { unit: "s" })))
      return "closed pool";
  } else {
    const perSlotRewards = info.state.rewardInfos.map(({ perSlotReward }) => perSlotReward);
    if (perSlotRewards.length === 2) {
      // v5
      if (String(perSlotRewards[0]) === "0" && String(perSlotRewards[1]) !== "0") {
        return "normal fusion pool"; // reward xxx token
      }
      if (String(perSlotRewards[0]) !== "0" && String(perSlotRewards[1]) !== "0") {
        return "dual fusion pool"; // reward ray and xxx token
      }
      if (String(perSlotRewards[0]) === "0" && String(perSlotRewards[1]) === "0") {
        return "closed pool";
      }
    } else if (perSlotRewards.length === 1) {
      // v3
      if (String(perSlotRewards[0]) === "0") {
        return "closed pool";
      }
    }
  }
}

export async function getDepositEntryIndex(
  connection: Connection,
  registrar: PublicKey,
  voter: PublicKey,
  voterMint: PublicKey,
): Promise<{ index: number; isInit: boolean }> {
  const registrarAccountData = await connection.getAccountInfo(registrar);
  if (registrarAccountData === null) throw Error("registrar info check error");
  const registrarData = VoterRegistrar.decode(registrarAccountData.data);

  const votingMintConfigIndex = registrarData.votingMints.findIndex((i) => i.mint.equals(voterMint));

  if (votingMintConfigIndex === -1) throw Error("find voter mint error");

  const voterAccountData = await connection.getAccountInfo(voter);
  if (voterAccountData === null) return { index: votingMintConfigIndex, isInit: false }; // throw Error('voter info check error')

  const voterData = Voter.decode(voterAccountData.data);

  const depositEntryIndex = voterData.deposits.findIndex(
    (i) => i.isUsed && i.votingMintConfigIdx === votingMintConfigIndex,
  );
  if (depositEntryIndex === -1) return { index: votingMintConfigIndex, isInit: false };
  else return { index: depositEntryIndex, isInit: true };
}
