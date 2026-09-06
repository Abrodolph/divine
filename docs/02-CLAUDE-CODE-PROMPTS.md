# Gridwatch — Claude Code prompts for the big tasks

Companion to `01-ANALYSIS-AND-ROADMAP.md`. One prompt per roadmap phase (plus a few utilities). Paste one prompt per session, in order. Don't skip a phase's exit test to start the next prompt.

---

## How to use these

1. **Start every session in `gridwatch/`** and open with plan mode (`/plan` or "plan first, don't write code yet"). Approve the plan before implementation.
2. **Paste the preamble below, then the prompt.** The preamble is the same each time; it stops Claude from re-deriving conventions or drifting from the architecture.
3. **One phase, one branch, one PR.** Commit at each green checkpoint inside the phase, not once at the end.
4. **After each phase**: ask Claude to update `CLAUDE.md` and write `docs/decisions/NNNN-<title>.md` (one paragraph: what was decided, why, what was rejected).
5. **Apply migrations yourself** with `supabase db push` (after Phase 1) and test on the deployed app on a real phone before calling a phase done.
6. If a prompt is too big for one session, tell Claude "stop after step N and summarise state in `docs/WIP.md`", then continue next session with "read `docs/WIP.md` and continue".

### Preamble (paste before every prompt)

```
Before doing anything, read `CLAUDE.md`, `docs/01-ANALYSIS-AND-ROADMAP.md`
(especially the section for this phase) and any files in `docs/decisions/`.

Ground rules for this codebase:
- Stack stays React + Vite + Tailwind v4 + Supabase, deployed as a static PWA.
  No new server unless it is a Supabase Edge Function. No new state library.
- Authorisation is enforced twice: UI via `modules.js`/`AuthContext`, and for
  real via Postgres RLS. Every new table gets RLS. If they disagree, the DB wins.
- Every table has `org_id` (after Phase 1) and policies filter on
  `current_org()`. Never write a policy without it.
- Schema changes are Supabase CLI migrations in `supabase/migrations/`
  (after Phase 1). Never edit an already-applied migration; add a new one.
- Mobile-first: every screen must work on a 360px-wide Android phone with one
  hand. Test the layout at 360x740 before calling it done.
- Money and attendance logic lives in pure functions in `src/lib/` with Vitest
  tests. Components call those functions; they don't contain formulas.
- Don't add dependencies without saying why in the plan. Prefer what's there.
- Keep the registry pattern: new modules are registered in
  `src/config/modules.js`; plain logs use `RecordManager` + `fields.js`.
- Plan first. Show me the plan (files to touch, migrations, tests, risks) and
  wait for approval before writing code.
- When done: run lint + tests, list what you verified by hand, update
  `CLAUDE.md` for anything a future session needs to know, and propose the
  `docs/decisions/` entry text.
```

---

## Phase 0 — Deploy and pilot (no prompt needed, but a checklist)

Do this by hand or ask Claude for help with specific errors:

- Create the Supabase project (Mumbai), run `supabase/schema.sql`, create the first login (becomes Admin), fill `src/config/company.js`, deploy to Netlify with the two env vars.
- Add sites, team, and two more logins (office, one supervisor). Set roles.
- Run 2 weeks. Keep a list in `docs/pilot-notes.md`: confusions, wishes, bugs.

Optional prompt if something breaks:

```
The deployed app at <url> shows <error/behaviour> when <user role> does <action>
on <device/browser>. Here is the console/network output: <paste>. Diagnose the
root cause (check RLS policies in supabase/schema.sql and the relevant module)
and propose the smallest fix. Don't refactor.
```

---

## Phase 1 — Foundation and hardening

