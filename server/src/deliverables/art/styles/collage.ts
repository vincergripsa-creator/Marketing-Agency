/**
 * « Papier découpé » (D200): paper cut and torn by hand and laid on the page. Sheets, strips and discs of the palette's inks,
 * torn on some edges and cut on others, the white of the paper showing along each tear, a shadow under each piece; the motif
 * cut out of a coloured sheet with scissors; a strip of masking tape; a fine grain over all. Three compositions: the
 * scrapbook under the title, the title on a torn band across a coloured ground, a torn sun over a strip of horizon above the
 * title. The seed picks the papers, their inks and where they land; the score reads what they give, legibility first.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, ensureContrast, mix } from '../../color.js';
import { n, toSvg, Scene } from '../../scene.js';
import { decoRng, hashString } from '../../text.js';
import { motifShape, type Box } from '../shapes.js';
import { bestOn, harmony, onBauhausScale } from './common.js';
import { disc, DOT_BYTES, polyD, ringsD, ringsIn, sheet, shift, speckle, strokesIn, tornPolygon, wobble, type Pt, type Rnd, type Sheet, type Tear } from './paper.js';
import { blockHeight, deckBytes, drawnBytes, fitHead, headBytes, kitBytes, setDeck, setHead, SVG_LIMIT, type Fitted } from './setting.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec } from './types.js';

const LABEL_Y = 58;
const TITLE_TOP = 104;          // the capitals of the first line
const TITLE_MAX = 112;
const LEADING = 0.96;
const TRACK = -0.01;
const DESCENT = 0.22;
const FOOT = COVER_H - 34;      // the audience's last baseline
const DECK = { max: 27, min: 17, lines: 3 };
const MIN_TEXT = 4.5;
const MIN_ACCENT = 1.6;
const SHADOW_OP = 0.24;         // a piece's shadow: the ink at this opacity, so that it darkens whatever lies under it
const TAPE_OP = 0.74;
const GRAIN = 0.15;             // the dark fibres of the paper, in the ink at this opacity
const FIBRE = 0.5;              // the light ones, in white
const ART_SHARE = 0.7;          // of what the words leave: the papers' part, the grain has the rest
const MIN_DETAIL = 0.1;         // the coarsest tear: a fibre every 52 points

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const legible = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - MIN_TEXT) / 9);
const pops = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - 1.4) / 3);
/** 1 on the ideal, 0 a `span` away. */
const near = (v: number, ideal: number, span: number): number => clamp01(1 - Math.abs(v - ideal) / span);

/**
 * How a hand works at a scale: `k` is a cover's point in this drawing's, `detail` thins the tears when bytes run short, a
 * `lean` hand leaves the scraps out, and a `bare` one the strips too: what a cover whose words weigh 140 kB can still afford.
 */
interface Hand { k: number; shadow: string; tape: string; rnd: Rnd; tear: Tear; detail: number; lean: boolean; bare: boolean }

const handOf = (inks: InkSet, k: number, rnd: Rnd, detail = 1, lean = false, bare = false): Hand =>
  ({ k, shadow: inks.ink, tape: mix(inks.c, '#ffffff', 0.38), rnd, tear: { amp: 2.6 * k, step: (5.2 * k) / detail, white: 3.6 * k }, detail, lean: lean || bare, bare });

/** The white core of a sheet of `ink`, that a tear lays bare. */
const whiteOf = (ink: string): string => mix(ink, '#ffffff', 0.78);

/** A piece on the page: its shadow, its torn white, its colour. */
function lay(s: Scene, h: Hand, sh: Sheet, ink: string): void {
  s.path(polyD(sh.body.map(([x, y]): Pt => [x + 4 * h.k, y + 6 * h.k])), h.shadow, { op: SHADOW_OP });
  s.path(polyD(sh.fringe), whiteOf(ink));
  s.path(polyD(sh.body), ink);
}

/** A strip of masking tape across (cx, cy): translucent, its two ends torn off the roll. */
function tape(s: Scene, h: Hand, cx: number, cy: number, len: number, rot: number): void {
  const sh = sheet({ cx, cy, w: len, h: 34 * h.k, rot, torn: [false, true, false, true] }, h.rnd, { amp: 1.4 * h.k, step: 3.4 * h.k, white: 0 });
  s.path(polyD(sh.body), h.tape, { op: TAPE_OP });
}

