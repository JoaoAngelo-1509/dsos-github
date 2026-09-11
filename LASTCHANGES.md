# Últimas alterações — DSos v2.0

## 2026-09-02 — Correção dos filtros do painel de logs, do chat do PC e da avaliação

Leva de correção dos problemas relatados em uso. Cada item abaixo foi
reproduzido antes de ser corrigido — os que dependiam do banco estão com o
número de linhas que provou o defeito.

### Painel de logs — filtros de data (todas as abas)

- **Toda janela de data saía deslocada em 3 horas.** O `<input type="date">`
  devolve o dia LOCAL (`2026-09-02`) e a string ia crua para o PostgREST, que
  a lê como `00:00 UTC`; como o banco roda em UTC e o usuário está em UTC−3,
  "Hoje" trazia as linhas a partir das 21h de ontem e cortava as de hoje
  depois das 21h. Agora `limiteDoDiaLocal()` converte o dia escolhido para o
  instante em que ele começa e termina no fuso do usuário.
  Medida em `alteracoes_criticas_log`: filtrar 22/08 → 22/08 devolvia **3
  linhas**; devolve **6**. As três que faltavam são as de 22/08 às 22:26 e
  22:44 — gravadas como 23/08 em UTC, e exibidas na tela como 22/08.
  O BUG-08 já havia acertado *qual dia é hoje* no navegador; faltava o outro
  lado, a conversão do dia para instante.
- **"24h" foi substituído por "7 dias", e "Semana" por "30 dias".** Os atalhos
  escrevem nos dois campos de data e só conseguem expressar dias inteiros: o
  botão "24h" escrevia a data de ontem, o que dá uma janela entre 24h e 48h
  conforme a hora do clique, e "Semana" voltava 7 dias a partir de hoje,
  pegando 8. Agora `QUICK_RANGES` define a janela em dias inteiros, contando o
  de hoje.

### Painel de logs — aba Atividades

- **Os filtros Módulo e Impacto não devolviam nada.** As opções estavam fixas
  no HTML (`tickets`/`pcs`/`usuarios`, `baixo`/`médio`/`alto`) e nenhuma delas
  existe na tabela: `modulo` guarda `Chat`, `Usuários`, `Computadores`,
  `Professores`, `mensagens`, `usuarios_ti`, `Tickets`. As opções passam a ser
  lidas do próprio banco quando a aba abre (`popularSelectsDinamicos`).
- **`impacto` não é um nível de impacto.** A coluna guarda o TIPO do evento
  (`novo_comentario`, `alteracao_status`, `pc_deletado`…). O filtro, a coluna
  da tabela, o campo do modal e o CSV foram renomeados para **Evento**, e o
  KPI "Alto impacto" — que contava `impacto === 'alto'` e por isso mostrava 0
  desde sempre — virou "Evento mais frequente".
- **Grafias diferentes do mesmo módulo eram filtros diferentes.** A tabela tem
  `Tickets` (62 linhas) e `tickets` (3). O operador `ieq` (novo) compara sem
  diferenciar maiúsculas, e a lista de opções agrupa as grafias: escolher
  "Tickets" devolve as **65**.

### Painel de logs — aba Críticas

- **A função "Aprovado" foi removida.** Nenhuma tela do sistema jamais marcou
  uma alteração como aprovada: as 13 linhas da tabela nascem com
  `aprovado=false` e não existe RPC nem botão que mude isso. O badge dizia
  "⚠ Pendente" em 100% das linhas, o filtro "Aprovado: Sim" devolvia sempre
  zero e o KPI "Aprovados" ficava preso em 0. Saíram o filtro, a coluna, o
  campo do modal e os KPIs "Pendentes"/"Aprovados".
  No lugar da coluna entrou **Motivo**, que antes só aparecia abrindo o
  registro; e os KPIs passaram a ser total, hoje, tabela mais alterada e
  usuário mais ativo. A coluna `aprovado` continua no banco, sem uso — se um
  dia houver um fluxo de revisão de verdade, ela está lá.

### Painel do PC/professor — chat e tempo real

- **Nada era "ao vivo" com o modal fechado.** O único canal realtime da tela
  era criado ao ABRIR um chamado e destruído ao fechar; fora disso a lista
  "Meus Chamados" e o contador de não lidas dependiam só do poll de 30s. Daí
  os dois sintomas: resposta do T.I. sem aviso nenhum, e chamado resolvido
  continuando "Em andamento" por até meio minuto. Agora existe
  `_iniciarRealtimePC()`, um canal que vive a página inteira e espelha o
  `tickets-realtime` do painel T.I. — escuta `realtime_sinal` e re-busca pelo
  REST, sem trafegar conteúdo pelo WebSocket.
