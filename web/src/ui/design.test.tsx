// What the founder sees of looks (design plan D207): chips in Galerie and Produits, a guide's looks version by version, its page at phone
// and desktop size, the design bandits in Apprentissage, god mode's truth beside them, design lines of the feed and the digest.
// Run: cd server && npx vitest run --root ../web/src ui/design.test
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Activity, BanditArm, CompanySnapshot, DesignLogEntry, Experiment, FounderDigest, Product, VisualTaste } from '../../../shared/types';
import { mockSnapshot } from '../world/mockSnapshot';
import { ActivityFeed } from './ActivityFeed';
import { AppContext, type AppCtx } from './context';
import {
  coverPathOf, designBandits, favouriteOf, lookAt, lookLabel, lookOf, LOOK_CVR_SCALE, readableLine, tileLookOf, truthOf, variantOn, versionsOf,
} from './design';
import { designLines, FounderDigestBody } from './FounderDigest';
import { banditArmLabel, banditDimensionLabel, buildLookups, parseRule } from './labels';
import { GalleryTab, galleryPath } from './tabs/GalleryTab';
import { LearningTab } from './tabs/LearningTab';
import { pageTestPill, ProductsTab } from './tabs/ProductsTab';
import { DesignStory, LooksLightbox, mergedLog, productForLooks } from './viewers/LooksViewer';
import { pageFit, SalesPageViewer } from './viewers/SalesPageViewer';

const detail = vi.hoisted(() => ({ data: null as unknown, paths: [] as (string | null)[] }));
vi.mock('./useDetail', () => ({
  useDetail: (path: string | null) => { detail.paths.push(path); return { data: path?.startsWith('/api/deliverables') || path?.startsWith('/api/product') ? detail.data : null, error: null, loading: false, reload: () => undefined }; },
}));

const noop = () => undefined;

function render(s: CompanySnapshot, el: ReactElement, o: { demo?: boolean; godMode?: boolean; activity?: Activity[] } = {}): string {
  const ctx: AppCtx = {
    snapshot: s, lookups: buildLookups(s), activity: o.activity ?? s.activity, demo: o.demo ?? false, godMode: o.godMode ?? false, runId: s.runId,
    toast: noop, openAgent: noop, openDept: noop, openProduct: noop, centerAgent: noop, centerDept: noop, setTab: noop, openBrainNote: noop, refresh: noop,
  };
  return renderToStaticMarkup(<AppContext.Provider value={ctx}>{el}</AppContext.Provider>);
}

/** What a reader gets: no tags, no attributes, entities read back. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
/** Design ids that must never reach the screen as words. */
const RAW = /\b(cover_style|page_template|page_hero|editorial|creator|inside|proof|devices|spread|bundle|desk|collage|riso|grille)\b/;

const WHY_V1 = 'Papier découpé : convention du genre pour « Sommeil », pas encore de données ; Éditoriale et Livre 3D : pari du bandit';
const WHY_TEST = 'le gabarit « Express » gagne le test A/B (conversion 3,1 % contre 2,2 %)';
const WHY_V2 = 'Refonte v2 : style « Typo XXL » au lieu de « Papier découpé » — le style « Papier découpé » convertit 18 % de moins que « Typo XXL » sur la niche';
const LOG: DesignLogEntry[] = [
  { day: 2, version: 1, style: 'collage', template: 'editorial', hero: 'book', why: WHY_V1 },
  { day: 12, version: 1, style: 'collage', template: 'express', hero: 'book', why: WHY_TEST },
  { day: 20, version: 2, style: 'typo', template: 'proof', hero: 'bundle', why: WHY_V2 },
];

const arm = (key: string, alpha: number, beta: number, pulls: number): BanditArm => ({ key, alpha, beta, pulls, reward: 0 });

