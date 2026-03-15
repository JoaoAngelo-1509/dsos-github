// DSos v1.1.0 — supabase-config.test.js
// ⚠️  NÃO commite credenciais reais aqui.
// Preencha com as chaves do seu banco de TESTE local.
// Este arquivo está no .gitignore.

const PROJECT_URL = 'SUA_SUPABASE_TEST_URL_AQUI';
const ANON_KEY    = 'SUA_ANON_KEY_TESTE_AQUI';

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
