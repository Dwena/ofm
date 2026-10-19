/**
 * Time buckets shared by the creator analytics and revenue statistics.
 *
 * Every computation is done in UTC so the keys do not depend on the server
 * time zone. Weeks start on Monday (ISO / French convention).
 *
 * Keys: DAY `YYYY-MM-DD`, WEEK `YYYY-MM-DD` (the Monday), MONTH `YYYY-MM`, YEAR `YYYY`.
 */
export type PeriodInterval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** First instant (UTC) of the period containing `date` */
export function startOfPeriod(date: Date, interval: PeriodInterval): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  switch (interval) {
    case 'WEEK': {
      const day = d.getUTCDay(); // 0 = Sunday
      d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
      return d;
    }
    case 'MONTH':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case 'YEAR':
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    default:
      return d;
  }
}

/** Move a period start by `count` periods (negative goes back) */
export function addPeriods(date: Date, interval: PeriodInterval, count: number): Date {
  const d = new Date(date);
  switch (interval) {
    case 'WEEK':
      d.setUTCDate(d.getUTCDate() + count * 7);
      break;
    case 'MONTH':
      d.setUTCMonth(d.getUTCMonth() + count);
      break;
    case 'YEAR':
      d.setUTCFullYear(d.getUTCFullYear() + count);
      break;
    default:
      d.setUTCDate(d.getUTCDate() + count);
  }
  return d;
}

/** Grouping key of the period containing `date` */
export function getPeriodKey(date: Date, interval: PeriodInterval): string {
  const start = startOfPeriod(new Date(date), interval);
  switch (interval) {
    case 'MONTH':
      return isoDay(start).slice(0, 7);
    case 'YEAR':
      return String(start.getUTCFullYear());
    default:
      return isoDay(start);
  }
}

/**
 * Date range covering the last `periods` periods, the current one included
 * (e.g. DAY x 30 = the 29 previous days + today). Explicit dates win.
 */
export function resolvePeriodRange(
  interval: PeriodInterval,
  periods: number,
  startDate?: string,
  endDate?: string,
): { start: Date; end: Date } {
  const end = endDate ? new Date(endDate) : new Date();
  const count = Math.max(1, Math.floor(periods) || 1);
  const start = startDate
    ? new Date(startDate)
    : addPeriods(startOfPeriod(end, interval), interval, -(count - 1));
  return { start, end };
}

/** Every period key between `start` and `end` (inclusive), in order */
export function buildPeriodKeys(start: Date, end: Date, interval: PeriodInterval, max = 1000): string[] {
  const keys: string[] = [];
  let cursor = startOfPeriod(start, interval);
  while (cursor <= end && keys.length < max) {
    keys.push(getPeriodKey(cursor, interval));
    cursor = addPeriods(cursor, interval, 1);
  }
  return keys;
}

/** Ordered map pre-filled with one empty bucket per period, so charts have no gaps */
export function createPeriodMap<T>(
  start: Date,
  end: Date,
  interval: PeriodInterval,
  empty: (period: string) => T,
): Map<string, T> {
  const map = new Map<string, T>();
  buildPeriodKeys(start, end, interval).forEach((key) => map.set(key, empty(key)));
  return map;
}
