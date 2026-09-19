import { describe, expect, it } from 'vitest';
import { computePayroll, labourCostBySite, payrollTotals, rateOn, roundMoney, wagePerHour, workingDaysElapsed } from './payroll';
// weekLabel lives in dates.js (there is no dates.test.js yet) and only payroll
// uses it — the week on a logged advance.
import { weekLabel, weekStart } from './dates';

const M = '2026-09';
const A = 'site-a';
const B = 'site-b';
const daily = { id: 'd1', name: 'Ravi', site_id: A, wage_type: 'Daily', wage_rate: 700 };
const monthly = { id: 'm1', name: 'Sunil', site_id: A, wage_type: 'Monthly', wage_rate: 26000 };

const day = (n) => `${M}-${String(n).padStart(2, '0')}`;
const APPROVED = `${M}-30T10:00:00Z`;
const entry = (emp, n, extra = {}) => ({
  employee_id: emp.id, site_id: A, date: day(n), units: 1, status: 'present', ot_hours: 0, verified_at: APPROVED, ...extra,
});
const days = (emp, from, to, extra) => Array.from({ length: to - from + 1 }, (_, i) => entry(emp, from + i, extra));
const run = (input) => computePayroll({ month: M, workingDays: { [A]: 26 }, ...input });
const only = (rows) => { expect(rows).toHaveLength(1); return rows[0]; };

describe('daily workers', () => {
  it('pays days × rate', () => {
    const r = only(run({ employees: [daily], entries: days(daily, 1, 20) }));
    expect(r).toMatchObject({ days_present: 20, gross: 14000, net: 14000, balance: 14000 });
  });

  it('pays half days as half', () => {
    const r = only(run({ employees: [daily], entries: [entry(daily, 1), entry(daily, 2, { units: 0.5, status: 'half' })] }));
    expect(r).toMatchObject({ days_present: 1.5, half_days: 1, gross: 1050 });
  });

  it('pays OT at the wage per hour of a 9-hour day × multiplier', () => {
    expect(wagePerHour(900)).toBe(100);
    expect(wagePerHour(800, { standard_hours: 8 })).toBe(100);
    const r = only(run({ employees: [daily], entries: [entry(daily, 1, { ot_hours: 2 })] }));
    // 700 + 2 × (700/9) × 1.5 = 700 + 233.33
    expect(r).toMatchObject({ gross_basic: 700, gross_ot: 233.33, gross: 933.33, net: 933, hourly_rate: 77.78 });
  });

  it('applies a mid-month rate change to the days after it', () => {
    const rates = [
      { employee_id: 'd1', effective_from: '2000-01-01', wage_type: 'Daily', rate: 700 },
      { employee_id: 'd1', effective_from: day(11), wage_type: 'Daily', rate: 800 },
    ];
    const r = only(run({ employees: [daily], rates, entries: days(daily, 1, 20) }));
    expect(r.gross).toBe(10 * 700 + 10 * 800);
    expect(r.rate).toBe(800);
  });

  it('does not pay weekly offs or holidays by default', () => {
    const r = only(run({ employees: [daily], entries: [entry(daily, 1), entry(daily, 6, { units: 0, status: 'weekly_off' }), entry(daily, 7, { units: 0, status: 'holiday' })] }));
    expect(r).toMatchObject({ days_present: 1, weekly_offs: 1, holidays: 1, gross: 700 });
  });

  it('pays weekly offs when the rules say so', () => {
    const r = only(run({ employees: [daily], rules: { weekly_off_paid_daily: true }, entries: [entry(daily, 1), entry(daily, 6, { units: 0, status: 'weekly_off' })] }));
    expect(r.gross).toBe(1400);
  });
});

