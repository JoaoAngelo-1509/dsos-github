// DSos — testes do login em dois fatores (2FA) por e-mail
//
// Mesmo formato de tests/seguranca.test.js: runner nativo do Node, sem
// dependências, credenciais por variável de ambiente.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   node --test tests/dois-fatores.test.js
//
// Variáveis opcionais:
//   OTP_FN_SLUG                — slug da edge function que envia o código
//                                (padrão: fn-enviar-otp)
//   SUPABASE_SERVICE_ROLE_KEY  — habilita os testes de código EXPIRADO e de
//                                REUSO, que precisam plantar uma linha em
//                                otp_ti com hora de expiração no passado.
//                                Sem ela esses dois testes são pulados, e é
//                                assim mesmo: se o cliente conseguisse criar
//                                um OTP arbitrário, o 2FA não valeria nada.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUE ESTES TESTES EXISTEM
//
// O 2FA do DSos estava inteiro no banco e desligado: existiam a tabela
// public.otp_ti, as funções rpc_gerar_otp_ti / rpc_verificar_otp_ti e a
// coluna usuario_ti.email, mas o login de T.I. continuava sendo só
// usuário+senha. Ligar isso tem uma armadilha específica:
//
//   rpc_gerar_otp_ti DEVOLVE o código no próprio JSON de retorno.
//
// Enquanto a anon key puder executar essa função, quem descobre a senha
// pede o código pelo mesmo canal e recebe os dois juntos — o segundo fator
// deixa de ser um segundo fator. Medido em 23/08/2026 contra produção, com
// um usuário de teste descartável:
//
//   POST /rest/v1/rpc/rpc_gerar_otp_ti   {"p_ti_id": 13}
//   HTTP 200
//   {"ok": true, "email": "...", "nome": "...", "codigo": "562849"}
//
//   POST /rest/v1/rpc/rpc_verificar_otp_ti  {"p_ti_id":13,"p_codigo":"562849"}
//   HTTP 200  {"ok": true}
//
// Ou seja: dava para completar o segundo fator sozinho, sem nunca abrir um
// e-mail. O desenho correto é o código só existir dentro da edge function
// que envia o e-mail (que roda com service role) e a função de gerar ficar
// fora do alcance da anon key.
//
// O que cada bloco trava:
//   2FA-00  o e-mail precisa ser gravável — sem isso o 2FA é código morto
//   2FA-01  a anon key não pode gerar OTP nem ver o código  ← o teste central
//   2FA-02  otp_ti não devolve linha nenhuma pela REST
//   2FA-03  código errado/expirado/reusado é recusado
//   2FA-04  quem NÃO tem e-mail continua entrando direto (não quebrar ninguém)
//   2FA-05  quem TEM e-mail não consegue token de sessão pulando o OTP
//   2FA-06  a edge function que envia o e-mail nunca devolve o código
//
// Os testes criam usuários T.I. descartáveis (prefixo `t2fa`) e os removem
// no final, inclusive quando algum teste falha. O e-mail usado é do domínio
// reservado `.invalid`, que por definição não entrega em lugar nenhum.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FN_SLUG = process.env.OTP_FN_SLUG || 'fn-enviar-otp';

const PREFIXO = 't2fa';
const SENHA = 'Teste#2fa!2026';
const TOKEN_SESSAO = /^[0-9a-f]{64}$/i;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const rest = (caminho, opts = {}) =>
  fetch(`${URL}/rest/v1/${caminho}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });

const rpc = (nome, corpo) =>
  rest(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(corpo) });

// Só usado nos testes de expirado/reuso, e só quando a chave é fornecida.
const restAdmin = (caminho, opts = {}) =>
  fetch(`${URL}/rest/v1/${caminho}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

const jsonOuTexto = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};

// ─── fixtures ────────────────────────────────────────────────────────────

const criados = [];   // ids a remover no final

async function criarTI({ comEmail }) {
  const login = `${PREFIXO}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${login}@example.invalid`;

  const r = await rpc('rpc_cadastrar_ti', {
    p_login: login, p_nome: 'Usuario de teste 2FA', p_senha: SENHA,
    p_email: comEmail ? email : null, p_is_professor: false, p_disciplina: null,
  });
  assert.ok(r.ok, `rpc_cadastrar_ti falhou (${r.status}) — sem fixture não há teste`);
  const [criado] = await r.json();
  assert.ok(criado?.id, 'rpc_cadastrar_ti não devolveu id');
  criados.push(criado.id);

  if (comEmail) {
    // rpc_cadastrar_ti aceita p_email e não grava (ver 2FA-00). Enquanto isso
    // não for corrigido, o e-mail da fixture é gravado pelo overload de 6
    // argumentos de rpc_atualizar_ti — o único caminho que hoje funciona.
    await rpc('rpc_atualizar_ti', {
      p_id: criado.id, p_nome: 'Usuario de teste 2FA', p_nova_senha: null,
      p_email: email, p_is_professor: false, p_disciplina: null,
    });
  }

  return { id: criado.id, login, email: comEmail ? email : null };
}

