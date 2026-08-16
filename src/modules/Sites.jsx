import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { THEME } from '../lib/theme';
import { useRecords } from '../hooks/useRecords';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input,
  DeleteBtn, ExportButton, FormShell, Btn,
} from '../components/ui';

const MODULE = moduleByKey('sites');

export default function Sites() {
  const { canEdit, locks } = useAuth();
  const { rows, loading, add, update, remove } = useRecords('sites', { orderBy: 'name', ascending: true });

  const blank = { name: '', location: '', contact: '' };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const editable = canEdit('sites');
  const locked = !!locks.sites;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await add({ ...form, location: form.location || null, contact: form.contact || null });
      setForm(blank);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const exportCols = [
    { key: 'name', label: 'Site' },
    { key: 'location', label: 'Location' },
    { key: 'contact', label: 'Contact' },
    { key: 'active', label: 'Active', value: (r) => (r.active === false ? 'No' : 'Yes') },
  ];

  return (
    <div>
      <SectionHeader
        title="Sites"
        subtitle="The master list every other screen refers to — set these up first"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="sites.csv" columns={exportCols} rows={rows} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="Add Site"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <Field label="Site name" required full>
          <Input required value={form.name} onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Skyline Towers — Tower B" />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Area / city" />
        </Field>
        <Field label="Site contact">
          <Input value={form.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Name / phone" />
        </Field>
      </FormShell>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            label="No sites yet."
            hint="Add your first site — attendance, DPRs and material entries all hang off this list."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((s) => (
            <Card key={s.id} className="p-4 flex items-start justify-between gap-3"
              style={{ opacity: s.active === false ? 0.55 : 1 }}>
              <div className="min-w-0">
                <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                  {s.name}
                  {s.active === false && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: THEME.panel2, color: THEME.textDim }}>CLOSED</span>
                  )}
                </div>
                <div className="text-xs mt-1 flex items-center gap-1" style={{ color: THEME.textDim }}>
                  <MapPin size={12} /> {s.location || 'No location set'}
                </div>
                {s.contact && <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>{s.contact}</div>}
              </div>
              {editable && !locked && (
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Btn
                    variant="ghost"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => update(s.id, { active: s.active === false }).catch((e) => setError(e.message))}
                  >
                    {s.active === false ? 'Reopen' : 'Close'}
                  </Btn>
                  <DeleteBtn onDelete={() => remove(s.id).catch((e) => setError(e.message))} label="this site" />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {editable && rows.length > 0 && (
        <p className="text-xs mt-4" style={{ color: THEME.textDim }}>
          Closing a site hides it from the dropdowns but keeps all its history. Deleting a site
          removes its attendance, DPRs and photos too — close it instead unless it was a mistake.
        </p>
      )}
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}
