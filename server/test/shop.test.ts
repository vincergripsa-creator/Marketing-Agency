/** The shop tells the truth: an upsell is another guide, a page shows the price and the reviews of the day, an internal note stays internal. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Product, Task } from '../src/shared.js';
import type { BrainVault, ContentEngine, MindContext, RunPaths } from '../src/contracts.js';
import { norm, upsellTopics, nextStepFor } from '../src/minds/index.js';
import { finalWording } from '../src/deliverables/pdf.js';

async function setup(seed = 21, nicheId = 'proprete-chiot') {
  const runtime = await import('../src/runtime/index.js');
  const { sim } = await import('../src/runtime/modules.js');
  const { createRng } = await import('../src/core/index.js');
  const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
  const vault = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
  const { createTask } = await import('../src/runtime/tasks.js');
  const { HANDLERS } = await import('../src/runtime/handlers/index.js');
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-shop-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const world = runtime.createWorld(runtime.defaultScenario({ seed, mindMode: 'heuristic' }), 'test-shop');
  const engine = minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
  const brain = vault.createBrainVault(paths);
  await brain.init();
  const rng = createRng(world.rngState);
  const tools = sim.createMarketTools(world, rng);
  const ctx = { world, engine, brain, tools, rng, paths, incidents: [] as string[], lastMarketNotes: [] as string[] };
  ctx.world.company.research.voc[nicheId] = tools.minePains(nicheId, 'deep');

  /** Runs a handler like the company does: its output is stored on a done task. */
  const run = async (kind: Task['kind'], input: Record<string, unknown>): Promise<{ task: Task; out: Awaited<ReturnType<(typeof HANDLERS)[Task['kind']]['run']>> }> => {
    const agent = world.company.agents.find((a) => a.taskKinds.includes(kind))!;
    const mind: MindContext = { agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'Pixel' };
    const task = createTask(world, { kind, input });
    task.assignee = agent.id;
    const out = await HANDLERS[kind].run(ctx, task, agent, mind);
    task.output = out.output ?? null;
    task.status = out.fail ? 'failed' : 'done';
    return { task, out };
  };
  const addProduct = (id: string, over: Partial<Product> = {}): Product => {
    const p: Product = {
      id, nicheId, title: `Guide ${id}`, subtitle: '', audience: 'nouveaux propriétaires d’un chiot', problem: 'Le chiot fait ses besoins partout', price: 19, status: 'live', version: 1,
      content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
      createdDay: 2, launchedDay: 3, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 3, price: 19 }], ...over,
    };
    world.company.products.push(p);
    return p;
  };
  /** Titles, plan and text, by the same handlers as the pipeline. */
  const write = async (p: Product) => {
    await run('write_titles', { productId: p.id });
    await run('write_outline', { productId: p.id });
    await run('write_pdf', { productId: p.id });
  };
  return { world, ctx, root, tools, run, addProduct, write, createTask, HANDLERS, nicheId };
}

type Env = Awaited<ReturnType<typeof setup>>;
const clean = (e: Env) => rmSync(e.root, { recursive: true, force: true });
const same = (a: string | undefined, b: string | undefined) => norm(a ?? '') === norm(b ?? '');

/** A parent guide on sale and the upsell designed for it. */
async function withUpsell(e: Env): Promise<{ parent: Product; upsell: Product }> {
  const parent = e.addProduct('prd_main');
  await e.write(parent);
  const { out } = await e.run('design_upsell', { productId: parent.id });
  return { parent, upsell: e.world.company.products.find((p) => p.id === out.output?.upsellProductId)! };
}

