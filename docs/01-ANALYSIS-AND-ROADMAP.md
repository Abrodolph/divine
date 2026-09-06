# Gridwatch — Analysis, Options and Roadmap

*Written 2026-09-05 against commit `8bbe428` plus the uncommitted Aadhaar change.*

This document is the thinking. The companion `02-CLAUDE-CODE-PROMPTS.md` is the doing: one ready-to-paste prompt per roadmap phase.

---

## 0. TL;DR

1. **Keep the stack, revamp the data layer.** React + Vite + Supabase as a PWA is the right choice for a no-server, free-tier, phone-first tool for Indian construction sites. The 5,300 lines of frontend are small, coherent and mostly worth keeping. What needs rethinking is the *schema and the money logic*, not the framework.
2. **Attendance is stored the wrong way for the business you describe.** One row per site per day with a `uuid[]` of present workers cannot represent in/out times, half days, overtime, a worker moving between two sites in one day, or who verified what. Normalise to one row per worker per day *before* anything else is built on top of it.
3. **There are two payroll formulas that disagree.** Payroll pays a Monthly worker their full wage regardless of days; the Attendance Register prorates them by working days. One payroll engine, pure function, unit-tested, used by both screens.
4. **Procurement should start as a workflow with humans doing the calling, and only then add vendor automation.** Item master, vendor master, price history and a comparative statement are worth more on day one than a vendor portal nobody logs into. Vendor notification via WhatsApp/email magic links comes next; vendor logins come last, if ever.
5. **"Documentation" is two things**: a document vault with expiry alerts (licences, insurance, NOCs, test certs, worker IDs) and generated documents (challans, payslips, POs, RFQs, DPR PDFs). Both are needed; the vault is easier and higher value first.
6. **Ship in checkpoints, each gated by real use at your uncle's sites**, not by "the feature is coded". The roadmap below has 10 phases; each has an explicit exit test.
7. **Face recognition is a Phase 8 spike, not a Phase 1 feature.** On group photos of a crew in helmets it will be unreliable. The realistic version is per-worker selfie verification at check-in, or QR ID cards. Spike it against real photos from the pilot before committing.
8. **Add the multi-tenant `org_id` column during the schema revamp, but build nothing else for SaaS until Phase 10.** Retrofitting tenancy across 25 tables of RLS later is far more painful than one column now, while there is almost no live data.
9. **Fix a handful of real bugs immediately**: UTC date bug (`today()` returns yesterday before 5:30 AM IST), Aadhaar readable by every logged-in user, public storage bucket, no geofence on sites, floating workers can be paid twice via the Register.
10. **Add tests before touching payroll.** Vitest for the engine, pgTAP for RLS, Playwright for the three critical flows. Money code without tests is where this project will lose your uncle's trust.

---

## 1. What exists today

### 1.1 Layout

```
divine engineering/
├── CLAUDE.md                 workspace note
├── gridwatch (1).jsx         old single-file prototype — archive it (see §2.4)
└── gridwatch/                the real app, its own git repo (3 commits)
    ├── supabase/schema.sql   entire DB: 20 tables, RLS, storage, realtime — hand-pasted
    └── src/
        ├── config/modules.js    nav + permission registry (16 modules)
        ├── config/fields.js     form/table defs for 7 "plain log" modules
        ├── components/RecordManager.jsx   generic log screen
        ├── modules/*.jsx        11 bespoke screens
        ├── context/             Auth (roles, locks), AppData (sites, employees, site filter)
        └── hooks/useRecords.js  load + realtime + add/update/remove
```

### 1.2 What works well (keep)

- **Registry pattern** (`modules.js` + `fields.js`). Adding a plain log module is a 3-step job. Good.
- **RLS as the real authorisation layer** with the UI as a mirror. Correct instinct and correctly documented.
- **Role permissions are data**, editable in-app, live via Realtime. Good.
- **Module freeze** (`module_locks`) for month-end. A genuinely useful, uncommon feature.
- **Gap-free document numbering** via `next_doc_no()` counter table. Correct.
- **Photo resize before upload**, group photo + GPS on muster, mobile-first layout, PWA manifest, CSV export everywhere, print-to-PDF for challans and salary sheets. All right for the field.
- **Honest README** with free-tier maths and known limits.

### 1.3 The data model in one paragraph

`sites` and `employees` are masters. `attendance` is one row per site per day holding `present_ids uuid[]` and `present_times jsonb`. `dpr`, `requirements`, `material_received`, `site_photos`, `transport`, `mtc`, `drawings`, `rework` are flat logs. `indents` and `challans` hold `items jsonb` and get auto-numbers. Money: `advances` (per employee), `working_days` (per site per month), `salary_adjustments` (per employee per month override), `payroll_runs` (snapshot jsonb). Auth: `profiles` → `roles` (permissions jsonb) and `module_locks`.

---

## 2. Critique

Ordered by how much it will hurt if left alone.

