-- FEAT-01 — verificação em 2 etapas (2FA) do T.I., de fato ligada.
--
-- ════════════════════════════════════════════════════════════════════════
-- O QUE ESTAVA ERRADO
-- ════════════════════════════════════════════════════════════════════════
-- A infraestrutura existia (otp_ti, rpc_gerar_otp_ti, rpc_verificar_otp_ti,
-- usuario_ti.email) mas era inligável, por dois motivos independentes:
--
--   1. `rpc_gerar_otp_ti(p_ti_id integer)` devolvia o código no próprio JSON
--      e tinha EXECUTE para anon. Não era só "quem sabe a senha vê o código":
--      era pior — bastava um id de técnico. Qualquer pessoa com a anon key
--      chamava rpc_gerar_otp_ti(1) e recebia o código de volta. O 2FA não
--      teria protegido nada.
--
--   2. `rpc_verificar_otp_ti(p_ti_id, p_codigo)` também só pedia o id. Sem
--      nenhum limite de tentativas, 6 dígitos caem em minutos por força
--      bruta — de novo, sem nunca saber a senha.
--
-- ════════════════════════════════════════════════════════════════════════
-- COMO FICA
-- ════════════════════════════════════════════════════════════════════════
-- O fio condutor é o DESAFIO: um segredo aleatório de 32 bytes que só
-- `rpc_login_ti` emite, e só depois de conferir a senha. Ele é o "eu já
-- provei que sei a senha" que substitui o `p_ti_id` adivinhável.
--
--   login (senha correta, usuário COM e-mail)
--     └─> rpc_login_ti devolve token = NULL + desafio            [browser]
--   edge function enviar-otp-ti (service_role)
--     └─> rpc_gerar_otp_ti(desafio) gera o código, devolve à function
--         que manda o e-mail e responde só "enviado sim/não"     [servidor]
--   usuário digita o código
--     └─> rpc_verificar_otp_ti(desafio, codigo) confere e SÓ ENTÃO
--         chama fn_emitir_token                                  [browser]
--
-- A garantia de que não dá para pular o OTP é de SERVIDOR, não de
-- JavaScript: para um usuário com e-mail cadastrado, `rpc_login_ti` não
-- emite token nenhum. Quem tiver a senha e mexer no console recebe
-- `token: null`; o painel recusa a sessão porque toda escrita sensível
-- exige o token (SEC-05). O único caminho alcançável pelo anon que produz
-- token de tipo 'ti' passa por rpc_verificar_otp_ti.
--
-- Usuário SEM e-mail continua entrando direto, exatamente como hoje — o
-- 2FA é opt-in por usuário, ligado ao preencher o campo de e-mail.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Desafio de pré-autenticação
-- ────────────────────────────────────────────────────────────────────────
-- Mesmo padrão de sessao_token (SEC-05): RLS ligada sem policy e sem
-- privilégio para anon/authenticated — deny-by-default. Só as funções
-- SECURITY DEFINER enxergam. Se fosse legível via REST, o desafio de outro
-- usuário estaria à disposição e todo o esquema perderia o sentido.

