import { useMemo, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { addDays } from '../lib/dates';
import { fmtDate, fmtTime, today } from '../lib/format';
import { mapsLink, fmtDistance } from '../lib/geo';
import { FLAG_LABEL, STATUS_LABEL } from '../lib/attendance';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Chip, Lightbox, StoredImage, Tabs,
  ToolbarInput, SiteSelect, Banner, Input, LoadMore,
} from '../components/ui';

const MODULE = moduleByKey('attendance_verify');

const FLAG_TONE = { outside_radius: 'red', duplicate_day: 'red', edited_late: 'amber', backdated: 'amber', early_mark: 'amber', rejected: 'red' };

/**
 * The owner's queue: attendance the server flagged (outside the site radius,
 * no photo/GPS, back-dated, edited late, two sites in a day). Confirm it, or
 * reject it to absent with a reason. Every decision is in the audit log.
 */
export default function AttendanceVerify() {
  const { activeSites, siteName, empName, siteFilter } = useAppData();
  const { canEdit, locks, user } = useAuth();
  const editable = canEdit('attendance_verify');
  const [view, setView] = useState('flagged');
  const [from, setFrom] = useState(addDays(today(), -14));
  const [siteId, setSiteId] = useState(siteFilter || '');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState({});
  const [lightbox, setLightbox] = useState(null);

  const filters = [
    ['date', 'gte', from],
    ['site_id', 'eq', siteId],
    ...(view === 'verified' ? [['verified_at', 'notnull']] : [['verified_at', 'isnull']]),
    ...(view === 'flagged' ? [['flags', 'neq', '{}']] : []),
  ];
  const { rows, loading, error: loadError, reload, hasMore, loadMore } = useRecords('attendance_entries', {
    orderBy: 'date', ascending: false, filters, pageSize: 300,
  });

  const groups = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const k = `${r.date}|${r.site_id}`;
      if (!m.has(k)) m.set(k, { key: k, date: r.date, site_id: r.site_id, entries: [] });
      m.get(k).entries.push(r);
    });
    return [...m.values()];
  }, [rows]);

  async function decide(entries, decision) {
    setBusy(entries.map((e) => e.id).join(','));
    setError(null);
    try {
      for (const e of entries) {
        const patch = { verified_by: user.id, verified_at: new Date().toISOString() };
        if (decision === 'reject') {
          patch.status = 'absent';
          patch.flags = [...new Set([...(e.flags ?? []), 'rejected'])];
          patch.note = [e.note, notes[e.id] && `Rejected: ${notes[e.id]}`].filter(Boolean).join(' · ') || 'Rejected on verification';
        }
        const { data, error: err } = await supabase.from('attendance_entries').update(patch).eq('id', e.id).select('id');
        if (err) throw new Error(friendly(err));
        if (!data?.length) throw new Error('Could not update — this month may be finalised in payroll.');
      }
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SectionHeader title="Verify Attendance" subtitle="Check what the server flagged — confirm it, or reject to absent" icon={MODULE.icon} accent={MODULE.accent} />
      <LockBanner locked={!!locks.attendance_verify} readOnly={!editable && !locks.attendance_verify} />

      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>Site</label>
          <SiteSelect sites={activeSites} placeholder="All sites" value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </div>
        <ToolbarInput label="From" type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} />
      </Card>

      <Tabs value={view} onChange={setView} accent={MODULE.accent} tabs={[
        { value: 'crew', label: 'Crew photos' },
        { value: 'flagged', label: 'Needs a look' },
        { value: 'unverified', label: 'All unverified' },
        { value: 'verified', label: 'Verified' },
      ]} />

      {view === 'crew' && <CrewPhotos siteId={siteId} from={from} editable={editable} />}

      {view !== 'crew' && error && <Banner tone="red">{error}</Banner>}
      {view !== 'crew' && loadError && <Banner tone="red">{loadError}</Banner>}

      {view === 'crew' ? null : loading ? <Loading /> : groups.length === 0 ? (
        <Card><EmptyState label={view === 'verified' ? 'Nothing verified in this range.' : 'Nothing waiting. All clear.'} /></Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const pending = g.entries.filter((e) => !e.verified_at);
            return (
              <Card key={g.key} className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>{siteName(g.site_id)}</div>
                    <div className="text-xs" style={{ color: THEME.textDim }}>{fmtDate(g.date)} · {g.entries.length} entries</div>
                  </div>
                  {editable && pending.length > 1 && (
                    <Btn variant="subtle" icon={Check} disabled={!!busy} onClick={() => decide(pending, 'confirm')}>
                      Confirm all {pending.length}
                    </Btn>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: THEME.border }}>
                  {g.entries.map((e) => (
                    <div key={e.id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-3" style={{ borderColor: THEME.border }}>
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {e.photo_url ? (
                          <StoredImage src={e.photo_url} onClick={() => setLightbox(e.photo_url)}
                            className="rounded-lg object-cover cursor-pointer shrink-0" style={{ height: 52, width: 52 }} />
                        ) : (
                          <div className="rounded-lg shrink-0 flex items-center justify-center text-[10px]"
                            style={{ height: 52, width: 52, background: THEME.panel2, color: THEME.textDim }}>no photo</div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium">{empName(e.employee_id)}</div>
                          <div className="text-xs mt-0.5" style={{ color: THEME.textDim }}>
                            {STATUS_LABEL[e.status]} · {fmtTime(e.in_time)}{e.out_time ? `–${fmtTime(e.out_time)}` : ''}
                            {Number(e.ot_hours) > 0 ? ` · OT ${e.ot_hours} h` : ''}
                            {e.distance_m != null ? ` · ${fmtDistance(e.distance_m)} from site` : ''}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(e.flags ?? []).map((f) => <Chip key={f} tone={FLAG_TONE[f] ?? 'dim'}>{FLAG_LABEL[f] ?? f}</Chip>)}
                            {e.verified_at && <Chip tone="green">Verified</Chip>}
                            {e.lat != null && (
                              <a href={mapsLink(e.lat, e.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px]" style={{ color: THEME.orange }}>
                                <MapPin size={11} /> map
                              </a>
                            )}
                          </div>
                          {e.note && <div className="text-xs mt-1" style={{ color: THEME.textDim }}>{e.note}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 sm:shrink-0">
                        <AuditButton table="attendance_entries" rowId={e.id} />
                        {editable && !e.verified_at && (
                          <>
                            <Input placeholder="Reason (if rejecting)" value={notes[e.id] ?? ''} style={{ maxWidth: 170 }}
                              onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))} />
                            <Btn variant="ghost" icon={X} disabled={!!busy} onClick={() => decide([e], 'reject')} title="Reject — mark absent">Reject</Btn>
                            <Btn accent={THEME.green} icon={Check} disabled={!!busy} onClick={() => decide([e], 'confirm')}>OK</Btn>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          <LoadMore hasMore={hasMore} onClick={loadMore} />
        </div>
      )}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/* ------------------------------ crew photos ------------------------------ */

/**
 * The office's job: open the crew photo, keep the workers they can see in it
 * ticked, untick the rest, and approve. Unticked workers are marked absent for
 * that day only. Until a muster is approved, none of its days pay.
 */
function CrewPhotos({ siteId, from, editable }) {
  const { siteName } = useAppData();
  const { rows: musters, loading, error, reload } = useRecords('musters', {
    orderBy: 'date', ascending: false, pageSize: 60,
    filters: [['date', 'gte', from], ['site_id', 'eq', siteId], ['status', 'eq', 'submitted']],
  });

  if (loading) return <Loading />;
  if (error) return <Banner tone="red">{error}</Banner>;
  if (!musters.length) return <Card><EmptyState label="No crew photos waiting." hint="Approved days move on to payroll." /></Card>;

  return (
    <div className="space-y-4">
      {musters.map((m) => <MusterCard key={m.id} muster={m} siteName={siteName} editable={editable} onDone={reload} />)}
    </div>
  );
}

function MusterCard({ muster, siteName, editable, onDone }) {
  const { empName, employees } = useAppData();
  const { rows: entries, loading } = useRecords('attendance_entries', {
    filters: [['muster_id', 'eq', muster.id]], orderBy: 'marked_at', ascending: true, pageSize: 500,
  });
  const [present, setPresent] = useState(null); // null until the entries load
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const marked = useMemo(() => entries.filter((e) => Number(e.units) > 0), [entries]);
  const picked = present ?? new Set(marked.map((e) => e.employee_id));
  const photoOf = (id) => employees.find((e) => e.id === id)?.photo ?? null;

  function toggle(id) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPresent(next);
  }

  async function approve() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('approve_muster', {
      p_muster: muster.id, p_present: [...picked], p_note: note || null,
    });
    setBusy(false);
    if (err) { setError(friendly(err)); return; }
    onDone();
  }

  const dropped = marked.length - picked.size;

  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>{siteName(muster.site_id)}</div>
          <div className="text-xs" style={{ color: THEME.textDim }}>
            {fmtDate(muster.date)} · marked by {muster.marked_by_name || '—'} · {fmtTime(muster.marked_at?.slice(11, 16))}
            {muster.distance_m != null ? ` · ${fmtDistance(muster.distance_m)} from site` : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {muster.photo_live ? <Chip tone="green">Taken in the app</Chip> : <Chip tone="amber">Photo not taken in the app</Chip>}
          {muster.lat != null && (
            <a href={mapsLink(muster.lat, muster.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px]" style={{ color: THEME.orange }}>
              <MapPin size={11} /> map
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {muster.group_photo ? (
          <StoredImage src={muster.group_photo} onClick={() => setLightbox(muster.group_photo)}
            className="rounded-lg object-cover w-full cursor-pointer" style={{ maxHeight: 320 }} />
        ) : (
          <div className="rounded-lg flex items-center justify-center text-xs" style={{ minHeight: 160, background: THEME.panel2, color: THEME.textDim }}>no photo</div>
        )}

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs" style={{ color: THEME.textDim }}>
              Keep the workers you can see in the photo ticked ({picked.size} of {marked.length})
            </span>
            {editable && <button type="button" className="text-xs font-semibold" style={{ color: THEME.orange }} onClick={() => setPresent(new Set(marked.map((e) => e.employee_id)))}>Reset</button>}
          </div>
          {loading ? <Loading /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[320px] overflow-y-auto">
              {marked.map((e) => {
                const on = picked.has(e.employee_id);
                const photo = photoOf(e.employee_id);
                return (
                  <button key={e.id} type="button" disabled={!editable} onClick={() => toggle(e.employee_id)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-sm"
                    style={{ background: on ? 'rgba(62,166,94,0.10)' : THEME.panel2, border: `1px solid ${on ? THEME.green : THEME.border}`, color: THEME.text }}>
                    <span className="flex items-center justify-center rounded shrink-0"
                      style={{ width: 20, height: 20, background: on ? THEME.green : 'transparent', border: `1px solid ${on ? THEME.green : THEME.border}` }}>
                      {on && <Check size={13} color="#111" strokeWidth={3} />}
                    </span>
                    {photo && <StoredImage src={photo} className="rounded object-cover shrink-0" style={{ height: 28, width: 28 }} />}
                    <span className="min-w-0 truncate">{empName(e.employee_id)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {muster.visitors && <div className="text-xs mt-3" style={{ color: THEME.textDim }}>Extra hands: {muster.visitors}</div>}
      {muster.note && <div className="text-xs mt-1" style={{ color: THEME.textDim }}>{muster.note}</div>}
      {error && <div className="text-xs mt-2" style={{ color: THEME.red }}>{error}</div>}

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
          {dropped > 0 && (
            <Input placeholder={`Why ${dropped} removed`} value={note} style={{ maxWidth: 220 }} onChange={(e) => setNote(e.target.value)} />
          )}
          <Btn accent={THEME.green} icon={Check} disabled={busy} onClick={approve}>
            {busy ? 'Saving…' : dropped > 0 ? `Approve ${picked.size}, mark ${dropped} absent` : `Approve all ${picked.size}`}
          </Btn>
        </div>
      )}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Card>
  );
}
