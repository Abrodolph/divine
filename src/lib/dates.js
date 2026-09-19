/**
 * Calendar maths on plain 'YYYY-MM-DD' / 'YYYY-MM' strings. Everything works
 * in local dates (no UTC conversion), so a day is a site day.
 */
import { localDate, thisMonth, today } from './format';

const parse = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
};

export function addDays(date, n) {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export const monthStart = (month) => `${month}-01`;
export const monthEnd = (month) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

/** First day of the following month — handy as an exclusive upper bound. */
export function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  return localDate(new Date(y, m, 1));
}

/** Every date from start to end inclusive. */
export function eachDate(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday … 6 = Saturday */
export const weekday = (date) => parse(date).getDay();

/** Today, if `month` is the current month — otherwise its last day. */
export const defaultAsOf = (month) => (month === thisMonth() ? today() : monthEnd(month));

/** Monday of the week containing `date`. */
export function weekStart(date) {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The Monday–Sunday week containing `date`, written the way the office says it:
 *   '2026-09-17' → '15–21 Sep 2026'
 *   '2026-10-01' → '28 Sep – 4 Oct 2026'   (week spans two months)
 *   '2026-01-01' → '29 Dec 2025 – 4 Jan 2026'
 * Used as the default label on an advance.
 */
export function weekLabel(date) {
  if (!date) return '';
  const start = weekStart(date);
  const end = addDays(start, 6);
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const tail = `${ed} ${MONTH_SHORT[em - 1]} ${ey}`;
  if (sy === ey && sm === em) return `${sd}–${tail}`;
  return `${sd} ${MONTH_SHORT[sm - 1]}${sy === ey ? '' : ` ${sy}`} – ${tail}`;
}
