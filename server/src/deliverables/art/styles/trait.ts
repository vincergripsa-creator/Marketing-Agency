/**
 * « Ligne claire » (D200): the motif drawn as a line illustration of one even weight, its outline and its details, laid in
 * soft flat tints; pastel blobs behind it, a lot of air, the title in the voice's softer display face with a hand-drawn
 * stroke under it, a small dashed path. Three compositions: a vignette over the title, the title over an arched window that
 * holds the drawing, and a page of a dotted journal with the drawing on a taped card. Gentle and reassuring: made for
 * parenting, wellness and the home. The seed picks the tints, the turn of the drawing and where the blobs fall; the score
 * reads what they give.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, ensureContrast, mix } from '../../color.js';
import { n, type Scene } from '../../scene.js';
import { decoRng, hashString } from '../../text.js';
import { boundsOf, drawShape, motifShape, ornament, type Box } from '../shapes.js';
import { bestOn, harmony, onBauhausScale } from './common.js';
import { cardD, clamp01, curveD, deckIn, dotsD, fitTitle, legible, outlined, pops, setDeck, setTitle, titleHeight, type Title } from './craft.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec, type TextBlock } from './types.js';

type Motif = DesignSpec['motif'];

const LINE = 4.2;              // the drawing's one weight, on a motif of about 280
const LABEL_Y = 56;
const FOOT = COVER_H - 38;     // baseline of the audience's last line
const TITLE_MAX = 74;
const LEADING = 1.06;
const TRACK = -0.008;
const DECK = { max: 22, min: 15, lines: 3, leading: 1.3 };
const MIN_TEXT = 4.5;

interface Plan {
  composition: number;
  text: string;                  // title and labels
  muted: string;                 // the deck and the audience: softer, still 4.5 on paper
  hot: string | null;            // the title's number
  line: string;                  // the drawing's ink
  blob: string;                  // the big tint behind the drawing
  blob2: string;                 // a second, smaller one
  blob3: string;                 // a speck
  body: string;                  // the drawing's flat fill
  holes: string;                 // the fill of its holes
  accent: string;                // the hand-drawn stroke, the dashes
  turn: number;                  // the drawing, degrees
  seed: number;                  // the blobs' outlines
  flip: boolean;                 // the second blob on the left
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
/**
 * `lift`: ligne claire sets its title smaller than Bauhaus, in the softer face, and the cover's thumbnail term reads 1.5
 * points lower on the same designs; its art sits 0.9 over Bauhaus's mean, inside the point the plan allows.
 */
const MEASURED = [{ mean: 0.748621, sd: 0.110862, lift: 0.9 }, { mean: 0.745517, sd: 0.112241, lift: 0.9 }, { mean: 0.747414, sd: 0.107759, lift: 0.9 }] as const;

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`trait|${seed}|${composition}`));
  const r = Array.from({ length: 8 }, rnd);
  const paper = inks.paper;
  const colours = [inks.a, inks.b, inks.c];
  const first = Math.floor(r[0]! * 3);
  const second = (first + 1 + Math.floor(r[1]! * 2)) % 3;
  const third = 3 - first - second;
  const tint = 0.18 + r[2]! * 0.16;
  const blob = mix(paper, colours[first]!, tint);
  const blob2 = mix(paper, colours[second]!, tint + 0.12);
  const blob3 = mix(paper, colours[third]!, 0.5);
  const text = bestOn(paper, [inks.ink, inks.a]);
  const muted = ensureContrast(mix(text, paper, 0.22), paper, MIN_TEXT);
  const body = mix(paper, colours[second]!, 0.34 + r[3]! * 0.2);
  const holes = mix(paper, colours[third]!, 0.4);
  const accents = [inks.b, inks.c, inks.a].filter((k) => contrast(k, paper) >= 1.6);
  const accent = accents[Math.floor(r[4]! * accents.length)] ?? inks.a;
  const hot = r[7]! < 0.7 ? [inks.a, inks.b].map((k) => ensureContrast(k, paper, MIN_TEXT)).find((k) => contrast(k, text) >= 1.25) ?? null : null;
  const turn = (r[5]! - 0.5) * 12;
  const flip = r[6]! < 0.5;
  const soft = clamp01(1 - Math.abs(tint - 0.25) / 0.1);
  const raw = 0.3 * legible(text, paper) + 0.2 * harmony(colours[first]!, colours[second]!) + 0.2 * clamp01((contrast(body, blob) - 1) / 0.5) + 0.15 * soft + 0.15 * pops(accent, paper);
  return { composition, text, muted, hot, line: inks.ink, blob, blob2, blob3, body, holes, accent, turn, seed: hashString(`trait|blob|${seed}`), flip, raw };
}

