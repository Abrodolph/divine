-- =============================================================================
-- GRIDWATCH — full database schema
-- Paste the whole file into the Supabase SQL Editor and Run.
--
-- Safe to re-run on a live project: tables use "if not exists", columns use
-- "add column if not exists", policies are dropped and recreated, and one-off
-- data migrations are recorded in public.schema_migrations so they run once.
--
-- !! LIVE DATA — EDIT WITH CARE !!
-- This file is applied to a production database holding months of real
-- attendance, payroll and procurement records. Before changing it:
--   * Never rename/drop a table or column, or change a column's type or
--     meaning in place. Add new ones instead.
--   * If a reshape is unavoidable: add the new shape, copy every existing row
--     into it, and only then retire the old one (rename to *_legacy, or drop
--     the column) — all inside a guarded one-off block in section 12b.
--   * New defaults don't change existing rows; update them in a guarded
--     migration if their meaning changes.
--   * Add a test in supabase/tests/schema.test.js that seeds old-shape data
--     and checks it survives. Run npm test.
--   * Take a pg_dump backup (README → Backups) before pasting into Supabase.
-- See CLAUDE.md → Database for the full rules.
--
-- Sections
--   1  Tenancy (orgs, org settings, migration log)
--   2  Roles, profiles, module locks
--   3  Permission helpers
--   4  Masters: sites, site settings, site scoping, employees, wage history
--   5  Site logs: DPR, rework, challans, transport, MTC, drawings
--   6  Attendance: musters + one entry per worker per day
--   7  Money: advances, working days, adjustments, payroll rules/runs/payments
--   8  Procurement: items, vendors, requests, quotes, POs, goods receipts
--   9  Documents vault
--  10  Audit log
--  11  Document numbering
--  12  Cross-table plumbing (org_id, created_by, audit triggers, indexes)
--  13  Row Level Security
--  14  Storage
--  15  Realtime
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TENANCY
--    Every business row carries org_id. There is one org today; the column is
--    here so a second company can be added later without retrofitting RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- The first (and for now only) company. Fixed id so upgrades can backfill.
insert into public.orgs (id, name)
values ('00000000-0000-0000-0000-000000000001', 'DIVINE ENGINEERING SERVICES')
on conflict (id) do nothing;

create or replace function public.default_org()
returns uuid language sql immutable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$;

-- One-off data migrations mark themselves done here.
create table if not exists public.schema_migrations (
  key        text primary key,
  applied_at timestamptz not null default now()
);

-- Cast free-text quantities ("30 m", "2.5") to numbers without blowing up.
create or replace function public.try_numeric(v text)
returns numeric language plpgsql immutable as $$
begin
  return nullif(substring(coalesce(v, '') from '[0-9]+(?:\.[0-9]+)?'), '')::numeric;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. ROLES, PROFILES, MODULE LOCKS
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id          text primary key,
  name        text not null,
  is_admin    boolean not null default false,
  permissions jsonb  not null default '{}'::jsonb
);

-- Module keys (must match src/config/modules.js), values 'none'|'view'|'edit':
--   attendance, attendance_verify, dpr, requirements, rework,
--   material_received, challans, transport, mtc, drawings,
--   procurement, procurement_approve, items, vendors,
--   sites, team, payroll, hr_documents, documents,
--   advances, attendance_register, reports
-- 'team' is the worker roster (and wage history); 'payroll' is the monthly
-- salary screen, its adjustments, runs and payments.
-- 'requirements' is the site's purchase requests; 'material_received' is
-- goods receipts against POs; 'procurement' is the office's buying desk.
-- 'hr_documents' gates Aadhaar and other personal worker documents.

insert into public.roles (id, name, is_admin, permissions) values
  ('admin', 'Admin', true, '{}'::jsonb),
  ('site', 'Site Team', false, '{}'::jsonb),
  ('regional', 'Regional Manager', false, '{}'::jsonb),
  ('office', 'Office / Store', false, '{}'::jsonb),
  ('viewer', 'Viewer', false, '{}'::jsonb)
on conflict (id) do nothing;

-- Upgrade path (once): payroll moved out of the Team screen into its own. Each
-- existing role starts with whatever it had on Team. Runs before the defaults
-- below so a fresh install (empty permissions) gets the shipped defaults.
do $$
begin
  if not exists (select 1 from public.schema_migrations where key = 'payroll_permission_split') then
    update public.roles
    set permissions = permissions || jsonb_build_object('payroll', coalesce(permissions ->> 'payroll', permissions ->> 'team', 'none'))
    where not is_admin and permissions <> '{}'::jsonb;
    insert into public.schema_migrations (key) values ('payroll_permission_split');
  end if;
end $$;

-- Defaults for each shipped role. Merged underneath what's already stored, so
-- an Admin's customisations win and only missing (new) keys are filled in.
update public.roles r set permissions = d.defaults || r.permissions
from (values
  ('site', '{
     "attendance":"edit","attendance_verify":"none","dpr":"edit","requirements":"edit","rework":"edit",
     "material_received":"edit","challans":"edit","transport":"edit","mtc":"edit","drawings":"view",
     "procurement":"none","procurement_approve":"none","items":"view","vendors":"none",
     "sites":"view","team":"none","payroll":"none","hr_documents":"none","documents":"view",
     "advances":"none","attendance_register":"none","reports":"none"}'::jsonb),
  ('regional', '{
     "attendance":"edit","attendance_verify":"edit","dpr":"edit","requirements":"edit","rework":"edit",
     "material_received":"edit","challans":"edit","transport":"edit","mtc":"edit","drawings":"edit",
     "procurement":"view","procurement_approve":"none","items":"view","vendors":"view",
     "sites":"view","team":"none","payroll":"none","hr_documents":"none","documents":"view",
     "advances":"none","attendance_register":"view","reports":"none"}'::jsonb),
  ('office', '{
     "attendance":"view","attendance_verify":"none","dpr":"view","requirements":"edit","rework":"view",
     "material_received":"edit","challans":"edit","transport":"edit","mtc":"edit","drawings":"edit",
     "procurement":"edit","procurement_approve":"none","items":"edit","vendors":"edit",
     "sites":"edit","team":"edit","payroll":"edit","hr_documents":"edit","documents":"edit",
     "advances":"edit","attendance_register":"none","reports":"view"}'::jsonb),
  ('viewer', '{
     "attendance":"view","attendance_verify":"none","dpr":"view","requirements":"view","rework":"view",
     "material_received":"view","challans":"view","transport":"view","mtc":"view","drawings":"view",
     "procurement":"view","procurement_approve":"none","items":"view","vendors":"view",
     "sites":"view","team":"view","payroll":"view","hr_documents":"none","documents":"view",
     "advances":"view","attendance_register":"view","reports":"view"}'::jsonb)
) as d(id, defaults)
where r.id = d.id;

-- Upgrade path: removed modules.
update public.roles set permissions = permissions - 'indents' where permissions ? 'indents';
update public.roles set permissions = permissions - 'site_photos' where permissions ? 'site_photos';

create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  org_id     uuid not null default public.default_org() references public.orgs(id),
  name       text not null default 'New User',
  phone      text,
  role_id    text not null default 'viewer' references public.roles(id),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists org_id uuid not null
  default public.default_org() references public.orgs(id);

-- Every new auth user gets a profile. The FIRST user ever becomes Admin;
-- everyone after is a Viewer until promoted. (Never take the role from user
-- metadata — anyone can set that at signup. The admin-users Edge Function
-- sets the role on the profile afterwards, with the service key.)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, name, role_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.module_locks (
  module text primary key,
  locked boolean not null default false
);
delete from public.module_locks where module in ('indents', 'site_photos');

-- ---------------------------------------------------------------------------
-- 3. PERMISSION HELPERS  (used by every RLS policy)
-- ---------------------------------------------------------------------------
create or replace function public.current_org()
returns uuid language sql stable security definer set search_path = public as $$
  select p.org_id from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.active
  ), false);
$$;

create or replace function public.can_view(module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin or coalesce(r.permissions ->> module_key, 'none') in ('view', 'edit')
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.active
  ), false);
$$;

create or replace function public.can_edit(module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin or (
      r.permissions ->> module_key = 'edit'
      and not coalesce(
        (select l.locked from public.module_locks l where l.module = module_key), false)
    )
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and p.active
  ), false);
$$;

create table if not exists public.org_settings (
  org_id    uuid primary key references public.orgs(id) on delete cascade,
  name      text not null default '',
  tagline   text,
  address   text,
  phone     text,
  email     text,
  gstin     text,
  logo_url  text,
  timezone  text not null default 'Asia/Kolkata'
);
-- Printed on every delivery challan. Admin edits these in Admin Control.
alter table public.org_settings add column if not exists challan_terms text;
alter table public.org_settings add column if not exists challan_jurisdiction text;
alter table public.org_settings add column if not exists challan_tools_note text;
alter table public.org_settings add column if not exists challan_footer text;

insert into public.org_settings (org_id, name, tagline)
values (public.default_org(), 'DIVINE ENGINEERING SERVICES', 'Fire Fighting & Electrical Contracting')
on conflict (org_id) do nothing;

-- Seed the letterhead and challan wording from the company's printed challan.
-- Only fills blanks, so an Admin's edits are never overwritten.
update public.org_settings set
  address = coalesce(nullif(address, ''), 'SF, SHOP NO SF 241, Panchsheel Square, Crossings Republik, Ghaziabad, Uttar Pradesh, 201016'),
  phone   = coalesce(nullif(phone, ''), '+91-9212033445'),
  email   = coalesce(nullif(email, ''), 'divinemepservices@gmail.com, desindia1990@gmail.com'),
  gstin   = coalesce(nullif(gstin, ''), '09GTDPS9124P1ZP'),
  challan_jurisdiction = coalesce(nullif(challan_jurisdiction, ''), 'GHAZIABAD'),
  challan_terms = coalesce(nullif(challan_terms, ''),
    E'E. & O.E\nGoods Once Sold will not be taken back\nInterest @24% P.A will be charged if the payment is not made within the stipulated time.'),
  challan_tools_note = coalesce(nullif(challan_tools_note, ''),
    'Tools and Tackles TRANSFER are NOT FOR SALE and solely the Property of M/s DIVINE ENGINEERING SERVICES for the execution of Site purpose only, and any damage, capturing or theft of the Tools is subject to Legal action.')
where org_id = public.default_org();

-- "Now" and "today" in the company's timezone — site days run on IST, not UTC.
create or replace function public.local_now()
returns timestamp language sql stable security definer set search_path = public as $$
  select now() at time zone coalesce(
    (select timezone from public.org_settings where org_id = coalesce(public.current_org(), public.default_org())),
    'Asia/Kolkata')
$$;

-- Straight-line distance in metres between two GPS points (haversine).
create or replace function public.geo_distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns integer language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
  )))::integer
$$;

-- ---------------------------------------------------------------------------
-- 4. MASTERS
-- ---------------------------------------------------------------------------
create table if not exists public.sites (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text,
  contact    text,
  lat        numeric,
  lng        numeric,
  radius_m   integer not null default 200,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users default auth.uid()
);
alter table public.sites add column if not exists lat numeric;
alter table public.sites add column if not exists lng numeric;
alter table public.sites add column if not exists radius_m integer not null default 200;

-- Everything a delivery challan repeats for this site, so the form doesn't ask
-- for it every time. Editable by Admin on the Sites screen; a saved challan
-- keeps its own copy, so correcting a site never rewrites old paperwork.
alter table public.sites add column if not exists client_name text;       -- Bill To (who is billed)
alter table public.sites add column if not exists client_address text;
alter table public.sites add column if not exists client_gstin text;
alter table public.sites add column if not exists ship_to_name text;      -- Ship To / Place of Supply
alter table public.sites add column if not exists ship_to_address text;
alter table public.sites add column if not exists ship_to_gstin text;
alter table public.sites add column if not exists po_no text;
alter table public.sites add column if not exists work_purpose text;      -- "FIRE FIGHTING WORK"

-- Per-site attendance rules. No row = all defaults.
create table if not exists public.site_settings (
  site_id           uuid primary key references public.sites on delete cascade,
  org_id            uuid not null default public.current_org() references public.orgs(id),
  capture_mode      text not null default 'muster' check (capture_mode in ('muster', 'punch')),
  require_photo     boolean not null default false,
  require_gps       boolean not null default false,
  edit_window_hours integer not null default 24,
  shift_start       time not null default '09:00',
  shift_end         time not null default '18:00',
  grace_min         integer not null default 15,
  half_day_hours    numeric not null default 4,
  ot_after_hours    numeric not null default 9,
  ot_round_min      integer not null default 30,
  weekly_off_day    integer check (weekly_off_day between 0 and 6),  -- 0 = Sunday
  freeze_daily      boolean not null default true,  -- yesterday is closed; only Admin (or Verify) reopens it
  updated_at        timestamptz not null default now()
);
alter table public.site_settings add column if not exists freeze_daily boolean not null default true;

-- Site scoping: a login with rows here sees only those sites; no rows = all.
create table if not exists public.profile_sites (
  profile_id uuid not null references public.profiles on delete cascade,
  site_id    uuid not null references public.sites on delete cascade,
  org_id     uuid not null default public.current_org() references public.orgs(id),
  primary key (profile_id, site_id)
);

-- Named areas within a site (floors, blocks, shafts). Admin maintains the list
-- in Admin Control; the DPR "Location" dropdown reads it. Free text is still
-- allowed on a DPR task for anything not on the list.
create table if not exists public.site_areas (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.current_org() references public.orgs(id),
  site_id    uuid not null references public.sites on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users default auth.uid(),
  unique (org_id, site_id, name)
);

