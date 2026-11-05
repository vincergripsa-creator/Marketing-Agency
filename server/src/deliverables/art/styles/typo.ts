/**
 * « Typo XXL » (D200): the title is the image. Broken for a poster and set as big as the cover allows, tight, in the voice's
 * own display face; its number, when it has one, in a second ink; the motif as its full stop or as a colophon. Three
 * compositions: a poster on one flat ground, an editorial page cut in two, the title's figure as a giant tone-on-tone sign.
 * The seed picks the inks, the anchor and where the motif sits; the score reads what they give, legibility first.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, ensureContrast, mix } from '../../color.js';
import { advance, sanitizeFor, type FaceName } from '../../fonts.js';
import { n, outlineD, type Scene } from '../../scene.js';
import { decoRng, hashString, normalizeKey } from '../../text.js';
import { boundsOf, drawShape, motifShape, type Box, type Silhouette } from '../shapes.js';
import { bestOn, capHeight, harmony, minTitleSize, onBauhausScale, posterBreak } from './common.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec } from './types.js';

const LABEL_Y = 58;            // baseline of the labels
const RULE_Y = 72;
const RULE = 1.6;
const TITLE_TOP = 112;         // where the capitals of the first line stand
const TITLE_MAX = 168;
const TITLE_LINES = 7;
const LEADING = 0.92;
const TRACK = -0.012;          // of the size: display type this big closes up
const DESCENT = 0.22;          // of the size, under the last baseline
const FOOT = COVER_H - 34;     // baseline of the audience's last line
const AUDIENCE_W = MEASURE - 120; // the corner beside it is the colophon's
const COLOPHON = 50;           // height of the motif when it signs the cover beside the audience
const STOP_GAP = 0.2;          // em between the title's last word and the motif that closes it
const DECK = { max: 30, min: 18, lines: 3 };
const DISC = 58;
const MIN_TEXT = 4.5;
const MIN_ACCENT = 1.6;
const SIGN_H = 0.7;            // of the cover's height: the capitals of the figure of « Chiffre », at most
const SIGN_PAD = 14;           // the figure stays this far inside the cover
const SIGN_FOOT = 22;          // its baseline above the foot
const TONE_MAX = 1.7;          // a tone stronger than this against its ground competes with the title
const BLOCK = 1.1;             // the editorial and the figure set their title as a block: lines evened out where the poster stacks them

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** 4.5 reads, 13.5 is as good as type gets on a cover. */
const legible = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - MIN_TEXT) / 9);
/** An accent is seen from 1.4, and pops from 4.4. */
const pops = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - 1.4) / 3);

/** Where a poster's title stands: under the rule, on the optical centre, or on the audience. */
type Anchor = 'top' | 'middle' | 'bottom';

