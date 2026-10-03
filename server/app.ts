import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import * as store from './store';
import { createProject,createDemoProject,applyHumanEdit,applyTurn,recordEvidence,resolveProposal,importProject,uid } from '../shared/domain';
import { parseProject,evidenceInputSchema } from '../shared/validation';
import { generateTurn,hasResearchSynthesis,publishCanvasSequentially } from './ai';
import type { AgentActivity,CanvasCard,CanvasDelta,Project,StreamEvent,TurnResult } from '../shared/types';

export const app=new Hono();
app.use('/api/*',async(c,next)=>{
  const importRequest=c.req.method==='POST'&&c.req.path==='/api/projects/import';
  const canvasRequest=c.req.method==='PATCH'&&/^\/api\/projects\/[^/]+\/canvas$/.test(c.req.path);
  const largeProjectRequest=importRequest||canvasRequest;
  const maxSize=largeProjectRequest?3_000_000:1_500_000;
  return bodyLimit({maxSize,onError:ctx=>ctx.json({error:importRequest?'O arquivo do projeto excede o limite de 3 MB.':'O projeto é muito grande para esta operação.'},413)})(c,next);
});
app.use('/api/*',async(c,next)=>{
  c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');
  await next();
});
app.onError((error,c)=>{ const e=error as store.HttpError;return c.json({error:error instanceof z.ZodError?'Os dados enviados não são válidos.':e.status?e.message:'Não foi possível concluir. Tente novamente.',...(e.code?{code:e.code}:{})},(e.status??(error instanceof z.ZodError?400:500)) as 400); });
app.get('/api/config',c=>c.json({url:process.env.SUPABASE_URL??'',publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY??'',turnstileSiteKey:process.env.TURNSTILE_SITE_KEY??''}));
app.get('/api/health',c=>c.json({storage:store.configured()?'supabase':'local',ai:!!process.env.OPENCODE_GO_API_KEY,jev:!!process.env.TYPESAFE_API_KEY,research:!!process.env.TAVILY_API_KEY,auth:'guest'}));
app.get('/api/projects',async c=>c.json(await store.list(await store.session(c.req.raw))));
app.post('/api/projects',async c=>{const s=await store.session(c.req.raw);const {idea}=z.object({idea:z.string().trim().min(3).max(12000)}).parse(await c.req.json());return c.json(await store.insert(s,createProject(idea)),201);});
app.post('/api/projects/demo',async c=>c.json(await store.insert(await store.session(c.req.raw),createDemoProject()),201));
app.post('/api/projects/import',async c=>{const s=await store.session(c.req.raw);return c.json(await store.insert(s,importProject(await c.req.json())),201);});
app.get('/api/projects/:id',async c=>c.json(await store.get(await store.session(c.req.raw),c.req.param('id'))));
app.delete('/api/projects/:id',async c=>{await store.remove(await store.session(c.req.raw),c.req.param('id'));return c.json({ok:true});});
app.post('/api/projects/:id/runs/:runId/cancel',async c=>{
  const s=await store.session(c.req.raw);const runId=z.string().min(10).max(100).parse(c.req.param('runId'));
  await store.get(s,c.req.param('id'));
  await store.requestRunCancel(s,c.req.param('id'),runId);
  return c.json({ok:true},202);
});
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
  const requestSignal=c.req.raw.signal;const controller=new AbortController();
  const abortFromRequest=()=>controller.abort();
  requestSignal.addEventListener('abort',abortFromRequest,{once:true});
  const detachRequestAbort=()=>requestSignal.removeEventListener('abort',abortFromRequest);
  if(requestSignal.aborted){detachRequestAbort();return new Response(null,{status:499});}
  let runReserved=false;let finishPromise:Promise<void>|undefined;
  const finishRunOnce=(status:string,usage?:unknown)=>{
    if(!runReserved)return Promise.resolve();
    finishPromise??=store.finishRun(s,input.runId,current.id,status,usage);
    return finishPromise;
  };
  let started:boolean;
  try{started=await store.reserveRun(s,current.id,input.runId);}catch(error){detachRequestAbort();throw error;}
  if(!started){detachRequestAbort();return c.json({error:'Esta mensagem já foi processada ou cancelada. Reabra o projeto para continuar.',code:'RUN_ALREADY_PROCESSED'},409);}
  runReserved=true;
  let cancellationPoll:Promise<void>|undefined;
  const checkRunCancellation=()=>{
    if(controller.signal.aborted)return Promise.resolve();
    if(cancellationPoll)return cancellationPoll;
    cancellationPoll=store.isRunCancelRequested(s,current.id,input.runId).then(requested=>{if(requested)controller.abort();}).catch(()=>{controller.abort();}).finally(()=>{cancellationPoll=undefined;});
    return cancellationPoll;
  };
  const cancellationPollTimer=setInterval(()=>{void checkRunCancellation();},500);
  void checkRunCancellation();
  const stopCancellationPoll=async()=>{clearInterval(cancellationPollTimer);if(cancellationPoll)await cancellationPoll;};
  await checkRunCancellation();
  if(controller.signal.aborted){await stopCancellationPoll();await finishRunOnce('cancelled');detachRequestAbort();return new Response(null,{status:499});}
  const messageId=input.runId;
  current={...current,version:current.version+1,updatedAt:new Date().toISOString(),messages:[...current.messages,{id:messageId,role:'user',text:input.text,cardId:input.cardId,createdAt:new Date().toISOString()}]};
  try{await store.save(s,current,current.version-1);}catch(e){await stopCancellationPoll();await finishRunOnce('failed');detachRequestAbort();throw e;}
  await checkRunCancellation();
  if(controller.signal.aborted){await stopCancellationPoll();await finishRunOnce('cancelled');detachRequestAbort();return new Response(null,{status:499});}
  return streamSSE(c,async stream=>{
    const deadline=setTimeout(()=>controller.abort(),90000);let status='failed';let usage:unknown;
    stream.onAbort(()=>controller.abort());
    const emit=async(event:StreamEvent)=>{if(!stream.aborted)await stream.writeSSE({data:JSON.stringify(event)});};
    const heartbeat=setInterval(()=>{if(!stream.aborted)void stream.write(': keep-alive\n\n').catch(()=>{});},10000);
    let liveSnapshot=current;let streamedReply='';
    // Keep the model's context baseline separate from snapshots containing
    // concurrent human edits. Only our successfully applied fields advance it.
    let modelContextBaseline={...current.context};
    const activeActivities=new Map<string,AgentActivity>();
    const onActivity=async(activity:AgentActivity)=>{
      if(activity.state==='running')activeActivities.set(activity.id,activity);else activeActivities.delete(activity.id);
      await emit({type:'activity',...activity});
    };
    const acknowledgedDeltas=new Set<string>();
    let deltaQueue:Promise<unknown>=Promise.resolve();
    const persistTurn=async(result:TurnResult,includeMessage:boolean):Promise<Project>=>{
      for(let attempt=0;attempt<3;attempt++){
        await checkRunCancellation();
        if(controller.signal.aborted)throw new Error('cancelled');
        const latest=await store.get(s,current.id);const candidate=applyTurn(latest,result,{...modelContextBaseline});
        if(includeMessage){if(input.cardId)candidate.messages[candidate.messages.length-1].cardId=input.cardId;}
        else candidate.messages=latest.messages;
        await checkRunCancellation();
        if(controller.signal.aborted)throw new Error('cancelled');
        try{const saved=await store.save(s,candidate,latest.version);for(const key of Object.keys(result.contextPatch??{}) as Array<keyof Project['context']>)if(saved.context[key]!==latest.context[key])modelContextBaseline={...modelContextBaseline,[key]:saved.context[key]};liveSnapshot=saved;return saved;}
        catch(error){if(!(error instanceof store.HttpError)||error.status!==409||attempt===2)throw error;}
      }
      throw new store.HttpError(409,'O projeto recebeu várias edições. Seu conteúdo está salvo; tente enviar a mensagem novamente.');
    };
    const onDelta=(delta:CanvasDelta):Promise<Project>=>{
      const commit=async()=>{
        const key=JSON.stringify(delta);
        if(acknowledgedDeltas.has(key)){liveSnapshot=await store.get(s,current.id);return liveSnapshot;}
        const before=await store.get(s,current.id);
        const saved=await persistTurn({reply:'Atualização incremental do canvas.',...delta,mode:'live'},false);
        acknowledgedDeltas.add(key);
        const content=(card:CanvasCard)=>JSON.stringify({...card,position:undefined,pinnedPosition:undefined,revision:undefined});
        const old=new Map(before.cards.map(card=>[card.id,content(card)]));
        const changedSources=new Set(saved.sources.filter(source=>JSON.stringify(before.sources.find(previous=>previous.id===source.id))!==JSON.stringify(source)).map(source=>source.id));
        const changedCardIds=[...new Set([...saved.cards.filter(card=>old.get(card.id)!==content(card)||card.blocks.some(block=>block.sourceIds?.some(id=>changedSources.has(id)))).map(card=>card.id),...before.cards.filter(card=>!saved.cards.some(next=>next.id===card.id)).map(card=>card.id)])];
        const proposals=saved.proposals.filter(proposal=>!before.proposals.some(previous=>previous.id===proposal.id));
        const operation=delta.operations[0];
        const created=operation?.op==='add'&&!before.cards.some(card=>card.id===operation.cardId)?saved.cards.find(card=>card.id===operation.cardId):undefined;
        const updated=operation&&saved.cards.find(card=>card.id===operation.cardId);
        const removed=operation?.op==='remove'&&!updated&&before.cards.find(card=>card.id===operation.cardId);
        const proposedTitle=operation?.card?.title??operation?.patch?.title??before.cards.find(card=>card.id===operation?.cardId)?.title;
        const relationTitles=delta.operations.length>1&&delta.operations.every(operation=>operation.op==='update'&&operation.patch?.dependsOn!==undefined)?delta.operations.map(operation=>saved.cards.find(card=>card.id===operation.cardId)?.title??operation.patch?.title??'Anotação'):[];
        const label=created?`Criado: ${created.title}`:removed?`Removido: ${removed.title}`:proposals.length?`Proposta: ${proposedTitle??proposals[0].title}`:relationTitles.length?`Conexões atualizadas: ${relationTitles.join(' · ')}`:updated&&changedCardIds.includes(updated.id)?`Atualizado: ${updated.title}`:Object.keys(delta.contextPatch??{}).length?'Contexto do projeto atualizado':changedSources.size?'Fontes e referências atualizadas':'Projeto atualizado';
        await emit({type:'project',project:saved,changedCardIds,label}).catch(()=>{});
        return saved;
      };
      const pending=deltaQueue.then(commit,commit);deltaQueue=pending.then(()=>undefined,()=>undefined);return pending;
    };
    try{
      await checkRunCancellation();
      if(controller.signal.aborted){status='cancelled';return;}
      const result=await generateTurn(current,input.text,{signal:controller.signal,evidence:input.evidence,focusCardId:input.cardId,onStatus:(text:string)=>{void emit({type:'status',text}).catch(()=>{});},onActivity,onDelta,onText:async(text:string)=>{await emit({type:'text',text});streamedReply+=text;},reserveResearch:()=>store.reserveResearch(s,input.runId)});
      await checkRunCancellation();
      if(controller.signal.aborted)throw new Error('cancelled');
      // Models that omit publication still materialize validated final operations
      // before their answer. Preserve atomic action priority changes as one batch.
      if(result.operations.length||Object.keys(result.contextPatch??{}).length||result.sources.some(source=>JSON.stringify(liveSnapshot.sources.find(known=>known.id===source.id))!==JSON.stringify(source))){
        const researchIds=result.operations.filter(operation=>operation.card?.kind==='research'||liveSnapshot.cards.some(card=>card.id===operation.cardId&&card.kind==='research')).map(operation=>operation.cardId);
        await publishCanvasSequentially({operations:result.operations,contextPatch:result.contextPatch,sources:result.sources},liveSnapshot,onDelta,{onActivity});
        if(researchIds.some(id=>!hasResearchSynthesis(liveSnapshot.cards.find(card=>card.id===id),result.sources)&&liveSnapshot.proposals.some(proposal=>proposal.status==='pending'&&proposal.operations.some(operation=>operation.cardId===id))))result.reply='As fontes estão salvas. A síntese da pesquisa entrou em uma proposta para preservar a versão atual da anotação; revise essa proposta antes de aplicar os achados e as lacunas ao cartão.';
        result.operations=[];delete result.contextPatch;
      }
      const next=await persistTurn(result,true);
      usage=result.usage;
      if(!streamedReply)await emit({type:'text',text:result.reply});
      else if(result.reply.startsWith(streamedReply)&&result.reply.length>streamedReply.length)await emit({type:'text',text:result.reply.slice(streamedReply.length)});
      await emit({type:'complete',project:next,mode:result.mode});status='complete';
    }catch(error){status=controller.signal.aborted?'cancelled':'failed';for(const activity of [...activeActivities.values()])await onActivity({...activity,state:'failed'});await emit({type:'error',error:controller.signal.aborted?'A resposta foi interrompida. Sua mensagem e seu projeto estão salvos.':error instanceof store.HttpError?error.message:'Não foi possível preparar a resposta. Seu projeto está salvo; tente novamente.'});}
    finally{clearInterval(heartbeat);clearTimeout(deadline);await stopCancellationPoll();await deltaQueue;if(controller.signal.aborted&&status==='complete')status='cancelled';detachRequestAbort();await finishRunOnce(status,usage);}
  });
});
app.notFound(c=>c.json({error:'Rota não encontrada.'},404));
