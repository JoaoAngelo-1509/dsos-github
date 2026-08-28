# Testes

Suíte de regressão de segurança criada a partir da auditoria de 23/08/2026
(item TEST-01). Antes disso o projeto não tinha nenhum teste automatizado.

## Como rodar

Usa o test runner nativo do Node (18+) — **sem dependências**, porque o
projeto é estático e não tem `package.json` de runtime.

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> node --test 'tests/*.test.js'
```

No Windows (PowerShell):

```bash
$env:SUPABASE_URL="https://<ref>.supabase.co"; $env:SUPABASE_ANON_KEY="<anon key>"; node --test tests/seguranca.test.js tests/leitura.test.js tests/realtime-sinal.test.js
```

Ou passe um único arquivo (`node --test tests/seguranca.test.js`) para rodar só
uma suíte.

> **Prefira o banco de TESTE.** O teste de SEC-03 precisa mirar uma linha real
> para exercer a autorização — com um id inexistente o PostgREST responde 204
> sem sequer chegar na policy, e o teste passaria mesmo com a brecha aberta.

A anon key é pública (vai no bundle do site), mas ainda assim não é versionada:
vem por variável de ambiente, como o resto das credenciais do projeto.

## O que é coberto

| Achado | O que o teste trava |
|---|---|
| SEC-01 | `pc_senha` inacessível; `pc` não expõe coluna de senha |
| SEC-04 | `professor.senha_hash` e `usuario_ti.senha` não são selecionáveis |
| SEC-02 | `v_pc_pub`/`v_usuario_ti_pub` respondem e não vazam senha |
| SEC-03 | `DELETE` direto em `professor` não apaga ninguém |
| SEC-05 | `PATCH` direto em `ticket`/`pc` não altera nada; RPC recusa token forjado; `sessao_token` ilegível |
| SEC-05b (leitura) | `ticket`/`mensagem` ilegíveis sem token; isolamento entre PCs; regra do professor; RPC `nao_lidas` não vaza id de terceiros (`leitura.test.js`) |
| Realtime (sinal) | triggers geram `realtime_sinal` para INSERT/UPDATE de ticket/mensagem; a tabela só expõe `{id,canal,ref_id,evento,em}`; escrita pela API recusada (`realtime-sinal.test.js`) |
| — | Login com credencial inválida devolve lista vazia, sem erro nem dado |

## Por que estes testes existem

Vários dos vazamentos encontrados na auditoria **já tinham sido corrigidos
antes e voltaram** sem ninguém perceber. O caso mais claro é `pc.senha`:
protegido em junho/2026 e reaberto em julho por uma migration que "reabria
SELECT para não quebrar o front". Cada teste aqui trava uma dessas regressões.

A suíte foi validada reintroduzindo a brecha de propósito, num teste
controlado: os testes de SEC-03 e SEC-04 reprovaram como esperado, e o estado
foi restaurado em seguida. Um teste de segurança que nunca falha não protege
nada — este foi verificado.

## O que ainda não é coberto

- Funções puras do frontend (cálculo de datas/KPIs, montagem de filtros,
  detecção de duplicata). Exigiriam extrair essas funções dos módulos, que
  hoje dependem do DOM e do `supabase-config`.
- Fluxo completo de UI (login → abrir chamado → chat → resolver).
