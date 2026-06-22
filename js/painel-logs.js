/* DSos v1.5 — painel-logs.js */
'use strict';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
import { SB_URL, SB_KEY, GROQ_KEY } from './supabase-config.js';
import { dsosConfirm } from './dsos-ui.js';

const CFG = {
  SB_URL,
  SB_KEY,
  PER_PAGE: 50,
  AR_INTERVAL: 30000,
};

// ── Sessões ativas (heartbeat) ──
let _sessoesAtivas = new Set(); // "id:tipo"
async function _carregarSessoesAtivas() {
  try {
    await fetch(`${CFG.SB_URL}/rest/v1/rpc/rpc_limpar_sessoes_mortas`, {
      method: 'POST', headers: { apikey: CFG.SB_KEY, Authorization: `Bearer ${CFG.SB_KEY}`, 'Content-Type': 'application/json' }, body: '{}'
    });
    const r = await fetch(`${CFG.SB_URL}/rest/v1/sessao_ativa?select=usuario_id,usuario_tipo`, {
      headers: { apikey: CFG.SB_KEY, Authorization: `Bearer ${CFG.SB_KEY}` }
    });
    const data = await r.json();
    _sessoesAtivas = new Set(Array.isArray(data) ? data.map(s => `${s.usuario_id}:${s.usuario_tipo}`) : []);
  } catch(_) {}
}
function _sessaoEstaAtiva(usuarioId, usuarioTipo) {
  return _sessoesAtivas.has(`${usuarioId}:${usuarioTipo}`);
}
function _atualizarCellsSessao() {
  // Atualiza cada linha já renderizada da aba acessos sem refazer o fetch
  document.querySelectorAll('.live-dur[data-start], .cell-sessao-inativa').forEach(el => {
    const row = el.closest('.table-row');
    if (!row) return;
    const uid  = row.dataset.uid;
    const tipo = row.dataset.utipo;
    if (!uid || !tipo) return;
    const ativo = _sessaoEstaAtiva(uid, tipo);
    if (ativo && !el.classList.contains('live-dur')) {
      // era inativa, virou ativa
      el.className = 'cell-mono live-dur';
      el.dataset.start = row.dataset.loginTs || '';
      el.style.color = 'var(--green)';
      el.removeAttribute('title');
    } else if (!ativo && el.classList.contains('live-dur')) {
      // era ativa, virou inativa (fechou aba)
      el.className = 'cell-mono cell-sessao-inativa';
      el.style.color = 'var(--muted)';
      el.title = 'Sessão encerrada sem logout';
      el.textContent = '—';
    }
  });
}

// ── tabelas e campos de ordenação ──
const TAB_META = {
  'auditoria':  { table: 'auditoria_ti',             order: 'executado_em' },
  'audit-log':  { table: 'audit_log',                order: 'timestamp'    },
  'atividades': { table: 'atividades_log',            order: 'timestamp'    },
  'acessos':    { table: 'acesso_log',                order: 'timestamp'    },
  'criticas':   { table: 'alteracoes_criticas_log',   order: 'timestamp'    },
};

// ── filtros disponíveis por aba ──
const TAB_FILTERS = {
  'auditoria': [
    { id: 'auditoria-dataStart', param: 'executado_em', op: 'gte', suffix: '' },
    { id: 'auditoria-dataEnd',   param: 'executado_em', op: 'lte', suffix: 'T23:59:59' },
    { id: 'auditoria-login',     param: 'login',        op: 'ilike' },
  ],
  'audit-log': [
    { id: 'audit-log-dataStart', param: 'timestamp', op: 'gte', suffix: '' },
    { id: 'audit-log-dataEnd',   param: 'timestamp', op: 'lte', suffix: 'T23:59:59' },
    { id: 'audit-log-tipo',      param: 'tipo_acao',      op: 'eq'    },
    { id: 'audit-log-tabela',    param: 'tabela_afetada', op: 'ilike' },
    { id: 'audit-log-status',    param: 'status',         op: 'eq'    },
  ],
  'atividades': [
    { id: 'atividades-dataStart', param: 'timestamp', op: 'gte', suffix: '' },
    { id: 'atividades-dataEnd',   param: 'timestamp', op: 'lte', suffix: 'T23:59:59' },
    { id: 'atividades-modulo',    param: 'modulo',  op: 'eq'  },
    { id: 'atividades-impacto',   param: 'impacto', op: 'eq'  },
  ],
  'acessos': [
    { id: 'acessos-dataStart', param: 'timestamp', op: 'gte', suffix: '' },
    { id: 'acessos-dataEnd',   param: 'timestamp', op: 'lte', suffix: 'T23:59:59' },
    { id: 'acessos-status',    param: 'status_login',  op: 'eq'    },
    { id: 'acessos-usuario',   param: 'usuario_login', op: 'ilike' },
  ],
  'criticas': [
    { id: 'criticas-dataStart', param: 'timestamp', op: 'gte', suffix: '' },
    { id: 'criticas-dataEnd',   param: 'timestamp', op: 'lte', suffix: 'T23:59:59' },
    { id: 'criticas-tabela',    param: 'tabela',   op: 'ilike' },
    { id: 'criticas-aprovado',  param: 'aprovado', op: 'eq'   },
  ],
};

// ── campos de texto para highlight por aba ──
const TAB_SEARCH_FIELDS = {
  'auditoria':  ['login'],
  'audit-log':  ['audit-log-tabela'],
  'atividades': [],
  'acessos':    ['acessos-usuario'],
  'criticas':   ['criticas-tabela'],
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const STATE = {
  abaAtiva: 'auditoria',
  pagina:    {},
  totais:    {},
  dados:     {},
  arTimers:  {},
  newCounts: {},
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  carregarUsuario();
  iniciarRelogio();
  registrarFiltros();
  registrarAutoRefresh();

  // restaurar aba da URL
  const abaUrl = new URLSearchParams(location.search).get('aba');
  const abaInicial = TAB_META[abaUrl] ? abaUrl : 'auditoria';
  if (abaInicial !== 'auditoria') {
    mudarAba(abaInicial);
  } else {
    carregarDados('auditoria');
  }

  iniciarRealtime();

  // Limpar sessões mortas e carregar sessões ativas
  _carregarSessoesAtivas();

  // Ctrl+K abre busca global
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      abrirBuscaGlobal();
    }
  });
});

function carregarUsuario() {
  const raw = sessionStorage.getItem('dsos_session');
  const session = raw ? JSON.parse(raw) : null;
  const nome = session?.nome || session?.login || sessionStorage.getItem('nome_usuario') || sessionStorage.getItem('usuario_nome');
  if (nome) document.getElementById('nome-usuario').textContent = nome;
}

function iniciarRelogio() {
  function tick() {
    const now = new Date();
    const hora = now.toLocaleTimeString('pt-BR');
    const data = now.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit' });
    const el = document.getElementById('info-data');
    if (el) el.textContent = `${data} · ${hora}`;

    const h = now.getHours();
    const turno = h >= 7 && h < 13 ? 'Manhã' : h >= 13 && h < 19 ? 'Tarde' : 'Noite';
    const et = document.getElementById('info-turno');
    if (et) et.textContent = turno;
  }
  tick();
  setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════════════
// TEMA
// ═══════════════════════════════════════════════════════════════
function toggleTema() {
  const html = document.documentElement;
  const dark = html.getAttribute('data-theme') !== 'light';
  html.setAttribute('data-theme', dark ? 'light' : 'dark');
  localStorage.setItem('dsos-tema', dark ? 'light' : 'dark');
  const ico = document.getElementById('ico-tema');
  if (ico) {
    ico.innerHTML = dark
      ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
}

(function restaurarTema() {
  const t = localStorage.getItem('dsos-tema');
  if (t) {
    document.documentElement.setAttribute('data-theme', t);
    if (t === 'light') {
      const ico = document.getElementById('ico-tema');
      if (ico) ico.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
  }
})();

(function _aplicarHacker(){
  if(localStorage.getItem('dsos_hacker')==='1')
    document.documentElement.dataset.hacker='1';
})();
window.toggleHacker=function(){
  const html=document.documentElement,on=html.dataset.hacker==='1';
  on?delete html.dataset.hacker:html.dataset.hacker='1';
  localStorage.setItem('dsos_hacker',on?'0':'1');
  const cb=document.getElementById('cfg-hacker');if(cb)cb.checked=!on;
};
window.abrirConfig=function(){
  const cb=document.getElementById('cfg-hacker');
  if(cb)cb.checked=localStorage.getItem('dsos_hacker')==='1';
  document.getElementById('modal-config')?.classList.add('open');
};
window.fecharConfig=function(){document.getElementById('modal-config')?.classList.remove('open');};
document.addEventListener('click',e=>{if(e.target?.id==='modal-config')window.fecharConfig();});

function voltarPainel() {
  window.location.href = 'painel-ti.html';
}

// ═══════════════════════════════════════════════════════════════
// ABAS
// ═══════════════════════════════════════════════════════════════
function mudarAba(aba) {
  const tabAtiva = document.getElementById(`tab-${STATE.abaAtiva}`);
  const panelAtivo = document.getElementById(`panel-${STATE.abaAtiva}`);
  if (tabAtiva) tabAtiva.classList.remove('active');
  if (panelAtivo) panelAtivo.classList.remove('active');

  const tabNova = document.getElementById(`tab-${aba}`);
  const panelNovo = document.getElementById(`panel-${aba}`);
  if (tabNova) tabNova.classList.add('active');
  if (panelNovo) panelNovo.classList.add('active');

  STATE.abaAtiva = aba;
  STATE.pagina[aba] = 0;

  STATE.newCounts[aba] = 0;
  _atualizarBadgeRT(aba);

  // persistir aba na URL
  const url = new URL(location.href);
  url.searchParams.set('aba', aba);
  history.replaceState(null, '', url);

  if (aba === 'dashboard') {
    carregarDashboard();
  } else if (aba === 'avaliacoes') {
    carregarAvaliacoes();
  } else if (!STATE.dados[aba]) {
    carregarDados(aba);
  }
}

// ═══════════════════════════════════════════════════════════════
// FILTROS
// ═══════════════════════════════════════════════════════════════
function registrarFiltros() {
  Object.entries(TAB_FILTERS).forEach(([aba, filtros]) => {
    filtros.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      const isText = el.tagName === 'INPUT' && el.type !== 'date';
      const handler = () => {
        STATE.pagina[aba] = 0;
        STATE.dados[aba] = null;
        carregarDados(aba);
      };
      if (isText) {
        el.addEventListener('input', debounce(handler, 350));
      } else {
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'change', handler);
      }
    });
  });
}

