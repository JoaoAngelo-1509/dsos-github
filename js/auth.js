// DSos v1.3 alpha alpha — auth.js
// ── auth.js — Lógica de autenticação da página de login ──
import { SUPABASE_URL, SUPABASE_HEADERS as headers } from './supabase-config.js';
import { applyTheme, updateTemaIcon, toggleTema } from './ui.js';
import { dsosAlert } from './dsos-ui.js';
import { logger } from './logging.js';
// SEC-05b: instala o envio do X-Sessao-Token antes de qualquer chamada
import { instalarHeaderSessao } from './sessao-header.js';
instalarHeaderSessao();

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

// ── RATE LIMITING VISUAL (complementa o rate limit do banco) ──
// Após 5 tentativas falhas em 5 min, bloqueia o botão por 60s com countdown.
const RL_MAX_TENTATIVAS = 5;
const RL_JANELA_MS      = 5 * 60 * 1000;
const RL_BLOQUEIO_MS    = 60 * 1000;
let _rlTimer = null;

function _rlRegistrarFalha() {
  const agora = Date.now();
  let arr = [];
  try { arr = JSON.parse(sessionStorage.getItem('dsos_login_attempts') || '[]'); } catch { arr = []; }
  arr = arr.filter(t => agora - t < RL_JANELA_MS);
  arr.push(agora);
  sessionStorage.setItem('dsos_login_attempts', JSON.stringify(arr));
  if (arr.length >= RL_MAX_TENTATIVAS) {
    sessionStorage.setItem('dsos_login_block_until', String(agora + RL_BLOQUEIO_MS));
    sessionStorage.removeItem('dsos_login_attempts');
    _rlIniciarBloqueio();
  }
}

function _rlResetar() {
  sessionStorage.removeItem('dsos_login_attempts');
  sessionStorage.removeItem('dsos_login_block_until');
}

// Retorna true se ainda está bloqueado (e inicia/atualiza o countdown).
function _rlBloqueado() {
  const ate = parseInt(sessionStorage.getItem('dsos_login_block_until') || '0', 10);
  if (Date.now() < ate) { _rlIniciarBloqueio(); return true; }
  return false;
}

function _rlIniciarBloqueio() {
  const btn = document.getElementById('btn');
  if (_rlTimer) clearInterval(_rlTimer);
  const tick = () => {
    const ate = parseInt(sessionStorage.getItem('dsos_login_block_until') || '0', 10);
    const restante = Math.ceil((ate - Date.now()) / 1000);
    if (restante <= 0) {
      clearInterval(_rlTimer); _rlTimer = null;
      sessionStorage.removeItem('dsos_login_block_until');
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = 'Entrar';
      limparErro();
      return;
    }
    btn.disabled = true;
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = `Aguarde ${restante}s`;
    mostrarErro(`Muitas tentativas. Tente novamente em ${restante}s.`);
  };
  tick();
  _rlTimer = setInterval(tick, 1000);
}

// ── VALIDAÇÃO DE NOME VIA GROQ ──
// Recebe o token de sessão porque a groq-proxy passou a exigir sessão (L7):
// antes ela era aberta, e QUALQUER pessoa consumia a cota da Groq do projeto
// só abrindo a tela de login e digitando um nome — sem ter conta.
//
// O token é passado explicitamente em vez de vir do interceptor de
// sessao-header.js porque, no ponto em que esta função roda, a sessão AINDA
// NÃO foi gravada no sessionStorage (só é gravada depois que o nome passa).
// O interceptor não encontra token e devolve a requisição intacta, então o
// header explícito sobrevive.
async function validarNome(nome, token) {
  console.log('[validarNome] Iniciando validação para:', nome);
  try {
    const url = `${SUPABASE_URL}/functions/v1/groq-proxy`;
    const payload = {
      model: 'openai/gpt-oss-20b',
      temperature: 0,
      // gpt-oss-20b é um modelo de raciocínio: gasta tokens "pensando" antes
      // de escrever a resposta final. Com 200 tokens ele estourava o limite
      // ainda no raciocínio (~198 tokens) e nunca chegava a escrever
      // SIM/NÃO — sempre caía no fallback de "resposta ambígua". O raciocínio
      // varia bastante por entrada (visto 89 a 546 tokens em produção) — 1000
      // dá margem confortável mesmo nos casos mais "difíceis" para o modelo.
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: `Responda SEMPRE em português brasileiro. SIM (nome real) ou NÃO (teste/admin/número/aleatório). Uma palavra.`
        },
        { role: 'user', content: nome }
      ]
    };
    console.log('[validarNome] URL:', url);
    console.log('[validarNome] Payload:', payload);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'X-Sessao-Token': token || '' },
      body: JSON.stringify(payload)
    });
    console.log('[validarNome] HTTP Status:', resp.status);

    if (!resp.ok) {
      console.error('[validarNome] HTTP erro:', resp.status);
      const errText = await resp.text();
      console.error('[validarNome] Erro body:', errText);
      return true;
    }

    const data = await resp.json();
    console.log('[validarNome] JSON resposta:', JSON.stringify(data));

    const raw = data.choices?.[0]?.message?.content || '';
    console.log('[validarNome] Content extraído:', raw);

    const normalized = raw.toUpperCase();
    const ehSim = normalized.includes('SIM');
    const ehNao = normalized.includes('NAO') || normalized.includes('NÃO');

    console.log('[validarNome] ehSim:', ehSim, 'ehNao:', ehNao);

    if (ehSim && !ehNao) return true;
    if (ehNao && !ehSim) return false;

    console.warn('[validarNome] Resposta ambígua:', raw);
    return true;
  } catch (e) {
    console.error('[validarNome] Exception:', e.message, e);
    return true;
  }
}

