import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges, Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer,
  getSmoothStepPath, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow,
  useNodesState, type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react';
import { ArrowUpRight, Check, Circle, FileText, Flag, FlaskConical, GripHorizontal, HelpCircle, Lightbulb, Link2, Map as ContextMap, MapIcon, MessageCircle, Search, Sparkles, X } from 'lucide-react';
import type { Block, CanvasCard, NodeKind, Project, Source } from '../../shared/types';
import { canConnect, connectionId, synchronizeCanvasNodes, validateConnection } from '../../shared/canvasConnections';
import { MediaBlock } from './MediaBlock';
import './Canvas.css';

export const kindLabels: Record<NodeKind, string> = { context: 'Seu contexto', hypothesis: 'Hipótese', research: 'Pesquisa', action: 'Próximo passo', evidence: 'Evidência', decision: 'Decisão', note: 'Anotação' };
export const kindIcons: Record<NodeKind, typeof Lightbulb> = { context: ContextMap, hypothesis: Lightbulb, research: Search, action: Flag, evidence: FlaskConical, decision: Sparkles, note: FileText };
export const laneLabels = { now: 'Agora', next: 'Próximas', later: 'Depois', done: 'Concluído' };

interface CardData extends Record<string, unknown> {
  card: CanvasCard; sources: Source[]; sourceCount: number; list?: boolean; changed?: boolean;
  onOpen: (id: string) => void; onClarify: (id: string) => void;
  onTitle: (id: string, title: string) => void; onCheck: (cardId: string, blockId: string, itemId: string) => void;
}
type CreateNode = Node<CardData, 'createCard'>;
interface DependencyData extends Record<string, unknown> { sourceTitle: string; targetTitle: string; onDisconnect?: (source: string, target: string) => void }
type DependencyEdge = Edge<DependencyData, 'createDependency'>;

function previewMedia(card: CanvasCard, sources: Source[]): Block[] {
  const explicit = card.blocks.filter(block => ['image', 'link', 'location'].includes(block.type));
  if (explicit.length) {
    const image = explicit.find(block => block.type === 'image');
    const location = explicit.find(block => block.type === 'location');
    const links = explicit.filter(block => block.type === 'link');
    if (image) return [image, location ?? links[0]].filter((block): block is Block => !!block);
    if (location) return [location, links[0]].filter((block): block is Block => !!block);
    return links.slice(0, 2);
  }
  const sourceIds = new Set(card.blocks.flatMap(block => block.sourceIds ?? []));
  const illustrated = sources.find(source => sourceIds.has(source.id) && source.imageUrl);
  return illustrated ? [{ id: `preview-${illustrated.id}`, type: 'image', url: illustrated.imageUrl, alt: illustrated.title, caption: illustrated.title, sourceIds: [illustrated.id] }] : [];
}

