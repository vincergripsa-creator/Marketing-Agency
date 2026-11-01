import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChapterContent, DesignEffort, DesignSpec, NicheBrief, PdfContent, Product, VisualSpec } from '../src/shared.js';
import { createRng } from '../src/core/index.js';
import { advance, sanitizeFor, setFontDir } from '../src/deliverables/fonts.js';
import { demoContent, demoProduct } from '../src/deliverables/fixture.js';
import { posesOf } from '../src/deliverables/art/poses.js';
import { designFor, normalizeDesign } from '../src/deliverables/design.js';
import { effortFor } from '../src/deliverables/effort.js';
import { renderPdf } from '../src/deliverables/index.js';
import type { Block, ChecklistBlock, ExampleBlock, FigureBlock, HeadingBlock, NoteBlock, ParaBlock, SheetBlock, StepsBlock } from '../src/deliverables/layout/blocks.js';
import { chapterBlocks, FIGURE_FOOT, lineOf, noteBlock, paraBlock, quoteBlock, sheetBlock } from '../src/deliverables/layout/blocks.js';
import { BODY_BOTTOM, BODY_H, GRID, LAST_PAGE, MIN_PAGE_FILL, PAGE_FLOOR, PAGE_FULL, SHORT_PAGE, tabHeight, wrapWords } from '../src/deliverables/layout/grid.js';
import { LAYOUTS, layoutOf, paginate, type LayoutParams, type PagePlan, type Placed } from '../src/deliverables/layout/paginate.js';
import { finalWording, layoutPdf } from '../src/deliverables/pdf.js';
import { gridModel, layoutVisual, themeFor } from '../src/deliverables/pdfVisuals.js';
import { Scene, toSvg, type Op } from '../src/deliverables/scene.js';
import { VOICES } from '../src/deliverables/voices.js';
import { createContentEngine, upsellTopics } from '../src/minds/index.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { createMarketTools } from '../src/sim/index.js';
import { LEGACY } from './legacy.js';
import { pdfPagesText, pdfPageStreams } from './pdfText.js';

const PLAIN: LayoutParams = { space: 10.8, figureSlot: 'early', railFirst: false, notesFill: false };
const design = normalizeDesign(designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 }));
const theme = themeFor(design, VOICES.conte);

const para = (lines: number): ParaBlock => ({ t: 'para', lines: Array.from({ length: lines }, (_, k) => `ligne ${k + 1}`), style: 'body' });
const heading = (text = 'Une section'): HeadingBlock => ({ t: 'h2', text, h: 28.8 });
const steps = (...hs: number[]): StepsBlock => ({ t: 'steps', items: hs.map((h) => ({ lines: ['une étape'], h })) });
const figure = (h: number): FigureBlock => ({ t: 'figure', kind: 'cycle', h, draw: () => undefined, float: true });
const example = (h: number): ExampleBlock => ({ t: 'example', label: 'Exemple type', lines: ['un cas'], h });
const note = (h: number): NoteBlock => ({ t: 'note', text: 'À noter', lines: ['À noter'], h, rail: true });
const checklist = (rows: number, h = 20.7): ChecklistBlock => ({ t: 'checklist', items: Array.from({ length: rows }, (_, k) => `point ${k}`), h: rows * h, cols: 1, rows: Array.from({ length: rows }, () => ({ cells: [['point']], h })) });

const flowOf = (p: PagePlan): Placed[] => p.items.filter((i) => i.t !== 'rail' && i.t !== 'notes' && i.t !== 'end');
const textOf = (pages: PagePlan[]): PagePlan[] => pages.filter((p) => p.kind === 'text' || p.kind === 'figure');

/** Rules 1, 2 and 5, read from the plan alone: what the audit says must also be what a reader finds. */
function brokenRules(pages: PagePlan[]): string[] {
  const out: string[] = [];
  pages.forEach((page, n) => {
    const flow = flowOf(page);
    flow.forEach((item, i) => {
      if (item.t === 'para') {
        const count = item.block.lines.length;
        const taken = item.to - item.from;
        if (item.from > 0 && taken < 2) out.push(`p${n}: veuve`);
        if (item.to < count && taken < 2) out.push(`p${n}: orpheline`);
      }
      if (item.t === 'block' && item.block.t === 'h2') {
        const next = flow[i + 1];
        if (!next) out.push(`p${n}: titre seul en bas de page`);
        else if (next.t === 'para' && next.to - next.from < Math.min(3, next.block.lines.length)) out.push(`p${n}: titre suivi de ${next.to - next.from} lignes`);
      }
    });
  });
  return out;
}

const chapter = (over: Partial<ChapterContent> = {}): ChapterContent => ({
  title: 'Un chapitre', intro: 'Ce chapitre règle un point précis.',
  paragraphs: Array.from({ length: 4 }, (_, k) => `Paragraphe ${k + 1} : un chiot de 8 à 12 semaines tient environ une heure par mois d’âge, plus une. Au-delà, l’accident n’est pas de la désobéissance, c’est de la physiologie, et le punir après coup ne lui apprend rien sur ce qu’on attend de lui.`),
  steps: ['Notez chaque sortie pendant 2 jours.', 'Sortez-le dans les 5 minutes après chaque réveil.', 'Récompensez sur place.'],
  example: 'Exemple type : Manon programme une sortie après chaque sieste.',
  checklist: ['Le carnet est ouvert', 'L’endroit est choisi', 'Le mot-signal est le même', 'Les friandises sont dans la poche'],
  visual: null, ...over,
});

// ───────────────────────────── guides as the writers write them ─────────────────────────────

const mind = { agent: { id: 'ag', name: 'Margaux', role: 'Rédactrice', dept: 'studio', persona: '', skills: [], tools: [] }, playbook: [], brainNotes: [], lessons: [], day: 3 } as never;

async function guidesOf(nicheId: string, seed = 7): Promise<{ title: string; content: PdfContent }[]> {
  const world = createWorld(defaultScenario({ ...LEGACY, seed }), `test-layout-${seed}`);
  const tools = createMarketTools(world, createRng(seed));
  const brief = tools.nicheBrief(nicheId)!;
  const voc = tools.minePains(nicheId, 'deep');
  const eng = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
  const write = async (b: NicheBrief, title: string, upsellOf: Parameters<typeof eng.writeOutline>[0]['upsellOf']) => {
    const outline = await eng.writeOutline({ title, niche: b, voc, upsellOf }, mind);
    const draft = await eng.writePdfContent({ title, outline, niche: b, voc, upsellTitle: null, upsellOf }, mind);
    return (await eng.factCheck({ content: await eng.humanize({ content: draft, flagged: [], voc }, mind), voc }, mind)).content;
  };
  const title = (await eng.writeTitles({ niche: brief, voc, count: 3 }, mind))[0]!;
  const parent = await write(brief, title, null);
  const topic = upsellTopics(nicheId)[0]!;
  const follow = await write({ ...brief, problem: topic.pain, name: topic.title }, topic.title, { parentTitle: title, parentPromise: parent.promise, parentChapterTitles: parent.chapters.map((c) => c.title), topicId: topic.id });
  return [{ title, content: parent }, { title: topic.title, content: follow }];
}

const NICHES = ['proprete-chiot', 'sommeil-bebe', 'urssaf-micro'];
let written: { title: string; content: PdfContent }[] = [];
let dir = '';

const productOf = (title: string, content: PdfContent): Product => ({ ...demoProduct, title, content, audience: content.audience, subtitle: content.subtitle, problem: 'Le problème de départ que ce guide vient régler pour de bon.' });

/** Every guide of the suite with a rail, as P8.1 fills it: the rail is a block like any other. */
const withRail = (content: PdfContent): PdfContent => ({
  ...content,
  chapters: content.chapters.map((c) => ({ ...c, margin: { note: 'Un accident puni après coup n’apprend rien : le lien avec l’acte passé ne se fait pas.', quote: 'Il sort, renifle et rentre, puis l’accident arrive.' } })),
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'layout-'));
  for (const id of NICHES) written.push(...await guidesOf(id));
  written.push({ title: demoContent.title, content: demoContent });
}, 60_000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
afterEach(() => setFontDir());

const allOf = (): { title: string; content: PdfContent }[] => [...written, ...written.slice(0, 2).map((g) => ({ title: `${g.title} (rail)`, content: withRail(g.content) }))];

// ───────────────────────────── paginate ─────────────────────────────

