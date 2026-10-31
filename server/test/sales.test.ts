/** The sales page (pdf §11): nothing leaves the file, the pages it shows are the guide's, the figures it prints are counted. */
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MindContext, RunPaths } from '../src/contracts.js';
import { coverScene } from '../src/deliverables/cover.js';
import { demoContent, demoProduct, demoSalesPage } from '../src/deliverables/fixture.js';
import { normalizeDesign } from '../src/deliverables/design.js';
import { setFontDir } from '../src/deliverables/fonts.js';
import { renderCoverSvg, renderSalesPageHtml } from '../src/deliverables/index.js';
import { layoutPdf } from '../src/deliverables/pdf.js';
import { figureSvgFor, STAGE } from '../src/deliverables/salesPage.js';
import { toSvg } from '../src/deliverables/scene.js';
import { VOICES } from '../src/deliverables/voices.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { syncSalesPages } from '../src/runtime/handlers/boutique.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { createTask } from '../src/runtime/tasks.js';
import type { DesignSpec, PdfContent, Product, SalesPage, Task, VisualSpec, WorldState } from '../src/shared.js';

const NICHE = 'proprete-chiot';
const BANNER = '<div class="demo-banner">Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel</div>';
const CHECKOUT = 'Boutique virtuelle : paiement simulé — environnement de test Pixel Agency';
const MAX_PREVIEW = 700_000;

let root = '';
let world: WorldState;
let ctx: RuntimeCtx;
let page: Product;
let renderTask: Task;

async function run(product: Product, kind: Task['kind'], input: Record<string, unknown> = {}): Promise<Task> {
  const agent = world.company.agents.find((a) => a.taskKinds.includes(kind))!;
  const mind: MindContext = { agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'Pixel' };
  const task = createTask(world, { kind, assignee: agent.id, input: { productId: product.id, ...input } });
  const out = await HANDLERS[kind]!.run(ctx, task, agent, mind);
  expect(out.fail, kind).toBeUndefined();
  task.output = out.output ?? null;
  task.status = 'done';
  return task;
}

const addProduct = (id: string, over: Partial<Product> = {}): Product => {
  const product: Product = {
    ...demoProduct, id, nicheId: NICHE, title: 'Le chiot fait ses besoins partout', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 2, launchedDay: 3,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [], ...over,
  };
  world.company.products.push(product);
  return product;
};

/** The whole chain of a guide, by the handlers of the pipeline: what the shop really puts online. */
async function onSale(product: Product): Promise<Task> {
  for (const kind of ['write_titles', 'write_outline', 'write_pdf', 'design_cover'] as const) await run(product, kind);
  const render = await run(product, 'render_pdf');
  await run(product, 'write_sales_page');
  return render;
}

const read = (rel: string): string => readFileSync(join(root, ...rel.split('/')), 'utf8');
const htmlOf = (p: Product): string => read(p.files.salesPage!);
/** The pages of « Feuilletez-le », as the buyer gets them. */
const leavesIn = (html: string): string[] => [...html.matchAll(/<figure class="leaf"><div class="p">(<svg[\s\S]*?<\/svg>)<\/div>/g)].map((m) => m[1]!);
const noFonts = (html: string): string => html.replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,');
/** Text is set with French no-break spaces: what is compared here is the words. */
const plain = (s: string | null): string => (s ?? '').replace(/[  ]/g, ' ');

const SVG = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842">${body}</svg>`;
const PAGE = (label: string): { label: string; svg: string } => ({ label, svg: SVG(`<path aria-label="${label}" d="M0 0h1v1z"/>`) });

const design: DesignSpec = normalizeDesign({ palette: {} } as never);
const cover = '<svg viewBox="0 0 10 10"></svg>';
const shop = (over: Partial<Parameters<typeof renderSalesPageHtml>[0]> = {}, product: Partial<Product> = {}): string =>
  renderSalesPageHtml({ product: { ...demoProduct, content: demoContent, ...product }, salesPage: demoSalesPage, coverSvg: cover, design, brand: 'Pixel Agency', ...over });

beforeAll(async () => {
  world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90 }), 'test-sales');
  root = mkdtempSync(join(tmpdir(), 'pixel-sales-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain });
  ctx = (company as unknown as { ctx: RuntimeCtx }).ctx;
  world.company.research.voc[NICHE] = ctx.tools.minePains(NICHE, 'deep');
  page = addProduct('prd_page');
  renderTask = await onSale(page);
}, 60_000);
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });
afterEach(() => setFontDir());

