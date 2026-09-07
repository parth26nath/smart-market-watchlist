// Pure market-calendar logic: is the exchange open, closed, pre- or post-market
// right now. Deliberately simple — fixed NYSE-like hours in exchange-local time
// (via Intl, no date library dependency) plus a short hardcoded holiday list.
// Full multi-exchange calendars are out of scope for this submission (DECISIONS.md §8).

export type MarketSessionState = "pre" | "open" | "post" | "closed";

export const EXCHANGE_TIMEZONE = "America/New_York";

// Minutes from exchange-local midnight.
const PRE_OPEN_MIN = 4 * 60; // 04:00
const SESSION_OPEN_MIN = 9 * 60 + 30; // 09:30
const SESSION_CLOSE_MIN = 16 * 60; // 16:00
const POST_CLOSE_MIN = 20 * 60; // 20:00

export const SESSION_LENGTH_MIN = SESSION_CLOSE_MIN - SESSION_OPEN_MIN; // 390

// A handful of 2025/2026 NYSE holidays — enough for a demo to behave correctly
// around a real closed day, not an exhaustive calendar.
const HOLIDAYS = new Set([
  "2025-01-01",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

interface ExchangeLocalParts {
  dateKey: string; // YYYY-MM-DD in exchange time
  weekday: number; // 0=Sun..6=Sat
  minutesOfDay: number;
}

function toExchangeLocal(date: Date): ExchangeLocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: EXCHANGE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some ICU builds render midnight as "24"
  const minute = Number(get("minute"));
  const weekdayName = get("weekday");
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${year}-${month}-${day}`,
    weekday: weekdayMap[weekdayName] ?? 0,
    minutesOfDay: hour * 60 + minute,
  };
}

export function exchangeDateKey(date: Date): string {
  return toExchangeLocal(date).dateKey;
}

export function isTradingDay(date: Date): boolean {
  const { weekday, dateKey } = toExchangeLocal(date);
  if (weekday === 0 || weekday === 6) return false;
  if (HOLIDAYS.has(dateKey)) return false;
  return true;
}

export function getSessionState(now: Date): MarketSessionState {
  const local = toExchangeLocal(now);
  if (!isTradingDay(now)) return "closed";
  if (local.minutesOfDay < PRE_OPEN_MIN) return "closed";
  if (local.minutesOfDay < SESSION_OPEN_MIN) return "pre";
  if (local.minutesOfDay < SESSION_CLOSE_MIN) return "open";
  if (local.minutesOfDay < POST_CLOSE_MIN) return "post";
  return "closed";
}

/** Fraction (0..1) of the regular session elapsed so far today; 0 outside the session. */
export function sessionFractionElapsed(now: Date): number {
  const local = toExchangeLocal(now);
  if (!isTradingDay(now)) return 0;
  if (local.minutesOfDay <= SESSION_OPEN_MIN) return 0;
  if (local.minutesOfDay >= SESSION_CLOSE_MIN) return 1;
  return (local.minutesOfDay - SESSION_OPEN_MIN) / SESSION_LENGTH_MIN;
}

function dateKeyToUtcNoon(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Count of trading days strictly between two date keys (both exclusive). Anchors
 * on UTC noon while stepping so US DST transitions never shift the local calendar date. */
export function countTradingDaysBetweenExclusive(fromDateKey: string, toDateKey: string): number {
  if (fromDateKey >= toDateKey) return 0;
  let count = 0;
  let cursor = dateKeyToUtcNoon(fromDateKey);
  const toNoon = dateKeyToUtcNoon(toDateKey).getTime();
  for (let i = 0; i < 20000 && cursor.getTime() < toNoon; i++) {
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
    if (cursor.getTime() >= toNoon) break;
    if (isTradingDay(cursor)) count++;
  }
  return count;
}

/**
 * Trading sessions elapsed between two instants, fractional within a session.
 * This is the √time denominator input for price-move normalisation — it's what
 * makes a 3-hour absence and a 3-week absence both score correctly instead of
 * one silently degrading (DECISIONS.md §3.2).
 */
export function tradingSessionsElapsed(fromIso: string, toIso: string): number {
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (toDate.getTime() <= fromDate.getTime()) return 0;
  const fromKey = exchangeDateKey(fromDate);
  const toKey = exchangeDateKey(toDate);
  if (fromKey === toKey) {
    return Math.max(0, sessionFractionElapsed(toDate) - sessionFractionElapsed(fromDate));
  }
  const remainderFromDay = isTradingDay(fromDate) ? 1 - sessionFractionElapsed(fromDate) : 0;
  const fullDaysBetween = countTradingDaysBetweenExclusive(fromKey, toKey);
  const todayFraction = isTradingDay(toDate) ? sessionFractionElapsed(toDate) : 0;
  return remainderFromDay + fullDaysBetween + todayFraction;
}

export function describeSessionState(state: MarketSessionState, now: Date): string {
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: EXCHANGE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  switch (state) {
    case "open":
      return "Market open";
    case "pre":
      return "Pre-market";
    case "post":
      return "After-hours";
    case "closed":
      return `Market closed · nothing new since the last close (as of ${timeFmt.format(now)})`;
  }
}
