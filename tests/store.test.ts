import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, TurnResult } from '../shared/types';
import { createProject, makeCard } from '../shared/domain';

vi.mock('../server/ai', () => ({ generateTurn: vi.fn(async (): Promise<TurnResult> => ({ reply: 'Resposta de teste, sem provedores externos.', operations: [], sources: [], mode: 'fallback' })) }));

import { app } from '../server/app';
import * as store from '../server/store';

const owner = () => `local_${globalThis.crypto.randomUUID()}`;
const authorization = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const request = (path: string, token: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: authorization(token), body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => { vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', ''); vi.stubEnv('VERCEL', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('guest API and local store', () => {
  it('requires a valid guest session for every project endpoint', async () => {
    const missing = await app.request('/api/projects');
    expect(missing.status).toBe(401);
    const invalid = await request('/api/projects', 'not-a-session');
    expect(invalid.status).toBe(401);
    const malformed = await request('/api/projects', 'local_000000000000000000000000000000000000');
    // Non-UUID identifiers must not become a new local identity.
    expect(malformed.status).toBe(401);
  });

  it('does not expose local persistence on a public deployment without Supabase', async () => {
    vi.stubEnv('VERCEL', '1');
    const response = await request('/api/projects', owner());
    expect(response.status).toBe(503);
  });

  it('enforces the API body cap when Content-Length is absent', async () => {
    const response = await app.request('/api/projects', {
      method: 'POST', headers: authorization(owner()), body: JSON.stringify({ idea: 'x'.repeat(1_500_001) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'O projeto é muito grande para esta operação.' });
  });

  it('accepts a schema-valid import larger than 1.5 MB up to the 3 MB import limit', async () => {
    const token = owner(); const project = createProject('Projeto importado grande');
    const largeCards = Array.from({ length: 2 }, (_, cardIndex) => makeCard('note', `Documento ${cardIndex + 1}`, 'Texto grande válido.',
      Array.from({ length: 50 }, () => ({ id: crypto.randomUUID(), type: 'paragraph' as const, text: 'x'.repeat(15_500) }))));
    const body = { ...project, cards: [...project.cards, ...largeCards] };
    expect(JSON.stringify(body).length).toBeGreaterThan(1_500_000);
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(3_000_000);

    const response = await request('/api/projects/import', token, 'POST', body);
    expect(response.status).toBe(201);
    const imported = await response.json() as Project;
    expect(imported.cards).toHaveLength(3);
    expect(imported.cards[1].blocks).toHaveLength(50);
  });

  it('accepts a schema-valid canvas save larger than 1.5 MB up to the 3 MB limit', async () => {
    const token = owner();
    const project = await (await request('/api/projects', token, 'POST', { idea: 'Projeto para um canvas grande' })).json() as Project;
    const largeCards = Array.from({ length: 2 }, (_, cardIndex) => makeCard('note', `Documento ${cardIndex + 1}`, 'Texto grande válido.',
      Array.from({ length: 50 }, () => ({ id: crypto.randomUUID(), type: 'paragraph' as const, text: 'x'.repeat(15_500) }))));
    const body = { ...project, cards: [...project.cards, ...largeCards] };
    expect(JSON.stringify(body).length).toBeGreaterThan(1_500_000);
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(3_000_000);

    const response = await request(`/api/projects/${project.id}/canvas`, token, 'PATCH', body);
    expect(response.status).toBe(200);
    expect((await response.json() as Project).cards).toHaveLength(3);
  });

  it('rejects an import over 3 MB with an explicit import-size message', async () => {
    const token = owner(); const raw = `{"payload":"${'x'.repeat(3_000_001)}"}`;
    const response = await app.request('/api/projects/import', { method: 'POST', headers: authorization(token), body: raw });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'O arquivo do projeto excede o limite de 3 MB.' });
  });

  it('isolates visitors across read, write, delete, evidence and model turns', async () => {
    const a = owner(); const b = owner();
    const created = await request('/api/projects', a, 'POST', { idea: 'Uma escola de arte no bairro' });
    expect(created.status).toBe(201);
    const project = await created.json() as Project;
    expect(await (await request('/api/projects', b)).json()).toEqual([]);
    expect((await request(`/api/projects/${project.id}`, b)).status).toBe(404);
    expect((await request(`/api/projects/${project.id}`, b, 'DELETE')).status).toBe(404);
    expect((await request(`/api/projects/${project.id}/runs/${crypto.randomUUID()}/cancel`, b, 'POST')).status).toBe(404);
    expect((await request(`/api/projects/${project.id}/canvas`, b, 'PATCH', project)).status).toBe(404);
    expect((await request(`/api/projects/${project.id}/evidence`, b, 'POST', { text: 'Alguém contou uma experiência', type: 'interview' })).status).toBe(404);
    expect((await request(`/api/projects/${project.id}/messages`, b, 'POST', { text: 'Me ajude', runId: globalThis.crypto.randomUUID() })).status).toBe(404);
    expect((await request(`/api/projects/${project.id}`, a)).status).toBe(200);
  });

  it('rejects outdated saves instead of losing newer human edits', async () => {
    const token = owner();
    const created = await request('/api/projects', token, 'POST', { idea: 'Um clube de cinema' });
    const project = await created.json() as Project;
    const first = structuredClone(project); first.cards[0].title = 'Meu contexto atualizado';
    const firstResponse = await request(`/api/projects/${project.id}/canvas`, token, 'PATCH', first);
    expect(firstResponse.status).toBe(200);
    const stale = structuredClone(project); stale.cards[0].title = 'Texto da outra aba';
    const staleResponse = await request(`/api/projects/${project.id}/canvas`, token, 'PATCH', stale);
    expect(staleResponse.status).toBe(409);
    const saved = await (await request(`/api/projects/${project.id}`, token)).json() as Project;
    expect(saved.cards[0].title).toBe('Meu contexto atualizado');
    expect(saved.version).toBe(project.version + 1);
  });

  it('keeps snapshots independent from objects returned to callers', async () => {
    const session: store.StoreSession = { owner: owner() };
    const project = createProject('Uma biblioteca comunitária');
    await store.insert(session, project);
    project.title = 'Alterado sem salvar';
    const loaded = await store.get(session, project.id);
    expect(loaded.title).not.toBe('Alterado sem salvar');
    loaded.cards[0].title = 'Mudança não salva';
    expect((await store.get(session, project.id)).cards[0].title).not.toBe('Mudança não salva');
  });

  it('commits one of two simultaneous edits from the same revision', async () => {
    const token = owner();
    const created = await request('/api/projects', token, 'POST', { idea: 'Uma loja de instrumentos usados' });
    const project = await created.json() as Project;
    const a = { ...structuredClone(project), title: 'Edição da primeira aba' };
    const b = { ...structuredClone(project), title: 'Edição da segunda aba' };
    const responses = await Promise.all([request(`/api/projects/${project.id}/canvas`, token, 'PATCH', a), request(`/api/projects/${project.id}/canvas`, token, 'PATCH', b)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const saved = await (await request(`/api/projects/${project.id}`, token)).json() as Project;
    expect(['Edição da primeira aba', 'Edição da segunda aba']).toContain(saved.title);
    expect(saved.version).toBe(project.version + 1);
  });

  it('permits exactly three visitor projects', async () => {
    const token = owner();
    for (let i = 0; i < 3; i++) expect((await request('/api/projects', token, 'POST', { idea: `Meu projeto número ${i + 1}` })).status).toBe(201);
    expect((await request('/api/projects', token, 'POST', { idea: 'Um quarto projeto' })).status).toBe(429);
  });

  it('enforces the project cap when four creations arrive together', async () => {
    const s = { owner: owner() };
    const responses = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => store.insert(s, createProject(`Projeto concorrente ${i}`))));
    expect(responses.filter(response => response.status === 'fulfilled')).toHaveLength(3);
    expect((responses.find(response => response.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(429);
    expect(await store.list(s)).toHaveLength(3);
  });

  it('maps only the exact database project-cap error to 429', async () => {
    const sessionWithInsertError = (insertError: { code: string; message: string } | null): store.StoreSession => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
        insert: async () => ({ error: insertError }),
      };
      return { owner: owner(), db: { from: () => query } as unknown as store.StoreSession['db'] };
    };

    await expect(store.insert(sessionWithInsertError({ code: 'P0001', message: 'project limit reached' }), createProject('Limite Supabase')))
      .rejects.toMatchObject({ status: 429 });
    await expect(store.insert(sessionWithInsertError({ code: 'P0001', message: 'other database rule' }), createProject('Regra do banco')))
      .rejects.toMatchObject({ status: 503 });
    await expect(store.insert(sessionWithInsertError({ code: '08006', message: 'connection failure' }), createProject('Banco indisponível')))
      .rejects.toMatchObject({ status: 503 });
  });

  it('scopes every Supabase project query to its authenticated owner', async () => {
    const project = createProject('Projeto privado'); const filters: Array<[string, unknown]> = [];
    const query: Record<string, (...args: any[]) => any> = {};
    query.select = () => query; query.order = () => query; query.limit = async () => ({ data: [], error: null });
    query.eq = (column: string, value: unknown) => { filters.push([column, value]); return query; };
    query.maybeSingle = async () => ({ data: { document: project }, error: null });
    query.update = () => query; query.delete = () => query;
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: [{ id: project.id }], error: null }).then(resolve, reject);
    const s: store.StoreSession = { owner: 'authenticated-user-id', db: { from: () => query } as unknown as store.StoreSession['db'] };

    await store.list(s); await store.get(s, project.id); await store.save(s, { ...project, version: 1 }, 0); await store.remove(s, project.id);

    expect(filters.filter(([column]) => column === 'owner_id')).toHaveLength(5);
    expect(filters.filter(([column]) => column === 'owner_id').every(([, value]) => value === s.owner)).toBe(true);
  });

  it('surfaces unexpected quota RPC failures as storage outages', async () => {
    const sessionWithRpc = (rpcResult: { data: unknown; error: { code: string; message: string } | null }): store.StoreSession => ({
      owner: owner(), db: { rpc: async () => rpcResult } as unknown as store.StoreSession['db'],
    });

    await expect(store.reserveRun(sessionWithRpc({ data: null, error: { code: '08006', message: 'connection failure' } }), 'project-id', 'run-id'))
      .rejects.toMatchObject({ status: 503 });
    await expect(store.reserveRun(sessionWithRpc({ data: null, error: { code: 'P0001', message: 'daily limit reached' } }), 'project-id', 'run-id'))
      .rejects.toMatchObject({ status: 429 });
    await expect(store.reserveRun(sessionWithRpc({ data: null, error: { code: '55000', message: 'active run already exists' } }), 'project-id', 'run-id'))
      .rejects.toMatchObject({ status: 409 });
    await expect(store.reserveResearch(sessionWithRpc({ data: null, error: { code: '08006', message: 'connection failure' } }), 'run-id'))
      .rejects.toMatchObject({ status: 503 });
    await expect(store.reserveResearch(sessionWithRpc({ data: null, error: { code: 'P0001', message: 'research quota reached' } }), 'run-id'))
      .rejects.toMatchObject({ status: 503 });
  });

  it('allows one active generation per project and only matching completion unlocks it', async () => {
    const s = { owner: owner() }; const project = createProject('Uma agência de viagens');
    await store.insert(s, project);
    expect(await store.reserveRun(s, project.id, 'first-test-run')).toBe(true);
    await expect(store.reserveRun(s, project.id, 'second-test-run')).rejects.toMatchObject({ status: 409 });
    await store.finishRun(s, 'wrong-test-run', project.id, 'complete');
    await expect(store.reserveRun(s, project.id, 'second-test-run')).rejects.toMatchObject({ status: 409 });
    await store.finishRun(s, 'first-test-run', project.id, 'complete');
    expect(await store.reserveRun(s, project.id, 'second-test-run')).toBe(true);
    await store.finishRun(s, 'second-test-run', project.id, 'complete');
  });

  it('allows one winner when model requests race for the same project', async () => {
    const s = { owner: owner() }; const project = createProject('Uma plataforma de aulas');
    await store.insert(s, project);
    const responses = await Promise.allSettled([store.reserveRun(s, project.id, 'concurrent-run-one'), store.reserveRun(s, project.id, 'concurrent-run-two')]);
    expect(responses.filter(response => response.status === 'fulfilled')).toHaveLength(1);
    const failure = responses.find(response => response.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason.status).toBe(409);
    await store.finishRun(s, 'concurrent-run-one', project.id, 'complete');
    await store.finishRun(s, 'concurrent-run-two', project.id, 'complete');
  });

  it('does not rerun a known request, including after its response completes', async () => {
    const s = { owner: owner() }; const project = createProject('Uma rede de hortas');
    await store.insert(s, project);
    expect(await store.reserveRun(s, project.id, 'idempotent-run-id')).toBe(true);
    expect(await store.reserveRun(s, project.id, 'idempotent-run-id')).toBe(false);
    await store.finishRun(s, 'idempotent-run-id', project.id, 'complete');
    expect(await store.reserveRun(s, project.id, 'idempotent-run-id')).toBe(false);
  });

  it('keeps cancellation requests owner-scoped and does not release an active run lease', async () => {
    const s = { owner: owner() }; const other = { owner: owner() }; const project = createProject('Projeto cancelável');
    await store.insert(s, project);
    const beforeReserve = crypto.randomUUID();
    expect(await store.requestRunCancel(s, project.id, beforeReserve)).toBe(true);
    expect(await store.reserveRun(s, project.id, beforeReserve)).toBe(false);
    expect(await store.requestRunCancel(other, project.id, crypto.randomUUID())).toBe(false);

    const active = crypto.randomUUID();
    expect(await store.reserveRun(s, project.id, active)).toBe(true);
    expect(await store.requestRunCancel(s, project.id, active)).toBe(true);
    expect(await store.isRunCancelRequested(s, project.id, active)).toBe(true);
    await expect(store.reserveRun(s, project.id, crypto.randomUUID())).rejects.toMatchObject({ status: 409, code: 'RUN_BUSY' });
    await store.finishRun(s, active, project.id, 'cancelled');
    const resumed = crypto.randomUUID();
    expect(await store.reserveRun(s, project.id, resumed)).toBe(true);
    await store.finishRun(s, resumed, project.id, 'complete');
  });

  it('expires abandoned locks after 120 seconds while keeping run IDs reserved', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2028-01-10T15:00:00Z'));
    const s = { owner: owner() }; const project = createProject('Uma feira de produtores');
    await store.insert(s, project);
    expect(await store.reserveRun(s, project.id, 'expired-first-run')).toBe(true);
    vi.setSystemTime(new Date('2028-01-10T15:02:01Z'));
    expect(await store.reserveRun(s, project.id, 'expired-second-run')).toBe(true);
    await store.finishRun(s, 'expired-first-run', project.id, 'complete');
    await expect(store.reserveRun(s, project.id, 'expired-third-run')).rejects.toMatchObject({ status: 409 });
    expect(await store.reserveRun(s, project.id, 'expired-first-run')).toBe(false);
    await store.finishRun(s, 'expired-second-run', project.id, 'complete');
  });

  it('enforces thirty daily model turns while keeping reading and editing available', async () => {
    const s = { owner: owner() }; const project = createProject('Oficinas de escrita');
    await store.insert(s, project);
    for (let i = 0; i < 30; i++) {
      expect(await store.reserveRun(s, project.id, `quota-test-run-${i}`)).toBe(true);
      await store.finishRun(s, `quota-test-run-${i}`, project.id, 'complete');
    }
    await expect(store.reserveRun(s, project.id, 'quota-test-overflow')).rejects.toMatchObject({ status: 429 });
    expect((await store.get(s, project.id)).id).toBe(project.id);
    const updated = { ...project, title: 'Edição mesmo sem cota', version: project.version + 1 };
    expect((await store.save(s, updated, project.version)).title).toBe(updated.title);
  });

  it('enforces the global daily message budget across independent visitors', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2028-02-10T15:00:00Z'));
    const sessions = Array.from({ length: 7 }, () => ({ owner: owner() }));
    const projects = await Promise.all(sessions.map(s => store.insert(s, createProject('Um projeto para testar cotas globais'))));
    for (let i = 0; i < 200; i++) {
      const index = Math.floor(i / 30); const runId = `global-budget-run-${i}`;
      expect(await store.reserveRun(sessions[index], projects[index].id, runId)).toBe(true);
      await store.finishRun(sessions[index], runId, projects[index].id, 'complete');
    }
    await expect(store.reserveRun(sessions[6], projects[6].id, 'global-budget-run-over')).rejects.toMatchObject({ status: 429 });
  });

  it('reserves research once per run and at most five times daily per visitor', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2028-03-10T15:00:00Z'));
    const s = { owner: owner() }; const project = await store.insert(s, createProject('Uma loja de artesanato'));
    expect(await store.reserveResearch(s, 'unknown-research-run')).toBe(false);
    for (let i = 0; i < 5; i++) {
      const runId = `research-budget-run-${i}`;
      await store.reserveRun(s, project.id, runId);
      expect(await store.reserveResearch(s, runId)).toBe(true);
      expect(await store.reserveResearch(s, runId)).toBe(false);
      await store.finishRun(s, runId, project.id, 'complete');
    }
    await store.reserveRun(s, project.id, 'research-budget-run-over');
    expect(await store.reserveResearch(s, 'research-budget-run-over')).toBe(false);
    await store.finishRun(s, 'research-budget-run-over', project.id, 'complete');
  });

  it('respects daily global research and the conservative 750-credit monthly cap', async () => {
    vi.useFakeTimers();
    const sessions = Array.from({ length: 6 }, () => ({ owner: owner() }));
    const projects = await Promise.all(sessions.map(s => store.insert(s, createProject('Uma ideia com pesquisa limitada'))));
    for (let day = 1; day <= 10; day++) {
      vi.setSystemTime(new Date(`2029-01-${String(day).padStart(2, '0')}T15:00:00Z`));
      for (let i = 0; i < 25; i++) {
        const index = Math.floor(i / 5); const runId = `monthly-research-${day}-${i}`;
        await store.reserveRun(sessions[index], projects[index].id, runId);
        expect(await store.reserveResearch(sessions[index], runId)).toBe(true);
        await store.finishRun(sessions[index], runId, projects[index].id, 'complete');
      }
      const runId = `daily-research-over-${day}`;
      await store.reserveRun(sessions[5], projects[5].id, runId);
      expect(await store.reserveResearch(sessions[5], runId)).toBe(false);
      await store.finishRun(sessions[5], runId, projects[5].id, 'complete');
    }
    vi.setSystemTime(new Date('2029-01-11T15:00:00Z'));
    await store.reserveRun(sessions[5], projects[5].id, 'monthly-research-over');
    expect(await store.reserveResearch(sessions[5], 'monthly-research-over')).toBe(false);
    await store.finishRun(sessions[5], 'monthly-research-over', projects[5].id, 'complete');
  });

  it('streams a persisted answer and keeps its user message on reload', async () => {
    const token = owner();
    const created = await request('/api/projects', token, 'POST', { idea: 'Quero vender minhas ilustrações' });
    const project = await created.json() as Project;
    const response = await request(`/api/projects/${project.id}/messages`, token, 'POST', { text: 'Para estudantes de arte', runId: globalThis.crypto.randomUUID() });
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('"type":"complete"');
    const loaded = await (await request(`/api/projects/${project.id}`, token)).json() as Project;
    expect(loaded.messages.some(message => message.role === 'user' && message.text === 'Para estudantes de arte')).toBe(true);
    expect(loaded.messages.at(-1)?.text).toBe('Resposta de teste, sem provedores externos.');
  });
});
