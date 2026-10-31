/**
 * What the older VisualSpec types look like in a guide: timeline, bar_chart, checklist_card, quote, steps_diagram, icon_grid,
 * do_dont, and the fillable grid. Flat inks on a `Scene`, hairlines and numerals, no card. Each is laid out first, so its
 * height is known to `paginate`, then drawn. The types of `diagrams.ts` come first: this file is what a save without them wears.
 */
import type { DesignSpec, InkSet, VisualSpec } from '../shared.js';
import { ensureContrast, mix } from './color.js';
import { diagramFor } from './diagrams.js';
import { advance, sanitizeFor, type FaceName } from './fonts.js';
import { GRID, wrapWords } from './layout/grid.js';
import { n, type Scene } from './scene.js';
import { sanitizePdfText } from './text.js';
import type { Voice } from './voices.js';

export interface PdfTheme {
  v: Voice; inks: InkSet;
  page: string;                 // the body pages' paper, sheets and openers keep inks.paper
  aText: string; bText: string; // a and b for small text on that paper
  muted: string; hair: string;
}

export interface VisualLayout { height: number; draw(s: Scene, x: number, y: number): void }

const H2 = { size: 19, leading: 21.6 };
const TEXT = { size: 9.6, leading: 12.8 };
const TINT = 0.22;
const NODE = 11;              // radius of a numbered node on a timeline

export function themeFor(design: DesignSpec, voice: Voice): PdfTheme {
  const inks = design.inks!;
  const page = mix(inks.paper, '#ffffff', 0.72);
  return { v: voice, inks, page, aText: ensureContrast(inks.a, page, 4.5), bText: ensureContrast(inks.b, page, 4.5), muted: mix(inks.ink, page, 0.32), hair: mix(inks.ink, page, 0.68) };
}

/** Sanitised for the face it will be set in, wrapped to the box. */
export const linesOf = (text: string, face: FaceName, size: number, width: number): string[] => wrapWords(sanitizeFor(face, text), face, size, width);

/** Sets lines from the top of their box, first baseline one size below it. Returns the height taken. */
export function setLines(s: Scene, lines: string[], x: number, top: number, o: { face: FaceName; size: number; leading: number; fill: string; anchor?: 'middle' | 'end' }): number {
  lines.forEach((l, k) => s.text(l, x, top + o.size + k * o.leading, o.face, o.size, o.fill, o.anchor ? { anchor: o.anchor } : {}));
  return lines.length * o.leading;
}

const mark = (s: Scene, cx: number, cy: number, r: number, color: string): void => {
  s.path(`M${n(cx - r)} ${n(cy)}L${n(cx - r * 0.3)} ${n(cy + r * 0.7)}L${n(cx + r)} ${n(cy - r * 0.7)}`, undefined, { stroke: color, sw: 1.3, cap: 'round' });
};

const cross = (s: Scene, cx: number, cy: number, r: number, color: string): void => {
  s.path(`M${n(cx - r)} ${n(cy - r)}L${n(cx + r)} ${n(cy + r)}M${n(cx + r)} ${n(cy - r)}L${n(cx - r)} ${n(cy + r)}`, undefined, { stroke: color, sw: 1.3, cap: 'round' });
};

/** The box the reader ticks: left empty, the author never ticks it in advance. */
export const tickBox = (s: Scene, x: number, y: number, size: number, color: string): void => { s.rect(x, y, size, size, undefined, { stroke: color, sw: 0.8 }); };

// ───────────────────────────── frame shared by every visual ─────────────────────────────

/** Title in the section-heading role, then the drawing: the heading of the figure is all the frame it needs. */
function frame(t: PdfTheme, title: string, width: number, contentH: number, body: (s: Scene, x: number, y: number) => void): VisualLayout {
  const lines = linesOf(title, t.v.deck, H2.size, width);
  const head = lines.length ? lines.length * H2.leading + 7.2 : 0;
  return {
    height: head + contentH,
    draw(s, x, y) {
      setLines(s, lines, x, y, { face: t.v.deck, size: H2.size, leading: H2.leading, fill: t.inks.ink });
      body(s, x, y + head);
    },
  };
}

