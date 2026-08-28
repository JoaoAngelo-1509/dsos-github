# DSos — HelpDesk Escolar

Sistema de chamados de suporte técnico para laboratórios de informática escolares, com painel de aluno/professor, painel de T.I., auditoria/logs com dashboard analítico e classificação de chamados assistida por IA (Groq). Frontend em HTML/CSS/JS puro (sem framework/build step), backend em Supabase (Postgres + RPCs + Realtime + Edge Functions).

## Estrutura do Projeto

```
/
├── index.html              ← Landing page de consentimento/aviso (fase de testes)
├── 404.html                ← Página de erro 404 (cena temática SUPERHOT); fica na raiz porque é de lá que a Netlify a serve
├── netlify.toml              ← Rewrites de URL, headers de segurança (CSP) e cache-control do deploy
├── html/
│   ├── login.html           ← Login (usuário do PC / professor / técnico T.I.)
│   ├── painel-pc.html        ← Painel do aluno/professor (abrir e acompanhar chamados)
│   ├── painel-ti.html        ← Painel do técnico de T.I. (gestão de chamados, PCs, equipe)
│   ├── painel-logs.html      ← Auditoria de logs + dashboard com gráficos (Chart.js)
│   └── skillcheck.html       ← Protótipo standalone do minigame "Skill Check" (não usado em produção)
├── css/
│   ├── base.css              ← Reset, fundo, lightbox, easter egg, Modo Hacker (compartilhado)
│   ├── login.css             ← Estilos exclusivos do login
│   ├── painel-pc.css         ← Estilos do painel do aluno/professor
│   ├── painel-ti.css         ← Estilos do painel T.I. (o mais extenso: inclui easter eggs)
│   ├── painel-logs.css       ← Estilos do painel de logs/dashboard (inclui layout de impressão)
│   └── 404.css               ← Estilos da página 404 (paleta própria; não usa base.css/tokens.css)
├── js/
│   ├── supabase-config.js    ← Config do Supabase (URL + anon key) — NÃO versionado, ver SETUP.md
│   ├── ui.js                 ← Utilitários compartilhados (tema, toast, escapeHtml, labels de status)
│   ├── realtime-manager.js   ← Diagnóstico padronizado do status dos canais Supabase Realtime (usado por painel-ti/pc/logs)
│   ├── dsos-ui.js             ← Popups estilizados (dsosAlert/dsosConfirm), substitui alert/confirm nativos
│   ├── auth.js                ← Lógica de login, rate limiting e validação de nome via IA
│   ├── logging.js             ← Cliente de auditoria (RPCs de log), usado pelo painel-logs
│   ├── painel-pc.js            ← Lógica do painel do aluno/professor
│   ├── painel-ti.js            ← Lógica do painel T.I. (o maior módulo do sistema)
│   ├── painel-logs.js           ← Lógica do painel de logs/dashboard
│   ├── session-guard.js        ← Logout automático por inatividade (módulo pronto, hoje não importado por nenhuma página — ver nota abaixo)
│   ├── 404-inimigo.js          ← Geometria 3D do inimigo da página 404 — GERADO, ver scripts/gera-404-inimigo.js
│   └── 404.js                  ← Renderizador 3D da cena da página 404 (canvas puro) + "scrub de tempo" controlado pelo cursor
├── supabase/
│   ├── functions/groq-proxy/index.ts   ← Edge Function: proxy da API Groq (mantém a chave fora do cliente)
│   └── migrations/                     ← Migrations SQL (privilégios de colunas sensíveis, etc.)
├── scripts/
│   ├── netlify-build.sh    ← Gera js/supabase-config.js no build da Netlify a partir de env vars
│   └── gera-404-inimigo.js ← Baixa um base mesh humano CC0 e o converte na geometria da página 404 (rodado à mão, fora do build)
├── images/                  ← Logo, fundo (BG.svg/BG_dark_mode.svg), favicon
└── sounds/                  ← Efeitos sonoros (notificação, login, minigame Skill Check)
```

> `js/supabase-config.js` e `js/supabase-config.test.js` estão no `.gitignore` e precisam ser criados localmente — veja [SETUP.md](SETUP.md).

## Principais funcionalidades

- **Chamados com chat em tempo real** (Supabase Realtime), envio de imagem por upload ou câmera, avaliação por estrelas pós-atendimento.
- **Classificação de chamados por IA** (Groq): tipo, prioridade e sugestão de solução antes mesmo de abrir o chamado; detecção de chamado duplicado; resumo automático e sugestão de resposta no painel T.I.; relatório semanal em linguagem natural no painel de logs.
- **SLA visual**: cada chamado exibe há quanto tempo está aberto, com cor (verde/amarelo/laranja/vermelho) conforme o tempo decorrido.
- **Painel de auditoria e dashboard**: logs de login/logout, alterações de banco, atividades e alterações críticas, com filtros, exportação CSV/PDF e gráficos (Chart.js) — chamados por dia/tipo/status, acessos, heatmap por hora, ranking de laboratórios e técnicos.
- **Gestão completa** de PCs, equipe de T.I. e professores (com suporte a contas duplas T.I. + Professor), incluindo fila de descarte de equipamento com fluxo de conformidade PNRS (Lei 12.305/2010).
- **Login triplo** (PC/aluno, professor, técnico T.I.) com rate limiting client-side e troca de papel sem logout.
- **Modo Hacker** (tema alternativo estilo terminal) disponível em todos os painéis.
- **Easter eggs**: 5 cliques na logo em todas as telas, Konami code e Ordens Paranormais (RPG com 5 temas visuais) no painel T.I., e um minigame "Skill Check" (Dead by Daylight) integrado ao fluxo de resolução de chamados.

## Como usar

O projeto é 100% estático (sem build step). Depois de configurar as credenciais (veja [SETUP.md](SETUP.md)), sirva os arquivos via qualquer servidor HTTP local (ex: `npx serve .`, Live Server no VSCode) e abra `html/login.html` — ou `index.html` na raiz, que direciona para o login após o aviso de consentimento.

Em produção, o deploy é feito na Netlify (`netlify.toml` já configura os rewrites de URL limpa, os headers de segurança e o build que gera `js/supabase-config.js` a partir de variáveis de ambiente — veja [SETUP.md](SETUP.md#5-deploy-na-netlify)).

## Documentação relacionada

- [SETUP.md](SETUP.md) — como configurar o ambiente local
- [WORKFLOW.md](WORKFLOW.md) — fluxo de alterações no banco de dados
- [docs/REALTIME.md](docs/REALTIME.md) — arquitetura de realtime (canais, eventos, diagnóstico)
- [CHANGELOG.md](CHANGELOG.md) — histórico de versões
- [LASTCHANGES.md](LASTCHANGES.md) — resumo das últimas alterações
- [EASTER_EGGS.md](EASTER_EGGS.md) — guia de todos os easter eggs escondidos no sistema
- [js/README.md](js/README.md) — como criar os arquivos de configuração do Supabase
