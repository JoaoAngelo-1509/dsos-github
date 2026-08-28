/* DSos — scripts/gera-404-inimigo.js
   ────────────────────────────────────────────────────────────────────────
   Gera js/404-inimigo.js, a geometria do inimigo da página 404.

   Roda à mão, só quando se quiser mexer no modelo ou na pose. A saída é
   versionada, então nada disso acontece no build nem no navegador:

       node scripts/gera-404-inimigo.js

   Entrada: "3D Male Base Mesh" de orange-juice-games (CC0 1.0), baixado de
   github.com/BoQsc/Godot-3D-Male-Base-Mesh. 1804 triângulos, corpo inteiro,
   A-pose. O download fica em cache em .cache/ (que está no .gitignore).

   Por que não usar a malha como veio:
   • é um corpo inteiro, e a cena é só torso pra cima;
   • 1804 triângulos não cabem num repaint de canvas por quadro;
   • a malha é lisa, e o visual do SUPERHOT é facetado — a decimação por
     agrupamento de vértices resolve as duas últimas de uma vez, porque
     achatar faces É o efeito;
   • A-pose é pose de manequim; a cena precisa de alguém que levou um tiro.

   Sem dependências: o parser de GLB são as ~30 linhas de `lerGlb`.
   ──────────────────────────────────────────────────────────────────────── */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const RAIZ = path.join(__dirname, '..');
const CACHE = path.join(RAIZ, '.cache');
const GLB = path.join(CACHE, 'male_base_mesh.glb');
const SAIDA = path.join(RAIZ, 'js', '404-inimigo.js');
const URL_MODELO = 'https://raw.githubusercontent.com/BoQsc/Godot-3D-Male-Base-Mesh/master/Original/male_base_mesh.glb';

const ALVO_TRIANGULOS = 240;
const ALVO_CACOS = 72;      // em quantos estilhaços o corpo se parte

/* ── entrada ─────────────────────────────────────────────────────────── */

function baixar(url, destino) {
  return new Promise((ok, erro) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return ok(baixar(res.headers.location, destino));
      if (res.statusCode !== 200) return erro(new Error('HTTP ' + res.statusCode));
      const partes = [];
      res.on('data', p => partes.push(p));
      res.on('end', () => { fs.writeFileSync(destino, Buffer.concat(partes)); ok(); });
    }).on('error', erro);
  });
}

/* glTF binário: cabeçalho de 12 bytes e depois blocos (JSON e BIN) */
function lerGlb(buf) {
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const tam = buf.readUInt32LE(off);
    const tipo = buf.toString('ascii', off + 4, off + 8);
    if (tipo === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + tam));
    if (tipo.startsWith('BIN')) bin = buf.slice(off + 8, off + 8 + tam);
    off += 8 + tam;
  }

  const TIPO = {
    5120: ['readInt8', 1], 5121: ['readUInt8', 1], 5122: ['readInt16LE', 2],
    5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4]
  };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function acessor(i) {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const [ler, tam] = TIPO[a.componentType], nc = NCOMP[a.type];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const passo = bv.byteStride || tam * nc;
    const saida = [];
    for (let k = 0; k < a.count; k++) {
      const linha = [];
      for (let c = 0; c < nc; c++) linha.push(bin[ler](base + k * passo + c * tam));
      saida.push(nc === 1 ? linha[0] : linha);
    }
    return saida;
  }

  const prim = json.meshes[0].primitives[0];
  return { pos: acessor(prim.attributes.POSITION), idx: acessor(prim.indices) };
}

/* ── conversão ───────────────────────────────────────────────────────── */

/* No modelo, y é a altura, z a envergadura e x a profundidade (+x é a frente).
   Na cena, x é a direita, y é cima e z aponta para a câmera. */
const CORTE_MODELO = -0.10;   // altura do quadril, em unidades do modelo
const TOPO_MODELO = 0.948;    // topo do crânio
const CORTE_CENA = -100;      // as mesmas duas alturas, em unidades da cena
const TOPO_CENA = 157;

function converter(pos, idx) {
  const S = (TOPO_CENA - CORTE_CENA) / (TOPO_MODELO - CORTE_MODELO);
  const y0 = TOPO_MODELO - TOPO_CENA / S;
  const V = pos.map(p => [p[2] * S, (p[1] - y0) * S, p[0] * S]);

  // fora tudo que fica abaixo do quadril; o corte sai irregular de propósito
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]];
    if ((V[t[0]][1] + V[t[1]][1] + V[t[2]][1]) / 3 >= CORTE_CENA) tris.push(t);
  }
  return { V, tris };
}

/* Decimação por agrupamento: encaixa os vértices num grid 3D, colapsa cada
   célula num ponto só e joga fora o que degenerou. É o método mais simples
   que existe e, aqui, o mais adequado: ele destrói detalhe fino e deixa
   faces grandes e chapadas — exatamente o low-poly facetado que se quer. */