/** A scrap: a small piece of four or five corners torn off a sheet, turned any way. A lean hand keeps none. */
function scrap(s: Scene, h: Hand, cx: number, cy: number, size: number, ink: string): void {
  if (h.lean) return;
  const corners = h.rnd() < 0.5 ? 4 : 5;
  const turn = h.rnd() * Math.PI * 2;
  const pts: Pt[] = Array.from({ length: corners }, (_, k) => {
    const a = turn + ((k + (h.rnd() - 0.5) * 0.5) / corners) * Math.PI * 2;
    const r = size * (0.44 + h.rnd() * 0.12);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8];
  });
  lay(s, h, tornPolygon(pts, pts.map((_, k) => k % 2 === 0 || h.rnd() < 0.5), h.rnd, { ...h.tear, amp: h.tear.amp * 0.7 }), ink);
}

/** Holes cut through a sheet: what lies under it, and the shadow its edge casts in. */
function holes(s: Scene, h: Hand, rings: Pt[][], under: string): void {
  if (!rings.length) return;
  const d = ringsD(rings);
  s.clip(d, (cl) => {
    cl.path(d, mix(under, h.shadow, SHADOW_OP));
    cl.path(ringsD(shift(rings, 3 * h.k, 4.5 * h.k)), under);
  });
}

/**
 * The motif cut out of a sheet of `ink` with scissors and laid on `under`: its shadow, its body, its holes and lines cut
 * through, its marks cut as strips of the same paper.
 */
function cutOut(s: Scene, h: Hand, motif: DesignSpec['motif'], box: Box, ink: string, under: string, rot: number): void {
  const shape = motifShape(motif);
  const side = Math.min(box.w, box.h);
  const amp = side * 0.0035;
  // scissors cut a curve in short straight snips: fewer of them when bytes run short
  const per = Math.max(2, Math.round(6 * Math.min(1, h.detail)));
  const body = ringsIn(shape.body, box, { rot }, per).map((r) => wobble(r, h.rnd, amp));
  const [sx, sy] = [4 * h.k, 6 * h.k];
  const marks = strokesIn(shape.marks, box, { rot }, per).map((r) => wobble(r, h.rnd, amp, false));
  const strip = { sw: shape.weight * side, cap: 'round' as const };
  if (marks.length) s.path(marks.map((m) => polyD(m.map(([x, y]): Pt => [x + sx, y + sy]), false)).join(''), undefined, { stroke: h.shadow, ...strip, op: SHADOW_OP });
  s.path(ringsD(shift(body, sx, sy)), h.shadow, { op: SHADOW_OP });
  s.path(ringsD(body), ink);
  if (marks.length) s.path(marks.map((m) => polyD(m, false)).join(''), undefined, { stroke: ink, ...strip });
  holes(s, h, ringsIn(shape.holes, box, { rot }, per).map((r) => wobble(r, h.rnd, amp * 0.6)), under);
  const lines = strokesIn(shape.lines, box, { rot }, per).map((r) => wobble(r, h.rnd, amp * 0.6, false));
  if (lines.length) s.path(lines.map((m) => polyD(m, false)).join(''), undefined, { stroke: under, sw: shape.weight * side * 0.8, cap: 'round' });
}

/** The fibres of the paper over `box`, as many as `room` bytes allow up to `count`: dark ones and white ones. */
function grain(s: Scene, h: Hand, inks: InkSet, box: Box, count: number, room = Infinity): void {
  const fit = Math.max(0, Math.min(count, Math.floor(room / DOT_BYTES)));
  speckle(h.rnd, box, Math.round(fit * 0.6), 1.25 * h.k).draw(s, inks.ink, GRAIN);
  speckle(h.rnd, box, Math.round(fit * 0.4), 1.1 * h.k).draw(s, '#ffffff', FIBRE);
}

/**
 * The papers of a cover, drawn once at full detail and again with thinner tears if they spend more than `room`: the same
 * seed draws the same pieces, only their edges are coarser.
 */
