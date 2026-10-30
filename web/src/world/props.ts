// Furniture & decor painters. Each returns a cached baked canvas whose origin is the prop's local
// tile origin at floor level; islands place them with `place()` and depth-sort them with agents.
import { HALF_H, HALF_W } from './iso';
import { drawPixelText, textWidth } from './font';
import { PAL, mix, shade } from './palette';
import {
  P, bake, blob, box, cylinder, ellipse, fillPoly, flat, hash2, rect, tones, wallX, wallY,
  type Baked, type BoxColors, type Ctx, type P2,
} from './pixel';

/** Bakes a prop whose footprint spans tiles [x0,x1]×[y0,y1] and rises up to maxZ px. */
export function bakeIso(key: string | null, x0: number, y0: number, x1: number, y1: number, maxZ: number, paint: (g: Ctx, ox: number, oy: number) => void, pad = 3): Baked {
  const xs = [x0 - y0, x1 - y0, x1 - y1, x0 - y1].map((v) => v * HALF_W);
  const ys = [x0 + y0, x1 + y0, x1 + y1, x0 + y1].map((v) => v * HALF_H);
  const minX = Math.floor(Math.min(...xs) - pad);
  const maxX = Math.ceil(Math.max(...xs) + pad);
  const minY = Math.floor(Math.min(...ys) - maxZ - pad);
  const maxY = Math.ceil(Math.max(...ys) + pad);
  return bake(key, maxX - minX, maxY - minY, -minX, -minY, paint);
}

/** Axis helper: props are designed along "a" (length) and "b" (depth); `swap` turns them 90°. */
function axes(swap: boolean) {
  const bx = (g: Ctx, ox: number, oy: number, a: number, b: number, wa: number, wb: number, z0: number, h: number, c: BoxColors) =>
    swap ? box(g, ox, oy, b, a, wb, wa, z0, h, c) : box(g, ox, oy, a, b, wa, wb, z0, h, c);
  const pt = (ox: number, oy: number, a: number, b: number, z: number): P2 => (swap ? P(ox, oy, b, a, z) : P(ox, oy, a, b, z));
  return { bx, pt };
}

const LEG = '#4a4556';

// ───────────── office ─────────────

export interface DeskBake { baked: Baked; screen: P2[] }
const deskScreens = new Map<string, P2[]>();
let counterMachine: P2 = [0, 0];

/** Desk with monitor + keyboard. 'ne': long along x, seat at +y. 'nw': long along y, seat at +x. */
export function deskProp(facing: 'ne' | 'nw', top: string, variant: number, chief: boolean): DeskBake {
  const swap = facing === 'nw';
  const A = chief ? 1.3 : 1.1;
  const B = 0.6;
  const { bx, pt } = axes(swap);
  const screenLocal: P2[] = [];
  const key = `desk:${facing}:${top}:${variant % 4}:${chief}`;
  const baked = bakeIso(key, 0, 0, swap ? B : A, swap ? A : B, 26, (g, ox, oy) => {
    const legs: BoxColors = { top: LEG, left: LEG, right: '#36314a' };
    for (const [a, b] of [[0.05, 0.05], [A - 0.1, 0.05], [0.05, B - 0.1], [A - 0.1, B - 0.1]] as const) bx(g, ox, oy, a, b, 0.05, 0.05, 0, 8, legs);
    bx(g, ox, oy, A - 0.42, 0.08, 0.34, B - 0.16, 0, 8, tones(mix(top, '#bdb6cc', 0.45), 0.08, -0.22));
    bx(g, ox, oy, 0, 0, A, B, 8, 2, { top, left: shade(top, -0.14), right: shade(top, -0.28) });
    // keyboard + mouse
    bx(g, ox, oy, 0.28, 0.36, 0.44, 0.13, 10, 1, tones('#d9dce6', 0.1, -0.22));
    bx(g, ox, oy, 0.8, 0.4, 0.07, 0.07, 10, 1, tones('#e9ebf2'));
    // monitor
    bx(g, ox, oy, 0.48, 0.1, 0.12, 0.08, 10, 3, tones('#3a3e4c'));
    bx(g, ox, oy, 0.2, 0.1, 0.72, 0.07, 13, 10, { top: '#555b6e', left: '#2e3242', right: '#272b3a' });
    const s = [pt(ox, oy, 0.25, 0.171, 14.5), pt(ox, oy, 0.87, 0.171, 14.5), pt(ox, oy, 0.87, 0.171, 21.5), pt(ox, oy, 0.25, 0.171, 21.5)];
    fillPoly(g, s, PAL.screenOff);
    screenLocal.push(...s.map(([x, y]) => [x - ox, y - oy] as P2));
    // desk items
    if (variant % 4 === 0) {
      bx(g, ox, oy, A - 0.24, 0.12, 0.1, 0.1, 10, 4, tones('#f7f4ee'));
      bx(g, ox, oy, A - 0.235, 0.125, 0.09, 0.09, 13.6, 0.4, tones('#6b3f22'));
    } else if (variant % 4 === 1) {
      bx(g, ox, oy, 0.02, 0.3, 0.22, 0.22, 10, 1, tones(PAL.paper));
      bx(g, ox, oy, 0.04, 0.3, 0.22, 0.2, 11, 1, tones('#f4ecd8'));
    } else if (variant % 4 === 2) {
      bx(g, ox, oy, A - 0.22, 0.12, 0.12, 0.12, 10, 4, tones(PAL.pot, 0.1, -0.25));
      const [lx, ly] = pt(ox, oy, A - 0.16, 0.18, 17);
      blob(g, lx, ly, 3.2, PAL.leafLight, PAL.leaf, PAL.leafDark, 3);
    } else {
      bx(g, ox, oy, 0.02, 0.1, 0.14, 0.26, 10, 5, tones('#7aa7ff', 0.12, -0.25));
      bx(g, ox, oy, 0.03, 0.12, 0.12, 0.24, 15, 1, tones('#f7f4ee'));
    }
    if (chief) {
      const [fx, fy] = pt(ox, oy, A - 0.12, 0.42, 11);
      rect(g, fx - 1, fy - 4, 3, 4, '#ffd166');
      rect(g, fx, fy - 5, 1, 1, '#fff1b8');
    }
    deskScreens.set(key, screenLocal);
  });
  return { baked, screen: deskScreens.get(key) ?? screenLocal };
}

