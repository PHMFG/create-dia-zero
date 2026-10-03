import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyHumanEdit, applyTurn, createProject, makeCard } from '../shared/domain';
import { buildResearchSummaryOperation, calculate, decodeReplyPrefix, ensureCanvasCoverage, ensureResearchSynthesis, generateTurn, hasResearchSynthesis, parseJsonReply, providerErrorCode, PublicationLedger, publishCanvasSequentially, routeTurn, runToolActivity, sanitizeTurn, splitCanvasPublication } from '../server/ai';
import { buildContextPacket, buildInstructions } from '../server/prompts';
import { isPublicUrl, ResearchSession } from '../server/research';
import type { AgentActivity, CanvasCard, CanvasDelta, Project, Source, TurnResult } from '../shared/types';
import { auditDependencyGraph } from '../shared/canvasConnections';

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

describe('incremental publication and media provenance', () => {
  it('decodes partial real reply chunks without exposing tool data or incomplete escapes', () => {
    expect(decodeReplyPrefix('{"reply":"Ol')).toBe('Ol');
    expect(decodeReplyPrefix('{"reply":"Olá\\nLinha \\"dois\\"","operations":[{}]}')).toBe('Olá\nLinha "dois"');
    expect(decodeReplyPrefix('{"reply":"Olá\\u00')).toBeUndefined();
    expect(decodeReplyPrefix('{"operations":[{"reply":"dado do cartão"}]}')).toBeUndefined();
    expect(decodeReplyPrefix('{"contextPatch":{},"operations":[{"reply":"dado do cartão"}],"reply":"Resposta parcial')).toBe('Resposta parcial');
  });
  it('removes acknowledged operations and context from the final result, including proposals', () => {
    const ledger = new PublicationLedger();
    const document = makeCard('note', 'Teste', 'Nota', []);
    const add = { op: 'add' as const, cardId: document.id, card: document };
    const update = { op: 'update' as const, cardId: 'original', expectedRevision: 0, patch: { summary: 'Conteúdo ampliado.' } };
    ledger.remember({ contextPatch: { budget: 'R$ 300' }, operations: [add, update], sources: [] });
    const stripped = ledger.strip({ reply: 'Concluído', contextPatch: { budget: 'R$ 300', city: 'Porto Alegre' }, operations: [add, { ...update, expectedRevision: 1 }], proposal: { title: 'Mudança', reason: 'Revisão', operations: [update] } }) as TurnResult;
    expect(stripped.operations).toEqual([]);
    expect(stripped.contextPatch).toEqual({ city: 'Porto Alegre' });
    expect(stripped.proposal).toBeUndefined();
    expect(ledger.aggregate({ ...stripped, mode: 'live', sources: [] }).operations).toHaveLength(2);
  });
  it('does not reapply content when its first publication also supplied an automatic relation', () => {
    const ledger = new PublicationLedger();
    ledger.remember({ operations: [{ op: 'update', cardId: 'resources', expectedRevision: 1, patch: { summary: 'Limite de R$ 300.', dependsOn: ['context'] } }], sources: [] });
    const replay = ledger.strip({ reply: 'Concluído.', operations: [{ op: 'update', cardId: 'resources', expectedRevision: 2, patch: { summary: 'Limite de R$ 300.' } }] }) as TurnResult;
    expect(replay.operations).toEqual([]);
    const newRelation = ledger.strip({ reply: 'Nova relação.', operations: [{ op: 'update', cardId: 'resources', expectedRevision: 2, patch: { summary: 'Limite de R$ 300.', dependsOn: ['hypothesis'] } }] }) as TurnResult;
    expect(newRelation.operations).toHaveLength(1);
  });
  it('allows provider-returned images and explicit user links while rejecting invented media', () => {
    const project = createProject('Referência fornecida: https://example.org/user-reference');
    const imageSource = { ...source, imageUrl: 'https://example.org/provider-image.webp' };
    const media = makeCard('research', 'Referências', 'Conteúdo real', [{ id: 'image', type: 'image', url: imageSource.imageUrl, alt: 'Imagem retornada na consulta', sourceIds: [source.id] }, { id: 'user-link', type: 'link', url: 'https://example.org/user-reference', text: 'Referência fornecida pela pessoa' }]);
    expect(sanitizeTurn({ reply: 'Organizado.', operations: [{ op: 'add', cardId: media.id, card: media }] }, project, [imageSource]).operations[0].card?.blocks[0].url).toBe(imageSource.imageUrl);
    media.blocks[0].url = 'https://invented.example/image.jpg';
    expect(() => sanitizeTurn({ reply: 'Organizado.', operations: [{ op: 'add', cardId: media.id, card: media }] }, project, [imageSource])).toThrow(/procedência/);
  });
  it('uses known addresses without inventing geographic coordinates', () => {
    const project = createProject('Loja em Porto Alegre'); project.context.city = 'Porto Alegre';
    const location = makeCard('note', 'Onde investigar', 'Local informado.', [{ id: 'location', type: 'location', address: 'Porto Alegre', latitude: -30.0346, longitude: -51.2177 }]);
    const block = sanitizeTurn({ reply: 'Local registrado.', operations: [{ op: 'add', cardId: location.id, card: location }] }, project).operations[0].card?.blocks[0];
    expect(block?.address).toBe('Porto Alegre'); expect(block?.latitude).toBeUndefined(); expect(block?.longitude).toBeUndefined();
    location.blocks[0].address = 'Rua Inventada, 123';
    expect(() => sanitizeTurn({ reply: 'Local registrado.', operations: [{ op: 'add', cardId: location.id, card: location }] }, project)).toThrow(/endereço/);
  });
  it.each(['user-origin', 'edited-card', 'edited-block'] as const)('preserves existing human media only in its own card (%s)', ownership => {
    const project = createProject('Uma ideia para testar.');
    const reference = makeCard('note', 'Referências manuais', 'Material informado pela pessoa.', [
      { id: 'manual-link', type: 'link', url: 'https://manual.example/reference', text: 'Referência: https://manual.example/reference' },
      { id: 'manual-image', type: 'image', url: 'https://manual.example/photo', alt: 'Foto fornecida pela pessoa' },
      { id: 'manual-place', type: 'location', address: 'Rua da Oficina, 42', latitude: -30.1234, longitude: -51.4321 },
    ]);
    if (ownership === 'user-origin') reference.origin = 'user';
    if (ownership === 'edited-card') reference.humanEdited = true;
    if (ownership === 'edited-block') for (const block of reference.blocks) block.humanEdited = true;
    project.cards.push(reference);
    const update = { op: 'update' as const, cardId: reference.id, patch: { blocks: structuredClone(reference.blocks) } };
    const preserved = sanitizeTurn({ reply: 'Referências mantidas.', operations: [update] }, project).operations[0].patch?.blocks;
    expect(preserved?.[0].url).toBe(reference.blocks[0].url);
    expect(preserved?.[1].url).toBe(reference.blocks[1].url);
    expect(preserved?.[2]).toMatchObject({ address: 'Rua da Oficina, 42', latitude: -30.1234, longitude: -51.4321 });
    expect(preserved?.every(block => block.humanEdited === undefined)).toBe(true);
    update.patch.blocks[1] = { ...update.patch.blocks[1], url: 'https://invented.example/new-photo', humanEdited: true };
    expect(() => sanitizeTurn({ reply: 'Atualizado.', operations: [update] }, project)).toThrow(/procedência/);
  });
  it('does not authorize generated links or coordinates from a different human card', () => {
    const project = createProject('Uma ideia em Porto Alegre.'); project.context.city = 'Porto Alegre';
    const manual = makeCard('note', 'Meu local', 'Fornecido pela pessoa.', [
      { id: 'manual-link', type: 'link', url: 'https://manual.example/private-reference' },
      { id: 'manual-place', type: 'location', latitude: -30.1234, longitude: -51.4321 },
    ]);
    manual.origin = 'user'; project.cards.push(manual);
    const generated = makeCard('note', 'Pesquisa', 'Outro cartão.', [{ id: 'generated-link', type: 'link', url: manual.blocks[0].url, humanEdited: true }]);
    expect(() => sanitizeTurn({ reply: 'Organizado.', operations: [{ op: 'add', cardId: generated.id, card: generated }] }, project)).toThrow(/procedência/);
    generated.blocks = [{ id: 'generated-place', type: 'location', address: 'Porto Alegre', latitude: manual.blocks[1].latitude, longitude: manual.blocks[1].longitude, humanEdited: true }];
    const location = sanitizeTurn({ reply: 'Local informado.', operations: [{ op: 'add', cardId: generated.id, card: generated }] }, project).operations[0].card?.blocks[0];
    expect(location?.address).toBe('Porto Alegre');
    expect(location?.latitude).toBeUndefined(); expect(location?.longitude).toBeUndefined();
  });
});

