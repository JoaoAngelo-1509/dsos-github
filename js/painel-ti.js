// DSos v1.6 — painel-ti.js com Logging Completo (PARTE 1/2)
import { SB, H, SB_KEY } from './supabase-config.js';
import { dsosConfirm } from './dsos-ui.js';
import { escapeHtml } from './ui.js';
import { rtStatusHandler } from './realtime-manager.js';
import { initSessionGuard } from './session-guard.js';
import { initEasterEgg } from './easter-egg.js';
import { logger } from './logging.js';

const sbClient = supabase.createClient(SB, SB_KEY);
let realtimeChannel = null;

let session=null, tickets=[], respondidos=[], descarteFila=[], ocultados=new Set(),
    selectedId=null, filtroAtivo='all', modalTicketId=null, tiMap={}, naoLidasMap={};
let descarteAtual = { pcId: null, ticketId: null };

// ─────────────────────────────────────────────────────────────────────────
// LOGGING: delega para o logger central (fail-safe)
// ─────────────────────────────────────────────────────────────────────────
// DUP-05: este arquivo mantinha um _logEvent próprio — um fetch cru para
// /rpc/<nome> — em vez de usar o singleton de logging.js. Além da
// duplicação, aquele caminho NÃO injetava p_ip_address (o fingerprint de
// dispositivo/navegador que todo o resto do sistema grava), então as ~8
// chamadas de log feitas daqui saíam sem esse campo, apesar do cabeçalho do
// arquivo anunciar "com Logging Completo". Delegando para logger.logEvento,
// o fingerprint e o id de sessão passam a entrar automaticamente.
async function _logEvent(rpcName, params = {}) {
  return logger.logEvento(rpcName, params);
}

const SVG={
  hardware:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  software:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  periferico:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v8"/></svg>`,
  rede:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/></svg>`,
  outro:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/></svg>`,
  trash:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  zap:`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  reopen:`<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>`,
  x:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  clock:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  checkOk:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  user:`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  wrench:`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  check:`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  chat:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  tick1:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  tick2:`<svg width="16" height="11" viewBox="0 0 30 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 9 8 15 18 4"/><polyline points="12 9 18 15 28 4"/></svg>`,
  professor:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>`,
};

function tipoIcon(t)  { return SVG[t?.toLowerCase()]||SVG.outro }
function tipoLabel(t) { return{hardware:'Hardware',software:'Software',periferico:'Periférico',rede:'Rede',outro:'Outro'}[t]||t||'—' }
function statusCor(s) { return{em_andamento:'rr-yellow',resolvido:'rr-green',descartado:'rr-black',falso_alarme:'rr-red'}[s]||'rr-yellow' }
function statusLabel(s){ return{em_andamento:'EM PROGRESSO',resolvido:'RESOLVIDO',descartado:'DESCARTADO',falso_alarme:'FALSO ALARME'}[s]||s }
function statusPill(s){
  const cls={aberto:'sp-aberto',em_andamento:'sp-andamento',resolvido:'sp-resolvido',descartado:'sp-descartado',falso_alarme:'sp-falso'};
  const lbl={aberto:'ABERTO',em_andamento:'EM PROG.',resolvido:'RESOLVIDO',descartado:'DESCARTADO',falso_alarme:'FALSO'};
  return`<span class="spill ${cls[s]||''}">${lbl[s]||s}</span>`;
}
function statusPcPill(s){
  const m={ativo:'pc-ativo',em_manutencao:'pc-manutencao',descartado:'pc-descartado'};
  const l={ativo:'Ativo',em_manutencao:'Em manutenção',descartado:'Descartado'};
  return`<span class="pc-pill ${m[s]||'pc-ativo'}">${l[s]||s||'—'}</span>`;
}
function tecNome(id){ const u=tiMap[id]; return u?(u.nome||u.login):'—' }
// escapeHtml é importado de ./ui.js (fonte única, previne XSS)

/* TEMA */
window.toggleTema=function(){
  if(_opAtiva){notif('⚠ Desative a Ordem paranormal antes de trocar o tema.');return;}
  if(document.documentElement.dataset.hacker==='1'){notif('⚠ Desative o modo hacker antes de trocar o tema.');return;}
  const html=document.documentElement,dark=html.dataset.theme==='dark';
  html.dataset.theme=dark?'light':'dark';
  localStorage.setItem('dsos_tema_login',html.dataset.theme);
  document.getElementById('ico-tema').innerHTML=dark
    ?`<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`
    :`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
};

/* MODO HACKER */
(function _aplicarHacker(){
  if(localStorage.getItem('dsos_hacker')==='1')
    document.documentElement.dataset.hacker='1';
})();
window.toggleHacker=function(){
  if(_opAtiva){notif('⚠ Desative a Ordem paranormal antes de ativar o modo hacker.');const cb=document.getElementById('cfg-hacker');if(cb)cb.checked=false;return;}
  const html=document.documentElement,on=html.dataset.hacker==='1';
  on?delete html.dataset.hacker:html.dataset.hacker='1';
  localStorage.setItem('dsos_hacker',on?'0':'1');
  const cb=document.getElementById('cfg-hacker');if(cb)cb.checked=!on;
};

/* INIT */
window.addEventListener('DOMContentLoaded',async()=>{
  const saved=localStorage.getItem('dsos_tema_login');
  if(saved){
    document.documentElement.dataset.theme=saved;
    if(saved==='light') document.getElementById('ico-tema').innerHTML=`<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  }
  const raw=sessionStorage.getItem('dsos_session');
  if(!raw){window.location.href='login.html';return}
  session=JSON.parse(raw);
  if(session.tipo!=='ti'){window.location.href='login.html';return}

  // Logout automático por inatividade (30min, aviso aos 28min)
  initSessionGuard({onLogout:()=>window.sair()});

  // Marcar técnico como online ao entrar
  fetch(`${SB}/rest/v1/rpc/rpc_set_presenca`,{method:'POST',headers:H,body:JSON.stringify({p_id:session.id,p_presenca:'online'})}).catch(()=>{});
  _presencaAtual='online';
  localStorage.setItem('dsos_presenca','online');

  // ── Heartbeat de sessão ──
  const _pingUrl=`${SB}/rest/v1/rpc/rpc_sessao_ping?apikey=${SB_KEY}`;
  const _encUrl =`${SB}/rest/v1/rpc/rpc_sessao_encerrar?apikey=${SB_KEY}`;
  function _pingBody(){return JSON.stringify({p_usuario_id:session.id,p_usuario_tipo:'ti',p_usuario_login:session.login||'',p_usuario_nome:session.nome||''});}
  fetch(_pingUrl,{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`},body:_pingBody()}).catch(()=>{});
  setInterval(()=>fetch(_pingUrl,{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`},body:_pingBody()}).catch(()=>{}),30000);
  window.addEventListener('beforeunload',()=>navigator.sendBeacon(_encUrl,new Blob([JSON.stringify({p_usuario_id:session.id,p_usuario_tipo:'ti'})],{type:'application/json'})));

  try{
    const r=await fetch(`${SB}/rest/v1/v_usuario_ti_pub?select=id,login,nome,presenca`,{headers:H});
    const lista=await r.json();
    if(Array.isArray(lista))lista.forEach(u=>{tiMap[u.id]=u});
  }catch(e){console.error(e)}

  const _nomeExibir=_cfg.apelido?.trim()||session.nome||session.login;
  document.getElementById('nome-ti').textContent=_nomeExibir;
  if('Notification' in window&&Notification.permission==='default')Notification.requestPermission();

  if (session.professor_id) {
    const btn = document.getElementById('btn-trocar-papel');
    if (btn) btn.style.display = '';
  }

  const now=new Date();
  const dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  document.getElementById('info-data').innerHTML=`${dias[now.getDay()]} <strong>${now.toLocaleDateString('pt-BR')}</strong>`;
  document.getElementById('info-turno').textContent=calcTurno(now);

  // relógio HUD
  function _tickClock(){
    const el=document.getElementById('kpi-clock');if(!el)return;
    const t=new Date();
    const h=String(t.getHours()).padStart(2,'0');
    const m=String(t.getMinutes()).padStart(2,'0');
    const s=String(t.getSeconds()).padStart(2,'0');
    el.textContent=`${h}:${m}:${s}`;
  }
  _tickClock();
  setInterval(_tickClock,1000);

  await Promise.all([carregarTickets(),carregarKPIs(),carregarPCs(),carregarTIs(),carregarProfs(),carregarNaoLidas()]);
  _carregarLabsDisponiveis();

  // ─────────────────────────────────────────────────────────────────────
  // REALTIME — canal principal do painel T.I. (vive por toda a sessão da página)
  // Tabela `ticket`:
  //   INSERT → novo chamado aberto por aluno/professor: recarrega lista+KPIs,
  //            toca som e dispara notificação (emergência tem som/label distintos)
  //   UPDATE → chamado mudou de status/prioridade em qualquer origem: recarrega
  //            lista+KPIs para refletir a mudança em todos os painéis T.I. abertos
  // Tabela `mensagem`:
  //   INSERT → nova mensagem (de PC ou de outro TI): recarrega contagem de não lidas
  //            e toca som se veio do PC
  //   UPDATE → mensagem marcada como lida em outra aba/sessão: recarrega não lidas
  // (usuario_ti/professor propositalmente NÃO estão neste canal — ver bloco abaixo)
  // Quem recebe: todos os técnicos T.I. com o painel aberto (sem filtro por usuário).
  // ─────────────────────────────────────────────────────────────────────
  sbClient.channel('tickets-realtime')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'ticket'},payload=>{
      _scheduleTicketsKPIRefresh();
      const _emerg=payload.new?.chamado_emergencia;
      if(_emerg){notif('⚡ CHAMADO DE EMERGÊNCIA!');(_cfg.sons!==false)&&window._dsosSom?.emergencia?.();}
      else{notif('Novo chamado recebido!');(_cfg.sons!==false)&&window._dsosSom?.novoChamado?.();}
      _browserNotif(_emerg?'⚡ EMERGÊNCIA DSos':'🔔 Novo Chamado',payload.new?.descricao?.slice(0,80)||'Chamado aberto no sistema');
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'ticket'},()=>{_scheduleTicketsKPIRefresh();})
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'mensagem'},payload=>{
      carregarNaoLidas();
      if(payload.new?.remetente==='PC')(_cfg.sons!==false)&&window._dsosSom?.novoChamado?.();
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'mensagem'},()=>carregarNaoLidas())
    .subscribe(rtStatusHandler('tickets-realtime','rt-dot'));

  // ─────────────────────────────────────────────────────────────────────
  // usuario_ti e professor NÃO estão no canal realtime acima de propósito:
  // ambas as tabelas têm coluna de senha (senha / senha_hash) e o Postgres
  // Realtime transmite a LINHA INTEIRA (todas as colunas) para quem estiver
  // escutando — publicar essas tabelas exporia hashes de senha e e-mail a
  // qualquer cliente com a anon key (que é pública, está no bundle do site).
  // Por isso equipe T.I./professores são cobertos só pelo poll abaixo
  // (até 30s de atraso para um cadastro/remoção aparecer noutro painel).
  // Ver docs/REALTIME.md.
  // ─────────────────────────────────────────────────────────────────────
  function _pollEquipe(){carregarTIs();carregarProfs();}
  let _pollTI=setInterval(()=>{_scheduleTicketsKPIRefresh();carregarPCs();carregarNaoLidas();_pollEquipe();},30000);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){clearInterval(_pollTI);_pollTI=null;}
    else{_scheduleTicketsKPIRefresh();carregarPCs();carregarNaoLidas();_pollEquipe();_pollTI=setInterval(()=>{_scheduleTicketsKPIRefresh();carregarPCs();carregarNaoLidas();_pollEquipe();},30000);}
  });
  window.addEventListener('beforeunload',()=>{
    if(session?.id)navigator.sendBeacon(`${SB}/rest/v1/rpc/rpc_set_presenca?apikey=${SB_KEY}`,new Blob([JSON.stringify({p_id:session.id,p_presenca:'ausente'})],{type:'application/json'}));
  });
  setInterval(()=>{document.querySelectorAll('.tr-hora[data-ts]').forEach(el=>{const ts=el.dataset.ts;if(!ts)return;const hora=new Date(ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});el.innerHTML=_sla(ts)||hora;});},60000);
});

function calcTurno(d){const h=d.getHours();if(h>=6&&h<12)return'Manhã';if(h>=12&&h<18)return'Tarde';return'Noite'}

/* NÃO LIDAS */
async function carregarNaoLidas(){
  try{
    const r=await fetch(`${SB}/rest/v1/rpc/rpc_nao_lidas_por_ticket`,{method:'POST',headers:H,body:'{}'});
    const data=await r.json();
    naoLidasMap={};
    if(Array.isArray(data))data.forEach(x=>{naoLidasMap[x.ticket_id]={ti:parseInt(x.nao_lidas_ti)||0,pc:parseInt(x.nao_lidas_pc)||0}});
  }catch(e){console.error('nao_lidas',e)}
  _atualizarBellBadge();
  renderUnresp();
}

function _atualizarBellBadge(){
  const total=Object.values(naoLidasMap).reduce((a,v)=>a+(v.ti||0),0);
  const badge=document.getElementById('bell-count');
  if(badge){badge.textContent=total>99?'99+':String(total);badge.classList.toggle('visible',total>0)}
}

/* BELL PANEL */
let _bellOpen=false;
window.toggleBellPanel=function(){_bellOpen?fecharBellPanel():abrirBellPanel()};
window.fecharBellPanel=function(){
  _bellOpen=false;
  document.getElementById('bell-panel')?.classList.remove('open');
};
async function abrirBellPanel(){
  _bellOpen=true;
  const panel=document.getElementById('bell-panel');
  const list=document.getElementById('bell-panel-list');
  if(!panel||!list)return;
  panel.classList.add('open');
  const unreadIds=Object.entries(naoLidasMap).filter(([,v])=>v.ti>0).map(([id])=>Number(id));
  if(!unreadIds.length){
    list.innerHTML='<div class="bell-empty">Nenhuma mensagem não lida 🎉</div>';
    return;
  }
  list.innerHTML='<div class="bell-loading">Carregando...</div>';
  try{
    const [tRes,mRes]=await Promise.all([
      fetch(`${SB}/rest/v1/ticket?id=in.(${unreadIds.join(',')})&select=id,tipo,laboratorio,descricao,pc_info:pc!ticket_pc_problema_fkey(tag)`,{headers:H}),
      fetch(`${SB}/rest/v1/mensagem?ticket_id=in.(${unreadIds.join(',')})&remetente=eq.PC&order=enviado_em.desc&select=ticket_id,conteudo,enviado_em`,{headers:H}),
    ]);
    const tArr=await tRes.json().then(d=>Array.isArray(d)?d:[]);
    const mArr=await mRes.json().then(d=>Array.isArray(d)?d:[]);
    const ultimaMsg={};
    mArr.forEach(m=>{if(!ultimaMsg[m.ticket_id])ultimaMsg[m.ticket_id]=m;});
    const tMap={};tArr.forEach(t=>tMap[t.id]=t);
    list.innerHTML=unreadIds.map(id=>{
      const t=tMap[id];if(!t)return'';
      const nl=naoLidasMap[id]?.ti||0;
      const tag=t.pc_info?.tag||`PC #${id}`;
      const msg=ultimaMsg[id];
      const msgHtml=msg
        ?`<div class="bell-item-msg">${escapeHtml((msg.conteudo||'(imagem)').slice(0,80))}</div>`
        :'';
      return`<div class="bell-item" onclick="window._bellAbrirTicket(${id})">
        <div class="bell-item-top">
          <span class="bell-item-tag">${escapeHtml(tag)}</span>
          <span class="bell-item-lab">${escapeHtml(t.laboratorio||'')}</span>
          <span class="bell-item-badge">${nl}</span>
        </div>
        <div class="bell-item-tipo">${tipoLabel(t.tipo)}</div>
        ${msgHtml}
      </div>`;
    }).join('');
  }catch(e){list.innerHTML='<div class="bell-empty">Erro ao carregar.</div>'}
}
window._bellAbrirTicket=function(id){
  fecharBellPanel();
  selecionarTicket(id);
  marcarLidoTi(id);
};
document.addEventListener('click',e=>{
  if(_bellOpen&&!document.getElementById('bell-wrap')?.contains(e.target))fecharBellPanel();
});

// ─────────────────────────────────────────────────────────────────────
// COALESCE de refresh tickets+KPIs (realtime + poll de 30s)
// Sem isso, dois eventos próximos (ex: dois técnicos agindo quase ao mesmo
// tempo, ou um evento realtime chegando junto com o poll) disparavam fetches
// sobrepostos — e como não há garantia de ordem de resposta, o fetch mais
// lento podia sobrescrever a tela com dados já desatualizados. Aqui, chamadas
// próximas são agrupadas (debounce de 300ms) e, se um refresh já está em
// andamento, a próxima é apenas enfileirada (no máx. 1 pendente) em vez de
// disparar em paralelo.
// ─────────────────────────────────────────────────────────────────────
let _tkRefreshTimer=null,_tkRefreshInFlight=false,_tkRefreshQueued=false;
function _scheduleTicketsKPIRefresh(){
  clearTimeout(_tkRefreshTimer);
  _tkRefreshTimer=setTimeout(_runTicketsKPIRefresh,300);
}
async function _runTicketsKPIRefresh(){
  if(_tkRefreshInFlight){_tkRefreshQueued=true;return}
  _tkRefreshInFlight=true;
  try{await Promise.all([carregarTickets(),carregarKPIs(true)]);}
  finally{
    _tkRefreshInFlight=false;
    if(_tkRefreshQueued){_tkRefreshQueued=false;_runTicketsKPIRefresh();}
  }
}

/* KPIs */
async function carregarKPIs(pulse=false){
  try{
    const hoje=new Date().toISOString().split('T')[0];
    const ontem=new Date(Date.now()-86400000).toISOString().split('T')[0];
    const [rHoje,rOntem,rResHoje,rResOntem,rPend]=await Promise.all([
      fetch(`${SB}/rest/v1/ticket?aberto_em=gte.${hoje}T00:00:00&select=id`,{headers:H}),
      fetch(`${SB}/rest/v1/ticket?aberto_em=gte.${ontem}T00:00:00&aberto_em=lt.${hoje}T00:00:00&select=id`,{headers:H}),
      // "Resolvidos hoje" = resolvido/descartado HOJE, independente de quando foi aberto
      // (filtrar por aberto_em fazia o KPI nunca subir: um chamado aberto ontem e
      // resolvido hoje não entrava na contagem, então ficava travado em 0 na prática).
      fetch(`${SB}/rest/v1/ticket?resolvido_em=gte.${hoje}T00:00:00&status=in.(resolvido,descartado)&select=id`,{headers:H}),
      fetch(`${SB}/rest/v1/ticket?resolvido_em=gte.${ontem}T00:00:00&resolvido_em=lt.${hoje}T00:00:00&status=in.(resolvido,descartado)&select=id`,{headers:H}),
      fetch(`${SB}/rest/v1/ticket?status=in.(aberto,em_andamento)&select=id`,{headers:H}),
    ]);
    const arr=d=>Array.isArray(d)?d:[];
    const abertosHoje=arr(await rHoje.json()).length;
    const abertosOntem=arr(await rOntem.json()).length;
    const resolvidosHoje=arr(await rResHoje.json()).length;
    const resolvidosOntem=arr(await rResOntem.json()).length;
    const pend=await rPend.json();
    _setKpiValor('kpi-pendentes',arr(pend).length,pulse);
    _setKpiValor('kpi-resolvidos',resolvidosHoje,pulse);
    _setKpiValor('kpi-hoje',abertosHoje,pulse);
    _setTrend('kpi-trend-resolvidos',resolvidosHoje,resolvidosOntem,true);
    _setTrend('kpi-trend-hoje',abertosHoje,abertosOntem,false);
  }catch(e){console.error(e)}
}
// Atualiza o número e, se mudou e pulse=true (refresh vindo de realtime/poll,
// não da carga inicial), dispara uma animação curta para sinalizar "ao vivo".
function _setKpiValor(id,val,pulse){
  const el=document.getElementById(id);if(!el)return;
  const changed=el.textContent!==String(val);
  el.textContent=val;
  if(pulse&&changed){
    el.classList.remove('kpi-pulse');
    void el.offsetWidth;
    el.classList.add('kpi-pulse');
  }
}
function _setTrend(elId,hoje,ontem,upIsGood){
  const el=document.getElementById(elId);if(!el)return;
  const diff=hoje-ontem;
  el.className='kpi-trend';
  if(diff===0){el.textContent='= ontem';el.classList.add('neutral');return;}
  const isGood=(diff>0)===upIsGood;
  el.textContent=(diff>0?'↑':'↓')+' '+Math.abs(diff)+' vs ontem';
  el.classList.add(isGood?'up':'down');
}

