import { beforeAll, describe, expect, it } from 'vitest';
import { as, applySchema, createDb, createUser, one, rows, SCHEMA_BEFORE_V1 } from './db.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const PHOTO = 'sb://private/org/attendance/crew.jpg';

describe('schema applies', () => {
  it('on a fresh project, and again on top of itself', async () => {
    const db = await createDb();
    await applySchema(db);
    const { n } = await one(db.query("select count(*)::int as n from public.items"));
    expect(n).toBeGreaterThan(40);
  });
});

describe('upgrade from the pre-v1 schema', () => {
  let db;
  let admin;
  let siteA;
  let ravi;
  let sunil;

  beforeAll(async () => {
    db = await createDb({ schema: SCHEMA_BEFORE_V1 });
    admin = await createUser(db, { name: 'Owner' });
    siteA = (await one(db.query("insert into public.sites (name) values ('Hospital') returning id"))).id;
    ravi = (await one(db.query(
      "insert into public.employees (name, site_id, wage_type, wage_rate, aadhaar) values ('Ravi', $1, 'Daily', 700, '123456789012') returning id",
      [siteA]))).id;
    sunil = (await one(db.query(
      "insert into public.employees (name, site_id, wage_type, wage_rate) values ('Sunil', $1, 'Monthly', 18000) returning id",
      [siteA]))).id;
    await db.query(
      `insert into public.attendance (date, site_id, present_ids, present_times, marked_by, created_by)
       values ('2026-09-01', $1, array[$2, $3]::uuid[], jsonb_build_object($2::text, '08:45'), 'Supervisor', $4),
              ('2026-09-02', $1, array[$2]::uuid[], '{}', 'Supervisor', $4)`,
      [siteA, ravi, sunil, admin]);
    await db.query(
      `insert into public.requirements (date, site_id, item, dimension, qty, unit, status, raised_by)
       values ('2026-09-01', $1, 'M.S PIPE', '100MM', '30', 'MTR', 'Open', 'Supervisor'),
              ('2026-09-02', $1, 'Sprinkler head', null, '12 nos', 'NOS', 'Fulfilled', 'Supervisor')`,
      [siteA]);
    await db.query(
      "insert into public.material_received (date, site_id, item, qty, supplier) values ('2026-09-03', $1, 'GI pipe', '20 m', 'Shah Traders')",
      [siteA]);
    await db.query(
      `insert into public.payroll_runs (month, rows, totals)
       values ('2026-08', jsonb_build_array(jsonb_build_object('employee_id', $1::text, 'net', 15400)), '{}')`,
      [ravi]);
    await db.query("insert into public.salary_payments (employee_id, month, status, paid_on) values ($1, '2026-08', 'Paid', '2026-09-05')", [ravi]);
    await db.query("insert into public.salary_adjustments (employee_id, month, amount, note) values ($1, '2026-08', 26000, 'Raise')", [sunil]);

    await applySchema(db);
  });

  it('treats attendance recorded before crew-photo approval as approved', async () => {
    const pending = await rows(db.query('select id from public.attendance_entries where verified_at is null'));
    expect(pending).toHaveLength(0);
    const unapproved = await rows(db.query("select id from public.musters where status <> 'approved'"));
    expect(unapproved).toHaveLength(0);
  });

  it('turns a full-month salary override into a wage per day', async () => {
    const adj = await one(db.query('select day_rate::float, days_present, bonus::float, note from public.salary_adjustments where employee_id = $1', [sunil]));
    expect(adj).toEqual({ day_rate: 1000, days_present: null, bonus: 0, note: 'Raise' });
    const cols = await rows(db.query("select 1 from information_schema.columns where table_name = 'salary_adjustments' and column_name = 'amount'"));
    expect(cols).toHaveLength(0);
  });

  it('gives every role a payroll permission starting from its team permission', async () => {
    const roles = await rows(db.query("select id, permissions ->> 'team' as team, permissions ->> 'payroll' as payroll from public.roles where not is_admin"));
    expect(roles.length).toBeGreaterThan(0);
    roles.forEach((r) => expect(r.payroll).toBe(r.team ?? 'none'));
    expect((await one(db.query('select standard_hours::float from public.payroll_rules'))).standard_hours).toBe(9);
  });

  it('turns each muster into one entry per worker', async () => {
    const entries = await rows(db.query('select employee_id, date::text, in_time::text, units::float, source from public.attendance_entries order by date, employee_id'));
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.source === 'import' && e.units === 1)).toBe(true);
    expect(entries.find((e) => e.employee_id === ravi && e.date === '2026-09-01').in_time).toBe('08:45:00');
    const musters = await rows(db.query('select marked_by_name from public.musters'));
    expect(musters).toHaveLength(2);
    expect(musters[0].marked_by_name).toBe('Supervisor');
  });

  it('moves Aadhaar into restricted documents and keeps only the last 4 on the worker', async () => {
    const cols = await rows(db.query("select column_name from information_schema.columns where table_name = 'employees' and column_name = 'aadhaar'"));
    expect(cols).toHaveLength(0);
    expect((await one(db.query('select aadhaar_last4 from public.employees where id = $1', [ravi]))).aadhaar_last4).toBe('9012');
    expect((await one(db.query("select number from public.documents where scope = 'employee' and scope_id = $1", [ravi]))).number).toBe('123456789012');
  });

  it('turns requirements into purchase requests and receipts into GRNs', async () => {
    const prs = await rows(db.query(
      `select r.status, r.doc_no, i.description, i.size, i.qty::float, i.item_id
       from public.purchase_requests r join public.purchase_request_items i on i.request_id = r.id order by r.date`));
    expect(prs).toHaveLength(2);
    expect(prs[0]).toMatchObject({ status: 'submitted', description: 'M.S PIPE', size: '100MM', qty: 30 });
    expect(prs[0].item_id).not.toBeNull();
    expect(prs[0].doc_no).toMatch(/^PR-0001-\d{4}$/);
    expect(prs[1]).toMatchObject({ status: 'closed', qty: 12, item_id: null });
    const grn = await one(db.query('select supplier_name, items from public.goods_receipts'));
    expect(grn.supplier_name).toBe('Shah Traders');
    expect(grn.items[0]).toMatchObject({ description: 'GI pipe', qty_received: 20 });
  });

  it('turns Paid flags into payment records and opens wage history', async () => {
    const pay = await one(db.query('select amount::float, note from public.payroll_payments'));
    expect(pay.amount).toBe(15400);
    const rates = await rows(db.query('select employee_id, wage_type, rate::float from public.employee_rates order by rate'));
    expect(rates).toEqual([
      { employee_id: ravi, wage_type: 'Daily', rate: 700 },
      { employee_id: sunil, wage_type: 'Monthly', rate: 18000 },
    ]);
  });

  it('is a no-op when pasted again', async () => {
    const before = await one(db.query(`select
      (select count(*) from public.attendance_entries)::int as e,
      (select count(*) from public.purchase_requests)::int as pr,
      (select count(*) from public.payroll_payments)::int as pp,
      (select count(*) from public.documents)::int as d`));
    await applySchema(db);
    const after = await one(db.query(`select
      (select count(*) from public.attendance_entries)::int as e,
      (select count(*) from public.purchase_requests)::int as pr,
      (select count(*) from public.payroll_payments)::int as pp,
      (select count(*) from public.documents)::int as d`));
    expect(after).toEqual(before);
  });
});

