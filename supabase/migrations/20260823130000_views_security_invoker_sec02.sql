-- SEC-02 (auditoria DSos): v_pc_pub e v_usuario_ti_pub estavam como
-- SECURITY DEFINER (advisor do Supabase reportava as duas como ERROR
-- "Security Definer View"), executando com os privilégios do dono da view
-- em vez dos de quem consulta — contornando a intenção da RLS nas duas
-- tabelas mais sensíveis do sistema.
--
-- Duas migrations anteriores (20260622195943_views_security_invoker e
-- 20260622200000_usuario_ti_pub_security_invoker) já tinham tentado
-- corrigir isso, mas o estado ao vivo continuava SECURITY DEFINER — as
-- views foram recriadas depois sem a propriedade.
--
-- Por que não basta o ALTER VIEW: testado em transação com ROLLBACK antes
-- de aplicar — com security_invoker=true, v_usuario_ti_pub passa a
-- retornar 0 LINHAS para anon, porque public.usuario_ti tem RLS habilitada
-- e NENHUMA policy (deny-by-default) e anon não tem SELECT na tabela. Isso
-- quebraria a lista de equipe T.I., o nome do técnico logado, o seletor de
-- presença (painel-ti.js) e a resolução de nome de técnico no painel de
-- logs. Provavelmente foi exatamente por isso que a correção anterior foi
-- revertida.
--
-- Por isso a migration também concede a anon/authenticated leitura das
-- colunas PÚBLICAS de usuario_ti (as mesmas 6 que a view já expunha, nada
-- a mais) e cria a policy de SELECT que faltava. `senha` continua sem
-- GRANT de coluna, então segue ilegível — conferido no teste e depois via
-- REST real (GET /rest/v1/usuario_ti?select=senha devolve 42501). Não há
-- policy de UPDATE/DELETE em usuario_ti, então escrita continua negada
-- por RLS.
--
-- v_pc_pub não precisa de nada além do ALTER: public.pc já tem policy
-- pc_select USING(true) e SELECT concedido (a coluna secreta saiu da
-- tabela na migration mover_pc_senha_para_tabela_separada).

ALTER VIEW public.v_pc_pub SET (security_invoker = true);
ALTER VIEW public.v_usuario_ti_pub SET (security_invoker = true);

CREATE POLICY usuario_ti_select ON public.usuario_ti
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT (id, login, nome, email, is_professor, presenca)
  ON public.usuario_ti TO anon, authenticated;

-- Validação (rodar manualmente, não faz parte da migration):
--   SET ROLE anon;
--     SELECT count(*) FROM public.v_usuario_ti_pub;  -- deve ser > 0
--     SELECT senha FROM public.usuario_ti LIMIT 1;   -- deve dar permission denied
--   RESET ROLE;
