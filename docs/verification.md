# Histórico de verificações · 3 de outubro de 2026

Aplicativo público: https://create-dia-zero.vercel.app

Publicação Vercel: `dpl_HLvpMSnYepZNyNjYd33nY5b1wSgE`, estado READY; API na região `gru1`.

## Código e dados

- 153 testes automatizados aprovados em nove arquivos; TypeScript e build de produção aprovados, incluindo o bundle Node.js da API.
- Três subagentes Luna revisaram interface, integração de dados e API. Corrigidos preservação de perguntas antes da aceitação, recuperação do autosave, merge por IDs de blocos/itens e resposta 429 ao limite transacional de projetos.
- Regressões de IA verificam conexões estruturais atômicas, preservação de contexto humano entre deltas, estados de ferramentas, síntese de pesquisa e heartbeat SSE. O consumidor de SSE cobre UTF-8 fragmentado, CRLF, comentários, cancelamento, erro de rede e ausência de conclusão.
- Políticas de acesso e reservas executadas anteriormente no banco Supabase com transação desfeita; detalhes em `verification-db.md`. Produção novamente verificada com duas sessões de visitante independentes.
- Busca pelos valores exatos das três credenciais privadas configuradas em 64 arquivos de fontes/bundle: nenhum vazamento encontrado. Ambientes, artefatos e diretórios gerados permanecem ignorados.

## Fluxo real em produção

`npx tsx scripts/smoke-api.ts https://create-dia-zero.vercel.app` concluiu em modo `live`, com seis cartões, oito fontes e uma proposta. Dados fictícios; os projetos do smoke são apagados ao terminar.

Os treze critérios passaram:

1. Health público e provedores configurados.
2. API privada rejeita acesso sem autenticação.
3. Outra sessão não acessa o projeto pela API nem pelo RLS.
4. A IA cria cartões a partir da ideia.
5. Deltas chegam por SSE e estão persistidos antes da resposta final.
6. Cartões aparecem individualmente, com atividades identificadas e grafo válido.
7. Edições de texto/checklist persistem; versões antigas são rejeitadas.
8. Experiência é registrada separadamente da hipótese.
9. DeepSeek/Jev respondem por SSE preservando edições humanas.
10. Mini chat mantém o contexto do cartão.
11. A resposta está salva antes do evento de conclusão.
12. Pesquisa real publica links, imagens retornadas e a região informada.
13. Importação JSON cria um projeto independente.

Os três primeiros cartões da IA foram publicados em aproximadamente 11,5–11,9 segundos. Na pesquisa, as fontes apareceram em 7 segundos, foram enriquecidas em 10 segundos e a síntese chegou à mesma nota em 28 segundos. A nota terminou com status `ready`, resumo interpretativo e parágrafos vinculados às fontes. Tavily está ativo em produção, com chave apenas no servidor.

## Interface e fila

No navegador, duas perguntas enviadas durante a mesma execução foram respondidas automaticamente na ordem correta, localmente e na versão pública, sem erro de stream. A fila exibe destino e perguntas pendentes, permite remoção e pausa ao interromper. Pendências são guardadas no sessionStorage e reaparecem pausadas após recarregar; não é uma fila compartilhada entre dispositivos.

Conferidos em desktop e celular: fontes ampliadas, cabeçalho compacto, barra recolhível, controles flutuantes, canvas/lista no celular, mídias e localização, mini chat por cartão e Sobre com Visualizar/Editar. Uma edição por bloco e uma checklist permaneceram após recarregar. Enviar com um título vazio preservou a pergunta; corrigir o título eliminou o alerta antigo após salvar.

O servidor local deixou de reiniciar automaticamente durante alterações de backend; `dev:watch` é opcional. Comentários SSE periódicos mantêm a conexão durante chamadas demoradas. A captura `artifacts/public-prompt-queue.png` registra a fila no aplicativo público.

## Escopo da avaliação

Os 30 cenários de `tests/ai-evaluation.json` continuam sendo um roteiro, não 30 execuções reais do modelo. Ajustes secundários foram adiados a pedido do usuário; a publicação priorizou falhas emergenciais e a fila de perguntas.

## Novo exemplo e auditoria após a primeira publicação

O exemplo foi ampliado e publicado primeiro em `dpl_FvFZQb659m6kNJuyr4fLUGeLJkkS`, READY. A verificação real `scripts/smoke-demo.ts` confirmou página pública HTTP 200, dez cartões nos sete tipos, onze conexões válidas, uma única ação atual, uma evidência demonstrativa e uma referência manual não verificada. A cópia completa estava persistida antes da resposta da API. Relatos e valores são fictícios; a região não usa coordenadas inventadas.

Depois dessa publicação, três novos subagentes Luna auditaram fila/interface, API/streaming e domínio/preservação de dados. Correções verificadas:

