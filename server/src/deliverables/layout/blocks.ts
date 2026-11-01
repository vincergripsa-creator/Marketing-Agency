/** Measure, then paginate, then draw (pdf §8.2): the content of a guide as blocks whose height is known before any page exists. */
import type { ChapterContent, VisualSpec } from '../../shared.js';
import { advance, sanitizeFor } from '../fonts.js';
import { GRID_READ_ROW, GRID_WRITE_ROW, gridModel, layoutVisual, linesOf, properNouns, type GridModel, type PdfTheme } from '../pdfVisuals.js';
import type { Scene } from '../scene.js';
import { normalizeKey } from '../text.js';
import { BODY_BOTTOM, BODY_H, GRID, LEAD_LINE, wrapWords } from './grid.js';

export type FigureDraw = (s: Scene, x: number, y: number) => void;

/** One page of a printed sheet: rows [from, to[, each writable row `grow` taller, the y it ends at, and room to write under it when it ends high. */
export interface SheetPart { from: number; to: number; grow: number; end: number; notes: { y: number; h: number; label: string } | null }

/** `head` sits at the start of the line that follows `bold` lines of it: a long head takes the lines it needs. */
export type ParaBlock = { t: 'para'; lines: string[]; style: 'lead' | 'body'; head?: string; headW?: number; bold?: number; drop?: string; dropW?: number; dropLines?: number; italic?: boolean };
export type HeadingBlock = { t: 'h2'; text: string; h: number; label?: boolean };
export type StepsBlock = { t: 'steps'; items: { lines: string[]; h: number }[]; ticks?: true };
export type ExampleBlock = { t: 'example'; label: string; lines: string[]; h: number; titled?: boolean };
export type FigureBlock = { t: 'figure'; kind: VisualSpec['type']; h: number; draw: FigureDraw; float: true };
export type ChecklistBlock = { t: 'checklist'; items: string[]; h: number; cols: 1 | 2; rows: { cells: string[][]; h: number }[]; heads?: [string, string] };
export type SheetBlock = { t: 'sheet'; visual: VisualSpec; title: string[]; model: GridModel; parts: SheetPart[] };
export type NoteBlock = { t: 'note'; text: string; lines: string[]; h: number; rail: true };
export type QuoteBlock = { t: 'quote'; text: string; lines: string[]; h: number; rail: true };

export type Block = ParaBlock | HeadingBlock | StepsBlock | ExampleBlock | FigureBlock | ChecklistBlock | SheetBlock | NoteBlock | QuoteBlock;

export const DROP_SIZE = 53;
export const NOTE_TEXT = { size: 9.2, leading: 12.4 };
export const QUOTE_TEXT = { size: 14.5, leading: 18 };
export const STEP_INDENT = 44;
export const STEP_GAP = 8;
/** The box of a step that replaces its checklist line, and what it keeps from the text. */
export const STEP_BOX = 13;
const STEP_BOX_ROOM = STEP_BOX + 14;
export const CHECK_INDENT = 18;
export const CHECK_LINE = 13.5;
export const SHEET_BAND = { top: 48, line: 19.8, size: 16 };
const NOTE_HEAD = 14.4;
const QUOTE_HEAD = 18;
const EXAMPLE_PAD = 21.6;
const FIGURE_PAD = 21.6;
/** The part of that padding under the ink: the rest sits above the figure. */
export const FIGURE_FOOT = 14.4;
/** Past this a step or an example stops being a block of its own and flows as text. */
const MAX_ATOM = BODY_H * 0.5;
/** Height a row grows to when the page has room: handwriting takes more than a printed line, a short sheet more than a long one. */
const WRITE_TARGET = 38;
const WRITE_TARGET_SHORT = 60;
const SHORT_SHEET = 10;
const READ_TARGET = 34;
/** A table that ends higher than this share of the page leaves room to write under it. */
const SHEET_FULL = 0.85;
const SHEET_NOTES_GAP = 18;
const MIN_SHEET_NOTES = 57.6;

export const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined) : []);

/** A paragraph that opens on its own subject (« Premier geste : … ») lends the eye an entry point. */
const RUN_IN = /^([^:.!?]{4,34})[ \u00a0]:\s+(.+)$/su;
/** A long head leaves less than this on its last line: the text starts under it. */
const MIN_RUN = 72;

