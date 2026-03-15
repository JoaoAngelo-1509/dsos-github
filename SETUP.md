# DSos — Como configurar localmente

## 1. Clone o repositório

```bash
git clone https://github.com/SEU_USUARIO/dsos.git
cd dsos
```

## 2. Configure as credenciais do Supabase

Crie o arquivo `js/supabase-config.local.js` (já está no .gitignore):

```js
// js/supabase-config.local.js  ← NÃO commite este arquivo

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

Depois nos arquivos JS (`auth.js`, `painel-pc.js`, `painel-ti.js`),
troque o import:

```js
// DE:
import { ... } from './supabase-config.js'
// PARA:
import { ... } from './supabase-config.local.js'
```

## 3. Para testar apontando ao banco de teste

Crie `js/supabase-config.test.local.js` com as credenciais do banco de teste
e troque o import para `'./supabase-config.test.local.js'`.

## 4. Sirva localmente

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
├── js/           ← lógica e configuração
├── BG.jpeg       ← imagem de fundo
└── Logo.png      ← logo CPS
```
