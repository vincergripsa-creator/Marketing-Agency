/**
 * The hook: huge type, one accent word, the guide's own art rising behind it. The whole screen is there on its first frame,
 * so it reads with the sound off; each word then hits on the voice. A plain editor sets it centred, over the same art
 * darkened, and it only pushes in: nothing hits, and no frame is dead.
 */
import { rgba } from '../../deliverables/color.js';
import type { SceneApi } from '../compose.js';
import type { SpokenWord } from '../speech.js';
import type { Rect } from '../stage.js';
import { eBack, eOut, leadIn, type TimelineBeat } from '../timeline.js';

const MAX_SIZE = 300;
const MIN_SIZE = 64;
const SIZE_STEP = 6;
const MAX_LINES = 5;           // the box's height says the rest: a big line beats a short one, four beat one too many
const LINE = 1.16;             // a French capital carries its accent into the line above
const WORD_GAP = 0.24;
const SLAM_SEC = 0.14;
const SLAM = 0.16;             // a word hits, it never leaves its place
const ENTER_SEC = 0.14;
const ENTER = 0.05;
const SHAKE = 8;
const SHAKE_SEC = 0.1;
const UNSAID = 0.9;            // a word yet to be said: it reads, and it is not lit
const TALL_HERO = 0.6;         // of the frame's height: the type takes the whole height
const EDGE = 10;               // the last word still hits inside the zone
const BOOK_SEC = 0.45;
export const BOOK_TILT = 0.1;
const BOOK_PEEK = 0.33;        // of its height, under its slot on frame 1: the hook and the guide, its title included, stand on the first frame together
const ART_FADE = 0.28;         // of the frame, past the type: the dark gives way to the art
const VEIL = 0.74;             // over the art when the type takes the whole frame: its colours stay, nothing fights the words
const PUSH = 0.01;             // a second, on a plain hook
const PUSH_MAX = 0.08;         // the box leaves room for this
const JUMP = 0.05;             // a shot inside a screen: the type jumps with the art, or the cut would not read over a long line
const INK_FOOT = 0.12;         // of the size, under a baseline: what a « Q » or a comma reaches
export const ORPHAN = 4;       // letters: « À » alone on its line is a hole in the block, the size comes down instead
const BALANCE = 0.96;          // each try narrows the line: three short lines read better than two long and an orphan
/** A word a sentence leans on is neither of these. */
const FLAT = /^(?:avec|dans|pour|sans|sous|tout|tous|toute|toutes|cette|vous|votre|notre|elle|elles|mais|donc|alors|comme|plus|très|bien|être|avoir|fait|faire|quand|parce|depuis|encore|même|c’est|qu’il|qu’on)$/iu;

interface Fit { size: number; lines: number[][]; y0: number } // lines of pieces, y0: baseline of the first line
/** The right rail of a tall frame, in the box's units: a line wholly above `y` may run to `x1`. */
interface Rail { x1: number; y: number }
/** What the type sets: a word, or half of one cut at its hyphen. `glued` sits against the piece before it, on the same line. */
interface Piece { text: string; word: number; glued: boolean }

const piecesOf = (words: readonly string[]): Piece[] => words.flatMap((w, word) => w.split(/(?<=\p{L}-)(?=\p{L})/u).map((text, i) => ({ text, word, glued: i > 0 })));

/** What a word takes on a line, ink included: an accent on a narrow capital reaches past its advance, and the type sits flush on the zone. */
function spanOf(s: SceneApi, word: string): { left: number; width: number } {
  const m = s.ctx.measureText(word);
  const left = Math.max(0, m.actualBoundingBoxLeft);
  return { left, width: left + Math.max(m.width, m.actualBoundingBoxRight) };
}

/** Greedy lines at these widths, at the size the font is set to. */
function linesOf(s: SceneApi, pieces: readonly Piece[], widthOf: (row: number) => number, gap: number): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  let curW = 0;
  pieces.forEach((piece, i) => {
    const room = spanOf(s, piece.text).width;
    const space = piece.glued ? 0 : gap;
    if (cur.length && curW + space + room > widthOf(lines.length)) { lines.push(cur); cur = []; curW = 0; }
    curW += (cur.length ? space : 0) + room;
    cur.push(i);
  });
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * Largest size that fits the box, whole words, or a word cut where it has a hyphen. Measured on the ink: Anton's accented
 * capitals rise far above any line height, so a block placed by its lines leaves the safe zone on « ÉTAPES ».
 */
