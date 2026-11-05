/**
 * « Pop » (D200): a neo-brutalist sticker sheet. Thick ink outlines round every shape, hard offset shadows, the palette's
 * inks flat and loud, the motif as a bold outlined illustration, a starburst that says the title's figure, stickers a
 * little off true. Three compositions: the title on a card stuck to a dotted ground, the title on paper over a field of colour
 * with a wavy edge, and the motif as one giant sticker over a banner. Loud and friendly: made for the feed, pets, students
 * and side hustles. The seed picks the grounds, the motif's ink, the sticker's, the turns and the side; the score reads what
 * they give.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, ensureContrast, mix } from '../../color.js';
import { advance, type FaceName } from '../../fonts.js';
import { n, type Scene } from '../../scene.js';
import { decoRng, hashString } from '../../text.js';
import { boundsOf, motifShape, ornament, type Box } from '../shapes.js';
import { bestOn, capHeight, harmony, hueOf, onBauhausScale } from './common.js';
import { artText, burstPts, cardD, clamp01, curveD, deckIn, dotsD, fitTitle, inkBounds, keyFigure, legible, outlined, polyD, polyStrokeD, pops, setDeck, setTitle, tintFor, titleHeight, type Figure, type Title } from './craft.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec, type TextBlock } from './types.js';

const SHADOW = 9;              // the hard shadow's offset
const LINE = 4;                // the outline of cards and stickers
const ART = 5.5;               // the motif's outline
const PAD = 26;                // inside a card
const RADIUS = 22;
const DOT = { step: 22, size: 3.6 };
const LABEL_Y = 56;
const FOOT = COVER_H - 36;     // baseline of the audience's last line
const TITLE_MAX = 88;
const LEADING = 1;
const TRACK = -0.012;
/** A sticker's title leans to a block, its lines evened out where that costs it little size. */
const BALANCE = 0.8;
/** The deck in the voice's text face: a chunky title over a plain one, and a cover that keeps its bytes for its art. */
const DECK = { max: 24, min: 15, lines: 3, leading: 1.24 };
const MIN_TEXT = 4.5;

type Motif = DesignSpec['motif'];

const chroma = (c: string): number => hueOf(c).chroma;

interface Plan {
  composition: number;
  ground: string;                // « Autocollant »: the cover's ground; « Vague »: the field under the wave
  onGround: string;              // text on it
  dots: string;                  // the dots on it, a tone of it
  card: string;                  // the title's ground
  text: string;                  // the title
  hot: string | null;            // « Autocollant »: the title's number in a second ink
  marker: string;                // « Vague »: the highlighter under the number
  fill: string;                  // the motif's body
  burst: string;                 // the starburst
  tilt: number;                  // the card, degrees
  turn: number;                  // the motif, degrees
  left: boolean;                 // the motif on the left
  amp: number;                   // « Vague »: the wave's height
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
/**
 * `lift`: pop sets its titles more ragged than Bauhaus, and the cover's balance term reads 5 points lower on the same designs;
 * its art sits 0.9 over Bauhaus's mean, inside the point the plan allows, so that the cover stays neutral.
 */
const MEASURED = [{ mean: 0.617241, sd: 0.096897, lift: 0.9 }, { mean: 0.656207, sd: 0.106897, lift: 0.9 }, { mean: 0.659138, sd: 0.108276, lift: 0.9 }] as const;

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`pop|${seed}|${composition}`));
  const r = Array.from({ length: 8 }, rnd);
  const pick = <T>(xs: readonly T[], k: number): T | undefined => xs[Math.floor(r[k]! * xs.length)];
  const text2 = [inks.paper, inks.ink];
  // a loud ground that its small text still reads on
  const grounds = [inks.c, inks.b, inks.a].filter((k) => chroma(k) >= 0.25 && contrast(bestOn(k, text2), k) >= MIN_TEXT);
  const ground = pick(grounds, 0) ?? inks.a;
  const onGround = bestOn(ground, text2);
  const dots = mix(ground, onGround, 0.17);
  const card = inks.paper;
  const text = bestOn(card, [inks.ink, inks.a]);
  const hot = r[6]! < 0.75 ? [inks.a, inks.b].map((k) => ensureContrast(k, card, MIN_TEXT)).find((k) => k !== text && contrast(k, text) >= 1.25) ?? null : null;
  const marker = tintFor(inks.paper, contrast(inks.c, inks.paper) >= 1.25 ? inks.c : inks.b, text, 0.75);
  // the motif's ink stands out from the ground, and its ink outline from it
  const fills = [inks.c, inks.b, inks.a, inks.paper].filter((k) => k !== ground && contrast(k, ground) >= 1.5 && contrast(k, inks.ink) >= 2);
  const fill = pick(fills, 1) ?? inks.paper;
  const bursts = [inks.c, inks.paper, inks.b, inks.a].filter((k) => k !== ground && k !== fill && contrast(inks.ink, k) >= MIN_TEXT);
  const burst = pick(bursts, 2) ?? inks.paper;
  const tilt = (r[3]! - 0.5) * 3;
  const turn = (r[4]! - 0.5) * 16;
  const left = r[5]! < 0.35;
  const amp = 10 + r[7]! * 10;
  const loud = clamp01(chroma(ground) / 0.65);
  // the starburst is seen against the card it sits by on « Autocollant », against the ground elsewhere
  const raw = 0.25 * loud + 0.25 * pops(fill, ground) + 0.2 * legible(text, card) + 0.15 * harmony(ground, fill) + 0.15 * pops(burst, composition === 0 ? card : ground);
  return { composition, ground, onGround, dots, card, text, hot, marker, fill, burst, tilt, turn, left, amp, raw };
}

