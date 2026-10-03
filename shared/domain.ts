import type { Block, CanvasCard, CardOperation, Context, Evidence, Project, Proposal, TurnResult } from './types';
import { evidenceInputSchema, httpUrlSchema, parseProject, parseTurnResult } from './validation';

export function uid(prefix = 'id'): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }
export class DomainConflictError extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); this.name = 'DomainConflictError'; }
}
const timestamp = () => new Date().toISOString();
const copy = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const cleanString = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
const paragraph = (text: string): Block => ({ id: uid('block'), type: 'paragraph', text });
const checklist = (items: string[]): Block => ({ id: uid('block'), type: 'checklist', items: items.map(text => ({ id: uid('item'), text, checked: false })) });

export function makeCard(kind: CanvasCard['kind'], title: string, summary: string, blocks: Block[], lane: CanvasCard['lane'] = 'next', dependsOn: string[] = []): CanvasCard {
  return { id: uid('card'), kind, title, summary, blocks, lane, position: { x: 0, y: 0 }, revision: 0, origin: 'ai', status: 'draft', dependsOn };
}

const laneX = { now: 40, next: 430, later: 820, done: 1210 };
/** Explicit layout command. Cards dragged by a human keep their exact position. */
export function organizeCards(cards: CanvasCard[]): CanvasCard[] {
  const placed = cards.filter(card => card.pinnedPosition).map(card => ({ ...card.position }));
  const row = { now: 0, next: 0, later: 0, done: 0 };
  return cards.map(card => {
    if (card.pinnedPosition) return copy(card);
    let position = { x: laneX[card.lane], y: 48 + row[card.lane] * 290 };
    while (placed.some(item => Math.abs(item.x - position.x) < 350 && Math.abs(item.y - position.y) < 275)) {
      row[card.lane]++; position = { x: laneX[card.lane], y: 48 + row[card.lane] * 290 };
    }
    row[card.lane]++; placed.push(position);
    return { ...copy(card), position };
  });
}

/** Strip dangling references and cycles; ensure that only one action is current. */
function normalizeCards(cards: CanvasCard[], preferredNow?: string): CanvasCard[] {
  const ids = new Set<string>();
  const unique = cards.filter(card => !ids.has(card.id) && !!ids.add(card.id)).map(copy);
  const byId = new Map(unique.map(card => [card.id, card]));
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (card: CanvasCard) => {
    if (visited.has(card.id)) return;
    visiting.add(card.id);
    card.dependsOn = [...new Set(card.dependsOn)].filter(dep => byId.has(dep) && dep !== card.id && !visiting.has(dep));
    for (const dep of [...card.dependsOn]) {
      const target = byId.get(dep)!;
      if (visiting.has(dep)) card.dependsOn = card.dependsOn.filter(id => id !== dep);
      else visit(target);
    }
    visiting.delete(card.id); visited.add(card.id);
  };
  unique.forEach(visit);
  const current = unique.find(card => card.id === preferredNow && card.kind === 'action' && card.lane === 'now') ?? unique.find(card => card.kind === 'action' && card.lane === 'now');
  for (const card of unique) if (card.kind === 'action' && card.lane === 'now' && card.id !== current?.id) card.lane = 'next';
  return unique;
}

function changed(project: Project, label: string, cards = project.cards, context = project.context): Project {
  const now = timestamp();
  return { ...project, version: project.version + 1, updatedAt: now, cards: normalizeCards(cards), context,
    revisions: [...project.revisions, { id: uid('revision'), at: now, label, cards: copy(project.cards), context: copy(project.context) }].slice(-50) };
}

export function createProject(idea: string): Project {
  const value = cleanString(idea);
  if (!value || value.length > 12000) throw new Error('Descreva sua ideia em até 12.000 caracteres.');
  const now = timestamp();
  const context = makeCard('context', 'O ponto de partida', value, [paragraph(value), { id: uid('block'), type: 'callout', text: 'Vamos entender o público, seus recursos e o primeiro teste possível.' }], 'next');
  context.origin = 'user';
  return { id: uid('project'), title: value.length > 65 ? `${value.slice(0, 62)}…` : value, createdAt: now, updatedAt: now, version: 0, context: { idea: value }, cards: organizeCards([context]),
    messages: [],
    sources: [], evidence: [], proposals: [], revisions: [] };
}

