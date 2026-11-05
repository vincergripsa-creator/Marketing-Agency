/**
 * What the styles of package S1 share (« Grille suisse », « Pop », « Ligne claire »): a title fitted to its box and set line
 * by line with its key figure in a second ink, that figure found once (« 30 jours »), a deck in any face of the voice, text
 * drawn as art, and the shapes their pictures are made of. Strokes are cut into one sub-path per segment with round caps: no
 * back-end is told a line join, and pdfkit and the SVG would miter a bolt's sharp tip differently, where round ends come out
 * alike.
 */
import { contrast, mix } from '../../color.js';
import { advance, faceOf, fitDisplay, isStdFont, sanitizeFor, wrapFace, type FaceName } from '../../fonts.js';
import { n, outlineD, type Paint, type Scene } from '../../scene.js';
import { collapseSpaces, normalizeKey, wholeClause } from '../../text.js';
import { pathD, placer, type Box, type Place, type Silhouette, type UnitPath } from '../shapes.js';
import { capHeight, minTitleSize, posterBreak } from './common.js';
import type { CoverKit, TextBlock } from './types.js';

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** 4.5 reads, 13.5 is as good as type gets on a cover. */
export const legible = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - 4.5) / 9);
/** An accent is seen from 1.4, and pops from 4.4. */
export const pops = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - 1.4) / 3);

