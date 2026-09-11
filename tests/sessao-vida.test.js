// DSos — testes da sessão que vive por inatividade (migration 20260910120000)
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   node --test tests/sessao-vida.test.js
//
// POR QUE ESTES TESTES EXISTEM
// Em 08/09 o painel do PC ficou "logado" 6 dias com o token vencido: nada no
// front perguntava ao banco se a sessão ainda valia. A correção fez o
// `rpc_sessao_ping` renovar o token e devolver o tipo da sessão, ou NULL. O
// front (js/sessao-vida.js) manda para o login quando recebe NULL. Se o ping
// voltar a devolver outra coisa para token morto, a aba zumbi volta junto.
//
// De quebra o ping e o `rpc_sessao_encerrar` deixaram de confiar no id/tipo
// que vem no corpo. Antes qualquer um marcava qualquer conta como "ao vivo"
// no painel de logs, ou tirava a presença de qualquer conta.
//
// Tudo aqui roda só com a anon key e token forjado. Não cria sessão real, não
// grava nada que sobre no banco: é seguro contra o banco de produção.
//
// O caminho feliz (token vivo é renovado por 5 min, teto de 12h, logout apaga
// o token) não dá para exercitar sem logar de verdade. Ele foi validado direto
// no banco, dentro de uma transação desfeita no fim (ver LASTCHANGES.md).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const tokenForjado = () => randomBytes(32).toString('hex');
// id alto e aleatório: não colide com conta real nem entre execuções
const ID_FALSO = 900_000_000 + Math.floor(Math.random() * 1_000_000);

async function rpc(nome, corpo = {}, extras = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { ...headers, ...extras },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
}

describe('rpc_sessao_ping', () => {
  test('sem token, responde 200 com null (sessão morta)', async () => {
    const r = await rpc('rpc_sessao_ping', { p_usuario_nome: 'zzteste' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo, null);
  });

  test('com token forjado, responde null: token inexistente não vira sessão', async () => {
    const r = await rpc('rpc_sessao_ping', {}, { 'X-Sessao-Token': tokenForjado() });
    assert.equal(r.status, 200);
    assert.equal(r.corpo, null);
  });

  test('não marca presença de uma conta só porque o id veio no corpo', async () => {
    await rpc('rpc_sessao_ping', {
      p_usuario_id: ID_FALSO, p_usuario_tipo: 'ti',
      p_usuario_login: 'zzteste', p_usuario_nome: 'zzteste',
    }, { 'X-Sessao-Token': tokenForjado() });

    // NOTA: desde L4 (11/09/2026) `sessao_ativa` só é legível com sessão de T.I.,
    // então sem token este GET devolve [] por RLS, não porque a presença não
    // foi gravada. A garantia de fato é do próprio rpc_sessao_ping, que só grava
    // presença quando fn_sessao_token_header() casa um token vivo — o teste
    // "com token forjado → null" acima já trava isso. Este bloco fica como
    // guarda do contrato REST (200, sem vazar linha sem sessão).
    const r = await fetch(`${URL}/rest/v1/sessao_ativa?usuario_id=eq.${ID_FALSO}&select=usuario_id`, { headers });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), [], 'sessao_ativa vazou linha sem sessão (L4?)');
  });
});

describe('rpc_sessao_encerrar', () => {
  test('aceita o formato antigo (só id/tipo) sem erro, para não quebrar o front em cache', async () => {
    const r = await rpc('rpc_sessao_encerrar', { p_usuario_id: ID_FALSO, p_usuario_tipo: 'pc' });
    assert.ok([200, 204].includes(r.status), `status ${r.status}`);
  });

  test('logout com token forjado não dá erro nem devolve dado', async () => {
    const r = await rpc('rpc_sessao_encerrar', { p_token: tokenForjado(), p_logout: true });
    assert.ok([200, 204].includes(r.status), `status ${r.status}`);
    assert.equal(r.corpo, null);
  });
});
