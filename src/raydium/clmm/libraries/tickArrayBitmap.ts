import { ApiV3PoolInfoConcentratedItem } from "@/api";
import { getMultipleAccountsInfo } from "@/common";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PoolInfoLayout, TickArrayBitmapExtensionLayout, TickArrayLayout, TickLayout } from "../layout";
import { ClmmPoolInfo } from "../type";
import { clearBit, isBitSet, leastSignificantBit, mostSignificantBit, setBit } from "./bigNum";
import { MAX_TICK, MIN_TICK, TICK_ARRAY_BITMAP_SIZE, TICK_ARRAY_SIZE } from "./constants";
import { getPdaTickArrayAddress } from "./pda";
import {
  getSqrtPriceAtTick,
  getTickArrayStartIndex,
  getTickAtSqrtPrice,
  priceToSqrtPriceX64,
  sqrtPriceX64ToPrice,
} from "./tickMath";

export const POOL_BITMAP_POSITIVE_ARRAYS = 8;
export const POOL_BITMAP_NEGATIVE_ARRAYS = 8;
export const EXTENSION_BITMAP_ARRAYS = 14;

export function getTickArrayOffsetIndex(tickArrayStartIndex: number, tickSpacing: number): number {
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE;
  return Math.floor(tickArrayStartIndex / ticksPerArray);
}

export function getBitmapPosition(
  tickArrayStartIndex: number,
  tickSpacing: number,
): { wordIndex: number; bitIndex: number; isPositive: boolean } {
  const offsetIndex = getTickArrayOffsetIndex(tickArrayStartIndex, tickSpacing);
  const isPositive = offsetIndex >= 0;

  const absOffset = Math.abs(offsetIndex);

  if (isPositive) {
    return {
      wordIndex: Math.floor(absOffset / 64),
      bitIndex: absOffset % 64,
      isPositive: true,
    };
  } else {
    const negIndex = -offsetIndex - 1;
    return {
      wordIndex: Math.floor(negIndex / 64),
      bitIndex: negIndex % 64,
      isPositive: false,
    };
  }
}

export function isTickArrayInitialized(bitmap: BN[], tickArrayStartIndex: number, tickSpacing: number): boolean {
  const { wordIndex, bitIndex, isPositive } = getBitmapPosition(tickArrayStartIndex, tickSpacing);

  if (wordIndex >= bitmap.length) {
    return false;
  }

  return isBitSet(bitmap[wordIndex], bitIndex);
}

export function setTickArrayInitialized(bitmap: BN[], tickArrayStartIndex: number, tickSpacing: number): BN[] {
  const { wordIndex, bitIndex } = getBitmapPosition(tickArrayStartIndex, tickSpacing);

  if (wordIndex >= bitmap.length) {
    throw new Error("Tick array index out of bitmap range");
  }

  const newBitmap = [...bitmap];
  newBitmap[wordIndex] = setBit(bitmap[wordIndex], bitIndex);
  return newBitmap;
}

export function clearTickArrayInitialized(bitmap: BN[], tickArrayStartIndex: number, tickSpacing: number): BN[] {
  const { wordIndex, bitIndex } = getBitmapPosition(tickArrayStartIndex, tickSpacing);

  if (wordIndex >= bitmap.length) {
    throw new Error("Tick array index out of bitmap range");
  }

  const newBitmap = [...bitmap];
  newBitmap[wordIndex] = clearBit(bitmap[wordIndex], bitIndex);
  return newBitmap;
}

export function nextInitializedTickArrayStartIndex(
  positiveBitmap: BN[],
  negativeBitmap: BN[],
  tickArrayStartIndex: number,
  tickSpacing: number,
  zeroForOne: boolean,
): { found: boolean; startIndex: number } {
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE;
  const currentOffset = getTickArrayOffsetIndex(tickArrayStartIndex, tickSpacing);

  if (zeroForOne) {
    return searchNegativeDirection(positiveBitmap, negativeBitmap, currentOffset, ticksPerArray);
  } else {
    return searchPositiveDirection(positiveBitmap, negativeBitmap, currentOffset, ticksPerArray);
  }
}

function searchNegativeDirection(
  positiveBitmap: BN[],
  negativeBitmap: BN[],
  startOffset: number,
  ticksPerArray: number,
): { found: boolean; startIndex: number } {
  let searchOffset = startOffset - 1;

  if (searchOffset >= 0) {
    const result = searchBitmapBackward(positiveBitmap, searchOffset);
    if (result.found) {
      return { found: true, startIndex: result.offset * ticksPerArray };
    }
    searchOffset = -1;
  }

  const negIndex = -searchOffset - 1;
  const result = searchBitmapForward(negativeBitmap, negIndex);
  if (result.found) {
    return { found: true, startIndex: -(result.offset + 1) * ticksPerArray };
  }

  return { found: false, startIndex: 0 };
}

function searchPositiveDirection(
  positiveBitmap: BN[],
  negativeBitmap: BN[],
  startOffset: number,
  ticksPerArray: number,
): { found: boolean; startIndex: number } {
  let searchOffset = startOffset + 1;

  if (searchOffset < 0) {
    const negIndex = -searchOffset - 1;
    const result = searchBitmapBackward(negativeBitmap, negIndex);
    if (result.found) {
      return { found: true, startIndex: -(result.offset + 1) * ticksPerArray };
    }
    searchOffset = 0;
  }

  const result = searchBitmapForward(positiveBitmap, searchOffset);
  if (result.found) {
    return { found: true, startIndex: result.offset * ticksPerArray };
  }

  return { found: false, startIndex: 0 };
}

function searchBitmapForward(bitmap: BN[], startOffset: number): { found: boolean; offset: number } {
  const startWord = Math.floor(startOffset / 64);
  const startBit = startOffset % 64;

  for (let wordIndex = startWord; wordIndex < bitmap.length; wordIndex++) {
    const word = bitmap[wordIndex];
    if (word.isZero()) continue;

    let masked = word;
    if (wordIndex === startWord && startBit > 0) {
      const mask = new BN(1).shln(startBit).subn(1);
      masked = word.and(mask.notn(64));
    }

    if (!masked.isZero()) {
      const bit = leastSignificantBit(masked);
      if (bit >= 0) {
        return { found: true, offset: wordIndex * 64 + bit };
      }
    }
  }

  return { found: false, offset: 0 };
}

