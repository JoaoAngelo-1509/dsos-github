-- ============================================================================
-- REALTIME via TABELA DE SINAL — recupera o "ao vivo" de ticket / mensagem sem
-- reabrir o vazamento de leitura fechado no SEC-05b (20260823170000).
--
-- PROBLEMA
-- --------
-- O SEC-05b fechou o SELECT de `ticket` / `mensagem` exigindo o token de sessão
-- no header HTTP `X-Sessao-Token`. O Supabase Realtime avalia a RLS em
-- `realtime.apply_rls()` SEM `request.headers` (o header viaja na requisição do
-- PostgREST; o WebSocket não carrega header), então as policies negam e os
-- canais `postgres_changes` de `ticket` / `mensagem` pararam de entregar
-- eventos. Mitigação até aqui: poll (30 s nas listas, 5 s no chat) — degradação
-- silenciosa e carga ociosa constante mesmo sem ninguém conversando.
--
-- SOLUÇÃO (opção "tabela de sinal + re-fetch via REST", já prevista no
-- relatório do SEC-05b)
-- -------------------------------------------------------------------
-- Uma tabela `public.realtime_sinal` que guarda só METADADO não sensível:
--   canal  — 'ticket' | 'mensagem'
--   ref_id — id do ticket afetado (para `mensagem`, é o `ticket_id`)
--   evento — 'INSERT' | 'UPDATE'
--   em     — quando
-- Triggers AFTER em `ticket` e `mensagem` gravam uma linha aqui a cada
-- mudança. A tabela tem SELECT `USING (true)` — é o que o Realtime consegue
-- enxergar — e entra na publication `supabase_realtime`. O front assina ESTA
-- tabela; ao receber o sinal, refaz o fetch pelo caminho REST normal (esse sim
-- filtrado pelo token). Ou seja: o dado sensível nunca trafega pelo WebSocket,
-- só o aviso "o ticket X mudou".
--
-- POR QUE É SEGURO DEIXAR `USING (true)`
-- -------------------------------------
-- Nenhuma coluna sensível trafega: sem corpo de mensagem, sem nome de
-- solicitante, sem nota interna, sem status. Um anônimo de posse da anon key
-- (que é pública, vai no bundle do site) enxerga apenas o ritmo de atividade e
-- ids de ticket — aceitável no modelo do projeto (um banco por instituição,
-- poucos usuários simultâneos). Se um dia isso incomodar, `ref_id` pode virar
-- hash sem mudar a estrutura nem o front (que só o usa para filtrar).
--
-- ⚠️ AO ALTERAR ESTA TABELA: nunca adicione coluna derivada de dado fechado por
-- RLS. `tests/realtime-sinal.test.js` trava o shape da tabela justamente por
-- isso (bloco "sem token — o sinal não vaza conteúdo").
--
-- ROLLBACK (no fim do arquivo) devolve o estado anterior: os canais do front
-- caem de volta no poll, sem erro.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) Tabela de sinal
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.realtime_sinal (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canal  text        NOT NULL CHECK (canal  IN ('ticket', 'mensagem')),
  ref_id bigint      NOT NULL,
  evento text        NOT NULL CHECK (evento IN ('INSERT', 'UPDATE')),
  em     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.realtime_sinal IS
  'SEC-05b/realtime: metadado nao sensivel (canal/ref_id/evento) para o front re-buscar via REST apos um evento. SELECT aberto de proposito — ver migration 20260828120000. NUNCA adicionar coluna derivada de dado fechado por RLS.';

CREATE INDEX IF NOT EXISTS idx_realtime_sinal_em ON public.realtime_sinal (em);


-- ────────────────────────────────────────────────────────────────────────────
-- 2) RLS — leitura livre (única forma de o Realtime entregar), escrita fechada
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.realtime_sinal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS realtime_sinal_select ON public.realtime_sinal;
CREATE POLICY realtime_sinal_select ON public.realtime_sinal
  FOR SELECT TO anon, authenticated
  USING (true);

