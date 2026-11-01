/**
 * Every page of a guide as a `Scene`: one drawing, two back-ends, so that a preview is the real page. Plans first, so the
 * contents and the promise know page numbers before anything is drawn. The talent of the designer shows here as how far
 * the pages are finished (pdf §13).
 */
import type { PdfAudit } from '../../contracts.js';
import type { ChapterContent, DesignEffort, DesignSpec } from '../../shared.js';
import { field, type HeroPlace } from '../art/field.js';
import { closesOf, poseGround, posesOf, type Pose } from '../art/poses.js';
import { readableOn } from '../color.js';
import { advance, fitDisplay, sanitizeFor, type FaceName } from '../fonts.js';
import { arr, calloutBlocks, chapterBlocks, CHECK_INDENT, CHECK_LINE, DROP_SIZE, lineOf, NOTE_TEXT, paraBlock, QUOTE_TEXT, quoteBlock, SHEET_BAND, sheetTop, STEP_BOX, STEP_GAP, STEP_INDENT, type Block, type ChecklistBlock, type ExampleBlock, type HeadingBlock, type NoteBlock, type ParaBlock, type QuoteBlock, type SheetBlock, type StepsBlock } from '../layout/blocks.js';
import { BODY_BOTTOM, GRID, RAIL_X, SHORT_PAGE, tabHeight } from '../layout/grid.js';
import { layoutOf, type PagePlan } from '../layout/paginate.js';
import { linesOf, setLines, tickBox, type PdfTheme } from '../pdfVisuals.js';
import { n, Scene, toSvg } from '../scene.js';
import { hashString, wholeClause } from '../text.js';

const { W, H, left: L, full: FULL } = GRID;
const U = W / 6;               // the tile of the art, on every page but the cover
const RUN_INK = 0.7;           // opacity of the running head
const NOTE_LINE = 21.6;
const TOP_BAND = 2 * U;        // introduction and last page
const WORDS_PER_MIN = 220;
const LEADER = { dot: 1, gap: 3 };

export interface ChapterSpec { content: ChapterContent; title: string; head: string; example: { label: string; text: string } | null }

/** Everything `pdf.ts` decided about the wording. No page reads the product itself. */
export interface GuideSpec {
  design: DesignSpec;
  cover: Scene;
  audience: string; promise: string; brand: string;
  howTo: readonly (readonly [string, string])[];
  intro: { paragraphs: string[]; quote: string | null; box: string | null };
  chapters: ChapterSpec[];
  bonus: ChapterSpec | null;
  final: {
    heading: string; subtitle: string; paragraphs: string[];
    cta: { label: string; dest: string | null; url: string | null; under: string } | null;
    thanks: string; disclaimer: string;
  };
}

interface Link { x: number; y: number; w: number; h: number; dest?: string; url?: string }

export interface GuidePage { scene: Scene; scale: number; links: Link[]; dest: string | null; outline: string | null; preview: string | null }

export interface Guide { pages: GuidePage[]; plans: PagePlan[]; audit: Omit<PdfAudit, 'bytes' | 'degraded'> }

interface Section { dest: string; label: string; title: string; head: string; tab: string | null }

interface Slot { plan: PagePlan; section: Section; first: boolean; draw: (c: Ctx, no: number) => Scene }

interface Entry { number: string | null; label: string; title: string; page: number; dest: string }

interface Ctx {
  t: PdfTheme; spec: GuideSpec; seed: number; tabs: number;
  entries: Entry[]; pagesTotal: number; sheetsTotal: number; overflow: number; links: Link[];
}

const pad2 = (k: number) => String(k).padStart(2, '0');
const plural = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;

/** A text op that has no wrap to keep it in its box: counted by the audit when it leaves it. */
function boxed(c: Ctx, text: string, face: FaceName, size: number, width: number, track = 0): string {
  if (advance(face, text, size, track) > width + 0.5) c.overflow += 1;
  return text;
}

/** A page laid out by hand has no `paginate` to stop it: going past the foot is counted the same way. */
function past(c: Ctx, y: number): void {
  if (y > BODY_BOTTOM + 1) c.overflow += 1;
}

function pageOf(paper: string): Scene {
  return new Scene(W, H).rect(0, 0, W, H, paper);
}

function art(c: Ctx, s: Scene, rows: number, seed: number, hero: HeroPlace | null): void {
  field(s, { x: 0, y: 0, u: U, cols: 6, rows, inks: c.t.inks, motif: c.spec.design.motif, seed, hero });
}

/** The last thing drawn on a page: a text extraction reads the body first, this line after it. */
function folio(c: Ctx, s: Scene, no: number): void {
  const { v, inks } = c.t;
  s.text(sanitizeFor(v.labelB, c.spec.brand).toUpperCase(), L, GRID.folio, v.labelB, 6.8, inks.ink, { track: 1.4 });
  s.text(String(no), L + FULL, GRID.folio, v.deck, 10, inks.ink, { anchor: 'end' });
}

function runningHead(c: Ctx, s: Scene, section: Section): void {
  const { v, inks } = c.t;
  const head = wholeClause(sanitizeFor(v.label, section.head), (x) => advance(v.label, x, 7.6) <= FULL - 20);
  s.text(head, L, GRID.head, v.label, 7.6, inks.ink, { op: RUN_INK });
}

