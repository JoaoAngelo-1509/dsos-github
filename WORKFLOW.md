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

- **FEAT-01 — verificação em 2 etapas (2FA) não existe.** O banco tem a
  infraestrutura (`otp_ti`, `rpc_gerar_otp_ti`, `rpc_verificar_otp_ti`,
  `usuario_ti.email`), mas ela não está ligada e **não pode ser ligada como
  está**: (1) não existe edge function de envio de e-mail no projeto — só a
  `groq-proxy`; (2) `rpc_gerar_otp_ti` **devolve o código no próprio JSON**,
  então, chamada pelo cliente, entregaria o código a quem já tem a senha,
  anulando o propósito do 2FA. Para completar seria preciso uma edge function
  que envie o e-mail e passe a ser a única a enxergar o código. Até lá, o campo
  na tela de cadastro de T.I. foi reetiquetado como "E-mail de contato" — antes
  ele anunciava 2FA e sequer era salvo, o que dava ao administrador a impressão
  falsa de ter protegido a conta.
- **SEC-05 — leitura ainda é aberta.** A escrita em `ticket`/`pc` passou a
  exigir token de sessão (ver migrations `sec05_*`), mas `ticket_select`,
  `pc_select` e `mensagem_select` continuam `USING (true)`: qualquer pessoa com
  a anon key ainda **lê** todos os chamados, o chat e as notas internas.
  Fechar a leitura exige identificar o solicitante em toda consulta, o que só
  faz sentido junto com a migração para Supabase Auth.
- **DB-01 — migrations legadas não versionadas.** As migrations criadas a
  partir de 23/08/2026 estão em `supabase/migrations/`, mas as ~91 anteriores
  existem só no histórico interno do Supabase. Rodar `supabase db pull` para
  gerar um baseline versionado continua pendente.

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
