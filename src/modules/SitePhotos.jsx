import { useMemo, useState } from 'react';
import { THEME } from '../lib/theme';
import { today, fmtDate } from '../lib/format';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, TextArea,
  SiteSelect, PhotoInput, Lightbox, DeleteBtn, ExportButton, FormShell,
} from '../components/ui';

const MODULE = moduleByKey('site_photos');

export default function SitePhotos() {
  const { activeSites, siteName, siteFilter } = useAppData();
  const { canEdit, locks, profile } = useAuth();
  const { rows, loading, add, remove } = useRecords('site_photos', { orderBy: 'date' });

  const blank = {
    date: today(), site_id: siteFilter || '', area: '', caption: '',
    uploaded_by: profile?.name ?? '', photos: [],
  };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const editable = canEdit('site_photos');
  const locked = !!locks.site_photos;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const visible = useMemo(
    () => (siteFilter ? rows.filter((r) => r.site_id === siteFilter) : rows),
    [rows, siteFilter]
  );

  async function submit(e) {
    e.preventDefault();
    if (!form.site_id) { setError('Choose the site.'); return; }
    if (!form.photos.length) { setError('Add at least one photo.'); return; }
    setSaving(true);
    setError(null);
    try {
      await add({ ...form, area: form.area || null, caption: form.caption || null });
      setForm({ ...blank, site_id: form.site_id });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const exportCols = [
    { key: 'date', label: 'Date' },
    { key: 'site_id', label: 'Site', value: (r) => siteName(r.site_id) },
    { key: 'area', label: 'Area' },
    { key: 'caption', label: 'Caption' },
    { key: 'uploaded_by', label: 'Uploaded By' },
    { key: 'photos', label: 'Photo Links', value: (r) => (r.photos ?? []).join(' | ') },
  ];

  return (
    <div>
      <SectionHeader
        title="Work Photos"
        subtitle="Daily progress photos, filed by site and area"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="work_photos.csv" columns={exportCols} rows={visible} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="Add Photos"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Site" required>
          <SiteSelect sites={activeSites} required value={form.site_id} onChange={(e) => set('site_id', e.target.value)} />
        </Field>
        <Field label="Area / work location">
          <Input value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="e.g. 4th floor riser shaft" />
        </Field>
        <Field label="Uploaded by">
          <Input value={form.uploaded_by} onChange={(e) => set('uploaded_by', e.target.value)} />
        </Field>
        <Field label="Photos" required full>
          <PhotoInput value={form.photos} onChange={(v) => set('photos', v)} folder="site_photos" max={8} />
        </Field>
        <Field label="Caption / notes" full>
          <TextArea rows={2} value={form.caption} onChange={(e) => set('caption', e.target.value)} placeholder="What does this show?" />
        </Field>
      </FormShell>

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Card><EmptyState label="No photos uploaded yet." /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((r) => {
            const photos = r.photos ?? [];
            return (
              <Card key={r.id} className="overflow-hidden">
                <div className="grid grid-cols-2 gap-0.5">
                  {photos.slice(0, 4).map((p) => (
                    <img
                      key={p}
                      src={p}
                      alt=""
                      onClick={() => setLightbox(p)}
                      className="cursor-pointer object-cover w-full"
                      style={{ height: 96, gridColumn: photos.length === 1 ? 'span 2' : undefined }}
                    />
                  ))}
                </div>
                <div className="p-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="font-semibold text-sm min-w-0 truncate" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                      {siteName(r.site_id)}
                    </div>
                    {editable && !locked && <DeleteBtn onDelete={() => remove(r.id).catch((x) => setError(x.message))} />}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                    {fmtDate(r.date)}{r.area ? ` · ${r.area}` : ''}
                    {photos.length > 4 && ` · ${photos.length} photos`}
                  </div>
                  {r.caption && <div className="text-xs mt-1.5">{r.caption}</div>}
                  {r.uploaded_by && (
                    <div className="text-[11px] mt-1.5" style={{ color: THEME.textDim }}>by {r.uploaded_by}</div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}