create or replace function public.site_in_scope(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_site is null
      or public.is_admin()
      or not exists (select 1 from public.profile_sites ps where ps.profile_id = auth.uid())
      or exists (select 1 from public.profile_sites ps where ps.profile_id = auth.uid() and ps.site_id = p_site)
$$;

create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  trade         text,
  site_id       uuid references public.sites on delete set null,
  wage_type     text not null default 'Daily',   -- Daily | Monthly (current value, synced from employee_rates)
  wage_rate     numeric not null default 0,
  phone         text,
  aadhaar_last4 text,        -- full number lives in documents (hr_documents permission)
  photo         text,        -- passport photo; 'sb://private/...' path or legacy public URL
  consent_at    timestamptz, -- worker agreed to photo/ID storage
  active        boolean not null default true,
  left_on       date,        -- last day with the company; set with active = false
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users default auth.uid()
);
alter table public.employees add column if not exists left_on date;
alter table public.employees add column if not exists photo text;
alter table public.employees add column if not exists aadhaar_last4 text;
alter table public.employees add column if not exists consent_at timestamptz;

-- Wage history: the rate that applies on a date is the latest effective_from
-- on or before it. employees.wage_type/wage_rate mirror today's rate.
create table if not exists public.employee_rates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.current_org() references public.orgs(id),
  employee_id    uuid not null references public.employees on delete cascade,
  effective_from date not null,
  wage_type      text not null default 'Daily' check (wage_type in ('Daily', 'Monthly')),
  rate           numeric not null default 0,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users default auth.uid(),
  unique (employee_id, effective_from)
);

create or replace function public.sync_employee_rate(p_employee uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.employee_rates%rowtype;
begin
  select * into r from public.employee_rates
  where employee_id = p_employee
  order by (effective_from <= public.local_now()::date) desc, effective_from desc
  limit 1;
  if not found then return; end if;
  perform set_config('gridwatch.rate_sync', 'on', true);
  update public.employees set wage_type = r.wage_type, wage_rate = r.rate
  where id = p_employee and (wage_type is distinct from r.wage_type or wage_rate is distinct from r.rate);
  perform set_config('gridwatch.rate_sync', 'off', true);
end $$;

create or replace function public.employee_rates_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_employee_rate(coalesce(new.employee_id, old.employee_id));
  return null;
end $$;
drop trigger if exists employee_rates_sync on public.employee_rates;
create trigger employee_rates_sync after insert or update or delete on public.employee_rates
  for each row execute function public.employee_rates_after();

-- A new worker gets an opening rate; a direct wage edit becomes a rate change
-- effective today. Keeps history complete however the wage is changed.
create or replace function public.employees_rate_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('gridwatch.rate_sync', true), 'off') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.employee_rates (org_id, employee_id, effective_from, wage_type, rate, note)
    values (new.org_id, new.id, date '2000-01-01', coalesce(new.wage_type, 'Daily'), coalesce(new.wage_rate, 0), 'Opening rate')
    on conflict (employee_id, effective_from) do nothing;
  elsif new.wage_type is distinct from old.wage_type or new.wage_rate is distinct from old.wage_rate then
    insert into public.employee_rates (org_id, employee_id, effective_from, wage_type, rate)
    values (new.org_id, new.id, public.local_now()::date, new.wage_type, new.wage_rate)
    on conflict (employee_id, effective_from) do update set wage_type = excluded.wage_type, rate = excluded.rate;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. SITE LOGS
-- ---------------------------------------------------------------------------
create table if not exists public.dpr (
  id            uuid primary key default gen_random_uuid(),
  date          date not null default current_date,
  site_id       uuid references public.sites on delete cascade,
  work_done     text not null,
  manpower      integer,
  weather       text,
  material_used text,
  issues        text,
  reported_by   text,
  photos        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users default auth.uid()
);

-- A day's report is now a list of tasks, each with the crew that worked on it.
-- work_done stays for the months of reports written before tasks existed (and
-- as an optional free-text summary), so it can no longer be required.
alter table public.dpr alter column work_done drop not null;

create table if not exists public.dpr_tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org() references public.orgs(id),
  dpr_id      uuid not null references public.dpr on delete cascade,
  description text not null,          -- picked from the task catalogue, or typed
  size_spec   text,
  area        text,                   -- where in the site: picked from site_areas, or typed
  qty         numeric,
  unit        text,
  remarks     text,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users default auth.uid()
);

-- Who worked on that task, and for how long. One worker can appear on several
-- tasks the same day with the hours split between them.
create table if not exists public.dpr_task_manpower (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org() references public.orgs(id),
  task_id     uuid not null references public.dpr_tasks on delete cascade,
  employee_id uuid not null references public.employees on delete cascade,
  hours       numeric check (hours is null or (hours > 0 and hours <= 24)),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users default auth.uid(),
  unique (task_id, employee_id)
);

/*
 * Save a day's report and all its tasks and crews in one call, so a half-saved
 * report can't exist. Runs as the caller, so RLS decides whether they may.
 *   p = { id?, date, site_id, weather, material_used, issues, reported_by,
 *         work_done?, photos: [],
 *         tasks: [{ description, size_spec, area, qty, unit, remarks,
 *                   manpower: [{ employee_id, hours }] }] }
 * Manpower on the report is derived: the number of different workers on the
 * day's tasks. Tasks left out of the payload are removed.
 */
create or replace function public.save_dpr(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  did uuid := nullif(p ->> 'id', '')::uuid;
  t jsonb;
  m jsonb;
  tid uuid;
  n integer := 0;
  has_tasks boolean := jsonb_array_length(coalesce(p -> 'tasks', '[]'::jsonb)) > 0;
begin
  if nullif(p ->> 'site_id', '') is null or nullif(p ->> 'date', '') is null then
    raise exception 'Choose the site and the date.' using errcode = 'P0001';
  end if;

  if did is null then
    insert into public.dpr (date, site_id, work_done, weather, material_used, issues, reported_by, photos)
    values ((p ->> 'date')::date, (p ->> 'site_id')::uuid, nullif(p ->> 'work_done', ''),
            nullif(p ->> 'weather', ''), nullif(p ->> 'material_used', ''), nullif(p ->> 'issues', ''),
            nullif(p ->> 'reported_by', ''), coalesce(array(select jsonb_array_elements_text(p -> 'photos')), '{}'))
    returning id into did;
  else
    update public.dpr set
      date = (p ->> 'date')::date, site_id = (p ->> 'site_id')::uuid,
      work_done = nullif(p ->> 'work_done', ''), weather = nullif(p ->> 'weather', ''),
      material_used = nullif(p ->> 'material_used', ''), issues = nullif(p ->> 'issues', ''),
      reported_by = nullif(p ->> 'reported_by', ''),
      photos = coalesce(array(select jsonb_array_elements_text(p -> 'photos')), '{}')
    where id = did;
    if not found then
      raise exception 'That report no longer exists, or you can''t change it.' using errcode = 'P0001';
    end if;
  end if;

  delete from public.dpr_tasks where dpr_id = did;
  for t in select * from jsonb_array_elements(coalesce(p -> 'tasks', '[]'::jsonb)) loop
    insert into public.dpr_tasks (dpr_id, description, size_spec, area, qty, unit, remarks, sort)
    values (did, t ->> 'description', nullif(t ->> 'size_spec', ''), nullif(t ->> 'area', ''),
            nullif(t ->> 'qty', '')::numeric, nullif(t ->> 'unit', ''), nullif(t ->> 'remarks', ''), n)
    returning id into tid;
    for m in select * from jsonb_array_elements(coalesce(t -> 'manpower', '[]'::jsonb)) loop
      insert into public.dpr_task_manpower (task_id, employee_id, hours)
      values (tid, (m ->> 'employee_id')::uuid, nullif(m ->> 'hours', '')::numeric)
      on conflict (task_id, employee_id) do update set hours = excluded.hours;
    end loop;
    n := n + 1;
  end loop;

  if has_tasks then
    update public.dpr set manpower = (
      select count(distinct mp.employee_id)
      from public.dpr_tasks tk join public.dpr_task_manpower mp on mp.task_id = tk.id
      where tk.dpr_id = did)
    where id = did;
  end if;

  return did;
end $$;

create table if not exists public.challans (
  id               uuid primary key default gen_random_uuid(),
  doc_no           text,
  date             date not null default current_date,
  site_id          uuid references public.sites on delete cascade,
  party            text,
  party_address    text,
  party_gstin      text,
  po_no            text,
  vehicle_no       text,
  transporter_name text,
  driver_name      text,
  driver_phone     text,
  items            jsonb not null default '[]'::jsonb,
  remarks          text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users default auth.uid()
);
alter table public.challans add column if not exists party_gstin text;
alter table public.challans add column if not exists po_no text;
-- party/party_address/party_gstin are the Bill To. Ship To is where it lands.
-- Both are copied from the site when the challan is raised and then frozen, so
-- reprinting an old challan shows what was actually sent.
alter table public.challans add column if not exists ship_to_name text;
alter table public.challans add column if not exists ship_to_address text;
alter table public.challans add column if not exists ship_to_gstin text;
alter table public.challans add column if not exists purpose text;
alter table public.challans add column if not exists kind text not null default 'material';
alter table public.challans drop constraint if exists challans_kind_check;
alter table public.challans add constraint challans_kind_check check (kind in ('material', 'tools'));

create table if not exists public.transport (
  id               uuid primary key default gen_random_uuid(),
  date             date not null default current_date,
  vehicle_no       text not null,
  transporter_name text,
  driver_name      text,
  driver_phone     text,
  from_loc         text,
  site_id          uuid references public.sites on delete set null,
  purpose          text,
  lr_no            text,
  freight          numeric,
  photos           text[] not null default '{}',
  remarks          text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users default auth.uid()
);

create table if not exists public.mtc (
  id         uuid primary key default gen_random_uuid(),
  date       date not null default current_date,
  site_id    uuid references public.sites on delete set null,
  material   text not null,
  supplier   text,
  batch_no   text,
  cert_no    text,
  test_date  date,
  result     text default 'Pending',
  photos     text[] not null default '{}',
  remarks    text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users default auth.uid()
);

create table if not exists public.drawings (
  id            uuid primary key default gen_random_uuid(),
  date          date not null default current_date,
  site_id       uuid references public.sites on delete set null,
  drawing_no    text not null,
  title         text not null,
  discipline    text,
  revision      text,
  status        text default 'For Review',
  received_from text,
  photos        text[] not null default '{}',
  remarks       text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users default auth.uid()
);

create table if not exists public.rework (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  site_id     uuid references public.sites on delete cascade,
  area        text,
  issue       text not null,
  cause       text,
  action      text,
  responsible text,
  status      text default 'Open',
  photos      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users default auth.uid()
);

-- Removed modules (no-op once dropped).
drop table if exists public.indents cascade;
drop table if exists public.site_photos cascade;

-- ---------------------------------------------------------------------------
-- 6. ATTENDANCE
--    musters            one per site per day: group photo, GPS, extra hands
--    attendance_entries one per worker per site per day: in/out, units, OT,
--                       flags, verification. This is what payroll reads.
-- ---------------------------------------------------------------------------
create table if not exists public.musters (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.current_org() references public.orgs(id),
  site_id        uuid not null references public.sites on delete cascade,
  date           date not null,
  group_photo    text,
  lat            numeric,
  lng            numeric,
  accuracy_m     numeric,
  distance_m     integer,
  visitors       text,
  note           text,
  marked_by      uuid references auth.users default auth.uid(),
  marked_by_name text,
  status         text not null default 'submitted' check (status in ('open', 'submitted', 'approved')),
  photo_live     boolean not null default false,  -- taken in the app's camera, not picked from the gallery
  approved_by    uuid references auth.users,
  approved_at    timestamptz,
  client_time    timestamptz,
  marked_at      timestamptz not null default now(),
  created_by     uuid references auth.users default auth.uid(),
  unique (org_id, site_id, date)
);
alter table public.musters add column if not exists photo_live boolean not null default false;
alter table public.musters add column if not exists approved_by uuid references auth.users;
alter table public.musters add column if not exists approved_at timestamptz;
update public.musters set status = 'approved' where status = 'verified';
alter table public.musters drop constraint if exists musters_status_check;
alter table public.musters add constraint musters_status_check check (status in ('open', 'submitted', 'approved'));

create table if not exists public.attendance_entries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.current_org() references public.orgs(id),
  muster_id     uuid references public.musters on delete set null,
  employee_id   uuid not null references public.employees on delete cascade,
  site_id       uuid not null references public.sites on delete cascade,
  date          date not null,
  in_time       time,
  out_time      time,
  units         numeric(3,2) not null default 1 check (units in (0, 0.5, 1)),
  ot_hours      numeric(4,2) not null default 0,
  status        text not null default 'present'
                check (status in ('present', 'half', 'absent', 'leave', 'holiday', 'weekly_off')),
  late_min      integer not null default 0,
  source        text not null default 'muster' check (source in ('muster', 'punch', 'self', 'import')),
  photo_url     text,
  out_photo_url text,
  lat           numeric,
  lng           numeric,
  accuracy_m    numeric,
  distance_m    integer,
  flags         text[] not null default '{}',
  verified_by   uuid references auth.users,
  verified_at   timestamptz,
  note          text,
  client_time   timestamptz,
  marked_at     timestamptz not null default now(),
  updated_at    timestamptz,
  created_by    uuid references auth.users default auth.uid(),
  unique (org_id, employee_id, site_id, date)
);