function decimar(V, tris, grid) {
  const celulas = new Map(), novos = [], remap = new Array(V.length);
  V.forEach((v, i) => {
    const ch = Math.round(v[0]/grid) + ',' + Math.round(v[1]/grid) + ',' + Math.round(v[2]/grid);
    if (!celulas.has(ch)) { celulas.set(ch, { n: 0, s: [0,0,0], i: novos.length }); novos.push(null); }
    const c = celulas.get(ch);
    c.n++; c.s[0] += v[0]; c.s[1] += v[1]; c.s[2] += v[2];
    remap[i] = c.i;
  });
  celulas.forEach(c => { novos[c.i] = [c.s[0]/c.n, c.s[1]/c.n, c.s[2]/c.n]; });

  const faces = [], vistas = new Set();
  for (const t of tris) {
    const a = remap[t[0]], b = remap[t[1]], c = remap[t[2]];
    if (a === b || b === c || a === c) continue;                  // degenerado
    const ch = [a, b, c].slice().sort((x, y) => x - y).join(',');
    if (vistas.has(ch)) continue;                                 // duplicado
    vistas.add(ch);
    faces.push([a, b, c]);
  }
  return { v: novos, f: faces };
}

/* ── agrupamento anatômico ───────────────────────────────────────────────
   Serve só para aplicar a POSE: cada grupo é um osso, e as fronteiras caem
   nas articulações, então a costura da rotação rígida some no corte.
   NÃO é a divisão dos cacos — essa vem depois, e é bem mais fina. */
const LIMITE_TRONCO = 46;

function grupo([x, y]) {
  if (Math.abs(x) > LIMITE_TRONCO)
    return (x < 0 ? 'bracoE' : 'bracoD') + (y < -6 ? '-ante' : '');
  if (y > 112) return 'cranio';
  if (y >  92) return 'mandibula';
  if (y >  74) return 'pescoco';
  if (y >  52) return 'ombros';
  if (y >  22) return 'peitoAlto';
  if (y > -12) return 'peitoBaixo';
  if (y > -56) return 'cintura';
  return 'quadril';
}

/* ── pose ────────────────────────────────────────────────────────────────
   Sequência de rotações rígidas em torno do ombro. Z levanta ou abaixa o
   braço; Y gira em torno do eixo vertical — e um mesmo Y negativo joga o
   braço esquerdo pra trás e o direito na direção da câmera, que é a torção
   de quem acabou de ser atingido. De quebra, o braço girado pra frente
   encurta em perspectiva e para de invadir a coluna de texto da página. */
const POSE = {
  'bracoE':      { pivo: [-44, 60, 0], giros: [[[0,0,1],  -72], [[0,1,0], -48]] },
  'bracoE-ante': { pivo: [-44, 60, 0], giros: [[[0,0,1], -100], [[0,1,0], -55]] },
  'bracoD':      { pivo: [ 44, 60, 0], giros: [[[0,0,1],   22], [[0,1,0], -52]] },
  'bracoD-ante': { pivo: [ 44, 60, 0], giros: [[[0,0,1],    8], [[0,1,0], -72]] },
  'cranio':      { pivo: [0, 92, 0],   giros: [[[1,0.2,0.2], -15]] },
  'mandibula':   { pivo: [0, 92, 0],   giros: [[[1,0.2,0.2], -15]] }
};

function girar(v, eixo, graus, pivo) {
  const m = Math.hypot(eixo[0], eixo[1], eixo[2]), k = eixo.map(n => n / m);
  const a = graus * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const p = [v[0] - pivo[0], v[1] - pivo[1], v[2] - pivo[2]];
  const d = k[0]*p[0] + k[1]*p[1] + k[2]*p[2];
  return [
    p[0]*c + (k[1]*p[2] - k[2]*p[1])*s + k[0]*d*(1-c) + pivo[0],
    p[1]*c + (k[2]*p[0] - k[0]*p[2])*s + k[1]*d*(1-c) + pivo[1],
    p[2]*c + (k[0]*p[1] - k[1]*p[0])*s + k[2]*d*(1-c) + pivo[2]
  ];
}

/* ── estilhaçamento ──────────────────────────────────────────────────────
   No SUPERHOT o inimigo não se parte em membros: ele estilhaça como vidro,
   numa nuvem de lascas pequenas que ficam suspensas no ar. Partir em 12
   blocos anatômicos lia como boneco desmontando, que é outra coisa.

   Então, depois que a pose está aplicada, a malha é reagrupada por
   proximidade: uma grade 3D sobre o corpo, e cada célula ocupada vira um
   caco de 2 a 5 triângulos. Como as lascas são pequenas, mesmo espalhadas
   elas continuam desenhando a silhueta humana — que é exatamente a imagem
   de um corpo congelado no instante em que explode. */
function estilhacar(v, faces, grid) {
  const celulas = new Map();
  faces.forEach(f => {
    const c = [0, 1, 2].map(k => (v[f[0]][k] + v[f[1]][k] + v[f[2]][k]) / 3);
    const ch = Math.round(c[0]/grid) + ',' + Math.round(c[1]/grid) + ',' + Math.round(c[2]/grid);
    if (!celulas.has(ch)) celulas.set(ch, []);
    celulas.get(ch).push(f);
  });
  return [...celulas.values()];
}

