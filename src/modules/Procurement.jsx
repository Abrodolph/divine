import { useMemo, useState } from 'react';
import { Check, X, Printer, Send, Ban, FileSpreadsheet, Plus } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, inr, today } from '../lib/format';
import {
  canMove, comparative, lineTotals, poLinesFromQuote, remainingToOrder, itemLabel, requestProgress,
  REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, PO_STATUS_LABEL,
} from '../lib/procurement';
import { exportCSV } from '../lib/csv';
import { useRecords, friendly } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { RequestCard, RequestFlow } from './Requests';
import { ReceiptDecision } from './GoodsReceived';
import { PurchaseOrderPrint } from '../components/ProcurementPrint';
import { AuditButton } from '../components/AuditTrail';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Btn, Field, Input, TextArea, Select, Chip, Modal, FormError,
  Tabs, TableWrap, Th, Td, Banner, SubHeading, PhotoInput, PhotoStrip, Lightbox, LoadMore, DeleteBtn, SiteSelect,
} from '../components/ui';

const MODULE = moduleByKey('procurement');
const TABS = [
  { value: 'approve', label: 'To approve', statuses: ['submitted'] },
  { value: 'order', label: 'To quote & order', statuses: ['approved', 'ordered', 'partially_received'] },
  { value: 'delivery', label: 'Awaiting delivery', statuses: ['ordered', 'partially_received'] },
  { value: 'accept', label: 'Deliveries to accept' },
  { value: 'done', label: 'Received / closed', statuses: ['received', 'closed'] },
  { value: 'rejected', label: 'Rejected / cancelled', statuses: ['rejected', 'cancelled'] },
  { value: 'pos', label: 'Purchase orders' },
];
const DEFAULT_TERMS = 'Delivery to the site above. Quote this PO number on your challan and invoice. Payment as agreed.';

/**
 * The office's buying desk: approve site requests, type in vendor quotes,
 * compare them side by side, raise purchase orders, and follow delivery.
 */
export default function Procurement() {
  const { siteFilter, siteName } = useAppData();
  const { canEdit, locks } = useAuth();
  const editable = canEdit('procurement') && !locks.procurement;
  const [tab, setTab] = useState('approve');
  const [openId, setOpenId] = useState(null);
  const [printPo, setPrintPo] = useState(null);
  const tabDef = TABS.find((t) => t.value === tab);

  const { rows: vendors } = useRecords('vendors', { orderBy: 'name', ascending: true, pageSize: 1000 });
  const vendorById = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  const requests = useRecords('purchase_requests', {
    select: '*, purchase_request_items(*)', orderBy: 'date',
    filters: [['site_id', 'eq', siteFilter], ['status', 'in', tabDef.statuses ?? ['submitted']]],
    enabled: !!tabDef.statuses,
  });
  // Deliveries the site has confirmed and the office has not checked yet.
  const pendingGrns = useRecords('goods_receipts', {
    select: '*, purchase_orders(doc_no), vendors(name), purchase_requests(doc_no)', orderBy: 'date', pageSize: 500,
    filters: [['site_id', 'eq', siteFilter], ['status', 'eq', 'submitted']],
  });
  const visible = tab === 'order'
    ? requests.rows.filter((r) => r.status === 'approved' || (r.purchase_request_items ?? []).some((i) => remainingToOrder(i) > 0))
    : requests.rows;
  const open = requests.rows.find((r) => r.id === openId) ?? null;

  return (
    <div>
      <SectionHeader title="Procurement" subtitle="Approve, get quotes, compare, order, and track delivery" icon={MODULE.icon} accent={MODULE.accent} />
      <LockBanner locked={!!locks.procurement} readOnly={!canEdit('procurement') && !locks.procurement} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} accent={MODULE.accent} />

      {pendingGrns.rows.length > 0 && tab !== 'accept' && (
        <Banner tone="amber">
          {pendingGrns.rows.length === 1 ? '1 delivery is' : `${pendingGrns.rows.length} deliveries are`} waiting for you to accept.
          Nothing counts as received until you do — open “Deliveries to accept”.
        </Banner>
      )}

      {tab === 'pos' ? (
        <PurchaseOrders vendorById={vendorById} editable={editable} onPrint={setPrintPo} />
      ) : tab === 'accept' ? (
        <DeliveriesToAccept grns={pendingGrns} editable={editable} siteName={siteName}
          onDecided={() => { pendingGrns.reload(); requests.reload(); }} />
      ) : requests.loading ? <Loading /> : visible.length === 0 ? (
        <Card><EmptyState label="Nothing here right now." /></Card>
      ) : (
        <div className="space-y-3">
          {requests.error && <Banner tone="red">{requests.error}</Banner>}
          {visible.map((r) => (
            <RequestCard key={r.id} r={r} siteName={siteName} receipts={pendingGrns.rows} onOpen={() => setOpenId(r.id)}
              actions={<Btn variant="subtle" className="!py-1.5 !px-3 !text-xs" onClick={() => setOpenId(r.id)}>Open</Btn>} />
          ))}
          <LoadMore hasMore={requests.hasMore} onClick={requests.loadMore} />
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpenId(null)} wide accent={MODULE.accent} title={open ? `${open.doc_no} · ${siteName(open.site_id)}` : ''}>
        {open && (
          <RequestDesk request={open} vendors={vendors} vendorById={vendorById} editable={editable}
            onChanged={() => { requests.reload(); pendingGrns.reload(); }} onPrint={(po) => { setPrintPo(po); setOpenId(null); }} />
        )}
      </Modal>

      {printPo && (
        <PurchaseOrderPrint po={printPo} vendor={vendorById[printPo.vendor_id]} requestDocNo={printPo.request_doc_no} onClose={() => setPrintPo(null)} />
      )}
    </div>
  );
}

