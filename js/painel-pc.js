// DSos v1.3 alpha alpha — painel-pc.js
// ── painel-pc.js — Lógica completa do Painel do Usuário/PC ──
import { SB_URL, SB_KEY, H } from './supabase-config.test.js';

  // Cliente Realtime
  const sbClient = supabase.createClient(SB_URL, SB_KEY);
  let realtimeChannel = null;

  // Estado da página
  let session   = null;
  let tipo      = null;
  let tipoRapido = null;
  let emergAtivo = false;
  let tickets   = [];
  let chatTicketId = null;

  // ── INICIALIZAÇÃO ──
  window.addEventListener('DOMContentLoaded', async () => {
    // Aplica tema salvo
    const temaSalvo = localStorage.getItem('dsos_tema_login');
    if (temaSalvo === 'dark') {
      document.documentElement.dataset.theme = 'dark';
      document.getElementById('ico-tema').innerHTML =
        `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
    }

    const raw = sessionStorage.getItem('dsos_session');
    if (!raw) { window.location.href = 'login.html'; return; }
    session = JSON.parse(raw);
    // Aceita login de PC ou de Professor
    if (session.tipo !== 'pc' && session.tipo !== 'professor') { window.location.href = 'login.html'; return; }

    // Professor: permite ambos os modos, exibe campo de PC no rápido
    if (session.tipo === 'professor') {
      document.getElementById('info-nome').textContent  = session.nome || session.login;
      document.getElementById('badge-pc').textContent   = 'PROF';
      document.getElementById('info-lab').textContent   = '—';
      document.getElementById('info-lado').textContent  = '—';
      document.getElementById('footer-lab').textContent = '—';
      document.getElementById('footer-lado').textContent= '—';
      // Mostra campo de PC no modo rápido
      document.getElementById('prof-pc-field-rapido').classList.add('visible');
      document.getElementById('rapido-title-txt').textContent =
        'Selecione o tipo de problema e informe a tag do PC. O T.I. será notificado imediatamente.';
      // Ativa emergência no modo detalhado (professor sempre usa emergência lá)
      window.toggleEmerg();
      // Carrega os chamados abertos pelo professor
      await carregarChamados();
      setInterval(() => carregarChamados(), 30000);
      return;
    }

    document.getElementById('info-nome').textContent    = session.nome || session.tag;
    document.getElementById('badge-pc').textContent     = session.tag  || '—';
    document.getElementById('info-lab').textContent     = session.laboratorio || '—';
    document.getElementById('info-lado').textContent    = session.lado || '—';
    document.getElementById('footer-lab').textContent   = session.laboratorio || '—';
    document.getElementById('footer-lado').textContent  = session.lado || '—';
    // Alunos não vêem o botão de emergência
    document.getElementById('emerg').style.display      = 'none';
    document.querySelector('.divisor').style.display    = 'none';

    // ── Verifica status do PC ──
    try {
      const rpc = await fetch(`${SB_URL}/rest/v1/v_pc_pub?id=eq.${session.id}&select=status_pc`, { headers: H });
      const pcData = await rpc.json();
      if (Array.isArray(pcData) && pcData[0]) {
        const st = pcData[0].status_pc;
        if (st === 'em_manutencao') {
          const b = document.getElementById('pc-status-banner');
          document.getElementById('pc-status-msg').textContent =
            'Atenção: este PC está registrado como em manutenção. Você ainda pode abrir chamados, mas o T.I. já pode estar ciente do problema.';
          b.classList.add('visible', 'manutencao');
        } else if (st === 'descartado') {
          const b = document.getElementById('pc-status-banner');
          document.getElementById('pc-status-msg').textContent =
            'Este PC está registrado como DESCARTADO. Não é possível abrir chamados. Entre em contato com o T.I.';
          b.classList.add('visible', 'descartado');
          // bloqueia completamente abertura de chamados
          document.getElementById('btn-submit').disabled = true;
          document.getElementById('btn-rapido-send').disabled = true;
          document.getElementById('btn-submit').title = 'PC descartado — chamados bloqueados';
          document.querySelectorAll('.modo-btn').forEach(btn => { btn.style.opacity='.4'; btn.style.pointerEvents='none'; });
          document.getElementById('btn-rapido-send').style.opacity = '.4';
        }
      }
    } catch(e) { /* silencioso */ }

    await carregarChamados();
    setInterval(() => carregarChamados(), 30000);
  });

  // ── MODO ESCURO ──
  window.toggleTema = function() {
    const html = document.documentElement;
    const dark = html.dataset.theme === 'dark';
    html.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('dsos_tema_login', html.dataset.theme);
    document.getElementById('ico-tema').innerHTML = dark
      ? `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`
      : `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
  };

  // ── CONTADOR DE CARACTERES DO CHAT ──
  window.atualizarContadorChat = function(inp, contId) {
    document.getElementById(contId).textContent = inp.value.length;
  };

  // ── TROCA MODO RÁPIDO / DETALHADO ──
  window.trocarModo = function(modo) {
    const rapido = document.getElementById('modo-rapido');
    const det    = document.getElementById('modo-detalhado');
    const btnR   = document.getElementById('modo-rapido-btn');
    const btnD   = document.getElementById('modo-detalhado-btn');
    if (modo === 'rapido') {
      rapido.style.display = 'flex';
      det.style.display    = 'none';
      btnR.classList.add('active');
      btnD.classList.remove('active');
    } else {
      rapido.style.display = 'none';
      det.style.display    = 'flex';
      btnR.classList.remove('active');
      btnD.classList.add('active');
    }
  };

  // ── CHAMADO RÁPIDO ──
  window.pickRapido = function(el) {
    document.querySelectorAll('.rapido-opt').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    tipoRapido = el.dataset.v;
    document.getElementById('btn-rapido-send').disabled = false;
  };

  window.enviarRapido = async function() {
    if (!tipoRapido) return;

    // Resolve PC de origem/problema
    let pcOrigemId, pcProblemaId, lab, lado;

    if (session.tipo === 'professor') {
      const tag = document.getElementById('prof-pc-tag-rapido').value.trim().toUpperCase();
      if (!tag) { toast('Informe a tag do PC com problema.', 'err'); return; }
      try {
        const rpc = await fetch(
          `${SB_URL}/rest/v1/pc?tag=eq.${encodeURIComponent(tag)}&select=id,laboratorio,lado`,
          { headers: H }
        );
        const pcs = await rpc.json();
        if (!Array.isArray(pcs) || !pcs.length) { toast('Tag do PC não encontrada no sistema.', 'err'); return; }
        pcOrigemId  = pcs[0].id;
        pcProblemaId = pcs[0].id;
        lab  = pcs[0].laboratorio;
        lado = pcs[0].lado;
      } catch(e) { toast('Erro ao buscar PC.', 'err'); return; }
    } else {
      pcOrigemId  = session.id;
      pcProblemaId = session.id;
      lab  = session.laboratorio;
      lado = session.lado;
    }

    const btn = document.getElementById('btn-rapido-send');
    btn.classList.add('loading');
    try {
      const r = await fetch(`${SB_URL}/rest/v1/ticket`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          pc_origem: pcOrigemId, pc_problema: pcProblemaId,
          tipo: tipoRapido,
          descricao: '(chamado rápido)',
          laboratorio: lab, lado: lado,
          status: 'aberto', prioridade: 'medio',
          aberto_em: new Date().toISOString(),
          nome_solicitante: session.nome,
          chamado_emergencia: session.tipo === 'professor'
        })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const id = Array.isArray(data) ? data[0]?.id : data?.id;
      document.getElementById('suc-id').textContent = `Chamado #${id || '—'}`;
      document.getElementById('overlay').classList.add('open');
      // reset seleção
      document.querySelectorAll('.rapido-opt').forEach(o => o.classList.remove('selected'));
      tipoRapido = null;
      document.getElementById('btn-rapido-send').disabled = true;
      if (session.tipo === 'professor') document.getElementById('prof-pc-tag-rapido').value = '';
      await carregarChamados();
    } catch(e) {
      toast('Erro ao abrir chamado: ' + e.message, 'err');
    } finally {
      btn.classList.remove('loading');
    }
  };

  // ── TROCA DE ABA ──
  // Chamada pelo onclick das tabs no HTML. 'aba' pode ser 'abrir' ou 'chamados'
  window.trocarAba = function(aba) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('tab-' + aba).classList.add('active');
    document.getElementById('view-' + aba).classList.add('active');
  };

  // ── BUSCA CHAMADOS DO SUPABASE ──
  let buscaTimer = null;
  window.buscaChamados = function(q) {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => carregarChamados(q), 350);
  };

  async function carregarChamados(q = '') {
    try {
      let url;
      const filtroBase = session.tipo === 'professor'
        ? `nome_solicitante=eq.${encodeURIComponent(session.nome)}`
        : `pc_origem=eq.${encodeURIComponent(session.id)}`;
      const searchFilter = q
        ? `&or=(descricao.ilike.*${encodeURIComponent(q)}*,laboratorio.ilike.*${encodeURIComponent(q)}*,tipo.ilike.*${encodeURIComponent(q)}*)`
        : '';
      url = `${SB_URL}/rest/v1/ticket?${filtroBase}${searchFilter}&order=aberto_em.desc&select=*`;
      const r = await fetch(url, { headers: H });
      const data = await r.json();
      tickets = Array.isArray(data) ? data : [];
    } catch(e) { tickets = []; }
    renderChamados();
  }

  // ── RENDERIZA A LISTA DE CHAMADOS ──
  // Gera o HTML dos cards e atualiza o badge da aba
  function renderChamados() {
    const list = document.getElementById('ticket-list');
    const badge = document.getElementById('tab-badge');
    const ativos = tickets.filter(t => t.status === 'aberto' || t.status === 'em_andamento').length;

    badge.textContent = ativos || tickets.length;
    badge.classList.toggle('zero', ativos === 0);

    if (!tickets.length) {
      const quem = session.tipo === 'professor' ? 'para você' : 'para este PC';
      list.innerHTML = `<div class="empty"><div class="eicon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div><p>Nenhum chamado encontrado ${quem}.<br>Vá em <strong>Abrir Chamado</strong> para criar um.</p></div>`;
      return;
    }

    list.innerHTML = tickets.map(t => {
      const podeChat = t.status === 'aberto' || t.status === 'em_andamento';
      const hora = t.aberto_em
        ? new Date(t.aberto_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
        : '—';
      return `<div class="ticket-card ${t.status}" onclick="${podeChat ? `abrirChat(${t.id})` : `abrirDetalhes(${t.id})`}">
        <div class="t-icon">${tipoIcon(t.tipo)}</div>
        <div class="t-info">
          <div class="t-title">${t.tipo || '—'}</div>
          <div class="t-meta">#${t.id} · ${t.laboratorio || '—'} Lado ${t.lado || '—'}</div>
        </div>
        <div class="t-right">
          <span class="status-pill pill-${t.status}">${statusLabel(t.status)}</span>
          <span class="t-time">${hora}</span>
          ${podeChat
            ? `<button class="btn-chat-ticket" onclick="event.stopPropagation();abrirChat(${t.id})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Chat
              </button>`
            : `<span class="t-enc"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></span>`
          }
        </div>
      </div>`;
    }).join('');
  }

  // Retorna SVG pelo tipo do chamado
  function tipoIcon(tipo) {
    const s = (p,c)=>`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    if (!tipo) return s('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>');
    const t = tipo.toLowerCase();
    if (t.includes('hardware'))   return s('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>');
    if (t.includes('software'))   return s('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
    if (t.includes('periférico') || t.includes('periferico')) return s('<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v8"/>');
    if (t.includes('rede'))       return s('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>');
    return s('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>');
  }
  // Traduz o valor do banco para texto legível na tela
  function statusLabel(s) {
    return {aberto:'Aberto',em_andamento:'Em andamento',resolvido:'Resolvido',descartado:'Descartado',falso_alarme:'Falso alarme'}[s] || s;
  }

  // ── ABRE O MODAL DE CHAT ──
  // Chamado pelo clique em chamados abertos/em andamento
  window.abrirChat = function(id) { const t = tickets.find(x => x.id === id); if (t) abrirModal(t); };
  // Chamado pelo clique em chamados já encerrados (só exibe, sem chat)
  window.abrirDetalhes = function(id) { const t = tickets.find(x => x.id === id); if (t) abrirModal(t); };

  async function abrirModal(t) {
    chatTicketId = t.id;
    const podeChat = t.status === 'aberto' || t.status === 'em_andamento';
    document.getElementById('m-title').textContent = `#${t.id} — ${t.tipo || '—'}`;
    const hora = t.aberto_em
      ? new Date(t.aberto_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
      : '—';
    document.getElementById('m-meta-hora').innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${hora}`;
    document.getElementById('m-meta-lab').textContent  = `${t.laboratorio || '—'} Lado ${t.lado || '—'}`;
    document.getElementById('m-desc').textContent      = t.descricao || '(sem descrição)';
    const pill = document.getElementById('m-status-pill');
    pill.textContent = statusLabel(t.status);
    pill.className = `status-pill pill-${t.status}`;
    const resBlock = document.getElementById('m-resolucao');
    if (t.resolucao) {
      const resMap = { consertado:'Consertado', descarte:'Enviado para descarte', aguardando_peca:'Aguardando peça' };
      document.getElementById('m-res-tipo').textContent = resMap[t.resolucao] || t.resolucao;
      document.getElementById('m-res-item').textContent = t.item_descartado ? `Item: ${t.item_descartado}` : '';
      resBlock.classList.add('visivel');
    } else {
      resBlock.classList.remove('visivel');
    }
    document.getElementById('chat-input').disabled   = !podeChat;
    document.getElementById('btn-send').disabled      = !podeChat;
    document.getElementById('chat-input').placeholder = podeChat ? 'Escreva sua mensagem...' : 'Chamado encerrado — chat desabilitado.';
    document.getElementById('modal-chat').classList.add('open');
    await carregarMsgs(t.id);
    iniciarRealtime(t.id);
  }

  async function carregarMsgs(ticketId) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/mensagem?ticket_id=eq.${ticketId}&order=enviado_em.asc&select=*`,
        { headers: H }
      );
      const msgs = await r.json();
      const chat = document.getElementById('chat-msgs');
      if (!Array.isArray(msgs) || !msgs.length) {
        chat.innerHTML = `<div class="chat-empty">Nenhuma mensagem ainda.<br>Escreva para iniciar o atendimento.</div>`;
        return;
      }
      chat.innerHTML = msgs.map(m => {
        const deTI = (m.remetente === 'TI' || m.remetente === 'ti');
        const de = deTI ? 'ti' : 'pc';
        const hora = m.enviado_em ? new Date(m.enviado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
        const imgHtml = m.imagem_url
          ? `<img class="msg-img" src="${escapeHtml(m.imagem_url)}" alt="print" onclick="abrirLightbox('${escapeHtml(m.imagem_url)}')" />`
          : '';
        const textoHtml = m.conteudo ? `<div class="msg-bubble">${escapeHtml(m.conteudo)}</div>` : '';
        return `<div class="msg ${de}">
          ${imgHtml}${textoHtml}
          <div class="msg-meta">${de === 'ti' ? 'T.I.' : 'Você'} · ${hora}</div>
        </div>`;
      }).join('');
      chat.scrollTop = chat.scrollHeight;
    } catch(e) { console.error(e); }
  }

  function iniciarRealtime(ticketId) {
    if (realtimeChannel) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    realtimeChannel = sbClient
      .channel(`chat-pc-${ticketId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mensagem',
        filter: `ticket_id=eq.${ticketId}`
      }, (payload) => { carregarMsgs(ticketId); if(payload.new?.remetente==='TI') window._dsosSom?.mensagemNova(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'ticket',
        filter: `id=eq.${ticketId}`
      }, (payload) => {
        const novo = payload.new;
        // Tocar som quando chamado for resolvido, descartado ou falso alarme
        if (['resolvido','descartado','falso_alarme'].includes(novo?.status)) {
          window._dsosSom?.notificacao();
        }
        carregarChamados();
        carregarMsgs(ticketId);
      })
      .subscribe();
  }

  window.fecharChat = function() {
    document.getElementById('modal-chat').classList.remove('open');
    chatTicketId = null;
    if (realtimeChannel) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  };
  document.getElementById('modal-chat').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-chat')) window.fecharChat();
  });

  window.enviarMsg = async function(e) {
    if (e.key !== 'Enter') return;
    const inp = document.getElementById('chat-input');
    const txt = inp.value.trim();
    if (!txt && !imgsPendentes.length) return;
    if (!chatTicketId) return;
    inp.value = '';

    // Upload de todas as imagens pendentes (até 5)
    const remetente = 'PC';
    try {
      // Enviar imagens como mensagens separadas, depois o texto
      for (const file of imgsPendentes) {
        let imagem_url = null;
        try {
          imagem_url = await uploadImagem(file);
        } catch(err) {
          toast('Erro ao enviar imagem: ' + err.message, 'err');
          continue;
        }
        await fetch(`${SB_URL}/rest/v1/mensagem`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ ticket_id: chatTicketId, remetente, conteudo: null, imagem_url, enviado_em: new Date().toISOString() })
        });
      }
      // Limpar imagens pendentes
      imgsPendentes = [];
      document.getElementById('img-preview-list').innerHTML = '';
      document.getElementById('img-preview-row').classList.remove('visible');

      // Enviar texto se houver
      if (txt) {
        await fetch(`${SB_URL}/rest/v1/mensagem`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ ticket_id: chatTicketId, remetente, conteudo: txt, imagem_url: null, enviado_em: new Date().toISOString() })
        });
      }
      await carregarMsgs(chatTicketId);
    } catch(e) { toast('Erro ao enviar mensagem.', 'err'); window._dsosSom?.erro(); }
  };

  // ── UPLOAD DE IMAGEM ──
  let imgsPendentes = []; // array de File — até 5 imagens por mensagem

  async function uploadImagem(file) {
    const ext = file.name.split('.').pop() || 'jpg';
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/chat-prints/${nome}`, {
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
    return `${SB_URL}/storage/v1/object/public/chat-prints/${nome}`;
  }

  window.selecionarImagem = function(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    const MAX = 5;
    // Somar com as já pendentes
    const total = imgsPendentes.length + files.length;
    if (total > MAX) {
      toast(`Máximo de ${MAX} imagens por mensagem.`, 'err');
      event.target.value = '';
      return;
    }
    files.forEach(file => {
      imgsPendentes.push(file);
      const url = URL.createObjectURL(file);
      const wrap = document.createElement('div');
      wrap.className = 'img-preview-item';
      wrap.innerHTML = `<img src="${url}" class="img-preview-thumb" />
        <span class="img-preview-nome">${file.name}</span>
        <button class="img-preview-remove" onclick="removerImgPendente(${imgsPendentes.length - 1}, this.closest('.img-preview-item'))">✕</button>`;
      document.getElementById('img-preview-list').appendChild(wrap);
    });
    document.getElementById('img-preview-row').classList.add('visible');
    document.getElementById('chat-input').focus();
    event.target.value = '';
  };

  window.removerImgPendente = function(idx, el) {
    imgsPendentes.splice(idx, 1);
    el?.remove();
    // Re-indexar botões
    document.querySelectorAll('#img-preview-list .img-preview-remove').forEach((btn, i) => {
      btn.setAttribute('onclick', `removerImgPendente(${i}, this.closest('.img-preview-item'))`);
    });
    if (!imgsPendentes.length) {
      document.getElementById('img-preview-row').classList.remove('visible');
    }
  };

  // ── LIGHTBOX ──
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

  // ── CONTROLES DO FORMULÁRIO ──

  // Abre/fecha o dropdown de tipo de problema
  window.toggleSel = function() { document.getElementById('sel-wrap').classList.toggle('open'); };

  // Chamado quando o usuário clica em uma opção do dropdown
  window.pickTipo = function(opt) {
    tipo = opt.dataset.v;
    document.querySelectorAll('.sel-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    document.querySelectorAll('.sel-t-icon').forEach(i => i.style.display = 'none');
    const ic = document.getElementById('ico-' + opt.dataset.i);
    if (ic) ic.style.display = 'block';
    const nomes = { hardware:'Hardware', software:'Software', rede:'Rede', outro:'Outro' };
    document.getElementById('sel-val').textContent = nomes[tipo] || tipo;
    document.getElementById('sel-trigger').classList.add('valued');
    document.getElementById('sel-wrap').classList.remove('open');
  };

  // Fecha o dropdown se o usuário clicar fora dele
  document.addEventListener('click', e => {
    const w = document.getElementById('sel-wrap');
    if (!w.contains(e.target)) w.classList.remove('open');
  });

  // Liga/desliga o modo emergência
  window.toggleEmerg = function() {
    emergAtivo = !emergAtivo;
    document.getElementById('emerg').classList.toggle('on', emergAtivo);
    document.getElementById('epill').textContent = emergAtivo ? 'ATIVO' : 'ATIVAR';
    if (!emergAtivo) document.getElementById('emerg-pc').value = '';
  };

  // ── ENVIO DO FORMULÁRIO ──
  // Valida os campos, monta o objeto e envia pro Supabase
  window.abrirChamado = async function() {
    if (!tipo) { toast('Selecione o tipo de problema.', 'err'); return; }
    const desc = document.getElementById('descricao').value.trim();
    if (!desc) { toast('Adicione uma descrição do problema.', 'err'); return; }

    // Professor SEMPRE precisa de emergência (não tem PC próprio)
    if (session.tipo === 'professor' && !emergAtivo) {
      toast('Professores só podem abrir chamados de emergência.', 'err'); return;
    }

    // Para PC: origem = PC logado. Para professor: origem = PC informado na emergência
    let pcOrigemId  = session.tipo === 'pc' ? session.id : null;
    let pcProblemaId = session.tipo === 'pc' ? session.id : null;

    if (emergAtivo) {
      const epTag = document.getElementById('emerg-pc').value.trim();
      if (!epTag) { toast('Informe a tag do PC com problema.', 'err'); return; }
      try {
        const rpc = await fetch(`${SB_URL}/rest/v1/pc?tag=eq.${encodeURIComponent(epTag)}&select=id,laboratorio,lado`, { headers: H });
        const pcs = await rpc.json();
        if (!Array.isArray(pcs) || !pcs.length) { toast('Tag do PC não encontrada no sistema.', 'err'); return; }
        pcProblemaId = pcs[0].id;
        if (session.tipo === 'professor') {
          // Professor: pc_origem = pc_problema (o PC informado é a origem e o problema)
          pcOrigemId = pcs[0].id;
          session.laboratorio = pcs[0].laboratorio;
          session.lado = pcs[0].lado;
          document.getElementById('footer-lab').textContent  = pcs[0].laboratorio || '—';
          document.getElementById('footer-lado').textContent = pcs[0].lado || '—';
        }
      } catch(e) { toast('Erro ao buscar PC de emergência.', 'err'); return; }
    }

    const btn = document.getElementById('btn-submit');
    btn.classList.add('loading');
    try {
      const r = await fetch(`${SB_URL}/rest/v1/ticket`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          pc_origem: pcOrigemId, pc_problema: pcProblemaId, tipo, descricao: desc,
          laboratorio: session.laboratorio, lado: session.lado,
          status: 'aberto', prioridade: 'medio',
          aberto_em: new Date().toISOString(), nome_solicitante: session.nome,
          chamado_emergencia: emergAtivo || session.tipo === 'professor'
        })
      });
      if (!r.ok) { const err = await r.json().catch(()=>({})); throw new Error(err.message || 'HTTP ' + r.status); }
      const data = await r.json();
      const id = Array.isArray(data) ? data[0]?.id : data?.id;
      document.getElementById('suc-id').textContent = `Chamado #${id || '—'}`;
      document.getElementById('overlay').classList.add('open');
      await carregarChamados();
    } catch(e) {
      console.error(e);
      toast('Erro ao abrir chamado: ' + e.message, 'err');
    } finally {
      btn.classList.remove('loading');
    }
  };

  // ── RESET DO FORMULÁRIO ──
  // Chamado após abrir chamado com sucesso — limpa tudo para novo uso
  window.resetForm = function() {
    document.getElementById('overlay').classList.remove('open');
    document.querySelectorAll('.sel-opt').forEach(o => o.classList.remove('active'));
    document.querySelectorAll('.sel-t-icon').forEach(i => i.style.display = 'none');
    document.getElementById('sel-val').textContent = '';
    document.getElementById('sel-trigger').classList.remove('valued');
    document.getElementById('descricao').value = '';
    document.getElementById('dc').textContent = '0';
    // Professor: re-ativa emergência (sempre necessária no modo detalhado)
    if (session.tipo === 'professor') {
      if (!emergAtivo) window.toggleEmerg();
    } else {
      emergAtivo = false;
      document.getElementById('emerg').classList.remove('on');
      document.getElementById('epill').textContent = 'ATIVAR';
    }
    document.getElementById('emerg-pc').value = '';
    // Limpa campo rápido do professor
    const profRapido = document.getElementById('prof-pc-tag-rapido');
    if (profRapido) profRapido.value = '';
    tipo = null;
    tipoRapido = null;
    document.querySelectorAll('.rapido-opt').forEach(o => o.classList.remove('selected'));
    document.getElementById('btn-rapido-send').disabled = true;
    // Após abrir chamado → redirecionar para Meus Chamados
    trocarAba('chamados');
  };

  // ── LOGOUT ── remove a sessão e volta para o login
  window.sair = function() {
    sessionStorage.removeItem('dsos_session');
    window.location.href = 'login.html';
  };

  // ── TOAST (notificação temporária) ──
  // t = 'ok' (verde) ou 'err' (vermelho)
  function toast(msg, t) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.className = `toast ${t} show`;
    setTimeout(() => el.classList.remove('show'), 3000);
  }