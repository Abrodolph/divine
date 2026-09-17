import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2, PackageCheck, X } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, today } from '../lib/format';
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, PO_STATUS_LABEL } from '../lib/procurement';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { UNITS } from '../config/fields';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, TextArea, Select, SiteSelect,
  PhotoInput, PhotoStrip, Lightbox, Chip, Modal, FormError, Tabs, StatusBadge, IconBtn, LoadMore, Banner, SubHeading,
} from '../components/ui';

const MODULE = moduleByKey('requirements');
const OTHER = '__other';
const TAB_STATUSES = {
  open: ['submitted', 'approved', 'ordered', 'partially_received'],
  done: ['received', 'closed'],
  other: ['rejected', 'cancelled'],
};

export const blankLine = () => ({ item_id: '', description: '', size: '', qty: '', unit: '', note: '' });

/**
 * Site view of procurement: raise a request for material, see where it is
 * (approved → ordered → received), and receive it when it arrives.
 */
export default function Requests() {
  const { siteFilter, siteName } = useAppData();
  const { canEdit, canView, canChangeRow, locks } = useAuth();
  const editable = canEdit('requirements') && !locks.requirements;
  const [tab, setTab] = useState('open');
  const [editing, setEditing] = useState(null); // null | 'new' | request
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const { rows, loading, reload, hasMore, loadMore, error: loadError } = useRecords('purchase_requests', {
    select: '*, purchase_request_items(*)',
    orderBy: 'date',
    filters: [['site_id', 'eq', siteFilter], ['status', 'in', TAB_STATUSES[tab]]],
  });

  async function setStatus(r, status) {
    setError(null);
    const { data, error: err } = await supabase.from('purchase_requests').update({ status }).eq('id', r.id).select('id');
    if (err) setError(friendly(err));
    else if (!data?.length) setError('Not changed — the office may already be working on this request.');
    else reload();
  }

  return (
    <div>
      <SectionHeader title="Site Requests" subtitle="Ask the office for material and track it to delivery" icon={MODULE.icon} accent={MODULE.accent} />
      <LockBanner locked={!!locks.requirements} readOnly={!canEdit('requirements') && !locks.requirements} />

      {editable && (
        <Btn accent={MODULE.accent} icon={Plus} onClick={() => setEditing('new')} className="w-full sm:w-auto mb-5">Raise Request</Btn>
      )}

      <Tabs value={tab} onChange={setTab} accent={MODULE.accent} tabs={[
        { value: 'open', label: 'Open' }, { value: 'done', label: 'Received / closed' }, { value: 'other', label: 'Rejected / cancelled' },
      ]} />

      {(error || loadError) && <Banner tone="red">{error || loadError}</Banner>}

      {loading ? <Loading /> : rows.length === 0 ? (
        <Card><EmptyState label="No requests here." hint={editable && tab === 'open' ? 'Tap "Raise Request" when site needs material.' : undefined} /></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestCard key={r.id} r={r} siteName={siteName} onOpen={() => setDetail(r)} onPhoto={setLightbox}
              actions={(
                <>
                  <AuditButton table="purchase_requests" rowId={r.id} />
                  {editable && ['submitted', 'rejected'].includes(r.status) && canChangeRow(r, ['procurement']) && (
                    <IconBtn icon={Pencil} title={r.status === 'rejected' ? 'Edit and resubmit' : 'Edit'} onClick={() => setEditing(r)} />
                  )}
                  {editable && ['submitted', 'rejected'].includes(r.status) && canChangeRow(r, ['procurement', 'procurement_approve']) && (
                    <IconBtn icon={X} title="Cancel request" onClick={() => window.confirm(`Cancel ${r.doc_no}?`) && setStatus(r, 'cancelled')} />
                  )}
                  {['ordered', 'partially_received'].includes(r.status) && canView('material_received') && (
                    <Link to="/material_received"><Btn variant="subtle" icon={PackageCheck} className="!py-1.5 !px-2.5 !text-xs">Receive</Btn></Link>
                  )}
                </>
              )} />
          ))}
          <LoadMore hasMore={hasMore} onClick={loadMore} />
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} wide accent={MODULE.accent}
        title={editing === 'new' ? 'Raise a request' : `Edit ${editing?.doc_no ?? ''}`}>
        {editing && <RequestForm request={editing === 'new' ? null : editing} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} wide accent={MODULE.accent} title={detail?.doc_no ?? ''}>
        {detail && <RequestTimeline request={detail} />}
      </Modal>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