const CreateCard = memo(function CreateCard({ data, selected }: Pick<NodeProps<CreateNode>, 'data' | 'selected'>) {
  const { card, onOpen, onTitle, onCheck, sourceCount } = data;
  const titleField = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = titleField.current;
    if (!field) return;
    const resize = () => {
      if (!field.isConnected) return;
      const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 27;
      field.style.height = '0px';
      field.style.height = `${Math.min(lineHeight * 3, Math.max(lineHeight, field.scrollHeight))}px`;
    };
    resize();
    let frame: number | undefined;
    let disposed = false;
    const scheduleResize = () => {
      if (disposed || frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; if (!disposed) resize(); });
    };
    let width = field.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width ?? field.clientWidth;
      if (nextWidth !== width) { width = nextWidth; scheduleResize(); }
    });
    observer?.observe(field);
    void document.fonts?.ready.then(scheduleResize);
    return () => { disposed = true; observer?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [card.title, data.list]);
  const Icon = kindIcons[card.kind];
  const checklist = card.blocks.filter(block => block.type === 'checklist').flatMap(block => (block.items ?? []).map(item => ({ ...item, blockId: block.id })));
  const checked = checklist.filter(item => item.checked).length;
  const callout = card.blocks.find(block => block.type === 'callout');
  const media = previewMedia(card, data.sources);
  return <article className={`canvas-card kind-${card.kind} ${card.lane === 'now' ? 'card-now' : ''} ${selected ? 'card-selected' : ''} ${data.changed ? 'card-updated' : ''}`}>
    {data.changed && <span className="card-updated-badge" title="Este cartão recebeu uma alteração recente"><Sparkles size={11} aria-hidden="true" />Atualizado</span>}
    {!data.list && <>
      <Handle id="in" type="target" position={Position.Top} className="card-connection-handle card-connection-target" title="Este cartão depende do cartão ligado aqui" aria-label={`Pré-requisito para ${card.title}`} />
      <Handle id="out" type="source" position={Position.Bottom} className="card-connection-handle card-connection-source" title="Arraste para um cartão que depende deste" aria-label={`${card.title} como pré-requisito de outro cartão`} />
    </>}
    <div className={`card-top ${data.list ? '' : 'card-drag-handle'}`} title={data.list ? undefined : 'Arraste este cabeçalho para mover o cartão'}>
      <span className="kind-label"><Icon size={14} />{kindLabels[card.kind]}</span>
      <div className="card-header-meta">{!data.list && <GripHorizontal size={15} className="card-drag-grip" aria-hidden="true" />}<span className={`lane-badge lane-${card.lane}`}>{card.lane === 'now' && <span />}{laneLabels[card.lane]}</span></div>
    </div>
    <textarea ref={titleField} className="card-title nodrag nopan" value={card.title} rows={1} onChange={event => onTitle(card.id, event.target.value)} maxLength={180} aria-label={`Título do cartão ${card.title}`} />
    <p className="card-summary">{card.summary}</p>
    {media.length > 0 && <div className="canvas-media-preview nodrag nopan nowheel">{media.map(block => <MediaBlock key={block.id} block={block} sources={data.sources} compact />)}</div>}
    {checklist.length > 0 && <div className="card-checklist">{checklist.slice(0, 3).map(item => <button key={item.id} className={`nodrag nopan checklist-item ${item.checked ? 'checked' : ''}`} role="checkbox" aria-checked={item.checked} onClick={() => onCheck(card.id, item.blockId, item.id)}><span className="check-box">{item.checked && <Check size={11} />}</span><span>{item.text}</span></button>)}{checklist.length > 3 && <button className="nodrag nopan more-items" onClick={() => onOpen(card.id)}>+{checklist.length - 3} itens</button>}</div>}
    {!checklist.length && callout && <div className="card-callout"><Lightbulb size={14} /><span>{callout.text}</span></div>}
    <div className="card-bottom"><span>{checklist.length ? <><span className="tiny-progress"><span style={{ width: `${checked / checklist.length * 100}%` }} /></span>{checked}/{checklist.length} passos</> : sourceCount ? <><Link2 size={12} />{sourceCount} {sourceCount === 1 ? 'fonte' : 'fontes'}</> : <><Circle size={6} fill="currentColor" />{card.origin === 'user' ? 'Por você' : card.origin === 'demo' ? 'Exemplo' : 'Em construção'}</>}</span><div className="card-inline-actions"><button className="card-clarify nodrag nopan" onClick={() => data.onClarify(card.id)} aria-label={`Esclarecer dúvidas sobre ${card.title}`} title="Esclarecer uma dúvida"><MessageCircle size={13} /></button><button className="card-about nodrag nopan" onClick={() => onOpen(card.id)}>Sobre <ArrowUpRight size={14} /></button></div></div>
  </article>;
});

