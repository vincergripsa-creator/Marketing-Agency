/**
 * « Risographie » (D200): a print of two spot inks on paper. The first lays solids, the motif knocked out of nothing; the second
 * a halftone of dots whose size follows a tone, on a drum a few points off register; where they cross, the overprint of the
 * two, a third colour neither has; a little dust of paper where the first ink starved. A bold grotesque title in the first ink,
 * its ghost in the second. Three compositions: a sun of dots behind the motif, a field of dots rising under it, the motif
 * printed twice. The seed picks the second ink, the register and the screens; the score reads the inks the print gives.
 */
import type { DesignSpec, InkSet } from '../../../shared.js';
import { contrast, ensureContrast, mix } from '../../color.js';
import { isStdFont, type FaceName } from '../../fonts.js';
import { n, outlineD, toSvg, Scene } from '../../scene.js';
import { decoRng, hashString } from '../../text.js';
import { boundsOf, motifShape, type Box } from '../shapes.js';
import { harmony, onBauhausScale } from './common.js';
import { apart, boundsIn, Dots, halftone, inker, multiply, polyD, ringsIn, speckle, strokesIn, type Pt, type Rnd } from './paper.js';
import { blockHeight, deckBytes, drawnBytes, fitHead, headBytes, kitBytes, setDeck, setHead, SVG_LIMIT, type Fitted } from './setting.js';
import { COVER_H, COVER_W, MARGIN, MEASURE, type ArtStyleDef, type CoverArt, type CoverCall, type CoverKit, type PlateSpec } from './types.js';
import type { Voice } from '../../voices.js';

const LABEL_Y = 58;
const TITLE_TOP = 100;
const LEADING = 0.94;
const TRACK = -0.018;
const DESCENT = 0.2;
const FOOT = COVER_H - 34;
const DECK = { max: 25, min: 16, lines: 3 };
const MIN_TEXT = 4.5;
const GHOST = 0.6;              // the second drum's print of the title
const DUST = 0.55;              // paper where the first ink starved
const CELL = 9;                 // the screen's cell on a cover, in points
const ART_SHARE = 0.78;         // of what the words leave: the print's part, the title's ghost has the rest

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const legible = (fg: string, bg: string): number => clamp01((contrast(fg, bg) - MIN_TEXT) / 9);
const near = (v: number, ideal: number, span: number): number => clamp01(1 - Math.abs(v - ideal) / span);

/** A display face of high contrast gives way to the voice's bold sans: a riso title is a grotesque or a soft slab. */
const DIDONE = /^(playfair|dm-serif|Times)/;
const titleFace = (v: Voice): FaceName => (DIDONE.test(v.display) ? v.labelB : v.display);

/** Signed area: which way a ring turns. */
const area = (r: readonly Pt[]): number => r.reduce((a, [x, y], i) => { const [u, w] = r[(i + 1) % r.length]!; return a + x * w - u * y; }, 0) / 2;

/**
 * The motif as a stencil of the first drum: its holes turned against its body, so that nonzero knocks them out. The holes turn
 * as one: a ring inside a ring (the coin's rim) keeps its own way, or what it holds would print.
 */
interface Stencil { d: string; rings: Pt[][]; lines: Pt[][]; marks: Pt[][]; weight: number; box: Box; inked: (x: number, y: number, pad?: number) => boolean }

function stencil(motif: DesignSpec['motif'], box: Box, rot: number, per: number): Stencil {
  const shape = motifShape(motif);
  const body = ringsIn(shape.body, box, { rot }, per);
  const cut = ringsIn(shape.holes, box, { rot }, per);
  const same = body.length > 0 && cut.length > 0 && Math.sign(area(body[0]!)) === Math.sign(area(cut[0]!));
  const holes = same ? cut.map((r) => [...r].reverse()) : cut;
  const rings = [...body, ...holes];
  return {
    d: rings.map((r) => polyD(r)).join(''), rings, lines: strokesIn(shape.lines, box, { rot }, per), marks: strokesIn(shape.marks, box, { rot }, per),
    weight: shape.weight * Math.min(box.w, box.h), box: boundsIn(rings), inked: inker(rings),
  };
}