describe('an upsell is another guide (D1)', () => {
  it('design_upsell picks a prepared sub-problem, never what the parent already sells', async () => {
    const e = await setup();
    try {
      const { parent, upsell } = await withUpsell(e);
      const topic = upsellTopics(e.nicheId)[0]!;
      expect(upsell.problem).toBe(topic.pain);
      expect(upsell.title).toBe(topic.title);
      expect(parent.upsellProductId).toBe(upsell.id);
      for (const said of [parent.title, parent.problem, parent.content!.promise]) {
        expect(same(upsell.problem, said)).toBe(false);
        expect(same(upsell.title, said)).toBe(false);
      }
      // the outcomes of the research would have been the parent's promise again
      const promised = norm(parent.content!.promise);
      expect(promised.includes(norm(upsell.problem))).toBe(false);
    } finally { clean(e); }
  });

  it('the writers receive the parent: another title, another promise, other chapters', async () => {
    const e = await setup();
    try {
      const { parent, upsell } = await withUpsell(e);
      await e.write(upsell);
      const a = parent.content!;
      const b = upsell.content!;
      expect(same(upsell.title, parent.title)).toBe(false);
      expect(same(b.promise, a.promise)).toBe(false);
      expect(norm(b.promise)).toContain(norm(upsellTopics(e.nicheId)[0]!.goal).slice(0, 24));
      const parentChapters = new Set(a.chapters.map((c) => norm(c.title)));
      expect(b.chapters.filter((c) => parentChapters.has(norm(c.title)))).toEqual([]);
      const parentSentences = new Set(a.chapters.flatMap((c) => c.paragraphs).map(norm));
      const repeated = b.chapters.flatMap((c) => c.paragraphs).filter((s) => parentSentences.has(norm(s)));
      expect(repeated.length).toBeLessThan(3);
    } finally { clean(e); }
  });

  it('with its prepared sub-problem taken, the next upsell of the niche takes a customer pain, and the writer follows it', async () => {
    const e = await setup();
    try {
      const { parent, upsell } = await withUpsell(e);
      await e.write(upsell);
      upsell.status = 'killed';
      const { out } = await e.run('design_upsell', { productId: parent.id });
      const second = e.world.company.products.find((p) => p.id === out.output?.upsellProductId)!;
      expect(second.id).not.toBe(upsell.id);
      expect(same(second.problem, upsell.problem)).toBe(false);
      await e.write(second);
      expect(same(second.title, upsell.title)).toBe(false);
      expect(same(second.title, parent.title)).toBe(false);
      expect(same(second.content!.promise, parent.content!.promise)).toBe(false);
      expect(same(second.content!.promise, upsell.content!.promise)).toBe(false);
    } finally { clean(e); }
  });

  it('with nothing distinct left, there is no upsell', async () => {
    const e = await setup();
    try {
      const parent = e.addProduct('prd_main');
      await e.write(parent);
      const voc = e.world.company.research.voc[e.nicheId]!;
      voc.pains = [parent.problem];
      e.addProduct('prd_other', { problem: upsellTopics(e.nicheId)[0]!.pain, title: 'Autre guide', status: 'killed' });
      const before = e.world.company.products.length;
      const { out } = await e.run('design_upsell', { productId: parent.id });
      expect(out.output).toMatchObject({ noSubject: true });
      expect(e.world.company.products).toHaveLength(before);
      expect(parent.upsellProductId).toBeNull();
    } finally { clean(e); }
  });

  it('refuses a title or a promise that exists in the niche, whatever got it to the shop', async () => {
    const e = await setup();
    try {
      const { nicheCollision, titleTaken, promiseTaken } = await import('../src/runtime/upsell.js');
      const parent = e.addProduct('prd_main', { title: 'Le chiot : la méthode' });
      await e.write(parent);
      const twin = e.addProduct('prd_twin', { status: 'ready', title: ` « ${parent.title.toUpperCase()} »`, launchedDay: null });
      expect(titleTaken(e.world, twin, twin.title)?.id).toBe(parent.id);
      expect(nicheCollision(e.world, twin)).toMatch(/titre/);
      const sameEnd = `Une autre formule pour arriver à ceci : ${parent.content!.promise.split(' : ').pop()!}`;
      expect(promiseTaken(e.world, twin, sameEnd)?.id).toBe(parent.id);
      expect(titleTaken(e.world, e.addProduct('prd_far', { nicheId: 'sommeil-bebe' }), parent.title)).toBeUndefined();
      // Past every other check: PDF, page and price are there.
      twin.content = parent.content;
      twin.price = 24;
      twin.salesPage = { headline: 'x', subheadline: 'x', painBullets: [], solution: 'x', chapterBlurbs: [], bonusBlurb: '', objections: [], guarantee: '', cta: 'x', hypeLevel: 0.4 };
      twin.files = { pdf: 'files/x/guide.pdf', cover: null, salesPage: 'files/x/page.html' };
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(e.root, 'files', 'x'), { recursive: true });
      writeFileSync(join(e.root, 'files', 'x', 'guide.pdf'), 'x');
      writeFileSync(join(e.root, 'files', 'x', 'page.html'), 'x');
      const { out } = await e.run('publish_product', { productId: twin.id });
      expect(out.fail).toMatch(/Mise en ligne refusée/);
      expect(twin.status).toBe('killed');
    } finally { clean(e); }
  });

  it('write_titles drops the titles a product of the niche already carries', async () => {
    const e = await setup();
    try {
      const { parent, upsell } = await withUpsell(e);
      const written = await e.ctx.engine.writeTitles({ niche: { nicheId: e.nicheId, name: 'x', audience: upsell.audience, problem: upsell.problem, category: 'animaux', keywords: [] }, voc: e.world.company.research.voc[e.nicheId]!, count: 10, upsellOf: { parentTitle: parent.title, parentPromise: parent.content!.promise, parentChapterTitles: [], topicId: upsellTopics(e.nicheId)[0]!.id } }, { agent: e.world.company.agents[0]!, playbook: [], brainNotes: [], lessons: [], day: 1, brand: 'Pixel' });
      e.addProduct('prd_taken', { title: written[0]!, status: 'ready' });
      await e.run('write_titles', { productId: upsell.id });
      expect(same(upsell.title, written[0])).toBe(false);
    } finally { clean(e); }
  });

  it('the parent says « la suite » only for a guide on sale, in words that name it; the upsell never sells itself', async () => {
    const e = await setup();
    try {
      const { upsellLink } = await import('../src/runtime/handlers/creation.js');
      const { parent, upsell } = await withUpsell(e);
      await e.write(upsell);
      // Designed but not on sale: the last page of the parent stays on its own plan.
      expect(upsellLink(e.ctx, parent)).toBeNull();
      expect(finalWording(parent.content!, upsellLink(e.ctx, parent), null).heading).toBe('Votre prochaine étape');

      upsell.price = 24;
      await e.run('render_pdf', { productId: upsell.id });
      await e.run('write_sales_page', { productId: upsell.id });
      upsell.status = 'ready';
      const task = e.createTask(e.world, { kind: 'publish_product', input: { productId: upsell.id } });
      await e.HANDLERS.publish_product.onDone!(e.ctx, task);

      expect(upsell.status).toBe('live');
      expect(parent.content!.nextStep.upsellProductId).toBe(upsell.id);
      expect(parent.content!.nextStep.title).toBe(upsell.title);
      expect(parent.content!.nextStep.text).toContain(upsell.title.replace(/[«»]/g, '').slice(0, 20));
      expect(e.world.company.tasks.some((t) => t.kind === 'render_pdf' && t.input.productId === parent.id && t.input.reason === 'upsell_link')).toBe(true);

      const page = finalWording(parent.content!, upsellLink(e.ctx, parent), null);
      expect(page.heading).toBe('La suite est ici');
      expect(same(page.subtitle, upsell.title)).toBe(true);
      expect(same(page.subtitle, parent.title)).toBe(false);
      expect(page.paragraphs.join(' ')).toContain('traite un autre point');

      const own = finalWording(upsell.content!, upsellLink(e.ctx, upsell), null);
      expect(own.heading).toBe('Votre prochaine étape');
      expect(own.paragraphs.join(' ')).not.toContain(parent.title);
    } finally { clean(e); }
  });

  it('killing an upsell takes it off the parent\'s last page', async () => {
    const e = await setup();
    try {
      const { killProduct } = await import('../src/runtime/pipeline.js');
      const { parent, upsell } = await withUpsell(e);
      await e.write(upsell);
      upsell.status = 'live';
      upsell.launchedDay = 5;
      parent.content!.nextStep = nextStepFor({ audience: 'les nouveaux propriétaires', upsell: { title: upsell.title, productId: upsell.id } });
      await killProduct(e.ctx, upsell, 'test', 'camille');
      expect(parent.content!.nextStep).toMatchObject({ title: 'Votre prochaine étape', upsellProductId: null });
      expect(e.world.company.tasks.some((t) => t.kind === 'render_pdf' && t.input.productId === parent.id && t.status === 'pending')).toBe(true);
    } finally { clean(e); }
  });
});