- O canal do modal deixou de tratar mudança de status: os dois reagiam ao
  mesmo sinal e o resultado era `carregarChamados()` em dobro e som duplicado.
- Com o modal aberto, encerrar o chamado pelo T.I. agora atualiza o cabeçalho
  e desabilita o chat na hora (`_atualizarCabecalhoModal`, extraída de
  `_abrirModal`).

### Painel do PC/professor — imagens e câmera

- **Todo upload de imagem falhava com 403.** O `_uploadImg` mandava
  `x-upsert: true`, e o upsert do Storage lê a linha antiga em
  `storage.objects` antes de gravar — o bucket `chat-prints` só tem policy de
  `INSERT`, então a leitura era negada e a resposta era
  `new row violates row-level security policy`. O header foi removido (não
  servia para nada: o nome do arquivo já leva `Date.now()` + sufixo
  aleatório). Mesma correção em `painel-ti.js`. O erro do Storage agora chega
  ao usuário em vez de virar "Upload falhou".
- **A câmera estava desligada no `netlify.toml`.** O header
  `Permissions-Policy: camera=()` faz o navegador negar `getUserMedia` antes
  mesmo de perguntar ao usuário — e o defeito só aparecia em produção, porque
  em localhost não há Permissions-Policy. Passou a `camera=(self)`; microfone
  e geolocalização seguem bloqueados.
- **Tirar a foto não fazia nada.** `capturarFoto()` chamava
  `window.previewImagens()`, que não existe em lugar nenhum, sobre um input
  `#img-input` que também não existe (o do HTML é `#file-input-chat`). A foto
  agora entra pelo mesmo caminho de uma imagem escolhida no seletor de
  arquivos. Também há guarda para captura antes do primeiro quadro e mensagens
  de erro por motivo (permissão negada, sem câmera, câmera em uso).

### Modal de avaliação (painel do PC)

- **O texto era ilegível no tema claro.** O card usava `--card-bg`,
  `--glass-b`, `--input-bg` e `--muted`, que **nenhum** dos CSS carregados por
  `painel-pc.html` define — são variáveis do painel-ti e do painel-logs. Todas
  caíam no valor de fallback, todos escuros; mas `--text` existe ali e vale
  `#2a2a2a` no tema claro. Resultado: card preto com texto quase preto. Agora
  usa os tokens do próprio painel (`--gray-card`, `--gray-border`,
  `--gray-input`, `--text-muted`), que têm valor nos dois temas.

### Sessões: duração fantasma e inatividade por tipo de máquina

- **Sessão fechada sem logout continuava "ao vivo", com o cronômetro subindo.**
  O `beforeunload` + `sendBeacon` que deveria chamar `rpc_sessao_encerrar` não
  é garantido — o navegador descarta a aba, mata o processo ou a máquina é
  desligada no fim da aula, e o beacon nunca sai. O mecanismo de reserva
  (`rpc_limpar_sessoes_mortas`, que apaga quem não dá ping há 5 min) existia,
  mas era chamado de **um lugar só**: ao abrir o painel de logs. Com o painel
  já aberto e mais ninguém online, nada rodava a limpeza, e a coluna DURAÇÃO
  da aba Acessos contava indefinidamente — ela conta no cliente a partir do
  horário do login e não tem como saber que a sessão acabou.
  Medido: uma sessão parada há 7min29 (limiar 5 min) ainda estava na tabela, e
  o painel exibia 9min46 e subindo.
  - **Frontend:** o painel de logs passa a varrer as sessões a cada 60s
    (`_iniciarPollSessoes`), pausando com a aba em segundo plano e revarrendo
    ao voltar para ela.
  - **Banco:** `supabase/migrations/20260902120000_sessao_ping_poda_sessoes_mortas.sql`
    faz o próprio `rpc_sessao_ping` chamar a limpeza. Como o ping roda a cada
    30s em toda aba aberta, basta uma pessoa online em qualquer painel para a
    tabela se manter limpa — mesmo padrão que `fn_emitir_sinal_realtime` já usa
    para podar `realtime_sinal`. **Ainda não aplicada no banco.**