async function removerTI(id) {
  try {
    await rpc('rpc_deletar_ti', { p_id: id });
  } catch { /* limpeza é best-effort: nunca deve mascarar a falha do teste */ }
}

async function lerEmail(id) {
  const r = await rest(`usuario_ti?select=id,email&id=eq.${id}`);
  if (!r.ok) return undefined;
  const [linha] = await r.json();
  return linha?.email ?? null;
}

let comEmail;   // usuário T.I. com e-mail cadastrado
let semEmail;   // usuário T.I. sem e-mail (fluxo antigo, sem 2FA)

before(async () => {
  assert.ok(URL, 'defina SUPABASE_URL');
  assert.ok(KEY, 'defina SUPABASE_ANON_KEY');

  // Varre sobras de execuções anteriores que tenham morrido no meio.
  const r = await rest(`usuario_ti?select=id,login&login=like.${PREFIXO}*`);
  if (r.ok) {
    for (const u of await r.json()) await removerTI(u.id);
  }

  try {
    comEmail = await criarTI({ comEmail: true });
    semEmail = await criarTI({ comEmail: false });
  } catch (e) {
    for (const id of criados.splice(0)) await removerTI(id);
    throw e;
  }
});

after(async () => {
  for (const id of criados.splice(0)) await removerTI(id);
});

// ─── 2FA-00 ──────────────────────────────────────────────────────────────
// Sem e-mail gravado, rpc_gerar_otp_ti responde {ok:false, erro:'sem_email'}
// e o 2FA nunca dispara para ninguém. Em 23/08/2026 os 6 usuários T.I. de
// produção tinham email NULL, e nenhum dos dois caminhos do painel grava:
// rpc_cadastrar_ti ignora p_email, e a chamada de 4 argumentos que o painel
// faz em rpc_atualizar_ti é ambígua para o PostgREST (PGRST203, HTTP 300).

describe('2FA-00 — o e-mail do técnico precisa ser gravável', () => {
  test('rpc_cadastrar_ti grava o e-mail que recebe em p_email', async () => {
    assert.equal(
      await lerEmail(comEmail.id), comEmail.email,
      'rpc_cadastrar_ti aceitou p_email e não gravou — sem e-mail o 2FA nunca dispara',
    );
  });

  test('rpc_atualizar_ti aceita a chamada de 4 argumentos do painel', async () => {
    // É exatamente o corpo que js/painel-ti.js envia ao salvar a edição.
    const r = await rpc('rpc_atualizar_ti', {
      p_id: semEmail.id, p_nome: 'Usuario de teste 2FA', p_nova_senha: null,
      p_email: `${semEmail.login}@example.invalid`,
    });
    assert.ok(
      r.ok,
      `rpc_atualizar_ti respondeu ${r.status} — o painel "salva" o e-mail e ` +
      'o banco descarta a chamada (sobrecarga ambígua)',
    );
    assert.equal(await lerEmail(semEmail.id), `${semEmail.login}@example.invalid`);

    // devolve a fixture ao estado sem e-mail, que é o que 2FA-04 exercita
    await rpc('rpc_atualizar_ti', {
      p_id: semEmail.id, p_nome: 'Usuario de teste 2FA', p_nova_senha: null,
      p_email: '', p_is_professor: false, p_disciplina: null,
    });
  });
});

// ─── 2FA-01 ──────────────────────────────────────────────────────────────
// O teste central. Enquanto a anon key executar rpc_gerar_otp_ti, quem tem
// a senha pede o código e recebe junto — não existe segundo fator.

describe('2FA-01 — o cliente não pode gerar o código OTP', () => {
  test('rpc_gerar_otp_ti não é executável com a anon key', async () => {
    const r = await rpc('rpc_gerar_otp_ti', { p_ti_id: comEmail.id });
    assert.ok(
      !r.ok,
      `rpc_gerar_otp_ti respondeu ${r.status} para a anon key — o navegador ` +
      'ainda consegue emitir o próprio código de segundo fator',
    );
  });

  test('nenhuma resposta de rpc_gerar_otp_ti pode conter o código', async () => {
    const r = await rpc('rpc_gerar_otp_ti', { p_ti_id: comEmail.id });
    const corpo = await jsonOuTexto(r);
    const codigo = corpo && typeof corpo === 'object' ? corpo.codigo : undefined;
    assert.equal(
      codigo, undefined,
      `o código OTP veio no retorno da RPC (${codigo}) — quem tem a senha ` +
      'recebe o segundo fator pelo mesmo canal',
    );
  });

  test('o código não vaza tampouco pela função de verificar', async () => {
    const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: '000000' });
    const corpo = await jsonOuTexto(r);
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? {});
    assert.ok(!/"codigo"/.test(texto), 'rpc_verificar_otp_ti passou a devolver o código');
  });
});

