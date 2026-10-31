// Viewers: tiles that open them, the player's fallback, the flip's arithmetic, and pdf.js kept out of the main chunk.
// Run: cd server && npx vitest run --root ../web/src ui/viewers.test
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompanySnapshot, CreativeVideo, Deliverable } from '../../../shared/types';
import { openStream } from '../api';
import { withVideo } from '../store';
import { mockSnapshot } from '../world/mockSnapshot';
import { AppContext, type AppCtx } from './context';
import { buildLookups } from './labels';
import { GalleryTab, pageOf, videoTiles } from './tabs/GalleryTab';
import { ProductsTab } from './tabs/ProductsTab';
import { Lightbox, routeKey } from './viewers/Lightbox';
import { flipFaces, flipSpread, PageCache, spreadCount, spreadLabel } from './viewers/PdfFlip';
import { fmtClock, NO_FILE_CAPTION, ratioValue, safeBands, VideoLightbox, VideoPlayer } from './viewers/VideoPlayer';

const detail = vi.hoisted(() => ({ data: null as unknown, paths: [] as (string | null)[] }));
vi.mock('./useDetail', () => ({
  useDetail: (path: string | null) => { detail.paths.push(path); return { data: detail.data, error: null, loading: false, reload: () => undefined }; },
}));

const noop = () => undefined;

