# Plano de correções — auditoria de 11/11/2026

Origem: auditoria somente leitura (segurança, bugs, banco, UX).
Branch: `claude/epic-fermat-y899iz` · Base: `23ee0bf`.

## Regras para economizar tokens

1. Agentes **não reauditam**: só corrigem a lista.
2. **Relatório curto**: só o que mudou.
3. **Um agente por arquivo**, sem conflito.
4. Ajustes posteriores: **mensagem ao mesmo agente**, não um novo.
5. Migration testada com `BEGIN … ROLLBACK`, sem branch no Supabase.

## Fases

| # | Agente | Modelo | Effort | Quando | Status |
|---|---|---|---|---|---|
| 1 | Migration de segurança | Opus | high | Primeiro, sozinho | pendente |
| 2 | `js/painel-ti.js` | Sonnet | high | Após 1, paralelo com 3 e 4 | pendente |
| 3 | `js/painel-pc.js` + `js/painel-logs.js` + `js/dsos-ui.js` | Sonnet | medium | Paralelo | pendente |
| 4 | HTML/CSS (UX) | Sonnet | low | Paralelo | pendente |
| 5 | Revisão final de regressões | Opus | medium | Por último | pendente |
| — | Pequenas (sem agente) | — | — | Junto com 2–4 | pendente |

---

### Agente 1 — migration de segurança (Opus, high)

```
Repo /home/user/dsos-github, branch claude/epic-fermat-y899iz. Supabase project_id goitceguoynlwvtexbdu (PRODUÇÃO, em uso). NÃO reaudite; implemente só isto.

Crie supabase/migrations/<timestamp>_sec_fecha_rpcs_anon.sql que:
1. Em todas as funções SECURITY DEFINER administrativas (rpc_cadastrar_ti, rpc_atualizar_ti, rpc_deletar_ti, rpc_cadastrar_pc, rpc_atualizar_pc, rpc_deletar_pc, rpc_cadastrar_professor, rpc_atualizar_professor, rpc_deletar_professor, rpc_limpar_logs, rpc_reabrir_ticket, rpc_set_presenca, rpc_marcar_lido_ti, rpc_limpar_bloqueio): no início, se (select fn_sessao_tipo()) <> 'ti' → raise exception 'acesso negado'. rpc_marcar_lido_pc: exigir sessão pc/professor dona do ticket.
2. REVOKE EXECUTE FROM public, anon, authenticated em: rpc_executar_limpeza, rpc_preview_limpeza, rpc_limpar_tickets_antigos, rpc_confirmar_descarte_fisico, todas rpc_get_* que o front não usa (confirme com grep "rpc_get_" js/), rpc_registrar_tentativa. ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM public.
3. Drop da versão SECURITY INVOKER de 5 args de rpc_cadastrar_professor; manter uma única DEFINER com checagem de T.I. e crypt (o front chama com p_is_ti, em js/painel-ti.js:1609 — preserve a assinatura que o front usa).
4. rpc_login_ti/pc/professor: contar falhas em login_tentativas e recusar após 5 falhas em 15 min.
5. Policies: trocar WITH CHECK (true) por exigência de sessão (select fn_sessao_tipo()) is not null em ticket_insert e mensagem_insert; DROP das policies *_insert_system dos 6 logs SE grep confirmar que o front não insere direto nessas tabelas. Storage chat_prints_upload: exigir sessão.
Antes, leia as definições atuais com pg_get_functiondef (só as funções acima). Confira se js/diagnostico.js chama RPCs sem token e anote.
Valide executando a migration dentro de BEGIN; ...; ROLLBACK; via execute_sql e testando SET LOCAL ROLE anon para confirmar o bloqueio. NÃO aplique em produção nem faça apply_migration. Commit + push no branch.
Relatório final em até 15 linhas: funções alteradas, revogadas, e qualquer RPC que o front chame e que agora exija token que ele não manda.
```

### Agente 2 — `painel-ti.js` (Sonnet, high)

```
Repo /home/user/dsos-github, branch claude/epic-fermat-y899iz. Edite SÓ js/painel-ti.js. NÃO reaudite; corrija só isto:
1. XSS: linha ~1280 onclick com imagem_url e ~712-719 (fila de descarte, botão "Feito"), deletarTI/deletarProf/deletarPC: trocar onclick inline com dados por data-* + addEventListener (ou delegação).
2. ~2014-2023 "Trocar para Professor": copiar token: session.token na nova sessão.
3. ~4255 Skill Check: só abrir pelo atalho manual (Shift+G→K), nunca ao resolver chamado.
4. Checar r.ok e mostrar toast de erro com a mensagem do PostgREST em deletarPC(~1401), salvarPC(~1450), rpc_atualizar_ti(~1571), deletarTI(~1579), rpc_atualizar_professor(~1627), enviarMsgTi(~1312, devolver texto ao input se falhar), salvarPrioridade(~904).
5. KPIs ~380-389: usar início do dia local (limiteDoDiaLocal se existir em js/, senão crie helper) em vez de toISOString().
6. Não enviar enviado_em/resolvido_em do cliente (deixar default now() do banco).
7. _dsosSom.emergencia inexistente (~239): usar um som existente do HTML.
8. Chat ~1222-1254: guardar id do ticket atual; após cada await, abortar se mudou; await removeChannel.
9. _runTicketsKPIRefresh (~367) e _pollEquipe: preservar termo de busca ativo.
10. btn-img-ti (~1224): é classe no HTML, não id; corrigir seletor.
11. Incluir status aguardando_peca nas listas.
Rode `node --check js/painel-ti.js`. Commit + push. Relatório: lista numerada de 1 linha por item (feito/pulado+motivo).
```