describe('paginate: text', () => {
  it('splits a paragraph at line level, two lines at least on each side', () => {
    const room = Math.floor(BODY_H / GRID.baseline);
    for (let before = 1; before <= room + 2; before++) {
      for (const lines of [2, 3, 4, 5, 6, 7, 9]) {
        // the text goes on after it: a last page too short would hide the break by pulling lines over
        const pages = paginate([para(before), para(lines), para(30)], { ...PLAIN, space: 0 });
        expect(brokenRules(pages), `${before} + ${lines}`).toEqual([]);
        const printed = pages.flatMap(flowOf).filter((i) => i.t === 'para').reduce((a, i) => a + (i.t === 'para' ? i.to - i.from : 0), 0);
        expect(printed).toBe(before + lines + 30);
      }
    }
  });

  it('a heading keeps at least three lines of what follows, or moves with them', () => {
    const room = Math.floor(BODY_H / GRID.baseline);
    for (let before = room - 6; before <= room; before++) {
      for (const lines of [1, 3, 4, 5, 8]) {
        const pages = paginate([para(before), heading(), para(lines)], { ...PLAIN, space: 0 });
        expect(brokenRules(pages), `${before} + ${lines}`).toEqual([]);
      }
    }
    // a page with room for the heading and two lines only: both go over
    const pages = paginate([para(room - 4), heading(), para(20)], { ...PLAIN, space: 0 });
    expect(pages).toHaveLength(2);
    expect(flowOf(pages[1]!)[0]).toMatchObject({ t: 'block' });
  });

  it('a heading keeps the first step of what follows, and a step is never split', () => {
    const blocks = [para(44), heading(), steps(60, 60, 60)];
    const pages = paginate(blocks, { ...PLAIN, space: 0 });
    expect(flowOf(pages[0]!).some((i) => i.t === 'block')).toBe(false);
    expect(flowOf(pages[1]!)[0]).toMatchObject({ t: 'block' });
    const split = paginate([para(40), steps(100, 100, 100)], { ...PLAIN, space: 0 });
    expect(split).toHaveLength(2);
    const rows = split.flatMap(flowOf).filter((i) => i.t === 'rows');
    expect(rows.map((r) => (r.t === 'rows' ? [r.from, r.to] : []))).toEqual([[0, 1], [1, 3]]);
  });

  it('a checklist breaks with two rows at least on each side', () => {
    for (let rows = 10; rows <= 60; rows += 1) {
      const pages = paginate([para(10), checklist(rows, 20), para(30)], { ...PLAIN, space: 0 });
      const parts = pages.flatMap(flowOf).filter((i) => i.t === 'rows').map((r) => (r.t === 'rows' ? r.to - r.from : 0));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(rows);
      for (const n of parts) expect(n, `${rows} lignes`).toBeGreaterThanOrEqual(2);
    }
    expect(paginate([para(10), checklist(24, 20)], { ...PLAIN, space: 0 }).length).toBe(1);
    expect(paginate([para(10), checklist(40, 20)], { ...PLAIN, space: 0 }).length).toBe(2);
  });

  it('a trim moves paragraphs and leaves a list that has the room whole', () => {
    const blocks = [para(30), heading(), steps(60, 60, 60, 60), para(40)];
    const pages = paginate(blocks, { ...PLAIN, space: 0, trim: 5 * GRID.baseline });
    expect(flowOf(pages[0]!).filter((i) => i.t === 'rows').map((r) => (r.t === 'rows' ? [r.from, r.to] : []))).toEqual([[0, 4]]);
    const text = paginate([para(40), para(40)], { ...PLAIN, space: 0, trim: 5 * GRID.baseline });
    expect(bottomOf(flowOf(text[0]!).at(-1)!)).toBeLessThanOrEqual(BODY_BOTTOM - 5 * GRID.baseline);
  });

  it('every layout keeps the rules on seven lengths of real text', () => {
    const filler = 'Il est six heures quarante, la flaque est sur le tapis du salon, encore une fois, et le voisin du dessous commence à se plaindre de l’odeur. ';
    for (let n = 1; n <= 7; n++) {
      const ch = chapter({ paragraphs: [...chapter().paragraphs, ...Array.from({ length: n % 4 }, () => filler.repeat(1 + (n % 3)))], visual: { type: 'timeline', title: 'Une journée', labels: ['7 h : sortie', '12 h : sortie', '17 h : sortie'], values: [] } });
      const blocks = chapterBlocks(ch, theme, { finish: 2, lead: null, example: { label: 'Exemple type', text: 'Manon programme une sortie après chaque sieste.' } });
      for (const p of LAYOUTS) expect(brokenRules(paginate(blocks, p)), `variante ${n}`).toEqual([]);
    }
  });

  it('a figure waits for the last row of a list: on seven lengths none sits between two rows of one block', () => {
    const queued = paginate([para(30), figure(340), heading(), steps(60, 60, 60, 60, 60, 60, 60)], { ...PLAIN, space: 0 });
    expect(queued[1]!.items.map((i) => i.t)).toEqual(['rows', 'block']);
    let cut = 0;
    for (let n = 1; n <= 7; n++) {
      const ch = chapter({
        paragraphs: Array.from({ length: 3 + n }, (_, k) => chapter().paragraphs[k % 4]!),
        steps: Array.from({ length: 6 + n }, (_, k) => `Étape ${k + 1} : une action précise, qui dit ce qu’il faut faire et à quel moment de la journée.`),
        visual: { type: 'timeline', title: 'Une journée', labels: Array.from({ length: 8 }, (_, k) => `Étape ${k + 1} du parcours de la journée`), values: [] },
      });
      const blocks = chapterBlocks(ch, theme, { finish: 2, lead: null, example: { label: 'Exemple type', text: 'Manon programme une sortie après chaque sieste.' } });
      for (const p of LAYOUTS) {
        const flow = paginate(blocks, p).flatMap(flowOf);
        flow.forEach((item, k) => {
          if (item.t !== 'rows' || item.from === 0) return;
          cut += 1;
          expect(flow[k - 1], `variante ${n}`).toMatchObject({ t: 'rows', to: item.from });
        });
      }
    }
    expect(cut).toBeGreaterThan(0);
  });

  it('is a pure function: two calls give deep-equal plans, and nothing in it reads the world', () => {
    const blocks = chapterBlocks(chapter(), theme, { finish: 2, lead: null, example: null });
    expect(paginate(blocks, PLAIN)).toEqual(paginate(blocks, PLAIN));
    const source = readFileSync('src/deliverables/layout/paginate.ts', 'utf8');
    expect(source).not.toMatch(/from 'pdfkit'|new Date|Date\.now|performance\.|Math\.random|\brng\b/);
  });
});

describe('paginate: figures float', () => {
  it('a figure that does not fit lets the text behind it move up, the page before stays ≥ 0.75 full', () => {
    const pages = paginate([para(30), figure(320), para(14)], { ...PLAIN, space: 0 });
    expect(pages[0]!.fill).toBeGreaterThanOrEqual(0.75);
    expect(pages[0]!.items.every((i) => i.t === 'para')).toBe(true);
    expect(pages[1]!.items[0]).toMatchObject({ t: 'block', y: GRID.top });
    expect(pages).toHaveLength(2);
  });

  it('a figure that fits stays where it was asked', () => {
    const pages = paginate([para(10), figure(200), para(5)], { ...PLAIN, space: 0 });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.items.map((i) => i.t)).toEqual(['para', 'block', 'para']);
  });

  it('figures keep their order, and none is lost at the end of a chapter', () => {
    const first = figure(320);
    const second = figure(300);
    const pages = paginate([para(30), first, second], { ...PLAIN, space: 0 });
    const placed = pages.flatMap((p) => p.items).filter((i) => i.t === 'block').map((i) => (i.t === 'block' ? i.block : null));
    expect(placed).toEqual([first, second]);
  });

  it('two tall figures take a page each, neither runs past the foot', () => {
    const pages = paginate([para(30), figure(420), figure(420)], { ...PLAIN, space: 0 });
    const figures = pages.flatMap((p) => p.items.filter((i) => i.t === 'block'));
    expect(figures).toHaveLength(2);
    for (const page of pages) expect(Math.max(...page.items.map((i) => (i.t === 'block' ? i.y + i.block.h : 0)))).toBeLessThanOrEqual(BODY_BOTTOM);
    expect(pages.filter((p) => p.kind === 'figure')).toHaveLength(2);
  });

  it('`late` sends a figure after the method, before the checklist', () => {
    const blocks: Block[] = [para(4), figure(100), heading('Étape par étape'), steps(40), heading('Votre checklist'), checklist(4)];
    const order = (figureSlot: 'early' | 'late') => paginate(blocks, { ...PLAIN, figureSlot }).flatMap((p) => p.items).map((i) => (i.t === 'block' ? i.block.t === 'figure' ? 'figure' : i.block.t === 'h2' ? i.block.text : 'x' : i.t));
    expect(order('early')).toEqual(['para', 'figure', 'Étape par étape', 'rows', 'Votre checklist', 'rows']);
    expect(order('late')).toEqual(['para', 'Étape par étape', 'rows', 'figure', 'Votre checklist', 'rows']);
  });
});

describe('paginate: rail', () => {
  it('a rail block sits on the baseline of its anchor and leaves the column alone', () => {
    const pages = paginate([para(10), para(6), note(60), para(5)], { ...PLAIN, space: 0 });
    const anchor = pages[0]!.items[1]!;
    const rail = pages[0]!.items.find((i) => i.t === 'rail')!;
    expect(rail.t === 'rail' && anchor.t === 'para' && rail.y).toBe(anchor.t === 'para' ? anchor.y : -1);
    const after = pages[0]!.items.at(-1)!;
    expect(after.t === 'para' && after.y).toBe(GRID.top + 16 * GRID.baseline);
  });

  it('one that does not fit moves to the top of the next page', () => {
    const pages = paginate([para(42), para(6), note(150), para(30)], { ...PLAIN, space: 0 });
    expect(pages[0]!.items.some((i) => i.t === 'rail')).toBe(false);
    expect(pages[1]!.items.find((i) => i.t === 'rail')).toMatchObject({ y: GRID.top });
  });

  it('a full-width block never runs under the rail', () => {
    const pages = paginate([para(3), note(150), heading(), steps(50)], { ...PLAIN, space: 0 });
    const rail = pages[0]!.items.find((i) => i.t === 'rail')!;
    const head = pages[0]!.items.find((i) => i.t === 'block')!;
    expect(rail.t === 'rail' && head.t === 'block' && head.y).toBeGreaterThanOrEqual(GRID.top + 150);
  });
});

