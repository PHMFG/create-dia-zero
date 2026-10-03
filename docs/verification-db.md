# Verificação de persistência e isolamento

Verificação realizada em **3 de outubro de 2026** no projeto Supabase `sbswpqwoengvakailgkn`.

## Resultado real no Supabase

`supabase/tests/security.sql` foi executado via plugin Supabase `execute_sql` depois da aplicação de `supabase/schema.sql`. Resultado retornado:

> create security assertions passed; fixtures rolled back

O teste criou dois visitantes temporários, assumiu o papel `authenticated` com cada identidade e verificou leitura, inserção, edição e exclusão por proprietário. Tentativas de acessar ou reatribuir projetos de outro visitante foram bloqueadas. O papel `anon`, sem sessão Auth, não pôde ler projetos nem chamar a reserva de execução. Visitantes não puderam consultar os registros privados de cotas.

As RPCs confirmaram idempotência de `runId`, uma execução ativa por projeto, bloqueio de conclusão com identificação incorreta, liberação pela conclusão correspondente, uma reserva de pesquisa por execução, cinco pesquisas por visitante/dia e trinta mensagens por visitante/dia. Todos os dados de teste foram revertidos pelo `rollback` final. O teste de banco foi sequencial: concorrência entre transações reais e esgotamento global/mensal não foram simulados no serviço remoto.

## Testes locais

`npm test -- tests/store.test.ts tests/domain.test.ts`: **36 testes aprovados**. `npx tsc --noEmit`: aprovado no momento da verificação.

Os testes locais incluem edições simultâneas da mesma revisão (uma gravação aceita e outra recusada), criação simultânea limitada a três projetos, exclusão mútua de respostas, reenvio idempotente, expiração de bloqueio após 120 segundos, 200 mensagens globais/dia, 25 pesquisas globais/dia e reserva conservadora de três créditos por pesquisa até 750 créditos/mês. Esses testes usam memória e relógio controlado; não equivalem a testes de carga no PostgreSQL remoto.

## Resultado dos advisors

Os advisors de segurança e desempenho foram consultados via plugin após o teste. **Nenhum aviso de nível ERROR foi retornado.** Os itens abaixo correspondem às escolhas atuais:

- **RLS Enabled No Policy — INFO**, nas duas tabelas `private`: o acesso direto está bloqueado pela ausência de grants e pelo RLS sem política permissiva. Somente helpers privados com validação de identidade acessam o registro. O esquema `private` não deve ser exposto na Data API. [Referência](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- **Anonymous Access Policies — WARN**, em `create_projects`: sessões anônimas de Supabase Auth têm papel `authenticated`; o acesso intencional permanece limitado a `auth.uid() = owner_id`. Esse isolamento foi exercitado com dois visitantes. [Referência](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins)
- **Leaked Password Protection Disabled — WARN**: o fluxo atual não utiliza cadastro ou login por senha. Antes de introduzir senhas, configurar a proteção correspondente. [Referência](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- **Unused Index — INFO**, `create_runs_project_idx`: o índice foi mantido para a chave estrangeira de projeto e sua exclusão; o banco novo ainda não acumulou consultas de produção suficientes para classificá-lo como usado. [Referência](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

Não foi necessário usar uma chave `service_role` no aplicativo. As consultas de projetos usam a sessão do visitante e as políticas do banco.