/** Office chair centred on the seat; the backrest is behind the seated agent (towards the viewer). */
export function chairProp(facing: 'ne' | 'nw', color: string): Baked {
  const swap = facing === 'nw';
  const { bx } = axes(swap);
  return bakeIso(`chair:${facing}:${color}`, -0.25, -0.25, 0.25, 0.25, 16, (g, ox, oy) => {
    bx(g, ox, oy, -0.14, -0.14, 0.28, 0.28, 0, 1, tones('#3a3548'));
    bx(g, ox, oy, -0.03, -0.03, 0.06, 0.06, 1, 3, tones('#2d2a3a'));
    bx(g, ox, oy, -0.17, -0.17, 0.34, 0.34, 4, 2, tones(color, 0.12, -0.25));
    bx(g, ox, oy, -0.15, 0.13, 0.3, 0.06, 6, 6, tones(shade(color, -0.1), 0.12, -0.25));
  });
}

export function plantProp(variant: number): Baked {
  const v = variant % 4;
  return bakeIso(`plant:${v}`, -0.3, -0.3, 0.3, 0.3, 30, (g, ox, oy) => {
    const potC = v === 2 ? '#e9e4f2' : PAL.pot;
    box(g, ox, oy, -0.13, -0.13, 0.26, 0.26, 0, 7, tones(potC, 0.12, -0.25));
    flat(g, ox, oy, -0.11, -0.11, 0.22, 0.22, 7, '#5a3b26');
    const [cx, cy] = P(ox, oy, 0, 0, 7);
    if (v === 0) {
      blob(g, cx, cy - 6, 6, PAL.leafLight, PAL.leaf, PAL.leafDark, 11);
      blob(g, cx - 3, cy - 10, 3.5, PAL.leafLight, PAL.leaf, PAL.leafDark, 12);
    } else if (v === 1) {
      for (let i = 0; i < 7; i++) {
        const ang = -Math.PI / 2 + (i - 3) * 0.42;
        for (let k = 2; k < 13; k++) {
          const x = cx + Math.cos(ang) * k * 0.75;
          const y = cy - 2 + Math.sin(ang) * k;
          rect(g, x, y, 2, 1, k > 9 ? PAL.leafLight : i % 2 ? PAL.leaf : PAL.leafDark);
        }
      }
    } else if (v === 2) {
      rect(g, cx - 2, cy - 14, 4, 13, '#4f9e5a');
      rect(g, cx - 2, cy - 14, 1, 13, '#6cc070');
      rect(g, cx - 5, cy - 9, 2, 5, '#4f9e5a');
      rect(g, cx - 5, cy - 11, 1, 3, '#4f9e5a');
      rect(g, cx + 3, cy - 11, 2, 4, '#3f8a4c');
      rect(g, cx - 1, cy - 15, 2, 1, '#ff8fb1');
    } else {
      blob(g, cx, cy - 5, 5, PAL.leafLight, PAL.leaf, PAL.leafDark, 21);
      for (const [dx, dy, c] of [[-3, -8, '#ff6b8a'], [2, -9, '#ffd166'], [0, -4, '#ff6b8a'], [3, -5, '#ffffff'], [-2, -3, '#ffd166']] as const) rect(g, cx + dx, cy + dy, 2, 2, c);
    }
  });
}

