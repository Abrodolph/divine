// @vitest-environment jsdom
/**
 * Renders every screen against a fake Supabase that returns sample rows, as
 * an Admin, and fails on any render crash. It doesn't check behaviour — the
 * database tests and lib tests do that — it catches "undefined is not a
 * function" before a supervisor does.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const M = new Date().toISOString().slice(0, 7);
const D = `${M}-05`;
const FIXTURES = {
  sites: [{ id: 's1', name: 'Hospital', active: true, lat: 19.07, lng: 72.87, radius_m: 200, location: 'Pune' }, { id: 's2', name: 'Mall', active: false }],
  site_settings: [{ site_id: 's1', capture_mode: 'muster', shift_start: '09:00:00', grace_min: 15, weekly_off_day: 0 }],
  employees: [
    { id: 'e1', name: 'Ravi', trade: 'Fitter', site_id: 's1', wage_type: 'Daily', wage_rate: 700, active: true, aadhaar_last4: '9012', consent_at: '2026-09-01' },
    { id: 'e2', name: 'Sunil', site_id: null, wage_type: 'Monthly', wage_rate: 26000, active: true },
    { id: 'e3', name: 'Mohan', site_id: 's1', wage_type: 'Daily', wage_rate: 650, active: false, left_on: D },
  ],
  employee_rates: [{ id: 'r1', employee_id: 'e1', effective_from: '2000-01-01', wage_type: 'Daily', rate: 700 }],
  attendance_entries: [
    { id: 'a1', employee_id: 'e1', site_id: 's1', date: D, in_time: '09:40:00', out_time: '19:00:00', units: 1, status: 'present', ot_hours: 0.5, late_min: 40, flags: ['no_photo', 'outside_radius'], marked_at: new Date().toISOString(), source: 'muster', lat: 19, lng: 72, distance_m: 900 },
    { id: 'a2', employee_id: 'e2', site_id: 's1', date: D, units: 0, status: 'absent', flags: [], verified_at: '2026-09-06' },
  ],
  musters: [{ id: 'm1', site_id: 's1', date: D, group_photo: 'sb://private/org/attendance/x.jpg', photo_live: true, status: 'submitted', marked_at: new Date().toISOString(), marked_by_name: 'Sup', lat: 19, lng: 72, distance_m: 40 }],
  advances: [{ id: 'ad1', employee_id: 'e1', date: D, amount: 1000 }],
  salary_adjustments: [{ id: 'sa1', employee_id: 'e2', month: M, day_rate: 1200, days_present: null, ot_hours: 2, bonus: 500, penalty: 100, note: 'Raise' }],
  payroll_payments: [{ id: 'pp1', employee_id: 'e1', month: M, amount: 500, mode: 'upi', paid_on: D }],
  working_days: [{ id: 'w1', site_id: 's1', month: M, total_days: 26 }],
  payroll_runs: [{ id: 'run1', month: M, site_id: null, status: 'final', rows: [], totals: { net: 1000 }, generated_at: D, finalised_at: D }],
  items: [{ id: 'i1', name: 'M.S PIPE', category: 'Pipes', unit: 'MTR', sizes: ['50MM', '100MM'], active: true, last_price: 410 }],
  vendors: [{ id: 'v1', name: 'Shah Traders', active: true, categories: ['Pipes'] }],
  purchase_requests: [{
    id: 'pr1', doc_no: 'PR-0001-2026', site_id: 's1', date: D, needed_by: D, fulfilled_on: D, priority: 'High', status: 'approved', requested_by_name: 'Sup',
    photos: [], purchase_request_items: [{ id: 'pri1', item_id: 'i1', description: 'M.S PIPE', size: '100MM', qty: 30, unit: 'MTR', qty_ordered: 10, qty_received: 5, sort: 0 }],
  }],
  quotes: [{ id: 'q1', request_id: 'pr1', vendor_id: 'v1', items: [{ request_item_id: 'pri1', price: 410, gst_pct: 18 }], total: 14514, attachments: [] }],
  purchase_orders: [{
    id: 'po1', doc_no: 'PO-0001-2026', date: D, request_id: 'pr1', vendor_id: 'v1', deliver_to_site_id: 's1', status: 'sent', total: 4838,
    items: [{ request_item_id: 'pri1', description: 'M.S PIPE', size: '100MM', qty: 10, unit: 'MTR', price: 410, gst_pct: 18 }],
    vendors: { name: 'Shah Traders' }, purchase_requests: { doc_no: 'PR-0001-2026' },
  }],
  goods_receipts: [{ id: 'g1', doc_no: 'GRN-0001-2026', date: D, site_id: 's1', po_id: 'po1', items: [{ description: 'M.S PIPE', po_line: 0, pending_before: 10, qty_received: 5, qty_rejected: 1, reason: 'bent' }], photos: [], purchase_orders: { doc_no: 'PO-0001-2026' } }],
  documents: [
    { id: 'd1', scope: 'company', scope_id: null, category: 'wc_insurance', title: 'WC policy', expires_on: D, files: ['https://x/y.pdf'] },
    { id: 'd2', scope: 'employee', scope_id: 'e1', category: 'aadhaar', title: 'Aadhaar', number: '123456789012', files: [] },
  ],
  audit_log: [{ id: 1, table_name: 'sites', row_id: 's1', action: 'update', old_row: { name: 'A' }, new_row: { name: 'Hospital' }, changed_by: 'u1', changed_at: D }],
  profiles: [{ id: 'u1', name: 'Owner', role_id: 'admin', active: true, org_id: 'o1' }],
  profile_sites: [],
  dpr: [{ id: 'dp1', date: D, site_id: 's1', work_done: 'Piping', photos: [] }],
  rework: [{ id: 'rw1', date: D, site_id: 's1', issue: 'Leak', status: 'Open', photos: [] }],
  challans: [{ id: 'c1', doc_no: 'DC-0001-2026', date: D, site_id: 's1', items: [{ name: 'Pipe', qty: 2, unit: 'NOS' }] }],
  approvals: [],
  price_history: [{ id: 'ph1', item_id: 'i1', vendor_id: 'v1', price: 410, source: 'po', recorded_at: D, vendors: { name: 'Shah Traders' } }],
};
const SINGLES = {
  org_settings: { org_id: 'o1', name: 'Divine Engineering', timezone: 'Asia/Kolkata' },
  payroll_rules: { org_id: 'o1', monthly_proration: 'by_working_days' },
};

function builder(table) {
  let mode = 'many';
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        const data = mode === 'one' ? (SINGLES[table] ?? FIXTURES[table]?.[0] ?? null) : (FIXTURES[table] ?? []);
        return (res, rej) => Promise.resolve({ data, error: null, count: (FIXTURES[table] ?? []).length }).then(res, rej);
      }
      if (prop === 'single' || prop === 'maybeSingle') return () => { mode = 'one'; return b; };
      return () => b;
    },
  });
  return b;
}

vi.mock('../lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (t) => builder(t),
      rpc: () => Promise.resolve({ data: 'DOC-0001', error: null }),
      channel: () => channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://signed' }, error: null }), upload: () => Promise.resolve({}), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    },
  };
});

vi.mock('../context/AuthContext', () => {
  const role = { id: 'admin', name: 'Admin', is_admin: true, permissions: {} };
  const auth = {
    session: { user: { id: 'u1' } }, user: { id: 'u1' }, profile: { id: 'u1', name: 'Owner', org_id: 'o1', role_id: 'admin' },
    role, roles: [role, { id: 'site', name: 'Site Team', is_admin: false, permissions: { attendance: 'edit' } }], locks: {},
    loading: false, isAdmin: true, canView: () => true, canEdit: () => true, canChangeRow: () => true, refresh: () => {}, signOut: () => {},
  };
  return { useAuth: () => auth, AuthProvider: ({ children }) => children };
});

const { AppDataProvider } = await import('../context/AppDataContext');
const { moduleByKey } = await import('../config/modules');
const F = await import('../config/fields');
const RecordManager = (await import('../components/RecordManager')).default;

const SCREENS = {
  Dashboard: [() => import('./Dashboard'), /Good (morning|afternoon|evening)/],
  Attendance: [() => import('./Attendance'), /Attendance/],
  AttendanceVerify: [() => import('./AttendanceVerify'), /Verify Attendance/],
  AttendanceRegister: [() => import('./AttendanceRegister'), /Attendance Register/],
  Requests: [() => import('./Requests'), /Site Requests/],
  Procurement: [() => import('./Procurement'), /Procurement/],
  GoodsReceived: [() => import('./GoodsReceived'), /Goods Received/],
  Challans: [() => import('./Challans'), /Delivery Challan/],
  Sites: [() => import('./Sites'), /Sites/],
  Team: [() => import('./Team'), /Workers on the roll/],
  TeamArchive: [() => import('./TeamArchive'), /Team Archive/],
  Payroll: [() => import('./Payroll'), /Monthly salary from attendance/],
  Documents: [() => import('./Documents'), /Documents/],
  Advances: [() => import('./Advances'), /Weekly Advance/],
  Reports: [() => import('./Reports'), /Reports/],
  Admin: [() => import('./Admin'), /Admin Control/],
};

let container;
let root;
const errors = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const orig = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); orig(...args); });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  errors.length = 0;
});

async function render(element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><AppDataProvider>{element}</AppDataProvider></MemoryRouter>);
  });
  // let effects fetch the fixture data and re-render
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  return container;
}

describe('every screen renders with data', () => {
  Object.entries(SCREENS).forEach(([name, [load, title]]) => {
    it(name, async () => {
      const Screen = (await load()).default;
      const el = await render(<Screen />);
      expect(el.textContent).toMatch(title);
      expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
    });
  });

  it('RecordManager (Items)', async () => {
    const el = await render(
      <RecordManager module={moduleByKey('items')} table="items" title="Items" fields={F.ITEMS.fields} columns={F.ITEMS.columns} filterField={null} />
    );
    expect(el.textContent).toMatch(/M\.S PIPE/);
  });
});

describe('interactive paths render', () => {
  it('Team lists only workers on the roll; the archive lists who left', async () => {
    const Team = (await import('./Team')).default;
    let el = await render(<Team />);
    expect(el.textContent).toMatch(/Ravi/);
    expect(el.textContent).toMatch(/1234 5678 9012/);
    expect(el.textContent).not.toMatch(/Mohan/);
    expect([...el.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/team/archive')).toBe(true);
    act(() => root.unmount());
    container.remove();
    const TeamArchive = (await import('./TeamArchive')).default;
    el = await render(<TeamArchive />);
    expect(el.textContent).toMatch(/Mohan/);
    expect(el.textContent).not.toMatch(/Ravi/);
  });

  it('Team "Left" asks for the leaving date', async () => {
    const Team = (await import('./Team')).default;
    const el = await render(<Team />);
    const left = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Left');
    await act(async () => { left.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.body.textContent).toMatch(/Last day with the company/);
    expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
  });

  it('Payroll computes rows and opens the pay editor', async () => {
    const P = (await import('./Payroll')).default;
    const el = await render(<P />);
    expect(el.textContent).toMatch(/Ravi/);
    expect(el.textContent).toMatch(/Finalised/);
    const edit = el.querySelector('button[title="Edit pay"]');
    await act(async () => { edit.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.body.textContent).toMatch(/Wage per day/);
    expect(document.body.textContent).toMatch(/Net payable/);
    expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
  });

  it('Payroll "Log advance" lists workers by site and totals the ticks', async () => {
    const P = (await import('./Payroll')).default;
    const el = await render(<P />);
    const log = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Log advance');
    await act(async () => { log.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.body.textContent).toMatch(/HOSPITAL/);
    expect(document.body.textContent).toMatch(/FLOATING/);
    const ravi = [...document.body.querySelectorAll('button')].find((b) => /^Ravi/.test(b.textContent));
    await act(async () => { ravi.click(); });
    expect(document.body.textContent).toMatch(/1 ticked · ₹1,000/);
    expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
  });

  it('Procurement request desk opens with comparison', async () => {
    const P = (await import('./Procurement')).default;
    const el = await render(<P />);
    const order = [...el.querySelectorAll('button')].find((b) => b.textContent === 'To quote & order');
    await act(async () => { order.click(); await new Promise((r) => setTimeout(r, 50)); });
    const open = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Open');
    await act(async () => { open.click(); await new Promise((r) => setTimeout(r, 50)); });
    expect(document.body.textContent).toMatch(/QUOTES & COMPARISON/);
    expect(document.body.textContent).toMatch(/Order from this/);
    expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
  });

  it('Attendance muster form opens and asks for a live crew photo', async () => {
    const A = (await import('./Attendance')).default;
    const el = await render(<A />);
    const edit = [...el.querySelectorAll('button')].find((b) => /Edit this muster|Mark attendance/.test(b.textContent));
    await act(async () => { edit.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(el.textContent).toMatch(/Save muster/);
    expect(el.textContent).toMatch(/Take crew photo/);
    expect(el.textContent).not.toMatch(/Group photo/);
    expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
  });

  it('Verify Attendance lists crew photos with the marked workers ticked', async () => {
    const V = (await import('./AttendanceVerify')).default;
    const el = await render(<V />);
    const tab = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Crew photos');
    await act(async () => { tab.click(); await new Promise((r) => setTimeout(r, 50)); });
    expect(el.textContent).toMatch(/Taken in the app/);
    expect(el.textContent).toMatch(/Ravi/);
    expect(el.textContent).toMatch(/Approve all 1/);
    const ravi = [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ravi');
    await act(async () => { ravi.click(); });
    expect(el.textContent).toMatch(/Approve 0, mark 1 absent/);
    expect(errors.filter((e) => !/not wrapped in act/.test(e))).toEqual([]);
  });
});