// ───────────────────────────── the 7 visual types ─────────────────────────────

/** « Phase : action » (VisualSpec convention): the phase in bold, the action under it. */
function phaseOf(label: string): { phase: string; action: string } {
  const m = /^(.{2,32}?)[\s\u00a0]*:\s+(.+)$/u.exec(label);
  return m ? { phase: m[1]!, action: m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1) } : { phase: '', action: label };
}

function timeline(v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  if (labels.length <= 5) {
    const seg = width / labels.length;
    const labelW = seg - 8;
    const parts = labels.map(phaseOf).map((p) => ({ phase: linesOf(p.phase, voice.textB, TEXT.size, labelW), action: linesOf(p.action, voice.text, TEXT.size, labelW) }));
    const textH = Math.max(...parts.map((p) => (p.phase.length + p.action.length) * TEXT.leading));
    return frame(t, v.title, width, NODE * 2 + 10.8 + textH, (s, x, y) => {
      const lineY = y + NODE;
      const xs = labels.map((_, k) => x + seg * k + seg / 2);
      s.line(xs[0]!, lineY, xs[xs.length - 1]!, lineY, inks.ink, 0.9);
      xs.forEach((cx, k) => {
        const last = k === xs.length - 1;
        s.circle(cx, lineY, NODE, last ? inks.b : inks.a);
        s.text(String(k + 1), cx, lineY + 3.8, voice.labelB, 10, last ? inks.ink : inks.paper, { anchor: 'middle' });
        const p = parts[k]!;
        const top = lineY + NODE + 10.8;
        const h = setLines(s, p.phase, cx, top, { face: voice.textB, ...TEXT, fill: inks.ink, anchor: 'middle' });
        setLines(s, p.action, cx, top + h, { face: voice.text, ...TEXT, fill: inks.ink, anchor: 'middle' });
      });
    });
  }
  // a long sequence runs down the page
  const textW = width - 34;
  const rows = labels.map((l) => linesOf(l, voice.text, TEXT.size, textW));
  const heights = rows.map((r) => Math.max(21.6, r.length * TEXT.leading + 7.2));
  const contentH = heights.reduce((a, h) => a + h, 0);
  return frame(t, v.title, width, contentH, (s, x, y) => {
    s.line(x + 10, y + 9, x + 10, y + contentH - heights[heights.length - 1]! + 9, inks.ink, 0.9);
    let cy = y;
    rows.forEach((r, k) => {
      const last = k === rows.length - 1;
      s.circle(x + 10, cy + 9, 9, last ? inks.b : inks.a);
      s.text(String(k + 1), x + 10, cy + 12.2, voice.labelB, 8.5, last ? inks.ink : inks.paper, { anchor: 'middle' });
      setLines(s, r, x + 34, cy + 1, { face: voice.text, ...TEXT, fill: inks.ink });
      cy += heights[k]!;
    });
  });
}