```
PHASE 1: Foundation and hardening. This phase changes nothing the pilot users
can see, except bug fixes. Work through the steps in order and stop for review
after steps 2 and 5.

STEP 1 — Supabase CLI and migrations
- Initialise the Supabase CLI in this repo (`supabase init`), keep
  `supabase/config.toml` committed. Do NOT delete `supabase/schema.sql` yet.
- Produce `supabase/migrations/0001_baseline.sql` that recreates exactly the
  current live schema (tables, functions, triggers, policies, storage bucket,
  realtime publication). It must apply cleanly on an empty database via
  `supabase db reset` and be a no-op against the live project (document the
  command to verify that: `supabase db diff` should be empty).
- Rename `schema.sql` to `supabase/schema.legacy.sql` with a header saying it
  is frozen and migrations are the source of truth.
- Update README and CLAUDE.md: the deployment step is now `supabase db push`.

STEP 2 — Tooling
- ESLint (flat config) with react + react-hooks plugins; `npm run lint`.
- Vitest with jsdom; `npm test`. Add a first real test for `src/lib/csv.js`
  and `src/lib/format.js`.
- Playwright with one smoke test: the login page renders (no Supabase needed).
- GitHub Actions workflow: lint + unit tests on every push and PR.
- pgTAP: `supabase/tests/` with `supabase test db` wired up and one passing
  test that asserts RLS is enabled on every public table.
Stop here for review.

STEP 3 — Bug fixes (each its own commit)
- B1: `today()` and `thisMonth()` in `src/lib/format.js` use UTC via
  toISOString(). Make them local-date. Add tests that mock the clock at
  02:00 IST and prove the date is correct. Grep for other `toISOString()`
  date usage and fix the same way.
- B4: add `created_by uuid default auth.uid()` on every table that has
  `created_by`, and stop sending it from `useRecords.add`. pgTAP test: an
  insert that claims a different created_by is overwritten or rejected.
- B6: add `lat numeric, lng numeric, radius_m integer default 200` to
  `sites`; the Sites screen gets a "Capture location" button reusing
  `src/lib/geo.js` and shows a maps link. Attendance shows distance from
  the site next to the captured GPS and a warning if outside radius (flag
  only, no blocking yet).
- B7: new table `site_settings (site_id pk, require_photo bool default false,
  require_gps bool default false, edit_window_hours int default 24,
  shift_start time default '09:00', shift_end time default '18:00',
  grace_min int default 15)` editable from the Sites screen by roles with
  edit on `sites`. Attendance enforces require_photo / require_gps in the UI
  and via a check in a `before insert` trigger (server-side), and the edit
  window via RLS: update allowed if created within the window OR the user
  is admin. Tests in pgTAP.
- Dashboard: push the site filter into the queries instead of filtering
  `limit(5)` results client-side.

STEP 4 — PII and storage
- B2: create `employee_documents (id, employee_id, kind text check
  ('aadhaar','pan','bank','photo','police_verification','medical',
  'induction','other'), number text, file_url text, issued_on, expires_on,
  notes, created_at, created_by)`. Move `employees.aadhaar` data into it
  (kind='aadhaar'), then drop the column from `employees`. RLS: read only
  for admin or roles with a new permission key `hr_documents` = 'view'/'edit';
  write only 'edit'. Register `hr_documents` in `modules.js` (Setup group,
  behind Team) and in the default roles (admin only). Team screen shows
  "Aadhaar ••••1234" for those who can read it, nothing for others.
- B3: create a private storage bucket `private`. Muster photos and anything
  under `employee_documents` upload there; add `getSignedUrl(path, 3600)` in
  `src/lib/upload.js` and use it wherever those photos are displayed.
  Progress/DPR/material photos stay in the public `uploads` bucket.
  Tighten `uploads_delete` and the new bucket's delete policy to owner
  (`owner = auth.uid()`) or admin. Keep old public URLs working.
Stop here for review.

STEP 5 — Tenancy column and audit log
- Create `orgs (id uuid pk, name, created_at)`, insert one org for the
  current company, add `org_id uuid not null references orgs default
  current_org()` to every business table and to `roles`, `module_locks`,
  `doc_counters`, `site_settings`. Add `profiles.org_id`. Define
  `current_org()` as `security definer stable` returning the caller's
  profile org. Backfill existing rows. Update every RLS policy to include
  `org_id = current_org()`. `next_doc_no` keys its counter by org.
  Storage paths become `{org_id}/...` for new uploads.
- Move `src/config/company.js` values into `org_settings (org_id pk, name,
  tagline, address, phone, email, gstin, logo_url)` loaded in
  `AppDataContext`; keep `company.js` as the fallback for one release then
  delete it. Admin Control gets a "Company details" card.
- `audit_log (id, org_id, table_name, row_id, action, old_row jsonb,
  new_row jsonb, changed_by, changed_at)` with a generic trigger function
  attached to: attendance, advances, salary_adjustments, payroll_runs,
  working_days, employees, sites, roles, module_locks. Readable by admin.
  No UI yet beyond a raw list under Admin Control.
- pgTAP: a user from a second test org cannot see or write the first org's
  rows in any table; audit rows are written on update/delete.

STEP 6 — Cleanup
- The old prototype `../gridwatch (1).jsx` lives outside this repo; leave it
  alone and add one line to README saying it is archived and superseded.
  Extract the duplicated
  `nextMonthStart`, `Info`, `Line` helpers from Payroll.jsx and
  AttendanceRegister.jsx into `src/lib/dates.js` and `src/components/ui.jsx`.
- Update CLAUDE.md: migrations workflow, test commands, org_id rule,
  private bucket rule, audit log, site_settings.

ACCEPTANCE
- `npm run lint`, `npm test`, `supabase test db` all green in CI.
- `supabase db reset` from migrations produces a working app locally.
- On the deployed pilot: nothing visibly changed except the fixes; Aadhaar
  is hidden from Viewer; a muster far from site shows the distance warning.
```

---

## Phase 2 — Attendance v2

