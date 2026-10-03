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
  it('receives new content on a card being moved and continues from each live snapshot',()=>{
    const base=createProject('Uma cafeteria'),local=structuredClone(base),first=structuredClone(base);
    local.cards[0].position={x:800,y:300};local.cards[0].pinnedPosition=true;
    first.cards[0].summary='Conteúdo publicado durante a pesquisa';first.version=2;
    const merged=mergeIncoming(base,local,first);
    expect(merged.cards[0].position).toEqual({x:800,y:300});
    expect(merged.cards[0].summary).toBe(first.cards[0].summary);
    const final=structuredClone(first);final.cards[0].summary='Conteúdo atualizado com a fonte';final.version=3;
    const result=mergeIncoming(first,merged,final);
    expect(result.cards[0].summary).toBe(final.cards[0].summary);
    expect(result.cards[0].position).toEqual(local.cards[0].position);
  });
  it('merges checklist edits with remote item and block updates by ID',()=>{
    const base=createDemoProject(),local=structuredClone(base),remote=structuredClone(base);
    const cardId=base.cards.find(card=>card.kind==='action')!.id;
    const baseCard=base.cards.find(card=>card.id===cardId)!;
    const localCard=local.cards.find(card=>card.id===cardId)!;
    const remoteCard=remote.cards.find(card=>card.id===cardId)!;
    const listId=baseCard.blocks.find(block=>block.type==='checklist')!.id;
    const localList=localCard.blocks.find(block=>block.id===listId)!;
    const remoteList=remoteCard.blocks.find(block=>block.id===listId)!;
    const firstId=localList.items![0].id, secondId=localList.items![1].id, deletedId=localList.items![2].id;
    localList.items![0]={...localList.items![0],text:'Minha instrução revisada',checked:true,humanEdited:true};
    localList.items=localList.items!.filter(item=>item.id!==deletedId);
    localList.items!.push({id:'local-new-item',text:'Passo acrescentado por mim',checked:false,humanEdited:true});
    remoteList.items![0]={...remoteList.items![0],text:'Instrução remota conflitante',checked:false};
    remoteList.items![1]={...remoteList.items![1],text:'Passo remoto atualizado'};
    remoteList.items![2]={...remoteList.items![2],text:'Passo removido localmente'};
    remoteList.items!.push({id:'remote-new-item',text:'Passo acrescentado pela IA',checked:false});
    remoteCard.blocks.push({id:'remote-new-block',type:'link',url:'https://example.com/guia',text:'Guia'});
    remote.version++;

    const merged=mergeIncoming(base,local,remote).cards.find(card=>card.id===cardId)!;
    const items=merged.blocks.find(block=>block.id===listId)!.items!;
    expect(items.find(item=>item.id===firstId)).toMatchObject({text:'Minha instrução revisada',checked:true,humanEdited:true});
    expect(items.find(item=>item.id===secondId)?.text).toBe('Passo remoto atualizado');
    expect(items.some(item=>item.id===deletedId)).toBe(false);
    expect(items.map(item=>item.id)).toEqual(expect.arrayContaining(['local-new-item','remote-new-item']));
    expect(items.filter(item=>item.id==='remote-new-item')).toHaveLength(1);
    expect(merged.blocks.some(block=>block.id==='remote-new-block')).toBe(true);
  });
  it('protects a locally deleted block and merges independent source references',()=>{
    const base=createDemoProject(),local=structuredClone(base),remote=structuredClone(base);
    const cardId=base.cards.find(card=>card.kind==='action')!.id;
    const baseCard=base.cards.find(card=>card.id===cardId)!;
    const localCard=local.cards.find(card=>card.id===cardId)!;
    const remoteCard=remote.cards.find(card=>card.id===cardId)!;
    const deletedId=baseCard.blocks.find(block=>block.type==='callout')!.id;
    localCard.blocks=localCard.blocks.filter(block=>block.id!==deletedId);
    remoteCard.blocks.find(block=>block.id===deletedId)!.text='Atualização remota do bloco excluído';
    const listId=baseCard.blocks.find(block=>block.type==='checklist')!.id;
    localCard.blocks.find(block=>block.id===listId)!.sourceIds=['local-source'];
    remoteCard.blocks.find(block=>block.id===listId)!.sourceIds=['remote-source'];
    remote.version++;

    const merged=mergeIncoming(base,local,remote).cards.find(card=>card.id===cardId)!;
    expect(merged.blocks.some(block=>block.id===deletedId)).toBe(false);
    expect(merged.blocks.find(block=>block.id===listId)?.sourceIds).toEqual(['remote-source','local-source']);
  });
  it('keeps a locally edited block when the remote snapshot deletes it',()=>{
    const base=createDemoProject(),local=structuredClone(base),remote=structuredClone(base);
    const cardId=base.cards.find(card=>card.kind==='action')!.id;
    const blockId=base.cards.find(card=>card.id===cardId)!.blocks.find(block=>block.type==='paragraph')!.id;
    local.cards.find(card=>card.id===cardId)!.blocks.find(block=>block.id===blockId)!.text='Minha versão preservada';
    remote.cards.find(card=>card.id===cardId)!.blocks=remote.cards.find(card=>card.id===cardId)!.blocks.filter(block=>block.id!==blockId);
    remote.version++;

    const merged=mergeIncoming(base,local,remote).cards.find(card=>card.id===cardId)!;
    expect(merged.blocks.find(block=>block.id===blockId)?.text).toBe('Minha versão preservada');
  });
  it('keeps a local block reorder while inserting a newly published remote block',()=>{
    const base=createDemoProject(),local=structuredClone(base),remote=structuredClone(base);
    const cardId=base.cards.find(card=>card.kind==='action')!.id;
    const localCard=local.cards.find(card=>card.id===cardId)!;
    const remoteCard=remote.cards.find(card=>card.id===cardId)!;
    const [first,second,...rest]=localCard.blocks;
    localCard.blocks=[second,first,...rest];
    const checklistId=localCard.blocks.find(block=>block.type==='checklist')!.id;
    const localItems=localCard.blocks.find(block=>block.id===checklistId)!.items!;
    const [firstItem,secondItem,...otherItems]=localItems;
    localCard.blocks.find(block=>block.id===checklistId)!.items=[secondItem,firstItem,...otherItems];
    remoteCard.blocks.find(block=>block.id===checklistId)!.items!.push({id:'remote-new-item',text:'Novo passo',checked:false});
    remoteCard.blocks.push({id:'remote-new-block',type:'link',url:'https://example.com/new',text:'Nova referência'});
    remote.version++;

    const merged=mergeIncoming(base,local,remote).cards.find(card=>card.id===cardId)!;
    const ids=merged.blocks.map(block=>block.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(ids).toContain('remote-new-block');
    expect(ids.indexOf('remote-new-block')).toBeGreaterThan(ids.indexOf(rest.at(-1)!.id));
    const itemIds=merged.blocks.find(block=>block.id===checklistId)!.items!.map(item=>item.id);
    expect(itemIds.indexOf(secondItem.id)).toBeLessThan(itemIds.indexOf(firstItem.id));
    expect(itemIds).toContain('remote-new-item');
  });
  it('preserves a locally edited card removed by the incoming snapshot',()=>{
    const base=createDemoProject(),local=structuredClone(base),remote=structuredClone(base);
    const card=local.cards.find(candidate=>candidate.kind==='action')!;
    const untouched=remote.cards.find(candidate=>candidate.kind==='hypothesis')!;
    card.title='Meu teste ainda em andamento';card.humanEdited=true;card.revision++;
    remote.cards=remote.cards.filter(candidate=>candidate.id!==card.id&&candidate.id!==untouched.id);remote.version++;

    const merged=mergeIncoming(base,local,remote);
    expect(merged.cards.find(candidate=>candidate.id===card.id)).toMatchObject({title:'Meu teste ainda em andamento',humanEdited:true});
    expect(merged.cards.some(candidate=>candidate.id===untouched.id)).toBe(false);
  });
});
