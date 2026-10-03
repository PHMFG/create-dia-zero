# Verificação da entrega · 3 de outubro de 2026

Aplicativo público: https://create-dia-zero.vercel.app

Publicação Vercel: `dpl_F4pWew18bnTaqV5Lv4T5YvfJJBbm`, região `gru1`.

## Código e dados

- 74 testes automatizados aprovados em quatro arquivos: contratos da IA, atualizações do canvas, persistência/cotas e integração entre edições locais e a resposta da IA.
- TypeScript e build de produção aprovados, incluindo o bundle Node.js da API.
- Políticas de acesso e reservas executadas no banco Supabase com transação desfeita. A verificação está detalhada em `verification-db.md`.
- Chaves privadas ausentes do bundle do navegador; `.env.local`, `.vercel`, artefatos de verificação e arquivos gerados excluídos da entrega de fontes.

## Fluxo real em produção

`npx tsx scripts/smoke-api.ts https://create-dia-zero.vercel.app` concluiu com modo `live`, sete cartões e uma proposta de revisão. O cenário usa dados fictícios e apaga os projetos de teste ao terminar.

Os dez critérios passaram:

1. Health público e provedores configurados.
2. API privada nega requisições sem autenticação.
3. Outro visitante não acessa o projeto, pela API nem pela política RLS.
4. A IA acrescenta cartões ao canvas a partir da primeira ideia.
5. Texto e checklist editados persistem; gravação com versão antiga é rejeitada.
6. Experiência registrada é persistida separadamente das hipóteses.
7. Resposta real de DeepSeek/Jev por SSE preserva edições humanas.
8. Mini chat mantém mensagens associadas ao cartão escolhido.
9. Resultado da IA está salvo antes do evento de conclusão da resposta.
10. Importação JSON cria um projeto independente.

Um cenário real adicional de três conversas confirmou o crescimento do canvas de um para três e depois seis cartões, seguido de esclarecimento de uma ação sem duplicar cartões.

## Interface

Verificação visual em desktop e celular: barra de projetos recolhível, cabeçalho compacto, controles flutuantes de canvas/lista, ausência dos títulos e aviso horizontal removidos, mini chat específico por cartão. Checklist, orçamento e posições arrastadas foram conferidos após recarregar.

## Limite atual

Pesquisa externa automática aguarda `TAVILY_API_KEY`. A integração está preparada, mas as respostas atuais não alegam consulta à web nem inventam fontes. Os 30 cenários qualitativos de `tests/ai-evaluation.json` são um roteiro para avaliação futura, não 30 execuções reais do modelo.
