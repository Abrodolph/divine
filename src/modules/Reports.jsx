import { useEffect, useMemo, useState } from 'react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { fmtDate, inr, thisMonth, today } from '../lib/format';
import { monthEnd } from '../lib/dates';
import { labourCostBySite } from '../lib/payroll';
import { REQUEST_STATUS_LABEL } from '../lib/procurement';
import { fetchAll } from '../lib/fetchAll';
import { usePayrollInputs } from '../hooks/usePayrollInputs';
import { useRecords } from '../hooks/useRecords';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import {
  SectionHeader, Card, EmptyState, Loading, Tabs, TableWrap, Th, Td, ToolbarInput, ExportButton, Select, Field, Banner,
} from '../components/ui';

const MODULE = moduleByKey('reports');

export default function Reports() {
  const { canView } = useAuth();
  const buying = canView('procurement');
  const [tab, setTab] = useState('labour');
  return (
    <div>
      <SectionHeader title="Reports" subtitle="What each site costs, and where the money goes" icon={MODULE.icon} accent={MODULE.accent} />
      <Tabs value={tab} onChange={setTab} accent={MODULE.accent} tabs={[
        { value: 'labour', label: 'Labour cost by site' },
        { value: 'attendance', label: 'Attendance summary' },
        ...(buying ? [
          { value: 'spend', label: 'Vendor spend' },
          { value: 'ageing', label: 'Open requests ageing' },
          { value: 'prices', label: 'Price history' },
        ] : []),
      ]} />
      {tab === 'labour' && <LabourCost />}
      {tab === 'attendance' && <AttendanceSummary />}
      {tab === 'spend' && <VendorSpend />}
      {tab === 'ageing' && <Ageing />}
      {tab === 'prices' && <PriceHistory />}
    </div>
  );
}

