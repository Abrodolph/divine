# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gridwatch — site and office coordination app for a fire fighting / electrical
contracting business. Workers on site log daily work from their phones; the
office sees it live. Stack: React + Vite + Tailwind (v4) on the frontend,
Supabase (Postgres + Auth + Storage + Realtime) as the entire backend, deployed
as a static SPA (Netlify/Vercel/Cloudflare Pages — no server of its own).

## Commands

```bash
npm install
npm run dev       # vite dev server, http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

There is no test suite and no linter configured. Requires a `.env` with
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`) to run
against a real Supabase project — without it, auth and all data calls fail.

## Architecture

**Everything is driven by two registries**, and most changes touch only these:

- `src/config/modules.js` — the single source of truth for navigation, icons,
  accent colors, and per-module permissions. A module's `key` here must match
  both its route path in `App.jsx` and the permission key stored in
  `roles.permissions` in the database.
- `src/config/fields.js` — form field + table column definitions for the
  "plain log" modules (DPR, Requirements, Material Received, Transport, MTC,
  Drawings, Rework). Editing a field here changes the form, the table, and the
  CSV export simultaneously.

**Two component paths per module:**
- *Config-driven modules* render through `RecordManager.jsx`, a single generic
  component that takes `fields`/`columns` from `fields.js` and handles the
  form, live list (mobile cards / desktop table), delete, and CSV export.
  These are wired up as inline `<Route>` elements directly in `App.jsx`.
- *Bespoke modules* (Attendance, Indents, Challans, Payroll, Sites, Team,
  Admin, Dashboard) have their own component in `src/modules/` because they
  need workflow beyond "log a record" (e.g. Indents/Challans auto-number
  `IND-0001-2026` / `DC-0001-2026`; Payroll computes and snapshots; Attendance
  captures a group photo + GPS muster).

**Data layer:**
- `src/lib/supabase.js` is the single Supabase client instance.
- `src/hooks/useRecords.js` is the generic per-table hook: loads a table,
  subscribes to Postgres Realtime changes on it, and exposes `add`/`update`/
  `remove` that write through and refresh. Almost every module uses this
  instead of hand-rolled fetch logic. Errors are translated into
  user-facing strings (permission denied → "your role is view-only or an
  Admin has frozen this section"; unique violation → "entry already exists").
- `src/context/AppDataContext.jsx` loads `sites` and `employees` once at the
  app root (live via Realtime) since nearly every screen needs them, plus the
  global "which site am I viewing" filter (persisted to `localStorage`).
- `src/context/AuthContext.jsx` owns the session, the user's `profile`,
  all `roles`, and `module_locks` (Admin can freeze a module, e.g. end of
  month payroll). It exposes `canView(key)`/`canEdit(key)`, kept live via
  Realtime so a permission or freeze change from Admin Control applies to
  already-open tabs without a reload.

**Authorization is enforced twice, deliberately:** `AuthContext`/`modules.js`
gate what the UI shows, but the real enforcement is Postgres Row Level
Security defined in `supabase/schema.sql` — the anon key is public by design
and RLS is what actually protects data. When adding a module or changing
permissions, both layers matter, but if they disagree, the database wins.

**Database:** `supabase/schema.sql` is the entire schema as one file (tables,
RLS policies, the photo storage bucket, Realtime publication) — there is no
migration tooling, it's applied by hand in the Supabase SQL editor. When
adding a table, also add it to the RLS loop at the bottom of that file.

## Adding a new module

1. Add the table to `supabase/schema.sql` (and to the RLS loop at the bottom).
2. Add an entry to `MODULES` in `src/config/modules.js`.
3. If it's a plain log: add field/column defs to `src/config/fields.js` and
   wire one `<Route>` in `App.jsx` using `RecordManager`. If it needs its own
   workflow, write a component in `src/modules/` instead.

## Known constraints (by design, not oversights)

- No offline mode — a site with no signal can't submit; nothing is lost, the
  form just stays on screen for retry.
- Records can't be edited after saving (only status dropdowns on indents) —
  delete and re-enter is the intended flow.
- New user logins are created directly in the Supabase dashboard, not in-app,
  to avoid needing a server component.
- Deleting a site deletes its history; the "Close" button (hide from
  dropdowns, keep data) is the correct action instead.
