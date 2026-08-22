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

> Ao trocar o modelo Groq usado (`model` no payload), mantenha consistência entre `auth.js`, `painel-pc.js`, `painel-ti.js`, `painel-logs.js` e o default do `groq-proxy` — houve um caso em que `painel-logs.js` ficou desatualizado em relação aos demais após uma migração de modelo. Confirme os quatro pontos antes de fechar a mudança.

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
│   ├── dsos-ui.js                ← popups estilizados (dsosAlert/dsosConfirm)
│   ├── auth.js                    ← lógica de login
│   ├── logging.js                 ← cliente de auditoria
│   ├── painel-pc.js                ← lógica painel aluno/professor
│   ├── painel-ti.js                 ← lógica painel TI
│   ├── painel-logs.js                ← lógica painel de logs/dashboard
│   └── session-guard.js               ← módulo de logout por inatividade (não importado por nenhuma página atualmente)
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
