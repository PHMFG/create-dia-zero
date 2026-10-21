---
title: Persistência, versões, cotas e cancelamento
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../server/store.ts
  - ../server/app.ts
  - ../supabase/schema.sql
  - ../supabase/cancellation.sql
  - ../supabase/tests/security.sql
  - ../shared/domain.ts
  - ../shared/types.ts
  - ../src/lib/api.ts
---

# Persistência, versões, cotas e cancelamento

O armazenamento tem dois modos no código. Com SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY, [server/store.ts](../server/store.ts) usa Supabase com o JWT da sessão. Sem os dois valores, o modo local mantém projetos e ledger de runs em mapas de memória do processo. Se o processo estiver em Vercel e Supabase não estiver configurado, a sessão retorna 503; não há persistência local nesse caso. O campo storage em health indica qual ramo de configuração será usado, não testa o banco.

## Documento e concorrência

O registro persistente está em public.create_projects. A linha guarda owner_id, documento JSONB, versão inteira e data de atualização. Restrições SQL alinham o ID e a versão da linha com o documento e limitam o documento a 3 MB. A API limita corpos comuns a 1,5 MB e operações de importação/canvas a 3 MB.

O documento é um Project inteiro: contexto, cartões, mensagens, fontes, evidências, propostas e revisões. A estrutura está em [shared/types.ts](../shared/types.ts). Lista e criação limitam a três projetos por pessoa; além da checagem na aplicação, um trigger PostgreSQL serializa inserções e impõe o teto no banco.

Edições do canvas enviam o Project completo com a versão vista pelo navegador. [store.save](../server/store.ts#L54) atualiza por ID, proprietário e versão esperada; se outra gravação venceu, retorna conflito 409 para a API. A geração relê o projeto antes de cada gravação incremental e tenta novamente até três vezes em conflitos transitórios. Os detalhes do contrato HTTP estão em [backend.md](backend.md).

## Reserva de mensagens e pesquisa

O ledger privado mantém runId, projeto, estado, uso agregado, reservas de pesquisa e bloqueios por projeto. O PostgreSQL usa um advisory lock curto para serializar reservas e verifica autoria antes de gravar. Um runId é idempotente; um projeto aceita uma geração ativa por vez. Bloqueios duram 120 segundos e execuções expiradas são marcadas quando uma nova reserva limpa bloqueios vencidos.

| Recurso | Limite no código | Efeito |
|---|---|---|
| Projetos | 3 por pessoa | Nova criação retorna 429 ao atingir o teto. |
| Mensagens | 30 por pessoa/dia e 200 global/dia, no fuso America/Sao_Paulo | A reserva negada retorna 429 antes de iniciar geração. |
| Runs simultâneos | 1 por projeto | Uma tentativa concorrente recebe 409 RUN_BUSY; a interface tenta novamente por até cinco segundos. |
| Pesquisa | 1 reserva por run, 5 por pessoa/dia, 25 global/dia e até 750 créditos reservados/mês | Cada reserva separa três créditos. A reserva não é devolvida em caso de falha ou timeout. |
| Cancelamento antes da reserva | 30 por pessoa/dia e 200 global/dia | Tombstones vencem após 30 dias e impedem que um pedido cancelado inicie atrasado. |

O contador de pesquisa registra a reserva de três créditos, não a fatura real. A aplicação HTTP não fornece callback para salvar IDs e créditos exatos retornados por Tavily; veja [research.md](research.md). O ledger de runs também guarda uso agregado do modelo quando a resposta termina.

## Cancelamento durável

Cancelar a conexão HTTP não é suficiente quando há um proxy entre o navegador e a função. [src/lib/api.ts](../src/lib/api.ts#L48) cria o runId antes de autenticar e envia um POST autenticado para a rota de cancelamento quando o sinal é abortado; a solicitação usa keepalive e timeout de seis segundos. [server/app.ts](../server/app.ts#L32) confirma primeiro que o projeto pertence à sessão.

O banco registra o pedido em private.create_run_cancellations. Uma RPC serializa reserva e cancelamento com o mesmo advisory lock. Se o cancelamento chegar antes da reserva, o tombstone impede o run sem criar linha de execução, reservar quota ou tomar bloqueio. Se a geração já estiver ativa, a marca não libera o bloqueio; o servidor consulta a marca a cada 500 ms, aborta o provedor e só libera a execução no encerramento. Isso evita que outra mensagem comece enquanto a anterior ainda pode gravar.

As mudanças já salvas no canvas e a mensagem do usuário continuam persistidas quando a geração é interrompida. A resposta do assistente depende da conclusão. O fluxo da API tem deadline de 90 segundos; o bloqueio de 120 segundos permite encerrar a execução e também recuperar de uma função que tenha desaparecido.

## Evidência e alcance das verificações

O arquivo [supabase/tests/security.sql](../supabase/tests/security.sql) contém assertions transacionais para isolamento por usuário, cotas, idempotência e cancelamento antes/durante a execução, com rollback dos fixtures. O SQL foi lido; não há registro de execução remota nesta data. [docs/verification-db.md](../docs/verification-db.md) registra uma verificação remota em 3 de outubro de 2026; esse resultado é histórico e não comprova o estado atual do projeto Supabase.

Veja também: [índice](index.md) · [visão geral](overview.md) · [backend](backend.md) · [IA](ai.md) · [pesquisa](research.md) · [segurança](security.md) · [operações](operations.md) · [testes](testing.md) · [manutenção](maintenance.md) · [riscos](risks.md).
