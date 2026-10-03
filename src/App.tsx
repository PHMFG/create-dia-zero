import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowUpRight, X } from 'lucide-react';
import type { Health, Project } from '../shared/types';
import { api } from './lib/api';
import Landing from './components/Landing';
const Workspace = lazy(() => import('./components/Workspace'));

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [initialLoading,setInitialLoading]=useState(()=>!!new URLSearchParams(window.location.search).get('projeto'));
  const [error, setError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const helpRef=useRef<HTMLElement>(null);

  const refresh = () => api.list().then(setProjects).catch(() => {});
  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    refresh();
    const id = new URLSearchParams(window.location.search).get('projeto');
    if (id) { setBusy(true); api.get(id).then(setProject).catch((e) => setError(e.message)).finally(() => {setBusy(false);setInitialLoading(false);}); }
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (project) url.searchParams.set('projeto', project.id); else url.searchParams.delete('projeto');
    window.history.replaceState({}, '', url);
  }, [project?.id]);
  useEffect(()=>{
    if(!helpOpen)return;
    const previous=document.activeElement as HTMLElement|null;helpRef.current?.focus();
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setHelpOpen(false);if(event.key==='Tab'&&helpRef.current){const controls=[...helpRef.current.querySelectorAll<HTMLElement>('button,a[href]')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===helpRef.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);previous?.focus();};
  },[helpOpen]);

  async function start(idea: string, demo = false) {
    setBusy(true); setError('');
    try { setAutoStart(!demo); setProject(demo ? await api.demo() : await api.create(idea)); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível abrir seu projeto. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError('');
    try { setAutoStart(false); setProject(await api.get(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível abrir o projeto.'); }
    finally { setBusy(false); }
  }
  async function importFile(file: File) {
    setBusy(true); setError('');
    try { if(file.size>3000000)throw new Error('O arquivo é muito grande. Escolha uma cópia JSON de até 3 MB.');setAutoStart(false); setProject(await api.import(JSON.parse(await file.text()))); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Este arquivo não é um projeto create válido.'); }
    finally { setBusy(false); }
  }
  return <MotionConfig reducedMotion="user"><div className="app-root">
    <AnimatePresence mode="wait">
      {project ? <motion.div key={project.id} initial={{opacity: 0, y: 14}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} transition={{duration: .32}}>
        <Suspense fallback={<div className="workspace-loading"><span className="wordmark">create<span className="logo-dot"/></span><p>Preparando o espaço da sua ideia…</p></div>}><Workspace key={project.id} initial={project} autoStart={autoStart} projects={projects} health={health} onOpen={open} onHome={() => {setProject(null); refresh();}} onHelp={() => setHelpOpen(true)} onImport={importFile} /></Suspense>
      </motion.div> : initialLoading ? <motion.div key="loading" className="workspace-loading" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><span className="wordmark">create<span className="logo-dot"/></span><p>Retomando a sua ideia…</p></motion.div> : <motion.div key="home" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, y: -14}} transition={{duration: .3}}>
        <Landing projects={projects} busy={busy} onStart={start} onOpen={open} onImport={importFile} onHelp={() => setHelpOpen(true)} />
      </motion.div>}
    </AnimatePresence>
    {error && <div className="global-toast" role="alert"><span>{error}</span><button aria-label="Fechar mensagem" onClick={() => setError('')}><X size={16}/></button></div>}
    <AnimatePresence>{helpOpen && <motion.div className="modal-backdrop" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} onClick={() => setHelpOpen(false)}>
      <motion.section ref={helpRef} tabIndex={-1} className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" initial={{opacity: 0, y: 18}} animate={{opacity: 1, y: 0}} onClick={(e) => e.stopPropagation()}>
        <button className="icon-button modal-close" aria-label="Fechar" onClick={() => setHelpOpen(false)}><X size={20}/></button>
        <span className="eyebrow">COMEÇAR É UM PROCESSO</span><h2 id="about-title">Toda grande ideia tem um dia 0.</h2>
        <p>A create transforma o que você imagina em algo que você pode testar. Converse, organize seu plano e traga o que aconteceu para decidir o próximo passo.</p>
        <div className="about-steps"><span>01 · Conte sua ideia</span><span>02 · Faça um teste pequeno</span><span>03 · Aprenda e ajuste</span></div>
        <p className="subtle">Seu projeto pertence à sua sessão neste navegador. Exporte uma cópia para continuar em outro dispositivo. Evidências de demonstração são sempre identificadas.</p>
        <button className="primary-button" onClick={() => setHelpOpen(false)}>Vamos criar <ArrowUpRight size={18}/></button>
      </motion.section>
    </motion.div>}</AnimatePresence>
  </div></MotionConfig>;
}
