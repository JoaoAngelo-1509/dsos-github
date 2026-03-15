// DSos v1.1.0 — ui.js
// ── ui.js — Utilitários de UI compartilhados entre todas as páginas ──

// ── MODO ESCURO ──
// chave de storage: 'dsos_tema_login'
export function applyTheme() {
  const saved = localStorage.getItem('dsos_tema_login');
  if (saved === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  }
}

export function toggleTema() {
  const html = document.documentElement;
  const dark = html.dataset.theme === 'dark';
  html.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('dsos_tema_login', html.dataset.theme);
  updateTemaIcon(!dark);
}

export function updateTemaIcon(isDark) {
  const ico = document.getElementById('ico-tema');
  if (!ico) return;
  ico.innerHTML = isDark
    ? `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`
    : `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
}

// ── LOGOUT ──
export function sair() {
  sessionStorage.removeItem('dsos_session');
  window.location.href = 'login.html';
}

// ── ESCAPE HTML (previne XSS) ──
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── TOAST (notificação temporária) ──
// t = 'ok' (verde) | 'err' (vermelho)
export function toast(msg, t) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${t} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── TRADUZ STATUS ──
export function statusLabel(s) {
  return {
    aberto: 'Aberto',
    em_andamento: 'Em andamento',
    resolvido: 'Resolvido',
    descartado: 'Descartado',
    falso_alarme: 'Falso alarme'
  }[s] || s;
}

// ── SVG ÍCONE POR TIPO DE TICKET ──
export function tipoIcon(tipo) {
  const svgWrap = (inner) =>
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  if (!tipo)
    return svgWrap('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>');
  const t = tipo.toLowerCase();
  if (t.includes('hardware'))
    return svgWrap('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>');
  if (t.includes('software'))
    return svgWrap('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
  if (t.includes('periférico') || t.includes('periferico'))
    return svgWrap('<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v8"/>');
  if (t.includes('rede'))
    return svgWrap('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>');
  return svgWrap('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>');
}