function render(s: CompanySnapshot, el: ReactElement, demo = false): string {
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: s.activity, demo, godMode: false, runId: s.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

const ready = (o: Partial<CreativeVideo> = {}): CreativeVideo => ({
  status: 'ready', reason: null, poster: 'video/cre_1/poster.png', captions: 'video/cre_1/captions.vtt', cards: [], voice: 'hortense', qa: null,
  videos: [{ ratio: '9:16', path: 'video/cre_1/9x16.mp4', durationSec: 26.1, bytes: 5_000_000 }], ...o,
});

function gallery(list: Deliverable[], videos?: CompanySnapshot['videos']): CompanySnapshot {
  const s = mockSnapshot();
  return { ...s, company: { ...s.company, deliverables: list }, deliverableCounts: undefined, ...(videos ? { videos } : {}) };
}

const row = (o: Partial<Deliverable>): Deliverable => ({ id: 'dlv_1', kind: 'pdf', title: 'Le guide', productId: null, creativeId: null, path: 'files/prd_1/v1/guide.pdf', createdBy: 'raphael', day: 12, quality: 80, ...o });

describe('flipSpread: the cover alone on the right, then facing pages', () => {
  it('spread 0 is the cover, spread 1 pages 1 and 2', () => {
    expect(flipSpread(24, 0)).toEqual({ left: null, right: 0 });
    expect(flipSpread(24, 1)).toEqual({ left: 1, right: 2 });
  });
  it('the last spread of an even count has no right page, of an odd count it has both', () => {
    expect(flipSpread(24, 12)).toEqual({ left: 23, right: null });
    expect(flipSpread(23, 11)).toEqual({ left: 21, right: 22 });
  });
  it('every page appears exactly once, whatever the count', () => {
    for (const pages of [1, 2, 3, 4, 5, 23, 24, 60]) {
      const seen = Array.from({ length: spreadCount(pages) }, (_, i) => flipSpread(pages, i)).flatMap((s) => [s.left, s.right]).filter((p) => p !== null);
      expect(seen, `${pages} pages`).toEqual(Array.from({ length: pages }, (_, i) => i));
    }
  });
  it('spreadCount', () => {
    expect([0, 1, 2, 3, 23, 24].map(spreadCount)).toEqual([0, 1, 2, 2, 12, 13]);
  });
  it('the counter reads from 1, one page when the spread shows one', () => {
    expect(spreadLabel(24, 2)).toBe('Pages 4–5 / 24');
    expect(spreadLabel(24, 0)).toBe('Page 1 / 24');
    expect(spreadLabel(24, 12)).toBe('Page 24 / 24');
  });
});

describe('the leaf between two spreads', () => {
  it('forward: the current right page turns over onto the next left page', () => {
    expect(flipFaces(24, 1, 2)).toEqual({ under: { left: 1, right: 4 }, front: 2, rear: 3 });
  });
  it('back: the same leaf the other way', () => {
    expect(flipFaces(24, 2, 1)).toEqual({ under: { left: 1, right: 4 }, front: 2, rear: 3 });
  });
  it('from the cover and onto the last page, the empty sides stay empty', () => {
    expect(flipFaces(24, 0, 1)).toEqual({ under: { left: null, right: 2 }, front: 0, rear: 1 });
    expect(flipFaces(24, 11, 12)).toEqual({ under: { left: 21, right: null }, front: 22, rear: 23 });
  });
});

describe('page cache', () => {
  it('holds 8 pages, the least recently used leaves first and is freed', () => {
    const dropped: number[] = [];
    const cache = new PageCache<number>(8, (v) => dropped.push(v));
    for (let p = 0; p < 8; p++) cache.set(p, p);
    expect(cache.get(0)).toBe(0); // read: no longer the oldest
    cache.set(8, 8);
    expect(dropped).toEqual([1]);
    expect(cache.keys()).toHaveLength(8);
    expect(cache.has(0)).toBe(true);
    expect(cache.has(1)).toBe(false);
  });
  it('clear frees every page', () => {
    const dropped: number[] = [];
    const cache = new PageCache<number>(8, (v) => dropped.push(v));
    cache.set(1, 1);
    cache.set(2, 2);
    cache.clear();
    expect(dropped).toEqual([1, 2]);
    expect(cache.keys()).toEqual([]);
  });
});

describe('Galerie: which tiles open a viewer', () => {
  it('a guide is a button, with its cover', () => {
    const s = mockSnapshot();
    const p = s.company.products.find((x) => x.files?.cover)!;
    const html = render(gallery([row({ productId: p.id })]), <GalleryTab onClose={noop} />);
    expect(html).toContain('<button type="button" class="tile" data-viewer="pdf"');
    expect(html).toContain(encodeURI(p.files.cover!));
    expect(html).not.toContain('guide.pdf"');
  });
  it('a video is a button, with its poster', () => {
    const html = render(gallery([], { cre_1: ready() }), <GalleryTab onClose={noop} />);
    expect(html).toContain('<button type="button" class="tile" data-viewer="video"');
    expect(html).toContain('poster.png');
    expect(html).not.toContain('9x16.mp4');
  });
  it('a sales page stays a new-tab link', () => {
    const html = render(gallery([row({ kind: 'sales_page', path: 'files/prd_1/v1/sales.html' })]), <GalleryTab onClose={noop} />);
    expect(html).not.toContain('data-viewer');
    expect(html).toMatch(/<a class="tile" href="\/runs\/[^"]*sales\.html" target="_blank"/);
  });
  it('nothing opens in demo mode', () => {
    const html = render(gallery([row({})], { cre_1: ready() }), <GalleryTab onClose={noop} />, true);
    expect(html).not.toContain('data-viewer');
    expect(html).toContain('tile is-disabled');
  });
  it('« Charger la suite » past a page of 60, and only then', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => row({ id: `dlv_${i}`, kind: 'sales_page' }));
    expect(render(gallery(many(60)), <GalleryTab onClose={noop} />)).not.toContain('Charger la suite');
    const html = render(gallery(many(61)), <GalleryTab onClose={noop} />);
    expect(html).toContain('Charger la suite');
    expect(html.split('class="tile"').length - 1).toBe(60);
  });
});

