// DSos — diagnostico.js
// ── Central de diagnóstico do sistema ───────────────────────────────────────
//
// O QUE É
// Uma página só de diagnóstico: reúne num lugar só as verificações das partes
// importantes do DSos (conexão, APIs, autenticação, permissões/RLS, sessão,
// realtime, formulários/utilidades e storage), roda cada uma individualmente
// ou todas de uma vez, e mostra APROVADO / FALHOU / AVISO / ERRO com a
// mensagem e o detalhe de cada caso. Não é suíte de CI — é o "o sistema está
// saudável AGORA?", rodando no runtime real do navegador.
//
// POR QUE NO NAVEGADOR (e não só no runner de tests/)
// As suítes em tests/*.test.js batem direto na REST pela linha de comando e
// cobrem muito bem RLS/token. O que elas NÃO alcançam e este painel cobre:
// conectividade REST/Edge/Realtime no ambiente real, o WebSocket do Realtime,
// os headers de segurança (CSP) servidos, e as funções puras de UI — tudo
// exercitado como o usuário final exercita.
//
// ── SEGURANÇA / DADOS REAIS ──────────────────────────────────────────────────
// Por padrão SÓ rodam testes de LEITURA e NEGATIVOS — seguros por construção:
//   * ler uma tabela fechada e exigir que seja RECUSADA;
//   * tentar escrever com token forjado e exigir que seja RECUSADA;
//   * PATCH em id=-1, que nunca casa linha nenhuma (padrão de tests/).
// Nenhum deles altera dado. Os testes que CRIAM dado ficam atrás do botão
// "Modo de escrita" (desligado por padrão): usam prefixo ZZTESTE- e se
// limpam sozinhos, ou consomem só cota (Groq) — nunca tocam dado de produção.
//
// NÃO instalamos o interceptor de sessao-header.js aqui DE PROPÓSITO: este
// módulo monta o header de cada requisição à mão, para ter controle total de
// "com token" x "sem token" — senão os testes negativos mandariam sem querer
// o token da sessão aberta na aba.

import { SB_URL, SB_KEY } from './supabase-config.js';
import { escapeHtml, statusLabel, tipoIcon } from './ui.js';

// ── Referências conhecidas dos bancos (para identificar prod x teste) ────────
const REFS = {
  goitceguoynlwvtexbdu: 'PRODUÇÃO',
  nifgrbwvhxkrjxhxcjxw: 'TESTE',
};
const REF = (SB_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '';
const AMBIENTE = REFS[REF] || 'DESCONHECIDO';

// ── HTTP ─────────────────────────────────────────────────────────────────────
const baseHeaders = () => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
});

function rest(caminho, { method = 'GET', body, token, prefer } = {}) {
  const headers = baseHeaders();
  if (token) headers['X-Sessao-Token'] = token;
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SB_URL}/rest/v1/${caminho}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

const rpc = (nome, body = {}, opts = {}) =>
  rest(`rpc/${nome}`, { method: 'POST', body, ...opts });

/** Corpo tolerante a 204 / resposta não-JSON. */
async function corpo(r) {
  const txt = await r.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
}

// ── Resultado de um teste ────────────────────────────────────────────────────
// status: 'ok' (✅) | 'falha' (❌) | 'aviso' (⚠️) | 'erro' (💥)
const ok    = (msg, detalhe) => ({ status: 'ok', msg, detalhe });
const falha = (msg, detalhe) => ({ status: 'falha', msg, detalhe });
const aviso = (msg, detalhe) => ({ status: 'aviso', msg, detalhe });

// Sessão gravada pelo login (mesma origem dos painéis). Usada pelos testes que
// precisam de um token válido (marcados `requerSessao`).
function sessaoLocal() {
  try { return JSON.parse(sessionStorage.getItem('dsos_session') || 'null'); }
  catch { return null; }
}

const N_ALTO = () => 900_000_000 + Math.floor(Math.random() * 1_000_000);
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)))
  .map((b) => b.toString(16).padStart(2, '0')).join('');

