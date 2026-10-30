// World layout: effective island grid (collision + connectivity fixes), island placement,
// bridges, one composited ground canvas and the sorted list of static props.
import type { AgentState, CompanySnapshot, DeptDef } from '../../../shared/types';
import { isoX, isoY, type Pt } from './iso';
import { buildDeptIsland, islandSizeFor } from './islands';
import { OPPOSITE, type Bridge, type IslandModel, type Seat, type Side, type Sprite, type WorldLayout } from './model';
import { deptColor } from './palette';
import { makeCanvas } from './pixel';
import { PLAZA_SIZE, buildPlaza } from './plaza';
import { paintBridge } from './bridges';
import { clearBakeCache } from './pixel';

export const GRID_LIMIT = 3;
const GAP = 2.4;
const MAX_BRIDGE_GAP = 4.2;

const key = (c: number, r: number) => `${c},${r}`;
const NEIGHBORS: [number, number, Side][] = [[1, 0, 'x+'], [-1, 0, 'x-'], [0, 1, 'y+'], [0, -1, 'y-']];

function clampInt(v: unknown, lim: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.max(-lim, Math.min(lim, n));
}

/**
 * Effective grid positions: direction always lives on the central plaza (0,0); collisions move an
 * island to the nearest free cell; islands that cannot be reached by 4-adjacency are moved next to
 * the connected group. Used by both the world and the minimap so they always match.
 */
export function effectiveGrid(departments: readonly DeptDef[]): Map<string, { col: number; row: number }> {
  const out = new Map<string, { col: number; row: number }>();
  const occ = new Map<string, string>();
  occ.set(key(0, 0), 'plaza');
  out.set('direction', { col: 0, row: 0 });
  const list = departments.filter((d) => d && d.id && d.id !== 'direction');
  const lim = GRID_LIMIT + 1;
  for (const d of list) {
    if (out.has(d.id)) continue;
    let c = clampInt(d.grid?.col, lim);
    let r = clampInt(d.grid?.row, lim);
    if (occ.has(key(c, r))) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dr = -lim; dr <= lim; dr++) {
        for (let dc = -lim; dc <= lim; dc++) {
          if (occ.has(key(dc, dr))) continue;
          const dd = Math.hypot(dc - c, dr - r) + Math.hypot(dc, dr) * 0.01;
          if (dd < bestD) {
            bestD = dd;
            best = [dc, dr];
          }
        }
      }
      if (best) [c, r] = best;
    }
    occ.set(key(c, r), d.id);
    out.set(d.id, { col: c, row: r });
  }
  // connectivity
  const connected = (): Set<string> => {
    const seen = new Set<string>([key(0, 0)]);
    const q: [number, number][] = [[0, 0]];
    while (q.length) {
      const [c, r] = q.shift()!;
      for (const [dc, dr] of NEIGHBORS) {
        const k = key(c + dc, r + dr);
        if (occ.has(k) && !seen.has(k)) {
          seen.add(k);
          q.push([c + dc, r + dr]);
        }
      }
    }
    return seen;
  };
  for (let guard = 0; guard < 40; guard++) {
    const seen = connected();
    const loose = list
      .map((d) => ({ id: d.id, ...out.get(d.id)! }))
      .filter((p) => !seen.has(key(p.col, p.row)))
      .sort((a, b) => Math.hypot(a.col, a.row) - Math.hypot(b.col, b.row));
    if (!loose.length) break;
    const p = loose[0];
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const k of seen) {
      const [c, r] = k.split(',').map(Number);
      for (const [dc, dr] of NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (occ.has(key(nc, nr))) continue;
        const dd = Math.hypot(nc - p.col, nr - p.row);
        if (dd < bestD) {
          bestD = dd;
          best = [nc, nr];
        }
      }
    }
    if (!best) break;
    occ.delete(key(p.col, p.row));
    occ.set(key(best[0], best[1]), p.id);
    out.set(p.id, { col: best[0], row: best[1] });
  }
  return out;
}

export function homeDept(a: AgentState, depts: Set<string>): string {
  return depts.has(a.dept) && a.dept !== 'direction' ? a.dept : 'direction';
}

