/**
 * Silhouettes (design plan D200): every motif of `DesignSpec` and the ornaments every style may use, as plain vector shapes in
 * a unit box, so that any style can fill them, outline them, screen them in dots or cut them in paper. Each has a body, the
 * holes that sit on it in another ink, the lines drawn over it, and the marks that are part of it though open (steam, an
 * arrow). Drawn once, in a box of 100, and kept in a box of 1.
 */
import type { Motif } from '../design.js';
import { decoRng, hashString } from '../text.js';
import { n, type Paint, type Scene } from '../scene.js';

/** One command, absolute, in the unit box. */
export type Seg = readonly ['M', number, number] | readonly ['L', number, number] | readonly ['C', number, number, number, number, number, number] | readonly ['Z'];
export type UnitPath = readonly Seg[];

/**
 * `body` is filled (nonzero); `holes` sit on it in the ground's ink or another; `lines` are open strokes drawn over the body in
 * another ink; `marks` are open strokes in the body's own ink, beside it. Strokes are `weight` wide, in box units.
 */
export interface Silhouette { body: UnitPath; holes: UnitPath; lines: UnitPath; marks: UnitPath; weight: number }

export type Ornament = 'star' | 'sparkle' | 'burst' | 'blob' | 'squiggle' | 'arrow' | 'check' | 'tape';
export const ORNAMENTS: readonly Ornament[] = ['star', 'sparkle', 'burst', 'blob', 'squiggle', 'arrow', 'check', 'tape'];

export interface Box { x: number; y: number; w: number; h: number }
/** `rot` in degrees about the centre of the box, `flip` mirrors left to right, `stretch` fills a box that is not square. */
export interface Place { rot?: number; flip?: boolean; stretch?: boolean }

type Pt = [number, number];
type Path = Seg[];

const K = 0.5523;

// ───────────────────────────── building, in a box of 100 ─────────────────────────────

