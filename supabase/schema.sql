-- =============================================================================
-- GRIDWATCH — full database schema
-- Run this ONCE in the Supabase SQL Editor on a brand new project.
-- Safe to re-run: everything is written with "if not exists" / "or replace".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ROLES  (who can do what, per module)
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id          text primary key,
  name        text not null,
  is_admin    boolean not null default false,
  permissions jsonb  not null default '{}'::jsonb
);

-- Module keys used everywhere in the app and in the permission maps:
--   attendance, dpr, requirements, material_received, site_photos,
--   challans, transport, mtc, drawings, rework, sites, team, advances,
--   attendance_register
-- Values: 'none' | 'view' | 'edit'
-- 'team' covers both the worker roster and payroll (they're one screen).

insert into public.roles (id, name, is_admin, permissions) values
  ('admin', 'Admin', true, '{}'::jsonb),
  ('site', 'Site Team', false, '{
     "attendance":"edit","dpr":"edit","requirements":"edit","site_photos":"edit",
     "material_received":"edit","rework":"edit","challans":"edit",
     "transport":"edit","mtc":"edit","drawings":"view","sites":"view",
     "team":"none","advances":"none","attendance_register":"none"}'::jsonb),
  ('office', 'Office / Store', false, '{
     "attendance":"view","dpr":"view","requirements":"edit","site_photos":"view",
     "material_received":"edit","rework":"view","challans":"edit",
     "transport":"edit","mtc":"edit","drawings":"edit","sites":"edit",
     "team":"edit","advances":"edit","attendance_register":"none"}'::jsonb),
  ('viewer', 'Viewer', false, '{
     "attendance":"view","dpr":"view","requirements":"view","site_photos":"view",
     "material_received":"view","rework":"view","challans":"view",
     "transport":"view","mtc":"view","drawings":"view","sites":"view",
     "team":"view","advances":"view","attendance_register":"view"}'::jsonb)
on conflict (id) do nothing;

-- Upgrade path: Payroll used to be its own permission key, gating its own
-- tab. It's now folded into the Team tab and shares the "team" key, so any
-- existing role's "payroll" permission is merged into "team" (edit beats
-- view beats none) and the now-unused key is dropped. No-op on a fresh
-- install, and a no-op on repeat runs once the key is gone.
update public.roles
set permissions = (permissions - 'payroll') || jsonb_build_object(
  'team',
  case
    when coalesce(permissions->>'team', 'none') = 'edit' or coalesce(permissions->>'payroll', 'none') = 'edit' then 'edit'
    when coalesce(permissions->>'team', 'none') = 'view' or coalesce(permissions->>'payroll', 'none') = 'view' then 'view'
    else 'none'
  end
)
where permissions ? 'payroll';

-- Upgrade path: Site Indent was merged into Site Requirements — one module
-- instead of two doing the same job. Drop the now-unused permission key from
-- existing roles. No-op on a fresh install, and a no-op once the key is gone.
update public.roles set permissions = permissions - 'indents' where permissions ? 'indents';

-- ---------------------------------------------------------------------------
-- 2. PROFILES  (one row per login, auto-created on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null default 'New User',
  phone      text,
  role_id    text not null default 'viewer' references public.roles(id),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Every new auth user automatically gets a profile.
-- The FIRST user ever to sign up becomes Admin; everyone after that is a Viewer
-- until the Admin promotes them from the in-app Admin Control screen.
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

-- ---------------------------------------------------------------------------
-- 3. MODULE LOCKS  (admin can freeze a module once a month is finalised)
-- ---------------------------------------------------------------------------
create table if not exists public.module_locks (
  module text primary key,
  locked boolean not null default false
);

-- Upgrade path: fold a frozen "payroll" section (now part of the Team tab)
-- into "team". No-op on a fresh install, and a no-op once "payroll" is gone.
insert into public.module_locks (module, locked)
select 'team', true from public.module_locks where module = 'payroll' and locked
on conflict (module) do update set locked = true;
delete from public.module_locks where module = 'payroll';

-- ---------------------------------------------------------------------------
-- 4. PERMISSION HELPERS  (used by every Row Level Security policy below)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin
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

-- ---------------------------------------------------------------------------
-- 5. MASTER DATA
-- ---------------------------------------------------------------------------
create table if not exists public.sites (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text,
  contact    text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users
);

create table if not exists public.employees (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  trade      text,
  site_id    uuid references public.sites on delete set null,
  wage_type  text not null default 'Daily',   -- Daily | Monthly
  wage_rate  numeric not null default 0,
  phone      text,
  aadhaar    text,
  photo      text,          -- passport-sized photo, stored in the uploads bucket
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users
);
alter table public.employees add column if not exists aadhaar text;
alter table public.employees add column if not exists photo text;

-- ---------------------------------------------------------------------------
-- 6. SITE MODULES
-- ---------------------------------------------------------------------------

-- Daily muster: ONE row per site per day.
create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  site_id      uuid not null references public.sites on delete cascade,
  present_ids  uuid[] not null default '{}',
  present_times jsonb not null default '{}'::jsonb,
  visitors     text,
  group_photo  text,
  lat          numeric,
  lng          numeric,
  accuracy_m   numeric,
  marked_by    text,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users,
  unique (date, site_id)
);
alter table public.attendance add column if not exists present_times jsonb not null default '{}'::jsonb;

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
  created_by    uuid references auth.users
);

