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


-- ============ TABELAS ============

CREATE TABLE IF NOT EXISTS public.acesso_log (
  id bigint NOT NULL DEFAULT nextval('acesso_log_id_seq'::regclass),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  usuario_id integer,
  usuario_tipo text,
  usuario_login text,
  usuario_nome text,
  status_login text,
  motivo_falha text,
  ip_address text,
  user_agent text,
  sessao_id text,
  duracao_sessao interval);

CREATE TABLE IF NOT EXISTS public.alteracoes_criticas_log (
  id bigint NOT NULL DEFAULT nextval('alteracoes_criticas_log_id_seq'::regclass),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  usuario_id integer,
  usuario_tipo text,
  usuario_login text,
  tabela text,
  registro_id integer,
  campo_alterado text,
  valor_anterior text,
  valor_novo text,
  motivo text,
  aprovado boolean DEFAULT false,
  ip_address text);

CREATE TABLE IF NOT EXISTS public.atividades_log (
  id bigint NOT NULL DEFAULT nextval('atividades_log_id_seq'::regclass),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  usuario_id integer,
  usuario_tipo text,
  usuario_login text,
  usuario_nome text,
  modulo text,
  acao text,
  descricao_amigavel text,
  ticket_id integer,
  pc_id integer,
  impacto text,
  ip_address text);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint NOT NULL DEFAULT nextval('audit_log_id_seq'::regclass),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  tipo_acao text NOT NULL,
  tabela_afetada text NOT NULL,
  usuario_id integer,
  usuario_tipo text,
  usuario_login text,
  usuario_nome text,
  registro_id integer,
  antes_json jsonb,
  depois_json jsonb,
  ip_address text,
  user_agent text,
  status text DEFAULT 'sucesso'::text,
  erro_msg text,
  detalhes text);

CREATE TABLE IF NOT EXISTS public.auditoria_ti (
  id integer NOT NULL DEFAULT nextval('auditoria_ti_id_seq'::regclass),
  acao text NOT NULL,
  usuario_id integer,
  login text,
  nome text,
  executado_em timestamp with time zone NOT NULL DEFAULT now(),
  detalhes text);

CREATE TABLE IF NOT EXISTS public.login_tentativas (
  id bigint NOT NULL DEFAULT nextval('login_tentativas_id_seq'::regclass),
  identificador text NOT NULL,
  ip text,
  chave text NOT NULL,
  tentou_em timestamp with time zone NOT NULL DEFAULT now(),
  sucesso boolean NOT NULL DEFAULT false);

CREATE TABLE IF NOT EXISTS public.mensagem (
  id integer NOT NULL DEFAULT nextval('mensagem_id_seq'::regclass),
  ticket_id integer NOT NULL,
  remetente text NOT NULL,
  conteudo text,
  enviado_em timestamp with time zone NOT NULL DEFAULT now(),
  imagem_url text,
  lido_ti boolean NOT NULL DEFAULT false,
  lido_pc boolean NOT NULL DEFAULT false,
  nome_remetente text);

CREATE TABLE IF NOT EXISTS public.operacoes_massa_log (
  id bigint NOT NULL DEFAULT nextval('operacoes_massa_log_id_seq'::regclass),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  usuario_id integer,
  usuario_tipo text,
  usuario_login text,
  operacao text,
  quantidade_registros integer,
  tabelas_afetadas text[],
  filtro_aplicado jsonb,
  resultado_resumo text,
  status text);

CREATE TABLE IF NOT EXISTS public.otp_ti (
  id integer NOT NULL DEFAULT nextval('otp_ti_id_seq'::regclass),
  ti_id integer NOT NULL,
  codigo text NOT NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  expira_em timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  usado boolean NOT NULL DEFAULT false);

CREATE TABLE IF NOT EXISTS public.pc (
  id integer NOT NULL DEFAULT nextval('pc_id_seq'::regclass),
  laboratorio text NOT NULL,
  lado character(1) NOT NULL,
  tag text,
  status_pc text NOT NULL DEFAULT 'ativo'::text);

CREATE TABLE IF NOT EXISTS public.pc_senha (
  pc_id integer NOT NULL,
  senha text NOT NULL);

CREATE TABLE IF NOT EXISTS public.professor (
  id bigint NOT NULL DEFAULT nextval('professor_id_seq'::regclass),
  nome text NOT NULL,
  login text NOT NULL,
  senha_hash text NOT NULL,
  disciplina text,
  criado_em timestamp with time zone DEFAULT now(),
  ti_id integer);

CREATE TABLE IF NOT EXISTS public.sessao_ativa (
  usuario_id integer NOT NULL,
  usuario_tipo text NOT NULL,
  usuario_login text NOT NULL,
  usuario_nome text,
  iniciado_em timestamp with time zone NOT NULL DEFAULT now(),
  ultimo_ping timestamp with time zone NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS public.sessao_token (
  token text NOT NULL,
  usuario_id bigint NOT NULL,
  usuario_tipo text NOT NULL,
  usuario_login text,
  usuario_nome text,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  expira_em timestamp with time zone NOT NULL DEFAULT (now() + '12:00:00'::interval));

CREATE TABLE IF NOT EXISTS public.ticket (
  id integer NOT NULL DEFAULT nextval('ticket_id_seq'::regclass),
  pc_origem integer NOT NULL,
  pc_problema integer NOT NULL,
  tipo tipo_problema NOT NULL,
  descricao text,
  prioridade prioridade_nivel,
  status ticket_status NOT NULL DEFAULT 'aberto'::ticket_status,
  tecnico_responsavel integer,
  laboratorio text NOT NULL,
  aberto_em timestamp with time zone NOT NULL DEFAULT now(),
  resolvido_em timestamp with time zone,
  resolucao text,
  item_descartado text,
  lado text,
  descricao_resolucao text,
  nome_solicitante text,
  chamado_emergencia boolean NOT NULL DEFAULT false,
  nota_interna text,
  avaliacao smallint,
  avaliacao_comentario text);

CREATE TABLE IF NOT EXISTS public.usuario_ti (
  id integer NOT NULL DEFAULT nextval('usuario_ti_id_seq'::regclass),
  login text NOT NULL,
  senha text NOT NULL,
  nome text,
  email text,
  is_professor boolean NOT NULL DEFAULT false,
  professor_id bigint,
  presenca text NOT NULL DEFAULT 'ausente'::text);

-- ============ CONSTRAINTS ============

ALTER TABLE public.acesso_log ADD CONSTRAINT acesso_log_pkey PRIMARY KEY (id);
ALTER TABLE public.alteracoes_criticas_log ADD CONSTRAINT alteracoes_criticas_log_pkey PRIMARY KEY (id);
ALTER TABLE public.atividades_log ADD CONSTRAINT atividades_log_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.auditoria_ti ADD CONSTRAINT auditoria_ti_pkey PRIMARY KEY (id);
ALTER TABLE public.login_tentativas ADD CONSTRAINT login_tentativas_pkey PRIMARY KEY (id);
ALTER TABLE public.mensagem ADD CONSTRAINT mensagem_pkey PRIMARY KEY (id);
ALTER TABLE public.mensagem ADD CONSTRAINT mensagem_remetente_check CHECK ((remetente = ANY (ARRAY['PC'::text, 'TI'::text])));
ALTER TABLE public.mensagem ADD CONSTRAINT mensagem_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE;
ALTER TABLE public.operacoes_massa_log ADD CONSTRAINT operacoes_massa_log_pkey PRIMARY KEY (id);
ALTER TABLE public.otp_ti ADD CONSTRAINT otp_ti_pkey PRIMARY KEY (id);
ALTER TABLE public.otp_ti ADD CONSTRAINT otp_ti_ti_id_fkey FOREIGN KEY (ti_id) REFERENCES usuario_ti(id) ON DELETE CASCADE;
ALTER TABLE public.pc ADD CONSTRAINT pc_lado_check CHECK ((lado = ANY (ARRAY['A'::bpchar, 'B'::bpchar])));
ALTER TABLE public.pc ADD CONSTRAINT pc_pkey PRIMARY KEY (id);
ALTER TABLE public.pc ADD CONSTRAINT pc_status_pc_check CHECK ((status_pc = ANY (ARRAY['ativo'::text, 'em_manutencao'::text, 'descartado'::text])));
ALTER TABLE public.pc ADD CONSTRAINT pc_tag_key UNIQUE (tag);
ALTER TABLE public.pc_senha ADD CONSTRAINT pc_senha_pc_id_fkey FOREIGN KEY (pc_id) REFERENCES pc(id) ON DELETE CASCADE;
ALTER TABLE public.pc_senha ADD CONSTRAINT pc_senha_pkey PRIMARY KEY (pc_id);
ALTER TABLE public.professor ADD CONSTRAINT professor_login_key UNIQUE (login);
ALTER TABLE public.professor ADD CONSTRAINT professor_pkey PRIMARY KEY (id);
ALTER TABLE public.professor ADD CONSTRAINT professor_ti_id_fkey FOREIGN KEY (ti_id) REFERENCES usuario_ti(id) ON DELETE SET NULL;
ALTER TABLE public.sessao_ativa ADD CONSTRAINT sessao_ativa_pkey PRIMARY KEY (usuario_id, usuario_tipo);
ALTER TABLE public.sessao_token ADD CONSTRAINT sessao_token_pkey PRIMARY KEY (token);
ALTER TABLE public.sessao_token ADD CONSTRAINT sessao_token_usuario_tipo_check CHECK ((usuario_tipo = ANY (ARRAY['ti'::text, 'pc'::text, 'professor'::text])));
ALTER TABLE public.ticket ADD CONSTRAINT ticket_avaliacao_check CHECK (((avaliacao >= 1) AND (avaliacao <= 5)));
ALTER TABLE public.ticket ADD CONSTRAINT ticket_pc_origem_fkey FOREIGN KEY (pc_origem) REFERENCES pc(id);
ALTER TABLE public.ticket ADD CONSTRAINT ticket_pc_problema_fkey FOREIGN KEY (pc_problema) REFERENCES pc(id);
ALTER TABLE public.ticket ADD CONSTRAINT ticket_pkey PRIMARY KEY (id);
ALTER TABLE public.ticket ADD CONSTRAINT ticket_resolucao_check CHECK ((resolucao = ANY (ARRAY['consertado'::text, 'descarte'::text, 'aguardando_peca'::text])));
ALTER TABLE public.ticket ADD CONSTRAINT ticket_tecnico_responsavel_fkey FOREIGN KEY (tecnico_responsavel) REFERENCES usuario_ti(id);
ALTER TABLE public.usuario_ti ADD CONSTRAINT usuario_ti_login_key UNIQUE (login);
ALTER TABLE public.usuario_ti ADD CONSTRAINT usuario_ti_pkey PRIMARY KEY (id);
ALTER TABLE public.usuario_ti ADD CONSTRAINT usuario_ti_presenca_check CHECK ((presenca = ANY (ARRAY['online'::text, 'em campo'::text, 'ausente'::text])));
ALTER TABLE public.usuario_ti ADD CONSTRAINT usuario_ti_professor_id_fkey FOREIGN KEY (professor_id) REFERENCES professor(id) ON DELETE SET NULL;

-- ============ INDICES ============

CREATE INDEX idx_acesso_log_ip ON public.acesso_log USING btree (ip_address);
CREATE INDEX idx_acesso_log_status ON public.acesso_log USING btree (status_login);
CREATE INDEX idx_acesso_log_timestamp ON public.acesso_log USING btree ("timestamp" DESC);
CREATE INDEX idx_acesso_log_usuario_id ON public.acesso_log USING btree (usuario_id);
CREATE INDEX idx_acesso_usuario_timestamp ON public.acesso_log USING btree (usuario_id, "timestamp" DESC);
CREATE INDEX idx_alteracoes_criticas_campo ON public.alteracoes_criticas_log USING btree (campo_alterado);
CREATE INDEX idx_alteracoes_criticas_registro ON public.alteracoes_criticas_log USING btree (registro_id);
CREATE INDEX idx_alteracoes_criticas_tabela ON public.alteracoes_criticas_log USING btree (tabela);
CREATE INDEX idx_alteracoes_criticas_usuario ON public.alteracoes_criticas_log USING btree (usuario_id);
CREATE INDEX idx_alteracoes_tabela_timestamp ON public.alteracoes_criticas_log USING btree (tabela, "timestamp" DESC);
CREATE INDEX idx_alteracoes_timestamp ON public.alteracoes_criticas_log USING btree ("timestamp" DESC);
CREATE INDEX idx_atividades_log_acao ON public.atividades_log USING btree (acao);
CREATE INDEX idx_atividades_log_impacto ON public.atividades_log USING btree (impacto);
CREATE INDEX idx_atividades_log_modulo ON public.atividades_log USING btree (modulo);
CREATE INDEX idx_atividades_log_pc_id ON public.atividades_log USING btree (pc_id);
CREATE INDEX idx_atividades_log_ticket_id ON public.atividades_log USING btree (ticket_id);
CREATE INDEX idx_atividades_log_timestamp ON public.atividades_log USING btree ("timestamp" DESC);
CREATE INDEX idx_atividades_log_usuario ON public.atividades_log USING btree (usuario_id, usuario_tipo);
CREATE INDEX idx_atividades_log_usuario_id ON public.atividades_log USING btree (usuario_id);
CREATE INDEX idx_atividades_modulo_timestamp ON public.atividades_log USING btree (modulo, "timestamp" DESC);
CREATE INDEX idx_atividades_usuario_timestamp ON public.atividades_log USING btree (usuario_id, "timestamp" DESC);
CREATE INDEX idx_audit_log_registro_id ON public.audit_log USING btree (registro_id);
CREATE INDEX idx_audit_log_tabela ON public.audit_log USING btree (tabela_afetada);
CREATE INDEX idx_audit_log_timestamp ON public.audit_log USING btree ("timestamp" DESC);
CREATE INDEX idx_audit_log_tipo_acao ON public.audit_log USING btree (tipo_acao);
CREATE INDEX idx_audit_log_usuario ON public.audit_log USING btree (usuario_id, usuario_tipo);
CREATE INDEX idx_audit_log_usuario_id ON public.audit_log USING btree (usuario_id);
CREATE INDEX idx_login_tentativas_chave_tempo ON public.login_tentativas USING btree (chave, tentou_em DESC);
CREATE INDEX idx_mensagem_ticket_id ON public.mensagem USING btree (ticket_id);
CREATE INDEX idx_operacoes_timestamp ON public.operacoes_massa_log USING btree ("timestamp" DESC);
CREATE INDEX idx_otp_ti_ti_id ON public.otp_ti USING btree (ti_id);
CREATE INDEX idx_professor_ti_id ON public.professor USING btree (ti_id);
CREATE INDEX idx_sessao_token_expira ON public.sessao_token USING btree (expira_em);
CREATE INDEX idx_ticket_nome_solicitante ON public.ticket USING btree (nome_solicitante);
CREATE INDEX idx_ticket_pc_origem ON public.ticket USING btree (pc_origem);
CREATE INDEX idx_ticket_pc_problema ON public.ticket USING btree (pc_problema);
CREATE INDEX idx_ticket_tecnico_responsavel ON public.ticket USING btree (tecnico_responsavel);
CREATE INDEX idx_trgm_acesso_usuario ON public.acesso_log USING gin (usuario_login extensions.gin_trgm_ops);
CREATE INDEX idx_trgm_audit_tabela ON public.audit_log USING gin (tabela_afetada extensions.gin_trgm_ops);
CREATE INDEX idx_trgm_auditoria_login ON public.auditoria_ti USING gin (login extensions.gin_trgm_ops);
CREATE INDEX idx_trgm_criticas_tabela ON public.alteracoes_criticas_log USING gin (tabela extensions.gin_trgm_ops);
CREATE UNIQUE INDEX idx_usuario_ti_email ON public.usuario_ti USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_usuario_ti_professor_id ON public.usuario_ti USING btree (professor_id);

-- ============ VIEWS ============

CREATE OR REPLACE VIEW public.v_alteracoes_criticas_recentes WITH (security_invoker=true) AS
 SELECT id,
    "timestamp",
    usuario_tipo,
    usuario_login,
    tabela,
    registro_id,
    campo_alterado,
    valor_anterior,
    valor_novo,
    motivo
   FROM alteracoes_criticas_log
  ORDER BY "timestamp" DESC
 LIMIT 100;

CREATE OR REPLACE VIEW public.v_atividades_por_modulo WITH (security_invoker=true) AS
 SELECT modulo,
    count(*) AS total_atividades,
    max("timestamp") AS ultima_atividade,
    string_agg(DISTINCT acao, ', '::text) AS tipos_acao
   FROM atividades_log
  GROUP BY modulo
  ORDER BY (count(*)) DESC;

CREATE OR REPLACE VIEW public.v_atividades_por_usuario WITH (security_invoker=true) AS
 SELECT usuario_tipo,
    usuario_login,
    usuario_nome,
    count(*) AS total_atividades,
    max("timestamp") AS ultima_atividade,
    string_agg(DISTINCT modulo, ', '::text) AS modulos_acessados
   FROM atividades_log
  GROUP BY usuario_tipo, usuario_login, usuario_nome
  ORDER BY (count(*)) DESC;

CREATE OR REPLACE VIEW public.v_atividades_recentes WITH (security_invoker=true) AS
 SELECT id,
    "timestamp",
    usuario_tipo,
    usuario_login,
    usuario_nome,
    modulo,
    acao,
    descricao_amigavel,
    ticket_id,
    pc_id,
    impacto
   FROM atividades_log
  ORDER BY "timestamp" DESC
 LIMIT 500;

CREATE OR REPLACE VIEW public.v_logins_recentes WITH (security_invoker=true) AS
 SELECT id,
    "timestamp",
    usuario_tipo,
    usuario_login,
    usuario_nome,
    status_login,
    motivo_falha,
    ip_address
   FROM acesso_log
  ORDER BY "timestamp" DESC
 LIMIT 200;

CREATE OR REPLACE VIEW public.v_operacoes_massa_recentes WITH (security_invoker=true) AS
 SELECT id,
    "timestamp",
    usuario_tipo,
    usuario_login,
    operacao,
    quantidade_registros,
    resultado_resumo,
    status
   FROM operacoes_massa_log
  ORDER BY "timestamp" DESC
 LIMIT 100;

CREATE OR REPLACE VIEW public.v_pc_pub WITH (security_invoker=true) AS
 SELECT id,
    tag,
    laboratorio,
    lado,
    status_pc
   FROM pc;

CREATE OR REPLACE VIEW public.v_pcs_mais_incidentes WITH (security_invoker=true) AS
 SELECT pc_id,
    count(*) AS total_incidentes,
    min("timestamp") AS primeiro_incidente,
    max("timestamp") AS ultimo_incidente,
    string_agg(DISTINCT modulo, ', '::text) AS tipos_incidente
   FROM atividades_log
  WHERE pc_id IS NOT NULL
  GROUP BY pc_id
  ORDER BY (count(*)) DESC
 LIMIT 50;

CREATE OR REPLACE VIEW public.v_resumo_diario_atividades WITH (security_invoker=true) AS
 SELECT date("timestamp") AS data,
    count(*) AS total_atividades,
    count(DISTINCT usuario_id) AS usuarios_ativos,
    count(DISTINCT usuario_tipo) AS tipos_usuario,
    string_agg(DISTINCT modulo, ', '::text) AS modulos_utilizados
   FROM atividades_log
  GROUP BY (date("timestamp"))
  ORDER BY (date("timestamp")) DESC
 LIMIT 90;

CREATE OR REPLACE VIEW public.v_tickets_mais_movimentados WITH (security_invoker=true) AS
 SELECT ticket_id,
    count(*) AS total_movimentacoes,
    min("timestamp") AS criado_em,
    max("timestamp") AS ultima_movimentacao,
    string_agg(DISTINCT modulo, ', '::text) AS envolvidos
   FROM atividades_log
  WHERE ticket_id IS NOT NULL
  GROUP BY ticket_id
  ORDER BY (count(*)) DESC
 LIMIT 50;

CREATE OR REPLACE VIEW public.v_usuario_ti_pub WITH (security_invoker=true) AS
 SELECT id,
    login,
    nome,
    email,
    is_professor,
    presenca
   FROM usuario_ti;

CREATE OR REPLACE VIEW public.v_usuarios_mais_ativos WITH (security_invoker=true) AS
 SELECT usuario_id,
    usuario_tipo,
    usuario_login,
    usuario_nome,
    count(*) AS total_atividades,
    count(DISTINCT date("timestamp")) AS dias_ativo,
    max("timestamp") AS ultima_atividade
   FROM atividades_log
  WHERE usuario_id IS NOT NULL
  GROUP BY usuario_id, usuario_tipo, usuario_login, usuario_nome
  ORDER BY (count(*)) DESC
 LIMIT 50;

-- ============ FUNCOES E RPCs ============

CREATE OR REPLACE FUNCTION public._exportar_ddl_baseline()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH
tabelas AS (
  SELECT string_agg(
    format('CREATE TABLE IF NOT EXISTS public.%I (%s);', c.relname,
      (SELECT string_agg(format(E'\n  %I %s%s%s', a.attname,
              format_type(a.atttypid,a.atttypmod),
              CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
              CASE WHEN d.adbin IS NOT NULL THEN ' DEFAULT '||pg_get_expr(d.adbin,d.adrelid) ELSE '' END),
              ',' ORDER BY a.attnum)
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    ), E'\n\n' ORDER BY c.relname) AS s
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
),
constraints AS (
  SELECT string_agg(format('ALTER TABLE public.%I ADD CONSTRAINT %I %s;',
           c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid)), E'\n' ORDER BY c.conrelid::regclass::text, c.conname) AS s
  FROM pg_constraint c WHERE c.connamespace='public'::regnamespace
),
indices AS (
  SELECT string_agg(i.indexdef||';', E'\n' ORDER BY i.indexname) AS s
  FROM pg_indexes i WHERE i.schemaname='public'
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname=i.indexname AND c.connamespace='public'::regnamespace)
),
views AS (
  SELECT string_agg(format('CREATE OR REPLACE VIEW public.%I%s AS%s',
           c.relname,
           CASE WHEN EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions,'{}')) o WHERE o LIKE 'security_invoker%')
                THEN ' WITH (security_invoker=true)' ELSE '' END,
           E'\n'||pg_get_viewdef(c.oid,true)), E'\n\n' ORDER BY c.relname) AS s
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'
),
funcoes AS (
  SELECT string_agg(pg_get_functiondef(p.oid)||';', E'\n\n' ORDER BY p.proname, p.oid) AS s
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
),
triggers AS (
  SELECT string_agg(pg_get_triggerdef(t.oid)||';', E'\n' ORDER BY t.tgname) AS s
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
),
rls AS (
  SELECT string_agg(format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', c.relname), E'\n' ORDER BY c.relname) AS s
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
),
policies AS (
  SELECT string_agg(format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s;',
           p.policyname,p.tablename,p.permissive,p.cmd,array_to_string(p.roles,', '),
           coalesce(E'\n  USING ('||p.qual||')',''),
           coalesce(E'\n  WITH CHECK ('||p.with_check||')','')), E'\n\n' ORDER BY p.tablename,p.policyname) AS s
  FROM pg_policies p WHERE p.schemaname='public'
),
grants_tab AS (
  SELECT string_agg(format('GRANT %s ON public.%I TO %I;', privilege_type, table_name, grantee), E'\n' ORDER BY table_name, grantee, privilege_type) AS s
  FROM information_schema.table_privileges
  WHERE table_schema='public' AND grantee IN ('anon','authenticated')
),
grants_col AS (
  SELECT string_agg(format('GRANT %s (%I) ON public.%I TO %I;', privilege_type, column_name, table_name, grantee), E'\n' ORDER BY table_name, column_name, grantee) AS s
  FROM information_schema.column_privileges
  WHERE table_schema='public' AND grantee IN ('anon','authenticated')
    AND table_name NOT IN (SELECT table_name FROM information_schema.table_privileges
                            WHERE table_schema='public' AND grantee IN ('anon','authenticated') AND privilege_type='SELECT')
)
SELECT concat_ws(E'\n\n',
 '-- ============ TABELAS ============', (SELECT s FROM tabelas),
 '-- ============ CONSTRAINTS ============', (SELECT s FROM constraints),
 '-- ============ INDICES ============', (SELECT s FROM indices),
 '-- ============ VIEWS ============', (SELECT s FROM views),
 '-- ============ FUNCOES E RPCs ============', (SELECT s FROM funcoes),
 '-- ============ TRIGGERS ============', (SELECT s FROM triggers),
 '-- ============ RLS ============', (SELECT s FROM rls),
 '-- ============ POLICIES ============', (SELECT s FROM policies),
 '-- ============ GRANTS DE TABELA ============', (SELECT s FROM grants_tab),
 '-- ============ GRANTS DE COLUNA ============', (SELECT s FROM grants_col)
);
$function$
;

