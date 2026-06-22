// DSos — dsos-ui.js — Popups estilizados (alert / confirm)

function _injectStyles() {
  if (document.getElementById('dsos-ui-styles')) return;
  const s = document.createElement('style');
  s.id = 'dsos-ui-styles';
  s.textContent = `
.dsos-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);animation:dsos-fadein .15s ease}
@keyframes dsos-fadein{from{opacity:0}to{opacity:1}}
.dsos-popup{background:var(--glass,#1a1a2e);border:1px solid var(--glass-b,rgba(255,255,255,.12));border-radius:10px;padding:28px 24px 20px;min-width:300px;max-width:420px;width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5);animation:dsos-popin .18s cubic-bezier(.22,1,.36,1);display:flex;flex-direction:column;gap:16px;font-family:inherit}
@keyframes dsos-popin{from{opacity:0;transform:scale(.9) translateY(12px)}to{opacity:1;transform:none}}
.dsos-popup-icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsos-popup-icon.danger{background:rgba(220,38,38,.15);color:#ef4444}
.dsos-popup-icon.warning{background:rgba(234,179,8,.12);color:#eab308}
.dsos-popup-icon.info{background:rgba(59,130,246,.12);color:#60a5fa}
.dsos-popup-icon.success{background:rgba(34,197,94,.12);color:#22c55e}
.dsos-popup-head{display:flex;align-items:center;gap:12px}
.dsos-popup-title{font-size:.95rem;font-weight:700;color:var(--text,#fff);line-height:1.3}
.dsos-popup-msg{font-size:.82rem;color:var(--text2,rgba(255,255,255,.7));line-height:1.55;white-space:pre-wrap;word-break:break-word}
.dsos-popup-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
.dsos-popup-btns button{padding:7px 18px;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;border:1px solid transparent;transition:opacity .15s,background .15s}
.dsos-btn-cancel{background:transparent;border-color:var(--glass-b,rgba(255,255,255,.15))!important;color:var(--text2,rgba(255,255,255,.65))}
.dsos-btn-cancel:hover{background:rgba(255,255,255,.06)}
.dsos-btn-ok{background:var(--red,#c0171a);color:#fff;border-color:transparent}
.dsos-btn-ok:hover{opacity:.85}
.dsos-btn-ok.warning{background:#ca8a04}
.dsos-btn-ok.info{background:#2563eb}
.dsos-btn-ok.success{background:#16a34a}

[data-hacker="1"] .dsos-popup{background:#000!important;border-color:rgba(229,0,10,.45)!important;border-radius:0!important;font-family:'Courier New',Courier,monospace!important;box-shadow:0 0 30px rgba(229,0,10,.25)}
[data-hacker="1"] .dsos-popup-title{color:#fff!important;letter-spacing:.06em;text-transform:uppercase}
[data-hacker="1"] .dsos-popup-msg{color:rgba(255,255,255,.7)!important}
[data-hacker="1"] .dsos-popup-icon.danger,[data-hacker="1"] .dsos-popup-icon.warning,[data-hacker="1"] .dsos-popup-icon.info,[data-hacker="1"] .dsos-popup-icon.success{background:rgba(229,0,10,.12)!important;color:#e5000a!important;border-radius:0!important}
[data-hacker="1"] .dsos-btn-cancel{border-color:rgba(229,0,10,.3)!important;border-radius:0!important}
[data-hacker="1"] .dsos-btn-cancel:hover{background:rgba(229,0,10,.08)!important}
[data-hacker="1"] .dsos-btn-ok{background:#e5000a!important;border-radius:0!important}

[data-theme="light"] .dsos-popup{background:#fff;border-color:rgba(0,0,0,.1)}
[data-theme="light"] .dsos-popup-title{color:#111}
[data-theme="light"] .dsos-popup-msg{color:rgba(0,0,0,.65)}
[data-theme="light"] .dsos-btn-cancel{border-color:rgba(0,0,0,.2)!important;color:rgba(0,0,0,.6)}
[data-theme="light"] .dsos-btn-cancel:hover{background:rgba(0,0,0,.05)}
  `;
  document.head.appendChild(s);
}

const ICONS = {
  danger: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

/**
 * @param {{msg:string, tipo?:'danger'|'warning'|'info'|'success', titulo?:string, okLabel?:string, cancelLabel?:string}} opts
 * @returns {Promise<boolean>}
 */
export function dsosConfirm(opts = {}) {
  _injectStyles();
  const { msg = '', tipo = 'danger', titulo, okLabel = 'Confirmar', cancelLabel = 'Cancelar' } = opts;
  const defaultTitles = { danger: 'Atenção', warning: 'Aviso', info: 'Confirmar', success: 'Confirmar' };
  const title = titulo || defaultTitles[tipo] || 'Confirmar';

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dsos-overlay';
    overlay.innerHTML = `
      <div class="dsos-popup" role="dialog" aria-modal="true">
        <div class="dsos-popup-head">
          <div class="dsos-popup-icon ${tipo}">${ICONS[tipo] || ICONS.info}</div>
          <div class="dsos-popup-title">${title}</div>
        </div>
        <div class="dsos-popup-msg">${msg}</div>
        <div class="dsos-popup-btns">
          <button class="dsos-btn-cancel" id="_dsos_cancel">${cancelLabel}</button>
          <button class="dsos-btn-ok ${tipo}" id="_dsos_ok">${okLabel}</button>
        </div>
      </div>`;

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_dsos_ok').addEventListener('click', () => close(true));
    overlay.querySelector('#_dsos_cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); });
    document.body.appendChild(overlay);
    overlay.querySelector('#_dsos_ok').focus();
  });
}

/**
 * @param {{msg:string, tipo?:'danger'|'warning'|'info'|'success', titulo?:string, okLabel?:string}} opts
 * @returns {Promise<void>}
 */
export function dsosAlert(opts = {}) {
  _injectStyles();
  const { msg = '', tipo = 'info', titulo, okLabel = 'OK' } = opts;
  const defaultTitles = { danger: 'Erro', warning: 'Aviso', info: 'Informação', success: 'Sucesso' };
  const title = titulo || defaultTitles[tipo] || 'Aviso';

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dsos-overlay';
    overlay.innerHTML = `
      <div class="dsos-popup" role="dialog" aria-modal="true">
        <div class="dsos-popup-head">
          <div class="dsos-popup-icon ${tipo}">${ICONS[tipo] || ICONS.info}</div>
          <div class="dsos-popup-title">${title}</div>
        </div>
        <div class="dsos-popup-msg">${msg}</div>
        <div class="dsos-popup-btns">
          <button class="dsos-btn-ok ${tipo}" id="_dsos_ok">${okLabel}</button>
        </div>
      </div>`;

    const close = () => { overlay.remove(); resolve(); };
    overlay.querySelector('#_dsos_ok').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') close(); });
    document.body.appendChild(overlay);
    overlay.querySelector('#_dsos_ok').focus();
  });
}
