import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { afterAll, describe, expect, it } from 'vitest';
import { contrast, mix } from '../src/deliverables/color.js';
import { normalizeDesign, PALETTES } from '../src/deliverables/design.js';
import { beforeAfter, cycleDiagram, decisionTree, diagramFor, gaugeDiagram, matrixDiagram, planPath, stepPath, type Diagram, type FigureStyle } from '../src/deliverables/diagrams.js';
import { demoContent, demoProduct } from '../src/deliverables/fixture.js';
import { advance, registerVoice } from '../src/deliverables/fonts.js';
import { toPdf, toSvg, type Op, type Scene } from '../src/deliverables/scene.js';
import { STD_VOICE, VOICES } from '../src/deliverables/voices.js';
import { repoRoot } from '../src/core/paths.js';
import type { PdfContent, TypeVoice, VisualSpec, WorldState } from '../src/shared.js';
import { pdfPagesText } from './pdfText.js';

type TextOp = Extract<Op, { k: 'text' }>;
interface Rect { x0: number; y0: number; x1: number; y1: number }

const WIDTHS = [340, 487]; // the text column and the full measure of the page grid
const VOICE_IDS = Object.keys(VOICES) as TypeVoice[];
const THE_FIXTURE: FigureStyle = { voice: VOICES[normalizeDesign(demoProduct.design).voice ?? 'conte'], inks: normalizeDesign(demoProduct.design).inks! };
const OLD_SAVE = join(repoRoot(), 'server', 'test', 'fixtures', 'world-v1.json.gz');

const dir = mkdtempSync(join(tmpdir(), 'diagrams-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// ───────────────────────────── the fixture guide, read through the sources of pdf §9.2 ─────────────────────────────

const chapters = demoContent.chapters;

/** « Nuits 1 à 3 : bébé s’endort… » → the track and the station it is. */
const paliers = chapters[3]!.steps.map((s) => {
  const m = /^(Nuits (\d+) à (\d+)) : (.+)\.$/u.exec(s)!;
  return { when: m[1]!, from: Number(m[2]), to: Number(m[3]), label: m[4]! };
});
const doDont = chapters[3]!.visual!.labels.map((l) => l.replace(/^[^:]+ : /u, ''));
const situations = chapters[5]!.visual!.labels.map((l) => l.split(' : '));

/** One figure of each new type, every word of it taken from the guide. */
function figuresOf(): VisualSpec[] {
  return [
    { type: 'cycle', title: chapters[2]!.visual!.title, labels: [], values: [], cycle: { nodes: chapters[2]!.visual!.labels.slice(0, 4), breakAt: 3, center: chapters[2]!.title.slice(4, 22) } },
    { type: 'plan_path', title: 'Le décrochage, nuit après nuit', labels: [], values: [], plan: { days: 14, unit: 'nuit', tracks: paliers.map(({ from, to, label }) => ({ from, to, label })) } },
    { type: 'decision_tree', title: chapters[5]!.visual!.title, labels: [], values: [], tree: { question: chapters[5]!.intro, cases: situations.map(([when, then]) => ({ when: when!, then: then! })) } },
    { type: 'before_after', title: chapters[3]!.visual!.title, labels: [], values: [], pairs: [0, 1, 2].map((i) => ({ before: doDont[i + 3]!, after: doDont[i]! })) },
    { type: 'matrix', title: chapters[5]!.title, labels: [], values: [], matrix: { heads: ['À garder', 'À arrêter', 'À tester', 'À surveiller'], cells: [chapters[1]!.checklist, chapters[4]!.visual!.labels.slice(0, 2), chapters[2]!.checklist.slice(0, 2), chapters[5]!.checklist.slice(0, 1)] } },
    { type: 'gauge', title: chapters[0]!.title, labels: [], values: [], gauge: { rows: chapters[0]!.checklist, low: 'Pas du tout', high: 'Tout à fait' } },
    { type: 'step_path', title: chapters[3]!.title, labels: [], values: [], path: { stations: paliers.map(({ when, label }, i) => ({ label, when: i % 2 ? null : when, duration: i === 0 ? '20 minutes' : null })) } },
  ];
}

const BY_TYPE = { cycle: cycleDiagram, plan_path: planPath, decision_tree: decisionTree, before_after: beforeAfter, matrix: matrixDiagram, gauge: gaugeDiagram, step_path: stepPath };
const ALL_TYPES = Object.keys(BY_TYPE);

/** All that the reader must find in the drawing of a figure. */
function wordsOf(v: VisualSpec): string[] {
  const words = [v.title];
  if (v.cycle) words.push(...v.cycle.nodes, v.cycle.center);
  if (v.plan) words.push(v.plan.unit.toUpperCase(), ...v.plan.tracks.map((t) => t.label));
  if (v.tree) words.push(v.tree.question, ...v.tree.cases.flatMap((c) => [c.when, c.then]));
  if (v.pairs) words.push(...v.pairs.flatMap((p) => [p.before, p.after]));
  if (v.matrix) words.push(...v.matrix.heads, ...v.matrix.cells.flat());
  if (v.gauge) words.push(...v.gauge.rows, v.gauge.low, v.gauge.high);
  if (v.path) words.push(...v.path.stations.flatMap((st) => [st.label, st.when, st.duration].filter((x): x is string => !!x)));
  return words;
}

/** Numbers a figure may set on its own: a rank counts its nodes, an axis counts days, a ruler counts 0 to 10. They say nothing about the world. */
function structureOf(v: VisualSpec): Set<string> {
  const upTo = (a: number, b: number) => new Set(Array.from({ length: b - a + 1 }, (_, i) => String(a + i)));
  switch (v.type) {
    case 'cycle': return upTo(1, v.cycle!.nodes.length);
    case 'step_path': return upTo(1, v.path!.stations.length);
    case 'plan_path': return upTo(1, v.plan!.days);
    case 'gauge': return upTo(0, 10);
    default: return new Set();
  }
}

// ───────────────────────────── reading a Scene back ─────────────────────────────

const textsOf = (s: Scene): TextOp[] => s.ops.filter((o): o is TextOp => o.k === 'text');
const flat = (t: string): string => t.normalize('NFC').replace(/[\s  ]+/gu, ' ').trim();

/** Ink box of a line of text, whatever its anchor. */
function boxOf(o: TextOp): Rect {
  const w = advance(o.font, o.s, o.size, o.track ?? 0);
  const x0 = !o.anchor || o.anchor === 'start' ? o.x : o.anchor === 'middle' ? o.x - w / 2 : o.x - w;
  return { x0, x1: x0 + w, y0: o.y - o.size * 0.74, y1: o.y + o.size * 0.22 };
}

const meets = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Straight strokes: `line()` writes M x y L x y. */
function strokesOf(s: Scene): (Rect & { d?: [number, number] })[] {
  const out: (Rect & { d?: [number, number] })[] = [];
  for (const o of s.ops) {
    const m = o.k === 'path' && o.stroke ? /^M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)$/.exec(o.d) : null;
    if (!m) continue;
    const [x0, y0, x1, y1] = m.slice(1).map(Number) as [number, number, number, number];
    out.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), ...(o.k === 'path' && o.dash ? { d: o.dash } : {}) });
  }
  return out;
}