function papers(c: CoverKit, seed: string, room: number, draw: (s: Scene, h: Hand) => void): void {
  const run = (detail: number, lean: boolean, bare = false): { s: Scene; bytes: number } => {
    const s = new Scene(COVER_W, COVER_H);
    draw(s, handOf(c.inks, 1, decoRng(hashString(seed)), detail, lean, bare));
    return { s, bytes: toSvg(s).length };
  };
  const fits = room * ART_SHARE;
  let detail = 1;
  let best = run(detail, false);
  // what a tear costs goes with its fibres: three tries close in on the room
  for (let k = 0; k < 3 && best.bytes > fits && detail > MIN_DETAIL; k++) {
    detail = Math.max(MIN_DETAIL, detail * (fits / best.bytes) * 0.92);
    best = run(detail, false);
  }
  // this tight, the grain will get nothing anyway: the papers may take the whole room
  if (best.bytes > room) best = run(MIN_DETAIL, true);
  if (best.bytes > room) best = run(MIN_DETAIL, true, true);
  c.s.ops.push(...best.s.ops);
}

// ───────────────────────────── the plan ─────────────────────────────

interface Plan {
  composition: number;
  ground: string;                // what the title stands on
  title: string;
  deck: string;
  around: string;                // the ground of the cover, under the labels and the audience
  aroundText: string;
  big: string;                   // the main paper: the scrapbook's sheet, the band's disc, the sun
  strip: string;                 // the strip across: the scrapbook's, the band's lining, the horizon
  motif: string;                 // the paper the motif is cut from
  bit: string;                   // the scraps
  side: 1 | -1;                  // where the big paper leans or bleeds off
  tilt: number;                  // the big paper's turn, degrees
  slant: number;                 // the strip's
  turn: number;                  // the motif's
  scale: number;                 // the motif, as a share of its room
  under: boolean;                // the strip under the big paper
  high: boolean;                 // the band high, the strip high
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
const MEASURED = [{ mean: 0.6298, sd: 0.1332 }, { mean: 0.6935, sd: 0.1011 }, { mean: 0.6411, sd: 0.1292 }] as const;
/**
 * Collage sets its title over a third of the page and its art: the cover's other terms (thumbnail, balance) read 0.8 lower than
 * Bauhaus's on the same designs, inside the point the plan allows, so its art keeps Bauhaus's mean as it is.
 */
const ART_LIFT = 0;

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`collage|${seed}|${composition}`));
  const r = Array.from({ length: 12 }, rnd);
  const pick = <T>(xs: readonly T[], k: number): T | undefined => xs[Math.floor(r[k]! * xs.length)];
  const text = [inks.paper, inks.ink];
  const colours = [inks.a, inks.b, inks.c, inks.ink];
  const base = {
    composition, side: (r[5]! < 0.5 ? 1 : -1) as 1 | -1, tilt: (r[6]! - 0.5) * 7, slant: 6 + r[7]! * 8, turn: (r[8]! - 0.5) * 14,
    scale: 0.8 + r[9]! * 0.2, under: r[10]! < 0.5, high: r[11]! < 0.5,
  };
  const others = (...not: string[]) => colours.filter((k) => !not.includes(k));
  if (composition === 1) {
    // a coloured ground to the edges, the title on a torn strip of paper across it
    const ground = pick(colours.filter((k) => contrast(bestOn(k, text), k) >= MIN_TEXT && contrast(k, inks.paper) >= 1.25), 0) ?? inks.ink;
    const aroundText = bestOn(ground, text);
    const big = pick([inks.c, inks.b, inks.a, inks.paper].filter((k) => k !== ground && contrast(k, ground) >= 1.3), 1) ?? inks.paper;
    // the motif leans off its disc onto the ground: it must stand out from both
    const cuts = [inks.c, inks.b, inks.a, inks.paper, inks.ink].filter((k) => k !== big && contrast(k, big) >= MIN_ACCENT);
    const motif = pick(cuts.filter((k) => contrast(k, ground) >= 1.4), 2) ?? pick(cuts, 2) ?? inks.paper;
    const strip = pick(others(ground, motif).filter((k) => contrast(k, ground) >= 1.2), 3) ?? inks.c;
    const deck = ensureContrast(ground === inks.a ? inks.ink : inks.a, inks.paper, MIN_TEXT);
    const raw = 0.24 * legible(inks.ink, inks.paper) + 0.14 * legible(aroundText, ground) + 0.2 * pops(motif, big) + 0.12 * pops(big, ground)
      + 0.15 * harmony(ground, big) + 0.15 * harmony(strip, ground) * near(base.scale, 0.95, 0.2);
    return { ...base, ground: inks.paper, title: inks.ink, deck, around: ground, aroundText, big, strip, motif, bit: pick(others(ground, big), 4) ?? inks.c, raw };
  }
  const ground = inks.paper;
  const title = pick([inks.ink, inks.a].filter((k) => contrast(k, ground) >= MIN_TEXT), 0) ?? inks.ink;
  const big = pick(colours.filter((k) => contrast(k, ground) >= 1.25), 1) ?? inks.a;
  const cuts = [...colours, inks.paper].filter((k) => k !== big && contrast(k, big) >= MIN_ACCENT);
  const motif = pick(cuts.filter((k) => contrast(k, ground) >= 1.4), 2) ?? pick(cuts, 2) ?? inks.ink;
  const strip = pick(others(big, motif).filter((k) => contrast(k, ground) >= 1.2), 3) ?? inks.c;
  const deck = ensureContrast(title === inks.a ? inks.b : inks.a, ground, MIN_TEXT);
  const bit = pick(others(big, motif), 4) ?? inks.c;
  if (composition === 2) {
    // a torn sun over a strip of horizon, the title under them on paper
    const raw = 0.22 * legible(title, ground) + 0.2 * pops(motif, big) + 0.14 * pops(big, ground) + 0.16 * harmony(big, strip)
      + 0.12 * harmony(big, motif) + 0.16 * near(base.scale, 0.95, 0.2) * near(base.slant, 8, 8);
    return { ...base, ground, title, deck, around: ground, aroundText: title, big, strip, motif, bit, raw };
  }
  // the scrapbook: a sheet off one edge, a strip across, the motif, a scrap and tape
  const raw = 0.22 * legible(title, ground) + 0.2 * pops(motif, big) + 0.15 * pops(big, ground) + 0.15 * harmony(big, motif) + 0.1 * harmony(big, strip)
    + 0.18 * near(base.scale, 0.92, 0.25) * near(Math.abs(base.tilt), 2, 2);
  return { ...base, ground, title, deck, around: ground, aroundText: title, big, strip, motif, bit, raw };
}

