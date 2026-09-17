# Gridwatch

Site and office coordination for a fire fighting / electrical contracting business.
Workers on site log attendance and the day's work from their phones; the office
buys material, runs payroll and keeps documents; the owner sees it all live.

**Stack:** React + Vite + Tailwind · Supabase (Postgres + Auth + Storage + one Edge Function) · static hosting.
Everything below runs on free tiers with no card on file.

> **Upgrading an existing project to v1?** Read [`docs/V1-UPGRADE.md`](docs/V1-UPGRADE.md) first.

---

## What's in the box

| Screen | What it does |
|---|---|
| **Dashboard** | Which sites reported today, headcount, attendance to verify, requests to approve, deliveries due, documents expiring |
| **Attendance** | Per site: a daily group muster (tick list + group photo + GPS) or per-worker IN/OUT punches with server time and optional selfie. Half days, overtime and late minutes worked out from the site's rules |
| **Verify Attendance** | Owner's queue of flagged entries (outside the site radius, no photo/GPS, back-dated, edited late) — confirm or reject |
| **Daily Progress** | Work done, manpower, weather, material consumed, issues, photos |
| **Site Requests** | Site asks for material from the item catalogue; tracks approval, order, delivery and the date it was fulfilled |
| **Rework Log** | Quality issues, root cause, corrective action |
| **Procurement** | Office approves requests, types in vendor quotes, compares them side by side, raises and prints purchase orders |
| **Goods Received** | Receive against a PO — shortages and rejections recorded — or without one for local purchases |
| **Items / Vendors** | The catalogue and the supplier list, with price history |
| **Delivery Challan** | Auto-numbered `DC-0001-2026`, prints on A4 or saves as PDF |
| **Transport / Test Certificates / Drawings** | Logs with photos and PDFs |
| **Sites** | Location + radius, attendance rules (shift, grace, half day, overtime, photo/GPS required, edit window), site documents |
| **Team** | Workers with wage history, Aadhaar (restricted), consent. "Left" records the leaving date and moves them to the **Archive** |
| **Payroll** | Monthly pay from attendance: wage per day × days, overtime (per hour of a 9-hour day), bonus, advances, penalty → net. Edit days present after the month ends, log advances for many workers at once, payments, payslips, finalise to lock the month |
| **Documents** | Company licences and insurance, site approvals, vendor papers, worker IDs — with expiry warnings |
| **Weekly Advance** | Cash paid during the month, deducted at payroll |
| **Attendance Register** | Month grid per site (P / H / A / L / WO / HOL) with pay due so far and weekly payouts |
| **Reports** | Labour cost per site and per worker-day, attendance summary, vendor spend, open request ageing, price history |
| **Admin Control** | Add logins, restrict people to sites, role permissions, freeze sections, company details, payroll rules, audit log |

---

## Setup — about 30 minutes, once

### 1. Create the Supabase project

1. **supabase.com** → sign up → **New project**, name `gridwatch`, region **Mumbai (ap-south-1)**.
2. Set a database password and keep it safe (you need it for backups).

### 2. Create the database

SQL Editor → **New query** → paste the whole of `supabase/schema.sql` → **Run**.
It creates every table, the permission rules, storage buckets and live updates.
It's safe to run again later (that's how upgrades are applied).

Then Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".

### 3. Point the app at the project

Project Settings → API → copy the **Project URL** and the **anon / public** key into a `.env` file:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> The anon key is public by design. What protects the data is Row Level
> Security in `schema.sql` — every read and write is checked by the database.

### 4. Run it

```bash
npm install
npm run dev
```

### 5. First login

Authentication → Users → **Add user** with your uncle's email and a password, tick
**Auto Confirm User**, sign in. **The first account becomes Admin.**

### 6. Deploy the login manager (so Admin can add people in the app)

```bash
npx supabase login
npx supabase functions deploy admin-users --project-ref <your-project-ref>
```