function limparFiltros(aba) {
  const filtros = TAB_FILTERS[aba] || [];
  filtros.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) el.value = '';
  });
  STATE.pagina[aba] = 0;
  STATE.dados[aba] = null;
  carregarDados(aba);
}

// ── atalhos de data rápida ──
function setDateRange(aba, range) {
  const hoje = new Date();
  const fmt = d => d.toISOString().split('T')[0];

  let start, end = fmt(hoje);

  if (range === 'today') {
    start = fmt(hoje);
  } else if (range === '24h') {
    const d = new Date(hoje); d.setDate(d.getDate() - 1);
    start = fmt(d);
  } else if (range === 'week') {
    const d = new Date(hoje); d.setDate(d.getDate() - 7);
    start = fmt(d);
  }

  const startEl = document.getElementById(`${aba}-dataStart`);
  const endEl   = document.getElementById(`${aba}-dataEnd`);
  if (startEl) startEl.value = start;
  if (endEl)   endEl.value   = end;

  STATE.pagina[aba] = 0;
  STATE.dados[aba]  = null;
  carregarDados(aba);
}

// ═══════════════════════════════════════════════════════════════
// AUTO-REFRESH
// ═══════════════════════════════════════════════════════════════
function registrarAutoRefresh() {
  document.querySelectorAll('.ar-check').forEach(chk => {
    const aba = chk.id.replace('ar-', '');
    chk.addEventListener('change', () => {
      if (chk.checked) {
        STATE.arTimers[aba] = setInterval(() => carregarDados(aba), CFG.AR_INTERVAL);
      } else {
        clearInterval(STATE.arTimers[aba]);
        delete STATE.arTimers[aba];
      }
    });
  });
}

function atualizarLastUpdate(aba) {
  const el = document.getElementById(`lu-${aba}`);
  if (el) {
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `Atualizado às ${hora}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// FETCH — UTILS
// ═══════════════════════════════════════════════════════════════
function headers() {
  return { 'apikey': CFG.SB_KEY, 'Authorization': `Bearer ${CFG.SB_KEY}`, 'Prefer': 'count=exact' };
}

function buildUrl(aba, opts = {}) {
  const meta = TAB_META[aba];
  if (!meta) return null;

  const page   = opts.allPages ? null : (STATE.pagina[aba] || 0);
  const offset = page !== null ? page * CFG.PER_PAGE : 0;
  const limit  = opts.allPages ? 10000 : CFG.PER_PAGE;

  let url = `${CFG.SB_URL}/rest/v1/${meta.table}?select=*&order=${meta.order}.desc&limit=${limit}&offset=${offset}`;

  const filtros = TAB_FILTERS[aba] || [];
  filtros.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    let val = el.value.trim();
    if (!val) return;

    if (f.param === 'aprovado') {
      url += `&aprovado=eq.${val === 'true'}`;
      return;
    }
    if (f.op === 'gte') { url += `&${f.param}=gte.${val}${f.suffix || ''}`; return; }
    if (f.op === 'lte') { url += `&${f.param}=lte.${val}${f.suffix || ''}`; return; }
    if (f.op === 'ilike') { url += `&${f.param}=ilike.%25${encodeURIComponent(val)}%25`; return; }
    if (f.op === 'eq')    { url += `&${f.param}=eq.${encodeURIComponent(val)}`; return; }
  });

  return url;
}

async function fetchAPI(url) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10);
  const data = await res.json();
  return [Array.isArray(data) ? data : [], total];
}

// ═══════════════════════════════════════════════════════════════
// CARREGAR DADOS
// ═══════════════════════════════════════════════════════════════
async function carregarDados(aba) {
  const container = document.getElementById(`rows-${aba}`);
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando…</div>';

  try {
    const url = buildUrl(aba);
    if (!url) throw new Error('Aba desconhecida: ' + aba);

    const [data, total] = await fetchAPI(url);

    STATE.dados[aba]  = data;
    STATE.totais[aba] = total;

    RENDER[aba]?.(data, container);
    RENDER_KPI[aba]?.(data);
    renderPaginacao(aba, total);
    atualizarLastUpdate(aba);
    atualizarContador(aba, total);

  } catch (err) {
    console.error(`[painel-logs] Erro ao carregar ${aba}:`, err);
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">⚠️</div>
      <p>Erro ao carregar dados — verifique a conexão.</p>
    </div>`;
  }
}

function atualizarContador(aba, total) {
  const el = document.getElementById(`ac-${aba}`);
  if (!el) return;
  const page    = STATE.pagina[aba] || 0;
  const inicio  = page * CFG.PER_PAGE + 1;
  const fim     = Math.min((page + 1) * CFG.PER_PAGE, total);
  el.textContent = total > 0 ? `${inicio}–${fim} de ${total} registros` : '0 registros';
}

// ═══════════════════════════════════════════════════════════════
// HIGHLIGHT
// ═══════════════════════════════════════════════════════════════
function hl(text, term) {
  if (!term || !text) return e(text);
  const escaped = e(text);
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedTerm})`, 'gi'), '<mark class="hl">$1</mark>');
}

function _getSearchTerm(aba, fieldSuffix) {
  const el = document.getElementById(fieldSuffix) || document.getElementById(`${aba}-${fieldSuffix}`);
  return el?.value?.trim() || '';
}

// ═══════════════════════════════════════════════════════════════
// RENDER ROWS
// ═══════════════════════════════════════════════════════════════
const RENDER = {

  auditoria(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    const term = _getSearchTerm('auditoria', 'auditoria-login');
    el.innerHTML = data.map(r => `
      <div class="table-row" style="grid-template-columns:150px 120px 1fr 200px"
           onclick='abrirModal("auditoria",${esc(r)})'>
        <span class="cell-date">${fmtData(r.executado_em)}</span>
        <span class="cell-user">${hl(r.login, term)}</span>
        <span>${e(r.acao)}</span>
        <span class="cell-trunc">${e(r.detalhes)}</span>
      </div>`).join('');
  },

  'audit-log'(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    const term = _getSearchTerm('audit-log', 'audit-log-tabela');
    el.innerHTML = data.map(r => {
      const erro = r.status === 'erro';
      return `
      <div class="table-row ${erro ? 'row-error' : ''}" style="grid-template-columns:150px 120px 80px 140px 80px"
           onclick='abrirModal("audit-log",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_login || r.usuario_nome)}</span>
        <span>${badgeTipo(r.tipo_acao)}</span>
        <span class="cell-trunc">${hl(r.tabela_afetada, term)}</span>
        <span>${badgeStatus(r.status)}</span>
      </div>`;
    }).join('');
  },

  atividades(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    el.innerHTML = data.map(r => `
      <div class="table-row" style="grid-template-columns:150px 110px 90px 80px 1fr 70px"
           onclick='abrirModal("atividades",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_nome || r.usuario_login)}</span>
        <span class="cell-mono">${e(r.modulo)}</span>
        <span>${e(r.acao)}</span>
        <span class="cell-trunc">${e(r.descricao_amigavel)}</span>
        <span>${badgeImpacto(r.impacto)}</span>
      </div>`).join('');
  },

  acessos(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    const term = _getSearchTerm('acessos', 'acessos-usuario');
    el.innerHTML = data.map(r => {
      const falha   = r.status_login === 'falha';
      const logout  = r.status_login === 'logout';
      const statusBadge = badgeStatus(r.status_login, { sucesso:'ok', falha:'erro', logout:'warn' });
      const tipoLabel = { ti:'T.I.', pc:'PC', professor:'Prof.' }[r.usuario_tipo] || (r.usuario_tipo || '—');
      const tipoTag = r.usuario_tipo
        ? `<span class="spill" style="font-size:.5rem;padding:1px 5px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)">${tipoLabel}</span>`
        : '';
      const loginTag = r.usuario_tipo === 'pc'
        ? `<span class="cell-mono" style="color:var(--green)">${hl(r.usuario_login, term)}</span>`
        : `<span class="cell-mono">${hl(r.usuario_login, term)}</span>`;
      const estaAtivo = r.status_login === 'sucesso' && !r.duracao_sessao && _sessaoEstaAtiva(r.usuario_id, r.usuario_tipo);
      const duracaoCell = estaAtivo
        ? `<span class="cell-mono live-dur" data-start="${r.timestamp}" style="color:var(--green)">—</span>`
        : r.duracao_sessao
          ? `<span class="cell-mono">${fmtDuracao(r.duracao_sessao)}</span>`
          : r.status_login === 'sucesso'
            ? `<span class="cell-mono cell-sessao-inativa" style="color:var(--muted)" title="Sessão encerrada sem logout">—</span>`
            : `<span class="cell-mono">—</span>`;
      return `
      <div class="table-row ${falha ? 'row-error' : logout ? 'row-warn' : ''}" style="grid-template-columns:150px 110px 110px 80px 1fr 100px"
           data-uid="${r.usuario_id || ''}" data-utipo="${r.usuario_tipo || ''}" data-login-ts="${r.timestamp || ''}"
           onclick='abrirModal("acessos",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_nome || '—')} ${tipoTag}</span>
        <span>${loginTag}</span>
        <span>${statusBadge}</span>
        <span class="cell-trunc">${e(r.motivo_falha)}</span>
        ${duracaoCell}
      </div>`;
    }).join('');
    _iniciarTimerDuracao();
  },

  criticas(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    const term = _getSearchTerm('criticas', 'criticas-tabela');
    el.innerHTML = data.map(r => {
      const pendente = !r.aprovado;
      return `
      <div class="table-row ${pendente ? 'row-critical' : ''}" style="grid-template-columns:150px 110px 90px 100px 130px 130px 80px"
           onclick='abrirModal("criticas",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_login)}</span>
        <span class="cell-mono">${hl(r.tabela, term)}</span>
        <span class="cell-trunc">${e(r.campo_alterado)}</span>
        <span class="cell-trunc cell-antes">${e(r.valor_anterior)}</span>
        <span class="cell-trunc">${e(r.valor_novo)}</span>
        <span>${pendente
          ? '<span class="spill sp-pendente">⚠ Pendente</span>'
          : '<span class="spill sp-aprovado">✓ Aprovado</span>'}</span>
      </div>`;
    }).join('');
  },

};

// ── Timer de duração em tempo real para sessões ativas ──
let _durTimer = null;
function _iniciarTimerDuracao() {
  clearInterval(_durTimer);
  _durTimer = setInterval(() => {
    document.querySelectorAll('.live-dur[data-start]').forEach(el => {
      const start = new Date(el.dataset.start).getTime();
      if (isNaN(start)) return;
      const s = Math.floor((Date.now() - start) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      el.textContent = `${h}:${m}:${sec}`;
    });
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
// RENDER KPIs
// ═══════════════════════════════════════════════════════════════
const RENDER_KPI = {

  auditoria(data) {
    const el = document.getElementById('auditoria-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const h24  = new Date(); h24.setHours(h24.getHours() - 24);

    const totalP = data.length;
    const hojeQ  = data.filter(d => new Date(d.executado_em) >= hoje).length;
    const h24Q   = data.filter(d => new Date(d.executado_em) >= h24).length;

    const freq = {};
    data.forEach(d => { if (d.acao) freq[d.acao] = (freq[d.acao]||0)+1; });
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];

    el.innerHTML = `
      ${kpiCard('red', iconBar(), totalP, 'Ações no período')}
      ${kpiCard('green', iconCheck(), hojeQ, 'Ações hoje')}
      ${kpiCard('yellow', iconBolt(), h24Q, 'Últimas 24h')}
      ${top ? kpiCard('red', iconTop(), top[1]+'x', top[0], true) : ''}`;
  },

  'audit-log'(data) {
    const el = document.getElementById('audit-log-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const erros   = data.filter(d => d.status === 'erro').length;
    const deletes = data.filter(d => d.tipo_acao === 'DELETE').length;

    const freq = {};
    data.forEach(d => { if (d.tabela_afetada) freq[d.tabela_afetada] = (freq[d.tabela_afetada]||0)+1; });
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];

    el.innerHTML = `
      ${kpiCard('red',    iconBar(),  data.length, 'Mudanças no período')}
      ${kpiCard('red',    iconX(),    erros,       'Com erro')}
      ${kpiCard('yellow', iconWarn(), deletes,     'DELETEs')}
      ${top ? kpiCard('green', iconTarget(), top[1], `Top tabela: ${top[0]}`, true) : ''}`;
  },

  atividades(data) {
    const el = document.getElementById('atividades-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const byMod = {}; const byImp = {};
    data.forEach(d => {
      if (d.modulo)  byMod[d.modulo]  = (byMod[d.modulo]||0)+1;
      if (d.impacto) byImp[d.impacto] = (byImp[d.impacto]||0)+1;
    });
    const top  = Object.entries(byMod).sort((a,b)=>b[1]-a[1])[0];
    const alto = byImp['alto'] || 0;

    el.innerHTML = `
      ${kpiCard('red',    iconBar(),    data.length, 'Total atividades')}
      ${top ? kpiCard('green', iconTarget(), top[1], top[0]) : ''}
      ${kpiCard('yellow', iconWarn(),   alto,        'Alto impacto')}`;
  },

  acessos(data) {
    const el = document.getElementById('acessos-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const td   = data.filter(d => new Date(d.timestamp) >= hoje);
    const ok   = td.filter(d => d.status_login === 'sucesso').length;
    const err  = td.filter(d => d.status_login === 'falha').length;

    const byU = {};
    data.forEach(d => { const k = d.usuario_login||'?'; byU[k]=(byU[k]||0)+1; });
    const top = Object.entries(byU).sort((a,b)=>b[1]-a[1])[0];

    el.innerHTML = `
      ${kpiCard('green',  iconCheck(), ok,  'Logins hoje')}
      ${kpiCard('red',    iconX(),     err, 'Falhas hoje')}
      ${top ? kpiCard('yellow', iconUser(), top[1], `Mais ativo: ${top[0]}`, true) : ''}`;
  },

  criticas(data) {
    const el = document.getElementById('criticas-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const pendente = data.filter(d => !d.aprovado).length;
    const aprovado = data.filter(d =>  d.aprovado).length;

    el.innerHTML = `
      ${kpiCard('red',   iconWarn(),  pendente, 'Pendentes')}
      ${kpiCard('green', iconCheck(), aprovado, 'Aprovados')}`;
  },

};

// ═══════════════════════════════════════════════════════════════
// KPI HELPER
// ═══════════════════════════════════════════════════════════════
function kpiCard(cor, icon, valor, label, sm = false) {
  return `<div class="kpi">
    <div class="kpi-icon ${cor}">${icon}</div>
    <div class="kpi-info">
      <div class="kpi-n ${cor} ${sm ? 'sm' : ''}">${valor}</div>
      <div class="kpi-l">${label}</div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// BADGES / PILLS