- Cancelar durante o autosave impede iniciar a inferência quando o salvamento termina; callbacks de componentes desmontados também não iniciam novas conversas.
- Cancelar durante a reserva ou o salvamento inicial da API encerra a execução como interrompida, sem iniciar o modelo. O sinal HTTP é observado antes do SSE e o encerramento é único, evitando deixar a fila presa à execução anterior.
- Anotações novas são posicionadas em espaço livre sem deslocar cartões existentes, com limite visível de cem cartões.
- Itens de checklist editados pelo usuário conservam o estado concluído mesmo quando somente seu texto mudou desde a origem da resposta.
- Remover um cartão transfere sua conversa preservada para o chat principal. Importar repara esses vínculos, remove referências inválidas de fontes nas mensagens e rejeita IDs de mensagens duplicados.
- Conexões têm limite explícito de cinquenta; a interface também limita sessenta blocos por cartão e oitenta itens por lista, evitando quebrar o autosave.
- Requisições sem Content-Length respeitam o limite real do corpo. Importação e canvas aceitam até 3 MB, compatíveis com a interface; demais operações aceitam até 1,5 MB.
- Falhas inesperadas do banco retornam indisponibilidade, sem serem confundidas com limite de uso ou outra execução ativa. As consultas de projetos filtram o proprietário autenticado, além do RLS.
- A abertura de projetos ignora respostas antigas de outra seleção e conserva o parâmetro do projeto durante a retomada inicial.

A suíte completa passou em **170 testes de onze arquivos**, com TypeScript e build de produção aprovados. Em uma sessão local de QA separada, foram conferidos novo exemplo, edição pelo lápis no modo de leitura, persistência de texto/conexão após reload e onze cartões sem sobreposição medida no DOM. Perguntas normais foram respondidas na ordem da fila; interrupção, recuperação pausada após reload, remoção de uma pendência e retomada concluída foram verificadas no navegador. A execução interrompida constou como `cancelled` no banco em 2,6 segundos desde a reserva; a próxima pergunta iniciou e concluiu sem esperar a expiração de 120 segundos. Projetos preexistentes conservam suas edições e não são substituídos pelo novo exemplo.

## Interrupção atrás do proxy do Vercel

A publicação intermediária `dpl_5rHNwR5eHFHf43rnjo7dRrXer1YT` ficou READY. O exemplo público passou novamente, e IA, pesquisa, fontes e preservação de edições passaram. Porém, um novo caso real mostrou que abortar apenas a conexão HTTP pode deixar a função executando atrás do proxy; a pergunta seguinte permaneceu bloqueada por mais de dez segundos. Esse teste falhou e motivou a correção adicional.

O cliente agora envia um pedido explícito de interrupção autenticado, com o mesmo ID da execução. O servidor consulta o sinal durável e interrompe o modelo; só libera a execução depois de aguardar gravações já iniciadas. Interrupções anteriores à reserva impedem que a mensagem atrasada inicie a IA. O cliente aguarda confirmação, mostra o encerramento em andamento, tenta novamente apenas conflitos `RUN_BUSY` por um período limitado e preserva perguntas ainda não aceitas. Fechar a página também dispara um pedido com `keepalive` e os headers da sessão já resolvidos.

`supabase/cancellation.sql` foi aplicado como `durable_run_cancellation`; as funções privilegiadas permanecem no schema privado, os wrappers públicos usam SECURITY INVOKER e não há acesso direto às tabelas internas. `supabase/tests/security.sql` passou no banco real, com todas as alterações de teste revertidas ao terminar: isolamento de visitantes, cancelamento antes da reserva, limite de pedidos, retenção do bloqueio até finalizar e aceitação da próxima execução. O cancelamento de uma execução ativa continua permitido mesmo após atingir o limite de pedidos antecipados.

Após a correção, **178 testes em doze arquivos**, TypeScript e build de produção passaram. Arraste pelo cabeçalho e movimento pelo teclado foram conferidos no navegador; a posição ficou salva após recarregar.

A publicação `dpl_2vq2RuGsZf45fbnSh3AqfNHFHpRr`, READY, passou nos **quinze critérios reais de `scripts/smoke-api.ts`**: os treze critérios anteriores, interrupção explícita autenticada com a próxima pergunta concluída e cancelamento anterior à reserva impedindo execução tardia. IA em modo `live`, seis cartões, oito fontes e uma proposta. O novo exemplo também passou novamente na URL pública, com HTTP 200 e dez cartões. Os projetos temporários do smoke foram removidos ao terminar.

O botão Retomar aguarda o pedido de interrupção terminar; essa pequena proteção de interface evita tentar retomar a fila enquanto o próprio cliente ainda está encerrando a resposta anterior. Os mesmos 178 testes e o build passaram após esse ajuste.
