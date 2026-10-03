# create · da ideia à primeira evidência

Copiloto para quem está começando um negócio. A conversa organiza contexto e hipóteses num canvas editável, destaca uma ação e revisa o plano quando a pessoa retorna com uma experiência real.

Aplicativo público: **[create-dia-zero.vercel.app](https://create-dia-zero.vercel.app)**.

## Usar o aplicativo

1. Conte sua ideia na tela inicial ou explore o exemplo Chabor, identificado como demonstração.
2. Converse com a create: a entrevista considera público, recursos, restrições e lacunas, com uma pergunta principal por vez. Cartões e fontes podem aparecer enquanto a IA trabalha, antes da resposta final. Use **Esclarecer** para conversar sobre um cartão específico.
3. Abra **Sobre** para ler o cartão em **Visualizar**. Use **Editar** ou o lápis de um bloco para corrigir o conteúdo; checklists, título e resumo permitem ajustes na leitura. No celular, alterne entre lista e canvas.
4. Ligue a saída inferior de um cartão à entrada de outro para indicar dependência. Clique na conexão para removê-la; o app impede ciclos e ligações duplicadas. Arraste o fundo para navegar e use o zoom ou a visão geral para se orientar.
5. Use **Pesquisar** para consultar referências na web. As anotações podem incluir fontes, links, imagens retornadas pela pesquisa e localização informada. Imagens dependem do que o serviço encontra; um mapa da cidade não confirma o endereço de uma instituição.
6. Faça o teste fora do aplicativo e use **Registrar experiência** para trazer o resultado.
7. Compare e aceite ou rejeite a proposta de revisão. Uma checklist concluída não valida o negócio.

Sem cadastro: o Supabase cria uma identidade anônima persistida neste navegador. Os projetos são privados para essa identidade. O link de um projeto não dá acesso a outro visitante. **Exporte uma cópia JSON antes de limpar os dados do navegador ou mudar de dispositivo.** Importar cria um projeto independente. Há no máximo três projetos por sessão.

O exemplo Chabor reúne dez cartões nos sete tipos do canvas: ideia, hipótese, pesquisa, ação, evidência, decisão e anotação. Seu fluxo conta uma entrevista fictícia, a leitura desse relato e a escolha de um próximo teste gratuito. Valores e resultados são ilustrativos; a referência do Sebrae é manual e não está marcada como pesquisa verificada. O canvas abre no próximo passo, com minimapa e um botão para voltar à ação. Novas cópias recebem o exemplo atualizado; projetos já salvos preservam suas edições.

## Acompanhamento da IA

A conversa mostra uma sequência de atividades com início, conclusão ou falha: interpretação da mensagem, leitura do projeto, pesquisa, cálculos e salvamento de cada anotação. Cartões aceitos aparecem um por vez, depois de salvos; o histórico oferece acesso direto ao cartão afetado. O selo **Atualizado** permanece até você abrir o cartão ou iniciar outra conversa. Mudanças de prioridade continuam agrupadas em propostas para revisão.

## Desenvolvimento

Node.js 24 e npm:

```sh
npm ci
cp .env.example .env.local
# Configure as variáveis em .env.local.
npm run dev
```

Abra `http://127.0.0.1:5173`. O servidor local executa a mesma API Hono que o Vercel e serve o Vite com atualização imediata da interface. Reinicie manualmente após alterar o backend: isso evita interromper conversas durante edições. `npm run dev:watch` habilita reinícios automáticos para desenvolvimento isolado. `npm run preview` serve apenas os arquivos estáticos; use `npm run dev` para testar o produto completo.

```sh
npm test
npm run build
```

Sem Supabase, o desenvolvimento usa armazenamento em memória por sessão, perdido ao reiniciar o servidor. Em produção o banco é obrigatório. Sem provedores de IA, a resposta identifica o modo de orientação básica, sem alegar uma inferência real.

## Infraestrutura já configurada

- Vercel: projeto `create-dia-zero`, SPA React/Vite e função Node.js `/api/index.mjs`, em São Paulo.
- Supabase: projeto `create-dia-zero`, região São Paulo, referência `sbswpqwoengvakailgkn`, autenticação anônima habilitada.
- Banco: `supabase/schema.sql` e `supabase/cancellation.sql` aplicados pelo conector. Cada projeto pertence a `auth.uid()`; Row Level Security impede acesso entre visitantes. A interrupção é registrada no banco para funcionar também atrás do proxy do Vercel.
- As chaves Jev, OpenCode Go e Tavily estão nas variáveis do servidor; Tavily também está configurado no ambiente local. A chave publishable do Supabase é pública por design e protegida pelas políticas; nenhuma chave service role é usada.
- A pesquisa externa usa `TAVILY_API_KEY`, já configurada nesta implantação. Em outro ambiente, sem essa variável ou com o serviço indisponível, o app informa a limitação e não inventa resultados.

Para reproduzir em outro projeto Supabase, aplique `supabase/schema.sql` seguido de `supabase/cancellation.sql` e habilite **Authentication → Sign In / Providers → Anonymous Sign-Ins**. Não exponha o schema `private` na Data API. Configure URL e publishable key nas variáveis do servidor.

## Publicar atualizações

```sh
npx vercel link --project create-dia-zero
npm test
npm run build
npx vercel --prod
```

Atualize variáveis em **Vercel → Settings → Environment Variables**, marque segredos como sensitive e faça uma nova publicação. Não sobrescreva `.env.local` com `vercel env pull` sem preservar as variáveis locais. `.env.local` e `.vercel` são ignorados pelo Git; `.env.example` contém apenas nomes.

## Arquitetura e limites

Veja `docs/architecture.md` para o fluxo de IA, modelo de dados e decisões. A ferramenta `publish_canvas` valida e salva cada atualização antes de enviá-la como evento SSE `project`. A pesquisa publica referências antes de extrair os documentos e enriquece a mesma anotação depois. A interface incorpora essas versões enquanto preserva texto, checklist, exclusões, conexões e posições editadas localmente. Alterações estratégicas e conflitos produzem propostas; propostas antigas não podem substituir uma edição nova.

O texto da resposta chega em chunks reais do modelo depois de uma publicação, quando esse fluxo está disponível. O evento `complete` traz a versão final salva. Se uma geração for interrompida, atualizações já persistidas continuam no projeto. Operações publicadas não são reaplicadas no fim do turno.

As reservas no banco limitam a IA a 30 mensagens por visitante/dia e 200 globalmente/dia, com uma geração ativa por projeto. Pesquisa: até duas buscas e cinco páginas por turno, cinco turnos por visitante/dia, 25 globalmente/dia e reserva de até 750 créditos/mês. Datas seguem São Paulo. Há prazo de 90 segundos por geração e trava de 120 segundos para recuperar interrupções. Limites controlam uso do MVP; não garantem gratuidade dos provedores nem substituem proteção contra abuso ao crescer.

O roteiro qualitativo de 30 cenários em `tests/ai-evaluation.json` é uma lista de casos para avaliação, não uma alegação de 30 testes reais do modelo. Testes automatizados cobrem contratos, fontes, edições humanas, conflitos, cotas e persistência local. `supabase/tests/security.sql` testa políticas/transações e desfaz os dados de teste.

Smoke real opcional (cria sessões e projetos descartáveis, verifica criação incremental, revisão e pesquisa quando disponível, e apaga os projetos):

```sh
npx tsx scripts/smoke-api.ts http://127.0.0.1:5173
# Também aceita https://create-dia-zero.vercel.app.
```

Veja `docs/verification.md` para os resultados das verificações, incluindo o ambiente e a publicação usados em cada teste.

Pesquisa e fatos externos são registrados com links, trechos e data de consulta. `verified` indica que a referência foi recuperada pelo servidor; não garante a conclusão, a atualidade de toda afirmação ou a licença de uma imagem. Referências importadas permanecem não verificadas. Localizações usam dados fornecidos ou endereços presentes em fontes; a IA não estima coordenadas. Questões especializadas requerem fontes adequadas e confirmação profissional quando forem essenciais à execução.
