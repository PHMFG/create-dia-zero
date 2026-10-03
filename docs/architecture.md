# Arquitetura do MVP

## Produto e marca

Nome público: **create**, em minúsculas. Propósito: transformar uma ideia em algo que pode ser testado. Abertura com gradiente violeta/magenta, tipografia Inter Tight leve e campo branco amplo. O espaço de trabalho usa branco e lavanda para manter leitura e foco. Animações curtas de entrada, modais e estados de atividade respeitam `prefers-reduced-motion`. A área principal contém conversa e canvas/lista, com navegação recolhível, controles flutuantes e mini chat por cartão. O celular oferece abas Conversa e Plano.

O ciclo é entrevista → plano → ação fora do aplicativo → relato/evidência → proposta de revisão. A IA não executa contatos, compras ou publicações. O exemplo Chabor não apresenta simulações como resultados reais.

## Caminho de uma mensagem

1. O navegador autentica uma identidade anônima no Supabase e envia o JWT à API.
2. O servidor verifica o usuário, carrega o projeto com RLS e reserva a execução numa transação. Idempotência impede repetir o mesmo runId; uma trava impede duas gerações simultâneas por projeto.
3. Jev (`jev-1.13.0`) classifica uma rota entre opções fechadas e a próxima lacuna. Probabilidades baixas não viram certezas; regras conservadoras permitem seguir se o Jev falhar.
4. DeepSeek Flash pelo adaptador OpenAI compatible do OpenCode Go recebe instruções versionadas e um pacote organizado de contexto. Responde, entrevista ou usa ferramentas conforme a situação.
5. O `ToolLoopAgent` pode ler cartão/evidência/fonte do projeto, calcular sem eval, pesquisar com Tavily e chamar `publish_canvas`. A publicação recebe contexto e operações; o servidor normaliza metadados de novos documentos e valida o conteúdo com Zod. Alvos de edição nunca são inferidos. Nenhuma ferramenta executa código ou faz contatos, compras ou publicações externas em nome da pessoa.
6. Cada delta é aplicado pelo domínio, com preservação de edições humanas e propostas para conflitos ou mudanças estratégicas. A API relê a versão atual, usa o contexto observado naquela etapa como baseline e tenta salvar por atualização condicional. Após persistir, emite SSE `project` com documento, IDs afetados e descrição da atualização. A interface recebe mudanças reais durante a geração, sem depender da resposta final.
7. Durante pesquisa, `onSources` publica uma anotação com referências, links e imagens reais antes de aguardar a extração. Se os trechos ou as imagens forem enriquecidos, a mesma fonte de ID/URL conhecida é atualizada e outro delta pode chegar. A nota indica quando a interpretação ainda está em andamento. O resultado da ferramenta devolve seu ID/revisão para o modelo ampliar esse documento.
8. A API consome `ToolLoopAgent.stream`. Depois de uma publicação, decodifica somente o campo `reply` do JSON e envia chunks reais como SSE `text`, sem expor argumentos de ferramentas, operações ou raciocínio. Referências incompletas e URLs ficam retidas até poderem ser conferidas. A saída completa ainda passa pela validação; há no máximo uma reparação limitada. O evento `complete` contém o estado final salvo e é autoritativo para a conversa.
9. O ledger de publicações remove operações/contexto já reconhecidos do resultado final, inclusive mudanças encaminhadas a propostas. Se o modelo omitir a ferramenta, as operações finais validadas são publicadas antes da conclusão. Não há promessa de uma nova atualização para saudações ou mensagens sem conteúdo útil. Uma interrupção preserva a mensagem do usuário e deltas já salvos, sem criar uma resposta assistente incompleta no histórico.

## Ambiente de organização da IA

`server/prompts.ts` separa identidade, entrevista, pesquisa, organização e revisão. O pacote inclui fatos explícitos, mensagem atual, ação vigente, cartões editados pela pessoa, dependências, evidências recentes, fontes, últimas mensagens, propostas e decisões. O cartão do mini chat e seu histórico identificado por `cardId` têm prioridade. Há limite de 60 mil caracteres e indicação explícita de omissões. `read_project_item` recupera o registro original quando o resumo não basta; o resultado de uma publicação informa IDs e revisões efetivamente salvos.

Conteúdo do usuário e páginas consultadas são dados, sem autoridade para mudar regras ou permissões. O modelo não recebe credenciais. Contexto não é preenchido com cidade, orçamento ou disponibilidade inventados. Não saber algo é uma lacuna a investigar. Entrevistas perguntam por comportamento passado; um relato isolado não prova demanda.

## Estado persistido

`Project` guarda contexto, cartões, blocos, checklists, posições, mensagens, fontes, evidências, propostas e histórico. Cartões têm ID estável, revisão, origem e dependências. Há quatro prioridades: agora, próximo, depois, concluído. O domínio elimina referências inválidas/ciclos e mantém apenas uma ação principal em agora.