describe('Galerie: what the server pages', () => {
  const answer = (o: object) => { detail.data = o; };
  const asked = (el: () => string) => { detail.paths.length = 0; const html = el(); detail.data = null; return { html, path: detail.paths[0] }; };
  const tile = { id: 'vid_cre_9', kind: 'ad_video', title: 'Une vieille pub', productId: null, creativeId: 'cre_9', path: 'video/cre_9/master.mp4', poster: 'video/cre_9/poster.jpg', createdBy: 'zoe', day: 3, quality: 85 };

  it('asks the first page of the gallery\'s kinds, no notes', () => {
    expect(asked(() => render(gallery([]), <GalleryTab onClose={noop} />)).path).toBe('/api/deliverables?page=1&kinds=pdf,cover,ad_video,ad_preview,sales_page');
  });
  it('asks nothing in demo mode', () => {
    expect(asked(() => render(gallery([]), <GalleryTab onClose={noop} />, true)).path).toBeNull();
  });
  it('a page wins over the snapshot: tiles of the server, a video the stream no longer holds still opens', () => {
    answer({ items: [tile], page: 1, pages: 1, pageSize: 60, total: 1 });
    const { html } = asked(() => render(gallery([row({ title: 'Du snapshot' })]), <GalleryTab onClose={noop} />));
    expect(html).toContain('Une vieille pub');
    expect(html).not.toContain('Du snapshot');
    expect(html).toContain('data-viewer="video"');
    expect(html).toContain('video/cre_9/poster.jpg');
    expect(html).not.toContain('Charger la suite');
  });
  it('the guide\'s cover comes with its row, the product may have left the snapshot', () => {
    answer({ items: [{ ...row({ productId: 'prd_gone' }), poster: 'files/prd_gone/v1/cover.svg' }], page: 1, pages: 1, pageSize: 60, total: 1 });
    const { html } = asked(() => render(gallery([]), <GalleryTab onClose={noop} />));
    expect(html).toMatch(/<img src="\/runs\/[^"]*prd_gone\/v1\/cover\.svg"/);
  });
  it('more rows on the server: « Charger la suite », and the title says how much is shown', () => {
    answer({ items: [tile], page: 1, pages: 2, pageSize: 60, total: 67 });
    const { html } = asked(() => render(gallery([]), <GalleryTab onClose={noop} />));
    expect(html).toContain('Charger la suite');
    expect(html).toContain('1 sur 67 livrables');
    expect(html).toMatch(/Tout<span class="seg-count">67</);
  });
  it('reads a page, a list too, and nothing else', () => {
    expect(pageOf({ items: [row({})], total: 301 })).toMatchObject({ total: 301 });
    expect(pageOf([row({})])).toMatchObject({ total: null });
    expect(pageOf(null)).toBeNull();
    expect(pageOf({ error: 'x' })).toBeNull();
  });
  it('a video without a file and without a poster has no tile', () => {
    const s = gallery([], { cre_1: ready({ status: 'failed', videos: [], poster: null }), cre_2: ready({ status: 'evicted', videos: [] }) });
    expect(videoTiles(s).map((t) => t.creativeId)).toEqual(['cre_2']);
  });
});

describe('VideoPlayer', () => {
  const s = mockSnapshot();
  it('no file: the sandboxed iframe of today, and the caption', () => {
    const html = render(s, <VideoPlayer videos={[]} fallbackHtml="ads/cre_1/preview.html" title="La pub" />);
    expect(html).toMatch(/<iframe [^>]*src="\/runs\/[^"]*preview\.html"/);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain(NO_FILE_CAPTION);
    expect(html).not.toContain('<video');
  });
  it('a file: a real <video> with its poster and its captions, no iframe', () => {
    const v = ready();
    const html = render(s, <VideoPlayer videos={v.videos} poster={v.poster} captions={v.captions} fallbackHtml="ads/cre_1/preview.html" title="La pub" />);
    expect(html).toMatch(/<video [^>]*src="\/runs\/[^"]*9x16\.mp4"/);
    expect(html).toContain('poster="/runs/');
    expect(html).toMatch(/<track [^>]*kind="captions"[^>]*captions\.vtt/);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain(' controls');
    expect(html).toContain('Pub simulée — jamais publiée');
  });
  it('one ratio offers no switch, two do', () => {
    const one = render(s, <VideoPlayer videos={ready().videos} title="La pub" />);
    expect(one).not.toContain('>4:5<');
    const two = render(s, <VideoPlayer videos={[...ready().videos, { ratio: '4:5', path: 'video/cre_1/4x5.mp4', durationSec: 26, bytes: 4_000_000 }]} title="La pub" />);
    expect(two).toContain('>4:5<');
    expect(two).toContain('>9:16<');
  });
  it('safe zones come from the shared table', () => {
    expect(safeBands('9:16')).toEqual({ top: 12.5, right: (150 / 1080) * 100, bottom: (660 / 1920) * 100, left: (60 / 1080) * 100 });
    expect(safeBands('1:1').top).toBe(5);
    expect(ratioValue('9:16')).toBeCloseTo(0.5625);
  });
  it('the clock', () => {
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(65.9)).toBe('1:05');
    expect(fmtClock(Number.NaN)).toBe('0:00');
  });
});

