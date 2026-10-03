import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHumanEdit, applyTurn, makeCard } from '../shared/domain';
import type { CanvasDelta, Project, StreamEvent, TurnResult } from '../shared/types';
import type { TurnOptions } from '../server/ai';

vi.mock('../server/ai', async importOriginal => ({ ...await importOriginal<typeof import('../server/ai')>(), generateTurn: vi.fn() }));
import { generateTurn } from '../server/ai';
import { app } from '../server/app';
import * as store from '../server/store';

const model = vi.mocked(generateTurn);
const request = (path: string, token: string, body?: unknown) => app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const response = (operations: TurnResult['operations'] = []): TurnResult => ({ reply: 'Resposta final de teste.', operations, sources: [], mode: 'live' });
const card = () => makeCard('note', 'Documento sintético', 'Conteúdo salvo durante a geração.', [{ id: crypto.randomUUID(), type: 'paragraph', text: 'Este documento tem conteúdo sintético suficiente para verificar a publicação real antes da resposta final.' }]);
const events = async (result: Response): Promise<StreamEvent[]> => (await result.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)) as StreamEvent);
const setup = async () => {
  const token = `local_${crypto.randomUUID()}`;
  const project = await (await request('/api/projects', token, { idea: 'Projeto inteiramente fictício de aulas de desenho' })).json() as Project;
  const session = await store.session(new Request('http://localhost/api', { headers: { authorization: `Bearer ${token}` } }));
  return { token, project, session };
};