- **O logout por inatividade agora depende da máquina, não do papel.** O
  `session-guard.js` (aviso + logout automático) já existia e cobria as três
  telas com 30 min fixos. Os tempos passaram a ser configuráveis
  (`timeoutMs` / `avisoMs`), e o **painel do PC/professor caiu para 10 min,
  com aviso aos 8** — aquelas telas rodam nas máquinas do laboratório, que são
  públicas e trocam de usuário ao longo do dia, então sessão esquecida aberta
  fica à disposição do próximo que sentar. Painel T.I. e painel de logs
  mantêm 30 min: a máquina é de uso pessoal e deslogar alguém no meio do turno
  atrapalha mais do que protege.
  O countdown do banner passou a derivar de `avisoMs` — era fixo em `2:00`, e
  com janelas diferentes por painel mostraria um número que não bate com o
  logout de verdade.

- **Nota:** o aviso "você está aí?" **não resolve aba fechada** — sem JS
  rodando não há timer para disparar. Os dois problemas são independentes: o
  guard cobre "aba aberta e parada"; o heartbeat + poda cobre "aba fechada".

### Storage de prints: quem apaga, e um endpoint que estava aberto

- **🔴 `fn-limpar-dados` aceitava chamada de qualquer um.** A Edge Function que
  o painel T.I. usa na aba Manutenção subiu com `verify_jwt: false` e sem
  nenhuma verificação no corpo. Ela roda com a `SERVICE_ROLE_KEY`, que ignora a
  RLS inteira — então um `curl` sem apikey, sem Authorization e sem token
  respondia `200`, e com `apenas_preview: false` apagaria todos os chamados
  encerrados, mensagens e imagens do projeto, de qualquer lugar da internet.
  Confirmado com chamada real (só no modo preview, que não apaga nada).
  Agora exige `X-Sessao-Token` de sessão **de T.I.** válida, checada contra
  `sessao_token` — mesma regra de `fn_sessao_do_token()` mais a exigência do
  papel. Sem token → 401, token forjado → 401, token de PC/professor → 403.
  Registrada como **L10** em `docs/regras-de-acesso.md`, com a nota de que a
  auditoria anterior não a tinha encontrado.
  `verify_jwt` segue `false` de propósito: o projeto não usa Supabase Auth,
  não existe JWT de usuário.

- **Prints órfãos não tinham como ser apagados.** A limpeza por período só
  alcança a imagem enquanto a linha em `mensagem` existe; quando o chamado é
  apagado, o arquivo fica no bucket sem nada apontando para ele e nenhuma
  rotina do sistema volta a vê-lo. A anon key também não tem `DELETE` no
  storage, então não havia caminho nenhum por dentro do sistema.
  Medido: **32 arquivos, 11 MB, 100% órfãos** — e a limpeza "Todos" reportava
  `imagens_count: 0`.
  Nova ação `acao: 'orfaos'` na Edge Function e nova seção **"Prints órfãos no
  storage"** na aba Manutenção, com preview (órfãos / MB / em uso / total)
  antes de confirmar, no mesmo padrão da limpeza que já existia.
  - Arquivo enviado há menos de **1 hora nunca é apagado**: o cliente sobe a
    imagem e só depois insere a linha em `mensagem`, então sem essa carência
    uma limpeza no momento errado apagaria o print em pleno envio.
  - O preview conta `referenciados` e `recentes_protegidos` separado. Juntar os
    dois num "em uso" fazia o painel dizer "1 em uso" num bucket onde nenhuma
    mensagem tem imagem.

- **As Edge Functions não estavam no repositório.** `supabase/functions/` só
  tinha `groq-proxy`; `fn-limpar-dados` e `fn-enviar-otp` existiam só na nuvem
  — foi por isso que a falha acima passou despercebida na auditoria.
  `fn-limpar-dados` agora está versionada. Registrado como **L11**.

- Corrigido de quebra: o cálculo de MB liberados na limpeza por período usava
  `storage.list()` sem paginação e só enxergava os 100 primeiros arquivos, então
  reportava menos espaço do que realmente liberava assim que o bucket passasse
  de 100 objetos.

- **🔴 `fn-enviar-otp` era uma função morta publicada com service_role.** O 2FA
  foi removido do projeto em agosto/2026 — a tabela `otp_ti` e as RPCs
  `rpc_gerar_otp_ti`/`rpc_verificar_otp_ti` não existem mais (confirmado no
  banco). **A Edge Function não saiu junto:** ficou sete meses no ar, chamável
  sem autenticação, montando cliente com a `SERVICE_ROLE_KEY`. Não havia dano
  possível — sem a RPC ela morria com `500` —, mas devolvia o erro cru do
  PostgREST, vazando nomes internos do schema.
  Republicada como **stub que responde 410** e não importa nada do Supabase.
  Registrada como **L12**. Falta deletar a função de vez pelo painel.

