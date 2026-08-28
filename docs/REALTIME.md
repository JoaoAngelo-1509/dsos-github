# DSos — Arquitetura de Realtime

Este documento descreve como o realtime funciona no DSos: por que ele passa
hoje por uma **tabela de sinal** (`public.realtime_sinal`), quais canais
existem, o que cada um dispara, como diagnosticar e o que ficou de fora.

## Por que uma tabela de sinal

Historicamente os painéis assinavam `postgres_changes` direto em `ticket` e
`mensagem`. O **SEC-05b** (`20260823170000_sec05b_fechar_leitura`) fechou o
SELECT dessas tabelas: agora a RLS exige o token de sessão no header HTTP
`X-Sessao-Token`. O Supabase Realtime avalia a RLS em `realtime.apply_rls()`
**sem `request.headers`** (o header viaja na requisição do PostgREST; o
WebSocket não carrega header), então as policies passaram a devolver `false`
dentro do Realtime e os canais de `ticket`/`mensagem` **pararam de entregar
eventos** — sem erro, só silêncio.

A migration `20260828120000_realtime_sinal_recupera_ao_vivo` recupera o
"ao vivo" sem reabrir a leitura:

- **`public.realtime_sinal`** guarda só metadado **não sensível**:
  `canal` (`'ticket'` | `'mensagem'`), `ref_id` (id do ticket; para
  `mensagem` é o `ticket_id`), `evento` (`'INSERT'` | `'UPDATE'`), `em`.
- Triggers `AFTER INSERT OR UPDATE` em `ticket` e `mensagem`
  (`fn_emitir_sinal_realtime`, SECURITY DEFINER) gravam uma linha a cada
  mudança e podam linhas com mais de 10 min.
- A tabela tem SELECT `USING (true)` — é o que o Realtime enxerga — e entra na
  publication `supabase_realtime`. Escrita é fechada (sem policy de
  INSERT/UPDATE/DELETE + `REVOKE`): só os triggers escrevem.
- A mesma migration **tira `ticket` e `mensagem` da publication**: pós-SEC-05b
  elas não entregam nada (a RLS nega sem o header), então continuar
  publicando-as só gastava decodificação de WAL e confundia diagnóstico.
- O front assina `realtime_sinal`; ao receber o sinal, **refaz o fetch pelo
  caminho REST normal**, que continua filtrado pelo token. O dado sensível
  nunca passa pelo WebSocket — só o aviso "o ticket X mudou".

Deixar `USING (true)` é seguro porque nenhuma coluna sensível trafega (sem
corpo de mensagem, nome de solicitante, nota interna ou status). Um anônimo
com a anon key vê apenas ritmo de atividade e ids de ticket — aceitável no
modelo do projeto (um banco por instituição, poucos usuários simultâneos).

> ⚠️ **Nunca adicione a `realtime_sinal` uma coluna derivada de dado fechado
> por RLS.** `tests/realtime-sinal.test.js` trava o shape da tabela
> (`{id, canal, ref_id, evento, em}`) por isso.

`js/realtime-manager.js` continua centralizando o diagnóstico:
`rtStatusHandler(label, dotElId?)` loga no console
(`[realtime:<label>] conectado/falhou/fechado às HH:MM:SS`) e opcionalmente
pinta uma bolinha no DOM — verde (`SUBSCRIBED`), vermelho
(`CHANNEL_ERROR`/`TIMED_OUT`), amarelo (demais estados).

## Canais por painel

Todos assinam `realtime_sinal` via `postgres_changes` (evento `INSERT`, que é
o único que a tabela recebe).

### `painel-ti.js`

**Canal `tickets-realtime`** (aberto uma vez; vive por toda a sessão da
página; bolinha "AO VIVO" na topbar usa `rt-dot`):

| Filtro do sinal | Efeito |
|---|---|
| `canal=eq.ticket` | `_scheduleTicketsKPIRefresh()`. Se `evento='INSERT'`: um GET pontual em `ticket?id=eq.{ref_id}&select=chamado_emergencia,descricao` (o T.I. vê todos) decide som/label/notificação do browser — emergência x normal |
| `canal=eq.mensagem` | `carregarNaoLidas()`; se a contagem de não lidas do T.I. **subiu** para aquele `ref_id` e o evento é `INSERT`, toca o som de mensagem nova (sem precisar do corpo) |

`_scheduleTicketsKPIRefresh()` mantém o **debounce de 300 ms + coalescing**
(eventos próximos viram uma única chamada a `carregarTickets()+carregarKPIs()`;
no máximo 1 refresh enfileirado).

**Canal `chat-ti-{ticketId}`** (aberto ao abrir o modal de um chamado,
desinscrito em `fecharModal()`):

| Filtro do sinal | Efeito |
|---|---|
| `ref_id=eq.{ticketId}` + `canal='mensagem'` | `carregarMsgsTi()`; se `evento='INSERT'`, `marcarLidoTi()` |

`usuario_ti` e `professor` **continuam sem sinal, de propósito** — ver
"Por que equipe T.I./professores não são realtime". `carregarTIs()` /
`carregarProfs()` seguem no poll de 30 s (`_pollEquipe()`).

### `painel-pc.js`

**Canal `chat-pc-{ticketId}`** (aberto ao abrir o modal de chat, desinscrito
em `fecharChat()`), filtro `ref_id=eq.{ticketId}`:

