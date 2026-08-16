import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Loads a table, keeps it live over Realtime, and exposes add/update/remove
 * that write to Postgres and refresh local state.
 *
 * Errors surface as a string in `error` so screens can show something useful
 * instead of silently doing nothing — the most common cause is a role that
 * lacks edit permission, or a module the Admin has frozen.
 */
export function useRecords(table, { orderBy = 'created_at', ascending = false } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderBy, { ascending });
    if (error) setError(error.message);
    else {
      setRows(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [table, orderBy, ascending]);

  useEffect(() => {
    setLoading(true);
    load();
    const ch = supabase
      .channel(`rt-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [table, load]);

  const add = useCallback(
    async (record) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from(table)
        .insert({ ...record, created_by: auth?.user?.id ?? null })
        .select()
        .single();
      if (error) throw new Error(friendly(error));
      await load();
      return data;
    },
    [table, load]
  );

  const update = useCallback(
    async (id, patch) => {
      const { error } = await supabase.from(table).update(patch).eq('id', id);
      if (error) throw new Error(friendly(error));
      await load();
    },
    [table, load]
  );

  const remove = useCallback(
    async (id) => {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw new Error(friendly(error));
      await load();
    },
    [table, load]
  );

  return { rows, loading, error, add, update, remove, reload: load };
}

function friendly(error) {
  const msg = error.message || 'Something went wrong.';
  if (error.code === '42501' || /row-level security/i.test(msg)) {
    return "You don't have permission to save here — either your role is view-only, or an Admin has frozen this section.";
  }
  if (error.code === '23505') {
    return 'An entry for that date and site already exists. Open it and edit instead.';
  }
  return msg;
}