interface Plan {
  composition: number;
  ground: string;              // under the title
  title: string;
  hot: string | null;          // the title's number, in this ink
  deck: string;
  accent: string;              // the motif's ink, or its disc's
  block: string;               // the lower ground of the editorial page; the ground itself elsewhere
  blockText: string;
  tone: string;                // « Chiffre »: the giant figure, a step from the ground
  split: number;               // editorial: share of the height above the block, before the title pushes it down
  anchor: Anchor;
  inline: boolean;             // the motif closes the title, else it signs the foot
  bleed: 1 | -1;               // « Chiffre »: the figure runs off the right edge, or the left
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
const MEASURED = [{ mean: 0.6327, sd: 0.2112 }, { mean: 0.6352, sd: 0.1897 }, { mean: 0.8047, sd: 0.1322 }] as const;
/**
 * Typo sets its title bigger and more ragged than Bauhaus: the cover's other terms (thumbnail, balance) read 1 point lower on
 * the same designs. Its art sits this much over Bauhaus's mean, inside the point the plan allows, so that the cover stays neutral.
 */
const ART_LIFT = 0.7;

/**
 * The strongest step toward `toward` that `inks` still read on, and that stays a tone of the ground: the colour of a giant
 * figure that text may cross.
 */
function toneOf(ground: string, toward: string, inks: readonly string[]): string {
  for (const t of [0.24, 0.2, 0.17, 0.14, 0.11, 0.08, 0.06]) {
    const tone = mix(ground, toward, t);
    if (contrast(tone, ground) <= TONE_MAX && inks.every((k) => contrast(k, tone) >= MIN_TEXT)) return tone;
  }
  return mix(ground, toward, 0.04);
}

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`typo|${seed}|${composition}`));
  const r = Array.from({ length: 8 }, rnd);
  const pick = <T>(xs: readonly T[], k: number): T | undefined => xs[Math.floor(r[k]! * xs.length)];
  const text = [inks.paper, inks.ink];
  const anchor: Anchor = r[4]! < 0.34 ? 'top' : r[4]! < 0.67 ? 'middle' : 'bottom';
  const inline = r[5]! < 0.62;
  const bleed = r[6]! < 0.5 ? 1 : -1;
  const highlight = r[7]! < 0.75;
  const hotOn = (ground: string, title: string): string | null => (highlight ? [inks.c, inks.b, inks.a].find((k) => k !== ground && k !== title && contrast(k, ground) >= MIN_TEXT) ?? null : null);
  const base = { composition, anchor, inline, bleed, split: 1 } as const;
  if (composition === 1) {
    const ground = inks.paper;
    const title = pick([inks.ink, inks.a].filter((k) => contrast(k, ground) >= MIN_TEXT), 0) ?? inks.ink;
    const hot = highlight && title === inks.ink ? ensureContrast(inks.a, ground, MIN_TEXT) : null;
    const block = pick([inks.a, inks.ink, inks.b].filter((k) => contrast(bestOn(k, text), k) >= MIN_TEXT), 1) ?? inks.ink;
    const blockText = bestOn(block, text);
    const accent = pick([inks.c, inks.b, inks.a, inks.paper].filter((k) => k !== block && contrast(k, block) >= MIN_ACCENT), 2) ?? inks.c;
    const split = 0.56 + r[3]! * 0.14;
    const raw = 0.3 * legible(title, ground) + 0.2 * legible(blockText, block) + 0.2 * pops(accent, block) + 0.15 * harmony(block, accent) + 0.15 * clamp01(1 - Math.abs(split - 0.618) / 0.08);
    return { ...base, ground, title, hot, deck: blockText, accent, block, blockText, tone: block, split, raw };
  }
  if (composition === 2) {
    const ground = pick([inks.ink, inks.a, inks.paper, inks.b].filter((k) => contrast(bestOn(k, text), k) >= 7), 0) ?? inks.ink;
    const title = bestOn(ground, text);
    const hot = hotOn(ground, title);
    const deck = hot ?? [inks.c, inks.b, inks.a].find((k) => k !== ground && contrast(k, ground) >= MIN_TEXT) ?? title;
    const accent = pick([inks.c, inks.b, inks.a, inks.paper, inks.ink].filter((k) => k !== ground && contrast(k, ground) >= MIN_ACCENT), 1) ?? title;
    const tone = toneOf(ground, title, [title, deck, ...(hot ? [hot] : [])]);
    const seen = clamp01((contrast(tone, ground) - 1.08) / 0.3);
    const raw = 0.35 * legible(title, ground) + 0.25 * pops(accent, ground) + 0.2 * harmony(accent, ground) + 0.2 * seen;
    return { ...base, ground, title, hot, deck, accent, block: ground, blockText: title, tone, raw };
  }
  const ground = pick([inks.a, inks.ink, inks.b, inks.c].filter((k) => contrast(bestOn(k, text), k) >= MIN_TEXT), 0) ?? inks.ink;
  const title = bestOn(ground, text);
  const hot = hotOn(ground, title);
  const deck = hot ?? [inks.c, inks.b, inks.a].find((k) => k !== ground && contrast(k, ground) >= MIN_TEXT) ?? title;
  const accent = pick([inks.c, inks.b, inks.a, inks.paper, inks.ink].filter((k) => k !== ground && contrast(k, ground) >= MIN_ACCENT), 1) ?? title;
  const raw = 0.45 * legible(title, ground) + 0.3 * pops(accent, ground) + 0.25 * harmony(accent, ground);
  return { ...base, ground, title, hot, deck, accent, block: ground, blockText: title, tone: ground, raw };
}

const artOf = (p: Plan): number => onBauhausScale(p.raw, MEASURED[p.composition] ?? MEASURED[0], ART_LIFT);

// ───────────────────────────── the title ─────────────────────────────

interface Title { size: number; lines: string[]; words: string[][]; cap: number; lead: number; face: FaceName; track: number; widths: number[] }

/** Units a number counts: « 21 jours », « 10 000 € », « 8 semaines ». */
const UNIT_WORD = /^(?:jours?|nuits?|semaines?|mois|ans?|heures?|h|minutes?|min|etapes?|points?|euros?|clients?|fiches?|recettes?|repas|soirs?|seances?|kg|km|pas|questions?|regles?|astuces?|exercices?|m2|m²|€|%)$/;

