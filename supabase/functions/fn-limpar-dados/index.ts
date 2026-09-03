// supabase/functions/fn-limpar-dados/index.ts
// ──────────────────────────────────────────────────────────────────────────
// Limpeza de dados do painel T.I. → aba Manutenção.
//
// Roda com a SERVICE_ROLE_KEY (lida do ambiente pelo próprio Supabase, nunca
// vinda do cliente), portanto IGNORA a RLS inteira. É o endpoint mais
// destrutivo do sistema — por isso valida a sessão antes de qualquer coisa.
//
// ⚠️ HISTÓRICO — POR QUE A VALIDAÇÃO DE SESSÃO EXISTE
// A primeira versão desta função não checava NADA: `verify_jwt: false` no
// deploy e nenhuma verificação no corpo. Um curl sem apikey, sem Authorization
// e sem token respondia 200 e, com `apenas_preview: false`, apagaria todos os
// chamados encerrados, mensagens e imagens do projeto — de qualquer lugar da
// internet. Não mexa nesta parte sem entender isso.
// (`verify_jwt` segue false de propósito: o projeto não usa Supabase Auth,
// não existe JWT de usuário. Quem autentica é o X-Sessao-Token do SEC-05.)
//
// AÇÕES
//   acao: 'tickets' (padrão) — apaga chamados encerrados mais antigos que
//                              `dias`, suas mensagens e as imagens delas.
//   acao: 'orfaos'           — apaga arquivos do bucket que nenhuma mensagem
//                              referencia (ver abaixo).
//   apenas_preview: true     — só conta, não apaga. Vale para as duas ações.
//
// POR QUE 'orfaos' PRECISA EXISTIR
// A ação 'tickets' só apaga imagem que ela consegue enxergar, isto é, cujo
// registro em `mensagem` ainda existe. Quando a mensagem some por outro
// caminho (ticket apagado, limpeza anterior, exclusão manual), o arquivo fica
// no bucket sem nada apontando para ele — e nenhuma rotina do sistema volta a
// alcançá-lo. No diagnóstico que originou esta versão havia 32 arquivos e
// 11 MB nessa situação (100% do bucket), enquanto a limpeza "Todos" reportava
// `imagens_count: 0`.
//
// Deploy: supabase functions deploy fn-limpar-dados
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'chat-prints';

// Um arquivo recém-enviado fica alguns instantes sem dono: o cliente sobe a
// imagem e SÓ DEPOIS insere a linha em `mensagem` (ver enviarMsg em
// painel-pc.js / painel-ti.js). Sem esta carência, uma limpeza disparada
// exatamente nesse intervalo apagaria o print que alguém está mandando naquele
// segundo. Uma hora é folga enorme para uma janela de milissegundos.
const CARENCIA_MS = 60 * 60 * 1000;

// A API de Storage pagina em 100 por padrão; sem varrer tudo, "órfão" seria
// calculado sobre uma amostra e a conta do preview mentiria.
const PAGINA_STORAGE = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // x-sessao-token precisa estar aqui, senão o preflight do navegador barra a
  // chamada do painel — o interceptor de js/sessao-header.js anexa esse header
  // em toda requisição para *.supabase.co, inclusive esta.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sessao-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // ── AUTORIZAÇÃO ────────────────────────────────────────────────────────
  // Espelha o que fn_sessao_do_token() faz no banco: token existente e não
  // expirado. A diferença é que aqui exigimos também que seja de um T.I. —
  // limpeza de dados não é ação de aluno nem de professor.
  const token = req.headers.get('x-sessao-token') ?? '';
  if (!token) return json({ error: 'sessao ausente' }, 401);

  const { data: sessao, error: erroSessao } = await sb
    .from('sessao_token')
    .select('usuario_tipo, usuario_login, usuario_id')
    .eq('token', token)
    .gt('expira_em', new Date().toISOString())
    .maybeSingle();

  if (erroSessao) return json({ error: 'falha ao validar sessao' }, 500);
  if (!sessao) return json({ error: 'sessao invalida ou expirada' }, 401);
  // Mensagem propositalmente igual à de sessão inválida: quem não é T.I. não
  // precisa saber que o token é válido, só que não serve aqui.
  if (sessao.usuario_tipo !== 'ti') return json({ error: 'sessao invalida ou expirada' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const acao = (body?.acao as string) ?? 'tickets';
  const apenas_preview = body?.apenas_preview === true;
  const dias = Number(body?.dias ?? 30);

  try {
    if (acao === 'orfaos') return await limparOrfaos(sb, apenas_preview);
    if (acao === 'tickets') return await limparTickets(sb, dias, apenas_preview);
    return json({ error: 'acao desconhecida: ' + acao }, 400);
  } catch (err) {
    console.error('[fn-limpar-dados]', acao, String(err));
    return json({ error: String(err) }, 500);
  }
});

