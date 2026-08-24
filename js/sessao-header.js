// DSos — sessao-header.js
// ── Envia o token de sessão em toda requisição ao Supabase (SEC-05b) ────────
//
// POR QUE UM INTERCEPTOR, E NÃO EDITAR OS HEADERS DIRETO
//
// As policies de leitura passaram a exigir o token de sessão no header HTTP
// `X-Sessao-Token` (o PostgREST expõe os headers da requisição no GUC
// `request.headers`, e o gateway do Supabase libera esse header no preflight
// CORS — os dois pontos foram verificados em produção).
//
// O lugar "óbvio" para pôr o header seria o objeto `H` de js/supabase-config.js,
// mas ele não serve por dois motivos:
//   1. supabase-config.js NÃO é versionado — é gerado no build da Netlify por
//      scripts/netlify-build.sh a partir de variáveis de ambiente. Editar o
//      arquivo local não sobreviveria ao deploy;
//   2. `H` é montado uma vez, no carregamento do módulo, enquanto o token só
//      passa a existir DEPOIS do login. Um header estático nasceria vazio.
//
// Interceptar o fetch resolve os dois: o token é lido no instante de cada
// chamada (então vale para o login que acabou de acontecer) e o comportamento
// não depende de nenhum arquivo gerado no build. De quebra, cobre de uma vez
// todos os pontos que falam com o Supabase — painel-ti, painel-pc,
// painel-logs, auth e logging — em vez de exigir a mesma edição em cada um.
//
// O header só é anexado a requisições para o Supabase: nada vaza para a edge
// function de terceiros nem para qualquer outro host.

const CHAVE_SESSAO = 'dsos_session';

function tokenAtual() {
  try {
    const bruto = sessionStorage.getItem(CHAVE_SESSAO);
    if (!bruto) return null;
    return JSON.parse(bruto)?.token || null;
  } catch (_) {
    // sessão corrompida no storage não pode derrubar a aplicação inteira
    return null;
  }
}

function ehSupabase(url) {
  return typeof url === 'string' && url.includes('.supabase.co');
}

let instalado = false;

export function instalarHeaderSessao() {
  if (instalado) return;          // idempotente: várias páginas importam isto
  instalado = true;

  const fetchOriginal = window.fetch.bind(window);

  window.fetch = function (entrada, init) {
    const url = typeof entrada === 'string' ? entrada
              : (entrada && entrada.url) ? entrada.url
              : '';

    if (!ehSupabase(url)) return fetchOriginal(entrada, init);

    const token = tokenAtual();
    if (!token) return fetchOriginal(entrada, init);   // antes do login

    // Request e (url, init) são as duas formas de chamar fetch; o supabase-js
    // usa a segunda, mas o código do projeto pode usar qualquer uma.
    if (entrada instanceof Request && !init) {
      const req = new Request(entrada);
      req.headers.set('X-Sessao-Token', token);
      return fetchOriginal(req);
    }

    const cabecalhos = new Headers(
      (init && init.headers) || (entrada instanceof Request ? entrada.headers : undefined)
    );
    cabecalhos.set('X-Sessao-Token', token);
    return fetchOriginal(entrada, { ...(init || {}), headers: cabecalhos });
  };
}