function searchBitmapBackward(bitmap: BN[], startOffset: number): { found: boolean; offset: number } {
  const startWord = Math.min(Math.floor(startOffset / 64), bitmap.length - 1);
  const startBit = startOffset % 64;

  for (let wordIndex = startWord; wordIndex >= 0; wordIndex--) {
    const word = bitmap[wordIndex];
    if (word.isZero()) continue;

    let masked = word;
    if (wordIndex === startWord) {
      const mask = new BN(1).shln(startBit + 1).subn(1);
      masked = word.and(mask);
    }

    if (!masked.isZero()) {
      const bit = mostSignificantBit(masked);
      if (bit >= 0) {
        return { found: true, offset: wordIndex * 64 + bit };
      }
    }
  }

  return { found: false, offset: 0 };
}

export function needsExtensionBitmap(tickArrayStartIndex: number, tickSpacing: number): boolean {
  const offsetIndex = getTickArrayOffsetIndex(tickArrayStartIndex, tickSpacing);
  const absOffset = Math.abs(offsetIndex);

  return absOffset >= TICK_ARRAY_BITMAP_SIZE;
}

export function getExtensionBitmapPosition(
  tickArrayStartIndex: number,
  tickSpacing: number,
): { sectionIndex: number; wordIndex: number; bitIndex: number; isPositive: boolean } {
  const offsetIndex = getTickArrayOffsetIndex(tickArrayStartIndex, tickSpacing);
  const isPositive = offsetIndex >= 0;
  const absOffset = Math.abs(offsetIndex);

  const extensionOffset = absOffset - TICK_ARRAY_BITMAP_SIZE;

  const bitsPerSection = 8 * 64;

  const sectionIndex = Math.floor(extensionOffset / bitsPerSection);
  const sectionOffset = extensionOffset % bitsPerSection;
  const wordIndex = Math.floor(sectionOffset / 64);
  const bitIndex = sectionOffset % 64;

  return { sectionIndex, wordIndex, bitIndex, isPositive };
}

export function isTickArrayInitializedInExtension(
  extensionBitmap: BN[][],
  tickArrayStartIndex: number,
  tickSpacing: number,
  isPositive: boolean,
): boolean {
  const pos = getExtensionBitmapPosition(tickArrayStartIndex, tickSpacing);

  if (pos.sectionIndex >= extensionBitmap.length) {
    return false;
  }

  const section = extensionBitmap[pos.sectionIndex];
  if (pos.wordIndex >= section.length) {
    return false;
  }

  return isBitSet(section[pos.wordIndex], pos.bitIndex);
}

export function getInitializedTickArrays(positiveBitmap: BN[], negativeBitmap: BN[], tickSpacing: number): number[] {
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE;
  const result: number[] = [];

  for (let wordIndex = 0; wordIndex < positiveBitmap.length; wordIndex++) {
    const word = positiveBitmap[wordIndex];
    if (word.isZero()) continue;

    for (let bit = 0; bit < 64; bit++) {
      if (isBitSet(word, bit)) {
        const offset = wordIndex * 64 + bit;
        result.push(offset * ticksPerArray);
      }
    }
  }

  for (let wordIndex = 0; wordIndex < negativeBitmap.length; wordIndex++) {
    const word = negativeBitmap[wordIndex];
    if (word.isZero()) continue;

    for (let bit = 0; bit < 64; bit++) {
      if (isBitSet(word, bit)) {
        const offset = -(wordIndex * 64 + bit + 1);
        result.push(offset * ticksPerArray);
      }
    }
  }

  return result.sort((a, b) => a - b);
}

export function isCurrentTickInInitializedArray(
  tick: number,
  tickSpacing: number,
  positiveBitmap: BN[],
  negativeBitmap: BN[],
): boolean {
  const tickArrayStart = getTickArrayStartIndex(tick, tickSpacing);
  const { wordIndex, bitIndex, isPositive } = getBitmapPosition(tickArrayStart, tickSpacing);

  const bitmap = isPositive ? positiveBitmap : negativeBitmap;

  if (wordIndex >= bitmap.length) {
    return false;
  }

  return isBitSet(bitmap[wordIndex], bitIndex);
}

export function getSwapTickArrayAddresses(
  programId: PublicKey,
  poolId: PublicKey,
  pool: ReturnType<typeof PoolInfoLayout.decode>,
  zeroForOne: boolean,
  count: number,
  exBitmapExtension?: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
): { address: PublicKey; startIndex: number }[] {
  const tickSpacing = pool.tickSpacing;

  const tickArrayBitmap = pool.tickArrayBitmap;
  const positiveBitmap = tickArrayBitmap.slice(0, 8);
  const negativeBitmap = tickArrayBitmap.slice(8, 16);

  const positiveExBitmap = exBitmapExtension?.positiveTickArrayBitmap;
  const negativeExBitmap = exBitmapExtension?.negativeTickArrayBitmap;

  const result: { address: PublicKey; startIndex: number }[] = [];

  const currentStartIndex = getTickArrayStartIndex(pool.tickCurrent, tickSpacing);

  if (
    isTickArrayInitializedFull(
      currentStartIndex,
      tickSpacing,
      positiveBitmap,
      negativeBitmap,
      positiveExBitmap,
      negativeExBitmap,
    )
  ) {
    result.push({
      address: getPdaTickArrayAddress(programId, poolId, currentStartIndex).publicKey,
      startIndex: currentStartIndex,
    });
  }

  let searchStartIndex = currentStartIndex;
  while (result.length < count) {
    const next = nextInitializedTickArrayFull(
      positiveBitmap,
      negativeBitmap,
      positiveExBitmap,
      negativeExBitmap,
      searchStartIndex,
      tickSpacing,
      zeroForOne,
    );

    if (!next.found) {
      break;
    }

    if (!result.some((r) => r.startIndex === next.startIndex)) {
      result.push({
        address: getPdaTickArrayAddress(programId, poolId, next.startIndex).publicKey,
        startIndex: next.startIndex,
      });
    }

    searchStartIndex = next.startIndex;
  }

  return result;
}

function isTickArrayInitializedFull(
  tickArrayStartIndex: number,
  tickSpacing: number,
  positiveBitmap: BN[],
  negativeBitmap: BN[],
  positiveExBitmap?: BN[][],
  negativeExBitmap?: BN[][],
): boolean {
  if (!needsExtensionBitmap(tickArrayStartIndex, tickSpacing)) {
    return isTickArrayInitializedInPool(tickArrayStartIndex, tickSpacing, positiveBitmap, negativeBitmap);
  }

  if (!positiveExBitmap || !negativeExBitmap) {
    return false;
  }

  const pos = getExtensionBitmapPosition(tickArrayStartIndex, tickSpacing);
  const exBitmap = pos.isPositive ? positiveExBitmap : negativeExBitmap;

  if (pos.sectionIndex >= exBitmap.length) {
    return false;
  }

  const section = exBitmap[pos.sectionIndex];
  if (pos.wordIndex >= section.length) {
    return false;
  }

  return isBitSet(section[pos.wordIndex], pos.bitIndex);
}

