# Gridwatch

Site and office coordination for a fire fighting / electrical contracting business.
Workers on site log the day's work from their phones; the office sees it live.

**Stack:** React + Vite + Tailwind · Supabase (Postgres + Auth + file Storage) · static hosting.
Everything below runs on free tiers with no card on file.

---

## What's in the box

| Screen | What it does |
|---|---|
| **Dashboard** | Which sites have reported today, headcount, what's outstanding |
| **Attendance** | One daily muster per site — tick who's present, one group photo, GPS captured |
| **Daily Progress** | Work done, manpower, weather, material consumed, issues, photos |
| **Site Requirements** | What site needs from the office, with priority and open/fulfilled status |
| **Work Photos** | Progress photo log by site and area |
| **Rework Log** | Quality issues, root cause, corrective action |
| **Site Indent** | Material requisition, auto-numbered `IND-0001-2026`, status tracked |
| **Material Received** | Incoming material with photos of goods and supplier challan |
| **Delivery Challan** | Auto-numbered `DC-0001-2026`, prints on A4 or saves as PDF |
| **Transport** | Vehicle, driver, from/to, LR number, freight |
| **Test Certificates** | MTC by material and batch, photograph every page |
| **Drawing Records** | Drawing number, title, discipline, revision, status |
| **Sites / Team** | Master lists that everything else hangs off |
| **Weekly Advance** | Cash paid during the month |
| **Payroll** | Days present × wage − advances, saved as a snapshot, prints a signed salary sheet |
| **Admin Control** | Assign roles, set per-module permissions, freeze a finished month |

---

## Setup — about 20 minutes, once

### 1. Create the Supabase project (the database)

1. Go to **supabase.com** → sign up (GitHub login is fastest) → **New project**.
2. Name it `gridwatch`. Pick region **Mumbai (ap-south-1)** — closest to site, so it feels fast.
3. Set a database password and save it somewhere. You won't need it day to day.
4. Wait ~2 minutes for it to finish provisioning.

### 2. Create the tables

1. In the project, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, copy the whole file, paste it in.
3. Click **Run**. You should see `Success. No rows returned`.

That one script creates every table, the permission rules, the photo storage
bucket, and the live-update subscriptions.

### 3. Point the app at your project

1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the
   **anon / public** key.
2. In this folder, copy `.env.example` to `.env` and paste both values in.

```bash
cp .env.example .env    # on Windows: copy .env.example .env
```

> The anon key is meant to be public — it's in every browser that loads the app.
> What actually protects your data is the Row Level Security in `schema.sql`:
> nothing is readable or writable without a signed-in account.

### 4. Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### 5. Create your uncle's login

1. Supabase → **Authentication → Users → Add user**.
2. Enter his email and a password, and **tick "Auto Confirm User"**
   (otherwise he waits on a confirmation email).
3. Sign in with it.

**The first account created automatically becomes Admin.** Make sure that's his.

### 6. Set the business details

Edit `src/config/company.js` with the real firm name, address, phone and GSTIN.
Those appear on printed challans and salary sheets.

### 7. First data

In the app, in this order: **Sites** → **Team** → then site staff can start
logging attendance and DPRs.

---

## Adding the workers' logins

For each person, in Supabase → **Authentication → Users → Add user**
(email + password + Auto Confirm). Then in Gridwatch → **Admin Control** →
find their name → set a role.

The four roles ship as:

| Role | Can do |
|---|---|
| **Admin** | Everything, including permissions and freeze. Your uncle. |
| **Site Team** | Log attendance, DPR, requirements, photos, rework, material, challans. No payroll or team edits. |
| **Office / Store** | Material, indents, challans, transport, MTC, drawings, sites, team, advances. |
| **Viewer** | Read everything, change nothing. |

You can retune any of these per module in **Admin Control → Role permissions** —
those changes take effect immediately and are enforced by the database, not just
hidden in the interface.

If a worker doesn't have an email, make one up — `ravi.site@gridwatch.local`
works fine as a username since nothing is ever mailed to it.

**Forgotten password:** Supabase → Authentication → Users → click the user →
"Send password recovery" or just set a new password directly.

---

## Deploying — free, and gives you a link to send

Netlify is the easiest of the three. Pick one.

### Option A — Netlify (recommended)