describe('the sales page shows the shop of the day (D2)', () => {
  const page = (e: Env, p: Product) => readFileSync(join(e.root, ...p.files.salesPage!.split('/')), 'utf8');

  async function pageOf(e: Env): Promise<Product> {
    const p = e.addProduct('prd_page', { price: 19, status: 'live' });
    await e.write(p);
    await e.run('write_sales_page', { productId: p.id });
    return p;
  }

  it('after set_price, the page shows product.price everywhere it prints one', async () => {
    const e = await setup();
    try {
      const p = await pageOf(e);
      expect(page(e, p)).toContain('Obtenir le guide · 19');
      p.salesPage!.objections.push({ q: 'Et si je change d’avis ?', a: 'Pour 19 € et moins de 1 019 € de dégâts, vous avez 14 jours.' });
      const { out } = await e.run('set_price', { productId: p.id, reason: 'fondateur', price: 29 });
      expect(out.fail).toBeUndefined();
      expect(p.price).toBe(29);
      const html = page(e, p);
      expect(html).toContain('Obtenir le guide · 29');
      expect(html).not.toContain('Obtenir le guide · 19');
      expect(html).toContain('<span class="price">29');
      expect(html).toContain('Vous payez 29');
      expect(html).not.toMatch(/Pour 19/);
      expect(html).toMatch(/Pour 29.{0,12}€ et moins de 1.019/);
    } finally { clean(e); }
  });

  it('a new review reaches the page at the end of the tick, and an unchanged page is not rewritten', async () => {
    const e = await setup();
    try {
      const { syncSalesPages } = await import('../src/runtime/handlers/boutique.js');
      const p = await pageOf(e);
      expect(page(e, p)).toContain('aucun avis pour l’instant');
      const stamp = p.pagePrint;
      await syncSalesPages(e.ctx);
      expect(p.pagePrint).toBe(stamp);
      p.stats.reviews.push({ id: 'rev_1', day: 4, customerId: 'cus_1', rating: 5, text: 'Enfin une méthode qui tient debout, merci.' });
      p.stats.rating = 5;
      await syncSalesPages(e.ctx);
      const html = page(e, p);
      expect(html).toContain('Enfin une méthode qui tient debout');
      expect(html).toContain('1 avis');
      expect(html).not.toContain('aucun avis pour l’instant');
    } finally { clean(e); }
  });

  it('a v2 in progress keeps its page where it is until its own page is written', async () => {
    const e = await setup();
    try {
      const { refreshSalesPage } = await import('../src/runtime/handlers/boutique.js');
      const p = await pageOf(e);
      const v1 = p.files.salesPage!;
      p.version = 2;
      p.price = 24;
      await refreshSalesPage(e.ctx, p);
      expect(p.files.salesPage).toBe(v1);
      expect(readFileSync(join(e.root, ...v1.split('/')), 'utf8')).toContain('Obtenir le guide · 24');
    } finally { clean(e); }
  });
});

