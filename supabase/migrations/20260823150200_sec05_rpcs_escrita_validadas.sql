-- SEC-05, parte 3: RPCs de escrita que validam de fato quem chama.
--
-- Substituem os PATCH diretos que o frontend fazia em ticket e pc. A
-- diferença essencial: a autorização acontece no BANCO, a partir de um token
-- que só o login legítimo produz — não de um campo que o cliente manda.
--
-- As RPCs recebem um jsonb com os campos a alterar e aplicam apenas os que
-- estão na whitelist. Isso evita uma RPC por botão da tela e, principalmente,
-- impede que a mesma chamada sirva para mexer em coluna que não deveria
-- (trocar o pc_problema de um chamado, renomear a tag de um PC).
--
-- O cast é montado a partir do tipo real da coluna (pg_attribute) porque
-- jsonb ->> devolve text, e `status` é enum e `resolvido_em` é timestamptz.
--
-- rpc_avaliar_ticket aceita token de qualquer tipo: quem avalia é o
-- solicitante, e um T.I. que também é professor mantém o token do login de
-- T.I. O que o token garante aqui é que houve login legítimo.
--
-- Testado com ROLLBACK e depois via REST real: T.I. altera campos permitidos;
-- token de PC é recusado; token forjado é recusado; campo fora da whitelist é
-- recusado; nota fora de 1..5 é recusada.

CREATE OR REPLACE FUNCTION public.rpc_ti_atualizar_ticket(p_token text, p_ticket_id bigint, p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s public.sessao_token;
  v_permitidos text[] := ARRAY['status','resolucao','resolvido_em','tecnico_responsavel',
                               'nota_interna','prioridade','descricao_resolucao','item_descartado'];
  v_chave text; v_tipo text; v_sets text[] := '{}';
BEGIN
  v_s := public.fn_sessao_do_token(p_token);
  IF v_s.usuario_tipo <> 'ti' THEN RAISE EXCEPTION 'apenas T.I. pode alterar chamados'; END IF;
  FOR v_chave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_chave = ANY(v_permitidos)) THEN RAISE EXCEPTION 'campo nao permitido: %', v_chave; END IF;
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
      FROM pg_attribute a
     WHERE a.attrelid = 'public.ticket'::regclass AND a.attname = v_chave AND a.attnum > 0;
    v_sets := v_sets || format('%I = ($1->>%L)::%s', v_chave, v_chave, v_tipo);
  END LOOP;
  IF array_length(v_sets,1) IS NULL THEN RETURN; END IF;
  EXECUTE format('UPDATE public.ticket SET %s WHERE id = $2', array_to_string(v_sets, ', '))
    USING p_patch, p_ticket_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.rpc_ti_atualizar_pc(p_token text, p_pc_id bigint, p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s public.sessao_token;
  v_permitidos text[] := ARRAY['status_pc','laboratorio','lado'];
  v_chave text; v_tipo text; v_sets text[] := '{}';
BEGIN
  v_s := public.fn_sessao_do_token(p_token);
  IF v_s.usuario_tipo <> 'ti' THEN RAISE EXCEPTION 'apenas T.I. pode alterar computadores'; END IF;
  FOR v_chave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_chave = ANY(v_permitidos)) THEN RAISE EXCEPTION 'campo nao permitido: %', v_chave; END IF;
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
      FROM pg_attribute a WHERE a.attrelid='public.pc'::regclass AND a.attname=v_chave AND a.attnum>0;
    v_sets := v_sets || format('%I = ($1->>%L)::%s', v_chave, v_chave, v_tipo);
  END LOOP;
  IF array_length(v_sets,1) IS NULL THEN RETURN; END IF;
  EXECUTE format('UPDATE public.pc SET %s WHERE id = $2', array_to_string(v_sets,', ')) USING p_patch, p_pc_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.rpc_avaliar_ticket(
  p_token text, p_ticket_id bigint, p_nota int, p_comentario text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_s public.sessao_token; v_status text;
BEGIN
  v_s := public.fn_sessao_do_token(p_token);
  IF p_nota IS NULL OR p_nota < 1 OR p_nota > 5 THEN RAISE EXCEPTION 'nota deve ser de 1 a 5'; END IF;
  SELECT status::text INTO v_status FROM public.ticket WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'chamado nao encontrado'; END IF;
  IF v_status NOT IN ('resolvido','descartado') THEN
    RAISE EXCEPTION 'so e possivel avaliar chamado ja encerrado';
  END IF;
  UPDATE public.ticket
     SET avaliacao = p_nota,
         avaliacao_comentario = COALESCE(NULLIF(p_comentario,''), avaliacao_comentario)
   WHERE id = p_ticket_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.rpc_ti_atualizar_ticket(text,bigint,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ti_atualizar_pc(text,bigint,jsonb)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_avaliar_ticket(text,bigint,int,text)   TO anon, authenticated;
