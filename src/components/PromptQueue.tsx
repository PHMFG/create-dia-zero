import { useState } from 'react';
import { ListPlus, Play, X } from 'lucide-react';
import type { CanvasCard } from '../../shared/types';
import './PromptQueue.css';

export interface QueuedPrompt {
  id: string;
  text: string;
  cardId?: string;
  evidenceRegistered?: boolean;
}

interface Props {
  items: QueuedPrompt[];
  cards: CanvasCard[];
  paused: boolean;
  onRemove: (id: string) => void;
  onResume: () => void;
}

export default function PromptQueue({ items, cards, paused, onRemove, onResume }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const visible = expanded ? items : items.slice(0, 3);
  const hiddenCount = items.length - visible.length;

  return <section className="prompt-queue" aria-label="Perguntas na fila">
    <header className="prompt-queue-heading">
      <div><ListPlus size={15} aria-hidden="true"/><strong>Fila de perguntas</strong><span className="prompt-queue-count">{items.length}</span></div>
      {paused ? <div className="prompt-queue-paused"><span>Pausada</span><button type="button" onClick={onResume}><Play size={12} fill="currentColor"/>Retomar</button></div> : <span className="prompt-queue-running">Será respondida em ordem</span>}
    </header>
    <ol className={expanded ? 'prompt-queue-items is-expanded' : 'prompt-queue-items'} aria-live="polite" aria-relevant="additions removals">
      {visible.map((item, index) => {
        const card = item.cardId ? cards.find(candidate => candidate.id === item.cardId) : undefined;
        const destination = card?.title ?? (item.cardId ? 'Cartão removido' : 'Conversa geral');
        return <li key={item.id}>
          <span className="prompt-queue-order" aria-label={`Pergunta ${index + 1}`}>{index + 1}</span>
          <div className="prompt-queue-copy"><span className="prompt-queue-destination">{destination}</span><p title={item.text}>{item.text}</p></div>
          <button type="button" className="prompt-queue-remove" onClick={() => onRemove(item.id)} aria-label={`Remover pergunta ${index + 1} para ${destination}`} title="Remover da fila"><X size={14}/></button>
        </li>;
      })}
    </ol>
    {items.length > 3 && <button type="button" className="prompt-queue-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Mostrar menos' : `Ver mais ${items.length - 3} perguntas`}</button>}
  </section>;
}
