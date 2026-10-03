import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '../shared/types';
import { consumeEventStream } from '../src/lib/eventStream';

const encoder = new TextEncoder();
const event = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\r\n\r\n`);
const read = (chunks: Uint8Array[], signal?: AbortSignal, onEvent: (event: StreamEvent) => void = () => {}) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const reader = stream.getReader();
  const result = consumeEventStream(reader, onEvent, signal);
  return { result, stream };
};

describe('SSE event stream reader', () => {
  it('assembles UTF-8 split across chunks, CRLF frames, and ignores heartbeat comments', async () => {
    const status = encoder.encode(': keep-alive\r\n\r\ndata: {"type":"status","text":"Pesquisa em São Paulo"}\r\n\r\n');
    const complete = event({ type: 'complete' });
    const split = status.findIndex(byte => byte > 127);
    const chunks = [status.slice(0, split + 1), status.slice(split + 1), complete];
    const received: StreamEvent[] = [];
    const { result, stream } = read(chunks, undefined, value => { received.push(value); });

    await expect(result).resolves.toBeUndefined();
    expect(received).toEqual([{ type: 'status', text: 'Pesquisa em São Paulo' }, { type: 'complete' }]);
    expect(stream.locked).toBe(false);
  });

  it('surfaces the server event error message as received', async () => {
    const { result, stream } = read([event({ type: 'error', error: 'Não consegui concluir essa etapa.' })]);

    await expect(result).rejects.toThrow('Não consegui concluir essa etapa.');
    expect(stream.locked).toBe(false);
  });

  it('turns a network read exception into a safe Portuguese interrupted-connection error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(event({ type: 'status', text: 'Preparando' }));
        queueMicrotask(() => controller.error(new Error('Input stream error with internal details')));
      },
    });
    const received: StreamEvent[] = [];
    const reader = stream.getReader();

    await expect(consumeEventStream(reader, value => received.push(value)))
      .rejects.toThrow('A conexão foi interrompida enquanto a resposta era preparada.');
    expect(received).toEqual([{ type: 'status', text: 'Preparando' }]);
    expect(stream.locked).toBe(false);
  });

  it('preserves an AbortError when the caller cancels the request', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) { streamController.error(new Error('Input stream error')); },
    });

    await expect(consumeEventStream(stream.getReader(), () => {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(stream.locked).toBe(false);
  });

  it('reports an incomplete stream that ends without a complete event', async () => {
    const { result } = read([event({ type: 'text', text: 'Resposta parcial' })]);

    await expect(result).rejects.toThrow('antes da confirmação da resposta');
  });
});