function isTickArrayInitializedInPool(
  tickArrayStartIndex: number,
  tickSpacing: number,
  positiveBitmap: BN[],
  negativeBitmap: BN[],
): boolean {
  const { wordIndex, bitIndex, isPositive } = getBitmapPosition(tickArrayStartIndex, tickSpacing);
  const bitmap = isPositive ? positiveBitmap : negativeBitmap;

  if (wordIndex >= bitmap.length) {
    return false;
  }

  return isBitSet(bitmap[wordIndex], bitIndex);
}

function nextInitializedTickArrayFull(
  positiveBitmap: BN[],
  negativeBitmap: BN[],
  positiveExBitmap: BN[][] | undefined,
  negativeExBitmap: BN[][] | undefined,
  tickArrayStartIndex: number,
  tickSpacing: number,
  zeroForOne: boolean,
): { found: boolean; startIndex: number } {
  const poolResult = nextInitializedTickArrayStartIndex(
    positiveBitmap,
    negativeBitmap,
    tickArrayStartIndex,
    tickSpacing,
    zeroForOne,
  );

  if (poolResult.found) {
    return poolResult;
  }

  if (!positiveExBitmap || !negativeExBitmap) {
    return { found: false, startIndex: 0 };
  }

  return nextInitializedTickArrayInExtension(
    positiveExBitmap,
    negativeExBitmap,
    tickArrayStartIndex,
    tickSpacing,
    zeroForOne,
  );
}

function nextInitializedTickArrayInExtension(
  positiveExBitmap: BN[][],
  negativeExBitmap: BN[][],
  tickArrayStartIndex: number,
  tickSpacing: number,
  zeroForOne: boolean,
): { found: boolean; startIndex: number } {
  const currentOffset = getTickArrayOffsetIndex(tickArrayStartIndex, tickSpacing);

  const absOffset = Math.abs(currentOffset);
  if (absOffset < TICK_ARRAY_BITMAP_SIZE) {
    const startExtOffset = TICK_ARRAY_BITMAP_SIZE;
    return searchExtensionBitmap(
      positiveExBitmap,
      negativeExBitmap,
      zeroForOne ? -startExtOffset : startExtOffset,
      tickSpacing,
      zeroForOne,
    );
  }

  return searchExtensionBitmap(positiveExBitmap, negativeExBitmap, currentOffset, tickSpacing, zeroForOne);
}

function searchExtensionBitmap(
  positiveExBitmap: BN[][],
  negativeExBitmap: BN[][],
  startOffset: number,
  tickSpacing: number,
  zeroForOne: boolean,
): { found: boolean; startIndex: number } {
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE;
  const bitsPerSection = 8 * 64;

  if (zeroForOne) {
    const searchOffset = startOffset - 1;

    if (searchOffset < 0) {
      const negOffset = -searchOffset - 1;
      if (negOffset >= TICK_ARRAY_BITMAP_SIZE) {
        const extOffset = negOffset - TICK_ARRAY_BITMAP_SIZE;
        for (let section = Math.floor(extOffset / bitsPerSection); section < negativeExBitmap.length; section++) {
          const sectionWords = negativeExBitmap[section];
          for (let word = 0; word < sectionWords.length; word++) {
            if (!sectionWords[word].isZero()) {
              for (let bit = 0; bit < 64; bit++) {
                if (isBitSet(sectionWords[word], bit)) {
                  const foundOffset = TICK_ARRAY_BITMAP_SIZE + section * bitsPerSection + word * 64 + bit;
                  return { found: true, startIndex: -(foundOffset + 1) * ticksPerArray };
                }
              }
            }
          }
        }
      }
    }
  } else {
    const searchOffset = startOffset + 1;
    if (searchOffset >= TICK_ARRAY_BITMAP_SIZE) {
      const extOffset = searchOffset - TICK_ARRAY_BITMAP_SIZE;
      for (let section = Math.floor(extOffset / bitsPerSection); section < positiveExBitmap.length; section++) {
        const sectionWords = positiveExBitmap[section];
        for (let word = 0; word < sectionWords.length; word++) {
          if (!sectionWords[word].isZero()) {
            for (let bit = 0; bit < 64; bit++) {
              if (isBitSet(sectionWords[word], bit)) {
                const foundOffset = TICK_ARRAY_BITMAP_SIZE + section * bitsPerSection + word * 64 + bit;
                return { found: true, startIndex: foundOffset * ticksPerArray };
              }
            }
          }
        }
      }
    }
  }

  return { found: false, startIndex: 0 };
}

export function getSwapTickArrayStartIndices(
  pool: ReturnType<typeof PoolInfoLayout.decode>,
  zeroForOne: boolean,
  count: number,
  exBitmapExtension?: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
): number[] {
  const tickSpacing = pool.tickSpacing;

  const tickArrayBitmap = pool.tickArrayBitmap;
  const positiveBitmap = tickArrayBitmap.slice(0, 8);
  const negativeBitmap = tickArrayBitmap.slice(8, 16);

  const positiveExBitmap = exBitmapExtension?.positiveTickArrayBitmap;
  const negativeExBitmap = exBitmapExtension?.negativeTickArrayBitmap;

  const result: number[] = [];
  const currentStartIndex = getTickArrayStartIndex(pool.tickCurrent, tickSpacing);

  if (
    isTickArrayInitializedFull(
      currentStartIndex,
      tickSpacing,
      positiveBitmap,
      negativeBitmap,
      positiveExBitmap,
      negativeExBitmap,
    )
  ) {
    result.push(currentStartIndex);
  }

  let searchStartIndex = currentStartIndex;
  while (result.length < count) {
    const next = nextInitializedTickArrayFull(
      positiveBitmap,
      negativeBitmap,
      positiveExBitmap,
      negativeExBitmap,
      searchStartIndex,
      tickSpacing,
      zeroForOne,
    );

    if (!next.found) {
      break;
    }

    if (!result.includes(next.startIndex)) {
      result.push(next.startIndex);
    }

    searchStartIndex = next.startIndex;
  }

  return result;
}