const artOf = (p: Plan): number => onBauhausScale(p.raw, MEASURED[p.composition] ?? MEASURED[0], ART_LIFT);

// ───────────────────────────── covers ─────────────────────────────

const artFor = (p: Plan, t: Fitted, sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: t.widths, titleFace: t.face, titleInk: p.title, titleGround: p.ground, sticker });

interface Words { t: Fitted; deck: ReturnType<CoverKit['deck']>; gap: number; block: number }

/** The title and its deck, fitted to `height`. `block` is how tall they stand, from the top of the capitals to the descenders. */
function fitWords(c: CoverKit, call: CoverCall, height: number, max = TITLE_MAX): Words {
  const deck = c.deck(call.tail, MEASURE, DECK);
  const deckRoom = deck ? deck.size * 0.8 + (deck.lines.length - 1) * deck.lineHeight + 26 : 0;
  const t = fitHead(c.v.display, call.head, { width: MEASURE, height: height - deckRoom, max, leading: LEADING, descent: DESCENT, track: TRACK, balance: 1 });
  const gap = deck ? DESCENT * t.size + 14 + deck.size * 0.8 : 0;
  const block = blockHeight(t) + (deck ? gap + (deck.lines.length - 1) * deck.lineHeight + deck.size * 0.25 : DESCENT * t.size);
  return { t, deck, gap, block };
}

/** Sets title and deck from `top`, flush left on the margin. Returns what they weigh in the SVG. */
function setWords(c: CoverKit, w: Words, top: number, p: Plan): number {
  const last = setHead(c, w.t, MARGIN, top, p.title, { width: MEASURE }).at(-1)!;
  if (w.deck) setDeck(c, w.deck, MARGIN, last + w.gap, p.deck, { width: MEASURE });
  return headBytes(w.t, MARGIN, top) + deckBytes(c, w.deck, MARGIN, last + w.gap);
}