function barChart(v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  const labelW = Math.min(170, width * 0.38);
  const trackX = labelW + 12;
  const valueW = 34;
  const trackW = width - trackX - valueW;
  const values = labels.map((_, k) => {
    const raw = Number(v.values?.[k]);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
  });
  const maxV = Math.max(0, ...values.map((x) => x ?? 0));
  const rows = labels.map((l) => linesOf(l, voice.text, TEXT.size, labelW));
  const heights = rows.map((r) => Math.max(21.6, r.length * TEXT.leading + 7.2));
  const contentH = 14.4 + heights.reduce((a, h) => a + h, 0);
  return frame(t, v.title, width, contentH, (s, x, y) => {
    [0, 50, 100].forEach((tick) => {
      const tx = x + trackX + (trackW * tick) / 100;
      s.text(String(tick), tx, y + 7, voice.label, 7, t.muted, { anchor: 'middle' });
      s.line(tx, y + 10, tx, y + contentH, t.hair, 0.5, { dash: [2, 3] });
    });
    let cy = y + 14.4;
    rows.forEach((r, k) => {
      const h = heights[k]!;
      setLines(s, r, x, cy + (h - r.length * TEXT.leading) / 2 - 1, { face: voice.text, ...TEXT, fill: inks.ink });
      const barY = cy + h / 2 - 6;
      s.rect(x + trackX, barY, trackW, 12, inks.c, { op: TINT });
      const val = values[k];
      if (val) s.rect(x + trackX, barY, Math.max(2, (trackW * val) / 100), 12, val === maxV ? inks.b : inks.a);
      // values are a 0..100 index (VisualSpec convention), not a percentage of anything
      s.text(val === null ? '–' : String(Math.round(val ?? 0)), x + width, barY + 9.5, voice.labelB, 9.5, inks.ink, { anchor: 'end' });
      cy += h;
    });
  });
}

function checklistCard(v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  const cols = labels.length > 5 ? 2 : 1;
  const colW = (width - (cols - 1) * GRID.gutter) / cols;
  const rows = labels.map((l) => linesOf(l, voice.text, TEXT.size + 0.4, colW - 20));
  const heights = rows.map((r) => Math.max(18, r.length * TEXT.leading + 7.2));
  const perCol = Math.ceil(labels.length / cols);
  const contentH = Math.max(...Array.from({ length: cols }, (_, c) => heights.slice(c * perCol, (c + 1) * perCol).reduce((a, h) => a + h, 0)));
  return frame(t, v.title, width, contentH, (s, x, y) => {
    for (let c = 0; c < cols; c++) {
      let cy = y;
      for (let k = c * perCol; k < Math.min(labels.length, (c + 1) * perCol); k++) {
        tickBox(s, x + c * (colW + GRID.gutter), cy + 2.5, 9, inks.ink);
        setLines(s, rows[k]!, x + c * (colW + GRID.gutter) + 20, cy, { face: voice.text, size: TEXT.size + 0.4, leading: TEXT.leading, fill: inks.ink });
        cy += heights[k]!;
      }
    }
  });
}

function quote(v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  const textW = width - 44;
  const text = linesOf(`« ${labels[0] ?? ''} »`, voice.displayIt, 14.5, textW);
  const author = labels[1] ? linesOf(labels[1], voice.label, 8.6, textW) : [];
  const tags = labels.slice(2, 6).join(' · ');
  const tagLines = tags ? linesOf(tags, voice.labelB, 8.2, textW) : [];
  const contentH = text.length * 18 + (author.length ? 7.2 + author.length * 11 : 0) + (tagLines.length ? 7.2 + tagLines.length * 11 : 0) + 7.2;
  return frame(t, v.title, width, contentH, (s, x, y) => {
    s.line(x + 8, y + 3.6, x + 8, y + contentH - 7.2, inks.b, 2.4);
    let cy = y;
    cy += setLines(s, text, x + 44, cy, { face: voice.displayIt, size: 14.5, leading: 18, fill: t.aText });
    if (author.length) cy += 7.2 + setLines(s, author, x + 44, cy + 7.2, { face: voice.label, size: 8.6, leading: 11, fill: t.muted });
    if (tagLines.length) setLines(s, tagLines, x + 44, cy + 7.2, { face: voice.labelB, size: 8.2, leading: 11, fill: inks.ink });
  });
}

