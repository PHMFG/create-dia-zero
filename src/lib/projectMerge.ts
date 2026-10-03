import type { Context, Project } from '../../shared/types';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A response can arrive after edits were made. Local changes since the request win,
 * including removals and canvas positions, while untouched remote content advances. */
export function mergeIncoming(base: Project, local: Project, incoming: Project): Project {
  const baseCards = new Map(base.cards.map((card) => [card.id, card]));
  const localCards = new Map(local.cards.map((card) => [card.id, card]));
  const cards = incoming.cards.flatMap((remote) => {
    const before = baseCards.get(remote.id), current = localCards.get(remote.id);
    if (before && !current) return [];
    if (current && !equal(current, before)) return [current];
    return [remote];
  });
  for (const card of local.cards) if (!baseCards.has(card.id) && !cards.some((remote) => remote.id === card.id)) cards.push(card);
  const context = {...incoming.context};
  for (const key of Object.keys(local.context) as Array<keyof Context>) if (!equal(local.context[key], base.context[key])) context[key] = local.context[key] as string;
  return {...incoming, cards, context, title:local.title !== base.title ? local.title : incoming.title};
}

export function hasLocalContent(project: Project, incoming: Project): boolean {
  return !equal(project.cards,incoming.cards) || !equal(project.context,incoming.context) || project.title !== incoming.title;
}