// ── Lista TODOS os objetos do bucket, paginando ────────────────────────────
async function listarTudo(sb: any) {
  const todos: any[] = [];
  for (let offset = 0; ; offset += PAGINA_STORAGE) {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .list('', { limit: PAGINA_STORAGE, offset });
    if (error) throw error;
    if (!data?.length) break;
    todos.push(...data);
    if (data.length < PAGINA_STORAGE) break;
  }
  // `list` devolve também entradas de pasta (sem metadata). Só arquivo importa.
  return todos.filter((o) => o?.name && o?.metadata);
}

// ── Nomes de arquivo referenciados por alguma mensagem ─────────────────────
async function nomesReferenciados(sb: any): Promise<Set<string>> {
  const refs = new Set<string>();
  const TAM = 1000;
  for (let de = 0; ; de += TAM) {
    const { data, error } = await sb
      .from('mensagem')
      .select('imagem_url')
      .not('imagem_url', 'is', null)
      .range(de, de + TAM - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const m of data) {
      const url = String(m.imagem_url ?? '');
      const i = url.lastIndexOf('/' + BUCKET + '/');
      if (i >= 0) refs.add(decodeURIComponent(url.slice(i + BUCKET.length + 2)));
    }
    if (data.length < TAM) break;
  }
  return refs;
}

// ── AÇÃO: apagar arquivos que nenhuma mensagem referencia ──────────────────
async function limparOrfaos(sb: any, apenas_preview: boolean) {
  const [objetos, refs] = await Promise.all([listarTudo(sb), nomesReferenciados(sb)]);
  const limite = Date.now() - CARENCIA_MS;

  // Três categorias, contadas separadamente de propósito. Juntar "referenciado"
  // com "recente demais para julgar" num único "em uso" faria o painel dizer
  // "1 em uso" num bucket onde NENHUMA mensagem tem imagem — número que o
  // T.I. não teria como interpretar.
  const referenciados: any[] = [];
  const recentes: any[] = [];
  const orfaos: any[] = [];

  for (const o of objetos) {
    if (refs.has(o.name)) { referenciados.push(o); continue; }
    // created_at pode faltar em objeto antigo; nesse caso o arquivo é velho o
    // suficiente para não estar no meio de um envio.
    const criado = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (criado > limite) { recentes.push(o); continue; }   // dentro da carência
    orfaos.push(o);
  }

  const bytes = orfaos.reduce((a: number, o: any) => a + (o.metadata?.size ?? 0), 0);
  const base = {
    acao: 'orfaos',
    orfaos_count: orfaos.length,
    bytes,
    mb: (bytes / 1024 / 1024).toFixed(2),
    total_no_bucket: objetos.length,
    referenciados: referenciados.length,
    // Não referenciados, mas enviados há menos de CARENCIA_MS: podem ser um
    // print em pleno envio, então ficam de fora desta rodada.
    recentes_protegidos: recentes.length,
  };

  if (apenas_preview) return json({ preview: true, ...base });

  let apagados = 0;
  for (let i = 0; i < orfaos.length; i += 100) {
    const lote = orfaos.slice(i, i + 100).map((o: any) => o.name);
    const { data, error } = await sb.storage.from(BUCKET).remove(lote);
    if (error) {
      console.error('[fn-limpar-dados] remove', error.message);
      continue;
    }
    apagados += data?.length ?? 0;
  }
  return json({ success: true, ...base, orfaos_deletados: apagados });
}

// ── AÇÃO: limpeza por período (comportamento original, preservado) ─────────
async function limparTickets(sb: any, dias: number, apenas_preview: boolean) {
  const rpc = apenas_preview ? 'rpc_preview_limpeza' : 'rpc_executar_limpeza';
  const { data, error } = await sb.rpc(rpc, { p_dias: dias });
  if (error) throw error;

  const resultado = Array.isArray(data) ? data[0] : data;

  if (apenas_preview) {
    return json({
      preview: true,
      acao: 'tickets',
      tickets_count: resultado?.tickets_count ?? 0,
      mensagens_count: resultado?.mensagens_count ?? 0,
      imagens_count: resultado?.imagens_count ?? 0,
    });
  }

  const nomes: string[] = resultado?.nomes_imagens ?? [];
  let imagens_deletadas = 0;
  let bytes_liberados = 0;

  if (nomes.length > 0) {
    // O `list` da versão anterior vinha sem paginação e só enxergava os 100
    // primeiros arquivos, então os MB liberados saíam menores que a realidade
    // sempre que o bucket passava de 100 objetos.
    const objs = await listarTudo(sb);
    bytes_liberados = objs
      .filter((o: any) => nomes.includes(o.name))
      .reduce((acc: number, o: any) => acc + (o.metadata?.size ?? 0), 0);

    for (let i = 0; i < nomes.length; i += 100) {
      const lote = nomes.slice(i, i + 100);
      const { data: del, error: delErr } = await sb.storage.from(BUCKET).remove(lote);
      if (!delErr && del) imagens_deletadas += del.length;
    }
  }

  return json({
    success: true,
    acao: 'tickets',
    tickets_deletados: resultado?.tickets_deletados ?? 0,
    mensagens_deletadas: resultado?.mensagens_deletadas ?? 0,
    imagens_deletadas,
    bytes_liberados,
    mb_liberados: (bytes_liberados / 1024 / 1024).toFixed(2),
  });
}