/**
 * The two drums of a print, the second one off register, and what each lays: the screen's cell, how finely the motif's curves
 * are cut, the dust, and whether the second drum prints at all. A lean press, for a cover whose words weigh 140 kB, cuts
 * coarser and lays no dust; past 145 kB only the first drum prints.
 */
interface Press { p: string; s: string; o: string; paper: string; shift: Pt; rnd: Rnd; k: number; cell: number; per: number; dust: boolean; screens: boolean }

/** A solid of the first drum: the stencil, its lines knocked out, its marks, and the dust where the ink starved. */
function solid(s: Scene, pr: Press, st: Stencil): void {
  s.path(st.d, pr.p);
  const stroke = { sw: st.weight, cap: 'round' as const };
  if (st.lines.length) s.path(st.lines.map((l) => polyD(l, false)).join(''), undefined, { stroke: pr.paper, ...stroke, sw: st.weight * 0.85 });
  if (st.marks.length) s.path(st.marks.map((l) => polyD(l, false)).join(''), undefined, { stroke: pr.p, ...stroke });
  if (!pr.dust) return;
  const box = st.box;
  speckle(pr.rnd, box, Math.round((box.w * box.h) / (420 * pr.k * pr.k)), 1.1 * pr.k, (x, y) => st.inked(x, y)).draw(s, pr.paper, DUST);
}

/** A screen of the second drum: its dots in its ink, and again in the overprint where they fall on the first drum's solids. */
function screen(s: Scene, pr: Press, dots: { x: number; y: number; d: number }[], under: readonly Stencil[]): void {
  if (!pr.screens) return;
  const all = new Dots();
  for (const q of dots) all.add(q.x, q.y, q.d);
  all.draw(s, pr.s);
  for (const st of under) {
    const b = st.box;
    const over = new Dots();
    // a dot that touches the solid at all is printed over it: the clip cuts it on the solid's edge
    const touches = (q: { x: number; y: number; d: number }) => {
      const h = q.d / 2;
      if (q.x + h < b.x || q.x - h > b.x + b.w || q.y + h < b.y || q.y - h > b.y + b.h) return false;
      return st.inked(q.x, q.y, h) || st.inked(q.x, q.y - h) || st.inked(q.x, q.y + h);
    };
    for (const q of dots) if (touches(q)) over.add(q.x, q.y, q.d);
    if (over.size) s.clip(st.d, (cl) => over.draw(cl, pr.o));
  }
}

/** A disc of tone about (cx, cy), denser toward `lean`, thinning to nothing at its rim. */
const discTone = (cx: number, cy: number, r: number, lean: Pt, base: number) => (x: number, y: number): number => {
  const d = Math.hypot(x - cx, y - cy) / r;
  if (d > 1) return 0;
  const ramp = clamp01(0.5 + ((x - cx) * lean[0] + (y - cy) * lean[1]) / (2 * r));
  return base * (0.25 + 0.75 * ramp) * (d > 0.94 ? (1 - d) / 0.06 : 1);
};

// ───────────────────────────── the plan ─────────────────────────────

interface Plan {
  composition: number;
  p: string;                     // the first drum: solids and the title's ink
  s: string;                     // the second: screens and the ghost
  o: string;                     // where they cross
  title: string;
  shift: Pt;                     // the second drum off register, in points of a cover
  lean: Pt;                      // where the light comes from, on a screen of tone
  side: 1 | -1;
  scale: number;                 // the motif, as a share of its room
  turn: number;
  size: number;                  // the sun, the field: a share of their room
  raw: number;
}

/** The raw score of each composition on its own covers, measured by `scripts/styleSheet.ts`: what `onBauhausScale` maps. */
const MEASURED = [{ mean: 0.5498, sd: 0.1 }, { mean: 0.5484, sd: 0.0999 }, { mean: 0.5549, sd: 0.1047 }] as const;
const ART_LIFT = 0;

