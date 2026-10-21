---
title: Frontend
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../src/App.tsx
  - ../src/main.tsx
  - ../src/components/Landing.tsx
  - ../src/components/Workspace.tsx
  - ../src/components/Dialogs.tsx
  - ../src/components/CardChat.tsx
  - ../src/components/AgentActivity.tsx
  - ../src/components/PromptQueue.tsx
  - ../src/components/MediaBlock.tsx
  - ../src/components/RichText.tsx
  - ../src/lib/api.ts
  - ../src/lib/eventStream.ts
  - ../src/lib/projectMerge.ts
  - ../src/lib/cardLayout.ts
  - ../shared/types.ts
  - ../shared/domain.ts
  - ../shared/media.ts
---

# Frontend da create

O frontend é uma aplicação React de página única servida pelo Vite. A entrada [`index.html`](../index.html) carrega [`src/main.tsx`](../src/main.tsx), que registra as fontes e estilos globais e monta [`src/App.tsx`](../src/App.tsx). A tela inicial, o espaço do projeto, o canvas e os diálogos vivem em componentes separados; `Workspace` concentra o estado que liga essas partes. Para o modelo de dados e os serviços externos, veja [Visão geral](./overview.md), [Arquitetura](./architecture.md), [Domínio](./domain.md), [Backend](./backend.md) e [Persistência](./persistence.md).

## Entrada, criação e abertura

Ao montar, `App` consulta a saúde do serviço e a lista de projetos. Se a URL contém `?projeto=<id>`, tenta carregar esse projeto e mantém o parâmetro sincronizado com o projeto aberto. `Landing` permite iniciar uma ideia, abrir um dos seis projetos recentes exibidos, importar um JSON ou entrar na demonstração. O campo de ideia exige ao menos cinco caracteres; a importação feita por essa tela é limitada a 3 MB. O workspace é carregado sob demanda com `lazy` e `Suspense`.

`Landing` é uma página de apresentação com exemplos de texto, formulário e estados de projetos recentes; ela não cria projetos por conta própria. `App` escolhe entre `api.create` e `api.demo`, trata erros globais e encaminha abertura, importação e retorno à tela inicial. O modal “Como funciona” tem tratamento próprio de foco e tecla Escape. As mensagens visuais identificam a demonstração; seu conteúdo vem de `createDemoProject` em [`shared/domain.ts`](../shared/domain.ts).

## Trabalho dentro do projeto

[`src/components/Workspace.tsx`](../src/components/Workspace.tsx) coordena a conversa geral, seleção do projeto, mensagens, fila, atividades, canvas/lista, fontes, registro de experiência, revisão de proposta e detalhes de cartão. Ele recebe e devolve o `Project` tipado em [`shared/types.ts`](../shared/types.ts). O chat usa [`src/lib/api.ts`](../src/lib/api.ts) para iniciar uma execução e ler o fluxo de eventos em [`src/lib/eventStream.ts`](../src/lib/eventStream.ts); eventos de projeto são mesclados com edições locais por [`src/lib/projectMerge.ts`](../src/lib/projectMerge.ts), para que uma resposta atrasada não apague mudanças ainda não sincronizadas.

Edições do plano marcam o estado como alterado e agendam salvamento depois de 850 ms. Um conflito HTTP 409 leva o cliente a buscar a versão mais nova e tentar salvar a mesclagem; rascunhos locais ficam em `sessionStorage` até o estado salvo ser confirmado. A fila também é guardada em `sessionStorage`, aceita até dez perguntas, permite remover itens e pausar/retomar o processamento. O botão de interrupção cancela o fluxo do navegador e solicita a interrupção da execução ao endpoint correspondente; a implementação do contrato está em `api.chat`.

O menu do projeto exporta um JSON produzido por `exportProject` e permite excluir o projeto. O mesmo importador serve a tela inicial e o workspace; `App` valida o tamanho máximo de 3 MB e interpreta o conteúdo antes de chamar a API. O texto da interface descreve o projeto como pertencente à sessão deste navegador e recomenda exportá-lo para continuar em outro dispositivo. A persistência efetiva e os limites desse modelo estão em [Persistência](./persistence.md).

## Conversa, cartão e revisão

`RichText` renderiza respostas Markdown. `AgentActivity` mostra as etapas comunicadas pelo backend, inicialmente as cinco mais recentes, com links para cartões relacionados. `PromptQueue` mostra até três itens antes de expandir a lista. `CardChat` reaproveita esses componentes para perguntas vinculadas a um cartão; o painel não é modal (`aria-modal="false"`), recebe foco ao abrir, fecha com Escape e devolve o foco anterior.

[`src/components/Dialogs.tsx`](../src/components/Dialogs.tsx) reúne o detalhe do cartão em três abas — visualizar, editar e histórico —, o formulário de experiência e a revisão das mudanças propostas. Modais prendem o foco e fecham com Escape. Uma experiência requer relato com pelo menos dez caracteres; depois de gravada, a interface pede uma análise e pode exibir uma proposta. Aplicar a proposta é uma ação explícita do usuário. O detalhe permite editar blocos, lista/checklist, campos de contexto, conexões, referências e mídias; os limites concretos aparecem em [Canvas e cartões](./canvas.md).

`api` é a fronteira HTTP do frontend: as ações do projeto usam rotas sob `/api`, e o cliente inicializa uma sessão anônima do Supabase se `/api/config` fornecer configuração; caso contrário, usa um token local guardado em `localStorage`. A saúde é consultada na abertura e controla, por exemplo, a disponibilidade do botão de pesquisa. A existência do controle na interface não comprova que um serviço esteja operacional; consulte [Backend](./backend.md), [IA](./ai.md) e [Operações](./operations.md) para o estado dos serviços.

## Limites visíveis no código

- A lista inicial exibe no máximo seis projetos, embora a contagem indique o total retornado.
- A tela de pesquisa consulta o estado `health.research` recebido na abertura; não há atualização periódica desse indicador neste componente.
- O cliente trata erros de leitura da lista sem exibi-los (`refresh` captura a rejeição). Uma falha de saúde deixa o estado sem valor, o que mantém a pesquisa desabilitada.
- O caminho de importação analisado limita o arquivo a 3 MB; o formato aceito e a validação do projeto são definidos no domínio e no servidor.
- A conversa, o streaming e o salvamento dependem da API. Uma prévia estática não executa essas ações; veja [Sistema visual](./design-system.md) para a separação entre código ativo e material de captura.

## Código relacionado

- [Canvas e cartões](./canvas.md) explica os nós, conexões, mídia e modo de lista.
- [Sistema visual](./design-system.md) documenta tokens, SVGs e fontes de captura.
- [Segurança](./security.md), [Riscos e lacunas](./risks.md), [Testes](./testing.md) e [Manutenção](./maintenance.md) completam os limites operacionais e de evolução.
