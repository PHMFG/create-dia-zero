# Arquitetura do MVP

## Produto e marca

Nome público: **create**, em minúsculas. Propósito: transformar uma ideia em algo que pode ser testado. Abertura com gradiente violeta/magenta, tipografia Inter Tight leve e campo branco amplo. O espaço de trabalho usa branco e lavanda para manter leitura e foco. Animações curtas de entrada, modais e estados de atividade respeitam `prefers-reduced-motion`. A área principal contém conversa e canvas/lista, com navegação recolhível, controles flutuantes e mini chat por cartão. O celular oferece abas Conversa e Plano.

O ciclo é entrevista → plano → ação fora do aplicativo → relato/evidência → proposta de revisão. A IA não executa contatos, compras ou publicações. O exemplo Chabor não apresenta simulações como resultados reais.

## Caminho de uma mensagem

1. O navegador autentica uma identidade anônima no Supabase e envia o JWT à API.
2. O servidor verifica o usuário, carrega o projeto com RLS e reserva a execução numa transação. Idempotência impede repetir o mesmo runId; uma trava impede duas gerações simultâneas por projeto.
3. Jev (`jev-1.13.0`) classifica uma rota entre opções fechadas e a próxima lacuna. Probabilidades baixas não viram certezas; regras conservadoras permitem seguir se o Jev falhar.
4. DeepSeek Flash pelo adaptador OpenAI compatible do OpenCode Go recebe instruções versionadas e um pacote organizado de contexto. Responde, entrevista ou usa ferramentas conforme a situação.
5. Ferramentas permitidas: pesquisa Tavily, cálculo determinístico sem eval e leitura de cartão/evidência/fonte original do próprio projeto. Nenhuma ferramenta executa código ou faz uma ação externa em nome da pessoa.
6. A saída JSON é validada por Zod; fontes só vêm da pesquisa realizada, IDs e revisões são conferidos e atualizações estratégicas/humanas produzem propostas.
7. O servidor relê o projeto para respeitar edições feitas durante a geração, salva com controle de versão e então entrega a conclusão via SSE. A interface mostra estados reais de atividade enquanto aguarda o objeto validado; texto não é exibido token a token antes da validação.

## Ambiente de organização da IA

`server/prompts.ts` separa identidade, entrevista, pesquisa, organização e revisão. O pacote inclui fatos explícitos, mensagem atual, ação vigente, cartões editados pela pessoa, dependências, evidências recentes, fontes, últimas mensagens, propostas e decisões. Há limite de 60 mil caracteres e indicação explícita de omissões. `read_project_item` recupera o registro original quando o resumo não basta.

Conteúdo do usuário e páginas consultadas são dados, sem autoridade para mudar regras ou permissões. O modelo não recebe credenciais. Contexto não é preenchido com cidade, orçamento ou disponibilidade inventados. Não saber algo é uma lacuna a investigar. Entrevistas perguntam por comportamento passado; um relato isolado não prova demanda.

## Estado persistido

`Project` guarda contexto, cartões, blocos, checklists, posições, mensagens, fontes, evidências, propostas e histórico. Cartões têm ID estável, revisão, origem e dependências. Há quatro prioridades: agora, próximo, depois, concluído. O domínio elimina referências inválidas/ciclos e mantém apenas uma ação principal em agora.

Blocos são heading, paragraph, list, checklist, callout ou sources. O editor trabalha diretamente nesse formato. Checklists marcadas e texto humano são protegidos; mover um cartão preserva sua posição. A IA não aplica exclusões automaticamente. Aceitar uma proposta exige que as revisões ainda coincidam com o conteúdo mostrado na proposta.

Uma tabela pública `create_projects` guarda o documento e a versão para atualização condicional. Tabelas privadas registram cotas, uso por execução e travas. Funções públicas estreitas chamam helpers privados que verificam identidade e autoria. As tabelas internas não têm acesso direto por visitantes.

## Implementação e operação

- `src/`: React/Vite, canvas React Flow, editor, conversa e fluxo de evidência/revisão.
- `shared/`: tipos, validação Zod e domínio executado no servidor; exportação e organização usadas também pela UI.
- `server/`: Hono, armazenamento autenticado, Jev, DeepSeek, prompts e Tavily.
- `api/index.mjs`: entrada da função Vercel. `scripts/build-api.mjs` empacota `server/vercel.ts` em `.server/api.mjs`; `server/dev.ts` usa a mesma API no desenvolvimento.
- `supabase/`: esquema versionado no repositório e teste SQL transacional de segurança.

O MVP usa infraestrutura gratuita disponível das contas. Tokens do modelo e pesquisa obedecem aos planos dos provedores. Não há cobrança ao usuário, pagamentos ou planos comerciais implementados. Captcha não está configurado nesta implantação; cotas globais e limites de autenticação do Supabase reduzem o uso disponível, mas novos visitantes ainda podem consumir o limite compartilhado.

Pesquisa geral depende de Tavily e pode ficar indisponível por chave ausente, limite, timeout ou falta de resultados. A interface mostra fontes reais quando existem; ausência de pesquisa é comunicada pela resposta. Fontes importadas são tratadas como não verificadas. Recuperação entre dispositivos exige exportar/importar JSON nesta versão sem cadastro.