/** The words of the title's first number and its unit, by their place in the title: they go in the second ink. */
function hotWords(words: readonly string[]): Set<number> {
  const first = words.findIndex((w) => /\d/.test(w));
  const hot = new Set<number>();
  if (first < 0) return hot;
  let k = first;
  while (k < words.length && /\d/.test(words[k]!)) hot.add(k++);
  if (k < words.length && UNIT_WORD.test(normalizeKey(words[k]!).replace(/[,.;:!?)]+$/, ''))) hot.add(k);
  return hot;
}

/** The motif as tall as `cap`, its ink standing on `baseline` from `x`: a sign of the type. */
function onBaseline(shape: Silhouette, x: number, baseline: number, cap: number): Box {
  const b = boundsOf(shape);
  const side = (cap * 1.04) / (b.y1 - b.y0);
  return { x: x - b.x0 * side, y: baseline - b.y1 * side, w: side, h: side };
}

/** How wide the motif stands at a cap height of 1, in em of the title. */
const stopWidth = (shape: Silhouette, capEm: number): number => {
  const b = boundsOf(shape);
  return (capEm * 1.04 * (b.x1 - b.x0)) / (b.y1 - b.y0);
};

/** As big as it goes inside `width` × `height`, capitals up to the top, never under the size that reads at 150 px. */
function fitTitle(c: CoverKit, head: string, width: number, height: number, tail = 0, balance?: number): Title {
  const face = c.v.display;
  const capEm = capHeight(face);
  const fit = posterBreak(sanitizeFor(face, head), face, { width, height, min: minTitleSize(face), max: TITLE_MAX, maxLines: TITLE_LINES, leading: LEADING, cap: capEm, descent: DESCENT, track: TRACK, tail, ...(balance === undefined ? {} : { balance }) });
  const track = TRACK * fit.size;
  return { ...fit, cap: capEm * fit.size, lead: fit.size * LEADING, face, track, widths: fit.lines.map((l) => advance(face, l, fit.size, track)) };
}

/** The title's lines from the top of its capitals, its number in `hot`. Returns the last baseline. */
function setTitle(c: CoverKit, t: Title, x: number, top: number, ink: string, hot: string | null): number {
  const all = t.words.flat();
  const lit = hot ? hotWords(all) : new Set<number>();
  let at = 0;
  let y = top + t.cap;
  t.words.forEach((line, k) => {
    if (k) y += t.lead;
    // runs of words of one ink, side by side on the baseline
    const runs: { words: string[]; hot: boolean }[] = [];
    for (const word of line) {
      const isHot = lit.has(at++);
      const last = runs[runs.length - 1];
      if (last && last.hot === isHot) last.words.push(word);
      else runs.push({ words: [word], hot: isHot });
    }
    let cx = x;
    for (const run of runs) {
      const s = run.words.join(' ');
      c.put(s, cx, y, x + MEASURE - cx, t.face, t.size, run.hot && hot ? hot : ink, { track: t.track });
      cx += advance(t.face, `${s} `, t.size, t.track) + t.track;
    }
  });
  return y;
}

/** The deck's lines from the baseline of its first one. */
function setDeck(c: CoverKit, deck: { lines: string[]; size: number; lineHeight: number }, x: number, first: number, width: number, ink: string): void {
  deck.lines.forEach((l, k) => c.put(l, x, first + k * deck.lineHeight, width, c.v.displayIt, deck.size, ink));
}

/** The motif in its box, its holes and lines cut out in the ink it stands on. */
function sign(s: Scene, d: DesignSpec, box: Box, ink: string, on: string, rot = 0): void {
  drawShape(s, motifShape(d.motif), box, { body: ink, holes: on, lines: on }, { rot });
}

/** The motif signing the cover at the foot, right, on the audience's baseline. */
function colophon(shape: Silhouette): Box {
  const b = boundsOf(shape);
  const side = COLOPHON / (b.y1 - b.y0);
  const w = (b.x1 - b.x0) * side;
  return { x: COVER_W - MARGIN - w - b.x0 * side, y: FOOT + 2 - b.y1 * side, w: side, h: side };
}

