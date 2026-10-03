import { memo, useMemo } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { ArrowUpRight, Check, Circle, FileText, Flag, FlaskConical, Lightbulb, Link2, Map, MessageCircle, Search, Sparkles } from 'lucide-react';
import type { CanvasCard, NodeKind, Project } from '../../shared/types';

export const kindLabels: Record<NodeKind, string> = {context:'Seu contexto', hypothesis:'Hipótese', research:'Pesquisa', action:'Próximo passo', evidence:'Evidência', decision:'Decisão', note:'Anotação'};
export const kindIcons: Record<NodeKind, typeof Lightbulb> = {context:Map, hypothesis:Lightbulb, research:Search, action:Flag, evidence:FlaskConical, decision:Sparkles, note:FileText};
export const laneLabels = {now:'Agora', next:'Próximas', later:'Depois', done:'Concluído'};
interface CardData extends Record<string, unknown> { card: CanvasCard; sourceCount: number; list?: boolean; onOpen: (id:string) => void; onClarify:(id:string)=>void; onTitle: (id:string,title:string) => void; onCheck: (cardId:string,blockId:string,itemId:string) => void }
type CreateNode = Node<CardData, 'createCard'>;

const CreateCard = memo(function CreateCard({data}: NodeProps<CreateNode>) {
  const {card, onOpen, onTitle, onCheck, sourceCount} = data;
  const Icon = kindIcons[card.kind];
  const checklist = card.blocks.filter((b) => b.type === 'checklist').flatMap((b) => (b.items || []).map((item) => ({...item, blockId:b.id})));
  const checked = checklist.filter((item) => item.checked).length;
  const callout = card.blocks.find((b) => b.type === 'callout');
  return <article className={`canvas-card kind-${card.kind} ${card.lane === 'now' ? 'card-now' : ''}`}>
    {!data.list&&<><Handle type="target" position={Position.Top}/><Handle type="source" position={Position.Bottom}/></>}
    <div className="card-top"><span className="kind-label"><Icon size={14}/>{kindLabels[card.kind]}</span><span className={`lane-badge lane-${card.lane}`}>{card.lane === 'now' && <span/>}{laneLabels[card.lane]}</span></div>
    <textarea className="card-title nodrag nopan" value={card.title} rows={2} onChange={(e) => onTitle(card.id,e.target.value)} maxLength={180} aria-label={`Título do cartão ${card.title}`}/>
    <p className="card-summary">{card.summary}</p>
    {checklist.length > 0 && <div className="card-checklist">{checklist.slice(0, 3).map((item) => <button key={item.id} className={`nodrag nopan checklist-item ${item.checked ? 'checked' : ''}`} role="checkbox" aria-checked={item.checked} onClick={() => onCheck(card.id,item.blockId,item.id)}><span className="check-box">{item.checked && <Check size={11}/>}</span><span>{item.text}</span></button>)}{checklist.length > 3 && <button className="nodrag nopan more-items" onClick={() => onOpen(card.id)}>+{checklist.length - 3} itens</button>}</div>}
    {!checklist.length && callout && <div className="card-callout"><Lightbulb size={14}/><span>{callout.text}</span></div>}
    <div className="card-bottom"><span>{checklist.length ? <><span className="tiny-progress"><span style={{width:`${checked / checklist.length * 100}%`}}/></span>{checked}/{checklist.length} passos</> : sourceCount ? <><Link2 size={12}/>{sourceCount} {sourceCount === 1 ? 'fonte' : 'fontes'}</> : <><Circle size={6} fill="currentColor"/>{card.origin === 'user' ? 'Por você' : card.origin === 'demo' ? 'Exemplo' : 'Em construção'}</>}</span><div className="card-inline-actions"><button className="card-clarify nodrag nopan" onClick={()=>data.onClarify(card.id)} aria-label={`Esclarecer dúvidas sobre ${card.title}`} title="Esclarecer uma dúvida"><MessageCircle size={13}/></button><button className="card-about nodrag nopan" onClick={() => onOpen(card.id)}>Sobre <ArrowUpRight size={14}/></button></div></div>
  </article>;
});
const nodeTypes = {createCard:CreateCard};

interface Props { project: Project; list?: boolean; onOpen:(id:string)=>void; onClarify:(id:string)=>void; onTitle:(id:string,title:string)=>void; onCheck:(cardId:string,blockId:string,itemId:string)=>void; onMove:(id:string,position:{x:number;y:number})=>void }
export default function Canvas({project,list,onOpen,onClarify,onTitle,onCheck,onMove}: Props) {
  const nodes = useMemo(() => project.cards.map((card) => ({id:card.id,type:'createCard' as const,position:card.position,data:{card,sourceCount:card.blocks.flatMap((b) => b.sourceIds || []).length,onOpen,onClarify,onTitle,onCheck}})), [project.cards,onOpen,onClarify,onTitle,onCheck]);
  const edges = useMemo(() => project.cards.flatMap((card) => card.dependsOn.filter((id) => project.cards.some((c) => c.id === id)).map((id) => ({id:`${id}-${card.id}`,source:id,target:card.id,type:'smoothstep',style:{stroke:'#d5c9e9',strokeWidth:1.4,strokeDasharray:'5 5'}}))), [project.cards]);
  if (list) return <div className="canvas-list">{(['now','next','later','done'] as const).map((lane) => {const cards = nodes.filter((n) => n.data.card.lane === lane); return cards.length ? <section className="canvas-list-section" key={lane}><h3><span className={`lane-dot lane-${lane}`}/>{laneLabels[lane]} <span>{cards.length}</span></h3><div>{cards.map((node) => <CreateCard key={node.id} {...({data:{...node.data,list:true}} as NodeProps<CreateNode>)}/>)}</div></section> : null;})}</div>;
  return <ReactFlow<CreateNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeDragStop={(_,node) => onMove(node.id,node.position)} fitView fitViewOptions={{padding:.12,minZoom:.76,maxZoom:1}} minZoom={.35} maxZoom={1.4} nodesConnectable={false} deleteKeyCode={null} defaultEdgeOptions={{type:'smoothstep'}} aria-label="Canvas do seu projeto">
    <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d8d0e1"/><Controls showInteractive={false}/>
  </ReactFlow>;
}