const artOf = (p: Plan): number => {
  const m = MEASURED[p.composition] ?? MEASURED[0];
  return onBauhausScale(p.raw, m, m.lift);
};

// ───────────────────────────── stickers ─────────────────────────────

/** A card with its hard shadow and its outline, turned `tilt` degrees. */
function card(s: Scene, x: number, y: number, w: number, h: number, fill: string, ink: string, tilt: number, r = RADIUS): void {
  s.path(cardD(x + SHADOW, y + SHADOW, w, h, r, tilt), ink);
  s.path(cardD(x, y, w, h, r, tilt), fill, { stroke: ink, sw: LINE });
}

/** Where the motif's ink stands centred in a square box of `side`: its shadow and outline stay inside what it is given. */
function motifBox(motif: Motif, x: number, y: number, side: number): Box {
  const b = boundsOf(motifShape(motif));
  const k = side / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return { x: x + side / 2 - ((b.x0 + b.x1) / 2) * k, y: y + side / 2 - ((b.y0 + b.y1) / 2) * k, w: k, h: k };
}

/** The motif as a sticker: its body in `fill`, holes and lines in ink, a thick outline and a hard shadow. */
function motifSticker(s: Scene, motif: Motif, box: Box, fill: string, ink: string, rot: number, line = ART): void {
  const shadow = SHADOW * (line / ART);
  outlined(s, motifShape(motif), box, { line: ink, w: line, body: fill, holes: ink, lines: ink, lw: line * 0.9, shadow: { dx: shadow, dy: shadow, ink } }, { rot });
}

/** A starburst: its shadow, its fill, its outline round-joined. */
function burst(s: Scene, cx: number, cy: number, r: number, fill: string, ink: string, rot: number, line = LINE): void {
  const points = 16;
  const off = SHADOW * Math.min(1, r / 70);
  s.path(polyD(burstPts(cx + off, cy + off, r, r * 0.84, points, rot)), ink);
  const pts = burstPts(cx, cy, r, r * 0.84, points, rot);
  s.path(polyD(pts), fill);
  s.path(polyStrokeD(pts), undefined, { stroke: ink, sw: line, cap: 'round' });
}

