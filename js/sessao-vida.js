// DSos — sessao-vida.js
// ── Mantém a sessão viva enquanto a aba está aberta, e percebe quando ela morre ─
//
// O token de sessão vive por INATIVIDADE (migration 20260910120000): nasce com
// 5 min e cada `rpc_sessao_ping` empurra a validade para agora + 5 min, com teto
// de 12h desde o login. Fechou o navegador, o ping para e o token morre sozinho.
//
// O ping devolve o tipo da sessão, ou `null` se o token morreu. É o jeito de o
// front descobrir que a sessão acabou — antes ele confiava no sessionStorage
// para sempre, e uma aba restaurada pelo Chrome seguia "logada" com um token
// vencido havia dias: listas vazias e chamado recusado por RLS (08/09).
//
// Três momentos conferem a sessão:
//   1. ao abrir o painel, ANTES de carregar qualquer coisa;
//   2. a cada 30s — inclusive com a aba em segundo plano, senão ela morreria;
//   3. ao voltar para a aba (visibilitychange), sem esperar o próximo tick.
//
// O token NÃO é apagado ao fechar a aba: `pagehide` dispara igual no F5, e
// apagar ali deslogaria quem só recarregou. Ao sair da página só a PRESENÇA
// (sessao_ativa) é retirada, para o painel de logs mostrar a saída na hora.

import { SB_URL, SB_KEY } from './supabase-config.js';

const CHAVE_SESSAO = 'dsos_session';
const CHAVE_AVISO  = 'dsos_aviso_login';   // lido e exibido por auth.js
const PING_MS      = 30 * 1000;

const CABECALHOS = { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

function sessaoLocal() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null'); }
  catch (_) { return null; }
}

// true = viva, false = morta, null = não deu para saber (rede fora, 5xx).
// Falha de rede não desloga ninguém: se ela durar mais de 5 min o token morre
// no banco e o primeiro ping que passar devolve `false`.
export async function sessaoViva() {
  const s = sessaoLocal();
  if (!s?.token) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/rpc_sessao_ping`, {
      method: 'POST',
      headers: CABECALHOS,   // o X-Sessao-Token entra pelo sessao-header.js
      body: JSON.stringify({ p_usuario_nome: s.nome || '' }),
    });
    if (!r.ok) return null;
    return (await r.json()) !== null;
  } catch (_) {
    return null;
  }
}

let _expirando = false;
export function expirarSessao() {
  if (_expirando) return;
  _expirando = true;
  sessionStorage.removeItem(CHAVE_SESSAO);
  sessionStorage.removeItem('dsos_login_time');
  sessionStorage.setItem(CHAVE_AVISO, 'Sua sessão expirou. Entre de novo.');
  window.location.href = 'login.html';
}

async function conferir() {
  const viva = await sessaoViva();
  if (viva === false) expirarSessao();
  return viva !== false;
}

// Chamar logo depois de ler a sessão do sessionStorage. Devolve false quando a
// sessão já está morta — o painel deve parar a inicialização ali (o
// redirecionamento para o login já foi disparado).
export async function manterSessaoViva() {
  if (!(await conferir())) return false;

  setInterval(conferir, PING_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
  // Voltou pelo botão "voltar" e a página saiu do bfcache: timers ficaram
  // parados, conferir na hora.
  window.addEventListener('pageshow', e => { if (e.persisted) conferir(); });

  window.addEventListener('pagehide', () => {
    const token = sessaoLocal()?.token;
    if (!token) return;
    navigator.sendBeacon(
      `${SB_URL}/rest/v1/rpc/rpc_sessao_encerrar?apikey=${SB_KEY}`,
      new Blob([JSON.stringify({ p_token: token })], { type: 'application/json' })
    );
  });
  return true;
}

// Logout de verdade: apaga o token no banco. Chamar ANTES de limpar o
// sessionStorage (é de lá que o token sai).
export async function encerrarSessao() {
  const token = sessaoLocal()?.token;
  if (!token) return;
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/rpc_sessao_encerrar`, {
      method: 'POST',
      headers: CABECALHOS,
      body: JSON.stringify({ p_token: token, p_logout: true }),
      keepalive: true,
    });
  } catch (_) { /* sem rede: o token morre sozinho em 5 min */ }
}
