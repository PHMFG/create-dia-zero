import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, makeCard } from '../shared/domain';
import { calculate, ensureCanvasCoverage, generateTurn, parseJsonReply, providerErrorCode, routeTurn, sanitizeTurn } from '../server/ai';
import { buildContextPacket, buildInstructions } from '../server/prompts';
import { isPublicUrl, ResearchSession } from '../server/research';
import type { CanvasCard, Source, TurnResult } from '../shared/types';

const source: Source = { id: 'real-source', title: 'Fonte recuperada', url: 'https://example.org/referencia', excerpt: 'Texto consultado pelo servidor.', consultedAt: '2026-10-03T12:00:00.000Z', verified: true };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('trust boundary between model and project', () => {
  it('ignores model-written sources and resolves citations from tool output', () => {
    const project = createProject('Um negócio de bebidas');
    const result = sanitizeTurn({ reply: 'Há uma referência [fonte:real-source].', operations: [], sources: [{ id: 'fake', url: 'https://inventado.test' }], mode: 'fallback' }, project, [source]);
    expect(result.sources).toEqual([source]);
    expect(result.reply).toContain('[Fonte recuperada](https://example.org/referencia)');
    expect(result.mode).toBe('live');
  });
  it('rejects fabricated citations and external links', () => {
    const project = createProject('Ideia');
    expect(() => sanitizeTurn({ reply: '[fonte:invented]', mode: 'live' }, project)).toThrow(/fonte inexistente/);
    expect(() => sanitizeTurn({ reply: 'Veja https://fake.example/preco', mode: 'live' }, project)).toThrow(/link sem fonte/);
  });
  it('rejects phantom target cards and duplicate additions', () => {
    const project = createProject('Ideia');
    expect(() => sanitizeTurn({ reply: 'Plano', mode: 'live', operations: [{ op: 'update', cardId: 'missing', patch: { title: 'Outro título' } }] }, project)).toThrow(/inexistente/);
    expect(() => sanitizeTurn({ reply: 'Plano', mode: 'live', operations: [{ op: 'add', cardId: project.cards[0].id, card: project.cards[0] }] }, project)).toThrow(/novamente/);
  });
  it('strips model-written ownership, edit flags and viewport changes', () => {
    const project = createProject('Ideia');
    const card = project.cards[0];
    const result = sanitizeTurn({ reply: 'Atualizado', mode: 'live', operations: [{ op: 'update', cardId: card.id, patch: { title: 'Contexto ampliado', revision: 900, origin: 'user', humanEdited: false, position: { x: 9000, y: 9000 } } }] }, project);
    expect(result.operations[0].patch).toEqual({ title: 'Contexto ampliado' });
    expect(result.operations[0].expectedRevision).toBe(card.revision);
  });
  it('rejects a fabricated source inside a valid card', () => {
    const project = createProject('Ideia');
    const card = makeCard('research', 'Pesquisa', 'Conclusão', [{ id: 'references', type: 'sources', sourceIds: ['unverified'] }]);
    expect(() => sanitizeTurn({ reply: 'Pesquisa', mode: 'live', operations: [{ op: 'add', cardId: card.id, card }] }, project)).toThrow(/fonte inexistente/);
  });
  it('normalizes missing item state and prevents model-written completion', () => {
    const project = createProject('Aulas de desenho');
    const card = makeCard('action', 'Convidar participantes', 'Um teste de conversa.', [{ id: 'check', type: 'checklist', items: [{ id: 'old-done', text: 'Enviar convite', checked: true }, { id: 'old-open', text: 'Registrar relato', checked: false }] }]);
    project.cards.push(card);
    const result = sanitizeTurn({ reply: 'Ampliei o roteiro.', operations: [{ op: 'update', cardId: card.id, patch: { blocks: [{ id: 'check', type: 'checklist', items: [{ id: 'old-done', text: 'Enviar convite', checked: false }, { id: 'old-open', text: 'Registrar relato', checked: true }, { id: 'new-open', text: 'Comparar respostas' }] }] } }] }, project);
    expect(result.operations[0].patch?.blocks?.[0].items?.map(item => item.checked)).toEqual([true, false, false]);
    const addition = { ...card, id: 'new-card', blocks: [{ id: 'list', type: 'list', items: [{ id: 'new-item', text: 'Perguntar sobre a última compra' }] }] };
    expect(sanitizeTurn({ reply: 'Novo roteiro.', operations: [{ op: 'add', cardId: addition.id, card: addition }] }, project).operations[0].card?.blocks[0].items?.[0].checked).toBe(false);
  });
  it('supplies new document metadata without inventing update targets or content', () => {
    const project = createProject('Kits de desenho');
    const result = sanitizeTurn({ reply: 'Preparei o teste.', contextPatch: { constraints: ['Sem estoque inicial', 'Ainda sem fornecedores'] }, operations: [{ op: 'add', card: { kind: 'action', title: 'Ouvir iniciantes', summary: 'Converse antes de comprar materiais.', lane: 'now', blocks: [{ type: 'checklist', items: [{ text: 'Perguntar sobre a última compra de materiais' }] }] } }] }, project);
    const card = result.operations[0].card!;
    expect(card.id).toBe(result.operations[0].cardId);
    expect(card.origin).toBe('ai');
    expect(card.revision).toBe(0);
    expect(card.dependsOn).toEqual([]);
    expect(card.blocks[0].id).toBeTruthy();
    expect(card.blocks[0].items?.[0].id).toBeTruthy();
    expect(result.contextPatch?.constraints).toBe('Sem estoque inicial\nAinda sem fornecedores');
    expect(() => sanitizeTurn({ reply: 'Alteração', operations: [{ op: 'update', patch: { title: 'Sem alvo' } }] }, project)).toThrow();
    expect(() => sanitizeTurn({ reply: 'Alteração', operations: [{ op: 'add', card: { title: 'Sem conteúdo' } }] }, project)).toThrow();
  });
  it('accepts omitted proposals and a markdown-wrapped JSON repair', () => {
    expect(parseJsonReply('```json\n{"reply":"Olá","mode":"live"}\n```')).toEqual({ reply: 'Olá', mode: 'live' });
    expect(sanitizeTurn({ reply: 'Uma pergunta', proposal: null, contextPatch: null }, createProject('Ideia')).proposal).toBeUndefined();
    expect(() => parseJsonReply('Texto solto antes de {"reply":"oi"}')).toThrow();
  });
});

