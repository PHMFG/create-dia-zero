import { useState } from 'react';
import { ExternalLink, Image as ImageIcon, Link2, MapPin } from 'lucide-react';
import type { Block, Source } from '../../shared/types';
import { isSafeExternalUrl, locationMapUrl } from '../../shared/media';
import './MediaBlock.css';

export function ReferenceImage({url,alt='',compact=false}:{url:string;alt?:string;compact?:boolean}) {
  const [failedUrl,setFailedUrl] = useState<string>();
  if (!isSafeExternalUrl(url)) return <span className="media-unavailable">Endereço de imagem indisponível</span>;
  return failedUrl===url ? <a className="media-image-fallback nodrag nopan" href={url} target="_blank" rel="noopener noreferrer"><ImageIcon size={18}/><span>A prévia não carregou. Abrir imagem</span><ExternalLink size={13}/></a> :
    <img className={`media-image ${compact?'compact':''}`} src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailedUrl(url)} draggable={false}/>;
}

export function MediaBlock({block,sources=[],compact=false}:{block:Block;sources?:Source[];compact?:boolean}) {
  const references = sources.filter(source=>block.sourceIds?.includes(source.id)&&isSafeExternalUrl(source.url));
  const reference = references[0];
  const url = block.url && isSafeExternalUrl(block.url) ? block.url : undefined;
  const className = `media-block media-${block.type} ${compact?'compact':''} nodrag nopan`;
  if (block.type==='link') return <div className={className}>{url?<a className="media-link" href={url} target="_blank" rel="noopener noreferrer"><Link2 size={compact?14:18}/><span><strong>{block.text||reference?.title||new URL(url).hostname}</strong><small>{new URL(url).hostname}</small></span><ExternalLink size={13}/></a>:<span className="media-unavailable">Adicione um link público para esta referência.</span>}{block.caption&&!compact&&<p className="media-caption">{block.caption}</p>}<MediaProvenance reference={reference} humanEdited={block.humanEdited}/></div>;
  if (block.type==='image') return <figure className={className}>{url?<ReferenceImage url={url} alt={block.alt||block.caption||block.text||'Referência visual do projeto'} compact={compact}/>:<span className="media-unavailable"><ImageIcon size={17}/>Adicione o endereço público de uma imagem.</span>}{(block.caption||block.text)&&<figcaption className="media-caption">{block.caption||block.text}</figcaption>}<MediaProvenance reference={reference} humanEdited={block.humanEdited} image/></figure>;
  if (block.type==='location') {
    const mapUrl=locationMapUrl(block);
    const coordinates=Number.isFinite(block.latitude)&&Number.isFinite(block.longitude)?`${block.latitude}, ${block.longitude}`:undefined;
    return <div className={className}><div className="media-location-heading"><MapPin size={compact?16:21}/><span><strong>{block.text||'Localização do projeto'}</strong><small>{block.address||coordinates||'Adicione um endereço para abrir no mapa.'}</small></span></div>{mapUrl&&<a className="media-map-link" href={mapUrl} target="_blank" rel="noopener noreferrer">Abrir no mapa<ExternalLink size={12}/></a>}{block.caption&&!compact&&<p className="media-caption">{block.caption}</p>}<MediaProvenance reference={reference} humanEdited={block.humanEdited}/></div>;
  }
  return null;
}

function MediaProvenance({reference,humanEdited,image=false}:{reference?:Source;humanEdited?:boolean;image?:boolean}) {
  if (!reference) return <span className="media-provenance">{humanEdited?'Adicionado por você':'Sem fonte vinculada'}</span>;
  return <div className="media-provenance"><a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.verified?'Fonte consultada':'Referência registrada'}<ExternalLink size={10}/></a>{image&&<span>{reference.verified?'Referência visual da pesquisa':'Referência visual registrada'}</span>}</div>;
}