describe('paginate: sheets and short pages', () => {
  const grid = (rows: number): VisualSpec => ({ type: 'grid', title: 'Votre carnet', labels: [], values: [], grid: { columns: ['Jour', 'Note'], rows: Array.from({ length: rows }, (_, k) => `Jour ${k + 1}`) } });

  it('a sheet ends the chapter on a page of its own, and a long one takes as many as it needs', () => {
    const short = paginate([para(10), sheetBlock(grid(14), theme)!], PLAIN);
    expect(short.map((p) => p.kind)).toEqual(['text', 'sheet']);
    const long = sheetBlock(grid(60), theme)!;
    expect(long.parts.length).toBeGreaterThanOrEqual(2);
    const pages = paginate([para(10), long], PLAIN);
    expect(pages.map((p) => p.kind)).toEqual(['text', ...long.parts.map(() => 'sheet')]);
    expect(long.parts.flatMap((p) => Array.from({ length: p.to - p.from }, (_, k) => p.from + k))).toEqual(Array.from({ length: 60 }, (_, k) => k));
  });

  it('a table that ends high leaves room to write down to the foot, and a sheet counts its real end, notes at half weight', () => {
    const plan: VisualSpec = { type: 'grid', title: 'Votre plan de 14 jours, à cocher', labels: [], values: [], grid: { columns: ['Jours', 'À faire', 'Fait'], rows: ['1', '2', '3', '4'], cells: Array.from({ length: 4 }, () => ['Une action du plan', null]) } };
    const b = sheetBlock(plan, theme)!;
    const part = b.parts[0]!;
    expect(part.notes).toMatchObject({ label: 'Ce que j’ai observé' });
    expect(part.notes!.y + part.notes!.h).toBeCloseTo(BODY_BOTTOM, 3);
    const sheet = paginate([b], PLAIN)[0]!;
    expect(sheet.items.map((i) => i.t)).toEqual(['sheet', 'notes']);
    expect(sheet.fill).toBeCloseTo((part.end - GRID.top + part.notes!.h / 2) / BODY_H, 3);
    expect(sheet.fill).toBeLessThan(0.75);
    expect(sheetBlock(grid(5), theme)!.parts[0]!.notes?.label ?? 'Vos notes').toBe('Vos notes');
    const full = sheetBlock(grid(60), theme)!.parts[0]!;
    expect(full.notes).toBeNull();
    expect(paginate([sheetBlock(grid(60), theme)!], PLAIN)[0]!.fill).toBeCloseTo((full.end - GRID.top) / BODY_H, 3);
  });

  it('a short plan holds its page: the table reaches 45 % of the body before the ruled lines start', () => {
    const plan = (rows: number): VisualSpec => ({ type: 'grid', title: 'Votre plan à cocher', labels: [], values: [], grid: { columns: ['Quand', 'À faire', 'Fait'], rows: Array.from({ length: rows }, (_, k) => `Jour ${k + 1}`), cells: Array.from({ length: rows }, () => ['Une action du plan', null]) } });
    for (const rows of [3, 4, 5, 6, 7]) {
      const part = sheetBlock(plan(rows), theme)!.parts[0]!;
      expect((part.end - GRID.top) / BODY_H, `${rows} lignes`).toBeCloseTo(0.45, 2);
      expect(part.notes, `${rows} lignes`).toMatchObject({ label: 'Ce que j’ai observé' });
      expect(part.notes!.y + part.notes!.h).toBeCloseTo(BODY_BOTTOM, 3);
    }
    // a plan that fills its page keeps its rows, and a sheet to write in is not a plan
    expect(sheetBlock(plan(14), theme)!.parts[0]!.grow).toBeLessThanOrEqual(12);
    expect(sheetBlock(plan(60), theme)!.parts[0]!.grow).toBeLessThanOrEqual(12);
    const write = sheetBlock(grid(5), theme)!.parts[0]!;
    expect(write.grow).toBe(36);
  });

  it('a tall row of a short plan keeps its box beside its words: the row grows under them, not around them', () => {
    const v: VisualSpec = { type: 'grid', title: 'Votre plan à cocher', labels: [], values: [], grid: { columns: ['Quand', 'À faire', 'Fait'], rows: ['Jour 1', 'Jour 2'], cells: [['Une action', null], ['Une autre action', null]] } };
    const boxTops = (extra: number): number[] => {
      const s = new Scene(595, 842);
      const model = gridModel(v, 475, theme)!;
      model.draw(s, 60, 100, 0, 2, extra);
      return s.ops.flatMap((o) => { const box = o.k === 'path' ? /^M\S+ (\S+)h13v13h-13Z$/.exec(o.d) : null; return box ? [Number(box[1])] : []; });
    };
    const [flat, grown] = [boxTops(0), boxTops(60)];
    expect(flat).toHaveLength(2);
    expect(grown[0], 'the first row stands where it stood').toBeCloseTo(flat[0]!, 3);
    expect(grown[1]! - grown[0]!, 'the second row comes down by the whole row').toBeCloseTo(flat[1]! - flat[0]! + 60, 3);
  });

  it('every sheet of every guide ends past the floor, in ink', () => {
    let sheets = 0;
    let written = 0;
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        guide.plans.forEach((plan, k) => {
          if (plan.kind !== 'sheet') return;
          sheets += 1;
          const { ops } = guide.pages[k + 1]!.scene;
          expect(inkOf(ops), `${title.slice(0, 30)}, p${k + 2}`).toBeGreaterThanOrEqual(PAGE_FLOOR);
          if (plan.items.some((i) => i.t === 'notes')) {
            written += 1;
            expect(ops.some((o) => o.k === 'text' && /^(VOS NOTES|CE QUE J’AI OBSERVÉ)$/.test(o.s))).toBe(true);
          }
        });
      }
    }
    expect(written).toBeGreaterThan(0);
    expect(sheets).toBeGreaterThanOrEqual(written);
  });

  it('a sheet stays whole on one page when it can, and blank lines grow for handwriting', () => {
    const b = sheetBlock(grid(14), theme) as SheetBlock;
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0]!.grow).toBeGreaterThan(0);
  });

  it('a page holding a leftover takes lines from the page before it (ports planIntro)', () => {
    // the box alone would spill: the next page starts earlier and carries ≥ 25 % of content
    const pages = paginate([para(46), example(90)], { ...PLAIN, space: 0 });
    expect(pages).toHaveLength(2);
    expect(pages[1]!.items.map((i) => i.t)).toEqual(['para', 'block']);
    expect(pages[1]!.fill).toBeGreaterThanOrEqual(MIN_PAGE_FILL);
    expect(brokenRules(pages)).toEqual([]);
    // it fits: untouched
    expect(paginate([para(10), example(90)], { ...PLAIN, space: 0 })).toHaveLength(1);
    // a big spill is a normal flow: the next page is full anyway
    const flow = paginate([para(60), example(90)], { ...PLAIN, space: 0 });
    expect(flow[0]!.items[0]).toMatchObject({ from: 0, to: Math.floor(BODY_H / GRID.baseline) });
  });

  it('rule 7: other params are tried, then ruled notes close the section at half weight', () => {
    // a page of plain text with no page before it: nothing to take from, no rows to open (D66 rebalances the rest)
    const blocks = [para(12)];
    const plain = paginate(blocks, { ...PLAIN, space: 0 });
    expect(plain.at(-1)!.fill).toBeLessThan(SHORT_PAGE);
    const pages = layoutOf(blocks);
    const last = pages.at(-1)!;
    const notes = last.items.find((i) => i.t === 'notes');
    expect(notes).toBeTruthy();
    const solid = flowOf(last).reduce((a, i) => Math.max(a, i.t === 'para' ? i.y + (i.to - i.from) * lineOf(i.block) : 0), 0);
    expect(notes!.t === 'notes' && notes!.y + notes!.h).toBeCloseTo(BODY_BOTTOM, 3);
    expect(last.fill).toBeCloseTo((solid - GRID.top + (notes!.t === 'notes' ? notes!.h : 0) / 2) / BODY_H, 3);
    expect(last.fill).toBeLessThan(0.75); // notes cannot buy a full page
    // a chapter that a spacing saves gets no notes
    const twelve = Array.from({ length: 12 }, () => para(5));
    expect(paginate(twelve, PLAIN).at(-1)!.fill).toBeLessThan(SHORT_PAGE);
    const fine = layoutOf(twelve);
    expect(fine.at(-1)!.fill).toBeGreaterThanOrEqual(SHORT_PAGE);
    expect(fine.flatMap((p) => p.items).some((i) => i.t === 'notes')).toBe(false);
  });
});

const bottomOf = (i: Placed): number => (i.t === 'para' ? i.y + (i.to - i.from) * lineOf(i.block) : i.t === 'rows' ? i.y + (i.block.t === 'steps' ? i.block.items : i.block.rows).slice(i.from, i.to).reduce((a, r) => a + r.h + (i.air ?? 0), 0) : i.t === 'block' ? i.y + i.block.h : 0);

/** Where a page really stops printing, rail included and whatever closes it left out, in shares of the body. */
function solidOf(page: PagePlan): number {
  const ends = page.items.flatMap((i) => (i.t === 'rail' ? [i.y + i.block.h] : i.t === 'para' || i.t === 'rows' ? [bottomOf(i)] : i.t === 'block' ? [bottomOf(i) - (i.block.t === 'figure' ? FIGURE_FOOT : 0)] : []));
  return (Math.max(GRID.top, ...ends) - GRID.top) / BODY_H;
}

/** The lowest y a path reaches, curves by their end points: enough for rules, boxes and discs. */
function pathBottom(d: string): number {
  let y = 0;
  let low = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHVCAZhvl])([^MLHVCAZhvl]*)/g)) {
    const v = [...args!.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    if (cmd === 'M' || cmd === 'L') y = v[1]!;
    else if (cmd === 'V') y = v[0]!;
    else if (cmd === 'v') y += v[0]!;
    else if (cmd === 'l') y += v[1]!;
    else if (cmd === 'C') y = v[5]!;
    else if (cmd === 'A') y = v[6]!;
    low = Math.max(low, y);
  }
  return low;
}

const firstY = (d: string): number => Number(/^M-?[\d.]+ (-?[\d.]+)/.exec(d)?.[1] ?? 0);

/** Read from what is drawn, not from the plan: the last ink of the body, the section tab and the foot of the page left out. */
function inkOf(ops: Op[], dy = 0): number {
  const low = (o: Op): number => {
    if (o.k === 'text') return o.x > GRID.left + GRID.full || o.y > BODY_BOTTOM + 8 ? 0 : o.y + 0.22 * o.size;
    if (o.k === 'group') return dy + o.y + (inkOf(o.ops, 0) * BODY_H + GRID.top);
    if (o.k === 'clip') return Math.max(0, ...o.ops.map(low));
    return /^M0 0h/.test(o.d) || /^M5\d\d/.test(o.d) ? 0 : pathBottom(o.d);
  };
  return (Math.max(GRID.top, ...ops.map(low)) - GRID.top) / BODY_H;
}

