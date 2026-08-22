# ⚙️ Arquivos de Configuração

Este projeto depende de dois arquivos de configuração que **não existem no repositório** por questões de segurança (estão listados no `.gitignore` da raiz). Você precisa criá-los manualmente antes de rodar o sistema.

## Arquivos necessários

- `js/supabase-config.js` — configuração do banco de **produção**
- `js/supabase-config.test.js` — configuração do banco de **teste**

Crie ambos na pasta `js/` com o conteúdo abaixo, substituindo `SUA_SUPABASE_URL_AQUI` e `SUA_ANON_KEY_AQUI` pelas suas chaves reais do Supabase (encontradas em [supabase.com](https://supabase.com), no painel do projeto, em **Settings → API**):

```js
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
```

Como esses arquivos estão no `.gitignore`, qualquer alteração feita neles nunca será enviada ao GitHub — pode colocar suas credenciais reais sem medo de vazá-las no repositório.

Todos os módulos JS do projeto (`auth.js`, `painel-pc.js`, `painel-ti.js`, `painel-logs.js`, `logging.js`) importam de `./supabase-config.js` por padrão. Para testar contra o banco de teste, troque manualmente o import para `./supabase-config.test.js` — veja [../WORKFLOW.md](../WORKFLOW.md).

Para as funcionalidades de IA (classificação de chamados, resumo de tickets, etc.), também é necessário configurar a `GROQ_KEY` na Edge Function `groq-proxy` — veja [../SETUP.md](../SETUP.md).
