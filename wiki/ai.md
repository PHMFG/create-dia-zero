---
title: IA e geração de turnos
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../server/ai.ts
  - ../server/prompts.ts
  - ../server/research.ts
  - ../server/app.ts
  - ../shared/domain.ts
  - ../shared/validation.ts
  - ../shared/types.ts
---

# IA e geração de turnos

O turno combina roteamento opcional, geração com ferramentas, validação e publicação no canvas. O fluxo principal está em [generateTurn](../server/ai.ts#L557); as instruções e o pacote de contexto estão em [server/prompts.ts](../server/prompts.ts).

## Provedores e rota

O gerador usa a API compatível com OpenAI do OpenCode Go. A chave é OPENCODE_GO_API_KEY; o modelo pode vir de OPENCODE_MODEL ou OPENCODE_GO_MODEL, com deepseek-flash como padrão. A URL pode vir de OPENCODE_BASE_URL ou OPENCODE_GO_BASE_URL, com o endpoint OpenCode Zen Go como padrão. Esses nomes descrevem o código e seus padrões: a presença de configuração não prova que a chamada externa esteja disponível.

Quando há TYPESAFE_API_KEY, [routeTurn](../server/ai.ts#L59) consulta Jev pelo TypeSafe, com jev-1.13.0 como padrão, timeout de oito segundos e sem repetição automática. Jev escolhe entre responder, esclarecer, pesquisar, orientar ação, revisar evidência ou não encaminhar, e sugere uma lacuna de contexto. Uma rota só é aceita como certa se a probabilidade maior for pelo menos 0,8 e superar a seguinte por pelo menos 0,2. Evidência já registrada força review. Sem Jev, ou se a consulta falhar, o código usa review quando há evidência e uma detecção textual simples para pedidos de pesquisa.

Sem OPENCODE_GO_API_KEY, generateTurn retorna orientação básica antes de criar a sessão de pesquisa ou chamar Jev. Com a chave configurada, uma falha do roteador Jev não encerra a conversa; a geração continua com a rota de reserva.

## Contexto, ferramentas e limites

O pacote de contexto em [buildContextPacket](../server/prompts.ts#L56) prioriza o cartão focado, a ação atual, cartões editados pela pessoa e decisões. Ele tem orçamento de 60 mil caracteres, seleciona até 18 cartões, 12 evidências recentes, 16 mensagens, 12 fontes, um índice de até 80 cartões, cinco propostas e cinco revisões. Conteúdos longos podem ser resumidos ou omitidos; a ferramenta read_project_item lê um registro original por ID, com resposta limitada a 24 mil caracteres.

As instruções distinguem fatos do usuário, hipóteses, fontes, evidências e decisões. Impedem tratar intenção como resultado externo e orientam o modelo a não preencher cidade, orçamento ou disponibilidade por suposição. As respostas seguem um JSON validado: reply, contextPatch, operations, sources e mode; proposal e usage são opcionais.

O ToolLoopAgent recebe ferramentas de leitura de registros, cálculo, pesquisa, publicação incremental e síntese de pesquisa. O cálculo roda em código do servidor e não avalia expressões. Pesquisa está condicionada à configuração de Tavily; publicação e síntese incremental só entram quando a API fornece onDelta. O comportamento de pesquisa está detalhado em [research.md](research.md).

Cada geração tem timeout de 90 segundos. A rota de pesquisa recebe no máximo quatro etapas de ferramenta; outras rotas, seis. O modelo tem limite de saída de 5.000 tokens e maxRetries zero. Se a saída JSON ou o canvas falhar na validação, há uma tentativa adicional, limitada, para corrigir a estrutura; essa correção não repete a pesquisa.

## Validação e autoria do canvas

[sanitizeTurn](../server/ai.ts#L118) substitui fontes fornecidas pelo modelo pelas fontes reais do turno, repõe IDs e metadados de cartão no servidor e valida operações com Zod. Atualizações precisam apontar para um cartão existente e usam expectedRevision; valores de origem, revisão, edição humana e posição não são aceitos do modelo em patches. Texto e mídia são checados contra links fornecidos pela pessoa ou fontes conhecidas. Coordenadas inventadas são removidas.

As relações são validadas para evitar cartões inexistentes e ciclos. [ensureCanvasCoverage](../server/ai.ts#L510) exige pelo menos hipótese e teste na primeira ideia, um documento para novos dados de recursos e conteúdo no canvas quando a rota envolve ação, evidência ou pesquisa. Para mudanças estratégicas, conflitos com edição humana e revisões obsoletas, o domínio mantém o plano atual e cria proposta para a pessoa revisar; veja [shared/domain.ts](../shared/domain.ts).

## Publicação incremental e fallback

Com a API, o modelo usa [publish_canvas](../server/ai.ts#L619) durante a geração. O servidor valida cada delta, o domínio o salva e o evento project informa o estado realmente persistido. [publishCanvasSequentially](../server/ai.ts#L360) publica pré-requisitos antes de cartões dependentes e mantém mudanças de prioridade agrupadas. Um ledger retira do resultado final o que já foi publicado para não aplicar a mesma operação duas vezes.

O texto só é transmitido depois de uma publicação útil, e o decodificador expõe somente o campo reply do JSON. URLs em construção e referências de fonte ainda não resolvidas ficam retidas. Durante uma busca, a resposta não é transmitida até a síntese ficar pronta. Atividades mostram ferramenta, rótulo e estado observável, sem argumentos privados nem raciocínio interno.

Se a chave de geração estiver ausente, [fallbackTurn](../shared/domain.ts#L429) pode registrar uma lacuna explicitamente dita, preparar roteiro básico, orientar a revisão de evidência ou informar que não pesquisou. Se a geração falhar depois de fontes terem sido salvas, a resposta avisa que a pesquisa ficou parcial e conserva essas fontes. Códigos de erro distinguem quota, autorização, timeout, modelo indisponível e saída inválida, mas não confirmam a causa externa além do status recebido.

Veja também: [índice](index.md) · [visão geral](overview.md) · [arquitetura](architecture.md) · [backend](backend.md) · [pesquisa](research.md) · [canvas](canvas.md) · [domínio](domain.md) · [persistência](persistence.md) · [testes](testing.md) · [riscos](risks.md).