/** What the art may still spend once the words are known and what is drawn so far. */
const roomLeft = (c: CoverKit, words: number): number => SVG_LIMIT - kitBytes(c) - words - drawnBytes(c);

/** « Atelier »: the title on paper, and under it the scrapbook: a sheet off one edge, a strip across, the motif, a scrap, tape. */
function atelier(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { inks } = c;
  c.labels(LABEL_Y, { ink: p.title });
  const foot = c.audience(FOOT, MEASURE, 2, { ink: p.title });
  const w = fitWords(c, call, 470 - TITLE_TOP);
  const words = setWords(c, w, TITLE_TOP, p);
  // the scrapbook takes what the words leave, never less than a third of the page
  const top = Math.min(TITLE_TOP + w.block + 44, COVER_H * 0.64);
  const room = foot - 26 - top;
  papers(c, `collage|draw|${call.seed}|0`, roomLeft(c, words), (s, h) => {
    const bw = COVER_W * 0.74;
    const bx = p.side > 0 ? COVER_W - bw / 2 + 40 : bw / 2 - 40;
    const cy = top + room / 2;
    const strip = (): void => { if (!h.bare) lay(s, h, sheet({ cx: COVER_W / 2, cy: top + room * (p.high ? 0.3 : 0.72), w: COVER_W + 160, h: room * 0.3, rot: -p.side * p.slant, torn: [true, false, true, false] }, h.rnd, h.tear), p.strip); };
    if (p.under) strip();
    lay(s, h, sheet({ cx: bx, cy, w: bw, h: room * 0.86, rot: p.tilt, torn: [true, p.side < 0, true, p.side > 0] }, h.rnd, h.tear), p.big);
    if (!p.under) strip();
    const side = Math.min(room * 0.84, 340) * p.scale;
    const mx = bx - p.side * bw * 0.1;
    cutOut(s, h, c.d.motif, { x: mx - side / 2, y: cy - side / 2, w: side, h: side }, p.motif, p.big, p.turn);
    scrap(s, h, mx + p.side * side * 0.62, cy - side * 0.42, 54, p.bit);
    tape(s, h, mx - p.side * side * 0.36, cy - side * 0.44, 150, p.side * 36);
  });
  grain(c.s, handOf(inks, 1, decoRng(hashString(`collage|grain|${call.seed}`))), inks, { x: 0, y: 0, w: COVER_W, h: COVER_H }, 1800, roomLeft(c, words));
  return artFor(p, w.t, { u: p.side > 0 ? 0.22 : 0.78, v: 0.86 });
}

