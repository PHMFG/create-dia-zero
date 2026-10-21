---
title: Manutenção da wiki da create
kind: guide
updated: 2026-10-07
status: documented
sources:
  - ../AGENTS.md
  - sources/repository.md
  - sources/llm-wiki.md
---

# Manutenção da wiki da create

Esta wiki é documentação versionável dentro do repositório. Os agentes mantêm a síntese do projeto ao alterar o comportamento; a pessoa pode navegar pelas páginas e conferir os arquivos citados. O [AGENTS.md](../AGENTS.md) orienta a entrada em futuros chats.

## Estrutura adotada

| Local | Papel |
| --- | --- |
| Código, SQL, configurações e relatórios existentes | Evidências do projeto, registradas em [sources/repository.md](sources/repository.md). |
| `wiki/*.md` | Sínteses por assunto, com conexões e limites de evidência. |
| `wiki/sources/*.md` | Procedência, escopo e resumo das referências. |
| `wiki/index.md` | Catálogo e rotas para localizar o assunto de uma tarefa. |
| `wiki/log.md` | Histórico apenas por acréscimo de eventos relevantes. |
| `AGENTS.md` | Regras de leitura, trabalho e atualização. |

Para uma tarefa documental, leia as fontes sem modificá-las para fazê-las concordar com uma síntese. Para uma tarefa de implementação autorizada, o código evolui e a wiki deve acompanhá-lo. Não é necessário duplicar o repositório numa pasta `raw/`: os caminhos citados e o histórico Git já fornecem a procedência local.

## Formato de página

Use nomes estáveis em minúsculas, com hífen, e links Markdown relativos. O formato funciona no repositório e pode ser aberto como pasta no Obsidian, sem dependência de um índice vetorial ou ferramenta externa.

```yaml
---
title: Assunto específico
kind: topic
updated: AAAA-MM-DD
status: code-verified
sources:
  - ../server/arquivo.ts
---
```

Os tipos usados são `index`, `overview`, `topic`, `synthesis`, `guide`, `source` e `log`. `code-verified` indica leitura do código citado, não execução real do serviço; `mixed` combina evidências de escopos diferentes explicitadas no texto; `documented` registra uma convenção ou referência. Ao guardar um relatório de execução, use `test-verified` e informe comando, data, ambiente, resultado e limites.

Comece explicando o comportamento e por que o assunto importa para continuar o projeto. Cite arquivo e nome de função perto do mecanismo explicado. Para SQL, cite tabelas, RPCs e papéis. Evite trechos extensos que envelhecem como uma segunda implementação.

## Atualizar depois de uma mudança

1. Confirme o comportamento nos arquivos alterados e nos testes pertinentes. Identifique as páginas afetadas pelo [índice](index.md) ou `rg`.
2. Corrija a página principal do assunto e seus links cruzados. Remova descrições supersedidas da síntese atual; mantenha resultados antigos como histórico com data e escopo.
3. Atualize `updated`, fontes e status. Uma mudança no código não confirma automaticamente o serviço remoto, o design renderizado ou a qualidade do modelo.
4. Atualize [decisões](decisions.md) quando houver uma escolha duradoura, e [riscos](risks.md) quando houver limitação material ou verificação pendente.
5. Acrescente páginas novas ao índice e à relação de fontes. Evite páginas órfãs e duplicações entre assuntos.
6. Acrescente um evento ao [log](log.md) com a mudança, páginas e validação. Um trabalho lógico pode ter uma entrada única; não registre cada chamada de ferramenta.

Para uma nova referência externa, registre URL, data da consulta, resumo curto e o que ela sustenta em `sources/`. Não copie artigos inteiros. Para arquivos privados, documente apenas a função e os nomes de variáveis necessários, sem valores, tokens ou dados de usuários.

## Consultar e consolidar

Leia o índice, escolha o assunto e abra o código citado que a pergunta exige. Responda com evidência pertinente ao escopo. Uma descoberta duradoura, um novo contrato ou uma comparação reutilizável pode ser integrada à página correspondente; perguntas pontuais não precisam virar páginas.

Se código e wiki discordarem, confirme a implementação e atualize a síntese. Se um relatório antigo divergir de um teste novo, preserve as duas datas e delimite qual comportamento o teste novo cobriu. Uma mudança de configuração externa exige verificação no ambiente, não apenas edição textual.

## Revisar a saúde da wiki

- Confira que links relativos e `sources` apontam a arquivos existentes.
- Confira que cada página aparece no índice e recebe ligação de uma página relacionada.
- Procure afirmações contraditórias sobre versões, limites, responsabilidades e estado de produção.
- Identifique caminhos renomeados, números congelados e resultados sem ambiente/data.
- Distinga código lido, teste executado, relatório histórico e hipótese.
- Execute `git diff --check` e reveja o diff documental para preservar alterações preexistentes.

Para buscas locais, use `rg -n 'termo' wiki` e `rg --files wiki`. A revisão não deve acionar implantação, geração paga, comunicação externa ou SQL remoto por conta própria. Consulte [operação](operations.md), [testes](testing.md) e [riscos](risks.md) para escolher verificações conforme o pedido.