beforeEach(() => { vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', ''); vi.stubEnv('VERCEL', ''); model.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('persisted incremental SSE', () => {
  it('acknowledges cancellation before reserve and prevents that run ID from starting later', async () => {
    const { token, project } = await setup(); const runId = crypto.randomUUID();
    const cancel = await app.request(`/api/projects/${project.id}/runs/${runId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(cancel.status).toBe(202);
    expect(await cancel.json()).toEqual({ ok: true });

    const attempted = await request(`/api/projects/${project.id}/messages`, token, { text: 'Não deve começar.', runId });
    expect(attempted.status).toBe(409);
    expect(await attempted.json()).toMatchObject({ code: 'RUN_ALREADY_PROCESSED' });
    expect(model).not.toHaveBeenCalled();
  });

  it('uses the durable cancel endpoint and keeps the lock until the active stream finishes', async () => {
    const { token, project, session } = await setup();
    let releaseGeneration!: (result: TurnResult) => void; let markGenerationStarted!: () => void; let activeSignal!: AbortSignal;
    const generationStarted = new Promise<void>(resolve => { markGenerationStarted = resolve; });
    model.mockImplementationOnce(async (_project, _text, options = {}) => {
      activeSignal = options.signal!; markGenerationStarted();
      return new Promise<TurnResult>(resolve => { releaseGeneration = resolve; });
    });
    const runId = crypto.randomUUID();
    const streamResponse = await request(`/api/projects/${project.id}/messages`, token, { text: 'Preparar o teste.', runId });
    const reader = streamResponse.body!.getReader();
    const streamDone = (async () => { for (;;) if ((await reader.read()).done) return; })();
    await generationStarted;

    const cancel = await app.request(`/api/projects/${project.id}/runs/${runId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(cancel.status).toBe(202);
    expect(await cancel.json()).toEqual({ ok: true });
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true), { timeout: 2000 });
    await expect(store.reserveRun(session, project.id, crypto.randomUUID())).rejects.toMatchObject({ status: 409, code: 'RUN_BUSY' });

    releaseGeneration(response());
    await streamDone;
    expect((await store.get(session, project.id)).messages.map(message => message.role)).toEqual(['user']);
    const resumeRunId = crypto.randomUUID();
    expect(await store.reserveRun(session, project.id, resumeRunId)).toBe(true);
    await store.finishRun(session, resumeRunId, project.id, 'complete');
  });

  it('releases a reserved run when the request aborts while its initial save is pending', async () => {
    const { token, project, session } = await setup();
    let releaseSave!: () => void; let markSaveEntered!: () => void;
    const saveEntered = new Promise<void>(resolve => { markSaveEntered = resolve; });
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const finishStatuses: string[] = [];
    const originalSave = store.save.bind(store); const originalFinish = store.finishRun.bind(store);
    const saveSpy = vi.spyOn(store, 'save').mockImplementation(async (storeSession, next, expected) => {
      markSaveEntered(); await saveGate; return originalSave(storeSession, next, expected);
    });
    const finishSpy = vi.spyOn(store, 'finishRun').mockImplementation(async (storeSession, runId, projectId, status, usage) => {
      finishStatuses.push(status); return originalFinish(storeSession, runId, projectId, status, usage);
    });
    const abort = new AbortController(); const runId = crypto.randomUUID();
    try {
      const pending = app.fetch(new Request(`http://localhost/api/projects/${project.id}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Preparar o primeiro teste.', runId }), signal: abort.signal,
      }));
      await saveEntered;
      abort.abort(); releaseSave();
      const response = await pending;

      expect(response.status).toBe(499);
      expect(model).not.toHaveBeenCalled();
      expect(finishStatuses).toEqual(['cancelled']);
      const resumeRunId = crypto.randomUUID();
      expect(await store.reserveRun(session, project.id, resumeRunId)).toBe(true);
      await store.finishRun(session, resumeRunId, project.id, 'complete');
    } finally {
      releaseSave(); saveSpy.mockRestore(); finishSpy.mockRestore();
    }
  });

  it('keeps an idle SSE connection alive with comments and clears its heartbeat after completion', async () => {
    vi.useFakeTimers();
    const { token, project } = await setup();
    let release!: (result: TurnResult) => void;
    model.mockImplementationOnce(() => new Promise<TurnResult>(resolve => { release = resolve; }));
    const result = await request(`/api/projects/${project.id}/messages`, token, { text: 'Pergunta de teste.', runId: crypto.randomUUID() });
    const reader = result.body!.getReader(); const waiting = reader.read();
    await vi.advanceTimersByTimeAsync(10000);
    const heartbeat = await waiting; const decoder = new TextDecoder();
    expect(decoder.decode(heartbeat.value)).toBe(': keep-alive\n\n');
    release(response());
    let body = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; body += decoder.decode(chunk.value); }
    expect(body).toContain('"type":"complete"'); expect(vi.getTimerCount()).toBe(0);
  });
  it('persists a publication before streaming text, with monotonic versions and no synthetic assistant', async () => {
    const { token, project } = await setup();
    model.mockImplementationOnce(async (_project, _text, options: TurnOptions = {}) => {
      const document = card(); const delta: CanvasDelta = { operations: [{ op: 'add', cardId: document.id, card: document }], sources: [] };
      const saved = await options.onDelta!(delta) as Project;
      expect(saved.cards.some(candidate => candidate.id === document.id)).toBe(true);
      expect(saved.messages.filter(message => message.role === 'assistant')).toHaveLength(0);
      // Replayed callbacks do not create another revision, card or project event.
      expect((await options.onDelta!(delta) as Project).version).toBe(saved.version);
      await options.onText!('Resposta '); await options.onText!('final de teste.');
      return response();
    });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Organize esse teste.', runId: crypto.randomUUID() }));
    const publication = result.find(event => event.type === 'project');
    const complete = result.find(event => event.type === 'complete');
    expect(result.filter(event => event.type === 'project')).toHaveLength(1);
    expect(result.findIndex(event => event.type === 'project')).toBeLessThan(result.findIndex(event => event.type === 'text'));
    expect(result.filter(event => event.type === 'text').map(event => event.type === 'text' ? event.text : '').join('')).toBe('Resposta final de teste.');
    expect(publication?.type === 'project' && publication.changedCardIds).toHaveLength(1);
    expect(publication?.type === 'project' && publication.label).toBe('Criado: Documento sintético');
    expect(publication?.type === 'project' && publication.project.version).toBe(2);
    expect(complete?.type === 'complete' && complete.project.version).toBe(3);
    const loaded = await (await request(`/api/projects/${project.id}`, token)).json() as Project;
    expect(loaded.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(loaded.cards).toHaveLength(2);
  });

  it('preserves concurrent human edits and holds stale updates as reviewable proposals', async () => {
    const { token, project, session } = await setup();
    model.mockImplementationOnce(async (initial, _text, options: TurnOptions = {}) => {
      const latest = await store.get(session, project.id);
      const edited = applyHumanEdit(latest, latest.cards.map(document => ({ ...document, title: 'Título escrito pela pessoa' })), { ...latest.context, budget: 'R$ 30, limite corrigido' });
      await store.save(session, edited, latest.version);
      const saved = await options.onDelta!({ contextPatch: { budget: 'R$ 300, valor anterior' }, operations: [{ op: 'update', cardId: initial.cards[0].id, expectedRevision: initial.cards[0].revision, patch: { title: 'Título da IA' } }], sources: [] }) as Project;
      expect(saved.cards[0].title).toBe('Título escrito pela pessoa');
      expect(saved.context.budget).toBe('R$ 30, limite corrigido');
      expect(saved.proposals).toHaveLength(1);
      return response();
    });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Amplie o documento.', runId: crypto.randomUUID() }));
    const complete = result.find(event => event.type === 'complete');
    expect(complete?.type === 'complete' && complete.project.cards[0].title).toBe('Título escrito pela pessoa');
    expect(complete?.type === 'complete' && complete.project.context.budget).toBe('R$ 30, limite corrigido');
    const publication = result.find(event => event.type === 'project');
    expect(publication?.type === 'project' && publication.label).toBe('Proposta: Título da IA');
    expect(publication?.type === 'project' && publication.changedCardIds).toEqual([]);
  });

  it('materializes final operations before text when the model omitted its publication tool', async () => {
    const { token, project } = await setup();
    const document = card();
    model.mockResolvedValueOnce({ ...response([{ op: 'add', cardId: document.id, card: document }]), contextPatch: { budget: 'R$ 300' }, sources: [{ id: 'tool-source', title: 'Fonte sintética', url: 'https://example.org/source', excerpt: 'Trecho de teste.', verified: true, consultedAt: new Date().toISOString() }] });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Organize esse teste.', runId: crypto.randomUUID() }));
    expect(result.findIndex(event => event.type === 'project')).toBeLessThan(result.findIndex(event => event.type === 'text'));
    const loaded = await (await request(`/api/projects/${project.id}`, token)).json() as Project;
    expect(loaded.cards.filter(candidate => candidate.id === document.id)).toHaveLength(1);
    expect(loaded.messages.at(-1)?.sourceIds).toEqual(['tool-source']);
    expect(loaded.context.budget).toBe('R$ 300');
  });

  it('retains already-published documents when the remainder of the generation fails', async () => {
    const { token, project } = await setup(); const document = card(); const runId = crypto.randomUUID();
    model.mockImplementationOnce(async (_project, _text, options: TurnOptions = {}) => { await options.onDelta!({ operations: [{ op: 'add', cardId: document.id, card: document }], sources: [] }); throw new Error('synthetic provider failure'); });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Prepare o teste.', runId }));
    expect(result.some(event => event.type === 'project')).toBe(true);
    expect(result.some(event => event.type === 'error')).toBe(true);
    const loaded = await (await request(`/api/projects/${project.id}`, token)).json() as Project;
    expect(loaded.cards.some(candidate => candidate.id === document.id)).toBe(true);
    expect(loaded.messages.map(message => message.role)).toEqual(['user']);
    expect((await request(`/api/projects/${project.id}/messages`, token, { text: 'Prepare o teste.', runId })).status).toBe(409);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it('reports ordered individual cards and concrete labels when final output omitted publication', async () => {
    const { token, project } = await setup(); const first = card(); const second = { ...card(), title: 'Segundo documento', dependsOn: [first.id] };
    model.mockResolvedValueOnce(response([{ op: 'add', cardId: second.id, card: second }, { op: 'add', cardId: first.id, card: first }]));
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Organize os dois documentos.', runId: crypto.randomUUID() }));
    const publications = result.filter((event): event is Extract<StreamEvent, { type: 'project' }> => event.type === 'project');
    expect(publications.map(event => event.label)).toEqual(['Criado: Documento sintético', 'Criado: Segundo documento']);
    expect(publications.map(event => event.changedCardIds)).toEqual([[first.id], [second.id]]);
    expect(publications[0].project.cards.some(card => card.id === second.id)).toBe(false);
    expect(publications[1].project.cards.find(card => card.id === second.id)?.dependsOn).toEqual([first.id]);
    const activities = result.filter((event): event is Extract<StreamEvent, { type: 'activity' }> => event.type === 'activity');
    expect(activities.map(event => event.state)).toEqual(['running', 'completed', 'running', 'completed']);
    expect(activities[0].id).toBe(activities[1].id);
  });

  it('highlights a referenced annotation when only its retrieved source is enriched', async () => {
    const { token, project, session } = await setup();
    const reference = { id: 'actual-source', title: 'Fonte consultada', url: 'https://example.org/reference', excerpt: 'Trecho inicial.', verified: true, consultedAt: new Date().toISOString() };
    const document = { ...card(), blocks: [{ id: 'refs', type: 'sources' as const, sourceIds: [reference.id] }] };
    const prepared = applyTurn(project, { ...response([{ op: 'add', cardId: document.id, card: document }]), sources: [reference] });
    await store.save(session, prepared, project.version);
    const enriched = { ...reference, excerpt: 'Trecho ampliado depois da extração.' };
    model.mockImplementationOnce(async (_project, _text, options = {}) => { await options.onDelta!({ operations: [], sources: [enriched] }); return { ...response(), sources: [enriched] }; });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Confira a fonte.', runId: crypto.randomUUID() }));
    const publication = result.find(event => event.type === 'project');
    expect(publication?.type === 'project' && publication.changedCardIds).toEqual([document.id]);
    expect(publication?.type === 'project' && publication.label).toBe('Fontes e referências atualizadas');
  });

  it('closes running activities before reporting a failed generation', async () => {
    const { token, project } = await setup();
    model.mockImplementationOnce(async (_project, _text, options = {}) => { await options.onActivity!({ id: 'running-search', tool: 'search_web', label: 'Pesquisar fontes', state: 'running' }); throw new Error('private synthetic provider failure'); });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Pesquise o assunto.', runId: crypto.randomUUID() }));
    const activityEvents = result.filter(event => event.type === 'activity');
    expect(activityEvents.map(event => event.type === 'activity' && event.state)).toEqual(['running', 'failed']);
    expect(result.findIndex(event => event.type === 'activity' && event.state === 'failed')).toBeLessThan(result.findIndex(event => event.type === 'error'));
    expect(JSON.stringify(result)).not.toContain('private synthetic provider failure');
  });

  it('protects human context across later deltas while allowing its own context updates to advance', async () => {
    const { token, project, session } = await setup();
    const budget = applyHumanEdit(project, project.cards, { ...project.context, budget: 'R$ 100' }); await store.save(session, budget, project.version);
    model.mockImplementationOnce(async (_initial, _text, options = {}) => {
      const latest = await store.get(session, project.id);
      const human = applyHumanEdit(latest, latest.cards, { ...latest.context, budget: 'R$ 300' }); await store.save(session, human, latest.version);
      const first = await options.onDelta!({ contextPatch: { budget: 'R$ 100', city: 'Porto Alegre' }, operations: [], sources: [] }) as Project;
      expect(first.context.budget).toBe('R$ 300'); expect(first.context.city).toBe('Porto Alegre');
      const second = await options.onDelta!({ contextPatch: { budget: 'R$ 100', city: 'Canoas' }, operations: [], sources: [] }) as Project;
      expect(second.context.budget).toBe('R$ 300'); expect(second.context.city).toBe('Canoas');
      return response();
    });
    const result = await events(await request(`/api/projects/${project.id}/messages`, token, { text: 'Atualize o contexto.', runId: crypto.randomUUID() }));
    const complete = result.find(event => event.type === 'complete');
    expect(complete?.type === 'complete' && complete.project.context.budget).toBe('R$ 300');
    expect(complete?.type === 'complete' && complete.project.context.city).toBe('Canoas');
  });
});
