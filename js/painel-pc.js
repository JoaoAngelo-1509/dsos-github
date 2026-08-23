// DSos v1.6 — painel-pc.js com Logging Completo
import { SB_URL, SB_KEY, H } from './supabase-config.js';
import { dsosAlert } from './dsos-ui.js';
import { escapeHtml, tipoIcon, statusLabel } from './ui.js';
import { rtStatusHandler } from './realtime-manager.js';
import { initSessionGuard } from './session-guard.js';

const sbClient = supabase.createClient(SB_URL, SB_KEY);
let realtimeChannel = null;

let session=null, tipo=null, emergAtivo=false, tickets=[], chatTicketId=null;

// ─────────────────────────────────────────────────────────────────────────
// LOGGING: Função auxiliar para registrar eventos (fail-safe)
// ─────────────────────────────────────────────────────────────────────────
async function _logEvent(rpcName, params = {}) {
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(params)
    });
  } catch (e) {
    // Falhas de logging não afetam operação do usuário
    console.warn(`[DSos Logging] Erro ao registrar ${rpcName}:`, e.message);
  }
}

// ── DETECÇÃO DE CHAMADO DUPLICADO ────────────────────────────────────────────
function _similaridade(a, b) {
  const words = s => new Set(s.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w => w.length > 2));
  const wa = words(a), wb = words(b);
  const intersect = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersect / union;
}

async function _verificarDuplicata(desc, pcId) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/ticket?pc_problema=eq.${pcId}&status=in.(aberto,em_andamento)&select=descricao,aberto_em&order=aberto_em.desc&limit=3`,
      { headers: H }
    );
    if (!r.ok) return false;
    const tickets = await r.json();
    for (const t of tickets) {
      if (!t.descricao || t.descricao === '(chamado rápido)') continue;
      if (_similaridade(desc, t.descricao) >= 0.6) return true;
    }
    return false;
  } catch {
    return false;
  }
}
// ──────────────────────────────────────────────────────────────────────────

// ── CLASSIFICAÇÃO DE PRIORIDADE VIA GROQ AI ──────────────────────────────────

async function _groqCall(messages, maxTokens = 2048) {
  const resp = await fetch(`${SB_URL}/functions/v1/groq-proxy`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ model: 'openai/gpt-oss-20b', temperature: 0, max_tokens: maxTokens, messages })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error('Groq ' + resp.status + ': ' + (err?.error?.message || ''));
  }
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

// Retorna { prioridade, tipo, sugestao } — uma única chamada para os três
async function classificarChamado(descricao) {
  if (!descricao || descricao === '(chamado rápido)') return { prioridade: 'medio', tipo: null };
  try {
    const txt = (await _groqCall([
      {
        role: 'system',
        content: `Você é um técnico de TI especialista em português brasileiro analisando chamados de suporte em uma escola pública. Responda SEMPRE em português e com exatamente este formato e nada mais:

TIPO: <hardware|software|rede|outro>
PRIORIDADE: <baixo|medio|alto|falso|emergencia>
SUGESTAO: <veja regras abaixo>

=== REGRAS DE TIPO ===
hardware: problema físico — PC não liga, tela sem imagem, teclado/mouse não funciona, fonte, HD com barulho, monitor quebrado
software: sistema ou programas — programa não abre, tela azul, Windows travado, vírus suspeito, erro ao salvar
rede: conectividade — sem internet, sem acesso à rede local, Wi-Fi caindo
outro: impressoras, projetores, ar-condicionado, qualquer coisa que não se encaixe acima

=== REGRAS DE PRIORIDADE ===
emergencia: risco físico REAL e imediato (fumaça, cheiro de queimado, choque elétrico, faísca, alguém machucado)
alto: PC completamente inutilizável, impede a aula inteira
medio: problema atrapalha mas PC ainda tem uso parcial
baixo: problema leve, estético, cosmético ou que pode esperar
falso: tudo que não é claramente um problema de TI — xingamentos, palavrões, frases sem sentido, emojis, testes, brincadeiras, reclamações pessoais, problemas físicos da sala (cadeira, porta, lâmpada), pedidos de matéria escolar, nomes de pessoas, textos aleatórios

=== REGRAS DE SUGESTAO ===
Se PRIORIDADE for "emergencia" ou "falso": escreva exatamente a palavra nenhuma

Para as demais prioridades, liste de 2 a 3 ações IMEDIATAS que qualquer aluno ou professor consegue fazer sozinho, em português simples. Exemplos de ações válidas:
- Pressione a tecla Caps Lock para ativar/desativar maiúsculas (NÃO "segure Shift")
- Feche o programa e abra novamente
- Reinicie o PC pelo menu Iniciar > Ligar/Desligar > Reiniciar
- Verifique se o cabo de rede está bem encaixado atrás do PC e no switch
- Tente abrir outro programa para ver se o problema é só neste
- Aguarde 2 minutos e tente novamente