### 2.1 Structural (rethink)

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| S1 | `attendance.present_ids uuid[]` + `present_times jsonb` | Cannot record out-time, hours, half-day, OT, late flag, per-worker photo, per-worker verification, or the same worker at two sites in a day. Payroll has to scan every muster and `includes()` per worker. Cannot index by worker. | New `attendance_entries` table: one row per worker per site per day with in/out, units, status, verified_by. Keep a `musters` header row for the group photo/GPS. |
| S2 | Two payroll formulas | `Payroll.jsx` pays Monthly workers the full wage regardless of attendance; `AttendanceRegister.jsx` prorates by working days. For Daily workers, Payroll = rate × days; Register = (rate × total_days / total_days) × min(days, elapsed). These produce different numbers for the same worker in the same month. Your uncle will notice. | One `computePayroll()` pure function in `src/lib/payroll.js`, driven by a `payroll_rules` config row, used by both screens, unit-tested. |
| S3 | `requirements` and `indents` overlap | Both are "site needs X". Neither has approval, vendor, quote, PO, or GRN. | Merge into a single `purchase_requests` flow (§5.3). |
| S4 | No migrations tooling | `schema.sql` with `add column if not exists` scattered inside `create table` blocks works for one dev but every schema change is a hand-paste with no record of what is live where. | Supabase CLI: `supabase/migrations/*.sql`, `supabase db push`, `supabase db diff`. Keep `schema.sql` only as generated output. |
| S5 | No tests, no lint | Payroll and attendance are money. | Vitest (engine), pgTAP (RLS), Playwright (3 flows), ESLint. |
| S6 | No audit trail | Attendance is editable in place with no history. Disputes ("I was marked present, who removed me?") are unanswerable. | `audit_log` table filled by a generic trigger on money/attendance tables. |
| S7 | Permissions are per-module only, never per-site | A supervisor at Site A can edit Site B's attendance. Multi-region operation needs site scoping. | `profile_sites` mapping + RLS check `can_edit(module) and site_in_scope(site_id)`. |
| S8 | No tenant column | Every table is single-company. | `org_id` on every table with a `current_org()` helper in RLS; add now while data is tiny. |

### 2.2 Bugs and security (fix now)

| # | Issue | Detail |
|---|---|---|
| B1 | **UTC date bug** | `today()` and `thisMonth()` in `src/lib/format.js` use `toISOString()`, which is UTC. Between 00:00 and 05:30 IST they return *yesterday* (and on the 1st, *last month*). Night shifts and early musters will land on the wrong day. Use local date parts. |
| B2 | **Aadhaar readable by every logged-in user** | `employees.aadhaar` is plain text under a `select ... using (true)` policy. A Viewer can export the full roster with Aadhaar numbers. Under the DPDP Act 2023 and UIDAI guidance this is a liability. Move to a separate `employee_documents` table with admin/HR-only read, store masked (last 4) in `employees`, or encrypt with `pgsodium`. |
| B3 | **Public storage bucket** | `uploads` is `public = true`; any URL is world-readable forever. Fine for progress photos, not for muster photos of identifiable people, challans with party details, or (later) ID documents. Add a second private bucket with signed URLs for anything personal. Also `uploads_delete` lets any authenticated user delete any object. |
| B4 | **`created_by` set by the client** | `useRecords.add` inserts `created_by` from the browser. RLS does not enforce it equals `auth.uid()`. Use `default auth.uid()` on the column and drop it from the insert. |
| B5 | **Floating workers can be paid twice** | Workers with no `site_id` appear in every site's roster. Register computes per site, so a floating worker present at Site A on the 3rd and Site B on the 4th shows correct per site, but one marked at *both* sites on the same day is one day in Payroll (distinct dates) and two days across two Registers. Normalised attendance with a `(employee_id, date)` uniqueness rule (or explicit half-day split) fixes this. |
| B6 | **No geofence** | `sites` has no lat/lng/radius, so GPS on the muster is decorative. |
| B7 | **Photo and GPS are optional** | Nothing forces a live camera capture, GPS, or a timestamp from the server. A muster can be back-dated from home. Add per-site "require photo / require GPS within radius / lock edits after N hours" settings and server-side `created_at`/`marked_at` checks. |
| B8 | **Full-table loads** | `useRecords` does `select *` with no range. Fine at 2 sites; with per-worker attendance rows (50 workers × 26 days × 12 months = ~15k rows/year) the Attendance screen will load everything on open. Add date-range and pagination to the hook. |

### 2.3 Minor / style

- Free-text `marked_by`, `raised_by`, `reported_by`, `received_by` instead of `profile_id` references: weakens audit and reporting. Keep the text for display but add the FK.
- `Payroll.jsx` and `AttendanceRegister.jsx` each duplicate `nextMonthStart`, `Info`, `Line`. Extract to `lib/dates.js` / `components/ui.jsx`.
- `RecordManager` has no edit; deleting-and-re-entering with a gap-free document number is fine, but for DPR/rework it loses the original timestamp. Add edit with audit rather than special-casing.
- The Dashboard fetches with `limit(5)` and then filters by site client-side, so with a site filter set it may show nothing even when data exists. Push the filter into the query.
- Realtime subscriptions refetch the whole table on any change. Acceptable now; note it.

### 2.4 The prototype file

`gridwatch (1).jsx` is fully superseded. Nothing in it is missing from the real app except a per-punch attendance model (`type: in/out`, `time`) which, ironically, is closer to what you need than the current muster. Move it to `gridwatch/docs/archive/` or delete it.

---

## 3. Keep, restructure, or scrap?

| Option | What it means | Verdict |
|---|---|---|
| **A. Keep as is, bolt on** | Add procurement, notifications, etc. on the current schema. | No. S1 and S2 will poison everything built on them. |
| **B. Keep stack, restructure data layer and add engineering basics** | Same React/Supabase. Migrations, normalised attendance, one payroll engine, unified procurement, audit, org_id, tests. Rewrite Attendance/Payroll/Register screens; keep the rest. | **Yes. Recommended.** Roughly 2–3 weeks of focused work with Claude Code, and it is the foundation for every later phase. |
| **C. Full rewrite** (Next.js + own API, or React Native) | Own server, native app. | No. You lose the free-tier, no-ops posture that makes this viable for a small contractor, and nothing you need requires it. If you ever need Play Store presence or background GPS, wrap the same React app in Capacitor. |
| **D. Add TypeScript** | Convert incrementally. | Optional. Do it for `src/lib/` (payroll engine, dates, procurement state machine) where correctness matters, leave existing JSX. Vite handles a mixed codebase. |

Things that stay exactly as they are: Vite, Tailwind v4, lucide, react-router, Supabase JS, the registry pattern, `RecordManager`, `ui.jsx`, Layout, Login, the theme, the module freeze, doc counters, the deployment story.