| `canal` / `evento` do sinal | Efeito |
|---|---|
| `mensagem` (qualquer) | `carregarMsgs()`, `_marcarLidoPC()` |
| `mensagem` + `INSERT` | GET pontual do `remetente` da última mensagem do ticket → som se veio do TI |
| `ticket` + `UPDATE` | GET pontual do `status` do chamado (o PC vê o seu) → som se encerrado; `carregarChamados()` + `carregarMsgs()` |

Fora do modal de chat, a lista de chamados do PC/professor **não tem canal
próprio** — depende do poll de 30 s (`_iniciarPollPC`). Intencional: o aluno
normalmente está com o chat aberto quando importa acompanhar em tempo real.

### `painel-logs.js`

**Não mudou.** O canal `logs-realtime-all` assina as tabelas `*_log` e
`sessao_ativa` diretamente — elas continuam com SELECT aberto, então o
Realtime as entrega normalmente. Ver a versão anterior deste documento no
histórico do git para a tabela detalhada de eventos de log.

## Fallback por poll

Mesmo com `realtime_sinal` entregando, os polls continuam como **rede de
segurança para queda de WebSocket**:

| Poll | Intervalo | Observação |
|---|---|---|
| Listas do painel T.I. (`_pollTI`) | 30 s | também cobre equipe/PCs, que não têm sinal |
| Lista do painel do PC (`_iniciarPollPC`) | 30 s | único caminho "ao vivo" da lista fora do chat |
| Chat T.I. (`_iniciarPollChatTi`) | 15 s | era 5 s; com o sinal funcionando ninguém nota |
| Chat PC (`_iniciarPollChatPc`) | 15 s | idem; só roda com o modal aberto |

Todos param quando a aba vai para segundo plano (`document.hidden`).

## Por que equipe T.I./professores não são realtime

`usuario_ti` tem coluna `senha` e `professor` tem `senha_hash` (e `usuario_ti`
também tem `email`). O Postgres Realtime transmite **a linha inteira** para
qualquer cliente inscrito, sem filtro de coluna. Publicar essas tabelas
vazaria hash de senha e e-mail para qualquer um com a anon key. Por isso elas
nunca entraram na publication `supabase_realtime`, e a mesma regra vale para a
tabela de sinal: `realtime_sinal` só existe porque **não** carrega nada
sensível. Equipe T.I./professores atualizam via poll de 30 s.

## Diagnosticando problemas

1. **Console do navegador**: toda subscription loga via `rtStatusHandler`
   (`[realtime:tickets-realtime] conectado às 14:32:01`). `falhou
   (CHANNEL_ERROR)` / `falhou (TIMED_OUT)` = canal caiu.
2. **Indicador "AO VIVO"** (painel T.I. e de logs): verde = conectado,
   vermelho = erro/timeout, amarelo = conectando.
3. **A tabela de sinal está viva?** Com qualquer client (a anon key basta):
   `select * from realtime_sinal order by id desc limit 20;` — deve crescer a
   cada chamado aberto ou mensagem enviada. Se não cresce, o problema está nos
   **triggers** (`trg_sinal_ticket` / `trg_sinal_mensagem`), não no front.
4. **A publicação inclui a tabela?**
   `select * from pg_publication_tables where pubname='supabase_realtime' and
   tablename='realtime_sinal';` — uma linha esperada.
5. **DevTools → Network → WS**: procure `wss://<projeto>.supabase.co/realtime/
   v1/websocket`; `phx_reply` com `"status":"ok"` confirma o canal recebendo.
6. **Fallback por poll**: mesmo com o Realtime todo fora do ar, os painéis
   sincronizam pelos polls acima — dados nunca ficam presos, só mais lentos.
7. **Antes de suspeitar do código: confirme que o deploy está atualizado.**
   `git log origin/main -1` vs. `git log -1` — se divergirem, o site publicado
   roda código antigo.

## Testando

- `tests/realtime-sinal.test.js` (runner nativo do Node, sem dependências)
  cobre: os triggers geram o sinal certo para INSERT/UPDATE de ticket e
  mensagem; a tabela é legível sem token mas só expõe
  `{id, canal, ref_id, evento, em}`; escrita pela API é recusada (anon e T.I.).
- O que os testes REST **não** cobrem: a entrega pelo WebSocket em si e o
  re-render do painel. Verificação manual: abra dois navegadores, dispare um
  evento num e observe o outro atualizar em < ~2 s.

## Fora do escopo (deliberadamente sem realtime)

- **Dashboard do painel de logs** (Chart.js): atualização manual.
- **Grade de computadores** (`carregarPCs()`): coberta pelo poll de 30 s.
- **Lista de chamados fora do modal de chat** (painel do PC): ver nota acima.

## Arquivos relevantes

- `supabase/migrations/20260828120000_realtime_sinal_recupera_ao_vivo.sql` —
  tabela de sinal, triggers, publicação
- `js/realtime-manager.js` — `rtStatusHandler()`
- `js/painel-ti.js` — canais `tickets-realtime` + `chat-ti-{id}`, coalescing
- `js/painel-pc.js` — canal `chat-pc-{id}`
- `js/painel-logs.js` — canal `logs-realtime-all` (inalterado)
- `tests/realtime-sinal.test.js` — regressão dos triggers e do shape da tabela
