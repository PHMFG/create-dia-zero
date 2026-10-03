import {describe,expect,it} from 'vitest';
import {isSafeExternalUrl,locationMapUrl} from '../shared/media';
import {blockSchema,parseProject} from '../shared/validation';
import {createDemoProject} from '../shared/domain';

describe('links, images and places',()=>{
  it('rejects executable URLs, embedded credentials and local services',()=>{
    for(const url of ['javascript:alert(1)','data:image/svg+xml;base64,abc','https://user:password@example.com/image.jpg','http://127.0.0.1/image','http://2130706433/image','http://10.2.3.4/image','http://192.168.1.1/image','http://[::1]/image','https://app.local/image','http://198.18.1.2/image'])expect(isSafeExternalUrl(url),url).toBe(false);
    expect(isSafeExternalUrl('https://images.example.com/reference.jpg')).toBe(true);
  });
  it('keeps old exported projects compatible and preserves the new block fields',()=>{
    const project=createDemoProject();
    expect(parseProject(project)).toEqual(project);
    project.cards[0].blocks.push({id:'photo',type:'image',url:'https://example.com/photo.jpg',alt:'Referência visual',caption:'Imagem consultada',sourceIds:[]});
    project.cards[0].blocks.push({id:'place',type:'location',address:'Porto Alegre, RS',latitude:-30.03,longitude:-51.23});
    const restored=parseProject(project);
    expect(restored.cards[0].blocks.at(-2)?.url).toBe('https://example.com/photo.jpg');
    expect(restored.cards[0].blocks.at(-1)?.latitude).toBe(-30.03);
  });
  it('validates geographic ranges without fabricating coordinates for a city',()=>{
    expect(blockSchema.safeParse({id:'bad',type:'location',latitude:91,longitude:0}).success).toBe(false);
    expect(locationMapUrl({address:'Rua A & B, Porto Alegre'})).toBe('https://www.google.com/maps/search/?api=1&query=Rua%20A%20%26%20B%2C%20Porto%20Alegre');
    expect(locationMapUrl({latitude:-30.03,longitude:-51.23})).toContain('query=-30.03%2C-51.23');
    expect(locationMapUrl({})).toBeUndefined();
  });
});
