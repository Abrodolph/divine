import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../lib/fetchAll';
import { monthEnd, monthStart } from '../lib/dates';
import { friendly } from './useRecords';

const TABLES = ['attendance_entries', 'advances', 'salary_adjustments', 'payroll_payments', 'working_days', 'employee_rates'];

/**
 * Everything computePayroll() needs for one month, kept live. Payroll, the
 * Attendance Register and Reports all load through here so they can't
 * disagree about the inputs.
 *   siteId  only that site's attendance (the engine is also told the site)
 */
export function usePayrollInputs({ month, siteId = null, enabled = true }) {
  const [state, setState] = useState({
    loading: true, error: null, rates: [], entries: [], advances: [], adjustments: [], payments: [], workingDays: {}, workingDaysRows: [],
  });
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!enabled || !month) return;
    const start = monthStart(month);
    const end = monthEnd(month);
    try {
      const [rates, entries, advances, adjustments, payments, wd] = await Promise.all([
        fetchAll(() => supabase.from('employee_rates').select('employee_id,effective_from,wage_type,rate').order('effective_from')),
        fetchAll(() => {
          let q = supabase.from('attendance_entries')
            .select('id,employee_id,site_id,date,units,status,ot_hours,in_time,out_time,flags,verified_at')
            .gte('date', start).lte('date', end).order('date');
          if (siteId) q = q.eq('site_id', siteId);
          return q;
        }),
        fetchAll(() => supabase.from('advances').select('id,employee_id,date,amount').gte('date', start).lte('date', end)),
        fetchAll(() => supabase.from('salary_adjustments').select('*').eq('month', month)),
        fetchAll(() => supabase.from('payroll_payments').select('*').eq('month', month).order('paid_on')),
        fetchAll(() => supabase.from('working_days').select('*').eq('month', month)),
      ]);
      setState({
        loading: false, error: null, rates, entries, advances, adjustments, payments,
        workingDays: Object.fromEntries(wd.map((w) => [w.site_id, w.total_days])),
        workingDaysRows: wd,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: friendly(err) }));
    }
  }, [month, siteId, enabled]);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
    if (!enabled) return undefined;
    // Many rows can change at once (a muster saves 20 entries) — reload once.
    const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); };
    let ch = supabase.channel(`payroll-inputs-${month}-${siteId ?? 'all'}-${Math.random().toString(36).slice(2, 7)}`);
    TABLES.forEach((t) => { ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, soon); });
    ch.subscribe();
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); };
  }, [load, enabled, month, siteId]);

  return { ...state, reload: load };
}
