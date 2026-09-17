import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import { THEME } from '../lib/theme';
import { useAuth } from '../context/AuthContext';
import { Chip, EmptyState, IconBtn, Loading, Modal } from './ui';

// Bookkeeping columns that change on every save and would drown the real diff.
const NOISE = new Set(['updated_at', 'marked_at', 'created_at', 'created_by', 'org_id', 'id', 'generated_at']);

export function diffRows(oldRow, newRow) {
  const keys = new Set([...Object.keys(oldRow ?? {}), ...Object.keys(newRow ?? {})]);
  return [...keys]
    .filter((k) => !NOISE.has(k) && JSON.stringify(oldRow?.[k] ?? null) !== JSON.stringify(newRow?.[k] ?? null))
    .map((k) => ({ field: k, from: oldRow?.[k] ?? null, to: newRow?.[k] ?? null }));
}

const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

let profileCache = null;
async function profileNames() {
  if (!profileCache) {
    const { data } = await supabase.from('profiles').select('id,name');
    profileCache = Object.fromEntries((data ?? []).map((p) => [p.id, p.name]));
  }
  return profileCache;
}

/** One audit entry: who, when, and what changed field by field. */
export function AuditEntry({ entry, names }) {
  const changes = entry.action === 'update' ? diffRows(entry.old_row, entry.new_row) : [];
  const tone = entry.action === 'delete' ? 'red' : entry.action === 'insert' ? 'green' : 'blue';
  return (
    <div className="py-2.5 border-b text-xs" style={{ borderColor: THEME.border }}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={tone}>{entry.action}</Chip>
        <span className="font-medium">{names?.[entry.changed_by] ?? 'Unknown user'}</span>
        <span style={{ color: THEME.textDim }}>{fmtDateTime(entry.changed_at)}</span>
      </div>
      {changes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {changes.map((c) => (
            <li key={c.field} className="break-words">
              <span style={{ color: THEME.textDim }}>{c.field}:</span>{' '}
              <span style={{ color: THEME.red, textDecoration: 'line-through' }}>{show(c.from)}</span>{' → '}
              <span style={{ color: THEME.green }}>{show(c.to)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AuditTrail({ table, rowId }) {
  const [entries, setEntries] = useState(null);
  const [names, setNames] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data }, n] = await Promise.all([
        supabase.from('audit_log').select('*').eq('table_name', table).eq('row_id', String(rowId))
          .order('changed_at', { ascending: false }).limit(50),
        profileNames(),
      ]);
      if (alive) { setEntries(data ?? []); setNames(n); }
    })();
    return () => { alive = false; };
  }, [table, rowId]);

  if (!entries) return <Loading />;
  if (!entries.length) return <EmptyState label="No recorded changes yet." hint="Changes are recorded from the v1 upgrade onwards." />;
  return <div>{entries.map((e) => <AuditEntry key={e.id} entry={e} names={names} />)}</div>;
}

/** History icon that opens the record's change log. Admin only. */
export function AuditButton({ table, rowId, label = 'Change history' }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isAdmin || !rowId) return null;
  return (
    <>
      <IconBtn icon={History} title={label} onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title={label} accent={THEME.blue}>
        {open && <AuditTrail table={table} rowId={rowId} />}
      </Modal>
    </>
  );
}
