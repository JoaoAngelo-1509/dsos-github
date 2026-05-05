// DSos v1.5 — auth.js
import { SUPABASE_URL, SUPABASE_HEADERS as headers } from './supabase-config.js';
import { applyTheme, updateTemaIcon, toggleTema } from './ui.js';

window.toggleTema = toggleTema;

applyTheme();

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('dsos_tema_login');
  if (saved === 'dark') updateTemaIcon(true);
});

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

function mostrarErro(msg) {
  const erro = document.getElementById('erro');
  erro.textContent = msg;
  erro.classList.add('visivel');
}

function limparErro() {
  document.getElementById('erro').classList.remove('visivel');
}

// Modal de escolha de perfil TI/Professor
function mostrarModalPerfil(tiData, nome) {
  // Remove se já existe
  document.getElementById('modal-perfil')?.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-perfil';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);
    z-index:200;display:flex;align-items:center;justify-content:center;
    animation:fadeIn .2s ease;
  `;
  modal.innerHTML = `
    <div style="
      background:var(--gray-card);border:2px solid var(--gray-border);border-radius:10px;
      width:min(380px,90vw);overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.4);
      animation:cardIn .3s cubic-bezier(.22,1,.36,1) both;
    ">
      <div style="background:var(--red);padding:20px 24px;">
        <div style="font-size:.72rem;color:rgba(255,255,255,.7);margin-bottom:4px;">Olá, ${nome || tiData.nome}</div>
        <div style="font-size:1rem;font-weight:700;color:#fff;">Como deseja entrar?</div>
      </div>
      <div style="padding:20px 24px;display:flex;flex-direction:column;gap:10px;">
        <button id="btn-entrar-ti" style="
          width:100%;padding:13px 16px;background:var(--red);color:#fff;border:none;border-radius:6px;
          font-family:inherit;font-size:.88rem;font-weight:700;cursor:pointer;
          display:flex;align-items:center;gap:10px;transition:background .2s;
        ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Entrar como T.I.
        </button>
        <button id="btn-entrar-prof" style="
          width:100%;padding:13px 16px;background:var(--gray-input);color:var(--text);
          border:1.5px solid var(--gray-border);border-radius:6px;
          font-family:inherit;font-size:.88rem;font-weight:700;cursor:pointer;
          display:flex;align-items:center;gap:10px;transition:all .2s;
        ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>
          Entrar como Professor
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-entrar-ti').addEventListener('mouseenter', e => e.currentTarget.style.background = '#910305');
  document.getElementById('btn-entrar-ti').addEventListener('mouseleave', e => e.currentTarget.style.background = 'var(--red)');
  document.getElementById('btn-entrar-prof').addEventListener('mouseenter', e => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)'; });
  document.getElementById('btn-entrar-prof').addEventListener('mouseleave', e => { e.currentTarget.style.borderColor = 'var(--gray-border)'; e.currentTarget.style.color = 'var(--text)'; });

  document.getElementById('btn-entrar-ti').addEventListener('click', () => {
    sessionStorage.setItem('dsos_session', JSON.stringify({
      tipo: 'ti',
      id: tiData.id,
      login: tiData.login,
      nome: nome
    }));
    window.location.href = 'painel-ti.html';
  });

  document.getElementById('btn-entrar-prof').addEventListener('click', async () => {
    // Busca dados do professor vinculado
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/professor?id=eq.${tiData.professor_id}&select=id,login,nome,disciplina`, { headers });
      const profList = await r.json();
      const prof = Array.isArray(profList) && profList[0] ? profList[0] : null;
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'professor',
        id: prof ? prof.id : tiData.professor_id,
        login: prof ? prof.login : tiData.login,
        nome: nome,
        disciplina: prof ? prof.disciplina : null
      }));
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch(e) {}
      window.location.href = 'painel-pc.html';
    } catch(e) {
      // fallback
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'professor',
        id: tiData.professor_id,
        login: tiData.login,
        nome: nome
      }));
      window.location.href = 'painel-pc.html';
    }
  });
}

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
    // 1. Tenta TI
    const resTI = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_ti`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_login: usuario, p_senha: senha })
    });
    const tiList = await resTI.json();

    if (Array.isArray(tiList) && tiList.length > 0) {
      const ti = tiList[0];

      // Se é professor também, mostra escolha de perfil
      if (ti.is_professor && ti.professor_id) {
        btn.classList.remove('loading');
        mostrarModalPerfil(ti, nome);
        return;
      }

      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'ti',
        id: ti.id,
        login: ti.login,
        nome
      }));
      window.location.href = 'painel-ti.html';
      return;
    }

    // 2. Tenta PC
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
      try { new Audio('../sounds/login.wav').play().catch(() => {}); } catch(e) {}
      window.location.href = 'painel-pc.html';
      return;
    }

    // 3. Tenta Professor
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

window.ajuda = function (e) {
  e.preventDefault();
  alert(
    'Informe seu nome completo e as credenciais do seu PC.\n' +
    'O login e a senha do PC são cadastrados pelo T.I.\n' +
    'Professores também podem fazer login com suas credenciais para abrir chamados de emergência.\n' +
    'Em caso de dúvidas, entre em contato com o suporte.'
  );
};

['nome', 'usuario', 'senha'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') window.entrar(); });
});