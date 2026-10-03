import { describe, expect, it } from 'vitest';
import { applyHumanEdit, applyTurn, createDemoProject, createProject, exportProject, fallbackTurn, importProject, makeCard, organizeCards, recordEvidence, resolveProposal } from '../shared/domain';
import { parseTurnResult } from '../shared/validation';
import type { TurnResult } from '../shared/types';

const result = (patch: Partial<TurnResult>): TurnResult => ({ reply: 'Atualizei o plano.', operations: [], sources: [], mode: 'live', ...patch });
// Explicit behavioral fixture. Fresh user projects deliberately have no fixed action.
function projectWithAction(idea: string) {
  const project = createProject(idea);
  const hypothesis = makeCard('hypothesis', 'Hipótese em investigação', 'Precisamos ouvir experiências reais.', [], 'next', [project.cards[0].id]);
  const action = makeCard('action', 'Primeiro teste escolhido', 'Uma ação específica para este cenário.', [{ id: 'fixture-checklist', type: 'checklist', items: [{ id: 'fixture-step', text: 'Registrar uma experiência real', checked: false }] }], 'now', [hypothesis.id]);
  action.status = 'ready';
  return { ...project, cards: organizeCards([...project.cards, hypothesis, action]) };
}

describe('create project domain', () => {
  it('enriches an already published source without replacing its address',()=>{
    const project=createProject('Uma loja local');
    const source={id:'real-page',title:'Página consultada',url:'https://example.com/',excerpt:'Trecho da busca',consultedAt:new Date().toISOString(),verified:true};
    project.sources=[source];
    const enriched=applyTurn(project,result({sources:[{...source,excerpt:'Texto adicional obtido da página',imageUrl:'https://example.com/image.jpg'}]}));
    expect(enriched.sources).toHaveLength(1);expect(enriched.sources[0].excerpt).toBe('Texto adicional obtido da página');expect(enriched.sources[0].imageUrl).toBe('https://example.com/image.jpg');
    const mismatched=applyTurn(enriched,result({sources:[{...source,url:'https://other.example.com/'}]}));
    expect(mismatched.sources[0].url).toBe(source.url);
  });
  it('leaves space around a reference card when organizing new cards',()=>{
    const project=createProject('Uma loja local');const reference=makeCard('note','Referências visuais','Links e imagens para estudar.',[{id:'photo',type:'image',url:'https://example.com/photo.jpg'}],'next');
    reference.position={x:430,y:48};reference.pinnedPosition=true;
    const following=makeCard('note','Próxima anotação','Conteúdo para a investigação.',[],'next');
    const arranged=organizeCards([reference,following]);
    expect(arranged[0].position).toEqual(reference.position);
    expect(arranged[1].position.y).toBeGreaterThan(reference.position.y+400);
  });
  it('starts with the user idea and adds model-created cards progressively', () => {
    const project = createProject('Quero criar um programa de mentoria para designers');
    expect(project.cards).toHaveLength(1);
    expect(project.cards[0].kind).toBe('context');
    expect(project.cards.some(card => card.kind === 'action' || card.kind === 'hypothesis')).toBe(false);
    const hypothesis = makeCard('hypothesis', 'Designers precisam de retorno prático', 'Investigar como designers iniciantes buscam mentoria.', [], 'next', [project.cards[0].id]);
    const action = makeCard('action', 'Investigar a última busca por feedback', 'Ouvir uma experiência específica de um designer iniciante.', [], 'now', [hypothesis.id]); action.status = 'ready';
    const next = applyTurn(project, result({ contextPatch: { audience: 'Designers iniciantes' }, operations: [{ op: 'add', cardId: hypothesis.id, card: hypothesis }, { op: 'add', cardId: action.id, card: action }] }));
    expect(next.cards).toHaveLength(3);
    expect(next.cards.find(card => card.id === action.id)?.lane).toBe('now');
    expect(next.cards.find(card => card.id === action.id)?.status).toBe('ready');
    expect(next.proposals).toHaveLength(0);
    expect(project.cards).toHaveLength(1);
  });

  it('protects a user title against a late AI update and makes an actionable proposal', () => {
    const original = projectWithAction('Quero criar um clube de leitura');
    const action = original.cards.find(card => card.kind === 'action')!;
    const edited = applyHumanEdit(original, original.cards.map(card => card.id === action.id ? { ...card, title: 'Meu primeiro encontro' } : card));
    const next = applyTurn(edited, result({ operations: [{ op: 'update', cardId: action.id, expectedRevision: action.revision, patch: { title: 'Título sugerido', summary: 'Uma sugestão útil' } }] }));
    expect(next.cards.find(card => card.id === action.id)?.title).toBe('Meu primeiro encontro');
    expect(next.proposals).toHaveLength(1);
    expect(next.proposals[0].operations[0].patch).toEqual({ title: 'Título sugerido', summary: 'Uma sugestão útil' });
    const accepted = resolveProposal(next, next.proposals[0].id, true);
    expect(accepted.cards.find(card => card.id === action.id)?.title).toBe('Título sugerido');
    expect(accepted.cards.find(card => card.id === action.id)?.humanEdited).toBe(true);
    expect(accepted.proposals[0].status).toBe('accepted');
    expect(resolveProposal(accepted, next.proposals[0].id, true)).toBe(accepted);
  });

  it('preserves checked human items even when accepting replacement content', () => {
    const project = projectWithAction('Uma oficina para bicicletas');
    const action = project.cards.find(card => card.kind === 'action')!;
    const block = action.blocks.find(block => block.type === 'checklist')!;
    const itemId = block.items![0].id;
    const edited = applyHumanEdit(project, project.cards.map(card => card.id !== action.id ? card : { ...card, blocks: card.blocks.map(item => item.id !== block.id ? item : { ...item, items: item.items!.map(check => check.id === itemId ? { ...check, checked: true } : check) }) }));
    const next = applyTurn(edited, result({ operations: [{ op: 'update', cardId: action.id, expectedRevision: edited.cards.find(card => card.id === action.id)!.revision, patch: { blocks: [] } }] }));
    const accepted = resolveProposal(next, next.proposals[0].id, true);
    expect(accepted.cards.find(card => card.id === action.id)?.blocks.flatMap(block => block.items ?? []).find(item => item.id === itemId)?.checked).toBe(true);
  });

  it('rejects a proposal without modifying content', () => {
    const project = projectWithAction('Uma horta comunitária');
    const action = project.cards.find(card => card.kind === 'action')!;
    const next = applyTurn(project, result({ operations: [{ op: 'remove', cardId: action.id, expectedRevision: action.revision }] }));
    const rejected = resolveProposal(next, next.proposals[0].id, false);
    expect(rejected.cards).toEqual(project.cards);
    expect(rejected.proposals[0].status).toBe('rejected');
  });

  it('does not let an old proposal replace newer human edits on acceptance', () => {
    const project = projectWithAction('Uma escola de música');
    const action = project.cards.find(card => card.kind === 'action')!;
    const suggested = applyTurn(project, result({ proposal: { title: 'Revisar o teste', reason: 'Mais uma opção', operations: [{ op: 'update', cardId: action.id, patch: { title: 'Sugestão anterior' } }] } }));
    const edited = applyHumanEdit(suggested, suggested.cards.map(card => card.id === action.id ? { ...card, title: 'Decisão mais recente' } : card));
    expect(() => resolveProposal(edited, suggested.proposals[0].id, true)).toThrow('depois desta sugestão');
    expect(edited.cards.find(card => card.id === action.id)?.title).toBe('Decisão mais recente');
    expect(edited.proposals[0].status).toBe('pending');
    expect(resolveProposal(edited, suggested.proposals[0].id, false).proposals[0].status).toBe('rejected');
  });

  it('keeps one current action and repairs invalid graph relationships', () => {
    const project = projectWithAction('Aulas de desenho');
    const current = project.cards.find(card => card.kind === 'action')!;
    const extra = makeCard('action', 'Outro teste', 'Uma próxima atividade', [], 'now', ['missing', current.id]);
    const next = applyTurn(project, result({ operations: [{ op: 'add', cardId: extra.id, card: extra }, { op: 'add', cardId: extra.id, card: extra }] }));
    expect(next.cards.filter(card => card.kind === 'action' && card.lane === 'now')).toHaveLength(1);
    expect(next.cards.filter(card => card.id === extra.id)).toHaveLength(0);
    const accepted = resolveProposal(next, next.proposals[0].id, true);
    expect(accepted.cards.filter(card => card.id === extra.id)).toHaveLength(1);
    expect(accepted.cards.find(card => card.id === extra.id)?.dependsOn).toEqual([current.id]);
    const cyclic = applyHumanEdit(accepted, accepted.cards.map(card => card.id === current.id ? { ...card, dependsOn: [extra.id] } : card));
    const a = cyclic.cards.find(card => card.id === current.id)!;
    const b = cyclic.cards.find(card => card.id === extra.id)!;
    expect(a.dependsOn.includes(b.id) && b.dependsOn.includes(a.id)).toBe(false);
  });

  it('records evidence without pretending that the idea is validated', () => {
    const project = projectWithAction('Uma assinatura de refeições');
    const action = project.cards.find(card => card.kind === 'action')!;
    const next = recordEvidence(project, { cardId: action.id, type: 'interview', text: 'Duas pessoas preferem cozinhar em casa e uma disse que o preço não caberia no orçamento.' });
    expect(next.evidence).toHaveLength(1);
    expect(next.evidence[0].origin).toBe('user');
    expect(next.cards.find(card => card.id === action.id)?.status).toBe('done');
    expect(next.cards.find(card => card.kind === 'hypothesis')?.status).toBe('review');
    expect(next.cards.some(card => card.kind === 'decision')).toBe(false);
    const turn = fallbackTurn(next, 'O que faço agora?', 'evidence');
    expect(turn.mode).toBe('fallback');
    expect(turn.proposal).toBeDefined();
    expect(turn.reply).toContain('não significa');
  });

  it('does not convert complete checklists into evidence', () => {
    const project = projectWithAction('Ateliê de cerâmica');
    const next = applyHumanEdit(project, project.cards.map(card => card.kind !== 'action' ? card : { ...card, blocks: card.blocks.map(block => ({ ...block, items: block.items?.map(item => ({ ...item, checked: true })) })) }));
    expect(next.cards.find(card => card.kind === 'action')?.status).toBe('awaiting_evidence');
    expect(next.evidence).toHaveLength(0);
  });

  it('marks recommendations for review after context changes and resists restoring an old budget', () => {
    const project = createDemoProject();
    const research = makeCard('research', 'Formato possível', 'Um pop-up pequeno', [], 'next');
    const withResearch = applyTurn(project, result({ operations: [{ op: 'add', cardId: research.id, card: research }] }));
    const edited = applyHumanEdit(withResearch, withResearch.cards, { budget: 'R$ 500' });
    expect(edited.cards.find(card => card.id === research.id)?.status).toBe('review');
    const stale = applyTurn(edited, result({ contextPatch: { budget: 'R$ 3.000' } }), withResearch.context);
    expect(stale.context.budget).toBe('R$ 500');
    const explicitLater = applyTurn(stale, result({ contextPatch: { budget: 'R$ 800' } }), stale.context);
    expect(explicitLater.context.budget).toBe('R$ 800');
  });

  it('changes the current action atomically only after accepting its grouped proposal', () => {
    const project = projectWithAction('Uma comunidade de ciclistas');
    const before = project.cards.find(card => card.kind === 'action')!;
    const after = makeCard('action', 'Testar uma oferta', 'Investigue uma compra real.', [], 'now');
    const next = applyTurn(project, result({ operations: [
      { op: 'update', cardId: before.id, expectedRevision: before.revision, patch: { lane: 'next' } },
      { op: 'add', cardId: after.id, card: after },
    ] }));
    expect(next.cards.find(card => card.id === before.id)?.lane).toBe('now');
    expect(next.cards.some(card => card.id === after.id)).toBe(false);
    expect(next.proposals).toHaveLength(1);
    expect(next.proposals[0].operations).toHaveLength(2);
    const accepted = resolveProposal(next, next.proposals[0].id, true);
    expect(accepted.cards.find(card => card.id === before.id)?.lane).toBe('next');
    expect(accepted.cards.find(card => card.id === after.id)?.lane).toBe('now');
    expect(accepted.cards.filter(card => card.kind === 'action' && card.lane === 'now')).toHaveLength(1);
  });

  it('invalidates a recommendation proposal when its context changes', () => {
    const project = createDemoProject();
    const action = project.cards.find(card => card.kind === 'action' && card.lane === 'now')!;
    const proposed = applyTurn(project, result({ proposal: { title: 'Preparar um pop-up', reason: 'Com o orçamento atual', operations: [{ op: 'update', cardId: action.id, patch: { summary: 'Comprar equipamentos de R$ 2.000' } }] } }));
    const changed = applyHumanEdit(proposed, proposed.cards, { budget: 'R$ 200' });
    expect(changed.cards.find(card => card.id === action.id)?.revision).toBeGreaterThan(action.revision);
    expect(() => resolveProposal(changed, proposed.proposals[0].id, true)).toThrow('depois desta sugestão');
  });

  it('keeps a proposal fresh when its own turn also updates the context', () => {
    const project = createDemoProject();
    const action = project.cards.find(card => card.kind === 'action' && card.lane === 'now')!;
    const next = applyTurn(project, result({ contextPatch: { budget: 'R$ 800' }, proposal: { title: 'Adaptar o teste', reason: 'Usar o orçamento atualizado', operations: [{ op: 'update', cardId: action.id, expectedRevision: action.revision, patch: { summary: 'Fazer um teste com custo abaixo de R$ 800' } }] } }));
    const accepted = resolveProposal(next, next.proposals[0].id, true);
    expect(accepted.proposals[0].status).toBe('accepted');
    expect(accepted.cards.find(card => card.id === action.id)?.summary).toContain('abaixo de R$ 800');
  });

  it('round trips a safe export as a separate project and rejects malformed imports', () => {
    const project = createProject('Conserto de roupas');
    const exported = exportProject(project);
    const imported = importProject(exported);
    expect(imported.id).not.toBe(project.id);
    expect(imported.context).toEqual(project.context);
    expect(imported.title).toContain('cópia');
    expect(() => importProject('{broken')).toThrow();
    expect(() => importProject({ ...project, cards: [{ ...project.cards[0], kind: 'script' }] })).toThrow();
    expect(() => importProject({ ...project, cards: [project.cards[0], project.cards[0]] })).toThrow('duplicados');
    expect(() => importProject({ ...project, sources: [{ id: 'unsafe', title: 'Fonte', url: 'javascript:alert(1)', consultedAt: new Date().toISOString(), excerpt: 'teste', verified: true }] })).toThrow();
    expect(() => importProject({ ...project, sources: [{ id: 'unsafe', title: 'Fonte', url: 'https://token:secret@example.com', consultedAt: new Date().toISOString(), excerpt: 'teste', verified: true }] })).toThrow();
    const withSource = importProject({ ...project, sources: [{ id: 'provided', title: 'Referência importada', url: 'https://example.com', consultedAt: new Date().toISOString(), excerpt: 'Texto informado pelo arquivo', verified: true }] });
    expect(withSource.sources[0].verified).toBe(false);
  });

  it('drops unrelated keys and unsupported references from model output', () => {
    const project = createProject('Uma escola de culinária');
    const note = makeCard('note', 'Notas', 'Observações', [{ id: 'b1', type: 'sources', sourceIds: ['invented'] }]);
    const parsed = parseTurnResult({ ...result({ operations: [{ op: 'add', cardId: note.id, card: note }] }), apiKey: 'should-never-export' });
    expect('apiKey' in parsed).toBe(false);
    const next = applyTurn(project, parsed);
    expect(next.cards.find(card => card.id === note.id)?.blocks[0].sourceIds).toEqual([]);
  });

  it('preserves manual positions when organizing or receiving new content', () => {
    const project = createProject('Uma feira de livros');
    const pinned = { ...project.cards[0], pinnedPosition: true, position: { x: 912, y: 243 } };
    const cards = [pinned, ...project.cards.slice(1)];
    expect(organizeCards(cards)[0].position).toEqual(pinned.position);
    const edited = applyHumanEdit(project, cards);
    const note = makeCard('note', 'Ideia secundária', 'Explorar depois', [], 'later');
    const next = applyTurn(edited, result({ operations: [{ op: 'add', cardId: note.id, card: note }] }));
    expect(next.cards[0].position).toEqual(pinned.position);
  });

  it('is explicit about fallback research and never invents sources', () => {
    const turn = fallbackTurn(createProject('Uma cafeteria'), 'Pesquise fornecedores');
    expect(turn.sources).toHaveLength(0);
    expect(turn.reply).toContain('Não consultei fontes');
  });

  it('does not mistake the initial idea for an answer about audience', () => {
    const project = createProject('Uma feira de artesanato');
    const turn = fallbackTurn(project, project.context.idea);
    expect(turn.contextPatch).toBeUndefined();
    expect(turn.reply).toContain('quem você quer ajudar');
  });

  it('keeps the explicit Chabor demo distinct from fresh project creation', () => {
    const demo = createDemoProject();
    expect(demo.demo).toBe(true);
    expect(demo.cards).toHaveLength(10);
    expect(demo.cards.every(card => card.origin === 'demo')).toBe(true);
    expect(demo.cards.filter(card => card.kind === 'action' && card.lane === 'now')).toHaveLength(1);
    expect(demo.evidence).toHaveLength(1);
    expect(demo.evidence[0].origin).toBe('demo');
    expect(demo.messages[0].text).toContain('fictícios');
  });

  it('creates the basic fallback action only after collecting the real context', () => {
    let project = createProject('Uma oficina de ilustração');
    const answers = ['Jovens interessados em desenho', 'Porto Alegre', 'R$ 300', 'Uma tarde por semana', 'Ainda não tenho um espaço'];
    for (const [index, answer] of answers.entries()) {
      project = applyTurn(project, fallbackTurn(project, answer));
      expect(project.cards.filter(card => card.kind === 'action')).toHaveLength(index === answers.length - 1 ? 1 : 0);
    }
    const action = project.cards.find(card => card.kind === 'action')!;
    expect(action.blocks.some(block => block.text?.includes('Jovens interessados em desenho'))).toBe(true);
    expect(action.blocks.some(block => block.text?.includes('roteiro básico'))).toBe(true);
    expect(action.status).toBe('ready');
    expect(project.sources).toHaveLength(0);
  });
});
