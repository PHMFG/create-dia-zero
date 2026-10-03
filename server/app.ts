import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import * as store from './store';
import { createProject,createDemoProject,applyHumanEdit,applyTurn,recordEvidence,resolveProposal,importProject,uid } from '../shared/domain';
import { parseProject,evidenceInputSchema } from '../shared/validation';
import { generateTurn } from './ai';
import type { Project,StreamEvent } from '../shared/types';

export const app=new Hono();
app.use('/api/*',async(c,next)=>{
  c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');
  if(Number(c.req.header('content-length')??0)>1500000)throw new store.HttpError(413,'O projeto é muito grande para esta operação.');
  await next();
});
app.onError((error,c)=>{ const e=error as store.HttpError;return c.json({error:error instanceof z.ZodError?'Os dados enviados não são válidos.':e.status?e.message:'Não foi possível concluir. Tente novamente.'},(e.status??(error instanceof z.ZodError?400:500)) as 400); });
app.get('/api/config',c=>c.json({url:process.env.SUPABASE_URL??'',publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY??'',turnstileSiteKey:process.env.TURNSTILE_SITE_KEY??''}));
app.get('/api/health',c=>c.json({storage:store.configured()?'supabase':'local',ai:!!process.env.OPENCODE_GO_API_KEY,jev:!!process.env.TYPESAFE_API_KEY,research:!!process.env.TAVILY_API_KEY,auth:'guest'}));
app.get('/api/projects',async c=>c.json(await store.list(await store.session(c.req.raw))));
app.post('/api/projects',async c=>{const s=await store.session(c.req.raw);const {idea}=z.object({idea:z.string().trim().min(3).max(12000)}).parse(await c.req.json());return c.json(await store.insert(s,createProject(idea)),201);});
app.post('/api/projects/demo',async c=>c.json(await store.insert(await store.session(c.req.raw),createDemoProject()),201));
app.post('/api/projects/import',async c=>{const s=await store.session(c.req.raw);return c.json(await store.insert(s,importProject(await c.req.json())),201);});
app.get('/api/projects/:id',async c=>c.json(await store.get(await store.session(c.req.raw),c.req.param('id'))));
app.delete('/api/projects/:id',async c=>{await store.remove(await store.session(c.req.raw),c.req.param('id'));return c.json({ok:true});});
app.patch('/api/projects/:id/canvas',async c=>{
  const s=await store.session(c.req.raw);const current=await store.get(s,c.req.param('id'));const input=parseProject(await c.req.json());
  if(input.id!==current.id||input.version!==current.version)throw new store.HttpError(409,'Uma atualização chegou enquanto você editava. Reabra o projeto para continuar.');
  let next=applyHumanEdit(current,input.cards,input.context);next={...next,title:input.title.trim().slice(0,100)};
  return c.json(await store.save(s,next,current.version));
});
app.post('/api/projects/:id/evidence',async c=>{const s=await store.session(c.req.raw);const current=await store.get(s,c.req.param('id'));const input=evidenceInputSchema.parse(await c.req.json());const next=recordEvidence(current,input);return c.json(await store.save(s,next,current.version));});
app.post('/api/projects/:id/proposals/:proposalId/resolve',async c=>{const s=await store.session(c.req.raw);const current=await store.get(s,c.req.param('id'));const {accept}=z.object({accept:z.boolean()}).parse(await c.req.json());const next=resolveProposal(current,c.req.param('proposalId'),accept);return c.json(next===current?current:await store.save(s,next,current.version));});
app.post('/api/projects/:id/messages',async c=>{
  const s=await store.session(c.req.raw);const input=z.object({text:z.string().trim().min(1).max(12000),runId:z.string().min(10).max(100),evidence:z.boolean().optional(),cardId:z.string().min(1).max(120).optional()}).parse(await c.req.json());
  let current=await store.get(s,c.req.param('id'));
  if(input.cardId&&!current.cards.some(card=>card.id===input.cardId))throw new store.HttpError(404,'Este cartão não está mais no projeto.');
  const started=await store.reserveRun(s,current.id,input.runId);
  if(!started)return c.json({error:'Esta mensagem já foi processada. Reabra o projeto para ver a resposta.'},409);
  const messageId=input.runId;
  current={...current,version:current.version+1,updatedAt:new Date().toISOString(),messages:[...current.messages,{id:messageId,role:'user',text:input.text,cardId:input.cardId,createdAt:new Date().toISOString()}]};
  try{await store.save(s,current,current.version-1);}catch(e){await store.finishRun(s,input.runId,current.id,'failed');throw e;}
  return streamSSE(c,async stream=>{
    const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),90000);let status='failed';let usage:unknown;
    stream.onAbort(()=>controller.abort());
    const emit=async(event:StreamEvent)=>{if(!stream.aborted)await stream.writeSSE({data:JSON.stringify(event)});};
    try{
      const result=await generateTurn(current,input.text,{signal:controller.signal,evidence:input.evidence,focusCardId:input.cardId,onStatus:(text:string)=>{void emit({type:'status',text}).catch(()=>{});},reserveResearch:()=>store.reserveResearch(s,input.runId)});
      if(controller.signal.aborted)throw new Error('cancelled');
      // Re-read after generation so edits made while the model ran take precedence.
      let next:Project|undefined;
      for(let attempt=0;attempt<3;attempt++){
        const latest=await store.get(s,current.id);const candidate=applyTurn(latest,result,current.context);
        if(input.cardId)candidate.messages[candidate.messages.length-1].cardId=input.cardId;
        try{next=await store.save(s,candidate,latest.version);break;}
        catch(error){if(!(error instanceof store.HttpError)||error.status!==409||attempt===2)throw error;}
      }
      if(!next)throw new store.HttpError(409,'O projeto recebeu várias edições. Seu conteúdo está salvo; tente enviar a mensagem novamente.');
      usage=result.usage;
      await emit({type:'text',text:result.reply});await emit({type:'complete',project:next,mode:result.mode});status='complete';
    }catch(error){await emit({type:'error',error:controller.signal.aborted?'A resposta foi interrompida. Sua mensagem e seu projeto estão salvos.':error instanceof store.HttpError?error.message:'Não foi possível preparar a resposta. Seu projeto está salvo; tente novamente.'});}
    finally{clearTimeout(deadline);await store.finishRun(s,input.runId,current.id,status,usage);}
  });
});
app.notFound(c=>c.json({error:'Rota não encontrada.'},404));