1. Push this folder to a GitHub repo (private is fine).
2. **netlify.com** → sign up → **Add new site → Import an existing project** → pick the repo.
3. Build settings are read from `netlify.toml` — leave them alone.
4. Before the first deploy, open **Site settings → Environment variables** and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   (same two values as your `.env`)
5. Deploy. You get `something-random.netlify.app` — rename it under
   **Site settings → Change site name** to e.g. `gridwatch-fire`.

Every push to GitHub redeploys automatically.

**Free tier:** 100 GB bandwidth/month. You will not come close.

### Option B — Vercel

Same flow at **vercel.com** → New Project → import repo → add the same two
environment variables → deploy. `vercel.json` handles the routing.

### Option C — Cloudflare Pages

**dash.cloudflare.com** → Workers & Pages → Create → Pages → connect repo.
Build command `npm run build`, output directory `dist`, same two environment
variables. Add a redirect rule for SPA routing — `public/_redirects` is already
in place and Cloudflare reads it.

### Drag-and-drop, no GitHub

Run `npm run build`, then drag the `dist` folder onto **app.netlify.com/drop**.
Live in seconds. The catch: you must repeat it manually for every change, and
the two `VITE_` values get baked into the build — so make sure `.env` is filled
in before you build.

---

## Making it feel like an app on their phones

Send them the link, then:

- **Android / Chrome:** menu (⋮) → *Add to Home screen*
- **iPhone / Safari:** share button → *Add to Home Screen*

It then opens full-screen with its own icon, no browser bars. The camera and GPS
work exactly the same as a native app.

---

## What the free tiers actually give you

| | Free limit | What that means here |
|---|---|---|
| Supabase database | 500 MB | Text records are tiny — this is decades of entries |
| Supabase storage | 1 GB | Photos are shrunk to ~200 KB, so roughly **5,000 photos** |
| Supabase bandwidth | 5 GB/month | Comfortable for a handful of users |
| Netlify | 100 GB/month | Not a concern |

**The one thing to watch is photo storage.** At 4-5 photos a day across two
sites, 1 GB lasts around two years. When it fills up, either upgrade Supabase
(\$25/month) or clear out photos older than a year from
Supabase → Storage → `uploads`.

Supabase pauses free projects after **7 days with zero activity**. Daily use
means this never triggers; if it does, one click in the dashboard resumes it
with all data intact.

---

## Backups

Free tier has no automatic backups, so once a month:

- **Quick way:** every screen has an **Export** button that downloads a CSV.
- **Proper way:** Supabase → Database → **Backups** shows the current state, or
  run `pg_dump` with the connection string from Project Settings → Database.

Photos live in Storage and can be bulk-downloaded from the dashboard.

---

## Project layout

```
gridwatch/
├── supabase/schema.sql        ← the entire database, one file
├── src/
│   ├── config/
│   │   ├── modules.js         ← nav, permissions, colours — the module registry
│   │   ├── fields.js          ← form + table definitions for the simple modules
│   │   └── company.js         ← firm details on printed documents
│   ├── lib/                   ← supabase client, uploads, geo, CSV, formatting
│   ├── context/               ← auth + role state, shared sites/employees
│   ├── hooks/useRecords.js    ← load + live-subscribe + add/update/delete
│   ├── components/            ← UI primitives, layout, generic RecordManager
│   ├── modules/               ← one file per screen
│   └── pages/Login.jsx
```

### Adding a new module

1. Add the table to `supabase/schema.sql` (and to the RLS loop at the bottom).
2. Add an entry to `MODULES` in `src/config/modules.js`.
3. If it's a plain log: add field/column defs to `src/config/fields.js` and one
   `<Route>` in `App.jsx` using `RecordManager`. If it needs its own workflow,
   write a component in `src/modules/`.

### Changing a form

Nearly all field changes are edits to `src/config/fields.js` — add a field there
and it appears in the form, the table and the CSV export at once.

---

## Known limits, honestly

- **No offline mode.** A site with no signal can't submit. The photo and form
  data stay on screen so nothing is lost — retry when signal returns.
- **Records can't be edited after saving** (except status dropdowns on indents).
  Delete and re-enter. Editing is the obvious next feature.
- **New logins are created in the Supabase dashboard**, not in the app. That
  avoids needing a server. For a handful of people it's a two-minute job.
- **Deleting a site deletes its history** (attendance, DPRs, photos). Use the
  "Close" button instead, which just hides it from dropdowns.