function tickRange(tickSpacing: number): {
  maxTickBoundary: number;
  minTickBoundary: number;
} {
  let maxTickBoundary = tickSpacing * TICK_ARRAY_SIZE * TICK_ARRAY_BITMAP_SIZE;
  let minTickBoundary = -maxTickBoundary;

  if (maxTickBoundary > MAX_TICK) {
    maxTickBoundary = getTickArrayStartIndex(MAX_TICK, tickSpacing) + TICK_ARRAY_SIZE * tickSpacing;
  }
  if (minTickBoundary < MIN_TICK) {
    minTickBoundary = getTickArrayStartIndex(MIN_TICK, tickSpacing);
  }
  return { maxTickBoundary, minTickBoundary };
}

export function isOverflowDefaultTickarrayBitmap(tickSpacing: number, tickarrayStartIndexs: number[]): boolean {
  const { maxTickBoundary, minTickBoundary } = tickRange(tickSpacing);

  for (const tickIndex of tickarrayStartIndexs) {
    const tickarrayStartIndex = getTickArrayStartIndex(tickIndex, tickSpacing);

    if (tickarrayStartIndex >= maxTickBoundary || tickarrayStartIndex < minTickBoundary) {
      return true;
    }
  }

  return false;
}

type Tick = ReturnType<typeof TickLayout.decode>;

export const FETCH_TICKARRAY_COUNT = 7;
export class TickQuery {
  public static async getTickArrays(
    connection: Connection,
    programId: PublicKey,
    poolId: PublicKey,
    tickCurrent: number,
    tickSpacing: number,
    tickArrayBitmapArray: BN[],
    exTickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
  ): Promise<{ [key: string]: ReturnType<typeof TickArrayLayout.decode> & { address: PublicKey } }> {
    const tickArraysToFetch: PublicKey[] = [];
    const currentTickArrayStartIndex = TickUtils.getTickArrayStartIndexByTick(tickCurrent, tickSpacing);

    const startIndexArray = TickUtils.getInitializedTickArrayInRange(
      tickArrayBitmapArray,
      exTickArrayBitmap,
      tickSpacing,
      currentTickArrayStartIndex,
      Math.floor(FETCH_TICKARRAY_COUNT / 2),
    );
    for (let i = 0; i < startIndexArray.length; i++) {
      const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, startIndexArray[i]);
      tickArraysToFetch.push(tickArrayAddress);
    }

    const fetchedTickArrays = (await getMultipleAccountsInfo(connection, tickArraysToFetch)).map((i) =>
      i !== null ? TickArrayLayout.decode(i.data) : null,
    );

    const tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> & { address: PublicKey } } = {};
    for (let i = 0; i < tickArraysToFetch.length; i++) {
      const _info = fetchedTickArrays[i];
      if (_info === null) continue;

      tickArrayCache[_info.startTickIndex] = {
        ..._info,
        address: tickArraysToFetch[i],
      };
    }
    return tickArrayCache;
  }

  public static nextInitializedTick(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> & { address: PublicKey } },
    tickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): {
    nextTick: Tick;
    tickArrayAddress: PublicKey | undefined;
    tickArrayStartTickIndex: number;
  } {
    let {
      initializedTick: nextTick,
      tickArrayAddress,
      tickArrayStartTickIndex,
    } = this.nextInitializedTickInOneArray(programId, poolId, tickArrayCache, tickIndex, tickSpacing, zeroForOne);
    while (nextTick == undefined || nextTick.liquidityGross.lten(0)) {
      tickArrayStartTickIndex = TickUtils.getNextTickArrayStartIndex(tickArrayStartTickIndex, tickSpacing, zeroForOne);
      if (this.checkIsValidStartIndex(tickArrayStartTickIndex, tickSpacing)) {
        throw new Error("No enough initialized tickArray");
      }
      const cachedTickArray = tickArrayCache[tickArrayStartTickIndex];

      if (cachedTickArray === undefined) continue;

      const {
        nextTick: _nextTick,
        tickArrayAddress: _tickArrayAddress,
        tickArrayStartTickIndex: _tickArrayStartTickIndex,
      } = this.firstInitializedTickInOneArray(programId, poolId, cachedTickArray, zeroForOne);
      [nextTick, tickArrayAddress, tickArrayStartTickIndex] = [_nextTick, _tickArrayAddress, _tickArrayStartTickIndex];
    }
    if (nextTick == undefined) {
      throw new Error("No invaild tickArray cache");
    }
    return { nextTick, tickArrayAddress, tickArrayStartTickIndex };
  }

  public static nextInitializedTickArray(
    tickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    tickArrayBitmap: BN[],
    exBitmapInfo: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
  ): {
    isExist: boolean;
    nextStartIndex: number;
  } {
    const currentOffset = Math.floor(tickIndex / TickQuery.tickCount(tickSpacing));
    const result: number[] = zeroForOne
      ? TickUtils.searchLowBitFromStart(tickArrayBitmap, exBitmapInfo, currentOffset - 1, 1, tickSpacing)
      : TickUtils.searchHightBitFromStart(tickArrayBitmap, exBitmapInfo, currentOffset + 1, 1, tickSpacing);

    return result.length > 0 ? { isExist: true, nextStartIndex: result[0] } : { isExist: false, nextStartIndex: 0 };
  }

  public static firstInitializedTickInOneArray(
    programId: PublicKey,
    poolId: PublicKey,
    tickArray: ReturnType<typeof TickArrayLayout.decode> & { address: PublicKey },
    zeroForOne: boolean,
  ): {
    nextTick: Tick | undefined;
    tickArrayAddress: PublicKey;
    tickArrayStartTickIndex: number;
  } {
    let nextInitializedTick: Tick | undefined = undefined;
    if (zeroForOne) {
      let i = TICK_ARRAY_SIZE - 1;
      while (i >= 0) {
        const tickInArray = tickArray.ticks[i];
        if (tickInArray.liquidityGross.gtn(0)) {
          nextInitializedTick = tickInArray;
          break;
        }
        i = i - 1;
      }
    } else {
      let i = 0;
      while (i < TICK_ARRAY_SIZE) {
        const tickInArray = tickArray.ticks[i];
        if (tickInArray.liquidityGross.gtn(0)) {
          nextInitializedTick = tickInArray;
          break;
        }
        i = i + 1;
      }
    }
    const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, tickArray.startTickIndex);
    return { nextTick: nextInitializedTick, tickArrayAddress, tickArrayStartTickIndex: tickArray.startTickIndex };
  }

  public static nextInitializedTickInOneArray(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayCache: { [key: string]: ReturnType<typeof TickArrayLayout.decode> & { address: PublicKey } },
    tickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): {
    initializedTick: Tick | undefined;
    tickArrayAddress: PublicKey | undefined;
    tickArrayStartTickIndex: number;
  } {
    const startIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    let tickPositionInArray = Math.floor((tickIndex - startIndex) / tickSpacing);
    const cachedTickArray = tickArrayCache[startIndex];
    if (cachedTickArray == undefined) {
      return {
        initializedTick: undefined,
        tickArrayAddress: undefined,
        tickArrayStartTickIndex: startIndex,
      };
    }
    let nextInitializedTick: Tick | undefined = undefined;
    if (zeroForOne) {
      while (tickPositionInArray >= 0) {
        const tickInArray = cachedTickArray.ticks[tickPositionInArray];
        if (tickInArray.liquidityGross.gtn(0)) {
          nextInitializedTick = tickInArray;
          break;
        }
        tickPositionInArray = tickPositionInArray - 1;
      }
    } else {
      tickPositionInArray = tickPositionInArray + 1;
      while (tickPositionInArray < TICK_ARRAY_SIZE) {
        const tickInArray = cachedTickArray.ticks[tickPositionInArray];
        if (tickInArray.liquidityGross.gtn(0)) {
          nextInitializedTick = tickInArray;
          break;
        }
        tickPositionInArray = tickPositionInArray + 1;
      }
    }
    const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, startIndex);
    return {
      initializedTick: nextInitializedTick,
      tickArrayAddress,
      tickArrayStartTickIndex: cachedTickArray.startTickIndex,
    };
  }

  public static getArrayStartIndex(tickIndex: number, tickSpacing: number): number {
    const ticksInArray = this.tickCount(tickSpacing);
    const start = Math.floor(tickIndex / ticksInArray);

    return start * ticksInArray;
  }

  public static checkIsValidStartIndex(tickIndex: number, tickSpacing: number): boolean {
    if (TickUtils.checkIsOutOfBoundary(tickIndex)) {
      if (tickIndex > MAX_TICK) {
        return false;
      }
      const minStartIndex = TickUtils.getTickArrayStartIndexByTick(MIN_TICK, tickSpacing);
      return tickIndex == minStartIndex;
    }
    return tickIndex % this.tickCount(tickSpacing) == 0;
  }

  public static tickCount(tickSpacing: number): number {
    return TICK_ARRAY_SIZE * tickSpacing;
  }
}

