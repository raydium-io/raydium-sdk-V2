import BN from "bn.js";
import { RoundDirection, TradingTokenResult } from "./calculator";

function checkedRem(dividend: BN, divisor: BN): BN {
  if (divisor.isZero()) throw Error("divisor is zero");

  const result = dividend.mod(divisor);
  return result;
}

function checkedCeilDiv(dividend: BN, rhs: BN): BN[] {
  if (rhs.isZero()) throw Error("rhs is zero");

  let quotient = dividend.div(rhs);

  const remainder = checkedRem(dividend, rhs);

  if (remainder.gt(ZERO)) {
    quotient = quotient.add(new BN(1));
  }
  return [quotient, rhs];
}

const ZERO = new BN(0);

export class ConstantProductCurve {
  static swapBaseInputWithoutFees(inputAmount: BN, inputVaultAmount: BN, onputVaultAmount: BN): BN {
    const numerator = inputAmount.mul(onputVaultAmount);
    const denominator = inputVaultAmount.add(inputAmount);

    const outputAmount = numerator.div(denominator);
    return outputAmount;
  }

  static swapBaseOutputWithoutFees(outputAmount: BN, inputVaultAmount: BN, onputVaultAmount: BN): BN {
    const numerator = inputVaultAmount.mul(outputAmount);
    const denominator = onputVaultAmount.sub(outputAmount);
    const [inputAmount] = checkedCeilDiv(numerator, denominator);

    return inputAmount;
  }

  static lpTokensToTradingTokens(
    lpTokenAmount: BN,
    lpTokenSupply: BN,
    swapTokenAmount0: BN,
    swapTokenAmount1: BN,
    roundDirection: RoundDirection,
  ): TradingTokenResult {
    let tokenAmount0 = lpTokenAmount.mul(swapTokenAmount0).div(lpTokenSupply);
    let tokenAmount1 = lpTokenAmount.mul(swapTokenAmount1).div(lpTokenSupply);

    if (roundDirection === RoundDirection.Floor) {
      return { tokenAmount0, tokenAmount1 };
    } else if (roundDirection === RoundDirection.Ceiling) {
      const tokenRemainder0 = checkedRem(lpTokenAmount.mul(swapTokenAmount0), lpTokenSupply);

      if (tokenRemainder0.gt(ZERO) && tokenAmount0.gt(ZERO)) {
        tokenAmount0 = tokenAmount0.add(new BN(1));
      }

      const token1Remainder = checkedRem(lpTokenAmount.mul(swapTokenAmount1), lpTokenSupply);

      if (token1Remainder.gt(ZERO) && tokenAmount1.gt(ZERO)) {
        tokenAmount1 = tokenAmount1.add(new BN(1));
      }

      return { tokenAmount0, tokenAmount1 };
    }
    throw Error("roundDirection value error");
  }
}
