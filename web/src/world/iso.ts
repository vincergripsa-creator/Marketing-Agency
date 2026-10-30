// Isometric projection: tile 32x16 px (2:1). Tile coords (tx, ty) → world px (x, y) at scale 1.
// +tx goes down-right on screen, +ty goes down-left. Depth (draw order) grows with tx + ty.

export const TILE_W = 32;
export const TILE_H = 16;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

export interface Pt { tx: number; ty: number }
export interface WPt { x: number; y: number }

export function isoX(tx: number, ty: number): number {
  return (tx - ty) * HALF_W;
}

export function isoY(tx: number, ty: number, z = 0): number {
  return (tx + ty) * HALF_H - z;
}

export function toWorld(p: Pt, z = 0): WPt {
  return { x: isoX(p.tx, p.ty), y: isoY(p.tx, p.ty, z) };
}

/** Inverse projection on the ground plane (z = 0). */
export function toTile(x: number, y: number): Pt {
  const a = x / HALF_W;
  const b = y / HALF_H;
  return { tx: (a + b) / 2, ty: (b - a) / 2 };
}

export function depthOf(tx: number, ty: number): number {
  return tx + ty;
}

export function tileDist(a: Pt, b: Pt): number {
  return Math.hypot(a.tx - b.tx, a.ty - b.ty);
}

/** On-screen distance (world px) between two tile points: walking speed is measured with it. */
export function screenDist(a: Pt, b: Pt): number {
  return Math.hypot(isoX(a.tx, a.ty) - isoX(b.tx, b.ty), isoY(a.tx, a.ty) - isoY(b.tx, b.ty));
}

export type Facing = 'ne' | 'nw' | 'se' | 'sw';

/** Facing from a movement vector in tile space (front = towards the viewer). */
export function facingFrom(dtx: number, dty: number): Facing {
  const sx = dtx - dty;
  const sy = dtx + dty;
  const front = sy >= 0;
  const east = sx >= 0;
  return front ? (east ? 'se' : 'sw') : east ? 'ne' : 'nw';
}

export function pointInPoly(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