/** Labels, rule and the title with its deck under it: the poster's and the figure's. Returns where the motif went and the lines as drawn. */
function headline(c: CoverKit, call: CoverCall, p: Plan, anchor: Anchor, balance?: number): { t: Title; box: Box; inline: boolean; drawn: number[] } {
  const { s, d, v } = c;
  c.labels(LABEL_Y, { ink: p.title });
  s.rect(MARGIN, RULE_Y, MEASURE, RULE, p.title);
  const foot = c.audience(FOOT, AUDIENCE_W, 3, { ink: p.title });
  const deck = c.deck(call.tail, MEASURE, DECK);
  const shape = motifShape(d.motif);
  const capEm = capHeight(v.display);
  const tail = p.inline ? stopWidth(shape, capEm) + STOP_GAP : 0;
  // a colophon keeps its corner: the deck never comes down beside it
  const bottom = p.inline ? foot - 36 : Math.min(foot - 36, FOOT - COLOPHON - 22);
  const deckRoom = deck ? deck.size * 0.8 + (deck.lines.length - 1) * deck.lineHeight + 30 : 0;
  const t = fitTitle(c, call.head, MEASURE, bottom - TITLE_TOP - deckRoom, tail, balance);
  const gap = deck ? DESCENT * t.size + 14 + deck.size * 0.8 : 0;
  const block = t.cap + (t.lines.length - 1) * t.lead + (deck ? gap + (deck.lines.length - 1) * deck.lineHeight : 0);
  const free = Math.max(0, bottom - TITLE_TOP - block);
  const top = TITLE_TOP + (anchor === 'top' ? 0 : anchor === 'middle' ? free * 0.42 : free);
  const last = setTitle(c, t, MARGIN, top, p.title, p.hot);
  if (deck) setDeck(c, deck, MARGIN, last + gap, MEASURE, p.deck);
  const lastW = t.widths[t.widths.length - 1] ?? 0;
  const inline = p.inline && lastW + tail * t.size <= MEASURE + 0.5;
  // the motif that closes the title lengthens its last line
  const drawn = t.widths.map((w, k) => (inline && k === t.widths.length - 1 ? w + tail * t.size : w));
  return { t, box: inline ? onBaseline(shape, MARGIN + lastW + STOP_GAP * t.size, last, t.cap) : colophon(shape), inline, drawn };
}

const artFor = (p: Plan, c: CoverKit, t: Title, drawn: number[], sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: drawn, titleFace: c.v.display, titleInk: p.title, titleGround: p.ground, sticker });

/** « Affiche »: one flat ground to the edges, the title as big as it goes, under the rule, centred or on the audience. */
function poster(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  c.s.rect(0, 0, COVER_W, COVER_H, p.ground);
  const { t, box, inline, drawn } = headline(c, call, p, p.anchor);
  sign(c.s, c.d, box, p.accent, p.ground);
  return artFor(p, c, t, drawn, inline ? { u: 0.82, v: 0.86 } : { u: 0.8, v: 0.8 });
}

/** The title's first number, else its first letter: what « Chiffre » sets huge. A number too long to stand big keeps its first group. */
function figureOf(head: string, tail: string, fits: (s: string) => boolean): string {
  const num = /\d[\d   ]*\d|\d/.exec(`${head} ${tail}`)?.[0]?.replace(/[   ]+/g, ' ').trim();
  if (num) return fits(num) ? num : num.split(' ')[0]!;
  return (/\p{L}/u.exec(head)?.[0] ?? 'G').toLocaleUpperCase('fr-FR');
}

/** « Chiffre »: the title's figure set huge in a tone of the ground, low on the cover and whole, the title over it. */
function figure(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, v } = c;
  s.rect(0, 0, COVER_W, COVER_H, p.ground);
  const face = v.display;
  const capEm = capHeight(face);
  const room = COVER_W - 2 * SIGN_PAD;
  const tall = (SIGN_H * COVER_H) / capEm;
  const sizeFor = (g: string): number => Math.min(tall, room / Math.max(1e-6, advance(face, g, 1, TRACK)));
  const glyphs = sanitizeFor(face, figureOf(call.head, call.tail, (g) => sizeFor(g) >= tall * 0.55));
  const size = sizeFor(glyphs);
  const w = advance(face, glyphs, size, TRACK * size);
  // whole, never cut by an edge: a figure that loses a digit says another number
  const x = p.bleed > 0 ? COVER_W - SIGN_PAD - w : SIGN_PAD;
  const d = outlineD(glyphs, x, COVER_H - SIGN_FOOT, face, size, { track: TRACK * size, features: ['lnum'] });
  if (d) s.path(d, p.tone);
  const { t, box, inline, drawn } = headline(c, call, p, 'top', BLOCK);
  sign(s, c.d, box, p.accent, p.ground);
  return artFor(p, c, t, drawn, inline ? { u: 0.82, v: 0.86 } : { u: 0.8, v: 0.8 });
}

