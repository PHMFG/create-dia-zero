import type { CanvasCard } from '../../shared/types';
import { organizeCards } from '../../shared/domain';

/** Find a free slot for one new card while treating every current position as fixed. */
export function availableCardPosition(cards: CanvasCard[], card: CanvasCard): CanvasCard['position'] {
  const placed = cards.map(existing => ({ ...existing, pinnedPosition: true }));
  const candidate = { ...card, pinnedPosition: false };
  return organizeCards([...placed, candidate])[placed.length].position;
}
