import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, LoaderCircle, MessageCircle, Square, X } from 'lucide-react';
import RichText from './RichText';
import type { CanvasCard, Message } from '../../shared/types';
import { kindLabels } from './Canvas';

interface Props {card:CanvasCard;messages:Message[];generating:boolean;stream:string;activity:string;blocked:boolean;onClose:()=>void;onSend:(text:string)=>void;onCancel:()=>void}
export default function CardChat({card,messages,generating,stream,activity,blocked,onClose,onSend,onCancel}:Props) {
  const [text,setText]=useState('');const history=useRef<HTMLDivElement>(null);const input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{input.current?.focus();},[card.id]);
  useEffect(()=>{history.current?.scrollTo({top:history.current.scrollHeight,behavior:generating?'auto':'smooth'});},[messages,stream,activity]);
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[onClose]);
  const send=()=>{if(!text.trim()||blocked)return;onSend(text.trim());setText('');};
  return <motion.section className="card-mini-chat" role="dialog" aria-modal="false" aria-label={`Esclarecer dúvidas: ${card.title}`} initial={{opacity:0,y:12,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:8}} transition={{duration:.2}}><header><div className="mini-chat-symbol"><MessageCircle size={18}/></div><div><span>{kindLabels[card.kind]}</span><h2>{card.title}</h2></div><button className="icon-button" aria-label="Fechar conversa do cartão" onClick={onClose}><X size={18}/></button></header><div className="mini-chat-history" ref={history}>
    {!messages.length&&!generating&&<div className="mini-chat-welcome"><span>✳</span><h3>Vamos entender este cartão?</h3><p>Faça uma pergunta. A create considera este conteúdo e o contexto do seu projeto.</p><button disabled={blocked} onClick={()=>onSend('Como posso começar este passo de um jeito simples e compatível com os meus recursos?')}>Por onde eu começo?<ArrowUpRight size={14}/></button></div>}
    {messages.map((message)=><div className={`mini-chat-message mini-${message.role}`} key={message.id}><RichText>{message.text}</RichText></div>)}
    {generating&&<div className="mini-chat-message mini-assistant">{stream?<RichText>{stream}</RichText>:<div className="thinking-dots"><span/><span/><span/></div>}<div className="activity-status"><LoaderCircle size={12} className="spin"/>{activity}</div></div>}
  </div><form className="mini-chat-composer" onSubmit={(e)=>{e.preventDefault();send();}}><textarea ref={input} value={text} onChange={(e)=>setText(e.target.value)} aria-label="Pergunta sobre o cartão" placeholder="Uma dúvida sobre este cartão…" rows={2} maxLength={12000} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}/>{generating?<button className="send-button cancel" type="button" onClick={onCancel} aria-label="Interromper resposta do cartão"><Square size={12} fill="currentColor"/></button>:<button className="send-button" type="submit" disabled={!text.trim()||blocked} aria-label="Enviar pergunta sobre o cartão"><ArrowUpRight size={18}/></button>}</form></motion.section>;
}