export function createDemoProject(): Project {
  const project = createProject('Chabor — uma loja cozy de matcha para descobrir sabores e fazer uma pausa.');
  project.title = 'Chabor · demonstração'; project.demo = true;
  project.context = { ...project.context, audience: 'Estudantes e jovens profissionais curiosos sobre matcha', city: 'Porto Alegre', budget: 'R$ 3.000 para testar a ideia', availability: 'Duas tardes por semana', goal: 'Descobrir se as pessoas voltariam a comprar' };
  project.cards[0].blocks.push(paragraph('Cenário preparado para demonstração. Público, cidade e orçamento são exemplos, não resultados de pesquisa.'));
  const hypothesis = makeCard('hypothesis', 'Uma pausa com matcha', 'Descobrir como estudantes e jovens profissionais escolhem bebidas e lugares para fazer uma pausa.', [
    paragraph('Hipótese de demonstração: uma bebida de matcha em um ambiente acolhedor pode ser uma alternativa para esse público. Ainda precisamos observar experiências reais.'),
    { id: uid('block'), type: 'callout', text: 'Este cenário é ilustrativo; nenhuma demanda foi comprovada.' },
  ], 'next', [project.cards[0].id]);
  const action = makeCard('action', 'Conversar antes do primeiro pop-up', 'Ouça três pessoas sobre a última compra de uma bebida fora de casa.', [
    { id: uid('block'), type: 'heading', text: 'Seu primeiro teste' },
    paragraph('Converse com estudantes e jovens profissionais em Porto Alegre. Antes de apresentar a Chabor, pergunte sobre a última bebida que compraram fora de casa, por que escolheram aquele lugar e quanto gastaram.'),
    checklist(['Escolher três pessoas do público de exemplo', 'Perguntar sobre a última compra e a escolha do lugar', 'Anotar frases, comportamentos e dificuldades', 'Registrar o que aconteceu para revisar a hipótese']),
    { id: uid('block'), type: 'callout', text: 'Completar a checklist organiza a atividade. Evidência de demanda exige interpretar o que aconteceu.' },
  ], 'now', [hypothesis.id]);
  action.status = 'ready';
  project.cards = organizeCards([...project.cards, hypothesis, action]);
  project.cards.forEach(card => { card.origin = 'demo'; });
  project.messages = [{ id: uid('message'), role: 'assistant', text: 'Este é um projeto de demonstração, com contexto de exemplo. Nenhuma entrevista foi realizada ainda. Que experiência você quer explorar primeiro?', createdAt: timestamp() }];
  return project;
}

function sourceReferences(cards: CanvasCard[], validIds: Set<string>): CanvasCard[] {
  return cards.map(card => ({ ...card, blocks: cleanBlockSources(card.blocks, validIds) }));
}

function cleanBlockSources(blocks: Block[], validIds: Set<string>): Block[] {
  return blocks.map(block => block.sourceIds ? { ...block, sourceIds: [...new Set(block.sourceIds)].filter(id => validIds.has(id)) } : block);
}

function cleanOperationSources(operations: CardOperation[], validIds: Set<string>): CardOperation[] {
  return operations.map(operation => ({ ...operation,
    card: operation.card ? sourceReferences([operation.card], validIds)[0] : undefined,
    patch: operation.patch?.blocks ? { ...operation.patch, blocks: cleanBlockSources(operation.patch.blocks, validIds) } : operation.patch,
  }));
}

