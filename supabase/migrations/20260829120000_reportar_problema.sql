-- ============================================================================
-- REPORTAR PROBLEMA — canal de feedback dentro do sistema
--
-- O QUE ENTRA AQUI
-- ---------------
--   * public.problema_reporte      — a tabela dos reportes
--   * public.rpc_reportar_problema — o ÚNICO caminho de escrita, validado por
--                                    token de sessão e com rate limit
--   * public.rpc_reportes_listar   — leitura paginada para o painel T.I.
--   * public.rpc_reporte_status    — o técnico marca o reporte como tratado
--
-- SEGUE O PADRÃO SEC-05 DO PROJETO
-- --------------------------------
-- Escrita por RPC SECURITY DEFINER que valida o token; leitura por RLS que
-- exige sessão de T.I. Sem policy de INSERT/UPDATE/DELETE: a RLS nega por
-- padrão e a RPC (que roda como dona) é o caminho único e verificado.
-- Ver docs/regras-de-acesso.md, seção 2.3.
--
-- ⚠️ DECISÃO DE PROJETO: A CAPTURA DE TELA FICA NA TABELA, NÃO NO STORAGE
-- ----------------------------------------------------------------------
-- O plano original previa um bucket privado `reportes`. Não dá, com a
-- arquitetura de autorização atual, e o motivo é o mesmo que derrubou o
-- Realtime no SEC-05b:
--
--   A autorização do DSos viaja no header HTTP `X-Sessao-Token`, que só o
--   PostgREST expõe (em `request.headers`). A API de Storage é outro serviço:
--   ela avalia a RLS de `storage.objects` sem esse header, então
--   `fn_sessao_tipo()` devolve NULL ali dentro. Uma policy de SELECT no
--   bucket só poderia ser `bucket_id = 'reportes'` — ou seja, aberta a
--   qualquer um com a anon key, que é pública. É exatamente o vazamento que
--   a captura de tela precisa evitar, já que ela pode conter dados de outro
--   aluno.
--
-- As três saídas possíveis eram:
--   (a) Edge Function com service key que valida o token e devolve URL
--       assinada — funciona, mas cria função nova, secret novo e deploy novo;
--   (b) guardar a imagem na própria tabela, herdando a MESMA RLS do reporte;
--   (c) desistir da captura.
--
-- Escolhida a (b): é a única que protege a imagem com a mesma regra que
-- protege o texto, sem infra nova. Custo: a imagem ocupa espaço na tabela.
-- Mitigado por três limites — o cliente reduz para no máximo 1024px de
-- largura e grava JPEG de qualidade 0.55, e a RPC recusa qualquer coisa acima
-- de 1,2 MB. Se um dia o volume incomodar, migrar para (a) é aditivo: basta
-- passar a gravar o path em vez do conteúdo.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) Tabela
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.problema_reporte (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  criado_em      timestamptz NOT NULL DEFAULT now(),

  -- quem reportou (copiado da sessão validada, NUNCA de campo do cliente)
  papel          text        NOT NULL CHECK (papel IN ('ti', 'pc', 'professor')),
  usuario_id     bigint,
  usuario_login  text,
  usuario_nome   text,

  -- contexto técnico, declarado ao usuário antes do envio
  url            text,
  user_agent     text,
  viewport       text,
  versao_app     text,

  descricao      text        NOT NULL CHECK (length(btrim(descricao)) BETWEEN 5 AND 2000),

  -- captura de tela opcional, como data URI JPEG. NULL quando o usuário não
  -- marcou a caixa — que vem DESMARCADA por padrão, de propósito.
  screenshot     text,

  status         text        NOT NULL DEFAULT 'novo'
                             CHECK (status IN ('novo', 'em_analise', 'resolvido', 'descartado')),
  nota_ti        text,
  tratado_por    integer,
  tratado_em     timestamptz
);

COMMENT ON TABLE public.problema_reporte IS
  'Reportes de problema enviados pelos usuarios de dentro dos paineis. Escrita so por rpc_reportar_problema; leitura so com sessao de T.I. A coluna screenshot guarda a imagem inteira (data URI) de proposito — ver cabecalho da migration 20260829120000.';

COMMENT ON COLUMN public.problema_reporte.screenshot IS
  'Captura da tela em data URI JPEG, opt-in explicito do usuario. Pode conter dado pessoal de terceiros: protegida pela mesma RLS do reporte.';

