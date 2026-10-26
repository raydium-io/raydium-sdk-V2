import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { Fraction, Percent, Price, Token, TokenAmount } from "../module";
import { ReplaceType } from "../raydium/type";

import { tryParsePublicKey } from "./pubKey";

export function getTimestamp(): number {
  return new Date().getTime();
}

export function notInnerObject(v: unknown): v is Record<string, any> {
  return (
    typeof v === "object" &&
    v !== null &&
    // the entries are classes, and `typeof Klass` is "function", never
    // "object" — guarding the instanceof check on it made the check always
    // false, so instances were treated as plain objects and dismantled by
    // jsonInfo2PoolKeys into `{ _bn: { words, … } }` shells
    ![Token, TokenAmount, PublicKey, Fraction, BN, Price, Percent].some((o) => v instanceof o)
  );
}

export function jsonInfo2PoolKeys<T>(jsonInfo: T): ReplaceType<T, string, PublicKey> {
  // @ts-expect-error no need type for inner code
  return typeof jsonInfo === "string"
    ? tryParsePublicKey(jsonInfo)
    : Array.isArray(jsonInfo)
    ? jsonInfo.map((k) => jsonInfo2PoolKeys(k))
    : notInnerObject(jsonInfo)
    ? Object.fromEntries(Object.entries(jsonInfo).map(([k, v]) => [k, jsonInfo2PoolKeys(v)]))
    : jsonInfo;
}
