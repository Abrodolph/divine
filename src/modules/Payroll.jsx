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
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input,
  TableWrap, Th, Td, IconBtn, DeleteBtn, ExportButton, Banner, Modal,
} from '../components/ui';

const MODULE = moduleByKey('payroll');

/**
 * Payroll reads, never writes, the source data:
 *   days present = number of attendance musters in the month that include
 *                  the worker in present_ids
 *   gross        = monthly wage, or daily wage x days present
 *   net          = gross - advances taken that month, unless a manual salary
 *                  adjustment exists for that worker/month (e.g. a raise that
 *                  took effect mid-month) — that figure wins instead.
 * "Save run" freezes those numbers as a snapshot so later edits to attendance
 * don't quietly rewrite a salary you already paid.
 */
export default function Payroll() {
  const { employees, sites, siteName } = useAppData();
  const { canEdit, locks } = useAuth();
  const { rows: runs, loading: runsLoading, add: saveRun, remove: deleteRun } = useRecords('payroll_runs', {
    orderBy: 'generated_at',
  });

  const [month, setMonth] = useState(thisMonth());
  const [attendance, setAttendance] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printId, setPrintId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const editable = canEdit('payroll');
  const locked = !!locks.payroll;

  // Pull only the chosen month — no need to hold every record ever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [month]);

  const rows = useMemo(() => {
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
    () => rows.reduce(
      (t, r) => ({ gross: t.gross + r.gross, advance: t.advance + r.advance, net: t.net + r.net }),
      { gross: 0, advance: 0, net: 0 }
    ),
    [rows]
  );

  const day = new Date().getDate();
  const dueSoon = day >= 1 && day <= 7;
  const printRun = runs.find((r) => r.id === printId);
  const editingRow = rows.find((r) => r.employee_id === editingId) ?? null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveRun({ month, rows, totals });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function startEditSalary(row) {
    setEditingId(row.employee_id);
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
          { employee_id: editingId, month, amount: n, note: overrideNote || null, updated_at: new Date().toISOString() },
          { onConflict: 'employee_id,month' }
        )
        .select()
        .single();
      if (err) throw err;
      setAdjustments((prev) => [...prev.filter((a) => a.employee_id !== editingId), data]);
      setEditingId(null);
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
      setEditingId(null);
    } catch (err) {
      setError(err.message || 'Could not remove the adjustment.');
    } finally {
      setSavingOverride(false);
    }
  }

  const exportCols = [
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
        title="Payroll"
        subtitle="Monthly salary from attendance, net of advances already paid"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton label="Export Month" filename={`payroll_${month}.csv`} columns={exportCols} rows={rows} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

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
          <Btn accent={MODULE.accent} onClick={handleSave} disabled={saving || !rows.length}>
            {saving ? 'Saving…' : 'Save Payroll Run'}
          </Btn>
        )}
        <div className="text-xs w-full sm:w-auto sm:ml-auto" style={{ color: THEME.textDim }}>
          Days counted from attendance musters in {monthLabel(month)}.
        </div>
      </Card>

      {loading ? (
        <Loading label="Calculating…" />
      ) : employees.length === 0 ? (
        <Card><EmptyState label="Add workers under Team first — payroll needs wage data." /></Card>
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
              {rows.map((r) => (
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
                  style={{ color: MODULE.accent }}
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

      <Modal open={!!editingId} onClose={() => setEditingId(null)} title={editingRow?.name ?? ''} accent={MODULE.accent}>
        {editingRow && (
          <form onSubmit={saveOverride} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Info label="Calculated net" value={inr(editingRow.calculatedNet)} />
              <Info label="Days present" value={editingRow.wage_type === 'Monthly' ? '—' : editingRow.days_present} />
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
              {editingRow.override ? (
                <button type="button" className="text-xs" style={{ color: THEME.red }}
                  onClick={() => clearOverride(editingRow.employee_id)} disabled={savingOverride}>
                  Remove override, use calculated
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <Btn type="button" variant="subtle" onClick={() => setEditingId(null)}>Cancel</Btn>
                <Btn type="submit" accent={MODULE.accent} disabled={savingOverride}>
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
