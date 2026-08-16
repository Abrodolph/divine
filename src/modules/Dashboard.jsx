import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, Camera } from 'lucide-react';
import { THEME } from '../lib/theme';
import { today, fmtDate, ago, thisMonth, inr } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { DASHBOARD, MODULES, moduleByKey } from '../config/modules';
import { SectionHeader, Card, Loading, EmptyState, StatusBadge, Banner } from '../components/ui';

/**
 * The screen your uncle opens first: did each site report in today, what's
 * outstanding, and what came in most recently.
 */
export default function Dashboard() {
  const { activeSites, siteName, siteFilter, employees } = useAppData();
  const { canView, profile } = useAuth();
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = today();
      const monthStart = `${thisMonth()}-01`;
      const [att, dpr, reqs, indents, rework, photos, advances] = await Promise.all([
        supabase.from('attendance').select('site_id,present_ids,date,created_at').eq('date', d),
        supabase.from('dpr').select('id,site_id,date,work_done,created_at').order('date', { ascending: false }).limit(5),
        supabase.from('requirements').select('id,item,status,priority,site_id,date').neq('status', 'Fulfilled').order('date', { ascending: false }).limit(6),
        supabase.from('indents').select('id,doc_no,status,site_id,date').eq('status', 'Pending'),
        supabase.from('rework').select('id,issue,status,site_id,date').neq('status', 'Closed').order('date', { ascending: false }).limit(6),
        supabase.from('site_photos').select('id,site_id,date,photos,created_at').order('created_at', { ascending: false }).limit(6),
        supabase.from('advances').select('amount,date').gte('date', monthStart),
      ]);
      if (cancelled) return;
      setState({
        attendance: att.data ?? [],
        dpr: dpr.data ?? [],
        requirements: reqs.data ?? [],
        indents: indents.data ?? [],
        rework: rework.data ?? [],
        photos: photos.data ?? [],
        advances: advances.data ?? [],
      });
    })();
    return () => { cancelled = true; };
  }, []);

  if (!state) return <Loading label="Loading today's picture…" />;

  const filt = (arr) => (siteFilter ? arr.filter((r) => r.site_id === siteFilter) : arr);
  const sitesToCheck = siteFilter ? activeSites.filter((s) => s.id === siteFilter) : activeSites;

  const reportedToday = new Set(state.attendance.map((a) => a.site_id));
  const missing = sitesToCheck.filter((s) => !reportedToday.has(s.id));
  const headcount = filt(state.attendance).reduce((n, a) => n + (a.present_ids?.length ?? 0), 0);
  const advanceTotal = state.advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);

  const tiles = [
    { key: 'attendance', label: 'On site today', value: headcount },
    { key: 'requirements', label: 'Open requirements', value: filt(state.requirements).length },
    { key: 'indents', label: 'Pending indents', value: filt(state.indents).length },
    { key: 'rework', label: 'Open rework', value: filt(state.rework).length },
    { key: 'team', label: 'Workers on roll', value: employees.filter((e) => e.active !== false).length },
    { key: 'advances', label: 'Advances this month', value: inr(advanceTotal), small: true },
  ].filter((t) => canView(t.key));

  return (
    <div>
      <SectionHeader
        title={`Good ${greeting()}, ${firstName(profile?.name)}`}
        subtitle={`Live picture across ${sitesToCheck.length} site${sitesToCheck.length === 1 ? '' : 's'} · ${fmtDate(today())}`}
        icon={DASHBOARD.icon}
        accent={DASHBOARD.accent}
      />

      {/* The single most useful thing on this screen. */}
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

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {tiles.map((t) => {
          const m = moduleByKey(t.key);
          return (
            <Link
              key={t.key}
              to={`/${t.key}`}
              className="p-4 rounded-xl block"
              style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
            >
              <m.icon size={18} style={{ color: m.accent }} />
              <div className={t.small ? 'text-xl mt-2' : 'text-3xl mt-2'} style={{ fontFamily: 'Oswald' }}>
                {t.value}
              </div>
              <div className="text-xs mt-1" style={{ color: THEME.textDim }}>{t.label}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {canView('attendance') && (
          <Panel title="Today's musters" to="/attendance">
            {filt(state.attendance).length === 0 ? (
              <EmptyState label="Nothing marked yet today." />
            ) : (
              <ul className="text-sm space-y-2">
                {filt(state.attendance).map((a) => (
                  <li key={a.site_id} className="flex justify-between items-center gap-2 border-b pb-2"
                    style={{ borderColor: THEME.border }}>
                    <span className="truncate">{siteName(a.site_id)}</span>
                    <span className="shrink-0" style={{ color: THEME.textDim }}>
                      <b style={{ color: THEME.orange }}>{a.present_ids?.length ?? 0}</b> present · {ago(a.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canView('dpr') && (
          <Panel title="Latest progress reports" to="/dpr">
            {filt(state.dpr).length === 0 ? (
              <EmptyState label="No DPRs filed yet." />
            ) : (
              <ul className="text-sm space-y-2">
                {filt(state.dpr).map((d) => (
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

        {canView('requirements') && (
          <Panel title="Open requirements" to="/requirements">
            {filt(state.requirements).length === 0 ? (
              <EmptyState label="Nothing outstanding." />
            ) : (
              <ul className="text-sm space-y-2">
                {filt(state.requirements).map((r) => (
                  <li key={r.id} className="flex justify-between items-center gap-2 border-b pb-2"
                    style={{ borderColor: THEME.border }}>
                    <span className="truncate">
                      {r.item}
                      <span className="text-xs ml-1.5" style={{ color: THEME.textDim }}>{siteName(r.site_id)}</span>
                    </span>
                    <StatusBadge value={r.priority} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canView('rework') && (
          <Panel title="Open rework" to="/rework">
            {filt(state.rework).length === 0 ? (
              <EmptyState label="No rework outstanding." />
            ) : (
              <ul className="text-sm space-y-2">
                {filt(state.rework).map((r) => (
                  <li key={r.id} className="flex justify-between items-center gap-2 border-b pb-2"
                    style={{ borderColor: THEME.border }}>
                    <span className="truncate">{r.issue}</span>
                    <StatusBadge value={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canView('site_photos') && filt(state.photos).length > 0 && (
          <Panel title="Latest site photos" to="/site_photos">
            <div className="grid grid-cols-4 gap-1.5">
              {filt(state.photos).flatMap((p) => (p.photos ?? []).slice(0, 1)).slice(0, 8).map((url) => (
                <img key={url} src={url} alt="" className="rounded object-cover w-full" style={{ height: 62 }} />
              ))}
            </div>
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
        <div className="text-sm font-semibold" style={{ fontFamily: 'Oswald', letterSpacing: '0.02em' }}>
          {title.toUpperCase()}
        </div>
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
