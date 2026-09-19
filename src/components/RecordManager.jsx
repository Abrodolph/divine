import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { useRecords } from '../hooks/useRecords';
import { fmtDate, today } from '../lib/format';
import { THEME } from '../lib/theme';
import {
  SectionHeader, LockBanner, EmptyState, Loading, TableWrap, Th, Td, LoadMore,
  StatusBadge, PhotoStrip, Lightbox, DeleteBtn, ExportButton, FormShell, FormError,
  Field, Input, TextArea, Select, SiteSelect, PhotoInput, Modal, Btn, IconBtn, Toggle,
} from './ui';

/**
 * Config-driven screen for the modules that are plain "log a record" lists.
 * Anything with its own workflow (attendance, procurement, payroll) gets a
 * bespoke component instead.
 *
 * fields:  [{ key, label, type, options?, required?, full?, default?, hint?, placeholder?, min?, step?,
 *            visible?(form), onChange?(value, form) }]
 *          type: text | number | date | tel | email | textarea | select | combo | site | photos | tags | checkbox
 *          type/options/required/placeholder/hint/min may also be functions of
 *          the form, for fields that depend on another answer. A hidden field
 *          is skipped by validation and saved as null. select options may be
 *          grouped: [{ group, options: [...] }]. onChange returns extra form
 *          values to set alongside (e.g. clear the size when the item changes).
 *          tags edits a text[] column as comma-separated text.
 * columns: [{ key, label, type?, value?(row) }]  type: date | site | status | photos | tags | bool
 * toRow/fromRow: optional hooks to map the cleaned form to a row, and a row
 *          back to the edit form.
 * filterField: column the global site filter applies to (null = none). The
 *          filter is applied in the database query, not after loading.
 */