/* FETCH TICKETS */
async function carregarTickets(q=''){
  try{
    const qF=q?`&or=(descricao.ilike.*${encodeURIComponent(q)}*,laboratorio.ilike.*${encodeURIComponent(q)}*,tipo.ilike.*${encodeURIComponent(q)}*)`:'';
    const [r1,r2,r3]=await Promise.all([
      fetch(`${SB}/rest/v1/ticket?status=in.(aberto,em_andamento)${qF}&order=aberto_em.asc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}),
      fetch(`${SB}/rest/v1/ticket?status=in.(resolvido,descartado,falso_alarme,em_andamento)${qF}&order=aberto_em.desc&limit=200&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}),
      fetch(`${SB}/rest/v1/ticket?resolucao=eq.descarte&order=resolvido_em.desc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}),
    ]);
    let rawR1=await r1.json().then(d=>Array.isArray(d)?d:[]);
    let rawR2=await r2.json().then(d=>Array.isArray(d)?d:[]);
    if(q){
      const ql=q.toLowerCase(),matchTag=t=>t.pc_info?.tag?.toLowerCase().includes(ql);
      const [rt1,rt2]=await Promise.all([
        fetch(`${SB}/rest/v1/ticket?status=in.(aberto,em_andamento)&order=aberto_em.asc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}).then(r=>r.json()).then(d=>Array.isArray(d)?d.filter(matchTag):[]),
        fetch(`${SB}/rest/v1/ticket?status=in.(resolvido,descartado,falso_alarme,em_andamento)&order=aberto_em.desc&limit=200&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}).then(r=>r.json()).then(d=>Array.isArray(d)?d.filter(matchTag):[]),
      ]);
      const merge=(a,b)=>{const ids=new Set(a.map(x=>x.id));return[...a,...b.filter(x=>!ids.has(x.id))]};
      rawR1=merge(rawR1,rt1);rawR2=merge(rawR2,rt2);
    }
    tickets=rawR1;
    respondidos=rawR2.filter(t=>!ocultados.has(t.id));
    descarteFila=await r3.json().then(d=>Array.isArray(d)?d:[]);
  }catch(e){console.error(e);tickets=[]}
  renderUnresp();renderResp();renderDescarte();_atualizarBadgeGrupo();
  _renderFiltroChips();
}

/* SLA — tempo decorrido desde abertura */
function _sla(aberto_em) {
  if (!aberto_em) return '';
  const ms = Date.now() - new Date(aberto_em).getTime();
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const dias = Math.floor(hrs / 24);
  let label, cor;
  if (dias >= 1)       { label = dias + 'd ' + (hrs % 24) + 'h'; cor = '#ef4444'; }
  else if (hrs >= 2)   { label = hrs + 'h ' + (mins % 60) + 'min'; cor = '#f97316'; }
  else if (mins >= 30) { label = mins + 'min'; cor = '#eab308'; }
  else                 { label = (mins || 1) + 'min'; cor = '#22c55e'; }
  return `<span style="font-size:.5rem;font-weight:700;color:${cor};letter-spacing:.04em;display:block;line-height:1.2">${label}</span>`;
}

/* ═══════════════════════════════════════════
   FILTRO DE CHIPS (tipo + lab)
═══════════════════════════════════════════ */
let _filtroChip={tipo:null,lab:null};
const _TIPOS_CHIP=[{v:'hardware',l:'Hardware'},{v:'software',l:'Software'},{v:'rede',l:'Rede'},{v:'outro',l:'Outro'}];

let _labsDisponiveis=[];
async function _carregarLabsDisponiveis(){
  try{
    const r=await fetch(`${SB}/rest/v1/pc?select=laboratorio&order=laboratorio.asc`,{headers:H});
    const data=await r.json();
    if(Array.isArray(data))
      _labsDisponiveis=[...new Set(data.map(p=>p.laboratorio).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt'));
  }catch(e){}
  _renderFiltroChips();
}
function _renderFiltroChips(){
  const el=document.getElementById('filtro-chips');if(!el)return;
  const chip=(label,ativo,onclick)=>`<button class="fchip${ativo?' active':''}" onclick="${onclick}">${label}</button>`;
  const labSel=_labsDisponiveis.length
    ?`<span class="fchip-sep"></span><select class="fchip-lab-sel" onchange="_setFiltroLab(this.value)">
        <option value="">Laboratório</option>
        ${_labsDisponiveis.map(lb=>`<option value="${lb.replace(/"/g,'&quot;')}"${_filtroChip.lab===lb?' selected':''}>${lb}</option>`).join('')}
      </select>`
    :'';
  el.innerHTML=
    chip('Todos',!_filtroChip.tipo&&!_filtroChip.lab,"_setFiltro('tipo',null)")+
    _TIPOS_CHIP.map(t=>chip(t.l,_filtroChip.tipo===t.v,`_setFiltro('tipo','${t.v}')`)).join('')+
    labSel;
}
window._setFiltroLab=function(val){
  _filtroChip.lab=val||null;
  if(_filtroChip.lab)_filtroChip.tipo=null;
  _renderFiltroChips();renderUnresp();
};
window._setFiltro=function(dim,val){
  if(dim==='tipo'){
    _filtroChip.tipo=_filtroChip.tipo===val?null:val;
    if(_filtroChip.tipo)_filtroChip.lab=null;
  }else{
    _filtroChip.lab=_filtroChip.lab===val?null:val;
    if(_filtroChip.lab)_filtroChip.tipo=null;
  }
  _renderFiltroChips();renderUnresp();
};

/* ═══════════════════════════════════════════
   HOVER PREVIEW
═══════════════════════════════════════════ */
(function(){
  const prev=document.createElement('div');
  prev.id='hover-preview';
  document.body.appendChild(prev);
  let _hoverTimer=null;

  document.getElementById('unresp-list').addEventListener('mouseover',e=>{
    const row=e.target.closest('.ticket-row');
    if(!row)return;
    clearTimeout(_hoverTimer);
    _hoverTimer=setTimeout(()=>{
      const id=parseInt(row.onclick?.toString().match(/\d+/)?.[0]||0);
      const t=tickets.find(x=>x.id===id);
      if(!t)return;
      const sla=_sla(t.aberto_em);
      const hora=t.aberto_em?new Date(t.aberto_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
      prev.innerHTML=`
        <div class="hp-title">${escapeHtml(t.pc_info?.tag||'PC #'+t.pc_problema)} — ${tipoLabel(t.tipo)}</div>
        <div class="hp-meta">
          <span>${escapeHtml(t.laboratorio||'—')} · Lado ${escapeHtml(t.lado||'—')}</span>
          ${t.nome_solicitante?`<span>👤 ${escapeHtml(t.nome_solicitante)}</span>`:''}
          <span>🕐 ${hora}</span>
        </div>
        ${sla?`<span class="hp-sla">${sla}</span>`:''}
        <div class="hp-desc">${escapeHtml(t.descricao||'(sem descrição)')}</div>
        ${t.nota_interna?`<div style="margin-top:4px;padding:5px 7px;background:rgba(192,23,26,.08);border-left:2px solid var(--red);border-radius:0 4px 4px 0;font-size:.6rem;color:var(--text2)">📝 ${escapeHtml(t.nota_interna)}</div>`:''}
      `;
      const r=row.getBoundingClientRect();
      prev.style.display='flex';
      const pw=prev.offsetWidth||280;
      const left=r.right+8+pw>window.innerWidth?r.left-pw-8:r.right+8;
      prev.style.left=left+'px';
      prev.style.top=Math.min(r.top,window.innerHeight-prev.offsetHeight-8)+'px';
    },380);
  });
  document.getElementById('unresp-list').addEventListener('mouseleave',()=>{
    clearTimeout(_hoverTimer);prev.style.display='none';
  });
  document.getElementById('unresp-list').addEventListener('click',()=>{
    clearTimeout(_hoverTimer);prev.style.display='none';
  });
})();

/* RENDER NÃO RESPONDIDOS */
let _agruparLab=false;
function renderUnresp(){
  const list=document.getElementById('unresp-list');
  const todosAbertos=tickets.filter(t=>t.status==='aberto'||t.status==='em_andamento');
  document.getElementById('badge-unresp').textContent=todosAbertos.length;
  let abertos=todosAbertos;
  if(_filtroChip.tipo)abertos=abertos.filter(t=>t.tipo===_filtroChip.tipo);
  if(_filtroChip.lab)abertos=abertos.filter(t=>t.laboratorio===_filtroChip.lab);
  // Ordenação configurável
  if(_cfg.ordem==='desc')abertos=[...abertos].sort((a,b)=>new Date(b.aberto_em)-new Date(a.aberto_em));
  else if(_cfg.ordem==='prioridade'){const p={alto:0,medio:1,baixo:2};abertos=[...abertos].sort((a,b)=>(p[a.prioridade]??3)-(p[b.prioridade]??3));}
  if(!abertos.length){list.innerHTML=`<div class="empty"><div class="eicon">${SVG.checkOk}</div><p>Nenhum chamado pendente</p></div>`;atualizarBotoes();return}

  // Feature 5: contagem por PC nos últimos 30 dias
  const cutoff30=Date.now()-30*86400000;
  const pcCounts={};
  [...tickets,...respondidos].forEach(t=>{
    if(t.aberto_em&&new Date(t.aberto_em).getTime()>=cutoff30)
      pcCounts[t.pc_problema]=(pcCounts[t.pc_problema]||0)+1;
  });

  const rowHtml=t=>{
    const emerg=t.chamado_emergencia||(t.pc_origem!==t.pc_problema);
    const hora=t.aberto_em?new Date(t.aberto_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
    const sla=_sla(t.aberto_em);
    const nome=escapeHtml(t.nome_solicitante||'(sem nome)');
    const tec=t.tecnico_responsavel?`<span style="color:var(--green);display:inline-flex;align-items:center;gap:2px;margin-left:4px">${SVG.wrench} ${tecNome(t.tecnico_responsavel)}</span>`:'';
    const nl=naoLidasMap[t.id]?.ti||0;
    const nlHtml=nl>0?`<span class="ticket-unread-badge visible">${SVG.chat} ${nl}</span>`:'';
    const cnt=pcCounts[t.pc_problema]||0;
    const recBadge=cnt>=3?`<span style="font-size:.46rem;font-weight:700;color:#fff;background:#ef4444;border-radius:3px;padding:1px 4px;margin-left:3px" title="${cnt} chamados nos últimos 30 dias">⚠${cnt}x</span>`:'';
    return`<div class="ticket-row${emerg?' emergency':''}${selectedId===t.id?' selected':''}" onclick="selecionarTicket(${t.id})" style="position:relative">
      <div class="tr-icon">${tipoIcon(t.tipo)}</div>
      <div class="tr-main">
        <div class="tr-id">${escapeHtml(t.pc_info?.tag||'PC #'+(t.pc_problema||'—'))} / ${tipoLabel(t.tipo)}${emerg?`<span class="emerg-tag">${SVG.zap} EMERG.</span>`:''} ${recBadge}</div>
        <div class="tr-sub">#${t.id}${t.lado?' · lado '+escapeHtml(t.lado):''}${t.laboratorio?' · '+escapeHtml(t.laboratorio):''}</div>
        <div class="tr-nome">${SVG.user} ${nome}${tec}</div>
      </div>
      <div class="tr-hora" data-ts="${t.aberto_em||''}" title="Aberto às ${hora}">${sla||hora}</div>
      <div class="tr-status">${statusPill(t.status)}${nlHtml}</div>
    </div>`;
  };

  // Feature 3: agrupamento por laboratório
  if(_agruparLab){
    const grupos={};
    abertos.forEach(t=>{const k=t.laboratorio||'—';if(!grupos[k])grupos[k]=[];grupos[k].push(t);});
    list.innerHTML=Object.entries(grupos).sort(([a],[b])=>a.localeCompare(b,'pt')).map(([lab,ts])=>
      `<div style="font-size:.57rem;font-weight:700;letter-spacing:.07em;color:var(--muted);padding:7px 10px 3px;border-bottom:1px solid var(--glass-b);margin-bottom:3px;margin-top:4px">${escapeHtml(lab)} <span style="font-weight:400;opacity:.65">(${ts.length})</span></div>`
      +ts.map(rowHtml).join('')
    ).join('');
  } else {
    list.innerHTML=abertos.map(rowHtml).join('');
  }
  atualizarBotoes();
  _atualizarKbDicas();
}
window.toggleAgruparLab=function(){
  _agruparLab=!_agruparLab;
  const btn=document.getElementById('btn-agrupar-lab');
  if(btn)btn.style.opacity=_agruparLab?'1':'.5';
  renderUnresp();
  notif(_agruparLab?'Agrupado por laboratório':'Lista normal');
};

/* RENDER RESPONDIDOS */
function renderResp(){
  const list=document.getElementById('resp-list'),empty=document.getElementById('resp-empty');
  let data=filtroAtivo!=='all'?respondidos.filter(r=>r.status===filtroAtivo):respondidos;
  document.getElementById('badge-resp').textContent=respondidos.length;
  empty.style.display=data.length?'none':'flex';
  list.querySelectorAll('.resp-row').forEach(c=>c.remove());
  data.forEach(t=>{
    const div=document.createElement('div');
    div.className=`resp-row ${statusCor(t.status)}`;
    const d=t.aberto_em?new Date(t.aberto_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}):'—';
    const tec=t.tecnico_responsavel?`${SVG.wrench} ${tecNome(t.tecnico_responsavel)}`:'—';
    div.innerHTML=`
      <div class="tr-icon">${tipoIcon(t.tipo)}</div>
      <div style="min-width:0"><div class="rc-id">${escapeHtml(t.pc_info?.tag||'PC #'+(t.pc_problema||'—'))} / ${tipoLabel(t.tipo)}</div><div style="font-size:.54rem;color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:3px">${tec}</div></div>
      <div class="rc-date">${d}</div>
      <div>${statusPill(t.status)}</div>
      <button class="rc-reopen" onclick="reabrirTicket(${t.id},event)">${SVG.reopen} REABRIR</button>
      <button class="rc-dismiss" onclick="dispensar(${t.id},event)">${SVG.x}</button>`;
    div.addEventListener('click',e=>{if(e.target.closest('.rc-dismiss')||e.target.closest('.rc-reopen'))return;abrirModal(t,false)});
    list.appendChild(div);
  });
}

/* RENDER DESCARTE */
function renderDescarte(){
  const list=document.getElementById('desc-list'),empty=document.getElementById('desc-empty');
  document.getElementById('badge-descarte').textContent=descarteFila.length;
  empty.style.display=descarteFila.length?'none':'flex';
  list.querySelectorAll('.desc-row').forEach(c=>c.remove());
  descarteFila.forEach(t=>{
    const div=document.createElement('div');
    const pcTag=t.pc_info?.tag||`#${t.pc_problema}`;
    const pcStatus=t.pc_info?.status_pc||'descartado';
    const item=t.item_descartado||'(item não especificado)';
    const d=t.resolvido_em?new Date(t.resolvido_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const feito=pcStatus==='descartado'||!!t.descricao_resolucao;
    const itemEsc=item.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const descEsc=(t.descricao||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    div.className=`desc-row${feito?' done':''}`;
    div.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:center;color:var(--orange)">${SVG.trash}</div>
      <div style="min-width:0"><div class="desc-pc">${escapeHtml(pcTag)}</div><div class="desc-item" title="${escapeHtml(item)}">${escapeHtml(item)}</div><div class="desc-sub">${SVG.wrench} ${tecNome(t.tecnico_responsavel)} · #${t.id}</div></div>
      <div class="desc-date">${d}</div>
      <div>${statusPcPill(pcStatus)}</div>
      <div style="text-align:right">${feito
        ?`<span class="done-label">${SVG.check} Concluído</span>`
        :`<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
           <button class="btn-desc-ok" onclick="abrirModalDescarte(${t.pc_problema},${t.id},'${itemEsc}','${descEsc}',event)">${SVG.trash} Feito</button>
           <button class="btn-desc-cancel-fila" onclick="cancelarItemDescarte(${t.id},${t.pc_problema},event)">Cancelar</button>
         </div>`
      }</div>`;
    list.appendChild(div);
  });
}

/* ABAS */
const _ultimaAba={chamados:'abertos',gestao:'pcs'};
const _grupoDeAba={abertos:'chamados',respondidos:'chamados',descarte:'chamados',pcs:'gestao',ti:'gestao',professores:'gestao',manutencao:'gestao'};
window.mudarAba=function(aba){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('tab-'+aba)?.classList.add('active');
  document.getElementById('panel-'+aba)?.classList.add('active');
  const grupo=_grupoDeAba[aba];if(grupo)_ultimaAba[grupo]=aba;
  if(aba==='manutencao')resetAbaManutencao();
  _atualizarBadgeGrupo();
};
window.mudarGrupo=function(grupo){
  document.querySelectorAll('.grupo-pill').forEach(p=>p.classList.remove('active'));
  document.getElementById('grupo-'+grupo)?.classList.add('active');
  document.getElementById('tabs-chamados').style.display=grupo==='chamados'?'':'none';
  document.getElementById('tabs-gestao').style.display=grupo==='gestao'?'':'none';
  mudarAba(_ultimaAba[grupo]);
};
function _atualizarBadgeGrupo(){
  const unresp=parseInt(document.getElementById('badge-unresp')?.textContent)||0;
  const desc=parseInt(document.getElementById('badge-descarte')?.textContent)||0;
  const total=unresp+desc;
  const badge=document.getElementById('grupo-badge-chamados');
  if(badge){badge.textContent=total;badge.style.display=total>0?'':'none'}
}

/* SELECIONAR */
window.selecionarTicket=function(id){
  if(selectedId===id){const t=tickets.find(x=>x.id===id);if(t)abrirModal(t,false);return}
  selectedId=id;renderUnresp();
};
function atualizarBotoes(){
  const has=!!selectedId;
  ['btn-progresso','btn-resolvido','btn-descartado','btn-falso'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!has});
}

/* SET STATUS */
window.setStatus=async function(s){
  if(!selectedId)return;
  const t=tickets.find(x=>x.id===selectedId);if(!t)return;
  const pcTag=t.pc_info?.tag||t.pc_problema||'—';
  if(s==='em_andamento'&&!await dsosConfirm({msg:`Colocar chamado #${t.id} (PC ${pcTag}) como EM PROGRESSO?`,tipo:'info',titulo:'Alterar status'}))return;
  else if(s==='descartado'){abrirMiniModalDescarte(t);return;}
  else if(s==='falso_alarme'&&!await dsosConfirm({msg:`Marcar chamado #${t.id} (PC ${pcTag}) como FALSO ALARME?`,tipo:'warning',titulo:'Falso alarme'}))return;
  const body={status:s,tecnico_responsavel:session.id};
  if(s==='falso_alarme')body.resolvido_em=new Date().toISOString();
  try{
    await fetch(`${SB}/rest/v1/ticket?id=eq.${selectedId}`,{method:'PATCH',headers:H,body:JSON.stringify(body)});
    
    // ━━ LOGGING (alterar status) ━━
    _logEvent('rpc_log_alterar_status_chamado', {
      p_usuario_id:    session.id,
      p_usuario_tipo:  session.tipo || 'ti',
      p_usuario_login: session.login || '',
      p_usuario_nome:  session.nome  || '',
      p_ticket_id:     selectedId,
      p_status_anterior: t.status || null,
      p_status_novo:   s
    });

    notif(statusLabel(s)+' — atualizado');
    if(['resolvido','descartado','falso_alarme'].includes(s))(_cfg.sons!==false)&&window._dsosSom?.chamadoResolvido?.();
    selectedId=null;
    await Promise.all([carregarTickets(),carregarKPIs(true)]);
  }catch(e){notif('Erro ao atualizar chamado.')}
};
window.abrirResolucao=function(){if(!selectedId)return;const t=tickets.find(x=>x.id===selectedId);if(t)abrirModal(t,true)};

/* MINI-MODAL DESCARTE */
let _descarteTicket=null;
function abrirMiniModalDescarte(t){
  _descarteTicket=t;
  document.getElementById('mini-item-input').value='';
  document.getElementById('mini-pc-tag').textContent=t.pc_info?.tag||`#${t.pc_problema}`;
  document.getElementById('mini-modal-descarte').classList.add('open');
  setTimeout(()=>document.getElementById('mini-item-input').focus(),80);
}
window.fecharMiniModalDescarte=function(){document.getElementById('mini-modal-descarte').classList.remove('open');_descarteTicket=null;};
window.confirmarEnvioFila=async function(){
  const item=document.getElementById('mini-item-input').value.trim();
  if(!item){document.getElementById('mini-item-input').focus();return}
  if(!_descarteTicket)return;
  const t=_descarteTicket;window.fecharMiniModalDescarte();
  try{
    await fetch(`${SB}/rest/v1/ticket?id=eq.${t.id}`,{method:'PATCH',headers:H,body:JSON.stringify({status:'descartado',resolucao:'descarte',resolvido_em:new Date().toISOString(),tecnico_responsavel:session.id,item_descartado:item})});
    await fetch(`${SB}/rest/v1/pc?id=eq.${t.pc_problema}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({status_pc:'em_manutencao'})});
    
    // ━━ LOGGING (envio fila) ━━
    _logEvent('rpc_log_descarte_equipment', {
      p_usuario_id:    session.id,
      p_usuario_tipo:  session.tipo || 'ti',
      p_usuario_login: session.login || '',
      p_usuario_nome:  session.nome  || '',
      p_ticket_id:     t.id,
      p_pc_tag:        t.pc_info?.tag || '',
      p_item_descartado: item,
      p_meio_descarte: null
    });

    notif('Enviado para fila de descarte');selectedId=null;
    await Promise.all([carregarTickets(),carregarKPIs(true),carregarPCs()]);
  }catch(e){notif('Erro ao enviar para fila.')}
};
document.getElementById('mini-modal-descarte')?.addEventListener('click',e=>{if(e.target===document.getElementById('mini-modal-descarte'))window.fecharMiniModalDescarte()});
document.getElementById('mini-item-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')window.confirmarEnvioFila()});

/* MODAL TICKET */
function abrirModal(t,comResolucao){
  _renderRespostasRapidas();
  modalTicketId=t.id;
  document.getElementById('m-title').textContent=`#${t.id} — ${t.pc_info?.tag||'PC #'+(t.pc_problema||'—')} / ${tipoLabel(t.tipo)}`;
  const dt=t.aberto_em?new Date(t.aberto_em):null;
  document.getElementById('m-time').innerHTML=dt?`${SVG.clock} ${dt.toLocaleString('pt-BR')}`:'';
  document.getElementById('m-turno').textContent=dt?`Turno: ${calcTurno(dt)}`:'—';
  document.getElementById('m-origem-label').textContent=`Origem: PC #${t.pc_origem||'—'}`;
  const solEl=document.getElementById('m-solicitante');
  if(t.nome_solicitante){solEl.innerHTML=`${SVG.user} ${escapeHtml(t.nome_solicitante)}`;solEl.style.cssText='display:inline-flex;align-items:center;gap:4px'}
  else{solEl.textContent='';solEl.style.display='none'}
  const tecWrap=document.getElementById('m-tecnico-wrap');
  if(t.tecnico_responsavel){document.getElementById('m-tecnico').innerHTML=`${SVG.wrench} ${tecNome(t.tecnico_responsavel)}`;tecWrap.style.display='block'}
  else tecWrap.style.display='none';
  document.getElementById('m-pc').textContent=t.pc_info?.tag||`PC #${t.pc_problema||'—'}`;
  document.getElementById('m-lab').textContent=`${t.laboratorio||'—'} — Lado ${t.lado||'—'}`;
  document.getElementById('m-tipo').textContent=tipoLabel(t.tipo);
  document.getElementById('m-prio').value=t.prioridade||'medio';
  document.getElementById('m-desc').textContent=t.descricao||'(sem descrição)';
  const rw=document.getElementById('m-res-wrap');
  if(t.descricao_resolucao){document.getElementById('m-res-desc').textContent=t.descricao_resolucao;rw.style.display='block'}
  else rw.style.display='none';
  document.getElementById('resolve-bar').style.display=comResolucao?'flex':'none';
  document.getElementById('res-tipo').value='';
  document.getElementById('res-desc').value='';
  document.getElementById('item-desc').style.display='none';
  document.getElementById('m-nota-interna').value=t.nota_interna||'';
  document.getElementById('m-nota-salva').style.display='none';
  document.getElementById('modal').classList.add('open');
  removerImgTi();
  const ativo=t.status==='aberto'||t.status==='em_andamento';
  const btnSug=document.getElementById('btn-sugerir-resp');
  if(btnSug)btnSug.disabled=!ativo;
  iniciarChat(t.id,ativo);
  if(ativo)marcarLidoTi(t.id);
  _aiResumoModal(t);
}
async function marcarLidoTi(ticketId){
  try{
    await fetch(`${SB}/rest/v1/rpc/rpc_marcar_lido_ti`,{method:'POST',headers:H,body:JSON.stringify({p_ticket_id:ticketId})});
    if(naoLidasMap[ticketId])naoLidasMap[ticketId].ti=0;
    _atualizarBellBadge();renderUnresp();
  }catch(e){console.error('marcarLidoTi',e)}
}
window.fecharModal=function(){
  document.getElementById('modal').classList.remove('open');
  modalTicketId=null;
  if(realtimeChannel){sbClient.removeChannel(realtimeChannel);realtimeChannel=null;}
};
document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))window.fecharModal()});

/* NOTA INTERNA */
window.salvarNotaInterna=async function(){
  if(!modalTicketId)return;
  const nota=document.getElementById('m-nota-interna').value.trim();
  try{
    await fetch(`${SB}/rest/v1/ticket?id=eq.${modalTicketId}`,{method:'PATCH',headers:H,body:JSON.stringify({nota_interna:nota||null})});
    const t=tickets.find(x=>x.id===modalTicketId)||respondidos.find(x=>x.id===modalTicketId);
    if(t)t.nota_interna=nota||null;
    const el=document.getElementById('m-nota-salva');
    el.style.display='inline';setTimeout(()=>el.style.display='none',2500);
  }catch(e){notif('Erro ao salvar nota.');}
};

/* PRIORIDADE */
window.salvarPrioridade=async function(){
  if(!modalTicketId)return;
  await fetch(`${SB}/rest/v1/ticket?id=eq.${modalTicketId}`,{method:'PATCH',headers:H,body:JSON.stringify({prioridade:document.getElementById('m-prio').value})});
  notif('Prioridade atualizada');await carregarTickets();
};

/* RESOLUÇÃO */
window.toggleItemDesc=function(){document.getElementById('item-desc').style.display=document.getElementById('res-tipo').value==='descarte'?'block':'none';};
window.confirmarResolucao=async function(){
  const tipo=document.getElementById('res-tipo').value;
  if(!tipo){notif('Selecione o tipo de resolução.');return}
  if(_cfg.confirmarResolver&&tipo!=='descarte'){
    const ok=await dsosConfirm({msg:'Confirma a resolução deste chamado?',tipo:'info',titulo:'Resolver chamado'});
    if(!ok)return;
  }
  const descRes=document.getElementById('res-desc').value.trim();
  if(tipo==='descarte'){
    const t=tickets.find(x=>x.id===modalTicketId)||respondidos.find(x=>x.id===modalTicketId);
    if(t){window.fecharModal();setTimeout(()=>abrirMiniModalDescarte(t),120);}
    return;
  }
  const statusMap={consertado:'resolvido',aguardando_peca:'em_andamento'};
  const pcStatusMap={consertado:'ativo',aguardando_peca:'em_manutencao'};
  const novoStatus=statusMap[tipo];
  const body={status:novoStatus,resolucao:tipo,resolvido_em:novoStatus==='resolvido'?new Date().toISOString():null,tecnico_responsavel:session.id,descricao_resolucao:descRes||null};
  const t=tickets.find(x=>x.id===modalTicketId);
  if(t){
    const rotulo={consertado:'CONSERTADO',aguardando_peca:'AGUARDANDO PEÇA'}[tipo]||tipo;
    if(!await dsosConfirm({msg:`Confirmar "${rotulo}" para chamado #${t.id}?${descRes?'\nResumo: '+descRes:''}`,tipo:'info',titulo:'Resolver chamado'}))return;
  }
  try{
    const r=await fetch(`${SB}/rest/v1/ticket?id=eq.${modalTicketId}`,{method:'PATCH',headers:H,body:JSON.stringify(body)});
    const updated=await r.json();
    const pcId=Array.isArray(updated)&&updated[0]?updated[0].pc_problema:null;
    if(pcId&&pcStatusMap[tipo])
      await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({status_pc:pcStatusMap[tipo]})});
    
    // ━━ LOGGING (confirmar resolução) ━━
    _logEvent('rpc_log_alterar_status_chamado', {
      p_usuario_id:    session.id,
      p_usuario_tipo:  session.tipo || 'ti',
      p_usuario_login: session.login || '',
      p_usuario_nome:  session.nome  || '',
      p_ticket_id:     modalTicketId,
      p_status_anterior: t?.status || null,
      p_status_novo:   novoStatus
    });

    notif('Chamado resolvido!');(_cfg.sons!==false)&&window._dsosSom?.chamadoResolvido?.();
    if(selectedId===modalTicketId)selectedId=null;
    window.fecharModal();
    await Promise.all([carregarTickets(),carregarKPIs(true)]);
  }catch(e){notif('Erro ao resolver chamado.')}
};
/* ─────────────────────────────────────────────────────────────────────────── */
/* CONTINUAR DO ARQUIVO PARTE 1 - COPIE E COLE ABAIXO APÓS A PARTE 1          */
/* ─────────────────────────────────────────────────────────────────────────── */

/* MODAL DESCARTE FÍSICO */
window.abrirModalDescarte=function(pcId,ticketId,itemDescartado,descricao,e){
  if(e)e.stopPropagation();
  descarteAtual={pcId,ticketId};
  document.getElementById('desc-oque').value=(itemDescartado&&itemDescartado!=='(item não especificado)')?itemDescartado:'';
  document.getElementById('desc-porque').value=descricao||'Sem conserto viável — identificado pelo T.I.';
  document.getElementById('desc-como').value='';
  document.getElementById('desc-pc-completo').checked=false;
  document.getElementById('modal-descarte').classList.add('open');
  setTimeout(()=>document.getElementById('desc-oque').focus(),120);
};
window.fecharModalDescarte=function(){document.getElementById('modal-descarte').classList.remove('open');descarteAtual={pcId:null,ticketId:null};};
document.getElementById('modal-descarte').addEventListener('click',e=>{if(e.target===document.getElementById('modal-descarte'))window.fecharModalDescarte()});
window.confirmarDescarteFisico=async function(){
  const oque=document.getElementById('desc-oque').value.trim();
  const como=document.getElementById('desc-como').value.trim();
  const pcCompleto=document.getElementById('desc-pc-completo').checked;
  if(!oque){notif('Informe o que foi descartado.');document.getElementById('desc-oque').focus();return}
  const{pcId,ticketId}=descarteAtual;
  if(!pcId){notif('Erro: PC não identificado.');return}
  if(!await dsosConfirm({msg:`Confirmar DESCARTE FÍSICO?\nItem: ${oque}${como?'\nMeio: '+como:''}${pcCompleto?'\nPC será marcado DESCARTADO.':'\nPC permanece ativo.'}`,tipo:'danger',titulo:'Descarte físico'}))return;
  try{
    const linhas=[`[DESCARTE FÍSICO REGISTRADO]`,`Item: ${oque}`];
    if(como)linhas.push(`Meio: ${como}`);
    if(pcCompleto)linhas.push(`PC marcado como descartado.`);
    linhas.push(`Registrado em: ${new Date().toLocaleString('pt-BR')}`,`Técnico: ${session.nome||session.login}`);
    await fetch(`${SB}/rest/v1/ticket?id=eq.${ticketId}`,{method:'PATCH',headers:H,body:JSON.stringify({descricao_resolucao:linhas.join('\n'),tecnico_responsavel:session.id})});
    await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({status_pc:pcCompleto?'descartado':'ativo'})});
    
    // ━━ LOGGING (descarte físico) ━━
    _logEvent('rpc_log_descarte_equipment', {
      p_usuario_id:    session.id,
      p_usuario_tipo:  session.tipo || 'ti',
      p_usuario_login: session.login || '',
      p_usuario_nome:  session.nome  || '',
      p_ticket_id:     ticketId,
      p_pc_tag:        todosOsPCs.find(p=>p.id===pcId)?.tag || '',
      p_item_descartado: oque,
      p_meio_descarte: como || null
    });

    notif('Descarte físico registrado');window.fecharModalDescarte();
    await Promise.all([carregarTickets(),carregarPCs()]);
  }catch(err){console.error(err);notif('Erro ao registrar descarte.')}
};
window.abrirGuia=function(){window.open('https://www.mma.gov.br/cidades-sustentaveis/residuos-solidos/politica-nacional-de-residuos-solidos.html','_blank')};

