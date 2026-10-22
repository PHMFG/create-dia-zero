---
title: Operação local e build
kind: topic
updated: 2026-10-21
status: code-verified
sources:
  - ../package.json
  - ../package-lock.json
  - ../server/dev.ts
  - ../server/app.ts
  - ../server/store.ts
  - ../server/ai.ts
  - ../server/research.ts
  - ../scripts/build-api.mjs
  - ../scripts/smoke-api.ts
  - ../scripts/smoke-demo.ts
  - ../vite.config.ts
  - ../vercel.json
  - ../.gitignore
  - ../.vercelignore
  - ../.env.example
  - ../README.md
  - ../README.pt-BR.md
  - ../docs/verification.md
  - ../docs/verification-db.md
---

# Operação local e build

O projeto declara Node.js `24.x` em [package.json](../package.json), e o bundle da API tem alvo `node24` em [scripts/build-api.mjs](../scripts/build-api.mjs). O lockfile registra a mesma restrição para a raiz do pacote. Use `npm ci` para instalar a árvore registrada em [package-lock.json](../package-lock.json).

## Comandos disponíveis

| Comando | Efeito |
|---|---|
| `npm ci` | Instala dependências a partir do lockfile. |
| `npm run dev` | Inicia o servidor Hono junto do middleware Vite em `127.0.0.1:5173`. Carrega `.env.local`; API e interface rodam no mesmo processo. |
| `npm run dev:watch` | Reinicia automaticamente o processo de desenvolvimento quando arquivos mudam. |
| `npm run preview` | Serve a saída estática do Vite em `127.0.0.1`; não inicia o handler Hono local. |
| `npm test` | Executa `vitest run`. |
| `npm run typecheck` | Executa `tsc --noEmit`. |
| `npm run build` | Executa typecheck, build de produção do Vite e bundle da API. |
| `npx tsx scripts/smoke-api.ts <URL>` | Exercita uma instância escolhida com sessões temporárias, geração real e pesquisa se configurada. |
| `npx tsx scripts/smoke-demo.ts <URL>` | Confere a página e a criação persistida do exemplo numa instância escolhida. |

Para o produto completo, use `npm run dev`; o preview só valida os arquivos estáticos. Sem Supabase, o armazenamento local fica em memória e se perde quando o processo reinicia. Em Vercel, o código retorna indisponibilidade se Supabase não estiver configurado, em vez de usar essa memória local. O servidor local lê `.env.local`; esse arquivo deve ficar privado e não foi lido nesta auditoria.

## Variáveis por necessidade

`.env.example` lista nomes e padrões públicos de configuração, com campos de segredo vazios. A tabela abaixo cruza esses nomes com as leituras do código; nenhum valor privado de ambiente foi consultado.

| Variável | Necessidade e uso |
|---|---|
| `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` | Devem ser fornecidas juntas para persistência Supabase. São dispensáveis em dev local, quando o projeto usa memória; no ambiente Vercel são necessárias para a API operar. A chave publishable é enviada ao navegador pelo endpoint de configuração. |
| `OPENCODE_GO_API_KEY` | Necessária para geração com o provedor configurado. Sem ela, a conversa usa orientação básica e não afirma que houve inferência. |
| `OPENCODE_MODEL` / `OPENCODE_GO_MODEL` | Opcionais; escolhem o nome do modelo. O padrão no código é `deepseek-flash`. `OPENCODE_MODEL` tem precedência. |
| `OPENCODE_BASE_URL` / `OPENCODE_GO_BASE_URL` | Opcionais; escolhem o endpoint compatível. O padrão é o endpoint OpenCode Zen Go. `OPENCODE_BASE_URL` tem precedência. |
| `TYPESAFE_API_KEY` | Opcional para usar Jev no roteamento. Sem a chave, o servidor usa regras de fallback. |
| `TYPESAFE_MODEL` | Opcional; seleciona o modelo Jev. O padrão no código é `jev-1.13.0`. |
| `TAVILY_API_KEY` | Opcional para pesquisa web. Sem a chave, a pesquisa informa indisponibilidade e não cria fontes. |
| `TURNSTILE_SITE_KEY` | Opcional; é retornada como configuração pública. A API analisada não verifica um token Turnstile. |
| `PORT` | Opcional para `npm run dev`; o padrão é `5173`. O servidor continua vinculado a `127.0.0.1`. |

