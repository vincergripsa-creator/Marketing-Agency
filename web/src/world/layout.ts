// World layout: effective island grid (collision + connectivity fixes), island placement,
// bridges, one composited ground canvas and the sorted list of static props. The layout knows
// departments and tiers, never people: a hire or a departure rebuilds nothing.
import type { AgentId, AgentState, CompanySnapshot, DeptDef } from '../../../shared/types';
import { ISLAND_TIERS, PIER_CELL, tierFor } from '../../../shared/worldgrid';
import { isoX, isoY, type Pt } from './iso';
import { buildDeptIsland } from './islands';
import { OPPOSITE, type Bridge, type IslandModel, type Side, type Sprite, type WorldLayout } from './model';
import { deptColor } from './palette';
import { makeCanvas } from './pixel';
import { PIER_SIZE, buildPier } from './pier';
import { PLAZA_SIZE, buildPlaza } from './plaza';
import { paintBridge } from './bridges';
import { clearBakeCache } from './pixel';

export const GRID_LIMIT = 3;
const GAP = 2.4;
const MAX_BRIDGE_GAP = 4.2;
/** No island on (0,2): it stays open sky under the Accueil. */
const OPEN_SKY = { col: 0, row: 2 } as const;

const key = (c: number, r: number) => `${c},${r}`;
const NEIGHBORS: [number, number, Side][] = [[1, 0, 'x+'], [-1, 0, 'x-'], [0, 1, 'y+'], [0, -1, 'y-']];

function clampInt(v: unknown, lim: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.max(-lim, Math.min(lim, n));
}

/**
 * Effective grid positions: direction always lives on the central plaza (0,0); the Accueil and the
 * open sky under it take their cells before any department; collisions move an island to the nearest
 * free cell; islands that cannot be reached by 4-adjacency are moved next to the connected group.
 * A no-op on the catalog, open and closed departments together. Used by both the world and the
 * minimap so they always match.
 */
