import { EpochInfo } from "@solana/web3.js";
import { TransferFeeConfig, TransferFee } from "@solana/spl-token";
import BN from "bn.js";

import { GetTransferAmountFee } from "../raydium/type";

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
    const TAmount = amount.div(new BN(POINT - nowFeeConfig.transferFeeBasisPoints));

    const _fee = TAmount.mul(new BN(nowFeeConfig.transferFeeBasisPoints)).div(new BN(POINT));
    const fee = _fee.gt(maxFee) ? maxFee : _fee;
    return {
      amount: TAmount,
      fee,
      expirationTime,
    };
  } else {
    const _fee = amount.mul(new BN(nowFeeConfig.transferFeeBasisPoints)).div(new BN(POINT));
    const fee = _fee.gt(maxFee) ? maxFee : _fee;

    return {
      amount: amount.sub(fee),
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