const CreateDependency = memo(function CreateDependency({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<DependencyEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 20, offset: 28 });
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={26} style={{ stroke: selected ? '#9c58cc' : '#c8b5dd', strokeWidth: selected ? 2.3 : 1.6 }} />
    <EdgeLabelRenderer><div className={`canvas-edge-label nodrag nopan ${selected ? 'edge-selected' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
      <span className="canvas-edge-description" title={data ? `${data.targetTitle} depende de ${data.sourceTitle}` : undefined}>{selected && data ? <><strong>{data.targetTitle}</strong> depende de <strong>{data.sourceTitle}</strong></> : 'Pré-requisito'}</span>
      {selected && data?.onDisconnect && <button type="button" onClick={event => { event.stopPropagation(); data.onDisconnect?.(source, target); }} aria-label={`Remover conexão de ${data.sourceTitle} para ${data.targetTitle}`} title="Remover conexão"><X size={13} /><span>Desconectar</span></button>}
    </div></EdgeLabelRenderer>
  </>;
});
const nodeTypes = { createCard: CreateCard };
const edgeTypes = { createDependency: CreateDependency };
const initialFitOptions = { padding: 0.18, minZoom: 0.85, maxZoom: 1 };
const defaultEdgeOptions = { type: 'createDependency', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#c8b5dd' } };

export interface CanvasProps {
  project: Project; list?: boolean;
  onOpen: (id: string) => void; onClarify: (id: string) => void;
  onTitle: (id: string, title: string) => void; onCheck: (cardId: string, blockId: string, itemId: string) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onConnect?: (source: string, target: string) => void; onDisconnect?: (source: string, target: string) => void;
  onNotice?: (message: string) => void; changedCardIds?: string[];
}

function cardData(card: CanvasCard, props: CanvasProps): CardData {
  return { card, sources: props.project.sources, sourceCount: new Set(card.blocks.flatMap(block => block.sourceIds ?? [])).size,
    changed: props.changedCardIds?.includes(card.id), onOpen: props.onOpen, onClarify: props.onClarify, onTitle: props.onTitle, onCheck: props.onCheck };
}

function GraphCanvas(props: CanvasProps) {
  const { project, onMove, onConnect, onDisconnect, onNotice } = props;
  const incomingNodes = useMemo<CreateNode[]>(() => project.cards.map(card => ({
    id: card.id, type: 'createCard', position: card.position, dragHandle: '.card-drag-handle',
    ariaLabel: `${kindLabels[card.kind]}: ${card.title}. Selecione o cartão e use as setas para movê-lo.`, data: cardData(card, props),
  })), [project.cards, project.sources, props.onOpen, props.onClarify, props.onTitle, props.onCheck, props.changedCardIds]);
  const [nodes, setNodes] = useNodesState<CreateNode>(incomingNodes);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const pendingPositions = useRef(new Map<string, { x: number; y: number }>());
  const draggedIds = useRef(new Set<string>());

  useEffect(() => {
    setNodes(previous => synchronizeCanvasNodes(previous, incomingNodes, pendingPositions.current, draggedIds.current));
  }, [incomingNodes, setNodes]);

  const handleNodesChange = useCallback((changes: NodeChange<CreateNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
    // Pointer dragging persists on drag-stop. Keyboard movement has no dragging flag.
    for (const change of changes) if (change.type === 'position' && change.position && change.dragging === undefined) {
      pendingPositions.current.set(change.id, change.position);
      onMove(change.id, change.position);
    }
  }, [setNodes, onMove]);

  const edges = useMemo<DependencyEdge[]>(() => {
    const byId = new Map(project.cards.map(card => [card.id, card]));
    return project.cards.flatMap(card => [...new Set(card.dependsOn)].filter(id => byId.has(id)).map(source => {
      const id = connectionId(source, card.id);
      return { id, source, target: card.id, sourceHandle: 'out', targetHandle: 'in', type: 'createDependency', selected: selectedEdgeId === id,
        ariaLabel: `${card.title} depende de ${byId.get(source)!.title}`, data: { sourceTitle: byId.get(source)!.title, targetTitle: card.title, onDisconnect } };
    }));
  }, [project.cards, selectedEdgeId, onDisconnect]);

  const handleConnect = useCallback((connection: Connection) => {
    const check = validateConnection(project.cards, connection.source, connection.target);
    if (!check.valid) { onNotice?.(check.error!); return; }
    onConnect?.(connection.source, connection.target);
    setShowHelp(false);
  }, [project.cards, onConnect, onNotice]);

  return <ReactFlow<CreateNode, DependencyEdge>
    className="create-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    onNodesChange={handleNodesChange}
    onNodeDragStart={(_, node) => draggedIds.current.add(node.id)}
    onNodeDragStop={(_, node) => { draggedIds.current.delete(node.id); pendingPositions.current.set(node.id, node.position); onMove(node.id, node.position); }}
    onNodeDoubleClick={(event, node) => {
      if ((event.target as Element).closest('textarea,input,button,a,.react-flow__handle')) return;
      props.onOpen(node.id);
    }}
    onConnect={handleConnect} isValidConnection={connection => canConnect(project.cards, connection.source, connection.target)}
    onConnectEnd={(_, state) => {
      if (state.isValid || !state.fromNode || !state.toNode) return;
      const reverse = state.fromHandle?.type === 'target';
      const check = validateConnection(project.cards, reverse ? state.toNode.id : state.fromNode.id, reverse ? state.fromNode.id : state.toNode.id);
      if (!check.valid) onNotice?.(check.error!);
    }}
    onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
    onEdgesChange={changes => { for (const change of changes) if (change.type === 'select') setSelectedEdgeId(current => change.selected ? change.id : current === change.id ? null : current); }}
    onPaneClick={() => setSelectedEdgeId(null)} onNodeClick={() => setSelectedEdgeId(null)}
    fitView fitViewOptions={initialFitOptions} minZoom={0.35} maxZoom={1.6} nodesConnectable={!!onConnect}
    connectionRadius={34} panOnDrag zoomOnScroll zoomOnPinch preventScrolling zoomOnDoubleClick={false}
    deleteKeyCode={null} defaultEdgeOptions={defaultEdgeOptions} aria-label="Canvas do seu projeto"
    ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': 'Aproximar o canvas', 'controls.zoomOut.ariaLabel': 'Afastar o canvas', 'controls.fitView.ariaLabel': 'Enquadrar todos os cartões', 'minimap.ariaLabel': 'Visão geral do canvas' }}>
    <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d8d0e1" />
    <Controls showInteractive={false} fitViewOptions={{ padding: 0.18, maxZoom: 1, duration: 260 }} />
    {showMap && <MiniMap className="canvas-minimap" position="bottom-right" pannable zoomable nodeColor={node => (node.data as CardData).card.lane === 'now' ? '#b387d7' : '#e3d5ef'} maskColor="#fcfafe99" />}
    <Panel position="bottom-right" className={`canvas-navigation-panel ${showMap ? 'map-open' : ''}`}>
      {showHelp && <div className="canvas-navigation-help"><strong>Seu espaço de trabalho</strong><p>Arraste o cabeçalho para mover. Ligue o ponto inferior ao superior de um cartão que depende dele. Clique na linha para ver a relação ou remover.</p><p>Arraste o fundo para navegar. Ajuste o zoom com a roda do mouse ou os controles.</p></div>}
      <div className="canvas-navigation-buttons"><button type="button" className={showMap ? 'active' : ''} onClick={() => setShowMap(value => !value)} aria-pressed={showMap} aria-label={showMap ? 'Ocultar visão geral' : 'Mostrar visão geral'} title="Visão geral"><MapIcon size={15} /></button><button type="button" className={showHelp ? 'active' : ''} onClick={() => setShowHelp(value => !value)} aria-expanded={showHelp} aria-label={showHelp ? 'Fechar ajuda do canvas' : 'Como usar o canvas'} title="Como usar"><HelpCircle size={15} /></button></div>
    </Panel>
  </ReactFlow>;
}

export default function Canvas(props: CanvasProps) {
  if (props.list) return <div className="canvas-list">{(['now', 'next', 'later', 'done'] as const).map(lane => {
    const cards = props.project.cards.filter(card => card.lane === lane);
    return cards.length ? <section className="canvas-list-section" key={lane}><h3><span className={`lane-dot lane-${lane}`} />{laneLabels[lane]} <span>{cards.length}</span></h3><div>{cards.map(card => <CreateCard key={card.id} data={{ ...cardData(card, props), list: true }} selected={false} />)}</div></section> : null;
  })}</div>;
  return <GraphCanvas key={props.project.id} {...props} />;
}
