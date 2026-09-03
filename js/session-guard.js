// DSos v1.5.2 — session-guard.js
// ── Logout automático por inatividade ──────────────────────────────────────
// Uso: import { initSessionGuard } from './session-guard.js';
//      initSessionGuard({ onLogout: () => { ... sair() ... } });
// ───────────────────────────────────────────────────────────────────────────

// Padrão: 30 min para logout, aviso 2 min antes. Vale para as telas usadas em
// máquina de uso pessoal (painel T.I. e painel de logs), onde deslogar alguém
// no meio do turno atrapalha mais do que protege.
//
// O painel do PC/professor passa valores menores: aquelas telas rodam nas
// máquinas do laboratório, que são públicas e trocam de usuário ao longo do
// dia — lá o risco é o aluno levantar e ir embora deixando a sessão aberta
// para o próximo que sentar. Ver a chamada em painel-pc.js.
const TIMEOUT_PADRAO_MS = 30 * 60 * 1000;
const AVISO_PADRAO_MS   =  2 * 60 * 1000;   // quanto tempo o aviso fica na tela

let _timeoutMs    = TIMEOUT_PADRAO_MS;
let _avisoMs      = AVISO_PADRAO_MS;
const STORAGE_KEY = 'dsos_last_activity';

let _timerLogout  = null;
let _timerWarning = null;
let _timerCount   = null;
let _onLogout     = null;
let _warningEl    = null;

// ── Injeta o banner de aviso no body (uma vez) ──────────────────────────────
function _injectBanner() {
  if (document.getElementById('session-warning')) return;
  const el = document.createElement('div');
  el.id = 'session-warning';
  el.innerHTML = `
    <div class="sw-inner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3
                 L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>
      </svg>
      <span>Sessão expira em <strong id="sw-countdown">${_fmtMMSS(_avisoMs / 1000)}</strong> por inatividade.</span>
      <button id="sw-keep" onclick="window._dsosSG?.extend()">Continuar conectado</button>
    </div>`;
  document.body.appendChild(el);
  _warningEl = el;

  // CSS injetado inline para não depender de arquivo CSS externo
  const style = document.createElement('style');
  style.textContent = `
    #session-warning {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9000;
      background: #1a0a0a;
      border-top: 2px solid #c0171a;
      padding: 10px 20px;
      animation: swSlideUp .3s cubic-bezier(.22,1,.36,1);
    }
    #session-warning.visible { display: block; }
    @keyframes swSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: none; opacity: 1; }
    }
    .sw-inner {
      max-width: 720px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: 'Sora', sans-serif;
      font-size: .74rem;
      color: #f0e0e0;
    }
    .sw-inner svg { color: #f5d000; flex-shrink: 0; }
    .sw-inner span { flex: 1; }
    .sw-inner strong { color: #fff; font-weight: 700; }
    #sw-keep {
      background: #c0171a;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 6px 16px;
      font-family: inherit;
      font-size: .72rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: background .2s;
      flex-shrink: 0;
    }
    #sw-keep:hover { background: #a01215; }
  `;
  document.head.appendChild(style);
}

// ── Atualiza o countdown no banner ─────────────────────────────────────────
function _fmtMMSS(segundos) {
  const m = Math.floor(segundos / 60);
  const s = String(Math.round(segundos % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function _startCountdown() {
  // Era fixo em 120s. Com a janela de aviso configurável, um painel com aviso
  // de 2 min e outro com aviso de 1 min mostrariam a mesma contagem — e ela
  // não bateria com o logout de verdade.
  let remaining = Math.round(_avisoMs / 1000);
  const el = document.getElementById('sw-countdown');
  if (el) el.textContent = _fmtMMSS(remaining);
  clearInterval(_timerCount);
  _timerCount = setInterval(() => {
    remaining--;
    if (el) el.textContent = _fmtMMSS(Math.max(0, remaining));
    if (remaining <= 0) clearInterval(_timerCount);
  }, 1000);
}

// ── Mostra o banner de aviso ────────────────────────────────────────────────
function _showWarning() {
  _warningEl = document.getElementById('session-warning');
  if (_warningEl) {
    _warningEl.classList.add('visible');
    _startCountdown();
  }
}

// ── Esconde o banner ────────────────────────────────────────────────────────
function _hideWarning() {
  const el = document.getElementById('session-warning');
  if (el) el.classList.remove('visible');
  clearInterval(_timerCount);
}

// ── Reseta todos os timers (chamado a cada atividade) ───────────────────────
function _reset() {
  clearTimeout(_timerLogout);
  clearTimeout(_timerWarning);
  clearInterval(_timerCount);
  _hideWarning();

  sessionStorage.setItem(STORAGE_KEY, Date.now());

  _timerWarning = setTimeout(_showWarning, Math.max(0, _timeoutMs - _avisoMs));
  _timerLogout  = setTimeout(() => {
    _hideWarning();
    if (typeof _onLogout === 'function') _onLogout();
  }, _timeoutMs);
}

// ── Eventos de atividade ────────────────────────────────────────────────────
const _EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];

function _attachListeners() {
  _EVENTS.forEach(ev =>
    document.addEventListener(ev, _reset, { passive: true })
  );
}

function _detachListeners() {
  _EVENTS.forEach(ev =>
    document.removeEventListener(ev, _reset)
  );
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Inicia o guard de sessão.
 * @param {{ onLogout: function, timeoutMs?: number, avisoMs?: number }} options
 *   timeoutMs — inatividade até o logout (padrão 30 min)
 *   avisoMs   — quanto tempo antes do logout o aviso aparece (padrão 2 min)
 */
export function initSessionGuard({ onLogout, timeoutMs, avisoMs }) {
  _onLogout = onLogout;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) _timeoutMs = timeoutMs;
  // O aviso nunca pode ser maior que o próprio timeout: se fosse, o banner
  // apareceria em tempo negativo (ou seja, imediatamente) e ficaria na tela a
  // sessão inteira.
  if (Number.isFinite(avisoMs) && avisoMs > 0) _avisoMs = Math.min(avisoMs, _timeoutMs);
  _injectBanner();
  _attachListeners();
  _reset(); // começa o timer imediatamente

  // Expõe extend() globalmente para o botão inline no HTML
  window._dsosSG = { extend: _reset };
}

/**
 * Para o guard (chamar no logout manual, para não disparar duplo).
 */
export function destroySessionGuard() {
  clearTimeout(_timerLogout);
  clearTimeout(_timerWarning);
  clearInterval(_timerCount);
  _detachListeners();
  _hideWarning();
  sessionStorage.removeItem(STORAGE_KEY);
  window._dsosSG = null;
}