import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

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
async function request(path: string, method = 'GET', body?: unknown, jwt = token) {
  return fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function json(path: string, method = 'GET', body?: unknown) {
  const res = await request(path, method, body); const data = await res.json();
  assert.ok(res.ok, `${method} ${path}: ${JSON.stringify(data)}`); return data;
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
  const initialEvents=(await initialResponse.text()).split(/\r?\n\r?\n/).flatMap(packet=>packet.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))));
  const initialized=initialEvents.find(e=>e.type==='complete');assert.ok(initialized,JSON.stringify(initialEvents));assert.equal(initialized.mode,'live',initialized.project.messages.at(-1)?.text);p=initialized.project;
  assert.ok(p.cards.length>startingCards,'A IA deve criar novos cartões a partir da ideia.');checks.push('real AI progressively creates canvas cards from the idea');
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
  const raw = await res.text(); const events = raw.split(/\r?\n\r?\n/).flatMap(packet => packet.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))));
  const done = events.find(e => e.type === 'complete'); assert.ok(done, JSON.stringify(events)); assert.equal(done.mode, 'live');
  const kept = done.project.cards.find((c: any) => c.id === action.id); assert.equal(kept.title, action.title); assert.equal(kept.blocks.find((x: any) => x.id === block.id).items[0].checked, true);
  checks.push('real DeepSeek/Jev turn through SSE and human edits retained');
  assert.equal(done.project.messages.at(-1).cardId,action.id);assert.equal(done.project.messages.at(-2).cardId,action.id);checks.push('card mini chat persists its conversation context');
  assert.ok(done.project.messages.at(-1).role === 'assistant');
  const final = await json(`/projects/${p.id}`); assert.equal(final.version, done.project.version); checks.push('AI result persisted before completion event');
  const imported = await json('/projects/import', 'POST', { format: 'create-project', version: 1, project: final }); projects.push(imported.id); assert.notEqual(imported.id, p.id); checks.push('JSON import restores an independent project');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/api-smoke.json', JSON.stringify({ base, at: new Date().toISOString(), health, checks, guestIds: [a.data.user!.id, b.data.user!.id], ai: { mode: done.mode, cards: final.cards.length, proposals: final.proposals.length } }, null, 2));
  console.log(JSON.stringify({ base, checks, mode: done.mode, cards: final.cards.length, proposals: final.proposals.length }, null, 2));
} finally {
  for (const id of projects) { const r = await request(`/projects/${id}`, 'DELETE'); assert.ok(r.ok); }
  await owner.auth.signOut(); await stranger.auth.signOut();
}
