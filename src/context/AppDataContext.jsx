import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

/**
 * Sites and employees are needed by nearly every screen, so they are loaded
 * once here and kept live, rather than refetched per module.
 * Also holds the global "which site am I looking at" filter.
 */
const AppDataContext = createContext(null);
export const useAppData = () => useContext(AppDataContext);

export function AppDataProvider({ children }) {
  const { session } = useAuth();
  const [sites, setSites] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [siteFilter, setSiteFilter] = useState(
    () => localStorage.getItem('gw.siteFilter') || ''
  );

  const load = useCallback(async () => {
    const [s, e] = await Promise.all([
      supabase.from('sites').select('*').order('name'),
      supabase.from('employees').select('*').order('name'),
    ]);
    setSites(s.data ?? []);
    setEmployees(e.data ?? []);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const ch = supabase
      .channel('app-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session, load]);

  useEffect(() => {
    localStorage.setItem('gw.siteFilter', siteFilter);
  }, [siteFilter]);

  const value = useMemo(() => {
    const siteName = (id) => sites.find((s) => s.id === id)?.name || '—';
    const empName = (id) => employees.find((e) => e.id === id)?.name || '—';
    return {
      sites,
      employees,
      activeSites: sites.filter((s) => s.active !== false),
      activeEmployees: employees.filter((e) => e.active !== false),
      siteFilter,
      setSiteFilter,
      siteName,
      empName,
      reload: load,
    };
  }, [sites, employees, siteFilter, load]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