export class TickArrayBitmapExtensionUtils {
  public static getBitmapOffset(tickIndex: number, tickSpacing: number): number {
    if (!TickQuery.checkIsValidStartIndex(tickIndex, tickSpacing)) {
      throw new Error("No enough initialized tickArray");
    }
    this.checkExtensionBoundary(tickIndex, tickSpacing);

    const ticksInOneBitmap = TickArrayBitmap.maxTickInTickarrayBitmap(tickSpacing);
    let offset = Math.floor(Math.abs(tickIndex) / ticksInOneBitmap) - 1;

    if (tickIndex < 0 && Math.abs(tickIndex) % ticksInOneBitmap === 0) offset--;
    return offset;
  }

  public static getBitmap(
    tickIndex: number,
    tickSpacing: number,
    tickArrayBitmapExtension: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
  ): { offset: number; tickarrayBitmap: BN[] } {
    const offset = this.getBitmapOffset(tickIndex, tickSpacing);
    if (tickIndex < 0) {
      return { offset, tickarrayBitmap: tickArrayBitmapExtension.negativeTickArrayBitmap[offset] };
    } else {
      return { offset, tickarrayBitmap: tickArrayBitmapExtension.positiveTickArrayBitmap[offset] };
    }
  }

  public static checkExtensionBoundary(tickIndex: number, tickSpacing: number) {
    const { positiveTickBoundary, negativeTickBoundary } = this.extensionTickBoundary(tickSpacing);

    if (tickIndex >= negativeTickBoundary && tickIndex < positiveTickBoundary) {
      throw Error("checkExtensionBoundary -> InvalidTickArrayBoundary");
    }
  }

  public static extensionTickBoundary(tickSpacing: number): {
    positiveTickBoundary: number;
    negativeTickBoundary: number;
  } {
    const positiveTickBoundary = TickArrayBitmap.maxTickInTickarrayBitmap(tickSpacing);

    const negativeTickBoundary = -positiveTickBoundary;

    if (MAX_TICK <= positiveTickBoundary)
      throw Error(`extensionTickBoundary check error: ${MAX_TICK}, ${positiveTickBoundary}`);
    if (negativeTickBoundary <= MIN_TICK)
      throw Error(`extensionTickBoundary check error: ${negativeTickBoundary}, ${MIN_TICK}`);

    return { positiveTickBoundary, negativeTickBoundary };
  }

  public static checkTickArrayIsInit(
    tickArrayStartIndex: number,
    tickSpacing: number,
    tickArrayBitmapExtension: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
  ): { isInitialized: boolean; startIndex: number } {
    const { tickarrayBitmap } = this.getBitmap(tickArrayStartIndex, tickSpacing, tickArrayBitmapExtension);

    const tickArrayOffsetInBitmap = this.tickArrayOffsetInBitmap(tickArrayStartIndex, tickSpacing);

    return {
      isInitialized: TickUtils.mergeTickArrayBitmap(tickarrayBitmap).testn(tickArrayOffsetInBitmap),
      startIndex: tickArrayStartIndex,
    };
  }

  public static nextInitializedTickArrayFromOneBitmap(
    lastTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    tickArrayBitmapExtension: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
  ): {
    isInit: boolean;
    tickIndex: number;
  } {
    const multiplier = TickQuery.tickCount(tickSpacing);
    const nextTickArrayStartIndex = zeroForOne
      ? lastTickArrayStartIndex - multiplier
      : lastTickArrayStartIndex + multiplier;
    const { tickarrayBitmap } = this.getBitmap(nextTickArrayStartIndex, tickSpacing, tickArrayBitmapExtension);

    return this.nextInitializedTickArrayInBitmap(tickarrayBitmap, nextTickArrayStartIndex, tickSpacing, zeroForOne);
  }

