# Testing v1 and upgrading the live project

v1 changes the database a lot: attendance becomes one row per worker per day,
payroll gets wage history and payment records, requirements become purchase
requests, Aadhaar moves to a restricted table, and every row gets a company id.
`supabase/schema.sql` upgrades an existing project in place, and `npm test`
proves that on a copy of the old schema with sample data (and that pasting it
twice changes nothing). Still, rehearse on a **test project** before the live one.

## 1. Rehearse on a test project (before merging `v1`)

1. Create a second free Supabase project (Mumbai), e.g. `gridwatch-test`.
2. **Recreate "today":** SQL Editor → paste `supabase/tests/fixtures/schema.before-v1.sql`
   (a frozen copy of the current live schema) → Run. Create an Admin login
   (Authentication → Users → Add user, auto-confirm).
3. Point the **old** app at it and enter a little realistic data: on `main`,
   create `.env.local` with the test project's URL + anon key, `npm run dev`,
   add 2 sites, 5 workers (one with Aadhaar), a few days of attendance, a
   requirement, a material receipt, an advance, mark one salary Paid.
4. **Upgrade it:** SQL Editor → paste the **new** `supabase/schema.sql` from `v1` → Run.
   Run it a second time: it should succeed again and change nothing.
5. Deploy the login-management function (Supabase CLI via npx, once):
   ```bash
   npx supabase login
   npx supabase functions deploy admin-users --project-ref <test-project-ref>
   ```
6. Switch to `v1` (keep the same `.env.local`), `npm install`, `npm run dev`.
   Open it on a real phone on the same Wi-Fi: `http://<your-computer-ip>:5173`.
7. Go through the list below as Admin, as a Site Team login restricted to one
   site, and as an Office login (create them in Admin Control → Add person).

### What to check

- [ ] The attendance you entered on `main` shows in the Attendance Register grid, same days
- [ ] Sites → capture GPS at a site, muster mode; mark a muster with photo + GPS; re-open and edit it
- [ ] Switch a site to punch mode; IN and OUT a worker; Close day
- [ ] A muster marked far from the site shows the distance warning and appears in Verify Attendance; confirm one, reject one
- [ ] Marking the same worker at a second site on the same day is refused
- [ ] Team → change a wage with an effective date; the payroll tab pays days before it at the old rate
- [ ] Payroll for a month matches what you'd pay by hand (Monthly workers are prorated by working days in v1)
- [ ] Record a payment; balance drops; payslip prints / saves as PDF from the phone
- [ ] Finalise a month; as the Site login, editing that month's attendance is blocked; as Admin, reopen
- [ ] Site Requests → raise a request (the old requirement is there too); Admin approves; Procurement → record 2 quotes, compare, "Order from this", print the PO
- [ ] Goods Received → receive less than ordered; the request shows part received
- [ ] Aadhaar: Admin/Office see it; Site/Viewer logins see only ••••1234 or nothing
- [ ] Documents → add WC insurance expiring within 30 days; the Dashboard warns
- [ ] Admin Control → the site-restricted login sees only that site on every screen
- [ ] Admin Control → Company details appear on a printed challan and PO
- [ ] Admin Control → Audit log shows who changed the attendance you edited
- [ ] Everything is usable one-handed on a 360px-wide phone

## 2. Upgrade the live project (after merging)

1. **Back up first.** Project Settings → Database → connection string, then from your computer:
   ```bash
   pg_dump "postgresql://postgres:<password>@db.<live-ref>.supabase.co:5432/postgres" > gridwatch-before-v1.sql
   ```
   Keep that file somewhere safe.
2. Pick a quiet time (evening); tell supervisors not to mark attendance for 15 minutes.
3. SQL Editor → paste the new `supabase/schema.sql` → Run.
4. `npx supabase functions deploy admin-users --project-ref <live-ref>`.
5. Merge `v1` into `main`; Netlify/Vercel redeploys with the same env vars.
6. Admin Control → Company details: address, phone, GSTIN. Payroll rules: confirm with your uncle.
7. Sites: capture GPS and set attendance rules for each active site.
8. Items: review the seeded catalogue. Vendors: add the regulars.
9. Admin Control → Role permissions: review the new keys (Verify Attendance,
   Approve Requests, Worker ID & Aadhaar, Procurement, Items, Vendors, Documents, Reports).
10. Settings → Authentication: turn off "Allow new users to sign up" — logins are
    now created from Admin Control.

The old tables stay as `attendance_legacy`, `requirements_legacy`,
`material_received_legacy` and `salary_payments_legacy` (Admin can read them).
Drop them after a month or two of confident use.

## If something goes wrong

Restore `gridwatch-before-v1.sql` into a fresh project, point the host's env
vars at it, and redeploy the last pre-v1 commit of `main`.
