// Central plaza: pink paved circle, the glowing "Cerveau" crystal fountain, the café corner
// (counter, espresso machine, red parasol, checkered floor), the fenced Direction office
// and the league's stage: podium and trophy wall on the right, board and duel table on the left.
import type { DeptDef } from '../../../shared/types';
import { isoX, isoY, type Facing, type Pt } from './iso';
import { Occupancy, deskSlots, faceTowards, gateCorridor } from './islands';
import type { Gate, IslandModel, Light, Rect, Seat, Side, Sprite } from './model';
import { place } from './model';
import { PAL, hexToRgb, mix, shade } from './palette';
import { blob, bake, cylinder, ellipse, hash2, rect, type Baked, type P2 } from './pixel';
import {
  TROPHY_WALL_W, benchProp, bushProp, cafeTableProp, chairProp, coolerProp, counterProp, deskProp, duelTableProp, fenceProp,
  flowerBedProp, globeProp, lampProp, meetingTableProp, menuBoardProp, parasolProp, plantProp, plaqueProp, podiumProp, signProp, treeProp,
} from './props';
import { SIDE_DEPTH, paintFloor, paintPath, paintTerrain } from './terrain';

export const PLAZA_SIZE = 15;
const C = PLAZA_SIZE / 2; // fountain centre (local)
export const FOUNTAIN_R = 1.6;
export const RING_R = 2.75;
const OFFICE: Rect = { x0: 0.6, y0: 0.6, x1: 5.2, y1: 5.2 };
const CAFE: Rect = { x0: 10.0, y0: 0.6, x1: 14.4, y1: 4.8 };
const OFFICE_GATES: Side[] = ['x+', 'y+'];
// The stage, local tiles: the plaza's two front corners, which `frontPathGate` keeps walkers out of.
const PODIUM: Rect = { x0: 11.3, y0: 11.6, x1: 13.5, y1: 12.8 };
const WALL: Rect = { x0: 11.4, y0: 10.85, x1: 11.4 + TROPHY_WALL_W, y1: 11.1 };
const BOARD: Pt = { tx: 2.0, ty: 12.0 };
const DUEL: Pt = { tx: 4.2, ty: 11.0 };
const DUEL_SPOTS: [Pt, Pt] = [{ tx: 3.5, ty: 11.0 }, { tx: 4.9, ty: 11.0 }];
const CHANNEL_SLOTS: Pt[] = [
  { tx: 8.7, ty: 14.45 }, { tx: 10.0, ty: 14.45 }, { tx: 11.3, ty: 14.45 }, { tx: 12.6, ty: 14.45 },
  { tx: 14.45, ty: 10.0 }, { tx: 14.45, ty: 11.3 }, { tx: 14.45, ty: 13.0 }, { tx: 14.45, ty: 8.7 },
];
/** What walkers must keep out of, local tiles: the stage's footprints and the two duellists. */
export const STAGE_ZONES: Rect[] = [
  PODIUM, WALL,
  { x0: BOARD.tx - 0.3, y0: BOARD.ty - 0.15, x1: BOARD.tx + 0.3, y1: BOARD.ty + 0.15 },
  { x0: DUEL.tx - 0.55, y0: DUEL.ty - 0.35, x1: DUEL.tx + 0.55, y1: DUEL.ty + 0.35 },
  ...DUEL_SPOTS.map((p) => ({ x0: p.tx - 0.2, y0: p.ty - 0.2, x1: p.tx + 0.2, y1: p.ty + 0.2 })),
];

