import { useMemo, useState } from 'react';
import { MapPin, Navigation, Loader2, Check, Users2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { today, fmtDate } from '../lib/format';
import { getPosition, mapsLink } from '../lib/geo';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field,
  Input, TextArea, SiteSelect, PhotoInput, Lightbox, DeleteBtn,
  ExportButton, FormShell, Banner,
} from '../components/ui';

const MODULE = moduleByKey('attendance');

/**
 * Daily muster: one entry per site per day.
 * The site in-charge ticks who turned up, snaps one group photo, and captures
 * GPS — a single submission instead of a punch per worker. Payroll counts a
 * day present for every employee ticked in that entry.
 */
export default function Attendance() {
  const { activeSites, activeEmployees, sites, siteName, siteFilter } = useAppData();
  const { canEdit, locks, profile } = useAuth();
  const { rows, loading, add, remove } = useRecords('attendance', { orderBy: 'date' });

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const blank = {
    date: today(),
    site_id: siteFilter || '',
    present_ids: [],
    visitors: '',
    group_photo: [],
    lat: null, lng: null, accuracy_m: null,
    marked_by: profile?.name ?? '',
    note: '',
  };
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const editable = canEdit('attendance');
  const locked = !!locks.attendance;

  // Only offer workers attached to the chosen site (plus anyone unassigned).
  const roster = useMemo(() => {
    if (!form.site_id) return activeEmployees;
    return activeEmployees.filter((e) => !e.site_id || e.site_id === form.site_id);
  }, [activeEmployees, form.site_id]);

  const visible = useMemo(
    () => (siteFilter ? rows.filter((r) => r.site_id === siteFilter) : rows),
    [rows, siteFilter]
  );

  function toggleWorker(id) {
    setForm((p) => ({
      ...p,
      present_ids: p.present_ids.includes(id)
        ? p.present_ids.filter((x) => x !== id)
        : [...p.present_ids, id],
    }));
  }

  async function grabLocation() {
    setLocating(true);
    setError(null);
    try {
      const pos = await getPosition();
      setForm((p) => ({ ...p, ...pos }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.site_id) { setError('Choose the site first.'); return; }
    if (!form.present_ids.length && !form.visitors.trim()) {
      setError('Tick at least one worker, or note the extra hands in the visitors box.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await add({
        date: form.date,
        site_id: form.site_id,
        present_ids: form.present_ids,
        visitors: form.visitors || null,
        group_photo: form.group_photo[0] ?? null,
        lat: form.lat, lng: form.lng, accuracy_m: form.accuracy_m,
        marked_by: form.marked_by || null,
        note: form.note || null,
      });
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
    { key: 'count', label: 'Workers Present', value: (r) => r.present_ids?.length ?? 0 },
    { key: 'names', label: 'Names', value: (r) => namesOf(r, activeEmployees) },
    { key: 'visitors', label: 'Extra / Visitors' },
    { key: 'lat', label: 'Latitude' },
    { key: 'lng', label: 'Longitude' },
    { key: 'marked_by', label: 'Marked By' },
    { key: 'note', label: 'Note' },
  ];

  return (
    <div>
      <SectionHeader
        title="Attendance"
        subtitle="One muster per site per day — tick who's in, snap the group, capture GPS"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="attendance.csv" columns={exportCols} rows={visible} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      {editable && activeEmployees.length === 0 && (
        <Banner tone="amber">
          No workers in the system yet. Add them under <b>Team</b> first, then you can tick them off here.
        </Banner>
      )}

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="Mark Today's Attendance"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <Field label="Date" required>
          <Input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Site" required>
          <SiteSelect sites={activeSites} required value={form.site_id} onChange={(e) => set('site_id', e.target.value)} />
        </Field>

        {/* worker tick list */}
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-wide block mb-2" style={{ color: THEME.textDim }}>
            Who is present today
            <span className="ml-2 font-semibold" style={{ color: MODULE.accent }}>
              {form.present_ids.length} selected
            </span>
          </label>

          {roster.length === 0 ? (
            <div className="text-xs px-3 py-3 rounded-lg" style={{ color: THEME.textDim, background: THEME.panel2 }}>
              No workers listed for this site yet.
            </div>
          ) : (
            <>
              <div className="flex gap-2 mb-2">
                <button type="button" className="text-xs font-semibold" style={{ color: MODULE.accent }}
                  onClick={() => set('present_ids', roster.map((r) => r.id))}>
                  Select all
                </button>
                <span style={{ color: THEME.textDim }}>·</span>
                <button type="button" className="text-xs" style={{ color: THEME.textDim }}
                  onClick={() => set('present_ids', [])}>
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {roster.map((emp) => {
                  const on = form.present_ids.includes(emp.id);
                  return (
                    <button
                      type="button"
                      key={emp.id}
                      onClick={() => toggleWorker(emp.id)}
                      className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm text-left"
                      style={{
                        background: on ? 'rgba(255,106,19,0.12)' : THEME.panel2,
                        border: `1px solid ${on ? MODULE.accent : THEME.border}`,
                        color: THEME.text,
                      }}
                    >
                      <span
                        className="flex items-center justify-center rounded shrink-0"
                        style={{
                          width: 20, height: 20,
                          background: on ? MODULE.accent : 'transparent',
                          border: `1px solid ${on ? MODULE.accent : THEME.border}`,
                        }}
                      >
                        {on && <Check size={13} color="#111" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{emp.name}</span>
                        {emp.trade && (
                          <span className="block text-[11px]" style={{ color: THEME.textDim }}>{emp.trade}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <Field label="Extra hands / visitors" full hint="Anyone not on the Team list — write their names here.">
          <Input value={form.visitors} onChange={(e) => set('visitors', e.target.value)} placeholder="e.g. 2 helpers from Salim contractor" />
        </Field>

        <Field label="Group photo" full hint="One photo of everyone present, taken at site.">
          <PhotoInput value={form.group_photo} onChange={(v) => set('group_photo', v)} folder="attendance" max={1} label="Group photo" />
        </Field>

        <div className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg" style={{ background: THEME.panel2 }}>
            <Btn type="button" accent={THEME.blue} onClick={grabLocation} disabled={locating}
              icon={locating ? Loader2 : Navigation}>
              {locating ? 'Locating…' : form.lat ? 'Update location' : 'Capture location'}
            </Btn>
            {form.lat != null && (
              <span className="text-xs" style={{ color: THEME.textDim }}>
                📍 {form.lat}, {form.lng}
                {form.accuracy_m ? ` (±${form.accuracy_m}m)` : ''} —{' '}
                <a href={mapsLink(form.lat, form.lng)} target="_blank" rel="noreferrer" style={{ color: THEME.orange }}>
                  view on map
                </a>
              </span>
            )}
          </div>
        </div>

        <Field label="Marked by">
          <Input value={form.marked_by} onChange={(e) => set('marked_by', e.target.value)} />
        </Field>
        <Field label="Note">
          <TextArea rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Half day, early close, etc." />
        </Field>
      </FormShell>

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Card><EmptyState label="No attendance marked yet." hint={editable ? 'Tap the button above to mark today.' : undefined} /></Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  {r.group_photo ? (
                    <img
                      src={r.group_photo}
                      alt="Muster"
                      onClick={() => setLightbox(r.group_photo)}
                      className="rounded-lg object-cover cursor-pointer shrink-0"
                      style={{ height: 64, width: 64 }}
                    />
                  ) : (
                    <div
                      className="rounded-lg flex items-center justify-center shrink-0"
                      style={{ height: 64, width: 64, background: THEME.panel2, color: THEME.textDim }}
                    >
                      <Users2 size={22} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                      {siteName(r.site_id)}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                      {fmtDate(r.date)} · marked by {r.marked_by || '—'}
                    </div>
                    <div className="text-sm mt-1.5">
                      <span className="font-semibold" style={{ color: MODULE.accent }}>
                        {r.present_ids?.length ?? 0}
                      </span>{' '}
                      <span style={{ color: THEME.textDim }}>present</span>
                      {r.lat != null && (
                        <a
                          href={mapsLink(r.lat, r.lng)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-3 inline-flex items-center gap-1 text-xs"
                          style={{ color: THEME.orange }}
                        >
                          <MapPin size={12} /> location
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                {editable && !locked && <DeleteBtn onDelete={() => remove(r.id).catch((e) => setError(e.message))} />}
              </div>

              <div className="text-xs mt-3 leading-relaxed" style={{ color: THEME.text }}>
                {namesOf(r, activeEmployees) || <span style={{ color: THEME.textDim }}>No named workers</span>}
                {r.visitors && (
                  <span style={{ color: THEME.textDim }}> · plus {r.visitors}</span>
                )}
              </div>
              {r.note && <div className="text-xs mt-1.5" style={{ color: THEME.textDim }}>{r.note}</div>}
            </Card>
          ))}
        </div>
      )}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function namesOf(record, employees) {
  return (record.present_ids ?? [])
    .map((id) => employees.find((e) => e.id === id)?.name)
    .filter(Boolean)
    .join(', ');
}
