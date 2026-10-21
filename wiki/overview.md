---
title: Visão geral da create
kind: overview
updated: 2026-10-07
status: code-verified
sources:
  - ../README.md
  - ../src/App.tsx
  - ../src/components/Workspace.tsx
  - ../shared/domain.ts
  - ../server/prompts.ts
---

# Visão geral da create

A **create** é um copiloto em português para quem está começando um negócio. A conversa registra contexto, hipóteses e próximos passos num canvas editável. O aprendizado vem de uma ação realizada pela pessoa fora do aplicativo; o relato pode fundamentar uma proposta de mudança do plano.

O nome do pacote é `create-dia-zero`; o diretório do projeto é `Hackaton`. A implementação é React/Vite com API Hono e domínio TypeScript compartilhado. O [mapa de arquitetura](architecture.md) mostra onde cada responsabilidade vive.

## Ciclo de uso

1. A pessoa descreve a ideia ou abre Chabor, um exemplo identificado como demonstração.
2. A conversa esclarece lacunas úteis. A IA pode publicar cartões enquanto trabalha: hipóteses, recursos, testes e pesquisa ganham documentos próprios.
3. A pessoa corrige títulos, blocos e checklists, move cartões e liga pré-requisitos. A leitura do plano independe de recuperar o texto inteiro do chat.
4. Pesquisa web acrescenta fontes recuperadas e uma interpretação vinculada a elas. Disponibilidade e configuração do serviço condicionam esse fluxo.
5. A pessoa executa o teste no mundo real e usa **Registrar experiência**. A evidência guarda o relato e sua origem.
6. Uma proposta relaciona aprendizado, decisão e próximo passo. A pessoa pode aceitar ou rejeitar; revisões conflitantes impedem aplicar uma proposta antiga sobre conteúdo novo.

Esses caminhos aparecem em [Workspace](../src/components/Workspace.tsx), [diálogos](../src/components/Dialogs.tsx), [domínio](domain.md) e [instruções da IA](../server/prompts.ts).

## O que o plano contém

Cartões representam ideia/contexto, hipótese, pesquisa, ação, evidência, decisão ou anotação. Cada um tem resumo, blocos, prioridade, revisão e dependências. As quatro prioridades são agora, próximo, depois e concluído; o domínio mantém no máximo uma ação em agora. O chat geral e o mini chat de um cartão compartilham o projeto, com foco e histórico identificados.

Fontes e evidências são registros distintos. `Source.verified` indica que o servidor recuperou a referência. Uma evidência pode ser um relato humano ou uma amostra demonstrativa; marcar um checklist não muda sua qualidade. Consulte [domínio](domain.md) e [pesquisa](research.md) antes de mudar essas relações.

## Identidade e continuidade

Não há cadastro convencional. Com Supabase configurado, o navegador inicia uma sessão de Auth anônima e os projetos pertencem a essa identidade. Um URL com `?projeto=<id>` retoma o projeto apenas quando a sessão tem acesso. Não há compartilhamento entre visitantes por esse link.

Há até três projetos por identidade. Exportação e importação JSON são o caminho implementado para levar uma cópia a outro navegador; importar cria um projeto independente. Limpar a sessão sem exportar pode perder o acesso. No modo local sem banco, os documentos ficam na memória do servidor e desaparecem ao reiniciá-lo. Veja [persistência](persistence.md).

## Demonstração Chabor

`createDemoProject()` constrói dez cartões, cobre os sete tipos e organiza um fluxo ilustrativo de entrevista, aprendizado e teste gratuito. Relatos e valores são fictícios. A referência manual permanece não verificada. Criar uma nova cópia usa o exemplo atual; a função não migra nem substitui projetos existentes. Fonte: [shared/domain.ts](../shared/domain.ts) e [tests/demo.test.ts](../tests/demo.test.ts).

## Fronteiras do MVP

Os provedores podem falhar ou estar ausentes. O aplicativo identifica orientação básica como fallback e pesquisa indisponível como tal. Cotas e deadlines restringem a execução; configuração presente não comprova disponibilidade do provedor. [IA](ai.md), [backend](backend.md) e [riscos](risks.md) detalham esses estados.

O produto não implementa pagamentos, planos comerciais, contato automático com terceiros ou execução de compras. As ferramentas da IA leem o projeto, calculam, pesquisam e publicam documentos internos. Capturas de design e testes locais não comprovam demanda de negócio nem disponibilidade atual de produção.

Continue pelo [índice](index.md), pelas [decisões](decisions.md) ou pelo [mapa de fontes](sources/repository.md).