describe('a carousel has cards, not a film (video §13)', () => {
  const deck: CreativeVideo = { status: 'ready', reason: null, videos: [], poster: 'video/cre_1/card-1.png', captions: null, cards: ['video/cre_1/card-1.png', 'video/cre_1/card-2.png', 'video/cre_1/card-3.png'], voice: null, qa: null };
  const page = (video: CreativeVideo) => render({ ...mockSnapshot(), videos: { cre_1: video } }, <VideoLightbox creativeId="cre_1" title="Pub" onClose={noop} />);

  it('shows every card, and asks for no video it can never get', () => {
    const html = page(deck);
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain('card-3.png');
    expect(html).toContain('3 cartes');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain(NO_FILE_CAPTION);
    expect(html).not.toContain('Générer la vidéo');
  });
  it('a single still says so', () => {
    expect(page({ ...deck, cards: ['video/cre_1/card-1.png'] })).toContain('Visuel fixe');
  });
  it('cards from a file that is gone do not hide the way back', () => {
    const html = page({ ...deck, status: 'evicted' });
    expect(html).toContain('Générer la vidéo');
    expect(html).not.toContain('card-3.png');
  });
  it('a film wins over its cards', () => {
    const html = page(ready({ cards: deck.cards }));
    expect(html).toContain('<video');
    expect(html).not.toContain('card-3.png');
  });
});

describe('a render that ends while the run is paused', () => {
  /** What the browser gives the client, without a browser: frames go in by hand. */
  class FakeSource {
    static last: FakeSource;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { FakeSource.last = this; }
    addEventListener(): void { /* the server sends plain messages, the type sits inside the JSON */ }
    close(): void { /* nothing to close */ }
  }
  const frame = (o: object) => FakeSource.last.onmessage!({ data: JSON.stringify(o) });

  it('the stream hands the video on, no snapshot needed', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const seen: [string, CreativeVideo][] = [];
    const close = openStream({ onSnapshot: noop, onActivity: noop, onVideo: (id, v) => seen.push([id, v]) });
    frame({ type: 'video', creativeId: 'cre_1', video: ready() });
    frame({ type: 'video', creativeId: 'cre_2' });
    close();
    vi.unstubAllGlobals();
    expect(seen).toEqual([['cre_1', ready()]]);
  });

  it('the store takes the event: nothing else tells the client while the run is paused', () => {
    const source = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/onVideo: \(id, video\) => \{\s+if \(cancelled\) return;\s+setSnapshot\(\(prev\) => \(prev \? withVideo\(prev, id, video\) : prev\)\);/);
  });

  it('the player leaves « Rendu en cours » for the real file', () => {
    const base = mockSnapshot();
    const rendering: CreativeVideo = { status: 'rendering', reason: null, videos: [], poster: null, captions: null, cards: [], voice: null, qa: null };
    const before = { ...base, videos: { cre_1: rendering, cre_2: rendering } };
    expect(render(before, <VideoLightbox creativeId="cre_1" title="Pub" onClose={noop} />)).toContain('Rendu en cours');
    const after = withVideo(before, 'cre_1', ready());
    expect(after.videos!.cre_2).toBe(rendering);
    const html = render(after, <VideoLightbox creativeId="cre_1" title="Pub" onClose={noop} />);
    expect(html).toContain('<video');
    expect(html).toContain('9x16.mp4');
    expect(html).not.toContain('Rendu en cours');
  });

  it('a snapshot with no videos yet takes the event too', () => {
    const { videos: _videos, ...bare } = mockSnapshot();
    expect(withVideo(bare, 'cre_1', ready()).videos).toEqual({ cre_1: ready() });
  });
});

