import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, Filter, Flame, Zap } from 'lucide-react';
import { THEME } from '../lib/theme';
import { HazardBar, Loading } from './ui';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { SCREENS, GROUPS, DASHBOARD, ADMIN } from '../config/modules';
import { PLAYGROUND } from '../lib/supabase';


export default function Layout() {
  const { profile, role, canView, isAdmin, signOut } = useAuth();
  const { sites, siteFilter, setSiteFilter } = useAppData();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  const allowed = SCREENS.filter((m) => canView(m.key));
  const quick = [DASHBOARD, ...allowed].slice(0, 5);

  return (
    <div style={{ background: THEME.bg, minHeight: '100vh', color: THEME.text }}>
      {PLAYGROUND && (
        <div className="no-print text-center text-xs font-semibold tracking-wide py-1.5"
          style={{ background: THEME.amber, color: '#111' }}>
          PLAYGROUND — separate test database. Nothing here touches the live Divine Engineering app.
        </div>
      )}
      {/* ---------------------------- header ---------------------------- */}
      <header
        className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 px-3 md:px-6 py-3"
        style={{ background: THEME.bg, borderBottom: `1px solid ${THEME.border}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="md:hidden p-1"
            onClick={() => setNavOpen((o) => !o)}
            aria-label="Menu"
            style={{ color: THEME.text }}
          >
            {navOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <Flame size={20} style={{ color: THEME.orange }} />
            <Zap size={17} style={{ color: THEME.amber, marginLeft: -5 }} />
          </div>
          <div className="min-w-0">
            <div className="text-base leading-none" style={{ fontFamily: 'Oswald', letterSpacing: '0.04em' }}>
              GRIDWATCH
            </div>
            <div className="text-[10px] tracking-widest truncate" style={{ color: THEME.textDim }}>
              SITE &amp; OFFICE COORDINATION
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sites.length > 0 && (
            <div
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
              style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
            >
              <Filter size={13} style={{ color: THEME.textDim }} />
              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="bg-transparent text-xs outline-none"
                style={{ color: siteFilter ? THEME.orange : THEME.textDim, maxWidth: 120 }}
                aria-label="Filter by site"
              >
                <option value="">All Sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
            style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
          >
            <span className="text-xs font-medium hidden sm:inline">{profile?.name}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: isAdmin ? 'rgba(215,38,61,0.15)' : 'rgba(74,144,217,0.15)',
                color: isAdmin ? THEME.red : THEME.blue,
              }}
            >
              {role?.name ?? '—'}
            </span>
            <button onClick={signOut} title="Sign out" aria-label="Sign out" style={{ color: THEME.textDim }}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>
      <div className="no-print"><HazardBar /></div>

      <div className="flex">
        {/* --------------------------- sidebar --------------------------- */}
        <aside
          className={`no-print fixed md:sticky top-0 md:top-[61px] left-0 z-40 md:z-10 h-screen md:h-[calc(100vh-61px)] w-64 shrink-0
            transform transition-transform duration-200 overflow-y-auto
            ${navOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
          style={{ background: THEME.panel, borderRight: `1px solid ${THEME.border}` }}
        >
          <nav className="p-3 space-y-1 pb-24">
            <div className="md:hidden flex justify-end mb-1">
              <button onClick={() => setNavOpen(false)} aria-label="Close menu" style={{ color: THEME.textDim }}>
                <X size={22} />
              </button>
            </div>

            <NavItem item={DASHBOARD} to="/" onClick={() => setNavOpen(false)} />

            {GROUPS.map((g) => {
              const items = allowed.filter((m) => m.group === g);
              if (!items.length) return null;
              return (
                <div key={g} className="pt-3">
                  <div className="px-3 pb-1.5 text-[10px] tracking-widest uppercase" style={{ color: THEME.textDim, opacity: 0.7 }}>
                    {g}
                  </div>
                  {items.map((m) => (
                    <NavItem key={m.key} item={m} to={`/${m.key}`} onClick={() => setNavOpen(false)} />
                  ))}
                </div>
              );
            })}

            {isAdmin && (
              <div className="pt-3">
                <div className="px-3 pb-1.5 text-[10px] tracking-widest uppercase" style={{ color: THEME.textDim, opacity: 0.7 }}>
                  Admin
                </div>
                <NavItem item={ADMIN} to="/admin" onClick={() => setNavOpen(false)} />
              </div>
            )}
          </nav>
        </aside>

        {navOpen && (
          <div
            className="no-print fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* ----------------------------- main ----------------------------- */}
        <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-8 max-w-5xl mx-auto w-full">
          <Suspense fallback={<Loading />}>
            <Outlet key={location.pathname} />
          </Suspense>
        </main>
      </div>

      {/* --------------------- phone bottom quick bar --------------------- */}
      <nav
        className="no-print md:hidden fixed bottom-0 inset-x-0 z-20 flex"
        style={{
          background: THEME.panel,
          borderTop: `1px solid ${THEME.border}`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {quick.map((m) => (
          <NavLink
            key={m.key}
            to={m.key === 'dashboard' ? '/' : `/${m.key}`}
            end={m.key === 'dashboard'}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
            style={({ isActive }) => ({ color: isActive ? THEME.orange : THEME.textDim })}
          >
            <m.icon size={19} />
            <span className="text-[10px] leading-none">{m.short ?? m.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function NavItem({ item, to, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm"
      style={({ isActive }) => ({
        background: isActive ? THEME.panel2 : 'transparent',
        color: isActive ? THEME.orange : THEME.textDim,
        borderLeft: `3px solid ${isActive ? THEME.orange : 'transparent'}`,
      })}
    >
      <item.icon size={17} className="shrink-0" />
      {item.label}
    </NavLink>
  );
}