/** Hand-drawn outlines: absolute M L H V C Q Z, the way an SVG editor writes them. */
function parse(d: string): Path {
  const out: Path = [];
  let at: Pt = [0, 0];
  let start: Pt = [0, 0];
  for (const [, cmd, args] of d.matchAll(/([MLHVCQZ])([^MLHVCQZ]*)/g)) {
    const v = (args!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (cmd === 'M') { at = [v[0]!, v[1]!]; start = at; out.push(['M', ...at]); for (let i = 2; i < v.length; i += 2) { at = [v[i]!, v[i + 1]!]; out.push(['L', ...at]); } }
    else if (cmd === 'L') for (let i = 0; i < v.length; i += 2) { at = [v[i]!, v[i + 1]!]; out.push(['L', ...at]); }
    else if (cmd === 'H') for (const x of v) { at = [x, at[1]]; out.push(['L', ...at]); }
    else if (cmd === 'V') for (const y of v) { at = [at[0], y]; out.push(['L', ...at]); }
    else if (cmd === 'C') for (let i = 0; i < v.length; i += 6) { out.push(['C', v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!, v[i + 4]!, v[i + 5]!]); at = [v[i + 4]!, v[i + 5]!]; }
    else if (cmd === 'Q') {
      for (let i = 0; i < v.length; i += 4) {
        const [qx, qy, x, y] = [v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!];
        out.push(['C', at[0] + (2 / 3) * (qx - at[0]), at[1] + (2 / 3) * (qy - at[1]), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y]);
        at = [x, y];
      }
    } else { out.push(['Z']); at = start; }
  }
  return out;
}

/** An arc of a circle from angle `a0` to `a1` (radians, y down), in quarters at most: continues the current point. */
function arcSegs(cx: number, cy: number, r: number, a0: number, a1: number): Path {
  const parts = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Path = [];
  for (let i = 0; i < parts; i++) {
    const s = a0 + i * step;
    const e = s + step;
    const [x0, y0, x1, y1] = [cx + r * Math.cos(s), cy + r * Math.sin(s), cx + r * Math.cos(e), cy + r * Math.sin(e)];
    out.push(['C', x0 - k * r * Math.sin(s), y0 + k * r * Math.cos(s), x1 + k * r * Math.sin(e), y1 - k * r * Math.cos(e), x1, y1]);
  }
  return out;
}

/** `cw` false winds the other way: a disc inside a disc then cuts a ring under the nonzero rule. */
function circle(cx: number, cy: number, r: number, cw = true): Path {
  return [['M', cx + r, cy], ...arcSegs(cx, cy, r, 0, cw ? 2 * Math.PI : -2 * Math.PI), ['Z']];
}

function ellipse(cx: number, cy: number, rx: number, ry: number, deg = 0): Path {
  const a = (deg * Math.PI) / 180;
  const P = (x: number, y: number): Pt => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
  const C = (p: Pt, q: Pt, e: Pt): Seg => ['C', ...p, ...q, ...e];
  return [['M', ...P(-rx, 0)], C(P(-rx, -ry * K), P(-rx * K, -ry), P(0, -ry)), C(P(rx * K, -ry), P(rx, -ry * K), P(rx, 0)), C(P(rx, ry * K), P(rx * K, ry), P(0, ry)), C(P(-rx * K, ry), P(-rx, ry * K), P(-rx, 0)), ['Z']];
}

function roundRect(x: number, y: number, w: number, h: number, r: number): Path {
  const c = r * (1 - K);
  return [
    ['M', x + r, y], ['L', x + w - r, y], ['C', x + w - c, y, x + w, y + c, x + w, y + r], ['L', x + w, y + h - r],
    ['C', x + w, y + h - c, x + w - c, y + h, x + w - r, y + h], ['L', x + r, y + h], ['C', x + c, y + h, x, y + h - c, x, y + h - r],
    ['L', x, y + r], ['C', x, y + c, x + c, y, x + r, y], ['Z'],
  ];
}

const poly = (pts: readonly Pt[]): Path => [['M', ...pts[0]!], ...pts.slice(1).map((p): Seg => ['L', ...p]), ['Z']];

/** A star of `points` tips, the first one up. */
function starOf(cx: number, cy: number, points: number, outer: number, inner: number): Path {
  const pts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(pts);
}

/** Four arms that curve in to the centre: the twinkle of a sparkle. `w` is how full the arms are, 0..1. */
function twinkle(cx: number, cy: number, up: number, side: number, down = up, w = 0.12): Path {
  const q = (len: number) => len * w;
  return parse(`M${cx} ${cy - up}C${cx + q(side) * 0.4} ${cy - q(up) * 1.6} ${cx + q(side) * 1.6} ${cy - q(up) * 0.4} ${cx + side} ${cy}C${cx + q(side) * 1.6} ${cy + q(down) * 0.4} ${cx + q(side) * 0.4} ${cy + q(down) * 1.6} ${cx} ${cy + down}C${cx - q(side) * 0.4} ${cy + q(down) * 1.6} ${cx - q(side) * 1.6} ${cy + q(down) * 0.4} ${cx - side} ${cy}C${cx - q(side) * 1.6} ${cy - q(up) * 0.4} ${cx - q(side) * 0.4} ${cy - q(up) * 1.6} ${cx} ${cy - up}Z`);
}

/** A leaf blade from its base to its tip, `wid` the half width: two curves. */
function blade(base: Pt, tip: Pt, wid: number): Path {
  const [dx, dy] = [tip[0] - base[0], tip[1] - base[1]];
  const len = Math.hypot(dx, dy);
  const [ux, uy] = [dx / len, dy / len];
  const P = (t: number, w: number): Pt => [base[0] + ux * t * len - uy * w, base[1] + uy * t * len + ux * w];
  return [['M', ...base], ['C', ...P(0.22, -wid), ...P(0.7, -wid * 0.92), ...tip], ['C', ...P(0.7, wid * 0.92), ...P(0.22, wid), ...base], ['Z']];
}

/** The two circles' crossing points, the one first on the left of the line between their centres. */
function crossings(a: Pt, ra: number, b: Pt, rb: number): [Pt, Pt] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along = (d * d + ra * ra - rb * rb) / (2 * d);
  const across = Math.sqrt(Math.max(0, ra * ra - along * along));
  const [ux, uy] = [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  const mid: Pt = [a[0] + ux * along, a[1] + uy * along];
  return [[mid[0] + uy * across, mid[1] - ux * across], [mid[0] - uy * across, mid[1] + ux * across]];
}

/** The disc of `a` less the disc of `b`, as one outline: the crescent of a moon. */
function crescent(a: Pt, ra: number, b: Pt, rb: number): Path {
  const [p, q] = crossings(a, ra, b, rb);
  const ang = (c: Pt, x: Pt) => Math.atan2(x[1] - c[1], x[0] - c[0]);
  // round `a` the long way, away from `b`; back along `b`, inside `a`
  let a0 = ang(a, p);
  let a1 = ang(a, q);
  if (a1 > a0) a1 -= 2 * Math.PI;
  let b0 = ang(b, q);
  let b1 = ang(b, p);
  if (b1 < b0) b1 += 2 * Math.PI;
  return [['M', ...p], ...arcSegs(a[0], a[1], ra, a0, a1), ...arcSegs(b[0], b[1], rb, b0, b1), ['Z']];
}

/** A smooth closed curve through `pts`, Catmull-Rom made cubic. */
function smooth(pts: readonly Pt[]): Path {
  const at = (i: number) => pts[(i + pts.length) % pts.length]!;
  const out: Path = [['M', ...pts[0]!]];
  for (let i = 0; i < pts.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    out.push(['C', p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]]);
  }
  out.push(['Z']);
  return out;
}