/* FILTRO / DISPENSAR / REABRIR / LIMPAR / CANCELAR */
window.filtrar=function(f,btn){filtroAtivo=f;document.querySelectorAll('.rf-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderResp();};
window.dispensar=function(id,e){e.stopPropagation();ocultados.add(id);respondidos=respondidos.filter(r=>r.id!==id);renderResp();};
window.reabrirTicket=async function(id,e){
  e.stopPropagation();
  if(!await dsosConfirm({msg:`Reabrir chamado #${id}?\nStatus volta para ABERTO e PC para ATIVO.`,tipo:'warning',titulo:'Reabrir chamado'}))return;
  try{
    const tr=await fetch(`${SB}/rest/v1/ticket?id=eq.${id}&select=pc_problema`,{headers:H});
    const td=await tr.json();const pcId=Array.isArray(td)&&td[0]?td[0].pc_problema:null;
    await fetch(`${SB}/rest/v1/ticket?id=eq.${id}`,{method:'PATCH',headers:H,body:JSON.stringify({status:'aberto',resolucao:null,resolvido_em:null,tecnico_responsavel:null,descricao_resolucao:null})});
    if(pcId)await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({status_pc:'ativo'})});
    notif('Chamado #'+id+' reaberto');
    ocultados.add(id);respondidos=respondidos.filter(r=>r.id!==id);
    await Promise.all([carregarTickets(),carregarKPIs(true)]);mudarAba('abertos');
  }catch(e){notif('Erro ao reabrir chamado.')}
};
window.limparRespondidos=async function(){
  if(!respondidos.length)return;
  if(!await dsosConfirm({msg:'Limpar lista?\n(Dados permanecem no banco.)',tipo:'info',titulo:'Limpar lista'}))return;
  respondidos.forEach(t=>ocultados.add(t.id));respondidos=[];renderResp();notif('Lista limpa');
};
window.cancelarItemDescarte=async function(ticketId,pcId,e){
  if(e)e.stopPropagation();
  if(!await dsosConfirm({msg:'Cancelar descarte?\nChamado volta para ABERTO e PC para ATIVO.',tipo:'warning',titulo:'Cancelar descarte'}))return;
  try{
    await fetch(`${SB}/rest/v1/ticket?id=eq.${ticketId}`,{method:'PATCH',headers:H,body:JSON.stringify({status:'aberto',resolucao:null,resolvido_em:null,item_descartado:null,tecnico_responsavel:null,descricao_resolucao:null})});
    await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({status_pc:'ativo'})});
    notif('Descarte cancelado — chamado reaberto');
    await Promise.all([carregarTickets(),carregarKPIs(true),carregarPCs()]);
  }catch(err){notif('Erro ao cancelar descarte.')}
};

/* LIMPEZA */
let _limpezaDias=30,_limpezaPreviewOk=false;
function resetAbaManutencao(){
  _limpezaPreviewOk=false;_limpezaDias=30;
  document.querySelectorAll('.limpeza-prazo-btn').forEach(b=>b.classList.toggle('active',b.dataset.dias==='30'));
  const prev=document.getElementById('limpeza-preview');
  if(prev)prev.innerHTML=`<div class="limpeza-preview-idle"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Clique em "Ver impacto" para analisar</span></div>`;
  const btn=document.getElementById('btn-executar-limpeza');if(btn)btn.disabled=true;
}
document.querySelectorAll('.limpeza-prazo-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.limpeza-prazo-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');_limpezaDias=parseInt(btn.dataset.dias);_limpezaPreviewOk=false;
    document.getElementById('btn-executar-limpeza').disabled=true;
    document.getElementById('limpeza-preview').innerHTML=`<div class="limpeza-preview-idle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Clique em "Ver impacto" para analisar</span></div>`;
  });
});
async function _parseFnResponse(res){
  const text=await res.text();let data;
  try{data=JSON.parse(text)}catch{throw new Error(`HTTP ${res.status}: ${text.slice(0,120)}`)}
  if(!res.ok||data.error)throw new Error(data.error||data.message||`HTTP ${res.status}`);
  return data;
}
window.verImpactoLimpeza=async function(){
  const btn=document.getElementById('btn-ver-impacto');
  btn.disabled=true;btn.textContent='Analisando…';
  document.getElementById('limpeza-preview').innerHTML='<div class="limpeza-preview-idle"><div class="spin"></div> analisando…</div>';
  try{
    const res=await fetch(`${SB}/functions/v1/fn-limpar-dados`,{method:'POST',headers:{'apikey':H.apikey,'Authorization':H.Authorization,'Content-Type':'application/json'},body:JSON.stringify({dias:_limpezaDias,apenas_preview:true})});
    const d=await _parseFnResponse(res);
    if(d.tickets_count===0){
      document.getElementById('limpeza-preview').innerHTML=`<div class="limpeza-preview-idle" style="color:var(--green)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Nenhum chamado nesse intervalo.</span></div>`;
      _limpezaPreviewOk=false;document.getElementById('btn-executar-limpeza').disabled=true;
    }else{
      document.getElementById('limpeza-preview').innerHTML=`<div class="limpeza-preview-stats"><div class="limpeza-stat"><span class="limpeza-stat-n" style="color:var(--red)">${d.tickets_count}</span><span class="limpeza-stat-l">tickets</span></div><div class="limpeza-preview-div"></div><div class="limpeza-stat"><span class="limpeza-stat-n">${d.mensagens_count}</span><span class="limpeza-stat-l">mensagens</span></div><div class="limpeza-preview-div"></div><div class="limpeza-stat"><span class="limpeza-stat-n" style="color:var(--orange)">${d.imagens_count}</span><span class="limpeza-stat-l">imagens</span></div></div>`;
      _limpezaPreviewOk=true;document.getElementById('btn-executar-limpeza').disabled=false;
    }
  }catch(err){
    document.getElementById('limpeza-preview').innerHTML=`<div class="limpeza-preview-idle" style="color:var(--red)">Erro: ${err.message}</div>`;
  }finally{
    btn.disabled=false;btn.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Ver impacto`;
  }
};
window.executarLimpeza=async function(){
  if(!_limpezaPreviewOk)return;
  const prazoLabel=_limpezaDias>=9999?'todos os registros encerrados':`os últimos ${_limpezaDias} dias`;
  if(!await dsosConfirm({msg:`Confirmar limpeza de ${prazoLabel}?\nAção IRREVERSÍVEL.`,tipo:'danger',titulo:'Limpeza de dados'}))return;
  const btn=document.getElementById('btn-executar-limpeza');
  btn.disabled=true;btn.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Limpando…`;
  try{
    const res=await fetch(`${SB}/functions/v1/fn-limpar-dados`,{method:'POST',headers:{'apikey':H.apikey,'Authorization':H.Authorization,'Content-Type':'application/json'},body:JSON.stringify({dias:_limpezaDias,apenas_preview:false})});
    const d=await _parseFnResponse(res);
    
    // ━━ LOGGING (limpeza banco) ━━
    _logEvent('rpc_log_limpeza_banco', {
      p_usuario_id:    session.id,
      p_usuario_tipo:  session.tipo || 'ti',
      p_usuario_login: session.login || '',
      p_usuario_nome:  session.nome  || '',
      p_dias:                _limpezaDias,
      p_tickets_deletados:   d.tickets_deletados   || 0,
      p_mensagens_deletadas: d.mensagens_deletadas || 0,
      p_imagens_deletadas:   d.imagens_deletadas   || 0
    });

    _limpezaPreviewOk=false;resetAbaManutencao();
    notif(`Limpeza: ${d.tickets_deletados} tickets, ${d.imagens_deletadas} imgs, ${d.mb_liberados}MB`);
    await Promise.all([carregarTickets(),carregarKPIs(true)]);
  }catch(err){
    notif('Erro: '+err.message);btn.disabled=false;
    btn.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Limpar agora`;
  }
};

/* NOTIF */
function notif(msg){const el=document.getElementById('notif');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}

/* CHAT TI */
let imgPendenteTi=null;
async function iniciarChat(ticketId,ativo){
  const chatInput=document.getElementById('chat-input-ti'),btnSend=document.getElementById('btn-send-ti');
  const btnImg=document.getElementById('btn-img-ti'),fileInput=document.getElementById('file-input-ti');
  const statusLbl=document.getElementById('chat-status-label');
  if(!chatInput||!btnSend)return;
  chatInput.disabled=!ativo;btnSend.disabled=!ativo;
  if(btnImg)btnImg.disabled=!ativo;if(fileInput)fileInput.disabled=!ativo;
  chatInput.placeholder=ativo?'Mensagem para o PC…':'Chamado encerrado — chat desabilitado.';
  if(statusLbl)statusLbl.textContent=ativo?'Em aberto':'Encerrado';
  await carregarMsgsTi(ticketId);
  // ── REALTIME — canal de chat do modal, escopado a este ticket ──
  // Substitui o canal anterior (se o TI trocou de chamado sem fechar o modal)
  // e é desinscrito em fecharModal(). INSERT/UPDATE em `mensagem` filtrados
  // por ticket_id=eq.{ticketId}: recebe só o que pertence a este chamado.
  if(realtimeChannel){sbClient.removeChannel(realtimeChannel);realtimeChannel=null;}
  realtimeChannel=sbClient.channel(`chat-ti-${ticketId}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'mensagem',filter:`ticket_id=eq.${ticketId}`},()=>{carregarMsgsTi(ticketId);marcarLidoTi(ticketId);})
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'mensagem',filter:`ticket_id=eq.${ticketId}`},()=>carregarMsgsTi(ticketId))
    .subscribe(rtStatusHandler(`chat-ti-${ticketId}`));
}
async function carregarMsgsTi(ticketId){
  try{
    const r=await fetch(`${SB}/rest/v1/mensagem?ticket_id=eq.${ticketId}&order=enviado_em.asc&select=*`,{headers:H});
    const msgs=await r.json();
    const chat=document.getElementById('chat-msgs-ti');if(!chat)return;
    if(!Array.isArray(msgs)||!msgs.length){chat.innerHTML=`<div class="chat-empty-ti">Nenhuma mensagem ainda.</div>`;return}
    const atBottom=chat.scrollHeight-chat.scrollTop<=chat.clientHeight+40;
    const nomeTenico=session.nome||session.login||'T.I.';
    chat.innerHTML=msgs.map(m=>{
      const deTi=m.remetente==='TI'||m.remetente==='ti';
      const lado=deTi?'ti':'pc';
      const hora=m.enviado_em?new Date(m.enviado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
      const nomeRem=deTi?(m.nome_remetente||nomeTenico):(m.nome_remetente||'PC');
      const imgHtml=m.imagem_url?`<img class="msg-img-ti" src="${escapeHtml(m.imagem_url)}" alt="print" onclick="abrirLightbox('${escapeHtml(m.imagem_url)}')" />`:'';
      const textoHtml=m.conteudo?`<div class="msg-bubble-ti">${escapeHtml(m.conteudo)}</div>`:'';
      const tickHtml=deTi?`<span class="msg-tick${m.lido_pc?' lido':''}">${m.lido_pc?SVG.tick2:SVG.tick1}</span>`:'';
      return`<div class="msg ${lado}">${imgHtml}${textoHtml}<div class="msg-meta-ti">${escapeHtml(nomeRem)} · ${hora} ${tickHtml}</div></div>`;
    }).join('');
    if(atBottom)chat.scrollTop=chat.scrollHeight;
  }catch(e){console.error('chat',e)}
}
window.enviarMsgTi=async function(e){
  if(e.key!=='Enter')return;
  const inp=document.getElementById('chat-input-ti');
  const txt=inp.value.trim();
  if(!txt&&!imgPendenteTi)return;if(!modalTicketId)return;
  inp.value='';
  let imagem_url=null;
  // O campo é limpo antes do upload (assíncrono) terminar. Se o upload
  // falhasse, a função só notificava e retornava — o texto que o técnico
  // acabou de digitar sumia sem forma de recuperar. Agora ele volta pro
  // campo, com o cursor no fim, pra poder reenviar (BUG-14).
  if(imgPendenteTi){
    try{
      imagem_url=await uploadImagem(imgPendenteTi);
    }catch(err){
      console.error('[enviarMsgTi] upload de imagem falhou',err);
      inp.value=txt;
      inp.focus();
      notif('Erro ao enviar imagem. Seu texto foi mantido.');
      return;
    }
    removerImgTi();
  }
  try{
    await fetch(`${SB}/rest/v1/mensagem`,{method:'POST',headers:H,body:JSON.stringify({
      ticket_id:modalTicketId,remetente:'TI',conteudo:txt||null,imagem_url,
      enviado_em:new Date().toISOString(),
      nome_remetente:session.nome||session.login||'T.I.'
    })});
    
    // ━━ LOGGING (mensagem T.I.) ━━
    if(txt || imagem_url) {
      _logEvent('rpc_log_enviar_mensagem', {
        p_usuario_id:    session.id,
        p_usuario_tipo:  session.tipo || 'ti',
        p_usuario_login: session.login || '',
        p_usuario_nome:  session.nome  || '',
        p_ticket_id:     modalTicketId,
        p_tem_imagem:    !!imagem_url
      });
    }

    await carregarMsgsTi(modalTicketId);
  }catch(err){notif('Erro ao enviar mensagem.')}
};
async function uploadImagem(file){
  const ext=(file.name&&file.name.includes('.'))?file.name.split('.').pop():(file.type.split('/')[1]||'jpg');
  const nome=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const res=await fetch(`${SB}/storage/v1/object/chat-prints/${nome}`,{method:'POST',headers:{'apikey':H.apikey,'Authorization':H.Authorization,'Content-Type':file.type,'x-upsert':'true'},body:file});
  if(!res.ok)throw new Error('Upload falhou');
  return`${SB}/storage/v1/object/public/chat-prints/${nome}`;
}
window.selecionarImagemTi=function(event){
  const file=event.target.files[0];if(!file)return;
  imgPendenteTi=file;const url=URL.createObjectURL(file);
  document.getElementById('img-prev-thumb').src=url;
  document.getElementById('img-prev-nome').textContent=file.name;
  document.getElementById('img-preview-ti').classList.add('visible');
  document.getElementById('chat-input-ti').focus();event.target.value='';
};
window.removerImgTi=function(){
  imgPendenteTi=null;
  const prev=document.getElementById('img-preview-ti');if(prev)prev.classList.remove('visible');
  const thumb=document.getElementById('img-prev-thumb');if(thumb)thumb.src='';
};
document.getElementById('chat-input-ti')?.addEventListener('paste',function(e){
  const items=e.clipboardData?.items;if(!items)return;
  for(const item of items){
    if(item.type.startsWith('image/')){
      e.preventDefault();const file=item.getAsFile();if(!file)return;
      imgPendenteTi=file;const url=URL.createObjectURL(file);
      document.getElementById('img-prev-thumb').src=url;
      document.getElementById('img-prev-nome').textContent='imagem colada';
      document.getElementById('img-preview-ti').classList.add('visible');break;
    }
  }
});
window.abrirLightbox=function(url){document.getElementById('lightbox-img').src=url;document.getElementById('lightbox').classList.add('open');};
window.fecharLightbox=function(){document.getElementById('lightbox').classList.remove('open');};
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.fecharLightbox()});

