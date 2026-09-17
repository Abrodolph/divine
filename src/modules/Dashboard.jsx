import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, FolderLock, Stamp, Truck } from 'lucide-react';
import { THEME } from '../lib/theme';
import { today, fmtDate, ago, thisMonth, inr } from '../lib/format';
import { addDays } from '../lib/dates';
import { supabase } from '../lib/supabase';
import { REQUEST_STATUS_LABEL } from '../lib/procurement';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { DASHBOARD, moduleByKey } from '../config/modules';
import { categoryLabel, SCOPE_LABEL } from '../config/documents';
import { SectionHeader, Card, Loading, EmptyState, StatusBadge, Banner, ExpiryBadge } from '../components/ui';

const OPEN_REQUESTS = ['submitted', 'approved', 'ordered', 'partially_received'];

/**
 * The screen your uncle opens first: did each site report in today, what's
 * waiting on him, what's outstanding. Every query is narrowed by the site
 * filter in the database (not after loading), so a filtered view is complete.
 */
export default function Dashboard() {
  const { activeSites, siteName, siteFilter, employees } = useAppData();
  const { canView, canEdit, profile } = useAuth();
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = today();
      const site = (q, col = 'site_id') => (siteFilter ? q.eq(col, siteFilter) : q);
      const count = (q) => q.then((r) => r.count ?? 0);
      const [entries, musters, flagged, dpr, reqs, toApprove, poOpen, rework, advances, docs] = await Promise.all([
        site(supabase.from('attendance_entries').select('site_id,units').eq('date', d)),
        site(supabase.from('musters').select('site_id,marked_at').eq('date', d)),
        canView('attendance_verify')
          ? count(site(supabase.from('attendance_entries').select('id', { count: 'exact', head: true })
            .neq('flags', '{}').is('verified_at', null).gte('date', addDays(d, -14))))
          : 0,
        site(supabase.from('dpr').select('id,site_id,date,work_done,created_at')).order('date', { ascending: false }).limit(5),
        site(supabase.from('purchase_requests').select('id,doc_no,status,priority,site_id,date,purchase_request_items(description,size,qty,unit)'))
          .in('status', OPEN_REQUESTS).order('date', { ascending: false }).limit(6),
        canEdit('procurement_approve')
          ? count(site(supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted')))
          : 0,
        canView('procurement') || canView('material_received')
          ? count(site(supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).in('status', ['sent', 'partially_received']), 'deliver_to_site_id'))
          : 0,
        site(supabase.from('rework').select('id,issue,status,site_id,date')).neq('status', 'Closed').order('date', { ascending: false }).limit(6),
        supabase.from('advances').select('amount').gte('date', `${thisMonth()}-01`),
        canView('documents') || canView('hr_documents')
          ? supabase.from('documents').select('id,scope,category,title,expires_on').not('expires_on', 'is', null)
            .lte('expires_on', addDays(d, 30)).order('expires_on').limit(8)
          : { data: [] },
      ]);
      if (cancelled) return;
      setState({
        entries: entries.data ?? [], musters: musters.data ?? [], flagged, dpr: dpr.data ?? [], requests: reqs.data ?? [],
        toApprove, poOpen, rework: rework.data ?? [], advances: advances.data ?? [], docs: docs.data ?? [],
      });
    })();
    return () => { cancelled = true; };
  }, [siteFilter, canView, canEdit]);

  if (!state) return <Loading label="Loading today's picture…" />;

  const sitesToCheck = siteFilter ? activeSites.filter((s) => s.id === siteFilter) : activeSites;
  const reported = new Set([...state.musters.map((m) => m.site_id), ...state.entries.map((e) => e.site_id)]);
  const missing = sitesToCheck.filter((s) => !reported.has(s.id));
  const headcount = state.entries.reduce((n, e) => n + (Number(e.units) || 0), 0);
  const advanceTotal = state.advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const perSite = sitesToCheck.map((s) => ({
    site: s,
    head: state.entries.filter((e) => e.site_id === s.id).reduce((n, e) => n + (Number(e.units) || 0), 0),
    at: state.musters.find((m) => m.site_id === s.id)?.marked_at,
  })).filter((x) => reported.has(x.site.id));

  const tiles = [
    { to: '/attendance', key: 'attendance', label: 'On site today', value: headcount },
    { to: '/attendance_verify', key: 'attendance_verify', label: 'Attendance to check', value: state.flagged, icon: BadgeCheck, alert: state.flagged > 0 },
    { to: '/procurement', key: 'procurement', perm: 'procurement_approve', label: 'Requests awaiting approval', value: state.toApprove, icon: Stamp, alert: state.toApprove > 0 },
    { to: '/material_received', key: 'material_received', label: 'Orders awaiting delivery', value: state.poOpen, icon: Truck },
    { to: '/requirements', key: 'requirements', label: 'Open requests', value: state.requests.length === 6 ? '6+' : state.requests.length },
    { to: '/rework', key: 'rework', label: 'Open rework', value: state.rework.length === 6 ? '6+' : state.rework.length },
    { to: '/team', key: 'team', label: 'Workers on roll', value: employees.filter((e) => e.active !== false).length },
    { to: '/advances', key: 'advances', label: 'Advances this month', value: inr(advanceTotal), small: true },
  ].filter((t) => (t.perm ? canEdit(t.perm) : canView(t.key)));

  return (
    <div>
      <SectionHeader
        title={`Good ${greeting()}, ${firstName(profile?.name)}`}
        subtitle={`Live picture across ${sitesToCheck.length} site${sitesToCheck.length === 1 ? '' : 's'} · ${fmtDate(today())}`}
        icon={DASHBOARD.icon}
        accent={DASHBOARD.accent}
      />

      {activeSites.length > 0 && canView('attendance') && (
        missing.length === 0 ? (
          <Banner tone="green">All sites have marked attendance today.</Banner>
        ) : (
          <Banner tone="amber" icon={AlertTriangle}>
            No attendance yet today from: <b>{missing.map((s) => s.name).join(', ')}</b>
          </Banner>
        )
      )}

      {activeSites.length === 0 && (
        <Banner tone="blue">
          Nothing set up yet. Start by adding your sites under <Link to="/sites" className="underline">Sites</Link>,
          then your workers under <Link to="/team" className="underline">Team</Link>.
        </Banner>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {tiles.map((t) => {
          const m = moduleByKey(t.key);
          const Icon = t.icon ?? m.icon;
          return (
            <Link key={t.label} to={t.to} className="p-4 rounded-xl block"
              style={{ background: THEME.panel, border: `1px solid ${t.alert ? THEME.amber : THEME.border}` }}>
              <Icon size={18} style={{ color: t.alert ? THEME.amber : m.accent }} />
              <div className={t.small ? 'text-xl mt-2' : 'text-3xl mt-2'} style={{ fontFamily: 'Oswald' }}>{t.value}</div>
              <div className="text-xs mt-1" style={{ color: THEME.textDim }}>{t.label}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {canView('attendance') && (
          <Panel title="Today's attendance" to="/attendance">
            {perSite.length === 0 ? <EmptyState label="Nothing marked yet today." /> : (
              <ul className="text-sm space-y-2">
                {perSite.map((x) => (
                  <li key={x.site.id} className="flex justify-between items-center gap-2 border-b pb-2" style={{ borderColor: THEME.border }}>
                    <span className="truncate">{x.site.name}</span>
                    <span className="shrink-0" style={{ color: THEME.textDim }}>
                      <b style={{ color: THEME.orange }}>{x.head}</b> present{x.at ? ` · ${ago(x.at)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {state.docs.length > 0 && (
          <Panel title="Documents expiring" to="/documents" icon={FolderLock}>
            <ul className="text-sm space-y-2">
              {state.docs.map((d) => (
                <li key={d.id} className="flex justify-between items-center gap-2 border-b pb-2" style={{ borderColor: THEME.border }}>
                  <span className="truncate">
                    {d.title || categoryLabel(d.scope, d.category)}
                    <span className="text-xs ml-1.5" style={{ color: THEME.textDim }}>{SCOPE_LABEL[d.scope]}</span>
                  </span>
                  <ExpiryBadge date={d.expires_on} />
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {canView('requirements') && (
          <Panel title="Open requests" to="/requirements">
            {state.requests.length === 0 ? <EmptyState label="Nothing outstanding." /> : (
              <ul className="text-sm space-y-2">
                {state.requests.map((r) => {
                  const first = r.purchase_request_items?.[0];
                  const more = (r.purchase_request_items?.length ?? 0) - 1;
                  return (
                    <li key={r.id} className="flex justify-between items-center gap-2 border-b pb-2" style={{ borderColor: THEME.border }}>
                      <span className="truncate">
                        {first ? `${first.description}${first.size ? ` ${first.size}` : ''}` : r.doc_no}
                        {more > 0 && <span style={{ color: THEME.textDim }}> +{more}</span>}
                        <span className="text-xs ml-1.5" style={{ color: THEME.textDim }}>{siteName(r.site_id)}</span>
                      </span>
                      <span className="shrink-0 text-xs" style={{ color: THEME.textDim }}>{REQUEST_STATUS_LABEL[r.status]}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}

        {canView('dpr') && (
          <Panel title="Latest progress reports" to="/dpr">
            {state.dpr.length === 0 ? <EmptyState label="No DPRs filed yet." /> : (
              <ul className="text-sm space-y-2">
                {state.dpr.map((d) => (
                  <li key={d.id} className="border-b pb-2" style={{ borderColor: THEME.border }}>
                    <div className="flex justify-between gap-2 text-xs" style={{ color: THEME.textDim }}>
                      <span className="truncate">{siteName(d.site_id)}</span>
                      <span className="shrink-0">{fmtDate(d.date)}</span>
                    </div>
                    <div className="line-clamp-2 mt-0.5">{d.work_done}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canView('rework') && (
          <Panel title="Open rework" to="/rework">
            {state.rework.length === 0 ? <EmptyState label="No rework outstanding." /> : (
              <ul className="text-sm space-y-2">
                {state.rework.map((r) => (
                  <li key={r.id} className="flex justify-between items-center gap-2 border-b pb-2" style={{ borderColor: THEME.border }}>
                    <span className="truncate">{r.issue}</span>
                    <StatusBadge value={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function Panel({ title, to, children }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>{title.toUpperCase()}</div>
        <Link to={to} className="text-xs" style={{ color: THEME.textDim }}>View all →</Link>
      </div>
      {children}
    </Card>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
};
const firstName = (n) => (n ?? '').split(' ')[0] || 'there';
