// Supabase Edge Function: create / disable / enable logins and reset
// passwords from Admin Control, so nobody needs the Supabase dashboard.
//
// Deploy:  supabase functions deploy admin-users
// Local:   supabase functions serve admin-users
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// to Edge Functions automatically. The service key never leaves the server.
//
// Every call must come from a signed-in, active Admin of the same company.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Simple per-caller rate limit (per warm instance): 30 calls a minute.
const calls = new Map<string, number[]>();
function limited(id: string) {
  const now = Date.now();
  const recent = (calls.get(id) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  calls.set(id, recent);
  return recent.length > 30;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: 'Not signed in.' }, 401);
  if (limited(user.id)) return json({ error: 'Too many requests — wait a minute.' }, 429);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from('profiles').select('org_id, active, roles(is_admin)').eq('id', user.id).single();
  // deno-lint-ignore no-explicit-any
  if (!me?.active || !(me as any).roles?.is_admin) return json({ error: 'Only an Admin can manage logins.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const action = String(body.action ?? '');

  // Actions on an existing person must stay inside the caller's company.
  async function target(id: unknown) {
    if (typeof id !== 'string') return null;
    const { data } = await admin.from('profiles').select('id, org_id').eq('id', id).single();
    return data && data.org_id === me!.org_id ? data : null;
  }

  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const name = String(body.name ?? '').trim();
    const roleId = String(body.role_id ?? 'viewer');
    const siteIds = Array.isArray(body.site_ids) ? body.site_ids.map(String) : [];
    if (!email || !name) return json({ error: 'Name and email are required.' }, 400);
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

    const { data: role } = await admin.from('roles').select('id').eq('id', roleId).single();
    if (!role) return json({ error: 'Unknown role.' }, 400);

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (error || !created.user) {
      return json({ error: /already/i.test(error?.message ?? '') ? 'A login with that email already exists.' : error?.message ?? 'Could not create the login.' }, 400);
    }
    const id = created.user.id;
    // The signup trigger made a Viewer profile; set the real role and company.
    const { error: pErr } = await admin.from('profiles').update({ name, role_id: roleId, org_id: me.org_id, active: true }).eq('id', id);
    if (pErr) return json({ error: pErr.message }, 500);
    if (siteIds.length) {
      const { error: sErr } = await admin.from('profile_sites').insert(siteIds.map((site_id) => ({ profile_id: id, site_id, org_id: me.org_id })));
      if (sErr) return json({ error: sErr.message }, 500);
    }
    return json({ id });
  }

  if (action === 'disable' || action === 'enable') {
    const t = await target(body.user_id);
    if (!t) return json({ error: 'No such person in your company.' }, 404);
    if (t.id === user.id) return json({ error: "You can't disable yourself." }, 400);
    const { error } = await admin.auth.admin.updateUserById(t.id, { ban_duration: action === 'disable' ? '876000h' : 'none' });
    if (error) return json({ error: error.message }, 500);
    await admin.from('profiles').update({ active: action === 'enable' }).eq('id', t.id);
    return json({ ok: true });
  }

  if (action === 'reset_password') {
    const t = await target(body.user_id);
    if (!t) return json({ error: 'No such person in your company.' }, 404);
    const password = String(body.password ?? '');
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(t.id, { password });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: `Unknown action "${action}".` }, 400);
});
