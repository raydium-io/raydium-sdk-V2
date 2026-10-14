/**
 * https://youmightnotneed.com/lodash/
 */

export function chunkArray<T>(arr: T[], chunkSize = 1, cache: T[][] = []): T[][] {
  const tmp = [...arr];
  const size = Math.floor(chunkSize);
  if (!(size >= 1)) return cache;
  while (tmp.length) cache.push(tmp.splice(0, size));
  return cache;
}

export function intersection<T>(arr: T[], ...args: T[][]): T[] {
  return arr.filter((item) => args.every((arr) => arr.includes(item)));
}

export function xor<T>(arr: T[], ...args: T[][]): T[] {
  return arr.filter((item) => args.every((arr) => !arr.includes(item)));
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