function preserveChecked(before: CanvasCard, after: CanvasCard): CanvasCard {
  const oldItems = new Map(before.blocks.flatMap(block => block.items ?? []).map(item => [item.id, item]));
  const blocks = after.blocks.map(block => ({ ...block, items: block.items?.map(item => {
    const previous = oldItems.get(item.id);
    return previous?.humanEdited ? { ...item, checked: previous.checked, humanEdited: true } : item;
  }) }));
  // Explicitly accepted content may change, but it cannot silently lose a completed human item.
  for (const oldBlock of before.blocks) for (const item of oldBlock.items ?? []) {
    if (!item.humanEdited || !item.checked || blocks.some(block => block.items?.some(candidate => candidate.id === item.id))) continue;
    const target = blocks.find(block => block.id === oldBlock.id && block.items);
    if (target) target.items!.push(copy(item));
    else blocks.push({ ...copy(oldBlock), items: [copy(item)] });
  }
  return { ...after, blocks, position: copy(before.position), pinnedPosition: before.pinnedPosition };
}

function editablePatch(patch: Partial<CanvasCard>, before?: CanvasCard): Partial<CanvasCard> {
  const { id: _id, revision: _revision, origin: _origin, humanEdited: _edited, pinnedPosition: _pinned, position: _position, ...allowed } = patch;
  return Object.fromEntries(Object.entries(allowed).filter(([key, value]) => value !== undefined && (!before || !same(before[key as keyof CanvasCard], value)))) as Partial<CanvasCard>;
}

function applyOperations(cards: CanvasCard[], operations: CardOperation[], accepted = false): { cards: CanvasCard[]; conflicts: CardOperation[] } {
  let next = copy(cards); const conflicts: CardOperation[] = [];
  for (const operation of operations) {
    const existing = next.find(card => card.id === operation.cardId);
    if (operation.op === 'add') {
      if (existing || !operation.card) continue;
      next.push({ ...copy(operation.card), origin: 'ai', humanEdited: false, pinnedPosition: false, revision: 0 });
      continue;
    }
    if (!existing) continue;
    if (operation.op === 'remove') {
      if (!accepted) conflicts.push({ ...operation, expectedRevision: existing.revision });
      else next = next.filter(card => card.id !== existing.id);
      continue;
    }
    const patch = editablePatch(operation.patch ?? {}, existing);
    if (!Object.keys(patch).length) continue;
    const protectedContent = existing.humanEdited || existing.blocks.some(block => block.humanEdited || block.items?.some(item => item.humanEdited));
    const stale = operation.expectedRevision === undefined || operation.expectedRevision !== existing.revision;
    const strategic = existing.kind === 'decision' || (existing.kind === 'action' && patch.lane !== undefined && patch.lane !== existing.lane);
    if (!accepted && (protectedContent || stale || strategic)) {
      conflicts.push({ op: 'update', cardId: existing.id, patch, expectedRevision: existing.revision });
      continue;
    }
    const updated = preserveChecked(existing, { ...existing, ...copy(patch), revision: existing.revision + 1, humanEdited: accepted || existing.humanEdited });
    next = next.map(card => card.id === existing.id ? updated : card);
  }
  // Updating content never repositions existing nodes. Find a free slot only for new nodes.
  const existingIds = new Set(cards.map(card => card.id));
  const occupied = next.filter(card => existingIds.has(card.id));
  const additions = next.filter(card => !existingIds.has(card.id));
  const positioned = organizeCards([...occupied.map(card => ({ ...card, pinnedPosition: true })), ...additions]);
  const positions = new Map(positioned.map(card => [card.id, card.position]));
  next = next.map(card => existingIds.has(card.id) ? card : { ...card, position: positions.get(card.id)! });
  return { cards: normalizeCards(next, cards.find(card => card.kind === 'action' && card.lane === 'now')?.id), conflicts };
}

function proposal(content: Omit<Proposal, 'id' | 'createdAt' | 'status'>): Proposal {
  return { ...copy(content), id: uid('proposal'), createdAt: timestamp(), status: 'pending' };
}