function stepsDiagram(v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  const perRow = labels.length <= 4 ? labels.length : labels.length <= 6 ? 3 : 4;
  const gap = 22;
  const cellW = (width - (perRow - 1) * gap) / perRow;
  const rows: string[][][] = [];
  for (let k = 0; k < labels.length; k += perRow) rows.push(labels.slice(k, k + perRow).map((l) => linesOf(l, voice.text, TEXT.size, cellW)));
  const rowH = rows.map((r) => 27 + Math.max(...r.map((l) => l.length * TEXT.leading)) + 10.8);
  return frame(t, v.title, width, rowH.reduce((a, h) => a + h, 0), (s, x, y) => {
    let cy = y;
    let at = 0;
    rows.forEach((row, r) => {
      row.forEach((lines, k) => {
        at += 1;
        const cx = x + k * (cellW + gap);
        s.line(cx, cy, cx + cellW, cy, inks.ink, 0.9);
        s.text(String(at), cx, cy + 22, voice.display, 18, at === labels.length ? t.bText : t.aText);
        if (k < row.length - 1) s.path(`M${n(cx + cellW + 6)} ${n(cy + 12)}l8 4l-8 4Z`, inks.b);
        setLines(s, lines, cx, cy + 27, { face: voice.text, ...TEXT, fill: inks.ink });
      });
      cy += rowH[r]!;
    });
  });
}

/** What the old icon grid said, without the keyword lottery of its icons: each label is a cell, a numeral gives it its place. */
function labelGrid(v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  const cols = labels.length <= 4 ? Math.max(2, labels.length) : labels.length % 4 === 0 ? 4 : 3;
  const cellW = (width - (cols - 1) * GRID.gutter) / cols;
  const rows: string[][][] = [];
  for (let k = 0; k < labels.length; k += cols) rows.push(labels.slice(k, k + cols).map((l) => linesOf(l, voice.text, TEXT.size, cellW)));
  const rowH = rows.map((r) => 23.4 + Math.max(...r.map((l) => l.length * TEXT.leading)) + 10.8);
  return frame(t, v.title, width, rowH.reduce((a, h) => a + h, 0), (s, x, y) => {
    let cy = y;
    let at = 0;
    rows.forEach((row, r) => {
      row.forEach((lines, k) => {
        at += 1;
        const cx = x + k * (cellW + GRID.gutter);
        s.line(cx, cy, cx + cellW, cy, inks.ink, 0.5);
        s.text(String(at).padStart(2, '0'), cx, cy + 16, voice.deck, 11, t.aText);
        setLines(s, lines, cx, cy + 23.4, { face: voice.text, ...TEXT, fill: inks.ink });
      });
      cy += rowH[r]!;
    });
  });
}

