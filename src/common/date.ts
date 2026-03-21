export type TimeStamp = string | number | Date;

export const isNumber = (val: any): val is number => typeof val === "number";

export type DateParam = string | number | Date | undefined;

export const getDate = (value?: DateParam): Date => (value ? new Date(value) : new Date());
export const getTime = (value?: DateParam): number => getDate(value).getTime();

/** A must be milliseconds */
export function isDateBefore(timestampA: TimeStamp, timestampB: TimeStamp, options?: { unit?: "ms" | "s" }): boolean {
  const realTimestampB = isNumber(timestampB)
    ? timestampB * (options?.unit === "s" ? 1000 : 1)
    : getTime(timestampB);
  return getTime(timestampA) <= realTimestampB;
}

/** A must be milliseconds */
export function isDateAfter(timestampA: TimeStamp, timestampB: TimeStamp, options?: { unit?: "ms" | "s" }): boolean {
  const realTimestampB = isNumber(timestampB)
    ? timestampB * (options?.unit === "s" ? 1000 : 1)
    : getTime(timestampB);
  return getTime(timestampA) > realTimestampB;
}

export function offsetDateTime(
  baseDate: DateParam,
  offset: {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
  },
): Date {
  const timestamp = getTime(baseDate);
  const offsetedTimestamp =
    timestamp +
    (offset.days ?? 0) * 24 * 60 * 60 * 1000 +
    (offset.hours ?? 0) * 60 * 60 * 1000 +
    (offset.minutes ?? 0) * 60 * 1000 +
    (offset.seconds ?? 0) * 1000 +
    (offset.milliseconds ?? 0);
  return getDate(offsetedTimestamp);
}
