// DSos v1.5 — logging.js
// ── módulo centralizado de logging ──

import { SUPABASE_URL, SUPABASE_HEADERS as H } from './supabase-config.js';

class DSosLogger {
  constructor() {
    this.sessionId = this._generateSessionId();
    this._debugLogs = [];
    this._addDebugLog('✓ Instância criada');
  }

  _addDebugLog(msg) {
    const timestamp = new Date().toISOString();
    this._debugLogs.push(`[${timestamp}] ${msg}`);
    console.log('[DSosLogger]', msg);
    
    // Salva em localStorage pra debugar depois
    try {
      localStorage.setItem('DSosLogger_debug', JSON.stringify(this._debugLogs));
    } catch (e) {
      // localStorage cheio, ignora
    }
  }

  _generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async _fetchIP() {
    return new Promise((resolve) => {
      this._addDebugLog('▶ _fetchIP() iniciado');
      
      const pc = new RTCPeerConnection({ iceServers: [] });
      const ips = new Set();

      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));

      pc.onicecandidate = (ice) => {
        if (!ice || !ice.candidate) return;
        
        const ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3})/;
        const match = ipRegex.exec(ice.candidate.candidate);
        
        if (match) {
          const ip = match[1];
          if (!ip.startsWith('127.') && !ip.startsWith('0.')) {
            ips.add(ip);
            this._addDebugLog(`→ IP encontrado: ${ip}`);
          }
        }
      };

      setTimeout(() => {
        pc.close();
        const ipArray = Array.from(ips);
        const ip = ipArray.length > 0 ? ipArray[0] : '0.0.0.0';
        this._addDebugLog(`✓ IP final: ${ip}`);
        resolve(ip);
      }, 2000);
    });
  }

  // RPCs que NÃO aceitam p_sessao_id — evita "unknown parameter" no Postgres
  static _SEM_SESSAO = new Set([
    'rpc_log_login_falho',
    'rpc_log_abrir_chamado',
    'rpc_log_alterar_status_chamado',
    'rpc_log_atribuir_chamado',
    'rpc_log_enviar_mensagem',
    'rpc_log_cadastrar_pc',
    'rpc_log_alterar_status_pc',
    'rpc_log_deletar_pc',
    'rpc_log_descarte_equipment',
    'rpc_log_cadastrar_usuario_ti',
    'rpc_log_deletar_usuario_ti',
    'rpc_log_cadastrar_professor',
    'rpc_log_deletar_professor',
    'rpc_log_limpeza_banco',
  ]);

  // ─── FIX 2: busca IP sob demanda ─────────────────────────────────
  async _callRPC(rpcName, params) {
    this._addDebugLog(`→ _callRPC: ${rpcName}`);
    
    const ip = await this._fetchIP();
    this._addDebugLog(`✓ IP recebido: ${ip}`);

    const body = { ...params, p_ip_address: ip };

    // p_sessao_id só existe em rpc_log_login — não envia para os demais
    if (!DSosLogger._SEM_SESSAO.has(rpcName)) {
      body.p_sessao_id = this.sessionId;
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '(sem corpo)');
        this._addDebugLog(`✗ RPC falhou: ${rpcName} HTTP ${res.status}`);
        console.error(
          `[DSosLogger] RPC "${rpcName}" falhou — HTTP ${res.status}\n` +
          `  params enviados: ${JSON.stringify(body)}\n` +
          `  resposta Supabase: ${errBody}`
        );
        return null;
      }

      this._addDebugLog(`✓ RPC sucesso: ${rpcName}`);
      return await res.json().catch(() => null);
    } catch (e) {
      this._addDebugLog(`✗ Erro rede: ${rpcName} - ${e.message}`);
      console.error(`[DSosLogger] Erro de rede ao chamar "${rpcName}":`, e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════
  // LOGIN / ACESSO
  // ═══════════════════════════════════════════════════════

  async logLogin(usuarioId, usuarioTipo, usuarioLogin, usuarioNome) {
    // Parâmetros alinhados com rpc_log_login no banco:
    // p_usuario_id, p_usuario_tipo, p_usuario_login, p_usuario_nome,
    // p_status_login, p_ip_address (DEFAULT NULL), p_user_agent (DEFAULT NULL),
    // p_sessao_id (DEFAULT NULL)
    return this._callRPC('rpc_log_login', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_status_login:  'sucesso',
      // p_ip_address e p_sessao_id são injetados automaticamente em _callRPC
    });
  }

  async logLoginFalho(usuarioLogin, motivo) {
    // Parâmetros alinhados com rpc_log_login_falho no banco:
    // p_usuario_login, p_motivo_falha, p_ip_address (DEFAULT NULL)
    return this._callRPC('rpc_log_login_falho', {
      p_usuario_login: usuarioLogin,
      p_motivo_falha:  motivo,
      // p_ip_address é injetado automaticamente em _callRPC
    });
  }

  // ═══════════════════════════════════════════════════════
  // CHAMADOS / TICKETS
  // ═══════════════════════════════════════════════════════

  async logAbrirChamado(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, ticketId, tipoProblema, laboratorio, isEmergencia = false) {
    return this._callRPC('rpc_log_abrir_chamado', {
      p_usuario_id:     usuarioId,
      p_usuario_tipo:   usuarioTipo,
      p_usuario_login:  usuarioLogin,
      p_usuario_nome:   usuarioNome,
      p_ticket_id:      ticketId,
      p_tipo_problema:  tipoProblema,
      p_laboratorio:    laboratorio,
      p_is_emergencia:  isEmergencia,
    });
  }

  async logAlterarStatusChamado(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, ticketId, statusAnterior, statusNovo) {
    return this._callRPC('rpc_log_alterar_status_chamado', {
      p_usuario_id:       usuarioId,
      p_usuario_tipo:     usuarioTipo,
      p_usuario_login:    usuarioLogin,
      p_usuario_nome:     usuarioNome,
      p_ticket_id:        ticketId,
      p_status_anterior:  statusAnterior,
      p_status_novo:      statusNovo,
    });
  }

  async logAtribuirChamado(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, ticketId, tecnicoId) {
    return this._callRPC('rpc_log_atribuir_chamado', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_ticket_id:     ticketId,
      p_tecnico_id:    tecnicoId,
    });
  }

  // ═══════════════════════════════════════════════════════
  // MENSAGENS / CHAT
  // ═══════════════════════════════════════════════════════

  async logEnviarMensagem(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, ticketId, temImagem = false) {
    return this._callRPC('rpc_log_enviar_mensagem', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_ticket_id:     ticketId,
      p_tem_imagem:    temImagem,
    });
  }

  // ═══════════════════════════════════════════════════════
  // COMPUTADORES / PCs
  // ═══════════════════════════════════════════════════════

  async logCadastrarPC(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, pcTag, laboratorio) {
    return this._callRPC('rpc_log_cadastrar_pc', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_pc_tag:        pcTag,
      p_laboratorio:   laboratorio,
    });
  }

  async logAlterarStatusPC(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, pcId, pcTag, statusAnterior, statusNovo) {
    return this._callRPC('rpc_log_alterar_status_pc', {
      p_usuario_id:       usuarioId,
      p_usuario_tipo:     usuarioTipo,
      p_usuario_login:    usuarioLogin,
      p_usuario_nome:     usuarioNome,
      p_pc_id:            pcId,
      p_pc_tag:           pcTag,
      p_status_anterior:  statusAnterior,
      p_status_novo:      statusNovo,
    });
  }

  async logDeletarPC(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, pcId, pcTag) {
    return this._callRPC('rpc_log_deletar_pc', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_pc_id:         pcId,
      p_pc_tag:        pcTag,
    });
  }

  // ═══════════════════════════════════════════════════════
  // DESCARTE
  // ═══════════════════════════════════════════════════════

  async logDescarteEquipamento(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, ticketId, pcTag, itemDescartado, meioDescarte) {
    return this._callRPC('rpc_log_descarte_equipment', {
      p_usuario_id:      usuarioId,
      p_usuario_tipo:    usuarioTipo,
      p_usuario_login:   usuarioLogin,
      p_usuario_nome:    usuarioNome,
      p_ticket_id:       ticketId,
      p_pc_tag:          pcTag,
      p_item_descartado: itemDescartado,
      p_meio_descarte:   meioDescarte,
    });
  }

  // ═══════════════════════════════════════════════════════
  // USUÁRIOS T.I.
  // ═══════════════════════════════════════════════════════

  async logCadastrarUsuarioTI(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, novoTILogin, novoTINome) {
    return this._callRPC('rpc_log_cadastrar_usuario_ti', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_novo_ti_login: novoTILogin,
      p_novo_ti_nome:  novoTINome,
    });
  }

  async logDeletarUsuarioTI(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, tiDeleteId, tiDeleteLogin) {
    return this._callRPC('rpc_log_deletar_usuario_ti', {
      p_usuario_id:       usuarioId,
      p_usuario_tipo:     usuarioTipo,
      p_usuario_login:    usuarioLogin,
      p_usuario_nome:     usuarioNome,
      p_ti_delete_id:     tiDeleteId,
      p_ti_delete_login:  tiDeleteLogin,
    });
  }

  // ═══════════════════════════════════════════════════════
  // PROFESSORES
  // ═══════════════════════════════════════════════════════

  async logCadastrarProfessor(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, profLogin, profNome) {
    return this._callRPC('rpc_log_cadastrar_professor', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_prof_login:    profLogin,
      p_prof_nome:     profNome,
    });
  }

  async logDeletarProfessor(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, profDeleteId, profDeleteLogin) {
    return this._callRPC('rpc_log_deletar_professor', {
      p_usuario_id:         usuarioId,
      p_usuario_tipo:       usuarioTipo,
      p_usuario_login:      usuarioLogin,
      p_usuario_nome:       usuarioNome,
      p_prof_delete_id:     profDeleteId,
      p_prof_delete_login:  profDeleteLogin,
    });
  }

  // ═══════════════════════════════════════════════════════
  // LIMPEZA DO BANCO
  // ═══════════════════════════════════════════════════════

  async logLimpezaBanco(usuarioId, usuarioTipo, usuarioLogin, usuarioNome, dias, ticketsDeletados, mensagensDeleteadas, imagensDeletadas) {
    return this._callRPC('rpc_log_limpeza_banco', {
      p_usuario_id:            usuarioId,
      p_usuario_tipo:          usuarioTipo,
      p_usuario_login:         usuarioLogin,
      p_usuario_nome:          usuarioNome,
      p_dias:                  dias,
      p_tickets_deletados:     ticketsDeletados,
      p_mensagens_deletadas:   mensagensDeleteadas,
      p_imagens_deletadas:     imagensDeletadas,
    });
  }
}

// Exporta instância singleton
export const logger = new DSosLogger();