/* COMPUTADORES */
let todosOsPCs=[],pcFiltroStatus='todos',pcEditandoId=null;
async function carregarPCs(){
  try{const r=await fetch(`${SB}/rest/v1/v_pc_pub?order=tag.asc&select=*`,{headers:H});todosOsPCs=await r.json();if(!Array.isArray(todosOsPCs))todosOsPCs=[];document.getElementById('badge-pcs').textContent=todosOsPCs.length;}catch(e){todosOsPCs=[];}
  renderPCs();
}
window.filtrarPCs=function(){renderPCs();};
window.setPcFiltro=function(f,btn){pcFiltroStatus=f;document.querySelectorAll('.pf-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderPCs();};
function renderPCs(){
  const grid=document.getElementById('pc-grid');
  const q=(document.getElementById('pc-search')?.value||'').toLowerCase();
  const lista=todosOsPCs.filter(pc=>{
    const matchQ=!q||pc.tag?.toLowerCase().includes(q)||pc.laboratorio?.toLowerCase().includes(q);
    const matchF=pcFiltroStatus==='todos'||pc.status_pc===pcFiltroStatus;
    return matchQ&&matchF;
  });
  document.getElementById('pc-count').textContent=todosOsPCs.length;
  if(!lista.length){grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="eicon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div><p>Nenhum computador encontrado.</p></div>`;return}
  const ico={ativo:'<span style="color:var(--green)">●</span>',em_manutencao:'<span style="color:var(--yellow)">●</span>',descartado:'<span style="color:var(--muted)">●</span>'};
  const txt={ativo:'Ativo',em_manutencao:'Manutenção',descartado:'Descartado'};
  grid.innerHTML=lista.map(pc=>{
    const cls=pc.status_pc==='em_manutencao'?' manutencao':pc.status_pc==='descartado'?' descartado':'';
    return`<div class="pc-card${cls}"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px"><div class="pc-tag-big" style="cursor:pointer" onclick="abrirModalPC(${pc.id})">${escapeHtml(pc.tag||'—')}</div><button class="btn-ti-del-pc" title="Remover PC permanentemente (exclui todos os chamados vinculados)" onclick="deletarPC(${pc.id},'${(pc.tag||'').replace(/'/g,"\\'")}',event)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div><div class="pc-meta" style="cursor:pointer" onclick="abrirModalPC(${pc.id})"><span>${escapeHtml(pc.laboratorio||'—')}</span><span>Lado ${escapeHtml(pc.lado||'—')}</span></div><div class="pc-card-footer" style="cursor:pointer" onclick="abrirModalPC(${pc.id})">${ico[pc.status_pc]||''} <span style="font-size:.6rem;color:var(--muted)">${txt[pc.status_pc]||pc.status_pc}</span></div></div>`;
  }).join('');
}
window.deletarPC=async function(id,tag,e){
  e.stopPropagation();
  if(!await dsosConfirm({msg:`Remover PC "${tag}"?\nTodos os chamados vinculados serão excluídos.`,tipo:'danger',titulo:'Remover PC'}))return;
  try{
    await fetch(`${SB}/rest/v1/rpc/rpc_deletar_pc`,{method:'POST',headers:H,body:JSON.stringify({p_id:id})});
    // LOG-01: exclusão de PC é permanente e cascateia (remove os chamados
    // vinculados), mas não gerava nenhum registro de auditoria — logDeletarPC
    // e a RPC rpc_log_deletar_pc já existiam, só nunca eram chamadas.
    logger.logDeletarPC(session?.id,session?.tipo||'ti',session?.login||'',session?.nome||'',id,tag);
    notif(`PC ${tag} removido.`);
    await carregarPCs();
  }catch(err){console.error('[deletarPC]',err);notif('Erro ao remover.')}
};
window.abrirModalPC=function(id){
  const numericId=id!=null?Number(id):null;pcEditandoId=numericId;const editando=numericId!=null;
  document.getElementById('mpc-title').textContent=editando?'Editar Computador':'Cadastrar Computador';
  document.getElementById('mpc-status-field').style.display=editando?'flex':'none';
  document.getElementById('mpc-senha-hint').style.display=editando?'block':'none';
  document.getElementById('mpc-senha').placeholder=editando?'(deixe vazio para não alterar)':'Mínimo 4 caracteres';
  if(editando){const pc=todosOsPCs.find(p=>String(p.id)===String(numericId));if(!pc)return;document.getElementById('mpc-tag').value=pc.tag||'';document.getElementById('mpc-tag').disabled=true;document.getElementById('mpc-lab').value=pc.laboratorio||'';document.getElementById('mpc-lado').value=pc.lado?.trim()||'A';document.getElementById('mpc-status').value=pc.status_pc||'ativo';document.getElementById('mpc-senha').value='';}
  else{document.getElementById('mpc-tag').value='';document.getElementById('mpc-tag').disabled=false;document.getElementById('mpc-lab').value='';document.getElementById('mpc-lado').value='A';document.getElementById('mpc-senha').value='';}
  document.getElementById('modal-pc').classList.add('open');
  setTimeout(()=>document.getElementById(editando?'mpc-lab':'mpc-tag').focus(),120);
  if(editando)_carregarHistoricoPC(numericId);
};
window.fecharModalPC=function(){document.getElementById('modal-pc').classList.remove('open');pcEditandoId=null;};
document.getElementById('modal-pc').addEventListener('click',e=>{if(e.target===document.getElementById('modal-pc'))window.fecharModalPC()});
window.salvarPC=async function(){
  const tag=document.getElementById('mpc-tag').value.trim().toUpperCase(),lab=document.getElementById('mpc-lab').value.trim();
  const lado=document.getElementById('mpc-lado').value,senha=document.getElementById('mpc-senha').value,status=document.getElementById('mpc-status').value;
  if(!lab){notif('Informe o laboratório.');return}
  if(pcEditandoId===null){
    if(!tag){notif('Informe a tag.');return}if(!senha||senha.length<4){notif('Senha: mínimo 4 caracteres.');return}
    try{
      const r=await fetch(`${SB}/rest/v1/rpc/rpc_cadastrar_pc`,{method:'POST',headers:H,body:JSON.stringify({p_tag:tag,p_laboratorio:lab,p_lado:lado,p_senha:senha})});
      const res=await r.json();
      if(!r.ok)throw new Error(res.message||'Erro');
      
      // ━━ LOGGING (cadastrar PC) ━━
      _logEvent('rpc_log_cadastrar_pc', {
        p_usuario_id:    session.id,
        p_usuario_tipo:  session.tipo || 'ti',
        p_usuario_login: session.login || '',
        p_usuario_nome:  session.nome  || '',
        p_pc_tag:        tag,
        p_laboratorio:   lab
      });

      notif(`PC ${tag} cadastrado!`);window.fecharModalPC();await carregarPCs();
    }
    catch(e){notif('Erro: '+e.message)}
  }else{
    try{
      await fetch(`${SB}/rest/v1/rpc/rpc_atualizar_pc`,{method:'POST',headers:H,body:JSON.stringify({p_id:pcEditandoId,p_status_pc:status,p_nova_senha:senha||null})});
      await fetch(`${SB}/rest/v1/pc?id=eq.${pcEditandoId}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({laboratorio:lab,lado:lado})});
      
      // ━━ LOGGING (alterar status PC) ━━
      const pcAntigo=todosOsPCs.find(p=>p.id===pcEditandoId);
      _logEvent('rpc_log_alterar_status_pc', {
        p_usuario_id:    session.id,
        p_usuario_tipo:  session.tipo || 'ti',
        p_usuario_login: session.login || '',
        p_usuario_nome:  session.nome  || '',
        p_pc_id:         pcEditandoId,
        p_pc_tag:        pcAntigo?.tag || '',
        p_status_anterior: pcAntigo?.status_pc || null,
        p_status_novo:   status
      });

      notif('PC atualizado!');window.fecharModalPC();await carregarPCs();
    }
    catch(e){notif('Erro ao atualizar.')}
  }
};

/* EQUIPE TI */
let todosOsTIs=[],tiEditandoId=null;
async function carregarTIs(){
  try{
    const r=await fetch(`${SB}/rest/v1/v_usuario_ti_pub?order=nome.asc&select=*`,{headers:H});
    todosOsTIs=await r.json();if(!Array.isArray(todosOsTIs))todosOsTIs=[];
    // mantém tiMap (usado por tecNome() nas linhas de chamado) sincronizado
    // com a mesma resposta, para que técnicos novos/removidos apareçam sem F5
    todosOsTIs.forEach(u=>{tiMap[u.id]=u});
    document.getElementById('badge-ti').textContent=todosOsTIs.length;
    document.getElementById('ti-count').textContent=todosOsTIs.length;
  }catch(e){todosOsTIs=[];}
  renderTIs();
}
function renderTIs(){
  const list=document.getElementById('ti-user-list');
  if(!todosOsTIs.length){list.innerHTML=`<div class="empty"><div class="eicon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><p>Nenhum usuário cadastrado.</p></div>`;return}
  list.innerHTML=todosOsTIs.map(u=>{
    const isMe=session&&u.id===session.id;
    const presenca=isMe?_presencaAtual:(u.presenca||'online');
    const presencaColor=_PRESENCA_COLORS[presenca]||'#22c55e';
    const presencaLabel=_PRESENCA_LABELS[presenca]||presenca;
    const initials=(u.nome||u.login||'?').split(' ').map(w=>w[0]).slice(0,2).join('');
    const profBadge=u.is_professor?`<span style="font-size:.48rem;font-weight:700;letter-spacing:.05em;color:var(--kpi-green);background:rgba(6,182,212,.12);border:1px solid rgba(6,182,212,.25);border-radius:3px;padding:1px 5px;flex-shrink:0;display:inline-flex;align-items:center;gap:3px">${SVG.professor} PROF</span>`:'';
    const presencaBadge=`<span class="ti-presenca-badge" style="background:${presencaColor}" title="${presencaLabel}"></span>`;
    return`<div class="ti-user-row${isMe?' me-row':''}"><div class="ti-avatar" style="position:relative">${initials}${presencaBadge}</div><div class="ti-user-info"><div class="ti-user-nome">${escapeHtml(u.nome||'—')}${isMe?'<span class="ti-you-tag">você</span>':''}${profBadge}</div><div class="ti-user-login">@${escapeHtml(u.login||'—')} <span style="color:${presencaColor};font-size:.6rem">${presencaLabel}</span></div></div><button class="btn-ti-edit" onclick="abrirModalTI(${u.id})">Editar</button><button class="btn-ti-del-u" title="Remover usuário T.I. permanentemente" ${isMe?'disabled':''} onclick="deletarTI(${u.id},'${(u.nome||u.login).replace(/'/g,"\\'")}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div>`;
  }).join('');
}
window.abrirModalTI=function(id){
  tiEditandoId=id;const ed=id!==null;
  document.getElementById('mti-title').textContent=ed?'Editar Usuário T.I.':'Cadastrar Usuário T.I.';
  document.getElementById('mti-senha-hint').style.display=ed?'block':'none';
  document.getElementById('mti-login').disabled=ed;
  document.getElementById('mti-senha').placeholder=ed?'(deixe vazio para não alterar)':'Mínimo 4 caracteres';
  const profRow=document.getElementById('mti-prof-row');
  if(profRow) profRow.style.display=ed?'none':'flex';
  const discRow=document.getElementById('mti-disc-row');
  if(discRow) discRow.style.display='none';
  if(ed){
    const u=todosOsTIs.find(x=>x.id===id);if(!u)return;
    document.getElementById('mti-nome').value=u.nome||'';
    document.getElementById('mti-login').value=u.login||'';
    document.getElementById('mti-senha').value='';
    const cb=document.getElementById('mti-is-professor');
    if(cb){cb.checked=!!u.is_professor;cb.disabled=true;}
  }else{
    ['mti-nome','mti-login','mti-senha'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('mti-login').disabled=false;
    const cb=document.getElementById('mti-is-professor');
    if(cb){cb.checked=false;cb.disabled=false;}
    document.getElementById('mti-disciplina').value='';
  }
  document.getElementById('modal-ti-user').classList.add('open');
  setTimeout(()=>document.getElementById('mti-nome').focus(),120);
};
window.toggleProfessorDisc=function(){
  const cb=document.getElementById('mti-is-professor');
  const discRow=document.getElementById('mti-disc-row');
  if(discRow) discRow.style.display=cb?.checked?'flex':'none';
};
window.fecharModalTI=function(){document.getElementById('modal-ti-user').classList.remove('open');tiEditandoId=null;};
document.getElementById('modal-ti-user').addEventListener('click',e=>{if(e.target===document.getElementById('modal-ti-user'))window.fecharModalTI()});
window.salvarTI=async function(){
  const nome=document.getElementById('mti-nome').value.trim();
  const login=document.getElementById('mti-login').value.trim();
  const senha=document.getElementById('mti-senha').value;
  const isProf=document.getElementById('mti-is-professor')?.checked||false;
  const disciplina=document.getElementById('mti-disciplina')?.value.trim()||null;
  if(!nome){notif('Informe o nome.');return}
  if(tiEditandoId===null){
    if(!login){notif('Informe o login.');return}
    if(!senha||senha.length<4){notif('Senha: mínimo 4 caracteres.');return}
    try{
      const r=await fetch(`${SB}/rest/v1/rpc/rpc_cadastrar_ti`,{method:'POST',headers:H,body:JSON.stringify({p_login:login,p_nome:nome,p_senha:senha,p_is_professor:isProf,p_disciplina:disciplina})});
      if(!r.ok){const e=await r.json();throw new Error(e.message||'Erro')}
      
      // ━━ LOGGING (cadastrar T.I.) ━━
      _logEvent('rpc_log_cadastrar_usuario_ti', {
        p_usuario_id:    session.id,
        p_usuario_tipo:  session.tipo || 'ti',
        p_usuario_login: session.login || '',
        p_usuario_nome:  session.nome  || '',
        p_novo_ti_login: login,
        p_novo_ti_nome:  nome
      });

      notif(`${nome} cadastrado${isProf?' (também como Professor)':''}!`);
      window.fecharModalTI();await carregarTIs();if(isProf)await carregarProfs();
    }catch(e){notif('Erro: '+(e.message.includes('duplicate')?'login já existe.':e.message))}
  }else{
    try{
      await fetch(`${SB}/rest/v1/rpc/rpc_atualizar_ti`,{method:'POST',headers:H,body:JSON.stringify({p_id:tiEditandoId,p_nome:nome,p_nova_senha:senha||null})});
      notif('Atualizado!');window.fecharModalTI();await carregarTIs();
    }catch(e){notif('Erro ao atualizar.')}
  }
};
window.deletarTI=async function(id,nome){
  if(!await dsosConfirm({msg:`Remover "${nome}"?`,tipo:'danger',titulo:'Remover T.I.'}))return;
  try{
    await fetch(`${SB}/rest/v1/rpc/rpc_deletar_ti`,{method:'POST',headers:H,body:JSON.stringify({p_id:id})});
    // LOG-01: idem deletarPC — logDeletarUsuarioTI existia e nunca era chamado
    const alvo=todosOsTIs.find(u=>String(u.id)===String(id));
    logger.logDeletarUsuarioTI(session?.id,session?.tipo||'ti',session?.login||'',session?.nome||'',id,alvo?.login||nome);
    notif(`${nome} removido.`);
    await carregarTIs();
  }catch(err){console.error('[deletarTI]',err);notif('Erro.')}
};

/* PROFESSORES */
let todosOsProfs=[],profEditandoId=null;
async function carregarProfs(){
  try{const r=await fetch(`${SB}/rest/v1/professor?order=nome.asc&select=id,nome,login,disciplina`,{headers:H});todosOsProfs=await r.json();if(!Array.isArray(todosOsProfs))todosOsProfs=[];document.getElementById('badge-prof').textContent=todosOsProfs.length;document.getElementById('prof-count').textContent=todosOsProfs.length;}catch(e){todosOsProfs=[];}
  renderProfs();
}
function renderProfs(){
  const list=document.getElementById('prof-user-list');
  if(!todosOsProfs.length){list.innerHTML=`<div class="empty"><div class="eicon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg></div><p>Nenhum professor cadastrado.</p></div>`;return}
  list.innerHTML=todosOsProfs.map(u=>{const i=(u.nome||u.login||'?').split(' ').map(w=>w[0]).slice(0,2).join('');return`<div class="ti-user-row"><div class="ti-avatar" style="background:rgba(6,182,212,.12);border-color:rgba(6,182,212,.3);color:var(--kpi-green)">${i}</div><div class="ti-user-info"><div class="ti-user-nome">${escapeHtml(u.nome||'—')}</div><div class="ti-user-login">@${escapeHtml(u.login||'—')}${u.disciplina?' · '+escapeHtml(u.disciplina):''}</div></div><button class="btn-ti-edit" onclick="abrirModalProf(${u.id})">Editar</button><button class="btn-ti-del-u" onclick="deletarProf(${u.id},'${(u.nome||u.login).replace(/'/g,"\\'")}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div>`;}).join('');
}
window.abrirModalProf=function(id){profEditandoId=id;const ed=id!==null;document.getElementById('mprof-title').textContent=ed?'Editar Professor':'Cadastrar Professor';document.getElementById('mprof-senha-hint').style.display=ed?'block':'none';document.getElementById('mprof-login').disabled=ed;document.getElementById('mprof-senha').placeholder=ed?'(deixe vazio para não alterar)':'Mínimo 4 caracteres';const tiRow=document.getElementById('mprof-ti-row');if(tiRow)tiRow.style.display=ed?'none':'flex';const cb=document.getElementById('mprof-is-ti');if(cb){cb.checked=false;cb.disabled=ed;}if(ed){const u=todosOsProfs.find(x=>x.id===id);if(!u)return;document.getElementById('mprof-nome').value=u.nome||'';document.getElementById('mprof-login').value=u.login||'';document.getElementById('mprof-disciplina').value=u.disciplina||'';document.getElementById('mprof-senha').value='';}else{['mprof-nome','mprof-login','mprof-disciplina','mprof-senha'].forEach(i=>document.getElementById(i).value='');document.getElementById('mprof-login').disabled=false;}document.getElementById('modal-professor').classList.add('open');setTimeout(()=>document.getElementById('mprof-nome').focus(),120);};
window.fecharModalProf=function(){document.getElementById('modal-professor').classList.remove('open');profEditandoId=null;};
document.getElementById('modal-professor').addEventListener('click',e=>{if(e.target===document.getElementById('modal-professor'))window.fecharModalProf()});
window.salvarProf=async function(){
  const nome=document.getElementById('mprof-nome').value.trim(),login=document.getElementById('mprof-login').value.trim(),disciplina=document.getElementById('mprof-disciplina').value.trim(),senha=document.getElementById('mprof-senha').value;
  const isTI=document.getElementById('mprof-is-ti')?.checked||false;
  if(!nome){notif('Informe o nome.');return}
  if(profEditandoId===null){
    if(!login){notif('Informe o login.');return}if(!senha||senha.length<4){notif('Senha: mínimo 4 caracteres.');return}
    try{
      const r=await fetch(`${SB}/rest/v1/rpc/rpc_cadastrar_professor`,{method:'POST',headers:H,body:JSON.stringify({p_login:login,p_nome:nome,p_senha:senha,p_disciplina:disciplina||null,p_is_ti:isTI})});
      if(!r.ok){const e=await r.json();throw new Error(e.message||'Erro')}

      // ━━ LOGGING (cadastrar professor) ━━
      _logEvent('rpc_log_cadastrar_professor', {
        p_usuario_id:    session.id,
        p_usuario_tipo:  session.tipo || 'ti',
        p_usuario_login: session.login || '',
        p_usuario_nome:  session.nome  || '',
        p_prof_login:    login,
        p_prof_nome:     nome
      });

      notif(`Prof. ${nome} cadastrado${isTI?' (também como T.I.)':''}!`);window.fecharModalProf();await carregarProfs();if(isTI)await carregarTIs();
    }
    catch(e){console.error('[salvarProf]',e);notif('Erro: '+(e.message?.includes('duplicate')?'login já existe.':e.message||'Erro desconhecido'))}
  }else{
    try{
      await fetch(`${SB}/rest/v1/rpc/rpc_atualizar_professor`,{method:'POST',headers:H,body:JSON.stringify({p_id:profEditandoId,p_nome:nome,p_disciplina:disciplina||null,p_nova_senha:senha||null})});
      notif('Prof. atualizado!');window.fecharModalProf();await carregarProfs();
    }catch(e){notif('Erro ao atualizar.')}
  }
};
window.deletarProf=async function(id,nome){
  if(!await dsosConfirm({msg:`Remover prof. "${nome}"?`,tipo:'danger',titulo:'Remover professor'}))return;
  try{
    // SEC-03: passa a excluir via RPC SECURITY DEFINER (rpc_deletar_professor,
    // que já existia no banco) em vez de DELETE direto no PostgREST. Isso é o
    // que permite fechar a policy professor_delete, que aceitava DELETE de
    // qualquer visitante com a anon key, sem nenhuma verificação.
    const r=await fetch(`${SB}/rest/v1/rpc/rpc_deletar_professor`,{method:'POST',headers:H,body:JSON.stringify({p_professor_id:id})});
    if(!r.ok){
      const t=await r.text().catch(()=>'');
      // a RPC recusa a exclusão se o professor tiver chamados em aberto —
      // mostra esse motivo em vez de um erro genérico
      let msg='Erro ao remover professor.';
      try{const j=JSON.parse(t);if(j?.message)msg=j.message;}catch(_){}
      throw new Error(msg);
    }
    // LOG-01: idem deletarPC/deletarTI — logDeletarProfessor nunca era chamado
    const alvo=todosOsProfs.find(u=>String(u.id)===String(id));
    logger.logDeletarProfessor(session?.id,session?.tipo||'ti',session?.login||'',session?.nome||'',id,alvo?.login||nome);
    notif(`Prof. ${nome} removido.`);
    await carregarProfs();
  }catch(err){console.error('[deletarProf]',err);notif(err.message||'Erro ao remover professor.')}
};

/* BUSCA DEBOUNCED */
let _bTimers={};
function _debounce(key,fn,ms=350){clearTimeout(_bTimers[key]);_bTimers[key]=setTimeout(fn,ms)}
window.buscarDescarte=q=>_debounce('desc',async()=>{try{let u=`${SB}/rest/v1/ticket?resolucao=eq.descarte&order=resolvido_em.desc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`;if(q)u+=`&or=(item_descartado.ilike.*${encodeURIComponent(q)}*,descricao.ilike.*${encodeURIComponent(q)}*)`;descarteFila=await fetch(u,{headers:H}).then(r=>r.json()).then(d=>Array.isArray(d)?d:[]);}catch(e){descarteFila=[]}renderDescarte()});
window.buscarTIs=q=>_debounce('ti',async()=>{try{let u=`${SB}/rest/v1/v_usuario_ti_pub?order=nome.asc&select=*`;if(q)u+=`&or=(nome.ilike.*${encodeURIComponent(q)}*,login.ilike.*${encodeURIComponent(q)}*)`;todosOsTIs=await fetch(u,{headers:H}).then(r=>r.json()).then(d=>Array.isArray(d)?d:[]);}catch(e){todosOsTIs=[]}renderTIs()});
window.buscarProfs=q=>_debounce('prof',async()=>{try{let u=`${SB}/rest/v1/professor?order=nome.asc&select=id,nome,login,disciplina`;if(q)u+=`&or=(nome.ilike.*${encodeURIComponent(q)}*,login.ilike.*${encodeURIComponent(q)}*,disciplina.ilike.*${encodeURIComponent(q)}*)`;todosOsProfs=await fetch(u,{headers:H}).then(r=>r.json()).then(d=>Array.isArray(d)?d:[]);}catch(e){todosOsProfs=[]}renderProfs()});
window.buscarTicketsAbertos=q=>_debounce('unresp',()=>carregarTickets(q));
window.buscarTicketsRespondidos=q=>_debounce('resp',()=>carregarTickets(q));
window.buscarPCs=q=>_debounce('pcs',async()=>{try{let u=`${SB}/rest/v1/v_pc_pub?order=tag.asc&select=*`;if(q)u+=`&or=(tag.ilike.*${encodeURIComponent(q)}*,laboratorio.ilike.*${encodeURIComponent(q)}*)`;todosOsPCs=await fetch(u,{headers:H}).then(r=>r.json()).then(d=>Array.isArray(d)?d:[]);document.getElementById('badge-pcs').textContent=todosOsPCs.length;}catch(e){todosOsPCs=[]}renderPCs()});

/* TOGGLES SENHA */
function _toggleOlho(inputId,icoId){const i=document.getElementById(inputId),ic=document.getElementById(icoId);if(!i||!ic)return;const s=i.type==='password';i.type=s?'text':'password';ic.innerHTML=s?`<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`:` <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;}
window.toggleSenhaMPC=()=>_toggleOlho('mpc-senha','ico-olho-mpc');
window.toggleSenhaTI=()=>_toggleOlho('mti-senha','ico-olho-ti');
window.toggleSenhaProf=()=>_toggleOlho('mprof-senha','ico-olho-prof');
window.atualizarContadorChatTI=function(inp){document.getElementById('ti-chat-char').textContent=inp.value.length};

/* NAVEGAÇÃO PAINEL LOGS */
window.abrirPainelLogs = function() {
  window.open('painel-logs.html', '_self');
};

/* TROCAR PAPEL: TI → Professor */
window.trocarParaProfessor = function() {
  if (!session?.professor_id) return;
  sessionStorage.setItem('dsos_session', JSON.stringify({
    tipo: 'professor',
    id: session.professor_id,
    login: session.login,
    nome: session.nome
  }));
  window.location.href = 'painel-pc.html';
};

/* BROWSER NOTIFICATION */
function _browserNotif(titulo,corpo){
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  try{new Notification(titulo,{body:corpo});}catch(_){}
}

/* COPIAR ID DO CHAMADO */
window.copiarId=function(id,e){
  e.stopPropagation();
  navigator.clipboard?.writeText('#'+id).then(()=>notif('ID #'+id+' copiado!')).catch(()=>{});
};
window.copiarIdModal=function(){
  if(!modalTicketId)return;
  navigator.clipboard?.writeText('#'+modalTicketId).then(()=>notif('ID #'+modalTicketId+' copiado!')).catch(()=>{});
};

/* ═══════════════════════════════════════════
   AI FEATURES — TI (Groq llama-3.3-70b-versatile)
═══════════════════════════════════════════ */
async function _groqTI(messages,maxTokens=1024){
  const resp=await fetch(`${SB}/functions/v1/groq-proxy`,{
    method:'POST',
    headers:H,
    body:JSON.stringify({model:'openai/gpt-oss-20b',temperature:0.3,max_tokens:maxTokens,messages})
  });
  if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error('Groq '+resp.status+': '+(e?.error?.message||''));}
  const d=await resp.json();
  return (d.choices?.[0]?.message?.content||'').trim();
}

/* AI: Resumo automático do ticket no modal */
async function _aiResumoModal(t){
  const el=document.getElementById('ai-resumo');
  const txt=document.getElementById('ai-resumo-texto');
  const spin=document.getElementById('ai-resumo-spin');
  if(!el||!txt)return;
  if(!_cfg.aiResumo){el.style.display='none';return;}
  el.style.display='block';
  txt.textContent='';
  if(spin)spin.style.display='inline';
  try{
    const contexto=[
      t.tipo&&`Tipo: ${tipoLabel(t.tipo)}`,
      t.laboratorio&&`Local: ${t.laboratorio} Lado ${t.lado||'—'}`,
      t.pc_info?.tag&&`PC: ${t.pc_info.tag}`,
      t.descricao&&`Descrição: "${t.descricao}"`,
      t.nota_interna&&`Nota interna: "${t.nota_interna}"`,
      t.descricao_resolucao&&`Resolução registrada: "${t.descricao_resolucao}"`,
    ].filter(Boolean).join('\n');
    const resumo=await _groqTI([
      {role:'system',content:'Responda SEMPRE em português brasileiro. Resuma em 1-2 frases diretas. Problema + info relevante. Sem intro. Max 30 palavras.'},
      {role:'user',content:contexto}
    // gpt-oss-20b é modelo de raciocínio: gasta 300+ tokens "pensando" antes
    // de escrever. Com 256 o resumo voltava vazio/truncado em silêncio —
    // mesma classe de bug já corrigida em auth.js (commits f0ee161/ccc3f69),
    // onde o teto acabou em 1000. 512 dá margem para o raciocínio + as ~30
    // palavras pedidas no prompt (BUG-02).
    ],512);
    txt.textContent=resumo||'Sem resumo disponível.';
  }catch(e){
    // sem o log, uma falha real (rede, proxy fora, estouro de tokens) ficava
    // indistinguível de "veio vazio" — ver LOG-02
    console.error('[_aiResumoModal]',e);
    txt.textContent='(Não foi possível gerar resumo — verifique a conexão)';
  }finally{
    if(spin)spin.style.display='none';
  }
}

/* AI: Sugerir resposta no chat */
window.aiSugerirResposta=async function(){
  const btn=document.getElementById('btn-sugerir-resp');
  const inp=document.getElementById('chat-input-ti');
  if(!modalTicketId||!inp)return;
  const t=tickets.find(x=>x.id===modalTicketId)||respondidos.find(x=>x.id===modalTicketId);
  if(!t)return;
  if(btn){btn.disabled=true;btn.textContent='Gerando…';}
  try{
    const chat=document.getElementById('chat-msgs-ti');
    const msgs=chat?[...chat.querySelectorAll('.msg')].slice(-6).map(m=>{
      const deTi=m.classList.contains('ti');
      const bubble=m.querySelector('.msg-bubble-ti');
      return bubble?`${deTi?'Técnico':'PC'}: ${bubble.textContent}`:'';
    }).filter(Boolean):[];
    const contexto=[
      `Chamado #${t.id} — ${tipoLabel(t.tipo)} — ${t.laboratorio||'?'} Lado ${t.lado||'?'}`,
      `Problema: ${t.descricao||'(sem descrição)'}`,
      t.nota_interna?`Nota interna: ${t.nota_interna}`:'',
      msgs.length?`\nÚltimas mensagens do chat:\n${msgs.join('\n')}`:'',
    ].filter(Boolean).join('\n');
    const sugestao=await _groqTI([
      {role:'system',content:'Responda SEMPRE em português brasileiro. Resposta curta (1-3 frases), direta, sem saudação longa. Português informal profissional. Sem inventar.'},
      {role:'user',content:`${contexto}\n\nResponda:`}
    ],512);
    if(sugestao&&inp){inp.value=sugestao;inp.focus();inp.dispatchEvent(new Event('input'));}
  }catch(e){
    notif('Erro ao gerar sugestão.');
  }finally{
    if(btn){btn.disabled=false;btn.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Sugerir resposta';}
  }
};

/* HISTÓRICO DO PC NO MODAL */
async function _carregarHistoricoPC(pcId){
  const el=document.getElementById('mpc-historico');if(!el)return;
  el.innerHTML='<div style="font-size:.55rem;font-weight:700;letter-spacing:.08em;color:var(--muted);padding:8px 0 4px">CARREGANDO HISTÓRICO…</div>';
  try{
    const r=await fetch(`${SB}/rest/v1/ticket?pc_problema=eq.${pcId}&order=aberto_em.desc&limit=5&select=id,tipo,status,aberto_em`,{headers:H});
    const data=await r.json();
    if(!Array.isArray(data)||!data.length){el.innerHTML='';return;}
    const cors={aberto:'var(--yellow)',em_andamento:'var(--orange)',resolvido:'var(--green)',descartado:'var(--muted)',falso_alarme:'var(--red)'};
    el.innerHTML='<div style="font-size:.55rem;font-weight:700;letter-spacing:.08em;color:var(--muted);padding:8px 0 4px">ÚLTIMOS CHAMADOS</div>'+
      data.map(t=>{const d=t.aberto_em?new Date(t.aberto_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';return`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--glass-b);font-size:.58rem"><span style="color:${cors[t.status]||'var(--muted)'}">●</span><span style="color:var(--muted)">#${t.id}</span><span style="flex:1">${tipoLabel(t.tipo)}</span><span style="color:var(--muted)">${d}</span></div>`;}).join('');
  }catch(e){el.innerHTML='';}
}

/* EXPORTAR CSV DE CHAMADOS */
window.exportarChamadosCSV=function(){
  const todos=[...tickets,...respondidos];
  if(!todos.length){notif('Nenhum chamado para exportar.');return}
  const hdrs=['ID','PC','Lab','Tipo','Status','Solicitante','Técnico','Aberto em','Resolvido em'];
  const rows=todos.map(t=>[t.id,t.pc_info?.tag||t.pc_problema,t.laboratorio,t.tipo,t.status,t.nome_solicitante,tecNome(t.tecnico_responsavel),t.aberto_em?new Date(t.aberto_em).toLocaleString('pt-BR'):'',t.resolvido_em?new Date(t.resolvido_em).toLocaleString('pt-BR'):'']);
  const csv=[hdrs,...rows].map(r=>r.map(c=>{let s=String(c??'');if(/^[=+\-@]/.test(s))s="'"+s;return`"${s.replace(/"/g,'""')}"`;}).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`chamados_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();notif('CSV exportado!');
};

/* MODO COMPACTO */
let _modoCompacto=false;
window.toggleModoCompacto=function(){
  _modoCompacto=!_modoCompacto;
  document.getElementById('unresp-list')?.classList.toggle('compact',_modoCompacto);
  const btn=document.getElementById('btn-compacto');
  if(btn)btn.title=_modoCompacto?'Modo normal':'Modo compacto';
  notif(_modoCompacto?'Modo compacto ativado':'Modo normal ativado');
};

/* PRESENÇA — Feature 4 */
const _PRESENCAS=['online','em campo','ausente'];
const _PRESENCA_COLORS={'online':'#22c55e','em campo':'#f59e0b','ausente':'#6b7280'};
const _PRESENCA_LABELS={'online':'Online','em campo':'Em campo','ausente':'Ausente'};
let _presencaAtual=localStorage.getItem('dsos_presenca')||'online';

function _aplicarPresenca(){
  const dot=document.getElementById('presenca-dot');
  if(!dot)return;
  dot.style.background=_PRESENCA_COLORS[_presencaAtual]||'#22c55e';
  dot.title=_PRESENCA_LABELS[_presencaAtual]||_presencaAtual;
}
window.ciclarPresenca=async function(){
  const idx=(_PRESENCAS.indexOf(_presencaAtual)+1)%_PRESENCAS.length;
  _presencaAtual=_PRESENCAS[idx];
  localStorage.setItem('dsos_presenca',_presencaAtual);
  _aplicarPresenca();
  notif('Status: '+_PRESENCA_LABELS[_presencaAtual]);
  if(session?.id){
    try{
      await fetch(`${SB}/rest/v1/rpc/rpc_set_presenca`,{method:'POST',headers:H,body:JSON.stringify({p_id:session.id,p_presenca:_presencaAtual})});
    }catch(_){}
  }
  renderTIs();
};

async function _sincronizarPresencaBanco(){
  if(!session?.id)return;
  try{
    const r=await fetch(`${SB}/rest/v1/v_usuario_ti_pub?id=eq.${session.id}&select=presenca`,{headers:H});
    const d=await r.json();
    if(Array.isArray(d)&&d[0]?.presenca){
      _presencaAtual=d[0].presenca;
      localStorage.setItem('dsos_presenca',_presencaAtual);
    }
  }catch(_){}
  _aplicarPresenca();
}
_sincronizarPresencaBanco();

/* ═══════════════════════════════════════════
   CONFIGURAÇÕES DO PAINEL
═══════════════════════════════════════════ */
const _cfg={
  dicasAtalho:false, aiResumo:true,
  sons:true, browserNotif:false,
  noAnim:false, ocultarKpis:false,
  confirmarResolver:false, agruparLabInicio:false,
  ordem:'asc',
  accent:'#6366f1', fontSize:'normal',
  apelido:'',
  reply1:'', reply2:'', reply3:'',
};

function _aplicarAccentCss(cor){
  const r=parseInt(cor.slice(1,3),16),g=parseInt(cor.slice(3,5),16),b=parseInt(cor.slice(5,7),16);
  const root=document.documentElement;
  root.style.setProperty('--accent',cor);
  root.style.setProperty('--accent-hover',cor+'cc');
  root.style.setProperty('--red',cor);
  root.style.setProperty('--red-dim',`rgba(${r},${g},${b},.18)`);
  root.style.setProperty('--red-glow',`rgba(${r},${g},${b},.35)`);
  root.style.setProperty('--kpi-red',cor);
  root.style.setProperty('--kpi-red-sh',`rgba(${r},${g},${b},.4)`);
  const dr=Math.max(0,Math.round(r*.72)),dg=Math.max(0,Math.round(g*.72)),db=Math.max(0,Math.round(b*.72));
  root.style.setProperty('--red-hover',`rgb(${dr},${dg},${db})`);
}
function _aplicarFontSizeCss(size){
  const map={small:'90%',normal:'100%',large:'112%'};
  document.documentElement.style.setProperty('--cfg-font-scale', map[size]||'100%');
  document.documentElement.style.fontSize = map[size]||'100%';
}
function _aplicarNoAnim(on){
  document.documentElement.classList.toggle('no-anim',on);
}
function _aplicarOcultarKpis(on){
  const el=document.querySelector('.kpis');
  if(el)el.style.display=on?'none':'';
}
function _aplicarApelido(){
  const nome=_cfg.apelido?.trim()||session?.nome||'';
  const el=document.getElementById('topbar-nome');
  if(el&&nome)el.textContent=nome;
}
function _atualizarSwatches(){
  document.querySelectorAll('.cfg-swatch').forEach(b=>{
    b.classList.toggle('ativa',b.dataset.color===_cfg.accent);
  });
}
function _atualizarFontSeg(){
  document.querySelectorAll('#cfg-font-seg .cfg-seg-btn').forEach(b=>{
    b.classList.toggle('ativa',b.dataset.val===_cfg.fontSize);
  });
}
function _renderRespostasRapidas(){
  const wrap=document.getElementById('quick-replies-wrap');
  if(!wrap)return;
  const replies=[_cfg.reply1,_cfg.reply2,_cfg.reply3].filter(Boolean);
  wrap.innerHTML=replies.length
    ?replies.map(r=>`<button class="quick-reply-btn" onclick="usarRespostaRapida(${JSON.stringify(r)})">${escapeHtml(r)}</button>`).join('')
    :'';
  wrap.style.display=replies.length?'flex':'none';
}

(function _carregarConfig(){
  try{const s=localStorage.getItem('dsos_cfg_ti');if(s)Object.assign(_cfg,JSON.parse(s));}catch(_){}

  // Aplicar efeitos visuais imediatamente
  _aplicarAccentCss(_cfg.accent);
  _aplicarFontSizeCss(_cfg.fontSize);
  _aplicarNoAnim(_cfg.noAnim);
  _aplicarOcultarKpis(_cfg.ocultarKpis);
  if(_cfg.agruparLabInicio)_agruparLab=true;

  // Preencher controles do modal
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.checked=!!val;};
  set('cfg-dicas-atalho',_cfg.dicasAtalho);
  set('cfg-ai-resumo',_cfg.aiResumo);
  set('cfg-sons',_cfg.sons);
  set('cfg-browser-notif',_cfg.browserNotif);
  set('cfg-no-anim',_cfg.noAnim);
  set('cfg-ocultar-kpis',_cfg.ocultarKpis);
  set('cfg-confirmar-resolver',_cfg.confirmarResolver);
  set('cfg-agrupar-lab',_cfg.agruparLabInicio);
  set('cfg-hacker',localStorage.getItem('dsos_hacker')==='1');

  const ordem=document.getElementById('cfg-ordem');
  if(ordem)ordem.value=_cfg.ordem;

  const ap=document.getElementById('cfg-apelido');if(ap)ap.value=_cfg.apelido||'';
  const r1=document.getElementById('cfg-reply1');if(r1)r1.value=_cfg.reply1||'';
  const r2=document.getElementById('cfg-reply2');if(r2)r2.value=_cfg.reply2||'';
  const r3=document.getElementById('cfg-reply3');if(r3)r3.value=_cfg.reply3||'';

  _atualizarSwatches();
  _atualizarFontSeg();
})();

window.salvarConfig=function(){
  _cfg.dicasAtalho=!!document.getElementById('cfg-dicas-atalho')?.checked;
  _cfg.aiResumo=!!document.getElementById('cfg-ai-resumo')?.checked;
  _cfg.sons=!!document.getElementById('cfg-sons')?.checked;
  _cfg.browserNotif=!!document.getElementById('cfg-browser-notif')?.checked;
  _cfg.noAnim=!!document.getElementById('cfg-no-anim')?.checked;
  _cfg.ocultarKpis=!!document.getElementById('cfg-ocultar-kpis')?.checked;
  _cfg.confirmarResolver=!!document.getElementById('cfg-confirmar-resolver')?.checked;
  _cfg.agruparLabInicio=!!document.getElementById('cfg-agrupar-lab')?.checked;
  _cfg.ordem=document.getElementById('cfg-ordem')?.value||'asc';
  _cfg.apelido=document.getElementById('cfg-apelido')?.value?.trim()||'';
  _cfg.reply1=document.getElementById('cfg-reply1')?.value?.trim()||'';
  _cfg.reply2=document.getElementById('cfg-reply2')?.value?.trim()||'';
  _cfg.reply3=document.getElementById('cfg-reply3')?.value?.trim()||'';

  localStorage.setItem('dsos_cfg_ti',JSON.stringify(_cfg));

  // Aplicar efeitos em tempo real
  _aplicarNoAnim(_cfg.noAnim);
  _aplicarOcultarKpis(_cfg.ocultarKpis);
  _aplicarApelido();
  _atualizarKbDicas();
  _renderRespostasRapidas();

  if(_cfg.browserNotif&&'Notification' in window&&Notification.permission==='default'){
    Notification.requestPermission().then(p=>{if(p!=='granted'){_cfg.browserNotif=false;const cb=document.getElementById('cfg-browser-notif');if(cb)cb.checked=false;localStorage.setItem('dsos_cfg_ti',JSON.stringify(_cfg));}});
  }
};

window.aplicarAccent=function(cor){
  _cfg.accent=cor;
  _aplicarAccentCss(cor);
  _atualizarSwatches();
  localStorage.setItem('dsos_cfg_ti',JSON.stringify(_cfg));
};
window.aplicarFontSize=function(size){
  _cfg.fontSize=size;
  _aplicarFontSizeCss(size);
  _atualizarFontSeg();
  localStorage.setItem('dsos_cfg_ti',JSON.stringify(_cfg));
};
window.usarRespostaRapida=function(txt){
  const inp=document.getElementById('chat-input-ti');
  if(inp){inp.value=txt;inp.focus();}
};

window.abrirConfig=function(){
  document.getElementById('modal-config').classList.add('open');
  setTimeout(()=>{_atualizarSwatches();_atualizarFontSeg();},50);
};
window.fecharConfig=function(){document.getElementById('modal-config').classList.remove('open');};
document.getElementById('modal-config')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-config'))window.fecharConfig()});

/* ═══════════════════════════════════════════════════════════
   EASTER EGG — ORDEM PARANORMAL RPG
═══════════════════════════════════════════════════════════ */
/* ── Os 5 Elementos oficiais do Outro Lado ── */
const _OP_ORDENS = [
  {
    id:'sangue', nome:'Sangue', emoji:'🩸',
    desc:'Entidade do sentimento. Paixão, dor, obsessão, ódio — tudo que envolve sentir com intensidade absoluta.',
    cor:'#dc143c', glow:'rgba(220,20,60,.65)',
    extra:'op-sangue'
  },
  {
    id:'morte', nome:'Morte', emoji:'💀',
    desc:'Entidade do tempo. Apática, lenta, distorcendo a percepção da existência. Criaturas esqueléticas com Lodo Preto.',
    cor:'#9ca3af', glow:'rgba(156,163,175,.35)',
    extra:'op-morte'
  },
  {
    id:'conhecimento', nome:'Conhecimento', emoji:'📜',
    desc:'Entidade da consciência. Descobrir, aprender, decifrar o que está oculto. Criaturas pensantes e neutras.',
    cor:'#d97706', glow:'rgba(217,119,6,.55)',
    extra:'op-conhecimento'
  },
  {
    id:'energia', nome:'Energia', emoji:'⚡',
    desc:'Entidade do caos. Imprevisível, plasmática, em constante transformação entre sólido, líquido e gasoso.',
    cor:'#7c3aed', glow:'rgba(124,58,237,.65)',
    extra:'op-energia'
  },
  {
    id:'medo', nome:'Medo', emoji:'👁️',
    desc:'Ninguém pode ter afinidade com o Medo. Ele transcende todos os outros elementos. Névoa e desconhecido.',
    cor:'#e5e7eb', glow:'rgba(229,231,235,.2)',
    extra:'op-medo'
  },
];

let _opAtiva = localStorage.getItem('dsos_op_ordem') || null;

/* ══════════════════════════════════════════
   CANVAS — Animações de fundo por Elemento
══════════════════════════════════════════ */
let _opAnimId = null, _opAnimStop = false;

function _pararCanvasOP() {
  _opAnimStop = true;
  if (_opAnimId) { cancelAnimationFrame(_opAnimId); _opAnimId = null; }
  const c = document.getElementById('op-canvas');
  if (c) { const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); }
}

function _iniciarCanvasOP(id) {
  _pararCanvasOP();
  const c = document.getElementById('op-canvas');
  if (!c) return;
  _opAnimStop = false;
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  ({ sangue: _animSangue, morte: _animMorte, conhecimento: _animConhecimento,
     energia: _animEnergia, medo: _animMedo })[id]?.(c);
}

window.addEventListener('resize', () => {
  if (_opAtiva) {
    const c = document.getElementById('op-canvas');
    if (c) { c.width = window.innerWidth; c.height = window.innerHeight; }
  }
});

/* tracker global de mouse para efeitos reativos */
let _opMouseX = window.innerWidth / 2, _opMouseY = window.innerHeight / 2;
document.addEventListener('mousemove', e => { _opMouseX = e.clientX; _opMouseY = e.clientY; });

/* ══════════════════════════════════════════════════════════
   ANIMAÇÕES DE FUNDO — Ordem Paranormal
   Todas as funções recebem o canvas já dimensionado
══════════════════════════════════════════════════════════ */

/* ══ SANGUE — sentimento extremo: pulsação, devoração, fúria ══ */
function _animSangue(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx0 = W/2, cy0 = H/2;

  // ── VEIAS fractais com fluxo de sangue percorrendo ──
  const veins = [];
  function growVein(x,y,ang,len,dep,gen) {
    if(dep<=0||len<12)return;
    const x2=x+Math.cos(ang)*len, y2=y+Math.sin(ang)*len;
    veins.push({x1:x,y1:y,x2,y2,len,w:Math.max(0.6,dep*0.7),a:0.14+dep*0.05,
      flow:Math.random(),fspd:0.004+Math.random()*0.01,gen});
    const sp=0.26+Math.random()*0.4;
    growVein(x2,y2,ang-sp,len*.7,dep-1,gen+1);
    growVein(x2,y2,ang+sp,len*.66,dep-1,gen+1);
    if(Math.random()>.5) growVein(x2,y2,ang+(Math.random()-.5)*.85,len*.5,dep-2,gen+1);
  }
  for(let i=0;i<11;i++) growVein(Math.random()*W,Math.random()*H,Math.random()*Math.PI*2,120+Math.random()*85,7,0);

  // ── GOTAS viscosas (formato de lágrima, brilho úmido) ──
  const drops = Array.from({length:20},()=>({
    x:Math.random()*W, y:-Math.random()*H*.8,
    vy:0.6+Math.random()*1.4, r:2+Math.random()*3.5,
    a:0.5+Math.random()*0.35, trail:[], wob:Math.random()*Math.PI*2
  }));
  const splats = [];

  // ── RACHADURAS que sangram ──
  const cracks = [];
  function makeCrack(x,y,ang,len,dep){
    if(dep<=0||len<8)return;
    const x2=x+Math.cos(ang)*len, y2=y+Math.sin(ang)*len;
    cracks.push({x1:x,y1:y,x2,y2,w:Math.max(.4,dep*.35)});
    for(let i=0;i<1+Math.floor(Math.random()*2);i++)
      makeCrack(x2,y2,ang+(Math.random()-.5)*1.4,len*(.5+Math.random()*.3),dep-1);
  }
  [{x:W*.2,y:H*.1},{x:W*.8,y:H*.85},{x:W*.05,y:H*.5},{x:W*.95,y:H*.3},{x:W*.5,y:H*.92}]
    .forEach(o=>makeCrack(o.x,o.y,Math.random()*Math.PI*2,70,5));

  // ── MANCHAS que se expandem absorvendo fluido ──
  const stains=[]; let stainTmr=0;

  // ── PARTÍCULAS DE FORÇA VITAL: fluem e são sugadas pro centro (apetite) ──
  const bpts = Array.from({length:70},()=>({
    x:Math.random()*W, y:Math.random()*H,
    vx:(Math.random()-.5)*.5, vy:.05+Math.random()*.35,
    r:1+Math.random()*2.2, a:.16+Math.random()*.3, ph:Math.random()*Math.PI*2,
    pull:Math.random()*.4
  }));

  // ── COÁGULOS orgânicos com núcleo interno ──
  const clots = Array.from({length:9},()=>({
    x:Math.random()*W, y:Math.random()*H,
    vx:(Math.random()-.5)*.18, vy:(Math.random()-.5)*.14,
    sz:18+Math.random()*42, a:.16+Math.random()*.22, wb:Math.random()*Math.PI*2,
    spin:(Math.random()-.5)*.01
  }));

  // ── ECG: forma de onda PQRST realista ──
  let ecgX=0;
  function ecgVal(x){
    const c=((x%220)+220)%220;
    if(c<70)return 0;
    if(c<78)return Math.sin((c-70)/8*Math.PI)*.12;          // onda P
    if(c<86)return 0;
    if(c<90)return-(c-86)/4*.18;                             // Q
    if(c<96)return-.18+(c-90)/6*1.18;                        // R (sobe forte)
    if(c<101)return 1-(c-96)/5*1.32;                         // S (desce abaixo)
    if(c<108)return-.32+(c-101)/7*.32;                       // volta
    if(c<118)return 0;
    if(c<140)return Math.sin((c-118)/22*Math.PI)*.28;        // onda T
    return 0;
  }

  // ── Olho que pisca (glitch sutil) ──
  let blinkTmr=0, blink=0;

  let beat=0, mouseHeat=0, symRot=0;

  // ── SÍMBOLO OFICIAL DO SANGUE (losango/quadrado — Símbolos Ocultistas) ──
  function drawSimbolo(cx,cy,sc,a){
    ctx.save(); ctx.translate(cx,cy); ctx.scale(sc,sc);
    ctx.shadowColor='rgba(220,0,30,.7)'; ctx.shadowBlur=18; ctx.lineJoin='miter';
    // losango externo (quadrado girado 45°)
    ctx.beginPath();
    ctx.moveTo(0,-86); ctx.lineTo(60,0); ctx.lineTo(0,86); ctx.lineTo(-60,0); ctx.closePath();
    ctx.strokeStyle=`rgba(225,12,38,${a})`; ctx.lineWidth=3.4; ctx.stroke();
    // quadrado reto inscrito (família "quadrados")
    ctx.beginPath(); ctx.rect(-30,-30,60,60);
    ctx.strokeStyle=`rgba(225,12,38,${a*.55})`; ctx.lineWidth=2; ctx.stroke();
    // losango interno
    ctx.beginPath();
    ctx.moveTo(0,-44); ctx.lineTo(30,0); ctx.lineTo(0,44); ctx.lineTo(-30,0); ctx.closePath();
    ctx.strokeStyle=`rgba(255,45,65,${a*.8})`; ctx.lineWidth=2; ctx.stroke();
    // eixo vertical central
    ctx.beginPath(); ctx.moveTo(0,-86); ctx.lineTo(0,86);
    ctx.strokeStyle=`rgba(255,55,75,${a*.6})`; ctx.lineWidth=1.6; ctx.stroke();
    // núcleo
    ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,60,80,${a})`; ctx.fill();
    ctx.restore();
  }

  function draw() {
    if(_opAnimStop)return;
    ctx.clearRect(0,0,W,H);

    // batimento acelera conforme proximidade do mouse ao centro
    const mdx=_opMouseX-cx0, mdy=_opMouseY-cy0;
    const mdist=Math.sqrt(mdx*mdx+mdy*mdy)/(Math.max(W,H)*.5);
    const target=1-Math.min(1,mdist);            // 0 longe, 1 no centro
    mouseHeat += (target-mouseHeat)*0.05;
    const rate=0.024+mouseHeat*0.04;             // batimento mais rápido perto
    beat+=rate;
    const bc=beat%(Math.PI*2);
    const hi=bc<0.35?Math.sin(bc*Math.PI/.35):bc<0.95?Math.sin((bc-.35)*Math.PI/.6)*.42:0;

    // ── VINHETA RAIVOSA + VISÃO TÚNEL (aperta com a fúria) ──
    const vA=0.34+hi*0.42+mouseHeat*0.12;
    const inner=H*(.5-hi*0.12-mouseHeat*0.06);
    const vig=ctx.createRadialGradient(cx0,cy0,Math.max(20,inner),cx0,cy0,H*.92);
    vig.addColorStop(0,'rgba(0,0,0,0)');
    vig.addColorStop(.55,`rgba(70,0,8,${vA*.35})`);
    vig.addColorStop(1,`rgba(150,0,18,${vA})`);
    ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);

    // ── VEIAS pulsantes com pulso de sangue percorrendo ──
    veins.forEach(v=>{
      const a=v.a+hi*0.28;
      ctx.beginPath(); ctx.moveTo(v.x1,v.y1); ctx.lineTo(v.x2,v.y2);
      ctx.strokeStyle=`rgba(190,0,22,${a})`; ctx.lineWidth=v.w*(1+hi*.5); ctx.stroke();
      // pulso brilhante deslizando pela veia
      v.flow+=v.fspd+hi*.006; if(v.flow>1)v.flow-=1;
      const fx=v.x1+(v.x2-v.x1)*v.flow, fy=v.y1+(v.y2-v.y1)*v.flow;
      ctx.save(); ctx.shadowColor='rgba(255,40,60,.7)'; ctx.shadowBlur=6;
      ctx.beginPath(); ctx.arc(fx,fy,v.w*.9+hi*1.2,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,50,70,${.3+hi*.35})`; ctx.fill(); ctx.restore();
    });

    // ── RACHADURAS pulsando e sangrando nas pontas ──
    const crA=0.22+hi*0.32;
    cracks.forEach(c=>{
      ctx.beginPath(); ctx.moveTo(c.x1,c.y1); ctx.lineTo(c.x2,c.y2);
      ctx.strokeStyle=`rgba(170,0,12,${crA})`; ctx.lineWidth=c.w; ctx.stroke();
      if(hi>.7){ // sangra no pico
        ctx.beginPath(); ctx.arc(c.x2,c.y2,1.4,0,Math.PI*2);
        ctx.fillStyle=`rgba(200,0,25,${(hi-.7)*.8})`; ctx.fill();
      }
    });

    // ── PARTÍCULAS DE FORÇA VITAL sugadas pro centro (devoração) ──
    bpts.forEach(p=>{
      p.ph+=.025;
      // atração suave ao centro + fluxo lateral
      const dx=cx0-p.x, dy=cy0-p.y, dl=Math.hypot(dx,dy)||1;
      p.x+=p.vx+Math.sin(p.ph+p.y*.006)*.45 + (dx/dl)*p.pull*(.4+mouseHeat);
      p.y+=p.vy + (dy/dl)*p.pull*(.4+mouseHeat);
      if(dl<14||p.y>H+5||p.x<-5||p.x>W+5){ // reabsorvido → renasce na borda
        const edge=Math.random()*4|0;
        p.x=edge===0?0:edge===1?W:Math.random()*W;
        p.y=edge===2?0:edge===3?H:Math.random()*H;
      }
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(205,0,28,${p.a})`; ctx.fill();
    });

    // ── GOTAS viscosas em lágrima ──
    drops.forEach(d=>{
      d.wob+=.05;
      d.trail.push({x:d.x,y:d.y}); if(d.trail.length>30)d.trail.shift();
      d.y+=d.vy; d.x+=Math.sin(d.wob)*.25;
      if(d.y>H+18){
        splats.push({x:d.x,y:H,r:0,a:0.75,dr:d.r,arms:Array.from({length:6+(Math.random()*4|0)},()=>({ang:Math.random()*Math.PI*2,len:.5+Math.random()*.8}))});
        d.y=-15; d.x=Math.random()*W; d.trail=[];
      }
      d.trail.forEach((p,i)=>{
        const tf=i/d.trail.length;
        ctx.beginPath(); ctx.arc(p.x,p.y,d.r*tf*.75,0,Math.PI*2);
        ctx.fillStyle=`rgba(165,0,18,${d.a*tf*.6})`; ctx.fill();
      });
      // corpo da gota: círculo + ponta
      ctx.beginPath();
      ctx.moveTo(d.x,d.y-d.r*1.6);
      ctx.quadraticCurveTo(d.x+d.r,d.y-d.r*.3,d.x+d.r*.7,d.y+d.r*.5);
      ctx.arc(d.x,d.y+d.r*.5,d.r*.85,0,Math.PI);
      ctx.quadraticCurveTo(d.x-d.r,d.y-d.r*.3,d.x,d.y-d.r*1.6);
      ctx.fillStyle=`rgba(220,8,36,${d.a})`; ctx.fill();
      // brilho úmido
      ctx.beginPath(); ctx.arc(d.x-d.r*.3,d.y,d.r*.28,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,140,150,${d.a*.5})`; ctx.fill();
    });

    // ── RESPINGOS erráticos orgânicos ──
    for(let i=splats.length-1;i>=0;i--){
      const s=splats[i]; s.r+=1.3; s.a-=.013;
      if(s.a<=0){splats.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(190,0,22,${s.a*.7})`; ctx.lineWidth=1; ctx.stroke();
      s.arms.forEach(arm=>{
        const ex=s.x+Math.cos(arm.ang)*s.r*arm.len, ey=s.y+Math.sin(arm.ang)*s.r*arm.len*.5;
        ctx.beginPath(); ctx.arc(ex,ey,s.dr*.55,0,Math.PI*2);
        ctx.fillStyle=`rgba(170,0,18,${s.a*.85})`; ctx.fill();
      });
    }

    // ── MANCHAS absorvendo fluido ──
    stainTmr++;
    if(stainTmr>180){stainTmr=0;stains.push({x:Math.random()*W,y:Math.random()*H,r:0,max:60+Math.random()*110,a:0.38,ph:'grow'});}
    for(let i=stains.length-1;i>=0;i--){
      const s=stains[i];
      if(s.ph==='grow'){s.r+=.65;if(s.r>=s.max)s.ph='fade';}
      else{s.a-=.0028;if(s.a<=0){stains.splice(i,1);continue;}}
      const rg=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r);
      rg.addColorStop(0,`rgba(95,0,12,${s.a})`);
      rg.addColorStop(.55,`rgba(55,0,7,${s.a*.5})`);
      rg.addColorStop(1,'rgba(25,0,3,0)');
      ctx.fillStyle=rg; ctx.fillRect(s.x-s.r,s.y-s.r,s.r*2,s.r*2);
    }

    // ── COÁGULOS orgânicos com núcleo ──
    clots.forEach(c=>{
      c.wb+=.012; c.x+=c.vx+Math.sin(c.wb)*.14; c.y+=c.vy+Math.cos(c.wb*.8)*.1;
      if(c.x<-c.sz)c.x=W+c.sz; if(c.x>W+c.sz)c.x=-c.sz;
      if(c.y<-c.sz)c.y=H+c.sz; if(c.y>H+c.sz)c.y=-c.sz;
      ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.wb*c.spin*30);
      ctx.beginPath();
      for(let a=0;a<Math.PI*2;a+=.18){
        const r=c.sz*(.58+Math.sin(a*3.1+c.wb)*.42);
        a<.1?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
      }
      ctx.closePath();
      const cg=ctx.createRadialGradient(0,0,0,0,0,c.sz);
      cg.addColorStop(0,`rgba(120,0,18,${c.a+hi*.12})`);
      cg.addColorStop(1,`rgba(55,0,8,${c.a*.7})`);
      ctx.fillStyle=cg; ctx.fill();
      ctx.strokeStyle=`rgba(160,0,20,${c.a*.55})`; ctx.lineWidth=.8; ctx.stroke();
      ctx.restore();
    });

    // ── ECG por cima de tudo (linha de vida) ──
    ecgX+=2.4+mouseHeat*2.5;            // acelera perto do mouse
    if(ecgX>W+250)ecgX-=(W+250);
    ctx.save();
    ctx.shadowColor='rgba(255,50,80,.9)'; ctx.shadowBlur=7;
    ctx.beginPath(); ctx.strokeStyle=`rgba(255,55,80,${0.5+hi*0.45})`; ctx.lineWidth=1.6;
    for(let x=0;x<W;x+=2){
      const y=cy0-H*.32+ecgVal(ecgX-x)*0; // base
      const yy=cy0-H*.30 - ecgVal(ecgX-x)*70;
      x===0?ctx.moveTo(x,yy):ctx.lineTo(x,yy);
    }
    ctx.stroke(); ctx.restore();
    const hX=((ecgX%W)+W)%W;
    const hY=cy0-H*.30-ecgVal(0)*70;
    ctx.save(); ctx.shadowColor='rgba(255,50,80,1)'; ctx.shadowBlur=18;
    ctx.beginPath(); ctx.arc(hX,hY,3.5,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,90,110,${0.7+hi*.3})`; ctx.fill(); ctx.restore();

    // ── SÍMBOLO DO SANGUE pulsando com o batimento ──
    drawSimbolo(cx0,cy0,0.85+hi*0.1,0.14+hi*0.22);

    // ── AURA reativa ao cursor ──
    const aura=ctx.createRadialGradient(_opMouseX,_opMouseY,0,_opMouseX,_opMouseY,70+hi*30);
    aura.addColorStop(0,`rgba(200,0,30,${.12+hi*.1})`);
    aura.addColorStop(1,'rgba(200,0,30,0)');
    ctx.fillStyle=aura; ctx.fillRect(_opMouseX-100,_opMouseY-100,200,200);

    // ── PISCADA total ocasional (a tela "pisca como um olho") ──
    blinkTmr++;
    if(blink<=0 && blinkTmr>520+Math.random()*600){blinkTmr=0;blink=1;}
    if(blink>0){
      blink-=.07;
      const bh=H*(1-Math.abs(Math.sin(blink*Math.PI)));
      ctx.fillStyle='rgba(8,0,0,.92)';
      ctx.fillRect(0,0,W,bh*.5); ctx.fillRect(0,H-bh*.5,W,bh*.5);
    }

    _opAnimId=requestAnimationFrame(draw);
  }
  draw();
}

/* ══ MORTE — tempo roubado: espirais eternas, lodo, entropia ══ */
function _animMorte(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // ── ESPIRAIS em camadas (profundidade 3D), velocidade variável ──
  const spirals = Array.from({length:4},()=>({
    x:W*.15+Math.random()*W*.7, y:H*.15+Math.random()*H*.7,
    ang:Math.random()*Math.PI*2, speed:(.0018+Math.random()*.0035)*(Math.random()>.5?1:-1),
    r:80+Math.random()*110, alpha:.13+Math.random()*.14,
    layers:2+(Math.random()*2|0), warpPh:Math.random()*Math.PI*2
  }));

  // ── PARTÍCULAS ORBITAIS que revertem (loops do tempo) ──
  const loopPts = Array.from({length:30},()=>({
    t:Math.random(), spd:.001+Math.random()*.003,
    cx:Math.random()*W, cy:Math.random()*H,
    rx:40+Math.random()*90, ry:25+Math.random()*55,
    angOffset:Math.random()*Math.PI*2,
    r:1.5+Math.random()*2, a:.18+Math.random()*.22,
    trail:[], rev:false, revT:0
  }));

  // ── LODO PRETO mercurial (denso, brilhante) subindo em bolhas ──
  const sludge = Array.from({length:13},()=>({
    x:Math.random()*W, y:H+30+Math.random()*80,
    vy:-(0.1+Math.random()*.28), sz:35+Math.random()*72,
    wb:Math.random()*Math.PI*2, a:.5+Math.random()*.35
  }));

  // ── RELÓGIO INVERTIDO com ticks distorcidos ──
  const clkX=W*.88, clkY=H*.13, clkR=42;
  let clkAng=0, clkJitter=0;

  // ── MÃOS ESQUELÉTICAS detalhadas nos cantos ──
  const skelHands=[
    {x:-6,y:H+6,rot:-.5,ph:0},{x:W+6,y:-6,rot:Math.PI+.5,ph:2.1},
    {x:W+6,y:H+6,rot:Math.PI-.5,ph:4.2},{x:-6,y:H*.5,rot:.15,ph:1.05}
  ];
  function drawHand(x,y,rot,alpha){
    if(alpha<.01)return;
    ctx.save(); ctx.translate(x,y); ctx.rotate(rot);
    ctx.globalAlpha=alpha; ctx.strokeStyle='rgba(150,153,162,1)';
    ctx.fillStyle='rgba(150,153,162,1)'; ctx.lineWidth=1.4; ctx.lineCap='round';
    // antebraço (rádio + ulna)
    ctx.beginPath(); ctx.moveTo(-5,4); ctx.lineTo(-7,34); ctx.moveTo(5,4); ctx.lineTo(7,34); ctx.stroke();
    // metacarpo (palma)
    ctx.beginPath(); ctx.moveTo(-12,-7); ctx.lineTo(-9,6); ctx.lineTo(9,6); ctx.lineTo(12,-7); ctx.stroke();
    // dedos com falanges + nós
    [-11,-6,0,6,11].forEach((fx,i)=>{
      const fl=i===0?17:i===2?25:22;
      const j1=-7-fl*.4, j2=-7-fl*.72, tip=-7-fl;
      ctx.beginPath(); ctx.moveTo(fx,-7); ctx.lineTo(fx-1,j1); ctx.lineTo(fx,j2); ctx.lineTo(fx+1,tip); ctx.stroke();
      // articulações
      ctx.beginPath(); ctx.arc(fx-1,j1,1.6,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(fx,j2,1.4,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1; ctx.restore();
  }

  // ── CINZAS subindo (fumaça pesada) ──
  const ashes = Array.from({length:75},()=>({
    x:Math.random()*W, y:H+Math.random()*80,
    vx:(Math.random()-.5)*.4, vy:-(0.13+Math.random()*.5),
    r:1+Math.random()*2.6, a:.13+Math.random()*.22, wb:Math.random()*Math.PI*2
  }));

  // ── AMPULHETA: areia caindo + monte acumulando embaixo ──
  const hgX=W*.5, hgTop=H*.16, hgMid=H*.5, hgBot=H*.84, hgW=48;
  const sand = Array.from({length:65},()=>({
    x:hgX+(Math.random()-.5)*hgW*.8, y:hgTop+Math.random()*(hgMid-hgTop),
    vy:.4+Math.random()*.8, r:1+Math.random()*1.8, a:.2+Math.random()*.22
  }));

  // ── ECOS fantasmas (rastros de movimento) ──
  const echoes = Array.from({length:16},()=>({
    x:Math.random()*W, y:Math.random()*H,
    vx:(Math.random()-.5)*.5, vy:(Math.random()-.5)*.35,
    trail:[], r:2+Math.random()*2.5, a:.18+Math.random()*.2
  }));

  // ── ZONAS QUE O PRETO CONSOME (entropia) ──
  const voids=[]; let voidTmr=0;

  let t=0, timeWarp=1, warpTarget=1, warpTmr=0, symRot=0;

  function drawSpiral(cx,cy,baseAng,radius,alpha,layers){
    for(let L=0;L<layers;L++){
      const lr=radius*(1-L*0.28), la=alpha*(1-L*0.25);
      ctx.beginPath();
      for(let i=0;i<240;i++){
        const a=baseAng+i*.15+L*.6; const r=(i/240)*lr;
        const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r*.6;
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.strokeStyle=`rgba(${110-L*20},${110-L*20},${128-L*20},${la})`;
      ctx.lineWidth=1.1-L*0.25; ctx.stroke();
    }
  }

  // ── SÍMBOLO OFICIAL DA MORTE (espiral anti-horária + eixo vertical + linhas radiais) ──
  function drawSimbolo(cx,cy,rot,a){
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot);
    ctx.shadowColor='rgba(150,153,168,.5)'; ctx.shadowBlur=14;
    ctx.strokeStyle=`rgba(190,193,205,${a})`; ctx.lineWidth=2.6; ctx.lineCap='round';
    const maxR=78, turns=3.1, steps=300;
    // espiral no sentido ANTI-HORÁRIO (ângulo negativo)
    ctx.beginPath();
    for(let i=0;i<=steps;i++){
      const p=i/steps; const th=-p*turns*Math.PI*2; const r=p*maxR;
      const x=Math.cos(th)*r, y=Math.sin(th)*r;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.stroke();
    // linha vertical no meio
    ctx.beginPath(); ctx.moveTo(0,-maxR*1.18); ctx.lineTo(0,maxR*1.18);
    ctx.strokeStyle=`rgba(205,208,220,${a*1.05})`; ctx.lineWidth=2.2; ctx.stroke();
    // várias linhas radiais seguindo o ângulo da espiral
    ctx.strokeStyle=`rgba(170,173,188,${a*.7})`; ctx.lineWidth=1.4;
    for(let k=0;k<8;k++){
      const ang=-(k/8)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang)*maxR*.42,Math.sin(ang)*maxR*.42);
      ctx.lineTo(Math.cos(ang)*maxR*1.08,Math.sin(ang)*maxR*1.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(){
    if(_opAnimStop)return;
    ctx.clearRect(0,0,W,H);

    // distorção temporal: velocidade global flutua aleatoriamente
    warpTmr++;
    if(warpTmr>120+Math.random()*200){warpTmr=0;warpTarget=0.25+Math.random()*1.6;}
    timeWarp+=(warpTarget-timeWarp)*0.02;
    t+=.008*timeWarp;

    // ── VINHETA CINZA intensificando ──
    const vg=ctx.createRadialGradient(W/2,H/2,H*.1,W/2,H/2,H*.88);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(.6,`rgba(5,5,8,${.2+Math.sin(t*.4)*.06})`);
    vg.addColorStop(1,`rgba(0,0,0,${.42+Math.sin(t*.4)*.1})`);
    ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);

    // ── ESPIRAIS HIPNÓTICAS (giro com aceleração variável) ──
    spirals.forEach(s=>{
      s.warpPh+=.01;
      s.ang+=s.speed*timeWarp*(.6+Math.sin(s.warpPh)*.5);
      drawSpiral(s.x,s.y,s.ang,s.r,s.alpha,s.layers);
    });

    // ── LODO MERCURIAL subindo ──
    sludge.forEach(s=>{
      s.wb+=.014*timeWarp; s.y+=s.vy*timeWarp; s.x+=Math.sin(s.wb)*.25;
      if(s.y<-s.sz*2){s.y=H+s.sz+Math.random()*60; s.x=Math.random()*W;}
      ctx.save(); ctx.translate(s.x,s.y);
      ctx.beginPath();
      for(let a=0;a<Math.PI*2;a+=.16){
        const r=s.sz*(.5+Math.sin(a*2.7+s.wb)*.5);
        a<.1?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
      }
      ctx.closePath();
      // preenchimento mercurial: gradiente escuro→reflexo
      const sg=ctx.createRadialGradient(-s.sz*.25,-s.sz*.3,0,0,0,s.sz);
      sg.addColorStop(0,`rgba(70,72,82,${s.a*.5})`);
      sg.addColorStop(.4,`rgba(12,12,16,${s.a})`);
      sg.addColorStop(1,`rgba(0,0,2,${s.a})`);
      ctx.fillStyle=sg; ctx.fill();
      // reflexo brilhante (mercúrio)
      ctx.beginPath(); ctx.ellipse(-s.sz*.25,-s.sz*.3,s.sz*.22,s.sz*.12,-.5,0,Math.PI*2);
      ctx.fillStyle=`rgba(150,153,165,${s.a*.4})`; ctx.fill();
      ctx.restore();
    });

    // ── PARTÍCULAS ORBITAIS (revertem) ──
    loopPts.forEach(p=>{
      p.revT++; if(p.revT>200+Math.floor(Math.random()*300)){p.revT=0;p.rev=!p.rev;}
      p.t+=(p.rev?-p.spd:p.spd)*timeWarp;
      const ang=p.t*Math.PI*2;
      const x=p.cx+Math.cos(ang+p.angOffset)*p.rx;
      const y=p.cy+Math.sin(ang)*p.ry;
      p.trail.push({x,y}); if(p.trail.length>18)p.trail.shift();
      p.trail.forEach((pt,i)=>{
        const f=i/p.trail.length;
        ctx.beginPath(); ctx.arc(pt.x,pt.y,p.r*f*.8,0,Math.PI*2);
        ctx.fillStyle=`rgba(100,100,115,${p.a*f*.7})`; ctx.fill();
      });
      ctx.beginPath(); ctx.arc(x,y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(150,150,165,${p.a})`; ctx.fill();
    });

    // ── RELÓGIO INVERTIDO com tick distorcido ──
    clkAng-=.006*timeWarp;
    if(Math.random()>.97)clkJitter=(Math.random()-.5)*.3; else clkJitter*=.85;
    ctx.save(); ctx.translate(clkX,clkY); ctx.rotate(clkJitter*.05);
    ctx.beginPath(); ctx.arc(0,0,clkR,0,Math.PI*2);
    ctx.strokeStyle='rgba(105,105,120,.5)'; ctx.lineWidth=1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,clkR-4,0,Math.PI*2);
    ctx.strokeStyle='rgba(105,105,120,.18)'; ctx.lineWidth=.6; ctx.stroke();
    for(let i=0;i<12;i++){
      const ma=(i/12)*Math.PI*2 + (Math.random()>.9?clkJitter:0); // ticks tremem
      const big=i%3===0;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ma)*(clkR-(big?8:5)),Math.sin(ma)*(clkR-(big?8:5)));
      ctx.lineTo(Math.cos(ma)*clkR,Math.sin(ma)*clkR);
      ctx.strokeStyle=`rgba(110,110,125,${big?.5:.32})`; ctx.lineWidth=big?1.2:.7; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.lineTo(Math.cos(clkAng)*clkR*.62,Math.sin(clkAng)*clkR*.62);
    ctx.strokeStyle='rgba(135,135,150,.65)'; ctx.lineWidth=1.8; ctx.lineCap='round'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.lineTo(Math.cos(clkAng*12)*clkR*.85,Math.sin(clkAng*12)*clkR*.85);
    ctx.strokeStyle='rgba(125,125,140,.5)'; ctx.lineWidth=1; ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,2.2,0,Math.PI*2); ctx.fillStyle='rgba(140,140,155,.7)'; ctx.fill();
    ctx.restore();

    // ── MÃOS ESQUELÉTICAS ──
    skelHands.forEach(h=>{ h.ph+=.003*timeWarp; drawHand(h.x,h.y,h.rot,Math.max(0,Math.sin(h.ph)*.55)); });

    // ── CINZAS SUBINDO ──
    ashes.forEach(a=>{
      a.wb+=.014; a.x+=a.vx+Math.sin(a.wb)*.28; a.y+=a.vy*timeWarp;
      if(a.y<-12){a.y=H+12; a.x=Math.random()*W;}
      ctx.beginPath(); ctx.arc(a.x,a.y,a.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(125,125,140,${a.a})`; ctx.fill();
    });

    // ── AMPULHETA: contorno + areia caindo + monte ──
    ctx.strokeStyle='rgba(95,95,110,.3)'; ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.moveTo(hgX-hgW,hgTop); ctx.lineTo(hgX+hgW,hgTop);
    ctx.lineTo(hgX+7,hgMid); ctx.lineTo(hgX+hgW,hgBot);
    ctx.lineTo(hgX-hgW,hgBot); ctx.lineTo(hgX-7,hgMid);
    ctx.closePath(); ctx.stroke();
    // tampas
    ctx.beginPath(); ctx.moveTo(hgX-hgW-6,hgTop); ctx.lineTo(hgX+hgW+6,hgTop);
    ctx.moveTo(hgX-hgW-6,hgBot); ctx.lineTo(hgX+hgW+6,hgBot);
    ctx.strokeStyle='rgba(95,95,110,.45)'; ctx.lineWidth=2; ctx.stroke();
    // monte de areia acumulado embaixo
    const pile=Math.abs(Math.sin(t*.5))*22+14;
    ctx.beginPath(); ctx.moveTo(hgX-hgW*.7,hgBot);
    ctx.lineTo(hgX,hgBot-pile); ctx.lineTo(hgX+hgW*.7,hgBot); ctx.closePath();
    ctx.fillStyle='rgba(105,105,120,.3)'; ctx.fill();
    sand.forEach(s=>{
      s.y+=s.vy*timeWarp;
      // funil: aperta no gargalo
      const reach=Math.min(1,(s.y-hgTop)/(hgMid-hgTop));
      const maxx=hgW*(1-reach*.85);
      if(s.x>hgX+maxx)s.x=hgX+maxx; if(s.x<hgX-maxx)s.x=hgX-maxx;
      if(s.y>hgMid){ // passou o gargalo → cai no fundo e some no monte
        if(s.y>hgBot-pile){s.y=hgTop+Math.random()*10;s.x=hgX+(Math.random()-.5)*hgW*.8;}
      }
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(120,120,135,${s.a})`; ctx.fill();
    });

    // ── ECOS fantasma ──
    echoes.forEach(p=>{
      p.x+=p.vx*timeWarp; p.y+=p.vy*timeWarp;
      if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1;
      p.trail.push({x:p.x,y:p.y}); if(p.trail.length>35)p.trail.shift();
      p.trail.forEach((pt,i)=>{
        const f=i/p.trail.length;
        ctx.beginPath(); ctx.arc(pt.x,pt.y,p.r*f,0,Math.PI*2);
        ctx.fillStyle=`rgba(90,90,105,${p.a*f*.6})`; ctx.fill();
      });
    });

    // ── SÍMBOLO DA MORTE girando lentamente (anti-horário) ──
    symRot-=.0025*timeWarp;
    drawSimbolo(W*.5,H*.5,symRot,0.16+Math.sin(t*.5)*.05);

    // ── PRETO CONSUMINDO zonas (entropia) ──
    voidTmr++;
    if(voidTmr>260){voidTmr=0;voids.push({x:Math.random()*W,y:Math.random()*H,r:0,max:50+Math.random()*90,a:0,ph:'in'});}
    for(let i=voids.length-1;i>=0;i--){
      const v=voids[i];
      if(v.ph==='in'){v.r+=.5;v.a=Math.min(.5,v.a+.004);if(v.r>=v.max)v.ph='out';}
      else{v.a-=.0035;if(v.a<=0){voids.splice(i,1);continue;}}
      const vg2=ctx.createRadialGradient(v.x,v.y,0,v.x,v.y,v.r);
      vg2.addColorStop(0,`rgba(0,0,0,${v.a})`);
      vg2.addColorStop(.7,`rgba(0,0,0,${v.a*.6})`);
      vg2.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=vg2; ctx.fillRect(v.x-v.r,v.y-v.r,v.r*2,v.r*2);
    }

    _opAnimId=requestAnimationFrame(draw);
  }
  draw();
}

/* ══ CONHECIMENTO — saber infinito: sigilos, ouro, decifração ══ */
function _animConhecimento(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const RUNES=['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛇ','ᛈ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛞ','ᛟ','☿','♆','⊕','✦','⊗','☽','⁂','∞','∆','Ω','Φ','Σ','⌘','◈'];
  const ANCIENT=['𓂀','𓃀','𓅀','𓆀','𓇀','𓈀','𓉀','字','知','悟','道','理','元','気','命','魂','呪'];
  const rnd=()=>Math.random();
  const GOLD=(a)=>`rgba(255,185,30,${a})`;

  // ── RUNAS douradas subindo (brilham mais perto do cursor) ──
  const risingRunes=Array.from({length:34},()=>({
    x:rnd()*W, y:H+rnd()*H, vy:-(0.25+rnd()*.7),
    char:RUNES[Math.floor(rnd()*RUNES.length)],
    sz:14+rnd()*24, maxA:.4+rnd()*.45, life:rnd()
  }));

  // ── CONSTELAÇÕES que se reorganizam ──
  const stars=Array.from({length:38},()=>({
    x:rnd()*W, y:rnd()*H, tx:rnd()*W, ty:rnd()*H,
    r:1.2+rnd()*2, a:.2+rnd()*.3, tw:rnd()*Math.PI*2, mv:.002+rnd()*.004
  }));
  let starReformTmr=0;

  // ── CHUVA MATRIX dourada (caracteres se decompõem em luz) ──
  const colW=20, COLS_C=Math.floor(W/colW);
  const letterCols=Array.from({length:COLS_C},(_,i)=>({
    x:i*colW+colW/2, y:-rnd()*H, spd:.8+rnd()*1.8,
    chars:Array.from({length:16},()=>ANCIENT[Math.floor(rnd()*ANCIENT.length)]),
    active:rnd()>.55, timer:rnd()*220
  }));
  const sparks=[]; // luz da decomposição

  // ── FIBONACCI + proporção áurea ──
  const fibPts=[];
  for(let i=0;i<150;i++){
    const a=i*2.399, r=Math.sqrt(i)*10;
    fibPts.push({x:W*.3+Math.cos(a)*r, y:H*.7+Math.sin(a)*r*.65});
  }
  let fibP=0;

  // ── MAPA MENTAL vivo ──
  const nodes=Array.from({length:11},()=>({
    x:80+rnd()*(W-160), y:80+rnd()*(H-160),
    r:3+rnd()*5, maxA:.28+rnd()*.3, life:rnd(), spd:.004+rnd()*.006, conns:[]
  }));
  nodes.forEach((n,i)=>nodes.forEach((_,j)=>{if(j>i&&rnd()>.4)n.conns.push(j);}));

  // ── PERGAMINHOS com bordas queimadas ──
  const scrolls=Array.from({length:5},()=>({
    x:rnd()*W, y:rnd()*H, w:50+rnd()*60, life:rnd(), spd:.003+rnd()*.004
  }));

  // ── CÍRCULOS ARCANOS contra-rotativos (camadas) ──
  const arcCircles=Array.from({length:3},()=>({
    x:80+rnd()*(W-160), y:80+rnd()*(H-160),
    r:55+rnd()*75, ang:0, spd:(.002+rnd()*.004)*(rnd()>.5?1:-1),
    a:.22+rnd()*.2,
    chars:Array.from({length:10},()=>RUNES[Math.floor(rnd()*RUNES.length)])
  }));

  // ── TEIA de saber (pulsos transmitindo informação) ──
  const webPts=Array.from({length:30},()=>({
    x:rnd()*W, y:rnd()*H, vx:(rnd()-.5)*.25, vy:(rnd()-.5)*.25,
    r:1.5+rnd()*1.5, a:.2+rnd()*.22
  }));
  const pulses=[]; let pulseTmr=0;

  // ── DECIFRANDO (rodapé) ──
  let deciText=RUNES.slice(0,8).join(' '), deciTimer=0;

  // ── aura quando o mouse fica parado (absorve conhecimento) ──
  let lastMX=_opMouseX, lastMY=_opMouseY, idle=0;

  let t=0;

  // ── SÍMBOLO OFICIAL DO CONHECIMENTO (triângulo + sigilos) ──
  function drawSimbolo(cx,cy,a){
    ctx.save(); ctx.translate(cx,cy);
    ctx.shadowColor='rgba(255,180,30,.55)'; ctx.shadowBlur=16;
    const R=84;
    // triângulo equilátero apontando para cima
    ctx.beginPath();
    for(let k=0;k<3;k++){const ka=-Math.PI/2+k/3*Math.PI*2;ctx.lineTo(Math.cos(ka)*R,Math.sin(ka)*R);}
    ctx.closePath(); ctx.strokeStyle=`rgba(255,190,35,${a})`; ctx.lineWidth=3.2; ctx.stroke();
    // triângulo interno
    ctx.beginPath();
    for(let k=0;k<3;k++){const ka=-Math.PI/2+k/3*Math.PI*2;ctx.lineTo(Math.cos(ka)*R*.55,Math.sin(ka)*R*.55);}
    ctx.closePath(); ctx.strokeStyle=`rgba(255,190,35,${a*.6})`; ctx.lineWidth=1.8; ctx.stroke();
    // núcleo
    ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fillStyle=`rgba(255,210,65,${a})`; ctx.fill();
    // sigilos do Conhecimento nos vértices
    ctx.font='bold 19px Georgia,serif'; ctx.fillStyle=`rgba(255,200,55,${a*1.1})`; ctx.textAlign='center';
    const sig=['ᛟ','ᚦ','ᛉ'];
    for(let k=0;k<3;k++){const ka=-Math.PI/2+k/3*Math.PI*2;ctx.fillText(sig[k],Math.cos(ka)*R*1.2,Math.sin(ka)*R*1.2+6);}
    ctx.textAlign='left';
    ctx.restore();
  }

  function draw(){
    if(_opAnimStop)return;
    ctx.clearRect(0,0,W,H);
    t+=.01;

    // detecta mouse parado
    if(Math.abs(_opMouseX-lastMX)<2&&Math.abs(_opMouseY-lastMY)<2) idle=Math.min(idle+1,200);
    else idle=0;
    lastMX=_opMouseX; lastMY=_opMouseY;

    // ── CHUVA MATRIX (fundo) ──
    letterCols.forEach(col=>{
      col.timer++;
      if(!col.active&&col.timer>60+rnd()*180){col.active=true;col.timer=0;col.y=-20;col.chars=col.chars.map(()=>ANCIENT[Math.floor(rnd()*ANCIENT.length)]);}
      if(!col.active)return;
      col.y+=col.spd; if(col.y>H+140){col.active=false;col.timer=0;}
      col.chars.forEach((c,i)=>{
        const cy=col.y-i*22; if(cy<-5||cy>H+5)return;
        const a=i===0?.7:Math.max(0,.34-i*.02);
        ctx.font=`${i===0?'bold ':''}14px monospace`;
        ctx.fillStyle=i===0?`rgba(255,225,140,${a})`:GOLD(a); ctx.fillText(c,col.x,cy);
      });
      // decompõe em luz no fim
      if(col.y>H&&rnd()>.8) sparks.push({x:col.x,y:H-rnd()*40,vy:-(.3+rnd()),a:.5,r:1+rnd()*1.5});
    });
    for(let i=sparks.length-1;i>=0;i--){
      const s=sparks[i]; s.y+=s.vy; s.a-=.012;
      if(s.a<=0){sparks.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,220,120,${s.a})`; ctx.fill();
    }

    // ── CONSTELAÇÕES que migram e se reorganizam ──
    starReformTmr++;
    if(starReformTmr>320){starReformTmr=0;stars.forEach(s=>{s.tx=rnd()*W;s.ty=rnd()*H;});}
    stars.forEach(s=>{
      s.x+=(s.tx-s.x)*s.mv; s.y+=(s.ty-s.y)*s.mv; s.tw+=.02;
      const a=s.a*(.7+Math.sin(s.tw)*.3);
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,205,70,${a})`; ctx.fill();
    });
    for(let i=0;i<stars.length;i++) for(let j=i+1;j<stars.length;j++){
      const dx=stars[i].x-stars[j].x, dy=stars[i].y-stars[j].y, d=Math.sqrt(dx*dx+dy*dy);
      if(d<120){ctx.beginPath();ctx.moveTo(stars[i].x,stars[i].y);ctx.lineTo(stars[j].x,stars[j].y);
        ctx.strokeStyle=GOLD((1-d/120)*.2);ctx.lineWidth=.6;ctx.stroke();}
    }

    // ── FIBONACCI traçando ──
    fibP+=.3; if(fibP>fibPts.length)fibP=0;
    const fv=Math.floor(fibP);
    if(fv>1){
      ctx.save(); ctx.shadowColor='rgba(255,165,20,.4)'; ctx.shadowBlur=6;
      ctx.beginPath(); ctx.moveTo(fibPts[0].x,fibPts[0].y);
      for(let i=1;i<Math.min(fv,fibPts.length);i++)ctx.lineTo(fibPts[i].x,fibPts[i].y);
      ctx.strokeStyle='rgba(255,175,25,.4)'; ctx.lineWidth=1.3; ctx.stroke();
      const lp=fibPts[Math.min(fv-1,fibPts.length-1)];
      ctx.beginPath(); ctx.arc(lp.x,lp.y,3.5,0,Math.PI*2);
      ctx.fillStyle='rgba(255,210,90,.8)'; ctx.fill();
      ctx.restore();
    }

    // ── MAPA MENTAL vivo ──
    nodes.forEach(n=>{
      n.life+=n.spd; if(n.life>1){n.life=0;n.x=80+rnd()*(W-160);n.y=80+rnd()*(H-160);}
      const a=Math.sin(n.life*Math.PI)*n.maxA;
      n.conns.forEach(j=>{
        const m=nodes[j]; const ma=Math.sin(m.life*Math.PI)*m.maxA;
        ctx.beginPath(); ctx.moveTo(n.x,n.y); ctx.lineTo(m.x,m.y);
        ctx.strokeStyle=`rgba(255,165,20,${Math.min(a,ma)*.6})`; ctx.lineWidth=.6; ctx.stroke();
      });
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
      ctx.fillStyle=GOLD(a); ctx.fill();
    });

    // ── PERGAMINHOS com bordas queimadas ──
    scrolls.forEach(s=>{
      s.life+=s.spd; if(s.life>1){s.life=0;s.x=rnd()*W;s.y=rnd()*H;}
      const a=Math.sin(s.life*Math.PI)*.42; if(a<.02)return;
      ctx.save(); ctx.translate(s.x,s.y);
      // corpo do pergaminho
      ctx.fillStyle=`rgba(60,42,14,${a*.5})`;
      ctx.fillRect(-s.w*.5,-s.w*.3,s.w,s.w*.6);
      ctx.strokeStyle=`rgba(225,165,35,${a})`; ctx.lineWidth=1;
      ctx.beginPath(); ctx.ellipse(0,-s.w*.3,s.w*.5,6,0,0,Math.PI*2); ctx.stroke();
      ctx.strokeRect(-s.w*.5,-s.w*.3,s.w,s.w*.6);
      ctx.beginPath(); ctx.ellipse(0,s.w*.3,s.w*.5,6,0,0,Math.PI*2); ctx.stroke();
      // bordas queimadas (irregulares escuras)
      ctx.strokeStyle=`rgba(40,18,5,${a*.9})`; ctx.lineWidth=2.5;
      ctx.beginPath();
      for(let e=0;e<=10;e++){const ex=-s.w*.5+(s.w/10)*e;ctx.lineTo(ex,-s.w*.3+(rnd()-.5)*4);}
      ctx.stroke();
      // texto
      for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(-s.w*.4,-s.w*.15+i*9);ctx.lineTo(s.w*.4*(rnd()*.3+.7),-s.w*.15+i*9);ctx.strokeStyle=`rgba(225,165,35,${a*.55})`;ctx.lineWidth=.7;ctx.stroke();}
      ctx.restore();
    });

    // ── CÍRCULOS ARCANOS contra-rotativos com camadas ──
    arcCircles.forEach(c=>{
      c.ang+=c.spd;
      ctx.save(); ctx.translate(c.x,c.y);
      ctx.shadowColor='rgba(255,165,20,.3)'; ctx.shadowBlur=8;
      ctx.strokeStyle=GOLD(c.a*1.1);
      // anel externo
      ctx.lineWidth=.9; ctx.beginPath(); ctx.arc(0,0,c.r,0,Math.PI*2); ctx.stroke();
      // anel interno girando ao contrário
      ctx.save(); ctx.rotate(-c.ang*2);
      ctx.beginPath(); ctx.arc(0,0,c.r*.7,0,Math.PI*2);
      ctx.strokeStyle=GOLD(c.a*.7); ctx.stroke();
      // triângulo central
      ctx.beginPath();
      for(let k=0;k<3;k++){const ka=k/3*Math.PI*2-Math.PI/2;ctx.lineTo(Math.cos(ka)*c.r*.4,Math.sin(ka)*c.r*.4);}
      ctx.closePath(); ctx.strokeStyle=GOLD(c.a*.5); ctx.stroke();
      ctx.restore();
      // runas no anel externo
      ctx.rotate(c.ang);
      c.chars.forEach((ch,i)=>{
        const a2=(i/c.chars.length)*Math.PI*2;
        ctx.font='bold 11px Georgia,serif'; ctx.fillStyle=`rgba(255,200,55,${c.a*1.3})`;
        ctx.fillText(ch,Math.cos(a2)*c.r-5,Math.sin(a2)*c.r+5);
      });
      ctx.restore();
    });

    // ── TEIA DE SABER + pulsos viajando ──
    webPts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;});
    pulseTmr++;
    if(pulseTmr>30){pulseTmr=0;const a=Math.floor(rnd()*webPts.length);pulses.push({from:a,to:Math.floor(rnd()*webPts.length),t:0});}
    for(let i=0;i<webPts.length;i++){
      for(let j=i+1;j<webPts.length;j++){
        const dx=webPts[i].x-webPts[j].x,dy=webPts[i].y-webPts[j].y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<140){ctx.beginPath();ctx.moveTo(webPts[i].x,webPts[i].y);ctx.lineTo(webPts[j].x,webPts[j].y);
          ctx.strokeStyle=`rgba(225,160,28,${(1-d/140)*.2})`;ctx.lineWidth=.5;ctx.stroke();}
      }
      ctx.beginPath();ctx.arc(webPts[i].x,webPts[i].y,webPts[i].r,0,Math.PI*2);
      ctx.fillStyle=GOLD(webPts[i].a);ctx.fill();
    }
    for(let i=pulses.length-1;i>=0;i--){
      const pl=pulses[i]; pl.t+=.04; if(pl.t>=1){pulses.splice(i,1);continue;}
      const a=webPts[pl.from], b=webPts[pl.to];
      const px=a.x+(b.x-a.x)*pl.t, py=a.y+(b.y-a.y)*pl.t;
      ctx.save(); ctx.shadowColor='rgba(255,210,90,.8)'; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(px,py,2,0,Math.PI*2);
      ctx.fillStyle='rgba(255,225,140,.9)'; ctx.fill(); ctx.restore();
    }

    // ── RUNAS douradas subindo (glow maior perto do cursor) ──
    risingRunes.forEach(r=>{
      r.y+=r.vy; r.life+=.005;
      if(r.y<-50||r.life>1){r.y=H+20;r.x=rnd()*W;r.life=0;r.char=RUNES[Math.floor(rnd()*RUNES.length)];r.vy=-(0.25+rnd()*.7);}
      const dm=Math.hypot(r.x-_opMouseX,r.y-_opMouseY);
      const near=Math.max(0,1-dm/160);
      const a=Math.sin(r.life*Math.PI)*r.maxA*(1+near);
      ctx.save();
      ctx.shadowColor='rgba(255,180,20,.6)'; ctx.shadowBlur=8+near*18;
      ctx.font=`bold ${r.sz+near*6}px Georgia,serif`;
      ctx.fillStyle=`rgba(255,${190+near*40},${30+near*80},${a})`; ctx.fillText(r.char,r.x,r.y);
      ctx.restore();
    });

    // ── SÍMBOLO DO CONHECIMENTO (triângulo central) ──
    drawSimbolo(W/2,H/2,0.16+Math.sin(t)*0.05);

    // ── AURA ao parar o mouse ──
    if(idle>25){
      const ar=(idle-25)/175; const rad=30+ar*90;
      const ag=ctx.createRadialGradient(_opMouseX,_opMouseY,0,_opMouseX,_opMouseY,rad);
      ag.addColorStop(0,`rgba(255,200,60,${.16*ar})`);
      ag.addColorStop(1,'rgba(255,200,60,0)');
      ctx.fillStyle=ag; ctx.fillRect(_opMouseX-rad,_opMouseY-rad,rad*2,rad*2);
      ctx.strokeStyle=`rgba(255,210,90,${.25*ar})`; ctx.lineWidth=.8;
      ctx.beginPath(); ctx.arc(_opMouseX,_opMouseY,rad*.6,0,Math.PI*2); ctx.stroke();
    }

    // ── DECIFRANDO no rodapé ──
    deciTimer++;
    if(deciTimer%20===0) deciText=Array.from({length:9},()=>RUNES[Math.floor(rnd()*RUNES.length)]).join(' ');
    ctx.font='bold 13px Georgia,serif'; ctx.fillStyle='rgba(255,175,25,.4)';
    ctx.textAlign='center'; ctx.fillText(deciText,W/2,H*.94); ctx.textAlign='left';

    _opAnimId=requestAnimationFrame(draw);
  }
  draw();
}

