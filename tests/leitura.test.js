// DSos — testes de LEITURA protegida por token de sessão
//
// Roda com o test runner nativo do Node (sem dependências, igual ao
// tests/seguranca.test.js):
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   node --test tests/leitura.test.js
//
// POR QUE ESTES TESTES EXISTEM
// A escrita já foi fechada com token de sessão (SEC-05). A leitura não: as
// policies `ticket_select`, `pc_select` e `mensagem_select` são `USING (true)`,
// e a anon key é pública — vai no bundle do site. Ou seja: hoje qualquer
// pessoa com a chave que está no HTML lê TODOS os chamados, o chat inteiro e
// as notas internas do T.I., sem nunca ter feito login.
//
// A correção esperada é validar o token no header HTTP `X-Sessao-Token`
// (confirmado que chega ao Postgres via `current_setting('request.headers')`)
// dentro das policies de SELECT, com a regra:
//
//   T.I.       → vê tudo
//   PC         → vê só os próprios chamados/mensagens (ticket.pc_origem = id)
//   professor  → vê só os que abriu (ticket.nome_solicitante = nome)
//   sem token  → não vê nada de ticket/mensagem
//
// ESTES TESTES DEVEM FALHAR ENQUANTO A LEITURA ESTIVER ABERTA. Um teste de
// segurança que passa antes da correção não prova nada. Os blocos marcados
// como "trava" abaixo reprovam hoje, de propósito.
//
// O QUE CADA BLOCO TRAVA
//
//   sem token           trava o vazamento principal: GET /ticket e /mensagem
//                       sem `X-Sessao-Token` não podem devolver linha nenhuma.
//                       Vazio ou erro servem; dado, não.
//
//   token de T.I.       trava o excesso de zelo: o T.I. precisa continuar
//                       enxergando os chamados de todo mundo, senão o painel
//                       principal fica cego. É guarda de regressão, não de
//                       segurança — passa hoje e tem que continuar passando.
//
//   isolamento entre    o teste que mais importa. Não basta o PC "voltar
//   PCs                 alguma coisa": o chamado e o chat de OUTRO PC têm que
//                       sumir. Verifica pela listagem, pelo filtro por id
//                       direto, pelo recurso embutido (PostgREST `select=`
//                       aninhado) e pela contagem do `content-range` — quatro
//                       caminhos por onde uma policy incompleta ainda vaza.
//
//   token inválido      trava o caso de token forjado/lixo: tem que ser
//                       tratado como "sem token", nunca como coringa.
//
//   professor           trava a regra do professor: vê o que abriu (casado por
//                       `nome_solicitante`, como o painel faz), não o resto.
//
//   não quebrar o app   as views `v_pc_pub`/`v_usuario_ti_pub` são
//                       `security_invoker=true` — leem `public.pc` e
//                       `public.usuario_ti` com o RLS de QUEM CHAMA. Se a
//                       policy de `pc` passar a exigir token, essas views
//                       silenciosamente devolvem `[]` e os painéis param de
//                       listar PCs sem dar erro nenhum. Este bloco é o alarme
//                       para isso, mais os três RPCs de login.
//
//   bypass por RPC      `rpc_nao_lidas_por_ticket()` é SECURITY DEFINER e não
//                       recebe token: ela ignora RLS por construção. Fechar só
//                       as policies NÃO fecha esse caminho — ele continua
//                       entregando o id de todo chamado aberto a quem tiver a
//                       anon key. Ver a nota no bloco.
//
// DADOS DE TESTE
// A suíte cria o que precisa (2 PCs, 2 usuários T.I., 1 professor, 3 chamados
// e 4 mensagens), todos com o prefixo `ZZTESTE-` e um sufixo aleatório, e
// apaga tudo no `after` — que o runner executa mesmo quando um teste falha ou
// quando o próprio setup quebra. A limpeza é defensiva: cada passo é
// independente, então uma falha no meio não deixa o resto para trás.
//
// Sobra apenas a linha em `public.sessao_token` de cada login feito aqui:
// não há caminho anon para apagá-la (a tabela não tem policy nenhuma, de
// propósito). Elas expiram em 12h e o próprio `fn_emitir_token` remove as
// vencidas no login seguinte.
//
// SOBRE "TOKEN EXPIRADO"
// Não dá para forjar um token genuinamente expirado só com a anon key: seria
// preciso escrever `expira_em` no passado em `public.sessao_token`, que é
// (corretamente) inacessível. O teste cobre o token inexistente/forjado, que
// percorre exatamente o mesmo caminho: `fn_sessao_do_token` filtra com
// `WHERE token = p_token AND expira_em > now()`, então token vencido e token
// que não existe caem no mesmo `NOT FOUND`. Se a policy usar outro predicado
// que não esse, vale conferir o caso expirado à mão.

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

