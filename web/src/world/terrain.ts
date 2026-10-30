// Floating island terrain: textured grass top, dirt/rock sides with strata, grass lip drips,
// hanging roots and vines. Painted once per island into an offscreen canvas.
import { HALF_H, HALF_W } from './iso';
import { PAL, hexToRgb, shade } from './palette';
import { P, fillPoly, flat, hash2, makeCanvas, rect, type Ctx } from './pixel';

export interface TerrainCanvas {
  c: HTMLCanvasElement;
  g: Ctx;
  /** Canvas px of the island's local tile origin (0,0) at z=0. */
  ox: number;
  oy: number;
  size: number;
}

export const SIDE_DEPTH = 40;
const ROOT_SPACE = 22;
const PAD = 4;

export function paintTerrain(size: number, seed: number, grassTint?: string): TerrainCanvas {
  const w = size * 2 * HALF_W + PAD * 2;
  const h = size * 2 * HALF_H + SIDE_DEPTH + ROOT_SPACE + PAD * 2;
  const { c, g } = makeCanvas(w, h);
  const ox = size * HALF_W + PAD;
  const oy = PAD;

  // ── grass top (per pixel, exact diamond)
  const topH = size * 2 * HALF_H;
  const img = g.createImageData(w, topH + 2);
  const d = img.data;
  const base = hexToRgb(grassTint ?? PAL.grass);
  const light = hexToRgb(shade(grassTint ?? PAL.grass, 0.16));
  const lighter = hexToRgb(PAL.grassLight);
  const dark = hexToRgb(PAL.grassDark);
  const alt = hexToRgb(shade(grassTint ?? PAL.grass, 0.05));
  for (let y = 0; y < topH + 2; y++) {
    for (let x = 0; x < w; x++) {
      const a = (x + 0.5 - ox) / HALF_W;
      const b = (y + 0.5 - oy) / HALF_H;
      const tx = (a + b) / 2;
      const ty = (b - a) / 2;
      if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
      const n = hash2(x, y, seed);
      const patch = hash2(Math.floor(tx * 1.5), Math.floor(ty * 1.5), seed + 17);
      let col = (Math.floor(tx) + Math.floor(ty)) % 2 === 0 ? base : alt;
      if (patch > 0.78) col = light;
      if (n > 0.955) col = lighter;
      else if (n < 0.035) col = dark;
      // bright rim on the back edges, darker rim on the front edges
      if (tx < 0.07 || ty < 0.07) col = lighter;
      else if (tx > size - 0.06 || ty > size - 0.06) col = dark;
      const i = (y * w + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // ── grass tufts and tiny flowers
  for (let i = 0; i < size * size * 0.9; i++) {
    const tx = 0.3 + hash2(i, 1, seed) * (size - 0.6);
    const ty = 0.3 + hash2(i, 2, seed) * (size - 0.6);
    const [x, y] = P(ox, oy, tx, ty, 0);
    const k = hash2(i, 3, seed);
    if (k < 0.7) {
      rect(g, x, y - 1, 1, 1, PAL.grassDark);
      rect(g, x + 2, y - 2, 1, 2, PAL.grassDark);
      rect(g, x + 1, y - 1, 1, 1, PAL.grassDeep);
    } else {
      const fc = k < 0.8 ? '#ffffff' : k < 0.9 ? '#ffd166' : '#ff8fb1';
      rect(g, x, y - 1, 1, 1, fc);
      rect(g, x + 1, y, 1, 1, PAL.grassDeep);
    }
  }

  // ── sides (column by column: lip, drips, strata, stones, bottom)
  const B = P(ox, oy, size, size, 0);
  const L = P(ox, oy, 0, size, 0);
  const R = P(ox, oy, size, 0, 0);
  const faces: { x0: number; x1: number; y: (x: number) => number; left: boolean }[] = [
    { x0: Math.round(L[0]), x1: Math.round(B[0]), y: (x) => L[1] + ((x - L[0]) / (B[0] - L[0])) * (B[1] - L[1]), left: true },
    { x0: Math.round(B[0]), x1: Math.round(R[0]), y: (x) => B[1] + ((x - B[0]) / (R[0] - B[0])) * (R[1] - B[1]), left: false },
  ];
  for (const f of faces) {
    const span = Math.max(1, f.x1 - f.x0);
    for (let x = f.x0; x < f.x1; x++) {
      const t = (x - f.x0) / span; // 0..1 along the face
      const fromCorner = f.left ? 1 - t : t; // 0 at the front corner
      const top = Math.floor(f.y(x + 0.5));
      const taper = fromCorner > 0.82 ? 1 - (fromCorner - 0.82) * 2.2 : 1;
      const jag = Math.floor(hash2(x >> 1, 7, seed) * 5) + Math.round(Math.sin(x * 0.13 + seed) * 3);
      const depth = Math.max(8, Math.round((SIDE_DEPTH + jag) * taper));
      const drip = hash2(x, 11, seed) > 0.72 ? 1 + Math.floor(hash2(x, 12, seed) * 4) : 0;
      const lipH = 3 + drip;
      const dirtA = f.left ? PAL.dirtLight : PAL.dirt;
      const dirtB = f.left ? PAL.dirt : PAL.dirtDark;
      for (let yy = 0; yy < depth; yy++) {
        const y = top + yy;
        let col: string;
        if (yy < lipH) col = yy < 2 ? PAL.grassLip : f.left ? PAL.grassDark : PAL.grassDeep;
        else {
          const band = Math.floor((yy - 3 + Math.floor(hash2(x >> 2, 3, seed) * 3)) / 7);
          col = band % 2 === 0 ? dirtA : dirtB;
          const s = hash2(x >> 1, y >> 1, seed + 5);
          if (s > 0.955) col = f.left ? PAL.rockLight : PAL.rock;
          else if (s < 0.03) col = PAL.dirtDeep;
          if (yy >= depth - 3) col = PAL.dirtDeep;
        }
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
      // front corner highlight
      if (Math.abs(x - B[0]) < 1) rect(g, x, top + 3, 1, depth - 6, shade(PAL.dirtLight, 0.15));
      // vines on the face
      if (hash2(x, 21, seed) > 0.93) {
        const len = 5 + Math.floor(hash2(x, 22, seed) * 10);
        for (let k = 0; k < len; k++) rect(g, x + (k % 4 === 3 ? 1 : 0), top + 3 + k, 1, 1, k % 3 === 0 ? PAL.leafLight : PAL.vine);
      }
      // hanging roots below
      if (hash2(x, 31, seed) > 0.86) {
        const len = 4 + Math.floor(hash2(x, 32, seed) * 16) * taper;
        let rx = x;
        for (let k = 0; k < len; k++) {
          if (k > 0 && k % 4 === 0) rx += hash2(x, k, seed) > 0.5 ? 1 : -1;
          rect(g, rx, top + depth + k, 1, 1, k > len - 3 ? PAL.dirtDeep : PAL.root);
        }
        if (hash2(x, 33, seed) > 0.6) rect(g, rx - 1, top + depth + Math.floor(len / 2), 1, 1, PAL.vine);
      }
    }
  }

  return { c, g, ox, oy, size };
}

/** Checkered floor (tile-aligned rectangle in local tile coords). */
export function paintFloor(t: TerrainCanvas, x0: number, y0: number, x1: number, y1: number, a: string, b: string, step = 1): void {
  for (let ty = y0; ty < y1 - 1e-6; ty += step) {
    for (let tx = x0; tx < x1 - 1e-6; tx += step) {
      const w = Math.min(step, x1 - tx);
      const dd = Math.min(step, y1 - ty);
      const k = Math.round((tx - x0) / step) + Math.round((ty - y0) / step);
      flat(t.g, t.ox, t.oy, tx, ty, w, dd, 0, k % 2 === 0 ? a : b);
      // subtle bevel on the back edges of each tile
      const hl = shade(k % 2 === 0 ? a : b, 0.12);
      fillPoly(t.g, [P(t.ox, t.oy, tx, ty), P(t.ox, t.oy, tx + w, ty), P(t.ox, t.oy, tx + w, ty + 0.06), P(t.ox, t.oy, tx, ty + 0.06)], hl);
      fillPoly(t.g, [P(t.ox, t.oy, tx, ty), P(t.ox, t.oy, tx + 0.06, ty), P(t.ox, t.oy, tx + 0.06, ty + dd), P(t.ox, t.oy, tx, ty + dd)], hl);
    }
  }
}

export function paintRug(t: TerrainCanvas, x0: number, y0: number, w: number, d: number, color: string): void {
  flat(t.g, t.ox, t.oy, x0, y0, w, d, 0, shade(color, -0.25));
  flat(t.g, t.ox, t.oy, x0 + 0.08, y0 + 0.08, w - 0.16, d - 0.16, 0, color);
  flat(t.g, t.ox, t.oy, x0 + 0.22, y0 + 0.22, w - 0.44, d - 0.44, 0, shade(color, 0.2));
}

/** Stepping-stone path between two local tile points. */
export function paintPath(t: TerrainCanvas, ax: number, ay: number, bx: number, by: number, seed: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.round(len / 0.42));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const tx = ax + (bx - ax) * k + (hash2(i, 1, seed) - 0.5) * 0.12;
    const ty = ay + (by - ay) * k + (hash2(i, 2, seed) - 0.5) * 0.12;
    const s = 0.16 + hash2(i, 3, seed) * 0.06;
    fillPoly(t.g, [P(t.ox, t.oy, tx - s, ty - s), P(t.ox, t.oy, tx + s, ty - s), P(t.ox, t.oy, tx + s, ty + s), P(t.ox, t.oy, tx - s, ty + s)], '#d8cfc0');
    fillPoly(t.g, [P(t.ox, t.oy, tx - s, ty - s), P(t.ox, t.oy, tx + s, ty - s), P(t.ox, t.oy, tx + s * 0.6, ty), P(t.ox, t.oy, tx - s, ty)], '#ece5d8');
  }
}
