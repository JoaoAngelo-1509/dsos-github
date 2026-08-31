# DSos — Regras de acesso

> Documento de referência do **modelo de autorização** do DSos: quem pode fazer
> o quê, e **como isso é imposto tecnicamente**. Serve de base para o capítulo
> de segurança do TCC e para revisar qualquer mudança que toque permissão.
>
> Estado descrito: schema de produção conforme
> `supabase/migrations/20260101000000_baseline_schema.sql` mais as migrations
> posteriores (`sec*`, `20260828120000_realtime_sinal_recupera_ao_vivo`).
> Toda afirmação aqui foi conferida no SQL versionado ou no código do
> frontend — onde houver divergência entre este texto e o banco, **o banco
> está certo e este documento está desatualizado**.

---

## 1. Papéis

O DSos **não usa Supabase Auth**. Não existem usuários do Postgres por pessoa:
todo mundo — aluno, professor, técnico e visitante anônimo — fala com a API
usando a **mesma `anon key`**, que é pública por definição (vai no bundle do
site). Portanto o papel não vem da credencial do banco; vem de um **token de
sessão** emitido no login e apresentado a cada requisição.

| Papel | Como nasce | `sessao_token.usuario_tipo` | Onde vive |
|---|---|---|---|
| **Aluno (PC)** | `rpc_login_pc(tag, senha)` — credencial do computador do laboratório | `pc` | `painel-pc.html` |
| **Professor** | `rpc_login_professor(login, senha)` — credencial pessoal | `professor` | `painel-pc.html` |
| **Técnico T.I.** | `rpc_login_ti(login, senha)` | `ti` | `painel-ti.html`, `painel-logs.html` |
| **Conta dupla (T.I. + Professor)** | `rpc_login_ti` em conta com `is_professor = true` e `professor_id` preenchido; a tela pergunta em qual papel entrar | `ti` **em ambos os casos** (ver nota) | painel conforme a escolha |
| **Anônimo** | ninguém — é quem tem a `anon key` e não fez login | `NULL` | — |

> **Nota sobre a conta dupla.** Quando o usuário escolhe "entrar como
> professor", `js/auth.js` grava `tipo: 'professor'` e `id: professor_id` na
> sessão do navegador, mas **reaproveita o token emitido por `rpc_login_ti`** —
> ou seja, para o banco a sessão continua sendo `usuario_tipo = 'ti'`. O efeito
> é que a conta dupla, mesmo "vestida de professor", enxerga tudo pelas
> policies de T.I. Isso é deliberado (o token prova um login legítimo de T.I.,
> e não faria sentido rebaixá-lo), mas precisa ser lido como: **conta dupla é,
> para efeito de autorização no banco, sempre T.I.**

---

## 2. Como o acesso é imposto — as três camadas

```
Navegador                       PostgREST / Postgres
─────────                       ────────────────────
sessionStorage.dsos_session     (1) RLS lê o header via fn_sessao_*()
  { tipo, id, nome, token }     (2) RPC SECURITY DEFINER valida o token
        |                       (3) GRANT de coluna esconde segredo
        |  fetch interceptado
        v  (js/sessao-header.js)
  X-Sessao-Token: <64 hex> ---------->
```

### 2.1 Login e emissão do token

`js/auth.js` tenta os três logins em sequência (T.I. → PC → professor). Cada um
é uma RPC `SECURITY DEFINER` que compara a senha com `extensions.crypt()`
(bcrypt) e, se bater, chama `fn_emitir_token()`:

* token = `encode(gen_random_bytes(32), 'hex')` — 64 caracteres hexadecimais;
* gravado em `public.sessao_token` com `expira_em = now() + 12 horas`;
* cada emissão aproveita para apagar tokens já vencidos.

