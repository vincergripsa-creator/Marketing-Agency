/**
 * The looks the founder sees (design plan D207): what light cards keep of a guide's looks, the look of each gallery tile, the style filter,
 * the cover of each version, and the market's taste for looks, which leaves the server in god mode only (D201, E4). On the V1 save,
 * dressed by hand: an old run reads as it always did, a dressed guide as the design build writes one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CompanySnapshot, Deliverable, DesignLogEntry, Product, VisualTaste, WorldState } from '../src/shared.js';
import { ART_STYLES, PAGE_HEROES, PAGE_TEMPLATES } from '../src/shared.js';
import { repoRoot } from '../src/core/index.js';
import { safeFinance, viewOf } from '../src/api/snapshot.js';
import {
  buildSnapshot, DEFAULT_LIMITS, fullProduct, LIGHT_LOOK_WHY, LIVE_BUDGET_BYTES, LIVE_LIMITS, LIVE_TIGHT_LIMITS, serializeLiveSnapshot, serializeSnapshot, stubProduct, TIGHT_LIMITS,
} from '../src/api/trim.js';
import { deliverablesPage, digestPeopleOf, lookAt } from '../src/api/views.js';

const OLD_SAVE = join(repoRoot(), 'server', 'test', 'fixtures', 'world-v1.json.gz');
const v1 = JSON.parse(gunzipSync(readFileSync(OLD_SAVE)).toString('utf8')) as WorldState;
const clone = <T>(v: T): T => structuredClone(v);

const WHY = 'Refonte v2 : style « Typo XXL » au lieu de « Papier découpé » — le style « Papier découpé » convertit 18 % de moins que « Typo XXL » sur la niche (2 300 et 1 900 visiteurs) ; Mur d’avis et Le pack : le plus vendeur sur la niche';

interface Dressed { w: WorldState; guide: Product; early: string; late: string }

/** One live guide of the V1 save in its second look: a page test won on v1, then a refresh. Two of its ads, one of each look. */
function dressed(): Dressed {
  const w = clone(v1);
  const guide = w.company.products.find((p) => p.status === 'live' && p.design && p.salesPage && p.files?.cover)!;
  const id = guide.id;
  Object.assign(guide, {
    version: 2,
    files: { ...guide.files, cover: `files/${id}/v2/cover.svg`, salesPage: `files/${id}/v2/sales-page.html`, pdf: `files/${id}/v2/guide.pdf` },
    design: { ...guide.design!, style: 'typo' },
    salesPage: { ...guide.salesPage!, template: 'proof', hero: 'bundle' },
    leadMagnet: { title: 'Le mémo', file: 'files/memo.pdf', day: 9 },
    designLog: [
      { day: 2, version: 1, style: 'collage', template: 'editorial', hero: 'book', why: 'Papier découpé : convention du genre ; Éditoriale et Livre 3D : pari du bandit' },
      { day: 12, version: 1, style: 'collage', template: 'express', hero: 'book', why: 'le gabarit « Express » gagne le test A/B (conversion 3,1 % contre 2,2 %)' },
      { day: 20, version: 2, style: 'typo', template: 'proof', hero: 'bundle', why: WHY },
    ] satisfies DesignLogEntry[],
  });
  const [a, b] = w.company.creatives.slice(-2);
  Object.assign(a!, { productId: id, createdDay: 5 });
  Object.assign(b!, { productId: id, createdDay: 25 });
  const tile = (kind: Deliverable['kind'], path: string, title: string, day: number, creativeId: string | null = null): Deliverable => ({ id: `t_${kind}_${day}`, kind, title, productId: id, creativeId, path, createdBy: 'zoe', day, quality: 80 });
  w.company.deliverables.push(
    tile('cover', `files/${id}/v1/cover.svg`, 'Couverture « G » (v1)', 2), tile('sales_page', `files/${id}/v1/sales-page.html`, 'Page de vente « G » (v1)', 3),
    tile('pdf', `files/${id}/v1/guide.pdf`, 'Guide « G » (v1, 30 pages)', 3), tile('ad_storyboard', `files/${id}/ads/${a!.id}/frame-1.svg`, 'Storyboard', 5, a!.id),
    tile('cover', `files/${id}/v2/cover.svg`, 'Couverture « G » (v2, refonte)', 20), tile('sales_page', `files/${id}/v2/sales-page.html`, 'Page de vente « G » (v2)', 21),
    tile('pdf', `files/${id}/v2/guide.pdf`, 'Guide « G » (v2, 30 pages)', 21), tile('ad_storyboard', `files/${id}/ads/${b!.id}/frame-1.svg`, 'Storyboard', 25, b!.id),
  );
  return { w, guide, early: 't_ad_storyboard_5', late: 't_ad_storyboard_25' };
}