/** From the box of 100 to the box of 1. */
const unitOf = (...paths: Path[]): UnitPath => paths.flat().map((s): Seg => (s[0] === 'Z' ? s : [s[0], ...(s.slice(1) as number[]).map((v) => v / 100)] as unknown as Seg));

const sil = (body: Path[], holes: Path[] = [], lines: Path[] = [], weight = 3, marks: Path[] = []): Silhouette =>
  ({ body: unitOf(...body), holes: unitOf(...holes), lines: unitOf(...lines), marks: unitOf(...marks), weight: weight / 100 });

// ───────────────────────────── the 14 motifs ─────────────────────────────

function moon(): Silhouette {
  return sil([crescent([46, 52], 42, [66, 38], 35)], [circle(17, 54, 5.5), circle(27, 73, 4), circle(42, 84, 3)]);
}

function sun(): Silhouette {
  const rays: Path[] = [];
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 6;
    const tip = i % 2 ? 40 : 47;
    const at = (r: number, t: number): Pt => [50 + r * Math.cos(t), 50 + r * Math.sin(t)];
    rays.push(poly([at(27, a - 0.13), at(tip, a), at(27, a + 0.13)]));
  }
  return sil([circle(50, 50, 22), ...rays], [circle(50, 50, 12.5)]);
}

function leaf(): Silhouette {
  const base: Pt = [24, 78];
  const tip: Pt = [86, 12];
  const stem = parse('M24.6 76.4L27 80L13.8 95.6L10.4 92.6Z');
  const len = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
  const [ux, uy] = [(tip[0] - base[0]) / len, (tip[1] - base[1]) / len];
  const at = (t: number, w: number): string => `${base[0] + ux * t * len - uy * w} ${base[1] + uy * t * len + ux * w}`;
  const veins: Path[] = [parse(`M${at(0.04, 0)}L${at(0.9, 0)}`)];
  // each vein leaves the midrib toward the tip and bends out to the edge, on both sides
  for (const t of [0.2, 0.38, 0.56, 0.72]) {
    const reach = 19 * (1 - t * 0.6);
    for (const side of [-1, 1]) veins.push(parse(`M${at(t, 0)}Q${at(t + 0.06, side * reach * 0.55)} ${at(t + 0.15, side * reach)}`));
  }
  return sil([blade(base, tip, 25), stem], [], veins, 2.6);
}

function coin(): Silhouette {
  const euro: Path = [
    ['M', 54 + 20 * Math.cos(0.75), 50 + 20 * Math.sin(0.75)], ...arcSegs(54, 50, 20, 0.75, 2 * Math.PI - 0.75),
    ['L', 54 + 13.5 * Math.cos(-0.75), 50 + 13.5 * Math.sin(-0.75)], ...arcSegs(54, 50, 13.5, 2 * Math.PI - 0.75, 0.75), ['Z'],
  ];
  return sil([circle(50, 50, 45)], [circle(50, 50, 38), circle(50, 50, 34.5, false), euro, roundRect(27, 41.5, 30, 5, 1.5), roundRect(27, 52.5, 27, 5, 1.5)]);
}

