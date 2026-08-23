# DSos — Arquitetura de Realtime

Este documento descreve como o realtime (Supabase Postgres Changes) funciona no
DSos: quais canais existem, o que cada um escuta, como diagnosticar problemas
e o que foi deliberadamente deixado fora do escopo.

## Visão geral

Todo o realtime do projeto usa **Supabase Realtime — Postgres Changes**
(`.channel(...).on('postgres_changes', {...}, cb).subscribe(...)`), sem
nenhuma infraestrutura própria de WebSocket. Cada painel abre seu(s) canal(is)
ao carregar a página (ou ao abrir um modal, no caso do chat) e usa o SDK
`@supabase/supabase-js` já carregado via CDN em cada HTML.

`js/realtime-manager.js` centraliza o diagnóstico: `rtStatusHandler(label, dotElId?)`
retorna um callback para `.subscribe(cb)` que:
- loga no console (`[realtime:<label>] conectado/falhou/fechado às HH:MM:SS`);
- opcionalmente atualiza a cor de um elemento no DOM (`dotElId`) — verde
  (`SUBSCRIBED`), vermelho (`CHANNEL_ERROR`/`TIMED_OUT`), amarelo (demais
  estados, ex: conectando).

## Canais por painel

### `painel-ti.js`

**Canal `tickets-realtime`** (aberto uma vez, vive por toda a sessão da
página; indicador visual "AO VIVO" na topbar usa `rt-dot`):

| Tabela | Evento | Efeito |
|---|---|---|
| `ticket` | INSERT | Novo chamado → `_scheduleTicketsKPIRefresh()`, som, notif, notificação do browser |
| `ticket` | UPDATE | Chamado mudou de status/prioridade → `_scheduleTicketsKPIRefresh()` |
| `mensagem` | INSERT | Nova mensagem → `carregarNaoLidas()`, som se veio do PC |
| `mensagem` | UPDATE | Mensagem lida em outra sessão → `carregarNaoLidas()` |

`usuario_ti` e `professor` **não estão neste canal, de propósito** — ver
"Por que equipe T.I./professores não são realtime" abaixo.
`carregarTIs()`/`carregarProfs()` (equipe T.I./professores, incl. presença e
`tiMap` usado por `tecNome()`) são cobertos pelo poll de 30s (`_pollEquipe()`).

`_scheduleTicketsKPIRefresh()` faz **debounce de 300ms + coalescing**: eventos
próximos (dois técnicos agindo quase ao mesmo tempo, ou um evento coincidindo
com o poll de 30s) são agrupados em uma única chamada a
`carregarTickets()+carregarKPIs()`, e se um refresh já está em andamento o
próximo é apenas enfileirado (máx. 1 pendente) — evita fetches sobrepostos
que poderiam renderizar dados obsoletos por cima de dados novos.

**Canal `chat-ti-{ticketId}`** (aberto ao abrir o modal de um chamado,
desinscrito em `fecharModal()`):

| Tabela | Evento | Efeito |
|---|---|---|
| `mensagem` (filtro `ticket_id=eq.{id}`) | INSERT | `carregarMsgsTi()` + `marcarLidoTi()` |
| `mensagem` (filtro `ticket_id=eq.{id}`) | UPDATE | `carregarMsgsTi()` (ex: PC marcou como lida — atualiza o tick ✓✓) |

### `painel-pc.js`

**Canal `chat-pc-{ticketId}`** (aberto ao abrir o modal de chat, desinscrito
em `fecharChat()`):

| Tabela | Evento | Efeito |
|---|---|---|
| `mensagem` (filtro `ticket_id=eq.{id}`) | INSERT | `carregarMsgs()`, `_marcarLidoPC()`, som se veio do TI |
| `mensagem` (filtro `ticket_id=eq.{id}`) | UPDATE | `carregarMsgs()` (ex: TI marcou como lida) |
| `ticket` (filtro `id=eq.{id}`) | UPDATE | Chamado encerrado → som, `carregarChamados()` + `carregarMsgs()` |

Fora do modal de chat, a lista de chamados do PC/professor não tem canal
próprio — depende do poll de 30s (`_iniciarPollPC`). Isso é intencional: um
canal por PC logado para a lista inteira teria custo de conexão desproporcional
ao ganho (o aluno normalmente está com o chat aberto quando importa acompanhar
em tempo real).

### `painel-logs.js`

**Canal `logs-realtime-all`** (aberto uma vez; indicador "AO VIVO" usa
`rt-dot`, mesmo padrão do painel T.I.):

| Tabela | Evento | Efeito |
|---|---|---|
| `auditoria_ti`, `audit_log`, `atividades_log`, `acesso_log`, `alteracoes_criticas_log` | INSERT | Se a aba correspondente está ativa e na página 0 → recarrega silenciosamente (`_recarregarSilencioso`, com flash verde na primeira linha); senão incrementa o badge "novos" da aba |
| `acesso_log` | UPDATE | Captura `duracao_sessao` preenchida no logout — recarrega se a aba "acessos" está ativa e na página 0 |
| `sessao_ativa` | INSERT/UPDATE/DELETE | Sincroniza o `Set` local `_sessoesAtivas` e re-marca as células "duração ao vivo" no DOM **sem refazer fetch** — evita resetar a lista a cada heartbeat de 30s de outro usuário logado |

