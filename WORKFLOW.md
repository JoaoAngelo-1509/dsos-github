# DSos — Workflow de desenvolvimento

## Fluxo obrigatório para alterações no banco

```
1. Aplica migration no banco de TESTE
   └── <TEST_PROJECT_ID> (DSos Test database)

2. Testa no frontend apontando para o banco de TESTE
   └── Trocar import nos JS que forem afetados (auth.js, painel-pc.js,
       painel-ti.js, painel-logs.js, logging.js):
       DE:   './supabase-config.js'
       PARA: './supabase-config.test.js'

3. Aprovação

4. Aplica a mesma migration no banco de PRODUÇÃO
   └── <PROD_PROJECT_ID> (DSos)

5. Reverte o import de volta para './supabase-config.js'
```

`js/supabase-config.js` e `js/supabase-config.test.js` não são versionados (estão no `.gitignore`) — cada ambiente/desenvolvedor cria os seus localmente. Veja [SETUP.md](SETUP.md).

## Fluxo para alterações na Edge Function `groq-proxy`

A função `supabase/functions/groq-proxy` roda com a chave `GROQ_KEY` armazenada como secret no projeto Supabase (não versionada). Ao alterá-la:

```
1. Testa localmente (supabase functions serve groq-proxy) ou direto no projeto de TESTE
2. Deploy no projeto de TESTE: supabase functions deploy groq-proxy --project-ref <TEST_PROJECT_ID>
3. Aprovação
4. Deploy no projeto de PRODUÇÃO: supabase functions deploy groq-proxy --project-ref <PROD_PROJECT_ID>
```

> Ao trocar o modelo Groq usado (`model` no payload), mantenha consistência entre `auth.js`, `painel-pc.js`, `painel-ti.js`, `painel-logs.js` e o default do `groq-proxy`. Todos usam `openai/gpt-oss-20b`.
>
> `gpt-oss-20b` é um modelo de **raciocínio**: gasta centenas de tokens "pensando" antes de escrever a resposta, e esse consumo entra no mesmo `max_tokens`. Um teto apertado não produz resposta curta — produz resposta **vazia ou truncada**, em silêncio. Foi o que aconteceu em `auth.js` (200 → 600 → 1000) e o que motivou os ajustes de agosto/2026 em `painel-ti` e `painel-logs`.
>
> Valores em vigor (conferidos no código):
>
> | Ponto | Arquivo | `max_tokens` |
> |---|---|---|
> | Validação de nome no login | `js/auth.js:118` | 1000 |
> | Classificação de chamado | `js/painel-pc.js:59` (default de `_groqCall`) | 2048 |
> | Resumo do chamado (T.I.) | `js/painel-ti.js` (chamada de `_groqTI`) | 512 |
> | Sugestão de resposta (T.I.) | `js/painel-ti.js` (chamada de `_groqTI`) | 512 |
> | Relatório semanal | `js/painel-logs.js:2211` | 2000 |
> | Default do proxy | `supabase/functions/groq-proxy/index.ts:71` | 1024 |
>
> Confirme os cinco pontos do frontend antes de fechar a mudança.

## Limitações conhecidas / dívida em aberto

Itens levantados na auditoria técnica de 23/08/2026 que **não** foram fechados,
e o motivo:

- **FEAT-01 — 2FA preparado, mas NÃO ativado.** O vazamento mais grave já foi
  fechado: `rpc_gerar_otp_ti` devolvia o código OTP no próprio JSON e era
  chamável por `anon`, de modo que quem já tivesse a senha obteria o segundo
  fator junto (comprovado: a chamada respondia `{"ok":true,...,"codigo":"345280"}`).
  O `EXECUTE` foi revogado do cliente — nada quebrou, porque o frontend nunca
  chamou essa RPC e nenhum T.I. tem e-mail cadastrado.

  O resto do recurso está pronto em
  `supabase/migrations/20260823180000_feat01_2fa_otp_ti.sql`, **que não deve
  ser aplicada ainda** (o arquivo abre com esse aviso). Falta a Edge Function
  de e-mail: sem ela, `rpc_login_ti` passa a devolver um desafio em vez do
  token e ninguém entrega o código ao usuário — quem tiver e-mail cadastrado
  fica trancado fora.

  Para concluir:
  1. criar conta em um provedor de e-mail (Resend é o padrão com Supabase) e
     verificar um domínio remetente;
  2. `supabase secrets set RESEND_API_KEY=<chave> --project-ref <PROD>`;
  3. escrever a Edge Function em `supabase/functions/enviar-otp/` (padrão da
     `groq-proxy`): valida a credencial, chama `rpc_gerar_otp_ti` com a
     service_role key, envia o e-mail e devolve só "enviado: sim/não" — nunca
     o código;
  4. `supabase functions deploy enviar-otp --project-ref <PROD>`;
  5. aplicar a migration acima e ajustar `js/auth.js` + `html/login.html` para
     a etapa do código;
  6. testar com `tests/dois-fatores.test.js`.
