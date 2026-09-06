import { useEffect, useMemo, useState } from 'react';
import { Printer, Pencil } from 'lucide-react';
import { THEME } from '../lib/theme';
import { inr, monthLabel, thisMonth, fmtDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { COMPANY } from '../config/company';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, Select,
  SiteSelect, TableWrap, Th, Td, IconBtn, DeleteBtn, ExportButton, Banner, Modal, FormShell,
} from '../components/ui';

const MODULE = moduleByKey('team');
const blankWorker = { name: '', trade: '', site_id: '', wage_type: 'Daily', wage_rate: '', phone: '', aadhaar: '' };

/**
 * Worker master plus payroll, on one screen — they share the same data
 * (wage rate, attendance) and the same "team" permission, so there's no
 * reason to keep them apart.
 *
 * Payroll reads, never writes, the source data:
 *   days present = number of attendance musters in the month that include
 *                  the worker in present_ids
 *   gross        = monthly wage, or daily wage x days present
 *   net          = gross - advances taken that month, unless a manual salary
 *                  adjustment exists for that worker/month (e.g. a raise that
 *                  took effect mid-month) — that figure wins instead. This is
 *                  a full-month target: the Attendance Register prorates the
 *                  same override by days elapsed instead of paying it whole
 *                  before the month is over.
 * "Save run" freezes those numbers as a snapshot so later edits to attendance
 * don't quietly rewrite a salary you already paid.
 */