export function applyTurn(project: Project, rawResult: TurnResult, baselineContext: Context = project.context): Project {
  const result = parseTurnResult(rawResult);
  const sources = copy(project.sources);
  for (const item of result.sources) if (!sources.some(source => source.id === item.id)) sources.push({ ...item, url: new URL(item.url).href });
  const sourceIds = new Set(sources.map(source => source.id));
  const operations = cleanOperationSources(result.operations, sourceIds);
  const currentAction = project.cards.find(card => card.kind === 'action' && card.lane === 'now');
  const changesPriority = operations.some(operation => {
    const existing = project.cards.find(card => card.id === operation.cardId);
    return (operation.op === 'add' && operation.card?.kind === 'action' && operation.card.lane === 'now' && !!currentAction)
      || (existing?.kind === 'action' && ((operation.op === 'remove' && existing.lane === 'now') || (operation.patch?.lane !== undefined && operation.patch.lane !== existing.lane)));
  });
  const strategicOperations = changesPriority ? operations.filter(operation => project.cards.find(card => card.id === operation.cardId)?.kind === 'action' || operation.card?.kind === 'action') : [];
  if (currentAction && strategicOperations.some(operation => operation.op === 'add' && operation.card?.lane === 'now') && !strategicOperations.some(operation => operation.cardId === currentAction.id && (operation.op === 'remove' || operation.patch?.lane !== undefined))) {
    strategicOperations.unshift({ op: 'update', cardId: currentAction.id, expectedRevision: currentAction.revision, patch: { lane: 'next' } });
  }
  const strategicIds = new Set(strategicOperations.map(operation => operation.cardId));
  const applied = applyOperations(project.cards, operations.filter(operation => !strategicIds.has(operation.cardId)));
  const context = { ...project.context, ...result.contextPatch };
  // Only values changed while this generation ran are protected. A later, explicit
  // conversation can update a previously edited field using its current baseline.
  for (const key of Object.keys(result.contextPatch ?? {}) as Array<keyof Context>) {
    if (project.context[key] !== baselineContext[key]) Object.assign(context, { [key]: project.context[key] });
  }
  let next = changed(project, 'Atualização da conversa', sourceReferences(applied.cards, sourceIds), context);
  const contextDrifted = !same(project.context, baselineContext);
  if (!same(context, project.context) || contextDrifted) {
    const existingIds = new Set(project.cards.map(card => card.id));
    next.cards = next.cards.map(card => existingIds.has(card.id) || contextDrifted ? markReview([card])[0] : card);
  }
  next.sources = sources;
  next.messages = [...project.messages, { id: uid('message'), role: 'assistant', text: cleanString(result.reply), createdAt: timestamp(), sourceIds: result.sources.map(source => source.id) }];
  if (applied.conflicts.length) next.proposals = [...next.proposals, proposal({ title: 'Sugestões para seu plano', reason: 'Seu conteúdo foi preservado. Revise estas mudanças antes de aplicar.', operations: applied.conflicts.map(operation => ({ ...operation, expectedRevision: next.cards.find(card => card.id === operation.cardId)?.revision })) })];
  if (strategicOperations.length) next.proposals = [...next.proposals, proposal({
    title: 'Revisar a ação prioritária', reason: 'Revise esta mudança de prioridade. A ação atual continua no plano até você aceitar a revisão.',
    operations: strategicOperations.map(operation => ({ ...operation, expectedRevision: next.cards.find(card => card.id === operation.cardId)?.revision })),
  })];
  if (result.proposal) next.proposals = [...next.proposals, proposal({ ...result.proposal, operations: cleanOperationSources(result.proposal.operations, sourceIds).map(operation => ({
    ...operation, expectedRevision: next.cards.find(card => card.id === operation.cardId)?.revision,
  })) })];
  return next;
}

function markReview(cards: CanvasCard[]): CanvasCard[] {
  return cards.map(card => ['research', 'decision'].includes(card.kind) || (card.kind === 'action' && card.status !== 'done') ? { ...card, status: 'review' as const, revision: card.revision + 1 } : card);
}