create table if not exists public.requirements (
  id         uuid primary key default gen_random_uuid(),
  date       date not null default current_date,
  site_id    uuid references public.sites on delete cascade,
  item       text not null,
  qty        text,
  unit       text,
  priority   text default 'Medium',
  status     text default 'Open',
  raised_by  text,
  remarks    text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users
);
alter table public.requirements add column if not exists unit text;

-- Upgrade path: Site Indent duplicated Site Requirements, so it's gone —
-- drop the table (and its data) for any project that already has it. Safe
-- to re-run; no-op once it's been dropped once.
drop table if exists public.indents cascade;
delete from public.module_locks where module = 'indents';

create table if not exists public.material_received (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  site_id     uuid references public.sites on delete cascade,
  item        text not null,
  qty         text,
  supplier    text,
  vehicle_no  text,
  challan_ref text,
  received_by text,
  photos      text[] not null default '{}',
  remarks     text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users
);

create table if not exists public.site_photos (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default current_date,
  site_id     uuid references public.sites on delete cascade,
  area        text,
  caption     text,
  uploaded_by text,
  photos      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users
);

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
  created_by       uuid references auth.users
);
alter table public.challans add column if not exists party_gstin text;
alter table public.challans add column if not exists po_no text;

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
  created_by       uuid references auth.users
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
  created_by uuid references auth.users
);

create table if not exists public.drawings (
  id         uuid primary key default gen_random_uuid(),
  date       date not null default current_date,
  site_id    uuid references public.sites on delete set null,
  drawing_no text not null,
  title      text not null,
  discipline text,
  revision   text,
  status     text default 'For Review',
  received_from text,
  photos     text[] not null default '{}',
  remarks    text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users
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
  created_by  uuid references auth.users
);

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
  created_by  uuid references auth.users
);

create table if not exists public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  month        text not null,          -- 'YYYY-MM'
  rows         jsonb not null default '[]'::jsonb,
  totals       jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_by   uuid references auth.users
);

-- One row per site per month: how many working days that month had, so the
-- Attendance Register can dock pay for days nobody marked the worker present.
create table if not exists public.working_days (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites on delete cascade,
  month      text not null,          -- 'YYYY-MM'
  total_days integer not null,
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  unique (site_id, month)
);

-- Manual override of one worker's calculated salary for one month — a raise
-- that took effect mid-month, a bonus, a correction. One override per worker
-- per month, editable from either the Attendance Register or the Team tab's
-- payroll section; the override is a full-month target and wins over
-- whatever the attendance/wage math would otherwise give (the Attendance
-- Register prorates it by days elapsed, same as the calculated figure).
create table if not exists public.salary_adjustments (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees on delete cascade,
  month       text not null,          -- 'YYYY-MM'
  amount      numeric not null,
  note        text,
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users,
  unique (employee_id, month)
);
-- Upgrade path: an earlier version of this schema scoped the override to a
-- site (site_id not null, unique on site_id+employee_id+month). Reconcile
-- that shape into the current one — no-op on a fresh install.
alter table public.salary_adjustments drop column if exists site_id cascade;
alter table public.salary_adjustments drop constraint if exists salary_adjustments_employee_id_month_key;
alter table public.salary_adjustments add constraint salary_adjustments_employee_id_month_key unique (employee_id, month);

-- ---------------------------------------------------------------------------
-- 8. DOCUMENT NUMBERING  (gap-free, survives deletions — unlike counting rows)
-- ---------------------------------------------------------------------------
create table if not exists public.doc_counters (
  key   text primary key,
  value integer not null default 0
);