// ═══════════════════════════════════════════════════════════════
function badgeStatus(val, mapa) {
  const m = mapa || { sucesso:'ok', erro:'erro', falha:'erro', parcial:'warn' };
  const cls = m[val] || 'warn';
  const clsMap = { ok:'sp-ok', erro:'sp-erro', warn:'sp-warn' };
  return `<span class="spill ${clsMap[cls]||'sp-warn'}">${e(val)||'—'}</span>`;
}

function badgeTipo(tipo) {
  const mp = { INSERT:'tipo-insert', UPDATE:'tipo-update', DELETE:'tipo-delete', LOGIN:'tipo-login' };
  const cls = mp[tipo?.toUpperCase()] || 'tipo-login';
  return `<span class="tipo-badge ${cls}">${e(tipo)||'—'}</span>`;
}

function badgeImpacto(imp) {
  const mp = { alto:'impacto-alto', médio:'impacto-medio', medio:'impacto-medio', baixo:'impacto-baixo' };
  const cls = mp[imp?.toLowerCase()] || '';
  return imp ? `<span class="impacto-badge ${cls}">${e(imp)}</span>` : '<span style="color:var(--muted2)">—</span>';
}

// ═══════════════════════════════════════════════════════════════
// PAGINAÇÃO
// ═══════════════════════════════════════════════════════════════
function renderPaginacao(aba, total) {
  const el = document.getElementById(`pg-${aba}`);
  if (!el) return;

  const page       = STATE.pagina[aba] || 0;
  const totalPages = Math.max(1, Math.ceil(total / CFG.PER_PAGE));
  const inicio     = page * CFG.PER_PAGE + 1;
  const fim        = Math.min((page + 1) * CFG.PER_PAGE, total);

  let html = `<span class="pg-info">Mostrando ${inicio}–${fim} de ${total} registros</span>`;
  html += '<div class="pg-controls">';

  if (page > 0) {
    html += `<button class="btn-pg" onclick="irPagina('${aba}',0)">« Primeira</button>`;
    html += `<button class="btn-pg" onclick="irPagina('${aba}',${page-1})">‹ Anterior</button>`;
  }

  const pStart = Math.max(0, page - 2);
  const pEnd   = Math.min(totalPages, page + 3);
  for (let i = pStart; i < pEnd; i++) {
    html += `<button class="btn-pg ${i===page?'active':''}" onclick="irPagina('${aba}',${i})">${i+1}</button>`;
  }

  if (page < totalPages - 1) {
    html += `<button class="btn-pg" onclick="irPagina('${aba}',${page+1})">Próxima ›</button>`;
    html += `<button class="btn-pg" onclick="irPagina('${aba}',${totalPages-1})">Última »</button>`;
  }

  html += '</div>';
  el.innerHTML = html;
}

function irPagina(aba, pg) {
  STATE.pagina[aba] = pg;
  STATE.dados[aba] = null;
  carregarDados(aba);
  document.getElementById(`rows-${aba}`)?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════
function abrirModal(aba, data) {
  const bg     = document.getElementById('modal-bg');
  const titulo = document.getElementById('modal-titulo');
  const corpo  = document.getElementById('modal-corpo');

  const titulos = {
    'auditoria':  'Auditoria TI — Detalhes',
    'audit-log':  'Mudança no BD — Detalhes',
    'atividades': 'Atividade — Detalhes',
    'acessos':    'Acesso — Detalhes',
    'criticas':   'Alteração Crítica — Detalhes',
    'operacoes':  'Operação em Massa — Detalhes',
  };
  titulo.textContent = titulos[aba] || 'Detalhes';

  let html = '<div class="modal-grid-2">';

  switch (aba) {
    case 'auditoria':
      html += mf('Data/Hora',  fmtData(data.executado_em))
             + mf('Usuário',   data.nome || data.login)
             + mf('Ação',      data.acao, 'full')
             + mf('Detalhes',  data.detalhes, 'full');
      break;

    case 'audit-log':
      html += mf('Data/Hora',      fmtData(data.timestamp))
             + mf('Usuário',       data.usuario_nome || data.usuario_login)
             + mf('Tipo de Ação',  data.tipo_acao)
             + mf('Tabela',        data.tabela_afetada)
             + mf('Status',        data.status)
             + (data.erro_msg ? mf('Mensagem de erro', data.erro_msg, 'full') : '');
      if (data.antes_json || data.depois_json) {
        html += `</div><div class="modal-field" style="margin-top:4px">
          <div class="modal-label">Comparação JSON</div>
          <div class="json-diff">
            ${data.antes_json ? `<div>
              <div class="json-diff-label antes">Antes</div>
              <div class="json-before">${jsonStr(data.antes_json)}</div>
            </div>` : ''}
            ${data.depois_json ? `<div>
              <div class="json-diff-label depois">Depois</div>
              <div class="json-after">${jsonStr(data.depois_json)}</div>
            </div>` : ''}
          </div>
        </div><div class="modal-grid-2">`;
      }
      break;

    case 'atividades':
      html += mf('Data/Hora',  fmtData(data.timestamp))
             + mf('Usuário',   data.usuario_nome || data.usuario_login)
             + mf('Módulo',    data.modulo)
             + mf('Ação',      data.acao)
             + mf('Impacto',   data.impacto)
             + mf('Descrição', data.descricao_amigavel, 'full');
      break;

    case 'acessos':
      html += mf('Data/Hora',     fmtData(data.timestamp))
             + mf('Usuário',      data.usuario_nome || data.usuario_login)
             + mf('Status login', data.status_login)
             + mf('Dispositivo',  data.ip_address, 'full', 'mono')
             + (data.motivo_falha ? mf('Motivo da falha', data.motivo_falha, 'full') : '')
             + mf('Duração sessão', fmtDuracao(data.duracao_sessao))
             + (data.user_agent ? mf('User Agent', data.user_agent, 'full', 'mono') : '');
      break;

    case 'criticas':
      html += mf('Data/Hora',      fmtData(data.timestamp))
             + mf('Usuário',       data.usuario_login)
             + mf('Tabela',        data.tabela)
             + mf('Campo',         data.campo_alterado)
             + mf('Valor anterior', data.valor_anterior)
             + mf('Valor novo',    data.valor_novo)
             + mf('Status',        data.aprovado ? '✓ Aprovado' : '⚠️ Pendente')
             + (data.motivo ? mf('Motivo', data.motivo, 'full') : '');
      break;

  }

  html += '</div>';
  corpo.innerHTML = html;
  bg.classList.add('open');
}

function fecharModal() {
  document.getElementById('modal-bg').classList.remove('open');
}

document.getElementById('modal-bg')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) fecharModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    fecharModal();
    fecharBuscaGlobal();
  }
});