function sectionTab(c: Ctx, s: Scene, section: Section, index: number): void {
  if (section.tab === null) return;
  const { v, inks } = c.t;
  const h = tabHeight(c.tabs);
  const y = 110 + index * h;
  s.rect(W - 16, y, 16, h - 3, inks.a);
  s.text(section.tab, W - 8, y + (h - 3) / 2 + 3.2, v.labelB, 9, readableOn(inks.a, inks.ink, inks.paper), { anchor: 'middle' });
}

// ───────────────────────────── text pages ─────────────────────────────

function drawPara(c: Ctx, s: Scene, b: ParaBlock, from: number, to: number, y: number): void {
  const { v, inks } = c.t;
  const lead = b.style === 'lead';
  const face = lead || b.italic ? v.textIt : v.text;
  const size = lead ? 12.2 : v.body;
  const lh = lineOf(b);
  const base = y + (lead ? 13 : 10.8);
  if (b.drop && from === 0) s.text(b.drop, L - 1, base + 2 * lh, v.display, DROP_SIZE, c.t.aText);
  for (let k = from; k < to; k++) {
    const ly = base + (k - from) * lh;
    let x = L;
    if (b.drop && k < b.dropLines!) x += b.dropW!;
    if (b.head && k === 0) {
      s.text(b.head, x, ly, v.textB, size, inks.ink);
      x += b.headW!;
    }
    s.text(b.lines[k]!, x, ly, face, size, inks.ink);
  }
}

function drawHeading(c: Ctx, s: Scene, b: HeadingBlock, y: number): void {
  const { v, inks } = c.t;
  s.line(L, y, L + FULL, y, inks.ink, 0.9);
  s.text(sanitizeFor(v.labelB, b.text).toUpperCase(), L, y + 18, v.labelB, 8, inks.ink, { track: 1.6 });
}

function drawSteps(c: Ctx, s: Scene, b: StepsBlock, from: number, to: number, y: number, air: number): void {
  const { v, inks } = c.t;
  let cy = y;
  for (let k = from; k < to; k++) {
    const item = b.items[k]!;
    const top = cy + air / 2 + STEP_GAP;
    s.text(String(k + 1), L, top + 22, v.display, 30, c.t.bText);
    item.lines.forEach((l, i) => s.text(l, L + STEP_INDENT, top + 12 + i * GRID.baseline, v.textB, v.body, inks.ink));
    if (b.ticks) tickBox(s, L + FULL - STEP_BOX, top + 1, STEP_BOX, inks.ink);
    cy += item.h + air;
    if (k < b.items.length - 1) s.line(L + STEP_INDENT, cy, L + FULL, cy, inks.ink, 0.3);
  }
}

function drawExample(c: Ctx, s: Scene, b: ExampleBlock, y: number): void {
  const { v, inks } = c.t;
  s.line(L + 1, y + 2, L + 1, y + b.h - 10, inks.b, 2.4);
  if (b.titled) s.text(sanitizeFor(v.textB, b.label), L + 14, y + 12, v.textB, v.body + 0.4, inks.ink);
  else s.text(sanitizeFor(v.labelB, b.label).toUpperCase(), L + 14, y + 11, v.labelB, 7.8, c.t.bText, { track: 1.4 });
  b.lines.forEach((l, k) => s.text(l, L + 14, y + 14.4 + 10.8 + k * GRID.baseline, v.textIt, v.body, inks.ink));
}

function drawChecklist(c: Ctx, s: Scene, b: ChecklistBlock, from: number, to: number, y: number, air: number): void {
  const { v, inks } = c.t;
  const colW = (FULL - GRID.gutter) / 2;
  let cy = y;
  for (let k = from; k < to; k++) {
    const row = b.rows[k]!;
    if (!row.cells.length && b.heads) b.heads.forEach((head, i) => s.text(head.toUpperCase(), L + i * (colW + GRID.gutter), cy + 10, v.labelB, 7.8, c.t.aText, { track: 1.4 }));
    row.cells.forEach((lines, i) => {
      if (!lines.length) return;
      const x = L + i * (colW + GRID.gutter);
      tickBox(s, x, cy + 2.8, 9, inks.ink);
      lines.forEach((l, j) => s.text(l, x + CHECK_INDENT, cy + 10.5 + j * CHECK_LINE, v.text, v.body, inks.ink));
    });
    cy += row.h + air;
  }
}

function drawRail(c: Ctx, s: Scene, b: NoteBlock | QuoteBlock, y: number): void {
  const { v, inks } = c.t;
  if (b.t === 'note') {
    s.text('À RETENIR', RAIL_X, y + 8, v.labelB, 7.5, c.t.bText, { track: 1.4 });
    b.lines.forEach((l, k) => s.text(l, RAIL_X, y + 14.4 + 9.2 + k * NOTE_TEXT.leading, v.textIt, NOTE_TEXT.size, inks.ink));
    return;
  }
  s.line(RAIL_X, y + 2, RAIL_X + 26, y + 2, inks.b, 2.4);
  b.lines.forEach((l, k) => s.text(l, RAIL_X, y + 18 + 12 + k * QUOTE_TEXT.leading, v.displayIt, QUOTE_TEXT.size, c.t.aText));
}