/** A paragraph that opens on a head of any length, in bold up to its colon. */
function headed(head: string, rest: string, t: PdfTheme): ParaBlock {
  const { v } = t;
  const lines = wrapWords(`${sanitizeFor(v.textB, head)}\u00a0:`, v.textB, v.body, GRID.column);
  const last = lines.at(-1)!;
  const headW = advance(v.textB, last, v.body) + 3;
  const text = (first: number) => wrapWords(sanitizeFor(v.text, rest), v.text, v.body, (k) => (k === 0 ? first : GRID.column));
  if (GRID.column - headW < MIN_RUN) return { t: 'para', style: 'body', lines: [...lines, ...text(GRID.column)], bold: lines.length };
  return { t: 'para', style: 'body', lines: [...lines.slice(0, -1), ...text(GRID.column - headW)], bold: lines.length - 1, head: last, headW };
}

export function paraBlock(text: string, t: PdfTheme, o: { style?: 'lead' | 'body'; drop?: boolean; italic?: boolean; head?: string } = {}): ParaBlock | null {
  if (o.head) return headed(o.head, text, t);
  const { v } = t;
  const style = o.style ?? 'body';
  const face = style === 'lead' || o.italic ? v.textIt : v.text;
  const size = style === 'lead' ? 12.2 : v.body;
  const clean = sanitizeFor(face, text);
  if (!clean) return null;
  const base = { t: 'para', style, ...(o.italic ? { italic: true } : {}) } as const;
  if (o.drop && /^\p{Lu}/u.test(clean)) {
    const drop = [...clean][0]!;
    const dropW = advance(v.display, drop, DROP_SIZE) + 5;
    const dropLines = /[QJ]/.test(drop) ? 4 : 3; // their tail goes under the third line
    const lines = wrapWords(clean.slice(drop.length), face, size, (k) => (k < dropLines ? GRID.column - dropW : GRID.column));
    if (lines.length >= dropLines) return { ...base, lines, drop, dropW, dropLines };
  }
  const run = RUN_IN.exec(clean);
  if (run && style === 'body' && !o.italic) {
    const head = `${run[1]!}\u00a0:`;
    const headW = advance(v.textB, head, size) + 3;
    return { ...base, lines: wrapWords(run[2]!, face, size, (k) => (k === 0 ? GRID.column - headW : GRID.column)), head, headW };
  }
  return { ...base, lines: wrapWords(clean, face, size, GRID.column) };
}

export const labelBlock = (text: string): HeadingBlock => ({ t: 'h2', text, h: 28.8, label: true });

const stepTexts = (items: string[], t: PdfTheme): string[] => items.map((s) => sanitizeFor(t.v.textB, s).replace(/^\s*(?:\d+\s*[.)\-–—:]|étape\s*\d+\s*[:.\-–—]?)\s*/i, '')).filter(Boolean);

function stepsBlocks(items: string[], t: PdfTheme, ticks: boolean): Block[] {
  const { v } = t;
  const clean = stepTexts(items, t);
  if (clean.length === 0) return [];
  const rows = clean.map((s) => {
    const lines = wrapWords(s, v.textB, v.body, GRID.full - STEP_INDENT - (ticks ? STEP_BOX_ROOM : 0));
    return { lines, h: Math.max(34, lines.length * GRID.baseline + 12) + STEP_GAP };
  });
  if (rows.some((r) => r.h > MAX_ATOM)) return [labelBlock('Étape par étape'), ...clean.flatMap((s, k) => paraBlock(`${k + 1}. ${s}`, t) ?? [])];
  return [labelBlock('Étape par étape'), { t: 'steps', items: rows, ...(ticks ? { ticks } : {}) }];
}

/** A ruled text in the column: an example, or, `titled`, the box that closes the introduction. */
export function calloutBlocks(callout: { label: string; text: string; titled?: boolean } | null, t: PdfTheme): Block[] {
  if (!callout?.text) return [];
  const { v } = t;
  const lines = linesOf(callout.text, v.textIt, v.body, GRID.column - 14);
  const h = 14.4 + lines.length * GRID.baseline + EXAMPLE_PAD;
  if (h > MAX_ATOM) return [labelBlock(callout.label), paraBlock(callout.text, t, { italic: true })].filter((b): b is HeadingBlock | ParaBlock => !!b);
  return [{ t: 'example', label: callout.label, lines, h, ...(callout.titled ? { titled: true } : {}) }];
}

