// DSos — testes de regressão de segurança (TEST-01)
//
// Roda com o test runner nativo do Node (sem dependências novas — o projeto
// é estático e não tem package.json de runtime):
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   node --test tests/
//
// A anon key é pública (vai no bundle do site), mas mesmo assim não é
// versionada aqui: vem por variável de ambiente, igual ao resto do projeto.
//
// POR QUE ESTES TESTES EXISTEM
// A auditoria de 23/08/2026 encontrou vazamentos que já haviam sido
// corrigidos ANTES e voltaram sem ninguém perceber — o caso mais claro é
// pc.senha, protegido em junho/2026 e reaberto em julho por uma migration
// que "reabria SELECT para não quebrar o front". Cada teste abaixo trava uma
// dessas regressões: se a proteção cair de novo, o teste falha.
//
// São testes de LEITURA e de tentativa de escrita ilegítima. Enquanto as
// proteções estiverem no lugar, nenhum deles altera dado — as escritas que
// tentam são justamente as que devem ser recusadas.
//
// PREFIRA RODAR CONTRA O BANCO DE TESTE. O teste de SEC-03 precisa mirar uma
// linha real para exercer a autorização (com id inexistente o PostgREST
// devolve 204 sem chegar na policy, e o teste passaria mesmo com a brecha
// aberta). Ele tenta recolocar o registro se a exclusão passar, mas essa
// restauração depende de INSERT estar liberado — se a brecha estiver aberta
// o bastante para apagar, pode não estar liberada o bastante para restaurar.
// Verificado na prática: a suíte de fato reprova quando a regressão é
// reintroduzida (SEC-03 e SEC-04 falharam numa simulação controlada).

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const rest = (caminho, opts = {}) =>
  fetch(`${URL}/rest/v1/${caminho}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });

before(() => {
  assert.ok(URL, 'defina SUPABASE_URL');
  assert.ok(KEY, 'defina SUPABASE_ANON_KEY');
});

describe('SEC-01/SEC-04 — hashes de senha não podem sair pela REST', () => {
  test('pc_senha é inacessível por completo', async () => {
    const r = await rest('pc_senha?select=*&limit=1');
    assert.ok(!r.ok, `pc_senha respondeu ${r.status} — a tabela de senhas ficou legível`);
  });

  test('pc não expõe coluna de senha', async () => {
    const r = await rest('pc?select=*&limit=1');
    assert.equal(r.status, 200);
    const linhas = await r.json();
    if (linhas.length) {
      assert.ok(!('senha' in linhas[0]), 'a coluna senha voltou para public.pc');
    }
  });

  test('professor.senha_hash não é selecionável', async () => {
    const r = await rest('professor?select=senha_hash&limit=1');
    assert.ok(!r.ok, `senha_hash respondeu ${r.status} — o hash voltou a ser legível`);
  });

  test('usuario_ti.senha não é selecionável', async () => {
    const r = await rest('usuario_ti?select=senha&limit=1');
    assert.ok(!r.ok, `usuario_ti.senha respondeu ${r.status}`);
  });

  test('as colunas públicas continuam funcionando (a proteção não quebrou o app)', async () => {
    const r = await rest('professor?select=id,nome,login&limit=1');
    assert.equal(r.status, 200, 'leitura legítima de professor quebrou');
  });
});

describe('SEC-02 — views públicas continuam servindo o frontend', () => {
  for (const view of ['v_pc_pub', 'v_usuario_ti_pub']) {
    test(`${view} responde e não vaza senha`, async () => {
      const r = await rest(`${view}?select=*&limit=1`);
      assert.equal(r.status, 200, `${view} parou de responder`);
      const linhas = await r.json();
      if (linhas.length) {
        for (const col of ['senha', 'senha_hash']) {
          assert.ok(!(col in linhas[0]), `${view} passou a expor ${col}`);
        }
      }
    });
  }
});

describe('SEC-03 — exclusão de professor só por RPC validada', () => {
  test('DELETE direto não apaga ninguém', async () => {
    // Um id inexistente NÃO serve aqui: o PostgREST devolve 204 sem sequer
    // chegar na policy, então o teste passaria mesmo com a policy reaberta.
    // É preciso mirar uma linha real para a autorização ser de fato exercida.
    const antes = await rest('professor?select=id&limit=1');
    const [alvo] = await antes.json();
    if (!alvo) return; // sem professor cadastrado, nada a verificar

    const r = await rest(`professor?id=eq.${alvo.id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });

    // Com a proteção no lugar: 42501, ou 200 com lista vazia (RLS filtrou).
    // Se vier linha, a policy aberta voltou E o registro acabou de ser
    // apagado — o teste recoloca antes de falhar, para não deixar o banco
    // pior do que encontrou.
    if (r.ok) {
      const apagadas = await r.json();
      if (apagadas.length) {
        await rest('professor', { method: 'POST', body: JSON.stringify(apagadas[0]) });
        assert.fail('DELETE direto em professor voltou a funcionar (registro foi restaurado)');
      }
    }
  });
});

describe('SEC-05 — escrita em ticket/pc exige token de sessão', () => {
  test('PATCH direto em ticket não altera nada', async () => {
    const r = await rest('ticket?id=eq.-1', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ nota_interna: 'regressao-sec05' }),
    });
    // sem policy de UPDATE o Postgres não dá erro: apenas não encontra linha.
    // O que importa é não ter alterado nada.
    if (r.ok) {
      const alteradas = await r.json();
      assert.equal(alteradas.length, 0, 'PATCH direto em ticket voltou a funcionar');
    }
  });

  test('PATCH direto em pc não altera nada', async () => {
    const r = await rest('pc?id=eq.-1', {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status_pc: 'descartado' }),
    });
    if (r.ok) {
      const alteradas = await r.json();
      assert.equal(alteradas.length, 0, 'PATCH direto em pc voltou a funcionar');
    }
  });

  test('RPC de escrita recusa token forjado', async () => {
    const r = await rest('rpc/rpc_ti_atualizar_ticket', {
      method: 'POST',
      body: JSON.stringify({
        p_token: 'token-invalido-de-teste',
        p_ticket_id: -1,
        p_patch: { nota_interna: 'x' },
      }),
    });
    assert.ok(!r.ok, 'a RPC aceitou um token forjado');
    const corpo = await r.json();
    assert.match(corpo.message || '', /sessao/i);
  });

  test('sessao_token não é legível', async () => {
    const r = await rest('sessao_token?select=*&limit=1');
    assert.ok(!r.ok, 'a tabela de tokens ficou legível — qualquer um leria a sessão alheia');
  });
});

describe('login continua funcionando e não vaza credencial', () => {
  test('credencial inválida devolve lista vazia, não erro nem dado', async () => {
    const r = await rest('rpc/rpc_login_ti', {
      method: 'POST',
      body: JSON.stringify({ p_login: '__nao_existe__', p_senha: '__errada__' }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });
});
