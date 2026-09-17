import { useState } from 'react';
import { Printer } from 'lucide-react';
import { THEME } from '../lib/theme';
import { today, fmtDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import ItemsEditor, { emptyItems, itemsSummary } from '../components/ItemsEditor';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, TextArea,
  SiteSelect, DeleteBtn, ExportButton, FormShell, Btn, LoadMore,
} from '../components/ui';

const MODULE = moduleByKey('challans');

export default function Challans() {
  const { activeSites, siteName, siteFilter } = useAppData();
  const { canEdit, canChangeRow, locks } = useAuth();
  const { rows, loading, add, remove, hasMore, loadMore } = useRecords('challans', {
    orderBy: 'date', filters: [['site_id', 'eq', siteFilter]],
  });

  const blank = {
    date: today(), site_id: siteFilter || '', party: '', party_address: '', party_gstin: '', po_no: '',
    vehicle_no: '', transporter_name: '', driver_name: '', driver_phone: '', remarks: '',
  };
  const [form, setForm] = useState(blank);
  const [items, setItems] = useState(emptyItems());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [printId, setPrintId] = useState(null);

  const editable = canEdit('challans');
  const locked = !!locks.challans;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const visible = rows;
  const printRecord = rows.find((r) => r.id === printId);

  async function submit(e) {
    e.preventDefault();
    const cleanItems = items.filter((i) => i.name.trim());
    if (!form.site_id) { setError('Choose the dispatch site.'); return; }
    if (!cleanItems.length) { setError('Add at least one item.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: docNo, error: numErr } = await supabase.rpc('next_doc_no', { p_prefix: 'DC' });
      if (numErr) throw numErr;
      const rec = await add({ ...form, items: cleanItems, doc_no: docNo });
      setForm({ ...blank, site_id: form.site_id });
      setItems(emptyItems());
      setOpen(false);
      setPrintId(rec.id); // straight to the print view — that's why you made it
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const exportCols = [
    { key: 'doc_no', label: 'Challan No.' },
    { key: 'date', label: 'Date' },
    { key: 'site_id', label: 'Dispatch From', value: (r) => siteName(r.site_id) },
    { key: 'party', label: 'Consignee' },
    { key: 'party_gstin', label: 'Consignee GSTIN' },
    { key: 'po_no', label: 'PO / Ref No.' },
    { key: 'vehicle_no', label: 'Vehicle No.' },
    { key: 'transporter_name', label: 'Transporter' },
    { key: 'driver_name', label: 'Driver' },
    { key: 'driver_phone', label: 'Driver Phone' },
    { key: 'items', label: 'Items', value: (r) => itemsSummary(r.items) },
  ];

  return (
    <div>
      <SectionHeader
        title="Delivery Challan"
        subtitle="Generate, print and keep a record of material dispatches"
        icon={MODULE.icon}
        accent={MODULE.accent}
        action={<ExportButton filename="challans.csv" columns={exportCols} rows={visible} />}
      />

      <LockBanner locked={locked} readOnly={!editable && !locked} />

      <FormShell
        open={open}
        onToggle={() => { setOpen((o) => !o); setError(null); }}
        accent={MODULE.accent}
        label="New Challan"
        onSubmit={submit}
        saving={saving}
        error={error}
        disabled={!editable}
      >
        <Field label="Dispatch from (site)" required>
          <SiteSelect sites={activeSites} required value={form.site_id} onChange={(e) => set('site_id', e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Consignee / party" full>
          <Input value={form.party} onChange={(e) => set('party', e.target.value)} placeholder="Receiving site or client name" />
        </Field>
        <Field label="Consignee address" full>
          <TextArea rows={2} value={form.party_address} onChange={(e) => set('party_address', e.target.value)} />
        </Field>
        <Field label="Consignee GSTIN">
          <Input value={form.party_gstin} onChange={(e) => set('party_gstin', e.target.value.toUpperCase())} placeholder="e.g. 27ABCDE1234F1Z5" />
        </Field>
        <Field label="PO / reference no." hint="Client's purchase order or reference, if any.">
          <Input value={form.po_no} onChange={(e) => set('po_no', e.target.value)} />
        </Field>
        <Field label="Vehicle no.">
          <Input value={form.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value)} />
        </Field>
        <Field label="Transporter">
          <Input value={form.transporter_name} onChange={(e) => set('transporter_name', e.target.value)} />
        </Field>
        <Field label="Driver name">
          <Input value={form.driver_name} onChange={(e) => set('driver_name', e.target.value)} />
        </Field>
        <Field label="Driver phone">
          <Input type="tel" value={form.driver_phone} onChange={(e) => set('driver_phone', e.target.value)} />
        </Field>
        <ItemsEditor items={items} setItems={setItems} accent={MODULE.accent} />
        <Field label="Remarks" full>
          <TextArea rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </FormShell>

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Card><EmptyState label="No challans generated yet." /></Card>
      ) : (
        <div className="space-y-3 no-print">
          {visible.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: THEME.panel2, color: MODULE.accent }}>
                    {r.doc_no ?? '—'}
                  </span>
                  <div className="font-semibold mt-1.5" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                    {siteName(r.site_id)} → {r.party || '—'}
                  </div>
                  <div className="text-xs" style={{ color: THEME.textDim }}>
                    {fmtDate(r.date)} · {r.vehicle_no || 'no vehicle noted'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPrintId(printId === r.id ? null : r.id)}
                    className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5"
                    style={{ color: MODULE.accent }}
                  >
                    <Printer size={14} /> {printId === r.id ? 'Hide' : 'Print'}
                  </button>
                  {editable && !locked && canChangeRow(r) && <DeleteBtn onDelete={() => remove(r.id).catch((x) => setError(x.message))} />}
                </div>
              </div>
              <ul className="mt-3 text-sm space-y-1">
                {(r.items ?? []).map((it, i) => <li key={i}>• {it.name} — {it.qty} {it.unit}</li>)}
              </ul>
            </Card>
          ))}
          <LoadMore hasMore={hasMore} onClick={loadMore} />
        </div>
      )}

      {printRecord && <ChallanPrint record={printRecord} siteName={siteName} />}
      {error && <div className="text-xs mt-3" style={{ color: THEME.red }}>{error}</div>}
    </div>
  );
}