Things that get added when a phase needs them, not before: Supabase Edge Functions (notifications, vendor links, user creation, face API), `pg_cron` + `pg_net` (scheduled digests), a private storage bucket, a PDF library, an offline queue.

---

## 4. The business, mapped

A fire-protection contractor (sprinklers, hydrants, pump rooms, fire alarm, sometimes electrical) executing at multiple client sites across regions. Below is the process map with where the current app sits and where the pain is. Items in **bold** are what you named; the rest are what the same businesses usually also bleed on.

| Process | Today (app) | Pain | Automation value | Effort | Phase |
|---|---|---|---|---|---|
| **Attendance → wages** | Muster per site/day | Trust in supervisor, no hours, disputes, double-pay | Very high | Medium | 2, 3 |
| **Weekly advances, monthly payroll, payslips, payments** | Partial | Two formulas, no payslip, no "paid" record | Very high | Medium | 3 |
| **Site → office material request → vendor → delivery** | Two overlapping logs | Everything on phone calls and WhatsApp; no price memory | Very high | High | 6 |
| Item & vendor master, price history | None | Re-quoting the same GI pipe every month | High | Low | 6 |
| Material received (GRN) vs indent vs PO | GRN log only | No reconciliation, short deliveries unnoticed | High | Medium | 6 |
| Site stock / consumption / theft | None | Pipes and fittings walk | High | Medium | 9 |
| Tools & assets (threading machine, welding set, grooving tool) | None | "Where is the threading machine?" | Medium | Low | 9 |
| **Document vault + expiries** (licences, WC insurance, NOC, MTC, calibration) | Photos on records only | Expired insurance found the day of an accident | High | Low–Medium | 7 |
| **Generated documents** (challan ✔, salary sheet ✔, PO, RFQ, payslip, DPR PDF, hydrotest report) | 2 of ~8 | Word templates by hand | Medium | Medium | 7 |
| Worker onboarding (ID, photo, bank, induction, police verification) | Aadhaar only | Gate-pass requests at client sites are manual | Medium | Low | 7 |
| Safety: hot-work permits, toolbox talks, incidents | None | Client PMC asks for these; done on paper | Medium | Low | 9 |
| DPR / progress photos / rework | ✔ | Fine | — | — | — |
| Client billing: BOQ quantities, measurement sheets, RA bills, retention, receivables | None | Cash flow blind spot; largest money in the business | Very high | Very high | 9+ (only after 1–8 stable) |
| Site expenses / petty cash → site P&L | Advances only | "Are we making money on this hospital?" | High | Medium | 9 |
| Notifications / daily digest to owner | None | Owner opens the app to find out | High | Low–Medium | 5 |
| Multi-region: site-scoped access, regional managers | None | Everyone sees everything | Medium | Medium | 4 (with audit) |
| Offline in basements/pump rooms | None | Attendance can't be submitted where signal is worst | Medium | Medium–High | 9 |
| Hindi / regional UI | None | Supervisors | Medium | Low | 9 |

Priority logic: attendance and payroll first (Phases 2–3) because they touch every worker every day and are where trust is won or lost; access, audit and notifications next (Phases 4–5) because they are small and make everything after them safer and more visible; procurement (Phase 6) because it is the owner's personal time sink; documents (Phase 7) because it is low risk and high perceived professionalism; everything else after the product has survived three months of real use.

---

## 5. Deep dives

### 5.1 Attendance

#### The question to answer first

"Who is on time" only has meaning once these are defined per site (or per org default):

- Shift start/end (e.g. 09:00–18:00), grace minutes (e.g. 15).
- What "late" costs: nothing / a flag for the owner / a deduction after N lates / half-day after X minutes.
- Half-day threshold (e.g. < 4 hours) and how it pays (0.5 unit).
- Overtime: after how many hours, at what multiplier (1×, 1.5×, 2×), rounded to what (30 min).
- Weekly off: paid or not, and for whom (Monthly yes, Daily usually no).
- Public holidays / rain days / client shutdowns: paid or not.
- Wage units: is the payroll unit a **day** ("hazri"), an **hour**, or a mix (day + OT hours)? For most Indian sites it's hazri + OT hours.
- Worker types: Daily, Monthly, **Piece-rate** (per metre of pipe), **Gang/subcontractor** (a thekedar brings 8 helpers, you pay him a lump sum). The current model has only Daily/Monthly.

These are questions for your uncle, listed in §10. The design below handles all of them via config so you don't need the answers to start.

#### Capture options

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Supervisor muster** (current) | One submission: tick list + group photo + GPS | Zero friction for workers; works when workers have no phones | Supervisor is the single point of trust; no in/out | Keep as *one* mode |
| **B. Supervisor per-worker punch** | Supervisor taps worker → in; later taps → out. Optional face photo per punch. | Gives hours; still no worker phone needed; per-worker photo is far more verifiable than a group shot | More taps per day (2 × N) | **Primary mode for Phase 2** |
| **C. Worker self check-in** | Each worker has a login; check-in with selfie + GPS geofence | Removes supervisor trust | Most helpers won't have/charge/carry a smartphone; account sprawl; phone sharing | Optional for supervisors & monthly staff only |
| **D. QR / NFC ID cards** | Print worker ID with QR; supervisor scans | Fast, cheap, no biometrics, doubles as the client gate-pass ID | Cards get shared; needs printer | Add in Phase 7 with ID card generation; combine with B |
| **E. Face recognition on the group photo** | Detect + match faces against enrolled photos | Auto-fills the tick list | Small faces, helmets, masks, dust, backlight: expect poor recall on a 15-person shot | Spike only (Phase 8) |
| **F. Face verification per punch** | At each punch (option B) compare the selfie to the enrolled photo | High accuracy (1:1 match, close-up), flags impostors | Needs enrolment photos, consent, a model in-browser or an API | **The realistic version of "facial recognition"**, Phase 8 |
| **G. Hardware biometric terminal** (eSSL etc.) | Fingerprint/face device at site | Proven in India | Needs power + network + a fixed place; sites are temporary and spread out; ₹8–25k each | No, except for long-running large sites |
| **H. WhatsApp bot** | Supervisor sends photo + names to a number | Lowest possible friction | Parsing names is fragile; costs per message; no structure | No as primary; maybe as a fallback later |

