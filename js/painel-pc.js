// DSos v1.5 — painel-pc.js
import { SB_URL, SB_KEY, H } from './supabase-config.js';

const sbClient = supabase.createClient(SB_URL, SB_KEY);
let realtimeChannel = null;

let session=null, tipo=null, tipoRapido=null, emergAtivo=false, tickets=[], chatTicketId=null;

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

  if (session.tipo === 'professor') {
    document.getElementById('info-nome').textContent  = session.nome || session.login;
    document.getElementById('badge-pc').textContent   = 'PROF';
    document.getElementById('info-lab').textContent   = '—';
    document.getElementById('info-lado').textContent  = '—';
    document.getElementById('footer-lab').textContent = '—';
    document.getElementById('footer-lado').textContent= '—';
    document.getElementById('prof-pc-field-rapido').classList.add('visible');
    document.getElementById('rapido-title-txt').textContent = 'Selecione o tipo de problema e informe a tag do PC. O T.I. será notificado imediatamente.';
    window.toggleEmerg();
    await carregarChamados();
    setInterval(carregarChamados, 30000);
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
        document.getElementById('btn-rapido-send').disabled = true;
        document.querySelectorAll('.modo-btn').forEach(btn => { btn.style.opacity='.4'; btn.style.pointerEvents='none'; });
      }
    }
  } catch(e) { /* silencioso */ }

  await carregarChamados();
  setInterval(carregarChamados, 30000);
});

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

window.trocarModo = function(modo) {
  const rapido=document.getElementById('modo-rapido'),det=document.getElementById('modo-detalhado');
  const btnR=document.getElementById('modo-rapido-btn'),btnD=document.getElementById('modo-detalhado-btn');
  if (modo==='rapido'){rapido.style.display='flex';det.style.display='none';btnR.classList.add('active');btnD.classList.remove('active');}
  else{rapido.style.display='none';det.style.display='flex';btnR.classList.remove('active');btnD.classList.add('active');}
};

window.pickRapido = function(el) {
  document.querySelectorAll('.rapido-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');tipoRapido=el.dataset.v;
  document.getElementById('btn-rapido-send').disabled=false;
};

window.enviarRapido = async function() {
  if (!tipoRapido) return;

  // Resolve PC origem e problema antes de checar rate limit
  let pcOrigemId, pcProblemaId, lab, lado;
  if (session.tipo==='professor') {
    const tag=document.getElementById('prof-pc-tag-rapido').value.trim().toUpperCase();
    if (!tag){toast('Informe a tag do PC com problema.','err');return}
    try{
      const rpc=await fetch(`${SB_URL}/rest/v1/pc?tag=eq.${encodeURIComponent(tag)}&select=id,laboratorio,lado`,{headers:H});
      const pcs=await rpc.json();
      if(!Array.isArray(pcs)||!pcs.length){toast('Tag do PC não encontrada.','err');return}
      pcOrigemId=pcs[0].id;pcProblemaId=pcs[0].id;lab=pcs[0].laboratorio;lado=pcs[0].lado;
    }catch(e){toast('Erro ao buscar PC.','err');return}
  } else {
    pcOrigemId=session.id;pcProblemaId=session.id;lab=session.laboratorio;lado=session.lado;
  }

  // Chamados rápidos de professor são sempre emergência → pula rate limit
  const ehEmergencia = session.tipo === 'professor';

  if (!ehEmergencia) {
    const rl = await _checkTicketRateLimit();
    if (rl?.bloqueado) {
      _exibirBloqueioTicket(rl.segundos_restantes || 300);
      return;
    }
  }

  const btn=document.getElementById('btn-rapido-send');btn.classList.add('loading');
  try{
    const r=await fetch(`${SB_URL}/rest/v1/ticket`,{method:'POST',headers:H,body:JSON.stringify({
      pc_origem:pcOrigemId,pc_problema:pcProblemaId,
      tipo:tipoRapido,descricao:'(chamado rápido)',
      laboratorio:lab,lado,status:'aberto',prioridade:'medio',
      aberto_em:new Date().toISOString(),
      nome_solicitante:session.nome,
      chamado_emergencia:ehEmergencia
    })});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();const id=Array.isArray(data)?data[0]?.id:data?.id;
    document.getElementById('suc-id').textContent=`Chamado #${id||'—'}`;
    document.getElementById('overlay').classList.add('open');
    document.querySelectorAll('.rapido-opt').forEach(o=>o.classList.remove('selected'));
    tipoRapido=null;document.getElementById('btn-rapido-send').disabled=true;
    if(session.tipo==='professor')document.getElementById('prof-pc-tag-rapido').value='';
    await carregarChamados();
  }catch(e){toast('Erro ao abrir chamado: '+e.message,'err');}
  finally{btn.classList.remove('loading')}
};