export function applyHumanEdit(project: Project, inputCards: CanvasCard[], contextPatch?: Partial<Context>): Project {
  const previous = new Map(project.cards.map(card => [card.id, card]));
  let cards = inputCards.map(card => {
    const old = previous.get(card.id);
    if (old && same(old, card)) return copy(old);
    const next = copy(card);
    next.origin = old?.origin ?? 'user'; next.humanEdited = true; next.revision = (old?.revision ?? -1) + 1;
    if (old && !same(old.position, next.position)) next.pinnedPosition = true;
    next.blocks = next.blocks.map(block => {
      const oldBlock = old?.blocks.find(item => item.id === block.id);
      return { ...block, humanEdited: !same(block, oldBlock) || oldBlock?.humanEdited,
        items: block.items?.map(item => {
          const oldItem = oldBlock?.items?.find(candidate => candidate.id === item.id);
          return { ...item, humanEdited: !same(item, oldItem) || oldItem?.humanEdited };
        }) };
    });
    if (next.kind === 'action' && next.blocks.some(block => block.type === 'checklist' && block.items?.length) && next.blocks.filter(block => block.type === 'checklist').every(block => block.items?.every(item => item.checked))) next.status = 'awaiting_evidence';
    return next;
  });
  const context = { ...project.context, ...contextPatch };
  if (contextPatch && !same(context, project.context)) {
    cards = markReview(cards).map(card => card.kind === 'context' ? { ...card, humanEdited: true, revision: card.revision + 1 } : card);
  }
  const validSources = new Set(project.sources.map(source => source.id));
  const candidate = { ...project, cards: sourceReferences(cards, validSources), context };
  parseProject(candidate);
  return changed(project, 'Edição do projeto', candidate.cards, context);
}

export function resolveProposal(project: Project, id: string, accept: boolean): Project {
  const pending = project.proposals.find(item => item.id === id && item.status === 'pending');
  if (!pending) return project;
  if (accept) for (const operation of pending.operations) {
    const current = project.cards.find(card => card.id === operation.cardId);
    if ((operation.op === 'add' && current) || (operation.op !== 'add' && (!current || operation.expectedRevision !== current.revision))) {
      throw new DomainConflictError('O plano foi editado depois desta sugestão. Seu texto foi preservado. Descarte a sugestão e peça uma revisão atualizada na conversa.');
    }
  }
  const cards = accept ? sourceReferences(applyOperations(project.cards, pending.operations, true).cards, new Set(project.sources.map(source => source.id))) : project.cards;
  const next = changed(project, accept ? 'Sugestão aceita' : 'Sugestão descartada', cards);
  next.proposals = project.proposals.map(item => item.id === id ? { ...item, status: accept ? 'accepted' : 'rejected' } : item);
  return next;
}

export function recordEvidence(project: Project, input: { text: string; cardId?: string; type?: Evidence['type']; links?: string[] }): Project {
  const value = evidenceInputSchema.parse(input);
  if (value.cardId && !project.cards.some(card => card.id === value.cardId)) throw new Error('A ação relacionada não existe neste projeto.');
  const evidence: Evidence = { ...value, id: uid('evidence'), origin: 'user', createdAt: timestamp() };
  const card = makeCard('evidence', 'O que aconteceu', value.text.slice(0, 180), [paragraph(value.text), { id: uid('block'), type: 'callout', text: 'Relato registrado pelo usuário. Ele contribui para revisar a hipótese; não valida o negócio automaticamente.' }], 'next', value.cardId ? [value.cardId] : []);
  card.origin = 'user'; card.humanEdited = true; card.status = 'ready';
  const cards = project.cards.map(item => item.id === value.cardId && item.kind === 'action' ? { ...item, lane: 'done' as const, status: 'done' as const, revision: item.revision + 1 } : ['hypothesis', 'decision'].includes(item.kind) ? { ...item, status: 'review' as const, revision: item.revision + 1 } : item);
  const applied = applyOperations(cards, [{ op: 'add', cardId: card.id, card }]);
  applied.cards = applied.cards.map(item => item.id === card.id ? { ...item, origin: 'user', humanEdited: true } : item);
  const next = changed(project, 'Evidência registrada', applied.cards);
  next.evidence = [...project.evidence, evidence];
  return next;
}

