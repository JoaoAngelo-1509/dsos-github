-- Retenção automática dos logs (LGPD) + manutenção leve.
-- Origem: auditoria 11/11/2026 (docs/plano-correcoes.md, itens "Pequenas").
-- Retenção: 180 dias para logs de acesso/atividade; 365 para auditoria e
-- alterações críticas. Ajuste os prazos antes de aplicar se a escola exigir outro.

create extension if not exists pg_cron;

create or replace function public.fn_purgar_logs_antigos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.acesso_log              where "timestamp"  < now() - interval '180 days';
  delete from public.atividades_log          where "timestamp"  < now() - interval '180 days';
  delete from public.audit_log               where "timestamp"  < now() - interval '365 days';
  delete from public.alteracoes_criticas_log where "timestamp"  < now() - interval '365 days';
  delete from public.operacoes_massa_log     where "timestamp"  < now() - interval '365 days';
  delete from public.auditoria_ti            where executado_em < now() - interval '365 days';
  delete from public.login_tentativas        where tentou_em    < now() - interval '1 day';
  delete from public.sessao_token            where expira_em    < now() - interval '1 day';
end;
$$;

revoke execute on function public.fn_purgar_logs_antigos() from public, anon, authenticated;

-- Diariamente às 03:17 (America/Sao_Paulo = 06:17 UTC).
select cron.unschedule('dsos-purga-logs')
  where exists (select 1 from cron.job where jobname = 'dsos-purga-logs');
select cron.schedule('dsos-purga-logs', '17 6 * * *', $$select public.fn_purgar_logs_antigos()$$);

-- Tabelas de alta rotatividade (ping a cada 30 s): autovacuum mais agressivo.
alter table public.sessao_ativa set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 20);
alter table public.sessao_token set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 20);

-- O front escuta só realtime_sinal; tabelas de log publicadas geravam trabalho dobrado.
do $$
declare t text;
begin
  foreach t in array array['auditoria_ti','audit_log','atividades_log','acesso_log','alteracoes_criticas_log','operacoes_massa_log'] loop
    if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