export default function Team() {
  const { activeSites, siteName } = useAppData();
  const { canEdit, locks } = useAuth();
  const { rows: employees, loading: employeesLoading, add, update, remove } = useRecords('employees', {
    orderBy: 'name', ascending: true,
  });
  const { rows: runs, loading: runsLoading, add: saveRun, remove: deleteRun } = useRecords('payroll_runs', {
    orderBy: 'generated_at',
  });

  const editable = canEdit('team');
  const locked = !!locks.team;

  /* ---------------------------- worker roster ---------------------------- */
  const [form, setForm] = useState(blankWorker);
  const [open, setOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  function startEditEmployee(emp) {
    setEditingEmployee(emp);
    setForm({
      name: emp.name ?? '',
      trade: emp.trade ?? '',
      site_id: emp.site_id ?? '',
      wage_type: emp.wage_type ?? 'Daily',
      wage_rate: emp.wage_rate != null ? String(emp.wage_rate) : '',
      phone: emp.phone ?? '',
      aadhaar: emp.aadhaar ?? '',
    });
    setError(null);
  }

  async function submitWorker(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const patch = {
      ...form,
      site_id: form.site_id || null,
      trade: form.trade || null,
      phone: form.phone || null,
      aadhaar: form.aadhaar || null,
      wage_rate: Number(form.wage_rate) || 0,
    };
    try {
      if (editingEmployee) {
        await update(editingEmployee.id, patch);
        setEditingEmployee(null);
      } else {
        await add(patch);
        setOpen(false);
      }
      setForm(blankWorker);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const exportCols = [
    { key: 'name', label: 'Name' },
    { key: 'trade', label: 'Trade' },
    { key: 'site_id', label: 'Site', value: (r) => siteName(r.site_id) },
    { key: 'wage_type', label: 'Wage Type' },
    { key: 'wage_rate', label: 'Rate' },
    { key: 'phone', label: 'Phone' },
    { key: 'aadhaar', label: 'Aadhaar' },
    { key: 'active', label: 'Active', value: (r) => (r.active === false ? 'No' : 'Yes') },
  ];

  /* -------------------------------- payroll ------------------------------- */
  const [month, setMonth] = useState(thisMonth());
  const [attendance, setAttendance] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [printId, setPrintId] = useState(null);
  const [savingRun, setSavingRun] = useState(false);

  const [editingSalaryId, setEditingSalaryId] = useState(null);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPayrollLoading(true);
      const start = `${month}-01`;
      const end = nextMonthStart(month);
      const [a, adv, adj] = await Promise.all([
        supabase.from('attendance').select('date,present_ids').gte('date', start).lt('date', end),
        supabase.from('advances').select('employee_id,amount,date').gte('date', start).lt('date', end),
        supabase.from('salary_adjustments').select('*').eq('month', month),
      ]);
      if (cancelled) return;
      setAttendance(a.data ?? []);
      setAdvances(adv.data ?? []);
      setAdjustments(adj.data ?? []);
      setPayrollLoading(false);
    })();
    return () => { cancelled = true; };
  }, [month]);

  const payrollRows = useMemo(() => {
    return employees
      .filter((e) => e.active !== false)
      .map((emp) => {
        const days = new Set(
          attendance.filter((a) => (a.present_ids ?? []).includes(emp.id)).map((a) => a.date)
        ).size;
        const rate = Number(emp.wage_rate) || 0;
        const gross = emp.wage_type === 'Monthly' ? rate : rate * days;
        const advance = advances
          .filter((a) => a.employee_id === emp.id)
          .reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const calculatedNet = gross - advance;
        const override = adjustments.find((a) => a.employee_id === emp.id) ?? null;
        return {
          employee_id: emp.id,
          name: emp.name,
          trade: emp.trade,
          site: siteName(emp.site_id),
          wage_type: emp.wage_type,
          rate,
          days_present: days,
          gross,
          advance,
          calculatedNet,
          override,
          net: override ? Number(override.amount) : calculatedNet,
        };
      });
  }, [employees, attendance, advances, adjustments, siteName]);

  const totals = useMemo(
    () => payrollRows.reduce(
      (t, r) => ({ gross: t.gross + r.gross, advance: t.advance + r.advance, net: t.net + r.net }),
      { gross: 0, advance: 0, net: 0 }
    ),
    [payrollRows]
  );

  const day = new Date().getDate();
  const dueSoon = day >= 1 && day <= 7;
  const printRun = runs.find((r) => r.id === printId);
  const editingSalaryRow = payrollRows.find((r) => r.employee_id === editingSalaryId) ?? null;

  async function handleSaveRun() {
    setSavingRun(true);
    setError(null);
    try {
      await saveRun({ month, rows: payrollRows, totals });
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingRun(false);
    }
  }

  function startEditSalary(row) {
    setEditingSalaryId(row.employee_id);
    setOverrideAmount(String(row.net));
    setOverrideNote(row.override?.note ?? '');
    setError(null);
  }

  async function saveOverride(e) {
    e.preventDefault();
    const n = Number(overrideAmount);
    if (overrideAmount === '' || Number.isNaN(n)) { setError('Enter a valid amount.'); return; }
    setSavingOverride(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from('salary_adjustments')
        .upsert(
          { employee_id: editingSalaryId, month, amount: n, note: overrideNote || null, updated_at: new Date().toISOString() },
          { onConflict: 'employee_id,month' }
        )
        .select()
        .single();
      if (err) throw err;
      setAdjustments((prev) => [...prev.filter((a) => a.employee_id !== editingSalaryId), data]);
      setEditingSalaryId(null);
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
      setEditingSalaryId(null);
    } catch (err) {
      setError(err.message || 'Could not remove the adjustment.');
    } finally {
      setSavingOverride(false);
    }
  }

  const payrollExportCols = [
    { key: 'name', label: 'Worker' },
    { key: 'site', label: 'Site' },
    { key: 'wage_type', label: 'Wage Type' },
    { key: 'rate', label: 'Rate' },
    { key: 'days_present', label: 'Days Present' },
    { key: 'gross', label: 'Gross' },
    { key: 'advance', label: 'Advances' },
    { key: 'net', label: 'Net Payable' },
  ];

  return (
    <div>
      <SectionHeader
        title="Team"
        subtitle="Worker master and monthly payroll, from attendance"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="team.csv" columns={exportCols} rows={employees} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setForm(blankWorker); setError(null); }}
        accent={MODULE.accent}
        label="Add Worker"
        onSubmit={submitWorker}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <WorkerFields form={form} set={set} activeSites={activeSites} />
      </FormShell>

      {employeesLoading ? (
        <Loading />
      ) : employees.length === 0 ? (
        <Card>
          <EmptyState label="No workers added yet." hint="Add your team so attendance and payroll can work." />
        </Card>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {employees.map((e) => (
              <Card key={e.id} className="p-3 flex justify-between items-start gap-3"
                style={{ opacity: e.active === false ? 0.55 : 1 }}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{e.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                    {[e.trade, siteName(e.site_id)].filter((x) => x && x !== '—').join(' · ') || '—'}
                  </div>
                  <div className="text-xs mt-0.5">
                    {inr(e.wage_rate)}{e.wage_type === 'Daily' ? '/day' : '/month'}
                    {e.phone && <span style={{ color: THEME.textDim }}> · {e.phone}</span>}
                  </div>
                  {e.aadhaar && (
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>Aadhaar {e.aadhaar}</div>
                  )}
                </div>
                {editable && !locked && (
                  <RowActions emp={e} update={update} remove={remove} setError={setError} onEdit={startEditEmployee} />
                )}
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr style={{ background: THEME.panel2 }}>
                  {['Name', 'Trade', 'Site', 'Wage', 'Rate', 'Phone', 'Aadhaar'].map((h) => <Th key={h}>{h}</Th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-t" style={{ borderColor: THEME.border, opacity: e.active === false ? 0.55 : 1 }}>
                    <Td><span className="font-medium">{e.name}</span></Td>
                    <Td>{e.trade || '—'}</Td>
                    <Td>{siteName(e.site_id)}</Td>
                    <Td>{e.wage_type}</Td>
                    <Td>{inr(e.wage_rate)}{e.wage_type === 'Daily' ? '/day' : '/mo'}</Td>
                    <Td>{e.phone || '—'}</Td>
                    <Td>{e.aadhaar || '—'}</Td>
                    <Td>
                      <div className="flex justify-end">
                        {editable && !locked && (
                          <RowActions emp={e} update={update} remove={remove} setError={setError} onEdit={startEditEmployee} />
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}

      <div className="text-sm font-semibold mt-10 mb-2" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
        PAYROLL
      </div>

      {dueSoon && (
        <Banner tone="amber">
          Start of the month — generate and save last month's salary sheet if you haven't already.
        </Banner>
      )}

      <Card className="p-4 mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
            Salary month
          </label>
          <input
            type="month"
            className="bg-transparent border rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: THEME.border, color: THEME.text }}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        {editable && !locked && (
          <Btn accent={THEME.green} onClick={handleSaveRun} disabled={savingRun || !payrollRows.length}>
            {savingRun ? 'Saving…' : 'Save Payroll Run'}
          </Btn>
        )}
        <ExportButton label="Export Month" filename={`payroll_${month}.csv`} columns={payrollExportCols} rows={payrollRows} />
        <div className="text-xs w-full sm:w-auto sm:ml-auto" style={{ color: THEME.textDim }}>
          Days counted from attendance musters in {monthLabel(month)}.
        </div>
      </Card>

      {payrollLoading ? (
        <Loading label="Calculating…" />
      ) : employees.length === 0 ? (
        <Card><EmptyState label="Add workers above first — payroll needs wage data." /></Card>
      ) : (
        <div className="mb-8">
          <TableWrap>
            <thead>
              <tr style={{ background: THEME.panel2 }}>
                {['Worker', 'Site', 'Type', 'Days', 'Gross', 'Advances', 'Net Payable'].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payrollRows.map((r) => (
                <tr key={r.employee_id} className="border-t" style={{ borderColor: THEME.border }}>
                  <Td><span className="font-medium">{r.name}</span></Td>
                  <Td>{r.site}</Td>
                  <Td>{r.wage_type}</Td>
                  <Td>{r.wage_type === 'Monthly' ? '—' : r.days_present}</Td>
                  <Td>{inr(r.gross)}</Td>
                  <Td><span style={{ color: THEME.amber }}>{r.advance ? `-${inr(r.advance)}` : '—'}</span></Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold" style={{ color: THEME.green }}>{inr(r.net)}</span>
                      {r.override && <span className="text-xs" style={{ color: THEME.amber }}>edited</span>}
                      {editable && !locked && (
                        <IconBtn icon={Pencil} title="Edit salary" onClick={() => startEditSalary(r)} />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: THEME.panel2 }}>
                <td className="px-3 py-2.5 font-semibold" colSpan={4}>Total</td>
                <td className="px-3 py-2.5 font-semibold">{inr(totals.gross)}</td>
                <td className="px-3 py-2.5 font-semibold" style={{ color: THEME.amber }}>-{inr(totals.advance)}</td>
                <td className="px-3 py-2.5 font-semibold" style={{ color: THEME.green }}>{inr(totals.net)}</td>
              </tr>
            </tfoot>
          </TableWrap>
        </div>
      )}

      <div className="text-sm font-semibold mb-2" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
        SAVED PAYROLL RUNS
      </div>
      {runsLoading ? (
        <Loading />
      ) : runs.length === 0 ? (
        <Card><EmptyState label="No payroll runs saved yet." /></Card>
      ) : (
        <div className="space-y-2 no-print">
          {runs.map((r) => (
            <Card key={r.id} className="p-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="font-semibold">{monthLabel(r.month)}</span>
                <span className="text-xs ml-2" style={{ color: THEME.textDim }}>
                  Net {inr(r.totals?.net)} · saved {fmtDate(r.generated_at)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPrintId(printId === r.id ? null : r.id)}
                  className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5"
                  style={{ color: THEME.green }}
                >
                  <Printer size={14} /> {printId === r.id ? 'Hide' : 'Print'}
                </button>
                {editable && !locked && (
                  <DeleteBtn onDelete={() => deleteRun(r.id).catch((e) => setError(e.message))} label="this run" />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {printRun && <SalaryPrint run={printRun} />}
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}

      <Modal open={!!editingEmployee} onClose={() => setEditingEmployee(null)} title={`Edit ${editingEmployee?.name ?? ''}`} accent={MODULE.accent}>
        {editingEmployee && (
          <form onSubmit={submitWorker} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <WorkerFields form={form} set={set} activeSites={activeSites} />
            {error && (
              <div className="sm:col-span-2 text-xs px-3 py-2 rounded-lg" style={{ color: THEME.red, background: 'rgba(215,38,61,0.1)' }}>
                {error}
              </div>
            )}
            <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
              <Btn type="button" variant="subtle" onClick={() => setEditingEmployee(null)}>Cancel</Btn>
              <Btn type="submit" accent={MODULE.accent} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!editingSalaryId} onClose={() => setEditingSalaryId(null)} title={editingSalaryRow?.name ?? ''} accent={THEME.green}>
        {editingSalaryRow && (
          <form onSubmit={saveOverride} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Info label="Calculated net" value={inr(editingSalaryRow.calculatedNet)} />
              <Info label="Days present" value={editingSalaryRow.wage_type === 'Monthly' ? '—' : editingSalaryRow.days_present} />
            </div>
            <Field label="Final net payable (₹)" required>
              <Input type="number" step="0.01" autoFocus required
                value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)} />
            </Field>
            <Field label="Note (optional)" hint="Why this differs from the calculated amount — a raise effective mid-month, bonus, correction…">
              <Input value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="e.g. Raised to ₹700/day from the 15th" />
            </Field>
            <div className="flex items-center justify-between gap-2 pt-1">
              {editingSalaryRow.override ? (
                <button type="button" className="text-xs" style={{ color: THEME.red }}
                  onClick={() => clearOverride(editingSalaryRow.employee_id)} disabled={savingOverride}>
                  Remove override, use calculated
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <Btn type="button" variant="subtle" onClick={() => setEditingSalaryId(null)}>Cancel</Btn>
                <Btn type="submit" accent={THEME.green} disabled={savingOverride}>
                  {savingOverride ? 'Saving…' : 'Save'}
                </Btn>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function WorkerFields({ form, set, activeSites }) {
  return (
    <>
      <Field label="Name" required>
        <Input required value={form.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="Trade">
        <Input value={form.trade} onChange={(e) => set('trade', e.target.value)}
          placeholder="Fitter, Welder, Electrician, Helper…" />
      </Field>
      <Field label="Primary site" hint="Leave blank if they move between sites.">
        <SiteSelect sites={activeSites} value={form.site_id} onChange={(e) => set('site_id', e.target.value)} />
      </Field>
      <Field label="Wage type">
        <Select value={form.wage_type} options={['Daily', 'Monthly']} placeholder="Select…"
          onChange={(e) => set('wage_type', e.target.value)} />
      </Field>
      <Field label={form.wage_type === 'Monthly' ? 'Monthly wage (₹)' : 'Daily wage (₹)'}>
        <Input type="number" inputMode="numeric" value={form.wage_rate}
          onChange={(e) => set('wage_rate', e.target.value)} placeholder="0" />
      </Field>
      <Field label="Phone">
        <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      </Field>
      <Field label="Aadhaar number">
        <Input
          value={form.aadhaar}
          onChange={(e) => set('aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
          placeholder="12-digit number"
          inputMode="numeric"
          maxLength={12}
        />
      </Field>
    </>
  );
}

function RowActions({ emp, update, remove, setError, onEdit }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <IconBtn icon={Pencil} title="Edit details" onClick={() => onEdit(emp)} />
      <Btn
        variant="ghost"
        className="!px-2 !py-1 !text-xs"
        onClick={() => update(emp.id, { active: emp.active === false }).catch((e) => setError(e.message))}
      >
        {emp.active === false ? 'Rehire' : 'Left'}
      </Btn>
      <DeleteBtn onDelete={() => remove(emp.id).catch((e) => setError(e.message))} label="this worker" />
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

function SalaryPrint({ run }) {
  return (
    <div className="print-area mt-6 p-6 sm:p-8 rounded-xl bg-white text-black">
      <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-4 gap-4">
        <div>
          <div className="text-xl sm:text-2xl font-bold" style={{ fontFamily: 'Oswald' }}>{COMPANY.name}</div>
          <div className="text-xs">{COMPANY.tagline}</div>
          {COMPANY.address && <div className="text-xs mt-1">{COMPANY.address}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base sm:text-lg font-bold">SALARY STATEMENT</div>
          <div className="text-sm">{monthLabel(run.month)}</div>
        </div>
      </div>

      <table className="w-full text-sm border-collapse mb-6">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-1">Worker</th>
            <th className="text-left py-1">Type</th>
            <th className="text-right py-1">Days</th>
            <th className="text-right py-1">Gross</th>
            <th className="text-right py-1">Advances</th>
            <th className="text-right py-1">Net Payable</th>
            <th className="text-left py-1 pl-4">Signature</th>
          </tr>
        </thead>
        <tbody>
          {(run.rows ?? []).map((r, i) => (
            <tr key={i} className="border-b border-gray-300">
              <td className="py-1.5">{r.name}</td>
              <td className="py-1.5">{r.wage_type}</td>
              <td className="py-1.5 text-right">{r.wage_type === 'Monthly' ? '—' : r.days_present}</td>
              <td className="py-1.5 text-right">{inr(r.gross)}</td>
              <td className="py-1.5 text-right">{r.advance ? `-${inr(r.advance)}` : '—'}</td>
              <td className="py-1.5 text-right font-semibold">{inr(r.net)}</td>
              <td className="py-1.5 pl-4" style={{ minWidth: 120 }} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1.5" colSpan={3}>Total</td>
            <td className="py-1.5 text-right">{inr(run.totals?.gross)}</td>
            <td className="py-1.5 text-right">-{inr(run.totals?.advance)}</td>
            <td className="py-1.5 text-right">{inr(run.totals?.net)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="grid grid-cols-2 gap-4 text-sm mt-12">
        <div>Prepared By: ______________________</div>
        <div>Approved By: ______________________</div>
      </div>

      <Btn className="no-print mt-6" style={{ background: '#111', color: '#fff', border: '1px solid #111' }}
        icon={Printer} onClick={() => window.print()}>
        Print / Save as PDF
      </Btn>
    </div>
  );
}

function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 1); // month is 1-based here, so this is the 1st of the next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
