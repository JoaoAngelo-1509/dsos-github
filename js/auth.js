// DSos v1.5 — auth.js  (2FA OTP adicionado)
import { SUPABASE_URL, SUPABASE_HEADERS as headers } from './supabase-config.js';
import { applyTheme, updateTemaIcon, toggleTema } from './ui.js';

window.toggleTema = toggleTema;

applyTheme();

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('dsos_tema_login');
  if (saved === 'dark') updateTemaIcon(true);
});

// ── TOGGLE VISIBILIDADE DE SENHA ──
window.toggleSenha = function () {
  const input = document.getElementById('senha');
  const icone = document.getElementById('icone-olho');
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  icone.innerHTML = mostrar
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
       <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
       <circle cx="12" cy="12" r="3"/>`;
};

// ── ERRO ──
function mostrarErro(msg) {
  const e = document.getElementById('erro');
  e.textContent = msg;
  e.classList.add('visivel');
}
function limparErro() {
  document.getElementById('erro').classList.remove('visivel');
}

// ─────────────────────────────────────────────────────────────
// ESTADO 2FA
// _pendingSession: sessão pronta mas aguardando OTP
// _otpTiId: id do técnico para verificar OTP
// _otpEmailDestino: email mascarado para mostrar no modal
// _devOtp: código em claro (apenas quando sem email configurado)
// _otpResendTimer: timer do botão reenviar
// ─────────────────────────────────────────────────────────────
let _pendingSession   = null;
let _otpTiId          = null;
let _otpEmailDestino  = null;
let _devOtp           = null;     // modo dev sem Resend
let _otpResendTimer   = null;

// ── LOGIN PRINCIPAL ──
window.entrar = async function () {
  const nome    = document.getElementById('nome').value.trim();
  const usuario = document.getElementById('usuario').value.trim();
  const senha   = document.getElementById('senha').value;
  const btn     = document.getElementById('btn');

  limparErro();

  if (!nome)          { mostrarErro('Informe seu nome antes de entrar.'); document.getElementById('nome').focus(); return; }
  if (!usuario || !senha) { mostrarErro('Preencha usuário e senha.'); return; }

  btn.classList.add('loading');

  try {
    // 1. Tenta login como T.I.
    const resTI = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_ti`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_login: usuario, p_senha: senha })
    });
    const tiList = await resTI.json();

    if (Array.isArray(tiList) && tiList.length > 0) {
      const ti = tiList[0];

      // Prepara sessão mas não salva ainda — aguarda 2FA
      _pendingSession = { tipo: 'ti', id: ti.id, login: ti.login, nome };
      _otpTiId        = ti.id;

      // Dispara OTP via Edge Function
      await _dispararOTP(ti.id);
      btn.classList.remove('loading');
      return;  // modal 2FA cuidará do resto
    }

    // 2. Tenta login como PC
    const resPC = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_pc`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_tag: usuario.toUpperCase(), p_senha: senha })
    });
    const pcList = await resPC.json();

    if (Array.isArray(pcList) && pcList.length > 0) {
      const pc = pcList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'pc', id: pc.id, tag: pc.tag,
        laboratorio: pc.laboratorio, lado: pc.lado, nome
      }));
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch(e) {}
      window.location.href = 'painel-pc.html';
      return;
    }

    // 3. Tenta login como Professor
    const resProf = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_professor`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_login: usuario, p_senha: senha })
    });
    const profList = await resProf.json();

    if (Array.isArray(profList) && profList.length > 0) {
      const prof = profList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'professor', id: prof.id, login: prof.login, nome: prof.nome || nome
      }));
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch(e) {}
      window.location.href = 'painel-pc.html';
      return;
    }

    mostrarErro('Usuário ou senha incorretos.');

  } catch (e) {
    mostrarErro('Erro de conexão. Tente novamente.');
    console.error(e);
  } finally {
    btn.classList.remove('loading');
  }
};

// ── DISPARAR OTP (Edge Function) ──
async function _dispararOTP(tiId) {
  const statusEl = document.getElementById('otp-status');
  if (statusEl) statusEl.textContent = 'Enviando código…';

  try {
    const res = await fetch(`${SUPABASE_URL.replace('/rest/v1', '')}/functions/v1/fn-enviar-otp`, {
      method: 'POST',
      headers: { 'apikey': headers.apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ti_id: tiId })
    });
    const data = await res.json();

    if (!data.ok && data.erro === 'sem_email') {
      // Técnico sem email cadastrado — nega acesso com aviso claro
      _cancelarOTP();
      mostrarErro('Este usuário T.I. não tem email cadastrado para 2FA. Peça ao administrador para cadastrar o email antes de prosseguir.');
      return;
    }

    if (!data.ok) {
      _cancelarOTP();
      mostrarErro('Erro ao enviar código 2FA. Tente novamente.');
      return;
    }

    _otpEmailDestino = data.email_destino;

    // Modo dev: se retornar codigo (não acontece na EF, mas localmente pode)
    if (data.codigo) _devOtp = data.codigo;

    _abrirModal2FA();

  } catch(e) {
    console.error('[2FA]', e);
    _cancelarOTP();
    mostrarErro('Erro de conexão ao enviar código 2FA.');
  }
}