/** Every choice the seed makes for one composition. A fixed count of draws: a pool that grows moves no other choice. */
function planOf(inks: InkSet, seed: number, composition: number): Plan {
  const rnd = decoRng(hashString(`riso|${seed}|${composition}`));
  const r = Array.from({ length: 12 }, rnd);
  // the first drum is the palette's deep accent or its near black, the second an ink of another colour that prints on paper
  const firsts = [inks.a, inks.ink].filter((k) => contrast(k, inks.paper) >= 2.6);
  const p = firsts[Math.floor(r[8]! * firsts.length)] ?? inks.ink;
  const seconds = [inks.b, inks.c, inks.a].filter((k) => k !== p && contrast(k, inks.paper) >= 1.7 && apart(k, p) >= 110);
  const s = seconds[Math.floor(r[0]! * seconds.length)] ?? (inks.b === p ? inks.c : inks.b);
  const o = multiply(p, s);
  const title = ensureContrast(p, inks.paper, MIN_TEXT);
  const a = r[1]! * Math.PI * 2;
  const reach = 2 + Math.round(r[2]! * 2);
  const shift: Pt = [Math.round(Math.cos(a) * reach), Math.round(Math.sin(a) * reach)];
  const la = r[3]! * Math.PI * 2;
  const lean: Pt = [Math.cos(la), Math.sin(la)];
  const base = { composition, p, s, o, title, shift, lean, side: (r[4]! < 0.5 ? 1 : -1) as 1 | -1, scale: 0.82 + r[5]! * 0.18, turn: (r[6]! - 0.5) * 16, size: 0.8 + r[7]! * 0.2 };
  // the overprint must be a colour of its own, the screen must print, the two inks sit together, the print is well cut
  const third = clamp01((Math.min(contrast(o, p), contrast(o, s)) - 1.05) / 1.6);
  const prints = clamp01((contrast(s, inks.paper) - 1.5) / 2.2);
  const register = near(Math.hypot(...shift), 3, 2);
  const shape = near(base.size, 0.92, 0.2) * near(base.scale, 0.95, 0.25);
  const cut = composition === 2 ? register * Math.sqrt(shape) : shape * (0.6 + 0.4 * register);
  const raw = 0.2 * legible(title, inks.paper) + 0.18 * third + 0.14 * prints + 0.16 * harmony(p, s) + 0.32 * cut;
  return { ...base, raw };
}

const artOf = (p: Plan): number => onBauhausScale(p.raw, MEASURED[p.composition] ?? MEASURED[0], ART_LIFT);

// ───────────────────────────── covers ─────────────────────────────

interface Words { t: Fitted; deck: ReturnType<CoverKit['deck']>; gap: number; block: number }

function fitWords(c: CoverKit, call: CoverCall, height: number, max: number): Words {
  const deck = c.deck(call.tail, MEASURE, DECK);
  const deckRoom = deck ? deck.size * 0.8 + (deck.lines.length - 1) * deck.lineHeight + 24 : 0;
  const t = fitHead(titleFace(c.v), call.head, { width: MEASURE, height: height - deckRoom, max, leading: LEADING, descent: DESCENT, track: TRACK, balance: 1 });
  const gap = deck ? DESCENT * t.size + 14 + deck.size * 0.8 : 0;
  const block = blockHeight(t) + (deck ? gap + (deck.lines.length - 1) * deck.lineHeight + deck.size * 0.25 : DESCENT * t.size);
  return { t, deck, gap, block };
}

/** The title and its deck from `top`; returns what they weigh and where the lines stand. */
function setWords(c: CoverKit, w: Words, top: number, p: Plan): { bytes: number; lines: { s: string; y: number }[] } {
  const ys = setHead(c, w.t, MARGIN, top, p.title, { width: MEASURE });
  const last = ys.at(-1)!;
  if (w.deck) setDeck(c, w.deck, MARGIN, last + w.gap, ensureContrast(p.title === p.p ? mix(p.p, c.inks.ink, 0.3) : p.title, c.inks.paper, MIN_TEXT), { width: MEASURE });
  return { bytes: headBytes(w.t, MARGIN, top) + deckBytes(c, w.deck, MARGIN, last + w.gap), lines: w.t.lines.map((s, k) => ({ s, y: ys[k]! })) };
}

