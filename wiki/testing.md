---
title: Testes e verificações
kind: topic
updated: 2026-10-21
status: test-verified
sources:
  - ../package.json
  - ../tests/ai.test.ts
  - ../tests/ai-stream-api.test.ts
  - ../tests/api-chat.test.ts
  - ../tests/canvasConnections.test.ts
  - ../tests/demo.test.ts
  - ../tests/domain.test.ts
  - ../tests/eventStream.test.ts
  - ../tests/media.test.ts
  - ../tests/research-media.test.ts
  - ../tests/store.test.ts
  - ../tests/ai-evaluation.json
  - ../src/lib/cardLayout.ts
  - ../src/lib/cardLayout.test.ts
  - ../src/lib/eventStream.ts
  - ../src/lib/projectMerge.ts
  - ../src/lib/projectMerge.test.ts
  - ../.design-export/src/lib/cardLayout.test.ts
  - ../.design-export/src/lib/projectMerge.test.ts
  - ../scripts/smoke-api.ts
  - ../scripts/smoke-demo.ts
  - ../scripts/build-api.mjs
  - ../supabase/schema.sql
  - ../supabase/cancellation.sql
  - ../supabase/tests/security.sql
  - ../docs/verification.md
  - ../docs/verification-db.md
---

# Testes e verificações

O comando automatizado do pacote é `npm test`, que executa `vitest run`. O escopo dos testes de domínio e infraestrutura abaixo foi lido no código; os testes usam fixtures, mocks e armazenamentos locais onde indicado. Eles não substituem uma chamada real aos provedores, um teste no banco remoto ou uma revisão visual no navegador.

## Mapa das suítes

| Arquivos | O que cobrem | Limite do que demonstram |
|---|---|---|
| [tests/domain.test.ts](../tests/domain.test.ts), [tests/demo.test.ts](../tests/demo.test.ts) | Criação progressiva, revisões, edições humanas, propostas, prioridade atômica, checklist versus evidência, mudanças de contexto, importação/exportação e fallback. A suíte do Chabor verifica transparência dos dados fictícios, tipos de cartão, dependências, espaço estimado e IDs novos. | Dados e resultados são fixtures locais; a estimativa de colisão no exemplo é um cálculo de teste, não uma medição do navegador. |
| [tests/canvasConnections.test.ts](../tests/canvasConnections.test.ts) | Direção dos pré-requisitos, ciclos, cartões ausentes, autorrelações, duplicações, limite de 50, auditoria de grafo inválido, cadeia com 12.000 nós e sincronização de posições durante arraste. | A auditoria de grafo é testada como função; não é uma sessão de canvas real. |
| [src/lib/projectMerge.test.ts](../src/lib/projectMerge.test.ts), [src/lib/cardLayout.test.ts](../src/lib/cardLayout.test.ts) | Merge tardio de snapshots por ID: exclusões e mudanças locais, texto/checklists/blocos, ordem, contexto, conteúdo remoto e posição. A posição para novo cartão evita nós já ocupados. | São testes determinísticos das funções de merge/layout, sem renderizar ou medir a interface. |
| [tests/ai.test.ts](../tests/ai.test.ts) | Sanitização do JSON da IA, fonte/citação/mídia, autoria, revisões, conexões, contexto limitado, fallback sem chaves, roteamento sem Jev, cálculo, atividades, publicações sequenciais, síntese de pesquisa e cobertura do canvas. | Provedores e respostas externas são substituídos por fixtures; respostas válidas não medem qualidade ou consistência de um modelo real. A pesquisa usa um `fetcher` simulado. |
| [tests/ai-stream-api.test.ts](../tests/ai-stream-api.test.ts) | Handler Hono com turnos de IA substituídos: cancelamento antes/depois da reserva, trava, abort durante gravação, heartbeat SSE, persistência incremental, edições concorrentes, falha após delta e ordem das publicações. | Executa `app.request` contra o store em memória; não atravessa proxy Vercel, rede, provedor ou banco remoto. Usa relógio falso no heartbeat. |
| [tests/api-chat.test.ts](../tests/api-chat.test.ts), [tests/eventStream.test.ts](../tests/eventStream.test.ts) | A camada de navegador usa `fetch` e `localStorage` simulados para testar cancelamento autenticado, confirmação, repetição limitada a `RUN_BUSY` e não repetição de outros 409. O leitor SSE usa streams em memória para chunks UTF-8, CRLF, heartbeat, aborto, erro e ausência do evento `complete`. | Não inicia navegador nem testa interrupção de rede ou proxy reais. |
| [tests/store.test.ts](../tests/store.test.ts) | Store local e rotas: sessão, isolamento, limites de corpo, versão obsoleta, cópias imutáveis, criação concorrente, limite de projetos, runs idempotentes, lock, cancelamento e cotas. Inclui alguns doubles para métodos Supabase e RPC. | A suíte principal usa mapas em memória e relógio simulado; doubles de consulta/RPC não executam transações no PostgreSQL. |
| [tests/media.test.ts](../tests/media.test.ts), [tests/research-media.test.ts](../tests/research-media.test.ts) | Hosts/URLs inseguros, ranges geográficos, link de mapa, compatibilidade do schema, associação de imagens a fontes e estados de extração. O componente é inspecionado por HTML renderizado no servidor. | Chamadas Tavily são simuladas; não confirma disponibilidade externa, licença ou qualidade factual da imagem. |

