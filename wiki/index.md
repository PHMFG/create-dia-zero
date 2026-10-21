---
title: Índice da wiki da create
kind: index
updated: 2026-10-07
status: code-verified
sources:
  - ../AGENTS.md
  - sources/repository.md
---

# Wiki da create

A create organiza uma ideia de negócio em um plano editável e ajuda a escolher o próximo teste real. Esta wiki reúne o funcionamento do produto, a implementação e os limites relevantes para continuar o projeto sem depender do histórico de chats.

Leia [a visão geral](overview.md) para entender o produto ou escolha o assunto abaixo. O [AGENTS.md](../AGENTS.md) contém as instruções de entrada e manutenção para agentes futuros. As páginas descrevem o checkout analisado em **7 de outubro de 2026**, incluindo mudanças locais de design; o código citado continua sendo a referência para uma alteração.

## Produto e estrutura

| Página | O que responde |
| --- | --- |
| [Visão geral](overview.md) | Propósito, ciclo de uso, demonstração e fronteiras do MVP. |
| [Arquitetura](architecture.md) | Como navegador, domínio, API, provedores e banco se conectam. |
| [Domínio](domain.md) | Entidades, invariantes, revisões, propostas e importação/exportação. |
| [Decisões](decisions.md) | Escolhas observáveis na implementação e suas consequências. |

## Implementação

| Página | O que responde |
| --- | --- |
| [Frontend](frontend.md) | Inicialização, navegação, autosave, merge, conversa e fila. |
| [Canvas](canvas.md) | Cartões, blocos, dependências, layout e interações. |
| [Design e extração](design-system.md) | Tokens ativos, estilos, SVGs e procedência das capturas. |
| [Backend e contratos](backend.md) | Endpoints, validação, eventos SSE e ciclo da mensagem. |
| [IA](ai.md) | Roteamento, contexto, ferramentas, publicações e fallback. |
| [Pesquisa](research.md) | Tavily, fontes, síntese, mídia e cotas de pesquisa. |
| [Persistência](persistence.md) | Sessão, CAS, RLS, reservas e cancelamento durável. |
| [Segurança](security.md) | Limites de confiança, acesso, URLs e funções SQL. |

## Operação e continuidade

| Página | O que responde |
| --- | --- |
| [Operação](operations.md) | Ambiente, variáveis, dev integrado, build e publicação. |
| [Testes e verificações](testing.md) | Cobertura, mocks, smoke, SQL e resultados locais desta análise. |
| [Riscos e estado](risks.md) | O que ainda exige verificação e onde os registros divergiram. |
| [Manutenção da wiki](maintenance.md) | Convenções, ingestão, consulta e revisão da documentação. |
| [Log](log.md) | Registro cronológico das atualizações da wiki. |

## Fontes

- [Mapa das fontes do repositório](sources/repository.md): escopo lido, arquivos ativos, artefatos e relatórios históricos.
- [Formato LLM Wiki](sources/llm-wiki.md): referência externa que orientou a organização desta wiki.

## Escolha uma rota de leitura

| Tarefa | Páginas iniciais |
| --- | --- |
| Ajustar interface ou integrar design | [Frontend](frontend.md) → [design](design-system.md) → [canvas](canvas.md). |
| Investigar perda de edição ou conflito | [Frontend](frontend.md) → [domínio](domain.md) → [persistência](persistence.md). |
| Corrigir conversa, streaming ou fila | [Backend](backend.md) → [IA](ai.md) → [frontend](frontend.md). |
| Investigar pesquisa, referências ou imagem | [Pesquisa](research.md) → [IA](ai.md) → [segurança](security.md). |
| Corrigir interrupção ou execução presa | [Persistência](persistence.md) → [backend](backend.md) → [testes](testing.md). |
| Executar localmente ou preparar publicação | [Operação](operations.md) → [riscos](risks.md) → [testes](testing.md). |

Abra depois os arquivos citados na rota escolhida. Use `rg` sobre `wiki/` e o módulo relevante quando o índice não bastar.