function heart(): Silhouette {
  return sil([parse('M50 90C22 72 6 56 6 36C6 20 18 9 32 9C40 9 46 13 50 20C54 13 60 9 68 9C82 9 94 20 94 36C94 56 78 72 50 90Z')], [], [parse('M19 37C18 28 24 21 32 20')], 4);
}

function bolt(): Silhouette {
  return sil([parse('M62 2L16 58L46 58L32 98L84 37L55 37L72 2Z')], [], [parse('M59 11L32 47')], 3.2);
}

function book(): Silhouette {
  const left = parse('M48 24C38 16 22 14 4 18L4 80C22 76 38 78 48 86Z');
  const right = parse('M52 24C62 16 78 14 96 18L96 80C78 76 62 78 52 86Z');
  const lines: Path[] = [];
  for (let k = 0; k < 4; k++) {
    const y = 32 + k * 11;
    lines.push(parse(`M13 ${y - 3}C22 ${y - 4.5} 32 ${y - 3.5} 40 ${y}`), parse(`M87 ${y - 3}C78 ${y - 4.5} 68 ${y - 3.5} 60 ${y}`));
  }
  return sil([left, right], [], lines, 2.8);
}

function chart(): Silhouette {
  const bars = [[6, 68], [29, 54], [52, 40], [75, 26]].map(([x, top]) => roundRect(x!, top!, 19, 96 - top!, 2));
  return sil(bars, [], [], 4.5, [parse('M8 50L31 33L49 38L84 8'), parse('M70 7L85 7L85 22')]);
}

function home(): Silhouette {
  const house = parse('M50 6L97 47L86 47L86 95L14 95L14 47L3 47Z');
  const chimney = parse('M67 12L78 12L78 34L67 26Z');
  const door = parse('M42 95L42 70C42 65.6 45.6 62 50 62C54.4 62 58 65.6 58 70L58 95Z');
  const panes = (x: number) => [[0, 0], [7, 0], [0, 7], [7, 7]].map(([dx, dy]) => roundRect(x + dx!, 55 + dy!, 5.5, 5.5, 0.6));
  return sil([house, chimney], [door, ...panes(21), ...panes(66)]);
}

function paw(): Silhouette {
  return sil([
    parse('M50 46C63 46 80 62 82 77C83 90 71 96 60 93C54 91.5 46 91.5 40 93C29 96 17 90 18 77C20 62 37 46 50 46Z'),
    ellipse(17, 45, 9.5, 13, -24), ellipse(37, 23, 10.5, 14.5, -8), ellipse(63, 23, 10.5, 14.5, 8), ellipse(83, 45, 9.5, 13, 24),
  ]);
}

function dumbbell(): Silhouette {
  return sil([
    roundRect(22, 45.5, 56, 9, 2.5), roundRect(13, 24, 10.5, 52, 3), roundRect(76.5, 24, 10.5, 52, 3),
    roundRect(4, 32, 8, 36, 3), roundRect(88, 32, 8, 36, 3), roundRect(1, 46, 4, 8, 1.5), roundRect(95, 46, 4, 8, 1.5),
  ], [], [parse('M16.5 30L16.5 70'), parse('M83.5 30L83.5 70')], 1.6);
}

function sparkle(): Silhouette {
  return sil([twinkle(40, 56, 44, 37, 40, 0.13), twinkle(80, 20, 15, 13, 15, 0.13), circle(85, 48, 4.5)]);
}

function brush(): Silhouette {
  // along a diagonal from the tip of the bristles, low on the left, to the end of the handle
  const [x, y, len] = [9, 91, 115];
  const a = (-45 * Math.PI) / 180;
  const P = (t: number, w: number): string => `${x + len * (t * Math.cos(a) - w * Math.sin(a))} ${y + len * (t * Math.sin(a) + w * Math.cos(a))}`;
  const bristles = parse(`M${P(0, -0.07)}C${P(0.04, -0.11)} ${P(0.2, -0.115)} ${P(0.3, -0.08)}L${P(0.3, 0.08)}C${P(0.2, 0.115)} ${P(0.04, 0.11)} ${P(0, 0.07)}C${P(0.03, 0.03)} ${P(-0.02, -0.03)} ${P(0, -0.07)}Z`);
  const ferrule = parse(`M${P(0.315, -0.078)}L${P(0.45, -0.066)}L${P(0.45, 0.066)}L${P(0.315, 0.078)}Z`);
  const handle = parse(`M${P(0.46, -0.062)}C${P(0.58, -0.092)} ${P(0.7, -0.072)} ${P(0.96, -0.032)}C${P(1.01, -0.024)} ${P(1.01, 0.024)} ${P(0.96, 0.032)}C${P(0.7, 0.072)} ${P(0.58, 0.092)} ${P(0.46, 0.062)}Z`);
  const band = (t: number) => parse(`M${P(t, -0.085)}L${P(t + 0.016, -0.085)}L${P(t + 0.016, 0.085)}L${P(t, 0.085)}Z`);
  return sil([bristles, ferrule, handle], [band(0.36), band(0.4)]);
}

