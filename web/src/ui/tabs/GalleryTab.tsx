// Galerie: every deliverable the agency produced (covers as images, files as cards).
import { useMemo, useState } from 'react';
import type { Deliverable } from '../../../../shared/types';
import { fileUrl } from '../../api';
import { cx, Empty, Overlay, Segmented } from '../common';
import { useApp } from '../context';
import { fmtInt } from '../format';
import { Icon } from '../icons';
import { agentColor, agentName, DELIVERABLE_ICON, DELIVERABLE_LABEL } from '../labels';

type Filter = 'all' | Deliverable['kind'];

const IMAGE_KINDS: ReadonlySet<Deliverable['kind']> = new Set(['cover', 'ad_storyboard']);

export function GalleryTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const all = snapshot?.company?.deliverables ?? [];
  const kinds = useMemo(() => [...new Set(all.map((d) => d.kind))], [all]);
  const list = useMemo(() => [...all].filter((d) => filter === 'all' || d.kind === filter).sort((a, b) => b.day - a.day || b.id.localeCompare(a.id)), [all, filter]);

  return (
    <Overlay title="Galerie" subtitle={`${fmtInt(all.length)} livrables réels produits par l’équipe`} icon="image" onClose={onClose}>
      <div className="filters-row">
        <Segmented<Filter> size="sm" value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'Tout', count: all.length },
          ...kinds.map((k) => ({ id: k, label: DELIVERABLE_LABEL[k] ?? k, count: all.filter((d) => d.kind === k).length })),
        ]} />
      </div>
      {list.length === 0 ? <Empty icon="image">Aucun livrable pour l’instant : les premiers guides, couvertures et pubs apparaîtront ici.</Empty> : (
        <div className="gallery">
          {list.slice(0, 240).map((d) => <Tile key={d.id} d={d} />)}
        </div>
      )}
    </Overlay>
  );
}

function Tile({ d }: { d: Deliverable }) {
  const { runId, demo, lookups } = useApp();
  const [broken, setBroken] = useState(false);
  const url = fileUrl(runId, d.path);
  const isImage = IMAGE_KINDS.has(d.kind) || /\.(svg|png|jpe?g|webp)$/i.test(d.path);
  const product = d.productId ? lookups.products.get(d.productId) : undefined;
  const body = (
    <>
      <div className={cx('tile-media', `tile-${d.kind}`)}>
        {isImage && !broken && !demo ? <img src={url} alt={d.title} loading="lazy" onError={() => setBroken(true)} /> : (
          <span className="tile-icon"><Icon name={DELIVERABLE_ICON[d.kind] ?? 'file'} size={30} strokeWidth={1.5} /></span>
        )}
        <span className="tile-kind">{DELIVERABLE_LABEL[d.kind] ?? d.kind}</span>
      </div>
      <div className="tile-body">
        <div className="tile-title">{d.title}</div>
        <div className="tile-meta small">
          <span className="eyebrow-dot" style={{ background: agentColor(lookups, d.createdBy) }} />
          {agentName(lookups, d.createdBy)} · J{d.day}
          {d.quality !== null && d.quality !== undefined ? <span className="tile-q">{Math.round(d.quality)}/100</span> : null}
        </div>
        {product ? <div className="tile-product small muted">{product.title}</div> : null}
      </div>
    </>
  );
  if (demo) return <div className="tile is-disabled" title="Fichier indisponible en mode démo">{body}</div>;
  return <a className="tile" href={url} target="_blank" rel="noreferrer" title={`Ouvrir ${d.path}`}>{body}</a>;
}