The project ref is the `xxxx` in your project URL. Without this, add logins in
the Supabase dashboard and set their role in Admin Control.

### 7. First data

Admin Control → **Company details** (printed on challans, POs and payslips) and
**Payroll rules**. Then **Sites** (stand at each site and tap "Use my current
location") → **Team** → **Vendors**. Then add people in Admin Control.

---

## People and roles

Admin Control → **People & logins** → **Add person**: name, email (make one up
if they have none, e.g. `ravi.site@gridwatch.local`), role, and optionally the
sites they work on — they'll see only those sites everywhere.

| Role | Can do |
|---|---|
| **Admin** | Everything, including permissions, freeze, reopening a finalised month |
| **Site Team** | Attendance, DPR, site requests, goods received, rework, challans, transport, MTC |
| **Regional Manager** | Site work for their sites plus verifying attendance |
| **Office / Store** | Procurement, items, vendors, team, payroll, worker documents, advances, sites |
| **Viewer** | Read almost everything, change nothing |

Retune any role per module in **Role permissions**. Three permissions have no
screen of their own: **Verify Attendance**, **Approve Requests**, and **Worker
ID & Aadhaar** (who can see personal worker documents).

---

## Deploying

### Netlify (recommended)

1. Push to GitHub. **netlify.com** → Add new site → Import → pick the repo (build settings come from `netlify.toml`).
2. Site settings → Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Deploy, then rename the site under Site settings.

**Vercel** and **Cloudflare Pages** work the same way (`vercel.json` and
`public/_redirects` handle routing). Build command `npm run build`, output `dist`.

### On the phones

Open the link → **Add to Home screen** (Chrome menu ⋮, or Safari's share button).
It opens full-screen with camera and GPS like an app.

---

## Development

```bash
npm run lint   # eslint
npm test       # unit tests + screen smoke tests + database tests (no Supabase needed)
npm run build
```

The database tests run `supabase/schema.sql` inside PGlite (Postgres in WASM)
and check permissions, attendance rules, procurement roll-ups and the upgrade
from the pre-v1 schema. CI runs all three on every push.

```
gridwatch/
├── supabase/
│   ├── schema.sql                ← the entire database, one re-runnable file
│   ├── functions/admin-users/    ← Edge Function: create/disable logins
│   └── tests/                    ← PGlite database tests
├── src/
│   ├── config/                   ← modules (nav + permissions), fields, documents
│   ├── lib/                      ← payroll engine, attendance rules, procurement, uploads, dates
│   ├── hooks/                    ← useRecords, usePayrollInputs
│   ├── context/                  ← auth + roles, shared sites/employees/settings
│   ├── components/               ← UI primitives, RecordManager, print sheets
│   ├── modules/                  ← one file (or folder) per screen
│   └── pages/Login.jsx
└── docs/                         ← roadmap, checklist, upgrade guide
```

See `CLAUDE.md` for architecture and the rules for changing the schema.

---

## Free tiers

| | Free limit | What that means here |
|---|---|---|
| Database | 500 MB | Per-worker attendance is ~15k rows a year for 50 workers — still tiny |
| Storage | 1 GB | Photos are shrunk to ~200 KB: roughly 5,000 photos |
| Bandwidth | 5 GB/month | Comfortable for a handful of users |
| Edge Functions | 500k calls/month | Only used when adding people |

Supabase pauses free projects after 7 days with no activity; daily use prevents it.

## Backups

No automatic backups on the free tier. Monthly (and **before every schema change**):

```bash
pg_dump "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" > gridwatch-YYYY-MM.sql
```

Every screen also has an **Export** button for CSV.

## Known limits

- **No offline mode.** A site with no signal can't submit; the form stays on screen for retry.
- **Deleting a site deletes its history.** Use **Close** instead.
- **Not yet:** face recognition, QR ID cards, WhatsApp notifications, vendor quote links,
  site stock and tools, client billing, Hindi screens (see `docs/checklist.md`).
