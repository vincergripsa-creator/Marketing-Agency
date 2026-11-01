// Guide feuilleté: real pages drawn by pdf.js in the browser, a two-faced leaf between spreads. Loaded by lazy(), pdf.js with it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { cx } from '../common';
import { Icon } from '../icons';
import { useLightboxKey } from './Lightbox';

const FLIP_MS = 420;            // the leaf's turn, same number as `--pf-ms` in viewers.css
const MAX_PAGE_CSS_PX = 520;
const MAX_DPR = 2;
const KEPT_PAGES = 8;
const WIDTH_STEP_PX = 20;       // a resize re-renders pages, not at every pixel

/** The file a download saves: the guide's title, every file ending as guide.pdf says nothing. Windows refuses these characters in a name. */
export function pdfName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  return `${name || 'guide'}.pdf`;
}

/** Cover alone on the right, then facing pages. Pure, unit-tested. */
export function flipSpread(pages: number, spread: number): { left: number | null; right: number | null } {
  if (spread <= 0) return { left: null, right: pages > 0 ? 0 : null };
  const left = spread * 2 - 1;
  return { left: left < pages ? left : null, right: left + 1 < pages ? left + 1 : null };
}

export function spreadCount(pages: number): number {
  return pages <= 0 ? 0 : Math.floor(pages / 2) + 1;
}

/** « Pages 4–5 / 24 », numbered from 1. */
export function spreadLabel(pages: number, spread: number): string {
  const { left, right } = flipSpread(pages, spread);
  const shown = [left, right].filter((p): p is number => p !== null).map((p) => p + 1);
  return shown.length === 2 ? `Pages ${shown[0]}–${shown[1]} / ${pages}` : `Page ${shown[0] ?? 0} / ${pages}`;
}

/** The faces of a turn from one spread to another. Going back, the same leaf runs the other way. */
export function flipFaces(pages: number, from: number, to: number): { under: { left: number | null; right: number | null }; front: number | null; rear: number | null } {
  const a = flipSpread(pages, from);
  const b = flipSpread(pages, to);
  return to > from
    ? { under: { left: a.left, right: b.right }, front: a.right, rear: b.left }
    : { under: { left: b.left, right: a.right }, front: b.right, rear: a.left };
}

/** Least recently used out first. `drop` frees what leaves. */
export class PageCache<T> {
  private readonly rows = new Map<number, T>();
  constructor(private readonly max: number, private readonly drop: (value: T) => void = () => undefined) {}
  has(key: number): boolean { return this.rows.has(key); }
  get(key: number): T | undefined {
    const value = this.rows.get(key);
    if (value !== undefined) { this.rows.delete(key); this.rows.set(key, value); }
    return value;
  }
  set(key: number, value: T): void {
    this.rows.delete(key);
    this.rows.set(key, value);
    for (const [oldest, row] of this.rows) {
      if (this.rows.size <= this.max) break;
      this.rows.delete(oldest);
      this.drop(row);
    }
  }
  clear(): void {
    for (const row of this.rows.values()) this.drop(row);
    this.rows.clear();
  }
  keys(): number[] { return [...this.rows.keys()]; }
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

async function openPdf(url: string): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  return pdfjs.getDocument({ url, disableRange: true, disableStream: true });
}

async function drawPage(doc: PDFDocumentProxy, index: number, width: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(index + 1);
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

function PageFace({ page, cache, stamp }: { page: number | null; cache: PageCache<HTMLCanvasElement>; stamp: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const target = ref.current;
    const source = page === null ? undefined : cache.get(page);
    if (!target || !source) return;
    target.width = source.width;
    target.height = source.height;
    target.getContext('2d')?.drawImage(source, 0, 0);
  }, [page, cache, stamp]);
  if (page === null) return null;
  return <canvas ref={ref} className={cx('pf-canvas', !cache.has(page) && 'pf-pending')} aria-hidden="true" />;
}

/** Our words, not a frame with the server's JSON or the browser's error. The header keeps « Ouvrir dans un onglet ». */
export function PdfFailed({ url, title }: { url: string; title: string }) {
  return (
    <div className="pf">
      <div className="pf-stage"><div className="lightbox-wait">Ce guide ne s’ouvre pas ici : le fichier est introuvable ou abîmé.</div></div>
      <div className="pf-bar" style={{ justifyContent: 'center' }}><a className="btn btn-sm lightbox-btn" href={url} download={pdfName(title)}><Icon name="file" size={13} />Télécharger</a></div>
    </div>
  );
}

interface Flip { id: number; from: number; to: number }

