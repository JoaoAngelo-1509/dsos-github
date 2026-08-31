// DSos — reportar-problema.js
// ── Canal de feedback dentro do sistema ────────────────────────────────────
//
// Uso (uma linha, em qualquer painel):
//     import { initReportarProblema } from './reportar-problema.js';
//     initReportarProblema();
//
// O módulo injeta sozinho o botão flutuante e o modal — nenhum dos painéis
// precisa de markup novo no HTML. Isso é de propósito: são três telas com
// estruturas muito diferentes, e replicar o mesmo bloco em cada uma
// garantiria que uma delas ficasse para trás na primeira alteração.
//
// ── SEGURANÇA ──────────────────────────────────────────────────────────────
// A escrita passa por `rpc_reportar_problema`, que valida o token de sessão e
// copia a identidade DA SESSÃO — nada do que este arquivo manda sobre "quem
// sou eu" é levado em conta pelo banco. Ver docs/regras-de-acesso.md.
//
// ── PRIVACIDADE ────────────────────────────────────────────────────────────
// A captura de tela é OPT-IN e vem desmarcada. O motivo está escrito na
// própria tela: a captura pode conter dados de outro aluno (um chamado aberto
// ao lado, um nome numa lista). Nunca inverta esse padrão sem revisar a
// política de privacidade.
//
// ── html2canvas ────────────────────────────────────────────────────────────
// Carregado sob demanda de js/vendor/html2canvas.min.js — vendorizado, não de
// CDN, porque a CSP do netlify.toml permite script apenas de 'self' (mais
// jsdelivr/unpkg, que preferimos não usar em runtime). Se o arquivo não
// existir, o módulo continua funcionando: a caixa de captura fica desativada
// com um aviso, e o reporte de texto segue normal.

import { SB_URL, SB_KEY } from './supabase-config.js';

const CHAVE_SESSAO = 'dsos_session';
const VENDOR_H2C   = '../js/vendor/html2canvas.min.js';
const VERSAO_APP   = '2.0';

// Limites da captura. Mantidos folgados abaixo do teto de 1,2 MB que a RPC
// impõe: reduzir para 1024px e gravar JPEG 0.55 costuma render 120–300 KB.
const LARGURA_MAX  = 1024;
const QUALIDADE    = 0.55;

let montado = false;
let ultimoFoco = null;
let h2cEstado = 'nao-carregado';   // nao-carregado | carregando | ok | ausente

// ── Sessão ─────────────────────────────────────────────────────────────────
function sessao() {
  try {
    const bruto = sessionStorage.getItem(CHAVE_SESSAO);
    return bruto ? JSON.parse(bruto) : null;
  } catch (_) {
    return null;   // sessão corrompida não pode derrubar a página inteira
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Contexto técnico coletado automaticamente ──────────────────────────────
// Tudo o que entra aqui é MOSTRADO ao usuário antes do envio. Nada de coleta
// silenciosa: se um dado não couber na lista da tela, ele não deve ser
// coletado.
function contexto() {
  const s = sessao();
  return {
    url:        location.pathname + location.search,
    papel:      s?.tipo || '—',
    userAgent:  navigator.userAgent.slice(0, 300),
    viewport:   `${window.innerWidth}x${window.innerHeight}`,
    versao:     VERSAO_APP,
  };
}

// ── Carregamento sob demanda do html2canvas ────────────────────────────────
function carregarH2C() {
  if (h2cEstado === 'ok' || h2cEstado === 'ausente') return Promise.resolve(h2cEstado);
  if (window.html2canvas) { h2cEstado = 'ok'; return Promise.resolve('ok'); }

  h2cEstado = 'carregando';
  return new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = VENDOR_H2C;
    tag.onload  = () => { h2cEstado = window.html2canvas ? 'ok' : 'ausente'; resolve(h2cEstado); };
    tag.onerror = () => { h2cEstado = 'ausente'; resolve('ausente'); };
    document.head.appendChild(tag);
  });
}

