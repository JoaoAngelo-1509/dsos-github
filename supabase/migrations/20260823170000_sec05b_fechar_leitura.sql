-- ============================================================================
-- SEC-05 (parte B) — fecha a LEITURA de ticket / mensagem / pc / usuario_ti /
-- professor, que hoje estão em `USING (true)`.
--
-- CONTEXTO
-- --------
-- O DSos não usa Supabase Auth: aluno, professor e T.I. compartilham a MESMA
-- anon key. A parte A do SEC-05 já fechou a ESCRITA com um token de sessão
-- (public.sessao_token + public.fn_sessao_do_token + RPCs SECURITY DEFINER).
-- A LEITURA continuava aberta: qualquer pessoa de posse da anon key — que é
-- pública por definição, vai no bundle do site — conseguia um
--     GET /rest/v1/ticket?select=*
-- e levava embora todos os chamados, o chat inteiro (public.mensagem) e as
-- notas internas do T.I. (ticket.nota_interna), sem nunca ter feito login.
--
-- COMO ISSO É RESOLVIDO SEM SUPABASE AUTH
-- ---------------------------------------
-- O PostgREST publica os cabeçalhos HTTP da requisição no GUC
-- `request.headers`. Verificado em produção neste projeto:
--     curl -H "X-Sessao-Token: PROVA-123" .../rest/v1/rpc/_diag_headers
--     → {"x-sessao-token": "PROVA-123", ...}   (o nome chega em minúsculas)
-- Também verificado que o gateway do Supabase ECOA o header no preflight CORS
-- (`access-control-allow-headers: ...,x-sessao-token`), então o navegador
-- deixa o front-end mandá-lo — não é só um truque de curl.
--
-- Logo dá para escrever policies de SELECT que exigem um token de sessão
-- válido, sem migrar o projeto inteiro para o Supabase Auth.
--
-- DESEMPENHO
-- ----------
-- Função em policy roda POR LINHA. Por isso as funções auxiliares são STABLE
-- e são sempre chamadas como `(SELECT fn())`: assim o planner as transforma em
-- InitPlan e avalia UMA vez por query, não uma vez por linha. É o mesmo padrão
-- que o Supabase recomenda para `(select auth.uid())`.
--
-- ⚠️ IMPACTO CONHECIDO NO SUPABASE REALTIME — LEIA ANTES DE APLICAR
-- ------------------------------------------------------------------
-- `ticket` e `mensagem` estão na publication `supabase_realtime`. O Realtime
-- avalia a RLS em `realtime.apply_rls()`, que faz apenas:
--     set_config('role', <role do JWT>, true)
--     set_config('request.jwt.claims', <claims>, true)
-- e então executa `select exists(select 1 from public.ticket where id='42')`.
-- Ele NUNCA seta `request.headers` — e não tem como: o header custom vai na
-- requisição HTTP do PostgREST, não no WebSocket. Portanto, depois desta
-- migration, as policies abaixo devolvem FALSE dentro do Realtime e os canais
-- `postgres_changes` de `ticket`/`mensagem` param de entregar eventos.
--
-- Consequência prática nos painéis (nenhum erro visível, só silêncio):
--   • painel-ti  — some o toast/som de "novo chamado" e o refresh automático
--                  de KPIs; o chat do T.I. não atualiza sozinho.
--   • painel-pc  — o chat do aluno não atualiza sozinho.
--   • painel-logs— NÃO é afetado: os canais dele são das tabelas *_log e de
--                  sessao_ativa, que continuam com SELECT aberto.
-- Os dados continuam corretos; só param de chegar sozinhos (F5 / reabrir o
-- chat resolve). O caminho para recuperar o "ao vivo" sem reabrir o vazamento
-- está descrito no relatório do SEC-05b (tabela de sinal + re-fetch via REST).
--
-- Esta migration NÃO mexe na publication de propósito: assim aplicar e
-- reverter são operações simétricas e de baixo risco.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) Helpers de sessão
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER é OBRIGATÓRIO: public.sessao_token tem RLS ligada e nenhuma
-- policy (nega tudo), e `anon` não tem nem GRANT nela. Sem SECURITY DEFINER a
-- função não enxergaria a própria tabela de sessões.
--
-- Não há vazamento: as funções só devolvem dados da sessão cujo token o
-- próprio chamador apresentou no header. Quem não manda token não recebe nada.

