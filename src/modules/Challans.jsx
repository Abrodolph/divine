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
import { SampleNotice } from '../components/Print';
import {
  SectionHeader, LockBanner, EmptyState, Loading, Card, Field, Input, TextArea, Select,
  SiteSelect, DeleteBtn, ExportButton, FormShell, Btn, LoadMore, Chip, SubHeading,
} from '../components/ui';

const MODULE = moduleByKey('challans');

const KINDS = [
  { value: 'material', label: 'Material transfer' },
  { value: 'tools', label: 'Tools & tackles transfer' },
];
const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label ?? KINDS[0].label;
const kindHeading = (k) => (k === 'tools' ? 'TOOLS & TACKLES TRANSFER' : 'MATERIAL TRANSFER');

/** The challan fields a site carries, and where they come from on the site row. */
const FROM_SITE = {
  party: 'client_name',
  party_address: 'client_address',
  party_gstin: 'client_gstin',
  ship_to_name: 'ship_to_name',
  ship_to_address: 'ship_to_address',
  ship_to_gstin: 'ship_to_gstin',
  po_no: 'po_no',
  purpose: 'work_purpose',
};

export default function Challans() {
  const { activeSites, siteName, siteFilter, site } = useAppData();
  const { canEdit, canChangeRow, locks } = useAuth();
  const { rows, loading, add, remove, hasMore, loadMore } = useRecords('challans', {
    orderBy: 'date', filters: [['site_id', 'eq', siteFilter]],
  });

  const blank = {
    date: today(), site_id: siteFilter || '', kind: 'material',
    party: '', party_address: '', party_gstin: '',
    ship_to_name: '', ship_to_address: '', ship_to_gstin: '',
    po_no: '', purpose: '',
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

  /**
   * Picking a site pulls in that site's standing challan details. A field the
   * user has typed into is left alone; one still holding the previous site's
   * value is replaced. The challan keeps its own copy once saved.
   */
  function chooseSite(id) {
    setForm((p) => {
      const was = site(p.site_id);
      const now = site(id);
      const next = { ...p, site_id: id };
      Object.entries(FROM_SITE).forEach(([field, col]) => {
        const current = p[field] ?? '';
        const previous = (was?.[col] ?? '');
        if (current === '' || current === previous) next[field] = now?.[col] ?? '';
      });
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    const cleanItems = items
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name.trim(),
        make: (i.make ?? '').trim(),
        qty: i.qty,
        unit: i.unit,
      }));
    if (!form.site_id) { setError('Choose the dispatch site.'); return; }
    if (!cleanItems.length) { setError('Add at least one item.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: docNo, error: numErr } = await supabase.rpc('next_doc_no', { p_prefix: 'DC' });
      if (numErr) throw numErr;
      const rec = await add({ ...form, items: cleanItems, doc_no: docNo });
      setForm({ ...blank, site_id: form.site_id });
      chooseSite(form.site_id);
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
    { key: 'kind', label: 'Type', value: (r) => kindLabel(r.kind) },
    { key: 'site_id', label: 'Dispatch From', value: (r) => siteName(r.site_id) },
    { key: 'party', label: 'Bill To' },
    { key: 'party_address', label: 'Bill To Address' },
    { key: 'party_gstin', label: 'Bill To GSTIN' },
    { key: 'ship_to_name', label: 'Ship To' },
    { key: 'ship_to_address', label: 'Ship To Address' },
    { key: 'ship_to_gstin', label: 'Ship To GSTIN' },
    { key: 'purpose', label: 'Purpose For' },
    { key: 'po_no', label: 'PO / Ref No.' },
    { key: 'vehicle_no', label: 'Vehicle No.' },
    { key: 'transporter_name', label: 'Transporter' },
    { key: 'driver_name', label: 'Driver' },
    { key: 'driver_phone', label: 'Driver Phone' },
    { key: 'items', label: 'Items', value: (r) => itemsSummary(r.items) },
    { key: 'remarks', label: 'Remarks' },
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
        <Field label="Dispatch from (site)" required
          hint="Picking a site fills in its Bill To, Ship To, PO and purpose. Every field stays editable — the challan stores its own copy, so correcting a site later never rewrites old paperwork.">
          <SiteSelect sites={activeSites} required value={form.site_id} onChange={(e) => chooseSite(e.target.value)} />
        </Field>
        <Field label="Date" required>
          <Input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="What is being transferred" required full
          hint="A tools & tackles challan prints the notice that the tools are not for sale and stay company property.">
          <Select placeholder={null} required value={form.kind} options={KINDS}
            onChange={(e) => set('kind', e.target.value)} />
        </Field>

        <div className="md:col-span-2"><SubHeading className="mt-2 mb-0">BILL TO</SubHeading></div>
        <Field label="Party name" full>
          <Input value={form.party} onChange={(e) => set('party', e.target.value)} placeholder="Who the work is billed to" />
        </Field>
        <Field label="Party address" full>
          <TextArea rows={2} value={form.party_address} onChange={(e) => set('party_address', e.target.value)} />
        </Field>
        <Field label="Party GSTIN">
          <Input value={form.party_gstin} onChange={(e) => set('party_gstin', e.target.value.toUpperCase())} placeholder="e.g. 09GTDPS9124P1ZP" />
        </Field>

        <div className="md:col-span-2"><SubHeading className="mt-2 mb-0">SHIP TO / PLACE OF SUPPLY</SubHeading></div>
        <Field label="Delivery name" full>
          <Input value={form.ship_to_name} onChange={(e) => set('ship_to_name', e.target.value)} placeholder="Where the material lands" />
        </Field>
        <Field label="Delivery address" full>
          <TextArea rows={2} value={form.ship_to_address} onChange={(e) => set('ship_to_address', e.target.value)} />
        </Field>
        <Field label="Delivery GSTIN" hint="Leave blank if there isn't one — the challan prints “N.A”.">
          <Input value={form.ship_to_gstin} onChange={(e) => set('ship_to_gstin', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Purpose for" hint="e.g. FIRE FIGHTING WORK">
          <Input value={form.purpose} onChange={(e) => set('purpose', e.target.value)} />
        </Field>

        <div className="md:col-span-2"><SubHeading className="mt-2 mb-0">DISPATCH</SubHeading></div>
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
        <ItemsEditor items={items} setItems={setItems} accent={MODULE.accent} showMake
          label="Materials / Items (description, make, qty, unit)" />
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{ background: THEME.panel2, color: MODULE.accent }}>
                      {r.doc_no ?? '—'}
                    </span>
                    {r.kind === 'tools' && <Chip tone="amber">Tools &amp; tackles</Chip>}
                  </div>
                  <div className="font-semibold mt-1.5" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
                    {siteName(r.site_id)} → {r.ship_to_name || r.party || '—'}
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
                {(r.items ?? []).map((it, i) => (
                  <li key={i}>• {it.name}{it.make ? ` (${it.make})` : ''} — {it.qty} {it.unit}</li>
                ))}
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

/** A value, or a ruled blank the office can fill in by hand. */
function Blank({ value, width = '9rem' }) {
  const text = value == null ? '' : String(value).trim();
  if (text) return <span>{text}</span>;
  return (
    <span className="inline-block border-b border-black align-bottom" style={{ minWidth: width, height: '1em' }} />
  );
}

function Labelled({ label, value, width }) {
  return <div><b>{label}</b> <Blank value={value} width={width} /></div>;
}

const MIN_ROWS = 8;

function ChallanPrint({ record, siteName }) {
  const { company: COMPANY } = useAppData();
  const items = record.items ?? [];
  const filler = Math.max(0, MIN_ROWS - items.length);
  const terms = String(COMPANY.challan_terms ?? '').split('\n').map((t) => t.trim()).filter(Boolean);
  const cell = 'border border-black px-2 py-1 align-top';

  return (
    <div className="print-area mt-6 p-5 sm:p-8 rounded-xl bg-white text-black">
      <div className="text-right text-[11px] font-semibold tracking-widest">ORIGINAL</div>

      <div className="text-center border-b-2 border-black pb-3">
        <div className="text-base sm:text-lg font-bold tracking-widest">DELIVERY CHALLAN</div>
        <div className="text-xl sm:text-2xl font-bold mt-1" style={{ fontFamily: 'Oswald' }}>{COMPANY.name}</div>
        <div className="text-xs font-semibold tracking-wide">{kindHeading(record.kind)}</div>
        {COMPANY.address && <div className="text-xs mt-1">{COMPANY.address}</div>}
        <div className="text-xs">
          {[COMPANY.email && `E-mail: ${COMPANY.email}`, COMPANY.phone && `Mobile: ${COMPANY.phone}`]
            .filter(Boolean).join(' · ')}
        </div>
        <div className="text-xs font-semibold mt-0.5">GSTIN: <Blank value={COMPANY.gstin} width="8rem" /></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 text-xs border-b border-black">
        <div className="p-2 sm:border-r border-black">
          <div className="font-bold uppercase tracking-wide mb-1">Bill To</div>
          <div className="font-semibold"><Blank value={record.party} width="12rem" /></div>
          <div className="whitespace-pre-line mt-0.5"><Blank value={record.party_address} width="12rem" /></div>
          <div className="mt-0.5">GSTIN: <Blank value={record.party_gstin} width="8rem" /></div>
        </div>
        <div className="p-2 border-t sm:border-t-0 border-black">
          <div className="font-bold uppercase tracking-wide mb-1">Ship To / Place of Supply</div>
          <div className="font-semibold"><Blank value={record.ship_to_name} width="12rem" /></div>
          <div className="whitespace-pre-line mt-0.5"><Blank value={record.ship_to_address} width="12rem" /></div>
          <div className="mt-0.5">GSTIN: {record.ship_to_gstin?.trim() ? record.ship_to_gstin : 'N.A'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs p-2 border-b border-black">
        <Labelled label="Delivery No.:" value={record.doc_no} width="6rem" />
        <Labelled label="DC Date:" value={record.date ? fmtDate(record.date) : ''} width="6rem" />
        <Labelled label="Vehicle No.:" value={record.vehicle_no} width="6rem" />
        <Labelled label="PO No.:" value={record.po_no} width="6rem" />
      </div>

      <div className="text-xs p-2 border-b border-black">
        <b>Purpose For:</b> <Blank value={record.purpose} width="14rem" />
        <span className="ml-4"><b>Dispatched From:</b> {siteName(record.site_id)}</span>
      </div>

      <table className="w-full text-xs border-collapse mt-3">
        <thead>
          <tr className="bg-gray-100">
            <th className={`${cell} text-left w-12`}>S.NO.</th>
            <th className={`${cell} text-left`}>DESCRIPTION</th>
            <th className={`${cell} text-left w-24`}>MAKE</th>
            <th className={`${cell} text-right w-20`}>QTY.</th>
            <th className={`${cell} text-left w-20`}>UNIT</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className={cell}>{i + 1}</td>
              <td className={cell}>{it.name ?? ''}</td>
              <td className={cell}>{it.make ?? ''}</td>
              <td className={`${cell} text-right`}>{it.qty ?? ''}</td>
              <td className={cell}>{it.unit ?? ''}</td>
            </tr>
          ))}
          {Array.from({ length: filler }, (_, i) => (
            <tr key={`blank-${i}`}>
              <td className={cell}>{items.length + i + 1}</td>
              <td className={cell}>&nbsp;</td>
              <td className={cell}>&nbsp;</td>
              <td className={cell}>&nbsp;</td>
              <td className={cell}>&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>

      {record.transporter_name || record.driver_name || record.driver_phone ? (
        <div className="text-xs mt-2">
          <b>Transporter:</b> {record.transporter_name || '—'} &nbsp;·&nbsp;
          <b>Driver:</b> {record.driver_name || '—'}
          {record.driver_phone ? ` (${record.driver_phone})` : ''}
        </div>
      ) : null}

      {record.remarks && <div className="text-xs mt-2"><b>Remarks:</b> {record.remarks}</div>}

      {record.kind === 'tools' && COMPANY.challan_tools_note && (
        <div className="text-xs mt-3 p-2 border border-black font-semibold">
          {COMPANY.challan_tools_note}
        </div>
      )}

      {terms.length > 0 && (
        <div className="text-[11px] mt-3">
          <div className="font-bold uppercase tracking-wide">Terms &amp; Conditions</div>
          <ol className="list-decimal ml-4 mt-0.5 space-y-0.5">
            {terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
      )}

      {COMPANY.challan_jurisdiction && (
        <div className="text-[11px] mt-2 font-semibold">
          Subject to {COMPANY.challan_jurisdiction} Jurisdiction
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-xs mt-10">
        <div>
          Received By:
          <div className="mt-8 border-t border-black w-52">Name / Signature &amp; Date</div>
        </div>
        <div className="text-right">
          <div className="font-semibold">{COMPANY.challan_footer || `For ${COMPANY.name}`}</div>
          <div className="mt-8 border-t border-black w-52 ml-auto">Authorised Signatory</div>
        </div>
      </div>

      <SampleNotice />

      <Btn className="no-print mt-6" accent="#111" style={{ background: '#111', color: '#fff' }}
        icon={Printer} onClick={() => window.print()}>
        Print / Save as PDF
      </Btn>
    </div>
  );
}