describe('visible tool execution and ordered publications', () => {
  it('acknowledges a running activity before executing and completes the same ID afterward', async () => {
    const states: string[] = []; const activities: AgentActivity[] = [];
    const result = await runToolActivity({ onActivity: async activity => { await Promise.resolve(); activities.push(activity); states.push(activity.state); } }, 'read_project_item', 'Ler anotação: Convite', async () => { expect(states).toEqual(['running']); states.push('execute'); return { found: true }; }, ['card-invite']);
    expect(result.found).toBe(true); expect(states).toEqual(['running', 'execute', 'completed']);
    expect(activities[0].id).toBe(activities[1].id); expect(activities[0].cardIds).toEqual(['card-invite']);
    expect(activities[1].label).toBe('Ler anotação: Convite');
  });
  it('closes both reported failures and thrown errors without leaking error payloads', async () => {
    const activities: AgentActivity[] = []; const options = { onActivity: (activity: AgentActivity) => { activities.push(activity); } };
    await runToolActivity(options, 'search_web', 'Pesquisar fontes', async () => ({ status: 'unavailable' }));
    expect(activities.map(activity => activity.state)).toEqual(['running', 'failed']);
    activities.length = 0;
    await expect(runToolActivity(options, 'publish_canvas', 'Salvar anotação: Teste', async () => { throw new Error('private provider payload'); })).rejects.toThrow('private provider payload');
    expect(activities.map(activity => activity.state)).toEqual(['running', 'failed']);
    expect(JSON.stringify(activities)).not.toContain('private provider payload');
  });
  it('publishes one card at a time with prerequisites first and preserves specific names', async () => {
    const project = createProject('Aulas de desenho');
    const hypothesis = makeCard('hypothesis', 'Iniciantes travam na primeira folha', 'Hipótese a investigar.', []);
    const action = makeCard('action', 'Ouvir a última experiência de desenho', 'Teste específico.', [], 'now');
    const result = sanitizeTurn({ reply: 'Organizado.', operations: [{ op: 'add', cardId: action.id, card: action }, { op: 'add', cardId: hypothesis.id, card: hypothesis }] }, project);
    expect(result.operations[0].card?.dependsOn).toEqual([hypothesis.id]);
    expect(result.operations[1].card?.dependsOn).toEqual([project.cards[0].id]);
    const deltas: CanvasDelta[] = []; const activities: AgentActivity[] = []; let saved = project;
    await publishCanvasSequentially({ operations: result.operations, sources: [] }, project, async delta => { deltas.push(delta); saved = applyTurn(saved, { ...delta, reply: 'Atualização de teste.', mode: 'live' }, saved.context); saved.messages = []; return saved; }, { onActivity: activity => { activities.push(activity); } });
    expect(deltas.map(delta => delta.operations.map(operation => operation.cardId))).toEqual([[hypothesis.id], [action.id]]);
    expect(activities.filter(activity => activity.state === 'completed').map(activity => activity.label)).toEqual(['Salvar anotação: Iniciantes travam na primeira folha', 'Salvar anotação: Ouvir a última experiência de desenho']);
    expect(auditDependencyGraph(saved.cards).valid).toBe(true);
    expect(saved.cards.find(card => card.id === action.id)?.dependsOn).toEqual([hypothesis.id]);
  });
  it('keeps action priority changes in one reviewable group', () => {
    const project = createProject('Aulas de desenho');
    const current = makeCard('action', 'Ouvir iniciantes', 'Ação atual.', [], 'now'); project.cards.push(current);
    const replacement = makeCard('action', 'Testar a aula piloto', 'Ação proposta.', [], 'now');
    const delta: CanvasDelta = { operations: [{ op: 'update', cardId: current.id, expectedRevision: 0, patch: { lane: 'next' } }, { op: 'add', cardId: replacement.id, card: replacement }], sources: [] };
    expect(splitCanvasPublication(delta, project)).toHaveLength(1);
    expect(splitCanvasPublication(delta, project)[0].operations).toHaveLength(2);
  });
  it('keeps a valid reversal of existing connections atomic, avoiding a temporary cycle', async () => {
    const project = createProject('Aulas de desenho');
    const second = makeCard('note', 'B: material de base', '', []);
    const first = makeCard('note', 'A: documento dependente', '', [], 'next', [second.id]); project.cards.push(first, second);
    const corrected = sanitizeTurn({ reply: 'Relações corrigidas.', operations: [{ op: 'update', cardId: second.id, expectedRevision: 0, patch: { dependsOn: [first.id] } }, { op: 'update', cardId: first.id, expectedRevision: 0, patch: { dependsOn: [] } }] }, project);
    const publications: CanvasDelta[] = []; const activities: AgentActivity[] = [];
    const saved = await publishCanvasSequentially({ operations: corrected.operations, sources: [] }, project, async delta => { publications.push(delta); const result = applyTurn(project, { ...delta, reply: 'Revisão de teste.', mode: 'live' }, project.context); result.messages = []; return result; }, { onActivity: activity => { activities.push(activity); } });
    expect(publications).toHaveLength(1); expect(publications[0].operations).toHaveLength(2);
    expect(saved.cards.find(card => card.id === first.id)?.dependsOn).toEqual([]);
    expect(saved.cards.find(card => card.id === second.id)?.dependsOn).toEqual([first.id]);
    expect(auditDependencyGraph(saved.cards).valid).toBe(true);
    expect(activities[0].label).toBe('Atualizar conexões: B: material de base · A: documento dependente');
  });
  it.each([false, true])('rebases only its own revision changes, preserving concurrent human content (%s)', async humanEdit => {
    const project = createProject('Aulas de desenho');
    const action = makeCard('action', 'Convidar iniciantes', 'Ação original.', [], 'now'); project.cards.push(action);
    const resource = makeCard('note', 'Recursos do teste', 'Usar R$ 300.', []);
    const delta: CanvasDelta = { contextPatch: { budget: 'R$ 300' }, operations: [{ op: 'add', cardId: resource.id, card: resource }, { op: 'update', cardId: action.id, expectedRevision: 0, patch: { summary: 'Convide antes de investir.' } }], sources: [] };
    let latest = project; let calls = 0;
    const saved = await publishCanvasSequentially(delta, project, async step => {
      const updated = applyTurn(latest, { ...step, reply: 'Atualização de teste.', mode: 'live' }, latest.context); updated.messages = []; latest = updated;
      if (++calls === 1 && humanEdit) latest = applyHumanEdit(latest, latest.cards.map(card => card.id === action.id ? { ...card, summary: 'Texto escrito pela pessoa durante a geração.' } : card));
      return latest;
    });
    expect(saved.cards.find(card => card.id === action.id)?.summary).toBe(humanEdit ? 'Texto escrito pela pessoa durante a geração.' : 'Convide antes de investir.');
    expect(saved.proposals).toHaveLength(humanEdit ? 1 : 0);
    expect(saved.cards.filter(card => card.id === resource.id)).toHaveLength(1);
  });
});