  public static nextInitializedTickArrayInBitmap(
    tickarrayBitmap: BN[],
    nextTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): {
    isInit: boolean;
    tickIndex: number;
  } {
    const { minValue: bitmapMinTickBoundary, maxValue: bitmapMaxTickBoundary } = TickArrayBitmap.getBitmapTickBoundary(
      nextTickArrayStartIndex,
      tickSpacing,
    );

    const tickArrayOffsetInBitmap = this.tickArrayOffsetInBitmap(nextTickArrayStartIndex, tickSpacing);
    if (zeroForOne) {
      // tick from upper to lower
      // find from highter bits to lower bits
      const offsetBitMap = TickUtils.mergeTickArrayBitmap(tickarrayBitmap).shln(
        TICK_ARRAY_BITMAP_SIZE - 1 - tickArrayOffsetInBitmap,
      );

      const nextBit = offsetBitMap.isZero() ? null : offsetBitMap.bitLength() - 1;

      if (nextBit !== null) {
        const nextArrayStartIndex = nextTickArrayStartIndex - nextBit * TickQuery.tickCount(tickSpacing);
        return { isInit: true, tickIndex: nextArrayStartIndex };
      } else {
        // not found til to the end
        return { isInit: false, tickIndex: bitmapMinTickBoundary };
      }
    } else {
      // tick from lower to upper
      // find from lower bits to highter bits
      const offsetBitMap = TickUtils.mergeTickArrayBitmap(tickarrayBitmap).shrn(tickArrayOffsetInBitmap);

      const nextBit = offsetBitMap.isZero() ? null : leastSignificantBit(offsetBitMap);

      if (nextBit !== null) {
        const nextArrayStartIndex = nextTickArrayStartIndex + nextBit * TickQuery.tickCount(tickSpacing);
        return { isInit: true, tickIndex: nextArrayStartIndex };
      } else {
        // not found til to the end
        return { isInit: false, tickIndex: bitmapMaxTickBoundary - TickQuery.tickCount(tickSpacing) };
      }
    }
  }

  public static tickArrayOffsetInBitmap(tickArrayStartIndex: number, tickSpacing: number): number {
    const m = Math.abs(tickArrayStartIndex) % TickArrayBitmap.maxTickInTickarrayBitmap(tickSpacing);
    let tickArrayOffsetInBitmap = Math.floor(m / TickQuery.tickCount(tickSpacing));
    if (tickArrayStartIndex < 0 && m != 0) {
      tickArrayOffsetInBitmap = TICK_ARRAY_BITMAP_SIZE - tickArrayOffsetInBitmap;
    }
    return tickArrayOffsetInBitmap;
  }
}

export interface ReturnTypeGetTickPrice {
  tick: number;
  price: Decimal;
  tickSqrtPriceX64: BN;
}
export interface ReturnTypeGetPriceAndTick {
  tick: number;
  price: Decimal;
}

