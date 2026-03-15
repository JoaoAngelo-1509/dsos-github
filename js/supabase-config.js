// DSos v1.1.0 — supabase-config.js
// Arquivo de configuração — credenciais ficam apenas no seu PC

const PROJECT_URL = 'SUA_SUPABASE_URL_AQUI';
const ANON_KEY    = 'SUA_ANON_KEY_AQUI';

export const H = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

export const SB_URL = PROJECT_URL; export const SB_KEY = ANON_KEY;
export const SB     = PROJECT_URL; export const KEY    = ANON_KEY;
export const SUPABASE_URL = PROJECT_URL; export const SUPABASE_KEY = ANON_KEY;
export const SUPABASE_HEADERS = H;