function fit(s: SceneApi, pieces: readonly Piece[], box: Rect, rail: Rail | null): Fit {
  const { ctx } = s;
  for (let size = MAX_SIZE; ; size -= SIZE_STEP) {
    s.font(size, s.display);
    const gap = size * WORD_GAP;
    const footOf = (row: number): number => box.y + ctx.measureText('É').actualBoundingBoxAscent + row * size * LINE + size * INK_FOOT;
    const roomOf = (row: number): number => (rail && footOf(row) <= rail.y ? rail.x1 - box.x : box.w);
    let lines = linesOf(s, pieces, roomOf, gap);
    const widest = Math.max(...pieces.map((p) => spanOf(s, p.text).width));
    for (let k = BALANCE; widest <= box.w * k; k *= BALANCE) {
      const narrower = linesOf(s, pieces, (row) => roomOf(row) * k, gap);
      if (narrower.length > lines.length) break;
      lines = narrower;
    }
    const widthOf = (line: readonly number[]): number => line.reduce((sum, i, k) => sum + spanOf(s, pieces[i]!.text).width + (k && !pieces[i]!.glued ? gap : 0), 0);
    const ascent = Math.max(...lines[0]!.map((i) => ctx.measureText(pieces[i]!.text).actualBoundingBoxAscent));
    const descent = Math.max(...lines.at(-1)!.map((i) => ctx.measureText(pieces[i]!.text).actualBoundingBoxDescent));
    const ink = ascent + (lines.length - 1) * size * LINE + descent;
    const orphan = lines.some((line) => line.length === 1 && lines.length > 1 && pieces[line[0]!]!.text.length < ORPHAN);
    // Centred in the box, as far as the lines that run past it stay above the rail: measured on their ink, a « Ç » hangs low.
    const bottom = (line: readonly number[], row: number): number => box.y + ascent + row * size * LINE + Math.max(...line.map((i) => ctx.measureText(pieces[i]!.text).actualBoundingBoxDescent));
    const free = lines.reduce((room, line, row) => (rail && widthOf(line) > box.w ? Math.min(room, rail.y - bottom(line, row)) : room), (box.h - ink) / 2);
    if (size <= MIN_SIZE || (lines.length <= MAX_LINES && lines.every((line, row) => widthOf(line) <= roomOf(row)) && ink <= box.h && !orphan && free >= 0)) {
      return { size, lines, y0: box.y + Math.max(0, free) + ascent };
    }
  }
}

/** The one word that carries the colour: a figure first, else the longest word the sentence leans on. */
export function accentWord(words: readonly string[]): number {
  const digit = words.findIndex((w) => /\d/.test(w));
  if (digit >= 0) return digit;
  const letters = (w: string): number => w.replace(/[^\p{L}]/gu, '').length;
  return words.reduce((best, w, i) => (!FLAT.test(w) && letters(w) > (best < 0 ? 2 : letters(words[best]!)) ? i : best), -1);
}

/**
 * The film starts on the guide's art: dark where the type sits, its own colours where it does not. On a tall frame the art
 * rises under the type, on the square it stands beside it. `veil`: the type takes the whole frame, so the art goes dark under it.
 */
export function artUnderType(s: SceneApi, at: number, veil: boolean): void {
  const { ctx, C, stage } = s;
  const { w: W, h: H, heroBox: hero } = stage;
  s.background(C.dark, C.dark2, 0.5);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(s.jump, s.jump); ctx.translate(-W / 2, -H / 2);
  s.art(at);
  ctx.restore();
  if (veil) {
    ctx.fillStyle = rgba(C.dark, VEIL);
    ctx.fillRect(0, 0, W, H);
    s.band(at);
    return;
  }
  const beside = hero.h / H > TALL_HERO;
  const end = beside ? (hero.x + hero.w) / W : (hero.y + hero.h) / H;
  const fade = beside ? ctx.createLinearGradient(0, 0, W, 0) : ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, C.dark); fade.addColorStop(Math.min(0.99, end), C.dark); fade.addColorStop(Math.min(1, end + ART_FADE), rgba(C.dark, 0));
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
}

/** A screen's words as they stand: quotes only when both are there, no end mark on its last word but the one it asks with. */
function typeOf(group: readonly SpokenWord[]): string[] {
  const words = group.map((w) => w.text.toLocaleUpperCase('fr-FR'));
  const quoted = words.some((w) => w.includes('«')) && words.some((w) => w.includes('»'));
  const clean = quoted ? words : words.map((w) => w.replace(/[«»"]\s?|\s?[«»"]/g, ''));
  return clean.map((w, i) => (i === clean.length - 1 ? w.replace(/[\s.,:;…]+$/, '') : w));
}

