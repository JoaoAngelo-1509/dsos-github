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

// ── filtros disponíveis por aba (id-do-input → parâmetro da query) ──
const TAB_FILTERS = {
  'auditoria': [
    { id: 'auditoria-dataStart', param: 'executado_em', op: 'gte', suffix: '' },
    { id: 'auditoria-dataEnd',   param: 'executado_em', op: 'lte', suffix: 'T23:59:59' },
    { id: 'auditoria-login',     param: 'login',        op: 'ilike' },
  ],
  'audit-log': [
    { id: 'audit-log-tipo',   param: 'tipo_acao',       op: 'eq'    },
    { id: 'audit-log-tabela', param: 'tabela_afetada',  op: 'ilike' },
    { id: 'audit-log-status', param: 'status',          op: 'eq'    },
  ],
  'atividades': [
    { id: 'atividades-modulo',  param: 'modulo',  op: 'eq'  },
    { id: 'atividades-impacto', param: 'impacto', op: 'eq'  },
  ],
  'acessos': [
    { id: 'acessos-status',  param: 'status_login',  op: 'eq'    },
    { id: 'acessos-usuario', param: 'usuario_login', op: 'ilike' },
  ],
  'criticas': [
    { id: 'criticas-tabela',   param: 'tabela',  op: 'ilike' },
    { id: 'criticas-aprovado', param: 'aprovado', op: 'eq'   },
  ],
  'operacoes': [
    { id: 'operacoes-operacao', param: 'operacao', op: 'ilike' },
    { id: 'operacoes-status',   param: 'status',   op: 'eq'    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const STATE = {
  abaAtiva: 'auditoria',
  pagina: {},       // { aba: número }
  totais: {},       // { aba: número }
  dados: {},        // { aba: array }
  arTimers: {},     // { aba: intervalId }
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  carregarUsuario();
  iniciarRelogio();
  registrarFiltros();
  registrarAutoRefresh();
  carregarDados('auditoria');
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

// Restaurar tema salvo
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
  // desativar aba antiga
  const tabAtiva = document.getElementById(`tab-${STATE.abaAtiva}`);
  const panelAtivo = document.getElementById(`panel-${STATE.abaAtiva}`);
  if (tabAtiva) tabAtiva.classList.remove('active');
  if (panelAtivo) panelAtivo.classList.remove('active');

  // ativar nova
  const tabNova = document.getElementById(`tab-${aba}`);
  const panelNovo = document.getElementById(`panel-${aba}`);
  if (tabNova) tabNova.classList.add('active');
  if (panelNovo) panelNovo.classList.add('active');

  STATE.abaAtiva = aba;
  STATE.pagina[aba] = 0;

  // carregar somente se não tiver dados ainda
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
      const evento = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evento, () => {
        STATE.pagina[aba] = 0;
        STATE.dados[aba] = null; // forçar reload
        carregarDados(aba);
      });
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

function buildUrl(aba) {
  const meta = TAB_META[aba];
  if (!meta) return null;
  const page = STATE.pagina[aba] || 0;
  const offset = page * CFG.PER_PAGE;
  let url = `${CFG.SB_URL}/rest/v1/${meta.table}?select=*&order=${meta.order}.desc&limit=${CFG.PER_PAGE}&offset=${offset}`;

  const filtros = TAB_FILTERS[aba] || [];
  filtros.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    let val = el.value.trim();
    if (!val) return;

    // casos especiais
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

    STATE.dados[aba] = data;
    STATE.totais[aba] = total;

    // render de linhas
    RENDER[aba]?.(data, container);

    // render de KPIs (se existir)
    RENDER_KPI[aba]?.(data);

    // paginação
    renderPaginacao(aba, total);

    // timestamp
    atualizarLastUpdate(aba);

  } catch (err) {
    console.error(`[painel-logs] Erro ao carregar ${aba}:`, err);
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">⚠️</div>
      <p>Erro ao carregar dados — verifique a conexão.</p>
    </div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER ROWS
// ═══════════════════════════════════════════════════════════════
const RENDER = {

  auditoria(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    el.innerHTML = data.map(r => `
      <div class="table-row" style="grid-template-columns:150px 120px 1fr 200px"
           onclick='abrirModal("auditoria",${esc(r)})'>
        <span class="cell-date">${fmtData(r.executado_em)}</span>
        <span class="cell-user">${e(r.login)}</span>
        <span>${e(r.acao)}</span>
        <span class="cell-trunc">${e(r.detalhes)}</span>
      </div>`).join('');
  },

  'audit-log'(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    el.innerHTML = data.map(r => {
      const erro = r.status === 'erro';
      return `
      <div class="table-row ${erro ? 'row-error' : ''}" style="grid-template-columns:150px 120px 80px 140px 80px"
           onclick='abrirModal("audit-log",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_login || r.usuario_nome)}</span>
        <span>${badgeTipo(r.tipo_acao)}</span>
        <span class="cell-trunc">${e(r.tabela_afetada)}</span>
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
    el.innerHTML = data.map(r => {
      const falha = r.status_login === 'falha';
      const statusBadge = badgeStatus(r.status_login, { sucesso:'ok', falha:'erro', logout:'warn' });
      const userTypeBadge = r.usuario_tipo === 'ti' || r.usuario_tipo === 'TI' 
        ? '<span class="spill sp-ti">usuario ti</span>'
        : r.usuario_tipo === 'admin' || r.usuario_tipo === 'ADMIN'
        ? '<span class="spill sp-admin">admin</span>'
        : '';
      return `
      <div class="table-row ${falha ? 'row-error' : ''}" style="grid-template-columns:150px 110px 80px 80px 1fr 120px"
           onclick='abrirModal("acessos",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_nome || r.usuario_login)}</span>
        <span>${statusBadge}</span>
        <span>${userTypeBadge}</span>
        <span class="cell-trunc">${e(r.motivo_falha)}</span>
        <span class="cell-mono">${fmtDuracao(r.duracao_sessao)}</span>
      </div>`;
    }).join('');
  },

  criticas(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    el.innerHTML = data.map(r => {
      const pendente = !r.aprovado;
      return `
      <div class="table-row ${pendente ? 'row-critical' : ''}" style="grid-template-columns:150px 110px 100px 110px 160px 90px"
           onclick='abrirModal("criticas",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_login)}</span>
        <span class="cell-mono">${e(r.tabela)}</span>
        <span class="cell-trunc">${e(r.campo_alterado)}</span>
        <span class="cell-trunc">${e(r.valor_novo)}</span>
        <span>${pendente
          ? '<span class="spill sp-pendente">⚠ Pendente</span>'
          : '<span class="spill sp-aprovado">✓ Aprovado</span>'}</span>
      </div>`;
    }).join('');
  },

  operacoes(data, el) {
    if (!data.length) { el.innerHTML = empty(); return; }
    el.innerHTML = data.map(r => {
      const tabelas = Array.isArray(r.tabelas_afetadas)
        ? r.tabelas_afetadas.join(', ')
        : (r.tabelas_afetadas || '—');
      return `
      <div class="table-row" style="grid-template-columns:150px 110px 150px 100px 1fr 80px"
           onclick='abrirModal("operacoes",${esc(r)})'>
        <span class="cell-date">${fmtData(r.timestamp)}</span>
        <span class="cell-user">${e(r.usuario_login)}</span>
        <span class="cell-trunc">${e(r.operacao)}</span>
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
    const h24 = new Date(); h24.setHours(h24.getHours() - 24);

    const totalP = data.length;
    const hojeQ = data.filter(d => new Date(d.executado_em) >= hoje).length;
    const h24Q  = data.filter(d => new Date(d.executado_em) >= h24).length;

    const freq = {};
    data.forEach(d => { if (d.acao) freq[d.acao] = (freq[d.acao]||0)+1; });
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0];

    el.innerHTML = `
      ${kpiCard('red', iconBar(), totalP, 'Ações no período')}
      ${kpiCard('green', iconCheck(), hojeQ, 'Ações hoje')}
      ${kpiCard('yellow', iconBolt(), h24Q, 'Últimas 24h')}
      ${top ? kpiCard('red', iconTop(), top[1]+'x', top[0], true) : ''}`;
  },

  atividades(data) {
    const el = document.getElementById('atividades-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const byMod = {}; const byImp = {};
    data.forEach(d => {
      if (d.modulo) byMod[d.modulo] = (byMod[d.modulo]||0)+1;
      if (d.impacto) byImp[d.impacto] = (byImp[d.impacto]||0)+1;
    });
    const top = Object.entries(byMod).sort((a,b)=>b[1]-a[1])[0];
    const alto = byImp['alto'] || 0;

    el.innerHTML = `
      ${kpiCard('red',    iconBar(),   data.length, 'Total atividades')}
      ${top ? kpiCard('green', iconTarget(), top[1], top[0]) : ''}
      ${kpiCard('yellow', iconWarn(),  alto,        'Alto impacto')}`;
  },

  acessos(data) {
    const el = document.getElementById('acessos-kpis');
    if (!el || !data.length) { if (el) el.innerHTML = ''; return; }

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const td = data.filter(d => new Date(d.timestamp) >= hoje);
    const ok  = td.filter(d => d.status_login === 'sucesso').length;
    const err = td.filter(d => d.status_login === 'falha').length;

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

    const pendente  = data.filter(d => !d.aprovado).length;
    const aprovado  = data.filter(d =>  d.aprovado).length;

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

  const page = STATE.pagina[aba] || 0;
  const totalPages = Math.max(1, Math.ceil(total / CFG.PER_PAGE));
  const inicio = page * CFG.PER_PAGE + 1;
  const fim = Math.min((page + 1) * CFG.PER_PAGE, total);

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
  // scroll suave ao topo da tabela
  document.getElementById(`rows-${aba}`)?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════
function abrirModal(aba, data) {
  const bg    = document.getElementById('modal-bg');
  const titulo = document.getElementById('modal-titulo');
  const corpo = document.getElementById('modal-corpo');

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

// fechar no overlay
document.getElementById('modal-bg')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) fecharModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') fecharModal();
});

// ── campo helper para o modal ──
function mf(label, value, extra = '', monoClass = '') {
  const cls = extra ? ` class="${extra}"` : '';
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

  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '""';
      if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showNotif('CSV exportado com sucesso', 'ok');
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
// EXPO GLOBAL (para uso em onclick do HTML)
// ═══════════════════════════════════════════════════════════════
window.mudarAba = mudarAba;
window.toggleTema = toggleTema;
window.voltarPainel = voltarPainel;
window.limparFiltros = limparFiltros;
window.irPagina = irPagina;
window.abrirModal = abrirModal;
window.fecharModal = fecharModal;
window.exportarCSV = exportarCSV;
window.showNotif = showNotif;