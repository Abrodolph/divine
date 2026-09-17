import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigation, Loader2, Check, Camera, LogIn, LogOut, Pencil, CalendarX2, MapPin, Users2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { today, fmtDate, fmtTime, fmtDateTime } from '../lib/format';
import { addDays } from '../lib/dates';
import { getPosition, mapsLink, distanceM, fmtDistance } from '../lib/geo';
import { uploadPhoto } from '../lib/upload';
import {
  classifyEntry, inEditWindow, FLAG_LABEL, STATUS_LABEL, STATUS_CODE, STATUSES,
} from '../lib/attendance';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { AuditButton } from '../components/AuditTrail';
import LiveCamera from '../components/LiveCamera';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, TextArea, Select, SiteSelect,
  Lightbox, Banner, Chip, Modal, FormError, StoredImage, Toggle, DeleteBtn, SubHeading, ToolbarInput, IconBtn,
} from '../components/ui';

const MODULE = moduleByKey('attendance');
const CODE_TONE = { P: 'green', H: 'amber', A: 'red', L: 'blue', HOL: 'dim', WO: 'dim' };
const FLAG_TONE = { outside_radius: 'red', duplicate_day: 'red', edited_late: 'amber', backdated: 'amber', early_mark: 'amber', rejected: 'red' };

/**
 * Attendance, one row per worker per day. Each site picks how it's marked
 * (Sites → attendance rules):
 *   muster  the supervisor ticks who's in once a day, with one group photo
 *           and GPS — saved atomically by submit_muster()
 *   punch   an IN and an OUT tap per worker, timed by the server, optional
 *           selfie — punch(); "Close day" records everyone else as absent
 * The database derives half days, OT, late minutes and flags; this screen
 * previews the same rules (src/lib/attendance.js).
 */