// ── AUTENTICAÇÃO ──
// Tenta os três tipos de conta, na ordem, e para no primeiro que casar.
// Extraída de `entrar` quando a ordem do login foi invertida: agora a senha é
// conferida ANTES da validação do nome, e o resultado precisa ser devolvido
// para quem coordena as duas etapas.
async function _autenticar(usuario, senha) {
  const resTI = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_ti`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_login: usuario, p_senha: senha })
  });
  const tiList = await resTI.json();
  if (Array.isArray(tiList) && tiList.length > 0) return { tipo: 'ti', d: tiList[0] };

  const resPC = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_pc`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_tag: usuario.toUpperCase(), p_senha: senha })
  });
  const pcList = await resPC.json();
  if (Array.isArray(pcList) && pcList.length > 0) return { tipo: 'pc', d: pcList[0] };

  const resProf = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_login_professor`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_login: usuario, p_senha: senha })
  });
  const profList = await resProf.json();
  if (Array.isArray(profList) && profList.length > 0) return { tipo: 'professor', d: profList[0] };

  return null;
}

// ── LOGIN PRINCIPAL ──
window.entrar = async function () {
  const nome    = document.getElementById('nome').value.trim();
  const usuario = document.getElementById('usuario').value.trim();
  const senha   = document.getElementById('senha').value;
  const btn     = document.getElementById('btn');

  // Rate limiting: se ainda está no período de bloqueio, nem tenta.
  if (_rlBloqueado()) return;

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
  btn.querySelector('span').textContent = 'Entrando…';

  try {
    // ── ORDEM: SENHA PRIMEIRO, NOME DEPOIS ──────────────────────────────
    // Era o contrário: o nome ia para a Groq ANTES de qualquer credencial ser
    // conferida. Como a groq-proxy também não exigia sessão (L7), qualquer
    // pessoa gastava a cota da Groq do projeto só abrindo a tela de login e
    // digitando um nome — sem ter conta, sem acertar senha nenhuma.
    //
    // Conferindo a senha primeiro, a chamada à Groq só acontece para quem já
    // provou ser dono de uma conta, e nesse ponto existe um token de sessão
    // para mandar junto. Foi isso que permitiu fechar a groq-proxy sem
    // quebrar o login (limitar por IP não servia: num laboratório todas as
    // máquinas saem pelo mesmo IP público, e a sala inteira estouraria a cota
    // no começo da aula).
    //
    // Efeito colateral aceito: com nome falso E senha errada, o erro agora é
    // "usuário ou senha incorretos" em vez de "informe seu nome real". É
    // melhor assim — o sistema para de comentar o nome de quem nem provou ter
    // conta.
    const conta = await _autenticar(usuario, senha);

    if (!conta) {
      await logger.logLoginFalho(usuario, 'usuario ou senha incorretos');
      _rlRegistrarFalha();
      mostrarErro('Usuário ou senha incorretos.');
      return;
    }

    _rlResetar();

    // Nome só agora, já com o token em mãos.
    btn.querySelector('span').textContent = 'Verificando nome…';
    const nomeValido = await validarNome(nome, conta.d.token);
    if (!nomeValido) {
      // O token emitido aqui fica órfão em sessao_token até expirar (12h).
      // Não é problema: quem chegou até aqui provou a senha, e fn_emitir_token
      // poda os expirados a cada novo login. O que importa é que a sessão NÃO
      // é gravada no navegador — sem isso, nenhuma tela abre.
      mostrarErro('Informe seu nome real para continuar.');
      document.getElementById('nome').focus();
      return;
    }

    btn.querySelector('span').textContent = 'Entrando…';

    // ── 1. T.I. ──
    if (conta.tipo === 'ti') {
      const ti = conta.d;
      if (ti.is_professor && ti.professor_id) {
        btn.classList.remove('loading');
        _pendingTI = { ti, nome };
        document.getElementById('escolha-nome-label').textContent = ti.nome || nome;
        const modal = document.getElementById('modal-escolha-bg');
        modal.style.display = 'flex';
        return;
      }
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'ti',
        id: ti.id,
        login: ti.login,
        nome: ti.nome || nome,
        // SEC-05: token de sessão emitido pelo banco no login. É o que prova
        // ao servidor QUEM está chamando nas escritas sensíveis — o resto da
        // sessão (id/login/tipo) é editável pelo próprio usuário e por isso
        // não serve como autorização.
        token: ti.token
      }));
      await logger.logLogin(ti.id, 'ti', ti.login, ti.nome || nome);
      window.location.href = 'painel-ti.html';
      return;
    }

    // ── 2. PC ──
    if (conta.tipo === 'pc') {
      const pc = conta.d;
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'pc',
        id: pc.id,
        tag: pc.tag,
        laboratorio: pc.laboratorio,
        lado: pc.lado,
        nome,
        token: pc.token   // SEC-05
      }));
      // Log de login bem-sucedido
      await logger.logLogin(pc.id, 'pc', pc.tag, nome);
      try { new Audio('../sounds/login.mp3').play().catch(()=>{}); } catch(e){}
      window.location.href = 'painel-pc.html';
      return;
    }

    // ── 3. Professor ──
    if (conta.tipo === 'professor') {
      const prof = conta.d;
      sessionStorage.setItem('dsos_session', JSON.stringify({
        tipo: 'professor',
        id: prof.id,
        login: prof.login,
        nome: prof.nome || nome,
        token: prof.token   // SEC-05
      }));
      // Log de login bem-sucedido
      await logger.logLogin(prof.id, 'professor', prof.login, prof.nome || nome);
      try { new Audio('../sounds/login.mp3').play().catch(()=>{}); } catch(e){}
      window.location.href = 'painel-pc.html';
      return;
    }

  } catch (e) {
    await logger.logLoginFalho(usuario, `erro de conexão: ${e.message}`);
    mostrarErro('Erro de conexão. Tente novamente.');
    console.error(e);
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = 'Entrar';
  }
};

// ── ESCOLHA TI / PROFESSOR ──
let _pendingTI = null;
window.escolherTipo = async function (tipo) {
  if (!_pendingTI) return;
  const { ti, nome } = _pendingTI;
  document.getElementById('modal-escolha-bg').style.display = 'none';
  if (tipo === 'ti') {
    sessionStorage.setItem('dsos_session', JSON.stringify({
      tipo: 'ti',
      id: ti.id,
      login: ti.login,
      nome: ti.nome || nome,
      professor_id: ti.professor_id || null,
      token: ti.token   // SEC-05
    }));
    await logger.logLogin(ti.id, 'ti', ti.login, nome);
    window.location.href = 'painel-ti.html';
  } else {
    sessionStorage.setItem('dsos_session', JSON.stringify({
      tipo: 'professor',
      id: ti.professor_id,
      login: ti.login,
      nome: ti.nome || nome,
      // SEC-05: mantém o token emitido por rpc_login_ti. Quem chega aqui é um
      // T.I. que também é professor e escolheu entrar como professor — o
      // token continua provando um login legítimo, e as RPCs de escrita de
      // professor aceitam tanto 'professor' quanto 'ti' justamente por isso.
      token: ti.token
    }));
    await logger.logLogin(ti.professor_id, 'professor', ti.login, ti.nome || nome);
    window.location.href = 'painel-pc.html';
  }
  _pendingTI = null;
};

// ── AJUDA ──
window.ajuda = async function (e) {
  e.preventDefault();
  await dsosAlert({
    msg:
      'Como fazer login:\n' +
      '• Informe seu nome completo no primeiro campo.\n' +
      '• Digite o usuário e a senha do seu PC (cadastrados pelo T.I.).\n' +
      '• Professores usam suas credenciais próprias para abrir chamados de emergência.\n\n' +
      'Esqueceu a senha?\n' +
      'As senhas são gerenciadas pelo T.I. — procure um técnico pessoalmente ou abra um chamado de emergência de outro PC.',
    tipo: 'info',
    titulo: 'Como fazer login',
  });
};

// ── ENTER NOS CAMPOS ──
['nome', 'usuario', 'senha'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') window.entrar(); });
});