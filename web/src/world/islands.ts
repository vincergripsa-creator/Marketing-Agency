// Department island generator: size from the team, fenced office with one desk per agent,
// themed decor seeded by the department id, trees/bushes on the grass margin, sign with the name.
import type { AgentState, DeptDef } from '../../../shared/types';
import { isoX, isoY, type Facing, type Pt } from './iso';
import type { Gate, IslandModel, Light, Rect, Seat, Side, Sprite } from './model';
import { place } from './model';
import { mix, shade } from './palette';
import { hashStr, seeded, type Baked, type P2 } from './pixel';
import {
  boxesProp, bushProp, cabinetProp, chairProp, coolerProp, deskProp, easelProp, fenceProp, globeProp, lampProp,
  mailTrayProp, plantProp, printerProp, ringLightProp, rockProp, safeProp, shelfProp, signProp, sofaProp, treeProp,
  whiteboardProp,
} from './props';
import { SIDE_DEPTH, paintFloor, paintPath, paintRug, paintTerrain } from './terrain';

export const ROOM_MARGIN = 1;
const GATE_HALF = 0.6;

/** Tiny occupancy grid (0.25 tile cells) used to lay out desks and decor without overlaps. */
export class Occupancy {
  private cells: Uint8Array;
  private cols: number;
  private rows: number;
  constructor(private r: Rect, private step = 0.25) {
    this.cols = Math.ceil((r.x1 - r.x0) / step);
    this.rows = Math.ceil((r.y1 - r.y0) / step);
    this.cells = new Uint8Array(this.cols * this.rows);
  }
  private range(q: Rect): [number, number, number, number] {
    const s = this.step;
    return [
      Math.max(0, Math.floor((q.x0 - this.r.x0) / s + 1e-6)),
      Math.min(this.cols - 1, Math.ceil((q.x1 - this.r.x0) / s - 1e-6) - 1),
      Math.max(0, Math.floor((q.y0 - this.r.y0) / s + 1e-6)),
      Math.min(this.rows - 1, Math.ceil((q.y1 - this.r.y0) / s - 1e-6) - 1),
    ];
  }
  inside(q: Rect): boolean {
    return q.x0 >= this.r.x0 - 1e-6 && q.y0 >= this.r.y0 - 1e-6 && q.x1 <= this.r.x1 + 1e-6 && q.y1 <= this.r.y1 + 1e-6;
  }
  free(q: Rect): boolean {
    if (!this.inside(q)) return false;
    const [a, b, c, d] = this.range(q);
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) if (this.cells[y * this.cols + x]) return false;
    return true;
  }
  mark(q: Rect): void {
    const [a, b, c, d] = this.range(q);
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) this.cells[y * this.cols + x] = 1;
  }
}

export interface Slot { desk: Rect; seat: Pt; aisle: Pt; facing: 'ne' | 'nw' }