export default function Attendance() {
  const { activeSites, activeEmployees, employees, siteFilter, siteSettings, sites } = useAppData();
  const { canEdit, locks } = useAuth();
  const [siteId, setSiteId] = useState(siteFilter || '');
  const [date, setDate] = useState(today());
  const [editEntry, setEditEntry] = useState(null);

  useEffect(() => {
    if (!siteId && activeSites.length) setSiteId(activeSites[0].id);
  }, [activeSites, siteId]);

  const site = sites.find((s) => s.id === siteId) ?? null;
  const settings = siteSettings(siteId);
  const editable = canEdit('attendance');
  const verifier = canEdit('attendance_verify');
  const locked = !!locks.attendance;

  const dayFilters = [['site_id', 'eq', siteId], ['date', 'eq', date]];
  const { rows: entries, loading, reload: reloadEntries } = useRecords('attendance_entries', {
    filters: dayFilters, enabled: !!siteId, orderBy: 'marked_at', ascending: true, pageSize: 1000,
  });
  const { rows: musters, reload: reloadMusters } = useRecords('musters', { filters: dayFilters, enabled: !!siteId });
  const muster = musters[0] ?? null;

  // Workers assigned here, anyone unassigned, and anyone already marked here today.
  const roster = useMemo(() => {
    const list = activeEmployees.filter((e) => !e.site_id || e.site_id === siteId);
    entries.forEach((en) => {
      if (!list.some((e) => e.id === en.employee_id)) {
        const emp = employees.find((e) => e.id === en.employee_id);
        if (emp) list.push(emp);
      }
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeEmployees, employees, entries, siteId]);

  const reload = () => { reloadEntries(); reloadMusters(); };

  return (
    <div>
      <SectionHeader
        title="Attendance"
        subtitle={settings.capture_mode === 'punch' ? 'Tap IN and OUT for each worker — times come from the server' : 'Tick who is in, snap the group, capture GPS'}
        icon={MODULE.icon}
        accent={MODULE.accent}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 sm:flex-none">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>Site</label>
          <SiteSelect sites={activeSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </div>
        <ToolbarInput label="Date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
        {site && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Chip tone="blue">{settings.capture_mode === 'punch' ? 'Punch mode' : 'Muster mode'}</Chip>
            <Chip>Shift {settings.shift_start}–{settings.shift_end} · {settings.grace_min} min grace</Chip>
            {settings.require_photo && <Chip tone="amber">Photo required</Chip>}
            {settings.require_gps && <Chip tone="amber">GPS required</Chip>}
            {site.lat == null && <Chip tone="red">Site GPS not set</Chip>}
          </div>
        )}
      </Card>

      {editable && activeEmployees.length === 0 && (
        <Banner tone="amber">No workers yet. Add them under <b>Team</b> first.</Banner>
      )}

      {!siteId ? (
        <Card><EmptyState label="Add a site first, under Sites." /></Card>
      ) : loading ? (
        <Loading />
      ) : settings.capture_mode === 'punch' ? (
        <PunchPanel site={site} settings={settings} date={date} roster={roster} entries={entries}
          editable={editable && !locked} onOpen={setEditEntry} onChanged={reload} />
      ) : (
        <MusterPanel site={site} settings={settings} date={date} roster={roster} entries={entries} muster={muster}
          editable={editable && !locked} verifier={verifier} onOpen={setEditEntry} onChanged={reload} />
      )}

      {siteId && <RecentDays siteId={siteId} activeDate={date} onPick={setDate} />}

      <EntryModal entry={editEntry} settings={settings} editable={editable && !locked} verifier={verifier}
        onClose={() => setEditEntry(null)} onChanged={() => { setEditEntry(null); reload(); }} />
    </div>
  );
}

/* ------------------------------ muster mode ------------------------------ */

function MusterPanel({ site, settings, date, roster, entries, muster, editable, verifier, onOpen, onChanged }) {
  const { profile, canChangeRow } = useAuth();
  const { empName } = useAppData();
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState({});
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [camera, setCamera] = useState(false);

  const inWindow = !muster || inEditWindow(muster.marked_at, settings) || verifier;
  const adminsMuster = !!muster && !canChangeRow(muster, ['attendance_verify']);

  function start() {
    const t = {};
    entries.forEach((e) => {
      if (['present', 'half', 'leave'].includes(e.status)) {
        t[e.employee_id] = { status: e.status, in_time: fmtTime(e.in_time) === '—' ? settings.shift_start : fmtTime(e.in_time), out_time: e.out_time ? fmtTime(e.out_time) : '' };
      }
    });
    setTicks(t);
    setForm({
      group_photo: [],   // a fresh muster photo is taken every time, never reused
      photo_live: false,
      lat: muster?.lat ?? null, lng: muster?.lng ?? null, accuracy_m: muster?.accuracy_m ?? null,
      visitors: muster?.visitors ?? '', note: muster?.note ?? '',
      marked_by_name: muster?.marked_by_name ?? profile?.name ?? '',
      markRestAbsent: true,
    });
    setError(null);
    setOpen(true);
  }

  const toggle = (id) => setTicks((t) => {
    const next = { ...t };
    if (next[id]) delete next[id];
    else next[id] = { status: 'present', in_time: settings.shift_start, out_time: '' };
    return next;
  });
  const setTick = (id, k, v) => setTicks((t) => ({ ...t, [id]: { ...t[id], [k]: v } }));

  async function locate() {
    setLocating(true);
    setError(null);
    try {
      const pos = await getPosition();
      setForm((f) => ({ ...f, ...pos }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  }

  const distance = site ? distanceM(form.lat, form.lng, site.lat, site.lng) : null;

  async function submit(e) {
    e.preventDefault();
    const ticked = Object.keys(ticks);
    if (!ticked.length && !form.visitors.trim()) { setError('Tick at least one worker, or write the extra hands in the box.'); return; }
    if (!form.group_photo.length) { setError('Take the crew photo — tap "Take crew photo".'); return; }
    if (form.lat == null) { setError('Capture the site location before saving.'); return; }
    setSaving(true);
    setError(null);
    const list = ticked.map((id) => ({
      employee_id: id,
      status: ticks[id].status,
      in_time: ticks[id].status === 'leave' ? null : ticks[id].in_time || null,
      out_time: ticks[id].status === 'leave' ? null : ticks[id].out_time || null,
    }));
    if (form.markRestAbsent) {
      roster.filter((w) => w.site_id === site.id && !ticks[w.id]).forEach((w) => list.push({ employee_id: w.id, status: 'absent' }));
    }
    const { error: err } = await supabase.rpc('submit_muster', {
      p: {
        site_id: site.id, date, group_photo: form.group_photo[0] ?? null, photo_live: form.photo_live,
        lat: form.lat, lng: form.lng, accuracy_m: form.accuracy_m,
        visitors: form.visitors || null, note: form.note || null, marked_by_name: form.marked_by_name || null,
        client_time: new Date().toISOString(), entries: list,
      },
    });
    setSaving(false);
    if (err) { setError(friendly(err)); return; }
    setOpen(false);
    onChanged();
  }

  const present = entries.filter((e) => Number(e.units) > 0);
  const headcount = present.reduce((n, e) => n + Number(e.units), 0);

  if (open) {
    return (
      <form onSubmit={submit} className="p-4 rounded-xl mb-6 space-y-4" style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}>
        <div className="flex items-center justify-between gap-2">
          <SubHeading className="">{muster ? 'EDIT MUSTER' : 'MARK ATTENDANCE'} · {fmtDate(date)}</SubHeading>
          <span className="text-xs font-semibold" style={{ color: MODULE.accent }}>{Object.keys(ticks).length} ticked</span>
        </div>

        {roster.length === 0 ? (
          <div className="text-xs px-3 py-3 rounded-lg" style={{ color: THEME.textDim, background: THEME.panel2 }}>No workers listed for this site yet.</div>
        ) : (
          <>
            <div className="flex gap-3 text-xs">
              <button type="button" className="font-semibold" style={{ color: MODULE.accent }}
                onClick={() => setTicks(Object.fromEntries(roster.map((w) => [w.id, ticks[w.id] ?? { status: 'present', in_time: settings.shift_start, out_time: '' }])))}>
                Select all
              </button>
              <button type="button" style={{ color: THEME.textDim }} onClick={() => setTicks({})}>Clear</button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
              {roster.map((w) => {
                const t = ticks[w.id];
                const preview = t ? classifyEntry(t, settings) : null;
                return (
                  <div key={w.id} className="rounded-lg" style={{ background: t ? 'rgba(255,106,19,0.10)' : THEME.panel2, border: `1px solid ${t ? MODULE.accent : THEME.border}` }}>
                    <button type="button" onClick={() => toggle(w.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left" style={{ color: THEME.text }}>
                      <span className="flex items-center justify-center rounded shrink-0"
                        style={{ width: 20, height: 20, background: t ? MODULE.accent : 'transparent', border: `1px solid ${t ? MODULE.accent : THEME.border}` }}>
                        {t && <Check size={13} color="#111" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{w.name}</span>
                        <span className="block text-[11px]" style={{ color: THEME.textDim }}>{w.trade || (w.site_id ? '' : 'Floating')}</span>
                      </span>
                      {preview && t.status !== 'leave' && (
                        <span className="flex flex-wrap gap-1 justify-end">
                          {preview.status === 'half' && <Chip tone="amber">Half</Chip>}
                          {preview.late_min > 0 && <Chip tone="amber">{preview.late_min}m late</Chip>}
                          {preview.ot_hours > 0 && <Chip tone="blue">OT {preview.ot_hours}h</Chip>}
                        </span>
                      )}
                    </button>
                    {t && (
                      <div className="flex gap-1.5 px-3 pb-2.5">
                        <select value={t.status} onChange={(e) => setTick(w.id, 'status', e.target.value)}
                          className="bg-transparent border rounded-lg px-2 text-xs outline-none" style={{ borderColor: THEME.border, color: THEME.text }}>
                          <option value="present">Present</option>
                          <option value="half">Half day</option>
                          <option value="leave">Leave</option>
                        </select>
                        {t.status !== 'leave' && (
                          <>
                            <input type="time" value={t.in_time} onChange={(e) => setTick(w.id, 'in_time', e.target.value)} aria-label="In time"
                              className="bg-transparent border rounded-lg px-2 py-1.5 text-xs outline-none flex-1 min-w-0" style={{ borderColor: THEME.border, color: THEME.text }} />
                            <input type="time" value={t.out_time} onChange={(e) => setTick(w.id, 'out_time', e.target.value)} aria-label="Out time"
                              className="bg-transparent border rounded-lg px-2 py-1.5 text-xs outline-none flex-1 min-w-0" style={{ borderColor: THEME.border, color: THEME.text }} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Toggle checked={form.markRestAbsent} onChange={(v) => setForm((f) => ({ ...f, markRestAbsent: v }))}
              label="Record unticked workers of this site as absent" hint="Keeps the register complete. Floating workers are left out." />
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Extra hands / visitors" full hint="Anyone not on the Team list.">
            <Input value={form.visitors} onChange={(e) => setForm((f) => ({ ...f, visitors: e.target.value }))} placeholder="e.g. 2 helpers from Salim contractor" />
          </Field>
          <Field label="Crew photo (required)" full hint="Taken here and now — the app's camera only, no gallery.">
            <div className="flex items-center gap-3">
              {form.group_photo[0] && (
                <StoredImage src={form.group_photo[0]} onClick={() => setLightbox(form.group_photo[0])}
                  className="rounded-lg object-cover cursor-pointer" style={{ height: 76, width: 76 }} />
              )}
              <Btn type="button" variant={form.group_photo.length ? 'subtle' : 'primary'} accent={MODULE.accent} icon={Camera} onClick={() => setCamera(true)}>
                {form.group_photo.length ? 'Retake' : 'Take crew photo'}
              </Btn>
            </div>
          </Field>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3 p-3 rounded-lg" style={{ background: THEME.panel2 }}>
            <Btn type="button" accent={THEME.blue} onClick={locate} disabled={locating} icon={locating ? Loader2 : Navigation}>
              {locating ? 'Locating…' : form.lat != null ? 'Update location' : 'Capture location'}
            </Btn>
            {form.lat != null && (
              <span className="text-xs" style={{ color: THEME.textDim }}>
                ±{form.accuracy_m ?? '?'} m ·{' '}
                {distance != null && (
                  <span style={{ color: distance > (site.radius_m ?? 200) ? THEME.red : THEME.green }}>
                    {fmtDistance(distance)} from site{distance > (site.radius_m ?? 200) ? ' — outside the site radius, will be flagged' : ''}
                  </span>
                )}{' '}
                <a href={mapsLink(form.lat, form.lng)} target="_blank" rel="noreferrer" style={{ color: THEME.orange }}>map</a>
              </span>
            )}
          </div>
          <Field label="Marked by">
            <Input value={form.marked_by_name} onChange={(e) => setForm((f) => ({ ...f, marked_by_name: e.target.value }))} />
          </Field>
          <Field label="Note">
            <TextArea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Early close, rain, client shutdown…" />
          </Field>
        </div>
        <FormError error={error} />
        <div className="flex gap-2 justify-end">
          <Btn type="button" variant="subtle" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn type="submit" accent={MODULE.accent} disabled={saving} icon={saving ? Loader2 : undefined}>{saving ? 'Saving…' : 'Save muster'}</Btn>
        </div>
        <LiveCamera open={camera} onClose={() => setCamera(false)}
          onCapture={(ref) => setForm((f) => ({ ...f, group_photo: [ref], photo_live: true }))}
          stamp={[
            `${site?.name ?? ''} · ${fmtDate(date)}`,
            fmtDateTime(new Date()),
            form.lat != null ? `GPS ${Number(form.lat).toFixed(5)}, ${Number(form.lng).toFixed(5)}` : 'GPS not captured yet',
          ]} />
        <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
      </form>
    );
  }

  return (
    <div className="mb-6">
      {editable && (
        !muster ? (
          <Btn accent={MODULE.accent} icon={Users2} onClick={start} className="w-full sm:w-auto mb-4">
            Mark attendance for {date === today() ? 'today' : fmtDate(date)}
          </Btn>
        ) : adminsMuster ? (
          <Banner tone="dim">Admin marked this day, so only Admin can change it.</Banner>
        ) : inWindow ? (
          <Btn variant="subtle" icon={Pencil} onClick={start} className="mb-4">Edit this muster</Btn>
        ) : (
          <Banner tone="dim">The edit window for this muster has passed. Ask someone with Verify Attendance access to correct it.</Banner>
        )
      )}

      {!muster && !entries.length ? (
        <Card><EmptyState label={`Nothing marked for ${fmtDate(date)}.`} /></Card>
      ) : (
        <Card className="p-4">
          {muster && (
            <div className="flex items-start gap-3 mb-3">
              {muster.group_photo ? (
                <StoredImage src={muster.group_photo} onClick={() => setLightbox(muster.group_photo)} className="rounded-lg object-cover cursor-pointer shrink-0" style={{ height: 72, width: 72 }} />
              ) : (
                <div className="rounded-lg flex items-center justify-center shrink-0 text-[10px]" style={{ height: 72, width: 72, background: THEME.panel2, color: THEME.textDim }}>no photo</div>
              )}
              <div className="min-w-0 text-xs space-y-0.5" style={{ color: THEME.textDim }}>
                <div className="text-base" style={{ color: THEME.text }}>
                  <b style={{ color: MODULE.accent }}>{headcount}</b> present
                </div>
                <div>Marked by {muster.marked_by_name || '—'} · {fmtDateTime(muster.marked_at)}</div>
                {muster.lat != null && (
                  <div>
                    <a href={mapsLink(muster.lat, muster.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: THEME.orange }}>
                      <MapPin size={11} /> {muster.distance_m != null ? `${fmtDistance(muster.distance_m)} from site` : 'location'}
                    </a>
                  </div>
                )}
                {muster.visitors && <div>Plus {muster.visitors}</div>}
                {muster.note && <div>{muster.note}</div>}
              </div>
            </div>
          )}
          <EntryList entries={entries} empName={empName} onOpen={onOpen} />
        </Card>
      )}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function EntryList({ entries, empName, onOpen }) {
  return (
    <div className="divide-y" style={{ borderColor: THEME.border }}>
      {[...entries].sort((a, b) => empName(a.employee_id).localeCompare(empName(b.employee_id))).map((e) => {
        const code = e.units >= 1 ? 'P' : Number(e.units) === 0.5 ? 'H' : STATUS_CODE[e.status];
        return (
          <button key={e.id} type="button" onClick={() => onOpen(e)} className="w-full text-left py-2.5 flex items-center justify-between gap-2" style={{ borderColor: THEME.border }}>
            <span className="min-w-0">
              <span className="text-sm block truncate">{empName(e.employee_id)}</span>
              <span className="text-[11px]" style={{ color: THEME.textDim }}>
                {e.in_time ? `${fmtTime(e.in_time)}${e.out_time ? `–${fmtTime(e.out_time)}` : ''}` : STATUS_LABEL[e.status]}
              </span>
            </span>
            <span className="flex flex-wrap gap-1 justify-end">
              {e.late_min > 0 && <Chip tone="amber">{e.late_min}m late</Chip>}
              {Number(e.ot_hours) > 0 && <Chip tone="blue">OT {Number(e.ot_hours)}h</Chip>}
              {(e.flags ?? []).length > 0 && !e.verified_at && <Chip tone="red">{e.flags.length} flag{e.flags.length > 1 ? 's' : ''}</Chip>}
              {e.verified_at && <Chip tone="green">✓</Chip>}
              <Chip tone={CODE_TONE[code]}>{code}</Chip>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- punch mode ------------------------------ */

function PunchPanel({ site, settings, date, roster, entries, editable, onOpen, onChanged }) {
  const { empName } = useAppData();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(null);
  const [locating, setLocating] = useState(false);
  const fileRef = useRef(null);
  const pending = useRef(null);
  const isToday = date === today();

  async function location({ force = false } = {}) {
    if (!force && pos && Date.now() - pos.at < 5 * 60 * 1000) return pos;
    setLocating(true);
    try {
      const p = { ...(await getPosition()), at: Date.now() };
      setPos(p);
      return p;
    } finally {
      setLocating(false);
    }
  }

  async function punch(emp, kind, photoFile = null) {
    setBusy(`${emp.id}-${kind}`);
    setError(null);
    try {
      let p = null;
      try {
        p = await location();
      } catch (e) {
        if (settings.require_gps) throw e;
      }
      const photo = photoFile ? await uploadPhoto(photoFile, 'attendance', { private: true }) : null;
      const { error: err } = await supabase.rpc('punch', {
        p_employee: emp.id, p_site: site.id, p_kind: kind, p_photo: photo,
        p_lat: p?.lat ?? null, p_lng: p?.lng ?? null, p_accuracy: p?.accuracy_m ?? null,
      });
      if (err) throw new Error(friendly(err));
      onChanged();
    } catch (e) {
      setError(`${emp.name}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  function withPhoto(emp, kind) {
    pending.current = { emp, kind };
    fileRef.current?.click();
  }

  async function closeDay() {
    if (!window.confirm(`Record everyone assigned to ${site.name} with no entry on ${fmtDate(date)} as absent?`)) return;
    setBusy('close');
    const { data, error: err } = await supabase.rpc('close_day', { p_site: site.id, p_date: date });
    setBusy(null);
    if (err) setError(friendly(err));
    else { onChanged(); window.alert(`${data} marked absent.`); }
  }

  const byEmp = Object.fromEntries(entries.map((e) => [e.employee_id, e]));
  const inNow = entries.filter((e) => e.in_time && !e.out_time).length;
  const done = entries.filter((e) => e.out_time).length;
  const distance = pos && site ? distanceM(pos.lat, pos.lng, site.lat, site.lng) : null;

  return (
    <div className="mb-6">
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && pending.current) punch(pending.current.emp, pending.current.kind, f);
        }} />

      <Card className="p-3 mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <b style={{ color: THEME.green }}>{inNow}</b> <span style={{ color: THEME.textDim }}>on site ·</span>{' '}
          <b>{done}</b> <span style={{ color: THEME.textDim }}>left ·</span>{' '}
          <b style={{ color: THEME.amber }}>{roster.length - entries.filter((e) => e.in_time).length}</b> <span style={{ color: THEME.textDim }}>not in</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isToday && (
            <Btn variant="subtle" icon={locating ? Loader2 : Navigation} disabled={locating} onClick={() => location({ force: true }).catch((e) => setError(e.message))}>
              {pos ? (distance != null ? `${fmtDistance(distance)} from site` : 'Location ready') : 'Get location'}
            </Btn>
          )}
          {editable && (
            <Btn variant="ghost" icon={CalendarX2} disabled={busy === 'close'} onClick={closeDay}>Close day</Btn>
          )}
        </div>
      </Card>

      {!isToday && <Banner tone="dim">Punching is for today. For {fmtDate(date)}, tap a worker to correct their entry.</Banner>}
      {distance != null && distance > (site.radius_m ?? 200) && (
        <Banner tone="red">You are {fmtDistance(distance)} from the site — punches will be flagged for the owner.</Banner>
      )}
      {error && <Banner tone="red">{error}</Banner>}

      {roster.length === 0 ? (
        <Card><EmptyState label="No workers listed for this site yet." /></Card>
      ) : (
        <div className="space-y-1.5">
          {roster.map((w) => {
            const e = byEmp[w.id];
            const state = !e || !e.in_time ? 'out' : e.out_time ? 'done' : 'in';
            const b = (k) => busy === `${w.id}-${k}`;
            return (
              <div key={w.id} className="flex items-center gap-2 p-2.5 rounded-lg"
                style={{ background: THEME.panel, border: `1px solid ${state === 'in' ? THEME.green : THEME.border}` }}>
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => e && onOpen(e)} disabled={!e}>
                  <div className="text-sm font-medium truncate">{empName(w.id)}</div>
                  <div className="text-[11px] flex flex-wrap items-center gap-1 mt-0.5" style={{ color: THEME.textDim }}>
                    {state === 'out' && (e ? STATUS_LABEL[e.status] : w.trade || 'Not in yet')}
                    {state !== 'out' && `${fmtTime(e.in_time)}${e.out_time ? `–${fmtTime(e.out_time)}` : ' → on site'}`}
                    {e?.late_min > 0 && <Chip tone="amber">{e.late_min}m late</Chip>}
                    {Number(e?.ot_hours) > 0 && <Chip tone="blue">OT {Number(e.ot_hours)}h</Chip>}
                    {state === 'done' && Number(e.units) === 0.5 && <Chip tone="amber">Half</Chip>}
                    {(e?.flags ?? []).length > 0 && !e.verified_at && <Chip tone="red">{e.flags.length} flag</Chip>}
                  </div>
                </button>
                {editable && isToday && state !== 'done' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <IconBtn icon={Camera} title={`${state === 'in' ? 'OUT' : 'IN'} with photo`} onClick={() => withPhoto(w, state === 'in' ? 'out' : 'in')} />
                    {state === 'out' ? (
                      <Btn accent={THEME.green} icon={b('in') ? Loader2 : LogIn} disabled={!!busy}
                        onClick={() => (settings.require_photo ? withPhoto(w, 'in') : punch(w, 'in'))} style={{ minWidth: 76 }}>IN</Btn>
                    ) : (
                      <Btn accent={THEME.amber} icon={b('out') ? Loader2 : LogOut} disabled={!!busy} onClick={() => punch(w, 'out')} style={{ minWidth: 76 }}>OUT</Btn>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- entry edit ------------------------------ */

function EntryModal({ entry, settings, editable, verifier, onClose, onChanged }) {
  const { empName, siteName } = useAppData();
  const { canChangeRow } = useAuth();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    if (!entry) return;
    setForm({
      status: entry.status, in_time: entry.in_time ? fmtTime(entry.in_time) : '', out_time: entry.out_time ? fmtTime(entry.out_time) : '',
      ot_hours: String(entry.ot_hours ?? 0), note: entry.note ?? '',
    });
    setError(null);
  }, [entry]);

  if (!entry || !form) return null;
  const adminsEntry = !canChangeRow(entry, ['attendance_verify']);
  const canChange = editable && !adminsEntry && (inEditWindow(entry.marked_at, settings) || verifier);
  const preview = classifyEntry(form, settings);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.from('attendance_entries').update({
      status: form.status, in_time: form.in_time || null, out_time: form.out_time || null,
      ot_hours: Number(form.ot_hours) || 0, note: form.note || null,
    }).eq('id', entry.id).select('id');
    setSaving(false);
    if (err) setError(friendly(err));
    else if (!data?.length) setError('Not saved — the edit window has passed or this month is finalised in payroll.');
    else onChanged();
  }

  async function del() {
    const { data, error: err } = await supabase.from('attendance_entries').delete().eq('id', entry.id).select('id');
    if (err) setError(friendly(err));
    else if (!data?.length) setError('Not deleted — the edit window has passed or this month is finalised in payroll.');
    else onChanged();
  }

  return (
    <Modal open onClose={onClose} title={`${empName(entry.employee_id)} · ${fmtDate(entry.date)}`} accent={MODULE.accent}>
      <form onSubmit={save} className="space-y-3 text-sm">
        <div className="text-xs" style={{ color: THEME.textDim }}>
          {siteName(entry.site_id)} · {entry.source} · marked {fmtDateTime(entry.marked_at)}
          {entry.distance_m != null && ` · ${fmtDistance(entry.distance_m)} from site`}
          {entry.lat != null && <> · <a href={mapsLink(entry.lat, entry.lng)} target="_blank" rel="noreferrer" style={{ color: THEME.orange }}>map</a></>}
        </div>
        <div className="flex flex-wrap gap-1">
          {(entry.flags ?? []).map((f) => <Chip key={f} tone={FLAG_TONE[f] ?? 'dim'}>{FLAG_LABEL[f] ?? f}</Chip>)}
          {entry.verified_at && <Chip tone="green">Verified {fmtDateTime(entry.verified_at)}</Chip>}
        </div>
        {(entry.photo_url || entry.out_photo_url) && (
          <div className="flex gap-2">
            {[entry.photo_url, entry.out_photo_url].filter(Boolean).map((p) => (
              <StoredImage key={p} src={p} onClick={() => setLightbox(p)} className="rounded-lg object-cover cursor-pointer" style={{ height: 64, width: 64 }} />
            ))}
          </div>
        )}

        <fieldset disabled={!canChange} className="grid grid-cols-2 gap-3">
          <Field label="Status" full>
            <Select placeholder={null} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          </Field>
          <Field label="In"><Input type="time" value={form.in_time} onChange={(e) => setForm((f) => ({ ...f, in_time: e.target.value }))} /></Field>
          <Field label="Out"><Input type="time" value={form.out_time} onChange={(e) => setForm((f) => ({ ...f, out_time: e.target.value }))} /></Field>
          <Field label="OT hours" hint={form.out_time ? 'Worked out from in/out times.' : 'Only used when there is no out time.'}>
            <Input type="number" min="0" step="0.5" value={form.ot_hours} disabled={!!form.out_time}
              onChange={(e) => setForm((f) => ({ ...f, ot_hours: e.target.value }))} />
          </Field>
          <Field label="Will count as">
            <div className="py-2.5">{preview.units} day{preview.ot_hours ? ` + ${preview.ot_hours} h OT` : ''}{preview.late_min ? ` · ${preview.late_min}m late` : ''}</div>
          </Field>
          <Field label="Note" full><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
        </fieldset>

        {!canChange && editable && (
          <Banner tone="dim">
            {adminsEntry ? 'Admin added this entry, so only Admin can change it.' : 'The edit window has passed. Ask someone with Verify Attendance access.'}
          </Banner>
        )}
        <FormError error={error} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center">
            <AuditButton table="attendance_entries" rowId={entry.id} />
            {canChange && <DeleteBtn onDelete={del} label="this entry" />}
          </div>
          <div className="flex gap-2">
            <Btn type="button" variant="subtle" onClick={onClose}>Close</Btn>
            {canChange && <Btn type="submit" accent={MODULE.accent} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>}
          </div>
        </div>
      </form>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Modal>
  );
}

/* ------------------------------ recent days ------------------------------ */

function RecentDays({ siteId, activeDate, onPick }) {
  const from = addDays(today(), -13);
  const { rows } = useRecords('attendance_entries', {
    select: 'date,units,flags,verified_at', filters: [['site_id', 'eq', siteId], ['date', 'gte', from]], orderBy: 'date', pageSize: 2000,
  });
  const days = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const d = m.get(r.date) ?? { date: r.date, head: 0, flagged: 0 };
      d.head += Number(r.units) || 0;
      if ((r.flags ?? []).length && !r.verified_at) d.flagged += 1;
      m.set(r.date, d);
    });
    return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows]);

  if (!days.length) return null;
  return (
    <>
      <SubHeading>LAST 14 DAYS</SubHeading>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.map((d) => (
          <button key={d.date} type="button" onClick={() => onPick(d.date)} className="p-2.5 rounded-lg text-left"
            style={{ background: THEME.panel, border: `1px solid ${d.date === activeDate ? MODULE.accent : THEME.border}` }}>
            <div className="text-[11px]" style={{ color: THEME.textDim }}>{fmtDate(d.date)}</div>
            <div className="text-lg" style={{ fontFamily: 'Oswald' }}>{d.head}</div>
            {d.flagged > 0 && <Chip tone="red">{d.flagged} to check</Chip>}
          </button>
        ))}
      </div>
    </>
  );
}