/** The title's figure in the starburst, its unit in small capitals under it, both as art. */
function burstFigure(s: Scene, face: FaceName, label: FaceName, f: Figure, cx: number, cy: number, r: number, ink: string): void {
  const figure = f.sign && f.unit && !f.figure.endsWith(f.unit) ? `${f.figure}${f.unit === '%' ? '' : ' '}${f.unit}` : f.figure;
  const unit = f.unit && !f.sign ? f.unit.toLocaleUpperCase('fr-FR') : '';
  const ref = inkBounds(face, figure, 100);
  const size = Math.min((1.3 * r) / ((ref.x1 - ref.x0) / 100), (r * (unit ? 0.7 : 0.86)) / (-ref.top / 100));
  const b = inkBounds(face, figure, size);
  const uSize = Math.min(17, r * 0.19);
  const uTrack = uSize * 0.12;
  const gap = uSize * 0.55;
  const block = -b.top + (unit ? gap + uSize * capHeight(label) : 0);
  const base = cy - block / 2 - b.top;
  artText(s, figure, cx - (b.x0 + b.x1) / 2, base, face, size, ink);
  if (unit) artText(s, unit, cx - advance(label, unit, uSize, uTrack) / 2, base + gap + uSize * capHeight(label), label, uSize, ink, uTrack);
}

/** A twinkle, outlined: the small stars a sticker sheet is scattered with. */
function twinkle(s: Scene, cx: number, cy: number, size: number, fill: string, ink: string, line: number): void {
  outlined(s, ornament('sparkle'), { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, { line: ink, w: line, body: fill });
}

const deckHeight = (deck: TextBlock | null): number => (deck ? deck.size * 0.76 + (deck.lines.length - 1) * deck.lineHeight + deck.size * 0.25 : 0);

const artFor = (p: Plan, t: Title, ground: string, sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: t.widths, titleFace: t.face, titleInk: p.text, titleGround: ground, sticker });

/**
 * The lower part of the cover, from `top`: the motif as a big sticker on its side, the starburst with the figure over the
 * audience on the other, a couple of twinkles. `on` is the ground under it all.
 */
function lower(c: CoverKit, call: CoverCall, p: Plan, top: number, on: string): void {
  const { s, d, inks, v } = c;
  const ink = inks.ink;
  const room = FOOT - 6 - top;
  const side = Math.max(150, Math.min(330, room - 8, MEASURE * 0.62));
  const mx = p.left ? MARGIN : COVER_W - MARGIN - SHADOW - side;
  const my = top + (room - side) / 2;
  // the other side: the audience at the foot, the figure over it, a sticker that may overlap the motif's edge
  const colW = MEASURE - side - 26;
  const colX = p.left ? COVER_W - MARGIN - colW : MARGIN;
  const audTop = c.audience(FOOT, colW, 3, { x: colX, ink: bestOn(on, [inks.paper, inks.ink]) });
  const fig = keyFigure(call.head, call.tail);
  const space = audTop - 18 - top;
  const r = Math.min(88, colW / 2 + 16, space / 2 - 4);
  const twinkleInk = [inks.paper, inks.c, inks.b].find((k) => k !== on && contrast(k, on) >= 1.4) ?? inks.paper;
  motifSticker(s, d.motif, motifBox(d.motif, mx, my, side), p.fill, ink, p.turn);
  if (fig && r >= 46) {
    const cx = colX + colW / 2 + (p.left ? -10 : 10);
    const cy = top + space / 2 + 4;
    burst(s, cx, cy, r, p.burst, ink, p.turn * -0.8);
    burstFigure(s, v.display, v.labelB, fig, cx, cy, r, ink);
    twinkle(s, p.left ? COVER_W - MARGIN - 14 : MARGIN + 14, top + 4, 30, twinkleInk, ink, 3);
  } else {
    twinkle(s, colX + colW * 0.36, top + space * 0.38, Math.min(70, space * 0.5), twinkleInk, ink, 4);
    twinkle(s, colX + colW * 0.76, top + space * 0.76, Math.min(38, space * 0.3), p.burst === on ? inks.paper : p.burst, ink, 3);
  }
}

// ───────────────────────────── compositions ─────────────────────────────

