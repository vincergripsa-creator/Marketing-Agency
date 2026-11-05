/**
 * What every style shares: how tall a face's capitals stand, the smallest title that reads at thumbnail size, inks that
 * read on a ground, and the map that puts a style's own score on Bauhaus's scale (D200).
 */
import type { InkSet } from '../../../shared.js';
import { contrast } from '../../color.js';
import { advance, faceOf, isStdFont, wrapFace, type FaceName } from '../../fonts.js';
import { collapseSpaces, frenchNbsp, normalizeKey } from '../../text.js';
import { COVER_W, THUMB_CAP_MIN, THUMB_W } from './types.js';

/** Capital height of the standard faces, from their AFM. */
const STD_CAP: readonly [RegExp, number][] = [[/^Times/, 0.662], [/^Courier/, 0.571], [/^Helvetica/, 0.718]];

/** What fontkit knows of a face's capitals, beyond the few fields `fontkit.d.ts` declares. */
interface CapMetrics { capHeight?: number; glyphForCodePoint(cp: number): { bbox: { maxY: number } } }

const caps = new Map<FaceName, number>();

/** Capital height of a face, in em: the OS/2 table's, else the height of its « H ». */
export function capHeight(face: FaceName): number {
  if (isStdFont(face)) return STD_CAP.find(([re]) => re.test(face))?.[1] ?? 0.7;
  const known = caps.get(face);
  if (known) return known;
  const { font, unitsPerEm } = faceOf(face);
  const m = font as unknown as CapMetrics;
  const cap = (m.capHeight || m.glyphForCodePoint(72).bbox.maxY) / unitsPerEm;
  caps.set(face, cap);
  return cap;
}

/** The capitals of a title of `size` on a 600 px cover, seen on a thumbnail `THUMB_W` wide. */
export const thumbCap = (face: FaceName, size: number): number => (size * capHeight(face) * THUMB_W) / COVER_W;

/** The smallest title whose capitals still stand `THUMB_CAP_MIN` px tall on the thumbnail, with half a pixel to spare (E6). */
export const minTitleSize = (face: FaceName): number => Math.ceil(((THUMB_CAP_MIN + 0.5) * COVER_W) / (THUMB_W * capHeight(face)));

/** French words a line should not end on: an article or a preposition left hanging reads as a cut. */
const WEAK = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'a', 'au', 'aux', 'en', 'et', 'ou', 'pour', 'par', 'sur', 'sans', 'avec', 'dans', 'ses', 'son', 'sa', 'mes', 'mon', 'ma', 'vos', 'votre', 'nos', 'notre', 'leur', 'leurs', 'se', 'ce', 'cette', 'qui', 'que', 'ne', 'vers', 'chez', 'entre']);

const isWeak = (word: string): boolean => WEAK.has(normalizeKey(word).replace(/[^a-z]/g, ''));

/** A line may not end on a hanging word, nor on a number cut from what it counts (« 3 / premiers clients »). */
const hangs = (word: string, next: string | undefined): boolean => isWeak(word) || (next !== undefined && /\d$/.test(word) && /^\p{L}/u.test(next));

export interface PosterFit { size: number; lines: string[]; words: string[][] }

/**
 * What a ragged block costs against its size: lines of one length read as a block, and a cover audit reads that too. Light:
 * one line is always even, and a poster is made of big type before it is made of even lines.
 */
const BALANCE = 0.6;
/** A title on one line counts as this even: it would always win otherwise, and a poster title is rarely one line. */
const ONE_LINE_EVEN = 0.7;

/**
 * A title broken for a poster: of all the ways to cut it into 1 to `maxLines` lines, the one that sets it biggest inside
 * `width` × `height`, with no line ending on a hanging article and no word of two letters alone. The block is measured from
 * the top of its capitals: `cap` + (lines − 1) × `leading` + `descent`, in em. `tail` keeps that many em free at the end of the
 * last line, for a sign that closes the title. A word is never cut, except after its own hyphen (« Micro- / entrepreneur »):
 * under `min`, the title is set at `min` and may run long.
 */
