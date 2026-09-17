import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

let channelSeq = 0;

/**
 * Loads a table, keeps it live over Realtime, and exposes add/update/remove
 * that write to Postgres and refresh local state.
 *
 * options
 *   orderBy, ascending   sort (default created_at desc)
 *   select               columns (default *)
 *   filters              [[column, op, value]] with op = eq | neq | gte | lte | in | isnull | notnull;
 *                        a filter whose value is '' / null / undefined is skipped
 *   pageSize             rows per page (default 200); loadMore() fetches the next page
 *   enabled              false = don't load (e.g. until a site is picked)
 *
 * created_by is never sent: the database stamps it from the signed-in user.
 * Errors surface as a string in `error`, translated into something a
 * supervisor can act on.
 */
export function useRecords(table, {
  orderBy = 'created_at', ascending = false, select = '*', filters = [], pageSize = 200, enabled = true,
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(pageSize);
  const [hasMore, setHasMore] = useState(false);
  const filterKey = JSON.stringify(filters);
  const channelId = useRef(null);
  if (channelId.current === null) channelId.current = ++channelSeq;

  const load = useCallback(async () => {
    if (!enabled) { setRows([]); setLoading(false); return; }
    let q = supabase.from(table).select(select).order(orderBy, { ascending });
    JSON.parse(filterKey).forEach(([col, op, val]) => {
      if (op === 'isnull') { q = q.is(col, null); return; }
      if (op === 'notnull') { q = q.not(col, 'is', null); return; }
      if (val === '' || val === null || val === undefined) return;
      q = q[op](col, val);
    });
    const { data, error: err } = await q.range(0, limit);
    if (err) setError(friendly(err));
    else {
      setHasMore((data ?? []).length > limit);
      setRows((data ?? []).slice(0, limit));
      setError(null);
    }
    setLoading(false);
  }, [table, select, orderBy, ascending, filterKey, limit, enabled]);

  useEffect(() => {
    setLoading(true);
    load();
    if (!enabled) return undefined;
    const ch = supabase
      .channel(`rt-${table}-${channelId.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table, load, enabled]);

  const add = useCallback(
    async (record) => {
      const { data, error: err } = await supabase.from(table).insert(record).select().single();
      if (err) throw new Error(friendly(err));
      await load();
      return data;
    },
    [table, load]
  );

  const update = useCallback(
    async (id, patch, idColumn = 'id') => {
      const { data, error: err } = await supabase.from(table).update(patch).eq(idColumn, id).select();
      if (err) throw new Error(friendly(err));
      if (!data?.length) throw new Error(NOT_SAVED);
      await load();
      return data[0];
    },
    [table, load]
  );

  const remove = useCallback(
    async (id, idColumn = 'id') => {
      const { data, error: err } = await supabase.from(table).delete().eq(idColumn, id).select();
      if (err) throw new Error(friendly(err));
      if (!data?.length) throw new Error(NOT_SAVED);
      await load();
    },
    [table, load]
  );

  const loadMore = useCallback(() => setLimit((l) => l + pageSize), [pageSize]);

  return { rows, loading, error, add, update, remove, reload: load, hasMore, loadMore };
}

// RLS silently filters an UPDATE/DELETE it doesn't allow — zero rows, no error.
const NOT_SAVED = "That change wasn't saved — the record is locked (edit window passed, month finalised, or section frozen) or your role can't change it.";

export function friendly(error) {
  const msg = error?.message || 'Something went wrong.';
  if (error?.code === '42501' || /row-level security/i.test(msg)) {
    return "You don't have permission to save here — either your role is view-only, or an Admin has frozen this section.";
  }
  if (error?.code === '23505') {
    return 'An entry like that already exists. Open it and edit instead.';
  }
  if (error?.code === '23503') {
    return 'This is still used elsewhere (or refers to something that was deleted), so it can’t be saved or removed.';
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'No connection. Nothing was lost — check signal and tap Save again.';
  }
  return msg;
}
