---
title: Domínio dos projetos
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../shared/types.ts
  - ../shared/domain.ts
  - ../shared/validation.ts
  - ../shared/canvasConnections.ts
  - ../shared/media.ts
  - ../src/lib/projectMerge.ts
  - ../src/lib/cardLayout.ts
  - ../tests/domain.test.ts
  - ../tests/demo.test.ts
  - ../tests/canvasConnections.test.ts
  - ../tests/media.test.ts
  - ../src/lib/projectMerge.test.ts
  - ../src/lib/cardLayout.test.ts
---

# Domínio dos projetos

O estado principal é `Project`, definido em [shared/types.ts](../shared/types.ts). O domínio em [shared/domain.ts](../shared/domain.ts) cria e transforma esse documento; [shared/validation.ts](../shared/validation.ts) valida seu formato. A API e a persistência estão descritas em [backend.md](backend.md) e [persistence.md](persistence.md).

## Estrutura do projeto

| Entidade | Papel no canvas e no histórico |
|---|---|
| `Context` | Guarda a ideia e os dados conhecidos: público, cidade, orçamento, disponibilidade, restrições e objetivo. `idea` é obrigatório; os demais campos são opcionais. |
| `CanvasCard` | Documento do plano, com tipo, título, resumo, prioridade (`now`, `next`, `later`, `done`), blocos, posição, revisão, origem, estado opcional e IDs de pré-requisitos. |
| `Block` | Conteúdo do cartão: título, parágrafo, lista, checklist, chamada, fontes, link, imagem ou localização. Itens de checklist têm ID, texto, estado concluído e marca opcional de edição humana. |
| `Source` | Referência com URL, data de consulta, trecho e `verified`; imagem é opcional. O status descreve a procedência registrada, não a verdade de toda conclusão. |
| `Evidence` | Relato separado do cartão: entrevista, observação, teste de oferta, compra ou outro. Pode apontar para um cartão e contém links informados. |
| `Message` | Mensagem do chat. `cardId` opcional liga uma conversa ao cartão; a mensagem continua no histórico geral se o cartão for removido. |
| `Proposal` | Grupo de operações `add`, `update` ou `remove`, com motivo e estado `pending`, `accepted` ou `rejected`. |
| `Revision` | Registro de cartões e contexto anteriores a uma mudança. O projeto conserva as 50 revisões mais recentes. |

Os sete tipos de cartão são `context`, `hypothesis`, `research`, `action`, `evidence`, `decision` e `note`. Os estados opcionais incluem `draft`, `ready`, `doing`, `awaiting_evidence`, `done` e `review`. Essas enumerações estruturam a interface; não certificam que uma atividade ocorreu ou que uma hipótese foi confirmada.

## Criação e progressão

`createProject` limpa caracteres de controle e espaços externos, exige uma ideia não vazia de até 12.000 caracteres e cria somente o cartão de contexto. Um projeto novo não recebe hipótese nem ação fixa: documentos entram conforme a conversa avança. `createDemoProject` é um fluxo explícito separado.

Cada mudança aplicada pelo domínio aumenta `version`, atualiza `updatedAt` e grava uma revisão com os cartões e o contexto anteriores, limitada a 50 entradas. Mensagens ligadas a cartões removidos perdem o vínculo e ficam disponíveis no chat principal.

Uma ação marcada como atual é um cartão `action` na faixa `now`. A normalização mantém no máximo uma; quando uma segunda ação tenta assumir essa faixa, a mudança de prioridade é agrupada numa proposta. Operações que retiram, movem ou substituem a ação atual permanecem agrupadas para serem aceitas como um conjunto. O canvas distribui novos cartões em espaços livres; posições fixadas pela pessoa são preservadas.

As relações em `dependsOn` apontam para pré-requisitos. A validação da conexão rejeita cartão ausente, autorrelação, duplicação, ciclo e mais de 50 dependências. `auditDependencyGraph` é uma inspeção somente de leitura. Na aplicação de operações e na importação, a normalização remove dependências repetidas, ausentes e cíclicas; também descarta IDs de cartão duplicados no conjunto normalizado. Essa diferença importa: `parseProject` valida a forma e os limites do documento, mas não é, por si só, uma auditoria completa do grafo.

## Edições, geração e propostas