function mf(label, value, extra = '', monoClass = '') {
  const cls  = extra ? ` class="${extra}"` : '';
  const mono = monoClass ? ` ${monoClass}` : '';
  return `<div class="modal-field${extra === 'full' ? ' full' : ''}"${cls}>
    <div class="modal-label">${label}</div>
    <div class="modal-value${mono}">${e(value) || '—'}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════════════
function exportarCSV(aba, filename) {
  const data = STATE.dados[aba];
  if (!data || data.length === 0) {
    showNotif('Nenhum dado para exportar', 'warn');
    return;
  }
  _gerarCSV(data, filename);
  showNotif('CSV exportado com sucesso', 'ok');
}

async function exportarTudo(aba, filename) {
  showNotif('Buscando todos os registros…', 'info');
  try {
    const url = buildUrl(aba, { allPages: true });
    const [data] = await fetchAPI(url);
    if (!data.length) { showNotif('Nenhum dado para exportar', 'warn'); return; }
    _gerarCSV(data, filename + '_completo');
    showNotif(`${data.length} registros exportados`, 'ok');
  } catch (err) {
    console.error('[exportarTudo]', err);
    showNotif('Erro ao exportar — verifique a conexão', 'err');
  }
}

function _gerarCSV(data, filename) {
  const hdrs = Object.keys(data[0]);
  const rows = data.map(row =>
    hdrs.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '""';
      if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );

  const csv  = [hdrs.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// BUSCA GLOBAL
// ═══════════════════════════════════════════════════════════════
const GS_SEARCH_MAP = {
  'auditoria':  { table: 'auditoria_ti',           fields: ['login','acao'],               order: 'executado_em', label: 'Auditoria TI' },
  'audit-log':  { table: 'audit_log',              fields: ['usuario_login','tabela_afetada'], order: 'timestamp', label: 'Mudanças BD' },
  'atividades': { table: 'atividades_log',          fields: ['usuario_login','descricao_amigavel'], order: 'timestamp', label: 'Atividades' },
  'acessos':    { table: 'acesso_log',             fields: ['usuario_login','usuario_nome'], order: 'timestamp',   label: 'Acessos' },
  'criticas':   { table: 'alteracoes_criticas_log', fields: ['usuario_login','tabela','valor_novo'], order: 'timestamp', label: 'Críticas' },
};

let _gsTimer = null;

function abrirBuscaGlobal() {
  document.getElementById('gs-overlay').classList.add('open');
  setTimeout(() => document.getElementById('gs-input')?.focus(), 50);
}

function fecharBuscaGlobal(ev) {
  if (ev && ev.target !== ev.currentTarget) return;
  document.getElementById('gs-overlay').classList.remove('open');
  document.getElementById('gs-input').value = '';
  document.getElementById('gs-results').innerHTML = '';
  document.getElementById('gs-status').textContent = 'Digite para buscar em todas as abas';
}

function onGsInput() {
  clearTimeout(_gsTimer);
  const term = document.getElementById('gs-input').value.trim();
  if (term.length < 2) {
    document.getElementById('gs-results').innerHTML = '';
    document.getElementById('gs-status').textContent = 'Digite ao menos 2 caracteres';
    return;
  }
  document.getElementById('gs-status').textContent = 'Buscando…';
  _gsTimer = setTimeout(() => _executarBuscaGlobal(term), 380);
}

async function _executarBuscaGlobal(term) {
  const statusEl  = document.getElementById('gs-status');
  const resultsEl = document.getElementById('gs-results');
  resultsEl.innerHTML = '';

  const enc = encodeURIComponent(term);
  const promises = Object.entries(GS_SEARCH_MAP).map(async ([aba, meta]) => {
    const orClauses = meta.fields.map(f => `${f}.ilike.%25${enc}%25`).join(',');
    const url = `${CFG.SB_URL}/rest/v1/${meta.table}?select=*&or=(${orClauses})&order=${meta.order}.desc&limit=5`;
    try {
      const [data] = await fetchAPI(url);
      return { aba, label: meta.label, data };
    } catch {
      return { aba, label: meta.label, data: [] };
    }
  });

  const groups = await Promise.all(promises);
  const total  = groups.reduce((s, g) => s + g.data.length, 0);

  if (total === 0) {
    statusEl.textContent = 'Nenhum resultado encontrado';
    return;
  }

  statusEl.textContent = `${total} resultado${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`;

  groups.forEach(({ aba, label, data }) => {
    if (!data.length) return;
    const section = document.createElement('div');
    section.className = 'gs-group';
    section.innerHTML = `<div class="gs-group-label">${label} <span class="gs-count">${data.length}</span></div>`;

    data.forEach(r => {
      const row  = document.createElement('div');
      row.className = 'gs-row';
      const ts   = r.executado_em || r.timestamp || '';
      const user = r.login || r.usuario_login || r.usuario_nome || '—';
      const desc = r.acao || r.tabela_afetada || r.descricao_amigavel || r.operacao || r.tabela || r.motivo_falha || '—';
      row.innerHTML = `
        <span class="gs-row-time">${fmtData(ts)}</span>
        <span class="gs-row-user">${hl(user, term)}</span>
        <span class="gs-row-desc">${hl(desc, term)}</span>`;
      row.addEventListener('click', () => {
        fecharBuscaGlobal();
        mudarAba(aba);
        setTimeout(() => abrirModal(aba, r), 120);
      });
      section.appendChild(row);
    });

    resultsEl.appendChild(section);
  });
}

// ═══════════════════════════════════════════════════════════════
// NOTIF TOAST
// ═══════════════════════════════════════════════════════════════
let _notifTimer = null;
function showNotif(msg, tipo = 'ok') {
  const el   = document.getElementById('notif');
  const icon = el.querySelector('.notif-icon');
  const txt  = document.getElementById('notif-text');

  el.className = `notif notif-${tipo}`;
  icon.innerHTML = tipo === 'ok' ? svgCheck() : tipo === 'err' ? svgX() : tipo === 'warn' ? svgWarn() : svgInfo();
  txt.textContent = msg;

  el.classList.add('show');
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function e(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function esc(obj) {
  return JSON.stringify(obj).replace(/"/g,'&quot;');
}

function empty() {
  return `<div class="empty">
    <div class="empty-icon">📭</div>
    <p>Nenhum registro encontrado</p>
  </div>`;
}

function fmtData(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}

function fmtDuracao(d) {
  if (!d) return '—';
  const m = String(d).match(/(\d+):(\d+):(\d+)/);
  if (!m) return d;
  const [,h,min,s] = m;
  if (parseInt(h)>0) return `${h}h ${min}m`;
  if (parseInt(min)>0) return `${min}m ${s}s`;
  return `${s}s`;
}

function jsonStr(obj) {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    return e(s);
  } catch { return e(String(obj)); }
}

// ── SVG minis ──
const iconBar    = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
const iconCheck  = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const iconBolt   = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
const iconTop    = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>`;
const iconWarn   = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r=".8" fill="currentColor"/></svg>`;
const iconTarget = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`;
const iconUser   = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const iconX      = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const svgCheck = () => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const svgX     = () => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const svgWarn  = () => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>`;
const svgInfo  = () => `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

// ═══════════════════════════════════════════════════════════════
// REALTIME
// ═══════════════════════════════════════════════════════════════
const TABLE_TO_ABA = {
  'auditoria_ti':            'auditoria',
  'audit_log':               'audit-log',
  'atividades_log':          'atividades',
  'acesso_log':              'acessos',
  'alteracoes_criticas_log': 'criticas',
};

function iniciarRealtime() {
  const _sb = window.supabase;
  if (!_sb) { console.warn('[realtime] SDK não carregado'); return; }

  const sbClient = _sb.createClient(CFG.SB_URL, CFG.SB_KEY);
  const channel  = sbClient.channel('logs-realtime-all');

  Object.keys(TABLE_TO_ABA).forEach(table => {
    const onInsert = () => {
      const aba = TABLE_TO_ABA[table];
      if (STATE.abaAtiva === aba && (STATE.pagina[aba] || 0) === 0) {
        _recarregarSilencioso(aba);
      } else {
        STATE.newCounts[aba] = (STATE.newCounts[aba] || 0) + 1;
        _atualizarBadgeRT(aba);
      }
    };
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table }, onInsert);
  });

  // acesso_log: UPDATE para capturar duracao_sessao preenchida no logout
  channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'acesso_log' }, () => {
    if (STATE.abaAtiva === 'acessos' && (STATE.pagina['acessos'] || 0) === 0) {
      _recarregarSilencioso('acessos');
    }
  });

  // Sessões ativas em tempo real — só atualiza o Set e remarca cells no DOM,
  // sem refazer fetch (evita reset da lista a cada ping de 30s)
  async function _syncSessoes(payload, evento) {
    if (evento === 'DELETE') {
      // remove só a entrada deletada do Set
      const s = payload?.old;
      if (s) _sessoesAtivas.delete(`${s.usuario_id}:${s.usuario_tipo}`);
    } else {
      // INSERT ou UPDATE — atualiza o Set inteiro
      await _carregarSessoesAtivas();
    }
    _atualizarCellsSessao();
  }

  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessao_ativa' }, p => _syncSessoes(p, 'INSERT'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessao_ativa' }, p => _syncSessoes(p, 'UPDATE'))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessao_ativa' }, p => _syncSessoes(p, 'DELETE'));

  channel.subscribe(status => {
    const dot = document.getElementById('rt-dot');
    if (!dot) return;
    if (status === 'SUBSCRIBED') {
      dot.style.background = '#22c55e';
      dot.style.boxShadow  = '0 0 6px #22c55e88';
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      dot.style.background = '#ef4444';
      dot.style.boxShadow  = 'none';
    } else {
      dot.style.background = '#eab308';
      dot.style.boxShadow  = 'none';
    }
  });
}

function _semFiltros(aba) {
  return (TAB_FILTERS[aba] || []).every(f => {
    const el = document.getElementById(f.id);
    return !el || !el.value.trim();
  });
}