describe('no half-empty page (D66)', () => {
  it('a figure left alone on the last page closes on the art of the guide: the text stays on its page, the section ends past the floor', () => {
    const blocks = [para(40), figure(320)];
    const plain = paginate(blocks, { ...PLAIN, space: 0 });
    expect(plain.map((p) => p.kind)).toEqual(['text', 'figure']);
    expect(plain.at(-1)!.fill).toBeLessThan(PAGE_FLOOR);
    const pages = layoutOf(blocks);
    expect(pages).toHaveLength(2);
    expect(brokenRules(pages)).toEqual([]);
    for (const p of pages) expect(p.fill).toBeGreaterThanOrEqual(PAGE_FLOOR);
    expect(pages.flatMap(flowOf).reduce((a, i) => a + (i.t === 'para' ? i.to - i.from : 0), 0)).toBe(40);
    expect(pages[1]!.items.map((i) => (i.t === 'block' ? i.block.t : i.t))).toEqual(['figure', 'end']);
    expect(bottomOf(flowOf(pages[0]!)[0]!)).toBe(GRID.top + 40 * GRID.baseline);
  });

  it('the art closes a short last page down to its foot, at half weight, and a page near full keeps its foot', () => {
    const pages = layoutOf([para(40), figure(320)]);
    const end = pages[1]!.items.find((i) => i.t === 'end')!;
    expect(end.t === 'end' && end.y + end.h).toBeCloseTo(BODY_BOTTOM, 3);
    const ink = solidOf(pages[1]!);
    expect(pages[1]!.fill).toBeCloseTo(ink + (end.t === 'end' ? end.h / 2 : 0) / BODY_H, 3);
    expect(pages[1]!.fill).toBeLessThan(0.8); // art cannot buy a full page
    const near = layoutOf([para(36)]);
    expect(near[0]!.items.some((i) => i.t === 'end')).toBe(false);
  });

  it('a band is tiles to the foot of the page, and no two sections of a guide draw the same one', () => {
    let bands = 0;
    for (const { title, content } of allOf()) {
      const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
      const drawn: string[] = [];
      guide.plans.forEach((plan, k) => {
        const end = plan.items.find((i) => i.t === 'end');
        if (end?.t !== 'end') return;
        const { ops } = guide.pages[k + 1]!.scene;
        const art = ops.filter((o) => o.k === 'path' && !!o.fill && Math.abs(firstY(o.d) - end.y) < end.h + 1);
        expect(art.length, title).toBeGreaterThan(end.rows * 3);
        expect(inkOf(ops), title).toBeGreaterThanOrEqual(0.995);
        drawn.push(JSON.stringify(art.slice(0, 18)));
        bands += 1;
      });
      expect(new Set(drawn).size, title).toBe(drawn.length);
    }
    expect(bands).toBeGreaterThan(10);
  });

  it('`trim` takes from every page but the last, and leaves the last one its whole height', () => {
    const blocks = Array.from({ length: 12 }, () => para(9));
    const plain = paginate(blocks, { ...PLAIN, space: 0 });
    const trimmed = paginate(blocks, { ...PLAIN, space: 0, trim: 5 * GRID.baseline });
    expect(plain).toHaveLength(3);
    expect(trimmed).toHaveLength(3);
    for (const page of trimmed.slice(0, -1)) expect(Math.max(...page.items.map(bottomOf))).toBeLessThanOrEqual(BODY_BOTTOM - 5 * GRID.baseline);
    expect(trimmed.at(-1)!.fill).toBeGreaterThan(plain.at(-1)!.fill);
  });

  it('a page with nothing to take from breathes: rows open, blocks part, a heading stays on what it heads', () => {
    const blocks: Block[] = [para(3), heading(), steps(42, 42), example(70), heading(), checklist(3)];
    const plain = paginate(blocks, PLAIN);
    expect(plain).toHaveLength(1);
    expect(plain[0]!.fill).toBeLessThan(PAGE_FLOOR);
    const pages = layoutOf(blocks);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.fill).toBeGreaterThanOrEqual(PAGE_FLOOR);
    expect(pages[0]!.items.some((i) => i.t === 'notes')).toBe(false);
    const flow = flowOf(pages[0]!);
    flow.forEach((item, k) => {
      if (item.t === 'rows') expect(item.air).toBeGreaterThan(0);
      const before = flow[k - 1];
      if (!before || item.t === 'sheet') return;
      if (before.t === 'block' && before.block.t === 'h2') expect(item.y).toBeCloseTo(bottomOf(before), 6);
      else expect(item.y).toBeGreaterThan(bottomOf(before));
    });
  });

  it('a rail element goes where its block went, and two of them never close up', () => {
    const blocks: Block[] = [para(6), note(120), para(6), note(120), heading(), steps(42, 42), heading(), checklist(4)];
    const pages = layoutOf(blocks);
    expect(pages).toHaveLength(1);
    const [first, second] = pages[0]!.items.filter((i) => i.t === 'rail');
    const [a, b] = pages[0]!.items.filter((i) => i.t === 'para');
    expect(first!.t === 'rail' && first!.y).toBeCloseTo(a!.t === 'para' ? a!.y : -1, 6);
    expect(second!.t === 'rail' && first!.t === 'rail' && second!.y - first!.y).toBeGreaterThanOrEqual(120);
    expect(b!.t === 'para' && b!.y).toBeGreaterThan(GRID.top + 6 * GRID.baseline);
  });

  it('every body page of every guide ends past the floor, or closes on purpose down to its foot', () => {
    let closed = 0;
    let body = 0;
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        const text = textOf(guide.plans);
        text.forEach((page, k) => {
          body += 1;
          const close = page.items.find((i) => i.t === 'notes' || i.t === 'end');
          if (close?.t === 'notes' || close?.t === 'end') {
            if (close.t === 'notes') closed += 1;
            expect(close.y + close.h).toBeCloseTo(BODY_BOTTOM, 3);
            // only a section ends on purpose: what comes after is another section
            expect(text[k + 1]?.chapter === page.chapter && !!page.chapter, `${title.slice(0, 30)} / finition ${effort.finish}`).toBe(false);
          } else expect(page.fill, `${title.slice(0, 30)} / finition ${effort.finish}`).toBeGreaterThanOrEqual(PAGE_FLOOR);
        });
      }
    }
    expect(closed).toBeLessThan(body / 8); // the notes stay a way out, not the way the pages fill
  });

  it('`fill` means ink: it says where a page really stops printing', () => {
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        guide.plans.forEach((plan, k) => {
          if ((plan.kind !== 'text' && plan.kind !== 'figure') || plan.items.some((i) => i.t === 'notes' || i.t === 'end')) return;
          const where = `${title.slice(0, 30)} / finition ${effort.finish}, p${k + 2}`;
          expect(plan.fill - inkOf(guide.pages[k + 1]!.scene.ops), where).toBeLessThanOrEqual(0.025);
          expect(inkOf(guide.pages[k + 1]!.scene.ops) - plan.fill, where).toBeLessThanOrEqual(0.005);
        });
      }
    }
  });

  it('a page stays a full page: no list is cut while its next row has the room, and the median page that does not close on art ends at 0.80 or more', () => {
    const inks: number[] = [];
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        for (const page of textOf(guide.plans)) {
          if (!page.items.some((i) => i.t === 'end')) inks.push(solidOf(page));
          const last = flowOf(page).at(-1);
          if (last?.t !== 'rows') continue;
          const rows = last.block.t === 'steps' ? last.block.items : last.block.rows;
          if (last.to < rows.length) expect(bottomOf(last) + rows[last.to]!.h, `${title.slice(0, 30)} / finition ${effort.finish}`).toBeGreaterThan(BODY_BOTTOM);
        }
      }
    }
    expect(inks.sort((a, b) => a - b)[inks.length >> 1]).toBeGreaterThanOrEqual(0.8);
  });

  it('a last page the art cannot close takes an example whole from the page before, and the page that gives stays full', () => {
    const blocks: Block[] = [para(30), heading(), steps(42, 42, 42), example(90), heading(), checklist(3)];
    const pages = layoutOf(blocks);
    expect(pages).toHaveLength(2);
    expect(flowOf(pages[1]!)[0]).toMatchObject({ t: 'block', block: { t: 'example' } });
    expect(pages[1]!.items.some((i) => i.t === 'notes')).toBe(false);
    expect(pages[1]!.items.at(-1)?.t).toBe('end');
    expect(solidOf(pages[0]!)).toBeGreaterThanOrEqual(PAGE_FULL);
    expect(brokenRules(pages)).toEqual([]);
  });

  it('a heading and its list go over together, whole', () => {
    const blocks: Block[] = [para(34), heading(), steps(42, 42, 42, 42), heading(), checklist(2)];
    const pages = layoutOf(blocks);
    expect(pages).toHaveLength(2);
    expect(flowOf(pages[0]!).every((i) => i.t === 'para')).toBe(true);
    const rows = flowOf(pages[1]!).filter((i) => i.t === 'rows');
    expect(flowOf(pages[1]!)[0]).toMatchObject({ t: 'block', block: { t: 'h2' } });
    expect(rows.map((r) => (r.t === 'rows' ? [r.block.t, r.from, r.to] : []))).toEqual([['steps', 0, 4], ['checklist', 0, 2]]);
    expect(brokenRules(pages)).toEqual([]);
  });

  it('a page that gives stays a page: it keeps what it would lose past the floor', () => {
    // moving the list would leave three lines: the art closes what is left
    const pages = layoutOf([para(3), heading(), steps(150, 150, 150, 150), heading(), checklist(2)]);
    expect(solidOf(pages[0]!)).toBeGreaterThanOrEqual(PAGE_FLOOR);
  });

  it('ruled notes never stand in for a page: no body page holds less than LAST_PAGE above them, on any guide at any finish', () => {
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        guide.plans.forEach((page, k) => {
          if ((page.kind === 'text' || page.kind === 'figure') && page.items.some((i) => i.t === 'notes')) expect(solidOf(page), `${title.slice(0, 30)} / finition ${effort.finish}, p${k + 2}`).toBeGreaterThanOrEqual(LAST_PAGE);
        });
      }
    }
  });

  it('a chapter keeps the spacing of the guide: two values a reader cannot tell apart, the rest goes to the rebalance and the art', () => {
    expect(new Set(LAYOUTS.map((p) => p.space))).toEqual(new Set([10.8, 9]));
    for (const { title, content } of allOf()) {
      const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
      for (const page of textOf(guide.plans)) {
        flowOf(page).forEach((item, k, flow) => {
          const before = flow[k - 1];
          if (before?.t === 'para' && item.t === 'para') expect([10.8, 9], title.slice(0, 30)).toContainEqual(Math.round((item.y - bottomOf(before)) * 100) / 100);
        });
      }
    }
  });

  it('the art stays under the text: tiles are whole, the page takes what they leave, and the gap stays under a tile', () => {
    const gaps: number[] = [];
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        for (const page of textOf(guide.plans)) {
          const end = page.items.find((i) => i.t === 'end');
          if (end?.t !== 'end') continue;
          expect(end.h).toBeCloseTo((end.rows * GRID.full) / end.cols, 6);
          gaps.push(end.y - GRID.top - solidOf({ ...page, items: page.items.filter((i) => i !== end) }) * BODY_H);
        }
      }
    }
    expect(gaps.length).toBeGreaterThan(30);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...gaps)).toBeLessThan(GRID.full / 6);
    expect(gaps.sort((a, b) => a - b)[gaps.length >> 1]).toBeLessThanOrEqual(2 * 21.6);
  });

  it('two paragraphs keep the spacing of their section on every page, and a heading takes one line of air at most', () => {
    const short = flowOf(layoutOf([para(6), para(6), para(6), heading(), para(3)])[0]!);
    expect(short[1]!.t === 'para' && short[1]!.y - bottomOf(short[0]!)).toBeCloseTo(PLAIN.space, 6);
    expect(short[2]!.t === 'para' && short[2]!.y - bottomOf(short[1]!)).toBeCloseTo(PLAIN.space, 6);
    expect(short[3]!.t === 'block' && short[3]!.y - bottomOf(short[2]!)).toBeGreaterThan(PLAIN.space);
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        for (const chapter of new Set(guide.plans.map((p) => p.chapter))) {
          const gaps = new Set<number>();
          for (const page of textOf(guide.plans).filter((p) => p.chapter === chapter && chapter !== null)) {
            flowOf(page).forEach((item, k, flow) => {
              const before = flow[k - 1];
              if (before?.t === 'para' && item.t === 'para') gaps.add(Math.round((item.y - bottomOf(before)) * 100) / 100);
              // a heading under a long rail starts below it: that gap is the rail's, not air
              if (before?.t === 'para' && item.t === 'block' && item.block.t === 'h2' && !page.items.some((i) => i.t === 'rail')) expect(item.y - bottomOf(before)).toBeLessThanOrEqual(14.4 + GRID.baseline + 1e-6);
            });
          }
          expect(gaps.size, `${title.slice(0, 30)} / chapitre ${chapter}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('a rail keeps its distance from the full-width block under it', () => {
    const pages = paginate([para(3), note(51), heading(), steps(50)], { ...PLAIN, space: 0 });
    const rail = pages[0]!.items.find((i) => i.t === 'rail')!;
    const head = pages[0]!.items.find((i) => i.t === 'block')!;
    expect(head.t === 'block' && rail.t === 'rail' && head.y - (rail.y + rail.block.h)).toBeGreaterThanOrEqual(9);
    for (const { title, content } of allOf()) {
      const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
      for (const page of textOf(guide.plans)) {
        for (const r of page.items) {
          if (r.t !== 'rail') continue;
          for (const below of flowOf(page)) {
            if (below.t === 'para' || below.t === 'sheet' || (below.t === 'block' && below.block.t === 'example') || below.y <= r.y) continue;
            if (below.y < r.y + r.block.h + 9) expect.fail(`${title.slice(0, 30)} : ${below.y - r.y - r.block.h} pt sous le rail`);
          }
        }
      }
    }
  });

  it('the air is drawn: the numbers of a page that breathes stand as far apart as the plan says', () => {
    const content: PdfContent = { ...written[0]!.content, chapters: [chapter({ paragraphs: chapter().paragraphs.slice(0, 2), example: null, steps: ['Notez.', 'Sortez.', 'Récompensez.', 'Recommencez.'] })] };
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency', effort: LEVELS[1]! });
    const at = guide.plans.findIndex((p) => p.chapter === 1 && p.kind === 'text');
    const rows = guide.plans[at]!.items.find((i) => i.t === 'rows' && i.block.t === 'steps');
    expect(rows?.t === 'rows' && rows.air).toBeGreaterThan(0);
    const numbers = guide.pages[at + 1]!.scene.ops.flatMap((o) => (o.k === 'text' && o.size === 30 ? [o.y] : []));
    expect(numbers).toHaveLength(4);
    const step = rows!.t === 'rows' && rows!.block.t === 'steps' ? rows!.block.items[0]!.h + rows!.air! : 0;
    expect(numbers[1]! - numbers[0]!).toBeCloseTo(step, 6);
  });

  it('the plan on one page spreads down its page', () => {
    const { content } = written[0]!;
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
    const at = guide.plans.findIndex((p) => p.kind === 'memo');
    const ys = guide.pages[at + 1]!.scene.ops.flatMap((o) => (o.k === 'text' && o.y < GRID.folio - 1 ? [o.y] : []));
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(GRID.top + PAGE_FLOOR * BODY_H);
    expect(guide.audit.overflow).toBe(0);
  });
});

describe('blocks', () => {
  it('wrapWords sets a line the way pdfkit does: word by word, every line in its box, no word lost', () => {
    const text = 'Un chiot de 8 à 12 semaines tient environ une heure par mois d’âge, plus une : au-delà, c’est de la physiologie, et le plan « zéro pipi » coûte 19 €.';
    const face = VOICES.conte.text;
    const lines = wrapWords(text, face, 10.3, 180);
    for (const l of lines) expect(advance(face, l, 10.3)).toBeLessThanOrEqual(180.5);
    expect(lines.join(' ').replace(/\s/g, ' ')).toBe(text.replace(/\s/g, ' '));
    expect(wrapWords('a'.repeat(80), face, 10.3, 100).join('')).toBe('a'.repeat(80));
    expect(wrapWords('un deux trois quatre cinq', face, 10, (k) => (k === 0 ? 30 : 400))).toHaveLength(2);
  });

  it('prints neither « Fait : » nor « Je ne fais plus : », which goes under its own head', () => {
    const blocks = chapterBlocks(chapter({ checklist: ['Fait : établir un planning', 'Fait : choisir un coin', 'Je ne fais plus : gronder après coup'] }), theme, { finish: 1, lead: null, example: null });
    const box = blocks.find((b) => b.t === 'checklist') as ChecklistBlock;
    expect(box.items).toEqual(['Établir un planning', 'Choisir un coin', 'Gronder après coup']);
    expect(box.heads).toEqual(['À faire', 'À arrêter']);
    expect(box.cols).toBe(2);
  });

  it('prints no « : fait » beside a box either, on any page of any guide', () => {
    const blocks = chapterBlocks(chapter({ checklist: ['Votre feuille de cadrage : fait', 'Le carnet est ouvert', 'L’endroit est choisi : fait.'] }), theme, { finish: 1, lead: null, example: null });
    expect((blocks.find((b) => b.t === 'checklist') as ChecklistBlock).items).toEqual(['Votre feuille de cadrage', 'Le carnet est ouvert', 'L’endroit est choisi']);
    for (const { title, content } of allOf()) {
      const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
      for (const page of guide.pages) for (const o of page.scene.ops) if (o.k === 'text') expect(o.s, title.slice(0, 30)).not.toMatch(/:\s*fait\.?$/iu);
    }
  });

  it('a thousands group is never split at the end of a line', () => {
    const face = theme.v.text;
    const text = 'Les devis que j’ai reçus pour la même salle demandent 4 000 € et le traiteur 12 500 € pour le même nombre d’invités.';
    for (let width = 60; width <= 400; width += 4) {
      const lines = wrapWords(text, face, 10.3, width);
      lines.forEach((l, k) => { if (/\d$/.test(l) && /^\d{3}\b/.test(lines[k + 1] ?? '')) expect.fail(`${l} / ${lines[k + 1]}`); });
    }
  });

  it('a checklist that only restates the steps puts its boxes on them, and prints no list', () => {
    const repeated = chapter().steps.map((s) => `Fait : ${s.charAt(0).toLowerCase()}${s.slice(1).replace(/\.$/, '')}`);
    const blocks = chapterBlocks(chapter({ checklist: repeated }), theme, { finish: 1, lead: null, example: null });
    expect(blocks.some((b) => b.t === 'checklist')).toBe(false);
    expect(blocks.some((b) => b.t === 'h2' && b.text === 'Votre checklist')).toBe(false);
    expect((blocks.find((b) => b.t === 'steps') as StepsBlock).ticks).toBe(true);
    // one line that says something else keeps the list, and the steps stay as they are
    const other = chapterBlocks(chapter({ checklist: [...repeated, 'L’endroit est choisi'] }), theme, { finish: 1, lead: null, example: null });
    expect(other.some((b) => b.t === 'checklist')).toBe(true);
    expect((other.find((b) => b.t === 'steps') as StepsBlock).ticks).toBeUndefined();
    // a step cut short by the writer is still that step
    const cut = chapterBlocks(chapter({ steps: ['Notez chaque sortie pendant 2 jours, à la même heure, sur le carnet ouvert.'], checklist: ['Fait : notez chaque sortie pendant 2 jours'] }), theme, { finish: 1, lead: null, example: null });
    expect(cut.some((b) => b.t === 'checklist')).toBe(false);
  });

  it('the boxes are drawn: on the rows of the steps, and on the stations of a path that replaces them', () => {
    const boxes = (ops: Op[]): number => ops.reduce((a, o) => a + (o.k === 'group' ? boxes(o.ops) : o.k === 'path' && !o.fill && o.sw === 0.8 && /Z$/.test(o.d) ? 1 : 0), 0);
    const steps = chapter().steps;
    const repeated = steps.map((s) => `Fait : ${s}`);
    const stations = steps.map((label) => ({ label, when: 'Jour 1', duration: null }));
    const path: VisualSpec = { type: 'step_path', title: 'Les 3 étapes en un coup d’œil', labels: [], values: [], path: { stations } };
    const printed = (visual: VisualSpec | null): PdfContent => ({ ...written[0]!.content, chapters: [chapter({ visual, checklist: repeated, example: null })] });
    for (const visual of [null, path]) {
      const content = printed(visual);
      const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency', effort: LEVELS[1]! });
      const at = guide.plans.findIndex((p) => p.chapter === 1 && p.kind !== 'opener');
      expect(boxes(guide.pages[at + 1]!.scene.ops), visual?.type ?? 'liste').toBe(3);
    }
  });

  it('no chapter of a real guide says the same lines twice on two pages', () => {
    let steps = 0;
    for (const { content } of allOf()) {
      for (const ch of content.chapters) {
        const blocks = chapterBlocks(ch, theme, { finish: 2, lead: null, example: null });
        const list = blocks.find((b) => b.t === 'checklist') as ChecklistBlock | undefined;
        const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!list) { steps += 1; continue; }
        const said = ch.steps.map(key);
        expect(list.items.every((l) => said.some((s) => s.startsWith(key(l)))), ch.title).toBe(false);
      }
    }
    expect(steps).toBeGreaterThan(3);
  });

  it('the annex opens each case on the case itself, in bold, whatever its length, and goes on in lower case', () => {
    const { content } = written[0]!;
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
    const from = guide.plans.findLastIndex((p) => p.kind === 'opener');
    const cases = guide.plans.slice(from + 1).filter((p) => p.kind === 'text' && p.chapter === null).flatMap((p) => p.items).filter((i) => i.t === 'para' && i.from === 0);
    const tree = content.chapters.flatMap((ch) => [ch.visual, ch.figure]).find((v) => v?.type === 'decision_tree')!.tree!;
    expect(cases).toHaveLength(tree.cases.length);
    for (const item of cases) {
      if (item.t !== 'para') continue;
      const { block } = item;
      expect(!!block.head || !!block.bold, block.lines[0]).toBe(true);
      const body = block.lines[block.bold ?? 0]!;
      expect(body, block.lines[0]).toMatch(/^[\p{Ll}\d]|^\p{Lu}{2}/u);
    }
    // a long head wraps in bold, and the text takes the end of its last line
    const long = paraBlock('préparez la réponse.', theme, { head: 'Si le chiot refuse de sortir quand il pleut, qu’il fait froid et que le voisin promène son chien juste devant la porte' })!;
    expect(long.bold).toBeGreaterThan(0);
    expect(long.lines.length).toBeGreaterThan(long.bold!);
  });

  it('a mistake goes under « À arrêter », never under « À faire », and a list of mistakes has one label', () => {
    const only = chapterBlocks(chapter({ checklist: ['Je ne fais plus : gronder après coup', 'Je corrige : ne prévoir aucune espèce'] }), theme, { finish: 1, lead: null, example: null });
    const box = only.find((b) => b.t === 'checklist') as ChecklistBlock;
    expect(box.items).toEqual(['Gronder après coup', 'Ne prévoir aucune espèce']);
    expect(box.heads).toBeUndefined();
    const labels = only.filter((b): b is HeadingBlock => b.t === 'h2').map((b) => b.text);
    expect(labels).toContain('À arrêter');
    expect(labels).not.toContain('Votre checklist');
    const both = chapterBlocks(chapter({ checklist: ['Fait : établir un planning', 'Je corrige : ne prévoir aucune espèce'] }), theme, { finish: 1, lead: null, example: null }).find((b) => b.t === 'checklist') as ChecklistBlock;
    expect(both.heads).toEqual(['À faire', 'À arrêter']);
    expect(both.rows.at(-1)!.cells[1]!.join(' ')).toBe('Ne prévoir aucune espèce');
    for (const { content } of allOf()) {
      for (const ch of content.chapters) {
        const list = chapterBlocks(ch, theme, { finish: 1, lead: null, example: null }).find((b) => b.t === 'checklist') as ChecklistBlock | undefined;
        if (list?.heads) expect(list.rows.slice(1).some((r) => r.cells[0]!.length) && list.rows.slice(1).some((r) => r.cells[1]!.length)).toBe(true);
      }
    }
  });

  it('a chapter whose path walks its steps does not list them again', () => {
    const path: VisualSpec = { type: 'step_path', title: 'Les 3 étapes en un coup d’œil', labels: [], values: [], path: { stations: chapter().steps.map((label) => ({ label, when: 'Jour 1', duration: null })) } };
    const shown = chapterBlocks(chapter({ visual: path }), theme, { finish: 1, lead: null, example: null });
    expect(shown.filter((b) => b.t === 'figure')).toHaveLength(1);
    expect(shown.some((b) => b.t === 'steps')).toBe(false);
    expect(shown.some((b) => b.t === 'h2' && b.text === 'Étape par étape')).toBe(false);
    // the path of a finish that does not draw it says nothing: the list stays
    const unseen = chapterBlocks(chapter({ figure: path }), theme, { finish: 1, lead: null, example: null });
    expect(unseen.some((b) => b.t === 'steps')).toBe(true);
    expect(chapterBlocks(chapter({ figure: path }), theme, { finish: 2, lead: null, example: null }).some((b) => b.t === 'steps')).toBe(false);
    const content: PdfContent = { ...written[0]!.content, chapters: [chapter({ visual: path })] };
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency', effort: LEVELS[1]! });
    const texts = (at: number) => guide.pages[at]!.scene.ops.flatMap((o) => (o.k === 'text' ? [o.s] : []));
    expect(texts(1)).toContain('3'); // the promise still counts its actions
    expect(texts(1)).toContain('actions guidées');
  });

  it('a path that does not hold every step whole leaves the list where it is: a drawing never takes a step out of a guide', () => {
    const steps = chapter().steps;
    const ticked = steps.map((s) => `Fait : ${s}`);
    const stationsOf = (labels: string[]): VisualSpec => ({ type: 'step_path', title: 'La méthode', labels: [], values: [], path: { stations: labels.map((label) => ({ label, when: null, duration: null })) } });
    const shown = (visual: VisualSpec, checklist: string[] = []) => chapterBlocks(chapter({ visual, checklist }), theme, { finish: 1, lead: null, example: null });
    const short = stationsOf(steps.slice(0, 1));
    const headed = stationsOf(steps.map((s) => s.split(' ').slice(0, 2).join(' ')));
    for (const visual of [short, headed]) {
      expect(shown(visual).filter((b) => b.t === 'figure')).toHaveLength(1);
      expect(shown(visual).some((b) => b.t === 'steps')).toBe(true);
      expect(shown(visual, ticked).some((b) => b.t === 'steps')).toBe(true); // the boxes stay with the steps they tick
    }
    expect(shown(stationsOf(steps)).some((b) => b.t === 'steps')).toBe(false);
  });

  it('every apostrophe printed is the real one, on the cover as on the pages', () => {
    expect(sanitizeFor(VOICES.conte.text, 'd\'un chiot, l\'été, aujourd\'hui')).toBe('d’un chiot, l’été, aujourd’hui');
    const content: PdfContent = { ...written[0]!.content, audience: 'Propriétaires d\'un chiot d\'appartement', subtitle: 'Pour l\'été', promise: 'Un chiot propre aujourd\'hui', chapters: written[0]!.content.chapters.map((c) => ({ ...c, title: `L\'erreur d\'un ${c.title}`, margin: { note: 'Un chiot n\'apprend rien ainsi.', quote: 'j\'ai tout essayé' } })) };
    const guide = layoutPdf({ product: { ...productOf('L\'erreur d\'un maître', content), audience: content.audience }, content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
    const walk = (ops: Op[]): string[] => ops.flatMap((o) => (o.k === 'text' ? [o.s] : o.k === 'group' || o.k === 'clip' ? walk(o.ops) : []));
    const printed = guide.pages.flatMap((p) => walk(p.scene.ops)).join('\n');
    expect(printed).toContain('d’un');
    expect(printed).not.toMatch(/\p{L}'\p{L}/u);
  });

  it('a name typed in lower case prints as a name in a large quote, and the words kept stay as they were said', () => {
    const b = quoteBlock('le jr pass a doublé, de tokyo à kyoto', theme)!;
    expect(b.lines.join(' ')).toContain('JR Pass');
    expect(b.lines.join(' ')).toContain('Tokyo');
    expect(b.lines.join(' ')).toContain('Kyoto');
    expect(b.text).toBe('le jr pass a doublé, de tokyo à kyoto');
    expect(quoteBlock('une fresque de plus en acrylique', theme)!.lines.join(' ')).toContain('acrylique');
    const words = new Scene(GRID.full, 200);
    layoutVisual({ type: 'icon_grid', title: 'Ce que vous nous décrivez', labels: ['Les hôtels à tokyo', 'Le jr pass a doublé'], values: [] }, GRID.full, theme)!.draw(words, 0, 0);
    expect(words.ops.flatMap((o) => (o.k === 'text' ? [o.s] : [])).join(' ')).toMatch(/Tokyo.*JR Pass/);
  });

  it('a step or an example longer than half a page flows as text, a figure taller than a page is dropped', () => {
    const long = 'une phrase qui n’en finit pas, '.repeat(120);
    const blocks = chapterBlocks(chapter({ steps: [long] }), theme, { finish: 1, lead: null, example: { label: 'Exemple type', text: long } });
    expect(blocks.some((b) => b.t === 'steps' || b.t === 'example')).toBe(false);
    expect(blocks.filter((b) => b.t === 'para').length).toBeGreaterThan(chapter().paragraphs.length);
    const huge = chapterBlocks(chapter({ visual: { type: 'checklist_card', title: 'Trop', labels: Array.from({ length: 12 }, () => long), values: [] } }), theme, { finish: 1, lead: null, example: null });
    expect(huge.some((b) => b.t === 'figure')).toBe(false);
  });

  it('the rail is measured at its own width', () => {
    const b = noteBlock('Un accident puni après coup n’apprend rien.', theme)!;
    for (const l of b.lines) expect(advance(VOICES.conte.textIt, l, 9.2)).toBeLessThanOrEqual(GRID.rail + 0.5);
    expect(noteBlock('', theme)).toBeNull();
  });
});