function uniqueIds(items: Array<{ id: string }>, label: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`O arquivo contém IDs duplicados em ${label}.`);
}

export function importProject(raw: unknown): Project {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (raw.length > 3000000) throw new Error('O arquivo é muito grande. O limite é 3 MB.');
    try { parsed = JSON.parse(raw); } catch { throw new Error('O arquivo não contém um projeto JSON válido.'); }
  }
  if (parsed && typeof parsed === 'object' && 'project' in parsed) parsed = (parsed as { project: unknown }).project;
  const project = parseProject(parsed);
  uniqueIds(project.cards, 'cartões'); uniqueIds(project.sources, 'fontes'); uniqueIds(project.evidence, 'evidências'); uniqueIds(project.proposals, 'propostas');
  for (const card of project.cards) { uniqueIds(card.blocks, 'blocos'); uniqueIds(card.blocks.flatMap(block => block.items ?? []), 'itens'); }
  const now = timestamp();
  const validIds = new Set(project.sources.map(source => source.id));
  const cards = sourceReferences(normalizeCards(project.cards), validIds);
  const cardIds = new Set(cards.map(card => card.id));
  const imported = { ...project, id: uid('project'), title: `${project.title.slice(0, 185)} · cópia`, createdAt: now, updatedAt: now, version: 0, cards,
    sources: project.sources.map(source => ({ ...source, verified: false })),
    evidence: project.evidence.map(item => ({ ...item, cardId: item.cardId && cardIds.has(item.cardId) ? item.cardId : undefined })),
    // External proposals may carry destructive or obsolete operations; keep historical decisions only.
    proposals: project.proposals.map(item => ({ ...item, status: item.status === 'pending' ? 'rejected' as const : item.status })), revisions: [] };
  return copy(imported);
}

export function exportProject(project: Project): string {
  const safe = parseProject(project);
  return JSON.stringify({ format: 'create-project', formatVersion: 1, exportedAt: timestamp(), project: safe }, null, 2);
}

const slots: Array<{ key: keyof Context; question: string }> = [
  { key: 'audience', question: 'Quem você quer ajudar? Descreva um grupo de pessoas e uma situação concreta.' },
  { key: 'city', question: 'Em qual cidade ou comunidade você pretende começar? Se for online, pode dizer isso.' },
  { key: 'budget', question: 'Quanto você pode investir no primeiro teste, sem comprometer seus gastos essenciais? “Ainda não sei” também vale.' },
  { key: 'availability', question: 'Quanto tempo por semana você tem para testar essa ideia?' },
  { key: 'constraints', question: 'Existe alguma restrição importante, como horário, espaço ou experiência?' },
];

