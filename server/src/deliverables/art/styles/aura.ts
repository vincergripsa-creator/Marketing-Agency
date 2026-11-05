/**
 * « Aura » (D200): soft halos of the palette's inks fading to nothing, overlapping like an aurora, a fine grain over them, and
 * a frosted card that holds the title; the motif as a small glossy sphere. Three compositions: the halos over the page and
 * the card low, a luminous orb with the card under it, the aurora on a night ground. The card is as clear as the words let
 * it be: its opacity is solved on the colours really under it, so the title always reads at 4.5:1. The seed places the
 * halos, orders their inks and sizes the orb; the score reads how calm and how luminous that leaves the page.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, mix } from '../../color.js';
import { circleD, ellipseD, linear, n, radial, type GradientStop, type Paint, type Scene } from '../../scene.js';
import { decoRng, hashString } from '../../text.js';
import { drawShape, motifShape } from '../shapes.js';
import { harmony, hueOf, onBauhausScale } from './common.js';
import { DOT_BYTES, speckle, type Rnd } from './paper.js';
import { blockHeight, deckBytes, drawnBytes, fitHead, headBytes, kitBytes, setDeck, setHead, SVG_LIMIT, type Fitted } from './setting.js';
import { COVER_H, COVER_W, MARGIN, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec } from './types.js';

const LABEL_Y = 58;
const FOOT = COVER_H - 34;
const LEADING = 1;
const TRACK = -0.006;
const DESCENT = 0.22;
const DECK = { max: 25, min: 16, lines: 3 };
const MIN_TEXT = 4.6;           // a hair over 4.5: the composite under a card is sampled, not integrated
const CARD_R = 26;              // the card's corners, as the page's
const CARD_X = 26;
const CARD_PAD = 30;
const INNER = COVER_W - 2 * CARD_X - 2 * CARD_PAD; // the measure inside the card
const GLASS_MIN = 0.5;
const GLASS_MAX = 0.97;
const WHITE = '#ffffff';
const SPECK = 0.42;             // the grain: white specks at this opacity, dark ones far fainter
const DUST = 0.07;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const near = (v: number, ideal: number, span: number): number => clamp01(1 - Math.abs(v - ideal) / span);

/** A halo: a disc of `color` at `alpha` in its middle, fading to nothing at `r`, lit from its focus. */
interface Halo { cx: number; cy: number; r: number; color: string; alpha: number; fx: number; fy: number }

/** How a halo fades, offset and share of its alpha: close to a bell, so that no ring shows. */
const FADE: readonly [number, number][] = [[0, 1], [0.22, 0.86], [0.45, 0.55], [0.68, 0.24], [0.86, 0.06], [1, 0]];

const stopsOf = (color: string, alpha: number): GradientStop[] => FADE.map(([offset, share]) => ({ offset, color, opacity: Math.round(alpha * share * 1000) / 1000 }));

const paintOf = (h: Halo): Paint => radial(h.cx, h.cy, h.r, stopsOf(h.color, h.alpha), { fx: h.fx, fy: h.fy });

const drawHalo = (s: Scene, h: Halo): void => void s.path(circleD(h.cx, h.cy, h.r), paintOf(h));

/** Where (x, y) falls on a radial gradient with a focus: the circle through it, as a share of the outer one. */
function focalT(h: Halo, x: number, y: number): number {
  const [dx, dy] = [x - h.fx, y - h.fy];
  const [ex, ey] = [h.cx - h.fx, h.cy - h.fy];
  const a = ex * ex + ey * ey - h.r * h.r;
  const b = dx * ex + dy * ey;
  const c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-9) return Math.sqrt(c) / h.r;
  return (b - Math.sqrt(Math.max(0, b * b - a * c))) / a;
}

/** The alpha a halo lays at (x, y). */
function alphaAt(h: Halo, x: number, y: number): number {
  if ((x - h.cx) ** 2 + (y - h.cy) ** 2 >= h.r * h.r) return 0;
  const t = clamp01(focalT(h, x, y));
  for (let k = 1; k < FADE.length; k++) {
    const [o1, s1] = FADE[k]!;
    const [o0, s0] = FADE[k - 1]!;
    if (t <= o1) return h.alpha * (s0 + ((t - o0) / (o1 - o0)) * (s1 - s0));
  }
  return 0;
}

