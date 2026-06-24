// DSos v1.5 — logging.js
// ── módulo centralizado de logging ──

import { SUPABASE_URL, SUPABASE_HEADERS as H } from './supabase-config.js';

class DSosLogger {
  constructor() {
    this.sessionId = this._generateSessionId();
  }

  _generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  // Coleta o "user agent"/fingerprint do dispositivo:
  // browser | SO | resolução | idioma | fuso horário.
  _getUserAgent() {
    const ua = navigator.userAgent;
    const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s]([\d.]+)/);
    const browser = browserMatch ? `${browserMatch[1]}/${browserMatch[2].split('.')[0]}` : 'Desconhecido';
    const os = /Windows/.test(ua) ? 'Windows'
              : /Mac/.test(ua)     ? 'macOS'
              : /Linux/.test(ua)   ? 'Linux'
              : /Android/.test(ua) ? 'Android'
              : /iPhone|iPad/.test(ua) ? 'iOS'
              : 'Desconhecido';
    return `${browser} | ${os} | ${screen.width}x${screen.height} | ${navigator.language || 'N/A'} | ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'N/A'}`;
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

  async _callRPC(rpcName, params) {
    // NOTA: o valor enviado é o user-agent/fingerprint do dispositivo
    // (ver _getUserAgent), NÃO um endereço IP. O nome do parâmetro
    // `p_ip_address` é mantido porque é o contrato das RPCs de log no banco
    // (renomeá-lo aqui causaria erro de "unknown parameter" no PostgREST).
    const body = { ...params, p_ip_address: this._getUserAgent() };
    if (!DSosLogger._SEM_SESSAO.has(rpcName)) body.p_sessao_id = this.sessionId;

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error(`[DSosLogger] ${rpcName} HTTP ${res.status}`, err);
        return null;
      }
      return await res.json().catch(() => null);
    } catch (e) {
      console.error(`[DSosLogger] ${rpcName}:`, e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════
  // LOGIN / ACESSO
  // ═══════════════════════════════════════════════════════

  async logLogin(usuarioId, usuarioTipo, usuarioLogin, usuarioNome) {
    sessionStorage.setItem('dsos_login_time', Date.now().toString());
    return this._callRPC('rpc_log_login', {
      p_usuario_id:    usuarioId,
      p_usuario_tipo:  usuarioTipo,
      p_usuario_login: usuarioLogin,
      p_usuario_nome:  usuarioNome,
      p_status_login:  'sucesso',
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
  // LOGOUT
  // ═══════════════════════════════════════════════════════

  static _calcDuracao() {
    const t = sessionStorage.getItem('dsos_login_time');
    if (!t) return null;
    const secs = Math.floor((Date.now() - parseInt(t)) / 1000);
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  async logLogout(usuarioId, usuarioTipo, usuarioLogin, usuarioNome) {
    const duracao = DSosLogger._calcDuracao();
    sessionStorage.removeItem('dsos_login_time');
    return this._callRPC('rpc_log_logout', {
      p_usuario_id:      usuarioId,
      p_usuario_tipo:    usuarioTipo,
      p_usuario_login:   usuarioLogin,
      p_usuario_nome:    usuarioNome,
      ...(duracao ? { p_duracao_sessao: duracao } : {}),
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