-- Can the caller still change an entry marked at p_marked_at on this site?
create or replace function public.attendance_in_window(p_site uuid, p_marked_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select p_marked_at > now() - make_interval(hours => coalesce(
    (select edit_window_hours from public.site_settings where site_id = p_site), 24))
$$;

/*
 * Attendance freezes at the end of the day it belongs to: once the date has
 * passed, the site can no longer add or change that day's marks. Admin always
 * can, and so can someone with Verify Attendance — otherwise the office could
 * never approve yesterday's crew photo. Turn it off per site with
 * site_settings.freeze_daily.
 */
create or replace function public.attendance_day_open(p_site uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.can_edit('attendance_verify')
      or not coalesce((select freeze_daily from public.site_settings where site_id = p_site), true)
      or p_date >= public.local_now()::date
$$;

create or replace function public.muster_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.sites%rowtype;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.marked_at := now();
      new.marked_by := auth.uid();
      new.created_by := auth.uid();
    end if;
  else
    new.marked_at := old.marked_at;
    new.created_by := old.created_by;
  end if;
  select * into s from public.sites where id = new.site_id;
  if new.lat is not null and s.lat is not null then
    new.distance_m := public.geo_distance_m(new.lat, new.lng, s.lat, s.lng);
  else
    new.distance_m := null;
  end if;
  return new;
end $$;
drop trigger if exists musters_before on public.musters;
create trigger musters_before before insert or update on public.musters
  for each row execute function public.muster_before();

/*
 * The server is the source of truth for everything the pay depends on:
 *  - marked_at / created_by are stamped here, not trusted from the phone
 *  - units, OT and late minutes are derived from times + site settings
 *  - flags explain why an entry needs a human look (verify queue)
 *  - the "one day's pay per worker per day" rule is enforced here
 * src/lib/attendance.js mirrors the classification for on-screen previews.
 */
create or replace function public.attendance_entry_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ss public.site_settings%rowtype;
  s public.sites%rowtype;
  hrs numeric;
  late numeric;
  other_units numeric;
  emp_name text;
  keep text[];
  is_import boolean := new.source = 'import';
  system_call boolean := auth.uid() is null;
  verifier boolean := auth.uid() is null or public.can_edit('attendance_verify');
  shift_start time;
begin
  select * into ss from public.site_settings where site_id = new.site_id;
  select * into s from public.sites where id = new.site_id;
  shift_start := coalesce(ss.shift_start, '09:00');

  -- server stamps
  if tg_op = 'INSERT' then
    if not system_call then
      new.marked_at := now();
      new.created_by := auth.uid();
    end if;
  else
    new.marked_at := old.marked_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;

  -- verification can only be set by a verifier; a later edit by anyone else
  -- sends the entry back to the queue
  if not verifier then
    if tg_op = 'INSERT' then
      new.verified_by := null;
      new.verified_at := null;
    else
      if new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at then
        raise exception 'Only someone with Verify Attendance access can confirm entries.' using errcode = 'P0001';
      end if;
      new.verified_by := null;
      new.verified_at := null;
    end if;
  end if;

  -- units, OT, late
  if new.status in ('absent', 'leave', 'holiday', 'weekly_off') then
    new.units := 0;
    new.ot_hours := 0;
    new.late_min := 0;
  else
    if new.in_time is not null and new.out_time is not null then
      hrs := extract(epoch from (new.out_time - new.in_time)) / 3600.0;
      if hrs < 0 then hrs := hrs + 24; end if;
      if new.status = 'present' and hrs < coalesce(ss.half_day_hours, 4) then
        new.status := 'half';
      end if;
      if hrs > coalesce(ss.ot_after_hours, 9) then
        new.ot_hours := floor((hrs - coalesce(ss.ot_after_hours, 9)) * 60 / greatest(coalesce(ss.ot_round_min, 30), 1))
                        * greatest(coalesce(ss.ot_round_min, 30), 1) / 60.0;
      else
        new.ot_hours := 0;
      end if;
    end if;
    new.ot_hours := greatest(coalesce(new.ot_hours, 0), 0);
    new.units := case when new.status = 'half' then 0.5 else 1 end;
    if new.in_time is not null then
      late := extract(epoch from (new.in_time - shift_start)) / 60.0;
      new.late_min := case when late > coalesce(ss.grace_min, 15) then round(late) else 0 end;
    else
      new.late_min := 0;
    end if;
  end if;

  -- hard requirements from site settings (never applied to imported history)
  if tg_op = 'INSERT' and not is_import and new.units > 0 then
    if coalesce(ss.require_photo, false) and new.photo_url is null then
      raise exception 'This site requires a photo when marking attendance.' using errcode = 'P0001';
    end if;
    if coalesce(ss.require_gps, false) and new.lat is null then
      raise exception 'This site requires GPS location when marking attendance.' using errcode = 'P0001';
    end if;
  end if;

  -- flags: keep the sticky ones, recompute the rest
  keep := array(select f from unnest(coalesce(new.flags, '{}')) f where f in ('override_allowed', 'edited_late', 'rejected'));
  if tg_op = 'UPDATE' and not public.is_admin() and not system_call then
    -- only Admin may grant a two-site override
    if 'override_allowed' = any(keep) and not ('override_allowed' = any(coalesce(old.flags, '{}'))) then
      keep := array_remove(keep, 'override_allowed');
    end if;
  end if;
  new.flags := keep;

  if new.lat is not null and s.lat is not null then
    new.distance_m := public.geo_distance_m(new.lat, new.lng, s.lat, s.lng);
    if new.distance_m > coalesce(s.radius_m, 200) then new.flags := array_append(new.flags, 'outside_radius'); end if;
  else
    new.distance_m := null;
  end if;

  if not is_import and new.units > 0 then
    if new.lat is null then new.flags := array_append(new.flags, 'no_gps'); end if;
    if new.photo_url is null then new.flags := array_append(new.flags, 'no_photo'); end if;
    if tg_op = 'INSERT' and not system_call then
      if public.local_now()::time < time '05:00' then new.flags := array_append(new.flags, 'early_mark'); end if;
      if new.date < public.local_now()::date - 1 then new.flags := array_append(new.flags, 'backdated'); end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and not system_call and not public.attendance_in_window(new.site_id, old.marked_at)
     and not ('edited_late' = any(new.flags)) then
    new.flags := array_append(new.flags, 'edited_late');
  end if;

  -- one day's pay per worker per day, across every site
  if new.units > 0 then
    select coalesce(sum(units), 0) into other_units
    from public.attendance_entries
    -- other sites only: same site + worker + day is this row (an upsert's
    -- BEFORE INSERT still sees a fresh id before it turns into an update)
    where org_id = new.org_id and employee_id = new.employee_id and date = new.date and site_id <> new.site_id;
    if other_units + new.units > 1 then
      if is_import or 'override_allowed' = any(new.flags) then
        new.flags := array_append(new.flags, 'duplicate_day');
      else
        select name into emp_name from public.employees where id = new.employee_id;
        raise exception '% is already marked at another site on %. Ask Admin if they really worked both.',
          coalesce(emp_name, 'This worker'), to_char(new.date, 'DD Mon YYYY') using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end $$;
drop trigger if exists attendance_entries_before on public.attendance_entries;
create trigger attendance_entries_before before insert or update on public.attendance_entries
  for each row execute function public.attendance_entry_before();

/*
 * Muster mode: save the muster header and every worker's entry in one call,
 * so a half-saved muster can't happen. Runs as the caller, so RLS applies.
 *   p = { site_id, date, group_photo, lat, lng, accuracy_m, visitors, note,
 *         marked_by_name, client_time,
 *         entries: [{ employee_id, status, in_time, out_time, ot_hours, note }] }
 * Workers left out of `entries` who were on this muster before are removed.
 */
create or replace function public.submit_muster(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  mid uuid;
  e jsonb;
  keep_ids uuid[] := '{}';
  v_site uuid := (p ->> 'site_id')::uuid;
  v_date date := (p ->> 'date')::date;
begin
  if v_site is null or v_date is null then
    raise exception 'Choose the site and date.' using errcode = 'P0001';
  end if;
  -- A muster is evidence: the crew photo and the location are never optional.
  if nullif(p ->> 'group_photo', '') is null then
    raise exception 'Take the crew photo before saving the muster.' using errcode = 'P0001';
  end if;
  if (p ->> 'lat') is null then
    raise exception 'Capture the site location before saving the muster.' using errcode = 'P0001';
  end if;

  -- A re-submitted muster goes back to the office for approval.
  insert into public.musters (site_id, date, group_photo, photo_live, lat, lng, accuracy_m, visitors, note, marked_by_name, client_time)
  values (v_site, v_date, p ->> 'group_photo', coalesce((p ->> 'photo_live')::boolean, false),
          (p ->> 'lat')::numeric, (p ->> 'lng')::numeric,
          (p ->> 'accuracy_m')::numeric, p ->> 'visitors', p ->> 'note', p ->> 'marked_by_name',
          (p ->> 'client_time')::timestamptz)
  on conflict (org_id, site_id, date) do update set
    group_photo = excluded.group_photo, photo_live = excluded.photo_live, lat = excluded.lat, lng = excluded.lng,
    accuracy_m = excluded.accuracy_m, visitors = excluded.visitors, note = excluded.note,
    marked_by_name = excluded.marked_by_name, client_time = excluded.client_time,
    status = 'submitted', approved_by = null, approved_at = null
  returning id into mid;

  for e in select * from jsonb_array_elements(coalesce(p -> 'entries', '[]'::jsonb)) loop
    keep_ids := keep_ids || (e ->> 'employee_id')::uuid;
    insert into public.attendance_entries (
      muster_id, employee_id, site_id, date, in_time, out_time, status, ot_hours, note,
      source, photo_url, lat, lng, accuracy_m, client_time)
    values (
      mid, (e ->> 'employee_id')::uuid, v_site, v_date,
      nullif(e ->> 'in_time', '')::time, nullif(e ->> 'out_time', '')::time,
      coalesce(nullif(e ->> 'status', ''), 'present'), coalesce((e ->> 'ot_hours')::numeric, 0), e ->> 'note',
      'muster', p ->> 'group_photo', (p ->> 'lat')::numeric, (p ->> 'lng')::numeric,
      (p ->> 'accuracy_m')::numeric, (p ->> 'client_time')::timestamptz)
    on conflict (org_id, employee_id, site_id, date) do update set
      muster_id = excluded.muster_id, in_time = excluded.in_time, out_time = excluded.out_time,
      status = excluded.status, ot_hours = excluded.ot_hours, note = excluded.note,
      photo_url = excluded.photo_url, lat = excluded.lat, lng = excluded.lng,
      accuracy_m = excluded.accuracy_m, client_time = excluded.client_time;
  end loop;

  delete from public.attendance_entries
  where muster_id = mid and source = 'muster' and not (employee_id = any(keep_ids));

  return mid;
end $$;

/*
 * Punch mode: one tap per worker. The time is the server's, not the phone's.
 *   p_kind 'in'  creates (or re-opens) today's entry with in_time = now
 *   p_kind 'out' sets out_time = now on today's entry
 */
create or replace function public.punch(
  p_employee uuid, p_site uuid, p_kind text,
  p_photo text default null, p_lat numeric default null, p_lng numeric default null,
  p_accuracy numeric default null
)
returns public.attendance_entries language plpgsql security invoker set search_path = public as $$
declare
  d date := public.local_now()::date;
  t time := date_trunc('minute', public.local_now())::time;
  r public.attendance_entries;
begin
  if p_kind = 'in' then
    insert into public.attendance_entries (employee_id, site_id, date, in_time, status, source, photo_url, lat, lng, accuracy_m, client_time)
    values (p_employee, p_site, d, t, 'present', 'punch', p_photo, p_lat, p_lng, p_accuracy, now())
    on conflict (org_id, employee_id, site_id, date) do update set
      in_time = coalesce(public.attendance_entries.in_time, excluded.in_time),
      status = case when public.attendance_entries.status in ('absent') then 'present' else public.attendance_entries.status end,
      photo_url = coalesce(public.attendance_entries.photo_url, excluded.photo_url),
      lat = coalesce(public.attendance_entries.lat, excluded.lat),
      lng = coalesce(public.attendance_entries.lng, excluded.lng),
      accuracy_m = coalesce(public.attendance_entries.accuracy_m, excluded.accuracy_m)
    returning * into r;
  elsif p_kind = 'out' then
    update public.attendance_entries
    set out_time = t, out_photo_url = coalesce(p_photo, out_photo_url)
    where employee_id = p_employee and site_id = p_site and date = d and in_time is not null
    returning * into r;
    if r.id is null then
      raise exception 'There is no IN punch today for this worker at this site.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Unknown punch type %', p_kind;
  end if;
  return r;
end $$;

/*
 * The office approves a muster against its crew photo: p_present lists the
 * workers they can actually see. Everyone else on that muster is marked absent
 * for THAT DAY only — no other day is touched. Pay counts approved entries
 * only (see computePayroll in src/lib/payroll.js).
 */
create or replace function public.approve_muster(p_muster uuid, p_present uuid[], p_note text default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  present uuid[] := coalesce(p_present, '{}'::uuid[]);
  n integer := 0;
begin
  if not exists (select 1 from public.musters where id = p_muster) then
    raise exception 'That muster no longer exists.' using errcode = 'P0001';
  end if;
  if not public.can_edit('attendance_verify') then
    raise exception 'Only someone with Verify Attendance access can approve a crew photo.' using errcode = 'P0001';
  end if;

  update public.attendance_entries
  set verified_by = auth.uid(), verified_at = now()
  where muster_id = p_muster and employee_id = any(present);
  get diagnostics n = row_count;

  update public.attendance_entries
  set status = 'absent', verified_by = auth.uid(), verified_at = now(),
      flags = array_append(array_remove(coalesce(flags, '{}'), 'rejected'), 'rejected'),
      note = concat_ws(' · ', nullif(note, ''), coalesce(nullif(p_note, ''), 'Not in the crew photo'))
  where muster_id = p_muster and not (employee_id = any(present));

  update public.musters set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_muster;
  return n;
end $$;

-- Punch mode "Close day": everyone assigned to the site with no entry anywhere
-- that day is recorded absent, so the register has no blanks.
create or replace function public.close_day(p_site uuid, p_date date)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  n integer;
begin
  insert into public.attendance_entries (employee_id, site_id, date, status, source)
  select e.id, p_site, p_date, 'absent', 'punch'
  from public.employees e
  where e.site_id = p_site and e.active
    and not exists (select 1 from public.attendance_entries a where a.employee_id = e.id and a.date = p_date)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. MONEY
-- ---------------------------------------------------------------------------
create table if not exists public.advances (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  employee_id uuid references public.employees on delete cascade,
  amount      numeric not null default 0,
  week        text,
  remarks     text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users default auth.uid()
);

-- Working days per site per month — the divisor for Monthly wages and
-- salary overrides (see src/lib/payroll.js).
create table if not exists public.working_days (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites on delete cascade,
  month      text not null,          -- 'YYYY-MM'
  total_days integer not null,
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users default auth.uid(),
  unique (site_id, month)
);

-- One payroll edit per worker per month, made on the Payroll screen. Blank
-- (null) fields fall back to what attendance and the wage history give:
--   day_rate      wage per day for the month
--   days_present  replaces the attendance count — only once the month is over
--   ot_hours      replaces the attendance overtime; paid at day_rate ÷ standard hours
--   bonus         added to net;  penalty  taken off net
create table if not exists public.salary_adjustments (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees on delete cascade,
  month        text not null,          -- 'YYYY-MM'
  day_rate     numeric,
  days_present numeric,
  ot_hours     numeric,
  bonus        numeric not null default 0,
  penalty      numeric not null default 0,
  note         text,
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users default auth.uid(),
  unique (employee_id, month)
);
alter table public.salary_adjustments drop column if exists site_id cascade;
alter table public.salary_adjustments drop constraint if exists salary_adjustments_employee_id_month_key;
alter table public.salary_adjustments add constraint salary_adjustments_employee_id_month_key unique (employee_id, month);
alter table public.salary_adjustments add column if not exists day_rate numeric;
alter table public.salary_adjustments add column if not exists days_present numeric;
alter table public.salary_adjustments add column if not exists ot_hours numeric;
alter table public.salary_adjustments add column if not exists bonus numeric not null default 0;
alter table public.salary_adjustments add column if not exists penalty numeric not null default 0;
alter table public.salary_adjustments drop constraint if exists salary_adjustments_values_check;
alter table public.salary_adjustments add constraint salary_adjustments_values_check check (
  coalesce(day_rate, 0) >= 0 and coalesce(days_present, 0) between 0 and 31
  and coalesce(ot_hours, 0) >= 0 and bonus >= 0 and penalty >= 0);

-- Days present are attendance until the month is over; after that the office
-- can correct them (for days nobody marked).
create or replace function public.salary_adjustments_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.days_present is not null
     and (tg_op = 'INSERT' or new.days_present is distinct from old.days_present)
     and auth.uid() is not null
     and public.local_now()::date <= ((new.month || '-01')::date + interval '1 month' - interval '1 day')::date then
    raise exception 'Days present can only be changed after % is over.', to_char((new.month || '-01')::date, 'FMMonth YYYY')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists salary_adjustments_before on public.salary_adjustments;
create trigger salary_adjustments_before before insert or update on public.salary_adjustments
  for each row execute function public.salary_adjustments_before();

-- How the payroll engine treats this company's wages. One row per org.
create table if not exists public.payroll_rules (
  org_id                  uuid primary key references public.orgs(id) on delete cascade,
  monthly_proration       text not null default 'by_working_days'
                          check (monthly_proration in ('by_working_days', 'full_unless_absent', 'full')),
  absent_threshold        integer not null default 0,
  default_working_days    integer not null default 26,
  standard_hours          numeric not null default 9,   -- a day's hours: day wage ÷ this = hourly wage
  ot_multiplier           numeric not null default 1.5,
  weekly_off_paid_daily   boolean not null default false,
  weekly_off_paid_monthly boolean not null default true,
  holiday_paid_daily      boolean not null default false,
  holiday_paid_monthly    boolean not null default true,
  rounding                text not null default 'rupee' check (rounding in ('none', 'rupee', 'ten')),
  updated_at              timestamptz not null default now()
);
alter table public.payroll_rules alter column standard_hours set default 9;
insert into public.payroll_rules (org_id) values (public.default_org()) on conflict (org_id) do nothing;

create table if not exists public.payroll_runs (
  id             uuid primary key default gen_random_uuid(),
  month          text not null,          -- 'YYYY-MM'
  rows           jsonb not null default '[]'::jsonb,
  totals         jsonb not null default '{}'::jsonb,
  generated_at   timestamptz not null default now(),
  created_by     uuid references auth.users default auth.uid()
);
alter table public.payroll_runs add column if not exists period_start date;
alter table public.payroll_runs add column if not exists period_end date;
alter table public.payroll_runs add column if not exists site_id uuid references public.sites on delete set null;
alter table public.payroll_runs add column if not exists status text not null default 'draft';
alter table public.payroll_runs add column if not exists finalised_at timestamptz;
alter table public.payroll_runs add column if not exists finalised_by uuid references auth.users;
alter table public.payroll_runs add column if not exists rules_snapshot jsonb;
alter table public.payroll_runs drop constraint if exists payroll_runs_status_check;
alter table public.payroll_runs add constraint payroll_runs_status_check check (status in ('draft', 'final'));
update public.payroll_runs
set period_start = (month || '-01')::date,
    period_end = ((month || '-01')::date + interval '1 month' - interval '1 day')::date
where period_start is null;

create or replace function public.payroll_run_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'final' and (tg_op = 'INSERT' or old.status is distinct from 'final') then
    new.finalised_at := now();
    new.finalised_by := auth.uid();
  elsif new.status = 'draft' then
    new.finalised_at := null;
    new.finalised_by := null;
  end if;
  return new;
end $$;
drop trigger if exists payroll_runs_before on public.payroll_runs;
create trigger payroll_runs_before before insert or update on public.payroll_runs
  for each row execute function public.payroll_run_before();

-- True when a finalised payroll run covers this date (and site). Attendance
-- and advances in a locked period are read-only for everyone but Admin.
-- (plpgsql, not sql: on an upgrade payroll_runs.org_id is only added in section 12.)
create or replace function public.period_is_locked(p_site uuid, p_date date)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.payroll_runs r
    where r.org_id = public.current_org()
      and r.status = 'final'
      and p_date between r.period_start and r.period_end
      and (r.site_id is null or r.site_id = p_site)
  );
end $$;

-- Money actually handed over. Many per worker per month (weekly payouts,
-- part payments). Replaces the old Paid/Due flag (salary_payments).
create table if not exists public.payroll_payments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org() references public.orgs(id),
  employee_id uuid not null references public.employees on delete cascade,
  run_id      uuid references public.payroll_runs on delete set null,
  month       text not null,          -- 'YYYY-MM' the payment is against
  amount      numeric not null check (amount > 0 or note is not null),
  mode        text not null default 'cash' check (mode in ('cash', 'upi', 'bank', 'cheque')),
  paid_on     date not null default current_date,
  ref         text,
  note        text,
  paid_by     uuid references auth.users default auth.uid(),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users default auth.uid()
);

-- ---------------------------------------------------------------------------
-- 8. PROCUREMENT
--    request (site) → approve → quotes (office types them in) → PO → GRN (site)
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.current_org() references public.orgs(id),
  name         text not null,
  contact_name text,
  phone        text,
  whatsapp     text,
  email        text,
  gstin        text,
  address      text,
  categories   text[] not null default '{}',
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users default auth.uid()
);

-- The category list offered when adding an item. Admin adds and removes these
-- in Admin Control; items.category stays plain text, so removing a category
-- never orphans an item.
create table if not exists public.item_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.current_org() references public.orgs(id),
  name       text not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users default auth.uid(),
  unique (org_id, name)
);

