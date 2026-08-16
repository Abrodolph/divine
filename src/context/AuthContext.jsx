import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { canEdit as _canEdit, canView as _canView } from '../config/modules';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [roles, setRoles] = useState([]);
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
    const [p, r, l] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('roles').select('*').order('name'),
      supabase.from('module_locks').select('*'),
    ]);
    setProfile(p.data ?? null);
    setRoles(r.data ?? []);
    setLocks(Object.fromEntries((l.data ?? []).map((x) => [x.module, x.locked])));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    setLoading(true);
    loadContext(session.user.id);
  }, [session?.user?.id, loadContext]);

  /* --- keep roles + locks live (admin changes apply without a reload) ---- */
  useEffect(() => {
    if (!session?.user) return;
    const ch = supabase
      .channel('auth-ctx')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' },
        () => loadContext(session.user.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'module_locks' },
        () => loadContext(session.user.id))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        () => loadContext(session.user.id))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session?.user?.id, loadContext]);

  const role = useMemo(
    () => roles.find((r) => r.id === profile?.role_id) ?? null,
    [roles, profile]
  );

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
      signIn: (email, password) =>
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
      signOut: () => supabase.auth.signOut(),
      refresh: () => session?.user && loadContext(session.user.id),
    }),
    [session, profile, role, roles, locks, loading, loadContext]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