export class TickUtils {
  public static getTickArrayAddressByTick(
    programId: PublicKey,
    poolId: PublicKey,
    tickIndex: number,
    tickSpacing: number,
  ): PublicKey {
    const startIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, startIndex);
    return tickArrayAddress;
  }

  public static getTickOffsetInArray(tickIndex: number, tickSpacing: number): number {
    if (tickIndex % tickSpacing != 0) {
      throw new Error("tickIndex % tickSpacing not equal 0");
    }
    const startTickIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const offsetInArray = Math.floor((tickIndex - startTickIndex) / tickSpacing);
    if (offsetInArray < 0 || offsetInArray >= TICK_ARRAY_SIZE) {
      throw new Error("tick offset in array overflow");
    }
    return offsetInArray;
  }

  public static getTickArrayBitIndex(tickIndex: number, tickSpacing: number): number {
    const ticksInArray = TickQuery.tickCount(tickSpacing);

    let startIndex: number = tickIndex / ticksInArray;
    if (tickIndex < 0 && tickIndex % ticksInArray != 0) {
      startIndex = Math.ceil(startIndex) - 1;
    } else {
      startIndex = Math.floor(startIndex);
    }
    return startIndex;
  }

  public static getTickArrayStartIndexByTick(tickIndex: number, tickSpacing: number): number {
    return this.getTickArrayBitIndex(tickIndex, tickSpacing) * TickQuery.tickCount(tickSpacing);
  }

  public static getTickArrayOffsetInBitmapByTick(tick: number, tickSpacing: number): number {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    return Math.abs(compressed);
  }

  public static checkTickArrayIsInitialized(
    bitmap: BN,
    tick: number,
    tickSpacing: number,
  ): {
    isInitialized: boolean;
    startIndex: number;
  } {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    const bitPos = Math.abs(compressed);
    return {
      isInitialized: bitmap.testn(bitPos),
      startIndex: (bitPos - 512) * multiplier,
    };
  }

  public static getNextTickArrayStartIndex(
    lastTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): number {
    return zeroForOne
      ? lastTickArrayStartIndex - tickSpacing * TICK_ARRAY_SIZE
      : lastTickArrayStartIndex + tickSpacing * TICK_ARRAY_SIZE;
  }

  public static mergeTickArrayBitmap(bns: BN[]): BN {
    let b = new BN(0);
    for (let i = 0; i < bns.length; i++) {
      b = b.add(bns[i].shln(64 * i));
    }
    return b;
  }

  public static getInitializedTickArrayInRange(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
    tickSpacing: number,
    tickArrayStartIndex: number,
    expectedCount: number,
  ): number[] {
    const tickArrayOffset = Math.floor(tickArrayStartIndex / (tickSpacing * TICK_ARRAY_SIZE));
    return [
      // find right of currenct offset
      ...TickUtils.searchLowBitFromStart(
        tickArrayBitmap,
        exTickArrayBitmap,
        tickArrayOffset - 1,
        expectedCount,
        tickSpacing,
      ),

      // find left of current offset
      ...TickUtils.searchHightBitFromStart(
        tickArrayBitmap,
        exTickArrayBitmap,
        tickArrayOffset,
        expectedCount,
        tickSpacing,
      ),
    ];
  }

  public static getAllInitializedTickArrayStartIndex(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
    tickSpacing: number,
  ): number[] {
    // find from offset 0 to 1024
    return TickUtils.searchHightBitFromStart(
      tickArrayBitmap,
      exTickArrayBitmap,
      -7680,
      TICK_ARRAY_BITMAP_SIZE,
      tickSpacing,
    );
  }

  public static getAllInitializedTickArrayInfo(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayBitmap: BN[],
    exTickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
    tickSpacing: number,
  ): {
    tickArrayStartIndex: number;
    tickArrayAddress: PublicKey;
  }[] {
    const result: {
      tickArrayStartIndex: number;
      tickArrayAddress: PublicKey;
    }[] = [];
    const allInitializedTickArrayIndex: number[] = TickUtils.getAllInitializedTickArrayStartIndex(
      tickArrayBitmap,
      exTickArrayBitmap,
      tickSpacing,
    );
    for (const startIndex of allInitializedTickArrayIndex) {
      const { publicKey: address } = getPdaTickArrayAddress(programId, poolId, startIndex);
      result.push({
        tickArrayStartIndex: startIndex,
        tickArrayAddress: address,
      });
    }
    return result;
  }

  public static getAllInitializedTickInTickArray(
    tickArray: ReturnType<typeof TickArrayLayout.decode>,
  ): ReturnType<typeof TickLayout.decode>[] {
    return tickArray.ticks.filter((i) => i.liquidityGross.gtn(0));
  }

  public static searchLowBitFromStart(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
    currentTickArrayBitStartIndex: number,
    expectedCount: number,
    tickSpacing: number,
  ): number[] {
    const tickArrayBitmaps = [
      ...[...exTickArrayBitmap.negativeTickArrayBitmap].reverse(),
      tickArrayBitmap.slice(0, 8),
      tickArrayBitmap.slice(8, 16),
      ...exTickArrayBitmap.positiveTickArrayBitmap,
    ].map((i) => TickUtils.mergeTickArrayBitmap(i));
    const result: number[] = [];
    while (currentTickArrayBitStartIndex >= -7680) {
      const arrayIndex = Math.floor((currentTickArrayBitStartIndex + 7680) / 512);
      const searchIndex = (currentTickArrayBitStartIndex + 7680) % 512;

      if (tickArrayBitmaps[arrayIndex].testn(searchIndex)) result.push(currentTickArrayBitStartIndex);

      currentTickArrayBitStartIndex--;
      if (result.length === expectedCount) break;
    }

    const tickCount = TickQuery.tickCount(tickSpacing);
    return result.map((i) => i * tickCount);
  }

  public static searchHightBitFromStart(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: ReturnType<typeof TickArrayBitmapExtensionLayout.decode>,
    currentTickArrayBitStartIndex: number,
    expectedCount: number,
    tickSpacing: number,
  ): number[] {
    const tickArrayBitmaps = [
      ...[...exTickArrayBitmap.negativeTickArrayBitmap].reverse(),
      tickArrayBitmap.slice(0, 8),
      tickArrayBitmap.slice(8, 16),
      ...exTickArrayBitmap.positiveTickArrayBitmap,
    ].map((i) => TickUtils.mergeTickArrayBitmap(i));
    const result: number[] = [];
    while (currentTickArrayBitStartIndex < 7680) {
      const arrayIndex = Math.floor((currentTickArrayBitStartIndex + 7680) / 512);
      const searchIndex = (currentTickArrayBitStartIndex + 7680) % 512;

      if (tickArrayBitmaps[arrayIndex].testn(searchIndex)) result.push(currentTickArrayBitStartIndex);

      currentTickArrayBitStartIndex++;
      if (result.length === expectedCount) break;
    }

    const tickCount = TickQuery.tickCount(tickSpacing);
    return result.map((i) => i * tickCount);
  }

  public static checkIsOutOfBoundary(tick: number): boolean {
    return tick < MIN_TICK || tick > MAX_TICK;
  }

  public static nextInitTick(
    tickArrayCurrent: ReturnType<typeof TickArrayLayout.decode>,
    currentTickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    t: boolean,
  ): Tick | null {
    const currentTickArrayStartIndex = TickQuery.getArrayStartIndex(currentTickIndex, tickSpacing);
    if (currentTickArrayStartIndex != tickArrayCurrent.startTickIndex) {
      return null;
    }
    let offsetInArray = Math.floor((currentTickIndex - tickArrayCurrent.startTickIndex) / tickSpacing);

    if (zeroForOne) {
      while (offsetInArray >= 0) {
        if (tickArrayCurrent.ticks[offsetInArray].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[offsetInArray];
        }
        offsetInArray = offsetInArray - 1;
      }
    } else {
      if (!t) offsetInArray = offsetInArray + 1;
      while (offsetInArray < TICK_ARRAY_SIZE) {
        if (tickArrayCurrent.ticks[offsetInArray].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[offsetInArray];
        }
        offsetInArray = offsetInArray + 1;
      }
    }
    return null;
  }

  public static firstInitializedTick(
    tickArrayCurrent: ReturnType<typeof TickArrayLayout.decode> & { address: PublicKey },
    zeroForOne: boolean,
  ): Tick {
    if (zeroForOne) {
      let i = TICK_ARRAY_SIZE - 1;
      while (i >= 0) {
        if (tickArrayCurrent.ticks[i].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[i];
        }
        i = i - 1;
      }
    } else {
      let i = 0;
      while (i < TICK_ARRAY_SIZE) {
        if (tickArrayCurrent.ticks[i].liquidityGross.gtn(0)) {
          return tickArrayCurrent.ticks[i];
        }
        i = i + 1;
      }
    }

    throw Error(`firstInitializedTick check error: ${tickArrayCurrent} - ${zeroForOne}`);
  }

  public static _getTickPriceLegacy({
    poolInfo,
    tick,
    baseIn,
  }: {
    poolInfo: ClmmPoolInfo;
    tick: number;
    baseIn: boolean;
  }): ReturnTypeGetTickPrice {
    const tickSqrtPriceX64 = getSqrtPriceAtTick(tick);
    const tickPrice = sqrtPriceX64ToPrice(tickSqrtPriceX64, poolInfo.mintA.decimals, poolInfo.mintB.decimals);

    return baseIn
      ? { tick, price: tickPrice, tickSqrtPriceX64 }
      : { tick, price: new Decimal(1).div(tickPrice), tickSqrtPriceX64 };
  }

  public static _getPriceAndTickLegacy({
    poolInfo,
    price,
    baseIn,
  }: {
    poolInfo: ClmmPoolInfo;
    price: Decimal;
    baseIn: boolean;
  }): ReturnTypeGetPriceAndTick {
    const _price = baseIn ? price : new Decimal(1).div(price);

    const tick = TickMath.getTickWithPriceAndTickspacing(
      _price,
      poolInfo.ammConfig.tickSpacing,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const tickSqrtPriceX64 = getSqrtPriceAtTick(tick);
    const tickPrice = sqrtPriceX64ToPrice(tickSqrtPriceX64, poolInfo.mintA.decimals, poolInfo.mintB.decimals);

    return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  }

  public static getTickPrice({
    poolInfo,
    tick,
    baseIn,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    tick: number;
    baseIn: boolean;
  }): ReturnTypeGetTickPrice {
    const tickSqrtPriceX64 = getSqrtPriceAtTick(tick);
    const tickPrice = sqrtPriceX64ToPrice(tickSqrtPriceX64, poolInfo.mintA.decimals, poolInfo.mintB.decimals);

    return baseIn
      ? { tick, price: tickPrice, tickSqrtPriceX64 }
      : { tick, price: new Decimal(1).div(tickPrice), tickSqrtPriceX64 };
  }

  public static getPriceAndTick({
    poolInfo,
    price,
    baseIn,
  }: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    price: Decimal;
    baseIn: boolean;
  }): ReturnTypeGetPriceAndTick {
    const _price = baseIn ? price : new Decimal(1).div(price);

    const tick = TickMath.getTickWithPriceAndTickspacing(
      _price,
      poolInfo.config.tickSpacing,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    const tickSqrtPriceX64 = getSqrtPriceAtTick(tick);
    const tickPrice = sqrtPriceX64ToPrice(tickSqrtPriceX64, poolInfo.mintA.decimals, poolInfo.mintB.decimals);

    return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  }
}