## Arquivos auxiliares e descobrimento

[tests/ai-evaluation.json](../tests/ai-evaluation.json) traz 30 situações qualitativas em português e uma rubrica para entrevista, contexto, evidência, pesquisa, cálculo, segurança e edição humana. O próprio arquivo declara que é roteiro, não resultado de execuções live. Não há comando de avaliação de modelo em [package.json](../package.json), e essa lista não deve ser contada como 30 testes automatizados.

O comando padrão `npm test` descobre 14 arquivos: 12 ativos nos diretórios `tests/` e `src/lib/`, mais o snapshot do teste de layout (`.design-export/src/lib/cardLayout.test.ts`) e o snapshot do merge (`.design-export/src/lib/projectMerge.test.ts`), sob a pasta local `.design-export/`, que o `.gitignore` exclui do repositório. Os dois snapshots acrescentam 12 casos à contagem padrão (2 de layout e 10 de merge), mas não novos comportamentos ativos do produto. Com `--exclude '**/.design-export/**'`, a suíte ativa contém 12 arquivos. Veja [operations.md](operations.md) para comandos e ambiente.

## Smoke, SQL e histórico

Os scripts [smoke-api.ts](../scripts/smoke-api.ts) e [smoke-demo.ts](../scripts/smoke-demo.ts) são verificações manuais com URL explícita, fora do Vitest. O primeiro cria duas sessões anônimas, grava projetos temporários, pode executar IA e pesquisa reais, grava arquivos em `artifacts/` e tenta apagar os projetos ao final. O segundo cria, lê e remove um projeto demo temporário. Não foram executados nesta tarefa.

[supabase/tests/security.sql](../supabase/tests/security.sql) é um teste SQL transacional: presume o schema e o SQL de cancelamento instalados, cria usuários e fixtures, testa RLS, reservas, cotas e cancelamento e termina com `rollback`. Sua execução altera o banco durante a transação e exige uma conexão com privilégios adequados; foi lido, não executado nesta tarefa. [schema.sql](../supabase/schema.sql) e [cancellation.sql](../supabase/cancellation.sql) são scripts versionados de instalação/atualização do esquema com `commit`. Não são testes descartáveis nem comprovam um histórico de migrations aplicado no serviço.

[docs/verification.md](../docs/verification.md) e [docs/verification-db.md](../docs/verification-db.md) mantêm registros datados de verificações locais, remotas, de navegador e publicações em 3 de outubro de 2026. Os números 153, 170 e 178 testes refletem etapas históricas distintas. Não são prova do estado atual dos serviços externos.

## Execução atual em 2026-10-07

Resultado informado pela sessão raiz: o `npm test` padrão passou com 14 arquivos e 190 testes em 1,01 s, contando os 12 casos de snapshot em `.design-export/`. A raiz também executou `npm test -- --exclude '**/.design-export/**'`: passou com 12 arquivos ativos e 178 testes em 939 ms. `npm run typecheck` e `npm run build` passaram; o build incluiu TypeScript, Vite 8.3.2 (2.790 módulos) e o bundle Node da API. O ambiente observado foi Node `25.9.0` e npm `11.12.1`. O projeto declara Node `24.x` e gera o bundle para `node24`, então essa execução não comprova compatibilidade testada em Node 24.

Nesta tarefa não foram executados smoke, SQL, teste em navegador, chamada a provedor ou consulta de disponibilidade pública. A execução excluindo `.design-export` separa os testes ativos dos snapshots locais sem alterar esses arquivos.

Veja também: [índice](index.md) · [visão geral](overview.md) · [arquitetura](architecture.md) · [frontend](frontend.md) · [canvas](canvas.md) · [backend](backend.md) · [IA](ai.md) · [pesquisa](research.md) · [persistência](persistence.md) · [segurança](security.md) · [design system](design-system.md) · [operações](operations.md) · [riscos](risks.md) · [manutenção](maintenance.md).