// Symbols may stand alone; words need a separator ("À faire : …") so "Faire la sieste…" stays intact.
const DO_PREFIX = /^\s*(?:[+✓✔✅]\s*|(?:à faire|a faire|faire|do|oui|bon réflexe|bon reflexe|à privilégier|a privilegier)\s*[:–—-]\s*)/iu;
const DONT_PREFIX = /^\s*(?:[-✗✘❌×]\s*|(?:à éviter|a eviter|éviter|eviter|don'?t|non|mauvais réflexe|mauvais reflexe|erreur)\s*[:–—-]\s*)/iu;

/** Splits do/don't labels: explicit prefixes ("À faire :", "+", "✓" / "À éviter :", "-", "✗", "Ne pas…"), else halves (first half = à éviter). */
export function splitDoDont(labels: string[], values: number[] = []): { dos: string[]; donts: string[] } {
  const dos: string[] = [];
  const donts: string[] = [];
  const loose: string[] = [];
  labels.forEach((raw, k) => {
    const l = String(raw ?? '');
    if (DONT_PREFIX.test(l)) donts.push(l.replace(DONT_PREFIX, ''));
    else if (DO_PREFIX.test(l)) dos.push(l.replace(DO_PREFIX, ''));
    else if (/^\s*(ne pas|ne jamais|jamais|surtout pas)\b/i.test(l)) donts.push(l);
    else if (values.length === labels.length && (values[k] === 0 || values[k] === 1)) (values[k] === 1 ? dos : donts).push(l);
    else loose.push(l);
  });
  if (loose.length) {
    if (dos.length === 0 && donts.length === 0) {
      // unprefixed lists follow the minds' order: « à éviter » first, then « à faire »
      const half = Math.ceil(loose.length / 2);
      donts.push(...loose.slice(0, half));
      dos.push(...loose.slice(half));
    } else (dos.length <= donts.length ? dos : donts).push(...loose);
  }
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return { dos: clean(dos), donts: clean(donts) };
}

function doDont(v: VisualSpec, rawLabels: string[], width: number, t: PdfTheme): VisualLayout {
  const { inks, v: voice } = t;
  const split = splitDoDont(rawLabels, v.values);
  const colW = (width - GRID.gutter) / 2;
  const columns = [
    { label: 'À FAIRE', items: split.dos, color: t.aText, drawMark: mark },
    { label: 'À ÉVITER', items: split.donts, color: t.bText, drawMark: cross },
  ].map((c) => {
    const rows = c.items.map((l) => linesOf(l, voice.text, TEXT.size, colW - 18));
    return { ...c, rows, heights: rows.map((r) => r.length * TEXT.leading + 7.2) };
  });
  const contentH = 21.6 + Math.max(14, ...columns.map((c) => c.heights.reduce((a, h) => a + h, 0)));
  return frame(t, v.title, width, contentH, (s, x, y) => {
    columns.forEach((c, k) => {
      const cx = x + k * (colW + GRID.gutter);
      s.line(cx, y, cx + colW, y, c.color, 1.6);
      s.text(c.label, cx, y + 14, voice.labelB, 8.2, c.color, { track: 1.4 });
      let cy = y + 21.6;
      c.rows.forEach((r, i) => {
        c.drawMark(s, cx + 5, cy + 6, 3.4, c.color);
        setLines(s, r, cx + 18, cy, { face: voice.text, ...TEXT, fill: inks.ink });
        cy += c.heights[i]!;
      });
    });
  });
}

// ───────────────────────────── fillable grid ─────────────────────────────

const GRID_PAD_X = 6;
const GRID_PAD_Y = 5;
const GRID_TEXT = 9;
const GRID_HEAD = 8.8;
const GRID_LEADING = 11.7;
/** A line one can really write on with a pen (≈ 8,5 mm); a printed line with a box to tick needs less. */
export const GRID_WRITE_ROW = 24;
export const GRID_READ_ROW = 22;
const GRID_BOX = 13;

const TICK_COLUMN = /^(?:fait|fait \?|ok|coché|cochée|à cocher)$/iu;

interface GridRow { label: string[]; cells: (string[] | null)[]; h: number; writable: boolean; opensGroup: boolean }

export interface GridModel {
  rows: GridRow[];
  note: string;
  /** Height of rows [from, to[ under the header. */
  heightOf(from: number, to: number, extra?: number): number;
  /** Last row (exclusive) that fits under the header in `room` points, one row at least. */
  fit(from: number, room: number): number;
  /** Draws rows [from, to[, each writable row taller by `extra`, and returns the bottom y. */
  draw(s: Scene, x: number, y: number, from: number, to: number, extra: number): number;
}

/** Share of the width per column: names and tick boxes take what they need, text columns twice the blank ones. */
export function gridWidths(columns: string[], labels: string[], boxes: boolean[], filled: boolean[], width: number, bold: FaceName): number[] {
  const pad = GRID_PAD_X * 2 + 2;
  const wide = (s: string): number => advance(bold, s, GRID_HEAD);
  const longestWord = (s: string): number => Math.max(0, ...s.split(/[\s\u00a0]+/).map(wide));
  const min = columns.map((c, i) => Math.max(i === 0 ? 46 : 38, longestWord(c) + pad));
  const widest = Math.max(0, ...labels.map(wide));
  const fixed = columns.map((_, i) => {
    if (boxes[i]) return Math.max(min[i]!, GRID_BOX + pad);
    if (i === 0 && widest > 0) return Math.max(min[0]!, Math.min(widest + pad, width * 0.3));
    return null;
  });
  const out = fixed.slice();
  // a column below its header's longest word takes the room from the others
  for (let pass = 0; pass < columns.length; pass++) {
    const free = width - out.reduce<number>((s, w) => s + (w ?? 0), 0);
    const weight = (i: number) => (filled[i] ? 2.5 : 1);
    const total = columns.reduce((s, _, i) => s + (out[i] === null ? weight(i) : 0), 0);
    if (total === 0) break;
    const short = columns.findIndex((_, i) => out[i] === null && (free * weight(i)) / total < min[i]!);
    if (short < 0) return columns.map((_, i) => out[i] ?? (free * weight(i)) / total);
    out[short] = min[short]!;
  }
  // every column has its size: the first takes what is left, or all of them shrink when the mins overflow
  const sum = out.reduce<number>((s, w) => s + (w ?? 0), 0);
  return out.map((w, i) => (sum < width ? (w ?? 0) + (i === 0 ? width - sum : 0) : ((w ?? 0) * width) / sum));
}

/** Printable table of a VisualSpec of type `grid`: empty cells to fill by hand, unticked boxes, readable headers. */
export function gridModel(v: VisualSpec, width: number, t: PdfTheme): GridModel | null {
  const g = v.grid;
  const { inks, v: voice } = t;
  const clean = (s: string | null | undefined): string => sanitizeFor(voice.text, s ?? '');
  const columns = (g?.columns ?? []).map(clean);
  const rawRows = g?.rows ?? [];
  if (columns.length < 2 || rawRows.length === 0) return null;
  const labels = rawRows.map(clean);
  const cellsOf = (r: number): (string | null)[] => columns.slice(1).map((_, c) => {
    const s = clean(g?.cells?.[r]?.[c]);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
  });
  const grid = rawRows.map((_, r) => cellsOf(r));
  const filled = columns.map((_, i) => i > 0 && grid.some((row) => row[i - 1] !== null));
  const boxes = columns.map((c, i) => i > 0 && TICK_COLUMN.test(c) && !filled[i]);
  const widths = gridWidths(columns, labels, boxes, filled, width, voice.labelB);
  const textW = (i: number) => widths[i]! - GRID_PAD_X * 2;

  const heads = columns.map((c, i) => wrapWords(c, voice.labelB, GRID_HEAD, textW(i)));
  const headH = Math.max(...heads.map((h) => h.length)) * GRID_LEADING + GRID_PAD_Y * 2;
  const grouped = labels.some((l) => !l);
  const rows: GridRow[] = grid.map((cells, r) => {
    const label = wrapWords(labels[r]!, voice.textB, GRID_TEXT, textW(0));
    const set = cells.map((c, i) => (c ? wrapWords(c, voice.text, GRID_TEXT, textW(i + 1)) : null));
    const tallest = Math.max(label.length, ...set.map((c) => c?.length ?? 0));
    const writable = cells.some((c, i) => c === null && !boxes[i + 1]) || !labels[r];
    return { label, cells: set, writable, h: Math.max(writable ? GRID_WRITE_ROW : GRID_READ_ROW, tallest * GRID_LEADING + GRID_PAD_Y * 2), opensGroup: grouped && r > 0 && !!labels[r] };
  });
  const note = rows.some((r) => r.writable) ? 'À imprimer et à remplir à la main.' : boxes.some(Boolean) ? 'Cochez chaque ligne une fois faite.' : '';

  // a sheet with nothing to write in spreads its printed rows instead
  const roomy = (r: GridRow): boolean => r.writable || !rows.some((x) => x.writable);
  const rowH = (r: GridRow, extra: number): number => r.h + (roomy(r) ? extra : 0);
  const heightOf = (from: number, to: number, extra = 0): number => headH + rows.slice(from, to).reduce((s, r) => s + rowH(r, extra), 0);

  return {
    rows,
    note,
    heightOf,
    fit(from, room) {
      let to = from + 1;
      while (to < rows.length && heightOf(from, to + 1) <= room) to += 1;
      return to;
    },
    draw(s, x, y, from, to, extra) {
      const xs = widths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1]! + w], [x]);
      const part = rows.slice(from, to);
      const totalH = heightOf(from, to, extra);
      columns.forEach((_, i) => {
        setLines(s, heads[i]!, boxes[i] ? xs[i]! + widths[i]! / 2 : xs[i]! + GRID_PAD_X, y + GRID_PAD_Y - 1.5, { face: voice.labelB, size: GRID_HEAD, leading: GRID_LEADING, fill: inks.ink, ...(boxes[i] ? { anchor: 'middle' as const } : {}) });
      });
      let cy = y + headH;
      s.line(x, cy, x + width, cy, inks.ink, 1.2);
      part.forEach((r, k) => {
        const h = rowH(r, extra);
        if (r.label.length) s.rect(x, cy, widths[0]!, h, inks.c, { op: TINT });
        setLines(s, r.label, x + GRID_PAD_X, cy + GRID_PAD_Y - 1.5, { face: voice.textB, size: GRID_TEXT, leading: GRID_LEADING, fill: inks.ink });
        r.cells.forEach((cell, c) => {
          const i = c + 1;
          if (boxes[i]) tickBox(s, xs[i]! + (widths[i]! - GRID_BOX) / 2, cy + (h - GRID_BOX) / 2, GRID_BOX, inks.ink);
          else if (cell) setLines(s, cell, xs[i]! + GRID_PAD_X, cy + GRID_PAD_Y - 1.5, { face: voice.text, size: GRID_TEXT, leading: GRID_LEADING, fill: inks.ink });
        });
        cy += h;
        const closing = k === part.length - 1 || !!part[k + 1]!.opensGroup;
        s.line(x, cy, x + width, cy, inks.ink, closing ? 0.9 : 0.3, closing ? {} : { dash: [1, 2.5] });
      });
      for (const lx of xs.slice(1, -1)) s.line(lx, y, lx, y + totalH, inks.ink, 0.3);
      s.line(x, y, x + width, y, inks.ink, 1.2);
      return cy;
    },
  };
}

