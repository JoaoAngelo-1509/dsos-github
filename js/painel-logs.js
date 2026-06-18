/* DSos v1.5 — painel-logs.js */
'use strict';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
import { SB_URL, SB_KEY } from './supabase-config.js';

const CFG = {
  SB_URL,
  SB_KEY,
  PER_PAGE: 50,
  AR_INTERVAL: 30000,
};

// ── tabelas e campos de ordenação ──
const TAB_META = {
  'auditoria':  { table: 'auditoria_ti',             order: 'executado_em' },
  'audit-log':  { table: 'audit_log',                order: 'timestamp'    },
  'atividades': { table: 'atividades_log',            order: 'timestamp'    },
  'acessos':    { table: 'acesso_log',                order: 'timestamp'    },
  'criticas':   { table: 'alteracoes_criticas_log',   order: 'timestamp'    },
  'operacoes':  { table: 'operacoes_massa_log',       order: 'timestamp'    },
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
  'operacoes': [
    { id: 'operacoes-dataStart', param: 'timestamp', op: 'gte', suffix: '' },
    { id: 'operacoes-dataEnd',   param: 'timestamp', op: 'lte', suffix: 'T23:59:59' },
    { id: 'operacoes-operacao',  param: 'operacao', op: 'ilike' },
    { id: 'operacoes-status',    param: 'status',   op: 'eq'    },
  ],
};

// ── campos de texto para highlight por aba ──
const TAB_SEARCH_FIELDS = {
  'auditoria':  ['login'],
  'audit-log':  ['audit-log-tabela'],
  'atividades': [],
  'acessos':    ['acessos-usuario'],
  'criticas':   ['criticas-tabela'],
  'operacoes':  ['operacoes-operacao'],
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

  // Ctrl+K abre busca global
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      abrirBuscaGlobal();
    }
  });
});

function carregarUsuario() {
  const nome = sessionStorage.getItem('nome_usuario') || sessionStorage.getItem('usuario_nome');
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

  if (!STATE.dados[aba]) {
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
      return `
      <div class="table-row ${falha ? 'row-error' : logout ? 'row-warn' : ''}" style="grid-template-columns:150px 110px 110px 80px 1fr 100px"
           onclick='abrirModal("acessos",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_nome || '—')} ${tipoTag}</span>
        <span>${loginTag}</span>
        <span>${statusBadge}</span>
        <span class="cell-trunc">${e(r.motivo_falha)}</span>
        <span class="cell-mono">${fmtDuracao(r.duracao_sessao)}</span>
      </div>`;
    }).join('');
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

  operacoes(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    const term = _getSearchTerm('operacoes', 'operacoes-operacao');
    el.innerHTML = data.map(r => {
      const tabelas = Array.isArray(r.tabelas_afetadas)
        ? r.tabelas_afetadas.join(', ')
        : (r.tabelas_afetadas || '—');
      return `
      <div class="table-row" style="grid-template-columns:150px 110px 150px 100px 1fr 80px"
           onclick='abrirModal("operacoes",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_login)}</span>
        <span class="cell-trunc">${hl(r.operacao, term)}</span>
        <span style="text-align:right">${e(r.quantidade_registros)}</span>
        <span class="cell-trunc">${e(tabelas)}</span>
        <span>${badgeStatus(r.status)}</span>
      </div>`;
    }).join('');
  },
};

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

  operacoes(data) {
    const el = document.getElementById('operacoes-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const falhas   = data.filter(d => d.status === 'falha').length;
    const parciais = data.filter(d => d.status === 'parcial').length;
    const totalReg = data.reduce((s, d) => s + (parseInt(d.quantidade_registros)||0), 0);

    const freq = {};
    data.forEach(d => { if (d.operacao) freq[d.operacao] = (freq[d.operacao]||0)+1; });
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];

    el.innerHTML = `
      ${kpiCard('red',    iconBar(),   data.length,          'Operações no período')}
      ${kpiCard('yellow', iconBolt(),  totalReg.toLocaleString('pt-BR'), 'Registros afetados')}
      ${kpiCard('red',    iconX(),     falhas,               'Com falha')}
      ${top ? kpiCard('green', iconTarget(), top[1]+'x', top[0], true) : ''}`;
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
             + mf('IP Address',   data.ip_address, '', 'mono')
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

    case 'operacoes': {
      const tabs = Array.isArray(data.tabelas_afetadas)
        ? data.tabelas_afetadas.join(', ') : (data.tabelas_afetadas || '—');
      html += mf('Data/Hora',      fmtData(data.timestamp))
             + mf('Usuário',       data.usuario_login)
             + mf('Operação',      data.operacao)
             + mf('Qtd. registros', data.quantidade_registros)
             + mf('Status',        data.status)
             + mf('Tabelas',       tabs, 'full')
             + (data.resultado_resumo ? mf('Resultado', data.resultado_resumo, 'full') : '');
      break;
    }
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
  'operacoes':  { table: 'operacoes_massa_log',    fields: ['usuario_login','operacao'],    order: 'timestamp',   label: 'Operações' },
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
  'operacoes_massa_log':     'operacoes',
};

function iniciarRealtime() {
  const _sb = window.supabase;
  if (!_sb) { console.warn('[realtime] SDK não carregado'); return; }

  const sbClient = _sb.createClient(CFG.SB_URL, CFG.SB_KEY);
  const channel  = sbClient.channel('logs-realtime-all');

  Object.keys(TABLE_TO_ABA).forEach(table => {
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table }, () => {
      const aba      = TABLE_TO_ABA[table];
      const naAba    = STATE.abaAtiva === aba;
      const pag0     = (STATE.pagina[aba] || 0) === 0;
      const semFiltro = _semFiltros(aba);

      if (naAba && pag0 && semFiltro) {
        _recarregarSilencioso(aba);
      } else {
        STATE.newCounts[aba] = (STATE.newCounts[aba] || 0) + 1;
        _atualizarBadgeRT(aba);
      }
    });
  });

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
// EXPO GLOBAL
// ═══════════════════════════════════════════════════════════════
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
window.abrirBuscaGlobal  = abrirBuscaGlobal;
window.fecharBuscaGlobal = fecharBuscaGlobal;
window.onGsInput         = onGsInput;
window.carregarDados     = carregarDados;