-- Lê o header. Devolve NULL (nunca erro) quando:
--   • a chamada não veio do PostgREST (psql, SQL Editor, Realtime, cron) —
--     `current_setting(..., true)` devolve NULL nesses casos;
--   • o header não foi enviado, ou veio vazio.
-- O NULL é o que faz "sem token = não vê nada" cair naturalmente, sem
-- precisar de EXCEPTION dentro de policy (que rodaria a cada linha).
CREATE OR REPLACE FUNCTION public.fn_sessao_token_header()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT nullif(
           current_setting('request.headers', true)::jsonb ->> 'x-sessao-token',
           ''
         );
$$;

COMMENT ON FUNCTION public.fn_sessao_token_header() IS
  'SEC-05b: token de sessão vindo do header HTTP X-Sessao-Token (PostgREST o expõe em request.headers). NULL fora do PostgREST.';

-- Os três acessores abaixo são escalares de propósito. Um único helper que
-- devolvesse a linha inteira obrigaria a escrever `(fn()).campo` na policy, e
-- cada campo acessado seria UMA chamada nova da função. Com escalares, cada
-- `(SELECT fn())` vira um InitPlan próprio, avaliado uma vez por query.
-- Custo total: 3 buscas por PK numa tabela minúscula, por query.

CREATE OR REPLACE FUNCTION public.fn_sessao_tipo()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.usuario_tipo
    FROM public.sessao_token s
   WHERE s.token = public.fn_sessao_token_header()
     AND s.expira_em > now();
$$;

COMMENT ON FUNCTION public.fn_sessao_tipo() IS
  'SEC-05b: ''ti'' | ''pc'' | ''professor'' da sessão atual; NULL se não há token válido (ausente ou expirado).';

CREATE OR REPLACE FUNCTION public.fn_sessao_uid()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.usuario_id
    FROM public.sessao_token s
   WHERE s.token = public.fn_sessao_token_header()
     AND s.expira_em > now();
$$;

COMMENT ON FUNCTION public.fn_sessao_uid() IS
  'SEC-05b: id do dono da sessão atual (pc.id, usuario_ti.id ou professor.id, conforme fn_sessao_tipo()).';

CREATE OR REPLACE FUNCTION public.fn_sessao_nome()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.usuario_nome
    FROM public.sessao_token s
   WHERE s.token = public.fn_sessao_token_header()
     AND s.expira_em > now();
$$;

COMMENT ON FUNCTION public.fn_sessao_nome() IS
  'SEC-05b: nome gravado no login. Para professor é professor.nome — é a única chave que liga um professor aos chamados dele (ticket.nome_solicitante).';


-- ────────────────────────────────────────────────────────────────────────────
-- 2) Índice de apoio à policy de ticket
-- ────────────────────────────────────────────────────────────────────────────
-- pc_origem / pc_problema / mensagem.ticket_id já têm índice. Falta o do
-- caminho do professor, que casa por nome.
CREATE INDEX IF NOT EXISTS idx_ticket_nome_solicitante
  ON public.ticket (nome_solicitante);


