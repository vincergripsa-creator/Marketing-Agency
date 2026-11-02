/**
 * The company's side of the list and of the kit (scale §6.2, §6.3): real worlds, real tools, real files, and guides the
 * heuristic engine really wrote. The market's side is audience.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentEngine, DayPlanItem, MindContext, RunPaths } from '../src/contracts.js';
import { deliverables, learning, sim } from '../src/runtime/modules.js';
import { kitContent, kitOffer, kitSheets, renderSequenceHtml } from '../src/deliverables/kit.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { promotionBlock, refundsWorthRework } from '../src/runtime/acquisition.js';
import { angleDimension, AUDIENCE, audienceMorning, EMAIL_ANGLES, emailBlock, planAudience, queueLaunch, refuseEmail, rewardAngles } from '../src/runtime/audience.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { absPath } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { addHold, REFUSAL_COOLDOWN_DAYS } from '../src/runtime/holds.js';
import { isUpsellProduct, priceCeiling, productMetrics } from '../src/runtime/metrics.js';
import { killProduct } from '../src/runtime/pipeline.js';
import { buildHeuristicPlan, materialize } from '../src/runtime/strategy.js';
import { nicheCollision } from '../src/runtime/upsell.js';
import { createTask } from '../src/runtime/tasks.js';
import { addBuyers, audienceOf } from '../src/sim/audience.js';
import { findBannedClaims } from '../src/sim/compliance.js';
import { kitPrice } from '../src/sim/growth.js';
import type { AgentState, Broadcast, Lesson, PdfContent, Product, ScenarioConfig, StageId, Task, TaskKind, WorldState } from '../src/shared.js';
import { LEGACY } from './legacy.js';
import { pdfPagesText } from './pdfText.js';

vi.setConfig({ testTimeout: 120_000 });

const NICHE = 'proprete-chiot';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

// ───────────────────────────── fixtures ─────────────────────────────

function tmp(): string {
  const root = mkdtempSync(join(tmpdir(), 'pixel-lifecycle-'));
  roots.push(root);
  return root;
}

/** The founders with the growth pillar on: the legacy team owns none of these kinds. Nobody is hired or paid, unless a test says so. */
async function lab(over: Partial<ScenarioConfig> = {}) {
  const world = createWorld(defaultScenario({ ...LEGACY, org: { team: 'lean', autoHire: false, payroll: false }, scaling: true, seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 200, startingCash: 1000, ...over }), 'test-lifecycle');
  const root = tmp();
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed });
  const opts = { paths, engine, brain };
  const company = new Company(world, opts);
  return { world, company, engine, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w: WorldState) => new Company(w, opts) };
}

type Lab = Awaited<ReturnType<typeof lab>>;

const owner = (world: WorldState, kind: TaskKind): AgentState => world.company.agents.find((a) => a.taskKinds.includes(kind))!;

const mindOf = (world: WorldState, agent: AgentState): MindContext => ({ agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: world.company.name });

let serial = 0;

/** A guide the engine really wrote, on sale, as the tools see it. */
async function guide(l: Lab, over: Partial<Product> & { sales?: number } = {}): Promise<Product> {
  const { world, ctx, engine } = l;
  const { sales = 0, ...rest } = over;
  const nicheId = rest.nicheId ?? NICHE;
  const voc = ctx.tools.minePains(nicheId, 'deep');
  world.company.research.voc[nicheId] = voc;
  const brief = ctx.tools.nicheBrief(nicheId)!;
  const mind = mindOf(world, world.company.agents[0]!);
  const title = (await engine.writeTitles({ niche: brief, voc, count: 3 }, mind))[0]!;
  const outline = await engine.writeOutline({ title, niche: brief, voc }, mind);
  const content = await engine.writePdfContent({ title, outline, niche: brief, voc, upsellTitle: null }, mind);
  const p: Product = {
    id: `prd_g${++serial}`, nicheId, title, subtitle: content.subtitle, audience: brief.audience, problem: brief.problem, price: 19, status: 'live', version: 1, content,
    design: deliverables.designFor({ nicheName: brief.name, category: brief.category, keywords: brief.keywords, seed: 11 }), salesPage: null,
    files: { pdf: 'files/x/guide.pdf', cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 1, price: 19 }], ...rest,
  };
  p.salesPage = await engine.writeSalesPage({ product: p, content, voc, hype: 0.4 }, mind);
  world.company.products.push(p);
  return p;
}

const stage = (world: WorldState, s: StageId): void => { world.company.growth!.stage = s; };

/** One handler, on its own, by whoever owns the kind. */
async function run(l: Lab, kind: TaskKind, p: Product, input: Record<string, unknown> = {}): Promise<{ task: Task; out: Awaited<ReturnType<(typeof HANDLERS)[TaskKind]['run']>> }> {
  const agent = owner(l.world, kind);
  const task = createTask(l.world, { kind, input: { productId: p.id, nicheId: p.nicheId, ...input }, assignee: agent.id });
  const out = await HANDLERS[kind].run(l.ctx, task, agent, mindOf(l.world, agent));
  return { task, out };
}

function plan(l: Lab): DayPlanItem[] {
  const items: DayPlanItem[] = [];
  planAudience(l.ctx, items, []);
  return items;
}

const kinds = (items: DayPlanItem[]): TaskKind[] => items.map((i) => i.kind);

async function stepUntil(company: Company, done: () => boolean, max = 80): Promise<void> {
  for (let i = 0; i < max && !done(); i++) await company.step();
  expect(done()).toBe(true);
}

function subscribers(world: WorldState, nicheId: string, n: number): void {
  addBuyers(world, nicheId, n);
}

// ───────────────────────────── what the engine writes ─────────────────────────────