describe('context and graceful provider failure', () => {
  it('keeps human edits and recorded evidence in bounded context', () => {
    const project = createProject('Café');
    project.cards[0].humanEdited = true;
    project.cards[0].title = 'Orçamento corrigido pela pessoa';
    project.evidence.push({ id: 'event', type: 'interview', text: 'Ninguém comprou no teste.', links: [], origin: 'user', createdAt: source.consultedAt });
    const packet = buildContextPacket(project, 'O orçamento agora é R$ 300.', { researchAvailable: false });
    expect(packet.cards[0].title).toBe('Orçamento corrigido pela pessoa');
    expect(packet.evidence[0].text).toBe('Ninguém comprou no teste.');
    expect(packet.project.context.idea).toBe('Café');
    expect(buildInstructions({ researchAvailable: false })).toContain('INDISPONÍVEL');
  });
  it('caps a large workspace while preserving current instructions, facts and recent evidence', () => {
    const project = createProject('Um serviço para professores');
    project.context.budget = 'R$ 300, informado pela pessoa';
    project.cards = Array.from({ length: 80 }, (_, index) => makeCard('note', `Nota ${index}`, 'Resumo longo', Array.from({ length: 20 }, (_, blockIndex) => ({ id: `block-${index}-${blockIndex}`, type: 'paragraph', text: 'Texto longo '.repeat(1000) }))));
    project.messages = Array.from({ length: 50 }, (_, index) => ({ id: `msg-${index}`, role: 'assistant', text: 'Histórico longo '.repeat(500), createdAt: source.consultedAt }));
    project.evidence.push({ id: 'important-result', type: 'purchase', text: 'Uma pessoa pagou R$ 15.', links: [], createdAt: source.consultedAt, origin: 'user' });
    const packet = buildContextPacket(project, 'Quero revisar com base na compra registrada.', { researchAvailable: false, evidenceRegistered: true });
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(60_000);
    expect(packet.project.context.budget).toBe('R$ 300, informado pela pessoa');
    expect(packet.currentMessage).toBe('Quero revisar com base na compra registrada.');
    expect(packet.evidence[0].id).toBe('important-result');
    expect(packet.memory.omitted).toBe(true);
  });
  it('remains explicit when the model is not configured', async () => {
    vi.stubEnv('OPENCODE_GO_API_KEY', '');
    const result = await generateTurn(createProject('Café'), 'Pesquise fornecedores locais.');
    expect(result.mode).toBe('fallback');
    expect(result.sources).toEqual([]);
    expect(result.reply).toContain('Não consultei fontes externas');
    await expect(generateTurn(createProject('Café'), 'Olá', { allowFallback: false })).rejects.toThrow(/não configurada/);
  });
  it('keeps routing functional without Jev and prefers saved evidence review', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    expect((await routeTurn(createProject('Café'), 'Pesquise contatos')).route).toBe('research');
    expect((await routeTurn(createProject('Café'), 'Cinco pessoas não compraram', { evidence: true })).route).toBe('review');
  });
  it('keeps an unavailable model focused on the card rather than starting a general interview', async () => {
    vi.stubEnv('OPENCODE_GO_API_KEY', '');
    const project = createProject('Aulas de desenho');
    const card = makeCard('action', 'Convidar para a aula piloto', 'Ouvir sobre a última experiência com desenho.', []);
    project.cards.push(card);
    const result = await generateTurn(project, 'Como faço o convite?', { focusCardId: card.id });
    expect(result.mode).toBe('fallback');
    expect(result.reply).toContain(card.title);
    expect(result.reply).toContain('A IA não avaliou');
    expect(result.operations).toEqual([]);
    expect(result.reply).not.toContain('público');
  });
  it('reports safe provider diagnostics without exposing response text', () => {
    expect(providerErrorCode({ statusCode: 401, responseBody: 'secret' })).toBe('authorization');
    expect(providerErrorCode({ statusCode: 429 })).toBe('quota');
    expect(providerErrorCode(new SyntaxError('private-data'))).toBe('invalid-output');
  });
});