/* ══ ENERGIA — caos plasmático: transformação, raios, sobrecarga ══ */
function _animEnergia(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const EC=[[180,50,255],[0,220,255],[30,220,140],[255,80,200],[120,100,255],[0,200,220]];
  const lerpC=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];

  // ── AURORA boreal (nunca se repete) ──
  const auroraB=Array.from({length:7},(_,i)=>({
    y:H*(.05+i*.13), amp:20+Math.random()*45,
    freq:.003+Math.random()*.005, freq2:.0015+Math.random()*.003,
    spd:.0006+Math.random()*.001, ph:Math.random()*Math.PI*2, ph2:Math.random()*Math.PI*2,
    col:EC[i%EC.length], a:.1+Math.random()*.14, ht:40+Math.random()*60
  }));

  // ── REDE elétrica com pulsos viajando nas linhas ──
  const netPts=Array.from({length:52},()=>({
    x:Math.random()*W, y:Math.random()*H,
    vx:(Math.random()-.5)*1.5, vy:(Math.random()-.5)*1.5,
    col:EC[Math.floor(Math.random()*EC.length)], pulse:Math.random()*Math.PI*2
  }));
  const netPulses=[]; let netPulseTmr=0;

  // ── PLASMA: ciclo sólido→líquido→gasoso ──
  const plasmaPts=Array.from({length:30},()=>({
    ang:Math.random()*Math.PI*2, r:55+Math.random()*35,
    spd:.015+Math.random()*.045, ph:Math.random()*Math.PI*2
  }));
  let plasmaPhase=0;               // 0=sólido,1=líquido,2=gasoso (contínuo)
  let plasmaColK=0;                // interpolação de cor
  const plasmaBurst=[];            // partículas de explosão
  let plasmaBurstTmr=0;

  // ── BOLA DE PLASMA com tentáculos + descargas internas ──
  const ball={x:W*.15,y:H*.85,r:18};
  const tentacles=Array.from({length:10},(_,i)=>({
    ang:(i/10)*Math.PI*2, len:50+Math.random()*70,
    spd:.022+Math.random()*.038, ph:Math.random()*Math.PI*2, col:EC[i%EC.length]
  }));

  // ── RAIOS DE TESLA fractais ──
  const teslaSegs=[]; let teslaTmr=0, teslaFlash=0;
  function makeTesla(){
    teslaSegs.length=0;
    const cx=Math.random()*W, cy=Math.random()*H;
    function branch(x1,y1,x2,y2,dep,a){
      if(dep<=0||a<.05)return;
      const mx=(x1+x2)/2+(Math.random()-.5)*55/dep;
      const my=(y1+y2)/2+(Math.random()-.5)*55/dep;
      teslaSegs.push({x1,y1,x2:mx,y2:my,a,col:EC[Math.floor(Math.random()*EC.length)]});
      teslaSegs.push({x1:mx,y1:my,x2,y2,a,col:EC[Math.floor(Math.random()*EC.length)]});
      if(dep>1&&Math.random()>.4){
        const bx=mx+(Math.random()-.5)*80,by=my+(Math.random()-.5)*80;
        branch(mx,my,bx,by,dep-1,a*.55);
      }
    }
    for(let i=0;i<8;i++){
      const ang=(i/8)*Math.PI*2+Math.random()*.4;
      branch(cx,cy,cx+Math.cos(ang)*(100+Math.random()*140),cy+Math.sin(ang)*(100+Math.random()*140),4,.9);
    }
    teslaFlash=22;
  }

  // ── TEMPESTADE de raios + ondas de choque no impacto ──
  const bolts=[]; const shocks=[]; let boltTmr=0;
  function makeBolt(){
    const x=Math.random()*W; const pts=[{x,y:0}]; let cx=x,cy=0;
    while(cy<H){cx+=(Math.random()-.5)*32;cy+=16+Math.random()*26;pts.push({x:cx,y:cy});}
    return{pts,a:.7+Math.random()*.3,life:1,col:EC[Math.floor(Math.random()*EC.length)],hit:false};
  }

  // ── MOUSE: partículas que atraem E repelem ──
  const mousePts=Array.from({length:38},()=>({
    x:Math.random()*W,y:Math.random()*H,vx:0,vy:0,r:1.5+Math.random()*2.5,
    col:EC[Math.floor(Math.random()*EC.length)], mode:Math.random()>.5?1:-1
  }));

  // ── SOBRECARGA / inversão de cor ocasional ──
  let overloadTmr=0, overload=0, invert=0, invertTmr=0;

  let t=0;

  // ── SÍMBOLO OFICIAL DA ENERGIA ("V" — Símbolos Ocultistas) ──
  function drawSimbolo(cx,cy,a,rgb){
    const[r,g,b]=rgb;
    ctx.save(); ctx.translate(cx,cy);
    ctx.shadowColor=`rgba(${r},${g},${b},.6)`; ctx.shadowBlur=18;
    ctx.lineCap='round'; ctx.lineJoin='round';
    // "V" externo
    ctx.beginPath();
    ctx.moveTo(-64,-70); ctx.lineTo(0,72); ctx.lineTo(64,-70);
    ctx.strokeStyle=`rgba(${r},${g},${b},${a})`; ctx.lineWidth=4.5; ctx.stroke();
    // "V" interno (nested)
    ctx.beginPath();
    ctx.moveTo(-38,-58); ctx.lineTo(0,36); ctx.lineTo(38,-58);
    ctx.strokeStyle=`rgba(${r},${g},${b},${a*.65})`; ctx.lineWidth=2.6; ctx.stroke();
    // faísca no vértice
    ctx.beginPath(); ctx.arc(0,72,5,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,255,255,${a})`; ctx.fill();
    ctx.restore();
  }

  function draw(){
    if(_opAnimStop)return;
    ctx.clearRect(0,0,W,H);
    t+=.018;

    // SOBRECARGA: tudo super-saturado por instantes
    overloadTmr++;
    if(overload<=0&&overloadTmr>360+Math.random()*400){overloadTmr=0;overload=1;}
    if(overload>0)overload-=.015;
    // INVERSÃO de cores ocasional
    invertTmr++;
    if(invert<=0&&invertTmr>500+Math.random()*600){invertTmr=0;invert=1;}
    if(invert>0)invert-=.06;
    const ovl=Math.max(0,overload);

    // ── AURORA (dupla frequência = nunca repete) ──
    auroraB.forEach(b=>{
      b.ph+=b.spd; b.ph2+=b.spd*1.7;
      ctx.save(); ctx.globalCompositeOperation='screen';
      ctx.beginPath();
      for(let x=0;x<=W;x+=3){
        const y=b.y+Math.sin(x*b.freq+b.ph)*b.amp+Math.sin(x*b.freq2+b.ph2)*b.amp*.5;
        x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      const[r,g,bl]=b.col;
      ctx.lineWidth=b.ht; ctx.strokeStyle=`rgba(${r},${g},${bl},${b.a*(1+ovl)})`; ctx.lineCap='round'; ctx.stroke();
      ctx.restore();
    });

    // ── REDE ELÉTRICA ──
    netPts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;p.pulse+=.06;});
    const links=[];
    for(let i=0;i<netPts.length;i++) for(let j=i+1;j<netPts.length;j++){
      const dx=netPts[i].x-netPts[j].x,dy=netPts[i].y-netPts[j].y,d=Math.sqrt(dx*dx+dy*dy);
      if(d<100){
        links.push([i,j]);
        const[r,g,b]=netPts[i].col; const pulse=.5+Math.sin(netPts[i].pulse)*.5;
        ctx.beginPath();ctx.moveTo(netPts[i].x,netPts[i].y);ctx.lineTo(netPts[j].x,netPts[j].y);
        ctx.strokeStyle=`rgba(${r},${g},${b},${(1-d/100)*.28*pulse*(1+ovl)})`;ctx.lineWidth=.8;ctx.stroke();
      }
    }
    // pulsos percorrendo links
    netPulseTmr++;
    if(netPulseTmr>8&&links.length){netPulseTmr=0;const l=links[Math.floor(Math.random()*links.length)];netPulses.push({a:l[0],b:l[1],t:0,spd:.04+Math.random()*.05,col:netPts[l[0]].col});}
    for(let i=netPulses.length-1;i>=0;i--){
      const np=netPulses[i]; np.t+=np.spd; if(np.t>=1){netPulses.splice(i,1);continue;}
      const A=netPts[np.a],B=netPts[np.b];
      const px=A.x+(B.x-A.x)*np.t, py=A.y+(B.y-A.y)*np.t;
      const[r,g,b]=np.col;
      ctx.save(); ctx.shadowColor=`rgba(${r},${g},${b},.9)`; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(px,py,2,0,Math.PI*2); ctx.fillStyle=`rgba(${r},${g},${b},.95)`; ctx.fill(); ctx.restore();
    }
    netPts.forEach(p=>{
      const[r,g,b]=p.col; const pulse=.5+Math.sin(p.pulse)*.5;
      ctx.save(); ctx.shadowColor=`rgba(${r},${g},${b},.6)`; ctx.shadowBlur=6;
      ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2);
      ctx.fillStyle=`rgba(${r},${g},${b},${.35*pulse*(1+ovl)})`; ctx.fill(); ctx.restore();
    });

    // ── PLASMA: transição sólido/líquido/gasoso ──
    plasmaPhase+=.004; const ph3=plasmaPhase%3; // 0..3
    plasmaColK+=.008; const ci=Math.floor(plasmaColK)%EC.length;
    const col=lerpC(EC[ci],EC[(ci+1)%EC.length],plasmaColK%1);
    const[pr,pg,pb]=col.map(v=>Math.round(v));
    // morphAmount: sólido=baixo, líquido=médio, gasoso=alto+disperso
    const morph = ph3<1 ? 0.3+ph3*.5 : ph3<2 ? 0.8+(ph3-1)*.6 : 1.4-(ph3-2)*1.1;
    ctx.save(); ctx.shadowBlur=18; ctx.shadowColor=`rgba(${pr},${pg},${pb},.5)`;
    ctx.beginPath();
    plasmaPts.forEach((p,i)=>{
      p.ph+=p.spd;
      const r=p.r+Math.sin(p.ph)*28*morph+Math.cos(p.ph*1.3)*16*morph;
      const x=W*.5+Math.cos(p.ang)*r, y=H*.5+Math.sin(p.ang)*r*.75;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.closePath();
    ctx.fillStyle=`rgba(${pr},${pg},${pb},${.18*(1-Math.min(1,(ph3>2?ph3-2:0)))+.05})`; ctx.fill();
    ctx.strokeStyle=`rgba(${pr},${pg},${pb},${.45+ovl*.4})`; ctx.lineWidth=1.5+ovl; ctx.stroke();
    ctx.restore();
    // explosão de partículas no estado gasoso
    plasmaBurstTmr++;
    if(ph3>2.4&&plasmaBurstTmr>4){plasmaBurstTmr=0;
      for(let k=0;k<3;k++){const a=Math.random()*Math.PI*2,sp=1+Math.random()*3;
        plasmaBurst.push({x:W*.5,y:H*.5,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,a:.7,col:[pr,pg,pb]});}
    }
    for(let i=plasmaBurst.length-1;i>=0;i--){
      const b=plasmaBurst[i]; b.x+=b.vx;b.y+=b.vy;b.a-=.02;
      if(b.a<=0){plasmaBurst.splice(i,1);continue;}
      ctx.beginPath();ctx.arc(b.x,b.y,1.5,0,Math.PI*2);
      ctx.fillStyle=`rgba(${b.col[0]},${b.col[1]},${b.col[2]},${b.a})`;ctx.fill();
    }

    // ── BOLA DE PLASMA + tentáculos + descarga interna ──
    const bpulse=.8+Math.sin(t*2.5)*.2;
    const[br,bg,bb]=col.map(v=>Math.round(v));
    ctx.save(); ctx.shadowColor=`rgba(${br},${bg},${bb},.7)`; ctx.shadowBlur=20;
    const bg2=ctx.createRadialGradient(ball.x,ball.y,0,ball.x,ball.y,ball.r*bpulse);
    bg2.addColorStop(0,`rgba(255,255,255,.6)`);
    bg2.addColorStop(.5,`rgba(${br},${bg},${bb},.5)`);
    bg2.addColorStop(1,`rgba(${br},${bg},${bb},.1)`);
    ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r*bpulse,0,Math.PI*2);
    ctx.fillStyle=bg2;ctx.fill();
    ctx.strokeStyle=`rgba(${br},${bg},${bb},.8)`;ctx.lineWidth=1.5;ctx.stroke();
    ctx.restore();
    const tips=[];
    tentacles.forEach(ten=>{
      ten.ph+=ten.spd;
      const ex=ball.x+Math.cos(ten.ang+Math.sin(ten.ph)*.85)*ten.len;
      const ey=ball.y+Math.sin(ten.ang+Math.cos(ten.ph)*.85)*ten.len;
      tips.push({x:ex,y:ey,col:ten.col});
      const[r,g,b]=ten.col;
      ctx.save(); ctx.shadowColor=`rgba(${r},${g},${b},.5)`; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.moveTo(ball.x,ball.y);
      const cx2=ball.x+(ex-ball.x)*.35+(Math.random()-.5)*22;
      const cy2=ball.y+(ey-ball.y)*.35+(Math.random()-.5)*22;
      ctx.quadraticCurveTo(cx2,cy2,ex,ey);
      ctx.strokeStyle=`rgba(${r},${g},${b},.55)`;ctx.lineWidth=1.2;ctx.stroke();
      ctx.beginPath();ctx.arc(ex,ey,3,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},.7)`;ctx.fill();
      ctx.restore();
    });
    // descarga ocasional entre pontas de tentáculos
    if(Math.random()>.85){
      const a=tips[Math.floor(Math.random()*tips.length)],b=tips[Math.floor(Math.random()*tips.length)];
      if(a&&b&&a!==b){
        ctx.save(); ctx.shadowColor=`rgba(${a.col[0]},${a.col[1]},${a.col[2]},.8)`; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.moveTo(a.x,a.y);
        const steps=4; for(let s=1;s<=steps;s++){const k=s/steps;ctx.lineTo(a.x+(b.x-a.x)*k+(Math.random()-.5)*14,a.y+(b.y-a.y)*k+(Math.random()-.5)*14);}
        ctx.strokeStyle=`rgba(${a.col[0]},${a.col[1]},${a.col[2]},.7)`; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
      }
    }

    // ── RAIOS DE TESLA ──
    teslaTmr++;
    if(teslaFlash>0){
      teslaFlash--;
      ctx.save(); ctx.shadowBlur=12;
      teslaSegs.forEach(s=>{
        const[r,g,b]=s.col; const frac=teslaFlash/22;
        ctx.shadowColor=`rgba(${r},${g},${b},.6)`;
        ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);
        ctx.strokeStyle=`rgba(${r},${g},${b},${s.a*frac})`;ctx.lineWidth=1;ctx.stroke();
      });
      ctx.restore();
    }
    if(teslaTmr>(overload>0?25:60)+Math.random()*90){teslaTmr=0;makeTesla();}

    // ── TEMPESTADE de raios + ondas de choque ──
    boltTmr++;
    if(boltTmr>(overload>0?40:100)+Math.random()*150){boltTmr=0;bolts.push(makeBolt());}
    for(let i=bolts.length-1;i>=0;i--){
      const blt=bolts[i]; blt.life-=.05;
      if(!blt.hit&&blt.life<.55){blt.hit=true;const last=blt.pts[blt.pts.length-1];shocks.push({x:last.x,y:H,r:0,a:.5,col:blt.col});}
      if(blt.life<=0){bolts.splice(i,1);continue;}
      const[r,g,b]=blt.col;
      ctx.save(); ctx.shadowColor=`rgba(${r},${g},${b},.7)`; ctx.shadowBlur=15;
      ctx.beginPath(); ctx.moveTo(blt.pts[0].x,blt.pts[0].y);
      blt.pts.forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.strokeStyle=`rgba(${r},${g},${b},${blt.a*blt.life})`;ctx.lineWidth=1.5;ctx.stroke();
      if(blt.life>.7){
        const fl=ctx.createRadialGradient(blt.pts[0].x,0,0,blt.pts[0].x,0,150);
        fl.addColorStop(0,`rgba(${r},${g},${b},.12)`);fl.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=fl;ctx.fillRect(0,0,W,H);
      }
      ctx.restore();
    }
    for(let i=shocks.length-1;i>=0;i--){
      const sh=shocks[i]; sh.r+=4; sh.a-=.02;
      if(sh.a<=0){shocks.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(sh.x,sh.y,sh.r,Math.PI,Math.PI*2);
      ctx.strokeStyle=`rgba(${sh.col[0]},${sh.col[1]},${sh.col[2]},${sh.a})`; ctx.lineWidth=1.5; ctx.stroke();
    }

    // ── MOUSE: atração e repulsão ──
    mousePts.forEach(p=>{
      const dx=_opMouseX-p.x, dy=_opMouseY-p.y, d=Math.hypot(dx,dy)||1;
      if(d<220){const f=p.mode*(1-d/220)*.6; p.vx+=(dx/d)*f; p.vy+=(dy/d)*f;}
      p.vx*=.94; p.vy*=.94; p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1;
      p.x=Math.max(0,Math.min(W,p.x)); p.y=Math.max(0,Math.min(H,p.y));
      const[r,g,b]=p.col;
      ctx.save(); ctx.shadowColor=`rgba(${r},${g},${b},.6)`; ctx.shadowBlur=7;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(${r},${g},${b},${.6+ovl*.3})`;ctx.fill(); ctx.restore();
    });

    // ── SÍMBOLO DA ENERGIA ("V" central, na cor do plasma) ──
    drawSimbolo(W*.5,H*.5,0.18+ovl*0.25,[br,bg,bb]);

    // ── INVERSÃO de cor (flash de difference) ──
    if(invert>0){
      ctx.save(); ctx.globalCompositeOperation='difference';
      ctx.fillStyle=`rgba(255,255,255,${invert*.6})`; ctx.fillRect(0,0,W,H);
      ctx.restore();
    }

    _opAnimId=requestAnimationFrame(draw);
  }
  draw();
}

/* ══ MEDO — desconhecido infinito: olhos, névoa, anomalias ══ */
function _animMedo(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // ── OLHOS: piscam, mentem sobre onde olham, somem parcialmente ──
  const eyes=Array.from({length:7},()=>({
    x:80+Math.random()*(W-160), y:80+Math.random()*(H-160),
    life:Math.random(), spd:.0015+Math.random()*.0025, sz:20+Math.random()*35,
    blink:0, blinkTmr:Math.random()*200, lie:Math.random()>.5,
    lx:(Math.random()-.5), ly:(Math.random()-.5), partial:Math.random()>.6
  }));

  // ── FIGURA sombria errante (às vezes mais perto que deveria) ──
  const fig={x:0,y:0,ph:0,showing:false,tmr:0,scale:1};

  // ── TEXTO subliminar (inclui idiomas impossíveis) ──
  const SUBS=['você viu?','não olhe','está aqui','cuidado','ele está','3:00 am','não durma','ouça','atrás de você','sai','não me vê?','sinto você','corra','ⵔⵎⵏ','ᚷᛁᛒ','你看见了','مكان'];
  let subTmr=0,subShow=false,subText='',subAlpha=0,subFrames=0;

  // ── NÉVOA densa que respira ──
  const fog=Array.from({length:26},()=>({
    x:Math.random()*W, y:Math.random()*H,
    r:90+Math.random()*160, vx:(Math.random()-.5)*.18, vy:(Math.random()-.5)*.13,
    a:.07+Math.random()*.12, breathe:Math.random()*Math.PI*2
  }));

  // ── ESTÁTICA de TV ──
  let staticA=0,staticTmr=0;

  // ── SOMBRAS independentes (algumas ficam presas e tremem) ──
  const shadows=Array.from({length:6},()=>({
    x:Math.random()*W, y:Math.random()*H,
    vx:(Math.random()-.5)*.28, vy:(Math.random()-.5)*.22,
    sz:30+Math.random()*60, a:.22+Math.random()*.3, wb:Math.random()*Math.PI*2,
    stuck:0, stuckTmr:Math.random()*400
  }));

  // ── GLITCH VHS com aberração cromática ──
  let glitchTmr=0,glitchOn=false,glitchLines=[],chroma=0;

  // ── BLACKOUT (com frame congelado) ──
  let blackTmr=0,blackA=0;

  // ── ARRANHÕES (alguns sangram luz) ──
  const scratches=[]; let scratchTmr=0;

  // ── VINHETA pulsante (cores enfermiças) ──
  let vigPh=0;

  // ── REFLEXO ERRADO fora de sincronia ──
  const wrongSh={
    x:W*.4,y:H*.4,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.18,
    pts:Array.from({length:16},()=>({r:22+Math.random()*35})), wb:0,
    headPh:0
  };

  // ── ESPAÇO DISTORCIDO (deslocamento sutil de coordenadas) ──
  let warpX=0, warpY=0;

  let t=0;

  function drawEye(x,y,s,a,e){
    if(a<.01)return;
    const open=1-e.blink;          // 1 aberto, 0 fechado
    ctx.save(); ctx.shadowColor='rgba(200,200,230,.4)'; ctx.shadowBlur=10;
    // olheiras profundas (sombra sob o olho)
    const ug=ctx.createRadialGradient(x,y+s*.3,0,x,y+s*.3,s*1.3);
    ug.addColorStop(0,`rgba(0,0,5,${a*.4})`); ug.addColorStop(1,'rgba(0,0,5,0)');
    ctx.fillStyle=ug; ctx.fillRect(x-s*1.3,y-s*.8,s*2.6,s*2.2);
    // branco do olho (achata ao piscar)
    ctx.beginPath();
    ctx.moveTo(x-s,y);
    ctx.quadraticCurveTo(x,y-s*.55*open,x+s,y);
    ctx.quadraticCurveTo(x,y+s*.55*open,x-s,y);
    ctx.fillStyle=`rgba(200,200,225,${a*.55})`; ctx.fill();
    ctx.strokeStyle=`rgba(170,170,200,${a*1.2})`; ctx.lineWidth=.8; ctx.stroke();
    if(open>.3){
      // íris
      ctx.beginPath(); ctx.arc(x,y,s*.35*open,0,Math.PI*2);
      ctx.fillStyle=`rgba(130,130,165,${a*.8})`; ctx.fill();
      // pupila: olha pro cursor, ou MENTE e olha pra outro lado
      let tx,ty;
      if(e.lie){tx=x+e.lx*s*.4;ty=y+e.ly*s*.4;}
      else{const dx=_opMouseX-x,dy=_opMouseY-y,dl=Math.hypot(dx,dy)||1;tx=x+(dx/dl)*s*.18;ty=y+(dy/dl)*s*.18;}
      ctx.beginPath(); ctx.arc(tx,ty,s*.15*open,0,Math.PI*2);
      ctx.fillStyle=`rgba(2,2,8,${a*1.2})`; ctx.fill();
      ctx.beginPath(); ctx.arc(tx-s*.06,ty-s*.06,s*.05,0,Math.PI*2);
      ctx.fillStyle=`rgba(230,230,255,${a*.7})`; ctx.fill();
    }
    ctx.restore();
  }

  // ── A MARCA DO MEDO (símbolo oficial: gancho vertical + traço horizontal cruzando) ──
  function drawSimbolo(cx,cy,a){
    ctx.save(); ctx.translate(cx,cy);
    ctx.shadowColor='rgba(240,242,252,.55)'; ctx.shadowBlur=14;
    ctx.strokeStyle=`rgba(242,244,253,${a})`; ctx.lineWidth=3; ctx.lineCap='round';
    // traço vertical que se curva subindo até o gancho
    ctx.beginPath();
    ctx.moveTo(6,84);
    ctx.bezierCurveTo(-10,42, 10,-2, 0,-30);
    ctx.stroke();
    // formato circular no topo (gancho ~270°)
    ctx.beginPath();
    ctx.arc(-15,-32,15,-0.25,Math.PI*1.42,false);
    ctx.stroke();
    // círculo menor na ponta do gancho
    const tx=-15+15*Math.cos(Math.PI*1.42), ty=-32+15*Math.sin(Math.PI*1.42);
    ctx.beginPath(); ctx.arc(tx,ty,5,0,Math.PI*2); ctx.stroke();
    // traço horizontal curvado cruzando o vertical em dois pontos
    ctx.beginPath();
    ctx.moveTo(-54,16);
    ctx.bezierCurveTo(-14,48, 14,2, 54,32);
    ctx.stroke();
    // pequeno círculo no meio
    ctx.beginPath(); ctx.arc(0,26,5,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  function draw(){
    if(_opAnimStop)return;
    ctx.clearRect(0,0,W,H);
    t+=.007;

    // espaço distorcido: deslocamento lento e errático
    warpX=Math.sin(t*.7)*4+Math.sin(t*1.9)*2;
    warpY=Math.cos(t*.5)*4+Math.cos(t*1.3)*2;

    // ── VINHETA PULSANTE com tom enfermiço ──
    vigPh+=.005;
    const vA=.38+Math.sin(vigPh*.5)*.15;
    const sick=Math.max(0,Math.sin(vigPh*.18)); // verde-doente ocasional
    const vg=ctx.createRadialGradient(W/2,H/2,H*.12,W/2,H/2,H*.88);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(.55,`rgba(${4*sick|0},${10*sick|0},${4*sick|0},${vA*.3})`);
    vg.addColorStop(1,`rgba(0,0,0,${vA})`);
    ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);

    // ── SOMBRAS independentes (presas tremem) ──
    shadows.forEach(s=>{
      s.wb+=.01; s.stuckTmr--;
      if(s.stuckTmr<=0){s.stuck=s.stuck>0?0:40+Math.random()*60;s.stuckTmr=300+Math.random()*400;}
      if(s.stuck>0){ // presa: treme tentando sair
        s.stuck--; s.x+=(Math.random()-.5)*2; s.y+=(Math.random()-.5)*2;
      }else{
        s.x+=s.vx; s.y+=s.vy;
        if(s.x<0||s.x>W)s.vx*=-1; if(s.y<0||s.y>H)s.vy*=-1;
      }
      ctx.save(); ctx.translate(s.x+warpX,s.y+warpY); ctx.rotate(s.wb*.12);
      ctx.beginPath();
      for(let a=0;a<Math.PI*2;a+=.25){
        const r=s.sz*(.5+Math.sin(a*2.8+s.wb)*.5);
        a<.1?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
      }
      ctx.closePath(); ctx.fillStyle=`rgba(0,0,4,${s.a})`; ctx.fill();
      ctx.restore();
    });

    // ── REFLEXO ERRADO (silhueta humanóide fora de sincronia) ──
    wrongSh.x+=wrongSh.vx; wrongSh.y+=wrongSh.vy; wrongSh.headPh+=.02;
    if(wrongSh.x<80||wrongSh.x>W-80)wrongSh.vx*=-1;
    if(wrongSh.y<80||wrongSh.y>H-80)wrongSh.vy*=-1;
    wrongSh.wb+=.009;
    ctx.save(); ctx.translate(wrongSh.x,wrongSh.y);
    // corpo amorfo
    ctx.beginPath();
    wrongSh.pts.forEach((p,i)=>{
      const a=(i/wrongSh.pts.length)*Math.PI*2;
      const r=p.r+Math.sin(wrongSh.wb+i*.8)*10;
      i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r*1.3):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r*1.3);
    });
    ctx.closePath(); ctx.fillStyle='rgba(0,0,6,.25)'; ctx.fill();
    // "cabeça" que pulsa — sugere humanoide
    ctx.beginPath(); ctx.arc(0,-40,14+Math.sin(wrongSh.headPh)*2,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,8,.28)'; ctx.fill();
    ctx.restore();

    // ── NÉVOA que respira ──
    fog.forEach(f=>{
      f.breathe+=.012;
      const br=f.r*(1+Math.sin(f.breathe)*.12);
      f.x+=f.vx; f.y+=f.vy;
      if(f.x<-f.r)f.x=W+f.r; if(f.x>W+f.r)f.x=-f.r;
      if(f.y<-f.r)f.y=H+f.r; if(f.y>H+f.r)f.y=-f.r;
      const fg=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,br);
      fg.addColorStop(0,`rgba(215,215,235,${f.a})`);
      fg.addColorStop(.6,`rgba(215,215,235,${f.a*.4})`);
      fg.addColorStop(1,'rgba(215,215,235,0)');
      ctx.fillStyle=fg; ctx.fillRect(f.x-br,f.y-br,br*2,br*2);
    });

    // ── A MARCA DO MEDO (símbolo central, pulsa com a vinheta) ──
    drawSimbolo(W*.5+warpX,H*.5+warpY,0.13+Math.sin(vigPh*.5)*0.05);

    // ── OLHOS: aparecem, piscam, somem parcialmente ──
    eyes.forEach(e=>{
      e.life+=e.spd;
      e.blinkTmr--; if(e.blinkTmr<=0){e.blink=1;e.blinkTmr=120+Math.random()*220;}
      if(e.blink>0)e.blink=Math.max(0,e.blink-.12);
      if(e.life>=1){e.life=0;e.x=80+Math.random()*(W-160);e.y=80+Math.random()*(H-160);e.sz=20+Math.random()*35;e.lie=Math.random()>.5;e.lx=(Math.random()-.5);e.ly=(Math.random()-.5);e.partial=Math.random()>.6;}
      let a=Math.sin(e.life*Math.PI)*.45;
      if(e.partial)a*=.55; // alguns só aparecem parcialmente
      drawEye(e.x+warpX,e.y+warpY,e.sz,a,e);
    });

    // ── FIGURA SOMBRIA (ocasionalmente bem maior/perto) ──
    fig.tmr++;
    if(!fig.showing&&fig.tmr>280+Math.random()*400){
      fig.showing=true; fig.tmr=0; fig.ph=0;
      const corners=[[35,H*.92],[W-35,H*.92],[35,H*.08],[W-35,H*.08],[W*.5,H*.96]];
      const c=corners[Math.floor(Math.random()*corners.length)];
      fig.x=c[0]; fig.y=c[1];
      fig.scale=Math.random()>.7?2.4:1; // às vezes assustadoramente grande
    }
    if(fig.showing){
      fig.ph+=.015;
      const fa=Math.sin(fig.ph*Math.PI/3)*.5;
      if(fig.ph>3){fig.showing=false;fig.tmr=0;}
      if(fa>.01){
        const sc=fig.scale*(1+Math.sin(fig.ph*.8)*.06);
        ctx.save(); ctx.translate(fig.x,fig.y); ctx.scale(sc,sc);
        ctx.fillStyle=`rgba(0,0,4,${fa})`;
        ctx.beginPath(); ctx.arc(0,-42,12,0,Math.PI*2); ctx.fill();
        ctx.fillRect(-9,-30,18,38);
        ctx.strokeStyle=`rgba(0,0,4,${fa})`; ctx.lineWidth=5; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(-9,-25); ctx.lineTo(-26,-8);
        ctx.moveTo(9,-25); ctx.lineTo(26,-8);
        ctx.moveTo(-5,8); ctx.lineTo(-8,35);
        ctx.moveTo(5,8); ctx.lineTo(8,35);
        ctx.stroke(); ctx.restore();
      }
    }

    // ── ESTÁTICA de TV ──
    staticTmr++;
    if(staticA>0){
      staticA-=.014;
      for(let i=0;i<600;i++){
        const sx=Math.random()*W, sy=Math.random()*H, ssz=2+Math.random()*5;
        const v=Math.random()>.5?230:0;
        ctx.fillStyle=`rgba(${v},${v},${Math.min(v+20,255)},${staticA*(.4+Math.random()*.6)})`;
        ctx.fillRect(sx,sy,ssz,ssz);
      }
    }
    if(staticTmr>350+Math.random()*200){staticTmr=0;staticA=.35+Math.random()*.3;}

    // ── TEXTO SUBLIMINAR (com aberração cromática própria) ──
    subTmr++;
    if(!subShow&&subTmr>220+Math.random()*300){
      subShow=true; subTmr=0; subFrames=0;
      subText=SUBS[Math.floor(Math.random()*SUBS.length)]; subAlpha=.8;
    }
    if(subShow){
      subFrames++; if(subFrames>3){subShow=false;subAlpha=0;}
      const sx=W/2+(Math.random()-.5)*60, sy=H/2+(Math.random()-.5)*60;
      ctx.font='bold 15px "Courier New",monospace'; ctx.textAlign='center';
      ctx.fillStyle=`rgba(255,40,40,${subAlpha*.5})`; ctx.fillText(subText,sx-2,sy);
      ctx.fillStyle=`rgba(40,255,255,${subAlpha*.5})`; ctx.fillText(subText,sx+2,sy);
      ctx.fillStyle=`rgba(220,220,240,${subAlpha})`; ctx.fillText(subText,sx,sy);
      ctx.textAlign='left';
    }

    // ── GLITCH VHS + aberração cromática ──
    glitchTmr++;
    if(glitchOn){
      glitchLines.forEach(l=>{
        ctx.save(); ctx.translate(l.off,0);
        ctx.fillStyle=`rgba(210,210,230,${l.a})`; ctx.fillRect(0,l.y,W,l.h);
        // separação RGB nas linhas
        ctx.fillStyle=`rgba(255,0,80,${l.a*.5})`; ctx.fillRect(-3,l.y,W,l.h*.5);
        ctx.fillStyle=`rgba(0,200,255,${l.a*.5})`; ctx.fillRect(3,l.y+l.h*.5,W,l.h*.5);
        ctx.restore();
      });
      if(glitchTmr>8){glitchOn=false;glitchLines=[];chroma=0;}
    }
    if(!glitchOn&&glitchTmr>150+Math.random()*220){
      glitchTmr=0; glitchOn=true; chroma=1;
      glitchLines=Array.from({length:4+Math.floor(Math.random()*6)},()=>({
        y:Math.random()*H, h:2+Math.random()*6, off:(Math.random()-.5)*30, a:.2+Math.random()*.35
      }));
    }

    // ── ARRANHÕES (alguns sangram luz) ──
    scratchTmr++;
    if(scratchTmr>40&&Math.random()>.6){
      scratchTmr=0;
      scratches.push({x:Math.random()*W,y1:Math.random()*H,y2:Math.random()*H,a:.5+Math.random()*.4,life:1,glow:Math.random()>.6});
    }
    for(let i=scratches.length-1;i>=0;i--){
      const s=scratches[i]; s.life-=.022; s.a*=.96;
      if(s.life<=0){scratches.splice(i,1);continue;}
      ctx.save();
      if(s.glow){ctx.shadowColor='rgba(255,255,255,.9)';ctx.shadowBlur=6;}
      ctx.beginPath();
      ctx.moveTo(s.x+(Math.random()-.5)*3,Math.min(s.y1,s.y2));
      for(let y=Math.min(s.y1,s.y2);y<Math.max(s.y1,s.y2);y+=5)
        ctx.lineTo(s.x+(Math.random()-.5)*4,y);
      ctx.strokeStyle=s.glow?`rgba(255,255,255,${s.a})`:`rgba(210,210,235,${s.a})`;
      ctx.lineWidth=.8; ctx.stroke(); ctx.restore();
    }

    // ── BLACKOUT TOTAL (sensação de perder tempo) ──
    if(blackA>0){blackA-=.08;ctx.fillStyle=`rgba(0,0,0,${blackA})`;ctx.fillRect(0,0,W,H);}
    blackTmr++;
    if(blackTmr>550+Math.random()*900){blackTmr=0;blackA=.97;}

    _opAnimId=requestAnimationFrame(draw);
  }
  draw();
}

/* ─────────────────────────────────────── */

function _aplicarOpOrdem(id) {
  const o = _OP_ORDENS.find(x => x.id === id);
  const html = document.documentElement;
  _OP_ORDENS.forEach(x => html.classList.remove(x.extra));
  _pararCanvasOP();
  if (!o) {
    html.removeAttribute('data-op-ordem');
    html.removeAttribute('data-op-locked');
    _opAtiva = null;
    localStorage.removeItem('dsos_op_ordem');
    _aplicarAccentCss(_cfg.accent);
    notif('Ordem desativada. Voltou ao normal.');
    return;
  }
  html.setAttribute('data-op-ordem', o.id);
  html.setAttribute('data-op-locked', '1');
  html.classList.add(o.extra);
  _opAtiva = o.id;
  localStorage.setItem('dsos_op_ordem', o.id);
  _aplicarAccentCss(o.cor);
  _iniciarCanvasOP(o.id);
  notif(`${o.emoji} Ordem de ${o.nome} ativada!`);
}

// Reaplica ao carregar
if (_opAtiva) {
  const o = _OP_ORDENS.find(x => x.id === _opAtiva);
  if (o) {
    document.documentElement.setAttribute('data-op-ordem', o.id);
    document.documentElement.setAttribute('data-op-locked', '1');
    document.documentElement.classList.add(o.extra);
    _aplicarAccentCss(o.cor);
    window.addEventListener('DOMContentLoaded', () => _iniciarCanvasOP(o.id), {once:true});
  }
}

function _renderOpGrid() {
  const grid = document.getElementById('op-grid');
  if (!grid) return;
  grid.innerHTML = _OP_ORDENS.map(o => `
    <button class="op-card${_opAtiva===o.id?' op-card-ativa':''}" data-op="${o.id}"
      style="--op-cor:${o.cor};--op-glow:${o.glow}"
      onclick="selecionarOrdem('${o.id}')">
      <span class="op-emoji">${o.emoji}</span>
      <span class="op-nome">${o.nome}</span>
      <span class="op-desc">${o.desc}</span>
    </button>`).join('');
}

window.abrirModalOP = function() {
  _renderOpGrid();
  document.getElementById('modal-op')?.classList.add('open');
};
window.fecharModalOP = function() {
  document.getElementById('modal-op')?.classList.remove('open');
};
window.selecionarOrdem = function(id) {
  if (document.documentElement.dataset.hacker === '1') {
    notif('⚠ Desative o modo hacker antes de ativar uma Ordem.');
    return;
  }
  _aplicarOpOrdem(id === _opAtiva ? null : id);
  fecharModalOP();
};

// Trigger: digitar "ordem" com nenhum input focado
let _opSeq = '', _opSeqTimer = null;
document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  _opSeq += e.key.toLowerCase();
  clearTimeout(_opSeqTimer);
  _opSeqTimer = setTimeout(() => { _opSeq = ''; }, 2000);
  if (_opSeq.endsWith('ordem')) {
    _opSeq = '';
    abrirModalOP();
  }
});

/* DICAS DE ATALHO — barra de ação estática */
function _kbChip(key,label){
  return`<span style="display:inline-flex;align-items:center;gap:3px"><kbd style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:3px;padding:1px 5px;font-family:inherit;font-size:.55rem;font-weight:600">${key}</kbd><span style="color:var(--muted);font-size:.55rem">${label}</span></span>`;
}
function _atualizarKbDicas(){
  const el=document.getElementById('kb-dicas');if(!el)return;
  if(!_cfg.dicasAtalho){el.innerHTML='';return;}
  const t=selectedId?tickets.find(x=>x.id===selectedId):null;
  const chips=[_kbChip('↑↓','Navegar')];
  if(t?.status==='aberto') chips.push(_kbChip('P','Andamento'),_kbChip('R','Resolver'));
  else if(t?.status==='em_andamento') chips.push(_kbChip('R','Resolver'));
  if(t) chips.push(_kbChip('Enter','Detalhar'));
  el.innerHTML=chips.join('<span style="color:var(--glass-b);margin:0 2px">·</span>');
}

/* ATALHOS DE TECLADO */
(function(){
  function _abertosVisiveis(){
    let list=tickets.filter(t=>t.status==='aberto'||t.status==='em_andamento');
    if(_filtroChip.tipo)list=list.filter(t=>t.tipo===_filtroChip.tipo);
    if(_filtroChip.lab)list=list.filter(t=>t.laboratorio===_filtroChip.lab);
    return list;
  }

  function _navegar(idx){
    const visiveis=_abertosVisiveis();
    if(!visiveis[idx])return;
    selectedId=visiveis[idx].id;
    renderUnresp();
    document.querySelectorAll('#unresp-list .ticket-row')[idx]?.scrollIntoView({block:'nearest'});
  }

  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)return;
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    // .sc-overlay é o minigame Skill Check, que aparece em 30% das resoluções
    // e fica esperando a barra de espaço. Sem ele nesta lista, teclas como
    // R/P/setas continuavam agindo no chamado POR BAIXO do overlay — dava pra
    // marcar RESOLVIDO no ticket errado durante o minigame (BUG-06).
    if(document.querySelector('.modal-pc-bg.open,.modal-bg.open,.modal-desc-bg.open,.mini-modal-bg.open,.sc-overlay.open'))return;
    const abertos=_abertosVisiveis();
    if(!abertos.length)return;
    const selIdx=abertos.findIndex(t=>t.id===selectedId);
    if(e.key==='ArrowDown'){
      e.preventDefault();
      _navegar(selIdx===-1?0:Math.min(selIdx+1,abertos.length-1));
    }else if(e.key==='ArrowUp'){
      e.preventDefault();
      _navegar(selIdx<=0?0:selIdx-1);
    }else if(e.key==='Enter'&&selectedId){
      const t=tickets.find(x=>x.id===selectedId);if(t)abrirModal(t,false);
    }else if((e.key==='r'||e.key==='R')&&selectedId){
      const btn=document.getElementById('btn-resolvido');
      if(btn&&!btn.disabled)btn.click();
    }else if((e.key==='p'||e.key==='P')&&selectedId){
      const btn=document.getElementById('btn-progresso');
      if(btn&&!btn.disabled)btn.click();
    }
  });
})();