/** What the eye gets at (x, y): the ground, then each halo over it in the order drawn. */
const colourAt = (ground: (x: number, y: number) => string, halos: readonly Halo[], x: number, y: number): string =>
  halos.reduce((c, h) => mix(c, h.color, alphaAt(h, x, y)), ground(x, y));

/** A grid of points over a box: where a card's text may stand. */
function samples(x: number, y: number, w: number, h: number, cols = 7, rows = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push([x + (w * (i + 0.5)) / cols, y + (h * (j + 0.5)) / rows]);
  return out;
}

/**
 * The least opacity at which `glass` over what lies under the points lets `text` read at `MIN_TEXT`, and the colour the text
 * then stands on where it reads worst.
 */
function frost(under: readonly string[], glass: string, text: string, from = GLASS_MIN): { alpha: number; worst: string } {
  for (let alpha = from; ; alpha = Math.min(GLASS_MAX, alpha + 0.02)) {
    const tints = under.map((u) => mix(u, glass, alpha));
    const worst = tints.reduce((w, t) => (contrast(text, t) < contrast(text, w) ? t : w), tints[0] ?? glass);
    if (contrast(text, worst) >= MIN_TEXT || alpha >= GLASS_MAX) return { alpha: Math.round(alpha * 100) / 100, worst };
  }
}

/** A rounded rectangle, absolute M L C Z. */
function roundD(x: number, y: number, w: number, h: number, r: number): string {
  const c = r * 0.4477;
  return `M${n(x + r)} ${n(y)}L${n(x + w - r)} ${n(y)}C${n(x + w - c)} ${n(y)} ${n(x + w)} ${n(y + c)} ${n(x + w)} ${n(y + r)}L${n(x + w)} ${n(y + h - r)}C${n(x + w)} ${n(y + h - c)} ${n(x + w - c)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}L${n(x + r)} ${n(y + h)}C${n(x + c)} ${n(y + h)} ${n(x)} ${n(y + h - c)} ${n(x)} ${n(y + h - r)}L${n(x)} ${n(y + r)}C${n(x)} ${n(y + c)} ${n(x + c)} ${n(y)} ${n(x + r)} ${n(y)}Z`;
}

/** The frosted card: a soft shadow on a light page, the glass, its bright rim. */
function card(s: Scene, x: number, y: number, w: number, h: number, glass: string, alpha: number, o: { shadow: string | null; rim: number }): void {
  if (o.shadow) for (const [grow, drop, op] of [[14, 16, 0.035], [8, 10, 0.04], [3, 5, 0.045]] as const) s.path(roundD(x - grow, y - grow + drop, w + 2 * grow, h + 2 * grow, CARD_R + grow), o.shadow, { op });
  s.path(roundD(x, y, w, h, CARD_R), glass, { op: alpha });
  // the light catches its upper edge more than the lower
  s.path(roundD(x + 0.6, y + 0.6, w - 1.2, h - 1.2, CARD_R - 0.6), undefined, { stroke: WHITE, sw: 1.2, op: o.rim });
  s.path(`M${n(x + CARD_R)} ${n(y + 1.4)}L${n(x + w - CARD_R)} ${n(y + 1.4)}`, undefined, { stroke: WHITE, sw: 1.6, op: Math.min(1, o.rim + 0.15), cap: 'round' });
}

/** The motif on a glossy sphere of `color`, lit from the top left: the halos' own light made solid. */
function orb(s: Scene, inks: InkSet, motif: DesignSpec['motif'], cx: number, cy: number, r: number, color: string, shadow: boolean): void {
  if (shadow) s.path(ellipseD(cx + r * 0.06, cy + r * 1.02, r * 0.86, r * 0.2), radial(cx + r * 0.06, cy + r * 1.02, r * 0.86, [{ offset: 0, color: inks.ink, opacity: 0.22 }, { offset: 1, color: inks.ink, opacity: 0 }]));
  const lit = radial(cx, cy, r, [{ offset: 0, color: mix(color, WHITE, 0.6) }, { offset: 0.5, color }, { offset: 1, color: mix(color, inks.ink, 0.32) }], { fx: cx - r * 0.34, fy: cy - r * 0.4 });
  s.path(circleD(cx, cy, r), lit);
  const sign = contrast(WHITE, color) >= 2.2 ? WHITE : inks.ink;
  const side = r * 1.12;
  drawShape(s, motifShape(motif), { x: cx - side / 2, y: cy - side / 2, w: side, h: side }, { body: sign, holes: lit, lines: color, op: 0.94 });
  s.path(ellipseD(cx - r * 0.36, cy - r * 0.5, r * 0.3, r * 0.14, -30), radial(cx - r * 0.36, cy - r * 0.5, r * 0.3, [{ offset: 0, color: WHITE, opacity: 0.5 }, { offset: 1, color: WHITE, opacity: 0 }]));
}