export function treeProp(kind: 'round' | 'pine' | 'blossom', variant: number): Baked {
  const v = variant % 3;
  return bakeIso(`tree:${kind}:${v}`, -0.6, -0.6, 0.6, 0.6, kind === 'pine' ? 48 : 44, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    ellipse(g, cx, cy, 9, 4, 'rgba(30,60,30,0.28)');
    if (kind === 'pine') {
      rect(g, cx - 2, cy - 8, 4, 8, PAL.trunk);
      rect(g, cx + 1, cy - 8, 1, 8, PAL.trunkDark);
      const layers = [[cy - 8, 11], [cy - 17, 9], [cy - 25, 7], [cy - 32, 5]] as const;
      for (let li = 0; li < layers.length; li++) {
        const [base, hw] = layers[li];
        const hgt = 12 - li;
        for (let y = 0; y < hgt; y++) {
          const w = Math.max(1, Math.round((hw * (y + 1)) / hgt));
          const yy = base - hgt + y;
          rect(g, cx - w, yy, w, 1, y % 3 === 0 ? PAL.leaf : PAL.pine);
          rect(g, cx, yy, w, 1, PAL.pineDark);
        }
      }
      rect(g, cx - 1, cy - 45 + v, 2, 2, PAL.pine);
    } else {
      rect(g, cx - 2, cy - 12, 4, 12, PAL.trunk);
      rect(g, cx + 1, cy - 12, 1, 12, PAL.trunkDark);
      rect(g, cx - 3, cy - 1, 6, 1, PAL.trunkDark);
      const L = kind === 'blossom' ? '#ffc8dc' : PAL.leafLight;
      const M = kind === 'blossom' ? '#f59bbd' : PAL.leaf;
      const D = kind === 'blossom' ? '#d9739b' : PAL.leafDark;
      const sp = kind === 'blossom' ? '#ffffff' : '#9be36b';
      blob(g, cx, cy - 22, 10 + (v === 1 ? 1 : 0), L, M, D, 31 + v, sp);
      blob(g, cx - 6, cy - 18, 6, L, M, D, 33 + v, sp);
      blob(g, cx + 6, cy - 17, 6.5, L, M, D, 35 + v, sp);
      blob(g, cx - 2, cy - 29, 6, L, M, D, 37 + v, sp);
      if (v === 2 && kind === 'round') for (const [dx, dy] of [[-4, -22], [5, -20], [1, -27]] as const) rect(g, cx + dx, cy + dy, 2, 2, '#ff6b5a');
    }
  });
}

export function bushProp(variant: number): Baked {
  const v = variant % 3;
  return bakeIso(`bush:${v}`, -0.4, -0.4, 0.4, 0.4, 16, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    ellipse(g, cx, cy, 7, 3, 'rgba(30,60,30,0.25)');
    blob(g, cx - 2, cy - 5, 5, PAL.leafLight, PAL.leaf, PAL.leafDark, 51 + v);
    blob(g, cx + 3, cy - 4, 4, PAL.leafLight, PAL.leaf, PAL.leafDark, 53 + v);
    if (v === 1) for (const [dx, dy] of [[-3, -7], [2, -6], [4, -3]] as const) rect(g, cx + dx, cy + dy, 1, 1, '#fff3a3');
    if (v === 2) for (const [dx, dy] of [[-4, -6], [1, -8], [3, -4]] as const) rect(g, cx + dx, cy + dy, 1, 1, '#ff8fb1');
  });
}

export function rockProp(variant: number): Baked {
  const v = variant % 2;
  return bakeIso(`rock:${v}`, -0.3, -0.3, 0.3, 0.3, 10, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    blob(g, cx, cy - 2, v ? 4 : 3, PAL.rockLight, PAL.rock, '#6c6674', 61 + v);
  });
}

/** One fence segment of 1 tile along x (axis 'x', at local ty=0) or along y (axis 'y', at local tx=0). */
export function fenceProp(axis: 'x' | 'y', color: string, len = 1): Baked {
  const panel = mix(color, '#ffffff', 0.58);
  const panelDark = mix(color, '#ffffff', 0.38);
  const rail = mix(color, '#ffffff', 0.78);
  const post = shade(color, -0.12);
  const base = shade(color, -0.32);
  const x1 = axis === 'x' ? len : 0.06;
  const y1 = axis === 'y' ? len : 0.06;
  return bakeIso(`fence:${axis}:${color}:${len}`, 0, 0, x1, y1, 14, (g, ox, oy) => {
    const W = axis === 'x' ? wallX : wallY;
    W(g, ox, oy, 0, len, 0, 0, 2, base);
    W(g, ox, oy, 0, len, 0, 2, 10, panel);
    // vertical pickets
    const steps = Math.max(2, Math.round(len * 6));
    for (let i = 1; i < steps; i++) {
      const t = (i / steps) * len;
      const a = axis === 'x' ? P(ox, oy, t, 0, 9) : P(ox, oy, 0, t, 9);
      rect(g, a[0], a[1], 1, 7, panelDark);
    }
    W(g, ox, oy, 0, len, 0, 10, 12, rail);
    if (axis === 'x') flat(g, ox, oy, 0, 0, len, 0.06, 12, shade(rail, 0.3));
    else flat(g, ox, oy, 0, 0, 0.06, len, 12, shade(rail, 0.3));
    // posts at both ends
    for (const t of [0, len]) {
      const tx = axis === 'x' ? t - 0.04 : -0.02;
      const ty = axis === 'y' ? t - 0.04 : -0.02;
      box(g, ox, oy, tx, ty, 0.08, 0.08, 0, 14, { top: shade(rail, 0.2), left: post, right: shade(post, -0.2) });
    }
  });
}