/** The mock agency in the design build: its first guide in its second look, a page test running on it, the niche's three bandits. */
function designed(o: { test?: Partial<Experiment>; taste?: boolean } = {}): { s: CompanySnapshot; guide: Product; niche: string } {
  const base = mockSnapshot();
  const niche = base.company.research.trends[0]!.nicheId;
  const p0 = base.company.products[0]!;
  const guide: Product = {
    ...p0, version: 2, status: 'live', nicheId: niche,
    files: { pdf: `files/${p0.id}/v2/guide.pdf`, cover: `files/${p0.id}/v2/cover.svg`, salesPage: `files/${p0.id}/v2/sales-page.html` },
    design: { ...p0.design!, style: 'typo' }, salesPage: { ...p0.salesPage!, template: 'proof', hero: 'bundle' }, designLog: LOG,
  };
  const test: Experiment = {
    id: 'exp_page', day: 22, owner: 'clara', hypothesis: 'Sur « Sommeil », le gabarit Feuilletage convertit mieux que Mur d’avis', dimension: 'page_template',
    variants: ['proof', 'inside'], metric: 'cvr', productId: guide.id, nicheId: niche, status: 'running',
    results: { proof: { n: 420, value: 0.031 }, inside: { n: 380, value: 0.024 } }, winner: null, endDay: null, ...o.test,
  };
  const bandits = {
    ...base.company.bandits,
    [`cover_style:${niche}`]: [arm('typo', 6, 14, 9), arm('collage', 3, 9, 6), arm('aura', 1.8, 4.2, 0)],
    [`page_template:${niche}`]: [arm('proof', 5, 15, 7), arm('express', 4, 16, 8)],
    [`page_hero:${niche}`]: [arm('bundle', 2, 6, 4), arm('book', 1.5, 4.5, 3)],
  };
  const taste: VisualTaste = {
    style: { bauhaus: 1, typo: 0.97, grille: 1, pop: 1, trait: 1, collage: 1.02, aura: 1.14, riso: 0.87 },
    page: { express: 1, editorial: 1, inside: 1.18, creator: 1, proof: 0.9, value: 0.92 },
    hero: { book: 1, devices: 1, spread: 1, bundle: 1.05, desk: 0.95 },
  };
  const s: CompanySnapshot = {
    ...base, day: 26,
    company: { ...base.company, products: [guide, ...base.company.products.slice(1)], experiments: [...base.company.experiments, test], bandits },
    ...(o.taste ? { godMode: { niches: [{ id: niche, name: 'Sommeil', demand: 0.5, wtp: { min: 9, sweet: 19, max: 29 }, competition: 0.3, tiktokAffinity: 0.6, hookAffinity: {}, visualTaste: taste }], intents: {} } } : {}),
  };
  return { s, guide, niche };
}

describe('labels: a look reads in French, never as its id', () => {
  it('every style, template and hero of shared/design.ts', () => {
    expect([lookLabel('style', 'trait'), lookLabel('template', 'proof'), lookLabel('hero', 'bundle')]).toEqual(['Ligne claire', 'Mur d’avis', 'Le pack']);
  });
  it('no style is the V1 look, Bauhaus; no template the V1 page, « Classique »', () => {
    expect([lookLabel('style', undefined), lookLabel('template', null)]).toEqual(['Bauhaus', 'Classique']);
  });
  it('the bandits and the experiments of looks print words', () => {
    const l = buildLookups(mockSnapshot());
    const niche = mockSnapshot().company.research.trends[0]!;
    expect(banditDimensionLabel(l, `cover_style:${niche.nicheId}`)).toBe(`Style de couverture · ${niche.name}`);
    expect(banditDimensionLabel(l, `page_hero:${niche.nicheId}`)).toBe(`Visuel de page · ${niche.name}`);
    expect(banditArmLabel(l, 'page_template', 'creator')).toBe('Créatrice');
    expect(banditArmLabel(l, `cover_style:${niche.nicheId}`, 'riso')).toBe('Risographie');
  });
  it('the playbook rules of looks, written with a key or a label', () => {
    expect(parseRule('Style de couverture « aura » sur « Sommeil »')).toMatchObject({ kind: 'style', label: 'Style de couverture', value: 'Aura' });
    expect(parseRule('Gabarit de page « Mur d’avis » sur « Sommeil » : il gagne le test A/B')).toMatchObject({ kind: 'template', value: 'Mur d’avis' });
    expect(parseRule('Visuel de page « desk » sur « Sommeil »')).toMatchObject({ kind: 'hero', value: 'Sur le bureau' });
  });
});