**Recommendation:** Phase 2 builds the normalised model and supports modes A and B on the same screen (a site setting chooses). Mode A remains for sites where two taps per worker is too much. Both write the same `attendance_entries` rows. Server-side timestamps, geofence checks and edit windows apply to both.

#### Anti-fraud controls that don't need AI

- `marked_at` set by the database (`default now()`), not the phone; the client's claimed time is stored separately for comparison.
- `sites.lat/lng/radius_m`; the DB rejects (or flags) a punch outside the radius when the site requires it.
- Live capture only (`<input capture="environment">`), reject gallery uploads for muster photos where required; store the photo's EXIF timestamp if present.
- Edit window: entries editable by the supervisor for N hours, then only by a role with `attendance_verify`.
- Every change is in `audit_log` and visible on the entry.
- Owner's dashboard shows "verify" queue: entries with flags (outside radius, no photo, edited after window, marked before 6 AM, duplicate across sites).
- Random spot-check prompt: once a week the app asks the supervisor for a fresh photo at a random time (optional, Phase 8).

#### Target data model (Phase 2)

```
musters            one per site per day (group photo, gps, marked_by, note, status)
attendance_entries one per worker per site per day
  employee_id, site_id, date, in_time, out_time, units numeric (1, 0.5, 0),
  ot_hours numeric, status ('present','half','absent','leave','holiday'),
  late_min int, source ('muster','punch','self','import'),
  photo_url, lat, lng, accuracy_m, flags text[], verified_by, verified_at,
  created_by, marked_at (server), client_time
  unique (employee_id, date, site_id)
  + a rule: sum(units) per (employee_id, date) <= 1 unless override
site_settings      shift_start, shift_end, grace_min, half_day_hours, ot_after_hours,
                   ot_multiplier, require_photo, require_gps, radius_m, edit_window_hours
```

The current `attendance` table migrates cleanly: each `present_ids` element becomes one entry with `in_time = present_times[id]`, `units = 1`.

### 5.2 Payroll

#### One engine

`computePayroll({ employees, entries, advances, adjustments, rules, month, asOf })` → rows. Pure function, no Supabase calls, in `src/lib/payroll.js` (TypeScript recommended). Both screens and the payslip renderer call it. Unit tests cover: Daily, Monthly (prorated vs full — rules decide), half days, OT, leave, holidays, advances exceeding wages, mid-month rate change (`employee_rates` history table instead of a single `wage_rate`), overrides, "as of" partial months, a worker at two sites.

#### What's missing beyond the formula

- **Wage history**: `employee_rates (employee_id, effective_from, wage_type, rate)`. Today's override note "raised to ₹700/day from the 15th" is a workaround for this.
- **Payments**: `payroll_payments (run_id, employee_id, amount, mode cash/upi/bank, paid_on, ref, paid_by)`. Supports partial payments and weekly payouts against the month. The Register's "as of" feature is really a weekly payout; model it as one.
- **Payslip per worker** (print/PDF and WhatsApp share), signature sheet already exists.
- **Site labour cost report**: total wages per site per month, and per worker-day. This is the number your uncle will use to price the next job.
- **Gang/subcontractor payments**: a `contractors` master with lump-sum or per-head rates; their helpers can still be counted in headcount without individual wages.
- **Statutory** (only if applicable, check with his CA): PF (20+ employees), ESI (10+ employees below the wage ceiling), BOCW cess, professional tax by state. Model as configurable deductions; don't hard-code.

#### Lock semantics

Today: `module_locks.payroll` freezes the whole module. Better: a saved `payroll_run` for a month locks the *entries of that month*: attendance and advances for a month with a finalised run become read-only unless an admin reopens the run (audited). Keep the module freeze as a coarse tool.

### 5.3 Procurement

#### Target flow

```
Request (site)  →  Review/Approve (office / owner)  →  Source
   →  Quotes (vendors)  →  Compare & select  →  PO  →  Delivery + GRN (site)
   →  Vendor invoice → Payment
```

with shortcuts: a request for a catalogued item with a preferred vendor and a valid price can skip straight to PO ("reorder"); a request under a threshold can be approved by the secretary role; site stock can fulfil a request without buying ("issue from store").

#### Tables

```
items            master catalogue: name, category, unit, spec, is_asset (tool) vs consumable,
                 preferred_vendor_id, last_price, last_price_date, reorder_hint
vendors          name, contact, phone, whatsapp, email, gstin, address, categories text[],
                 rating, notes
vendor_items     vendor_id, item_id, last_quoted_price, last_quoted_at, lead_days
purchase_requests  doc_no PR-0001-2026, site_id, requested_by, needed_by, priority,
                 status (draft, submitted, approved, rejected, sourcing, ordered,
                 partially_received, received, closed), approved_by, approved_at, notes
purchase_request_items  request_id, item_id (nullable for free-text), description, qty, unit,
                 qty_received
rfqs             request_id, sent_to vendor_ids, sent_at, due_at, channel
quotes           rfq_id, vendor_id, items jsonb (item_id, price, qty, gst, lead), total,
                 received_at, received_via (manual/link/whatsapp), notes, selected bool
purchase_orders  doc_no PO-0001-2026, vendor_id, request_id, items jsonb, total, terms,
                 status (sent, acknowledged, delivered, cancelled), deliver_to_site_id
goods_receipts   (replaces material_received) po_id nullable, site_id, items jsonb with
                 qty_received/qty_rejected, photos, challan_ref, received_by
```