/** Ruled lines to write on, the last one on the foot of the page. On a sheet they sit on its tint and take a darker ink. */
export function drawNotes(t: PdfTheme, s: Scene, y: number, h: number, label = 'Vos notes', rule = t.hair): void {
  const { v } = t;
  s.text(sanitizeFor(v.labelB, label).toUpperCase(), L, y + 8, v.labelB, 7.8, t.muted, { track: 1.4 });
  const bottom = y + h;
  for (let ly = bottom; ly >= y + 8 + NOTE_LINE - 0.01; ly -= NOTE_LINE) s.line(L, ly, L + FULL, ly, rule, 0.4);
}

/** How a section closes: the seed of its tiles, the pose of its hero and a number that tells two of them apart. */
interface Close { seed: number; pose: Pose; pick: number }

/** The art of the guide at the width of the text: a band of tiles, a seed of its own to each section, and from two rows up a hero in its own pose, on the side the seed says. */
function drawEnd(c: Ctx, s: Scene, y: number, rows: number, cols: number, { seed, pose, pick }: Close): void {
  const size = Math.min(rows, Math.round((cols * (rows > 4 ? 2 : 1.5)) / 3));
  const ground = poseGround(pose, pick, seed);
  const hero: HeroPlace | null = rows >= 2 ? { c: seed % 2 ? cols - size : 0, r: rows - size, s: size, pose, pick, ...(ground ? { ground } : {}) } : null;
  field(s, { x: L, y, u: FULL / cols, cols, rows, inks: c.t.inks, motif: c.spec.design.motif, seed, hero });
}

function drawItems(c: Ctx, s: Scene, plan: PagePlan, close: Close): void {
  for (const item of plan.items) {
    if (item.t === 'para') drawPara(c, s, item.block, item.from, item.to, item.y);
    else if (item.t === 'rows') {
      if (item.block.t === 'steps') drawSteps(c, s, item.block, item.from, item.to, item.y, item.air ?? 0);
      else drawChecklist(c, s, item.block, item.from, item.to, item.y, item.air ?? 0);
    } else if (item.t === 'rail') drawRail(c, s, item.block, item.y);
    else if (item.t === 'notes') drawNotes(c.t, s, item.y, item.h, item.label);
    else if (item.t === 'end') drawEnd(c, s, item.y, item.rows, item.cols, close);
    else if (item.t === 'block') {
      if (item.block.t === 'h2') drawHeading(c, s, item.block, item.y);
      else if (item.block.t === 'example') drawExample(c, s, item.block, item.y);
      else item.block.draw(s, L, item.y + 7.2);
    }
  }
}

function textPage(section: Section, index: number, plan: PagePlan, pose: Pose, top: ((c: Ctx, s: Scene) => void) | null) {
  return (c: Ctx, no: number): Scene => {
    const s = pageOf(c.t.page);
    if (top) top(c, s);
    else runningHead(c, s, section);
    sectionTab(c, s, section, index);
    drawItems(c, s, plan, { seed: c.seed + hashString(section.dest) % 9973, pose, pick: index });
    folio(c, s, no);
    return s;
  };
}

// ───────────────────────────── chapter openers ─────────────────────────────

function wordsOf(ch: ChapterContent): number {
  const text = [ch.intro, ...arr(ch.paragraphs), ...arr(ch.steps), ch.example ?? '', ...arr(ch.checklist)].join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

interface OpenerText { rows: number; title: { size: number; lines: string[] }; ruleAt: number; lead: string[] | null; tease: string[][]; stats: string }

const TITLE_X = 246;
const TEASE_SIZE = 10;
const TEASE_LINE = 13;

/** The lead stays on the opener when it fits under the title and its teaser; a long one opens the text instead. */
function openerText(ch: ChapterSpec, t: PdfTheme, finish: 0 | 1 | 2): OpenerText {
  const { v } = t;
  const rows = finish === 0 ? 3 : 4;
  const band = rows * U;
  const title = fitDisplay(sanitizeFor(v.deck, ch.title), v.deck, { width: W - TITLE_X - GRID.right, max: 29, min: 20, maxLines: 4, leading: 1.1 });
  const ruleAt = band + Math.max(166, 56 + title.lines.length * title.size * 1.1 + 22);
  const content = ch.content;
  const steps = arr(content.steps);
  const tease = finish >= 1 ? steps.slice(0, 3).map((st) => {
    const clause = wholeClause(sanitizeFor(v.text, st).replace(/^\s*\d+\s*[.)]\s*/, ''), (x) => linesOf(x, v.text, TEASE_SIZE, FULL - 24).length <= 2);
    return linesOf(clause, v.text, TEASE_SIZE, FULL - 24);
  }) : [];
  const teaseH = tease.length ? 26 + tease.reduce((a, l) => a + 10 + l.length * TEASE_LINE, 0) : 0;
  const lead = linesOf(content.intro ?? '', v.textIt, 12.2, FULL);
  const fits = ruleAt + 26 + lead.length * 17.4 + 18 + teaseH <= BODY_BOTTOM;
  const sheets = [content.visual, content.figure].filter((x) => x?.type === 'grid').length;
  const stats = [`${Math.max(3, Math.round(wordsOf(content) / WORDS_PER_MIN))} min de lecture`, ...(steps.length ? [plural(steps.length, 'action', 'actions')] : []), ...(sheets ? [plural(sheets, 'fiche à remplir', 'fiches à remplir')] : [])].join(' · ');
  return { rows, title, ruleAt, lead: fits ? lead : null, tease, stats };
}

