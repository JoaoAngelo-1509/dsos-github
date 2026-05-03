// DSos v1.5.2 — session-guard.js
// ── Logout automático por inatividade ──────────────────────────────────────
// Uso: import { initSessionGuard } from './session-guard.js';
//      initSessionGuard({ onLogout: () => { ... sair() ... } });
// ───────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS  = 30 * 60 * 1000;   // 30 min → logout
const WARNING_MS  = 28 * 60 * 1000;   // 28 min → aviso
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
      <span>Sessão expira em <strong id="sw-countdown">2:00</strong> por inatividade.</span>
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
function _startCountdown() {
  let remaining = 120; // 2 min em segundos
  const el = document.getElementById('sw-countdown');
  clearInterval(_timerCount);
  _timerCount = setInterval(() => {
    remaining--;
    if (el) {
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2, '0');
      el.textContent = `${m}:${s}`;
    }
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

  _timerWarning = setTimeout(_showWarning,  WARNING_MS);
  _timerLogout  = setTimeout(() => {
    _hideWarning();
    if (typeof _onLogout === 'function') _onLogout();
  }, TIMEOUT_MS);
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
 * @param {{ onLogout: function }} options
 */
export function initSessionGuard({ onLogout }) {
  _onLogout = onLogout;
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