/** Header de sessão. `null`/`undefined` = requisição anônima, sem o header. */
const comToken = (token) => (token == null ? {} : { 'X-Sessao-Token': token });

const rpc = (nome, corpo, token) =>
  rest(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(corpo), headers: comToken(token) });

/** Corpo JSON tolerante a resposta vazia (204) ou não-JSON. */
const corpoDe = async (r) => {
  const txt = await r.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
};

/**
 * A regra "nunca dados": erro serve, lista vazia serve, linha não serve.
 * Usado em todo ponto onde a resposta esperada é "você não tem nada aqui".
 */
async function assertSemDados(r, oque) {
  if (!r.ok) return; // erro é uma resposta aceitável
  const corpo = await corpoDe(r);
  assert.ok(Array.isArray(corpo), `${oque}: resposta 200 que não é lista — ${JSON.stringify(corpo)}`);
  assert.equal(corpo.length, 0, `${oque}: vazou ${corpo.length} linha(s) — ${JSON.stringify(corpo).slice(0, 300)}`);
}

/** GET que precisa dar certo; devolve a lista. */
async function lista(caminho, token, oque) {
  const r = await rest(caminho, { headers: comToken(token) });
  const corpo = await corpoDe(r);
  assert.ok(r.ok, `${oque}: GET falhou com ${r.status} — ${JSON.stringify(corpo).slice(0, 300)}`);
  assert.ok(Array.isArray(corpo), `${oque}: esperava lista, veio ${JSON.stringify(corpo).slice(0, 200)}`);
  return corpo;
}

/** Total do `content-range` de uma resposta com `Prefer: count=exact`. */
const totalDe = (r) => {
  const cr = r.headers.get('content-range') || '';
  const total = cr.split('/')[1];
  return total === '*' ? null : Number(total);
};

// ── Dados de teste ─────────────────────────────────────────────────────────

const N = randomBytes(4).toString('hex').toUpperCase(); // sufixo único da rodada
const SENHA = `Zz!${randomBytes(6).toString('hex')}`;
const PREFIXO = `ZZTESTE-${N}`;

/** Tudo que precisa ser apagado no fim. Preenchido conforme vai sendo criado. */
const criados = { pcs: [], tis: [], professores: [] };

const f = {}; // fixtures: pcA, pcB, ti, prof, ticketA, ticketB, ticketProf...

async function criarPC(sufixo) {
  const tag = `${PREFIXO}-PC${sufixo}`;
  const r = await rpc('rpc_cadastrar_pc', {
    p_tag: tag, p_laboratorio: `${PREFIXO}-LAB`, p_lado: 'A', p_senha: SENHA,
  });
  const corpo = await corpoDe(r);
  assert.ok(r.ok, `setup: rpc_cadastrar_pc(${tag}) falhou ${r.status} — ${JSON.stringify(corpo)}`);
  const pc = Array.isArray(corpo) ? corpo[0] : corpo;
  assert.ok(pc?.id, `setup: rpc_cadastrar_pc não devolveu id — ${JSON.stringify(corpo)}`);
  criados.pcs.push(pc.id);

  const rl = await rpc('rpc_login_pc', { p_tag: tag, p_senha: SENHA });
  const login = await corpoDe(rl);
  assert.ok(Array.isArray(login) && login[0]?.token,
    `setup: rpc_login_pc(${tag}) não devolveu token — ${JSON.stringify(login)}`);
  return { ...pc, tag, token: login[0].token };
}