describe('coherent AI canvas relations', () => {
  const add = (card: CanvasCard) => ({ op: 'add' as const, cardId: card.id, card });
  it('connects research, evidence and decisions only to actual relevant prerequisites', () => {
    const project = createProject('Aulas de desenho');
    const hypothesis = makeCard('hypothesis', 'Iniciantes sem rotina', '', []); const action = makeCard('action', 'Ouvir iniciantes', '', [], 'now');
    const research = makeCard('research', 'Fontes sobre a rotina', '', []); const evidence = makeCard('evidence', 'Relatos das conversas', '', []); const decision = makeCard('decision', 'Escolher o próximo teste', '', []);
    const result = sanitizeTurn({ reply: 'Organizado.', operations: [hypothesis, action, research, evidence, decision].map(add) }, project);
    expect(result.operations.map(operation => operation.card?.dependsOn)).toEqual([[project.cards[0].id], [hypothesis.id], [hypothesis.id], [action.id], [evidence.id]]);
    expect(auditDependencyGraph([...project.cards, ...result.operations.map(operation => operation.card!)]).valid).toBe(true);
    const loneDecision = sanitizeTurn({ reply: 'Rascunho.', operations: [add(makeCard('decision', 'Decisão a investigar', '', []))] }, project);
    expect(loneDecision.operations[0].card?.dependsOn).toEqual([]);
  });
  it('rejects nonexistent prerequisites, self references and cycles rather than hiding them', () => {
    const project = createProject('Aulas de desenho'); const card = makeCard('hypothesis', 'Hipótese', '', []);
    card.dependsOn = ['invented']; expect(() => sanitizeTurn({ reply: 'Plano.', operations: [add(card)] }, project)).toThrow(/não está mais/);
    card.dependsOn = [card.id]; expect(() => sanitizeTurn({ reply: 'Plano.', operations: [add(card)] }, project)).toThrow(/dele mesmo/);
    const other = makeCard('action', 'Teste', '', []); card.dependsOn = [other.id]; other.dependsOn = [card.id];
    expect(() => sanitizeTurn({ reply: 'Plano.', operations: [add(card), add(other)] }, project)).toThrow(/ciclo/);
  });
  it('preserves human connections and leaves ambiguous automatic action links absent', () => {
    const project = createProject('Aulas de desenho');
    const first = makeCard('hypothesis', 'Rotina', '', []); const second = makeCard('hypothesis', 'Materiais', '', []); project.cards.push(first, second);
    const human = makeCard('note', 'Conexão feita pela pessoa', '', [], 'next', [second.id]); human.humanEdited = true; project.cards.push(human);
    const result = sanitizeTurn({ reply: 'Ampliado.', operations: [{ op: 'update', cardId: human.id, patch: { dependsOn: [], summary: 'Novo parágrafo.' } }, add(makeCard('action', 'Investigar a ideia', '', []))] }, project);
    expect(result.operations[0].patch?.dependsOn).toEqual([second.id]); expect(result.operations[1].card?.dependsOn).toEqual([]);
    expect(project.cards.find(card => card.id === human.id)?.dependsOn).toEqual([second.id]);
  });
  it('allows explicit correction or removal of AI-owned relations without inventing a replacement', () => {
    const project = createProject('Aulas de desenho');
    const first = makeCard('hypothesis', 'Rotina', '', []); const second = makeCard('hypothesis', 'Materiais', '', []);
    const action = makeCard('action', 'Investigar materiais', '', [], 'now', [first.id]); project.cards.push(first, second, action);
    const corrected = sanitizeTurn({ reply: 'Corrigido.', operations: [{ op: 'update', cardId: action.id, patch: { dependsOn: [second.id] } }] }, project);
    expect(corrected.operations[0].patch?.dependsOn).toEqual([second.id]);
    const removed = sanitizeTurn({ reply: 'Removido.', operations: [{ op: 'update', cardId: action.id, patch: { dependsOn: [] } }] }, project);
    expect(removed.operations[0].patch?.dependsOn).toEqual([]);
  });
  it('connects resource documents to context and focused notes to their actual conversation', () => {
    const project = createProject('Aulas de desenho');
    const resources = makeCard('note', 'Recursos e limites do teste', 'Orçamento informado de R$ 300.', []);
    expect(sanitizeTurn({ reply: 'Registrado.', operations: [add(resources)] }, project).operations[0].card?.dependsOn).toEqual([project.cards[0].id]);
    const action = makeCard('action', 'Convidar para a aula', '', [], 'now'); project.cards.push(action);
    const invitation = makeCard('note', 'Texto do convite para a aula', '', []);
    expect(sanitizeTurn({ reply: 'Convite preparado.', operations: [add(invitation)] }, project, [], action.id).operations[0].card?.dependsOn).toEqual([action.id]);
  });
});