function R(x0: number, y0: number, w: number, h: number): Rect {
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

export function gateCorridor(side: Side, room: Rect, mid: number): Rect {
  const w = GATE_HALF + 0.15;
  if (side === 'y-') return { x0: mid - w, x1: mid + w, y0: room.y0, y1: room.y0 + 1.3 };
  if (side === 'y+') return { x0: mid - w, x1: mid + w, y0: room.y1 - 1.3, y1: room.y1 };
  if (side === 'x-') return { x0: room.x0, x1: room.x0 + 1.3, y0: mid - w, y1: mid + w };
  return { x0: room.x1 - 1.3, x1: room.x1, y0: mid - w, y1: mid + w };
}

/** Desk slots for a room (local coords): back row facing NE, left column facing NW, centre rows. */
export function deskSlots(room: Rect, occ: Occupancy, max: number, chiefWide = true): Slot[] {
  const out: Slot[] = [];
  const zone = (s: Slot): Rect => ({ x0: s.seat.tx - 0.35, y0: s.seat.ty - 0.35, x1: s.seat.tx + 0.35, y1: s.seat.ty + 0.35 });
  const tryPlace = (s: Slot): boolean => {
    const pad = { x0: s.desk.x0 - 0.05, y0: s.desk.y0 - 0.05, x1: s.desk.x1 + 0.05, y1: s.desk.y1 + 0.05 };
    if (!occ.free(pad) || !occ.free(zone(s))) return false;
    occ.mark(pad);
    occ.mark(zone(s));
    out.push(s);
    return true;
  };
  const wide = (i: number) => (chiefWide && i === 0 ? 1.3 : 1.1);
  // back row
  for (let a = room.x0 + 0.35; a + wide(out.length) <= room.x1 - 0.3 && out.length < max; ) {
    const L = wide(out.length);
    const s: Slot = { desk: R(a, room.y0 + 0.2, L, 0.6), seat: { tx: a + L / 2, ty: room.y0 + 1.25 }, aisle: { tx: a + L / 2, ty: room.y0 + 1.85 }, facing: 'ne' };
    a += tryPlace(s) ? L + 0.4 : 0.25;
  }
  // left column
  for (let b = room.y0 + 1.6; b + 1.1 <= room.y1 - 0.45 && out.length < max; ) {
    const s: Slot = { desk: R(room.x0 + 0.2, b, 0.6, 1.1), seat: { tx: room.x0 + 1.25, ty: b + 0.55 }, aisle: { tx: room.x0 + 1.85, ty: b + 0.55 }, facing: 'nw' };
    b += tryPlace(s) ? 1.5 : 0.25;
  }
  // centre rows
  for (let y = room.y0 + 2.55; y + 1.55 <= room.y1 - 0.35 && out.length < max; y += 2.25) {
    for (let a = room.x0 + 1.9; a + 1.1 <= room.x1 - 0.3 && out.length < max; ) {
      const s: Slot = { desk: R(a, y, 1.1, 0.6), seat: { tx: a + 0.55, ty: y + 1.05 }, aisle: { tx: a + 0.55, ty: y + 1.6 }, facing: 'ne' };
      a += tryPlace(s) ? 1.5 : 0.25;
    }
  }
  return out;
}

function roomOf(size: number): Rect {
  return { x0: ROOM_MARGIN, y0: ROOM_MARGIN, x1: size - ROOM_MARGIN, y1: size - ROOM_MARGIN };
}

function gateSides(bridgeSides: Side[]): Side[] {
  const s = new Set<Side>(bridgeSides);
  s.add('y+');
  return [...s];
}

/** Smallest island (8..16 tiles) whose office fits one desk per agent. */
export function islandSizeFor(agentCount: number, bridgeSides: Side[]): number {
  const minSize = agentCount <= 3 ? 8 : agentCount <= 5 ? 9 : 10;
  for (let n = minSize; n <= 16; n++) {
    const room = roomOf(n);
    const occ = new Occupancy(room);
    for (const side of gateSides(bridgeSides)) occ.mark(gateCorridor(side, room, n / 2));
    reserveTallZones(occ, room);
    if (deskSlots(room, occ, agentCount + 1).length >= agentCount + (agentCount > 6 ? 0 : 1)) return n;
  }
  return 16;
}

function reserveTallZones(occ: Occupancy, room: Rect): Rect[] {
  const zones = [R(room.x1 - 1.25, room.y0 + 0.08, 1.1, 0.45), R(room.x0 + 0.08, room.y1 - 1.25, 0.45, 1.1)];
  const kept: Rect[] = [];
  for (const z of zones) {
    if (occ.free(z)) {
      occ.mark(z);
      kept.push(z);
    }
  }
  return kept;
}

type DecorKind = 'shelf' | 'whiteboard' | 'mail' | 'globe' | 'plant' | 'cooler' | 'safe' | 'cabinet' | 'boxes' | 'easel' | 'ring' | 'sofa' | 'printer';

const THEMES: Record<string, DecorKind[]> = {
  recherche: ['shelf', 'whiteboard', 'globe', 'plant', 'cabinet'],
  studio: ['shelf', 'shelf', 'printer', 'plant', 'boxes'],
  creation: ['easel', 'shelf', 'easel', 'plant', 'boxes'],
  growth: ['whiteboard', 'ring', 'ring', 'sofa', 'plant'],
  boutique: ['shelf', 'boxes', 'boxes', 'plant', 'printer'],
  support: ['mail', 'shelf', 'cooler', 'plant', 'boxes'],
  analyse: ['whiteboard', 'whiteboard', 'cabinet', 'plant', 'printer'],
  finance: ['shelf', 'safe', 'cabinet', 'plant', 'cooler'],
  rh: ['shelf', 'sofa', 'plant', 'cooler', 'plant'],
  partenariats: ['whiteboard', 'sofa', 'globe', 'plant', 'cooler'],
};
const TALL: DecorKind[] = ['shelf', 'whiteboard', 'mail'];

function decorSize(k: DecorKind): [number, number] {
  switch (k) {
    case 'safe': return [0.5, 0.5];
    case 'cabinet': return [0.36, 0.42];
    case 'boxes': return [0.75, 0.6];
    case 'sofa': return [0.5, 1.2];
    case 'printer': return [0.5, 0.42];
    case 'easel': case 'ring': return [0.5, 0.5];
    default: return [0.36, 0.36];
  }
}

export interface IslandInput {
  id: string;
  def: DeptDef | null;
  name: string;
  sign: string;
  color: string;
  col: number;
  row: number;
  center: Pt;
  size: number;
  bridgeSides: Side[];
  agents: AgentState[];
}

export function buildDeptIsland(inp: IslandInput, seatOf: Map<string, { island: IslandModel; seat: Seat }>): IslandModel {
  const N = inp.size;
  const x0 = inp.center.tx - N / 2;
  const y0 = inp.center.ty - N / 2;
  const seed = hashStr(inp.id);
  const rnd = seeded(seed);
  const color = inp.color;
  const room = roomOf(N);
  const mid = N / 2;
  const W = (p: Pt): Pt => ({ tx: p.tx + x0, ty: p.ty + y0 });
  const sprites: Sprite[] = [];
  const lights: Light[] = [];
  const add = (b: Baked, lx: number, ly: number, depthBias = 0, z = 0) => {
    sprites.push(place(b, lx + x0, ly + y0, lx + x0 + (ly + y0) + depthBias, z));
  };
  /** Adds a prop whose footprint is [lx, lx+w]×[ly, ly+d] (depth = footprint centre). */
  const addAt = (b: Baked, lx: number, ly: number, w: number, d: number) => {
    sprites.push(place(b, lx + x0, ly + y0, lx + w / 2 + x0 + ly + d / 2 + y0));
  };

  // ── terrain
  const t = paintTerrain(N, seed);
  const floorA = mix(color, '#ffffff', 0.56);
  const floorB = mix(color, '#ffffff', 0.46);
  paintFloor(t, room.x0, room.y0, room.x1, room.y1, floorA, floorB, 1);

  const sides = gateSides(inp.bridgeSides);
  const occ = new Occupancy(room);
  for (const s of sides) occ.mark(gateCorridor(s, room, mid));
  const tallZones = reserveTallZones(occ, room);

  // ── desks
  const slots = deskSlots(room, occ, Math.max(inp.agents.length, 2));
  const deskTop = [
    '#f2efe9', '#e9d3b1', '#dcb68a', mix(color, '#ffffff', 0.8),
  ][seed % 4];
  const chairColor = mix(shade(color, -0.35), '#4b4f63', 0.5);
  const seats: Seat[] = [];
  slots.forEach((s, i) => {
    const chief = i === 0;
    const desk = deskProp(s.facing, deskTop, (seed >> (i % 8)) + i, chief && s.desk.x1 - s.desk.x0 > 1.2);
    const dx = s.desk.x0;
    const dy = s.desk.y0;
    const spr = place(desk.baked, dx + x0, dy + y0, (s.desk.x0 + s.desk.x1) / 2 + x0 + (s.desk.y0 + s.desk.y1) / 2 + y0);
    sprites.push(spr);
    const wx = isoX(dx + x0, dy + y0);
    const wy = isoY(dx + x0, dy + y0);
    const screen = desk.screen.map(([px, py]) => [wx + px, wy + py] as P2);
    const seat: Seat = { pos: W(s.seat), facing: s.facing, aisle: W(s.aisle), screen, deskDepth: spr.depth, chief };
    seats.push(seat);
    add(chairProp(s.facing, chairColor), s.seat.tx, s.seat.ty, 0.05);
  });

  // ── decor
  const theme = THEMES[inp.id] ?? ['plant', 'cabinet', 'cooler', 'plant'];
  const tall = theme.filter((k) => TALL.includes(k));
  const floorItems = theme.filter((k) => !TALL.includes(k));
  tallZones.forEach((z, i) => {
    const kind = tall[i] ?? (i === 0 ? 'shelf' : null);
    if (!kind) return;
    const alongX = z.x1 - z.x0 > z.y1 - z.y0;
    const axis = alongX ? 'x' : 'y';
    const b = kind === 'whiteboard' ? whiteboardProp(axis, color) : kind === 'mail' ? mailTrayProp() : shelfProp(axis, seed + i);
    const lx = alongX ? z.x0 + 0.1 : z.x0 + 0.05;
    const ly = alongX ? z.y0 + 0.05 : z.y0 + 0.1;
    if (kind === 'mail' && !alongX) {
      addAt(shelfProp('y', seed + 3), lx, ly, 0.26, 0.9);
      return;
    }
    addAt(b, lx, ly, alongX ? 0.9 : 0.26, alongX ? 0.26 : 0.9);
  });
  const candidates: Pt[] = [];
  for (let y = room.y0 + 0.15; y < room.y1 - 0.2; y += 0.25) candidates.push({ tx: room.x1 - 0.2, ty: y });
  for (let x = room.x1 - 0.2; x > room.x0 + 0.2; x -= 0.25) candidates.push({ tx: x, ty: room.y1 - 0.2 });
  for (let y = room.y0 + 0.2; y < room.y1; y += 0.5) for (let x = room.x0 + 0.2; x < room.x1; x += 0.5) candidates.push({ tx: x, ty: y });
  for (const kind of floorItems) {
    const [w, d] = decorSize(kind);
    for (const c of candidates) {
      // candidates are the "far" corner of the item (it grows towards the room centre)
      const r: Rect = { x0: c.tx - w, y0: c.ty - d, x1: c.tx, y1: c.ty };
      const padR: Rect = { x0: r.x0 - 0.12, y0: r.y0 - 0.12, x1: r.x1 + 0.12, y1: r.y1 + 0.12 };
      if (!occ.free(padR)) continue;
      occ.mark(padR);
      const v = Math.floor(rnd() * 4);
      let b: Baked;
      switch (kind) {
        case 'globe': b = globeProp(); break;
        case 'plant': b = plantProp(v); break;
        case 'cooler': b = coolerProp(); break;
        case 'safe': b = safeProp(); break;
        case 'cabinet': b = cabinetProp(); break;
        case 'boxes': b = boxesProp(v); break;
        case 'easel': b = easelProp(v); break;
        case 'ring': b = ringLightProp(); break;
        case 'sofa': b = sofaProp('y', shade(color, -0.1)); break;
        default: b = printerProp();
      }
      const centred = kind === 'globe' || kind === 'plant' || kind === 'cooler' || kind === 'easel' || kind === 'ring';
      if (centred) add(b, r.x0 + w / 2, r.y0 + d / 2);
      else addAt(b, r.x0, r.y0, w, d);
      break;
    }
  }

  // ── free floor: meeting point, visitors, wandering
  const freePts: Pt[] = [];
  for (let y = room.y0 + 0.45; y < room.y1 - 0.3; y += 0.5) {
    for (let x = room.x0 + 0.45; x < room.x1 - 0.3; x += 0.5) {
      if (occ.free({ x0: x - 0.2, y0: y - 0.2, x1: x + 0.2, y1: y + 0.2 })) freePts.push({ tx: x, ty: y });
    }
  }
  const clearance = (p: Pt) => freePts.filter((q) => Math.hypot(q.tx - p.tx, q.ty - p.ty) < 1.05).length;
  let meetingCenter: Pt = { tx: (room.x0 + room.x1) / 2 + 0.6, ty: (room.y0 + room.y1) / 2 + 0.6 };
  let best = -1;
  for (const p of freePts) {
    const score = clearance(p) - Math.hypot(p.tx - (room.x1 - 1.6), p.ty - (room.y1 - 1.6)) * 0.4;
    if (score > best) {
      best = score;
      meetingCenter = p;
    }
  }
  if (freePts.length > 6) paintRug(t, meetingCenter.tx - 0.75, meetingCenter.ty - 0.75, 1.5, 1.5, mix(color, '#ffffff', 0.25));
  const meetingSpots: Pt[] = [];
  for (const [dx, dy] of [[0.62, 0], [0, 0.62], [-0.62, 0], [0, -0.62], [0.5, 0.5], [-0.5, -0.5]] as const) {
    meetingSpots.push(W({ tx: meetingCenter.tx + dx, ty: meetingCenter.ty + dy }));
  }
  const firstSeat = slots[0]?.seat ?? meetingCenter;
  const visitorSpots = freePts
    .slice()
    .sort((a, b) => Math.hypot(a.tx - firstSeat.tx, a.ty - firstSeat.ty) - Math.hypot(b.tx - firstSeat.tx, b.ty - firstSeat.ty))
    .filter((p) => Math.hypot(p.tx - firstSeat.tx, p.ty - firstSeat.ty) > 0.55)
    .slice(0, 6)
    .map(W);
  const wanderSpots = freePts.filter((_, i) => i % 2 === 0).map(W);
  wanderSpots.push(W({ tx: mid - 1.6, ty: N - 0.5 }), W({ tx: mid + 1.7, ty: N - 0.55 }));

  // ── fences (0.5 tile pieces, gates left open)
  const gates: Gate[] = [];
  const fenceColor = shade(color, -0.05);
  const pieces = (from: number, to: number, cb: (a: number, len: number) => void) => {
    for (let a = from; a < to - 1e-3; a += 0.5) cb(a, Math.min(0.5, to - a));
  };
  const wall = (side: Side) => {
    const hasGate = sides.includes(side);
    const along = side === 'y-' || side === 'y+' ? 'x' : 'y';
    const fixed = side === 'y-' ? room.y0 : side === 'y+' ? room.y1 : side === 'x-' ? room.x0 : room.x1;
    const lo = along === 'x' ? room.x0 : room.y0;
    const hi = along === 'x' ? room.x1 : room.y1;
    const segs: [number, number][] = hasGate ? [[lo, mid - GATE_HALF], [mid + GATE_HALF, hi]] : [[lo, hi]];
    for (const [s0, s1] of segs) {
      pieces(s0, s1, (a, len) => {
        const b = fenceProp(along, fenceColor, Math.round(len * 20) / 20);
        if (along === 'x') sprites.push(place(b, a + x0, fixed + y0, a + len / 2 + x0 + fixed + y0));
        else sprites.push(place(b, fixed + x0, a + y0, fixed + x0 + a + len / 2 + y0));
      });
    }
    if (hasGate) {
      const inner = side === 'y-' ? { tx: mid, ty: room.y0 + 0.55 } : side === 'y+' ? { tx: mid, ty: room.y1 - 0.55 } : side === 'x-' ? { tx: room.x0 + 0.55, ty: mid } : { tx: room.x1 - 0.55, ty: mid };
      const outer = side === 'y-' ? { tx: mid, ty: room.y0 - 0.5 } : side === 'y+' ? { tx: mid, ty: room.y1 + 0.5 } : side === 'x-' ? { tx: room.x0 - 0.5, ty: mid } : { tx: room.x1 + 0.5, ty: mid };
      gates.push({ side, inner: W(inner), outer: W(outer) });
    }
  };
  (['y-', 'x-', 'x+', 'y+'] as Side[]).forEach(wall);

  // ── edges + paths to bridges
  const edges: Partial<Record<Side, Pt>> = {
    'x-': W({ tx: 0, ty: mid }), 'x+': W({ tx: N, ty: mid }), 'y-': W({ tx: mid, ty: 0 }), 'y+': W({ tx: mid, ty: N }),
  };
  for (const s of sides) {
    const outer = s === 'y-' ? [mid, room.y0 - 0.25] : s === 'y+' ? [mid, room.y1 + 0.25] : s === 'x-' ? [room.x0 - 0.25, mid] : [room.x1 + 0.25, mid];
    const edge = s === 'y-' ? [mid, 0.1] : s === 'y+' ? [mid, N - 0.1] : s === 'x-' ? [0.1, mid] : [N - 0.1, mid];
    if (inp.bridgeSides.includes(s) || s === 'y+') paintPath(t, outer[0], outer[1], edge[0], edge[1], seed + s.length);
  }

  // ── margin decor: sign, trees, bushes, lamp, rocks
  const signB = signProp(inp.sign, color);
  add(signB, 0.5, 0.5);
  const nearGate = (side: Side, a: number) => sides.includes(side) && Math.abs(a - mid) < 1.3;
  const treeKinds: ('round' | 'pine' | 'blossom')[] = ['round', 'pine', 'round', 'blossom'];
  const tk = () => treeKinds[Math.floor(rnd() * (inp.id === 'rh' || inp.id === 'creation' ? 4 : 3))];
  add(treeProp(tk(), Math.floor(rnd() * 3)), N - 0.5, 0.5);
  add(treeProp(tk(), Math.floor(rnd() * 3)), 0.5, N - 0.5);
  add(bushProp(Math.floor(rnd() * 3)), N - 0.5, N - 0.5);
  for (const a of [2.0, N - 2.2]) {
    if (!nearGate('y-', a) && rnd() < 0.8) add(rnd() < 0.5 ? treeProp('pine', 0) : bushProp(Math.floor(rnd() * 3)), a, 0.42);
    if (!nearGate('x-', a) && rnd() < 0.8) add(rnd() < 0.5 ? treeProp(tk(), 1) : bushProp(1), 0.42, a);
    if (!nearGate('x+', a) && rnd() < 0.5) add(rnd() < 0.5 ? rockProp(Math.floor(rnd() * 2)) : bushProp(2), N - 0.42, a + 0.3);
  }
  if (rnd() < 0.7) add(rockProp(1), 1.4, N - 0.4);
  const lampB = lampProp();
  add(lampB, mid + 1.15, N - 0.45);
  const lw = { x: Math.round(isoX(mid + 1.15 + x0, N - 0.45 + y0)), y: Math.round(isoY(mid + 1.15 + x0, N - 0.45 + y0, 29)) };
  lights.push({ x: lw.x, y: lw.y, r: 34, color: '#ffd27a', kind: 'lamp' });
  const rc = W({ tx: (room.x0 + room.x1) / 2, ty: (room.y0 + room.y1) / 2 });
  lights.push({ x: isoX(rc.tx, rc.ty), y: isoY(rc.tx, rc.ty, 6), r: N * 15, color: '#ffcf8a', kind: 'room' });

  // ── geometry
  const T: P2 = [isoX(x0, y0), isoY(x0, y0)];
  const Rr: P2 = [isoX(x0 + N, y0), isoY(x0 + N, y0)];
  const B: P2 = [isoX(x0 + N, y0 + N), isoY(x0 + N, y0 + N)];
  const L: P2 = [isoX(x0, y0 + N), isoY(x0, y0 + N)];
  const signBase = W({ tx: 0.5, ty: 0.5 });

  const island: IslandModel = {
    id: inp.id,
    kind: 'dept',
    deptId: (inp.def?.id ?? inp.id) as IslandModel['deptId'],
    def: inp.def,
    name: inp.name,
    color,
    col: inp.col,
    row: inp.row,
    size: N,
    x0, y0,
    center: inp.center,
    room: { x0: room.x0 + x0, y0: room.y0 + y0, x1: room.x1 + x0, y1: room.y1 + y0 },
    gates,
    edges,
    seats,
    visitorSpots: visitorSpots.length ? visitorSpots : meetingSpots,
    wanderSpots,
    meetingSpots,
    meetingCenter: W(meetingCenter),
    labelAnchor: { x: isoX(signBase.tx, signBase.ty), y: isoY(signBase.tx, signBase.ty, 56) },
    ground: { img: t.c, x: Math.round(isoX(x0, y0) - t.ox), y: Math.round(isoY(x0, y0) - t.oy) },
    sprites,
    lights,
    topPoly: [T, Rr, B, L],
    hitPoly: [T, Rr, [Rr[0], Rr[1] + SIDE_DEPTH * 0.6], [B[0], B[1] + SIDE_DEPTH], [L[0], L[1] + SIDE_DEPTH * 0.6], L],
    depth: inp.center.tx + inp.center.ty,
  };
  inp.agents.forEach((a, i) => {
    const seat = seats[i];
    if (seat) seatOf.set(a.id, { island, seat });
  });
  return island;
}

/** Facing that looks from `from` towards `to`. */
export function faceTowards(from: Pt, to: Pt): Facing {
  const dtx = to.tx - from.tx;
  const dty = to.ty - from.ty;
  const sx = dtx - dty;
  const sy = dtx + dty;
  return sy >= 0 ? (sx >= 0 ? 'se' : 'sw') : sx >= 0 ? 'ne' : 'nw';
}