export function PdfFlip({ url, title }: { url: string; title: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const flips = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [aspect, setAspect] = useState(0.707);  // width / height of a page, A4 until the first page answers
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [spread, setSpread] = useState(0);
  const [flip, setFlip] = useState<Flip | null>(null);
  const [heading, setHeading] = useState(1);    // which way the reader goes: the next spread to prepare
  const [stamp, setStamp] = useState(0);
  const cache = useMemo(() => new PageCache<HTMLCanvasElement>(KEPT_PAGES, (c) => { c.width = 0; c.height = 0; }), []);
  const pages = doc?.numPages ?? 0;
  const count = spreadCount(pages);

  useEffect(() => {
    let stale = false;
    let task: PDFDocumentLoadingTask | null = null;
    setDoc(null);
    setFailed(false);
    setSpread(0);
    cache.clear();
    openPdf(url).then(async (opened) => {
      task = opened;
      if (stale) { void opened.destroy(); return; }
      const d = await opened.promise;
      const first = (await d.getPage(1)).getViewport({ scale: 1 });
      if (stale) return;
      setAspect(first.width / first.height);
      setDoc(d);
    }).catch(() => { if (!stale) setFailed(true); });
    return () => {
      stale = true;
      void task?.destroy();
      clearTimeout(timer.current);
    };
  }, [url, cache]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [doc]);

  const pageW = Math.floor(Math.min(box.w / 2, MAX_PAGE_CSS_PX, box.h * aspect));
  const drawnW = Math.round((Math.round(Math.min(box.w / 2, MAX_PAGE_CSS_PX) / WIDTH_STEP_PX) * WIDTH_STEP_PX) * Math.min(window.devicePixelRatio || 1, MAX_DPR));

  useEffect(() => { cache.clear(); }, [drawnW, cache]); // before the drawing below, or it would keep pages of the old size

  // Current and next spread only, in that order, one page at a time: pdf.js would otherwise draw what he already left.
  useEffect(() => {
    if (!doc || drawnW <= 0) return;
    let stale = false;
    const now = flipSpread(pages, spread);
    const next = flipSpread(pages, spread + heading);
    const wanted = [now.right, now.left, next.right, next.left].filter((p): p is number => p !== null);
    void (async () => {
      for (const page of wanted) {
        if (stale) return;
        if (cache.has(page)) continue;
        const canvas = await drawPage(doc, page, drawnW);
        if (stale) { canvas.width = 0; return; }
        cache.set(page, canvas);
        setStamp((n) => n + 1);
      }
    })().catch(() => { if (!stale) setFailed(true); });
    return () => { stale = true; };
  }, [doc, pages, spread, heading, drawnW, cache]);

  const go = useCallback((target: number, animate = true) => {
    const to = Math.min(count - 1, Math.max(0, target));
    if (to === spread || count === 0) return;
    setHeading(to > spread ? 1 : -1);
    setSpread(to);
    clearTimeout(timer.current);
    if (!animate || reducedMotion()) { setFlip(null); return; }
    flips.current += 1;
    setFlip({ id: flips.current, from: spread, to });
    timer.current = setTimeout(() => setFlip(null), FLIP_MS);
  }, [count, spread]);

  useLightboxKey((e) => {
    const act = {
      ArrowLeft: () => go(spread - 1), PageUp: () => go(spread - 1), ArrowRight: () => go(spread + 1), PageDown: () => go(spread + 1),
      Home: () => go(0), End: () => go(count - 1),
    }[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  });

  if (failed) return <PdfFailed url={url} title={title} />;

  const shown = flipSpread(pages, spread);
  const turn = flip ? flipFaces(pages, flip.from, flip.to) : null;
  const under = turn?.under ?? shown;
  return (
    <div className="pf">
      <div className="pf-stage" ref={stage}>
        {!doc ? <div className="lightbox-wait">Ouverture du guide…</div> : (
          <div className="pf-book" style={{ width: pageW * 2, height: pageW / aspect }}>
            <div className="pf-page pf-left">{under.left !== null ? <PageFace page={under.left} cache={cache} stamp={stamp} /> : null}</div>
            <div className="pf-page pf-right">{under.right !== null ? <PageFace page={under.right} cache={cache} stamp={stamp} /> : null}</div>
            {flip && turn ? (
              <>
                <div key={flip.id} className={cx('pf-leaf', flip.to > flip.from ? 'pf-turn' : 'pf-turn-back')}>
                  <div className="pf-face"><PageFace page={turn.front} cache={cache} stamp={stamp} /></div>
                  <div className="pf-face pf-rear"><PageFace page={turn.rear} cache={cache} stamp={stamp} /></div>
                </div>
                <div key={`cast-${flip.id}`} className="pf-cast" />
              </>
            ) : null}
            <span className="pf-gutter" />
            <button type="button" className="pf-edge pf-edge-left" onClick={() => go(spread - 1)} disabled={spread === 0} aria-label="Page précédente" />
            <button type="button" className="pf-edge pf-edge-right" onClick={() => go(spread + 1)} disabled={spread >= count - 1} aria-label="Page suivante" />
          </div>
        )}
      </div>
      <div className="pf-bar">
        <button type="button" className="vp-btn" onClick={() => go(spread - 1)} disabled={spread === 0} title="Page précédente (←)" aria-label="Page précédente"><Icon name="chevronLeft" size={15} /></button>
        <input className="pf-slider" type="range" min={0} max={Math.max(0, count - 1)} value={spread} onChange={(e) => go(Number(e.target.value), false)} aria-label="Aller à la page" disabled={!doc} />
        <button type="button" className="vp-btn" onClick={() => go(spread + 1)} disabled={spread >= count - 1} title="Page suivante (→)" aria-label="Page suivante"><Icon name="chevronRight" size={15} /></button>
        <span className="vp-time">{doc ? spreadLabel(pages, spread) : '…'}</span>
        <a className="btn btn-sm lightbox-btn" href={url} download={pdfName(title)}><Icon name="file" size={13} />Télécharger</a>
      </div>
    </div>
  );
}
