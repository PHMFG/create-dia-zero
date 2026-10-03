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
function cardLayoutHeight(card:CanvasCard):number {
  const checklist=card.blocks.filter(b=>b.type==='checklist').flatMap(b=>b.items??[]).slice(0,3);
  const callout=!checklist.length?card.blocks.find(b=>b.type==='callout'):undefined;
  const explicit=card.blocks.filter(b=>['link','image','location'].includes(b.type));
  const image=explicit.find(b=>b.type==='image'),location=explicit.find(b=>b.type==='location');
  const links=explicit.filter(b=>b.type==='link');
  const media=image?[image,location??links[0]].filter(Boolean):location?[location,links[0]].filter(Boolean):links.slice(0,2);
  // Match the compact visual preview: 320px cards, 22px auto-height titles,
  // three summary lines, two checklist lines/item, and at most two media blocks.
  const titleLines=Math.min(3,Math.max(1,Math.ceil(card.title.length/24)));
  return 160+titleLines*28+Math.min(3,Math.max(1,Math.ceil(card.summary.length/30)))*24
    +checklist.reduce((height,item)=>height+Math.max(44,Math.min(2,Math.max(1,Math.ceil(item.text.length/27)))*22+10),0)
    +(checklist.length?14+(checklist.length-1)*8:0)
    +(card.blocks.filter(b=>b.type==='checklist').flatMap(b=>b.items??[]).length>3?30:0)
    +(callout?Math.min(3,Math.max(1,Math.ceil((callout.text?.length??0)/30)))*22+40:0)
    +media.reduce((height,b)=>height+(b?.type==='image'?200:b?.type==='location'?180:130),0)
    +(media.length?14+(media.length-1)*8:0);
}
/** Explicit layout command. Cards dragged by a human keep their exact position. */
export function organizeCards(cards: CanvasCard[]): CanvasCard[] {
  const placed = cards.filter(card => card.pinnedPosition).map(card => ({ ...card.position,height:cardLayoutHeight(card) }));
  const row = { now: 0, next: 0, later: 0, done: 0 };
  return cards.map(card => {
    if (card.pinnedPosition) return copy(card);
    const height=cardLayoutHeight(card);
    const position = { x: laneX[card.lane], y: Math.max(48,row[card.lane]) };
    for(;;){
      const collision=placed.find(item=>Math.abs(item.x-position.x)<350&&position.y<item.y+item.height+48&&position.y+height+48>item.y);
      if(!collision)break;
      position.y=collision.y+collision.height+48;
    }
    row[card.lane]=position.y+height+48;placed.push({...position,height});
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
  const normalizedCards = normalizeCards(cards);
  const cardIds = new Set(normalizedCards.map(card => card.id));
  return { ...project, version: project.version + 1, updatedAt: now, cards: normalizedCards,
    messages: project.messages.map(message => message.cardId && !cardIds.has(message.cardId) ? { ...message, cardId: undefined } : message), context,
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
  const project = createProject('Chabor — uma marca cozy de matcha para descobrir sabores e fazer uma pausa.');
  project.title = 'Chabor · demonstração'; project.demo = true;
  project.context = { ...project.context, audience: 'Exemplo: estudantes e jovens profissionais curiosos sobre matcha', city: 'Porto Alegre (região de exemplo)', budget: 'R$ 3.000 disponíveis no cenário; nenhum valor foi gasto', availability: 'Duas tardes por semana (exemplo)', goal: 'Aprender se uma oferta simples desperta interesse suficiente para justificar outro teste' };
  const context = project.cards[0];
  context.title = 'Ideia · uma pausa com matcha';
  context.summary = 'Uma marca cozy de matcha em Porto Alegre. Este projeto é um exemplo guiado; público, região e orçamento são dados ilustrativos.';
  context.blocks = [
    paragraph('Ponto de partida: bebidas com matcha, sabores fáceis de explorar e um ritual acolhedor de pausa.'),
    { id: uid('block'), type: 'callout', text: 'Exemplo didático: nenhuma operação, entrevista ou venda da Chabor aconteceu de verdade.' },
    { id: uid('block'), type: 'location', address: 'Porto Alegre, Rio Grande do Sul, Brasil', caption: 'Região de exemplo, sem endereço ou marcador específico.' },
  ];
  const hypothesis = makeCard('hypothesis', 'Hipótese · curiosidade vira intenção?', 'Uma oferta pequena e acolhedora pode interessar a pessoas que já compram bebidas fora de casa.', [
    paragraph('Hipótese a investigar: estudantes e jovens profissionais de Porto Alegre podem querer experimentar matcha se entenderem o sabor, o preço e onde encontrar a bebida.'),
    paragraph('O que ainda não sabemos: familiaridade com matcha, ocasião de consumo, faixa de preço aceitável e barreiras para experimentar.'),
    { id: uid('block'), type: 'callout', text: 'É uma pergunta de trabalho, não uma conclusão sobre o público.' },
  ], 'done', [context.id]);
  const sebraeId = uid('source');
  const sebraeUrl = 'https://sebrae.com.br/sites/PortalSebrae/cursosonline/analise-de-negocio-pesquisa-de-mercado%2Cf380b8a6a28bb610VgnVCM1000004c00210aRCRD?codSegmento=8&origem=segmento';
  const research = makeCard('research', 'Pesquisa · preparar perguntas sem induzir', 'Roteiro de descoberta e referências para consulta; nenhuma fonte sustenta uma conclusão sobre a Chabor.', [
    paragraph('Referência manual: “The Mom Test”, de Rob Fitzpatrick, como inspiração para perguntar sobre comportamentos passados em vez de elogios à ideia.'),
    { id: uid('block'), type: 'link', url: sebraeUrl, caption: 'Sebrae · curso sobre pesquisa de mercado. Link institucional conferido; conteúdo não usado para validar a hipótese da Chabor.', sourceIds: [sebraeId] },
    { id: uid('block'), type: 'callout', text: 'Pista de leitura, não evidência do mercado local. As conversas e conclusões deste quadro continuam sendo fictícias.' },
  ], 'done', [hypothesis.id]);
  const interview = makeCard('action', 'Teste concluído · entrevista de exemplo', 'Roteiro demonstrativo com três conversas fictícias sobre compras recentes de bebidas.', [
    { id: uid('block'), type: 'heading', text: 'Roteiro executável' },
    paragraph('Se fosse conduzir entrevistas reais em Porto Alegre, convide pessoas do público escolhido e peça autorização para anotar. Não apresente a solução até entender o episódio passado.'),
    checklist([
      'Conte sobre a última bebida que comprou fora de casa. Quando e onde foi?',
      'O que estava acontecendo e o que fez você escolher aquele lugar ou bebida?',
      'Quanto pagou? O que quase fez você escolher outra opção?',
      'Como resolveu a vontade depois? O que foi frustrante ou conveniente?',
    ]),
    { id: uid('block'), type: 'callout', text: 'Nesta tela, a atividade aparece concluída apenas para contar a história do exemplo; nenhuma entrevista real foi feita.' },
  ], 'done', [research.id]);
  interview.blocks.find(block => block.type === 'checklist')!.items!.forEach(item => { item.checked = true; });
  interview.status = 'done';
  const evidenceCard = makeCard('evidence', 'Relato simulado · três conversas fictícias', 'Exemplo inventado para ensinar a separar observação, interpretação e lacuna.', [
    paragraph('Relato fictício A: “Queria algo gelado no intervalo; escolhi o lugar conhecido porque estava com pressa.” Relato fictício B: “Provei matcha uma vez, mas não sabia o que esperar do sabor.”'),
    paragraph('Relato fictício C: “Eu comparo o preço com café e normalmente decido pelo que cabe no caminho.” Estas frases foram criadas para a demonstração; não pertencem a entrevistados.'),
    { id: uid('block'), type: 'callout', text: 'Evidência simulada, não pesquisa de mercado. Não generalize para estudantes ou jovens profissionais de Porto Alegre.' },
  ], 'done', [interview.id]);
  const learning = makeCard('note', 'Leitura do exemplo · o que falta saber', 'As frases fictícias sugerem perguntas melhores, mas não estimam demanda.', [
    paragraph('Possíveis pistas a verificar: conveniência do local, clareza sobre o sabor e comparação de preço com bebidas conhecidas.'),
    paragraph('Lacunas: frequência dessas necessidades, resposta a uma oferta concreta, disposição de deixar contato e diferença entre curiosidade e intenção de compra.'),
    { id: uid('block'), type: 'callout', text: 'As pistas derivam de relatos inventados. Só observações reais podem atualizar esta leitura.' },
  ], 'done', [evidenceCard.id]);
  const decision = makeCard('decision', 'Decisão de exemplo · testar interesse gratuito', 'Não comprar equipamentos nem abrir um pop-up. Primeiro, observar uma ação pequena e reversível.', [
    paragraph('Decisão ilustrativa baseada somente no relato simulado: preparar uma descrição simples da bebida e medir quantas pessoas aceitariam entrar gratuitamente numa lista de interesse.'),
    paragraph('Se poucas pessoas se interessarem, revisar sabor explicado, ocasião e público. Se houver interesse, ainda será preciso testar preço, operação e retorno em um experimento posterior.'),
    { id: uid('block'), type: 'callout', text: 'Esta decisão não foi validada. Não houve pré-reservas, pagamentos, clientes nem venda.' },
  ], 'done', [evidenceCard.id, learning.id]);
  const offer = makeCard('note', 'Oferta ilustrativa · números para planejar', 'Cenários hipotéticos ajudam a formular perguntas; não são preços aceitos nem custos cotados.', [
    paragraph('Cenário A (hipótese): preço R$ 16 − ingredientes e copo R$ 6 = R$ 10 de margem de contribuição por bebida, antes de taxas, trabalho e custos fixos.'),
    paragraph('Cenário B (hipótese): preço R$ 20 − ingredientes e copo R$ 8 = R$ 12 antes dos demais custos. Os valores são redondos e fictícios, não pesquisa com fornecedores.'),
    { id: uid('block'), type: 'callout', text: 'Não cobrar nesta etapa. Uma lista gratuita mede um sinal inicial de interesse, não compra, margem real ou viabilidade.' },
  ], 'next', [decision.id]);
  const action = makeCard('action', 'Agora · testar uma pré-reserva gratuita', 'Convide dez pessoas a sinalizar interesse sem pagar.', [
    { id: uid('block'), type: 'heading', text: 'Um teste simples, antes de vender' },
    paragraph('Crie uma imagem ou mensagem simples com a ideia de uma bebida gelada de matcha, sabor explicado em linguagem direta e uma faixa de preço hipotética. Em Porto Alegre, mostre a dez pessoas que se encaixem no público escolhido.'),
    checklist([
      'Escrever a oferta e dizer que é um conceito em teste, ainda sem produto à venda',
      'Perguntar: “Você quer deixar seu contato para receber novidades?”; anotar sim, não ou dúvida',
      'Se a pessoa quiser, registrar interesse numa lista gratuita; não pedir pagamento nem prometer data',
      'Anotar quantas pessoas viram a oferta e as razões para aceitar, recusar ou hesitar',
    ]),
    { id: uid('block'), type: 'callout', text: 'Critério apenas ilustrativo: observar pelo menos 4 manifestações gratuitas entre 10 convites para decidir se vale testar outra versão. Qualquer resultado será um sinal inicial e não valida a hipótese.' },
  ], 'now', [decision.id, offer.id]);
  action.status = 'ready';
  const measure = makeCard('note', 'Depois do teste · registrar e decidir', 'Próximo ciclo: comparar o que aconteceu com a hipótese e escolher uma pergunta mais estreita.', [
    paragraph('Registre data, contexto, número de convites, respostas e frases exatas. Separe respostas observadas de explicações que você inferiu.'),
    paragraph('Depois, decida: ajustar a mensagem, conversar sobre preço ou encerrar a hipótese. Não transforme curiosidade em previsão de vendas.'),
    { id: uid('block'), type: 'callout', text: 'Este passo ainda não aconteceu. Só avance quando houver respostas reais e consentidas.' },
  ], 'next', [action.id]);
  const cards = [context, hypothesis, research, interview, evidenceCard, learning, decision, offer, action, measure];
  // Coluna principal de cima para baixo e ramificações laterais; cada faixa tem
  // espaço conservador para os cartões altos sem depender de pin de posição humana.
  const positions: Record<string, { x: number; y: number }> = {
    [context.id]: { x: 80, y: 70 },
    [hypothesis.id]: { x: 80, y: 710 },
    [research.id]: { x: 80, y: 1350 },
    [interview.id]: { x: 80, y: 1990 },
    [evidenceCard.id]: { x: 80, y: 2630 },
    [learning.id]: { x: 500, y: 3270 },
    [decision.id]: { x: 80, y: 3910 },
    [offer.id]: { x: 500, y: 4550 },
    [action.id]: { x: 80, y: 5190 },
    [measure.id]: { x: 80, y: 5830 },
  };
  for (const card of cards) { card.position = positions[card.id]; card.origin = 'demo'; }
  project.cards = cards;
  project.evidence = [{ id: uid('evidence'), cardId: evidenceCard.id, type: 'interview', text: 'Registro didático: relatos A, B e C descritos no cartão são inteiramente fictícios; nenhuma entrevista aconteceu.', links: [], createdAt: timestamp(), origin: 'demo' }];
  project.sources = [{ id: sebraeId, title: 'Sebrae · Análise de negócio: pesquisa de mercado', url: sebraeUrl, consultedAt: timestamp(), excerpt: 'Referência institucional para consultar sobre pesquisa de mercado; não foi usada como evidência sobre a hipótese da Chabor.', verified: false }];
  project.messages = [{ id: uid('message'), role: 'assistant', text: 'Este projeto apresenta o ciclo ideia → hipótese → teste → evidência → decisão → novo teste. Os relatos e valores são fictícios. Agora, a única ação proposta é medir interesse numa lista gratuita, sem cobrança e sem alegar validação.', createdAt: timestamp() }];
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
  for (const item of result.sources) {
    const url=new URL(item.url).href,index=sources.findIndex(source=>source.id===item.id);
    if(index<0)sources.push({...item,url});
    else if(new URL(sources[index].url).href===url)sources[index]={...sources[index],...item,url,imageUrl:item.imageUrl??sources[index].imageUrl};
  }
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
  next.messages = [...next.messages, { id: uid('message'), role: 'assistant', text: cleanString(result.reply), createdAt: timestamp(), sourceIds: result.sources.map(source => source.id) }];
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
  uniqueIds(project.cards, 'cartões'); uniqueIds(project.sources, 'fontes'); uniqueIds(project.evidence, 'evidências'); uniqueIds(project.proposals, 'propostas'); uniqueIds(project.messages, 'mensagens');
  for (const card of project.cards) { uniqueIds(card.blocks, 'blocos'); uniqueIds(card.blocks.flatMap(block => block.items ?? []), 'itens'); }
  const now = timestamp();
  const validIds = new Set(project.sources.map(source => source.id));
  const cards = sourceReferences(normalizeCards(project.cards), validIds);
  const cardIds = new Set(cards.map(card => card.id));
  const imported = { ...project, id: uid('project'), title: `${project.title.slice(0, 185)} · cópia`, createdAt: now, updatedAt: now, version: 0, cards,
    sources: project.sources.map(source => ({ ...source, verified: false })),
    evidence: project.evidence.map(item => ({ ...item, cardId: item.cardId && cardIds.has(item.cardId) ? item.cardId : undefined })),
    // Orphaned card conversations would be hidden from both the main chat and a card drawer.
    // Keep their messages visible in the main conversation, and discard only dead source links.
    messages: project.messages.map(message => ({ ...message,
      cardId: message.cardId && cardIds.has(message.cardId) ? message.cardId : undefined,
      sourceIds: message.sourceIds?.filter(id => validIds.has(id)),
    })),
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
