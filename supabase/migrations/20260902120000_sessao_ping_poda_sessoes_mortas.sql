-- ============================================================================
-- O HEARTBEAT PASSA A PODAR AS SESSÕES MORTAS
--
-- PROBLEMA
-- --------
-- Uma sessão só sai de `sessao_ativa` por dois caminhos:
--
--   1. `rpc_sessao_encerrar`, chamada no logout explícito e num
--      `beforeunload` via `navigator.sendBeacon`;
--   2. `rpc_limpar_sessoes_mortas`, que apaga quem não dá ping há mais de
--      5 minutos.
--
-- O caminho (1) não é confiável: `beforeunload` + `sendBeacon` falha sempre
-- que o navegador descarta a aba, mata o processo, fica sem rede ou o sistema
-- desliga — que é justamente o que acontece num laboratório de escola, onde a
-- máquina é desligada no fim da aula. É o caso relatado: "se você só fechar a
-- guia, ele continua contando".
--
-- O caminho (2) existe e funciona, mas era chamado de UM lugar só: o
-- `_carregarSessoesAtivas()` do painel de logs. Ou seja, a limpeza dependia de
-- um T.I. abrir aquela tela específica. Sem ninguém no painel de logs, linhas
-- mortas ficavam em `sessao_ativa` indefinidamente — e enquanto estivessem
-- lá, a aba "Acessos" mostrava a conta como "ao vivo" com o cronômetro da
-- coluna DURAÇÃO subindo, porque o cliente conta a partir do horário do login
-- e não tem como saber que a sessão acabou.
--
-- Medido antes desta migration: uma sessão parada há 7min29 (limiar: 5 min)
-- ainda estava na tabela, e o painel exibiria 9min46 e subindo.
--
-- SOLUÇÃO
-- -------
-- `rpc_sessao_ping` passa a chamar `rpc_limpar_sessoes_mortas` depois de
-- registrar o próprio ping. Como o ping roda a cada 30 s em toda aba aberta,
-- basta UMA pessoa online em QUALQUER painel para a tabela se manter limpa —
-- a limpeza deixa de depender de alguém abrir o painel de logs.
--
-- Mesmo padrão que `fn_emitir_sinal_realtime` (migration 20260828120000) já
-- usa para podar `realtime_sinal`: a escrita mais frequente paga uma limpeza
-- barata, e nada precisa de pg_cron.
--
-- POR QUE CHAMAR A RPC EM VEZ DE REPETIR O DELETE
-- -----------------------------------------------
-- O limiar de 5 minutos fica definido num lugar só. Duplicar o
-- `WHERE ultimo_ping < now() - INTERVAL '5 minutes'` aqui criaria duas
-- verdades que podem divergir numa alteração futura — e o sintoma dessa
-- divergência (sessão que some numa tela e não some noutra) é exatamente o
-- tipo de coisa difícil de diagnosticar.
--
-- CUSTO
-- -----
-- Desprezível: `sessao_ativa` tem no máximo uma linha por usuário online.
-- O DELETE varre algumas dezenas de linhas, a cada 30 s por aba aberta.
--
-- NOTA: a sessão que acabou de dar ping nunca é apagada por ela mesma — o
-- upsert acima grava `ultimo_ping = now()`, bem dentro da janela de 5 min.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_sessao_ping(
  p_usuario_id    integer,
  p_usuario_tipo  text,
  p_usuario_login text,
  p_usuario_nome  text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO sessao_ativa (usuario_id, usuario_tipo, usuario_login, usuario_nome)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome)
  ON CONFLICT (usuario_id, usuario_tipo) DO UPDATE
    SET ultimo_ping  = now(),
        usuario_nome = COALESCE(EXCLUDED.usuario_nome, sessao_ativa.usuario_nome);

  -- Poda quem parou de dar sinal. Ver o cabeçalho desta migration.
  PERFORM public.rpc_limpar_sessoes_mortas();
END;
$function$;

COMMENT ON FUNCTION public.rpc_sessao_ping(integer, text, text, text) IS
  'Heartbeat de sessao (30s por aba). Grava/atualiza a linha em sessao_ativa e poda as sessoes sem ping ha mais de 5 min via rpc_limpar_sessoes_mortas — assim a limpeza nao depende de alguem abrir o painel de logs. Ver migration 20260902120000.';


-- ============================================================================
-- ROLLBACK — devolve a função ao estado anterior (só o upsert, sem a poda).
-- Os painéis continuam funcionando; a limpeza volta a depender do
-- `_carregarSessoesAtivas()` do painel de logs.
-- ----------------------------------------------------------------------------
--   CREATE OR REPLACE FUNCTION public.rpc_sessao_ping(
--     p_usuario_id integer, p_usuario_tipo text,
--     p_usuario_login text, p_usuario_nome text DEFAULT NULL::text)
--   RETURNS void LANGUAGE plpgsql SECURITY DEFINER
--   SET search_path TO 'public', 'extensions', 'pg_temp'
--   AS $function$
--   BEGIN
--     INSERT INTO sessao_ativa (usuario_id, usuario_tipo, usuario_login, usuario_nome)
--     VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome)
--     ON CONFLICT (usuario_id, usuario_tipo) DO UPDATE
--       SET ultimo_ping  = now(),
--           usuario_nome = COALESCE(EXCLUDED.usuario_nome, sessao_ativa.usuario_nome);
--   END;
--   $function$;
-- ============================================================================
