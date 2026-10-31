// L'Accueil: the island of arrivals and departures, south of the plaza. No department, no desks:
// a path from the bridge to the dock, where people walk in and walk out.
import { isoX, isoY, type Pt } from './iso';
import type { IslandModel, Rect, Side, Sprite } from './model';
import { place } from './model';
import { P, hashStr, type Baked, type P2 } from './pixel';
import { bushProp, dockProp, flowerBedProp, lampProp, rockProp, signProp, treeProp } from './props';
import { SIDE_DEPTH, paintPath, paintRug, paintTerrain } from './terrain';

export const PIER_SIZE = 9;
const MID = PIER_SIZE / 2;
/** Local tiles. The planks stop at the island's edge, and the sky starts there. */
export const DOCK: Rect = { x0: 3.9, y0: 6.9, x1: 5.1, y1: 9.0 };
const DOCK_SPOT: Pt = { tx: 4.5, ty: 8.3 };

export interface PierInput {
  center: Pt;
  id?: string;
  name?: string;
  color?: string;
  col?: number;
  row?: number;
  size?: number;
  bridgeSides?: Side[];
}

export function buildPier(inp: PierInput): IslandModel {
  const N = PIER_SIZE;
  const color = inp.color ?? '#c08552';
  const x0 = inp.center.tx - N / 2;
  const y0 = inp.center.ty - N / 2;
  const seed = hashStr('quai');
  const W = (p: Pt): Pt => ({ tx: p.tx + x0, ty: p.ty + y0 });
  const sprites: Sprite[] = [];
  const add = (b: Baked, lx: number, ly: number, bias = 0) => sprites.push(place(b, lx + x0, ly + y0, lx + x0 + ly + y0 + bias));
  const addAt = (b: Baked, lx: number, ly: number, w: number, d: number) => sprites.push(place(b, lx + x0, ly + y0, lx + w / 2 + x0 + ly + d / 2 + y0));

  // ── terrain: the mat at the bridge end, the path, the planks
  const t = paintTerrain(N, seed);
  paintRug(t, MID - 0.75, 0.25, 1.5, 0.9, color);
  paintPath(t, MID, 1.25, MID, DOCK.y0, seed);
  const dock = dockProp();
  const [dx, dy] = P(t.ox, t.oy, DOCK.x0, DOCK.y0);
  t.g.drawImage(dock.c, dx - dock.ox, dy - dock.oy);

  // ── decor
  add(signProp('ACCUEIL', color), 2.6, 1.5);
  add(lampProp(), MID + 1.0, 3.4);
  addAt(flowerBedProp(1), 1.5, 3.6, 1, 0.5);
  addAt(flowerBedProp(3), 6.3, 2.2, 1, 0.5);
  add(treeProp('blossom', 0), 1.0, 1.0);
  add(treeProp('round', 1), 7.9, 1.1);
  add(treeProp('pine', 0), 7.9, 7.6);
  add(treeProp('round', 0), 1.1, 7.8);
  add(bushProp(1), 2.9, 7.6);
  add(bushProp(2), 6.3, 6.9);
  add(bushProp(0), 7.6, 4.6);
  add(rockProp(1), 1.1, 5.7);
  const lx = isoX(MID + 1.0 + x0, 3.4 + y0);
  const ly = isoY(MID + 1.0 + x0, 3.4 + y0, 29);

  // ── geometry
  const T: P2 = [isoX(x0, y0), isoY(x0, y0)];
  const Rr: P2 = [isoX(x0 + N, y0), isoY(x0 + N, y0)];
  const B: P2 = [isoX(x0 + N, y0 + N), isoY(x0 + N, y0 + N)];
  const L: P2 = [isoX(x0, y0 + N), isoY(x0, y0 + N)];
  const signBase = W({ tx: 2.6, ty: 1.5 });
  const meetingCenter: Pt = { tx: MID, ty: 4.6 };
  const around = [[0.62, 0], [0, 0.62], [-0.62, 0], [0, -0.62], [0.5, 0.5], [-0.5, -0.5]].map(([a, b]) => W({ tx: meetingCenter.tx + a, ty: meetingCenter.ty + b }));

  return {
    id: 'quai',
    kind: 'pier',
    deptId: null,
    def: null,
    name: inp.name ?? 'Accueil',
    color,
    col: inp.col ?? 0,
    row: inp.row ?? 1,
    size: N,
    x0, y0,
    center: inp.center,
    room: null,
    gates: [],
    edges: { 'y-': W({ tx: MID, ty: 0 }) },
    seats: [],
    visitorSpots: around,
    wanderSpots: around,
    meetingSpots: around,
    meetingCenter: W(meetingCenter),
    labelAnchor: { x: isoX(signBase.tx, signBase.ty), y: isoY(signBase.tx, signBase.ty, 56) },
    ground: { img: t.c, x: Math.round(isoX(x0, y0) - t.ox), y: Math.round(isoY(x0, y0) - t.oy) },
    sprites,
    lights: [{ x: lx, y: ly, r: 34, color: '#ffd27a', kind: 'lamp' }],
    topPoly: [T, Rr, B, L],
    hitPoly: [T, Rr, [Rr[0], Rr[1] + SIDE_DEPTH * 0.6], [B[0], B[1] + SIDE_DEPTH], [L[0], L[1] + SIDE_DEPTH * 0.6], L],
    depth: inp.center.tx + inp.center.ty,
    pier: { dock: W(DOCK_SPOT) },
  };
}
