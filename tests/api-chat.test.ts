import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../shared/types';

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const json = (value: unknown, status = 200) => Response.json(value, { status });
const completion = () => new Response(`data: ${JSON.stringify({ type: 'complete', project: {}, mode: 'live' })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

async function loadApi(fetchMock: (call: FetchCall) => Promise<Response>) {
  const calls: FetchCall[] = [];
  let stored: string | null = null;
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value; },
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { input, init }; calls.push(call);
    if (String(input) === '/api/config') return json({ url: '', publishableKey: '' });
    return fetchMock(call);
  });
  const { api, ApiError } = await import('../src/lib/api');
  return { api, ApiError, calls };
}

const pathOf = (call: FetchCall) => String(call.input);

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('api.chat cancellation and busy retry', () => {
  it('sends a durable cancellation with the exact run ID and waits for its acknowledgement', async () => {
    const cancelEntered = deferred<FetchCall>();
    const cancelResponse = deferred<Response>();
    const mainEntered = deferred<void>();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const { api, calls } = await loadApi(async call => {
      if (pathOf(call).endsWith('/messages')) {
        mainEntered.resolve();
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          streamController = controller;
          call.init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
        } });
        return new Response(stream);
      }
      cancelEntered.resolve(call);
      return cancelResponse.promise;
    });
    const controller = new AbortController();
    const pending = api.chat('project-123', 'Pergunta de teste', () => {}, controller.signal);
    await mainEntered.promise;
    controller.abort();
    const cancelCall = await cancelEntered.promise;
    const messageCall = calls.find(call => pathOf(call).endsWith('/messages'))!;
    const runId = (JSON.parse(String(messageCall.init?.body)) as { runId: string }).runId;

    expect(pathOf(cancelCall)).toBe(`/api/projects/project-123/runs/${runId}/cancel`);
    expect(cancelCall.init?.method).toBe('POST');
    expect(cancelCall.init?.keepalive).toBe(true);
    expect(cancelCall.init?.signal).not.toBe(controller.signal);
    expect(cancelCall.init?.headers).toBe(messageCall.init?.headers);
    expect(calls.filter(call => pathOf(call) === '/api/config')).toHaveLength(1);
    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    expect(settled).toBe(false);

    cancelResponse.resolve(json({ ok: true }, 202));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(streamController).toBeDefined();
    expect(calls.filter(call => pathOf(call).endsWith('/cancel'))).toHaveLength(1);
  });

  it('aborts during auth setup without posting a message or cancellation', async () => {
    const configEntered = deferred<void>();
    const releaseConfig = deferred<Response>();
    const calls: string[] = [];
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      calls.push(String(input));
      configEntered.resolve();
      return releaseConfig.promise;
    });
    const { api } = await import('../src/lib/api');
    const controller = new AbortController();
    const pending = api.chat('project-123', 'Pergunta de teste', () => {}, controller.signal);
    await configEntered.promise;
    controller.abort();
    releaseConfig.resolve(json({ url: '', publishableKey: '' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual(['/api/config']);
  });

  it('surfaces a failed cancellation acknowledgement instead of reporting a confirmed stop', async () => {
    const cancelEntered = deferred<void>();
    const mainEntered = deferred<void>();
    const { api } = await loadApi(async call => {
      if (pathOf(call).endsWith('/messages')) {
        mainEntered.resolve();
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          call.init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
        } });
        return new Response(stream);
      }
      cancelEntered.resolve();
      return json({ error: 'hidden backend detail' }, 500);
    });
    const controller = new AbortController();
    const pending = api.chat('project-123', 'Pergunta de teste', () => {}, controller.signal);
    await mainEntered.promise;
    controller.abort();
    await cancelEntered.promise;

    await expect(pending).rejects.toMatchObject({
      name: 'ApiError', status: 503,
      message: 'Não foi possível confirmar a interrupção no servidor. Aguarde a resposta antes de enviar outra pergunta.',
    });
  });

  it('retries only RUN_BUSY with the same run ID and does not emit/ack while waiting', async () => {
    let attempts = 0;
    const bodyRunIds: string[] = [];
    const events: StreamEvent[] = [];
    let waitingCalls = 0;
    const { api } = await loadApi(async call => {
      const body = JSON.parse(String(call.init?.body)) as { runId: string };
      bodyRunIds.push(body.runId);
      attempts++;
      if (attempts === 1) return json({ error: 'busy', code: 'RUN_BUSY' }, 409);
      return completion();
    });
    const pending = api.chat('project-123', 'Pergunta de teste', event => events.push(event), undefined, {
      onWaiting: () => { waitingCalls++; expect(events).toHaveLength(0); },
    });
    await pending;

    expect(attempts).toBe(2);
    expect(bodyRunIds[0]).toBe(bodyRunIds[1]);
    expect(waitingCalls).toBe(1);
    expect(events.map(event => event.type)).toEqual(['complete']);
  });

  it('does not retry an unrelated 409', async () => {
    let attempts = 0;
    const { api, ApiError } = await loadApi(async () => {
      attempts++;
      return json({ error: 'conflict', code: 'PROJECT_VERSION' }, 409);
    });

    await expect(api.chat('project-123', 'Pergunta de teste', () => {})).rejects.toBeInstanceOf(ApiError);
    expect(attempts).toBe(1);
  });
});