describe('an internal note stays internal, the cover follows the product (D3)', () => {
  it('ensureCoverFile redraws the cover when the title or the subtitle changed', async () => {
    const e = await setup();
    try {
      const { ensureCoverFile } = await import('../src/runtime/handlers/creation.js');
      const p = e.addProduct('prd_cover', { title: 'Premier titre de travail' });
      const first = await ensureCoverFile(e.ctx, p);
      expect(first).toContain('<title>Premier titre de travail</title>');
      p.title = 'Le titre retenu pour la vente';
      p.subtitle = 'Le sous-titre écrit avec le guide';
      const second = await ensureCoverFile(e.ctx, p);
      expect(second).toContain('<title>Le titre retenu pour la vente</title>');
      expect(second).toContain('Le sous-titre écrit avec le guide');
      expect(readFileSync(join(e.root, ...p.files.cover!.split('/')), 'utf8')).toBe(second);
    } finally { clean(e); }
  });
});

describe('a whole run, on its files', () => {
  let world: Env['world'];
  let root: string;

  beforeAll(async () => {
    const runtime = await import('../src/runtime/index.js');
    const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
    const vault = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
    root = mkdtempSync(join(tmpdir(), 'pixel-agency-shoprun-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    world = runtime.createWorld(runtime.defaultScenario({ seed: 8, mindMode: 'heuristic', difficulty: 'facile' }), 'test-shoprun');
    const engine = minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 8 });
    const brain = vault.createBrainVault(paths);
    await brain.init();
    await new runtime.Company(world, { paths, engine, brain }).runDays(32);
  }, 180_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const onSale = () => world.company.products.filter((p) => p.status === 'live');

  it('every page on sale shows the price and the number of reviews of the product', () => {
    expect(onSale().length).toBeGreaterThan(2);
    for (const p of onSale()) {
      const html = readFileSync(join(root, ...p.files.salesPage!.split('/')), 'utf8');
      expect(html, p.id).toContain(`Obtenir le guide · ${p.price}`);
      if (p.stats.reviews.filter((r) => r.text).length) expect(html, p.id).toContain(`${p.stats.reviews.filter((r) => r.text).length} avis`);
    }
  });

  it('no internal brief on any subtitle, cover or sales page', () => {
    for (const p of world.company.products) {
      expect(p.subtitle, p.id).not.toMatch(/Un seul problème|Une seule personne/);
      for (const file of [p.files.cover, p.files.salesPage]) {
        if (file && existsSync(join(root, ...file.split('/')))) expect(readFileSync(join(root, ...file.split('/')), 'utf8'), `${p.id} ${file}`).not.toMatch(/Un seul problème|Une seule personne/);
      }
    }
    expect(world.company.products.some((p) => /Un seul problème/.test(p.brief?.angle ?? ''))).toBe(true);
    for (const p of onSale()) {
      const cover = readFileSync(join(root, ...p.files.cover!.split('/')), 'utf8');
      expect(cover, p.id).toContain(`<desc>${p.content!.subtitle.slice(0, 20)}`);
    }
  });

  it('every upsell sells another promise than its parent, whose last page names it', () => {
    const pairs = world.company.products.filter((p) => p.upsellProductId).map((p) => [p, world.company.products.find((x) => x.id === p.upsellProductId)!] as const).filter(([, u]) => u.content);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [parent, upsell] of pairs) {
      expect(same(upsell.title, parent.title), parent.id).toBe(false);
      expect(same(upsell.problem, parent.problem), parent.id).toBe(false);
      expect(same(upsell.content!.promise, parent.content!.promise), parent.id).toBe(false);
      if (upsell.status === 'live') expect(parent.content!.nextStep.title, parent.id).toBe(upsell.title);
    }
  });

  it('no two products of a niche share a title or a promise', () => {
    const on = world.company.products.filter((p) => p.status !== 'killed');
    for (const key of [(p: Product) => p.title, (p: Product) => p.content?.promise ?? p.id]) {
      const seen = on.map((p) => `${p.nicheId}|${norm(key(p))}`);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});
