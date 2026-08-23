-- PERF-03 / DB-03 (auditoria DSos): busca por substring nos logs.
--
-- Toda busca de texto do painel de logs usa `ilike.%termo%` (buildUrl em
-- js/painel-logs.js e a busca global). Um padrão com curinga nas DUAS pontas
-- não pode ser atendido por índice btree — o Postgres cai em varredura
-- sequencial sempre, por mais índices que existam nessas colunas.
--
-- Era esse o vínculo entre PERF-03 e DB-03: a auditoria via ~20 índices
-- "não utilizados" nas tabelas de log e sugeria removê-los ou ajustar a UI.
-- A leitura correta é outra: os índices btree de igualdade não serviam para
-- a consulta que a UI realmente faz. A saída é dar ao Postgres um índice do
-- tipo certo, e não abrir mão da busca por substring — que é o que o usuário
-- espera ao digitar num campo de filtro.
--
-- pg_trgm indexa trigramas e é justamente o que atende LIKE/ILIKE com
-- curinga em ambos os lados. Criados apenas para as 4 colunas que a UI de
-- fato filtra por texto (uma por aba), para não inflar a escrita à toa.
--
-- Testado antes de aplicar: com enable_seqscan desligado (necessário porque
-- com ~58 linhas o planner prefere seq scan de qualquer forma), o EXPLAIN da
-- consulta real da UI passa a mostrar
--   Bitmap Heap Scan -> Bitmap Index Scan on idx_trgm_acesso_usuario
--   Index Cond: (usuario_login ~~* '%joao%')
-- ou seja, o índice é utilizável pela consulta.
--
-- SOBRE OS ÍNDICES "NÃO UTILIZADOS" (DB-03): nenhum foi removido, de
-- propósito. Nesta base TODOS aparecem com idx_scan = 0 — inclusive os
-- criados agora para as chaves estrangeiras — porque as tabelas têm dezenas
-- de linhas e, nesse volume, varredura sequencial é sempre mais barata que
-- índice. idx_scan = 0 aqui indica "tabela pequena", não "índice inútil".
-- Removê-los agora só reintroduziria o problema quando o volume crescer,
-- que é exatamente quando eles passam a valer. A decisão deve ser retomada
-- com dados de uso reais, depois de a base ter volume representativo.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_trgm_auditoria_login
  ON public.auditoria_ti USING gin (login extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_trgm_audit_tabela
  ON public.audit_log USING gin (tabela_afetada extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_trgm_acesso_usuario
  ON public.acesso_log USING gin (usuario_login extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_trgm_criticas_tabela
  ON public.alteracoes_criticas_log USING gin (tabela extensions.gin_trgm_ops);