`public.sessao_token` é a peça central do modelo e por isso é a tabela mais
fechada do banco: **RLS ligada, nenhuma policy, `REVOKE ALL` de `anon` e
`authenticated`**. Só as funções `SECURITY DEFINER` a enxergam. Se ela fosse
legível pela REST, qualquer pessoa leria o token de todo mundo e o esquema
inteiro perderia o sentido.

### 2.2 O token na requisição

`js/sessao-header.js` substitui `window.fetch` e anexa o header
`X-Sessao-Token` **apenas** a requisições cujo host contém `.supabase.co`.
Nada vaza para a Edge Function de terceiros nem para outro host.

Isso funciona porque o PostgREST publica os cabeçalhos HTTP no GUC
`request.headers`, e o gateway do Supabase ecoa o header no preflight CORS —
os dois pontos foram verificados em produção (ver cabeçalho da migration
`20260823170000_sec05b_fechar_leitura.sql`).

Do lado do banco, três funções `STABLE SECURITY DEFINER` traduzem o header em
identidade, e são sempre chamadas como `(SELECT fn())` nas policies para o
planner as avaliar **uma vez por query**, não uma vez por linha:

| Função | Devolve |
|---|---|
| `fn_sessao_token_header()` | o token cru do header, ou `NULL` fora do PostgREST |
| `fn_sessao_tipo()` | `'ti'` \| `'pc'` \| `'professor'` \| `NULL` |
| `fn_sessao_uid()` | `pc.id`, `usuario_ti.id` ou `professor.id` da sessão |
| `fn_sessao_nome()` | o nome gravado no login (chave do vínculo do professor) |

### 2.3 Leitura → RLS. Escrita → RPC.

A divisão é a regra de ouro do projeto:

* **Leitura** dos dados sensíveis passa por *policies* de `SELECT` que exigem
  token (seção 3).
* **Escrita** sensível não tem policy nenhuma — a RLS nega por padrão — e
  acontece só por RPCs `SECURITY DEFINER` que revalidam o token e o papel
  (`rpc_ti_atualizar_ticket`, `rpc_ti_atualizar_pc`, `rpc_avaliar_ticket`,
  `rpc_deletar_professor`, `rpc_cadastrar_*`, …).

> **Armadilha conhecida:** sem policy de `UPDATE`, o Postgres **não** levanta
> erro — ele simplesmente não encontra linha para atualizar, e o `PATCH`
> devolve `200` tendo alterado zero linhas. Qualquer teste de regressão precisa
> conferir `ROW_COUNT` e o valor do dado, não a ocorrência de exceção.

### 2.4 Segredos protegidos por privilégio de coluna/tabela

RLS não esconde coluna. Onde havia segredo na mesma tabela do dado público, a
proteção é de **privilégio**:

| Segredo | Como está protegido |
|---|---|
| `pc_senha.senha` | tabela separada, `REVOKE ALL`, RLS sem policy (`20260823120100`) |
| `professor.senha_hash` | `REVOKE SELECT` na tabela + `GRANT SELECT` coluna a coluna, menos essa (`20260823120000`) |
| `usuario_ti.senha` | mesmo padrão: sem `GRANT SELECT` na coluna |
| `sessao_token.token` | `REVOKE ALL` + RLS sem policy |
| `GROQ_KEY` | secret da Edge Function; nunca chega ao navegador |

`pc.senha` precisou virar tabela separada porque é **estruturalmente
impossível** manter `UPDATE` funcionando em `pc` e esconder uma coluna dela ao
mesmo tempo: a ACL do Postgres só concede, não nega, e a policy de update fazia
subquery sobre a própria tabela. O raciocínio completo está no cabeçalho de
`20260823120100_mover_pc_senha_para_tabela_separada.sql`.

### 2.5 Sessão no navegador

* `initSessionGuard()` (`js/session-guard.js`) desloga por inatividade:
  **aviso aos 28 min, logout aos 30 min**. Está importado e ativo em
  `painel-pc.js`, `painel-ti.js` e `painel-logs.js`.
