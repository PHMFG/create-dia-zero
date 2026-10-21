---
title: Riscos e estado das verificações
kind: topic
updated: 2026-10-21
status: mixed
sources:
  - ../docs/verification.md
  - ../docs/verification-db.md
  - ../package.json
  - ../src/main.tsx
  - ../src/design-system.css
  - ../server/app.ts
  - ../.gitignore
  - ../.vercelignore
---

# Riscos e estado das verificações

A implementação e os testes locais foram analisados em **7 de outubro de 2026**. Registros de produção, banco e design têm datas próprias. Esta página delimita o que cada evidência permite concluir e onde começar uma verificação adicional.

## Situação desta análise

| Área | Evidência atual | Limite |
| --- | --- | --- |
| Código ativo e mudanças locais | Leitura por três subagentes Luna max, síntese e revisão da raiz. | Inclui o checkout com alterações não commitadas, não apenas o HEAD. |
| Testes automatizados | Comando padrão: 190 testes em 14 arquivos; excluindo a cópia de design: 178 testes em 12 arquivos. Ambos aprovados. | Os 12 casos extras pertencem a `.design-export/`. Mocks, memória e contratos não demonstram a qualidade atual dos provedores. |
| Compilação | `npm run typecheck` e `npm run build` aprovados, incluindo API. | Executados com Node 25.9.0; o projeto declara e empacota para Node 24. |
| IA e pesquisa reais | Há verificações históricas em `docs/verification.md`. | Nenhum smoke com provedores foi executado nesta análise. |
| Supabase remoto | Há SQL e verificações históricas. | Banco, políticas aplicadas e concorrência real não foram auditados novamente. |
| UI renderizada | Há registros de 6 de outubro na extração de design. | Não houve nova inspeção visual de runtime nesta análise. |
| Vercel e Figma | Há URLs e relatórios no repositório. | Disponibilidade, estado de publicação e arquivo remoto não foram consultados agora. |

O [mapa de testes](testing.md) detalha comportamentos cobertos e as ações com efeitos externos. Uma resposta positiva de `/api/health` mostra presença de configuração; não chama todos os provedores nem testa suas credenciais. Fonte: [server/app.ts](../server/app.ts).

## Divergências documentais conhecidas

| Registro | Estado observado | Como interpretar |
| --- | --- | --- |
| `docs/architecture.md` descreve Inter Tight na abertura. | `src/main.tsx` carrega Inter 300/400/500/600 e `src/design-system.css` redefine a fonte UI/cabeçalhos para Inter. | Para o design ativo, use [design-system.md](design-system.md) e os imports atuais. |
| `docs/verification.md` contém 153, 170 e 178 testes; a nota de design registra 190. | A suíte ativa continua com 178 casos em 12 arquivos; o comando padrão inclui 12 casos de duas cópias em `.design-export/`, totalizando 190. | Há etapas históricas e escopos de coleta distintos. O aumento até 190 não representa 12 casos novos do aplicativo ativo. |
| `.design-export/README.md` e `updates/implementation-notes.md` registram contagens diferentes de componentes/variáveis. | Os documentos descrevem extração inicial e revisão posterior. | Preserve a cronologia; uma contagem local não comprova o arquivo Figma atual. |
| README chama o aplicativo de público e descreve serviços configurados. | URLs e configuração externa não foram verificadas nesta tarefa. | Consulte o estado real antes de afirmar disponibilidade ou agir sobre a implantação. |

## Limites que afetam o produto

**Continuidade da identidade.** A sessão anônima é vinculada ao navegador. Sem exportar, limpar seus dados pode perder o acesso; não há recuperação por conta convencional implementada. Veja [visão geral](overview.md) e [persistência](persistence.md).

**Abuso e custos.** Cotas globais limitam o consumo disponível, mas um visitante novo ainda pode disputar esse limite. Campos opcionais de captcha no código não comprovam ativação no ambiente. Cotas da aplicação não garantem gratuidade dos provedores. Veja [segurança](security.md) e [IA](ai.md).

**Contabilização de pesquisa.** A reserva guarda três créditos por investigação; a rota de mensagens não persiste IDs nem créditos finais por chamada de Tavily. Esse ledger limita o orçamento previsto, mas não substitui o consumo real do provedor. Veja [pesquisa](research.md).

**Concorrência remota.** Testes em memória exercitam limites e conflitos; relatórios SQL registram execuções transacionais sequenciais. Eles não constituem um teste de carga concorrente no serviço. Antes de alterar locks, reservas ou CAS, confronte SQL, testes e ambiente alvo. Veja [persistência](persistence.md).

**Informação externa.** Um resultado recuperado não garante atualidade de cada afirmação, licença de imagem ou validade de uma conclusão de negócio. Imagens e mapas podem falhar; um mapa de cidade não confirma um endereço comercial. Veja [pesquisa](research.md).

**Estado de trabalho e publicação.** A análise de 7 de outubro incluiu mudanças de design então não commitadas e `.design-export/` não rastreado. Desde 21 de outubro de 2026, essas mudanças estão commitadas e o `.gitignore` exclui `.design-export/`, que fica só na cópia local e não existe num clone. Revise o conjunto de arquivos a publicar conforme [operação](operations.md), sem confundir capturas estáticas com fontes de runtime ou alterar disponibilidade a partir desta documentação.

## Próximas verificações conforme a tarefa

- Para uma regressão de conversa: testes do fluxo/SSE, depois smoke real no ambiente escolhido quando necessário.
- Para uma alteração SQL/Auth: revisar ownership e grants, executar a segurança transacional no banco alvo e conferir advisors.
- Para mudança visual: renderizar o fluxo pertinente em desktop/mobile e conferir estados interativos; uma captura antiga não substitui isso.
- Para produção: verificar vínculo, build publicado, disponibilidade e fluxo afetado; não deduzir o estado pela URL registrada.

Novas falhas confirmadas devem incluir reprodução, arquivo responsável, impacto e evidência. Hipóteses permanecem identificadas até serem verificadas. Volte ao [índice](index.md) ou consulte [manutenção](maintenance.md).
