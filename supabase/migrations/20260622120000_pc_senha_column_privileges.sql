-- Defesa em profundidade: impedir que as roles `anon` / `authenticated` leiam
-- diretamente a coluna public.pc.senha pela API REST
-- (ex.: GET /rest/v1/pc?select=senha).
--
-- Espelha o que já foi feito para public.usuario_ti: a proteção passa a ser por
-- PRIVILÉGIO DE COLUNA, não por RLS. A policy `pc_select` (USING true) continua
-- como está. A coluna `senha` (em bcrypt) é escrita apenas via RPCs SECURITY
-- DEFINER (rpc_cadastrar_pc / rpc_atualizar_pc) e lida no login por rpc_login_pc
-- — todas rodam como owner e NÃO são afetadas por revogar SELECT na coluna.
--
-- Os UPDATEs/PATCH diretos em `pc` (status_pc, laboratorio, lado) usam o
-- privilégio de UPDATE + a policy de update, que NÃO são tocados aqui. (No app,
-- esses PATCH foram ajustados para `Prefer: return=minimal` para não tentarem
-- devolver a coluna `senha` no RETURNING.)

-- 1) Remove o GRANT SELECT amplo (nível de tabela).
REVOKE SELECT ON public.pc FROM anon, authenticated;

-- 2) Reconcede SELECT em TODAS as colunas EXCETO `senha`.
--    A lista é montada dinamicamente para não precisar hardcodar as colunas;
--    apenas `senha` fica de fora.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'pc'
    AND column_name <> 'senha';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'Nenhuma coluna encontrada em public.pc (abortando).';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON public.pc TO anon, authenticated', v_cols);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO (rodar manualmente no SQL Editor; NÃO faz parte da migration):
--
--   SET ROLE anon;
--     SELECT senha FROM public.pc LIMIT 1;            -- deve dar permission denied
--     SELECT id, laboratorio, lado, tag, status_pc
--       FROM public.pc LIMIT 1;                       -- deve funcionar
--     SELECT * FROM public.v_pc_pub LIMIT 1;          -- deve retornar linhas
--   RESET ROLE;
--
-- Conferir quem ainda enxerga a coluna `senha` (deve sobrar só owner/service_role):
--
--   SELECT grantee, privilege_type
--     FROM information_schema.column_privileges
--    WHERE table_schema='public' AND table_name='pc' AND column_name='senha';
--
-- Se `anon`/`authenticated`/`PUBLIC` ainda aparecerem acima, existe um GRANT extra
-- (ex.: para PUBLIC) que também precisa de REVOKE.
-- ─────────────────────────────────────────────────────────────────────────────