/** « Autocollant »: a dotted ground of one loud ink, the title on a paper card stuck to it; the motif and the starburst under it. */
function sticker(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, inks, v } = c;
  const x0 = MARGIN;
  const w = MEASURE - SHADOW;
  const inner = w - 2 * PAD;
  const top = 50;
  const titleTop = top + 74;
  const deck = deckIn(c, v.label, call.tail, inner, DECK);
  const deckGap = deck ? 16 : 0;
  const t = fitTitle(call.head, v.display, { width: inner, height: COVER_H * 0.6 - PAD - deckHeight(deck) - deckGap - titleTop, max: TITLE_MAX, leading: LEADING, track: TRACK, balance: BALANCE });
  const bottom = titleTop + titleHeight(t) + deckGap + deckHeight(deck) + PAD;
  s.rect(0, 0, COVER_W, COVER_H, p.ground);
  // no dot under the card: nobody sees them there
  const under = (px: number, py: number): boolean => px > x0 + 10 && px < x0 + w - 4 && py > top + 10 && py < bottom - 4;
  s.path(dotsD(0, 0, COVER_W, COVER_H, DOT.step, under), undefined, { stroke: p.dots, sw: DOT.size, cap: 'round' });
  card(s, x0, top, w, bottom - top, p.card, inks.ink, p.tilt);
  c.labels(top + 36, { ink: p.text, left: x0 + PAD, right: x0 + w - PAD });
  const last = setTitle(c, t, x0 + PAD, titleTop, p.text, { hot: p.hot, width: inner });
  if (deck) setDeck(c, deck, v.label, x0 + PAD, last + t.size * 0.22 + deckGap + deck.size * 0.76, inner, p.hot ?? p.text);
  lower(c, call, p, bottom + SHADOW + 26, p.ground);
  // a price sticker lands on the motif's sticker, never on the card nor on the starburst's figure
  return artFor(p, t, p.card, { u: p.left ? 0.25 : 0.75, v: Math.min(0.9, (bottom + 100) / COVER_H) });
}

/** « Vague »: the title on paper, its number under a highlighter; under it a field of loud ink with a wavy, outlined edge holds the stickers. */
function wave(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, inks, v } = c;
  const ink = inks.ink;
  c.labels(LABEL_Y, { ink: p.text });
  s.rect(MARGIN, LABEL_Y + 12, MEASURE, LINE - 1, ink);
  const top = LABEL_Y + 44;
  const field = COVER_H * 0.38;
  const deck = deckIn(c, v.label, call.tail, MEASURE - 60, DECK);
  const deckGap = deck ? 18 : 0;
  const t = fitTitle(call.head, v.display, { width: MEASURE, height: COVER_H - field - 56 - deckHeight(deck) - deckGap - top, max: 104, leading: 0.98, track: TRACK, balance: BALANCE });
  const last = setTitle(c, t, MARGIN, top, p.text, {
    width: MEASURE,
    mark: (x, base, w) => s.path(cardD(x - 7, base - t.cap * 0.52, w + 14, t.cap * 0.52 + t.size * 0.12, 6, -1), p.marker),
  });
  if (deck) setDeck(c, deck, v.label, MARGIN, last + t.size * 0.22 + deckGap + deck.size * 0.76, MEASURE - 60, p.text);
  const textEnd = top + titleHeight(t) + deckGap + deckHeight(deck);
  const waveY = Math.max(textEnd + 30 + p.amp, COVER_H * 0.5);
  // the wave: a smooth curve through crests and troughs half a period apart, its shadow a lip of ink under it
  const half = 58;
  const crest = (dy: number): [number, number][] => Array.from({ length: Math.ceil((COVER_W + 120) / half) + 1 }, (_, k): [number, number] => [-60 + k * half, waveY + dy + (k % 2 ? p.amp : -p.amp)]);
  const close = `L${COVER_W + 60} ${COVER_H + 20}L-60 ${COVER_H + 20}Z`;
  s.path(`${curveD(crest(SHADOW), false)}${close}`, ink);
  const body = `${curveD(crest(0), false)}${close}`;
  s.path(body, p.ground);
  s.clip(body, (cl) => cl.path(dotsD(0, waveY - p.amp, COVER_W, COVER_H - waveY + p.amp, DOT.step), undefined, { stroke: p.dots, sw: DOT.size, cap: 'round' }));
  s.path(curveD(crest(0), false), undefined, { stroke: ink, sw: LINE + 1, cap: 'round' });
  lower(c, call, p, waveY + p.amp + SHADOW + 20, p.ground);
  return artFor(p, t, inks.paper, { u: p.left ? 0.25 : 0.75, v: Math.min(0.9, (waveY + 100) / COVER_H) });
}

/**
 * « Mascotte »: the motif as one giant sticker on the dotted ground, the starburst with the figure stuck on its shoulder,
 * the title on a paper banner across the foot, the audience under it.
 */
