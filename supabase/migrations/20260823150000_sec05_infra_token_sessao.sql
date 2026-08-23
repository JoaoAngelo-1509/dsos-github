-- SEC-05 (auditoria DSos), parte 1: infraestrutura de token de sessão.
--
-- O problema: o sistema não usa Supabase Auth, então a anon key é a MESMA
-- para aluno, professor e técnico — todos batem no PostgREST com a mesma
-- credencial. Por isso as policies de ticket/pc eram USING(true), e toda a
-- "permissão" vivia só no JavaScript: qualquer pessoa reproduzia qualquer
-- ação de T.I. com um fetch() no console, sem nunca ter feito login.
--
-- Não adianta a RPC "receber o id do usuário" e confiar nele: a sessão vive
-- em sessionStorage (id/login/tipo em texto puro), que o próprio usuário
-- edita. Para haver autorização de verdade é preciso um SEGREDO que só o
-- login legítimo produz — é o que esta tabela guarda.
--
-- A tabela não tem privilégio nenhum para anon/authenticated e a RLS está
-- ligada sem policy (deny-by-default): o token só é acessível às funções
-- SECURITY DEFINER. Se fosse legível via REST, qualquer um leria os tokens
-- de todo mundo e o esquema perderia o sentido.

CREATE TABLE public.sessao_token (
  token         text PRIMARY KEY,
  usuario_id    bigint      NOT NULL,
  usuario_tipo  text        NOT NULL CHECK (usuario_tipo IN ('ti','pc','professor')),
  usuario_login text,
  usuario_nome  text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL DEFAULT now() + interval '12 hours'
);
ALTER TABLE public.sessao_token ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sessao_token FROM anon, authenticated, PUBLIC;
CREATE INDEX idx_sessao_token_expira ON public.sessao_token (expira_em);

CREATE OR REPLACE FUNCTION public.fn_emitir_token(
  p_usuario_id bigint, p_usuario_tipo text, p_usuario_login text, p_usuario_nome text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_token text;
BEGIN
  DELETE FROM public.sessao_token WHERE expira_em < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.sessao_token(token, usuario_id, usuario_tipo, usuario_login, usuario_nome)
  VALUES (v_token, p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome);
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sessao_do_token(p_token text)
RETURNS public.sessao_token LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.sessao_token;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN RAISE EXCEPTION 'sessao ausente'; END IF;
  SELECT * INTO v FROM public.sessao_token WHERE token = p_token AND expira_em > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'sessao invalida ou expirada'; END IF;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.fn_emitir_token(bigint,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sessao_do_token(text) FROM PUBLIC, anon, authenticated;
