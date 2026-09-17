/**
 * An in-process Postgres (PGlite) with just enough of Supabase stubbed in —
 * auth.uid(), the authenticated role, storage tables, the realtime
 * publication — to apply supabase/schema.sql and exercise its RLS policies
 * without a Supabase project or Docker.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const SCHEMA = readFileSync(here('../schema.sql'), 'utf8');
export const SCHEMA_BEFORE_V1 = readFileSync(here('./fixtures/schema.before-v1.sql'), 'utf8');

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create publication supabase_realtime;
`;

const GRANTS = `
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
grant all on all tables in schema storage to authenticated;
`;

export async function createDb({ schema = SCHEMA } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  if (schema) await applySchema(db, schema);
  return db;
}

export async function applySchema(db, schema = SCHEMA) {
  await db.exec(schema);
  await db.exec(GRANTS);
}

let n = 0;
/** Creates a login (profile via the signup trigger) and gives it a role. */
export async function createUser(db, { role, name, orgId } = {}) {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id, `u${n}@test.local`, { name: name ?? `User ${n}` },
  ]);
  if (role) await db.query('update public.profiles set role_id = $1 where id = $2', [role, id]);
  if (orgId) await db.query('update public.profiles set org_id = $1 where id = $2', [orgId, id]);
  return id;
}

/** Runs one statement as a signed-in user, with RLS in force. */
export async function as(db, userId, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export const one = async (p) => (await p).rows[0];
export const rows = async (p) => (await p).rows;
