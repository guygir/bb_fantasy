/**
 * Must match `.github/workflows/promotions-leagues.yml` schedule:
 * `0 20 * * 2,6` → Tuesday & Saturday 20:00 UTC
 */
const CRON_HOUR_UTC = 20;
const CRON_MINUTE_UTC = 0;
/** 0 = Sunday … 6 = Saturday (same as cron) */
const CRON_WEEKDAYS = new Set([2, 6]);

/**
 * Next GitHub Actions scheduled run time for promotions (UTC), strictly after `after`.
 */
export function getNextPromotionsScheduledRunUtc(after: Date = new Date()): Date {
  for (let i = 0; i < 21; i++) {
    const d = new Date(
      Date.UTC(
        after.getUTCFullYear(),
        after.getUTCMonth(),
        after.getUTCDate() + i,
        CRON_HOUR_UTC,
        CRON_MINUTE_UTC,
        0,
        0
      )
    );
    if (!CRON_WEEKDAYS.has(d.getUTCDay())) continue;
    if (d.getTime() <= after.getTime()) continue;
    return d;
  }
  throw new Error("getNextPromotionsScheduledRunUtc: no slot in window");
}
