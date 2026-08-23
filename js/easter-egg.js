// DSos — easter-egg.js
// ── Easter egg dos 5 cliques na logo (fonte única) ──────────────────────────
// Antes deste módulo, o mesmo IIFE de ~15 linhas estava copiado em 4 lugares
// (login.html, painel-pc.html, painel-logs.html e painel-ti.js). Foi
// justamente essa duplicação que permitiu o BUG-16 passar despercebido: a
// cópia de painel-logs.html tinha o script e o gatilho, mas o markup do
// modal (#egg-bg/#egg-img/#egg-nome/#egg-frase) nunca foi copiado junto, e
// clicar 5x lá lançava "TypeError: Cannot set properties of null" em vez de
// abrir o egg.
//
// Por isso o módulo INJETA o próprio markup em vez de depender de cada
// página tê-lo colado corretamente — assim a classe de bug deixa de existir:
// não há como uma página ficar com metade do easter egg.
//
// As classes usadas (.egg-bg/.egg-card/.egg-img/.egg-nome/.egg-frase) já
// vivem em css/base.css, carregado pelas 4 páginas.
//
// Uso: import { initEasterEgg } from './easter-egg.js';  initEasterEgg();
// O elemento gatilho é qualquer um com id="egg-trigger" (a logo/título).

const EGG_FOTO  = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQXzyAvoM6vUPr887008lkLrtO0YIy4Vu25pg&s';
const EGG_NOME  = 'Rickelme';
const EGG_FRASE = '"Eu não fiz o design, eu sou o desing!"';

const CLIQUES_NECESSARIOS = 5;
const JANELA_MS = 1500;

function _injetarMarkup() {
  if (document.getElementById('egg-bg')) return;   // página já tem o markup

  const bg = document.createElement('div');
  bg.className = 'egg-bg';
  bg.id = 'egg-bg';
  bg.innerHTML = `
    <div class="egg-card">
      <img class="egg-img" id="egg-img" src="" alt="easter egg"
           onerror="this.src='https://placehold.co/320x400/1a1a1a/c0171a?text=📸+Foto+aqui'" />
      <div class="egg-nome" id="egg-nome">👀 Quem será?</div>
      <div class="egg-frase" id="egg-frase">"Não foi eu que deletei o banco."</div>
    </div>
    <div class="egg-close-hint">clique em qualquer lugar para fechar</div>`;
  bg.addEventListener('click', fecharEgg);
  document.body.appendChild(bg);
}

function _abrir() {
  const img = document.getElementById('egg-img');
  const nome = document.getElementById('egg-nome');
  const frase = document.getElementById('egg-frase');
  const bg = document.getElementById('egg-bg');
  if (!bg) return;

  if (img)   img.src = EGG_FOTO || '';
  if (nome)  nome.textContent = EGG_NOME;
  if (frase) frase.textContent = EGG_FRASE;
  bg.classList.add('open');
  document.addEventListener('keydown', _esc);
}

export function fecharEgg() {
  document.getElementById('egg-bg')?.classList.remove('open');
  document.removeEventListener('keydown', _esc);
}

function _esc(e) {
  if (e.key === 'Escape') fecharEgg();
}

export function initEasterEgg() {
  const start = () => {
    _injetarMarkup();

    let cliques = 0, timer = null;
    document.getElementById('egg-trigger')?.addEventListener('click', () => {
      cliques++;
      clearTimeout(timer);
      timer = setTimeout(() => { cliques = 0; }, JANELA_MS);
      if (cliques >= CLIQUES_NECESSARIOS) { cliques = 0; _abrir(); }
    });

    // as páginas usam onclick="fecharEgg()" inline no markup próprio
    window.fecharEgg = fecharEgg;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
