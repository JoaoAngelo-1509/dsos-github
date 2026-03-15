// DSos v1.1.0 — supabase-config.js
// ⚠️  NÃO commite credenciais reais aqui.
// Copie este arquivo para supabase-config.local.js e preencha com suas chaves.
// supabase-config.local.js está no .gitignore.

const PROJECT_URL = 'teste';
const ANON_KEY    = 'SUA_ANON_KEY_AQUI';

export const H = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

export const SB_URL           = PROJECT_URL;
export const SB_KEY           = ANON_KEY;
export const SB               = PROJECT_URL;
export const KEY               = ANON_KEY;
export const SUPABASE_URL     = PROJECT_URL;
export const SUPABASE_KEY     = ANON_KEY;
export const SUPABASE_HEADERS = H;
