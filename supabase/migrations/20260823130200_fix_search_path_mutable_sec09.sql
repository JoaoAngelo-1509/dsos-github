-- SEC-09 (auditoria DSos): funções sem search_path fixo.
--
-- O advisor de segurança do Supabase reportava ~78 ocorrências de
-- function_search_path_mutable (59 delas SECURITY DEFINER, incluindo
-- rpc_login_professor e a maioria das RPCs de negócio). Função
-- SECURITY DEFINER sem SET search_path explícito é vulnerável ao vetor
-- clássico de escalonamento de privilégio do Postgres: um atacante que
-- consiga manipular o search_path da sessão injeta um objeto com o mesmo
-- nome de uma tabela/função referenciada dentro da função, que passa a
-- executar com os privilégios do dono.
--
-- Aplicado em lote (varrendo pg_proc) em vez de função a função, para não
-- deixar nenhuma para trás e não depender de manter uma lista manual.
--
-- Por que `extensions` está no search_path e não só `public, pg_temp`:
-- 4 funções (rpc_login_professor, rpc_cadastrar_professor x2,
-- rpc_atualizar_professor) chamam crypt()/gen_salt() SEM qualificar com
-- `extensions.`, diferente das RPCs de pc/ti. Fixar o path sem
-- `extensions` quebraria o login de professor e o cadastro/atualização de
-- professor com "function crypt does not exist". Incluir o schema é o
-- padrão recomendado pelo Supabase e resolve o achado do advisor do mesmo
-- jeito — o que importa é o path ser FIXO, não mutável pela sessão.
--
-- Testado em transação com ROLLBACK antes de aplicar: após o ALTER em
-- massa, rpc_login_professor e rpc_login_pc respondem normalmente a
-- credencial inválida (0 linhas, sem erro), e um ciclo real de
-- rpc_cadastrar_pc + rpc_login_pc (que exercita gen_salt e crypt de fato)
-- retorna 1 linha. Contagem de funções sem search_path após o lote: 0.

DO $$
DECLARE r record; v_count int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'search_path fixado em % funcoes', v_count;
END $$;

-- Validação (rodar manualmente, não faz parte da migration):
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.prokind IN ('f','p')
--     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c
--                     WHERE c LIKE 'search_path=%');   -- deve ser 0
