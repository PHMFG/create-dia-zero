---
title: Design ativo e extração para Figma
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../src/main.tsx
  - ../src/styles.css
  - ../src/usability.css
  - ../src/design-system.css
  - ../src/components/LandingDesign.css
  - ../src/components/Canvas.css
  - ../src/components/DrawerViews.css
  - ../src/components/DialogDesign.css
  - ../src/components/CardChatDesign.css
  - ../src/components/MediaBlock.css
  - ../src/components/AgentActivity.css
  - ../src/components/PromptQueue.css
  - ../src/components/WorkspaceLive.css
  - ../src/components/BrandVisual.tsx
  - ../src/components/BrandVisual.css
  - ../public/design/spark-brand.svg
  - ../public/design/spark-light.svg
  - ../public/design/arrow-right.svg
  - ../public/design/arrow-right-on-brand.svg
  - ../public/design/logo-dot-brand.svg
  - ../public/design/logo-dot-light.svg
  - ../public/figma/card-chat-close.svg
  - ../public/figma/card-chat-message.svg
  - ../public/figma/dialog-apply-check.svg
  - ../public/figma/dialog-close.svg
  - ../public/figma/dialog-comparison-down.svg
  - ../public/figma/dialog-comparison-right.svg
  - ../public/figma/dialog-save-check.svg
  - ../public/figma/dialog-select-chevron.svg
  - ../public/icon.svg
  - ../index.html
  - ../package.json
  - ../.design-export/README.md
  - ../.design-export/manifest.ts
  - ../.design-export/components.tsx
  - ../.design-export/components-manifest.json
  - ../.design-export/figma-manifest.json
  - ../.design-export/entry.tsx
  - ../.design-export/src/App.tsx
  - ../.design-export/src/main.tsx
  - ../.design-export/src/styles.css
  - ../.design-export/src/components/Canvas.tsx
  - ../.design-export/src/components/Workspace.tsx
  - ../.design-export/src/designState.ts
  - ../.design-export/Harness.tsx
  - ../.design-export/export.tsx
  - ../.design-export/vite.config.ts
  - ../.design-export/prepare-capture.mjs
  - ../.design-export/figma-instances.js
  - ../.design-export/figma-library.js
  - ../.design-export/updates/tokens.json
  - ../.design-export/updates/implementation-notes.md
  - ../.design-export/updates/components-audit.md
  - ../.design-export/figma-preview.png
  - ../.design-export/updates/implementation-landing.jpg
  - ../.design-export/updates/implementation-desktop.jpg
  - ../.design-export/updates/implementation-mobile.jpg
---

# Design ativo e extração para Figma

O estilo que o usuário vê é definido pelo código carregado em `src/` e pelos SVGs de `public/`. A pasta [`.design-export/`](../.design-export/README.md) guarda outra coisa: uma ferramenta offline, cópias de código, dados de amostra e saídas estáticas preparados para documentar telas no Figma. As imagens e auditorias dessa pasta registram etapas anteriores do processo de design; por si só, elas não verificam a interface atual. Para os componentes ativos, veja [Frontend](./frontend.md) e [Canvas e cartões](./canvas.md).

## Tokens e camadas CSS em uso

[`src/main.tsx`](../src/main.tsx) importa Inter nos pesos 300, 400, 500 e 600, o CSS do React Flow e as folhas globais `styles.css`, `usability.css` e `design-system.css`. Os componentes carregam suas próprias folhas, como `Canvas.css`, `LandingDesign.css`, `DialogDesign.css`, `CardChatDesign.css`, `MediaBlock.css`, `PromptQueue.css` e `AgentActivity.css`.

[`src/design-system.css`](../src/design-system.css) define papéis semânticos para texto, superfícies, bordas, ícones, acentos e categorias, além de espaçamento de 2 a 120 px, raios, duração de movimento e três níveis de sombra. Exemplos centrais: texto primário `#2a2134`, texto secundário `#614470`, marca `#8438f5`, magenta `#ce00ee`, superfície sutil `#f5effd` e borda sutil `#eae5ef`. Há aliases para variáveis anteriores, o que permite que as folhas base e as novas regras coexistam.

O layout ativo cobre landing, workspace, canvas/lista, drawer, diálogos e chat do cartão. As regras incluem breakpoints em 1050, 760 e 420 px em partes da interface; o canvas e alguns controles têm ajustes próprios também. O modo de movimento reduzido afeta animações e controles onde há regra específica. A descrição exata de cada interação está nas páginas [Frontend](./frontend.md) e [Canvas e cartões](./canvas.md).

