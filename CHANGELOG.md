# DSos — Changelog

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