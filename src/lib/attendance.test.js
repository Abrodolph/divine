import { describe, expect, it } from 'vitest';
import { byDay, classifyEntry, dayCode, inEditWindow, needsReview, summarize, withDefaults, workedHours } from './attendance';

const site = { shift_start: '09:00:00', grace_min: 15, half_day_hours: 4, ot_after_hours: 9, ot_round_min: 30 };

describe('classifyEntry', () => {
  it('on time, full day', () => {
    expect(classifyEntry({ in_time: '09:05', out_time: '18:00' }, site))
      .toMatchObject({ status: 'present', units: 1, ot_hours: 0, late_min: 0, hours: 8.9166666666666661 });
  });

  it('late within grace is not late', () => {
    expect(classifyEntry({ in_time: '09:15' }, site).late_min).toBe(0);
  });

  it('late beyond grace counts from shift start', () => {
    expect(classifyEntry({ in_time: '09:40' }, site).late_min).toBe(40);
  });

  it('under the half-day threshold becomes a half day', () => {
    expect(classifyEntry({ in_time: '09:00', out_time: '12:30' }, site)).toMatchObject({ status: 'half', units: 0.5 });
  });

  it('a manual half day stays half even with long hours', () => {
    expect(classifyEntry({ status: 'half', in_time: '09:00', out_time: '18:00' }, site).units).toBe(0.5);
  });

  it('OT is rounded down to the site\'s step', () => {
    expect(classifyEntry({ in_time: '09:00', out_time: '19:50' }, site).ot_hours).toBe(1.5);
    expect(classifyEntry({ in_time: '09:00', out_time: '18:20' }, site).ot_hours).toBe(0);
  });

  it('missing out-time keeps the manually entered OT', () => {
    expect(classifyEntry({ in_time: '09:00', ot_hours: '2' }, site)).toMatchObject({ units: 1, ot_hours: 2, hours: null });
  });

  it('night shift past midnight', () => {
    expect(workedHours('22:00', '06:30')).toBe(8.5);
  });

  it('weekly off, leave and absent pay no units', () => {
    ['weekly_off', 'leave', 'absent', 'holiday'].forEach((status) => {
      expect(classifyEntry({ status, in_time: '09:00', out_time: '19:00' }, site)).toMatchObject({ units: 0, ot_hours: 0 });
    });
  });

  it('falls back to defaults for missing settings', () => {
    expect(withDefaults({ grace_min: null }).grace_min).toBe(15);
    expect(classifyEntry({ in_time: '09:20' }, null).late_min).toBe(20);
  });
});

describe('day roll-up', () => {
  const e = (date, units, status = 'present', site_id = 'A', ot = 0) => ({ date, units, status, site_id, ot_hours: ot });

  it('never pays more than one day across two sites', () => {
    const d = byDay([e('2026-09-01', 1), e('2026-09-01', 1, 'present', 'B')]).get('2026-09-01');
    expect(d.units).toBe(1);
    expect(d.sites).toEqual(['A', 'B']);
  });

  it('codes each day and totals the month', () => {
    const entries = [e('1', 1, 'present', 'A', 2), e('2', 0.5, 'half'), e('3', 0, 'absent'), e('4', 0, 'weekly_off'), e('5', 0, 'leave')];
    expect([...byDay(entries).values()].map(dayCode)).toEqual(['P', 'H', 'A', 'WO', 'L']);
    expect(summarize(entries)).toEqual({ days_present: 1.5, half_days: 1, absent: 1, leave: 1, holidays: 0, weekly_offs: 1, ot_hours: 2 });
  });

  it('knows what needs review and what is still editable', () => {
    expect(needsReview({ flags: ['no_gps'] })).toBe(true);
    expect(needsReview({ flags: ['no_gps'], verified_at: 'x' })).toBe(false);
    const now = new Date('2026-09-13T12:00:00Z');
    expect(inEditWindow('2026-09-13T00:00:00Z', { edit_window_hours: 24 }, now)).toBe(true);
    expect(inEditWindow('2026-09-11T00:00:00Z', { edit_window_hours: 24 }, now)).toBe(false);
  });
});