function openerPage(o: OpenerText, number: number, total: number, bonus: boolean, pose: Pose) {
  return (c: Ctx, no: number): Scene => {
    const { v, inks, aText } = c.t;
    const s = pageOf(inks.paper);
    const big = number % 2 === 1;
    // the drawing itself is the picture of the cover: an opener shows it smaller, on the side the cover does not use
    const size = o.rows === 3 || pose === 'portrait' ? 3 : big ? 4 : 3;
    const col = pose === 'portrait' ? 0 : o.rows === 3 ? (big ? 3 : 0) : big ? (number % 4 === 1 ? 2 : 0) : (number % 4 === 2 ? 0 : 3);
    const ground = bonus ? 'b' : poseGround(pose, number, c.seed);
    const hero: HeroPlace = { c: col, r: o.rows - size, s: size, pose, pick: number, ...(ground ? { ground } : {}) };
    art(c, s, o.rows, c.seed + number * 7, hero);
    const band = o.rows * U;
    s.text(bonus ? '+' : pad2(number), L - 4, band + 128, v.display, 128, aText);
    const kicker = bonus ? 'CADEAU' : `CHAPITRE ${number} SUR ${total}`;
    s.text(kicker, TITLE_X, band + 44, v.labelB, 8.6, inks.ink, { track: 1.8 });
    let y = band + 56 + o.title.size;
    for (const line of o.title.lines) {
      s.text(boxed(c, line, v.deck, o.title.size, W - TITLE_X - GRID.right), TITLE_X, y, v.deck, o.title.size, inks.ink);
      y += o.title.size * 1.1;
    }
    s.line(L, o.ruleAt, L + FULL, o.ruleAt, inks.ink, 0.7);
    y = o.ruleAt + 26;
    for (const line of o.lead ?? []) {
      s.text(line, L, y, v.textIt, 12.2, inks.ink);
      y += 17.4;
    }
    y += 18;
    if (o.tease.length) {
      s.text('DANS CE CHAPITRE', L, y, v.labelB, 7.8, inks.ink, { track: 1.6 });
      s.text(o.stats, L + FULL, y, v.label, 8.8, inks.ink, { anchor: 'end' });
      y += 8;
      o.tease.forEach((lines, k) => {
        s.line(L, y, L + FULL, y, inks.ink, 0.3);
        s.text(String(k + 1), L, y + 16, v.deck, 11, aText);
        lines.forEach((l, i) => s.text(l, L + 24, y + 16 + i * TEASE_LINE, v.text, TEASE_SIZE, inks.ink));
        y += 10 + lines.length * TEASE_LINE;
      });
    }
    past(c, y);
    folio(c, s, no);
    return s;
  };
}

// ───────────────────────────── sheets ─────────────────────────────

function sheetPage(b: SheetBlock, part: number, order: number) {
  return (c: Ctx, no: number): Scene => {
    const { v, inks } = c.t;
    const s = pageOf(inks.paper);
    const band = SHEET_BAND.top + Math.max(1, b.title.length) * SHEET_BAND.line;
    s.rect(0, 0, W, band, inks.ink);
    s.text('À IMPRIMER', L, 30, v.labelB, 8.5, inks.paper, { track: 2 });
    s.text(`Fiche ${order} sur ${c.sheetsTotal}`, L + FULL, 30, v.label, 9, inks.paper, { anchor: 'end' });
    b.title.forEach((l, k) => s.text(l, L, 54 + k * SHEET_BAND.line, v.deck, SHEET_BAND.size, inks.paper));
    if (b.model.note) s.text(b.model.note, L, band + 19, v.textIt, 9.4, inks.ink);
    const { from, to, grow } = b.parts[part]!;
    b.model.draw(s, L, sheetTop(b.title.length), from, to, grow);
    const notes = b.parts[part]!.notes;
    if (notes) drawNotes(c.t, s, notes.y, notes.h, notes.label, c.t.muted);
    folio(c, s, no);
    return s;
  };
}

// ───────────────────────────── front and back matter ─────────────────────────────

function pageTitle(c: Ctx, s: Scene, kicker: string, title: string, y: number): number {
  const { v, inks } = c.t;
  s.text(kicker, L, y, v.labelB, 8.6, c.t.bText, { track: 1.8 });
  const fit = fitDisplay(title, v.deck, { width: FULL, max: 29, min: 20, maxLines: 2, leading: 1.1 });
  let cy = y + 12;
  for (const line of fit.lines) {
    cy += fit.size;
    s.text(boxed(c, line, v.deck, fit.size, FULL), L, cy, v.deck, fit.size, inks.ink);
    cy += fit.size * 0.1;
  }
  return cy;
}

