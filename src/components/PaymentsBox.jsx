import { useState } from 'react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, inr, today } from '../lib/format';
import { friendly } from '../hooks/useRecords';
import { Btn, DeleteBtn, Field, FormError, Input, Select } from './ui';

const MODES = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank transfer' }, { value: 'cheque', label: 'Cheque' },
];

/**
 * Money handed to one worker against one month: the list, and a form to
 * record another payment (a weekly payout, a part payment, the final settlement).
 */
export default function PaymentsBox({ employeeId, month, payments, balance, editable, onChanged }) {
  const mine = payments.filter((p) => p.employee_id === employeeId && p.month === month);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', mode: 'cash', paid_on: today(), ref: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function start() {
    setForm({ amount: balance > 0 ? String(Math.round(balance)) : '', mode: 'cash', paid_on: today(), ref: '', note: '' });
    setError(null);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) { setError('Enter the amount paid.'); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('payroll_payments').insert({
      employee_id: employeeId, month, amount, mode: form.mode, paid_on: form.paid_on || today(),
      ref: form.ref || null, note: form.note || null,
    });
    setSaving(false);
    if (err) { setError(friendly(err)); return; }
    setOpen(false);
    onChanged?.();
  }

  async function remove(id) {
    const { error: err } = await supabase.from('payroll_payments').delete().eq('id', id);
    if (err) setError(friendly(err));
    else onChanged?.();
  }

  return (
    <div className="rounded-lg p-3" style={{ background: THEME.panel2 }}>
      <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: THEME.textDim }}>Payments for this month</div>
      {mine.length === 0 ? (
        <div className="text-xs" style={{ color: THEME.textDim }}>Nothing paid yet.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {mine.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span>
                <b style={{ color: THEME.green }}>{inr(p.amount)}</b>{' '}
                <span className="text-xs" style={{ color: THEME.textDim }}>
                  {p.mode.toUpperCase()} · {fmtDate(p.paid_on)}{p.ref ? ` · ${p.ref}` : ''}{p.note ? ` · ${p.note}` : ''}
                </span>
              </span>
              {editable && <DeleteBtn onDelete={() => remove(p.id)} label="this payment" />}
            </li>
          ))}
        </ul>
      )}
      {editable && !open && (
        <Btn variant="subtle" className="mt-3 !py-2" onClick={start}>Record payment</Btn>
      )}
      {open && (
        <form onSubmit={save} className="grid grid-cols-2 gap-2 mt-3">
          <Field label="Amount (₹)" required>
            <Input type="number" min="1" step="0.01" inputMode="decimal" autoFocus value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </Field>
          <Field label="Mode">
            <Select placeholder={null} options={MODES} value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))} />
          </Field>
          <Field label="Paid on">
            <Input type="date" value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
          </Field>
          <Field label="UPI / cheque ref">
            <Input value={form.ref} onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))} />
          </Field>
          <Field label="Note" full>
            <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Week 2 payout" />
          </Field>
          <FormError error={error} />
          <div className="col-span-2 flex justify-end gap-2">
            <Btn type="button" variant="subtle" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn type="submit" accent={THEME.green} disabled={saving}>{saving ? 'Saving…' : 'Save payment'}</Btn>
          </div>
        </form>
      )}
      {!open && error && <div className="text-xs mt-2" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}