describe('the gallery says what each tile wore', () => {
  it('a cover and a page by their version, a guide by its own, an ad by the day it was made', () => {
    const { w, early, late } = dressed();
    const page = deliverablesPage(w, { kinds: ['cover', 'sales_page', 'pdf', 'ad_storyboard'] });
    const at = (id: string) => page.items.find((t) => t.id === id)?.look;
    expect(at('t_cover_2')).toEqual({ style: 'collage', version: 1 });
    expect(at('t_cover_20')).toEqual({ style: 'typo', version: 2 });
    expect(at('t_sales_page_3')).toEqual({ style: 'collage', template: 'express', hero: 'book', version: 1 });
    expect(at('t_sales_page_21')).toEqual({ style: 'typo', template: 'proof', hero: 'bundle', version: 2 });
    expect(at('t_pdf_3')).toEqual({ style: 'collage', version: 1 });
    expect(at(early)).toMatchObject({ style: 'collage' });
    expect(at(late)).toMatchObject({ style: 'typo' });
  });

  it('a guide older than looks wears Bauhaus and the V1 page (D200, D202)', () => {
    const w = clone(v1);
    const page = deliverablesPage(w, { kinds: ['cover', 'sales_page'] });
    expect(page.items.length).toBeGreaterThan(0);
    for (const t of page.items) {
      expect(t.look?.style, t.id).toBe('bauhaus');
      expect(t.look).not.toHaveProperty('template');
    }
    expect(page.styles).toEqual({ bauhaus: page.total });
  });

  it('the guide of an older version shows that version\'s cover, the current one today\'s', () => {
    const { w, guide } = dressed();
    const page = deliverablesPage(w, { kinds: ['pdf'] });
    expect(page.items.find((t) => t.id === 't_pdf_3')?.poster).toBe(`files/${guide.id}/v1/cover.svg`);
    expect(page.items.find((t) => t.id === 't_pdf_21')?.poster).toBe(guide.files.cover);
  });

  it('`style:<id>` among the kinds keeps that style; the counts read the kinds asked, whatever style', () => {
    const { w } = dressed();
    const all = deliverablesPage(w, { kinds: ['cover'] });
    const typo = deliverablesPage(w, { kinds: ['cover', 'style:typo'] });
    expect(typo.items.map((t) => t.id)).toContain('t_cover_20');
    expect(typo.items.map((t) => t.id)).not.toContain('t_cover_2');
    expect(typo.items.every((t) => t.look?.style === 'typo')).toBe(true);
    expect(typo.total).toBe(all.styles.typo);
    expect(typo.styles).toEqual(all.styles);
    expect(typo.counts).toEqual(all.counts);
    expect(Object.values(all.styles).reduce((n, k) => n + (k ?? 0), 0)).toBe(all.total);
    expect(deliverablesPage(w, { kinds: ['style:typo'] }).items.every((t) => t.look?.style === 'typo')).toBe(true);
  });

  it('lookAt: today wins for the current version, the log for the past, the day for an ad', () => {
    const { guide } = dressed();
    expect(lookAt(guide, { version: 2 }, true)).toEqual({ style: 'typo', template: 'proof', hero: 'bundle', version: 2 });
    expect(lookAt(guide, { version: 1 }, true)).toEqual({ style: 'collage', template: 'express', hero: 'book', version: 1 });
    expect(lookAt(guide, { day: 3 }, true)).toEqual({ style: 'collage', template: 'editorial', hero: 'book', version: 1 });
    expect(lookAt({ ...guide, designLog: undefined, design: { ...guide.design!, style: undefined } }, { version: 1 }, true)).toEqual({ style: 'bauhaus', version: 1 });
  });
});