create or replace function public.next_doc_no(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  k text := p_prefix || '-' || to_char(now(), 'YYYY');
  n integer;
begin
  insert into public.doc_counters (key, value) values (k, 1)
  on conflict (key) do update set value = public.doc_counters.value + 1
  returning value into n;
  return p_prefix || '-' || lpad(n::text, 4, '0') || '-' || to_char(now(), 'YYYY');
end $$;

-- ---------------------------------------------------------------------------
-- 9. HELPFUL INDEXES
-- ---------------------------------------------------------------------------
create index if not exists idx_attendance_date on public.attendance (date desc);
create index if not exists idx_attendance_site on public.attendance (site_id);
create index if not exists idx_dpr_date on public.dpr (date desc);
create index if not exists idx_requirements_status on public.requirements (status);
create index if not exists idx_advances_date on public.advances (date desc);
create index if not exists idx_employees_site on public.employees (site_id);
create index if not exists idx_working_days_site_month on public.working_days (site_id, month);
create index if not exists idx_salary_adjustments_month on public.salary_adjustments (month);

-- ---------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
--     Read: any signed-in user. Write: gated by role permission + module lock.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('sites','sites'), ('employees','team'), ('attendance','attendance'),
      ('dpr','dpr'), ('requirements','requirements'),
      ('material_received','material_received'), ('site_photos','site_photos'),
      ('challans','challans'), ('transport','transport'), ('mtc','mtc'),
      ('drawings','drawings'), ('rework','rework'), ('advances','advances'),
      ('payroll_runs','team'), ('working_days','attendance_register')
    ) as x(tbl, module)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);

    execute format('drop policy if exists read_all on public.%I', t.tbl);
    execute format(
      'create policy read_all on public.%I for select to authenticated using (true)', t.tbl);

    execute format('drop policy if exists write_ins on public.%I', t.tbl);
    execute format(
      'create policy write_ins on public.%I for insert to authenticated with check (public.can_edit(%L))',
      t.tbl, t.module);

    execute format('drop policy if exists write_upd on public.%I', t.tbl);
    execute format(
      'create policy write_upd on public.%I for update to authenticated using (public.can_edit(%L)) with check (public.can_edit(%L))',
      t.tbl, t.module, t.module);

    execute format('drop policy if exists write_del on public.%I', t.tbl);
    execute format(
      'create policy write_del on public.%I for delete to authenticated using (public.can_edit(%L))',
      t.tbl, t.module);
  end loop;
end $$;

-- Salary adjustments: editable from either Team (payroll) or the Attendance
-- Register, so either permission (respecting that screen's own freeze) is
-- enough to write.
alter table public.salary_adjustments enable row level security;
-- Upgrade path: drop the policies an earlier version of this schema created
-- for this table via the generic per-module loop above.
drop policy if exists read_all on public.salary_adjustments;
drop policy if exists write_ins on public.salary_adjustments;
drop policy if exists write_upd on public.salary_adjustments;
drop policy if exists write_del on public.salary_adjustments;
drop policy if exists salary_adj_read on public.salary_adjustments;
create policy salary_adj_read on public.salary_adjustments
  for select to authenticated using (true);
drop policy if exists salary_adj_write on public.salary_adjustments;
create policy salary_adj_write on public.salary_adjustments
  for all to authenticated
  using (public.can_edit('team') or public.can_edit('attendance_register'))
  with check (public.can_edit('team') or public.can_edit('attendance_register'));

-- Profiles: everyone signed in can read the staff list (needed to show names);
-- you may edit your own name/phone; only Admin may change roles or delete.
alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.is_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using (public.is_admin() and id <> auth.uid());

-- Roles: readable by all, editable by Admin only.
alter table public.roles enable row level security;
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);
drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Module locks: readable by all, toggled by Admin only.
alter table public.module_locks enable row level security;
drop policy if exists locks_read on public.module_locks;
create policy locks_read on public.module_locks for select to authenticated using (true);
drop policy if exists locks_admin_write on public.module_locks;
create policy locks_admin_write on public.module_locks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Doc counters: any signed-in user may consume a number via next_doc_no().
alter table public.doc_counters enable row level security;
drop policy if exists counters_read on public.doc_counters;
create policy counters_read on public.doc_counters for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 11. STORAGE  (photo uploads)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

drop policy if exists uploads_read on storage.objects;
create policy uploads_read on storage.objects
  for select using (bucket_id = 'uploads');

drop policy if exists uploads_write on storage.objects;
create policy uploads_write on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');

drop policy if exists uploads_delete on storage.objects;
create policy uploads_delete on storage.objects
  for delete to authenticated using (bucket_id = 'uploads');

-- ---------------------------------------------------------------------------
-- 12. REALTIME  (live updates in the office while site is typing)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sites','employees','attendance','dpr','requirements',
    'material_received','site_photos','challans','transport','mtc',
    'drawings','rework','advances','payroll_runs','working_days','salary_adjustments',
    'profiles','module_locks'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =============================================================================
-- DONE.  Next: create your first login (Authentication -> Users -> Add user).
-- That first account automatically becomes Admin.
-- =============================================================================
