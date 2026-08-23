-- SEC-05, parte 2: os três logins passam a emitir token de sessão.
--
-- A coluna `token` entra no FIM do RETURNS TABLE de propósito: o frontend lê
-- as colunas pelo nome, então acrescentar coluna é retrocompatível — a versão
-- antiga do frontend continua funcionando enquanto a nova não sobe.
--
-- Testado com ROLLBACK antes de aplicar e depois via REST real: cadastro +
-- login devolve token de 64 hex que resolve para a sessão certa (tipo e id);
-- senha errada e usuário inexistente continuam devolvendo 0 linhas.

DROP FUNCTION IF EXISTS public.rpc_login_ti(text,text);
CREATE FUNCTION public.rpc_login_ti(p_login text, p_senha text)
RETURNS TABLE(id integer, login text, nome text, is_professor boolean, professor_id bigint, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp' AS $fn$
DECLARE v public.usuario_ti;
BEGIN
  SELECT * INTO v FROM public.usuario_ti u
   WHERE u.login = p_login AND u.senha = extensions.crypt(p_senha, u.senha);
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v.id, v.login, v.nome, v.is_professor, v.professor_id,
    public.fn_emitir_token(v.id, 'ti', v.login, v.nome);
END $fn$;

DROP FUNCTION IF EXISTS public.rpc_login_pc(text,text);
CREATE FUNCTION public.rpc_login_pc(p_tag text, p_senha text)
RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp' AS $fn$
DECLARE v public.pc;
BEGIN
  SELECT p.* INTO v FROM public.pc p
    JOIN public.pc_senha s ON s.pc_id = p.id
   WHERE p.tag = UPPER(p_tag) AND s.senha = extensions.crypt(p_senha, s.senha);
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v.id, v.tag, v.laboratorio, v.lado, v.status_pc,
    public.fn_emitir_token(v.id, 'pc', v.tag, v.tag);
END $fn$;

DROP FUNCTION IF EXISTS public.rpc_login_professor(text,text);
CREATE FUNCTION public.rpc_login_professor(p_login text, p_senha text)
RETURNS TABLE(id bigint, login text, nome text, disciplina text, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp' AS $fn$
DECLARE v public.professor;
BEGIN
  SELECT * INTO v FROM public.professor p
   WHERE p.login = p_login AND p.senha_hash = extensions.crypt(p_senha, p.senha_hash);
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v.id, v.login, v.nome, v.disciplina,
    public.fn_emitir_token(v.id, 'professor', v.login, v.nome);
END $fn$;