/** Filled rectangles: `rect()` writes M x y h w v h h -w Z. */
function barsOf(s: Scene): (Rect & { fill: string; i: number })[] {
  const out: (Rect & { fill: string; i: number })[] = [];
  s.ops.forEach((o, i) => {
    const m = o.k === 'path' && o.fill && o.op === undefined ? /^M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)h-?[\d.]+Z$/.exec(o.d) : null;
    if (!m) return;
    const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
    out.push({ x0: x, y0: y, x1: x + w, y1: y + h, fill: (o as { fill: string }).fill, i });
  });
  return out;
}

/** The ring: one arc per link, read from the path data, and its nodes, read from their ranks. */
function ringOf(s: Scene): { cx: number; cy: number; R: number; nodes: [number, number][]; arcs: { from: [number, number]; to: [number, number]; r: number; broken: boolean }[] } {
  const nodes = textsOf(s).filter((t) => /^\d+$/.test(t.s)).map((t): [number, number] => [t.x, t.y - 4.6]);
  const cx = nodes.reduce((sum, p) => sum + p[0], 0) / nodes.length;
  const cy = nodes.reduce((sum, p) => sum + p[1], 0) / nodes.length;
  const arcs = s.ops.flatMap((o) => {
    const m = o.k === 'path' ? /^M(-?[\d.]+) (-?[\d.]+)A([\d.]+) [\d.]+ 0 \d 1 (-?[\d.]+) (-?[\d.]+)$/.exec(o.d) : null;
    return m ? [{ from: [Number(m[1]), Number(m[2])] as [number, number], to: [Number(m[4]), Number(m[5])] as [number, number], r: Number(m[3]), broken: o.k === 'path' && !!o.dash }] : [];
  });
  return { cx, cy, R: arcs[0]?.r ?? 0, nodes, arcs };
}

/** Distance from a point to the nearest edge of a box, 0 inside it. */
const distanceTo = (x: number, y: number, b: Rect): number => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

/** The numbers a text holds. « 18-20 °C » is two, « 2 h 30 » is two. */
const numbersIn = (t: string): string[] => t.match(/\d+/g) ?? [];

