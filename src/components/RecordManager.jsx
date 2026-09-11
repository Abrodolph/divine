import { useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { useRecords } from '../hooks/useRecords';
import { fmtDate, today } from '../lib/format';
import { THEME } from '../lib/theme';
import {
  SectionHeader, LockBanner, EmptyState, Loading, TableWrap, Th, Td,
  StatusBadge, PhotoStrip, Lightbox, DeleteBtn, ExportButton, FormShell,
  Field, Input, TextArea, Select, SiteSelect, PhotoInput,
} from './ui';

/**
 * Config-driven screen for the modules that are plain "log a record" lists.
 * Anything with its own workflow (attendance muster, delivery challans,
 * payroll) gets a bespoke component instead.
 *
 * fields:  [{ key, label, type, options?, required?, full?, default?, hint? }]
 *          type: text | number | date | textarea | select | combo | site | photos
 * columns: [{ key, label, type? }]  type: date | site | status | photos
 */
export default function RecordManager({ module, table, title, subtitle, fields, columns, filterField = 'site_id' }) {
  const { sites, activeSites, siteName, siteFilter } = useAppData();
  const { canEdit, locks } = useAuth();
  const { rows, loading, error: loadError, add, remove } = useRecords(table, {
    orderBy: fields.some((f) => f.key === 'date') ? 'date' : 'created_at',
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => blank(fields));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const editable = canEdit(module);
  const locked = !!locks[module];
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const visible = useMemo(
    () => (siteFilter && filterField ? rows.filter((r) => r[filterField] === siteFilter) : rows),
    [rows, siteFilter, filterField]
  );

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await add(clean(form, fields));
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

  const exportCols = columns.map((c) => ({
    key: c.key,
    label: c.label,
    value: (r) =>
      c.type === 'site' ? siteName(r[c.key])
      : c.type === 'photos' ? (r[c.key]?.length ? r[c.key].join(' | ') : '')
      : r[c.key] ?? '',
  }));

  return (
    <div>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        icon={module.icon}
        accent={module.accent}
        action={<ExportButton filename={`${table}.csv`} columns={exportCols} rows={visible} />}
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
        {fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} full={f.full || f.type === 'photos'} hint={f.hint}>
            <FieldControl field={f} value={form[f.key]} onChange={(v) => set(f.key, v)} sites={activeSites} table={table} />
          </Field>
        ))}
      </FormShell>

      {loadError && <div className="text-xs mb-3" style={{ color: THEME.red }}>{loadError}</div>}

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
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
            {visible.map((r) => (
              <div key={r.id} className="p-4 rounded-xl" style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                      {r[columns[2]?.key] || r[columns[1]?.key] || '—'}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                      {fmtDate(r.date)} · {siteName(r.site_id)}
                    </div>
                  </div>
                  {editable && !locked && <DeleteBtn onDelete={() => del(r.id)} />}
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
                {visible.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: THEME.border }}>
                    {columns.map((c) => (
                      <Td key={c.key}>
                        <Cell row={r} col={c} siteName={siteName} onOpenPhoto={setLightbox} />
                      </Td>
                    ))}
                    <Td>
                      <div className="text-right">
                        {editable && !locked && <DeleteBtn onDelete={() => del(r.id)} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/* ------------------------------- helpers --------------------------------- */

function Cell({ row, col, siteName, onOpenPhoto }) {
  const v = row[col.key];
  if (col.type === 'site') return siteName(v);
  if (col.type === 'status') return <StatusBadge value={v} />;
  if (col.type === 'date') return fmtDate(v);
  if (col.type === 'photos') return <PhotoStrip photos={v || []} onOpen={onOpenPhoto} />;
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function FieldControl({ field, value, onChange, sites, table }) {
  const v = value ?? '';
  switch (field.type) {
    case 'textarea':
      return <TextArea value={v} required={field.required} placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return <Select value={v} required={field.required} options={field.options}
        onChange={(e) => onChange(e.target.value)} />;
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
      return <PhotoInput value={value || []} onChange={onChange} folder={table} max={field.max ?? 6} />;
    default:
      return <Input type={field.type || 'text'} value={v} required={field.required}
        placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

function blank(fields) {
  const o = {};
  fields.forEach((f) => {
    o[f.key] = f.default !== undefined
      ? (typeof f.default === 'function' ? f.default() : f.default)
      : f.type === 'photos' ? []
      : f.type === 'date' && f.key === 'date' ? today()
      : '';
  });
  return o;
}

/** Postgres rejects '' for numeric/date/uuid columns — send null instead. */
function clean(form, fields) {
  const out = {};
  fields.forEach((f) => {
    const v = form[f.key];
    if (f.type === 'photos') out[f.key] = v || [];
    else if (v === '' || v === undefined) out[f.key] = null;
    else if (f.type === 'number') out[f.key] = Number(v);
    else out[f.key] = v;
  });
  return out;
}
