// DSos v1.5 — auth.js
// ── auth.js — Lógica de autenticação da página de login ──
import { SUPABASE_URL, SUPABASE_HEADERS as headers } from './supabase-config.js';
import { applyTheme, updateTemaIcon, toggleTema } from './ui.js';

// Expõe toggleTema globalmente para o onclick no HTML
window.toggleTema = toggleTema;

// ── APLICA TEMA SALVO AO CARREGAR ──
applyTheme();

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('dsos_tema_login');
  if (saved === 'dark') {
    updateTemaIcon(true);
  }
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

// ── EXIBE MENSAGEM DE ERRO ──
function mostrarErro(msg) {
  const erro = document.getElementById('erro');
  erro.textContent = msg;
  erro.classList.add('visivel');
}

// ── LIMPA MENSAGEM DE ERRO ──
function limparErro() {
  document.getElementById('erro').classList.remove('visivel');
}

// ── RATE LIMITING ──────────────────────────────────────────────────────────
// Chave local para contagem otimista (reduz chamadas ao banco quando possível)
const _RL_KEY = 'dsos_rl';
let _bloqueioTimer = null;

function _getRLLocal() {
  try { return JSON.parse(localStorage.getItem(_RL_KEY) || 'null'); } catch { return null; }
}
function _setRLLocal(data) {
  localStorage.setItem(_RL_KEY, JSON.stringify(data));
}
function _limparRLLocal() {
  localStorage.removeItem(_RL_KEY);
}

// Obtém IP público de forma leve (fallback 'unknown' se falhar)
async function _getIP() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    return d.ip || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Verifica rate limit no banco
async function _checkRateLimit(identificador, ip) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_check_rate_limit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_identificador: identificador, p_ip: ip })
  });
  return await r.json();
}

