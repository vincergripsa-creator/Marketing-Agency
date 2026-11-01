/**
 * The tile language (pdf §6): flat inks on a strict unit grid. Each family of motifs has its own bag of tiles, cut from
 * squares and quarter circles, so that a paw guide has small paws and never stars, and a field reads as one printed block.
 */
import { circleD, ellipseD, n, type Scene } from '../scene.js';
import type { Motif } from '../design.js';

export type Corner = 0 | 1 | 2 | 3;
export type DrawnMotif = 'moon' | 'sun' | 'paw' | 'heart' | 'leaf' | 'coin' | 'chart' | 'home' | 'brush';
export type TileKind = 'motif' | 'quarter' | 'half' | 'disc' | 'spot' | 'arcs' | 'dots' | 'ring' | 'stripes' | 'stairs';
type Grammar = 'ciel' | 'empreinte' | 'herbier' | 'module';

/** Nine drawings carry the 14 motifs of `DesignSpec`: the other five wear the closest one. */
export const DRAWN_AS: Record<Motif, DrawnMotif> = {
  moon: 'moon', sun: 'sun', paw: 'paw', heart: 'heart', leaf: 'leaf', coin: 'coin', chart: 'chart', home: 'home',
  brush: 'brush', sparkle: 'sun', pot: 'leaf', bolt: 'chart', book: 'chart', dumbbell: 'coin',
};

const GRAMMAR_OF: Record<DrawnMotif, Grammar> = { moon: 'ciel', sun: 'ciel', paw: 'empreinte', heart: 'empreinte', leaf: 'herbier', coin: 'module', chart: 'module', home: 'module', brush: 'module' };

/** What a family draws on its tiles, with weights that add up to 1. */
const BAGS: Record<Grammar, readonly (readonly [TileKind, number])[]> = {
  ciel: [['motif', 0.26], ['arcs', 0.28], ['half', 0.2], ['spot', 0.14], ['dots', 0.12]],
  empreinte: [['quarter', 0.36], ['motif', 0.14], ['disc', 0.18], ['arcs', 0.18], ['dots', 0.14]],
  herbier: [['motif', 0.5], ['quarter', 0.22], ['arcs', 0.16], ['dots', 0.12]],
  module: [['ring', 0.32], ['stripes', 0.23], ['stairs', 0.25], ['quarter', 0.2]],
};

/** The kind of tile a draw in 0..1 falls on, with its rank in the bag: what the evaluator reads back. */
export function tileOf(motif: DrawnMotif, draw: number): { kind: TileKind; rank: number } {
  const bag = BAGS[GRAMMAR_OF[motif]];
  let left = draw;
  for (const [rank, [kind, weight]] of bag.entries()) {
    left -= weight;
    if (left < 0) return { kind, rank };
  }
  return { kind: bag[bag.length - 1]![0], rank: bag.length - 1 };
}

const corners = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

/** Quarter disc anchored on corner `c`. */
export function quarterD(x: number, y: number, s: number, c: Corner): string {
  const [ax, ay] = corners(x, y, s)[c]!;
  const dx = c === 0 || c === 3 ? s : -s;
  const dy = c === 0 || c === 1 ? s : -s;
  const k = 0.5523;
  return `M${n(ax)} ${n(ay)}L${n(ax + dx)} ${n(ay)}C${n(ax + dx)} ${n(ay + dy * k)} ${n(ax + dx * k)} ${n(ay + dy)} ${n(ax)} ${n(ay + dy)}Z`;
}

