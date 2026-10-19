import { buildPeriodKeys, getPeriodKey, resolvePeriodRange, startOfPeriod } from './periods';

describe('period helpers', () => {
  it('builds UTC keys, weeks starting on Monday', () => {
    const date = new Date('2026-10-18T23:30:00Z'); // Sunday
    expect(getPeriodKey(date, 'DAY')).toBe('2026-10-18');
    expect(getPeriodKey(date, 'WEEK')).toBe('2026-10-12');
    expect(getPeriodKey(new Date('2026-10-19T00:00:00Z'), 'WEEK')).toBe('2026-10-19');
    expect(getPeriodKey(date, 'MONTH')).toBe('2026-10');
    expect(getPeriodKey(date, 'YEAR')).toBe('2026');
  });

  it('covers exactly the last N periods, the current one included', () => {
    const end = new Date('2026-10-19T16:00:00Z');

    const days = resolvePeriodRange('DAY', 7, undefined, end.toISOString());
    expect(days.start.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(buildPeriodKeys(days.start, days.end, 'DAY')).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);

    const months = resolvePeriodRange('MONTH', 12, undefined, end.toISOString());
    const monthKeys = buildPeriodKeys(months.start, months.end, 'MONTH');
    expect(monthKeys).toHaveLength(12);
    expect(monthKeys[0]).toBe('2025-11');
    expect(monthKeys[11]).toBe('2026-10');

    const weeks = resolvePeriodRange('WEEK', 13, undefined, end.toISOString());
    expect(buildPeriodKeys(weeks.start, weeks.end, 'WEEK')).toHaveLength(13);
  });

  it('honours explicit dates', () => {
    const range = resolvePeriodRange('DAY', 30, '2026-01-10T12:00:00Z', '2026-01-12T08:00:00Z');
    expect(buildPeriodKeys(range.start, range.end, 'DAY')).toEqual(['2026-01-10', '2026-01-11', '2026-01-12']);
    expect(startOfPeriod(range.start, 'MONTH').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
