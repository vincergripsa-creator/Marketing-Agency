/**
 * A title set by hand for the styles that draw their own (D200): broken for a poster, put line by line through the kit, flush
 * left or centred, and what the words of a cover weigh in its SVG, so that a style knows what its art may spend under E6's
 * 150 kB. Glyph outlines are most of a cover's bytes: a long title in a rich face takes 140 kB on its own.
 */
import { escapeXml } from '../../text.js';
import { advance, sanitizeFor, type FaceName } from '../../fonts.js';
import { outlineD, toSvg } from '../../scene.js';
import { capHeight, minTitleSize, posterBreak } from './common.js';
import type { CoverKit, TextBlock } from './types.js';

/** A title as fitted: its lines, their size and leading, the face, the tracking and each line's width. */
export interface Fitted { size: number; lines: string[]; cap: number; lead: number; face: FaceName; track: number; widths: number[] }

export interface FitOptions { width: number; height: number; max: number; min?: number; maxLines?: number; leading: number; descent: number; track: number; balance?: number }

/** As big as it goes inside `width` × `height`, measured from the top of its capitals, never under the size that reads at 150 px. */
export function fitHead(face: FaceName, head: string, o: FitOptions): Fitted {
  const cap = capHeight(face);
  const min = Math.max(o.min ?? 0, minTitleSize(face));
  const fit = posterBreak(sanitizeFor(face, head), face, { width: o.width, height: Math.max(o.height, 1), min, max: Math.max(min, o.max), maxLines: o.maxLines ?? 7, leading: o.leading, cap, descent: o.descent, track: o.track, ...(o.balance === undefined ? {} : { balance: o.balance }) });
  const track = o.track * fit.size;
  return { size: fit.size, lines: fit.lines, cap: cap * fit.size, lead: fit.size * o.leading, face, track, widths: fit.lines.map((l) => advance(face, l, fit.size, track)) };
}

/** Height of the block from the top of its capitals to its last baseline. */
export const blockHeight = (t: Fitted): number => t.cap + (t.lines.length - 1) * t.lead;

/**
 * The lines from the top of their capitals, flush left from `x` or centred on it, each in the box it was fitted to. Returns
 * the baseline of each line.
 */
export function setHead(c: CoverKit, t: Fitted, x: number, top: number, ink: string, o: { center?: boolean; width: number }): number[] {
  return t.lines.map((line, k) => {
    const y = top + t.cap + k * t.lead;
    const w = t.widths[k]!;
    const left = o.center ? x - w / 2 : x;
    c.put(line, left, y, o.center ? w : o.width, t.face, t.size, ink, { track: t.track });
    return y;
  });
}

/** The deck's lines from the baseline of its first one, flush left or centred. */
export function setDeck(c: CoverKit, deck: TextBlock, x: number, first: number, ink: string, o: { center?: boolean; width: number }): void {
  const face = c.v.displayIt;
  deck.lines.forEach((l, k) => {
    const w = advance(face, l, deck.size);
    c.put(l, o.center ? x - w / 2 : x, first + k * deck.lineHeight, o.center ? w : o.width, face, deck.size, ink);
  });
}

// ───────────────────────────── what the words weigh ─────────────────────────────

/** E6's ceiling, less a margin for what the estimates miss. */
export const SVG_LIMIT = 150 * 1024 - 2500;

/** Bytes of one line of text as `toSvg` writes it: its outline and its aria-label. */
export function lineBytes(s: string, x: number, y: number, face: FaceName, size: number, track = 0): number {
  return outlineD(s, x, y, face, size, track ? { track } : {}).length + 48 + escapeXml(s).length;
}

/** Bytes of a fitted title set at `top`. */
export const headBytes = (t: Fitted, x: number, top: number): number => t.lines.reduce((sum, l, k) => sum + lineBytes(l, x, top + t.cap + k * t.lead, t.face, t.size, t.track), 0);

export const deckBytes = (c: CoverKit, deck: TextBlock | null, x: number, first: number): number =>
  (deck ? deck.lines.reduce((sum, l, k) => sum + lineBytes(l, x, first + k * deck.lineHeight, c.v.displayIt, deck.size), 0) : 0);

/**
 * What the kit's own lines weigh, a little over: the labels and the audience whole, before any clause is cut, and the frame
 * `renderCoverSvg` wraps the drawing in (its title and description).
 */
export function kitBytes(c: CoverKit): number {
  const { v, words } = c;
  const label = words.title.startsWith('Le kit à imprimer') ? 'KIT À IMPRIMER' : 'GUIDE PRATIQUE';
  const labels = lineBytes(sanitizeFor(v.labelB, label), 300, 500, v.labelB, 9.5, 2.2) + lineBytes(sanitizeFor(v.labelB, words.brand.toUpperCase()), 300, 500, v.labelB, 9.5, 2.2);
  const audience = words.audience ? lineBytes(sanitizeFor(v.label, `Pour : ${words.audience}`), 300, 500, v.label, 10.5) + 120 : 0;
  const frame = 420 + 3 * escapeXml(words.title).length + escapeXml(words.subtitle).length;
  return labels + audience + frame;
}

/** What the art drawn so far already weighs, with the frame of an SVG. */
export const drawnBytes = (c: CoverKit): number => toSvg(c.s).length;
