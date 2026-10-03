import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchSession } from '../server/research';
import { isSafeExternalUrl, locationMapUrl } from '../shared/media';
import { blockSchema, sourceSchema } from '../shared/validation';
import { MediaBlock } from '../src/components/MediaBlock';
import { CardDrawer } from '../src/components/Dialogs';
import { createProject } from '../shared/domain';
import type { Block, Source } from '../shared/types';

afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const pageUrl='https://example.org/projeto';
const imageUrl='https://images.example.org/referencia.jpg';
const source:Source={id:'consulted-page',url:pageUrl,imageUrl,title:'Referência do projeto',excerpt:'Página consultada.',verified:true,consultedAt:'2026-10-03T12:00:00.000Z'};

describe('provider image provenance',()=>{
  it('requests documented image options and keeps the page associated with its image',async()=>{
    const fetcher=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body.urls?{results:[{url:pageUrl,raw_content:'Página extraída.',images:[imageUrl]}]}:{results:[{url:pageUrl,title:'Página do projeto',content:'Trecho útil.',images:[{url:'http://127.0.0.1/private.jpg'},{url:imageUrl,description:'Imagem da página'}]}]}));
    });
    const session=new ResearchSession({apiKey:'fixture-key',fetcher:fetcher as typeof fetch});
    const result=await session.search('Referências para o primeiro teste');
    const searchBody=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(searchBody).toMatchObject({include_images:true,include_image_descriptions:true,search_depth:'basic',auto_parameters:false});
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({url:pageUrl,imageUrl,excerpt:'Página extraída.',verified:true});
    expect(sourceSchema.safeParse(result.sources[0]).success).toBe(true);
    const extractBody=JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(extractBody.urls).toEqual([pageUrl]);
    expect(extractBody.include_images).toBe(true);
  });
  it('does not invent a page association for top-level images or extract image URLs',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({results:[],images:[{url:imageUrl,description:'Imagem da consulta'},{url:'javascript:alert(1)'},{url:'http://10.0.0.1/image.jpg'}]})));
    const session=new ResearchSession({apiKey:'fixture-key',fetcher:fetcher as typeof fetch});
    const result=await session.search('Referências visuais de uma cafeteria');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({url:imageUrl,imageUrl,title:'Imagem da consulta'});
    expect(result.sources[0].excerpt).toContain('página original');
  });
  it('uses extraction images only for an exact search result and retains snippets after partial failures',async()=>{
    const fetcher=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body.urls?{results:[{url:'https://other.example.org/guessed',raw_content:'Não solicitado.',images:['https://other.example.org/guessed.jpg']},{url:pageUrl,images:[imageUrl]}],failed_results:[{url:pageUrl,error:'partial extraction'}]}:{results:[null,{url:pageUrl,content:'Trecho original do resultado.'}]}));
    });
    const session=new ResearchSession({apiKey:'fixture-key',fetcher:fetcher as typeof fetch});
    expect((await session.search('Consultar referência')).sources).toHaveLength(1);
    expect(session.sources[0]).toMatchObject({url:pageUrl,imageUrl,excerpt:'Trecho original do resultado.'});
    expect(session.sources.some(entry=>entry.url.includes('other.example'))).toBe(false);
  });
  it('bounds and deduplicates visual references across repeated queries',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({results:[],images:Array.from({length:15},(_,i)=>({url:`https://images.example.org/${i}.jpg`,description:`Referência ${i}`}))})));
    const session=new ResearchSession({apiKey:'fixture-key',fetcher:fetcher as typeof fetch});
    await session.search('Primeira consulta');await session.search('Segunda consulta');
    expect(session.sources).toHaveLength(6);
    expect(new Set(session.sources.map(entry=>entry.imageUrl)).size).toBe(6);
    expect((await session.search('Terceira consulta')).status).toBe('limited');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps the missing-key path honest and issues no provider request',async()=>{
    vi.stubEnv('TAVILY_API_KEY','');const fetcher=vi.fn();
    const result=await new ResearchSession({fetcher}).search('Pesquise imagens e lojas');
    expect(result.status).toBe('unavailable');expect(result.sources).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
  });
  it('awaits publication of snippets and images before extraction and publishes enriched content afterwards',async()=>{
    const events:string[]=[];const snapshots:Source[][]=[];
    const fetcher=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));events.push(body.urls?'extract':'search');
      return new Response(JSON.stringify(body.urls?{results:[{url:pageUrl,raw_content:'Conteúdo enriquecido.'}]}:{results:[{url:pageUrl,content:'Trecho inicial.',images:[imageUrl]}],images:['https://images.example.org/extra.jpg']}));
    });
    const session=new ResearchSession({apiKey:'fixture-key',fetcher:fetcher as typeof fetch,onSources:async sources=>{
      events.push('publish-start');snapshots.push(structuredClone(sources));await Promise.resolve();events.push('publish-complete');
    }});
    await session.search('Buscar referências');
    expect(events).toEqual(['search','publish-start','publish-complete','extract','publish-start','publish-complete']);
    expect(snapshots[0]).toHaveLength(2);expect(snapshots[0][0]).toMatchObject({excerpt:'Trecho inicial.',imageUrl});
    expect(snapshots[1][0].excerpt).toBe('Conteúdo enriquecido.');
    expect(snapshots[0][0].id).toBe(snapshots[1][0].id);
  });
  it.each([1,2])('retains actual sources and propagates failure in publication %s',async failureAt=>{
    let publications=0;
    const fetcher=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      return new Response(JSON.stringify({results:[{url:pageUrl,content:'Trecho real.',raw_content:body.urls?'Conteúdo real extraído.':undefined}]}));
    });
    const session=new ResearchSession({apiKey:'fixture-key',fetcher:fetcher as typeof fetch,onSources:()=>{if(++publications===failureAt)throw new Error('publication-failed');}});
    await expect(session.search('Buscar referência')).rejects.toThrow('publication-failed');
    expect(session.sources).toHaveLength(1);expect(session.sources[0].verified).toBe(true);
    expect(session.sources[0].excerpt).toBe(failureAt===1?'Trecho real.':'Conteúdo real extraído.');
    expect(fetcher).toHaveBeenCalledTimes(failureAt);
  });
});

