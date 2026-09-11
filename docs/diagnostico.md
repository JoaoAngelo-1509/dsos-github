# DSos — Central de Diagnóstico

Página de diagnóstico do sistema: reúne num lugar só as verificações das
principais partes do DSos e mostra, para cada uma, **APROVADO ✅ / FALHOU ❌ /
AVISO ⚠️ / ERRO 💥**, com mensagem e detalhe. Não substitui as suítes de
`tests/` — é o **"o sistema está saudável agora?"** rodando no runtime real do
navegador (REST, Edge Functions, WebSocket do Realtime, CSP, funções puras de
UI).

## Arquivos

```
html/diagnostico.html   página (isolada; não usa markup de painel)
js/diagnostico.js       catálogo de testes + runner + UI
css/diagnostico.css     estilos próprios (não usa base.css/tokens.css)
```

Nenhum JS de painel foi tocado. A página monta o header de cada requisição à
mão e **não** instala o interceptor de `sessao-header.js`, de propósito: assim
controla "com token" x "sem token" sem herdar o token da aba.

## Como rodar

É ferramenta de DEV e **não vai ao ar** (ver [Exposição](#exposição)). Rode
localmente, servindo os arquivos por HTTP (módulos ES não rodam em `file://`):

```bash
npx serve .
```

Abra `http://localhost:8080/html/diagnostico.html`. O import de
`./supabase-config.js` aponta para o banco de **produção** — os testes seguros
podem rodar contra produção sem risco; para o **modo de escrita**, prefira
apontar o config ao banco de teste (ver [WORKFLOW.md](../WORKFLOW.md)).

- **Executar todos** — roda o catálogo inteiro em sequência.
- **▶** em cada linha — roda só aquele teste. **Rodar categoria** — roda a seção.
- **Exportar resultados (JSON)** — baixa a última corrida (também guardada em
  `localStorage`, per-origin; nada sai do navegador).
- **Modo de escrita** — ver abaixo.

## Segurança dos testes

Por padrão só rodam testes de **leitura** e **negativos**, seguros por
construção: ler uma tabela fechada e exigir recusa; tentar escrever com token
forjado e exigir recusa; `PATCH` em `id=-1`, que nunca casa linha. Nenhum
altera dado.

O **Modo de escrita** (desligado por padrão) habilita:

| Teste | O que faz | Reversível? |
|---|---|---|
| Chamada real à Groq | 1 requisição mínima com a sessão atual | consome só cota |
| Ciclo completo PC | cadastra PC `ZZTESTE-`, loga, abre chamado, manda mensagem, lê de volta com/sem token | sim — `rpc_deletar_pc` cascateia e limpa tudo no `finally` |

Se a limpeza do ciclo falhar, o resultado diz qual `ZZTESTE-…` apagar à mão.

## Categorias cobertas

| Categoria | Exemplos |
|---|---|
| Ambiente & Configuração | config carregado, formato do JWT, prod x teste, sessão, CSP |
| Conexão & APIs | PostgREST, `realtime_sinal`, preflight de `groq-proxy`/`fn-limpar-dados`, `fn-enviar-otp` removida (404) ou stub 410 |
| Autenticação | os 3 logins recusam credencial inválida sem vazar; `rpc_sessao_valida` |
| Permissões & RLS | `sessao_token`/`pc_senha`/`senha_hash`/`senha` inacessíveis; `ticket`/`mensagem` fechados sem token; views não vazam senha; RPCs recusam token forjado; **L2/L4 fechadas** (logs e presença exigem sessão de T.I.) |
| Sessão | `rpc_sessao_ping` sem/forjado → null e não grava presença; `rpc_sessao_encerrar` |
| Realtime | assina `realtime_sinal` pelo WebSocket real (SUBSCRIBED) |
| Formulários & Utilidades | `escapeHtml`, `statusLabel`, `tipoIcon` |
| Arquivos / Storage | API de Storage no ar; **lacuna L3** (bucket público) sinalizada |
| Escrita (opt-in) | Groq real, ciclo completo PC |

As lacunas **conhecidas** saem como **⚠️ aviso**: hoje só **L3** (bucket
público) continua aberta. **L2** (logs legíveis) e **L4** (presença legível)
foram fechadas em 11/09/2026 — seus testes agora passam em ✅ e viram ❌ se a
brecha reabrir. Ver [regras-de-acesso.md §5](regras-de-acesso.md).

## Exposição

A página revela o modelo de autorização e as lacunas em aberto, e só é útil com
uma sessão — não deve ser servida no mesmo domínio da aplicação. `netlify.toml`
devolve **404 com `force = true`** para `/html/diagnostico.html` e
`/js/diagnostico.js` (mesmo padrão de `/tests`, `/docs`, `/supabase`). É
redução de exposição, não segredo — o repositório é público no GitHub.

## O que não é coberto

- Funções acopladas ao DOM/módulo (`_similaridade` de duplicata em `painel-pc`,
  fingerprint de `logging`): não são exportadas; testá-las exigiria extraí-las
  do módulo. Mesmo registro de [tests/README.md](../tests/README.md).
- Fluxo completo de UI (clicar pela tela). O ciclo de escrita cobre o caminho
  de dados de ponta a ponta, mas não os cliques.

## Relação com `tests/`

As suítes de `tests/` continuam sendo a regressão de linha de comando (CI, sem
navegador). Este painel é o diagnóstico visual e de runtime. Há sobreposição
proposital nos testes negativos de RLS — é onde mais dói uma regressão passar.
