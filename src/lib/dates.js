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
