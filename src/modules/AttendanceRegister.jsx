import { useEffect, useMemo, useState } from 'react';
import { THEME } from '../lib/theme';
import { inr, fmtDate, monthLabel, thisMonth, today } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, SiteSelect,
  TableWrap, Th, Td, Banner, Modal, PayStatusToggle,
} from '../components/ui';
import { setSalaryStatus } from '../lib/salaryPayments';

const MODULE = moduleByKey('attendance_register');

/**
 * One site, one month: every worker on that site's roster, how many days
 * they were marked present, and — once Admin sets how many working days the
 * month had — what that's actually worth in pay.
 *
 * "Payable" here is attendance x rate only, independent of Payroll's saved
 * runs: the per-day rate (from the full month's working days x wage) times
 * however many of those working days have actually elapsed by the chosen
 * "calculate as of" date — not the whole month — so a weekly payout partway
 * through the month isn't docked pay for days that haven't happened yet.
 * Advances are shown for context in the breakdown but aren't this screen's
 * job to settle — that's what Payroll does.
 */
export default function AttendanceRegister() {
  const { activeSites, activeEmployees, siteFilter } = useAppData();
  const { canEdit, locks } = useAuth();
  const editable = canEdit('attendance_register');
  const locked = !!locks.attendance_register;

  const [siteId, setSiteId] = useState(siteFilter || '');
  const [month, setMonth] = useState(thisMonth());
  const [asOf, setAsOf] = useState(() => defaultAsOf(thisMonth()));
  const [attendance, setAttendance] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [payingId, setPayingId] = useState(null);
  const [workingDays, setWorkingDays] = useState(null);
  const [totalDaysInput, setTotalDaysInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!siteId && activeSites.length) setSiteId(activeSites[0].id);
  }, [activeSites, siteId]);

  // Switching months resets "as of" to a sensible default for that month —
  // today if it's the current month, otherwise the last day of that month.
  useEffect(() => {
    setAsOf(defaultAsOf(month));
  }, [month]);

  // Same roster rule as the Attendance tick-list: assigned to this site, or unassigned.
  const roster = useMemo(() => {
    if (!siteId) return [];
    return activeEmployees.filter((e) => e.site_id === siteId || !e.site_id);
  }, [activeEmployees, siteId]);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const start = `${month}-01`;
      const end = nextMonthStart(month);
      const [a, wd, adj, pay] = await Promise.all([
        supabase.from('attendance').select('date,present_ids,present_times')
          .eq('site_id', siteId).gte('date', start).lt('date', end),
        supabase.from('working_days').select('*').eq('site_id', siteId).eq('month', month).maybeSingle(),
        supabase.from('salary_adjustments').select('*').eq('month', month),
        supabase.from('salary_payments').select('*').eq('month', month),
      ]);
      if (cancelled) return;
      setPayments(pay.data ?? []);
      if (a.error) setError(a.error.message);
      else if (adj.error) setError(adj.error.message);
      setAttendance(a.data ?? []);
      setWorkingDays(wd.data ?? null);
      setTotalDaysInput(wd.data?.total_days != null ? String(wd.data.total_days) : '');
      setAdjustments(adj.data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [siteId, month]);

  // Advances are only needed for the popup breakdown, fetched for the visible roster.
  useEffect(() => {
    if (!roster.length) { setAdvances([]); return; }
    let cancelled = false;
    (async () => {
      const start = `${month}-01`;
      const end = nextMonthStart(month);
      const { data, error: err } = await supabase.from('advances')
        .select('employee_id,amount,date')
        .in('employee_id', roster.map((e) => e.id))
        .gte('date', start).lt('date', end);
      if (cancelled) return;
      if (err) setError(err.message);
      setAdvances(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [roster, month]);

  const totalDays = workingDays?.total_days ?? null;

  // How many of the month's working days have actually happened by "as of",
  // scaled from the calendar so a partial/weekly payout isn't compared
  // against the full month's working-day count.
  const dim = useMemo(() => daysInMonth(month), [month]);
  const elapsedCalendarDays = useMemo(() => {
    const d = Number(asOf.split('-')[2]) || dim;
    return Math.min(Math.max(d, 1), dim);
  }, [asOf, dim]);
  const workingDaysElapsed = totalDays
    ? (elapsedCalendarDays >= dim ? totalDays : Math.min(totalDays, Math.round((totalDays * elapsedCalendarDays) / dim)))
    : null;

  const rows = useMemo(() => roster.map((emp) => {
    const dates = attendance
      .filter((a) => (a.present_ids ?? []).includes(emp.id))
      .map((a) => a.date)
      .sort();
    const daysPresent = dates.length;
    const rate = Number(emp.wage_rate) || 0;

    let fullPay = null, perDayRate = null, absentDays = null, deduction = null, payable = null;
    if (totalDays > 0) {
      fullPay = emp.wage_type === 'Monthly' ? rate : rate * totalDays;
      perDayRate = fullPay / totalDays;
      const effectiveDays = Math.min(daysPresent, workingDaysElapsed);
      absentDays = Math.max(workingDaysElapsed - daysPresent, 0);
      deduction = perDayRate * absentDays;
      payable = perDayRate * effectiveDays;
    }

    const advanceTotal = advances
      .filter((a) => a.employee_id === emp.id)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);

    // An override is a full-month target salary (e.g. a raise that took effect
    // mid-month) — prorate it by days elapsed the same way the calculated
    // payable is prorated, rather than paying the whole target amount before
    // the month is over.
    const override = adjustments.find((a) => a.employee_id === emp.id) ?? null;
    const effectiveDays = totalDays > 0 ? Math.min(daysPresent, workingDaysElapsed) : null;
    const overridePayable = override
      ? (totalDays > 0 ? (Number(override.amount) / totalDays) * effectiveDays : Number(override.amount))
      : null;
    const finalPayable = override ? overridePayable : payable;
    const payment = payments.find((p) => p.employee_id === emp.id) ?? null;

    return {
      employee_id: emp.id, name: emp.name, trade: emp.trade,
      wage_type: emp.wage_type, rate, dates, daysPresent,
      fullPay, perDayRate, absentDays, deduction, payable,
      advanceTotal, netAfterAdvance: payable != null ? payable - advanceTotal : null,
      override, finalPayable,
      status: payment?.status ?? 'Due', paid_on: payment?.paid_on ?? null,
    };
  }), [roster, attendance, totalDays, workingDaysElapsed, advances, adjustments, payments]);

  const selectedRow = rows.find((r) => r.employee_id === selectedId) ?? null;

  async function saveOverride(employeeId, amount, note) {
    setSavingOverride(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from('salary_adjustments')
        .upsert(
          { employee_id: employeeId, month, amount, note: note || null, updated_at: new Date().toISOString() },
          { onConflict: 'employee_id,month' }
        )
        .select()
        .single();
      if (err) throw err;
      setAdjustments((prev) => [...prev.filter((a) => a.employee_id !== employeeId), data]);
    } catch (err) {
      setError(err.message || 'Could not save the adjustment.');
    } finally {
      setSavingOverride(false);
    }
  }

  async function clearOverride(employeeId) {
    setSavingOverride(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('salary_adjustments')
        .delete().eq('employee_id', employeeId).eq('month', month);
      if (err) throw err;
      setAdjustments((prev) => prev.filter((a) => a.employee_id !== employeeId));
    } catch (err) {
      setError(err.message || 'Could not remove the adjustment.');
    } finally {
      setSavingOverride(false);
    }
  }

  async function togglePaid(employeeId, status) {
    setPayingId(employeeId);
    setError(null);
    try {
      const data = await setSalaryStatus(employeeId, month, status);
      setPayments((prev) => [...prev.filter((p) => p.employee_id !== employeeId), data]);
    } catch (err) {
      setError(err.message || 'Could not update payment status.');
    } finally {
      setPayingId(null);
    }
  }

  async function saveWorkingDays(e) {
    e.preventDefault();
    const n = Number(totalDaysInput);
    if (!n || n < 1) { setError('Enter a valid number of working days.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from('working_days')
        .upsert(
          { site_id: siteId, month, total_days: n, updated_at: new Date().toISOString() },
          { onConflict: 'site_id,month' }
        )
        .select()
        .single();
      if (err) throw err;
      setWorkingDays(data);
    } catch (err) {
      setError(err.message || 'Could not save working days.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Attendance Register"
        subtitle="Days present per worker for a site and month, and what it's worth"
        icon={MODULE.icon}
        accent={MODULE.accent}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <Card className="p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
            Site
          </label>
          <SiteSelect sites={activeSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
            Month
          </label>
          <input
            type="month"
            className="bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: THEME.border, color: THEME.text }}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
            Calculate as of
          </label>
          <input
            type="date"
            min={`${month}-01`}
            max={`${month}-${String(dim).padStart(2, '0')}`}
            className="bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: THEME.border, color: THEME.text }}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
            Total working days this month
          </label>
          {editable && !locked ? (
            <form onSubmit={saveWorkingDays} className="flex gap-2">
              <Input
                type="number" min="1" max="31" inputMode="numeric"
                style={{ width: 90 }}
                value={totalDaysInput}
                onChange={(e) => setTotalDaysInput(e.target.value)}
                placeholder="e.g. 26"
              />
              <Btn type="submit" accent={MODULE.accent} disabled={saving}>
                {saving ? 'Saving…' : totalDays ? 'Update' : 'Set'}
              </Btn>
            </form>
          ) : (
            <div className="text-sm py-2.5">{totalDays ? `${totalDays} days` : 'Not set yet'}</div>
          )}
        </div>
      </Card>

      {!siteId ? (
        <Card><EmptyState label="Add a site first, under Sites." /></Card>
      ) : !totalDays ? (
        <Banner tone="amber">
          Set the total working days for {monthLabel(month)} to calculate salary. Until then only days
          present are shown.
        </Banner>
      ) : (
        <Banner tone="blue">
          Calculating as of {fmtDate(asOf)}: {workingDaysElapsed} of {totalDays} working days for{' '}
          {monthLabel(month)} have happened so far.
        </Banner>
      )}

      {error && <div className="text-xs mb-3" style={{ color: THEME.red }}>{error}</div>}

      {loading ? (
        <Loading />
      ) : !siteId ? null : roster.length === 0 ? (
        <Card>
          <EmptyState label="No workers on this site yet." hint="Add them under Team and assign this site." />
        </Card>
      ) : (
        <TableWrap>
          <thead>
            <tr style={{ background: THEME.panel2 }}>
              <Th>Worker</Th>
              <Th>Wage</Th>
              <Th>Days Present</Th>
              {totalDays ? <Th>Absent</Th> : null}
              <Th>Payable</Th>
              <Th>Salary</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.employee_id}
                onClick={() => setSelectedId(r.employee_id)}
                className="border-t cursor-pointer"
                style={{ borderColor: THEME.border }}
              >
                <Td>
                  <span className="font-medium">{r.name}</span>
                  {r.trade && <span className="block text-xs" style={{ color: THEME.textDim }}>{r.trade}</span>}
                </Td>
                <Td>{r.wage_type} · {inr(r.rate)}{r.wage_type === 'Daily' ? '/day' : '/mo'}</Td>
                <Td>
                  <span className="font-semibold" style={{ color: MODULE.accent }}>{r.daysPresent}</span>
                  {totalDays ? <span style={{ color: THEME.textDim }}> / {workingDaysElapsed}</span> : null}
                </Td>
                {totalDays ? <Td>{r.absentDays}</Td> : null}
                <Td>
                  {r.finalPayable != null ? (
                    <>
                      <span className="font-semibold" style={{ color: THEME.green }}>{inr(r.finalPayable)}</span>
                      {r.override && <span className="text-xs ml-1.5" style={{ color: THEME.amber }}>edited</span>}
                    </>
                  ) : (
                    <span style={{ color: THEME.textDim }}>—</span>
                  )}
                </Td>
                <Td>
                  <PayStatusToggle status={r.status} paidOn={r.paid_on} editable={editable && !locked}
                    busy={payingId === r.employee_id} onToggle={(st) => togglePaid(r.employee_id, st)} />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <p className="text-xs mt-3" style={{ color: THEME.textDim }}>
        Tap a worker to see the full breakdown.
      </p>

      <Modal open={!!selectedRow} onClose={() => setSelectedId(null)} title={selectedRow?.name ?? ''} accent={MODULE.accent}>
        {selectedRow && (
          <Breakdown
            key={selectedRow.employee_id}
            row={selectedRow}
            month={month}
            totalDays={totalDays}
            workingDaysElapsed={workingDaysElapsed}
            asOf={asOf}
            editable={editable && !locked}
            saving={savingOverride}
            onSave={(amount, note) => saveOverride(selectedRow.employee_id, amount, note)}
            onClear={() => clearOverride(selectedRow.employee_id)}
            paying={payingId === selectedRow.employee_id}
            onSetStatus={(st) => togglePaid(selectedRow.employee_id, st)}
          />
        )}
      </Modal>
    </div>
  );
}

function Breakdown({ row, month, totalDays, workingDaysElapsed, asOf, editable, saving, onSave, onClear, paying, onSetStatus }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  function startEdit() {
    const current = row.override ? row.override.amount : row.fullPay;
    setAmount(current != null ? String(current) : '');
    setNote(row.override?.note ?? '');
    setEditing(true);
  }

  function submit(e) {
    e.preventDefault();
    const n = Number(amount);
    if (amount === '' || Number.isNaN(n)) return;
    onSave(n, note);
    setEditing(false);
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Info label="Wage type" value={row.wage_type} />
        <Info label="Rate" value={`${inr(row.rate)}${row.wage_type === 'Daily' ? '/day' : '/month'}`} />
        <Info label="Working days (full month)" value={totalDays ? `${totalDays} (${monthLabel(month)})` : 'Not set'} />
        <Info label={`Working days elapsed (as of ${fmtDate(asOf)})`} value={totalDays ? workingDaysElapsed : '—'} />
        <Info label="Days present" value={row.daysPresent} />
      </div>

      {totalDays ? (
        <div className="rounded-lg p-3 space-y-1.5" style={{ background: THEME.panel2 }}>
          <Line label="Full pay if all days worked" value={inr(row.fullPay)} />
          <Line label="Per-day rate" value={inr(row.perDayRate)} />
          <Line label={`Days absent so far (${row.absentDays} × ${inr(row.perDayRate)})`} value={`-${inr(row.deduction)}`} tone="amber" />
          <div className="my-1" style={{ height: 1, background: THEME.border }} />
          <Line
            label={`Calculated payable (as of ${fmtDate(asOf)})`}
            value={inr(row.payable)}
            tone={row.override ? undefined : 'green'}
            bold={!row.override}
          />
          {row.advanceTotal > 0 && (
            <Line label="Advances taken this month" value={`-${inr(row.advanceTotal)}`} tone="amber" />
          )}
        </div>
      ) : (
        <Banner tone="amber">Set the total working days for this month to calculate salary from attendance.</Banner>
      )}

      <div
        className="rounded-lg p-3"
        style={{
          background: row.override ? 'rgba(255,193,7,0.08)' : THEME.panel2,
          border: `1px solid ${row.override ? THEME.amber : THEME.border}`,
        }}
      >
        {editing ? (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full-month target salary (₹)" required
              hint="What this worker's total salary for the month should be — e.g. a raise effective mid-month. It's prorated by days elapsed, same as the calculated figure, so 'Payable' below still reflects only what's due so far.">
              <Input type="number" step="0.01" autoFocus required
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Note (optional)" hint="Why this differs from the calculated amount — bonus, deduction, correction…">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Diwali bonus" />
            </Field>
            <div className="flex gap-2 justify-end">
              <Btn type="button" variant="subtle" onClick={() => setEditing(false)}>Cancel</Btn>
              <Btn type="submit" accent={THEME.amber} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          </form>
        ) : (
          <>
            {row.override && (
              <Line label="Full-month target (edited)" value={inr(row.override.amount)} tone="amber" />
            )}
            <Line
              label={row.override ? `Payable as of ${fmtDate(asOf)}` : 'Final salary'}
              value={row.finalPayable != null ? inr(row.finalPayable) : '—'}
              tone="green" bold
            />
            {row.override?.note && (
              <div className="text-xs mt-1.5" style={{ color: THEME.textDim }}>{row.override.note}</div>
            )}
            <div className="flex justify-between items-start gap-3 mt-2">
              <span style={{ color: THEME.textDim }}>Salary for {monthLabel(month)}</span>
              <PayStatusToggle status={row.status} paidOn={row.paid_on} editable={editable}
                busy={paying} onToggle={onSetStatus} />
            </div>
            {editable && (
              <div className="flex gap-3 mt-2.5">
                <button type="button" className="text-xs font-semibold" style={{ color: THEME.amber }} onClick={startEdit}>
                  Edit salary
                </button>
                {row.override && (
                  <button type="button" className="text-xs" style={{ color: THEME.red }} onClick={onClear} disabled={saving}>
                    Remove override, use calculated
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide mb-1.5" style={{ color: THEME.textDim }}>
          Days marked present
        </div>
        {row.dates.length === 0 ? (
          <div className="text-xs" style={{ color: THEME.textDim }}>No attendance marked this month.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.dates.map((d) => (
              <span key={d} className="text-xs px-2 py-1 rounded" style={{ background: THEME.panel2, color: THEME.text }}>
                {fmtDate(d)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: THEME.textDim }}>{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Line({ label, value, tone, bold }) {
  const color = tone === 'amber' ? THEME.amber : tone === 'green' ? THEME.green : THEME.text;
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: THEME.textDim }}>{label}</span>
      <span style={{ color, fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Today, if "month" is the current month — otherwise the last day of it. */
function defaultAsOf(month) {
  if (month === thisMonth()) return today();
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}