### Uma divergência de fonte

`src/styles.css` declara `--heading: 'Inter Tight'`, e `package.json` contém tanto Inter quanto Inter Tight. Porém, o `main.tsx` atual importa somente os arquivos de Inter, e `design-system.css` redefine `--heading` como `var(--font-ui)`, também Inter. Assim, a pilha carregada pelo app aponta para Inter nos títulos, apesar da referência inicial a Inter Tight e da presença da dependência no pacote. O preview exportado carrega Inter Tight em sua própria entrada, portanto não deve ser usado para inferir essa pilha tipográfica ativa.

## Marca e arquivos públicos

`BrandVisual.tsx` monta o símbolo e as setas a partir de `public/design/`, escala os SVGs sem substituir suas dimensões internas e escolhe a versão de cor pelo contexto. `BrandVisual.css` fornece os fundos: roxo para a variante `brand` e branco para `light`. `public/figma/` contém ícones locais usados nos diálogos e no chat do cartão. `public/icon.svg` é o favicon apontado por [`index.html`](../index.html). Os pontos do wordmark são círculos CSS (`.logo-dot`); há SVGs `logo-dot-brand.svg` e `logo-dot-light.svg` em `public/design`, mas o componente atual não os referencia.

O resto dos ícones de interface usa `lucide-react`. Fotos e imagens de referência do projeto chegam como URL no modelo, passam pelo controle de URL de [`shared/media.ts`](../shared/media.ts) e são renderizadas por `MediaBlock`; os SVGs ilustrativos mencionados na documentação do export não são fotos reais nem dados de pesquisa.

## Procedência de `.design-export/`

O [`README.md`](../.design-export/README.md) descreve um export offline para organizar telas e componentes no Figma. Há dois caminhos locais: `components.tsx` reutiliza alguns componentes da aplicação ativa para gerar a biblioteca, enquanto `Harness.tsx` e `export.tsx` usam `src/` e `shared/` copiados sob `.design-export/`, com fixtures explícitas de `designState.ts` e callbacks sem efeito. `manifest.ts` enumera 43 variantes de tela; `vite.config.ts` e `entry.tsx` configuram o preview isolado em localhost. Não é a aplicação publicada: nessa harness, `health` é fixo e as ações são no-op. A documentação do export informa que a prévia não chama a API do app.

`out/` contém HTMLs repetidos por tela, categoria, captura e drawer; `preview-dist/` contém bundles compilados e fontes binárias. `prepare-capture.mjs` prepara cópias em `out/capture/` e injeta o script oficial de captura do Figma; a execução da captura é uma etapa separada do app. Esses arquivos gerados não são fontes da interface atual. `figma-preview.png`, os JPGs de implementação e os arquivos em `updates/` são registros visuais/textuais de uma revisão em 6 de outubro de 2026. Os registros dizem respeito àquela revisão; não servem como QA visual atual.

Há uma diferença de contagens entre etapas documentadas: README e `figma-manifest.json` registram 216 componentes e 59 variáveis; `updates/implementation-notes.md` e `updates/components-audit.md` registram a revisão posterior com 217 componentes, 16 conjuntos e 94 variáveis. Esses números descrevem o arquivo Figma/export em momentos diferentes, não o runtime nem a contagem de componentes React ativos. `updates/tokens.json` e os audits são referências de origem para os tokens implementados; não substituem `src/design-system.css` como evidência do CSS em execução.

As cópias em `.design-export/src/` divergem de vários arquivos atuais em `src/`, e a captura usa fixtures com rótulos de amostra. `figma-library.js` é código para a Plugin API do Figma e `figma-instances.js` descreve instâncias da extração; nenhum dos dois é carregado pelo app. Portanto, use as páginas HTML, screenshots, auditorias e bundles apenas para rastrear intenção e proveniência do design. Para afirmar comportamento, aparência carregada ou qualidade atual do app, consulte `src/` e faça uma revisão atual separada. Esta wiki descreve o código; não declara que as imagens antigas validam a tela atual.

Veja também [Operações](./operations.md), [Testes](./testing.md), [Riscos e lacunas](./risks.md) e [Manutenção](./maintenance.md).