`requirements` and `indents` both migrate into `purchase_requests`. `material_received` becomes `goods_receipts` with an optional PO link so short deliveries are visible.

#### Vendor interaction options

| Option | Mechanism | Adoption risk | Needs server? | Phase |
|---|---|---|---|---|
| **1. Office records quotes manually** | Secretary calls vendors as today, types 2–3 quotes into a comparative statement | None | No | **4** |
| **2. Magic-link quote form** | App sends WhatsApp/email "Quote for PR-0042: 30 m 2" GI pipe…" with a tokenised link; vendor fills a one-page form, no login | Low | Yes: Edge Function + WhatsApp Cloud API / email | **5** |
| **3. Vendor logins** | Vendor role, sees only their RFQs, submits quotes in-app | High: a vendor won't install an app for one small buyer | No (RLS) | 9+, only for big recurring vendors |
| 4. Voice/WhatsApp parse | Vendor replies in free text; parse with an LLM | Medium | Yes | Later experiment |

Start with 1. It already delivers the durable asset: price history and a comparative statement your uncle can approve with one tap on his phone. Option 2 is the automation you described and follows in Phase 5 once there are vendors and items in the system to notify.

#### Approval routing

Configurable: `approval_rules (org_id, max_amount, approver_role)`, e.g. secretary up to ₹5,000, owner above. Approvals are a table (`approvals: entity, entity_id, decided_by, decision, note`) so the same mechanism serves POs, salary overrides and later client bills.

### 5.4 Documentation

#### A. Document vault

`documents (org_id, scope: company|site|employee|vendor|po, scope_id, category, title, file_url (private bucket), issued_on, expires_on, reference_no, uploaded_by, tags)`.

Categories that matter in this trade (confirm with him):

- Company: Fire licence / fire contractor registration (state-specific), GST, PAN, Labour licence (CLRA), WC insurance policy, ESI/PF registration, BOCW registration, ISO certs, bank details.
- Site: Work order / contract, BOQ, GFC drawings, shop drawing approvals, MTCs (already a log), hydrotest / flushing / pump test reports, commissioning report, Fire NOC / completion certificate, client's safety approvals, hot-work permits, JMR (joint measurement records), RA bill copies.
- Employee: photo, Aadhaar (masked, restricted), bank proof, police verification, medical fitness, safety induction, height-work certificate, joining form, ID card.
- Vendor: GST, cancelled cheque, rate contracts.
- Equipment: calibration certificates for pressure gauges and test pumps (these expire and PMCs ask for them).

Expiry alerts: a daily job (pg_cron) lists documents expiring in 30/7/0 days on the dashboard and in the WhatsApp digest.

#### B. Generated documents

Already: delivery challan, salary statement. Add: purchase request, RFQ, comparative statement, PO, payslip, worker ID card with QR, DPR PDF (site/day), monthly attendance register PDF, GRN. Approach: HTML print templates like today (cheapest, works offline) with a `print.css`; move to `@react-pdf/renderer` or server-side PDF only if clients demand fixed layouts. Company details from `org_settings` (replacing `config/company.js`) so it works multi-tenant.

#### C. PII handling

Aadhaar, phone, photos of faces, bank details. Rules: private bucket + signed URLs, restricted read policies (`can_view_pii()`), masked display by default, consent checkbox recorded at onboarding (`employees.consent_at`), a retention/delete path when a worker leaves.

### 5.5 Other automation worth planning for

- **Daily digest (Phase 5)**: at 10:30 AM and 7 PM, WhatsApp/email to the owner: sites without attendance, headcount per site, requests awaiting his approval, deliveries received, documents expiring. This single feature makes the app feel alive without him opening it.
- **Approval by reply**: "Approve PR-0042?" → he taps a link (magic link with a one-shot token). Same mechanism as vendor quotes.
- **Site stock (Phase 9)**: `stock_movements (site_id, item_id, qty, type: received|issued|consumed|returned|transferred)`. GRN adds, DPR "material consumed" deducts, transfers between sites via challans. Reconciliation report per site.
- **Tools and assets (Phase 9)**: `assets (item_id, serial, status, current_site_id, custodian_employee_id)` + `asset_movements`. Cheap to build on the same masters.
- **Site expenses and P&L (Phase 9)**: `expenses (site_id, category, amount, paid_by, mode, photo)`; combine with labour cost and material cost for a per-site margin view. High owner value.
- **Safety records (Phase 9)**: hot-work permit, toolbox talk attendance (reuse attendance entries), incident report with photos. Low effort, high client-facing value.
- **Client billing (later)**: BOQ items per site, measurement entries against BOQ, RA bill generation with retention/TDS/GST, receivables. Biggest money, biggest scope; only after the operational modules are solid.
- **Reports (Phase 9)**: labour cost per site per month, material cost per site, attendance summary, vendor spend, open requests ageing. Postgres views + a `Reports` screen with CSV.
- **Offline (Phase 9)**: IndexedDB queue for attendance punches and photos; sync when online; conflict rule = server wins on duplicates. Do this after the entry model is stable.
- **Language (Phase 9)**: `react-i18next` with Hindi first; supervisors' screens only (attendance, DPR, requests).
- **User management in-app (Phase 4)**: an Edge Function using the service role key to create/disable logins so your uncle never opens the Supabase dashboard. Phone-number logins via OTP need an SMS provider (MSG91/Twilio); keep email+password (with a made-up email) until Phase 10.

---

## 6. Architecture direction

**Frontend**: unchanged. Add ESLint, Vitest, Playwright, optional TypeScript for `src/lib`. Consider TanStack Query only if `useRecords` starts to hurt; it's not needed now.

**Backend**: Supabase remains the whole backend. Add, when the phase needs it:

- `supabase/migrations/` (Phase 1). Deployment becomes `supabase db push`.
- `supabase/functions/` Edge Functions (Deno): `notify` (WhatsApp/email), `vendor-quote` (tokenised public form), `admin-users` (create/disable logins), `face-verify` (Phase 7 if using an external API). Secrets stay server-side.
- `pg_cron` + `pg_net` for scheduled digests and expiry checks.
- Private storage bucket `private` for muster photos, documents, ID proofs; signed URLs with 1-hour expiry.
- `audit_log` via a generic trigger.

**Tenancy**: `orgs` table; `org_id not null` on every business table with `default current_org()` (derived from `profiles.org_id`); every RLS policy adds `org_id = current_org()`. `roles`, `module_locks`, `doc_counters`, `site_settings`, `payroll_rules` all become per-org. Storage paths prefixed `{org_id}/`. Do this in Phase 1 while the data is one company; the cost is one migration and a search-and-replace in policies. Nothing else about SaaS (signup, billing, plans) is built until Phase 10.

**Auth**: Supabase email+password stays. Add "first user of a new org becomes that org's admin" logic when Phase 10 arrives.

**Notifications**: WhatsApp Cloud API (Meta) direct, or via an Indian BSP (Gupshup, Interakt, MSG91) for easier template approval. Utility templates cost roughly ₹0.12–0.80 per message depending on category and provider (verify current rates). Email via Resend (free tier) as the fallback channel. Never put these keys in the frontend; always through an Edge Function.

**Face verification (Phase 8)**: prefer in-browser (`@vladmandic/human` or MediaPipe) for 1:1 selfie-vs-enrolment comparison, no per-call cost, works on mid-range Android; fall back to AWS Rekognition `CompareFaces` via Edge Function (~$0.001 per comparison) if in-browser accuracy is insufficient. Store embeddings, not just photos, in a restricted table. Obtain and record consent.

---

## 7. Roadmap with checkpoints

Each phase has: scope, out of scope, **exit test** (the checkpoint), and what must be true in real use before the next phase starts. Effort is rough calendar time for one person working with Claude Code part-time; the real constraint is the pilot duration, not the coding.

| Phase | Name | Effort | Gate |
|---|---|---|---|
| 0 | Deploy and pilot as-is | 2 days + 2 weeks use | Office and one site use it daily for 2 weeks |
| 1 | Foundation and hardening | 1–2 weeks | Migrations, tests, bug fixes live; nothing regressed |
| 2 | Attendance v2 | 2 weeks + 1 month use | One month at 2 sites, verified against spot checks |
| 3 | Payroll v2 | 2 weeks + 1 payroll cycle | A real month's wages paid from the app's numbers |
| 4 | Access, audit, users | 1 week | Site-scoped roles in use; owner never opens Supabase |
| 5 | Notifications | 1 week | Owner relies on the digest; approvals happen from the phone |
| 6 | Procurement v1 | 3 weeks + 1 month use | 20 real requests end to end, comparative statements used |
| 7 | Vendor automation + documents | 3 weeks | ≥50% of quotes arrive via link; vault has all company docs with expiries |
| 8 | Field verification spike (face/QR) | 1 week spike | Decision: adopt, adapt, or drop, with measured accuracy |
| 9 | Operations depth (stock, assets, expenses, reports, offline, Hindi) | pick per demand | Each sub-feature gated separately |
| 10 | SaaS | 4+ weeks | Second company onboarded without you touching the DB |

### Phase 0 — Deploy and pilot what exists (now)

- Deploy to Netlify against a Mumbai-region Supabase project. Fill `company.js`. Create logins for the office and one supervisor. Load the real site list and team.
- Run 2 weeks: attendance daily, DPR daily, requirements as they come, advances weekly. Keep the paper register in parallel.
- **Do not fix anything except blockers.** Keep a list.
- **Exit test**: 10 working days of attendance exist for one site; the office has looked at the dashboard every day; you have a written list of what confused the supervisor and what the office wished it could see. This list reorders everything below.

### Phase 1 — Foundation and hardening

- Supabase CLI + `migrations/`; generate the first migration from the live schema; retire hand-pasting.
- ESLint, Vitest, Playwright skeleton; GitHub Actions running lint + unit tests on push.
- Fix B1 (local dates), B2 (Aadhaar restricted), B3 (private bucket + delete policy), B4 (`created_by default auth.uid()`), B6 (site lat/lng/radius), B7 (site settings for required photo/GPS/edit window).
- Add `orgs` + `org_id` everywhere + `current_org()` in RLS (S8).
- Add `audit_log` with a generic trigger on attendance, advances, salary_adjustments, payroll_runs, employees (S6).
- Archive the prototype file. Update `CLAUDE.md` for the new workflow.
- **Exit test**: `npm run lint && npm test` green; pgTAP proves a Viewer cannot write and cannot read Aadhaar; a punch outside the site radius is flagged; the pilot site keeps working with no visible change.

### Phase 2 — Attendance v2

- `musters` + `attendance_entries` + `site_settings` per §5.1; migrate existing rows.
- Attendance screen: mode A (tick-list muster, now writing entries) and mode B (per-worker in/out punches with optional selfie), selectable per site. Late/half/OT computed from site settings and shown at the time of marking.
- Owner's "Verify" view: flagged entries, one-tap confirm/reject, with reasons.
- Attendance Register becomes a read-only calendar grid per site/month from entries (P / H / A / L / OT), exportable.
- **Exit test**: one month at two sites; the owner's random spot checks (physically count heads 5 times) match the app; no duplicate paid days across sites; supervisors' feedback on tap count collected; edit history visible for every changed entry.

### Phase 3 — Payroll v2

- `employee_rates` history, `payroll_rules` config, `computePayroll()` engine with tests, `payroll_payments`, payslips, site labour cost report.
- Payroll and Register both read from the engine; the Register's "as of" becomes a weekly payout preview and a payment record.
- Finalising a run locks that month's entries/advances.
- **Exit test**: the real month's salary is paid from the app's sheet; the accountant or your uncle reconciles it against the paper register and signs off; every worker receives a payslip; unit tests cover every rule in `payroll_rules`.

