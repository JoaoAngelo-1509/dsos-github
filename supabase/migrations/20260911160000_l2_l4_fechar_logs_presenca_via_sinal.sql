-- L2 + L4: fechar a leitura pública das tabelas de log e da presença,
-- SEM quebrar o realtime do painel de logs.
--
-- O PROBLEMA (diagnóstico de 11/09/2026)
-- Todas as *_log e `sessao_ativa` tinham SELECT `USING (true)` + GRANT para
-- anon. Um GET /rest/v1/acesso_log?select=* com a anon key (que é pública, vai
-- no bundle do site) devolvia nomes, logins, horários e fingerprints de
-- dispositivo de todo mundo — 111 linhas no dia do diagnóstico. `sessao_ativa`
-- expunha quem estava online (L4). Era a maior exposição de dado pessoal em
-- aberto (docs/regras-de-acesso.md §5, L2/L4).
--
-- POR QUE O "FIX ÓBVIO" SOZINHO QUEBRARIA O PAINEL
-- A correção natural — trocar a policy por `USING (fn_sessao_tipo()='ti')`,
-- o mesmo padrão de ticket_select — fecha o REST sem dor (o painel-logs é de
-- T.I. e manda o X-Sessao-Token via js/sessao-header.js). MAS o painel-logs
-- também assinava postgres_changes DIRETO nessas tabelas, e o realtime roda
-- como `anon`: o header X-Sessao-Token não chega no contexto da replicação,
-- então `fn_sessao_tipo()` devolve NULL, a policy reprova e o painel pararia de
-- receber logs e presença ao vivo. Fechar só a policy = regressão silenciosa.
--
-- A SOLUÇÃO (mesma já usada por ticket/mensagem)
-- Roteia as mudanças dessas tabelas por `realtime_sinal` — tabela pública e
-- SEM conteúdo ({canal, ref_id, evento}), que por isso pode continuar legível
-- por anon no realtime. O gatilho emite só "tal tabela mudou":
--   canal  = nome da tabela (chave de roteamento, como canal=eq.ticket)
--   evento = operação (INSERT/UPDATE/DELETE)
--   ref_id = 0  (sentinela constante — em especial NADA de usuario_id da
--                presença, senão L4 voltaria pela janela do sinal)
-- O dado de verdade o painel busca por HTTP, já com o token e agora barrado
-- pela RLS. js/painel-logs.js assina `realtime_sinal` no lugar das tabelas-base.
--
-- NOTA sobre `realtime_sinal`: ref_id é NOT NULL (daí o 0) e há CHECK em canal
-- e em evento — por isso este script ESTENDE os dois CHECKs antes de emitir os
-- novos sinais.
--
-- ESCOPO: fecha L2 e L4. Não toca em L1/L3/L5 (ver §5). As RPCs que gravam nos
-- logs e na presença são SECURITY DEFINER (registrar_*, rpc_sessao_ping/
-- _encerrar) e rodam como owner — a RLS de SELECT não afeta a escrita.
--
-- VALIDADO antes de aplicar, em transação com ROLLBACK contra produção:
--   anon sem token via acesso_log: 111 -> 0 ; sessao_ativa -> 0 ; tipo -> null.
-- O predicado é idêntico ao de ticket_select, que o T.I. já usa em produção.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Estender os CHECKs de realtime_sinal (superset: valores antigos seguem OK)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.realtime_sinal DROP CONSTRAINT realtime_sinal_canal_check;
ALTER TABLE public.realtime_sinal ADD CONSTRAINT realtime_sinal_canal_check
  CHECK (canal = ANY (ARRAY[
    'ticket','mensagem',
    'acesso_log','atividades_log','audit_log','alteracoes_criticas_log',
    'auditoria_ti','sessao_ativa'
  ]));

ALTER TABLE public.realtime_sinal DROP CONSTRAINT realtime_sinal_evento_check;
ALTER TABLE public.realtime_sinal ADD CONSTRAINT realtime_sinal_evento_check
  CHECK (evento = ANY (ARRAY['INSERT','UPDATE','DELETE']));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Sinal sem conteúdo para o painel de logs
-- ───────────────────────────────────────────────────────────────────────────
-- Espelha fn_emitir_sinal_realtime (SECURITY DEFINER, dono postgres, poda a
-- janela de 10 min), mas canal = nome da tabela e ref_id = 0 (sem identidade).
CREATE OR REPLACE FUNCTION public.fn_sinal_painel_logs()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.realtime_sinal (canal, ref_id, evento)
  VALUES (TG_TABLE_NAME, 0, TG_OP);

  DELETE FROM public.realtime_sinal WHERE em < now() - interval '10 minutes';

  RETURN NULL;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Gatilhos — só nas tabelas que o painel-logs realmente consome