window.trocarAba = function(aba) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('tab-'+aba).classList.add('active');
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
      <div class="t-info"><div class="t-title">${t.tipo||'—'}</div><div class="t-meta">#${t.id} · ${t.laboratorio||'—'} Lado ${t.lado||'—'}</div></div>
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

function tipoIcon(tipo) {
  const s=inner=>`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  if(!tipo)return s('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>');
  const t=tipo.toLowerCase();
  if(t.includes('hardware'))return s('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>');
  if(t.includes('software'))return s('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
  if(t.includes('rede'))return s('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>');
  return s('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>');
}
function statusLabel(s){return{aberto:'Aberto',em_andamento:'Em andamento',resolvido:'Resolvido',descartado:'Descartado',falso_alarme:'Falso alarme'}[s]||s}

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
      return`<div class="msg ${de}">${imgHtml}${textoHtml}<div class="msg-meta">${nomeRem} · ${hora} ${tickHtml}</div></div>`;
    }).join('');
    chat.scrollTop=chat.scrollHeight;
  }catch(e){console.error(e)}
}

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
    .subscribe();
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
    }
    imgsPendentes=[];document.getElementById('img-preview-list').innerHTML='';document.getElementById('img-preview-row').classList.remove('visible');
    if(txt)await fetch(`${SB_URL}/rest/v1/mensagem`,{method:'POST',headers:H,body:JSON.stringify({ticket_id:chatTicketId,remetente:'PC',conteudo:txt,imagem_url:null,enviado_em:new Date().toISOString(),nome_remetente:nomeRemetente})});
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
    wrap.innerHTML=`<img src="${url}" class="img-preview-thumb"/><span class="img-preview-nome">${file.name}</span><button class="img-preview-remove" onclick="removerImgPendente(${imgsPendentes.length-1},this.closest('.img-preview-item'))">✕</button>`;
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

function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

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
  try{
    const r=await fetch(`${SB_URL}/rest/v1/ticket`,{method:'POST',headers:H,body:JSON.stringify({
      pc_origem:pcOrigemId,pc_problema:pcProblemaId,
      tipo,descricao:desc,
      laboratorio:session.laboratorio,lado:session.lado,
      status:'aberto',prioridade:'medio',
      aberto_em:new Date().toISOString(),
      nome_solicitante:session.nome,
      chamado_emergencia:ehEmergencia
    })});
    if(!r.ok){const err=await r.json().catch(()=>({}));throw new Error(err.message||'HTTP '+r.status)}
    const data=await r.json();const id=Array.isArray(data)?data[0]?.id:data?.id;
    document.getElementById('suc-id').textContent=`Chamado #${id||'—'}`;
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
  const profRapido=document.getElementById('prof-pc-tag-rapido');if(profRapido)profRapido.value='';
  tipo=null;tipoRapido=null;
  document.querySelectorAll('.rapido-opt').forEach(o=>o.classList.remove('selected'));
  document.getElementById('btn-rapido-send').disabled=true;
  trocarAba('chamados');
};

window.sair = function() { sessionStorage.removeItem('dsos_session');window.location.href='login.html'; };

function toast(msg,t){
  const el=document.getElementById('toast');el.textContent=msg;el.className=`toast ${t} show`;
  setTimeout(()=>el.classList.remove('show'),3000);
}