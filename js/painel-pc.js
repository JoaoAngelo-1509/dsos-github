// DSos v1.6 — painel-pc.js com Logging Completo
import { SB_URL, SB_KEY, H } from './supabase-config.js';
import { dsosAlert } from './dsos-ui.js';
import { escapeHtml, tipoIcon, statusLabel } from './ui.js';
import { rtStatusHandler } from './realtime-manager.js';
import { initSessionGuard } from './session-guard.js';
import { initReportarProblema } from './reportar-problema.js';
import { manterSessaoViva, sessaoViva, expirarSessao, encerrarSessao } from './sessao-vida.js';
import { logger } from './logging.js';
// SEC-05b: instala o envio do X-Sessao-Token antes de qualquer chamada
import { instalarHeaderSessao } from './sessao-header.js';
instalarHeaderSessao();

const sbClient = supabase.createClient(SB_URL, SB_KEY);
let realtimeChannel = null;

let session=null, tipo=null, emergAtivo=false, normalAtivo=false, tickets=[], chatTicketId=null;

// ─────────────────────────────────────────────────────────────────────────
// LOGGING: Função auxiliar para registrar eventos (fail-safe)
// ─────────────────────────────────────────────────────────────────────────
// Passa pelo logger central, igual ao painel-ti. Antes este painel fazia o
// fetch direto, e isso escondia dois defeitos:
//   * as RPCs de log têm duas versões no banco, uma delas com `p_ip_address`
//     DEFAULT NULL. Sem mandar esse parâmetro o PostgREST não sabe qual das
//     duas chamar. O logger sempre injeta o `p_ip_address`;
//   * a resposta nunca era conferida, e um 404 sumia calado. O logger mostra
//     o erro no console.
async function _logEvent(rpcName, params = {}) {
  return logger.logEvento(rpcName, params);
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
  // Teto de 20 s. Com o envio travado até a IA responder (ver
  // _atualizarTravaEnvio), uma requisição pendurada deixaria o botão travado
  // para sempre. Estourou, o fetch rejeita, classificarChamado cai no catch e
  // devolve 'medio' — o que conta como resposta e libera o envio.
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(`${SB_URL}/functions/v1/groq-proxy`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ model: 'openai/gpt-oss-20b', temperature: 0, max_tokens: maxTokens, messages }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error('Groq ' + resp.status + ': ' + (err?.error?.message || ''));
    }
    const data = await resp.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(limite);
  }
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

// ── ENVIO SÓ DEPOIS DA RESPOSTA DA IA ────────────────────────────────────
// No PC o classificador roda enquanto a pessoa digita (2,5 s depois da última
// tecla) e devolve prioridade, tipo e a sugestão "tente antes de abrir". Com o
// botão livre nesse intervalo, o chamado saía sem a pessoa ver a sugestão, e
// a classificação atrasada ainda abria o card de sugestão POR CIMA do
// "Chamado aberto!". Agora o envio só libera quando existe resposta da IA
// para o texto que está no campo — ou para um quase igual, pelo mesmo
// critério de 70% que _atualizarBadgeAI usa para não reclassificar.
// IA fora do ar não trava nada: classificarChamado nunca lança (devolve
// 'medio'), e _groqCall tem teto de 20 s.
// Só no PC: no professor o classificador não roda durante a digitação, e
// abrirChamado já espera a IA (com o botão em loading) antes de gravar.
let _travaIAAtiva = false;   // ligada no carregamento do PC
let _envioProibido = false;  // PC descartado: o botão nunca libera
function _atualizarTravaEnvio() {
  if (!_travaIAAtiva) return;
  const btn = document.getElementById('btn-submit');
  const txt = btn?.querySelector('.btn-txt');
  if (!btn || !txt) return;
  if (_envioProibido) {
    btn.disabled = true;
    btn.dataset.espera = '';
    txt.textContent = 'Envio indisponível neste PC';
    return;
  }
  const desc = document.getElementById('descricao').value.trim();
  const respondida = !!_aiUltimoResultado &&
    (desc === _aiUltimaDesc || _similaridade(desc, _aiUltimaDesc) >= 0.7);
  const espera = desc.length < 10 ? 'curta' : (respondida ? '' : 'ia');
  btn.dataset.espera = espera;
  btn.disabled = espera !== '';
  txt.textContent = espera === 'curta' ? 'Descreva o problema para enviar'
                  : espera === 'ia'    ? 'Aguardando a análise da IA…'
                  : 'Enviar chamado';
}