-- ───────────────────────────────────────────────────────────────────────────
-- acesso_log também no UPDATE (duracao_sessao preenchida no logout).
-- operacoes_massa_log fica de fora: o painel não a assina (fora de TABLE_TO_ABA).
DROP TRIGGER IF EXISTS trg_sinal_acesso_log ON public.acesso_log;
CREATE TRIGGER trg_sinal_acesso_log
  AFTER INSERT OR UPDATE ON public.acesso_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_sinal_painel_logs();

DROP TRIGGER IF EXISTS trg_sinal_atividades_log ON public.atividades_log;
CREATE TRIGGER trg_sinal_atividades_log
  AFTER INSERT ON public.atividades_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_sinal_painel_logs();

DROP TRIGGER IF EXISTS trg_sinal_audit_log ON public.audit_log;
CREATE TRIGGER trg_sinal_audit_log
  AFTER INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_sinal_painel_logs();

DROP TRIGGER IF EXISTS trg_sinal_alteracoes_criticas_log ON public.alteracoes_criticas_log;
CREATE TRIGGER trg_sinal_alteracoes_criticas_log
  AFTER INSERT ON public.alteracoes_criticas_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_sinal_painel_logs();

DROP TRIGGER IF EXISTS trg_sinal_auditoria_ti ON public.auditoria_ti;
CREATE TRIGGER trg_sinal_auditoria_ti
  AFTER INSERT ON public.auditoria_ti
  FOR EACH ROW EXECUTE FUNCTION public.fn_sinal_painel_logs();

-- Presença → INSERT/UPDATE/DELETE. Sinal vazio de propósito: quem está online
-- é buscado por HTTP com token, nunca pelo sinal.
DROP TRIGGER IF EXISTS trg_sinal_presenca ON public.sessao_ativa;
CREATE TRIGGER trg_sinal_presenca
  AFTER INSERT OR UPDATE OR DELETE ON public.sessao_ativa
  FOR EACH ROW EXECUTE FUNCTION public.fn_sinal_painel_logs();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Trocar SELECT de `USING (true)` para exigir sessão de T.I.
-- ───────────────────────────────────────────────────────────────────────────
-- Mesmo predicado de ticket_select (initplan `(SELECT fn_sessao_tipo())`,
-- avaliado uma vez por query). Os GRANT SELECT para anon continuam: é a policy
-- que passa a decidir. INSERT/UPDATE/DELETE das tabelas seguem como estavam.

-- L2 — tabelas de log
DROP POLICY IF EXISTS acesso_log_select_all ON public.acesso_log;
CREATE POLICY acesso_log_select_ti ON public.acesso_log
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

DROP POLICY IF EXISTS atividades_log_select_all ON public.atividades_log;
CREATE POLICY atividades_log_select_ti ON public.atividades_log
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

DROP POLICY IF EXISTS audit_log_select_all ON public.audit_log;
CREATE POLICY audit_log_select_ti ON public.audit_log
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

DROP POLICY IF EXISTS alteracoes_criticas_select_all ON public.alteracoes_criticas_log;
CREATE POLICY alteracoes_criticas_select_ti ON public.alteracoes_criticas_log
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

DROP POLICY IF EXISTS operacoes_massa_select_all ON public.operacoes_massa_log;
CREATE POLICY operacoes_massa_select_ti ON public.operacoes_massa_log
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

DROP POLICY IF EXISTS auditoria_ti_select ON public.auditoria_ti;
CREATE POLICY auditoria_ti_select_ti ON public.auditoria_ti
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

-- L4 — presença
DROP POLICY IF EXISTS sessao_ativa_select ON public.sessao_ativa;
CREATE POLICY sessao_ativa_select_ti ON public.sessao_ativa
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

-- ───────────────────────────────────────────────────────────────────────────
-- Validação (manual, não faz parte da migration):
--   curl "$SB/rest/v1/acesso_log?select=id&limit=1" -H "apikey: $ANON"
--     -> deve voltar []  (antes voltava linhas)
--   curl "$SB/rest/v1/sessao_ativa?select=usuario_id&limit=1" -H "apikey: $ANON"
--     -> deve voltar []
--   Painel-logs (logado como T.I.) continua listando e atualizando ao vivo.
--
-- HISTÓRICO DA APLICAÇÃO EM PRODUÇÃO (11/09/2026)
-- Aplicada em duas etapas: a primeira versão tentou ref_id NULL e canais
-- 'log'/'presenca', barrados por NOT NULL e pelos CHECKs de realtime_sinal
-- (migration corretiva l2_l4_corrige_sinal_logs_constraints). Este arquivo já
-- é a versão consolidada e correta — aplica de uma vez num banco limpo.