describe('Lightbox', () => {
  const key = (k: string) => ({ key: k, stopPropagation: vi.fn(), preventDefault: vi.fn() }) as unknown as KeyboardEvent;

  it('always offers the plain tab', () => {
    const html = renderToStaticMarkup(<Lightbox title="Le guide" href="/runs/r/guide.pdf" onClose={noop}><p>x</p></Lightbox>);
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/<a [^>]*href="\/runs\/r\/guide\.pdf"[^>]*target="_blank"[^>]*>.*Ouvrir dans un onglet/);
  });
  it('a digit stops at the window, and still reaches the viewer', () => {
    const e = key('3');
    const inner = vi.fn();
    routeKey(e, null, noop, inner);
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(inner).toHaveBeenCalledWith(e);
  });
  it('Esc closes the layer, not the tab behind it', () => {
    const e = key('Escape');
    const close = vi.fn();
    const inner = vi.fn();
    routeKey(e, null, close, inner);
    expect(close).toHaveBeenCalledOnce();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });
  it('Tab is the one key that goes on', () => {
    const e = key('Tab');
    routeKey(e, null, noop, null);
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });
});

describe('Produits: feuilleter', () => {
  it('sits next to « Ouvrir le PDF », which stays a link', () => {
    const s = mockSnapshot();
    const html = render(s, <ProductsTab onClose={noop} />);
    expect(html).toMatch(/<button [^>]*data-viewer="pdf"[^>]*>(?:(?!<\/button>).)*Feuilleter<\/button><a [^>]*>(?:(?!<\/a>).)*Ouvrir le PDF/);
  });
  it('not in demo mode, there is no file', () => {
    expect(render(mockSnapshot(), <ProductsTab onClose={noop} />, true)).not.toContain('Feuilleter');
  });
});

describe('pdf.js stays out of the main chunk', () => {
  const source = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const file of ['./tabs/GalleryTab.tsx', './tabs/ProductsTab.tsx', './viewers/Lightbox.tsx', './viewers/VideoPlayer.tsx']) {
    it(`${file} imports neither pdfjs-dist nor PdfFlip statically`, () => {
      expect(source(file)).not.toContain('pdfjs-dist');
      expect(source(file)).not.toMatch(/^import [^\n]*PdfFlip/m);
    });
  }
  it('the flip book comes through lazy()', () => {
    expect(source('./viewers/Lightbox.tsx')).toMatch(/lazy\(\(\) => import\('\.\/PdfFlip'\)/);
  });
  it('PdfFlip asks pdf.js at run time only', () => {
    const flip = source('./viewers/PdfFlip.tsx');
    expect(flip).toContain("await import('pdfjs-dist')");
    expect(flip).not.toMatch(/^import (?!type)[^\n]*pdfjs-dist/m);
  });
});

describe('lightbox styles', () => {
  const css = readFileSync(new URL('./viewers/viewers.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const zIndex = (text: string, sel: string) => Number(new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(text)?.[1]);

  it('sits above the scenario modal', () => {
    expect(zIndex(css, '.lightbox')).toBe(90);
    expect(zIndex(css, '.lightbox')).toBeGreaterThan(zIndex(app, '.modal-backdrop'));
  });
  it('opens in ≤ 150 ms without an opacity fade, as the other panels', () => {
    const rule = /(?:^|\n)\.lightbox\s*\{([^}]*)\}/.exec(css)![1]!;
    const a = /animation:\s*([\w-]+)\s+([\d.]+)(m?s)/.exec(rule)!;
    expect(Number(a[2]) * (a[3] === 's' ? 1000 : 1)).toBeLessThanOrEqual(150);
    expect(new RegExp(`@keyframes ${a[1]}\\s*\\{[^\\n]*`).exec(css)![0]).not.toMatch(/opacity/);
  });
  it('the leaf turns in the time the code waits for', () => {
    expect(css).toContain('--pf-ms: 420ms');
    expect(readFileSync(new URL('./viewers/PdfFlip.tsx', import.meta.url), 'utf8')).toContain('const FLIP_MS = 420;');
  });
});