/** Half disc filling the side `dir` of the square, 0 up then clockwise. */
export function halfD(x: number, y: number, s: number, dir: Corner): string {
  const r = s / 2;
  const k = 0.5523 * r;
  const cx = x + r;
  const cy = y + r;
  if (dir === 0) return `M${n(x)} ${n(cy)}C${n(x)} ${n(cy - k)} ${n(cx - k)} ${n(y)} ${n(cx)} ${n(y)}C${n(cx + k)} ${n(y)} ${n(x + s)} ${n(cy - k)} ${n(x + s)} ${n(cy)}Z`;
  if (dir === 2) return `M${n(x)} ${n(cy)}C${n(x)} ${n(cy + k)} ${n(cx - k)} ${n(y + s)} ${n(cx)} ${n(y + s)}C${n(cx + k)} ${n(y + s)} ${n(x + s)} ${n(cy + k)} ${n(x + s)} ${n(cy)}Z`;
  if (dir === 1) return `M${n(cx)} ${n(y)}C${n(cx + k)} ${n(y)} ${n(x + s)} ${n(cy - k)} ${n(x + s)} ${n(cy)}C${n(x + s)} ${n(cy + k)} ${n(cx + k)} ${n(y + s)} ${n(cx)} ${n(y + s)}Z`;
  return `M${n(cx)} ${n(y)}C${n(cx - k)} ${n(y)} ${n(x)} ${n(cy - k)} ${n(x)} ${n(cy)}C${n(x)} ${n(cy + k)} ${n(cx - k)} ${n(y + s)} ${n(cx)} ${n(y + s)}Z`;
}

/** A vesica from corner to corner of the square. */
export function vesicaD(x: number, y: number, s: number, flip: boolean): string {
  return flip
    ? `M${n(x + s)} ${n(y)}C${n(x + s * 0.2)} ${n(y)} ${n(x)} ${n(y + s * 0.2)} ${n(x)} ${n(y + s)}C${n(x + s * 0.8)} ${n(y + s)} ${n(x + s)} ${n(y + s * 0.8)} ${n(x + s)} ${n(y)}Z`
    : `M${n(x)} ${n(y)}C${n(x)} ${n(y + s * 0.8)} ${n(x + s * 0.2)} ${n(y + s)} ${n(x + s)} ${n(y + s)}C${n(x + s)} ${n(y + s * 0.2)} ${n(x + s * 0.8)} ${n(y)} ${n(x)} ${n(y)}Z`;
}

/** Leaf from its base, along an angle in degrees: two curves, no outline. */
export function leafAt(x: number, y: number, len: number, wid: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const P = (u: number, v: number) => `${n(x + u * cs - v * sn)} ${n(y + u * sn + v * cs)}`;
  return `M${P(0, 0)}C${P(len * 0.25, -wid)} ${P(len * 0.72, -wid)} ${P(len, 0)}C${P(len * 0.72, wid)} ${P(len * 0.25, wid)} ${P(0, 0)}Z`;
}

/** The constructed heart: a square on its corner, a half disc on each upper side. `size` is its full width. */
export function heartD(cx: number, cy: number, size: number): string {
  const side = size / (1 + Math.SQRT1_2);
  const half = side * Math.SQRT1_2; // half a diagonal of the square
  const lobe = half / 2;            // a lobe sits on the middle of its side
  const y = cy + side * 0.073;      // the height of the shape, centred
  // same way round as `circleD`: the overlaps stay filled under the nonzero rule
  const diamond = `M${n(cx - half)} ${n(y)}L${n(cx)} ${n(y - half)}L${n(cx + half)} ${n(y)}L${n(cx)} ${n(y + half)}Z`;
  return circleD(cx - lobe, y - lobe, side / 2) + diamond + circleD(cx + lobe, y - lobe, side / 2);
}

export function arcs(s: Scene, x: number, y: number, size: number, c: Corner, color: string, count: number, sw: number): void {
  const [ax, ay] = corners(x, y, size)[c]!;
  const dx = c === 0 || c === 3 ? 1 : -1;
  const dy = c === 0 || c === 1 ? 1 : -1;
  s.clip(`M${n(x)} ${n(y)}h${n(size)}v${n(size)}h${n(-size)}Z`, (cl) => {
    for (let i = 1; i <= count; i++) {
      const r = (size * i) / count;
      const k = 0.5523 * r;
      cl.path(`M${n(ax + dx * r)} ${n(ay)}C${n(ax + dx * r)} ${n(ay + dy * k)} ${n(ax + dx * k)} ${n(ay + dy * r)} ${n(ax)} ${n(ay + dy * r)}`, undefined, { stroke: color, sw });
    }
  });
}

