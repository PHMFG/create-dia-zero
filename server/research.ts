import { createHash } from 'node:crypto';
import type { Source } from '../shared/types';

export interface ResearchOptions {
  apiKey?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  onStatus?: (text: string) => void;
  /** Reserve the complete investigation budget in persistent storage before its first request. */
  reserve?: () => Promise<boolean>;
}

export interface ResearchResult {
  status: 'ok' | 'unavailable' | 'limited' | 'error';
  sources: Source[];
  message: string;
}

/** URLs from search providers are data. Never permit local services or embedded credentials. */
export function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
    if (host.includes(':') || host.startsWith('[')) return false;
    if (/^\d+(?:\.\d+){3}$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
    }
    return true;
  } catch { return false; }
}

function sourceId(url: string): string {
  return `web-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
}

function compactText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/** A single turn owns a bounded research session: 2 basic searches and 1 basic extraction. */
export class ResearchSession {
  private readonly options: ResearchOptions;
  private readonly key: string | undefined;
  private calls = 0;
  private extracted = false;
  private reservation?: Promise<boolean>;
  private readonly collected = new Map<string, Source>();
  readonly requests: Array<{ id: string; credits: number }> = [];

  constructor(options: ResearchOptions = {}) {
    this.options = options;
    this.key = options.apiKey ?? process.env.TAVILY_API_KEY;
  }

  get available(): boolean { return Boolean(this.key); }
  get sources(): Source[] { return [...this.collected.values()]; }
  get searchesRemaining(): number { return Math.max(0, 2 - this.calls); }

  async search(query: string): Promise<ResearchResult> {
    if (!this.key) return { status: 'unavailable', sources: [], message: 'Pesquisa web indisponível: o serviço de busca ainda não foi configurado. Não há fontes verificadas para esta consulta.' };
    if (this.calls >= 2) return { status: 'limited', sources: [], message: 'As duas buscas desta investigação já foram utilizadas. Use as fontes obtidas ou faça uma pergunta de esclarecimento.' };
    const normalized = compactText(query, 400);
    if (normalized.length < 3) return { status: 'error', sources: [], message: 'A consulta precisa descrever o assunto que será investigado.' };
    // Increment before awaiting: parallel tool calls must share the same hard limit.
    this.calls++;
    this.reservation ??= this.options.reserve ? this.options.reserve() : Promise.resolve(true);
    if (!await this.reservation) return { status: 'limited', sources: [], message: 'O limite de investigações foi atingido. O projeto continua disponível para edição e registro de evidências.' };
    this.options.onStatus?.('Conferindo fontes na web');
    try {
      const data = await this.request('search', {
        query: normalized, search_depth: 'basic', auto_parameters: false,
        max_results: 5, topic: 'general', include_answer: false,
        include_raw_content: false, include_usage: true,
      });
      const results = Array.isArray(data.results) ? data.results : [];
      const consultedAt = new Date().toISOString();
      const fresh: Source[] = [];
      for (const result of results.slice(0, 5)) {
        const row = result as Record<string, unknown>;
        const url = typeof row.url === 'string' ? row.url : '';
        if (!isPublicUrl(url)) continue;
        const excerpt = compactText(row.content, 2400);
        if (!excerpt) continue;
        const source: Source = { id: sourceId(url), url, title: compactText(row.title, 240) || new URL(url).hostname, excerpt, consultedAt, verified: true };
        // A second search may repeat a page; preserve its already extracted document.
        const canonical = this.collected.get(source.id) ?? source;
        this.collected.set(source.id, canonical);
        fresh.push(canonical);
      }
      // Only search-produced URLs can be extracted; model-provided URLs never reach the API.
      if (!this.extracted && fresh.length) await this.extract(fresh.slice(0, 5));
      return { status: 'ok', sources: fresh.map(source => this.collected.get(source.id)!), message: fresh.length ? 'Fontes recuperadas. O trecho é evidência da página consultada, não garantia de veracidade ou atualidade de todas as suas informações.' : 'A busca não retornou fontes utilizáveis. Não invente nomes, contatos, valores ou links.' };
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      return { status: 'error', sources: [], message: researchError(error) };
    }
  }

  private async extract(sources: Source[]): Promise<void> {
    this.extracted = true;
    try {
      const data = await this.request('extract', { urls: sources.map(source => source.url), extract_depth: 'basic', format: 'text', include_usage: true });
      for (const result of Array.isArray(data.results) ? data.results : []) {
        const row = result as Record<string, unknown>;
        const original = sources.find(source => source.url === row.url);
        if (!original) continue;
        const excerpt = compactText(row.raw_content, 3600);
        if (excerpt) this.collected.set(original.id, { ...original, excerpt });
      }
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      // Search snippets remain usable with their provenance if extraction is unavailable.
      this.options.onStatus?.('Usando os trechos disponíveis na busca');
    }
  }

  private async request(endpoint: 'search' | 'extract', body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(18_000);
    const signal = this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout;
    const response = await (this.options.fetcher ?? fetch)(`https://api.tavily.com/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body), signal,
    });
    if (!response.ok) throw new ResearchServiceError(response.status);
    const data = await response.json() as Record<string, unknown>;
    const usage = data.usage as { credits?: number } | undefined;
    this.requests.push({ id: typeof data.request_id === 'string' ? data.request_id : '', credits: typeof usage?.credits === 'number' ? usage.credits : 1 });
    return data;
  }
}

class ResearchServiceError extends Error { constructor(readonly status: number) { super(`research-${status}`); } }
function researchError(error: unknown): string {
  if (error instanceof ResearchServiceError && [401, 403].includes(error.status)) return 'O serviço de pesquisa não autorizou a consulta. Nenhuma fonte foi inventada; continue com uma investigação manual enquanto a configuração é revisada.';
  if (error instanceof ResearchServiceError && [429, 432, 433].includes(error.status)) return 'O serviço de pesquisa atingiu o limite de uso. Retome mais tarde ou registre referências manualmente.';
  return 'Não foi possível consultar a web agora. A conexão ou o serviço de busca falhou; não apresente resultados como se uma pesquisa tivesse sido concluída.';
}