export function lampProp(): Baked {
  return bakeIso('lamp', -0.2, -0.2, 0.2, 0.2, 34, (g, ox, oy) => {
    box(g, ox, oy, -0.08, -0.08, 0.16, 0.16, 0, 3, tones('#3c3f4e'));
    box(g, ox, oy, -0.025, -0.025, 0.05, 0.05, 3, 23, tones('#3c3f4e'));
    box(g, ox, oy, -0.08, -0.08, 0.16, 0.16, 26, 5, { top: '#fff4c9', left: '#ffd56b', right: '#f2b84a' });
    box(g, ox, oy, -0.1, -0.1, 0.2, 0.2, 31, 2, tones('#3c3f4e'));
  });
}

/** Screen-facing wooden sign on a pole with the department name and a little flag. */
export function signProp(text: string, color: string): Baked {
  const tw = textWidth(text);
  const bw = tw + 10;
  const bh = 15;
  const w = Math.max(bw, 20) + 4;
  const poleH = 48;
  const h = poleH + 6;
  const cx = Math.floor(w / 2);
  return bake(`sign:${text}:${color}`, w, h, cx, h - 2, (g) => {
    const by = h - 2;
    rect(g, cx - 1, by - poleH, 3, poleH, PAL.woodDark);
    rect(g, cx - 1, by - poleH, 1, poleH, PAL.wood);
    rect(g, cx - 2, by - 2, 5, 2, PAL.woodDeep);
    // flag
    rect(g, cx + 2, by - poleH, 8, 5, color);
    rect(g, cx + 2, by - poleH, 8, 1, shade(color, 0.3));
    rect(g, cx + 9, by - poleH + 1, 1, 3, shade(color, -0.2));
    rect(g, cx - 1, by - poleH - 2, 3, 2, '#ffd166');
    // board
    const bx0 = cx - Math.floor(bw / 2);
    const by0 = by - 38;
    rect(g, bx0 - 1, by0 - 1, bw + 2, bh + 2, PAL.outline);
    rect(g, bx0, by0, bw, bh, color);
    rect(g, bx0, by0, bw, 1, shade(color, 0.35));
    rect(g, bx0, by0 + bh - 2, bw, 2, shade(color, -0.25));
    drawPixelText(g, text, bx0 + 5, by0 + 5, shade(color, -0.5));
    drawPixelText(g, text, bx0 + 5, by0 + 4, '#ffffff');
  });
}

export function boxesProp(variant: number): Baked {
  const v = variant % 3;
  return bakeIso(`boxes:${v}`, -0.05, -0.05, 0.75, 0.6, 24, (g, ox, oy) => {
    const cb = tones('#cf9a5b', 0.14, -0.24);
    box(g, ox, oy, 0, 0, 0.42, 0.42, 0, 9, cb);
    flat(g, ox, oy, 0.18, 0, 0.06, 0.42, 9, '#e9c27f');
    box(g, ox, oy, 0.4, 0.12, 0.3, 0.3, 0, 7, tones('#d7a96a', 0.14, -0.24));
    if (v !== 1) {
      box(g, ox, oy, 0.06, 0.06, 0.32, 0.32, 9, 7, tones('#c48b4d', 0.14, -0.24));
      flat(g, ox, oy, 0.2, 0.06, 0.05, 0.32, 16, '#e9c27f');
    }
    if (v === 2) box(g, ox, oy, 0.45, 0.16, 0.2, 0.2, 7, 5, tones('#9ad1ff', 0.14, -0.24));
  });
}