## Já existente e frequentemente confundido com "faltando"

Isto **já era realtime antes deste trabalho**, confirmado empiricamente (teste
com INSERT/UPDATE reais contra o banco de produção, via script, observando o
evento chegar pelo WebSocket em <1s):

- **Confirmação de leitura de mensagens** (`lido_ti` / `lido_pc` na tabela
  `mensagem`, ticks ✓/✓✓ no chat de ambos os painéis) — já existia e já
  atualiza via os canais `chat-ti-*` / `chat-pc-*` acima.
- **Chamados e mensagens** (`ticket`, `mensagem`) — ambas as tabelas estão na
  publicação `supabase_realtime` do Postgres com política de SELECT
  permissiva (`qual: true` para `public`), então os eventos são entregues
  corretamente.

> Presença online/ausente de técnicos **não** era realtime, apesar de o
> código ter um listener de UPDATE em `usuario_ti` desde antes — o listener
> nunca disparava porque a tabela nunca esteve na publicação
> `supabase_realtime` (confirmado consultando `pg_publication_tables`).
> Ou seja: a presença de um colega de equipe só atualizava em outro painel
> aberto quando aquele painel fizesse algo que disparasse `carregarTIs()` por
> conta própria (ex: editar seu próprio cadastro) — não espontaneamente.
> A lição: a presença de um `.on('postgres_changes', ...)` no código **não
> garante** que o evento seja entregue — é preciso confirmar a tabela na
> publicação e a RLS, não só ler o JS.

## Por que equipe T.I./professores não são realtime

`usuario_ti` tem coluna `senha` e `professor` tem `senha_hash` (e `usuario_ti`
também tem `email`, usado no 2FA). O Postgres Realtime (Postgres Changes)
transmite **a linha inteira** — todas as colunas, sem filtro — para qualquer
cliente com uma subscription ativa na tabela, independente de quais colunas o
app realmente usa no `select=`. A anon key usada por esses clientes é pública
(está no bundle JS do site).

Isso significa que publicar `usuario_ti`/`professor` no Realtime **vazaria
hash de senha e e-mail** de toda a equipe para qualquer pessoa que abrisse o
DevTools e se inscrevesse no canal com a mesma anon key — mesmo sem estar
logada. Por isso essas duas tabelas nunca foram (e não devem ser) adicionadas
à publicação `supabase_realtime`.

Hoje a lista de equipe T.I. e professores atualiza via **poll de 30s**
(`_pollEquipe()` em `painel-ti.js`, chamado junto do poll de tickets) — seguro,
só um pouco mais lento que realtime.

Se no futuro isso precisar ser instantâneo, a forma seguravel de fazer é via
**Realtime Broadcast** (não Postgres Changes): um trigger no Postgres que
publica manualmente só os campos seguros (`id`, `nome`, `login`, `presenca`,
`is_professor`) num canal de broadcast, em vez de expor a tabela inteira via
replicação. Isso é trabalho novo, não implementado aqui.

## Diagnosticando problemas

1. **Console do navegador**: toda subscription loga via `rtStatusHandler`,
   ex: `[realtime:tickets-realtime] conectado às 14:32:01`. Se aparecer
   `falhou (CHANNEL_ERROR)` ou `falhou (TIMED_OUT)`, o canal caiu.
2. **Indicador visual "AO VIVO"** (painel T.I. e painel de logs): bolinha
   verde = conectado, vermelha = erro/timeout, amarela = conectando/outro
   estado.
3. **DevTools → Network → WS**: procure a conexão para
   `wss://<projeto>.supabase.co/realtime/v1/websocket`. Mensagens `phx_reply`
   com `"status":"ok"` confirmam que o canal está recebendo eventos.
4. **Fallback por poll**: mesmo com o realtime totalmente fora do ar, o
   painel T.I. (30s) e o painel do PC (30s) continuam sincronizando via poll
   — os dados nunca ficam presos indefinidamente, só mais lentos.
5. **Antes de suspeitar de bug no código: confirme que o deploy está
   atualizado.** `git log origin/main -1` local vs. `git log -1` — se
   divergirem, o site publicado está rodando código antigo e nenhuma mudança
   de JS vai aparecer até o push + deploy acontecerem. Esse foi exatamente o
   motivo de "precisa dar F5" reportado durante o desenvolvimento deste
   documento: o código estava correto e testado, mas nunca tinha sido enviado
   ao GitHub/Netlify.

## Fora do escopo (deliberadamente sem realtime)

- **Dashboard do painel de logs** (gráficos Chart.js): atualização manual
  (botão "Atualizar" / troca de período). Gráficos agregados não se
  beneficiam de realtime por evento individual — recalcular a cada INSERT
  seria caro e imperceptível visualmente na maioria dos casos.
- **Grade de computadores** (`carregarPCs()`): cadastro/edição de PC é raro
  e já é coberto pelo poll de 30s do painel T.I.
- **Lista de chamados fora do modal de chat** (painel do PC): ver nota acima.

## Arquivos relevantes

- `js/realtime-manager.js` — `rtStatusHandler()`
- `js/painel-ti.js` — canal `tickets-realtime` + `chat-ti-{id}`, coalescing de KPIs
- `js/painel-pc.js` — canal `chat-pc-{id}`
- `js/painel-logs.js` — canal `logs-realtime-all`
