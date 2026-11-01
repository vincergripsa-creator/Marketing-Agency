// Galerie: every deliverable the agency produced, page by page from /api/deliverables. A guide opens in the flip book, an ad in the player.
import { useMemo, useRef, useState } from 'react';
import { filmOf } from '../../../../shared/channels';
import type { CompanySnapshot, Deliverable } from '../../../../shared/types';
import { brainNotePath, fileUrl } from '../../api';
import { cx, Empty, NEW_TAB, Overlay, Segmented } from '../common';
import { useApp } from '../context';
import { fmtInt } from '../format';
import { Icon } from '../icons';
import { agentColor, agentName, DELIVERABLE_ICON, DELIVERABLE_LABEL } from '../labels';
import { useDetail } from '../useDetail';
import { PdfLightbox } from '../viewers/Lightbox';
import { VideoLightbox } from '../viewers/VideoPlayer';

/** `ad_video` is no `Deliverable.kind` (D27): the server merges those tiles from the video manifest. */
export type TileKind = Deliverable['kind'] | 'ad_video';
export interface GalleryItem extends Omit<Deliverable, 'kind'> { kind: TileKind; poster?: string | null }
export interface GalleryPage { items: GalleryItem[]; total: number | null }

type Filter = 'all' | TileKind;
type Viewer = { kind: 'pdf'; url: string; title: string } | { kind: 'video'; creativeId: string; title: string };

const IMAGE_KINDS: ReadonlySet<TileKind> = new Set(['cover', 'ad_storyboard']);
const PAGE = 60;
/** What « Tout » asks of the server: no notes, they would fill the pages (ui §3). */
const GALLERY_KINDS: readonly TileKind[] = ['pdf', 'cover', 'ad_video', 'ad_preview', 'sales_page'];
const VIDEO_LABEL = 'Vidéo pub';

const labelOf = (k: TileKind) => (k === 'ad_video' ? VIDEO_LABEL : DELIVERABLE_LABEL[k] ?? k);
const iconOf = (k: TileKind) => (k === 'ad_video' ? 'film' : DELIVERABLE_ICON[k] ?? 'file');
const pathOf = (kinds: readonly TileKind[], page: number) => `/api/deliverables?page=${page}&kinds=${kinds.join(',')}`;

/** One answer of /api/deliverables. Null: not a page, and the tab stays on what the snapshot holds. */
export function pageOf(data: unknown): GalleryPage | null {
  if (Array.isArray(data)) return { items: data as GalleryItem[], total: null };
  const o = data as { items?: unknown; total?: unknown } | null;
  if (!o || !Array.isArray(o.items)) return null;
  return { items: o.items as GalleryItem[], total: typeof o.total === 'number' ? o.total : null };
}

/** Tiles of the videos the snapshot knows: the same rows the server merges, for a server that cannot page yet. */
export function videoTiles(s: CompanySnapshot | null): GalleryItem[] {
  const films = new Set<string>();
  return Object.entries(s?.videos ?? {}).filter(([, v]) => v.videos.length > 0 || v.poster).filter(([, v]) => {
    const film = filmOf(v.videos[0]?.path ?? v.poster ?? '');
    return !films.has(film) && films.add(film);
  }).map(([creativeId, v]) => {
    const c = s?.company?.creatives?.find((x) => x.id === creativeId);
    return {
      id: `vid_${creativeId}`, kind: 'ad_video', title: c?.hook ?? VIDEO_LABEL, productId: c?.productId ?? null, creativeId,
      path: v.videos[0]?.path ?? v.poster ?? '', poster: v.poster, createdBy: c?.createdBy ?? 'system', day: c?.createdDay ?? 0, quality: c?.quality?.overall ?? null,
    } satisfies GalleryItem;
  });
}