function dots(s: Scene, x: number, y: number, size: number, count: number, color: string, r: number): void {
  const g = size / count;
  let d = '';
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) d += circleD(x + g * (i + 0.5), y + g * (j + 0.5), r);
  s.path(d, color);
}

function stripes(s: Scene, x: number, y: number, size: number, count: number, color: string, vertical: boolean): void {
  const g = size / (count * 2);
  let d = '';
  for (let i = 0; i < count; i++) d += vertical ? `M${n(x + g * (2 * i + 0.5))} ${n(y)}h${n(g)}v${n(size)}h${n(-g)}Z` : `M${n(x)} ${n(y + g * (2 * i + 0.5))}h${n(size)}v${n(g)}h${n(-size)}Z`;
  s.path(d, color);
}

function stairs(s: Scene, x: number, y: number, size: number, color: string): void {
  let d = '';
  for (let i = 0; i < 4; i++) d += `M${n(x + (i * size) / 4)} ${n(y + size - ((i + 1) * size) / 4)}h${n(size / 4)}v${n(((i + 1) * size) / 4)}h${n(-size / 4)}Z`;
  s.path(d, color);
}

/** Diamond halftone: four segments against a circle's four curves. `ramp` gives the weight at (u, v) in 0..1. */
export function halftone(s: Scene, x: number, y: number, w: number, h: number, step: number, color: string, ramp: (u: number, v: number) => number): void {
  let d = '';
  for (let j = 0; j * step < h + step; j++) {
    for (let i = 0; i * step < w + step; i++) {
      const px = i * step + (j % 2 ? step / 2 : 0);
      const py = j * step;
      const t = ramp(px / w, py / h);
      if (t <= 0.02) continue;
      const r = step * 0.72 * Math.min(1, t);
      d += `M${n(x + px)} ${n(y + py - r)}L${n(x + px + r)} ${n(y + py)}L${n(x + px)} ${n(y + py + r)}L${n(x + px - r)} ${n(y + py)}Z`;
    }
  }
  s.path(d, color);
}

function pawD(cx: number, cy: number, size: number, rot: number): string {
  const a = (rot * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const k = size / 100;
  const at = (x: number, y: number): [number, number] => {
    const X = (x - 50) * k;
    const Y = (y - 56) * k;
    return [cx + X * cs - Y * sn, cy + X * sn + Y * cs];
  };
  const P = (x: number, y: number) => at(x, y).map(n).join(' ');
  const pad = `M${P(50, 45)}C${P(63, 45)} ${P(80, 61)} ${P(82, 76)}C${P(83, 89)} ${P(71, 95)} ${P(60, 92)}C${P(54, 90.5)} ${P(46, 90.5)} ${P(40, 92)}C${P(29, 95)} ${P(17, 89)} ${P(18, 76)}C${P(20, 61)} ${P(37, 45)} ${P(50, 45)}Z`;
  const toe = (x: number, y: number, rx: number, ry: number, r: number) => ellipseD(...at(x, y), rx * k, ry * k, r + rot);
  return pad + toe(17, 44, 9.5, 13, -24) + toe(37, 23, 10.5, 14.5, -8) + toe(63, 23, 10.5, 14.5, 8) + toe(83, 44, 9.5, 13, 24);
}

export function paw(s: Scene, cx: number, cy: number, size: number, color: string, rot = 0): void {
  s.path(pawD(cx, cy, size, rot), color);
}

export function crescent(s: Scene, cx: number, cy: number, r: number, off: number, fg: string, bg: string): void {
  s.circle(cx, cy, r, fg);
  s.circle(cx + off, cy - off * 0.35, r * 0.86, bg);
}

/** A small sun: disc and eight short rays, the tile that says `sun` where a moon guide has its crescent. */
function sunletD(cx: number, cy: number, r: number): string {
  let d = circleD(cx, cy, r * 0.56);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const P = (dist: number, side: number) => `${n(cx + dist * Math.cos(a) - side * Math.sin(a))} ${n(cy + dist * Math.sin(a) + side * Math.cos(a))}`;
    d += `M${P(r * 0.72, -r * 0.09)}L${P(r, -r * 0.09)}L${P(r, r * 0.09)}L${P(r * 0.72, r * 0.09)}Z`;
  }
  return d;
}

