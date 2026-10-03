import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Eye, ExternalLink, FileText, Link2, LoaderCircle, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Block, CanvasCard, Context, Evidence, Project, Proposal, Source } from '../../shared/types';
import { kindIcons, kindLabels, laneLabels } from './Canvas';
import { isSafeExternalUrl } from '../../shared/media';
import { MediaBlock, ReferenceImage } from './MediaBlock';
import Markdown from 'react-markdown';
import './DrawerViews.css';

const blockLabels:Record<Block['type'],string> = { heading:'Título',paragraph:'Texto',list:'Lista',checklist:'Checklist',callout:'Destaque',sources:'Fontes',link:'Link',image:'Imagem',location:'Localização' };

const makeId = () => crypto.randomUUID();

function SourceReference({source}:{source:Source}) {
  const safe=isSafeExternalUrl(source.url);
  const date=new Date(source.consultedAt);
  return <article className="source-reference"><span className="source-reference-title">{safe?<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={13}/></a>:source.title}</span>{source.imageUrl&&<ReferenceImage url={source.imageUrl} alt={source.title}/>}<p>{source.excerpt}</p><small>{source.verified?'Consultado em':'Data registrada no arquivo:'} {Number.isNaN(date.getTime())?'Não informada':date.toLocaleDateString('pt-BR')}</small></article>;
}

function SourcePicker({block,sources,onChange}:{block:Block;sources:Source[];onChange:(patch:Partial<Block>)=>void}) {
  const available=sources.filter(source=>isSafeExternalUrl(source.url));
  return <details className="media-source-picker" open={block.type==='sources'}><summary>{block.type==='sources'?'Escolher referências':'Vincular uma fonte'} · {block.sourceIds?.length||0}</summary>{available.length?available.map(source=><label key={source.id}><input type="checkbox" checked={block.sourceIds?.includes(source.id)||false} onChange={event=>onChange({sourceIds:event.target.checked?[...(block.sourceIds||[]),source.id]:(block.sourceIds||[]).filter(id=>id!==source.id)})}/><span>{source.title}</span></label>):<p className="media-source-empty">As fontes de pesquisas concluídas aparecerão aqui. Você também pode adicionar um bloco de link com uma referência própria.</p>}</details>;
}