/** Honest offline aid. This does not pretend to be an AI reply or web research. */
export function fallbackTurn(project: Project, text: string, kind?: string): TurnResult {
  const value = cleanString(text);
  if (!project.messages.some(message => message.role === 'assistant') && value === project.context.idea.trim()) return {
    mode: 'fallback', route: 'clarify', sources: [], operations: [],
    reply: 'Sua ideia já tem um ponto de partida. Estou no modo de orientação básica enquanto a IA está indisponível. Para deixar o primeiro teste mais útil: quem você quer ajudar?',
  };
  if (kind === 'research' || /\b(pesquise|pesquisar|fontes|fornecedores|contatos)\b/i.test(value)) return { mode: 'fallback', route: 'research', sources: [], operations: [], reply: 'A pesquisa com IA está indisponível neste momento. Não consultei fontes externas. Você pode adicionar links encontrados por você ao plano; o conteúdo atual continua salvo.' };
  if (kind === 'evidence' || project.evidence.length && !project.cards.some(card => card.kind === 'action' && card.lane === 'now')) {
    const evidence = project.evidence.at(-1);
    const action = makeCard('action', 'Investigar o que mudou', 'Use o relato para escolher a próxima pergunta, sem assumir validação.', [paragraph('Compare o que você esperava com o que observou. Separe fatos de interpretações e procure um exemplo que contrarie a hipótese.'), checklist(['Reler o relato e destacar comportamentos observados', 'Escrever uma hipótese que o resultado enfraqueceu ou fortaleceu', 'Conversar com mais uma pessoa para investigar essa diferença', 'Registrar o novo resultado'])], 'now', evidence?.cardId ? [evidence.cardId] : []);
    action.status = 'ready';
    return { mode: 'fallback', route: 'review', sources: [], operations: [], proposal: { title: 'Um próximo teste para investigar o relato', reason: 'Orientação básica, sem avaliação por IA. A evidência ainda precisa ser interpretada e comparada com outras observações.', operations: [{ op: 'add', cardId: action.id, card: action }] }, reply: 'Seu relato foi registrado. Completar a atividade não significa que o negócio está validado. Deixei uma sugestão de próximo teste para você revisar. O que aconteceu diferente do que você esperava?' };
  }
  const missing = slots.find(slot => !project.context[slot.key]);
  if (missing) {
    const contextPatch = { [missing.key]: value || 'Ainda não sei' };
    const next = slots.find(slot => slot.key !== missing.key && !project.context[slot.key]);
    const contextCard = project.cards.find(card => card.kind === 'context');
    const blocks = contextCard ? [...contextCard.blocks, paragraph(`${missing.key === 'audience' ? 'Público' : missing.key === 'city' ? 'Local' : missing.key === 'budget' ? 'Orçamento' : missing.key === 'availability' ? 'Tempo disponível' : 'Restrições'}: ${contextPatch[missing.key]}`)] : [];
    const operations: CardOperation[] = contextCard ? [{ op: 'update', cardId: contextCard.id, expectedRevision: contextCard.revision, patch: { blocks } }] : [];
    if (!next && !project.cards.some(card => card.kind === 'action')) {
      const known = { ...project.context, ...contextPatch };
      const action = makeCard('action', 'Conhecer uma experiência real', 'Orientação básica: escute alguém do público informado antes de investir.', [
        paragraph(`Ideia: ${known.idea}`),
        paragraph(`Procure uma pessoa de ${known.audience || 'seu público'}${known.city ? ` em ${known.city}` : ''}. Pergunte sobre a última vez em que enfrentou o problema que você quer resolver, como lidou com ele e qual dificuldade teve. Evite apresentar sua solução antes de ouvir a história.`),
        checklist(['Escolher uma pessoa do público informado', 'Ouvir uma experiência passada sem induzir a resposta', 'Anotar os fatos e as dúvidas que surgiram', 'Registrar o resultado no plano']),
        { id: uid('block'), type: 'callout', text: 'Este é um roteiro básico disponível sem IA. Adapte-o ao seu contexto. Não foram consultadas fontes nem confirmada a demanda.' },
      ], 'now', contextCard ? [contextCard.id] : []);
      action.status = 'ready';
      operations.push({ op: 'add', cardId: action.id, card: action });
    }
    return { mode: 'fallback', route: 'clarify', sources: [], contextPatch, operations, reply: `Anotei essa informação no contexto. ${next?.question ?? 'Organizei um primeiro teste no canvas com o contexto que você informou. Este é um roteiro básico enquanto a IA está indisponível. Você pode adaptá-lo e trazer o que aconteceu.'}` };
  }
  return { mode: 'fallback', route: 'respond', sources: [], operations: [], reply: 'Estou no modo de orientação básica enquanto a IA está indisponível. Sua ação atual continua no canvas: procure experiências reais, registre o que aconteceu e use esse resultado para revisar sua ideia. Qual dificuldade você encontrou ao começar?' };
}

export function isPublicSourceUrl(url: string): boolean { return httpUrlSchema.safeParse(url).success; }