function fountainProp(): Baked {
  return bake('fountain', 96, 92, 48, 70, (g, cx, cy) => {
    // stone platform
    cylinder(g, cx, cy, 40, 20, 3, '#f6eefe', '#d9c9ef', '#c4b0e0');
    // basin
    cylinder(g, cx, cy - 3, 35, 17.5, 10, PAL.fountainMid, PAL.fountainDark, '#2c1f5e');
    ellipse(g, cx, cy - 13, 31, 15.5, '#7a64d8');
    ellipse(g, cx, cy - 13, 28, 14, '#9b8cff');
    // ripples
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = 18 + (i % 3) * 3;
      rect(g, cx + Math.cos(a) * rr, cy - 13 + Math.sin(a) * rr * 0.5, 2, 1, i % 2 ? '#c9c1ff' : '#b4a8ff');
    }
    // rim highlight
    for (let x = -34; x <= 34; x++) {
      const y = -Math.sqrt(Math.max(0, 1 - (x / 35) ** 2)) * 17.5;
      rect(g, cx + x, cy - 13 + y, 1, 1, PAL.fountainRim);
    }
    // pedestal
    cylinder(g, cx, cy - 13, 10, 5, 14, '#6a52c0', '#4b3796', '#3b2a78');
    cylinder(g, cx, cy - 27, 13, 6.5, 3, '#f2e6ff', '#d8c6f2', '#c3aee6');
    // crystal orb
    blob(g, cx, cy - 41, 11, PAL.crystalLight, PAL.crystal, '#c45ab8', 91, '#ffffff');
    rect(g, cx - 5, cy - 47, 3, 2, '#ffffff');
    rect(g, cx - 6, cy - 45, 1, 2, '#ffffff');
    // orbit ring
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const x = cx + Math.cos(a) * 16;
      const y = cy - 40 + Math.sin(a) * 4;
      if (Math.sin(a) < 0 && Math.abs(Math.cos(a)) < 0.68) continue; // hidden behind the orb
      rect(g, x, y, 1, 1, i % 4 === 0 ? '#ffffff' : '#ead7ff');
    }
  });
}

export interface PlazaInput {
  def: DeptDef | null;
  name: string;
  color: string;
  center: Pt;
  bridgeSides: Side[];
}

