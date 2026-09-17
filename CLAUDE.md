# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gridwatch — site and office coordination app for a fire fighting / electrical
contracting business. Workers on site log attendance and daily work from their
phones; the office handles buying, payroll and documents; the owner sees it
live. Stack: React + Vite + Tailwind (v4) on the frontend, Supabase (Postgres +
Auth + Storage + Realtime + one Edge Function) as the entire backend, deployed
as a static SPA (Netlify/Vercel/Cloudflare Pages — no server of its own).

## Commands

```bash
npm install
npm run dev       # vite dev server, http://localhost:5173
npm run build     # production build to dist/
npm run lint      # eslint (flat config, react + hooks)
npm test          # vitest: lib unit tests, screen smoke tests, database tests
```

`npm test` needs no Supabase: `supabase/tests/db.js` boots PGlite (Postgres in
WASM) with Supabase's `auth.uid()`, roles and storage stubbed, applies
`supabase/schema.sql`, and tests RLS, triggers, RPCs and the upgrade from the
pre-v1 schema (`supabase/tests/fixtures/schema.before-v1.sql`, a frozen copy).
Tests run with `TZ=Asia/Kolkata`. CI (`.github/workflows/ci.yml`) runs lint,
test and build.

The app requires a `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
(`src/lib/supabase.js` throws without them; there is no `.env.example`). The
`VITE_` values are baked into the build, so they must also be set on the host.

`docs/` holds the analysis/roadmap (`01-…`), per-phase prompts (`02-…`), the
revamp scope (`checklist.md`) and `V1-UPGRADE.md` (how to apply v1 to a
Supabase project). Check them before large changes.

## Architecture

**Registries** — most changes touch these:

- `src/config/modules.js` — navigation, icons, accents, permission keys. A
  module's `key` must match its route in `App.jsx` and the key in
  `roles.permissions`. `permissionOnly: true` marks a permission with no screen
  (`procurement_approve`, `hr_documents`); `SCREENS` is the menu list.
- `src/config/fields.js` — field/column defs for `RecordManager` screens (DPR,
  Transport, MTC, Drawings, Rework, Items, Vendors). One edit changes form,
  table and CSV.
- `src/config/documents.js` — document categories per scope and which expire.

**Screens**

- *RecordManager* (`src/components/RecordManager.jsx`) — generic log screen:
  form, cards/table, edit modal, CSV, "load more". Field types include `tags`
  (text[] as comma list) and `checkbox`; props `type/options/required/…` may be
  functions of the form, plus `visible(form)`, `onChange(value, form)`,
  `toRow/fromRow`. The site filter is applied in the query via `filterField`.
- *Bespoke* (`src/modules/`): Dashboard, Attendance (muster + punch modes),
  AttendanceVerify, AttendanceRegister (calendar grid + pay so far), Requests
  (site purchase requests, key `requirements`), Procurement (office: approve,
  quotes, comparison, POs), GoodsReceived (GRN, key `material_received`),
  Challans, Sites (location + attendance rules + site documents), Team (workers
  on the roll) and TeamArchive (`/team/archive`, workers who left) — both
  render `team/Roster.jsx` and share the `team` permission — Payroll (own
  `payroll` permission: pay table, per-worker pay editor, "Log advance" bulk
  popup, runs), Documents, Advances, Reports, Admin (people, permissions,
  freeze, company, payroll rules, audit log). Screens are lazy-loaded in
  `App.jsx`.
- Old route `/indents` redirects to `/requirements`. Module keys
  `requirements` and `material_received` were kept (now Site Requests and
  Goods Received) so existing role permissions carry over.
- "Left" on a worker asks for the leaving date: sets `active = false` and
  `employees.left_on`; Rehire clears both. `activeEmployees` excludes them.

**Routing (`App.jsx`):** module routes are wrapped in `<Guard k="key">`
(`canView`); Dashboard needs no permission; `/admin` uses `AdminGuard`.

**Data layer**

- `src/lib/supabase.js` — the single client.
- `src/hooks/useRecords.js` — load + Realtime + add/update/remove with
  `filters` (`eq|neq|gte|lte|in|isnull|notnull`, empty values skipped),
  `select` (embeds like `*, purchase_request_items(*)`), paging (`hasMore`,
  `loadMore`), `enabled`. Never sends `created_by`. `update`/`remove` throw when
  RLS silently affected zero rows (locked/out of window). `friendly(error)`
  turns Postgres errors into supervisor-readable text; trigger errors
  (`P0001`) are already written for users and pass through.
- `src/hooks/usePayrollInputs.js` — everything the payroll engine needs for a
  month (rates, entries, advances, pay edits, payments, working days), paged
  past 1000 rows (`src/lib/fetchAll.js`) and kept live. Payroll, Register and
  Reports all load through it.
- `src/context/AppDataContext.jsx` — sites, employees, `siteSettings(siteId)`
  (attendance rules with defaults), `company` (org_settings over
  `config/company.js` fallback), payroll `rules`, and the global site filter.
- `src/context/AuthContext.jsx` — session, profile, roles, `module_locks`,
  `canView/canEdit`, live via Realtime; sets the upload org prefix.
- `src/lib/upload.js` — all files. Public bucket `uploads` (progress/material
  photos, stored as URL) vs private bucket `private` (muster/punch photos,
  worker photos, documents, stored as `sb://private/{org}/{folder}/file`,
  displayed via signed URLs — use `StoredImage` / `useFileUrl` /
  `openStoredFile` in `ui.jsx`, never `<img src>` on a stored ref). Folder
  `hr` in the private bucket needs `hr_documents` to read. `PhotoInput` takes
  `private` and `camera` props.