- **Heartbeat de sessão passou a podar sessões mortas** (migration
  `20260902120000`, **aplicada no banco**). `rpc_sessao_ping` agora chama
  `rpc_limpar_sessoes_mortas`. Verificado: com uma sessão parada há 30 min na
  tabela, um único ping de outra sessão a removeu.

- **Pendências:**
  - Os 31 prints órfãos continuam no bucket — o botão está pronto, apagar é
    decisão de quem opera.
  - `fn-enviar-otp` precisa ser **deletada** pelo painel do Supabase (o stub só
    a torna inofensiva).
  - **Trocar a chave da Groq** — ver abaixo.

### Ordem do login invertida, e a groq-proxy fechada (L7)

- **Qualquer pessoa consumia a cota da Groq do projeto** só abrindo a tela de
  login e digitando um nome: `validarNome` chamava a IA **antes** de conferir
  qualquer credencial, e a `groq-proxy` aceitava só a anon key (que é pública).
  A correção óbvia — exigir token — quebraria o login, porque naquele ponto o
  token ainda não existe. Limite por IP também não servia: **num laboratório a
  sala inteira sai pelo mesmo IP público**, então o limite seria compartilhado e
  a turma travaria no começo da aula.
  A ordem foi invertida: `_autenticar()` confere a senha primeiro, o nome é
  validado depois, já com o token emitido. Aí a `groq-proxy` passou a exigir
  sessão viva em todas as chamadas.
  Testado no navegador, com usuário real criado e removido em seguida:

  | caso | chamadas à Groq | resultado |
  |---|---|---|
  | senha errada | **0** | "Usuário ou senha incorretos", sem sessão |
  | senha certa + nome real | 1 | entra e vai para o painel |
  | senha certa + nome falso | 1 | recusa, sem sessão, botão volta a "Entrar" |

  Efeito colateral aceito: nome falso **e** senha errada agora dá "usuário ou
  senha incorretos". É melhor — o sistema para de comentar o nome de quem nem
  provou ter conta.

- A validação usa a nova RPC `rpc_sessao_valida` (migration `20260902130000`,
  **aplicada**), que devolve só o papel do dono do token. A `groq-proxy`
  deliberadamente **não** recebeu a `SERVICE_ROLE_KEY`: ela recebe texto
  arbitrário do usuário e repassa a um terceiro, é o último lugar onde se quer
  a chave mestra.

- **🔴 A chave da Groq estava embutida no código da função publicada.** A v3
  trazia um `GROQ_KEY_FALLBACK` em texto puro, e ele era a única fonte da
  chave: descobri ao publicar a versão limpa e ver toda chamada responder
  `500 GROQ_KEY nao configurada` — **o secret nunca foi configurado**.
  A chave nunca foi commitada (conferido em todo o histórico do git) e não vai
  para o navegador, então não houve vazamento público. Registrada como **L13**.
  **Resolvido no mesmo dia:** o secret `GROQ_KEY` foi configurado e a versão
  limpa do repositório publicada (v7) — sem fallback, secret como única fonte.
  Conferido no código publicado: não há mais chave nenhuma, e repositório e
  nuvem voltaram a bater. Se o secret sumir, a função passa a responder
  `500 GROQ_KEY nao configurada` em vez de esconder o problema num fallback.

- **Pendência do operador:** se a chave cadastrada como secret for nova,
  **revogar a antiga** no painel da Groq.

### Termos de uso e política de privacidade

- **"Voltar ao login" mandava para o login mesmo quem já estava logado**, que
  perdia o caminho de volta. As páginas são linkadas do rodapé dos três
  painéis, não só do login. Com sessão ativa o link passa a apontar para o
  painel de quem está logado — "Voltar aos meus chamados" para aluno e
  professor, "Voltar ao painel" para o T.I. Sem sessão, continua indo para o
  login.

## 2026-08-29 — Conformidade: UML, regras de acesso, políticas e reportar problema

Leva de documentação e conformidade prevista em
`docs/plano-conformidade.plan.json`, na ordem do plano.

### Documentação