// ═════════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE TESTES
// Cada teste: { id, nome, escrita?, requerSessao?, consumo?, run: async(ctx) }
// ctx = { sessao }
// ═════════════════════════════════════════════════════════════════════════════
const CATEGORIAS = [

  // ── 1. AMBIENTE & CONFIGURAÇÃO ─────────────────────────────────────────────
  { nome: 'Ambiente & Configuração', icone: '⚙️', testes: [
    { id: 'cfg-url', nome: 'supabase-config.js carregado (URL + anon key)', run: async () => {
      if (!SB_URL || !SB_KEY) return falha('URL ou anon key ausente — veja SETUP.md');
      return ok(`URL e chave presentes`, `URL: ${SB_URL}`);
    }},
    { id: 'cfg-jwt', nome: 'Anon key tem formato de JWT', run: async () => {
      const partes = String(SB_KEY).split('.');
      if (partes.length !== 3) return aviso('A chave não parece um JWT (3 partes)', `partes: ${partes.length}`);
      try {
        const h = JSON.parse(atob(partes[0]));
        return ok(`JWT válido (alg=${h.alg})`);
      } catch { return aviso('Cabeçalho do JWT não decodificou'); }
    }},
    { id: 'cfg-ambiente', nome: 'Identificação do banco', run: async () => {
      if (AMBIENTE === 'TESTE') return ok(`Banco de TESTE (${REF})`);
      if (AMBIENTE === 'PRODUÇÃO') return aviso(`Apontando para PRODUÇÃO (${REF})`, 'Cuidado com o modo de escrita. Prefira o banco de teste para validar mudanças.');
      return aviso(`Banco não reconhecido (${REF || '—'})`);
    }},
    { id: 'cfg-sessao', nome: 'Sessão ativa no navegador', run: async () => {
      const s = sessaoLocal();
      if (!s?.token) return aviso('Sem sessão — faça login para habilitar os testes que exigem token', 'Testes marcados "requer sessão" ficarão em aviso.');
      const fmt = /^[0-9a-f]{64}$/.test(s.token);
      return ok(`Logado como "${s.tipo}" (${s.nome || s.login || s.tag || '—'})`,
        fmt ? 'token com 64 hex, formato correto' : 'ATENÇÃO: token fora do formato 64 hex');
    }},
    { id: 'cfg-csp', nome: 'Headers de segurança (CSP) servidos', run: async () => {
      try {
        const r = await fetch(location.href, { method: 'GET', cache: 'no-store' });
        const csp = r.headers.get('content-security-policy');
        if (!csp) return aviso('Sem CSP nesta origem', 'Normal em localhost — a CSP é aplicada pelo netlify.toml só em produção.');
        const temFrame = /frame-ancestors/.test(csp);
        return ok('CSP presente' + (temFrame ? ' (com frame-ancestors)' : ''), csp.slice(0, 180) + '…');
      } catch (e) { return aviso('Não foi possível ler os headers da própria página', e.message); }
    }},
  ]},

  // ── 2. CONEXÃO & APIs ──────────────────────────────────────────────────────
  { nome: 'Conexão & APIs', icone: '🔌', testes: [
    { id: 'api-rest', nome: 'PostgREST responde', run: async () => {
      const r = await rest('realtime_sinal?select=id&limit=1');
      if (!r.ok) return falha(`REST respondeu ${r.status}`, JSON.stringify(await corpo(r)).slice(0, 200));
      return ok('REST no ar (200)');
    }},
    { id: 'api-sinal', nome: 'Tabela realtime_sinal legível (canal do Realtime)', run: async () => {
      const r = await rest('realtime_sinal?select=*&order=id.desc&limit=5');
      const linhas = await corpo(r);
      if (!r.ok || !Array.isArray(linhas)) return falha('realtime_sinal não respondeu lista', JSON.stringify(linhas).slice(0, 200));
      // Trava de contrato: a tabela NÃO pode carregar coluna sensível.
      const permitidas = new Set(['id', 'canal', 'ref_id', 'evento', 'em']);
      const extras = linhas.length ? Object.keys(linhas[0]).filter((k) => !permitidas.has(k)) : [];
      if (extras.length) return falha('realtime_sinal expôs coluna fora do contrato', `extras: ${extras.join(', ')} — possível vazamento pelo WebSocket`);
      return ok(`Legível e com shape correto (${linhas.length} linha[s] recente[s])`);
    }},
    { id: 'api-groq', nome: 'Edge Function groq-proxy alcançável', run: async () => {
      const r = await fetch(`${SB_URL}/functions/v1/groq-proxy`, { method: 'OPTIONS' });
      if (r.status === 404) return falha('groq-proxy não encontrada (404)');
      if (!r.ok && r.status !== 204) return aviso(`Preflight respondeu ${r.status}`);
      return ok(`Preflight CORS OK (${r.status})`);
    }},
    { id: 'api-limpar', nome: 'Edge Function fn-limpar-dados alcançável', run: async () => {
      const r = await fetch(`${SB_URL}/functions/v1/fn-limpar-dados`, { method: 'OPTIONS' });
      if (r.status === 404) return falha('fn-limpar-dados não encontrada (404)');
      if (!r.ok && r.status !== 204) return aviso(`Preflight respondeu ${r.status}`);
      return ok(`Preflight CORS OK (${r.status})`);
    }},
    { id: 'api-otp', nome: 'fn-enviar-otp foi removida (L12)', run: async () => {
      // L12: função morta que rodava com service_role. O ideal é não existir (404);
      // enquanto não for deletada da nuvem, o stub 410 inerte ainda é aceitável.
      const r = await fetch(`${SB_URL}/functions/v1/fn-enviar-otp`, { method: 'POST', headers: baseHeaders(), body: '{}' });
      if (r.status === 404) return ok('Função não existe mais (removida de vez) — L12 fechada');
      if (r.status === 410) return aviso('Ainda publicada como stub 410 inerte', 'Falta deletar da nuvem: Supabase → Edge Functions → fn-enviar-otp → Delete.');
      return aviso(`Respondeu ${r.status}`, 'Esperado 404 (removida) ou 410 (stub inerte).');
    }},
  ]},

  // ── 3. AUTENTICAÇÃO ────────────────────────────────────────────────────────
  { nome: 'Autenticação', icone: '🔑', testes: [
    ...['rpc_login_ti', 'rpc_login_pc', 'rpc_login_professor'].map((fn) => ({
      id: `auth-${fn}`, nome: `${fn}: credencial inválida → lista vazia`, run: async () => {
        const body = fn === 'rpc_login_pc'
          ? { p_tag: '__DIAG_NAO_EXISTE__', p_senha: '__errada__' }
          : { p_login: '__diag_nao_existe__', p_senha: '__errada__' };
        const r = await rpc(fn, body);
        if (r.status !== 200) return falha(`respondeu ${r.status}, esperava 200`);
        const c = await corpo(r);
        if (Array.isArray(c) && c.length === 0) return ok('200 com [] — não vaza, não erra');
        return falha('não devolveu lista vazia', JSON.stringify(c).slice(0, 200));
      },
    })),
    { id: 'auth-valida-forjado', nome: 'rpc_sessao_valida com token forjado → null', run: async () => {
      const r = await rpc('rpc_sessao_valida', { p_token: hex(32) });
      const c = await corpo(r);
      if (r.status === 200 && c === null) return ok('Token forjado não vira sessão (null)');
      return falha('token forjado não devolveu null', `status ${r.status} / ${JSON.stringify(c)}`);
    }},
    { id: 'auth-valida-real', nome: 'Token da sessão atual é válido', requerSessao: true, run: async ({ sessao }) => {
      const r = await rpc('rpc_sessao_valida', { p_token: sessao.token });
      const c = await corpo(r);
      if (r.status === 200 && typeof c === 'string' && c) return ok(`Sessão viva, papel "${c}"`);
      return falha('a sessão atual não validou no banco', `status ${r.status} / ${JSON.stringify(c)} — token pode ter expirado`);
    }},
  ]},

  // ── 4. PERMISSÕES & RLS ────────────────────────────────────────────────────
  { nome: 'Permissões & RLS', icone: '🛡️', testes: [
    ...[
      ['sessao_token?select=*&limit=1', 'sessao_token (tokens de todos)'],
      ['pc_senha?select=*&limit=1', 'pc_senha (senhas dos PCs)'],
      ['professor?select=senha_hash&limit=1', 'professor.senha_hash'],
      ['usuario_ti?select=senha&limit=1', 'usuario_ti.senha'],
    ].map(([caminho, rotulo]) => ({
      id: `rls-${caminho}`, nome: `${rotulo} é inacessível`, run: async () => {
        const r = await rest(caminho);
        if (!r.ok) return ok(`Recusado (${r.status}) — segredo protegido`);
        // 200 com [] ainda seria exposição da estrutura; exigimos recusa.
        return falha(`respondeu ${r.status} — o segredo ficou legível`, JSON.stringify(await corpo(r)).slice(0, 200));
      },
    })),
    ...[['ticket', 'chamados'], ['mensagem', 'chat']].map(([tab, rotulo]) => ({
      id: `rls-semtoken-${tab}`, nome: `${rotulo}: GET sem token não devolve dado`, run: async () => {
        const r = await rest(`${tab}?select=*&limit=50`);
        if (!r.ok) return ok(`Recusado (${r.status})`);
        const c = await corpo(r);
        if (Array.isArray(c) && c.length === 0) return ok('200 com [] — nada vaza sem sessão');
        return falha(`vazou ${Array.isArray(c) ? c.length : '?'} linha(s) sem token`, JSON.stringify(c).slice(0, 200));
      },
    })),
    ...['v_pc_pub', 'v_usuario_ti_pub'].map((v) => ({
      id: `rls-view-${v}`, nome: `${v} responde e não expõe senha`, run: async () => {
        const r = await rest(`${v}?select=*&limit=1`);
        if (r.status !== 200) return falha(`${v} respondeu ${r.status}`, 'a tela de login/painel depende dessa view');
        const c = await corpo(r);
        if (Array.isArray(c) && c[0]) {
          for (const col of ['senha', 'senha_hash']) {
            if (col in c[0]) return falha(`${v} passou a expor ${col}`);
          }
        }
        return ok('200, sem coluna de senha');
      },
    })),
    ...[['ticket', { nota_interna: 'diag' }], ['pc', { status_pc: 'descartado' }]].map(([tab, patch]) => ({
      id: `rls-patch-${tab}`, nome: `PATCH direto em ${tab} (id=-1) não altera nada`, run: async () => {
        // id=-1 nunca casa linha: seguro mesmo se a policy estiver aberta.
        const r = await rest(`${tab}?id=eq.-1`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
        if (!r.ok) return ok(`Recusado/sem efeito (${r.status})`);
        const c = await corpo(r);
        if (Array.isArray(c) && c.length === 0) return ok('0 linhas alteradas');
        return falha(`PATCH direto em ${tab} alterou ${Array.isArray(c) ? c.length : '?'} linha(s)`);
      },
    })),
    { id: 'rls-rpc-ticket-forjado', nome: 'rpc_ti_atualizar_ticket recusa token forjado', run: async () => {
      const r = await rpc('rpc_ti_atualizar_ticket', { p_token: hex(32), p_ticket_id: -1, p_patch: { nota_interna: 'x' } });
      if (r.ok) return falha('a RPC aceitou um token forjado');
      const c = await corpo(r);
      return ok(`Recusado (${r.status})`, (c?.message || '').slice(0, 160));
    }},
    { id: 'rls-rpc-avaliar-forjado', nome: 'rpc_avaliar_ticket recusa token forjado', run: async () => {
      const r = await rpc('rpc_avaliar_ticket', { p_token: hex(32), p_ticket_id: -1, p_nota: 5, p_comentario: '' });
      if (r.ok) return falha('a RPC aceitou um token forjado');
      return ok(`Recusado (${r.status})`);
    }},
    { id: 'rls-l2-logs', nome: 'acesso_log: GET sem token não devolve dado (L2)', run: async () => {
      // L2 CORRIGIDA (migration 20260911160000): logs exigem sessão de T.I.
      // Sem token a policy reprova → 200 com []. Se voltar a vazar, é regressão.
      const r = await rest('acesso_log?select=id&limit=1');
      if (!r.ok) return ok(`Recusado (${r.status}) — L2 fechada`);
      const c = await corpo(r);
      if (Array.isArray(c) && c.length === 0) return ok('200 com [] — L2 fechada (logs exigem sessão de T.I.)');
      if (Array.isArray(c)) return falha(`vazou ${c.length} linha(s) de log sem sessão — L2 reaberta`, JSON.stringify(c).slice(0, 160));
      return aviso('Resposta inesperada', JSON.stringify(c).slice(0, 160));
    }},
    { id: 'rls-l4-presenca', nome: 'sessao_ativa: GET sem token não devolve dado (L4)', run: async () => {
      // L4 CORRIGIDA junto com L2: presença exige sessão de T.I.
      const r = await rest('sessao_ativa?select=usuario_id&limit=1');
      if (!r.ok) return ok(`Recusado (${r.status}) — L4 fechada`);
      const c = await corpo(r);
      if (Array.isArray(c) && c.length === 0) return ok('200 com [] — L4 fechada (presença exige sessão de T.I.)');
      if (Array.isArray(c)) return falha(`vazou presença sem sessão — L4 reaberta: ${c.length} linha(s)`, JSON.stringify(c).slice(0, 160));
      return aviso('Resposta inesperada', JSON.stringify(c).slice(0, 160));
    }},
  ]},

  // ── 5. SESSÃO ──────────────────────────────────────────────────────────────
  { nome: 'Sessão', icone: '⏱️', testes: [
    { id: 'ses-ping-sem', nome: 'rpc_sessao_ping sem token → null', run: async () => {
      const r = await rpc('rpc_sessao_ping', { p_usuario_nome: 'diag' });
      const c = await corpo(r);
      if (r.status === 200 && c === null) return ok('Sem token, sessão é considerada morta (null)');
      return falha('ping sem token não devolveu null', `status ${r.status} / ${JSON.stringify(c)}`);
    }},
    { id: 'ses-ping-forjado', nome: 'rpc_sessao_ping com token forjado → null', run: async () => {
      const r = await rpc('rpc_sessao_ping', {}, { token: hex(32) });
      const c = await corpo(r);
      if (r.status === 200 && c === null) return ok('Token inexistente não vira sessão');
      return falha('ping com token forjado não devolveu null', `${r.status} / ${JSON.stringify(c)}`);
    }},
    { id: 'ses-ping-presenca', nome: 'ping não grava presença por id vindo no corpo', run: async () => {
      const id = N_ALTO();
      await rpc('rpc_sessao_ping', { p_usuario_id: id, p_usuario_tipo: 'ti', p_usuario_login: 'diag', p_usuario_nome: 'diag' }, { token: hex(32) });
      const r = await rest(`sessao_ativa?usuario_id=eq.${id}&select=usuario_id`);
      const c = await corpo(r);
      if (Array.isArray(c) && c.length === 0) return ok('Presença não foi gravada sem token válido');
      return falha('o ping gravou presença só pelo id do corpo', JSON.stringify(c).slice(0, 160));
    }},
    { id: 'ses-encerrar-forjado', nome: 'rpc_sessao_encerrar com token forjado não erra', run: async () => {
      const r = await rpc('rpc_sessao_encerrar', { p_token: hex(32), p_logout: true });
      if ([200, 204].includes(r.status)) return ok(`Ignora token forjado (${r.status})`);
      return falha(`respondeu ${r.status}`);
    }},
  ]},

  // ── 6. REALTIME (navegador) ────────────────────────────────────────────────
  { nome: 'Realtime', icone: '📡', testes: [
    { id: 'rt-subscribe', nome: 'WebSocket assina realtime_sinal (SUBSCRIBED)', run: async () => {
      if (!window.supabase?.createClient) return aviso('supabase-js não carregou (CDN)', 'Confira a tag <script> de supabase-js e a CSP.');
      const client = window.supabase.createClient(SB_URL, SB_KEY);
      return await new Promise((resolve) => {
        let pronto = false;
        const limite = setTimeout(() => {
          if (pronto) return;
          pronto = true;
          try { client.removeAllChannels(); } catch {}
          resolve(aviso('Timeout (8s) sem SUBSCRIBED', 'Rede/WS pode estar bloqueado. O poll de 15–30s é a rede de segurança.'));
        }, 8000);
        const ch = client.channel('diag-' + hex(3))
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_sinal' }, () => {})
          .subscribe((status, err) => {
            if (pronto) return;
            if (status === 'SUBSCRIBED') {
              pronto = true; clearTimeout(limite);
              try { client.removeChannel(ch); } catch {}
              resolve(ok('Canal conectado (SUBSCRIBED)'));
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              pronto = true; clearTimeout(limite);
              try { client.removeChannel(ch); } catch {}
              resolve(falha(`Canal falhou (${status})`, String(err || '')));
            }
          });
      });
    }},
  ]},

  // ── 7. FORMULÁRIOS & UTILIDADES (funções puras) ────────────────────────────
  { nome: 'Formulários & Utilidades', icone: '🧩', testes: [
    { id: 'fn-escape', nome: 'escapeHtml() neutraliza HTML (XSS)', run: async () => {
      const e = escapeHtml(`<img src=x onerror="alert(1)">&'"`);
      if (e.includes('<') || e.includes('>')) return falha('escapeHtml deixou passar < ou >', e);
      const esperado = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&quot;';
      return e === esperado ? ok('Escapa <, >, &, ", \' corretamente') : falha('saída inesperada', e);
    }},
    { id: 'fn-status', nome: 'statusLabel() traduz status e variante caps', run: async () => {
      const base = statusLabel('em_andamento');
      const caps = statusLabel('em_andamento', 'caps');
      if (base === 'Em andamento' && caps === 'EM PROGRESSO') return ok(`"${base}" / "${caps}"`);
      return falha('rótulos divergentes', `base="${base}" caps="${caps}"`);
    }},
    { id: 'fn-tipoicon', nome: 'tipoIcon() devolve SVG por tipo', run: async () => {
      const svg = tipoIcon('hardware');
      if (typeof svg === 'string' && svg.includes('<svg')) return ok('Ícone de hardware gerado');
      return falha('não devolveu SVG', String(svg).slice(0, 80));
    }},
    { id: 'fn-nao-cobertas', nome: 'Funções acopladas ao DOM (não unit-testáveis)', run: async () => {
      // Registrado de propósito, igual a tests/README.md: _similaridade
      // (detecção de duplicata, painel-pc) e _getUserAgent (fingerprint,
      // logging) não são exportadas; testá-las exigiria extrair do módulo.
      return aviso('Não cobertas aqui: _similaridade, fingerprint de logging', 'Dependem do DOM/módulo. Mesmo registro de tests/README.md.');
    }},
  ]},

  // ── 8. ARQUIVOS / STORAGE ──────────────────────────────────────────────────
  { nome: 'Arquivos / Storage', icone: '🗂️', testes: [
    { id: 'st-reach', nome: 'API de Storage alcançável', run: async () => {
      // Objeto inexistente no bucket público: 400/404 prova que o serviço
      // responde, sem criar nada.
      const r = await fetch(`${SB_URL}/storage/v1/object/public/chat-prints/__diag_nao_existe__.png`, { headers: { apikey: SB_KEY } });
      if (r.status === 200) return aviso('Objeto de teste existiu (inesperado)');
      if ([400, 404].includes(r.status)) return ok(`Storage no ar (${r.status} para objeto inexistente)`);
      return aviso(`Respondeu ${r.status}`);
    }},
    { id: 'st-l3', nome: 'Bucket chat-prints é público (lacuna conhecida L3)', run: async () => {
      return aviso('Prints do chat ficam em bucket público (L3)', 'Quem tiver a URL acessa sem sessão. O segredo é só a aleatoriedade do nome. Ver docs/regras-de-acesso.md §3.7/L3.');
    }},
  ]},

  // ── 9. MODO DE ESCRITA (opt-in) ────────────────────────────────────────────
  // Só rodam com o "Modo de escrita" ligado. Criam dado ZZTESTE- e se limpam,
  // ou consomem só cota. Nunca tocam dado real.
  { nome: 'Escrita (opt-in)', icone: '✍️', escrita: true, testes: [
    { id: 'w-groq', nome: 'Chamada real à Groq (consome cota mínima)', escrita: true, consumo: true, requerSessao: true, run: async ({ sessao }) => {
      const r = await fetch(`${SB_URL}/functions/v1/groq-proxy`, {
        method: 'POST',
        headers: { ...baseHeaders(), 'X-Sessao-Token': sessao.token },
        body: JSON.stringify({ model: 'openai/gpt-oss-20b', temperature: 0, max_tokens: 50, messages: [{ role: 'user', content: 'responda apenas: ok' }] }),
      });
      if (r.status === 401) return falha('groq-proxy recusou a sessão (401)', 'token expirado? o gate L7 exige sessão viva');
      if (r.status === 500) return aviso('groq-proxy respondeu 500', 'provável GROQ_KEY não configurada (L13) — ver SETUP.md');
      if (!r.ok) return falha(`groq-proxy respondeu ${r.status}`, JSON.stringify(await corpo(r)).slice(0, 200));
      const d = await corpo(r);
      const txt = d?.choices?.[0]?.message?.content;
      return txt != null ? ok('IA respondeu pela proxy', String(txt).slice(0, 80)) : falha('sem choices na resposta', JSON.stringify(d).slice(0, 200));
    }},
    { id: 'w-ciclo', nome: 'Ciclo completo PC (cadastro→login→chamado→chat→leitura→exclusão)', escrita: true, requerSessao: true, run: async ({ sessao }) => {
      // Cadastro/exclusão de PC exigem sessão de T.I. (migration 20261111120000).
      if (sessao?.tipo !== 'ti') return aviso('Requer sessão de T.I.', 'rpc_cadastrar_pc/rpc_deletar_pc só aceitam token de T.I.');
      const tokenTi = sessao.token;
      // Exercita o fluxo de ponta a ponta com dados descartáveis e se limpa:
      // rpc_deletar_pc cascateia e leva chamados + mensagens junto.
      const sufixo = hex(3).toUpperCase();
      const tag = `ZZTESTE-DIAG-${sufixo}`;
      const senha = `Zz!${hex(5)}`;
      const lab = `ZZTESTE-DIAG-LAB`;
      const passos = [];
      let pcId = null;
      let token = null;
      try {
        // 1. cadastrar PC
        let r = await rpc('rpc_cadastrar_pc', { p_tag: tag, p_laboratorio: lab, p_lado: 'A', p_senha: senha }, { token: tokenTi });
        let c = await corpo(r);
        const pc = Array.isArray(c) ? c[0] : c;
        if (!r.ok || !pc?.id) return falha('falhou no cadastro do PC', JSON.stringify(c).slice(0, 200));
        pcId = pc.id; passos.push(`PC #${pcId} cadastrado`);

        // 2. login do PC → token
        r = await rpc('rpc_login_pc', { p_tag: tag, p_senha: senha });
        c = await corpo(r);
        token = Array.isArray(c) && c[0]?.token;
        if (!token) return falha('login do PC não devolveu token', JSON.stringify(c).slice(0, 200));
        passos.push('login OK (token emitido)');

        // 3. abrir chamado (INSERT com o token do próprio PC)
        r = await rest('ticket', { method: 'POST', token, prefer: 'return=representation', body: {
          pc_origem: pcId, pc_problema: pcId, tipo: 'hardware', descricao: `${tag}-CHAMADO`,
          laboratorio: lab, lado: 'A', status: 'aberto', prioridade: 'baixo', nome_solicitante: tag,
        }});
        c = await corpo(r);
        const ticket = Array.isArray(c) ? c[0] : c;
        if (!r.ok || !ticket?.id) return falha('falhou ao abrir chamado', JSON.stringify(c).slice(0, 200));
        passos.push(`chamado #${ticket.id} aberto (return=representation trouxe o id)`);

        // 4. enviar mensagem
        r = await rest('mensagem', { method: 'POST', token, body: { ticket_id: ticket.id, remetente: 'PC', conteudo: `${tag}-MSG`, nome_remetente: tag } });
        if (!r.ok) return falha('falhou ao enviar mensagem', `status ${r.status}`);
        passos.push('mensagem enviada');

        // 5. ler de volta COM token (prova a leitura por sessão)
        r = await rest(`ticket?id=eq.${ticket.id}&select=id`, { token });
        c = await corpo(r);
        if (!(Array.isArray(c) && c.length === 1)) return falha('o PC não leu o próprio chamado de volta', JSON.stringify(c).slice(0, 160));
        passos.push('leitura do próprio chamado OK');

        // 6. ler de volta SEM token (tem que sumir)
        r = await rest(`ticket?id=eq.${ticket.id}&select=id`);
        c = await corpo(r);
        if (Array.isArray(c) && c.length > 0) return falha('o chamado apareceu SEM token (vazamento)', JSON.stringify(c).slice(0, 160));
        passos.push('sem token o chamado some (isolamento OK)');

        return ok('Ciclo completo passou', passos.join(' · '));
      } finally {
        // Limpeza: rpc_deletar_pc leva chamados e mensagens no cascade.
        if (pcId != null) {
          try { await rpc('rpc_deletar_pc', { p_id: pcId }, { token: tokenTi }); passos.push('limpeza: PC e chamados removidos'); }
          catch (e) { passos.push('LIMPEZA FALHOU: apague ' + tag + ' à mão (' + e.message + ')'); }
        }
        // O token emitido no login fica órfão em sessao_token (rpc_deletar_pc
        // não o remove). Sem ping ele morre sozinho em 5 min, mas encerramos
        // aqui para não deixar nem essa linha para trás.
        if (token) {
          try { await rpc('rpc_sessao_encerrar', { p_token: token, p_logout: true }); }
          catch (_) { /* sem rede: o token expira em 5 min de qualquer forma */ }
        }
      }
    }},
  ]},
];

// ═════════════════════════════════════════════════════════════════════════════
// RUNNER + UI
// ═════════════════════════════════════════════════════════════════════════════
const ICONE = { ok: '✅', falha: '❌', aviso: '⚠️', erro: '💥', rodando: '⏳', idle: '•' };
const LABEL = { ok: 'APROVADO', falha: 'FALHOU', aviso: 'AVISO', erro: 'ERRO', rodando: 'Rodando…', idle: 'Não executado' };

let modoEscrita = false;
const estado = new Map(); // id → {status, msg, detalhe}

const $ = (id) => document.getElementById(id);
const todosOsTestes = () => CATEGORIAS.flatMap((c) => c.testes.map((t) => ({ ...t, _catEscrita: c.escrita })));

function testeHabilitado(t) {
  return modoEscrita || !(t.escrita || t._catEscrita);
}

// ── Render inicial ───────────────────────────────────────────────────────────
function montar() {
  const raiz = $('diag-categorias');
  raiz.innerHTML = CATEGORIAS.map((cat) => {
    const linhas = cat.testes.map((t) => `
      <div class="diag-teste" id="row-${t.id}" data-escrita="${!!(t.escrita || cat.escrita)}">
        <div class="diag-teste-status" id="st-${t.id}"><span class="chip idle">${ICONE.idle} ${LABEL.idle}</span></div>
        <div class="diag-teste-corpo">
          <div class="diag-teste-nome">${escapeHtml(t.nome)}
            ${t.requerSessao ? '<span class="tag-req">requer sessão</span>' : ''}
            ${t.consumo ? '<span class="tag-req consumo">consome cota</span>' : ''}
          </div>
          <div class="diag-teste-msg" id="msg-${t.id}"></div>
        </div>
        <button class="diag-run-um" id="btn-${t.id}" title="Rodar só este teste">▶</button>
      </div>`).join('');
    return `
      <section class="diag-cat${cat.escrita ? ' diag-cat-escrita' : ''}" id="cat-${cat.nome.replace(/\W+/g, '')}">
        <header class="diag-cat-head">
          <h2>${cat.icone} ${escapeHtml(cat.nome)}</h2>
          <button class="diag-run-cat" data-cat="${escapeHtml(cat.nome)}">Rodar categoria</button>
        </header>
        <div class="diag-cat-lista">${linhas}</div>
      </section>`;
  }).join('');

  // Handlers
  todosOsTestes().forEach((t) => {
    $(`btn-${t.id}`)?.addEventListener('click', () => rodarUm(t));
  });
  document.querySelectorAll('.diag-run-cat').forEach((b) => {
    b.addEventListener('click', () => rodarCategoria(b.dataset.cat));
  });
  atualizarResumo();
  atualizarModoEscritaUI();
}

function pintarLinha(t, resultado) {
  estado.set(t.id, resultado);
  const st = $(`st-${t.id}`);
  const msg = $(`msg-${t.id}`);
  if (st) st.innerHTML = `<span class="chip ${resultado.status}">${ICONE[resultado.status]} ${LABEL[resultado.status]}</span>`;
  if (msg) {
    msg.innerHTML = resultado.msg ? `<span class="diag-msg-txt">${escapeHtml(resultado.msg)}</span>` : '';
    if (resultado.detalhe) {
      msg.innerHTML += `<details class="diag-detalhe"><summary>detalhe</summary><pre>${escapeHtml(resultado.detalhe)}</pre></details>`;
    }
  }
}

async function executar(t) {
  if (!testeHabilitado(t)) {
    pintarLinha(t, aviso('Teste de escrita — ligue o "Modo de escrita" para rodar'));
    return;
  }
  if (t.requerSessao) {
    const s = sessaoLocal();
    if (!s?.token) { pintarLinha(t, aviso('Requer sessão — faça login primeiro')); return; }
  }
  const st = $(`st-${t.id}`);
  if (st) st.innerHTML = `<span class="chip rodando">${ICONE.rodando} ${LABEL.rodando}</span>`;
  const inicio = performance.now();
  try {
    const r = await t.run({ sessao: sessaoLocal() });
    r.ms = Math.round(performance.now() - inicio);
    pintarLinha(t, r);
  } catch (e) {
    pintarLinha(t, { status: 'erro', msg: 'Exceção não tratada', detalhe: (e && e.stack) || String(e) });
  }
  atualizarResumo();
}

async function rodarUm(t) {
  await executar(t);
  registrarLog([t]);
}

async function rodarCategoria(nomeCat) {
  const cat = CATEGORIAS.find((c) => c.nome === nomeCat);
  if (!cat) return;
  for (const t of cat.testes) await executar(t);
  registrarLog(cat.testes);
}

async function rodarTodos() {
  const btn = $('btn-todos');
  btn.disabled = true; btn.textContent = 'Executando…';
  const lista = todosOsTestes();
  for (const t of lista) await executar(t);
  btn.disabled = false; btn.textContent = 'Executar todos';
  registrarLog(lista, true);
}

// ── Resumo ───────────────────────────────────────────────────────────────────
function contar() {
  const c = { ok: 0, falha: 0, aviso: 0, erro: 0 };
  for (const r of estado.values()) if (c[r.status] != null) c[r.status]++;
  return c;
}
function atualizarResumo() {
  const c = contar();
  $('resumo').innerHTML =
    `<span class="r-ok">✅ ${c.ok} aprovados</span>` +
    `<span class="r-falha">❌ ${c.falha} falharam</span>` +
    `<span class="r-erro">💥 ${c.erro} erros</span>` +
    `<span class="r-aviso">⚠️ ${c.aviso} avisos</span>`;
}

// ── Log / histórico / exportação ─────────────────────────────────────────────
function registrarLog(testes, completo = false) {
  const linha = {
    em: new Date().toISOString(),
    ambiente: AMBIENTE,
    escopo: completo ? 'todos' : testes.length === 1 ? testes[0].id : testes.length + ' testes',
    resultados: testes.map((t) => ({ id: t.id, ...(estado.get(t.id) || { status: 'idle' }) })),
  };
  const log = $('diag-log');
  const c = contar();
  const resumo = `[${new Date().toLocaleTimeString('pt-BR')}] ${linha.escopo} — ✅${c.ok} ❌${c.falha} 💥${c.erro} ⚠️${c.aviso}`;
  const div = document.createElement('div');
  div.className = 'diag-log-linha';
  div.textContent = resumo;
  log.prepend(div);
  // Persiste a última corrida completa (per-origin, não sai do navegador).
  if (completo) {
    try { localStorage.setItem('dsos_diag_ultima', JSON.stringify(linha)); } catch {}
  }
  _ultimaCorrida = linha;
}
let _ultimaCorrida = null;

function exportar() {
  const dados = _ultimaCorrida || {
    em: new Date().toISOString(), ambiente: AMBIENTE, escopo: 'estado atual',
    resultados: [...estado.entries()].map(([id, r]) => ({ id, ...r })),
  };
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dsos-diagnostico-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function atualizarModoEscritaUI() {
  document.body.dataset.escrita = modoEscrita ? '1' : '0';
  const cb = $('toggle-escrita');
  if (cb) cb.checked = modoEscrita;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Banner de ambiente
  const banner = $('diag-ambiente');
  banner.className = 'diag-ambiente amb-' + AMBIENTE.toLowerCase().replace('ç', 'c').replace('ã', 'a');
  const s = sessaoLocal();
  banner.innerHTML =
    `<strong>Banco:</strong> ${AMBIENTE} <code>${REF || '—'}</code>` +
    ` · <strong>Sessão:</strong> ${s?.token ? `${s.tipo} (${escapeHtml(s.nome || s.login || s.tag || '—')})` : 'nenhuma'}`;

  montar();

  $('btn-todos').addEventListener('click', rodarTodos);
  $('btn-exportar').addEventListener('click', exportar);
  $('btn-limpar').addEventListener('click', () => {
    estado.clear();
    todosOsTestes().forEach((t) => {
      const st = $(`st-${t.id}`); const msg = $(`msg-${t.id}`);
      if (st) st.innerHTML = `<span class="chip idle">${ICONE.idle} ${LABEL.idle}</span>`;
      if (msg) msg.innerHTML = '';
    });
    $('diag-log').innerHTML = '';
    atualizarResumo();
  });
  $('toggle-escrita').addEventListener('change', (e) => {
    modoEscrita = e.target.checked;
    atualizarModoEscritaUI();
  });
});