```
PHASE 2: Attendance v2. Replace the per-site-per-day `attendance` model with
one row per worker per day, support two capture modes, and add owner-side
verification. Read §5.1 of the roadmap first. Plan, then stop for approval.

DATA MODEL (migration)
- `musters (id, org_id, site_id, date, group_photo_url, lat, lng, accuracy_m,
  distance_m, marked_by profile_id, marked_by_name text, note, status
  ('open','submitted','verified'), client_time timestamptz, marked_at
  timestamptz default now(), unique (org_id, site_id, date))`.
- `attendance_entries (id, org_id, muster_id nullable, employee_id, site_id,
  date, in_time time, out_time time, units numeric(3,2) default 1
  check units in (0, 0.5, 1), ot_hours numeric(4,2) default 0,
  status text check in ('present','half','absent','leave','holiday','weekly_off'),
  late_min int default 0, source text check in ('muster','punch','self','import'),
  photo_url, lat, lng, accuracy_m, distance_m, flags text[] default '{}',
  verified_by, verified_at, note, created_by default auth.uid(),
  marked_at timestamptz default now(), client_time timestamptz,
  updated_at, unique (org_id, employee_id, site_id, date))`.
- Trigger `before insert or update`: compute `late_min` from site_settings
  shift_start + grace; compute `distance_m` from the site's lat/lng if both
  present; set flags: 'outside_radius', 'no_photo' (if site requires it),
  'edited_late' (updated after edit window), 'early_mark' (before 05:00
  local), 'duplicate_day' (another site has this employee with units > 0 on
  the same date). Never block on flags except the hard requirements from
  site_settings (require_photo / require_gps) which raise an exception with
  a friendly message.
- Constraint via trigger: sum(units) per (org, employee, date) across sites
  must not exceed 1 unless the row has flag 'override_allowed' (set only by
  admin).
- Migration of data: for each old `attendance` row create a muster and one
  entry per `present_ids` element with in_time = present_times[id] (or
  shift_start), units 1, status 'present', source 'muster'. Keep the old
  table renamed to `attendance_legacy` for one release. Realtime publication
  updated. RLS: module key stays `attendance`; add module key
  `attendance_verify` (edit = can set verified_by/status verified).

SITE SETTINGS additions
- `capture_mode text default 'muster' check in ('muster','punch')`,
  `half_day_hours numeric default 4`, `ot_after_hours numeric default 9`,
  `ot_round_min int default 30`, `weekly_off_day int nullable`.

UI — Attendance screen (rewrite `src/modules/Attendance.jsx`)
- Header picks site + date (defaults: site filter / today). The screen
  adapts to the site's capture_mode:
  MUSTER mode: keep the current tick-list feel. Each ticked worker gets
  in-time (default shift_start) and an optional out-time; a "Half day"
  toggle sets units 0.5. One group photo (live capture only when
  require_photo), GPS capture with distance shown. Submit writes the
  muster + entries in one RPC (`submit_muster(jsonb)`) so it is atomic.
  PUNCH mode: a roster list with a big "IN" button per worker; tapping it
  captures time (server), optional selfie (live camera, front-facing) and
  GPS, creates the entry. Later the same row shows "OUT". Units, OT and
  late are computed on OUT (or at day close). A "Close day" button marks
  everyone without an IN as absent (status 'absent', units 0) so the
  register is complete.
- Both modes: an "Extra hands" free-text field lives on the muster.
- After the edit window, the form is read-only for non-verifiers with a
  banner saying who to ask.
- List below the form: one card per day/site with headcount, flags count,
  photo thumbnail (signed URL), and a "Verified" badge.

UI — Verify screen (new `src/modules/AttendanceVerify.jsx`, module key
`attendance_verify`, group Site, admin + a new 'owner' permission default)
- Queue of entries with flags, grouped by site/date, newest first. Each row:
  worker, site, time, flags as chips, photo thumbnail, map link, "Confirm"
  and "Reject → absent" buttons with an optional note. Bulk confirm per
  muster.

UI — Attendance Register (rewrite `src/modules/AttendanceRegister.jsx`)
- Now read-only (pay moves to Phase 3): a month × worker grid for a site
  with cells P / H / A / L / WO / HOL and OT hours, totals per worker,
  export CSV, print. Tapping a cell opens the entry (read-only here).

LIB
- `src/lib/attendance.js` (TypeScript welcome): `classifyEntry(entry,
  settings)` → {units, ot_hours, late_min, status}; `dayTotals(entries)`;
  tests for: on-time, late within grace, late beyond grace, half day by
  hours, OT rounding, missing out-time, weekly off.

DASHBOARD
- "No attendance yet" logic reads musters; add "N entries awaiting
  verification" tile for verifiers.

TESTS
- Vitest for `attendance.js`.
- pgTAP: unique rule, units-sum rule, flags set correctly, edit window RLS,
  verifier-only update of verified_by, org isolation.
- Playwright (mobile viewport, against local Supabase): muster mode submit;
  punch mode IN then OUT; verify screen confirm.

ACCEPTANCE
- Old attendance rows appear identically in the new Register.
- On a real phone: muster mode submit in under 60 seconds for 15 workers;
  punch IN in under 5 seconds per worker including selfie.
- Every flag scenario is reproducible on the pilot project.
- CLAUDE.md updated: attendance model, capture modes, flags, RPC.
```