- **SEC-05 — resolvido, com uma ressalva.** A leitura de `ticket`, `mensagem`,
  `pc`, `usuario_ti` e `professor` passou a exigir token de sessão, enviado no
  header `X-Sessao-Token` (ver `sec05b_fechar_leitura`). A ressalva é o
  **Supabase Realtime**: ele avalia a RLS sem `request.headers`, então parou de
  entregar eventos de `ticket`/`mensagem`. As listas já eram cobertas pelo poll
  de 30s existente e o chat ganhou poll de 5s; os canais seguem inscritos, e
  voltam a funcionar sozinhos se um dia a leitura for visível ao Realtime.
  Continua em aberto: o vínculo professor⇄chamado é por `nome_solicitante`
  (o schema não tem `ticket.professor_id`), o que é mais fraco que casar por
  id — um aluno que digite o nome de um professor cria um chamado que aquele
  professor passa a enxergar.
- **DB-01 — resolvido.** `supabase/migrations/20260101000000_baseline_schema.sql`
  tem o retrato do schema de produção: 17 tabelas, 98 funções, 34 policies, 42
  índices, RLS e grants. Foi extraído do catálogo do próprio Postgres (o
  `db pull` da CLI exige a senha do banco, que não estava disponível) e reflete
  o estado *depois* das correções desta auditoria. Daqui pra frente, toda
  mudança de schema deve nascer como migration versionada — inclusive as
  aplicadas manualmente pelo painel do Supabase.
- **A11Y-03 — tabelas de log ainda são `<div>` + CSS grid**, não `<table>`
  semântica. Migrar toca a estrutura DOM que o JS gera nas 6 abas; foi
  deixado de fora para não acumular risco com as demais mudanças de
  acessibilidade da mesma leva (`role`, `label`, `aria-label`, que foram
  feitas).
- **RESP-02 — revisão responsiva dedicada de `painel-pc.css`/`painel-ti.css`.**
  O overflow horizontal da página foi eliminado a 375px (RESP-01), mas ler
  tabela densa em celular ainda pede um layout de cards empilhados.
- **CSSARCH-01 — 337 `!important`** em `painel-ti.css`/`painel-logs.css`,
  resultado das camadas de tema/hacker/accent empilhadas sem estratégia de
  cascata. É refactor estrutural de CSS, com risco real de regressão visual;
  o momento de fazer é junto de uma reforma de tema, não avulso.
- **DUP-03 — `showNotif` (painel-logs) x `toast` (ui.js).** Não unificados:
  o `showNotif` tem ícone e as variantes `warn`/`info` que o `toast` não tem,
  e usa markup (`#notif`) que só existe no painel de logs. Unificar exigiria
  ou adicionar esse markup às outras páginas ou empobrecer o painel de logs —
  nenhum dos dois se paga por um item P3.
- **FEAT-02 — "Exportar Word" gera HTML com MIME do Word**, não `.docx` real.
  A própria auditoria classifica como polimento opcional: funciona, o Word
  abre, só exibe um aviso de formato.

## Estrutura de arquivos

```
dsos/
├── index.html                ← landing de consentimento
├── netlify.toml                ← rewrites, headers de segurança e cache do deploy
├── html/
│   ├── login.html
│   ├── painel-pc.html
│   ├── painel-ti.html
│   ├── painel-logs.html
│   └── skillcheck.html        ← protótipo standalone, não usado em produção
├── css/
│   ├── base.css                ← estilos compartilhados + Modo Hacker
│   ├── login.css
│   ├── painel-pc.css
│   ├── painel-ti.css
│   └── painel-logs.css
├── js/
│   ├── supabase-config.js       ← PRODUÇÃO (não versionado — não alterar sem aprovação)
│   ├── supabase-config.test.js  ← TESTE (não versionado — usar para validar mudanças)
│   ├── ui.js                     ← utilitários compartilhados
│   ├── realtime-manager.js       ← diagnóstico padronizado dos canais Supabase Realtime
│   ├── dsos-ui.js                ← popups estilizados (dsosAlert/dsosConfirm)
│   ├── auth.js                    ← lógica de login
│   ├── logging.js                 ← cliente de auditoria
│   ├── painel-pc.js                ← lógica painel aluno/professor
│   ├── painel-ti.js                 ← lógica painel TI
│   ├── painel-logs.js                ← lógica painel de logs/dashboard
│   ├── easter-egg.js                  ← easter egg dos 5 cliques (fonte única das 4 páginas)
│   └── session-guard.js               ← logout por inatividade (ativo em painel-pc, painel-ti e painel-logs)
├── supabase/
│   ├── functions/groq-proxy/     ← proxy da API Groq
│   └── migrations/                ← migrations SQL
├── images/
├── sounds/
├── CHANGELOG.md              ← histórico de versões
└── WORKFLOW.md               ← este arquivo
```

## Bancos de dados

| Ambiente | Projeto | URL |
|---|---|---|
| Produção | `<PROD_PROJECT_ID>` | https://<PROD_PROJECT_ID>.supabase.co |
| Teste    | `<TEST_PROJECT_ID>` | https://<TEST_PROJECT_ID>.supabase.co |

## Credenciais do banco de TESTE

As credenciais de acesso ficam apenas com o administrador do sistema.
Não versione senhas, logins ou chaves de API (Supabase, Groq) em nenhum arquivo do repositório.