export class TickArrayBitmap {
  public static maxTickInTickarrayBitmap(tickSpacing: number): number {
    return tickSpacing * TICK_ARRAY_SIZE * TICK_ARRAY_BITMAP_SIZE;
  }

  public static getBitmapTickBoundary(
    tickarrayStartIndex: number,
    tickSpacing: number,
  ): {
    minValue: number;
    maxValue: number;
  } {
    const ticksInOneBitmap = this.maxTickInTickarrayBitmap(tickSpacing);
    let m = Math.floor(Math.abs(tickarrayStartIndex) / ticksInOneBitmap);
    if (tickarrayStartIndex < 0 && Math.abs(tickarrayStartIndex) % ticksInOneBitmap != 0) m += 1;

    const minValue = ticksInOneBitmap * m;

    return tickarrayStartIndex < 0
      ? { minValue: -minValue, maxValue: -minValue + ticksInOneBitmap }
      : { minValue, maxValue: minValue + ticksInOneBitmap };
  }

  public static nextInitializedTickArrayStartIndex(
    bitMap: BN,
    lastTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): { isInit: boolean; tickIndex: number } {
    if (!TickQuery.checkIsValidStartIndex(lastTickArrayStartIndex, tickSpacing))
      throw Error("nextInitializedTickArrayStartIndex check error");

    const tickBoundary = this.maxTickInTickarrayBitmap(tickSpacing);
    const nextTickArrayStartIndex = zeroForOne
      ? lastTickArrayStartIndex - TickQuery.tickCount(tickSpacing)
      : lastTickArrayStartIndex + TickQuery.tickCount(tickSpacing);

    if (nextTickArrayStartIndex < -tickBoundary || nextTickArrayStartIndex >= tickBoundary) {
      return { isInit: false, tickIndex: lastTickArrayStartIndex };
    }

    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    let compressed = nextTickArrayStartIndex / multiplier + 512;

    if (nextTickArrayStartIndex < 0 && nextTickArrayStartIndex % multiplier != 0) {
      compressed--;
    }

    const bitPos = Math.abs(compressed);

    if (zeroForOne) {
      const offsetBitMap = bitMap.shln(1024 - bitPos - 1);
      const nextBit = mostSignificantBit(offsetBitMap);
      if (nextBit !== null) {
        const nextArrayStartIndex = (bitPos - nextBit - 512) * multiplier;
        return { isInit: true, tickIndex: nextArrayStartIndex };
      } else {
        return { isInit: false, tickIndex: -tickBoundary };
      }
    } else {
      const offsetBitMap = bitMap.shrn(bitPos);
      const nextBit = leastSignificantBit(offsetBitMap);
      if (nextBit !== null) {
        const nextArrayStartIndex = (bitPos + nextBit - 512) * multiplier;
        return { isInit: true, tickIndex: nextArrayStartIndex };
      } else {
        return { isInit: false, tickIndex: tickBoundary - TickQuery.tickCount(tickSpacing) };
      }
    }
  }
}

export class TickMath {
  public static getTickWithPriceAndTickspacing(
    price: Decimal,
    tickSpacing: number,
    mintDecimalsA: number,
    mintDecimalsB: number,
  ): number {
    const tick = getTickAtSqrtPrice(priceToSqrtPriceX64(price, mintDecimalsA, mintDecimalsB));
    let result = tick / tickSpacing;
    if (result < 0) {
      result = Math.floor(result);
    } else {
      result = Math.ceil(result);
    }
    return result * tickSpacing;
  }

  public static roundPriceWithTickspacing(
    price: Decimal,
    tickSpacing: number,
    mintDecimalsA: number,
    mintDecimalsB: number,
  ): Decimal {
    const tick = TickMath.getTickWithPriceAndTickspacing(price, tickSpacing, mintDecimalsA, mintDecimalsB);

    const sqrtPriceX64 = getSqrtPriceAtTick(tick);
    return sqrtPriceX64ToPrice(sqrtPriceX64, mintDecimalsA, mintDecimalsB);
  }
}

/**
 * Fetch tick arrays for swap simulation
 */
export async function fetchTickArrays(
  programId: PublicKey,
  connection: Connection,
  poolId: PublicKey,
  currentTick: number,
  tickSpacing: number,
  zeroForOne: boolean,
): Promise<ReturnType<typeof TickArrayLayout.decode>[]> {
  const tickArrays: ReturnType<typeof TickArrayLayout.decode>[] = [];
  const tickArrayStart = getTickArrayStartIndex(currentTick, tickSpacing);
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE;

  // Fetch tick arrays in the swap direction
  const endOffset = zeroForOne ? -5 : 5;
  const step = zeroForOne ? -1 : 1;

  for (let i = 0; zeroForOne ? i >= endOffset : i <= endOffset; i += step) {
    const start = tickArrayStart + i * ticksPerArray;
    const taAddress = getPdaTickArrayAddress(programId, poolId, start).publicKey;
    const taData = (await connection.getAccountInfo(taAddress, "confirmed")) as any;
    if (taData) {
      const tickArray = TickArrayLayout.decode(taData.data);
      tickArrays.push(tickArray);
    }
  }

  return tickArrays;
}