/** One of `xs` for the draw `r` in 0..1, each as likely as its weight: one draw whatever the pool. */
export function weighted<T>(xs: readonly T[], weight: (x: T) => number, r: number): T | undefined {
  const ws = xs.map((x) => Math.max(0, weight(x)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return xs[Math.floor(r * xs.length)];
  let at = r * total;
  for (let i = 0; i < xs.length; i++) {
    at -= ws[i]!;
    if (at < 0) return xs[i];
  }
  return xs[xs.length - 1];
}

// ───────────────────────────── the title ─────────────────────────────

export interface Title { size: number; lines: string[]; words: string[][]; cap: number; lead: number; face: FaceName; track: number; widths: number[] }

export interface TitleFit {
  width: number; height: number; max: number;
  min?: number; maxLines?: number;
  leading: number;               // of the size, baseline to baseline
  descent?: number;              // of the size, under the last baseline
  track?: number;                // in em
  tail?: number;                 // em kept free at the end of the last line
  balance?: number;
}

/** The title broken for a poster in `face`, as big as `width` × `height` allows, never under the size that reads at 150 px. */
export function fitTitle(text: string, face: FaceName, o: TitleFit): Title {
  const cap = capHeight(face);
  const track = o.track ?? 0;
  const fit = posterBreak(sanitizeFor(face, text), face, {
    width: o.width, height: o.height, min: o.min ?? minTitleSize(face), max: o.max, maxLines: o.maxLines ?? 7, leading: o.leading, cap,
    descent: o.descent ?? 0.22, track, ...(o.tail ? { tail: o.tail } : {}), ...(o.balance === undefined ? {} : { balance: o.balance }),
  });
  const t = track * fit.size;
  return { ...fit, cap: cap * fit.size, lead: fit.size * o.leading, face, track: t, widths: fit.lines.map((l) => advance(face, l, fit.size, t)) };
}

/** From the top of the capitals of the first line to the foot of the descenders of the last. */
export const titleHeight = (t: Title, descent = 0.22): number => t.cap + (t.lines.length - 1) * t.lead + descent * t.size;

/** Units a number counts: « 21 jours », « 10 000 € », « 8 semaines ». */
const UNIT_WORD = /^(?:jours?|nuits?|semaines?|mois|ans?|heures?|h|minutes?|min|etapes?|points?|euros?|clients?|fiches?|recettes?|repas|soirs?|seances?|kg|km|pas|questions?|regles?|astuces?|exercices?|m2|m²|€|%)$/;
/** A unit that is a sign: set with its figure, at its size. « m² » is not one: its exponent set that big reads as a second figure. */
const SIGN = /^(?:€|%)$/;
/** A figure as a reader sees one: « 30 », « 800+ », « 6-12 », « 3,5 ». */
const FIGURE = /^[+-]?\d[\d.,]*(?:[-–]\d+)?[+%€]?$/;
const bare = (w: string): string => w.replace(/^[(«"“]+/, '').replace(/[,.;:!?)»"”]+$/, '');

export interface Figure { figure: string; unit: string; sign: boolean }

function figureIn(text: string, needsUnit: boolean): Figure | null {
  const parts = collapseSpaces(text).split(/[   ]+/).filter(Boolean);
  const at = parts.findIndex((w) => FIGURE.test(bare(w)));
  if (at < 0) return null;
  const groups: string[] = [bare(parts[at]!)];
  // « 10 000 »: groups of three digits after the first belong to it
  for (let k = at + 1; k < parts.length && /^\d{3}$/.test(bare(parts[k]!)) && /^\d{1,3}$/.test(groups[groups.length - 1]!); k++) groups.push(bare(parts[k]!));
  const next = bare(parts[at + groups.length] ?? '');
  const unit = UNIT_WORD.test(normalizeKey(next)) ? next : '';
  const figure = groups.join(' ');
  const sign = SIGN.test(unit) || /[+%€]$/.test(figure);
  if (needsUnit && !unit && !sign) return null;
  return { figure, unit, sign };
}

/** The title's key figure: its first number and the unit it counts, from the head, else from the tail when it counts something. */
export const keyFigure = (head: string, tail = ''): Figure | null => figureIn(head, false) ?? figureIn(tail, true);

/** The key figure a style may set as art in `face`: none in the standard faces, which have no outlines to give. */
export const figureFor = (face: FaceName, head: string, tail = ''): Figure | null => (isStdFont(face) ? null : keyFigure(head, tail));

/** The pieces of a poster title that say its first number and its unit, by their place in the title. */
export function hotWords(words: readonly string[]): Set<number> {
  const first = words.findIndex((w) => /^\P{L}*\d/u.test(w));
  const hot = new Set<number>();
  if (first < 0) return hot;
  let k = first;
  while (k < words.length && /^\P{L}*\d/u.test(words[k]!)) hot.add(k++);
  if (k < words.length && UNIT_WORD.test(normalizeKey(words[k]!).replace(/[,.;:!?)]+$/, ''))) hot.add(k);
  return hot;
}

export interface SetTitle {
  hot?: string | null;
  align?: 'start' | 'center';
  width?: number;
  /** Told where each run of the number's words stands: a marker or an underline goes under it. */
  mark?: (x: number, baseline: number, width: number) => void;
}

/**
 * The title's lines from the top of its capitals, its number in `hot`: runs of words of one ink side by side on the baseline,
 * each put in the box of its line. A line cut into runs loses the kerning across their seams: when that makes it wider than
 * its box, its tracking closes by what it lost. Returns the last baseline.
 */
export function setTitle(c: CoverKit, t: Title, x: number, top: number, ink: string, o: SetTitle = {}): number {
  const width = o.width ?? Math.max(...t.widths, 0);
  const lit = o.hot || o.mark ? hotWords(t.words.flat()) : new Set<number>();
  let at = 0;
  let y = top + t.cap;
  t.words.forEach((line, k) => {
    if (k) y += t.lead;
    const runs: { s: string; hot: boolean }[] = [];
    for (const word of line) {
      const isHot = lit.has(at++);
      const last = runs[runs.length - 1];
      if (last && last.hot === isHot) last.s += ` ${word}`;
      else runs.push({ s: word, hot: isHot });
    }
    const start = o.align === 'center' ? x + (width - t.widths[k]!) / 2 : x;
    const drawn = (tr: number): number => runs.reduce((w, run, i) => w + (i < runs.length - 1 ? advance(t.face, `${run.s} `, t.size, tr) + tr : advance(t.face, run.s, t.size, tr)), 0);
    let track = t.track;
    const over = drawn(track) - (x + width - start);
    if (over > 0) track -= over / Math.max(1e-6, drawn(track + 1) - drawn(track)) + 1e-4;
    let cx = start;
    for (const run of runs) {
      c.put(run.s, cx, y, x + width - cx, t.face, t.size, run.hot && o.hot ? o.hot : ink, { track });
      if (run.hot && o.mark) o.mark(cx, y, advance(t.face, run.s, t.size, track));
      cx += advance(t.face, `${run.s} `, t.size, track) + track;
    }
  });
  return y;
}

/** The tail of the title with all its words, or else the subtitle as a whole clause, fitted in `face`: the kit's deck in any face. */
export function deckIn(c: CoverKit, face: FaceName, tail: string, width: number, o: { max: number; min: number; lines: number; leading?: number }): TextBlock | null {
  const leading = o.leading ?? 1.18;
  const block = (fit: { size: number; lines: string[] }): TextBlock => ({ lines: fit.lines, size: fit.size, lineHeight: fit.size * leading, height: fit.size * leading * fit.lines.length });
  if (tail) return block(fitDisplay(sanitizeFor(face, tail), face, { width, max: o.max, min: o.min, maxLines: o.lines }));
  const subtitle = sanitizeFor(face, c.words.subtitle);
  const fits = (s: string) => wrapFace(s, face, o.min, width).length <= o.lines;
  const text = wholeClause(subtitle, fits);
  if (!text || !fits(text)) return null;
  return block(fitDisplay(text, face, { width, max: o.max, min: o.min, maxLines: o.lines }));
}

/** A deck's lines from the baseline of its first one, each in the box it was fitted to. */
export function setDeck(c: CoverKit, deck: TextBlock, face: FaceName, x: number, first: number, width: number, ink: string, align: 'start' | 'center' = 'start'): void {
  deck.lines.forEach((l, k) => {
    const lx = align === 'center' ? x + (width - advance(face, l, deck.size)) / 2 : x;
    c.put(l, lx, first + k * deck.lineHeight, x + width - lx, face, deck.size, ink);
  });
}

// ───────────────────────────── text as art ─────────────────────────────

/** Where the ink of `s` really is, from its origin on the baseline: what flush-left and a cap line mean for a giant figure. */
export function inkBounds(face: FaceName, s: string, size: number, track = 0): { x0: number; x1: number; top: number; bottom: number } {
  if (isStdFont(face)) return { x0: 0, x1: advance(face, s, size, track), top: -capHeight(face) * size, bottom: 0 };
  const { font, unitsPerEm } = faceOf(face);
  const run = font.layout(s);
  const k = size / unitsPerEm;
  let pen = 0;
  const b = { x0: Infinity, x1: -Infinity, top: Infinity, bottom: -Infinity };
  run.glyphs.forEach((g, i) => {
    const box = (g as unknown as { bbox: { minX: number; minY: number; maxX: number; maxY: number } }).bbox;
    const at = run.positions[i]!;
    if (box && Number.isFinite(box.minX) && box.maxX > box.minX) {
      b.x0 = Math.min(b.x0, pen + (at.xOffset + box.minX) * k);
      b.x1 = Math.max(b.x1, pen + (at.xOffset + box.maxX) * k);
      b.top = Math.min(b.top, -box.maxY * k);
      b.bottom = Math.max(b.bottom, -box.minY * k);
    }
    pen += at.xAdvance * k + track;
  });
  return Number.isFinite(b.x0) ? b : { x0: 0, x1: advance(face, s, size, track), top: -capHeight(face) * size, bottom: 0 };
}

/** Text as a shape on the baseline `y`, lining figures: it never reaches the PDF's text. Without the voice's fonts, nothing. */
export function artText(s: Scene, text: string, x: number, y: number, face: FaceName, size: number, fill: string, track = 0): void {
  const d = outlineD(sanitizeFor(face, text), x, y, face, size, { track, features: ['lnum'] });
  if (d) s.path(d, fill);
}

// ───────────────────────────── shapes ─────────────────────────────

type Pt = readonly [number, number];

/** Each segment of `p` in `box` as its own sub-path: stroked with round caps, its joins come out round in both back-ends. */
export function segmentsD(p: UnitPath, box: Box, o: Place = {}): string {
  const at = placer(box, o);
  const P = (u: number, v: number) => at(u, v).map(n).join(' ');
  let d = '';
  let cur: Pt = [0, 0];
  let start: Pt = cur;
  for (const s of p) {
    if (s[0] === 'M') { cur = [s[1], s[2]]; start = cur; }
    else if (s[0] === 'L') { d += `M${P(cur[0], cur[1])}L${P(s[1], s[2])}`; cur = [s[1], s[2]]; }
    else if (s[0] === 'C') { d += `M${P(cur[0], cur[1])}C${P(s[1], s[2])} ${P(s[3], s[4])} ${P(s[5], s[6])}`; cur = [s[5], s[6]]; }
    else {
      if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-4) d += `M${P(cur[0], cur[1])}L${P(start[0], start[1])}`;
      cur = start;
    }
  }
  return d;
}

/** Points as one closed outline, and as round-joined strokes. */
export const polyD = (pts: readonly Pt[]): string => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
export const polyStrokeD = (pts: readonly Pt[]): string => pts.map((p, i) => { const q = pts[(i + 1) % pts.length]!; return `M${n(p[0])} ${n(p[1])}L${n(q[0])} ${n(q[1])}`; }).join('');

/** A smooth curve through `pts`, Catmull-Rom made cubic; closed or open. */
export function curveD(pts: readonly Pt[], closed: boolean): string {
  if (pts.length < 2) return '';
  const count = pts.length;
  const at = (i: number): Pt => (closed ? pts[(i + count) % count]! : pts[Math.min(count - 1, Math.max(0, i))]!);
  let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
  for (let i = 0; i < (closed ? count : count - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** A rounded rectangle turned `rot` degrees about its centre: a card, a pill, a cell. */
export function cardD(x: number, y: number, w: number, h: number, r: number, rot = 0): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = 0.5523 * rr;
  const [cx, cy] = [x + w / 2, y + h / 2];
  const a = (rot * Math.PI) / 180;
  const [cs, sn] = [Math.cos(a), Math.sin(a)];
  const P = (px: number, py: number): string => `${n(cx + (px - cx) * cs - (py - cy) * sn)} ${n(cy + (px - cx) * sn + (py - cy) * cs)}`;
  const [x1, y1] = [x + w, y + h];
  return `M${P(x + rr, y)}L${P(x1 - rr, y)}C${P(x1 - rr + k, y)} ${P(x1, y + rr - k)} ${P(x1, y + rr)}L${P(x1, y1 - rr)}C${P(x1, y1 - rr + k)} ${P(x1 - rr + k, y1)} ${P(x1 - rr, y1)}L${P(x + rr, y1)}C${P(x + rr - k, y1)} ${P(x, y1 - rr + k)} ${P(x, y1 - rr)}L${P(x, y + rr)}C${P(x, y + rr - k)} ${P(x + rr - k, y)} ${P(x + rr, y)}Z`;
}

/** The corners of a box turned `rot` degrees about its centre: what a card covers, to keep text inside it. */
export function turned(x: number, y: number, w: number, h: number, rot: number): Pt[] {
  const [cx, cy] = [x + w / 2, y + h / 2];
  const a = (rot * Math.PI) / 180;
  const [cs, sn] = [Math.cos(a), Math.sin(a)];
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]): Pt => [cx + (px! - cx) * cs - (py! - cy) * sn, cy + (px! - cx) * sn + (py! - cy) * cs]);
}

