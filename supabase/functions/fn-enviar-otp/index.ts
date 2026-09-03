// supabase/functions/fn-enviar-otp/index.ts
// ──────────────────────────────────────────────────────────────────────────
// DESATIVADA. Este arquivo é um stub — não faz nada além de responder 410.
//
// POR QUE ELA EXISTIA
// Enviava por e-mail o código da verificação em duas etapas (2FA) do login de
// T.I. Chamava a RPC `rpc_gerar_otp_ti` e mandava o código pela Resend.
//
// POR QUE FOI DESATIVADA
// O 2FA foi removido do projeto (ver LASTCHANGES.md, "Verificação em duas
// etapas (2FA) removida"): o recurso nunca funcionou de verdade — a RPC
// devolvia o código no próprio JSON, entregando o segundo fator a quem já
// tivesse a senha. Saíram a tabela `otp_ti` e as RPCs
// `rpc_gerar_otp_ti` / `rpc_verificar_otp_ti`.
//
// SÓ QUE A EDGE FUNCTION FICOU PUBLICADA. Continuou no ar, chamável por
// qualquer um, criando um cliente com a SERVICE_ROLE_KEY (que ignora a RLS
// inteira) e sem verificar quem estava chamando — a mesma falha encontrada em
// `fn-limpar-dados` (L10). Não causava dano hoje porque a RPC que ela chama
// não existe mais, mas devolvia o erro cru do PostgREST ao chamador, vazando
// nomes internos do schema:
//
//   {"ok":false,"erro":"Error: Could not find the function
//    public.rpc_gerar_otp_ti(p_ti_id) in the schema cache"}
//
// O QUE ESTE STUB FAZ
// Nada. Não importa o cliente do Supabase, não lê SERVICE_ROLE_KEY, não toca
// no banco, não envia e-mail. Só responde 410 Gone. É a versão publicada mais
// inerte possível enquanto a função não é removida de vez.
//
// ⚠️ PRÓXIMO PASSO: DELETAR A FUNÇÃO
// Este stub reduz o risco a zero, mas o certo é a função não existir. Pelo
// painel do Supabase: Edge Functions → fn-enviar-otp → Delete. Ou pela CLI:
//
//   supabase functions delete fn-enviar-otp
//
// Depois de deletar, apague esta pasta do repositório.
//
// ⚠️ NÃO "REATIVE" ESTE ARQUIVO. Se algum dia o projeto voltar a ter 2FA, a
// implementação tem que ser nova: a antiga era falha por desenho, e as tabelas
// e RPCs de que ela dependia não existem mais.
// ──────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  return new Response(
    JSON.stringify({
      ok: false,
      erro: 'Recurso removido: a verificacao em duas etapas nao existe mais neste projeto.',
    }),
    { status: 410, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
});