export function GalleryTab({ onClose }: { onClose(): void }) {
  const { snapshot, demo } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [older, setOlder] = useState<GalleryItem[][]>([]); // pages 2 and up, the first one follows the day
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const asked = useRef(0);
  const askedKinds = filter === 'all' ? GALLERY_KINDS : [filter];
  const { data } = useDetail<unknown>(demo ? null : pathOf(askedKinds, 1), snapshot?.day ?? 1);
  const served = pageOf(data);

  const local = useMemo(() => [...(snapshot?.company?.deliverables ?? []), ...videoTiles(snapshot)] as GalleryItem[], [snapshot]);
  // the snapshot keeps the latest ad frames only: the counts are the run's, the subtitle says what the page holds
  const counts = snapshot?.deliverableCounts as Partial<Record<TileKind, number>> | undefined;
  const kinds = useMemo(() => [...new Set([...local.map((d) => d.kind), ...Object.keys(counts ?? {}) as TileKind[]])], [local, counts]);
  const localVideos = local.filter((d) => d.kind === 'ad_video').length;
  const countOf = (k: TileKind) => {
    if (k !== 'ad_video') return counts?.[k] ?? local.filter((d) => d.kind === k).length;
    return (filter === 'ad_video' ? served?.total : null) ?? localVideos; // the stream holds the latest videos only
  };
  const runTotal = Math.max(kinds.reduce((n, k) => n + countOf(k), 0), snapshot?.counts?.deliverables ?? 0);

  const list = useMemo(() => {
    const wanted = (d: GalleryItem) => filter === 'all' || d.kind === filter;
    if (!served) return [...local].filter(wanted).sort((a, b) => b.day - a.day || b.id.localeCompare(a.id));
    const seen = new Set<string>(); // a new deliverable pushes rows onto the next page: the same row can come twice
    return [...served.items, ...older.flat()].filter((d) => wanted(d) && !seen.has(d.id) && seen.add(d.id));
  }, [served, older, local, filter]);

  const shown = served ? list : list.slice(0, limit);
  const whole = served ? served.total ?? list.length : filter === 'all' ? runTotal : countOf(filter);
  const more = !served ? list.length > limit : served.total !== null ? list.length < served.total : (older.at(-1) ?? served.items).length >= PAGE;

  const pick = (f: Filter) => {
    asked.current += 1;
    setFilter(f);
    setLimit(PAGE);
    setOlder([]);
    setBusy(false);
  };
  const loadMore = async () => {
    if (!served) { setLimit((l) => l + PAGE); return; }
    const ticket = ++asked.current;
    setBusy(true);
    let page: GalleryPage | null = null;
    try {
      const res = await fetch(pathOf(askedKinds, older.length + 2));
      page = res.ok ? pageOf(await res.json()) : null;
    } catch { /* the button stays: he can ask again */ }
    if (ticket !== asked.current) return;
    setBusy(false);
    if (page) setOlder((pages) => [...pages, page.items]);
  };

  // on the server, « Tout » is the gallery's kinds: the notes stay out of it
  const allCount = !served ? runTotal : filter === 'all' && served.total !== null ? served.total : GALLERY_KINDS.reduce((n, k) => n + countOf(k), 0);
  const tail = served ? 'les plus récents d’abord' : 'tous les guides, les pubs les plus récentes';
  const subtitle = list.length < whole ? `${fmtInt(list.length)} sur ${fmtInt(whole)} livrables réels produits par l’équipe · ${tail}` : `${fmtInt(whole)} livrables réels produits par l’équipe`;

  return (
    <Overlay title="Galerie" subtitle={subtitle} icon="image" onClose={onClose}>
      <div className="filters-row">
        <Segmented<Filter> size="sm" value={filter} onChange={pick} options={[
          { id: 'all', label: 'Tout', count: allCount },
          ...kinds.map((k) => ({ id: k, label: labelOf(k), count: countOf(k) })),
        ]} />
      </div>
      {shown.length === 0 ? <Empty icon="image">Aucun livrable pour l’instant : les premiers guides, couvertures et pubs apparaîtront ici.</Empty> : (
        <div className="gallery">
          {shown.map((d) => <Tile key={d.id} d={d} onView={setViewer} />)}
        </div>
      )}
      {more ? <button type="button" className="btn btn-sm more-btn" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Chargement…' : 'Charger la suite'}</button> : null}
      {viewer?.kind === 'pdf' ? <PdfLightbox url={viewer.url} title={viewer.title} onClose={() => setViewer(null)} /> : null}
      {viewer?.kind === 'video' ? <VideoLightbox creativeId={viewer.creativeId} title={viewer.title} onClose={() => setViewer(null)} /> : null}
    </Overlay>
  );
}

function Tile({ d, onView }: { d: GalleryItem; onView(v: Viewer): void }) {
  const { runId, demo, lookups, snapshot, openBrainNote } = useApp();
  const [broken, setBroken] = useState(false);
  const url = fileUrl(runId, d.path);
  const product = d.productId ? lookups.products.get(d.productId) : undefined;
  const isVideo = d.kind === 'ad_video' && !!d.creativeId;
  const poster = d.poster ?? (d.creativeId ? snapshot?.videos?.[d.creativeId]?.poster : null);
  // cover for a PDF, poster for a video, else the file itself when it is a picture
  const media = d.kind === 'pdf' ? d.poster ?? product?.files?.cover : d.kind === 'ad_video' ? poster : IMAGE_KINDS.has(d.kind) || /\.(svg|png|jpe?g|webp)$/i.test(d.path) ? d.path : null;
  const body = (
    <>
      <div className={cx('tile-media', `tile-${d.kind}`)}>
        {media && !broken && !demo ? <img src={fileUrl(runId, media)} alt={d.title} loading="lazy" onError={() => setBroken(true)} /> : (
          <span className="tile-icon"><Icon name={iconOf(d.kind)} size={30} strokeWidth={1.5} /></span>
        )}
        {isVideo && !demo ? <span className="phone-play"><Icon name="play" size={18} /></span> : null}
        <span className="tile-kind">{labelOf(d.kind)}</span>
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
  if (d.kind === 'pdf') return <button type="button" className="tile" data-viewer="pdf" onClick={() => onView({ kind: 'pdf', url, title: product?.title ?? d.title })} title="Feuilleter le guide">{body}</button>;
  if (isVideo) return <button type="button" className="tile" data-viewer="video" onClick={() => onView({ kind: 'video', creativeId: d.creativeId!, title: d.title })} title="Lire la vidéo">{body}</button>;
  const note = brainNotePath(runId, d.path);
  if (note) return <button type="button" className="tile" onClick={() => openBrainNote(note)} title="Ouvrir dans le cerveau">{body}</button>;
  return <a className="tile" href={url} {...NEW_TAB} title={`Ouvrir ${d.path}`}>{body}</a>;
}