CREATE TABLE IF NOT EXISTS public.otp_desafio_ti (
  desafio    text PRIMARY KEY,
  ti_id      integer     NOT NULL REFERENCES public.usuario_ti(id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  envios     smallint    NOT NULL DEFAULT 0,   -- e-mails já disparados (limita reenvio)
  tentativas smallint    NOT NULL DEFAULT 0,   -- códigos errados já testados
  consumido  boolean     NOT NULL DEFAULT false
);
ALTER TABLE public.otp_desafio_ti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otp_desafio_ti FROM anon, authenticated, PUBLIC;
CREATE INDEX IF NOT EXISTS idx_otp_desafio_ti_expira ON public.otp_desafio_ti (expira_em);
CREATE INDEX IF NOT EXISTS idx_otp_desafio_ti_ti_id  ON public.otp_desafio_ti (ti_id);

-- ────────────────────────────────────────────────────────────────────────
-- 2. Remove as assinaturas antigas por p_ti_id
-- ────────────────────────────────────────────────────────────────────────
-- Não basta revogar o EXECUTE de anon em rpc_gerar_otp_ti — enquanto a
-- assinatura `(integer)` existir, ela é uma função que gera OTP para
-- qualquer técnico sem exigir prova nenhuma. É o exato pé de ouvido que
-- criou o FEAT-01; sai do banco. Nada no frontend as chamava (o 2FA nunca
-- chegou a ser ligado), então a remoção não quebra caminho em uso.

DROP FUNCTION IF EXISTS public.rpc_gerar_otp_ti(integer);
DROP FUNCTION IF EXISTS public.rpc_verificar_otp_ti(integer, text);

-- ────────────────────────────────────────────────────────────────────────
-- 3. rpc_login_ti — deixa de emitir token quando o usuário tem 2FA
-- ────────────────────────────────────────────────────────────────────────
-- Esta é a mudança sensível da migration, e é ela que dá a garantia de
-- servidor. As colunas novas entram no FIM do RETURNS TABLE pelo mesmo
-- motivo do SEC-05: o frontend lê por nome, então acrescentar coluna é
-- retrocompatível.
--
-- Para usuário SEM e-mail nada muda: token na hora, otp_requerido = false.
-- Para usuário COM e-mail, `token` volta NULL de propósito. Um frontend
-- antigo (anterior a este deploy) que ignorasse otp_requerido gravaria uma
-- sessão sem token e o painel recusaria com "sessão sem token — refaça o
-- login": falha fechada, não aberta.
--
-- `email_mascarado` existe só para a tela poder dizer PARA ONDE o código
-- foi ("j***@escola.sp.gov.br") sem publicar o endereço inteiro.

DROP FUNCTION IF EXISTS public.rpc_login_ti(text, text);
CREATE FUNCTION public.rpc_login_ti(p_login text, p_senha text)
RETURNS TABLE(
  id              integer,
  login           text,
  nome            text,
  is_professor    boolean,
  professor_id    bigint,
  token           text,
  otp_requerido   boolean,
  desafio         text,
  email_mascarado text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $fn$
DECLARE
  v         public.usuario_ti;
  v_desafio text;
  v_arroba  int;
BEGIN
  SELECT * INTO v FROM public.usuario_ti u
   WHERE u.login = p_login AND u.senha = extensions.crypt(p_senha, u.senha);
  IF NOT FOUND THEN RETURN; END IF;

  -- Sem e-mail = 2FA desligado para este usuário: comportamento de hoje.
  IF v.email IS NULL OR btrim(v.email) = '' THEN
    RETURN QUERY SELECT v.id, v.login, v.nome, v.is_professor, v.professor_id,
      public.fn_emitir_token(v.id, 'ti', v.login, v.nome),
      false, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 2FA ligado: NENHUM token sai daqui.
  DELETE FROM public.otp_desafio_ti d WHERE d.expira_em < now();
  -- Um login novo invalida o desafio anterior: sem isso, dois logins
  -- simultâneos deixariam dois desafios válidos para a mesma conta.
  UPDATE public.otp_desafio_ti d SET consumido = true
   WHERE d.ti_id = v.id AND d.consumido = false;

  v_desafio := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.otp_desafio_ti (desafio, ti_id) VALUES (v_desafio, v.id);

  v_arroba := position('@' in v.email);

  RETURN QUERY SELECT v.id, v.login, v.nome, v.is_professor, v.professor_id,
    NULL::text, true, v_desafio,
    CASE WHEN v_arroba > 1
         THEN left(v.email, 1) || '***' || substr(v.email, v_arroba)
         ELSE '***' END;
END $fn$;

-- ────────────────────────────────────────────────────────────────────────
-- 4. rpc_gerar_otp_ti — agora exige o desafio e NÃO é chamável pelo cliente
-- ────────────────────────────────────────────────────────────────────────
-- Continua devolvendo o código no JSON, e continua sendo o certo: quem
-- recebe é a edge function `enviar-otp-ti`, rodando com service_role, que
-- usa o código só para montar o e-mail e devolve ao browser apenas
-- "enviado: true/false". O que muda é quem consegue chamar — ver o REVOKE
-- ao final do bloco.
--
-- O código é sorteado com gen_random_bytes (CSPRNG do pgcrypto), não com
-- random(): random() é um PRNG previsível a partir da semente, e código de
-- 6 dígitos previsível é o mesmo que não ter código.

CREATE OR REPLACE FUNCTION public.rpc_gerar_otp_ti(p_desafio text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $fn$
DECLARE
  v_d      public.otp_desafio_ti;
  v_email  text;
  v_nome   text;
  v_bytes  bytea;
  v_n      bigint := 0;
  v_i      int;
  v_codigo text;
BEGIN
  SELECT * INTO v_d FROM public.otp_desafio_ti d
   WHERE d.desafio = p_desafio AND d.consumido = false AND d.expira_em > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'erro', 'desafio_invalido');
  END IF;

  -- Teto de reenvios por desafio. Sem isso, um botão "reenviar" segurado
  -- vira disparador de e-mail em massa contra o endereço do técnico.
  IF v_d.envios >= 3 THEN
    RETURN json_build_object('ok', false, 'erro', 'limite_envios');
  END IF;

  SELECT u.email, u.nome INTO v_email, v_nome
    FROM public.usuario_ti u WHERE u.id = v_d.ti_id;
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    -- O e-mail foi apagado entre o login e o envio.
    RETURN json_build_object('ok', false, 'erro', 'sem_email');
  END IF;

  UPDATE public.otp_ti o SET usado = true WHERE o.ti_id = v_d.ti_id AND o.usado = false;
  DELETE FROM public.otp_ti o WHERE o.expira_em < now();

  v_bytes := extensions.gen_random_bytes(6);
  FOR v_i IN 0..5 LOOP
    v_n := v_n * 256 + get_byte(v_bytes, v_i);
  END LOOP;
  v_codigo := lpad((v_n % 1000000)::text, 6, '0');

  -- Guarda só o hash. A tabela já é deny-by-default, mas um GRANT
  -- acidental no futuro, um dump ou uma consulta com service_role passam a
  -- entregar hash em vez de código vivo.
  INSERT INTO public.otp_ti (ti_id, codigo, criado_em, expira_em, usado)
  VALUES (v_d.ti_id, extensions.crypt(v_codigo, extensions.gen_salt('bf')),
          now(), now() + interval '10 minutes', false);

  UPDATE public.otp_desafio_ti d SET envios = d.envios + 1 WHERE d.desafio = p_desafio;

  RETURN json_build_object(
    'ok',      true,
    'email',   v_email,
    'nome',    v_nome,
    'codigo',  v_codigo,     -- só a edge function vê isto
    'validade_min', 10
  );
END $fn$;

-- ────────────────────────────────────────────────────────────────────────
-- 5. rpc_verificar_otp_ti — confere o código e emite o token
-- ────────────────────────────────────────────────────────────────────────
-- Esta é a única função alcançável pelo anon que produz token de tipo 'ti'
-- para um usuário com 2FA. Exige o desafio (que só a senha correta produz)
-- E o código (que só existe no e-mail).

CREATE OR REPLACE FUNCTION public.rpc_verificar_otp_ti(p_desafio text, p_codigo text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $fn$
DECLARE
  v_max_tentativas constant int := 5;
  v_d     public.otp_desafio_ti;
  v_otp   public.otp_ti;
  v_u     public.usuario_ti;
  v_token text;
BEGIN
  SELECT * INTO v_d FROM public.otp_desafio_ti d WHERE d.desafio = p_desafio FOR UPDATE;
  IF NOT FOUND OR v_d.consumido OR v_d.expira_em < now() THEN
    RETURN json_build_object('ok', false, 'erro', 'desafio_invalido');
  END IF;

  IF v_d.tentativas >= v_max_tentativas THEN
    UPDATE public.otp_desafio_ti d SET consumido = true WHERE d.desafio = p_desafio;
    RETURN json_build_object('ok', false, 'erro', 'tentativas_excedidas');
  END IF;

  SELECT * INTO v_otp FROM public.otp_ti o
   WHERE o.ti_id = v_d.ti_id AND o.usado = false
   ORDER BY o.criado_em DESC LIMIT 1;
  IF NOT FOUND THEN
    -- Desafio válido mas nenhum código pendente: o e-mail não chegou a ser
    -- gerado (edge function fora do ar) ou o código já foi usado.
    RETURN json_build_object('ok', false, 'erro', 'sem_codigo');
  END IF;

  IF v_otp.expira_em < now() THEN
    UPDATE public.otp_ti o SET usado = true WHERE o.id = v_otp.id;
    RETURN json_build_object('ok', false, 'erro', 'expirado');
  END IF;

  IF v_otp.codigo <> extensions.crypt(p_codigo, v_otp.codigo) THEN
    UPDATE public.otp_desafio_ti d SET tentativas = d.tentativas + 1
     WHERE d.desafio = p_desafio;
    RETURN json_build_object('ok', false, 'erro', 'invalido',
                             'tentativas_restantes', v_max_tentativas - (v_d.tentativas + 1));
  END IF;

  -- Correto: queima o código E o desafio (ambos são de uso único).
  UPDATE public.otp_ti o SET usado = true WHERE o.id = v_otp.id;
  UPDATE public.otp_desafio_ti d SET consumido = true WHERE d.desafio = p_desafio;

  SELECT * INTO v_u FROM public.usuario_ti u WHERE u.id = v_d.ti_id;
  v_token := public.fn_emitir_token(v_u.id, 'ti', v_u.login, v_u.nome);

  RETURN json_build_object(
    'ok',           true,
    'id',           v_u.id,
    'login',        v_u.login,
    'nome',         v_u.nome,
    'is_professor', v_u.is_professor,
    'professor_id', v_u.professor_id,
    'token',        v_token
  );
END $fn$;

-- ────────────────────────────────────────────────────────────────────────
-- 6. Privilégios
-- ────────────────────────────────────────────────────────────────────────
-- Função criada por superusuário nasce com EXECUTE para PUBLIC — sem o
-- REVOKE explícito abaixo, rpc_gerar_otp_ti continuaria chamável pelo
-- browser e o problema do FEAT-01 voltaria intacto.

REVOKE ALL ON FUNCTION public.rpc_gerar_otp_ti(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_gerar_otp_ti(text) TO service_role;

GRANT EXECUTE ON FUNCTION public.rpc_verificar_otp_ti(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_login_ti(text, text)         TO anon, authenticated;