function promisePage(counts: { chapters: number; actions: number; sheets: number }) {
  return (c: Ctx, no: number): Scene => {
    const { v, inks, aText } = c.t;
    const { promise, audience, howTo } = c.spec;
    const s = pageOf(c.t.page);
    const hw = (FULL - 2 * GRID.gutter) / 3;
    const says = linesOf(promise, v.displayIt, 20, FULL);
    const who = linesOf(audience, v.text, v.body + 1.4, FULL);
    const texts = howTo.map(([head, text]) => ({ head: linesOf(head, v.textB, v.body, hw), text: linesOf(text, v.text, v.body - 0.6, hw) }));
    const howH = 40 + Math.max(...texts.map((h) => h.head.length * GRID.baseline + h.text.length * 13.2));
    let y = pageTitle(c, s, 'AVANT DE COMMENCER', 'Ce que vous allez obtenir', GRID.top);
    // the blocks spread down the page: a page that says little says it with air, not with a void at the foot
    const gap = Math.max(32.4, Math.min(86.4, (BODY_BOTTOM - y - says.length * 26 - 82 - (who.length ? who.length * 16.2 + 4 : 0) - howH - 10.8) / 4));
    y += gap;
    y += setLines(s, says, L, y - 20, { face: v.displayIt, size: 20, leading: 26, fill: aText }) + gap;
    const figures: [number, string][] = [
      [counts.chapters, counts.chapters > 1 ? 'chapitres' : 'chapitre'],
      [counts.actions, counts.actions > 1 ? 'actions guidées' : 'action guidée'],
      [counts.sheets, counts.sheets > 1 ? 'fiches à remplir' : 'fiche à remplir'],
      [c.pagesTotal, 'pages'],
    ];
    const cell = FULL / figures.length;
    s.line(L, y, L + FULL, y, inks.ink, 0.9);
    figures.forEach(([big, small], k) => {
      s.text(String(big), L + k * cell, y + 46, v.deck, 36, aText);
      s.text(small, L + k * cell, y + 64, v.label, 8.8, inks.ink);
    });
    y += 82;
    s.line(L, y, L + FULL, y, inks.ink, 0.9);
    y += gap;
    if (who.length) {
      s.text('POUR QUI', L, y, v.labelB, 7.8, c.t.bText, { track: 1.6 });
      y += 4;
      y += setLines(s, who, L, y, { face: v.text, size: v.body + 1.4, leading: 16.2, fill: inks.ink }) + gap;
    }
    s.text('COMMENT UTILISER CE GUIDE', L, y, v.labelB, 7.8, c.t.bText, { track: 1.6 });
    y += 10.8;
    texts.forEach((how, k) => {
      const x = L + k * (hw + GRID.gutter);
      s.line(x, y, x + hw, y, inks.ink, 0.5);
      s.text(String(k + 1), x, y + 26, v.display, 22, c.t.bText);
      const h = setLines(s, how.head, x, y + 32, { face: v.textB, size: v.body, leading: GRID.baseline, fill: inks.ink });
      setLines(s, how.text, x, y + 36 + h, { face: v.text, size: v.body - 0.6, leading: 13.2, fill: inks.ink });
    });
    past(c, y + howH);
    folio(c, s, no);
    return s;
  };
}

function contentsPage(c: Ctx, no: number): Scene {
  const { v, inks, aText } = c.t;
  const s = pageOf(c.t.page);
  let y = pageTitle(c, s, 'SOMMAIRE', 'Au programme', GRID.top) + 39.6;
  const titleW = FULL - 96;
  const rowsAt = (size: number) => c.entries.map((e) => linesOf(e.title, v.deck, size, titleW));
  let size = 13;
  const heightAt = (sz: number) => rowsAt(sz).reduce((a, l) => a + l.length * (sz + 3.6) + 21.6, 0);
  while (size > 9 && y + heightAt(size) > BODY_BOTTOM) size -= 0.5;
  const air = Math.max(0, Math.min(16.2, (BODY_BOTTOM - y - heightAt(size)) / Math.max(1, c.entries.length)));
  rowsAt(size).forEach((lines, k) => {
    const e = c.entries[k]!;
    const h = lines.length * (size + 3.6) + 21.6 + air;
    s.text(e.number ?? '·', L, y + 22, v.display, 22, aText);
    s.text(e.label.toUpperCase(), L + 48, y + 8, v.labelB, 6.8, c.t.muted, { track: 1.2 });
    let ly = y + 12 + size;
    for (const line of lines) {
      s.text(line, L + 48, ly, v.deck, size, inks.ink);
      ly += size + 3.6;
    }
    const last = ly - size - 3.6;
    const page = String(e.page);
    const from = L + 48 + advance(v.deck, lines[lines.length - 1] ?? '', size) + 8;
    const to = L + FULL - advance(v.deck, page, size) - 8;
    if (to > from) s.line(from, last, to, last, c.t.hair, 1, { dash: [LEADER.dot, LEADER.gap] });
    s.text(page, L + FULL, last, v.deck, size, inks.ink, { anchor: 'end' });
    c.links.push({ x: L, y, w: FULL, h: h - 6, dest: e.dest });
    y += h;
  });
  past(c, y);
  folio(c, s, no);
  return s;
}

const INTRO_TOP = TOP_BAND + 92;
const MEMO_AIR = 39.6;         // the rows of a plan on one page spread down it, with room to tick and to write

