import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Printer, Unlock, FileText, Pencil, Wallet, Check, Loader2, RotateCcw } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { inr, monthLabel, thisMonth, today, fmtDate, fmtDateTime } from '../lib/format';
import { defaultAsOf, monthEnd, monthStart } from '../lib/dates';
import { computePayroll, payrollTotals, PRORATION_LABEL } from '../lib/payroll';
import { useRecords, friendly } from '../hooks/useRecords';
import { usePayrollInputs } from '../hooks/usePayrollInputs';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import PaymentsBox from '../components/PaymentsBox';
import { SalarySheet, Payslip } from '../components/PayrollPrint';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, SiteSelect, TableWrap, Th, Td, ExportButton,
  Banner, Modal, Line, Chip, SubHeading, ToolbarInput, DeleteBtn, FormError, IconBtn,
} from '../components/ui';

const MODULE = moduleByKey('payroll');

/**
 * Monthly payroll from the one engine (src/lib/payroll.js). Edit a worker to
 * change their wage per day, days present (after the month), overtime, bonus
 * or penalty. Save a draft to snapshot the sheet; Finalise to lock that
 * month's attendance and advances for everyone except Admin (who can reopen).
 */
export default function Payroll() {
  const { activeSites, employees, siteName, rules } = useAppData();
  const { isAdmin, canEdit, canView, locks } = useAuth();
  const locked = !!locks.payroll;
  const editable = canEdit('payroll') && !locked;
  const canLogAdvance = editable || (canEdit('advances') && !locks.advances);

  const [month, setMonth] = useState(thisMonth());
  const [siteId, setSiteId] = useState('');
  const [asOf, setAsOf] = useState(() => defaultAsOf(thisMonth()));
  const [selectedId, setSelectedId] = useState(null);
  const [print, setPrint] = useState(null); // { kind: 'sheet' } | { kind: 'slip', row }
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => { setAsOf(defaultAsOf(month)); }, [month]);

  const inputs = usePayrollInputs({ month, siteId: siteId || null });
  const { rows: runs, update: updateRun, add: addRun, remove: removeRun } = useRecords('payroll_runs', { orderBy: 'month', pageSize: 60 });

  const engineInput = useMemo(() => ({
    rates: inputs.rates, entries: inputs.entries, advances: inputs.advances, payments: inputs.payments,
    workingDays: inputs.workingDays, rules, month, asOf, siteId: siteId || null,
  }), [inputs, rules, month, asOf, siteId]);

  const rows = useMemo(
    () => computePayroll({ ...engineInput, employees, adjustments: inputs.adjustments }),
    [engineInput, employees, inputs.adjustments]
  );
  const totals = payrollTotals(rows);
  const payDays = rows.reduce((n, r) => n + r.paid_days, 0);

  const run = runs.find((r) => r.month === month && (r.site_id ?? '') === siteId) ?? null;
  const final = run?.status === 'final';
  const partial = asOf < monthEnd(month);
  const selected = rows.find((r) => r.employee_id === selectedId) ?? null;

  // The engine for one worker with a draft edit in place of the saved one.
  const calcSelected = useMemo(() => {
    const emp = employees.filter((e) => e.id === selectedId);
    return (adjustment) => computePayroll({ ...engineInput, employees: emp, adjustments: adjustment ? [adjustment] : [] })[0] ?? null;
  }, [engineInput, employees, selectedId]);

  const say = (m) => { setFlash(m); setTimeout(() => setFlash(null), 3500); };

  async function saveRun(status) {
    setBusy(true);
    setError(null);
    const payload = {
      month, site_id: siteId || null, period_start: monthStart(month), period_end: monthEnd(month),
      rows: rows.map(({ days: _days, ...r }) => r), totals, rules_snapshot: rules, status, generated_at: new Date().toISOString(),
    };
    try {
      if (run) await updateRun(run.id, payload);
      else await addRun(payload);
      setConfirmFinal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try { await updateRun(run.id, { status: 'draft' }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const exportCols = [
    { key: 'name', label: 'Worker' },
    { key: 'site_id', label: 'Primary site', value: (r) => siteName(r.site_id) },
    { key: 'wage_type', label: 'Wage type' },
    { key: 'day_rate', label: 'Wage per day' },
    { key: 'paid_days', label: 'Days' },
    { key: 'half_days', label: 'Half days' },
    { key: 'ot_hours', label: 'OT hours' },
    { key: 'gross_basic', label: 'Salary' },
    { key: 'gross_ot', label: 'OT pay' },
    { key: 'bonus', label: 'Bonus' },
    { key: 'advances', label: 'Advances' },
    { key: 'penalty', label: 'Penalty' },
    { key: 'net', label: 'Net' },
    { key: 'paid_so_far', label: 'Paid' },
    { key: 'balance', label: 'Balance' },
    { key: 'left_on', label: 'Left on' },
  ];

  return (
    <div>
      <SectionHeader title="Payroll" subtitle="Monthly salary from attendance, with bonus, advances and penalties" icon={MODULE.icon} accent={MODULE.accent}
        action={canLogAdvance && <Btn accent={THEME.amber} icon={Wallet} onClick={() => setLogging(true)}>Log advance</Btn>} />
      <LockBanner locked={locked} readOnly={!canEdit('payroll') && !locked} />

      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <ToolbarInput label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
        <div className="min-w-[170px]">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>Site</label>
          <SiteSelect sites={activeSites} placeholder="All sites" value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </div>
        <ToolbarInput label="As of" type="date" min={monthStart(month)} max={monthEnd(month)} value={asOf} onChange={(e) => setAsOf(e.target.value || defaultAsOf(month))} />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <ExportButton label="Export" filename={`payroll_${month}${siteId ? `_${siteName(siteId)}` : ''}.csv`} columns={exportCols} rows={rows} />
          <Btn variant="ghost" icon={Printer} onClick={() => setPrint({ kind: 'sheet' })}>Salary sheet</Btn>
        </div>
      </Card>

      <div className="text-xs mb-3" style={{ color: THEME.textDim }}>
        Rules: {PRORATION_LABEL[rules.monthly_proration]} · {rules.standard_hours} h day · OT × {rules.ot_multiplier} · {rules.default_working_days} working days unless set per site.
        {isAdmin && ' Change them in Admin Control.'}
      </div>

      {final ? (
        <Banner tone="green" icon={Lock}>
          Finalised {fmtDateTime(run.finalised_at)} — attendance and advances for {monthLabel(month)}{siteId ? ` at ${siteName(siteId)}` : ''} are locked.
          {isAdmin ? ' You can reopen it below.' : ' Only Admin can reopen it.'}
        </Banner>
      ) : run ? (
        <Banner tone="amber">Draft saved {fmtDateTime(run.generated_at)}. Numbers below are live; save again to refresh the draft.</Banner>
      ) : null}
      {partial && <Banner tone="blue">Showing pay as of {fmtDate(asOf)} — only working days up to then are counted.</Banner>}
      {totals.pending_days > 0 && (
        <Banner tone="amber">
          {totals.pending_days} worker-day{totals.pending_days === 1 ? '' : 's'} are still waiting for the crew photo to be approved, so they aren't paid yet.
          {canView('attendance_verify') && <> Approve them under <Link to="/attendance_verify" style={{ color: 'inherit', textDecoration: 'underline' }}>Verify Attendance</Link>.</>}
        </Banner>
      )}
      {flash && <Banner tone="green" icon={Check}>{flash}</Banner>}
      {error && <Banner tone="red">{error}</Banner>}
      {inputs.error && <Banner tone="red">{inputs.error}</Banner>}

      {editable && (
        <div className="flex flex-wrap gap-2 mb-4">
          {!final && <Btn variant="subtle" disabled={busy || !rows.length} onClick={() => saveRun('draft')}>Save draft</Btn>}
          {!final && <Btn accent={THEME.green} icon={Lock} disabled={busy || !rows.length || partial} onClick={() => setConfirmFinal(true)}
            title={partial ? 'Set "As of" to the month end to finalise' : undefined}>Finalise month</Btn>}
          {final && isAdmin && <Btn variant="ghost" icon={Unlock} disabled={busy} onClick={reopen}>Reopen</Btn>}
          {run && <AuditButton table="payroll_runs" rowId={run.id} />}
        </div>
      )}

      {inputs.loading ? <Loading label="Calculating…" /> : rows.length === 0 ? (
        <Card><EmptyState label="No workers for this selection." /></Card>
      ) : (
        <TableWrap>
          <thead>
            <tr style={{ background: THEME.panel2 }}>
              {['Worker', 'Wage / day', 'Days', 'OT h', 'Bonus', 'Advances', 'Penalty', 'Net', 'Paid', 'Balance'].map((h) => <Th key={h}>{h}</Th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_id} className="border-t cursor-pointer" style={{ borderColor: THEME.border }} onClick={() => setSelectedId(r.employee_id)}>
                <Td>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs" style={{ color: THEME.textDim }}>
                    {siteName(r.site_id)}{r.left_on ? ` · left ${fmtDate(r.left_on)}` : ''}
                  </span>
                </Td>
                <Td>
                  {inr(r.day_rate)}
                  {r.wage_type === 'Monthly' && <span className="block text-xs" style={{ color: THEME.textDim }}>{inr(r.rate)}/mo</span>}
                </Td>
                <Td>
                  {r.paid_days}{r.half_days ? <span className="text-xs" style={{ color: THEME.textDim }}> ({r.half_days}½)</span> : ''}
                  {r.pending_days > 0 && <span className="ml-1"><Chip tone="amber">{r.pending_days} to approve</Chip></span>}
                </Td>
                <Td>{r.ot_hours || '—'}</Td>
                <Td>{r.bonus ? <span style={{ color: THEME.green }}>+{inr(r.bonus)}</span> : '—'}</Td>
                <Td><span style={{ color: THEME.amber }}>{r.advances ? `-${inr(r.advances)}` : '—'}</span></Td>
                <Td><span style={{ color: THEME.red }}>{r.penalty ? `-${inr(r.penalty)}` : '—'}</span></Td>
                <Td>
                  <span className="font-semibold" style={{ color: THEME.green }}>{inr(r.net)}</span>
                  {r.edited && <span className="ml-1"><Chip tone="amber">edited</Chip></span>}
                </Td>
                <Td>{r.paid_so_far ? inr(r.paid_so_far) : '—'}</Td>
                <Td><span className="font-semibold" style={{ color: r.balance > 0 ? THEME.text : THEME.textDim }}>{inr(r.balance)}</span></Td>
                <Td><IconBtn icon={Pencil} title="Edit pay" onClick={(e) => { e.stopPropagation(); setSelectedId(r.employee_id); }} /></Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: THEME.panel2 }}>
              <td className="px-3 py-2.5 font-semibold" colSpan={2}>Total</td>
              <td className="px-3 py-2.5 font-semibold">{Math.round(payDays * 100) / 100}</td>
              <td />
              <td className="px-3 py-2.5" style={{ color: THEME.green }}>{totals.bonus ? `+${inr(totals.bonus)}` : '—'}</td>
              <td className="px-3 py-2.5" style={{ color: THEME.amber }}>-{inr(totals.advances)}</td>
              <td className="px-3 py-2.5" style={{ color: THEME.red }}>{totals.penalty ? `-${inr(totals.penalty)}` : '—'}</td>
              <td className="px-3 py-2.5 font-semibold" style={{ color: THEME.green }}>{inr(totals.net)}</td>
              <td className="px-3 py-2.5">{inr(totals.paid)}</td>
              <td className="px-3 py-2.5 font-semibold">{inr(totals.balance)}</td>
              <td />
            </tr>
          </tfoot>
        </TableWrap>
      )}
      <p className="text-xs mt-2" style={{ color: THEME.textDim }}>Tap a worker (or the pencil) to edit their pay, record payments and print a payslip.</p>

      <SubHeading>SAVED RUNS</SubHeading>
      {runs.length === 0 ? <Card><EmptyState label="No payroll runs saved yet." /></Card> : (
        <div className="space-y-2">
          {runs.map((r) => (
            <Card key={r.id} className="p-3 flex items-center justify-between flex-wrap gap-2">
              <button type="button" className="text-left" onClick={() => { setMonth(r.month); setSiteId(r.site_id ?? ''); }}>
                <span className="font-semibold">{monthLabel(r.month)}</span>
                <span className="text-xs ml-2" style={{ color: THEME.textDim }}>
                  {r.site_id ? siteName(r.site_id) : 'All sites'} · Net {inr(r.totals?.net)} · saved {fmtDate(r.generated_at)}
                </span>
              </button>
              <div className="flex items-center gap-2">
                <Chip tone={r.status === 'final' ? 'green' : 'amber'}>{r.status === 'final' ? 'Final' : 'Draft'}</Chip>
                {editable && (r.status === 'draft' || isAdmin) && (
                  <DeleteBtn onDelete={() => removeRun(r.id).catch((e) => setError(e.message))} label="this run" />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={confirmFinal} onClose={() => setConfirmFinal(false)} title={`Finalise ${monthLabel(month)}?`} accent={THEME.green}>
        <div className="space-y-3 text-sm">
          <p>This saves the salary sheet and <b>locks</b> {siteId ? `${siteName(siteId)}'s` : 'every site\'s'} attendance and all advances dated in {monthLabel(month)}.</p>
          <p style={{ color: THEME.textDim }}>Supervisors and office staff won't be able to change those entries. Admin can reopen the month if something was wrong. Payments can still be recorded.</p>
          <div className="flex justify-end gap-2">
            <Btn variant="subtle" onClick={() => setConfirmFinal(false)}>Cancel</Btn>
            <Btn accent={THEME.green} icon={Lock} disabled={busy} onClick={() => saveRun('final')}>{busy ? 'Saving…' : 'Finalise'}</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected?.name ?? ''} accent={MODULE.accent}>
        {selected && (
          <div className="space-y-4 text-sm">
            <PayEditor key={`${selected.employee_id}-${month}-${asOf}-${siteId}`} row={selected} month={month} calc={calcSelected} rules={rules}
              editable={editable && !final && !siteId} canEdit={editable} final={final} siteFiltered={!!siteId} onSaved={inputs.reload} />
            <PaymentsBox employeeId={selected.employee_id} month={month} payments={inputs.payments} balance={selected.balance}
              editable={canEdit('payroll')} onChanged={inputs.reload} />
            <Btn variant="subtle" icon={FileText} onClick={() => { setPrint({ kind: 'slip', row: selected }); setSelectedId(null); }}>Payslip</Btn>
          </div>
        )}
      </Modal>

      <Modal open={logging} onClose={() => setLogging(false)} wide title="Log advance" accent={THEME.amber}>
        {logging && (
          <AdvanceForm onCancel={() => setLogging(false)}
            onDone={(count, total) => { setLogging(false); inputs.reload(); say(`Logged ${count} advance${count === 1 ? '' : 's'} totalling ${inr(total)}.`); }} />
        )}
      </Modal>

      {print?.kind === 'sheet' && (
        <SalarySheet rows={rows} month={month} subtitle={`${siteId ? siteName(siteId) : 'All sites'}${partial ? ` · as of ${fmtDate(asOf)}` : ''}`} onClose={() => setPrint(null)} />
      )}
      {print?.kind === 'slip' && (
        <Payslip row={rows.find((r) => r.employee_id === print.row.employee_id) ?? print.row} month={month} payments={inputs.payments}
          siteName={siteName} onClose={() => setPrint(null)} />
      )}
    </div>
  );
}

/* ------------------------------ pay editor ------------------------------- */

const blankToNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const differs = (v, def) => v !== '' && Math.abs(Number(v) - Number(def)) > 0.004;

/**
 * Wage per day × days present = salary, + overtime, + bonus, − advances,
 * − penalty = net payable. Fields left at the attendance figure are saved
 * blank, so later attendance changes still flow through.
 */
function PayEditor({ row, month, calc, rules, editable, canEdit, final, siteFiltered, onSaved }) {
  const base = useMemo(() => calc(null), [calc]);
  const saved = row.adjustment;
  const monthOver = today() > monthEnd(month);

  const [form, setForm] = useState(() => ({
    day_rate: String(saved?.day_rate ?? base?.day_rate ?? ''),
    days_present: String(saved?.days_present ?? base?.paid_days ?? ''),
    ot_hours: String(saved?.ot_hours ?? base?.ot_hours ?? ''),
    bonus: Number(saved?.bonus) ? String(saved.bonus) : '',
    penalty: Number(saved?.penalty) ? String(saved.penalty) : '',
    note: saved?.note ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDone(false); };

  const draft = useMemo(() => {
    if (!base) return null;
    return {
      employee_id: row.employee_id,
      month,
      day_rate: differs(form.day_rate, base.day_rate) ? Number(form.day_rate) : null,
      days_present: monthOver && differs(form.days_present, base.paid_days) ? Number(form.days_present) : null,
      ot_hours: differs(form.ot_hours, base.ot_hours) ? Number(form.ot_hours) : null,
      bonus: blankToNull(form.bonus) ?? 0,
      penalty: blankToNull(form.penalty) ?? 0,
      note: form.note.trim() || null,
    };
  }, [base, form, row.employee_id, month, monthOver]);

  const noEdits = !draft || (draft.day_rate === null && draft.days_present === null && draft.ot_hours === null && !draft.bonus && !draft.penalty);
  const preview = useMemo(() => (draft ? calc(noEdits ? null : draft) : null), [calc, draft, noEdits]);

  if (!base || !preview) return null;

  async function save(e) {
    e.preventDefault();
    const values = [form.day_rate, form.days_present, form.ot_hours, form.bonus, form.penalty].map(blankToNull);
    if (values.some((v) => v !== null && (Number.isNaN(v) || v < 0))) { setError('Amounts, days and hours can\'t be negative.'); return; }
    if (monthOver && Number(form.days_present) > 31) { setError('Days present can\'t be more than 31.'); return; }
    setSaving(true);
    setError(null);
    const { error: err } = noEdits && !draft.note
      ? (saved ? await supabase.from('salary_adjustments').delete().eq('employee_id', row.employee_id).eq('month', month) : { error: null })
      : await supabase.from('salary_adjustments').upsert(draft, { onConflict: 'employee_id,month' });
    setSaving(false);
    if (err) { setError(friendly(err)); return; }
    setDone(true);
    onSaved();
  }

  async function reset() {
    if (!window.confirm(`Clear the edits for ${row.name} and go back to the attendance figures?`)) return;
    const { error: err } = await supabase.from('salary_adjustments').delete().eq('employee_id', row.employee_id).eq('month', month);
    if (err) { setError(friendly(err)); return; }
    setForm({ day_rate: String(base.day_rate), days_present: String(base.paid_days), ot_hours: String(base.ot_hours), bonus: '', penalty: '', note: '' });
    onSaved();
  }

  const mult = Number(rules.ot_multiplier);
  const wageHint = row.wage_type === 'Monthly'
    ? `Monthly wage ${inr(base.rate)} ÷ ${base.working_days} working days = ${inr(base.day_rate)}`
    : `Daily wage on record: ${inr(base.day_rate)}`;

  return (
    <form onSubmit={save} className="space-y-4">
      {canEdit && final && <Banner tone="dim">This month is finalised. Admin can reopen it to change pay.</Banner>}
      {canEdit && !final && siteFiltered && <Banner tone="dim">Pick “All sites” to edit this worker’s pay — edits cover their whole month.</Banner>}

      <fieldset disabled={!editable} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Wage per day (₹)" hint={wageHint}>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.day_rate} onChange={(e) => set('day_rate', e.target.value)} />
          </Field>
          <Field label="Days present"
            hint={monthOver ? `Attendance: ${base.paid_days}. Change it for days nobody marked.` : `Attendance: ${base.paid_days}. Editable once ${monthLabel(month)} is over.`}>
            <Input type="number" min="0" max="31" step="0.5" inputMode="decimal" disabled={!monthOver} value={form.days_present}
              onChange={(e) => set('days_present', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Overtime hours" hint={`Attendance: ${base.ot_hours} h`}>
            <Input type="number" min="0" step="0.5" inputMode="decimal" value={form.ot_hours} onChange={(e) => set('ot_hours', e.target.value)} />
          </Field>
          <Field label="Wage per hour">
            <div className="py-2.5">{inr(preview.hourly_rate)}<span className="text-xs" style={{ color: THEME.textDim }}> = wage per day ÷ {rules.standard_hours} h{mult !== 1 ? ` · OT paid × ${mult}` : ''}</span></div>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Bonus (+ ₹)">
            <Input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={form.bonus} onChange={(e) => set('bonus', e.target.value)} />
          </Field>
          <Field label="Advances (− ₹)" hint="From logged advances">
            <div className="py-2.5" style={{ color: THEME.amber }}>{preview.advances ? inr(preview.advances) : '—'}</div>
          </Field>
          <Field label="Penalty (− ₹)">
            <Input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={form.penalty} onChange={(e) => set('penalty', e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <Input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. 2 days unmarked at Hospital site; Diwali bonus" />
        </Field>
      </fieldset>

      <div className="rounded-lg p-3 space-y-1.5" style={{ background: THEME.panel2 }}>
        <Line label={`Salary: ${preview.paid_days} day${preview.paid_days === 1 ? '' : 's'} × ${inr(preview.day_rate)}`} value={inr(preview.gross_basic)} />
        <Line label={`Overtime: ${preview.ot_hours} h × ${inr(preview.hourly_rate)}${mult !== 1 ? ` × ${mult}` : ''}`} value={inr(preview.gross_ot)} />
        <Line label="Bonus" value={`+${inr(preview.bonus)}`} tone={preview.bonus ? 'green' : undefined} />
        <Line label="Advances" value={`-${inr(preview.advances)}`} tone={preview.advances ? 'amber' : undefined} />
        <Line label="Penalty" value={`-${inr(preview.penalty)}`} tone={preview.penalty ? 'red' : undefined} />
        <div className="my-1" style={{ height: 1, background: THEME.border }} />
        <Line label="Net payable" value={inr(preview.net)} tone="green" bold />
        <Line label="Balance after payments" value={inr(preview.balance)} />
      </div>

      <FormError error={error} />
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {saved && <Btn type="button" variant="ghost" icon={RotateCcw} onClick={reset}>Back to attendance</Btn>}
          </div>
          <div className="flex items-center gap-2">
            {done && <span className="text-xs" style={{ color: THEME.green }}>Saved</span>}
            {saved && <AuditButton table="salary_adjustments" rowId={saved.id} />}
            <Btn type="submit" accent={MODULE.accent} disabled={saving} icon={saving ? Loader2 : undefined}>{saving ? 'Saving…' : 'Save pay'}</Btn>
          </div>
        </div>
      )}
    </form>
  );
}

/* ------------------------------ log advance ------------------------------ */

/** Tick workers (grouped by site), type what each was given, save them in one go. */
function AdvanceForm({ onDone, onCancel }) {
  const { activeEmployees, activeSites, siteName } = useAppData();
  const [date, setDate] = useState(today());
  const [week, setWeek] = useState('');
  const [remarks, setRemarks] = useState('');
  const [siteId, setSiteId] = useState('');
  const [defaultAmount, setDefaultAmount] = useState('1000');
  const [amounts, setAmounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const groups = useMemo(() => {
    const m = new Map();
    activeEmployees
      .filter((e) => !siteId || !e.site_id || e.site_id === siteId)
      .forEach((e) => { const k = e.site_id ?? ''; if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
    return [...m.entries()]
      .map(([k, list]) => ({ key: k, label: k ? siteName(k) : 'Floating (no fixed site)', list: list.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.label.localeCompare(b.label)));
  }, [activeEmployees, siteId, siteName]);

  const toggle = (id) => setAmounts((a) => {
    const next = { ...a };
    if (id in next) delete next[id];
    else next[id] = defaultAmount;
    return next;
  });
  const tickAll = (list) => setAmounts((a) => ({ ...a, ...Object.fromEntries(list.filter((e) => !(e.id in a)).map((e) => [e.id, defaultAmount])) }));

  const ticked = Object.entries(amounts);
  const total = ticked.reduce((s, [, v]) => s + (Number(v) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    const list = ticked.filter(([, v]) => Number(v) > 0);
    if (!list.length) { setError('Tick at least one worker and enter an amount.'); return; }
    if (ticked.some(([, v]) => Number(v) < 0)) { setError('Amounts can\'t be negative.'); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('advances').insert(list.map(([employee_id, v]) => ({
      date, employee_id, amount: Number(v), week: week || null, remarks: remarks || null,
    })));
    setSaving(false);
    if (err) { setError(friendly(err)); return; }
    onDone(list.length, list.reduce((s, [, v]) => s + Number(v), 0));
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Week label"><Input value={week} onChange={(e) => setWeek(e.target.value)} placeholder="e.g. Week 3" /></Field>
        <Field label="Site">
          <SiteSelect sites={activeSites} placeholder="All sites" value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
        <Field label="Amount when ticked (₹)">
          <Input type="number" min="0" inputMode="numeric" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} />
        </Field>
      </div>

      {groups.length === 0 ? (
        <div className="text-xs px-3 py-3 rounded-lg" style={{ color: THEME.textDim, background: THEME.panel2 }}>No workers on the roll{siteId ? ' for this site' : ''}.</div>
      ) : groups.map((g) => (
        <div key={g.key || 'floating'}>
          <SubHeading className="mb-2" action={(
            <button type="button" className="text-xs font-semibold" style={{ color: THEME.amber }} onClick={() => tickAll(g.list)}>Select all</button>
          )}>{g.label.toUpperCase()}</SubHeading>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {g.list.map((w) => {
              const on = w.id in amounts;
              return (
                <div key={w.id} className="rounded-lg flex items-center gap-2 pr-2"
                  style={{ background: on ? 'rgba(255,193,7,0.10)' : THEME.panel2, border: `1px solid ${on ? THEME.amber : THEME.border}` }}>
                  <button type="button" onClick={() => toggle(w.id)} className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left" style={{ color: THEME.text }}>
                    <span className="flex items-center justify-center rounded shrink-0"
                      style={{ width: 20, height: 20, background: on ? THEME.amber : 'transparent', border: `1px solid ${on ? THEME.amber : THEME.border}` }}>
                      {on && <Check size={13} color="#111" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{w.name}</span>
                      {w.trade && <span className="block text-[11px]" style={{ color: THEME.textDim }}>{w.trade}</span>}
                    </span>
                  </button>
                  {on && (
                    <input type="number" min="0" inputMode="numeric" value={amounts[w.id]} aria-label={`Advance for ${w.name}`}
                      onChange={(e) => setAmounts((a) => ({ ...a, [w.id]: e.target.value }))}
                      className="bg-transparent border rounded-lg px-2 py-1.5 text-sm outline-none w-24" style={{ borderColor: THEME.border, color: THEME.text }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Applies to every advance saved here" /></Field>
      <FormError error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          <b style={{ color: THEME.amber }}>{ticked.length}</b> ticked · <b>{inr(total)}</b>
        </span>
        <div className="flex gap-2">
          <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
          <Btn type="submit" accent={THEME.amber} disabled={saving} icon={saving ? Loader2 : undefined}>{saving ? 'Saving…' : 'Save advances'}</Btn>
        </div>
      </div>
    </form>
  );
}