async function criarTI(sufixo, ehProfessor) {
  const login = `${PREFIXO}-TI${sufixo}`.toLowerCase();
  const nome = `${PREFIXO} Usuario ${sufixo}`;
  const r = await rpc('rpc_cadastrar_ti', {
    p_login: login, p_nome: nome, p_senha: SENHA,
    p_email: null, p_is_professor: !!ehProfessor, p_disciplina: ehProfessor ? 'Teste' : null,
  });
  const corpo = await corpoDe(r);
  assert.ok(r.ok, `setup: rpc_cadastrar_ti(${login}) falhou ${r.status} — ${JSON.stringify(corpo)}`);
  const u = Array.isArray(corpo) ? corpo[0] : corpo;
  assert.ok(u?.id, `setup: rpc_cadastrar_ti não devolveu id — ${JSON.stringify(corpo)}`);
  criados.tis.push(u.id);
  if (u.professor_id) criados.professores.push(u.professor_id);

  const rl = await rpc('rpc_login_ti', { p_login: login, p_senha: SENHA });
  const l = await corpoDe(rl);
  assert.ok(Array.isArray(l) && l[0]?.token,
    `setup: rpc_login_ti(${login}) não devolveu token — ${JSON.stringify(l)}`);
  return { ...u, login, nome, token: l[0].token };
}

/**
 * Cria um chamado. Insere com o token do T.I. de propósito: depois da
 * correção, o `return=representation` só devolve a linha para quem pode
 * lê-la, e o T.I. é justamente quem enxerga tudo. Se ainda assim vier vazio,
 * cai para a busca pelo marcador único da descrição.
 */
async function criarTicket({ pcId, solicitante, marcador }) {
  const corpoTicket = {
    pc_origem: pcId, pc_problema: pcId,
    tipo: 'hardware', descricao: marcador,
    laboratorio: `${PREFIXO}-LAB`, lado: 'A',
    status: 'aberto', prioridade: 'baixo',
    nome_solicitante: solicitante,
    nota_interna: `nota interna secreta ${marcador}`,
  };
  const r = await rest('ticket', {
    method: 'POST',
    body: JSON.stringify(corpoTicket),
    headers: { ...comToken(f.ti?.token), Prefer: 'return=representation' },
  });
  const c = await corpoDe(r);
  assert.ok(r.ok, `setup: INSERT em ticket falhou ${r.status} — ${JSON.stringify(c)}`);

  let t = Array.isArray(c) ? c[0] : c;
  if (!t?.id) {
    const achados = await lista(
      `ticket?descricao=eq.${encodeURIComponent(marcador)}&select=*`, f.ti?.token, 'setup: busca do ticket');
    t = achados[0];
  }
  assert.ok(t?.id, `setup: não consegui recuperar o id do chamado ${marcador}`);
  return t;
}

async function criarMensagem(ticketId, remetente, texto) {
  const r = await rest('mensagem', {
    method: 'POST',
    body: JSON.stringify({ ticket_id: ticketId, remetente, conteudo: texto, nome_remetente: PREFIXO }),
    headers: { ...comToken(f.ti?.token), Prefer: 'return=representation' },
  });
  const c = await corpoDe(r);
  assert.ok(r.ok, `setup: INSERT em mensagem falhou ${r.status} — ${JSON.stringify(c)}`);
}