create table if not exists public.items (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default public.current_org() references public.orgs(id),
  name                text not null,
  category            text,
  unit                text,
  sizes               text[] not null default '{}',
  size_hint           text,      -- placeholder when the size is typed, not picked
  spec                text,
  preferred_vendor_id uuid references public.vendors on delete set null,
  last_price          numeric,
  last_price_at       timestamptz,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users default auth.uid(),
  unique (org_id, name)
);

create table if not exists public.purchase_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default public.current_org() references public.orgs(id),
  doc_no            text,
  site_id           uuid references public.sites on delete cascade,
  date              date not null default current_date,
  needed_by         date,
  priority          text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  status            text not null default 'submitted' check (status in (
                      'submitted', 'approved', 'rejected', 'ordered', 'partially_received',
                      'received', 'closed', 'cancelled')),
  requested_by      uuid references auth.users default auth.uid(),
  requested_by_name text,
  approved_by       uuid references auth.users,
  approved_at       timestamptz,
  decision_note     text,
  remarks           text,
  photos            text[] not null default '{}',
  fulfilled_on      date,      -- set when everything is received (last GRN date) or the request is closed
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users default auth.uid(),
  updated_at        timestamptz
);
alter table public.purchase_requests add column if not exists fulfilled_on date;

create table if not exists public.purchase_request_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.current_org() references public.orgs(id),
  request_id   uuid not null references public.purchase_requests on delete cascade,
  item_id      uuid references public.items on delete set null,
  description  text not null,
  size         text,
  qty          numeric not null check (qty > 0),
  unit         text,
  qty_ordered  numeric not null default 0,
  qty_received numeric not null default 0,
  note         text,
  sort         integer not null default 0
);

create table if not exists public.approvals (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.current_org() references public.orgs(id),
  entity     text not null,
  entity_id  uuid not null,
  decision   text not null check (decision in ('approved', 'rejected')),
  note       text,
  decided_by uuid references auth.users default auth.uid(),
  decided_at timestamptz not null default now()
);

-- items: [{ request_item_id, price, gst_pct }]
create table if not exists public.quotes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.current_org() references public.orgs(id),
  request_id    uuid not null references public.purchase_requests on delete cascade,
  vendor_id     uuid not null references public.vendors on delete cascade,
  items         jsonb not null default '[]'::jsonb,
  subtotal      numeric not null default 0,
  gst           numeric not null default 0,
  total         numeric not null default 0,
  lead_days     integer,
  valid_until   date,
  notes         text,
  attachments   text[] not null default '{}',
  received_via  text not null default 'manual' check (received_via in ('manual', 'link', 'whatsapp')),
  received_at   timestamptz not null default now(),
  created_by    uuid references auth.users default auth.uid()
);

-- items: [{ request_item_id, item_id, description, size, qty, unit, price, gst_pct }]
create table if not exists public.purchase_orders (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.current_org() references public.orgs(id),
  doc_no             text,
  date               date not null default current_date,
  request_id         uuid references public.purchase_requests on delete set null,
  vendor_id          uuid not null references public.vendors on delete restrict,
  quote_id           uuid references public.quotes on delete set null,
  deliver_to_site_id uuid references public.sites on delete set null,
  items              jsonb not null default '[]'::jsonb,
  subtotal           numeric not null default 0,
  gst                numeric not null default 0,
  total              numeric not null default 0,
  terms              text,
  status             text not null default 'draft'
                     check (status in ('draft', 'sent', 'partially_received', 'received', 'cancelled')),
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users default auth.uid()
);

-- items: [{ request_item_id, po_line, description, size, unit, qty_ordered, qty_received, qty_rejected, reason }]
create table if not exists public.goods_receipts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org() references public.orgs(id),
  doc_no           text,
  date             date not null default current_date,
  site_id          uuid references public.sites on delete cascade,
  po_id            uuid references public.purchase_orders on delete set null,
  request_id       uuid references public.purchase_requests on delete set null,
  vendor_id        uuid references public.vendors on delete set null,
  supplier_name    text,
  items            jsonb not null default '[]'::jsonb,
  challan_ref      text,
  vehicle_no       text,
  received_by_name text,
  photos           text[] not null default '{}',
  remarks          text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users default auth.uid()
);
-- The site confirms a delivery with photos of what actually turned up; the
-- office (or Admin) then accepts it. Only ACCEPTED receipts count towards the
-- request, so nothing is marked fulfilled on the site's word alone.
alter table public.goods_receipts add column if not exists status text not null default 'submitted';
alter table public.goods_receipts drop constraint if exists goods_receipts_status_check;
alter table public.goods_receipts add constraint goods_receipts_status_check
  check (status in ('submitted', 'accepted', 'rejected'));
alter table public.goods_receipts add column if not exists accepted_by uuid references auth.users;
alter table public.goods_receipts add column if not exists accepted_at timestamptz;
alter table public.goods_receipts add column if not exists decision_note text;