O template não lista `OPENCODE_GO_MODEL`, `OPENCODE_GO_BASE_URL`, `TURNSTILE_SITE_KEY` nem `PORT`, embora o código reconheça esses nomes. `VERCEL` é lido pelo servidor para impedir armazenamento em memória quando o banco está ausente; não é uma chave a preencher no template. Indicadores de `/api/health` mostram presença de configuração, não conectividade ou crédito. Os fluxos de provedores estão em [ai.md](ai.md) e [research.md](research.md).

## Build e configuração Vercel

`npm run build` chama TypeScript, Vite e [scripts/build-api.mjs](../scripts/build-api.mjs). O frontend vai para `dist`; o esbuild gera `.server/api.mjs` como ESM para Node 24. [vercel.json](../vercel.json) declara `npm run build`, `dist`, região `gru1`, a função `api/index.mjs` com duração máxima de 120 segundos, reescritas para a API e para a SPA, e cabeçalhos básicos. Isso documenta a configuração versionada, sem confirmar uma publicação ou URL ativa.

`.gitignore` e `.vercelignore` excluem dependências, `dist`, `.server`, `.vercel`, arquivos `.env*` e artefatos/relatórios de teste; `.env.example` é a exceção explícita para arquivos de ambiente. `.vercelignore` também exclui `.git`. As pastas de smoke e relatórios não são dados persistentes do produto.

## Smoke e operações SQL

Os scripts smoke exigem URL como argumento; não são chamados por `npm test` ou pelo build. `smoke-api.ts` cria duas sessões anônimas e projetos temporários, faz chamadas reais à API, pode consumir geração e pesquisa configuradas e exporta JSONs de diagnóstico para `artifacts/`. No bloco `finally`, tenta apagar os projetos e encerra as sessões. `smoke-demo.ts` cria uma sessão e um projeto demonstrativo temporário, confere que foi persistido e tenta apagá-lo. Falha de rede ou de limpeza pode deixar dados de teste no ambiente selecionado. A escolha da URL é, portanto, uma ação explícita.

`supabase/schema.sql` e `supabase/cancellation.sql` são mudanças de banco: abrem transação, criam/alteram tabelas, índices, políticas, funções e grants, e terminam em `commit`. O segundo arquivo deve vir depois do schema. `supabase/tests/security.sql` pressupõe ambos instalados e uma conexão com privilégios de banco; cria dois usuários e fixtures, alterna papéis e claims para testar RLS, limites e cancelamento, e termina com `rollback`. Esses arquivos foram lidos, mas nenhum foi aplicado ou executado nesta tarefa. Veja [persistence.md](persistence.md) e [security.md](security.md) antes de qualquer operação de banco.

Desde 21 de outubro de 2026, o [README](../README.md) em inglês e o [README.pt-BR.md](../README.pt-BR.md) apresentam o projeto, a instalação sem chaves e as variáveis opcionais; não registram URL pública, IDs nem estado da implantação. Nessa data, os comandos de instalação, teste, typecheck, build e `npm run dev` do README passaram num clone limpo com apenas `.env.example` copiado (Node `25.9.0`, npm `11.12.1`), e a URL pública registrada em [docs/verification.md](../docs/verification.md) respondeu 503 com a implantação pausada. Os resultados históricos desse relatório e de [docs/verification-db.md](../docs/verification-db.md) não confirmam a disponibilidade atual.

## Resultado local observado em 2026-10-07

Na sessão raiz, `npm test`, `npm run typecheck` e `npm run build` passaram sob Node `25.9.0` e npm `11.12.1`. Esse Node é diferente do requisito declarado `24.x`; o alvo do bundle continua `node24`. Não houve verificação de URL pública, banco remoto ou provedores nesta tarefa.

Veja também: [índice](index.md) · [visão geral](overview.md) · [arquitetura](architecture.md) · [backend](backend.md) · [persistência](persistence.md) · [segurança](security.md) · [testes](testing.md) · [riscos](risks.md) · [manutenção](maintenance.md).