- **`docs/regras-de-acesso.md`** — matriz papel × recurso × ação (aluno,
  professor, T.I., conta dupla, anônimo), como o acesso é imposto nas três
  camadas (RLS por token de header, RPCs `SECURITY DEFINER`, privilégio de
  coluna), fronteiras de confiança e **nove lacunas conhecidas** com risco
  residual. Duas merecem atenção: as tabelas `*_log` continuam com `SELECT`
  aberto (L2) e o bucket `chat-prints` é público (L3).
- **`docs/uml/`** — sete diagramas em Mermaid (renderizam no GitHub, versionam
  como texto): casos de uso, entidades, componentes, sequências de abrir
  chamado / emergência / realtime, e a máquina de estados do chamado. Todos
  derivados do schema e do código, com as simplificações declaradas.

### Conformidade LGPD

- **`html/politica-privacidade.html`** e **`html/termos-de-uso.html`**, com
  `css/legal.css` compartilhado (inclui layout de impressão, para anexar ao
  TCC). Linkados do consentimento do `index.html`, do rodapé do login e de uma
  faixa discreta nos três painéis (`.legal-fixed`, em `base.css`).
- A política declara **exatamente** o que sai para a Groq em cada momento —
  inclusive que **o nome digitado no login é enviado** — e que a IA pode
  recusar a abertura de um chamado, o que é decisão automatizada sujeita a
  revisão (art. 20 da LGPD).
- Os termos contratuais da Groq foram conferidos e resumidos na política, com
  link: o contrato de serviço **proíbe** usar entradas e saídas para treinar ou
  ajustar modelos, e a retenção é de no máximo 30 dias, só para investigar erro
  ou abuso. Há um modo de retenção zero — ativá-lo fica como decisão para a
  implantação real.
- Registra também que a coluna `ip_address` das tabelas de log **não guarda
  IP**: `logging.js` grava ali um fingerprint do dispositivo (navegador, SO,
  resolução, idioma, fuso).
- **Os dois documentos assumem o que o projeto é: um protótipo acadêmico.**
  Não há instituição controladora, CNPJ nem encarregado de dados — e inventá-los
  seria pior que declarar a ausência. O controlador na fase atual são os três
  autores, nomeados; a política explica que a instituição que vier a adotar o
  sistema assume esse papel, e o que ela terá de definir.
- O que depende dessa adoção (prazos de retenção, foro, licença do código,
  encarregado) aparece como *a definir na implantação*, em itálico discreto —
  não como badge de "preencher". São 9 pontos na política e 4 nos termos, todos
  justificados no texto.
- **Sem eleição de foro**, e isso é deliberado: cláusula de foro pressupõe
  partes contratantes definidas. Sem licença declarada, vale a Lei 9.610/1998 —
  direitos reservados aos autores por padrão.
- A seção de retenção declara o que o código realmente faz hoje: **nada é
  apagado automaticamente**; a limpeza só roda quando um técnico a aciona.
  Prometer prazo que o sistema não cumpre seria o defeito mais grave que uma
  política de privacidade pode ter.

### Reportar problema

- Botão flutuante nos três painéis abre um modal de reporte sobre o próprio
  sistema. Contexto técnico coletado é mostrado antes do envio; captura de tela
  é **opt-in e vem desmarcada**, com aviso de que pode conter dado de terceiro.
- `js/reportar-problema.js` injeta o próprio markup — os painéis só ganharam um
  `import`, uma chamada e o `<link>` do CSS.
- Migration `20260829120000_reportar_problema` (com ROLLBACK): tabela
  `problema_reporte`, `rpc_reportar_problema` (valida token, rate limit de 3
  por 10 min, identidade vem da sessão), `rpc_reportes_listar` e
  `rpc_reporte_status`. Leitura só com sessão de T.I.
  **Aplicada no banco de TESTE** e validada (14 casos: token ausente/forjado,
  INSERT direto negado, leitura por papel, rate limit, identidade vinda da
  sessão, triagem). Produção pendente de aprovação.
- A captura ficou **na tabela**, não em bucket: a API de Storage avalia a RLS
  sem o header `X-Sessao-Token`, então um bucket "privado" seria legível por
  qualquer um com a anon key. Detalhe em `docs/reportar-problema.md`.
- `js/vendor/html2canvas.min.js` vendorizado (1.4.1, MIT). Não exigiu mudança
  na CSP — `script-src` já tem `self`. Captura testada ponta a ponta: 1100x700
  vira JPEG de 1024px com ~14 KB, bem abaixo do teto de 1,2 MB da RPC.

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