describe('monthly workers', () => {
  it('full attendance earns the full wage', () => {
    const r = only(run({ employees: [monthly], entries: days(monthly, 1, 26) }));
    expect(r.gross).toBe(26000);
  });

  it('absences are docked per working day', () => {
    const r = only(run({ employees: [monthly], entries: days(monthly, 1, 24) }));
    expect(r.gross).toBe(24000);
  });

  it('never pays more than the working days, even with extra days marked', () => {
    const r = only(run({ employees: [monthly], entries: days(monthly, 1, 30) }));
    expect(r.gross).toBe(26000);
  });

  it('as-of a date part-way through the month only counts elapsed working days', () => {
    const r = only(run({ employees: [monthly], entries: days(monthly, 1, 10), asOf: day(10) }));
    // 26 × 10/30 = 8.67 → 9 working days elapsed; 9 × 1000
    expect(r.working_days_elapsed).toBe(9);
    expect(r.gross).toBe(9000);
  });

  it("'full' pays the month regardless of attendance", () => {
    const r = only(run({ employees: [monthly], rules: { monthly_proration: 'full' }, entries: days(monthly, 1, 5) }));
    expect(r.gross).toBe(26000);
  });

  it("'full_unless_absent' pays full within the threshold and prorates beyond it", () => {
    const rules = { monthly_proration: 'full_unless_absent', absent_threshold: 2 };
    expect(only(run({ employees: [monthly], rules, entries: days(monthly, 1, 24) })).gross).toBe(26000);
    expect(only(run({ employees: [monthly], rules, entries: days(monthly, 1, 23) })).gross).toBe(23000);
  });

  it('weekly offs are paid for monthly staff by default', () => {
    const r = only(run({ employees: [monthly], entries: [...days(monthly, 1, 3), entry(monthly, 6, { units: 0, status: 'weekly_off' })] }));
    expect(r.paid_days).toBe(4);
    expect(r.gross).toBe(4000);
  });

  it('uses the default working days when the site has none set', () => {
    const r = only(computePayroll({ month: M, employees: [monthly], entries: days(monthly, 1, 13), workingDays: {} }));
    expect(r.working_days).toBe(26);
    expect(r.gross).toBe(13000);
  });

  it('mid-month raise prorates each day at its own rate', () => {
    const rates = [
      { employee_id: 'm1', effective_from: '2000-01-01', wage_type: 'Monthly', rate: 26000 },
      { employee_id: 'm1', effective_from: day(14), wage_type: 'Monthly', rate: 39000 },
    ];
    const r = only(run({ employees: [monthly], rates, entries: days(monthly, 1, 26) }));
    expect(r.gross).toBe(13 * 1000 + 13 * 1500);
  });
});

describe('pay waits for approval', () => {
  it('attendance the office has not approved pays nothing yet', () => {
    const r = only(run({ employees: [daily], entries: days(daily, 1, 5, { verified_at: null }) }));
    expect(r).toMatchObject({ paid_days: 0, gross: 0, pending_days: 5 });
    expect(r.days.every((d) => d.pending)).toBe(true);
  });

  it('pays the approved days and reports the rest as pending', () => {
    const entries = [...days(daily, 1, 8), ...days(daily, 9, 10, { verified_at: null })];
    const r = only(run({ employees: [daily], entries }));
    expect(r).toMatchObject({ paid_days: 8, gross: 5600, pending_days: 2 });
    expect(r.days).toHaveLength(10);
    expect(payrollTotals([r]).pending_days).toBe(2);
  });

  it('an approved absence stays absent and pays nothing', () => {
    const r = only(run({ employees: [daily], entries: [entry(daily, 1), entry(daily, 2, { units: 0, status: 'absent' })] }));
    expect(r).toMatchObject({ gross: 700, absent: 1, pending_days: 0 });
  });
});

describe('payroll edits, advances and payments', () => {
  const adj = (fields) => [{ employee_id: 'd1', month: M, bonus: 0, penalty: 0, ...fields }];

  it('a wage per day replaces the rate for the month', () => {
    const r = only(run({ employees: [daily], adjustments: adj({ day_rate: 800 }), entries: days(daily, 1, 10) }));
    expect(r).toMatchObject({ day_rate: 800, paid_days: 10, gross: 8000, edited: true });
  });

  it('days present replace the attendance count', () => {
    const r = only(run({ employees: [daily], adjustments: adj({ days_present: 12 }), entries: days(daily, 1, 10) }));
    expect(r).toMatchObject({ days_present: 12, attendance_days: 10, gross: 8400 });
  });

  it('works for monthly staff as monthly wage ÷ working days × days', () => {
    const adjustments = [{ employee_id: 'm1', month: M, days_present: 20, bonus: 0, penalty: 0 }];
    const r = only(run({ employees: [monthly], adjustments, entries: days(monthly, 1, 18) }));
    expect(r).toMatchObject({ day_rate: 1000, gross: 20000 });
  });

  it('OT hours are paid at the (edited) wage per hour', () => {
    const r = only(run({ employees: [daily], rules: { ot_multiplier: 1 }, adjustments: adj({ day_rate: 900, ot_hours: 3 }), entries: days(daily, 1, 2) }));
    expect(r).toMatchObject({ gross_basic: 1800, ot_hours: 3, gross_ot: 300, gross: 2100 });
  });

  it('the extra (stored as bonus) adds to net and penalty and advances come off it', () => {
    const advances = [{ employee_id: 'd1', date: day(3), amount: 1000 }];
    const r = only(run({ employees: [daily], advances, adjustments: adj({ bonus: 500, penalty: 200 }), entries: days(daily, 1, 10) }));
    expect(r).toMatchObject({ gross: 7500, net: 6300 });
    expect(r.breakdown.map((b) => b.label)).toEqual(['10 days × ₹700/day', 'Extra', 'Advances taken', 'Penalty']);
    expect(payrollTotals([r])).toMatchObject({ bonus: 500, penalty: 200, net: 6300 });
  });

  it('blank edit fields keep the attendance figures', () => {
    const r = only(run({ employees: [daily], adjustments: adj({ day_rate: null, days_present: null, ot_hours: null }), entries: days(daily, 1, 5, { ot_hours: 1 }) }));
    expect(r).toMatchObject({ gross_basic: 3500, ot_hours: 5, edited: false });
  });

  it('an edit from another month is ignored', () => {
    const adjustments = [{ employee_id: 'd1', month: '2026-08', day_rate: 99999 }];
    expect(only(run({ employees: [daily], adjustments, entries: days(daily, 1, 2) })).gross).toBe(1400);
  });

  it('advances larger than earnings leave a negative net', () => {
    const advances = [{ employee_id: 'd1', date: day(2), amount: 3000 }];
    const r = only(run({ employees: [daily], advances, entries: days(daily, 1, 2) }));
    expect(r).toMatchObject({ gross: 1400, advances: 3000, net: -1600 });
  });

  it('only counts advances up to the as-of date', () => {
    const advances = [{ employee_id: 'd1', date: day(2), amount: 500 }, { employee_id: 'd1', date: day(20), amount: 500 }];
    expect(only(run({ employees: [daily], advances, entries: days(daily, 1, 5), asOf: day(7) })).advances).toBe(500);
  });

  it('payments reduce the balance, not the net', () => {
    const payments = [{ employee_id: 'd1', month: M, amount: 5000 }, { employee_id: 'd1', month: M, amount: 2000 }];
    const r = only(run({ employees: [daily], payments, entries: days(daily, 1, 20) }));
    expect(r).toMatchObject({ net: 14000, paid_so_far: 7000, balance: 7000 });
  });
});

