import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { withDefaults } from '../lib/attendance';
import { withRules } from '../lib/payroll';
import { COMPANY } from '../config/company';
import { useAuth } from './AuthContext';

/**
 * Data nearly every screen needs, loaded once and kept live:
 *   sites, employees        (already narrowed to the user's site scope by RLS)
 *   site settings           siteSettings(siteId) → attendance rules with defaults
 *   company details         printed on challans, payslips, POs
 *   payroll rules
 * plus the global "which site am I looking at" filter.
 */
const AppDataContext = createContext(null);
export const useAppData = () => useContext(AppDataContext);

export function AppDataProvider({ children }) {
  const { session, profile } = useAuth();
  const [sites, setSites] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [settingsRows, setSettingsRows] = useState([]);
  const [org, setOrg] = useState(null);
  const [rulesRow, setRulesRow] = useState(null);
  const [areaRows, setAreaRows] = useState([]);
  const [categoryRows, setCategoryRows] = useState([]);
  const [siteFilter, setSiteFilter] = useState(() => {
    try { return localStorage.getItem('gw.siteFilter') || ''; } catch { return ''; }
  });

  const load = useCallback(async () => {
    const [s, e, ss, o, r, ar, ic] = await Promise.all([
      supabase.from('sites').select('*').order('name'),
      supabase.from('employees').select('*').order('name'),
      supabase.from('site_settings').select('*'),
      supabase.from('org_settings').select('*').maybeSingle(),
      supabase.from('payroll_rules').select('*').maybeSingle(),
      supabase.from('site_areas').select('*').order('sort').order('name'),
      supabase.from('item_categories').select('*').order('sort').order('name'),
    ]);
    setSites(s.data ?? []);
    setEmployees(e.data ?? []);
    setSettingsRows(ss.data ?? []);
    setOrg(o.data ?? null);
    setRulesRow(r.data ?? null);
    setAreaRows(ar.data ?? []);
    setCategoryRows(ic.data ?? []);
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    load();
    const ch = supabase
      .channel('app-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_settings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_rules' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_sites' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_areas' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_categories' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, profile?.id, load]);

  useEffect(() => {
    try { localStorage.setItem('gw.siteFilter', siteFilter); } catch { /* private mode */ }
  }, [siteFilter]);

  // A filter pointing at a site this user can no longer see is cleared.
  useEffect(() => {
    if (siteFilter && sites.length && !sites.some((s) => s.id === siteFilter)) setSiteFilter('');
  }, [sites, siteFilter]);

  const value = useMemo(() => {
    const siteName = (id) => sites.find((s) => s.id === id)?.name || '—';
    const empName = (id) => employees.find((e) => e.id === id)?.name || '—';
    const siteSettings = (id) => withDefaults(settingsRows.find((r) => r.site_id === id));
    const company = { ...COMPANY, ...Object.fromEntries(Object.entries(org ?? {}).filter(([, v]) => v)) };
    return {
      sites,
      employees,
      activeSites: sites.filter((s) => s.active !== false),
      activeEmployees: employees.filter((e) => e.active !== false),
      site: (id) => sites.find((s) => s.id === id) ?? null,
      siteSettings,
      settingsRows,
      // Named areas within a site (DPR location dropdown), Admin-maintained.
      siteAreas: (id) => areaRows.filter((a) => a.site_id === id && a.active !== false),
      areaRows,
      itemCategories: categoryRows.filter((c) => c.active !== false).map((c) => c.name),
      categoryRows,
      company,
      orgSettings: org,
      rules: withRules(rulesRow),
      rulesRow,
      siteFilter,
      setSiteFilter,
      siteName,
      empName,
      reload: load,
    };
  }, [sites, employees, settingsRows, org, rulesRow, areaRows, categoryRows, siteFilter, load]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