function LabourCost() {
  const { sites, employees, rules } = useAppData();
  const [month, setMonth] = useState(thisMonth());
  const inputs = usePayrollInputs({ month });
  const rows = useMemo(() => labourCostBySite({
    sites, employees, rates: inputs.rates, entries: inputs.entries, advances: [], adjustments: inputs.adjustments,
    payments: [], workingDays: inputs.workingDays, rules, month, asOf: monthEnd(month),
  }).filter((r) => r.worker_days > 0), [sites, employees, inputs, rules, month]);
  const total = rows.reduce((t, r) => ({ days: t.days + r.worker_days, gross: t.gross + r.gross }), { days: 0, gross: 0 });

  return (
    <>
      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <ToolbarInput label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
        <ExportButton filename={`labour_cost_${month}.csv`} rows={rows} columns={[
          { key: 'name', label: 'Site' }, { key: 'workers', label: 'Workers' }, { key: 'worker_days', label: 'Worker-days' },
          { key: 'gross', label: 'Wages (gross)' }, { key: 'per_day', label: 'Cost per worker-day' },
        ]} />
      </Card>
      <p className="text-xs mb-3" style={{ color: THEME.textDim }}>
        Wages earned from attendance at each site (before advances), using the same payroll engine as salaries. Use cost per worker-day when pricing the next job.
      </p>
      {inputs.loading ? <Loading /> : rows.length === 0 ? <Card><EmptyState label="No attendance this month." /></Card> : (
        <TableWrap>
          <thead><tr style={{ background: THEME.panel2 }}>{['Site', 'Workers', 'Worker-days', 'Wages', 'Per worker-day'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.site_id} className="border-t" style={{ borderColor: THEME.border }}>
                <Td>{r.name}</Td><Td>{r.workers}</Td><Td>{r.worker_days}</Td><Td>{inr(r.gross)}</Td><Td>{inr(r.per_day)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: THEME.panel2 }}>
              <td className="px-3 py-2.5 font-semibold" colSpan={2}>Total</td>
              <td className="px-3 py-2.5 font-semibold">{total.days}</td>
              <td className="px-3 py-2.5 font-semibold">{inr(total.gross)}</td>
              <td className="px-3 py-2.5">{total.days ? inr(Math.round(total.gross / total.days)) : '—'}</td>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </>
  );
}

function AttendanceSummary() {
  const { sites } = useAppData();
  const [month, setMonth] = useState(thisMonth());
  const inputs = usePayrollInputs({ month });
  const rows = useMemo(() => sites.map((s) => {
    const mine = inputs.entries.filter((e) => e.site_id === s.id);
    const dates = new Set(mine.map((e) => e.date));
    const workerDays = mine.reduce((n, e) => n + (Number(e.units) || 0), 0);
    return {
      site_id: s.id, name: s.name, days_marked: dates.size, worker_days: workerDays,
      avg_head: dates.size ? Math.round((workerDays / dates.size) * 10) / 10 : 0,
      ot: mine.reduce((n, e) => n + (Number(e.ot_hours) || 0), 0),
      absent: mine.filter((e) => e.status === 'absent').length,
      unverified_flags: mine.filter((e) => (e.flags ?? []).length && !e.verified_at).length,
    };
  }).filter((r) => r.days_marked > 0), [sites, inputs.entries]);

  return (
    <>
      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <ToolbarInput label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
        <ExportButton filename={`attendance_summary_${month}.csv`} rows={rows} columns={[
          { key: 'name', label: 'Site' }, { key: 'days_marked', label: 'Days marked' }, { key: 'worker_days', label: 'Worker-days' },
          { key: 'avg_head', label: 'Avg headcount' }, { key: 'ot', label: 'OT hours' }, { key: 'absent', label: 'Absent entries' },
          { key: 'unverified_flags', label: 'Flags not verified' },
        ]} />
      </Card>
      {inputs.loading ? <Loading /> : rows.length === 0 ? <Card><EmptyState label="No attendance this month." /></Card> : (
        <TableWrap>
          <thead><tr style={{ background: THEME.panel2 }}>{['Site', 'Days marked', 'Worker-days', 'Avg headcount', 'OT h', 'Absent', 'Flags open'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.site_id} className="border-t" style={{ borderColor: THEME.border }}>
                <Td>{r.name}</Td><Td>{r.days_marked}</Td><Td>{r.worker_days}</Td><Td>{r.avg_head}</Td><Td>{r.ot}</Td><Td>{r.absent}</Td>
                <Td><span style={{ color: r.unverified_flags ? THEME.amber : THEME.textDim }}>{r.unverified_flags}</span></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

function VendorSpend() {
  const [from, setFrom] = useState(`${thisMonth().slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth());
  const [pos, setPos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setPos(null);
    fetchAll(() => supabase.from('purchase_orders').select('vendor_id,total,date,status,vendors(name)')
      .neq('status', 'cancelled').gte('date', `${from}-01`).lte('date', monthEnd(to)))
      .then((d) => alive && setPos(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [from, to]);

  const rows = useMemo(() => {
    const m = new Map();
    (pos ?? []).forEach((p) => {
      const r = m.get(p.vendor_id) ?? { vendor_id: p.vendor_id, name: p.vendors?.name ?? '—', orders: 0, total: 0 };
      r.orders += 1;
      r.total += Number(p.total) || 0;
      m.set(p.vendor_id, r);
    });
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [pos]);

  return (
    <>
      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <ToolbarInput label="From" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        <ToolbarInput label="To" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
        <ExportButton filename="vendor_spend.csv" rows={rows} columns={[{ key: 'name', label: 'Vendor' }, { key: 'orders', label: 'POs' }, { key: 'total', label: 'Total incl. GST' }]} />
      </Card>
      {error && <Banner tone="red">{error}</Banner>}
      {!pos ? <Loading /> : rows.length === 0 ? <Card><EmptyState label="No purchase orders in this range." /></Card> : (
        <TableWrap>
          <thead><tr style={{ background: THEME.panel2 }}>{['Vendor', 'POs', 'Total incl. GST'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vendor_id} className="border-t" style={{ borderColor: THEME.border }}><Td>{r.name}</Td><Td>{r.orders}</Td><Td>{inr(r.total)}</Td></tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

function Ageing() {
  const { siteName, siteFilter } = useAppData();
  const { rows, loading } = useRecords('purchase_requests', {
    select: 'id,doc_no,date,needed_by,status,priority,site_id,purchase_request_items(description)', orderBy: 'date', ascending: true,
    filters: [['status', 'in', ['submitted', 'approved', 'ordered', 'partially_received']], ['site_id', 'eq', siteFilter]], pageSize: 500,
  });
  const age = (d) => Math.round((new Date(`${today()}T00:00:00`) - new Date(`${d}T00:00:00`)) / 86400000);
  const data = rows.map((r) => ({ ...r, age: age(r.date), items: (r.purchase_request_items ?? []).map((i) => i.description).join(', ') }));
  if (loading) return <Loading />;
  if (!data.length) return <Card><EmptyState label="No open requests." /></Card>;
  return (
    <>
      <div className="flex justify-end mb-3">
        <ExportButton filename="open_requests.csv" rows={data} columns={[
          { key: 'doc_no', label: 'Request' }, { key: 'site', label: 'Site', value: (r) => siteName(r.site_id) }, { key: 'date', label: 'Raised' },
          { key: 'age', label: 'Days open' }, { key: 'status', label: 'Status', value: (r) => REQUEST_STATUS_LABEL[r.status] }, { key: 'items', label: 'Items' },
        ]} />
      </div>
      <TableWrap>
        <thead><tr style={{ background: THEME.panel2 }}>{['Request', 'Site', 'Items', 'Raised', 'Days open', 'Status'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: THEME.border }}>
              <Td>{r.doc_no}</Td><Td>{siteName(r.site_id)}</Td><Td>{r.items}</Td><Td>{fmtDate(r.date)}</Td>
              <Td><b style={{ color: r.age > 7 ? THEME.red : r.age > 3 ? THEME.amber : THEME.text }}>{r.age}</b></Td>
              <Td>{REQUEST_STATUS_LABEL[r.status]}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}

function PriceHistory() {
  const { rows: items } = useRecords('items', { orderBy: 'name', ascending: true, pageSize: 2000 });
  const [itemId, setItemId] = useState('');
  const { rows, loading } = useRecords('price_history', {
    select: '*, vendors(name)', orderBy: 'recorded_at', filters: [['item_id', 'eq', itemId]], enabled: !!itemId, pageSize: 300,
  });
  const prices = rows.map((r) => Number(r.price));
  return (
    <>
      <Card className="p-4 mb-4">
        <Field label="Item">
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)} options={items.map((i) => ({ value: i.id, label: i.name }))} />
        </Field>
      </Card>
      {!itemId ? <Card><EmptyState label="Pick an item to see what you've paid and been quoted." /></Card> : loading ? <Loading /> : rows.length === 0 ? (
        <Card><EmptyState label="No prices recorded for this item yet." hint="Prices are captured from quotes and purchase orders." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[['Lowest', Math.min(...prices)], ['Highest', Math.max(...prices)], ['Latest', prices[0]]].map(([l, v]) => (
              <Card key={l} className="p-3"><div className="text-xs" style={{ color: THEME.textDim }}>{l}</div><div className="text-xl" style={{ fontFamily: 'Oswald' }}>{inr(v)}</div></Card>
            ))}
          </div>
          <TableWrap>
            <thead><tr style={{ background: THEME.panel2 }}>{['Date', 'Vendor', 'Size', 'Price', 'From'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: THEME.border }}>
                  <Td>{fmtDate(r.recorded_at)}</Td><Td>{r.vendors?.name ?? '—'}</Td><Td>{r.size || '—'}</Td><Td>{inr(r.price)}</Td><Td>{r.source === 'po' ? 'Purchase order' : 'Quote'}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}
    </>
  );
}