// ─── 2FA-02 ──────────────────────────────────────────────────────────────
// Atenção ao formato da asserção: otp_ti tem RLS com USING (false), então o
// PostgREST responde 200 com lista VAZIA, não erro. Cobrar !r.ok aqui daria
// falso negativo. O que importa é não voltar linha nenhuma.

describe('2FA-02 — otp_ti não é legível via REST', () => {
  for (const consulta of ['otp_ti?select=*&limit=5', 'otp_ti?select=codigo&limit=5', 'otp_ti?select=id,ti_id&limit=5']) {
    test(`${consulta} não devolve linha`, async () => {
      const r = await rest(consulta);
      if (!r.ok) return;                       // negado de vez: melhor ainda
      const linhas = await r.json();
      assert.equal(
        Array.isArray(linhas) ? linhas.length : 1, 0,
        `${consulta} devolveu linha — os códigos de segundo fator ficaram legíveis`,
      );
    });
  }

  test('a tabela não expõe o código nem por filtro direto', async () => {
    const r = await rest(`otp_ti?select=*&ti_id=eq.${comEmail.id}`);
    if (!r.ok) return;
    assert.equal((await r.json()).length, 0, 'otp_ti respondeu ao filtro por ti_id');
  });
});

// ─── 2FA-03 ──────────────────────────────────────────────────────────────

describe('2FA-03 — código inválido, expirado ou reusado é recusado', () => {
  test('código errado é recusado', async () => {
    const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: '000000' });
    const corpo = await jsonOuTexto(r);
    assert.notEqual(corpo?.ok, true, 'rpc_verificar_otp_ti aprovou um código arbitrário');
  });

  test('usuário sem OTP ativo não passa com código nenhum', async () => {
    const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: semEmail.id, p_codigo: '123456' });
    const corpo = await jsonOuTexto(r);
    assert.notEqual(corpo?.ok, true, 'aprovou código para quem nunca pediu OTP');
  });

  test('força bruta: 12 códigos seguidos, nenhum passa', async () => {
    for (let i = 0; i < 12; i++) {
      const codigo = String(i * 83651 % 1000000).padStart(6, '0');
      const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: codigo });
      const corpo = await jsonOuTexto(r);
      assert.notEqual(corpo?.ok, true, `o código ${codigo} foi aceito na tentativa ${i + 1}`);
    }
  });

  test('nenhuma recusa devolve token de sessão', async () => {
    const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: '999999' });
    const texto = JSON.stringify(await jsonOuTexto(r));
    assert.ok(
      !TOKEN_SESSAO.test(String(JSON.parse(texto || '{}')?.token || '')),
      'a verificação recusou o código e mesmo assim entregou um token',
    );
  });

  test('código expirado é recusado', async (t) => {
    if (!SERVICE_KEY) {
      t.skip('defina SUPABASE_SERVICE_ROLE_KEY para exercitar a expiração');
      return;
    }
    const codigo = '424242';
    const ins = await restAdmin('otp_ti', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ti_id: comEmail.id, codigo,
        criado_em: new Date(Date.now() - 3600e3).toISOString(),
        expira_em: new Date(Date.now() - 60e3).toISOString(),
        usado: false,
      }),
    });
    assert.ok(ins.ok, `não consegui plantar o OTP expirado (${ins.status})`);

    const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: codigo });
    const corpo = await jsonOuTexto(r);
    assert.notEqual(corpo?.ok, true, 'um código já expirado foi aceito');
    assert.equal(corpo?.erro, 'expirado', `esperava erro "expirado", veio ${JSON.stringify(corpo)}`);

    await restAdmin(`otp_ti?ti_id=eq.${comEmail.id}`, { method: 'DELETE' });
  });

  test('código já usado não vale uma segunda vez', async (t) => {
    if (!SERVICE_KEY) {
      t.skip('defina SUPABASE_SERVICE_ROLE_KEY para exercitar o reuso');
      return;
    }
    const codigo = '135790';
    const ins = await restAdmin('otp_ti', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ti_id: comEmail.id, codigo,
        criado_em: new Date().toISOString(),
        expira_em: new Date(Date.now() + 600e3).toISOString(),
        usado: false,
      }),
    });
    assert.ok(ins.ok, `não consegui plantar o OTP válido (${ins.status})`);

    const primeira = await jsonOuTexto(await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: codigo }));
    assert.equal(primeira?.ok, true, `o código válido foi recusado: ${JSON.stringify(primeira)}`);

    const segunda = await jsonOuTexto(await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: codigo }));
    assert.notEqual(segunda?.ok, true, 'o mesmo código passou duas vezes — dá para reusar o segundo fator');

    await restAdmin(`otp_ti?ti_id=eq.${comEmail.id}`, { method: 'DELETE' });
  });
});