/** « Bandeau »: a coloured ground to the edges, the title on a strip of paper torn across it, a torn disc and the motif. */
function bandeau(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { inks } = c;
  c.s.rect(0, 0, COVER_W, COVER_H, p.around);
  c.labels(LABEL_Y, { ink: p.aroundText });
  const foot = c.audience(FOOT, MEASURE, 2, { ink: p.aroundText });
  const pad = 32;
  const w = fitWords(c, call, 330, 104);
  const bandH = w.block + 2 * pad + 6;
  const bandTop = p.high ? 96 : foot - 40 - bandH;
  const top = bandTop + pad + 3;
  const words = setWords(c, w, top, p);
  const [y0, y1] = p.high ? [bandTop + bandH + 26, foot - 26] : [84, bandTop - 22];
  const room = Math.max(140, y1 - y0);
  papers(c, `collage|draw|${call.seed}|1`, roomLeft(c, words), (s, h) => {
    // the band, a hair turned, over a lining torn a little wider and turned the other way
    if (!h.bare) lay(s, h, sheet({ cx: COVER_W / 2, cy: bandTop + bandH / 2 + 4, w: COVER_W + 80, h: bandH + 30, rot: -p.side * 1.6, torn: [true, false, true, false] }, h.rnd, h.tear), p.strip);
    lay(s, h, sheet({ cx: COVER_W / 2, cy: bandTop + bandH / 2, w: COVER_W + 80, h: bandH, rot: p.side * 0.5, torn: [true, false, true, false] }, h.rnd, h.tear), inks.paper);
    // the disc runs off the side, the motif stands on it toward the middle of the page
    const r = Math.min(room * 0.5, 215);
    const cx = COVER_W / 2 + p.side * (COVER_W / 2 - r * 0.62);
    const cy = y0 + room / 2;
    lay(s, h, disc(cx, cy, r, h.rnd, h.tear), p.big);
    const side = Math.min(r * 1.7, 340) * p.scale;
    const mx = cx - p.side * r * 0.42;
    cutOut(s, h, c.d.motif, { x: mx - side / 2, y: cy - side / 2, w: side, h: side }, p.motif, p.big, p.turn);
    // the tape holds the band in the margin, clear of every word
    tape(s, h, p.side > 0 ? 20 : COVER_W - 20, bandTop + 22, 100, p.side > 0 ? 74 : -74);
  });
  grain(c.s, handOf(inks, 1, decoRng(hashString(`collage|grain|${call.seed}`))), inks, { x: 0, y: 0, w: COVER_W, h: COVER_H }, 1800, roomLeft(c, words));
  return artFor(p, w.t, { u: p.side > 0 ? 0.22 : 0.78, v: p.high ? 0.8 : 0.2 });
}

/** « Horizon »: a torn sun over a strip of horizon, the motif in front, the title under them on paper. */
function horizon(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { inks } = c;
  c.labels(LABEL_Y, { ink: p.title });
  const foot = c.audience(FOOT, MEASURE, 2, { ink: p.title });
  const artTop = 88;
  // the words first, in what an art of 300 leaves them; the art then takes what the words leave, up to 450
  const w = fitWords(c, call, foot - 30 - artTop - 300 - 40, 104);
  const artH = Math.min(450, foot - 30 - artTop - w.block - 40);
  const top = artTop + artH + 40;
  const words = setWords(c, w, top, p);
  papers(c, `collage|draw|${call.seed}|2`, roomLeft(c, words), (s, h) => {
    const cy = artTop + 14 + artH * 0.46;
    // the sun stays under the labels, its fibres and the tape on it too
    const r = Math.min(artH * 0.44, 210, cy - artTop - 22);
    const cx = COVER_W / 2 + p.side * 70;
    const strip = (): void => { if (!h.bare) lay(s, h, sheet({ cx: COVER_W / 2, cy: cy + r * 0.78, w: COVER_W + 160, h: Math.max(70, artH * 0.24), rot: p.side * p.slant * 0.45, torn: [true, false, true, false] }, h.rnd, h.tear), p.strip); };
    if (p.under) strip();
    lay(s, h, disc(cx, cy, r, h.rnd, h.tear), p.big);
    if (!p.under) strip();
    const side = Math.min(artH * 0.8, 330) * p.scale;
    const mx = cx - p.side * r * 0.5;
    cutOut(s, h, c.d.motif, { x: mx - side / 2, y: cy - side * 0.46, w: side, h: side }, p.motif, p.big, p.turn);
    scrap(s, h, cx + p.side * r * 0.95, cy - r * 0.8, 46, p.bit);
    scrap(s, h, mx - p.side * side * 0.5, cy + side * 0.5, 34, p.big === p.bit ? p.strip : p.bit);
    tape(s, h, mx + p.side * side * 0.34, cy - side * 0.42, 140, -p.side * 40);
  });
  grain(c.s, handOf(inks, 1, decoRng(hashString(`collage|grain|${call.seed}`))), inks, { x: 0, y: 0, w: COVER_W, h: COVER_H }, 1800, roomLeft(c, words));
  return artFor(p, w.t, { u: p.side > 0 ? 0.2 : 0.8, v: 0.16 });
}

// ───────────────────────────── plates ─────────────────────────────

/**
 * A plate: paper, a strip torn across it and a sheet or a disc bleeding off its edges, the motif cut out where the page wants
 * its figure, a strip of tape, the grain. The seed and the chapter choose the inks and the tears; nothing leaves the rectangle.
 */
