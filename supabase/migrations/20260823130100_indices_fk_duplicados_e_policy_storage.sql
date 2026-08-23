-- DB-02 · DB-04 · SEC-10 (auditoria DSos)
--
-- DB-02: chaves estrangeiras sem índice de cobertura. JOINs e DELETEs em
-- cascata nessas colunas faziam varredura sequencial na tabela
-- referenciada. As 6 colunas abaixo foram confirmadas ao vivo consultando
-- pg_constraint contra pg_index (nenhum índice com a coluna da FK na
-- primeira posição) — batem exatamente com o que o advisor de performance
-- do Supabase reportava.
CREATE INDEX IF NOT EXISTS idx_mensagem_ticket_id           ON public.mensagem (ticket_id);
CREATE INDEX IF NOT EXISTS idx_professor_ti_id              ON public.professor (ti_id);
CREATE INDEX IF NOT EXISTS idx_ticket_pc_origem             ON public.ticket (pc_origem);
CREATE INDEX IF NOT EXISTS idx_ticket_pc_problema           ON public.ticket (pc_problema);
CREATE INDEX IF NOT EXISTS idx_ticket_tecnico_responsavel   ON public.ticket (tecnico_responsavel);
CREATE INDEX IF NOT EXISTS idx_usuario_ti_professor_id      ON public.usuario_ti (professor_id);

-- DB-04: índices duplicados (mesma tabela, mesmas colunas). Confirmados
-- comparando pg_index.indkey — 3 pares exatos. Mantido o nome mais
-- descritivo de cada par; removido o redundante. Índice duplicado custa
-- escrita e espaço sem entregar nada em leitura.
DROP INDEX IF EXISTS public.idx_acesso_timestamp;         -- == idx_acesso_log_timestamp
DROP INDEX IF EXISTS public.idx_acesso_log_usuario;       -- == idx_acesso_log_usuario_id
DROP INDEX IF EXISTS public.idx_atividades_timestamp;     -- == idx_atividades_log_timestamp

-- SEC-10: duas policies de INSERT idênticas no bucket chat-prints
-- (mesma condição bucket_id='chat-prints', mesmo comando, mesmas roles) —
-- sobra de iterações anteriores de migration. Sem efeito funcional, só
-- ruído para quem for auditar as policies depois. Mantida
-- chat_prints_upload (nome consistente com o padrão snake_case do resto).
DROP POLICY IF EXISTS "chat-prints-insert" ON storage.objects;