/** Bookshelf against a back wall: 'x' = long along x (books face +y), 'y' = long along y (books face +x). */
export function shelfProp(axis: 'x' | 'y', seed: number): Baked {
  const swap = axis === 'y';
  const { bx, pt } = axes(swap);
  const A = 0.9;
  const B = 0.26;
  return bakeIso(`shelf:${axis}:${seed % 5}`, 0, 0, swap ? B : A, swap ? A : B, 30, (g, ox, oy) => {
    bx(g, ox, oy, 0, 0, A, B, 0, 26, { top: PAL.woodLight, left: PAL.wood, right: PAL.woodDark });
    const books = ['#e5484d', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#f472b6', '#f7f4ee', '#14b8a6'];
    for (let s = 0; s < 3; s++) {
      const z0 = 3 + s * 8;
      // shelf cavity
      fillPoly(g, [pt(ox, oy, 0.05, B, z0 + 6.5), pt(ox, oy, A - 0.05, B, z0 + 6.5), pt(ox, oy, A - 0.05, B, z0), pt(ox, oy, 0.05, B, z0)], PAL.woodDeep);
      let a = 0.07;
      let k = 0;
      while (a < A - 0.1) {
        const r = hash2(s, k, seed);
        const wB = 0.045 + r * 0.04;
        const hB = 4 + Math.floor(r * 3);
        if (r > 0.12) {
          const col = books[Math.floor(hash2(k, s, seed + 7) * books.length)];
          fillPoly(g, [pt(ox, oy, a, B + 0.001, z0 + hB), pt(ox, oy, a + wB, B + 0.001, z0 + hB), pt(ox, oy, a + wB, B + 0.001, z0), pt(ox, oy, a, B + 0.001, z0)], col);
        }
        a += wB + 0.012;
        k++;
      }
    }
  });
}

export function whiteboardProp(axis: 'x' | 'y', accent: string): Baked {
  const swap = axis === 'y';
  const { bx, pt } = axes(swap);
  return bakeIso(`wb:${axis}:${accent}`, 0, 0, swap ? 0.1 : 1, swap ? 1 : 0.1, 30, (g, ox, oy) => {
    bx(g, ox, oy, 0.08, 0.02, 0.05, 0.05, 0, 9, tones('#8b8fa0'));
    bx(g, ox, oy, 0.87, 0.02, 0.05, 0.05, 0, 9, tones('#8b8fa0'));
    bx(g, ox, oy, 0, 0, 1, 0.06, 9, 17, { top: '#c9ccd8', left: '#aeb2c2', right: '#9195a8' });
    const face = (a0: number, a1: number, z0: number, z1: number, c: string) =>
      fillPoly(g, [pt(ox, oy, a0, 0.061, z1), pt(ox, oy, a1, 0.061, z1), pt(ox, oy, a1, 0.061, z0), pt(ox, oy, a0, 0.061, z0)], c);
    face(0.05, 0.95, 10.5, 24.5, '#fbfdff');
    // bar chart + trend line
    const bars = [0.3, 0.5, 0.42, 0.75, 0.9];
    bars.forEach((v, i) => face(0.14 + i * 0.13, 0.22 + i * 0.13, 12, 12 + v * 9, i === 4 ? accent : mix(accent, '#ffffff', 0.45)));
    for (let i = 0; i < 6; i++) {
      const [x, y] = pt(ox, oy, 0.12 + i * 0.14, 0.061, 16 + i * 1.3 + (i % 2) * 1.5);
      rect(g, x, y, 2, 1, '#ef4444');
    }
  });
}

export function coolerProp(): Baked {
  return bakeIso('cooler', -0.2, -0.2, 0.2, 0.2, 26, (g, ox, oy) => {
    box(g, ox, oy, -0.14, -0.14, 0.28, 0.28, 0, 12, tones('#e8eaf2', 0.06, -0.18));
    box(g, ox, oy, -0.11, -0.11, 0.22, 0.22, 12, 8, { top: '#bfe8ff', left: '#7cc7f2', right: '#5aa9db' });
    box(g, ox, oy, -0.04, -0.04, 0.08, 0.08, 20, 2, tones('#3b82f6'));
    const [x, y] = P(ox, oy, 0, 0.14, 8);
    rect(g, x - 1, y, 2, 1, '#3b82f6');
  });
}

export function globeProp(): Baked {
  return bakeIso('globe', -0.2, -0.2, 0.2, 0.2, 26, (g, ox, oy) => {
    box(g, ox, oy, -0.1, -0.1, 0.2, 0.2, 0, 2, tones(PAL.woodDark));
    box(g, ox, oy, -0.02, -0.02, 0.04, 0.04, 2, 8, tones(PAL.woodDark));
    const [cx, cy] = P(ox, oy, 0, 0, 16);
    blob(g, cx, cy, 6, '#9fd8ff', '#4aa3e8', '#2f6fb8', 71);
    for (const [dx, dy, w] of [[-3, -3, 3], [1, -1, 3], [-2, 2, 2], [2, 3, 2]] as const) rect(g, cx + dx, cy + dy, w, 2, '#5cbf6a');
    rect(g, cx - 7, cy - 1, 1, 3, '#c9a44a');
    rect(g, cx + 6, cy - 1, 1, 3, '#c9a44a');
  });
}

export function sofaProp(axis: 'x' | 'y', color: string): Baked {
  const swap = axis === 'y';
  const { bx } = axes(swap);
  return bakeIso(`sofa:${axis}:${color}`, 0, 0, swap ? 0.5 : 1.2, swap ? 1.2 : 0.5, 18, (g, ox, oy) => {
    const t = tones(color, 0.14, -0.24);
    bx(g, ox, oy, 0, 0, 1.2, 0.5, 0, 5, t);
    bx(g, ox, oy, 0, 0, 1.2, 0.14, 5, 7, tones(shade(color, -0.08), 0.14, -0.24));
    bx(g, ox, oy, 0, 0.14, 0.14, 0.36, 5, 4, t);
    bx(g, ox, oy, 1.06, 0.14, 0.14, 0.36, 5, 4, t);
    bx(g, ox, oy, 0.16, 0.16, 0.42, 0.3, 5, 1, tones(shade(color, 0.12)));
    bx(g, ox, oy, 0.62, 0.16, 0.42, 0.3, 5, 1, tones(shade(color, 0.12)));
  });
}

export function safeProp(): Baked {
  return bakeIso('safe', 0, 0, 0.5, 0.5, 20, (g, ox, oy) => {
    box(g, ox, oy, 0, 0, 0.5, 0.5, 0, 14, { top: '#8e93a3', left: '#6b7080', right: '#555a69' });
    const [x, y] = P(ox, oy, 0.25, 0.5, 8);
    rect(g, x - 2, y - 2, 4, 4, '#3c404c');
    rect(g, x - 1, y - 1, 2, 2, '#ffd166');
    box(g, ox, oy, 0.05, 0.05, 0.12, 0.12, 14, 3, tones('#ffd166', 0.2, -0.2));
    box(g, ox, oy, 0.2, 0.1, 0.12, 0.12, 14, 2, tones('#ffd166', 0.2, -0.2));
  });
}

export function easelProp(seed: number): Baked {
  return bakeIso(`easel:${seed % 3}`, -0.3, -0.3, 0.3, 0.3, 32, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    for (let i = 0; i < 26; i++) {
      rect(g, cx - 6 + i * 0.22, cy - i, 1, 1, PAL.woodDark);
      rect(g, cx + 6 - i * 0.22, cy - i, 1, 1, PAL.woodDark);
    }
    rect(g, cx, cy - 26, 1, 26, PAL.wood);
    rect(g, cx - 8, cy - 27, 17, 15, '#fbfaf6');
    rect(g, cx - 8, cy - 27, 17, 1, '#e4dfd4');
    const cols = ['#ff6b8a', '#ffd166', '#4aa3e8', '#7bd389', '#a78bfa'];
    for (let i = 0; i < 5; i++) {
      const c = cols[(i + seed) % cols.length];
      rect(g, cx - 6 + Math.floor(hash2(i, 1, seed) * 10), cy - 25 + Math.floor(hash2(i, 2, seed) * 9), 3 + (i % 2), 3, c);
    }
    rect(g, cx - 9, cy - 12, 19, 2, PAL.woodDark);
  });
}

