import BN from "bn.js"
import Decimal from "decimal.js"
import { Q128, U128_MAX } from "./constants"

export function mask(bits: number): BN {
  return new BN(1).shln(bits).subn(1)
}

export function mulFull(a: BN, b: BN): [BN, BN] {
  const result = a.mul(b)
  const low = result.and(mask(128))
  const high = result.shrn(128)
  return [low, high]
}

export function mulDivFloor(a: BN, b: BN, denominator: BN): BN {
  if (denominator.isZero()) {
    throw new Error("Division by zero")
  }
  return a.mul(b).div(denominator)
}

export function mulDivCeil(a: BN, b: BN, denominator: BN): BN {
  if (denominator.isZero()) {
    throw new Error("Division by zero")
  }
  const product = a.mul(b)
  const quotient = product.div(denominator)
  const remainder = product.mod(denominator)

  if (remainder.isZero()) {
    return quotient
  }
  return quotient.addn(1)
}

export function mulDivRound(a: BN, b: BN, denominator: BN, roundUp: boolean): BN {
  return roundUp ? mulDivCeil(a, b, denominator) : mulDivFloor(a, b, denominator)
}

export function u128SaturatingAdd(a: BN, b: BN): BN {
  const result = a.add(b)
  return result.gt(U128_MAX) ? U128_MAX : result
}

export function u128SaturatingSub(a: BN, b: BN): BN {
  return a.gt(b) ? a.sub(b) : new BN(0)
}

export function u128CheckedMul(a: BN, b: BN): BN {
  const result = a.mul(b)
  if (result.gt(U128_MAX)) {
    throw new Error("U128 multiplication overflow")
  }
  return result
}

export const U256_MAX = new BN(1).shln(256).subn(1)

export function u256MulDivFloor(a: BN, b: BN, denominator: BN): BN {
  if (denominator.isZero()) {
    throw new Error("Division by zero")
  }
  return a.mul(b).div(denominator)
}

export function u256MulDivCeil(a: BN, b: BN, denominator: BN): BN {
  if (denominator.isZero()) {
    throw new Error("Division by zero")
  }
  const product = a.mul(b)
  const quotient = product.div(denominator)
  const remainder = product.mod(denominator)

  if (remainder.isZero()) {
    return quotient
  }
  return quotient.addn(1)
}

export function mostSignificantBit(n: BN): number {
  if (n.isZero()) {
    return -1
  }
  return n.bitLength() - 1
}

export function leastSignificantBit(n: BN): number {
  if (n.isZero()) {
    return -1
  }

  let pos = 0
  let temp = n.clone()

  while (temp.and(new BN(1)).isZero()) {
    temp = temp.shrn(1)
    pos++
  }

  return pos
}

export function isBitSet(n: BN, bit: number): boolean {
  return n.testn(bit)
}

export function setBit(n: BN, bit: number): BN {
  return n.or(new BN(1).shln(bit))
}

export function clearBit(n: BN, bit: number): BN {
  return n.and(new BN(1).shln(bit).notn(256))
}

export function toggleBit(n: BN, bit: number): BN {
  return n.xor(new BN(1).shln(bit))
}

export function toSignedI128(n: BN): BN {
  const signBit = new BN(1).shln(127)
  if (n.and(signBit).isZero()) {
    return n
  }
  return n.sub(new BN(1).shln(128))
}

export function fromSignedI128(n: BN): BN {
  if (n.isNeg()) {
    return n.add(new BN(1).shln(128))
  }
  return n
}

export function abs(n: BN): BN {
  return n.isNeg() ? n.neg() : n
}

export function x64ToDecimal(num: BN, decimalPlaces?: number): Decimal {
  return new Decimal(num.toString()).div(Decimal.pow(2, 64)).toDecimalPlaces(decimalPlaces)
}

export function decimalToX64(num: Decimal): BN {
  return new BN(num.mul(Decimal.pow(2, 64)).floor().toFixed())
}

export function wrappingSubU128(n0: BN, n1: BN): BN {
  return n0.add(Q128).sub(n1).mod(Q128)
}