---

## Phase 3 — Payroll v2

```
PHASE 3: Payroll v2. One payroll engine, wage history, configurable rules,
payments and payslips. Read §5.2 of the roadmap. Plan, then stop for approval.

DATA MODEL (migration)
- `employee_rates (id, org_id, employee_id, effective_from date, wage_type
  text check in ('daily','monthly','piece','contractor'), rate numeric,
  ot_rate numeric nullable, created_by, created_at)`. Backfill one row per
  employee from `employees.wage_type/wage_rate` with effective_from =
  employee created_at::date. Keep the columns on `employees` as a cached
  "current" value maintained by trigger, or drop them and add a view; pick
  one and justify.
- `payroll_rules (org_id pk, monthly_proration text check in
  ('by_working_days','full_unless_absent','full'), absent_threshold int,
  ot_multiplier numeric default 1.5, weekly_off_paid_daily bool default
  false, weekly_off_paid_monthly bool default true, holiday_paid bool,
  advance_cap_pct int nullable, rounding text default 'nearest_rupee',
  deductions jsonb default '[]')`. One row per org; Admin Control gets a
  "Payroll rules" card.
- `payroll_runs` gains: `site_id nullable`, `status ('draft','final')`,
  `finalised_at`, `finalised_by`, `rules_snapshot jsonb`, `period_start`,
  `period_end` (so weekly/fortnightly runs are possible).
- `payroll_payments (id, org_id, run_id nullable, employee_id, amount,
  mode text check in ('cash','upi','bank','cheque'), paid_on date, ref
  text, paid_by, note, created_at)`.
- Lock semantics: a `final` run makes attendance_entries and advances in
  its period/site read-only for non-admins (RLS using a
  `period_is_locked(org, site, date)` function). Reopening a run is an
  admin action written to audit_log.
- `working_days` stays (per site per month) and feeds proration.

ENGINE `src/lib/payroll.ts`
- `computePayroll(input): PayrollRow[]` where input = { employees, rates,
  entries, advances, adjustments, payments, workingDays, rules, period:
  {start, end}, asOf }. No I/O. Output per worker: days_present, half_days,
  ot_hours, leave, absent, gross_basic, gross_ot, gross, advances,
  deductions[], override, net, paid_so_far, balance, breakdown[] (human
  readable lines used by the UI and payslip).
- Rules: daily = units × rate (rate chosen per entry date from
  employee_rates); monthly per `monthly_proration`; OT = ot_hours ×
  (ot_rate or rate/ shift hours × multiplier); contractor rows appear with
  headcount but no wage; piece-rate placeholder (quantity × rate from a
  `piece_entries` table is out of scope, but the engine must not crash).
- Tests (Vitest): at least 25 cases including mid-month rate change,
  worker at two sites, advances > gross, partial period asOf, override
  wins, weekly off paid/unpaid, holiday, rounding, empty month.

UI
- Payroll screen: period picker (month or custom range), site filter,
  table from the engine, per-row drawer with breakdown, "Record payment"
  (amount/mode/date/ref) with running balance, "Save draft" / "Finalise"
  (finalise requires confirmation and shows what will lock), print salary
  sheet (existing) and per-worker payslip (new `PayslipPrint`), export.
- Attendance Register keeps its grid and gains a "Payable so far" column
  from the engine using asOf = today, plus a "Record weekly payment"
  action that writes payroll_payments (no run needed).
- Remove `salary_adjustments` duplication: keep the table, but the edit UI
  lives in one place (the Payroll row drawer) and the Register links to it.
- Reports: `src/modules/Reports.jsx` (module key `reports`, Money group)
  with "Labour cost by site by month" and "Cost per worker-day" from a
  Postgres view `v_labour_cost`; CSV export.

TESTS
- Engine tests as above; pgTAP for lock RLS, payments write permission,
  employee_rates history trigger; Playwright: finalise a run then try to
  edit an entry as supervisor and see the lock message.

ACCEPTANCE
- For the pilot month, engine output equals the previously saved
  payroll_run totals for Daily workers (document any intended differences
  for Monthly workers).
- Payslip prints on A5/A4 and shares as PDF from a phone.
- CLAUDE.md: engine location, rules table, lock semantics.
```

---

## Phase 4 — Access scoping, audit viewer, in-app user management

