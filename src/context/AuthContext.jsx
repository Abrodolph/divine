import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { setUploadOrg } from '../lib/upload';
import { canEdit as _canEdit, canView as _canView } from '../config/modules';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [roles, setRoles] = useState([]);
  const [people, setPeople] = useState([]);
  const [locks, setLocks] = useState({});
  const [loading, setLoading] = useState(true);

  /* --- session ---------------------------------------------------------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* --- profile + roles + locks ------------------------------------------ */
  const loadContext = useCallback(async (userId) => {
    const [p, r, l, all] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('roles').select('*').order('name'),
      supabase.from('module_locks').select('*'),
      supabase.from('profiles').select('id,role_id'),
    ]);
    setProfile(p.data ?? null);
    setUploadOrg(p.data?.org_id);
    setRoles(r.data ?? []);
    setPeople(all.data ?? []);
    setLocks(Object.fromEntries((l.data ?? []).map((x) => [x.module, x.locked])));
    setLoading(false);
  }, []);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    loadContext(userId);
  }, [userId, loadContext]);

  /* --- keep roles + locks live (admin changes apply without a reload) ---- */
  useEffect(() => {
    if (!userId) return undefined;
    const ch = supabase
      .channel('auth-ctx')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, () => loadContext(userId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'module_locks' }, () => loadContext(userId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () => loadContext(userId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, loadContext]);

  const role = useMemo(
    () => roles.find((r) => r.id === profile?.role_id) ?? null,
    [roles, profile]
  );

  const adminIds = useMemo(() => {
    const adminRoles = new Set(roles.filter((r) => r.is_admin).map((r) => r.id));
    return new Set(people.filter((p) => adminRoles.has(p.role_id)).map((p) => p.id));
  }, [roles, people]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role,
      roles,
      locks,
      loading,
      isAdmin: !!role?.is_admin,
      canView: (key) => _canView(role, key),
      canEdit: (key) => _canEdit(role, key, locks),
      // Mirrors guard_admin_rows() in schema.sql: Admin's entries are Admin-only,
      // except for holders of the listed permissions.
      canChangeRow: (row, exceptFor = []) => !!role?.is_admin || !row?.created_by || !adminIds.has(row.created_by)
        || exceptFor.some((k) => _canEdit(role, k, locks)),
      signIn: (email, password) =>
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
      signOut: () => supabase.auth.signOut(),
      refresh: () => session?.user && loadContext(session.user.id),
    }),
    [session, profile, role, roles, locks, loading, loadContext, adminIds]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
