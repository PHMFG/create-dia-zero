---
title: Histórico da wiki da create
kind: log
updated: 2026-10-21
status: test-verified
sources:
  - sources/repository.md
  - testing.md
  - ../AGENTS.md
---

# Histórico da wiki da create

Registro por acréscimo das atualizações relevantes. O [índice](index.md) organiza assuntos; este arquivo preserva datas, escopo e validação. As convenções estão em [manutenção](maintenance.md).

## [2026-10-07] ingest | Wiki inicial do repositório

**Escopo:** checkout `codex/create-mvp`, HEAD `ee6d90999b951a82d027170117667aba731e4195` e mudanças locais de design preexistentes. Três subagentes `gpt-6-luna` com esforço `max` analisaram interface/design, backend/IA/dados e domínio/testes/operação; a raiz compilou a síntese e revisou a documentação.

**Resultado:** páginas conectadas de produto, arquitetura, frontend, canvas, design, domínio, backend, IA, pesquisa, persistência, segurança, decisões, operação, testes e riscos; catálogo de fontes e convenções de manutenção. `AGENTS.md` passou a fornecer o ponto de entrada para chats futuros e o README recebeu um link para a wiki.

**Verificações locais:** `npm test` passou com 190 casos em 14 arquivos. A listagem do Vitest confirmou duas cópias de testes em `.design-export/src/lib/`; `npm test -- --exclude '**/.design-export/**'` passou com os 178 casos do aplicativo ativo em 12 arquivos. `npm run typecheck` e `npm run build` passaram, incluindo o bundle da API. Ambiente: Node 25.9.0 e npm 11.12.1; o projeto declara Node 24.x.

**Achados consolidados:** health indica presença de configuração; pesquisa contabiliza reserva prevista, sem persistir uso individual de Tavily; relatórios de produção/banco e QA visual têm escopos históricos próprios; as contagens de testes precisam distinguir cópias de design. Veja [riscos](risks.md) e [testes](testing.md).

**Revisão documental:** 20 páginas conferidas; 471 links locais e 235 referências locais de frontmatter resolvidos, sem arquivos ausentes ou páginas órfãs. Todos os arquivos rastreados do projeto têm referência explícita na wiki. `git diff --check` passou. A revisão cruzada do backend confirmou a síntese e acrescentou a fonte SQL de cancelamento à arquitetura.

As alterações desta tarefa são documentais. IA real, pesquisa, SQL remoto, disponibilidade de produção e estado do Figma não foram verificados novamente. Consulte [mapa de fontes](sources/repository.md) para a procedência e [AGENTS.md](../AGENTS.md) para continuar.

## [2026-10-21] maintenance | Preparação para publicar no GitHub

**Escopo:** o `.gitignore` passou a excluir `.design-export/`, `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`, `*.log` e `coverage/`. O e-mail de autor e committer dos commits de `codex/create-mvp` foi trocado pelo endereço noreply do GitHub com `git filter-repo`; árvores, datas e mensagens se mantiveram, mas todos os hashes mudaram.

**Resultado:** os links Markdown para arquivos de `.design-export/` em [testes](testing.md), [design](design-system.md) e [fontes](sources/repository.md) viraram caminhos em código, porque a pasta não existe num clone. As citações do HEAD analisado em 7 de outubro, nesta página e em [fontes](sources/repository.md), passaram a usar o hash reescrito `ee6d909`, que tem a mesma árvore. Em [fontes](sources/repository.md), o caminho absoluto do checkout virou `./`.

**Verificações:** os links Markdown locais das páginas alteradas resolvem para arquivos rastreados; `git diff --check` passou. A mudança é documental: testes, build e serviços não foram executados.

**Complemento:** as fontes de frontmatter que apontavam para `.design-export/` saíram de [design](design-system.md), [testes](testing.md), [riscos](risks.md) e [fontes](sources/repository.md); o texto dessas páginas continua citando os caminhos como arquivos locais. Em [riscos](risks.md), o estado de publicação passou a registrar que as mudanças de design estão commitadas e que a pasta é ignorada. Todas as fontes locais de frontmatter e os links locais da wiki resolvem para arquivos rastreados.

## [2026-10-21] docs | README bilíngue e licença MIT

**Escopo:** o `README.md` passou a ser a apresentação em inglês, com `README.pt-BR.md` equivalente, `LICENSE` MIT e imagens em `docs/assets/` capturadas do demo Chabor no modo local sem chaves. O README atual não registra URL pública, IDs nem detalhes da implantação.

**Resultado:** [operação](operations.md), [riscos](risks.md), [decisões](decisions.md) e [fontes](sources/repository.md) deixaram de descrever o README anterior. As fontes passaram a citar os dois READMEs, a licença e as imagens.

**Verificações:** num clone limpo, com apenas `.env.example` copiado, `npm ci`, `npm test` (12 arquivos, 178 testes), `npm run typecheck`, `npm run build` e `npm run dev` em modo local passaram com Node `25.9.0` e npm `11.12.1`. A URL pública registrada em `docs/verification.md` respondeu 503, com a implantação pausada. Os links locais e as fontes de frontmatter da wiki resolvem para arquivos rastreados; `git diff --check` passou.