/** The grain over a box, as many specks as `room` bytes allow up to `count`: white ones, and a dust of the ink. */
function grain(s: Scene, rnd: Rnd, ink: string, box: { x: number; y: number; w: number; h: number }, count: number, k: number, room = Infinity, dark = false): void {
  const fit = Math.max(0, Math.min(count, Math.floor(room / DOT_BYTES)));
  speckle(rnd, box, Math.round(fit * (dark ? 0.85 : 0.7)), 1.05 * k).draw(s, WHITE, dark ? SPECK * 0.8 : SPECK);
  if (!dark) speckle(rnd, box, Math.round(fit * 0.3), 0.95 * k).draw(s, ink, DUST);
}

// ───────────────────────────── the plan ─────────────────────────────

interface Plan {
  composition: number;
  ground: (x: number, y: number) => string;
  groundPaint: Paint | null;     // the night's ground; the paper else
  halos: Halo[];
  text: string;                  // the ink of every word
  glass: string;
  orbColor: string;
  orbSide: 1 | -1;
  orbR: number;
  dark: boolean;
  alpha: number;                 // the glass a card of the nominal size needs: what the score reads
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
const MEASURED = [{ mean: 0.7207, sd: 0.0817 }, { mean: 0.6892, sd: 0.0825 }, { mean: 0.6977, sd: 0.0766 }] as const;
/** Aura sets its title inside a card, smaller than Bauhaus's on long titles: the art sits this much over Bauhaus's mean. */
const ART_LIFT = 0.6;

/** A luminous mix: how much colour a halo field gives the eye, 0..1. */
const glowOf = (cs: readonly string[]): number => cs.reduce((a, c) => a + hueOf(c).chroma, 0) / Math.max(1, cs.length);

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`aura|${seed}|${composition}`));
  const r = Array.from({ length: 16 }, rnd);
  const order = [[inks.a, inks.b, inks.c], [inks.b, inks.c, inks.a], [inks.c, inks.a, inks.b], [inks.a, inks.c, inks.b], [inks.b, inks.a, inks.c], [inks.c, inks.b, inks.a]][Math.floor(r[0]! * 6)]!;
  const [h1, h2, h3] = order as [string, string, string];
  const side: 1 | -1 = r[1]! < 0.5 ? 1 : -1;
  const X = (v: number) => (side > 0 ? v : COVER_W - v);
  const at = (k: number, span: number) => (r[k]! - 0.5) * span;
  const halo = (cx: number, cy: number, rr: number, color: string, alpha: number): Halo => ({ cx, cy, r: rr, color, alpha, fx: cx - rr * 0.16, fy: cy - rr * 0.18 });
  const spheres = [inks.a, inks.b, inks.c].filter((k) => contrast(k, inks.paper) >= 1.6);
  const orbColor = spheres[Math.floor(r[2]! * spheres.length)] ?? inks.a;
  if (composition === 2) {
    // the night: a deep ground, the aurora across its upper half, the card of dark glass
    const top = mix(inks.ink, '#000000', 0.18);
    const low = mix(inks.ink, inks.a, 0.38);
    const ground = (_x: number, y: number) => mix(top, low, clamp01(y / COVER_H));
    const bright = [inks.c, inks.b, inks.a].sort((p, q) => contrast(q, inks.ink) - contrast(p, inks.ink));
    const halos = [
      halo(X(110 + at(3, 80)), 520 + at(4, 90), 330, inks.a, 0.75),
      halo(X(300 + at(5, 90)), 330 + at(6, 80), 300, bright[1]!, 0.62),
      halo(X(500 + at(7, 70)), 150 + at(8, 80), 280, bright[0]!, 0.7),
      halo(X(420 + at(9, 100)), 560 + at(10, 80), 220, h2, 0.42),
    ];
    const text = inks.paper;
    const glass = mix(inks.ink, '#000000', 0.25);
    const under = samples(CARD_X + CARD_PAD, 460, INNER, 300).map(([x, y]) => colourAt(ground, halos, x, y));
    const { alpha } = frost(under, glass, text, 0.35);
    const sky = samples(40, 90, 520, 380, 5, 4).map(([x, y]) => colourAt(ground, halos, x, y));
    const orbR = 46 + r[12]! * 10;
    const raw = 0.3 * near(alpha, 0.35, 0.6) + 0.3 * clamp01(glowOf(sky) / 0.5) + 0.2 * harmony(bright[0]!, bright[1]!) + 0.2 * near(orbR, 51, 6) * clamp01((contrast(bright[0]!, inks.ink) - 1.5) / 4);
    return { composition, ground, groundPaint: linear(0, 0, 0, COVER_H, [{ offset: 0, color: top }, { offset: 1, color: low }]), halos, text, glass, orbColor: bright[0]!, orbSide: side, orbR, dark: true, alpha, raw };
  }
  const ground = () => inks.paper;
  const text = inks.ink;
  const glass = mix(inks.paper, WHITE, 0.62);
  if (composition === 1) {
    // the orb: one luminous sphere in its glow, the card under it
    const halos = [
      halo(300 + at(3, 60), 300 + at(4, 50), 340, h1, 0.62),
      halo(X(120 + at(5, 60)), 120 + at(6, 60), 260, h2, 0.5),
      halo(X(500 + at(7, 60)), 560 + at(8, 80), 300, h3, 0.46),
    ];
    const under = samples(CARD_X + CARD_PAD, 520, INNER, 260).map(([x, y]) => colourAt(ground, halos, x, y));
    const { alpha } = frost(under, glass, text);
    const sky = samples(60, 90, 480, 400, 5, 4).map(([x, y]) => colourAt(ground, halos, x, y));
    const orbR = 128 + r[12]! * 28;
    const raw = 0.3 * near(alpha, GLASS_MIN, 0.46) + 0.25 * clamp01(glowOf(sky) / 0.35) + 0.25 * harmony(h1, h2) + 0.2 * near(orbR, 142, 14) * clamp01((contrast(h1, inks.paper) - 1.2) / 3);
    return { composition, ground, groundPaint: null, halos, text, glass, orbColor: h1, orbSide: side, orbR, dark: false, alpha, raw };
  }
  // the halos over the page, the card low
  const halos = [
    halo(X(120 + at(3, 120)), 170 + at(4, 120), 340, h1, 0.6),
    halo(X(520 + at(5, 80)), 380 + at(6, 120), 310, h2, 0.58),
    halo(X(470 + at(7, 80)), 80 + at(8, 60), 230, h3, 0.7),
    halo(X(90 + at(9, 80)), 690 + at(10, 80), 280, h3, 0.42),
  ];
  const under = samples(CARD_X + CARD_PAD, 480, INNER, 300).map(([x, y]) => colourAt(ground, halos, x, y));
  const { alpha } = frost(under, glass, text);
  const sky = samples(40, 90, 520, 340, 5, 4).map(([x, y]) => colourAt(ground, halos, x, y));
  const orbR = 46 + r[12]! * 10;
  const raw = 0.3 * near(alpha, GLASS_MIN, 0.46) + 0.25 * clamp01(glowOf(sky) / 0.35) + 0.25 * harmony(h1, h2) + 0.2 * harmony(h2, h3) * near(orbR, 51, 6);
  return { composition, ground, groundPaint: null, halos, text, glass, orbColor, orbSide: side, orbR, dark: false, alpha, raw };
}

