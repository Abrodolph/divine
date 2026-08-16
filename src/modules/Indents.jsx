import { useMemo, useState } from 'react';
import { THEME } from '../lib/theme';
import { today, fmtDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import ItemsEditor, { emptyItems, itemsSummary } from '../components/ItemsEditor';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, TextArea,
  Select, SiteSelect, StatusBadge, DeleteBtn, ExportButton, FormShell,
} from '../components/ui';

const MODULE = moduleByKey('indents');
const STATUSES = ['Pending', 'Approved', 'Partial', 'Fulfilled', 'Rejected'];

export default function Indents() {
  const { activeSites, siteName, siteFilter } = useAppData();
  const { canEdit, locks, profile } = useAuth();
  const { rows, loading, add, update, remove } = useRecords('indents', { orderBy: 'date' });

  const blank = {
    date: today(), site_id: siteFilter || '', requested_by: profile?.name ?? '',
    priority: 'Medium', needed_by: '', remarks: '',
  };
  const [form, setForm] = useState(blank);
  const [items, setItems] = useState(emptyItems());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const editable = canEdit('indents');
  const locked = !!locks.indents;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const visible = useMemo(
    () => (siteFilter ? rows.filter((r) => r.site_id === siteFilter) : rows),
    [rows, siteFilter]
  );

  async function submit(e) {
    e.preventDefault();
    const cleanItems = items.filter((i) => i.name.trim());
    if (!form.site_id) { setError('Choose the site.'); return; }
    if (!cleanItems.length) { setError('Add at least one item.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Numbers come from a database counter, so deleting an indent never
      // causes the next one to reuse a number.
      const { data: docNo } = await supabase.rpc('next_doc_no', { p_prefix: 'IND' });
      await add({
        ...form,
        needed_by: form.needed_by || null,
        status: 'Pending',
        items: cleanItems,
        doc_no: docNo,
      });
      setForm({ ...blank, site_id: form.site_id });
      setItems(emptyItems());
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const exportCols = [
    { key: 'doc_no', label: 'Indent No.' },
    { key: 'date', label: 'Date' },
    { key: 'site_id', label: 'Site', value: (r) => siteName(r.site_id) },
    { key: 'requested_by', label: 'Requested By' },
    { key: 'priority', label: 'Priority' },
    { key: 'status', label: 'Status' },
    { key: 'needed_by', label: 'Needed By' },
    { key: 'items', label: 'Items', value: (r) => itemsSummary(r.items) },
    { key: 'remarks', label: 'Remarks' },
  ];

  return (
    <div>
      <SectionHeader
        title="Site Indent"
        subtitle="Material requisition raised by site to the office"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="indents.csv" columns={exportCols} rows={visible} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="Raise Indent"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <Field label="Site" required>
          <SiteSelect sites={activeSites} required value={form.site_id} onChange={(e) => set('site_id', e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Requested by">
          <Input value={form.requested_by} onChange={(e) => set('requested_by', e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select value={form.priority} options={['Low', 'Medium', 'High', 'Urgent']}
            placeholder="Select…" onChange={(e) => set('priority', e.target.value)} />
        </Field>
        <Field label="Needed by" hint="When does site need this in hand?">
          <Input type="date" value={form.needed_by} onChange={(e) => set('needed_by', e.target.value)} />
        </Field>
        <ItemsEditor items={items} setItems={setItems} accent={MODULE.accent} />
        <Field label="Remarks" full>
          <TextArea rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </FormShell>

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Card><EmptyState label="No indents raised yet." /></Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: THEME.panel2, color: MODULE.accent }}>
                    {r.doc_no ?? '—'}
                  </span>
                  <div className="font-semibold mt-1.5" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                    {siteName(r.site_id)}
                  </div>
                  <div className="text-xs" style={{ color: THEME.textDim }}>
                    {fmtDate(r.date)} · by {r.requested_by || '—'}
                    {r.needed_by && ` · needed ${fmtDate(r.needed_by)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge value={r.priority} />
                  {editable && !locked ? (
                    <select
                      value={r.status ?? 'Pending'}
                      onChange={(e) => update(r.id, { status: e.target.value }).catch((x) => setError(x.message))}
                      className="bg-transparent border rounded-lg px-2 py-1.5 text-xs outline-none"
                      style={{ borderColor: THEME.border, color: THEME.text }}
                      aria-label="Indent status"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <StatusBadge value={r.status} />
                  )}
                  {editable && !locked && <DeleteBtn onDelete={() => remove(r.id).catch((x) => setError(x.message))} />}
                </div>
              </div>

              <ul className="mt-3 text-sm space-y-1">
                {(r.items ?? []).map((it, i) => (
                  <li key={i}>• {it.name} — {it.qty} {it.unit}</li>
                ))}
              </ul>
              {r.remarks && <div className="mt-2 text-xs" style={{ color: THEME.textDim }}>{r.remarks}</div>}
            </Card>
          ))}
        </div>
      )}
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}