function mascot(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks, v } = c;
  const ink = inks.ink;
  s.rect(0, 0, COVER_W, COVER_H, p.ground);
  c.labels(LABEL_Y, { ink: p.onGround });
  const audTop = c.audience(FOOT, MEASURE, 2, { ink: p.onGround });
  const x0 = MARGIN;
  const w = MEASURE - SHADOW;
  const inner = w - 2 * PAD;
  const deck = deckIn(c, v.label, call.tail, inner, DECK);
  const deckGap = deck ? 14 : 0;
  const t = fitTitle(call.head, v.display, { width: inner, height: COVER_H * 0.42 - 2 * PAD - deckHeight(deck) - deckGap, max: 80, leading: LEADING, track: TRACK, balance: BALANCE });
  const cardH = PAD + titleHeight(t) + deckGap + deckHeight(deck) + PAD - 4;
  const cardTop = audTop - 30 - cardH;
  const zoneTop = LABEL_Y + 26;
  const zoneBottom = cardTop - 18;
  const under = (px: number, py: number): boolean => px > x0 + 10 && px < x0 + w - 4 && py > cardTop + 10 && py < cardTop + cardH - 4;
  s.path(dotsD(0, 0, COVER_W, COVER_H, DOT.step, under), undefined, { stroke: p.dots, sw: DOT.size, cap: 'round' });
  // the mascot: as big as the air over the banner allows, on the side the seed leans to
  const side = Math.max(180, Math.min(430, zoneBottom - zoneTop - 10, MEASURE * 0.84));
  const cx = COVER_W / 2 + (p.left ? -1 : 1) * Math.max(0, (MEASURE - side) / 2 - 20);
  const cy = zoneTop + (zoneBottom - zoneTop) / 2;
  motifSticker(s, d.motif, motifBox(d.motif, cx - side / 2, cy - side / 2, side), p.fill, ink, p.turn * 0.7, ART * 1.15);
  const fig = keyFigure(call.head, call.tail);
  const twinkleInk = [inks.paper, inks.c, inks.b].find((k) => k !== p.ground && contrast(k, p.ground) >= 1.4) ?? inks.paper;
  const far = p.left ? COVER_W - MARGIN - 62 : MARGIN + 62;
  if (fig) {
    const r = Math.min(86, side * 0.24);
    burst(s, far, zoneTop + r + 6, r, p.burst, ink, p.turn * -0.8);
    burstFigure(s, v.display, v.labelB, fig, far, zoneTop + r + 6, r, ink);
    twinkle(s, far + (p.left ? -8 : 8), zoneBottom - 34, 34, twinkleInk, ink, 3);
  } else {
    twinkle(s, far, zoneTop + 50, 64, twinkleInk, ink, 4);
    twinkle(s, far + (p.left ? -26 : 26), zoneBottom - 40, 34, p.burst === p.ground ? inks.paper : p.burst, ink, 3);
  }
  card(s, x0, cardTop, w, cardH, p.card, ink, p.tilt * 0.6);
  const last = setTitle(c, t, x0 + PAD, cardTop + PAD, p.text, { hot: p.hot, width: inner });
  if (deck) setDeck(c, deck, v.label, x0 + PAD, last + t.size * 0.22 + deckGap + deck.size * 0.76, inner, p.hot ?? p.text);
  return artFor(p, t, p.card, { u: cx / COVER_W + (p.left ? 0.12 : -0.12), v: Math.max(0.15, (cy - side * 0.25) / COVER_H) });
}

// ───────────────────────────── plates ─────────────────────────────

/**
 * A plate: a loud dotted ground, a ribbon with a wavy edge across it, the motif as a sticker where the page wants its figure
 * and twinkles on the side it leaves free. The seed picks the inks and the turns; nothing leaves the rectangle.
 */