function pot(): Silhouette {
  const bowl = parse('M16 50L84 50L80.5 86C80 92 75.5 96 69.5 96L30.5 96C24.5 96 20 92 19.5 86Z');
  const lid = parse('M10 46C13 36 30 31 50 31C70 31 87 36 90 46Z');
  const steam = ['M34 22C30 17 38 12 34 6', 'M50 20C46 15 54 10 50 4', 'M66 22C62 17 70 12 66 6'].map(parse);
  return sil([bowl, lid, circle(50, 28, 5), roundRect(3, 56, 14, 8.5, 4.2), roundRect(83, 56, 14, 8.5, 4.2)], [parse('M17.2 60L82.8 60L82.5 64L17.5 64Z')], [], 3, steam);
}

const MOTIF_SHAPES: Record<Motif, () => Silhouette> = { moon, sun, leaf, coin, heart, bolt, book, chart, home, paw, dumbbell, sparkle, brush, pot };
const cache = new Map<string, Silhouette>();

/** The motif's own silhouette: every motif has its own, none borrows another's. */
export function motifShape(m: Motif): Silhouette {
  const known = cache.get(m);
  if (known) return known;
  const shape = (MOTIF_SHAPES[m] ?? MOTIF_SHAPES.sparkle)();
  cache.set(m, shape);
  return shape;
}

// ───────────────────────────── ornaments ─────────────────────────────

function tape(): Path {
  const teeth = 5;
  const step = 32 / (teeth * 2);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= teeth * 2; i++) {
    left.push([i % 2 ? 6 : 2, 66 - i * step]);
    right.push([i % 2 ? 94 : 98, 34 + i * step]);
  }
  return poly([...right, ...left]);
}

function squiggle(): Path {
  const waves = 6;
  const w = 92 / waves;
  let d = 'M4 50';
  for (let i = 0; i < waves; i++) d += `Q${4 + w * (i + 0.5)} ${i % 2 ? 76 : 24} ${4 + w * (i + 1)} 50`;
  return parse(d);
}

/** A blob of paper or ink: its own outline for each `seed`, never wider than its box. */
function blob(seed: number): Path {
  const rnd = decoRng(hashString(`blob|${seed}`));
  const count = 7;
  const turn = rnd() * Math.PI * 2;
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = turn + ((i + (rnd() - 0.5) * 0.5) * 2 * Math.PI) / count;
    const r = 28 + rnd() * 17;
    pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return smooth(pts);
}

/** An ornament in its unit box. `seed` shapes the blob, the others are always the same. */
export function ornament(kind: Ornament, seed = 0): Silhouette {
  switch (kind) {
    case 'star': return sil([starOf(50, 53, 5, 48, 19.5)]);
    case 'sparkle': return sil([twinkle(50, 50, 48, 48, 48, 0.12)]);
    case 'burst': return sil([starOf(50, 50, 18, 49, 41)]);
    case 'blob': return sil([blob(seed)]);
    case 'squiggle': return sil([], [], [], 7, [squiggle()]);
    case 'arrow': return sil([], [], [], 6, [parse('M8 86C26 48 52 26 88 18'), parse('M70 8L88 18L78 36')]);
    case 'check': return sil([], [], [], 11, [parse('M12 54L38 80L90 18')]);
    case 'tape': return sil([tape()]);
  }
}

// ───────────────────────────── placing ─────────────────────────────

