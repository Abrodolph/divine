import { useEffect, useState } from 'react';
import { Lock, Unlock, ExternalLink, Check } from 'lucide-react';
import { THEME } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { MODULES, ADMIN } from '../config/modules';
import { SectionHeader, Card, Loading, Banner, Input, Select, Btn, EmptyState } from '../components/ui';

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const dashboardUsersLink = PROJECT_URL
  ? `https://supabase.com/dashboard/project/${PROJECT_URL.split('//')[1]?.split('.')[0]}/auth/users`
  : 'https://supabase.com/dashboard';

export default function Admin() {
  const { roles, locks, profile: me, refresh } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  const loadProfiles = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('name');
    if (error) setError(error.message);
    setProfiles(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadProfiles(); }, []);

  function flash(msg) {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2000);
  }

  async function updateProfile(id, patch) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) setError(error.message);
    else { await loadProfiles(); flash('Saved'); }
  }

  async function setPermission(role, moduleKey, value) {
    const permissions = { ...(role.permissions ?? {}), [moduleKey]: value };
    const { error } = await supabase.from('roles').update({ permissions }).eq('id', role.id);
    if (error) setError(error.message);
    else { await refresh(); flash('Permissions updated'); }
  }

  async function toggleLock(moduleKey) {
    const next = !locks[moduleKey];
    const { error } = await supabase
      .from('module_locks')
      .upsert({ module: moduleKey, locked: next }, { onConflict: 'module' });
    if (error) setError(error.message);
    else { await refresh(); flash(next ? 'Section frozen' : 'Section unfrozen'); }
  }

  return (
    <div>
      <SectionHeader
        title="Admin Control"
        subtitle="People, permissions and data freeze"
        icon={ADMIN.icon}
        accent={ADMIN.accent}
      />

      {error && <Banner tone="red">{error}</Banner>}
      {saved && <Banner tone="green" icon={Check}>{saved}</Banner>}

      {/* ------------------------------ people ------------------------------ */}
      <section className="mb-10">
        <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
          PEOPLE &amp; LOGINS
        </h3>

        <Banner tone="blue">
          To add a login: open the Supabase dashboard → Authentication → Users → <b>Add user</b>,
          set an email and password, tick "Auto Confirm User", then come back here and give them a role.{' '}
          <a href={dashboardUsersLink} target="_blank" rel="noreferrer"
            className="underline inline-flex items-center gap-1" style={{ color: THEME.blue }}>
            Open users page <ExternalLink size={11} />
          </a>
        </Banner>

        {loading ? (
          <Loading />
        ) : profiles.length === 0 ? (
          <Card><EmptyState label="No accounts yet." /></Card>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <Card key={p.id} className="p-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
                  <div>
                    <label className="text-[11px] uppercase tracking-wide block mb-1" style={{ color: THEME.textDim }}>
                      Name {p.id === me?.id && <span style={{ color: THEME.orange }}>(you)</span>}
                    </label>
                    <Input
                      defaultValue={p.name}
                      onBlur={(e) => e.target.value !== p.name && updateProfile(p.id, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wide block mb-1" style={{ color: THEME.textDim }}>
                      Role
                    </label>
                    <Select
                      value={p.role_id ?? ''}
                      placeholder="Unassigned"
                      disabled={p.id === me?.id}
                      onChange={(e) => updateProfile(p.id, { role_id: e.target.value })}
                    >
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Btn
                      variant={p.active === false ? 'primary' : 'ghost'}
                      accent={THEME.green}
                      disabled={p.id === me?.id}
                      onClick={() => updateProfile(p.id, { active: p.active === false })}
                    >
                      {p.active === false ? 'Enable' : 'Disable'}
                    </Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: THEME.textDim }}>
          You can't change your own role or disable yourself — that's the safety catch that stops
          you locking yourself out. Disabling someone blocks all their reads and writes immediately.
        </p>
      </section>

      {/* --------------------------- permissions --------------------------- */}
      <section className="mb-10">
        <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
          ROLE PERMISSIONS
        </h3>
        <div className="space-y-4">
          {roles.filter((r) => !r.is_admin).map((role) => (
            <Card key={role.id} className="p-4">
              <div className="font-semibold mb-3" style={{ fontFamily: 'Oswald' }}>{role.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {MODULES.map((m) => {
                  const v = role.permissions?.[m.key] ?? 'none';
                  return (
                    <div key={m.key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg"
                      style={{ background: THEME.panel2 }}>
                      <span className="text-xs truncate" style={{ color: THEME.textDim }}>{m.label}</span>
                      <select
                        value={v}
                        onChange={(e) => setPermission(role, m.key, e.target.value)}
                        className="bg-transparent text-xs outline-none shrink-0"
                        style={{ color: v === 'edit' ? THEME.green : v === 'view' ? THEME.blue : THEME.textDim }}
                        aria-label={`${role.name} permission for ${m.label}`}
                      >
                        <option value="none">None</option>
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: THEME.textDim }}>
          Admin always has full access and can't be restricted. These rules are enforced by the
          database itself, not just hidden in the app.
        </p>
      </section>

      {/* ------------------------------ freeze ------------------------------ */}
      <section>
        <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
          FREEZE DATA
        </h3>
        <p className="text-xs mb-3" style={{ color: THEME.textDim }}>
          Freezing blocks new entries, edits and deletes for everyone except Admin. Existing records
          stay visible. Use it to seal a month once salaries are paid and bills are raised.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {MODULES.map((m) => {
            const on = !!locks[m.key];
            return (
              <button
                key={m.key}
                onClick={() => toggleLock(m.key)}
                className="flex items-center justify-between px-3 py-3 rounded-lg text-sm"
                style={{
                  background: on ? 'rgba(215,38,61,0.12)' : THEME.panel,
                  border: `1px solid ${on ? THEME.red : THEME.border}`,
                  color: on ? THEME.red : THEME.text,
                }}
              >
                <span>{m.label}</span>
                {on ? <Lock size={15} /> : <Unlock size={15} style={{ color: THEME.textDim }} />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