-- Sem policy de INSERT/UPDATE/DELETE => anon/authenticated não escrevem, mesmo
-- com GRANT. O REVOKE abaixo é defesa em profundidade (e deixa explícito).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.realtime_sinal FROM anon, authenticated;
GRANT  SELECT ON public.realtime_sinal TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3) Função de trigger — emite o sinal e faz a limpeza barata
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: roda como dono da função, então grava em realtime_sinal
-- apesar do REVOKE de INSERT para anon. O canal é passado como argumento do
-- trigger (TG_ARGV[0]) para uma função só servir as duas tabelas.
CREATE OR REPLACE FUNCTION public.fn_emitir_sinal_realtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_canal  text   := TG_ARGV[0];
  v_ref_id bigint;
BEGIN
  IF v_canal = 'ticket' THEN
    v_ref_id := COALESCE(NEW.id, OLD.id);
  ELSE  -- 'mensagem'
    v_ref_id := COALESCE(NEW.ticket_id, OLD.ticket_id);
  END IF;

  INSERT INTO public.realtime_sinal (canal, ref_id, evento)
  VALUES (v_canal, v_ref_id, TG_OP);

  -- Limpeza sem depender de pg_cron: mantém a tabela pequena. O sinal só
  -- interessa por segundos (é gatilho de re-fetch imediato); 10 min é folga
  -- larga. Barato porque a tabela nunca cresce muito entre as varridas.
  DELETE FROM public.realtime_sinal WHERE em < now() - interval '10 minutes';

  RETURN NULL;  -- AFTER trigger: valor de retorno é ignorado
END;
$$;

COMMENT ON FUNCTION public.fn_emitir_sinal_realtime() IS
  'SEC-05b/realtime: grava 1 linha em realtime_sinal a cada INSERT/UPDATE de ticket/mensagem (canal via TG_ARGV[0]) e poda linhas > 10 min.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4) Triggers
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sinal_ticket ON public.ticket;
CREATE TRIGGER trg_sinal_ticket
  AFTER INSERT OR UPDATE ON public.ticket
  FOR EACH ROW EXECUTE FUNCTION public.fn_emitir_sinal_realtime('ticket');

DROP TRIGGER IF EXISTS trg_sinal_mensagem ON public.mensagem;
CREATE TRIGGER trg_sinal_mensagem
  AFTER INSERT OR UPDATE ON public.mensagem
  FOR EACH ROW EXECUTE FUNCTION public.fn_emitir_sinal_realtime('mensagem');


-- ────────────────────────────────────────────────────────────────────────────
-- 5) Publicação no Realtime
-- ────────────────────────────────────────────────────────────────────────────
-- `ALTER PUBLICATION ... ADD/DROP TABLE` dá erro se o estado já for o
-- desejado — os guards deixam a migration reaplicável.
--
-- Também tira `ticket` e `mensagem` da publicação: desde o SEC-05b o Realtime
-- não entrega mais eventos delas (a RLS nega sem o header), então continuar
-- publicando-as só gasta decodificação de WAL à toa e confunde quem for
-- diagnosticar. Todo o "ao vivo" passa a ser via `realtime_sinal`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'realtime_sinal'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.realtime_sinal;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'ticket'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.ticket;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'mensagem'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.mensagem;
  END IF;
END $$;


-- ============================================================================
-- ROLLBACK (se algo quebrar em produção, isto devolve o estado anterior;
-- os canais do front voltam a depender só do poll, sem erro)
-- ----------------------------------------------------------------------------
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_publication_tables
--                 WHERE pubname='supabase_realtime' AND schemaname='public'
--                   AND tablename='realtime_sinal') THEN
--       ALTER PUBLICATION supabase_realtime DROP TABLE public.realtime_sinal;
--     END IF;
--   END $$;
--   DROP TRIGGER IF EXISTS trg_sinal_ticket   ON public.ticket;
--   DROP TRIGGER IF EXISTS trg_sinal_mensagem ON public.mensagem;
--   DROP FUNCTION IF EXISTS public.fn_emitir_sinal_realtime();
--   DROP TABLE IF EXISTS public.realtime_sinal;
--   -- e, se quiser mesmo o estado anterior, devolver ticket/mensagem à publicação:
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket, public.mensagem;
-- ============================================================================
