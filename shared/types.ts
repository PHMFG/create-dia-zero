export type NodeKind = 'context' | 'hypothesis' | 'research' | 'action' | 'evidence' | 'decision' | 'note';
export type Lane = 'now' | 'next' | 'later' | 'done';
export type Origin = 'user' | 'ai' | 'web' | 'demo';
export interface ChecklistItem { id: string; text: string; checked: boolean; humanEdited?: boolean }
export interface Block { id: string; type: 'heading' | 'paragraph' | 'list' | 'checklist' | 'callout' | 'sources' | 'link' | 'image' | 'location'; text?: string; items?: ChecklistItem[]; sourceIds?: string[]; humanEdited?: boolean; url?: string; alt?: string; caption?: string; address?: string; latitude?: number; longitude?: number }
export interface CanvasCard { id: string; kind: NodeKind; title: string; summary: string; lane: Lane; blocks: Block[]; position: { x: number; y: number }; revision: number; origin: Origin; humanEdited?: boolean; pinnedPosition?: boolean; status?: 'draft' | 'ready' | 'doing' | 'awaiting_evidence' | 'done' | 'review'; dependsOn: string[] }
export interface Source { id: string; title: string; url: string; consultedAt: string; excerpt: string; verified: boolean; imageUrl?: string }
export interface Evidence { id: string; cardId?: string; type: 'interview' | 'observation' | 'offer_test' | 'purchase' | 'other'; text: string; links: string[]; createdAt: string; origin: Origin }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; sourceIds?: string[]; incomplete?: boolean; cardId?: string }
export interface Context { idea: string; audience?: string; city?: string; budget?: string; availability?: string; constraints?: string; goal?: string }
export interface CardOperation { op: 'add' | 'update' | 'remove'; cardId: string; card?: CanvasCard; patch?: Partial<CanvasCard>; expectedRevision?: number }
export interface Proposal { id: string; title: string; reason: string; operations: CardOperation[]; createdAt: string; status: 'pending' | 'accepted' | 'rejected' }
export interface Revision { id: string; at: string; label: string; cards: CanvasCard[]; context: Context }
export interface Project { id: string; title: string; createdAt: string; updatedAt: string; version: number; context: Context; cards: CanvasCard[]; messages: Message[]; sources: Source[]; evidence: Evidence[]; proposals: Proposal[]; revisions: Revision[]; demo?: boolean }
export interface TurnResult { reply: string; contextPatch?: Partial<Context>; operations: CardOperation[]; proposal?: Omit<Proposal, 'id' | 'createdAt' | 'status'>; sources: Source[]; mode: 'live' | 'fallback'; route?: string; usage?: { inputTokens: number; outputTokens: number; model: string; jevModel?: string } }
export interface CanvasDelta { contextPatch?: Partial<Context>; operations: CardOperation[]; sources: Source[] }
export interface AgentActivity { id: string; tool: string; label: string; state: 'running' | 'completed' | 'failed'; cardIds?: string[] }
export type StreamEvent = { type: 'status'; text: string } | ({type:'activity'} & AgentActivity) | { type: 'text'; text: string } | { type: 'project'; project: Project; changedCardIds: string[]; label: string } | { type: 'complete'; project: Project; mode: string } | { type: 'error'; error: string };
export interface Health { storage: 'supabase' | 'local'; ai: boolean; jev: boolean; research: boolean; auth: 'guest'; }