// ── ABRIR MODAL 2FA ──
function _abrirModal2FA() {
  const modal = document.getElementById('modal-2fa');
  if (!modal) return;

  // Atualiza texto do email
  const emailEl = document.getElementById('otp-email-destino');
  if (emailEl) emailEl.textContent = _otpEmailDestino || 'seu email cadastrado';

  // Limpa campos
  document.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; });
  document.getElementById('otp-erro')?.classList.remove('visivel');

  modal.classList.add('open');
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 120);

  // Inicia contador de reenvio (60s)
  _iniciarTimerReenvio();
}

// ── VERIFICAR OTP ──
window.verificarOTP = async function () {
  const digits = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
  if (digits.length < 6) {
    _mostrarErroOTP('Digite os 6 dígitos do código.');
    return;
  }

  const btn = document.getElementById('btn-otp-confirmar');
  btn.disabled = true;
  btn.textContent = 'Verificando…';

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_verificar_otp_ti`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_ti_id: _otpTiId, p_codigo: digits })
    });
    const data = await res.json();

    if (data.ok) {
      // ✅ OTP correto — finaliza login
      sessionStorage.setItem('dsos_session', JSON.stringify(_pendingSession));
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch(e) {}
      window.location.href = 'painel-ti.html';
    } else {
      const msgs = {
        invalido: 'Código incorreto. Verifique e tente novamente.',
        expirado: 'Código expirado. Clique em "Reenviar" para um novo código.'
      };
      _mostrarErroOTP(msgs[data.erro] || 'Código inválido.');
      document.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; });
      document.querySelector('.otp-digit')?.focus();
    }
  } catch(e) {
    _mostrarErroOTP('Erro de conexão. Tente novamente.');
    console.error('[2FA verificar]', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar';
  }
};

// ── REENVIAR OTP ──
window.reenviarOTP = async function () {
  if (!_otpTiId) return;
  document.getElementById('btn-otp-reenviar').disabled = true;
  document.getElementById('otp-erro')?.classList.remove('visivel');
  document.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; });
  await _dispararOTP(_otpTiId);
};

// ── CANCELAR 2FA (fechar modal) ──
window.cancelarOTP = _cancelarOTP;
function _cancelarOTP() {
  document.getElementById('modal-2fa')?.classList.remove('open');
  clearInterval(_otpResendTimer);
  _pendingSession  = null;
  _otpTiId         = null;
  _otpEmailDestino = null;
  _devOtp          = null;
}

function _mostrarErroOTP(msg) {
  const el = document.getElementById('otp-erro');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visivel');
}

function _iniciarTimerReenvio() {
  clearInterval(_otpResendTimer);
  const btn = document.getElementById('btn-otp-reenviar');
  if (!btn) return;
  let secs = 60;
  btn.disabled = true;
  btn.textContent = `Reenviar (${secs}s)`;
  _otpResendTimer = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(_otpResendTimer);
      btn.disabled = false;
      btn.textContent = 'Reenviar código';
    } else {
      btn.textContent = `Reenviar (${secs}s)`;
    }
  }, 1000);
}

// ── NAVEGAÇÃO ENTRE DÍGITOS OTP ──
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.otp-digit').forEach((input, idx, all) => {
    input.addEventListener('input', e => {
      // Aceita só dígito
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && idx < all.length - 1) all[idx + 1].focus();
      // Se preencheu todos, tenta confirmar
      const digits = [...all].map(i => i.value).join('');
      if (digits.length === 6) window.verificarOTP();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && idx > 0) all[idx - 1].focus();
      if (e.key === 'Enter') window.verificarOTP();
    });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      [...all].forEach((inp, i) => { inp.value = paste[i] || ''; });
      const last = Math.min(paste.length, all.length - 1);
      all[last].focus();
      if (paste.length === 6) window.verificarOTP();
    });
  });
});

// ── AJUDA ──
window.ajuda = function (e) {
  e.preventDefault();
  alert(
    'Informe seu nome completo e as credenciais do seu PC.\n' +
    'O login e a senha do PC são cadastrados pelo T.I.\n' +
    'Professores também podem fazer login com suas credenciais para abrir chamados de emergência.\n\n' +
    'Técnicos de T.I. recebem um código de 6 dígitos por email após inserir suas credenciais.\n' +
    'Em caso de dúvidas, entre em contato com o suporte.'
  );
};

// ── ENTER NOS CAMPOS ──
['nome', 'usuario', 'senha'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') window.entrar(); });
});