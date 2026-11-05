/**
 * The templated sales pages (design plan D202, D208, acceptance E7 and E11): six templates and five heroes from one
 * section library, the law in every one of them, under 900 kB, no request, the V1 page untouched, same product same bytes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ClaudeClientLike } from '../src/minds/claude/engine.js';
import { renderCoverSvg } from '../src/deliverables/cover.js';
import { normalizeDesign, PALETTES } from '../src/deliverables/design.js';
import { contrast } from '../src/deliverables/color.js';
import { demoContent, demoProduct, demoSalesPage } from '../src/deliverables/fixture.js';
import { renderSalesPageHtml } from '../src/deliverables/index.js';
import { previewsOf } from '../src/deliverables/pages/render.js';
import { layoutPdf } from '../src/deliverables/pdf.js';
import { MAX_PAGE_BYTES, noFalseUrgency, pairsOf, priceDrop, priceDropPrint, tokensOf } from '../src/deliverables/sales/index.js';
import { REVIEWS_VERIFIED } from '../src/deliverables/sales/law.js';
import { heuristicSalesPage } from '../src/minds/heuristic/commerce.js';
import { createContentEngine } from '../src/minds/index.js';
import { seededRng } from '../src/minds/util.js';
import type { MindContext } from '../src/contracts.js';
import { ART_STYLES, PAGE_HEROES, PAGE_TEMPLATES, type ArtStyle, type DesignSpec, type PageHero, type PageTemplate, type Product, type SalesPage } from '../src/shared.js';

const BANNER = '<div class="demo-banner">Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel</div>';
const CHECKOUT = 'Boutique virtuelle : paiement simulé — environnement de test Pixel Agency';
const plain = (s: string): string => s.replace(/[  ]/g, ' ');
const noFonts = (s: string): string => s.replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,');

const design = normalizeDesign(demoProduct.design);
const brand = 'Pixel Agency';
const guide = layoutPdf({ product: demoProduct, content: demoContent, design, brand });
const PREVIEWS = previewsOf(guide);
const COVER = renderCoverSvg({ title: demoProduct.title, subtitle: demoContent.subtitle, audience: demoProduct.audience, design, brand });
const review = (i: number, rating: 1 | 2 | 3 | 4 | 5, text: string): Product['stats']['reviews'][number] => ({ id: `rev_${i}`, day: i, customerId: `cus_${i}`, rating, text });
const REVIEWS = [
  review(9, 5, 'Le carnet de réveils m’a ouvert les yeux.'), review(11, 4, 'Très concret, le palier de la main a été dur.'),
  review(12, 5, 'On est passés de 5 réveils à 1 seul.'), review(14, 4, 'Bien écrit, sans culpabiliser les parents.'),
  review(18, 3, 'Utile, mais peu de cas pour les bébés allaités.'), review(21, 5, 'Simple, sans culpabiliser.'),
];
const COPY: SalesPage = heuristicSalesPage({ product: demoProduct, content: demoContent, voc: { nicheId: 'n', depth: 'deep', pains: demoSalesPage.painBullets, phrases: demoSalesPage.painBullets, objections: [], desiredOutcomes: ['des nuits de 6 heures', 'un coucher sans pleurs'], knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [19], bannedClaims: [] }, hype: 0.4 }, seededRng(1, 'page'), { maxHype: null, banned: [], brand });

const product = (over: Partial<Product> = {}): Product => ({
  ...demoProduct, content: demoContent, design, price: 19,
  stats: { ...demoProduct.stats, reviews: REVIEWS, rating: 4.3, ratingCount: 6 }, priceHistory: [{ day: 6, price: 19 }], pdfFacts: { pages: guide.pages.length, sheets: 0 }, ...over,
});

const page = (template: PageTemplate, o: { hero?: PageHero; style?: ArtStyle; over?: Partial<Product>; previews?: { label: string; svg: string }[]; sp?: Partial<SalesPage>; offSale?: boolean; day?: number; cover?: string; figureSvg?: string | null } = {}): string => {
  const p = product(o.over);
  return renderSalesPageHtml({
    product: p, salesPage: { ...COPY, ...o.sp, template, ...(o.hero ? { hero: o.hero } : {}) }, coverSvg: o.cover ?? COVER,
    design: { ...design, style: o.style ?? 'bauhaus' } as DesignSpec, brand, previews: o.previews ?? PREVIEWS,
    ...(o.offSale ? { offSale: true } : {}), ...(o.day !== undefined ? { day: o.day } : {}), ...(o.figureSvg !== undefined ? { figureSvg: o.figureSvg } : {}),
  });
};

const heroOf = (html: string): string => /<section class="hero[^"]*">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
const sectionsOf = (html: string): string[] => [...(/<main id="top">([\s\S]*)<\/main>/.exec(html)?.[1] ?? '').matchAll(/<section class="([^"]*)"/g)].map((m) => m[1]!.trim().split(/\s+/)[0]!);

describe('every template renders a whole page', () => {
  it('renders and parses: one document, balanced sections and drawings, no hole in the text', () => {
    for (const template of PAGE_TEMPLATES) {
      for (const hero of PAGE_HEROES) {
        const html = page(template, { hero });
        expect(html.startsWith('<!doctype html>'), template).toBe(true);
        expect(html.trimEnd().endsWith('</html>')).toBe(true);
        for (const tag of ['section', 'svg', 'figure', 'main', 'ul', 'ol', 'details', 'button', 'header', 'footer']) {
          expect((html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length, `${template}/${hero} <${tag}>`).toBe((html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length);
        }
        expect(noFonts(html)).not.toMatch(/undefined|NaN|\[object Object\]|null €/);
        expect(html).toContain(`class="t-${template} s-bauhaus`);
      }
    }
  });

  it('the six are different in structure: their sequences of sections differ, each with its own signature', () => {
    const seq = Object.fromEntries(PAGE_TEMPLATES.map((t) => [t, sectionsOf(page(t)).join(' > ')]));
    expect(new Set(Object.values(seq)).size).toBe(PAGE_TEMPLATES.length);
    expect(seq.express).toMatch(/^hero > benefits > pages/);
    expect(seq.editorial).toMatch(/story.*pains.*solution.*toc/);
    expect(page('editorial')).toMatch(/<span class="pnum">p\. \d+<\/span>/);
    expect(seq.inside).toMatch(/^hero > i-gallery > i-fill/);
    expect(seq.creator).toMatch(/^hero > letter > for/);
    expect(seq.proof).toMatch(/^hero > p-wall/);
    expect(seq.value).toMatch(/bento-sec > compare > offer-sec/);
  });

  it('the page wears the guide’s art direction: eight skins, eight different decors', () => {
    const css = ART_STYLES.map((style) => /<style>([\s\S]*?)<\/style>/.exec(page('express', { style }))![1]!.replace(/@font-face[^}]*}/g, ''));
    expect(new Set(css).size).toBe(ART_STYLES.length);
    expect(page('express', { style: 'pop' })).toContain('--sh:6px 6px 0 var(--ink)');
    expect(page('express', { style: 'aura' })).toContain('backdrop-filter');
    expect(page('express', { style: 'collage' })).toMatch(/feTurbulence/);
    expect(page('express', { style: 'riso' })).toMatch(/radial-gradient\(circle at center/);
    // absent: the Bauhaus look of V1
    const bare = renderSalesPageHtml({ product: product(), salesPage: { ...COPY, template: 'express' }, coverSvg: COVER, design, brand, previews: PREVIEWS });
    expect(bare).toContain('s-bauhaus');
  });

  it('five heroes, each from the real cover and the real pages; one whose needs fail stands back to the book', () => {
    for (const hero of PAGE_HEROES) {
      const html = heroOf(page('express', { hero, previews: [...PREVIEWS, { label: 'Fiche à imprimer', svg: PREVIEWS[1]!.svg }] }));
      expect(html, hero).toContain(`scene scene-${hero}`);
      expect(html).toContain('<use href="#cover-art"/>');
    }
    expect(heroOf(page('express', { hero: 'devices', previews: [] }))).toContain('scene scene-book');
    expect(heroOf(page('express', { hero: 'spread', previews: [] }))).toContain('scene scene-book');
    expect(heroOf(page('inside', { hero: 'devices' }))).toMatch(/<use href="#pg-\d"\/>/);
  });

  it('a kit and a page off sale render too, and the off-sale one sells nothing', () => {
    const kit = page('express', { over: { kind: 'kit' } });
    expect(plain(kit)).toContain('Obtenir le kit');
    for (const template of PAGE_TEMPLATES) {
      const off = plain(page(template, { offSale: true }));
      expect(off).toContain(`Ce guide n’est plus en vente.`);
      expect(off).not.toMatch(/data-buy|<script|class="sticky-buy"|Garantie commerciale/);
      expect(off).toContain(BANNER);
    }
  });
});

describe('nothing leaves the file (E7)', () => {
  it('no request: no http outside the SVG namespace, no source, no link, only data URIs and anchors', () => {
    for (const template of PAGE_TEMPLATES) {
      for (const style of ART_STYLES) {
        const html = page(template, { style, hero: PAGE_HEROES[ART_STYLES.indexOf(style) % PAGE_HEROES.length] });
        const bare = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', '').replace(/url\(data:[^)]*\)/g, 'url()');
        expect(bare, `${template}/${style}`).not.toMatch(/https?:|\/\/[a-z0-9-]+\.[a-z]/i);
        expect(html).not.toMatch(/<(?:link|img|iframe|object|embed|video|audio)\b|@import|\ssrc\s*=/i);
        for (const u of html.match(/url\([^)]*\)/g) ?? []) expect(u).toMatch(/^url\((?:data:|#)/);
        for (const href of html.match(/\bhref="[^"]*"/g) ?? []) expect(href).toMatch(/^href="#/);
        expect(html).toContain(BANNER);
        expect(html).toContain(CHECKOUT);
        expect(html).toContain('Aucune donnée bancaire n’est collectée.');
      }
    }
  });

  it('every picture says what it shows', () => {
    const html = page('inside', { hero: 'devices' });
    for (const m of html.matchAll(/<(?:svg|figure)\b[^>]*role="img"[^>]*>/g)) expect(m[0]).toMatch(/aria-label="[^"]{8,}"/);
    expect(plain(heroOf(html))).toMatch(/<figure class="scene scene-devices" role="img" aria-label="Le guide « .+ » en volume, avec une tablette et un téléphone/);
    expect(plain(html)).toMatch(/aria-label="Aperçu du guide : /);
  });

  it('at most 900 kB, whatever the guide weighs: fewer pages first, then the figure, then the extra faces', () => {
    const blob = (kb: number, label: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"><path aria-label="${label}" d="${'M1 1h1v1z'.repeat(kb * 100)}"/></svg>`;
    const heavy = ['Ouverture de chapitre', 'Page du guide', 'Fiche à imprimer', 'Schéma', 'Votre plan', 'Le plan à cocher'].map((label) => ({ label, svg: blob(240, label) }));
    for (const template of PAGE_TEMPLATES) {
      const html = page(template, { previews: heavy, cover: blob(190, 'Couverture'), figureSvg: blob(280, 'Votre plan') });
      expect(Buffer.byteLength(html), template).toBeLessThanOrEqual(MAX_PAGE_BYTES);
      expect(html).toContain('data-hero-buy');
    }
    for (const template of PAGE_TEMPLATES) expect(Buffer.byteLength(page(template))).toBeLessThanOrEqual(MAX_PAGE_BYTES);
  });

  it('same product, same bytes', () => {
    for (const template of PAGE_TEMPLATES) expect(createHash('sha1').update(page(template, { style: 'riso', hero: 'desk' })).digest('hex')).toBe(createHash('sha1').update(page(template, { style: 'riso', hero: 'desk' })).digest('hex'));
  });
});

describe('the first screen (E7)', () => {
  it('holds the title, the product picture, the price, the rating or « nouveau », and the button', () => {
    for (const template of PAGE_TEMPLATES) {
      for (const reviews of [REVIEWS, []]) {
        const hero = plain(heroOf(page(template, { over: { stats: { ...demoProduct.stats, reviews, rating: reviews.length ? 4.3 : 0, ratingCount: reviews.length } } })));
        expect(hero, template).toMatch(/<h1[^>]*>Bébé se réveille toutes les 2 heures<\/h1>/);
        expect(hero).toMatch(/<figure class="scene scene-[a-z]+" role="img"/);
        expect(hero).toContain('<span class="price">19 €</span>');
        expect(hero).toMatch(reviews.length ? /aria-label="4,3 sur 5"/ : /Nouveau/);
        expect(hero).toContain('data-hero-buy');
      }
    }
  });
});

describe('the law (D208, E11)', () => {
  it('reviews say how they are verified; none is invented, and none shown says so', () => {
    for (const template of PAGE_TEMPLATES) {
      const html = plain(page(template));
      expect(html, template).toContain(plain(REVIEWS_VERIFIED));
      expect(html).toContain('Acheteur vérifié');
      const none = plain(page(template, { over: { stats: { ...demoProduct.stats, reviews: [], rating: 0 } } }));
      expect(none).toContain('Nous n’affichons jamais de faux témoignages.');
      expect(none).not.toContain('<article class="review');
    }
  });

  it('the guarantee is a commercial guarantee, and the FAQ says the download waives the withdrawal right with express consent', () => {
    for (const template of PAGE_TEMPLATES) {
      const html = plain(page(template));
      expect(html, template).toContain('<h2>Garantie commerciale</h2>');
      expect(html).toContain('Elle s’ajoute à vos droits et ne les remplace pas.');
      expect(html).toContain('Et le droit de rétractation de 14 jours ?');
      expect(html).toMatch(/votre accord exprès au moment de payer : en le donnant, vous renoncez au droit de rétractation de 14 jours/);
    }
  });

  it('no countdown, no false scarcity, whatever the copy says', () => {
    const pushy: Partial<SalesPage> = {
      headline: 'Offre limitée : plus que 3 exemplaires ! Retrouvez vos nuits.', solution: `${COPY.solution} Dépêchez-vous, l’offre expire ce soir.`,
      cta: 'Je profite de l’offre limitée', benefits: ['Des nuits de 6 heures', 'Plus que 2 places disponibles'],
    };
    for (const template of PAGE_TEMPLATES) {
      const html = plain(page(template, { sp: pushy }));
      expect(html, template).not.toMatch(/plus que \d|offre limitée|expire ce soir|Dépêchez-vous|compte à rebours|countdown|setInterval/i);
      expect(html).toContain('Retrouvez vos nuits.');
    }
    expect(noFalseUrgency('Une méthode douce. Plus que 3 places ! Elle marche.')).toBe('Une méthode douce. Elle marche.');
    expect(noFalseUrgency('Une méthode douce, pas à pas.')).toBe('Une méthode douce, pas à pas.');
  });

  it('a crossed-out price only when the price really dropped, against the lowest price of the 30 days before (L112-1-1)', () => {
    const dropped = { priceHistory: [{ day: 6, price: 24 }, { day: 46, price: 19 }], price: 19 };
    const value = plain(page('value', { over: dropped, day: 50 }));
    expect(value).toMatch(/<span class="price-was"[^>]*>24 €<\/span><span class="price-cut">−21 %<\/span>/);
    expect(value).toContain('Prix barré : le prix le plus bas pratiqué pendant les 30 jours qui ont précédé la baisse.');
    // a price test that alternates is no reduction; a rise is none; a drop older than 30 days is no longer announced
    expect(plain(page('value', { over: { priceHistory: [{ day: 1, price: 19 }, { day: 2, price: 24 }, { day: 3, price: 19 }], price: 19 } }))).not.toContain('class="price-was"');
    expect(plain(page('value', { over: { priceHistory: [{ day: 1, price: 14 }, { day: 9, price: 19 }], price: 19 } }))).not.toContain('class="price-was"');
    expect(plain(page('value', { over: dropped, day: 80 }))).not.toContain('class="price-was"');
    // only `value` crosses a price out
    for (const template of PAGE_TEMPLATES.filter((t) => t !== 'value')) expect(page(template, { over: dropped, day: 50 }), template).not.toContain('class="price-was"');
  });

  it('the 30-day reference: the lowest price applied during the 30 days before the first of successive reductions', () => {
    expect(priceDrop([], 19)).toBeNull();
    expect(priceDrop([{ day: 1, price: 19 }], 19)).toBeNull();
    expect(priceDrop([{ day: 1, price: 24 }, { day: 20, price: 19 }], 24)).toBeNull(); // the history does not hold this price as the last one
    expect(priceDrop([{ day: 1, price: 24 }, { day: 40, price: 19 }], 19)).toEqual({ was: 24, since: 40, pct: 21 });
    // a lower price inside the window is the reference
    expect(priceDrop([{ day: 1, price: 29 }, { day: 20, price: 22 }, { day: 30, price: 29 }, { day: 40, price: 24 }], 24)).toBeNull();
    expect(priceDrop([{ day: 1, price: 29 }, { day: 5, price: 22 }, { day: 6, price: 29 }, { day: 45, price: 24 }], 24)).toEqual({ was: 29, since: 45, pct: 17 });
    // successive reductions: taken before the first one, the percentage on that reference
    expect(priceDrop([{ day: 1, price: 29 }, { day: 40, price: 24 }, { day: 50, price: 19 }], 19)).toEqual({ was: 29, since: 50, pct: 34 });
    // reductions far apart are two reductions: the second one's reference is the price before it
    expect(priceDrop([{ day: 1, price: 29 }, { day: 40, price: 24 }, { day: 100, price: 19 }], 19)).toEqual({ was: 24, since: 100, pct: 21 });
    // the same day set twice counts once, its last price
    expect(priceDrop([{ day: 1, price: 24 }, { day: 40, price: 29 }, { day: 40, price: 19 }], 19)).toEqual({ was: 24, since: 40, pct: 21 });
    expect(priceDrop([{ day: 1, price: 24 }, { day: 40, price: 19 }], 19, 69)).not.toBeNull();
    expect(priceDrop([{ day: 1, price: 24 }, { day: 40, price: 19 }], 19, 70)).toBeNull();
    expect(priceDropPrint([{ day: 1, price: 24 }, { day: 40, price: 19 }], 19, 50)).toBe('24|40');
    expect(priceDropPrint([{ day: 1, price: 24 }, { day: 40, price: 19 }], 19, 70)).toBe('');
  });
});

describe('contrast (E7): every text reads at 4.5:1 at least', () => {
  it('on every ground, for every palette and every art direction', () => {
    for (const p of PALETTES) {
      for (const style of ART_STYLES) {
        const d = normalizeDesign({ ...design, palette: p.palette, inks: p.inks, family: p.family });
        for (const pair of pairsOf(tokensOf(d, style))) expect(contrast(pair.fg, pair.bg), `${p.name} / ${style} : ${pair.what}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('the V1 page is untouched', () => {
  // the bytes of the V1 page, taken at 17a0c3c before package P touched anything, then once more for the law's words of D208 alone:
  // the guarantee says it is commercial and only where the copy states one, the reviews say how they are verified
  const SVG = (label: string, w = 595, h = 842): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path aria-label="${label}" d="M0 0h${w}v${h}h-${w}Z" fill="#f4ecdf"/><path d="M40 60h300v24h-300Z" fill="#27357a"/></svg>`;
  const V1_PREVIEWS = ['Couverture', 'Page du guide', 'Ouverture de chapitre', 'Fiche à imprimer', 'Schéma', 'Votre plan'].map((label) => ({ label, svg: SVG(label) }));
  const KIT_PREVIEWS = ['Couverture', 'Le contenu du kit', 'Fiche à imprimer', 'Le plan à cocher'].map((label) => ({ label, svg: SVG(label) }));
  const V1_COVER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 848" width="600" height="848" role="img" aria-label="Couverture"><path d="M0 0h600v848h-600Z" fill="#f4ecdf"/><path d="M300 548h300v300h-300Z" fill="#f5c971"/></svg>';
  const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300"><path aria-label="Votre plan" d="M0 0h480v300h-480Z" fill="#eee"/></svg>';
  const DESIGN = {
    palette: { bg: '#1f2a4d', primary: '#2e4272', secondary: '#8fa8d8', accent: '#f6b48f', ink: '#1b2238', soft: '#eef2fb' },
    motif: 'moon', coverLayout: 'split', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 42, family: 'parentalite', voice: 'conte',
    inks: { paper: '#f4ecdf', ink: '#131a3b', a: '#27357a', b: '#ee7a5b', c: '#f5c971' },
  } as unknown as DesignSpec;
  const base = { product: { ...demoProduct, content: demoContent, design: DESIGN }, salesPage: demoSalesPage, coverSvg: V1_COVER, design: DESIGN, brand: 'Pixel Agency' };
  const CASES: Record<string, [Parameters<typeof renderSalesPageHtml>[0], string]> = {
    guide: [{ ...base, previews: V1_PREVIEWS, figureSvg: FIGURE }, 'f99c46a778a9cb3201209ce77cb4cd68e946b87a'],
    minimal: [{ ...base, design: { ...DESIGN, coverLayout: 'minimal' }, previews: V1_PREVIEWS, figureSvg: FIGURE }, '7dc11ffe03ebbf90cf3fb57b82bd73d16764356d'],
    alone: [{ ...base, figureSvg: null }, 'bc78627e94f6939c779a578936cbde049f7e315b'],
    kit: [{ ...base, product: { ...base.product, kind: 'kit' }, previews: KIT_PREVIEWS, figureSvg: null }, '08ff485de60b8da2ff7792d907659c9ec624073c'],
    offSale: [{ ...base, previews: V1_PREVIEWS, figureSvg: FIGURE, offSale: true }, '16986bdb2f8796d2ebede059fe8349b9d062b30a'],
    killed: [{ ...base, product: { ...base.product, status: 'killed' }, previews: V1_PREVIEWS, figureSvg: null }, '6f45c97612cbbc28fa03622404231976c658f1aa'],
    repriced: [{ ...base, product: { ...base.product, price: 24 }, salesPage: { ...demoSalesPage, cta: 'Je commence ce soir — 19 €', priceWritten: 19, solution: `${demoSalesPage.solution} Pour 19 € seulement.` }, previews: V1_PREVIEWS, figureSvg: FIGURE }, 'ff2b8e643630eedcda0d46064374443a078522e5'],
    noReviews: [{ ...base, product: { ...base.product, stats: { ...demoProduct.stats, rating: 0, reviews: [] } }, previews: V1_PREVIEWS.slice(0, 3), figureSvg: null }, '65da548ecba55a1ef97794875503a00c222f5eec'],
  };

  it('without a template, byte for byte as at 17a0c3c but for the law’s words', () => {
    for (const [name, [input, sha1]] of Object.entries(CASES)) expect(createHash('sha1').update(renderSalesPageHtml(input)).digest('hex'), name).toBe(sha1);
  });

  it('a hero without a template changes nothing, and the new copy fields never reach the V1 page', () => {
    const [input] = CASES.guide!;
    const withCopy = renderSalesPageHtml({ ...input, salesPage: { ...input.salesPage, hero: 'desk', benefits: ['Un bénéfice écrit'], story: 'Une histoire écrite pour le test, assez longue pour être lue.' } });
    expect(createHash('sha1').update(withCopy).digest('hex')).toBe(CASES.guide![1]);
  });
});

describe('the copy of the new sections', () => {
  const voc = { nicheId: 'n', depth: 'deep' as const, pains: demoSalesPage.painBullets, phrases: ['on a tout essayé', 'il hurle dès que ma main quitte son dos', 'c’est normal ?'], objections: [], desiredOutcomes: ['des nuits de 6 heures', 'un coucher sans pleurs'], knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [19], bannedClaims: [] };
  const write = (o: { flaw?: number; fire?: number[] } = {}): SalesPage => heuristicSalesPage({ product: demoProduct, content: demoContent, voc, hype: 0.4 }, seededRng(5, 'page'), {
    maxHype: null, banned: [], brand, ...(o.flaw ? { flaw: o.flaw, flawRng: { ...seededRng(1, 'f'), chance: () => true } } : {}),
  });

  it('are written from the research, keyed on text: no draw, the same words twice', () => {
    const a = write();
    expect(a.benefits!.length).toBeGreaterThanOrEqual(3);
    expect(a.benefits!.length).toBeLessThanOrEqual(5);
    expect(a.forWho!.length).toBeGreaterThanOrEqual(2);
    expect(a.notFor!.length).toBeGreaterThanOrEqual(1);
    expect(a.comparison!.length).toBeGreaterThanOrEqual(3);
    expect(a.story).toMatch(/^Nous avons lu ce qu’écrivent /);
    expect(a.story).not.toMatch(/\b(je|j’|ma |mon )/i); // first person plural, no invented biography
    expect(a.benefits).toContain('Des nuits de 6 heures');
    expect(JSON.stringify(write())).toBe(JSON.stringify(a));
    // the rng is never read: another seed writes the same new sections
    const other = heuristicSalesPage({ product: demoProduct, content: demoContent, voc, hype: 0.4 }, seededRng(99, 'other'), { maxHype: null, banned: [], brand });
    expect([other.benefits, other.forWho, other.notFor, other.story, other.comparison]).toEqual([a.benefits, a.forWho, a.notFor, a.story, a.comparison]);
  });

  it('a weak writer’s flaws reach them too: no customer words, no number, no tool', () => {
    const weak = write({ flaw: 1 });
    expect(weak.story).not.toMatch(/\d+ chapitres|\d+ étapes|plan de \d+/);
    expect(weak.story).not.toContain('«');
    expect(weak.benefits!.join(' ')).not.toMatch(/plan de \d+|\d+ fiches/);
    expect(JSON.stringify(weak.forWho)).not.toContain('«');
  });

  it('the Claude writer adds them, checked, and stands back on the heuristic writer’s', async () => {
    const message = (json: unknown) => ({
      id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
      usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    const agent = {
      id: 'ag_shop_1', name: 'Inès', role: 'Responsable boutique', dept: 'boutique', isChief: true, tier: 'sonnet',
      persona: 'Précise, elle écrit court.', skills: ['Pages de vente'], tools: [], taskKinds: ['write_sales_page'],
      avatar: { skin: '#f1c27d', hair: '#3b2a1a', shirt: '#7c5cff', pants: '#333', hairStyle: 1, accessory: 'none' },
      status: 'idle', place: 'boutique', currentTaskId: null, energy: 90, level: 2, xp: 120,
      perf: { done: 4, approved: 3, rejected: 1, failed: 0, score: 72 }, bubble: null,
      roleId: 'shop_lead', gender: 'f', founder: false, hatKinds: [], hatDepts: [], hiredDay: 0, rampUntilDay: 0, notice: null,
    };
    const run = async (extra: Record<string, unknown>): Promise<SalesPage> => {
      const client: ClaudeClientLike = { messages: { create: async () => message({ ...demoSalesPage, ...extra }) as never } };
      const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 5, client, log: () => {} });
      const ctx = { agent: agent as never, playbook: [], brainNotes: [], lessons: [], day: 1, brand } as MindContext;
      return eng.writeSalesPage({ product: demoProduct, content: demoContent, voc, hype: 0.4 }, ctx);
    };
    const good = await run({ benefits: ['Des nuits plus longues', 'Un plan pour chaque soir', 'Moins de réveils'], forWho: ['vous êtes à bout', 'vous voulez un plan'], notFor: ['vous cherchez un miracle'], story: 'Nous avons écrit ce guide après avoir lu des centaines de questions de parents. Il met les conseils dans l’ordre.', comparison: [{ label: 'Le temps', guide: 'Court', other: 'Long' }, { label: 'Le prix', guide: 'Une fois', other: 'À la séance' }, { label: 'Le suivi', guide: 'Checklists', other: 'Rien' }] });
    expect(good.benefits).toEqual(['Des nuits plus longues', 'Un plan pour chaque soir', 'Moins de réveils']);
    expect(good.comparison).toHaveLength(3);
    const fb = write();
    const broken = await run({ benefits: ['un'], forWho: 'pas une liste', notFor: [], story: 'court', comparison: [{ label: 'x' }] });
    expect(broken.benefits).toEqual(fb.benefits);
    expect(broken.story).toBe(fb.story);
    expect(broken.comparison).toEqual(fb.comparison);
  });
});