* Cada painel faz sua própria checagem de papel no `DOMContentLoaded` e
  redireciona para o login se `dsos_session` não bater
  (`painel-logs` e `painel-ti` exigem `tipo === 'ti'`; `painel-pc` aceita
  `'pc'` ou `'professor'`).
* **Essa checagem é conveniência de UI, não segurança.** `dsos_session` mora no
  `sessionStorage` e o próprio usuário edita. Quem trocar `tipo` para `'ti'` no
  console **abre o painel-ti** — mas não vê nada além do que o token dele
  permite, porque as policies olham o token, não o `sessionStorage`.
* Rate limit de login: 5 tentativas / 5 min → 60 s de bloqueio, no cliente
  (`auth.js`), complementado por `rpc_check_rate_limit` +
  `public.login_tentativas` no banco (tabela com policy `USING (false)`:
  ninguém lê direto).

---

## 3. Matriz de acesso — papel × recurso × ação

Legenda:
**OK** permitido · **NÃO** negado · **RPC** só através de RPC validada ·
**(!)** permitido, mas é lacuna conhecida (seção 5)

### 3.1 `public.ticket` — chamados

| Ação | Anônimo | Aluno (PC) | Professor | T.I. | Imposto por |
|---|---|---|---|---|---|
| `SELECT` | NÃO | OK — só onde `pc_origem` ou `pc_problema` = seu PC | OK — só onde `nome_solicitante` = seu nome | OK — todos | policy `ticket_select` |
| `INSERT` | **(!) OK** | OK | OK | OK | policy `ticket_insert` — `WITH CHECK (true)` |
| `UPDATE` | NÃO | NÃO (exceto avaliar) | NÃO (exceto avaliar) | RPC `rpc_ti_atualizar_ticket` | sem policy de UPDATE |
| avaliar (`avaliacao`) | NÃO | RPC `rpc_avaliar_ticket` | RPC | RPC | exige token válido de qualquer tipo e chamado já encerrado |
| `DELETE` | NÃO | NÃO | NÃO | RPC `rpc_limpar_tickets_antigos` / `rpc_executar_limpeza` | sem policy de DELETE |

`rpc_ti_atualizar_ticket` só aceita os campos da whitelist
`status, resolucao, resolvido_em, tecnico_responsavel, nota_interna,
prioridade, descricao_resolucao, item_descartado` — qualquer outro nome
levanta exceção. É o que impede a mesma chamada de servir para trocar
`pc_problema` ou `nome_solicitante` de um chamado alheio.

### 3.2 `public.mensagem` — chat do chamado

| Ação | Anônimo | Aluno | Professor | T.I. | Imposto por |
|---|---|---|---|---|---|
| `SELECT` | NÃO | OK — dos chamados que ele vê | OK — idem | OK — todos | policy `mensagem_select` (`EXISTS` sobre `ticket`, herdando `ticket_select`) |
| `INSERT` | **(!) OK** | OK | OK | OK | policy `mensagem_insert` — só valida que `remetente ∈ {PC, TI}` |
| marcar lido | OK | OK | OK | OK | RPCs `rpc_marcar_lido_pc` / `rpc_marcar_lido_ti` |
| `UPDATE` / `DELETE` direto | NÃO | NÃO | NÃO | NÃO | sem policy |

A regra do chat é **derivada** da regra do chamado, de propósito: uma cópia da
lógica sairia de sincronia com a original algum dia.

### 3.3 `public.pc` e `public.pc_senha` — inventário e senha do computador

| Recurso / Ação | Anônimo | Aluno | Professor | T.I. |
|---|---|---|---|---|
| `pc` `SELECT` | NÃO | OK — todos | OK — todos | OK — todos |
| `pc` `INSERT` | NÃO | NÃO | NÃO | RPC `rpc_cadastrar_pc` |
| `pc` `UPDATE` | NÃO | NÃO | NÃO | RPC `rpc_ti_atualizar_pc` (`status_pc`, `laboratorio`, `lado`) |
| `pc` `DELETE` | NÃO | NÃO | NÃO | RPC `rpc_deletar_pc` |
| `pc_senha` qualquer ação | NÃO | NÃO | NÃO | NÃO — nem o T.I. lê; só grava via RPC |