/* ---------------------------- deliveries queue ---------------------------- */

/**
 * The office's acceptance queue: every delivery the site has confirmed with a
 * photo and nobody has checked yet. Accepting is what rolls the quantities into
 * the request and can mark it fulfilled.
 */
function DeliveriesToAccept({ grns, editable, siteName, onDecided }) {
  const [lightbox, setLightbox] = useState(null);
  if (grns.loading) return <Loading />;
  if (!grns.rows.length) {
    return <Card><EmptyState label="No deliveries waiting." hint="Confirmed deliveries land here for you to accept or reject." /></Card>;
  }
  return (
    <div className="space-y-3">
      {grns.error && <Banner tone="red">{grns.error}</Banner>}
      {!editable && <Banner tone="amber">You can see these, but only someone with Procurement edit rights can accept or reject them.</Banner>}
      {grns.rows.map((g) => (
        <Card key={g.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: THEME.panel2, color: MODULE.accent }}>{g.doc_no ?? '—'}</span>
              <span className="ml-2 font-semibold" style={{ fontFamily: 'Oswald' }}>{siteName(g.site_id)}</span>
              <div className="text-xs mt-1" style={{ color: THEME.textDim }}>
                {fmtDate(g.date)} · {g.vendors?.name ?? g.supplier_name ?? 'Supplier not noted'}
                {g.purchase_orders?.doc_no ? ` · against ${g.purchase_orders.doc_no}` : ' · no PO'}
                {g.purchase_requests?.doc_no ? ` · ${g.purchase_requests.doc_no}` : ''}
                {g.challan_ref ? ` · DC ${g.challan_ref}` : ''}{g.vehicle_no ? ` · ${g.vehicle_no}` : ''}
                {g.received_by_name ? ` · confirmed by ${g.received_by_name}` : ''}
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
                  {short > 0 && <Chip tone="amber">short {short}</Chip>}
                  {Number(l.qty_rejected) > 0 && <Chip tone="red">rejected {l.qty_rejected}{l.reason ? ` — ${l.reason}` : ''}</Chip>}
                </li>
              );
            })}
          </ul>
          {g.remarks && <div className="text-xs mt-2" style={{ color: THEME.textDim }}>{g.remarks}</div>}
          {g.photos?.length > 0 && <div className="mt-2"><PhotoStrip photos={g.photos} onOpen={setLightbox} /></div>}
          <div className="mt-3">
            <ReceiptDecision receipt={g} canDecide={editable}
              onDecide={async (patch) => { await grns.update(g.id, patch); onDecided(); }} />
          </div>
        </Card>
      ))}
      <LoadMore hasMore={grns.hasMore} onClick={grns.loadMore} />
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/* -------------------------------- request -------------------------------- */