describe('row level security', () => {
  let db;
  let admin;
  let office;
  let site;
  let viewer;
  let siteA;
  let siteB;
  let worker;

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, { name: 'Owner' });
    office = await createUser(db, { role: 'office' });
    site = await createUser(db, { role: 'site' });
    viewer = await createUser(db, { role: 'viewer' });
    siteA = (await one(db.query("insert into public.sites (name, org_id, lat, lng, radius_m) values ('A', $1, 19.0760, 72.8777, 200) returning id", [ORG]))).id;
    siteB = (await one(db.query("insert into public.sites (name, org_id) values ('B', $1) returning id", [ORG]))).id;
    worker = (await one(db.query("insert into public.employees (name, org_id, site_id, wage_rate) values ('Ravi', $1, $2, 700) returning id", [ORG, siteA]))).id;
  });

  it('lets a viewer read but not write', async () => {
    expect(await rows(as(db, viewer, 'select name from public.sites order by name'))).toHaveLength(2);
    await expect(as(db, viewer, "insert into public.dpr (site_id, work_done) values ($1, 'x')", [siteA]))
      .rejects.toThrow(/row-level security/);
  });

  it('stamps created_by with the real user, whatever the client sends', async () => {
    const r = await one(as(db, site, "insert into public.dpr (site_id, work_done, created_by) values ($1, 'piping', $2) returning created_by", [siteA, admin]));
    expect(r.created_by).toBe(site);
  });

  it('hides Aadhaar documents from roles without hr_documents', async () => {
    await as(db, office, "insert into public.documents (scope, scope_id, category, number) values ('employee', $1, 'aadhaar', '1111 2222 3333')", [worker]);
    expect(await rows(as(db, viewer, 'select number from public.documents'))).toHaveLength(0);
    expect((await one(as(db, office, 'select number from public.documents'))).number).toBe('1111 2222 3333');
    expect((await one(db.query('select aadhaar_last4 from public.employees where id = $1', [worker]))).aadhaar_last4).toBe('3333');
  });

  it('scopes a login to its assigned sites', async () => {
    const scoped = await createUser(db, { role: 'site' });
    await db.query('insert into public.profile_sites (profile_id, site_id, org_id) values ($1, $2, $3)', [scoped, siteB, ORG]);
    expect((await rows(as(db, scoped, 'select name from public.sites'))).map((s) => s.name)).toEqual(['B']);
    await expect(as(db, scoped, "insert into public.dpr (site_id, work_done) values ($1, 'x')", [siteA]))
      .rejects.toThrow(/row-level security/);
  });

  it('keeps a second company out of the first company\'s rows', async () => {
    const other = (await one(db.query("insert into public.orgs (name) values ('Other Co') returning id"))).id;
    const outsider = await createUser(db, { role: 'office', orgId: other });
    expect(await rows(as(db, outsider, 'select * from public.sites'))).toHaveLength(0);
    expect(await rows(as(db, outsider, 'select * from public.employees'))).toHaveLength(0);
    await expect(as(db, outsider, "insert into public.dpr (site_id, work_done, org_id) values ($1, 'x', $2)", [siteA, ORG]))
      .rejects.toThrow(/row-level security/);
  });

  it('keeps payroll edits to payroll editors, and days present until the month is over', async () => {
    const thisMonth = (await one(db.query("select to_char(public.local_now(), 'YYYY-MM') as m"))).m;
    const lastMonth = (await one(db.query("select to_char(public.local_now() - interval '1 month', 'YYYY-MM') as m"))).m;
    await expect(as(db, site, 'insert into public.salary_adjustments (employee_id, month, bonus) values ($1, $2, 500)', [worker, thisMonth]))
      .rejects.toThrow(/row-level security/);
    await as(db, office, 'insert into public.salary_adjustments (employee_id, month, bonus, ot_hours) values ($1, $2, 500, 3)', [worker, thisMonth]);
    await expect(as(db, office, 'update public.salary_adjustments set days_present = 20 where employee_id = $1 and month = $2', [worker, thisMonth]))
      .rejects.toThrow(/only be changed after/);
    await as(db, office, 'insert into public.salary_adjustments (employee_id, month, days_present, penalty) values ($1, $2, 24, 200)', [worker, lastMonth]);
    expect((await one(db.query('select days_present::float from public.salary_adjustments where month = $1', [lastMonth]))).days_present).toBe(24);
    await expect(as(db, office, 'insert into public.salary_adjustments (employee_id, month, bonus) values ($1, $2, -5)', [worker, '2020-01']))
      .rejects.toThrow(/check constraint/);
  });

  it('lets a payroll-only login log advances', async () => {
    await db.query(`insert into public.roles (id, name, permissions) values ('accounts', 'Accounts', '{"payroll":"edit"}')`);
    const accounts = await createUser(db, { role: 'accounts' });
    const today = (await one(db.query('select public.local_now()::date::text as d'))).d;
    await as(db, accounts, 'insert into public.advances (employee_id, date, amount) values ($1, $2, 1000)', [worker, today]);
    await expect(as(db, viewer, 'insert into public.advances (employee_id, date, amount) values ($1, $2, 1000)', [worker, today]))
      .rejects.toThrow(/row-level security/);
  });

  it('stops a non-admin from promoting themselves', async () => {
    await as(db, viewer, "update public.profiles set role_id = 'admin' where id = $1", [viewer]);
    expect((await one(db.query('select role_id from public.profiles where id = $1', [viewer]))).role_id).toBe('viewer');
  });
});