const artOf = (p: Plan): number => {
  const m = MEASURED[p.composition] ?? MEASURED[0];
  return onBauhausScale(p.raw, m, m.lift);
};

// ───────────────────────────── the drawing ─────────────────────────────

/** A blob of tint in a box, its outline from `seed`. */
function blob(s: Scene, box: Box, fill: string, seed: number): void {
  drawShape(s, ornament('blob', seed), box, { body: fill }, { stretch: true });
}

/** The motif's box so that its ink stands centred on (cx, cy), `side` across at its widest. */
function around(motif: Motif, cx: number, cy: number, side: number): Box {
  const b = boundsOf(motifShape(motif));
  const k = side / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return { x: cx - ((b.x0 + b.x1) / 2) * k, y: cy - ((b.y0 + b.y1) / 2) * k, w: k, h: k };
}

/** The motif in ligne claire: flat tints, one even ink line round it, its holes and its details. */
function drawing(s: Scene, motif: Motif, box: Box, p: Plan, rot: number, w = LINE): void {
  outlined(s, motifShape(motif), box, { line: p.line, w, body: p.body, holes: p.holes, holeLine: true, lines: p.line, lw: w }, { rot });
}

/** A twinkle in line, as a draughtsman adds one beside a drawing. */
function twinkle(s: Scene, cx: number, cy: number, size: number, ink: string, fill: string, w: number): void {
  outlined(s, ornament('sparkle'), { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, { line: ink, w: w * 0.8, body: fill });
}

/** A hand-drawn stroke under type: a wave of a few crests, round-ended, slightly uneven. */
function underline(s: Scene, x: number, y: number, width: number, ink: string, seed: number, w = 4): void {
  const rnd = decoRng(seed);
  const crests = Math.max(3, Math.round(width / 34));
  const pts: [number, number][] = Array.from({ length: crests + 1 }, (_, k) => [x + (k * width) / crests, y + (k % 2 ? 3.2 : -3.2) * (0.8 + rnd() * 0.4)]);
  s.path(curveD(pts, false), undefined, { stroke: ink, sw: w, cap: 'round' });
}

/** A small dashed path from (x0, y0) to (x1, y1), bowed to one side: the way a drawing points at what it is about. */
function dashed(s: Scene, x0: number, y0: number, x1: number, y1: number, bow: number, ink: string, w = 2.4): void {
  const [dx, dy] = [x1 - x0, y1 - y0];
  const len = Math.hypot(dx, dy) || 1;
  // the bow's control point, then the quadratic as the cubic both back-ends draw
  const [qx, qy] = [(x0 + x1) / 2 - (dy / len) * bow, (y0 + y1) / 2 + (dx / len) * bow];
  const c1 = [x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0)];
  const c2 = [x1 + (2 / 3) * (qx - x1), y1 + (2 / 3) * (qy - y1)];
  s.path(`M${n(x0)} ${n(y0)}C${n(c1[0]!)} ${n(c1[1]!)} ${n(c2[0]!)} ${n(c2[1]!)} ${n(x1)} ${n(y1)}`, undefined, { stroke: ink, sw: w, cap: 'round', dash: [7, 8] });
}

/**
 * The vignette: a big blob, a second smaller one off its shoulder and a speck, the drawing on them with a soft shadow at
 * its foot, two twinkles. Centred on (cx, cy), `side` the drawing's size.
 */
function vignette(s: Scene, motif: Motif, cx: number, cy: number, side: number, p: Plan, w = LINE, seed = p.seed): void {
  const big = side * 1.42;
  blob(s, { x: cx - big * 0.55, y: cy - big * 0.47, w: big * 1.1, h: big * 0.94 }, p.blob, seed);
  const sm = side * 0.5;
  const sx = p.flip ? cx - big * 0.52 - sm * 0.2 : cx + big * 0.52 - sm * 0.8;
  blob(s, { x: sx, y: cy - big * 0.5, w: sm, h: sm * 0.9 }, p.blob2, seed + 1);
  const sp = side * 0.16;
  blob(s, { x: p.flip ? cx + big * 0.42 : cx - big * 0.5, y: cy + big * 0.3, w: sp, h: sp }, p.blob3, seed + 2);
  s.path(ellipse(cx, cy + side * 0.52, side * 0.38, side * 0.05), mix(p.blob, p.line, 0.1));
  drawing(s, motif, around(motif, cx, cy, side), p, p.turn, w);
  const tw = side * 0.13;
  twinkle(s, p.flip ? cx + side * 0.62 : cx - side * 0.62, cy - side * 0.42, tw, p.line, mix(p.blob2, '#ffffff', 0.3), w * 0.9);
  twinkle(s, p.flip ? cx - side * 0.66 : cx + side * 0.7, cy + side * 0.18, tw * 0.62, p.line, mix(p.blob3, '#ffffff', 0.3), w * 0.8);
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): string => {
  const k = 0.5523;
  return `M${n(cx - rx)} ${n(cy)}C${n(cx - rx)} ${n(cy - ry * k)} ${n(cx - rx * k)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}C${n(cx + rx * k)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ry * k)} ${n(cx + rx)} ${n(cy)}C${n(cx + rx)} ${n(cy + ry * k)} ${n(cx + rx * k)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}C${n(cx - rx * k)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ry * k)} ${n(cx - rx)} ${n(cy)}Z`;
};