const TILT = [-24, -10, 12, 26];

export interface Tile { kind: TileKind; x: number; y: number; u: number; fg: string; bg: string; motif: DrawnMotif; corner: Corner; pick: number }

/** Draws what sits on a ground. `pick` is one more draw in 0..1, for the tilt of a small paw. */
export function drawTile(s: Scene, t: Tile): void {
  const { kind, x, y, u, fg, bg, motif, corner, pick } = t;
  const box = `M${n(x)} ${n(y)}h${n(u)}v${n(u)}h${n(-u)}Z`;
  const cx = x + u / 2;
  const cy = y + u / 2;
  switch (kind) {
    case 'quarter': s.path(quarterD(x, y, u, corner), fg); return;
    case 'half': s.path(halfD(x, y, u, corner), fg); return;
    case 'disc': s.circle(cx, cy, u * 0.36, fg); return;
    case 'spot': s.circle(cx, cy, u * 0.13, fg); return;
    case 'arcs': arcs(s, x, y, u, corner, fg, GRAMMAR_OF[motif] === 'empreinte' ? 4 : 5, u * 0.05); return;
    case 'dots': dots(s, x, y, u, 4, fg, u * 0.05); return;
    case 'ring':
      s.circle(cx, cy, u * 0.4, fg);
      s.circle(cx, cy, u * 0.27, undefined, { stroke: bg, sw: u * 0.04 });
      return;
    case 'stripes': stripes(s, x, y, u, 5, fg, corner % 2 === 0); return;
    case 'stairs': stairs(s, x, y, u, fg); return;
    case 'motif':
      if (motif === 'moon') s.clip(box, (cl) => crescent(cl, x + u * 0.46, cy, u * 0.36, u * 0.17, fg, bg));
      else if (motif === 'sun') s.path(sunletD(cx, cy, u * 0.4), fg);
      else if (motif === 'paw') paw(s, cx, cy + u * 0.02, u * 0.72, fg, TILT[Math.floor(pick * TILT.length)]!);
      else if (motif === 'heart') s.path(heartD(cx, cy, u * 0.66), fg);
      else s.path(vesicaD(x + u * 0.06, y + u * 0.06, u * 0.88, corner % 2 === 0), fg);
  }
}

/**
 * A brush along a diagonal, its tip on (x, y), `len` long: three pieces in order from the tip, bristles, ferrule, handle, each
 * a closed path. `tuft` widens the bristles and `reach` scales the handle, for a brush too small to read by its detail.
 */
export function brushD(x: number, y: number, len: number, deg: number, tuft = 1, reach = 1): { bristles: string; ferrule: string; handle: string } {
  const a = (deg * Math.PI) / 180;
  const P = (t: number, w: number) => `${n(x + len * (t * Math.cos(a) - w * Math.sin(a)))} ${n(y + len * (t * Math.sin(a) + w * Math.cos(a)))}`;
  const B = (t: number, w: number) => P(t, w * tuft);
  const H = (t: number, w: number) => P(0.45 + (t - 0.45) * reach, w);
  return {
    bristles: `M${B(0, -0.075)}C${B(0.03, -0.1)} ${B(0.2, -0.105)} ${B(0.3, -0.075)}L${B(0.3, 0.075)}C${B(0.2, 0.105)} ${B(0.03, 0.1)} ${B(0, 0.075)}C${B(0.025, 0.03)} ${B(-0.02, -0.03)} ${B(0, -0.075)}Z`,
    ferrule: `M${P(0.31, -0.072)}L${P(0.44, -0.062)}L${P(0.44, 0.062)}L${P(0.31, 0.072)}Z`,
    handle: `M${H(0.45, -0.06)}C${H(0.56, -0.09)} ${H(0.68, -0.07)} ${H(0.95, -0.03)}C${H(1.01, -0.022)} ${H(1.01, 0.022)} ${H(0.95, 0.03)}C${H(0.68, 0.07)} ${H(0.56, 0.09)} ${H(0.45, 0.06)}Z`,
  };
}