-- ────────────────────────────────────────────────────────────────────────────
-- 3) public.ticket — quem vê o quê
-- ────────────────────────────────────────────────────────────────────────────
--   T.I.      → tudo (é o painel de atendimento).
--   PC        → os chamados em que o PC é a origem OU o equipamento com
--               problema. `pc_problema` entra porque em chamado de emergência
--               um PC abre chamado para outro; quem abriu precisa continuar
--               acompanhando.
--   Professor → os que ele abriu. O schema não tem ticket.professor_id; o
--               único vínculo é ticket.nome_solicitante, que o front preenche
--               com session.nome — e para professor session.nome vem de
--               professor.nome, o mesmo valor que rpc_login_professor grava em
--               sessao_token.usuario_nome. Casar por nome é mais fraco do que
--               casar por id (um aluno que digite o nome de um professor cria
--               um chamado que aquele professor passa a enxergar), mas é o que
--               o schema permite hoje; trocar por professor_id é item à parte.
--   Sem token → nada.
DROP POLICY IF EXISTS ticket_select ON public.ticket;
CREATE POLICY ticket_select ON public.ticket
  FOR SELECT TO anon, authenticated
  USING (
        (SELECT public.fn_sessao_tipo()) = 'ti'
    OR (
            (SELECT public.fn_sessao_tipo()) = 'pc'
        AND (SELECT public.fn_sessao_uid()) IN (pc_origem, pc_problema)
       )
    OR (
            (SELECT public.fn_sessao_tipo()) = 'professor'
        AND nome_solicitante IS NOT NULL
        AND nome_solicitante = (SELECT public.fn_sessao_nome())
       )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 4) public.mensagem — você vê as mensagens dos chamados que você vê
-- ────────────────────────────────────────────────────────────────────────────
-- O EXISTS abaixo consulta public.ticket como o próprio chamador, então a
-- policy `ticket_select` acima é aplicada dentro dele. Isso é de propósito:
-- a regra do chat passa a ser derivada da regra do chamado, e não uma segunda
-- cópia da mesma lógica que um dia sairia de sincronia com a primeira.
-- Custo por linha: uma busca por PK em ticket (ticket_pkey); os InitPlans das
-- funções de sessão são içados para fora do laço pelo planner.
DROP POLICY IF EXISTS mensagem_select ON public.mensagem;
CREATE POLICY mensagem_select ON public.mensagem
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.ticket t
       WHERE t.id = mensagem.ticket_id
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 5) public.pc — inventário: exige sessão, mas não é particionado por dono
-- ────────────────────────────────────────────────────────────────────────────
-- Por que não restringir o PC ao próprio registro: o fluxo de emergência do
-- painel-pc procura OUTRO computador pela tag
-- (`/rest/v1/pc?tag=eq.LAB1-07&select=id,laboratorio,lado`) para preencher o
-- chamado, e o painel-ti embeda `pc!ticket_pc_problema_fkey(tag,status_pc)`
-- nas listagens. Fechar por dono quebraria os dois.
-- O conteúdo é inventário (tag, laboratório, lado, status) — nada pessoal; a
-- senha do PC já está protegida por privilégio de COLUNA desde a migration
-- 20260622120000 e não é afetada aqui. Exigir sessão tira do anônimo o mapa
-- completo do parque de máquinas da escola.
--
-- ⚠️ Fecha junto a view public.v_pc_pub (security_invoker=true → herda esta
-- policy). Conferido: nenhuma tela consulta pc/v_pc_pub antes do login — a
-- página de login só chama as RPCs rpc_login_* e a edge function groq-proxy.
DROP POLICY IF EXISTS pc_select ON public.pc;
CREATE POLICY pc_select ON public.pc
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) IS NOT NULL);


-- ────────────────────────────────────────────────────────────────────────────
-- 6) public.usuario_ti — equipe do T.I.: exige sessão
-- ────────────────────────────────────────────────────────────────────────────
-- Hoje `USING (true)` deixa qualquer anônimo listar login, nome, e-mail e
-- presença de toda a equipe — metade de um ataque de força bruta pronta.
-- Sessão é o mínimo. Não dá para restringir a 'ti': painel-logs embeda
-- `usuario_ti!ticket_tecnico_responsavel_fkey(nome)` e o painel-pc precisa do
-- nome do técnico nas mensagens.
-- ⚠️ Fecha junto a view public.v_usuario_ti_pub (security_invoker=true).
DROP POLICY IF EXISTS usuario_ti_select ON public.usuario_ti;
CREATE POLICY usuario_ti_select ON public.usuario_ti
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) IS NOT NULL);