```
PHASE 4: Site-scoped access, audit viewer, and user management without the
Supabase dashboard. Plan, then stop for approval.

SITE SCOPING
- `profile_sites (profile_id, site_id, primary key both)`. A profile with
  zero rows sees all sites in the org (office/owner); a profile with rows
  sees only those sites. Helper `site_in_scope(site_id)` used in every RLS
  policy on tables that have `site_id` (select and write). Employees with
  a `site_id` outside scope are hidden too; unassigned employees visible.
- `AppDataContext` filters sites/employees by the same rule; Admin Control
  gets a "Sites" multi-select per person.
- Add a 'Regional Manager' default role (view+edit on site modules,
  attendance_verify edit, no payroll).

AUDIT VIEWER
- `src/components/AuditTrail.jsx`: given table + row id, list changes
  (who, when, field-level diff). Show it in a drawer on attendance entries,
  advances, payroll rows, employees, sites. Admin Control gets a
  module-wide audit list with filters (table, user, date).

USER MANAGEMENT (Edge Function)
- `supabase/functions/admin-users`: actions create (email, password or
  generated, name, role_id, site_ids), disable, enable, reset_password.
  Verifies the caller's JWT is an admin of the org via a service-role
  query before acting; uses the service role key from function secrets;
  never returns the key. Rate-limit by caller.
- Admin Control: "Add person" form replacing the dashboard instructions;
  show generated password once with a copy button; disable/enable toggle
  calls the function (and also flips `profiles.active`).
- Document local dev for functions (`supabase functions serve`) in
  CLAUDE.md.

TESTS
- pgTAP: scoped user cannot select another site's entries; unscoped user
  can; regional manager cannot read payroll.
- Function tests with Deno test for auth checks (non-admin → 403).

ACCEPTANCE
- Your uncle creates a supervisor login himself, restricted to one site,
  and that supervisor cannot see any other site anywhere in the app.
```

---

## Phase 5 — Notifications and magic-link approvals

```
PHASE 5: Notifications outbox, WhatsApp/email delivery, daily digest, and
one-shot approval links. Plan, then stop for approval. Ask me which provider
I have credentials for before writing provider code; abstract it behind an
interface so a second provider is a new file, not a rewrite.

DATA MODEL
- `notifications (id, org_id, to_profile_id nullable, to_phone, to_email,
  channel ('whatsapp','email','inapp'), template_key, params jsonb, status
  ('queued','sent','failed','delivered','read'), provider_ref, error,
  created_at, sent_at)`.
- `notification_prefs (profile_id pk, digest_morning bool, digest_evening
  bool, approvals bool, expiries bool, channel_priority text[])`.
- `magic_tokens (token text pk, org_id, purpose ('approve','reject',
  'quote','verify'), entity, entity_id, actor_profile_id, expires_at,
  used_at)`.

EDGE FUNCTIONS
- `notify`: pulls queued rows (or is called with an id), renders the
  template, sends via provider, updates status. Idempotent. Callable by
  pg_net from a cron and by the app (admin only) for "resend".
- `magic`: GET /magic/:token renders a tiny HTML page (no app bundle) with
  the action summary and a confirm button; POST performs the action with
  the service role on behalf of `actor_profile_id`, marks the token used,
  writes audit_log. Tokens expire in 48 h and are single-use.

SCHEDULING
- pg_cron jobs (documented in a migration): 10:30 IST "sites with no
  muster today" alert to owner/office; 07:30 and 19:00 IST digest
  (headcount per site, pending approvals count with links, deliveries
  today, documents expiring ≤ 30 days); daily expiry check.

TRIGGERS THAT ENQUEUE
- New purchase request submitted (Phase 6 will use this; create the hook
  now for `indents` status → 'Pending' as a stand-in), salary override
  created, attendance entry flagged 'outside_radius' or 'duplicate_day'.

UI
- Admin Control → "Notifications": outbox list with status, resend,
  provider settings status (configured / not).
- Profile menu → notification preferences.
- In-app bell with unread count for channel 'inapp'.

TESTS
- Deno tests for template rendering and token lifecycle; pgTAP for
  enqueue triggers; a manual runbook in docs for template approval with
  the provider.

ACCEPTANCE
- Owner receives the morning digest for a week; approves one indent from
  the link on his phone; a failed send is visible in the outbox with the
  provider error.
```

---

## Phase 6 — Procurement v1