function _atualizarBadgeAI(descricao) {
  const badge = document.getElementById('ai-prioridade-badge');
  if (!badge) return;
  clearTimeout(_aiDebounceTimer);
  if (!descricao || descricao.length < 10) {
    badge.className = 'ai-badge hidden';
    _aiUltimaDesc = '';
    _aiUltimoResultado = null;
    document.getElementById('ai-sugestao-card')?.classList.add('hidden');
    // reseta seletor de tipo. Até aqui a função recebia `tipo` como
    // parâmetro, e esta linha zerava só a cópia local: o cartão desmarcava,
    // mas o tipo antigo continuava valendo e ia junto com o chamado.
    tipo = null;
    document.querySelectorAll('.sel-opt').forEach(o => o.classList.remove('active'));
    document.querySelectorAll('.sel-t-icon').forEach(i => i.style.display = 'none');
    document.getElementById('sel-val').textContent = '';
    document.getElementById('sel-trigger').classList.remove('valued');
    _atualizarTravaEnvio();
    return;
  }
  // Só reclassifica se mudou mais de 30% em relação à última classificação
  if (_aiUltimoResultado && _similaridade(descricao, _aiUltimaDesc) >= 0.7) { _atualizarTravaEnvio(); return; }

  clearTimeout(_aiDebounceTimer);
  _atualizarTravaEnvio();
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
    _atualizarTravaEnvio();
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
  document.documentElement.dataset.theme = temaSalvo === 'dark' ? 'dark' : 'light';
  if (temaSalvo === 'dark') {
    document.getElementById('ico-tema').innerHTML = _icoSol();
  }

  const raw = sessionStorage.getItem('dsos_session');
  if (!raw) { window.location.href = 'login.html'; return; }
  session = JSON.parse(raw);
  if (session.tipo !== 'pc' && session.tipo !== 'professor') { window.location.href = 'login.html'; return; }

  // Confere o token no banco antes de carregar qualquer coisa, e mantém ele
  // vivo com o ping de 30s. Antes esta tela confiava no sessionStorage para
  // sempre: em 08/09 uma aba restaurada com token vencido havia 6 dias abriu
  // "logada", listou zero chamados e teve o chamado novo recusado por RLS.
  // Ver js/sessao-vida.js.
  if (!(await manterSessaoViva())) return;

  // Logout automático por inatividade — 10 min, com aviso aos 8.
  //
  // Bem mais curto que os 30 min dos painéis do T.I. porque esta tela roda nas
  // máquinas do laboratório: são públicas e trocam de usuário ao longo do dia,
  // então uma sessão esquecida aberta fica à disposição do próximo que sentar
  // ali. Nos painéis do T.I. a máquina é de uso pessoal e o risco não existe —
  // lá o incômodo de deslogar alguém no meio do turno pesa mais.
  //
  // 10 min é o meio-termo: quem está esperando resposta do T.I. no chat sem
  // mexer no mouse ainda recebe o aviso e clica em "Continuar conectado", e
  // qualquer digitação ou rolagem já zera a contagem.
  initSessionGuard({
    onLogout: () => window.sair(),
    timeoutMs: 10 * 60 * 1000,
    avisoMs:    2 * 60 * 1000,
  });
  initReportarProblema();   // botao flutuante de reportar problema

  if (session.tipo === 'professor') {
    document.getElementById('info-nome').textContent  = session.nome || session.login;
    document.getElementById('badge-pc').textContent   = 'PROF';
    document.getElementById('info-lab').textContent   = '—';
    document.getElementById('info-lado').textContent  = '—';
    document.getElementById('footer-lab').textContent = '—';
    document.getElementById('footer-lado').textContent= '—';
    document.getElementById('divisor-txt').textContent = 'escolha o tipo de chamado';
    window.toggleNormal();
    await carregarChamados();
    _iniciarPollPC();
    _iniciarRealtimePC();
    return;
  }

  document.getElementById('info-nome').textContent    = session.nome || session.tag;
  document.getElementById('badge-pc').textContent     = session.tag  || '—';
  document.getElementById('info-lab').textContent     = session.laboratorio || '—';
  document.getElementById('info-lado').textContent    = session.lado || '—';
  document.getElementById('footer-lab').textContent   = session.laboratorio || '—';
  document.getElementById('footer-lado').textContent  = session.lado || '—';
  document.getElementById('emerg').style.display        = 'none';
  document.getElementById('emerg-normal').style.display  = 'none';
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
        _envioProibido = true;   // a trava da IA não pode reabrir este botão
      }
    }
  } catch(e) { /* silencioso */ }

  // Atualiza badge de prioridade AI enquanto usuário digita
  document.getElementById('descricao')?.addEventListener('input', function() {
    _atualizarBadgeAI(this.value.trim());
  });
  _travaIAAtiva = true;
  _atualizarTravaEnvio();

  await carregarChamados();
  _iniciarPollPC();
  _iniciarRealtimePC();
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

