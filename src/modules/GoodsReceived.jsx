import { useEffect, useState } from 'react';
import { PackageCheck, Plus, Trash2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, inr, today } from '../lib/format';
import { receiptLinesForPo } from '../lib/procurement';
import { exportCSV } from '../lib/csv';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, TextArea, SiteSelect, PhotoInput, PhotoStrip,
  Lightbox, Chip, Modal, FormError, Banner, SubHeading, LoadMore, IconBtn,
} from '../components/ui';

const MODULE = moduleByKey('material_received');

/**
 * Material arriving at site. Against a purchase order the lines come from the
 * PO with what's still pending, so short or rejected deliveries are recorded
 * and show up on the request. Local purchases can be received without a PO.
 */
export default function GoodsReceived() {
  const { siteFilter, siteName } = useAppData();
  const { canEdit, canView, locks } = useAuth();
  const editable = (canEdit('material_received') || canEdit('procurement')) && !locks.material_received;
  const [receiving, setReceiving] = useState(null); // null | { po } | { po: null }
  const [lightbox, setLightbox] = useState(null);

  const openPos = useRecords('purchase_orders', {
    select: '*, vendors(name), purchase_requests(doc_no)', orderBy: 'date',
    filters: [['status', 'in', ['sent', 'partially_received']], ['deliver_to_site_id', 'eq', siteFilter]],
  });
  const grns = useRecords('goods_receipts', {
    select: '*, purchase_orders(doc_no), vendors(name)', orderBy: 'date', filters: [['site_id', 'eq', siteFilter]],
  });

  const exportCols = [
    { key: 'doc_no', label: 'GRN' }, { key: 'date', label: 'Date' },
    { key: 'site', label: 'Site', value: (r) => siteName(r.site_id) },
    { key: 'po', label: 'PO', value: (r) => r.purchase_orders?.doc_no ?? '' },
    { key: 'supplier', label: 'Supplier', value: (r) => r.vendors?.name ?? r.supplier_name ?? '' },
    { key: 'items', label: 'Items', value: (r) => (r.items ?? []).map((l) => `${l.description} ${l.qty_received ?? 0}${l.unit ? ` ${l.unit}` : ''}`).join('; ') },
    { key: 'challan_ref', label: 'Challan / invoice' }, { key: 'vehicle_no', label: 'Vehicle' }, { key: 'received_by_name', label: 'Received by' },
  ];

  return (
    <div>
      <SectionHeader title="Goods Received" subtitle="Check deliveries against the purchase order — shortages get recorded" icon={MODULE.icon} accent={MODULE.accent}
        action={<Btn variant="ghost" onClick={() => exportCSV('goods_received.csv', exportCols, grns.rows)}>Export</Btn>} />
      <LockBanner locked={!!locks.material_received} readOnly={!editable && !locks.material_received} />

      {editable && (
        <>
          <SubHeading className="mb-2" action={<Btn variant="subtle" icon={Plus} className="!py-1.5 !text-xs" onClick={() => setReceiving({ po: null })}>Receive without PO</Btn>}>
            WAITING TO BE RECEIVED
          </SubHeading>
          {openPos.loading ? <Loading /> : openPos.rows.length === 0 ? (
            <Card className="mb-6"><EmptyState label="No purchase orders waiting for delivery." /></Card>
          ) : (
            <div className="space-y-2 mb-6">
              {openPos.rows.map((po) => (
                <Card key={po.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: THEME.panel2, color: MODULE.accent }}>{po.doc_no}</span>
                    <span className="ml-2 font-medium">{po.vendors?.name}</span>
                    <div className="text-xs mt-1" style={{ color: THEME.textDim }}>
                      {siteName(po.deliver_to_site_id)} · ordered {fmtDate(po.date)}{po.purchase_requests?.doc_no ? ` · ${po.purchase_requests.doc_no}` : ''}
                      {po.status === 'partially_received' && <span className="ml-1"><Chip tone="amber">part received</Chip></span>}
                    </div>
                    <div className="text-xs mt-1">{(po.items ?? []).map((l) => `${l.description}${l.size ? ` ${l.size}` : ''} × ${l.qty}`).join(', ')}</div>
                  </div>
                  <Btn accent={MODULE.accent} icon={PackageCheck} onClick={() => setReceiving({ po })}>Receive</Btn>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <SubHeading className="mb-2">RECEIPTS</SubHeading>
      {grns.error && <Banner tone="red">{grns.error}</Banner>}
      {grns.loading ? <Loading /> : grns.rows.length === 0 ? (
        <Card><EmptyState label="Nothing received yet." /></Card>
      ) : (
        <div className="space-y-3">
          {grns.rows.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: THEME.panel2, color: MODULE.accent }}>{g.doc_no ?? '—'}</span>
                  <span className="ml-2 font-semibold" style={{ fontFamily: 'Oswald' }}>{siteName(g.site_id)}</span>
                  <div className="text-xs mt-1" style={{ color: THEME.textDim }}>
                    {fmtDate(g.date)} · {g.vendors?.name ?? g.supplier_name ?? 'Supplier not noted'}
                    {g.purchase_orders?.doc_no ? ` · against ${g.purchase_orders.doc_no}` : ' · no PO'}
                    {g.challan_ref ? ` · DC ${g.challan_ref}` : ''}{g.vehicle_no ? ` · ${g.vehicle_no}` : ''}
                    {g.received_by_name ? ` · by ${g.received_by_name}` : ''}
                  </div>
                </div>
                <AuditButton table="goods_receipts" rowId={g.id} />
              </div>
              <ul className="mt-2 text-sm space-y-1">
                {(g.items ?? []).map((l, i) => {
                  const short = l.pending_before != null ? Number(l.pending_before) - Number(l.qty_received || 0) : 0;
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                      • {l.description}{l.size ? ` ${l.size}` : ''} — <b>{Number(l.qty_received) || 0}</b> {l.unit ?? ''}
                      {l.note && !l.po_line && <span className="text-xs" style={{ color: THEME.textDim }}>({l.note})</span>}
                      {short > 0 && <Chip tone="amber">short {short}</Chip>}
                      {Number(l.qty_rejected) > 0 && <Chip tone="red">rejected {l.qty_rejected}{l.reason ? ` — ${l.reason}` : ''}</Chip>}
                    </li>
                  );
                })}
              </ul>
              {g.remarks && <div className="text-xs mt-2" style={{ color: THEME.textDim }}>{g.remarks}</div>}
              {g.photos?.length > 0 && <div className="mt-2"><PhotoStrip photos={g.photos} onOpen={setLightbox} /></div>}
            </Card>
          ))}
          <LoadMore hasMore={grns.hasMore} onClick={grns.loadMore} />
        </div>
      )}

      <Modal open={!!receiving} onClose={() => setReceiving(null)} wide accent={MODULE.accent}
        title={receiving?.po ? `Receive ${receiving.po.doc_no}` : 'Receive without a PO'}>
        {receiving && (
          <ReceiveForm po={receiving.po} onCancel={() => setReceiving(null)}
            onDone={() => { setReceiving(null); openPos.reload(); grns.reload(); }} />
        )}
      </Modal>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
      {!canView('procurement') && null}
    </div>
  );
}

function ReceiveForm({ po, onDone, onCancel }) {
  const { activeSites, siteFilter } = useAppData();
  const { profile } = useAuth();
  const [lines, setLines] = useState(null);
  const [head, setHead] = useState({
    date: today(), site_id: po?.deliver_to_site_id ?? siteFilter ?? '', supplier_name: '', challan_ref: '', vehicle_no: '',
    received_by_name: profile?.name ?? '', remarks: '', photos: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!po) { setLines([{ description: '', qty_received: '', unit: '' }]); return; }
    let alive = true;
    supabase.from('goods_receipts').select('po_id,items').eq('po_id', po.id).then(({ data }) => {
      if (!alive) return;
      setLines(receiptLinesForPo(po, data ?? []).map((l) => ({ ...l, qty_received: String(l.pending), qty_rejected: '', reason: '' })));
    });
    return () => { alive = false; };
  }, [po]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  async function save(e) {
    e.preventDefault();
    if (!head.site_id) { setError('Choose the site.'); return; }
    const items = lines
      .filter((l) => Number(l.qty_received) > 0 || Number(l.qty_rejected) > 0)
      .map((l) => (po ? {
        request_item_id: l.request_item_id, po_line: l.po_line, description: l.description, size: l.size, unit: l.unit,
        qty_ordered: l.qty_ordered, pending_before: l.pending, qty_received: Number(l.qty_received) || 0,
        qty_rejected: Number(l.qty_rejected) || 0, reason: l.reason || null,
      } : { description: l.description.trim(), qty_received: Number(l.qty_received) || 0, unit: l.unit || null }));
    if (!items.length || items.some((l) => !l.description)) { setError('Enter what was received.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: docNo, error: e1 } = await supabase.rpc('next_doc_no', { p_prefix: 'GRN' });
      if (e1) throw new Error(friendly(e1));
      const { error: e2 } = await supabase.from('goods_receipts').insert({
        doc_no: docNo, date: head.date, site_id: head.site_id, po_id: po?.id ?? null, request_id: po?.request_id ?? null,
        vendor_id: po?.vendor_id ?? null, supplier_name: po ? po.vendors?.name ?? null : head.supplier_name || null,
        items, challan_ref: head.challan_ref || null, vehicle_no: head.vehicle_no || null,
        received_by_name: head.received_by_name || null, photos: head.photos, remarks: head.remarks || null,
      });
      if (e2) throw new Error(friendly(e2));
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!lines) return <Loading />;
  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      <div className="space-y-2">
        {lines.map((l, i) => (po ? (
          <div key={i} className="p-3 rounded-lg grid grid-cols-12 gap-2 items-end" style={{ background: THEME.panel2 }}>
            <div className="col-span-12 sm:col-span-5">
              <div>{l.description}{l.size ? ` ${l.size}` : ''}</div>
              <div className="text-xs" style={{ color: THEME.textDim }}>ordered {l.qty_ordered} {l.unit ?? ''} · already received {l.already_received} · pending {l.pending}</div>
            </div>
            <div className="col-span-4 sm:col-span-2"><Field label="Received"><Input type="number" min="0" step="any" value={l.qty_received} onChange={(e) => setLine(i, 'qty_received', e.target.value)} /></Field></div>
            <div className="col-span-4 sm:col-span-2"><Field label="Rejected"><Input type="number" min="0" step="any" value={l.qty_rejected} onChange={(e) => setLine(i, 'qty_rejected', e.target.value)} /></Field></div>
            <div className="col-span-4 sm:col-span-3"><Field label="Why rejected"><Input value={l.reason} onChange={(e) => setLine(i, 'reason', e.target.value)} /></Field></div>
          </div>
        ) : (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-12 sm:col-span-7"><Input placeholder="Material" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></div>
            <div className="col-span-5 sm:col-span-2"><Input type="number" min="0" step="any" placeholder="Qty" value={l.qty_received} onChange={(e) => setLine(i, 'qty_received', e.target.value)} /></div>
            <div className="col-span-5 sm:col-span-2"><Input placeholder="Unit" value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} /></div>
            <div className="col-span-2 sm:col-span-1"><IconBtn icon={Trash2} title="Remove" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} /></div>
          </div>
        )))}
        {!po && (
          <button type="button" onClick={() => setLines((ls) => [...ls, { description: '', qty_received: '', unit: '' }])}
            className="flex items-center gap-1 text-xs font-semibold" style={{ color: MODULE.accent }}>
            <Plus size={14} /> Add another item
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!po && (
          <>
            <Field label="Site" required><SiteSelect sites={activeSites} required value={head.site_id} onChange={(e) => setHead((h) => ({ ...h, site_id: e.target.value }))} /></Field>
            <Field label="Supplier"><Input value={head.supplier_name} onChange={(e) => setHead((h) => ({ ...h, supplier_name: e.target.value }))} /></Field>
          </>
        )}
        <Field label="Date"><Input type="date" max={today()} value={head.date} onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))} /></Field>
        <Field label="Supplier's DC / invoice no."><Input value={head.challan_ref} onChange={(e) => setHead((h) => ({ ...h, challan_ref: e.target.value }))} /></Field>
        <Field label="Vehicle no."><Input value={head.vehicle_no} onChange={(e) => setHead((h) => ({ ...h, vehicle_no: e.target.value }))} /></Field>
        <Field label="Received by"><Input value={head.received_by_name} onChange={(e) => setHead((h) => ({ ...h, received_by_name: e.target.value }))} /></Field>
        <Field label="Photos of material & challan" full>
          <PhotoInput value={head.photos} onChange={(v) => setHead((h) => ({ ...h, photos: v }))} folder="goods_receipts" max={6} />
        </Field>
        <Field label="Remarks" full><TextArea rows={2} value={head.remarks} onChange={(e) => setHead((h) => ({ ...h, remarks: e.target.value }))} /></Field>
      </div>
      {po && <div className="text-xs" style={{ color: THEME.textDim }}>PO value {inr(po.total)}. Receiving less than pending marks the order part-received.</div>}
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" accent={MODULE.accent} disabled={saving}>{saving ? 'Saving…' : 'Save receipt'}</Btn>
      </div>
    </form>
  );
}