describe('bounded research', () => {
  it.each(['http://localhost/', 'https://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.18.0.2/', 'http://169.254.169.254/', 'https://[::1]/', 'https://user:pass@example.org/', 'file:///etc/passwd', 'https://machine.local/'])('does not allow private or credential-bearing URLs: %s', url => {
    expect(isPublicUrl(url)).toBe(false);
  });
  it('does not reserve credits or issue a request when unavailable', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    const fetcher = vi.fn(); const reserve = vi.fn();
    const session = new ResearchSession({ fetcher, reserve });
    expect((await session.search('matcha Porto Alegre')).status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
  it('reserves once and caps requests at two basic searches plus one extraction', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.urls) return new Response(JSON.stringify({ results: [{ url: source.url, raw_content: 'Conteúdo extraído confirmado.' }], usage: { credits: 1 }, request_id: 'extract-1' }));
      return new Response(JSON.stringify({ results: [{ url: source.url, title: source.title, content: source.excerpt }, { url: 'http://127.0.0.1/', title: 'Interno', content: 'Não usar' }], usage: { credits: 1 }, request_id: 'search-1' }));
    });
    const reserve = vi.fn(async () => true);
    const session = new ResearchSession({ apiKey: 'test-key', fetcher: fetcher as typeof fetch, reserve });
    expect((await session.search('matcha Porto Alegre')).sources).toHaveLength(1);
    await session.search('fornecedor matcha Porto Alegre');
    expect((await session.search('terceira busca proibida')).status).toBe('limited');
    expect(fetcher).toHaveBeenCalledTimes(3); expect(reserve).toHaveBeenCalledTimes(1);
    const searchBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(searchBody.search_depth).toBe('basic'); expect(searchBody.auto_parameters).toBe(false);
    expect(session.sources[0].excerpt).toContain('Conteúdo extraído confirmado');
  });
  it('does not contact the provider after the persistent budget rejects a reservation', async () => {
    const fetcher = vi.fn();
    const session = new ResearchSession({ apiKey: 'test-key', fetcher, reserve: async () => false });
    expect((await session.search('consulta válida')).status).toBe('limited');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('enforces the shared hard limit even when the model calls tools in parallel', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    const session = new ResearchSession({ apiKey: 'test-key', fetcher: fetcher as typeof fetch, reserve: async () => true });
    const results = await Promise.all(['primeira consulta', 'segunda consulta', 'terceira consulta', 'quarta consulta'].map(query => session.search(query)));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results.filter(result => result.status === 'limited')).toHaveLength(2);
  });
});

