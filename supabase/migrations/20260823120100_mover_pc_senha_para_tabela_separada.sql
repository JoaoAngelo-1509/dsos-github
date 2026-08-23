-- SEC-01 (auditoria DSos): pc.senha (hash bcrypt da senha de login do PC) é
-- lida por qualquer pessoa com a anon key via REST — regressão confirmada
-- ao vivo (a migration 20260622120000_pc_senha_column_privileges.sql já
-- havia corrigido isso uma vez, mas foi silenciosamente desfeita por uma
-- migration posterior não versionada, 20260728194340_reabrir_select_pc_sem
-- _quebrar_front).
--
-- Por que não é um simples REVOKE/GRANT de coluna, como foi feito para
-- professor.senha_hash (ver migration irmã revoke_select_professor_senha
-- _hash.sql) e como a migration original de junho fazia para pc.senha:
--
-- Testado exaustivamente nesta sessão (via SQL com SET ROLE E via chamada
-- HTTP real ao endpoint REST, replicando exatamente o que o frontend faz):
-- com SELECT revogado em nível de TABELA em pc — mesmo mantendo GRANT
-- SELECT por coluna em todas as colunas exceto senha — TODO UPDATE em pc
-- (inclusive um no-op, e mesmo com a policy pc_update_sem_senha reduzida a
-- WITH CHECK(true) trivial) falha com "permission denied for table pc"
-- (42501). Ou seja: a policy pc_update_sem_senha, que faz uma subquery
-- correlacionada sobre a própria pc para impedir alteração de senha via
-- UPDATE direto, exige uma entrada de privilégio SELECT em nível de TABELA
-- para funcionar — e REVOKE em nível de coluna não consegue sobrepor um
-- GRANT em nível de tabela (ACL do Postgres não tem "negação", só
-- concessão). É estruturalmente impossível manter UPDATE funcionando (ex.:
-- mudar status_pc ao resolver um chamado) E esconder senha ao mesmo tempo,
-- só com privilégios/RLS, enquanto senha estiver na mesma tabela.
--
-- Fix: mover `senha` para uma tabela separada (pc_senha), sem NENHUM
-- privilégio para anon/authenticated (nem tabela nem coluna) e RLS
-- habilitada sem nenhuma policy (default-deny — mesmo padrão já usado em
-- public.usuario_ti). Assim public.pc não tem mais nenhuma coluna secreta,
-- então SELECT em nível de tabela pode ser reconcedido com segurança
-- (necessário para o UPDATE funcionar), sem expor senha nenhuma.
--
-- Testado exaustivamente em transação com ROLLBACK antes de aplicar em
-- produção, e reconfirmado depois via chamadas HTTP reais: UPDATE em pc
-- como anon funciona (PATCH retorna 204); anon/authenticated não conseguem
-- ler pc_senha (nem tabela nem coluna — GET retorna 401/permission denied);
-- rpc_cadastrar_pc/rpc_login_pc/rpc_atualizar_pc continuam funcionando
-- (cadastro ok, login com senha certa retorna 1 linha, login com senha
-- errada retorna [], troca de senha invalida a senha antiga e habilita a
-- nova).
--
-- ATENÇÃO ao reaplicar este padrão em outra tabela: o schema public tem
-- default privileges que concedem acesso amplo a anon/authenticated em
-- toda tabela nova automaticamente (confirmado via pg_default_acl) — por
-- isso o REVOKE ALL explícito abaixo é obrigatório, não redundante.

CREATE TABLE public.pc_senha (
  pc_id integer PRIMARY KEY REFERENCES public.pc(id) ON DELETE CASCADE,
  senha text NOT NULL
);
INSERT INTO public.pc_senha (pc_id, senha) SELECT id, senha FROM public.pc WHERE senha IS NOT NULL;
ALTER TABLE public.pc_senha ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pc_senha FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.rpc_login_pc(p_tag text, p_senha text)
 RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, p.tag, p.laboratorio, p.lado, p.status_pc
  FROM public.pc p
  JOIN public.pc_senha s ON s.pc_id = p.id
  WHERE p.tag = UPPER(p_tag)
    AND s.senha = extensions.crypt(p_senha, s.senha);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_pc(p_tag text, p_laboratorio text, p_lado text, p_senha text)
 RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id integer;
BEGIN
  INSERT INTO public.pc(tag, laboratorio, lado, status_pc)
  VALUES (UPPER(p_tag), p_laboratorio, p_lado::CHAR, 'ativo')
  RETURNING pc.id INTO v_id;

  INSERT INTO public.pc_senha(pc_id, senha)
  VALUES (v_id, extensions.crypt(p_senha, extensions.gen_salt('bf', 10)));

  RETURN QUERY SELECT p.id, p.tag, p.laboratorio, p.lado, p.status_pc
    FROM public.pc p WHERE p.id = v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_pc(p_id integer, p_status_pc text, p_nova_senha text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pc SET status_pc = p_status_pc WHERE id = p_id;
  IF p_nova_senha IS NOT NULL AND p_nova_senha <> '' THEN
    UPDATE public.pc_senha
      SET senha = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10))
      WHERE pc_id = p_id;
  END IF;
END;
$function$;

DROP POLICY pc_update_sem_senha ON public.pc;
ALTER TABLE public.pc DROP COLUMN senha;
CREATE POLICY pc_update ON public.pc FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT ON public.pc TO anon, authenticated;

-- Validação (rodar manualmente, não faz parte da migration):
--   SELECT has_table_privilege('anon','public.pc_senha','SELECT');    -- deve ser false
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='pc';                -- não deve listar `senha`
