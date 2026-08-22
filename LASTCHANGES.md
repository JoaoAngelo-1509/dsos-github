# Últimas alterações — DSos v2.0

## 2026-08-22 — Deploy e correção de modelo de IA

- **Deploy migrado para Netlify**: `vercel.json` substituído por `netlify.toml` (mesmos rewrites de URL e headers de segurança)
- **Migração de modelo Groq**: `llama-3.3-70b-versatile` (descontinuado, retornava respostas vazias por excesso de reasoning) completamente substituído por `openai/gpt-oss-20b` em `auth.js`, `painel-pc.js`, `painel-ti.js`, `painel-logs.js` e no default do `groq-proxy` — **todos os 5 pontos sincronizados**
- Prompts otimizados para responder sempre em português brasileiro e evitar reasoning desnecessário
- Limites de tokens aumentados: auth (200), painel-pc (2048), painel-ti-resumo (256), painel-ti-sugestao (512), painel-logs (800)

## v2.0 (Junho 2026)

### Novas funcionalidades
- **SLA em chamados abertos**: cada ticket no painel TI mostra há quanto tempo está aberto (verde < 30min, amarelo 30min–2h, laranja 2h–24h, vermelho > 24h)
- **Dashboard com gráficos**: aba "Dashboard" no Painel de Logs com charts Chart.js — chamados por dia, por tipo, por status, e acessos diários
- **Exportar PDF**: botão de impressão no Painel de Logs para gerar relatórios em PDF diretamente pelo navegador
- **Troca de papel**: técnicos TI que também são professores podem trocar para o modo Professor sem precisar fazer logout
- **Proxy Groq via Edge Function**: `supabase/functions/groq-proxy/` implementado e em uso — move a chave da API Groq para o servidor, usado pela classificação de chamados, validação de nome no login, resumo de tickets e relatório do dashboard
- **Módulo `js/dsos-ui.js`**: popups estilizados (`dsosAlert`/`dsosConfirm`) substituindo `alert`/`confirm` nativos

### Melhorias de UX
- "Esqueceu a senha? Contate o T.I." exibido na tela de login
- Mensagem de ajuda atualizada com instrução sobre recuperação de senha
- Tooltips nos botões destrutivos (remover PC, remover usuário, apagar logs)
- Mensagens de erro padronizadas em todas as telas

### Segurança
- `professor_id` agora armazenado na sessão para usuários com conta dupla TI+Professor
- Documentação sobre a chave da Groq (`GROQ_KEY`, secret da Edge Function) adicionada ao `SETUP.md`
- Privilégios de coluna reforçados em `public.pc` (coluna `senha` não fica exposta via REST) — mesma proteção já aplicada em `usuario_ti`

## v1.2.0 (Março 2026)

- Confirmação antes de ações destrutivas (deletar PC, usuário, professor)
- Botão de cancelar fila de descarte
- Correção: logout duplo em sessões inativas

## v1.1 (Fevereiro 2026)

- Easter egg: logo do CPS + Konami code
- Modo escuro persistido por `localStorage`
- Minijogo Dead by Daylight ao resolver chamados

## v1.0 (Janeiro 2026)

- Lançamento inicial do sistema
- Ticketing com chat em tempo real
- Classificação de prioridade via Groq AI (LLaMA 3.1)
- Painel de auditoria de logs
- Gerenciamento de PCs e usuários TI
