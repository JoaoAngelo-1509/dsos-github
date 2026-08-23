-- SEC-04 (auditoria DSos): professor.senha_hash é lida por qualquer pessoa
-- com a anon key via REST (GET /rest/v1/professor?select=senha_hash).
--
-- information_schema.table_privileges confirmou GRANT SELECT em nível de
-- TABELA para anon/authenticated em public.professor (diferente de pc e
-- usuario_ti, que já tinham proteção por privilégio de coluna). Login de
-- professor é feito via rpc_login_professor (SECURITY DEFINER, não afetada
-- por privilégio de coluna). O único SELECT direto em professor no
-- frontend já lista colunas explicitamente (id,nome,login,disciplina), sem
-- senha_hash — confirmado via busca em todo js/. professor não tem policy
-- de UPDATE (só SELECT/DELETE), então, diferente de pc, não sofre do
-- problema de "UPDATE exige SELECT em nível de tabela" descrito na
-- migration mover_pc_senha_para_tabela_separada.sql — REVOKE em nível de
-- tabela + GRANT por coluna funciona sem ressalvas aqui.

-- ATENÇÃO ao mexer nisto depois: `REVOKE SELECT ON <tabela>` derruba também
-- os privilégios de COLUNA já concedidos, não apenas o privilégio de tabela.
-- Ou seja, rodar só o REVOKE deixa anon sem ler NADA de professor e quebra a
-- listagem de professores no painel. O GRANT coluna a coluna abaixo tem que
-- vir sempre junto — foi o que aconteceu, e foi corrigido, durante os testes
-- de regressão desta auditoria.
REVOKE SELECT ON public.professor FROM anon, authenticated;

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'professor'
    AND column_name <> 'senha_hash';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'Nenhuma coluna encontrada em public.professor (abortando).';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON public.professor TO anon, authenticated', v_cols);
END $$;

-- Validação (rodar manualmente, não faz parte da migration):
--   SELECT has_column_privilege('anon','public.professor','senha_hash','SELECT'); -- deve ser false
--   SELECT has_column_privilege('anon','public.professor','nome','SELECT');       -- deve ser true
