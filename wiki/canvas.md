---
title: Canvas e cartões
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../src/components/Canvas.tsx
  - ../src/components/Canvas.css
  - ../src/components/Workspace.tsx
  - ../src/components/Dialogs.tsx
  - ../src/components/MediaBlock.tsx
  - ../src/components/MediaBlock.css
  - ../src/lib/cardLayout.ts
  - ../src/lib/cardLayout.test.ts
  - ../shared/types.ts
  - ../shared/canvasConnections.ts
  - ../shared/domain.ts
  - ../shared/media.ts
---

# Canvas e cartões

O painel de plano tem duas apresentações do mesmo conjunto `project.cards`: o grafo interativo e uma lista agrupada por prioridade. [`src/components/Canvas.tsx`](../src/components/Canvas.tsx) desenha as duas, mas deixa edição, salvamento e estado do projeto para [`Workspace`](../src/components/Workspace.tsx). O grafo usa React Flow; o modelo persistido continua sendo `CanvasCard` em [`shared/types.ts`](../shared/types.ts). Para o fluxo maior da interface, veja [Frontend](./frontend.md); para regras do domínio, veja [Domínio](./domain.md).

## Tipos e organização

Cada cartão tem um tipo (`context`, `hypothesis`, `research`, `action`, `evidence`, `decision` ou `note`), uma faixa (`now`, `next`, `later` ou `done`), título, resumo, blocos, posição, origem, revisão e IDs de dependências. Os blocos cobrem texto, listas e checklists, destaque, fontes e mídia. O canvas apresenta a faixa como prioridade; o tipo aparece como rótulo e ícone. Embora o tipo de dados também admita um campo opcional `status`, os cartões deste componente não exibem esse campo: estado visual e agrupamento vêm de `lane`.

No grafo, cada cartão é um nó de 320 px. O título é editável diretamente, o resumo fica limitado visualmente a três linhas, e o rodapé mostra progresso do checklist, quantidade de fontes ou origem. Só os três primeiros itens de checklist aparecem; “+N itens” abre o detalhe do cartão. O primeiro bloco de destaque é mostrado quando não há checklist. `previewMedia` escolhe no máximo dois blocos explícitos de imagem, localização ou link; se o cartão não tiver mídia explícita, pode mostrar uma imagem associada a uma das fontes vinculadas.

Na lista, os mesmos cartões são agrupados na ordem Agora, Próximas, Depois e Concluído. Essa vista não monta nós React Flow, arestas, alças de conexão nem controles de navegação: continua oferecendo título, checklist, esclarecimento e abertura do detalhe, mas não arraste, pan ou zoom.

## Posição e navegação do grafo

O cabeçalho é a alça de arraste. Mover um cartão grava sua posição como fixada; o código sincroniza atualizações remotas preservando o nó que está sob o ponteiro e também trata movimento pelo teclado. “Organizar” chama `organizeCards` no workspace; cartões fixados mantêm a posição, enquanto os demais são distribuídos por faixa. A criação de uma anotação chama `availableCardPosition` em [`src/lib/cardLayout.ts`](../src/lib/cardLayout.ts) para procurar uma posição livre sem alterar os cartões atuais.

O enquadramento inicial ocorre ao abrir o projeto, com uma exceção visual para focar a ação atual em uma demonstração com mais de seis cartões. A minimapa começa aberta nesse caso; em qualquer projeto pode ser ligada ou desligada. Os controles também oferecem zoom, enquadramento e ajuda. Atualizações do plano não devem recentrar automaticamente a câmera depois da montagem.

## Dependências entre cartões

Arrastar a alça inferior de um cartão para a superior de outro cria uma relação orientada do pré-requisito para o cartão dependente. A lista `dependsOn` fica no cartão dependente, então `Canvas` inverte essa representação ao desenhar a aresta. Uma aresta selecionada revela os nomes dos dois cartões e permite desconectar.

[`shared/canvasConnections.ts`](../shared/canvasConnections.ts) valida as conexões no gesto e novamente no callback do workspace. Bloqueia IDs ausentes, auto conexão, duplicatas, ciclos e mais de 50 pré-requisitos no mesmo cartão. A edição de dependências também está disponível na aba Editar do detalhe. A lista só mostra o resultado por prioridade, sem visualizar essas arestas.

## Detalhe, fontes e mídia

O drawer de [`src/components/Dialogs.tsx`](../src/components/Dialogs.tsx) separa visualização, edição e histórico. Nele, títulos e resumos são editáveis, blocos podem ser movidos, adicionados ou removidos, e checklists podem ser marcados. O editor aceita até 60 blocos por cartão, 80 itens por lista/checklist e 50 dependências. No canvas, o título tem limite de 180 caracteres; no drawer, 200 — os dois campos, portanto, não aplicam o mesmo teto.

`MediaBlock` exibe links, imagens e locais. URLs de conteúdo são filtradas por `isSafeExternalUrl` em [`shared/media.ts`](../shared/media.ts); a interface não incorpora um mapa, apenas monta um link de busca do Google Maps quando há endereço ou coordenadas. Falha de carregamento da imagem vira um link para abri-la. A origem visual diferencia fonte consultada, referência registrada, conteúdo adicionado pelo usuário e ausência de fonte. Imagens e referências são dinâmicas: não há um conjunto fixo de fotos reais dentro do canvas.

## Limites e evidências

- O cartão mostra uma amostra de checklist e mídia, não o conteúdo completo; o drawer contém a leitura e edição completas.
- A vista de lista omite relações de dependência e navegação espacial.
- `lane` dirige o agrupamento e o badge; `status` existe no contrato do projeto, mas não tem representação nesta interface.
- A caixa de título inline aceita 180 caracteres, enquanto o drawer aceita 200.
- `src/lib/cardLayout.test.ts` documenta posições livres para novas anotações, mas esta página descreve o algoritmo a partir da implementação, não de uma execução visual.

Veja também [Sistema visual](./design-system.md), [Frontend](./frontend.md), [Domínio](./domain.md), [Persistência](./persistence.md) e [Riscos e lacunas](./risks.md).