export function effectiveGrid(departments: readonly DeptDef[]): Map<string, { col: number; row: number }> {
  const out = new Map<string, { col: number; row: number }>();
  const occ = new Map<string, string>();
  const reserved = new Set([key(PIER_CELL.col, PIER_CELL.row), key(OPEN_SKY.col, OPEN_SKY.row)]);
  for (const k of reserved) occ.set(k, 'reserved');
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
  // connectivity: the pier only bridges to the plaza, nobody crosses it
  const connected = (): Set<string> => {
    const seen = new Set<string>([key(0, 0)]);
    const q: [number, number][] = [[0, 0]];
    while (q.length) {
      const [c, r] = q.shift()!;
      for (const [dc, dr] of NEIGHBORS) {
        const k = key(c + dc, r + dr);
        if (occ.has(k) && !reserved.has(k) && !seen.has(k)) {
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

/** Tier of a department: it follows the desks ever used, so it never shrinks (ui D7). */
function tierOf(d: DeptDef, agents: readonly AgentState[]): (typeof ISLAND_TIERS)[number] {
  const team = agents.filter((a) => a.dept === d.id).length;
  return tierFor(Math.max(d.deskHigh ?? 0, team));
}

/** The departments of the map: the open ones, then the vacant plots, which the stream carries in `scene` (D35). */
export function mapDepartments(snapshot: CompanySnapshot | null): { open: DeptDef[]; closed: DeptDef[] } {
  const open = (snapshot?.company.departments ?? []).filter((d) => d && typeof d.id === 'string');
  const ids = new Set(open.map((d) => d.id));
  const closed = (snapshot?.scene?.closedDepts ?? []).filter((d) => d && typeof d.id === 'string' && !ids.has(d.id) && d.id !== 'direction');
  return { open, closed };
}

/** The cells of the map: plots hold theirs, so an open department never gets moved. World and minimap both read this. */
export function mapGrid(snapshot: CompanySnapshot | null): Map<string, { col: number; row: number }> {
  const { open, closed } = mapDepartments(snapshot);
  return effectiveGrid([...open, ...closed]);
}

/** No agent in it: a hire or a departure leaves the world alone unless the tier changes. */
export function layoutKeyOf(snapshot: CompanySnapshot | null): string {
  const { open, closed } = mapDepartments(snapshot);
  const agents = snapshot?.company.agents ?? [];
  return JSON.stringify(open.map((d): unknown[] => {
    const size = d.id === 'direction' ? 0 : tierOf(d, agents).size; // the plaza never resizes
    return [d.id, d.name, d.color, d.icon, d.grid?.col, d.grid?.row, size];
  }).concat(closed.map((d) => [d.id, d.grid?.col, d.grid?.row, 'plot'])));
}

/**
 * Desk index of each agent inside its department: `desk` when set. Otherwise (old saves before their first tick, mock):
 * chief first, then roster order, skipping taken desks.
 */
export function deskIndexes(agents: readonly AgentState[], chiefOf: (dept: string) => string | undefined): Map<AgentId, number> {
  const out = new Map<AgentId, number>();
  const taken = new Map<string, Set<number>>();
  const usedIn = (dept: string): Set<number> => {
    let s = taken.get(dept);
    if (!s) taken.set(dept, (s = new Set()));
    return s;
  };
  for (const a of agents) {
    if (typeof a.desk !== 'number' || usedIn(a.dept).has(a.desk)) continue;
    usedIn(a.dept).add(a.desk);
    out.set(a.id, a.desk);
  }
  const rest = agents.filter((a) => !out.has(a.id));
  const isChief = (a: AgentState) => a.isChief || a.id === chiefOf(a.dept);
  for (const a of [...rest.filter(isChief), ...rest.filter((x) => !isChief(x))]) {
    const used = usedIn(a.dept);
    let i = 0;
    while (used.has(i)) i++;
    used.add(i);
    out.set(a.id, i);
  }
  return out;
}

/** Shows the desks below max(deskHigh, highest used + 1). Called from sync, O(desks). The plaza keeps its four. */
export function applyDeskVisibility(L: WorldLayout, desks: Map<AgentId, number>, agents: readonly AgentState[], depts: readonly DeptDef[]): void {
  const high = new Map<string, number>();
  for (const d of depts) high.set(d.id, d.deskHigh ?? 0);
  for (const a of agents) {
    const i = desks.get(a.id);
    if (i !== undefined) high.set(a.dept, Math.max(high.get(a.dept) ?? 0, i + 1));
  }
  for (const isl of L.islands) {
    if (isl.kind !== 'dept') continue;
    const shown = high.get(isl.id) ?? 0;
    isl.seats.forEach((seat, i) => {
      for (const s of seat.sprites) s.hidden = i >= shown;
    });
  }
}

export function buildLayout(snapshot: CompanySnapshot | null): WorldLayout {
  clearBakeCache();
  const { open, closed } = mapDepartments(snapshot);
  const departments = [...open, ...closed];
  const agents = snapshot?.company.agents ?? [];
  const closedIds = new Set(closed.map((d) => d.id as string));
  const grid = mapGrid(snapshot);
  const defOf = new Map(departments.map((d) => [d.id as string, d]));
  const cells = new Map<string, string>();
  for (const [id, g] of grid) cells.set(key(g.col, g.row), id === 'direction' ? 'plaza' : id);
  cells.set(key(PIER_CELL.col, PIER_CELL.row), 'quai');

  // the pier only bridges to the plaza: finance and support, its other neighbours, do not see it
  const sidesOf = (c: number, r: number): Side[] => NEIGHBORS
    .filter(([dc, dr]) => {
      const other = cells.get(key(c + dc, r + dr));
      return other !== undefined && (other !== 'quai' || (c === 0 && r === 0));
    })
    .map(([, , s]) => s);

  // sizes
  const sizes = new Map<string, number>([['plaza', PLAZA_SIZE], ['quai', PIER_SIZE]]);
  const seatCount = new Map<string, number>();
  for (const id of grid.keys()) {
    if (id === 'direction') continue;
    const def = defOf.get(id)!;
    const tier = closedIds.has(id) ? ISLAND_TIERS[0] : tierOf(def, agents);
    sizes.set(id, tier.size);
    seatCount.set(id, closedIds.has(id) ? 0 : tier.seats);
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
  });
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
      size: sizes.get(d.id) ?? ISLAND_TIERS[0].size,
      seats: seatCount.get(d.id) ?? 0,
      bridgeSides: sidesOf(g.col, g.row),
      closed: closedIds.has(d.id),
    });
    islands.push(isl);
    byId.set(isl.id, isl);
    deptIsland.set(d.id, isl);
  }
  const pier = buildPier({
    center: { tx: colX.get(PIER_CELL.col) ?? 0, ty: rowY.get(PIER_CELL.row) ?? 0 }, col: PIER_CELL.col, row: PIER_CELL.row, bridgeSides: ['y-'],
  });
  islands.push(pier);
  byId.set(pier.id, pier);

  // bridges: short ones always, long ones only when needed for connectivity
  type Cand = { a: IslandModel; b: IslandModel; sa: Side; sb: Side; gap: number };
  const cands: Cand[] = [];
  for (const isl of islands) {
    for (const [dc, dr, side] of NEIGHBORS) {
      if (side !== 'x+' && side !== 'y+') continue;
      const otherId = cells.get(key(isl.col + dc, isl.row + dr));
      const other = otherId ? byId.get(otherId) : undefined;
      if (!other) continue;
      if ((isl.kind === 'pier' || other.kind === 'pier') && isl.kind !== 'plaza') continue;
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

  const layout: WorldLayout = {
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
    pier,
    hotspots: [],
    grid,
  };
  const chiefs = new Map(open.map((d) => [d.id as string, d.chiefId]));
  applyDeskVisibility(layout, deskIndexes(agents, (dept) => chiefs.get(dept)), agents, open);
  return layout;
}
