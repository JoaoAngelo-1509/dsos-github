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
// Deploy:  supabase functions deploy groq-proxy
// Secret:  supabase secrets set GROQ_KEY=gsk_...
// ──────────────────────────────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Domínio do projeto. Defina GROQ_PROXY_ALLOWED_ORIGIN como secret para
// restringir ao domínio do Vercel (ex.: https://dsos.vercel.app). Sem o
// secret, libera para qualquer origem (a chamada ainda exige a anon key).
const ALLOWED_ORIGIN = Deno.env.get('GROQ_PROXY_ALLOWED_ORIGIN') ?? '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const GROQ_KEY = Deno.env.get('GROQ_KEY');
  if (!GROQ_KEY) {
    return json({ error: 'GROQ_KEY não configurada no servidor' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const { messages, model, max_tokens, temperature } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'O campo "messages" é obrigatório' }, 400);
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

    // Passa a resposta da Groq adiante preservando o status e o formato JSON.
    const payload = await groqRes.text();
    return new Response(payload, {
      status: groqRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return json({ error: `Falha ao contatar a Groq: ${(e as Error)?.message ?? e}` }, 502);
  }
});
