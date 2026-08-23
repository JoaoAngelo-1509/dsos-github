// DSos — Realtime Manager
// Utilitário central para diagnosticar o status dos canais Supabase Realtime
// usados em painel-ti.js, painel-pc.js e painel-logs.js. Não altera o
// comportamento dos canais — apenas padroniza o log de conexão/erro/queda,
// facilitando o diagnóstico de "por que uma tela não está atualizando sozinha".

// Retorna um callback pronto para passar em `.subscribe(cb)`.
// label: identifica o canal nos logs (ex: 'tickets-realtime', 'chat-ti-42').
// dotElId (opcional): id de um elemento (bolinha) no DOM cuja cor reflete o
// status da conexão — verde=conectado, vermelho=erro/timeout, amarelo=demais
// estados (ex: conectando). Mesmo esquema de cores usado no indicador
// "AO VIVO" do painel de logs, agora reutilizável em qualquer painel.
export function rtStatusHandler(label, dotElId) {
  return (status, err) => {
    const ts = new Date().toLocaleTimeString('pt-BR');
    if (status === 'SUBSCRIBED') {
      console.info(`[realtime:${label}] conectado às ${ts}`);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[realtime:${label}] falhou (${status}) às ${ts}`, err || '');
    } else if (status === 'CLOSED') {
      console.info(`[realtime:${label}] canal fechado às ${ts}`);
    }
    if (!dotElId) return;
    const dot = document.getElementById(dotElId);
    if (!dot) return;
    if (status === 'SUBSCRIBED') {
      dot.style.background = '#22c55e';
      dot.style.boxShadow = '0 0 6px #22c55e88';
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      dot.style.background = '#ef4444';
      dot.style.boxShadow = 'none';
    } else {
      dot.style.background = '#eab308';
      dot.style.boxShadow = 'none';
    }
  };
}
