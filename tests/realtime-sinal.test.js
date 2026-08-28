// DSos — testes da TABELA DE SINAL de realtime (`public.realtime_sinal`)
//
// Roda com o test runner nativo do Node (sem dependências, igual às outras
// suítes):
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   node --test tests/realtime-sinal.test.js
//
// POR QUE ESTES TESTES EXISTEM
// O SEC-05b fechou a leitura de `ticket`/`mensagem` por token no header HTTP,
// e o Supabase Realtime — que avalia a RLS sem `request.headers` — parou de
// entregar eventos dessas tabelas. A migration 20260828120000 recupera o
// "ao vivo" com uma tabela-espelho `realtime_sinal`: triggers AFTER em
// `ticket`/`mensagem` gravam ali só METADADO não sensível (canal, ref_id,
// evento), a tabela tem SELECT `USING (true)` (é o que o Realtime enxerga) e
// entra na publication `supabase_realtime`. O front assina essa tabela e
// refaz o fetch REST — filtrado por token — ao receber o sinal.
//
// O QUE CADA BLOCO TRAVA
//
//   trigger dispara     INSERT/UPDATE em ticket e em mensagem têm que gerar a
//                       linha correspondente em realtime_sinal, com o canal, o
//                       ref_id (id do ticket) e o evento certos. É o que faz o
//                       "ao vivo" existir.
//
//   sinal não vaza      a tabela é lida sem token de propósito — mas NÃO pode
//                       carregar conteúdo. Este bloco fixa o shape: as únicas
//                       colunas são {id, canal, ref_id, evento, em}. Se alguém
//                       um dia adicionar `corpo`, `nome_solicitante`, `status`
//                       etc., este teste reprova. É a trava de regressão mais
//                       importante do arquivo.
//
//   escrita fechada     nem anônimo nem sessão de T.I. podem inserir/alterar/
//                       apagar em realtime_sinal pela API — só os triggers
//                       (SECURITY DEFINER) escrevem. Um sinal forjado poderia
//                       fazer painéis re-buscarem à toa (ruído), não vazar
//                       dado, mas mesmo assim não deve ser possível.
//
// LIMPEZA
// A suíte apaga PCs/T.I./chamados que cria (via as RPCs de exclusão, que
// levam mensagens junto no cascade). As linhas de `realtime_sinal` geradas no
// caminho não têm rota anon de DELETE (sem policy, de propósito) e são podadas
// pelo próprio trigger após 10 min — são metadado não sensível, sem problema
// em ficarem esse tempo.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const rest = (caminho, opts = {}) =>
  fetch(`${URL}/rest/v1/${caminho}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });

const comToken = (token) => (token == null ? {} : { 'X-Sessao-Token': token });

const rpc = (nome, corpo, token) =>
  rest(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(corpo), headers: comToken(token) });

const corpoDe = async (r) => {
  const txt = await r.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
};

/** Espera até `realtime_sinal` ter uma linha que satisfaça `pred`, ou falha. */
async function esperarSinal(pred, oque, { tentativas = 20, intervalo = 250 } = {}) {
  let ultima = [];
  for (let i = 0; i < tentativas; i++) {
    const r = await rest('realtime_sinal?select=*&order=id.desc&limit=200');
    const linhas = await corpoDe(r);
    assert.ok(r.ok && Array.isArray(linhas), `${oque}: GET realtime_sinal falhou — ${JSON.stringify(linhas).slice(0, 300)}`);
    ultima = linhas;
    const achada = linhas.find(pred);
    if (achada) return achada;
    await new Promise((s) => setTimeout(s, intervalo));
  }
  assert.fail(`${oque}: nenhum sinal correspondente em ${tentativas * intervalo}ms — últimas linhas: ${JSON.stringify(ultima.slice(0, 10))}`);
}

// ── Dados de teste ─────────────────────────────────────────────────────────

const N = randomBytes(4).toString('hex').toUpperCase();
const SENHA = `Zz!${randomBytes(6).toString('hex')}`;
const PREFIXO = `ZZTESTE-${N}`;
const criados = { pcs: [], tis: [] };
const f = {};

async function criarPC(sufixo) {
  const tag = `${PREFIXO}-PC${sufixo}`;
  const r = await rpc('rpc_cadastrar_pc', {
    p_tag: tag, p_laboratorio: `${PREFIXO}-LAB`, p_lado: 'A', p_senha: SENHA,
  });
  const c = await corpoDe(r);
  assert.ok(r.ok, `setup: rpc_cadastrar_pc falhou ${r.status} — ${JSON.stringify(c)}`);
  const pc = Array.isArray(c) ? c[0] : c;
  assert.ok(pc?.id, `setup: rpc_cadastrar_pc sem id — ${JSON.stringify(c)}`);
  criados.pcs.push(pc.id);
  return { ...pc, tag };
}

async function criarTI() {
  const login = `${PREFIXO}-ti`.toLowerCase();
  const r = await rpc('rpc_cadastrar_ti', {
    p_login: login, p_nome: `${PREFIXO} Tecnico`, p_senha: SENHA,
    p_email: null, p_is_professor: false, p_disciplina: null,
  });
  const c = await corpoDe(r);
  assert.ok(r.ok, `setup: rpc_cadastrar_ti falhou ${r.status} — ${JSON.stringify(c)}`);
  const u = Array.isArray(c) ? c[0] : c;
  assert.ok(u?.id, `setup: rpc_cadastrar_ti sem id — ${JSON.stringify(c)}`);
  criados.tis.push(u.id);
  const rl = await rpc('rpc_login_ti', { p_login: login, p_senha: SENHA });
  const l = await corpoDe(rl);
  assert.ok(Array.isArray(l) && l[0]?.token, `setup: rpc_login_ti sem token — ${JSON.stringify(l)}`);
  return { ...u, login, token: l[0].token };
}

before(async () => {
  assert.ok(URL, 'defina SUPABASE_URL');
  assert.ok(KEY, 'defina SUPABASE_ANON_KEY');

  f.ti = await criarTI();
  f.pc = await criarPC('A');

  const rt = await rest('ticket', {
    method: 'POST',
    body: JSON.stringify({
      pc_origem: f.pc.id, pc_problema: f.pc.id,
      tipo: 'hardware', descricao: `${PREFIXO}-CHAMADO`,
      laboratorio: `${PREFIXO}-LAB`, lado: 'A', status: 'aberto', prioridade: 'baixo',
      nome_solicitante: f.pc.tag,
    }),
    headers: { ...comToken(f.ti.token), Prefer: 'return=representation' },
  });
  const ct = await corpoDe(rt);
  assert.ok(rt.ok, `setup: INSERT ticket falhou ${rt.status} — ${JSON.stringify(ct)}`);
  f.ticket = Array.isArray(ct) ? ct[0] : ct;
  assert.ok(f.ticket?.id, `setup: ticket sem id — ${JSON.stringify(ct)}`);
});

after(async () => {
  for (const id of criados.pcs) {
    try { await rpc('rpc_deletar_pc', { p_id: id }); }
    catch (e) { console.error(`limpeza: pc ${id}:`, e.message); }
  }
  for (const id of criados.tis) {
    try { await rpc('rpc_deletar_ti', { p_id: id }); }
    catch (e) { console.error(`limpeza: usuario_ti ${id}:`, e.message); }
  }
});

// ───────────────────────────────────────────────────────────────────────────

describe('trigger — toda mudança em ticket/mensagem gera um sinal', () => {
  test('INSERT de ticket gera sinal canal=ticket evento=INSERT', async () => {
    // o ticket foi criado no before(); o sinal correspondente já deve existir
    await esperarSinal(
      (s) => s.canal === 'ticket' && Number(s.ref_id) === Number(f.ticket.id) && s.evento === 'INSERT',
      'sinal do INSERT de ticket',
    );
  });

  test('UPDATE de ticket (RPC de T.I.) gera sinal canal=ticket evento=UPDATE', async () => {
    const r = await rpc('rpc_ti_atualizar_ticket', {
      p_token: f.ti.token, p_ticket_id: f.ticket.id, p_patch: { status: 'em_andamento' },
    });
    assert.ok(r.ok, `rpc_ti_atualizar_ticket falhou ${r.status} — ${JSON.stringify(await corpoDe(r))}`);
    await esperarSinal(
      (s) => s.canal === 'ticket' && Number(s.ref_id) === Number(f.ticket.id) && s.evento === 'UPDATE',
      'sinal do UPDATE de ticket',
    );
  });

  test('INSERT de mensagem gera sinal canal=mensagem com ref_id = ticket_id', async () => {
    const r = await rest('mensagem', {
      method: 'POST',
      body: JSON.stringify({ ticket_id: f.ticket.id, remetente: 'PC', conteudo: `${PREFIXO}-MSG`, nome_remetente: PREFIXO }),
      headers: { ...comToken(f.ti.token), Prefer: 'return=representation' },
    });
    assert.ok(r.ok, `INSERT mensagem falhou ${r.status} — ${JSON.stringify(await corpoDe(r))}`);
    await esperarSinal(
      (s) => s.canal === 'mensagem' && Number(s.ref_id) === Number(f.ticket.id) && s.evento === 'INSERT',
      'sinal do INSERT de mensagem',
    );
  });

  test('UPDATE de mensagem (marcar lido pelo T.I.) gera sinal canal=mensagem evento=UPDATE', async () => {
    const r = await rpc('rpc_marcar_lido_ti', { p_ticket_id: f.ticket.id }, f.ti.token);
    assert.ok(r.ok, `rpc_marcar_lido_ti falhou ${r.status} — ${JSON.stringify(await corpoDe(r))}`);
    await esperarSinal(
      (s) => s.canal === 'mensagem' && Number(s.ref_id) === Number(f.ticket.id) && s.evento === 'UPDATE',
      'sinal do UPDATE de mensagem',
    );
  });
});

describe('sem token — o sinal é legível, mas não carrega conteúdo', () => {
  test('GET /realtime_sinal sem token devolve linhas (é o canal do Realtime)', async () => {
    const r = await rest('realtime_sinal?select=*&limit=50');
    const linhas = await corpoDe(r);
    assert.ok(r.ok && Array.isArray(linhas), `esperava lista, veio ${r.status} — ${JSON.stringify(linhas).slice(0, 200)}`);
  });

  test('as únicas colunas expostas são id/canal/ref_id/evento/em — nada de conteúdo', async () => {
    const r = await rest('realtime_sinal?select=*&order=id.desc&limit=50');
    const linhas = await corpoDe(r);
    assert.ok(Array.isArray(linhas) && linhas.length, 'preciso de ao menos 1 linha para checar o shape');
    const permitidas = new Set(['id', 'canal', 'ref_id', 'evento', 'em']);
    for (const linha of linhas) {
      const extras = Object.keys(linha).filter((k) => !permitidas.has(k));
      assert.equal(
        extras.length, 0,
        `realtime_sinal expôs coluna(s) fora do contrato: ${extras.join(', ')} — se for dado derivado de ticket/mensagem, é vazamento pelo WebSocket`,
      );
    }
  });
});

describe('escrita fechada — só os triggers escrevem em realtime_sinal', () => {
  const marcador = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);

  test('POST anônimo em /realtime_sinal não cria linha', async () => {
    const r = await rest('realtime_sinal', {
      method: 'POST',
      body: JSON.stringify({ canal: 'ticket', ref_id: marcador, evento: 'INSERT' }),
      headers: { Prefer: 'return=representation' },
    });
    // aceitável: 401/403/404, ou 200/201 que não persiste (RLS sem policy)
    const check = await rest(`realtime_sinal?ref_id=eq.${marcador}&select=id`);
    const linhas = await corpoDe(check);
    assert.ok(Array.isArray(linhas) && linhas.length === 0,
      `POST anônimo persistiu ${linhas?.length} linha(s) em realtime_sinal (status do POST: ${r.status})`);
  });

  test('POST com token de T.I. também não cria linha', async () => {
    const r = await rest('realtime_sinal', {
      method: 'POST',
      body: JSON.stringify({ canal: 'ticket', ref_id: marcador + 1, evento: 'INSERT' }),
      headers: { ...comToken(f.ti.token), Prefer: 'return=representation' },
    });
    const check = await rest(`realtime_sinal?ref_id=eq.${marcador + 1}&select=id`);
    const linhas = await corpoDe(check);
    assert.ok(Array.isArray(linhas) && linhas.length === 0,
      `POST com token de T.I. persistiu ${linhas?.length} linha(s) (status do POST: ${r.status})`);
  });

  test('DELETE anônimo em /realtime_sinal não apaga nada', async () => {
    const antes = await corpoDe(await rest('realtime_sinal?select=id&order=id.desc&limit=100'));
    await rest(`realtime_sinal?canal=eq.ticket`, { method: 'DELETE' });
    const depois = await corpoDe(await rest('realtime_sinal?select=id&order=id.desc&limit=100'));
    assert.ok(Array.isArray(antes) && Array.isArray(depois), 'GET de controle falhou');
    // pode ter chegado sinal novo no meio; o que não pode é ter diminuído
    assert.ok(depois.length >= antes.length - 2,
      `DELETE anônimo parece ter apagado linhas: ${antes.length} -> ${depois.length}`);
  });
});
