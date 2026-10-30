// Low-level pixel-art drawing on offscreen canvases: crisp scanline polygons (no anti-aliasing),
// iso boxes, pixel ellipses/blobs, auto outlines, deterministic hashing for decor.
import { HALF_H, HALF_W } from './iso';
import { shade } from './palette';

export type Ctx = CanvasRenderingContext2D;
export type P2 = [number, number];

export function makeCanvas(w: number, h: number, readback = false): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d', readback ? { willReadFrequently: true } : undefined)!;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

// ───────────── deterministic noise (decor only, never simulation) ─────────────

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG for procedural decor (mulberry32). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────── primitives ─────────────

export function rect(g: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function px(g: Ctx, x: number, y: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Scanline fill of a convex (or simple) polygon with crisp pixel edges. */
export function fillPoly(g: Ctx, pts: readonly P2[], color: string): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!Number.isFinite(minY)) return;
  g.fillStyle = color;
  const n = pts.length;
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    let xl = Infinity;
    let xr = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        const x = a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
    }
    if (xl < xr) {
      const L = Math.round(xl);
      const R = Math.round(xr);
      if (R > L) g.fillRect(L, y, R - L, 1);
    }
  }
}

/** Projects local tile coords into a baked canvas whose tile origin (0,0,z=0) sits at (ox, oy). */
export function P(ox: number, oy: number, tx: number, ty: number, z = 0): P2 {
  return [ox + (tx - ty) * HALF_W, oy + (tx + ty) * HALF_H - z];
}

export interface BoxColors { top: string; left: string; right: string }

export function tones(base: string, light = 0.14, dark = -0.2): BoxColors {
  return { top: shade(base, light), left: base, right: shade(base, dark) };
}

/** Iso box with footprint (tx,ty,w,d) in tiles, from height z0 to z0+h (px). Left face = +ty, right = +tx. */
export function box(
  g: Ctx, ox: number, oy: number,
  tx: number, ty: number, w: number, d: number, z0: number, h: number,
  c: BoxColors,
): void {
  const z1 = z0 + h;
  if (h > 0) {
    fillPoly(g, [P(ox, oy, tx, ty + d, z1), P(ox, oy, tx + w, ty + d, z1), P(ox, oy, tx + w, ty + d, z0), P(ox, oy, tx, ty + d, z0)], c.left);
    fillPoly(g, [P(ox, oy, tx + w, ty, z1), P(ox, oy, tx + w, ty + d, z1), P(ox, oy, tx + w, ty + d, z0), P(ox, oy, tx + w, ty, z0)], c.right);
  }
  fillPoly(g, [P(ox, oy, tx, ty, z1), P(ox, oy, tx + w, ty, z1), P(ox, oy, tx + w, ty + d, z1), P(ox, oy, tx, ty + d, z1)], c.top);
}

/** Flat quad on a plane at height z (floor tiles, rugs, planks). */
export function flat(g: Ctx, ox: number, oy: number, tx: number, ty: number, w: number, d: number, z: number, color: string): void {
  fillPoly(g, [P(ox, oy, tx, ty, z), P(ox, oy, tx + w, ty, z), P(ox, oy, tx + w, ty + d, z), P(ox, oy, tx, ty + d, z)], color);
}

/** Vertical face along x (constant ty) or along y (constant tx), from z0 to z1. */
export function wallX(g: Ctx, ox: number, oy: number, tx0: number, tx1: number, ty: number, z0: number, z1: number, color: string): void {
  fillPoly(g, [P(ox, oy, tx0, ty, z1), P(ox, oy, tx1, ty, z1), P(ox, oy, tx1, ty, z0), P(ox, oy, tx0, ty, z0)], color);
}

export function wallY(g: Ctx, ox: number, oy: number, tx: number, ty0: number, ty1: number, z0: number, z1: number, color: string): void {
  fillPoly(g, [P(ox, oy, tx, ty0, z1), P(ox, oy, tx, ty1, z1), P(ox, oy, tx, ty1, z0), P(ox, oy, tx, ty0, z0)], color);
}

/** Crisp filled ellipse centred on (cx, cy). */
export function ellipse(g: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  g.fillStyle = color;
  const r = Math.max(0.5, ry);
  const cyi = Math.round(cy);
  for (let y = -Math.ceil(r); y < Math.ceil(r); y++) {
    const t = (y + 0.5) / r;
    const k = 1 - t * t;
    if (k <= 0) continue;
    const hw = rx * Math.sqrt(k);
    const L = Math.round(cx - hw);
    const R = Math.round(cx + hw);
    if (R > L) g.fillRect(L, cyi + y, R - L, 1);
  }
}

/** Vertical cylinder seen in iso: top ellipse at cy - h, side band down to cy. */
export function cylinder(g: Ctx, cx: number, cy: number, rx: number, ry: number, h: number, top: string, side: string, sideDark: string): void {
  for (let x = -Math.floor(rx); x < Math.ceil(rx); x++) {
    const u = (x + 0.5) / rx;
    const k = 1 - u * u;
    if (k <= 0) continue;
    const e = ry * Math.sqrt(k);
    const y0 = Math.round(cy - h + e);
    const y1 = Math.round(cy + e);
    g.fillStyle = u > 0.35 ? sideDark : side;
    if (y1 > y0) g.fillRect(Math.round(cx + x), y0, 1, y1 - y0);
  }
  ellipse(g, cx, cy - h, rx, ry, top);
}

/** Shaded pixel blob (foliage, clouds, bushes): lit from the top-left. */
export function blob(g: Ctx, cx: number, cy: number, r: number, light: string, mid: string, dark: string, seed = 0, speckle?: string): void {
  const R = Math.ceil(r);
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d2 = (x + 0.5) * (x + 0.5) + (y + 0.5) * (y + 0.5);
      if (d2 > r * r) continue;
      const lit = (x + y) / (r * 1.6);
      const n = hash2(x + Math.round(cx * 7), y + Math.round(cy * 13), seed);
      let col = mid;
      if (lit < -0.45 || (lit < -0.2 && n < 0.4)) col = light;
      else if (lit > 0.42 || (lit > 0.18 && n < 0.35)) col = dark;
      if (speckle && n > 0.93) col = speckle;
      g.fillStyle = col;
      g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
  }
}

/** Adds a 1px outline around every opaque pixel (canvas must keep a 1px transparent margin). */
export function addOutline(c: HTMLCanvasElement, rgbaColor: [number, number, number, number]): void {
  const g = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const near =
        (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
      if (near) {
        d[i * 4] = rgbaColor[0];
        d[i * 4 + 1] = rgbaColor[1];
        d[i * 4 + 2] = rgbaColor[2];
        d[i * 4 + 3] = rgbaColor[3];
      }
    }
  }
  g.putImageData(img, 0, 0);
}

/** Mirrors a canvas horizontally into a new canvas. */
export function mirror(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

/** A pre-rendered prop: canvas + the pixel where its local tile origin (0,0,z=0) lies. */
export interface Baked { c: HTMLCanvasElement; ox: number; oy: number }

const bakeCache = new Map<string, Baked>();

export function bake(key: string | null, w: number, h: number, ox: number, oy: number, paint: (g: Ctx, ox: number, oy: number) => void): Baked {
  if (key) {
    const hit = bakeCache.get(key);
    if (hit) return hit;
  }
  const { c, g } = makeCanvas(w, h);
  paint(g, ox, oy);
  const b = { c, ox, oy };
  if (key) bakeCache.set(key, b);
  return b;
}

export function clearBakeCache(): void {
  bakeCache.clear();
}