function BlockContentEditor({block,sources,onChange,index}:{block:Block;sources:Source[];onChange:(patch:Partial<Block>)=>void;index:number}) {
  if (block.type==='list'||block.type==='checklist') return <div className="editable-items">{block.items?.map(item=><div key={item.id} className="editable-item">{block.type==='checklist'?<button className={`check-box ${item.checked?'is-checked':''}`} role="checkbox" aria-checked={item.checked} aria-label={`Concluir ${item.text}`} onClick={()=>onChange({items:block.items?.map(existing=>existing.id===item.id?{...existing,checked:!existing.checked,humanEdited:true}:existing)})}>{item.checked&&<Check size={12}/>}</button>:<span className="list-bullet">•</span>}<textarea aria-label="Texto do item" maxLength={2000} value={item.text} rows={2} placeholder="Escreva um item…" onChange={event=>onChange({items:block.items?.map(existing=>existing.id===item.id?{...existing,text:event.target.value,humanEdited:true}:existing)})}/><button className="icon-button tiny" aria-label="Excluir item" onClick={()=>onChange({items:block.items?.filter(existing=>existing.id!==item.id)})}><X size={13}/></button></div>)}<button className="add-item" disabled={(block.items?.length||0)>=80} onClick={()=>{if((block.items?.length||0)<80)onChange({items:[...(block.items||[]),{id:makeId(),text:'',checked:false,humanEdited:true}]});}}><Plus size={13}/>Adicionar item</button>{(block.items?.length||0)>=80&&<p className="subtle">Limite de 80 itens. Remova um item para acrescentar outro.</p>}</div>;
  if (block.type==='sources') return <><div className="source-block">{block.sourceIds?.map(id=>{const source=sources.find(existing=>existing.id===id);return source&&isSafeExternalUrl(source.url)?<a key={id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={13}/></a>:<span key={id}>Fonte indisponível</span>;})}</div><SourcePicker block={block} sources={sources} onChange={onChange}/></>;
  if (block.type==='link'||block.type==='image'||block.type==='location') return <><MediaBlock block={block} sources={sources}/><MediaFields block={block} sources={sources} onChange={onChange}/><SourcePicker block={block} sources={sources} onChange={onChange}/></>;
  return <textarea className="block-textarea" maxLength={16000} aria-label={`Conteúdo do bloco ${index+1}`} value={block.text||''} onChange={event=>onChange({text:event.target.value})} rows={block.type==='heading'?1:Math.min(9,Math.max(3,(block.text?.length||0)/65))} placeholder={block.type==='heading'?'Escreva um título…':'Escreva aqui…'}/>;
}

/** URL drafts stay local until valid, so incomplete typing cannot break autosave. */
function MediaFields({block,sources,onChange}:{block:Block;sources:Source[];onChange:(patch:Partial<Block>)=>void}) {
  const [urlDraft,setUrlDraft]=useState(block.url||'');
  const [urlError,setUrlError]=useState('');
  useEffect(()=>setUrlDraft(block.url||''),[block.url]);
  function saveUrl() {
    const url=urlDraft.trim();
    if(url&&!isSafeExternalUrl(url)){setUrlError('Use um endereço público completo, começando com https:// ou http://.');return;}
    setUrlError('');onChange({url:url||undefined});
  }
  return <div className="media-editor-fields"><label className="field-label">{block.type==='image'?'Título da referência visual':block.type==='location'?'Nome do lugar':'Título do link'}<input value={block.text||''} maxLength={500} onChange={event=>onChange({text:event.target.value})} placeholder={block.type==='location'?'Por exemplo, local do primeiro teste':'Como esta referência ajuda o projeto'}/></label>{block.type!=='location'&&<label className="field-label">{block.type==='image'?'Endereço da imagem':'Endereço do link'}<input type="url" inputMode="url" value={urlDraft} maxLength={2000} onChange={event=>{setUrlDraft(event.target.value);setUrlError('');}} onBlur={saveUrl} aria-invalid={Boolean(urlError)} placeholder="https://…"/></label>}{urlError&&<p className="media-editor-error" role="alert">{urlError}</p>}{block.type==='image'&&<><label className="field-label">Descrição para acessibilidade<input value={block.alt||''} maxLength={1000} onChange={event=>onChange({alt:event.target.value})} placeholder="Descreva o que aparece na imagem"/></label>{sources.some(source=>source.imageUrl&&isSafeExternalUrl(source.imageUrl))&&<label className="field-label">Usar uma imagem das referências<select value="" onChange={event=>{const source=sources.find(candidate=>candidate.id===event.target.value);if(source?.imageUrl){setUrlDraft(source.imageUrl);setUrlError('');onChange({url:source.imageUrl,alt:source.title,sourceIds:[...(block.sourceIds||[]).filter(id=>id!==source.id),source.id]});}}}><option value="">Escolher referência visual…</option>{sources.filter(source=>source.imageUrl&&isSafeExternalUrl(source.imageUrl)).map(source=><option key={source.id} value={source.id}>{source.title}</option>)}</select></label>}</>}{block.type==='location'&&<><label className="field-label">Endereço ou região<input value={block.address||''} maxLength={1000} onChange={event=>onChange({address:event.target.value})} placeholder="Rua, bairro, cidade ou região do projeto"/></label><div className="media-editor-coordinates"><CoordinateField label="Latitude (opcional)" value={block.latitude} limit={90} onChange={latitude=>onChange({latitude})}/><CoordinateField label="Longitude (opcional)" value={block.longitude} limit={180} onChange={longitude=>onChange({longitude})}/></div></>}<label className="field-label">Legenda <span>opcional</span><textarea rows={2} value={block.caption||''} maxLength={2000} onChange={event=>onChange({caption:event.target.value})} placeholder="Por que guardar esta referência?"/></label></div>;
}

function CoordinateField({label,value,limit,onChange}:{label:string;value?:number;limit:number;onChange:(value:number|undefined)=>void}) {
  const [draft,setDraft]=useState(value===undefined?'':String(value));const [error,setError]=useState('');
  useEffect(()=>setDraft(value===undefined?'':String(value)),[value]);
  function save(){const normalized=draft.trim().replace(',','.');const parsed=Number(normalized);if(normalized&&(!Number.isFinite(parsed)||Math.abs(parsed)>limit)){setError(`Use um valor de −${limit} a ${limit}.`);return;}setError('');onChange(normalized?parsed:undefined);}
  return <label className="field-label">{label}<input inputMode="decimal" value={draft} maxLength={20} onChange={event=>{setDraft(event.target.value);setError('');}} onBlur={save} aria-invalid={Boolean(error)} placeholder="Não informada"/>{error&&<span className="media-editor-error" role="alert">{error}</span>}</label>;
}
function useDialogFocus(section:RefObject<HTMLElement|null>,onClose:()=>void) {
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;section.current?.focus();
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();close.current();}
      if(e.key==='Tab'&&section.current){const elements=[...section.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,summary,a[href],[tabindex="0"]')].filter((el)=>el.offsetParent!==null);const first=elements[0],last=elements.at(-1);
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===section.current)){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };window.addEventListener('keydown',onKey);return()=>{window.removeEventListener('keydown',onKey);previous?.focus();};
  },[]);
}
export function Modal({children,onClose,label,className=''}:{children:ReactNode;onClose:()=>void;label:string;className?:string}) {
  const section = useRef<HTMLElement>(null);
  useDialogFocus(section,onClose);
  return <motion.div className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}><motion.section ref={section} tabIndex={-1} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} initial={{opacity:0,y:20,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:12}} transition={{duration:.2}} onClick={(e)=>e.stopPropagation()}><button className="icon-button modal-close" aria-label="Fechar" onClick={onClose}><X size={20}/></button>{children}</motion.section></motion.div>;
}