// ─────────────────────────────────────────────────────────────────────────
// REALTIME — canal principal do painel do PC/professor (vive a página inteira)
//
// Até aqui o único canal realtime desta tela era o de dentro do modal de chat
// (_iniciarRealtime), criado ao ABRIR um chamado e destruído ao fechar. Com o
// modal fechado — que é como a tela passa a maior parte do tempo — não havia
// nenhuma assinatura: a lista "Meus Chamados" e o contador de mensagens não
// lidas só se mexiam no poll de 30 s. Daí os dois sintomas relatados: resposta
// do T.I. sem aviso nenhum, e chamado que o T.I. acabou de resolver
// continuando "Em andamento" na tela do aluno por até meio minuto.
//
// Espelha o canal 'tickets-realtime' do painel T.I.: escuta a tabela-espelho
// `realtime_sinal` (metadado não sensível, SELECT aberto — ver a migration
// 20260828120000 e docs/REALTIME.md) e re-busca o conteúdo pelo REST, que
// continua filtrado pelo token da sessão.
//
// O filtro do WebSocket é por CANAL, não por ticket: `realtime_sinal` avisa
// sobre todos os chamados do sistema, e quem separa "é meu" de "não é meu" é
// o `_ehMeuTicket` abaixo, usando a lista que já está carregada. Nada de
// conteúdo alheio trafega — o sinal só carrega o id do ticket.
// ─────────────────────────────────────────────────────────────────────────
let _canalPC=null;

function _ehMeuTicket(id){
  return tickets.some(t=>String(t.id)===String(id));
}

function _iniciarRealtimePC(){
  if(_canalPC)return;
  _canalPC=sbClient.channel('painel-pc-realtime')
    // Mudou algum chamado: se for um dos meus, recarrega a lista. Um INSERT de
    // ticket que ainda não está em `tickets` também recarrega — pode ser um
    // chamado que este próprio usuário acabou de abrir noutra aba.
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'realtime_sinal',filter:'canal=eq.ticket'},async ({new:s})=>{
      const eraMeu=_ehMeuTicket(s?.ref_id);
      if(!eraMeu&&s?.evento!=='INSERT')return;
      const antes=tickets.find(t=>String(t.id)===String(s?.ref_id))?.status;
      await carregarChamados();
      // Se o chamado aberto no modal mudou de status, o modal precisa refletir
      // isso na hora (o chat é desabilitado quando o chamado é encerrado).
      if(String(chatTicketId)===String(s?.ref_id)){
        const t=tickets.find(x=>String(x.id)===String(chatTicketId));
        if(t)_atualizarCabecalhoModal(t);
      }
      const depois=tickets.find(t=>String(t.id)===String(s?.ref_id))?.status;
      if(eraMeu&&antes&&depois&&antes!==depois){
        window._dsosSom?.notificacao?.();
        toast(`Chamado #${s.ref_id}: ${statusLabel(depois)}`,'ok');
      }
    })
    // Mensagem nova em algum chamado: se for meu E o chat dele não estiver
    // aberto, atualiza o contador de não lidas e avisa. Com o modal aberto
    // quem cuida é o canal do próprio chat, que já marca como lida.
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'realtime_sinal',filter:'canal=eq.mensagem'},async ({new:s})=>{
      if(s?.evento!=='INSERT')return;
      if(!_ehMeuTicket(s?.ref_id))return;
      if(String(chatTicketId)===String(s?.ref_id))return;
      const antes=window._naoLidasPC?.[s.ref_id]||0;
      await carregarChamados();
      const depois=window._naoLidasPC?.[s.ref_id]||0;
      // Só avisa se a contagem de NÃO LIDAS subiu — assim a própria mensagem
      // que este usuário acabou de enviar não dispara notificação nele mesmo.
      if(depois>antes){
        window._dsosSom?.notificacao?.();
        toast(`Nova mensagem do T.I. no chamado #${s.ref_id}`,'ok');
      }
    })
    .subscribe(rtStatusHandler('painel-pc-realtime'));
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

// A busca filtra na TELA, sobre a lista completa. Antes ela ia para o banco
// (`or=(descricao.ilike...)`) e trocava a própria `tickets` pela lista
// filtrada, com três efeitos colaterais: o poll de 30 s e o realtime chamam
// carregarChamados() sem termo e desfaziam a busca com o texto ainda no
// campo; enquanto a busca valia, `_ehMeuTicket` não enxergava os chamados
// fora dela e o realtime ignorava mudanças neles (e o contador da aba contava
// só os filtrados); e vírgula ou parêntese no termo quebravam o `or=()` do
// PostgREST, zerando a lista.
let buscaTimer=null, _buscaAtual='';
window.buscaChamados = function(q) {
  clearTimeout(buscaTimer);
  buscaTimer=setTimeout(()=>{_buscaAtual=String(q||'').trim().toLowerCase();renderChamados();},200);
};