function plate(s: Scene, p: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = p;
  const w = cols * u;
  const h = rows * u;
  const rnd = decoRng(hashString(`pop|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 6 }, rnd);
  const ink = inks.ink;
  const grounds = [inks.c, inks.b, inks.a].filter((k) => chroma(k) >= 0.25);
  const ground = grounds[Math.floor(r[0]! * grounds.length)] ?? inks.c;
  const others = [inks.c, inks.b, inks.a, inks.paper].filter((k) => k !== ground && contrast(k, ground) >= 1.4);
  const ribbon = others[Math.floor(r[1]! * others.length)] ?? inks.paper;
  const fill = others.find((k) => k !== ribbon && contrast(k, ink) >= 2) ?? inks.paper;
  const scale = Math.min(1, u / 100);
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  s.path(rect, ground);
  s.clip(rect, (cl) => {
    cl.path(dotsD(x, y, w, h, DOT.step * scale * 1.2), undefined, { stroke: mix(ground, bestOn(ground, [inks.paper, ink]), 0.16), sw: DOT.size * scale * 1.2, cap: 'round' });
    // a ribbon across, a third of the way down or up
    const band = Math.min(h * 0.34, u * 1.1);
    const by = y + (r[2]! < 0.5 ? h * 0.3 : h * 0.62) - band / 2;
    const half = u * 0.55;
    const amp = u * 0.09;
    const edge = (y0: number): [number, number][] => Array.from({ length: Math.ceil((w + 4 * half) / half) + 1 }, (_, k): [number, number] => [x - 2 * half + k * half, y0 + (k % 2 ? amp : -amp)]);
    // the ribbon's two edges run parallel: along the top, back along the foot
    const ribbonD = (dy: number): string => {
      const foot = edge(by + band + dy).reverse();
      return `${curveD(edge(by + dy), false)}L${n(foot[0]![0])} ${n(foot[0]![1])}${curveD(foot, false).replace(/^M[^C]*/, '')}Z`;
    };
    cl.path(ribbonD(SHADOW * scale), ink);
    cl.path(ribbonD(0), ribbon, { stroke: ink, sw: LINE * scale });
    // the motif where the page wants its figure, else on the side the seed says, a whole sticker inside the plate
    const side = Math.min(hero ? hero.s * u * 0.76 : u * 1.7, h * 0.74, w * 0.8);
    const want = hero ? { x: x + (hero.c + hero.s / 2) * u, y: y + (hero.r + hero.s / 2) * u } : { x: r[3]! < 0.5 ? x + w - u * 1.2 : x + u * 1.2, y: y + h / 2 };
    // turned up to 9 degrees, a square's corner reaches 0.6 of its side from the centre: the sticker stays whole
    const at = { x: Math.min(x + w - side * 0.62, Math.max(x + side * 0.6, want.x)), y: Math.min(y + h - side * 0.62, Math.max(y + side * 0.6, want.y)) };
    motifSticker(cl, motif, motifBox(motif, at.x - side / 2, at.y - side / 2, side), fill, ink, (r[4]! - 0.5) * 18, ART * scale * Math.max(0.8, side / (2.6 * u)));
    // twinkles where the motif is not: spots of the plate clear of its sticker, the farthest first
    const t1 = Math.min(u * 0.75, h * 0.4);
    const spark = [inks.paper, inks.c, inks.b].find((k) => k !== ground && k !== ribbon && contrast(k, ground) >= 1.4) ?? inks.paper;
    const spots: [number, number][] = [[0.86, 0.3], [0.14, 0.7], [0.86, 0.72], [0.14, 0.28], [0.5, 0.16], [0.62, 0.84]].map(([sx, sy]): [number, number] => [x + w * sx!, y + h * sy!]);
    const clear = spots.filter(([sx, sy]) => Math.hypot(sx - at.x, sy - at.y) > side * 0.62 + t1 * 0.6).sort((a, b) => Math.hypot(b[0] - at.x, b[1] - at.y) - Math.hypot(a[0] - at.x, a[1] - at.y));
    const [first, second] = r[5]! < 0.5 ? [clear[0], clear[1]] : [clear[1], clear[0]];
    if (first) twinkle(cl, first[0], first[1], t1, spark, ink, LINE * scale * 0.8);
    if (second) twinkle(cl, second[0], second[1], t1 * 0.5, spark, ink, LINE * scale * 0.7);
  });
}

export const pop: ArtStyleDef = {
  id: 'pop',
  compositions: [{ id: 'autocollant', label: 'Autocollant' }, { id: 'vague', label: 'Vague' }, { id: 'mascotte', label: 'Mascotte' }],
  defaultComposition: (d) => hashString(`pop|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? wave(c, call, p) : call.composition === 2 ? mascot(c, call, p) : sticker(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