describe('the reviews of a page', () => {
  const review = (i: number) => ({ id: `rev_${i}`, day: i, rating: 5, text: 'Très utile.', customerId: 'cus_1', orderId: 'ord_1' });

  it('count every buyer who wrote one, not the 60 the product keeps', () => {
    const reviews = Array.from({ length: 60 }, (_, i) => review(i)) as Product['stats']['reviews'];
    const html = plain(shop({}, { stats: { ...demoProduct.stats, reviews, rating: 4.8, ratingCount: 241 } }));
    expect(html).toContain('241 avis vérifiés');
    expect(html).toContain('241 avis</span>');
    expect(html).not.toContain('60 avis');
  });

  it('a product with no count yet shows what it holds', () => {
    const reviews = [review(1), review(2)] as Product['stats']['reviews'];
    expect(plain(shop({}, { stats: { ...demoProduct.stats, reviews, rating: 5 } }))).toContain('2 avis vérifiés');
  });
});

describe('nothing leaves the file', () => {
  it('no Google Fonts, no external URL, no resource loaded from anywhere', () => {
    const html = noFonts(htmlOf(page));
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    // an SVG namespace names a vocabulary, a browser never fetches it
    const urls = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', '').match(/(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? [];
    expect(urls).toEqual([]);
    expect(html).not.toMatch(/<(?:link|img|iframe|object|embed|video|audio)\b|@import|\ssrc\s*=/i);
    for (const u of html.match(/url\([^)]*\)/g) ?? []) expect(u).toMatch(/^url\((?:data:|#)/);
    for (const href of html.match(/\bhref="[^"]*"/g) ?? []) expect(href).toMatch(/^href="#/);
  });

  it('the test banner, the virtual checkout and the footer are there, word for word', () => {
    const html = htmlOf(page);
    expect(html).toContain(BANNER);
    expect(html).toContain(CHECKOUT);
    expect(html).toContain('Aucune donnée bancaire n’est collectée.');
    expect(html).toContain('data-buy');
  });

  it('two faces only, the committed WOFF files themselves, never their unpacked form', () => {
    const html = htmlOf(page);
    const voice = VOICES[normalizeDesign(page.design).voice!];
    const inline = [...html.matchAll(/url\(data:font\/woff;base64,([A-Za-z0-9+/=]+)\)/g)].map((m) => m[1]!);
    expect(html.match(/@font-face/g)).toHaveLength(2);
    const committed = [voice.display, voice.text].map((f) => readFileSync(join('assets', 'fonts', `${f}.woff`)).toString('base64'));
    expect(inline).toEqual(committed);
    expect(inline.join('').length).toBeLessThan(100_000);
  });

  it('with no font at all the page still renders, on its fallback stacks, and still fetches nothing', () => {
    setFontDir(mkdtempSync(join(root, 'empty-')));
    const html = shop();
    expect(html).not.toContain('@font-face');
    expect(html).toContain(BANNER);
    expect(html).not.toMatch(/fonts\.googleapis/);
  });
});

describe('the pages it shows are the guide’s', () => {
  it('render_pdf leaves at least 3 real pages next to the guide, and the page shows them untouched', () => {
    const files = page.files.previews!;
    expect(files.length).toBeGreaterThanOrEqual(3);
    const leaves = leavesIn(htmlOf(page));
    expect(leaves.length).toBeGreaterThanOrEqual(3);
    expect(leaves.length).toBeLessThanOrEqual(6);
    const written = files.map(read);
    for (const leaf of leaves) expect(written).toContain(leaf.replace(/^<svg id="page-\d+"/, '<svg'));
  });

  it('no preview gives a sentence of the guide away, and none weighs over 700 KB', () => {
    const body = [...page.content!.chapters.flatMap((c) => c.paragraphs), ...(page.content!.introduction ?? [])].filter((s) => s.length > 40).map((s) => plain(s).slice(0, 30));
    expect(body.length).toBeGreaterThan(10);
    // the control: the same page, its text left in, does give sentences away
    const { pages } = layoutPdf({ product: page, content: page.content!, design: page.design!, brand: world.company.name });
    const open = plain(toSvg(pages.find((p) => p.preview === 'Page du guide')!.scene));
    expect(body.some((sentence) => open.includes(sentence))).toBe(true);
    for (const leaf of leavesIn(htmlOf(page))) {
      expect(leaf.length).toBeLessThanOrEqual(MAX_PREVIEW);
      expect(leaf).not.toMatch(/<text\b/);
      for (const sentence of body) expect(plain(leaf)).not.toContain(sentence);
    }
  });

  it('says the text is hidden: « ce que vous voyez est ce que vous téléchargez » stays true', () => {
    const html = htmlOf(page);
    expect(html).toContain('Feuilletez-le avant de décider');
    expect(html).toContain('ce que vous voyez est ce que vous téléchargez');
    expect(html).toContain('Seul le texte courant est masqué');
  });

  it('a device shows one of those pages and adds no weight: each page travels once', () => {
    const html = htmlOf(page);
    const ids = [...html.matchAll(/<svg id="(page-\d+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);
    const used = [...html.matchAll(/<use href="#(page-\d+)"/g)].map((m) => m[1]!);
    expect(used).toHaveLength(2);
    for (const id of used) expect(ids).toContain(id);
    expect(html).toContain('class="device tablet"');
    expect(html).toContain('class="device phone"');
  });

  it('the cover is on stage: it joins the pages only to reach four', () => {
    const inner = ['Ouverture de chapitre', 'Page du guide', 'Schéma', 'Fiche à imprimer'];
    expect(leavesIn(shop({ previews: ['Couverture', ...inner].map(PAGE) })).join('')).not.toContain('aria-label="Couverture"');
    expect(leavesIn(shop({ previews: ['Couverture', ...inner.slice(0, 3)].map(PAGE) })).join('')).toContain('aria-label="Couverture"');
    expect(leavesIn(shop({ previews: Array.from({ length: 9 }, (_, k) => PAGE(`Page ${k}`)) }))).toHaveLength(6);
  });

  it('an inlined page runs nothing, and a missing file only costs its leaf', async () => {
    const evil = { label: 'Schéma', svg: SVG('<script>alert(1)</script><path onload="alert(2)" d="M0 0"/><foreignObject>x</foreignObject>') };
    expect(shop({ previews: [PAGE('Page du guide'), evil] })).not.toMatch(/alert\(1\)|alert\(2\)|foreignObject/);
    const extra = addProduct('prd_lost');
    await onSale(extra);
    const lost = extra.files.previews!.at(-1)!;
    const gone = read(lost);
    expect(leavesIn(htmlOf(extra)).join('')).toContain(gone.slice(gone.indexOf('>')));
    unlinkSync(join(root, ...lost.split('/')));
    await run(extra, 'write_sales_page');
    const html = htmlOf(extra);
    expect(leavesIn(html).join('')).not.toContain(gone.slice(gone.indexOf('>')));
    expect(leavesIn(html).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(BANNER);
  });

  it('an old save has no previews: the section is skipped, the book stands alone', () => {
    const html = shop();
    expect(html).not.toContain('Feuilletez-le');
    expect(html).not.toContain('class="device');
    expect(html).toContain('class="stage alone"');
    expect(html).not.toContain('href="#apercu"');
  });
});

describe('the figures it prints are counted', () => {
  it('chapters, actions, sheets and pages come from the guide and its render', () => {
    const html = htmlOf(page);
    const c = page.content!;
    const actions = [...c.chapters, ...(c.bonus ? [c.bonus] : [])].reduce((sum, ch) => sum + ch.steps.length, 0);
    expect(page.pdfFacts!.pages).toBe(renderTask.output!.pages);
    expect(page.pdfFacts!.sheets).toBeGreaterThan(0);
    const strip = /<ul class="strip">(.*?)<\/ul>/s.exec(html)![1]!;
    expect(strip).toContain(`<b>${c.chapters.length}</b>chapitres`);
    expect(strip).toContain(`<b>${actions}</b>actions guidées`);
    expect(strip).toContain(`<b>${page.pdfFacts!.sheets}</b>fiche`);
    expect(strip).toContain(`<b>${page.pdfFacts!.pages}</b>pages illustrées`);
  });

  it('a figure nobody measured is not printed', () => {
    const strip = /<ul class="strip">(.*?)<\/ul>/s.exec(shop({}, { pdfFacts: undefined as never }))![1]!;
    expect(strip).toContain('chapitres');
    expect(strip).not.toMatch(/fiche|pages illustrées/);
    expect(shop({}, { pdfFacts: { pages: 1, sheets: 1 } })).toContain('<b>1</b>fiche à imprimer');
    expect(shop({}, { pdfFacts: { pages: 30, sheets: 0 } })).not.toMatch(/fiches? à imprimer/);
  });

  it('the hero says the title the cover says, and the written hook under it', () => {
    const title = 'Le chiot fait ses besoins : la méthode en 14 jours';
    const sp: SalesPage = { ...demoSalesPage, headline: 'Enfin un chiot propre, même en appartement', subheadline: 'Sous-titre écrit' };
    const html = plain(shop({ salesPage: sp }, { title }));
    expect(/<h1>(.*?)<\/h1>/s.exec(html)![1]).toBe('Le chiot fait ses besoins');
    expect(/<p class="deck">(.*?)<\/p>/s.exec(html)![1]).toBe('La méthode en 14 jours');
    expect(/<p class="hook">(.*?)<\/p>/s.exec(html)![1]).toBe(sp.headline);
    expect(html).toContain('<p>Sous-titre écrit</p>');
    expect(/<p class="hook">(.*?)<\/p>/s.exec(plain(shop({ salesPage: { ...sp, headline: title } }, { title })))![1]).toBe('Sous-titre écrit');
  });

  it('the button carries the price of the day once', () => {
    const with29 = shop({ salesPage: { ...demoSalesPage, cta: 'Je commence ce soir — 24 €' } }, { price: 29 });
    expect(with29).toMatch(/data-buy>Je commence ce soir — 29.€<\/button>/);
    expect(shop({ salesPage: { ...demoSalesPage, cta: 'Je télécharge le guide' } }, { price: 29 })).toMatch(/data-buy>Je télécharge le guide <em>29.€<\/em><\/button>/);
  });

  it('real reviews only: no review, no fake one', () => {
    const html = shop({}, { stats: { ...demoProduct.stats, rating: 0, reviews: [] } });
    expect(html).toContain('Nous n’affichons jamais de faux témoignages');
    expect(html).not.toContain('class="review"');
  });
});

describe('one figure at full size', () => {
  const plan: VisualSpec = { type: 'plan_path', title: 'Votre plan de 14 jours', labels: [], values: [], plan: { days: 14, unit: 'jour', tracks: [{ label: 'Une sortie après chaque sieste', from: 1, to: 14 }] } };
  const cycle: VisualSpec = { type: 'cycle', title: 'La boucle à casser', labels: [], values: [], cycle: { nodes: ['Il sort', 'Il rentre', 'Accident'], breakAt: 1, center: 'Le maillon' } };
  const withVisuals = (...visuals: (VisualSpec | null)[]): PdfContent => ({ ...demoContent, chapters: demoContent.chapters.map((c, k) => ({ ...c, visual: visuals[k] ?? c.visual, figure: null })) });

  it('the plan first, then the loop, its labels set for a reader', () => {
    expect(plain(figureSvgFor(withVisuals(cycle, plan), design))).toContain('aria-label="Votre plan de 14 jours"');
    const loop = plain(figureSvgFor(withVisuals(cycle), design));
    expect(loop).toContain('aria-label="La boucle à casser"');
    expect(loop).toContain('aria-label="Il sort"');
  });

  it('a plan kept as a chapter’s second visual counts, and an old save’s « boucle » is its loop', () => {
    const second: PdfContent = { ...demoContent, chapters: demoContent.chapters.map((c, k) => ({ ...c, figure: k === 1 ? plan : null })) };
    expect(plain(figureSvgFor(second, design))).toContain('aria-label="Votre plan de 14 jours"');
    const old: VisualSpec = { type: 'steps_diagram', title: 'La boucle à casser', labels: ['Il sort', 'Il rentre', 'Accident'], values: [] };
    expect(plain(figureSvgFor(withVisuals(old), design))).toContain('aria-label="La boucle à casser"');
  });

  it('the page shows it unless told not to, and skips the section without one', () => {
    const content = withVisuals(plan);
    expect(shop({}, { content })).toContain('<div class="fig"><svg');
    expect(shop({ figureSvg: null }, { content })).not.toContain('class="fig"');
    expect(shop({ figureSvg: SVG('<script>alert(3)</script>') }, { content })).not.toContain('alert(3)');
    const plain: PdfContent = { ...demoContent, chapters: demoContent.chapters.map((c) => ({ ...c, visual: null, figure: null })) };
    expect(figureSvgFor(plain, design)).toBeNull();
    expect(shop({}, { content: plain })).not.toContain('class="fig"');
  });
});

describe('the stage keeps the book’s title readable (pdf §11.2)', () => {
  const HERO = 3 / 6;                     // `minimal`: the hero takes the right half…
  const HERO_TOP = (848 - 300) / 848;     // …and the last 300 of 848 points
  const { book } = STAGE;
  const right = book.left + book.width;
  const height = (book.width * 848) / 600;

  it('a device never covers more than 15 % of the cover’s width', () => {
    for (const { tablet, phone } of [STAGE.art, STAGE.foot]) {
      for (const device of [tablet, phone]) expect(Math.max(0, right - device.left) / book.width).toBeLessThanOrEqual(0.15);
    }
  });

  it('on `split` it stays on the art: the shortest art of a long title ends above the device’s reach', () => {
    const long = 'Un titre assez long pour que la couverture garde une rangée de plus au texte';
    const { meta } = coverScene({ title: long, subtitle: '', audience: '', design: { ...design, coverLayout: 'split' }, brand: 'Pixel Agency' });
    expect(meta.rows).toBe(4);
    const artBottom = book.top + (height * (meta.rows * 100)) / 848;
    const overlapping = Object.values(STAGE.art).filter((d) => d.left < right);
    expect(overlapping.length).toBeGreaterThan(0);
    for (const d of overlapping) expect(d.top + d.width * Math.SQRT2).toBeLessThanOrEqual(artBottom);
  });

  it('on `minimal` it stays on the hero in the bottom corner, and the page says which family it is', () => {
    const overlapping = Object.values(STAGE.foot).filter((d) => d.left < right);
    expect(overlapping.length).toBeGreaterThan(0);
    for (const d of overlapping) {
      expect(d.left).toBeGreaterThanOrEqual(book.left + book.width * HERO);
      expect(d.top).toBeGreaterThanOrEqual(book.top + height * HERO_TOP);
    }
    const previews = [PAGE('Ouverture de chapitre'), PAGE('Page du guide')];
    expect(shop({ previews, design: { ...design, coverLayout: 'minimal' } })).toContain('class="stage foot"');
    expect(shop({ previews, design: { ...design, coverLayout: 'split' } })).toContain('class="stage"');
  });

  it('the CSS carries those numbers, and the cover is a book: turned, its spine shaded, its pages stacked', () => {
    const html = htmlOf(page);
    expect(html).toContain(`rotateY(-${book.turn}deg)`);
    expect(book.turn).toBe(24);
    expect(html).toContain('.front:after');
    expect(html).toContain('<div class="edge"></div>');
    expect(html).toContain(`.stage .tablet{left:${STAGE.art.tablet.left}%;top:${STAGE.art.tablet.top}%;width:${STAGE.art.tablet.width}%}`);
    expect(html).toContain(`.stage.foot .phone{left:${STAGE.foot.phone.left}%;top:${STAGE.foot.phone.top}%;width:${STAGE.foot.phone.width}%}`);
  });
});

describe('the page follows the guide', () => {
  it('a refresh after a price keeps the pages, draws nothing and gives the same file twice', async () => {
    const before = leavesIn(htmlOf(page));
    const state = world.rngState;
    const { refreshSalesPage } = await import('../src/runtime/handlers/boutique.js');
    page.price = 21;
    await refreshSalesPage(ctx, page);
    expect(world.rngState).toBe(state);
    const first = htmlOf(page);
    expect(leavesIn(first)).toEqual(before);
    expect(first).toContain('Obtenir le guide · 21');
    delete page.pagePrint;
    await refreshSalesPage(ctx, page);
    expect(htmlOf(page)).toBe(first);
  });

  it('the guide rendered again: the page shows the new render at the end of the tick', async () => {
    const p = addProduct('prd_again');
    await onSale(p);
    const stamp = p.pagePrint;
    const before = leavesIn(htmlOf(p));
    expect(stamp).toBeDefined();
    p.content!.chapters[0]!.title = 'Un chapitre tout neuf';
    await run(p, 'render_pdf');
    expect(p.pagePrint).toBeUndefined();
    await syncSalesPages(ctx);
    expect(p.pagePrint).toBe(stamp);
    const after = leavesIn(htmlOf(p));
    expect(after).not.toEqual(before);
    expect(after.join('')).toContain('tout neuf');
  });

  it('the cover reaches the book untouched', () => {
    const file = read(page.files.cover!);
    expect(file.startsWith('<svg')).toBe(true);
    expect(htmlOf(page)).toContain(`<div class="front">${file}</div>`);
    expect(existsSync(join(root, ...page.files.cover!.split('/')))).toBe(true);
    expect(renderCoverSvg({ title: page.title, subtitle: page.content!.subtitle, audience: page.audience, design: page.design!, brand: world.company.name })).toBe(file);
  });
});