export function EvidenceDialog({project,cardId,onClose,onSave}:{project:Project;cardId?:string;onClose:()=>void;onSave:(input:{text:string;type:Evidence['type'];cardId?:string;links?:string[]})=>Promise<void>}) {
  const [text,setText]=useState(''); const [type,setType]=useState<Evidence['type']>('observation'); const [links,setLinks]=useState(''); const [action,setAction]=useState(cardId || ''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function save() {setBusy(true);setError('');try {await onSave({text:text.trim(),type,cardId:action||undefined,links:links.split('\n').map((s)=>s.trim()).filter(Boolean)});onClose();}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}}
  return <Modal onClose={onClose} label="Registrar evidência" className="evidence-modal"><span className="eyebrow">DA AÇÃO AO APRENDIZADO</span><h2>O que aconteceu?</h2><p>Conte o que você fez e o que observou. Resultados inesperados também ajudam a encontrar o caminho.</p><label className="field-label">Tipo de experiência<select value={type} onChange={(e)=>setType(e.target.value as Evidence['type'])}><option value="observation">Uma observação</option><option value="interview">Uma conversa ou entrevista</option><option value="offer_test">Um teste de oferta</option><option value="purchase">Uma venda ou compra</option><option value="other">Outra experiência</option></select></label><label className="field-label">Relacionar a uma ação<select value={action} onChange={(e)=>setAction(e.target.value)}><option value="">Uma descoberta sobre o projeto</option>{project.cards.filter((c)=>c.kind==='action').map((c)=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label className="field-label">Seu relato<textarea autoFocus value={text} onChange={(e)=>setText(e.target.value)} rows={5} maxLength={12000} placeholder="Conversei com três pessoas. Duas contaram que…"/></label><label className="field-label">Links de apoio <span>opcional · um por linha</span><textarea value={links} onChange={(e)=>setLinks(e.target.value)} rows={2} placeholder="https://…"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button full" disabled={text.trim().length<10||busy} onClick={save}>{busy?<LoaderCircle size={18} className="spin"/>:<Check size={18}/>}Salvar minha experiência</button><p className="dialog-footnote">O relato será registrado como sua experiência. A create pode sugerir uma revisão a partir dele.</p></Modal>;
}

export function ProposalDialog({project,proposal,onClose,onResolve}:{project:Project;proposal:Proposal;onClose:()=>void;onResolve:(id:string,accept:boolean)=>Promise<void>}) {
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function resolve(accept:boolean){setBusy(true);try{await onResolve(proposal.id,accept);onClose();}catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir a revisão.');setBusy(false);}}
  return <Modal onClose={onClose} label="Revisar proposta" className="proposal-modal"><span className="eyebrow">SEU PLANO ESTÁ EVOLUINDO</span><h2>{proposal.title}</h2><p>{proposal.reason}</p><div className="proposal-changes">{proposal.operations.map((op,index)=>{const before=project.cards.find((c)=>c.id===op.cardId);const after=op.card||{...before,...op.patch};return <div key={index} className="proposal-change"><span className="kind-label">{op.op==='add'?'Adicionar cartão':op.op==='remove'?'Remover cartão':'Atualizar cartão'}</span><div className="before-after"><div><span>ATUAL</span><h4>{before?.title||'Novo conteúdo'}</h4><p>{before?.summary||'Este cartão ainda não existe.'}</p></div><ArrowRightIcon/><div><span>PROPOSTA</span><h4>{op.op==='remove'?'Remover do canvas':after.title}</h4><p>{op.op==='remove'?'O conteúdo anterior continuará no histórico.':after.summary}</p>{op.patch?.blocks&&<p>{op.patch.blocks.map((b)=>b.text||b.items?.map((i)=>i.text).join(', ')).filter(Boolean).join('\n')}</p>}</div></div></div>;})}</div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={()=>resolve(false)}>Manter meu plano</button><button className="primary-button" disabled={busy} onClick={()=>resolve(true)}>{busy?<LoaderCircle size={17} className="spin"/>:<Check size={17}/>}Aplicar revisão</button></div></Modal>;
}
function ArrowRightIcon(){return <ArrowUpRight className="comparison-arrow" size={20}/>;}

const contextFields = [
  {key:'audience',label:'Quem você quer ajudar',placeholder:'Seu público inicial'},
  {key:'city',label:'Onde começar',placeholder:'Cidade, comunidade ou online'},
  {key:'budget',label:'Orçamento para o primeiro teste',placeholder:'Quanto você pode investir'},
  {key:'availability',label:'Tempo disponível',placeholder:'Por exemplo, duas tardes por semana'},
  {key:'constraints',label:'Restrições importantes',placeholder:'O que precisamos levar em conta'},
  {key:'goal',label:'O que você quer descobrir',placeholder:'Seu objetivo neste primeiro passo'},
] as const;

type DrawerTab = 'view'|'edit'|'history';
type EditTarget = {kind:'block'|'context'|'section';id:string};

function ReadingText({text}:{text?:string}) {
  if(!text?.trim())return <p className="drawer-reading-empty">Ainda sem conteúdo. Use o lápis para acrescentar uma informação.</p>;
  return <Markdown skipHtml urlTransform={value=>isSafeExternalUrl(value)?value:''} components={{
    a:({children,href})=>href&&isSafeExternalUrl(href)?<a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13}/></a>:<span>{children}</span>,
    img:({alt})=><span>{alt}</span>,
  }}>{text}</Markdown>;
}

function ReadingBlock({block,sources,onEdit,onChange}:{block:Block;sources:Source[];onEdit:()=>void;onChange:(patch:Partial<Block>)=>void}) {
  return <section className={`drawer-read-block read-${block.type}`} aria-label={blockLabels[block.type]}>
    <button className="drawer-read-pencil" aria-label="Editar este bloco" title={`Editar este bloco: ${blockLabels[block.type]}`} onClick={onEdit}><Pencil size={15}/></button>
    {block.type==='heading'?<h3>{block.text||'Título ainda não preenchido'}</h3>:
      block.type==='list'?<ul className="drawer-read-list">{block.items?.map(item=><li key={item.id}><ReadingText text={item.text}/></li>)}</ul>:
      block.type==='checklist'?<><p className="drawer-checklist-progress">{block.items?.filter(item=>item.checked).length||0} de {block.items?.length||0} concluídos</p><ul className="drawer-read-checklist">{block.items?.map(item=><li key={item.id} className={item.checked?'is-complete':''}><button className={`check-box ${item.checked?'is-checked':''}`} role="checkbox" aria-checked={item.checked} aria-label={`Passo: ${item.text||'Item sem texto'}`} onClick={()=>onChange({items:block.items?.map(existing=>existing.id===item.id?{...existing,checked:!existing.checked,humanEdited:true}:existing)})}>{item.checked&&<Check size={14}/>}</button><div><ReadingText text={item.text}/></div></li>)}</ul></>:
      block.type==='sources'?<div className="drawer-read-sources">{block.sourceIds?.length?block.sourceIds.map(id=>{const source=sources.find(candidate=>candidate.id===id);return source&&isSafeExternalUrl(source.url)?<a className="drawer-read-source" key={id} href={source.url} target="_blank" rel="noopener noreferrer"><Link2 size={15}/><span>{source.title}</span><ExternalLink size={13}/></a>:<p key={id} className="drawer-reading-empty">Fonte indisponível</p>;}):<p className="drawer-reading-empty">Nenhuma fonte vinculada a este bloco.</p>}</div>:
      block.type==='link'||block.type==='image'||block.type==='location'?<MediaBlock block={block} sources={sources}/>:
      <div className={block.type==='callout'?'drawer-read-callout':'drawer-read-prose'}><ReadingText text={block.text}/></div>}
  </section>;
}

export function CardDrawer({project,card,onClose,onChange,onContext,onClarify,onEvidence,onDelete}:{project:Project;card:CanvasCard;onClose:()=>void;onChange:(card:CanvasCard)=>void;onContext:(patch:Partial<Context>)=>void;onClarify:()=>void;onEvidence:()=>void;onDelete:()=>void}) {
  const [tab,setTab]=useState<DrawerTab>('view');
  const [adding,setAdding]=useState(false);
  const Icon=kindIcons[card.kind];
  const drawer=useRef<HTMLElement>(null);
  const focusTarget=useRef<EditTarget|null>(null);
  const viewId=useId();
  const tabs:Array<{id:DrawerTab;label:string}>=[{id:'view',label:'Visualizar'},{id:'edit',label:'Editar'},{id:'history',label:'Histórico'}];
  const revisions=project.revisions.filter(revision=>revision.cards.some(old=>old.id===card.id));
  useDialogFocus(drawer,onClose);
  useEffect(()=>{
    if(tab!=='edit'||!focusTarget.current||!drawer.current)return;
    const target=focusTarget.current;
    const attribute=target.kind==='block'?'data-edit-block':target.kind==='context'?'data-context-field':'data-edit-section';
    const section=[...drawer.current.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(element=>element.getAttribute(attribute)===target.id);
    if(!section)return;
    focusTarget.current=null;
    const field=section.querySelector<HTMLElement>('textarea,input,select')||section.querySelector<HTMLElement>('button:not(:disabled)');
    field?.focus({preventScroll:true});
    section.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  },[tab,card.id,card.blocks.length]);
  const update=(patch:Partial<CanvasCard>)=>onChange({...card,...patch,humanEdited:true,revision:card.revision+1});
  const blockUpdate=(id:string,patch:Partial<Block>)=>update({blocks:card.blocks.map(block=>block.id===id?{...block,...patch,humanEdited:true}:block)});
  const editTarget=(target:EditTarget)=>{focusTarget.current=target;setTab('edit');};
  const move=(id:string,offset:number)=>{const blocks=[...card.blocks],index=blocks.findIndex(block=>block.id===id);if(index+offset<0||index+offset>=blocks.length)return;[blocks[index],blocks[index+offset]]=[blocks[index+offset],blocks[index]];update({blocks});};
  const add=(type:Block['type'])=>{
    if (card.blocks.length >= 60) return;
    const id=makeId();
    focusTarget.current={kind:'block',id};
    update({blocks:[...card.blocks,{id,type,text:type==='list'||type==='checklist'?undefined:'',items:type==='list'||type==='checklist'?[{id:makeId(),text:'',checked:false}]:undefined,humanEdited:true}]});
    setAdding(false);
  };
  const sources=project.sources.filter(source=>card.blocks.some(block=>block.sourceIds?.includes(source.id)));
  const dependencies=project.cards.filter(candidate=>card.dependsOn.includes(candidate.id));
  function tabKey(event:ReactKeyboardEvent<HTMLButtonElement>,index:number){
    let next:number|undefined;
    if(event.key==='ArrowRight')next=(index+1)%tabs.length;
    if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=tabs.length-1;
    if(next===undefined)return;
    event.preventDefault();setTab(tabs[next].id);
    drawer.current?.querySelector<HTMLButtonElement>(`[data-drawer-tab="${tabs[next].id}"]`)?.focus();
  }
  return <>
    <motion.div className="drawer-shade" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose}/>
    <motion.aside ref={drawer} tabIndex={-1} className={`card-drawer drawer-${tab}-mode`} role="dialog" aria-modal="true" aria-label={`Sobre ${card.title}`} initial={{x:'100%'}} animate={{x:0}} exit={{x:'100%'}} transition={{duration:.25,ease:[.2,.8,.2,1]}}>
      <header className="drawer-header"><span className="kind-label"><Icon size={16}/>{kindLabels[card.kind]}</span><button className="icon-button" aria-label="Fechar detalhes" onClick={onClose}><X size={20}/></button></header>
      <div className="drawer-heading"><span className="eyebrow">SOBRE ESTE CARTÃO</span>
        <textarea className="drawer-title" value={card.title} rows={2} maxLength={200} aria-label="Título do cartão" onChange={event=>update({title:event.target.value})}/>
        <textarea className="drawer-summary" aria-label="Resumo do cartão" maxLength={2000} value={card.summary} rows={3} onChange={event=>update({summary:event.target.value})}/>
        <div className="drawer-meta"><select aria-label="Prioridade" value={card.lane} onChange={event=>update({lane:event.target.value as CanvasCard['lane']})}>{Object.entries(laneLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><span>{card.origin==='demo'?'Conteúdo de exemplo':card.humanEdited?'Editado por você':card.origin==='user'?'Criado por você':'Criado com a create'}</span></div>
      </div>
      <div className="drawer-tabs drawer-view-tabs" role="tablist" aria-label="Visualização do cartão">{tabs.map((item,index)=><button key={item.id} id={`${viewId}-${item.id}-tab`} data-drawer-tab={item.id} role="tab" aria-selected={tab===item.id} aria-controls={`${viewId}-panel`} tabIndex={tab===item.id?0:-1} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)} onKeyDown={event=>tabKey(event,index)}>{item.id==='view'?<Eye size={15}/>:item.id==='edit'?<Pencil size={14}/>:<FileText size={14}/>}<span className="drawer-tab-label">{item.label}</span>{item.id==='history'&&<span className="drawer-history-count">{revisions.length}</span>}</button>)}</div>
      <div className="drawer-scroll" id={`${viewId}-panel`} role="tabpanel" aria-labelledby={`${viewId}-${tab}-tab`} tabIndex={0}>
        {tab==='history'?<div className="revision-list">{revisions.slice().reverse().map(revision=>{const old=revision.cards.find(candidate=>candidate.id===card.id)!;return <article key={revision.id}><span className="revision-dot"/><small>{new Date(revision.at).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</small><h4>{revision.label}</h4><p>{old.title}</p><p className="subtle">{old.summary}</p></article>;})}{!revisions.length&&<div className="empty-small"><FileText size={25}/><p>As próximas revisões deste cartão aparecerão aqui.</p></div>}</div>:<>
          {tab==='view'?<div className="drawer-reading">
            {card.kind==='context'&&<section className="drawer-context-reading"><h3>Recursos do projeto</h3><dl className="drawer-context-facts">{contextFields.map(field=><div key={field.key} className={`context-fact-${field.key}`}><dt>{field.label}</dt><dd><button aria-label={`Editar ${field.label.toLowerCase()}`} onClick={()=>editTarget({kind:'context',id:field.key})}><span className={project.context[field.key]?'':'unfilled'}>{project.context[field.key]||'Ainda não informado'}</span><Pencil size={13}/></button></dd></div>)}</dl></section>}
            <div className="drawer-reading-blocks">{card.blocks.map(block=><ReadingBlock key={block.id} block={block} sources={project.sources} onEdit={()=>editTarget({kind:'block',id:block.id})} onChange={patch=>blockUpdate(block.id,patch)}/>)}</div>
            {!card.blocks.length&&<div className="drawer-reading-empty-state"><FileText size={24}/><p>Este cartão ainda não tem conteúdo.</p><button className="secondary-button" onClick={()=>{setTab('edit');setAdding(true);}}><Plus size={15}/>Acrescentar informação</button></div>}
            <section className="drawer-section drawer-read-dependencies"><div className="drawer-reading-section-title"><h3>Conexões do plano</h3><button onClick={()=>editTarget({kind:'section',id:'dependencies'})}><Pencil size={13}/>Editar</button></div>{dependencies.length?<ul>{dependencies.map(dependency=><li key={dependency.id}><Link2 size={14}/><span>{dependency.title}</span></li>)}</ul>:<p className="drawer-reading-empty">Este cartão ainda não depende de outro passo.</p>}</section>
          </div>:<>
            {card.kind==='context'&&<div className="context-fields"><h3>Os recursos para começar</h3>{contextFields.map(field=><label className="field-label" key={field.key} data-context-field={field.key}>{field.label}<input maxLength={field.key==='constraints'?2000:400} value={project.context[field.key]||''} placeholder={field.placeholder} onChange={event=>onContext({[field.key]:event.target.value})}/></label>)}</div>}
            <div className="block-editor">{card.blocks.map((block,index)=><div className={`editable-block block-${block.type}`} data-edit-block={block.id} key={block.id}><div className="block-toolbar"><span>{blockLabels[block.type]}</span><div><button className="icon-button tiny" aria-label="Mover bloco para cima" disabled={index===0} onClick={()=>move(block.id,-1)}><ArrowUp size={13}/></button><button className="icon-button tiny" aria-label="Mover bloco para baixo" disabled={index===card.blocks.length-1} onClick={()=>move(block.id,1)}><ArrowDown size={13}/></button><button className="icon-button tiny" aria-label="Excluir bloco" onClick={()=>update({blocks:card.blocks.filter(candidate=>candidate.id!==block.id)})}><Trash2 size={13}/></button></div></div><BlockContentEditor block={block} sources={project.sources} onChange={patch=>blockUpdate(block.id,patch)} index={index}/></div>)}</div>
            <div className="add-block-wrap"><button className="add-block" disabled={card.blocks.length>=60} onClick={()=>setAdding(!adding)}><Plus size={16}/>Adicionar bloco<ChevronDown size={14}/></button>{card.blocks.length>=60&&<p className="subtle">Limite de 60 blocos. Remova um bloco para acrescentar outro.</p>}{adding&&card.blocks.length<60&&<div className="block-picker">{(['heading','paragraph','list','checklist','callout','link','image','location','sources'] as const).map(type=><button key={type} onClick={()=>add(type)}>{blockLabels[type]}<Plus size={14}/></button>)}</div>}</div>
            <section className="drawer-section" data-edit-section="dependencies"><h3>Conexões do plano</h3><p className="subtle">Este cartão pode depender de outros passos.{card.dependsOn.length>=50&&' Limite de 50 conexões atingido. Remova uma conexão para acrescentar outra.'}</p><div className="dependency-options">{project.cards.filter(candidate=>candidate.id!==card.id).map(candidate=><label key={candidate.id}><input type="checkbox" disabled={card.dependsOn.length>=50&&!card.dependsOn.includes(candidate.id)} checked={card.dependsOn.includes(candidate.id)} onChange={event=>update({dependsOn:event.target.checked?[...card.dependsOn,candidate.id]:card.dependsOn.filter(id=>id!==candidate.id)})}/><span>{candidate.title}</span></label>)}</div></section>
            <section className="drawer-section"><button className="danger-text" onClick={onDelete}><Trash2 size={14}/>Remover cartão</button></section>
          </>}
          {sources.length>0&&<details className="drawer-reference-details"><summary><Link2 size={15}/><span>Fontes de referência</span><small>{sources.length}</small><ChevronDown size={15}/></summary>{sources.map(source=><SourceReference key={source.id} source={source}/>)}</details>}
        </>}
      </div>
      <footer className="drawer-footer"><button className="secondary-button full" onClick={onClarify}><MessageCircle size={16}/>Esclarecer uma dúvida sobre este cartão</button>{card.kind==='action'&&<button className="primary-button full" onClick={onEvidence}>Registrar o que aconteceu<ArrowUpRight size={18}/></button>}</footer>
    </motion.aside>
  </>;
}
