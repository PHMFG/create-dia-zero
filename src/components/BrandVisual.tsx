import type { CSSProperties } from 'react';
import './BrandVisual.css';

type VisualStyle = CSSProperties & { '--visual-size': string; '--visual-scale': number };

/** The original Figma SVG keeps its intrinsic dimensions; the slot scales the whole mark. */
export function BrandSpark({ tone = 'brand', size = 48, className = '' }: { tone?: 'brand' | 'light'; size?: number; className?: string }) {
  const style: VisualStyle = { '--visual-size': `${size}px`, '--visual-scale': size / 48 };
  return <span className={`brand-spark brand-spark--${tone} ${className}`} style={style} aria-hidden="true"><img src={`/design/spark-${tone}.svg`} width={48} height={48} alt="" draggable={false}/></span>;
}

export function BrandArrow({ size = 16, tone = 'muted', className = '' }: { size?: number; tone?: 'muted' | 'on-brand'; className?: string }) {
  const intrinsic = tone === 'on-brand' ? 18 : 13;
  const style: VisualStyle = { '--visual-size': `${size}px`, '--visual-scale': size / intrinsic };
  return <span className={`brand-arrow ${className}`} style={style} aria-hidden="true"><img src={tone === 'on-brand' ? '/design/arrow-right-on-brand.svg' : '/design/arrow-right.svg'} width={intrinsic} height={intrinsic} alt="" draggable={false}/></span>;
}