### Phase 4 — Access, audit, users

- `profile_sites` scoping + RLS; regional manager role.
- `admin-users` Edge Function: create/disable/reset logins in Admin Control.
- Audit log viewer per record and per module.
- **Exit test**: a supervisor cannot see or edit another region's site; your uncle creates a new login himself; an attendance edit shows who/when/what in the UI.

### Phase 5 — Notifications

- `notify` Edge Function + `notifications` table (outbox) + templates; WhatsApp Cloud API or BSP, email fallback.
- Daily digest (pg_cron), missing-attendance alert at 10:30, approval request pings, document expiry warnings.
- One-shot magic links for approvals.
- **Exit test**: 2 weeks of digests delivered; the owner approves at least 5 things from the link without opening the app; delivery failures are visible in an outbox screen.

### Phase 6 — Procurement v1

- Items, vendors, vendor_items, purchase_requests (+items), approvals, quotes (manual entry), comparative statement, purchase_orders, goods_receipts; migrate `requirements`, `indents`, `material_received`.
- Site screen: raise request (pick from catalogue or free text, photo), see status. Office screen: queue, approve, record quotes, compare, create PO (PDF), track delivery. Site: GRN against PO with shortages.
- Reorder shortcut for catalogued items with a valid last price.
- **Exit test**: 20 real requests go through the full flow; the owner approves from the phone; the office stops using WhatsApp for indents (ask them); price history exists for the top 30 items.

### Phase 7 — Vendor automation and document vault

- `vendor-quote` Edge Function + public tokenised quote page; RFQ send via WhatsApp/email; quotes land in the comparative automatically.
- `documents` vault with scopes, categories, private storage, expiry job; worker onboarding checklist; ID card PDF with QR.
- **Exit test**: at least half of the quotes for a month arrive via the link; every company-level document is in the vault with an expiry date; the first expiry alert fires correctly.

### Phase 8 — Field verification spike

- Collect 200+ real punch selfies and 30+ group photos from the pilot (with consent).
- Measure: in-browser 1:1 verification accuracy at punch time; group-photo detection recall; time per punch on the supervisors' actual phones. Compare with QR cards (already printable from Phase 7).
- **Exit test**: a one-page decision memo with numbers. Adopt, adapt (e.g. QR + random selfie), or drop.

### Phase 9 — Operations depth (each independently gated)

Site stock and transfers; tools/assets; expenses and site P&L; reports; offline queue; Hindi UI; safety records. Pick by what the pilot is asking for. Client billing/BOQ only when everything above has been stable for a quarter.

### Phase 10 — SaaS

Self-serve org signup, org settings, plan limits, Razorpay subscription, per-org storage quotas, data export, a landing page, onboarding checklist, support channel. Multi-tenant isolation tests in pgTAP become mandatory CI. Onboard the second company from your uncle's network as a design partner at zero cost.

---

## 8. Testing roadmap

### 8.1 Layers

| Layer | Tool | What it covers | Introduced |
|---|---|---|---|
| Static | ESLint (+ TypeScript in `src/lib`) | Obvious errors, unused code | Phase 1 |
| Unit | Vitest | `computePayroll`, date helpers, late/half/OT classification, procurement state machine, CSV | Phase 1 (skeleton), 2–3 (real) |
| Database | pgTAP via `supabase test db` | RLS: each role × each table × select/insert/update/delete; org isolation; triggers (audit, doc numbers, geofence flag); migrations apply on a clean DB | Phase 1 |
| Integration | Vitest against a local Supabase (`supabase start`) | `useRecords`, engine + DB fixtures, Edge Functions | Phase 3+ |
| E2E | Playwright (mobile viewport) | Login → mark attendance → see on dashboard; raise request → approve → PO; run payroll → payslip | Phase 1 skeleton, grows per phase |
| Manual UAT | Checklist per phase, run on the supervisors' actual phones | Camera, GPS, PWA install, slow network (throttle to 3G) | Every phase |
| Field pilot | Parallel run vs paper | The only test that matters for trust | Phases 0, 2, 3, 6 |

### 8.2 Pilot protocol (Phases 2, 3, 6)

1. Choose 1–2 sites with a cooperative supervisor and 10–25 workers.
2. Run paper and app in parallel for the full period. Do not stop paper until the exit test passes.
3. Owner performs at least five unannounced headcounts; record app vs count.
4. Weekly 15-minute call with the supervisor and the office: what was slow, what was wrong, what they worked around.
5. At month end, reconcile: app payroll vs paper payroll per worker. Every difference gets a root cause (data entry, rule, bug).
6. Go/no-go is written down with the numbers.

### 8.3 What "done" means for a phase

- Code merged, migration applied to prod, `CLAUDE.md` updated.
- Unit + pgTAP green in CI. E2E for the phase's flow green.
- UAT checklist signed by the office user.
- Field exit test met and recorded in `docs/decisions/` (see §11).

---

## 9. SaaS path

**Why this niche can work**: generic Indian construction apps (Powerplay, Onsite and similar; verify the current landscape before positioning) target builders and civil contractors. MEP and fire contractors have specific needs: MTCs and hydrotest documentation, moving crews, gang-based labour, vendor-heavy procurement of standard catalogue items, and PMC-driven document demands. A tool that gets attendance → wages and request → PO right for a 20–200 worker contractor, priced per site or per worker at a few hundred rupees a month, with WhatsApp as the notification channel, is a real product. Your uncle's network is the distribution channel; his company is the reference customer.

**What to keep in mind now so Phase 10 is cheap**:

- `org_id` everywhere (Phase 1).
- No hard-coded company details (`company.js` → `org_settings`).
- Every "rule" (shift, OT, approval threshold, doc numbering prefix) is a per-org config row, not code.
- Storage paths and doc counters keyed by org.
- Feature flags per org (`org_features jsonb`) so you can turn modules on and off per customer.
- A data export per org (CSV bundle) from day one; it's also your backup story.

