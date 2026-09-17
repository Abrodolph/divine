import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { THEME } from '../lib/theme';
import { fmtDate } from '../lib/format';
import { useRecords } from '../hooks/useRecords';
import { useAuth } from '../context/AuthContext';
import { DOC_CATEGORIES, categoryLabel, docFolder } from '../config/documents';
import {
  Btn, DeleteBtn, EmptyState, ExpiryBadge, Field, FormError, IconBtn, Input, Lightbox, Loading,
  PhotoInput, PhotoStrip, Select, TextArea,
} from './ui';

const blank = { category: '', title: '', number: '', issued_on: '', expires_on: '', notes: '', files: [] };

/**
 * Documents attached to one thing — the company, a site, a worker or a vendor.
 * Files go to the private bucket. Worker documents need hr_documents access
 * (enforced by RLS and by the storage folder policy).
 */
export default function DocumentsPanel({ scope, scopeId = null, compact = false }) {
  const { canEdit, canView, canChangeRow } = useAuth();
  const permKey = scope === 'employee' ? 'hr_documents' : 'documents';
  const editable = canEdit(permKey);
  const { rows, loading, add, update, remove, error: loadError } = useRecords('documents', {
    orderBy: 'created_at',
    filters: [['scope', 'eq', scope], scopeId ? ['scope_id', 'eq', scopeId] : ['scope_id', 'isnull']],
    enabled: canView(permKey),
  });
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  if (!canView(permKey)) return null;

  const cats = DOC_CATEGORIES[scope] ?? [];
  const cat = cats.find((c) => c.key === form?.category);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  function start(doc) {
    setEditingId(doc?.id ?? null);
    setForm(doc ? {
      category: doc.category, title: doc.title ?? '', number: doc.number ?? '', issued_on: doc.issued_on ?? '',
      expires_on: doc.expires_on ?? '', notes: doc.notes ?? '', files: doc.files ?? [],
    } : blank);
    setError(null);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.category) { setError('Choose what kind of document this is.'); return; }
    setSaving(true);
    setError(null);
    const row = {
      scope, scope_id: scopeId, category: form.category, title: form.title || null, number: form.number || null,
      issued_on: form.issued_on || null, expires_on: form.expires_on || null, notes: form.notes || null, files: form.files,
    };
    try {
      if (editingId) await update(editingId, { ...row, updated_at: new Date().toISOString() });
      else await add(row);
      setForm(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {loadError && <div className="text-xs mb-2" style={{ color: THEME.red }}>{loadError}</div>}
      {loading ? <Loading /> : rows.length === 0 && !form ? (
        compact ? <div className="text-xs py-2" style={{ color: THEME.textDim }}>No documents yet.</div>
          : <EmptyState label="No documents uploaded yet." />
      ) : (
        <div className="space-y-2">
          {rows.map((d) => (
            <div key={d.id} className="flex items-start justify-between gap-3 p-3 rounded-lg" style={{ background: THEME.panel2 }}>
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">{d.title || categoryLabel(scope, d.category)}</div>
                <div className="text-xs flex flex-wrap items-center gap-1.5" style={{ color: THEME.textDim }}>
                  {d.title && <span>{categoryLabel(scope, d.category)}</span>}
                  {d.number && <span className="font-mono">{d.number}</span>}
                  {d.issued_on && <span>issued {fmtDate(d.issued_on)}</span>}
                  <ExpiryBadge date={d.expires_on} />
                </div>
                {d.notes && <div className="text-xs" style={{ color: THEME.textDim }}>{d.notes}</div>}
                <PhotoStrip photos={d.files} onOpen={setLightbox} size={40} />
              </div>
              {editable && canChangeRow(d) && (
                <div className="flex items-center shrink-0">
                  <IconBtn icon={Pencil} title="Edit document" onClick={() => start(d)} />
                  <DeleteBtn onDelete={() => remove(d.id).catch((x) => setError(x.message))} label="this document" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editable && !form && (
        <Btn variant="subtle" icon={Plus} className="mt-3" onClick={() => start(null)}>Add document</Btn>
      )}

      {form && (
        <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 p-3 rounded-lg" style={{ border: `1px solid ${THEME.border}` }}>
          <Field label="Document" required>
            <Select required value={form.category} onChange={(e) => set('category', e.target.value)} options={cats.map((c) => ({ value: c.key, label: c.label }))} />
          </Field>
          <Field label="Title" hint="Optional — e.g. the policy name or permit area.">
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label={cat?.numbered ? 'Number' : 'Reference no.'}>
            <Input value={form.number} onChange={(e) => set('number', e.target.value)} inputMode={form.category === 'aadhaar' ? 'numeric' : undefined} />
          </Field>
          <Field label="Issued on">
            <Input type="date" value={form.issued_on} onChange={(e) => set('issued_on', e.target.value)} />
          </Field>
          {(cat?.expires || form.expires_on) && (
            <Field label="Expires on" hint="You'll be warned on the Dashboard 30 days before.">
              <Input type="date" value={form.expires_on} onChange={(e) => set('expires_on', e.target.value)} />
            </Field>
          )}
          <Field label="Notes" full>
            <TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <Field label="Scan / photo / PDF" full>
            <PhotoInput value={form.files} onChange={(v) => set('files', v)} folder={docFolder(scope)} private
              accept="image/*,application/pdf" label="Add file" max={6} camera={false} />
          </Field>
          <FormError error={error} />
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Btn type="button" variant="subtle" onClick={() => setForm(null)}>Cancel</Btn>
            <Btn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Btn>
          </div>
        </form>
      )}
      {!form && error && <div className="text-xs mt-2" style={{ color: THEME.red }}>{error}</div>}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
