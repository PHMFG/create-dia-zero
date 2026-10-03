import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, CircleAlert, LoaderCircle } from 'lucide-react';
import type { AgentActivity as Activity, CanvasCard } from '../../shared/types';
import './AgentActivity.css';

export default function AgentActivity({ activities, cards, generating, onOpen }: {
  activities: Activity[]; cards: CanvasCard[]; generating: boolean; onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!activities.length) return null;
  const visible = expanded ? activities : activities.slice(-5);
  const completed = activities.filter(item => item.state === 'completed').length;
  return <section className="agent-activity" aria-label="Atividades da create">
    <header><strong>{generating ? 'A create está trabalhando' : 'O que a create fez'}</strong><span>{completed} {completed === 1 ? 'etapa concluída' : 'etapas concluídas'}</span></header>
    {activities.length > 5 && <button className="activity-expand" onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} {expanded ? 'Mostrar as últimas etapas' : `Ver ${activities.length - 5} etapas anteriores`}</button>}
    <ol role="log" aria-live="polite" aria-relevant="additions text">{visible.map(item => {
      const related = cards.filter(card => item.cardIds?.includes(card.id));
      return <li key={item.id} className={`activity-${item.state}`}>
        <span className="activity-step-icon" aria-label={item.state === 'running' ? 'Em andamento' : item.state === 'failed' ? 'Não concluída' : 'Concluída'}>{item.state === 'running' ? <LoaderCircle size={15} className="spin"/> : item.state === 'failed' ? <CircleAlert size={15}/> : <Check size={15}/>}</span>
        <div><span>{item.label}</span>{related.length > 0 && <div className="activity-card-links">{related.map(card => <button key={card.id} onClick={() => onOpen(card.id)} aria-label={`Abrir ${card.title}`}>{related.length === 1 ? 'Ver cartão' : card.title}</button>)}</div>}</div>
      </li>;
    })}</ol>
  </section>;
}
