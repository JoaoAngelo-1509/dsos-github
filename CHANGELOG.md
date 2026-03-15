# DSos — Changelog

## [1.1.0] — 2026-03-15

### Banco de dados — correções RLS (produção + teste)
- **CORRIGIDO** policy `authenticated_update_ticket`: estava restrita a `authenticated`, bloqueando
  silenciosamente todos os UPDATEs feitos pela anon key do frontend.
  Resultado: botões "Em andamento", "Resolvido", "Descartado", "Falso alarme" e "Reabrir"
  não salvavam nada mesmo após confirmação. → `TO anon, authenticated`
- **CORRIGIDO** policy `authenticated_update_pc`: mesma causa — atualizações de `status_pc`
  (ativo/em_manutencao/descartado) não eram salvas. → `TO anon, authenticated`
- **CORRIGIDO** tabela `professor` sem policies de INSERT/UPDATE/DELETE:
  `window.deletarProf` usa DELETE REST direto e falhava silenciosamente.
  Adicionadas policies de INSERT, UPDATE e DELETE para `anon, authenticated`.

### Estrutura do projeto — refatoração
- CSS inline extraído para arquivos separados: `base.css`, `login.css`, `painel-pc.css`, `painel-ti.css`
- JS inline extraído para arquivos separados: `auth.js`, `ui.js`, `painel-pc.js`, `painel-ti.js`
- Utilitários compartilhados centralizados em `ui.js`
- Configuração do Supabase centralizada em `supabase-config.js`
- Adicionado `supabase-config.test.js` para fluxo de teste antes de produção

### Bugs corrigidos
- `painel-ti.js`: chave de localStorage `'dsos_tema'` unificada para `'dsos_tema_login'`
  (tema não persistia ao navegar entre páginas)
- `painel-pc.html` e `painel-ti.html`: `Logo.png` corrigido para `../Logo.png`
- `painel-pc.html`: `id="toast"` duplicado removido
- `painel-ti.html`: `id="notif"` duplicado removido
- `painel-pc.css`: classe `.foot-logo` adicionada (estava faltando após extração do CSS)

---

## [1.0.0] — projeto original (antes da refatoração)
- HTML monolítico com CSS e JS inline
- Três arquivos: `login.html`, `painel-pc.html`, `painel-ti.html`
- `supabase-config.js` centralizado (já existia)