/** What a figure prints that the guide never says, ranks and axes set aside. */
function invented(d: Diagram, v: VisualSpec, guide: Set<string>): string[] {
  const own = structureOf(v);
  return textsOf(d.scene).flatMap((t) => (/^\d+$/.test(t.s) && own.has(t.s) ? [] : numbersIn(t.s).filter((x) => !guide.has(x))));
}

/** Every string of a guide, at any depth, without the figures themselves. */
function textOfGuide(c: PdfContent): string {
  const walk = (x: unknown): string[] => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(walk) : x && typeof x === 'object' ? Object.values(x).flatMap(walk) : []);
  return walk(c).join('\n');
}

/** A clean figure: its height on the baseline unit, all its text inside it, nothing on top of anything, not one label missing. */
function expectClean(d: Diagram, v: VisualSpec, width: number, label: string): void {
  const texts = textsOf(d.scene);
  expect(d.scene.w, label).toBe(width);
  expect(d.scene.h, label).toBe(d.height);
  expect(Math.abs(d.height / 3.6 - Math.round(d.height / 3.6)), `${label}: on the baseline unit`).toBeLessThan(1e-6);
  expect(texts.length, label).toBeGreaterThan(0);
  const boxes = texts.map(boxOf);
  boxes.forEach((b, i) => {
    const line = `${label}: « ${texts[i]!.s} »`;
    expect(b.x0, line).toBeGreaterThanOrEqual(-0.01);
    expect(b.x1, line).toBeLessThanOrEqual(width + 0.01);
    expect(b.y0, line).toBeGreaterThanOrEqual(0);
    expect(b.y1, line).toBeLessThanOrEqual(d.height + 0.01);
    for (let j = i + 1; j < boxes.length; j++) expect(meets(b, boxes[j]!), `${line} sits on « ${texts[j]!.s} »`).toBe(false);
    for (const k of strokesOf(d.scene)) expect(meets({ ...k, x1: k.x1 + 0.01, y1: k.y1 + 0.01 }, b), `${line} is crossed by a rule`).toBe(false);
  });
  for (const b of barsOf(d.scene)) {
    expect(b.x0, label).toBeGreaterThanOrEqual(-0.01);
    expect(b.x1, label).toBeLessThanOrEqual(width + 0.01);
    expect(b.y1, label).toBeLessThanOrEqual(d.height + 0.01);
  }
  const drawn = flat(texts.map((t) => t.s).join(' '));
  for (const word of wordsOf(v)) expect(drawn, `${label}: every label`).toContain(flat(word));
}

async function pdfOf(name: string, voice: FigureStyle['voice'], draw: (doc: PDFKit.PDFDocument) => void): Promise<string> {
  const file = join(dir, `${name}.pdf`);
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
  const out = createWriteStream(file);
  doc.pipe(out);
  registerVoice(doc, voice);
  draw(doc);
  doc.end();
  await finished(out);
  return file;
}

// ───────────────────────────── the tests of pdf §16 ─────────────────────────────