export function RequestCard({ r, siteName, actions, onOpen, onPhoto }) {
  const lines = [...(r.purchase_request_items ?? [])].sort((a, b) => a.sort - b.sort);
  return (
    <Card className="p-4">
      <div className="flex justify-between items-start gap-2 flex-wrap">
        <button type="button" className="min-w-0 text-left" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: THEME.panel2, color: THEME.amber }}>{r.doc_no ?? '—'}</span>
            <Chip tone={REQUEST_STATUS_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Chip>
            {['High', 'Urgent'].includes(r.priority) && <StatusBadge value={r.priority} />}
          </div>
          <div className="font-semibold mt-1.5" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>{siteName(r.site_id)}</div>
          <div className="text-xs" style={{ color: THEME.textDim }}>
            Raised {fmtDate(r.date)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}
            {r.needed_by && <> · needed by <b style={{ color: r.needed_by < today() && TAB_STATUSES.open.includes(r.status) ? THEME.red : THEME.text }}>{fmtDate(r.needed_by)}</b></>}
            {r.fulfilled_on && <> · fulfilled <b style={{ color: THEME.green }}>{fmtDate(r.fulfilled_on)}</b></>}
          </div>
        </button>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <ul className="mt-3 text-sm space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap justify-between gap-x-3">
            <span>• {l.description}{l.size ? ` ${l.size}` : ''} — <b>{Number(l.qty)}</b> {l.unit ?? ''}</span>
            {(Number(l.qty_ordered) > 0 || Number(l.qty_received) > 0) && (
              <span className="text-xs" style={{ color: Number(l.qty_received) >= Number(l.qty) ? THEME.green : THEME.textDim }}>
                ordered {Number(l.qty_ordered)} · received {Number(l.qty_received)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {r.status === 'rejected' && r.decision_note && <div className="text-xs mt-2" style={{ color: THEME.red }}>Rejected: {r.decision_note}</div>}
      {r.remarks && <div className="text-xs mt-2" style={{ color: THEME.textDim }}>{r.remarks}</div>}
      {r.photos?.length > 0 && <div className="mt-2"><PhotoStrip photos={r.photos} onOpen={onPhoto} size={40} /></div>}
    </Card>
  );
}

export function RequestForm({ request, onDone, onCancel }) {
  const { activeSites, siteFilter } = useAppData();
  const { profile } = useAuth();
  const { rows: items } = useRecords('items', { filters: [['active', 'eq', true]], orderBy: 'name', ascending: true, pageSize: 2000 });
  const [head, setHead] = useState(() => ({
    site_id: request?.site_id ?? siteFilter ?? '',
    needed_by: request?.needed_by ?? '',
    priority: request?.priority ?? 'Medium',
    requested_by_name: request?.requested_by_name ?? profile?.name ?? '',
    remarks: request?.remarks ?? '',
    photos: request?.photos ?? [],
  }));
  const [lines, setLines] = useState(() => (request?.purchase_request_items?.length
    ? [...request.purchase_request_items].sort((a, b) => a.sort - b.sort).map((l) => ({
      item_id: l.item_id ?? OTHER, description: l.description, size: l.size ?? '', qty: String(l.qty), unit: l.unit ?? '', note: l.note ?? '',
    }))
    : [blankLine()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const groups = useMemo(() => {
    const m = new Map();
    items.forEach((i) => { const g = i.category || 'Other'; if (!m.has(g)) m.set(g, []); m.get(g).push(i); });
    return [...m.entries()];
  }, [items]);

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  function pickItem(idx, id) {
    if (id === OTHER) { setLine(idx, { item_id: OTHER, description: '', size: '', unit: '' }); return; }
    const it = byId[id];
    setLine(idx, { item_id: id, description: it?.name ?? '', size: it?.sizes?.length === 1 ? it.sizes[0] : '', unit: it?.unit ?? '' });
  }

  async function save(e) {
    e.preventDefault();
    const clean = lines.filter((l) => l.description.trim() || l.item_id);
    if (!head.site_id) { setError('Choose the site.'); return; }
    if (!clean.length) { setError('Add at least one item.'); return; }
    for (const l of clean) {
      if (!l.description.trim()) { setError('Describe every item (or pick it from the list).'); return; }
      if (!(Number(l.qty) > 0)) { setError(`Enter a quantity for ${l.description}.`); return; }
      const it = byId[l.item_id];
      if (it?.sizes?.length && !l.size) { setError(`Pick a size for ${l.description}.`); return; }
    }
    const payloadItems = clean.map((l) => ({
      item_id: l.item_id && l.item_id !== OTHER ? l.item_id : null, description: l.description.trim(),
      size: l.size || null, qty: Number(l.qty), unit: l.unit || null, note: l.note || null,
    }));
    setSaving(true);
    setError(null);
    try {
      if (!request) {
        const { error: err } = await supabase.rpc('create_purchase_request', { p: { ...head, items: payloadItems } });
        if (err) throw new Error(friendly(err));
      } else {
        const { data, error: err } = await supabase.from('purchase_requests').update({
          site_id: head.site_id, needed_by: head.needed_by || null, priority: head.priority,
          requested_by_name: head.requested_by_name || null, remarks: head.remarks || null, photos: head.photos,
          ...(request.status === 'rejected' ? { status: 'submitted', decision_note: null } : {}),
        }).eq('id', request.id).select('id');
        if (err) throw new Error(friendly(err));
        if (!data?.length) throw new Error('This request has moved on (approved or ordered) and can no longer be edited.');
        const { error: err2 } = await supabase.rpc('replace_request_items', { p_request: request.id, p_items: payloadItems });
        if (err2) throw new Error(friendly(err2));
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Site" required>
          <SiteSelect sites={activeSites} required value={head.site_id} onChange={(e) => setHead((h) => ({ ...h, site_id: e.target.value }))} />
        </Field>
        <Field label="Needed on site by">
          <Input type="date" min={today()} value={head.needed_by} onChange={(e) => setHead((h) => ({ ...h, needed_by: e.target.value }))} />
        </Field>
        <Field label="Priority">
          <Select placeholder={null} options={['Low', 'Medium', 'High', 'Urgent']} value={head.priority} onChange={(e) => setHead((h) => ({ ...h, priority: e.target.value }))} />
        </Field>
        <Field label="Raised by">
          <Input value={head.requested_by_name} onChange={(e) => setHead((h) => ({ ...h, requested_by_name: e.target.value }))} />
        </Field>
      </div>

      <div>
        <SubHeading className="mb-2">ITEMS</SubHeading>
        <div className="space-y-2">
          {lines.map((l, idx) => {
            const it = byId[l.item_id];
            return (
              <div key={idx} className="p-3 rounded-lg grid grid-cols-2 sm:grid-cols-12 gap-2" style={{ background: THEME.panel2 }}>
                <div className="col-span-2 sm:col-span-4">
                  <select value={l.item_id} onChange={(e) => pickItem(idx, e.target.value)} aria-label="Item"
                    className="w-full bg-transparent border rounded-lg px-2 py-2.5 text-sm outline-none" style={{ borderColor: THEME.border, color: THEME.text }}>
                    <option value="">Pick item…</option>
                    {groups.map(([g, list]) => (
                      <optgroup key={g} label={g}>{list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>
                    ))}
                    <optgroup label="Other"><option value={OTHER}>Not in the list — type it</option></optgroup>
                  </select>
                  {l.item_id === OTHER && (
                    <Input className="mt-2" placeholder="Describe the item" value={l.description} onChange={(e) => setLine(idx, { description: e.target.value })} />
                  )}
                </div>
                <div className="col-span-2 sm:col-span-3">
                  {it?.sizes?.length ? (
                    <Select placeholder="Size…" options={it.sizes} value={l.size} onChange={(e) => setLine(idx, { size: e.target.value })} />
                  ) : (
                    <Input placeholder={it?.size_hint ?? 'Size (if any)'} value={l.size} onChange={(e) => setLine(idx, { size: e.target.value })} />
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Input type="number" min="0.01" step="any" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Select placeholder="Unit" options={UNITS.map((u) => ({ value: u.value, label: u.value }))} value={l.unit} onChange={(e) => setLine(idx, { unit: e.target.value })} />
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  <IconBtn icon={Trash2} title="Remove item" onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((_, i) => i !== idx)))} />
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color: MODULE.accent }}>
          <Plus size={14} /> Add another item
        </button>
      </div>

      <Field label="Remarks" hint="Class / grade, make, delivery instructions…">
        <TextArea rows={2} value={head.remarks} onChange={(e) => setHead((h) => ({ ...h, remarks: e.target.value }))} />
      </Field>
      <Field label="Photos (optional)">
        <PhotoInput value={head.photos} onChange={(v) => setHead((h) => ({ ...h, photos: v }))} folder="requests" max={4} />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" accent={MODULE.accent} disabled={saving}>
          {saving ? 'Saving…' : request?.status === 'rejected' ? 'Resubmit' : request ? 'Save changes' : 'Send to office'}
        </Btn>
      </div>
    </form>
  );
}

/** What happened to a request: approval, orders, deliveries. */
export function RequestTimeline({ request }) {
  const { siteName } = useAppData();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, p, g] = await Promise.all([
        supabase.from('approvals').select('*').eq('entity_id', request.id).order('decided_at'),
        supabase.from('purchase_orders').select('id,doc_no,date,status,total,vendors(name)').eq('request_id', request.id).order('date'),
        supabase.from('goods_receipts').select('id,doc_no,date,items,purchase_orders(doc_no)').eq('request_id', request.id).order('date'),
      ]);
      if (alive) setData({ approvals: a.data ?? [], pos: p.data ?? [], grns: g.data ?? [] });
    })();
    return () => { alive = false; };
  }, [request.id]);

  if (!data) return <Loading />;
  const events = [
    { date: request.date, text: `Raised for ${siteName(request.site_id)}${request.requested_by_name ? ` by ${request.requested_by_name}` : ''}` },
    ...data.approvals.map((x) => ({ date: x.decided_at.slice(0, 10), text: `${x.decision === 'approved' ? 'Approved' : 'Rejected'}${x.note ? ` — ${x.note}` : ''}` })),
    ...data.pos.map((x) => ({ date: x.date, text: `${x.doc_no} to ${x.vendors?.name ?? 'vendor'} — ${PO_STATUS_LABEL[x.status]}` })),
    ...data.grns.map((x) => ({
      date: x.date,
      text: `${x.doc_no} received${x.purchase_orders?.doc_no ? ` against ${x.purchase_orders.doc_no}` : ''}: ${(x.items ?? []).map((l) => `${l.description} ${l.qty_received ?? 0}`).join(', ')}`,
    })),
    ...(request.fulfilled_on ? [{ date: request.fulfilled_on, text: 'Fulfilled' }] : []),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (
    <div className="space-y-4 text-sm">
      <RequestCard r={request} siteName={siteName} />
      <ol className="space-y-2">
        {events.map((ev, i) => (
          <li key={i} className="flex gap-3">
            <span className="text-xs shrink-0 w-24" style={{ color: THEME.textDim }}>{fmtDate(ev.date)}</span>
            <span>{ev.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