```
PHASE 6: Procurement v1 — request → approval → manual quotes → comparative
statement → PO → GRN, with item and vendor masters and price history. Read
§5.3 of the roadmap. This replaces `requirements`, `indents` and
`material_received`. Plan, then stop for approval. This is a large phase:
propose a split into 3 sessions (masters + requests; approvals + quotes +
PO; GRN + migration + reports) and stop after each.

DATA MODEL (migrations)
- `items (id, org_id, name, category, unit, spec, is_asset bool,
  preferred_vendor_id, last_price, last_price_at, active, search tsvector)`
- `vendors (id, org_id, name, contact_name, phone, whatsapp, email, gstin,
  address, categories text[], rating int, notes, active)`
- `vendor_items (vendor_id, item_id, last_price, last_quoted_at, lead_days,
  primary key (vendor_id, item_id))`
- `purchase_requests (id, org_id, doc_no, site_id, requested_by,
  requested_by_name, needed_by, priority, status text check in ('draft',
  'submitted','approved','rejected','sourcing','ordered',
  'partially_received','received','closed'), approved_by, approved_at,
  rejection_note, remarks, photos text[], created_at)`
- `purchase_request_items (id, request_id, item_id nullable, description,
  qty numeric, unit, qty_ordered numeric default 0, qty_received numeric
  default 0, note)`
- `approval_rules (id, org_id, entity text, max_amount numeric nullable,
  approver_role_id)`; `approvals (id, org_id, entity, entity_id,
  decided_by, decision ('approved','rejected'), note, decided_at)`.
- `quotes (id, org_id, request_id, vendor_id, items jsonb [{request_item_id,
  price, qty, gst_pct, lead_days}], subtotal, gst, total, valid_until,
  received_via ('manual','link','whatsapp'), received_at, notes, selected
  bool, attachment_url)`
- `purchase_orders (id, org_id, doc_no, request_id, vendor_id, quote_id,
  items jsonb, subtotal, gst, total, terms, deliver_to_site_id, status
  ('draft','sent','acknowledged','delivered','cancelled'), sent_at,
  created_by)`
- `goods_receipts (id, org_id, doc_no, po_id nullable, request_id nullable,
  site_id, vendor_id nullable, items jsonb [{po_item_ref, description,
  qty_received, qty_rejected, reason}], challan_ref, vehicle_no,
  received_by, photos text[], remarks, received_at)`
- Doc prefixes: PR, PO, GRN via `next_doc_no`.
- Status transitions enforced by a trigger (state machine in
  `src/lib/procurement.ts` mirrored in SQL); quantities roll up:
  qty_ordered from POs, qty_received from GRNs; request status derived.
- Trigger: on quote selected + PO created, upsert `vendor_items` and
  `items.last_price`.
- Migration: `requirements` → purchase_requests (status Open→submitted,
  Fulfilled→closed) with one item; `indents` → purchase_requests with
  items; `material_received` → goods_receipts without PO. Keep the old
  tables as `*_legacy` for one release.
- RLS: module keys `procurement_site` (raise/see own site's requests, GRN),
  `procurement_office` (everything), `vendors`, `items`. Approval writes
  require approver role per approval_rules or admin.

UI
- Site view `src/modules/Requests.jsx` (module key `procurement_site`,
  Site group, replaces Requirements + Indents in nav): "Raise request"
  with item search (typeahead over items, or free text), qty/unit,
  needed-by, priority, photo; list of my site's requests with status
  timeline; "Receive" action on ordered requests opening the GRN form
  prefilled from the PO.
- Office view `src/modules/Procurement.jsx` (module key
  `procurement_office`, Material group): kanban or tabs by status; request
  detail with approve/reject (respecting approval_rules), "Record quote"
  (vendor picker, per-item prices, GST, attachment), comparative statement
  table (vendors × items, lowest per item highlighted, totals, lead time),
  "Select and create PO" → PO editor → PO print (A4, company details from
  org_settings, GST breakup) → mark sent.
- "Reorder" shortcut on request creation: if the item has a preferred
  vendor and last_price < 90 days old, offer "Order at last price" which
  creates an approved request + PO in one step (still subject to
  approval_rules).
- Masters: `Items.jsx` and `Vendors.jsx` via RecordManager where possible
  (they need edit; add an `editable` option to RecordManager rather than
  writing bespoke screens).
- Dashboard tiles: awaiting my approval, awaiting quotes, awaiting delivery.
- Reports: vendor spend by month, open requests ageing, price history per
  item (sparkline table).

TESTS
- Vitest for the state machine and comparative-statement math (GST,
  lowest-per-item, totals).
- pgTAP: transitions, rollups, approval rule enforcement, site scoping.
- Playwright: raise → approve → quote ×2 → PO → GRN with a shortage.

ACCEPTANCE
- 20 real requests through the flow; the office confirms they no longer
  use WhatsApp for indents; top 30 items have price history; a PO PDF is
  accepted by a vendor.
- CLAUDE.md: procurement model, state machine, doc prefixes.
```

---

## Phase 7 — Vendor quote links and document vault

