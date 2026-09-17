# Gridwatch Revamp — Checklist

Work happens on branch `v1`, gets tested (see `V1-UPGRADE.md`), then merges to `main`.
Details for each item are in `01-ANALYSIS-AND-ROADMAP.md`; section numbers are in brackets.

Legend: `[x]` built and covered by automated tests · `[~]` built, partly done or deferred on purpose.
Nothing is ticked as *proven in the field* yet — that's the test-project run.

## Doing now

### 1. Foundation
- [~] Supabase CLI migrations — **deferred at your request**; `schema.sql` stays one re-runnable file, now tested fresh, re-applied and as an upgrade [S4]
- [x] ESLint + Vitest tests for money and attendance logic, plus database permission (RLS) tests (PGlite, no Supabase needed) and CI [S5, §8]
- [x] `org_id` on every business table, enforced in every policy [S8]
- [x] Audit log: who changed what and when, on attendance, money, masters, procurement and settings [S6]

### 2. Security and privacy
- [x] Aadhaar restricted to roles with "Worker ID & Aadhaar"; everyone else sees only the last 4 digits [B2]
- [x] Private storage bucket for muster/punch photos, worker photos and documents; only the owner or Admin can delete files [B3]

### 3. Sites
- [x] Site location + radius (geofence) [B6]
- [x] Per-site settings: shift times, grace, half-day and overtime rules, photo/GPS required, edit window, weekly off [B7, §5.1]

### 4. Attendance v2 [S1, §5.1, Phase 2]
- [x] One attendance row per worker per day instead of one row per site (a second paid day at another site is refused) [B5]
- [x] Two marking modes per site: group muster and per-worker in/out punch
- [x] Late, half-day and overtime worked out automatically from site settings (server-side, previewed on screen)
- [x] Owner's "Verify" queue for flagged entries
- [x] Attendance Register becomes a monthly calendar grid (P / H / A / L / WO / HOL)
- [x] Existing attendance moved to the new format

### 5. Payroll v2 [S2, §5.2, Phase 3]
- [x] One tested payroll calculation, used by Team, the Register, payslips and Reports
- [x] Wage history, so a mid-month raise is recorded with its effective date
- [x] Payment records with amount, mode and date; weekly and partial payouts (replaces Paid/Due; old Paid flags migrated)
- [x] Payslips per worker (print / save as PDF)
- [x] Site labour cost report
- [x] Finalising a month locks that month's attendance and advances (Admin can reopen)

### 6. Access and users [S7, Phase 4]
- [x] Site-scoped access: a login restricted to sites sees and edits only those sites
- [~] Create, disable and reset logins from Admin Control — built as the `admin-users` Edge Function; needs deploying (one command) and a real test
- [x] Change history visible on a record (Admin)

### 7. Procurement v1 [§5.3, Phase 6]
- [x] Item master (seeded from the requirement catalogue) and vendor master with price history
- [x] Site Requirements became purchase requests with approval (old requirements migrated)
- [x] Office types in vendor quotes → side-by-side comparison → purchase order (print / PDF)
- [x] Goods Received checked against the PO, so short and rejected deliveries show up (old receipts migrated)

### 8. Documents [§5.4, Phase 7]
- [x] Document vault (company / site / worker / vendor) with expiry dates
- [x] Expiring documents shown on the Dashboard and in Documents

### 9. Miscellaneous bug fixes and cleanup
- [x] Bug and cleanup fixes:
  - Dates no longer off by one before 5:30 AM IST (UTC bug)
  - `created_by` stamped by the server
  - Dashboard's site filter applied in the database query
  - Big tables load in pages; month data paged past 1,000 rows
  - Shared helpers in one place; screens lazy-loaded
  - Non-admins can't promote themselves by editing their own profile
  - `CLAUDE.md` and `README` updated

> **Still to confirm with your uncle** (the app has settings for all of these; defaults are guesses):
> - Shift times, grace, half-day and overtime rules per site
> - Whether monthly wages are prorated by working days (default) or paid in full
> - Overtime multiplier, whether weekly offs / holidays are paid

---

## Not doing now

| What | Why not |
|---|---|
| Face recognition / selfie verification | Unreliable on group photos with helmets. It needs enrolment, consent and a trial run first. |
| QR / ID cards | Only worth it together with the face-verification trial. Per-worker punches are enough for now. |
| WhatsApp / email notifications, daily digest, approve-by-link | Needs a paid messaging provider, Meta template approval and server functions. Dashboard alerts cover it for now. |
| Vendor quote links / vendor logins | Vendors must be in the system first. Quotes are typed in by the office for now. |
| Site stock, tools and assets, expenses / site P&L, safety records | Useful, but each is its own project. Do them after the core works in real use. |
| Client billing (BOQ, RA bills, retention) | Biggest scope in the whole plan. Only once everything else is stable. |
| Offline mode | Hard to do safely. Wait until the new attendance format has settled. |
| Hindi UI | Cheap, but not needed yet. Easy to add later. |
| Piece-rate and gang/contractor pay, PF/ESI deductions | Need the business rules and the CA's input first. |
| Phone OTP login | Needs a paid SMS provider. Email + password is fine for now. |
| SaaS (signup, billing, plans) | Only `org_id` is added now. Everything else waits until a second company wants it. |
| TypeScript, Playwright end-to-end tests | Nice to have. Lint + unit + database tests + screen smoke tests cover the risky parts. |
| Purchase approval limits by amount | Any approver can approve any request for now; add thresholds once real request sizes are known. |
| "Reorder at last price" shortcut | Needs a few months of price history to be useful. |
