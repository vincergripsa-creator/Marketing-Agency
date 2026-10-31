import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChapterContent, DesignEffort, DesignSpec, NicheBrief, PdfContent, Product, VisualSpec } from '../src/shared.js';
import { createRng } from '../src/core/index.js';
import { advance, setFontDir } from '../src/deliverables/fonts.js';
import { demoContent, demoProduct } from '../src/deliverables/fixture.js';
import { designFor, normalizeDesign } from '../src/deliverables/design.js';
import { effortFor } from '../src/deliverables/effort.js';
import { renderPdf } from '../src/deliverables/index.js';
import type { Block, ChecklistBlock, ExampleBlock, FigureBlock, HeadingBlock, NoteBlock, ParaBlock, SheetBlock, StepsBlock } from '../src/deliverables/layout/blocks.js';
import { chapterBlocks, lineOf, noteBlock, sheetBlock } from '../src/deliverables/layout/blocks.js';
import { BODY_BOTTOM, BODY_H, GRID, MIN_PAGE_FILL, SHORT_PAGE, tabHeight, wrapWords } from '../src/deliverables/layout/grid.js';
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

const flowOf = (p: PagePlan): Placed[] => p.items.filter((i) => i.t !== 'rail' && i.t !== 'notes');
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

  it('every layout keeps the rules on seven lengths of real text', () => {
    const filler = 'Il est six heures quarante, la flaque est sur le tapis du salon, encore une fois, et le voisin du dessous commence à se plaindre de l’odeur. ';
    for (let n = 1; n <= 7; n++) {
      const ch = chapter({ paragraphs: [...chapter().paragraphs, ...Array.from({ length: n % 4 }, () => filler.repeat(1 + (n % 3)))], visual: { type: 'timeline', title: 'Une journée', labels: ['7 h : sortie', '12 h : sortie', '17 h : sortie'], values: [] } });
      const blocks = chapterBlocks(ch, theme, { finish: 2, lead: null, example: { label: 'Exemple type', text: 'Manon programme une sortie après chaque sieste.' } });
      for (const p of LAYOUTS) expect(brokenRules(paginate(blocks, p)), `variante ${n}`).toEqual([]);
    }
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
    const blocks = [para(50), para(9)];
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
    const content = withRail({ ...written[0]!.content, chapters: written[0]!.content.chapters.map((c, k) => (k === 0 ? { ...c, figure: { type: 'decision_tree', title: 'Si ça résiste', labels: ['Il refuse : attendez'], values: [], tree: { question: 'Que s’est-il passé ?', cases: [{ when: 'Il refuse', then: 'Attendez deux minutes.' }, { when: 'Il pleure', then: 'Restez à côté de lui.' }] } } } : c)) });
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
    expect(has(mid, (i) => i.t === 'block' && i.block.t === 'figure' && i.block.kind === 'decision_tree')).toBe(false);
    expect(has(top, (i) => i.t === 'block' && i.block.t === 'figure' && i.block.kind === 'decision_tree')).toBe(true);
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