CREATE INDEX IF NOT EXISTS idx_problema_reporte_criado ON public.problema_reporte (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_problema_reporte_status ON public.problema_reporte (status, criado_em DESC);


-- ────────────────────────────────────────────────────────────────────────────
-- 2) RLS — leitura só para T.I.; escrita, para ninguém (só a RPC)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.problema_reporte ENABLE ROW LEVEL SECURITY;

-- O schema public tem default privileges que concedem acesso amplo a
-- anon/authenticated em toda tabela nova (confirmado via pg_default_acl na
-- migration 20260823120100). O REVOKE abaixo é obrigatório, não redundante.
REVOKE ALL ON public.problema_reporte FROM anon, authenticated, PUBLIC;
GRANT  SELECT ON public.problema_reporte TO anon, authenticated;

DROP POLICY IF EXISTS problema_reporte_select ON public.problema_reporte;
CREATE POLICY problema_reporte_select ON public.problema_reporte
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');

-- Sem policy de INSERT/UPDATE/DELETE => negado por padrão, mesmo com GRANT.
-- Lembrete do SEC-05: sem policy o Postgres NÃO levanta erro, apenas não
-- encontra linha — um PATCH direto devolve 200 tendo alterado ZERO linhas.


-- ────────────────────────────────────────────────────────────────────────────
-- 3) Escrita — rpc_reportar_problema
-- ────────────────────────────────────────────────────────────────────────────
-- Aceita token de QUALQUER tipo: o canal existe justamente para o aluno e o
-- professor avisarem que algo quebrou. O que o token garante aqui é que houve
-- login legítimo — sem ele, o endpoint viraria um formulário de spam aberto.
--
-- Todos os campos de identidade vêm da SESSÃO, não do corpo da requisição.
-- Se viessem do cliente, qualquer um reportaria em nome de outra pessoa.
CREATE OR REPLACE FUNCTION public.rpc_reportar_problema(
  p_token      text,
  p_descricao  text,
  p_url        text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_viewport   text DEFAULT NULL,
  p_versao_app text DEFAULT NULL,
  p_screenshot text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_s         public.sessao_token;
  v_recentes  integer;
  v_id        bigint;
  v_descricao text := btrim(coalesce(p_descricao, ''));
BEGIN
  v_s := public.fn_sessao_do_token(p_token);

  IF length(v_descricao) < 5 THEN
    RAISE EXCEPTION 'descreva o problema com pelo menos 5 caracteres';
  END IF;
  IF length(v_descricao) > 2000 THEN
    RAISE EXCEPTION 'descricao muito longa (maximo 2000 caracteres)';
  END IF;

  -- Teto de tamanho da captura. 1,2 MB de data URI equivale a ~900 KB de
  -- JPEG — bem acima do que o cliente produz depois de reduzir para 1024px
  -- de largura. Serve para barrar quem chamar a RPC fora do frontend.
  IF p_screenshot IS NOT NULL THEN
    IF length(p_screenshot) > 1200000 THEN
      RAISE EXCEPTION 'captura de tela muito grande';
    END IF;
    IF p_screenshot NOT LIKE 'data:image/jpeg;base64,%'
       AND p_screenshot NOT LIKE 'data:image/png;base64,%' THEN
      RAISE EXCEPTION 'formato de captura invalido';
    END IF;
  END IF;

  -- Rate limit por usuário: 3 reportes a cada 10 minutos. Contado pelo par
  -- (papel, usuario_id) e não pelo token, porque o token muda a cada login e
  -- reabrir a sessão zeraria o limite.
  SELECT count(*) INTO v_recentes
    FROM public.problema_reporte r
   WHERE r.papel = v_s.usuario_tipo
     AND r.usuario_id IS NOT DISTINCT FROM v_s.usuario_id
     AND r.criado_em > now() - interval '10 minutes';

  IF v_recentes >= 3 THEN
    RAISE EXCEPTION 'voce ja enviou varios reportes agora ha pouco; aguarde alguns minutos';
  END IF;

  INSERT INTO public.problema_reporte (
    papel, usuario_id, usuario_login, usuario_nome,
    url, user_agent, viewport, versao_app, descricao, screenshot
  ) VALUES (
    v_s.usuario_tipo, v_s.usuario_id, v_s.usuario_login, v_s.usuario_nome,
    left(p_url, 500), left(p_user_agent, 300), left(p_viewport, 40),
    left(p_versao_app, 40), v_descricao, p_screenshot
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $fn$;

COMMENT ON FUNCTION public.rpc_reportar_problema(text,text,text,text,text,text,text) IS
  'Unico caminho de escrita em problema_reporte. Identidade vem da sessao, nunca do cliente. Rate limit de 3 por 10 min por usuario.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4) Leitura para o painel T.I.
-- ────────────────────────────────────────────────────────────────────────────
-- A policy de SELECT já resolveria uma consulta REST direta. Esta RPC existe
-- por um motivo prático: ela permite listar SEM trazer a captura de tela, que
-- é o campo pesado. A tela do técnico mostra a lista primeiro e só busca a
-- imagem do reporte que ele abrir.
--
-- SECURITY INVOKER (o padrão): roda como o chamador, então a policy
-- problema_reporte_select continua valendo. É deliberado — uma RPC
-- SECURITY DEFINER aqui reabriria o vazamento que o SEC-05b fechou, que foi
-- exatamente o caso de rpc_nao_lidas_por_ticket.
CREATE OR REPLACE FUNCTION public.rpc_reportes_listar(
  p_status text    DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id bigint, criado_em timestamptz, papel text,
  usuario_login text, usuario_nome text,
  url text, user_agent text, viewport text, versao_app text,
  descricao text, tem_screenshot boolean,
  status text, nota_ti text, tratado_em timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT r.id, r.criado_em, r.papel,
         r.usuario_login, r.usuario_nome,
         r.url, r.user_agent, r.viewport, r.versao_app,
         r.descricao, (r.screenshot IS NOT NULL),
         r.status, r.nota_ti, r.tratado_em
    FROM public.problema_reporte r
   WHERE p_status IS NULL OR r.status = p_status
   ORDER BY r.criado_em DESC
   LIMIT  greatest(least(coalesce(p_limite, 50), 200), 1)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$fn$;

COMMENT ON FUNCTION public.rpc_reportes_listar(text,integer,integer) IS
  'Lista reportes SEM a captura de tela (campo pesado). SECURITY INVOKER de proposito: a policy problema_reporte_select continua valendo.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5) Triagem — o técnico marca o reporte como tratado
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_reporte_status(
  p_token   text,
  p_id      bigint,
  p_status  text,
  p_nota    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_s public.sessao_token;
BEGIN
  v_s := public.fn_sessao_do_token(p_token);
  IF v_s.usuario_tipo <> 'ti' THEN
    RAISE EXCEPTION 'apenas T.I. pode triar reportes';
  END IF;
  IF p_status NOT IN ('novo', 'em_analise', 'resolvido', 'descartado') THEN
    RAISE EXCEPTION 'status invalido: %', p_status;
  END IF;

  UPDATE public.problema_reporte
     SET status      = p_status,
         nota_ti     = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_ti),
         tratado_por = v_s.usuario_id,
         tratado_em  = now()
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reporte nao encontrado';
  END IF;
END $fn$;


-- ────────────────────────────────────────────────────────────────────────────
-- 6) Privilégios de execução
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_reportar_problema(text,text,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reportes_listar(text,integer,integer)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reporte_status(text,bigint,text,text)                 TO anon, authenticated;


-- ============================================================================
-- VALIDAÇÃO (rodar à mão depois de aplicar; NÃO faz parte da migration)
-- ----------------------------------------------------------------------------
--   1. Sem token → deve falhar com "sessao ausente":
--      curl -X POST "$SB/rest/v1/rpc/rpc_reportar_problema" -H "apikey: $ANON" \
--           -H 'Content-Type: application/json' \
--           -d '{"p_token":"","p_descricao":"teste de reporte"}'
--
--   2. Token válido de aluno → devolve o id do reporte.
--
--   3. INSERT direto deve ser negado (sem policy de INSERT):
--      curl -X POST "$SB/rest/v1/problema_reporte" -H "apikey: $ANON" \
--           -d '{"papel":"ti","descricao":"invasao"}'   -> 42501
--
--   4. SELECT sem token, ou com token de aluno → deve devolver []:
--      curl "$SB/rest/v1/problema_reporte?select=*" -H "apikey: $ANON"
--
--   5. SELECT com token de T.I. → devolve as linhas.
--
--   6. Quarto reporte dentro de 10 min → deve falhar no rate limit.
-- ============================================================================


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.rpc_reporte_status(text,bigint,text,text);
--   DROP FUNCTION IF EXISTS public.rpc_reportes_listar(text,integer,integer);
--   DROP FUNCTION IF EXISTS public.rpc_reportar_problema(text,text,text,text,text,text,text);
--   DROP TABLE IF EXISTS public.problema_reporte;
-- ============================================================================