// ── Captura da tela ────────────────────────────────────────────────────────
// O modal é escondido antes de capturar: o usuário quer registrar a tela com
// o problema, não o formulário que ele acabou de abrir por cima dela.
async function capturarTela() {
  if (await carregarH2C() !== 'ok') return null;

  const bg = document.getElementById('dsos-rp-bg');
  const btn = document.getElementById('dsos-rp-btn');
  // `visibility` e não `display`: esconder por display forçaria reflow e
  // mudaria a própria tela que estamos tentando fotografar.
  if (bg)  bg.style.visibility = 'hidden';
  if (btn) btn.style.visibility = 'hidden';

  try {
    const canvas = await window.html2canvas(document.body, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#111',
      scale: 1,
      logging: false,
      useCORS: true,
      // Só a área visível: a página inteira rolada geraria uma imagem enorme
      // e, no painel T.I., traria listas que o técnico não precisa ver.
      width:  window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
    });

    const escala = Math.min(1, LARGURA_MAX / canvas.width);
    let final = canvas;
    if (escala < 1) {
      final = document.createElement('canvas');
      final.width  = Math.round(canvas.width  * escala);
      final.height = Math.round(canvas.height * escala);
      const ctx = final.getContext('2d');
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(canvas, 0, 0, final.width, final.height);
    }
    return final.toDataURL('image/jpeg', QUALIDADE);
  } catch (e) {
    console.warn('[reportar-problema] falha ao capturar a tela:', e?.message || e);
    return null;
  } finally {
    // String vazia devolve o controle à folha de estilo — é o que restaura o
    // estado anterior, seja ele qual for.
    if (bg)  bg.style.visibility = '';
    if (btn) btn.style.visibility = '';
  }
}

// ── Envio ──────────────────────────────────────────────────────────────────
async function enviar(descricao, comCaptura) {
  const s = sessao();
  if (!s?.token) throw new Error('Sua sessão expirou. Entre novamente para reportar.');

  const ctx = contexto();
  const screenshot = comCaptura ? await capturarTela() : null;

  const resp = await fetch(`${SB_URL}/rest/v1/rpc/rpc_reportar_problema`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_token:      s.token,
      p_descricao:  descricao,
      p_url:        ctx.url,
      p_user_agent: ctx.userAgent,
      p_viewport:   ctx.viewport,
      p_versao_app: ctx.versao,
      p_screenshot: screenshot,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    // A RPC comunica erro de regra por RAISE EXCEPTION; a mensagem é escrita
    // para o usuário final e pode ser mostrada como está.
    throw new Error(err?.message || `Não foi possível enviar (HTTP ${resp.status}).`);
  }

  return { id: await resp.json(), comCaptura: !!screenshot, pediuCaptura: comCaptura };
}

// ── Markup ─────────────────────────────────────────────────────────────────
function montar() {
  if (montado || document.getElementById('dsos-rp-btn')) return;
  montado = true;

  const btn = document.createElement('button');
  btn.id = 'dsos-rp-btn';
  btn.className = 'dsos-rp-btn';
  btn.type = 'button';
  btn.title = 'Reportar um problema no sistema';
  btn.setAttribute('aria-label', 'Reportar um problema no sistema');
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>
    </svg>
    <span>Reportar problema</span>`;
  btn.addEventListener('click', abrir);
  document.body.appendChild(btn);

  const ctx = contexto();
  const bg = document.createElement('div');
  bg.id = 'dsos-rp-bg';
  bg.className = 'dsos-rp-bg';
  bg.innerHTML = `
    <div class="dsos-rp-modal" role="dialog" aria-modal="true" aria-labelledby="dsos-rp-titulo">
      <div class="dsos-rp-head">
        <h2 id="dsos-rp-titulo">Reportar um problema</h2>
        <button type="button" class="dsos-rp-x" id="dsos-rp-fechar" aria-label="Fechar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <p class="dsos-rp-hint">
        Achou um erro, algo que não funciona ou uma tela confusa? Conte aqui.
        Isso vai para a equipe de T.I. — não é um chamado de manutenção de
        computador.
      </p>

      <label class="dsos-rp-label" for="dsos-rp-desc">O que aconteceu?</label>
      <textarea id="dsos-rp-desc" class="dsos-rp-textarea" maxlength="2000"
                placeholder="Ex.: cliquei em resolver o chamado #12 e a tela ficou carregando para sempre."
                aria-describedby="dsos-rp-contador"></textarea>
      <div class="dsos-rp-contador" id="dsos-rp-contador"><span id="dsos-rp-num">0</span>/2000</div>

      <label class="dsos-rp-check" for="dsos-rp-shot">
        <input type="checkbox" id="dsos-rp-shot" />
        <span>
          <strong>Anexar uma captura da tela atual</strong>
          <em id="dsos-rp-shot-aviso">A imagem pode conter dados de outras pessoas que estejam
          visíveis agora. Só marque se a tela ajudar a explicar o problema.</em>
        </span>
      </label>

      <details class="dsos-rp-ctx">
        <summary>Enviado junto, automaticamente</summary>
        <ul>
          <li><span>Página</span><code>${esc(ctx.url)}</code></li>
          <li><span>Papel</span><code>${esc(ctx.papel)}</code></li>
          <li><span>Tela</span><code>${esc(ctx.viewport)}</code></li>
          <li><span>Versão</span><code>${esc(ctx.versao)}</code></li>
          <li><span>Navegador</span><code>${esc(ctx.userAgent.slice(0, 90))}…</code></li>
        </ul>
        <p>Seu nome e login também são registrados, para o T.I. poder responder.</p>
      </details>

      <div class="dsos-rp-erro" id="dsos-rp-erro" role="alert"></div>

      <div class="dsos-rp-acoes">
        <button type="button" class="dsos-rp-cancelar" id="dsos-rp-cancelar">Cancelar</button>
        <button type="button" class="dsos-rp-enviar" id="dsos-rp-enviar">Enviar reporte</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const $ = (id) => document.getElementById(id);

  $('dsos-rp-desc').addEventListener('input', (e) => {
    $('dsos-rp-num').textContent = e.target.value.length;
  });

  $('dsos-rp-fechar').addEventListener('click', fechar);
  $('dsos-rp-cancelar').addEventListener('click', fechar);
  $('dsos-rp-enviar').addEventListener('click', submeter);
  bg.addEventListener('click', (e) => { if (e.target === bg) fechar(); });

  // Esc fecha; Tab circula dentro do modal enquanto ele está aberto.
  bg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); fechar(); return; }
    if (e.key !== 'Tab') return;
    const foco = bg.querySelectorAll('button, textarea, input, summary, a[href]');
    if (!foco.length) return;
    const primeiro = foco[0], ultimo = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  });

  // Só descobrimos se a captura está disponível quando o modal abre pela
  // primeira vez — carregar a biblioteca no load da página custaria a todo
  // mundo por um recurso que a maioria nunca usa.
  bg.addEventListener('dsos-rp-abriu', async () => {
    const caixa = $('dsos-rp-shot');
    if (h2cEstado === 'ok') return;
    const estado = await carregarH2C();
    if (estado !== 'ok') {
      caixa.checked = false;
      caixa.disabled = true;
      $('dsos-rp-shot-aviso').textContent =
        'Captura indisponível nesta instalação (js/vendor/html2canvas.min.js não encontrado). ' +
        'O reporte de texto funciona normalmente.';
    }
  });
}

