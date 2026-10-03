import { z } from 'zod';
import type { TurnResult, Project } from './types';

const id = z.string().trim().min(1).max(120);
const shortText = z.string().max(400);
const text = z.string().max(16000);
export const httpUrlSchema = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, 'Use um endereço completo http ou https.');
export const contextSchema = z.object({
  idea: z.string().trim().min(1).max(12000), audience: shortText.optional(), city: shortText.optional(),
  budget: shortText.optional(), availability: shortText.optional(), constraints: z.string().max(2000).optional(), goal: shortText.optional(),
});
export const checklistItemSchema = z.object({ id, text: z.string().max(2000), checked: z.boolean(), humanEdited: z.boolean().optional() });
export const blockSchema = z.object({
  id, type: z.enum(['heading', 'paragraph', 'list', 'checklist', 'callout', 'sources']),
  text: text.optional(), items: z.array(checklistItemSchema).max(80).optional(), sourceIds: z.array(id).max(20).optional(), humanEdited: z.boolean().optional(),
});
export const canvasCardSchema = z.object({
  id, kind: z.enum(['context', 'hypothesis', 'research', 'action', 'evidence', 'decision', 'note']),
  title: z.string().trim().min(1).max(200), summary: z.string().max(2000),
  lane: z.enum(['now', 'next', 'later', 'done']), blocks: z.array(blockSchema).max(60),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
  revision: z.number().int().nonnegative(), origin: z.enum(['user', 'ai', 'web', 'demo']),
  humanEdited: z.boolean().optional(), pinnedPosition: z.boolean().optional(),
  status: z.enum(['draft', 'ready', 'doing', 'awaiting_evidence', 'done', 'review']).optional(), dependsOn: z.array(id).max(50),
});
export const sourceSchema = z.object({
  id, title: z.string().max(300), url: httpUrlSchema, consultedAt: z.string().datetime(), excerpt: z.string().max(6000), verified: z.boolean(),
});
export const evidenceInputSchema = z.object({
  text: z.string().trim().min(3).max(16000), cardId: id.optional(),
  type: z.enum(['interview', 'observation', 'offer_test', 'purchase', 'other']).default('other'),
  links: z.array(httpUrlSchema).max(10).default([]),
});
const evidenceSchema = evidenceInputSchema.extend({ id, createdAt: z.string().datetime(), origin: z.enum(['user', 'ai', 'web', 'demo']) });
export const cardOperationSchema = z.object({
  op: z.enum(['add', 'update', 'remove']), cardId: id, card: canvasCardSchema.optional(),
  patch: canvasCardSchema.partial().optional(), expectedRevision: z.number().int().nonnegative().optional(),
}).superRefine((operation, ctx) => {
  if (operation.op === 'add' && !operation.card) ctx.addIssue({ code: 'custom', message: 'Adicionar exige um cartão completo.' });
  if (operation.op === 'update' && !operation.patch) ctx.addIssue({ code: 'custom', message: 'Atualizar exige um patch.' });
  if (operation.card && operation.card.id !== operation.cardId) ctx.addIssue({ code: 'custom', message: 'ID do cartão não corresponde à operação.' });
  if (operation.patch?.id && operation.patch.id !== operation.cardId) ctx.addIssue({ code: 'custom', message: 'Não é permitido alterar o ID.' });
});
const proposalContentSchema = z.object({ title: z.string().min(1).max(300), reason: z.string().max(4000), operations: z.array(cardOperationSchema).max(25) });
export const turnResultSchema = z.object({
  reply: z.string().trim().min(1).max(16000), contextPatch: contextSchema.partial().optional(),
  operations: z.array(cardOperationSchema).max(25).default([]), proposal: proposalContentSchema.optional(),
  sources: z.array(sourceSchema).max(20).default([]), mode: z.enum(['live', 'fallback']), route: z.string().max(100).optional(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), model: z.string().max(100), jevModel: z.string().max(100).optional() }).optional(),
});
const messageSchema = z.object({ id, role: z.enum(['user', 'assistant']), text, createdAt: z.string().datetime(), sourceIds: z.array(id).max(20).optional(), incomplete: z.boolean().optional(), cardId:id.optional() });
const proposalSchema = proposalContentSchema.extend({ id, createdAt: z.string().datetime(), status: z.enum(['pending', 'accepted', 'rejected']) });
const revisionSchema = z.object({ id, at: z.string().datetime(), label: z.string().max(400), cards: z.array(canvasCardSchema).max(100), context: contextSchema });
export const projectImportSchema = z.object({
  id, title: z.string().min(1).max(200), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), version: z.number().int().nonnegative(),
  context: contextSchema, cards: z.array(canvasCardSchema).max(100), messages: z.array(messageSchema).max(500), sources: z.array(sourceSchema).max(200),
  evidence: z.array(evidenceSchema).max(300), proposals: z.array(proposalSchema).max(200), revisions: z.array(revisionSchema).max(50), demo: z.boolean().optional(),
});
export function parseTurnResult(raw: unknown): TurnResult { return turnResultSchema.parse(raw) as TurnResult; }
export function parseProject(raw: unknown): Project { return projectImportSchema.parse(raw) as Project; }
