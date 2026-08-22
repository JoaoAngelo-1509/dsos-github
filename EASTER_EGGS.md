# DSos — Guia de Easter Eggs

Lista de todos os easter eggs escondidos no sistema, onde encontrá-los e como ativá-los. Documentado a partir do código-fonte (`js/painel-ti.js`, `html/*.html`) — se algo aqui parar de funcionar depois de uma alteração, é sinal de regressão, não de doc desatualizada.

## 1. Rickelme — 5 cliques na logo

**Onde:** `login.html`, `painel-pc.html`, `painel-ti.html`, `painel-logs.html` (todas as telas)

**Como ativar:** clique 5 vezes seguidas na logo/título no topo da página (`#egg-trigger`), em até **1,5s** entre cada clique. Se passar desse intervalo, a contagem zera.

**Efeito:** abre um card sobre a tela com uma foto, o nome "Rickelme" e a frase "Eu não fiz o design, eu sou o desing!". Fecha clicando fora ou apertando `Esc`.

**Implementação:** duplicada em cada página — cada HTML tem seu próprio script inline com a mesma lógica (`_eggClicks`/`_abrirEgg`), exceto no painel T.I. onde vive dentro de `js/painel-ti.js`.

---

## 2. Modo Corinthians — Konami Code

**Onde:** `painel-ti.html` apenas

**Como ativar:** digite a sequência clássica do Konami Code em qualquer lugar da página (não precisa estar em um campo de texto):

```
↑ ↑ ↓ ↓ ← → ← → B A Enter
```

**Efeito:** notificação "🖤🤍 MODO CORINTHIANS ATIVADO! Vai Timão! 🏆" e a página inteira recebe um filtro `grayscale(1) contrast(1.2)`.

**Código:** `js/painel-ti.js` — array `_konami` + listener de `keydown` comparando tecla a tecla.

---

## 3. "corinthians" na busca de chamados

**Onde:** `painel-ti.html`, aba **Chamados → Não Respondidos**, campo de busca (`#unresp-search`)

**Como ativar:** digite exatamente `corinthians` no campo de busca.

**Efeito:** o campo é limpo, aparece a notificação "🖤🤍 VAI CORINTHIANS! Campeão do mundo 2000! 🏆", e o card da lista pisca com uma borda preto/branco por 2 segundos.

---

## 4. Ordens Paranormais (RPG)

**Onde:** `painel-ti.html` apenas

**Como ativar:** com o foco **fora** de qualquer campo de input/textarea/select, digite a palavra `ordem` (tolerância de 2s entre teclas). Isso abre um modal com 5 cartas de "ordens" para escolher.

**As 5 ordens disponíveis** (cada uma aplica um tema visual completo + animação de fundo em `<canvas>` reativa ao mouse):

| Ordem | Emoji | Tema |
|---|---|---|
| Sangue | 🩸 | Veias pulsantes, vinheta vermelha, "batimento" visual |
| Morte | — | Estética fúnebre (drift + tick) |
| Conhecimento | — | Glow + scanlines |
| Energia | — | Faíscas e bordas elétricas |
| Medo | — | Flicker + vinheta + "olho" |

**Efeito:** o tema escolhido fica **fixo** (`data-op-locked="1"`) até você abrir o modal de novo e remover a ordem ativa — inclusive sobrevive a um F5 (persistido). É incompatível com o Modo Hacker (um substitui o outro).

**Código:** `js/painel-ti.js`, array `_OP_ORDENS` (~linha 1624) e função `_aplicarOpOrdem`.

---

## 5. Triplo clique no KPI "Resolvidos hoje"

**Onde:** `painel-ti.html`, card de KPI `#kpi-resolvidos`

**Como ativar:** 3 cliques seguidos no card, em até **1,2s**.

**Efeito:** notificação motivacional "💪 Bom trabalho! Continue assim, campeão."

---

## 6. Minigame "Skill Check" (Dead by Daylight)

**Onde:** `painel-ti.html`, integrado ao fluxo real de resolução de chamados

**Como ativar:**
- **Automático:** 30% de chance de aparecer sempre que você marca um chamado como resolvido com tipo "Consertado" (`confirmarResolucao`).
- **Forçado (Modo DBD):** aperte `Shift + G`, solte, e em até 1,5s aperte `K`. Isso ativa/desativa o "Modo DBD", que faz o skill check aparecer em **toda** resolução de chamado, não só 30% das vezes.

**Efeito:** overlay em tela cheia com uma agulha giratória (canvas), estilo idêntico ao jogo *Dead by Daylight*. Você precisa acertar a zona branca (ou a vermelha, para um "grande acerto") apertando `Espaço` no momento certo — **3 acertos seguidos** para liberar a resolução do chamado. Errar reinicia a tentativa (com efeito de "explosão de gerador").

**Código:** `js/painel-ti.js`, bloco a partir de ~linha 3383 (comentário próprio no código descreve o funcionamento).

**Versão standalone para testes:** [`html/skillcheck.html`](html/skillcheck.html) — página solta, não linkada de nenhum lugar do sistema, com painel de controles (dificuldade, velocidade da agulha, estatísticas). Só é acessível abrindo o arquivo diretamente; serve para testar o minigame isolado do fluxo de chamados.

---

## Resumo rápido

| Easter egg | Página(s) | Gatilho |
|---|---|---|
| Rickelme | Login, PC, T.I., Logs | 5 cliques na logo (≤1,5s) |
| Modo Corinthians | T.I. | Konami Code |
| "corinthians" na busca | T.I. | Digitar na busca de chamados |
| Ordens Paranormais | T.I. | Digitar "ordem" fora de um input |
| KPI motivacional | T.I. | 3 cliques no KPI "Resolvidos hoje" (≤1,2s) |
| Skill Check (DBD) | T.I. | 30% ao resolver como "Consertado", ou `Shift+G` → `K` |
| Skill Check standalone | `html/skillcheck.html` | Abrir o arquivo diretamente |