### Agente 3 — `painel-pc` + `painel-logs` + `dsos-ui` (Sonnet, medium)

```
Repo /home/user/dsos-github, branch claude/epic-fermat-y899iz. Edite SÓ js/painel-pc.js, js/painel-logs.js, js/dsos-ui.js. NÃO reaudite; corrija só isto:
1. painel-logs.js: importar manterSessaoViva de './sessao-vida.js' (usada na linha ~218, nunca importada).
2. painel-logs.js: escapeHtml em usuario_tipo (~805,806,828), laboratorio (~1898), nome do T.I. (~1832,1886). Datas UTC em ~1788 e ~2365: usar início do dia local. _recarregarSilencioso (~1522): respeitar STATE.seq e não recalcular KPI só com a página atual. Remover fetch r2 inútil em gerarRelatorioIA.
3. painel-pc.js: onclick com imagem_url (~695) → data-* + addEventListener. Avaliação (~1036 resetForm/_abrirAvaliacaoSistema): NÃO pedir após abrir chamado; pedir só quando um chamado do usuário estiver encerrado e sem avaliação. enviarMsg (~776, ~790): checar r.ok, devolver texto ao input em erro, não mandar enviado_em. Não mandar aberto_em (~982). Bloquear duplo envio (Enter 2x).
4. dsos-ui.js: dsosAlert/dsosConfirm usar textContent (ou escapeHtml) na mensagem; foco inicial em "Cancelar" no confirm; Esc fecha.
Rode node --check nos 3 arquivos. Commit + push. Relatório: 1 linha por item.
```

### Agente 4 — UX/HTML/CSS (Sonnet, low)

```
Repo /home/user/dsos-github, branch claude/epic-fermat-y899iz. Edite SÓ arquivos .html e .css (não toque em js/). NÃO reaudite; corrija só isto:
1. index.html:318 consentimento: trocar div onclick por <input type="checkbox" id> + <label for>, mantendo a função toggleConsent funcionando; botão desabilitado opacity .55 + texto de dica com aria-describedby.
2. Tema claro: index.html (logo-name, logo-sub, tagline, footer) e css/legal.css (h1, lead, meta): colocar fundo opaco (card) atrás do texto sobre o BG vermelho.
3. html/login.html: <label class="sr-only"> nos 3 inputs, aria-label="Mostrar senha" no #btn-olho, role="alert" no #erro, autocomplete username/current-password.
4. Contraste: login.css #888→#595959 (claro); painel-ti.css --muted claro →#5f5f5f; painel-logs.css --muted2 claro #5f5f5f, escuro #9a9a9a. Trocar color:cyan inline do "v2.0" por var de texto acessível.
5. @media (pointer:coarse){ botões de ícone/abas min-height:44px; min-width:44px }.
6. Onde houver outline:none em inputs, adicionar :focus-visible com outline visível.
7. aria-label nos botões ✕ / ícone sem nome (lightbox-close, modal-close, bell-panel-close, modal-pc-close, btn-olho-*).
Commit + push. Relatório em até 10 linhas.
```

### Agente 5 — revisão (Opus, medium), depois que todos terminarem

```
Repo /home/user/dsos-github, branch claude/epic-fermat-y899iz. Revise o diff `git diff 23ee0bf..HEAD`. Procure só regressões: funções chamadas que não existem mais, RPCs que agora exigem token e o front não envia (compare com a migration nova em supabase/migrations/), seletores quebrados entre HTML e JS, erros de sintaxe (node --check em js/*.js exceto vendor). Corrija o que for regressão óbvia, commit + push. Relatório: lista curta de problemas encontrados/corrigidos e o que precisa de decisão humana.
```

---

### Pequenas (sem agente)

- Cache do CSS no `netlify.toml` (hoje `immutable` de 1 ano sem versão no nome).
- Remover a Edge Function `fn-enviar-otp`.
- Retenção dos logs (`pg_cron`).
- Remover o schema `backup_20260823` (após exportar).
- Ajuste de collation (`ALTER DATABASE postgres REFRESH COLLATION VERSION`).

Itens de banco ficam como migration no repo; nada é aplicado em produção sem aprovação.

## Depois disso (manual, pelo responsável)

1. Testar no Deploy Preview da Netlify.
2. Aplicar a migration em produção.
3. Fazer o merge do front logo em seguida.
4. Trocar as senhas das contas de T.I. e conferir se as 6 contas em `usuario_ti` são legítimas.

## Resultado

(preenchido ao final)
