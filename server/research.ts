import { createHash } from 'node:crypto';
import type { Source } from '../shared/types';
import { isSafeExternalUrl } from '../shared/media';

export interface ResearchOptions {
  apiKey?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  onStatus?: (text: string) => void;
  /** Publish registered references before extraction, and their enriched versions afterwards. */
  onSources?: (sources: Source[]) => Promise<void> | void;
  /** Reserve the complete investigation budget in persistent storage before its first request. */
  reserve?: () => Promise<boolean>;
}

export interface ResearchResult {
  status: 'ok' | 'unavailable' | 'limited' | 'error';
  sources: Source[];
  message: string;
}

/** URLs from search providers are data, never trusted execution targets. */
export const isPublicUrl = isSafeExternalUrl;

function sourceId(url: string): string {
  return `web-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
}

function compactText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/** Accept only image URLs returned by the provider; never guess an image path. */
function providerImages(value: unknown): Array<{ url: string; description: string }> {
  if (!Array.isArray(value)) return [];
  const images: Array<{ url: string; description: string }> = [];
  for (const image of value.slice(0, 20)) {
    const row = typeof image === 'object' && image !== null ? image as Record<string, unknown> : undefined;
    const url = typeof image === 'string' ? image : typeof row?.url === 'string' ? row.url : '';
    if (!isPublicUrl(url) || images.some(existing => existing.url === url)) continue;
    images.push({ url, description: compactText(row?.description, 300) });
  }
  return images;
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
    let data: Record<string, unknown>;
    try {
      data = await this.request('search', {
        query: normalized, search_depth: 'basic', auto_parameters: false,
        max_results: 5, topic: 'general', include_answer: false,
        include_raw_content: false, include_usage: true,
        include_images: true, include_image_descriptions: true,
      });
    } catch (error) {
      if (this.options.signal?.aborted) throw error;
      return { status: 'error', sources: [], message: researchError(error) };
    }
    const results = Array.isArray(data.results) ? data.results : [];
    const consultedAt = new Date().toISOString();
    const fresh: Source[] = [];
    for (const result of results.slice(0, 5)) {
      if (!result || typeof result !== 'object') continue;
      const row = result as Record<string, unknown>;
      const url = typeof row.url === 'string' ? row.url : '';
      if (!isPublicUrl(url)) continue;
      const excerpt = compactText(row.content, 2400);
      if (!excerpt) continue;
      const image = providerImages(row.images)[0];
      const source: Source = { id: sourceId(url), url, title: compactText(row.title, 240) || new URL(url).hostname, excerpt, consultedAt, verified: true, ...(image ? { imageUrl: image.url } : {}) };
      // A second search may repeat a page; preserve its already extracted document.
      const previous = this.collected.get(source.id);
      const canonical = previous ? { ...previous, ...(!previous.imageUrl && image ? { imageUrl: image.url } : {}) } : source;
      this.collected.set(source.id, canonical);
      fresh.push(canonical);
    }
    const pages = [...fresh];
    // Query-level images have no reliable page association. Preserve the exact
    // provider-returned image as its own reference rather than inventing a page.
    const knownImages = new Set(this.sources.map(source => source.imageUrl));
    for (const image of providerImages(data.images).filter(image => !knownImages.has(image.url)).slice(0, 3)) {
      const source: Source = { id: sourceId(image.url), url: image.url, imageUrl: image.url,
        title: image.description || 'Imagem retornada pela busca',
        excerpt: `Referência visual retornada pelo serviço de pesquisa para esta consulta. ${image.description} A página original e a licença de uso não foram confirmadas.`,
        consultedAt, verified: true };
      const canonical = this.collected.get(source.id) ?? source;
      this.collected.set(source.id, canonical); fresh.push(canonical);
    }
    // Persistence failures are not provider failures: propagate the callback error,
    // retaining every real reference already registered in this session.
    if (fresh.length) await this.options.onSources?.(this.sources);
    const beforeExtraction = JSON.stringify(this.sources);
    // Only search-produced page URLs can be extracted; model-provided URLs and
    // query-level image references never reach the extraction API.
    if (!this.extracted && pages.length) await this.extract(pages.slice(0, 5));
    if (JSON.stringify(this.sources) !== beforeExtraction) await this.options.onSources?.(this.sources);
    return { status: 'ok', sources: fresh.map(source => this.collected.get(source.id)!), message: fresh.length ? 'Fontes recuperadas. O trecho é evidência da página consultada, não garantia de veracidade ou atualidade de todas as suas informações.' : 'A busca não retornou fontes utilizáveis. Não invente nomes, contatos, valores ou links.' };
  }

  private async extract(sources: Source[]): Promise<void> {
    this.extracted = true;
    try {
      const data = await this.request('extract', { urls: sources.map(source => source.url), extract_depth: 'basic', format: 'text', include_usage: true, include_images: true });
      for (const result of Array.isArray(data.results) ? data.results : []) {
        if (!result || typeof result !== 'object') continue;
        const row = result as Record<string, unknown>;
        const original = sources.find(source => source.url === row.url);
        if (!original) continue;
        const excerpt = compactText(row.raw_content, 3600);
        const image = providerImages(row.images)[0];
        const canonical = this.collected.get(original.id) ?? original;
        this.collected.set(original.id, { ...canonical, ...(excerpt ? { excerpt } : {}), ...(!canonical.imageUrl && image ? { imageUrl: image.url } : {}) });
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