Edições humanas incrementam a revisão do cartão e registram marcas `humanEdited` no cartão, blocos e itens alterados. Se uma posição muda, ela fica fixada. Em atualizações de IA, `editablePatch` impede alterar ID, revisão, origem, marca humana, posição e fixação. Remoções, revisões antigas, conteúdo editado pela pessoa e mudanças estratégicas ficam como conflitos em propostas. O conteúdo atual permanece no cartão até a proposta ser aceita.

Ao aceitar uma proposta, o domínio confere novamente a existência e a revisão de cada alvo; se houve edição posterior, lança `DomainConflictError` e mantém a proposta pendente. Uma proposta rejeitada preserva o conteúdo. Checklists concluídas pela pessoa também são preservadas ao aceitar conteúdo que substitui blocos; a conclusão não é convertida em evidência.

Atualizações de contexto usam o contexto observado no início da geração como baseline. Se a pessoa mudou um campo durante a geração, a resposta atrasada não restaura o valor antigo. Cartões de pesquisa, decisão e ações ainda não concluídas podem receber estado `review` quando o contexto muda. A estratégia de contexto e os deltas da IA estão em [ai.md](ai.md).

## Evidência e limites da demonstração

`recordEvidence` valida o relato, cria um item em `Project.evidence` e um cartão `evidence` separado. Se o relato estiver ligado a uma ação, ela passa a `done`; hipóteses e decisões passam para revisão. A função não cria uma decisão automática nem declara o negócio validado. Uma checklist preenchida muda o estado da ação para `awaiting_evidence`, sem produzir um registro de experiência.

O exemplo Chabor contém dez cartões dos sete tipos, uma ação atual de lista gratuita e uma referência manual do Sebrae não verificada. Entrevistas, respostas, orçamento, região, preços e resultados são ilustrativos; nenhuma venda ou entrevista real é representada. O critério de quatro manifestações entre dez convites também é apenas um parâmetro didático. Os testes de demonstração verificam essa transparência e o grafo, não a procura real por matcha. Veja [overview.md](overview.md) e [research.md](research.md).

## Importação, exportação e contratos

`exportProject` valida o documento e produz JSON com `format: "create-project"`, `formatVersion: 1`, data de exportação e o projeto completo. A importação aceita o objeto do projeto ou um envelope que tenha `project`; para texto JSON, o helper limita a entrada a 3.000.000 caracteres. A API também limita o corpo da operação de importação a 3 MB.

Uma importação cria um ID, datas e versão novos, acrescenta “cópia” ao título, limpa o histórico de revisões e define fontes como não verificadas. Propostas pendentes viram rejeitadas; propostas já aceitas ou rejeitadas continuam históricas. Mensagens de cartões inexistentes ficam no chat geral, e vínculos de fonte ausentes são removidos. O conteúdo exportado não é criptografado nem anonimizado: inclui mensagens, contexto, relatos, fontes e cartões.

Os limites centrais de Zod incluem 100 cartões, 500 mensagens, 200 fontes, 300 evidências, 200 propostas e 50 revisões; cada cartão aceita até 60 blocos, 50 dependências, e cada lista ou checklist até 80 itens. Atualizações da conversa aceitam até 25 operações e 20 fontes por turno. A ideia aceita 12.000 caracteres, o título do cartão 200, o resumo 2.000, o texto do bloco 16.000, e o relato de evidência de 3 a 16.000. URLs aceitam até 2.048 caracteres. URLs de fontes e mídia precisam usar HTTP ou HTTPS sem credenciais; regras adicionais para conteúdo externo estão em [security.md](security.md). A importação exige IDs únicos em cada coleção: cartões, fontes, evidências, propostas e mensagens; dentro de cada cartão, blocos e itens também não podem repetir ID.

Uma limitação do contrato atual é que o envelope de exportação é escrito, mas o helper de importação não confere `format` nem `formatVersion`: ele desembrulha `project` e valida o documento interno. Mudanças de formato precisam ser tratadas explicitamente antes de assumir migração automática.

Veja também: [índice](index.md) · [visão geral](overview.md) · [arquitetura](architecture.md) · [frontend](frontend.md) · [canvas](canvas.md) · [IA](ai.md) · [pesquisa](research.md) · [persistência](persistence.md) · [segurança](security.md) · [design system](design-system.md) · [riscos](risks.md) · [manutenção](maintenance.md).