export function ringLightProp(): Baked {
  return bakeIso('ringlight', -0.3, -0.3, 0.3, 0.3, 36, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    rect(g, cx - 5, cy - 1, 11, 1, '#3c3f4e');
    rect(g, cx - 3, cy - 3, 1, 2, '#3c3f4e');
    rect(g, cx + 3, cy - 3, 1, 2, '#3c3f4e');
    rect(g, cx, cy - 22, 1, 22, '#3c3f4e');
    const ry = cy - 28;
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      rect(g, cx + Math.round(Math.cos(t) * 7), ry + Math.round(Math.sin(t) * 7), 1, 1, a % 5 ? '#fff6d6' : '#ffd166');
    }
    rect(g, cx - 2, ry - 4, 5, 8, '#22202c');
    rect(g, cx - 1, ry - 3, 3, 6, '#ff5d8f');
  });
}

export function mailTrayProp(): Baked {
  return bakeIso('mail', 0, 0, 0.8, 0.3, 26, (g, ox, oy) => {
    box(g, ox, oy, 0, 0, 0.8, 0.3, 0, 20, { top: '#c8935a', left: '#b17a46', right: '#8a5a33' });
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const a0 = 0.05 + c * 0.19;
        const z0 = 2 + r * 6;
        fillPoly(g, [P(ox, oy, a0, 0.3, z0 + 5), P(ox, oy, a0 + 0.16, 0.3, z0 + 5), P(ox, oy, a0 + 0.16, 0.3, z0), P(ox, oy, a0, 0.3, z0)], '#5c3a20');
        if (hash2(r, c, 9) > 0.35) fillPoly(g, [P(ox, oy, a0 + 0.02, 0.301, z0 + 3), P(ox, oy, a0 + 0.14, 0.301, z0 + 3), P(ox, oy, a0 + 0.14, 0.301, z0), P(ox, oy, a0 + 0.02, 0.301, z0)], hash2(c, r, 3) > 0.7 ? '#ffd166' : '#fbfaf6');
      }
    }
  });
}

export function printerProp(): Baked {
  return bakeIso('printer', 0, 0, 0.5, 0.42, 20, (g, ox, oy) => {
    box(g, ox, oy, 0.04, 0.04, 0.42, 0.34, 0, 8, tones('#6f7487'));
    box(g, ox, oy, 0, 0, 0.5, 0.42, 8, 6, tones('#e6e8ef', 0.06, -0.2));
    box(g, ox, oy, 0.1, 0.06, 0.3, 0.2, 14, 1, tones(PAL.paper));
    const [x, y] = P(ox, oy, 0.42, 0.42, 11);
    rect(g, x - 2, y, 2, 1, '#22c55e');
  });
}