/** Where (u, v) of the unit box lands in `box`: fitted whole and centred, turned, mirrored. */
export function placer(box: Box, o: Place = {}): (u: number, v: number) => [number, number] {
  const side = Math.min(box.w, box.h);
  const [sx, sy] = o.stretch ? [box.w, box.h] : [side, side];
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
  const a = ((o.rot ?? 0) * Math.PI) / 180;
  const [cs, sn] = [Math.cos(a), Math.sin(a)];
  return (u, v) => {
    const x = ((o.flip ? 1 - u : u) - 0.5) * sx;
    const y = (v - 0.5) * sy;
    return [cx + x * cs - y * sn, cy + x * sn + y * cs];
  };
}

/** The path drawn in `box`, as `d`. */
export function pathD(p: UnitPath, box: Box, o: Place = {}): string {
  const at = placer(box, o);
  const P = (u: number, v: number) => at(u, v).map(n).join(' ');
  return p.map((s) => (s[0] === 'Z' ? 'Z' : s[0] === 'C' ? `C${P(s[1], s[2])} ${P(s[3], s[4])} ${P(s[5], s[6])}` : `${s[0]}${P(s[1], s[2])}`)).join('');
}

/** Points along a unit path, curves sampled: where its ink can reach. */
export function samples(p: UnitPath, per = 12): [number, number][] {
  const out: [number, number][] = [];
  let at: [number, number] = [0, 0];
  let start = at;
  for (const s of p) {
    if (s[0] === 'M') { at = [s[1], s[2]]; start = at; out.push(at); }
    else if (s[0] === 'L') { at = [s[1], s[2]]; out.push(at); }
    else if (s[0] === 'C') {
      for (let k = 1; k <= per; k++) {
        const t = k / per;
        const u = 1 - t;
        out.push([u * u * u * at[0] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5], u * u * u * at[1] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6]]);
      }
      at = [s[5], s[6]];
    } else at = start;
  }
  return out;
}

const boundsCache = new WeakMap<Silhouette, { x0: number; y0: number; x1: number; y1: number }>();

/** The box a silhouette's ink really fills, in unit coordinates: its strokes' width counted. */
export function boundsOf(shape: Silhouette): { x0: number; y0: number; x1: number; y1: number } {
  const known = boundsCache.get(shape);
  if (known) return known;
  const half = shape.weight / 2;
  const pts: [number, number, number][] = [...samples(shape.body), ...samples(shape.holes)].map(([x, y]): [number, number, number] => [x, y, 0])
    .concat([...samples(shape.lines), ...samples(shape.marks)].map(([x, y]): [number, number, number] => [x, y, half]));
  const b = {
    x0: Math.min(...pts.map(([x, , w]) => x - w)), y0: Math.min(...pts.map(([, y, w]) => y - w)),
    x1: Math.max(...pts.map(([x, , w]) => x + w)), y1: Math.max(...pts.map(([, y, w]) => y + w)),
  };
  boundsCache.set(shape, b);
  return b;
}

/**
 * What to draw a silhouette in. A style leaves out what it does not draw: no `body` and an `outline` is a line drawing.
 * `marks` default to the body's colour, else the outline's.
 */
export interface ShapeInk { body?: Paint; holes?: Paint; lines?: string; marks?: string; outline?: string; sw?: number; op?: number }

/** Body, holes, lines, then marks, in `box`. Strokes scale with the box; `sw` is the outline's width in points. */
export function drawShape(s: Scene, shape: Silhouette, box: Box, ink: ShapeInk, o: Place = {}): void {
  const scale = Math.min(box.w, box.h);
  const outline = ink.outline ? { stroke: ink.outline, sw: ink.sw ?? scale * 0.03, cap: 'round' as const } : {};
  const op = ink.op === undefined ? {} : { op: ink.op };
  if (shape.body.length && (ink.body || ink.outline)) s.path(pathD(shape.body, box, o), ink.body, { ...outline, ...op });
  if (shape.holes.length && (ink.holes || ink.outline)) s.path(pathD(shape.holes, box, o), ink.holes, { ...outline, ...op });
  const stroke = { sw: shape.weight * scale, cap: 'round' as const, ...op };
  const lines = ink.lines ?? ink.outline;
  if (shape.lines.length && lines) s.path(pathD(shape.lines, box, o), undefined, { stroke: lines, ...stroke });
  const marks = ink.marks ?? (typeof ink.body === 'string' ? ink.body : ink.outline);
  if (shape.marks.length && marks) s.path(pathD(shape.marks, box, o), undefined, { stroke: marks, ...stroke });
}