function introTop(title: string) {
  return (c: Ctx, s: Scene): void => {
    const { v, inks } = c.t;
    art(c, s, 2, c.seed + 1, null);
    s.text('INTRODUCTION', L, TOP_BAND + 34, v.labelB, 8.6, c.t.bText, { track: 1.8 });
    s.text(title, L, TOP_BAND + 67, v.deck, 29, inks.ink);
  };
}

function memoPage(c: Ctx, no: number): Scene {
  const { v, inks, aText } = c.t;
  const s = pageOf(inks.paper);
  let y = pageTitle(c, s, 'À IMPRIMER', 'Votre plan sur une page', GRID.top) + 32.4;
  const rows = c.spec.chapters.filter((ch) => arr(ch.content.steps).length).map((ch) => {
    const steps = arr(ch.content.steps);
    const first = sanitizeFor(v.text, steps.find((x) => !/^\s*(?:\d+\s*[.)]\s*)?Relire\b/.test(x)) ?? steps[0]!).replace(/^\s*\d+\s*[.)]\s*/, ''); // « Relire cette liste » points at nothing here
    const fit = (x: string) => linesOf(x, v.text, v.body, FULL - 62).length <= 3;
    return { title: linesOf(ch.title, v.deck, 11.5, FULL - 62), lines: linesOf(wholeClause(first, fit), v.text, v.body, FULL - 62) };
  });
  const need = rows.reduce((a, r) => a + r.title.length * 14.4 + r.lines.length * GRID.baseline + 18, 0);
  const gap = Math.max(0, Math.min(MEMO_AIR, (BODY_BOTTOM - y - need) / Math.max(1, rows.length)));
  rows.forEach((r, k) => {
    s.line(L, y, L + FULL, y, inks.ink, 0.5);
    s.text(pad2(k + 1), L, y + 26, v.display, 22, aText);
    let cy = y + 10;
    cy += setLines(s, r.title, L + 42, cy - 1, { face: v.deck, size: 11.5, leading: 14.4, fill: inks.ink });
    cy += setLines(s, r.lines, L + 42, cy, { face: v.text, size: v.body, leading: GRID.baseline, fill: inks.ink });
    tickBox(s, L + FULL - 13, y + 10, 13, inks.ink);
    y = cy + 8 + gap;
  });
  past(c, y);
  folio(c, s, no);
  return s;
}

function finalPage(c: Ctx, no: number): Scene {
  const { v, inks, aText } = c.t;
  const { final, chapters } = c.spec;
  const s = pageOf(c.t.page);
  art(c, s, 2, c.seed + 3, null);
  let y = TOP_BAND + 34;
  s.text('ET MAINTENANT ?', L, y, v.labelB, 8.6, c.t.bText, { track: 1.8 });
  const head = fitDisplay(sanitizeFor(v.deck, final.heading), v.deck, { width: FULL, max: 32, min: 22, maxLines: 2, leading: 1.1 });
  y += 10;
  for (const line of head.lines) {
    y += head.size * 1.1;
    s.text(boxed(c, line, v.deck, head.size, FULL), L, y, v.deck, head.size, inks.ink);
  }
  y += 10.8;
  if (final.subtitle) y += setLines(s, linesOf(final.subtitle, v.textIt, 13, FULL), L, y, { face: v.textIt, size: 13, leading: 17.4, fill: aText }) + 10.8;
  for (const p of final.paragraphs) y += setLines(s, linesOf(p, v.text, v.body + 0.8, GRID.column + 60), L, y, { face: v.text, size: v.body + 0.8, leading: 15.6, fill: inks.ink }) + 7.2;
  if (final.cta) {
    y += 10.8;
    const room = FULL - 84;
    let size = 14;
    let lines = linesOf(final.cta.label, v.labelB, size, room);
    while (size > 11 && lines.length > 2) lines = linesOf(final.cta.label, v.labelB, --size, room);
    const lh = size * 1.28;
    const h = Math.max(50.4, lines.length * lh + 25.2);
    const fg = readableOn(inks.a, inks.ink, inks.paper);
    s.rect(L, y, FULL, h, inks.a);
    const top = y + (h - lines.length * lh) / 2 - 1.5;
    lines.forEach((l, k) => s.text(l, L + 21.6, top + (k + 0.82) * lh, v.labelB, size, fg));
    const mid = y + h / 2;
    s.path(`M${n(L + FULL - 40)} ${n(mid)}h14M${n(L + FULL - 31)} ${n(mid - 5)}l5 5l-5 5`, undefined, { stroke: fg, sw: 2.2, cap: 'round' });
    c.links.push({ x: L, y, w: FULL, h, ...(final.cta.dest ? { dest: final.cta.dest } : {}), ...(final.cta.url ? { url: final.cta.url } : {}) });
    y += h;
    if (final.cta.under) {
      s.text(sanitizeFor(v.label, final.cta.under), L, y + 14, v.label, 8.6, c.t.muted);
      y += 14;
    }
    y += 21.6;
  }
  const thanks = linesOf(final.thanks, v.textIt, 10, FULL);
  const disclaimer = linesOf(final.disclaimer, v.text, 8, FULL);
  const close = thanks.length * 13.5 + 10.8 + disclaimer.length * 10.8;
  const closeAt = BODY_BOTTOM - close;
  const recap = chapters.slice(0, 8).map((ch) => ch.title);
  const half = Math.ceil(recap.length / 2);
  const colW = (FULL - GRID.gutter) / 2;
  const cols = [recap.slice(0, half), recap.slice(half)].map((col) => col.map((x) => linesOf(x, v.text, 9.4, colW - 14)));
  const colH = (col: string[][]) => col.reduce((a, l) => a + l.length * 12.2 + 5.4, 0);
  if (recap.length && y + 25.2 + Math.max(...cols.map(colH)) + 14.4 <= closeAt) {
    s.line(L, y, L + FULL, y, inks.ink, 0.5);
    s.text('CE QUE VOUS AVEZ PARCOURU', L, y + 16, v.labelB, 7.8, inks.ink, { track: 1.6 });
    y += 25.2;
    cols.forEach((col, k) => {
      let cy = y;
      const x = L + k * (colW + GRID.gutter);
      for (const lines of col) {
        s.path(`M${n(x)} ${n(cy + 6)}l3 3l5 -6`, undefined, { stroke: aText, sw: 1.2, cap: 'round' });
        cy += setLines(s, lines, x + 14, cy, { face: v.text, size: 9.4, leading: 12.2, fill: inks.ink }) + 5.4;
      }
    });
  }
  let cy = Math.max(y, closeAt);
  cy += setLines(s, thanks, L, cy, { face: v.textIt, size: 10, leading: 13.5, fill: c.t.muted }) + 10.8;
  cy += setLines(s, disclaimer, L, cy, { face: v.text, size: 8, leading: 10.8, fill: c.t.muted });
  past(c, cy);
  folio(c, s, no);
  return s;
}