/* ── programa ────────────────────────────────────────────────────────── */

(async function () {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(GLB)) {
    console.log('baixando o modelo...');
    await baixar(URL_MODELO, GLB);
  }

  const { pos, idx } = lerGlb(fs.readFileSync(GLB));
  console.log('original:', idx.length / 3, 'triangulos,', pos.length, 'vertices');

  const { V, tris } = converter(pos, idx);
  console.log('apos o corte no quadril:', tris.length, 'triangulos');

  // procura o grid que chega mais perto do alvo de triângulos
  let grid = 14, malha = decimar(V, tris, grid);
  for (let k = 0; k < 40 && Math.abs(malha.f.length - ALVO_TRIANGULOS) > ALVO_TRIANGULOS * 0.06; k++) {
    grid *= malha.f.length > ALVO_TRIANGULOS ? 1.07 : 0.95;
    malha = decimar(V, tris, grid);
  }
  console.log('decimado (grid ' + grid.toFixed(1) + '):', malha.f.length, 'triangulos');

  // 1. pose: gira cada osso em torno da própria articulação
  const posto = malha.v.map(p => p.slice());
  const porGrupo = new Map();
  malha.f.forEach(f => {
    const centro = [0, 1, 2].map(k =>
      (malha.v[f[0]][k] + malha.v[f[1]][k] + malha.v[f[2]][k]) / 3);
    const g = grupo(centro);
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(f);
  });
  const jaPosto = new Set();
  porGrupo.forEach((faces, nome) => {
    const pose = POSE[nome];
    if (!pose) return;
    faces.forEach(f => f.forEach(i => {
      if (jaPosto.has(i)) return;                  // vértice de fronteira: uma vez só
      jaPosto.add(i);
      let p = malha.v[i];
      pose.giros.forEach(g => { p = girar(p, g[0], g[1], pose.pivo); });
      posto[i] = p;
    }));
  });

  // 2. estilhaço: reagrupa o corpo já posado em lascas pequenas
  let gCaco = 40, grupos = estilhacar(posto, malha.f, gCaco);
  for (let k = 0; k < 40 && Math.abs(grupos.length - ALVO_CACOS) > ALVO_CACOS * 0.08; k++) {
    gCaco *= grupos.length > ALVO_CACOS ? 1.06 : 0.95;
    grupos = estilhacar(posto, malha.f, gCaco);
  }
  console.log('estilhacado (grid ' + gCaco.toFixed(1) + '):', grupos.length, 'cacos');

  const pedacos = grupos.map((faces, n) => {
    const remap = new Map(), v = [], f = [];
    faces.forEach(face => face.forEach(i => {
      if (!remap.has(i)) {
        remap.set(i, v.length / 3);
        const p = posto[i];
        v.push(Math.round(p[0]), Math.round(p[1]), Math.round(p[2]));
      }
      f.push(remap.get(i));
    }));
    return { nome: 'c' + n, v, f };
  });
  const tam = pedacos.map(p => p.f.length / 3);
  console.log('triangulos por caco: min', Math.min(...tam), 'max', Math.max(...tam),
              'media', (tam.reduce((a,b)=>a+b,0)/tam.length).toFixed(1));

  const totalTri = pedacos.reduce((a, p) => a + p.f.length / 3, 0);
  const cabecalho = `/* DSos — 404-inimigo.js — GERADO, não edite à mão.
   ────────────────────────────────────────────────────────────────────────
   Geometria do inimigo da página 404, derivada de um modelo humano real.

   Origem:  "3D Male Base Mesh" de orange-juice-games, republicado por BoQsc
            em github.com/BoQsc/Godot-3D-Male-Base-Mesh
   Licença: CC0 1.0 Universal (domínio público) — não exige crédito; fica
            registrado aqui porque num TCC procedência importa.

   Gerado por scripts/gera-404-inimigo.js, que baixa o modelo original
   (${idx.length / 3} triângulos, corpo inteiro, A-pose), corta no quadril,
   reposiciona braços e cabeça, decima para ${totalTri} triângulos e estilhaça
   o corpo em ${pedacos.length} lascas pequenas por proximidade. O porquê de cada passo
   está lá — em especial o de estilhaçar fino em vez de partir em membros.

   Para mudar a pose ou a contagem de triângulos, edite aquele script e
   rode-o de novo — mexer aqui é perder o trabalho no próximo gera.

   Formato: v = [x,y,z, x,y,z, ...] e f = [a,b,c, a,b,c, ...] (índices em v).
   ──────────────────────────────────────────────────────────────────────── */

window.DSOS_INIMIGO = [
`;

  const corpo = pedacos.map(p =>
    '  { n: ' + JSON.stringify(p.nome) + ',\n' +
    '    v: [' + p.v.join(',') + '],\n' +
    '    f: [' + p.f.join(',') + '] }'
  ).join(',\n');

  fs.writeFileSync(SAIDA, cabecalho + corpo + '\n];\n', 'utf8');
  console.log('TOTAL', totalTri, 'triangulos →', path.relative(RAIZ, SAIDA));
})();
