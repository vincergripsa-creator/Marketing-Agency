/**
 * What the hand-made styles share (D200): a silhouette as the polygons a hand cuts or a screen fills, cut and torn edges,
 * paper grain, halftone dots, overprint, and what all of it weighs in an SVG. Coordinates are written to a tenth, dots to the
 * pixel: a texture is many small marks, and E6 counts every byte of them.
 */
import type { Scene } from '../../scene.js';
import { placer, type Box, type Place, type UnitPath } from '../shapes.js';

export type Pt = [number, number];
export type Rnd = () => number;

/** A tenth of a point: what a cut or a tear needs, and two bytes fewer per number than `n`. */
const f1 = (v: number): string => String(Math.round(v * 10) / 10);

/** A closed or open polyline as `d`, absolute M and L only. */
export const polyD = (pts: readonly Pt[], closed = true): string =>
  pts.map((p, k) => `${k ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join('') + (closed ? 'Z' : '');

export const ringsD = (rings: readonly Pt[][]): string => rings.map((r) => polyD(r)).join('');

/** The subpaths of a unit path, curves sampled `per` times: closed rings and open strokes, each on its own. */
export function subpaths(p: UnitPath, per = 6): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  let cur: Pt[] | null = null;
  let at: Pt = [0, 0];
  const flush = (closed: boolean) => {
    if (cur && cur.length > 1) out.push({ pts: cur, closed });
    cur = null;
  };
  for (const s of p) {
    if (s[0] === 'M') {
      flush(false);
      at = [s[1], s[2]];
      cur = [at];
    } else if (s[0] === 'L') {
      at = [s[1], s[2]];
      (cur ??= [at]).push(at);
    } else if (s[0] === 'C') {
      cur ??= [at];
      for (let k = 1; k <= per; k++) {
        const t = k / per;
        const u = 1 - t;
        cur.push([u * u * u * at[0] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5], u * u * u * at[1] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6]]);
      }
      at = [s[5], s[6]];
    } else flush(true);
  }
  flush(false);
  return out;
}

/** The closed rings of a unit path, placed in `box`. */
export function ringsIn(p: UnitPath, box: Box, o: Place = {}, per = 6): Pt[][] {
  const at = placer(box, o);
  return subpaths(p, per).filter((s) => s.closed).map((s) => s.pts.map(([u, v]) => at(u, v)));
}

/** The open strokes of a unit path, placed in `box`. */
export function strokesIn(p: UnitPath, box: Box, o: Place = {}, per = 6): Pt[][] {
  const at = placer(box, o);
  return subpaths(p, per).filter((s) => !s.closed).map((s) => s.pts.map(([u, v]) => at(u, v)));
}

export const shift = (rings: readonly Pt[][], dx: number, dy: number): Pt[][] => rings.map((r) => r.map(([x, y]): Pt => [x + dx, y + dy]));

/** A hand that follows a line: every point strays by up to `amp`, smoothed with its neighbours so the cut never zigzags. */
export function wobble(pts: readonly Pt[], rnd: Rnd, amp: number, closed = true): Pt[] {
  const raw = pts.map((): Pt => [(rnd() - 0.5) * 2 * amp, (rnd() - 0.5) * 2 * amp]);
  const len = pts.length;
  return pts.map(([x, y], i) => {
    const a = raw[closed ? (i - 1 + len) % len : Math.max(0, i - 1)]!;
    const b = raw[i]!;
    const c = raw[closed ? (i + 1) % len : Math.min(len - 1, i + 1)]!;
    return [x + (a[0] + 2 * b[0] + c[0]) / 4, y + (a[1] + 2 * b[1] + c[1]) / 4];
  });
}

/** Where the rings are inked along the line `y`, as the nonzero rule fills them: the spans, left to right. */
export function spansAt(rings: readonly Pt[][], y: number): [number, number][] {
  const cross: [number, number][] = [];
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x0, y0] = r[j]!;
      const [x1, y1] = r[i]!;
      if ((y0 <= y) !== (y1 <= y)) cross.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
    }
  }
  cross.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let w = 0;
  let from = 0;
  for (const [x, dw] of cross) {
    const was = w;
    w += dw;
    if (was === 0 && w !== 0) from = x;
    else if (was !== 0 && w === 0) out.push([from, x]);
  }
  return out;
}

/**
 * Whether the rings ink (x, y), for many points: each line is crossed once and kept, to a quarter of a point. `pad` widens the
 * spans, for a dot that touches the shape with its edge.
 */
export function inker(rings: readonly Pt[][]): (x: number, y: number, pad?: number) => boolean {
  const lines = new Map<number, [number, number][]>();
  return (x, y, pad = 0) => {
    const k = Math.round(y * 4) / 4;
    let spans = lines.get(k);
    if (!spans) lines.set(k, (spans = spansAt(rings, k)));
    return spans.some(([a, b]) => x >= a - pad && x <= b + pad);
  };
}

/** The box the rings fill. */
export function boundsIn(rings: readonly Pt[][]): Box {
  const xs = rings.flat().map((p) => p[0]);
  const ys = rings.flat().map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ───────────────────────────── paper ─────────────────────────────

/**
 * Noise along an edge of `count` points, the sum of `scales`: each a smooth curve through random knots `every` points apart,
 * `amp` high. A tear is a slow wander, a shorter bite and the fibres; a closed edge comes back to where it started.
 */
export function layered(rnd: Rnd, count: number, scales: readonly { every: number; amp: number }[], closed = false): number[] {
  const out = Array<number>(count + 1).fill(0);
  for (const { every, amp } of scales) {
    const knots = Math.max(2, Math.ceil(count / every) + 1);
    const v = Array.from({ length: knots }, () => (rnd() * 2 - 1) * amp);
    if (closed) v[knots - 1] = v[0]!;
    for (let i = 0; i <= count; i++) {
      const t = (i / count) * (knots - 1);
      const k = Math.min(knots - 2, Math.floor(t));
      const s = (1 - Math.cos((t - k) * Math.PI)) / 2;
      out[i]! += v[k]! * (1 - s) + v[k + 1]! * s;
    }
  }
  return out;
}

/** A sheet: its outline, and `fringe`, the white of the paper a tear lays bare outside its edge (the outline where it was cut). */
export interface Sheet { body: Pt[]; fringe: Pt[] }

/** How a hand tears at this scale: how far an edge wanders, how long a fibre, how wide the white it lays bare. */
export interface Tear { amp: number; step: number; white: number }

/** The slow wander, the bite and the fibres of a tear, in shares of its `amp`. */
const TEAR = [{ every: 11, amp: 1.25 }, { every: 3, amp: 0.55 }, { every: 1, amp: 0.22 }] as const;

/**
 * Paper torn or cut along a polygon whose corners turn clockwise on screen, each edge torn or not. A cut edge is a straight
 * line; a torn one wanders and shows its fringe, whose width swells and thins along the tear.
 */
export function tornPolygon(corners: readonly Pt[], torn: readonly boolean[], rnd: Rnd, o: Tear): Sheet {
  const body: Pt[] = [];
  const fringe: Pt[] = [];
  corners.forEach(([x0, y0], e) => {
    const [x1, y1] = corners[(e + 1) % corners.length]!;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [nx, ny] = [(y1 - y0) / len, -(x1 - x0) / len];
    if (!torn[e]) {
      body.push([x0, y0]);
      fringe.push([x0, y0]);
      return;
    }
    const count = Math.max(3, Math.round(len / o.step));
    const offs = layered(rnd, count, TEAR.map((s) => ({ every: s.every, amp: s.amp * o.amp })));
    const wide = layered(rnd, count, [{ every: 7, amp: 1 }]);
    for (let k = 0; k < count; k++) {
      const t = k / count;
      // the ends stay on their corners: two edges meet there
      const pin = Math.min(1, Math.min(k, count - k) / 3);
      const d = offs[k]! * pin;
      const w = o.white * pin * (0.5 + 0.5 * Math.max(-0.6, Math.min(1, wide[k]!)));
      const [bx, by] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      body.push([bx + nx * d, by + ny * d]);
      fringe.push([bx + nx * (d + w), by + ny * (d + w)]);
    }
  });
  return { body, fringe };
}

export interface SheetCut { cx: number; cy: number; w: number; h: number; rot: number; torn: readonly [boolean, boolean, boolean, boolean] }

/** The corners of a box `w` × `h` about (cx, cy), turned `rot` degrees, clockwise from its top left. */
export function boxCorners(cx: number, cy: number, w: number, h: number, rot: number): Pt[] {
  const a = (rot * Math.PI) / 180;
  const [cs, sn] = [Math.cos(a), Math.sin(a)];
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]): Pt => [cx + x! * cs - y! * sn, cy + x! * sn + y! * cs]);
}

/** A rectangle of paper, its top, right, bottom and left edges torn or cut. */
export const sheet = (c: SheetCut, rnd: Rnd, o: Tear): Sheet => tornPolygon(boxCorners(c.cx, c.cy, c.w, c.h, c.rot), c.torn, rnd, o);

/** A disc of paper torn round by hand: never quite round, its fringe all the way. */
export function disc(cx: number, cy: number, r: number, rnd: Rnd, o: Tear): Sheet {
  const count = Math.max(24, Math.round((2 * Math.PI * r) / o.step));
  const offs = layered(rnd, count, [{ every: Math.max(3, Math.round(count / 7)), amp: r * 0.035 }, ...TEAR.map((s) => ({ every: s.every, amp: s.amp * o.amp }))], true);
  const wide = layered(rnd, count, [{ every: 9, amp: 1 }], true);
  const turn = rnd() * Math.PI * 2;
  const body: Pt[] = [];
  const fringe: Pt[] = [];
  for (let k = 0; k < count; k++) {
    const a = turn + (k / count) * Math.PI * 2;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const d = r + offs[k]!;
    const w = o.white * (0.5 + 0.5 * Math.max(-0.6, Math.min(1, wide[k]!)));
    body.push([cx + ux * d, cy + uy * d]);
    fringe.push([cx + ux * (d + w), cy + uy * (d + w)]);
  }
  return { body, fringe };
}

/** Speckles of `ink` over `box` where `keep` holds, `d` wide: the grain of a paper, the dust of a print. */
export function speckle(rnd: Rnd, box: Box, count: number, d: number, keep: (x: number, y: number) => boolean = () => true): Dots {
  const dots = new Dots();
  for (let k = 0; k < count; k++) {
    const x = box.x + rnd() * box.w;
    const y = box.y + rnd() * box.h;
    const size = d * (0.7 + 0.6 * rnd());
    if (keep(x, y)) dots.add(x, y, size);
  }
  return dots;
}

// ───────────────────────────── dots ─────────────────────────────

/** Dots of one ink, grouped by diameter: one stroked path per size, a round cap on a step too short to see. */
export class Dots {
  private readonly by = new Map<number, string[]>();
  private count = 0;

  /** Sizes go by quarters of a point: few paths, and a screen still grows smoothly. */
  add(x: number, y: number, d: number): void {
    if (d < 0.3) return;
    const k = Math.round(d * 4) / 4;
    const list = this.by.get(k) ?? [];
    if (!list.length) this.by.set(k, list);
    list.push(`M${Math.round(x)} ${Math.round(y)}h.1`);
    this.count += 1;
  }

  get size(): number { return this.count; }

  draw(s: Scene, ink: string, op?: number): void {
    for (const [d, parts] of [...this.by].sort((a, b) => a[0] - b[0])) s.path(parts.join(''), undefined, { stroke: ink, sw: d, cap: 'round', ...(op === undefined ? {} : { op }) });
  }
}

/** Bytes a dot takes in the SVG, on average: `M123 456h.1`. */
export const DOT_BYTES = 12;

/** A halftone screen: dots on a lattice of cell `cell` (in points), square or at 45°, their size the tone's at each point. */
export interface Screen { cell: number; angle: 0 | 45; tone: (x: number, y: number) => number; max?: number }

/**
 * The dots a screen prints over `box` where `inside` holds, the lattice moved by `at` (a misregistered drum). A tone is the
 * share of the cell the dot covers: 0.785 and they touch.
 */
export function halftone(box: Box, o: Screen, inside: (x: number, y: number) => boolean, at: Pt = [0, 0]): { x: number; y: number; d: number }[] {
  const out: { x: number; y: number; d: number }[] = [];
  // at 45°, the square cell turned: rows half a diagonal apart, every other one shifted by half a diagonal
  const step = o.angle === 45 ? o.cell / Math.SQRT2 : o.cell;
  const area = o.cell * o.cell;
  const max = o.max ?? 1.12 * Math.sqrt(area);
  const rows = Math.ceil(box.h / step) + 2;
  const cols = Math.ceil(box.w / (o.angle === 45 ? step * 2 : step)) + 2;
  // the lattice stands on the page, not on the shape: two screens of one ink line up
  const x0 = Math.floor(box.x / (2 * step)) * 2 * step + at[0];
  const y0 = Math.floor(box.y / (2 * step)) * 2 * step + at[1];
  for (let j = -1; j < rows; j++) {
    for (let i = -1; i < cols; i++) {
      const x = o.angle === 45 ? x0 + i * step * 2 + (j & 1 ? step : 0) : x0 + i * step;
      const y = y0 + j * step;
      if (x < box.x - max || x > box.x + box.w + max || y < box.y - max || y > box.y + box.h + max) continue;
      const t = Math.min(1, Math.max(0, o.tone(x, y)));
      if (t < 0.015 || !inside(x, y)) continue;
      out.push({ x, y, d: Math.min(max, 2 * Math.sqrt((t * area) / Math.PI)) });
    }
  }
  return out;
}

// ───────────────────────────── inks ─────────────────────────────

const rgb = (c: string): [number, number, number] => {
  const v = parseInt(c.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Two transparent inks printed one over the other: what a riso drum lays where they cross. */
export function multiply(a: string, b: string): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, k) => Math.round((v * y[k]!) / 255).toString(16).padStart(2, '0')).join('')}`;
}

/** How far two inks stand in RGB: two of one lightness and another hue print as two colours, which a contrast ratio misses. */
export function apart(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
