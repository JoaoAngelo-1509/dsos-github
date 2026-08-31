# 01 — Diagrama de casos de uso

**Fonte:** `README.md` (funcionalidades), `html/painel-pc.html`,
`html/painel-ti.html`, `html/painel-logs.html`, `js/painel-*.js`,
`docs/regras-de-acesso.md`.

Atores são **papéis**, não pessoas. A conta dupla T.I.+Professor é uma pessoa
que assume dois papéis — por isso aparece herdando dos dois.

```mermaid
graph LR
  %% ── ATORES ──────────────────────────────────────────────
  aluno(("Aluno<br/>login do PC"))
  prof(("Professor"))
  ti(("Técnico T.I."))
  dupla(("Conta dupla<br/>T.I. + Professor"))
  ia(("Groq<br/>ator de sistema"))

  %% ── CASOS DE USO ────────────────────────────────────────
  subgraph SIS["Sistema DSos"]
    direction TB

    subgraph UC_ACESSO["Acesso"]
      login["Autenticar-se"]
      escolher["Escolher papel<br/>ao entrar"]
      sair["Encerrar sessão"]
    end

    subgraph UC_CHAMADO["Ciclo do chamado"]
      abrir["Abrir chamado"]
      emerg["Abrir chamado<br/>de emergência"]
      acompanhar["Acompanhar<br/>meus chamados"]
      conversar["Conversar no chat<br/>do chamado"]
      anexar["Anexar imagem<br/>upload ou câmera"]
      avaliar["Avaliar atendimento<br/>1 a 5 estrelas"]
    end

    subgraph UC_ATEND["Atendimento"]
      triar["Triar fila<br/>de chamados"]
      assumir["Assumir chamado"]
      resolver["Registrar resolução"]
      falso["Marcar<br/>falso alarme"]
      reabrir["Reabrir chamado"]
      nota["Registrar<br/>nota interna"]
      descartar["Enviar equipamento<br/>para descarte"]
      confirmar["Confirmar descarte<br/>físico (PNRS)"]
    end

    subgraph UC_GESTAO["Gestão"]
      gerirpc["Gerir computadores"]
      gerirprof["Gerir professores"]
      gerirti["Gerir equipe T.I."]
      presenca["Definir presença"]
    end

    subgraph UC_AUD["Auditoria"]
      verlogs["Consultar logs<br/>e dashboard"]
      exportar["Exportar CSV / PDF"]
      relatorio["Gerar relatório<br/>semanal por IA"]
      limpar["Limpar logs antigos"]
    end

    subgraph UC_IA["Assistência por IA"]
      validanome["Validar nome<br/>informado"]
      classificar["Classificar tipo<br/>e prioridade"]
      sugerir["Sugerir solução<br/>ao solicitante"]
      duplicado["Detectar chamado<br/>duplicado"]
      resumir["Resumir chamado<br/>e sugerir resposta"]
    end
  end

  %% ── QUEM FAZ O QUÊ ──────────────────────────────────────
  aluno --> login
  aluno --> abrir
  aluno --> acompanhar
  aluno --> conversar
  aluno --> anexar
  aluno --> avaliar
  aluno --> sair

  prof --> login
  prof --> abrir
  prof --> emerg
  prof --> acompanhar
  prof --> conversar
  prof --> anexar
  prof --> avaliar
  prof --> sair

  ti --> login
  ti --> triar
  ti --> assumir
  ti --> resolver
  ti --> falso
  ti --> reabrir
  ti --> nota
  ti --> descartar
  ti --> confirmar
  ti --> conversar
  ti --> anexar
  ti --> gerirpc
  ti --> gerirprof
  ti --> gerirti
  ti --> presenca
  ti --> verlogs
  ti --> exportar
  ti --> relatorio
  ti --> limpar
  ti --> sair

  dupla -.->|é um| ti
  dupla -.->|é um| prof
  dupla --> escolher

  %% ── IA COMO ATOR DE SISTEMA ─────────────────────────────
  validanome --> ia
  classificar --> ia
  sugerir --> ia
  resumir --> ia
  relatorio --> ia

  %% ── RELAÇÕES ENTRE CASOS ────────────────────────────────
  login -.->|include| validanome
  abrir -.->|include| classificar
  abrir -.->|include| duplicado
  abrir -.->|extend| sugerir
  emerg -.->|extend| abrir
  resolver -.->|extend| descartar
  descartar -.->|include| confirmar
  triar -.->|extend| resumir

  classDef ator fill:#0b3d4d,stroke:#06b6d4,color:#e8f6fa
  classDef uc fill:#1b1b1b,stroke:#c0171a,color:#f0f0f0
  class aluno,prof,ti,dupla,ia ator
```

## Leitura do diagrama

### O que cada ator pode fazer

| Ator | Escopo |
|---|---|
| **Aluno (PC)** | Abre chamado **para o próprio computador**, acompanha só os chamados em que o PC dele é origem ou alvo, conversa no chat e avalia o atendimento. Não abre emergência. |
| **Professor** | Tudo do aluno, **mais** a escolha entre chamado normal e chamado de emergência para outro computador, identificado pela tag. Enxerga os chamados cujo `nome_solicitante` é o nome dele. |
| **Técnico T.I.** | Único que atende, gerencia inventário e pessoas, e acessa auditoria. Enxerga todos os chamados. |
| **Conta dupla** | Escolhe no login em qual painel entrar. Para o banco, continua sendo T.I. nos dois casos (ver [regras-de-acesso, seção 1](../regras-de-acesso.md#1-papéis)). |
| **Groq (IA)** | Ator de sistema, não usuário. Nunca inicia nada: sempre é chamada por um caso de uso, via Edge Function `groq-proxy`. |

### Relações `include` e `extend`

* `Autenticar-se` **include** `Validar nome` — a validação do nome informado
  acontece antes de qualquer tentativa de login, e uma falha da IA não bloqueia
  o acesso (o código assume "nome válido" em caso de erro).
* `Abrir chamado` **include** `Classificar` e `Detectar duplicado` — os dois
  são obrigatórios no caminho feliz. A classificação pode **abortar** a
  abertura, se a IA responder `falso`.
* `Abrir chamado` **extend** `Sugerir solução` — a sugestão só aparece para
  algumas prioridades; em emergência e falso alarme, a IA é instruída a não
  sugerir nada.
* `Descartar` **include** `Confirmar descarte físico` — a fila de descarte só
  fecha quando o técnico registra o meio de descarte, que é o que dá
  rastreabilidade PNRS (Lei 12.305/2010).

### O que o diagrama deixa de fora, de propósito

* **Easter eggs e o minigame Skill Check.** São funcionalidades reais e
  documentadas ([EASTER_EGGS.md](../../EASTER_EGGS.md)), mas não são caso de uso
  do domínio — não existe objetivo de negócio por trás.
* **Modo Hacker e tema claro/escuro.** Preferência de exibição, não caso de uso.
* **Anônimo.** Não é ator: não existe caso de uso destinado a quem não fez
  login. O que um anônimo *consegue* fazer apesar disso está catalogado como
  lacuna em [regras-de-acesso, seção 5](../regras-de-acesso.md#5-lacunas-conhecidas-e-risco-residual).
