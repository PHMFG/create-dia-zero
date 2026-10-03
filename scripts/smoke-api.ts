import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { auditDependencyGraph } from '../shared/canvasConnections';

// Explicit opt-in smoke check against the chosen environment. Creates temporary
// visitor projects, exercises a real AI turn and deletes those projects afterward.
const base = process.argv[2];
if (!base) throw new Error('Informe a URL: npx tsx scripts/smoke-api.ts http://127.0.0.1:5173');
const cfg = await fetch(`${base}/api/config`).then(r => r.json());
const owner = createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: false } });
const stranger = createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: false } });
const a = await owner.auth.signInAnonymously(); const b = await stranger.auth.signInAnonymously();
assert.ifError(a.error); assert.ifError(b.error);
const token = a.data.session!.access_token, other = b.data.session!.access_token;
const projects: string[] = []; const checks: string[] = [];
const progress:Array<{atMs:number;version:number;cards:number;changed:number}>=[];
async function request(path: string, method = 'GET', body?: unknown, jwt = token) {
  return fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function json(path: string, method = 'GET', body?: unknown) {
  const res = await request(path, method, body); const data = await res.json();
  assert.ok(res.ok, `${method} ${path}: ${JSON.stringify(data)}`); return data;
}
async function consume(response:Response,projectId:string){
  const events:any[]=[];const reader=response.body!.getReader(),decoder=new TextDecoder();let pending='';const started=Date.now();
  for(;;){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});const packets=pending.split(/\r?\n\r?\n/);pending=packets.pop()??'';
    for(const packet of packets){const data=packet.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue;const event=JSON.parse(data);events.push(event);
      if(event.type==='project'){
        assert.ok(!events.some(e=>e.type==='complete'),'A atualização deve chegar antes da conclusão.');
        const saved=await json(`/projects/${projectId}`);assert.ok(saved.version>=event.project.version,'Delta precisa estar salvo antes da publicação.');
        progress.push({atMs:Date.now()-started,version:event.project.version,cards:event.project.cards.length,changed:event.changedCardIds.length});
        console.log(`Canvas salvo durante a geração: versão ${event.project.version}, ${event.project.cards.length} cartões, ${event.project.sources.length} fontes (${Date.now()-started} ms).`);
      }
    }
  }
  return events;
}
try {
  const health = await fetch(`${base}/api/health`).then(r => r.json());
  assert.equal(health.storage, 'supabase'); assert.equal(health.ai, true); checks.push('public health and configured providers');
  assert.equal((await fetch(`${base}/api/projects`)).status, 401); checks.push('unauthenticated API denied');
  let p = await json('/projects', 'POST', { idea: 'Teste técnico descartável: Chabor, matcha para estudantes em Porto Alegre, orçamento de R$ 3000 e duas tardes por semana.' }); projects.push(p.id);
  assert.equal((await request(`/projects/${p.id}`, 'GET', undefined, other)).status, 404);
  const leak = await stranger.from('create_projects').select('id').eq('id', p.id); assert.deepEqual(leak.data, []); checks.push('guest ownership through API and database RLS');
  const startingCards=p.cards.length;
  const initialResponse=await request(`/projects/${p.id}/messages`,'POST',{text:p.context.idea,runId:crypto.randomUUID()});
  assert.ok(initialResponse.ok);
  const initialEvents=await consume(initialResponse,p.id);
  const initialized=initialEvents.find(e=>e.type==='complete');assert.ok(initialized,JSON.stringify(initialEvents));assert.equal(initialized.mode,'live',initialized.project.messages.at(-1)?.text);p=initialized.project;
  assert.ok(p.cards.length>startingCards,'A IA deve criar novos cartões a partir da ideia.');checks.push('real AI progressively creates canvas cards from the idea');
  assert.ok(initialEvents.some(e=>e.type==='project'),'A IA precisa publicar um delta durante a geração.');checks.push('canvas deltas arrive over SSE and are persisted before the final reply');
  const initialSnapshots=initialEvents.filter(e=>e.type==='project');let previousCount=startingCards;
  for(const snapshot of initialSnapshots){assert.ok(snapshot.project.cards.length-previousCount<=1,'Cartões aceitos devem aparecer um por vez.');previousCount=snapshot.project.cards.length;}
  const activities=initialEvents.filter(e=>e.type==='activity');assert.ok(activities.some(e=>e.state==='running'));assert.ok(activities.some(e=>e.state==='completed'&&e.cardIds?.length));
  for(const started of activities.filter(e=>e.state==='running'))assert.ok(activities.some(e=>e.id===started.id&&e.state!=='running'),'Toda função deve ter um estado final visível.');
  assert.equal(auditDependencyGraph(p.cards).valid,true);assert.ok(p.cards.some((c:any)=>c.kind==='action'&&c.dependsOn.length));checks.push('ordered individual cards, named tool activity and coherent dependencies');
  const action = p.cards.find((c: any) => c.kind === 'action');
  assert.ok(action,'O contexto permite sugerir um primeiro teste.');
  const block = action.blocks.find((x: any) => x.type === 'checklist') ?? {id:crypto.randomUUID(),type:'checklist',items:[{id:crypto.randomUUID(),text:'Passo incluído pela pessoa para verificar o editor',checked:false}]};
  if(!action.blocks.some((x:any)=>x.id===block.id))action.blocks.push(block);
  block.items[0].checked = true; block.items[0].humanEdited = true;
  action.title = 'Título editado pela pessoa'; action.humanEdited = true; action.revision++;
  const before = structuredClone(p); p = await json(`/projects/${p.id}/canvas`, 'PATCH', p);
  assert.equal((await request(`/projects/${p.id}/canvas`, 'PATCH', before)).status, 409);
  const persisted = await json(`/projects/${p.id}`);
  assert.equal(persisted.cards.find((c: any) => c.id === action.id).blocks.find((x: any) => x.id === block.id).items[0].checked, true);
  checks.push('edited content/checklist persistence and stale write rejected');
  p = await json(`/projects/${p.id}/evidence`, 'POST', { type: 'interview', cardId: action.id, text: 'Relato simulado exclusivamente para teste técnico: três estudantes disseram que bebidas caras não cabem no orçamento. Dois só compram ocasionalmente e um prefere preparar em casa. Nenhuma venda ocorreu.', links: [] });
  assert.equal(p.evidence.length, 1); checks.push('evidence persisted separately from hypothesis');
  const res = await request(`/projects/${p.id}/messages`, 'POST', { text: 'Neste cartão, como adaptar o teste ao relato que registrei? Preserve meu título e minha checklist e proponha uma revisão se necessário, sem declarar a ideia validada.', evidence: true, cardId:action.id, runId: crypto.randomUUID() });
  assert.ok(res.ok, await (res.ok ? Promise.resolve('') : res.text()));
  const events=await consume(res,p.id);
  const done = events.find(e => e.type === 'complete'); assert.ok(done, JSON.stringify(events)); assert.equal(done.mode, 'live');
  const kept = done.project.cards.find((c: any) => c.id === action.id); assert.equal(kept.title, action.title); assert.equal(kept.blocks.find((x: any) => x.id === block.id).items[0].checked, true);
  checks.push('real DeepSeek/Jev turn through SSE and human edits retained');
  assert.equal(done.project.messages.at(-1).cardId,action.id);assert.equal(done.project.messages.at(-2).cardId,action.id);checks.push('card mini chat persists its conversation context');
  assert.ok(done.project.messages.at(-1).role === 'assistant');
  let final = await json(`/projects/${p.id}`); assert.equal(final.version, done.project.version); checks.push('AI result persisted before completion event');
  if(health.research){
    const researchResponse=await request(`/projects/${p.id}/messages`,'POST',{text:'Pesquise na internet referências do Sebrae e informações para testar uma pequena loja de matcha em Porto Alegre. Crie uma anotação com blocos de links das fontes consultadas e uma imagem retornada pela pesquisa, se houver, como referência visual. Acrescente um bloco de localização para a região que informei: Porto Alegre, RS; não invente endereço de estabelecimento nem coordenadas. Preserve meus cartões editados.',runId:crypto.randomUUID()});
    assert.ok(researchResponse.ok);const researchEvents=await consume(researchResponse,p.id);const researched=researchEvents.find(e=>e.type==='complete');assert.ok(researched,'Pesquisa deve concluir.');assert.equal(researched.mode,'live');
    final=researched.project;assert.ok(final.sources.some((s:any)=>s.verified),'Pesquisa deve fornecer fontes reais.');
    assert.equal(auditDependencyGraph(final.cards).valid,true);
    const blocks=final.cards.flatMap((c:any)=>c.blocks);
    assert.ok(blocks.some((b:any)=>b.type==='link'&&final.sources.some((s:any)=>s.url===b.url)),'Fontes devem aparecer como blocos de link nas anotações.');
    if(final.sources.some((s:any)=>s.imageUrl))assert.ok(blocks.some((b:any)=>b.type==='image'&&final.sources.some((s:any)=>s.imageUrl===b.url)),'Imagem retornada deve aparecer como bloco visual com fonte conhecida.');
    assert.ok(blocks.some((b:any)=>b.type==='location'&&b.address?.includes('Porto Alegre')),'A região fornecida deve aparecer como localização, sem inventar coordenadas.');
    assert.ok(researchEvents.some(e=>e.type==='project'&&e.project.sources.length>0));checks.push('real internet research publishes links, provider images and the supplied project region');
    const saved=await json(`/projects/${p.id}`);assert.equal(saved.version,final.version);
  }
  // Exercise the real HTTP disconnect, not only a mocked AbortSignal. A cancelled
  // response must release its lease so the next queued question can start.
  const cancelController = new AbortController();
  const interrupted = await fetch(`${base}/api/projects/${p.id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Teste técnico de interrupção: prepare dez perguntas abertas para uma entrevista. Não pesquise nem altere cartões.', runId: crypto.randomUUID() }),
    signal: cancelController.signal,
  });
  assert.ok(interrupted.ok, 'A execução que será interrompida deve iniciar.');
  const interruptedReader = interrupted.body!.getReader();
  assert.equal((await interruptedReader.read()).done, false, 'O SSE precisa aceitar a pergunta antes do cancelamento.');
  cancelController.abort(); await interruptedReader.cancel().catch(() => {});
  const resumeStarted = Date.now(), resumeRunId = crypto.randomUUID();
  let resumed: Response;
  for (;;) {
    resumed = await request(`/projects/${p.id}/messages`, 'POST', { text: 'Em uma frase, qual é a diferença entre hipótese e evidência? Não pesquise nem altere cartões.', runId: resumeRunId });
    if (resumed.status !== 409 || Date.now() - resumeStarted >= 10000) break;
    await resumed.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(resumed.ok, await (resumed.ok ? Promise.resolve('') : resumed.text()));
  const resumedEvents = await consume(resumed, p.id);
  const resumedDone = resumedEvents.find(event => event.type === 'complete');
  assert.ok(resumedDone, 'A pergunta seguinte precisa concluir sem ficar presa à execução interrompida.');
  assert.equal(resumedDone.mode, 'live'); final = resumedDone.project;
  checks.push('real HTTP cancellation releases the run and the next question completes');
  const imported = await json('/projects/import', 'POST', { format: 'create-project', version: 1, project: final }); projects.push(imported.id); assert.notEqual(imported.id, p.id); checks.push('JSON import restores an independent project');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/research-smoke-project.json', JSON.stringify({format:'create-project',version:1,project:final},null,2));
  await writeFile('artifacts/api-smoke.json', JSON.stringify({ base, at: new Date().toISOString(), health, checks, progress, ai: { mode: done.mode, cards: final.cards.length, proposals: final.proposals.length } }, null, 2));
  console.log(JSON.stringify({ base, checks, progress, mode: done.mode, cards: final.cards.length, proposals: final.proposals.length }, null, 2));
} finally {
  for (const id of projects) { const r = await request(`/projects/${id}`, 'DELETE'); assert.ok(r.ok); }
  await owner.auth.signOut(); await stranger.auth.signOut();
}
