import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { auditDependencyGraph } from '../shared/canvasConnections';
import { parseProject } from '../shared/validation';

// Explicit environment argument. Only this temporary visitor's project is removed.
const base = process.argv[2];
if (!base) throw new Error('Informe a URL pública ou local a verificar.');
const config = await fetch(`${base}/api/config`).then(response => response.json());
const client = createClient(config.url, config.publishableKey, { auth: { persistSession: false } });
const auth = await client.auth.signInAnonymously();
assert.ifError(auth.error);
const headers = { Authorization: `Bearer ${auth.data.session!.access_token}`, 'Content-Type': 'application/json' };
let id: string | undefined;
try {
  const page = await fetch(base);
  assert.equal(page.status, 200, 'A página precisa estar disponível sem login.');
  const response = await fetch(`${base}/api/projects/demo`, { method: 'POST', headers });
  assert.equal(response.status, 201, await response.clone().text());
  const demo = parseProject(await response.json()); id = demo.id;
  assert.equal(demo.demo, true);
  assert.equal(demo.cards.length, 10);
  assert.equal(new Set(demo.cards.map(card => card.kind)).size, 7);
  assert.deepEqual(auditDependencyGraph(demo.cards), { valid: true, issues: [] });
  assert.equal(demo.cards.filter(card => card.kind === 'action' && card.lane === 'now').length, 1);
  assert.ok(demo.cards.every(card => card.origin === 'demo'));
  assert.ok(demo.evidence.length > 0 && demo.evidence.every(evidence => evidence.origin === 'demo'));
  assert.ok(demo.sources.length > 0 && demo.sources.every(source => !source.verified));
  assert.ok(demo.cards.some(card => card.blocks.some(block => block.type === 'link')));
  assert.ok(demo.cards.some(card => card.blocks.some(block => block.type === 'location' && block.address?.includes('Porto Alegre'))));
  const byId = new Map(demo.cards.map(card => [card.id, card]));
  for (const card of demo.cards) for (const prerequisite of card.dependsOn) {
    assert.ok(card.position.y > byId.get(prerequisite)!.position.y, 'As conexões devem seguir para baixo.');
  }
  const persisted = await fetch(`${base}/api/projects/${id}`, { headers }).then(response => response.json());
  assert.deepEqual(persisted, demo, 'A cópia completa precisa estar salva antes de ser devolvida.');
  console.log(JSON.stringify({ base, page: page.status, cards: demo.cards.length, kinds: 7, connections: demo.cards.reduce((total, card) => total + card.dependsOn.length, 0), evidence: demo.evidence.length, manualSources: demo.sources.length, graph: 'valid', persisted: true }, null, 2));
} finally {
  if (id) assert.ok((await fetch(`${base}/api/projects/${id}`, { method: 'DELETE', headers })).ok);
  await client.auth.signOut();
}
