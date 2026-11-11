-- SEC (auditoria 11/11/2026): fecha as RPCs administrativas para quem não é T.I.
--
-- O PROBLEMA
-- As RPCs de cadastro/edição/remoção (T.I., PC, professor), limpeza de logs,
-- reabertura de chamado, presença e desbloqueio de login são SECURITY DEFINER,
-- têm EXECUTE para anon e NÃO conferiam quem chamava. Com a anon key (pública,
-- vai no bundle) qualquer um criava um T.I., apagava PCs ou zerava os logs.
--
-- O QUE ESTE SCRIPT FAZ
-- 1. Guarda de T.I. no topo de 14 RPCs: `fn_sessao_tipo()` lê o X-Sessao-Token
--    de `request.headers` (GUC da requisição — não muda dentro de SECURITY
--    DEFINER; conferido no teste com ROLLBACK). Usa IS DISTINCT FROM porque
--    sem token a função devolve NULL, e `NULL <> 'ti'` NÃO dispararia o RAISE.
--    rpc_marcar_lido_pc passa a exigir sessão pc/professor dona do ticket
--    (mesma regra de ticket_select) — ou T.I., porque o T.I. que entra como
--    professor mantém o token 'ti' (js/auth.js).
-- 2. REVOKE EXECUTE de public/anon/authenticated nas RPCs que o front não usa
--    (limpeza, descarte, rpc_get_*, rpc_registrar_tentativa) + default
--    privileges sem EXECUTE para PUBLIC em funções novas.
-- 3. rpc_cadastrar_professor: some a versão de 4 args e a de 5 args (a que o
--    front chama, js/painel-ti.js) vira SECURITY DEFINER com guarda de T.I. e
--    grava usuario_ti.senha com crypt (antes ia em texto puro).
-- 4. rpc_login_ti/pc/professor: 5 falhas em 15 min por login → recusa até a
--    janela passar. O front tenta ti → pc → professor em sequência, então um
--    login bem-sucedido limpa as falhas das três chaves daquele identificador.
-- 5. Policies: ticket_insert e mensagem_insert exigem sessão; DROP das
--    policies de INSERT abertas de audit_log, alteracoes_criticas_log,
--    operacoes_massa_log e auditoria_ti (só gravadas por funções/gatilhos
--    SECURITY DEFINER). atividades_log passa a exigir sessão.
--
-- O QUE FICOU DE FORA (de propósito)
-- * acesso_log_insert_system continua WITH CHECK (true): rpc_log_login_falho e
--   rpc_log_login são SECURITY INVOKER e gravam ANTES de existir sessão.
-- * atividades_log não teve a policy removida: os rpc_log_* de 7+ args que o
--   front chama (js/logging.js) são SECURITY INVOKER e gravam como anon.
-- * storage chat_prints_upload: a API de Storage não expõe request.headers, então
--   fn_sessao_tipo() é sempre NULL lá (docs/reportar-problema.md) — exigir
--   sessão ali bloquearia todo upload de print do chat.
--
-- VALIDADO em produção dentro de BEGIN … ROLLBACK (SET LOCAL ROLE anon, com e
-- sem X-Sessao-Token em request.headers). Não aplicado.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Guarda de T.I. nas RPCs administrativas
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_ti(p_login text, p_nome text, p_senha text, p_email text DEFAULT NULL::text, p_is_professor boolean DEFAULT false, p_disciplina text DEFAULT NULL::text)
 RETURNS TABLE(id integer, login text, nome text, is_professor boolean, professor_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_ti_id INT; v_prof_id BIGINT;
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  INSERT INTO public.usuario_ti(login, nome, senha, email, is_professor)
  VALUES (p_login, p_nome, extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
          NULLIF(btrim(COALESCE(p_email,'')), ''), p_is_professor)
  RETURNING public.usuario_ti.id INTO v_ti_id;

  IF p_is_professor THEN
    INSERT INTO public.professor(login, nome, senha_hash, disciplina)
    VALUES (p_login, p_nome, extensions.crypt(p_senha, extensions.gen_salt('bf', 10)), p_disciplina)
    RETURNING public.professor.id INTO v_prof_id;
    UPDATE public.usuario_ti SET professor_id = v_prof_id WHERE public.usuario_ti.id = v_ti_id;
  END IF;

  RETURN QUERY SELECT u.id, u.login, u.nome, u.is_professor, u.professor_id
    FROM public.usuario_ti u WHERE u.id = v_ti_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_ti(p_id integer, p_nome text, p_nova_senha text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_is_professor boolean DEFAULT NULL::boolean, p_disciplina text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_login text;
  v_senha text;        -- hash atual em usuario_ti.senha
  v_atual_is_prof boolean;
  v_prof_hash text;    -- hash bcrypt a usar para professor.senha_hash
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT login, senha, is_professor INTO v_login, v_senha, v_atual_is_prof
  FROM public.usuario_ti WHERE id = p_id;

  -- por padrão reaproveita o hash já existente (nunca re-hashear um hash)
  v_prof_hash := v_senha;

  UPDATE public.usuario_ti SET nome = p_nome WHERE id = p_id;

  IF p_email IS NOT NULL THEN
    UPDATE public.usuario_ti SET email = NULLIF(trim(p_email), '') WHERE id = p_id;
  END IF;

  IF p_nova_senha IS NOT NULL AND length(trim(p_nova_senha)) >= 4 THEN
    v_prof_hash := extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10));
    UPDATE public.usuario_ti SET senha = v_prof_hash WHERE id = p_id;
  END IF;

  IF p_is_professor IS NOT NULL THEN
    UPDATE public.usuario_ti SET is_professor = p_is_professor WHERE id = p_id;

    IF p_is_professor AND NOT v_atual_is_prof THEN
      IF NOT EXISTS (SELECT 1 FROM public.professor WHERE login = v_login) THEN
        INSERT INTO public.professor (login, nome, senha_hash, disciplina, ti_id)
        VALUES (v_login, p_nome, v_prof_hash, p_disciplina, p_id);
      ELSE
        UPDATE public.professor SET ti_id = p_id, nome = p_nome WHERE login = v_login;
      END IF;
    ELSIF NOT p_is_professor AND v_atual_is_prof THEN
      UPDATE public.professor SET ti_id = NULL WHERE ti_id = p_id;
    ELSIF p_is_professor AND v_atual_is_prof THEN
      UPDATE public.professor
        SET nome = p_nome,
            disciplina = COALESCE(p_disciplina, disciplina)
      WHERE ti_id = p_id;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_deletar_ti(p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_count  INTEGER;
  v_login  TEXT;
  v_nome   TEXT;
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  -- Conta quantos T.I. existem atualmente
  SELECT COUNT(*) INTO v_count FROM public.usuario_ti;

  IF v_count <= 1 THEN
    RAISE EXCEPTION
      'Não é possível remover o único usuário T.I. Cadastre outro antes de remover este.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Captura dados antes de deletar (para audit log)
  SELECT login, nome INTO v_login, v_nome
  FROM public.usuario_ti
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário T.I. com id % não encontrado.', p_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Deleta o usuário
  DELETE FROM public.usuario_ti WHERE id = p_id;

  -- Registra no audit log
  INSERT INTO public.auditoria_ti (acao, usuario_id, login, nome, detalhes)
  VALUES (
    'DELETE',
    p_id,
    v_login,
    v_nome,
    'Usuário T.I. removido via rpc_deletar_ti'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_pc(p_tag text, p_laboratorio text, p_lado text, p_senha text)
 RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id integer;
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

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
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  UPDATE public.pc SET status_pc = p_status_pc WHERE id = p_id;
  IF p_nova_senha IS NOT NULL AND p_nova_senha <> '' THEN
    UPDATE public.pc_senha
      SET senha = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10))
      WHERE pc_id = p_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_deletar_pc(p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  DELETE FROM public.mensagem
    WHERE ticket_id IN (
      SELECT id FROM public.ticket
      WHERE pc_origem = p_id OR pc_problema = p_id
    );
  DELETE FROM public.ticket
    WHERE pc_origem = p_id OR pc_problema = p_id;
  DELETE FROM public.pc WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_professor(p_id bigint, p_nome text, p_disciplina text DEFAULT NULL::text, p_nova_senha text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  UPDATE professor
  SET
    nome       = p_nome,
    disciplina = p_disciplina,
    senha_hash = CASE
      WHEN p_nova_senha IS NOT NULL AND length(p_nova_senha) >= 4
        THEN crypt(p_nova_senha, gen_salt('bf'))
      ELSE senha_hash
    END
  WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_deletar_professor(p_professor_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_count int;
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT COUNT(*) INTO v_count FROM ticket
  WHERE status IN ('aberto', 'em_andamento')
    AND EXISTS (SELECT 1 FROM professor p WHERE p.id = p_professor_id
                AND nome_solicitante ILIKE '%' || p.nome || '%');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Professor possui % ticket(s) em aberto', v_count;
  END IF;
  DELETE FROM professor WHERE id = p_professor_id;
  RETURN json_build_object('success', true);
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_limpar_logs(p_tabelas text[], p_threshold timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tabela text;
  _coluna text;
  _deletados int;
  _total int := 0;
  _resultado jsonb := '{}';
  _tabelas_validas text[] := ARRAY[
    'auditoria_ti','audit_log','atividades_log',
    'acesso_log','alteracoes_criticas_log','operacoes_massa_log'
  ];
  _colunas text[] := ARRAY[
    'executado_em','timestamp','timestamp',
    'timestamp','timestamp','timestamp'
  ];
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  FOR i IN 1..array_length(p_tabelas, 1) LOOP
    _tabela := p_tabelas[i];

    -- Valida que só aceita tabelas permitidas
    IF NOT (_tabela = ANY(_tabelas_validas)) THEN
      CONTINUE;
    END IF;

    -- Descobre a coluna de data para essa tabela
    _coluna := _colunas[array_position(_tabelas_validas, _tabela)];

    IF p_threshold IS NULL THEN
      EXECUTE format('DELETE FROM %I WHERE %I IS NOT NULL', _tabela, _coluna);
    ELSE
      EXECUTE format('DELETE FROM %I WHERE %I < $1', _tabela, _coluna)
        USING p_threshold;
    END IF;

    GET DIAGNOSTICS _deletados = ROW_COUNT;
    _total := _total + _deletados;
    _resultado := _resultado || jsonb_build_object(_tabela, _deletados);
  END LOOP;

  _resultado := _resultado || jsonb_build_object('total', _total);
  RETURN _resultado;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reabrir_ticket(p_ticket_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_ticket ticket%ROWTYPE;
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT * INTO v_ticket FROM ticket WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket não encontrado'; END IF;
  IF v_ticket.status NOT IN ('resolvido', 'descartado', 'falso_alarme') THEN
    RAISE EXCEPTION 'Apenas tickets encerrados podem ser reabertos';
  END IF;
  UPDATE ticket SET status = 'aberto', prioridade = 'medio',
    resolucao = NULL, item_descartado = NULL, resolvido_em = NULL,
    tecnico_responsavel = NULL WHERE id = p_ticket_id;
  RETURN json_build_object('success', true, 'ticket_id', p_ticket_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_set_presenca(p_id integer, p_presenca text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  IF p_presenca NOT IN ('online','em campo','ausente') THEN
    RAISE EXCEPTION 'presença inválida';
  END IF;
  UPDATE usuario_ti SET presenca = p_presenca WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_marcar_lido_ti(p_ticket_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  UPDATE public.mensagem
  SET lido_ti = TRUE
  WHERE ticket_id = p_ticket_id AND remetente = 'PC' AND lido_ti = FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_limpar_bloqueio(p_identificador text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  DELETE FROM public.login_tentativas
  WHERE identificador = lower(p_identificador);
END;
$function$;

-- rpc_marcar_lido_pc: só a sessão dona do ticket (mesma regra de ticket_select).
-- 'ti' também passa: o T.I. que entra como professor segue com token 'ti'.
CREATE OR REPLACE FUNCTION public.rpc_marcar_lido_pc(p_ticket_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tipo text   := public.fn_sessao_tipo();
  v_uid  bigint := public.fn_sessao_uid();
  v_nome text   := public.fn_sessao_nome();
BEGIN
  IF v_tipo IS NULL OR NOT (
       v_tipo = 'ti'
    OR EXISTS (
         SELECT 1 FROM public.ticket t
          WHERE t.id = p_ticket_id
            AND (  (v_tipo = 'pc' AND v_uid IN (t.pc_origem, t.pc_problema))
                OR (v_tipo = 'professor' AND t.nome_solicitante IS NOT NULL
                    AND t.nome_solicitante = v_nome)))
  ) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  UPDATE public.mensagem
  SET lido_pc = TRUE
  WHERE ticket_id = p_ticket_id AND remetente = 'TI' AND lido_pc = FALSE;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. RPCs que o front não usa: sem EXECUTE para public/anon/authenticated
--    (grep "rpc_get_" js/ html/ → nenhuma ocorrência)
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION
  public.rpc_executar_limpeza(integer),
  public.rpc_preview_limpeza(integer),
  public.rpc_limpar_tickets_antigos(integer),
  public.rpc_confirmar_descarte_fisico(bigint),
  public.rpc_registrar_tentativa(text, text, boolean),
  public.rpc_get_atividades_log(integer, integer, text, text),
  public.rpc_get_acesso_log(integer, integer, text),
  public.rpc_get_alteracoes_criticas(integer, integer, text),
  public.rpc_get_estatisticas_logs(),
  public.rpc_get_atividades_ultimos_dias(integer),
  public.rpc_get_top_usuarios_ativos(),
  public.rpc_get_tendencia_modulos(),
  public.rpc_get_resumo_impacto(),
  public.rpc_get_auditoria_ticket(integer),
  public.rpc_get_auditoria_pc(integer),
  public.rpc_get_tentativas_login_usuario(text),
  public.rpc_get_alteracoes_criticas_por_periodo(text, integer),
  public.rpc_get_logs_export(date, date, text)
FROM public, anon, authenticated;

-- Funções novas criadas por postgres deixam de nascer com EXECUTE para PUBLIC.
-- (O default por schema do Supabase segue dando EXECUTE a anon/authenticated.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM public;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. rpc_cadastrar_professor: uma só versão, DEFINER, com guarda e crypt
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.rpc_cadastrar_professor(text, text, text, text);

-- Mesma assinatura que js/painel-ti.js chama (p_login, p_nome, p_senha,
-- p_disciplina, p_is_ti). CREATE OR REPLACE mantém os GRANTs existentes.
CREATE OR REPLACE FUNCTION public.rpc_cadastrar_professor(p_login text, p_nome text, p_senha text, p_disciplina text DEFAULT NULL::text, p_is_ti boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_prof_id BIGINT;
  v_ti_id   INT;
  v_hash    TEXT;
BEGIN
  IF (SELECT public.fn_sessao_tipo()) IS DISTINCT FROM 'ti' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  v_hash := extensions.crypt(p_senha, extensions.gen_salt('bf', 10));

  INSERT INTO public.professor(login, nome, senha_hash, disciplina)
  VALUES (p_login, p_nome, v_hash, p_disciplina)
  RETURNING id INTO v_prof_id;

  IF p_is_ti THEN
    INSERT INTO public.usuario_ti(login, nome, senha, is_professor, professor_id)
    VALUES (p_login, p_nome, v_hash, TRUE, v_prof_id)
    RETURNING id INTO v_ti_id;

    UPDATE public.professor SET ti_id = v_ti_id WHERE id = v_prof_id;
  END IF;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Limite de tentativas nos logins (5 falhas / 15 min por login)
-- ════════════════════════════════════════════════════════════════════════════
-- Chave em login_tentativas.chave = 'login_<tipo>|<login minúsculo>' (usa o
-- índice idx_login_tentativas_chave_tempo). O bloqueio é por função: o front
-- tenta ti → pc → professor, e um sucesso em qualquer uma limpa as três.

CREATE OR REPLACE FUNCTION public.fn_login_checar_bloqueio(p_chave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.login_tentativas
       WHERE chave = p_chave AND sucesso = false
         AND tentou_em > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'muitas tentativas de login; aguarde 15 minutos'
      USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_login_registrar(p_tipo text, p_login text, p_sucesso boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id text := lower(coalesce(p_login, ''));
BEGIN
  IF p_sucesso THEN
    DELETE FROM public.login_tentativas
     WHERE chave IN ('login_ti|' || v_id, 'login_pc|' || v_id, 'login_professor|' || v_id)
       AND sucesso = false;
  ELSE
    DELETE FROM public.login_tentativas
     WHERE chave = 'login_' || p_tipo || '|' || v_id
       AND tentou_em < now() - interval '1 day';
    INSERT INTO public.login_tentativas (identificador, ip, chave, sucesso)
    VALUES (v_id, 'rpc', 'login_' || p_tipo || '|' || v_id, false);
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION
  public.fn_login_checar_bloqueio(text),
  public.fn_login_registrar(text, text, boolean)
FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_login_ti(p_login text, p_senha text)
 RETURNS TABLE(id integer, login text, nome text, is_professor boolean, professor_id bigint, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.usuario_ti;
BEGIN
  PERFORM public.fn_login_checar_bloqueio('login_ti|' || lower(coalesce(p_login, '')));
  SELECT * INTO v FROM public.usuario_ti u
   WHERE u.login = p_login AND u.senha = extensions.crypt(p_senha, u.senha);
  IF NOT FOUND THEN
    PERFORM public.fn_login_registrar('ti', p_login, false);
    RETURN;
  END IF;
  PERFORM public.fn_login_registrar('ti', p_login, true);
  RETURN QUERY SELECT v.id, v.login, v.nome, v.is_professor, v.professor_id,
    public.fn_emitir_token(v.id, 'ti', v.login, v.nome);
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_login_pc(p_tag text, p_senha text)
 RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.pc;
BEGIN
  PERFORM public.fn_login_checar_bloqueio('login_pc|' || lower(coalesce(p_tag, '')));
  SELECT p.* INTO v FROM public.pc p
    JOIN public.pc_senha s ON s.pc_id = p.id
   WHERE p.tag = UPPER(p_tag) AND s.senha = extensions.crypt(p_senha, s.senha);
  IF NOT FOUND THEN
    PERFORM public.fn_login_registrar('pc', p_tag, false);
    RETURN;
  END IF;
  PERFORM public.fn_login_registrar('pc', p_tag, true);
  RETURN QUERY SELECT v.id, v.tag, v.laboratorio, v.lado, v.status_pc,
    public.fn_emitir_token(v.id, 'pc', v.tag, v.tag);
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_login_professor(p_login text, p_senha text)
 RETURNS TABLE(id bigint, login text, nome text, disciplina text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.professor;
BEGIN
  PERFORM public.fn_login_checar_bloqueio('login_professor|' || lower(coalesce(p_login, '')));
  SELECT * INTO v FROM public.professor p
   WHERE p.login = p_login AND p.senha_hash = extensions.crypt(p_senha, p.senha_hash);
  IF NOT FOUND THEN
    PERFORM public.fn_login_registrar('professor', p_login, false);
    RETURN;
  END IF;
  PERFORM public.fn_login_registrar('professor', p_login, true);
  RETURN QUERY SELECT v.id, v.login, v.nome, v.disciplina,
    public.fn_emitir_token(v.id, 'professor', v.login, v.nome);
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Policies de INSERT
-- ════════════════════════════════════════════════════════════════════════════

ALTER POLICY ticket_insert ON public.ticket
  WITH CHECK ((SELECT public.fn_sessao_tipo()) IS NOT NULL);

ALTER POLICY mensagem_insert ON public.mensagem
  WITH CHECK (
    (SELECT public.fn_sessao_tipo()) IS NOT NULL
    AND (remetente = ANY (ARRAY['TI'::text, 'PC'::text])
         OR EXISTS (SELECT 1 FROM public.pc WHERE pc.tag = mensagem.remetente))
  );

-- Logs gravados só por funções/gatilhos SECURITY DEFINER (owner postgres,
-- BYPASSRLS): a policy aberta só servia para anon forjar linhas.
DROP POLICY IF EXISTS audit_log_insert_system            ON public.audit_log;
DROP POLICY IF EXISTS alteracoes_criticas_insert_system  ON public.alteracoes_criticas_log;
DROP POLICY IF EXISTS operacoes_massa_insert_system      ON public.operacoes_massa_log;
DROP POLICY IF EXISTS auditoria_ti_insert                ON public.auditoria_ti;

-- atividades_log: os rpc_log_* que o front chama são SECURITY INVOKER e gravam
-- como anon, sempre com sessão aberta — exige a sessão em vez de remover.
ALTER POLICY atividades_log_insert_system ON public.atividades_log
  WITH CHECK ((SELECT public.fn_sessao_tipo()) IS NOT NULL);