/* SAIR */
window.sair=async function(){
  try{
    const _t=sessionStorage.getItem('dsos_login_time');
    const _dur=_t?(()=>{const s=Math.floor((Date.now()-parseInt(_t))/1000);return`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`})():null;
    sessionStorage.removeItem('dsos_login_time');
    const _ua=navigator.userAgent;const _br=(_ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s]([\d.]+)/)||[])[1];const _os=/Windows/.test(_ua)?'Windows':/Mac/.test(_ua)?'macOS':/Linux/.test(_ua)?'Linux':/Android/.test(_ua)?'Android':/iPhone|iPad/.test(_ua)?'iOS':'?';
    await _logEvent('rpc_log_logout',{
      p_usuario_id:   session?.id,
      p_usuario_tipo: 'ti',
      p_usuario_login:session?.login,
      p_usuario_nome: session?.nome,
      p_ip_address:   `${_br||'?'} | ${_os} | ${screen.width}x${screen.height} | ${navigator.language||'N/A'} | ${Intl.DateTimeFormat().resolvedOptions().timeZone||'N/A'}`,
      ...(_dur?{p_duracao_sessao:_dur}:{}),
    });
  }catch(e){}
  // Marcar técnico como ausente ao sair
  try{await fetch(`${SB}/rest/v1/rpc/rpc_set_presenca`,{method:'POST',headers:H,body:JSON.stringify({p_id:session?.id,p_presenca:'ausente'})});}catch(_){}
  sessionStorage.removeItem('dsos_session');
  window.location.href='login.html';
};

