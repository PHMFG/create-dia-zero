import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {Project,Health,StreamEvent,Evidence} from '../../shared/types';
import { consumeEventStream } from './eventStream';
let client:SupabaseClient|undefined;let localToken='';let initializing:Promise<void>|undefined;
export class ApiError extends Error { constructor(public status:number,message:string,public code?:string){super(message);this.name='ApiError';} }
async function init(){
  if(!initializing)initializing=(async()=>{
    const cfg=await fetch('/api/config').then(r=>r.json());
    if(cfg.url&&cfg.publishableKey){client=createClient(cfg.url,cfg.publishableKey);const {data}=await client.auth.getSession();
      if(!data.session){const result=await client.auth.signInAnonymously();if(result.error)throw new Error('Não foi possível iniciar sua sessão de visitante. Tente novamente em alguns instantes.');}
    }else{localToken=localStorage.getItem('create-local-session')??`local_${crypto.randomUUID()}`;localStorage.setItem('create-local-session',localToken);}
  })().catch(e=>{initializing=undefined;throw e;});
  await initializing;
}
async function headers(){await init();const token=client?(await client.auth.getSession()).data.session?.access_token:localToken;if(!token)throw new Error('Atualize a página para iniciar sua sessão.');return {'Content-Type':'application/json',Authorization:`Bearer ${token}`};}
async function responseError(response:Response,fallback:string):Promise<ApiError>{
  let data:{error?:string;code?:string}={};try{data=await response.json() as typeof data;}catch{}
  return new ApiError(response.status,data.error??fallback,data.code);
}
async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await fetch(`/api${path}`,{method,headers:await headers(),body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw await responseError(response,'Não foi possível concluir esta ação.');return response.json() as Promise<T>;}
const abortError=()=>new DOMException('The operation was aborted.','AbortError');
function waitForRetry(ms:number,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{
    const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(abortError());};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',abort,{once:true});
  });
}
async function cancelRun(projectId:string,runId:string,authHeaders:Record<string,string>):Promise<void>{
  const timeout=new AbortController();const timer=setTimeout(()=>timeout.abort(),6000);
  try{
    const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cancel`,{method:'POST',headers:authHeaders,keepalive:true,signal:timeout.signal});
    if(!response.ok)throw await responseError(response,'Não foi possível confirmar a interrupção no servidor. Aguarde a resposta antes de enviar outra pergunta.');
  } finally {clearTimeout(timer);}
}
export const api={
  health:async():Promise<Health>=>fetch('/api/health').then(r=>r.json()),
  list:()=>request<Project[]>('/projects'),
  create:(idea:string)=>request<Project>('/projects','POST',{idea}),
  demo:()=>request<Project>('/projects/demo','POST'),
  get:(id:string)=>request<Project>(`/projects/${id}`),
  save:(project:Project)=>request<Project>(`/projects/${project.id}/canvas`,'PATCH',project),
  evidence:(id:string,input:{text:string;type:Evidence['type'];cardId?:string;links?:string[]})=>request<Project>(`/projects/${id}/evidence`,'POST',input),
  resolve:(id:string,proposalId:string,accept:boolean)=>request<Project>(`/projects/${id}/proposals/${proposalId}/resolve`,'POST',{accept}),
  import:(raw:unknown)=>request<Project>('/projects/import','POST',raw),
  remove:(id:string)=>request<{ok:boolean}>(`/projects/${id}`,'DELETE'),
  chat:async(id:string,text:string,onEvent:(event:StreamEvent)=>void,signal?:AbortSignal,options?:{evidence?:boolean;cardId?:string;onWaiting?:()=>void})=>{
    // The run ID is generated before any async auth work and is shared with the
    // durable cancellation endpoint if the stream is interrupted.
    const runId=crypto.randomUUID();let requestStarted=false;let runHeaders:Record<string,string>|undefined;let cancellation:Promise<void>|undefined;let cancellationFailure:ApiError|undefined;
    const requestCancel=()=>{
      if(!requestStarted||!runHeaders)return;
      cancellation??=cancelRun(id,runId,runHeaders).catch(()=>{cancellationFailure=new ApiError(503,'Não foi possível confirmar a interrupção no servidor. Aguarde a resposta antes de enviar outra pergunta.');});
    };
    const onAbort=()=>requestCancel();
    if(signal?.aborted)throw abortError();
    signal?.addEventListener('abort',onAbort,{once:true});
    let failure:unknown;
    try{
      const authHeaders=await headers();
      if(signal?.aborted)throw abortError();
      runHeaders=authHeaders;
      const requestPath=`/api/projects/${encodeURIComponent(id)}/messages`;
      const body=JSON.stringify({text,runId,evidence:options?.evidence,cardId:options?.cardId});
      const deadline=Date.now()+5000;let attempt=0;let response:Response;
      for(;;){
        if(signal?.aborted)throw abortError();
        requestStarted=true;
        response=await fetch(requestPath,{method:'POST',headers:authHeaders,body,signal});
        if(response.ok)break;
        const error=await responseError(response,'Não foi possível enviar sua mensagem.');
        if(signal?.aborted)throw abortError();
        if(error.status!==409||error.code!=='RUN_BUSY'||Date.now()>=deadline)throw error;
        options?.onWaiting?.();
        const delay=Math.min(200*(attempt+1),Math.max(0,deadline-Date.now()));attempt++;
        if(!delay)throw error;
        await waitForRetry(delay,signal);
      }
      const reader=response.body?.getReader();if(!reader)throw new Error('A resposta não pôde ser aberta.');
      await consumeEventStream(reader,onEvent,signal);
    }catch(error){failure=error;}
    finally{
      signal?.removeEventListener('abort',onAbort);
      if(cancellation)await cancellation;
    }
    if(cancellationFailure)throw cancellationFailure;
    if(failure!==undefined)throw failure;
  }
};
