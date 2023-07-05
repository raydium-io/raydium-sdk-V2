import { EpochInfo, Connection, PublicKey } from "@solana/web3.js";
import { TransferFeeConfig, TransferFee, getTransferFeeConfig, unpackMint } from "@solana/spl-token";
import BN from "bn.js";
import { getMultipleAccountsInfoWithCustomFlags } from "./accountInfo";

import { GetTransferAmountFee, ReturnTypeFetchMultipleMintInfos } from "../raydium/type";

const POINT = 10_000;
export function getTransferAmountFee(
  amount: BN,
  feeConfig: TransferFeeConfig | undefined,
  epochInfo: EpochInfo,
  addFee: boolean,
): GetTransferAmountFee {
  if (feeConfig === undefined) {
    return {
      amount,
      fee: undefined,
      expirationTime: undefined,
    };
  }

  const nowFeeConfig: TransferFee =
    epochInfo.epoch < feeConfig.newerTransferFee.epoch ? feeConfig.olderTransferFee : feeConfig.newerTransferFee;
  const maxFee = new BN(nowFeeConfig.maximumFee.toString());
  const expirationTime: number | undefined =
    epochInfo.epoch < feeConfig.newerTransferFee.epoch
      ? ((Number(feeConfig.newerTransferFee.epoch) * epochInfo.slotsInEpoch - epochInfo.absoluteSlot) * 400) / 1000
      : undefined;

  if (addFee) {
    const _TAmount = BNDivCeil(amount.mul(new BN(POINT)), new BN(POINT - nowFeeConfig.transferFeeBasisPoints));

    const nowMaxFee = new BN(nowFeeConfig.maximumFee.toString());
    const TAmount = _TAmount.sub(amount).gt(nowMaxFee) ? amount.add(nowMaxFee) : _TAmount;

    const _fee = BNDivCeil(TAmount.mul(new BN(nowFeeConfig.transferFeeBasisPoints)), new BN(POINT));
    const fee = _fee.gt(maxFee) ? maxFee : _fee;
    return {
      amount: TAmount,
      fee,
      expirationTime,
    };
  } else {
    const _fee = BNDivCeil(amount.mul(new BN(nowFeeConfig.transferFeeBasisPoints)), new BN(POINT));
    const fee = _fee.gt(maxFee) ? maxFee : _fee;

    return {
      amount,
      fee,
      expirationTime,
    };
  }
}

export function minExpirationTime(
  expirationTime1: number | undefined,
  expirationTime2: number | undefined,
): number | undefined {
  if (expirationTime1 === undefined) return expirationTime2;
  if (expirationTime2 === undefined) return expirationTime1;

  return Math.min(expirationTime1, expirationTime2);
}

export async function fetchMultipleMintInfos({
  connection,
  mints,
}: {
  connection: Connection;
  mints: PublicKey[];
}): Promise<ReturnTypeFetchMultipleMintInfos> {
  if (mints.length === 0) return {};
  const mintInfos = await getMultipleAccountsInfoWithCustomFlags(
    connection,
    mints.map((i) => ({ pubkey: i })),
  );

  const mintK: ReturnTypeFetchMultipleMintInfos = {};
  for (const i of mintInfos) {
    const t = unpackMint(i.pubkey, i.accountInfo, i.accountInfo?.owner);
    mintK[i.pubkey.toString()] = {
      ...t,
      feeConfig: getTransferFeeConfig(t) ?? undefined,
    };
  }

  return mintK;
}

export function BNDivCeil(bn1: BN, bn2: BN): BN {
  const { div, mod } = bn1.divmod(bn2);

  if (mod.gt(new BN(0))) {
    return div.add(new BN(1));
  } else {
    return div;
  }
}