describe('attendance rules', () => {
  let db;
  let site;
  let verifier;
  let admin;
  let siteA;
  let siteB;
  let ravi;
  const today = async () => (await one(db.query('select public.local_now()::date::text as d'))).d;

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db);
    site = await createUser(db, { role: 'site' });
    verifier = await createUser(db, { role: 'regional' });
    siteA = (await one(db.query("insert into public.sites (name, org_id, lat, lng, radius_m) values ('A', $1, 19.0760, 72.8777, 200) returning id", [ORG]))).id;
    siteB = (await one(db.query("insert into public.sites (name, org_id) values ('B', $1) returning id", [ORG]))).id;
    ravi = (await one(db.query("insert into public.employees (name, org_id, site_id, wage_rate) values ('Ravi', $1, $2, 700) returning id", [ORG, siteA]))).id;
  });

  it('saves a muster atomically and derives half day, OT and late', async () => {
    const d = await today();
    await as(db, site, 'select public.submit_muster($1)', [{
      site_id: siteA, date: d, lat: 19.0761, lng: 72.8778, group_photo: PHOTO, photo_live: true,
      entries: [{ employee_id: ravi, in_time: '09:40', out_time: '20:10' }],
    }]);
    const e = await one(db.query('select status, units::float, ot_hours::float, late_min, distance_m, flags from public.attendance_entries where employee_id = $1', [ravi]));
    // 10.5 h worked: OT after 9 h rounded down to 30 min = 1.5; 40 min late > 15 grace
    expect(e).toMatchObject({ status: 'present', units: 1, ot_hours: 1.5, late_min: 40 });
    expect(e.distance_m).toBeLessThan(200);
    expect(e.flags).not.toContain('no_photo');
    expect(e.flags).not.toContain('outside_radius');
  });

  it('refuses to pay the same worker twice on one day', async () => {
    const d = await today();
    await expect(as(db, site, 'select public.submit_muster($1)', [{
      site_id: siteB, date: d, group_photo: PHOTO, lat: 19.07, lng: 72.87, entries: [{ employee_id: ravi, in_time: '09:00' }],
    }])).rejects.toThrow(/already marked at another site/);
  });

  it('refuses a muster with no crew photo or no location', async () => {
    const d = await today();
    await expect(as(db, site, 'select public.submit_muster($1)', [{ site_id: siteB, date: d, lat: 19.07, lng: 72.87, entries: [] }]))
      .rejects.toThrow(/crew photo/);
    await expect(as(db, site, 'select public.submit_muster($1)', [{ site_id: siteB, date: d, group_photo: PHOTO, entries: [] }]))
      .rejects.toThrow(/site location/);
  });

  it('flags a muster captured far from the site', async () => {
    const shyam = (await one(db.query("insert into public.employees (name, org_id, site_id) values ('Shyam', $1, $2) returning id", [ORG, siteA]))).id;
    const d = await today();
    await as(db, site, 'select public.submit_muster($1)', [{
      site_id: siteA, date: d, lat: 18.52, lng: 73.85, group_photo: PHOTO, entries: [{ employee_id: ravi, in_time: '09:40', out_time: '20:10' }, { employee_id: shyam }],
    }]);
    const e = await one(db.query('select flags from public.attendance_entries where employee_id = $1', [shyam]));
    expect(e.flags).toContain('outside_radius');
  });

  it('enforces the site\'s photo requirement on the server', async () => {
    await db.query('insert into public.site_settings (site_id, org_id, require_photo) values ($1, $2, true)', [siteB, ORG]);
    const w = (await one(db.query("insert into public.employees (name, org_id, site_id) values ('Mohan', $1, $2) returning id", [ORG, siteB]))).id;
    await expect(as(db, site, "select public.punch($1, $2, 'in')", [w, siteB])).rejects.toThrow(/requires a photo/);
    const r = await one(as(db, site, "select (public.punch($1, $2, 'in', 'sb://private/x.jpg')).status", [w, siteB]));
    expect(r.status).toBe('present');
  });

  it('lets only a verifier confirm an entry', async () => {
    const e = await one(db.query('select id from public.attendance_entries where employee_id = $1', [ravi]));
    await expect(as(db, site, 'update public.attendance_entries set verified_by = $1, verified_at = now() where id = $2', [site, e.id]))
      .rejects.toThrow(/Verify Attendance/);
    await as(db, verifier, 'update public.attendance_entries set verified_by = $1, verified_at = now() where id = $2', [verifier, e.id]);
    expect((await one(db.query('select verified_by from public.attendance_entries where id = $1', [e.id]))).verified_by).toBe(verifier);
  });

  it('approves a crew photo: those in it are confirmed, the rest are absent that day only', async () => {
    const shyam = (await one(db.query("insert into public.employees (name, org_id, site_id) values ('Shyam2', $1, $2) returning id", [ORG, siteB]))).id;
    const mohan = (await one(db.query("insert into public.employees (name, org_id, site_id) values ('Mohan2', $1, $2) returning id", [ORG, siteB]))).id;
    const yesterday = (await one(db.query("select (public.local_now() - interval '1 day')::date::text as d"))).d;
    await db.query('update public.site_settings set require_photo = false where site_id = $1', [siteB]);
    const before = { site_id: siteB, date: yesterday, group_photo: PHOTO, lat: 19.07, lng: 72.87 };
    await as(db, site, 'select public.submit_muster($1)', [{ ...before, entries: [{ employee_id: shyam, in_time: '09:00' }] }]);
    const yEntry = await one(db.query('select id from public.attendance_entries where employee_id = $1 and date = $2', [shyam, yesterday]));

    const d = await today();
    const mid = (await one(as(db, site, 'select public.submit_muster($1) as id', [{
      ...before, date: d, entries: [{ employee_id: shyam, in_time: '09:00' }, { employee_id: mohan, in_time: '09:00' }],
    }]))).id;
    expect((await one(db.query('select status from public.musters where id = $1', [mid]))).status).toBe('submitted');

    await expect(as(db, site, 'select public.approve_muster($1, $2)', [mid, [shyam]])).rejects.toThrow(/Verify Attendance/);
    const n = (await one(as(db, verifier, 'select public.approve_muster($1, $2) as n', [mid, [shyam]]))).n;
    expect(n).toBe(1);

    const rowsToday = await rows(db.query(
      'select employee_id, status, units::float, verified_at is not null as ok, flags from public.attendance_entries where muster_id = $1', [mid]));
    expect(rowsToday.find((r) => r.employee_id === shyam)).toMatchObject({ status: 'present', units: 1, ok: true });
    const dropped = rowsToday.find((r) => r.employee_id === mohan);
    expect(dropped).toMatchObject({ status: 'absent', units: 0, ok: true });
    expect(dropped.flags).toContain('rejected');
    expect((await one(db.query('select status from public.musters where id = $1', [mid]))).status).toBe('approved');

    // yesterday is untouched
    const y = await one(db.query('select status, verified_at from public.attendance_entries where id = $1', [yEntry.id]));
    expect(y).toMatchObject({ status: 'present', verified_at: null });
  });

  it('sends a re-submitted muster back for approval', async () => {
    const d = await today();
    const m = await one(db.query('select id, site_id from public.musters where date = $1 and status = $2 limit 1', [d, 'approved']));
    const shyam = (await one(db.query("select id from public.employees where name = 'Shyam2'"))).id;
    await as(db, verifier, 'select public.submit_muster($1)', [{
      site_id: m.site_id, date: d, group_photo: PHOTO, lat: 19.07, lng: 72.87, entries: [{ employee_id: shyam, in_time: '09:15' }],
    }]);
    expect((await one(db.query('select status, approved_at from public.musters where id = $1', [m.id])))).toMatchObject({ status: 'submitted', approved_at: null });
  });

  it('locks a finalised payroll period for everyone but Admin', async () => {
    const d = await today();
    await db.query(
      "insert into public.payroll_runs (org_id, month, period_start, period_end, status) values ($1, to_char($2::date, 'YYYY-MM'), $2::date - 3, $2::date + 3, 'final')",
      [ORG, d]);
    const e = await one(db.query('select id from public.attendance_entries where employee_id = $1', [ravi]));
    const res = await as(db, site, "update public.attendance_entries set note = 'late edit' where id = $1", [e.id]);
    expect(res.affectedRows).toBe(0);
    const res2 = await as(db, admin, "update public.attendance_entries set note = 'admin fix' where id = $1", [e.id]);
    expect(res2.affectedRows).toBe(1);
  });

  it('writes an audit row for a signed-in change', async () => {
    const log = await rows(db.query("select action, changed_by from public.audit_log where table_name = 'attendance_entries' and changed_by = $1", [admin]));
    expect(log.length).toBeGreaterThan(0);
  });
});