export function cabinetProp(): Baked {
  return bakeIso('cabinet', 0, 0, 0.36, 0.42, 22, (g, ox, oy) => {
    box(g, ox, oy, 0, 0, 0.36, 0.42, 0, 17, { top: '#c3c7d4', left: '#a3a8b8', right: '#878c9c' });
    for (let i = 0; i < 3; i++) {
      const [x, y] = P(ox, oy, 0.18, 0.42, 3 + i * 5.2);
      rect(g, x - 1, y - 1, 3, 1, '#5b6170');
    }
  });
}

export function meetingTableProp(top: string): Baked {
  return bakeIso(`mtable:${top}`, -0.6, -0.6, 0.6, 0.6, 14, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    ellipse(g, cx, cy, 10, 4, 'rgba(40,30,60,0.18)');
    box(g, ox, oy, -0.06, -0.06, 0.12, 0.12, 0, 7, tones('#4a4556'));
    cylinder(g, cx, cy - 7, 15, 7.5, 2, top, shade(top, -0.18), shade(top, -0.3));
    ellipse(g, cx - 3, cy - 11, 4, 1.5, shade(top, 0.25));
    rect(g, cx + 3, cy - 11, 3, 2, PAL.paper);
    rect(g, cx - 5, cy - 9, 2, 2, '#f7f4ee');
  });
}

export function stoolProp(color: string): Baked {
  return bakeIso(`stool:${color}`, -0.2, -0.2, 0.2, 0.2, 10, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    rect(g, cx, cy - 5, 1, 5, '#4a4556');
    cylinder(g, cx, cy - 5, 4, 2, 2, shade(color, 0.12), color, shade(color, -0.25));
  });
}

// ───────────── café ─────────────

export function counterProp(): { baked: Baked; machine: P2 } {
  let machine: P2 = [0, 0];
  const baked = bakeIso('counter', 0, 0, 1.9, 0.55, 34, (g, ox, oy) => {
    box(g, ox, oy, 0, 0, 1.9, 0.55, 0, 11, { top: '#f6efe3', left: '#c98b54', right: '#a46c3e' });
    for (let i = 0; i < 9; i++) {
      const a = 0.1 + i * 0.2;
      fillPoly(g, [P(ox, oy, a, 0.551, 9), P(ox, oy, a + 0.08, 0.551, 9), P(ox, oy, a + 0.08, 0.551, 1), P(ox, oy, a, 0.551, 1)], i % 2 ? '#e7b07b' : '#b97a45');
    }
    flat(g, ox, oy, 0, 0.45, 1.9, 0.1, 11, '#e5484d');
    // espresso machine
    box(g, ox, oy, 0.15, 0.08, 0.42, 0.34, 11, 12, { top: '#d8dce6', left: '#b8bdc9', right: '#9aa0ae' });
    box(g, ox, oy, 0.15, 0.08, 0.42, 0.06, 23, 3, tones('#e5484d', 0.15, -0.25));
    const front = P(ox, oy, 0.36, 0.42, 16);
    rect(g, front[0] - 2, front[1] - 1, 5, 2, '#3c404c');
    rect(g, front[0] - 1, front[1] + 3, 3, 3, '#fbfbf8');
    machine = [front[0] - ox, front[1] - oy - 10];
    counterMachine = machine;
    // pastry display
    box(g, ox, oy, 0.85, 0.1, 0.5, 0.36, 11, 7, { top: '#e6f7ff', left: '#bfe3f5', right: '#a3cfe6' });
    for (const [a, c] of [[0.95, '#e0a060'], [1.08, '#f3c26b'], [1.2, '#d4835a']] as const) box(g, ox, oy, a, 0.2, 0.08, 0.1, 12, 2, tones(c));
    // cups
    for (let i = 0; i < 3; i++) box(g, ox, oy, 1.48 + i * 0.12, 0.25, 0.08, 0.08, 11, 3, tones('#fbfbf8'));
  });
  return { baked, machine: machine[0] || machine[1] ? machine : counterMachine };
}

export function parasolProp(color: string): Baked {
  return bakeIso(`parasol:${color}`, -1, -1, 1, 1, 42, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    rect(g, cx - 3, cy - 1, 7, 2, '#5b6170');
    rect(g, cx, cy - 32, 1, 31, '#e8e3da');
    const top = cy - 32;
    const rx = 21;
    const ry = 10;
    for (let y = -ry; y <= 3; y++) {
      const k = y < 0 ? 1 - (y / ry) ** 2 : 1;
      const hw = Math.round(rx * Math.sqrt(Math.max(0, k)) * (y < 0 ? 1 : 1 - y * 0.02));
      for (let x = -hw; x < hw; x++) {
        const sector = Math.floor(((Math.atan2(y * 2, x) + Math.PI) / (Math.PI * 2)) * 10);
        let c = sector % 2 ? '#ffffff' : color;
        if (y >= 1) c = sector % 2 ? '#e8e3da' : shade(color, -0.2);
        else if (x + y > rx * 0.55) c = sector % 2 ? '#e6e1ea' : shade(color, -0.12);
        rect(g, cx + x, top + y + 6, 1, 1, c);
      }
    }
    rect(g, cx - 1, top - 6, 2, 2, shade(color, -0.2));
  });
}

