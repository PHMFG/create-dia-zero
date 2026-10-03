import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, TurnResult } from '../shared/types';
import { createProject } from '../shared/domain';

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

  it('isolates visitors across read, write, delete, evidence and model turns', async () => {
    const a = owner(); const b = owner();
    const created = await request('/api/projects', a, 'POST', { idea: 'Uma escola de arte no bairro' });
    expect(created.status).toBe(201);
    const project = await created.json() as Project;
    expect(await (await request('/api/projects', b)).json()).toEqual([]);
    expect((await request(`/api/projects/${project.id}`, b)).status).toBe(404);
    expect((await request(`/api/projects/${project.id}`, b, 'DELETE')).status).toBe(404);
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