// ───────────────────────────── the text ─────────────────────────────

const deckHeight = (deck: TextBlock | null): number => (deck ? deck.size * 0.76 + (deck.lines.length - 1) * deck.lineHeight + deck.size * 0.25 : 0);
const UNDER = 30;              // from the title's last baseline to the hand-drawn stroke, and on to the deck

/** Title, the stroke under it, the deck: from the top of the capitals. Returns the bottom of the block. */
function setText(c: CoverKit, call: CoverCall, p: Plan, t: Title, deck: TextBlock | null, top: number): number {
  const last = setTitle(c, t, MARGIN, top, p.text, { hot: p.hot, width: MEASURE });
  const stroke = last + t.size * 0.24 + 10;
  underline(c.s, MARGIN + 2, stroke, Math.min(150, Math.max(...t.widths) * 0.5), p.accent, p.seed + 7);
  if (!deck) return stroke + 6;
  const first = stroke + UNDER - 10 + deck.size * 0.76;
  setDeck(c, deck, c.v.label, MARGIN, first, MEASURE - 40, p.muted);
  return first + (deck.lines.length - 1) * deck.lineHeight + deck.size * 0.25;
}

const textHeight = (t: Title, deck: TextBlock | null): number => titleHeight(t, 0) + t.size * 0.24 + 10 + (deck ? UNDER - 10 + deckHeight(deck) : 6);

const artFor = (p: Plan, t: Title, ground: string, sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: t.widths, titleFace: t.face, titleInk: p.text, titleGround: ground, sticker });

// ───────────────────────────── compositions ─────────────────────────────

/** « Vignette »: the drawing on its blobs, centred in the upper half with air all round; the title flush left under it. */
function vignetteCover(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks, v } = c;
  c.labels(LABEL_Y, { ink: p.text });
  const audTop = c.audience(FOOT, MEASURE - 60, 3, { ink: p.muted });
  const deck = deckIn(c, v.label, call.tail, MEASURE - 40, DECK);
  const bottom = audTop - 34;
  // the text keeps a little more than the lower half at most: the rest is the vignette's air
  const below = (deck ? UNDER + deckHeight(deck) : 6) + 0.24 * TITLE_MAX + 10;
  const t = fitTitle(call.head, v.deck, { width: MEASURE, height: Math.min(bottom - COVER_H * 0.45, 340) - below, max: TITLE_MAX, leading: LEADING, track: TRACK });
  const top = bottom - textHeight(t, deck);
  setText(c, call, p, t, deck, top);
  // the vignette in the air left above the title
  const zoneTop = LABEL_Y + 30;
  const zoneH = top - 40 - zoneTop;
  const side = Math.max(140, Math.min(300, zoneH * 0.66));
  vignette(s, d.motif, COVER_W / 2, zoneTop + zoneH / 2, side, p);
  return artFor(p, t, inks.paper, { u: 0.8, v: Math.max(0.16, (zoneTop + zoneH * 0.2) / COVER_H) });
}