describe('visuals', () => {
  const visuals: VisualSpec[] = [
    { type: 'timeline', title: 'Une journée', labels: ['Matin : sortie au réveil', '12 h : sortie', '17 h : balade'], values: [] },
    { type: 'timeline', title: 'Long', labels: Array.from({ length: 7 }, (_, k) => `Étape ${k + 1} du parcours`), values: [] },
    { type: 'bar_chart', title: 'Mesuré', labels: ['Après la sieste', 'Après le repas'], values: [68, 37] },
    { type: 'checklist_card', title: 'Le kit', labels: Array.from({ length: 6 }, (_, k) => `Objet ${k + 1}`), values: [] },
    { type: 'quote', title: 'À retenir', labels: ['Un accident n’efface pas 21 jours.', 'L’équipe Studio', 'Nuit 1', 'Tenez bon'], values: [] },
    { type: 'steps_diagram', title: 'En 4 temps', labels: ['Laisse courte', 'Même endroit', 'Mot-signal', 'Récompense'], values: [] },
    { type: 'icon_grid', title: 'Les signaux', labels: ['Il renifle', 'Il tourne', 'Il gémit', 'Il quitte le jeu', 'Il se réveille', 'Il vient de boire'], values: [] },
    { type: 'do_dont', title: 'Quand il y a un accident', labels: ['À faire : nettoyer', 'À éviter : gronder'], values: [] },
  ];
  const textsOf = (ops: Op[]): string[] => ops.flatMap((o) => (o.k === 'text' ? [o.s] : o.k === 'group' || o.k === 'clip' ? textsOf(o.ops) : []));

  it.each(visuals.map((v) => [v.type, v] as const))('%s is drawn in ink, every label printed, the height it announced', (_, v) => {
    const layout = layoutVisual(v, GRID.full, theme)!;
    const s = new Scene(GRID.full, 800);
    layout.draw(s, 0, 0);
    const printed = textsOf(s.ops).join(' ').replace(/\s/g, ' ');
    expect(printed).toContain(v.title);
    const svg = toSvg(s);
    expect(svg).not.toMatch(/Gradient|<image|<filter/);
    const ys = s.ops.flatMap((o) => (o.k === 'text' ? [o.y] : []));
    expect(Math.max(...ys)).toBeLessThanOrEqual(layout.height);
    for (const l of v.type === 'do_dont' ? ['Nettoyer', 'Gronder'] : v.labels.slice(0, 2)) expect(printed.toLowerCase()).toContain(l.replace(/^.*: /, '').slice(0, 8).toLowerCase());
  });

  it('a new type comes from diagrams.ts, a spec that lost its data falls back on its labels', () => {
    const cycle: VisualSpec = { type: 'cycle', title: 'La boucle', labels: ['Il sort', 'Il rentre', 'Il fait'], values: [], cycle: { nodes: ['Il sort', 'Il rentre', 'Il fait'], breakAt: 1, center: 'Le maillon' } };
    expect(layoutVisual(cycle, GRID.full, theme)!.height).toBeGreaterThan(100);
    const { cycle: _gone, ...bare } = cycle;
    const fallback = layoutVisual(bare, GRID.full, theme)!;
    const s = new Scene(GRID.full, 400);
    fallback.draw(s, 0, 0);
    expect(textsOf(s.ops)).toEqual(expect.arrayContaining(['Il sort', 'Il rentre', 'Il fait']));
  });

  it('a grid draws a box per row, never ticked, and says how to use it', () => {
    const v: VisualSpec = { type: 'grid', title: 'Plan', labels: [], values: [], grid: { columns: ['Jour', 'Au programme', 'Fait'], rows: ['Jour 1', 'Jour 2'], cells: [['Sortir', null], ['Jouer', null]] } };
    const m = gridModel(v, GRID.full, theme)!;
    expect(m.note).toBe('Cochez chaque ligne une fois faite.');
    const s = new Scene(GRID.full, 200);
    const end = m.draw(s, 0, 0, 0, 2, 0);
    expect(end).toBeCloseTo(m.heightOf(0, 2), 3);
    expect(gridModel({ ...v, grid: { columns: ['Seul'], rows: ['x'] } }, GRID.full, theme)).toBeNull();
  });
});