CREATE OR REPLACE FUNCTION public.fn_check_login_unico()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'professor' THEN
    IF EXISTS (
      SELECT 1 FROM public.usuario_ti
      WHERE login = NEW.login AND (is_professor = FALSE OR is_professor IS NULL)
    ) THEN
      RAISE EXCEPTION 'Login "%" já existe como usuário T.I. Use um login diferente.', NEW.login;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'usuario_ti' THEN
    IF NOT (NEW.is_professor = TRUE) THEN
      IF EXISTS (SELECT 1 FROM public.professor WHERE login = NEW.login) THEN
        RAISE EXCEPTION 'Login "%" já existe como professor. Use um login diferente.', NEW.login;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_emitir_token(p_usuario_id bigint, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_token text;
BEGIN
  DELETE FROM public.sessao_token WHERE expira_em < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.sessao_token(token, usuario_id, usuario_tipo, usuario_login, usuario_nome)
  VALUES (v_token, p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome);
  RETURN v_token;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_impedir_ultimo_ti()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT COUNT(*) FROM public.usuario_ti) <= 1 THEN
    RAISE EXCEPTION
      'Operação bloqueada: não é possível remover o único usuário T.I. cadastrado.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_sessao_do_token(p_token text)
 RETURNS sessao_token
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.sessao_token;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN RAISE EXCEPTION 'sessao ausente'; END IF;
  SELECT * INTO v FROM public.sessao_token WHERE token = p_token AND expira_em > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'sessao invalida ou expirada'; END IF;
  RETURN v;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_sessao_nome()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.usuario_nome FROM public.sessao_token s
   WHERE s.token = public.fn_sessao_token_header() AND s.expira_em > now();
$function$
;

CREATE OR REPLACE FUNCTION public.fn_sessao_tipo()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.usuario_tipo FROM public.sessao_token s
   WHERE s.token = public.fn_sessao_token_header() AND s.expira_em > now();
$function$
;

CREATE OR REPLACE FUNCTION public.fn_sessao_token_header()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT nullif(current_setting('request.headers', true)::jsonb ->> 'x-sessao-token', '');
$function$
;

CREATE OR REPLACE FUNCTION public.fn_sessao_uid()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.usuario_id FROM public.sessao_token s
   WHERE s.token = public.fn_sessao_token_header() AND s.expira_em > now();
$function$
;

