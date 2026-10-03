import { describe, expect, it } from 'vitest';
import { createProject, createDemoProject } from '../../shared/domain';
import { hasLocalContent, mergeIncoming } from './projectMerge';

describe('late response merges', () => {
  it('preserves a deletion, drag, and new note while accepting unedited remote content', () => {
    const base=createDemoProject();
    const local=structuredClone(base), remote=structuredClone(base);
    const deleted=local.cards.pop()!;
    local.cards[0].position={x:777,y:555};local.cards[0].pinnedPosition=true;
    local.cards.push({...local.cards[0],id:'my-note',kind:'note',origin:'user',title:'Minha observação'});
    remote.cards[1].summary='Uma atualização da IA';remote.version++;
    const result=mergeIncoming(base,local,remote);
    expect(result.cards.some((c)=>c.id===deleted.id)).toBe(false);
    expect(result.cards[0].position).toEqual({x:777,y:555});
    expect(result.cards.find((c)=>c.id===base.cards[1].id)?.summary).toBe('Uma atualização da IA');
    expect(result.cards.some((c)=>c.id==='my-note')).toBe(true);
    expect(result.version).toBe(remote.version);
    expect(hasLocalContent(result,remote)).toBe(true);
  });
  it('preserves a checked item and revised budget while keeping the completed remote conversation', () => {
    const base=createDemoProject(),local=structuredClone(base),remote=structuredClone(base);
    local.context.budget='R$ 250';
    const checklist=local.cards.find((c)=>c.kind==='action')!.blocks.find((b)=>b.type==='checklist')!;
    checklist.items![0].checked=true;
    remote.context.city='Porto Alegre';remote.context.budget='R$ 1.000';
    remote.messages.push({id:'answer',role:'assistant',text:'Resposta concluída',createdAt:new Date().toISOString()});
    const result=mergeIncoming(base,local,remote);
    expect(result.context.budget).toBe('R$ 250');expect(result.context.city).toBe('Porto Alegre');
    expect(result.cards.find((c)=>c.kind==='action')!.blocks.find((b)=>b.type==='checklist')!.items![0].checked).toBe(true);
    expect(result.messages.at(-1)?.text).toBe('Resposta concluída');
  });
  it('keeps the incoming state when no local content changed',()=>{const base=createProject('Uma ideia de negócio');const remote={...structuredClone(base),version:3};expect(mergeIncoming(base,base,remote)).toEqual(remote);});
});