// ───────────────────────────── whole guides ─────────────────────────────

const render = (name: string, content: PdfContent, o: { effort?: DesignEffort; design?: DesignSpec; upsell?: { title: string; url: string } | null; title?: string } = {}) =>
  renderPdf({ product: productOf(o.title ?? content.title, content), content, design: o.design ?? design, brand: 'Pixel Agency', outFile: join(dir, `${name}.pdf`), upsell: o.upsell ?? null, ...(o.effort ? { effort: o.effort } : {}) });

const LEVELS = [0.1, 0.4, 0.8].map((t) => effortFor(t));

describe('guides as the writers write them', () => {
  it('at every finish: no widow, no stranded heading, no text page under MIN_PAGE_FILL, no overflow', () => {
    expect(allOf().length).toBeGreaterThanOrEqual(7);
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        const where = `${title.slice(0, 30)} / finition ${effort.finish}`;
        expect(guide.audit.widows, where).toBe(0);
        expect(guide.audit.strandedHeadings, where).toBe(0);
        expect(guide.audit.overflow, where).toBe(0);
        expect(brokenRules(guide.plans), where).toEqual([]);
        for (const [i, page] of textOf(guide.plans).entries()) {
          const solid = page.items.filter((x) => x.t !== 'notes');
          expect(solid.length, `${where}, page ${i}`).toBeGreaterThan(0);
          expect(page.fill, `${where}, page ${i}`).toBeGreaterThanOrEqual(MIN_PAGE_FILL);
        }
      }
    }
  });

  it('no text leaves its page: each line stays between the margins', () => {
    const walk = (ops: Op[], dx: number, dy: number, hit: (o: Extract<Op, { k: 'text' }>, x: number, y: number) => void): void => {
      for (const o of ops) {
        if (o.k === 'text') hit(o, dx + o.x, dy + o.y);
        else if (o.k === 'group') walk(o.ops, dx + o.x, dy + o.y, hit);
        else if (o.k === 'clip') walk(o.ops, dx, dy, hit);
      }
    };
    for (const { title, content } of allOf().slice(0, 3)) {
      const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
      guide.pages.slice(1).forEach((page, n) => walk(page.scene.ops, 0, 0, (o, x, y) => {
        if (x > GRID.left + GRID.full) return; // the section tab
        const w = advance(o.font, o.s, o.size, o.track ?? 0);
        const left = o.anchor === 'middle' ? x - w / 2 : o.anchor === 'end' ? x - w : x;
        expect(left, `p${n + 2} « ${o.s} »`).toBeGreaterThanOrEqual(GRID.left - 6);
        expect(left + w, `p${n + 2} « ${o.s} »`).toBeLessThanOrEqual(GRID.left + GRID.full + 1);
        expect(y, `p${n + 2} « ${o.s} »`).toBeLessThanOrEqual(GRID.folio + 1);
      }));
    }
  });

  it('`finish` is what is drawn, and the rail shows only from finish 1', () => {
    // a second visual of a type no chapter uses as its first: the `visual` of a guide is drawn at every finish, its `figure` from finish 2
    const content = withRail({ ...written[0]!.content, chapters: written[0]!.content.chapters.map((c, k) => (k === 0 ? { ...c, figure: { type: 'timeline', title: 'Si ça résiste', labels: ['Jour 1 : il refuse', 'Jour 2 : il goûte'], values: [] } } : c)) });
    const at = (t: number) => layoutPdf({ product: productOf('Un guide', content), content, design, brand: 'Pixel Agency', effort: effortFor(t) });
    const has = (g: ReturnType<typeof at>, what: (i: Placed) => boolean) => g.plans.some((p) => p.items.some(what));
    const low = at(0.1);
    const mid = at(0.4);
    const top = at(0.9);
    const rail = (i: Placed) => i.t === 'rail';
    const drop = (i: Placed) => i.t === 'para' && !!i.block.drop;
    expect([low, mid, top].map((g) => has(g, rail))).toEqual([false, true, true]);
    expect([low, mid, top].map((g) => has(g, drop))).toEqual([false, true, true]);
    expect([low, mid, top].map((g) => g.plans.some((p) => p.kind === 'memo'))).toEqual([false, false, true]);
    expect(has(mid, (i) => i.t === 'block' && i.block.t === 'figure' && i.block.kind === 'timeline')).toBe(false);
    expect(has(top, (i) => i.t === 'block' && i.block.t === 'figure' && i.block.kind === 'timeline')).toBe(true);
    expect(top.pages.length).toBeGreaterThan(mid.pages.length);
    const printed = (g: ReturnType<typeof at>) => g.pages.flatMap((p) => p.scene.ops).flatMap((o) => (o.k === 'text' ? [o.s] : []));
    expect(printed(top)).toContain('Votre plan sur une page');
    expect(printed(top)).toContain('Si ça coince');
    expect(printed(mid)).not.toContain('Si ça coince');
    expect(top.audit.railShare).toBeGreaterThan(0);
  });

  it('openers wear a different art at each chapter, and the type is never the standard set', async () => {
    const res = await render('openers', written[0]!.content);
    const raw = (await readFile(join(dir, 'openers.pdf'))).toString('latin1');
    expect((raw.match(/\/FontFile2/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(raw).not.toMatch(/\/BaseFont \/(Helvetica|Times)/);
    expect(res.pages).toBeGreaterThan(written[0]!.content.chapters.length + 5);
    const guide = layoutPdf({ product: productOf('x', written[0]!.content), content: written[0]!.content, design, brand: 'Pixel Agency' });
    const openers = guide.pages.filter((_, k) => k > 0 && guide.plans[k - 1]!.kind === 'opener').map((p) => JSON.stringify(p.scene.ops.slice(0, 40)));
    expect(openers.length).toBeGreaterThanOrEqual(5);
    expect(new Set(openers).size).toBe(openers.length);
  });
});

describe('chapter openers (D66)', () => {
  const heroAt = (ops: Op[]): number => ops.findIndex((o) => o.k === 'clip' && Number(/h([\d.]+)v/.exec(o.d)?.[1] ?? 0) > (2 * GRID.W) / 6);

  /** The hero of an opener, wherever and however large it sits: its inks, its shapes, and where it starts in its box. */
  function heroOf(ops: Op[]): string {
    const at = heroAt(ops);
    const clip = ops[at] as Extract<Op, { k: 'clip' }>;
    const [x, y, size] = [...clip.d.matchAll(/[\d.]+/g)].map((m) => Number(m[0]));
    const shape = (d: string) => d.replace(/-?[\d.]+/g, '').replace(/\s/g, '');
    const first = clip.ops.find((o) => o.k === 'path');
    const start = first?.k === 'path' ? [...first.d.matchAll(/-?[\d.]+/g)].slice(0, 2).map((m, k) => (Number(m[0]) - (k ? y! : x!)) / size!) : [];
    const ground = ops[at - 1]!;
    return JSON.stringify([ground.k === 'path' ? ground.fill : null, start.map((v) => v.toFixed(2)), clip.ops.map((o) => (o.k === 'path' ? [o.fill, o.stroke, shape(o.d)] : [o.k, o.k === 'text' ? 0 : o.ops.length]))]);
  }

  it('no two openers of a guide draw the same hero, at any finish', () => {
    for (const { title, content } of allOf()) {
      for (const effort of LEVELS) {
        const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort });
        const heroes = guide.pages.filter((_, k) => k > 0 && guide.plans[k - 1]!.kind === 'opener').map((p) => heroOf(p.scene.ops));
        expect(heroes.length, title).toBeGreaterThanOrEqual(content.chapters.length);
        expect(new Set(heroes).size, `${title.slice(0, 30)} / finition ${effort.finish}`).toBe(heroes.length);
      }
    }
  });

  it('the drawing itself opens a chapter smaller than on the cover, and on the other side', () => {
    const titles = written[0]!.content.chapters.map((_, k) => `Sans indice ${k}`);
    const content: PdfContent = { ...written[0]!.content, chapters: written[0]!.content.chapters.map((ch, k) => ({ ...ch, title: titles[k]! })) };
    const seen = new Set<number>();
    for (let artSeed = 1; artSeed <= 60; artSeed++) {
      const at = posesOf([...titles, content.bonus.title], artSeed).indexOf('portrait');
      if (at < 0 || at >= titles.length) continue;
      seen.add(at);
      const guide = layoutPdf({ product: productOf('x', content), content, design: { ...design, artSeed }, brand: 'Pixel Agency', effort: LEVELS[2]! });
      const page = guide.plans.findIndex((p) => p.kind === 'opener' && p.chapter === at + 1);
      const { ops } = guide.pages[page + 1]!.scene;
      const clip = ops[heroAt(ops)] as Extract<Op, { k: 'clip' }>;
      const [x, , size] = [...clip.d.matchAll(/[\d.]+/g)].map((m) => Number(m[0]));
      expect(x, `graine ${artSeed}`).toBe(0);
      expect(size, `graine ${artSeed}`).toBeCloseTo((3 * GRID.W) / 6, 1);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4); // chapters that would have taken the big hero or the right side among them
  });

  it('a band closes on a picture of its own: the hero changes from section to section, in every guide', () => {
    const shape = (ops: Op[]): string => JSON.stringify(ops.map((o) => (o.k === 'path' ? [o.fill, o.stroke, o.d.replace(/-?[\d.]+/g, '')] : o.k)));
    for (const { title, content } of allOf()) {
      const guide = layoutPdf({ product: productOf(title, content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
      const heroes: string[] = [];
      guide.plans.forEach((plan, k) => {
        const end = plan.items.find((i) => i.t === 'end');
        if (end?.t !== 'end' || end.rows < 2) return;
        const clip = guide.pages[k + 1]!.scene.ops.filter((o): o is Extract<Op, { k: 'clip' }> => o.k === 'clip').at(-1)!;
        heroes.push(shape(clip.ops));
      });
      expect(heroes.length, title.slice(0, 30)).toBeGreaterThanOrEqual(3);
      heroes.forEach((h, k) => { if (k) expect(h, title.slice(0, 30)).not.toBe(heroes[k - 1]); });
      expect(new Set(heroes).size, title.slice(0, 30)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the art of an opener belongs to its guide: same chapters, same art; a new seed, new art', () => {
    const { content } = written[0]!;
    const at = (d: DesignSpec) => layoutPdf({ product: productOf('x', content), content, design: d, brand: 'Pixel Agency' });
    const openers = (g: ReturnType<typeof at>) => g.pages.filter((_, k) => k > 0 && g.plans[k - 1]!.kind === 'opener').map((p) => JSON.stringify(p.scene.ops));
    expect(openers(at(design))).toEqual(openers(at(design)));
    expect(openers(at({ ...design, artSeed: 91 }))).not.toEqual(openers(at(design)));
  });

  it('the bonus keeps its own ground', () => {
    const { content } = written[0]!;
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency', effort: LEVELS[2]! });
    const ops = guide.pages[guide.plans.findLastIndex((p) => p.kind === 'opener') + 1]!.scene.ops;
    expect(ops[heroAt(ops) - 1]).toMatchObject({ k: 'path', fill: theme.inks.b });
  });
});

describe('navigation', () => {
  it('has one outline item per contents entry, and every link has a destination', async () => {
    const { content } = written[0]!;
    const res = await render('nav', content, { effort: LEVELS[2]!, upsell: null });
    const raw = (await readFile(join(dir, 'nav.pdf'))).toString('latin1');
    expect(raw).toContain('/Outlines');
    expect(raw).toContain('/PageMode /UseOutlines');
    expect(raw).toContain('/Lang (fr-FR)');
    expect(raw).toContain('/DisplayDocTitle true');
    const outline = [...raw.matchAll(/\/Dest \[\d+ 0 R \/Fit\]/g)].length;
    const toc = pdfPagesText(join(dir, 'nav.pdf'))[2]!;
    const links = [...raw.matchAll(/\/S \/GoTo\s+\/D \(([^)]+)\)/g)].map((m) => m[1]!);
    const names = new Set([...raw.matchAll(/\(([a-z0-9-]+)\) \[\d+ 0 R \/XYZ/g)].map((m) => m[1]!));
    expect(outline).toBeGreaterThanOrEqual(content.chapters.length + 3);
    // the last page's button goes back to the plan, the others are the contents
    expect(new Set(links).size).toBe(outline);
    for (const l of links) expect(names.has(l), l).toBe(true);
    for (const c of content.chapters) expect(toc.replace(/\s/g, ' ')).toContain(c.title.replace(/\s/g, ' ').slice(0, 30));
    expect(res.audit.pages).toBe(res.pages);
    expect(res.audit.bytes).toBe((await readFile(join(dir, 'nav.pdf'))).length);
  });

  it('the contents print the page each chapter really opens on, the tabs fit a long guide', () => {
    const { content } = written[0]!;
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency' });
    const opens = guide.plans.flatMap((p, k) => (p.kind === 'opener' && p.chapter ? [[p.chapter, k + 2] as const] : []));
    const toc = guide.pages[2]!.scene.ops.flatMap((o) => (o.k === 'text' ? [o.s] : []));
    for (const [, page] of opens.slice(0, -1)) expect(toc).toContain(String(page));
    expect(tabHeight(3)).toBe(54);
    expect(110 + 30 * tabHeight(30)).toBeLessThanOrEqual(GRID.H - 100);
  });

  it('the running head is never cut in the middle of a word, and never carries an ellipsis', () => {
    const title = `Un chapitre au titre bien trop long pour tenir sur une seule ligne de page, ${'avec des détails en cascade, '.repeat(8)}et encore`;
    const content: PdfContent = { ...written[0]!.content, chapters: [chapter({ title, paragraphs: Array.from({ length: 14 }, () => chapter().paragraphs[0]!) })] };
    const guide = layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency' });
    const text = guide.plans.findIndex((p) => p.kind === 'text' && p.chapter === 1);
    const head = guide.pages[text + 1]!.scene.ops.find((o) => o.k === 'text' && o.size === 7.6);
    expect(head && head.k === 'text' && head.s).toBeTruthy();
    const s = head!.k === 'text' ? head!.s : '';
    expect(s).not.toContain('…');
    expect(title.startsWith(s)).toBe(true);
    expect(advance(VOICES.conte.label, s, 7.6)).toBeLessThanOrEqual(GRID.full);
  });
});

describe('a render', () => {
  it('two renders of one guide give identical bytes', async () => {
    const { content } = written[1]!;
    const upsell = { title: 'La suite', url: '/runs/r/files/prd_2/v1/sales-page.html' };
    const a = await render('same-a', content, { upsell, effort: LEVELS[2]! });
    const b = await render('same-b', content, { upsell, effort: LEVELS[2]! });
    expect(a.bytes).toBe(b.bytes);
    expect((await readFile(join(dir, 'same-a.pdf'))).equals(await readFile(join(dir, 'same-b.pdf')))).toBe(true);
    expect(a.previews).toEqual(b.previews);
    expect(a.audit).toEqual(b.audit);
  });

  it('a page laid out by hand that runs past its foot is counted as an overflow', () => {
    const { content } = written[0]!;
    const long = { ...content, nextStep: { ...content.nextStep, text: 'Une phrase de plus pour rien. '.repeat(120) } };
    expect(layoutPdf({ product: productOf('x', long), content: long, design, brand: 'Pixel Agency' }).audit.overflow).toBeGreaterThan(0);
    expect(layoutPdf({ product: productOf('x', content), content, design, brand: 'Pixel Agency' }).audit.overflow).toBe(0);
  });

  it('new art on the same text is a new file', async () => {
    const { content } = written[0]!;
    const a = await render('art-a', content);
    const b = await render('art-b', content, { design: { ...design, artSeed: 77 } });
    expect(a.pages).toBe(b.pages);
    expect((await readFile(join(dir, 'art-a.pdf'))).equals(await readFile(join(dir, 'art-b.pdf')))).toBe(false);
  });

  it('an empty font folder degrades cleanly: the guide renders, in the standard set, and says so', async () => {
    setFontDir(await mkdtemp(join(dir, 'empty-')));
    const res = await render('degraded', written[0]!.content);
    expect(res.audit.degraded).toBe(true);
    expect(res.pages).toBeGreaterThan(8);
    const raw = (await readFile(join(dir, 'degraded.pdf'))).toString('latin1');
    expect(raw).not.toContain('/FontFile2');
    expect(pdfPagesText(join(dir, 'degraded.pdf')).join(' ')).toContain('Au programme');
    setFontDir();
    expect((await render('whole', written[0]!.content)).audit.degraded).toBe(false);
  });

  it('gives real pages as previews: at least 3, under 700 KB, no body sentence given away', async () => {
    const { content } = written[0]!;
    const res = await render('previews', content, { effort: LEVELS[2]! });
    expect(res.previews.length).toBeGreaterThanOrEqual(3);
    expect(res.previews.length).toBeLessThanOrEqual(6);
    expect(new Set(res.previews.map((p) => p.label)).size).toBe(res.previews.length);
    const sentence = content.chapters[0]!.paragraphs[0]!.slice(0, 30);
    for (const p of res.previews) {
      expect(p.svg.startsWith('<svg')).toBe(true);
      expect(p.svg.length, p.label).toBeLessThanOrEqual(700_000);
      expect(p.svg).not.toContain(sentence);
    }
  });

  it('draws every page through the Scene: pdfkit no longer gets a card, a gradient nor svg-to-pdfkit', async () => {
    await render('scene', written[0]!.content);
    const streams = pdfPageStreams(join(dir, 'scene.pdf'));
    expect(streams.join('\n')).not.toMatch(/\/Pattern|\bsh\b/);
    const src = 'src/deliverables';
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    for (const f of files) expect(readFileSync(join(src, f), 'utf8'), f).not.toMatch(/from 'svg-to-pdfkit'/);
    expect(readFileSync('package.json', 'utf8')).not.toContain('svg-to-pdfkit');
  });

  it('the last page says what `finalWording` says, and the test for the reader stays « Je reviens à mon plan »', async () => {
    const content: PdfContent = { ...written[0]!.content };
    const say = finalWording(content, null, { dest: 'chapitre-1', label: 'Je reviens à mon plan' });
    await render('final', content);
    const last = pdfPagesText(join(dir, 'final.pdf')).at(-1)!;
    expect(last).toContain(say.heading);
    expect(last).toContain('PIXEL AGENCY');
  });
});