/** A crescent as one shape: the disc less the disc that hides it, nothing painted beyond its edge. */
function crescentD(cx: number, cy: number, r: number): string {
  const off = r * 0.46;
  const hx = cx + off;
  const hy = cy - off * 0.35;
  const hr = r * 0.86;
  const d = Math.hypot(hx - cx, hy - cy);
  const along = (d * d + r * r - hr * hr) / (2 * d);
  const across = Math.sqrt(r * r - along * along);
  const [ux, uy] = [(hx - cx) / d, (hy - cy) / d];
  const P = (side: number) => `${n(cx + along * ux - side * across * uy)} ${n(cy + along * uy + side * across * ux)}`;
  return `M${P(-1)}A${n(r)} ${n(r)} 0 1 0 ${P(1)}A${n(hr)} ${n(hr)} 0 ${along > d ? 1 : 0} 1 ${P(-1)}Z`;
}

/** Under this many points a mark sits on a tile of its own: a grid, a trail, a stair. */
const SMALL_BRUSH = 80;

/** The hero as one small sign, for a picture made of several: `fg` on `bg`, centred on (cx, cy), `size` wide. */
export function mark(s: Scene, motif: DrawnMotif, cx: number, cy: number, size: number, fg: string, bg: string, rot = 0): void {
  const r = size / 2;
  switch (motif) {
    case 'moon': s.path(crescentD(cx, cy, r), fg); return;
    case 'sun': s.path(sunletD(cx, cy, r), fg); return;
    case 'paw': s.path(pawD(cx, cy + size * 0.045, size, rot), fg); return;
    case 'heart': s.path(heartD(cx, cy, size), fg); return;
    case 'leaf':
      s.path(leafAt(cx - r * 0.3, cy + r * 0.95, size * 0.98, size * 0.24, -74) + leafAt(cx - r * 0.3, cy + r * 0.95, size * 0.68, size * 0.17, -24) + leafAt(cx - r * 0.3, cy + r * 0.95, size * 0.56, size * 0.14, -128), fg);
      return;
    case 'coin':
      s.circle(cx, cy, r, fg);
      s.circle(cx, cy, r * 0.68, undefined, { stroke: bg, sw: r * 0.1 });
      return;
    case 'chart': {
      const bar = size * 0.25;
      [0.42, 0.68, 1].forEach((h, k) => s.rect(cx - r + k * size * 0.375, cy + r - size * h, bar, size * h, fg));
      return;
    }
    case 'home':
      s.path(`M${n(cx - r)} ${n(cy - r * 0.05)}L${n(cx)} ${n(cy - r)}L${n(cx + r)} ${n(cy - r * 0.05)}L${n(cx + r * 0.72)} ${n(cy - r * 0.05)}V${n(cy + r)}H${n(cx - r * 0.72)}V${n(cy - r * 0.05)}Z`, fg);
      s.rect(cx - r * 0.2, cy + r * 0.3, r * 0.4, r * 0.7, bg);
      return;
    case 'brush': {
      // small, a long thin brush reads as a pen: a wide tuft on a short handle stays a brush
      const b = size < SMALL_BRUSH ? brushD(cx - r * 0.72, cy + r * 0.72, size * 1.18, -45, 1.3, 0.75) : brushD(cx - r * 0.72, cy + r * 0.72, size * 1.04, -45);
      s.path(b.bristles + b.handle, fg);
      s.path(b.ferrule, fg);
    }
  }
}