/** The title once more, from the second drum, off register: its ghost, if the bytes allow it. */
function ghost(c: CoverKit, p: Plan, t: Fitted, lines: { s: string; y: number }[], room: number): void {
  if (isStdFont(t.face)) return;
  const dx = Math.max(1.5, t.size * 0.03);
  const dy = Math.max(1.2, t.size * 0.025);
  const d = lines.map((l) => outlineD(l.s, MARGIN + dx, l.y + dy, t.face, t.size, { track: t.track })).join('');
  if (d.length + 80 <= room) c.s.path(d, p.s, { op: GHOST });
}

const roomLeft = (c: CoverKit, words: number): number => SVG_LIMIT - kitBytes(c) - words - drawnBytes(c);

/**
 * The print, drawn at a screen of `cell` and again at a coarser one if it spends more than its share of `room`; past the
 * coarsest, coarser cuts and no dust, then a screen coarser still, then the first drum alone.
 */
function press(c: CoverKit, p: Plan, seed: string, room: number, draw: (s: Scene, pr: Press) => void): void {
  const run = (cell: number, level = 0): { s: Scene; bytes: number } => {
    const s = new Scene(COVER_W, COVER_H);
    draw(s, { p: p.p, s: p.s, o: p.o, paper: c.inks.paper, shift: p.shift, rnd: decoRng(hashString(seed)), k: 1, cell, per: [6, 3, 2, 2][level]!, dust: level === 0, screens: level < 3 });
    return { s, bytes: toSvg(s).length };
  };
  const fits = room * ART_SHARE;
  let cell = CELL;
  let best = run(cell);
  // dots go with the square of the cell: three tries close in on the room
  for (let k = 0; k < 3 && best.bytes > fits && cell < CELL * 4; k++) {
    cell = Math.min(CELL * 4, cell * Math.sqrt(best.bytes / fits) * 1.04);
    best = run(cell);
  }
  // this tight, the title's ghost will not fit anyway: the print may take the whole room
  for (const [coarse, level] of [[CELL * 4, 1], [CELL * 8, 2], [CELL * 8, 3]] as const) if (best.bytes > room) best = run(coarse, level);
  c.s.ops.push(...best.s.ops);
}

const artFor = (p: Plan, t: Fitted, ground: string, sticker: { u: number; v: number }): CoverArt =>
  ({ rows: 0, art: artOf(p), titleSize: t.size, titleLines: t.lines, titleWidths: t.widths, titleFace: t.face, titleInk: p.title, titleGround: ground, sticker });

/** The title on top, the art under it in what is left. */
function head(c: CoverKit, call: CoverCall, p: Plan, max: number, artMin: number) {
  c.labels(LABEL_Y, { ink: p.title });
  const foot = c.audience(FOOT, MEASURE, 2, { ink: p.title });
  const w = fitWords(c, call, foot - 30 - TITLE_TOP - artMin, max);
  const set = setWords(c, w, TITLE_TOP, p);
  const top = TITLE_TOP + w.block + 30;
  return { w, set, top, room: foot - 26 - top, foot };
}

