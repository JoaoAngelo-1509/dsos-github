# DSos — HelpDesk Escolar (Refatorado)

## Estrutura do Projeto

```
/
├── html/
│   ├── login.html          ← Página de login
│   ├── painel-pc.html      ← Painel do usuário/PC/Professor
│   └── painel-ti.html      ← Painel T.I.
├── css/
│   ├── base.css            ← Estilos compartilhados (animações, lightbox, .bg)
│   ├── login.css           ← Estilos exclusivos do login
│   ├── painel-pc.css       ← Estilos do painel do usuário
│   └── painel-ti.css       ← Estilos do painel T.I.
├── js/
│   ├── supabase-config.js  ← Configuração centralizada do Supabase
│   ├── ui.js               ← Utilitários compartilhados (tema, toast, escapeHtml, etc.)
│   ├── auth.js             ← Lógica de login
│   ├── painel-pc.js        ← Lógica do painel do usuário
│   └── painel-ti.js        ← Lógica do painel T.I.
├── BG.jpeg                 ← Imagem de fundo
└── Logo.png                ← Logo CPS
```

## Bugs Corrigidos

1. **Tema persistente unificado**: O painel-ti.html usava a chave `dsos_tema` enquanto os outros 
   usavam `dsos_tema_login`. Agora todos usam `dsos_tema_login` para consistência.
2. **Remoção de CSS duplicado**: A regra `.bg` era definida em múltiplos arquivos. 
   Agora está centralizada em `base.css`.
3. **Separação de responsabilidades**: CSS inline, JS inline e estilos misturados 
   foram separados em arquivos próprios.
4. **Animações duplicadas**: `@keyframes spin`, `@keyframes cardIn`, etc. estavam definidas 
   em múltiplos lugares. Centralizadas em `base.css`.
5. **Utilitários compartilhados**: Funções como `toggleTema`, `sair`, `escapeHtml`, `toast`, 
   `tipoIcon` e `statusLabel` estavam duplicadas. Centralizadas em `ui.js`.

## Como Usar

Sirva os arquivos via servidor HTTP local (ex: Live Server no VSCode). 
Abra `html/login.html` no navegador.

Os arquivos `BG.jpeg` e `Logo.png` devem estar na raiz do projeto.
