import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Flag, Lightbulb, Sparkles, Upload, Plus, Clock3, LoaderCircle } from 'lucide-react';
import type { Project } from '../../shared/types';
import { BrandArrow, BrandSpark } from './BrandVisual';
import './LandingDesign.css';

interface Props { projects: Project[]; busy: boolean; onStart: (idea: string, demo?: boolean) => void; onOpen: (id: string) => void; onImport: (file: File) => void; onHelp: () => void }
const ideas = ['Uma cafeteria diferente', 'Um serviço que faz falta', 'Meu primeiro negócio'];
export default function Landing({projects, busy, onStart, onOpen, onImport, onHelp}: Props) {
  const [idea, setIdea] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const importer = useRef<HTMLInputElement>(null);
  const ready = idea.trim().length >= 5;
  return <main className="landing landing-design">
    <section className="hero">
      <div className="hero-orbit orbit-one" aria-hidden="true"/><div className="hero-orbit orbit-two" aria-hidden="true"/>
      <header className="landing-header"><a className="wordmark light" href="/" aria-label="create, início">create<span className="logo-dot"/></a><nav><button onClick={onHelp}>Como funciona <ArrowUpRight size={15}/></button><button onClick={() => document.getElementById('meus-projetos')?.scrollIntoView({behavior: 'smooth'})}>Meus projetos <span className="nav-count">{projects.length}</span></button></nav></header>
      <motion.div className="hero-main" initial={{opacity: 0, y: 22}} animate={{opacity: 1, y: 0}} transition={{duration: .65}}>
        <div className="hero-kicker"><BrandSpark tone="light" size={40} className="hero-brand-spark"/> SUA IDEIA MERECE UM COMEÇO</div>
        <h1>O que vamos criar hoje?</h1>
        <p className="hero-copy">Da primeira ideia ao primeiro passo de verdade.<br/>Vamos descobrir o caminho juntos.</p>
        <form className="idea-form" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onStart(idea.trim()); }}>
          <div className="idea-input-top"><Lightbulb size={22}/><span>Tenho uma ideia…</span></div>
          <textarea ref={field} value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={4000} aria-label="Conte sua ideia de negócio" placeholder="Quero abrir uma loja cozy de matcha na minha cidade…" onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey && ready) {e.preventDefault(); if (!busy) onStart(idea.trim());}}}/>
          <div className="idea-input-bottom"><span>Não precisa estar pronta. Comece com o que tem.</span><button type="submit" disabled={!ready || busy} aria-label="Começar meu projeto">{busy ? <LoaderCircle className="spin" size={22}/> : <BrandArrow size={25} tone={ready ? 'on-brand' : 'muted'}/>}</button></div>
        </form>
        <div className="idea-chips"><span>Uma inspiração?</span>{ideas.map((text) => <button key={text} onClick={() => {setIdea(text === 'Uma cafeteria diferente' ? 'Quero abrir uma cafeteria diferente na minha cidade.' : text === 'Um serviço que faz falta' ? 'Quero criar um serviço para resolver uma necessidade no meu bairro.' : 'Quero começar meu primeiro negócio, mas ainda estou explorando ideias.'); field.current?.focus();}}>{text} <Plus size={12}/></button>)}</div>
      </motion.div>
      <div className="hero-bottom"><span><span className="live-dot"/> Um espaço para tirar ideias do papel</span><button onClick={() => onStart('', true)} disabled={busy}>Explore um projeto de exemplo <ArrowRight size={16}/></button></div>
    </section>
    <section className="landing-bottom" id="meus-projetos">
      <div className="section-heading"><div><span className="eyebrow">{projects.length ? 'SEUS PROJETOS' : 'UM PASSO DE CADA VEZ'}</span><h2>{projects.length ? 'Continue de onde parou.' : 'Começar pequeno. Aprender de verdade.'}</h2></div><button className="text-button" onClick={() => importer.current?.click()}><Upload size={16}/> Importar projeto</button><input ref={importer} type="file" accept="application/json,.json" hidden onChange={(e) => {const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '';}}/></div>
      {projects.length ? <div className="project-grid">{projects.slice(0, 6).map((project, index) => <motion.button className="project-tile" key={project.id} onClick={() => onOpen(project.id)} initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} transition={{delay: index * .06}}><div className="project-tile-top"><span className="project-monogram">{project.title.slice(0, 1).toUpperCase()}</span><BrandArrow size={20}/></div><h3>{project.title}</h3><p>{project.context.idea}</p><div className="project-tile-bottom"><span>{project.demo ? 'DEMONSTRAÇÃO' : 'DIA 0'}</span><span><Clock3 size={12}/>{new Date(project.updatedAt).toLocaleDateString('pt-BR', {day:'2-digit',month:'short'})}</span></div></motion.button>)}</div> : <div className="journey-grid">{[{n:'01',label:'Dê forma à sua ideia',text:'Uma conversa que entende seu contexto e encontra as perguntas certas.',icon:<Lightbulb size={22}/>},{n:'02',label:'Encontre seu próximo passo',text:'Um plano vivo, visual e feito para o que você consegue fazer agora.',icon:<Flag size={22}/>},{n:'03',label:'Transforme ação em aprendizado',text:'Traga o que aconteceu. Seu plano evolui com as evidências.',icon:<Sparkles size={22}/>}].map((step) => <article key={step.n}><div className="journey-step-top"><span>{step.n}</span>{step.icon}</div><h3>{step.label}</h3><p>{step.text}</p></article>)}</div>}
      <footer className="landing-footer"><span className="wordmark small">create<span className="logo-dot"/></span><span>O primeiro dia de algo seu.</span><span>Feito para quem está começando.</span></footer>
    </section>
  </main>;
}