async function _recarregarSilencioso(aba) {
  const container = document.getElementById(`rows-${aba}`);
  if (!container) return;
  try {
    const [data, total] = await fetchAPI(buildUrl(aba));
    STATE.dados[aba]   = data;
    STATE.totais[aba]  = total;
    RENDER[aba]?.(data, container);
    RENDER_KPI[aba]?.(data);
    renderPaginacao(aba, total);
    atualizarLastUpdate(aba);
    atualizarContador(aba, total);
    const primeira = container.querySelector('.table-row');
    if (primeira) {
      primeira.style.transition = 'background .1s';
      primeira.style.background = 'rgba(34,197,94,.15)';
      setTimeout(() => { primeira.style.background = ''; }, 1200);
    }
  } catch(err) {
    console.error('[realtime silent reload]', err);
  }
}

function _atualizarBadgeRT(aba) {
  const el = document.getElementById(`rtc-${aba}`);
  if (!el) return;
  const n = STATE.newCounts[aba] || 0;
  el.textContent = n > 99 ? '99+' : String(n);
  el.style.display = n > 0 ? 'inline-flex' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// MANUTENÇÃO — LIMPEZA POR PERÍODO
// ═══════════════════════════════════════════════════════════════
let _logsDias = 30, _logsPreviewOk = false;

(function _initManutencao() {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.limpeza-prazo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.limpeza-prazo-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _logsDias = parseInt(btn.dataset.dias);
        _logsPreviewOk = false;
        document.getElementById('btn-executar-limpeza-logs').disabled = true;
        document.getElementById('logs-limpeza-preview').innerHTML =
          `<div class="limpeza-preview-idle"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Clique em "Ver impacto" para analisar</span></div>`;
      });
    });
  });
})();

function _abasSelecionadas() {
  return [...document.querySelectorAll('.logs-tabela-chk:checked')].map(el => el.value);
}

async function verImpactoLimpezaLogs() {
  const btn = document.getElementById('btn-ver-impacto-logs');
  const preview = document.getElementById('logs-limpeza-preview');
  btn.disabled = true;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analisando…`;
  preview.innerHTML = '<div class="limpeza-preview-idle"><div class="spinner" style="width:16px;height:16px"></div> analisando…</div>';

  const selecionadas = _abasSelecionadas();
  if (selecionadas.length === 0) {
    preview.innerHTML = `<div class="limpeza-preview-idle" style="color:var(--yellow)">Selecione ao menos uma tabela.</div>`;
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Ver impacto`;
    return;
  }

  const threshold = _logsDias >= 9999 ? null
    : new Date(Date.now() - _logsDias * 86400000).toISOString();

  const nomes = {
    'auditoria': 'Auditoria',
    'audit-log': 'Mudanças BD',
    'atividades': 'Atividades',
    'acessos': 'Acessos',
    'criticas': 'Críticas',
  };

  try {
    const results = await Promise.all(
      Object.entries(TAB_META)
        .filter(([aba]) => selecionadas.includes(aba))
        .map(async ([aba, meta]) => {
        let url = `${CFG.SB_URL}/rest/v1/${meta.table}?select=${meta.order}`;
        if (threshold) url += `&${meta.order}=lt.${encodeURIComponent(threshold)}`;
        const res = await fetch(url, { method: 'HEAD', headers: headers() });
        const count = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10);
        return { aba, label: nomes[aba] || aba, count };
      })
    );

    const total = results.reduce((s, r) => s + r.count, 0);

    if (total === 0) {
      preview.innerHTML = `<div class="limpeza-preview-idle" style="color:var(--green)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>Nenhum registro nesse intervalo.</span></div>`;
      _logsPreviewOk = false;
      document.getElementById('btn-executar-limpeza-logs').disabled = true;
    } else {
      const dividers = (i) => i < results.length - 1 ? '<div class="limpeza-preview-div"></div>' : '';
      preview.innerHTML = `<div class="limpeza-preview-stats">
        ${results.map((r, i) => `
          <div class="limpeza-stat">
            <div class="limpeza-stat-n" style="color:${r.count > 0 ? 'var(--red)' : 'var(--muted)'}">${r.count.toLocaleString('pt-BR')}</div>
            <div class="limpeza-stat-l">${r.label}</div>
          </div>${dividers(i)}`).join('')}
      </div>
      <div style="width:100%;text-align:center;font-size:.6rem;color:var(--muted);margin-top:10px;padding-top:10px;border-top:1px solid var(--glass-b)">
        Total: <strong style="color:var(--red)">${total.toLocaleString('pt-BR')} registros</strong> serão removidos
      </div>`;
      _logsPreviewOk = true;
      document.getElementById('btn-executar-limpeza-logs').disabled = false;
    }
  } catch (e) {
    preview.innerHTML = `<div class="limpeza-preview-idle" style="color:var(--red)">Erro ao analisar: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Ver impacto`;
  }
}

async function executarLimpezaLogs() {
  if (!_logsPreviewOk) return;
  const prazoLabel = _logsDias >= 9999 ? 'todos os logs' : `logs com mais de ${_logsDias} dias`;
  if (!await dsosConfirm({msg:`Confirmar limpeza de ${prazoLabel}?\nAção IRREVERSÍVEL.`,tipo:'danger',titulo:'Limpeza de logs'})) return;

  const btn = document.getElementById('btn-executar-limpeza-logs');
  btn.disabled = true;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Limpando…`;

  const threshold = _logsDias >= 9999 ? null
    : new Date(Date.now() - _logsDias * 86400000).toISOString();

  const selecionadas = _abasSelecionadas();
  const tabelas = selecionadas.map(aba => TAB_META[aba]?.table).filter(Boolean);

  let erros = 0;
  try {
    const res = await fetch(`${CFG.SB_URL}/rest/v1/rpc/rpc_limpar_logs`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_tabelas: tabelas, p_threshold: threshold }),
    });
    if (!res.ok) erros++;
  } catch { erros++; }

  _logsPreviewOk = false;
  btn.disabled = true;

  if (erros > 0) {
    showNotif(`Limpeza concluída com ${erros} erro(s)`, 'warn');
  } else {
    showNotif('Logs apagados com sucesso', 'ok');
  }

  // Reset preview
  document.getElementById('logs-limpeza-preview').innerHTML =
    `<div class="limpeza-preview-idle"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Clique em "Ver impacto" para analisar</span></div>`;

  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Limpar agora`;

  selecionadas.forEach(aba => { STATE.dados[aba] = null; });
}