async function carregarChamados() {
  try{
    const filtroBase=session.tipo==='professor'
      ?`nome_solicitante=eq.${encodeURIComponent(session.nome)}`
      :`pc_origem=eq.${encodeURIComponent(session.id)}`;
    const r=await fetch(`${SB_URL}/rest/v1/ticket?${filtroBase}&order=aberto_em.desc&select=*`,{headers:H});
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
  _pedirAvaliacaoPendente();
}

// Só pede avaliação quando um chamado do usuário já foi encerrado e ainda não
// tem nota — nunca logo após abrir um chamado. Cada chamado é oferecido uma
// única vez por sessão do navegador (sessionStorage) para não reaparecer a
// cada poll de 30s depois de dispensado.
function _pedirAvaliacaoPendente(){
  try{
    const modal=document.getElementById('avaliacao-modal');
    if(!modal||modal.style.display==='flex')return;
    if(document.getElementById('overlay')?.classList.contains('open'))return;
    let vistos=[];
    try{vistos=JSON.parse(sessionStorage.getItem('dsos_aval_pedidas')||'[]');}catch(_){}
    const t=tickets.find(x=>(x.status==='resolvido'||x.status==='descartado')&&(x.avaliacao==null)&&!vistos.includes(x.id));
    if(!t)return;
    vistos.push(t.id);
    try{sessionStorage.setItem('dsos_aval_pedidas',JSON.stringify(vistos));}catch(_){}
    _abrirAvaliacaoSistema(t.id);
  }catch(e){console.error('[avaliacao]',e)}
}

// ── LISTA "MEUS CHAMADOS" ────────────────────────────────────────────────
// O cartão mostra primeiro o que a pessoa escreveu (antes o título era só o
// tipo, e três chamados de "Hardware" ficavam iguais), o status com uma
// frase dizendo o que acontece agora, e uma ação escrita por extenso. A lista
// vem em dois grupos: o que ainda está em aberto — onde se conversa com o
// T.I. — e o histórico.
const _TIPO_NOME={hardware:'Hardware',software:'Software',rede:'Rede',outro:'Outro',periferico:'Periférico'};
const _STATUS_DICA={aberto:'Aguardando um técnico assumir',em_andamento:'Um técnico está cuidando disso'};
const _ehAtivo=t=>t.status==='aberto'||t.status==='em_andamento';

function _quandoFoi(iso){
  if(!iso)return'—';
  const d=new Date(iso),min=Math.floor((Date.now()-d.getTime())/60000);
  if(min<1)return'agora mesmo';
  if(min<60)return`há ${min} min`;
  if(min<24*60)return`há ${Math.floor(min/60)} h`;
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
}

function _cardChamado(t){
  const ativo=_ehAtivo(t);
  const acao=ativo?`abrirChat(${t.id})`:`abrirDetalhes(${t.id})`;
  const nl=ativo?(window._naoLidasPC?.[t.id]||0):0;
  const desc=t.descricao&&t.descricao!=='(chamado rápido)'?t.descricao:'Sem descrição';
  const tipoNome=_TIPO_NOME[t.tipo]||t.tipo||'—';
  const dataHora=t.aberto_em?new Date(t.aberto_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const icoChat=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const novas=nl>0?`<span class="ticket-unread-badge-pc visible">${icoChat} ${nl} ${nl>1?'mensagens novas':'mensagem nova'}</span>`:'';
  const acaoHtml=ativo
    ?`<button class="btn-chat-ticket" type="button" onclick="event.stopPropagation();abrirChat(${t.id})">${icoChat} Conversar com o T.I.</button>`
    :`<span class="t-ver">Ver detalhes <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>`;
  // role/tabindex/onkeydown: o cartão é clicável, então também precisa abrir
  // pelo teclado. O `event.target===this` evita abrir duas vezes quando o
  // Enter vem do botão "Conversar", que está dentro do cartão.
  return`<div class="ticket-card ${t.status} ${ativo?'ativo':'fechado'}${nl>0?' tem-nl':''}" role="button" tabindex="0" onclick="${acao}" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();${acao}}">
      <div class="t-icon">${tipoIcon(t.tipo)}</div>
      <div class="t-info">
        <div class="t-topo"><span class="status-pill pill-${t.status}">${statusLabel(t.status)}</span>${ativo?`<span class="t-dica">${_STATUS_DICA[t.status]}</span>`:''}${novas}</div>
        <div class="t-desc">${_esc(desc)}</div>
        <div class="t-meta">#${t.id} · ${_esc(tipoNome)} · ${_esc(t.laboratorio||'—')} Lado ${_esc(t.lado||'—')} · <span title="${dataHora}">${_quandoFoi(t.aberto_em)}</span></div>
      </div>
      <div class="t-right">${acaoHtml}</div>
    </div>`;
}

function renderChamados() {
  const list=document.getElementById('ticket-list'),badge=document.getElementById('tab-badge');
  const ativos=tickets.filter(_ehAtivo).length;
  badge.textContent=ativos||tickets.length;badge.classList.toggle('zero',ativos===0);
  if(!tickets.length){
    const quem=session.tipo==='professor'?'aberto por você':'aberto neste PC';
    list.innerHTML=`<div class="empty"><div class="eicon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div><p>Nenhum chamado ${quem} ainda.<br>Quando algo não funcionar, abra um chamado e acompanhe tudo por aqui.</p><button class="btn-empty" type="button" onclick="trocarAba('abrir')">Abrir chamado</button></div>`;
    return;
  }
  const q=_buscaAtual;
  const visiveis=q
    ?tickets.filter(t=>[t.descricao,t.tipo,_TIPO_NOME[t.tipo],t.laboratorio,'#'+t.id,statusLabel(t.status)].some(v=>String(v||'').toLowerCase().includes(q)))
    :tickets;
  if(!visiveis.length){
    const termo=document.getElementById('chamados-search')?.value.trim()||q;
    list.innerHTML=`<div class="empty"><p>Nenhum chamado encontrado para “${_esc(termo)}”.</p><button class="btn-empty sec" type="button" onclick="const b=document.getElementById('chamados-search');b.value='';buscaChamados('')">Limpar busca</button></div>`;
    return;
  }
  const abertos=visiveis.filter(_ehAtivo),fechados=visiveis.filter(t=>!_ehAtivo(t));
  const grupo=(titulo,lista)=>`<div class="t-grupo"><span>${titulo}</span><span class="t-grupo-n">${lista.length}</span></div>${lista.map(_cardChamado).join('')}`;
  let html='';
  if(abertos.length)html+=grupo('Em aberto',abertos);
  else if(!q)html+=`<div class="t-nenhum-aberto"><span>Nenhum chamado em aberto agora.</span><button class="btn-empty" type="button" onclick="trocarAba('abrir')">Abrir chamado</button></div>`;
  if(fechados.length)html+=grupo('Encerrados',fechados);
  list.innerHTML=html;
}

// DUP-01: tipoIcon e statusLabel eram reimplementados aqui, byte a byte
// iguais aos de ui.js (a versão de lá inclui também o ícone de 'periferico',
// que faltava nesta cópia). Agora vêm de ui.js — ver import no topo.

window.abrirChat    = function(id) { const t=tickets.find(x=>x.id===id); if(t) _abrirModal(t); };
window.abrirDetalhes = function(id) { const t=tickets.find(x=>x.id===id); if(t) _abrirModal(t); };

// Pinta o cabeçalho do modal (título, status, resolução) e liga/desliga os
// controles do chat conforme o chamado ainda estiver aberto. Extraído de
// _abrirModal porque o canal realtime do painel também precisa reaplicar isto
// quando o T.I. encerra um chamado com o modal aberto — antes o modal ficava
// mostrando "Em andamento" e com o campo de mensagem habilitado até o usuário
// fechar e reabrir.
function _atualizarCabecalhoModal(t) {
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
  const btnCam=document.getElementById('btn-camera');
  if(btnCam)btnCam.disabled=!podeChat;
  return podeChat;
}

async function _abrirModal(t) {
  chatTicketId=t.id;
  const podeChat=_atualizarCabecalhoModal(t);
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
      const imgHtml=m.imagem_url?`<img class="msg-img" src="${_esc(m.imagem_url)}" alt="print" data-url="${_esc(m.imagem_url)}" />`:'';
      const textoHtml=m.conteudo?`<div class="msg-bubble">${_esc(m.conteudo)}</div>`:'';
      const tickHtml=(!deTI)?`<span class="msg-tick${m.lido_ti?' lido':''}">${m.lido_ti?tick2:tick1}</span>`:'';
      return`<div class="msg ${de}">${imgHtml}${textoHtml}<div class="msg-meta">${_esc(nomeRem)} · ${hora} ${tickHtml}</div></div>`;
    }).join('');
    chat.querySelectorAll('.msg-img').forEach(img=>img.addEventListener('click',()=>window.abrirLightbox(img.dataset.url)));
    chat.scrollTop=chat.scrollHeight;
  }catch(e){console.error(e)}
}