`pc` **não** é particionado por dono: qualquer sessão válida lista o parque
inteiro. Isso é necessário — o chamado de emergência procura *outro*
computador pela tag, e o painel-ti embute `pc(tag, status_pc)` nas listagens.
O conteúdo é inventário (tag, laboratório, lado, status), sem dado pessoal; a
senha está em outra tabela. Exigir sessão tira do anônimo o mapa completo das
máquinas da escola.

### 3.4 `public.professor` e `public.usuario_ti` — pessoas

| Recurso / Ação | Anônimo | Aluno | Professor | T.I. |
|---|---|---|---|---|
| `professor` `SELECT` | NÃO | NÃO | NÃO — nem o próprio | OK |
| `professor` `INSERT` / `UPDATE` | NÃO | NÃO | NÃO | RPC `rpc_cadastrar_professor` / `rpc_atualizar_professor` |
| `professor` `DELETE` | NÃO | NÃO | NÃO | RPC `rpc_deletar_professor` — recusa se houver chamado aberto |
| `professor.senha_hash` leitura | NÃO | NÃO | NÃO | NÃO |
| `usuario_ti` `SELECT` | NÃO | OK | OK | OK |
| `usuario_ti.senha` leitura | NÃO | NÃO | NÃO | NÃO |
| `usuario_ti` `INSERT` / `UPDATE` | NÃO | NÃO | NÃO | RPC `rpc_cadastrar_ti` / `rpc_atualizar_ti` / `rpc_set_presenca` |
| `usuario_ti` `DELETE` | NÃO | NÃO | NÃO | RPC `rpc_deletar_ti` + trigger `fn_impedir_ultimo_ti` |

`professor` é a tabela mais fechada das duas porque a coluna `login` viaja
junto: deixá-la aberta entregaria a lista de usuários válidos do sistema.
`usuario_ti` **não** pôde ser fechada em `'ti'` — o painel-logs embute
`usuario_ti(nome)` do técnico responsável e o painel-pc mostra o nome do
técnico nas mensagens. Sessão válida é o mínimo que dá para exigir ali.

`fn_impedir_ultimo_ti` é um trigger `BEFORE DELETE`: o sistema nunca fica sem
nenhum técnico cadastrado.

### 3.5 Tabelas de auditoria (`*_log`, `auditoria_ti`)

`acesso_log`, `atividades_log`, `audit_log`, `alteracoes_criticas_log`,
`operacoes_massa_log`, `auditoria_ti`.

| Ação | Anônimo | Aluno | Professor | T.I. |
|---|---|---|---|---|
| `SELECT` | **(!) OK** | **(!) OK** | **(!) OK** | OK |
| `INSERT` | OK — é assim que o app registra | OK | OK | OK |
| `UPDATE` | NÃO — `USING (false)` | NÃO | NÃO | NÃO |
| `DELETE` | NÃO — `USING (false)` | NÃO | NÃO | RPC `rpc_limpar_logs` |

O **append-only** é real e é a parte forte deste bloco: as policies
`*_no_update` / `*_no_delete` com `USING (false)` impedem que alguém apague o
próprio rastro pela REST. Quem limpa é `rpc_limpar_logs`, chamada só pelo
painel-logs.

A leitura, porém, está aberta — é a lacuna **L2** da seção 5.

> **Detalhe importante para a política de privacidade:** a coluna
> `ip_address` dessas tabelas **não guarda endereço IP**. `js/logging.js`
> preenche esse parâmetro com um *fingerprint* do dispositivo —
> `navegador | SO | resolução | idioma | fuso horário`. O nome da coluna
> permaneceu por contrato com as RPCs já existentes no banco.