describe('what the list reads', () => {
  it('five welcome mails on every niche: the right days, a pitch, a way out, no refused claim, a real score', async () => {
    const l = await lab();
    for (const n of l.world.market.niches) {
      const p = await guide(l, { nicheId: n.id });
      const voc = l.world.company.research.voc[n.id]!;
      const steps = await l.engine.writeEmailSequence({ product: p, voc, bannedClaims: voc.bannedClaims }, mindOf(l.world, l.world.company.agents[0]!));
      expect(steps.map((s) => s.day)).toEqual([0, 2, 4, 7, 10]);
      expect(steps.filter((s) => s.kind === 'pitch').length).toBeGreaterThanOrEqual(2);
      for (const s of steps) {
        expect(findBannedClaims([s.subject, s.body], voc.bannedClaims), `${n.id} jour ${s.day}`).toEqual([]);
        const { score, issues } = sim.scoreEmail(s.subject, s.body, voc, voc.bannedClaims);
        expect(score, `${n.id} jour ${s.day} : ${s.subject} : ${issues.join(' ')}`).toBeGreaterThanOrEqual(60);
        expect(s.subject.length).toBeLessThanOrEqual(60);
        expect(s.body).toMatch(/désabonner/);
        expect(s.body).not.toMatch(/undefined|null|NaN|\.\.|€ \d|\d €\.$/);
      }
    }
  });

  it('every angle and the launch, on every niche: a subject that fits, no refused claim, never a price', async () => {
    const l = await lab();
    for (const n of l.world.market.niches) {
      const p = await guide(l, { nicheId: n.id });
      const voc = l.world.company.research.voc[n.id]!;
      const mind = mindOf(l.world, l.world.company.agents[0]!);
      const asked: [string, Broadcast['audience']][] = [...EMAIL_ANGLES.map((a): [string, Broadcast['audience']] => [a, 'niche']), ['lancement', 'launch']];
      const subjects = new Set<string>();
      for (const [angle, audience] of asked) {
        const b = await l.engine.writeBroadcast({ product: p, voc, angle, audience, bannedClaims: voc.bannedClaims }, mind);
        subjects.add(b.subject);
        expect(findBannedClaims([b.subject, b.body], voc.bannedClaims), `${n.id} ${angle}`).toEqual([]);
        expect(b.hasUnsubscribe).toBe(true);
        expect(b.subject.length).toBeLessThanOrEqual(60);
        expect(b.body).not.toContain(`${p.price} €`);
        expect(sim.scoreEmail(b.subject, b.body, voc, voc.bannedClaims).score, `${n.id} ${angle}`).toBeGreaterThanOrEqual(60);
      }
      expect(subjects.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('a worked case keeps its label, whoever it names', async () => {
    const l = await lab();
    const p = await guide(l);
    const voc = l.world.company.research.voc[NICHE]!;
    const b = await l.engine.writeBroadcast({ product: p, voc, angle: 'histoire', audience: 'niche', bannedClaims: [] }, mindOf(l.world, l.world.company.agents[0]!));
    expect(b.body).toMatch(/Exemple type : \p{Lu}/u);
  });

  it('what the writer is told not to say does not reach the mail', async () => {
    const l = await lab();
    const p = await guide(l);
    const voc = l.world.company.research.voc[NICHE]!;
    const word = voc.phrases[0]!.split(/\s+/).slice(0, 3).join(' ');
    const steps = await l.engine.writeEmailSequence({ product: p, voc, bannedClaims: [word] }, mindOf(l.world, l.world.company.agents[0]!));
    expect(steps.flatMap((s) => [s.subject, s.body]).join(' ').toLowerCase()).not.toContain(word.toLowerCase());
  });

  it('the lead magnet is built on the mistakes of the research and a sheet of the guide', async () => {
    const l = await lab();
    const p = await guide(l);
    const voc = l.world.company.research.voc[NICHE]!;
    const magnet = await l.engine.writeLeadMagnet({ product: p, content: p.content!, voc }, mindOf(l.world, l.world.company.agents[0]!));
    expect(magnet.title).toMatch(/^Les \d erreurs/);
    expect(magnet.chapters).toHaveLength(1);
    expect(magnet.chapters[0]!.steps.length).toBeGreaterThanOrEqual(3);
    expect(kitSheets(p.content!).map((v) => v.title)).toContain(kitSheets(magnet)[0]!.title);
    expect(findBannedClaims([JSON.stringify(magnet)], voc.bannedClaims)).toEqual([]);
    expect(magnet.nextStep.upsellProductId).toBeNull();
  });
});

// ───────────────────────────── the files ─────────────────────────────

describe('the files', () => {
  async function fixture() {
    const l = await lab();
    const p = await guide(l);
    const magnet = await l.engine.writeLeadMagnet({ product: p, content: p.content!, voc: l.world.company.research.voc[NICHE]! }, mindOf(l.world, l.world.company.agents[0]!));
    return { l, p, magnet, dir: tmp() };
  }

  it('the lead magnet is 3 to 5 real pages, says its mistakes and its next step, the same bytes twice', async () => {
    const { p, magnet, dir } = await fixture();
    const input = { product: p, content: magnet, design: p.design!, brand: 'Pixel Agency' };
    const a = await deliverables.renderLeadMagnet({ ...input, outFile: join(dir, 'a.pdf') });
    const b = await deliverables.renderLeadMagnet({ ...input, outFile: join(dir, 'b.pdf') });
    expect(a.pages).toBeGreaterThanOrEqual(3);
    expect(a.pages).toBeLessThanOrEqual(5);
    expect(readFileSync(join(dir, 'a.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(readFileSync(join(dir, 'a.pdf')).equals(readFileSync(join(dir, 'b.pdf')))).toBe(true);
    const pages = await pdfPagesText(join(dir, 'a.pdf'));
    expect(pages).toHaveLength(a.pages);
    expect(pages.join(' ')).toContain('ET MAINTENANT');
    expect(pages.join(' ').replace(/\s+/g, ' ')).toContain('À la place');
  });

  it('a long text stays in 5 pages: the magnet is cut, it never grows', async () => {
    const { p, magnet, dir } = await fixture();
    const long: PdfContent = { ...magnet, chapters: Array.from({ length: 6 }, () => magnet.chapters[0]!) };
    const r = await deliverables.renderLeadMagnet({ product: p, content: long, design: p.design!, brand: 'Pixel Agency', outFile: join(dir, 'long.pdf') });
    expect(r.pages).toBe(5);
  });

  it('a magnet with no sheet to give is still 3 pages at least', async () => {
    const { p, magnet, dir } = await fixture();
    const bare: PdfContent = { ...magnet, bonus: { ...magnet.bonus, visual: null } };
    const r = await deliverables.renderLeadMagnet({ product: p, content: bare, design: p.design!, brand: 'Pixel Agency', outFile: join(dir, 'bare.pdf') });
    expect(r.pages).toBeGreaterThanOrEqual(3);
  });

  it('the kit prints every sheet, every step and the checklists, none of the reading, the same bytes twice', async () => {
    const { p, dir } = await fixture();
    const content = kitContent(p)!;
    const kit = { ...p, id: 'prd_kit', kind: 'kit' as const, title: content.title, content };
    const input = { product: kit, content, design: p.design!, brand: 'Pixel Agency' };
    const a = await deliverables.renderKit({ ...input, outFile: join(dir, 'a.pdf') });
    await deliverables.renderKit({ ...input, outFile: join(dir, 'b.pdf') });
    expect(readFileSync(join(dir, 'a.pdf')).equals(readFileSync(join(dir, 'b.pdf')))).toBe(true);
    const sheets = kitSheets(p.content!);
    expect(a.pages).toBeGreaterThanOrEqual(sheets.length + 3);
    const read = (s: string): string => s.replace(/\s+/g, ' ').replace(/[  ]/g, ' ').toLowerCase();
    const all = read((await pdfPagesText(join(dir, 'a.pdf'))).join(' '));
    for (const sheet of sheets) expect(all).toContain(read(sheet.title));
    expect(all).toContain(`fiche ${sheets.length} sur ${sheets.length}`);
    const chapter = p.content!.chapters[0]!;
    expect(all).toContain(read(chapter.steps[0]!).slice(0, 40));
    expect(all).not.toContain(read(chapter.paragraphs[0]!).slice(0, 60));
  });

  it('a guide with nothing to print has no kit', async () => {
    const { p } = await fixture();
    const content = p.content!;
    const plain: PdfContent = { ...content, chapters: content.chapters.map((c) => ({ ...c, visual: null, figure: null })), bonus: { ...content.bonus, visual: null, figure: null } };
    expect(kitSheets(plain)).toEqual([]);
    expect(kitContent({ ...p, content: plain })).toBeNull();
  });

  it('a kit keeps a guide\'s worth for its buyers, and its page breaks no promise', async () => {
    const { l, p } = await fixture();
    const voc = l.world.company.research.voc[NICHE]!;
    const content = kitContent(p)!;
    const kit: Product = { ...p, kind: 'kit', title: content.title, subtitle: content.subtitle, content };
    const quality = sim.scorePdf(content, { audience: p.audience, problem: p.problem, voc, design: p.design });
    expect(quality.overall).toBeGreaterThanOrEqual(sim.scorePdf(p.content!, { audience: p.audience, problem: p.problem, voc, design: p.design }).overall - 8);
    expect(quality.promiseMatch).toBe(100);
    const page = sim.scoreSalesPage(kitOffer(kit, p), { ...kit, quality }, voc);
    expect(page.promiseMatch).toBeGreaterThanOrEqual(70);
    expect(page.compliance).toBe(100);
  });

  /** The kit of a guide of the fixture, with `edit` on its content, page by page as printed. */
  async function kitPages(edit: (c: PdfContent) => PdfContent = (c) => c): Promise<{ pages: string[]; previews: { label: string; svg: string }[] }> {
    const { p, dir } = await fixture();
    const content = edit(kitContent(p)!);
    const kit = { ...p, id: 'prd_kit', kind: 'kit' as const, title: content.title, content };
    const outFile = join(dir, 'kit.pdf');
    const res = await deliverables.renderKit({ product: kit, content, design: p.design!, brand: 'Pixel Agency', outFile });
    return { pages: pdfPagesText(outFile).map((s) => s.replace(/\s+/g, ' ')), previews: res.previews };
  }

  it('its sales page counts what it prints, sells the buyer\'s worries and says kit', async () => {
    const { p } = await fixture();
    const steps = ['Caler les siestes sur les fenêtres d’éveil.', 'Garder la même pièce.'];
    const edited: Product = { ...p, content: { ...p.content!, chapters: [{ ...p.content!.chapters[0]!, steps, checklist: ['Fait : caler les siestes sur les fenêtres d’éveil', 'Le carnet est ouvert'] }], bonus: { ...p.content!.bonus, steps: [], checklist: [] } } as PdfContent };
    const content = kitContent(edited)!;
    expect(content.subtitle).toContain('3 cases à cocher');
    const kit: Product = { ...p, kind: 'kit', title: content.title, content };
    const pains = ['Il se réveille toutes les deux heures'];
    const offer = kitOffer(kit, { title: 'Dormir enfin : pour en finir avec « il ne dort plus »', salesPage: { painBullets: pains } as Product['salesPage'] });
    expect(offer.painBullets).toEqual(pains);
    expect(offer.solution).not.toMatch(/«[^»]*«/);
    expect(new Set(kitOffer(kit, p).chapterBlurbs.map((b) => b.blurb)).size).toBe(kitOffer(kit, p).chapterBlurbs.length);
    expect(offer.chapterBlurbs[0]!.blurb).toContain('caler les siestes');
    const html = deliverables.renderSalesPageHtml({ product: { ...kit, salesPage: offer }, salesPage: offer, coverSvg: '<svg></svg>', design: p.design!, brand: 'Pixel Agency' });
    expect(html).not.toMatch(/le guide · |Obtenir le guide|Comment je reçois le guide|Ce guide vient de sortir/);
    expect(html).toContain('Obtenir le kit');
  });

  it('the chapter that only dates the other steps stays on its sheet: a page later it would be read twice', async () => {
    const plan = { type: 'grid' as const, title: 'Votre plan, à cocher', labels: [], values: [], grid: { columns: ['Quand', 'À faire', 'Fait'], rows: ['Mars', 'Avril'], cells: [['Vérifier la charge admissible', null], ['Semer les aromatiques', null]] } };
    const edit = (c: PdfContent): PdfContent => ({ ...c, chapters: [{ ...c.chapters[0]!, visual: plan, figure: null, steps: ['Mars : vérifier la charge admissible.', 'Avril : semer les aromatiques.'], checklist: [] }, { ...c.chapters[1]!, steps: ['Une étape à part.'], checklist: [] }], bonus: { ...c.bonus, steps: [], checklist: [] } });
    const { pages } = await kitPages(edit);
    const all = pages.join(' ');
    expect(all).not.toContain('Mars : vérifier');
    expect(all).toContain('Une étape à part');
    expect(all).toContain('ÉTAPE 1');
    const { p } = await fixture();
    expect(kitContent({ ...p, content: edit(p.content!) })!.subtitle).toContain('1 case à cocher');
  });

  it('a kit has steps, not chapters', async () => {
    const { pages } = await kitPages((c) => ({ ...c, chapters: [{ ...c.chapters[0]!, steps: ['Trouver la cause dans ce chapitre.'], checklist: ['Relisez ce chapitre une fois.'] }] }));
    const all = pages.join(' ');
    expect(all).toContain('Trouver la cause dans cette étape');
    expect(all).toContain('Relisez cette étape');
    expect(all).not.toContain('ce chapitre');
  });

  it('a kit prints a list once: the checklist that says the steps again goes, whatever its end punctuation', async () => {
    const { pages } = await kitPages((c) => ({ ...c, chapters: [{ ...c.chapters[0]!, steps: ['Caler les siestes sur les fenêtres d’éveil.', 'Garder la même pièce.'], checklist: ['Fait : caler les siestes sur les fenêtres d’éveil', 'Fait : garder la même pièce', 'Le carnet est ouvert'], example: null }], bonus: { ...c.bonus, steps: [], checklist: [] } }));
    const all = pages.join(' ');
    expect(all.match(/Caler les siestes sur les fenêtres d’éveil/g)).toHaveLength(1);
    expect(all.match(/Garder la même pièce/g)).toHaveLength(1);
    expect(all).toContain('Le carnet est ouvert');
  });

  it('a sheet that ends high leaves room to write, as it does in the guide', async () => {
    const short = { type: 'grid' as const, title: 'Une fiche courte', labels: [], values: [], grid: { columns: ['Question', 'Votre réponse'], rows: ['Une', 'Deux', 'Trois'] } };
    const { pages } = await kitPages((c) => ({ ...c, chapters: [{ ...c.chapters[0]!, visual: short, figure: null }], bonus: { ...c.bonus, visual: null } }));
    expect(pages.find((s) => s.includes('Une fiche courte') && s.includes('À IMPRIMER'))).toContain('VOS NOTES');
  });

  it('a kit never ends on one box alone, and its last page is ruled down to its foot', async () => {
    let boxes = 0;
    for (let n = 30; n <= 70; n += 1) {
      const lines = Array.from({ length: n }, (_, k) => `Ligne à cocher numéro ${k + 1}`);
      const { pages } = await kitPages((c) => ({ ...c, chapters: [{ ...c.chapters[0]!, steps: lines, checklist: [], example: null }], bonus: { ...c.bonus, steps: [], checklist: [] } }));
      const last = pages.at(-1)!;
      boxes = (last.match(/Ligne à cocher/g) ?? []).length;
      expect(boxes, `${n} lignes`).toBeGreaterThanOrEqual(2);
      if (boxes < 30) expect(last, `${n} lignes`).toContain('VOS NOTES');
    }
  });

  it('a kit shows its real pages in the shop window: each kind once, greeked, none of them mocked', async () => {
    const { previews } = await kitPages();
    expect(previews.map((v) => v.label)).toEqual(['Couverture', 'Le contenu du kit', 'Fiche à imprimer', 'Le plan à cocher']);
    for (const { svg } of previews) {
      expect(svg).toMatch(/^<svg/);
      expect(svg).not.toMatch(/<text\b/);
      expect(svg.length).toBeLessThanOrEqual(700_000);
    }
  });

  it('the sequence reads as a page, its text escaped', () => {
    const html = renderSequenceHtml({ title: 'Séquence <test>', brand: 'Pixel', steps: [{ day: 0, kind: 'value', subject: 'Objet & cie', body: 'Bonjour,\n\nPremier <b>texte</b>.' }] });
    expect(html).toContain('Objet &amp; cie');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<script');
  });
});

// ───────────────────────────── the handlers ─────────────────────────────

describe('each task leaves its file or its state', () => {
  it('the lead magnet: a file, a deliverable, and the page starts taking addresses', async () => {
    const l = await lab();
    const p = await guide(l);
    const { task, out } = await run(l, 'write_lead_magnet', p);
    expect(out.fail).toBeUndefined();
    expect(p.leadMagnet).toMatchObject({ day: l.world.day });
    expect(p.leadMagnet!.title).toMatch(/erreurs/);
    expect(existsSync(absPath(l.ctx, p.leadMagnet!.file))).toBe(true);
    const d = l.world.company.deliverables.find((x) => x.kind === 'lead_magnet')!;
    expect(d).toMatchObject({ productId: p.id, path: p.leadMagnet!.file });
    expect(task.deliverableIds).toContain(d.id);
    expect((await run(l, 'write_lead_magnet', p)).out.output).toMatchObject({ skipped: true });
    expect(l.world.company.deliverables.filter((x) => x.kind === 'lead_magnet')).toHaveLength(1);
  });

  it('the sequence: active at the tool, a file to read, every mail scored', async () => {
    const l = await lab();
    const p = await guide(l);
    const { out } = await run(l, 'write_email_sequence', p);
    expect(out.fail).toBeUndefined();
    const seq = l.world.market.audience!.sequences[0]!;
    expect(seq).toMatchObject({ nicheId: NICHE, productId: p.id, status: 'active' });
    expect(seq.steps).toHaveLength(5);
    for (const s of seq.steps) expect(s.score).toBeGreaterThanOrEqual(60);
    expect(l.ctx.tools.listStats().sequences).toEqual([{ nicheId: NICHE, productId: p.id, status: 'active' }]);
    const d = l.world.company.deliverables.find((x) => x.kind === 'email_sequence')!;
    expect(readFileSync(absPath(l.ctx, d.path!), 'utf8')).toContain(seq.steps[0]!.subject.replace(/'/g, '&#39;').slice(0, 10));
  });

  it('the broadcast: queued at the tool with the angle the bandit chose', async () => {
    const l = await lab();
    const p = await guide(l);
    const { out } = await run(l, 'send_broadcast', p, { audience: 'niche' });
    const queued = audienceOf(l.world).queue;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ productId: p.id, audience: 'niche', hasUnsubscribe: true, status: 'queued' });
    expect(EMAIL_ANGLES).toContain(queued[0]!.angle);
    expect(out.output).toMatchObject({ broadcastId: queued[0]!.id, angle: queued[0]!.angle });
    expect(queued[0]!.score).toBeGreaterThanOrEqual(60);
  });

  it('a launch says so and teaches the bandit nothing', async () => {
    const l = await lab();
    const p = await guide(l);
    await run(l, 'send_broadcast', p, { audience: 'launch' });
    expect(audienceOf(l.world).queue[0]).toMatchObject({ audience: 'launch', angle: 'lancement' });
    expect(l.world.company.bandits[angleDimension(NICHE)]).toBeUndefined();
  });

  it('a refused claim never leaves, whoever wrote it: the tool holds, and nothing is queued', async () => {
    const l = await lab();
    const p = await guide(l);
    const bad = { ...l.engine, writeBroadcast: async () => ({ subject: 'Résultat garanti en 7 jours', body: 'Une méthode miracle pour le guide.', hasUnsubscribe: true }) } as unknown as ContentEngine;
    const { ctx } = l;
    const held = ctx.engine;
    ctx.engine = bad;
    const { out } = await run(l, 'send_broadcast', p, { audience: 'niche' });
    ctx.engine = held;
    expect(out.output).toMatchObject({ skipped: true, refused: true });
    expect(out.summary).toMatch(/interdite/);
    expect(audienceOf(l.world).queue).toEqual([]);
    const badSeq = { ...l.engine, writeEmailSequence: async () => [{ day: 0, kind: 'value', subject: 'Résultat garanti en 7 jours', body: 'Méthode secrète.' }] } as unknown as ContentEngine;
    ctx.engine = badSeq;
    const seq = await run(l, 'write_email_sequence', p);
    ctx.engine = held;
    expect(seq.out.fail).toMatch(/interdite/);
    expect(audienceOf(l.world).sequences).toEqual([]);
  });

  it('a week already full refuses the mail and costs the writer nothing', async () => {
    const l = await lab();
    const p = await guide(l);
    for (let i = 0; i < 2; i++) await run(l, 'send_broadcast', p, { audience: 'niche' });
    const third = await run(l, 'send_broadcast', p, { audience: 'niche' });
    expect(third.out.fail).toBeUndefined();
    expect(third.out.output).toMatchObject({ refused: true });
    expect(audienceOf(l.world).queue).toHaveLength(2);
  });

  it('the kit: its own product, the guide\'s art, a real PDF, a price from its guide, then the shop', async () => {
    const l = await lab();
    const p = await guide(l, { price: 29 });
    const task = createTask(l.world, { kind: 'design_bump', input: { productId: p.id, nicheId: p.nicheId }, priority: 1 });
    await stepUntil(l.company, () => task.status === 'done');
    const kit = l.world.company.products.find((x) => x.kind === 'kit')!;
    expect(p.bumpProductId).toBe(kit.id);
    expect(kit).toMatchObject({ nicheId: p.nicheId, audience: p.audience, price: kitPrice(29), upsellProductId: null });
    expect(kit.design).toEqual(p.design);
    expect(existsSync(absPath(l.ctx, kit.files.pdf!))).toBe(true);
    const shop = readFileSync(absPath(l.ctx, kit.files.salesPage!), 'utf8');
    expect(shop).toContain('Ajouter le kit');
    expect(kit.files.previews!.length).toBeGreaterThanOrEqual(4);
    for (const rel of kit.files.previews!) expect(existsSync(absPath(l.ctx, rel)), rel).toBe(true);
    expect(shop.match(/<figure class="leaf">/g)?.length).toBeGreaterThanOrEqual(4);
    expect(shop).toContain('Ces pages viennent du kit');
    expect(kit.pdfFacts!.sheets).toBe(kitSheets(p.content!).length);
    await stepUntil(l.company, () => kit.status === 'live');
    expect(kit.launchedDay).toBe(l.world.day);
    expect(l.world.company.tasks.filter((t) => t.kind === 'publish_product' && t.input.productId === kit.id)).toHaveLength(1);
    expect(l.world.company.tasks.filter((t) => t.kind === 'send_broadcast')).toEqual([]); // a kit is no launch
  });

  it('a kit is never a second guide: no cold ads, no organic, no price of its own, no clash in its niche', async () => {
    const l = await lab();
    const p = await guide(l, { price: 19 });
    await run(l, 'design_bump', p);
    const kit = l.world.company.products.find((x) => x.kind === 'kit')!;
    expect(isUpsellProduct(l.world, kit.id)).toBe(true);
    expect(promotionBlock(l.world, kit)).toBeTruthy();
    expect(priceCeiling(l.world, kit).ceiling).toBe(kit.price);
    expect(nicheCollision(l.world, kit)).toBeNull();
    expect(nicheCollision(l.world, { ...kit, kind: 'guide', title: p.title })).toBeTruthy(); // the rule still stands for guides
    p.status = 'paused';
    expect(isUpsellProduct(l.world, kit.id)).toBe(true); // an orphan kit is still no guide
    expect(isUpsellProduct(l.world, p.id)).toBe(false);
  });

  it('a second order for a kit that exists adds nothing', async () => {
    const l = await lab();
    const p = await guide(l);
    await run(l, 'design_bump', p);
    const count = l.world.company.products.length;
    const again = await run(l, 'design_bump', p);
    expect(again.out.output).toMatchObject({ existing: true });
    expect(l.world.company.products).toHaveLength(count);
  });

  it('no sheet, no kit', async () => {
    const l = await lab();
    const p = await guide(l);
    p.content = { ...p.content!, chapters: p.content!.chapters.map((c) => ({ ...c, visual: null, figure: null })), bonus: { ...p.content!.bonus, visual: null, figure: null } };
    expect((await run(l, 'design_bump', p)).out.output).toMatchObject({ noSheets: true });
    expect(p.bumpProductId).toBeUndefined();
  });
});

// ───────────────────────────── the founder ─────────────────────────────

describe('approval mode', () => {
  /** A real day: the task waits for the founder, or it goes. */
  async function waiting(l: Lab, kind: TaskKind, p: Product, input: Record<string, unknown> = {}): Promise<Task> {
    const task = createTask(l.world, { kind, input: { productId: p.id, nicheId: p.nicheId, ...input }, priority: 1 });
    await stepUntil(l.company, () => task.status === 'awaiting_founder');
    return task;
  }

  it('each broadcast waits, and the text they approved is the text that goes out', async () => {
    const l = await lab({ founderApproval: true });
    const p = await guide(l);
    const task = await waiting(l, 'send_broadcast', p, { audience: 'niche' });
    expect(audienceOf(l.world).queue).toEqual([]);
    expect(l.world.market.audience?.sent ?? []).toEqual([]);
    expect(l.world.company.pendingApprovals).toContain(task.id);
    const draft = task.input.draft as { subject: string };
    expect(task.input.founderAsk).toContain(draft.subject.slice(0, 30));
    l.company.approve(task.id, true);
    await stepUntil(l.company, () => task.status === 'done');
    const sent = [...audienceOf(l.world).queue, ...audienceOf(l.world).sent];
    expect(sent.map((b) => b.subject)).toEqual([draft.subject]);
  });

  it('the sequence waits too, and the lead magnet does not open the page before their yes', async () => {
    const l = await lab({ founderApproval: true });
    const p = await guide(l);
    const seq = await waiting(l, 'write_email_sequence', p);
    expect(l.world.market.audience?.sequences ?? []).toEqual([]);
    const magnet = await waiting(l, 'write_lead_magnet', p);
    expect(p.leadMagnet).toBeUndefined();
    expect(l.world.company.deliverables.filter((d) => d.kind === 'lead_magnet')).toHaveLength(1);
    l.company.approve(seq.id, true);
    l.company.approve(magnet.id, true);
    await stepUntil(l.company, () => seq.status === 'done' && magnet.status === 'done');
    expect(audienceOf(l.world).sequences[0]).toMatchObject({ status: 'active', productId: p.id });
    expect(p.leadMagnet).not.toBeNull();
    expect(l.world.company.deliverables.filter((d) => d.kind === 'lead_magnet')).toHaveLength(1); // the same file, not a second one
  });

  it('a kit waits at the shop\'s door, and a refusal leaves it off sale', async () => {
    const l = await lab({ founderApproval: true });
    const p = await guide(l);
    createTask(l.world, { kind: 'design_bump', input: { productId: p.id, nicheId: p.nicheId }, priority: 1 });
    const publish = (): Task | undefined => l.world.company.tasks.find((t) => t.kind === 'publish_product' && t.status === 'awaiting_founder');
    await stepUntil(l.company, () => !!publish());
    const kit = l.world.company.products.find((x) => x.kind === 'kit')!;
    expect(kit.status).not.toBe('live');
    l.company.approve(publish()!.id, false);
    expect(kit.status).toBe('paused');
  });

  it('a refused mail holds on its guide for a week, and the plan does not ask again', async () => {
    const l = await lab({ founderApproval: true });
    const p = await guide(l, { sales: 100 });
    stage(l.world, 'adequation');
    subscribers(l.world, NICHE, AUDIENCE.minList);
    const task = await waiting(l, 'send_broadcast', p, { audience: 'niche' });
    l.company.approve(task.id, false);
    expect(task.status).toBe('cancelled');
    const hold = l.world.company.holds!.find((h) => h.kind === 'emails')!;
    expect(hold).toMatchObject({ productId: p.id, until: l.world.day + REFUSAL_COOLDOWN_DAYS });
    expect(emailBlock(l.world, p)).toBe(hold.reason);
    expect(kinds(plan(l))).not.toContain('send_broadcast');
    const today = l.world.day;
    l.world.day = hold.until! + 1;
    expect(emailBlock(l.world, p)).toBeNull();
    expect(kinds(plan(l))).toContain('send_broadcast');
    l.world.day = today;
  });

  it('a refusal of anything else is none of the list\'s business', async () => {
    const l = await lab();
    const p = await guide(l);
    const task = createTask(l.world, { kind: 'launch_campaign', input: { productId: p.id } });
    refuseEmail(l.ctx, task);
    expect((l.world.company.holds ?? []).filter((h) => h.kind === 'emails')).toEqual([]);
  });
});

describe('holds', () => {
  it('a hold on all mails stops every mail, a hold on one guide stops that one, a guide off the shelf is not pitched', async () => {
    const l = await lab();
    const p = await guide(l);
    const other = await guide(l);
    const all = addHold(l.world, { kind: 'emails', productId: null, until: null, reason: 'pas d’e-mail pour l’instant' });
    expect(emailBlock(l.world, p)).toBe(all.reason);
    const held = await run(l, 'send_broadcast', p, { audience: 'niche' });
    expect(held.out.output).toMatchObject({ skipped: true });
    expect((await run(l, 'write_email_sequence', p)).out.output).toMatchObject({ skipped: true });
    expect((await run(l, 'write_lead_magnet', p)).out.output).toMatchObject({ skipped: true });
    expect(audienceOf(l.world).queue).toEqual([]);
    all.liftedDay = l.world.day;
    addHold(l.world, { kind: 'emails', productId: p.id, until: null, reason: 'pas ce guide' });
    expect(emailBlock(l.world, p)).toBe('pas ce guide');
    expect(emailBlock(l.world, other)).toBeNull();
    addHold(l.world, { kind: 'product', productId: other.id, until: null, reason: 'de côté' });
    expect(emailBlock(l.world, other)).toBe('de côté');
  });
});

// ───────────────────────────── the plan ─────────────────────────────

describe('the list\'s plan', () => {
  it('the control has no list, whatever it sells', async () => {
    const l = await lab({ scaling: false });
    await guide(l, { sales: 500 });
    stage(l.world, 'portefeuille');
    expect(plan(l)).toEqual([]);
    const before = l.world.idCounter;
    await audienceMorning(l.ctx);
    expect(l.world.idCounter).toBe(before);
  });

  it('the first stage makes neither, and each stage says from how many sales', async () => {
    const l = await lab();
    const p = await guide(l, { sales: 500 });
    expect(plan(l)).toEqual([]);
    stage(l.world, 'adequation');
    p.stats.sales = 29;
    expect(plan(l)).toEqual([]);
    p.stats.sales = 30;
    expect(kinds(plan(l))).toEqual(['write_lead_magnet']);
    p.stats.sales = 40;
    expect(kinds(plan(l))).toEqual(['write_lead_magnet', 'design_bump']);
    stage(l.world, 'acceleration');
    p.stats.sales = 20;
    expect(kinds(plan(l))).toEqual(['write_lead_magnet', 'design_bump']);
  });

  it('a follow-up, a kit and a guide with nothing to print ask for nothing', async () => {
    const l = await lab();
    stage(l.world, 'adequation');
    const main = await guide(l, { sales: 100, leadMagnet: { title: 'x', file: 'x.pdf', day: 1 } });
    await run(l, 'design_bump', main);
    const kit = l.world.company.products.find((x) => x.kind === 'kit')!;
    kit.status = 'live';
    kit.stats.sales = 100;
    const follow = await guide(l, { sales: 100, nicheId: NICHE });
    main.upsellProductId = follow.id;
    const items = plan(l).filter((i) => i.kind === 'write_lead_magnet' || i.kind === 'design_bump');
    expect(items).toEqual([]);
  });

  it('nothing is asked twice', async () => {
    const l = await lab();
    stage(l.world, 'adequation');
    await guide(l, { sales: 100 });
    await audienceMorning(l.ctx);
    const open = l.world.company.tasks.filter((t) => t.kind === 'write_lead_magnet' || t.kind === 'design_bump');
    expect(open.map((t) => t.kind).sort()).toEqual(['design_bump', 'write_lead_magnet']);
    await audienceMorning(l.ctx); // a tick that failed plays its morning again
    expect(l.world.company.tasks.filter((t) => t.kind === 'write_lead_magnet' || t.kind === 'design_bump')).toHaveLength(2);
  });

  it('a founder\'s launch hold stops the kit, not the magnet', async () => {
    const l = await lab();
    stage(l.world, 'adequation');
    await guide(l, { sales: 100 });
    addHold(l.world, { kind: 'launches', productId: null, until: null, reason: 'pas de nouveau produit' });
    expect(kinds(plan(l))).toEqual(['write_lead_magnet']);
  });

  it('a magnet asks for its sequence, once per niche, and a sequence whose guide left is written again', async () => {
    const l = await lab();
    const magnet = { title: 'x', file: 'x.pdf', day: 1 };
    const p = await guide(l, { leadMagnet: magnet });
    expect(kinds(plan(l))).toEqual(['write_email_sequence']);
    await guide(l, { leadMagnet: magnet });
    expect(kinds(plan(l))).toEqual(['write_email_sequence']);
    const { task } = await run(l, 'write_email_sequence', p);
    expect(plan(l)).toEqual([]); // on someone's desk
    task.status = 'done';
    expect(plan(l)).toEqual([]); // and now active
    p.status = 'killed';
    const items = plan(l);
    expect(kinds(items)).toEqual(['write_email_sequence']);
    expect(items[0]!.input.productId).not.toBe(p.id);
  });

  it('one mail a week per niche from 200 subscribers, on a guide the list has not heard of for three weeks', async () => {
    const l = await lab();
    const a = await guide(l, { id: 'prd_a' });
    const b = await guide(l, { id: 'prd_b' });
    l.world.day = 30;
    subscribers(l.world, NICHE, AUDIENCE.minList - 1);
    expect(kinds(plan(l))).toEqual([]);
    subscribers(l.world, NICHE, 1);
    expect(plan(l).map((i) => i.input)).toEqual([expect.objectContaining({ productId: a.id, audience: 'niche' })]);
    await audienceMorning(l.ctx);
    expect(plan(l)).toEqual([]); // already on someone's desk
    const first = l.world.company.tasks.find((t) => t.kind === 'send_broadcast')!;
    Object.assign(first, { status: 'done', dayDone: 30 });
    l.world.day = 36;
    expect(plan(l)).toEqual([]); // six days: the week is not over
    l.world.day = 37;
    expect(plan(l).map((i) => i.input.productId)).toEqual([b.id]); // a was pitched a week ago
    const second = createTask(l.world, { kind: 'send_broadcast', input: { productId: b.id, nicheId: NICHE } });
    Object.assign(second, { status: 'done', dayDone: 37 });
    l.world.day = 44;
    expect(plan(l)).toEqual([]); // both heard from it: nobody has rested three weeks
    l.world.day = 51;
    expect(plan(l).map((i) => i.input.productId)).toEqual([a.id]);
  });

  it('past three weeks every guide has rested as much: compaction, which takes those tasks, cannot change the pick', async () => {
    const l = await lab();
    const a = await guide(l, { id: 'prd_a' });
    const b = await guide(l, { id: 'prd_b' });
    subscribers(l.world, NICHE, AUDIENCE.minList);
    l.world.day = 60;
    const old = createTask(l.world, { kind: 'send_broadcast', input: { productId: a.id, nicheId: NICHE } });
    Object.assign(old, { status: 'done', dayDone: 30 });
    const withTask = plan(l).map((i) => i.input.productId);
    l.world.company.tasks = l.world.company.tasks.filter((t) => t.id !== old.id);
    expect(plan(l).map((i) => i.input.productId)).toEqual(withTask);
    expect(withTask).toEqual([a.id]);
    expect(b.id).not.toBe(a.id);
  });

  it('a kit is never the subject of a mail', async () => {
    const l = await lab();
    const p = await guide(l);
    await run(l, 'design_bump', p);
    l.world.company.products.find((x) => x.kind === 'kit')!.status = 'live';
    p.status = 'paused';
    l.world.day = 30;
    subscribers(l.world, NICHE, AUDIENCE.minList);
    expect(plan(l)).toEqual([]);
  });
});

describe('a launch', () => {
  const publish = (l: Lab, p: Product, input: Record<string, unknown> = {}): Task => createTask(l.world, { kind: 'publish_product', input: { productId: p.id, nicheId: p.nicheId, ...input } });

  it('goes to the niche\'s list and the buyers of its category, once', async () => {
    const l = await lab();
    const p = await guide(l, { status: 'ready', launchedDay: null });
    queueLaunch(l.ctx, publish(l, p));
    expect(l.world.company.tasks.filter((t) => t.kind === 'send_broadcast')).toEqual([]); // nobody on the list yet
    const { category } = l.ctx.tools.nicheBrief(NICHE)!;
    const cousin = l.world.market.niches.find((n) => n.id !== NICHE && n.category === category);
    subscribers(l.world, cousin?.id ?? NICHE, 3);
    queueLaunch(l.ctx, publish(l, p));
    expect(l.world.company.tasks.filter((t) => t.kind === 'send_broadcast').map((t) => t.input)).toEqual([expect.objectContaining({ productId: p.id, audience: 'launch' })]);
  });

  it('not for a new version, not for a guide already on sale, not for a kit, not under a hold, not in the control', async () => {
    const l = await lab();
    subscribers(l.world, NICHE, 50);
    const p = await guide(l, { status: 'ready', launchedDay: null });
    const live = await guide(l);
    const kit = await guide(l, { status: 'ready', launchedDay: null, kind: 'kit' });
    queueLaunch(l.ctx, publish(l, p, { republish: true }));
    queueLaunch(l.ctx, publish(l, live));
    queueLaunch(l.ctx, publish(l, kit));
    addHold(l.world, { kind: 'emails', productId: p.id, until: null, reason: 'non' });
    queueLaunch(l.ctx, publish(l, p));
    const off = await lab({ scaling: false });
    subscribers(off.world, NICHE, 50);
    queueLaunch(off.ctx, publish(off, await guide(off, { status: 'ready', launchedDay: null })));
    expect([...l.world.company.tasks, ...off.world.company.tasks].filter((t) => t.kind === 'send_broadcast')).toEqual([]);
  });

  it('a team that owns none of the list asks for none of it: nothing waits for ever', async () => {
    const asked = async (team: 'lean' | 'legacy31') => {
      const l = await lab({ org: { team, autoHire: false, payroll: false } });
      stage(l.world, 'adequation');
      await guide(l, { sales: 100, leadMagnet: { title: 'Aimant', file: 'files/x/aimant.pdf', day: 1 } });
      await guide(l, { sales: 100 });
      subscribers(l.world, NICHE, AUDIENCE.minList);
      await audienceMorning(l.ctx);
      const list: TaskKind[] = ['design_bump', 'send_broadcast', 'write_email_sequence', 'write_lead_magnet'];
      const morning = [...new Set(l.world.company.tasks.map((t) => t.kind).filter((k) => list.includes(k)))].sort();
      l.world.company.tasks = [];
      queueLaunch(l.ctx, publish(l, await guide(l, { status: 'ready', launchedDay: null })));
      return { morning, launch: l.world.company.tasks.filter((t) => t.kind === 'send_broadcast').length };
    };
    expect(await asked('lean')).toEqual({ morning: ['design_bump', 'send_broadcast', 'write_email_sequence', 'write_lead_magnet'], launch: 1 });
    expect(await asked('legacy31')).toEqual({ morning: [], launch: 0 });
  });

  it('a publish closing in a real day queues it through the pillar', async () => {
    const l = await lab();
    subscribers(l.world, NICHE, 50);
    const p = await guide(l, { status: 'ready', launchedDay: null, files: { pdf: 'files/x/guide.pdf', cover: null, salesPage: 'files/x/page.html' } });
    const { writeRunFile } = await import('../src/runtime/ctx.js');
    await writeRunFile(l.ctx, p.files.pdf!, '%PDF-');
    await writeRunFile(l.ctx, p.files.salesPage!, '<html></html>');
    p.price = 19;
    const task = createTask(l.world, { kind: 'publish_product', input: { productId: p.id, nicheId: p.nicheId }, reviewer: null, priority: 1 });
    await stepUntil(l.company, () => task.status === 'done');
    expect(l.world.company.tasks.filter((t) => t.kind === 'send_broadcast').map((t) => t.input.audience)).toEqual(['launch']);
  });
});

describe('what the list teaches', () => {
  it('the bandit of a niche is paid in open rates, the launch teaches it nothing', async () => {
    const l = await lab();
    const p = await guide(l);
    subscribers(l.world, NICHE, 400);
    const a = audienceOf(l.world);
    const sent = (id: string, day: number, audience: Broadcast['audience'], angle: string, delivered: number, opens: number): Broadcast => ({
      id, day, nicheId: NICHE, productId: p.id, audience, subject: 'Objet', body: 'Texte', angle, score: 80, hasUnsubscribe: true, status: 'sent', delivered, opens, clicks: 0, sales: 0, revenue: 0, unsubscribed: 0,
    });
    a.sent.push(sent('b1', l.world.day - 1, 'niche', 'astuce', 100, 40), sent('b2', l.world.day, 'niche', 'erreur', 100, 40), sent('b3', l.world.day, 'launch', 'lancement', 100, 90));
    rewardAngles(l.ctx);
    const stats = learning.armStats(l.world, angleDimension(NICHE));
    expect(stats.find((s) => s.key === 'erreur')?.pulls).toBeGreaterThan(0);
    expect(stats.find((s) => s.key === 'astuce')?.pulls ?? 0).toBe(0); // yesterday's was paid yesterday
    expect(stats.find((s) => s.key === 'lancement')).toBeUndefined();
  });

  it('the angle draw has its own stream: the company\'s rng does not move', async () => {
    const l = await lab();
    const p = await guide(l);
    const before = l.ctx.rng.state();
    await run(l, 'send_broadcast', p, { audience: 'niche' });
    expect(l.ctx.rng.state()).toBe(before);
  });
});

describe('a kit follows its guide', () => {
  async function kitted(price = 19): Promise<{ l: Lab; p: Product; kit: Product }> {
    const l = await lab();
    const p = await guide(l, { price });
    await run(l, 'design_bump', p);
    const kit = l.world.company.products.find((x) => x.kind === 'kit')!;
    kit.status = 'live';
    return { l, p, kit };
  }

  it('in price', async () => {
    const { l, p, kit } = await kitted(19);
    expect(kit.price).toBe(6);
    p.price = 29;
    await audienceMorning(l.ctx);
    expect(kit.price).toBe(kitPrice(29));
  });

  it('out of the shop', async () => {
    const { l, p, kit } = await kitted();
    await killProduct(l.ctx, p, 'test');
    expect(kit).toMatchObject({ status: 'killed', decision: { status: 'killed' } });
  });

  it('and buyers who dislike it get no rewrite: it leaves', async () => {
    const { l, p, kit } = await kitted();
    kit.stats.reviews = [1, 2, 3, 4, 5].map((n) => ({ id: `rev_${n}`, day: 1, customerId: `c_${n}`, rating: 1 as const, text: 'Non.' }));
    kit.stats.rating = 1;
    kit.stats.ratingCount = 5;
    kit.stats.ratingSum = 5;
    await audienceMorning(l.ctx);
    expect(kit.status).toBe('killed');
    expect(p.status).toBe('live');
    expect(l.world.company.tasks.filter((t) => t.input.productId === kit.id && t.kind === 'write_pdf')).toEqual([]);
  });

  it('whatever became of its guide: a kit whose guide is off sale still leaves', async () => {
    const { l, p, kit } = await kitted();
    p.status = 'paused';
    kit.stats.reviews = [1, 2, 3, 4, 5].map((n) => ({ id: `rev_${n}`, day: 1, customerId: `c_${n}`, rating: 1 as const, text: 'Non.' }));
    kit.stats.rating = 1;
    kit.stats.ratingCount = 5;
    kit.stats.ratingSum = 5;
    await audienceMorning(l.ctx);
    expect(kit.status).toBe('killed');
  });

  it('refunds and a page lesson ask nothing of a kit: the morning plan never writes a guide over it', async () => {
    const { l, kit } = await kitted();
    l.world.day = 20;
    kit.launchedDay = 1;
    kit.stats.sales = 14;
    for (let i = 0; i < 14; i++) l.world.market.orders.push({ id: `ord_k${i}`, day: 3 + i, customerId: `c_${i}`, productId: kit.id, price: kit.price, source: 'bump', campaignId: null, creatorId: null, refunded: i < 4, chargeback: false });
    l.world.company.lessons.push({ key: learning.LESSON_KEYS.page(kit.id), insight: 'Reprendre les mots des clients sur la page.', day: 19 } as Lesson);
    expect(refundsWorthRework(productMetrics(l.world, kit.id, 1).refunds, productMetrics(l.world, kit.id, 1).sales)).toBe(true); // a guide would go to its v2 on this
    const { items } = await buildHeuristicPlan(l.ctx);
    expect(items.filter((i) => i.input.productId === kit.id)).toEqual([]);
    expect(kit.version).toBe(1);
  });

  it('a kit taken off sale is not rewritten either', async () => {
    const { l, kit } = await kitted();
    kit.status = 'paused';
    const { items } = await buildHeuristicPlan(l.ctx);
    expect(items.filter((i) => i.input.productId === kit.id)).toEqual([]);
  });

  it('no plan can order a new version of a kit, whoever wrote the plan', async () => {
    const { l, kit } = await kitted();
    const before = l.world.company.tasks.length;
    const created = materialize(l.ctx, [{ kind: 'write_pdf', title: 'Réécrire', dept: 'direction', priority: 1, input: { productId: kit.id, pipeline: 'v2', feedback: [] }, why: 'Boucle qualité' } as DayPlanItem], { createdBy: 'ceo', missionId: null });
    expect(created).toEqual([]);
    expect(kit.version).toBe(1);
    expect(l.world.company.tasks).toHaveLength(before);
  });
});

// ───────────────────────────── whole days ─────────────────────────────

describe('whole days', () => {
  async function arm(reloadEvery: number, ticks: number) {
    const l = await lab({ startingCash: 2000 });
    stage(l.world, 'adequation');
    await guide(l, { id: 'prd_a', sales: 100 });
    subscribers(l.world, NICHE, AUDIENCE.minList);
    let { world, company } = l;
    for (let i = 1; i <= ticks; i++) {
      await company.step();
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = l.reopen(world);
      }
    }
    return world;
  }

  /** Everything the run decided: only the wall clock, and what it stamps in a PDF, may differ. */
  const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  it('a reload at any tick of days with a magnet, a sequence, a mail and a kit ends like a straight run', { timeout: 240_000 }, async () => {
    const ticks = 6 * 12;
    const straight = await arm(0, ticks);
    const reloaded = await arm(7, ticks); // 7 and 12 share no divisor: reloads fall on every tick of the day
    const done = (k: TaskKind): number => straight.company.tasks.filter((t) => t.kind === k && t.status === 'done').length;
    expect(done('write_lead_magnet')).toBe(1);
    expect(done('write_email_sequence')).toBe(1);
    expect(done('send_broadcast')).toBeGreaterThanOrEqual(1);
    expect(done('design_bump')).toBe(1);
    expect(decisions(reloaded) === decisions(straight)).toBe(true);
  });

  it('seed 7, 60 days: a list exists, and e-mail or kit orders are in the books', { timeout: 300_000 }, async () => {
    const world = createWorld(defaultScenario({ seed: 7, startingCash: 500, difficulty: 'normal', horizonDays: 60, mindMode: 'heuristic', maxComputeEur: 0, videoModel: 'off' }), 'test-lifecycle-60');
    const root = tmp();
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain });
    await company.runDays(60);
    const list = (company as unknown as { ctx: RuntimeCtx }).ctx.tools.listStats();
    expect(list.size).toBeGreaterThan(0);
    const owned = world.market.orders.filter((o) => o.source === 'email' || o.source === 'bump');
    expect(owned.length).toBeGreaterThan(0);
    expect(world.ledger.filter((e) => e.type === 'revenue' && /\((e-mails|offre à la commande)\)/.test(e.memo)).length).toBeGreaterThan(0);
    for (const kind of ['write_lead_magnet', 'write_email_sequence', 'send_broadcast', 'design_bump'] as TaskKind[]) {
      expect(world.company.tasks.filter((t) => t.kind === kind && t.status === 'failed'), kind).toEqual([]);
    }
    const cash = world.ledger.reduce((s, e) => s + e.amount, 0);
    expect(world.company.kpis.at(-1)!.cash).toBeCloseTo(cash, 1);
  });
});
