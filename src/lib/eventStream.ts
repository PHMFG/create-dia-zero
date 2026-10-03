import type { StreamEvent } from '../../shared/types';

const interruptedMessage = 'A conexão foi interrompida enquanto a resposta era preparada. Sua mensagem e o projeto estão salvos; reabra o projeto para conferir.';
const incompleteMessage = 'A conexão foi interrompida antes da confirmação da resposta. Sua mensagem e o projeto estão salvos; reabra o projeto para conferir.';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function parsePacket(packet: string): StreamEvent | undefined {
  const data: string[] = [];
  for (const line of packet.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    if (field !== 'data') continue;
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    data.push(value);
  }
  if (!data.length) return undefined;
  try {
    return JSON.parse(data.join('\n')) as StreamEvent;
  } catch {
    throw new Error(interruptedMessage);
  }
}

/** Read a server event stream without retrying a request whose result may already be saved. */
export async function consumeEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  let completed = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        throw new Error(interruptedMessage);
      }
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const boundary = /(?:\r\n|\r|\n)(?:\r\n|\r|\n)/.exec(pending);
        if (!boundary || boundary.index === undefined) break;
        const packet = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const event = parsePacket(packet);
        if (!event) continue;
        onEvent(event);
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'complete') completed = true;
      }
    }
    pending += decoder.decode();
    if (!completed && !signal?.aborted) throw new Error(incompleteMessage);
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  } finally {
    try { await reader.cancel(); } catch { /* The stream may already have failed or closed. */ }
    try { reader.releaseLock(); } catch { /* A released or still-pending reader cannot be reused here. */ }
  }
}