### 3.6 Sessão e sinal de realtime

| Recurso | `SELECT` | Escrita | Observação |
|---|---|---|---|
| `sessao_token` | NÃO — ninguém | NÃO — ninguém | só funções `SECURITY DEFINER` |
| `sessao_ativa` | **(!) OK** — todos | RPCs `rpc_sessao_ping` / `rpc_sessao_encerrar` | expõe quem está online |
| `login_tentativas` | NÃO — `USING (false)` | RPC `rpc_registrar_tentativa` | rate limit |
| `realtime_sinal` | OK — todos, **por desenho** | só por trigger | ver abaixo |

`realtime_sinal` é aberta de propósito: é a única forma de o Supabase Realtime
entregar evento depois que a leitura de `ticket`/`mensagem` foi fechada. Ela
guarda **só metadado não sensível** (`canal`, `ref_id`, `evento`, `em`); o
conteúdo nunca trafega pelo WebSocket — o front recebe o aviso "o ticket X
mudou" e refaz o `fetch` pelo caminho REST normal, esse sim filtrado pelo
token. `tests/realtime-sinal.test.js` trava o formato da tabela justamente para
impedir que alguém acrescente ali uma coluna derivada de dado fechado.

### 3.7 Storage — bucket `chat-prints`

| Ação | Quem consegue |
|---|---|
| Upload | qualquer um com a `anon key` (policy `chat_prints_upload` em `storage.objects`) |
| Leitura | **qualquer pessoa na internet que tenha a URL** — o bucket é público |

As imagens do chat são enviadas para
`/storage/v1/object/chat-prints/<timestamp>-<random>.<ext>` e referenciadas
pela URL pública. Não há RLS por chamado: o segredo é só a aleatoriedade do
nome do arquivo. É a lacuna **L3** da seção 5 e precisa aparecer na política de
privacidade — foto de tela de um chamado pode conter dado pessoal.

### 3.8 Fila de descarte (PNRS)

Não é tabela própria: é a projeção dos `ticket` com `resolucao = 'descarte'`,
com `item_descartado` preenchido. Segue integralmente as regras de 3.1 —
listagem e confirmação do descarte físico só existem no painel-ti, e a
gravação passa por `rpc_ti_atualizar_ticket` / `rpc_confirmar_descarte_fisico`.
O registro serve à rastreabilidade exigida pela Lei 12.305/2010 (PNRS).

### 3.9 Páginas

| Página | Papel exigido | Como |
|---|---|---|
| `index.html` | nenhum | landing de consentimento |
| `html/login.html` | nenhum | única página que fala com o banco sem token (só as `rpc_login_*` e a Edge Function) |
| `html/painel-pc.html` | `pc` ou `professor` | checagem no `DOMContentLoaded` + policies |
| `html/painel-ti.html` | `ti` | idem |
| `html/painel-logs.html` | `ti` | idem |
| `404.html` | nenhum | não fala com o banco |

Repetindo, porque é o ponto mais fácil de entender errado: a checagem de página
é **cosmética**. O que impede um aluno de ler os chamados da escola inteira não
é o `if` do JavaScript — é a policy `ticket_select`.

> **O deploy publica mais do que as páginas.** `netlify.toml` usa
> `publish = "."`, então **todo arquivo versionado vai para o ar** — incluindo
> `docs/`, `supabase/migrations/`, `tests/` e `scripts/`. Sem proteção,
> `https://<site>/supabase/migrations/20260823170000_sec05b_fechar_leitura.sql`
> e este próprio documento seriam páginas públicas: o mapa completo do modelo
> de autorização e das brechas abertas, servido no mesmo domínio da aplicação.
>
> Desde 2026-08-29 há regras de `redirect` com `force = true` no
> `netlify.toml` que devolvem 404 para esses caminhos. **`force = true` é
> essencial**: sem ele, arquivo real tem prioridade sobre redirect e o
> bloqueio não acontece. Ao criar um `.md` novo na raiz do repositório,
> acrescente-o à lista.
>
> Isso é redução de exposição, não segredo — o repositório é público no
> GitHub. O ganho é não entregar o mapa a quem apenas tropeçar no site.

