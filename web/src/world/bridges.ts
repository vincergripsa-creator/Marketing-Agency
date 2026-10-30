// Wooden plank bridges with rope railings between neighbouring islands.
import type { Bridge, Sprite } from './model';
import { place } from './model';
import { PAL } from './palette';
import { P, box, fillPoly, hash2, rect, tones, type Ctx } from './pixel';
import { bakeIso } from './props';

export const BRIDGE_HALF = 0.62;
const OVERLAP = 0.32;

function ropeZ(t: number): number {
  return 9 - Math.sin(Math.PI * t) * 3;
}

/** Paints the deck + back railing into the ground canvas (ox, oy = canvas px of world tile 0,0). */
export function paintBridge(g: Ctx, ox: number, oy: number, br: Bridge, sprites: Sprite[]): void {
  const alongX = Math.abs(br.pa.tx - br.pb.tx) > Math.abs(br.pa.ty - br.pb.ty);
  const c = alongX ? br.pa.ty : br.pa.tx;
  const a0 = Math.min(alongX ? br.pa.tx : br.pa.ty, alongX ? br.pb.tx : br.pb.ty) - OVERLAP;
  const a1 = Math.max(alongX ? br.pa.tx : br.pa.ty, alongX ? br.pb.tx : br.pb.ty) + OVERLAP;
  const h = BRIDGE_HALF;
  // map (a along the bridge, b across) → world tile
  const pt = (a: number, b: number, z: number) => (alongX ? P(ox, oy, a, c + b, z) : P(ox, oy, c + b, a, z));
  const seed = Math.round(a0 * 31 + c * 17);

  // under-beam (visible front face: +ty for x bridges, +tx for y bridges)
  fillPoly(g, [pt(a0, h, 0), pt(a1, h, 0), pt(a1, h, -5), pt(a0, h, -5)], PAL.woodDark);
  fillPoly(g, [pt(a0, h, -4), pt(a1, h, -4), pt(a1, h, -5), pt(a0, h, -5)], PAL.woodDeep);
  // dark deck base (gaps between planks)
  fillPoly(g, [pt(a0, -h, 0), pt(a1, -h, 0), pt(a1, h, 0), pt(a0, h, 0)], PAL.woodDeep);
  // planks
  let i = 0;
  for (let a = a0 + 0.02; a < a1 - 0.02; a += 0.24, i++) {
    const w = Math.min(0.2, a1 - 0.02 - a);
    const r = hash2(i, 1, seed);
    const col = r < 0.33 ? PAL.wood : r < 0.66 ? PAL.woodLight : '#c48a52';
    const j = (hash2(i, 2, seed) - 0.5) * 0.06;
    fillPoly(g, [pt(a, -h + 0.03 + j, 0), pt(a + w, -h + 0.03 + j, 0), pt(a + w, h - 0.03 + j, 0), pt(a, h - 0.03 + j, 0)], col);
    const nail = pt(a + w / 2, -h + 0.12, 0);
    rect(g, nail[0], nail[1], 1, 1, PAL.woodDeep);
    const nail2 = pt(a + w / 2, h - 0.14, 0);
    rect(g, nail2[0], nail2[1], 1, 1, PAL.woodDeep);
  }
  // posts along both rails
  const span = a1 - a0;
  const n = Math.max(1, Math.round(span / 1.6));
  const postsAt: number[] = [];
  for (let k = 0; k <= n; k++) postsAt.push(a0 + 0.12 + ((span - 0.24) * k) / n);
  // back rail (behind walkers) painted into the ground
  for (let k = 0; k < postsAt.length; k++) {
    const pa = postsAt[k];
    drawPost(g, ox, oy, alongX, pa, c - h);
    if (k < postsAt.length - 1) drawRope(g, (a: number, z: number) => pt(a, -h, z), pa, postsAt[k + 1]);
  }
  // front rail as depth-sorted sprites (one per span)
  for (let k = 0; k < postsAt.length - 1; k++) {
    const s0 = postsAt[k];
    const s1 = postsAt[k + 1];
    const len = Math.round((s1 - s0) * 20) / 20;
    const b = bakeIso(`rope:${alongX ? 'x' : 'y'}:${len}:${k === postsAt.length - 2}`, -0.1, -0.1, alongX ? len + 0.1 : 0.1, alongX ? 0.1 : len + 0.1, 14, (gg, oxx, oyy) => {
      const lp = (a: number, z: number) => (alongX ? P(oxx, oyy, a, 0, z) : P(oxx, oyy, 0, a, z));
      drawPostLocal(gg, oxx, oyy, alongX, 0);
      if (k === postsAt.length - 2) drawPostLocal(gg, oxx, oyy, alongX, len);
      drawRope(gg, lp, 0, len);
    });
    const tx = alongX ? s0 : c + h;
    const ty = alongX ? c + h : s0;
    const mid = (s0 + s1) / 2;
    sprites.push(place(b, tx, ty, alongX ? mid + c + h : c + h + mid));
  }
}

function drawRope(g: Ctx, at: (a: number, z: number) => [number, number], s0: number, s1: number): void {
  const steps = Math.max(4, Math.round((s1 - s0) * 20));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = at(s0 + (s1 - s0) * t, ropeZ(t));
    rect(g, x, y, 1, 1, PAL.rope);
    rect(g, x, y + 1, 1, 1, '#b8955c');
  }
}

function drawPost(g: Ctx, ox: number, oy: number, alongX: boolean, a: number, b: number): void {
  const tx = alongX ? a : b;
  const ty = alongX ? b : a;
  box(g, ox, oy, tx - 0.04, ty - 0.04, 0.08, 0.08, 0, 11, tones(PAL.woodDark, 0.2, -0.2));
}

function drawPostLocal(g: Ctx, ox: number, oy: number, alongX: boolean, a: number): void {
  drawPost(g, ox, oy, alongX, a, 0);
}
