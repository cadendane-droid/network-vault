// Staleness helpers for the per-user usage counters (limits in
// src/lib/limits.ts, columns on the users table).
//
// All windows are UTC calendar days/months. The *_reset_at columns are
// Postgres DATE values, which Prisma returns as UTC-midnight DateTimes, so
// comparing UTC date parts is exact. A null reset_at means never used.

export function utcToday(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function isSameUtcDay(a: Date | null, b: Date): boolean {
  return (
    a !== null &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isSameUtcMonth(a: Date | null, b: Date): boolean {
  return (
    a !== null &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

// The counter value that applies right now — 0 if the window has rolled over
// since the counter was last written.
export function currentDailyCount(
  count: number,
  resetAt: Date | null,
  now: Date = new Date()
): number {
  return isSameUtcDay(resetAt, now) ? count : 0;
}

export function currentMonthlyCount(
  count: number,
  resetAt: Date | null,
  now: Date = new Date()
): number {
  return isSameUtcMonth(resetAt, now) ? count : 0;
}
