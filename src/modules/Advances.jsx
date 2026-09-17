import { useMemo, useState } from 'react';
import { THEME } from '../lib/theme';
import { today, fmtDate, inr, thisMonth } from '../lib/format';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, Select,
  TextArea, TableWrap, Th, Td, DeleteBtn, ExportButton, FormShell, LoadMore,
} from '../components/ui';

const MODULE = moduleByKey('advances');

export default function Advances() {
  const { activeEmployees, empName } = useAppData();
  const { canEdit, locks } = useAuth();
  const { rows, loading, add, remove, hasMore, loadMore } = useRecords('advances', { orderBy: 'date' });

  const blank = { date: today(), employee_id: '', amount: '1000', week: '', remarks: '' };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const editable = canEdit('advances');
  const locked = !!locks.advances;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const monthTotal = useMemo(
    () => rows.filter((r) => r.date?.startsWith(thisMonth()))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  );

  async function submit(e) {
    e.preventDefault();
    if (!form.employee_id) { setError('Choose the worker.'); return; }
    setSaving(true);
    setError(null);
    try {
      await add({
        ...form,
        amount: Number(form.amount) || 0,
        week: form.week || null,
        remarks: form.remarks || null,
      });
      setForm({ ...blank, week: form.week });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const exportCols = [
    { key: 'date', label: 'Date' },
    { key: 'employee_id', label: 'Worker', value: (r) => empName(r.employee_id) },
    { key: 'amount', label: 'Amount' },
    { key: 'week', label: 'Week' },
    { key: 'remarks', label: 'Remarks' },
  ];

  return (
    <div>
      <SectionHeader
        title="Weekly Advance"
        subtitle="Cash paid out during the month — deducted automatically at payroll. Locked once the month is finalised."
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="advances.csv" columns={exportCols} rows={rows} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="Log Advance"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Worker" required>
          <Select required value={form.employee_id} placeholder="Select worker…"
            onChange={(e) => set('employee_id', e.target.value)}>
            {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Amount (₹)">
          <Input type="number" inputMode="numeric" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <Field label="Week label" hint="Optional — helps when reconciling later.">
          <Input value={form.week} onChange={(e) => set('week', e.target.value)} placeholder="e.g. Week 3" />
        </Field>
        <Field label="Remarks" full>
          <TextArea rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </FormShell>

      <div className="mb-4 text-sm" style={{ color: THEME.textDim }}>
        Paid out this month:{' '}
        <span style={{ color: MODULE.accent, fontWeight: 600 }}>{inr(monthTotal)}</span>
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card><EmptyState label="No advances logged yet." /></Card>
      ) : (
        <TableWrap>
          <thead>
            <tr style={{ background: THEME.panel2 }}>
              {['Date', 'Worker', 'Amount', 'Week', 'Remarks'].map((h) => <Th key={h}>{h}</Th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: THEME.border }}>
                <Td>{fmtDate(r.date)}</Td>
                <Td><span className="font-medium">{empName(r.employee_id)}</span></Td>
                <Td>{inr(r.amount)}</Td>
                <Td>{r.week || '—'}</Td>
                <Td>{r.remarks || '—'}</Td>
                <Td>
                  <div className="text-right">
                    {editable && !locked && <DeleteBtn onDelete={() => remove(r.id).catch((e) => setError(e.message))} />}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <LoadMore hasMore={hasMore} onClick={loadMore} />
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}
