import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Project } from '../shared/types';

export class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
const memory = new Map<string, Map<string, Project>>();
interface LocalRun { owner: string; projectId: string; runId: string; createdAt: number; day: string; month: string; status: string; researchAt?: number; researchDay?: string; researchMonth?: string; cancelRequestedAt?:number; cancelledBeforeReserve?:boolean; usage?: unknown }
const locks = new Map<string, { owner: string; runId: string; expiresAt: number }>();
const runs = new Map<string, LocalRun>();
const quotaDay = (now: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const runKey = (owner: string, runId: string) => `${owner}:${runId}`;
export interface StoreSession { owner: string; db?: SupabaseClient }
export const configured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);

export async function session(request: Request): Promise<StoreSession> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sua sessão precisa ser iniciada. Atualize a página.');
  if (configured()) {
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Sua sessão expirou. Atualize a página para continuar.');
    return { owner: data.user.id, db };
  }
  if (process.env.VERCEL) throw new HttpError(503, 'O banco ainda está sendo configurado.');
  if (!/^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) throw new HttpError(401, 'Sessão local inválida.');
  return { owner: token };
}
const local = (s: StoreSession) => { if (!memory.has(s.owner)) memory.set(s.owner, new Map()); return memory.get(s.owner)!; };
export async function list(s: StoreSession): Promise<Project[]> {
  if (!s.db) return [...local(s).values()].map(p => structuredClone(p)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const { data, error } = await s.db.from('create_projects').select('document').eq('owner_id', s.owner).order('updated_at', { ascending: false }).limit(3);
  if (error) throw new HttpError(503, 'Não foi possível abrir seus projetos. Tente novamente.');
  return (data ?? []).map(r => r.document as Project);
}
export async function get(s: StoreSession, id: string): Promise<Project> {
  if (!s.db) { const p = local(s).get(id); if (!p) throw new HttpError(404, 'Projeto não encontrado.'); return structuredClone(p); }
  const { data, error } = await s.db.from('create_projects').select('document').eq('id',id).eq('owner_id',s.owner).maybeSingle();
  if (error) throw new HttpError(503, 'Não foi possível abrir o projeto.');
  if (!data) throw new HttpError(404, 'Projeto não encontrado nesta sessão.');
  return data.document as Project;
}
export async function insert(s: StoreSession, p: Project): Promise<Project> {
  if (!s.db) {
    const projects = local(s);
    if (projects.size >= 3) throw new HttpError(429, 'Você já tem três projetos. Exporte e remova um para criar outro.');
    if (projects.has(p.id)) throw new HttpError(409, 'Este projeto já existe.');
    projects.set(p.id, structuredClone(p)); return p;
  }
  if ((await list(s)).length >= 3) throw new HttpError(429, 'Você já tem três projetos. Exporte e remova um para criar outro.');
  const { error } = await s.db.from('create_projects').insert({ id:p.id, owner_id:s.owner, document:p, version:p.version, updated_at:p.updatedAt });
  if (error?.code === 'P0001' && error.message === 'project limit reached') throw new HttpError(429, 'Você já tem três projetos. Exporte e remova um para criar outro.');
  if (error) throw new HttpError(503, 'Não foi possível salvar o novo projeto.');
  return p;
}
export async function save(s: StoreSession,p:Project,expected:number):Promise<Project> {
  if (!s.db) { const existing = local(s).get(p.id); if (!existing || existing.version !== expected) throw new HttpError(409,'O projeto mudou em outra janela. Reabra para continuar.'); local(s).set(p.id,structuredClone(p)); return p; }
  const { data,error } = await s.db.from('create_projects').update({document:p,version:p.version,updated_at:p.updatedAt}).eq('id',p.id).eq('owner_id',s.owner).eq('version',expected).select('id');
  if (error) throw new HttpError(503,'Não foi possível salvar. Seu texto foi preservado para tentar novamente.');
  if (!data?.length) throw new HttpError(409,'O projeto mudou em outra janela. Reabra para continuar.');
  return p;
}
export async function remove(s:StoreSession,id:string) {
  await get(s,id);
  if (!s.db) {local(s).delete(id);locks.delete(id);return;}
  const {error}=await s.db.from('create_projects').delete().eq('id',id).eq('owner_id',s.owner);
  if(error)throw new HttpError(503,'Não foi possível remover o projeto.');
}
export async function reserveRun(s:StoreSession,projectId:string,runId:string):Promise<boolean> {
  if (!s.db) {
    if (!local(s).has(projectId)) throw new HttpError(404, 'Projeto não encontrado nesta sessão.');
    const key = runKey(s.owner, runId);
    if (runs.has(key)) return false;
    const now = Date.now(); const day = quotaDay(now); const month = day.slice(0, 7);
    for (const [id, lock] of locks) if (lock.expiresAt <= now) {
      const expired = runs.get(runKey(lock.owner, lock.runId)); if (expired) expired.status = 'expired';
      locks.delete(id);
    }
    if (locks.has(projectId)) throw new HttpError(409, 'Já existe uma resposta sendo preparada para este projeto.','RUN_BUSY');
    const daily = [...runs.values()].filter(run => run.day === day&&!run.cancelledBeforeReserve);
    if (daily.filter(run => run.owner === s.owner).length >= 30) throw new HttpError(429, 'Você chegou ao limite de 30 mensagens de hoje. O canvas continua disponível.');
    if (daily.length >= 200) throw new HttpError(429, 'O limite de respostas de hoje foi atingido. O canvas continua disponível.');
    runs.set(key, { owner: s.owner, projectId, runId, createdAt: now, day, month, status: 'running' });
    locks.set(projectId, { owner: s.owner, runId, expiresAt: now + 120000 }); return true;
  }
  const {data,error}=await s.db.rpc('create_reserve_run',{p_project_id:projectId,p_run_id:runId});
  if(error){
    if(error.code==='P0001')throw new HttpError(429,'Você chegou ao limite de uso de hoje. Continue editando o canvas.');
    if(error.code==='55000')throw new HttpError(409,'Já existe uma resposta sendo preparada para este projeto.','RUN_BUSY');
    throw new HttpError(503,'Não foi possível iniciar a resposta agora. Tente novamente.');
  }
  return data===true;
}
export async function finishRun(s:StoreSession,runId:string,projectId:string,status:string,usage?:unknown) {
  if(!s.db){
    if (!local(s).has(projectId)) return;
    const run = runs.get(runKey(s.owner, runId));
    if (run?.projectId === projectId && run.status === 'running') { run.status = status; run.usage = structuredClone(usage ?? {}); }
    const lock = locks.get(projectId);
    if(lock?.owner===s.owner && lock.runId===runId) locks.delete(projectId);
    return;
  }
  await s.db.rpc('create_finish_run',{p_project_id:projectId,p_run_id:runId,p_status:status,p_usage:usage??{}});
}
/** Request cancellation without releasing the active generation's lease. */
export async function requestRunCancel(s:StoreSession,projectId:string,runId:string):Promise<boolean> {
  if(!s.db){
    const projects=local(s);if(!projects.has(projectId))return false;
    const key=runKey(s.owner,runId);const run=runs.get(key);const now=Date.now();
    if(!run){
      const day=quotaDay(now);const requests=[...runs.values()].filter(item=>item.cancelledBeforeReserve&&item.day===day);
      if(requests.filter(item=>item.owner===s.owner).length>=30||requests.length>=200)throw new HttpError(429,'O limite diário de pedidos de cancelamento foi atingido.');
      runs.set(key,{owner:s.owner,projectId,runId,createdAt:now,day,month:day.slice(0,7),status:'cancelled',cancelledBeforeReserve:true,cancelRequestedAt:now});
      return true;
    }
    if(run.projectId!==projectId||run.status!=='running')return false;
    const lock=locks.get(projectId);
    if(!lock||lock.owner!==s.owner||lock.runId!==runId)return false;
    run.cancelRequestedAt??=now;return true;
  }
  const {data,error}=await s.db.rpc('create_request_run_cancel',{p_project_id:projectId,p_run_id:runId});
  if(error?.code==='P0001')throw new HttpError(429,'O limite diário de pedidos de cancelamento foi atingido.');
  if(error)throw new HttpError(503,'Não foi possível solicitar a interrupção agora. Tente novamente.');
  return data===true;
}
export async function isRunCancelRequested(s:StoreSession,projectId:string,runId:string):Promise<boolean> {
  if(!s.db){
    const run=runs.get(runKey(s.owner,runId));
    return Boolean(run&&run.projectId===projectId&&run.status==='running'&&run.cancelRequestedAt!==undefined);
  }
  const {data,error}=await s.db.rpc('create_is_run_cancel_requested',{p_project_id:projectId,p_run_id:runId});
  if(error)throw new HttpError(503,'Não foi possível conferir a interrupção da resposta.');
  return data===true;
}
export async function reserveResearch(s:StoreSession,runId:string):Promise<boolean> {
  if(!s.db){
    const run = runs.get(runKey(s.owner, runId)); const now = Date.now();
    if (!run || run.status !== 'running' || run.researchAt !== undefined || !local(s).has(run.projectId)) return false;
    const lock = locks.get(run.projectId);
    if (!lock || lock.owner !== s.owner || lock.runId !== runId || lock.expiresAt <= now) return false;
    const day = quotaDay(now); const month = day.slice(0,7);
    const reserved = [...runs.values()].filter(item => item.researchAt !== undefined);
    if (reserved.filter(item => item.owner === s.owner && item.researchDay === day).length >= 5) return false;
    if (reserved.filter(item => item.researchDay === day).length >= 25) return false;
    if (reserved.filter(item => item.researchMonth === month).length * 3 + 3 > 750) return false;
    run.researchAt = now; run.researchDay = day; run.researchMonth = month; return true;
  }
  const {data,error}=await s.db.rpc('create_reserve_research',{p_run_id:runId});
  if(error)throw new HttpError(503,'Não foi possível reservar uma pesquisa agora. Tente novamente.');
  return data===true;
}