export function cafeTableProp(top: string): Baked {
  return bakeIso(`ctable:${top}`, -0.3, -0.3, 0.3, 0.3, 14, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    rect(g, cx - 2, cy - 1, 5, 1, '#4a4556');
    rect(g, cx, cy - 8, 1, 8, '#4a4556');
    cylinder(g, cx, cy - 8, 7, 3.5, 1, top, shade(top, -0.2), shade(top, -0.3));
    rect(g, cx - 2, cy - 11, 2, 2, '#fbfbf8');
    rect(g, cx + 2, cy - 10, 2, 1, '#e0a060');
  });
}

export function menuBoardProp(): Baked {
  return bakeIso('menuboard', -0.5, -0.5, 0.5, 0.5, 28, (g, ox, oy) => {
    const [cx, cy] = P(ox, oy, 0, 0, 0);
    for (let i = 0; i < 18; i++) {
      rect(g, cx - 11 + i * 0.12, cy - i, 1, 1, PAL.woodDark);
      rect(g, cx + 11 - i * 0.12, cy - i, 1, 1, PAL.woodDark);
    }
    rect(g, cx - 14, cy - 24, 29, 17, PAL.woodDark);
    rect(g, cx - 13, cy - 23, 27, 15, '#2f3b36');
    drawPixelText(g, 'CAFÉ', cx - 11, cy - 19, '#f7f4ee');
    rect(g, cx - 10, cy - 10, 9, 1, '#ffd166');
    rect(g, cx + 2, cy - 10, 7, 1, '#ff8fb1');
  });
}

export function benchProp(axis: 'x' | 'y'): Baked {
  const swap = axis === 'y';
  const { bx } = axes(swap);
  return bakeIso(`bench:${axis}`, 0, 0, swap ? 0.4 : 1.1, swap ? 1.1 : 0.4, 14, (g, ox, oy) => {
    const legs = tones('#4a4556');
    bx(g, ox, oy, 0.08, 0.08, 0.06, 0.24, 0, 5, legs);
    bx(g, ox, oy, 0.96, 0.08, 0.06, 0.24, 0, 5, legs);
    for (let i = 0; i < 3; i++) bx(g, ox, oy, 0, 0.04 + i * 0.11, 1.1, 0.09, 5, 1.5, tones(i % 2 ? PAL.woodLight : PAL.wood, 0.12, -0.25));
    bx(g, ox, oy, 0, 0, 1.1, 0.06, 6.5, 6, tones(PAL.wood, 0.12, -0.25));
  });
}

export function flowerBedProp(seed: number): Baked {
  return bakeIso(`flowers:${seed % 4}`, 0, 0, 1, 0.5, 14, (g, ox, oy) => {
    box(g, ox, oy, 0, 0, 1, 0.5, 0, 4, tones('#a9a1b5', 0.1, -0.25));
    flat(g, ox, oy, 0.05, 0.05, 0.9, 0.4, 4, '#5a3b26');
    const cols = ['#ff6b8a', '#ffd166', '#ffffff', '#c084fc', '#ff9f43'];
    for (let i = 0; i < 14; i++) {
      const a = 0.1 + hash2(i, 1, seed) * 0.8;
      const b = 0.1 + hash2(i, 2, seed) * 0.3;
      const [x, y] = P(ox, oy, a, b, 4);
      rect(g, x, y - 4, 1, 4, PAL.leafDark);
      rect(g, x - 1, y - 6, 3, 2, cols[(i + seed) % cols.length]);
    }
  });
}

/** Pixel "Cerveau" plaque on a small stone stand, screen facing. */
export function plaqueProp(text: string, color: string): Baked {
  const tw = textWidth(text);
  const w = tw + 14;
  const h = 30;
  return bake(`plaque:${text}:${color}`, w, h, Math.floor(w / 2), h - 2, (g) => {
    const cx = Math.floor(w / 2);
    const by = h - 2;
    rect(g, cx - 4, by - 10, 8, 10, '#b9b0c8');
    rect(g, cx - 4, by - 10, 8, 1, '#d8d0e4');
    const bw = tw + 8;
    const x0 = cx - Math.floor(bw / 2);
    rect(g, x0 - 1, by - 24, bw + 2, 15, PAL.outline);
    rect(g, x0, by - 23, bw, 13, color);
    rect(g, x0, by - 23, bw, 1, shade(color, 0.35));
    drawPixelText(g, text, x0 + 4, by - 19, shade(color, -0.5));
    drawPixelText(g, text, x0 + 4, by - 20, '#ffffff');
  });
}