describe('server calculator', () => {
  it('calculates scenarios and rejects zero division', () => {
    expect(calculate('multiply', [20, 15])).toBe(300);
    expect(calculate('percentage', [300, 10])).toBe(30);
    expect(() => calculate('divide', [300, 0])).toThrow(/zero/);
    expect(() => calculate('percentage', [300])).toThrow(/finito/);
  });
});

describe('dynamic document coverage', () => {
  const richCard = (kind: CanvasCard['kind'], title: string): CanvasCard => makeCard(kind, title, 'Documento específico do projeto.', [{ id: crypto.randomUUID(), type: 'paragraph', text: 'Uma explicação concreta do assunto discutido, com o motivo deste teste e o que precisamos descobrir antes de investir.' }]);
  const add = (card: CanvasCard) => ({ op: 'add' as const, cardId: card.id, card });
  const result = (cards: CanvasCard[] = []): TurnResult => ({ reply: 'Preparei conteúdo para seu projeto.', operations: cards.map(add), sources: [], mode: 'live' });
  it('rejects an initial chat answer that never creates documents beyond the context', () => {
    const project = createProject('Quero oferecer aulas de desenho online.');
    expect(() => ensureCanvasCoverage(result(), project, project.context.idea, { researchAvailable: false })).toThrow(/pelo menos dois cartões/);
    expect(() => ensureCanvasCoverage(result([richCard('hypothesis', 'Dificuldade para começar a desenhar')]), project, project.context.idea, { researchAvailable: false })).toThrow(/pelo menos dois cartões/);
    expect(() => ensureCanvasCoverage(result([richCard('hypothesis', 'Dificuldade para começar a desenhar'), richCard('action', 'Ouvir quem começou a desenhar recentemente')]), project, project.context.idea, { researchAvailable: false })).not.toThrow();
  });
  it('creates a dedicated resources document instead of hiding the budget in the chat', () => {
    const project = createProject('Aulas de desenho.');
    project.messages.push({ id: 'previous', role: 'assistant', text: 'Qual limite de investimento?', createdAt: source.consultedAt });
    const incomplete = { ...result(), contextPatch: { budget: 'R$ 300', availability: 'Duas horas no sábado' } };
    expect(() => ensureCanvasCoverage(incomplete, project, 'Tenho R$ 300 e duas horas.', { researchAvailable: false })).toThrow(/Recursos e limites/);
    const complete = { ...incomplete, operations: [add(richCard('note', 'Recursos e limites do teste'))] };
    expect(() => ensureCanvasCoverage(complete, project, 'Tenho R$ 300 e duas horas.', { researchAvailable: false })).not.toThrow();
    const differentlyNamed = richCard('note', 'Viabilidade do piloto');
    differentlyNamed.blocks[0].text = 'O orçamento informado limita o teste a conversar antes de comprar estoque. As duas horas no sábado permitem convidar participantes e ouvir uma primeira experiência.';
    expect(() => ensureCanvasCoverage({ ...incomplete, operations: [add(differentlyNamed)] }, project, 'Tenho R$ 300 e duas horas.', { researchAvailable: false })).not.toThrow();
  });
  it('allows existing documents to evolve and does not add filler for greetings', () => {
    const project = createProject('Aulas de desenho.');
    expect(() => ensureCanvasCoverage(result(), project, 'Olá!', { researchAvailable: false })).not.toThrow();
    project.messages.push({ id: 'previous', role: 'assistant', text: 'Vamos testar.', createdAt: source.consultedAt });
    const existing = richCard('note', 'Recursos e limites do teste'); project.cards.push(existing);
    const updated: TurnResult = { ...result(), contextPatch: { budget: 'R$ 200' }, operations: [{ op: 'update', cardId: existing.id, expectedRevision: existing.revision, patch: { summary: 'Novo limite de R$ 200.' } }] };
    expect(() => ensureCanvasCoverage(updated, project, 'Agora tenho R$ 200.', { researchAvailable: false })).not.toThrow();
  });
  it('rejects duplicated empty documents and chat-only evidence analysis', () => {
    const project = createProject('Aulas de desenho.');
    project.messages.push({ id: 'previous', role: 'assistant', text: 'Vamos testar.', createdAt: source.consultedAt });
    const card = richCard('note', 'Recursos e limites'); project.cards.push(card);
    expect(() => ensureCanvasCoverage(result([richCard('note', 'Recursos e limites')]), project, 'Expanda meu plano.', { researchAvailable: false })).toThrow(/repetindo/);
    expect(() => ensureCanvasCoverage(result([makeCard('note', 'Descobertas', '', [])]), project, 'Expanda meu plano.', { researchAvailable: false })).toThrow(/vazio/);
    expect(() => ensureCanvasCoverage(result(), project, 'Analise a experiência registrada.', { researchAvailable: false, evidenceRegistered: true })).toThrow(/representado no canvas/);
  });
  it('prioritizes a card conversation without reopening the initial interview', () => {
    const project = createProject('Aulas de desenho.');
    const focused = richCard('action', 'Convidar participantes para uma aula piloto'); project.cards.push(focused);
    const hints = { researchAvailable: false, focusCardId: focused.id };
    const packet = buildContextPacket(project, 'Como faço o convite?', hints);
    expect(packet.focusedCard?.id).toBe(focused.id);
    expect(packet.cards[0].id).toBe(focused.id);
    expect(buildInstructions(hints)).toContain('Não recomece a entrevista geral');
    const update: TurnResult = { ...result(), operations: [{ op: 'update', cardId: focused.id, expectedRevision: focused.revision, patch: { summary: 'Convite específico para a aula piloto.' } }] };
    expect(() => ensureCanvasCoverage(update, project, 'Como faço o convite?', hints)).not.toThrow();
  });
  it('remembers earlier card conversations with their scope when the general chat moves on', () => {
    const project = createProject('Aulas de desenho.');
    const focused = richCard('action', 'Convidar participantes'); project.cards.push(focused);
    project.messages = [{ id: 'focused-older', role: 'user', text: 'O convite precisa caber em uma mensagem curta.', cardId: focused.id, createdAt: source.consultedAt }, ...Array.from({ length: 20 }, (_, index) => ({ id: `general-${index}`, role: 'assistant' as const, text: `Assunto geral ${index}`, createdAt: source.consultedAt }))];
    const packet = buildContextPacket(project, 'Ajuste aquele convite.', { researchAvailable: false, focusCardId: focused.id });
    expect(packet.recentConversation.some(entry => entry.text.includes('mensagem curta') && entry.cardId === focused.id)).toBe(true);
    expect(packet.recentConversation.at(-1)?.text).toBe('Assunto geral 19');
  });
});
