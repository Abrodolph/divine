/**
 * The payroll engine — the ONE place wages are calculated. Team's payroll,
 * the Attendance Register, payslips and the labour-cost report all call
 * computePayroll(); no screen does its own wage maths.
 *
 * Pure function, no I/O. Inputs are rows as they come from Supabase.
 *
 * Per worker, for the month up to `asOf` (or the day they left):
 *   approval    only entries the office has approved (verified_at) are paid;
 *               the rest are reported as pending_days and pay nothing yet
 *   paid days   entries collapsed to one per day (max 1 unit/day across sites),
 *               plus weekly offs / holidays when the rules say they're paid
 *   Daily       basic = Σ paid units × that day's daily rate
 *   Monthly     basic = Σ paid units × that day's monthly rate ÷ working days,
 *               capped at the working days elapsed ('by_working_days');
 *               or the whole month regardless ('full'); or the whole month
 *               unless absences exceed a threshold ('full_unless_absent')
 *   OT          hours × wagePerHour(day rate) × multiplier
 *   edits       a salary_adjustments row replaces any of: wage per day, days
 *               present (basic = wage/day × days), OT hours; and adds bonus
 *               and penalty. Blank fields keep the attendance figures.
 *   gross       basic + OT + bonus
 *   net         gross − advances taken up to asOf − penalty
 *   balance     net − payments recorded against the month
 */
import { addDays, daysInMonth, eachDate, monthEnd, monthStart } from './dates';
import { byDay, dayCode } from './attendance';

export const DEFAULT_RULES = {
  monthly_proration: 'by_working_days',
  absent_threshold: 0,
  default_working_days: 26,
  standard_hours: 9,
  ot_multiplier: 1.5,
  weekly_off_paid_daily: false,
  weekly_off_paid_monthly: true,
  holiday_paid_daily: false,
  holiday_paid_monthly: true,
  rounding: 'rupee',
};

export const PRORATION_LABEL = {
  by_working_days: 'Pay monthly staff for days present (÷ working days)',
  full_unless_absent: 'Full month unless absences exceed the threshold',
  full: 'Full month regardless of attendance',
};

export function withRules(rules) {
  const out = { ...DEFAULT_RULES };
  Object.entries(rules ?? {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined && k in DEFAULT_RULES) out[k] = v;
  });
  return out;
}

export function roundMoney(n, rounding = 'rupee') {
  const v = Number(n) || 0;
  if (rounding === 'ten') return Math.round(v / 10) * 10;
  if (rounding === 'none') return Math.round(v * 100) / 100;
  return Math.round(v);
}

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** What one hour of work pays: the day's wage over the hours in a working day. */
export function wagePerHour(dayRate, rules) {
  return (Number(dayRate) || 0) / (Number(withRules(rules).standard_hours) || DEFAULT_RULES.standard_hours);
}

/** The rate that applies on `date`: latest effective_from on or before it. */
export function rateOn(rates, employee, date) {
  const mine = rates
    .filter((r) => r.employee_id === employee.id)
    .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  let pick = null;
  mine.forEach((r) => { if (r.effective_from <= date) pick = r; });
  if (!pick && mine.length) [pick] = mine;
  if (pick) return { wage_type: pick.wage_type, rate: Number(pick.rate) || 0 };
  return { wage_type: employee.wage_type === 'Monthly' ? 'Monthly' : 'Daily', rate: Number(employee.wage_rate) || 0 };
}

/**
 * How many of the month's working days have happened by `asOf`, scaled from
 * the calendar (a weekly payout on the 7th isn't docked for the 8th–30th).
 */
export function workingDaysElapsed(month, asOf, workingDays) {
  const end = monthEnd(month);
  if (!asOf || asOf >= end) return workingDays;
  if (asOf < monthStart(month)) return 0;
  const elapsed = Number(asOf.slice(8, 10));
  return Math.min(workingDays, Math.round((workingDays * elapsed) / daysInMonth(month)));
}

/**
 * @param {object} input
 * @param {object[]} input.employees    employees rows
 * @param {object[]} input.rates        employee_rates rows
 * @param {object[]} input.entries      attendance_entries rows (the month, any site)
 * @param {object[]} input.advances     advances rows
 * @param {object[]} input.adjustments  salary_adjustments rows
 * @param {object[]} input.payments     payroll_payments rows
 * @param {object}   input.workingDays  { [site_id]: total_days } for the month
 * @param {object}   input.rules        payroll_rules row
 * @param {string}   input.month        'YYYY-MM'
 * @param {string}   input.asOf         'YYYY-MM-DD' (defaults to month end)
 * @param {string}   [input.siteId]     only this site's attendance (and its workers' advances)
 */
