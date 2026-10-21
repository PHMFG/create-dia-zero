---
title: Decisões observáveis na implementação
kind: synthesis
updated: 2026-10-07
status: code-verified
sources:
  - ../shared/domain.ts
  - ../server/store.ts
  - ../server/ai.ts
  - ../server/app.ts
  - ../src/lib/projectMerge.ts
  - ../supabase/cancellation.sql
  - ../server/dev.ts
---

# Decisões observáveis na implementação

Esta página registra escolhas presentes no código e suas consequências. Os motivos abaixo explicam como os mecanismos se relacionam; não substituem atas de decisão nem pressupõem intenções que o repositório não registra.

## Documento de projeto com duas versões

O banco guarda o `Project` como JSON com uma versão para CAS; cartões têm revisão própria. Isso permite exportar o plano completo e manter regras do domínio em TypeScript, enquanto a versão do documento recusa uma gravação concorrente e a revisão do cartão recusa operações antigas. Alterações nesse modelo precisam considerar importação, autosave, SSE e propostas. Fontes: [tipos](../shared/types.ts), [store.save](../server/store.ts), [domínio](domain.md).

## Edição humana preservada durante a IA

O navegador combina baseline, estado local e estado remoto por IDs. O domínio conserva edições e checklists humanas e transforma operações conflitantes ou estratégicas em propostas. A consequência é que publicar pode resultar numa proposta, não numa alteração aplicada; a resposta da IA deve respeitar o resultado da ferramenta. Fontes: [projectMerge.ts](../src/lib/projectMerge.ts), [applyTurn e resolveProposal](../shared/domain.ts), [IA](ai.md).

## Publicação incremental depois de salvar

`publishCanvasSequentially` separa publicações informativas por cartão, respeitando pré-requisitos; alterações estruturais/estratégicas podem permanecer agrupadas. O callback da API salva antes de emitir o evento. `PublicationLedger` evita aplicar as mesmas operações ao fechar o turno. Interromper pode deixar documentos úteis já salvos sem uma resposta final do assistente. Fontes: [server/ai.ts](../server/ai.ts), [server/app.ts](../server/app.ts), [backend](backend.md).

## Cancelamento com confirmação durável

Há endpoint de cancelamento, polling do marcador e finalização da reserva após as gravações. O histórico de [verification.md](../docs/verification.md) relata uma falha real do aborto HTTP atrás do proxy que motivou esse mecanismo. A trava não deve ser liberada no instante do pedido, pois a geração anterior ainda pode estar encerrando. Fontes: [cancellation.sql](../supabase/cancellation.sql), [store](../server/store.ts), [persistência](persistence.md).

## Sessão anônima e isolamento por proprietário

O fluxo dispensa cadastro, mas cria uma identidade Supabase Auth. O JWT e `owner_id` delimitam os projetos em RLS. A experiência inicial tem menos etapas; continuidade entre dispositivos exige exportação/importação e o link do projeto não concede acesso. Introduzir login, colaboração ou compartilhamento requer um novo contrato de autoria. Fontes: [cliente API](../src/lib/api.ts), [schema.sql](../supabase/schema.sql), [segurança](security.md).

## Procedência antes da interpretação

O servidor recupera fontes de pesquisa, a IA cita IDs conhecidos e escreve uma síntese no mesmo cartão. A sanitização rejeita mídia e referências sem procedência aceita. `verified` descreve a recuperação, enquanto implicações de negócio continuam inferências. A demonstração e importações preservam suas origens distintas. Fontes: [research.ts](../server/research.ts), [sanitizeTurn](../server/ai.ts), [pesquisa](research.md).

## Cotas e exclusão mútua perto da persistência

Reservas por `runId` controlam idempotência, uma geração ativa por projeto, limites diários e pesquisa. No Supabase, helpers SQL coordenam essas condições; o modo local reproduz regras em memória. Isso restringe o uso do MVP, sem constituir proteção completa contra criação abusiva de identidades ou garantir custos de provedores. Fontes: [store.ts](../server/store.ts), [schema.sql](../supabase/schema.sql), [riscos](risks.md).

## Dev integrado com reinício manual

O comando principal usa `tsx server/dev.ts`, com API e Vite juntos, e não reinicia automaticamente o backend. O README relaciona essa escolha à continuidade das conversas durante edições. `dev:watch` fica disponível para alterações isoladas; `preview` não serve a API. Fontes: [package.json](../package.json), [server/dev.ts](../server/dev.ts), [operação](operations.md).

Novas escolhas que mudem esses contratos devem atualizar esta página, as páginas específicas e o [log](log.md). Consulte o [índice](index.md) e o [mapa de fontes](sources/repository.md).