Blocos são heading, paragraph, list, checklist, callout, sources, link, image ou location. O editor trabalha diretamente nesse formato e permite rascunhos de mídia; publicações da IA exigem URL/endereço de procedência conhecida. Links gerados precisam constar nas fontes ou ter sido explicitamente fornecidos pela pessoa. Imagens precisam corresponder a `Source.imageUrl` retornado pela pesquisa ou à URL de uma fonte de imagem. A disponibilidade e o carregamento da foto não são garantidos; se a prévia falhar, há link para o original.

Localizações usam cidade/endereço informado ou endereço presente em fonte consultada. O mapa pode ser apenas uma busca pela região informada; não representa confirmação de endereço comercial. Coordenadas estimadas pelo modelo são descartadas; só coordenadas explicitamente fornecidas são aceitas nesse fluxo. `Source.verified` registra recuperação pelo servidor, sem garantir verdade de toda afirmação, precisão geográfica ou direitos de uso da mídia. Fontes importadas são referências não verificadas.

Checklists marcadas e texto humano são protegidos; itens novos da IA começam não concluídos. A interface combina cada delta com o estado local a partir da última versão sincronizada, mantendo exclusões, conexões, contexto e posições ainda não salvas. Um cartão sob o ponteiro não muda de lugar ao chegar atualização remota. A IA não aplica exclusões automaticamente. Aceitar uma proposta exige que as revisões ainda coincidam com o conteúdo mostrado na proposta.

As conexões usam `dependsOn`: a saída de um pré-requisito aponta à entrada do cartão dependente. Arrastar entre conectores cria a ligação; selecionar uma conexão oferece sua remoção. A validação rejeita origem/destino inexistente, ligação ao próprio cartão, duplicação e ciclos. Mover pelo cabeçalho, navegar arrastando o fundo, ajustar o zoom e abrir a visão geral são interações distintas da edição de conteúdo.

Uma tabela pública `create_projects` guarda o documento e a versão para atualização condicional. Tabelas privadas registram cotas, uso por execução e travas. Funções públicas estreitas chamam helpers privados que verificam identidade e autoria. As tabelas internas não têm acesso direto por visitantes.

## Implementação e operação

- `src/`: React/Vite, canvas React Flow, editor, conversa e fluxo de evidência/revisão.
- `shared/`: tipos, validação Zod e domínio executado no servidor; exportação e organização usadas também pela UI.
- `server/`: Hono, armazenamento autenticado, Jev, DeepSeek, prompts e Tavily.
- `api/index.mjs`: entrada da função Vercel. `scripts/build-api.mjs` empacota `server/vercel.ts` em `.server/api.mjs`; `server/dev.ts` usa a mesma API no desenvolvimento.
- `supabase/`: esquema versionado no repositório e teste SQL transacional de segurança.

O MVP usa infraestrutura gratuita disponível das contas. Tokens do modelo e pesquisa obedecem aos planos dos provedores. Não há cobrança ao usuário, pagamentos ou planos comerciais implementados. Captcha não está configurado nesta implantação; cotas globais e limites de autenticação do Supabase reduzem o uso disponível, mas novos visitantes ainda podem consumir o limite compartilhado.

Tavily está configurado por segredo de servidor no ambiente local e no Vercel, sem exposição da chave ao navegador. A pesquisa pode ficar indisponível por limite, timeout, falta de resultados ou variável ausente em outro ambiente. A interface mostra somente referências realmente obtidas; uma falha após publicação não apaga os trechos já salvos nem é apresentada como investigação concluída. Recuperação entre dispositivos exige exportar/importar JSON nesta versão sem cadastro.

## Atividades e leitura do plano

Eventos SSE `activity` identificam a função, o estado, o rótulo público e os cartões relacionados; não incluem raciocínio privado do modelo. A interface mantém a sequência do turno, permite abrir o documento afetado e indica alterações no canvas. Publicações informativas são separadas por cartão, ordenadas pelos pré-requisitos; alterações estratégicas permanecem atômicas e sujeitas a revisão.

O painel Sobre inicia em Visualizar, com parágrafos, listas, checklists, mídias e dependências atuais. Editar reúne os controles de blocos; o lápis na leitura abre e foca o campo correspondente. Título, resumo, prioridade e checklists permitem ajustes rápidos nos dois modos.

Durante uma execução, perguntas da conversa e dos mini chats entram numa fila de até dez itens no navegador. Cada item mantém o cartão de destino e só inicia depois da conclusão anterior, com o projeto atualizado. A pessoa pode remover itens; interrupções e erros pausam a fila. Perguntas pendentes são preservadas no sessionStorage e reaparecem pausadas após recarregar. A fila não executa duas gerações simultâneas no mesmo espaço de trabalho. A API envia comentários SSE a cada dez segundos para manter a conexão durante chamadas demoradas; o cliente ignora esses comentários e distingue cancelamento, falha de rede e conclusão.