function figureBlock(visual: VisualSpec | null | undefined, t: PdfTheme, ticks = false): FigureBlock | null {
  const layout = layoutVisual(visual, GRID.full, t, ticks);
  // a drawing is never broken across pages
  if (!visual || !layout || layout.height + FIGURE_PAD > BODY_H) return null;
  return { t: 'figure', kind: visual.type, h: layout.height + FIGURE_PAD, draw: layout.draw, float: true };
}

/** The lines of a checklist as they print: the box says it already, « Fait : … » or « … : fait » beside an empty box reads like a bug, and a mistake is never printed as something to do. */
function checkLines(items: string[], t: PdfTheme): { dos: string[]; stops: string[] } {
  const clean = items.map((s) => sanitizeFor(t.v.text, s).replace(/^\s*[-•*]\s*/, '')).filter(Boolean);
  const stop = /^(?:je ne fais plus|je corrige)[\s\u00a0]*:\s*/iu;
  const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const done = (s: string) => s.replace(/^fait[\s\u00a0]*:\s*/iu, '').replace(/[\s\u00a0]*:\s*fait\.?$/iu, '');
  return { dos: clean.filter((s) => !stop.test(s)).map((s) => upper(done(s))), stops: clean.filter((s) => stop.test(s)).map((s) => upper(s.replace(stop, ''))) };
}