PROIBIDO nas sugestões: modo seguro, modo de recuperação, antivírus, drivers, reinstalar, desinstalar, painel de controle, editor de registro, prompt de comando, abrir o gabinete, trocar peças, qualquer configuração do sistema operacional, qualquer coisa que exija administrador.
PROIBIDO: terminar com "chame o técnico" ou "entre em contato com o suporte".
Se não houver ação segura e simples: escreva nenhuma`
      },
      { role: 'user', content: `Chamado de suporte:\n"${descricao}"` }
    ])).toLowerCase();

    // Regexes robustas: aceitam acento (ã), bold markdown (**), espaços
    const tipoMatch = txt.match(/\*{0,2}tipo\*{0,2}\s*:\s*\*{0,2}\s*(hardware|software|rede|outro)/);
    const priMatch  = txt.match(/\*{0,2}prioridade\*{0,2}\s*:\s*\*{0,2}\s*(baixo|medio|alto|falso|emergencia)/);
    const sugMatch  = txt.match(/\*{0,2}sugest[aã]o\*{0,2}\s*:\s*\*{0,2}\s*([\s\S]+)/);
    const sugestao  = sugMatch ? sugMatch[1].replace(/\*{1,2}/g,'').trim() : '';
    return {
      tipo:       tipoMatch ? tipoMatch[1] : null,
      prioridade: priMatch  ? priMatch[1]  : 'medio',
      sugestao:   (sugestao === 'nenhuma' || sugestao === 'none' || sugestao === '') ? '' : sugestao,
    };
  } catch {
    return { prioridade: 'medio', tipo: null, sugestao: '' };
  }
}

async function classificarPrioridade(descricao) {
  return (await classificarChamado(descricao)).prioridade;
}

window._fecharSugestao = function() {
  document.getElementById('ai-sugestao-card')?.classList.add('hidden');
};

function _exibirSugestaoAI(sugestao, prioridade) {
  const card = document.getElementById('ai-sugestao-card');
  if (!card) return;
  if (!sugestao || ['falso', 'emergencia'].includes(prioridade)) {
    card.classList.add('hidden');
    return;
  }
  document.getElementById('ai-sugestao-txt').textContent = sugestao;
  card.classList.add('hidden');
  requestAnimationFrame(() => card.classList.remove('hidden'));
}

let _aiDebounceTimer = null;
let _aiUltimaDesc = '';
let _aiUltimoResultado = null;

function _atualizarBadgeAI(descricao, tipo) {
  const badge = document.getElementById('ai-prioridade-badge');
  if (!badge) return;
  clearTimeout(_aiDebounceTimer);
  if (!descricao || descricao.length < 10) {
    badge.className = 'ai-badge hidden';
    _aiUltimaDesc = '';
    _aiUltimoResultado = null;
    document.getElementById('ai-sugestao-card')?.classList.add('hidden');
    // reseta seletor de tipo
    tipo = null;
    document.querySelectorAll('.sel-opt').forEach(o => o.classList.remove('active'));
    document.querySelectorAll('.sel-t-icon').forEach(i => i.style.display = 'none');
    document.getElementById('sel-val').textContent = '';
    document.getElementById('sel-trigger').classList.remove('valued');
    return;
  }
  // Só reclassifica se mudou mais de 30% em relação à última classificação
  if (_aiUltimoResultado && _similaridade(descricao, _aiUltimaDesc) >= 0.7) return;

  clearTimeout(_aiDebounceTimer);
  _aiDebounceTimer = setTimeout(async () => {
    badge.className = 'ai-badge loading';
    badge.textContent = '⏳ Classificando…';
    const resultado = await classificarChamado(descricao);
    const { prioridade: p, tipo: tipoDetectado, sugestao } = resultado;
    _aiUltimaDesc = descricao;
    // PERF-02: guarda o resultado COMPLETO (antes só a prioridade), para que
    // abrirChamado possa reaproveitá-lo em vez de classificar tudo de novo
    _aiUltimoResultado = resultado;
    if (tipoDetectado) {
      const opt = document.querySelector(`.sel-opt[data-v="${tipoDetectado}"]`);
      if (opt) window.pickTipo(opt);
    }
    const labels = { alto: '🔴 Prioridade Alta', medio: '🟡 Prioridade Média', baixo: '🟢 Prioridade Baixa', falso: '⚠️ Possível falso alarme', emergencia: '🚨 EMERGÊNCIA DETECTADA' };
    badge.className = `ai-badge pri-${p}`;
    badge.textContent = labels[p] || '🟡 Prioridade Média';
    _exibirSugestaoAI(sugestao, p);
  }, 2500);
}
// ──────────────────────────────────────────────────────────────────────────

// ── RATE LIMITING DE TICKETS ───────────────────────────────────────────────
// Verifica no banco se o solicitante atingiu 5 aberturas nos últimos 5 minutos.
// Emergências (chamado_emergencia = true) nunca são verificadas.
async function _checkTicketRateLimit() {
  try {
    const body = session.tipo === 'professor'
      ? { p_professor_login: session.nome || session.login }
      : { p_pc_id: session.id };

    const r = await fetch(`${SB_URL}/rest/v1/rpc/rpc_check_ticket_rate_limit`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch {
    // Falha na checagem → não bloqueia (fail-open)
    return { bloqueado: false };
  }
}

// Exibe mensagem de bloqueio com contador regressivo no elemento de toast
let _ticketRLTimer = null;
function _exibirBloqueioTicket(segundos) {
  if (_ticketRLTimer) clearInterval(_ticketRLTimer);
  let restantes = segundos;

  function _atualizar() {
    const min = Math.floor(restantes / 60);
    const seg = String(restantes % 60).padStart(2, '0');
    const label = min > 0 ? `${min}:${seg}` : `${restantes}s`;
    toast(`Limite atingido. Aguarde ${label} para abrir novo chamado.`, 'err');
    if (restantes <= 0) {
      clearInterval(_ticketRLTimer);
      _ticketRLTimer = null;
    }
    restantes--;
  }

  _atualizar();
  _ticketRLTimer = setInterval(_atualizar, 1000);
}
// ──────────────────────────────────────────────────────────────────────────

// Aplica modo hacker globalmente
(function _aplicarHacker(){
  if(localStorage.getItem('dsos_hacker')==='1')
    document.documentElement.dataset.hacker='1';
})();

window.toggleHacker=function(){
  const html=document.documentElement,on=html.dataset.hacker==='1';
  on?delete html.dataset.hacker:(html.dataset.hacker='1');
  localStorage.setItem('dsos_hacker',on?'0':'1');
  const cb=document.getElementById('cfg-hacker-pc');if(cb)cb.checked=!on;
};
window.abrirConfigPc=function(){
  const cb=document.getElementById('cfg-hacker-pc');
  if(cb)cb.checked=localStorage.getItem('dsos_hacker')==='1';
  document.getElementById('modal-config-pc')?.classList.add('open');
};
window.fecharConfigPc=function(){
  document.getElementById('modal-config-pc')?.classList.remove('open');
};

window.addEventListener('DOMContentLoaded', async () => {
  const temaSalvo = localStorage.getItem('dsos_tema_login');
  if (temaSalvo === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.getElementById('ico-tema').innerHTML = _icoSol();
  }

  const raw = sessionStorage.getItem('dsos_session');
  if (!raw) { window.location.href = 'login.html'; return; }
  session = JSON.parse(raw);
  if (session.tipo !== 'pc' && session.tipo !== 'professor') { window.location.href = 'login.html'; return; }

  // Logout automático por inatividade (30min, aviso aos 28min)
  initSessionGuard({onLogout:()=>window.sair()});

  // ── Heartbeat de sessão ──
  const _pingUrl = `${SB_URL}/rest/v1/rpc/rpc_sessao_ping?apikey=${SB_KEY}`;
  const _encUrl  = `${SB_URL}/rest/v1/rpc/rpc_sessao_encerrar?apikey=${SB_KEY}`;
  function _pingBody(){ return JSON.stringify({p_usuario_id:session.id,p_usuario_tipo:session.tipo,p_usuario_login:session.login||session.tag||'',p_usuario_nome:session.nome||''}); }
  fetch(_pingUrl,{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`},body:_pingBody()}).catch(()=>{});
  setInterval(()=>fetch(_pingUrl,{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`},body:_pingBody()}).catch(()=>{}),30000);
  window.addEventListener('beforeunload',()=>navigator.sendBeacon(_encUrl,new Blob([JSON.stringify({p_usuario_id:session.id,p_usuario_tipo:session.tipo})],{type:'application/json'})));

  if (session.tipo === 'professor') {
    document.getElementById('info-nome').textContent  = session.nome || session.login;
    document.getElementById('badge-pc').textContent   = 'PROF';
    document.getElementById('info-lab').textContent   = '—';
    document.getElementById('info-lado').textContent  = '—';
    document.getElementById('footer-lab').textContent = '—';
    document.getElementById('footer-lado').textContent= '—';
    window.toggleEmerg();
    await carregarChamados();
    _iniciarPollPC();
    return;
  }

  document.getElementById('info-nome').textContent    = session.nome || session.tag;
  document.getElementById('badge-pc').textContent     = session.tag  || '—';
  document.getElementById('info-lab').textContent     = session.laboratorio || '—';
  document.getElementById('info-lado').textContent    = session.lado || '—';
  document.getElementById('footer-lab').textContent   = session.laboratorio || '—';
  document.getElementById('footer-lado').textContent  = session.lado || '—';
  document.getElementById('emerg').style.display      = 'none';
  document.querySelector('.divisor').style.display    = 'none';

  try {
    const rpc = await fetch(`${SB_URL}/rest/v1/v_pc_pub?id=eq.${session.id}&select=status_pc`, { headers: H });
    const pcData = await rpc.json();
    if (Array.isArray(pcData) && pcData[0]) {
      const st = pcData[0].status_pc;
      if (st === 'em_manutencao') {
        const b = document.getElementById('pc-status-banner');
        document.getElementById('pc-status-msg').textContent = 'Atenção: este PC está registrado como em manutenção. Você ainda pode abrir chamados, mas o T.I. já pode estar ciente do problema.';
        b.classList.add('visible','manutencao');
      } else if (st === 'descartado') {
        const b = document.getElementById('pc-status-banner');
        document.getElementById('pc-status-msg').textContent = 'Este PC está registrado como DESCARTADO. Não é possível abrir chamados. Entre em contato com o T.I.';
        b.classList.add('visible','descartado');
        document.getElementById('btn-submit').disabled = true;
      }
    }
  } catch(e) { /* silencioso */ }

  // Atualiza badge de prioridade AI enquanto usuário digita
  document.getElementById('descricao')?.addEventListener('input', function() {
    _atualizarBadgeAI(this.value.trim(), tipo);
  });

  await carregarChamados();
  _iniciarPollPC();
  _carregarMediasResolucao();
});

let _pollPC=null;
function _iniciarPollPC(){
  if(_pollPC)return;
  _pollPC=setInterval(carregarChamados,30000);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){clearInterval(_pollPC);_pollPC=null;}
    else{carregarChamados();_pollPC=setInterval(carregarChamados,30000);}
  },{once:false});
}

function _icoSol(){return`<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`}
function _icoLua(){return`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`}

window.toggleTema = function() {
  const html = document.documentElement, dark = html.dataset.theme === 'dark';
  html.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('dsos_tema_login', html.dataset.theme);
  document.getElementById('ico-tema').innerHTML = dark ? _icoSol() : _icoLua();
};

window.atualizarContadorChat = function(inp, contId) {
  document.getElementById(contId).textContent = inp.value.length;
};


window.trocarAba = function(aba) {
  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.remove('active');
    // A11Y-01: mantém aria-selected em sincronia com a classe .active
    if(t.hasAttribute('role')) t.setAttribute('aria-selected','false');
  });
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const tabNova = document.getElementById('tab-'+aba);
  tabNova.classList.add('active');
  if(tabNova.hasAttribute('role')) tabNova.setAttribute('aria-selected','true');
  document.getElementById('view-'+aba).classList.add('active');
};

let buscaTimer=null;
window.buscaChamados = function(q) {
  clearTimeout(buscaTimer);buscaTimer=setTimeout(()=>carregarChamados(q),350);
};

async function carregarChamados(q='') {
  try{
    const filtroBase=session.tipo==='professor'
      ?`nome_solicitante=eq.${encodeURIComponent(session.nome)}`
      :`pc_origem=eq.${encodeURIComponent(session.id)}`;
    const searchFilter=q?`&or=(descricao.ilike.*${encodeURIComponent(q)}*,laboratorio.ilike.*${encodeURIComponent(q)}*,tipo.ilike.*${encodeURIComponent(q)}*)`:'';
    const r=await fetch(`${SB_URL}/rest/v1/ticket?${filtroBase}${searchFilter}&order=aberto_em.desc&select=*`,{headers:H});
    const data=await r.json();tickets=Array.isArray(data)?data:[];
  }catch(e){tickets=[];}
  // Busca não lidas do PC
  try{
    const r=await fetch(`${SB_URL}/rest/v1/rpc/rpc_nao_lidas_por_ticket`,{method:'POST',headers:H,body:'{}'});
    const nl=await r.json();
    window._naoLidasPC={};
    if(Array.isArray(nl))nl.forEach(x=>{window._naoLidasPC[x.ticket_id]=parseInt(x.nao_lidas_pc)||0});
  }catch(e){window._naoLidasPC={};}
  renderChamados();
}

function renderChamados() {
  const list=document.getElementById('ticket-list'),badge=document.getElementById('tab-badge');
  const ativos=tickets.filter(t=>t.status==='aberto'||t.status==='em_andamento').length;
  badge.textContent=ativos||tickets.length;badge.classList.toggle('zero',ativos===0);
  if(!tickets.length){
    const quem=session.tipo==='professor'?'para você':'para este PC';
    list.innerHTML=`<div class="empty"><div class="eicon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div><p>Nenhum chamado encontrado ${quem}.<br>Vá em <strong>Abrir Chamado</strong> para criar um.</p></div>`;
    return;
  }
  list.innerHTML=tickets.map(t=>{
    const podeChat=t.status==='aberto'||t.status==='em_andamento';
    const hora=t.aberto_em?new Date(t.aberto_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    const nl=window._naoLidasPC?.[t.id]||0;
    const nlBadge=nl>0&&podeChat?`<span class="ticket-unread-badge-pc visible"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ${nl}</span>`:'';
    return`<div class="ticket-card ${t.status}" onclick="${podeChat?`abrirChat(${t.id})`:`abrirDetalhes(${t.id})`}" style="position:relative">
      <div class="t-icon">${tipoIcon(t.tipo)}</div>
      <div class="t-info"><div class="t-title">${_esc(t.tipo||'—')}</div><div class="t-meta">#${t.id} · ${_esc(t.laboratorio||'—')} Lado ${_esc(t.lado||'—')}</div></div>
      <div class="t-right">
        <span class="status-pill pill-${t.status}">${statusLabel(t.status)}</span>
        <span class="t-time">${hora}</span>
        ${podeChat
          ?`<button class="btn-chat-ticket" onclick="event.stopPropagation();abrirChat(${t.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Chat</button>`
          :`<span class="t-enc"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></span>`
        }
        ${nlBadge}
      </div>
    </div>`;
  }).join('');
}

// DUP-01: tipoIcon e statusLabel eram reimplementados aqui, byte a byte
// iguais aos de ui.js (a versão de lá inclui também o ícone de 'periferico',
// que faltava nesta cópia). Agora vêm de ui.js — ver import no topo.

window.abrirChat    = function(id) { const t=tickets.find(x=>x.id===id); if(t) _abrirModal(t); };
window.abrirDetalhes = function(id) { const t=tickets.find(x=>x.id===id); if(t) _abrirModal(t); };

async function _abrirModal(t) {
  chatTicketId=t.id;
  const podeChat=t.status==='aberto'||t.status==='em_andamento';
  document.getElementById('m-title').textContent=`#${t.id} — ${t.tipo||'—'}`;
  const hora=t.aberto_em?new Date(t.aberto_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
  document.getElementById('m-meta-hora').innerHTML=`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${hora}`;
  document.getElementById('m-meta-lab').textContent=`${t.laboratorio||'—'} Lado ${t.lado||'—'}`;
  document.getElementById('m-desc').textContent=t.descricao||'(sem descrição)';
  const pill=document.getElementById('m-status-pill');pill.textContent=statusLabel(t.status);pill.className=`status-pill pill-${t.status}`;
  const resBlock=document.getElementById('m-resolucao');
  if(t.resolucao){
    const resMap={consertado:'Consertado',descarte:'Enviado para descarte',aguardando_peca:'Aguardando peça'};
    document.getElementById('m-res-tipo').textContent=resMap[t.resolucao]||t.resolucao;
    document.getElementById('m-res-item').textContent=t.item_descartado?`Item: ${t.item_descartado}`:'';
    resBlock.classList.add('visivel');
  }else resBlock.classList.remove('visivel');
  document.getElementById('chat-input').disabled=!podeChat;
  document.getElementById('btn-send').disabled=!podeChat;
  document.getElementById('chat-input').placeholder=podeChat?'Escreva sua mensagem...':'Chamado encerrado — chat desabilitado.';
  const btnImg=document.getElementById('btn-img-attach');
  if(btnImg)btnImg.disabled=!podeChat;
  document.getElementById('modal-chat').classList.add('open');
  await carregarMsgs(t.id);
  _iniciarRealtime(t.id);
  if(podeChat)_marcarLidoPC(t.id);
}

async function _marcarLidoPC(ticketId){
  try{
    await fetch(`${SB_URL}/rest/v1/rpc/rpc_marcar_lido_pc`,{method:'POST',headers:H,body:JSON.stringify({p_ticket_id:ticketId})});
    if(window._naoLidasPC)window._naoLidasPC[ticketId]=0;
    renderChamados();
  }catch(e){console.error('marcarLidoPC',e)}
}

async function carregarMsgs(ticketId) {
  try{
    const r=await fetch(`${SB_URL}/rest/v1/mensagem?ticket_id=eq.${ticketId}&order=enviado_em.asc&select=*`,{headers:H});
    const msgs=await r.json();
    const chat=document.getElementById('chat-msgs');
    if(!Array.isArray(msgs)||!msgs.length){chat.innerHTML=`<div class="chat-empty">Nenhuma mensagem ainda.<br>Escreva para iniciar o atendimento.</div>`;return}

    const tick1=`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const tick2=`<svg width="16" height="11" viewBox="0 0 30 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 9 8 15 18 4"/><polyline points="12 9 18 15 28 4"/></svg>`;

    chat.innerHTML=msgs.map(m=>{
      const deTI=m.remetente==='TI'||m.remetente==='ti';
      const de=deTI?'ti':'pc';
      const hora=m.enviado_em?new Date(m.enviado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
      const nomeRem=deTI?(m.nome_remetente||'T.I.'):(m.nome_remetente||session.nome||'Você');
      const imgHtml=m.imagem_url?`<img class="msg-img" src="${_esc(m.imagem_url)}" alt="print" onclick="abrirLightbox('${_esc(m.imagem_url)}')" />`:'';
      const textoHtml=m.conteudo?`<div class="msg-bubble">${_esc(m.conteudo)}</div>`:'';
      const tickHtml=(!deTI)?`<span class="msg-tick${m.lido_ti?' lido':''}">${m.lido_ti?tick2:tick1}</span>`:'';
      return`<div class="msg ${de}">${imgHtml}${textoHtml}<div class="msg-meta">${_esc(nomeRem)} · ${hora} ${tickHtml}</div></div>`;
    }).join('');
    chat.scrollTop=chat.scrollHeight;
  }catch(e){console.error(e)}
}

// ── REALTIME — canal de chat do modal do PC/Professor, escopado a este ticket ──
// Substitui o canal anterior ao trocar de chamado e é desinscrito em fecharChat().
// Tabela `mensagem` (filtro ticket_id=eq.{ticketId}):
//   INSERT → nova mensagem (própria ou do TI): recarrega o chat, marca como lida
//            e toca som se veio do TI
//   UPDATE → mensagem existente mudou (ex: marcada como lida pelo TI): recarrega
// Tabela `ticket` (filtro id=eq.{ticketId}):
//   UPDATE → chamado mudou de status: toca som se foi encerrado, recarrega lista
//            de chamados e o chat (para refletir a resolução exibida no modal)
function _iniciarRealtime(ticketId) {
  if(realtimeChannel){sbClient.removeChannel(realtimeChannel);realtimeChannel=null;}
  realtimeChannel=sbClient.channel(`chat-pc-${ticketId}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'mensagem',filter:`ticket_id=eq.${ticketId}`},payload=>{
      carregarMsgs(ticketId);
      _marcarLidoPC(ticketId);
      if(payload.new?.remetente==='TI')window._dsosSom?.notificacao?.();
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'mensagem',filter:`ticket_id=eq.${ticketId}`},()=>carregarMsgs(ticketId))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'ticket',filter:`id=eq.${ticketId}`},payload=>{
      if(['resolvido','descartado','falso_alarme'].includes(payload.new?.status))window._dsosSom?.notificacao?.();
      carregarChamados();carregarMsgs(ticketId);
    })
    .subscribe(rtStatusHandler(`chat-pc-${ticketId}`));
}

window.fecharChat = function() {
  document.getElementById('modal-chat').classList.remove('open');
  chatTicketId=null;
  if(realtimeChannel){sbClient.removeChannel(realtimeChannel);realtimeChannel=null;}
};
document.getElementById('modal-chat').addEventListener('click',e=>{if(e.target===document.getElementById('modal-chat'))window.fecharChat()});

let imgsPendentes=[];
window.enviarMsg = async function(e) {
  if(e.key!=='Enter')return;
  const inp=document.getElementById('chat-input'),txt=inp.value.trim();
  if(!txt&&!imgsPendentes.length)return;if(!chatTicketId)return;
  inp.value='';
  const nomeRemetente=session.nome||session.tag||'PC';
  try{
    for(const file of imgsPendentes){
      let imagem_url=null;
      try{imagem_url=await _uploadImg(file);}catch(err){toast('Erro ao enviar imagem: '+err.message,'err');continue}
      await fetch(`${SB_URL}/rest/v1/mensagem`,{method:'POST',headers:H,body:JSON.stringify({ticket_id:chatTicketId,remetente:'PC',conteudo:null,imagem_url,enviado_em:new Date().toISOString(),nome_remetente:nomeRemetente})});
      
      // ━━ LOGGING (imagem) ━━
      _logEvent('rpc_log_enviar_mensagem', {
        p_ticket_id: chatTicketId,
        p_tipo_usuario: session.tipo,
        p_usuario_id: session.tipo === 'pc' ? session.id : null,
        p_professor_id: session.tipo === 'professor' ? session.id : null,
        p_tipo_conteudo: 'imagem',
        p_tem_texto: false
      });
    }
    imgsPendentes=[];document.getElementById('img-preview-list').innerHTML='';document.getElementById('img-preview-row').classList.remove('visible');
    if(txt){
      await fetch(`${SB_URL}/rest/v1/mensagem`,{method:'POST',headers:H,body:JSON.stringify({ticket_id:chatTicketId,remetente:'PC',conteudo:txt,imagem_url:null,enviado_em:new Date().toISOString(),nome_remetente:nomeRemetente})});
      
      // ━━ LOGGING (texto) ━━
      _logEvent('rpc_log_enviar_mensagem', {
        p_ticket_id: chatTicketId,
        p_tipo_usuario: session.tipo,
        p_usuario_id: session.tipo === 'pc' ? session.id : null,
        p_professor_id: session.tipo === 'professor' ? session.id : null,
        p_tipo_conteudo: 'texto',
        p_tem_texto: true,
        p_tamanho_texto: txt.length
      });
    }
    await carregarMsgs(chatTicketId);
  }catch(e){toast('Erro ao enviar mensagem.','err')}
};

async function _uploadImg(file){
  const ext=(file.name&&file.name.includes('.'))?file.name.split('.').pop():(file.type.split('/')[1]||'jpg');
  const nome=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const res=await fetch(`${SB_URL}/storage/v1/object/chat-prints/${nome}`,{method:'POST',headers:{'apikey':H.apikey,'Authorization':H.Authorization,'Content-Type':file.type,'x-upsert':'true'},body:file});
  if(!res.ok)throw new Error('Upload falhou');
  return`${SB_URL}/storage/v1/object/public/chat-prints/${nome}`;
}

window.selecionarImagem = function(event) {
  const files=Array.from(event.target.files);if(!files.length)return;
  const MAX=5;if(imgsPendentes.length+files.length>MAX){toast(`Máximo de ${MAX} imagens.`,'err');event.target.value='';return}
  files.forEach(file=>{
    imgsPendentes.push(file);
    const url=URL.createObjectURL(file);
    const wrap=document.createElement('div');wrap.className='img-preview-item';
    wrap.innerHTML=`<img src="${url}" class="img-preview-thumb"/><span class="img-preview-nome">${_esc(file.name)}</span><button class="img-preview-remove" onclick="removerImgPendente(${imgsPendentes.length-1},this.closest('.img-preview-item'))">✕</button>`;
    document.getElementById('img-preview-list').appendChild(wrap);
  });
  document.getElementById('img-preview-row').classList.add('visible');
  document.getElementById('chat-input').focus();event.target.value='';
};
window.removerImgPendente = function(idx,el) {
  imgsPendentes.splice(idx,1);el?.remove();
  document.querySelectorAll('#img-preview-list .img-preview-remove').forEach((btn,i)=>{btn.setAttribute('onclick',`removerImgPendente(${i},this.closest('.img-preview-item'))`)});
  if(!imgsPendentes.length)document.getElementById('img-preview-row').classList.remove('visible');
};

window.abrirLightbox = function(url) { document.getElementById('lightbox-img').src=url;document.getElementById('lightbox').classList.add('open'); };
window.fecharLightbox = function() { document.getElementById('lightbox').classList.remove('open'); };
document.addEventListener('keydown',e=>{ if(e.key==='Escape')window.fecharLightbox(); });

// _esc agora delega para escapeHtml importado de ./ui.js (fonte única)
const _esc = escapeHtml;

window.toggleSel = function() { document.getElementById('sel-wrap').classList.toggle('open'); };
window.pickTipo = function(opt) {
  tipo=opt.dataset.v;
  document.querySelectorAll('.sel-opt').forEach(o=>o.classList.remove('active'));opt.classList.add('active');
  document.querySelectorAll('.sel-t-icon').forEach(i=>i.style.display='none');
  const ic=document.getElementById('ico-'+opt.dataset.i);if(ic)ic.style.display='block';
  const nomes={hardware:'Hardware',software:'Software',rede:'Rede',outro:'Outro'};
  document.getElementById('sel-val').textContent=nomes[tipo]||tipo;
  document.getElementById('sel-trigger').classList.add('valued');
  document.getElementById('sel-wrap').classList.remove('open');
  _aiUltimaDesc = ''; _aiUltimoResultado = null;
};
document.addEventListener('click',e=>{ const w=document.getElementById('sel-wrap');if(!w.contains(e.target))w.classList.remove('open'); });
window.toggleEmerg = function() {
  emergAtivo=!emergAtivo;document.getElementById('emerg').classList.toggle('on',emergAtivo);
  document.getElementById('epill').textContent=emergAtivo?'ATIVO':'ATIVAR';
  if(!emergAtivo)document.getElementById('emerg-pc').value='';
};

window.abrirChamado = async function() {
  if(!tipo){toast('Selecione o tipo de problema.','err');return}
  const desc=document.getElementById('descricao').value.trim();
  if(!desc){toast('Adicione uma descrição do problema.','err');return}
  if(session.tipo==='professor'&&!emergAtivo){toast('Professores só podem abrir chamados de emergência.','err');return}

  // Emergências (emergAtivo ou professor) pulam o rate limit
  const ehEmergencia = emergAtivo || session.tipo === 'professor';
  if (!ehEmergencia) {
    const rl = await _checkTicketRateLimit();
    if (rl?.bloqueado) {
      _exibirBloqueioTicket(rl.segundos_restantes || 300);
      return;
    }
  }

  let pcOrigemId=session.tipo==='pc'?session.id:null,pcProblemaId=session.tipo==='pc'?session.id:null;
  if(emergAtivo){
    const epTag=document.getElementById('emerg-pc').value.trim();
    if(!epTag){toast('Informe a tag do PC com problema.','err');return}
    try{
      const rpc=await fetch(`${SB_URL}/rest/v1/pc?tag=eq.${encodeURIComponent(epTag)}&select=id,laboratorio,lado`,{headers:H});
      const pcs=await rpc.json();
      if(!Array.isArray(pcs)||!pcs.length){toast('Tag do PC não encontrada.','err');return}
      pcProblemaId=pcs[0].id;
      if(session.tipo==='professor'){pcOrigemId=pcs[0].id;session.laboratorio=pcs[0].laboratorio;session.lado=pcs[0].lado;document.getElementById('footer-lab').textContent=pcs[0].laboratorio||'—';document.getElementById('footer-lado').textContent=pcs[0].lado||'—';}
    }catch(e){toast('Erro ao buscar PC.','err');return}
  }
  const btn=document.getElementById('btn-submit');btn.classList.add('loading');

  const isDuplicata = await _verificarDuplicata(desc, pcProblemaId);
  if (isDuplicata) {
    btn.classList.remove('loading');
    toast('Já existe um chamado aberto com descrição muito parecida para este PC.', 'err');
    return;
  }

  const badge=document.getElementById('ai-prioridade-badge');
  // PERF-02: o badge que aparece enquanto o usuário digita já classificou
  // esta mesma descrição (debounced). Antes o resultado era descartado e
  // abrirChamado chamava classificarChamado() de novo do zero, dobrando
  // custo e latência de IA por chamado aberto sem necessidade. Só
  // reclassifica se a descrição mudou desde a última classificação exibida.
  let resultadoIA;
  if(_aiUltimoResultado && _aiUltimaDesc === desc){
    resultadoIA = _aiUltimoResultado;
  }else{
    if(badge){badge.className='ai-badge loading';badge.textContent='⏳ Classificando...';}
    resultadoIA = await classificarChamado(desc);
    _aiUltimaDesc = desc;
    _aiUltimoResultado = resultadoIA;
  }
  const { prioridade: prioridadeIA, tipo: tipoDetectado } = resultadoIA;
  if (tipoDetectado && !tipo) tipo = tipoDetectado;
  const labelsIA={alto:'🔴 Prioridade Alta',medio:'🟡 Prioridade Média',baixo:'🟢 Prioridade Baixa',falso:'⚠️ Possível falso alarme',emergencia:'🚨 EMERGÊNCIA DETECTADA'};
  if(badge){badge.className=`ai-badge pri-${prioridadeIA}`;badge.textContent=labelsIA[prioridadeIA];}
  if(prioridadeIA==='falso'){
    btn.classList.remove('loading');
    toast('A IA identificou isso como possível falso alarme. Revise a descrição.','err');
    return;
  }
  const ehEmergenciaIA = prioridadeIA === 'emergencia';
  try{
    const r=await fetch(`${SB_URL}/rest/v1/ticket`,{method:'POST',headers:H,body:JSON.stringify({
      pc_origem:pcOrigemId,pc_problema:pcProblemaId,
      tipo,descricao:desc,
      laboratorio:session.laboratorio,lado:session.lado,
      status:'aberto',prioridade: ehEmergenciaIA ? 'alto' : prioridadeIA,
      aberto_em:new Date().toISOString(),
      nome_solicitante:session.nome,
      chamado_emergencia: ehEmergencia || ehEmergenciaIA
    })});
    if(!r.ok){const err=await r.json().catch(()=>({}));throw new Error(err.message||'HTTP '+r.status)}
    const data=await r.json();
    const id=Array.isArray(data)?data[0]?.id:data?.id;
    
    // ━━ LOGGING (chamado detalhado) ━━
    _logEvent('rpc_log_abrir_chamado', {
      p_ticket_id: id,
      p_tipo_usuario: session.tipo,
      p_usuario_id: session.tipo === 'pc' ? session.id : null,
      p_professor_id: session.tipo === 'professor' ? session.id : null,
      p_pc_problema_id: pcProblemaId,
      p_tipo_chamado: tipo,
      p_é_emergencia: ehEmergencia
    });

    document.getElementById('suc-id').textContent=`Chamado #${id||'—'}`;
    window._ultimoTicketAberto=id||null;
    document.getElementById('overlay').classList.add('open');
    await carregarChamados();
  }catch(e){console.error(e);toast('Erro ao abrir chamado: '+e.message,'err');}
  finally{btn.classList.remove('loading')}
};

window.resetForm = function() {
  document.getElementById('overlay').classList.remove('open');
  document.querySelectorAll('.sel-opt').forEach(o=>o.classList.remove('active'));
  document.querySelectorAll('.sel-t-icon').forEach(i=>i.style.display='none');
  document.getElementById('sel-val').textContent='';document.getElementById('sel-trigger').classList.remove('valued');
  document.getElementById('descricao').value='';document.getElementById('dc').textContent='0';
  if(session.tipo==='professor'){if(!emergAtivo)window.toggleEmerg();}
  else{emergAtivo=false;document.getElementById('emerg').classList.remove('on');document.getElementById('epill').textContent='ATIVAR';}
  document.getElementById('emerg-pc').value='';
  document.getElementById('ai-prioridade-badge').className='ai-badge hidden';
  _fecharSugestao();
  _aiUltimaDesc='';_aiUltimoResultado=null;
  tipo=null;
  trocarAba('chamados');
  setTimeout(()=>_abrirAvaliacaoSistema(window._ultimoTicketAberto),800);
};

/* FEATURE 6 — Estimativa de tempo de atendimento */
let _mediasResolucao={};
async function _carregarMediasResolucao(){
  try{
    const cutoff=new Date(Date.now()-90*86400000).toISOString();
    const r=await fetch(`${SB_URL}/rest/v1/ticket?status=eq.resolvido&aberto_em=gte.${cutoff}&select=tipo,aberto_em,resolvido_em`,{headers:H});
    const data=await r.json();
    if(!Array.isArray(data))return;
    const map={};
    data.forEach(t=>{
      if(!t.tipo||!t.aberto_em||!t.resolvido_em)return;
      const ms=new Date(t.resolvido_em)-new Date(t.aberto_em);
      if(ms<=0)return;
      if(!map[t.tipo])map[t.tipo]={sum:0,n:0};
      map[t.tipo].sum+=ms;map[t.tipo].n++;
    });
    Object.entries(map).forEach(([k,v])=>{
      const mins=Math.round(v.sum/v.n/60000);
      _mediasResolucao[k]=mins>=60?`${Math.floor(mins/60)}h${mins%60?` ${mins%60}min`:''}` :`${mins}min`;
    });
    // Atualiza o texto de descrição de cada opção do seletor com a estimativa
    document.querySelectorAll('.sel-opt[data-v]').forEach(opt=>{
      const est=_mediasResolucao[opt.dataset.v];
      const desc=opt.querySelector('.sel-opt-desc');
      if(!desc||!est)return;
      // Remove estimativa anterior se já existir
      const existing=desc.querySelector('._est');
      if(existing)existing.remove();
      const span=document.createElement('span');
      span.className='_est';
      span.style.cssText='color:var(--green,#22c55e);font-weight:600;margin-left:4px';
      span.textContent='· ~'+est;
      desc.appendChild(span);
    });
  }catch(e){}
}

/* FEATURE 7 — Câmera */
let _cameraStream=null;
window.abrirCamera=async function(){
  const modal=document.getElementById('camera-modal');if(!modal)return;
  try{
    _cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    document.getElementById('camera-video').srcObject=_cameraStream;
    modal.style.display='flex';
  }catch(e){await dsosAlert({msg:'Câmera não disponível: '+e.message,tipo:'warning',titulo:'Câmera'});}
};
window.fecharCamera=function(){
  const modal=document.getElementById('camera-modal');if(modal)modal.style.display='none';
  if(_cameraStream){_cameraStream.getTracks().forEach(t=>t.stop());_cameraStream=null;}
};
window.capturarFoto=function(){
  const video=document.getElementById('camera-video');
  const canvas=document.getElementById('camera-canvas');
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  canvas.toBlob(blob=>{
    if(!blob)return;
    const file=new File([blob],'foto_'+Date.now()+'.jpg',{type:'image/jpeg'});
    // Adiciona ao input de imagens como se o usuário tivesse selecionado
    const dt=new DataTransfer();
    const inp=document.getElementById('img-input');
    if(inp?.files){Array.from(inp.files).forEach(f=>dt.items.add(f));}
    dt.items.add(file);
    if(inp)inp.files=dt.files;
    window.previewImagens?.(inp);
    window.fecharCamera();
  },'image/jpeg',0.88);
};

/* ═══════════════════════════════════════════
   AVALIAÇÃO DO SISTEMA (após abrir chamado)
═══════════════════════════════════════════ */
let _avaliacaoNota=0;
let _avaliacaoTicketId=null;
const _AVALIACAO_LABELS=['','Muito difícil','Difícil','Regular','Fácil','Muito fácil'];

function _abrirAvaliacaoSistema(ticketId){
  _avaliacaoTicketId=ticketId||null;
  _avaliacaoNota=0;
  document.querySelectorAll('.estrela').forEach(s=>s.classList.remove('ativa'));
  document.getElementById('avaliacao-label').textContent='';
  document.getElementById('avaliacao-comentario').value='';
  document.getElementById('avaliacao-enviar').disabled=true;
  const titulo=document.querySelector('.avaliacao-titulo');
  const sub=document.querySelector('.avaliacao-sub');
  const icon=document.querySelector('.avaliacao-icon');
  if(titulo)titulo.textContent='Chamado aberto com sucesso!';
  if(sub)sub.textContent='Como foi usar o sistema para abrir o chamado?';
  if(icon)icon.textContent='✅';
  document.getElementById('avaliacao-modal').style.display='flex';
}
window.fecharAvaliacao=function(){
  document.getElementById('avaliacao-modal').style.display='none';
};
window.selecionarEstrela=function(n){
  _avaliacaoNota=n;
  document.querySelectorAll('.estrela').forEach(s=>{
    s.classList.toggle('ativa',parseInt(s.dataset.v)<=n);
  });
  document.getElementById('avaliacao-label').textContent=_AVALIACAO_LABELS[n]||'';
  document.getElementById('avaliacao-enviar').disabled=false;
};
window.enviarAvaliacao=async function(){
  if(!_avaliacaoNota)return;
  const comentario=document.getElementById('avaliacao-comentario').value.trim();
  window.fecharAvaliacao();
  if(!_avaliacaoTicketId)return;
  // Sessão anterior a esta versão não tem token; sem este guarda, p_token
  // sairia undefined e o PostgREST responderia "Could not find the function",
  // que não diz nada ao usuário.
  if(!session?.token){
    toast('Sua sessão é de uma versão anterior. Faça login novamente.','err');
    return;
  }
  try{
    // SEC-05: era um PATCH direto em ticket. Como a policy de UPDATE era
    // USING(true), a mesma chamada dava para escrever qualquer coluna de
    // qualquer chamado. Agora vai por RPC validada pelo token da sessão, que
    // só aceita nota de 1 a 5 em chamado já encerrado.
    const r=await fetch(`${SB_URL}/rest/v1/rpc/rpc_avaliar_ticket`,{
      method:'POST',
      headers:{...H,'Content-Type':'application/json'},
      body:JSON.stringify({
        p_token: session?.token,
        p_ticket_id: _avaliacaoTicketId,
        p_nota: _avaliacaoNota,
        p_comentario: comentario||null
      }),
    });
    if(!r.ok){
      const t=await r.text().catch(()=>'');
      console.error('[enviarAvaliacao]',r.status,t);
      toast('Não foi possível registrar sua avaliação.','err');
    }
  }catch(e){console.error('[enviarAvaliacao]',e)}
};

window.sair = async function() {
  try{
    const _t=sessionStorage.getItem('dsos_login_time');
    const _dur=_t?(()=>{const s=Math.floor((Date.now()-parseInt(_t))/1000);return`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`})():null;
    sessionStorage.removeItem('dsos_login_time');
    const _ua=navigator.userAgent;const _br=(_ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s]([\d.]+)/)||[])[1];const _os=/Windows/.test(_ua)?'Windows':/Mac/.test(_ua)?'macOS':/Linux/.test(_ua)?'Linux':/Android/.test(_ua)?'Android':/iPhone|iPad/.test(_ua)?'iOS':'?';
    await _logEvent('rpc_log_logout',{
      p_usuario_id:   session?.id,
      p_usuario_tipo: session?.tipo||'pc',
      p_usuario_login:session?.login||session?.tag,
      p_usuario_nome: session?.nome,
      p_ip_address:   `${_br||'?'} | ${_os} | ${screen.width}x${screen.height} | ${navigator.language||'N/A'} | ${Intl.DateTimeFormat().resolvedOptions().timeZone||'N/A'}`,
      ...(_dur?{p_duracao_sessao:_dur}:{}),
    });
  }catch(e){}
  try{await fetch(`${SB_URL}/rest/v1/rpc/rpc_sessao_encerrar`,{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({p_usuario_id:session?.id,p_usuario_tipo:session?.tipo||'pc'})});}catch(_){}
  sessionStorage.removeItem('dsos_session');
  window.location.href='login.html';
};

function toast(msg,t){
  const el=document.getElementById('toast');el.textContent=msg;el.className=`toast ${t} show`;
  setTimeout(()=>el.classList.remove('show'),3000);
}