// ── REALTIME — canal de chat do modal do PC/Professor, escopado a este ticket ──
// Substitui o canal anterior ao trocar de chamado e é desinscrito em fecharChat().
//
// O SEC-05b tirou `ticket`/`mensagem` do alcance do Realtime (a RLS deles exige
// o header de sessão, que o WebSocket não carrega). Este canal escuta a
// tabela-espelho `realtime_sinal` (migration 20260828120000), filtrada por
// ref_id=eq.{ticketId} — só metadado não sensível trafega; o conteúdo vem do
// re-fetch REST, ainda filtrado pelo token. Ver docs/REALTIME.md.
//
//   sinal canal='mensagem' → recarrega o chat e marca como lida; se for INSERT,
//                            busca só o `remetente` da última mensagem para
//                            tocar som quando ela veio do T.I.
//
// Mudança de STATUS do chamado NÃO é tratada aqui: quem cuida disso é o canal
// do painel (_iniciarRealtimePC), que recarrega a lista e reaplica o cabeçalho
// deste modal. Antes os dois canais reagiam ao mesmo sinal de 'ticket' e o
// resultado era carregarChamados() em dobro e o som tocando duas vezes.
function _iniciarRealtime(ticketId) {
  if(realtimeChannel){sbClient.removeChannel(realtimeChannel);realtimeChannel=null;}
  realtimeChannel=sbClient.channel(`chat-pc-${ticketId}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'realtime_sinal',filter:`ref_id=eq.${ticketId}`},async ({new:s})=>{
      if(s?.canal!=='mensagem')return;
      carregarMsgs(ticketId);
      _marcarLidoPC(ticketId);
      if(s?.evento==='INSERT'){
        try{
          const r=await fetch(`${SB_URL}/rest/v1/mensagem?ticket_id=eq.${ticketId}&select=remetente&order=enviado_em.desc&limit=1`,{headers:H});
          const j=await r.json();
          if(Array.isArray(j)&&j[0]?.remetente==='TI')window._dsosSom?.notificacao?.();
        }catch(_){}
      }
    })
    .subscribe(rtStatusHandler(`chat-pc-${ticketId}`));

  _iniciarPollChatPc(ticketId);
}

// Fallback por poll: mesmo com `realtime_sinal` entregando, o poll continua
// como rede de segurança para queda de WebSocket. Só roda com o modal aberto e
// para quando a aba vai para segundo plano.
let _pollChatPc=null;
function _iniciarPollChatPc(ticketId){
  _pararPollChatPc();
  _pollChatPc=setInterval(()=>{
    if(document.hidden)return;
    if(chatTicketId!==ticketId){_pararPollChatPc();return;}
    carregarMsgs(ticketId);
  },15000);
}
function _pararPollChatPc(){
  if(_pollChatPc){clearInterval(_pollChatPc);_pollChatPc=null;}
}

window.fecharChat = function() {
  document.getElementById('modal-chat').classList.remove('open');
  chatTicketId=null;
  if(realtimeChannel){sbClient.removeChannel(realtimeChannel);realtimeChannel=null;}
  _pararPollChatPc();
};
document.getElementById('modal-chat').addEventListener('click',e=>{if(e.target===document.getElementById('modal-chat'))window.fecharChat()});

let imgsPendentes=[];
let _enviandoMsg=false;
window.enviarMsg = async function(e) {
  if(e.key!=='Enter')return;
  if(_enviandoMsg)return;   // Enter repetido enquanto o envio anterior ainda corre
  const inp=document.getElementById('chat-input'),txt=inp.value.trim();
  if(!txt&&!imgsPendentes.length)return;if(!chatTicketId)return;
  _enviandoMsg=true;
  const ticketId=chatTicketId;
  inp.value='';
  const nomeRemetente=session.nome||session.tag||'PC';
  const logMsg=(temImagem)=>_logEvent('rpc_log_enviar_mensagem', {
    p_usuario_id:    session.id,
    p_usuario_tipo:  session.tipo,
    p_usuario_login: session.login || session.tag || '',
    p_usuario_nome:  session.nome || '',
    p_ticket_id:     ticketId,
    p_tem_imagem:    temImagem
  });
  const postar=async(conteudo,imagem_url)=>{
    const r=await fetch(`${SB_URL}/rest/v1/mensagem`,{method:'POST',headers:H,body:JSON.stringify({ticket_id:ticketId,remetente:'PC',conteudo,imagem_url,nome_remetente:nomeRemetente})});
    if(!r.ok)throw new Error('HTTP '+r.status);
  };
  try{
    const falhas=[];
    for(const file of imgsPendentes){
      try{
        const imagem_url=await _uploadImg(file);
        await postar(null,imagem_url);
        logMsg(true);
      }catch(err){toast('Erro ao enviar imagem: '+err.message,'err');falhas.push(file);}
    }
    imgsPendentes=falhas;
    if(!falhas.length){document.getElementById('img-preview-list').innerHTML='';document.getElementById('img-preview-row').classList.remove('visible');}
    if(txt){
      try{
        await postar(txt,null);
        logMsg(false);
      }catch(err){
        // devolve o texto ao campo para a pessoa não ter que redigitar
        if(!inp.value)inp.value=txt;
        toast('Erro ao enviar mensagem.','err');
      }
    }
    await carregarMsgs(ticketId);
  }catch(err){
    if(!inp.value)inp.value=txt;
    toast('Erro ao enviar mensagem.','err');
  }finally{_enviandoMsg=false;}
};

async function _uploadImg(file){
  const ext=(file.name&&file.name.includes('.'))?file.name.split('.').pop():(file.type.split('/')[1]||'jpg');
  const nome=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  // Sem 'x-upsert': o upsert do Storage faz o servidor LER a linha antiga em
  // storage.objects antes de gravar, e o bucket 'chat-prints' só tem policy de
  // INSERT — sem SELECT/UPDATE a leitura era negada e TODO upload de imagem
  // voltava 403 "new row violates row-level security policy". Upsert também
  // não servia para nada aqui: `nome` já leva Date.now() + sufixo aleatório,
  // então não existe colisão para sobrescrever.
  const res=await fetch(`${SB_URL}/storage/v1/object/chat-prints/${nome}`,{method:'POST',headers:{'apikey':H.apikey,'Authorization':H.Authorization,'Content-Type':file.type},body:file});
  if(!res.ok){
    // A mensagem do Storage (limite de tamanho, tipo recusado, RLS) é o que
    // diz ao usuário o que fazer — colapsar tudo em 'Upload falhou' escondia a
    // causa e foi o que fez este bug demorar a ser diagnosticado.
    const detalhe=await res.text().catch(()=>'');
    let msg='';try{msg=JSON.parse(detalhe)?.message||'';}catch(_){}
    console.error('[_uploadImg]',res.status,detalhe);
    throw new Error(msg||`HTTP ${res.status}`);
  }
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
  // Não zera mais o resultado guardado da IA (_aiUltimaDesc/_aiUltimoResultado).
  // A classificação não depende do tipo — o prompt só recebe a descrição — e
  // a própria IA chama pickTipo ao marcar o tipo detectado, então o zeramento
  // apagava o resultado no instante em que ele era guardado: abrirChamado
  // nunca reaproveitava nada (PERF-02) e chamava a IA de novo a cada envio.
  // Um tipo escolhido à mão continua valendo: abrirChamado só usa o tipo da
  // IA quando `tipo` está vazio.
};
document.addEventListener('click',e=>{ const w=document.getElementById('sel-wrap');if(!w.contains(e.target))w.classList.remove('open'); });
window.toggleEmerg = function() {
  emergAtivo=true;normalAtivo=false;
  document.getElementById('emerg').classList.add('on');
  document.getElementById('epill').textContent='ATIVO';
  document.getElementById('emerg-normal').classList.remove('on');
  document.getElementById('npill').textContent='ATIVAR';
  document.getElementById('normal-pc').value='';
};
window.toggleNormal = function() {
  normalAtivo=true;emergAtivo=false;
  document.getElementById('emerg-normal').classList.add('on');
  document.getElementById('npill').textContent='ATIVO';
  document.getElementById('emerg').classList.remove('on');
  document.getElementById('epill').textContent='ATIVAR';
  document.getElementById('emerg-pc').value='';
};

async function _resolverPcPorTag(tag){
  const rpc=await fetch(`${SB_URL}/rest/v1/pc?tag=eq.${encodeURIComponent(tag)}&select=id,laboratorio,lado`,{headers:H});
  const pcs=await rpc.json();
  return Array.isArray(pcs)&&pcs.length?pcs[0]:null;
}

// Duplo clique abria dois chamados: até o `loading` entrar no botão a função
// já passou por dois `await` (limite de envio e tag do PC), e o segundo
// clique corria em paralelo — passando também pela checagem de duplicata,
// porque o primeiro ainda não tinha gravado.
let _enviandoChamado=false;
window.abrirChamado = async function() {
  if(_enviandoChamado)return;
  _enviandoChamado=true;
  try{await _abrirChamado();}finally{_enviandoChamado=false;}
};

async function _abrirChamado() {
  if(!tipo){toast('Selecione o tipo de problema.','err');return}
  const desc=document.getElementById('descricao').value.trim();
  if(!desc){toast('Adicione uma descrição do problema.','err');return}
  if(session.tipo==='professor'&&!emergAtivo&&!normalAtivo){toast('Selecione o tipo de chamado.','err');return}
  // Vai enviar: uma classificação ainda agendada pela digitação só chegaria
  // depois, e abriria o card "tente antes de abrir" por cima do sucesso.
  clearTimeout(_aiDebounceTimer);

  // Emergências pulam o rate limit
  const ehEmergencia = emergAtivo;
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
    const pc=await _resolverPcPorTag(epTag).catch(()=>null);
    if(!pc){toast('Tag do PC não encontrada.','err');return}
    pcProblemaId=pc.id;
    if(session.tipo==='professor'){pcOrigemId=pc.id;session.laboratorio=pc.laboratorio;session.lado=pc.lado;document.getElementById('footer-lab').textContent=pc.laboratorio||'—';document.getElementById('footer-lado').textContent=pc.lado||'—';}
  }else if(normalAtivo){
    const npTag=document.getElementById('normal-pc').value.trim();
    if(!npTag){toast('Informe a tag do PC com problema.','err');return}
    const pc=await _resolverPcPorTag(npTag).catch(()=>null);
    if(!pc){toast('Tag do PC não encontrada.','err');return}
    pcProblemaId=pc.id;pcOrigemId=pc.id;session.laboratorio=pc.laboratorio;session.lado=pc.lado;
    document.getElementById('footer-lab').textContent=pc.laboratorio||'—';document.getElementById('footer-lado').textContent=pc.lado||'—';
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
      nome_solicitante:session.nome,
      chamado_emergencia: ehEmergencia || ehEmergenciaIA
    })});
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      // 401/403 aqui quase sempre é sessão morta: o INSERT usa
      // return=representation, e a policy de SELECT de ticket exige token vivo
      // (foi o "violates row-level security" de 08/09). Só manda para o login
      // se o ping confirmar — erro de regra com sessão válida tem que aparecer
      // como erro, senão a pessoa entra em loop de login.
      if((r.status===401||r.status===403)&&(await sessaoViva())===false){expirarSessao();return;}
      throw new Error(err.message||'HTTP '+r.status);
    }
    const data=await r.json();
    const id=Array.isArray(data)?data[0]?.id:data?.id;
    
    // ━━ LOGGING (chamado detalhado) ━━
    _logEvent('rpc_log_abrir_chamado', {
      p_usuario_id:    session.id,
      p_usuario_tipo:  session.tipo,
      p_usuario_login: session.login || session.tag || '',
      p_usuario_nome:  session.nome || '',
      p_ticket_id:     id,
      p_tipo_problema: tipo,
      p_laboratorio:   session.laboratorio || null,
      p_is_emergencia: ehEmergencia || ehEmergenciaIA
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
  if(session.tipo==='professor'){window.toggleNormal();}
  else{emergAtivo=false;document.getElementById('emerg').classList.remove('on');document.getElementById('epill').textContent='ATIVAR';}
  document.getElementById('emerg-pc').value='';
  document.getElementById('normal-pc').value='';
  document.getElementById('ai-prioridade-badge').className='ai-badge hidden';
  _fecharSugestao();
  _aiUltimaDesc='';_aiUltimoResultado=null;
  clearTimeout(_aiDebounceTimer);
  tipo=null;
  _atualizarTravaEnvio();   // campo vazio: volta a pedir a descrição
  trocarAba('chamados');
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
    // Adiciona um selo com a estimativa de tempo de resolução em cada opção do seletor
    document.querySelectorAll('.sel-opt[data-v]').forEach(opt=>{
      const est=_mediasResolucao[opt.dataset.v];
      const info=opt.querySelector('.sel-opt-info');
      if(!info||!est)return;
      const existing=opt.querySelector('._est');
      if(existing)existing.remove();
      const span=document.createElement('span');
      span.className='_est';
      span.title='Tempo médio de resolução deste tipo de chamado';
      span.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>Resolução média: ~'+est;
      info.appendChild(span);
    });
  }catch(e){}
}

/* FEATURE 7 — Câmera */
let _cameraStream=null;
window.abrirCamera=async function(){
  const modal=document.getElementById('camera-modal');if(!modal)return;
  // getUserMedia só existe em contexto seguro (https ou localhost). Sem este
  // aviso o navegador só devolve `navigator.mediaDevices === undefined` e o
  // erro que chegava ao usuário era um TypeError sem sentido.
  if(!navigator.mediaDevices?.getUserMedia){
    await dsosAlert({msg:'Este navegador não permite usar a câmera nesta página. Envie a foto pelo botão de imagem.',tipo:'warning',titulo:'Câmera'});
    return;
  }
  try{
    _cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    document.getElementById('camera-video').srcObject=_cameraStream;
    modal.style.display='flex';
  }catch(e){
    // Cada motivo pede uma ação diferente do usuário; a mensagem crua do
    // navegador ('Permission denied', 'Requested device not found') não diz
    // qual é qual em português.
    const motivo={
      NotAllowedError:'Você (ou o navegador) bloqueou o acesso à câmera. Libere a permissão de câmera para este site e tente de novo.',
      NotFoundError:'Nenhuma câmera foi encontrada neste computador.',
      NotReadableError:'A câmera está em uso por outro programa.',
    }[e.name] || ('Câmera não disponível: '+e.message);
    console.error('[abrirCamera]',e.name,e.message);
    await dsosAlert({msg:motivo,tipo:'warning',titulo:'Câmera'});
  }
};
window.fecharCamera=function(){
  const modal=document.getElementById('camera-modal');if(modal)modal.style.display='none';
  if(_cameraStream){_cameraStream.getTracks().forEach(t=>t.stop());_cameraStream=null;}
};
window.capturarFoto=function(){
  const video=document.getElementById('camera-video');
  const canvas=document.getElementById('camera-canvas');
  // Sem quadro ainda (o <video> só tem dimensão depois do primeiro frame):
  // capturar aqui geraria um canvas 0x0 e um blob nulo, e o botão parecia
  // simplesmente não fazer nada.
  if(!video?.videoWidth||!video?.videoHeight){toast('Aguarde a câmera abrir e tente de novo.','err');return;}
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  canvas.toBlob(blob=>{
    if(!blob){toast('Não foi possível capturar a foto.','err');return;}
    const file=new File([blob],'foto_'+Date.now()+'.jpg',{type:'image/jpeg'});
    // A foto entra pelo MESMO caminho de uma imagem escolhida no seletor de
    // arquivos: selecionarImagem() é quem empilha em imgsPendentes e desenha a
    // miniatura. Antes daqui saía uma chamada a window.previewImagens(), que
    // não existe em lugar nenhum, mexendo num input '#img-input' que também
    // não existe (o do HTML é '#file-input-chat') — a foto era tirada, o modal
    // fechava e nada acontecia.
    window.selecionarImagem({ target: { files: [file], value: '' } });
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
  if(titulo)titulo.textContent=ticketId?`Chamado #${ticketId} encerrado`:'Chamado encerrado';
  if(sub)sub.textContent='Como foi o atendimento e o uso do sistema?';
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
  await encerrarSessao();   // apaga o token no banco (e a presença)
  sessionStorage.removeItem('dsos_session');
  window.location.href='login.html';
};

function toast(msg,t){
  const el=document.getElementById('toast');el.textContent=msg;el.className=`toast ${t} show`;
  setTimeout(()=>el.classList.remove('show'),3000);
}