describe('entries added by Admin', () => {
  let db;
  let admin;
  let site;
  let office;
  let verifier;
  let siteA;
  let ravi;

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db);
    site = await createUser(db, { role: 'site' });
    office = await createUser(db, { role: 'office' });
    verifier = await createUser(db, { role: 'regional' });
    siteA = (await one(db.query("insert into public.sites (name, org_id) values ('A', $1) returning id", [ORG]))).id;
    ravi = (await one(db.query("insert into public.employees (name, org_id, site_id, wage_rate) values ('Ravi', $1, $2, 700) returning id", [ORG, siteA]))).id;
  });

  it('can be read but not changed or deleted by a site user', async () => {
    const mine = await one(as(db, site, "insert into public.dpr (site_id, work_done) values ($1, 'site work') returning id", [siteA]));
    const admins = await one(as(db, admin, "insert into public.dpr (site_id, work_done) values ($1, 'admin work') returning id", [siteA]));
    expect(await rows(as(db, site, 'select id from public.dpr'))).toHaveLength(2);
    await expect(as(db, site, "update public.dpr set work_done = 'x' where id = $1", [admins.id])).rejects.toThrow(/added by Admin/);
    await expect(as(db, site, 'delete from public.dpr where id = $1', [admins.id])).rejects.toThrow(/added by Admin/);
    await as(db, site, "update public.dpr set work_done = 'fixed' where id = $1", [mine.id]);
    await as(db, admin, "update public.dpr set work_done = 'admin fix' where id = $1", [mine.id]);
    expect((await one(db.query('select work_done from public.dpr where id = $1', [mine.id]))).work_done).toBe('admin fix');
  });

  it("stops a site user overwriting Admin's muster, but a verifier can still confirm it", async () => {
    const d = (await one(db.query('select public.local_now()::date::text as d'))).d;
    const m = { site_id: siteA, date: d, group_photo: PHOTO, lat: 19.07, lng: 72.87 };
    await as(db, admin, 'select public.submit_muster($1)', [{ ...m, entries: [{ employee_id: ravi, in_time: '09:00' }] }]);
    await expect(as(db, site, 'select public.submit_muster($1)', [{ ...m, entries: [{ employee_id: ravi, status: 'half' }] }]))
      .rejects.toThrow(/added by Admin/);
    const e = await one(db.query('select id from public.attendance_entries where employee_id = $1', [ravi]));
    await as(db, verifier, 'update public.attendance_entries set verified_by = $1, verified_at = now() where id = $2', [verifier, e.id]);
    expect((await one(db.query('select verified_by from public.attendance_entries where id = $1', [e.id]))).verified_by).toBe(verifier);
  });

  it("lets the office and site keep an Admin's request moving", async () => {
    const { id } = await one(as(db, admin, 'select public.create_purchase_request($1) as id', [{ site_id: siteA, items: [{ description: 'Hanger', qty: 10 }] }]));
    await expect(as(db, site, "update public.purchase_requests set remarks = 'x' where id = $1", [id])).rejects.toThrow(/added by Admin/);
    await expect(as(db, site, 'select public.replace_request_items($1, $2)', [id, [{ description: 'Other', qty: 1 }]])).rejects.toThrow(/added by Admin/);
    await as(db, admin, "update public.purchase_requests set status = 'approved' where id = $1", [id]);
    const line = await one(db.query('select id from public.purchase_request_items where request_id = $1', [id]));
    const vendor = (await one(db.query("insert into public.vendors (name, org_id) values ('V', $1) returning id", [ORG]))).id;
    const po = await one(as(db, office,
      `insert into public.purchase_orders (request_id, vendor_id, status, items)
       values ($1, $2, 'sent', jsonb_build_array(jsonb_build_object('request_item_id', $3::text, 'description', 'Hanger', 'qty', 10))) returning id`,
      [id, vendor, line.id]));
    await as(db, site,
      `insert into public.goods_receipts (site_id, po_id, request_id, items)
       values ($1, $2, $3, jsonb_build_array(jsonb_build_object('request_item_id', $4::text, 'po_line', 0, 'qty_received', 4)))`,
      [siteA, po.id, id, line.id]);
    expect((await one(db.query('select status from public.purchase_requests where id = $1', [id]))).status).toBe('partially_received');
    await as(db, office, "update public.purchase_requests set status = 'closed' where id = $1", [id]);
  });
});

