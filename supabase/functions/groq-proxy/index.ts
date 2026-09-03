// supabase/functions/groq-proxy/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Proxy seguro para a API da Groq.
// Mantém a GROQ_KEY fora do código cliente: a chave é lida de um secret do
// Supabase (Deno.env.get('GROQ_KEY')) e nunca é exposta no navegador.
//
// O cliente chama esta função em ${SB_URL}/functions/v1/groq-proxy enviando
// no body: { messages, model, max_tokens, temperature } e recebe de volta a
// resposta da Groq no mesmo formato (data.choices[0].message.content).
//
// ⚠️ NÃO VOLTE A EMBUTIR A CHAVE NO CÓDIGO
// A versão que estava publicada (v3) trazia um `GROQ_KEY_FALLBACK` com a chave
// da Groq em texto puro, usado quando o secret não existisse. Ficava no
// servidor, então não vazava para o navegador — mas é credencial em código, e
// bastaria alguém versionar essa função para a chave ir parar no GitHub. O
// secret é a única fonte agora; sem ele a função responde 500 e diz o porquê.
//
// ── EXIGE SESSÃO (lacuna L7) ────────────────────────────────────────────
// Antes bastava a anon key — que é pública, vai no bundle do site — para
// consumir a cota da Groq do projeto. Agora é preciso um X-Sessao-Token de
// sessão viva (qualquer papel: ti, pc ou professor).
//
// Isso só foi possível depois de inverter a ordem do login em js/auth.js: a
// validação de nome (`validarNome`) rodava ANTES de conferir a senha, quando
// ainda não existia token, então exigir sessão aqui teria impedido qualquer
// pessoa de entrar no sistema. Hoje a senha é conferida primeiro e o nome
// depois, já com token em mãos.
//
// Limitar por IP foi considerado e descartado: num laboratório de escola todas
// as máquinas saem pelo mesmo IP público, então o limite seria compartilhado
// pela sala inteira e a turma toda travaria no começo da aula.
//
// A validação usa a RPC `rpc_sessao_valida` (migration 20260902130000), que
// devolve só o papel do dono do token. É de propósito que esta função NÃO
// carregue a SERVICE_ROLE_KEY: ela recebe texto arbitrário do usuário e o
// repassa a um terceiro, é o último lugar onde se quer a chave mestra.
//
// Deploy:  supabase functions deploy groq-proxy
// Secret:  supabase secrets set GROQ_KEY=gsk_...
// ──────────────────────────────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Domínio do projeto. Defina GROQ_PROXY_ALLOWED_ORIGIN como secret para
// restringir ao domínio de produção. Sem o secret, libera para qualquer origem
// (a chamada ainda exige anon key + token de sessão).
const ALLOWED_ORIGIN = Deno.env.get('GROQ_PROXY_ALLOWED_ORIGIN') ?? '*';

// Inclui 'prefer' porque o cliente reutiliza o header global H do Supabase
// (que carrega Prefer: return=representation). Sem isso, o preflight CORS do
// navegador falha e o fetch é bloqueado silenciosamente.
// 'x-sessao-token' entrou junto com a exigência de sessão.
const ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, prefer, range, x-requested-with, x-sessao-token';

function corsHeaders(req: Request) {
  // Reflete os headers pedidos no preflight quando presentes; senão usa a lista padrão.
  const reqHeaders = req.headers.get('access-control-request-headers');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': reqHeaders ?? ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });

// Pergunta ao banco se o token corresponde a uma sessão viva. Devolve o papel
// ('ti' | 'pc' | 'professor') ou null. Usa a anon key: a RPC é SECURITY
// DEFINER e só devolve o papel, nada mais.
async function papelDaSessao(token: string): Promise<string | null> {
  if (!token) return null;
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) {
    console.error('[groq-proxy] SUPABASE_URL/ANON_KEY ausentes no ambiente');
    return null;
  }
  try {
    const r = await fetch(`${url}/rest/v1/rpc/rpc_sessao_valida`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return null;
    const papel = await r.json();
    return typeof papel === 'string' && papel ? papel : null;
  } catch (e) {
    console.error('[groq-proxy] falha ao validar sessao:', String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  // ── Sessão obrigatória ──
  const token = req.headers.get('x-sessao-token') ?? '';
  const papel = await papelDaSessao(token);
  if (!papel) {
    return json(req, { error: 'sessao invalida ou expirada' }, 401);
  }

  const GROQ_KEY = Deno.env.get('GROQ_KEY');
  if (!GROQ_KEY) {
    // Antes havia um fallback com a chave embutida, que escondia esta falha de
    // configuração. Agora ela aparece — de propósito.
    console.error('[groq-proxy] secret GROQ_KEY nao configurado');
    return json(req, { error: 'GROQ_KEY nao configurada no servidor' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'JSON invalido' }, 400);
  }

  const { messages, model, max_tokens, temperature } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(req, { error: 'O campo "messages" e obrigatorio' }, 400);
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: model ?? 'llama-3.3-70b-versatile',
        messages,
        max_tokens: max_tokens ?? 1024,
        temperature: temperature ?? 0,
      }),
    });

    const payload = await groqRes.text();
    return new Response(payload, {
      status: groqRes.status,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return json(req, { error: `Falha ao contatar a Groq: ${(e as Error)?.message ?? e}` }, 502);
  }
});
