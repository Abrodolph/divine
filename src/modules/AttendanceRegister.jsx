import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { inr, fmtDate, monthLabel, thisMonth } from '../lib/format';
import { daysInMonth, defaultAsOf, monthEnd, weekday } from '../lib/dates';
import { computePayroll, payrollTotals } from '../lib/payroll';
import { exportCSV } from '../lib/csv';
import { friendly } from '../hooks/useRecords';
import { usePayrollInputs } from '../hooks/usePayrollInputs';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import PaymentsBox from '../components/PaymentsBox';
import { PrintSheet } from '../components/Print';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Input, SiteSelect, Banner, Modal, Line, Info,
  ToolbarInput, Chip,
} from '../components/ui';

const MODULE = moduleByKey('attendance_register');
const CODE_COLOR = { P: THEME.green, H: THEME.amber, A: THEME.red, L: THEME.blue, WO: THEME.textDim, HOL: THEME.textDim };
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * One site, one month: a calendar grid of every worker's days (P / H / A / L /
 * WO / HOL), and what that's worth so far. The pay columns come from the
 * payroll engine (src/lib/payroll.js) with "as of" = the chosen date, so a
 * weekly payout pays only for days that have happened. Payments recorded here
 * are the same payroll_payments Payroll sees.
 */
export default function AttendanceRegister() {
  const { activeSites, employees, siteFilter, rules, siteSettings } = useAppData();
  const { canEdit, canView, locks } = useAuth();
  const editable = canEdit('attendance_register');
  const locked = !!locks.attendance_register;
  const canPay = canEdit('attendance_register') || canEdit('payroll');

  const [siteId, setSiteId] = useState(siteFilter || '');
  const [month, setMonth] = useState(thisMonth());
  const [asOf, setAsOf] = useState(() => defaultAsOf(thisMonth()));
  const [wdInput, setWdInput] = useState('');
  const [savingWd, setSavingWd] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => { if (!siteId && activeSites.length) setSiteId(activeSites[0].id); }, [activeSites, siteId]);
  useEffect(() => { setAsOf(defaultAsOf(month)); }, [month]);

  const inputs = usePayrollInputs({ month, siteId, enabled: !!siteId });
  const totalDays = inputs.workingDays[siteId] ?? null;
  useEffect(() => { setWdInput(totalDays ? String(totalDays) : ''); }, [totalDays]);

  const rows = useMemo(() => (siteId ? computePayroll({
    employees, rates: inputs.rates, entries: inputs.entries, advances: inputs.advances,
    adjustments: inputs.adjustments, payments: inputs.payments, workingDays: inputs.workingDays,
    rules, month, asOf, siteId,
  }) : []), [employees, inputs, rules, month, asOf, siteId]);
  const totals = payrollTotals(rows);

  const dim = daysInMonth(month);
  const dates = Array.from({ length: dim }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const offDay = siteSettings(siteId).weekly_off_day;
  const selected = rows.find((r) => r.employee_id === selectedId) ?? null;

  async function saveWorkingDays(e) {
    e.preventDefault();
    const n = Number(wdInput);
    if (!n || n < 1 || n > 31) { setError('Enter the number of working days (1–31).'); return; }
    setSavingWd(true);
    setError(null);
    const { error: err } = await supabase.from('working_days')
      .upsert({ site_id: siteId, month, total_days: n, updated_at: new Date().toISOString() }, { onConflict: 'site_id,month' });
    setSavingWd(false);
    if (err) setError(friendly(err));
    else inputs.reload();
  }

  function exportGrid() {
    exportCSV(`register_${month}.csv`, [
      { key: 'name', label: 'Worker' },
      ...dates.map((d) => ({ key: d, label: d.slice(8), value: (r) => r.days.find((x) => x.date === d)?.code ?? '' })),
      { key: 'days_present', label: 'Days' },
      { key: 'ot_hours', label: 'OT h' },
      { key: 'gross', label: 'Earned so far' },
      { key: 'advances', label: 'Advances' },
      { key: 'net', label: 'Net' },
      { key: 'paid_so_far', label: 'Paid' },
      { key: 'balance', label: 'Balance' },
    ], rows);
  }

  const cellMap = (r) => Object.fromEntries(r.days.map((d) => [d.date, d]));

  return (
    <div>
      <SectionHeader title="Attendance Register" subtitle="The month at a glance for one site, and what's due so far" icon={MODULE.icon} accent={MODULE.accent}
        action={siteId && (
          <>
            <Btn variant="ghost" onClick={exportGrid}>Export</Btn>
            <Btn variant="ghost" icon={Printer} onClick={() => setPrinting(true)}>Print</Btn>
          </>
        )} />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>Site</label>
          <SiteSelect sites={activeSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </div>
        <ToolbarInput label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
        <ToolbarInput label="Pay as of" type="date" min={`${month}-01`} max={monthEnd(month)} value={asOf} onChange={(e) => setAsOf(e.target.value || defaultAsOf(month))} />
        <div>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>Working days</label>
          {editable && !locked ? (
            <form onSubmit={saveWorkingDays} className="flex gap-2">
              <Input type="number" min="1" max="31" inputMode="numeric" style={{ width: 80 }} value={wdInput}
                onChange={(e) => setWdInput(e.target.value)} placeholder={String(rules.default_working_days)} />
              <Btn type="submit" accent={MODULE.accent} disabled={savingWd}>{totalDays ? 'Update' : 'Set'}</Btn>
            </form>
          ) : (
            <div className="text-sm py-2.5">{totalDays ?? `${rules.default_working_days} (default)`}</div>
          )}
        </div>
      </Card>

      {siteId && !totalDays && (
        <Banner tone="amber">
          Working days for {monthLabel(month)} aren't set for this site — monthly wages use the default of {rules.default_working_days}.
        </Banner>
      )}
      {error && <Banner tone="red">{error}</Banner>}
      {inputs.error && <Banner tone="red">{inputs.error}</Banner>}

      {!siteId ? (
        <Card><EmptyState label="Add a site first, under Sites." /></Card>
      ) : inputs.loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card><EmptyState label="No workers on this site this month." hint="Assign workers to this site under Team." /></Card>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${THEME.border}` }}>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr style={{ background: THEME.panel2 }}>
                  <th className="sticky left-0 z-10 text-left px-3 py-2 font-medium" style={{ background: THEME.panel2, color: THEME.textDim, minWidth: 130 }}>Worker</th>
                  {dates.map((d) => (
                    <th key={d} className="px-0.5 py-1 font-medium text-center" style={{ color: THEME.textDim, minWidth: 26, opacity: weekday(d) === offDay ? 0.5 : 1 }}>
                      <div>{Number(d.slice(8))}</div>
                      <div className="text-[9px]">{WD[weekday(d)]}</div>
                    </th>
                  ))}
                  {['Days', 'OT', 'Earned', 'Adv.', 'Paid', 'Balance'].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium text-right whitespace-nowrap" style={{ color: THEME.textDim }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cells = cellMap(r);
                  return (
                    <tr key={r.employee_id} className="border-t cursor-pointer" style={{ borderColor: THEME.border }} onClick={() => setSelectedId(r.employee_id)}>
                      <td className="sticky left-0 z-10 px-3 py-2" style={{ background: THEME.panel }}>
                        <div className="font-medium truncate" style={{ maxWidth: 140 }}>{r.name}</div>
                        <div className="text-[10px]" style={{ color: THEME.textDim }}>{r.wage_type} · {inr(r.rate)}</div>
                      </td>
                      {dates.map((d) => {
                        const c = cells[d];
                        return (
                          <td key={d} className="text-center font-semibold" style={{ color: CODE_COLOR[c?.code] ?? THEME.border, background: weekday(d) === offDay ? 'rgba(155,161,166,0.06)' : undefined }}>
                            {c?.code || (d <= asOf ? '·' : '')}
                            {c?.ot_hours > 0 && <sup style={{ color: THEME.blue }}>+</sup>}
                          </td>
                        );
                      })}
                      <td className="px-2 text-right font-semibold" style={{ color: MODULE.accent }}>{r.days_present}</td>
                      <td className="px-2 text-right">{r.ot_hours || '—'}</td>
                      <td className="px-2 text-right whitespace-nowrap">{inr(r.gross)}{r.edited && <sup style={{ color: THEME.amber }}>*</sup>}</td>
                      <td className="px-2 text-right whitespace-nowrap" style={{ color: THEME.amber }}>{r.advances ? `-${inr(r.advances)}` : '—'}</td>
                      <td className="px-2 text-right whitespace-nowrap">{r.paid_so_far ? inr(r.paid_so_far) : '—'}</td>
                      <td className="px-2 text-right whitespace-nowrap font-semibold" style={{ color: r.balance > 0 ? THEME.green : THEME.textDim }}>{inr(r.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: THEME.panel2 }}>
                  <td className="sticky left-0 px-3 py-2 font-semibold" style={{ background: THEME.panel2 }}>Total</td>
                  <td colSpan={dim} />
                  <td className="px-2 text-right font-semibold">{totals.days}</td>
                  <td />
                  <td className="px-2 text-right font-semibold whitespace-nowrap">{inr(totals.gross)}</td>
                  <td className="px-2 text-right whitespace-nowrap" style={{ color: THEME.amber }}>-{inr(totals.advances)}</td>
                  <td className="px-2 text-right whitespace-nowrap">{inr(totals.paid)}</td>
                  <td className="px-2 text-right font-semibold whitespace-nowrap" style={{ color: THEME.green }}>{inr(totals.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-xs mt-3" style={{ color: THEME.textDim }}>
          Tap a worker for the breakdown and to record a payment. P present · H half · A absent · L leave · WO weekly off · HOL holiday · + overtime · * pay edited in Payroll.
          Advances here are only for workers whose primary site is this one.
        </p>
      )}

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected?.name ?? ''} accent={MODULE.accent}>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Info label="Wage" value={`${inr(selected.rate)} / ${selected.wage_type === 'Monthly' ? 'month' : 'day'}`} />
              <Info label={`Working days (as of ${fmtDate(asOf)})`} value={`${selected.working_days_elapsed} of ${selected.working_days}`} />
              <Info label="Days present" value={`${selected.days_present}${selected.half_days ? ` (${selected.half_days} half)` : ''}`} />
              <Info label="Absent / leave" value={`${selected.absent} / ${selected.leave}`} />
            </div>
            <div className="rounded-lg p-3 space-y-1.5" style={{ background: THEME.panel2 }}>
              {selected.breakdown.map((b, i) => (
                <Line key={i} label={b.label} value={b.amount < 0 ? `-${inr(-b.amount)}` : inr(b.amount)} tone={b.amount < 0 || b.override ? 'amber' : undefined} />
              ))}
              <div className="my-1" style={{ height: 1, background: THEME.border }} />
              <Line label={`Net as of ${fmtDate(asOf)}`} value={inr(selected.net)} tone="green" bold />
              <Line label="Balance after payments" value={inr(selected.balance)} bold />
            </div>
            {selected.edited && (
              <Banner tone="amber">Pay edited in Payroll{selected.adjustment?.note ? ` — ${selected.adjustment.note}` : ''}.</Banner>
            )}
            <PaymentsBox employeeId={selected.employee_id} month={month} payments={inputs.payments} balance={selected.balance}
              editable={canPay} onChanged={inputs.reload} />
            {canView('payroll') && (
              <div className="text-xs">
                <Link to="/payroll" style={{ color: THEME.orange }}>Change this worker's wage, days, bonus or penalty in Payroll →</Link>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {selected.days.map((d) => (
                <Chip key={d.date} tone={{ P: 'green', H: 'amber', A: 'red', L: 'blue' }[d.code] ?? 'dim'}>{Number(d.date.slice(8))} {d.code}</Chip>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {printing && (
        <PrintSheet title="Attendance Register" docNo={`${activeSites.find((s) => s.id === siteId)?.name ?? ''} · ${monthLabel(month)}`} date={`As of ${fmtDate(asOf)}`} onClose={() => setPrinting(false)}>
          <table className="w-full border-collapse" style={{ fontSize: 9 }}>
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-1">Worker</th>
                {dates.map((d) => <th key={d} className="text-center">{Number(d.slice(8))}</th>)}
                <th className="text-right px-1">Days</th>
                <th className="text-right px-1">OT</th>
                <th className="text-right px-1">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cells = cellMap(r);
                return (
                  <tr key={r.employee_id} className="border-b border-gray-300">
                    <td className="py-1 pr-1 whitespace-nowrap">{r.name}</td>
                    {dates.map((d) => <td key={d} className="text-center">{cells[d]?.code ?? ''}</td>)}
                    <td className="text-right px-1">{r.days_present}</td>
                    <td className="text-right px-1">{r.ot_hours || ''}</td>
                    <td className="text-right px-1">{inr(r.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PrintSheet>
      )}
    </div>
  );
}