const textKey = (s: string): string => normalizeKey(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Every line of the list is a step the reader has in front of him, whole or cut short: the box goes on the step, a list would say it twice. */
function restates(checklist: string[], steps: string[], t: PdfTheme): boolean {
  const { dos, stops } = checkLines(checklist, t);
  const said = stepTexts(steps, t).map(textKey);
  return dos.length > 0 && !stops.length && dos.every((line) => said.some((step) => step.startsWith(textKey(line))));
}

/** Every step stands whole on a station of the path. A shorter path leaves them to their list: a drawing never takes a step out of a guide. */
function pathTells(path: VisualSpec, steps: string[], t: PdfTheme): boolean {
  const stations = stepTexts((path.path?.stations ?? []).map((s) => s.label), t).map(textKey);
  return stepTexts(steps, t).every((step) => stations.includes(textKey(step)));
}

function checklistBlocks(items: string[], t: PdfTheme): Block[] {
  const { v } = t;
  const { dos, stops } = checkLines(items, t);
  if (dos.length + stops.length === 0) return [];
  const both = dos.length > 0 && stops.length > 0;
  const list = dos.length ? dos : stops;
  const halfW = (GRID.full - GRID.gutter) / 2 - CHECK_INDENT;
  const wrap = (s: string, width: number) => wrapWords(s, v.text, v.body, width);
  const rowOf = (cells: string[][]) => ({ cells, h: Math.max(...cells.map((c) => c.length), 1) * CHECK_LINE + 7.2 });
  let rows: { cells: string[][]; h: number }[];
  let cols: 1 | 2 = 2;
  let heads: [string, string] | undefined;
  if (both) {
    heads = ['À faire', 'À arrêter'];
    rows = Array.from({ length: Math.max(dos.length, stops.length) }, (_, k) => rowOf([dos[k] ? wrap(dos[k]!, halfW) : [], stops[k] ? wrap(stops[k]!, halfW) : []]));
    rows.unshift({ cells: [], h: GRID.baseline });
  } else if (list.length >= 4 && list.every((s) => wrap(s, halfW).length <= 2)) {
    const half = Math.ceil(list.length / 2);
    rows = Array.from({ length: half }, (_, k) => rowOf([wrap(list[k]!, halfW), list[half + k] ? wrap(list[half + k]!, halfW) : []]));
  } else {
    cols = 1;
    rows = list.map((s) => rowOf([wrap(s, GRID.full - CHECK_INDENT)]));
  }
  const block: ChecklistBlock = { t: 'checklist', items: [...dos, ...stops], h: rows.reduce((a, r) => a + r.h, 0), cols, rows, ...(heads ? { heads } : {}) };
  return [labelBlock(dos.length ? 'Votre checklist' : 'À arrêter'), block];
}

/** Where the table of a sheet starts: under its ink band and the line that says how to use it. */
export const sheetTop = (titleLines: number): number => SHEET_BAND.top + Math.max(1, titleLines) * SHEET_BAND.line + 32;

/** A sheet to print closes its chapter on a tinted page of its own, more when it is longer than one: the header comes back on each. */
export function sheetBlock(visual: VisualSpec, t: PdfTheme): SheetBlock | null {
  const model = gridModel(visual, GRID.full, t);
  if (!model) return null;
  const title = linesOf(visual.title ?? '', t.v.deck, SHEET_BAND.size, GRID.full);
  const room = BODY_BOTTOM - sheetTop(title.length);
  const parts: SheetPart[] = [];
  for (let from = 0; from < model.rows.length;) {
    const to = model.fit(from, room);
    const rows = model.rows.slice(from, to);
    const writable = rows.filter((r) => r.writable).length;
    const spare = room - model.heightOf(from, to);
    const grow = Math.max(0, writable ? Math.min((rows.length <= SHORT_SHEET ? WRITE_TARGET_SHORT : WRITE_TARGET) - GRID_WRITE_ROW, spare / writable) : Math.min(READ_TARGET - GRID_READ_ROW, spare / rows.length));
    const end = sheetTop(title.length) + model.heightOf(from, to, grow);
    const y = end + SHEET_NOTES_GAP;
    const writes = (end - GRID.top) / BODY_H < SHEET_FULL && BODY_BOTTOM - y >= MIN_SHEET_NOTES;
    parts.push({ from, to, grow, end, notes: writes ? { y, h: BODY_BOTTOM - y, label: model.ticks ? 'Ce que j’ai observé' : 'Vos notes' } : null });
    from = to;
  }
  return { t: 'sheet', visual, title, model, parts };
}

export const noteBlock = (text: string, t: PdfTheme): NoteBlock | null => {
  const lines = linesOf(text, t.v.textIt, NOTE_TEXT.size, GRID.rail);
  return lines.length ? { t: 'note', text, lines, h: NOTE_HEAD + lines.length * NOTE_TEXT.leading, rail: true } : null;
};

export const quoteBlock = (text: string, t: PdfTheme): QuoteBlock | null => {
  if (!text.trim()) return null;
  const lines = linesOf(`« ${properNouns(text)} »`, t.v.displayIt, QUOTE_TEXT.size, GRID.rail);
  return { t: 'quote', text, lines, h: QUOTE_HEAD + lines.length * QUOTE_TEXT.leading, rail: true };
};

/** The chapter after its opener: the text with its rail, then visual, steps, example, checklist, the sheet last. */
export function chapterBlocks(ch: ChapterContent, t: PdfTheme, o: { finish: 0 | 1 | 2; lead: string | null; example: { label: string; text: string } | null }): Block[] {
  const out: Block[] = [];
  const push = (b: Block | null) => { if (b) out.push(b); };
  if (o.lead) push(paraBlock(o.lead, t, { style: 'lead' }));
  const margin = o.finish >= 1 ? ch.margin : null;
  const paragraphs = arr(ch.paragraphs);
  const quoteAt = Math.floor((paragraphs.length * 2) / 3);
  paragraphs.forEach((p, k) => {
    push(paraBlock(p, t, { drop: k === 0 && o.finish >= 1 && !o.lead }));
    if (k === 0 && margin?.note) push(noteBlock(margin.note, t));
    if (k === quoteAt && margin?.quote) push(quoteBlock(margin.quote, t));
  });
  const visuals = [ch.visual, o.finish >= 2 ? ch.figure : null];
  const ticks = restates(arr(ch.checklist), arr(ch.steps), t);
  // a path of the steps says them with their moment and their length: the same words again as a list would be padding
  let told = false;
  const figures = visuals.flatMap((v) => {
    const tells = v?.type === 'step_path' && pathTells(v, arr(ch.steps), t);
    const figure = v && v.type !== 'grid' ? figureBlock(v, t, ticks && tells) : null;
    told ||= tells && !!figure;
    return figure ?? [];
  });
  const steps = told ? [] : stepsBlocks(arr(ch.steps), t, ticks);
  const ticked = ticks && (told || steps.some((b) => b.t === 'steps'));
  out.push(...figures, ...steps, ...calloutBlocks(o.example, t), ...(ticked ? [] : checklistBlocks(arr(ch.checklist), t)));
  for (const v of visuals) if (v?.type === 'grid') push(sheetBlock(v, t));
  return out;
}

/** Height of the line box of a paragraph. */
export const lineOf = (b: ParaBlock): number => (b.style === 'lead' ? LEAD_LINE : GRID.baseline);