export function posterBreak(text: string, face: FaceName, o: { width: number; height: number; min: number; max: number; maxLines: number; leading: number; cap: number; descent: number; track: number; tail?: number; balance?: number }): PosterFit {
  const words: string[] = [];
  const glued: boolean[] = [];   // the piece joins the next with no space: a compound cut after its hyphen
  for (const word of frenchNbsp(collapseSpaces(text)).split(' ').filter(Boolean)) {
    const parts = word.split(/(?<=\p{L}{3}-)(?=\p{L}{3})/u);
    parts.forEach((p, k) => { words.push(p); glued.push(k < parts.length - 1); });
  }
  const count = words.length;
  if (!count) return { size: o.min, lines: [], words: [] };
  const joined = (i: number, j: number): string[] => {
    const out: string[] = [];
    for (let k = i; k < j; k++) {
      if (k > i && glued[k - 1]) out[out.length - 1] += words[k]!;
      else out.push(words[k]!);
    }
    return out;
  };
  const em = (i: number, j: number): number => advance(face, joined(i, j).join(' '), 1, o.track);
  const cost = (i: number, j: number): number => {
    // a word of two letters, or a hanging one, never stands alone on a line
    if (j - i === 1 && (words[i]!.replace(/[^\p{L}\p{N}]/gu, '').length <= 2 || (j < count && isWeak(words[i]!)))) return Infinity;
    const w = em(i, j) + (j === count ? o.tail ?? 0 : 0);
    if ((j < count && hangs(words[j - 1]!, words[j])) || /^[:;—–&]/.test(words[i]!)) return w * 1.35;
    return j < count && glued[j - 1] ? w * 1.06 : w;
  };
  let best: { size: number; cut: number[]; q: number } | null = null;
  // widest[k][j]: the narrowest widest line, cutting the first j words into k lines
  let widest: number[] = [0, ...Array<number>(count).fill(Infinity)];
  const from: number[][] = [];
  for (let lines = 1; lines <= Math.min(o.maxLines, count); lines++) {
    const next = Array<number>(count + 1).fill(Infinity);
    const back = Array<number>(count + 1).fill(-1);
    for (let j = lines; j <= count; j++) {
      for (let i = lines - 1; i < j; i++) {
        if (!Number.isFinite(widest[i]!)) continue;
        const c = Math.max(widest[i]!, cost(i, j));
        if (c < next[j]!) { next[j] = c; back[j] = i; }
      }
    }
    from.push(back);
    widest = next;
    if (!Number.isFinite(widest[count]!)) continue;
    const cut: number[] = [count];
    for (let k = from.length - 1, j = count; k > 0; k--) cut.unshift((j = from[k]![j]!));
    // the sign that closes the title is part of its last line
    const widths = cut.map((j, k) => em(k ? cut[k - 1]! : 0, j) + (j === count ? o.tail ?? 0 : 0));
    const real = Math.max(...widths);
    const size = Math.min(o.max, o.width / real, o.height / (o.cap + (lines - 1) * o.leading + o.descent));
    // what the eye reads: the size, less for every hanging word the cut could not avoid, less for a ragged block
    const hanging = cut.slice(0, -1).filter((j) => hangs(words[j - 1]!, words[j])).length;
    const even = lines === 1 ? ONE_LINE_EVEN : Math.min(...widths) / real;
    const q = size * (1 - 0.18 * hanging) * (1 - 0.012 * lines) * (1 - (o.balance ?? BALANCE) * (1 - even));
    if (!best || q > best.q) best = { size, cut, q };
  }
  if (!best || best.size < o.min) {
    const lines = wrapFace(joined(0, count).join(' '), face, o.min, o.width - (o.tail ?? 0) * o.min);
    return { size: o.min, lines, words: lines.map((l) => l.split(' ')) };
  }
  const size = Math.floor(best.size * 4) / 4;
  const parts = best.cut.map((j, k) => joined(k ? best!.cut[k - 1]! : 0, j));
  return { size, lines: parts.map((p) => p.join(' ')), words: parts };
}

/** The ink of `pool` that reads best on `ground`. */
export function bestOn(ground: string, pool: readonly string[]): string {
  return [...pool].sort((a, b) => contrast(b, ground) - contrast(a, ground))[0]!;
}

/** The five inks, `ground` left out, in the order of `InkSet`. */
export const othersOf = (inks: InkSet, ground: string): string[] => [inks.paper, inks.ink, inks.a, inks.b, inks.c].filter((c) => c !== ground);

function rgbOf(c: string): [number, number, number] {
  const v = parseInt(c.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Hue in degrees and chroma 0..1, as HSL reads them. A grey has no hue worth reading. */
export function hueOf(c: string): { hue: number; chroma: number } {
  const [r, g, b] = rgbOf(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return { hue: 0, chroma: 0 };
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, chroma: d };
}

/**
 * How two colours sit together, 0..1: analogous or complementary hues agree, a quarter turn apart they argue. A colour next to a
 * neutral always agrees a little.
 */
export function harmony(a: string, b: string): number {
  const x = hueOf(a);
  const y = hueOf(b);
  const neutral = Math.min(x.chroma, y.chroma) < 0.12;
  if (neutral) return 0.7;
  const turn = (Math.abs(x.hue - y.hue) * Math.PI) / 180;
  return Math.abs(Math.cos(turn));
}

/** Bauhaus's art on its real covers, all shapes and inks (measured by `scripts/styleSheet.ts`): the scale every style maps onto. */
export const BAUHAUS_ART = { mean: 60.3, sd: 8.7 };

/**
 * A style's raw score of what it drew, put on Bauhaus's scale: the raw mean and spread a style measured on its own covers map
 * onto Bauhaus's, so that choosing a style moves no money through the score (D200).
 */
export function onBauhausScale(raw: number, measured: { mean: number; sd: number }, lift = 0): number {
  const z = (raw - measured.mean) / Math.max(1e-6, measured.sd);
  return Math.round(Math.min(100, Math.max(0, BAUHAUS_ART.mean + lift + z * BAUHAUS_ART.sd)) * 10) / 10;
}