/** « Soleil »: a sun of dots from the second drum behind the motif in the first, overprinted where they cross. */
function sun(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { w, set, top, room } = head(c, call, p, 112, 330);
  press(c, p, `riso|draw|${call.seed}|0`, roomLeft(c, set.bytes) * 0.8, (s, pr) => {
    // the sun runs off one side, the motif stands in front of its inner half: the overprint is where they cross
    const r = Math.min(room * 0.5, 230) * p.size;
    const cx = COVER_W / 2 + p.side * (COVER_W / 2 - r * 0.72);
    const cy = top + room * 0.44;
    const side = Math.min(room * 0.92, 380, r * 2) * p.scale;
    const mx = Math.max(MARGIN + side * 0.36, Math.min(COVER_W - MARGIN - side * 0.36, cx - p.side * r * 0.9));
    const st = stencil(c.d.motif, { x: mx - side / 2, y: top + room - side - 4, w: side, h: side }, p.turn, pr.per);
    solid(s, pr, st);
    const tone = discTone(cx, cy, r, p.lean, 0.82);
    const dots = halftone({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, { cell: pr.cell, angle: 45, tone }, () => true, pr.shift);
    screen(s, pr, dots, [st]);
  });
  ghost(c, p, w.t, set.lines, roomLeft(c, set.bytes));
  return artFor(p, w.t, c.inks.paper, { u: p.side > 0 ? 0.2 : 0.8, v: 0.9 });
}

/** « Trame »: a field of dots rising from the foot to the title, the motif standing in it, printed over it. */
function trame(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { w, set, top, room } = head(c, call, p, 108, 340);
  press(c, p, `riso|draw|${call.seed}|1`, roomLeft(c, set.bytes) * 0.8, (s, pr) => {
    const fieldTop = top + room * (1 - 0.72 * p.size);
    const fieldBottom = top + room;
    const side = Math.min(room * 0.9, 370) * p.scale;
    const mx = COVER_W / 2 + p.side * 70;
    const st = stencil(c.d.motif, { x: mx - side / 2, y: fieldBottom - side - 2, w: side, h: side }, p.turn, pr.per);
    solid(s, pr, st);
    const span = fieldBottom - fieldTop;
    // from nothing at its top to solid at its foot: the field has no edge but the page's
    const tone = (_x: number, y: number) => (y < fieldTop || y > fieldBottom ? 0 : 0.92 * ((y - fieldTop) / span) ** 1.25);
    const dots = halftone({ x: 0, y: fieldTop, w: COVER_W, h: span }, { cell: pr.cell * 1.15, angle: 45, tone }, () => true, pr.shift);
    screen(s, pr, dots, [st]);
  });
  ghost(c, p, w.t, set.lines, roomLeft(c, set.bytes));
  return artFor(p, w.t, c.inks.paper, { u: p.side > 0 ? 0.2 : 0.8, v: 0.9 });
}

/** « Duo »: the motif printed twice, solid from the first drum and in dots from the second, off register. */
function duo(c: CoverKit, call: CoverCall, p: Plan): CoverArt {
  const { w, set, top, room } = head(c, call, p, 104, 360);
  press(c, p, `riso|draw|${call.seed}|2`, roomLeft(c, set.bytes) * 0.8, (s, pr) => {
    // the motif's own ink fills the room, whatever empty corners its box has
    const b = boundsOf(motifShape(c.d.motif));
    const ink = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    const side = (Math.min(room * 0.9, 430) * p.scale) / ink;
    const cx = COVER_W / 2 + p.side * 14 - ((b.x0 + b.x1) / 2 - 0.5) * side;
    const cy = top + room / 2 - ((b.y0 + b.y1) / 2 - 0.5) * side;
    const off = side * ink * 0.035;
    const box = { x: cx - side / 2 - off, y: cy - side / 2 - off, w: side, h: side };
    const st = stencil(c.d.motif, box, p.turn, pr.per);
    solid(s, pr, st);
    const screened = stencil(c.d.motif, { ...box, x: box.x + 2 * off, y: box.y + 2 * off }, p.turn, pr.per);
    const lean = p.lean;
    const tone = (x: number, y: number) => 0.32 + 0.58 * clamp01(0.5 + ((x - cx) * lean[0] + (y - cy) * lean[1]) / side);
    const dots = halftone({ x: box.x + 2 * off - 4, y: box.y + 2 * off - 4, w: side + 8, h: side + 8 }, { cell: pr.cell * 0.9, angle: 45, tone }, (x, y) => screened.inked(x, y), pr.shift);
    screen(s, pr, dots, [st]);
  });
  ghost(c, p, w.t, set.lines, roomLeft(c, set.bytes));
  return artFor(p, w.t, c.inks.paper, { u: 0.82, v: 0.9 });
}

// ───────────────────────────── plates ─────────────────────────────

/**
 * A plate: paper, a field or a sun of dots from the second drum, the motif solid from the first where the page wants its
 * figure, overprinted where they cross. The seed and the chapter choose the screen; nothing leaves the rectangle.
 */
function plate(s: Scene, sp: PlateSpec): void {
  const { x, y, u, cols, rows, inks, motif, seed, hero, role } = sp;
  const w = cols * u;
  const hh = rows * u;
  const rnd = decoRng(hashString(`riso|plate|${seed}|${hero?.pick ?? 0}|${role}`));
  const r = Array.from({ length: 6 }, rnd);
  const p = planOf(inks, seed, 0);
  const k = u / 100;
  const pr: Press = { p: p.p, s: p.s, o: p.o, paper: inks.paper, shift: [p.shift[0] * k, p.shift[1] * k], rnd, k, cell: CELL * k, per: 6, dust: true, screens: true };
  const rect = `M${n(x)} ${n(y)}h${n(w)}v${n(hh)}h${n(-w)}Z`;
  s.path(rect, inks.paper);
  s.clip(rect, (cl) => {
    const side = hero ? hero.s * u * 0.9 : Math.min(hh * 0.8, w * 0.3);
    const at = hero ? { x: x + (hero.c + hero.s / 2) * u, y: y + (hero.r + hero.s / 2) * u } : { x: x + w * (r[0]! < 0.5 ? 0.24 : 0.76), y: y + hh / 2 };
    const st = stencil(motif, { x: at.x - side / 2, y: at.y - side / 2, w: side, h: side }, (r[1]! - 0.5) * 14, 6);
    solid(cl, pr, st);
    const tall = hh > w * 1.2;
    const sunny = r[2]! < 0.5;
    let dots: { x: number; y: number; d: number }[];
    if (tall) {
      // a frame: a field falling from its head to nothing, and a sun behind the figure at its foot
      const fade = (_px: number, py: number) => 0.86 * clamp01(1 - (py - y) / (hh * 0.55)) ** 1.3;
      const rr = Math.max(side * 0.7, w * 0.42);
      const cx = at.x + (at.x < x + w / 2 ? 1 : -1) * side * 0.4;
      const sun = discTone(cx, at.y - side * 0.1, rr, p.lean, 0.8);
      dots = halftone({ x, y, w, h: hh }, { cell: pr.cell * 1.15, angle: 45, tone: (px, py) => Math.max(fade(px, py), sun(px, py)) }, () => true, pr.shift);
    } else if (sunny) {
      const rr = Math.max(side * 0.7, Math.min(w, hh) * 0.46);
      const cx = at.x + (at.x < x + w / 2 ? 1 : -1) * side * 0.45;
      const cy = at.y - side * 0.12;
      dots = halftone({ x: cx - rr, y: cy - rr, w: 2 * rr, h: 2 * rr }, { cell: pr.cell, angle: 45, tone: discTone(cx, cy, rr, p.lean, 0.8) }, () => true, pr.shift);
    } else {
      // a field of dots across the plate, rising toward the edge the figure stands on
      const down = at.y > y + hh / 2;
      const tone = (_px: number, py: number) => 0.06 + 0.78 * clamp01(down ? (py - y) / hh : 1 - (py - y) / hh) ** 1.2;
      dots = halftone({ x, y, w, h: hh }, { cell: pr.cell * 1.15, angle: 45, tone }, () => true, pr.shift);
    }
    screen(cl, pr, dots, [st]);
  });
}

export const riso: ArtStyleDef = {
  id: 'riso',
  compositions: [{ id: 'soleil', label: 'Soleil' }, { id: 'trame', label: 'Trame' }, { id: 'duo', label: 'Duo' }],
  defaultComposition: (d) => hashString(`riso|composition|${d.seed}`) % 3,
  cover: (c, call) => {
    const p = planOf(c.inks, call.seed, call.composition);
    return call.composition === 1 ? trame(c, call, p) : call.composition === 2 ? duo(c, call, p) : sun(c, call, p);
  },
  plate,
  candidate: (_d, inks, seed, composition) => artOf(planOf(inks, seed, composition)),
};
