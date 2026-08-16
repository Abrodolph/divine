import { useState } from 'react';
import { THEME } from '../lib/theme';
import { inr } from '../lib/format';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, Select,
  SiteSelect, TableWrap, Th, Td, DeleteBtn, ExportButton, FormShell, Btn,
} from '../components/ui';

const MODULE = moduleByKey('team');

export default function Team() {
  const { activeSites, siteName } = useAppData();
  const { canEdit, locks } = useAuth();
  const { rows, loading, add, update, remove } = useRecords('employees', { orderBy: 'name', ascending: true });

  const blank = { name: '', trade: '', site_id: '', wage_type: 'Daily', wage_rate: '', phone: '' };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const editable = canEdit('team');
  const locked = !!locks.team;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await add({
        ...form,
        site_id: form.site_id || null,
        trade: form.trade || null,
        phone: form.phone || null,
        wage_rate: Number(form.wage_rate) || 0,
      });
      setForm(blank);
      setOpen(false);
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
    { key: 'active', label: 'Active', value: (r) => (r.active === false ? 'No' : 'Yes') },
  ];

  return (
    <div>
      <SectionHeader
        title="Team"
        subtitle="Worker master — drives the attendance tick-list and payroll"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="team.csv" columns={exportCols} rows={rows} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="Add Worker"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
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
      </FormShell>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState label="No workers added yet." hint="Add your team so attendance and payroll can work." />
        </Card>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.map((e) => (
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
                </div>
                {editable && !locked && <RowActions emp={e} update={update} remove={remove} setError={setError} />}
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr style={{ background: THEME.panel2 }}>
                  {['Name', 'Trade', 'Site', 'Wage', 'Rate', 'Phone'].map((h) => <Th key={h}>{h}</Th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t" style={{ borderColor: THEME.border, opacity: e.active === false ? 0.55 : 1 }}>
                    <Td><span className="font-medium">{e.name}</span></Td>
                    <Td>{e.trade || '—'}</Td>
                    <Td>{siteName(e.site_id)}</Td>
                    <Td>{e.wage_type}</Td>
                    <Td>{inr(e.wage_rate)}{e.wage_type === 'Daily' ? '/day' : '/mo'}</Td>
                    <Td>{e.phone || '—'}</Td>
                    <Td>
                      <div className="flex justify-end">
                        {editable && !locked && <RowActions emp={e} update={update} remove={remove} setError={setError} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}

function RowActions({ emp, update, remove, setError }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
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