const artOf = (p: Plan): number => onBauhausScale(p.raw, MEASURED[p.composition] ?? MEASURED[0], ART_LIFT);

// ───────────────────────────── covers ─────────────────────────────

/** The ink a line of small text takes where it stands: the plan's if it reads there, else the other end of the palette. */
function textAt(p: Plan, inks: InkSet, pts: readonly [number, number][]): string {
  const under = pts.map(([x, y]) => colourAt(p.ground, p.halos, x, y));
  const worst = (ink: string) => Math.min(...under.map((u) => contrast(ink, u)));
  return [p.text, p.dark ? inks.ink : inks.paper].sort((a, b) => worst(b) - worst(a))[0]!;
}

interface Words { t: Fitted; deck: ReturnType<CoverKit['deck']>; gap: number; block: number }

function fitWords(c: CoverKit, call: CoverCall, width: number, height: number, max: number): Words {
  const deck = c.deck(call.tail, width, DECK);
  const deckRoom = deck ? deck.size * 0.8 + (deck.lines.length - 1) * deck.lineHeight + 24 : 0;
  const t = fitHead(c.v.display, call.head, { width, height: height - deckRoom, max, leading: LEADING, descent: DESCENT, track: TRACK, balance: 1 });
  const gap = deck ? DESCENT * t.size + 12 + deck.size * 0.8 : 0;
  const block = blockHeight(t) + (deck ? gap + (deck.lines.length - 1) * deck.lineHeight + deck.size * 0.25 : DESCENT * t.size);
  return { t, deck, gap, block };
}

