import { useState } from 'react';
import { MapPin, Navigation, Loader2, Pencil, Plus, Settings2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { getPosition, mapsLink } from '../lib/geo';
import { DEFAULT_SITE_SETTINGS } from '../lib/attendance';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { moduleByKey } from '../config/modules';
import DocumentsPanel from '../components/DocumentsPanel';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, TextArea, Select, DeleteBtn,
  ExportButton, Btn, Modal, FormError, Toggle, Chip, SubHeading, IconBtn,
} from '../components/ui';

const MODULE = moduleByKey('sites');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Standing delivery-challan details a site carries, set once by Admin. */
const CHALLAN_FIELDS = [
  'client_name', 'client_address', 'client_gstin',
  'ship_to_name', 'ship_to_address', 'ship_to_gstin',
  'po_no', 'work_purpose',
];

const blankSite = {
  name: '', location: '', contact: '', lat: '', lng: '', radius_m: '200',
  ...Object.fromEntries(CHALLAN_FIELDS.map((k) => [k, ''])),
};

export default function Sites() {
  const { canEdit, canView, locks } = useAuth();
  const { siteSettings } = useAppData();
  const { rows, loading, add, update, remove } = useRecords('sites', { orderBy: 'name', ascending: true });

  const [editing, setEditing] = useState(null); // null | 'new' | site row
  const [form, setForm] = useState(blankSite);
  const [settings, setSettings] = useState(DEFAULT_SITE_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);

  const editable = canEdit('sites');
  const locked = !!locks.sites;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setS = (k, v) => setSettings((p) => ({ ...p, [k]: v }));

  function open(site) {
    setEditing(site ?? 'new');
    setForm(site ? {
      name: site.name ?? '', location: site.location ?? '', contact: site.contact ?? '',
      lat: site.lat ?? '', lng: site.lng ?? '', radius_m: String(site.radius_m ?? 200),
      ...Object.fromEntries(CHALLAN_FIELDS.map((k) => [k, site[k] ?? ''])),
    } : blankSite);
    const st = site ? siteSettings(site.id) : DEFAULT_SITE_SETTINGS;
    setSettings(st);
    setError(null);
  }

  async function capture() {
    setLocating(true);
    setError(null);
    try {
      const pos = await getPosition();
      setForm((p) => ({ ...p, lat: pos.lat, lng: pos.lng }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const row = {
      name: form.name.trim(),
      location: form.location || null,
      contact: form.contact || null,
      lat: form.lat === '' ? null : Number(form.lat),
      lng: form.lng === '' ? null : Number(form.lng),
      radius_m: Number(form.radius_m) || 200,
      ...Object.fromEntries(CHALLAN_FIELDS.map((k) => [k, form[k]?.trim() || null])),
    };
    try {
      const site = editing === 'new' ? await add(row) : await update(editing.id, row);
      const { error: err } = await supabase.from('site_settings').upsert({
        site_id: site.id,
        capture_mode: settings.capture_mode,
        require_photo: !!settings.require_photo,
        require_gps: !!settings.require_gps,
        edit_window_hours: Number(settings.edit_window_hours) || 24,
        shift_start: settings.shift_start || '09:00',
        shift_end: settings.shift_end || '18:00',
        grace_min: Number(settings.grace_min) || 0,
        half_day_hours: Number(settings.half_day_hours) || 4,
        ot_after_hours: Number(settings.ot_after_hours) || 9,
        ot_round_min: Number(settings.ot_round_min) || 30,
        weekly_off_day: settings.weekly_off_day === '' || settings.weekly_off_day === null ? null : Number(settings.weekly_off_day),
        freeze_daily: settings.freeze_daily !== false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'site_id' });
      if (err) throw new Error(friendly(err));
      setEditing(null);
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
    { key: 'lat', label: 'Latitude' },
    { key: 'lng', label: 'Longitude' },
    { key: 'radius_m', label: 'Radius (m)' },
    { key: 'mode', label: 'Attendance mode', value: (r) => siteSettings(r.id).capture_mode },
    { key: 'freeze', label: 'Freeze daily', value: (r) => (siteSettings(r.id).freeze_daily === false ? 'No' : 'Yes') },
    { key: 'client_name', label: 'Bill To' },
    { key: 'ship_to_name', label: 'Ship To' },
    { key: 'po_no', label: 'PO No.' },
    { key: 'work_purpose', label: 'Purpose For' },
    { key: 'active', label: 'Active', value: (r) => (r.active === false ? 'No' : 'Yes') },
  ];

  return (
    <div>
      <SectionHeader
        title="Sites"
        subtitle="Where work happens — location, and the attendance rules for each site"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="sites.csv" columns={exportCols} rows={rows} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      {editable && (
        <Btn accent={MODULE.accent} icon={Plus} onClick={() => open(null)} className="w-full sm:w-auto mb-5">Add Site</Btn>
      )}

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState label="No sites yet." hint="Add your first site — attendance, DPRs and requests all hang off this list." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((s) => {
            const st = siteSettings(s.id);
            return (
              <Card key={s.id} className="p-4" style={{ opacity: s.active === false ? 0.55 : 1 }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                      {s.name}
                      {s.active === false && <span className="ml-2"><Chip>CLOSED</Chip></span>}
                    </div>
                    <div className="text-xs mt-1 flex items-center gap-1" style={{ color: THEME.textDim }}>
                      <MapPin size={12} /> {s.location || 'No address'}
                    </div>
                    {s.contact && <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>{s.contact}</div>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Chip tone="blue">{st.capture_mode === 'punch' ? 'Per-worker punch' : 'Group muster'}</Chip>
                      <Chip>Shift {st.shift_start}–{st.shift_end}</Chip>
                      {s.lat != null ? (
                        <a href={mapsLink(s.lat, s.lng)} target="_blank" rel="noreferrer"><Chip tone="green">GPS · {s.radius_m} m radius</Chip></a>
                      ) : <Chip tone="amber">No GPS set</Chip>}
                      {st.require_photo && <Chip>Photo required</Chip>}
                      {st.require_gps && <Chip>GPS required</Chip>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex items-center">
                      <AuditButton table="sites" rowId={s.id} />
                      {(editable && !locked) || canView('documents') ? (
                        <IconBtn icon={editable && !locked ? Pencil : Settings2} title="Open site" onClick={() => open(s)} />
                      ) : null}
                    </div>
                    {editable && !locked && (
                      <>
                        <Btn variant="ghost" className="!px-2 !py-1 !text-xs"
                          onClick={() => update(s.id, { active: s.active === false }).catch((e) => setError(e.message))}>
                          {s.active === false ? 'Reopen' : 'Close'}
                        </Btn>
                        <DeleteBtn onDelete={() => remove(s.id).catch((e) => setError(e.message))} label="this site" />
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editable && rows.length > 0 && (
        <p className="text-xs mt-4" style={{ color: THEME.textDim }}>
          Closing a site hides it from the dropdowns but keeps all its history. Deleting a site
          removes its attendance, DPRs and requests too — close it instead unless it was a mistake.
        </p>
      )}
      {!editing && error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}

      <Modal open={!!editing} onClose={() => setEditing(null)} wide accent={MODULE.accent}
        title={editing === 'new' ? 'Add site' : editing?.name ?? ''}>
        {editing && (
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <fieldset disabled={!editable || locked} className="contents">
              <Field label="Site name" required full>
                <Input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Skyline Towers — Tower B" />
              </Field>
              <Field label="Address / area">
                <Input value={form.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <Field label="Site contact">
                <Input value={form.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Name / phone" />
              </Field>

              <div className="sm:col-span-2 p-3 rounded-lg space-y-3" style={{ background: THEME.panel2 }}>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn type="button" accent={THEME.blue} onClick={capture} disabled={locating} icon={locating ? Loader2 : Navigation}>
                    {locating ? 'Locating…' : 'Use my current location'}
                  </Btn>
                  {form.lat !== '' && form.lat !== null && (
                    <a href={mapsLink(form.lat, form.lng)} target="_blank" rel="noreferrer" className="text-xs" style={{ color: THEME.orange }}>
                      View on map
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Latitude"><Input inputMode="decimal" value={form.lat} onChange={(e) => set('lat', e.target.value)} /></Field>
                  <Field label="Longitude"><Input inputMode="decimal" value={form.lng} onChange={(e) => set('lng', e.target.value)} /></Field>
                  <Field label="Radius (m)"><Input type="number" min="25" value={form.radius_m} onChange={(e) => set('radius_m', e.target.value)} /></Field>
                </div>
                <div className="text-[11px]" style={{ color: THEME.textDim }}>
                  Stand at the site gate and tap the button. Attendance marked further than the radius away is flagged for the owner.
                </div>
              </div>

              <div className="sm:col-span-2">
                <SubHeading className="mb-2">ATTENDANCE RULES</SubHeading>
              </div>
              <Field label="How attendance is marked" full>
                <Select placeholder={null} value={settings.capture_mode} onChange={(e) => setS('capture_mode', e.target.value)}
                  options={[
                    { value: 'muster', label: 'Group muster — supervisor ticks who is in, once a day' },
                    { value: 'punch', label: 'Per-worker punch — IN and OUT tap for each worker' },
                  ]} />
              </Field>
              <Field label="Shift start"><Input type="time" value={settings.shift_start} onChange={(e) => setS('shift_start', e.target.value)} /></Field>
              <Field label="Shift end"><Input type="time" value={settings.shift_end} onChange={(e) => setS('shift_end', e.target.value)} /></Field>
              <Field label="Grace (minutes)" hint="Arriving within this is not late.">
                <Input type="number" min="0" value={settings.grace_min} onChange={(e) => setS('grace_min', e.target.value)} />
              </Field>
              <Field label="Half day below (hours)">
                <Input type="number" min="0" step="0.5" value={settings.half_day_hours} onChange={(e) => setS('half_day_hours', e.target.value)} />
              </Field>
              <Field label="Overtime after (hours)">
                <Input type="number" min="0" step="0.5" value={settings.ot_after_hours} onChange={(e) => setS('ot_after_hours', e.target.value)} />
              </Field>
              <Field label="Round overtime down to (minutes)">
                <Input type="number" min="1" value={settings.ot_round_min} onChange={(e) => setS('ot_round_min', e.target.value)} />
              </Field>
              <Field label="Edit window (hours)" hint="After this, only Verify Attendance can change an entry.">
                <Input type="number" min="1" value={settings.edit_window_hours} onChange={(e) => setS('edit_window_hours', e.target.value)} />
              </Field>
              <Field label="Weekly off">
                <Select value={settings.weekly_off_day ?? ''} placeholder="None" onChange={(e) => setS('weekly_off_day', e.target.value)}
                  options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
              </Field>
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Toggle checked={settings.require_photo} onChange={(v) => setS('require_photo', v)}
                  label="Require a photo" hint="Muster needs a group photo; a punch needs a selfie." />
                <Toggle checked={settings.require_gps} onChange={(v) => setS('require_gps', v)}
                  label="Require GPS" hint="Attendance can't be saved without a location." />
                <Toggle checked={settings.freeze_daily !== false} onChange={(v) => setS('freeze_daily', v)}
                  label="Freeze attendance at the end of each day"
                  hint="Once a day is over it closes. Only Admin, or someone with Verify Attendance, can then add or change a past day." />
              </div>

              <div className="sm:col-span-2">
                <SubHeading className="mb-1">DELIVERY CHALLAN DETAILS</SubHeading>
                <p className="text-[11px] mb-2" style={{ color: THEME.textDim }}>
                  What every challan from this site repeats. Filled in automatically when a challan is
                  raised; each challan keeps its own copy, so correcting this later never rewrites old paperwork.
                </p>
              </div>
              <Field label="Bill to — party name" full>
                <Input value={form.client_name} onChange={(e) => set('client_name', e.target.value)}
                  placeholder="e.g. Swami Vivekanand Health Mission Society" />
              </Field>
              <Field label="Bill to — address" full>
                <TextArea rows={2} value={form.client_address} onChange={(e) => set('client_address', e.target.value)} />
              </Field>
              <Field label="Bill to — GSTIN">
                <Input value={form.client_gstin} onChange={(e) => set('client_gstin', e.target.value.toUpperCase())}
                  placeholder="e.g. 09GTDPS9124P1ZP" />
              </Field>
              <Field label="Purpose for" hint="e.g. FIRE FIGHTING WORK">
                <Input value={form.work_purpose} onChange={(e) => set('work_purpose', e.target.value)} />
              </Field>
              <Field label="Ship to — name / place of supply" full>
                <Input value={form.ship_to_name} onChange={(e) => set('ship_to_name', e.target.value)}
                  placeholder="e.g. Keshav Madhav Chikisalaya" />
              </Field>
              <Field label="Ship to — delivery address" full>
                <TextArea rows={2} value={form.ship_to_address} onChange={(e) => set('ship_to_address', e.target.value)} />
              </Field>
              <Field label="Ship to — GSTIN" hint="Leave blank if there isn't one — the challan prints “N.A”.">
                <Input value={form.ship_to_gstin} onChange={(e) => set('ship_to_gstin', e.target.value.toUpperCase())} />
              </Field>
              <Field label="PO no." hint="The client's purchase order for this site, if there is one.">
                <Input value={form.po_no} onChange={(e) => set('po_no', e.target.value)} />
              </Field>
            </fieldset>

            <FormError error={error} />
            {editable && !locked && (
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Btn type="button" variant="subtle" onClick={() => setEditing(null)}>Cancel</Btn>
                <Btn type="submit" accent={MODULE.accent} disabled={saving}>{saving ? 'Saving…' : 'Save site'}</Btn>
              </div>
            )}

            {editing !== 'new' && canView('documents') && (
              <div className="sm:col-span-2">
                <SubHeading className="mt-2 mb-2">SITE DOCUMENTS</SubHeading>
                <DocumentsPanel scope="site" scopeId={editing.id} compact />
              </div>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
