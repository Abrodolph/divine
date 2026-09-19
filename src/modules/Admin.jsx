import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Lock, Unlock, ExternalLink, Check, Copy, KeyRound, UserPlus, Building2, Plus, Trash2, ArrowUp, ArrowDown,
} from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { PRORATION_LABEL, DEFAULT_RULES } from '../lib/payroll';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { useRecords } from '../hooks/useRecords';
import { MODULES, SCREENS, GROUPS, ADMIN } from '../config/modules';
import { AuditEntry } from '../components/AuditTrail';
import {
  SectionHeader, Card, Loading, Banner, Input, TextArea, Select, SiteSelect, Btn, IconBtn, EmptyState, Tabs, Field,
  Toggle, Modal, FormError, Chip, SubHeading,
} from '../components/ui';

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const dashboardUsersLink = PROJECT_URL
  ? `https://supabase.com/dashboard/project/${PROJECT_URL.split('//')[1]?.split('.')[0]}/auth/users`
  : 'https://supabase.com/dashboard';

const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('');
};

/** Calls the admin-users Edge Function (service key stays on the server). */
async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context?.json())?.error ?? msg; } catch { /* not JSON */ }
    if (/Failed to send|not found|FunctionsFetchError|FunctionsRelayError/i.test(msg)) {
      msg = 'The admin-users function is not deployed yet. Deploy it (see README), or add the login in the Supabase dashboard.';
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function Admin() {
  const [tab, setTab] = useState('people');
  return (
    <div>
      <SectionHeader title="Admin Control" subtitle="People, permissions, freeze, site areas, material categories, company and payroll settings, audit log" icon={ADMIN.icon} accent={ADMIN.accent} />
      <Tabs value={tab} onChange={setTab} accent={ADMIN.accent} tabs={[
        { value: 'people', label: 'People & logins' },
        { value: 'permissions', label: 'Role permissions' },
        { value: 'freeze', label: 'Freeze data' },
        { value: 'areas', label: 'Site areas' },
        { value: 'categories', label: 'Material categories' },
        { value: 'company', label: 'Company details' },
        { value: 'payroll', label: 'Payroll rules' },
        { value: 'audit', label: 'Audit log' },
      ]} />
      {tab === 'people' && <People />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'freeze' && <Freeze />}
      {tab === 'areas' && <SiteAreas />}
      {tab === 'categories' && <ItemCategories />}
      {tab === 'company' && <Company />}
      {tab === 'payroll' && <PayrollRules />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

/* --------------------------------- people -------------------------------- */

function People() {
  const { roles, profile: me } = useAuth();
  const { activeSites, siteName } = useAppData();
  const [profiles, setProfiles] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [adding, setAdding] = useState(false);
  const [scoping, setScoping] = useState(null);
  const [secret, setSecret] = useState(null);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('profile_sites').select('*'),
    ]);
    if (p.error) setError(p.error.message);
    setProfiles(p.data ?? []);
    setScopes(s.data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (m) => { setFlash(m); setTimeout(() => setFlash(null), 2500); };

  async function updateProfile(id, patch) {
    const { error: err } = await supabase.from('profiles').update(patch).eq('id', id);
    if (err) setError(err.message); else { await load(); say('Saved'); }
  }

  async function setActive(p, active) {
    setError(null);
    try {
      await adminUsers({ action: active ? 'enable' : 'disable', user_id: p.id });
    } catch (err) {
      // Without the function, still block their data access via the profile flag.
      if (!/not deployed/.test(err.message)) { setError(err.message); return; }
      await updateProfile(p.id, { active });
      setError(`${err.message} Their data access was ${active ? 'restored' : 'blocked'}, but their login itself was not ${active ? 'unbanned' : 'banned'}.`);
      return;
    }
    await load();
    say(active ? 'Login enabled' : 'Login disabled');
  }

  async function resetPassword(p) {
    if (!window.confirm(`Set a new password for ${p.name}?`)) return;
    setError(null);
    try {
      const password = genPassword();
      await adminUsers({ action: 'reset_password', user_id: p.id, password });
      setSecret({ name: p.name, password });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      {error && <Banner tone="red">{error}</Banner>}
      {flash && <Banner tone="green" icon={Check}>{flash}</Banner>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn accent={ADMIN.accent} icon={UserPlus} onClick={() => setAdding(true)}>Add person</Btn>
        <a href={dashboardUsersLink} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1" style={{ color: THEME.blue }}>
          Supabase users page <ExternalLink size={11} />
        </a>
      </div>

      {loading ? <Loading /> : profiles.length === 0 ? <Card><EmptyState label="No accounts yet." /></Card> : (
        <div className="space-y-2">
          {profiles.map((p) => {
            const mine = scopes.filter((s) => s.profile_id === p.id);
            return (
              <Card key={p.id} className="p-3" style={{ opacity: p.active === false ? 0.6 : 1 }}>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] uppercase tracking-wide block mb-1" style={{ color: THEME.textDim }}>
                        Name {p.id === me?.id && <span style={{ color: THEME.orange }}>(you)</span>}
                      </label>
                      <Input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && updateProfile(p.id, { name: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wide block mb-1" style={{ color: THEME.textDim }}>Role</label>
                      <Select value={p.role_id ?? ''} placeholder="Unassigned" disabled={p.id === me?.id} onChange={(e) => updateProfile(p.id, { role_id: e.target.value })}>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn variant="subtle" icon={Building2} onClick={() => setScoping(p)} title="Which sites this person can see">
                      {mine.length ? `${mine.length} site${mine.length > 1 ? 's' : ''}` : 'All sites'}
                    </Btn>
                    <Btn variant="ghost" icon={KeyRound} disabled={p.id === me?.id} onClick={() => resetPassword(p)}>Password</Btn>
                    <Btn variant={p.active === false ? 'primary' : 'ghost'} accent={THEME.green} disabled={p.id === me?.id} onClick={() => setActive(p, p.active === false)}>
                      {p.active === false ? 'Enable' : 'Disable'}
                    </Btn>
                  </div>
                </div>
                {mine.length > 0 && <div className="text-xs mt-2" style={{ color: THEME.textDim }}>Sees only: {mine.map((s) => siteName(s.site_id)).join(', ')}</div>}
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs mt-2" style={{ color: THEME.textDim }}>
        You can't change your own role or disable yourself — that stops you locking yourself out. Disabling someone blocks all their reads and writes immediately.
        A person restricted to sites sees only those sites everywhere in the app, enforced by the database.
      </p>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a person" accent={ADMIN.accent}>
        {adding && <AddPerson roles={roles} sites={activeSites} onDone={(res) => { setAdding(false); setSecret(res); load(); }} />}
      </Modal>
      <Modal open={!!scoping} onClose={() => setScoping(null)} title={`Sites for ${scoping?.name ?? ''}`} accent={ADMIN.accent}>
        {scoping && (
          <SiteScope profile={scoping} sites={activeSites} current={scopes.filter((s) => s.profile_id === scoping.id).map((s) => s.site_id)}
            onDone={() => { setScoping(null); load(); say('Site access updated'); }} />
        )}
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Share these login details once" accent={THEME.green}>
        {secret && (
          <div className="space-y-3 text-sm">
            <p>Send these to {secret.name} privately. The password isn't shown again — use "Password" to set a new one later.</p>
            <div className="p-3 rounded-lg font-mono space-y-1" style={{ background: THEME.panel2 }}>
              {secret.email && <div>Email: {secret.email}</div>}
              <div>Password: {secret.password}</div>
            </div>
            <Btn variant="subtle" icon={Copy} onClick={() => navigator.clipboard?.writeText(`${secret.email ? `Email: ${secret.email}\n` : ''}Password: ${secret.password}\n${window.location.origin}`)}>Copy</Btn>
          </div>
        )}
      </Modal>
    </section>
  );
}

function AddPerson({ roles, sites, onDone }) {
  const [form, setForm] = useState({ name: '', email: '', password: genPassword(), role_id: 'site', site_ids: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminUsers({ action: 'create', ...form, email: form.email.trim().toLowerCase() });
      onDone({ name: form.name, email: form.email.trim().toLowerCase(), password: form.password });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <Field label="Name" required><Input required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Email (login)" required hint="No email? Make one up, e.g. ravi.site@gridwatch.local — nothing is sent to it.">
        <Input required type="email" autoCapitalize="none" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="Password" required>
        <div className="flex gap-2">
          <Input required minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} />
          <Btn type="button" variant="subtle" onClick={() => set('password', genPassword())}>New</Btn>
        </div>
      </Field>
      <Field label="Role">
        <Select placeholder={null} value={form.role_id} onChange={(e) => set('role_id', e.target.value)} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
      </Field>
      <div>
        <div className="text-xs uppercase tracking-wide mb-1.5" style={{ color: THEME.textDim }}>Sites (none ticked = all sites)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {sites.map((s) => (
            <Toggle key={s.id} label={s.name} checked={form.site_ids.includes(s.id)}
              onChange={(v) => set('site_ids', v ? [...form.site_ids, s.id] : form.site_ids.filter((x) => x !== s.id))} />
          ))}
        </div>
      </div>
      <FormError error={error} />
      <div className="flex justify-end"><Btn type="submit" accent={ADMIN.accent} disabled={saving}>{saving ? 'Creating…' : 'Create login'}</Btn></div>
    </form>
  );
}

function SiteScope({ profile, sites, current, onDone }) {
  const [picked, setPicked] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    const remove = current.filter((id) => !picked.includes(id));
    const add = picked.filter((id) => !current.includes(id));
    const r1 = remove.length ? await supabase.from('profile_sites').delete().eq('profile_id', profile.id).in('site_id', remove) : { error: null };
    const r2 = add.length ? await supabase.from('profile_sites').insert(add.map((site_id) => ({ profile_id: profile.id, site_id }))) : { error: null };
    setSaving(false);
    if (r1.error || r2.error) setError((r1.error || r2.error).message);
    else onDone();
  }

  return (
    <div className="space-y-3 text-sm">
      <p style={{ color: THEME.textDim }}>Tick the sites {profile.name} works on. Leave everything unticked for office staff who need every site.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {sites.map((s) => (
          <Toggle key={s.id} label={s.name} checked={picked.includes(s.id)} onChange={(v) => setPicked((p) => (v ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
        ))}
      </div>
      <FormError error={error} />
      <div className="flex justify-between">
        <Btn variant="ghost" onClick={() => setPicked([])}>All sites</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
      </div>
    </div>
  );
}

/* ------------------------------ permissions ------------------------------ */

function Permissions() {
  const { roles, refresh } = useAuth();
  const [error, setError] = useState(null);

  async function setPermission(role, moduleKey, value) {
    const permissions = { ...(role.permissions ?? {}), [moduleKey]: value };
    const { error: err } = await supabase.from('roles').update({ permissions }).eq('id', role.id);
    if (err) setError(err.message); else refresh();
  }

  return (
    <section>
      {error && <Banner tone="red">{error}</Banner>}
      <div className="space-y-4">
        {roles.filter((r) => !r.is_admin).map((role) => (
          <Card key={role.id} className="p-4">
            <div className="font-semibold mb-3" style={{ fontFamily: 'Oswald' }}>{role.name}</div>
            {GROUPS.map((g) => (
              <div key={g} className="mb-3">
                <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: THEME.textDim }}>{g}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {MODULES.filter((m) => m.group === g).map((m) => {
                    const v = role.permissions?.[m.key] ?? 'none';
                    return (
                      <div key={m.key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: THEME.panel2 }}>
                        <span className="text-xs truncate" style={{ color: THEME.textDim }}>
                          {m.label}{m.permissionOnly && <span className="ml-1"><Chip>permission</Chip></span>}
                        </span>
                        <select value={v} onChange={(e) => setPermission(role, m.key, e.target.value)}
                          className="bg-transparent text-xs outline-none shrink-0"
                          style={{ color: v === 'edit' ? THEME.green : v === 'view' ? THEME.blue : THEME.textDim }}
                          aria-label={`${role.name} permission for ${m.label}`}>
                          <option value="none">None</option>
                          <option value="view">View</option>
                          <option value="edit">Edit</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
      <p className="text-xs mt-2" style={{ color: THEME.textDim }}>
        Admin always has full access. "Worker ID &amp; Aadhaar" controls who sees personal worker documents; "Approve Requests" controls who can approve site requests.
        These rules are enforced by the database itself, not just hidden in the app.
      </p>
    </section>
  );
}

function Freeze() {
  const { locks, refresh } = useAuth();
  const [error, setError] = useState(null);
  async function toggleLock(moduleKey) {
    const { error: err } = await supabase.from('module_locks').upsert({ module: moduleKey, locked: !locks[moduleKey] }, { onConflict: 'module' });
    if (err) setError(err.message); else refresh();
  }
  return (
    <section>
      {error && <Banner tone="red">{error}</Banner>}
      <p className="text-xs mb-3" style={{ color: THEME.textDim }}>
        Freezing blocks new entries, edits and deletes for everyone except Admin. For payroll months, prefer <b>Finalise month</b> in Payroll — it locks just that month.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {SCREENS.map((m) => {
          const on = !!locks[m.key];
          return (
            <button key={m.key} type="button" onClick={() => toggleLock(m.key)} className="flex items-center justify-between px-3 py-3 rounded-lg text-sm"
              style={{ background: on ? 'rgba(215,38,61,0.12)' : THEME.panel, border: `1px solid ${on ? THEME.red : THEME.border}`, color: on ? THEME.red : THEME.text }}>
              <span>{m.label}</span>
              {on ? <Lock size={15} /> : <Unlock size={15} style={{ color: THEME.textDim }} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------- ordered lists: areas & categories ------------------ */

/** Renumbers `sort` so the saved order matches the order on screen. */
async function renumber(list, update) {
  for (const [i, row] of list.entries()) {
    if (row.sort !== i * 10) await update(row.id, { sort: i * 10 });
  }
}

/**
 * Add / rename / reorder / deactivate / remove editor for a small lookup table
 * (`site_areas`, `item_categories`). Loads through useRecords so the list stays
 * live and write errors come back readable.
 */
function OrderedList({ table, noun, placeholder, emptyLabel, addDefaults = {}, filters = [], enabled = true, confirmRemove }) {
  const { rows, loading, error, add, update, remove } = useRecords(table, {
    orderBy: 'sort', ascending: true, filters, enabled,
  });
  const ordered = useMemo(
    () => [...rows].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name))),
    [rows]
  );
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  function addOne(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    run(async () => { await add({ ...addDefaults, name: clean, sort: ordered.length * 10 }); setName(''); });
  }

  function rename(row, value) {
    const clean = value.trim();
    if (!clean || clean === row.name) return;
    run(() => update(row.id, { name: clean }));
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    run(() => renumber(next, update));
  }

  function removeOne(row) {
    run(async () => {
      if (confirmRemove && !(await confirmRemove(row))) return;
      await remove(row.id);
    });
  }

  if (!enabled) return null;

  return (
    <Card className="p-4">
      {error && <Banner tone="red">{error}</Banner>}
      {err && <Banner tone="red">{err}</Banner>}
      <form onSubmit={addOne} className="flex flex-wrap items-end gap-2 mb-4">
        <div className="flex-1 min-w-[200px]">
          <Field label={`Add ${noun}`} required>
            <Input required value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Btn type="submit" accent={ADMIN.accent} icon={Plus} disabled={busy || !name.trim()}>Add</Btn>
      </form>

      {loading ? <Loading /> : ordered.length === 0 ? <EmptyState label={emptyLabel} /> : (
        <div className="space-y-2">
          {ordered.map((row, i) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: THEME.panel2, opacity: row.active === false ? 0.55 : 1 }}>
              <span className="text-xs w-5 shrink-0" style={{ color: THEME.textDim }}>{i + 1}</span>
              <div className="flex-1 min-w-[160px]">
                <Input key={row.name} defaultValue={row.name} aria-label={`${noun} name`} onBlur={(e) => rename(row, e.target.value)} />
              </div>
              <Toggle checked={row.active !== false} label="Active" onChange={(v) => run(() => update(row.id, { active: v }))} />
              <IconBtn icon={ArrowUp} title="Move up" disabled={i === 0} onClick={() => move(i, -1)} style={{ color: THEME.textDim, opacity: i === 0 ? 0.35 : 1 }} />
              <IconBtn icon={ArrowDown} title="Move down" disabled={i === ordered.length - 1} onClick={() => move(i, 1)}
                style={{ color: THEME.textDim, opacity: i === ordered.length - 1 ? 0.35 : 1 }} />
              <IconBtn icon={Trash2} title={`Remove ${noun}`} onClick={() => removeOne(row)} style={{ color: THEME.red }} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SiteAreas() {
  const { activeSites } = useAppData();
  const [siteId, setSiteId] = useState('');

  return (
    <section>
      <Card className="p-4 mb-4">
        <Field label="Site" required hint="The named locations inside this site — floors, blocks, shafts — offered by the Daily Progress Report's Location dropdown.">
          <SiteSelect required sites={activeSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="Pick a site…" />
        </Field>
      </Card>
      {!siteId ? (
        <Card><EmptyState label="Pick a site to see its areas." hint="Each site keeps its own list." /></Card>
      ) : (
        <OrderedList
          table="site_areas"
          noun="area"
          placeholder="e.g. 3rd floor, Block B, Shaft 2"
          emptyLabel="No areas yet for this site."
          addDefaults={{ site_id: siteId }}
          filters={[['site_id', 'eq', siteId]]}
          enabled={!!siteId}
        />
      )}
      <p className="text-xs mt-2" style={{ color: THEME.textDim }}>
        This list is a convenience, not a rule — a supervisor can still type a location that isn't on it. Turning an area off hides it from
        new reports without changing the reports that already used it.
      </p>
    </section>
  );
}

function ItemCategories() {
  const confirmRemove = useCallback(async (row) => {
    const { count } = await supabase.from('items').select('id', { count: 'exact', head: true }).eq('category', row.name);
    if (!count) return true;
    return window.confirm(
      `${count} item${count > 1 ? 's' : ''} still use the category "${row.name}". `
      + 'They keep the category name as typed text and stay exactly as they are — it just stops being offered on new items. Remove it?'
    );
  }, []);

  return (
    <section>
      <OrderedList
        table="item_categories"
        noun="category"
        placeholder="e.g. Fire alarm"
        emptyLabel="No categories yet."
        confirmRemove={confirmRemove}
      />
      <p className="text-xs mt-2" style={{ color: THEME.textDim }}>
        This is the pick-list behind the Category field on the Items screen. An item's category is stored as plain text, so removing a
        category here never orphans an item — existing items keep their category, it simply stops being offered for new ones.
      </p>
    </section>
  );
}

/* ---------------------------- company & rules ---------------------------- */

function Company() {
  const { orgSettings, reload } = useAppData();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (orgSettings) setForm(orgSettings); }, [orgSettings]);
  if (!form) return <Loading />;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    const { org_id: orgId, ...rest } = form;
    const { error: err } = await supabase.from('org_settings').update(rest).eq('org_id', orgId);
    if (err) setError(err.message); else { setSaved(true); setError(null); reload(); setTimeout(() => setSaved(false), 2000); }
  }

  return (
    <Card className="p-4">
      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <p className="sm:col-span-2 text-xs" style={{ color: THEME.textDim }}>Printed on challans, purchase orders, salary sheets and payslips.</p>
        <Field label="Company name" required><Input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Tagline"><Input value={form.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field label="Address" full><Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="GSTIN"><Input value={form.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Field>
        <Field label="Logo URL" hint="Optional — a link to a PNG/SVG."><Input value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} /></Field>

        <div className="sm:col-span-2">
          <SubHeading className="mb-2">DELIVERY CHALLAN WORDING</SubHeading>
          <p className="text-xs" style={{ color: THEME.textDim }}>
            The fixed text printed on every delivery challan. The address, phone, email and GSTIN above are the challan letterhead.
          </p>
        </div>
        <Field label="Terms &amp; conditions" full hint="One condition per line — printed as the terms block on the challan.">
          <TextArea rows={5} value={form.challan_terms ?? ''} onChange={(e) => set('challan_terms', e.target.value)} />
        </Field>
        <Field label="Jurisdiction" hint={`Prints as: All Disputes are Subject TO "${(form.challan_jurisdiction ?? '').trim() || 'GHAZIABAD'}" Jurisdiction only`}>
          <Input value={form.challan_jurisdiction ?? ''} onChange={(e) => set('challan_jurisdiction', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Footer line" hint="Optional — an extra line printed just above the signature.">
          <Input value={form.challan_footer ?? ''} onChange={(e) => set('challan_footer', e.target.value)} />
        </Field>
        <Field label="Tools &amp; tackles notice" full hint="Printed only on a tools-and-tackles transfer challan.">
          <TextArea rows={3} value={form.challan_tools_note ?? ''} onChange={(e) => set('challan_tools_note', e.target.value)} />
        </Field>

        <FormError error={error} />
        <div className="sm:col-span-2 flex items-center justify-end gap-3">
          {saved && <span className="text-xs" style={{ color: THEME.green }}>Saved</span>}
          <Btn type="submit">Save company details</Btn>
        </div>
      </form>
    </Card>
  );
}

function PayrollRules() {
  const { rulesRow, orgSettings, reload } = useAppData();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setForm({ ...DEFAULT_RULES, ...(rulesRow ?? {}) }); }, [rulesRow]);
  if (!form) return <Loading />;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    const row = {
      org_id: rulesRow?.org_id ?? orgSettings?.org_id,
      monthly_proration: form.monthly_proration,
      absent_threshold: Number(form.absent_threshold) || 0,
      default_working_days: Number(form.default_working_days) || 26,
      standard_hours: Number(form.standard_hours) || 9,
      ot_multiplier: Number(form.ot_multiplier) || 1,
      weekly_off_paid_daily: !!form.weekly_off_paid_daily,
      weekly_off_paid_monthly: !!form.weekly_off_paid_monthly,
      holiday_paid_daily: !!form.holiday_paid_daily,
      holiday_paid_monthly: !!form.holiday_paid_monthly,
      rounding: form.rounding,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase.from('payroll_rules').upsert(row, { onConflict: 'org_id' });
    if (err) setError(err.message); else { setSaved(true); setError(null); reload(); setTimeout(() => setSaved(false), 2000); }
  }

  return (
    <Card className="p-4">
      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <p className="sm:col-span-2 text-xs" style={{ color: THEME.textDim }}>
          How salaries are worked out, for everyone. Finalised months keep the rules they were calculated with.
        </p>
        <Field label="Monthly-wage workers are paid" full>
          <Select placeholder={null} value={form.monthly_proration} onChange={(e) => set('monthly_proration', e.target.value)}
            options={Object.entries(PRORATION_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        {form.monthly_proration === 'full_unless_absent' && (
          <Field label="Absences allowed before docking"><Input type="number" min="0" value={form.absent_threshold} onChange={(e) => set('absent_threshold', e.target.value)} /></Field>
        )}
        <Field label="Default working days per month" hint="Used when a site hasn't set its own in the Register.">
          <Input type="number" min="1" max="31" value={form.default_working_days} onChange={(e) => set('default_working_days', e.target.value)} />
        </Field>
        <Field label="Normal hours in a day" hint="Wage per day ÷ this = wage per hour, used for overtime.">
          <Input type="number" min="1" step="0.5" value={form.standard_hours} onChange={(e) => set('standard_hours', e.target.value)} />
        </Field>
        <Field label="Overtime pay multiplier" hint="1 = same as normal hours, 1.5 = time-and-a-half, 2 = double.">
          <Input type="number" min="0" step="0.25" value={form.ot_multiplier} onChange={(e) => set('ot_multiplier', e.target.value)} />
        </Field>
        <Field label="Round net salary">
          <Select placeholder={null} value={form.rounding} onChange={(e) => set('rounding', e.target.value)}
            options={[{ value: 'rupee', label: 'To the nearest rupee' }, { value: 'ten', label: 'To the nearest ₹10' }, { value: 'none', label: 'No rounding' }]} />
        </Field>
        <div className="sm:col-span-2">
          <SubHeading className="mb-2">PAID DAYS OFF</SubHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Toggle checked={form.weekly_off_paid_monthly} onChange={(v) => set('weekly_off_paid_monthly', v)} label="Weekly off is paid for monthly staff" />
            <Toggle checked={form.weekly_off_paid_daily} onChange={(v) => set('weekly_off_paid_daily', v)} label="Weekly off is paid for daily-wage workers" />
            <Toggle checked={form.holiday_paid_monthly} onChange={(v) => set('holiday_paid_monthly', v)} label="Holidays are paid for monthly staff" />
            <Toggle checked={form.holiday_paid_daily} onChange={(v) => set('holiday_paid_daily', v)} label="Holidays are paid for daily-wage workers" />
          </div>
        </div>
        <FormError error={error} />
        <div className="sm:col-span-2 flex items-center justify-end gap-3">
          {saved && <span className="text-xs" style={{ color: THEME.green }}>Saved</span>}
          <Btn type="submit">Save payroll rules</Btn>
        </div>
      </form>
    </Card>
  );
}

/* -------------------------------- audit log ------------------------------- */

const AUDITED = [
  'attendance_entries', 'musters', 'advances', 'salary_adjustments', 'payroll_runs', 'payroll_payments', 'working_days',
  'employees', 'employee_rates', 'sites', 'site_settings', 'profile_sites', 'profiles', 'roles', 'module_locks',
  'payroll_rules', 'org_settings', 'purchase_requests', 'purchase_request_items', 'quotes', 'purchase_orders',
  'goods_receipts', 'documents', 'vendors', 'items',
];

function AuditLog() {
  const [table, setTable] = useState('');
  const [who, setWho] = useState('');
  const [limit, setLimit] = useState(100);
  const [rows, setRows] = useState(null);
  const [names, setNames] = useState({});

  useEffect(() => {
    supabase.from('profiles').select('id,name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((p) => [p.id, p.name]))));
  }, []);

  useEffect(() => {
    let alive = true;
    let q = supabase.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(limit);
    if (table) q = q.eq('table_name', table);
    if (who) q = q.eq('changed_by', who);
    q.then(({ data }) => alive && setRows(data ?? []));
    return () => { alive = false; };
  }, [table, who, limit]);

  return (
    <section>
      <Card className="p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Table"><Select placeholder="All" value={table} onChange={(e) => setTable(e.target.value)} options={AUDITED} /></Field>
        <Field label="Changed by">
          <Select placeholder="Anyone" value={who} onChange={(e) => setWho(e.target.value)} options={Object.entries(names).map(([value, label]) => ({ value, label }))} />
        </Field>
      </Card>
      {!rows ? <Loading /> : rows.length === 0 ? <Card><EmptyState label="No changes recorded yet." /></Card> : (
        <Card className="px-4">
          {rows.map((r) => (
            <div key={r.id}>
              <div className="text-[11px] pt-2 font-mono" style={{ color: THEME.textDim }}>{r.table_name} · {r.row_id}</div>
              <AuditEntry entry={r} names={names} />
            </div>
          ))}
          {rows.length === limit && (
            <div className="py-3 text-center"><Btn variant="ghost" onClick={() => setLimit((l) => l + 100)}>Load more</Btn></div>
          )}
        </Card>
      )}
    </section>
  );
}
