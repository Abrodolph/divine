import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtTime, inr, localDate, thisMonth, today } from './format';
import { addDays, daysInMonth, defaultAsOf, eachDate, monthEnd, nextMonthStart, weekStart, weekday } from './dates';
import { toCSV } from './csv';

describe('local dates (TZ=Asia/Kolkata)', () => {
  afterEach(() => vi.useRealTimers());

  it('is still the site day at 02:00 IST, when UTC is the day before', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T20:30:00Z')); // 02:00 IST on the 13th
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-12');
    expect(today()).toBe('2026-09-13');
  });

  it('is already the new month at 01:00 IST on the 1st', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T19:30:00Z')); // 01:00 IST on 1 Oct
    expect(thisMonth()).toBe('2026-10');
  });

  it('formats a Date as YYYY-MM-DD without UTC shift', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('date helpers', () => {
  it('walks month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(nextMonthStart('2026-12')).toBe('2027-01-01');
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthEnd('2026-09')).toBe('2026-09-30');
  });

  it('lists every day in a range and knows weekdays', () => {
    expect(eachDate('2026-09-28', '2026-10-02')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(weekday('2026-09-13')).toBe(0); // Sunday
    expect(weekStart('2026-09-13')).toBe('2026-09-07');
    expect(weekStart('2026-09-07')).toBe('2026-09-07');
  });

  it('defaults "as of" to month end for past months', () => {
    expect(defaultAsOf('2026-02')).toBe('2026-02-28');
  });
});

describe('formatting', () => {
  it('formats rupees and times', () => {
    expect(inr(125000)).toBe('₹1,25,000');
    expect(inr(null)).toBe('₹0');
    expect(fmtTime('09:05:00')).toBe('09:05');
  });

  it('escapes CSV cells', () => {
    const csv = toCSV([{ key: 'a', label: 'Name' }, { key: 'b', label: 'Note', value: (r) => r.b.toUpperCase() }], [{ a: 'Ravi "R"', b: 'x,y' }]);
    expect(csv).toBe('"Name","Note"\n"Ravi ""R""","X,Y"');
  });
});
