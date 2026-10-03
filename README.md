# create · da ideia à primeira evidência

Copiloto para quem está começando um negócio. A conversa organiza contexto e hipóteses num canvas editável, destaca uma ação e revisa o plano quando a pessoa retorna com uma experiência real.

Aplicativo público: **[create-dia-zero.vercel.app](https://create-dia-zero.vercel.app)**.

## Usar o aplicativo

1. Conte sua ideia na tela inicial ou explore o exemplo Chabor, identificado como demonstração.
2. Converse com a create: a entrevista considera público, recursos, restrições e lacunas, com uma pergunta principal por vez.
   A IA transforma a primeira ideia em cartões específicos e amplia o canvas conforme surgem assuntos úteis. Use **Esclarecer** em um cartão para abrir uma conversa sobre aquele conteúdo.
3. Edite os cartões, abra **Sobre**, acrescente blocos/anotações e acompanhe a checklist. Arraste no canvas ou use a lista no celular.
4. Faça o teste fora do aplicativo e use **Registrar experiência** para trazer o resultado.
5. Compare e aceite ou rejeite a proposta de revisão. Uma checklist concluída não valida o negócio.

Sem cadastro: o Supabase cria uma identidade anônima persistida neste navegador. Os projetos são privados para essa identidade. O link de um projeto não dá acesso a outro visitante. **Exporte uma cópia JSON antes de limpar os dados do navegador ou mudar de dispositivo.** Importar cria um projeto independente. Há no máximo três projetos por sessão.

## Desenvolvimento

Node.js 24 e npm:

```sh
npm ci
cp .env.example .env.local
# Configure as variáveis em .env.local.
npm run dev
```

Abra `http://127.0.0.1:5173`. O servidor local executa a mesma API Hono que o Vercel, reinicia quando o backend muda e serve o Vite com atualização imediata. `npm run preview` serve apenas os arquivos estáticos; use `npm run dev` para testar o produto completo.

```sh
npm test
npm run build
```

Sem Supabase, o desenvolvimento usa armazenamento em memória por sessão, perdido ao reiniciar o servidor. Em produção o banco é obrigatório. Sem provedores de IA, a resposta identifica o modo de orientação básica, sem alegar uma inferência real.

## Infraestrutura já configurada

- Vercel: projeto `create-dia-zero`, SPA React/Vite e função Node.js `/api/index.mjs`, em São Paulo.
- Supabase: projeto `create-dia-zero`, região São Paulo, referência `sbswpqwoengvakailgkn`, autenticação anônima habilitada.
- Banco: `supabase/schema.sql` aplicado pelo conector. Cada projeto pertence a `auth.uid()`; Row Level Security impede acesso entre visitantes.
- As chaves Jev e OpenCode Go estão nas variáveis do servidor do Vercel. A chave publishable do Supabase é pública por design e protegida pelas políticas; nenhuma chave service role é usada.
- A pesquisa Tavily fica disponível quando `TAVILY_API_KEY` está configurada. Sem ela, a IA explica que não pesquisou e pode propor investigação manual.

Para reproduzir em outro projeto Supabase, aplique o SQL e habilite **Authentication → Sign In / Providers → Anonymous Sign-Ins**. Não exponha o schema `private` na Data API. Configure URL e publishable key nas variáveis do servidor.

## Publicar atualizações

```sh
npx vercel link --project create-dia-zero
npm test
npm run build
npx vercel --prod
```

Atualize variáveis em **Vercel → Settings → Environment Variables**, marque segredos como sensitive e faça uma nova publicação. Não sobrescreva `.env.local` com `vercel env pull` sem preservar as variáveis locais. `.env.local` e `.vercel` são ignorados pelo Git; `.env.example` contém apenas nomes.

## Arquitetura e limites

Veja `docs/architecture.md` para o fluxo de IA, modelo de dados e decisões. O backend valida toda atualização, preserva conteúdo humano e salva o resultado antes do evento final da resposta. O estado tem versão para impedir sobrescrita por uma janela antiga. Alterações estratégicas e conflitos produzem propostas; propostas antigas não podem substituir uma edição nova.

As reservas no banco limitam a IA a 30 mensagens por visitante/dia e 200 globalmente/dia, com uma geração ativa por projeto. Pesquisa: até duas buscas e cinco páginas por turno, cinco turnos por visitante/dia, 25 globalmente/dia e reserva de até 750 créditos/mês. Datas seguem São Paulo. Há prazo de 90 segundos por geração e trava de 120 segundos para recuperar interrupções. Limites controlam uso do MVP; não garantem gratuidade dos provedores nem substituem proteção contra abuso ao crescer.

O roteiro qualitativo de 30 cenários em `tests/ai-evaluation.json` é uma lista de casos para avaliação, não uma alegação de 30 testes reais do modelo. Testes automatizados cobrem contratos, fontes, edições humanas, conflitos, cotas e persistência local. `supabase/tests/security.sql` testa políticas/transações e desfaz os dados de teste.

Smoke real opcional (cria sessões e projetos descartáveis, faz duas inferências e apaga os projetos):

```sh
npx tsx scripts/smoke-api.ts http://127.0.0.1:5173
# Também aceita https://create-dia-zero.vercel.app.
```

O fluxo completo foi verificado na publicação pública com DeepSeek Flash e Jev, incluindo criação de cartões, mini chat, persistência e isolamento entre visitantes. Veja os resultados em `docs/verification.md`.

Pesquisa e fatos externos são registrados com links, trechos e data de consulta. Um resultado de busca é uma referência consultada, não garantia da conclusão. Questões especializadas requerem fontes adequadas e confirmação profissional quando forem essenciais à execução.
