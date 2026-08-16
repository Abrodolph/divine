import { useState } from 'react';
import { Flame, Zap, KeyRound, Loader2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await signIn(email, password);
    if (error) {
      setError(
        /invalid login/i.test(error.message)
          ? 'Wrong email or password. Check and try again.'
          : error.message
      );
      setBusy(false);
    }
    // On success the auth listener swaps this screen out.
  }

  const input = 'w-full bg-transparent border rounded-lg px-3 py-3 text-sm outline-none';
  const style = { borderColor: THEME.border, color: THEME.text };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: THEME.bg }}>
      <div
        className="w-full max-w-sm p-6 rounded-2xl"
        style={{ background: THEME.panel, border: `1px solid ${THEME.border}` }}
      >
        <div className="flex items-center justify-center gap-1 mb-3">
          <Flame size={24} style={{ color: THEME.orange }} />
          <Zap size={20} style={{ color: THEME.amber, marginLeft: -5 }} />
        </div>
        <div
          className="text-center text-2xl mb-1"
          style={{ fontFamily: 'Oswald', letterSpacing: '0.05em', color: THEME.text }}
        >
          GRIDWATCH
        </div>
        <div className="text-center text-xs mb-7" style={{ color: THEME.textDim }}>
          Sign in to your site account
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
              Email
            </label>
            <input
              required
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              className={input}
              style={style}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: THEME.textDim }}>
              Password
            </label>
            <input
              required
              type="password"
              autoComplete="current-password"
              className={input}
              style={style}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="••••••••"
            />
          </div>

          {error && <div className="text-xs" style={{ color: THEME.red }}>{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: THEME.orange, color: '#111' }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="text-[11px] text-center mt-6 leading-relaxed" style={{ color: THEME.textDim }}>
          No account? Ask the office to create one for you — accounts are added
          from the Supabase dashboard and given a role here.
        </div>
      </div>
    </div>
  );
}