CREATE OR REPLACE FUNCTION public.fn_set_ticket_laboratorio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  SELECT laboratorio INTO NEW.laboratorio
  FROM pc WHERE id = NEW.pc_problema;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_acesso(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_status_login text, p_motivo_falha text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_sessao_id text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO acesso_log (
    usuario_id, usuario_tipo, usuario_login, usuario_nome,
    status_login, motivo_falha, ip_address, user_agent, sessao_id
  ) VALUES (
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    p_status_login, p_motivo_falha, p_ip_address, p_user_agent, p_sessao_id
  ) RETURNING id INTO v_id;

  -- NOVO: espelha em auditoria_ti login de TI bem-sucedido
  IF p_usuario_tipo IN ('TI', 'ti') AND p_status_login = 'sucesso' AND p_usuario_id IS NOT NULL THEN
    INSERT INTO auditoria_ti (
      acao, usuario_id, login, nome,
      detalhes
    ) VALUES (
      'ACESSO.LOGIN',
      p_usuario_id,
      p_usuario_login,
      p_usuario_nome,
      'Login realizado' || CASE WHEN p_ip_address IS NOT NULL THEN ' de ' || p_ip_address ELSE '' END
    );
  END IF;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_alteracao_critica(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_tabela text, p_registro_id integer, p_campo_alterado text, p_valor_anterior text, p_valor_novo text, p_motivo text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO alteracoes_criticas_log (
    usuario_id, usuario_tipo, usuario_login, tabela, registro_id,
    campo_alterado, valor_anterior, valor_novo, motivo, ip_address
  ) VALUES (
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_tabela, p_registro_id,
    p_campo_alterado, p_valor_anterior, p_valor_novo, p_motivo, p_ip_address
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_atividade(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_modulo text, p_acao text, p_descricao_amigavel text, p_ticket_id integer DEFAULT NULL::integer, p_pc_id integer DEFAULT NULL::integer, p_impacto text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO atividades_log (
    usuario_id, usuario_tipo, usuario_login, usuario_nome,
    modulo, acao, descricao_amigavel, ticket_id, pc_id, impacto, ip_address
  ) VALUES (
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    p_modulo, p_acao, p_descricao_amigavel, p_ticket_id, p_pc_id, p_impacto, p_ip_address
  ) RETURNING id INTO v_id;

  -- NOVO: espelha em auditoria_ti quando a ação é iniciada por TI
  -- (exclui ações automáticas de SISTEMA ou do próprio PC)
  IF p_usuario_tipo IN ('TI', 'ti') AND p_usuario_id IS NOT NULL THEN
    INSERT INTO auditoria_ti (
      acao, usuario_id, login, nome, detalhes
    ) VALUES (
      p_modulo || '.' || p_acao,
      p_usuario_id,
      p_usuario_login,
      p_usuario_nome,
      p_descricao_amigavel
    );
  END IF;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_audit_log(p_tipo_acao text, p_tabela_afetada text, p_usuario_id integer DEFAULT NULL::integer, p_usuario_tipo text DEFAULT NULL::text, p_usuario_login text DEFAULT NULL::text, p_usuario_nome text DEFAULT NULL::text, p_registro_id integer DEFAULT NULL::integer, p_antes_json jsonb DEFAULT NULL::jsonb, p_depois_json jsonb DEFAULT NULL::jsonb, p_ip_address text DEFAULT NULL::text, p_detalhes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO audit_log (
    tipo_acao, tabela_afetada, usuario_id, usuario_tipo, usuario_login, usuario_nome,
    registro_id, antes_json, depois_json, ip_address, detalhes
  ) VALUES (
    p_tipo_acao, p_tabela_afetada, p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    p_registro_id, p_antes_json, p_depois_json, p_ip_address, p_detalhes
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_operacao_massa(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_operacao text, p_quantidade integer, p_tabelas_afetadas text[], p_resultado_resumo text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO operacoes_massa_log (
    usuario_id, usuario_tipo, usuario_login, operacao,
    quantidade_registros, tabelas_afetadas, resultado_resumo, status
  ) VALUES (
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_operacao,
    p_quantidade, p_tabelas_afetadas, p_resultado_resumo, 'completada'
  ) RETURNING id INTO v_id;

  -- NOVO: espelha em auditoria_ti
  IF p_usuario_id IS NOT NULL THEN
    INSERT INTO auditoria_ti (
      acao, usuario_id, login, nome, detalhes
    ) VALUES (
      'OPERACAO.' || p_operacao,
      p_usuario_id,
      p_usuario_login,
      NULL,
      p_resultado_resumo || ' — tabelas: ' || array_to_string(p_tabelas_afetadas, ', ')
    );
  END IF;

  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_pc(p_id integer, p_status_pc text, p_nova_senha text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pc SET status_pc = p_status_pc WHERE id = p_id;
  IF p_nova_senha IS NOT NULL AND p_nova_senha <> '' THEN
    UPDATE public.pc_senha
      SET senha = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10))
      WHERE pc_id = p_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_professor(p_id bigint, p_nome text, p_disciplina text DEFAULT NULL::text, p_nova_senha text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE professor
  SET
    nome       = p_nome,
    disciplina = p_disciplina,
    senha_hash = CASE
      WHEN p_nova_senha IS NOT NULL AND length(p_nova_senha) >= 4
        THEN crypt(p_nova_senha, gen_salt('bf'))
      ELSE senha_hash
    END
  WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_ti(p_id integer, p_nome text, p_nova_senha text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.usuario_ti SET nome = p_nome WHERE id = p_id;

  IF p_email IS NOT NULL THEN
    UPDATE public.usuario_ti SET email = NULLIF(trim(p_email), '') WHERE id = p_id;
  END IF;

  IF p_nova_senha IS NOT NULL AND length(trim(p_nova_senha)) >= 4 THEN
    UPDATE public.usuario_ti
      SET senha = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10))
      WHERE id = p_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_ti(p_id integer, p_nome text, p_nova_senha text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_is_professor boolean DEFAULT NULL::boolean, p_disciplina text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_login text;
  v_senha text;        -- hash atual em usuario_ti.senha
  v_atual_is_prof boolean;
  v_prof_hash text;    -- hash bcrypt a usar para professor.senha_hash
BEGIN
  SELECT login, senha, is_professor INTO v_login, v_senha, v_atual_is_prof
  FROM public.usuario_ti WHERE id = p_id;

  -- por padrão reaproveita o hash já existente (nunca re-hashear um hash)
  v_prof_hash := v_senha;

  UPDATE public.usuario_ti SET nome = p_nome WHERE id = p_id;

  IF p_email IS NOT NULL THEN
    UPDATE public.usuario_ti SET email = NULLIF(trim(p_email), '') WHERE id = p_id;
  END IF;

  IF p_nova_senha IS NOT NULL AND length(trim(p_nova_senha)) >= 4 THEN
    v_prof_hash := extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10));
    UPDATE public.usuario_ti SET senha = v_prof_hash WHERE id = p_id;
  END IF;

  IF p_is_professor IS NOT NULL THEN
    UPDATE public.usuario_ti SET is_professor = p_is_professor WHERE id = p_id;

    IF p_is_professor AND NOT v_atual_is_prof THEN
      IF NOT EXISTS (SELECT 1 FROM public.professor WHERE login = v_login) THEN
        INSERT INTO public.professor (login, nome, senha_hash, disciplina, ti_id)
        VALUES (v_login, p_nome, v_prof_hash, p_disciplina, p_id);
      ELSE
        UPDATE public.professor SET ti_id = p_id, nome = p_nome WHERE login = v_login;
      END IF;
    ELSIF NOT p_is_professor AND v_atual_is_prof THEN
      UPDATE public.professor SET ti_id = NULL WHERE ti_id = p_id;
    ELSIF p_is_professor AND v_atual_is_prof THEN
      UPDATE public.professor
        SET nome = p_nome,
            disciplina = COALESCE(p_disciplina, disciplina)
      WHERE ti_id = p_id;
    END IF;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_ti(p_id integer, p_nome text, p_nova_senha text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_is_prof BOOLEAN;
  v_prof_id BIGINT;
BEGIN
  SELECT is_professor, professor_id INTO v_is_prof, v_prof_id
  FROM public.usuario_ti WHERE id = p_id;

  IF p_nova_senha IS NOT NULL AND p_nova_senha <> '' THEN
    UPDATE public.usuario_ti
      SET nome = p_nome,
          senha = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10))
      WHERE id = p_id;
    IF v_is_prof AND v_prof_id IS NOT NULL THEN
      UPDATE public.professor
        SET nome = p_nome,
            senha_hash = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10))
        WHERE id = v_prof_id;
    END IF;
  ELSE
    UPDATE public.usuario_ti SET nome = p_nome WHERE id = p_id;
    IF v_is_prof AND v_prof_id IS NOT NULL THEN
      UPDATE public.professor SET nome = p_nome WHERE id = v_prof_id;
    END IF;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_avaliar_ticket(p_token text, p_ticket_id bigint, p_nota integer, p_comentario text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_pc(p_tag text, p_laboratorio text, p_lado text, p_senha text)
 RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id integer;
BEGIN
  INSERT INTO public.pc(tag, laboratorio, lado, status_pc)
  VALUES (UPPER(p_tag), p_laboratorio, p_lado::CHAR, 'ativo')
  RETURNING pc.id INTO v_id;

  INSERT INTO public.pc_senha(pc_id, senha)
  VALUES (v_id, extensions.crypt(p_senha, extensions.gen_salt('bf', 10)));

  RETURN QUERY SELECT p.id, p.tag, p.laboratorio, p.lado, p.status_pc
    FROM public.pc p WHERE p.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_professor(p_login text, p_nome text, p_senha text, p_disciplina text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO professor (login, nome, senha_hash, disciplina)
  VALUES (p_login, p_nome, crypt(p_senha, gen_salt('bf')), p_disciplina);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_professor(p_login text, p_nome text, p_senha text, p_disciplina text DEFAULT NULL::text, p_is_ti boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_prof_id BIGINT;
  v_ti_id   INT;
BEGIN
  INSERT INTO public.professor(login, nome, senha_hash, disciplina)
  VALUES (p_login, p_nome, crypt(p_senha, gen_salt('bf')), p_disciplina)
  RETURNING id INTO v_prof_id;

  IF p_is_ti THEN
    INSERT INTO public.usuario_ti(login, nome, senha, is_professor, professor_id)
    VALUES (p_login, p_nome, p_senha, TRUE, v_prof_id)
    RETURNING id INTO v_ti_id;

    UPDATE public.professor SET ti_id = v_ti_id WHERE id = v_prof_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_ti(p_login text, p_nome text, p_senha text, p_email text DEFAULT NULL::text, p_is_professor boolean DEFAULT false, p_disciplina text DEFAULT NULL::text)
 RETURNS TABLE(id integer, login text, nome text, is_professor boolean, professor_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_ti_id   INT;
  v_prof_id BIGINT;
BEGIN
  INSERT INTO public.usuario_ti(login, nome, senha, is_professor)
  VALUES (p_login, p_nome, extensions.crypt(p_senha, extensions.gen_salt('bf', 10)), p_is_professor)
  RETURNING public.usuario_ti.id INTO v_ti_id;

  IF p_is_professor THEN
    INSERT INTO public.professor(login, nome, senha_hash, disciplina)
    VALUES (p_login, p_nome, extensions.crypt(p_senha, extensions.gen_salt('bf', 10)), p_disciplina)
    RETURNING public.professor.id INTO v_prof_id;

    UPDATE public.usuario_ti SET professor_id = v_prof_id WHERE public.usuario_ti.id = v_ti_id;
  END IF;

  RETURN QUERY
    SELECT u.id, u.login, u.nome, u.is_professor, u.professor_id
    FROM public.usuario_ti u WHERE u.id = v_ti_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_check_rate_limit(p_identificador text, p_ip text DEFAULT 'unknown'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_chave        text;
  v_janela_inicio timestamptz;
  v_bloqueio_inicio timestamptz;
  v_tentativas   int;
  v_falhas_recentes int;
  v_ultima_tentativa timestamptz;
  v_segundos_restantes int;
BEGIN
  v_chave         := lower(p_identificador) || '|' || coalesce(p_ip, 'unknown');
  v_janela_inicio := now() - interval '60 seconds';
  v_bloqueio_inicio := now() - interval '15 minutes';

  -- Limpa registros antigos (> 24h) para manter a tabela enxuta
  DELETE FROM public.login_tentativas
  WHERE tentou_em < now() - interval '24 hours';

  -- Conta falhas nos últimos 15 minutos (janela de bloqueio)
  SELECT COUNT(*), MAX(tentou_em)
  INTO v_falhas_recentes, v_ultima_tentativa
  FROM public.login_tentativas
  WHERE chave = v_chave
    AND sucesso = false
    AND tentou_em >= v_bloqueio_inicio;

  -- Se tem 5+ falhas nos últimos 15min → ainda bloqueado?
  IF v_falhas_recentes >= 5 THEN
    -- Pega o momento da 5ª falha (a mais antiga dentro das 5 que bloquearam)
    SELECT tentou_em INTO v_ultima_tentativa
    FROM public.login_tentativas
    WHERE chave = v_chave
      AND sucesso = false
      AND tentou_em >= v_bloqueio_inicio
    ORDER BY tentou_em ASC
    OFFSET 4
    LIMIT 1;

    IF v_ultima_tentativa IS NOT NULL THEN
      v_segundos_restantes := GREATEST(0,
        900 - EXTRACT(EPOCH FROM (now() - v_ultima_tentativa))::int
      );
      IF v_segundos_restantes > 0 THEN
        RETURN jsonb_build_object(
          'bloqueado', true,
          'segundos_restantes', v_segundos_restantes,
          'tentativas', v_falhas_recentes
        );
      END IF;
    END IF;
  END IF;

  -- Conta tentativas na janela de 60s (para o limite por minuto)
  SELECT COUNT(*)
  INTO v_tentativas
  FROM public.login_tentativas
  WHERE chave = v_chave
    AND sucesso = false
    AND tentou_em >= v_janela_inicio;

  IF v_tentativas >= 5 THEN
    RETURN jsonb_build_object(
      'bloqueado', true,
      'segundos_restantes', 60,
      'tentativas', v_tentativas
    );
  END IF;

  RETURN jsonb_build_object(
    'bloqueado', false,
    'tentativas', v_tentativas
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_check_ticket_rate_limit(p_pc_id integer DEFAULT NULL::integer, p_professor_login text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_janela_inicio  timestamptz;
  v_abertos        int;
  v_ticket_mais_antigo timestamptz;
  v_segundos_restantes int;
BEGIN
  v_janela_inicio := now() - interval '5 minutes';

  IF p_pc_id IS NOT NULL THEN
    -- Conta tickets abertos pelo PC nos últimos 5 minutos
    SELECT COUNT(*), MIN(aberto_em)
    INTO v_abertos, v_ticket_mais_antigo
    FROM public.ticket
    WHERE pc_origem = p_pc_id
      AND aberto_em >= v_janela_inicio;

  ELSIF p_professor_login IS NOT NULL THEN
    -- Conta tickets abertos pelo professor nos últimos 5 minutos
    SELECT COUNT(*), MIN(aberto_em)
    INTO v_abertos, v_ticket_mais_antigo
    FROM public.ticket
    WHERE nome_solicitante = p_professor_login
      AND aberto_em >= v_janela_inicio;

  ELSE
    RETURN jsonb_build_object('bloqueado', false, 'abertos', 0);
  END IF;

  IF v_abertos >= 5 THEN
    -- Tempo até o ticket mais antigo da janela completar 5 minutos
    v_segundos_restantes := GREATEST(0,
      300 - EXTRACT(EPOCH FROM (now() - v_ticket_mais_antigo))::int
    );

    IF v_segundos_restantes > 0 THEN
      RETURN jsonb_build_object(
        'bloqueado',           true,
        'abertos',             v_abertos,
        'segundos_restantes',  v_segundos_restantes
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'bloqueado', false,
    'abertos',   v_abertos
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_confirmar_descarte_fisico(p_ticket_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_ticket ticket%ROWTYPE; v_pc_id bigint;
BEGIN
  SELECT * INTO v_ticket FROM ticket WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket não encontrado'; END IF;
  IF v_ticket.resolucao != 'descarte' THEN
    RAISE EXCEPTION 'Apenas tickets de descarte podem ser confirmados';
  END IF;
  IF v_ticket.item_descartado IS NULL OR trim(v_ticket.item_descartado) = '' THEN
    RAISE EXCEPTION 'Item descartado não especificado';
  END IF;
  IF lower(v_ticket.item_descartado) LIKE '%pc%completo%' OR
     lower(v_ticket.item_descartado) LIKE '%computador%' THEN
    UPDATE pc SET status_pc = 'descartado' WHERE id = v_ticket.pc_problema;
    v_pc_id := v_ticket.pc_problema;
  ELSE v_pc_id := NULL; END IF;
  UPDATE ticket SET status = 'descartado' WHERE id = p_ticket_id;
  RETURN json_build_object('success', true, 'pc_descartado', v_pc_id IS NOT NULL);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_deletar_pc(p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.mensagem
    WHERE ticket_id IN (
      SELECT id FROM public.ticket
      WHERE pc_origem = p_id OR pc_problema = p_id
    );
  DELETE FROM public.ticket
    WHERE pc_origem = p_id OR pc_problema = p_id;
  DELETE FROM public.pc WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_deletar_professor(p_professor_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ticket 
  WHERE status IN ('aberto', 'em_andamento') 
    AND EXISTS (SELECT 1 FROM professor p WHERE p.id = p_professor_id 
                AND nome_solicitante ILIKE '%' || p.nome || '%');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Professor possui % ticket(s) em aberto', v_count;
  END IF;
  DELETE FROM professor WHERE id = p_professor_id;
  RETURN json_build_object('success', true);
END; $function$
;

CREATE OR REPLACE FUNCTION public.rpc_deletar_ti(p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_count  INTEGER;
  v_login  TEXT;
  v_nome   TEXT;
BEGIN
  -- Conta quantos T.I. existem atualmente
  SELECT COUNT(*) INTO v_count FROM public.usuario_ti;

  IF v_count <= 1 THEN
    RAISE EXCEPTION
      'Não é possível remover o único usuário T.I. Cadastre outro antes de remover este.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Captura dados antes de deletar (para audit log)
  SELECT login, nome INTO v_login, v_nome
  FROM public.usuario_ti
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário T.I. com id % não encontrado.', p_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Deleta o usuário
  DELETE FROM public.usuario_ti WHERE id = p_id;

  -- Registra no audit log
  INSERT INTO public.auditoria_ti (acao, usuario_id, login, nome, detalhes)
  VALUES (
    'DELETE',
    p_id,
    v_login,
    v_nome,
    'Usuário T.I. removido via rpc_deletar_ti'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_executar_limpeza(p_dias integer DEFAULT 30)
 RETURNS TABLE(tickets_deletados bigint, mensagens_deletadas bigint, nomes_imagens text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_imgs      TEXT[];
  v_n_tickets BIGINT;
  v_n_msgs    BIGINT;
  v_cutoff    TIMESTAMPTZ;
BEGIN
  v_cutoff := CASE 
    WHEN p_dias >= 9999 THEN '1970-01-01'::TIMESTAMPTZ
    ELSE NOW() - (p_dias || ' days')::INTERVAL
  END;

  SELECT ARRAY_AGG(DISTINCT SUBSTRING(m.imagem_url FROM '[^/]+$'))
  INTO v_imgs
  FROM public.mensagem m
  JOIN public.ticket t ON t.id = m.ticket_id
  WHERE t.status IN ('resolvido', 'descartado', 'falso_alarme')
    AND t.resolvido_em IS NOT NULL
    AND t.resolvido_em >= v_cutoff
    AND m.imagem_url IS NOT NULL;

  SELECT COUNT(*) INTO v_n_msgs
  FROM public.mensagem m
  JOIN public.ticket t ON t.id = m.ticket_id
  WHERE t.status IN ('resolvido', 'descartado', 'falso_alarme')
    AND t.resolvido_em IS NOT NULL
    AND t.resolvido_em >= v_cutoff;

  WITH del AS (
    DELETE FROM public.ticket
    WHERE status IN ('resolvido', 'descartado', 'falso_alarme')
      AND resolvido_em IS NOT NULL
      AND resolvido_em >= v_cutoff
    RETURNING id
  ) SELECT COUNT(*) INTO v_n_tickets FROM del;

  RETURN QUERY SELECT v_n_tickets, v_n_msgs, COALESCE(v_imgs, '{}');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_gerar_otp_ti(p_ti_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_email   text;
  v_nome    text;
  v_codigo  text;
BEGIN
  -- Busca email do técnico
  SELECT email, nome INTO v_email, v_nome
  FROM public.usuario_ti
  WHERE id = p_ti_id;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN json_build_object('ok', false, 'erro', 'sem_email');
  END IF;

  -- Invalida OTPs anteriores não usados deste técnico
  UPDATE public.otp_ti
  SET usado = true
  WHERE ti_id = p_ti_id AND usado = false;

  -- Limpa OTPs expirados de todos (limpeza oportunística)
  DELETE FROM public.otp_ti WHERE expira_em < now();

  -- Gera código de 6 dígitos
  v_codigo := lpad((floor(random() * 1000000))::text, 6, '0');

  -- Insere novo OTP
  INSERT INTO public.otp_ti (ti_id, codigo, criado_em, expira_em, usado)
  VALUES (p_ti_id, v_codigo, now(), now() + interval '10 minutes', false);

  RETURN json_build_object(
    'ok',     true,
    'email',  v_email,
    'nome',   v_nome,
    'codigo', v_codigo  -- retornado para a Edge Function enviar por email
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_acesso_log(p_limite integer DEFAULT 100, p_offset integer DEFAULT 0, p_usuario_tipo text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, usuario_login text, usuario_nome text, status_login text, motivo_falha text, ip_address text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    acesso_log.id,
    acesso_log.timestamp,
    acesso_log.usuario_tipo,
    acesso_log.usuario_login,
    acesso_log.usuario_nome,
    acesso_log.status_login,
    acesso_log.motivo_falha,
    acesso_log.ip_address
  FROM acesso_log
  WHERE (p_usuario_tipo IS NULL OR acesso_log.usuario_tipo = p_usuario_tipo)
  ORDER BY acesso_log.timestamp DESC
  LIMIT p_limite
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_alteracoes_criticas(p_limite integer DEFAULT 100, p_offset integer DEFAULT 0, p_tabela text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, usuario_login text, tabela text, registro_id integer, campo_alterado text, valor_anterior text, valor_novo text, motivo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    alteracoes_criticas_log.id,
    alteracoes_criticas_log.timestamp,
    alteracoes_criticas_log.usuario_tipo,
    alteracoes_criticas_log.usuario_login,
    alteracoes_criticas_log.tabela,
    alteracoes_criticas_log.registro_id,
    alteracoes_criticas_log.campo_alterado,
    alteracoes_criticas_log.valor_anterior,
    alteracoes_criticas_log.valor_novo,
    alteracoes_criticas_log.motivo
  FROM alteracoes_criticas_log
  WHERE (p_tabela IS NULL OR alteracoes_criticas_log.tabela = p_tabela)
  ORDER BY alteracoes_criticas_log.timestamp DESC
  LIMIT p_limite
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_alteracoes_criticas_por_periodo(p_tabela text, p_dias_atras integer DEFAULT 30)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, usuario_login text, registro_id integer, campo_alterado text, valor_anterior text, valor_novo text, motivo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    alteracoes_criticas_log.id,
    alteracoes_criticas_log.timestamp,
    alteracoes_criticas_log.usuario_tipo,
    alteracoes_criticas_log.usuario_login,
    alteracoes_criticas_log.registro_id,
    alteracoes_criticas_log.campo_alterado,
    alteracoes_criticas_log.valor_anterior,
    alteracoes_criticas_log.valor_novo,
    alteracoes_criticas_log.motivo
  FROM alteracoes_criticas_log
  WHERE 
    alteracoes_criticas_log.tabela = p_tabela AND
    alteracoes_criticas_log.timestamp >= NOW() - (p_dias_atras || ' days')::INTERVAL
  ORDER BY alteracoes_criticas_log.timestamp DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_atividades_log(p_limite integer DEFAULT 100, p_offset integer DEFAULT 0, p_filtro_usuario_tipo text DEFAULT NULL::text, p_filtro_modulo text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, usuario_login text, usuario_nome text, modulo text, acao text, descricao text, ticket_id integer, pc_id integer, impacto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    atividades_log.id,
    atividades_log.timestamp,
    atividades_log.usuario_tipo,
    atividades_log.usuario_login,
    atividades_log.usuario_nome,
    atividades_log.modulo,
    atividades_log.acao,
    atividades_log.descricao_amigavel,
    atividades_log.ticket_id,
    atividades_log.pc_id,
    atividades_log.impacto
  FROM atividades_log
  WHERE 
    (p_filtro_usuario_tipo IS NULL OR atividades_log.usuario_tipo = p_filtro_usuario_tipo) AND
    (p_filtro_modulo IS NULL OR atividades_log.modulo = p_filtro_modulo)
  ORDER BY atividades_log.timestamp DESC
  LIMIT p_limite
  OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_atividades_ultimos_dias(p_dias integer DEFAULT 7)
 RETURNS TABLE(data date, total_atividades bigint, usuarios_ativos bigint, modulos_utilizados text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(atividades_log.timestamp),
    COUNT(*),
    COUNT(DISTINCT atividades_log.usuario_id),
    STRING_AGG(DISTINCT atividades_log.modulo, ', ')
  FROM atividades_log
  WHERE atividades_log.timestamp >= NOW() - (p_dias || ' days')::INTERVAL
  GROUP BY DATE(atividades_log.timestamp)
  ORDER BY DATE(atividades_log.timestamp) DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_auditoria_pc(p_pc_id integer)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, usuario_login text, usuario_nome text, modulo text, acao text, descricao text, impacto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    atividades_log.id,
    atividades_log.timestamp,
    atividades_log.usuario_tipo,
    atividades_log.usuario_login,
    atividades_log.usuario_nome,
    atividades_log.modulo,
    atividades_log.acao,
    atividades_log.descricao_amigavel,
    atividades_log.impacto
  FROM atividades_log
  WHERE atividades_log.pc_id = p_pc_id
  ORDER BY atividades_log.timestamp ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_auditoria_ticket(p_ticket_id integer)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, usuario_login text, usuario_nome text, modulo text, acao text, descricao text, impacto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    atividades_log.id,
    atividades_log.timestamp,
    atividades_log.usuario_tipo,
    atividades_log.usuario_login,
    atividades_log.usuario_nome,
    atividades_log.modulo,
    atividades_log.acao,
    atividades_log.descricao_amigavel,
    atividades_log.impacto
  FROM atividades_log
  WHERE atividades_log.ticket_id = p_ticket_id
  ORDER BY atividades_log.timestamp ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_estatisticas_logs()
 RETURNS TABLE(total_atividades bigint, total_logins bigint, logins_sucesso bigint, logins_falha bigint, total_alteracoes_criticas bigint, total_operacoes_massa bigint, usuarios_unicos bigint, modulos_utilizados bigint, periodo_dias integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM atividades_log) as total_atividades,
    (SELECT COUNT(*) FROM acesso_log) as total_logins,
    (SELECT COUNT(*) FROM acesso_log WHERE status_login = 'sucesso') as logins_sucesso,
    (SELECT COUNT(*) FROM acesso_log WHERE status_login = 'falha') as logins_falha,
    (SELECT COUNT(*) FROM alteracoes_criticas_log) as total_alteracoes_criticas,
    (SELECT COUNT(*) FROM operacoes_massa_log) as total_operacoes_massa,
    (SELECT COUNT(DISTINCT usuario_id) FROM atividades_log) as usuarios_unicos,
    (SELECT COUNT(DISTINCT modulo) FROM atividades_log) as modulos_utilizados,
    (SELECT EXTRACT(DAY FROM (NOW() - MIN(timestamp)))::INTEGER FROM atividades_log) as periodo_dias;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_logs_export(p_data_inicio date, p_data_fim date, p_tipo text DEFAULT 'atividades'::text)
 RETURNS TABLE(id bigint, timestamp_log timestamp with time zone, usuario_id integer, usuario_tipo text, usuario_login text, usuario_nome text, modulo text, acao text, descricao text, ticket_id integer, pc_id integer, impacto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF p_tipo = 'atividades' THEN
    RETURN QUERY
    SELECT 
      atividades_log.id,
      atividades_log.timestamp,
      atividades_log.usuario_id,
      atividades_log.usuario_tipo,
      atividades_log.usuario_login,
      atividades_log.usuario_nome,
      atividades_log.modulo,
      atividades_log.acao,
      atividades_log.descricao_amigavel,
      atividades_log.ticket_id,
      atividades_log.pc_id,
      atividades_log.impacto
    FROM atividades_log
    WHERE DATE(atividades_log.timestamp) BETWEEN p_data_inicio AND p_data_fim
    ORDER BY atividades_log.timestamp ASC;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_resumo_impacto()
 RETURNS TABLE(impacto text, total_atividades bigint, percentual_do_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_total BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM atividades_log WHERE impacto IS NOT NULL;
  
  RETURN QUERY
  SELECT 
    atividades_log.impacto,
    COUNT(*) as total,
    ROUND((COUNT(*) * 100.0 / NULLIF(v_total, 0))::NUMERIC, 2) as percentual
  FROM atividades_log
  WHERE atividades_log.impacto IS NOT NULL
  GROUP BY atividades_log.impacto
  ORDER BY total DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_tendencia_modulos()
 RETURNS TABLE(modulo text, total_atividades bigint, percentual_do_total numeric, ultima_atividade timestamp with time zone, tipos_acao text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_total BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM atividades_log;
  
  RETURN QUERY
  SELECT 
    atividades_log.modulo,
    COUNT(*) as total,
    ROUND((COUNT(*) * 100.0 / v_total)::NUMERIC, 2) as percentual,
    MAX(atividades_log.timestamp) as ultima,
    STRING_AGG(DISTINCT atividades_log.acao, ', ')
  FROM atividades_log
  GROUP BY atividades_log.modulo
  ORDER BY total DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_tentativas_login_usuario(p_usuario_login text)
 RETURNS TABLE(id bigint, ts timestamp with time zone, usuario_tipo text, status_login text, motivo_falha text, ip_address text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    acesso_log.id,
    acesso_log.timestamp,
    acesso_log.usuario_tipo,
    acesso_log.status_login,
    acesso_log.motivo_falha,
    acesso_log.ip_address
  FROM acesso_log
  WHERE acesso_log.usuario_login = p_usuario_login
  ORDER BY acesso_log.timestamp DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_get_top_usuarios_ativos()
 RETURNS TABLE(usuario_id integer, usuario_tipo text, usuario_login text, usuario_nome text, total_atividades bigint, ultima_atividade timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    atividades_log.usuario_id,
    atividades_log.usuario_tipo,
    atividades_log.usuario_login,
    atividades_log.usuario_nome,
    COUNT(*) as total,
    MAX(atividades_log.timestamp) as ultima
  FROM atividades_log
  WHERE atividades_log.usuario_id IS NOT NULL
  GROUP BY atividades_log.usuario_id, atividades_log.usuario_tipo, atividades_log.usuario_login, atividades_log.usuario_nome
  ORDER BY total DESC
  LIMIT 10;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_limpar_bloqueio(p_identificador text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM public.login_tentativas
  WHERE identificador = lower(p_identificador);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_limpar_logs(p_tabelas text[], p_threshold timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tabela text;
  _coluna text;
  _deletados int;
  _total int := 0;
  _resultado jsonb := '{}';
  _tabelas_validas text[] := ARRAY[
    'auditoria_ti','audit_log','atividades_log',
    'acesso_log','alteracoes_criticas_log','operacoes_massa_log'
  ];
  _colunas text[] := ARRAY[
    'executado_em','timestamp','timestamp',
    'timestamp','timestamp','timestamp'
  ];
BEGIN
  FOR i IN 1..array_length(p_tabelas, 1) LOOP
    _tabela := p_tabelas[i];

    -- Valida que só aceita tabelas permitidas
    IF NOT (_tabela = ANY(_tabelas_validas)) THEN
      CONTINUE;
    END IF;

    -- Descobre a coluna de data para essa tabela
    _coluna := _colunas[array_position(_tabelas_validas, _tabela)];

    IF p_threshold IS NULL THEN
      EXECUTE format('DELETE FROM %I WHERE %I IS NOT NULL', _tabela, _coluna);
    ELSE
      EXECUTE format('DELETE FROM %I WHERE %I < $1', _tabela, _coluna)
        USING p_threshold;
    END IF;

    GET DIAGNOSTICS _deletados = ROW_COUNT;
    _total := _total + _deletados;
    _resultado := _resultado || jsonb_build_object(_tabela, _deletados);
  END LOOP;

  _resultado := _resultado || jsonb_build_object('total', _total);
  RETURN _resultado;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_limpar_sessoes_mortas()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM sessao_ativa WHERE ultimo_ping < now() - INTERVAL '5 minutes';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_limpar_tickets_antigos(p_dias integer DEFAULT 365)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_count int; v_data timestamp;
BEGIN
  v_data := NOW() - (p_dias || ' days')::interval;
  WITH del AS (
    DELETE FROM ticket WHERE status IN ('resolvido', 'descartado', 'falso_alarme')
      AND resolvido_em < v_data RETURNING id
  ) SELECT COUNT(*) INTO v_count FROM del;
  RETURN json_build_object('success', true, 'deletados', v_count);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_abrir_chamado(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_tipo_problema text, p_laboratorio text, p_is_emergencia boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Tickets', 'ABRIR_CHAMADO',
    'Chamado #' || p_ticket_id || ' aberto - Tipo: ' || p_tipo_problema || 
    CASE WHEN p_is_emergencia THEN ' [EMERGÊNCIA]' ELSE '' END,
    p_ticket_id, NULL, 
    CASE WHEN p_is_emergencia THEN 'emergencia' ELSE 'normal' END
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_abrir_chamado(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_tipo_problema text, p_laboratorio text, p_is_emergencia boolean DEFAULT false, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ticket_id, impacto, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'tickets', 'abrir_chamado', 
          'Chamado aberto - Lab: ' || p_laboratorio || ' | Problema: ' || p_tipo_problema, p_ticket_id, 
          CASE WHEN p_is_emergencia THEN 'critico' ELSE 'normal' END, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Chamado registrado');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_alterar_status_chamado(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_status_anterior text, p_status_novo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Tickets', 'ALTERAR_STATUS',
    'Chamado #' || p_ticket_id || ' alterado de ' || p_status_anterior || ' para ' || p_status_novo,
    p_ticket_id, NULL, 'alteracao_status'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_alterar_status_chamado(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_status_anterior text, p_status_novo text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ticket_id, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'tickets', 'alterar_status_chamado',
          'Status alterado: ' || p_status_anterior || ' → ' || p_status_novo, p_ticket_id, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Alteração de status registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_alterar_status_pc(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_pc_tag text, p_status_anterior text, p_status_novo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Computadores', 'ALTERAR_STATUS',
    'PC ' || p_pc_tag || ' alterado de ' || p_status_anterior || ' para ' || p_status_novo,
    NULL, NULL, 'alteracao_status_pc'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_alterar_status_pc(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_pc_id integer, p_pc_tag text, p_status_anterior text, p_status_novo text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, pc_id, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'computadores', 'alterar_status_pc',
          'PC ' || p_pc_tag || ' status: ' || p_status_anterior || ' → ' || p_status_novo, p_pc_id, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Alteração de status do PC registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_atribuir_chamado(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_tecnico_atribuido text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Tickets', 'ATRIBUIR',
    'Chamado #' || p_ticket_id || ' atribuído ao técnico ' || p_tecnico_atribuido,
    p_ticket_id, NULL, 'atribuicao_tecnico'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_atribuir_chamado(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_tecnico_id integer, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ticket_id, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'tickets', 'atribuir_chamado',
          'Chamado atribuído ao técnico ID: ' || p_tecnico_id, p_ticket_id, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Atribuição de chamado registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_cadastrar_pc(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_pc_tag text, p_laboratorio text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Computadores', 'CADASTRAR',
    'Novo computador ' || p_pc_tag || ' cadastrado em ' || p_laboratorio,
    NULL, NULL, 'novo_pc'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_cadastrar_pc(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_pc_tag text, p_laboratorio text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'computadores', 'cadastrar_pc',
          'PC cadastrado - Tag: ' || p_pc_tag || ' | Lab: ' || p_laboratorio, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'PC registrado');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_cadastrar_professor(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_prof_login text, p_prof_nome text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'professores', 'cadastrar_professor',
          'Professor cadastrado: ' || p_prof_nome || ' (' || p_prof_login || ')', p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Professor registrado');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_cadastrar_usuario_ti(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_novo_tecnico_login text, p_novo_tecnico_nome text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Usuários', 'CADASTRAR',
    'Novo usuário T.I. ' || p_novo_tecnico_nome || ' (' || p_novo_tecnico_login || ') cadastrado',
    NULL, NULL, 'novo_usuario_ti'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_cadastrar_usuario_ti(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_novo_ti_login text, p_novo_ti_nome text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, impacto, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'usuarios_ti', 'cadastrar_usuario_ti',
          'Novo usuário T.I. cadastrado: ' || p_novo_ti_nome || ' (' || p_novo_ti_login || ')', 'critico', p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Usuário T.I. registrado');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_deletar_pc(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_pc_id integer, p_pc_tag text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, pc_id, impacto, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'computadores', 'deletar_pc',
          'PC deletado - Tag: ' || p_pc_tag || ' | ID: ' || p_pc_id, p_pc_id, 'critico', p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Deleção de PC registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_deletar_professor(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_prof_delete_id integer, p_prof_delete_login text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'professores', 'deletar_professor',
          'Professor deletado: ' || p_prof_delete_login || ' | ID: ' || p_prof_delete_id, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Deleção de professor registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_deletar_usuario_ti(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ti_delete_id integer, p_ti_delete_login text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, impacto, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'usuarios_ti', 'deletar_usuario_ti',
          'Usuário T.I. deletado: ' || p_ti_delete_login || ' | ID: ' || p_ti_delete_id, 'critico', p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Deleção de usuário T.I. registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_descarte_equipment(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_pc_tag text, p_item_descartado text, p_meio_descarte text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Descarte', 'REGISTRAR_DESCARTE',
    'PC ' || p_pc_tag || ' - Item: ' || p_item_descartado || ' - Meio: ' || p_meio_descarte,
    p_ticket_id, NULL, 'descarte_registrado'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_descarte_equipment(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_pc_tag text, p_item_descartado text, p_meio_descarte text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ticket_id, impacto, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'descarte', 'descarte_equipment',
          'Equipamento descartado: ' || p_item_descartado || ' | Meio: ' || p_meio_descarte || ' | PC: ' || p_pc_tag, p_ticket_id, 'critico', p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Descarte registrado');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_enviar_mensagem(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_tem_imagem boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_atividade(
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'Chat', 'ENVIAR_MENSAGEM',
    p_usuario_tipo || ' enviou mensagem no chamado #' || p_ticket_id || 
    CASE WHEN p_tem_imagem THEN ' (com imagem)' ELSE '' END,
    p_ticket_id, NULL, 'novo_comentario'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_enviar_mensagem(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_ticket_id integer, p_tem_imagem boolean DEFAULT false, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, ticket_id, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'mensagens', 'enviar_mensagem',
          'Mensagem enviada' || (CASE WHEN p_tem_imagem THEN ' com imagem' ELSE '' END), p_ticket_id, p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Mensagem registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_limpeza_banco(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_dias integer, p_tickets_deletados integer, p_mensagens_deletadas integer, p_imagens_deletadas integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN registrar_operacao_massa(
    p_usuario_id, p_usuario_tipo, p_usuario_login,
    'LIMPEZA_BANCO_' || p_dias || 'd',
    p_tickets_deletados + p_mensagens_deletadas,
    ARRAY['ticket', 'mensagem', 'storage'],
    'Deletados: ' || p_tickets_deletados || ' tickets, ' || p_mensagens_deletadas || ' mensagens, ' || p_imagens_deletadas || ' imagens'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_limpeza_banco(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_dias integer, p_tickets_deletados integer, p_mensagens_deletadas integer, p_imagens_deletadas integer, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO atividades_log (usuario_id, usuario_tipo, usuario_login, usuario_nome, modulo, acao, descricao_amigavel, impacto, ip_address)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome, 'manutencao', 'limpeza_banco',
          'Limpeza de banco realizada: ' || p_dias || ' dias | ' || p_tickets_deletados || ' tickets | ' || 
          p_mensagens_deletadas || ' mensagens | ' || p_imagens_deletadas || ' imagens deletadas', 'critico', p_ip_address);
  
  RETURN json_build_object('success', true, 'message', 'Limpeza registrada');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_login(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text, p_status_login text DEFAULT 'sucesso'::text, p_ip_address text DEFAULT NULL::text, p_sessao_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO acesso_log (
    usuario_id, usuario_tipo, usuario_login, usuario_nome,
    status_login, ip_address, sessao_id
  ) VALUES (
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    p_status_login, p_ip_address, p_sessao_id
  );
  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_login_falho(p_usuario_login text, p_motivo_falha text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO acesso_log (
    usuario_login, status_login, motivo_falha, ip_address
  ) VALUES (
    p_usuario_login, 'falha', p_motivo_falha, p_ip_address
  );
  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_log_logout(p_usuario_id integer DEFAULT NULL::integer, p_usuario_tipo text DEFAULT NULL::text, p_usuario_login text DEFAULT NULL::text, p_usuario_nome text DEFAULT NULL::text, p_sessao_id text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text, p_duracao_sessao text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_duracao   INTERVAL;
  v_login_id  bigint;
BEGIN
  -- tenta encontrar linha de login pelo sessao_id
  IF p_sessao_id IS NOT NULL THEN
    SELECT id, NOW() - "timestamp"
    INTO v_login_id, v_duracao
    FROM acesso_log
    WHERE sessao_id = p_sessao_id AND status_login = 'sucesso'
    ORDER BY "timestamp" DESC
    LIMIT 1;
  END IF;

  -- fallback: busca pelo login + tipo quando não há sessao_id
  IF v_login_id IS NULL AND p_usuario_login IS NOT NULL THEN
    SELECT id, NOW() - "timestamp"
    INTO v_login_id, v_duracao
    FROM acesso_log
    WHERE usuario_login  = p_usuario_login
      AND usuario_tipo   = p_usuario_tipo
      AND status_login   = 'sucesso'
      AND duracao_sessao IS NULL
    ORDER BY "timestamp" DESC
    LIMIT 1;
  END IF;

  -- fallback de duração: usa valor calculado no cliente
  IF v_duracao IS NULL AND p_duracao_sessao IS NOT NULL THEN
    v_duracao := p_duracao_sessao::INTERVAL;
  END IF;

  -- atualiza a linha de login com a duração real para parar o timer ao vivo
  IF v_login_id IS NOT NULL THEN
    UPDATE acesso_log
    SET duracao_sessao = v_duracao
    WHERE id = v_login_id;
  END IF;

  -- insere linha de logout
  INSERT INTO acesso_log (
    usuario_id, usuario_tipo, usuario_login, usuario_nome,
    status_login, ip_address, sessao_id, duracao_sessao
  ) VALUES (
    p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    'logout', p_ip_address, p_sessao_id, v_duracao
  );

  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_login_pc(p_tag text, p_senha text)
 RETURNS TABLE(id integer, tag text, laboratorio text, lado character, status_pc text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.pc;
BEGIN
  SELECT p.* INTO v FROM public.pc p
    JOIN public.pc_senha s ON s.pc_id = p.id
   WHERE p.tag = UPPER(p_tag) AND s.senha = extensions.crypt(p_senha, s.senha);
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v.id, v.tag, v.laboratorio, v.lado, v.status_pc,
    public.fn_emitir_token(v.id, 'pc', v.tag, v.tag);
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_login_professor(p_login text, p_senha text)
 RETURNS TABLE(id bigint, login text, nome text, disciplina text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.professor;
BEGIN
  SELECT * INTO v FROM public.professor p
   WHERE p.login = p_login AND p.senha_hash = extensions.crypt(p_senha, p.senha_hash);
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v.id, v.login, v.nome, v.disciplina,
    public.fn_emitir_token(v.id, 'professor', v.login, v.nome);
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_login_ti(p_login text, p_senha text)
 RETURNS TABLE(id integer, login text, nome text, is_professor boolean, professor_id bigint, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v public.usuario_ti;
BEGIN
  SELECT * INTO v FROM public.usuario_ti u
   WHERE u.login = p_login AND u.senha = extensions.crypt(p_senha, u.senha);
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v.id, v.login, v.nome, v.is_professor, v.professor_id,
    public.fn_emitir_token(v.id, 'ti', v.login, v.nome);
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_marcar_lido_pc(p_ticket_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.mensagem
  SET lido_pc = TRUE
  WHERE ticket_id = p_ticket_id AND remetente = 'TI' AND lido_pc = FALSE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_marcar_lido_ti(p_ticket_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.mensagem
  SET lido_ti = TRUE
  WHERE ticket_id = p_ticket_id AND remetente = 'PC' AND lido_ti = FALSE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_medias_resolucao(p_dias integer DEFAULT 90)
 RETURNS TABLE(tipo text, media_ms double precision, amostras bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT t.tipo::text,
         avg(extract(epoch FROM (t.resolvido_em - t.aberto_em)) * 1000)::double precision,
         count(*)::bigint
    FROM public.ticket t
   WHERE t.status = 'resolvido' AND t.aberto_em IS NOT NULL AND t.resolvido_em IS NOT NULL
     AND t.resolvido_em > t.aberto_em
     AND t.aberto_em >= now() - make_interval(days => greatest(coalesce(p_dias,90),1))
   GROUP BY t.tipo;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_nao_lidas_por_ticket()
 RETURNS TABLE(ticket_id integer, nao_lidas_ti bigint, nao_lidas_pc bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    m.ticket_id,
    COUNT(*) FILTER (WHERE m.remetente = 'PC' AND m.lido_ti = false) AS nao_lidas_ti,
    COUNT(*) FILTER (WHERE m.remetente = 'TI' AND m.lido_pc = false) AS nao_lidas_pc
  FROM public.mensagem m
  WHERE m.ticket_id IN (
    SELECT t.id
      FROM public.ticket t
     WHERE t.status IN ('aberto', 'em_andamento', 'aguardando_peca')
       AND (
             public.fn_sessao_tipo() = 'ti'
         OR (public.fn_sessao_tipo() = 'pc'
             AND public.fn_sessao_uid() IN (t.pc_origem, t.pc_problema))
         OR (public.fn_sessao_tipo() = 'professor'
             AND t.nome_solicitante IS NOT NULL
             AND t.nome_solicitante = public.fn_sessao_nome())
       )
  )
  GROUP BY m.ticket_id;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_preview_limpeza(p_dias integer DEFAULT 30)
 RETURNS TABLE(tickets_count bigint, mensagens_count bigint, imagens_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := CASE 
    WHEN p_dias >= 9999 THEN '1970-01-01'::TIMESTAMPTZ
    ELSE NOW() - (p_dias || ' days')::INTERVAL
  END;
  RETURN QUERY
  SELECT
    COUNT(DISTINCT t.id)::BIGINT,
    COUNT(m.id)::BIGINT,
    COUNT(DISTINCT CASE WHEN m.imagem_url IS NOT NULL THEN m.id END)::BIGINT
  FROM public.ticket t
  LEFT JOIN public.mensagem m ON m.ticket_id = t.id
  WHERE t.status IN ('resolvido', 'descartado', 'falso_alarme')
    AND t.resolvido_em IS NOT NULL           -- nunca incluir tickets sem data de resolução
    AND t.resolvido_em >= v_cutoff;          -- dentro do intervalo selecionado
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_reabrir_ticket(p_ticket_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_ticket ticket%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM ticket WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket não encontrado'; END IF;
  IF v_ticket.status NOT IN ('resolvido', 'descartado', 'falso_alarme') THEN
    RAISE EXCEPTION 'Apenas tickets encerrados podem ser reabertos';
  END IF;
  UPDATE ticket SET status = 'aberto', prioridade = 'medio',
    resolucao = NULL, item_descartado = NULL, resolvido_em = NULL,
    tecnico_responsavel = NULL WHERE id = p_ticket_id;
  RETURN json_build_object('success', true, 'ticket_id', p_ticket_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_registrar_tentativa(p_identificador text, p_ip text DEFAULT 'unknown'::text, p_sucesso boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.login_tentativas (identificador, ip, chave, sucesso)
  VALUES (
    lower(p_identificador),
    coalesce(p_ip, 'unknown'),
    lower(p_identificador) || '|' || coalesce(p_ip, 'unknown'),
    p_sucesso
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_sessao_encerrar(p_usuario_id integer, p_usuario_tipo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM sessao_ativa WHERE usuario_id = p_usuario_id AND usuario_tipo = p_usuario_tipo;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_sessao_ping(p_usuario_id integer, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO sessao_ativa (usuario_id, usuario_tipo, usuario_login, usuario_nome)
  VALUES (p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome)
  ON CONFLICT (usuario_id, usuario_tipo) DO UPDATE
    SET ultimo_ping  = now(),
        usuario_nome = COALESCE(EXCLUDED.usuario_nome, sessao_ativa.usuario_nome);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_set_presenca(p_id integer, p_presenca text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF p_presenca NOT IN ('online','em campo','ausente') THEN
    RAISE EXCEPTION 'presença inválida';
  END IF;
  UPDATE usuario_ti SET presenca = p_presenca WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_ti_atualizar_pc(p_token text, p_pc_id bigint, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_ti_atualizar_ticket(p_token text, p_ticket_id bigint, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_ti_status_pc(p_token text, p_pc_id bigint, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.sessao_token;
BEGIN
  v_s := public.fn_sessao_do_token(p_token);
  IF v_s.usuario_tipo <> 'ti' THEN RAISE EXCEPTION 'apenas T.I. pode alterar status de PC'; END IF;
  IF p_status NOT IN ('ativo','em_manutencao','descartado') THEN RAISE EXCEPTION 'status invalido: %', p_status; END IF;
  UPDATE public.pc SET status_pc = p_status WHERE id = p_pc_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.rpc_verificar_otp_ti(p_ti_id integer, p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_otp record;
BEGIN
  -- Busca OTP mais recente não usado para este técnico
  SELECT * INTO v_otp
  FROM public.otp_ti
  WHERE ti_id = p_ti_id
    AND usado = false
  ORDER BY criado_em DESC
  LIMIT 1;

  -- Não encontrou OTP ativo
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'erro', 'invalido');
  END IF;

  -- Código expirado
  IF v_otp.expira_em < now() THEN
    UPDATE public.otp_ti SET usado = true WHERE id = v_otp.id;
    RETURN json_build_object('ok', false, 'erro', 'expirado');
  END IF;

  -- Código incorreto
  IF v_otp.codigo != p_codigo THEN
    RETURN json_build_object('ok', false, 'erro', 'invalido');
  END IF;

  -- Código correto — marca como usado
  UPDATE public.otp_ti SET usado = true WHERE id = v_otp.id;

  RETURN json_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_verificar_pc(p_pc_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_pc pc%ROWTYPE; v_count int;
BEGIN
  SELECT * INTO v_pc FROM pc WHERE id = p_pc_id;
  IF NOT FOUND THEN
    RETURN json_build_object('found', false);
  END IF;
  SELECT COUNT(*) INTO v_count FROM ticket
  WHERE pc_problema = p_pc_id AND status IN ('aberto', 'em_andamento');
  RETURN json_build_object(
    'found', true,
    'status_pc', v_pc.status_pc,
    'pode_abrir_chamado', v_pc.status_pc = 'ativo',
    'tickets_abertos', v_count,
    'tag', v_pc.tag,
    'laboratorio', v_pc.laboratorio,
    'lado', v_pc.lado
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_log_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, ticket_id, impacto
    ) VALUES (
      NULL, NEW.remetente, NULL, NEW.nome_remetente,
      'Chat', 'ENVIAR_MSG',
      NEW.remetente || ' enviou mensagem no chamado #' || NEW.ticket_id || 
      CASE WHEN NEW.imagem_url IS NOT NULL THEN ' (com imagem)' ELSE '' END,
      NEW.ticket_id, 'novo_comentario'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.lido_ti = FALSE AND NEW.lido_ti = TRUE) OR 
       (OLD.lido_pc = FALSE AND NEW.lido_pc = TRUE) THEN
      INSERT INTO atividades_log (
        usuario_id, usuario_tipo, usuario_login, usuario_nome,
        modulo, acao, descricao_amigavel, ticket_id, impacto
      ) VALUES (
        NULL, CASE WHEN NEW.lido_ti THEN 'TI' ELSE 'PC' END, NULL, NULL,
        'Chat', 'MARCAR_LIDO',
        CASE WHEN NEW.lido_ti THEN 'TI leu' ELSE 'PC leu' END || ' mensagem do chamado #' || NEW.ticket_id,
        NEW.ticket_id, 'mensagem_lida'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_log_pc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, pc_id, impacto
    ) VALUES (
      NULL, 'TI', NULL, 'Sistema',
      'Computadores', 'CRIAR',
      'Novo computador ' || NEW.tag || ' cadastrado em ' || NEW.laboratorio,
      NEW.id, 'novo_pc'
    );
    -- audit_log (NOVO)
    PERFORM registrar_audit_log(
      'INSERT', 'pc',
      NULL, 'TI', NULL, 'Sistema',
      NEW.id,
      NULL,
      jsonb_build_object('tag', NEW.tag, 'laboratorio', NEW.laboratorio, 'lado', NEW.lado, 'status_pc', NEW.status_pc),
      NULL,
      'PC ' || NEW.tag || ' cadastrado'
    );

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status_pc != NEW.status_pc THEN
      INSERT INTO atividades_log (
        usuario_id, usuario_tipo, usuario_login, usuario_nome,
        modulo, acao, descricao_amigavel, pc_id, impacto
      ) VALUES (
        NULL, 'TI', NULL, NULL,
        'Computadores', 'ALTERAR_STATUS',
        'PC ' || NEW.tag || ' mudou para ' || NEW.status_pc,
        NEW.id, 'alteracao_status_pc'
      );
      INSERT INTO alteracoes_criticas_log (
        usuario_id, usuario_tipo, usuario_login, tabela, registro_id,
        campo_alterado, valor_anterior, valor_novo
      ) VALUES (
        NULL, 'TI', NULL, 'pc', NEW.id,
        'status_pc', OLD.status_pc, NEW.status_pc
      );
      -- audit_log (NOVO)
      PERFORM registrar_audit_log(
        'UPDATE', 'pc',
        NULL, 'TI', NULL, NULL,
        NEW.id,
        jsonb_build_object('status_pc', OLD.status_pc),
        jsonb_build_object('status_pc', NEW.status_pc),
        NULL,
        'PC ' || NEW.tag || ': ' || OLD.status_pc || ' → ' || NEW.status_pc
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, pc_id, impacto
    ) VALUES (
      NULL, 'TI', NULL, NULL,
      'Computadores', 'DELETAR',
      'PC ' || OLD.tag || ' removido do sistema',
      OLD.id, 'pc_deletado'
    );
    -- audit_log (NOVO)
    PERFORM registrar_audit_log(
      'DELETE', 'pc',
      NULL, 'TI', NULL, NULL,
      OLD.id,
      jsonb_build_object('tag', OLD.tag, 'laboratorio', OLD.laboratorio, 'status_pc', OLD.status_pc),
      NULL,
      NULL,
      'PC ' || OLD.tag || ' deletado'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_log_professor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, impacto
    ) VALUES (
      NULL, 'TI', NULL, 'Sistema',
      'Professores', 'CRIAR',
      'Novo professor ' || NEW.nome || ' (' || NEW.login || ') cadastrado - Disciplina: ' || COALESCE(NEW.disciplina, 'N/A'),
      'novo_professor'
    );

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.nome IS DISTINCT FROM NEW.nome OR OLD.disciplina IS DISTINCT FROM NEW.disciplina THEN
      INSERT INTO alteracoes_criticas_log (
        usuario_id, usuario_tipo, usuario_login, tabela, registro_id,
        campo_alterado, valor_anterior, valor_novo
      ) VALUES (
        NULL, 'TI', NULL, 'professor', NEW.id,
        'nome/disciplina',
        OLD.nome || '/' || COALESCE(OLD.disciplina, 'N/A'),
        NEW.nome || '/' || COALESCE(NEW.disciplina, 'N/A')
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, impacto
    ) VALUES (
      NULL, 'TI', NULL, NULL,
      'Professores', 'DELETAR',
      'Professor ' || OLD.nome || ' (' || OLD.login || ') removido do sistema',
      'professor_deletado'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_log_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- atividades_log (já existia)
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, ticket_id, impacto
    ) VALUES (
      NULL, 'SISTEMA', NULL, 'Sistema',
      'Tickets', 'CRIAR',
      'Novo chamado #' || NEW.id || ' aberto - ' || NEW.tipo || ' - ' || COALESCE(NEW.nome_solicitante, 'Anônimo'),
      NEW.id, 'novo_chamado'
    );
    -- audit_log (NOVO)
    PERFORM registrar_audit_log(
      'INSERT', 'ticket',
      NULL, 'SISTEMA', NULL, 'Sistema',
      NEW.id,
      NULL,
      to_jsonb(NEW),
      NULL,
      'Chamado #' || NEW.id || ' criado'
    );

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      -- atividades_log (já existia)
      INSERT INTO atividades_log (
        usuario_id, usuario_tipo, usuario_login, usuario_nome,
        modulo, acao, descricao_amigavel, ticket_id, impacto
      ) VALUES (
        NEW.tecnico_responsavel, 'TI', NULL, NULL,
        'Tickets', 'ALTERAR_STATUS',
        'Chamado #' || NEW.id || ' mudou de ' || OLD.status || ' para ' || NEW.status,
        NEW.id, 'alteracao_status'
      );
      IF NEW.status IN ('resolvido', 'descartado', 'falso_alarme') THEN
        INSERT INTO alteracoes_criticas_log (
          usuario_id, usuario_tipo, usuario_login, tabela, registro_id,
          campo_alterado, valor_anterior, valor_novo, motivo
        ) VALUES (
          NEW.tecnico_responsavel, 'TI', NULL, 'ticket', NEW.id,
          'status', OLD.status, NEW.status, NEW.resolucao
        );
      END IF;
      -- audit_log (NOVO)
      PERFORM registrar_audit_log(
        'UPDATE', 'ticket',
        NEW.tecnico_responsavel, 'TI', NULL, NULL,
        NEW.id,
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status),
        NULL,
        'Status do chamado #' || NEW.id || ' alterado: ' || OLD.status || ' → ' || NEW.status
      );
    END IF;

    IF (OLD.tecnico_responsavel IS DISTINCT FROM NEW.tecnico_responsavel) AND NEW.tecnico_responsavel IS NOT NULL THEN
      INSERT INTO atividades_log (
        usuario_id, usuario_tipo, usuario_login, usuario_nome,
        modulo, acao, descricao_amigavel, ticket_id, impacto
      ) VALUES (
        NEW.tecnico_responsavel, 'TI', NULL, NULL,
        'Tickets', 'ATRIBUIR',
        'Chamado #' || NEW.id || ' atribuído a técnico',
        NEW.id, 'atribuicao_tecnico'
      );
      -- audit_log (NOVO)
      PERFORM registrar_audit_log(
        'UPDATE', 'ticket',
        NEW.tecnico_responsavel, 'TI', NULL, NULL,
        NEW.id,
        jsonb_build_object('tecnico_responsavel', OLD.tecnico_responsavel),
        jsonb_build_object('tecnico_responsavel', NEW.tecnico_responsavel),
        NULL,
        'Chamado #' || NEW.id || ' atribuído a técnico id=' || NEW.tecnico_responsavel
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_log_usuario_ti()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, impacto
    ) VALUES (
      NEW.id, 'TI', NEW.login, NEW.nome,
      'Usuários', 'CRIAR',
      'Novo usuário T.I. ' || NEW.nome || ' (' || NEW.login || ') cadastrado',
      'novo_usuario_ti'
    );
    -- audit_log (NOVO)
    PERFORM registrar_audit_log(
      'INSERT', 'usuario_ti',
      NEW.id, 'TI', NEW.login, NEW.nome,
      NEW.id,
      NULL,
      jsonb_build_object('login', NEW.login, 'nome', NEW.nome),
      NULL,
      'Usuário TI ' || NEW.login || ' cadastrado'
    );

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.nome IS DISTINCT FROM NEW.nome OR OLD.login IS DISTINCT FROM NEW.login THEN
      INSERT INTO alteracoes_criticas_log (
        usuario_id, usuario_tipo, usuario_login, tabela, registro_id,
        campo_alterado, valor_anterior, valor_novo
      ) VALUES (
        NEW.id, 'TI', NEW.login, 'usuario_ti', NEW.id,
        'nome/login', OLD.login || '/' || OLD.nome, NEW.login || '/' || NEW.nome
      );
      -- audit_log (NOVO)
      PERFORM registrar_audit_log(
        'UPDATE', 'usuario_ti',
        NEW.id, 'TI', NEW.login, NEW.nome,
        NEW.id,
        jsonb_build_object('login', OLD.login, 'nome', OLD.nome),
        jsonb_build_object('login', NEW.login, 'nome', NEW.nome),
        NULL,
        'Usuário TI atualizado: ' || OLD.login || ' → ' || NEW.login
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO atividades_log (
      usuario_id, usuario_tipo, usuario_login, usuario_nome,
      modulo, acao, descricao_amigavel, impacto
    ) VALUES (
      NULL, 'TI', NULL, NULL,
      'Usuários', 'DELETAR',
      'Usuário T.I. ' || OLD.nome || ' (' || OLD.login || ') removido',
      'usuario_ti_deletado'
    );
    -- audit_log (NOVO)
    PERFORM registrar_audit_log(
      'DELETE', 'usuario_ti',
      NULL, 'TI', OLD.login, OLD.nome,
      OLD.id,
      jsonb_build_object('login', OLD.login, 'nome', OLD.nome),
      NULL,
      NULL,
      'Usuário TI ' || OLD.login || ' deletado'
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

-- ============ TRIGGERS ============

CREATE TRIGGER tg_impedir_ultimo_ti BEFORE DELETE ON public.usuario_ti FOR EACH ROW EXECUTE FUNCTION fn_impedir_ultimo_ti();
CREATE TRIGGER tr_log_mensagem AFTER INSERT OR UPDATE ON public.mensagem FOR EACH ROW EXECUTE FUNCTION trigger_log_mensagem();
CREATE TRIGGER tr_log_pc AFTER INSERT OR DELETE OR UPDATE ON public.pc FOR EACH ROW EXECUTE FUNCTION trigger_log_pc();
CREATE TRIGGER tr_log_professor AFTER INSERT OR DELETE OR UPDATE ON public.professor FOR EACH ROW EXECUTE FUNCTION trigger_log_professor();
CREATE TRIGGER tr_log_ticket AFTER INSERT OR UPDATE ON public.ticket FOR EACH ROW EXECUTE FUNCTION trigger_log_ticket();
CREATE TRIGGER tr_log_usuario_ti AFTER INSERT OR DELETE OR UPDATE ON public.usuario_ti FOR EACH ROW EXECUTE FUNCTION trigger_log_usuario_ti();
CREATE TRIGGER trg_check_login_unico_professor BEFORE INSERT OR UPDATE ON public.professor FOR EACH ROW EXECUTE FUNCTION fn_check_login_unico();
CREATE TRIGGER trg_check_login_unico_usuario_ti BEFORE INSERT OR UPDATE ON public.usuario_ti FOR EACH ROW EXECUTE FUNCTION fn_check_login_unico();
CREATE TRIGGER trg_set_ticket_laboratorio BEFORE INSERT ON public.ticket FOR EACH ROW EXECUTE FUNCTION fn_set_ticket_laboratorio();

-- ============ RLS ============

ALTER TABLE public.acesso_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alteracoes_criticas_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atividades_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_ti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacoes_massa_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_ti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_senha ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessao_ativa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessao_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_ti ENABLE ROW LEVEL SECURITY;

-- ============ POLICIES ============

CREATE POLICY acesso_log_insert_system ON public.acesso_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY acesso_log_no_delete ON public.acesso_log AS PERMISSIVE FOR DELETE TO public
  USING (false);

CREATE POLICY acesso_log_no_update ON public.acesso_log AS PERMISSIVE FOR UPDATE TO public
  USING (false);

CREATE POLICY acesso_log_select_all ON public.acesso_log AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY alteracoes_criticas_insert_system ON public.alteracoes_criticas_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY alteracoes_criticas_no_delete ON public.alteracoes_criticas_log AS PERMISSIVE FOR DELETE TO public
  USING (false);

CREATE POLICY alteracoes_criticas_no_update ON public.alteracoes_criticas_log AS PERMISSIVE FOR UPDATE TO public
  USING (false);

CREATE POLICY alteracoes_criticas_select_all ON public.alteracoes_criticas_log AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY atividades_log_insert_system ON public.atividades_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY atividades_log_no_delete ON public.atividades_log AS PERMISSIVE FOR DELETE TO public
  USING (false);

CREATE POLICY atividades_log_no_update ON public.atividades_log AS PERMISSIVE FOR UPDATE TO public
  USING (false);

CREATE POLICY atividades_log_select_all ON public.atividades_log AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY audit_log_insert_system ON public.audit_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY audit_log_no_delete ON public.audit_log AS PERMISSIVE FOR DELETE TO public
  USING (false);

CREATE POLICY audit_log_no_update ON public.audit_log AS PERMISSIVE FOR UPDATE TO public
  USING (false);

CREATE POLICY audit_log_select_all ON public.audit_log AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY auditoria_ti_insert ON public.auditoria_ti AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY auditoria_ti_select ON public.auditoria_ti AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY no_direct_access ON public.login_tentativas AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (false);

CREATE POLICY mensagem_insert ON public.mensagem AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((remetente = ANY (ARRAY['TI'::text, 'PC'::text])) OR (EXISTS ( SELECT 1
   FROM pc
  WHERE (pc.tag = mensagem.remetente)))));

CREATE POLICY mensagem_select ON public.mensagem AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((EXISTS ( SELECT 1
   FROM ticket t
  WHERE (t.id = mensagem.ticket_id))));

CREATE POLICY operacoes_massa_insert_system ON public.operacoes_massa_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY operacoes_massa_no_delete ON public.operacoes_massa_log AS PERMISSIVE FOR DELETE TO public
  USING (false);

CREATE POLICY operacoes_massa_no_update ON public.operacoes_massa_log AS PERMISSIVE FOR UPDATE TO public
  USING (false);

CREATE POLICY operacoes_massa_select_all ON public.operacoes_massa_log AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY sem_acesso_direto ON public.otp_ti AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false);

CREATE POLICY pc_insert ON public.pc AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (false);

CREATE POLICY pc_select ON public.pc AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((( SELECT fn_sessao_tipo() AS fn_sessao_tipo) IS NOT NULL));

CREATE POLICY professor_select ON public.professor AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((( SELECT fn_sessao_tipo() AS fn_sessao_tipo) = 'ti'::text));

CREATE POLICY sessao_ativa_select ON public.sessao_ativa AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY ticket_insert ON public.ticket AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY ticket_select ON public.ticket AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (((( SELECT fn_sessao_tipo() AS fn_sessao_tipo) = 'ti'::text) OR ((( SELECT fn_sessao_tipo() AS fn_sessao_tipo) = 'pc'::text) AND ((( SELECT fn_sessao_uid() AS fn_sessao_uid) = pc_origem) OR (( SELECT fn_sessao_uid() AS fn_sessao_uid) = pc_problema))) OR ((( SELECT fn_sessao_tipo() AS fn_sessao_tipo) = 'professor'::text) AND (nome_solicitante IS NOT NULL) AND (nome_solicitante = ( SELECT fn_sessao_nome() AS fn_sessao_nome)))));

CREATE POLICY usuario_ti_select ON public.usuario_ti AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((( SELECT fn_sessao_tipo() AS fn_sessao_tipo) IS NOT NULL));

-- ============ GRANTS DE TABELA ============

GRANT DELETE ON public.acesso_log TO anon;
GRANT INSERT ON public.acesso_log TO anon;
GRANT REFERENCES ON public.acesso_log TO anon;
GRANT SELECT ON public.acesso_log TO anon;
GRANT TRIGGER ON public.acesso_log TO anon;
GRANT TRUNCATE ON public.acesso_log TO anon;
GRANT UPDATE ON public.acesso_log TO anon;
GRANT DELETE ON public.acesso_log TO authenticated;
GRANT INSERT ON public.acesso_log TO authenticated;
GRANT REFERENCES ON public.acesso_log TO authenticated;
GRANT SELECT ON public.acesso_log TO authenticated;
GRANT TRIGGER ON public.acesso_log TO authenticated;
GRANT TRUNCATE ON public.acesso_log TO authenticated;
GRANT UPDATE ON public.acesso_log TO authenticated;
GRANT DELETE ON public.alteracoes_criticas_log TO anon;
GRANT INSERT ON public.alteracoes_criticas_log TO anon;
GRANT REFERENCES ON public.alteracoes_criticas_log TO anon;
GRANT SELECT ON public.alteracoes_criticas_log TO anon;
GRANT TRIGGER ON public.alteracoes_criticas_log TO anon;
GRANT TRUNCATE ON public.alteracoes_criticas_log TO anon;
GRANT UPDATE ON public.alteracoes_criticas_log TO anon;
GRANT DELETE ON public.alteracoes_criticas_log TO authenticated;
GRANT INSERT ON public.alteracoes_criticas_log TO authenticated;
GRANT REFERENCES ON public.alteracoes_criticas_log TO authenticated;
GRANT SELECT ON public.alteracoes_criticas_log TO authenticated;
GRANT TRIGGER ON public.alteracoes_criticas_log TO authenticated;
GRANT TRUNCATE ON public.alteracoes_criticas_log TO authenticated;
GRANT UPDATE ON public.alteracoes_criticas_log TO authenticated;
GRANT DELETE ON public.atividades_log TO anon;
GRANT INSERT ON public.atividades_log TO anon;
GRANT REFERENCES ON public.atividades_log TO anon;
GRANT SELECT ON public.atividades_log TO anon;
GRANT TRIGGER ON public.atividades_log TO anon;
GRANT TRUNCATE ON public.atividades_log TO anon;
GRANT UPDATE ON public.atividades_log TO anon;
GRANT DELETE ON public.atividades_log TO authenticated;
GRANT INSERT ON public.atividades_log TO authenticated;
GRANT REFERENCES ON public.atividades_log TO authenticated;
GRANT SELECT ON public.atividades_log TO authenticated;
GRANT TRIGGER ON public.atividades_log TO authenticated;
GRANT TRUNCATE ON public.atividades_log TO authenticated;
GRANT UPDATE ON public.atividades_log TO authenticated;
GRANT DELETE ON public.audit_log TO anon;
GRANT INSERT ON public.audit_log TO anon;
GRANT REFERENCES ON public.audit_log TO anon;
GRANT SELECT ON public.audit_log TO anon;
GRANT TRIGGER ON public.audit_log TO anon;
GRANT TRUNCATE ON public.audit_log TO anon;
GRANT UPDATE ON public.audit_log TO anon;
GRANT DELETE ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO authenticated;
GRANT REFERENCES ON public.audit_log TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT TRIGGER ON public.audit_log TO authenticated;
GRANT TRUNCATE ON public.audit_log TO authenticated;
GRANT UPDATE ON public.audit_log TO authenticated;
GRANT DELETE ON public.auditoria_ti TO anon;
GRANT INSERT ON public.auditoria_ti TO anon;
GRANT REFERENCES ON public.auditoria_ti TO anon;
GRANT SELECT ON public.auditoria_ti TO anon;
GRANT TRIGGER ON public.auditoria_ti TO anon;
GRANT TRUNCATE ON public.auditoria_ti TO anon;
GRANT UPDATE ON public.auditoria_ti TO anon;
GRANT DELETE ON public.auditoria_ti TO authenticated;
GRANT INSERT ON public.auditoria_ti TO authenticated;
GRANT REFERENCES ON public.auditoria_ti TO authenticated;
GRANT SELECT ON public.auditoria_ti TO authenticated;
GRANT TRIGGER ON public.auditoria_ti TO authenticated;
GRANT TRUNCATE ON public.auditoria_ti TO authenticated;
GRANT UPDATE ON public.auditoria_ti TO authenticated;
GRANT DELETE ON public.login_tentativas TO anon;
GRANT INSERT ON public.login_tentativas TO anon;
GRANT REFERENCES ON public.login_tentativas TO anon;
GRANT SELECT ON public.login_tentativas TO anon;
GRANT TRIGGER ON public.login_tentativas TO anon;
GRANT TRUNCATE ON public.login_tentativas TO anon;
GRANT UPDATE ON public.login_tentativas TO anon;
GRANT DELETE ON public.login_tentativas TO authenticated;
GRANT INSERT ON public.login_tentativas TO authenticated;
GRANT REFERENCES ON public.login_tentativas TO authenticated;
GRANT SELECT ON public.login_tentativas TO authenticated;
GRANT TRIGGER ON public.login_tentativas TO authenticated;
GRANT TRUNCATE ON public.login_tentativas TO authenticated;
GRANT UPDATE ON public.login_tentativas TO authenticated;
GRANT DELETE ON public.mensagem TO anon;
GRANT INSERT ON public.mensagem TO anon;
GRANT REFERENCES ON public.mensagem TO anon;
GRANT SELECT ON public.mensagem TO anon;
GRANT TRIGGER ON public.mensagem TO anon;
GRANT TRUNCATE ON public.mensagem TO anon;
GRANT UPDATE ON public.mensagem TO anon;
GRANT DELETE ON public.mensagem TO authenticated;
GRANT INSERT ON public.mensagem TO authenticated;
GRANT REFERENCES ON public.mensagem TO authenticated;
GRANT SELECT ON public.mensagem TO authenticated;
GRANT TRIGGER ON public.mensagem TO authenticated;
GRANT TRUNCATE ON public.mensagem TO authenticated;
GRANT UPDATE ON public.mensagem TO authenticated;
GRANT DELETE ON public.operacoes_massa_log TO anon;
GRANT INSERT ON public.operacoes_massa_log TO anon;
GRANT REFERENCES ON public.operacoes_massa_log TO anon;
GRANT SELECT ON public.operacoes_massa_log TO anon;
GRANT TRIGGER ON public.operacoes_massa_log TO anon;
GRANT TRUNCATE ON public.operacoes_massa_log TO anon;
GRANT UPDATE ON public.operacoes_massa_log TO anon;
GRANT DELETE ON public.operacoes_massa_log TO authenticated;
GRANT INSERT ON public.operacoes_massa_log TO authenticated;
GRANT REFERENCES ON public.operacoes_massa_log TO authenticated;
GRANT SELECT ON public.operacoes_massa_log TO authenticated;
GRANT TRIGGER ON public.operacoes_massa_log TO authenticated;
GRANT TRUNCATE ON public.operacoes_massa_log TO authenticated;
GRANT UPDATE ON public.operacoes_massa_log TO authenticated;
GRANT DELETE ON public.otp_ti TO anon;
GRANT INSERT ON public.otp_ti TO anon;
GRANT REFERENCES ON public.otp_ti TO anon;
GRANT SELECT ON public.otp_ti TO anon;
GRANT TRIGGER ON public.otp_ti TO anon;
GRANT TRUNCATE ON public.otp_ti TO anon;
GRANT UPDATE ON public.otp_ti TO anon;
GRANT DELETE ON public.otp_ti TO authenticated;
GRANT INSERT ON public.otp_ti TO authenticated;
GRANT REFERENCES ON public.otp_ti TO authenticated;
GRANT SELECT ON public.otp_ti TO authenticated;
GRANT TRIGGER ON public.otp_ti TO authenticated;
GRANT TRUNCATE ON public.otp_ti TO authenticated;
GRANT UPDATE ON public.otp_ti TO authenticated;
GRANT DELETE ON public.pc TO anon;
GRANT INSERT ON public.pc TO anon;
GRANT REFERENCES ON public.pc TO anon;
GRANT SELECT ON public.pc TO anon;
GRANT TRIGGER ON public.pc TO anon;
GRANT TRUNCATE ON public.pc TO anon;
GRANT UPDATE ON public.pc TO anon;
GRANT DELETE ON public.pc TO authenticated;
GRANT INSERT ON public.pc TO authenticated;
GRANT REFERENCES ON public.pc TO authenticated;
GRANT SELECT ON public.pc TO authenticated;
GRANT TRIGGER ON public.pc TO authenticated;
GRANT TRUNCATE ON public.pc TO authenticated;
GRANT UPDATE ON public.pc TO authenticated;
GRANT DELETE ON public.professor TO anon;
GRANT INSERT ON public.professor TO anon;
GRANT REFERENCES ON public.professor TO anon;
GRANT TRIGGER ON public.professor TO anon;
GRANT TRUNCATE ON public.professor TO anon;
GRANT UPDATE ON public.professor TO anon;
GRANT DELETE ON public.professor TO authenticated;
GRANT INSERT ON public.professor TO authenticated;
GRANT REFERENCES ON public.professor TO authenticated;
GRANT TRIGGER ON public.professor TO authenticated;
GRANT TRUNCATE ON public.professor TO authenticated;
GRANT UPDATE ON public.professor TO authenticated;
GRANT DELETE ON public.sessao_ativa TO anon;
GRANT INSERT ON public.sessao_ativa TO anon;
GRANT REFERENCES ON public.sessao_ativa TO anon;
GRANT SELECT ON public.sessao_ativa TO anon;
GRANT TRIGGER ON public.sessao_ativa TO anon;
GRANT TRUNCATE ON public.sessao_ativa TO anon;
GRANT UPDATE ON public.sessao_ativa TO anon;
GRANT DELETE ON public.sessao_ativa TO authenticated;
GRANT INSERT ON public.sessao_ativa TO authenticated;
GRANT REFERENCES ON public.sessao_ativa TO authenticated;
GRANT SELECT ON public.sessao_ativa TO authenticated;
GRANT TRIGGER ON public.sessao_ativa TO authenticated;
GRANT TRUNCATE ON public.sessao_ativa TO authenticated;
GRANT UPDATE ON public.sessao_ativa TO authenticated;
GRANT DELETE ON public.ticket TO anon;
GRANT INSERT ON public.ticket TO anon;
GRANT REFERENCES ON public.ticket TO anon;
GRANT SELECT ON public.ticket TO anon;
GRANT TRIGGER ON public.ticket TO anon;
GRANT TRUNCATE ON public.ticket TO anon;
GRANT UPDATE ON public.ticket TO anon;
GRANT DELETE ON public.ticket TO authenticated;
GRANT INSERT ON public.ticket TO authenticated;
GRANT REFERENCES ON public.ticket TO authenticated;
GRANT SELECT ON public.ticket TO authenticated;
GRANT TRIGGER ON public.ticket TO authenticated;
GRANT TRUNCATE ON public.ticket TO authenticated;
GRANT UPDATE ON public.ticket TO authenticated;
GRANT DELETE ON public.usuario_ti TO anon;
GRANT INSERT ON public.usuario_ti TO anon;
GRANT REFERENCES ON public.usuario_ti TO anon;
GRANT TRIGGER ON public.usuario_ti TO anon;
GRANT TRUNCATE ON public.usuario_ti TO anon;
GRANT UPDATE ON public.usuario_ti TO anon;
GRANT DELETE ON public.usuario_ti TO authenticated;
GRANT INSERT ON public.usuario_ti TO authenticated;
GRANT REFERENCES ON public.usuario_ti TO authenticated;
GRANT TRIGGER ON public.usuario_ti TO authenticated;
GRANT TRUNCATE ON public.usuario_ti TO authenticated;
GRANT UPDATE ON public.usuario_ti TO authenticated;
GRANT DELETE ON public.v_alteracoes_criticas_recentes TO anon;
GRANT INSERT ON public.v_alteracoes_criticas_recentes TO anon;
GRANT REFERENCES ON public.v_alteracoes_criticas_recentes TO anon;
GRANT SELECT ON public.v_alteracoes_criticas_recentes TO anon;
GRANT TRIGGER ON public.v_alteracoes_criticas_recentes TO anon;
GRANT TRUNCATE ON public.v_alteracoes_criticas_recentes TO anon;
GRANT UPDATE ON public.v_alteracoes_criticas_recentes TO anon;
GRANT DELETE ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT INSERT ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT REFERENCES ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT SELECT ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT TRIGGER ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT TRUNCATE ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT UPDATE ON public.v_alteracoes_criticas_recentes TO authenticated;
GRANT DELETE ON public.v_atividades_por_modulo TO anon;
GRANT INSERT ON public.v_atividades_por_modulo TO anon;
GRANT REFERENCES ON public.v_atividades_por_modulo TO anon;
GRANT SELECT ON public.v_atividades_por_modulo TO anon;
GRANT TRIGGER ON public.v_atividades_por_modulo TO anon;
GRANT TRUNCATE ON public.v_atividades_por_modulo TO anon;
GRANT UPDATE ON public.v_atividades_por_modulo TO anon;
GRANT DELETE ON public.v_atividades_por_modulo TO authenticated;
GRANT INSERT ON public.v_atividades_por_modulo TO authenticated;
GRANT REFERENCES ON public.v_atividades_por_modulo TO authenticated;
GRANT SELECT ON public.v_atividades_por_modulo TO authenticated;
GRANT TRIGGER ON public.v_atividades_por_modulo TO authenticated;
GRANT TRUNCATE ON public.v_atividades_por_modulo TO authenticated;
GRANT UPDATE ON public.v_atividades_por_modulo TO authenticated;
GRANT DELETE ON public.v_atividades_por_usuario TO anon;
GRANT INSERT ON public.v_atividades_por_usuario TO anon;
GRANT REFERENCES ON public.v_atividades_por_usuario TO anon;
GRANT SELECT ON public.v_atividades_por_usuario TO anon;
GRANT TRIGGER ON public.v_atividades_por_usuario TO anon;
GRANT TRUNCATE ON public.v_atividades_por_usuario TO anon;
GRANT UPDATE ON public.v_atividades_por_usuario TO anon;
GRANT DELETE ON public.v_atividades_por_usuario TO authenticated;
GRANT INSERT ON public.v_atividades_por_usuario TO authenticated;
GRANT REFERENCES ON public.v_atividades_por_usuario TO authenticated;
GRANT SELECT ON public.v_atividades_por_usuario TO authenticated;
GRANT TRIGGER ON public.v_atividades_por_usuario TO authenticated;
GRANT TRUNCATE ON public.v_atividades_por_usuario TO authenticated;
GRANT UPDATE ON public.v_atividades_por_usuario TO authenticated;
GRANT DELETE ON public.v_atividades_recentes TO anon;
GRANT INSERT ON public.v_atividades_recentes TO anon;
GRANT REFERENCES ON public.v_atividades_recentes TO anon;
GRANT SELECT ON public.v_atividades_recentes TO anon;
GRANT TRIGGER ON public.v_atividades_recentes TO anon;
GRANT TRUNCATE ON public.v_atividades_recentes TO anon;
GRANT UPDATE ON public.v_atividades_recentes TO anon;
GRANT DELETE ON public.v_atividades_recentes TO authenticated;
GRANT INSERT ON public.v_atividades_recentes TO authenticated;
GRANT REFERENCES ON public.v_atividades_recentes TO authenticated;
GRANT SELECT ON public.v_atividades_recentes TO authenticated;
GRANT TRIGGER ON public.v_atividades_recentes TO authenticated;
GRANT TRUNCATE ON public.v_atividades_recentes TO authenticated;
GRANT UPDATE ON public.v_atividades_recentes TO authenticated;
GRANT DELETE ON public.v_logins_recentes TO anon;
GRANT INSERT ON public.v_logins_recentes TO anon;
GRANT REFERENCES ON public.v_logins_recentes TO anon;
GRANT SELECT ON public.v_logins_recentes TO anon;
GRANT TRIGGER ON public.v_logins_recentes TO anon;
GRANT TRUNCATE ON public.v_logins_recentes TO anon;
GRANT UPDATE ON public.v_logins_recentes TO anon;
GRANT DELETE ON public.v_logins_recentes TO authenticated;
GRANT INSERT ON public.v_logins_recentes TO authenticated;
GRANT REFERENCES ON public.v_logins_recentes TO authenticated;
GRANT SELECT ON public.v_logins_recentes TO authenticated;
GRANT TRIGGER ON public.v_logins_recentes TO authenticated;
GRANT TRUNCATE ON public.v_logins_recentes TO authenticated;
GRANT UPDATE ON public.v_logins_recentes TO authenticated;
GRANT DELETE ON public.v_operacoes_massa_recentes TO anon;
GRANT INSERT ON public.v_operacoes_massa_recentes TO anon;
GRANT REFERENCES ON public.v_operacoes_massa_recentes TO anon;
GRANT SELECT ON public.v_operacoes_massa_recentes TO anon;
GRANT TRIGGER ON public.v_operacoes_massa_recentes TO anon;
GRANT TRUNCATE ON public.v_operacoes_massa_recentes TO anon;
GRANT UPDATE ON public.v_operacoes_massa_recentes TO anon;
GRANT DELETE ON public.v_operacoes_massa_recentes TO authenticated;
GRANT INSERT ON public.v_operacoes_massa_recentes TO authenticated;
GRANT REFERENCES ON public.v_operacoes_massa_recentes TO authenticated;
GRANT SELECT ON public.v_operacoes_massa_recentes TO authenticated;
GRANT TRIGGER ON public.v_operacoes_massa_recentes TO authenticated;
GRANT TRUNCATE ON public.v_operacoes_massa_recentes TO authenticated;
GRANT UPDATE ON public.v_operacoes_massa_recentes TO authenticated;
GRANT DELETE ON public.v_pc_pub TO anon;
GRANT INSERT ON public.v_pc_pub TO anon;
GRANT REFERENCES ON public.v_pc_pub TO anon;
GRANT SELECT ON public.v_pc_pub TO anon;
GRANT TRIGGER ON public.v_pc_pub TO anon;
GRANT TRUNCATE ON public.v_pc_pub TO anon;
GRANT UPDATE ON public.v_pc_pub TO anon;
GRANT DELETE ON public.v_pc_pub TO authenticated;
GRANT INSERT ON public.v_pc_pub TO authenticated;
GRANT REFERENCES ON public.v_pc_pub TO authenticated;
GRANT SELECT ON public.v_pc_pub TO authenticated;
GRANT TRIGGER ON public.v_pc_pub TO authenticated;
GRANT TRUNCATE ON public.v_pc_pub TO authenticated;
GRANT UPDATE ON public.v_pc_pub TO authenticated;
GRANT DELETE ON public.v_pcs_mais_incidentes TO anon;
GRANT INSERT ON public.v_pcs_mais_incidentes TO anon;
GRANT REFERENCES ON public.v_pcs_mais_incidentes TO anon;
GRANT SELECT ON public.v_pcs_mais_incidentes TO anon;
GRANT TRIGGER ON public.v_pcs_mais_incidentes TO anon;
GRANT TRUNCATE ON public.v_pcs_mais_incidentes TO anon;
GRANT UPDATE ON public.v_pcs_mais_incidentes TO anon;
GRANT DELETE ON public.v_pcs_mais_incidentes TO authenticated;
GRANT INSERT ON public.v_pcs_mais_incidentes TO authenticated;
GRANT REFERENCES ON public.v_pcs_mais_incidentes TO authenticated;
GRANT SELECT ON public.v_pcs_mais_incidentes TO authenticated;
GRANT TRIGGER ON public.v_pcs_mais_incidentes TO authenticated;
GRANT TRUNCATE ON public.v_pcs_mais_incidentes TO authenticated;
GRANT UPDATE ON public.v_pcs_mais_incidentes TO authenticated;
GRANT DELETE ON public.v_resumo_diario_atividades TO anon;
GRANT INSERT ON public.v_resumo_diario_atividades TO anon;
GRANT REFERENCES ON public.v_resumo_diario_atividades TO anon;
GRANT SELECT ON public.v_resumo_diario_atividades TO anon;
GRANT TRIGGER ON public.v_resumo_diario_atividades TO anon;
GRANT TRUNCATE ON public.v_resumo_diario_atividades TO anon;
GRANT UPDATE ON public.v_resumo_diario_atividades TO anon;
GRANT DELETE ON public.v_resumo_diario_atividades TO authenticated;
GRANT INSERT ON public.v_resumo_diario_atividades TO authenticated;
GRANT REFERENCES ON public.v_resumo_diario_atividades TO authenticated;
GRANT SELECT ON public.v_resumo_diario_atividades TO authenticated;
GRANT TRIGGER ON public.v_resumo_diario_atividades TO authenticated;
GRANT TRUNCATE ON public.v_resumo_diario_atividades TO authenticated;
GRANT UPDATE ON public.v_resumo_diario_atividades TO authenticated;
GRANT DELETE ON public.v_tickets_mais_movimentados TO anon;
GRANT INSERT ON public.v_tickets_mais_movimentados TO anon;
GRANT REFERENCES ON public.v_tickets_mais_movimentados TO anon;
GRANT SELECT ON public.v_tickets_mais_movimentados TO anon;
GRANT TRIGGER ON public.v_tickets_mais_movimentados TO anon;
GRANT TRUNCATE ON public.v_tickets_mais_movimentados TO anon;
GRANT UPDATE ON public.v_tickets_mais_movimentados TO anon;
GRANT DELETE ON public.v_tickets_mais_movimentados TO authenticated;
GRANT INSERT ON public.v_tickets_mais_movimentados TO authenticated;
GRANT REFERENCES ON public.v_tickets_mais_movimentados TO authenticated;
GRANT SELECT ON public.v_tickets_mais_movimentados TO authenticated;
GRANT TRIGGER ON public.v_tickets_mais_movimentados TO authenticated;
GRANT TRUNCATE ON public.v_tickets_mais_movimentados TO authenticated;
GRANT UPDATE ON public.v_tickets_mais_movimentados TO authenticated;
GRANT DELETE ON public.v_usuario_ti_pub TO anon;
GRANT INSERT ON public.v_usuario_ti_pub TO anon;
GRANT REFERENCES ON public.v_usuario_ti_pub TO anon;
GRANT SELECT ON public.v_usuario_ti_pub TO anon;
GRANT TRIGGER ON public.v_usuario_ti_pub TO anon;
GRANT TRUNCATE ON public.v_usuario_ti_pub TO anon;
GRANT UPDATE ON public.v_usuario_ti_pub TO anon;
GRANT DELETE ON public.v_usuario_ti_pub TO authenticated;
GRANT INSERT ON public.v_usuario_ti_pub TO authenticated;
GRANT REFERENCES ON public.v_usuario_ti_pub TO authenticated;
GRANT SELECT ON public.v_usuario_ti_pub TO authenticated;
GRANT TRIGGER ON public.v_usuario_ti_pub TO authenticated;
GRANT TRUNCATE ON public.v_usuario_ti_pub TO authenticated;
GRANT UPDATE ON public.v_usuario_ti_pub TO authenticated;
GRANT DELETE ON public.v_usuarios_mais_ativos TO anon;
GRANT INSERT ON public.v_usuarios_mais_ativos TO anon;
GRANT REFERENCES ON public.v_usuarios_mais_ativos TO anon;
GRANT SELECT ON public.v_usuarios_mais_ativos TO anon;
GRANT TRIGGER ON public.v_usuarios_mais_ativos TO anon;
GRANT TRUNCATE ON public.v_usuarios_mais_ativos TO anon;
GRANT UPDATE ON public.v_usuarios_mais_ativos TO anon;
GRANT DELETE ON public.v_usuarios_mais_ativos TO authenticated;
GRANT INSERT ON public.v_usuarios_mais_ativos TO authenticated;
GRANT REFERENCES ON public.v_usuarios_mais_ativos TO authenticated;
GRANT SELECT ON public.v_usuarios_mais_ativos TO authenticated;
GRANT TRIGGER ON public.v_usuarios_mais_ativos TO authenticated;
GRANT TRUNCATE ON public.v_usuarios_mais_ativos TO authenticated;
GRANT UPDATE ON public.v_usuarios_mais_ativos TO authenticated;

-- ============ GRANTS DE COLUNA ============

GRANT INSERT (criado_em) ON public.professor TO anon;
GRANT REFERENCES (criado_em) ON public.professor TO anon;
GRANT SELECT (criado_em) ON public.professor TO anon;
GRANT UPDATE (criado_em) ON public.professor TO anon;
GRANT INSERT (criado_em) ON public.professor TO authenticated;
GRANT UPDATE (criado_em) ON public.professor TO authenticated;
GRANT SELECT (criado_em) ON public.professor TO authenticated;
GRANT REFERENCES (criado_em) ON public.professor TO authenticated;
GRANT INSERT (disciplina) ON public.professor TO anon;
GRANT REFERENCES (disciplina) ON public.professor TO anon;
GRANT SELECT (disciplina) ON public.professor TO anon;
GRANT UPDATE (disciplina) ON public.professor TO anon;
GRANT REFERENCES (disciplina) ON public.professor TO authenticated;
GRANT INSERT (disciplina) ON public.professor TO authenticated;
GRANT UPDATE (disciplina) ON public.professor TO authenticated;
GRANT SELECT (disciplina) ON public.professor TO authenticated;
GRANT INSERT (id) ON public.professor TO anon;
GRANT REFERENCES (id) ON public.professor TO anon;
GRANT SELECT (id) ON public.professor TO anon;
GRANT UPDATE (id) ON public.professor TO anon;
GRANT SELECT (id) ON public.professor TO authenticated;
GRANT INSERT (id) ON public.professor TO authenticated;
GRANT REFERENCES (id) ON public.professor TO authenticated;
GRANT UPDATE (id) ON public.professor TO authenticated;
GRANT INSERT (login) ON public.professor TO anon;
GRANT UPDATE (login) ON public.professor TO anon;
GRANT SELECT (login) ON public.professor TO anon;
GRANT REFERENCES (login) ON public.professor TO anon;
GRANT INSERT (login) ON public.professor TO authenticated;
GRANT UPDATE (login) ON public.professor TO authenticated;
GRANT SELECT (login) ON public.professor TO authenticated;
GRANT REFERENCES (login) ON public.professor TO authenticated;
GRANT INSERT (nome) ON public.professor TO anon;
GRANT REFERENCES (nome) ON public.professor TO anon;
GRANT SELECT (nome) ON public.professor TO anon;
GRANT UPDATE (nome) ON public.professor TO anon;
GRANT UPDATE (nome) ON public.professor TO authenticated;
GRANT SELECT (nome) ON public.professor TO authenticated;
GRANT REFERENCES (nome) ON public.professor TO authenticated;
GRANT INSERT (nome) ON public.professor TO authenticated;
GRANT REFERENCES (senha_hash) ON public.professor TO anon;
GRANT UPDATE (senha_hash) ON public.professor TO anon;
GRANT INSERT (senha_hash) ON public.professor TO anon;
GRANT INSERT (senha_hash) ON public.professor TO authenticated;
GRANT UPDATE (senha_hash) ON public.professor TO authenticated;
GRANT REFERENCES (senha_hash) ON public.professor TO authenticated;
GRANT REFERENCES (ti_id) ON public.professor TO anon;
GRANT INSERT (ti_id) ON public.professor TO anon;
GRANT UPDATE (ti_id) ON public.professor TO anon;
GRANT SELECT (ti_id) ON public.professor TO anon;
GRANT SELECT (ti_id) ON public.professor TO authenticated;
GRANT REFERENCES (ti_id) ON public.professor TO authenticated;
GRANT INSERT (ti_id) ON public.professor TO authenticated;
GRANT UPDATE (ti_id) ON public.professor TO authenticated;
GRANT SELECT (email) ON public.usuario_ti TO anon;
GRANT INSERT (email) ON public.usuario_ti TO anon;
GRANT REFERENCES (email) ON public.usuario_ti TO anon;
GRANT UPDATE (email) ON public.usuario_ti TO anon;
GRANT INSERT (email) ON public.usuario_ti TO authenticated;
GRANT SELECT (email) ON public.usuario_ti TO authenticated;
GRANT UPDATE (email) ON public.usuario_ti TO authenticated;
GRANT REFERENCES (email) ON public.usuario_ti TO authenticated;
GRANT UPDATE (id) ON public.usuario_ti TO anon;
GRANT SELECT (id) ON public.usuario_ti TO anon;
GRANT REFERENCES (id) ON public.usuario_ti TO anon;
GRANT INSERT (id) ON public.usuario_ti TO anon;
GRANT REFERENCES (id) ON public.usuario_ti TO authenticated;
GRANT SELECT (id) ON public.usuario_ti TO authenticated;
GRANT UPDATE (id) ON public.usuario_ti TO authenticated;
GRANT INSERT (id) ON public.usuario_ti TO authenticated;
GRANT INSERT (is_professor) ON public.usuario_ti TO anon;
GRANT UPDATE (is_professor) ON public.usuario_ti TO anon;
GRANT SELECT (is_professor) ON public.usuario_ti TO anon;
GRANT REFERENCES (is_professor) ON public.usuario_ti TO anon;
GRANT INSERT (is_professor) ON public.usuario_ti TO authenticated;
GRANT UPDATE (is_professor) ON public.usuario_ti TO authenticated;
GRANT SELECT (is_professor) ON public.usuario_ti TO authenticated;
GRANT REFERENCES (is_professor) ON public.usuario_ti TO authenticated;
GRANT UPDATE (login) ON public.usuario_ti TO anon;
GRANT SELECT (login) ON public.usuario_ti TO anon;
GRANT REFERENCES (login) ON public.usuario_ti TO anon;
GRANT INSERT (login) ON public.usuario_ti TO anon;
GRANT REFERENCES (login) ON public.usuario_ti TO authenticated;
GRANT SELECT (login) ON public.usuario_ti TO authenticated;
GRANT UPDATE (login) ON public.usuario_ti TO authenticated;
GRANT INSERT (login) ON public.usuario_ti TO authenticated;
GRANT UPDATE (nome) ON public.usuario_ti TO anon;
GRANT REFERENCES (nome) ON public.usuario_ti TO anon;
GRANT INSERT (nome) ON public.usuario_ti TO anon;
GRANT SELECT (nome) ON public.usuario_ti TO anon;
GRANT INSERT (nome) ON public.usuario_ti TO authenticated;
GRANT SELECT (nome) ON public.usuario_ti TO authenticated;
GRANT UPDATE (nome) ON public.usuario_ti TO authenticated;
GRANT REFERENCES (nome) ON public.usuario_ti TO authenticated;
GRANT SELECT (presenca) ON public.usuario_ti TO anon;
GRANT REFERENCES (presenca) ON public.usuario_ti TO anon;
GRANT INSERT (presenca) ON public.usuario_ti TO anon;
GRANT UPDATE (presenca) ON public.usuario_ti TO anon;
GRANT REFERENCES (presenca) ON public.usuario_ti TO authenticated;
GRANT SELECT (presenca) ON public.usuario_ti TO authenticated;
GRANT UPDATE (presenca) ON public.usuario_ti TO authenticated;
GRANT INSERT (presenca) ON public.usuario_ti TO authenticated;
GRANT INSERT (professor_id) ON public.usuario_ti TO anon;
GRANT UPDATE (professor_id) ON public.usuario_ti TO anon;
GRANT REFERENCES (professor_id) ON public.usuario_ti TO anon;
GRANT REFERENCES (professor_id) ON public.usuario_ti TO authenticated;
GRANT UPDATE (professor_id) ON public.usuario_ti TO authenticated;
GRANT INSERT (professor_id) ON public.usuario_ti TO authenticated;
GRANT INSERT (senha) ON public.usuario_ti TO anon;
GRANT REFERENCES (senha) ON public.usuario_ti TO anon;
GRANT UPDATE (senha) ON public.usuario_ti TO anon;
GRANT REFERENCES (senha) ON public.usuario_ti TO authenticated;
GRANT INSERT (senha) ON public.usuario_ti TO authenticated;
GRANT UPDATE (senha) ON public.usuario_ti TO authenticated;