describe('a guide\'s looks', () => {
  it('lookOf: a light card reads its chips from the style and the page it keeps; a guide before its cover has none', () => {
    expect(lookOf({ design: { style: 'aura' } as Product['design'], salesPage: { template: 'value', hero: 'desk' } as Product['salesPage'], files: { pdf: null, cover: 'c.svg', salesPage: 'p.html' } }))
      .toEqual({ style: 'aura', template: 'value', hero: 'desk', page: true });
    expect(lookOf({ design: null, salesPage: null, files: { pdf: null, cover: 'files/p/v1/cover.svg', salesPage: 'files/p/v1/sales-page.html' } })).toEqual({ style: 'bauhaus', template: null, hero: null, page: true });
    expect(lookOf({ design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null } })).toEqual({ style: null, template: null, hero: null, page: false });
  });
  it('versionsOf: one card a version, the page carried until it changes, a refresh flagged, today closing the strip', () => {
    const { guide } = designed();
    const v = versionsOf(guide);
    expect(v.map((x) => [x.version, x.style, x.template, x.hero, x.refresh, x.entries.length])).toEqual([[1, 'collage', 'express', 'book', false, 2], [2, 'typo', 'proof', 'bundle', true, 1]]);
    const kept = versionsOf({ ...guide, version: 3 });
    expect(kept.at(-1)).toMatchObject({ version: 3, style: 'typo', template: 'proof', day: null, entries: [] });
    expect(versionsOf({ ...guide, designLog: undefined, design: { ...guide.design!, style: undefined } }).map((x) => [x.version, x.style])).toEqual([[1, 'bauhaus'], [2, 'bauhaus']]);
  });
  it('the cover of a version sits beside the guide\'s own', () => {
    expect(coverPathOf({ id: 'prd_9', files: { pdf: null, cover: 'files/prd_9/v3/cover.svg', salesPage: null } }, 1)).toBe('files/prd_9/v1/cover.svg');
    expect(coverPathOf({ id: 'prd_9', files: { pdf: null, cover: null, salesPage: null } }, 2)).toBe('files/prd_9/v2/cover.svg');
  });
  it('a gallery tile without the server\'s word: the same reading as api/views.ts', () => {
    const { guide } = designed();
    expect(lookAt(guide, { version: 1 }, true)).toEqual({ style: 'collage', template: 'express', hero: 'book', version: 1 });
    expect(tileLookOf({ kind: 'cover', path: 'files/x/v2/cover.svg', title: '', day: 20 }, guide)).toEqual({ style: 'typo', version: 2 });
    expect(tileLookOf({ kind: 'ad_preview', path: 'files/x/ads/c/preview.html', title: '', day: 30 }, guide, 5)).toMatchObject({ style: 'collage' });
    expect(tileLookOf({ kind: 'report', path: 'brain/x.md', title: '', day: 3 }, guide)).toBeUndefined();
  });
  it('a page test alternates from its first day, its own page first', () => {
    expect([22, 23, 24].map((d) => variantOn({ day: 22, variants: ['proof', 'inside'] }, d))).toEqual(['proof', 'inside', 'proof']);
  });
  it('the whole log of the product view, and what the stream learned since', () => {
    const late: DesignLogEntry = { day: 30, version: 2, style: 'typo', template: 'inside', hero: 'bundle', why: 'le gabarit « Feuilletage » gagne' };
    expect(mergedLog(LOG, [LOG[2]!, late])).toEqual([...LOG, late]);
    expect(mergedLog(undefined, [late])).toEqual([late]);
    const { guide } = designed();
    const card = { ...guide, designLog: [LOG[2]!, late], salesPage: { template: 'inside', hero: 'bundle' } as Product['salesPage'] };
    const shown = productForLooks(card, { ...guide, designLog: LOG });
    expect(shown?.designLog).toHaveLength(4);
    expect(shown?.salesPage?.template).toBe('inside');
    expect(productForLooks(undefined, guide)).toBe(guide);
  });
});