/** « Fenêtre »: the title at the top; under it an arched window of tint holds the drawing, standing on the foot; the audience beside it. */
function windowCover(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks, v } = c;
  c.labels(LABEL_Y, { ink: p.text });
  const top = LABEL_Y + 52;
  const deck = deckIn(c, v.label, call.tail, MEASURE - 40, DECK);
  const t = fitTitle(call.head, v.deck, { width: MEASURE, height: COVER_H * 0.5 - top - (deck ? UNDER + deckHeight(deck) : 6) - 24, max: TITLE_MAX, leading: LEADING, track: TRACK });
  const end = setText(c, call, p, t, deck, top);
  // the window: as wide as most of the measure, from under the text to the foot, its top a half circle
  const aw = Math.min(330, MEASURE * 0.62);
  const ax = p.flip ? MARGIN : COVER_W - MARGIN - aw;
  const ay = Math.max(end + 40, COVER_H * 0.46);
  const foot = COVER_H - 40;
  const ah = foot - ay;
  const rr = aw / 2;
  const arch = `M${n(ax)} ${n(foot)}L${n(ax)} ${n(ay + rr)}C${n(ax)} ${n(ay + rr * 0.4477)} ${n(ax + rr * 0.4477)} ${n(ay)} ${n(ax + rr)} ${n(ay)}C${n(ax + rr * 1.5523)} ${n(ay)} ${n(ax + aw)} ${n(ay + rr * 0.4477)} ${n(ax + aw)} ${n(ay + rr)}L${n(ax + aw)} ${n(foot)}Z`;
  s.path(arch, p.blob);
  s.path(arch.replace(/Z$/, ''), undefined, { stroke: p.line, sw: LINE * 0.6, cap: 'round' });
  // inside, the drawing stands on a line of ground, a blob speck behind it
  const side = Math.min(aw * 0.72, ah - rr * 0.5);
  const cx = ax + aw / 2;
  const cy = foot - 26 - side / 2;
  s.clip(arch, (cl) => {
    blob(cl, { x: cx - side * 0.62, y: cy - side * 0.5, w: side * 1.24, h: side }, p.blob2, p.seed + 3);
  });
  s.path(ellipse(cx, foot - 22, side * 0.4, side * 0.045), mix(p.blob, p.line, 0.12));
  drawing(s, d.motif, around(d.motif, cx, cy, side), p, p.turn * 0.6);
  twinkle(s, ax + aw * (p.flip ? 0.82 : 0.18), ay + rr * 0.55, aw * 0.08, p.line, mix(p.blob3, '#ffffff', 0.3), LINE * 0.9);
  // beside the window: the audience at the foot, a dashed path from the text to the drawing
  const colW = MEASURE - aw - 28;
  const colX = p.flip ? COVER_W - MARGIN - colW : MARGIN;
  const audTop = c.audience(FOOT, colW, 4, { x: colX, ink: p.muted });
  const fromX = p.flip ? COVER_W - MARGIN - 30 : MARGIN + 30;
  dashed(s, fromX, Math.min(end + 34, audTop - 60), p.flip ? ax + aw + 12 : ax - 12, ay + rr * 0.8, p.flip ? -40 : 40, p.accent);
  return artFor(p, t, inks.paper, { u: p.flip ? 0.25 : 0.75, v: Math.min(0.9, (ay + rr) / COVER_H) });
}

/**
 * « Carnet »: a page of a dotted journal, a card taped on it holds the vignette, a little turned; the title flush left
 * under it with its hand-drawn stroke, the audience at the foot.
 */
function journalCover(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, d, inks, v } = c;
  const paper = inks.paper;
  const step = 24;
  s.path(dotsD(0, 0, COVER_W, COVER_H, step), undefined, { stroke: mix(paper, p.line, 0.16), sw: 2.2, cap: 'round' });
  c.labels(LABEL_Y, { ink: p.text });
  const audTop = c.audience(FOOT, MEASURE - 60, 3, { ink: p.muted });
  const deck = deckIn(c, v.label, call.tail, MEASURE - 40, DECK);
  const bottom = audTop - 30;
  const below = (deck ? UNDER + deckHeight(deck) : 6) + 0.24 * TITLE_MAX + 10;
  const t = fitTitle(call.head, v.deck, { width: MEASURE, height: Math.min(bottom - COVER_H * 0.47, 330) - below, max: TITLE_MAX, leading: LEADING, track: TRACK });
  const top = bottom - textHeight(t, deck);
  setText(c, call, p, t, deck, top);
  // the card: most of the measure, from under the labels to above the title, turned the way the drawing leans
  const cardTop = LABEL_Y + 44;
  const cardBottom = top - 44;
  const cw = Math.min(MEASURE - 40, (cardBottom - cardTop) * 1.18);
  const ch = cardBottom - cardTop;
  const cx = COVER_W / 2 + (p.flip ? -1 : 1) * Math.max(0, (MEASURE - cw) / 2 - 12);
  const tilt = p.turn > 0 ? 2.2 : -2.2;
  const face = mix(paper, '#ffffff', 0.55);
  const cardPath = cardD(cx - cw / 2, cardTop, cw, ch, 14, tilt);
  s.path(cardD(cx - cw / 2 + 5, cardTop + 7, cw, ch, 14, tilt), mix(paper, p.line, 0.12));
  s.path(cardPath, face, { stroke: p.line, sw: 1.6 });
  s.clip(cardPath, (cl) => vignette(cl, d.motif, cx, cardTop + ch * 0.52, Math.min(ch * 0.58, cw * 0.5), { ...p, flip: !p.flip }));
  // the tape that holds it, across its top edge
  const tape = ornament('tape');
  const tw = Math.min(150, cw * 0.4);
  drawShape(s, tape, { x: cx - tw / 2 + (p.flip ? 30 : -30), y: cardTop - tw * 0.2, w: tw, h: tw * 0.4 }, { body: mix(paper, p.accent, 0.42) }, { rot: -tilt * 3, stretch: true });
  return artFor(p, t, paper, { u: p.flip ? 0.22 : 0.78, v: Math.max(0.16, (cardTop + 40) / COVER_H) });
}