/** Lays out a visual, grid excepted (`gridModel`): its own diagram when it has one, else its older drawing. Null when there is nothing to draw. */
export function layoutVisual(v: VisualSpec | null | undefined, width: number, t: PdfTheme): VisualLayout | null {
  if (!v || v.type === 'grid') return null;
  const diagram = diagramFor(v, width, { voice: t.v, inks: t.inks });
  if (diagram) return { height: diagram.height, draw: (s, x, y) => { s.place(diagram.scene, x, y); } };
  const raw = (Array.isArray(v.labels) ? v.labels : []).map((l) => String(l ?? '')).filter((l) => sanitizePdfText(l).length > 0).slice(0, 12);
  const labels = raw.map((l) => sanitizeFor(t.v.text, l));
  if (labels.length === 0) return null;
  const spec: VisualSpec = { ...v, title: sanitizeFor(t.v.deck, v.title ?? ''), values: Array.isArray(v.values) ? v.values : [] };
  switch (v.type) {
    case 'timeline': return timeline(spec, labels.slice(0, 8), width, t);
    case 'bar_chart': return barChart(spec, labels.slice(0, 8), width, t);
    case 'quote': return quote(spec, labels, width, t);
    case 'steps_diagram': return stepsDiagram(spec, labels.slice(0, 8), width, t);
    case 'icon_grid': return labelGrid(spec, labels.slice(0, 9), width, t);
    case 'do_dont': return doDont(spec, labels, width, t);
    default: return checklistCard(spec, labels, width, t);
  }
}
