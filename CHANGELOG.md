# DSos — Changelog

## [Não publicado]

### Segurança — fecha L2/L4 e retira a `fn-enviar-otp` (migration `20260911160000`, `painel-logs.js`, `diagnostico.js`)
- **CORRIGIDO** L2: as tabelas de log (`acesso_log`, `atividades_log`, `audit_log`, `alteracoes_criticas_log`, `operacoes_massa_log`, `auditoria_ti`) deixaram de ser legíveis por qualquer um com a anon key — o SELECT passou a exigir sessão de T.I. (`USING ((SELECT fn_sessao_tipo())='ti')`, mesmo padrão de `ticket_select`). Era a maior exposição de dado pessoal em aberto: 111 linhas de acesso (nomes, logins, horários, fingerprint de dispositivo) liam-se sem login
- **CORRIGIDO** L4: `sessao_ativa` (quem está online, com login e nome) idem — só T.I. lê
- **ALTERADO** Para não cegar o realtime do painel-logs (que roda como anon, sem o `X-Sessao-Token`), as mudanças dessas tabelas passaram a ser anunciadas por `realtime_sinal` — o mesmo fan-out sanitizado de ticket/mensagem (canal = nome da tabela, `ref_id = 0`, sem conteúdo); `painel-logs.js` assina o sinal e busca o dado por HTTP com token
- **REMOVIDO** Pasta `supabase/functions/fn-enviar-otp/` (L12): o 2FA saiu em agosto e a Edge Function ficou como stub `410`. Falta só deletar a função publicada na nuvem — passo de operador (`supabase functions delete fn-enviar-otp`)
- **ALTERADO** `diagnostico.js`: os testes de L2/L4 passam em ✅ e viram ❌ se a brecha reabrir; `api-otp` marca 404 (removida) como estado ideal

### Painel do PC — envio só depois da IA, lista "Meus chamados" e correções (`painel-pc.js`)
- **NOVO** No PC, o botão de envio fica travado até a IA responder sobre a descrição atual ("Descreva o problema para enviar" → "Aguardando a análise da IA…" → "Enviar chamado"). Antes dava para enviar durante a pausa de 2,5 s, a sugestão nunca aparecia e a classificação atrasada abria o card "tente antes de abrir" por cima do "Chamado aberto!". Chamada à IA com teto de 20 s, para a trava nunca ficar presa. Professor sem mudança: o envio dele já esperava a IA
- **ALTERADO** "Meus chamados": cartões com a descrição em destaque, status por extenso ("Um técnico está cuidando disso"), selo de mensagens novas, botão "Conversar com o T.I." e grupos "Em aberto" / "Encerrados"; telas vazias com botão para abrir chamado ou limpar a busca; a legenda de cores deu lugar a uma dica de uso
- **CORRIGIDO** Duplo clique em enviar abria dois chamados
- **CORRIGIDO** `pickTipo` zerava o resultado guardado da IA no instante em que a própria IA marcava o tipo: todo envio chamava a IA duas vezes (PERF-02 nunca funcionava)
- **CORRIGIDO** Apagar a descrição desmarcava o tipo na tela, mas o tipo antigo continuava valendo e ia junto com o chamado
- **CORRIGIDO** Busca de chamados: o poll de 30 s e o realtime desfaziam a busca com o texto ainda no campo; durante a busca o realtime ignorava os chamados fora dela e o contador da aba contava só os filtrados; vírgula ou parêntese no termo zeravam a lista. Agora filtra na tela, sobre a lista completa

### Painel do PC — redesenho da abertura de chamado (`painel-pc.html`/`painel-pc.css`)
- **ALTERADO** "Abrir chamado" virou a primeira aba e já abre selecionada; as abas viraram um controle segmentado de largura total
- **ALTERADO** Formulário em passos numerados: descrição primeiro (no PC a IA marca o tipo a partir dela) e tipo em quatro cartões à vista, no lugar da lista suspensa; para professor, o passo de escolher o PC (normal/emergência) vem antes, com botão de rádio no lugar das pílulas "ATIVAR"
- **ALTERADO** Botão de envio renomeado para "Enviar chamado", maior e sempre visível no rodapé do painel
- **CORRIGIDO** Popup de sucesso: o botão "Abrir novo chamado" levava para a lista. Agora é "Acompanhar meu chamado", com o link separado "Abrir outro chamado" e os próximos passos explicados
- **ALTERADO** Sugestão da IA: "Resolveu!" limpa a descrição em vez de pular para "Meus chamados"
- **NOVO** Botão "Novo chamado" na barra de busca de "Meus chamados"
- **CORRIGIDO** Contador de mensagens não lidas cobria o status do chamado na lista
- Conferido com o JS real (sessão e backend simulados): PC e professor, tema claro/escuro, modo hacker, easter egg do título, 1280px, 375px e 320px

## [2.0.1] — 2026-08-22

### Deploy
- **ALTERADO** Deploy migrado de Vercel para Netlify: `vercel.json` removido, `netlify.toml` adicionado com os mesmos rewrites de URL limpa, headers de segurança (CSP) e cache-control por tipo de asset