export function computePayroll({
  employees = [], rates = [], entries = [], advances = [], adjustments = [], payments = [],
  workingDays = {}, rules, month, asOf, siteId = null,
}) {
  const R = withRules(rules);
  const start = monthStart(month);
  const end = monthEnd(month);
  const cutoff = asOf && asOf < end ? asOf : end;

  const inRange = (d) => d >= start && d <= cutoff;
  const monthEntries = entries.filter((e) => inRange(e.date) && (!siteId || e.site_id === siteId));

  return employees
    .filter((emp) => {
      const hasActivity = monthEntries.some((e) => e.employee_id === emp.id)
        || payments.some((p) => p.employee_id === emp.id && p.month === month)
        || adjustments.some((a) => a.employee_id === emp.id && a.month === month);
      const onRoll = emp.active !== false || (!!emp.left_on && emp.left_on >= start);
      if (siteId) return hasActivity || (onRoll && emp.site_id === siteId);
      return hasActivity || onRoll;
    })
    .map((emp) => {
      const mine = monthEntries.filter((e) => e.employee_id === emp.id);
      // Pay follows approval: only attendance the office has approved counts.
      const days = [...byDay(mine.filter((e) => e.verified_at)).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
      const allDays = [...byDay(mine).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
      const pendingDays = allDays.filter((d) => d.units > 0 && !d.entries.some((e) => e.verified_at))
        .reduce((n, d) => n + d.units, 0);
      const until = emp.left_on && emp.left_on < cutoff ? emp.left_on : cutoff;
      const current = rateOn(rates, emp, until);
      const monthly = current.wage_type === 'Monthly';
      const wd = Number(workingDays[siteId ?? emp.site_id]) || R.default_working_days;
      const wdElapsed = workingDaysElapsed(month, until, wd);

      let basic = 0;
      let otPay = 0;
      let paidUnits = 0;
      let otHours = 0;
      let rateChanged = false;
      days.forEach((d) => {
        const code = dayCode(d);
        const r = rateOn(rates, emp, d.date);
        if (r.rate !== current.rate || r.wage_type !== current.wage_type) rateChanged = true;
        const isMonthly = r.wage_type === 'Monthly';
        let units = d.units;
        if (code === 'WO' && (isMonthly ? R.weekly_off_paid_monthly : R.weekly_off_paid_daily)) units = 1;
        if (code === 'HOL' && (isMonthly ? R.holiday_paid_monthly : R.holiday_paid_daily)) units = 1;
        const dayRate = isMonthly ? r.rate / wd : r.rate;
        basic += units * dayRate;
        paidUnits += units;
        otHours += d.ot_hours;
        otPay += d.ot_hours * wagePerHour(dayRate, R) * Number(R.ot_multiplier);
      });

      const counts = { P: 0, H: 0, A: 0, L: 0, HOL: 0, WO: 0 };
      days.forEach((d) => { const c = dayCode(d); if (c in counts) counts[c] += 1; });
      const attendanceDays = days.reduce((n, d) => n + d.units, 0);

      // Days the attendance pays for, so that wage/day × days = basic.
      let payDays = paidUnits;
      let rule = null;
      if (monthly) {
        const fullToDate = (current.rate * wdElapsed) / wd;
        const absentDays = Math.max(wdElapsed - paidUnits, 0);
        if (R.monthly_proration === 'full') {
          basic = fullToDate;
          payDays = wdElapsed;
          rule = 'full month';
        } else if (R.monthly_proration === 'full_unless_absent' && absentDays <= Number(R.absent_threshold)) {
          basic = fullToDate;
          payDays = wdElapsed;
          rule = `${absentDays} absent, within ${R.absent_threshold} allowed`;
        } else {
          if (paidUnits > wdElapsed && paidUnits > 0) basic *= wdElapsed / paidUnits;
          payDays = Math.min(paidUnits, wdElapsed);
        }
      }

      const attendancePayDays = payDays;
      const adj = adjustments.find((a) => a.employee_id === emp.id && a.month === month) ?? null;
      const setRate = num(adj?.day_rate);
      const setDays = num(adj?.days_present);
      const setOt = num(adj?.ot_hours);
      const dayRate = setRate ?? (monthly ? current.rate / wd : current.rate);
      if (setDays !== null) payDays = setDays;
      if (setRate !== null || setDays !== null) basic = dayRate * payDays;
      const hours = setOt ?? otHours;
      if (setRate !== null || setOt !== null) otPay = hours * wagePerHour(dayRate, R) * Number(R.ot_multiplier);
      const bonus = Number(adj?.bonus) || 0;
      const penalty = Number(adj?.penalty) || 0;

      const counted = !siteId || emp.site_id === siteId;
      const advanceTotal = counted
        ? advances.filter((a) => a.employee_id === emp.id && inRange(a.date)).reduce((s, a) => s + (Number(a.amount) || 0), 0)
        : 0;

      const perHour = wagePerHour(dayRate, R);
      const mult = Number(R.ot_multiplier);
      const salaryLabel = setRate === null && setDays === null && (rateChanged || rule)
        ? `${r2(payDays)} day${payDays === 1 ? '' : 's'}${rule ? ` (${rule})` : ' at the rates in force'}`
        : `${r2(payDays)} day${payDays === 1 ? '' : 's'} × ${inrPlain(r2(dayRate))}/day`;
      const breakdown = [{ label: salaryLabel, amount: r2(basic), override: setRate !== null || setDays !== null }];
      if (otPay > 0) {
        breakdown.push({
          label: `Overtime ${r2(hours)} h × ${inrPlain(r2(perHour))}/h${mult !== 1 ? ` × ${mult}` : ''}`,
          amount: r2(otPay), override: setOt !== null,
        });
      }
      // `bonus` is the stored column; "Extra" is what the office calls it.
      if (bonus) breakdown.push({ label: 'Extra', amount: bonus, override: true });
      if (advanceTotal) breakdown.push({ label: 'Advances taken', amount: -advanceTotal });
      if (penalty) breakdown.push({ label: 'Penalty', amount: -penalty, override: true });

      const gross = basic + otPay + bonus;
      const net = roundMoney(gross - advanceTotal - penalty, R.rounding);
      const paid = payments.filter((p) => p.employee_id === emp.id && p.month === month)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);

      return {
        employee_id: emp.id,
        name: emp.name,
        trade: emp.trade,
        site_id: emp.site_id,
        left_on: emp.left_on ?? null,
        wage_type: current.wage_type,
        rate: current.rate,
        day_rate: r2(dayRate),
        hourly_rate: r2(perHour),
        days_present: setDays ?? attendanceDays,
        paid_days: r2(payDays),
        attendance_days: attendanceDays,
        attendance_pay_days: r2(attendancePayDays),
        attendance_ot_hours: r2(otHours),
        half_days: counts.H,
        absent: counts.A,
        leave: counts.L,
        holidays: counts.HOL,
        weekly_offs: counts.WO,
        ot_hours: r2(hours),
        working_days: wd,
        working_days_elapsed: wdElapsed,
        gross_basic: r2(basic),
        gross_ot: r2(otPay),
        bonus,
        penalty,
        gross: r2(gross),
        pending_days: r2(pendingDays),
        advances: advanceTotal,
        adjustment: adj,
        edited: !!adj && (setRate !== null || setDays !== null || setOt !== null || bonus > 0 || penalty > 0),
        net,
        paid_so_far: paid,
        balance: roundMoney(net - paid, 'none'),
        breakdown,
        days: allDays.map((d) => ({
          date: d.date, code: dayCode(d), units: d.units, ot_hours: d.ot_hours,
          pending: d.units > 0 && !d.entries.some((e) => e.verified_at),
        })),
      };
    });
}

export function payrollTotals(rows) {
  return rows.reduce((t, r) => ({
    gross: t.gross + r.gross,
    pending_days: t.pending_days + (r.pending_days || 0),
    bonus: t.bonus + (r.bonus || 0),
    advances: t.advances + r.advances,
    penalty: t.penalty + (r.penalty || 0),
    net: t.net + r.net,
    paid: t.paid + r.paid_so_far,
    balance: t.balance + r.balance,
    days: t.days + r.days_present,
  }), { gross: 0, pending_days: 0, bonus: 0, advances: 0, penalty: 0, net: 0, paid: 0, balance: 0, days: 0 });
}

/** Labour cost per site for a month: attendance-weighted gross (before advances). */
export function labourCostBySite({ sites, ...input }) {
  return sites.map((s) => {
    const rows = computePayroll({ ...input, siteId: s.id }).filter((r) => r.days_present > 0);
    const gross = rows.reduce((n, r) => n + r.gross, 0);
    const days = rows.reduce((n, r) => n + r.days_present, 0);
    return { site_id: s.id, name: s.name, workers: rows.length, worker_days: days, gross: r2(gross), per_day: days ? r2(gross / days) : 0 };
  });
}

const inrPlain = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Re-exported for screens that page through a month.
export { addDays, eachDate };
