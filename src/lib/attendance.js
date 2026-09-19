/**
 * Attendance rules, as pure functions.
 *
 * The database (attendance_entry_before() in supabase/schema.sql) is the
 * authority — it recomputes units, OT and late minutes on every save. This
 * file mirrors that logic so screens can preview "half day", "1.5 h OT",
 * "40 min late" before the supervisor taps Save, and so it can be unit-tested.
 * Change both together.
 */

export const DEFAULT_SITE_SETTINGS = {
  capture_mode: 'muster',
  require_photo: false,
  require_gps: false,
  edit_window_hours: 24,
  shift_start: '09:00',
  shift_end: '18:00',
  grace_min: 15,
  half_day_hours: 4,
  ot_after_hours: 9,
  ot_round_min: 30,
  weekly_off_day: null,
  // A day closes once it has passed: the site can't add or change yesterday.
  // Admin and Verify Attendance still can (see attendance_day_open in schema.sql).
  freeze_daily: true,
};

export function withDefaults(settings) {
  const out = { ...DEFAULT_SITE_SETTINGS };
  Object.entries(settings ?? {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) out[k] = v;
  });
  out.shift_start = String(out.shift_start).slice(0, 5);
  out.shift_end = String(out.shift_end).slice(0, 5);
  return out;
}

export const STATUSES = ['present', 'half', 'absent', 'leave', 'holiday', 'weekly_off'];
export const STATUS_CODE = { present: 'P', half: 'H', absent: 'A', leave: 'L', holiday: 'HOL', weekly_off: 'WO' };
export const STATUS_LABEL = {
  present: 'Present', half: 'Half day', absent: 'Absent', leave: 'Leave', holiday: 'Holiday', weekly_off: 'Weekly off',
};
const OFF_STATUSES = ['absent', 'leave', 'holiday', 'weekly_off'];

export const FLAG_LABEL = {
  outside_radius: 'Outside site radius',
  no_gps: 'No GPS',
  no_photo: 'No photo',
  early_mark: 'Marked before 5 AM',
  backdated: 'Back-dated',
  edited_late: 'Edited after edit window',
  duplicate_day: 'Two sites same day',
  override_allowed: 'Two-site override',
  rejected: 'Rejected',
};

/** '09:30' → 570 */
export function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Hours between in and out; an out time before the in time means past midnight. */
export function workedHours(inTime, outTime) {
  const a = toMinutes(inTime);
  const b = toMinutes(outTime);
  if (a === null || b === null) return null;
  let mins = b - a;
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

/**
 * { status, in_time, out_time, ot_hours } + site settings →
 * { status, units, ot_hours, late_min, hours }
 */
export function classifyEntry(entry, siteSettings) {
  const s = withDefaults(siteSettings);
  let status = entry.status || 'present';
  if (OFF_STATUSES.includes(status)) {
    return { status, units: 0, ot_hours: 0, late_min: 0, hours: null };
  }

  const hours = workedHours(entry.in_time, entry.out_time);
  let ot = Math.max(Number(entry.ot_hours) || 0, 0);
  if (hours !== null) {
    if (status === 'present' && hours < Number(s.half_day_hours)) status = 'half';
    const after = Number(s.ot_after_hours);
    const round = Math.max(Number(s.ot_round_min) || 30, 1);
    ot = hours > after ? (Math.floor(((hours - after) * 60) / round) * round) / 60 : 0;
  }

  let late = 0;
  const inMin = toMinutes(entry.in_time);
  if (inMin !== null) {
    const diff = inMin - toMinutes(s.shift_start);
    late = diff > Number(s.grace_min) ? Math.round(diff) : 0;
  }

  return { status, units: status === 'half' ? 0.5 : 1, ot_hours: ot, late_min: late, hours };
}

/** True while the entry is inside its site's edit window. */
export function inEditWindow(markedAt, siteSettings, now = new Date()) {
  if (!markedAt) return true;
  const hours = withDefaults(siteSettings).edit_window_hours;
  return new Date(markedAt).getTime() > now.getTime() - hours * 3600 * 1000;
}

export const needsReview = (e) => (e.flags?.length ?? 0) > 0 && !e.verified_at;

/**
 * Collapse a worker's entries to one record per day. A worker can appear at
 * two sites on one day (with an Admin override); pay never exceeds one day.
 */
export function byDay(entries) {
  const days = new Map();
  entries.forEach((e) => {
    const d = days.get(e.date) ?? { date: e.date, units: 0, ot_hours: 0, statuses: [], sites: [], entries: [] };
    d.units = Math.min(1, d.units + (Number(e.units) || 0));
    d.ot_hours += Number(e.ot_hours) || 0;
    d.statuses.push(e.status);
    d.sites.push(e.site_id);
    d.entries.push(e);
    days.set(e.date, d);
  });
  return days;
}

/** The single code shown in a register cell for one worker-day. */
export function dayCode(day) {
  if (!day) return '';
  if (day.units >= 1) return 'P';
  if (day.units === 0.5) return 'H';
  const s = day.statuses;
  if (s.includes('leave')) return 'L';
  if (s.includes('holiday')) return 'HOL';
  if (s.includes('weekly_off')) return 'WO';
  if (s.includes('absent')) return 'A';
  return '';
}

export function summarize(entries) {
  const days = [...byDay(entries).values()];
  const count = (code) => days.filter((d) => dayCode(d) === code).length;
  return {
    days_present: days.reduce((n, d) => n + d.units, 0),
    half_days: count('H'),
    absent: count('A'),
    leave: count('L'),
    holidays: count('HOL'),
    weekly_offs: count('WO'),
    ot_hours: days.reduce((n, d) => n + d.ot_hours, 0),
  };
}