/*
 * A receipt is evidence: it needs at least one photo, and only someone with
 * Procurement access may accept or reject it. Accepting is what releases the
 * quantities into the request (see recompute_request).
 */
create or replace function public.goods_receipts_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- imports and migrations
  if tg_op = 'INSERT' then
    if coalesce(array_length(new.photos, 1), 0) = 0 then
      raise exception 'Add a photo of the material received before saving.' using errcode = 'P0001';
    end if;
    if new.status <> 'submitted' and not public.can_edit('procurement') then
      new.status := 'submitted';
    end if;
  elsif new.status is distinct from old.status then
    if not public.can_edit('procurement') then
      raise exception 'Only the office can accept or reject a delivery.' using errcode = 'P0001';
    end if;
    if new.status in ('accepted', 'rejected') then
      new.accepted_by := auth.uid();
      new.accepted_at := now();
    else
      new.accepted_by := null;
      new.accepted_at := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists goods_receipts_before on public.goods_receipts;
create trigger goods_receipts_before before insert or update on public.goods_receipts
  for each row execute function public.goods_receipts_before();

create table if not exists public.price_history (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org() references public.orgs(id),
  item_id     uuid not null references public.items on delete cascade,
  vendor_id   uuid references public.vendors on delete set null,
  size        text,
  price       numeric not null,
  source      text not null check (source in ('quote', 'po')),
  source_id   uuid,
  recorded_at timestamptz not null default now()
);