describe('completed research requires a grounded synthesis', () => {
  const findings = () => ({ title: 'O que investigar antes de comprar materiais', summary: 'Orientações recuperadas para organizar conversas antes de investir, com limites claros do que ainda não sabemos.', findings: [{ text: 'A fonte consultada orienta investigar comportamentos recentes antes de investir, usando as respostas como ponto de partida para um teste pequeno, sem declarar a demanda comprovada.', sourceIds: [source.id] }], implications: 'Para este cenário fictício, a orientação sugere conversar sobre a última compra antes de escolher estoque. Essa aplicação é uma inferência para o projeto.', limitations: 'A consulta não oferece preços locais, fornecedores ou prova de demanda. Esses pontos precisam de nova evidência e não podem ser tratados como fatos confirmados.' });
  const setupResearch = () => {
    const project = createProject('Cenário fictício de aulas de desenho');
    const actualSource = { ...source, imageUrl: 'https://example.org/reference-photo.webp' };
    const note = makeCard('research', 'Fontes em análise', 'Fontes recuperadas; síntese ainda não concluída.', [
      { id: 'live-research-description', type: 'paragraph', text: 'Referências recuperadas, análise ainda não concluída.', sourceIds: [source.id] },
      { id: 'live-research-sources', type: 'sources', sourceIds: [source.id] },
      { id: 'live-research-link', type: 'link', url: source.url, sourceIds: [source.id] },
      { id: 'live-research-image', type: 'image', url: actualSource.imageUrl, alt: 'Imagem retornada pelo provedor', sourceIds: [source.id] },
      { id: 'live-research-location', type: 'location', address: 'Porto Alegre' },
    ]);
    project.context.city = 'Porto Alegre'; project.cards.push(note); project.sources.push(actualSource);
    return { project, note, actualSource };
  };
  it('rejects a success claim backed only by automatically published sources', () => {
    const { project, note, actualSource } = setupResearch();
    const claimed: TurnResult = { reply: 'Preparei a síntese no canvas.', operations: [], sources: [actualSource], mode: 'live' };
    expect(hasResearchSynthesis(note, [actualSource])).toBe(false);
    expect(() => ensureResearchSynthesis(claimed, project, [actualSource], note.id)).toThrow(/sem síntese/);
  });
  it('maps model-written findings to the same note while preserving real media and location', () => {
    const { project, note, actualSource } = setupResearch();
    const operation = buildResearchSummaryOperation(project, note.id, findings(), [actualSource]);
    const result = sanitizeTurn({ reply: 'Síntese preparada.', operations: [operation] }, project, [actualSource]);
    expect(result.operations[0].cardId).toBe(note.id);
    expect(operation.patch?.blocks?.find(block => block.id === 'live-research-image')?.url).toBe(actualSource.imageUrl);
    expect(operation.patch?.blocks?.find(block => block.id === 'live-research-location')?.address).toBe('Porto Alegre');
    expect(operation.patch?.blocks?.some(block => block.id === 'live-research-description')).toBe(false);
    expect(() => ensureResearchSynthesis(result, project, [actualSource], note.id)).not.toThrow();
    const saved = applyTurn(project, result);
    expect(saved.cards).toHaveLength(project.cards.length); expect(hasResearchSynthesis(saved.cards.find(card => card.id === note.id), [actualSource])).toBe(true);
  });
  it('keeps human-edited synthesis as a proposal and rejects invented source IDs', () => {
    const { project, note, actualSource } = setupResearch(); note.humanEdited = true;
    const operation = buildResearchSummaryOperation(project, note.id, findings(), [actualSource]);
    const saved = applyTurn(project, { reply: 'Proposta de síntese.', operations: [operation], sources: [actualSource], mode: 'live' });
    expect(saved.cards.find(card => card.id === note.id)?.summary).toBe(note.summary); expect(saved.proposals).toHaveLength(1);
    expect(() => ensureResearchSynthesis({ reply: 'Revise a proposta.', operations: [], sources: [], mode: 'live' }, saved, [actualSource], note.id)).not.toThrow();
    const invented = findings(); invented.findings[0].sourceIds = ['invented'];
    expect(() => buildResearchSummaryOperation(project, note.id, invented, [actualSource])).toThrow(/fonte inexistente/);
  });
  it('preserves source attribution from list items and rejects fake references in those items', () => {
    const project = createProject('Cenário de teste');
    const card = makeCard('research', 'Referências do teste', 'Pesquisa organizada com fontes reais e limites claros.', []);
    const input = { reply: 'Organizado.', operations: [{ op: 'add', cardId: card.id, card: { ...card, blocks: [{ id: 'finding-list', type: 'list', items: [{ text: 'Uma orientação da fonte que ajuda a organizar o teste antes de investir recursos, sem inferir demanda confirmada.', sourceIds: [source.id] }] }] } }] };
    const block = sanitizeTurn(input, project, [source]).operations[0].card?.blocks[0];
    expect(block?.sourceIds).toEqual([source.id]); expect(block?.items?.[0].checked).toBe(false);
    input.operations[0].card.blocks[0].items[0].sourceIds = ['invented'];
    expect(() => sanitizeTurn(input, project, [source])).toThrow(/fonte inexistente/);
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
