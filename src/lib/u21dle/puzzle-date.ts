/**
 * U21dle puzzle calendar dates are interpreted in Israel (Asia/Jerusalem), not UTC.
 * Using UTC midnight from toISOString() made "today" wrong for evening Israel time
 * and caused the UI to show yesterday's puzzle.
 */

export const U21DLE_PUZZLE_TIMEZONE =
  process.env.U21DLE_PUZZLE_TIMEZONE || "Asia/Jerusalem";

/** YYYY-MM-DD for the calendar day in the puzzle timezone (default Israel). */
export function calendarDateInPuzzleTZ(d: Date = new Date(), tz: string = U21DLE_PUZZLE_TIMEZONE): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

/** Default cron: insert puzzle for N calendar days ahead in puzzle TZ (approximate via wall-clock ms). */
export function calendarDateDaysAheadInPuzzleTZ(
  daysAhead: number,
  from: Date = new Date(),
  tz: string = U21DLE_PUZZLE_TIMEZONE
): string {
  const ms = daysAhead * 24 * 60 * 60 * 1000;
  return calendarDateInPuzzleTZ(new Date(from.getTime() + ms), tz);
}

/** Previous calendar day for YYYY-MM-DD (streak: consecutive puzzle dates). */
export function previousCalendarDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  ref.setUTCDate(ref.getUTCDate() - 1);
  const y2 = ref.getUTCFullYear();
  const m2 = String(ref.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(ref.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}
