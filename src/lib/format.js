export const today = () => new Date().toISOString().slice(0, 10);
export const nowTime = () => new Date().toTimeString().slice(0, 5);
export const thisMonth = () => new Date().toISOString().slice(0, 7);

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function monthLabel(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

/** Human "2 hours ago" style stamp for the activity feed. */
export function ago(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}