---

## 4. Fronteiras de confiança

```
+-- NÃO CONFIÁVEL --------------------------------------------+
| Navegador                                                   |
|  - anon key (pública), sessionStorage, todo o JavaScript    |
|  - qualquer valor daqui pode ter sido forjado               |
|  - o ÚNICO segredo confiável é o token de 32 bytes          |
+---------------+---------------------------------------------+
                | HTTPS + X-Sessao-Token
+---------------v--- SEMI-CONFIÁVEL --------------------------+
| PostgREST (gateway Supabase)                                |
|  - traduz REST em SQL como role `anon`                      |
|  - expõe os headers em request.headers                      |
+---------------+---------------------------------------------+
                |
+---------------v--- CONFIÁVEL -------------------------------+
| Postgres                                                    |
|  - RLS: decide o que a role `anon` enxerga                  |
|  - RPC SECURITY DEFINER: revalida token e papel             |
|  - GRANT de coluna: esconde segredo de todo mundo           |
+-------------------------------------------------------------+

+-- ISOLADO --------------------------------------------------+
| Edge Function `groq-proxy` (Deno)                           |
|  - guarda a GROQ_KEY como secret; nunca vai ao cliente      |
|  - NÃO valida token de sessão — exige só a anon key         |
|  - repassa `messages` para api.groq.com  <- saída de dados  |
+-------------------------------------------------------------+
```

Três consequências que valem escrever por extenso:

1. **Nada que venha do cliente autoriza coisa alguma.** Um `p_usuario_id` no
   corpo da requisição é informação, não credencial. Foi exatamente esse o erro
   corrigido pelo SEC-05.
2. **Toda função `SECURITY DEFINER` é um furo em potencial.** Ela roda como
   dona e ignora RLS. Ao fechar leitura por policy é obrigatório revisar todas
   elas: `rpc_nao_lidas_por_ticket` continuava devolvendo ids e volume de
   conversa de terceiros para quem não tinha token, e só foi pego por
   `tests/leitura.test.js`.
3. **A Edge Function é uma saída de dados para terceiro.** O texto do chamado
   sai da infraestrutura da escola e vai para a Groq. Isso é irrelevante para
   autorização e **central** para a política de privacidade
   (ver [politica-privacidade.html](../html/politica-privacidade.html)).

---

## 5. Lacunas conhecidas e risco residual

Estas são decisões conscientes ou dívidas registradas — não descobertas novas.
A defesa real do sistema está nas **RPCs e nos GRANTs**, não em toda policy ser
restritiva.

### L1 — `INSERT` de `ticket` e `mensagem` é aberto

`ticket_insert` é `WITH CHECK (true)` e `mensagem_insert` só confere que
`remetente ∈ {'PC','TI'}`. Qualquer pessoa com a `anon key` cria chamado e
manda mensagem sem nunca ter feito login, e pode escrever qualquer
`nome_solicitante` / `pc_origem`.

*Por que ficou assim:* fechar o `INSERT` exigiria mover a abertura de chamado
para uma RPC validada, mexendo no fluxo mais crítico do sistema.
*Mitigação atual:* `rpc_check_ticket_rate_limit` (janela de 5 min) limita
volume, e todo `INSERT` dispara trigger de auditoria.
*Risco residual:* poluição da base e chamados forjados em nome de terceiros —
não vazamento.

### L2 — Tabelas de log são legíveis por qualquer um

Todas as `*_log` têm `SELECT ... TO public USING (true)` e `GRANT SELECT` para
`anon`. Um `GET /rest/v1/acesso_log?select=*` com a `anon key` devolve nomes,
logins, horários e fingerprints de dispositivo de todo mundo.

