# DSos — Workflow de desenvolvimento

## Fluxo obrigatório para alterações no banco

```
1. Aplica migration no banco de TESTE
   └── <TEST_PROJECT_ID> (DSos Test database)

2. Testa no frontend apontando para o banco de TESTE
   └── Trocar import nos JS:
       DE:   './supabase-config.js'
       PARA: './supabase-config.test.js'

3. Aprovação

4. Aplica a mesma migration no banco de PRODUÇÃO
   └── <PROD_PROJECT_ID> (DSos)

5. Reverte o import de volta para './supabase-config.js'
```

## Estrutura de arquivos

```
dsos/
├── html/
│   ├── login.html
│   ├── painel-pc.html
│   └── painel-ti.html
├── css/
│   ├── base.css            ← estilos compartilhados
│   ├── login.css
│   ├── painel-pc.css
│   └── painel-ti.css
├── js/
│   ├── supabase-config.js       ← PRODUÇÃO (não alterar sem aprovação)
│   ├── supabase-config.test.js  ← TESTE    (usar para validar mudanças)
│   ├── ui.js               ← utilitários compartilhados
│   ├── auth.js             ← lógica de login
│   ├── painel-pc.js        ← lógica painel usuário
│   └── painel-ti.js        ← lógica painel TI
├── BG.jpeg
├── Logo.png
├── CHANGELOG.md            ← histórico de versões
└── WORKFLOW.md             ← este arquivo
```

## Bancos de dados

| Ambiente | Projeto | URL |
|---|---|---|
| Produção | `<PROD_PROJECT_ID>` | https://<PROD_PROJECT_ID>.supabase.co |
| Teste    | `<TEST_PROJECT_ID>` | https://<TEST_PROJECT_ID>.supabase.co |

## Credenciais do banco de TESTE

As credenciais de acesso ficam apenas com o administrador do sistema.
Não versione senhas ou logins em nenhum arquivo do repositório.