// ─── 2FA-04 ──────────────────────────────────────────────────────────────
// A rede de proteção do lado do usuário: ligar 2FA não pode trancar do lado
// de fora quem não tem e-mail cadastrado. Hoje isso é a totalidade dos
// técnicos de produção, então este teste é o que separa "feature nova" de
// "ninguém mais entra no sistema".

describe('2FA-04 — quem não tem e-mail continua entrando direto', () => {
  test('o usuário de teste realmente não tem e-mail', async () => {
    const email = await lerEmail(semEmail.id);
    assert.ok(!email, `a fixture ficou com e-mail (${email}) e não testa o caso sem 2FA`);
  });

  test('rpc_login_ti devolve sessão utilizável para quem não tem e-mail', async () => {
    const r = await rpc('rpc_login_ti', { p_login: semEmail.login, p_senha: SENHA });
    assert.equal(r.status, 200, 'o login de quem não usa 2FA parou de responder');
    const linhas = await r.json();
    assert.equal(linhas.length, 1, 'login sem e-mail deixou de autenticar — usuário trancado fora');
    assert.match(
      String(linhas[0].token || ''), TOKEN_SESSAO,
      'login sem e-mail não devolveu mais o token de sessão de 64 hex (SEC-05)',
    );
  });

  test('credencial errada continua devolvendo lista vazia, sem pedir OTP', async () => {
    const r = await rpc('rpc_login_ti', { p_login: semEmail.login, p_senha: 'senha-errada' });
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.ok(
      Array.isArray(corpo) ? corpo.length === 0 : corpo?.ok !== true,
      'senha errada deixou de ser recusada',
    );
  });
});

// ─── 2FA-05 ──────────────────────────────────────────────────────────────

describe('2FA-05 — quem tem e-mail não pula a etapa do código', () => {
  test('rpc_login_ti não entrega token de sessão antes do OTP', async () => {
    const r = await rpc('rpc_login_ti', { p_login: comEmail.login, p_senha: SENHA });
    assert.equal(r.status, 200, 'o login de quem tem e-mail parou de responder');
    const corpo = await r.json();
    const token = Array.isArray(corpo) ? corpo[0]?.token : corpo?.token;
    assert.ok(
      !TOKEN_SESSAO.test(String(token || '')),
      'usuário com e-mail recebeu o token de sessão só com usuário+senha — ' +
      'o segundo fator é opcional na prática',
    );
  });

  test('o token não sai por nenhum outro campo da resposta', async () => {
    const r = await rpc('rpc_login_ti', { p_login: comEmail.login, p_senha: SENHA });
    const texto = await r.text();
    const achados = texto.match(/[0-9a-f]{64}/gi) || [];
    assert.equal(
      achados.length, 0,
      'a resposta do login traz uma string de 64 hex — token de sessão renomeado ainda é token',
    );
  });

  test('senha correta + código errado não abre sessão', async () => {
    await rpc('rpc_login_ti', { p_login: comEmail.login, p_senha: SENHA });
    const r = await rpc('rpc_verificar_otp_ti', { p_ti_id: comEmail.id, p_codigo: '111111' });
    const texto = await r.text();
    assert.ok(
      !/[0-9a-f]{64}/i.test(texto),
      'código errado depois da senha certa devolveu token de sessão',
    );
  });
});

// ─── 2FA-06 ──────────────────────────────────────────────────────────────
// Quem manda o e-mail é a única parte que pode ver o código. Se essa função
// devolver o código para quem a chama, ela vira o mesmo buraco que a RPC.

describe('2FA-06 — a edge function de e-mail nunca devolve o código', () => {
  test(`${FN_SLUG} existe`, async () => {
    const r = await fetch(`${URL}/functions/v1/${FN_SLUG}`, {
      method: 'POST', headers, body: JSON.stringify({ ti_id: comEmail.id }),
    });
    assert.notEqual(r.status, 404, `a edge function ${FN_SLUG} não está publicada`);
  });

  test('a resposta não traz o código nem o e-mail inteiro', async () => {
    const r = await fetch(`${URL}/functions/v1/${FN_SLUG}`, {
      method: 'POST', headers, body: JSON.stringify({ ti_id: comEmail.id }),
    });
    const texto = await r.text();
    assert.ok(!/"codigo"/.test(texto), `${FN_SLUG} devolveu o código no corpo da resposta`);
    assert.ok(
      !texto.includes(comEmail.email),
      `${FN_SLUG} devolveu o e-mail sem mascarar — serve para enumerar destinatário`,
    );
  });
});