*Por que ficou assim:* o SEC-05b fechou `ticket`/`mensagem`/`pc`/`professor`/
`usuario_ti`; as tabelas de auditoria ficaram para uma leva seguinte.
*Correção natural:* trocar por `USING ((SELECT fn_sessao_tipo()) = 'ti')`,
que é o mesmo padrão já usado em `professor_select`. O painel-logs lê a maior
parte dos dados por RPCs `SECURITY DEFINER`, então o impacto tende a ser
pequeno — mas precisa de teste de regressão nas 6 abas.
*Risco residual:* **é a maior exposição de dado pessoal em aberto hoje.**

### L3 — Bucket `chat-prints` é público

Ver 3.7. Quem tiver a URL de uma imagem a acessa sem sessão, para sempre.
*Correção natural:* bucket privado + URL assinada com validade.
*Risco residual:* imagem de chamado pode conter tela com dado pessoal.

### L4 — `sessao_ativa` é legível por qualquer um

Expõe quem está online, com login e nome. Baixo impacto isolado; soma-se a L2.

### L5 — Vínculo professor⇄chamado é por nome, não por id

`ticket` não tem `professor_id`; a policy casa `nome_solicitante` com
`fn_sessao_nome()`. **Um aluno que digite o nome de um professor cria um
chamado que aquele professor passa a enxergar.** Corrigir exige coluna nova e
migração dos dados existentes. Já registrado em `WORKFLOW.md`.

### L6 — Conta dupla é sempre T.I. para o banco

Ver a nota da seção 1. Um técnico que entra "como professor" continua
enxergando todos os chamados. Aceitável (a pessoa tem mesmo o privilégio), mas
o registro de auditoria vai dizer "professor" enquanto a autorização foi de
T.I.

### L7 — `groq-proxy` não valida sessão

Basta a `anon key` para usar a função — logo, para consumir a cota da Groq do
projeto. Não vaza dado do banco (a função não o consulta), mas é abuso de
recurso possível.
*Correção natural:* validar `X-Sessao-Token` na própria Edge Function.

### L8 — Checagem de papel no frontend é cosmética

Já dito em 2.5 e 3.9. Não é bug; é o desenho. Está aqui para que ninguém
"conserte" a segurança mexendo no `if` do JavaScript.

### L9 — Sem rotina automática de retenção

`rpc_limpar_tickets_antigos` (365 dias) e `rpc_executar_limpeza` (30 dias)
existem no banco mas **não são chamadas por nenhuma tela**; só
`rpc_limpar_logs` é, pelo painel-logs, sob ação manual do técnico. Na prática,
**o dado fica até alguém apagar**. Isso precisa ser resolvido — ou ao menos
declarado — na política de privacidade.

---

## 6. Como verificar que isto ainda é verdade

```bash
node tests/seguranca.test.js
```

```bash
node tests/leitura.test.js
```

```bash
node tests/realtime-sinal.test.js
```

(as três suítes precisam de `js/supabase-config.test.js` — ver
[SETUP.md](../SETUP.md))

No SQL Editor do Supabase, para conferir o estado real das policies e dos
privilégios de coluna:

```sql
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, cmd;

select table_name, column_name, grantee, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and grantee in ('anon','authenticated')
   and column_name in ('senha','senha_hash','token');
```

E os advisors do próprio Supabase (`get_advisors`, tipo `security`) a cada
mudança de schema.

---

## 7. Documentos relacionados

* [WORKFLOW.md](../WORKFLOW.md) — fluxo obrigatório para mudança de banco e
  dívida técnica em aberto
* [docs/uml/](uml/) — diagramas de casos de uso, entidades, componentes e
  sequências
* [docs/REALTIME.md](REALTIME.md) — arquitetura dos canais de tempo real
* [html/politica-privacidade.html](../html/politica-privacidade.html) — o que é
  tratado, com que finalidade e com quem é compartilhado