/** The card's opacity on what really lies under its text, and the colour the title stands on where it reads worst. */
function solve(p: Plan, halos: readonly Halo[], x: number, y: number, w: number, h: number, solid: (x: number, y: number) => string | null = () => null): { alpha: number; worst: string } {
  const under = samples(x, y, w, h, 9, 7).map(([px, py]) => solid(px, py) ?? colourAt(p.ground, halos, px, py));
  return frost(under, p.glass, p.text, p.dark ? 0.35 : GLASS_MIN);
}

/** Bytes the card and the orb take, drawn after the grain: what the grain leaves them. */
const CARD_BYTES = 9000;

const artFor = (p: Plan, t: Fitted, ground: string, sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: t.widths, titleFace: t.face, titleInk: p.text, titleGround: ground, sticker });

const roomLeft = (c: CoverKit, words: number): number => SVG_LIMIT - kitBytes(c) - words - drawnBytes(c);

/** « Halo » and « Nuit »: the halos over the page, the card low with every word in it, the orb on its rim. */
function low(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, inks } = c;
  if (p.groundPaint) s.rect(0, 0, COVER_W, COVER_H, p.groundPaint);
  for (const h of p.halos) drawHalo(s, h);
  const x = CARD_X + CARD_PAD;
  const bottom = FOOT - 4;
  const foot = c.audience(bottom - 26, INNER, 3, { x, ink: p.text });
  const w = fitWords(c, call, INNER, 330, p.dark ? 84 : 90);
  const top = foot - 24 - w.block;
  const cardTop = top - CARD_PAD - 10;
  const last = setHead(c, w.t, x, top, p.text, { width: INNER }).at(-1)!;
  if (w.deck) setDeck(c, w.deck, x, last + w.gap, p.text, { width: INNER });
  const words = headBytes(w.t, x, top) + deckBytes(c, w.deck, x, last + w.gap);
  c.labels(LABEL_Y, { ink: textAt(p, inks, [[50, 52], [130, 52], [470, 52], [550, 52]]) });
  grain(s, decoRng(hashString(`aura|grain|${call.seed}`)), inks.ink, { x: 0, y: 0, w: COVER_W, h: COVER_H }, 1500, 1, roomLeft(c, words) - CARD_BYTES, p.dark);
  const { alpha, worst } = solve(p, p.halos, x, top, INNER, bottom - top - 10);
  card(s, CARD_X, cardTop, COVER_W - 2 * CARD_X, bottom - cardTop + 8, p.glass, alpha, { shadow: p.dark ? null : inks.ink, rim: p.dark ? 0.22 : 0.85 });
  // the orb floats over the card, on the line of its words, never on them; the more sky, the bigger it grows
  const or = Math.max(p.orbR * 0.8, Math.min(p.orbR * 1.5, (cardTop - LABEL_Y - 60) * 0.2));
  const ox = p.orbSide > 0 ? COVER_W - x - or : x + or;
  orb(s, inks, c.d.motif, ox, Math.max(LABEL_Y + 28 + or, cardTop - or - 20), or, p.orbColor, !p.dark);
  return artFor(p, w.t, worst, { u: p.orbSide > 0 ? 0.2 : 0.8, v: 0.2 });
}

