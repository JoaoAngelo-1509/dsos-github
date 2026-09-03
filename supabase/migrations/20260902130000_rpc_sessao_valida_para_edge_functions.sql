-- ============================================================================
-- rpc_sessao_valida — deixa uma Edge Function conferir um token de sessão
-- sem precisar da SERVICE_ROLE_KEY.
--
-- PROBLEMA
-- --------
-- A `groq-proxy` precisa passar a exigir sessão (lacuna L7: hoje basta a anon
-- key, que é pública, para consumir a cota da Groq do projeto). Só que validar
-- um token significa ler `public.sessao_token`, e o SEC-05b fechou essa tabela
-- para anon — de propósito, é onde moram os tokens de todo mundo.
--
-- O caminho fácil seria dar a SERVICE_ROLE_KEY para a `groq-proxy`, como a
-- `fn-limpar-dados` tem. Mas service_role ignora a RLS INTEIRA: qualquer falha
-- futura naquela função viraria acesso total ao banco. A `groq-proxy` recebe
-- texto arbitrário do usuário e repassa para um terceiro — é exatamente o tipo
-- de função que não deve carregar a chave mestra.
--
-- SOLUÇÃO
-- -------
-- Uma função `SECURITY DEFINER` mínima, que responde UMA pergunta:
-- "este token corresponde a uma sessão viva? se sim, de que tipo?"
--
-- Devolve só o `usuario_tipo` ('ti' | 'pc' | 'professor'), ou NULL. Nunca o
-- id, o login, o nome ou a validade — nada que sirva para outra coisa.
--
-- POR QUE PODE SER CHAMADA POR anon
-- ---------------------------------
-- Ela não revela nada a quem não tem o token. Quem já tem um token válido
-- ganha a informação de que ele é válido — coisa que descobriria de qualquer
-- jeito usando o token. E adivinhar não é opção: o token são 32 bytes
-- aleatórios (`fn_emitir_token`), 256 bits.
--
-- Não substitui `fn_sessao_do_token()`, que continua sendo o caminho das RPCs
-- de escrita (aquela levanta exceção e devolve a linha inteira, para uso
-- interno). Esta existe para quem está FORA do banco e só precisa do veredito.
--
-- ROLLBACK no fim do arquivo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_sessao_valida(p_token text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.usuario_tipo
    FROM public.sessao_token s
   WHERE s.token = p_token
     AND s.expira_em > now();
$function$;

COMMENT ON FUNCTION public.rpc_sessao_valida(text) IS
  'Devolve o usuario_tipo de um token de sessao vivo, ou NULL. Existe para Edge Functions validarem sessao sem carregar a SERVICE_ROLE_KEY. Nao expoe id/login/nome. Ver migration 20260902130000.';

REVOKE ALL ON FUNCTION public.rpc_sessao_valida(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_sessao_valida(text) TO anon, authenticated;


-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.rpc_sessao_valida(text);
--   -- e redeploy da groq-proxy sem a checagem de sessao (ver o backup da
--   -- versao 3 da funcao, ou o git).
-- ============================================================================
