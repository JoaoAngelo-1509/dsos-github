# 03 — Diagrama de componentes

**Fonte:** `js/README.md`, os `import` reais de cada módulo, `netlify.toml`,
`scripts/netlify-build.sh`, `supabase/functions/groq-proxy/index.ts`.

O DSos é **100% estático**: não há build step, bundler nem framework. Cada
página HTML carrega ES modules diretamente do navegador.

```mermaid
graph TB
  subgraph NAV["Navegador"]
    direction TB

    subgraph PAGS["Páginas"]
      idx["index.html<br/><i>consentimento</i>"]
      login["html/login.html"]
      ppc["html/painel-pc.html"]
      pti["html/painel-ti.html"]
      plog["html/painel-logs.html"]
      p404["404.html"]
    end

    subgraph CTRL["Controladores de página"]
      auth["js/auth.js"]
      cpc["js/painel-pc.js"]
      cti["js/painel-ti.js"]
      clog["js/painel-logs.js"]
    end

    subgraph COMPART["Módulos compartilhados"]
      cfg["js/supabase-config.js<br/><i>gerado no build</i>"]
      hdr["js/sessao-header.js<br/><i>intercepta fetch</i>"]
      uiu["js/ui.js"]
      dsui["js/dsos-ui.js"]
      guard["js/session-guard.js"]
      log["js/logging.js"]
      rtm["js/realtime-manager.js"]
      egg["js/easter-egg.js"]
    end

    subgraph EXT["Terceiros no cliente"]
      sbjs["supabase-js<br/><i>CDN jsDelivr, SRI</i>"]
      chart["Chart.js<br/><i>só painel-logs</i>"]
    end
  end

  subgraph SUPA["Supabase"]
    direction TB
    rest["PostgREST<br/>/rest/v1"]
    rtsrv["Realtime<br/>WebSocket"]
    stor["Storage<br/>bucket chat-prints"]
    edge["Edge Function<br/>groq-proxy"]
    pg[("PostgreSQL<br/>RLS + RPCs + triggers")]
  end

  groq["api.groq.com<br/><i>terceiro</i>"]
  netlify["Netlify<br/><i>hospedagem, CSP, rewrites</i>"]

  %% páginas → controladores
  login --> auth
  ppc --> cpc
  pti --> cti
  plog --> clog

  %% controladores → compartilhados
  auth --> cfg & hdr & uiu & dsui & log
  cpc --> cfg & hdr & uiu & dsui & guard & rtm
  cti --> cfg & hdr & uiu & dsui & guard & rtm & log & egg
  clog --> cfg & hdr & uiu & dsui & guard & rtm

  cpc --> sbjs
  cti --> sbjs
  clog --> sbjs & chart

  %% saída para o backend
  hdr -.->|"anexa X-Sessao-Token"| rest
  auth --> rest
  cpc --> rest & stor & edge
  cti --> rest & stor & edge
  clog --> rest & edge
  sbjs --> rtsrv

  rest --> pg
  rtsrv --> pg
  edge --> groq

  netlify -.->|serve| PAGS
  netlify -.->|"gera no build"| cfg

  classDef page fill:#12232b,stroke:#06b6d4,color:#dff
  classDef mod fill:#1b1b1b,stroke:#555,color:#eee
  classDef back fill:#2a1214,stroke:#c0171a,color:#fee
  classDef third fill:#2b2410,stroke:#f97316,color:#fed
  class idx,login,ppc,pti,plog,p404 page
  class auth,cpc,cti,clog,cfg,hdr,uiu,dsui,guard,log,rtm,egg mod
  class rest,rtsrv,stor,edge,pg back
  class groq,sbjs,chart,netlify third
```

## Responsabilidade de cada módulo