-- Raise a request with its lines in one go (so a half-saved request can't
-- exist). Runs as the caller: RLS decides whether they may.
--   p = { site_id, needed_by, priority, requested_by_name, remarks, photos: [],
--         items: [{ item_id, description, size, qty, unit, note }] }
create or replace function public.create_purchase_request(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  rid uuid;
begin
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item to the request.' using errcode = 'P0001';
  end if;
  insert into public.purchase_requests (doc_no, site_id, needed_by, priority, requested_by_name, remarks, photos)
  values (public.next_doc_no('PR'), (p ->> 'site_id')::uuid, nullif(p ->> 'needed_by', '')::date,
          coalesce(nullif(p ->> 'priority', ''), 'Medium'), p ->> 'requested_by_name', nullif(p ->> 'remarks', ''),
          coalesce(array(select jsonb_array_elements_text(p -> 'photos')), '{}'))
  returning id into rid;
  perform public.replace_request_items(rid, p -> 'items');
  return rid;
end $$;

-- Swap a request's lines for a new set (editing before approval).
create or replace function public.replace_request_items(p_request uuid, p_items jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.purchase_request_items where request_id = p_request;
  insert into public.purchase_request_items (request_id, item_id, description, size, qty, unit, note, sort)
  select p_request, nullif(li ->> 'item_id', '')::uuid, li ->> 'description', nullif(li ->> 'size', ''),
         (li ->> 'qty')::numeric, nullif(li ->> 'unit', ''), nullif(li ->> 'note', ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(li, ord);
end $$;

-- Roll quantities up from POs and GRNs into the request, and derive statuses.
create or replace function public.recompute_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cur text;
  total_qty numeric;
  total_ordered numeric;
  total_received numeric;
  all_received boolean;
begin
  if p_request is null then return; end if;

  update public.purchase_request_items pri set
    qty_ordered = coalesce((
      select sum((li ->> 'qty')::numeric)
      from public.purchase_orders po, jsonb_array_elements(po.items) li
      where po.request_id = p_request and po.status <> 'cancelled'
        and li ->> 'request_item_id' = pri.id::text), 0),
    qty_received = coalesce((
      select sum(coalesce((li ->> 'qty_received')::numeric, 0))
      from public.goods_receipts g, jsonb_array_elements(g.items) li
      where g.request_id = p_request and g.status = 'accepted'
        and li ->> 'request_item_id' = pri.id::text), 0)
  where pri.request_id = p_request;

  select status into cur from public.purchase_requests where id = p_request;
  if cur not in ('approved', 'ordered', 'partially_received', 'received') then return; end if;

  select sum(qty), sum(qty_ordered), sum(qty_received), bool_and(qty_received >= qty)
  into total_qty, total_ordered, total_received, all_received
  from public.purchase_request_items where request_id = p_request;

  perform set_config('gridwatch.system', 'on', true);
  update public.purchase_requests set status = case
      when coalesce(all_received, false) then 'received'
      when coalesce(total_received, 0) > 0 then 'partially_received'
      when coalesce(total_ordered, 0) > 0 then 'ordered'
      else 'approved' end,
    fulfilled_on = case when coalesce(all_received, false)
      then (select max(g.date) from public.goods_receipts g
            where g.request_id = p_request and g.status = 'accepted') end,
    updated_at = now()
  where id = p_request;
  perform set_config('gridwatch.system', 'off', true);
end $$;

create or replace function public.recompute_po(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cur text;
  n_lines integer;
  n_full integer;
  any_recv boolean;
begin
  if p_po is null then return; end if;
  select status into cur from public.purchase_orders where id = p_po;
  if cur is null or cur in ('cancelled', 'draft') then return; end if;

  with lines as (
    select (ord - 1)::int as line_no, coalesce((li ->> 'qty')::numeric, 0) as qty
    from public.purchase_orders po, jsonb_array_elements(po.items) with ordinality as x(li, ord)
    where po.id = p_po
  ), recv as (
    select (li ->> 'po_line')::int as line_no, sum(coalesce((li ->> 'qty_received')::numeric, 0)) as qty
    from public.goods_receipts g, jsonb_array_elements(g.items) li
    where g.po_id = p_po and g.status = 'accepted' and li ? 'po_line'
    group by 1
  )
  select count(*), count(*) filter (where coalesce(r.qty, 0) >= l.qty), bool_or(coalesce(r.qty, 0) > 0)
  into n_lines, n_full, any_recv
  from lines l left join recv r on r.line_no = l.line_no;

  update public.purchase_orders set status = case
      when n_lines > 0 and n_full = n_lines then 'received'
      when coalesce(any_recv, false) then 'partially_received'
      else 'sent' end
  where id = p_po;
end $$;

create or replace function public.purchase_orders_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  li jsonb;
begin
  if tg_op = 'INSERT' then
    for li in select * from jsonb_array_elements(new.items) loop
      if nullif(li ->> 'item_id', '') is not null and (li ->> 'price') is not null then
        insert into public.price_history (org_id, item_id, vendor_id, size, price, source, source_id)
        values (new.org_id, (li ->> 'item_id')::uuid, new.vendor_id, li ->> 'size', (li ->> 'price')::numeric, 'po', new.id);
        update public.items set last_price = (li ->> 'price')::numeric, last_price_at = now()
        where id = (li ->> 'item_id')::uuid;
      end if;
    end loop;
  end if;
  perform public.recompute_request(coalesce(new.request_id, old.request_id));
  if tg_op = 'UPDATE' and old.request_id is distinct from new.request_id then
    perform public.recompute_request(old.request_id);
  end if;
  return null;
end $$;
drop trigger if exists purchase_orders_after on public.purchase_orders;
create trigger purchase_orders_after after insert or update or delete on public.purchase_orders
  for each row execute function public.purchase_orders_after();

create or replace function public.goods_receipts_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recompute_po(old.po_id);
    perform public.recompute_request(old.request_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recompute_po(new.po_id);
    perform public.recompute_request(new.request_id);
  end if;
  return null;
end $$;
drop trigger if exists goods_receipts_after on public.goods_receipts;
create trigger goods_receipts_after after insert or update or delete on public.goods_receipts
  for each row execute function public.goods_receipts_after();

create or replace function public.quotes_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  li jsonb;
  itm uuid;
begin
  for li in select * from jsonb_array_elements(new.items) loop
    select item_id into itm from public.purchase_request_items where id = nullif(li ->> 'request_item_id', '')::uuid;
    if itm is not null and (li ->> 'price') is not null then
      insert into public.price_history (org_id, item_id, vendor_id, size, price, source, source_id)
      select new.org_id, itm, new.vendor_id, pri.size, (li ->> 'price')::numeric, 'quote', new.id
      from public.purchase_request_items pri where pri.id = (li ->> 'request_item_id')::uuid;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists quotes_after on public.quotes;
create trigger quotes_after after insert on public.quotes
  for each row execute function public.quotes_after();

/*
 * Request status machine. Mirrored in src/lib/procurement.js (MANUAL_TRANSITIONS).
 * Manual moves are checked here; ordered/received statuses are derived from
 * POs and GRNs by recompute_request().
 */
create or replace function public.purchase_requests_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  allowed jsonb := '{
    "submitted": ["approved", "rejected", "cancelled"],
    "rejected": ["submitted", "cancelled"],
    "approved": ["closed", "cancelled"],
    "ordered": ["closed"],
    "partially_received": ["closed"],
    "received": ["closed"],
    "closed": [],
    "cancelled": []
  }';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.requested_by := auth.uid();
      if new.status not in ('submitted') and not public.can_edit('procurement_approve') then
        new.status := 'submitted';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and coalesce(current_setting('gridwatch.system', true), 'off') <> 'on'
     and auth.uid() is not null then
    if not (allowed -> old.status) ? new.status then
      raise exception 'A request can''t move from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'rejected') then
      if not public.can_edit('procurement_approve') then
        raise exception 'Only an approver can approve or reject requests.' using errcode = 'P0001';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
      insert into public.approvals (org_id, entity, entity_id, decision, note)
      values (new.org_id, 'purchase_request', new.id, new.status, new.decision_note);
    end if;
    if new.status = 'closed' and not public.can_edit('procurement') then
      raise exception 'Only the office can close a request.' using errcode = 'P0001';
    end if;
    if new.status = 'submitted' then
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  if new.status in ('received', 'closed') then
    new.fulfilled_on := coalesce(new.fulfilled_on, public.local_now()::date);
  else
    new.fulfilled_on := null;
  end if;
  return new;
end $$;
drop trigger if exists purchase_requests_before on public.purchase_requests;
create trigger purchase_requests_before before insert or update on public.purchase_requests
  for each row execute function public.purchase_requests_before();

-- ---------------------------------------------------------------------------
-- 9. DOCUMENTS VAULT
--    scope company | site | employee | vendor, file in the private bucket.
--    Employee documents (Aadhaar etc.) need the hr_documents permission.
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.current_org() references public.orgs(id),
  scope        text not null check (scope in ('company', 'site', 'employee', 'vendor')),
  scope_id     uuid,
  category     text not null,
  title        text,
  number       text,
  files        text[] not null default '{}',
  issued_on    date,
  expires_on   date,
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users default auth.uid(),
  updated_at   timestamptz
);

-- Keep employees.aadhaar_last4 in step with the Aadhaar document.
create or replace function public.documents_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.scope = 'employee' and new.category = 'aadhaar' then
    update public.employees set aadhaar_last4 = nullif(right(regexp_replace(coalesce(new.number, ''), '\D', '', 'g'), 4), '')
    where id = new.scope_id;
  elsif tg_op = 'DELETE' and old.scope = 'employee' and old.category = 'aadhaar' then
    update public.employees set aadhaar_last4 = null where id = old.scope_id;
  end if;
  return null;
end $$;
drop trigger if exists documents_after on public.documents;
create trigger documents_after after insert or update or delete on public.documents
  for each row execute function public.documents_after();

-- ---------------------------------------------------------------------------
-- 10. AUDIT LOG  (who changed what, when — filled by trigger, read by Admin)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid references public.orgs(id),
  table_name text not null,
  row_id     text,
  action     text not null,
  old_row    jsonb,
  new_row    jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
begin
  -- SQL-editor maintenance and migrations (no signed-in user) aren't audited.
  if auth.uid() is null then return null; end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  insert into public.audit_log (org_id, table_name, row_id, action, old_row, new_row, changed_by)
  values (
    coalesce((r ->> 'org_id')::uuid, public.current_org()),
    tg_table_name,
    coalesce(r ->> 'id', r ->> 'site_id', r ->> 'module', r ->> 'profile_id', r ->> 'org_id'),
    lower(tg_op), o, n, auth.uid()
  );
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 11. DOCUMENT NUMBERING  (gap-free per company per prefix per year)
-- ---------------------------------------------------------------------------
create table if not exists public.doc_counters (
  key   text primary key,
  value integer not null default 0
);

create or replace function public.next_doc_no(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  org uuid := coalesce(public.current_org(), public.default_org());
  yr text := to_char(public.local_now(), 'YYYY');
  -- The default org keeps the original key shape so existing counters continue.
  k text := case when org = public.default_org() then p_prefix || '-' || yr
                 else org::text || ':' || p_prefix || '-' || yr end;
  n integer;
begin
  insert into public.doc_counters (key, value) values (k, 1)
  on conflict (key) do update set value = public.doc_counters.value + 1
  returning value into n;
  return p_prefix || '-' || lpad(n::text, 4, '0') || '-' || yr;
end $$;

-- ---------------------------------------------------------------------------
-- 12. CROSS-TABLE PLUMBING
-- ---------------------------------------------------------------------------

-- org_id on every business table (adds + backfills on an existing project).
do $$
declare
  t text;
begin
  foreach t in array array[
    'sites', 'employees', 'dpr', 'challans', 'transport', 'mtc', 'drawings', 'rework',
    'advances', 'working_days', 'salary_adjustments', 'payroll_runs'
  ] loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.orgs(id)', t);
    execute format('alter table public.%I alter column org_id set default public.current_org()', t);
    execute format('update public.%I set org_id = public.default_org() where org_id is null', t);
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
end $$;

-- created_by always defaults to the signed-in user, and a client can't claim
-- to be someone else: the trigger overwrites whatever was sent.
create or replace function public.stamp_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'created_by' and tb.table_type = 'BASE TABLE'
      and c.table_name not like '%\_legacy'
  loop
    execute format('alter table public.%I alter column created_by set default auth.uid()', t);
    execute format('drop trigger if exists stamp_created_by on public.%I', t);
    execute format('create trigger stamp_created_by before insert on public.%I for each row execute function public.stamp_created_by()', t);
  end loop;
end $$;

-- Entries an Admin added can only be changed or deleted by an Admin. Applies
-- to site logs. The trigger arguments name permissions whose holders may still
-- act on those rows (e.g. the office approving a request, a verifier
-- confirming attendance). Only direct writes by a signed-in user are checked
-- (current_user = authenticated); roll-ups inside security definer functions
-- run as the owner and pass.
create or replace function public.added_by_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_admin from public.profiles p join public.roles r on r.id = p.role_id where p.id = p_user), false)
$$;

create or replace function public.guard_admin_rows()
returns trigger language plpgsql set search_path = public as $$
declare
  k text;
  owner uuid;
begin
  if current_user <> 'authenticated' or public.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'purchase_request_items' then
    select r.created_by into owner from public.purchase_requests r where r.id = old.request_id;
  else
    owner := old.created_by;
  end if;
  if not public.added_by_admin(owner) then
    return coalesce(new, old);
  end if;
  foreach k in array coalesce(tg_argv, '{}'::text[]) loop
    if public.can_edit(k) then return coalesce(new, old); end if;
  end loop;
  raise exception 'This entry was added by Admin — only Admin can change or delete it.' using errcode = 'P0001';
end $$;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('musters', '''attendance_verify'''),
      ('attendance_entries', '''attendance_verify'''),
      ('dpr', ''), ('dpr_tasks', ''), ('dpr_task_manpower', ''),
      ('rework', ''), ('challans', ''), ('transport', ''), ('mtc', ''), ('drawings', ''),
      ('purchase_requests', '''procurement'', ''procurement_approve'''),
      ('purchase_request_items', '''procurement'''),
      ('goods_receipts', '''procurement'''),
      ('documents', '')
    ) as x(tbl, args)
  loop
    execute format('drop trigger if exists guard_admin_rows on public.%I', t.tbl);
    execute format('create trigger guard_admin_rows before update or delete on public.%I for each row execute function public.guard_admin_rows(%s)',
      t.tbl, t.args);
  end loop;
end $$;

drop trigger if exists employees_rate_history on public.employees;
create trigger employees_rate_history after insert or update of wage_type, wage_rate on public.employees
  for each row execute function public.employees_rate_history();

-- Audit trail on the tables where "who changed this?" matters.
do $$
declare
  t text;
begin
  foreach t in array array[
    'musters', 'attendance_entries', 'advances', 'salary_adjustments', 'payroll_runs',
    'payroll_payments', 'working_days', 'employees', 'employee_rates', 'sites', 'site_settings',
    'profile_sites', 'profiles', 'roles', 'module_locks', 'payroll_rules', 'org_settings',
    'purchase_requests', 'purchase_request_items', 'quotes', 'purchase_orders', 'goods_receipts',
    'documents', 'vendors', 'items', 'item_categories', 'site_areas'
  ] loop
    execute format('drop trigger if exists audit_row on public.%I', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12b. ONE-OFF DATA MIGRATIONS  (each runs once, then records itself)
-- ---------------------------------------------------------------------------

-- Opening wage history for workers added before employee_rates existed.
insert into public.employee_rates (org_id, employee_id, effective_from, wage_type, rate, note)
select e.org_id, e.id, date '2000-01-01',
       case when e.wage_type = 'Monthly' then 'Monthly' else 'Daily' end, e.wage_rate, 'Opening rate'
from public.employees e
where not exists (select 1 from public.employee_rates r where r.employee_id = e.id);

-- Aadhaar moves off the employees table into the restricted documents vault.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'employees' and column_name = 'aadhaar') then
    execute $m$
      insert into public.documents (org_id, scope, scope_id, category, title, number)
      select e.org_id, 'employee', e.id, 'aadhaar', 'Aadhaar', e.aadhaar
      from public.employees e
      where nullif(e.aadhaar, '') is not null
        and not exists (select 1 from public.documents d
                        where d.scope = 'employee' and d.scope_id = e.id and d.category = 'aadhaar')
    $m$;
    execute $m$
      update public.employees
      set aadhaar_last4 = nullif(right(regexp_replace(coalesce(aadhaar, ''), '\D', '', 'g'), 4), '')
      where nullif(aadhaar, '') is not null
    $m$;
    alter table public.employees drop column aadhaar;
  end if;
end $$;

-- Attendance v2: per-site muster rows (present_ids uuid[]) become one entry per
-- worker. The old table is kept as attendance_legacy for one release.
do $$
begin
  if to_regclass('public.attendance') is not null and to_regclass('public.attendance_legacy') is null then
    alter table public.attendance rename to attendance_legacy;

    insert into public.musters (org_id, site_id, date, group_photo, lat, lng, accuracy_m, visitors, note,
                                marked_by, marked_by_name, status, client_time, marked_at, created_by)
    select public.default_org(), a.site_id, a.date, a.group_photo, a.lat, a.lng, a.accuracy_m, a.visitors, a.note,
           a.created_by, a.marked_by, 'submitted', a.created_at, a.created_at, a.created_by
    from public.attendance_legacy a
    on conflict (org_id, site_id, date) do nothing;

    insert into public.attendance_entries (org_id, muster_id, employee_id, site_id, date, in_time, status,
                                           source, photo_url, lat, lng, accuracy_m, marked_at, created_by)
    select public.default_org(), m.id, e.id, a.site_id, a.date,
           nullif(a.present_times ->> pid::text, '')::time, 'present',
           'import', a.group_photo, a.lat, a.lng, a.accuracy_m, a.created_at, a.created_by
    from public.attendance_legacy a
    join public.musters m on m.org_id = public.default_org() and m.site_id = a.site_id and m.date = a.date
    cross join lateral unnest(a.present_ids) as pid
    join public.employees e on e.id = pid
    on conflict (org_id, employee_id, site_id, date) do nothing;
  end if;
end $$;

-- Paid/Due flags become payment records (amount from the last saved run, if any).
do $$
begin
  if to_regclass('public.salary_payments') is not null
     and not exists (select 1 from public.schema_migrations where key = 'salary_payments_to_payroll_payments') then
    insert into public.payroll_payments (org_id, employee_id, month, amount, mode, paid_on, note, created_by)
    select public.default_org(), sp.employee_id, sp.month,
           coalesce((
             select (x ->> 'net')::numeric
             from public.payroll_runs pr, jsonb_array_elements(pr.rows) x
             where pr.month = sp.month and x ->> 'employee_id' = sp.employee_id::text
             order by pr.generated_at desc limit 1), 0),
           'cash', coalesce(sp.paid_on, current_date), 'Marked Paid in the old app', sp.created_by
    from public.salary_payments sp
    where sp.status = 'Paid';
    alter table public.salary_payments rename to salary_payments_legacy;
    insert into public.schema_migrations (key) values ('salary_payments_to_payroll_payments');
  end if;
end $$;

-- Salary overrides were a full-month target amount; they become a wage per day
-- (target ÷ that month's working days), which is what the Payroll screen edits.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'salary_adjustments' and column_name = 'amount') then
    execute $m$
      update public.salary_adjustments sa
      set day_rate = round(sa.amount / coalesce(
            (select w.total_days from public.working_days w join public.employees e on e.site_id = w.site_id
             where e.id = sa.employee_id and w.month = sa.month limit 1),
            (select r.default_working_days from public.payroll_rules r where r.org_id = sa.org_id),
            26), 2)
      where sa.day_rate is null and sa.amount is not null
    $m$;
    alter table public.salary_adjustments drop column amount;
  end if;
end $$;

-- Pay now waits for the office to approve the crew photo. Attendance recorded
-- before that rule existed is treated as already approved, so past months keep
-- paying exactly as they did.
do $$
begin
  if not exists (select 1 from public.schema_migrations where key = 'approve_attendance_history') then
    update public.attendance_entries set verified_at = coalesce(verified_at, marked_at) where verified_at is null;
    update public.musters set status = 'approved', approved_at = coalesce(approved_at, marked_at) where status <> 'approved';
    insert into public.schema_migrations (key) values ('approve_attendance_history');
  end if;
end $$;

-- A day is 9 hours here (overtime is paid per hour of that).
do $$
begin
  if not exists (select 1 from public.schema_migrations where key = 'standard_hours_9') then
    update public.payroll_rules set standard_hours = 9 where standard_hours = 8;
    insert into public.schema_migrations (key) values ('standard_hours_9');
  end if;
end $$;

-- Item catalogue (from public/SITE REQUIREMENT TAB.xlsx). Added once per
-- company; after that the Items screen is the source of truth.
do $$
begin
  if not exists (select 1 from public.schema_migrations where key = 'seed_items_catalogue') then
    insert into public.items (org_id, name, category, unit, sizes, size_hint)
    select public.default_org(), v.name, v.category, v.unit, v.sizes, v.size_hint
    from (values
      ('M.S PIPE', 'Pipes, valves & steel', 'MTR', array['25MM','32MM','40MM','50MM','65MM','80MM','100MM','150MM','200MM','250MM','300MM'], null),
      ('G.I PIPE', 'Pipes, valves & steel', 'MTR', array['25MM','32MM','40MM','50MM','65MM','80MM','100MM','150MM','200MM','250MM','300MM'], null),
      ('BUTTERFLY VALVE', 'Pipes, valves & steel', 'NOS', array['25MM','32MM','40MM','50MM','65MM','80MM','100MM','150MM','200MM'], null),
      ('NON RETURN VALVE (NRV)', 'Pipes, valves & steel', 'NOS', array['25MM','32MM','40MM','50MM','65MM','80MM','100MM','150MM','200MM'], null),
      ('BALL VALVE', 'Pipes, valves & steel', 'NOS', array['25MM','32MM','40MM','50MM'], null),
      ('WRAPPING COATING', 'Pipes, valves & steel', 'MTR', array['2MM','4MM'], null),
      ('M.S ANGLE', 'Pipes, valves & steel', 'MTR', array['40x40x5','40x40x6','50x50x5','50x50x6','75x75x6'], null),
      ('M.S CHANNEL', 'Pipes, valves & steel', 'MTR', array['75x40','100x50','125x65','150x75'], null),
      ('WELDING ROD', 'Consumables', 'KGS', array['2.5MM','3.15MM','4.0MM'], null),
      ('CUTTING WHEEL', 'Consumables', 'NOS', array['4 INCH','5 INCH','7 INCH'], null),
      ('GRINDING WHEEL', 'Consumables', 'NOS', array['4 INCH','5 INCH','7 INCH'], null),
      ('MACHINE OIL', 'Consumables', 'NOS', array['1 LTR','5 LTR','20 LTR'], null),
      ('NUT BOLT', 'Consumables', 'NOS', array['M6','M8','M10','M12','M16'], null),
      ('BULLET FASTENER', 'Consumables', 'NOS', array['M8','M10','M12'], null),
      ('ANCHOR FASTENER', 'Consumables', 'NOS', array['M8','M10','M12','M16'], null),
      ('PAINT', 'Consumables', 'NOS', array['4 KG','8 KG','10 KG'], null),
      ('PRIMER', 'Consumables', 'NOS', array['4 KG','8 KG','10 KG'], null),
      ('PAINT BRUSH', 'Consumables', 'NOS', array['1 INCH','2 INCH','3 INCH','4 INCH'], null),
      ('TEFLON TAPE', 'Consumables', 'ROL', array['12MM','19MM','25MM'], null),
      ('THREAD SEALANT', 'Consumables', 'NOS', array['50 GM','100 GM','250 GM'], null),
      ('PTFE SEALANT', 'Consumables', 'NOS', array['100 GM','250 GM'], null),
      ('GI PIPE JOINTING COMPOUND', 'Consumables', 'NOS', array['1 KG','5 KG'], null),
      ('GASKET', 'Consumables', 'NOS', array['1/2"','3/4"','1"','1-1/4"','1-1/2"','2"','2-1/2"','3"','4"','5"','6"'], null),
      ('RUBBER SHEET', 'Consumables', 'SQM', array['2MM','3MM','5MM'], null),
      ('GI/MS PIPE', 'Consumables', 'MTR', array[]::text[], 'e.g. 25MM GI'),
      ('PIPE NIPPLES', 'Consumables', 'NOS', array['1/2"','3/4"','1"','1-1/2"'], null),
      ('GI FITTINGS', 'Consumables', 'NOS', array['1/2"','3/4"','1"','1-1/4"','1-1/2"','2"','2-1/2"','3"','4"'], null),
      ('MS FLANGES', 'Consumables', 'NOS', array[]::text[], 'e.g. 100MM'),
      ('U-CLAMP / PIPE CLAMP', 'Consumables', 'NOS', array['25MM','32MM','40MM','50MM','65MM','80MM'], null),
      ('CLEVIS HANGER', 'Consumables', 'NOS', array[]::text[], 'e.g. for 50MM pipe'),
      ('THREADED ROD', 'Consumables', 'NOS', array['6MM','8MM','10MM','12MM'], null),
      ('GI CHANNEL / STRUT', 'Consumables', 'MTR', array['41x41'], null),
      ('PVC INSULATION TAPE', 'Consumables', 'ROL', array['18MM'], null),
      ('CABLE TIES', 'Consumables', 'PAC', array['100MM','200MM','300MM'], null),
      ('ELECTRICAL CABLE LUGS', 'Consumables', 'NOS', array[]::text[], 'e.g. 2.5 SQ.MM'),
      ('HEAT SHRINK SLEEVE', 'Consumables', 'MTR', array[]::text[], 'e.g. 10MM'),
      ('SILICONE SEALANT', 'Consumables', 'NOS', array['280 ML','300 ML'], null),
      ('FIRE-RATED SEALANT', 'Consumables', 'NOS', array['300 ML','600 ML'], null),
      ('FIRE STOP MATERIAL', 'Consumables', 'NOS', array[]::text[], null),
      ('CABLE GLAND', 'Consumables', 'NOS', array[]::text[], 'e.g. 20MM'),
      ('IDENTIFICATION LABELS', 'Consumables', 'NOS', array[]::text[], null),
      ('PIPE IDENTIFICATION TAPE', 'Consumables', 'ROL', array['RED','WHITE'], null),
      ('EMERY PAPER', 'Consumables', 'NOS', array['80 GRIT','120 GRIT','180 GRIT'], null),
      ('WIRE BRUSH', 'Consumables', 'NOS', array['1 INCH','2 INCH','3 INCH'], null),
      ('COTTON WASTE', 'Consumables', 'KGS', array[]::text[], null),
      ('CLEANING SOLVENT', 'Consumables', 'NOS', array['1 LTR','5 LTR'], null),
      ('ANTI-RUST PAINT', 'Consumables', 'NOS', array['1 LTR','4 LTR','10 LTR'], null),
      ('RED OXIDE PRIMER', 'Consumables', 'NOS', array['1 LTR','4 LTR','10 LTR'], null)
    ) as v(name, category, unit, sizes, size_hint)
    on conflict (org_id, name) do nothing;
    insert into public.schema_migrations (key) values ('seed_items_catalogue');
  end if;
end $$;

-- Site Requirements become purchase requests; Material Received becomes
-- goods receipts. Old tables kept as *_legacy for one release.
do $$
declare
  r record;
  pid uuid;
begin
  if to_regclass('public.requirements') is not null and to_regclass('public.requirements_legacy') is null then
    alter table public.requirements rename to requirements_legacy;
    for r in select * from public.requirements_legacy order by date, created_at loop
      insert into public.purchase_requests (org_id, doc_no, site_id, date, needed_by, priority, status,
                                            requested_by, requested_by_name, remarks, created_at, created_by)
      values (public.default_org(), public.next_doc_no('PR'), r.site_id, r.date, r.required_by,
              case when r.priority in ('Low', 'Medium', 'High', 'Urgent') then r.priority else 'Medium' end,
              case when r.status = 'Fulfilled' then 'closed' else 'submitted' end,
              r.created_by, r.raised_by, r.remarks, r.created_at, r.created_by)
      returning id into pid;
      insert into public.purchase_request_items (org_id, request_id, item_id, description, size, qty, unit)
      values (public.default_org(), pid,
              (select i.id from public.items i where i.org_id = public.default_org() and i.name = r.item),
              r.item, r.dimension, coalesce(nullif(public.try_numeric(r.qty), 0), 1), r.unit);
    end loop;
  end if;

  if to_regclass('public.material_received') is not null and to_regclass('public.material_received_legacy') is null then
    alter table public.material_received rename to material_received_legacy;
    insert into public.goods_receipts (org_id, doc_no, date, site_id, supplier_name, items, challan_ref,
                                       vehicle_no, received_by_name, photos, remarks, created_at, created_by)
    select public.default_org(), public.next_doc_no('GRN'), m.date, m.site_id, m.supplier,
           jsonb_build_array(jsonb_build_object(
             'description', m.item, 'qty_received', public.try_numeric(m.qty), 'unit', null, 'note', m.qty)),
           m.challan_ref, m.vehicle_no, m.received_by, m.photos, m.remarks, m.created_at, m.created_by
    from public.material_received_legacy m
    order by m.date, m.created_at;
  end if;
end $$;

-- Deliveries now need the office to accept them before they count towards a
-- request. Everything received before that rule existed (including receipts
-- just migrated from the old Material Received log) is treated as accepted, so
-- no past request suddenly looks unfulfilled.
do $$
begin
  if not exists (select 1 from public.schema_migrations where key = 'accept_grn_history') then
    update public.goods_receipts
    set status = 'accepted', accepted_at = coalesce(accepted_at, created_at)
    where status = 'submitted';
    insert into public.schema_migrations (key) values ('accept_grn_history');
  end if;
end $$;

-- The category list behind the Items screen: what was already in use, plus
-- Tools and Machines. Admin edits the list from here on.
do $$
begin
  if not exists (select 1 from public.schema_migrations where key = 'seed_item_categories') then
    insert into public.item_categories (org_id, name, sort)
    select public.default_org(), v.name, v.sort
    from (values
      ('Pipes, valves & steel', 10), ('Consumables', 20), ('Fire alarm', 30),
      ('Electrical', 40), ('Tools', 50), ('Machines', 60)
    ) as v(name, sort)
    on conflict (org_id, name) do nothing;
    -- Anything already typed into an item stays a category.
    insert into public.item_categories (org_id, name, sort)
    select distinct i.org_id, i.category, 90 from public.items i
    where nullif(i.category, '') is not null
    on conflict (org_id, name) do nothing;
    insert into public.schema_migrations (key) values ('seed_item_categories');
  end if;
end $$;

-- Requests already received or closed get a fulfilled date.
update public.purchase_requests pr
set fulfilled_on = coalesce((select max(g.date) from public.goods_receipts g where g.request_id = pr.id), pr.updated_at::date, pr.date)
where pr.status in ('received', 'closed') and pr.fulfilled_on is null;

-- ---------------------------------------------------------------------------
-- 12c. INDEXES
-- ---------------------------------------------------------------------------
drop index if exists public.idx_attendance_date;
drop index if exists public.idx_attendance_site;
drop index if exists public.idx_requirements_status;
create index if not exists idx_musters_site_date on public.musters (site_id, date desc);
create index if not exists idx_entries_date on public.attendance_entries (date desc);
create index if not exists idx_entries_emp_date on public.attendance_entries (employee_id, date);
create index if not exists idx_entries_site_date on public.attendance_entries (site_id, date);
create index if not exists idx_entries_unverified on public.attendance_entries (date desc)
  where verified_at is null and flags <> '{}';
create index if not exists idx_dpr_date on public.dpr (date desc);
create index if not exists idx_dpr_tasks_dpr on public.dpr_tasks (dpr_id, sort);
create index if not exists idx_dpr_manpower_task on public.dpr_task_manpower (task_id);
create index if not exists idx_dpr_manpower_emp on public.dpr_task_manpower (employee_id);
create index if not exists idx_site_areas_site on public.site_areas (site_id, sort);
create index if not exists idx_grn_status on public.goods_receipts (status, date desc);
create index if not exists idx_advances_date on public.advances (date desc);
create index if not exists idx_employees_site on public.employees (site_id);
create index if not exists idx_employee_rates_emp on public.employee_rates (employee_id, effective_from);
create index if not exists idx_working_days_site_month on public.working_days (site_id, month);
create index if not exists idx_salary_adjustments_month on public.salary_adjustments (month);
create index if not exists idx_payroll_payments_emp_month on public.payroll_payments (employee_id, month);
create index if not exists idx_pr_status on public.purchase_requests (status, date desc);
create index if not exists idx_pri_request on public.purchase_request_items (request_id);
create index if not exists idx_quotes_request on public.quotes (request_id);
create index if not exists idx_po_request on public.purchase_orders (request_id);
create index if not exists idx_grn_po on public.goods_receipts (po_id);
create index if not exists idx_grn_request on public.goods_receipts (request_id);
create index if not exists idx_price_history_item on public.price_history (item_id, recorded_at desc);
create index if not exists idx_documents_scope on public.documents (scope, scope_id);
create index if not exists idx_documents_expiry on public.documents (expires_on) where expires_on is not null;
create index if not exists idx_audit_row on public.audit_log (table_name, row_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY
--     Read: same company, and the row's site is in the user's scope.
--     Write: that, plus edit permission on the module (and no Admin freeze).
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
  pol text;
begin
  for t in
    select * from (values
      ('sites', 'sites', 'id'),
      ('site_settings', 'sites', 'site_id'),
      ('site_areas', 'sites', 'site_id'),
      ('item_categories', 'items', null),
      ('employees', 'team', 'site_id'),
      ('employee_rates', 'team', null),
      ('dpr', 'dpr', 'site_id'),
      ('rework', 'rework', 'site_id'),
      ('challans', 'challans', 'site_id'),
      ('transport', 'transport', 'site_id'),
      ('mtc', 'mtc', 'site_id'),
      ('drawings', 'drawings', 'site_id'),
      ('working_days', 'attendance_register', 'site_id'),
      ('salary_adjustments', 'payroll', null),
      ('vendors', 'vendors', null),
      ('items', 'items', null),
      ('quotes', 'procurement', null),
      ('purchase_orders', 'procurement', 'deliver_to_site_id'),
      ('price_history', 'procurement', null)
    ) as x(tbl, module, site_col)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    foreach pol in array array['read_all', 'write_ins', 'write_upd', 'write_del', 'gw_read', 'gw_ins', 'gw_upd', 'gw_del',
                               'salary_adj_read', 'salary_adj_write'] loop
      execute format('drop policy if exists %I on public.%I', pol, t.tbl);
    end loop;

    execute format(
      'create policy gw_read on public.%I for select to authenticated using (org_id = public.current_org() and public.site_in_scope(%s))',
      t.tbl, coalesce(t.site_col, 'null'));
    execute format(
      'create policy gw_ins on public.%I for insert to authenticated with check (org_id = public.current_org() and public.can_edit(%L) and public.site_in_scope(%s))',
      t.tbl, t.module, coalesce(t.site_col, 'null'));
    execute format(
      'create policy gw_upd on public.%I for update to authenticated using (org_id = public.current_org() and public.can_edit(%L) and public.site_in_scope(%s)) with check (org_id = public.current_org() and public.can_edit(%L) and public.site_in_scope(%s))',
      t.tbl, t.module, coalesce(t.site_col, 'null'), t.module, coalesce(t.site_col, 'null'));
    execute format(
      'create policy gw_del on public.%I for delete to authenticated using (org_id = public.current_org() and public.can_edit(%L) and public.site_in_scope(%s))',
      t.tbl, t.module, coalesce(t.site_col, 'null'));
  end loop;
end $$;

-- Orgs / settings / rules: read your own company; Admin writes.
alter table public.orgs enable row level security;
drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select to authenticated using (id = public.current_org());

alter table public.org_settings enable row level security;
drop policy if exists org_settings_read on public.org_settings;
create policy org_settings_read on public.org_settings for select to authenticated using (org_id = public.current_org());
drop policy if exists org_settings_write on public.org_settings;
create policy org_settings_write on public.org_settings for update to authenticated
  using (org_id = public.current_org() and public.is_admin()) with check (org_id = public.current_org() and public.is_admin());

alter table public.payroll_rules enable row level security;
drop policy if exists payroll_rules_read on public.payroll_rules;
create policy payroll_rules_read on public.payroll_rules for select to authenticated using (org_id = public.current_org());
drop policy if exists payroll_rules_write on public.payroll_rules;
create policy payroll_rules_write on public.payroll_rules for all to authenticated
  using (org_id = public.current_org() and public.is_admin()) with check (org_id = public.current_org() and public.is_admin());

alter table public.schema_migrations enable row level security;  -- no policies: invisible to the app

-- Attendance. Edits after the site's edit window need Verify access; a
-- finalised payroll period is read-only for everyone except Admin.
alter table public.musters enable row level security;
drop policy if exists musters_read on public.musters;
create policy musters_read on public.musters for select to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id));
drop policy if exists musters_ins on public.musters;
create policy musters_ins on public.musters for insert to authenticated
  with check (org_id = public.current_org() and public.can_edit('attendance') and public.site_in_scope(site_id)
              and (public.is_admin() or not public.period_is_locked(site_id, date))
              and public.attendance_day_open(site_id, date));
drop policy if exists musters_upd on public.musters;
create policy musters_upd on public.musters for update to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id)
         and (public.is_admin() or not public.period_is_locked(site_id, date))
         and public.attendance_day_open(site_id, date)
         and ((public.can_edit('attendance') and public.attendance_in_window(site_id, marked_at))
              or public.can_edit('attendance_verify')))
  with check (org_id = public.current_org() and public.site_in_scope(site_id)
              and (public.is_admin() or not public.period_is_locked(site_id, date))
              and public.attendance_day_open(site_id, date));
