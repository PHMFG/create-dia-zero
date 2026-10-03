import type { CanvasCard, Context, Project } from '../../shared/types';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Identified = { id: string };

function mergeFields<T extends object>(before: T, local: T, remote: T): T {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const localValue = (local as Record<string, unknown>)[key];
    const baseValue = (before as Record<string, unknown>)[key];
    const remoteValue = (remote as Record<string, unknown>)[key];
    const value = !equal(localValue, baseValue) ? localValue : remoteValue;
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

/** Merge an ID-keyed list without letting a stale snapshot erase independent edits. */
function mergeById<T extends Identified>(before: T[] = [], local: T[] = [], remote: T[] = []): T[] {
  const baseById = new Map(before.map(item => [item.id, item]));
  const localById = new Map(local.map(item => [item.id, item]));
  const remoteById = new Map(remote.map(item => [item.id, item]));
  const merged = new Map<string, T>();

  // Remote order is the live order. A local deletion wins; a locally edited item
  // survives a remote deletion, while untouched remote deletions are respected.
  for (const item of remote) {
    const base = baseById.get(item.id);
    const localItem = localById.get(item.id);
    if (base && !localItem) continue;
    if (base && localItem) merged.set(item.id, mergeFields(base, localItem, item));
    else merged.set(item.id, localItem ?? item); // same-ID concurrent additions: local wins
  }
  for (const item of local) {
    if (merged.has(item.id)) continue;
    const base = baseById.get(item.id);
    if (!base || !equal(item, base)) merged.set(item.id, item);
  }
  const localCommonOrder = local.filter(item => baseById.has(item.id)).map(item => item.id);
  const expectedCommonOrder = before.filter(item => localById.has(item.id)).map(item => item.id);
  const localReordered = !equal(localCommonOrder, expectedCommonOrder);
  if (!localReordered) return [...remote.flatMap(item => merged.has(item.id) ? [merged.get(item.id)!] : []),
    ...local.filter(item => !remoteById.has(item.id) && merged.has(item.id)).map(item => merged.get(item.id)!)];

  const reorderedIds = localCommonOrder.filter(id => merged.has(id));
  const reorderedSet = new Set(reorderedIds);
  const after = new Map<string, string[]>();
  const leading: string[] = [];
  let anchor: string | undefined;
  for (const item of remote) {
    if (reorderedSet.has(item.id)) { anchor = item.id; continue; }
    if (baseById.has(item.id)) continue;
    if (anchor) after.set(anchor, [...(after.get(anchor) ?? []), item.id]);
    else leading.push(item.id);
  }
  const ordered = [...leading, ...reorderedIds.flatMap(id => [id, ...(after.get(id) ?? [])])];
  for (const item of remote) if (merged.has(item.id) && !ordered.includes(item.id)) ordered.push(item.id);
  for (const item of local) if (merged.has(item.id) && !ordered.includes(item.id)) ordered.push(item.id);
  return ordered.map(id => merged.get(id)!);
}

function mergeStringIds(before: string[] = [], local: string[] = [], remote: string[] = []): string[] {
  const base = new Set(before), localSet = new Set(local), remoteSet = new Set(remote);
  const merged = new Set<string>();
  for (const id of remote) if (!base.has(id) || localSet.has(id)) merged.add(id);
  for (const id of local) if (!base.has(id) || remoteSet.has(id)) merged.add(id);
  return [...merged];
}

function mergeItems(before: NonNullable<CanvasCard['blocks'][number]['items']>, local: NonNullable<CanvasCard['blocks'][number]['items']>, remote: NonNullable<CanvasCard['blocks'][number]['items']>) {
  return mergeById(before, local, remote);
}

function mergeBlock(before: CanvasCard['blocks'][number], local: CanvasCard['blocks'][number], remote: CanvasCard['blocks'][number]) {
  const merged = mergeFields(before, local, remote);
  if (before.items || local.items || remote.items) merged.items = mergeItems(before.items ?? [], local.items ?? [], remote.items ?? []);
  if (before.sourceIds || local.sourceIds || remote.sourceIds) merged.sourceIds = mergeStringIds(before.sourceIds, local.sourceIds, remote.sourceIds);
  return merged;
}

function mergeBlocks(before: CanvasCard['blocks'], local: CanvasCard['blocks'], remote: CanvasCard['blocks']): CanvasCard['blocks'] {
  return mergeById(before, local, remote).map(block => {
    const base = before.find(item => item.id === block.id);
    const localBlock = local.find(item => item.id === block.id);
    const remoteBlock = remote.find(item => item.id === block.id);
    return base && localBlock && remoteBlock ? mergeBlock(base, localBlock, remoteBlock) : block;
  });
}

function mergeCard(before:CanvasCard|undefined,current:CanvasCard,remote:CanvasCard):CanvasCard {
  if(!before)return current;
  // A drag changes position, not the document: untouched fields still receive live updates.
  const merged={...remote};
  for(const key of Object.keys(current) as Array<keyof CanvasCard>) {
    if(key==='revision'||key==='blocks'||key==='dependsOn')continue;
    if(!equal(current[key],before[key]))Object.assign(merged,{[key]:current[key]});
  }
  merged.blocks=mergeBlocks(before.blocks,current.blocks,remote.blocks);
  merged.dependsOn=mergeStringIds(before.dependsOn,current.dependsOn,remote.dependsOn);
  merged.revision=Math.max(current.revision,remote.revision);
  return merged;
}
/** A response can arrive after edits were made. Local changes since the request win,
 * including removals and canvas positions, while untouched remote content advances. */
export function mergeIncoming(base: Project, local: Project, incoming: Project): Project {
  const baseCards = new Map(base.cards.map((card) => [card.id, card]));
  const localCards = new Map(local.cards.map((card) => [card.id, card]));
  const cards = incoming.cards.flatMap((remote) => {
    const before = baseCards.get(remote.id), current = localCards.get(remote.id);
    if (before && !current) return [];
    if (current && !equal(current, before)) return [mergeCard(before,current,remote)];
    return [remote];
  });
  for (const card of local.cards) {
    if (cards.some((remote) => remote.id === card.id)) continue;
    const before = baseCards.get(card.id);
    if (!before || !equal(card, before)) cards.push(card);
  }
  const context = {...incoming.context};
  for (const key of Object.keys(local.context) as Array<keyof Context>) if (!equal(local.context[key], base.context[key])) context[key] = local.context[key] as string;
  return {...incoming, cards, context, title:local.title !== base.title ? local.title : incoming.title};
}

export function hasLocalContent(project: Project, incoming: Project): boolean {
  return !equal(project.cards,incoming.cards) || !equal(project.context,incoming.context) || project.title !== incoming.title;
}