function plate(s: Scene, p: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = p;
  const w = cols * u;
  const hh = rows * u;
  const rnd = decoRng(hashString(`collage|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 8 }, rnd);
  const h = handOf(inks, u / 100, rnd);
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(hh)}h${n(-w)}Z`;
  s.path(rect, inks.paper);
  const colours = [inks.a, inks.b, inks.c, inks.ink].filter((k) => contrast(k, inks.paper) >= 1.25);
  const big = colours[Math.floor(r[0]! * colours.length)] ?? inks.a;
  const rest = [inks.a, inks.b, inks.c, inks.ink].filter((k) => k !== big);
  const strip = rest[Math.floor(r[1]! * rest.length)]!;
  // a plate is seen small, in a band of a page: its cut-out stands out from its paper by more than a cover's must
  const cut = [inks.c, inks.b, inks.a, inks.paper, inks.ink].filter((k) => k !== big && contrast(k, big) >= 2);
  const ink = cut[Math.floor(r[2]! * cut.length)] ?? bestOn(big, [inks.paper, inks.ink]);
  const left = r[3]! < 0.5;
  const round = r[4]! < 0.5;
  s.clip(rect, (cl) => {
    const tall = hh > w * 1.2;
    const at = hero ? { x: x + (hero.c + hero.s / 2) * u, y: y + (hero.r + hero.s / 2) * u } : { x: x + w * (left ? 0.3 : 0.7), y: y + hh * 0.52 };
    const side = hero ? hero.s * u * 0.86 : Math.min(hh * 0.8, w * 0.3);
    // a frame stands taller than a page: a sheet torn across its head too, so that no part of it is bare
    if (tall) lay(cl, h, sheet({ cx: x + w * (left ? 0.62 : 0.38), cy: y + hh * 0.14, w: w * 1.1, h: hh * 0.36, rot: (left ? 1 : -1) * (5 + r[7]! * 5), torn: [false, !left, true, left] }, h.rnd, h.tear), rest.find((k) => k !== strip && contrast(k, inks.paper) >= 1.25) ?? big);
    lay(cl, h, sheet({ cx: x + w / 2, cy: y + hh * (tall ? 0.56 : r[5]! < 0.5 ? 0.34 : 0.68), w: w + 200 * h.k, h: Math.min(hh * 0.34, 150 * h.k), rot: (left ? -1 : 1) * (4 + r[6]! * 6) * (tall ? 1.6 : 1), torn: [true, false, true, false] }, h.rnd, h.tear), strip);
    // the big paper behind the figure: a disc, or a sheet off the edge the figure is near
    const reach = Math.max(side * 0.72, Math.min(w, hh) * 0.42);
    if (round) lay(cl, h, disc(at.x + (left ? 1 : -1) * side * 0.22, at.y, reach, h.rnd, h.tear), big);
    else {
      const bw = Math.min(w * 0.7, side * 1.9);
      const bx = at.x < x + w / 2 ? x + bw / 2 - 40 * h.k : x + w - bw / 2 + 40 * h.k;
      lay(cl, h, sheet({ cx: bx, cy: at.y, w: bw, h: Math.min(hh * 0.94, side * 1.5), rot: (r[7]! - 0.5) * 6, torn: [true, bx < x + w / 2, true, bx > x + w / 2] }, h.rnd, h.tear), big);
    }
    cutOut(cl, h, motif, { x: at.x - side / 2, y: at.y - side / 2, w: side, h: side }, ink, big, (r[6]! - 0.5) * 14);
    tape(cl, h, at.x + (left ? -1 : 1) * side * 0.38, at.y - side * 0.44, 140 * h.k, left ? 38 : -38);
    grain(cl, h, inks, { x, y, w, h: hh }, Math.round(((w * hh) / (u * u)) * 40));
  });
}

export const collage: ArtStyleDef = {
  id: 'collage',
  compositions: [{ id: 'atelier', label: 'Atelier' }, { id: 'bandeau', label: 'Bandeau' }, { id: 'horizon', label: 'Horizon' }],
  defaultComposition: (d) => hashString(`collage|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? bandeau(c, call, p) : call.composition === 2 ? horizon(c, call, p) : atelier(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