| Módulo | Responsabilidade | Quem usa |
|---|---|---|
| `supabase-config.js` | URL + `anon key` + headers padrão. **Não versionado** — gerado por `scripts/netlify-build.sh` a partir de variáveis de ambiente | todos |
| `sessao-header.js` | Intercepta `window.fetch` e anexa `X-Sessao-Token` **só** para hosts `.supabase.co` | todos os controladores |
| `ui.js` | Tema, `toast`, `escapeHtml`, `statusLabel`, ícones por tipo | todos |
| `dsos-ui.js` | `dsosAlert` / `dsosConfirm` — substituem `alert`/`confirm` nativos | todos |
| `session-guard.js` | Logout por inatividade: aviso aos 28 min, logout aos 30 min | painel-pc, painel-ti, painel-logs |
| `logging.js` | Cliente de auditoria; monta o fingerprint do dispositivo | auth, painel-ti |
| `realtime-manager.js` | Handler padronizado de status de canal Realtime | painel-pc, painel-ti, painel-logs |
| `easter-egg.js` | Easter egg dos 5 cliques na logo — fonte única das 4 telas | todas as páginas |

## Interfaces com o backend

| Interface | Protocolo | Autorização |
|---|---|---|
| **PostgREST** `/rest/v1/<tabela>` | HTTPS REST | `anon key` + `X-Sessao-Token`; a RLS decide |
| **PostgREST** `/rest/v1/rpc/<funcao>` | HTTPS POST | `anon key`; as RPCs sensíveis revalidam o token internamente |
| **Realtime** WebSocket | `postgres_changes` na tabela `realtime_sinal` | só `anon key` — **o WebSocket não carrega header**, daí a tabela de sinal |
| **Storage** `/storage/v1/object/chat-prints/*` | HTTPS | `anon key` para upload; **leitura é pública** |
| **Edge Function** `/functions/v1/groq-proxy` | HTTPS POST | só `anon key` — não valida sessão |

## Três decisões de arquitetura que este diagrama torna visíveis

### 1. O interceptor de `fetch` existe porque o config é gerado no build

O lugar "óbvio" para o header seria o objeto de headers em
`supabase-config.js`. Não serve: o arquivo é **gerado na Netlify** a partir de
variáveis de ambiente (editar a cópia local não sobrevive ao deploy), e os
headers são montados no carregamento do módulo, quando o token **ainda não
existe** — o login ainda não aconteceu. Interceptar `fetch` resolve os dois
problemas de uma vez e cobre todos os pontos de saída sem repetir código.

### 2. A Edge Function é a única fronteira com um terceiro

`groq-proxy` existe por um motivo só: manter a `GROQ_KEY` fora do navegador.
Ela não consulta o banco. Em compensação, é por ali que **texto de chamado sai
da infraestrutura da escola** — o que a torna o ponto central da política de
privacidade, e não um detalhe de implementação.

Ela também **não valida sessão**: basta a `anon key` para consumir a cota
(lacuna L7 de [regras-de-acesso](../regras-de-acesso.md#l7--groq-proxy-não-valida-sessão)).

### 3. A CSP da Netlify é parte da arquitetura

`netlify.toml` define, para todas as rotas:

```
script-src  'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com
connect-src 'self' https://*.supabase.co https://api.groq.com wss://*.supabase.co
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
frame-ancestors 'none'
```

Consequência prática: **qualquer biblioteca nova precisa ou estar em
`js/vendor/` (servida do próprio domínio, coberta por `'self'`) ou ter o host
acrescentado à CSP.** Vendorizar é a opção preferida — evita depender de CDN em
tempo de execução e não afrouxa a política.

O `404.html` traz uma CSP própria, mais apertada (sem `unsafe-inline` em
scripts, sem CDN), porque não precisa de nada disso.

## Fluxo de deploy

```mermaid
graph LR
  git["git push"] --> nb["scripts/netlify-build.sh"]
  nb -->|"env vars"| gen["gera js/supabase-config.js"]
  gen --> pub["publish = ."]
  pub --> rw["rewrites de URL limpa<br/>/login, /painel-pc, /painel-ti"]
  rw --> hdrs["headers de segurança<br/>CSP, X-Frame-Options, cache"]
  hdrs --> live["site no ar"]
  rw -.->|"rota inexistente"| e404["404.html — status 404"]
```

A Edge Function **não** entra nesse deploy: ela é publicada à parte com
`supabase functions deploy groq-proxy`, seguindo o fluxo de
[WORKFLOW.md](../../WORKFLOW.md).