### IA (Groq)
- **CORRIGIDO** Modelo `llama-3.3-70b-versatile` descontinuado deixava `content` vazio por consumir todos os tokens em reasoning — migrado para `openai/gpt-oss-20b` em `auth.js` (validação de nome), `painel-pc.js` (classificação de chamados) e `painel-ti.js` (resumo de ticket + sugestão de resposta), além do default do `groq-proxy`
- **MELHORADO** Prompts simplificados para evitar reasoning desnecessário; adicionado "Responda SEMPRE em português brasileiro" em todos os prompts
- **AUMENTADO** Limite de tokens por ação: classificação de chamados 1024→2048, resumo de ticket 128→256, sugestão de resposta 256→512
- **COMPLETO** `painel-logs.js` (função `gerarRelatorioIA`, relatório semanal do dashboard) também migrado para `openai/gpt-oss-20b` — todos os 5 pontos de IA sincronizados (ver [WORKFLOW.md](WORKFLOW.md))

## [2.0.0] — 2026-06-22

### Novas funcionalidades — painel-ti
- **NOVO** SLA visual em chamados abertos: cor conforme tempo decorrido (verde < 30min, amarelo 30min–2h, laranja 2h–24h, vermelho > 24h)
- **NOVO** Tooltips nos botões destrutivos (remover PC, remover usuário, apagar logs)

### Novas funcionalidades — painel-pc
- **NOVO** Melhorias no fluxo de abertura de chamado e na lista "Meus Chamados" (`painel-pc.js`/`painel-pc.css`, ver detalhes no commit `c16eb91`)

### Novas funcionalidades — painel-logs
- **NOVO** Aba "Dashboard" com gráficos Chart.js: chamados por dia, por tipo, por status, comparativo semanal, acessos diários e heatmap por hora
- **NOVO** Exportação para PDF via impressão do navegador

### Refatoração
- **NOVO** Módulo `js/dsos-ui.js`: popups estilizados (`dsosAlert`/`dsosConfirm`) substituindo `alert`/`confirm` nativos, com suporte a tema escuro e Modo Hacker
- Refatoração de `index.html` (landing de consentimento) e de `css/base.css`/`css/login.css`

### Melhorias de UX
- "Esqueceu a senha? Contate o T.I." exibido na tela de login
- Mensagem de ajuda atualizada com instrução sobre recuperação de senha
- Mensagens de erro padronizadas em todas as telas
- Troca de papel: técnicos T.I. que também são professores podem trocar para o modo Professor sem precisar fazer logout

### Backend / Segurança
- **NOVO** Edge Function `groq-proxy` (`supabase/functions/groq-proxy/`) para mover a chave da API Groq do frontend para o servidor
- `professor_id` agora armazenado na sessão para usuários com conta dupla T.I.+Professor
- Documentação sobre a `GROQ_KEY` adicionada ao [SETUP.md](SETUP.md)

## [1.2.0] — 2026-03-17

### Banco de dados (produção + teste)
- **NOVO** Trigger `fn_check_login_unico`: impede login duplicado entre `professor` e `usuario_ti`
- **NOVO** `rpc_preview_limpeza(p_dias)`: analisa tickets/mensagens/imagens a deletar sem executar nada
- **NOVO** `rpc_executar_limpeza(p_dias)`: deleta tickets encerrados nos últimos N dias + mensagens (cascade) + retorna nomes de imagens
- **NOVO** Edge Function `fn-limpar-dados`: executa com service role, deleta imagens do bucket `chat-prints`, retorna estatísticas

### Bugs corrigidos — painel-ti
- **CORRIGIDO** Falso alarme inconsistente: `carregarTickets` filtrava respondidos por `aberto_em >= hoje` — filtro removido
- **CORRIGIDO** KPI e badges precisavam de F5: pendentes agora buscados direto do banco; polling reduzido de 60s→30s e inclui `carregarTickets()`
- **CORRIGIDO** PC marcado como descartado ao descartar periférico: toggle "O PC completo foi descartado" adicionado no modal
- **CORRIGIDO** Itens confirmados na fila não sumiam: condição `feito` agora verifica `pcStatus === 'descartado' || !!descricao_resolucao`
- **CORRIGIDO** Aba de PCs não atualizava após descarte: `carregarPCs()` adicionado em todos os fluxos que alteram `status_pc`
- **CORRIGIDO** PC ficava `em_manutencao` ao descartar só periférico: toggle desmarcado → PC volta a `ativo`
- **CORRIGIDO** Imagem do chat: `btn-img-ti` não era desabilitado quando chamado encerrado
- **CORRIGIDO** Extensão do arquivo de imagem: mais robusta para arquivos sem extensão no nome

### Novas funcionalidades — painel-ti
- **NOVO** Mini-modal ao clicar DESCARTADO: captura o item antes de enviar para a fila
- **NOVO** Botão "Cancelar" na fila de descarte: reverte ticket para `aberto` e PC para `ativo`
- **NOVO** Fade-out ao confirmar descarte físico
- **NOVO** Toggle estilizado "O PC completo foi descartado" no modal de descarte físico
- **NOVO** Aba **Manutenção** com limpeza de banco: preview de impacto, seletor de prazo, botão "Limpar agora"
- **NOVO** Suporte a colar imagem (Ctrl+V) no chat do TI
- **NOVO** Navegação em dois níveis: pills **Chamados / Gestão** no nível 1, abas normais no nível 2
- **NOVO** Memória de última aba visitada em cada grupo (Chamados/Gestão)
- **NOVO** Badge no pill Chamados somando tickets não respondidos + fila de descarte

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