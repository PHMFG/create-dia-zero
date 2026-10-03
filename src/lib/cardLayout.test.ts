import { describe, expect, it } from 'vitest';
import type { CanvasCard } from '../../shared/types';
import { availableCardPosition } from './cardLayout';

function card(id: string, kind: CanvasCard['kind'], lane: CanvasCard['lane'], x: number, y: number): CanvasCard {
  return { id, kind, title: id, summary: 'Conteúdo do cartão', lane, blocks: [{ id: `${id}-block`, type: 'paragraph', text: 'Conteúdo longo para ocupar a altura prevista do cartão.' }], position: { x, y }, revision: 1, origin: 'user', dependsOn: [] };
}

describe('availableCardPosition', () => {
  it('avoids an existing card even when its position was set by the old note grid', () => {
    const existing = [card('research', 'research', 'next', 80, 1350)];
    const note = card('note', 'note', 'later', 0, 0);

    const position = availableCardPosition(existing, note);

    expect(position.x).toBe(820);
    expect(position.y).toBeGreaterThanOrEqual(48);
    expect(existing[0].pinnedPosition).toBeUndefined();
    expect(note.position).toEqual({ x: 0, y: 0 });
  });

  it('moves below a card occupying the candidate lane without changing its saved position', () => {
    const existing = [card('note-1', 'note', 'later', 820, 48)];
    const position = availableCardPosition(existing, card('note-2', 'note', 'later', 0, 0));

    expect(position.x).toBe(820);
    expect(position.y).toBeGreaterThan(48);
    expect(existing[0].position).toEqual({ x: 820, y: 48 });
  });
});
