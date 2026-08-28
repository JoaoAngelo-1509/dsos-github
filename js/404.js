/* DSos — 404.js
   ────────────────────────────────────────────────────────────────────────
   Cena 3D da página 404: um inimigo low-poly translúcido (torso pra cima)
   estilhaçado no ar, com a câmera reagindo ao cursor e um "scrub de tempo"
   que vai e volta sobre o instante do tiro.

   Por que um renderizador 3D escrito à mão em vez de three.js:
   o visual do SUPERHOT é flat-shaded translúcido sem textura, sem luz
   dinâmica e sem sombra — ou seja, o pipeline inteiro que uma engine traz
   fica sem uso. O que a cena precisa é projeção em perspectiva, ordenação
   por profundidade e preenchimento com alpha. Isso cabe em ~150 linhas e
   mantém o `assets_externos: 0` e o `sem_dependencias` do spec.

   Como o volume aparece sem sombreamento:
   as faces são desenhadas de trás pra frente com alpha baixo, então onde o
   corpo é mais espesso mais faces se sobrepõem e o vermelho fica mais denso.
   É assim que o jogo resolve, e é o que faz o boneco ler como sólido em vez
   de recorte chapado.

   O corpo em si NÃO é modelado aqui: vem de js/404-inimigo.js, gerado a
   partir de um base mesh humano CC0 por scripts/gera-404-inimigo.js.

   Custo: saímos de 26 camadas só-transform pra um repaint de canvas por
   quadro — 238 triângulos do corpo em 67 lascas, mais 4 por caco solto:
   278 no desktop, 250 no mobile. Partir em 67 lascas em vez de 12 não
   custa nada a mais em preenchimento — é a mesma contagem de triângulos,
   só reagrupada.
   Num note fraco isso sai mais barato que 26 camadas compostas, e o canvas
   é camada isolada: o resto da página não repinta.
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var mqMobile = window.matchMedia('(max-width: 820px)');
  var mqParado = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── parâmetros do loop ─────────────────────────────────────────────── */

  var IDA_MS      = 5000;   // uma ida; o ciclo completo (ida + volta) dá 10s
  var MONTADO_MIN = 0.40;   // corpo remontado no começo da ida
  var MONTADO_MAX = 0.85;   // ...e no fim dela

  /* Acoplamento do mouse com o tempo. No jogo o tempo anda com o MOVIMENTO,
     não com o olhar — e anda na hora, sem inércia. Era esse o problema da
     primeira versão: ela mapeava a velocidade do cursor numa taxa de
     reprodução e passava o valor por dois suavizadores, o que punha uns dez
     quadros de atraso entre a mão e a tela e fazia tudo parecer solto.

     Agora é direto: cada pixel percorrido empurra a linha do tempo por uma
     quantidade fixa. O horizontal manda na direção — pra direita avança, pra
     esquerda rebobina — e o vertical só soma energia. Uma varrida da tela
     inteira roda o estilhaçamento do começo ao fim.

     A posição do cursor continua girando a câmera, e isso NÃO mexe no tempo:
     olhar em volta é de graça, como no jogo. */
  var MS_POR_PX = 4.2;      // ms de linha do tempo por pixel de cursor
  var LERDEZA   = 0.055;    // ms de linha do tempo por ms real, com a mão parada
  var PASSOS    = 24;       // quantização do scrub (o picotado de fita)

  /* ── câmera ─────────────────────────────────────────────────────────── */

  var DIST_CAM = 760;       // câmera em +Z olhando pra -Z
  var ALTURA_MODELO = 257;  // do quadril cortado (y -100) ao topo do crânio (y 157)

  var canvas = document.getElementById('cena');
  var ctx = canvas.getContext('2d');

  var W = 0, H = 0, dpr = 1, focal = 1, cx = 0, cy = 0, mobile = false;
  var zonaLimpa = null;     // retângulo do texto, pra abafar caco que passa atrás

  /* ── álgebra mínima ─────────────────────────────────────────────────── */

  function normalizar(v) {
    var m = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  }

  /* matriz de rotação da cena: Rx(inclina) · Ry(giro) · Rz(tomba) */
  function matrizCena(giro, inclina, tomba) {
    var cg = Math.cos(giro), sg = Math.sin(giro);
    var ci = Math.cos(inclina), si = Math.sin(inclina);
    var ct = Math.cos(tomba), st = Math.sin(tomba);
    return [
      cg * ct + sg * si * st,   -cg * st + sg * si * ct,   sg * ci,
      ci * st,                   ci * ct,                 -si,
      -sg * ct + cg * si * st,   sg * st + cg * si * ct,   cg * ci
    ];
  }

  function aplicar(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }

  /* Rodrigues: rotação em torno de um eixo qualquer, usada no estilhaço */
  function matrizEixo(eixo, ang) {
    var k = normalizar(eixo), c = Math.cos(ang), s = Math.sin(ang), u = 1 - c;
    var x = k[0], y = k[1], z = k[2];
    return [
      c + x * x * u,      x * y * u - z * s,  x * z * u + y * s,
      y * x * u + z * s,  c + y * y * u,      y * z * u - x * s,
      z * x * u - y * s,  z * y * u + x * s,  c + z * z * u
    ];
  }
  function centroide(geo) {
    var s = [0, 0, 0];
    geo.v.forEach(function (v) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; });
    return [s[0]/geo.v.length, s[1]/geo.v.length, s[2]/geo.v.length];
  }

  /* cunha irregular de 4 faces — os cacos soltos que voam pela tela */
  function lasca(rnd, tam) {
    var p = function () {
      return [(rnd() - .5) * tam, (rnd() - .5) * tam, (rnd() - .5) * tam];
    };
    return { v: [p(), p(), p(), p()], f: [[0,1,2], [0,1,3], [0,2,3], [1,2,3]] };
  }

  /* ── o inimigo ──────────────────────────────────────────────────────── */
  /* A malha vem de js/404-inimigo.js: um base mesh humano CC0 recortado no
     quadril, decimado, posado e estilhaçado em ~67 lascas pequenas (crédito e
     o passo a passo estão no cabeçalho daquele arquivo).

     Partir em membros lia como boneco desmontando. No jogo o inimigo é de
     vidro: ele se abre numa nuvem de lascas miúdas que ficam suspensas no
     ar, e como cada lasca é pequena a silhueta humana continua legível
     mesmo espalhada. É essa a imagem — corpo congelado no meio da explosão.

     Aqui só se calcula o comportamento. Tudo sai da posição da lasca em
     relação ao PONTO DE IMPACTO, não do centro do corpo: quem estava perto
     do tiro sai mais rápido e volta primeiro, quem estava longe demora — que
     é como energia se espalha, e é a onda de sucção que o spec pedia. */

  function montarCorpo() {
    var bruto = window.DSOS_INIMIGO;
    if (!bruto) return [];              // 404-inimigo.js não carregou
    var rnd = prng(7331);

    return bruto.map(function (dados) {
      var g = { v: [], f: [] }, i;
      for (i = 0; i < dados.v.length; i += 3)
        g.v.push([dados.v[i], dados.v[i+1], dados.v[i+2]]);
      for (i = 0; i < dados.f.length; i += 3)
        g.f.push([dados.f[i], dados.f[i+1], dados.f[i+2]]);

      g.centro = centroide(g);
      var fora = [
        g.centro[0] - BALA_ALVO[0],
        g.centro[1] - BALA_ALVO[1],
        g.centro[2] - BALA_ALVO[2]
      ];
      var dist = Math.hypot(fora[0], fora[1], fora[2]) || 1;
      var perto = 1 - Math.min(1, dist / 190);        // 1 no impacto, 0 na ponta
      var n = normalizar(fora);

      // Velocidade cai com a distância do impacto, com variação por lasca pra
      // a nuvem não sair com cara de casca de esfera.
      // O teto é deliberadamente baixo — perto do tamanho de uma lasca. Mais
      // que isso e o corpo deixa de ler como corpo e vira poeira: o spec pede
      // que ele nunca chegue a 100% desmontado, e é esse número que garante.
      var vel = (12 + perto * 30) * (0.75 + rnd() * 0.5);
      g.dir = [
        n[0] * vel,
        n[1] * vel + 6,                               // viés pra cima: o corpo é levantado
        n[2] * vel + 10                               // e um tanto pra câmera, pra abrir o volume
      ];
      g.eixo = [rnd() - .5, rnd() - .5, rnd() - .5];  // vidro tomba em qualquer eixo
      g.giro = 20 + rnd() * 55;
      g.atraso = 1 - perto;                           // longe do tiro remonta por último
      return g;
    });
  }

  /* ── PRNG semeado: o espalhamento precisa ser o mesmo em todo reload ─── */
  function prng(semente) {
    var a = semente >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function montarLascas(quantas) {
    var rnd = prng(40431), p = [];
    for (var i = 0; i < quantas; i++) {
      var pos = [
        (rnd() - .5) * 1120,
        -240 + rnd() * 560,
        -220 + rnd() * 600            // z alto = perto da câmera = caco grande
      ];
      var tam = 12 + rnd() * 22;
      var g = lasca(rnd, tam);
      g.v = g.v.map(function (v) { return [v[0] + pos[0], v[1] + pos[1], v[2] + pos[2]]; });
      g.centro = pos;
      g.dir = [(rnd() - .5) * 60, (rnd() - .5) * 60, (rnd() - .5) * 60];
      g.eixo = [rnd() - .5, rnd() - .5, rnd() - .5];
      g.giro = 30 + rnd() * 50;
      g.atraso = 0.35 + rnd() * 0.65;   // as soltas remontam sempre por último
      g.solta = true;
      p.push(g);
    }
    return p;
  }

  /* ── a bala ─────────────────────────────────────────────────────────── */
  /* Sai de perto da câmera (grande) e some peito adentro (pequena) — é o
     sentido certo: quem atira é quem está olhando. A perspectiva faz todo o
     trabalho de leitura que a linha 2D não fazia. */
  /* Origem escolhida conferindo a trajetória projetada quadro a quadro: a
     bala entra pela borda superior direita logo no começo da ida (p≈0.06) e
     encolhe pela metade até o peito, que é o sinal de perspectiva. A origem
     anterior estava perto demais da câmera — no primeiro quadro a bala
     aparecia com escala 14x e fora da tela. */
  var BALA_ORIGEM = [290, 110, 300];
  var BALA_ALVO   = [-4, 42, 14];

  function posBala(p) {
    return [
      BALA_ORIGEM[0] + (BALA_ALVO[0] - BALA_ORIGEM[0]) * p,
      BALA_ORIGEM[1] + (BALA_ALVO[1] - BALA_ORIGEM[1]) * p,
      BALA_ORIGEM[2] + (BALA_ALVO[2] - BALA_ORIGEM[2]) * p
    ];
  }

  /* ── projeção ───────────────────────────────────────────────────────── */
  function projetar(v) {
    var d = DIST_CAM - v[2];
    if (d < 40) d = 40;                       // não deixa atravessar a câmera
    var s = focal / d;
    return [cx + v[0] * s, cy - v[1] * s, d];
  }

  /* ── estado da cena ─────────────────────────────────────────────────── */
  var pecas = [], LUZ = normalizar([-0.45, 0.7, 0.55]);
  var tempo = IDA_MS * 0.44, sentido = 1, empurrao = 0;   // empurrao: ms de scrub pendentes do cursor
  var giroAlvo = 0, inclinaAlvo = 0, giroAtual = 0, inclinaAtual = 0;

  function calibrar() {
    mobile = mqMobile.matches;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // enquadramento conferido pedaço a pedaço, no repouso e no espalhamento
    // máximo: nada sai pela esquerda, nada invade a coluna de texto, e o
    // quadril passa da borda de baixo (é o corte da figura)
    var alturaAlvo = (mobile ? 0.46 : 0.80) * H;
    focal = DIST_CAM * (alturaAlvo / ALTURA_MODELO);
    cx = (mobile ? 0.50 : 0.31) * W;
    cy = (mobile ? 0.50 : 0.70) * H;

    var c = document.querySelector('.conteudo').getBoundingClientRect();
    zonaLimpa = { e: c.left - 24, d: c.right + 24, t: c.top - 24, b: c.bottom + 24 };
  }

  /* ── desenho de um quadro ───────────────────────────────────────────── */
  function desenhar(p) {
    var espalha = 1 - (MONTADO_MIN + (MONTADO_MAX - MONTADO_MIN) * p);
    var mCena = matrizCena(giroAtual - 0.34, inclinaAtual + 0.05, 0.10);
    var faces = [];

    for (var i = 0; i < pecas.length; i++) {
      var pc = pecas[i];
      // escalonamento: extremidade sente o estilhaço mais tarde que o miolo
      var e = Math.min(1, Math.max(0, espalha * (1 + pc.atraso * 0.4)));
      var mGiro = matrizEixo(pc.eixo, pc.giro * e * Math.PI / 180);
      var ox = pc.dir[0] * e, oy = pc.dir[1] * e, oz = pc.dir[2] * e;

      var mundo = pc.v.map(function (v) {
        var loc = [v[0] - pc.centro[0], v[1] - pc.centro[1], v[2] - pc.centro[2]];
        var r = aplicar(mGiro, loc);
        return aplicar(mCena, [
          r[0] + pc.centro[0] + ox,
          r[1] + pc.centro[1] + oy,
          r[2] + pc.centro[2] + oz
        ]);
      });
      var tela = mundo.map(projetar);

      for (var j = 0; j < pc.f.length; j++) {
        var idx = pc.f[j];
        var a = mundo[idx[0]], b = mundo[idx[1]], c2 = mundo[idx[2]];
        var n = normalizar([
          (b[1] - a[1]) * (c2[2] - a[2]) - (b[2] - a[2]) * (c2[1] - a[1]),
          (b[2] - a[2]) * (c2[0] - a[0]) - (b[0] - a[0]) * (c2[2] - a[2]),
          (b[0] - a[0]) * (c2[1] - a[1]) - (b[1] - a[1]) * (c2[0] - a[0])
        ]);
        var luz = Math.abs(n[0] * LUZ[0] + n[1] * LUZ[1] + n[2] * LUZ[2]);
        var prof = 0, k;
        for (k = 0; k < idx.length; k++) prof += tela[idx[k]][2];
        prof /= idx.length;
        faces.push({ i: idx, t: tela, luz: luz, z: prof, solta: pc.solta });
      }
    }

    ctx.clearRect(0, 0, W, H);
    faces.sort(function (a, b) { return b.z - a.z; });   // pintor: fundo primeiro

    for (var f = 0; f < faces.length; f++) {
      var fa = faces[f], t = fa.t, id = fa.i;
      var alfa = (fa.solta ? 0.30 : 0.20) + fa.luz * 0.16;

      // caco que passa atrás do texto abafa: a zona limpa é a única área que
      // precisa de contraste garantido
      if (zonaLimpa) {
        var mx = 0, my = 0;
        for (var q = 0; q < id.length; q++) { mx += t[id[q]][0]; my += t[id[q]][1]; }
        mx /= id.length; my /= id.length;
        if (mx > zonaLimpa.e && mx < zonaLimpa.d && my > zonaLimpa.t && my < zonaLimpa.b) {
          alfa *= 0.3;
        }
      }

      ctx.beginPath();
      ctx.moveTo(t[id[0]][0], t[id[0]][1]);
      for (var v2 = 1; v2 < id.length; v2++) ctx.lineTo(t[id[v2]][0], t[id[v2]][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 26, 26, ' + alfa.toFixed(3) + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(196, 0, 0, ' + (alfa * 1.7).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    desenharBala(p, mCena);
  }

  /* No jogo a bala é um cilindro preto de pontas arredondadas, seguido por um
     rastro longo e VERMELHO. A primeira versão tinha bico e farpas — daí a
     cara de flecha — e rastro branco, que no fundo claro só aparecia por cima
     do 404 preto. O vermelho resolve as duas coisas: lê no claro e amarra
     com o acento único da paleta.
     (Isso muda o bala_rastro branco do spec; era decisão em aberto lá.) */
  function desenharBala(p, mCena) {
    var atual = posBala(p);
    var recuo = 0.34 * (1 - p) + 0.06;          // o rastro encurta ao chegar
    var traz = posBala(Math.max(0, p - recuo));

    var pa = projetar(aplicar(mCena, atual));
    var pb = projetar(aplicar(mCena, traz));
    var dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;          // normal do rastro, em tela
    var grossoA = Math.max(1.3, 900 / pa[2] * 1.9);
    var grossoB = Math.max(0.3, 900 / pb[2] * 0.4);

    // rastro: afina até virar nada na cauda
    ctx.beginPath();
    ctx.moveTo(pa[0] + nx * grossoA, pa[1] + ny * grossoA);
    ctx.lineTo(pb[0] + nx * grossoB, pb[1] + ny * grossoB);
    ctx.lineTo(pb[0] - nx * grossoB, pb[1] - ny * grossoB);
    ctx.lineTo(pa[0] - nx * grossoA, pa[1] - ny * grossoA);
    ctx.closePath();
    ctx.fillStyle = 'rgba(196, 0, 0, .5)';
    ctx.fill();

    // projétil: elipse na direção do voo — cilindro arredondado, sem ponta
    var r = Math.max(2.2, 900 / pa[2] * 2.8);
    ctx.beginPath();
    ctx.ellipse(pa[0], pa[1], r * 1.6, r, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0a';
    ctx.fill();

    // clarão do impacto, só no fim da ida
    if (p > 0.88) {
      var f = (p - 0.88) / 0.12;
      var alvo = projetar(aplicar(mCena, BALA_ALVO));
      var raio = 6 + f * 26;
      ctx.beginPath();
      ctx.arc(alvo[0], alvo[1], raio, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.85 * (1 - f * 0.55)).toFixed(3) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(alvo[0], alvo[1], raio * 1.9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.5 * (1 - f)).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /* ── o cursor empurra o tempo e a câmera ────────────────────────────── */
  function ligarCursor() {
    var ultimo = null;

    window.addEventListener('mousemove', function (ev) {
      if (ultimo) {
        var dx = ev.clientX - ultimo.x;
        var dy = ev.clientY - ultimo.y;
        // horizontal decide o sentido; vertical só empresta energia pra ele
        var sinal = dx < 0 ? -1 : 1;
        empurrao += (dx + sinal * Math.abs(dy) * 0.35) * MS_POR_PX;
      }
      ultimo = { x: ev.clientX, y: ev.clientY };

      // a POSIÇÃO do cursor orbita a câmera, e isso não toca no tempo
      giroAlvo = (ev.clientX / window.innerWidth - .5) * 0.7;
      inclinaAlvo = (ev.clientY / window.innerHeight - .5) * 0.3;
    }, { passive: true });
  }

  function ligarToqueCrt() {
    var crt = document.querySelector('.crt');
    window.addEventListener('touchstart', function () {
      if (crt.classList.contains('piscou')) return;
      crt.classList.add('piscou');
      setTimeout(function () { crt.classList.remove('piscou'); }, 500);
    }, { passive: true });
  }

  /* ── laço ───────────────────────────────────────────────────────────── */
  function laco(anterior) {
    return function quadro(agora) {
      var dt = Math.min(50, agora - (anterior || agora));
      anterior = agora;

      // a câmera segue o cursor com um resto de inércia, só o bastante pra
      // não tremer; o tempo, esse não passa por suavizador nenhum
      giroAtual += (giroAlvo - giroAtual) * 0.14;
      inclinaAtual += (inclinaAlvo - inclinaAtual) * 0.14;

      // rasteja sozinho na direção corrente, e o cursor empurra por cima
      tempo += dt * LERDEZA * sentido + empurrao;
      empurrao = 0;
      if (tempo >= IDA_MS) { tempo = IDA_MS; sentido = -1; }
      if (tempo <= 0)      { tempo = 0;      sentido =  1; }

      // progresso picotado de propósito: avança, recua um tico, avança.
      // sem easing suave — é fita rebobinando, não animação de UI.
      var b = tempo / IDA_MS;
      var passo = Math.round(b * PASSOS) / PASSOS;
      var tremor = (Math.round(b * PASSOS / 2) % 2 === 0) ? 0.028 : -0.016;
      desenhar(Math.min(1, Math.max(0, passo + tremor)));

      requestAnimationFrame(quadro);
    };
  }

  /* ── chant e terminal ───────────────────────────────────────────────── */
  function montarChant() {
    var linha = ('PAGE NOT FOUND ').repeat(14), html = '';
    for (var i = 0; i < 44; i++) html += '<div>' + linha + '</div>';
    document.getElementById('chant').innerHTML = html;
  }

  function montarCrt() {
    var rota = (location.pathname + location.search) || '/';
    if (rota.length > 42) rota = rota.slice(0, 41) + '…';
    // textContent: a rota vem da URL, nunca entra como HTML
    document.getElementById('crt-rota').textContent = '> GET ' + rota;
  }

  /* ── partida ────────────────────────────────────────────────────────── */
  function construir() {
    calibrar();
    // 12 pedaços de corpo + soltas = 26 no desktop, 14 no mobile (spec)
    // o corpo já entrega ~67 lascas; as soltas são só as que voam pra fora do
    // enquadramento, pra ocupar o resto da página
    pecas = montarCorpo().concat(montarLascas(mqMobile.matches ? 3 : 10));
  }

  montarChant();
  montarCrt();
  construir();

  // Primeiro quadro na hora, sem esperar o rAF: se a aba abrir em segundo
  // plano o rAF não dispara, e a cena não pode ficar em branco até o usuário
  // olhar pra ela. O relógio começa no meio da ida, então esse quadro e o
  // primeiro do laço são o mesmo — a página abre num quadro legível, com o
  // corpo ~60% montado, e não no extremo espalhado.
  desenhar(tempo / IDA_MS);

  if (!mqParado.matches) {
    ligarCursor();
    ligarToqueCrt();
    requestAnimationFrame(laco(0));
  }

  var timer;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var eraMobile = mobile;
      calibrar();
      if (mobile !== eraMobile) construir();
      if (mqParado.matches) desenhar(tempo / IDA_MS);
    }, 200);
  });
})();