function teamOf(snapshot: CompanySnapshot | null, deptId: string, def: DeptDef | null, depts: Set<string>): AgentState[] {
  const agents = (snapshot?.company.agents ?? []).filter((a) => homeDept(a, depts) === deptId);
  const chiefId = def?.chiefId;
  return agents
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const cx = x.a.isChief || x.a.id === chiefId ? 0 : 1;
      const cy = y.a.isChief || y.a.id === chiefId ? 0 : 1;
      return cx - cy || x.i - y.i;
    })
    .map((x) => x.a);
}

export function layoutKeyOf(snapshot: CompanySnapshot | null): string {
  const depts = snapshot?.company.departments ?? [];
  const agents = snapshot?.company.agents ?? [];
  return JSON.stringify([
    depts.map((d) => [d.id, d.name, d.color, d.icon, d.grid?.col, d.grid?.row, d.chiefId]),
    agents.map((a) => [a.id, a.dept, a.isChief ? 1 : 0]),
  ]);
}

export function buildLayout(snapshot: CompanySnapshot | null): WorldLayout {
  clearBakeCache();
  const departments = (snapshot?.company.departments ?? []).filter((d) => d && typeof d.id === 'string');
  const deptSet = new Set(departments.map((d) => d.id as string));
  const grid = effectiveGrid(departments);
  const defOf = new Map(departments.map((d) => [d.id as string, d]));
  const cells = new Map<string, string>();
  for (const [id, g] of grid) cells.set(key(g.col, g.row), id === 'direction' ? 'plaza' : id);

  const sidesOf = (c: number, r: number): Side[] => NEIGHBORS.filter(([dc, dr]) => cells.has(key(c + dc, r + dr))).map(([, , s]) => s);

  // sizes
  const sizes = new Map<string, number>();
  const teams = new Map<string, AgentState[]>();
  for (const [id, g] of grid) {
    const def = defOf.get(id) ?? null;
    const team = teamOf(snapshot, id, def, deptSet);
    teams.set(id, team);
    sizes.set(id === 'direction' ? 'plaza' : id, id === 'direction' ? PLAZA_SIZE : islandSizeFor(team.length, sidesOf(g.col, g.row)));
  }
  // column / row centres (uniform per column so bridges stay straight)
  const colsW = new Map<number, number>();
  const rowsH = new Map<number, number>();
  for (const [k, id] of cells) {
    const [c, r] = k.split(',').map(Number);
    const s = sizes.get(id) ?? 8;
    colsW.set(c, Math.max(colsW.get(c) ?? 0, s));
    rowsH.set(r, Math.max(rowsH.get(r) ?? 0, s));
  }
  const centres = (m: Map<number, number>): Map<number, number> => {
    const keys = [...m.keys()].sort((a, b) => a - b);
    const lo = keys[0] ?? 0;
    const hi = keys[keys.length - 1] ?? 0;
    const pos = new Map<number, number>();
    let acc = 0;
    for (let i = lo; i <= hi; i++) {
      const w = m.get(i) ?? 8;
      if (i > lo) acc += (m.get(i - 1) ?? 8) / 2 + GAP + w / 2;
      pos.set(i, acc);
    }
    const zero = pos.get(0) ?? 0;
    for (const [i, v] of pos) pos.set(i, v - zero);
    return pos;
  };
  const colX = centres(colsW);
  const rowY = centres(rowsH);

  // islands
  const seatOf = new Map<string, { island: IslandModel; seat: Seat }>();
  const islands: IslandModel[] = [];
  const byId = new Map<string, IslandModel>();
  const deptIsland = new Map<string, IslandModel>();
  const dirDef = defOf.get('direction') ?? null;
  const plaza = buildPlaza({
    def: dirDef,
    name: dirDef?.name ?? 'Direction',
    color: deptColor('direction', dirDef?.color),
    center: { tx: 0, ty: 0 },
    bridgeSides: sidesOf(0, 0),
    agents: teams.get('direction') ?? [],
  }, seatOf);
  islands.push(plaza);
  byId.set('plaza', plaza);
  deptIsland.set('direction', plaza);
  for (const d of departments) {
    if (d.id === 'direction') continue;
    const g = grid.get(d.id);
    if (!g) continue;
    const center: Pt = { tx: colX.get(g.col) ?? 0, ty: rowY.get(g.row) ?? 0 };
    const isl = buildDeptIsland({
      id: d.id,
      def: d,
      name: d.name || d.id,
      sign: d.icon || d.name || d.id,
      color: deptColor(d.id, d.color),
      col: g.col,
      row: g.row,
      center,
      size: sizes.get(d.id) ?? 8,
      bridgeSides: sidesOf(g.col, g.row),
      agents: teams.get(d.id) ?? [],
    }, seatOf);
    islands.push(isl);
    byId.set(isl.id, isl);
    deptIsland.set(d.id, isl);
  }

  // bridges: short ones always, long ones only when needed for connectivity
  type Cand = { a: IslandModel; b: IslandModel; sa: Side; sb: Side; gap: number };
  const cands: Cand[] = [];
  for (const isl of islands) {
    for (const [dc, dr, side] of NEIGHBORS) {
      if (side !== 'x+' && side !== 'y+') continue;
      const otherId = cells.get(key(isl.col + dc, isl.row + dr));
      const other = otherId ? byId.get(otherId) : undefined;
      if (!other) continue;
      const pa = isl.edges[side]!;
      const pb = other.edges[OPPOSITE[side]]!;
      cands.push({ a: isl, b: other, sa: side, sb: OPPOSITE[side], gap: Math.hypot(pa.tx - pb.tx, pa.ty - pb.ty) });
    }
  }
  cands.sort((x, y) => x.gap - y.gap);
  const parent = new Map<string, string>(islands.map((i) => [i.id, i.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const bridges: Bridge[] = [];
  for (const c of cands) {
    const ra = find(c.a.id);
    const rb = find(c.b.id);
    if (c.gap <= MAX_BRIDGE_GAP || ra !== rb) {
      parent.set(ra, rb);
      bridges.push({ a: c.a.id, b: c.b.id, sideA: c.sa, sideB: c.sb, pa: c.a.edges[c.sa]!, pb: c.b.edges[c.sb]! });
    }
  }
  const adjacency = new Map<string, { to: string; bridge: Bridge; side: Side }[]>();
  for (const i of islands) adjacency.set(i.id, []);
  for (const b of bridges) {
    adjacency.get(b.a)!.push({ to: b.b, bridge: b, side: b.sideA });
    adjacency.get(b.b)!.push({ to: b.a, bridge: b, side: b.sideB });
  }

  // ground canvas
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of islands) {
    minX = Math.min(minX, i.ground.x);
    minY = Math.min(minY, i.ground.y);
    maxX = Math.max(maxX, i.ground.x + i.ground.img.width);
    maxY = Math.max(maxY, i.ground.y + i.ground.img.height);
  }
  minX = Math.floor(minX - 40);
  minY = Math.floor(minY - 90);
  maxX = Math.ceil(maxX + 40);
  maxY = Math.ceil(maxY + 90);
  const { c, g } = makeCanvas(maxX - minX, maxY - minY);
  // soft shadows far below each island
  for (const i of islands) {
    const cx = isoX(i.center.tx, i.center.ty) - minX;
    const cy = isoY(i.center.tx, i.center.ty) + i.size * 8 + 64 - minY;
    const rx = i.size * 14;
    g.save();
    g.translate(cx, cy);
    g.scale(1, 0.42);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, 'rgba(40,70,120,0.16)');
    grad.addColorStop(1, 'rgba(40,70,120,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const sprites: Sprite[] = [];
  for (const i of [...islands].sort((a, b) => a.depth - b.depth)) g.drawImage(i.ground.img, i.ground.x - minX, i.ground.y - minY);
  for (const b of bridges) paintBridge(g, -minX, -minY, b, sprites);
  for (const i of islands) sprites.push(...i.sprites);
  sprites.sort((a, b) => a.depth - b.depth);

  return {
    key: layoutKeyOf(snapshot),
    islands,
    byId,
    deptIsland,
    bridges,
    adjacency,
    ground: { img: c, x: minX, y: minY },
    sprites,
    lights: islands.flatMap((i) => i.lights),
    bounds: { minX: minX + 30, minY: minY + 30, maxX: maxX - 30, maxY: maxY - 60 },
    plaza,
    grid,
    seatOf,
  };
}