describe('sites, rounding and edge cases', () => {
  it('a worker marked at two sites on one day is paid one day', () => {
    const r = only(run({ employees: [daily], entries: [entry(daily, 1), entry(daily, 1, { site_id: B })] }));
    expect(r.gross).toBe(700);
  });

  it('a site view only counts that site\'s attendance', () => {
    const entries = [entry(daily, 1), entry(daily, 2, { site_id: B })];
    expect(only(run({ employees: [daily], entries, siteId: B })).gross).toBe(700);
  });

  it('rounds to the nearest ten when configured', () => {
    expect(roundMoney(1234.5, 'ten')).toBe(1230);
    expect(roundMoney(1235, 'ten')).toBe(1240);
    expect(roundMoney(12.345, 'none')).toBe(12.35);
  });

  it('an empty month lists active workers at zero and skips people who left', () => {
    const rows = run({ employees: [daily, { ...monthly, active: false }] });
    expect(rows.map((r) => [r.name, r.gross])).toEqual([['Ravi', 0]]);
  });

  it('someone who left mid-month still appears if they worked', () => {
    const rows = run({ employees: [{ ...daily, active: false }], entries: days(daily, 1, 3) });
    expect(rows[0].gross).toBe(2100);
  });

  it('a monthly worker who left is paid only up to the day they left', () => {
    const left = { ...monthly, active: false, left_on: day(15) };
    const r = only(run({ employees: [left], rules: { monthly_proration: 'full' } }));
    // 26 × 15/30 = 13 working days elapsed by the leaving date
    expect(r).toMatchObject({ working_days_elapsed: 13, gross: 13000, left_on: day(15) });
    expect(run({ employees: [{ ...left, left_on: '2026-08-20' }] })).toHaveLength(0);
  });

  it('picks the right rate and elapsed working days', () => {
    expect(rateOn([], daily, day(1))).toEqual({ wage_type: 'Daily', rate: 700 });
    expect(workingDaysElapsed(M, '2026-10-05', 26)).toBe(26);
    expect(workingDaysElapsed(M, '2026-08-31', 26)).toBe(0);
  });

  it('totals rows and costs labour per site', () => {
    const entries = [...days(daily, 1, 10), ...days(daily, 11, 15, { site_id: B })];
    const rows = run({ employees: [daily], entries });
    expect(payrollTotals(rows)).toMatchObject({ gross: 10500, net: 10500, days: 15 });
    const cost = labourCostBySite({ sites: [{ id: A, name: 'A' }, { id: B, name: 'B' }], month: M, employees: [daily], entries, workingDays: {} });
    expect(cost.map((c) => [c.name, c.worker_days, c.gross, c.per_day])).toEqual([['A', 10, 7000, 700], ['B', 5, 3500, 700]]);
  });
});

describe('the week label on an advance', () => {
  it('names the Monday–Sunday week containing the date', () => {
    expect(weekStart('2026-09-18')).toBe('2026-09-14'); // Friday → that Monday
    expect(weekLabel('2026-09-18')).toBe('14–20 Sep 2026');
  });

  it('gives the same label for every day of that week', () => {
    const labels = ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-19', '2026-09-20'].map(weekLabel);
    expect(new Set(labels)).toEqual(new Set(['14–20 Sep 2026']));
  });

  it('spells out both months when the week straddles them', () => {
    expect(weekLabel('2026-10-01')).toBe('28 Sep – 4 Oct 2026');
  });

  it('spells out both years over new year', () => {
    expect(weekLabel('2026-01-01')).toBe('29 Dec 2025 – 4 Jan 2026');
  });

  it('is blank without a date', () => {
    expect(weekLabel('')).toBe('');
  });
});
