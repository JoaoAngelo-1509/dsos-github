-- ============================================================================
-- Sessão viva só enquanto a aba dá sinal
--
-- PROBLEMA
-- --------
-- Na apresentação de 08/09 o painel do PC não conseguia abrir chamado:
-- "new row violates row-level security policy for table ticket". A aba estava
-- logada desde 01/09 (acesso_log #144 registrou 6 dias 23h30 de sessão). O
-- token de sessão vencia 12h depois do login, mas nada no front percebia: a
-- sessão continuava no sessionStorage (o Chrome devolve o sessionStorage ao
-- restaurar abas), a tela seguia "logada", e toda leitura protegida por RLS
-- voltava vazia. O INSERT em ticket usa `Prefer: return=representation`, e o
-- Postgres só devolve a linha nova se ela passar na policy de SELECT — que
-- exige token vivo. Sem token, o chamado inteiro é recusado.
--
-- E o inverso também incomodava: fechar o navegador não encerrava nada. O
-- token seguia válido por até 12h no banco.
--
-- SOLUÇÃO
-- -------
-- O token deixa de ter validade fixa e passa a viver por INATIVIDADE:
--   * nasce valendo 5 min;
--   * cada `rpc_sessao_ping` (a cada 30s, em toda aba aberta) empurra a
--     validade para agora + 5 min;
--   * teto absoluto de 12h desde o login, mesmo com a aba pingando.
-- Fechou o navegador → o ping para → o token morre em até 5 min. O limiar é o
-- mesmo que `rpc_limpar_sessoes_mortas` já usa para `sessao_ativa`: uma regra
-- só para "sessão sem sinal está morta".
--
-- O token NÃO é apagado ao fechar a aba: `pagehide`/`beforeunload` disparam
-- igual no F5, e apagar ali deslogaria quem só recarregou a página.
--
-- `rpc_sessao_ping` passa a devolver o `usuario_tipo` do token (ou NULL se ele
-- morreu). É assim que o front descobre, no carregamento e a cada ping, que a
-- sessão acabou e manda a pessoa para o login (js/sessao-vida.js).
--
-- De quebra, fecha duas brechas de presença:
--   * `rpc_sessao_ping` aceitava qualquer p_usuario_id/p_usuario_tipo no corpo:
--     qualquer um marcava qualquer conta como "ao vivo" no painel de logs.
--     Agora a identidade vem do token; sem token vivo, nada é gravado.
--   * `rpc_sessao_encerrar` apagava a presença de qualquer conta pelo id. Agora
--     só age sobre a sessão do token apresentado.
--
-- Compatível com o front antigo: ele já manda o token em toda chamada (via
-- sessao-header.js), então o ping dele renova normalmente.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================


-- ── 1. validade inicial: 5 min ──────────────────────────────────────────────
ALTER TABLE public.sessao_token
  ALTER COLUMN expira_em SET DEFAULT now() + interval '5 minutes';

-- Tokens vivos hoje também passam à regra nova. Quem está com a aba aberta
-- não percebe: o próximo ping (≤ 30s) renova.
UPDATE public.sessao_token
   SET expira_em = least(expira_em, now() + interval '5 minutes')
 WHERE expira_em > now();


-- ── 2. ping renova o token e devolve se a sessão está viva ─────────────────
-- DROP porque o tipo de retorno muda (void → text).
DROP FUNCTION IF EXISTS public.rpc_sessao_ping(integer, text, text, text);

CREATE FUNCTION public.rpc_sessao_ping(
  p_usuario_id    integer DEFAULT NULL,   -- ignorado: a identidade vem do token
  p_usuario_tipo  text    DEFAULT NULL,   -- ignorado: idem
  p_usuario_login text    DEFAULT NULL,
  p_usuario_nome  text    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.sessao_token;
BEGIN
  UPDATE public.sessao_token
     SET expira_em = least(now() + interval '5 minutes', criado_em + interval '12 hours')
   WHERE token = public.fn_sessao_token_header()
     AND expira_em > now()
     AND criado_em + interval '12 hours' > now()
  RETURNING * INTO v;

  IF FOUND THEN
    INSERT INTO public.sessao_ativa (usuario_id, usuario_tipo, usuario_login, usuario_nome)
    VALUES (v.usuario_id, v.usuario_tipo,
            coalesce(v.usuario_login, p_usuario_login),
            coalesce(nullif(p_usuario_nome, ''), v.usuario_nome))
    ON CONFLICT (usuario_id, usuario_tipo) DO UPDATE
      SET ultimo_ping  = now(),
          usuario_nome = COALESCE(EXCLUDED.usuario_nome, sessao_ativa.usuario_nome);
  END IF;

  -- Poda quem parou de dar sinal (limiar de 5 min definido lá dentro).
  PERFORM public.rpc_limpar_sessoes_mortas();

  RETURN v.usuario_tipo;   -- NULL quando o token não existe ou morreu
END;
$function$;

COMMENT ON FUNCTION public.rpc_sessao_ping(integer, text, text, text) IS
  'Heartbeat de sessao: renova o token do header X-Sessao-Token por 5 min (teto de 12h desde o login), marca presenca em sessao_ativa e devolve o usuario_tipo, ou NULL se a sessao morreu. Ver migration 20260910120000.';

REVOKE ALL ON FUNCTION public.rpc_sessao_ping(integer, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_sessao_ping(integer, text, text, text) TO anon, authenticated;


-- ── 3. encerrar: sai da página (presença) ou faz logout (token) ─────────────
-- DROP porque a lista de argumentos muda; manter as duas versões deixaria o
-- PostgREST sem saber qual chamar. A segunda linha deixa o arquivo idempotente.
DROP FUNCTION IF EXISTS public.rpc_sessao_encerrar(integer, text);
DROP FUNCTION IF EXISTS public.rpc_sessao_encerrar(integer, text, text, boolean);

CREATE FUNCTION public.rpc_sessao_encerrar(
  p_usuario_id   integer DEFAULT NULL,   -- ignorado: a identidade vem do token
  p_usuario_tipo text    DEFAULT NULL,   -- ignorado: idem
  p_token        text    DEFAULT NULL,   -- sendBeacon não manda header, só corpo
  p_logout       boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.sessao_token;
BEGIN
  SELECT * INTO v FROM public.sessao_token
   WHERE token = coalesce(nullif(p_token, ''), public.fn_sessao_token_header());
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM public.sessao_ativa
   WHERE usuario_id = v.usuario_id AND usuario_tipo = v.usuario_tipo;

  IF p_logout THEN
    DELETE FROM public.sessao_token WHERE token = v.token;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.rpc_sessao_encerrar(integer, text, text, boolean) IS
  'Encerra a sessao do token (p_token ou header X-Sessao-Token): tira a presenca de sessao_ativa e, com p_logout, apaga o token. Sem token valido nao faz nada. Ver migration 20260910120000.';

REVOKE ALL ON FUNCTION public.rpc_sessao_encerrar(integer, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_sessao_encerrar(integer, text, text, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   ALTER TABLE public.sessao_token
--     ALTER COLUMN expira_em SET DEFAULT now() + interval '12 hours';
--   DROP FUNCTION IF EXISTS public.rpc_sessao_ping(integer, text, text, text);
--   DROP FUNCTION IF EXISTS public.rpc_sessao_encerrar(integer, text, text, boolean);
--   -- e recriar as duas versões anteriores a partir de
--   -- 20260902120000_sessao_ping_poda_sessoes_mortas.sql (ping) e do
--   -- baseline (encerrar: DELETE em sessao_ativa por usuario_id/usuario_tipo).
-- ============================================================================