**What not to build until Phase 10**: signup flow, billing, plans, marketing site, per-org subdomains, white-labelling.

**Pricing thoughts to validate**: per active worker per month (₹20–40) or per site per month (₹500–1,500) with unlimited users; free for one site to seed adoption. WhatsApp message costs must be inside the price or passed through.

---

## 10. Questions for your uncle (business rules interview)

Answers change the design; get them before Phase 2.

**People and pay**
1. How many workers on roll right now, across how many sites? Peak in a year?
2. Categories: daily wage, monthly, piece-rate, subcontractor gangs? Rough split.
3. Shift timing per site. Grace period. What happens when someone is late: nothing, warning, half-day after X minutes?
4. Half day rules. Overtime: after how many hours, at what rate, who approves?
5. Weekly off paid? Public holidays? Rain/no-work days?
6. Advances: who gives, how often, any cap (e.g. 50% of earned)?
7. How is salary paid: cash, UPI, bank? Weekly, fortnightly, monthly? Is there a "kharchi" weekly amount plus monthly settlement?
8. PF/ESI/BOCW applicability (ask his CA). Any deductions (mess, PPE, fines)?
9. Do supervisors get paid from the same sheet? Are they on the app as users?

**Attendance**
10. Who marks attendance today, and how does the office check it? How often does a dispute happen?
11. Do workers carry smartphones? Which brands? Do sites have signal in the pump room/basement?
12. Would workers accept a selfie at check-in? An ID card? (Consent + practicality.)
13. Do workers move between sites within a day? Within a week?

**Procurement**
14. Who raises requests, who approves, is there an amount below which the secretary decides?
15. Roughly how many purchase requests per month? What are the top 30 recurring items?
16. How many vendors, how many are regulars, do they use WhatsApp?
17. Is there a store/godown, or does everything go straight to site? Is site stock tracked at all?
18. Are tools (threading machines, welding sets) tracked? Who is responsible for a lost tool?

**Documents and clients**
19. What documents do client PMCs ask for at each site (list)? What do they ask at the gate for workers?
20. Which company documents expire (insurance, licences, NOC, calibration)? Who tracks renewals?
21. How is billing to clients done: RA bills against BOQ? How are measurements recorded? Retention %?
22. What reports would he like on his phone every morning and every month-end?

**Scale and constraints**
23. How many regions, and are there regional in-charges who should see only their sites?
24. Preferred language for supervisors' screens.
25. Budget appetite for messaging (WhatsApp) and hosting once free tiers are exceeded (~₹2–3k/month).

---

## 11. Decision log

Decisions you need to make; my recommendation is first in each list. Record the outcome in `docs/decisions/NNNN-title.md` (one paragraph each) so future sessions don't re-litigate.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Keep vs rewrite | Restructure (B) / bolt-on (A) / rewrite (C) | **B** |
| D2 | Attendance primary mode | Supervisor per-worker punch (B) / muster (A) / self check-in (C) | **B with A as per-site option** |
| D3 | Payroll unit | Days + OT hours / pure hours / pure days | **Days (units) + OT hours**, rules per org |
| D4 | Monthly wage proration | Prorate by working days / pay full unless absent > N / full always | Config; default **prorate**, confirm with uncle |
| D5 | Multi-tenant column timing | Phase 1 / Phase 10 | **Phase 1** |
| D6 | TypeScript | `src/lib` only / everywhere / none | **`src/lib` only** |
| D7 | Vendor channel | Manual → magic link → logins | **That order** |
| D8 | Notification provider | Meta Cloud API direct / Indian BSP / email only | Start **email + BSP trial**; pick by template approval pain |
| D9 | Face verification | 1:1 selfie in-browser / cloud API / group-photo / none | **Spike first (Phase 8)**; likely 1:1 in-browser or QR |
| D10 | Aadhaar storage | Masked last-4 only / encrypted full / restricted table | **Restricted table + masked display**; encrypt if the CA says full number is needed |
| D11 | Offline | IndexedDB queue / none / native wrapper | **Queue, Phase 9**, only for attendance and photos |
| D12 | Phone-number login | Email+password (fake emails) / OTP via SMS | **Email now**, OTP at SaaS |
| D13 | PDF generation | Print CSS / react-pdf / server | **Print CSS**, revisit if clients complain |

---

## Appendix A — Target schema (tables by phase)

```
Phase 1  orgs, org_settings, audit_log, site_settings, employee_documents (Aadhaar moves here)
Phase 2  musters, attendance_entries          (replaces attendance)
Phase 3  employee_rates, payroll_rules, payroll_payments   (payroll_runs kept)
Phase 4  profile_sites
Phase 5  notifications, notification_templates, magic_tokens
Phase 6  items, vendors, vendor_items, purchase_requests, purchase_request_items,
         approvals, approval_rules, quotes, purchase_orders, goods_receipts
         (replaces requirements, indents, material_received)
Phase 7  rfqs, documents, document_categories
Phase 8  face_enrolments (embeddings, consent)  if adopted
Phase 9  stock_movements, assets, asset_movements, expenses, permits, incidents
Phase 10 plans, subscriptions, org_features, invites
```

## Appendix B — Immediate fix list (can be done in one session)

1. `format.js`: local-date `today()`/`thisMonth()`.
2. `sites`: `lat`, `lng`, `radius_m`; Sites screen captures GPS like Attendance does.
3. Aadhaar: move to `employee_documents` with admin/HR read; show last 4 in Team.
4. Storage: create `private` bucket; muster photos go there; signed URLs in Attendance; tighten `uploads_delete` to owner or admin.
5. `created_by uuid default auth.uid()` on all tables; remove from client inserts.
6. Dashboard: push site filter into the queries.
7. Archive `gridwatch (1).jsx`.