describe('Galerie', () => {
  const serve = (o: object) => { detail.data = o; };
  const tile = (o: object) => ({ id: 't', kind: 'cover', title: 'Couverture « Dodo » (v2, refonte)', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/cover.svg', createdBy: 'zoe', day: 20, quality: 80, ...o });

  it('each tile says its style in French; a page adds its template and its hero', () => {
    serve({ items: [tile({ look: { style: 'typo', version: 2 } }), tile({ id: 'p', kind: 'sales_page', path: 'files/prd_1/v2/sales-page.html', look: { style: 'collage', template: 'editorial', hero: 'spread', version: 2 } })], total: 2, counts: { cover: 1, sales_page: 1 }, styles: { typo: 1, collage: 1 } });
    const html = render(designed().s, <GalleryTab onClose={noop} />);
    detail.data = null;
    const t = text(html);
    for (const label of ['Typo XXL', 'Papier découpé', 'Éditoriale', 'Double page']) expect(t).toContain(label);
    expect(t).not.toMatch(RAW);
    expect(html).toContain('class="tile-versions">v2<');
  });
  it('a cover opens the guide\'s looks, version by version; a sales page stays a new-tab link', () => {
    serve({ items: [tile({ look: { style: 'typo', version: 2 } }), tile({ id: 'p', kind: 'sales_page', path: 'files/prd_1/v2/sales-page.html' })], total: 2, counts: {} });
    const html = render(designed().s, <GalleryTab onClose={noop} />);
    detail.data = null;
    expect(html).toMatch(/<button type="button" class="tile" data-viewer="looks"/);
    expect(html).toMatch(/<a class="tile" href="\/runs\/[^"]*sales-page\.html" target="_blank"/);
  });
  it('a filter by style, with the run\'s count of each, asked of the server as `style:<id>`', () => {
    serve({ items: [tile({ look: { style: 'typo' } })], total: 1, counts: { cover: 1 }, styles: { typo: 5, aura: 2 } });
    const html = render(designed().s, <GalleryTab onClose={noop} />);
    detail.data = null;
    expect(text(html)).toMatch(/Style Tous Typo XXL 5 Aura 2/);
    expect(galleryPath(['pdf', 'cover'], 1)).toBe('/api/deliverables?page=1&kinds=pdf,cover');
    expect(galleryPath(['cover'], 2, 'aura')).toBe('/api/deliverables?page=2&kinds=cover,style:aura');
  });
  it('without the server, the snapshot\'s guides give the looks, and an old run shows Bauhaus only', () => {
    const { s, guide } = designed();
    const old: CompanySnapshot = { ...s, company: { ...s.company, deliverables: [{ ...tile({}), id: 'local', kind: 'cover', path: `files/${guide.id}/v1/cover.svg`, title: 'Couverture (v1)', productId: guide.id } as never] } };
    expect(text(render(old, <GalleryTab onClose={noop} />))).toContain('Papier découpé');
    const v1 = mockSnapshot();
    const bare: CompanySnapshot = { ...v1, company: { ...v1.company, deliverables: [{ ...tile({}), id: 'local', productId: v1.company.products[0]!.id, path: 'files/prd_1/v1/cover.svg', title: 'Couverture (v1)' } as never] } };
    expect(text(render(bare, <GalleryTab onClose={noop} />))).toMatch(/Style Tous Bauhaus 1/);
  });
});

describe('Produits', () => {
  it('a card shows its style, its page and its hero, the page test running, and the last reason', () => {
    const { s } = designed();
    const html = render(s, <ProductsTab onClose={noop} />);
    const t = text(html);
    for (const label of ['Typo XXL', 'Mur d’avis', 'Le pack', 'Test de page : Mur d’avis ↔ Feuilletage', 'Look v2, J20 :', 'Refonte J20']) expect(t).toContain(label);
    expect(html).toContain('data-viewer="page"');
    expect(html).toContain('data-viewer="looks"');
    expect(t).not.toMatch(RAW);
  });
  it('the pill names the page of the day first', () => {
    const e = { day: 22, variants: ['proof', 'inside'] } as Experiment;
    expect(pageTestPill(e, 23)).toBe('Test de page : Feuilletage ↔ Mur d’avis');
  });
  it('an old guide reads Bauhaus and « Classique », a guide still in writing nothing, and the demo opens no viewer', () => {
    const s = mockSnapshot();
    const t = text(render(s, <ProductsTab onClose={noop} />));
    expect(t).toContain('Bauhaus');
    expect(t).toContain('Classique');
    const writing = s.company.products.find((p) => !p.design && !p.files?.cover)!;
    expect(lookOf(writing).style).toBeNull();
    const demo = render(s, <ProductsTab onClose={noop} />, { demo: true });
    expect(demo).not.toContain('data-viewer="page"');
    expect(demo).not.toContain('data-viewer="looks"');
  });
});

describe('the design of a guide, in its viewer', () => {
  it('its looks version by version, covers side by side, each with the agent\'s reason; its page tests', () => {
    const { s, guide } = designed();
    const html = render(s, <DesignStory product={guide} experiments={s.company.experiments} day={26} />);
    expect(html.indexOf('/v1/cover.svg')).toBeGreaterThan(0);
    expect(html.indexOf('/v1/cover.svg')).toBeLessThan(html.indexOf('/v2/cover.svg'));
    const t = text(html);
    for (const words of ['Papier découpé : convention du genre', 'gagne le test A/B', 'Refonte v2 : style « Typo XXL »', 'Refonte', 'Aujourd’hui', 'Tests de page', 'aujourd’hui « Mur d’avis »']) expect(t).toContain(words);
    expect(t).not.toMatch(RAW);
  });
  it('a guide from before looks says so, and still shows each version\'s cover', () => {
    const p = mockSnapshot().company.products[0]!;
    const t = text(render(mockSnapshot(), <DesignStory product={p} experiments={[]} day={20} />));
    expect(t).toContain('il porte le Bauhaus de la V1');
    expect(render(mockSnapshot(), <DesignStory product={p} experiments={[]} day={20} />)).toContain(`${p.id}/v1/cover.svg`);
  });
  it('the whole log comes from GET /api/product; the page tab shows the page in the app, phone first', () => {
    const { s, guide } = designed();
    detail.paths.length = 0;
    detail.data = { ...guide, designLog: [{ day: 1, version: 1, style: 'riso', why: 'Risographie : le tout premier look' }, ...LOG] };
    const looks = render(s, <LooksLightbox productId={guide.id} onClose={noop} />);
    expect(detail.paths).toContain(`/api/product/${guide.id}`);
    expect(text(looks)).toContain('Risographie : le tout premier look');
    const page = render(s, <LooksLightbox productId={guide.id} initial="page" onClose={noop} />);
    detail.data = null;
    expect(page).toMatch(/<iframe [^>]*src="\/runs\/[^"]*\/v2\/sales-page\.html"[^>]*sandbox="allow-scripts allow-same-origin allow-modals"/);
    expect(page).not.toMatch(/allow-(forms|popups|top-navigation)/);
    expect(page).toMatch(/width:375px/);
    expect(text(page)).toMatch(/Téléphone · 375 px .*Ordinateur · 1 280 px/);
  });
  it('the page viewer: real CSS widths, scaled down to the stage, never up', () => {
    expect(pageFit('phone', { w: 1200, h: 900 })).toEqual({ scale: 1, width: 375, height: 812 });
    expect(pageFit('phone', { w: 300, h: 600 })).toEqual({ scale: 0.8, width: 375, height: 750 });
    expect(pageFit('desktop', { w: 1000, h: 700 })).toEqual({ scale: 0.78125, width: 1280, height: 896 });
    expect(pageFit('desktop', null)).toMatchObject({ scale: 1, width: 1280 });
    expect(renderToStaticMarkup(<SalesPageViewer url="/runs/r/p.html" title="Page" initial="desktop" />)).toMatch(/aria-selected="true" data-device="desktop"/);
  });
});

describe('Apprentissage: the design bandits', () => {
  it('niche by niche: each arm in French, its estimated conversion and its days, the favourite crowned', () => {
    const { s, niche } = designed();
    const html = render(s, <LearningTab onClose={noop} />);
    const section = text(html.slice(html.indexOf('design-niches')));
    expect(section).toContain(s.company.research.trends[0]!.name);
    for (const words of ['Style de couverture', 'Gabarit de page', 'Visuel de page', 'favori : Typo XXL', 'Papier découpé', 'Mur d’avis', 'Le pack', '9 j']) expect(section).toContain(words);
    expect(section).toContain('2,4 %'); // 6 / 20 × 8 %
    expect(html).toMatch(/arm design-arm arm-best"><span class="arm-label"[^>]*><svg[^>]*>.*?<\/svg>Typo XXL/);
    expect(text(html)).not.toContain(`cover_style`);
    expect(designBandits(s.company.bandits).map((n) => n.nicheId)).toEqual([niche]);
  });
  it('page tests sit under their niche, with their result', () => {
    const { s } = designed({ test: { status: 'concluded', winner: 'inside', endDay: 34 } });
    const section = text(render(s, <LearningTab onClose={noop} />));
    expect(section).toMatch(/Tests de gabarit · 1/);
    expect(section).toContain('« Feuilletage » gagne : la page le garde.');
    expect(section).toContain('Gabarit de page'); // the experiment list too
    expect(section).not.toMatch(RAW);
  });
  it('god mode only: the market\'s true taste beside each arm, and whether the agents found it', () => {
    const { s } = designed({ taste: true });
    const god = text(render(s, <LearningTab onClose={noop} />, { godMode: true }));
    expect(god).toContain('Vérité du marché');
    expect(god).toContain('style « Aura » ×1,14 (les agents misent sur « Typo XXL »)');
    expect(god).toContain('×0,97');
    const plain = text(render(s, <LearningTab onClose={noop} />));
    expect(plain).not.toContain('Vérité du marché');
    expect(plain).not.toContain('×1,14');
  });
  it('an old run: one plain sentence, no empty grid', () => {
    const t = text(render(mockSnapshot(), <LearningTab onClose={noop} />));
    expect(t).toContain('Pas encore de données de design');
  });
  it('favourite and truth, read as the bandit and the market hold them', () => {
    const arms = designBandits({ 'cover_style:n': [arm('pop', 1, 3, 0), arm('aura', 2, 2, 0)] })[0]!.kinds.style!;
    expect(arms.map((a) => [a.label, a.cvr])).toEqual([['Aura', 0.5 * LOOK_CVR_SCALE], ['Pop', 0.25 * LOOK_CVR_SCALE]]);
    expect(favouriteOf(arms)).toMatchObject({ arm: { key: 'aura' }, measured: false });
    expect(truthOf(designed({ taste: true }).s.godMode!.niches[0]!.visualTaste, 'template')?.best).toBe('inside');
    expect(truthOf(undefined, 'style')).toBeNull();
  });
});

describe('the feed and the digest read a design line in words', () => {
  it('a cover line: its style\'s label, its layout and motif in French, no hex code', () => {
    const line = readableLine('Zoé choisit le style « Ligne claire » : convention du genre (couverture split, motif leaf, palette #f472b6, 84/100)');
    expect(line).toBe('Zoé choisit le style « Ligne claire » : convention du genre (couverture « Affiche », motif feuille, 84/100)');
    expect(readableLine('Zoé : couverture minimal, motif moon, palette #5b4bd6')).toBe('Zoé : couverture « Épurée », motif lune');
  });
  it('an id after its cue word or alone between guillemets becomes its label; a word of the sentence stays', () => {
    expect(readableLine('la page passe en gabarit editorial, style aura, visuel bundle')).toBe('la page passe en gabarit « Éditoriale », style « Aura », visuel « Le pack »');
    expect(readableLine('le look « riso » sur cover_style:nch_1')).toBe('le look « Risographie » sur style de couverture');
    expect(readableLine('Il aura un trait de génie : « question »')).toBe('Il aura un trait de génie : « question »');
  });
  it('the feed prints it so', () => {
    const s = mockSnapshot();
    const a: Activity = { id: 'act_d', day: 4, tick: 3, at: 1, agentId: 'zoe', kind: 'thought', text: 'Zoé choisit le style « Pop » : pari du bandit (couverture split, motif paw, palette #ff00aa, 77/100)' };
    const t = text(render(s, <ActivityFeed />, { activity: [a] }));
    expect(t).toContain('couverture « Affiche », motif patte, 77/100');
    expect(t).not.toContain('#ff00aa');
  });
  it('the digest prints its « Design » block when the server sends one, nothing otherwise', () => {
    const digest = { fromDay: 10, toDay: 16, headline: 'Profit de 10 € en 7 jours.', money: { revenue: 0, refunds: 0, adSpend: 0, costs: 0, profit: 10, cashStart: 0, cashEnd: 10, previousProfit: null }, stage: { from: 'survie', to: 'survie', changes: [] }, products: { launched: [], stopped: [], reworked: [], best: null, worst: null }, audience: { size: 0, added: 0, unsubscribed: 0, revenue: 0 }, people: { hired: [], left: [], headFrom: 8, headTo: 8 }, channels: { opened: [], closed: [], best: null }, highlights: [], decisions: [], mistakes: [], incidents: [], waiting: [], next: [] } as FounderDigest;
    const lines = ['Test de page sur « Dodo » : « Feuilletage » gagne (« Mur d’avis » 2,4 % sur 380 visites, « Feuilletage » 3,1 % sur 420 visites)', '« Dodo » change de look (v2) : Refonte v2 : style « Typo XXL » au lieu de « Papier découpé »'];
    const html = render(mockSnapshot(), <FounderDigestBody data={{ ...digest, design: lines } as FounderDigest} onEntry={noop} onTasks={noop} />);
    expect(text(html)).toContain('Design');
    for (const l of lines) expect(text(html)).toContain(l);
    expect(designLines(digest)).toEqual([]);
    expect(text(render(mockSnapshot(), <FounderDigestBody data={digest} onEntry={noop} onTasks={noop} />))).not.toMatch(/\bDesign\b/);
  });
});
