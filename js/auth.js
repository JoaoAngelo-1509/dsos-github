// DSos v1.3 alpha alpha — auth.js
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

// ── LOGIN PRINCIPAL ──
window.entrar = async function () {
  const nome    = document.getElementById('nome').value.trim();
  const usuario = document.getElementById('usuario').value.trim();
  const senha   = document.getElementById('senha').value;
  const btn     = document.getElementById('btn');

  limparErro();

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

  try {
    // 1. Tenta login como T.I via RPC segura
    const resTI = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_ti`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_login: usuario, p_senha: senha })
    });
    const tiList = await resTI.json();

    if (Array.isArray(tiList) && tiList.length > 0) {
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
      const pc = pcList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'pc',
        id: pc.id,
        tag: pc.tag,
        laboratorio: pc.laboratorio,
        lado: pc.lado,
        nome
      }));
      try { new Audio('../sounds/login.wav').play().catch(()=>{}); } catch(e){}
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
      const prof = profList[0];
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'professor',
        id: prof.id,
        login: prof.login,
        nome: prof.nome || nome
      }));
      try { new Audio('../sounds/login.wav').play().catch(()=>{}); } catch(e){}
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