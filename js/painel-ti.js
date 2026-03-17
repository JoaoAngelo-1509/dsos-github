// DSos v1.1.0 — painel-ti.js
// ── painel-ti.js — Lógica completa do Painel T.I. ──
import { SB, H, SB_KEY } from './supabase-config.js';

  // Cliente Realtime
  const sbClient = supabase.createClient(SB, SB_KEY);
  let realtimeChannel = null;

  let session=null, tickets=[], respondidos=[], descarteFila=[], ocultados=new Set(),
      selectedId=null, filtroAtivo='all', modalTicketId=null, tiMap={};

  // Estado do modal de descarte físico
  let descarteAtual = { pcId: null, ticketId: null };

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

  /* TEMA */
  window.toggleTema=function(){
    const html=document.documentElement, dark=html.dataset.theme==='dark';
    html.dataset.theme=dark?'light':'dark';
    localStorage.setItem('dsos_tema_login',html.dataset.theme);
    document.getElementById('ico-tema').innerHTML=dark
      ?`<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`
      :`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
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

    try{
      // v_usuario_ti_pub é usada porque a tabela usuario_ti tem RLS (qual=false) que bloqueia SELECT pela anon key
      const r=await fetch(`${SB}/rest/v1/v_usuario_ti_pub?select=id,login,nome`,{headers:H});
      const lista=await r.json();
      if(Array.isArray(lista)) lista.forEach(u=>{tiMap[u.id]=u});
    }catch(e){console.error('Erro ao carregar técnicos',e)}

    document.getElementById('nome-ti').textContent=session.nome||session.login;
    const now=new Date();
    const dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    document.getElementById('info-data').innerHTML=`${dias[now.getDay()]} <strong>${now.toLocaleDateString('pt-BR')}</strong>`;
    document.getElementById('info-turno').textContent=calcTurno(now);

    await Promise.all([carregarTickets(),carregarKPIs(),carregarPCs(),carregarTIs(),carregarProfs()]);

    // Realtime — novos tickets e mudanças de status chegam instantaneamente
    sbClient.channel('tickets-realtime')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'ticket'},
        ()=>{ carregarTickets(); carregarKPIs(); notif('Novo chamado recebido!'); })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'ticket'},
        ()=>{ carregarTickets(); carregarKPIs(); })
      .subscribe();

    // Polling a cada 30s como fallback para quando o realtime cair
    setInterval(()=>{ carregarTickets(); carregarKPIs(); carregarPCs(); }, 30000);
  });

  function calcTurno(d){const h=d.getHours();if(h>=6&&h<12)return'Manhã';if(h>=12&&h<18)return'Tarde';return'Noite'}

  /* KPIs */
  async function carregarKPIs(){
    try{
      const hoje=new Date().toISOString().split('T')[0];
      // Busca pendentes direto do banco para não depender do array local
      const [rHoje, rPend] = await Promise.all([
        fetch(`${SB}/rest/v1/ticket?aberto_em=gte.${hoje}T00:00:00&select=status`,{headers:H}),
        fetch(`${SB}/rest/v1/ticket?status=in.(aberto,em_andamento)&select=id`,{headers:H}),
      ]);
      const all  = await rHoje.json();
      const pend = await rPend.json();
      const pendentes      = Array.isArray(pend)?pend.length:0;
      const resolvidosHoje = (Array.isArray(all)?all:[]).filter(t=>t.status==='resolvido'||t.status==='descartado').length;
      const abertoHoje     = Array.isArray(all)?all.length:0;
      document.getElementById('kpi-pendentes').textContent=pendentes;
      document.getElementById('kpi-resolvidos').textContent=resolvidosHoje;
      document.getElementById('kpi-hoje').textContent=abertoHoje;
    }catch(e){console.error(e)}
  }

  /* FETCH TICKETS */
  async function carregarTickets(){
    try{
      const [r1,r2,r3]=await Promise.all([
        fetch(`${SB}/rest/v1/ticket?status=in.(aberto,em_andamento)&order=aberto_em.asc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}),
        fetch(`${SB}/rest/v1/ticket?status=in.(resolvido,descartado,falso_alarme,em_andamento)&order=aberto_em.desc&limit=200&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}),
        fetch(`${SB}/rest/v1/ticket?resolucao=eq.descarte&order=resolvido_em.desc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`,{headers:H}),
      ]);
      tickets     =await r1.json().then(d=>Array.isArray(d)?d:[]);
      const todos =await r2.json().then(d=>Array.isArray(d)?d:[]);
      respondidos =todos.filter(t=>!ocultados.has(t.id));
      descarteFila=await r3.json().then(d=>Array.isArray(d)?d:[]);
    }catch(e){console.error(e);tickets=[]}
    renderUnresp();renderResp();renderDescarte();_atualizarBadgeGrupo();
  }

  /* RENDER NÃO RESPONDIDOS */
  function renderUnresp(){
    const list=document.getElementById('unresp-list');
    const abertos=tickets.filter(t=>t.status==='aberto'||t.status==='em_andamento');
    document.getElementById('badge-unresp').textContent=abertos.length;
    if(!abertos.length){list.innerHTML=`<div class="empty"><div class="eicon">${SVG.checkOk}</div><p>Nenhum chamado pendente</p></div>`;atualizarBotoes();return}
    list.innerHTML=abertos.map(t=>{
      const emerg=t.chamado_emergencia||(t.pc_origem!==t.pc_problema);
      const hora=t.aberto_em?new Date(t.aberto_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
      const nome=t.nome_solicitante||'(sem nome)';
      const tec=t.tecnico_responsavel?`<span style="color:var(--green);display:inline-flex;align-items:center;gap:2px;margin-left:4px">${SVG.wrench} ${tecNome(t.tecnico_responsavel)}</span>`:'';
      return`<div class="ticket-row${emerg?' emergency':''}${selectedId===t.id?' selected':''}" onclick="selecionarTicket(${t.id})">
        <div class="tr-icon">${tipoIcon(t.tipo)}</div>
        <div class="tr-main">
          <div class="tr-id">PC #${t.pc_problema||'—'} / ${tipoLabel(t.tipo)}${emerg?`<span class="emerg-tag">${SVG.zap} EMERG.</span>`:''}</div>
          <div class="tr-sub">#${t.id}${t.lado?' · lado '+t.lado:''}</div>
          <div class="tr-nome">${SVG.user} ${nome}${tec}</div>
        </div>
        <div class="tr-lab">${t.laboratorio||'—'}</div>
        <div class="tr-hora">${hora}</div>
        <div class="tr-status">${statusPill(t.status)}</div>
      </div>`;
    }).join('');
    atualizarBotoes();
  }

  /* RENDER JÁ RESPONDIDOS */
  function renderResp(){
    const list=document.getElementById('resp-list');
    const empty=document.getElementById('resp-empty');
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
        <div style="min-width:0">
          <div class="rc-id">PC #${t.pc_problema||'—'} / ${tipoLabel(t.tipo)}</div>
          <div style="font-size:.54rem;color:var(--muted);margin-top:1px;display:flex;align-items:center;gap:3px">${tec}</div>
        </div>
        <div class="rc-date">${d}</div>
        <div>${statusPill(t.status)}</div>
        <button class="rc-reopen" onclick="reabrirTicket(${t.id},event)">${SVG.reopen} REABRIR</button>
        <button class="rc-dismiss" onclick="dispensar(${t.id},event)">${SVG.x}</button>`;
      div.addEventListener('click',e=>{if(e.target.closest('.rc-dismiss')||e.target.closest('.rc-reopen'))return;abrirModal(t,false)});
      list.appendChild(div);
    });
  }

  /* RENDER FILA DE DESCARTE */
  function renderDescarte(){
    const list=document.getElementById('desc-list');
    const empty=document.getElementById('desc-empty');
    document.getElementById('badge-descarte').textContent=descarteFila.length;
    empty.style.display=descarteFila.length?'none':'flex';
    list.querySelectorAll('.desc-row').forEach(c=>c.remove());
    descarteFila.forEach(t=>{
      const div=document.createElement('div');
      const pcTag=t.pc_info?.tag||`#${t.pc_problema}`;
      const pcStatus=t.pc_info?.status_pc||'descartado';
      const item=t.item_descartado||'(item não especificado)';
      const d=t.resolvido_em?new Date(t.resolvido_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
      // Concluído se: PC marcado como descartado OU descarte físico já foi registrado (nota salva)
      const feito=pcStatus==='descartado'||!!t.descricao_resolucao;
      const descProblema=t.descricao||'';
      const itemEsc=item.replace(/'/g,"\\'").replace(/"/g,'&quot;');
      const descEsc=descProblema.replace(/'/g,"\\'").replace(/"/g,'&quot;');
      div.className=`desc-row${feito?' done':''}`;
      div.innerHTML=`
        <div style="display:flex;align-items:center;justify-content:center;color:var(--orange)">${SVG.trash}</div>
        <div style="min-width:0">
          <div class="desc-pc">${pcTag}</div>
          <div class="desc-item" title="${item}">${item}</div>
          <div class="desc-sub">${SVG.wrench} ${tecNome(t.tecnico_responsavel)} · Ticket #${t.id}</div>
        </div>
        <div class="desc-date">${d}</div>
        <div>${statusPcPill(pcStatus)}</div>
        <div style="text-align:right">
          ${feito
            ?`<span class="done-label">${SVG.check} Concluído</span>`
            :`<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
               <button class="btn-desc-ok" onclick="abrirModalDescarte(${t.pc_problema},${t.id},'${itemEsc}','${descEsc}',event)">${SVG.trash} Feito</button>
               <button class="btn-desc-cancel-fila" onclick="cancelarItemDescarte(${t.id},${t.pc_problema},event)">✕ Cancelar</button>
             </div>`
          }
        </div>`;
      list.appendChild(div);
    });
  }

  /* ABAS */
  // Memória da última aba visitada em cada grupo
  const _ultimaAba = { chamados: 'abertos', gestao: 'pcs' };
  const _grupoDeAba = {
    abertos:'chamados', respondidos:'chamados', descarte:'chamados',
    pcs:'gestao', ti:'gestao', professores:'gestao', manutencao:'gestao'
  };

  window.mudarAba = function(aba) {
    // Desativar todas as tabs e panels
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    // Ativar tab e panel
    document.getElementById('tab-' + aba)?.classList.add('active');
    document.getElementById('panel-' + aba)?.classList.add('active');
    // Memorizar última aba do grupo
    const grupo = _grupoDeAba[aba];
    if (grupo) _ultimaAba[grupo] = aba;
    // Ações específicas por aba
    if (aba === 'manutencao') resetAbaManutencao();
    // Atualizar badge do grupo Chamados
    _atualizarBadgeGrupo();
  };

  window.mudarGrupo = function(grupo) {
    // Atualizar pills de grupo
    document.querySelectorAll('.grupo-pill').forEach(p => p.classList.remove('active'));
    document.getElementById('grupo-' + grupo)?.classList.add('active');
    // Mostrar/ocultar tabs de nível 2
    document.getElementById('tabs-chamados').style.display = grupo === 'chamados' ? '' : 'none';
    document.getElementById('tabs-gestao').style.display   = grupo === 'gestao'   ? '' : 'none';
    // Abrir última aba visitada neste grupo
    mudarAba(_ultimaAba[grupo]);
  };

  function _atualizarBadgeGrupo() {
    const unresp = parseInt(document.getElementById('badge-unresp')?.textContent) || 0;
    const desc   = parseInt(document.getElementById('badge-descarte')?.textContent) || 0;
    const total  = unresp + desc;
    const badge  = document.getElementById('grupo-badge-chamados');
    if (badge) {
      badge.textContent = total;
      badge.style.display = total > 0 ? '' : 'none';
    }
  }

  /* SELECIONAR */
  window.selecionarTicket=function(id){
    if(selectedId===id){const t=tickets.find(x=>x.id===id);if(t)abrirModal(t,false);return}
    selectedId=id;renderUnresp();
  };
  function atualizarBotoes(){
    const has=!!selectedId;
    ['btn-progresso','btn-resolvido','btn-descartado','btn-falso'].forEach(id=>{document.getElementById(id).disabled=!has});
  }

  /* SET STATUS (ações críticas com confirmação) */
  window.setStatus=async function(s){
    if(!selectedId)return;
    const t=tickets.find(x=>x.id===selectedId);
    if(!t)return;

    const pcTag = t.pc_problema || '—';
    let msg = '';

    if(s==='em_andamento'){
      msg = `Colocar o chamado #${t.id} do PC #${pcTag} como EM PROGRESSO?\n` +
            'Isso indica que alguém do T.I. já está atuando nesse chamado.';
    }else if(s==='descartado'){
      // Descartado abre mini-modal para capturar o item antes de ir pra fila
      abrirMiniModalDescarte(t);
      return;
    }else if(s==='falso_alarme'){
      msg = `Marcar o chamado #${t.id} do PC #${pcTag} como FALSO ALARME?\n` +
            'Use apenas quando o problema não se confirmar em sala.';
    }

    if(msg){
      const ok = confirm(msg);
      if(!ok)return;
    }

    const body={status:s,tecnico_responsavel:session.id};
    if(s==='falso_alarme'){body.resolvido_em=new Date().toISOString()}
    try{
      await fetch(`${SB}/rest/v1/ticket?id=eq.${selectedId}`,{method:'PATCH',headers:H,body:JSON.stringify(body)});
      notif(statusLabel(s)+' — chamado atualizado');
      selectedId=null;
      await Promise.all([carregarTickets(),carregarKPIs()]);
    }catch(e){notif('Erro ao atualizar chamado.')}
  };

  window.abrirResolucao=function(){if(!selectedId)return;const t=tickets.find(x=>x.id===selectedId);if(t)abrirModal(t,true)};
  /* ─── MINI-MODAL: captura item antes de enviar pra fila de descarte ─── */
  let _descarteTicket = null;

  function abrirMiniModalDescarte(t) {
    _descarteTicket = t;
    const el = document.getElementById('mini-modal-descarte');
    document.getElementById('mini-item-input').value = '';
    document.getElementById('mini-pc-tag').textContent = t.pc_info?.tag || `#${t.pc_problema}`;
    el.classList.add('open');
    setTimeout(() => document.getElementById('mini-item-input').focus(), 80);
  }

  window.fecharMiniModalDescarte = function() {
    document.getElementById('mini-modal-descarte').classList.remove('open');
    _descarteTicket = null;
  };

  window.confirmarEnvioFila = async function() {
    const item = document.getElementById('mini-item-input').value.trim();
    if (!item) { document.getElementById('mini-item-input').focus(); return; }
    if (!_descarteTicket) return;
    const t = _descarteTicket;
    window.fecharMiniModalDescarte();

    try {
      // Envia pra fila: status=descartado + item_descartado preenchido
      // PC vai para em_manutencao (aguardando descarte físico)
      await fetch(`${SB}/rest/v1/ticket?id=eq.${t.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          status: 'descartado', resolucao: 'descarte',
          resolvido_em: new Date().toISOString(),
          tecnico_responsavel: session.id,
          item_descartado: item
        })
      });
      await fetch(`${SB}/rest/v1/pc?id=eq.${t.pc_problema}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ status_pc: 'em_manutencao' })
      });
      notif('Enviado para fila de descarte');
      selectedId = null;
      await Promise.all([carregarTickets(), carregarKPIs(), carregarPCs()]);
    } catch(e) { notif('Erro ao enviar para fila.'); }
  };

  document.getElementById('mini-modal-descarte')
    ?.addEventListener('click', e => {
      if (e.target === document.getElementById('mini-modal-descarte'))
        window.fecharMiniModalDescarte();
    });

  document.getElementById('mini-item-input')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') window.confirmarEnvioFila(); });



  /* MODAL TICKET */
  function abrirModal(t,comResolucao){
    modalTicketId=t.id;
    document.getElementById('m-title').textContent=`#${t.id} — PC #${t.pc_problema||'—'} / ${tipoLabel(t.tipo)}`;
    const dt=t.aberto_em?new Date(t.aberto_em):null;
    document.getElementById('m-time').innerHTML=dt?`${SVG.clock} ${dt.toLocaleString('pt-BR')}`:'';
    document.getElementById('m-turno').textContent=dt?`Turno: ${calcTurno(dt)}`:'—';
    document.getElementById('m-origem-label').textContent=`Origem: PC #${t.pc_origem||'—'}`;
    const solEl=document.getElementById('m-solicitante');
    if(t.nome_solicitante){solEl.innerHTML=`${SVG.user} ${t.nome_solicitante}`;solEl.style.display='inline-flex';solEl.style.alignItems='center';solEl.style.gap='4px'}
    else{solEl.textContent='';solEl.style.display='none'}
    const tecWrap=document.getElementById('m-tecnico-wrap');
    if(t.tecnico_responsavel){document.getElementById('m-tecnico').innerHTML=`${SVG.wrench} ${tecNome(t.tecnico_responsavel)}`;tecWrap.style.display='block'}
    else{tecWrap.style.display='none'}
    document.getElementById('m-pc').textContent=`PC #${t.pc_problema||'—'}`;
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
    document.getElementById('modal').classList.add('open');

    // Iniciar chat para este ticket
    removerImgTi();
    const ativo = t.status === 'aberto' || t.status === 'em_andamento';
    iniciarChat(t.id, ativo);
  }
  window.fecharModal=function(){
    document.getElementById('modal').classList.remove('open');
    modalTicketId=null;
    if (realtimeChannel) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  };
  document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))window.fecharModal()});

  /* PRIORIDADE */
  window.salvarPrioridade=async function(){
    if(!modalTicketId)return;
    const prio=document.getElementById('m-prio').value;
    await fetch(`${SB}/rest/v1/ticket?id=eq.${modalTicketId}`,{method:'PATCH',headers:H,body:JSON.stringify({prioridade:prio})});
    notif('Prioridade atualizada');await carregarTickets();
  };

  /* RESOLUÇÃO FORMAL */
  window.toggleItemDesc=function(){
    document.getElementById('item-desc').style.display=document.getElementById('res-tipo').value==='descarte'?'block':'none';
  };
  window.confirmarResolucao=async function(){
    const tipo=document.getElementById('res-tipo').value;
    if(!tipo){notif('Selecione o tipo de resolução.');return}
    const itemDesc=document.getElementById('item-desc').value.trim();
    const descRes=document.getElementById('res-desc').value.trim();
    const statusMap={consertado:'resolvido',descarte:'descartado',aguardando_peca:'em_andamento'};
    const pcStatusMap={consertado:'ativo',descarte:'descartado',aguardando_peca:'em_manutencao'};
    const novoStatus=statusMap[tipo];
    const body={status:novoStatus,resolucao:tipo,
      resolvido_em:(novoStatus==='resolvido'||novoStatus==='descartado')?new Date().toISOString():null,
      tecnico_responsavel:session.id,descricao_resolucao:descRes||null};
    if(tipo==='descarte'&&itemDesc) body.item_descartado=itemDesc;

    // Confirmação antes de aplicar resolução formal
    const t=tickets.find(x=>x.id===modalTicketId);
    if(t){
      const pcTag=t.pc_problema||'—';
      const rotulo={consertado:'CONCERTADO',descarte:'DESCARTE',aguardando_peca:'AGUARDANDO PEÇA'}[tipo]||tipo;
      const ok=confirm(
        `Confirmar resolução "${rotulo}" para o chamado #${t.id} (PC #${pcTag})?\n` +
        (tipo==='descarte' && itemDesc ? `Item para descarte: ${itemDesc}\n` : '') +
        (descRes ? `Resumo: ${descRes}` : '')
      );
      if(!ok)return;
    }
    try{
      const r=await fetch(`${SB}/rest/v1/ticket?id=eq.${modalTicketId}`,{method:'PATCH',headers:H,body:JSON.stringify(body)});
      const updated=await r.json();
      const pcId=Array.isArray(updated)&&updated[0]?updated[0].pc_problema:null;
      if(pcId&&pcStatusMap[tipo])
        await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{method:'PATCH',headers:H,body:JSON.stringify({status_pc:pcStatusMap[tipo]})});
      notif('Chamado resolvido com sucesso!');
      if(selectedId===modalTicketId)selectedId=null;
      window.fecharModal();
      await Promise.all([carregarTickets(),carregarKPIs()]);
    }catch(e){notif('Erro ao resolver chamado.')}
  };

  /* ═══════════════════════════════════════
     MODAL DE DESCARTE FÍSICO
     Chamado pelo botão "Feito" na fila
  ═══════════════════════════════════════ */

  /**
   * Abre o modal pré-preenchido com os dados do ticket de descarte.
   * pcId          — id do PC a ter status_pc atualizado para 'descartado'
   * ticketId      — id do ticket para salvar a nota do descarte
   * itemDescartado — texto já salvo no ticket (campo item_descartado)
   * descricao     — descrição do problema original (preenchida em "Por que?")
   */
  window.abrirModalDescarte=function(pcId, ticketId, itemDescartado, descricao, e){
    if(e) e.stopPropagation();
    descarteAtual = { pcId, ticketId };

    // Pré-preenche "o que foi descartado" com o item já registrado
    document.getElementById('desc-oque').value = (itemDescartado && itemDescartado !== '(item não especificado)') ? itemDescartado : '';

    // "Por que?" — vem da descrição do chamado original (só leitura, informativo)
    document.getElementById('desc-porque').value = descricao || 'Sem conserto viável — identificado pelo T.I.';

    // Limpa campo livre
    document.getElementById('desc-como').value = '';
    // Sempre começa desmarcado — só marca se for o PC inteiro
    document.getElementById('desc-pc-completo').checked = false;

    document.getElementById('modal-descarte').classList.add('open');
    setTimeout(()=>document.getElementById('desc-oque').focus(), 120);
  };

  window.fecharModalDescarte=function(){
    document.getElementById('modal-descarte').classList.remove('open');
    descarteAtual = { pcId: null, ticketId: null };
  };

  // Fechar clicando fora
  document.getElementById('modal-descarte').addEventListener('click', e=>{
    if(e.target===document.getElementById('modal-descarte')) window.fecharModalDescarte();
  });

  /**
   * Confirma o descarte físico:
   * 1. Salva a nota detalhada em descricao_resolucao no ticket
   * 2. Atualiza status_pc do PC para 'descartado' (hardware fora de uso)
   */
  window.confirmarDescarteFisico=async function(){
    const oque        = document.getElementById('desc-oque').value.trim();
    const como        = document.getElementById('desc-como').value.trim();
    const pcCompleto  = document.getElementById('desc-pc-completo').checked;

    if(!oque){
      notif('Informe o que foi descartado.');
      document.getElementById('desc-oque').focus();
      return;
    }

    const { pcId, ticketId } = descarteAtual;
    if(!pcId){ notif('Erro: PC não identificado.'); return; }

    const okConfirm = confirm(
      `Confirmar registro de DESCARTE FÍSICO?\n` +
      `Item: ${oque}\n` +
      (como ? `Meio: ${como}\n` : '') +
      (pcCompleto ? 'O PC será marcado como DESCARTADO no cadastro.' : 'O PC continuará ativo no cadastro.')
    );
    if(!okConfirm)return;

    try{
      // Monta nota de descarte físico para rastreabilidade
      const linhas = [`[DESCARTE FÍSICO REGISTRADO]`, `Item: ${oque}`];
      if(como) linhas.push(`Meio: ${como}`);
      if(pcCompleto) linhas.push(`PC marcado como descartado.`);
      linhas.push(`Registrado em: ${new Date().toLocaleString('pt-BR')}`);
      linhas.push(`Técnico: ${session.nome||session.login}`);
      const nota = linhas.join('\n');

      // Grava nota no ticket e marca técnico responsável
      await fetch(`${SB}/rest/v1/ticket?id=eq.${ticketId}`,{
        method:'PATCH', headers:H,
        body:JSON.stringify({ descricao_resolucao: nota, tecnico_responsavel: session.id })
      });

      // Se PC completo: marca como descartado
      // Se apenas periférico: volta o PC para ativo (estava em_manutencao desde a fila)
      await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{
        method:'PATCH', headers:H,
        body:JSON.stringify({ status_pc: pcCompleto ? 'descartado' : 'ativo' })
      });

      notif('Descarte físico registrado — concluído');
      window.fecharModalDescarte();
      // Fade-out visual do item na fila antes de recarregar
      const filaDivs = document.querySelectorAll('.desc-row:not(.done)');
      filaDivs.forEach(d => { d.style.transition = 'opacity .4s, transform .4s'; d.style.opacity='0'; d.style.transform='translateX(30px)'; });
      await new Promise(r => setTimeout(r, 420));
      await Promise.all([carregarTickets(), carregarPCs()]);
    }catch(err){
      console.error(err);
      notif('Erro ao registrar descarte.');
    }
  };

  /* Abre guia PNRS no MMA */
  window.abrirGuia=function(){
    window.open('https://www.mma.gov.br/cidades-sustentaveis/residuos-solidos/politica-nacional-de-residuos-solidos.html','_blank');
  };

  /* FILTRO */
  window.filtrar=function(f,btn){
    filtroAtivo=f;
    document.querySelectorAll('.rf-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderResp();
  };

  /* DISPENSAR */
  window.dispensar=function(id,e){
    e.stopPropagation();ocultados.add(id);respondidos=respondidos.filter(r=>r.id!==id);renderResp();
  };

  /* REABRIR */
  window.reabrirTicket=async function(id,e){
    e.stopPropagation();
    const tLocal=respondidos.find(x=>x.id===id)||tickets.find(x=>x.id===id);
    if(tLocal){
      const pcTag=tLocal.pc_problema||'—';
      const ok=confirm(
        `Reabrir o chamado #${tLocal.id} do PC #${pcTag}?\n` +
        'O status voltará para ABERTO e o PC será marcado como ATIVO.'
      );
      if(!ok)return;
    }
    try{
      const tr=await fetch(`${SB}/rest/v1/ticket?id=eq.${id}&select=pc_problema`,{headers:H});
      const td=await tr.json();
      const pcId=Array.isArray(td)&&td[0]?td[0].pc_problema:null;
      await fetch(`${SB}/rest/v1/ticket?id=eq.${id}`,{method:'PATCH',headers:H,
        body:JSON.stringify({status:'aberto',resolucao:null,resolvido_em:null,tecnico_responsavel:null,descricao_resolucao:null})});
      if(pcId)
        await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`,{method:'PATCH',headers:H,body:JSON.stringify({status_pc:'ativo'})});
      notif('Chamado #'+id+' reaberto');
      ocultados.add(id);respondidos=respondidos.filter(r=>r.id!==id);
      await Promise.all([carregarTickets(),carregarKPIs()]);
      mudarAba('abertos');
    }catch(e){notif('Erro ao reabrir chamado.')}
  };

  /* LIMPAR RESPONDIDOS */
  window.limparRespondidos=function(){
    if(!respondidos.length)return;
    if(!confirm('Limpar todos os chamados da lista?\n(Os dados continuam salvos no banco.)'))return;
    respondidos.forEach(t=>ocultados.add(t.id));respondidos=[];renderResp();notif('Lista limpa');
  };


  /* ─── CANCELAR ITEM DA FILA — reverte ticket para aberto ─── */
  window.cancelarItemDescarte = async function(ticketId, pcId, e) {
    if (e) e.stopPropagation();
    const ok = confirm('Cancelar este descarte?\nO chamado voltará para ABERTO e o PC para ATIVO.');
    if (!ok) return;
    try {
      await fetch(`${SB}/rest/v1/ticket?id=eq.${ticketId}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          status: 'aberto', resolucao: null,
          resolvido_em: null, item_descartado: null,
          tecnico_responsavel: null, descricao_resolucao: null
        })
      });
      await fetch(`${SB}/rest/v1/pc?id=eq.${pcId}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ status_pc: 'ativo' })
      });
      notif('Descarte cancelado — chamado reaberto');
      await Promise.all([carregarTickets(), carregarKPIs(), carregarPCs()]);
    } catch(err) { notif('Erro ao cancelar descarte.'); }
  };


  /* ═══════════════════════════════════════════════
     LIMPEZA DO BANCO
  ═══════════════════════════════════════════════ */
  let _limpezaDias = 30;
  let _limpezaPreviewOk = false;

  // Reset da aba de manutenção quando ela é aberta
  function resetAbaManutencao() {
    _limpezaPreviewOk = false;
    _limpezaDias = 30;
    document.querySelectorAll('.limpeza-prazo-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.dias === '30');
    });
    const prev = document.getElementById('limpeza-preview');
    if (prev) prev.innerHTML = `
      <div class="limpeza-preview-idle">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>Clique em "Ver impacto" para analisar</span>
      </div>`;
    const btn = document.getElementById('btn-executar-limpeza');
    if (btn) btn.disabled = true;
  }

  // Seletor de prazo
  document.querySelectorAll('.limpeza-prazo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.limpeza-prazo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _limpezaDias = parseInt(btn.dataset.dias);
      // Reset preview ao trocar prazo
      _limpezaPreviewOk = false;
      document.getElementById('btn-executar-limpeza').disabled = true;
      document.getElementById('limpeza-preview').innerHTML = `
        <div class="limpeza-preview-idle">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Clique em "Ver impacto" para analisar</span>
        </div>`;
    });
  });

  window.verImpactoLimpeza = async function() {
    const btn = document.getElementById('btn-ver-impacto');
    btn.disabled = true;
    btn.textContent = 'Analisando…';
    document.getElementById('limpeza-preview').innerHTML =
      '<div class="limpeza-preview-idle"><div class="spin"></div> analisando…</div>';

    try {
      const res = await fetch(`${SB}/functions/v1/fn-limpar-dados`, {
        method: 'POST',
        headers: { 'apikey': H.apikey, 'Authorization': H.Authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias: _limpezaDias, apenas_preview: true })
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);

      if (d.tickets_count === 0) {
        document.getElementById('limpeza-preview').innerHTML = `
          <div class="limpeza-preview-idle" style="color:var(--green)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>Nenhum chamado encerrado encontrado nesse intervalo.</span>
          </div>`;
        _limpezaPreviewOk = false;
        document.getElementById('btn-executar-limpeza').disabled = true;
      } else {
        document.getElementById('limpeza-preview').innerHTML = `
          <div class="limpeza-preview-stats">
            <div class="limpeza-stat">
              <span class="limpeza-stat-n" style="color:var(--red)">${d.tickets_count}</span>
              <span class="limpeza-stat-l">tickets</span>
            </div>
            <div class="limpeza-preview-div"></div>
            <div class="limpeza-stat">
              <span class="limpeza-stat-n">${d.mensagens_count}</span>
              <span class="limpeza-stat-l">mensagens</span>
            </div>
            <div class="limpeza-preview-div"></div>
            <div class="limpeza-stat">
              <span class="limpeza-stat-n" style="color:var(--orange)">${d.imagens_count}</span>
              <span class="limpeza-stat-l">imagens</span>
            </div>
          </div>`;
        _limpezaPreviewOk = true;
        document.getElementById('btn-executar-limpeza').disabled = false;
      }
    } catch(err) {
      document.getElementById('limpeza-preview').innerHTML =
        `<div class="limpeza-preview-idle" style="color:var(--red)">Erro ao analisar: ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Ver impacto`;
    }
  };

  window.executarLimpeza = async function() {
    if (!_limpezaPreviewOk) return;
    const prazoLabel = _limpezaDias >= 9999 ? 'todos os registros encerrados' : `os últimos ${_limpezaDias} dias`;
    const ok = confirm(
      `Confirmar limpeza de ${prazoLabel}?\n` +
      'Tickets, mensagens e imagens serão removidos permanentemente.'
    );
    if (!ok) return;

    const btn = document.getElementById('btn-executar-limpeza');
    btn.disabled = true;
    btn.textContent = 'Limpando…';

    try {
      const res = await fetch(`${SB}/functions/v1/fn-limpar-dados`, {
        method: 'POST',
        headers: { 'apikey': H.apikey, 'Authorization': H.Authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias: _limpezaDias, apenas_preview: false })
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);

      window.fecharModalLimpeza();
      notif(
        `Limpeza concluída — ${d.tickets_deletados} tickets, ` +
        `${d.imagens_deletadas} imagens, ${d.mb_liberados} MB liberados`
      );
      await Promise.all([carregarTickets(), carregarKPIs()]);
    } catch(err) {
      notif('Erro na limpeza: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Limpar agora';
    }
  };

  /* NOTIF */
  function notif(msg){const el=document.getElementById('notif');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800)}

  /* ═══════════════════════════════════════
     CHAT DO MODAL (T.I.)
  ═══════════════════════════════════════ */

  let imgPendenteTi = null;

  // Chamado ao abrir o modal — carrega chat e inicia polling
  async function iniciarChat(ticketId, ativo) {
    document.getElementById('chat-input-ti').disabled = !ativo;
    document.getElementById('btn-send-ti').disabled = !ativo;
    document.getElementById('btn-img-ti').disabled = !ativo;
    document.getElementById('file-input-ti').disabled = !ativo;
    document.getElementById('chat-input-ti').placeholder = ativo
      ? 'Mensagem para o PC…'
      : 'Chamado encerrado — chat desabilitado.';
    document.getElementById('chat-status-label').textContent = ativo ? 'Em aberto' : 'Encerrado';

    await carregarMsgsTi(ticketId);

    // Cancela canal anterior e abre novo
    if (realtimeChannel) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    realtimeChannel = sbClient
      .channel(`chat-ti-${ticketId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mensagem',
        filter: `ticket_id=eq.${ticketId}`
      }, () => carregarMsgsTi(ticketId))
      .subscribe();
  }

  async function carregarMsgsTi(ticketId) {
    try {
      const r = await fetch(
        `${SB}/rest/v1/mensagem?ticket_id=eq.${ticketId}&order=enviado_em.asc&select=*`,
        { headers: H }
      );
      const msgs = await r.json();
      const chat = document.getElementById('chat-msgs-ti');
      if (!Array.isArray(msgs) || !msgs.length) {
        chat.innerHTML = `<div class="chat-empty-ti">Nenhuma mensagem ainda. Escreva para o usuário.</div>`;
        return;
      }
      const atBottom = chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 40;
      chat.innerHTML = msgs.map(m => {
        const deTi = (m.remetente === 'TI' || m.remetente === 'ti');
        const lado = deTi ? 'ti' : 'pc';
        const hora = m.enviado_em
          ? new Date(m.enviado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
          : '';
        const imgHtml = m.imagem_url
          ? `<img class="msg-img-ti" src="${escapeHtml(m.imagem_url)}" alt="print" onclick="abrirLightbox('${escapeHtml(m.imagem_url)}')" />`
          : '';
        const textoHtml = m.conteudo
          ? `<div class="msg-bubble-ti">${escapeHtml(m.conteudo)}</div>`
          : '';
        return `<div class="msg ${lado}">
          ${imgHtml}${textoHtml}
          <div class="msg-meta-ti">${deTi ? 'T.I.' : 'PC'} · ${hora}</div>
        </div>`;
      }).join('');
      if (atBottom) chat.scrollTop = chat.scrollHeight;
    } catch(e) { console.error('chat erro', e); }
  }

  window.enviarMsgTi = async function(e) {
    if (e.key !== 'Enter') return;
    const inp = document.getElementById('chat-input-ti');
    const txt = inp.value.trim();
    if (!txt && !imgPendenteTi) return;
    if (!modalTicketId) return;
    inp.value = '';

    let imagem_url = null;
    if (imgPendenteTi) {
      try {
        imagem_url = await uploadImagem(imgPendenteTi);
      } catch(err) {
        notif('Erro ao enviar imagem.');
        return;
      }
      removerImgTi();
    }

    try {
      await fetch(`${SB}/rest/v1/mensagem`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          ticket_id: modalTicketId,
          remetente: 'TI',
          conteudo: txt || null,
          imagem_url,
          enviado_em: new Date().toISOString()
        })
      });
      await carregarMsgsTi(modalTicketId);
    } catch(err) { notif('Erro ao enviar mensagem.'); }
  };

  // Upload de imagem para storage
  async function uploadImagem(file) {
    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : (file.type.split('/')[1] || 'jpg');
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const res = await fetch(`${SB}/storage/v1/object/chat-prints/${nome}`, {
      method: 'POST',
      headers: {
        'apikey': H.apikey,
        'Authorization': H.Authorization,
        'Content-Type': file.type,
        'x-upsert': 'true'
      },
      body: file
    });
    if (!res.ok) throw new Error('Upload falhou');
    return `${SB}/storage/v1/object/public/chat-prints/${nome}`;
  }

  window.selecionarImagemTi = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    imgPendenteTi = file;
    const url = URL.createObjectURL(file);
    document.getElementById('img-prev-thumb').src = url;
    document.getElementById('img-prev-nome').textContent = file.name;
    document.getElementById('img-preview-ti').classList.add('visible');
    document.getElementById('chat-input-ti').focus();
    event.target.value = '';
  };

  window.removerImgTi = function() {
    imgPendenteTi = null;
    document.getElementById('img-preview-ti').classList.remove('visible');
    document.getElementById('img-prev-thumb').src = '';
  };

  // Suporte a colar imagem (Ctrl+V) no chat
  document.getElementById('chat-input-ti')?.addEventListener('paste', function(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        imgPendenteTi = file;
        const url = URL.createObjectURL(file);
        document.getElementById('img-prev-thumb').src = url;
        document.getElementById('img-prev-nome').textContent = 'imagem colada';
        document.getElementById('img-preview-ti').classList.add('visible');
        break;
      }
    }
  });

  // Lightbox compartilhado
  window.abrirLightbox = function(url) {
    document.getElementById('lightbox-img').src = url;
    document.getElementById('lightbox').classList.add('open');
  };
  window.fecharLightbox = function() {
    document.getElementById('lightbox').classList.remove('open');
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.fecharLightbox();
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ═══════════════════════════════════════
     GESTÃO DE COMPUTADORES
  ═══════════════════════════════════════ */

  let todosOsPCs = [];
  let pcFiltroStatus = 'todos';
  let pcEditandoId = null;

  async function carregarPCs() {
    try {
      const r = await fetch(`${SB}/rest/v1/v_pc_pub?order=tag.asc&select=*`, { headers: H });
      todosOsPCs = await r.json();
      if (!Array.isArray(todosOsPCs)) todosOsPCs = [];
      document.getElementById('badge-pcs').textContent = todosOsPCs.length;
    } catch(e) { console.error(e); todosOsPCs = []; }
    renderPCs();
  }

  function filtrarPCs() { renderPCs(); }
  window.filtrarPCs = filtrarPCs;

  function setPcFiltro(f, btn) {
    pcFiltroStatus = f;
    document.querySelectorAll('.pf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPCs();
  }
  window.setPcFiltro = setPcFiltro;

  function renderPCs() {
    const grid = document.getElementById('pc-grid');
    const q = (document.getElementById('pc-search')?.value || '').toLowerCase();
    let lista = todosOsPCs.filter(pc => {
      const matchQ = !q || pc.tag?.toLowerCase().includes(q) || pc.laboratorio?.toLowerCase().includes(q);
      const matchF = pcFiltroStatus === 'todos' || pc.status_pc === pcFiltroStatus;
      return matchQ && matchF;
    });

    document.getElementById('pc-count').textContent = todosOsPCs.length;

    if (!lista.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="eicon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div><p>Nenhum computador encontrado.</p></div>`;
      return;
    }

    const statusIco = { ativo:'<span style="color:var(--green)">●</span>', em_manutencao:'<span style="color:var(--yellow)">●</span>', descartado:'<span style="color:var(--muted)">●</span>' };
    const statusTxt = { ativo:'Ativo', em_manutencao:'Manutenção', descartado:'Descartado' };

    grid.innerHTML = lista.map(pc => {
      const cls = pc.status_pc === 'em_manutencao' ? ' manutencao' : pc.status_pc === 'descartado' ? ' descartado' : '';
      return `<div class="pc-card${cls}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px">
          <div class="pc-tag-big" style="cursor:pointer" onclick="abrirModalPC(${pc.id})">${pc.tag || '—'}</div>
          <button class="btn-ti-del" title="Remover PC" onclick="deletarPC(${pc.id},'${pc.tag}',event)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
        <div class="pc-meta" style="cursor:pointer" onclick="abrirModalPC(${pc.id})">
          <span>${pc.laboratorio || '—'}</span>
          <span>Lado ${pc.lado || '—'}</span>
        </div>
        <div class="pc-card-footer" style="cursor:pointer" onclick="abrirModalPC(${pc.id})">
          ${statusIco[pc.status_pc] || ''} <span style="font-size:.6rem;color:var(--muted)">${statusTxt[pc.status_pc] || pc.status_pc}</span>
        </div>
      </div>`;
    }).join('');
  }

  window.deletarPC = async function(id, tag, e) {
    e.stopPropagation();
    const ok = confirm(
      `Remover o PC "${tag}" do sistema?\n\nTodos os chamados e mensagens vinculados a este PC também serão excluídos permanentemente.`
    );
    if (!ok) return;
    try {
      await fetch(`${SB}/rest/v1/rpc/rpc_deletar_pc`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ p_id: id })
      });
      notif(`PC ${tag} removido.`);
      await carregarPCs();
    } catch(e) { notif('Erro ao remover PC.'); }
  };

  window.abrirModalPC = function(id) {
    // normaliza o id para número e evita problemas de comparação (string vs number)
    const numericId = id != null ? Number(id) : null;
    pcEditandoId = numericId;
    const editando = numericId != null;
    document.getElementById('mpc-title').textContent = editando ? 'Editar Computador' : 'Cadastrar Computador';
    document.getElementById('mpc-status-field').style.display = editando ? 'flex' : 'none';
    document.getElementById('mpc-senha-hint').style.display = editando ? 'block' : 'none';
    document.getElementById('mpc-senha').placeholder = editando ? '(deixe vazio para não alterar)' : 'Mínimo 4 caracteres';

    if (editando) {
      const pc = todosOsPCs.find(p => String(p.id) === String(numericId));
      if (!pc) return;
      document.getElementById('mpc-tag').value = pc.tag || '';
      document.getElementById('mpc-tag').disabled = true; // tag não pode mudar
      document.getElementById('mpc-lab').value = pc.laboratorio || '';
      document.getElementById('mpc-lado').value = pc.lado?.trim() || 'A';
      document.getElementById('mpc-status').value = pc.status_pc || 'ativo';
      document.getElementById('mpc-senha').value = '';
    } else {
      document.getElementById('mpc-tag').value = '';
      document.getElementById('mpc-tag').disabled = false;
      document.getElementById('mpc-lab').value = '';
      document.getElementById('mpc-lado').value = 'A';
      document.getElementById('mpc-senha').value = '';
    }
    document.getElementById('modal-pc').classList.add('open');
    setTimeout(() => document.getElementById(editando ? 'mpc-lab' : 'mpc-tag').focus(), 120);
  };

  window.fecharModalPC = function() {
    document.getElementById('modal-pc').classList.remove('open');
    pcEditandoId = null;
  };
  document.getElementById('modal-pc').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-pc')) window.fecharModalPC();
  });

  window.salvarPC = async function() {
    const tag    = document.getElementById('mpc-tag').value.trim().toUpperCase();
    const lab    = document.getElementById('mpc-lab').value.trim();
    const lado   = document.getElementById('mpc-lado').value;
    const senha  = document.getElementById('mpc-senha').value;
    const status = document.getElementById('mpc-status').value;

    if (!lab) { notif('Informe o laboratório.'); return; }

    if (pcEditandoId === null) {
      // CADASTRO NOVO
      if (!tag) { notif('Informe a tag do PC.'); return; }
      if (!senha || senha.length < 4) { notif('Senha precisa ter pelo menos 4 caracteres.'); return; }
      try {
        const r = await fetch(`${SB}/rest/v1/rpc/rpc_cadastrar_pc`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ p_tag: tag, p_laboratorio: lab, p_lado: lado, p_senha: senha })
        });
        const res = await r.json();
        if (!r.ok) throw new Error(res.message || 'Erro');
        notif(`PC ${tag} cadastrado!`);
        window.fecharModalPC();
        await carregarPCs();
      } catch(e) { notif('Erro: ' + e.message); }
    } else {
      // EDIÇÃO
      try {
        await fetch(`${SB}/rest/v1/rpc/rpc_atualizar_pc`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ p_id: pcEditandoId, p_status_pc: status, p_nova_senha: senha || null })
        });
        // atualiza lab/lado via PATCH direto (esses campos são seguros)
        await fetch(`${SB}/rest/v1/pc?id=eq.${pcEditandoId}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ laboratorio: lab, lado: lado })
        });
        notif('PC atualizado!');
        window.fecharModalPC();
        await carregarPCs();
      } catch(e) { notif('Erro ao atualizar PC.'); }
    }
  };

  /* ═══════════════════════════════════════
     GESTÃO DE USUÁRIOS T.I.
  ═══════════════════════════════════════ */

  let todosOsTIs = [];
  let tiEditandoId = null;

  async function carregarTIs() {
    try {
      const r = await fetch(`${SB}/rest/v1/v_usuario_ti_pub?order=nome.asc&select=*`, { headers: H });
      todosOsTIs = await r.json();
      if (!Array.isArray(todosOsTIs)) todosOsTIs = [];
      document.getElementById('badge-ti').textContent = todosOsTIs.length;
      document.getElementById('ti-count').textContent  = todosOsTIs.length;
    } catch(e) { console.error(e); todosOsTIs = []; }
    renderTIs();
  }

  function renderTIs() {
    const list = document.getElementById('ti-user-list');
    if (!todosOsTIs.length) {
      list.innerHTML = `<div class="empty"><div class="eicon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><p>Nenhum usuário cadastrado.</p></div>`;
      return;
    }
    list.innerHTML = todosOsTIs.map(u => {
      const isMe = session && u.id === session.id;
      const initials = (u.nome || u.login || '?').split(' ').map(w=>w[0]).slice(0,2).join('');
      return `<div class="ti-user-row${isMe?' me-row':''}">
        <div class="ti-avatar">${initials}</div>
        <div class="ti-user-info">
          <div class="ti-user-nome">
            ${u.nome || '—'}
            ${isMe ? '<span class="ti-you-tag">você</span>' : ''}
          </div>
          <div class="ti-user-login">@${u.login || '—'}</div>
        </div>
        <button class="btn-ti-edit" onclick="abrirModalTI(${u.id})">Editar</button>
        <button class="btn-ti-del-u" title="Remover usuário"
          ${isMe ? 'disabled title="Você não pode remover a si mesmo"' : ''}
          onclick="deletarTI(${u.id},'${(u.nome||u.login).replace(/'/g,"\\'")}')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  window.abrirModalTI = function(id) {
    tiEditandoId = id;
    const editando = id !== null;
    document.getElementById('mti-title').textContent = editando ? 'Editar Usuário T.I.' : 'Cadastrar Usuário T.I.';
    document.getElementById('mti-senha-hint').style.display = editando ? 'block' : 'none';
    document.getElementById('mti-login').disabled = editando;
    document.getElementById('mti-senha').placeholder = editando ? '(deixe vazio para não alterar)' : 'Mínimo 4 caracteres';

    if (editando) {
      const u = todosOsTIs.find(x => x.id === id);
      if (!u) return;
      document.getElementById('mti-nome').value  = u.nome  || '';
      document.getElementById('mti-login').value = u.login || '';
      document.getElementById('mti-senha').value = '';
    } else {
      document.getElementById('mti-nome').value  = '';
      document.getElementById('mti-login').value = '';
      document.getElementById('mti-senha').value = '';
      document.getElementById('mti-login').disabled = false;
    }
    document.getElementById('modal-ti-user').classList.add('open');
    setTimeout(() => document.getElementById('mti-nome').focus(), 120);
  };

  window.fecharModalTI = function() {
    document.getElementById('modal-ti-user').classList.remove('open');
    tiEditandoId = null;
  };
  document.getElementById('modal-ti-user').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-ti-user')) window.fecharModalTI();
  });

  window.salvarTI = async function() {
    const nome  = document.getElementById('mti-nome').value.trim();
    const login = document.getElementById('mti-login').value.trim();
    const senha = document.getElementById('mti-senha').value;

    if (!nome)  { notif('Informe o nome do usuário.'); return; }

    if (tiEditandoId === null) {
      // CADASTRO
      if (!login) { notif('Informe o login.'); return; }
      if (!senha || senha.length < 4) { notif('Senha precisa ter no mínimo 4 caracteres.'); return; }
      try {
        const r = await fetch(`${SB}/rest/v1/rpc/rpc_cadastrar_ti`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ p_login: login, p_nome: nome, p_senha: senha })
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.message || 'Erro'); }
        notif(`Usuário ${nome} cadastrado!`);
        window.fecharModalTI();
        await carregarTIs();
      } catch(e) {
        notif('Erro: ' + (e.message.includes('duplicate') ? 'login já existe.' : e.message));
      }
    } else {
      // EDIÇÃO
      try {
        await fetch(`${SB}/rest/v1/rpc/rpc_atualizar_ti`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ p_id: tiEditandoId, p_nome: nome, p_nova_senha: senha || null })
        });
        notif('Usuário atualizado!');
        window.fecharModalTI();
        await carregarTIs();
      } catch(e) { notif('Erro ao atualizar usuário.'); }
    }
  };

  window.deletarTI = async function(id, nome) {
    const ok = confirm(`Remover o usuário "${nome}" do sistema?\n\nEsta ação não pode ser desfeita.`);
    if (!ok) return;
    try {
      await fetch(`${SB}/rest/v1/rpc/rpc_deletar_ti`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ p_id: id })
      });
      notif(`Usuário ${nome} removido.`);
      await carregarTIs();
    } catch(e) { notif('Erro ao remover usuário.'); }
  };

  /* ═══════════════════════════════════════
     EASTER EGG 🥚
     Ativa clicando 5× no título "DSos"
     Troque as variáveis abaixo pela piada!
  ═══════════════════════════════════════ */

  // ── CONFIGURE AQUI ──────────────────────────────────────────────────
  const EGG_FOTO   = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQXzyAvoM6vUPr887008lkLrtO0YIy4Vu25pg&s';        // URL da foto (ex: 'https://...jpg') — deixe vazio para placeholder
  const EGG_NOME   = 'Rickelme';
  const EGG_FRASE  = '"Eu não fiz o design, fiz no Canva"';
  // ────────────────────────────────────────────────────────────────────

  let eggClicks = 0, eggTimer = null;
  document.getElementById('egg-trigger').addEventListener('click', () => {
    eggClicks++;
    clearTimeout(eggTimer);
    eggTimer = setTimeout(() => { eggClicks = 0; }, 1500);
    if (eggClicks >= 5) {
      eggClicks = 0;
      abrirEgg();
    }
  });

  function abrirEgg() {
    const img = document.getElementById('egg-img');
    img.src = EGG_FOTO || '';
    document.getElementById('egg-nome').textContent  = EGG_NOME;
    document.getElementById('egg-frase').textContent = EGG_FRASE;
    document.getElementById('egg-bg').classList.add('open');
    document.addEventListener('keydown', fecharEggKey);
  }
  window.fecharEgg = function() {
    document.getElementById('egg-bg').classList.remove('open');
    document.removeEventListener('keydown', fecharEggKey);
  };
  function fecharEggKey(e) { if (e.key === 'Escape') window.fecharEgg(); }

  /* ═══════════════════════════════════════
     TOGGLES DE SENHA (olho)
  ═══════════════════════════════════════ */
  window.toggleSenhaMPC = function() {
    const inp = document.getElementById('mpc-senha');
    const ico = document.getElementById('ico-olho-mpc');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    ico.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  };
  window.toggleSenhaTI = function() {
    const inp = document.getElementById('mti-senha');
    const ico = document.getElementById('ico-olho-ti');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    ico.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  };
  window.toggleSenhaProf = function() {
    const inp = document.getElementById('mprof-senha');
    const ico = document.getElementById('ico-olho-prof');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    ico.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  };

  /* CONTADOR DE CARACTERES DO CHAT (T.I.) */
  window.atualizarContadorChatTI = function(inp) {
    document.getElementById('ti-chat-char').textContent = inp.value.length;
  };

  /* ═══════════════════════════════════════
     GESTÃO DE PROFESSORES
  ═══════════════════════════════════════ */
  let todosOsProfs = [];
  let profEditandoId = null;

  async function carregarProfs() {
    try {
      const r = await fetch(`${SB}/rest/v1/professor?order=nome.asc&select=id,nome,login,disciplina`, { headers: H });
      todosOsProfs = await r.json();
      if (!Array.isArray(todosOsProfs)) todosOsProfs = [];
      document.getElementById('badge-prof').textContent = todosOsProfs.length;
      document.getElementById('prof-count').textContent = todosOsProfs.length;
    } catch(e) { console.error(e); todosOsProfs = []; }
    renderProfs();
  }

  function renderProfs() {
    const list = document.getElementById('prof-user-list');
    if (!todosOsProfs.length) {
      list.innerHTML = `<div class="empty"><div class="eicon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg></div><p>Nenhum professor cadastrado.</p></div>`;
      return;
    }
    list.innerHTML = todosOsProfs.map(u => {
      const initials = (u.nome || u.login || '?').split(' ').map(w=>w[0]).slice(0,2).join('');
      return `<div class="ti-user-row">
        <div class="ti-avatar" style="background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.3);color:var(--kpi-green)">${initials}</div>
        <div class="ti-user-info">
          <div class="ti-user-nome">${u.nome || '—'}</div>
          <div class="ti-user-login">@${u.login || '—'}${u.disciplina ? ' · ' + u.disciplina : ''}</div>
        </div>
        <button class="btn-ti-edit" onclick="abrirModalProf(${u.id})">Editar</button>
        <button class="btn-ti-del-u" title="Remover professor" onclick="deletarProf(${u.id},'${(u.nome||u.login).replace(/'/g,"\\'")}')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  window.abrirModalProf = function(id) {
    profEditandoId = id;
    const editando = id !== null;
    document.getElementById('mprof-title').textContent = editando ? 'Editar Professor' : 'Cadastrar Professor';
    document.getElementById('mprof-senha-hint').style.display = editando ? 'block' : 'none';
    document.getElementById('mprof-login').disabled = editando;
    document.getElementById('mprof-senha').placeholder = editando ? '(deixe vazio para não alterar)' : 'Mínimo 4 caracteres';
    if (editando) {
      const u = todosOsProfs.find(x => x.id === id);
      if (!u) return;
      document.getElementById('mprof-nome').value       = u.nome || '';
      document.getElementById('mprof-login').value      = u.login || '';
      document.getElementById('mprof-disciplina').value = u.disciplina || '';
      document.getElementById('mprof-senha').value      = '';
    } else {
      document.getElementById('mprof-nome').value       = '';
      document.getElementById('mprof-login').value      = '';
      document.getElementById('mprof-disciplina').value = '';
      document.getElementById('mprof-senha').value      = '';
      document.getElementById('mprof-login').disabled   = false;
    }
    document.getElementById('modal-professor').classList.add('open');
    setTimeout(() => document.getElementById('mprof-nome').focus(), 120);
  };

  window.fecharModalProf = function() {
    document.getElementById('modal-professor').classList.remove('open');
    profEditandoId = null;
  };
  document.getElementById('modal-professor').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-professor')) window.fecharModalProf();
  });

  window.salvarProf = async function() {
    const nome       = document.getElementById('mprof-nome').value.trim();
    const login      = document.getElementById('mprof-login').value.trim();
    const disciplina = document.getElementById('mprof-disciplina').value.trim();
    const senha      = document.getElementById('mprof-senha').value;

    if (!nome) { notif('Informe o nome do professor.'); return; }

    if (profEditandoId === null) {
      if (!login) { notif('Informe o login.'); return; }
      if (!senha || senha.length < 4) { notif('Senha precisa ter no mínimo 4 caracteres.'); return; }
      try {
        const r = await fetch(`${SB}/rest/v1/rpc/rpc_cadastrar_professor`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ p_login: login, p_nome: nome, p_senha: senha, p_disciplina: disciplina || null })
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.message || 'Erro'); }
        notif(`Professor ${nome} cadastrado!`);
        window.fecharModalProf();
        await carregarProfs();
      } catch(e) {
        notif('Erro: ' + (e.message.includes('duplicate') ? 'login já existe.' : e.message));
      }
    } else {
      try {
        await fetch(`${SB}/rest/v1/rpc/rpc_atualizar_professor`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ p_id: profEditandoId, p_nome: nome, p_disciplina: disciplina || null, p_nova_senha: senha || null })
        });
        notif('Professor atualizado!');
        window.fecharModalProf();
        await carregarProfs();
      } catch(e) { notif('Erro ao atualizar professor.'); }
    }
  };

  window.deletarProf = async function(id, nome) {
    const ok = confirm(`Remover o professor "${nome}" do sistema?\nEsta ação não pode ser desfeita.`);
    if (!ok) return;
    try {
      await fetch(`${SB}/rest/v1/professor?id=eq.${id}`, { method: 'DELETE', headers: H });
      notif(`Professor ${nome} removido.`);
      await carregarProfs();
    } catch(e) { notif('Erro ao remover professor.'); }
  };


  /* ═══════════════════════════════════════
     BUSCA SERVER-SIDE (debounced)
  ═══════════════════════════════════════ */
  let _bTimers = {};
  function _debounce(key, fn, ms=350){ clearTimeout(_bTimers[key]); _bTimers[key]=setTimeout(fn,ms); }

  // Busca na fila de descarte
  window.buscarDescarte = function(q) {
    _debounce('desc', async () => {
      try {
        let url = `${SB}/rest/v1/ticket?resolucao=eq.descarte&order=resolvido_em.desc&select=*,pc_info:pc!ticket_pc_problema_fkey(tag,status_pc)`;
        if (q) url += `&or=(item_descartado.ilike.*${encodeURIComponent(q)}*,descricao.ilike.*${encodeURIComponent(q)}*)`;
        const r = await fetch(url, {headers:H});
        descarteFila = await r.json().then(d=>Array.isArray(d)?d:[]);
      } catch(e){ descarteFila=[]; }
      renderDescarte();
    });
  };

  // Busca técnicos T.I.
  window.buscarTIs = function(q) {
    _debounce('ti', async () => {
      try {
        let url = `${SB}/rest/v1/v_usuario_ti_pub?order=nome.asc&select=*`;
        if (q) url += `&or=(nome.ilike.*${encodeURIComponent(q)}*,login.ilike.*${encodeURIComponent(q)}*)`;
        const r = await fetch(url, {headers:H});
        todosOsTIs = await r.json().then(d=>Array.isArray(d)?d:[]);
      } catch(e){ todosOsTIs=[]; }
      renderTIs();
    });
  };

  // Busca professores
  window.buscarProfs = function(q) {
    _debounce('prof', async () => {
      try {
        let url = `${SB}/rest/v1/professor?order=nome.asc&select=id,nome,login,disciplina`;
        if (q) url += `&or=(nome.ilike.*${encodeURIComponent(q)}*,login.ilike.*${encodeURIComponent(q)}*,disciplina.ilike.*${encodeURIComponent(q)}*)`;
        const r = await fetch(url, {headers:H});
        todosOsProfs = await r.json().then(d=>Array.isArray(d)?d:[]);
      } catch(e){ todosOsProfs=[]; }
      renderProfs();
    });
  };

  /* SAIR */
  window.sair=function(){sessionStorage.removeItem('dsos_session');window.location.href='login.html'};