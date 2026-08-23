// DSos — Realtime Manager
// Utilitário central para diagnosticar o status dos canais Supabase Realtime
// usados em painel-ti.js, painel-pc.js e painel-logs.js. Não altera o
// comportamento dos canais — apenas padroniza o log de conexão/erro/queda,
// facilitando o diagnóstico de "por que uma tela não está atualizando sozinha".

// Retorna um callback pronto para passar em `.subscribe(cb)`.
// label: identifica o canal nos logs (ex: 'tickets-realtime', 'chat-ti-42').
export function rtStatusHandler(label) {
  return (status, err) => {
    const ts = new Date().toLocaleTimeString('pt-BR');
    if (status === 'SUBSCRIBED') {
      console.info(`[realtime:${label}] conectado às ${ts}`);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[realtime:${label}] falhou (${status}) às ${ts}`, err || '');
    } else if (status === 'CLOSED') {
      console.info(`[realtime:${label}] canal fechado às ${ts}`);
    }
  };
}
