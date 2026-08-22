# DSos — Como configurar localmente

## 1. Clone o repositório

```bash
git clone https://github.com/SEU_USUARIO/dsos.git
cd dsos
```

## 2. Crie os arquivos de configuração do Supabase

Os arquivos `js/supabase-config.js` (produção) e `js/supabase-config.test.js` (teste) **não existem no repositório** — estão no `.gitignore` por conterem credenciais e precisam ser criados manualmente na pasta `js/`.

Crie `js/supabase-config.js`:

```js
// js/supabase-config.js  ← NÃO commite este arquivo (já está no .gitignore)

const PROJECT_URL = 'https://SEU_PROJECT_ID.supabase.co';
const ANON_KEY    = 'SUA_ANON_KEY';

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
```

As credenciais (`PROJECT_URL` e `ANON_KEY`) ficam em **Settings → API** no painel do seu projeto Supabase.

Todos os módulos JS (`auth.js`, `painel-pc.js`, `painel-ti.js`, `painel-logs.js`, `logging.js`) importam diretamente de `./supabase-config.js` — não é necessário editar nenhum import para rodar localmente.

## 3. Para testar apontando ao banco de teste

Crie `js/supabase-config.test.js` com o mesmo formato acima, mas com as credenciais do projeto Supabase de teste. Para usá-lo, troque manualmente o import nos arquivos JS relevantes:

```js
// DE:
import { ... } from './supabase-config.js'
// PARA:
import { ... } from './supabase-config.test.js'
```

Lembre de reverter o import antes de commitar — veja [WORKFLOW.md](WORKFLOW.md).

## 4. Configure a Edge Function `groq-proxy` (funcionalidades de IA)

A classificação de chamados, validação de nome no login, resumo automático de tickets e relatório do dashboard dependem da Edge Function `supabase/functions/groq-proxy`, que mantém a chave da Groq fora do frontend.

```bash
supabase functions deploy groq-proxy
supabase secrets set GROQ_KEY=gsk_SUA_CHAVE_GROQ
```

Opcionalmente, restrinja o CORS da função a um domínio específico:

```bash
supabase secrets set GROQ_PROXY_ALLOWED_ORIGIN=https://seu-dominio.netlify.app
```

Sem `GROQ_KEY` configurada, a função responde `500` e as funcionalidades de IA falham de forma silenciosa (fail-open) no frontend.

## 5. Sirva localmente

Use qualquer servidor HTTP estático, por exemplo:

```bash
# Python
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Acesse: http://localhost:8080/html/login.html

## Estrutura de arquivos

```
dsos/
├── html/         ← páginas HTML
├── css/          ← estilos
├── js/           ← lógica e configuração (supabase-config.js e supabase-config.test.js são locais)
├── supabase/     ← migrations SQL e edge functions
├── images/       ← logo, fundo, favicon
└── sounds/       ← efeitos sonoros
```