/* EASTER EGGS — os 5 cliques na logo vivem em ./easter-egg.js (fonte única) */
initEasterEgg();

document.getElementById('unresp-search')?.addEventListener('input',function(){
  if(this.value.toLowerCase().trim()==='corinthians'){
    this.value='';
    notif('🖤🤍 VAI CORINTHIANS! Campeão do mundo 2000! 🏆');
    setTimeout(()=>{
      const card=document.querySelector('.card');
      if(card){card.style.transition='box-shadow .3s';card.style.boxShadow='0 0 0 3px #000, 0 0 0 6px #fff, 0 0 40px rgba(0,0,0,.8)';setTimeout(()=>{card.style.boxShadow='';},2000)}
    },500);
  }
});

let _kpiClicks=0,_kpiTimer=null;
document.getElementById('kpi-resolvidos')?.closest('.kpi')?.addEventListener('click',()=>{
  _kpiClicks++;clearTimeout(_kpiTimer);
  _kpiTimer=setTimeout(()=>{_kpiClicks=0},1200);
  if(_kpiClicks>=3){_kpiClicks=0;notif('💪 Bom trabalho! Continue assim, campeão.');}
});

const _konami=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a','Enter'];
let _konamiIdx=0;
document.addEventListener('keydown',e=>{
  if(e.key===_konami[_konamiIdx]){_konamiIdx++;if(_konamiIdx===_konami.length){_konamiIdx=0;_konamiMode();}}
  else _konamiIdx=0;
});
function _konamiMode(){
  notif('🖤🤍 MODO CORINTHIANS ATIVADO! Vai Timão! 🏆');
  const body=document.body;
  body.style.transition='filter .3s';
  body.style.filter='grayscale(1) contrast(1.2)';
  setTimeout(()=>{body.style.filter='';},3000);
}

