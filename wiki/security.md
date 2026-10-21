---
title: Autenticação e segurança
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../server/store.ts
  - ../server/app.ts
  - ../src/lib/api.ts
  - ../supabase/schema.sql
  - ../supabase/cancellation.sql
  - ../supabase/tests/security.sql
  - ../shared/validation.ts
  - ../shared/media.ts
  - ../server/ai.ts
---

# Autenticação e segurança

O projeto usa sessão anônima do Supabase Auth; o código não implementa cadastro por senha. O navegador consulta /api/config, cria ou recupera sessão Supabase e envia o access token em Authorization: Bearer. [store.session](../server/store.ts#L14) valida o token com auth.getUser e usa o UUID autenticado como owner. O modo local aceita um token local armazenado no navegador e mantém dados em memória; ele não fornece isolamento equivalente ao Auth e só é selecionado quando Supabase não está configurado fora de Vercel.

## Acesso aos dados

public.create_projects tem RLS habilitado. As políticas de select, insert, update e delete restringem cada linha a auth.uid() = owner_id, incluindo a conferência de proprietário na escrita. A aplicação também filtra consultas pelo proprietário. O trigger de criação impõe três projetos por proprietário com bloqueio transacional, cobrindo inserções paralelas e chamadas diretas ao Data API.

Os ledgers create_runs, create_run_locks e create_run_cancellations ficam no schema private, com RLS e sem acesso direto às tabelas concedido a visitantes. As funções privilegiadas verificam auth.uid() e autoria do projeto; wrappers públicos usam SECURITY INVOKER e são concedidos a authenticated. O SQL declara que private não deve fazer parte dos schemas expostos pela Data API. Essa configuração externa é requisito do desenho e não pode ser confirmada apenas lendo o repositório.

As funções helper privadas são SECURITY DEFINER. O SQL concede EXECUTE a authenticated e USAGE no schema private para permitir a delegação dos wrappers. Por isso, manter private fora dos schemas expostos é parte importante do controle; o teste SQL verifica que visitantes não leem as tabelas e que wrappers recusam operações entre proprietários, mas não comprova a configuração de exposição do projeto remoto.

## Entrada e saída não confiáveis

Os handlers limitam tamanho do corpo e validam projetos, evidências, fontes, cartões e operações com Zod. Versão e ID do projeto são conferidos antes de salvar o canvas; o banco repete a checagem da versão na atualização condicional.

Saída de IA também é dado não confiável. [sanitizeTurn](../server/ai.ts#L118) rejeita cartões e fontes sem procedência, remove metadados de autoria do modelo e protege revisões, posições, checklists concluídas e mídia humana. [shared/media.ts](../shared/media.ts) permite apenas URLs HTTP/HTTPS sem credenciais e filtra hosts locais/internos e classes de IP não públicas reconhecidas pelo validador. O servidor não executa código gerado; a ferramenta de cálculo só aplica operações numéricas definidas.

Instruções do projeto e páginas de pesquisa são tratadas pelo prompt como dados, sem autoridade sobre permissões. O modelo não recebe as chaves do servidor e não executa contatos, compras ou publicações externas.

## Configuração e verificações

GET /api/config retorna a URL Supabase, chave publishable e chave pública do Turnstile, não as chaves de provedor usadas no servidor. A rota server-side não valida token de CAPTCHA: TURNSTILE_SITE_KEY aparece na resposta de configuração, mas não há verificação correspondente nos handlers analisados. GET /api/health só informa presença de variáveis; não prova que Auth, banco ou provedores respondem.

[supabase/tests/security.sql](../supabase/tests/security.sql) contém verificações de RLS, acesso entre proprietários, cotas, RPCs e cancelamento. O SQL foi lido; não há registro de execução remota nesta data. [docs/verification-db.md](../docs/verification-db.md) relata uma execução remota em 3 de outubro de 2026; esse resultado é histórico e não confirma o estado atual do banco. A configuração dos arquivos de ambiente não é evidência dos valores efetivamente implantados.

Veja também: [índice](index.md) · [visão geral](overview.md) · [backend](backend.md) · [IA](ai.md) · [pesquisa](research.md) · [persistência](persistence.md) · [operações](operations.md) · [testes](testing.md) · [riscos](risks.md) · [manutenção](maintenance.md).
