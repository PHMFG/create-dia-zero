---
title: Backend e API
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../server/app.ts
  - ../server/dev.ts
  - ../server/vercel.ts
  - ../server/store.ts
  - ../server/ai.ts
  - ../src/lib/api.ts
  - ../src/lib/eventStream.ts
  - ../shared/types.ts
  - ../shared/validation.ts
  - ../shared/domain.ts
---

# Backend e API

A API é um aplicativo Hono em [server/app.ts](../server/app.ts). O mesmo handler é usado pelo adaptador Vercel em [server/vercel.ts](../server/vercel.ts); [server/dev.ts](../server/dev.ts) serve a interface Vite e carrega configuração local. A camada de dados e sessão está em [server/store.ts](../server/store.ts), e as regras que transformam um projeto ficam em [shared/domain.ts](../shared/domain.ts).

## Rotas

As rotas de projeto exigem Bearer token. A exceção são configuração e health, que são públicas. Os corpos são validados com Zod e o limite geral de corpo é 1,5 MB; importação e edição do canvas aceitam até 3 MB. A API define Cache-Control no-store e X-Content-Type-Options nos endpoints sob /api.

| Método e caminho | Entrada e resposta | Implementação |
|---|---|---|
| GET /api/config | Público. Retorna URL Supabase, chave publishable e chave pública do Turnstile a partir do ambiente. | [app.ts:24](../server/app.ts#L24) |
| GET /api/health | Público. Retorna modo de armazenamento, presença de chaves de IA/pesquisa e auth guest. Os booleanos indicam configuração, não uma chamada bem-sucedida ao provedor. | [app.ts:25](../server/app.ts#L25) |
| GET /api/projects | Lista até três projetos da sessão. | [app.ts:26](../server/app.ts#L26) |
| POST /api/projects | Recebe {idea}, texto de 3 a 12.000 caracteres; responde 201 com Project. | [app.ts:27](../server/app.ts#L27) |
| POST /api/projects/demo | Cria o projeto demonstrativo; responde 201 com Project. | [app.ts:28](../server/app.ts#L28) |
| POST /api/projects/import | Recebe um Project completo validado e importa como novo projeto; responde 201. | [app.ts:29](../server/app.ts#L29) |
| GET /api/projects/:id | Lê um projeto pertencente à sessão. | [app.ts:30](../server/app.ts#L30) |
| DELETE /api/projects/:id | Remove o projeto da sessão; responde {ok:true}. | [app.ts:31](../server/app.ts#L31) |
| PATCH /api/projects/:id/canvas | Recebe o Project completo. ID e versão precisam corresponder ao atual; aplica cards, contexto e título como edição humana e salva por versão esperada. | [app.ts:38](../server/app.ts#L38) |
| POST /api/projects/:id/evidence | Recebe relato, tipo, cartão opcional e até dez links; registra evidência no domínio. | [app.ts:44](../server/app.ts#L44) |
| POST /api/projects/:id/proposals/:proposalId/resolve | Recebe {accept:boolean}; aceita ou rejeita proposta pendente. | [app.ts:45](../server/app.ts#L45) |
| POST /api/projects/:id/messages | Recebe texto de 1 a 12.000 caracteres, runId de 10 a 100 caracteres e campos opcionais evidence e cardId. Responde como SSE. | [app.ts:46](../server/app.ts#L46) |
| POST /api/projects/:id/runs/:runId/cancel | Pede o cancelamento autenticado da execução; responde 202. | [app.ts:32](../server/app.ts#L32) |

Os esquemas completos de Project, Evidence, Source, cartões, blocos e mensagens estão em [shared/validation.ts](../shared/validation.ts). O formato de eventos SSE está em [shared/types.ts](../shared/types.ts).

## Conversa e eventos

Ao receber uma mensagem, a API valida o cartão focado, reserva o run, salva a mensagem da pessoa e então inicia a geração. A resposta emite eventos status, activity, text, project, complete ou error. A cada publicação incremental, persiste a alteração e envia um evento project com o projeto salvo, IDs de cartões alterados e rótulo. O evento complete leva o estado final salvo. Um comentário SSE keep-alive é enviado a cada dez segundos.

O cliente lê eventos em [src/lib/eventStream.ts](../src/lib/eventStream.ts). Ele exige um evento complete para considerar o fluxo concluído e não repete automaticamente uma solicitação interrompida, porque a mensagem ou parte do plano já pode ter sido gravada. O cliente tenta novamente apenas conflitos RUN_BUSY por até cinco segundos. Isso preserva a idempotência do runId e evita duplicar uma resposta cuja persistência ficou incerta.

Se a conexão for interrompida depois de a mensagem ser salva, o texto do usuário e os deltas persistidos permanecem no projeto. A resposta final do assistente só é gravada no encerramento concluído. Uma falha de geração emite error; uma interrupção confirmada fecha o run como cancelled. O cancelamento durável está detalhado em [persistence.md](persistence.md).

## Erros e configuração

Erros de validação retornam 400; sessão ausente ou inválida retorna 401; projeto/cartão ausente retorna 404; conflitos de versão ou execução retornam 409; limites retornam 429; falhas de dependência podem retornar 503. Respostas usam uma mensagem genérica para erros inesperados. O health deriva seus indicadores da presença de variáveis de ambiente; não confirma conectividade, autorização, crédito disponível nem sucesso recente. O estado atual de provedores e banco é uma propriedade do ambiente e não é demonstrado por esse endpoint.

Para o fluxo completo de geração, veja [ai.md](ai.md) e [research.md](research.md). Persistência e contrato dos dados estão em [persistence.md](persistence.md); autenticação e isolamento em [security.md](security.md).

Veja também: [índice](index.md) · [visão geral](overview.md) · [arquitetura](architecture.md) · [frontend](frontend.md) · [canvas](canvas.md) · [domínio](domain.md) · [operações](operations.md) · [testes](testing.md) · [riscos](risks.md) · [manutenção](maintenance.md).
