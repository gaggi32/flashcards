// Calendar days, kept deliberately dumb.
//
// Every day in this app is a bare YYYY-MM-DD string decided by the *client*,
// because only the browser knows the user's timezone. The server never calls
// `new Date()` to work out "today": on Vercel (fra1, UTC) that would file a
// 00:30 CEST snack under yesterday. Postgres stores these as DATE.

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD for a Date, read in *local* time. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today in the caller's timezone. Only ever called in the browser. */
export function todayKey(): string {
  return toDayKey(new Date());
}

/** Shift a day key by whole days without tripping over DST. */
export function addDays(dayKey: string, delta: number): string {
  const d = parseDayKey(dayKey);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** A day key as the UTC-midnight Date that Postgres DATE round-trips to. */
export function parseDayKey(dayKey: string): Date {
  if (!DAY_RE.test(dayKey)) {
    throw new Error(`Invalid day key: ${dayKey}`);
  }
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid day key: ${dayKey}`);
  }
  return d;
}

/** Back the other way: a DATE column read by Prisma is already UTC midnight. */
export function dayKeyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The `count` day keys ending at (and including) `endDayKey`, oldest first. */
export function dayRange(endDayKey: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addDays(endDayKey, -i));
  return out;
}

export function formatDayLabel(dayKey: string, todayDayKey: string): string {
  if (dayKey === todayDayKey) return 'today';
  if (dayKey === addDays(todayDayKey, -1)) return 'yesterday';
  const d = parseDayKey(dayKey);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