// Registra tentativa no banco
async function _registrarTentativa(identificador, ip, sucesso) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_registrar_tentativa`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_identificador: identificador, p_ip: ip, p_sucesso: sucesso })
    });
  } catch { /* silencioso — não bloqueia o fluxo */ }
}

// Inicia o contador regressivo no botão e no campo de erro
function _iniciarContagemRegressiva(segundos) {
  const btn = document.getElementById('btn');
  if (_bloqueioTimer) clearInterval(_bloqueioTimer);

  let restantes = segundos;

  function _atualizar() {
    const min = Math.floor(restantes / 60);
    const seg = String(restantes % 60).padStart(2, '0');
    const label = min > 0 ? `${min}:${seg}` : `${restantes}s`;
    btn.disabled = true;
    btn.querySelector('span').textContent = `Aguarde ${label}`;
    mostrarErro(
      restantes >= 60
        ? `Muitas tentativas. Tente novamente em ${min}m${seg}s.`
        : `Muitas tentativas. Tente novamente em ${restantes}s.`
    );
    if (restantes <= 0) {
      clearInterval(_bloqueioTimer);
      _bloqueioTimer = null;
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Entrar';
      limparErro();
      _limparRLLocal();
    }
    restantes--;
  }

  _atualizar();
  _bloqueioTimer = setInterval(_atualizar, 1000);
}

// Verifica se há bloqueio local ainda ativo ao carregar a página
(function _verificarBloqueioLocalAoCarregar() {
  const rl = _getRLLocal();
  if (!rl || !rl.bloqueadoAte) return;
  const restantes = Math.ceil((rl.bloqueadoAte - Date.now()) / 1000);
  if (restantes > 0) {
    _iniciarContagemRegressiva(restantes);
  } else {
    _limparRLLocal();
  }
})();
// ──────────────────────────────────────────────────────────────────────────

// ── LOGIN PRINCIPAL ──
window.entrar = async function () {
  const nome    = document.getElementById('nome').value.trim();
  const usuario = document.getElementById('usuario').value.trim();
  const senha   = document.getElementById('senha').value;
  const btn     = document.getElementById('btn');

  limparErro();

  // Bloqueia se o timer ainda estiver rodando
  if (_bloqueioTimer) return;

  if (!nome) {
    mostrarErro('Informe seu nome antes de entrar.');
    document.getElementById('nome').focus();
    return;
  }

  if (!usuario || !senha) {
    mostrarErro('Preencha usuário e senha.');
    return;
  }

  btn.classList.add('loading');
  btn.disabled = true;

  // Obtém IP e verifica rate limit
  let ip = 'unknown';
  try {
    ip = await _getIP();
    const rl = await _checkRateLimit(usuario, ip);

    if (rl?.bloqueado) {
      const seg = rl.segundos_restantes || 60;
      _setRLLocal({ bloqueadoAte: Date.now() + seg * 1000 });
      btn.classList.remove('loading');
      _iniciarContagemRegressiva(seg);
      return;
    }
  } catch {
    // Se falhar a checagem, deixa prosseguir (fail-open controlado)
  } finally {
    if (!_bloqueioTimer) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  btn.classList.add('loading');
  btn.disabled = true;

  let loginOk = false;

  try {
    // 1. Tenta login como T.I via RPC segura
    const resTI = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_ti`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_login: usuario, p_senha: senha })
    });
    const tiList = await resTI.json();

    if (Array.isArray(tiList) && tiList.length > 0) {
      loginOk = true;
      await _registrarTentativa(usuario, ip, true);
      _limparRLLocal();
      const ti = tiList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'ti',
        id: ti.id,
        login: ti.login,
        nome
      }));
      window.location.href = 'painel-ti.html';
      return;
    }

    // 2. Tenta login como PC via RPC segura
    const resPC = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_pc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_tag: usuario.toUpperCase(), p_senha: senha })
    });
    const pcList = await resPC.json();

    if (Array.isArray(pcList) && pcList.length > 0) {
      loginOk = true;
      await _registrarTentativa(usuario, ip, true);
      _limparRLLocal();
      const pc = pcList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'pc',
        id: pc.id,
        tag: pc.tag,
        laboratorio: pc.laboratorio,
        lado: pc.lado,
        nome
      }));
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch (e) {}
      window.location.href = 'painel-pc.html';
      return;
    }

    // 3. Tenta login como Professor
    const resProf = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_professor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_login: usuario, p_senha: senha })
    });
    const profList = await resProf.json();

    if (Array.isArray(profList) && profList.length > 0) {
      loginOk = true;
      await _registrarTentativa(usuario, ip, true);
      _limparRLLocal();
      const prof = profList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'professor',
        id: prof.id,
        login: prof.login,
        nome: prof.nome || nome
      }));
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch (e) {}
      window.location.href = 'painel-pc.html';
      return;
    }

    // Nenhum login bateu → registra falha e re-verifica bloqueio
    await _registrarTentativa(usuario, ip, false);

    // Consulta banco para saber se agora está bloqueado
    try {
      const rlApos = await _checkRateLimit(usuario, ip);
      if (rlApos?.bloqueado) {
        const seg = rlApos.segundos_restantes || 60;
        _setRLLocal({ bloqueadoAte: Date.now() + seg * 1000 });
        btn.classList.remove('loading');
        btn.disabled = false;
        _iniciarContagemRegressiva(seg);
        return;
      }
      // Exibe quantas tentativas restam
      const restam = 5 - (rlApos?.tentativas || 0);
      if (restam <= 2 && restam > 0) {
        mostrarErro(`Usuário ou senha incorretos. ${restam} tentativa${restam > 1 ? 's' : ''} restante${restam > 1 ? 's' : ''}.`);
      } else {
        mostrarErro('Usuário ou senha incorretos.');
      }
    } catch {
      mostrarErro('Usuário ou senha incorretos.');
    }

  } catch (e) {
    mostrarErro('Erro de conexão. Tente novamente.');
    console.error(e);
  } finally {
    if (!_bloqueioTimer) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }
};

// ── AJUDA ──
window.ajuda = function (e) {
  e.preventDefault();
  alert(
    'Informe seu nome completo e as credenciais do seu PC.\n' +
    'O login e a senha do PC são cadastrados pelo T.I.\n' +
    'Professores também podem fazer login com suas credenciais para abrir chamados de emergência.\n' +
    'Em caso de dúvidas, entre em contato com o suporte.'
  );
};

// ── ENTER NOS CAMPOS ──
['nome', 'usuario', 'senha'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') window.entrar(); });
});