before(async () => {
  assert.ok(URL, 'defina SUPABASE_URL');
  assert.ok(KEY, 'defina SUPABASE_ANON_KEY');

  // T.I. primeiro: o token dele é usado para inserir os chamados.
  f.ti = await criarTI('A', false);
  f.profTi = await criarTI('P', true);

  const rp = await rpc('rpc_login_professor', { p_login: f.profTi.login, p_senha: SENHA });
  const lp = await corpoDe(rp);
  assert.ok(Array.isArray(lp) && lp[0]?.token,
    `setup: rpc_login_professor não devolveu token — ${JSON.stringify(lp)}`);
  f.prof = { ...lp[0], token: lp[0].token };

  f.pcA = await criarPC('A');
  f.pcB = await criarPC('B');

  f.ticketA = await criarTicket({ pcId: f.pcA.id, solicitante: f.pcA.tag, marcador: `${PREFIXO}-CHAMADO-A` });
  f.ticketB = await criarTicket({ pcId: f.pcB.id, solicitante: f.pcB.tag, marcador: `${PREFIXO}-CHAMADO-B` });
  // Chamado do professor: mora no PC A, mas pertence ao professor pelo nome —
  // é assim que o painel casa os dois (`nome_solicitante=eq.<nome>`).
  f.ticketProf = await criarTicket({ pcId: f.pcA.id, solicitante: f.prof.nome, marcador: `${PREFIXO}-CHAMADO-PROF` });

  await criarMensagem(f.ticketA.id, 'PC', `${PREFIXO}-MSG-A`);
  await criarMensagem(f.ticketA.id, 'TI', `${PREFIXO}-RESPOSTA-A`);
  await criarMensagem(f.ticketB.id, 'PC', `${PREFIXO}-MSG-B`);
  await criarMensagem(f.ticketProf.id, 'PC', `${PREFIXO}-MSG-PROF`);
});