describe('each new visual type', () => {
  const figures = figuresOf();

  it('covers the seven new types, each drawn by its own function', () => {
    expect(figures.map((v) => v.type)).toEqual(ALL_TYPES);
    for (const v of figures) {
      const own = BY_TYPE[v.type as keyof typeof BY_TYPE](v, 487, THE_FIXTURE);
      expect(own, v.type).not.toBeNull();
      expect(diagramFor(v, 487, THE_FIXTURE)?.scene.ops, v.type).toEqual(own!.scene.ops);
    }
  });

  it('renders on the fixture at both measures: no overflow, nothing overlapping, every label present', () => {
    for (const width of WIDTHS) {
      for (const v of figures) {
        const d = diagramFor(v, width, THE_FIXTURE);
        expect(d, `${v.type} at ${width}`).not.toBeNull();
        expectClean(d!, v, width, `${v.type} at ${width}`);
      }
    }
  });

  it('holds in the four voices and on the fifteen ink sets', () => {
    for (const id of VOICE_IDS) {
      for (const { name, inks } of PALETTES) {
        const style: FigureStyle = { voice: VOICES[id], inks };
        for (const width of WIDTHS) for (const v of figures) expectClean(diagramFor(v, width, style)!, v, width, `${v.type} ${id} ${name} ${width}`);
      }
    }
  });

  it('keeps long words of the writer in their boxes: no ellipsis, no cut sentence', () => {
    const long = 'Une phrase de recherche volontairement longue qui revient sur la même idée, puis la reprend encore une fois, jusqu’à déborder de sa case si rien ne la replie';
    const heavy: VisualSpec[] = figuresOf().map((v): VisualSpec => {
      if (v.cycle) return { ...v, title: long, cycle: { nodes: v.cycle.nodes.map(() => long.slice(0, 90)), breakAt: 0, center: 'Le maillon' } };
      if (v.plan) return { ...v, title: long, plan: { ...v.plan, tracks: v.plan.tracks.map((t) => ({ ...t, label: long })) } };
      if (v.tree) return { ...v, title: long, tree: { question: long, cases: v.tree.cases.map(() => ({ when: long, then: long })) } };
      if (v.pairs) return { ...v, title: long, pairs: v.pairs.map(() => ({ before: long, after: long })) };
      if (v.matrix) return { ...v, title: long, matrix: { ...v.matrix, cells: [[long, long], [long], [long], [long, long]] } };
      if (v.gauge) return { ...v, title: long, gauge: { rows: [long, long], low: long, high: long } };
      return { ...v, title: long, path: { stations: v.path!.stations.map(() => ({ label: long, when: long, duration: long })) } };
    });
    for (const width of WIDTHS) for (const v of heavy) expectClean(diagramFor(v, width, THE_FIXTURE)!, v, width, `${v.type} heavy at ${width}`);
  });

  it('sets each string for its face: a thin no-break space and an emoji never reach the page', () => {
    const v: VisualSpec = { type: 'before_after', title: 'Bravo ! 🎉', labels: [], values: [], pairs: [{ before: 'Tout : d’un coup 🚀', after: 'Un seul point à la fois ✨' }] };
    const texts = textsOf(diagramFor(v, 487, THE_FIXTURE)!.scene).map((t) => t.s).join(' ');
    expect(texts).not.toMatch(/[ \u{1F300}-\u{1FAFF}✨]/u);
    expect(flat(texts)).toContain('Bravo !');
    expect(flat(texts)).toContain('Un seul point à la fois');
  });

  it('prints in a real PDF as selectable text in the embedded faces, and as an SVG that needs no font', async () => {
    const file = await pdfOf('all', THE_FIXTURE.voice, (doc) => {
      for (const v of figures) {
        doc.addPage();
        toPdf(doc, diagramFor(v, 487, THE_FIXTURE)!.scene, 54, 66);
      }
    });
    const bytes = readFileSync(file).toString('latin1');
    expect(bytes).toContain('/FontFile2');
    expect(bytes).not.toMatch(/\/BaseFont\s*\/Helvetica/);
    const pages = pdfPagesText(file);
    expect(pages).toHaveLength(figures.length);
    figures.forEach((v, i) => {
      const page = flat(pages[i]!);
      for (const word of wordsOf(v)) expect(page, v.type).toContain(flat(word));
      const svg = toSvg(diagramFor(v, 487, THE_FIXTURE)!.scene);
      expect(svg, v.type).not.toMatch(/<text|font-family|Gradient|<image|<filter|href=/);
      expect(svg, v.type).toContain('aria-label=');
    });
  });

  it('survives the rescue voice: no embedded font, the same words', async () => {
    const style: FigureStyle = { voice: STD_VOICE, inks: THE_FIXTURE.inks };
    for (const width of WIDTHS) for (const v of figures) expectClean(diagramFor(v, width, style)!, v, width, `${v.type} rescue at ${width}`);
    const file = await pdfOf('rescue', STD_VOICE, (doc) => {
      for (const v of figures) {
        doc.addPage();
        toPdf(doc, diagramFor(v, 487, style)!.scene, 54, 66);
      }
    });
    expect(pdfPagesText(file)).toHaveLength(figures.length);
  });

  it('reads on every ink set: small text at 4.5 on the darkest ground, ranks at 3 on their disc', () => {
    for (const { name, inks } of PALETTES) {
      const style: FigureStyle = { voice: VOICES.conte, inks };
      const tint = mix(inks.paper, inks.c, 0.22);
      for (const v of figures) {
        const texts = textsOf(diagramFor(v, 487, style)!.scene);
        const question = flat(v.tree?.question ?? '');
        for (const t of texts) {
          const line = `${name} ${v.type} « ${t.s} »`;
          if (v.type === 'decision_tree' && question.includes(flat(t.s)) && t.fill === inks.paper) expect(contrast(t.fill, inks.ink), line).toBeGreaterThanOrEqual(9);
          else if (/^\d+$/.test(t.s) && (v.type === 'cycle' || v.type === 'step_path')) expect(contrast(t.fill, inks.a), line).toBeGreaterThanOrEqual(3);
          else expect(contrast(t.fill, tint), line).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('is a pure function of its spec: two renders, the same drawing', () => {
    for (const v of figures) {
      expect(diagramFor(v, 487, THE_FIXTURE)!.scene.ops, v.type).toEqual(diagramFor(v, 487, THE_FIXTURE)!.scene.ops);
      expect(toSvg(diagramFor(v, 487, THE_FIXTURE)!.scene), v.type).toBe(toSvg(diagramFor(v, 487, THE_FIXTURE)!.scene));
    }
  });

  it('answers null, never a throw, for a spec with nothing to draw or a type it does not own', () => {
    const empty: Partial<VisualSpec>[] = [
      { type: 'cycle' }, { type: 'cycle', cycle: { nodes: ['Un', 'Deux'], breakAt: 0, center: '' } },
      { type: 'plan_path' }, { type: 'plan_path', plan: { days: 0, unit: 'jour', tracks: [{ from: 1, to: 2, label: 'x' }] } }, { type: 'plan_path', plan: { days: 14, unit: 'jour', tracks: [] } },
      { type: 'decision_tree' }, { type: 'decision_tree', tree: { question: 'Et alors ?', cases: [] } },
      { type: 'before_after' }, { type: 'before_after', pairs: [{ before: '', after: 'x' }] },
      { type: 'matrix' }, { type: 'matrix', matrix: { heads: ['a', 'b', 'c', 'd'], cells: [[], [], [], []] } },
      { type: 'gauge' }, { type: 'gauge', gauge: { rows: [], low: 'a', high: 'b' } },
      { type: 'step_path' }, { type: 'step_path', path: { stations: [] } },
      { type: 'timeline', labels: ['Jour 1 : x'] }, { type: 'bar_chart', labels: ['x'], values: [50] }, { type: 'grid' }, { type: 'steps_diagram', labels: ['Lait', 'Pyjama', 'Histoire'], title: 'Le rituel' },
    ];
    for (const v of empty) expect(diagramFor({ title: 'Titre', labels: [], values: [], ...v } as VisualSpec, 487, THE_FIXTURE), JSON.stringify(v)).toBeNull();
  });
});

describe('never invent a number', () => {
  const guide = new Set(numbersIn(textOfGuide(demoContent)));

  it('every digit of a figure exists in the guide', () => {
    for (const width of WIDTHS) {
      for (const v of figuresOf()) {
        const d = diagramFor(v, width, THE_FIXTURE)!;
        expect(invented(d, v, guide), `${v.type} at ${width}`).toEqual([]);
      }
    }
  });

  it('prints the duration and the moment of a station as the writer gave them, and nothing in their place', () => {
    const v = figuresOf().find((f) => f.type === 'step_path')!;
    const texts = textsOf(diagramFor(v, 487, THE_FIXTURE)!.scene).map((t) => flat(t.s));
    expect(texts).toContain('Nuits 1 à 3 · 20 minutes');
    expect(texts).toContain(paliers[2]!.when);
    expect(texts.join(' ')).not.toMatch(/null|undefined|Nuits 4 à 6/); // station 2 has no moment: its neighbour's is not borrowed
  });

  it('the check bites: a figure with a figure the guide does not hold is caught', () => {
    const v: VisualSpec = { type: 'before_after', title: 'Avant, après', labels: [], values: [], pairs: [{ before: 'Trois réveils', after: 'Résultat garanti à 97 %' }] };
    expect(guide.has('97')).toBe(false);
    expect(invented(diagramFor(v, 487, THE_FIXTURE)!, v, guide)).toEqual(['97']);
  });

  it('a plan that has no calendar prints no axis: « 1 2 3 4 5 6 » over a plan of 3 days counts nothing', () => {
    const tracks = [{ from: 1, to: 1, label: 'Le premier temps' }, { from: 2, to: 2, label: 'Le deuxième temps' }, { from: 3, to: 3, label: 'Le dernier temps' }];
    const words = (unit: string) => textsOf(diagramFor({ type: 'plan_path', title: 'Votre plan', labels: [], values: [], plan: { days: 3, unit, tracks } }, 487, THE_FIXTURE)!.scene).map((t) => t.s);
    expect(words('Jour')).toEqual(expect.arrayContaining(['JOUR', '1', '2', '3']));
    expect(words('').filter((s) => /^\d+$/.test(s))).toEqual([]);
    expect(words('')).toEqual(expect.arrayContaining(['Le premier temps', 'Le dernier temps']));
  });

  it('a gauge is blank: its only figures are the eleven marks of each ruler, and nothing is filled in', () => {
    const v = figuresOf().find((f) => f.type === 'gauge')!;
    const d = diagramFor(v, 487, THE_FIXTURE)!;
    const digits = textsOf(d.scene).filter((t) => /^\d+$/.test(t.s));
    expect(digits).toHaveLength(11 * v.gauge!.rows.length);
    expect(digits.slice(0, 11).map((t) => t.s)).toEqual(Array.from({ length: 11 }, (_, k) => String(k)));
    expect(new Set(digits.map((t) => t.fill)).size).toBe(1); // no mark stands out from the others
    expect(barsOf(d.scene)).toEqual([]);
    expect(d.scene.ops.filter((o) => o.k === 'path' && o.fill)).toEqual([]);
  });
});

describe('a cycle', () => {
  const cycleOf = (count: number, breakAt = 1): VisualSpec => ({
    type: 'cycle', title: 'La boucle à casser', labels: [], values: [],
    cycle: { nodes: ['Il sort, renifle et rentre', 'La vessie est encore pleine', 'L’accident arrive à la maison', 'L’odeur reste et l’attire au même endroit', 'Il recommence le lendemain matin', 'La fatigue fait le reste', 'Personne n’a choisi ce cercle', 'Il se renforce à chaque passage'].slice(0, count), breakAt, center: 'Le maillon à casser' },
  });

  it('has one closed ring: one arc per link, the last one back to the first node', () => {
    for (const width of WIDTHS) {
      for (let count = 3; count <= 8; count++) {
        const d = diagramFor(cycleOf(count), width, THE_FIXTURE)!;
        const { cx, cy, R, nodes, arcs } = ringOf(d.scene);
        expect(nodes, `${count} nodes`).toHaveLength(count);
        expect(arcs, `${count} nodes`).toHaveLength(count);
        arcs.forEach((arc, i) => {
          for (const p of [arc.from, arc.to]) expect(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - R), `arc ${i} is on the ring`).toBeLessThan(0.05);
          const nearest = (p: [number, number]) => nodes.map((q, k) => ({ k, gap: Math.hypot(q[0] - p[0], q[1] - p[1]) })).sort((a, b) => a.gap - b.gap)[0]!.k;
          expect(nearest(arc.from), `arc ${i} leaves its node`).toBe(i);
          expect(nearest(arc.to), `arc ${i} reaches the next node`).toBe((i + 1) % count);
        });
      }
    }
  });

  it('marks the broken link as the writer set it, and wraps a wrong index onto the ring', () => {
    expect(ringOf(diagramFor(cycleOf(4, 2), 487, THE_FIXTURE)!.scene).arcs.map((a) => a.broken)).toEqual([false, false, true, false]);
    expect(ringOf(diagramFor(cycleOf(4, 9), 487, THE_FIXTURE)!.scene).arcs.map((a) => a.broken)).toEqual([false, true, false, false]);
    expect(ringOf(diagramFor(cycleOf(4, -1), 487, THE_FIXTURE)!.scene).arcs.map((a) => a.broken)).toEqual([false, false, false, true]);
    expect(ringOf(diagramFor({ ...cycleOf(4), cycle: { ...cycleOf(4).cycle!, breakAt: Number.NaN } }, 487, THE_FIXTURE)!.scene).arcs.map((a) => a.broken)).toEqual([false, true, false, false]);
    const links = diagramFor(cycleOf(4, 2), 487, THE_FIXTURE)!.scene.ops.flatMap((o) => (o.k === 'path' && /A/.test(o.d) ? [o.stroke] : []));
    expect(links, 'the broken link is the only one in b').toEqual([THE_FIXTURE.inks.ink, THE_FIXTURE.inks.ink, THE_FIXTURE.inks.b, THE_FIXTURE.inks.ink]);
  });

  it('gives way before a label lands on the next one: eight long labels hold at both measures', () => {
    const long = 'Une boucle qui revient, se renforce et finit par tourner toute seule sans que personne l’ait décidé';
    const v: VisualSpec = { ...cycleOf(8), cycle: { nodes: Array.from({ length: 8 }, () => long), breakAt: 1, center: 'Le maillon' } };
    for (const width of WIDTHS) expectClean(diagramFor(v, width, THE_FIXTURE)!, v, width, `eight long labels at ${width}`);
  });

  it('refuses a ring it could not keep readable: the caller falls back on the labels', () => {
    const v = cycleOf(8);
    expect(diagramFor({ ...v, cycle: { ...v.cycle!, nodes: [...v.cycle!.nodes, 'Un neuvième maillon'] } }, 487, THE_FIXTURE)).toBeNull();
  });

  it('keeps every label outside the ring, on the side of its node, and the centre inside', () => {
    for (const width of WIDTHS) {
      for (let count = 3; count <= 8; count++) {
        const v = cycleOf(count);
        const d = diagramFor(v, width, THE_FIXTURE)!;
        expectClean(d, v, width, `${count} nodes at ${width}`);
        const { cx, cy, R, nodes } = ringOf(d.scene);
        const texts = textsOf(d.scene);
        let next = texts.findIndex((t) => t.font === THE_FIXTURE.voice.textB); // labels are set in node order, each one's lines together
        v.cycle!.nodes.forEach((label, i) => {
          const dx = nodes[i]![0] - cx;
          const lines: TextOp[] = [];
          while (flat(lines.map((t) => t.s).join(' ')) !== flat(label)) lines.push(texts[next++]!);
          for (const t of lines) {
            const b = boxOf(t);
            expect(distanceTo(cx, cy, b), `« ${t.s} » outside the ring`).toBeGreaterThan(R + 4);
            for (const [x, y] of nodes) expect(distanceTo(x, y, b), `« ${t.s} » clear of the discs`).toBeGreaterThan(15);
            if (Math.abs(dx) / R > 0.15) expect(Math.sign((b.x0 + b.x1) / 2 - cx), `« ${t.s} » on its node's side`).toBe(Math.sign(dx));
          }
        });
        const centre = texts.filter((t) => flat(v.cycle!.center).includes(flat(t.s)) && t.font === THE_FIXTURE.voice.displayIt);
        expect(centre.length).toBeGreaterThan(0);
        for (const t of centre) {
          const b = boxOf(t);
          for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]] as const) expect(Math.hypot(x - cx, y - cy), `« ${t.s} » inside`).toBeLessThan(R - 15);
        }
      }
    }
  });

  it('stands on a tint of c at 0.22, the only opacity of a figure', () => {
    const ops = diagramFor(cycleOf(4), 487, THE_FIXTURE)!.scene.ops;
    const tinted = ops.filter((o) => o.k === 'path' && o.op !== undefined);
    expect(tinted).toHaveLength(1);
    expect(tinted[0]).toMatchObject({ fill: THE_FIXTURE.inks.c, op: 0.22 });
    expect(tinted[0], 'behind the drawing').toBe(ops.find((o) => o.k === 'path'));
  });
});

describe('a decision tree', () => {
  it('is a ladder: one stem, one rung per case, nothing crosses', () => {
    const v = figuresOf().find((f) => f.type === 'decision_tree')!;
    for (const width of WIDTHS) {
      const d = diagramFor(v, width, THE_FIXTURE)!;
      const strokes = strokesOf(d.scene);
      const stem = strokes.filter((k) => k.x0 === k.x1);
      expect(stem, 'one vertical line in the whole figure').toHaveLength(1);
      const rungs = strokes.filter((k) => k.y0 === k.y1 && k.x0 === stem[0]!.x0);
      expect(rungs).toHaveLength(v.tree!.cases.length);
      const ys = rungs.map((r) => r.y0);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
      expect(new Set(ys).size).toBe(ys.length);
      expect(stem[0]!.y1, 'the stem stops on the last rung').toBeCloseTo(ys.at(-1)!, 1);
      expect(stem[0]!.y0, 'the stem hangs from the question').toBeLessThan(ys[0]!);
      const horizontal = strokes.filter((k) => k.y0 === k.y1);
      for (const k of horizontal) expect(k.x1 > stem[0]!.x0 && k.x0 < stem[0]!.x0, 'a line through the stem').toBe(false);
    }
  });
});

describe('a plan', () => {
  const planOf = (days: number, unit: string): VisualSpec => ({ type: 'plan_path', title: `Le plan de ${days} ${unit}`, labels: [], values: [], plan: { days, unit, tracks: [{ from: 1, to: days, label: 'Tout du long' }, { from: 3, to: Math.min(days, 5), label: 'Un palier court' }, { from: days, to: days, label: 'Le dernier' }] } });

  it('shows the day numbers on top, one bar per track, the bars where the days are', () => {
    const v = planOf(14, 'jour');
    for (const width of WIDTHS) {
      const d = diagramFor(v, width, THE_FIXTURE)!;
      const numbers = textsOf(d.scene).filter((t) => /^\d+$/.test(t.s));
      expect(numbers.map((t) => t.s)).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1)));
      const bars = barsOf(d.scene);
      expect(bars).toHaveLength(3);
      for (const b of bars) expect(Math.max(...numbers.map((t) => t.y)), 'numbers above every bar').toBeLessThan(b.y0);
      const cell = numbers[1]!.x - numbers[0]!.x;
      const day1 = numbers[0]!.x - cell / 2;
      v.plan!.tracks.forEach((t, k) => {
        expect(bars[k]!.x0, t.label).toBeCloseTo(day1 + (t.from - 1) * cell, 1);
        expect(bars[k]!.x1, t.label).toBeCloseTo(day1 + t.to * cell, 1);
      });
      expect(new Set(bars.map((b) => b.fill)).size, 'bars read apart').toBe(3);
    }
  });

  it('draws dashed week rules behind the bars, for days and nights only', () => {
    const d = diagramFor(planOf(21, 'nuit'), 487, THE_FIXTURE)!;
    const rules = strokesOf(d.scene).filter((k) => k.d);
    expect(rules).toHaveLength(2);
    const firstBar = barsOf(d.scene)[0]!.i;
    const lastRule = d.scene.ops.map((o, i) => (o.k === 'path' && o.dash ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastRule, 'painted first').toBeLessThan(firstBar);
    const cell = (barsOf(d.scene)[0]!.x1 - barsOf(d.scene)[0]!.x0) / 21;
    expect(rules[0]!.x0).toBeCloseTo(barsOf(d.scene)[0]!.x0 + 7 * cell, 1);
    expect(strokesOf(diagramFor(planOf(8, 'semaine'), 487, THE_FIXTURE)!.scene).filter((k) => k.d)).toEqual([]);
  });

  it('thins its axis on a long plan, so that no number touches the next', () => {
    for (const days of [30, 60, 90, 365]) {
      const v = planOf(days, 'jour');
      for (const width of WIDTHS) {
        const d = diagramFor(v, width, THE_FIXTURE)!;
        expectClean(d, v, width, `${days} days at ${width}`);
        const numbers = textsOf(d.scene).filter((t) => /^\d+$/.test(t.s));
        expect(numbers.length, `${days} days at ${width}`).toBeGreaterThan(2);
        expect(numbers[0]!.s).toBe('1');
      }
    }
    const weeks = textsOf(diagramFor(planOf(60, 'jour'), 487, THE_FIXTURE)!.scene).filter((t) => /^\d+$/.test(t.s)).map((t) => t.s);
    expect(weeks.slice(0, 4), 'a daily plan counts in weeks, on its rules').toEqual(['1', '7', '14', '21']);
  });

  it('keeps bars inside the plan when a track runs past its ends', () => {
    const v: VisualSpec = { ...planOf(14, 'jour'), plan: { days: 14, unit: 'jour', tracks: [{ from: -3, to: 40, label: 'Trop long' }, { from: 9, to: 2, label: 'À l’envers' }] } };
    const bars = barsOf(diagramFor(v, 487, THE_FIXTURE)!.scene);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.x1).toBeLessThanOrEqual(487.01);
    expect(bars[1]!.x1).toBeGreaterThan(bars[1]!.x0);
  });

  it('drops a track with no start rather than print NaN', () => {
    const v: VisualSpec = { ...planOf(14, 'jour'), plan: { days: 14, unit: 'jour', tracks: [{ from: Number.NaN, to: 3, label: 'Sans début' }, { from: 1, to: 3, label: 'Tenu' }] } };
    expect(barsOf(diagramFor(v, 487, THE_FIXTURE)!.scene)).toHaveLength(1);
    expect(toSvg(diagramFor(v, 487, THE_FIXTURE)!.scene)).not.toContain('NaN');
  });
});

