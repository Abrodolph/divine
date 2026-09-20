import { createClient } from '@supabase/supabase-js';

// The playground (npm run dev:playground) has its own variable names on
// purpose: Vite also loads .env in playground mode, so reusing VITE_SUPABASE_*
// would let a missing value fall through to the LIVE project.
export const PLAYGROUND = import.meta.env.VITE_APP_ENV === 'playground';

const url = PLAYGROUND ? import.meta.env.VITE_PLAYGROUND_SUPABASE_URL : import.meta.env.VITE_SUPABASE_URL;
const key = PLAYGROUND ? import.meta.env.VITE_PLAYGROUND_SUPABASE_ANON_KEY : import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly and early — a blank screen with no explanation is the worst outcome.
  throw new Error(PLAYGROUND
    ? 'Missing playground config. Copy .env.playground.example to .env.playground and fill in ' +
      'VITE_PLAYGROUND_SUPABASE_URL and VITE_PLAYGROUND_SUPABASE_ANON_KEY from your test project.'
    : 'Missing Supabase config. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart `npm run dev`.');
}
if (PLAYGROUND && url === import.meta.env.VITE_SUPABASE_URL) {
  throw new Error('The playground is pointing at the live Supabase project. Use a separate test project in .env.playground.');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
