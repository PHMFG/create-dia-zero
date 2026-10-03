import type { CanvasCard } from './types';

export interface ConnectionValidation { valid: boolean; error?: string }

export interface DependencyGraphIssue {
  kind: 'duplicate-card' | 'duplicate' | 'missing' | 'self' | 'cycle';
  cardId: string;
  dependencyId?: string;
  cycleIds?: string[];
}

/** Read-only audit; it never removes or creates a user's connections. */
export function auditDependencyGraph(cards: Pick<CanvasCard, 'id' | 'dependsOn'>[]): { valid: boolean; issues: DependencyGraphIssue[] } {
  const issues: DependencyGraphIssue[] = [];
  const byId = new Map<string, Pick<CanvasCard, 'id' | 'dependsOn'>>();
  for (const card of cards) {
    if (byId.has(card.id)) issues.push({ kind: 'duplicate-card', cardId: card.id });
    else byId.set(card.id, card);
  }
  const dependencies = new Map<string, string[]>();
  for (const card of byId.values()) {
    const seen = new Set<string>();
    const present: string[] = [];
    for (const dependencyId of card.dependsOn) {
      if (seen.has(dependencyId)) { issues.push({ kind: 'duplicate', cardId: card.id, dependencyId }); continue; }
      seen.add(dependencyId);
      if (dependencyId === card.id) issues.push({ kind: 'self', cardId: card.id, dependencyId });
      else if (!byId.has(dependencyId)) issues.push({ kind: 'missing', cardId: card.id, dependencyId });
      else present.push(dependencyId);
    }
    dependencies.set(card.id, present);
  }
  // Iterative DFS keeps imported or generated long chains safe from call-stack overflow.
  const visited = new Set<string>();
  const active = new Map<string, number>();
  const knownCycles = new Set<string>();
  for (const rootId of byId.keys()) {
    if (visited.has(rootId)) continue;
    const path = [{ id: rootId, cursor: 0 }];
    active.set(rootId, 0);
    while (path.length) {
      const frame = path[path.length - 1];
      const nextId = dependencies.get(frame.id)?.[frame.cursor++];
      if (!nextId) { active.delete(frame.id); visited.add(frame.id); path.pop(); continue; }
      const ancestor = active.get(nextId);
      if (ancestor !== undefined) {
        const cycle = path.slice(ancestor).map(item => item.id);
        const first = cycle.reduce((best, id, index) => id < cycle[best] ? index : best, 0);
        const cycleIds = [...cycle.slice(first), ...cycle.slice(0, first)];
        const key = JSON.stringify(cycleIds);
        if (!knownCycles.has(key)) { knownCycles.add(key); issues.push({ kind: 'cycle', cardId: frame.id, dependencyId: nextId, cycleIds }); }
      } else if (!visited.has(nextId)) {
        active.set(nextId, path.length);
        path.push({ id: nextId, cursor: 0 });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

/** Edges point from prerequisite (source) to dependent card (target). */
export function validateConnection(cards: CanvasCard[], source: string | null | undefined, target: string | null | undefined): ConnectionValidation {
  if (!source || !target) return { valid: false, error: 'Escolha os dois cartões para criar uma conexão.' };
  if (source === target) return { valid: false, error: 'Um cartão não pode depender dele mesmo.' };
  const byId = new Map(cards.map(card => [card.id, card]));
  if (!byId.has(source) || !byId.has(target)) return { valid: false, error: 'Um dos cartões dessa conexão não está mais no plano.' };
  if (byId.get(target)!.dependsOn.includes(source)) return { valid: false, error: 'Esses cartões já estão conectados.' };
  // Source following dependencies to target would form a cycle if target depends on source.
  const pending = [source]; const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === target) return { valid: false, error: 'Essa conexão criaria um ciclo. Organize os passos em uma sequência.' };
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(byId.get(id)?.dependsOn ?? []));
  }
  return { valid: true };
}

export function canConnect(cards: CanvasCard[], source: string | null | undefined, target: string | null | undefined): boolean {
  return validateConnection(cards, source, target).valid;
}

export function connectionId(source: string, target: string): string {
  return JSON.stringify([source, target]);
}

interface PositionedNode {
  id: string; position: { x: number; y: number }; selected?: boolean;
  measured?: { width?: number; height?: number }; dragging?: boolean;
}

/** Synchronize remote content without moving a node under the user's pointer. */
export function synchronizeCanvasNodes<T extends PositionedNode>(previous: T[], incoming: T[], pendingPositions: Map<string, { x: number; y: number }>, draggedIds: Set<string>): T[] {
  const previousById = new Map(previous.map(node => [node.id, node]));
  const incomingIds = new Set(incoming.map(node => node.id));
  for (const id of pendingPositions.keys()) if (!incomingIds.has(id)) pendingPositions.delete(id);
  return incoming.map(node => {
    const before = previousById.get(node.id); const pending = pendingPositions.get(node.id);
    if (pending && node.position.x === pending.x && node.position.y === pending.y) pendingPositions.delete(node.id);
    const keepPosition = draggedIds.has(node.id) || pendingPositions.has(node.id);
    return before ? { ...before, ...node, position: keepPosition ? before.position : node.position, selected: before.selected, measured: before.measured, dragging: before.dragging } : node;
  });
}