function ChallanPrint({ record, siteName }) {
  const { company: COMPANY } = useAppData();
  return (
    <div className="print-area mt-6 p-6 sm:p-8 rounded-xl bg-white text-black">
      <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-4 gap-4">
        <div>
          <div className="text-xl sm:text-2xl font-bold" style={{ fontFamily: 'Oswald' }}>{COMPANY.name}</div>
          <div className="text-xs">{COMPANY.tagline}</div>
          {COMPANY.address && <div className="text-xs mt-1">{COMPANY.address}</div>}
          {(COMPANY.phone || COMPANY.gstin) && (
            <div className="text-xs">
              {COMPANY.phone}{COMPANY.phone && COMPANY.gstin ? ' · ' : ''}
              {COMPANY.gstin && `GSTIN ${COMPANY.gstin}`}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base sm:text-lg font-bold">DELIVERY CHALLAN</div>
          <div className="text-sm font-mono">{record.doc_no}</div>
          <div className="text-xs mt-1"><b>Date:</b> {fmtDate(record.date)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        <div><b>Dispatch From:</b> {siteName(record.site_id)}</div>
        <div><b>PO / Ref No.:</b> {record.po_no || '—'}</div>
        <div><b>Consignee:</b> {record.party || '—'}</div>
        <div><b>Consignee GSTIN:</b> {record.party_gstin || '—'}</div>
        <div><b>Vehicle No.:</b> {record.vehicle_no || '—'}</div>
        <div><b>Transporter:</b> {record.transporter_name || '—'}</div>
        <div>
          <b>Driver:</b> {record.driver_name || '—'}
          {record.driver_phone ? ` (${record.driver_phone})` : ''}
        </div>
        {record.party_address && (
          <div className="sm:col-span-2"><b>Address:</b> {record.party_address}</div>
        )}
      </div>

      <table className="w-full text-sm border-collapse mb-6">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-1 w-10">#</th>
            <th className="text-left py-1">Item Description</th>
            <th className="text-right py-1 w-20">Qty</th>
            <th className="text-left py-1 pl-3 w-20">Unit</th>
          </tr>
        </thead>
        <tbody>
          {(record.items ?? []).map((it, i) => (
            <tr key={i} className="border-b border-gray-300">
              <td className="py-1">{i + 1}</td>
              <td className="py-1">{it.name}</td>
              <td className="py-1 text-right">{it.qty}</td>
              <td className="py-1 pl-3">{it.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {record.remarks && <div className="text-sm mb-6"><b>Remarks:</b> {record.remarks}</div>}

      <div className="grid grid-cols-2 gap-4 text-sm mt-12">
        <div>Prepared By: ______________________</div>
        <div>Received By: ______________________</div>
      </div>

      <Btn className="no-print mt-6" accent="#111" style={{ background: '#111', color: '#fff' }}
        icon={Printer} onClick={() => window.print()}>
        Print / Save as PDF
      </Btn>
    </div>
  );
}