/* ================================================================
   DBD SKILL CHECK — Dead by Daylight (fiel ao dbd.lucaservers.com)
   Canvas: raio=116px, u=7, l=4, success=50°, great=10°, cor #fff
   Agulha: CSS div rotacionado, radial-gradient, bottom:60%
   Velocidade: 750ms/rotação (original usa 1100ms)
   Trigger: 30% ao resolver como "consertado" | Shift+G→K sempre
   3 checks consecutivos; falha = gen explosion + reset
   ================================================================ */
(function(){
  /* Valores extraídos do dbd.lucaservers.com/js/app.*.js:
     canvas 145x145 -> escala 1.79x -> 260x260
     d=65 -> R=116, u=3.6 -> U=7, l=2 -> L=4
     success=50, great=10 graus, color="#ffffff", circleColor="#ffffff"
     agulha: CSS div bottom:60%, height:179px, radial-gradient(red,...)
     velocidade original: 1100ms/rot -> aqui: 750ms/rot              */

  const SZ=260,CX=130,CY=130,R=116,U=7,L=4;
  const SUCCESS=50,GREAT=10;
  const SPEED_MS=1050; // ms por rotacao completa (original=1100)

  let needleAngle=0,zoneStart=0;
  let running=false,pressed=false,raf=null,lastTs=0;
  let done=0,onSuccessCb=null,dbdMode=false;
  let _needleWrap=null; // referência cacheada — evita getElementById todo frame

  /* Audio — arquivos reais da pasta sounds/ */
  let _lastSuccess=null;
  function sndPlay(path){
    try{const a=new Audio('../sounds/'+path);a.volume=.8;a.play().catch(()=>{});return a;}catch(e){return null;}
  }
  function sndSpawn(){
    if(_lastSuccess){try{_lastSuccess.pause();_lastSuccess.currentTime=0;}catch(e){}}_lastSuccess=null;
    sndPlay('pré-skillcheck.mp3');
  }
  function sndSuccess()    {_lastSuccess=sndPlay('dbd_good_skill_check.mp3');}
  function sndGenExplosion(){sndPlay('dbd-generator-explosion.mp3');}

  /* Canvas - fiel ao codigo do simulator (d=65,u=3.6,l=2 escalados) */
  function toRad(deg){return(deg-90)*Math.PI/180;}

  function drawCanvas(){
    const canvas=document.getElementById('sc-canvas');
    if(!canvas)return;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,SZ,SZ);
    const gs=zoneStart,ge=zoneStart+GREAT,gde=zoneStart+GREAT+SUCCESS;

    /* 1. Anel vazio (fina linha branca - mesmo que original lineWidth=l, circleColor="#fff") */
    ctx.beginPath();
    ctx.arc(CX,CY,R,toRad(gde),toRad(gs));
    ctx.lineWidth=L;ctx.strokeStyle='#ffffff';ctx.stroke();

    /* 2. Borda interna da zona (r-u, lineWidth=l) */
    ctx.beginPath();
    ctx.arc(CX,CY,R-U,toRad(gs),toRad(gde));
    ctx.lineWidth=L;ctx.strokeStyle='#ffffff';ctx.stroke();

    /* 3. Borda externa da zona (r+u, lineWidth=l) */
    ctx.beginPath();
    ctx.arc(CX,CY,R+U,toRad(gs),toRad(gde));
    ctx.lineWidth=L;ctx.strokeStyle='#ffffff';ctx.stroke();

    /* 4. Great zone preenchida (lineWidth=2*u+1) */
    ctx.beginPath();
    ctx.arc(CX,CY,R,toRad(gs),toRad(ge));
    ctx.lineWidth=2*U+1;ctx.strokeStyle='#ffffff';ctx.stroke();

    /* 5. Tick do fim da zona */
    ctx.beginPath();
    ctx.arc(CX,CY,R,toRad(gde)-.035,toRad(gde));
    ctx.lineWidth=2*U+1;ctx.strokeStyle='#ffffff';ctx.stroke();

    /* 6. Tick do inicio da zona */
    ctx.beginPath();
    ctx.arc(CX,CY,R,toRad(gs),toRad(gs)+.035);
    ctx.lineWidth=2*U+1;ctx.strokeStyle='#ffffff';ctx.stroke();
  }

  function inArc(a,start,width){
    a=((a%360)+360)%360;start=((start%360)+360)%360;
    const end=((start+width)%360+360)%360;
    if(start<=end)return a>=start&&a<=end;
    return a>=start||a<=end;
  }

  function loop(ts){
    if(!lastTs)lastTs=ts;
    const dt=ts-lastTs;lastTs=ts;
    if(running&&!pressed){
      needleAngle=(needleAngle+360*dt/SPEED_MS)%360;
      if(_needleWrap)_needleWrap.style.transform='rotate('+needleAngle+'deg)';
    }
    raf=requestAnimationFrame(loop);
  }

  function checkPress(){
    if(!running||pressed)return;
    pressed=true;running=false;
    const a=((needleAngle%360)+360)%360;
    if(inArc(a,zoneStart,GREAT+SUCCESS)){
      sndSuccess();done++;updateDots();setLabel('');
      if(done>=3){closeSkillCheck();if(onSuccessCb)setTimeout(onSuccessCb,300);}
      else setTimeout(nextCheck,700+Math.random()*600); // 700–1300ms
    } else {
      sndGenExplosion();done=0;updateDots();
      setLabel('FALHA — tente novamente');
      setTimeout(nextCheck,900);
    }
  }

  function nextCheck(){
    zoneStart=Math.random()*360;
    needleAngle=Math.random()*360;
    pressed=false;running=true;lastTs=0;
    drawCanvas();sndSpawn();
  }

  function updateDots(){
    for(let i=0;i<3;i++){
      const d=document.getElementById('sc-dot-'+i);
      if(d)d.classList.toggle('done',i<done);
    }
  }
  function setLabel(txt){const el=document.getElementById('sc-label');if(el)el.textContent=txt;}

  function openSkillCheck(cb){
    const ov=document.getElementById('sc-overlay');if(!ov)return;
    _needleWrap=document.getElementById('sc-needle-wrap'); // cacheia uma vez
    done=0;onSuccessCb=cb;updateDots();setLabel('');
    ov.classList.add('open');
    document.addEventListener('keydown',onKey);
    if(raf)cancelAnimationFrame(raf);
    nextCheck();raf=requestAnimationFrame(loop);
  }

  function closeSkillCheck(){
    const ov=document.getElementById('sc-overlay');if(ov)ov.classList.remove('open');
    running=false;
    if(raf){cancelAnimationFrame(raf);raf=null;}
    document.removeEventListener('keydown',onKey);
    if(_needleWrap)_needleWrap.style.transform='rotate(0deg)';
    _needleWrap=null;
  }

  function onKey(e){
    if(e.code==='Space'){e.preventDefault();checkPress();}
    if(e.key==='Escape')closeSkillCheck();
  }

  /* Shift+G -> K: toggle modo DBD */
  let _sgp=false;
  document.addEventListener('keydown',e=>{
    if(e.key==='G'&&e.shiftKey){_sgp=true;setTimeout(()=>{_sgp=false;},1500);}
    else if(e.key==='k'&&_sgp){
      _sgp=false;dbdMode=!dbdMode;
      notif(dbdMode?'💀 Modo DBD ativado — skill check em toda resolução!':'💀 Modo DBD desativado.');
    }
  });

  /* Intercepta confirmarResolucao */
  const _orig=window.confirmarResolucao;
  window.confirmarResolucao=async function(){
    const tipo=document.getElementById('res-tipo')?.value;
    const intercept=tipo==='consertado'&&(dbdMode||Math.random()<0.30);
    if(!intercept)return _orig.apply(this,arguments);
    openSkillCheck(()=>{
      notif('💀 Skill check passou! Resolvendo chamado...');
      setTimeout(()=>_orig.apply(window,[]),300);
    });
  };

})();