// ───────────────────────────── plates ─────────────────────────────

/**
 * A plate: a soft tint of paper crossed by a hand-drawn line of ground, the vignette where the page wants its figure, and in
 * the air on its other side a dashed path to a twinkle. The drawing is pulled clear of the edges; nothing leaves the rectangle.
 */
function plate(s: Scene, p: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = p;
  const w = cols * u;
  const h = rows * u;
  const rnd = decoRng(hashString(`trait|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 4 }, rnd);
  const plan = planOf(inks, seed + Math.floor(r[0]! * 7), 0);
  const ground = mix(inks.paper, inks.a, 0.06);
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  s.path(rect, ground);
  s.clip(rect, (cl) => {
    const side = hero ? Math.min(hero.s * u * 0.62, h * 0.7) : Math.min(h * 0.68, u * 1.6);
    const at = hero ? { x: x + (hero.c + hero.s / 2) * u, y: y + (hero.r + hero.s / 2) * u } : { x: r[1]! < 0.5 ? x + w * 0.26 : x + w * 0.74, y: y + h / 2 };
    // what the page wished, pulled inside the plate with its blobs
    const cx = Math.min(x + w - side * 0.85, Math.max(x + side * 0.85, at.x));
    const cy = Math.min(y + h - side * 0.66, Math.max(y + side * 0.7, at.y));
    const scale = Math.max(0.45, side / 280);
    // the ground the drawing stands on, drawn freehand across the plate
    const gy = cy + side * 0.52;
    const lean = decoRng(hashString(`trait|ground|${seed}`));
    const pts = Array.from({ length: 7 }, (_, k): [number, number] => [x - 10 + ((w + 20) * k) / 6, gy + (lean() - 0.5) * side * 0.06]);
    cl.path(curveD(pts, false), undefined, { stroke: mix(ground, plan.line, 0.22), sw: Math.max(1, 2 * scale), cap: 'round' });
    vignette(cl, motif, cx, cy, side, plan, Math.max(1.4, LINE * scale), plan.seed + (hero?.pick ?? 0));
    const other = cx < x + w / 2 ? 1 : -1;
    const ox = cx + other * Math.min(w * 0.36, side * 1.7);
    if (ox > x + side * 0.25 && ox < x + w - side * 0.25) {
      dashed(cl, cx + other * side * 0.86, cy + side * 0.2, ox, cy - side * 0.28, other * side * 0.32, plan.accent, Math.max(1.1, 2.4 * scale));
      twinkle(cl, ox + other * side * 0.1, cy - side * 0.4, side * 0.17, plan.line, mix(plan.blob3, '#ffffff', 0.3), Math.max(1.3, LINE * scale));
    }
    // a tall plate, a film's, has air over the drawing: a second vignette, smaller, higher, on the other side
    if (h > w * 1.2) {
      const up = Math.min(side * 0.7, w * 0.36);
      vignette(cl, motif, x + (other > 0 ? w * 0.7 : w * 0.3), y + h * 0.3, up, { ...plan, flip: !plan.flip, turn: -plan.turn }, Math.max(1.2, LINE * scale * 0.8), plan.seed + 11);
    }
  });
}

export const trait: ArtStyleDef = {
  id: 'trait',
  compositions: [{ id: 'vignette', label: 'Vignette' }, { id: 'fenetre', label: 'Fenêtre' }, { id: 'carnet', label: 'Carnet' }],
  defaultComposition: (d) => hashString(`trait|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? windowCover(c, call, p) : call.composition === 2 ? journalCover(c, call, p) : vignetteCover(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
