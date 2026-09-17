/**
 * Supabase returns at most 1000 rows per request. For a month of per-worker
 * attendance that isn't enough, so page through until a short page comes back.
 *   const rows = await fetchAll(() => supabase.from('x').select('*').eq(...));
 */
export async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}