function RequestDesk({ request, vendors, vendorById, editable, onChanged, onPrint }) {
  const { canEdit } = useAuth();
  const { siteName } = useAppData();
  const approver = canEdit('procurement_approve');
  const lines = [...(request.purchase_request_items ?? [])].sort((a, b) => a.sort - b.sort);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [poDraft, setPoDraft] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const quotes = useRecords('quotes', { filters: [['request_id', 'eq', request.id]], orderBy: 'received_at', ascending: true });
  const pos = useRecords('purchase_orders', { filters: [['request_id', 'eq', request.id]], orderBy: 'date', ascending: true });
  const receipts = useRecords('goods_receipts', {
    select: '*, purchase_orders(doc_no)', filters: [['request_id', 'eq', request.id]], orderBy: 'date', ascending: true,
  });
  const progress = requestProgress(request, receipts.rows);
  const cmp = comparative(lines, quotes.rows);
  const orderable = ['approved', 'ordered', 'partially_received'].includes(request.status);

  async function move(status, extra = {}) {
    setError(null);
    const { data, error: err } = await supabase.from('purchase_requests').update({ status, ...extra }).eq('id', request.id).select('id');
    if (err) setError(friendly(err));
    else if (!data?.length) setError('Not changed — you may not have permission for this step.');
    else onChanged();
  }

  function startPo(quote, vendorId = null) {
    const fromQuote = quote ? poLinesFromQuote(quote, lines) : lines.filter((l) => remainingToOrder(l) > 0).map((l) => ({
      request_item_id: l.id, item_id: l.item_id, description: l.description, size: l.size, unit: l.unit,
      qty: remainingToOrder(l), price: '', gst_pct: 18,
    }));
    setPoDraft({
      vendor_id: quote?.vendor_id ?? vendorId ?? '', quote_id: quote?.id ?? null, deliver_to_site_id: request.site_id,
      date: today(), items: fromQuote, terms: DEFAULT_TERMS,
    });
  }

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={REQUEST_STATUS_TONE[request.status]}>{REQUEST_STATUS_LABEL[request.status]}</Chip>
        <span className="text-xs" style={{ color: THEME.textDim }}>
          Raised {fmtDate(request.date)}{request.requested_by_name ? ` by ${request.requested_by_name}` : ''}
          {request.needed_by ? ` · needed by ${fmtDate(request.needed_by)}` : ''} · {request.priority} priority
          {request.fulfilled_on ? ` · fulfilled ${fmtDate(request.fulfilled_on)}` : ''}
        </span>
        <AuditButton table="purchase_requests" rowId={request.id} />
      </div>
      <RequestFlow progress={progress} />

      <TableWrap>
        <thead><tr style={{ background: THEME.panel2 }}>{['Item', 'Qty', 'Ordered', 'Received'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t" style={{ borderColor: THEME.border }}>
              <Td>{l.description}{l.size ? ` ${l.size}` : ''}{!l.item_id && <span className="ml-1"><Chip>not in catalogue</Chip></span>}</Td>
              <Td>{Number(l.qty)} {l.unit ?? ''}</Td>
              <Td>{Number(l.qty_ordered)}</Td>
              <Td><span style={{ color: Number(l.qty_received) >= Number(l.qty) ? THEME.green : THEME.text }}>{Number(l.qty_received)}</span></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {request.remarks && <div className="text-xs" style={{ color: THEME.textDim }}>{request.remarks}</div>}
      {request.photos?.length > 0 && <PhotoStrip photos={request.photos} onOpen={setLightbox} />}

      {request.status === 'submitted' && (
        approver ? (
          <div className="p-3 rounded-lg space-y-2" style={{ background: THEME.panel2 }}>
            <Input placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" icon={X} onClick={() => (note.trim() ? move('rejected', { decision_note: note }) : setError('Say why it is rejected, so site knows.'))}>Reject</Btn>
              <Btn accent={THEME.green} icon={Check} onClick={() => move('approved', { decision_note: note || null })}>Approve</Btn>
            </div>
          </div>
        ) : <Banner tone="amber">Waiting for an approver (Admin, or a role with "Approve Requests").</Banner>
      )}
      {error && <Banner tone="red">{error}</Banner>}

      {orderable && (
        <>
          <SubHeading className="mb-2" action={editable && !quoteOpen && (
            <Btn variant="subtle" icon={Plus} className="!py-1.5 !text-xs" onClick={() => setQuoteOpen(true)} disabled={!vendors.length}>Record quote</Btn>
          )}>QUOTES &amp; COMPARISON</SubHeading>
          {!vendors.length && <Banner tone="amber">Add vendors under Material → Vendors first.</Banner>}
          {quoteOpen && <QuoteForm request={request} lines={lines} vendors={vendors} onDone={() => { setQuoteOpen(false); quotes.reload(); }} onCancel={() => setQuoteOpen(false)} />}
          {quotes.rows.length === 0 ? (
            <div className="text-xs" style={{ color: THEME.textDim }}>No quotes yet. Call two or three vendors and type their prices in.</div>
          ) : (
            <TableWrap>
              <thead>
                <tr style={{ background: THEME.panel2 }}>
                  <Th>Item</Th>
                  {quotes.rows.map((q) => (
                    <Th key={q.id}>
                      <div>{vendorById[q.vendor_id]?.name ?? 'Vendor'}</div>
                      <div className="text-[10px] font-normal">{q.lead_days ? `${q.lead_days} d lead` : ''}{q.valid_until ? ` · valid ${fmtDate(q.valid_until)}` : ''}</div>
                      {cmp.bestQuoteId === q.id && <Chip tone="green">Best total</Chip>}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((row) => (
                  <tr key={row.item.id} className="border-t" style={{ borderColor: THEME.border }}>
                    <Td>{itemLabel(row.item)}</Td>
                    {quotes.rows.map((q) => {
                      const c = row.cells[q.id];
                      return (
                        <Td key={q.id}>
                          {c ? (
                            <span style={{ color: c.lowest ? THEME.green : THEME.text, fontWeight: c.lowest ? 600 : 400 }}>
                              {inr(c.price)} <span className="text-[10px]" style={{ color: THEME.textDim }}>+{c.gst_pct}%</span>
                              <span className="block text-[11px]" style={{ color: THEME.textDim }}>{inr(c.amount)}</span>
                            </span>
                          ) : <span style={{ color: THEME.textDim }}>—</span>}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t" style={{ borderColor: THEME.border, background: THEME.panel2 }}>
                  <Td><b>Total incl. GST</b></Td>
                  {quotes.rows.map((q) => (
                    <Td key={q.id}>
                      <b>{inr(cmp.totals[q.id].total)}</b>
                      {!cmp.totals[q.id].complete && <span className="block text-[10px]" style={{ color: THEME.amber }}>{cmp.totals[q.id].covered}/{lines.length} items</span>}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {editable && <Btn className="!py-1 !px-2 !text-[11px]" accent={MODULE.accent} onClick={() => startPo(q)}>Order from this</Btn>}
                        {q.attachments?.length > 0 && <PhotoStrip photos={q.attachments} onOpen={setLightbox} size={28} />}
                        {editable && <DeleteBtn onDelete={() => supabase.from('quotes').delete().eq('id', q.id).then(({ error: e }) => (e ? setError(friendly(e)) : quotes.reload()))} label="this quote" />}
                      </div>
                    </Td>
                  ))}
                </tr>
              </tbody>
            </TableWrap>
          )}
          {editable && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span style={{ color: THEME.textDim }}>No quote needed?</span>
              <Select placeholder="Order directly from…" style={{ maxWidth: 240 }} value="" onChange={(e) => e.target.value && startPo(null, e.target.value)}
                options={vendors.filter((v) => v.active !== false).map((v) => ({ value: v.id, label: v.name }))} />
            </div>
          )}
        </>
      )}

      <SubHeading className="mb-2">PURCHASE ORDERS</SubHeading>
      {pos.rows.length === 0 ? <div className="text-xs" style={{ color: THEME.textDim }}>None yet.</div> : (
        <div className="space-y-2">
          {pos.rows.map((po) => (
            <PoRow key={po.id} po={po} vendor={vendorById[po.vendor_id]} siteName={siteName} editable={editable}
              onChanged={() => { pos.reload(); onChanged(); }} onPrint={() => onPrint({ ...po, request_doc_no: request.doc_no })} />
          ))}
        </div>
      )}

      {(receipts.rows.length > 0 || ['ordered', 'partially_received', 'received'].includes(request.status)) && (
        <>
          <SubHeading className="mb-2">DELIVERIES</SubHeading>
          {receipts.rows.length === 0 ? (
            <div className="text-xs" style={{ color: THEME.textDim }}>Site has not confirmed any delivery yet.</div>
          ) : (
            <div className="space-y-2">
              {receipts.rows.map((g) => (
                <Card key={g.id} className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: THEME.panel2, color: MODULE.accent }}>{g.doc_no ?? 'GRN'}</span>
                      <span className="text-xs ml-2" style={{ color: THEME.textDim }}>
                        {fmtDate(g.date)}{g.purchase_orders?.doc_no ? ` · against ${g.purchase_orders.doc_no}` : ''}
                        {g.received_by_name ? ` · confirmed by ${g.received_by_name}` : ''}
                      </span>
                      <div className="text-xs mt-1">{(g.items ?? []).map((l) => `${l.description}${l.size ? ` ${l.size}` : ''} × ${Number(l.qty_received) || 0}`).join(', ')}</div>
                    </div>
                    {g.photos?.length > 0 && <PhotoStrip photos={g.photos} onOpen={setLightbox} size={40} />}
                  </div>
                  <div className="mt-2">
                    <ReceiptDecision receipt={g} canDecide={editable}
                      onDecide={async (patch) => { await receipts.update(g.id, patch); onChanged(); }} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {editable && canMove(request.status, 'closed') && request.status !== 'submitted' && (
        <div className="flex justify-end gap-2 pt-2">
          {canMove(request.status, 'cancelled') && <Btn variant="ghost" icon={Ban} onClick={() => window.confirm('Cancel this request?') && move('cancelled')}>Cancel request</Btn>}
          <Btn variant="subtle" onClick={() => move('closed')}>Close request</Btn>
        </div>
      )}

      <Modal open={!!poDraft} onClose={() => setPoDraft(null)} wide accent={MODULE.accent} title="New purchase order">
        {poDraft && (
          <PoEditor draft={poDraft} request={request} vendors={vendors}
            onDone={(po) => { setPoDraft(null); pos.reload(); onChanged(); if (po) onPrint({ ...po, request_doc_no: request.doc_no }); }}
            onCancel={() => setPoDraft(null)} />
        )}
      </Modal>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function QuoteForm({ request, lines, vendors, onDone, onCancel }) {
  const [vendorId, setVendorId] = useState('');
  const [prices, setPrices] = useState(() => Object.fromEntries(lines.map((l) => [l.id, { price: '', gst_pct: '18' }])));
  const [meta, setMeta] = useState({ lead_days: '', valid_until: '', notes: '', attachments: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const priced = lines.filter((l) => prices[l.id].price !== '').map((l) => ({ request_item_id: l.id, qty: l.qty, price: Number(prices[l.id].price), gst_pct: Number(prices[l.id].gst_pct) || 0 }));
  const t = lineTotals(priced);

  async function save(e) {
    e.preventDefault();
    if (!vendorId) { setError('Choose the vendor.'); return; }
    if (!priced.length) { setError('Enter at least one price.'); return; }
    setSaving(true);
    const { error: err } = await supabase.from('quotes').insert({
      request_id: request.id, vendor_id: vendorId,
      items: priced.map(({ request_item_id, price, gst_pct }) => ({ request_item_id, price, gst_pct })),
      subtotal: t.subtotal, gst: t.gst, total: t.total,
      lead_days: meta.lead_days ? Number(meta.lead_days) : null, valid_until: meta.valid_until || null,
      notes: meta.notes || null, attachments: meta.attachments,
    });
    setSaving(false);
    if (err) setError(friendly(err));
    else onDone();
  }

  return (
    <form onSubmit={save} className="p-3 rounded-lg space-y-3" style={{ border: `1px solid ${THEME.border}` }}>
      <Field label="Vendor" required>
        <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} options={vendors.filter((v) => v.active !== false).map((v) => ({ value: v.id, label: v.name }))} />
      </Field>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-12 sm:col-span-6 text-xs">{itemLabel(l)}</div>
            <div className="col-span-7 sm:col-span-4">
              <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Rate per unit (₹)" value={prices[l.id].price}
                onChange={(e) => setPrices((p) => ({ ...p, [l.id]: { ...p[l.id], price: e.target.value } }))} />
            </div>
            <div className="col-span-5 sm:col-span-2">
              <Select placeholder={null} value={prices[l.id].gst_pct} options={['0', '5', '12', '18', '28'].map((g) => ({ value: g, label: `GST ${g}%` }))}
                onChange={(e) => setPrices((p) => ({ ...p, [l.id]: { ...p[l.id], gst_pct: e.target.value } }))} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Lead time (days)"><Input type="number" min="0" value={meta.lead_days} onChange={(e) => setMeta((m) => ({ ...m, lead_days: e.target.value }))} /></Field>
        <Field label="Valid until"><Input type="date" value={meta.valid_until} onChange={(e) => setMeta((m) => ({ ...m, valid_until: e.target.value }))} /></Field>
        <Field label="Notes" full><Input value={meta.notes} onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))} placeholder="Make, freight, payment terms…" /></Field>
        <Field label="Quote copy (photo / PDF)" full>
          <PhotoInput value={meta.attachments} onChange={(v) => setMeta((m) => ({ ...m, attachments: v }))} folder="quotes" accept="image/*,application/pdf" max={3} camera={false} label="Attach" />
        </Field>
      </div>
      <div className="text-sm">Total {inr(t.subtotal)} + GST {inr(t.gst)} = <b>{inr(t.total)}</b></div>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save quote'}</Btn>
      </div>
    </form>
  );
}

function PoEditor({ draft, request, vendors, onDone, onCancel }) {
  const { activeSites } = useAppData();
  const [po, setPo] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const t = lineTotals(po.items);
  const setLine = (i, k, v) => setPo((p) => ({ ...p, items: p.items.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)) }));

  async function save(status) {
    if (!po.vendor_id) { setError('Choose the vendor.'); return; }
    const items = po.items.filter((l) => Number(l.qty) > 0).map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price) || 0, gst_pct: Number(l.gst_pct) || 0 }));
    if (!items.length) { setError('Nothing left to order.'); return; }
    if (items.some((l) => !(l.price > 0))) { setError('Enter a rate for every line.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: docNo, error: e1 } = await supabase.rpc('next_doc_no', { p_prefix: 'PO' });
      if (e1) throw new Error(friendly(e1));
      const { data, error: e2 } = await supabase.from('purchase_orders').insert({
        doc_no: docNo, date: po.date, request_id: request.id, vendor_id: po.vendor_id, quote_id: po.quote_id,
        deliver_to_site_id: po.deliver_to_site_id, items, ...lineTotals(items), terms: po.terms || null,
        status, sent_at: status === 'sent' ? new Date().toISOString() : null,
      }).select().single();
      if (e2) throw new Error(friendly(e2));
      onDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Vendor" required>
          <Select value={po.vendor_id} onChange={(e) => setPo((p) => ({ ...p, vendor_id: e.target.value }))} options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
        </Field>
        <Field label="Deliver to">
          <SiteSelect sites={activeSites} value={po.deliver_to_site_id ?? ''} onChange={(e) => setPo((p) => ({ ...p, deliver_to_site_id: e.target.value || null }))} />
        </Field>
        <Field label="PO date"><Input type="date" value={po.date} onChange={(e) => setPo((p) => ({ ...p, date: e.target.value }))} /></Field>
      </div>
      <div className="space-y-2">
        {po.items.map((l, i) => (
          <div key={l.request_item_id ?? i} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg" style={{ background: THEME.panel2 }}>
            <div className="col-span-12 sm:col-span-5 text-xs">{l.description}{l.size ? ` ${l.size}` : ''}</div>
            <div className="col-span-4 sm:col-span-2"><Input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} aria-label="Qty" /></div>
            <div className="col-span-4 sm:col-span-3"><Input type="number" min="0" step="0.01" placeholder="Rate" value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} aria-label="Rate" /></div>
            <div className="col-span-4 sm:col-span-2"><Input type="number" min="0" value={l.gst_pct} onChange={(e) => setLine(i, 'gst_pct', e.target.value)} aria-label="GST %" /></div>
          </div>
        ))}
      </div>
      <Field label="Terms"><TextArea rows={2} value={po.terms} onChange={(e) => setPo((p) => ({ ...p, terms: e.target.value }))} /></Field>
      <div>Subtotal {inr(t.subtotal)} + GST {inr(t.gst)} = <b>{inr(t.total)}</b></div>
      <FormError error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Btn variant="subtle" onClick={onCancel}>Cancel</Btn>
        <Btn variant="ghost" disabled={saving} onClick={() => save('draft')}>Save as draft</Btn>
        <Btn accent={MODULE.accent} icon={Send} disabled={saving} onClick={() => save('sent')}>{saving ? 'Saving…' : 'Create & print'}</Btn>
      </div>
    </div>
  );
}

function PoRow({ po, vendor, siteName, editable, onChanged, onPrint }) {
  const [error, setError] = useState(null);
  async function set(status) {
    const { error: err } = await supabase.from('purchase_orders').update({ status, ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}) }).eq('id', po.id);
    if (err) setError(friendly(err));
    else onChanged();
  }
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: THEME.panel2, color: MODULE.accent }}>{po.doc_no}</span>
          <span className="ml-2 font-medium">{vendor?.name ?? 'Vendor'}</span>
          <span className="text-xs ml-2" style={{ color: THEME.textDim }}>{fmtDate(po.date)} · to {siteName(po.deliver_to_site_id)} · {inr(po.total)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Chip tone={po.status === 'received' ? 'green' : po.status === 'cancelled' ? 'dim' : po.status === 'draft' ? 'amber' : 'blue'}>{PO_STATUS_LABEL[po.status]}</Chip>
          <Btn variant="ghost" icon={Printer} className="!py-1 !px-2 !text-xs" onClick={onPrint}>Print</Btn>
          {editable && po.status === 'draft' && <Btn variant="subtle" icon={Send} className="!py-1 !px-2 !text-xs" onClick={() => set('sent')}>Mark sent</Btn>}
          {editable && ['draft', 'sent'].includes(po.status) && <Btn variant="ghost" icon={Ban} className="!py-1 !px-2 !text-xs" onClick={() => window.confirm(`Cancel ${po.doc_no}?`) && set('cancelled')}>Cancel</Btn>}
          <AuditButton table="purchase_orders" rowId={po.id} />
        </div>
      </div>
      {error && <div className="text-xs mt-1" style={{ color: THEME.red }}>{error}</div>}
    </Card>
  );
}

function PurchaseOrders({ vendorById, editable, onPrint }) {
  const { siteFilter, siteName } = useAppData();
  const { rows, loading, reload, hasMore, loadMore } = useRecords('purchase_orders', {
    select: '*, purchase_requests(doc_no)', orderBy: 'date', filters: [['deliver_to_site_id', 'eq', siteFilter]],
  });
  if (loading) return <Loading />;
  if (!rows.length) return <Card><EmptyState label="No purchase orders yet." hint="Open an approved request to raise one." /></Card>;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Btn variant="ghost" icon={FileSpreadsheet} onClick={() => exportCSV('purchase_orders.csv', [
          { key: 'doc_no', label: 'PO' }, { key: 'date', label: 'Date' },
          { key: 'vendor', label: 'Vendor', value: (r) => vendorById[r.vendor_id]?.name ?? '' },
          { key: 'site', label: 'Deliver to', value: (r) => siteName(r.deliver_to_site_id) },
          { key: 'request', label: 'Request', value: (r) => r.purchase_requests?.doc_no ?? '' },
          { key: 'subtotal', label: 'Subtotal' }, { key: 'gst', label: 'GST' }, { key: 'total', label: 'Total' }, { key: 'status', label: 'Status' },
        ], rows)}>Export</Btn>
      </div>
      {rows.map((po) => (
        <PoRow key={po.id} po={po} vendor={vendorById[po.vendor_id]} siteName={siteName} editable={editable} onChanged={reload}
          onPrint={() => onPrint({ ...po, request_doc_no: po.purchase_requests?.doc_no })} />
      ))}
      <LoadMore hasMore={hasMore} onClick={loadMore} />
    </div>
  );
}
