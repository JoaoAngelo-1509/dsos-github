# DSos — Diagramas UML

Modelagem do sistema em **Mermaid dentro de arquivos Markdown**. A escolha é
deliberada: renderiza direto no GitHub, versiona como texto (dá diff, dá
revisão em PR) e não depende de nenhuma ferramenta externa nem de arquivo
binário exportado que envelhece em silêncio.

Todos os diagramas foram derivados do código e do schema versionado, não de
memória. A fonte de cada um está declarada no próprio arquivo.

## Índice

| # | Diagrama | Tipo UML | Responde |
|---|---|---|---|
| [01](01-casos-de-uso.md) | Casos de uso | Use case | Quem usa o sistema e para quê |
| [02](02-entidades.md) | Entidades / classes | Class + ER | Como os dados estão organizados |
| [03](03-componentes.md) | Componentes | Component | Quais são as peças de software e como conversam |
| [04](04-seq-abrir-chamado.md) | Abrir chamado normal | Sequence | O caminho completo de um chamado, com IA e detecção de duplicado |
| [05](05-seq-emergencia.md) | Chamado de emergência | Sequence | O que muda quando é emergência ou chamado de professor |
| [06](06-seq-realtime.md) | Chat em tempo real | Sequence | Como o "ao vivo" funciona com a leitura fechada por RLS |
| [07](07-maquina-estados-ticket.md) | Ciclo de vida do chamado | State machine | Todos os estados de um chamado e quem os muda |

## Convenções usadas

* **Ator** = papel de usuário, não pessoa. Uma mesma pessoa pode ser técnico e
  professor (conta dupla) e aparece nos dois.
* Nomes de tabela, coluna e função aparecem **exatamente** como estão no banco
  (`ticket`, `nome_solicitante`, `rpc_ti_atualizar_ticket`), para o diagrama
  poder ser conferido contra o SQL sem tradução.
* Onde o diagrama simplifica algo, há uma nota logo abaixo dizendo o quê. Não
  existe diagrama que caiba a verdade inteira; existe diagrama honesto sobre o
  que deixou de fora.

## Documentos relacionados

* [../regras-de-acesso.md](../regras-de-acesso.md) — quem pode fazer o quê e
  como isso é imposto (leia junto com o 01 e o 03)
* [../REALTIME.md](../REALTIME.md) — detalhe dos canais de tempo real (base do 06)
* [../../WORKFLOW.md](../../WORKFLOW.md) — fluxo de alteração de banco
* [../../supabase/migrations/20260101000000_baseline_schema.sql](../../supabase/migrations/20260101000000_baseline_schema.sql)
  — o schema em si (base do 02)