describe('a step path', () => {
  it('links its stations and no more: one link fewer than stations, none for a lone station', () => {
    const v = figuresOf().find((f) => f.type === 'step_path')!;
    expect(strokesOf(diagramFor(v, 487, THE_FIXTURE)!.scene)).toHaveLength(v.path!.stations.length - 1);
    const one: VisualSpec = { ...v, path: { stations: [v.path!.stations[0]!] } };
    expect(strokesOf(diagramFor(one, 487, THE_FIXTURE)!.scene)).toEqual([]);
  });
});

describe('an old save', () => {
  const save = JSON.parse(gunzipSync(readFileSync(OLD_SAVE)).toString('utf8')) as WorldState;
  const loops = save.company.products.flatMap((p) => p.content?.chapters ?? []).flatMap((c) => (c.visual ? [c.visual] : [])).filter((v) => /boucle/i.test(v.title));

  it('holds real loops drawn as a row of boxes', () => {
    expect(loops.length).toBeGreaterThan(0);
    for (const v of loops) expect(v.type).toBe('steps_diagram');
  });

  it('a `steps_diagram` titled « boucle » still renders, and comes back as a ring', () => {
    for (const v of loops) {
      for (const width of WIDTHS) {
        const d = diagramFor(v, width, THE_FIXTURE);
        expect(d, v.title).not.toBeNull();
        const { nodes, arcs } = ringOf(d!.scene);
        expect(nodes).toHaveLength(v.labels.length);
        expect(arcs).toHaveLength(v.labels.length);
        expectClean(d!, { ...v, type: 'cycle', cycle: { nodes: v.labels, breakAt: 1, center: '' } }, width, v.title);
        expect(textsOf(d!.scene).filter((t) => t.font === THE_FIXTURE.voice.displayIt), 'no centre was written').toEqual([]);
      }
    }
  });

  it('prints only what the old guide already says', () => {
    for (const p of save.company.products) {
      if (!p.content) continue;
      const guide = new Set(numbersIn(textOfGuide(p.content)));
      for (const c of p.content.chapters) {
        if (!c.visual || !/boucle/i.test(c.visual.title)) continue;
        const ring: VisualSpec = { ...c.visual, type: 'cycle', cycle: { nodes: c.visual.labels, breakAt: 1, center: '' } };
        expect(invented(diagramFor(c.visual, 487, THE_FIXTURE)!, ring, guide)).toEqual([]);
      }
    }
  });
});