-- ────────────────────────────────────────────────────────────────────────────
-- 7) public.professor — só o T.I.
-- ────────────────────────────────────────────────────────────────────────────
-- A tabela só é lida pela aba "Professores" do painel-ti (cadastro/edição).
-- O login de professor passa por rpc_login_professor, que é SECURITY DEFINER e
-- portanto não depende desta policy. Como a coluna `login` é lida junto, deixar
-- isso aberto é entregar a lista de usuários válidos do sistema.
DROP POLICY IF EXISTS anon_select_professor ON public.professor;
DROP POLICY IF EXISTS professor_select      ON public.professor;
CREATE POLICY professor_select ON public.professor
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.fn_sessao_tipo()) = 'ti');


-- ────────────────────────────────────────────────────────────────────────────
-- 8) Compensação: média de resolução para o painel do aluno
-- ────────────────────────────────────────────────────────────────────────────
-- O painel-pc calcula a "estimativa de tempo de atendimento" varrendo TODOS os
-- chamados resolvidos dos últimos 90 dias. Com a policy nova o aluno passa a
-- enxergar só os próprios chamados e a média viraria ruído (ou zero).
-- Esta RPC devolve só o agregado — nenhum dado de chamado, de PC ou de pessoa
-- atravessa. SECURITY DEFINER de propósito: é o que permite o agregado global
-- continuar existindo com a leitura fechada.
CREATE OR REPLACE FUNCTION public.rpc_medias_resolucao(p_dias integer DEFAULT 90)
RETURNS TABLE(tipo text, media_ms double precision, amostras bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT t.tipo::text,
         avg(extract(epoch FROM (t.resolvido_em - t.aberto_em)) * 1000)::double precision,
         count(*)::bigint
    FROM public.ticket t
   WHERE t.status = 'resolvido'
     AND t.aberto_em    IS NOT NULL
     AND t.resolvido_em IS NOT NULL
     AND t.resolvido_em > t.aberto_em
     AND t.aberto_em >= now() - make_interval(days => greatest(coalesce(p_dias, 90), 1))
   GROUP BY t.tipo;
$$;

COMMENT ON FUNCTION public.rpc_medias_resolucao(integer) IS
  'SEC-05b: média de tempo de resolução por tipo. Só agregado — repõe a estimativa do painel-pc depois que ticket deixou de ser legível por todos.';


-- ────────────────────────────────────────────────────────────────────────────
-- 9) Limpeza: remove a função de diagnóstico usada para provar o header
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._diag_headers();


-- ============================================================================
-- ROLLBACK (se algo quebrar em produção, isto devolve o estado anterior)
-- ----------------------------------------------------------------------------
--   DROP POLICY IF EXISTS ticket_select     ON public.ticket;
--   CREATE POLICY ticket_select     ON public.ticket     FOR SELECT USING (true);
--   DROP POLICY IF EXISTS mensagem_select   ON public.mensagem;
--   CREATE POLICY mensagem_select   ON public.mensagem   FOR SELECT USING (true);
--   DROP POLICY IF EXISTS pc_select         ON public.pc;
--   CREATE POLICY pc_select         ON public.pc         FOR SELECT USING (true);
--   DROP POLICY IF EXISTS usuario_ti_select ON public.usuario_ti;
--   CREATE POLICY usuario_ti_select ON public.usuario_ti FOR SELECT TO anon, authenticated USING (true);
--   DROP POLICY IF EXISTS professor_select  ON public.professor;
--   CREATE POLICY anon_select_professor ON public.professor FOR SELECT TO anon USING (true);
-- As funções fn_sessao_* e rpc_medias_resolucao podem ficar: são aditivas e
-- ninguém mais depende delas depois do rollback.
-- ============================================================================