describe('procurement flow', () => {
  let db;
  let site;
  let office;
  let owner;
  let siteA;
  let vendor;
  let item;

  beforeAll(async () => {
    db = await createDb();
    owner = await createUser(db);
    office = await createUser(db, { role: 'office' });
    site = await createUser(db, { role: 'site' });
    siteA = (await one(db.query("insert into public.sites (name, org_id) values ('A', $1) returning id", [ORG]))).id;
    vendor = (await one(db.query("insert into public.vendors (name, org_id) values ('Shah Traders', $1) returning id", [ORG]))).id;
    item = (await one(db.query("select id from public.items where name = 'M.S PIPE'"))).id;
  });

  it('runs request → approval → PO → partial GRN with roll-ups and price history', async () => {
    const pr = await one(as(db, site, "insert into public.purchase_requests (site_id, doc_no) values ($1, public.next_doc_no('PR')) returning id, status", [siteA]));
    expect(pr.status).toBe('submitted');
    const line = await one(as(db, site, "insert into public.purchase_request_items (request_id, item_id, description, size, qty, unit) values ($1, $2, 'M.S PIPE', '100MM', 30, 'MTR') returning id", [pr.id, item]));

    await expect(as(db, site, "update public.purchase_requests set status = 'approved' where id = $1", [pr.id]))
      .rejects.toThrow();
    await expect(as(db, office, "update public.purchase_requests set status = 'approved' where id = $1", [pr.id]))
      .rejects.toThrow(/Only an approver/);
    await as(db, owner, "update public.purchase_requests set status = 'approved' where id = $1", [pr.id]);
    expect((await one(db.query("select count(*)::int as n from public.approvals where entity_id = $1", [pr.id]))).n).toBe(1);

    const po = await one(as(db, office,
      `insert into public.purchase_orders (request_id, vendor_id, deliver_to_site_id, status, items)
       values ($1, $2, $3, 'sent', jsonb_build_array(jsonb_build_object(
         'request_item_id', $4::text, 'item_id', $5::text, 'description', 'M.S PIPE', 'size', '100MM', 'qty', 30, 'unit', 'MTR', 'price', 410, 'gst_pct', 18)))
       returning id`, [pr.id, vendor, siteA, line.id, item]));
    expect((await one(db.query('select status from public.purchase_requests where id = $1', [pr.id]))).status).toBe('ordered');
    expect((await one(db.query('select last_price::float from public.items where id = $1', [item]))).last_price).toBe(410);

    await as(db, site,
      `insert into public.goods_receipts (site_id, po_id, request_id, items)
       values ($1, $2, $3, jsonb_build_array(jsonb_build_object('request_item_id', $4::text, 'po_line', 0, 'qty_received', 20)))`,
      [siteA, po.id, pr.id, line.id]);
    expect((await one(db.query('select status from public.purchase_requests where id = $1', [pr.id]))).status).toBe('partially_received');
    expect((await one(db.query('select status from public.purchase_orders where id = $1', [po.id]))).status).toBe('partially_received');
    expect((await one(db.query('select qty_received::float from public.purchase_request_items where id = $1', [line.id]))).qty_received).toBe(20);
    expect((await one(db.query('select fulfilled_on from public.purchase_requests where id = $1', [pr.id]))).fulfilled_on).toBeNull();

    await as(db, site,
      `insert into public.goods_receipts (site_id, po_id, request_id, date, items)
       values ($1, $2, $3, '2026-09-20', jsonb_build_array(jsonb_build_object('request_item_id', $4::text, 'po_line', 0, 'qty_received', 10)))`,
      [siteA, po.id, pr.id, line.id]);
    const done = await one(db.query('select status, fulfilled_on::text from public.purchase_requests where id = $1', [pr.id]));
    expect(done).toEqual({ status: 'received', fulfilled_on: '2026-09-20' });
    await as(db, office, "update public.purchase_requests set status = 'closed' where id = $1", [pr.id]);
    expect((await one(db.query('select fulfilled_on::text from public.purchase_requests where id = $1', [pr.id]))).fulfilled_on).toBe('2026-09-20');
  });

  it('dates a request fulfilled when the office closes it without a delivery', async () => {
    const { id } = await one(as(db, site, 'select public.create_purchase_request($1) as id', [{ site_id: siteA, items: [{ description: 'Hanger', qty: 4 }] }]));
    const pr = { id };
    await as(db, owner, "update public.purchase_requests set status = 'approved' where id = $1", [pr.id]);
    await as(db, office, "update public.purchase_requests set status = 'closed' where id = $1", [pr.id]);
    const r = await one(db.query('select fulfilled_on = public.local_now()::date as today from public.purchase_requests where id = $1', [pr.id]));
    expect(r.today).toBe(true);
  });

  it('raises a request and its lines atomically', async () => {
    const { id } = await one(as(db, site, 'select public.create_purchase_request($1) as id', [{
      site_id: siteA, priority: 'High', items: [{ item_id: item, description: 'M.S PIPE', size: '50MM', qty: 12, unit: 'MTR' }, { description: 'Hanger', qty: 40 }],
    }]));
    const lines = await rows(db.query('select description, sort from public.purchase_request_items where request_id = $1 order by sort', [id]));
    expect(lines.map((l) => l.description)).toEqual(['M.S PIPE', 'Hanger']);
    await expect(as(db, site, 'select public.create_purchase_request($1)', [{ site_id: siteA, items: [] }]))
      .rejects.toThrow(/at least one item/);
    await expect(as(db, site, 'select public.create_purchase_request($1)', [{ site_id: siteA, items: [{ description: 'x', qty: 0 }] }]))
      .rejects.toThrow();
    // the two failed calls left no request without lines behind
    const orphans = await one(db.query('select count(*)::int as n from public.purchase_requests r where not exists (select 1 from public.purchase_request_items i where i.request_id = r.id)'));
    expect(orphans.n).toBe(0);
  });

  it('refuses an impossible status move', async () => {
    const pr = await one(as(db, site, 'insert into public.purchase_requests (site_id) values ($1) returning id', [siteA]));
    await expect(as(db, owner, "update public.purchase_requests set status = 'received' where id = $1", [pr.id]))
      .rejects.toThrow(/can't move/);
  });
});