```
PHASE 7A: Vendor quote links. Extend Phase 5's notification and magic-token
machinery so an RFQ goes to vendors and quotes come back without a login.
Plan, then stop for approval.

- `rfqs (id, org_id, request_id, vendor_ids uuid[], due_at, sent_at,
  message)`; "Send RFQ" on a request picks vendors (default: preferred
  vendor per item + vendors with the item's category), previews the
  message, enqueues notifications with a per-vendor magic token
  (purpose 'quote').
- Edge Function `vendor-quote`: GET renders a mobile-friendly page (no app
  bundle) with the request items and inputs for price per item, GST, lead
  days, validity, notes, optional file; POST inserts a `quotes` row with
  received_via 'link' and notifies the office. Token single-use but
  editable until due_at via the same link (document the choice).
- Comparative statement updates live as quotes arrive (Realtime on
  quotes). Vendor reminder at due_at − 24 h.
- Tests: Deno tests for the form handler; pgTAP for the quote insert path
  as anon (service role only); Playwright for the vendor page.
- Acceptance: half the quotes in a month arrive via the link.

PHASE 7B: Document vault, expiries, worker onboarding, ID cards. Plan, then
stop for approval.

- `document_categories (org_id, scope ('company','site','employee','vendor',
  'equipment'), key, label, expires bool, required bool)` seeded with the
  list in roadmap §5.4; `documents (id, org_id, scope, scope_id, category_key,
  title, file_url (private bucket), mime, size, issued_on, expires_on,
  reference_no, uploaded_by, tags text[], created_at)`. Merge
  `employee_documents` from Phase 1 into this (keep a view for
  compatibility).
- Module `documents` (Setup group): tabs per scope; per-entity document
  panels embedded in Sites, Team, Vendors screens ("Documents (3, 1
  expiring)"); upload with camera or file; signed URL preview; expiry
  badge; required-but-missing checklist per entity.
- pg_cron daily: enqueue expiry notifications at 30/7/0 days (uses Phase 5).
- Worker onboarding checklist on Team: photo, ID, bank, induction, consent
  checkbox recorded as `employees.consent_at` with the consent text
  version.
- ID card: print sheet (CR80 size, 2×5 per A4) with photo, name, trade,
  company, emergency phone, and a QR encoding the employee id. Attendance
  punch mode gets a "Scan card" button (camera QR via a small library;
  justify the choice) that selects the worker.
- Tests: pgTAP for restricted read on employee/vendor docs; Vitest for the
  expiry bucketing; Playwright for upload + preview.
- Acceptance: every company document is in the vault with an expiry; the
  first expiry alert fires; a printed ID card scans on a supervisor's phone.
```

---

## Phase 8 — Field verification spike (face / QR)

```
PHASE 8: Spike, not a feature. Goal: a one-page decision memo with measured
numbers on whether face verification is worth adopting, and in what form.
Time-box to one week of work. Do not touch production tables except adding
an opt-in `face_enrolments` table if I approve it.

- Build `spike/face/` (outside `src/`) as a small Vite page that:
  1. Enrols a worker: captures 3 front-facing photos, computes embeddings
     in-browser with `@vladmandic/human` (justify vs MediaPipe), stores
     locally.
  2. Verifies: captures a selfie, compares against all enrolled, reports
     best match, score, and time taken on-device.
  3. Group mode: loads a group photo, detects faces, attempts matches,
     reports recall (faces found / people present) and precision.
- Use the real muster photos and punch selfies from the pilot (private
  bucket, with consent) as the test set; ask me for the folder.
- Measure on two real phones (ask me which): model load time, per-verify
  time, false accept / false reject at thresholds 0.4/0.5/0.6, group-photo
  recall.
- Also prototype the fallback: AWS Rekognition CompareFaces via a local
  script; report cost per verify and accuracy on the same set.
- Write `docs/decisions/00XX-face-verification.md` with: numbers, privacy
  and consent requirements (DPDP Act 2023: purpose, consent record,
  retention, deletion on exit), recommendation among: (a) 1:1 in-browser
  at punch, (b) cloud API at punch, (c) QR card + random selfie audit,
  (d) drop.
- If (a) or (b): propose the schema (`face_enrolments (employee_id,
  embedding vector, consent_at, enrolled_by)` with pgvector or bytea) and
  the UI change for Phase 2's punch mode, as a plan only.
```

---

## Phase 9 — Operations depth (pick one per prompt)

Each of these is a separate session. Use the same preamble.

```
9A SITE STOCK: `stock_movements (org_id, site_id, item_id, qty, type
('received','issued','consumed','returned','transfer_out','transfer_in',
'adjust'), ref_table, ref_id, note, created_by, created_at)`. GRNs create
'received'; DPR "material consumed" becomes structured lines creating
'consumed'; challans between own sites create transfer pairs. Stock-on-hand
view per site/item; reconciliation screen with variance; low-stock hint on
request creation ("Site B has 40 m of this"). Plan, tests, acceptance =
one month of stock at one site reconciles within 5%.
```

```
9B TOOLS AND ASSETS: `assets (org_id, item_id, tag, serial, status
('in_store','issued','repair','lost','scrapped'), site_id, custodian_employee_id,
purchase_date, cost, photos)` + `asset_movements`. Issue/return/transfer
with signature photo; "Who has the threading machine?" search; asset list
per site; lost-asset flag feeds payroll deductions as a proposed line
(admin confirms). Plan, tests, acceptance = all major tools tagged and
located.
```