// ═══════════════════════════════════════════════════════════════
// APAGAR LOGS
// ═══════════════════════════════════════════════════════════════
async function apagarLogs(aba) {
  const meta = TAB_META[aba];
  if (!meta) return;

  const filtros = TAB_FILTERS[aba] || [];
  const temFiltroData = filtros.some(f => {
    const el = document.getElementById(f.id);
    return el && el.value.trim() && (f.op === 'gte' || f.op === 'lte');
  });

  const total = STATE.totais[aba] || 0;
  const msg = temFiltroData
    ? `Apagar ${total} registro(s) do período filtrado em "${aba}"?\n\nEssa ação é irreversível.`
    : `Apagar TODOS os registros de "${aba}"?\n\nEssa ação é irreversível e não pode ser desfeita.`;

  if (!await dsosConfirm({msg,tipo:'danger',titulo:'Apagar registros'})) return;
  if (!temFiltroData && !await dsosConfirm({msg:`Confirmação final: apagar TODOS os logs de "${aba}"?`,tipo:'danger',titulo:'Confirmação final'})) return;

  try {
    let url = `${CFG.SB_URL}/rest/v1/${meta.table}?`;

    if (temFiltroData) {
      const params = [];
      filtros.forEach(f => {
        if (f.op !== 'gte' && f.op !== 'lte') return;
        const el = document.getElementById(f.id);
        if (!el || !el.value.trim()) return;
        params.push(`${f.param}=${f.op}.${el.value.trim()}${f.suffix || ''}`);
      });
      url += params.join('&');
    } else {
      // sem filtro — precisa de condição para o Supabase aceitar DELETE sem WHERE
      url += `${meta.order}=not.is.null`;
    }

    const threshold = temFiltroData
      ? (() => {
          const endEl = document.getElementById(`${aba}-dataEnd`);
          return endEl?.value ? new Date(endEl.value + 'T23:59:59').toISOString() : null;
        })()
      : null;

    const res = await fetch(`${CFG.SB_URL}/rest/v1/rpc/rpc_limpar_logs`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_tabelas: [meta.table], p_threshold: threshold }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[apagarLogs]', res.status, err);
      showNotif('Erro ao apagar — verifique permissões', 'err');
      return;
    }

    showNotif('Registros apagados com sucesso', 'ok');
    STATE.dados[aba] = null;
    STATE.pagina[aba] = 0;
    carregarDados(aba);
  } catch (e) {
    console.error('[apagarLogs]', e);
    showNotif('Erro de conexão ao apagar', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — Gráficos
// ═══════════════════════════════════════════════════════════════
let _dashCharts = {};
let _dashClockInt = null;

async function carregarDashboard() {
  const h = { apikey: CFG.SB_KEY, Authorization: `Bearer ${CFG.SB_KEY}` };

  // Lê período dos inputs (se preenchidos) ou usa padrão 30d
  const inputDe  = document.getElementById('dash-de')?.value;
  const inputAte = document.getElementById('dash-ate')?.value;
  const dataHoje = new Date().toISOString().split('T')[0];
  const ago30def = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const periodoAte = inputAte || dataHoje;
  const periodoDe  = inputDe  || ago30def;
  // Inicializa inputs se vazios
  if(!inputDe)  { const el=document.getElementById('dash-de');  if(el)el.value=periodoDe; }
  if(!inputAte) { const el=document.getElementById('dash-ate'); if(el)el.value=periodoAte; }

  const ago7  = new Date(Date.now() - 7  * 86400000).toISOString().split('T')[0];
  const ago30 = periodoDe;

  let tickets = [], acessos = [], tiUsers = [];
  try {
    const [rT, rA, rTI] = await Promise.all([
      fetch(`${CFG.SB_URL}/rest/v1/ticket?aberto_em=gte.${periodoDe}T00:00:00&aberto_em=lte.${periodoAte}T23:59:59&select=aberto_em,laboratorio,tipo,status,resolvido_em,tecnico_responsavel&limit=2000`, { headers: h }),
      fetch(`${CFG.SB_URL}/rest/v1/acesso_log?timestamp=gte.${ago7}T00:00:00&select=timestamp,status_login&limit=2000`, { headers: h }),
      fetch(`${CFG.SB_URL}/rest/v1/v_usuario_ti_pub?select=id,nome,login`, { headers: h }),
    ]);
    tickets  = await rT.json().then(d => Array.isArray(d) ? d : []);
    acessos  = await rA.json().then(d => Array.isArray(d) ? d : []);
    tiUsers  = await rTI.json().then(d => Array.isArray(d) ? d : []);
  } catch(e) { console.error('[dashboard]', e); }

  // Últimos 7 dias
  const dias7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return d.toISOString().split('T')[0];
  });
  const labels7 = dias7.map(d => { const [,m,day] = d.split('-'); return `${day}/${m}`; });
  const ticketsPorDia = dias7.map(dia => tickets.filter(t => t.aberto_em?.startsWith(dia)).length);
  const acessosPorDia = dias7.map(dia => acessos.filter(a => a.timestamp?.startsWith(dia)).length);

  // Por tipo (últimos 30 dias)
  const tipos  = ['hardware','software','rede','periferico','outro'];
  const tLabels = ['Hardware','Software','Rede','Periférico','Outro'];
  const ticketsPorTipo = tipos.map(t => tickets.filter(tk => tk.tipo === t).length);

  // Por status
  const statusList  = ['aberto','em_andamento','resolvido','descartado','falso_alarme'];
  const statusLabels = ['Aberto','Em Prog.','Resolvido','Descartado','Falso'];
  const ticketsPorStatus = statusList.map(s => tickets.filter(t => t.status === s).length);

  // Tempo médio de resolução (30d)
  const resolvidos30 = tickets.filter(t => t.status === 'resolvido' && t.resolvido_em && t.aberto_em);
  let avgResolucao = '—';
  if (resolvidos30.length) {
    const avgMs = resolvidos30.reduce((a, t) => a + (new Date(t.resolvido_em) - new Date(t.aberto_em)), 0) / resolvidos30.length;
    const avgMins = Math.floor(avgMs / 60000);
    const avgHrs  = Math.floor(avgMins / 60);
    avgResolucao  = avgHrs > 0 ? `${avgHrs}h ${avgMins % 60}min` : `${avgMins}min`;
  }

  // Ranking por técnico (30d, resolvidos)
  const tiNomeMap = {};
  tiUsers.forEach(u => { tiNomeMap[u.id] = u.nome || u.login; });
  const rankMap = {};
  tickets.filter(t => t.tecnico_responsavel && (t.status === 'resolvido' || t.status === 'descartado'))
    .forEach(t => { rankMap[t.tecnico_responsavel] = (rankMap[t.tecnico_responsavel] || 0) + 1; });
  const topTecs = Object.entries(rankMap).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => `${tiNomeMap[id] || '#'+id} (${n})`).join(' · ') || '—';

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#9ca3af' : '#6b7280';
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  // Destrói charts anteriores e para o relógio
  clearInterval(_dashClockInt);
  Object.values(_dashCharts).forEach(c => { try { c?.destroy(); } catch(_) {} });
  _dashCharts = {};

  const scaleOpts = {
    x: { ticks: { color: textColor, font: { family: 'Sora', size: 10 } }, grid: { color: gridColor } },
    y: { ticks: { color: textColor, font: { family: 'Sora', size: 10 } }, grid: { color: gridColor }, beginAtZero: true },
  };
  const legendOpts = { labels: { color: textColor, font: { family: 'Sora', size: 11 }, boxWidth: 12 } };

  const c1 = document.getElementById('chart-tickets-dia')?.getContext('2d');
  if (c1) _dashCharts.d = new Chart(c1, { type: 'bar', data: { labels: labels7, datasets: [{ label: 'Chamados', data: ticketsPorDia, backgroundColor: 'rgba(192,23,26,0.65)', borderColor: '#c0171a', borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: scaleOpts } });

  const c2 = document.getElementById('chart-tickets-tipo')?.getContext('2d');
  if (c2) _dashCharts.t = new Chart(c2, { type: 'doughnut', data: { labels: tLabels, datasets: [{ data: ticketsPorTipo, backgroundColor: ['#c0171a','#06b6d4','#f5d000','#f97316','#8b5cf6'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpts } } });

  const c3 = document.getElementById('chart-acessos-dia')?.getContext('2d');
  if (c3) _dashCharts.a = new Chart(c3, { type: 'line', data: { labels: labels7, datasets: [{ label: 'Acessos', data: acessosPorDia, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.10)', fill: true, tension: 0.4, pointBackgroundColor: '#06b6d4', pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: scaleOpts } });

  const c4 = document.getElementById('chart-status')?.getContext('2d');
  if (c4) _dashCharts.s = new Chart(c4, { type: 'bar', data: { labels: statusLabels, datasets: [{ data: ticketsPorStatus, backgroundColor: ['#f5d000','#f97316','#06b6d4','#6b7280','#c0171a'], borderWidth: 0, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: scaleOpts } });

  // KPIs do topo do dashboard
  const todayStr = new Date().toISOString().split('T')[0];
  const hoje = tickets.filter(t => t.aberto_em?.startsWith(todayStr));
  const resolvidosHoje = hoje.filter(t => t.status === 'resolvido' || t.status === 'descartado');
  const pendentes = tickets.filter(t => t.status === 'aberto' || t.status === 'em_andamento');
  const acessosHoje = acessos.filter(a => a.timestamp?.startsWith(todayStr) && a.status_login === 'sucesso');
  const kpiEl = document.getElementById('dash-kpis');
  if (kpiEl) kpiEl.innerHTML = [
    { n: pendentes.length,      l: 'Pendentes',    c: '#c0171a' },
    { n: resolvidosHoje.length, l: 'Resolvidos',   c: '#06b6d4' },
    { n: hoje.length,           l: 'Abertos hoje', c: '#f5d000' },
    { n: acessosHoje.length,    l: 'Acessos hoje', c: '#8b5cf6' },
    { n: avgResolucao,          l: 'Tempo médio',  c: 'var(--muted2)' },
  ].map(k => `<div class="dash-kpi" style="border-top-color:${k.c}40"><span class="dash-kpi-n" style="color:${k.c};font-size:${String(k.n).length>5?'.78rem':'1.1rem'}">${k.n}</span><span class="dash-kpi-l">${k.l}</span></div>`).join('');
  // Relógio em tempo real (no header)
  function _tickDashClock(){
    const el=document.getElementById('dash-clock');if(!el){clearInterval(_dashClockInt);return;}
    const t=new Date();
    el.textContent=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  }
  _tickDashClock();
  _dashClockInt=setInterval(_tickDashClock,1000);
  // Top técnicos (linha separada)
  const toptEl=document.getElementById('dash-toptecs');
  if(toptEl) toptEl.innerHTML=topTecs!=='—'?`<b>Top técnicos</b> ${topTecs}`:'';

  // Ranking de laboratórios
  const labRankEl=document.getElementById('dash-lab-ranking');
  if(labRankEl){
    const labMap={};
    tickets.forEach(t=>{if(t.laboratorio)labMap[t.laboratorio]=(labMap[t.laboratorio]||0)+1;});
    const labSort=Object.entries(labMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxLab=labSort[0]?.[1]||1;
    labRankEl.innerHTML=labSort.length
      ?labSort.map(([nome,n],i)=>`<div class="lab-rank-row">
          <span class="lab-rank-pos">${i+1}</span>
          <span class="lab-rank-nome" title="${nome}">${nome}</span>
          <div class="lab-rank-bar-wrap"><div class="lab-rank-bar" style="width:${Math.round(n/maxLab*100)}%"></div></div>
          <span class="lab-rank-n">${n}</span>
        </div>`).join('')
      :`<div style="color:var(--muted);font-size:.65rem;padding:8px 0">Sem dados no período</div>`;
  }

  // Alerta de anomalia: compara hoje com média diária do período
  const alertaEl=document.getElementById('dash-alerta');
  if(alertaEl){
    const todayCount=tickets.filter(t=>t.aberto_em?.startsWith(dataHoje)).length;
    const diasPeriodo=Math.max(1,Math.round((new Date(periodoAte)-new Date(periodoDe))/86400000));
    const mediadiaria=tickets.length/diasPeriodo;
    alertaEl.style.display='none';alertaEl.className='dash-alerta';
    if(mediadiaria>0&&todayCount>=3){
      const ratio=todayCount/mediadiaria;
      if(ratio>=3){
        alertaEl.innerHTML=`🚨 Volume crítico hoje: <strong>${todayCount} chamados</strong> — ${ratio.toFixed(1)}× a média diária (${mediadiaria.toFixed(1)}/dia)`;
        alertaEl.classList.add('vermelho');alertaEl.style.display='flex';
      }else if(ratio>=1.5){
        alertaEl.innerHTML=`⚠️ Volume elevado hoje: <strong>${todayCount} chamados</strong> — ${ratio.toFixed(1)}× a média diária (${mediadiaria.toFixed(1)}/dia)`;
        alertaEl.classList.add('amarelo');alertaEl.style.display='flex';
      }
    }
  }

  // Feature 9 — Comparativo de semanas (linha: semana atual vs anterior)
  const semAtual  = dias7.map(dia => tickets.filter(t => t.aberto_em?.startsWith(dia)).length);
  const diasAnt   = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (13 - i) * 86400000).toISOString().split('T')[0]);
  const semAnt    = diasAnt.map(dia => tickets.filter(t => t.aberto_em?.startsWith(dia)).length);
  const c5 = document.getElementById('chart-semanas')?.getContext('2d');
  if (c5) {
    _dashCharts.sem?.destroy();
    _dashCharts.sem = new Chart(c5, {
      type: 'line',
      data: {
        labels: labels7,
        datasets: [
          { label: 'Semana atual', data: semAtual, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.10)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#06b6d4' },
          { label: 'Semana anterior', data: semAnt, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.07)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#8b5cf6', borderDash: [5,3] },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendOpts }, scales: scaleOpts },
    });
  }

  // Feature 8 — Mapa de calor: dia da semana × hora (últimos 14d)
  const hmEl = document.getElementById('dash-heatmap');
  if (hmEl) {
    const cutoff14 = new Date(Date.now() - 14 * 86400000);
    const hmGrid   = Array.from({ length: 7 }, () => new Array(24).fill(0));
    tickets.filter(t => t.aberto_em && new Date(t.aberto_em) >= cutoff14).forEach(t => {
      const d = new Date(t.aberto_em);
      hmGrid[d.getDay()][d.getHours()]++;
    });
    const maxVal = Math.max(1, ...hmGrid.flat());
    const dias   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const horas  = Array.from({ length: 24 }, (_, h) => h);
    const cell   = (v) => {
      const alpha = v === 0 ? 0.04 : 0.12 + (v / maxVal) * 0.78;
      const bg    = `rgba(192,23,26,${alpha.toFixed(2)})`;
      return `<div title="${v} chamado${v!==1?'s':''}" style="width:18px;height:18px;border-radius:3px;background:${bg};font-size:.42rem;color:${v>maxVal*0.5?'#fff':'var(--muted)'};display:flex;align-items:center;justify-content:center">${v||''}</div>`;
    };
    hmEl.innerHTML =
      `<div style="display:flex;gap:3px;align-items:flex-end;margin-bottom:3px;padding-left:28px">` +
      horas.filter(h=>h%3===0).flatMap(h=>[`<div style="width:18px;text-align:center;font-size:.42rem;color:var(--muted)">${String(h).padStart(2,'0')}h</div>`,
        ...Array.from({length:2},()=>`<div style="width:18px"></div>`)]).join('')+`</div>`+
      dias.map((dia, di) =>
        `<div style="display:flex;gap:3px;align-items:center;margin-bottom:3px">` +
        `<div style="width:24px;font-size:.48rem;color:var(--muted);text-align:right;padding-right:4px">${dia}</div>` +
        horas.map(h => cell(hmGrid[di][h])).join('') +
        `</div>`
      ).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
// AVALIAÇÕES
// ═══════════════════════════════════════════════════════════════
let _avaliacoesData = [];

async function carregarAvaliacoes() {
  const listEl  = document.getElementById('aval-list');
  const statsEl = document.getElementById('aval-stats');
  if (!listEl || !statsEl) return;
  listEl.innerHTML  = '<div class="loading"><div class="spinner"></div> Carregando…</div>';
  statsEl.innerHTML = '';
  try {
    const { SUPABASE_URL: SB, SUPABASE_HEADERS: H } = await import('./supabase-config.js');
    const res = await fetch(
      `${SB}/rest/v1/ticket?avaliacao=not.is.null&order=resolvido_em.desc&select=id,laboratorio,avaliacao,avaliacao_comentario,resolvido_em,tecnico_responsavel,ti:usuario_ti!ticket_tecnico_responsavel_fkey(nome)`,
      { headers: H }
    );
    _avaliacoesData = await res.json().then(d => Array.isArray(d) ? d : []);
  } catch(e) {
    listEl.innerHTML = '<div class="empty">Erro ao carregar avaliações.</div>';
    return;
  }

  if (!_avaliacoesData.length) {
    listEl.innerHTML = '<div class="empty">Nenhuma avaliação registrada ainda.</div>';
    return;
  }

  // Estatísticas
  const total  = _avaliacoesData.length;
  const soma   = _avaliacoesData.reduce((a, r) => a + (r.avaliacao || 0), 0);
  const media  = (soma / total).toFixed(1);
  const dist   = [1,2,3,4,5].map(n => ({ n, c: _avaliacoesData.filter(r => r.avaliacao === n).length }));
  const max    = Math.max(...dist.map(d => d.c), 1);

  const estrelas = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  statsEl.innerHTML = `
    <div class="aval-stat-card">
      <div class="aval-media">${media}</div>
      <div class="aval-estrelas">${estrelas(Math.round(Number(media)))}</div>
      <div class="aval-total">${total} avaliação${total !== 1 ? 'ões' : ''}</div>
    </div>
    <div class="aval-dist">
      ${dist.reverse().map(d => `
        <div class="aval-dist-row">
          <span class="aval-dist-label">${d.n}★</span>
          <div class="aval-dist-bar-wrap">
            <div class="aval-dist-bar" style="width:${Math.round((d.c/max)*100)}%"></div>
          </div>
          <span class="aval-dist-count">${d.c}</span>
        </div>`).join('')}
    </div>`;

  // Tabela
  const stars = n => '<span class="aval-stars">' + '★'.repeat(n) + '<span style="opacity:.3">' + '☆'.repeat(5-n) + '</span></span>';
  listEl.innerHTML = _avaliacoesData.map(r => `
    <div class="table-row" style="grid-template-columns:70px 90px 110px 60px 1fr 140px">
      <span class="cell-mono">#${r.id}</span>
      <span>${r.laboratorio || '—'}</span>
      <span>${r.ti?.nome || '—'}</span>
      <span>${stars(r.avaliacao)}</span>
      <span class="cell-trunc">${r.avaliacao_comentario || '<span style="opacity:.4">sem comentário</span>'}</span>
      <span class="cell-date">${fmtData(r.resolvido_em)}</span>
    </div>`).join('');
}

function _avaliacoesHtmlTable(data) {
  const estrelas = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  return `<table>
    <thead><tr><th>#Ticket</th><th>Laboratório</th><th>Técnico</th><th>Nota</th><th>Comentário</th><th>Data</th></tr></thead>
    <tbody>
      ${data.map(r => `<tr>
        <td>#${r.id}</td>
        <td>${r.laboratorio || '—'}</td>
        <td>${r.ti?.nome || '—'}</td>
        <td>${estrelas(r.avaliacao)}</td>
        <td>${r.avaliacao_comentario || '—'}</td>
        <td>${fmtData(r.resolvido_em)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

window.exportarAvaliacoes = function(formato) {
  if (!_avaliacoesData.length) { showNotif('Nenhuma avaliação para exportar', 'warn'); return; }

  const total = _avaliacoesData.length;
  const media = (_avaliacoesData.reduce((a,r) => a+(r.avaliacao||0), 0) / total).toFixed(1);
  const dataHora = new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
  const tabela  = _avaliacoesHtmlTable(_avaliacoesData);

  const bodyHtml = `
    <h2 style="margin:0 0 4px;font-size:13pt;font-weight:700">Relatório de Avaliações</h2>
    <p style="margin:0 0 16px;font-size:9pt;color:#555">
      Total: <strong>${total}</strong> avaliação${total!==1?'ões':''} &nbsp;|&nbsp;
      Média: <strong>${media} / 5</strong> &nbsp;|&nbsp;
      Emitido em: ${dataHora}
    </p>
    ${tabela}`;

  const css = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;color:#000;background:#fff;padding:28px}
    h2{font-size:13pt;font-weight:700;margin-bottom:4px}
    p{font-size:9pt;color:#555;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:8.5pt}
    thead tr{background:#000;color:#fff}
    thead th{padding:7px 10px;text-align:left;font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase}
    tbody tr:nth-child(even){background:#f5f5f5}
    tbody td{padding:6px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top}
    @page{margin:14mm 12mm 18mm}`;

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;margin-bottom:18px;border-bottom:2.5px solid #000">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:38px;height:38px;background:#000;border-radius:4px;display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div>
          <div style="font-size:15pt;font-weight:800;line-height:1">DSos</div>
          <div style="font-size:7.5pt;color:#666;margin-top:2px">Sistema de Ordem de Serviço</div>
        </div>
      </div>
      <div style="text-align:right;font-size:8pt;color:#444;line-height:1.7">
        <div><strong>Emitido em:</strong> ${dataHora}</div>
      </div>
    </div>`;

  if (formato === 'pdf') {
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>DSos — Avaliações</title><style>${css}</style></head><body>${header}${bodyHtml}<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script></body></html>`;
    const win = window.open('','_blank','width=960,height=700');
    if (!win) { showNotif('Permita popups para exportar', 'warn'); return; }
    win.document.write(html);
    win.document.close();
  } else {
    // Word — HTML com MIME de Word, abre e salva como .doc
    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><title>DSos — Avaliações</title>
<style>${css} body{padding:28px} table{border:1px solid #ccc}</style></head>
<body>${header}${bodyHtml}</body></html>`;
    const blob = new Blob([wordHtml], { type: 'application/msword' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `DSos_Avaliacoes_${new Date().toISOString().slice(0,10)}.doc` });
    a.click();
    URL.revokeObjectURL(a.href);
    showNotif('Arquivo Word baixado!', 'ok');
  }
};

// ═══════════════════════════════════════════════════════════════
// EXPO GLOBAL
// ═══════════════════════════════════════════════════════════════
window.verImpactoLimpezaLogs  = verImpactoLimpezaLogs;
window.executarLimpezaLogs    = executarLimpezaLogs;
window.apagarLogs             = apagarLogs;
window.mudarAba          = mudarAba;
window.toggleTema        = toggleTema;
window.voltarPainel      = voltarPainel;
window.limparFiltros     = limparFiltros;
window.setDateRange      = setDateRange;
window.irPagina          = irPagina;
window.abrirModal        = abrirModal;
window.fecharModal       = fecharModal;
window.exportarCSV       = exportarCSV;
window.exportarTudo      = exportarTudo;
window.showNotif         = showNotif;
window.prepararEImprimir = function(){
  const aba = STATE.abaAtiva;
  const LABELS = {
    auditoria:  'Auditoria de Ações',
    'audit-log':'Log de Auditoria',
    atividades: 'Log de Atividades',
    acessos:    'Log de Acessos',
    criticas:   'Alterações Críticas',
    massa:      'Operações em Massa',
  };
  const COLS = {
    auditoria:  [['Data/Hora','executado_em',r=>fmtData(r.executado_em)],['Login','login',r=>r.login||'—'],['Ação','acao',r=>r.acao||'—'],['Detalhes','detalhes',r=>r.detalhes||'—']],
    'audit-log':[['Data/Hora','timestamp',r=>fmtData(r.timestamp)],['Usuário','usuario_login',r=>r.usuario_login||r.usuario_nome||'—'],['Tipo','tipo_acao',r=>r.tipo_acao||'—'],['Tabela','tabela_afetada',r=>r.tabela_afetada||'—'],['Status','status',r=>r.status||'—']],
    atividades: [['Data/Hora','timestamp',r=>fmtData(r.timestamp)],['Usuário','usuario_nome',r=>r.usuario_nome||r.usuario_login||'—'],['Módulo','modulo',r=>r.modulo||'—'],['Ação','acao',r=>r.acao||'—'],['Descrição','descricao_amigavel',r=>r.descricao_amigavel||'—'],['Impacto','impacto',r=>r.impacto||'—']],
    acessos:    [['Data/Hora','timestamp',r=>fmtData(r.timestamp)],['Tipo','usuario_tipo',r=>({ti:'T.I.',pc:'PC',professor:'Prof.'}[r.usuario_tipo]||r.usuario_tipo||'—')],['Login','usuario_login',r=>r.usuario_login||'—'],['Nome','usuario_nome',r=>r.usuario_nome||'—'],['Status','status_login',r=>r.status_login||'—'],['Duração','duracao_sessao',r=>r.duracao_sessao||'—']],
    criticas:   [['Data/Hora','timestamp',r=>fmtData(r.timestamp)],['Usuário','usuario_login',r=>r.usuario_login||'—'],['Tabela','tabela',r=>r.tabela||'—'],['Campo','campo_alterado',r=>r.campo_alterado||'—'],['Antes','valor_anterior',r=>r.valor_anterior||'—'],['Depois','valor_novo',r=>r.valor_novo||'—']],
    massa:      [['Data/Hora','timestamp',r=>fmtData(r.timestamp)],['Usuário','usuario_login',r=>r.usuario_login||'—'],['Operação','operacao',r=>r.operacao||'—'],['Qtd','quantidade_registros',r=>String(r.quantidade_registros??'—')],['Status','status',r=>r.status||'—']],
  };

  const cols = COLS[aba] || [];
  const data = STATE.dados[aba] || [];
  const abaLabel = LABELS[aba] || aba;
  const dataHora = new Date().toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});

  const thead = `<thead><tr>${cols.map(([h])=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = data.length
    ? `<tbody>${data.map(r=>`<tr>${cols.map(([,, fn])=>`<td>${fn(r)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : `<tbody><tr><td colspan="${cols.length}" style="text-align:center;color:#888;padding:20px">Nenhum registro encontrado</td></tr></tbody>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>DSos — ${abaLabel}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;color:#000;background:#fff}
  header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 28px 14px;border-bottom:2.5px solid #000}
  .hdr-left{display:flex;align-items:center;gap:14px}
  .logo-box{width:40px;height:40px;background:#000;border-radius:4px;display:flex;align-items:center;justify-content:center}
  .sys-name{font-size:16pt;font-weight:800;letter-spacing:-.5px;line-height:1}
  .sys-sub{font-size:8pt;color:#555;margin-top:3px}
  .hdr-right{text-align:right;font-size:8pt;color:#444;line-height:1.7}
  .report-title{padding:14px 28px 10px;font-size:13pt;font-weight:700;border-bottom:1px solid #ccc;display:flex;justify-content:space-between;align-items:center}
  .report-count{font-size:8pt;font-weight:400;color:#555}
  table{width:100%;border-collapse:collapse;font-size:8pt}
  thead tr{background:#000;color:#fff}
  thead th{padding:7px 10px;text-align:left;font-weight:600;font-size:7pt;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
  tbody tr:nth-child(even){background:#f5f5f5}
  tbody td{padding:6px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;line-height:1.4;word-break:break-word}
  footer{position:fixed;bottom:0;left:0;right:0;padding:5px 28px;border-top:1px solid #ccc;display:flex;justify-content:space-between;font-size:7pt;color:#777;background:#fff}
  @page{margin:12mm 12mm 18mm}
</style>
</head>
<body>
<header>
  <div class="hdr-left">
    <div class="logo-box">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    </div>
    <div>
      <div class="sys-name">DSos</div>
      <div class="sys-sub">Sistema de Ordem de Serviço</div>
    </div>
  </div>
  <div class="hdr-right">
    <div><strong>Emitido em:</strong> ${dataHora}</div>
    <div><strong>Relatório:</strong> ${abaLabel}</div>
  </div>
</header>
<div class="report-title">
  <span>${abaLabel}</span>
  <span class="report-count">${data.length} registro${data.length!==1?'s':''}</span>
</div>
<table>${thead}${tbody}</table>
<footer>
  <span>DSos — Relatório gerado automaticamente</span>
  <span>${dataHora}</span>
</footer>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()};}<\/script>
</body>
</html>`;

  const win = window.open('','_blank','width=960,height=700');
  if(!win){showNotif('Permita popups para gerar o PDF','warn');return;}
  win.document.write(html);
  win.document.close();
};
window.abrirBuscaGlobal  = abrirBuscaGlobal;
window.fecharBuscaGlobal = fecharBuscaGlobal;
window.onGsInput         = onGsInput;
window.carregarDados     = carregarDados;
window.carregarDashboard = carregarDashboard;
window.dashPeriodoPreset = function(dias) {
  const ate = new Date().toISOString().split('T')[0];
  const de  = new Date(Date.now()-dias*86400000).toISOString().split('T')[0];
  const deEl=document.getElementById('dash-de'), ateEl=document.getElementById('dash-ate');
  if(deEl)deEl.value=de; if(ateEl)ateEl.value=ate;
  document.querySelectorAll('.dash-periodo-btn').forEach(b=>b.classList.remove('active'));
  event?.target?.classList.add('active');
  carregarDashboard();
};
/* ═══════════════════════════════════════════
   AI: RELATÓRIO SEMANAL EM LINGUAGEM NATURAL
═══════════════════════════════════════════ */
window.gerarRelatorioIA = async function() {
  const modal = document.getElementById('modal-relatorio-ia');
  const conteudo = document.getElementById('relatorio-ia-conteudo');
  const btnGerar = document.getElementById('btn-gerar-relatorio');
  if (!modal || !conteudo) return;

  modal.classList.add('open');
  conteudo.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--muted);font-size:.7rem"><div class="spin"></div> Analisando dados e gerando relatório…</div>';
  if (btnGerar) { btnGerar.disabled = true; btnGerar.textContent = 'Gerando…'; }

  try {
    // Coleta dados dos últimos 7 dias
    const ate = new Date().toISOString().split('T')[0];
    const de = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
    const H7 = { apikey: CFG.SB_KEY, Authorization: `Bearer ${CFG.SB_KEY}` };
    const [r1, r2] = await Promise.all([
      fetch(`${CFG.SB_URL}/rest/v1/ticket?aberto_em=gte.${de}T00:00:00&aberto_em=lte.${ate}T23:59:59&select=tipo,status,prioridade,laboratorio,aberto_em,resolvido_em`, { headers: H7 }),
      fetch(`${CFG.SB_URL}/rest/v1/ticket?aberto_em=gte.${de}T00:00:00&select=status`, { headers: H7 }),
    ]);
    const dados = await r1.json();
    if (!Array.isArray(dados) || !dados.length) {
      conteudo.innerHTML = '<p style="color:var(--muted)">Nenhum chamado encontrado no período de 7 dias.</p>';
      if (btnGerar) { btnGerar.disabled = false; btnGerar.textContent = 'Gerar relatório'; }
      return;
    }

    // Monta resumo estatístico para a IA
    const total = dados.length;
    const resolvidos = dados.filter(t=>t.status==='resolvido'||t.status==='descartado').length;
    const abertos = dados.filter(t=>t.status==='aberto'||t.status==='em_andamento').length;
    const porTipo = dados.reduce((a,t)=>{a[t.tipo||'outro']=(a[t.tipo||'outro']||0)+1;return a},{});
    const porLab  = dados.reduce((a,t)=>{if(t.laboratorio){a[t.laboratorio]=(a[t.laboratorio]||0)+1;}return a},{});
    const topLab  = Object.entries(porLab).sort(([,a],[,b])=>b-a).slice(0,5).map(([k,v])=>`${k}: ${v}`).join(', ');
    const porDia  = dados.reduce((a,t)=>{const d=t.aberto_em?.split('T')[0];if(d){a[d]=(a[d]||0)+1;}return a},{});
    const maxDia  = Object.entries(porDia).sort(([,a],[,b])=>b-a)[0]||['N/A','0'];
    const tiposStr = Object.entries(porTipo).map(([k,v])=>`${k}: ${v}`).join(', ');
    const temposMed = dados.filter(t=>t.aberto_em&&t.resolvido_em).map(t=>(new Date(t.resolvido_em)-new Date(t.aberto_em))/60000);
    const tempoMedMin = temposMed.length ? Math.round(temposMed.reduce((a,b)=>a+b,0)/temposMed.length) : null;

    const contexto = `Período: ${de} a ${ate}
Total de chamados: ${total}
Resolvidos/descartados: ${resolvidos}
Em aberto/andamento: ${abertos}
Taxa de resolução: ${total>0?Math.round(resolvidos/total*100):0}%
Por tipo: ${tiposStr||'N/A'}
Laboratórios com mais chamados: ${topLab||'N/A'}
Dia com mais chamados: ${maxDia[0]} (${maxDia[1]} chamados)
Tempo médio de resolução: ${tempoMedMin!=null?tempoMedMin+' minutos':'dados insuficientes'}`;

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-r1-distill-llama-70b',
        temperature: 0.4,
        max_tokens: 800,
        messages: [
          { role: 'system', content: 'Você é um analista de TI escolar. Com base nos dados fornecidos, escreva um relatório semanal de suporte em português claro e direto. Use linguagem natural, sem markdown, sem asteriscos, sem bullet points formatados com traços — apenas parágrafos curtos separados por linha em branco. Inclua: resumo geral do período, padrões observados, laboratórios mais problemáticos, e uma recomendação prática para a equipe de TI. Máximo 250 palavras.' },
          { role: 'user', content: `Dados da semana:\n${contexto}` }
        ]
      })
    });
    const d = await resp.json();
    const texto = (d.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();

    conteudo.innerHTML = `
      <div style="font-size:.58rem;font-weight:700;letter-spacing:.07em;color:var(--muted);margin-bottom:10px">RELATÓRIO SEMANAL · ${de} a ${ate}</div>
      <div style="font-size:.68rem;line-height:1.7;color:var(--text);white-space:pre-line">${texto}</div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--glass-b);font-size:.58rem;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap">
        <span>📋 ${total} chamados</span>
        <span>✅ ${resolvidos} resolvidos</span>
        <span>🏫 ${topLab||'—'}</span>
        ${tempoMedMin!=null?`<span>⏱ ~${tempoMedMin}min médio</span>`:''}
      </div>`;
  } catch(e) {
    conteudo.innerHTML = `<p style="color:var(--red)">Erro ao gerar relatório: ${e.message}</p>`;
  } finally {
    if (btnGerar) { btnGerar.disabled = false; btnGerar.textContent = 'Gerar relatório'; }
  }
};
window.fecharRelatorioIA = function() {
  document.getElementById('modal-relatorio-ia')?.classList.remove('open');
};

window.dashAba = function(id) {
  document.querySelectorAll('.dash-subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.dst-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('dst-btn-'+id)?.classList.add('active');
  document.getElementById('dst-'+id)?.classList.add('active');
  // Re-renderiza charts pois o canvas pode ter sido oculto
  Object.values(_dashCharts).forEach(c => { try { c?.resize(); } catch(_) {} });
};