describe('what a card keeps of a guide\'s looks', () => {
  const twelve = (): DesignLogEntry[] => Array.from({ length: 12 }, (_, i) => ({ day: 1 + i, version: 1 + Math.floor(i / 4), style: ART_STYLES[i % 8]!, template: PAGE_TEMPLATES[i % 6]!, hero: PAGE_HEROES[i % 5]!, why: `${i} ${WHY}` }));

  it('the stream: its look, its last three looks with a reason cut to a line; the product view all of them', () => {
    const { w, guide } = dressed();
    guide.designLog = twelve();
    const f = safeFinance(w);
    const card = (limits: typeof LIVE_LIMITS) => buildSnapshot(w, f, false, limits).company.products.find((p) => p.id === guide.id)!;
    const live = card(LIVE_LIMITS);
    expect(live.design).toEqual({ palette: guide.design!.palette, style: 'typo' });
    expect(live.salesPage).toEqual({ template: 'proof', hero: 'bundle' });
    expect(live.designLog!.map((e) => e.day)).toEqual([10, 11, 12]);
    for (const e of live.designLog!) expect(e.why.length).toBeLessThanOrEqual(LIGHT_LOOK_WHY);
    expect(live.designLog!.at(-1)!.why).toMatch(/^11 Refonte v2 : style « Typo XXL »/);
    expect(live).not.toHaveProperty('leadMagnet');
    for (const limits of [TIGHT_LIMITS, LIVE_TIGHT_LIMITS]) {
      const tight = card(limits);
      expect(tight, String(limits.looks)).not.toHaveProperty('designLog');
      expect(tight.salesPage).toEqual({ template: 'proof', hero: 'bundle' });
      expect(tight.design?.style).toBe('typo');
    }
    const whole = card(DEFAULT_LIMITS);
    expect(whole.designLog).toEqual(guide.designLog);
    expect(whole.leadMagnet).toEqual(guide.leadMagnet);
    expect(fullProduct(guide).designLog).toEqual(guide.designLog);
    expect((viewOf(w, 'product', new URLSearchParams({ id: guide.id })) as Product).designLog).toHaveLength(12);
  });

  it('a stopped guide names its look and nothing else of its design; a V1 guide has none to name', () => {
    const { w, guide } = dressed();
    const stub = stubProduct({ ...guide, status: 'killed' });
    expect(stub.design).toEqual({ style: 'typo' });
    expect(stub.salesPage).toEqual({ template: 'proof', hero: 'bundle' });
    expect(stub.designLog).toHaveLength(3);
    expect(stub).not.toHaveProperty('leadMagnet');
    const old = w.company.products.find((p) => !p.designLog && p.salesPage && p.design)!;
    const oldStub = stubProduct({ ...old, status: 'killed' });
    expect(oldStub.design).toBeNull();
    expect(oldStub.salesPage).toBeNull();
    expect(oldStub).not.toHaveProperty('designLog');
  });

  it('an old save reads as it always did: a palette, no page, no log', () => {
    const w = clone(v1);
    const snap = JSON.parse(serializeLiveSnapshot(w, safeFinance(w))) as CompanySnapshot;
    const card = snap.company.products.find((p) => p.status === 'live' && p.design)!;
    const before = w.company.products.find((p) => p.id === card.id)!;
    expect(card.design).toEqual({ palette: before.design!.palette });
    expect(card.salesPage).toBeNull();
    expect(card).not.toHaveProperty('designLog');
  });

  it('every guide of a hundred at its 12 looks of 300 characters: the stream keeps its budget, each card three looks at most', () => {
    const w = clone(v1);
    const guide = w.company.products.find((p) => p.status === 'live')!;
    w.company.products = Array.from({ length: 100 }, (_, i) => ({ ...clone(guide), id: `prd_look${i}`, status: i % 3 ? 'live' as const : 'killed' as const, designLog: twelve().map((e) => ({ ...e, why: WHY.repeat(2).slice(0, 300) })) }));
    const json = serializeLiveSnapshot(w, safeFinance(w));
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(LIVE_BUDGET_BYTES);
    const cards = (JSON.parse(json) as CompanySnapshot).company.products;
    expect(cards.length).toBeGreaterThan(60);
    expect(cards.every((p) => (p.designLog?.length ?? 0) <= LIVE_LIMITS.looks)).toBe(true);
  });
});

describe('the market\'s taste for looks (D201, E4)', () => {
  const SENTINEL = 1.0731;
  const taste = (): VisualTaste => ({
    style: Object.fromEntries(ART_STYLES.map((k, i) => [k, SENTINEL + i / 1e6])) as VisualTaste['style'],
    page: Object.fromEntries(PAGE_TEMPLATES.map((k, i) => [k, SENTINEL + i / 1e6])) as VisualTaste['page'],
    hero: Object.fromEntries(PAGE_HEROES.map((k, i) => [k, SENTINEL + i / 1e6])) as VisualTaste['hero'],
  });

  it('never leaves the server outside god mode: no snapshot, no stream, no product view, no gallery, no digest', () => {
    const { w } = dressed();
    for (const n of w.market.niches) n.visualTaste = taste();
    const f = safeFinance(w);
    const outside = [
      JSON.stringify(buildSnapshot(w, f, false)), serializeSnapshot(w, f), serializeLiveSnapshot(w, f), JSON.stringify(deliverablesPage(w, {})),
      JSON.stringify(digestPeopleOf(w, 1, w.day)), ...w.company.products.map((p) => JSON.stringify(fullProduct(p))),
    ];
    for (const json of outside) {
      expect(json).not.toContain('visualTaste');
      expect(json).not.toContain(String(SENTINEL));
    }
  });

  it('god mode shows each niche\'s, as the market holds it', () => {
    const { w } = dressed();
    for (const n of w.market.niches) n.visualTaste = taste();
    const god = buildSnapshot(w, safeFinance(w), true).godMode!.niches;
    expect(god).toHaveLength(w.market.niches.length);
    for (const n of god) expect(n.visualTaste).toEqual(taste());
    expect(serializeLiveSnapshot(w, safeFinance(w), true)).toContain(String(SENTINEL));
    delete w.market.niches[0]!.visualTaste;
    expect(buildSnapshot(w, safeFinance(w), true).godMode!.niches[0]).not.toHaveProperty('visualTaste');
  });
});