after(async () => {
  // Ordem importa e cada passo é isolado: uma falha no meio não pode impedir
  // os outros. `rpc_deletar_pc` já leva junto os chamados e as mensagens do PC
  // (inclusive o chamado do professor, que mora no PC A) — por isso ele vem
  // antes de `rpc_deletar_professor`, que se recusa a apagar professor com
  // chamado em aberto.
  for (const id of criados.pcs) {
    try { await rpc('rpc_deletar_pc', { p_id: id }); }
    catch (e) { console.error(`limpeza: falhou ao apagar pc ${id}:`, e.message); }
  }
  // Os usuários T.I. saem antes do professor: `usuario_ti.professor_id`
  // referencia `professor.id`.
  for (const id of criados.tis) {
    try { await rpc('rpc_deletar_ti', { p_id: id }); }
    catch (e) { console.error(`limpeza: falhou ao apagar usuario_ti ${id}:`, e.message); }
  }
  for (const id of criados.professores) {
    try { await rpc('rpc_deletar_professor', { p_professor_id: id }); }
    catch (e) { console.error(`limpeza: falhou ao apagar professor ${id}:`, e.message); }
  }

  // Confere que não sobrou nada com o prefixo desta rodada.
  const sobrou = await rest(`pc?tag=like.${PREFIXO}*&select=id,tag`, { headers: comToken(f.ti?.token) });
  if (sobrou.ok) {
    const linhas = await corpoDe(sobrou);
    if (Array.isArray(linhas) && linhas.length) {
      console.error(`limpeza: sobraram PCs de teste — apague à mão: ${JSON.stringify(linhas)}`);
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────

describe('sem token — a anon key sozinha não pode ler chamado nem chat', () => {
  test('GET /ticket sem token não devolve chamado nenhum', async () => {
    const r = await rest('ticket?select=*&limit=100');
    await assertSemDados(r, 'ticket sem token');
  });

  test('GET /mensagem sem token não devolve mensagem nenhuma', async () => {
    const r = await rest('mensagem?select=*&limit=100');
    await assertSemDados(r, 'mensagem sem token');
  });

  test('a nota interna do T.I. não sai sem token', async () => {
    // Coluna sensível pedida diretamente: é o texto que o T.I. escreve
    // achando que só a equipe lê.
    const r = await rest('ticket?select=id,nota_interna&nota_interna=not.is.null&limit=100');
    await assertSemDados(r, 'nota_interna sem token');
  });

  test('filtrar por id direto também não devolve o chamado', async () => {
    // Uma policy que só filtra a listagem, mas deixa passar o acesso pontual,
    // continua vazando — o id é sequencial e fácil de adivinhar.
    const r = await rest(`ticket?id=eq.${f.ticketA.id}&select=*`);
    await assertSemDados(r, `ticket?id=eq.${f.ticketA.id} sem token`);
  });
});

describe('token de T.I. — continua vendo tudo (guarda de regressão)', () => {
  test('T.I. lê os chamados dos dois PCs e o do professor', async () => {
    const ids = (await lista('ticket?select=id&limit=1000', f.ti.token, 'ticket com token T.I.')).map((t) => t.id);
    for (const [rotulo, t] of [['A', f.ticketA], ['B', f.ticketB], ['do professor', f.ticketProf]]) {
      assert.ok(ids.includes(t.id), `T.I. deixou de enxergar o chamado ${rotulo} (#${t.id}) — o painel principal fica cego`);
    }
  });

  test('T.I. lê o chat dos dois PCs', async () => {
    const msgs = await lista(
      `mensagem?ticket_id=in.(${f.ticketA.id},${f.ticketB.id})&select=id,ticket_id`, f.ti.token, 'mensagem com token T.I.');
    const tickets = new Set(msgs.map((m) => m.ticket_id));
    assert.ok(tickets.has(f.ticketA.id), 'T.I. não vê o chat do PC A');
    assert.ok(tickets.has(f.ticketB.id), 'T.I. não vê o chat do PC B');
  });

  test('T.I. lê a nota interna', async () => {
    const linhas = await lista(
      `ticket?id=eq.${f.ticketA.id}&select=id,nota_interna`, f.ti.token, 'nota_interna com token T.I.');
    assert.equal(linhas.length, 1, 'T.I. não consegue mais abrir o chamado');
    assert.ok(linhas[0].nota_interna, 'a nota interna sumiu para o T.I.');
  });
});

describe('isolamento entre PCs — o teste que mais importa', () => {
  test('PC A lê os próprios chamados', async () => {
    const ids = (await lista('ticket?select=id&limit=1000', f.pcA.token, 'ticket com token do PC A')).map((t) => t.id);
    assert.ok(ids.includes(f.ticketA.id), `o PC A não enxerga o próprio chamado #${f.ticketA.id}`);
  });

  test('PC A NÃO lê o chamado do PC B', async () => {
    const ids = (await lista('ticket?select=id&limit=1000', f.pcA.token, 'ticket com token do PC A')).map((t) => t.id);
    assert.ok(!ids.includes(f.ticketB.id),
      `o PC A está lendo o chamado #${f.ticketB.id}, que é do PC B — leitura ainda aberta`);
  });

  test('PC A NÃO alcança o chamado do PC B nem filtrando pelo id', async () => {
    const r = await rest(`ticket?id=eq.${f.ticketB.id}&select=*`, { headers: comToken(f.pcA.token) });
    await assertSemDados(r, `PC A pedindo o ticket #${f.ticketB.id} pelo id`);
  });

  test('PC A lê o próprio chat', async () => {
    const msgs = await lista(
      `mensagem?ticket_id=eq.${f.ticketA.id}&select=id,conteudo`, f.pcA.token, 'chat próprio do PC A');
    assert.ok(msgs.length >= 2, `o PC A perdeu o próprio chat (veio ${msgs.length} mensagem)`);
  });

  test('PC A NÃO lê o chat do PC B', async () => {
    const r = await rest(`mensagem?ticket_id=eq.${f.ticketB.id}&select=*`, { headers: comToken(f.pcA.token) });
    await assertSemDados(r, `PC A lendo o chat do ticket #${f.ticketB.id}`);
  });

  test('PC A NÃO vê o chat alheio pelo recurso embutido do PostgREST', async () => {
    // `select=*,mensagem(*)` puxa o chat junto do chamado numa requisição só.
    // Policy aplicada em `ticket` mas esquecida em `mensagem` vaza por aqui.
    const linhas = await lista(
      'ticket?select=id,mensagem(id,conteudo)&limit=1000', f.pcA.token, 'ticket com mensagem embutida');
    const idsTicket = linhas.map((t) => t.id);
    assert.ok(!idsTicket.includes(f.ticketB.id), 'o chamado do PC B apareceu no embutido');

    const conteudos = linhas.flatMap((t) => (t.mensagem || []).map((m) => m.conteudo));
    assert.ok(!conteudos.includes(`${PREFIXO}-MSG-B`),
      'a mensagem do PC B veio embutida no chamado — a policy de mensagem não pegou o caminho aninhado');
  });

  test('PC A NÃO vê o chamado alheio pelo caminho inverso (mensagem → ticket)', async () => {
    const linhas = await lista(
      'mensagem?select=id,conteudo,ticket(id,nota_interna)&limit=1000', f.pcA.token, 'mensagem com ticket embutido');
    const conteudos = linhas.map((m) => m.conteudo);
    assert.ok(!conteudos.includes(`${PREFIXO}-MSG-B`), 'a mensagem do PC B saiu na listagem de mensagens');
    const notas = linhas.map((m) => m.ticket?.nota_interna).filter(Boolean);
    assert.ok(!notas.some((n) => n.includes(`${PREFIXO}-CHAMADO-B`)),
      'a nota interna do chamado do PC B veio embutida na mensagem');
  });

  test('a contagem exata não denuncia os chamados que o PC A não pode ver', async () => {
    // `Prefer: count=exact` devolve o total no header `content-range`. Se a
    // policy filtrar as linhas mas o total continuar sendo o da tabela toda,
    // dá para inferir quantos chamados existem — e o número volta a crescer a
    // cada chamado alheio aberto.
    const r = await rest('ticket?select=id&limit=1', {
      headers: { ...comToken(f.pcA.token), Prefer: 'count=exact' },
    });
    assert.ok(r.ok, `contagem falhou com ${r.status}`);
    const total = totalDe(r);
    assert.notEqual(total, null, 'o header content-range não trouxe o total');

    const rTi = await rest('ticket?select=id&limit=1', {
      headers: { ...comToken(f.ti.token), Prefer: 'count=exact' },
    });
    const totalTi = totalDe(rTi);
    assert.ok(total < totalTi,
      `o PC A conta ${total} chamados e o T.I. conta ${totalTi} — a contagem do PC não foi filtrada`);
  });
});

describe('token inválido — não é coringa', () => {
  // 64 hex, o formato exato que `fn_emitir_token` gera, mas que nunca foi
  // emitido. Sobre o caso "expirado", ver a nota no topo do arquivo.
  const forjado = randomBytes(32).toString('hex');

  for (const [rotulo, token] of [
    ['forjado com o formato certo', forjado],
    ['lixo qualquer', 'nao-sou-um-token'],
    ['vazio', ''],
  ]) {
    test(`token ${rotulo} não lê chamado`, async () => {
      const r = await rest('ticket?select=*&limit=100', { headers: comToken(token) });
      await assertSemDados(r, `ticket com token ${rotulo}`);
    });

    test(`token ${rotulo} não lê mensagem`, async () => {
      const r = await rest('mensagem?select=*&limit=100', { headers: comToken(token) });
      await assertSemDados(r, `mensagem com token ${rotulo}`);
    });
  }

  test('o token de um PC não vale como token de outro depois de trocado o id', async () => {
    // Tentativa ingênua de escalar: usar o token do PC A pedindo explicitamente
    // o chamado do PC B. Já coberto acima, mas aqui fica claro que a proteção
    // é do lado do banco e não da montagem do filtro no frontend.
    const r = await rest(`ticket?pc_origem=eq.${f.pcB.id}&select=*`, { headers: comToken(f.pcA.token) });
    await assertSemDados(r, 'PC A filtrando por pc_origem do PC B');
  });
});

describe('professor — vê os que abriu, e só', () => {
  test('professor lê o chamado que abriu', async () => {
    const ids = (await lista('ticket?select=id&limit=1000', f.prof.token, 'ticket com token de professor')).map((t) => t.id);
    assert.ok(ids.includes(f.ticketProf.id),
      `o professor não enxerga o chamado #${f.ticketProf.id} que ele mesmo abriu`);
  });

  test('professor NÃO lê o chamado de um PC', async () => {
    const ids = (await lista('ticket?select=id&limit=1000', f.prof.token, 'ticket com token de professor')).map((t) => t.id);
    assert.ok(!ids.includes(f.ticketB.id),
      `o professor está lendo o chamado #${f.ticketB.id}, que é do PC B`);
  });

  test('professor NÃO lê o chat de um chamado alheio', async () => {
    const r = await rest(`mensagem?ticket_id=eq.${f.ticketB.id}&select=*`, { headers: comToken(f.prof.token) });
    await assertSemDados(r, `professor lendo o chat do ticket #${f.ticketB.id}`);
  });

  test('professor lê o chat do próprio chamado', async () => {
    const msgs = await lista(
      `mensagem?ticket_id=eq.${f.ticketProf.id}&select=id`, f.prof.token, 'chat próprio do professor');
    assert.ok(msgs.length >= 1, 'o professor perdeu o chat do próprio chamado');
  });
});

describe('a correção não pode quebrar o app', () => {
  // `v_pc_pub` e `v_usuario_ti_pub` são `security_invoker=true`: leem `pc` e
  // `usuario_ti` com o RLS de quem chama. Se `pc_select` passar a exigir
  // token, a view devolve `[]` — status 200, sem erro, e o painel simplesmente
  // fica sem PCs. É a falha mais silenciosa que essa mudança pode causar.
  test('v_pc_pub continua listando os PCs para o T.I. (painel de PCs)', async () => {
    const linhas = await lista('v_pc_pub?select=*&order=tag.asc', f.ti.token, 'v_pc_pub com token T.I.');
    assert.ok(linhas.length > 0, 'v_pc_pub devolveu lista vazia para o T.I. — o painel de PCs fica em branco');
    for (const col of ['senha', 'senha_hash']) {
      assert.ok(!(col in linhas[0]), `v_pc_pub passou a expor ${col}`);
    }
  });

  test('v_pc_pub devolve o próprio PC para o PC logado (checagem de status_pc)', async () => {
    // painel-pc.js faz `v_pc_pub?id=eq.<session.id>&select=status_pc` para
    // saber se o PC foi descartado.
    const linhas = await lista(
      `v_pc_pub?id=eq.${f.pcA.id}&select=status_pc`, f.pcA.token, 'v_pc_pub do próprio PC');
    assert.equal(linhas.length, 1, 'o PC não consegue mais consultar o próprio status em v_pc_pub');
  });

  test('v_usuario_ti_pub continua respondendo e não vaza senha', async () => {
    const linhas = await lista('v_usuario_ti_pub?select=*', f.ti.token, 'v_usuario_ti_pub com token T.I.');
    assert.ok(linhas.length > 0, 'v_usuario_ti_pub devolveu lista vazia — a lista de técnicos some do painel');
    for (const col of ['senha', 'senha_hash']) {
      assert.ok(!(col in linhas[0]), `v_usuario_ti_pub passou a expor ${col}`);
    }
  });

  test('as views não passam a dar erro para quem ainda não tem token', async () => {
    // A tela de login e o primeiro carregamento acontecem sem token. Podem vir
    // vazias (decisão de projeto), mas não podem virar 4xx/5xx.
    for (const view of ['v_pc_pub', 'v_usuario_ti_pub']) {
      const r = await rest(`${view}?select=*&limit=1`);
      assert.equal(r.status, 200, `${view} sem token respondeu ${r.status} — a tela quebra antes do login`);
    }
  });

  test('os três RPCs de login continuam devolvendo token de 64 hex', async () => {
    const casos = [
      ['rpc_login_ti', { p_login: f.ti.login, p_senha: SENHA }],
      ['rpc_login_pc', { p_tag: f.pcA.tag, p_senha: SENHA }],
      ['rpc_login_professor', { p_login: f.profTi.login, p_senha: SENHA }],
    ];
    for (const [nome, corpo] of casos) {
      const r = await rpc(nome, corpo);
      const c = await corpoDe(r);
      assert.ok(r.ok, `${nome} respondeu ${r.status} — ${JSON.stringify(c)}`);
      assert.ok(Array.isArray(c) && c.length === 1, `${nome} não devolveu o usuário — ${JSON.stringify(c)}`);
      assert.match(c[0].token || '', /^[0-9a-f]{64}$/, `${nome} devolveu token fora do formato`);
    }
  });

  test('login com credencial errada continua devolvendo lista vazia', async () => {
    const r = await rpc('rpc_login_pc', { p_tag: f.pcA.tag, p_senha: 'senha-errada-de-proposito' });
    assert.equal(r.status, 200);
    assert.deepEqual(await corpoDe(r), []);
  });

  test('abrir chamado continua funcionando para o PC dono', async () => {
    // Se a correção mexer em `ticket` de forma ampla demais, o INSERT com
    // `return=representation` deixa de devolver a linha e o painel perde o id
    // do chamado recém-aberto (`Chamado #—`).
    const marcador = `${PREFIXO}-CHAMADO-SMOKE`;
    const r = await rest('ticket', {
      method: 'POST',
      headers: { ...comToken(f.pcA.token), Prefer: 'return=representation' },
      body: JSON.stringify({
        pc_origem: f.pcA.id, pc_problema: f.pcA.id, tipo: 'software',
        descricao: marcador, laboratorio: `${PREFIXO}-LAB`, lado: 'A',
        status: 'aberto', prioridade: 'baixo', nome_solicitante: f.pcA.tag,
      }),
    });
    const c = await corpoDe(r);
    assert.ok(r.ok, `INSERT de chamado pelo PC dono falhou ${r.status} — ${JSON.stringify(c)}`);
    assert.ok(Array.isArray(c) && c[0]?.id,
      `o chamado foi criado mas não voltou para o PC que o abriu — o painel mostraria "Chamado #—". Resposta: ${JSON.stringify(c)}`);
    // Some junto com o PC A na limpeza (rpc_deletar_pc leva os chamados dele).
  });
});

describe('bypass por RPC SECURITY DEFINER — o que fechar policy não resolve', () => {
  // `rpc_nao_lidas_por_ticket()` é SECURITY DEFINER, não recebe token e
  // agrega TODAS as mensagens dos chamados abertos. Ela ignora RLS por
  // construção: mesmo com as policies de SELECT corrigidas, esta RPC continua
  // entregando o id de todo chamado aberto (e quantas mensagens não lidas ele
  // tem) para quem só tem a anon key. O painel do PC a chama sem filtro
  // nenhum — a correção precisa passar o token e filtrar por dono, ou trocar
  // por SECURITY INVOKER.
  test('rpc_nao_lidas_por_ticket não entrega chamados de terceiros sem token', async () => {
    const r = await rpc('rpc_nao_lidas_por_ticket', {});
    if (!r.ok) return; // recusar sem token também resolve
    const linhas = await corpoDe(r);
    assert.ok(Array.isArray(linhas), `resposta inesperada — ${JSON.stringify(linhas).slice(0, 200)}`);
    const ids = linhas.map((l) => l.ticket_id);
    assert.ok(!ids.includes(f.ticketA.id) && !ids.includes(f.ticketB.id),
      `a RPC devolveu os chamados #${f.ticketA.id}/#${f.ticketB.id} sem token nenhum — ela é SECURITY DEFINER e passa por cima do RLS`);
  });

  test('rpc_nao_lidas_por_ticket não entrega o chamado alheio para o PC A', async () => {
    const r = await rpc('rpc_nao_lidas_por_ticket', {}, f.pcA.token);
    if (!r.ok) return;
    const linhas = await corpoDe(r);
    assert.ok(Array.isArray(linhas), `resposta inesperada — ${JSON.stringify(linhas).slice(0, 200)}`);
    const ids = linhas.map((l) => l.ticket_id);
    assert.ok(!ids.includes(f.ticketB.id),
      `a RPC contou as não lidas do chamado #${f.ticketB.id} (do PC B) para o PC A`);
  });
});
