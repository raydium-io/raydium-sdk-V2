import { EpochInfo } from "@solana/web3.js";
import BN from "bn.js";
import { TransferFee, TransferFeeConfig } from "@solana/spl-token";

import { TransferFeeDataBaseType } from "../api/type";
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
    if (nowFeeConfig.transferFeeBasisPoints === POINT) {
      const nowMaxFee = new BN(nowFeeConfig.maximumFee.toString());
      return {
        amount: amount.add(nowMaxFee),
        fee: nowMaxFee,
        expirationTime,
      };
    } else {
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
    }
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

export function getTransferAmountFeeV2(
  amount: BN,
  _feeConfig: TransferFeeDataBaseType | undefined,
  epochInfo: EpochInfo,
  addFee: boolean,
): GetTransferAmountFee {
  if (_feeConfig === undefined) {
    return {
      amount,
      fee: undefined,
      expirationTime: undefined,
    };
  }
  const feeConfig = {
    ..._feeConfig,
    olderTransferFee: {
      epoch: BigInt(_feeConfig.olderTransferFee.epoch),
      maximumFee: BigInt(_feeConfig.olderTransferFee.maximumFee),
      transferFeeBasisPoints: _feeConfig.olderTransferFee.transferFeeBasisPoints,
    },
    newerTransferFee: {
      epoch: BigInt(_feeConfig.newerTransferFee.epoch),
      maximumFee: BigInt(_feeConfig.newerTransferFee.maximumFee),
      transferFeeBasisPoints: _feeConfig.newerTransferFee.transferFeeBasisPoints,
    },
  };

  const nowFeeConfig: TransferFee =
    epochInfo.epoch < feeConfig.newerTransferFee.epoch ? feeConfig.olderTransferFee : feeConfig.newerTransferFee;
  const maxFee = new BN(nowFeeConfig.maximumFee.toString());
  const expirationTime: number | undefined =
    epochInfo.epoch < feeConfig.newerTransferFee.epoch
      ? ((Number(feeConfig.newerTransferFee.epoch) * epochInfo.slotsInEpoch - epochInfo.absoluteSlot) * 400) / 1000
      : undefined;

  if (addFee) {
    if (nowFeeConfig.transferFeeBasisPoints === POINT) {
      const nowMaxFee = new BN(nowFeeConfig.maximumFee.toString());
      return {
        amount: amount.add(nowMaxFee),
        fee: nowMaxFee,
        expirationTime,
      };
    } else {
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
    }
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

export function BNDivCeil(bn1: BN, bn2: BN): BN {
  const { div, mod } = bn1.divmod(bn2);

  if (mod.gt(new BN(0))) {
    return div.add(new BN(1));
  } else {
    return div;
  }
}

export function ceilDivBN(amountA: BN, amountB: BN): BN {
  if (amountA.isZero()) return new BN(0);

  const quotient = amountA.div(amountB);

  if (quotient.isZero()) return new BN(1);

  const remainder = amountA.mod(amountB);
  if (remainder.gt(new BN(0))) {
    return quotient.add(new BN(1));
  }
  return quotient;
}