/** « Orbe »: one luminous sphere in its glow, the motif on it, the card under it with the title centred. */
function orbe(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { s, inks } = c;
  const x = CARD_X + CARD_PAD;
  const bottom = FOOT - 4;
  const foot = c.audience(bottom - 26, INNER, 3, { x, ink: p.text });
  const w = fitWords(c, call, INNER, 300, 80);
  const top = foot - 24 - w.block;
  const cardTop = top - CARD_PAD - 6;
  // the sphere stands over the card, as big as the room above it allows, and its glow goes with it
  const r = Math.max(70, Math.min(p.orbR, (cardTop - 96) / 2 + 30));
  const cy = Math.min(300, cardTop - r + 46);
  const cx = p.halos[0]!.cx;
  const glow = p.halos[0]!;
  const halos = [{ ...glow, cy, fy: cy - glow.r * 0.18 }, ...p.halos.slice(1)];
  for (const h of halos) drawHalo(s, h);
  const mid = COVER_W / 2;
  const last = setHead(c, w.t, mid, top, p.text, { center: true, width: INNER }).at(-1)!;
  if (w.deck) setDeck(c, w.deck, mid, last + w.gap, p.text, { center: true, width: INNER });
  const words = headBytes(w.t, x, top) + deckBytes(c, w.deck, x, last + w.gap);
  c.labels(LABEL_Y, { ink: textAt({ ...p, halos }, inks, [[50, 52], [130, 52], [470, 52], [550, 52]]) });
  orb(s, inks, c.d.motif, cx, cy, r, p.orbColor, false);
  grain(s, decoRng(hashString(`aura|grain|${call.seed}`)), inks.ink, { x: 0, y: 0, w: COVER_W, h: COVER_H }, 1500, 1, roomLeft(c, words) - CARD_BYTES);
  // the sphere may run under the card: its colours count under the words too, its darkest rim as the worst
  const sphere = (px: number, py: number) => ((px - cx) ** 2 + (py - cy) ** 2 < (r + 2) ** 2 ? mix(p.orbColor, inks.ink, 0.32) : null);
  const { alpha, worst } = solve(p, halos, x, top, INNER, bottom - top - 10, sphere);
  card(s, CARD_X, cardTop, COVER_W - 2 * CARD_X, bottom - cardTop + 8, p.glass, alpha, { shadow: inks.ink, rim: 0.85 });
  return artFor(p, w.t, worst, { u: 0.8, v: 0.16 });
}

// ───────────────────────────── plates ─────────────────────────────

/** A plate: paper, three or four halos, the grain, and the glossy sphere where the page wants its figure. */
function plate(s: Scene, p: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = p;
  const w = cols * u;
  const hh = rows * u;
  const rnd = decoRng(hashString(`aura|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 10 }, rnd);
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(hh)}h${n(-w)}Z`;
  s.path(rect, inks.paper);
  const order = [[inks.a, inks.b, inks.c], [inks.b, inks.c, inks.a], [inks.c, inks.a, inks.b]][Math.floor(r[0]! * 3)]!;
  const big = Math.max(w, hh);
  const small = Math.min(w, hh);
  s.clip(rect, (cl) => {
    const spots: [number, number, number, number][] = [
      [x + w * (0.1 + r[1]! * 0.25), y + hh * (0.15 + r[2]! * 0.3), Math.max(small * 1.1, big * 0.55), 0.6],
      [x + w * (0.55 + r[3]! * 0.35), y + hh * (0.4 + r[4]! * 0.4), Math.max(small * 1.0, big * 0.5), 0.56],
      [x + w * (0.4 + r[5]! * 0.3), y + hh * (r[6]! * 0.3), Math.max(small * 0.8, big * 0.36), 0.66],
      [x + w * (r[7]! * 0.4), y + hh * (0.7 + r[8]! * 0.3), Math.max(small * 0.9, big * 0.42), 0.42],
    ];
    spots.forEach(([cx, cy, rr, alpha], k) => drawHalo(cl, { cx, cy, r: rr, color: order[k % 3]!, alpha, fx: cx - rr * 0.16, fy: cy - rr * 0.18 }));
    grain(cl, rnd, inks.ink, { x, y, w, h: hh }, Math.round(((w * hh) / (u * u)) * 34), u / 100);
    const color = [inks.a, inks.b, inks.c].filter((k) => contrast(k, inks.paper) >= 1.6)[Math.floor(r[9]! * 2)] ?? inks.a;
    const rr = hero ? hero.s * u * 0.3 : Math.min(hh * 0.3, u * 0.55);
    const at = hero ? { x: x + (hero.c + hero.s / 2) * u, y: y + (hero.r + hero.s / 2) * u } : { x: x + w - u * 0.9, y: y + hh / 2 };
    orb(cl, inks, motif, at.x, at.y, rr, color, true);
  });
}

export const aura: ArtStyleDef = {
  id: 'aura',
  compositions: [{ id: 'halo', label: 'Halo' }, { id: 'orbe', label: 'Orbe' }, { id: 'nuit', label: 'Nuit' }],
  defaultComposition: (d) => hashString(`aura|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? orbe(c, call, p) : low(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
