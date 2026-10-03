import { describe, expect, it } from 'vitest';
import { auditDependencyGraph, canConnect, connectionId, synchronizeCanvasNodes, validateConnection } from '../shared/canvasConnections';
import { makeCard } from '../shared/domain';

describe('canvas connection graph', () => {
  it('allows a dependency from prerequisite source to dependent target', () => {
    const a = makeCard('hypothesis', 'A', '', []); const b = makeCard('action', 'B', '', []);
    expect(canConnect([a, b], a.id, b.id)).toBe(true);
  });

  it('rejects missing cards, self links and an existing dependency', () => {
    const a = makeCard('note', 'A', '', []); const b = makeCard('action', 'B', '', [], 'next', [a.id]);
    expect(validateConnection([a, b], a.id, b.id)).toMatchObject({ valid: false, error: expect.stringContaining('já estão') });
    expect(canConnect([a, b], a.id, a.id)).toBe(false);
    expect(canConnect([a, b], 'missing', b.id)).toBe(false);
    expect(canConnect([a, b], a.id, undefined)).toBe(false);
  });

  it('allows the fiftieth dependency but rejects a fifty-first before it can fail project validation', () => {
    const prerequisites = Array.from({ length: 51 }, (_, index) => makeCard('note', `Pré-requisito ${index}`, '', []));
    const target = makeCard('action', 'Ação', '', [], 'next', prerequisites.slice(0, 49).map(card => card.id));
    expect(validateConnection([...prerequisites, target], prerequisites[49].id, target.id)).toEqual({ valid: true });
    target.dependsOn.push(prerequisites[49].id);
    expect(validateConnection([...prerequisites, target], prerequisites[50].id, target.id)).toMatchObject({ valid: false, error: expect.stringContaining('limite de 50') });
  });

  it('rejects a cycle across several cards without preventing a valid branch', () => {
    const a = makeCard('context', 'A', '', []);
    const b = makeCard('hypothesis', 'B', '', [], 'next', [a.id]);
    const c = makeCard('action', 'C', '', [], 'next', [b.id]);
    const d = makeCard('note', 'D', '', []);
    expect(validateConnection([a, b, c, d], c.id, a.id)).toMatchObject({ valid: false, error: expect.stringContaining('ciclo') });
    expect(canConnect([a, b, c, d], a.id, d.id)).toBe(true);
  });

  it('handles an imported graph with an existing unrelated cycle safely', () => {
    const a = makeCard('note', 'A', '', []); const b = makeCard('note', 'B', '', []); const c = makeCard('note', 'C', '', []);
    a.dependsOn = [b.id]; b.dependsOn = [a.id];
    expect(canConnect([a, b, c], a.id, c.id)).toBe(true);
    expect(canConnect([a, b, c], c.id, a.id)).toBe(true);
  });

  it('uses unambiguous edge identifiers even when card IDs contain separators', () => {
    expect(connectionId('a-b', 'c')).not.toBe(connectionId('a', 'b-c'));
  });

  it('audits a valid branched plan without demanding connections for independent notes', () => {
    const cards = [
      { id: 'context', dependsOn: [] },
      { id: 'hypothesis', dependsOn: ['context'] },
      { id: 'research', dependsOn: ['hypothesis'] },
      { id: 'action', dependsOn: ['hypothesis', 'research'] },
      { id: 'independent-note', dependsOn: [] },
    ];
    expect(auditDependencyGraph(cards)).toEqual({ valid: true, issues: [] });
  });

  it('reports structural problems and the actual cycle without mutating an imported plan', () => {
    const cards = [
      { id: 'a', dependsOn: ['b', 'b', 'missing'] },
      { id: 'b', dependsOn: ['c'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'note', dependsOn: ['note'] },
      { id: 'note', dependsOn: [] },
    ];
    const before = JSON.stringify(cards);
    const audit = auditDependencyGraph(cards);
    expect(audit.valid).toBe(false);
    expect(audit.issues).toEqual(expect.arrayContaining([
      { kind: 'duplicate-card', cardId: 'note' },
      { kind: 'duplicate', cardId: 'a', dependencyId: 'b' },
      { kind: 'missing', cardId: 'a', dependencyId: 'missing' },
      { kind: 'self', cardId: 'note', dependencyId: 'note' },
      { kind: 'cycle', cardId: 'c', dependencyId: 'a', cycleIds: ['a', 'b', 'c'] },
    ]));
    expect(audit.issues.filter(issue => issue.kind === 'cycle')).toHaveLength(1);
    expect(JSON.stringify(cards)).toBe(before);
  });

  it('audits long dependency chains safely and detects a cycle introduced at the end', () => {
    const cards = Array.from({ length: 12_000 }, (_, index) => ({ id: String(index), dependsOn: index < 11_999 ? [String(index + 1)] : [] as string[] }));
    expect(auditDependencyGraph(cards).valid).toBe(true);
    cards[cards.length - 1].dependsOn = ['11997'];
    expect(auditDependencyGraph(cards).issues).toEqual([{ kind: 'cycle', cardId: '11999', dependencyId: '11997', cycleIds: ['11997', '11998', '11999'] }]);
  });

  it('updates remote content while preserving the node currently being dragged', () => {
    const previous = [{ id: 'a', position: { x: 150, y: 80 }, data: { title: 'Anterior' }, selected: true, dragging: true, measured: { width: 300, height: 220 } }];
    const incoming = [{ id: 'a', position: { x: 0, y: 0 }, data: { title: 'Conteúdo atualizado' }, selected: false, dragging: false, measured: { width: 0, height: 0 } }];
    const result = synchronizeCanvasNodes(previous, incoming, new Map(), new Set(['a']));
    expect(result[0].position).toEqual({ x: 150, y: 80 });
    expect(result[0].data.title).toBe('Conteúdo atualizado');
    expect(result[0].selected).toBe(true);
    expect(result[0].measured).toEqual({ width: 300, height: 220 });
  });

  it('holds a finished drag until its position is acknowledged, then accepts a deliberate new layout', () => {
    const previous = [{ id: 'a', position: { x: 150, y: 80 } }];
    const pending = new Map([['a', { x: 150, y: 80 }]]);
    expect(synchronizeCanvasNodes(previous, [{ id: 'a', position: { x: 0, y: 0 } }], pending, new Set())[0].position).toEqual({ x: 150, y: 80 });
    const acknowledged = synchronizeCanvasNodes(previous, [{ id: 'a', position: { x: 150, y: 80 } }], pending, new Set());
    expect(pending.size).toBe(0);
    expect(synchronizeCanvasNodes(acknowledged, [{ id: 'a', position: { x: 400, y: 40 } }], pending, new Set())[0].position).toEqual({ x: 400, y: 40 });
  });

  it('adds new streamed nodes and removes stale drag reservations for deleted nodes', () => {
    const pending = new Map([['deleted', { x: 50, y: 50 }]]);
    const result = synchronizeCanvasNodes([{ id: 'deleted', position: { x: 50, y: 50 } }], [{ id: 'new', position: { x: 400, y: 40 } }], pending, new Set());
    expect(result).toEqual([{ id: 'new', position: { x: 400, y: 40 } }]);
    expect(pending.size).toBe(0);
  });
});