/** « Éditorial »: the title on paper, a block of colour under it for the deck and the audience, the motif in a disc on the cut. */
function editorial(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d } = c;
  c.labels(LABEL_Y, { ink: p.title });
  s.rect(MARGIN, RULE_Y, MEASURE, RULE, p.title);
  const foot = c.audience(FOOT, AUDIENCE_W, 3, { ink: p.blockText });
  const deckW = MEASURE - 2 * DISC - 24;
  const deck = c.deck(call.tail, deckW, DECK);
  const inBlock = 44 + (deck ? deck.height : 0) + 28;
  const lowest = Math.min(foot - inBlock, COVER_H * 0.8);
  const t = fitTitle(c, call.head, MEASURE, lowest - TITLE_TOP - DISC * 0.6 - 14, 0, BLOCK);
  const last = setTitle(c, t, MARGIN, TITLE_TOP, p.title, p.hot);
  // the disc rises over the cut and clears the descenders of the last line; a short title pulls the cut up after it
  const need = last + DESCENT * t.size + DISC * 0.6 + 14;
  const split = Math.round(Math.min(lowest, Math.max(need, Math.min(p.split * COVER_H, need + 130))));
  s.rect(0, split, COVER_W, COVER_H - split, p.block);
  if (deck) setDeck(c, deck, MARGIN, split + 40 + deck.size * 0.8, deckW, p.blockText);
  const cx = COVER_W - MARGIN - DISC;
  s.circle(cx, split, DISC, p.accent);
  const inner = bestOn(p.accent, [p.block, p.title, c.inks.ink, c.inks.paper]);
  drawShape(s, motifShape(d.motif), { x: cx - DISC * 0.6, y: split - DISC * 0.6, w: DISC * 1.2, h: DISC * 1.2 }, { body: inner, holes: p.accent, lines: p.accent });
  return artFor(p, c, t, t.widths, { u: 0.82, v: 0.9 });
}

// ───────────────────────────── plates ─────────────────────────────

/** Tone on tone: the ground, a step toward the ink that stands out from it. */
const toneOn = (ground: string, inks: InkSet): string => mix(ground, bestOn(ground, [inks.paper, inks.ink]), 0.14);

/**
 * A plate: one flat ground, the motif very big and cut by the edge in a tone of that ground, and once more small and sharp
 * where the page wants its figure. The seed and the chapter turn the big one; nothing leaves the rectangle.
 */
function plate(s: Scene, p: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = p;
  const w = cols * u;
  const h = rows * u;
  const rnd = decoRng(hashString(`typo|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 5 }, rnd);
  const grounds = [inks.a, inks.ink, inks.b].filter((k) => contrast(bestOn(k, [inks.paper, inks.ink]), k) >= MIN_TEXT);
  const ground = grounds[Math.floor(r[0]! * grounds.length)] ?? inks.ink;
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  s.path(rect, ground);
  const shape = motifShape(motif);
  s.clip(rect, (cl) => {
    const big = Math.max(h * 1.35, Math.min(w, h) * 1.1);
    const left = r[1]! < 0.5;
    const bx = left ? x - big * 0.28 : x + w - big * 0.72;
    const by = y + h * (0.2 + r[2]! * 0.5) - big / 2;
    drawShape(cl, shape, { x: bx, y: by, w: big, h: big }, { body: toneOn(ground, inks), holes: ground, lines: ground }, { rot: (r[3]! - 0.5) * 40 });
    const pool = [inks.c, inks.b, inks.paper, inks.a].filter((k) => k !== ground && contrast(k, ground) >= 2);
    const ink = pool[Math.floor(r[4]! * pool.length)] ?? inks.paper;
    const side = hero ? hero.s * u * 0.62 : Math.min(h * 0.5, u * 1.2);
    const at = hero ? { x: x + (hero.c + hero.s / 2) * u, y: y + (hero.r + hero.s / 2) * u } : { x: left ? x + w - u : x + u, y: y + h / 2 };
    drawShape(cl, shape, { x: at.x - side / 2, y: at.y - side / 2, w: side, h: side }, { body: ink, holes: ground, lines: ground });
  });
}

export const typo: ArtStyleDef = {
  id: 'typo',
  compositions: [{ id: 'affiche', label: 'Affiche' }, { id: 'editorial', label: 'Éditorial' }, { id: 'chiffre', label: 'Chiffre' }],
  defaultComposition: (d) => hashString(`typo|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? editorial(c, call, p) : call.composition === 2 ? figure(c, call, p) : poster(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