export function drawHook(s: SceneApi, b: TimelineBeat, t: number): void {
  const { ctx, C, timeline } = s;
  const { plain } = timeline;
  const bookAt = timeline.bookSec;
  const room = 1 + (plain ? PUSH_MAX : JUMP); // the type grows inside its box
  const frame = bookAt === null ? { ...s.column, y: s.column.y + EDGE, h: s.column.h - EDGE * 2 } : s.hero;
  const box = { x: frame.x + frame.w * (1 - 1 / room) / 2, y: frame.y + frame.h * (1 - 1 / room) / 2, w: frame.w / room, h: frame.h / room };
  const [upper, lower] = s.stage.zones;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rail = plain || !lower ? null : { x1: cx + (upper!.x1 - cx) / room, y: cy + (upper!.y1 - cy) / room }; // both under the shot's jump
  artUnderType(s, b.t0 + t, bookAt === null);

  const fallback = s.memo(b, () => [b.screen.split(/\s+/).map((text) => ({ text, at: 0, end: b.dur }))]);
  const screens = b.groups.length ? b.groups : fallback;
  const index = Math.max(0, screens.findLastIndex((g) => t >= g[0]!.at - 0.05));
  const group = screens[index]!;
  const words = s.memo(group, () => typeOf(group));
  const pieces = s.memo(words, () => piecesOf(words));
  const { accent, size, lines, y0 } = s.memo(pieces, () => ({ accent: accentWord(words), ...fit(s, pieces, box, rail) }));
  const lineH = size * LINE;
  const lead = leadIn(timeline, b);
  const opened = index ? t - group[0]!.at + 0.05 : t + lead;
  const spoken = group.map((w) => t - (w.at - 0.05));
  const latest = Math.min(...spoken.filter((a) => a >= 0), opened);
  const shake = !plain && latest < SHAKE_SEC ? SHAKE * (1 - latest / SHAKE_SEC) : 0;
  const enter = 1 + ENTER * (1 - eBack(opened / ENTER_SEC, 1.6)); // of the whole block: a word grown on its own eats its gaps

  s.font(size, s.display);
  ctx.save();
  ctx.translate(Math.sin(t * 90) * shake, Math.cos(t * 70) * shake);
  const grow = enter * (plain ? 1 + Math.min(PUSH_MAX, PUSH * (b.t0 + t)) : 1 + JUMP * (s.shot % 2));
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2); ctx.scale(grow, grow); ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; // no blur: on glyphs this big, it would take the frame's whole budget
  ctx.shadowOffsetY = 10;
  lines.forEach((line, row) => {
    const spans = line.map((i) => spanOf(s, pieces[i]!.text));
    const gap = size * WORD_GAP;
    const gapAt = (k: number): number => (k && !pieces[line[k]!]!.glued ? gap : 0);
    const inLine = spans.reduce((a, c, k) => a + c.width + gapAt(k), 0);
    let x = plain ? box.x + (box.w - inLine) / 2 : box.x;
    line.forEach((i, k) => {
      const { left, width } = spans[k]!;
      const { text, word } = pieces[i]!;
      const age = spoken[word]!;
      const hit = plain || age < 0 ? 1 : 1 + SLAM * (1 - eBack(age / SLAM_SEC, 1.6));
      x += gapAt(k);
      ctx.save();
      ctx.translate(x + width / 2, y0 + row * lineH);
      ctx.scale(hit, hit);
      ctx.translate(left - width / 2, 0);
      ctx.globalAlpha = plain || age >= 0 || word === accent ? 1 : UNSAID;
      ctx.fillStyle = word === accent ? C.gold : '#fff';
      s.drawText(text, 0, 0, { moving: opened < ENTER_SEC || (!plain && age >= 0 && age < SLAM_SEC) || shake > 0 });
      ctx.restore();
      x += width;
    });
  });
  ctx.restore();
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetY = 0;
  if (bookAt !== null) {
    const rise = eOut((t + lead) / Math.max(BOOK_SEC, bookAt + lead));
    const slot = s.stage.bookSlot;
    s.book(slot.x + slot.w / 2, slot.y + slot.h / 2 + (1 - rise) * slot.h * BOOK_PEEK + Math.sin(t * 2) * 8, slot.w * s.jump, BOOK_TILT, t);
  }
}