describe('safe media blocks',()=>{
  it.each(['javascript:alert(1)','data:image/svg+xml,secret','http://localhost/image.jpg','http://127.1/image.jpg','http://198.18.0.1/image.jpg','https://user:password@example.org/image.jpg'])('never loads an unsafe media target: %s',url=>{
    expect(isSafeExternalUrl(url)).toBe(false);
    const markup=renderToStaticMarkup(createElement(MediaBlock,{block:{id:'media',type:'image',url},sources:[source]}));
    expect(markup).not.toContain('<img');expect(markup).not.toContain('src=');
    expect(blockSchema.safeParse({id:'media',type:'image',url}).success).toBe(false);
  });
  it('renders lazy images with their registered source and no embedded HTML',()=>{
    const block:Block={id:'image-block',type:'image',url:imageUrl,alt:'Mesa do projeto',caption:'<script>unsafe()</script>',sourceIds:[source.id]};
    const markup=renderToStaticMarkup(createElement(MediaBlock,{block,sources:[source]}));
    expect(markup).toContain('loading="lazy"');expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('href="https://example.org/projeto"');expect(markup).toContain('Fonte consultada');
    expect(markup).not.toContain('<script>');expect(markup).toContain('&lt;script&gt;');
    const importedMarkup=renderToStaticMarkup(createElement(MediaBlock,{block,sources:[{...source,verified:false}]}));
    expect(importedMarkup).toContain('Referência visual registrada');expect(importedMarkup).not.toContain('Referência visual da pesquisa');
  });
  it('maps an address using an encoded search link without requesting geolocation',()=>{
    const block:Block={id:'location',type:'location',text:'Primeiro teste',address:'Rua A & B, Porto Alegre',humanEdited:true};
    expect(locationMapUrl(block)).toBe('https://www.google.com/maps/search/?api=1&query=Rua%20A%20%26%20B%2C%20Porto%20Alegre');
    expect(locationMapUrl({latitude:-30.03,longitude:-51.23})).toContain('query=-30.03%2C-51.23');
    expect(locationMapUrl({latitude:120,longitude:0})).toBeUndefined();
    const markup=renderToStaticMarkup(createElement(MediaBlock,{block}));
    expect(markup).toContain('Abrir no mapa');expect(markup).toContain('Adicionado por você');expect(markup).not.toContain('iframe');
  });
  it('opens the drawer in reading mode with edit controls and without media form fields',()=>{
    const project=createProject('Projeto de teste');project.sources=[source];
    const card=project.cards[0];card.blocks=[{id:'link',type:'link',url:pageUrl,sourceIds:[source.id]},{id:'image',type:'image',url:imageUrl,sourceIds:[source.id]},{id:'place',type:'location',address:'Porto Alegre'}];
    const noop=()=>{};
    const markup=renderToStaticMarkup(createElement(CardDrawer,{project,card,onClose:noop,onChange:noop,onContext:noop,onClarify:noop,onEvidence:noop,onDelete:noop}));
    expect(markup).toContain('card-drawer drawer-view-mode');
    expect(markup).toContain('Visualizar');expect(markup).toContain('Editar');expect(markup).toContain('Histórico');
    expect(markup).toContain('Editar este bloco');expect(markup).toContain('Fontes de referência');
    expect(markup).toContain('aria-label="Título do cartão"');expect(markup).toContain('aria-label="Resumo do cartão"');
    expect(markup).toContain('aria-label="Prioridade"');expect(markup).toContain('Porto Alegre');
    expect(markup).not.toContain('Endereço do link');expect(markup).not.toContain('Endereço da imagem');
    expect(markup).not.toContain('Endereço ou região');expect(markup).not.toContain('Latitude (opcional)');
    expect(markup).not.toContain('Usar uma imagem das referências');
  });
});