```
9C EXPENSES AND SITE P&L: `expenses (org_id, site_id, category, amount,
paid_by_profile, paid_to, mode, receipt_photo, date, note, approved_by)`;
petty cash float per site; `v_site_pnl` combining labour cost (Phase 3
view), material cost (POs/GRNs by site), transport, expenses; monthly and
cumulative; Reports screen tab; CSV. Plan, tests, acceptance = owner uses
the per-site margin number in a real pricing decision.
```

```
9D OFFLINE ATTENDANCE: IndexedDB outbox for musters/punches and their
photos; service worker (vite-plugin-pwa) for app-shell caching; sync on
reconnect with server-wins on unique conflicts and a visible "pending
sync" badge; queued photos upload with retry; never lose a punch. Only
attendance and DPR go offline. Plan, tests (Playwright with network
offline), acceptance = a basement punch appears after the phone comes
back online.
```

```
9E HINDI UI: react-i18next, `en` and `hi` bundles for the supervisor
screens (Attendance, Requests, DPR, Photos, Login, Layout). Language
toggle in the header persisted per profile. Numbers/dates stay en-IN.
Plan, acceptance = a supervisor completes a muster in Hindi without help.
```

```
9F SAFETY RECORDS: modules `permits` (hot work / height / confined space,
with validity window, issued_by, photos, checklist) and `incidents`
(severity, description, photos, people involved, actions) via
RecordManager with edit; toolbox talk = a muster tagged 'toolbox' reusing
attendance entries. PDF prints. Plan, acceptance = a client PMC accepts
the printed permit.
```

---

## Phase 10 — SaaS

```
PHASE 10: Multi-tenant self-serve. Everything already has org_id; this phase
adds the front door. Plan, then stop for approval; split into sessions.

- Signup: email + password + company name creates org, org_settings,
  default roles, payroll_rules, site_settings defaults, doc categories,
  and makes the user admin (trigger or Edge Function; justify). Email
  verification on. Invites: `invites (org_id, email, role_id, token,
  expires_at)`; accept flow.
- Plans: `plans (key, limits jsonb: sites, workers, storage_mb, whatsapp
  per month)`, `subscriptions (org_id, plan_key, status, period_end,
  provider_ref)`; Razorpay Subscriptions via an Edge Function webhook;
  enforcement of limits in RLS helpers (`org_within_limits('sites')`).
- `org_features jsonb` toggles per module; `modules.js` reads it.
- Per-org data export (zip of CSVs + photo manifest) via Edge Function;
  org deletion with a 30-day grace.
- Usage: storage per org from `storage.objects`, message counts from
  notifications.
- Isolation tests: extend pgTAP to run every policy assertion for two
  orgs; CI fails on any cross-org read.
- Landing page (separate static site is fine), onboarding checklist in the
  app (add site → add worker → mark attendance → invite office).
- Acceptance: a second company signs up, runs attendance for a week, and
  you never touched their data by hand.
```

---

## Utility prompts

### Code review before merging a phase

```
Review the diff on this branch against `main` as a senior engineer who
owns production. Focus on: RLS gaps (any new table without org_id or
without policies; any policy without `org_id = current_org()`), money
math outside `src/lib/`, mobile layout at 360px, migration safety (is it
re-runnable? does it lock a big table?), N+1 realtime refetches, and
anything that would confuse a site supervisor. Report findings ranked by
severity with file:line, then fix the ones you're confident about and
list the rest.
```

### RLS test generator

```
Generate pgTAP tests in `supabase/tests/rls_<table>.sql` for table
<table>: for each default role (admin, office, site, viewer, and a
second-org admin) assert select/insert/update/delete outcomes according
to `modules.js` permission defaults and `docs/01-ANALYSIS-AND-ROADMAP.md`.
Use `supabase test db` conventions and a shared `tests/helpers.sql` for
creating test users and switching `request.jwt.claims`.
```

### Write the decision record

```
Write `docs/decisions/<NNNN>-<slug>.md` for the decision we just made:
context (2 sentences), options considered (one line each), decision,
consequences, and the date. Keep it under 200 words.
```

### Update CLAUDE.md after a phase

```
Update `CLAUDE.md` for what changed in this phase: new tables and their
module keys, new lib functions and where formulas live, new commands,
new conventions, and any known constraint we accepted on purpose. Keep the
existing tone and structure; remove anything now false; don't exceed
~250 lines.
```

### Pilot feedback triage

```
Here are this week's pilot notes from `docs/pilot-notes.md`: <paste>.
Classify each into bug / usability / missing rule / new feature. For bugs
and usability, propose the smallest fix and estimate size (S/M/L). For
rules, tell me which config in `site_settings` or `payroll_rules` it maps
to or whether a new one is needed. For features, say which roadmap phase
it belongs to. Don't implement anything yet.
```