drop policy if exists musters_del on public.musters;
create policy musters_del on public.musters for delete to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id)
         and (public.is_admin() or not public.period_is_locked(site_id, date))
         and public.attendance_day_open(site_id, date)
         and ((public.can_edit('attendance') and public.attendance_in_window(site_id, marked_at))
              or public.can_edit('attendance_verify')));

alter table public.attendance_entries enable row level security;
drop policy if exists entries_read on public.attendance_entries;
create policy entries_read on public.attendance_entries for select to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id));
drop policy if exists entries_ins on public.attendance_entries;
create policy entries_ins on public.attendance_entries for insert to authenticated
  with check (org_id = public.current_org() and public.can_edit('attendance') and public.site_in_scope(site_id)
              and (public.is_admin() or not public.period_is_locked(site_id, date))
              and public.attendance_day_open(site_id, date));
drop policy if exists entries_upd on public.attendance_entries;
create policy entries_upd on public.attendance_entries for update to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id)
         and (public.is_admin() or not public.period_is_locked(site_id, date))
         and public.attendance_day_open(site_id, date)
         and ((public.can_edit('attendance') and public.attendance_in_window(site_id, marked_at))
              or public.can_edit('attendance_verify')))
  with check (org_id = public.current_org() and public.site_in_scope(site_id)
              and (public.is_admin() or not public.period_is_locked(site_id, date))
              and public.attendance_day_open(site_id, date));
