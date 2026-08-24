-- =====================================================================
-- DSos — BASELINE DO SCHEMA (schema public)
-- =====================================================================
--
-- O QUE E ESTE ARQUIVO
-- --------------------
-- Retrato completo do schema `public` de PRODUCAO, transformado em DDL
-- versionado. Ele NAO foi executado no banco: descreve o estado que o
-- banco ja tinha quando foi gerado.
--
-- POR QUE ELE EXISTE (DB-01)
-- --------------------------
-- Ate aqui, cerca de 100 migrations existiam apenas no historico interno
-- do Supabase (`supabase_migrations.schema_migrations`). Nada disso estava
-- no git: sem revisao, sem diff, sem como reconstruir o banco a partir do
-- repositorio. O custo real disso ja apareceu — a protecao da coluna
-- `pc.senha`, aplicada em 2026-06-22, foi desfeita em 2026-07-28 pela
-- migration `reabrir_select_pc_sem_quebrar_front`, que ninguem revisou;
-- so foi descoberta numa auditoria, um mes depois.
-- Este baseline fecha essa lacuna: daqui pra frente todo o schema tem
-- representacao em codigo, e qualquer mudanca aparece como diff.
--
-- COMO FOI GERADO
-- ---------------
-- Extraido do catalogo do proprio Postgres de producao (somente leitura),
-- via ferramentas MCP do Supabase, em 2026-08-23:
--   pg_class, pg_attribute, pg_attrdef, pg_constraint, pg_indexes,
--   pg_get_viewdef, pg_get_functiondef, pg_get_triggerdef, pg_policies,
--   information_schema.role_table_grants / role_column_grants,
--   pg_publication_rel, pg_extension, pg_enum, pg_sequence.
-- `supabase db pull` nao foi usado: a CLI nao esta instalada nesta maquina
-- e nao ha sessao autenticada (`~/.supabase` so tem telemetria), e o
-- comando exigiria login + senha do banco.
--
-- O timestamp `20260101000000` e deliberadamente anterior a qualquer
-- migration versionada, para que este arquivo seja sempre o primeiro a
-- rodar numa reconstrucao.
--
-- O QUE ELE **NAO** COBRE
-- -----------------------
--   * Dados. Nenhuma linha de nenhuma tabela — inclusive nenhum hash de
--     senha, token de sessao ou codigo OTP.
--   * Segredos. `GROQ_KEY`, chaves de API, connection strings, service
--     role key: nada disso esta aqui nem deve estar.
--   * Configuracao do projeto Supabase: Auth (providers, templates de
--     email, JWT), Storage (o bucket `chat-prints` e seus limites),
--     Realtime (habilitacao por projeto), Edge Functions e seus secrets,
--     cron jobs, webhooks, restricoes de rede, PITR/backups.
--   * Schemas gerenciados pelo Supabase: `auth`, `storage`, `realtime`,
--     `vault`, `extensions`, `supabase_migrations`. Deles, so o que o DSos
--     criou por cima aparece aqui (a policy de INSERT em storage.objects).
--   * Roles e senhas de banco.
--   * O schema `backup_20260823`, que e um snapshot pontual de auditoria
--     e nao faz parte do schema da aplicacao.
--   * Valores correntes das sequences (`setval`), que dependem dos dados.
--
-- COMO USAR
-- ---------
--   * Reconstrucao do zero (projeto Supabase novo/vazio): rode este
--     arquivo primeiro, depois as migrations posteriores em ordem.
--   * Em PRODUCAO nao se roda este arquivo — o banco ja esta neste estado.
--     Para registra-lo no historico sem executar:
--       supabase migration repair --status applied 20260101000000
--   * Os comandos foram escritos para serem reexecutaveis (IF NOT EXISTS,
--     CREATE OR REPLACE, DROP ... IF EXISTS antes de recriar). A secao de
--     GRANTs comeca com REVOKE proposital: ela precisa anular os
--     privilegios amplos que o Supabase concede por padrao a `anon` e
--     `authenticated`, senao o baseline reproduziria um banco mais aberto
--     do que a producao. Leia a secao 10 antes de roda-la em qualquer
--     banco que ja tenha uso.
--
-- =====================================================================


-- =====================================================================
-- 1. EXTENSOES
-- =====================================================================
-- pgcrypto: crypt()/gen_salt() dos hashes de senha e gen_random_bytes()
--           dos tokens de sessao.
-- pg_trgm:  indices GIN trigram da busca por substring nos logs.

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto            WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm             WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"         WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements  WITH SCHEMA extensions;
-- plpgsql (pg_catalog) e supabase_vault (vault) ja vem no projeto Supabase.


-- =====================================================================
-- 2. TIPOS ENUMERADOS
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'prioridade_nivel') THEN
    CREATE TYPE public.prioridade_nivel AS ENUM ('baixo', 'medio', 'alto');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'ticket_status') THEN
    CREATE TYPE public.ticket_status AS ENUM ('aberto', 'em_andamento', 'resolvido',
                                              'descartado', 'falso_alarme', 'aguardando_peca');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'tipo_problema') THEN
    CREATE TYPE public.tipo_problema AS ENUM ('hardware', 'software', 'periferico', 'rede', 'outro');
  END IF;
END $$;


-- =====================================================================
-- 3. SEQUENCES
-- =====================================================================
-- Todas com os parametros padrao (START 1, INCREMENT 1, CACHE 1, NO CYCLE).
-- O vinculo com a coluna (OWNED BY) fica na secao 4, depois das tabelas.

CREATE SEQUENCE IF NOT EXISTS public.acesso_log_id_seq              AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.alteracoes_criticas_log_id_seq AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.atividades_log_id_seq          AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.audit_log_id_seq               AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.auditoria_ti_id_seq            AS integer;
CREATE SEQUENCE IF NOT EXISTS public.login_tentativas_id_seq        AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.mensagem_id_seq                AS integer;
CREATE SEQUENCE IF NOT EXISTS public.operacoes_massa_log_id_seq     AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.otp_ti_id_seq                  AS integer;
CREATE SEQUENCE IF NOT EXISTS public.pc_id_seq                      AS integer;
CREATE SEQUENCE IF NOT EXISTS public.professor_id_seq               AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.ticket_id_seq                  AS integer;
CREATE SEQUENCE IF NOT EXISTS public.usuario_ti_id_seq              AS integer;
