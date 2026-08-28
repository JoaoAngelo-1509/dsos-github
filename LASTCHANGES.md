# Últimas alterações — DSos v2.0

## 2026-08-28 — Realtime de volta ao "ao vivo" via tabela de sinal

- **Chamados e chat voltaram a atualizar sozinhos.** Desde o SEC-05b o Supabase
  Realtime não entregava mais eventos de `ticket`/`mensagem` (ele avalia a RLS
  sem o header de sessão), e os painéis dependiam só de poll — 30s nas listas,
  5s no chat. Agora uma tabela-espelho `realtime_sinal` carrega só metadado não
  sensível (canal, id do ticket, tipo do evento); triggers em `ticket`/
  `mensagem` a alimentam, ela entra na publicação do Realtime, e o front
  re-busca o conteúdo real via REST — que continua filtrado pelo token. Nada
  sensível trafega pelo WebSocket.
  - Migration `20260828120000_realtime_sinal_recupera_ao_vivo` (com ROLLBACK).
    Também tira `ticket` e `mensagem` da publicação do Realtime — pós-SEC-05b
    elas não entregavam mais nada. Aplicada em produção e no banco de teste.
  - Canais ajustados em `painel-ti.js` (`tickets-realtime`, `chat-ti-*`) e
    `painel-pc.js` (`chat-pc-*`); som/label de emergência e de "mensagem do TI"
    preservados com um GET pontual do campo necessário.
  - Poll de chat baixou de 5s para 15s (agora é só rede de segurança para
    queda de WebSocket); polls de lista seguem em 30s.
  - Nova suíte `tests/realtime-sinal.test.js`: triggers, shape da tabela
    (trava regressão de vazamento) e escrita fechada.
  - `docs/REALTIME.md` reescrito para a nova arquitetura.

## 2026-08-23 — Auditoria técnica: correções aplicadas

Lote de correções a partir da auditoria de ponta a ponta do projeto.
Backup do estado anterior em [docs/BACKUP-20260823.md](docs/BACKUP-20260823.md).

### Segurança
- **`pc.senha` e `professor.senha_hash` deixaram de ser legíveis via REST.**
  Os dois hashes estavam expostos a qualquer pessoa com a anon key. Em `pc` a
  correção exigiu mover a coluna para uma tabela separada (`pc_senha`) — com a
  senha na mesma tabela, era impossível esconder a coluna e manter o `UPDATE`
  de `status_pc` funcionando ao mesmo tempo.
- **Autorização real no banco (SEC-05).** A escrita em chamados e computadores
  passou a exigir um token de sessão emitido no login: antes, qualquer pessoa
  podia fechar chamados de terceiros, reatribuir técnicos e editar notas
  internas com um `fetch()` no console, sem nunca ter logado. A **leitura**
  ainda é aberta — ver limitações em [WORKFLOW.md](WORKFLOW.md).
- **Exclusão de professor** deixou de aceitar `DELETE` direto via REST.
- **XSS armazenado** corrigido em todos os pontos de renderização de texto de
  aluno/professor (sino de notificações, avaliações, fila de descarte, painel
  de logs) e **injeção de fórmula** bloqueada nas exportações CSV.
- Logout automático por inatividade ativado nas três páginas autenticadas
  (o módulo existia pronto e nunca havia sido importado).
- Painel de logs passou a exigir sessão de T.I.
- CDNs com versão fixa e `integrity` (SRI); `search_path` fixado em todas as
  funções do banco; views voltaram a ser `SECURITY INVOKER`.

### Correções
- **Busca de chamados voltou a funcionar**: o filtro usava `ilike` sobre uma
  coluna `enum`, o que derrubava a query inteira (HTTP 404) e esvaziava as
  listas — bug que não estava na auditoria, encontrado durante as correções.
- **Exclusão de logs** deixou de apagar além do que o diálogo informava.
- KPIs do painel de logs passaram a refletir o conjunto filtrado inteiro, não
  só a página visível; datas passaram a usar fuso local em vez de UTC.
- Impressão/PDF do Dashboard deixou de sair vazia.
- Corridas entre poll e realtime, e entre as duas caixas de busca, resolvidas.
- Texto do chat deixou de se perder quando o upload de imagem falha.
- Limites de tokens da IA ajustados (resumo 256→512, relatório 800→2000).
- Easter egg dos 5 cliques corrigido no painel de logs e unificado num módulo.
- Som de login corrigido (`login.wav` → `login.mp3`) e IDs duplicados no HTML.