// ───────────────────────────── the guide ─────────────────────────────

function auditOf(slots: Slot[], chapters: number, overflow: number, pages: number): Guide['audit'] {
  const text = slots.map((s) => s.plan).filter((p) => p.kind === 'text' || p.kind === 'figure');
  const figures = text.flatMap((p) => p.items).filter((i) => i.t === 'block' && i.block.t === 'figure');
  const kinds = new Set(figures.map((i) => (i.t === 'block' && i.block.t === 'figure' ? i.block.kind : '')));
  // a rail hangs off a paragraph: a page of steps or figures has no place for one, and a second figure must not cost the rail points
  const prose = text.filter((p) => p.items.some((i) => i.t === 'para'));
  let widows = 0;
  let strandedHeadings = 0;
  for (const p of text) {
    const flow = p.items.filter((i) => i.t !== 'rail' && i.t !== 'notes' && i.t !== 'end');
    const last = flow[flow.length - 1];
    if (last?.t === 'block' && last.block.t === 'h2') strandedHeadings += 1;
    for (const i of p.items) {
      if (i.t !== 'para') continue;
      const count = i.block.lines.length;
      if ((i.from > 0 && i.to - i.from < 2) || (i.to < count && i.to - i.from < 2)) widows += 1;
    }
  }
  return {
    pages, textPages: text.length,
    shortPages: text.filter((p) => p.fill < SHORT_PAGE).length,
    fillMean: text.length ? text.reduce((a, p) => a + p.fill, 0) / text.length : 0,
    widows, strandedHeadings,
    railShare: prose.length ? prose.filter((p) => p.items.some((i) => i.t === 'rail')).length / prose.length : 0,
    figureKinds: kinds.size,
    figuresPerChapter: figures.length / Math.max(1, chapters),
    sheets: slots.filter((s) => s.plan.kind === 'sheet' && s.plan.items[0]?.t === 'sheet' && s.plan.items[0].part === 0).length,
    overflow,
  };
}

const COVER_LABEL = 'Couverture';
const PREVIEW_LABELS = { opener: 'Ouverture de chapitre', text: 'Page du guide', figure: 'Schéma', sheet: 'Fiche à imprimer', memo: 'Votre plan' } as const;

/** What the shop window shows: a page of each kind, a full one or one with its rail when there is one. */
function previewPages(slots: Slot[]): Map<Slot, string> {
  const out = new Map<Slot, string>();
  for (const kind of Object.keys(PREVIEW_LABELS) as (keyof typeof PREVIEW_LABELS)[]) {
    const pages = slots.filter((s) => s.plan.kind === kind);
    const pick = pages.find((s) => s.plan.fill > 0.8 || s.plan.items.some((i) => i.t === 'rail')) ?? pages[0];
    if (pick) out.set(pick, PREVIEW_LABELS[kind]);
  }
  return out;
}