/** A starburst of `points` tips, the first one up and turned `rot` degrees. */
export function burstPts(cx: number, cy: number, outer: number, inner: number, points: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  const a0 = -Math.PI / 2 + (rot * Math.PI) / 180;
  for (let i = 0; i < points * 2; i++) {
    const a = a0 + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** What to draw an illustration in: an outline of one weight around a filled body, its holes, its lines and its marks. */
export interface Outline {
  line: string;                      // the outline's ink
  w: number;                         // its width, in points, outside the body
  body: Paint;                       // the body's fill: it covers the inner edges of a body made of several parts
  holes?: Paint;                     // their fill; absent, the body's
  holeLine?: boolean;                // the holes outlined too, at `lw`
  lines?: string;                    // the lines over the body; absent, the outline's ink
  lw?: number;                       // lines, marks and holes; absent, `w`
  shadow?: { dx: number; dy: number; ink: string };
}

/**
 * A silhouette as an outlined illustration: its union outlined (a stroke of twice the width, the body filled over it), its
 * holes filled and outlined, its lines and marks at one weight, all round-ended; a hard shadow under it when asked.
 */
export function outlined(s: Scene, shape: Silhouette, box: Box, o: Outline, place: Place = {}): void {
  const lw = o.lw ?? o.w;
  const round = { cap: 'round' as const };
  if (o.shadow) {
    const sb = { ...box, x: box.x + o.shadow.dx, y: box.y + o.shadow.dy };
    if (shape.body.length) {
      s.path(segmentsD(shape.body, sb, place), undefined, { stroke: o.shadow.ink, sw: 2 * o.w, ...round });
      s.path(pathD(shape.body, sb, place), o.shadow.ink);
    }
    if (shape.marks.length) s.path(segmentsD(shape.marks, sb, place), undefined, { stroke: o.shadow.ink, sw: lw, ...round });
  }
  if (shape.body.length) {
    s.path(segmentsD(shape.body, box, place), undefined, { stroke: o.line, sw: 2 * o.w, ...round });
    s.path(pathD(shape.body, box, place), o.body);
  }
  if (shape.holes.length) {
    s.path(pathD(shape.holes, box, place), o.holes ?? o.body);
    if (o.holeLine) s.path(segmentsD(shape.holes, box, place), undefined, { stroke: o.line, sw: lw, ...round });
  }
  if (shape.lines.length) s.path(segmentsD(shape.lines, box, place), undefined, { stroke: o.lines ?? o.line, sw: lw, ...round });
  if (shape.marks.length) s.path(segmentsD(shape.marks, box, place), undefined, { stroke: o.line, sw: lw, ...round });
}

/**
 * A grid of dots over a box, every other row offset by half a step: each dot a segment of a hundredth of a point, which a
 * round cap draws as a disc the stroke's width across, in the SVG as in the PDF. One path, a few bytes a dot.
 */
export function dotsD(x: number, y: number, w: number, h: number, step: number, skip?: (px: number, py: number) => boolean): string {
  let d = '';
  for (let row = 0, py = y + step / 2; py < y + h; row++, py += step) {
    for (let px = x + (row % 2 ? step : step / 2); px < x + w; px += step) if (!skip?.(px, py)) d += `M${n(px)} ${n(py)}h0.01`;
  }
  return d;
}

/** A tint of `ink` on `paper` light enough that `text` still reads on it at `min`: a ground that type may cross. */
export function tintFor(paper: string, ink: string, text: string, t: number, min = 4.5): string {
  let k = t;
  for (let i = 0; i < 12 && contrast(text, mix(paper, ink, k)) < min; i++) k *= 0.8;
  return mix(paper, ink, k);
}