drop policy if exists entries_del on public.attendance_entries;
create policy entries_del on public.attendance_entries for delete to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id)
         and (public.is_admin() or not public.period_is_locked(site_id, date))
         and public.attendance_day_open(site_id, date)
         and ((public.can_edit('attendance') and public.attendance_in_window(site_id, marked_at))
              or public.can_edit('attendance_verify')));

-- Advances: logged from Weekly Advance or the Payroll screen; locked with the payroll period.
alter table public.advances enable row level security;
do $$ declare pol text; begin
  foreach pol in array array['read_all', 'write_ins', 'write_upd', 'write_del'] loop
    execute format('drop policy if exists %I on public.advances', pol);
  end loop;
end $$;
drop policy if exists advances_read on public.advances;
create policy advances_read on public.advances for select to authenticated
  using (org_id = public.current_org());
drop policy if exists advances_write on public.advances;
create policy advances_write on public.advances for all to authenticated
  using (org_id = public.current_org() and (public.can_edit('advances') or public.can_edit('payroll'))
         and (public.is_admin() or not public.period_is_locked(null, date)))
  with check (org_id = public.current_org() and (public.can_edit('advances') or public.can_edit('payroll'))
              and (public.is_admin() or not public.period_is_locked(null, date)));

-- Payroll runs: payroll editors save drafts and finalise; only Admin can reopen
-- or delete a final run.
alter table public.payroll_runs enable row level security;
do $$ declare pol text; begin
  foreach pol in array array['read_all', 'write_ins', 'write_upd', 'write_del'] loop
    execute format('drop policy if exists %I on public.payroll_runs', pol);
  end loop;
end $$;
drop policy if exists payroll_runs_read on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (org_id = public.current_org());
drop policy if exists payroll_runs_ins on public.payroll_runs;
create policy payroll_runs_ins on public.payroll_runs for insert to authenticated
  with check (org_id = public.current_org() and public.can_edit('payroll'));
drop policy if exists payroll_runs_upd on public.payroll_runs;
create policy payroll_runs_upd on public.payroll_runs for update to authenticated
  using (org_id = public.current_org() and public.can_edit('payroll') and (status = 'draft' or public.is_admin()))
  with check (org_id = public.current_org() and public.can_edit('payroll'));
drop policy if exists payroll_runs_del on public.payroll_runs;
create policy payroll_runs_del on public.payroll_runs for delete to authenticated
  using (org_id = public.current_org() and public.can_edit('payroll') and (status = 'draft' or public.is_admin()));

-- Payments: recorded from Payroll or the Attendance Register.
alter table public.payroll_payments enable row level security;
drop policy if exists payroll_payments_read on public.payroll_payments;
create policy payroll_payments_read on public.payroll_payments for select to authenticated using (org_id = public.current_org());
drop policy if exists payroll_payments_write on public.payroll_payments;
create policy payroll_payments_write on public.payroll_payments for all to authenticated
  using (org_id = public.current_org() and (public.can_edit('payroll') or public.can_edit('attendance_register')))
  with check (org_id = public.current_org() and (public.can_edit('payroll') or public.can_edit('attendance_register')));

-- Site scoping rows: you can see your own; Admin manages everyone's.
alter table public.profile_sites enable row level security;
drop policy if exists profile_sites_read on public.profile_sites;
create policy profile_sites_read on public.profile_sites for select to authenticated
  using (org_id = public.current_org() and (profile_id = auth.uid() or public.is_admin()));
drop policy if exists profile_sites_write on public.profile_sites;
create policy profile_sites_write on public.profile_sites for all to authenticated
  using (org_id = public.current_org() and public.is_admin())
  with check (org_id = public.current_org() and public.is_admin());

-- Purchase requests: site raises and edits (while submitted), office handles
-- everything; approvals are policed by the status trigger.
alter table public.purchase_requests enable row level security;
drop policy if exists pr_read on public.purchase_requests;
create policy pr_read on public.purchase_requests for select to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id));
drop policy if exists pr_ins on public.purchase_requests;
create policy pr_ins on public.purchase_requests for insert to authenticated
  with check (org_id = public.current_org() and public.site_in_scope(site_id)
              and (public.can_edit('requirements') or public.can_edit('procurement')));
drop policy if exists pr_upd on public.purchase_requests;
create policy pr_upd on public.purchase_requests for update to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id)
         and (public.can_edit('procurement') or public.can_edit('procurement_approve')
              or (public.can_edit('requirements') and status in ('submitted', 'rejected'))))
  with check (org_id = public.current_org() and public.site_in_scope(site_id));
drop policy if exists pr_del on public.purchase_requests;
create policy pr_del on public.purchase_requests for delete to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id) and status in ('submitted', 'rejected', 'cancelled')
         and (public.can_edit('requirements') or public.can_edit('procurement')));

alter table public.purchase_request_items enable row level security;
drop policy if exists pri_read on public.purchase_request_items;
create policy pri_read on public.purchase_request_items for select to authenticated
  using (org_id = public.current_org()
         and exists (select 1 from public.purchase_requests r where r.id = request_id and public.site_in_scope(r.site_id)));
drop policy if exists pri_write on public.purchase_request_items;
create policy pri_write on public.purchase_request_items for all to authenticated
  using (org_id = public.current_org() and exists (
           select 1 from public.purchase_requests r where r.id = request_id and public.site_in_scope(r.site_id)
             and (public.can_edit('procurement') or (public.can_edit('requirements') and r.status in ('submitted', 'rejected')))))
  with check (org_id = public.current_org() and exists (
           select 1 from public.purchase_requests r where r.id = request_id and public.site_in_scope(r.site_id)
             and (public.can_edit('procurement') or (public.can_edit('requirements') and r.status in ('submitted', 'rejected')))));

-- DPR tasks and their crews follow the report they belong to.
alter table public.dpr_tasks enable row level security;
drop policy if exists dpr_tasks_read on public.dpr_tasks;
create policy dpr_tasks_read on public.dpr_tasks for select to authenticated
  using (org_id = public.current_org()
         and exists (select 1 from public.dpr d where d.id = dpr_id and public.site_in_scope(d.site_id)));
drop policy if exists dpr_tasks_write on public.dpr_tasks;
create policy dpr_tasks_write on public.dpr_tasks for all to authenticated
  using (org_id = public.current_org() and public.can_edit('dpr')
         and exists (select 1 from public.dpr d where d.id = dpr_id and public.site_in_scope(d.site_id)))
  with check (org_id = public.current_org() and public.can_edit('dpr')
              and exists (select 1 from public.dpr d where d.id = dpr_id and public.site_in_scope(d.site_id)));

alter table public.dpr_task_manpower enable row level security;
drop policy if exists dpr_manpower_read on public.dpr_task_manpower;
create policy dpr_manpower_read on public.dpr_task_manpower for select to authenticated
  using (org_id = public.current_org() and exists (
    select 1 from public.dpr_tasks t join public.dpr d on d.id = t.dpr_id
    where t.id = task_id and public.site_in_scope(d.site_id)));
drop policy if exists dpr_manpower_write on public.dpr_task_manpower;
create policy dpr_manpower_write on public.dpr_task_manpower for all to authenticated
  using (org_id = public.current_org() and public.can_edit('dpr') and exists (
    select 1 from public.dpr_tasks t join public.dpr d on d.id = t.dpr_id
    where t.id = task_id and public.site_in_scope(d.site_id)))
  with check (org_id = public.current_org() and public.can_edit('dpr') and exists (
    select 1 from public.dpr_tasks t join public.dpr d on d.id = t.dpr_id
    where t.id = task_id and public.site_in_scope(d.site_id)));

alter table public.approvals enable row level security;
drop policy if exists approvals_read on public.approvals;
create policy approvals_read on public.approvals for select to authenticated using (org_id = public.current_org());

-- Goods receipts: the site receives, the office can too.
alter table public.goods_receipts enable row level security;
drop policy if exists grn_read on public.goods_receipts;
create policy grn_read on public.goods_receipts for select to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id));
drop policy if exists grn_write on public.goods_receipts;
create policy grn_write on public.goods_receipts for all to authenticated
  using (org_id = public.current_org() and public.site_in_scope(site_id)
         and (public.can_edit('material_received') or public.can_edit('procurement')))
  with check (org_id = public.current_org() and public.site_in_scope(site_id)
              and (public.can_edit('material_received') or public.can_edit('procurement')));

-- Documents: personal worker documents need hr_documents; the rest need documents.
alter table public.documents enable row level security;
drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (org_id = public.current_org() and (
    (scope = 'employee' and public.can_view('hr_documents'))
    or (scope = 'site' and public.can_view('documents') and public.site_in_scope(scope_id))
    or (scope in ('company', 'vendor') and public.can_view('documents'))));
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
  using (org_id = public.current_org() and (
    (scope = 'employee' and public.can_edit('hr_documents'))
    or (scope = 'site' and public.can_edit('documents') and public.site_in_scope(scope_id))
    or (scope in ('company', 'vendor') and public.can_edit('documents'))))
  with check (org_id = public.current_org() and (
    (scope = 'employee' and public.can_edit('hr_documents'))
    or (scope = 'site' and public.can_edit('documents') and public.site_in_scope(scope_id))
    or (scope in ('company', 'vendor') and public.can_edit('documents'))));

-- Audit log: Admin only.
alter table public.audit_log enable row level security;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (org_id = public.current_org() and public.is_admin());

-- Legacy tables kept for one release: Admin can read, nobody writes.
do $$
declare
  t text;
  pol text;
begin
  foreach t in array array['attendance_legacy', 'requirements_legacy', 'material_received_legacy', 'salary_payments_legacy'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol, t);
    end loop;
    execute format('create policy legacy_read on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Profiles: everyone in the company can read names; you edit your own name;
-- Admin changes roles and deactivates.
alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (org_id = public.current_org() or id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid() or (public.is_admin() and org_id = public.current_org()))
  with check (id = auth.uid() or (public.is_admin() and org_id = public.current_org()));
drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.is_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using (public.is_admin() and id <> auth.uid() and org_id = public.current_org());

-- A non-admin can't promote themselves by editing their own row.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role_id := old.role_id;
    new.active := old.active;
    new.org_id := old.org_id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

alter table public.roles enable row level security;
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);
drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.module_locks enable row level security;
drop policy if exists locks_read on public.module_locks;
create policy locks_read on public.module_locks for select to authenticated using (true);
drop policy if exists locks_admin_write on public.module_locks;
create policy locks_admin_write on public.module_locks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.doc_counters enable row level security;
drop policy if exists counters_read on public.doc_counters;
create policy counters_read on public.doc_counters for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 14. STORAGE
--     uploads  public   progress / material / drawing photos (links are shareable)
--     private  signed   muster photos, worker photos, documents
--                       path: {org_id}/{folder}/file — 'hr' folder needs hr_documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', true)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('private', 'private', false)
on conflict (id) do nothing;

drop policy if exists uploads_read on storage.objects;
create policy uploads_read on storage.objects
  for select using (bucket_id = 'uploads');
drop policy if exists uploads_write on storage.objects;
create policy uploads_write on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');
drop policy if exists uploads_delete on storage.objects;
create policy uploads_delete on storage.objects
  for delete to authenticated using (bucket_id = 'uploads' and (owner_id = auth.uid()::text or public.is_admin()));

drop policy if exists private_read on storage.objects;
create policy private_read on storage.objects
  for select to authenticated using (
    bucket_id = 'private'
    and (storage.foldername(name))[1] = public.current_org()::text
    and (coalesce((storage.foldername(name))[2], '') <> 'hr' or public.can_view('hr_documents')));
drop policy if exists private_write on storage.objects;
create policy private_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'private'
    and (storage.foldername(name))[1] = public.current_org()::text
    and (coalesce((storage.foldername(name))[2], '') <> 'hr' or public.can_edit('hr_documents')));
drop policy if exists private_delete on storage.objects;
create policy private_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'private' and (owner_id = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------------
-- 15. REALTIME
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sites', 'site_settings', 'employees', 'employee_rates', 'musters', 'attendance_entries',
    'dpr', 'challans', 'transport', 'mtc', 'drawings', 'rework', 'advances',
    'payroll_runs', 'payroll_payments', 'working_days', 'salary_adjustments',
    'profiles', 'roles', 'module_locks', 'profile_sites', 'org_settings', 'payroll_rules',
    'items', 'item_categories', 'vendors', 'purchase_requests', 'purchase_request_items', 'quotes',
    'purchase_orders', 'goods_receipts', 'documents', 'site_areas', 'dpr_tasks', 'dpr_task_manpower'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =============================================================================
-- DONE.  Fresh project: create your first login (Authentication -> Users ->
-- Add user). That first account automatically becomes Admin.
-- =============================================================================
