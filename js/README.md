
⚙️ Arquivos de Configuração



Este projeto depende de dois arquivos de configuração que não estão no repositório por questões de segurança. Você precisa criá-los manualmente antes de rodar o sistema.
Arquivos necessários:
js/supabase-config.js — configuração do banco de produção
js/supabase-config.test.js — configuração do banco de teste
Ambos os arquivos já existem no repositório com valores de exemplo. Você precisa substituir os valores SUA_SUPABASE_URL_AQUI e SUA_ANON_KEY_AQUI pelas suas chaves reais do Supabase, que podem ser encontradas em supabase.com no painel do seu projeto em Settings → API.
Esses arquivos estão no .gitignore, ou seja, qualquer alteração feita neles nunca será enviada para o GitHub. Pode colocar suas credenciais reais sem medo.





É só colar isso no README principal do projeto lá no GitHub.fala q nao existe no repositoria pq n ta la msm20:49Aqui vai o texto atualizado:

⚙️ Arquivos de Configuração




Este projeto depende de dois arquivos de configuração que não estão no repositório por questões de segurança. Você precisa criá-los manualmente antes de rodar o sistema.
Arquivos necessários:
js/supabase-config.js — configuração do banco de produção
js/supabase-config.test.js — configuração do banco de teste
Esses arquivos não existem no repositório. Você precisa criá-los na pasta js/ com o seguinte conteúdo, substituindo os valores pelas suas chaves reais do Supabase, que podem ser encontradas em supabase.com no painel do seu projeto em Settings → API.



jsconst PROJECT_URL = 'SUA_SUPABASE_URL_AQUI';
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
