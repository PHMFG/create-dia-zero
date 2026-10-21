---
title: Fontes do repositório da create
kind: source
updated: 2026-10-21
status: mixed
sources:
  - ../../package.json
  - ../../README.md
  - ../../docs/architecture.md
  - ../../docs/verification.md
  - ../../docs/verification-db.md
  - ../../.design-export/README.md
  - ../../.design-export/updates/implementation-notes.md
---

# Fontes do repositório da create

A análise usa o checkout da raiz do repositório (`./`) em **7 de outubro de 2026**. O HEAD observado é `ee6d90999b951a82d027170117667aba731e4195`, branch `codex/create-mvp`. O estado lido inclui mudanças locais de design em 14 arquivos rastreados e arquivos novos em `src/`, `public/` e `.design-export/`. Assim, o HEAD isolado não reproduz todo o estado documentado.

Três subagentes **gpt-6-luna**, com esforço **max**, dividiram frontend/design, backend/IA/dados e domínio/testes/operação. A raiz leu as referências, montou a síntese entre áreas e executou as verificações locais. A lista abaixo serve para localizar evidências, não para atribuir disponibilidade externa ao código.

## Fontes ativas

| Grupo | Arquivos lidos e responsabilidade | Síntese |
| --- | --- | --- |
| Entrada e navegação | [index.html](../../index.html), [main.tsx](../../src/main.tsx), [App.tsx](../../src/App.tsx). | [Frontend](../frontend.md). |
| Interface do produto | `src/components/`: Landing, Workspace, Canvas, Dialogs, CardChat, PromptQueue, AgentActivity, RichText, MediaBlock, BrandVisual e seus CSS. | [Frontend](../frontend.md), [canvas](../canvas.md), [design](../design-system.md). |
| Estado e transporte no cliente | [api.ts](../../src/lib/api.ts), [eventStream.ts](../../src/lib/eventStream.ts), [projectMerge.ts](../../src/lib/projectMerge.ts), [cardLayout.ts](../../src/lib/cardLayout.ts). | [Frontend](../frontend.md), [backend](../backend.md). |
| Estilos e marca | [styles.css](../../src/styles.css), [usability.css](../../src/usability.css), [design-system.css](../../src/design-system.css), `public/icon.svg`, `public/design/`, `public/figma/`. | [Design](../design-system.md). |
| Domínio | [types.ts](../../shared/types.ts), [validation.ts](../../shared/validation.ts), [domain.ts](../../shared/domain.ts), [canvasConnections.ts](../../shared/canvasConnections.ts), [media.ts](../../shared/media.ts). | [Domínio](../domain.md), [canvas](../canvas.md), [segurança](../security.md). |
| API | [app.ts](../../server/app.ts), [dev.ts](../../server/dev.ts), [vercel.ts](../../server/vercel.ts), [api/index.mjs](../../api/index.mjs). | [Backend](../backend.md), [arquitetura](../architecture.md). |
| IA e pesquisa | [ai.ts](../../server/ai.ts), [prompts.ts](../../server/prompts.ts), [research.ts](../../server/research.ts). | [IA](../ai.md), [pesquisa](../research.md). |
| Dados | [store.ts](../../server/store.ts), [schema.sql](../../supabase/schema.sql), [cancellation.sql](../../supabase/cancellation.sql). | [Persistência](../persistence.md), [segurança](../security.md). |
| Testes unitários/integração local | Todos os `tests/*.test.ts`, `src/lib/projectMerge.test.ts`, `src/lib/cardLayout.test.ts`. | [Testes](../testing.md), com mapa por arquivo. |
| Avaliação e smoke | [ai-evaluation.json](../../tests/ai-evaluation.json), [smoke-api.ts](../../scripts/smoke-api.ts), [smoke-demo.ts](../../scripts/smoke-demo.ts), [security.sql](../../supabase/tests/security.sql). | [Testes](../testing.md); cenários e efeitos distintos da suíte local. |
| Ambiente e build | [package.json](../../package.json), [package-lock.json](../../package-lock.json), [tsconfig.json](../../tsconfig.json), [vite.config.ts](../../vite.config.ts), [vercel.json](../../vercel.json), [.env.example](../../.env.example), [.gitignore](../../.gitignore), [.vercelignore](../../.vercelignore), [build-api.mjs](../../scripts/build-api.mjs). | [Operação](../operations.md). |

O lockfile dá as versões resolvidas; não é uma implementação de comportamento. Imagens, fontes binárias, bundles e repetições de HTML gerado são artefatos, analisados pelo papel e pelas fontes geradoras quando pertinente. Os testes copiados em `.design-export/src/lib/cardLayout.test.ts` e `projectMerge.test.ts` também foram lidos: são 12 casos de snapshot coletados pelo comando padrão, além dos 178 casos do aplicativo ativo. Veja [testes](../testing.md).

## Registros e snapshots

| Fonte | Data e escopo | Uso correto |
| --- | --- | --- |
| [README](../../README.md) | Guia de uso e operação existente. | Porta de entrada; estado de serviços requer atualização externa. |
| [docs/architecture.md](../../docs/architecture.md) | Síntese anterior do MVP. | Contexto dos mecanismos; conferir código e design ativos. |
| [docs/verification.md](../../docs/verification.md) | Etapas de 3 de outubro de 2026, incluindo produção e cancelamento. | Evidência histórica delimitada a cada execução. |
| [docs/verification-db.md](../../docs/verification-db.md) | SQL e advisors de 3 de outubro de 2026. | Registro histórico; não auditoria atual do serviço. |
| `.design-export/README.md` (local, fora do Git) | Extração de estados e biblioteca para Figma. | Explica cópias, mocks, geração e limites da captura. |
| `.design-export/updates/implementation-notes.md` (local, fora do Git) | Implementação visual registrada em 6 de outubro de 2026. | Procedência dos ajustes locais e QA visual daquela revisão. |
| `.design-export/` fontes, manifestos e audits | Harness, cenários, exportação, captura, tokens e notas locais. | [Design](../design-system.md) separa origem de capturas e runtime. |

Os HTMLs de `out/`, arquivos de `preview-dist/`, imagens de QA e manifestos derivados não são módulos adicionais do aplicativo. Foram considerados como saídas das ferramentas de design; sua presença não prova uma nova execução visual nem o conteúdo atual do Figma remoto.

## Dados excluídos da documentação

Valores de `.env.local`, credenciais, tokens, configurações privadas de conta e dados reais de usuários não são fontes necessárias para esta wiki. A documentação registra nomes de variáveis e contratos públicos. `node_modules/`, `.git/`, `dist/` e `.server/` fornecem dependências, histórico ou artefatos; não foram copiados para o conteúdo.

Resultados locais desta análise ficam em [testes](../testing.md), limitações em [riscos](../risks.md), e atualizações futuras seguem [manutenção](../maintenance.md). Volte ao [índice](../index.md).