### Verificação em duas etapas (2FA) removida
O campo "E-mail para verificação em 2 etapas" no cadastro de T.I. **nunca
ativou 2FA** — não era sequer salvo, e a RPC que gerava o código o devolvia
no próprio JSON, entregando o segundo fator a quem já tivesse a senha.

O recurso foi **removido por completo**: saíram a tabela `otp_ti`, as RPCs
`rpc_gerar_otp_ti`/`rpc_verificar_otp_ti` e todas as referências na tela. A
coluna `usuario_ti.email` ficou, agora apenas como **e-mail de contato**, e
passou a ser gravada de fato — o `rpc_cadastrar_ti` aceitava o parâmetro e
não o usava no INSERT, então o e-mail digitado no cadastro se perdia.

Junto saiu uma **regressão que quebrava a edição de usuário T.I.**: existiam
três sobrecargas de `rpc_atualizar_ti`, e a chamada do painel casava com duas
delas, fazendo o PostgREST responder `PGRST203`. Ficou só a versão completa.

## 2026-08-22 — Deploy e correção de modelo de IA

- **Deploy migrado para Netlify**: `vercel.json` substituído por `netlify.toml` (mesmos rewrites de URL e headers de segurança)
- **Migração de modelo Groq**: `llama-3.3-70b-versatile` (descontinuado, retornava respostas vazias por excesso de reasoning) completamente substituído por `openai/gpt-oss-20b` em `auth.js`, `painel-pc.js`, `painel-ti.js`, `painel-logs.js` e no default do `groq-proxy` — **todos os 5 pontos sincronizados**
- Prompts otimizados para responder sempre em português brasileiro e evitar reasoning desnecessário
- Limites de tokens aumentados: auth (200), painel-pc (2048), painel-ti-resumo (256), painel-ti-sugestao (512), painel-logs (800)
  > Estes números são os de 22/08 e já não valem — foram ajustados de novo em
  > 23/08 (auth 1000, resumo 512, relatório 2000). A tabela sempre atual está
  > em [WORKFLOW.md](WORKFLOW.md).

## v2.0 (Junho 2026)

### Novas funcionalidades
- **SLA em chamados abertos**: cada ticket no painel TI mostra há quanto tempo está aberto (verde < 30min, amarelo 30min–2h, laranja 2h–24h, vermelho > 24h)
- **Dashboard com gráficos**: aba "Dashboard" no Painel de Logs com charts Chart.js — chamados por dia, por tipo, por status, e acessos diários
- **Exportar PDF**: botão de impressão no Painel de Logs para gerar relatórios em PDF diretamente pelo navegador
- **Troca de papel**: técnicos TI que também são professores podem trocar para o modo Professor sem precisar fazer logout
- **Proxy Groq via Edge Function**: `supabase/functions/groq-proxy/` implementado e em uso — move a chave da API Groq para o servidor, usado pela classificação de chamados, validação de nome no login, resumo de tickets e relatório do dashboard
- **Módulo `js/dsos-ui.js`**: popups estilizados (`dsosAlert`/`dsosConfirm`) substituindo `alert`/`confirm` nativos

### Melhorias de UX
- "Esqueceu a senha? Contate o T.I." exibido na tela de login
- Mensagem de ajuda atualizada com instrução sobre recuperação de senha
- Tooltips nos botões destrutivos (remover PC, remover usuário, apagar logs)
- Mensagens de erro padronizadas em todas as telas

### Segurança
- `professor_id` agora armazenado na sessão para usuários com conta dupla TI+Professor
- Documentação sobre a chave da Groq (`GROQ_KEY`, secret da Edge Function) adicionada ao `SETUP.md`
- Privilégios de coluna reforçados em `public.pc` (coluna `senha` não fica exposta via REST) — mesma proteção já aplicada em `usuario_ti`

## v1.2.0 (Março 2026)

- Confirmação antes de ações destrutivas (deletar PC, usuário, professor)
- Botão de cancelar fila de descarte
- Correção: logout duplo em sessões inativas

## v1.1 (Fevereiro 2026)

- Easter egg: logo do CPS + Konami code
- Modo escuro persistido por `localStorage`
- Minijogo Dead by Daylight ao resolver chamados

## v1.0 (Janeiro 2026)

- Lançamento inicial do sistema
- Ticketing com chat em tempo real
- Classificação de prioridade via Groq AI (LLaMA 3.1)
- Painel de auditoria de logs
- Gerenciamento de PCs e usuários TI