export function layoutGuide(spec: GuideSpec, t: PdfTheme, effort: DesignEffort): Guide {
  const { design, chapters, bonus } = spec;
  const { finish } = effort;
  const slots: Slot[] = [];
  const entries: Entry[] = [];
  const seed = design.artSeed ?? design.seed;
  const c: Ctx = { t, spec, seed, tabs: chapters.length + (bonus ? 1 : 0), entries, pagesTotal: 0, sheetsTotal: 0, overflow: 0, links: [] };
  const front = (kind: PagePlan['kind'], section: Section, draw: Slot['draw']) => slots.push({ plan: { kind, chapter: null, items: [], fill: 1 }, section, first: true, draw });
  const plain: Section = { dest: '', label: '', title: '', head: '', tab: null };
  const poses = posesOf([...chapters, ...(bonus ? [bonus] : [])].map((ch) => ch.title), seed);
  const closes = closesOf(poses, poses.length + 1, seed); // the chapters, then the introduction
  const introClose = closes.at(-1)!;
  let sheets = 0;

  /** The pages of a planned section: each knows how to draw itself once page numbers exist. */
  const addPlans = (section: Section, index: number, chapter: number | null, plans: PagePlan[], pose: Pose, top: ((x: Ctx, s: Scene) => void) | null = null, opens = !!top) => {
    plans.forEach((plan, k) => {
      plan.chapter = chapter;
      const item = plan.items[0];
      if (item?.t === 'sheet') {
        if (item.part === 0) sheets += 1;
        slots.push({ plan, section, first: false, draw: sheetPage(item.block, item.part, sheets) });
      } else slots.push({ plan, section, first: opens && k === 0, draw: textPage(section, index, plan, pose, k === 0 ? top : null) });
    });
  };
  const entry = (section: Section, number: string | null) => entries.push({ number, label: section.label, title: section.title, page: 0, dest: section.dest });

  front('promise', plain, promisePage({
    chapters: chapters.length,
    actions: chapters.reduce((a, ch) => a + arr(ch.content.steps).length, 0),
    sheets: [...chapters, ...(bonus ? [bonus] : [])].filter((ch) => ch.content.visual?.type === 'grid').length,
  }));
  front('toc', plain, contentsPage);

  const introTitle = 'Le point de départ';
  const intro: Section = { dest: 'introduction', label: 'Introduction', title: introTitle, head: introTitle, tab: null };
  entry(intro, null);
  const introBlocks: Block[] = [];
  spec.intro.paragraphs.forEach((p, k) => {
    const b = paraBlock(p, t, { drop: k === 0 && finish >= 1 });
    if (b) introBlocks.push(b);
    if (k === 0 && finish >= 1 && spec.intro.quote) {
      const q = quoteBlock(spec.intro.quote, t);
      if (q) introBlocks.push(q);
    }
  });
  introBlocks.push(...calloutBlocks(spec.intro.box ? { label: 'À la fin de ce guide', text: spec.intro.box, titled: true } : null, t));
  const introPlans = layoutOf(introBlocks, INTRO_TOP);
  addPlans(intro, 0, null, introPlans.length ? introPlans : [{ kind: 'text', chapter: null, items: [], fill: 0 }], introClose, introTop(introTitle));

  const addChapter = (ch: ChapterSpec, k: number, isBonus: boolean) => {
    const number = k + 1;
    const section: Section = isBonus
      ? { dest: 'bonus', label: 'Bonus', title: ch.title, head: ch.head, tab: 'B' }
      : { dest: `chapitre-${number}`, label: `Chapitre ${number}`, title: ch.title, head: ch.head, tab: String(number) };
    entry(section, isBonus ? '+' : pad2(number));
    const opener = openerText(ch, t, finish);
    slots.push({ plan: { kind: 'opener', chapter: number, items: [], fill: 1 }, section, first: true, draw: openerPage(opener, number, chapters.length, isBonus, poses[k]!) });
    const blocks = chapterBlocks(ch.content, t, { finish, lead: opener.lead ? null : ch.content.intro, example: ch.example });
    addPlans(section, k, number, layoutOf(blocks), closes[k]!);
  };
  chapters.forEach((ch, k) => addChapter(ch, k, false));

  if (finish >= 2 && chapters.some((ch) => arr(ch.content.steps).length)) {
    const memo: Section = { dest: 'plan-une-page', label: 'À imprimer', title: 'Votre plan sur une page', head: 'Votre plan sur une page', tab: null };
    entry(memo, null);
    front('memo', memo, memoPage);
  }
  if (bonus) addChapter(bonus, chapters.length, true);

  const last: Section = { dest: 'la-suite', label: 'Et après ?', title: spec.final.heading, head: spec.final.heading, tab: null };
  entry(last, null);
  front('final', last, finalPage);

  c.sheetsTotal = sheets;
  c.pagesTotal = slots.length + 1; // the cover
  slots.forEach((slot, k) => {
    const hit = slot.first ? entries.find((e) => e.dest === slot.section.dest) : undefined;
    if (hit) hit.page = k + 2;
  });

  const pages: GuidePage[] = [{ scene: spec.cover, scale: W / spec.cover.w, links: [], dest: null, outline: null, preview: COVER_LABEL }];
  const previews = previewPages(slots);
  slots.forEach((slot, k) => {
    c.links = [];
    const scene = slot.draw(c, k + 2);
    const opens = slot.first ? entries.find((e) => e.dest === slot.section.dest) : undefined;
    pages.push({ scene, scale: 1, links: c.links, dest: opens?.dest ?? null, outline: opens ? sanitizeFor(t.v.text, opens.title) : null, preview: previews.get(slot) ?? null });
  });
  return { pages, plans: slots.map((slot) => slot.plan), audit: auditOf(slots, chapters.length, c.overflow, pages.length) };
}

/** The real pages, text under 12 pt as bars of their real width: at 250 px it is unreadable anyway, and the page stops giving the content away. */
export const previewsOf = (guide: Guide): { label: string; svg: string }[] => guide.pages.filter((p) => p.preview).map((p) => ({ label: p.preview!, svg: toSvg(p.scene, { greekBelow: 12, precision: 1 }) }));