- `src/lib/format.js` — `today()`/`thisMonth()` are LOCAL dates (never
  `toISOString().slice(0,10)` — that's UTC and wrong before 05:30 IST).
  `src/lib/dates.js` — month/day helpers.
- `src/components/ui.jsx` — primitives (Modal, Tabs, Chip, Info, Line, Toggle,
  ExpiryBadge, …). `Print.jsx` (`PrintSheet` letterhead), `PayrollPrint.jsx`
  (salary sheet, payslip), `ProcurementPrint.jsx` (PO), `PaymentsBox.jsx`,
  `DocumentsPanel.jsx`, `AuditTrail.jsx` (`AuditButton` — admin only).

**Business logic lives in pure functions with tests (`src/lib/*.test.js`):**

- `attendance.js` — `classifyEntry` (half day, OT rounding, late), `byDay`
  (max one day's pay per worker per day across sites), `dayCode`. Mirrors the
  `attendance_entry_before()` trigger — change both together.
- `payroll.js` — `computePayroll()`, the ONE wage calculation: daily = units ×
  that day's rate; monthly = units × rate ÷ working days capped at working days
  elapsed (or `full` / `full_unless_absent` per `payroll_rules`), elapsed
  counted only to `left_on` for a worker who left; OT = hours ×
  `wagePerHour(day rate)` (day rate ÷ `standard_hours`, 9 by default) ×
  multiplier. A `salary_adjustments` row (the Payroll edit) can replace wage
  per day, days present (basic = wage/day × days) and OT hours — null fields
  keep the attendance figures — and adds `bonus` / `penalty`. gross = basic +
  OT + bonus; net = gross − advances to `asOf` − penalty; balance = net −
  `payroll_payments`. The pay editor previews by calling the engine with the
  draft edit. No screen does its own wage maths.
- `procurement.js` — request status machine (`MANUAL_TRANSITIONS`, mirrors
  `purchase_requests_before()`), quote totals, `comparative()`,
  `poLinesFromQuote`, `receiptLinesForPo`.

**Authorization is enforced twice:** the UI (`modules.js`/`AuthContext`) hides
what you can't use, but Postgres RLS in `supabase/schema.sql` is the real
enforcement — the anon key is public by design. If they disagree, the database
wins, and every new rule needs a test in `supabase/tests/schema.test.js`.

## Database (`supabase/schema.sql`)

> **⚠ LIVE DATA — READ BEFORE EDITING `schema.sql`.** The production Supabase
> project holds real attendance, payroll, advances and procurement records
> going back months. Every edit to this file gets pasted into that database.
> There is no migration history to roll back to, and the free tier has no
> automatic backups.
>
> - **Never rename or drop an existing table or column, and never change a
>   column's type or meaning in place.** Other code, saved payroll runs
>   (`payroll_runs.rows` JSON) and the deployed app depend on the current names.
>   Add new columns or tables instead.
> - **If a rename, drop or reshape is really needed**, do it as a guarded
>   one-off migration in section 12b, in this order: (1) add the new
>   table/column, (2) copy/convert every existing row into it, (3) keep the old
>   table as `*_legacy` or drop the old column only after the copy, inside
>   the same guarded block (`to_regclass`/`information_schema` check or a
>   `schema_migrations` key). Example: `salary_adjustments.amount` →
>   `day_rate`.
> - **Changing what existing data means** (e.g. a payroll rule default, a
>   permission key, a status value) needs an explicit update of existing rows
>   in a guarded migration, not only a new default. Examples:
>   `standard_hours_9`, `payroll_permission_split`.
> - **Removing or tightening a policy or check** can lock users out of rows
>   they own, or fail on existing rows (`add constraint` validates old data).
>   Check existing values first.
> - **Every schema change needs a test in `supabase/tests/schema.test.js`**,
>   including the upgrade path: seed data in the old shape (the
>   `upgrade from the pre-v1 schema` block), apply the schema, and assert the
>   data survived. Run `npm test`, and applying the file twice must be a no-op.
> - **In your summary, tell the user plainly**: which existing tables, columns
>   or rows the change touches, whether the old app keeps working after it's
>   applied, and that they should take a `pg_dump` backup (README → Backups)
>   before pasting it. Ideally they try it on a restored copy first.
> - Know which schema is live before planning: the last committed
>   `schema.sql` (`attendance`, `requirements`, `material_received`,
>   `salary_payments`) or v1 (`attendance_entries`, `purchase_requests`,
>   `goods_receipts`, `payroll_payments`). If unsure, ask the user.

One file, pasted whole into the Supabase SQL editor; **must stay safe to re-run
on a live project** (the tests apply it twice and on top of the old schema).
No migration tooling yet (Supabase CLI is planned, deliberately deferred).
Rules for editing it:

- New tables: `create table if not exists`, include `org_id uuid not null
  default public.current_org() references public.orgs(id)`, add to the RLS
  section (generic loop, or a dedicated block), the Realtime list, and the
  audit list if changes matter.
- Changing an existing table: `alter table … add column if not exists`;
  constraints/policies/triggers are drop-then-create.
- One-off data changes: guard with `to_regclass(...)` checks or a
  `schema_migrations` key so they run once. Old tables are renamed
  `*_legacy` (admin-read-only) rather than dropped: `attendance_legacy`,
  `requirements_legacy`, `material_received_legacy`, `salary_payments_legacy`.
- `language sql` function bodies are validated at creation — if one references
  a column that only gets added later in the file on an upgrade, use plpgsql.
- Postgres `text[] || 'literal'` is ambiguous; use `array_append`.

Key pieces:

- **Tenancy**: `orgs` (one fixed default org id), `profiles.org_id`,
  `current_org()`. Every policy checks `org_id = current_org()`. `roles` and
  `module_locks` are still global (per-org roles need a PK change — SaaS time).
  `next_doc_no(prefix)` counters are per org.
- **Helpers**: `is_admin()`, `can_view(key)`, `can_edit(key)` (respects
  freeze), `site_in_scope(site_id)` (a profile with `profile_sites` rows sees
  only those sites; none = all), `period_is_locked(site, date)`,
  `attendance_in_window(site, marked_at)`, `local_now()` (org timezone).
- **created_by** is stamped by a trigger from `auth.uid()` on every table that
  has it; clients can't spoof it. `profiles_guard` stops self-promotion.
- **Admin's entries**: `guard_admin_rows()` (BEFORE UPDATE/DELETE) makes rows
  whose `created_by` is an Admin Admin-only on site logs (musters, attendance,
  dpr, rework, challans, transport, mtc, drawings, requests + lines, GRNs,
  documents). Trigger args list permissions that are still allowed to act
  (`attendance_verify`; `procurement`/`procurement_approve`). It checks only
  `current_user = 'authenticated'`, so roll-ups inside security definer
  functions pass. The UI mirrors it with `canChangeRow(row, exceptFor)` from
  `AuthContext`.
- **Audit**: `audit_row()` trigger → `audit_log` (admin-read) on attendance,
  money, masters, procurement and settings tables. Skipped when `auth.uid()` is
  null (SQL editor / migrations).
- **Crew photo approval**: a muster's photo is taken in-app (`LiveCamera`,
  getUserMedia, stamped with site/time/GPS; `musters.photo_live` records that)
  and `submit_muster()` refuses a muster with no photo or no GPS. The office
  approves it with `approve_muster(muster, present[], note)` (needs
  `attendance_verify` edit): workers in `present` get `verified_at`, the rest
  are marked absent for that day only. Re-submitting a muster clears the
  approval. **Pay follows approval** — `computePayroll()` only counts entries
  with `verified_at`, and reports the rest as `pending_days`. History from
  before this rule was approved once by the `approve_attendance_history`
  migration.
- **Attendance**: `musters` (site/day header: group photo, GPS, extra hands)
  and `attendance_entries` (one per worker/site/day). `attendance_entry_before()`
  stamps server time, derives units/OT/late from `site_settings`, enforces
  require_photo/require_gps, sets flags (`outside_radius`, `no_gps`,
  `no_photo`, `early_mark`, `backdated`, `edited_late`, `duplicate_day`;
  sticky `override_allowed`, `rejected`), refuses a second paid day at another
  site, and lets only `attendance_verify` editors set `verified_by/at` (any
  other edit clears verification). RPCs: `submit_muster(p jsonb)`,
  `punch(employee, site, 'in'|'out', photo, lat, lng, accuracy)`,
  `close_day(site, date)` — all `security invoker` so RLS applies. Edits after
  the site's edit window need `attendance_verify`; a finalised payroll period
  is read-only for non-admins.
- **Payroll**: `employee_rates` (history; `employees.wage_type/wage_rate`
  mirror today's rate via trigger — to change a wage insert a rate row; `team`
  permission), `payroll_rules` (one per org), `payroll_runs` (`draft|final`,
  period, site; only Admin can reopen/delete a final run), `payroll_payments`
  (many per worker per month; writable with `payroll` or `attendance_register`
  edit), `salary_adjustments` (`payroll` only; one per worker per month:
  `day_rate`, `days_present`, `ot_hours`, `bonus`, `penalty`; a trigger refuses
  `days_present` until the month is over), `working_days`. `advances` are
  writable with `advances` or `payroll` edit. `payroll` was split out of
  `team` by the one-off `payroll_permission_split` migration (each role
  started with its team value).
- **Procurement**: `items` (seeded once from the old requirement catalogue),
  `vendors`, `purchase_requests` + `purchase_request_items` (RPCs
  `create_purchase_request`, `replace_request_items`), `approvals`, `quotes`,
  `purchase_orders`, `goods_receipts`, `price_history`. Triggers roll PO and
  GRN quantities up into request lines and derive `ordered /
  partially_received / received`; manual moves are checked by the status
  trigger (approve/reject needs `procurement_approve`, close needs
  `procurement`). `purchase_requests.fulfilled_on` is derived: the last GRN
  date when everything is received, today when closed without one, cleared
  if the status moves back. Doc prefixes PR, PO, GRN, DC.
- **Documents**: `documents` (scope company|site|employee|vendor). Employee
  scope needs `hr_documents`; the Aadhaar number lives here and a trigger keeps
  `employees.aadhaar_last4`.
- **Storage** policies: `uploads` public read, delete by owner/admin; `private`
  read/write within `{org_id}/`, `hr/` folder needs `hr_documents`.

**Edge Function** `supabase/functions/admin-users` (Deno): create / disable /
enable / reset_password, callable only by an active Admin, scoped to their org,
using the service key server-side. Admin Control calls it via
`supabase.functions.invoke`; if it isn't deployed the UI says so and falls back
to the dashboard link. Deploy with `supabase functions deploy admin-users`.

## Adding a new module

1. Table in `supabase/schema.sql` (org_id, RLS block, Realtime, audit if
   needed) + a test in `supabase/tests/schema.test.js`.
2. Entry in `MODULES` (`src/config/modules.js`) and default permissions for
   each shipped role in the roles section of the schema.
3. Plain log: field/column defs in `fields.js` + a `<Route>` with
   `RecordManager`. Workflow: a component in `src/modules/` (lazy import in
   `App.jsx`) and add it to `src/modules/screens.smoke.test.jsx`.
4. Logic with money or rules goes in `src/lib/` with Vitest tests.

## Known constraints (by design, not oversights)

- No offline mode — a site with no signal can't submit; the form stays on
  screen for retry.
- Face recognition, QR cards, WhatsApp notifications, vendor quote links,
  stock/assets, client billing, Hindi UI and SaaS signup are out of scope for
  v1 (see `docs/checklist.md`).
- Piece-rate/contractor pay and PF/ESI deductions aren't modelled yet.
- Deleting a site deletes its history; "Close" is the right action.