export default function RecordManager({
  module, table, title, subtitle, fields, columns, filterField = 'site_id', toRow, fromRow, orderBy, ascending,
}) {
  const { activeSites, siteName, siteFilter } = useAppData();
  const { canEdit, canChangeRow, locks } = useAuth();
  const hasDate = fields.some((f) => f.key === 'date');
  const { rows, loading, error: loadError, add, update, remove, hasMore, loadMore } = useRecords(table, {
    orderBy: orderBy ?? (hasDate ? 'date' : 'created_at'),
    ascending: ascending ?? false,
    filters: filterField ? [[filterField, 'eq', siteFilter]] : [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => blank(fields));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  const editable = canEdit(module.key);
  const locked = !!locks[module.key];

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await add(clean(form, fields, toRow));
      setForm(blank(fields));
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function del(id) {
    try {
      await remove(id);
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(record) {
    setEditingId(record.id);
    setEditForm(fromRecord(record, fields, fromRow));
    setEditError(null);
  }

  async function submitEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    setEditError(null);
    try {
      await update(editingId, clean(editForm, fields, toRow));
      setEditingId(null);
      setEditForm(null);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  }

  const exportCols = columns.map((c) => ({
    key: c.key,
    label: c.label,
    value: (r) =>
      c.value ? c.value(r)
      : c.type === 'site' ? siteName(r[c.key])
      : c.type === 'photos' || c.type === 'tags' ? (r[c.key]?.length ? r[c.key].join(' | ') : '')
      : c.type === 'bool' ? (r[c.key] === false ? 'No' : 'Yes')
      : r[c.key] ?? '',
  }));

  return (
    <div>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        icon={module.icon}
        accent={module.accent}
        action={<ExportButton filename={`${table}.csv`} columns={exportCols} rows={rows} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={module.accent}
        label={`New ${title}`}
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <FormFields fields={fields} form={form} setForm={setForm} sites={activeSites} table={table} />
      </FormShell>

      {loadError && <div className="text-xs mb-3" style={{ color: THEME.red }}>{loadError}</div>}
      {!open && error && <div className="text-xs mb-3" style={{ color: THEME.red }}>{error}</div>}

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <TableWrap>
          <tbody>
            <tr>
              <td>
                <EmptyState
                  label="Nothing logged here yet."
                  hint={editable ? `Tap "New ${title}" to add the first record.` : undefined}
                />
              </td>
            </tr>
          </tbody>
        </TableWrap>
      ) : (
        <>
          {/* Phone: stacked cards. Desktop: table. */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="p-4 rounded-xl" style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                      {cardTitle(r, columns)}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                      {[r.date ? fmtDate(r.date) : null, r.site_id ? siteName(r.site_id) : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {editable && !locked && canChangeRow(r) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <IconBtn icon={Pencil} title="Edit" onClick={() => startEdit(r)} />
                      <DeleteBtn onDelete={() => del(r.id)} />
                    </div>
                  )}
                </div>
                <dl className="mt-3 space-y-1.5 text-xs">
                  {columns.slice(1).map((c) => (
                    <div key={c.key} className="flex gap-2">
                      <dt className="shrink-0" style={{ color: THEME.textDim, minWidth: 92 }}>{c.label}</dt>
                      <dd className="min-w-0" style={{ color: THEME.text }}>
                        <Cell row={r} col={c} siteName={siteName} onOpenPhoto={setLightbox} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr style={{ background: THEME.panel2 }}>
                  {columns.map((c) => <Th key={c.key}>{c.label}</Th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: THEME.border }}>
                    {columns.map((c) => (
                      <Td key={c.key}>
                        <Cell row={r} col={c} siteName={siteName} onOpenPhoto={setLightbox} />
                      </Td>
                    ))}
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {editable && !locked && canChangeRow(r) && (
                          <>
                            <IconBtn icon={Pencil} title="Edit" onClick={() => startEdit(r)} />
                            <DeleteBtn onDelete={() => del(r.id)} />
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
          <LoadMore hasMore={hasMore} onClick={loadMore} />
        </>
      )}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />

      <Modal open={!!editingId} onClose={() => setEditingId(null)} title={`Edit ${title}`} accent={module.accent}>
        {editForm && (
          <form onSubmit={submitEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <FormFields fields={fields} form={editForm} setForm={setEditForm} sites={activeSites} table={table} />
            <FormError error={editError} />
            <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
              <Btn type="button" variant="subtle" onClick={() => setEditingId(null)}>Cancel</Btn>
              <Btn type="submit" accent={module.accent} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</Btn>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------- helpers --------------------------------- */

const DYNAMIC_PROPS = ['type', 'options', 'required', 'placeholder', 'hint', 'min'];

function cardTitle(r, columns) {
  const textCol = columns.find((c) => !c.type || c.type === 'status');
  const v = textCol ? r[textCol.key] : null;
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

/**
 * The field with any form-dependent props evaluated against the current form.
 * `ctx` carries shared app data (e.g. the Admin-maintained item categories) so
 * a field can offer a list that lives in the database, not in the config.
 */
function resolve(field, form, ctx) {
  const f = { ...field, hidden: field.visible ? !field.visible(form) : false };
  DYNAMIC_PROPS.forEach((p) => {
    if (typeof field[p] === 'function') f[p] = field[p](form, ctx);
  });
  return f;
}

function FormFields({ fields, form, setForm, sites, table }) {
  const ctx = useAppData();
  return fields.map((raw) => {
    const f = resolve(raw, form, ctx);
    if (f.hidden) return null;
    if (f.type === 'checkbox') {
      return (
        <div key={f.key} className={f.full ? 'md:col-span-2 sm:col-span-2' : ''}>
          <Toggle checked={form[f.key]} label={f.label} hint={f.hint}
            onChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))} />
        </div>
      );
    }
    return (
      <Field key={f.key} label={f.label} required={f.required} full={f.full || f.type === 'photos'} hint={f.hint}>
        <FieldControl field={f} value={form[f.key]} sites={sites} table={table}
          onChange={(v) => setForm((p) => ({ ...p, [f.key]: v, ...(raw.onChange?.(v, p) ?? {}) }))} />
      </Field>
    );
  });
}

function Cell({ row, col, siteName, onOpenPhoto }) {
  const v = row[col.key];
  if (col.value) return col.value(row) ?? '—';
  if (col.type === 'site') return siteName(v);
  if (col.type === 'status') return <StatusBadge value={v} />;
  if (col.type === 'date') return fmtDate(v);
  if (col.type === 'photos') return <PhotoStrip photos={v || []} onOpen={onOpenPhoto} />;
  if (col.type === 'tags') return v?.length ? v.join(', ') : '—';
  if (col.type === 'bool') return v === false ? 'No' : 'Yes';
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function FieldControl({ field, value, onChange, sites, table }) {
  const v = value ?? '';
  switch (field.type) {
    case 'textarea':
      return <TextArea value={v} required={field.required} placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <Select value={v} required={field.required} options={field.options} placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}>
          {field.options?.some((o) => o?.group)
            ? field.options.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (typeof o === 'string'
                  ? <option key={o} value={o}>{o}</option>
                  : <option key={o.value} value={o.value}>{o.label}</option>))}
              </optgroup>
            ))
            : undefined}
        </Select>
      );
    case 'combo':
      return (
        <>
          <Input list={`${field.key}-list`} value={v} required={field.required} placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)} />
          <datalist id={`${field.key}-list`}>
            {field.options.map((o) => <option key={o} value={o} />)}
          </datalist>
        </>
      );
    case 'site':
      return <SiteSelect sites={sites} value={v} required={field.required}
        onChange={(e) => onChange(e.target.value)} />;
    case 'photos':
      return <PhotoInput value={value || []} onChange={onChange} folder={table} max={field.max ?? 6}
        accept={field.accept ?? 'image/*'} label={field.accept?.includes('pdf') ? 'Add photo / PDF' : undefined} />;
    default:
      return <Input type={field.type === 'tags' ? 'text' : field.type || 'text'} value={v} required={field.required}
        min={field.min} step={field.step} inputMode={field.type === 'number' ? 'decimal' : undefined}
        placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

function blank(fields) {
  const o = {};
  fields.forEach((f) => {
    o[f.key] = f.default !== undefined
      ? (typeof f.default === 'function' ? f.default() : f.default)
      : f.type === 'photos' ? []
      : f.type === 'checkbox' ? false
      : f.type === 'date' && f.key === 'date' ? today()
      : '';
  });
  return o;
}

/** Seeds the edit form from an existing row (mirrors blank()'s field shape). */
function fromRecord(record, fields, fromRow) {
  const o = {};
  fields.forEach((f) => {
    const v = record[f.key];
    o[f.key] = f.type === 'photos' ? (v || [])
      : f.type === 'tags' ? (v ?? []).join(', ')
      : f.type === 'checkbox' ? v !== false
      : (v ?? '');
  });
  return fromRow ? fromRow(o, record) : o;
}

/**
 * Postgres rejects '' for numeric/date/uuid columns — send null instead.
 * Hidden fields are saved as null so a stale value can't linger.
 */
function clean(form, fields, toRow) {
  const out = {};
  fields.forEach((raw) => {
    const f = resolve(raw, form);
    const v = form[f.key];
    if (f.type === 'photos') out[f.key] = v || [];
    else if (f.type === 'tags') out[f.key] = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (f.type === 'checkbox') out[f.key] = !!v;
    else if (f.hidden || v === '' || v === undefined) out[f.key] = null;
    else if (f.type === 'number') out[f.key] = Number(v);
    else out[f.key] = v;
  });
  return toRow ? toRow(out, form) : out;
}
