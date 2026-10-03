import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../shared/domain';
import { auditDependencyGraph } from '../shared/canvasConnections';
import { parseProject } from '../shared/validation';

describe('Chabor example project', () => {
  it('parses a complete, transparent seven-kind walkthrough with a valid prerequisite graph', () => {
    const demo = parseProject(createDemoProject());
    expect(demo.demo).toBe(true);
    expect(demo.context.city).toContain('Porto Alegre');
    expect(demo.context.budget).toContain('R$ 3.000');
    expect(demo.cards).toHaveLength(10);
    expect(new Set(demo.cards.map(card => card.kind))).toEqual(new Set([
      'context', 'hypothesis', 'research', 'action', 'evidence', 'decision', 'note',
    ]));
    expect(demo.cards.every(card => card.blocks.length >= 2 && card.blocks.length <= 5)).toBe(true);
    expect(auditDependencyGraph(demo.cards)).toEqual({ valid: true, issues: [] });
    expect(demo.cards.every(card => card.origin === 'demo' && !card.pinnedPosition)).toBe(true);
    expect(demo.evidence.every(item => item.origin === 'demo')).toBe(true);
    expect(demo.sources.every(source => source.verified === false)).toBe(true);
    expect(demo.sources).toHaveLength(1);
    expect(demo.cards.find(card => card.kind === 'context')?.blocks.some(block => block.type === 'location' && block.address?.includes('Porto Alegre') && block.latitude === undefined && block.longitude === undefined)).toBe(true);
    expect(demo.cards.find(card => card.kind === 'research')?.blocks.some(block => block.type === 'link' && block.url?.startsWith('https://sebrae.com.br/'))).toBe(true);
    expect(demo.cards.every(card => card.position.x >= 0 && card.position.x <= 3000 && card.position.y >= 0 && card.position.y <= 6500)).toBe(true);

    const boxes = demo.cards.map(card => ({ card, width: 320, height: conservativeCardHeight(card) }));
    expect(boxes.every(box => box.height < 640)).toBe(true);
    const boxById = new Map(boxes.map(box => [box.card.id, box]));
    for (const box of boxes) for (const dependencyId of box.card.dependsOn) {
      expect(box.card.position.y, `${box.card.title} must appear below its prerequisite`).toBeGreaterThan(boxById.get(dependencyId)!.card.position.y + boxById.get(dependencyId)!.height);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.card.position.x < b.card.position.x + b.width && a.card.position.x + a.width > b.card.position.x
        && a.card.position.y < b.card.position.y + b.height && a.card.position.y + a.height > b.card.position.y;
      expect(overlap, `${a.card.title} overlaps ${b.card.title}`).toBe(false);
    }
  });

  it('makes one actionable current step from the example decision without inventing a sale or validation', () => {
    const demo = createDemoProject();
    const now = demo.cards.filter(card => card.kind === 'action' && card.lane === 'now');
    expect(now).toHaveLength(1);
    expect(now[0].status).toBe('ready');
    expect(now[0].title).toContain('pré-reserva gratuita');
    const text = [now[0].title, now[0].summary, ...now[0].blocks.map(block => block.text ?? ''), ...now[0].blocks.flatMap(block => block.items?.map(item => item.text) ?? [])].join(' ');
    expect(text).toMatch(/dez pessoas/i);
    expect(text).toMatch(/sem pagar|gratuita/i);
    expect(text).toMatch(/não pedir pagamento/i);
    expect(text).toMatch(/não valida/i);
    expect(demo.evidence).toHaveLength(1);
    expect(demo.evidence[0].text).toMatch(/fictícios|fictícias/i);
    expect(demo.evidence[0].text).not.toMatch(/venda validada|compra realizada/i);
    expect(demo.cards.find(card => card.title.includes('entrevista de exemplo'))?.status).toBe('done');
    expect(demo.cards.find(card => card.title.includes('entrevista de exemplo'))?.blocks.flatMap(block => block.items ?? []).every(item => item.checked && !item.humanEdited)).toBe(true);
  });

  it('connects the worked example in prerequisite direction and gives each generation fresh IDs', () => {
    const first = createDemoProject();
    const second = createDemoProject();
    const byTitle = new Map(first.cards.map(card => [card.title, card]));
    const idOf = (title: string) => byTitle.get(title)!.id;
    expect(byTitle.get('Hipótese · curiosidade vira intenção?')!.dependsOn).toEqual([idOf('Ideia · uma pausa com matcha')]);
    expect(byTitle.get('Pesquisa · preparar perguntas sem induzir')!.dependsOn).toEqual([idOf('Hipótese · curiosidade vira intenção?')]);
    expect(byTitle.get('Teste concluído · entrevista de exemplo')!.dependsOn).toEqual([idOf('Pesquisa · preparar perguntas sem induzir')]);
    expect(byTitle.get('Decisão de exemplo · testar interesse gratuito')!.dependsOn).toEqual([
      idOf('Relato simulado · três conversas fictícias'), idOf('Leitura do exemplo · o que falta saber'),
    ]);
    expect(byTitle.get('Agora · testar uma pré-reserva gratuita')!.dependsOn).toEqual([
      idOf('Decisão de exemplo · testar interesse gratuito'), idOf('Oferta ilustrativa · números para planejar'),
    ]);
    const firstIds = allDemoIds(first), secondIds = allDemoIds(second);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(new Set(secondIds).size).toBe(secondIds.length);
    const secondIdSet = new Set(secondIds);
    expect(firstIds.some(id => secondIdSet.has(id))).toBe(false);
  });
});

// Deliberately generous visual estimate for detecting layout collisions in this fixed demo.
function conservativeCardHeight(card: ReturnType<typeof createDemoProject>['cards'][number]): number {
  // Fixed preview height plus explicit media and checklist allowances for this demo.
  const media = card.blocks.some(block => ['link', 'image', 'location'].includes(block.type)) ? 180 : 0;
  const items = card.blocks.flatMap(block => block.items ?? []).length;
  const checklistAllowance = items * 22;
  const titleAndBodyAllowance = Math.ceil((card.title.length + card.summary.length) / 50) * 24;
  return 320 + media + checklistAllowance + titleAndBodyAllowance;
}

function allDemoIds(project: ReturnType<typeof createDemoProject>): string[] {
  return [project.id, ...project.cards.flatMap(card => [card.id, ...card.blocks.flatMap(block => [block.id, ...(block.items?.map(item => item.id) ?? [])])]),
    ...project.evidence.map(item => item.id), ...project.messages.map(message => message.id), ...project.sources.map(source => source.id)];
}
