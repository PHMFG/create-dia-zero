---
title: Pesquisa e fontes
kind: topic
updated: 2026-10-07
status: code-verified
sources:
  - ../server/research.ts
  - ../server/ai.ts
  - ../server/prompts.ts
  - ../server/app.ts
  - ../server/store.ts
  - ../supabase/schema.sql
  - ../shared/media.ts
  - ../shared/types.ts
  - ../shared/validation.ts
  - ../shared/domain.ts
---

# Pesquisa e fontes

A pesquisa web usa Tavily pelo servidor em [ResearchSession](../server/research.ts#L47). TAVILY_API_KEY habilita a ferramenta; sem ela, a sessão informa que a pesquisa está indisponível e não cria fontes. O código define o endpoint e lê a chave no servidor; a disponibilidade do serviço e a configuração de produção são propriedades externas que o código não confirma.

## Orçamento e recuperação

Cada turno aceita até duas consultas básicas, com até cinco resultados por consulta. Na primeira busca com resultados, o serviço tenta uma extração básica, em texto, de até cinco URLs recebidas da busca. A extração não recebe URLs inventadas pelo modelo nem as imagens sem associação confiável a uma página. Cada requisição tem timeout de 18 segundos. Falha na extração conserva os trechos originais da busca.

Antes da primeira chamada, [ResearchSession.search](../server/research.ts#L64) reserva uma investigação persistente para o run. A reserva é única por execução e consome três créditos previstos mesmo se o provedor falhar, pois o código não pode saber se um timeout gerou cobrança. Os tetos registrados no código são cinco reservas por pessoa/dia, 25 globais/dia e 750 créditos reservados/mês. A página [persistence.md](persistence.md) descreve onde essas cotas são aplicadas.

Sem chave, a ferramenta retorna unavailable; ao atingir a cota, retorna limited. Falhas do serviço retornam error, com mensagens diferentes para autorização e limite do provedor. Uma resposta sem resultados utilizáveis retorna status ok com uma mensagem explícita de que não há fontes. O texto de instrução proíbe declarar uma consulta como concluída sem fonte recuperada. A busca não garante disponibilidade contínua, precisão ou atualidade.

## Proveniência e síntese

Cada página aceita precisa ter URL pública segundo [isSafeExternalUrl](../shared/media.ts). O servidor gera ID estável a partir do hash da URL, guarda título, data de consulta e trecho recebido. A extração pode substituir o trecho por conteúdo mais longo. O modelo não cria objetos Source: [sanitizeTurn](../server/ai.ts#L118) troca a lista do resultado pelas fontes coletadas de fato no turno.

ResearchSession marca seus resultados verified igual a true; isso indica que a referência veio do serviço e foi aceita pelo servidor, não que cada afirmação foi checada independentemente. [importProject](../shared/domain.ts#L387) marca fontes importadas como verified false. O trecho de busca ou extração é evidência do que a página contém, não garantia de que a página seja correta. Imagens só são aceitas quando a URL veio do provedor. Imagens retornadas na consulta geral, sem página associada, viram referência própria; o código registra que página original e licença não foram confirmadas.

Na rota de conversa da API, as referências são gravadas em uma nota provisória do tipo research antes de a extração terminar. A nota inclui links e imagens retornados e avisa que ainda não há síntese. Depois, [write_research_summary](../server/ai.ts#L607) exige título de 3 a 160 caracteres, resumo de 30 a 2.000, de uma a quatro conclusões de 80 a 2.000 caracteres cada com um a oito IDs reais por conclusão, além de implicações e limitações de 60 a 2.000 caracteres cada. A atualização reaproveita a mesma nota. Uma revisão sensível ou conflito pode virar proposta pendente; nesse caso, o cartão original permanece como estava e a resposta deve dizer que a síntese aguarda aprovação.

Os estados são intencionalmente distintos: fontes recuperadas podem ser verdadeiras referências sem que a análise tenha sido concluída; síntese publicada significa que os blocos passaram a validação e foram salvos. Se o modelo falhar depois de registrar fontes, a API conserva os links e trechos e informa que a interpretação ficou incompleta.

## Limites de auditoria

ResearchSession guarda IDs e créditos relatados por requisição para um callback de contabilização. A rota de mensagens conecta a reserva persistente, mas não fornece onResearchUse; portanto, o ledger SQL mantém a reserva fixa de três créditos, sem log por request_id ou confirmação do custo final de Tavily. Qualidade factual e licença de mídia não são verificadas pelo pipeline; a disponibilidade atual da chave e do serviço precisa de evidência do ambiente.

Veja também: [índice](index.md) · [visão geral](overview.md) · [backend](backend.md) · [IA](ai.md) · [canvas](canvas.md) · [domínio](domain.md) · [persistência](persistence.md) · [segurança](security.md) · [operações](operations.md) · [riscos](risks.md).
