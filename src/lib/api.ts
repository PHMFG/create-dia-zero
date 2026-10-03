import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {Project,Health,StreamEvent,Evidence} from '../../shared/types';
import { consumeEventStream } from './eventStream';
let client:SupabaseClient|undefined;let localToken='';let initializing:Promise<void>|undefined;
export class ApiError extends Error { constructor(public status:number,message:string){super(message);this.name='ApiError';} }
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
async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{const r=await fetch(`/api${path}`,{method,headers:await headers(),body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new ApiError(r.status,data.error??'Não foi possível concluir esta ação.');return data;}
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
  chat:async(id:string,text:string,onEvent:(event:StreamEvent)=>void,signal?:AbortSignal,options?:{evidence?:boolean;cardId?:string})=>{
    const response=await fetch(`/api/projects/${id}/messages`,{method:'POST',headers:await headers(),body:JSON.stringify({text,runId:crypto.randomUUID(),evidence:options?.evidence,cardId:options?.cardId}),signal});
    if(!response.ok){const error=await response.json();throw new ApiError(response.status,error.error??'Não foi possível enviar sua mensagem.');}
    const reader=response.body?.getReader();if(!reader)throw new Error('A resposta não pôde ser aberta.');
    await consumeEventStream(reader,onEvent,signal);
  }
};
