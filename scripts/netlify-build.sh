#!/usr/bin/env bash
# Gera js/supabase-config.js no momento do build da Netlify, a partir de
# variáveis de ambiente (Site configuration → Environment variables no
# painel da Netlify). O arquivo continua fora do git (.gitignore) — isso só
# recria localmente na máquina de build, nunca é commitado.
set -euo pipefail

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERRO: defina SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente do site na Netlify (Site configuration → Environment variables)." >&2
  exit 1
fi

mkdir -p js

printf "const PROJECT_URL = '%s';\nconst ANON_KEY    = '%s';\n\n" "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > js/supabase-config.js

cat >> js/supabase-config.js << 'EOF'
export const H = {
  apikey: ANON_KEY,
  Authorization: 'Bearer ' + ANON_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

export const SB_URL = PROJECT_URL; export const SB_KEY = ANON_KEY;
export const SB     = PROJECT_URL; export const KEY    = ANON_KEY;
export const SUPABASE_URL = PROJECT_URL; export const SUPABASE_KEY = ANON_KEY;
export const SUPABASE_HEADERS = H;
EOF

echo "js/supabase-config.js gerado a partir das variáveis de ambiente."