export function buildPlaza(inp: PlazaInput): IslandModel {
  const N = PLAZA_SIZE;
  const x0 = inp.center.tx - N / 2;
  const y0 = inp.center.ty - N / 2;
  const seed = 4242;
  const color = inp.color;
  const W = (p: Pt): Pt => ({ tx: p.tx + x0, ty: p.ty + y0 });
  const sprites: Sprite[] = [];
  const lights: Light[] = [];
  const add = (b: Baked, lx: number, ly: number, bias = 0) => sprites.push(place(b, lx + x0, ly + y0, lx + x0 + ly + y0 + bias));
  const addAt = (b: Baked, lx: number, ly: number, w: number, d: number) => sprites.push(place(b, lx + x0, ly + y0, lx + w / 2 + x0 + ly + d / 2 + y0));

  // ── terrain + paving
  const t = paintTerrain(N, seed);
  const topH = N * 16;
  const img = t.g.getImageData(0, 0, t.c.width, topH + 2);
  const d = img.data;
  const stoneA = hexToRgb(PAL.plazaStone);
  const stoneB = hexToRgb(PAL.plazaStoneAlt);
  const ring = hexToRgb(PAL.plazaRing);
  const ringDark = hexToRgb(PAL.plazaRingDark);
  const inner = hexToRgb('#fff1f8');
  const confetti = ['#ff6b8a', '#ffd166', '#7dd3fc', '#a78bfa', '#4ade80', '#ffffff'].map(hexToRgb);
  for (let y = 0; y < topH + 2; y++) {
    for (let x = 0; x < t.c.width; x++) {
      const a = (x + 0.5 - t.ox) / 16;
      const b = (y + 0.5 - t.oy) / 8;
      const tx = (a + b) / 2;
      const ty = (b - a) / 2;
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const dist = Math.hypot(tx - C, ty - C);
      if (dist > 5.95) continue;
      const ang = Math.atan2(ty - C, tx - C) + Math.PI;
      const band = Math.floor(dist / 0.72);
      const sector = Math.floor((ang / (Math.PI * 2)) * (8 + band * 5));
      let col = (band + sector) % 2 === 0 ? stoneA : stoneB;
      if (dist < 2.05) col = inner;
      if (Math.abs(dist - 2.55) < 0.1 || Math.abs(dist - 4.25) < 0.08) col = ring;
      if (dist > 5.72) col = ringDark;
      else if (dist > 5.55) col = ring;
      const n = hash2(x, y, 77);
      if (dist < 5.5 && n > 0.988) col = confetti[Math.floor(hash2(y, x, 78) * confetti.length)];
      const i = (y * t.c.width + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
    }
  }
  t.g.putImageData(img, 0, 0);
  paintFloor(t, CAFE.x0, CAFE.y0, CAFE.x1, CAFE.y1, PAL.cafeA, PAL.cafeB, 0.5);
  paintFloor(t, OFFICE.x0, OFFICE.y0, OFFICE.x1, OFFICE.y1, mix(color, '#ffffff', 0.58), mix(color, '#ffffff', 0.48), 1);
  for (const [ax, ay, bx, by] of [[C, 0.1, C, C - 5.9], [C, N - 0.1, C, C + 5.9], [0.1, C, C - 5.9, C], [N - 0.1, C, C + 5.9, C]] as const) paintPath(t, ax, ay, bx, by, 5);

  // ── Direction office
  const occ = new Occupancy(OFFICE);
  const mid = (OFFICE.x0 + OFFICE.x1) / 2;
  for (const s of OFFICE_GATES) occ.mark(gateCorridor(s, OFFICE, mid));
  const slots = deskSlots(OFFICE, occ, 4); // constant, whoever is in: the office fits 3, the others stand at the table
  const seats: Seat[] = [];
  slots.forEach((s, i) => {
    const desk = deskProp(s.facing, i === 0 ? '#d9b58a' : '#f2efe9', i + 2, i === 0 && s.desk.x1 - s.desk.x0 > 1.2);
    const spr = place(desk.baked, s.desk.x0 + x0, s.desk.y0 + y0, (s.desk.x0 + s.desk.x1) / 2 + x0 + (s.desk.y0 + s.desk.y1) / 2 + y0);
    sprites.push(spr);
    const wx = isoX(s.desk.x0 + x0, s.desk.y0 + y0);
    const wy = isoY(s.desk.x0 + x0, s.desk.y0 + y0);
    add(chairProp(s.facing, i === 0 ? '#7a3b5e' : mix(shade(color, -0.4), '#4b4f63', 0.5)), s.seat.tx, s.seat.ty, 0.05);
    seats.push({ pos: W(s.seat), facing: s.facing, aisle: W(s.aisle), screen: desk.screen.map(([px, py]) => [wx + px, wy + py] as P2), deskDepth: spr.depth, chief: i === 0, sprites: [spr, sprites[sprites.length - 1]!] });
  });
  const table: Pt = { tx: 3.55, ty: 3.65 };
  add(meetingTableProp('#e9d3b1'), table.tx, table.ty);
  add(globeProp(), 4.78, 1.05);
  add(plantProp(1), 0.95, 4.85);
  add(coolerProp(), 4.85, 4.85);
  const gates: Gate[] = [];
  const fenceColor = shade(color, -0.05);
  const fence = (side: Side) => {
    const along = side === 'y-' || side === 'y+' ? 'x' : 'y';
    const fixed = side === 'y-' ? OFFICE.y0 : side === 'y+' ? OFFICE.y1 : side === 'x-' ? OFFICE.x0 : OFFICE.x1;
    const lo = along === 'x' ? OFFICE.x0 : OFFICE.y0;
    const hi = along === 'x' ? OFFICE.x1 : OFFICE.y1;
    const hasGate = OFFICE_GATES.includes(side);
    const segs: [number, number][] = hasGate ? [[lo, mid - 0.6], [mid + 0.6, hi]] : [[lo, hi]];
    for (const [s0, s1] of segs) {
      for (let a = s0; a < s1 - 1e-3; a += 0.5) {
        const len = Math.round(Math.min(0.5, s1 - a) * 20) / 20;
        const b = fenceProp(along, fenceColor, len);
        if (along === 'x') sprites.push(place(b, a + x0, fixed + y0, a + len / 2 + x0 + fixed + y0));
        else sprites.push(place(b, fixed + x0, a + y0, fixed + x0 + a + len / 2 + y0));
      }
    }
    if (hasGate) {
      const innerP = side === 'x+' ? { tx: OFFICE.x1 - 0.55, ty: mid } : { tx: mid, ty: OFFICE.y1 - 0.55 };
      const outerP = side === 'x+' ? { tx: OFFICE.x1 + 0.5, ty: mid } : { tx: mid, ty: OFFICE.y1 + 0.5 };
      gates.push({ side, inner: W(innerP), outer: W(outerP) });
    }
  };
  (['y-', 'x-', 'x+', 'y+'] as Side[]).forEach(fence);
  add(signProp(inp.def?.icon || 'DIRECTION', color), 0.4, 0.4);

  // ── fountain
  add(fountainProp(), C, C);
  const fountainSpots: Pt[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26;
    fountainSpots.push(W({ tx: C + Math.cos(a) * 2.3, ty: C + Math.sin(a) * 2.3 }));
  }
  add(plaqueProp('CERVEAU', '#8b5cf6'), C + 3.35, C + 3.35);

  // ── café
  const counter = counterProp();
  addAt(counter.baked, 10.5, 0.8, 1.9, 0.55);
  const cw = { x: isoX(10.5 + x0, 0.8 + y0) + counter.machine[0], y: isoY(10.5 + x0, 0.8 + y0) + counter.machine[1] };
  const tables: Pt[] = [{ tx: 12.7, ty: 2.85 }, { tx: 11.0, ty: 3.75 }, { tx: 13.75, ty: 4.15 }];
  tables.forEach((p, i) => add(cafeTableProp(i === 0 ? '#ffffff' : '#ffe3ec'), p.tx, p.ty));
  add(parasolProp(PAL.parasol), tables[0].tx, tables[0].ty, 0.02);
  add(menuBoardProp(), 14.05, 1.55);
  add(plantProp(3), 10.15, 4.55);
  add(plantProp(0), 14.2, 0.75);
  const cafeSpots: Pt[] = [];
  const cafeFacing: Facing[] = [];
  const addCafe = (p: Pt, look: Pt) => {
    cafeSpots.push(W(p));
    cafeFacing.push(faceTowards(p, look));
  };
  addCafe({ tx: 11.0, ty: 1.85 }, { tx: 11.0, ty: 0.9 });
  addCafe({ tx: 11.75, ty: 1.85 }, { tx: 11.75, ty: 0.9 });
  for (const tp of tables) {
    for (const [dx, dy] of [[0, 0.55], [0.55, 0], [-0.55, 0], [0, -0.55]] as const) {
      const p = { tx: tp.tx + dx, ty: tp.ty + dy };
      if (p.tx > CAFE.x1 - 0.15 || p.ty > CAFE.y1 + 0.3) continue;
      addCafe(p, tp);
    }
  }

  // ── plaza decor
  const lampSpots: Pt[] = [{ tx: 9.1, ty: 1.2 }, { tx: 13.9, ty: 9.1 }, { tx: 9.1, ty: 13.9 }, { tx: 1.6, ty: 8.1 }];
  for (const p of lampSpots) {
    add(lampProp(), p.tx, p.ty);
    lights.push({ x: isoX(p.tx + x0, p.ty + y0), y: isoY(p.tx + x0, p.ty + y0, 29), r: 36, color: '#ffd27a', kind: 'lamp' });
  }
  addAt(benchProp('x'), 2.2, 12.3, 1.1, 0.4);
  addAt(flowerBedProp(1), 4.6, 13.7, 1, 0.5);
  addAt(flowerBedProp(2), 13.7, 5.4, 0.5, 1);
  add(treeProp('round', 0), 0.6, 14.3);
  add(bushProp(1), 14.3, 14.3);
  add(treeProp('pine', 0), 0.45, 5.9);
  add(bushProp(1), 6.0, 14.45);
  add(bushProp(2), 14.45, 6.0);
  add(bushProp(0), 14.5, 12.0);
  add(treeProp('round', 2), 2.4, 14.4);

  // ── league stage: the wall, the board and the totems change with the data, see stage.ts
  addAt(podiumProp(), PODIUM.x0, PODIUM.y0, PODIUM.x1 - PODIUM.x0, PODIUM.y1 - PODIUM.y0);
  add(duelTableProp(), DUEL.tx, DUEL.ty);

  // ── spots
  const officeFree: Pt[] = [];
  for (let y = OFFICE.y0 + 0.45; y < OFFICE.y1 - 0.3; y += 0.5) {
    for (let x = OFFICE.x0 + 0.45; x < OFFICE.x1 - 0.3; x += 0.5) {
      if (Math.hypot(x - table.tx, y - table.ty) < 0.95) continue;
      if (occ.free({ x0: x - 0.2, y0: y - 0.2, x1: x + 0.2, y1: y + 0.2 })) officeFree.push({ tx: x, ty: y });
    }
  }
  const meetingSpots = [[0.72, 0], [0, 0.72], [-0.72, 0], [0, -0.72], [0.55, 0.55], [-0.55, -0.55]].map(([dx, dy]) => W({ tx: table.tx + dx, ty: table.ty + dy }));
  const wanderSpots: Pt[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 3.4 + (i % 3) * 0.7;
    const p = { tx: C + Math.cos(a) * r, ty: C + Math.sin(a) * r };
    const out = (q: Rect) => p.tx > q.x0 - 0.4 && p.tx < q.x1 + 0.4 && p.ty > q.y0 - 0.4 && p.ty < q.y1 + 0.4;
    if (out(OFFICE) || out(CAFE) || STAGE_ZONES.some(out) || Math.hypot(p.tx - DUEL.tx, p.ty - DUEL.ty) < 1.1) continue;
    wanderSpots.push(W(p));
  }
  const edges: Partial<Record<Side, Pt>> = {
    'x-': W({ tx: 0, ty: C }), 'x+': W({ tx: N, ty: C }), 'y-': W({ tx: C, ty: 0 }), 'y+': W({ tx: C, ty: N }),
  };
  const officeCenter = W({ tx: (OFFICE.x0 + OFFICE.x1) / 2, ty: (OFFICE.y0 + OFFICE.y1) / 2 });
  lights.push({ x: isoX(officeCenter.tx, officeCenter.ty), y: isoY(officeCenter.tx, officeCenter.ty, 6), r: 70, color: '#ffcf8a', kind: 'room' });
  const cafeCenter = W({ tx: 12.2, ty: 2.7 });
  lights.push({ x: isoX(cafeCenter.tx, cafeCenter.ty), y: isoY(cafeCenter.tx, cafeCenter.ty, 6), r: 60, color: '#ffb36b', kind: 'room' });

  const T: P2 = [isoX(x0, y0), isoY(x0, y0)];
  const Rr: P2 = [isoX(x0 + N, y0), isoY(x0 + N, y0)];
  const B: P2 = [isoX(x0 + N, y0 + N), isoY(x0 + N, y0 + N)];
  const L: P2 = [isoX(x0, y0 + N), isoY(x0, y0 + N)];
  const fc = W({ tx: C, ty: C });
  const signBase = W({ tx: 0.4, ty: 0.4 });

  const plaza: IslandModel = {
    id: 'plaza',
    kind: 'plaza',
    deptId: 'direction',
    def: inp.def,
    name: inp.name,
    color,
    col: 0,
    row: 0,
    size: N,
    x0, y0,
    center: inp.center,
    room: { x0: OFFICE.x0 + x0, y0: OFFICE.y0 + y0, x1: OFFICE.x1 + x0, y1: OFFICE.y1 + y0 },
    gates,
    edges,
    seats,
    visitorSpots: officeFree.map(W),
    wanderSpots,
    meetingSpots,
    meetingCenter: W(table),
    labelAnchor: { x: isoX(signBase.tx, signBase.ty), y: isoY(signBase.tx, signBase.ty, 56) },
    ground: { img: t.c, x: Math.round(isoX(x0, y0) - t.ox), y: Math.round(isoY(x0, y0) - t.oy) },
    sprites,
    lights,
    topPoly: [T, Rr, B, L],
    hitPoly: [T, Rr, [Rr[0], Rr[1] + SIDE_DEPTH * 0.6], [B[0], B[1] + SIDE_DEPTH], [L[0], L[1] + SIDE_DEPTH * 0.6], L],
    depth: inp.center.tx + inp.center.ty,
    fountain: { center: fc, radius: FOUNTAIN_R, crystal: { x: isoX(fc.tx, fc.ty), y: isoY(fc.tx, fc.ty, 41) }, spots: fountainSpots, ring: RING_R },
    cafe: {
      spots: cafeSpots, facing: cafeFacing, machine: cw, area: { x0: CAFE.x0 + x0, y0: CAFE.y0 + y0, x1: CAFE.x1 + x0, y1: CAFE.y1 + y0 },
      anchor: { x: isoX(tables[0].tx + x0, tables[0].ty + y0), y: isoY(tables[0].tx + x0, tables[0].ty + y0, 50) },
    },
    stage: {
      podium: {
        centre: W({ tx: 12.4, ty: 12.2 }),
        tops: [{ place: 1, at: W({ tx: 12.4, ty: 12.2 }), z: 14 }, { place: 2, at: W({ tx: 11.65, ty: 12.2 }), z: 10 }, { place: 3, at: W({ tx: 13.15, ty: 12.2 }), z: 6 }],
        champion: W({ tx: 12.4, ty: 13.3 }),
      },
      wall: W({ tx: WALL.x0, ty: WALL.y0 }),
      board: W(BOARD),
      duel: { centre: W(DUEL), spots: [W(DUEL_SPOTS[0]), W(DUEL_SPOTS[1])], facing: [faceTowards(DUEL_SPOTS[0], DUEL), faceTowards(DUEL_SPOTS[1], DUEL)] },
      channelSlots: CHANNEL_SLOTS.map(W),
    },
  };
  return plaza;
}