// ── Abrir / fechar ─────────────────────────────────────────────────────────
function abrir() {
  const bg = document.getElementById('dsos-rp-bg');
  if (!bg) return;
  ultimoFoco = document.activeElement;
  document.getElementById('dsos-rp-erro').textContent = '';
  bg.classList.add('open');
  bg.dispatchEvent(new CustomEvent('dsos-rp-abriu'));
  setTimeout(() => document.getElementById('dsos-rp-desc')?.focus(), 40);
}

function fechar() {
  const bg = document.getElementById('dsos-rp-bg');
  if (!bg) return;
  bg.classList.remove('open');

  // Devolve o foco a quem abriu o modal. O fallback para o próprio botão
  // importa: se o modal foi aberto por atalho ou por chamada de código,
  // `ultimoFoco` pode ser o <body>, e focá-lo deixaria o usuário de teclado
  // no começo da página em vez de onde estava.
  const alvo = (ultimoFoco && document.contains(ultimoFoco) && ultimoFoco !== document.body)
    ? ultimoFoco
    : document.getElementById('dsos-rp-btn');
  alvo?.focus();
}

// ── Submissão ──────────────────────────────────────────────────────────────
async function submeter() {
  const desc  = document.getElementById('dsos-rp-desc');
  const shot  = document.getElementById('dsos-rp-shot');
  const btn   = document.getElementById('dsos-rp-enviar');
  const erro  = document.getElementById('dsos-rp-erro');

  const texto = desc.value.trim();
  erro.textContent = '';

  if (texto.length < 5) {
    erro.textContent = 'Descreva o problema com um pouco mais de detalhe.';
    desc.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = shot.checked ? 'Capturando…' : 'Enviando…';

  try {
    const r = await enviar(texto, shot.checked);
    fechar();
    desc.value = '';
    shot.checked = false;
    document.getElementById('dsos-rp-num').textContent = '0';
    aviso(
      r.pediuCaptura && !r.comCaptura
        ? `Reporte #${r.id} enviado — a captura de tela falhou, mas o texto chegou.`
        : `Reporte #${r.id} enviado. Obrigado!`
    );
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível enviar. Tente novamente.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar reporte';
  }
}

// Aviso próprio, e não o `toast` de ui.js nem o `showNotif` do painel-logs:
// os três painéis têm mecanismos de notificação diferentes e nem todos
// possuem o markup que os outros esperam. Um elemento próprio é a única
// forma de este módulo funcionar igual nas três telas.
function aviso(msg) {
  let el = document.getElementById('dsos-rp-aviso');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dsos-rp-aviso';
    el.className = 'dsos-rp-aviso';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 5000);
}

// ── API pública ────────────────────────────────────────────────────────────
export function initReportarProblema() {
  // Sem sessão não há como reportar: a RPC exige token. Some o botão em vez
  // de oferecer algo que falharia no envio.
  if (!sessao()?.token) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar, { once: true });
  } else {
    montar();
  }
}

export { abrir as abrirReportarProblema };
