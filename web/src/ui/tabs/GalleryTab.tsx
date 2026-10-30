// Galerie: every deliverable the agency produced (covers as images, files as cards).
import { useMemo, useState } from 'react';
import type { Deliverable } from '../../../../shared/types';
import { brainNotePath, fileUrl } from '../../api';
import { cx, Empty, NEW_TAB, Overlay, Segmented } from '../common';
import { useApp } from '../context';
import { fmtInt } from '../format';
import { Icon } from '../icons';
import { agentColor, agentName, DELIVERABLE_ICON, DELIVERABLE_LABEL } from '../labels';

type Filter = 'all' | Deliverable['kind'];

const IMAGE_KINDS: ReadonlySet<Deliverable['kind']> = new Set(['cover', 'ad_storyboard']);
const PAGE = 240;

export function GalleryTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const all = snapshot?.company?.deliverables ?? [];
  // the snapshot keeps the latest ad frames only: the counts are the run's, the subtitle says what the page holds
  const counts = snapshot?.deliverableCounts;
  const kinds = useMemo(() => [...new Set([...all.map((d) => d.kind), ...Object.keys(counts ?? {}) as Deliverable['kind'][]])], [all, counts]);
  const countOf = (k: Deliverable['kind']) => counts?.[k] ?? all.filter((d) => d.kind === k).length;
  const total = kinds.reduce((n, k) => n + countOf(k), 0);
  const list = useMemo(() => [...all].filter((d) => filter === 'all' || d.kind === filter).sort((a, b) => b.day - a.day || b.id.localeCompare(a.id)), [all, filter]);

  return (
    <Overlay title="Galerie" subtitle={all.length < total ? `${fmtInt(all.length)} sur ${fmtInt(total)} livrables réels produits par l’équipe · tous les guides, les pubs les plus récentes` : `${fmtInt(total)} livrables réels produits par l’équipe`} icon="image" onClose={onClose}>
      <div className="filters-row">
        <Segmented<Filter> size="sm" value={filter} onChange={(f) => { setFilter(f); setLimit(PAGE); }} options={[
          { id: 'all', label: 'Tout', count: total },
          ...kinds.map((k) => ({ id: k, label: DELIVERABLE_LABEL[k] ?? k, count: countOf(k) })),
        ]} />
      </div>
      {list.length === 0 ? <Empty icon="image">Aucun livrable pour l’instant : les premiers guides, couvertures et pubs apparaîtront ici.</Empty> : (
        <div className="gallery">
          {list.slice(0, limit).map((d) => <Tile key={d.id} d={d} />)}
        </div>
      )}
      {list.length > limit ? (
        <button type="button" className="btn btn-sm more-btn" onClick={() => setLimit((l) => l + PAGE)}>Afficher {fmtInt(Math.min(PAGE, list.length - limit))} livrables de plus</button>
      ) : null}
    </Overlay>
  );
}

function Tile({ d }: { d: Deliverable }) {
  const { runId, demo, lookups, openBrainNote } = useApp();
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
  const note = brainNotePath(runId, d.path);
  if (note) return <button type="button" className="tile" onClick={() => openBrainNote(note)} title="Ouvrir dans le cerveau">{body}</button>;
  return <a className="tile" href={url} {...NEW_TAB} title={`Ouvrir ${d.path}`}>{body}</a>;
}
