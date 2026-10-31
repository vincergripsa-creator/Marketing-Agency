// The world's layout under Node, on the headless canvas: stable desks, tiers, the 13 fixed cells, plots and the pier.
// Run: cd server && npx vitest run --root ../web/src world/layout
import './testCanvas';
import { describe, expect, it } from 'vitest';
import type { AgentState, CompanySnapshot, DeptDef, DeptId, SceneView } from '../../../shared/types';
import { ISLAND_TIERS, PIER_CELL } from '../../../shared/worldgrid';
import { DEPARTMENTS } from '../../../server/src/runtime/roster';
import { AgentSim } from './agents';
import { WorldEngine } from './engine';
import type { Pt } from './iso';
import { buildDeptIsland } from './islands';
import { buildLayout, deskIndexes, effectiveGrid, layoutKeyOf, mapGrid } from './layout';
import { mockSnapshot } from './mockSnapshot';
import type { Bridge, IslandModel, Side, WorldLayout } from './model';
import { makeCanvas, mirror } from './pixel';
import { getSheet } from './sprites';
import { FakeCanvas, opaquePixels } from './testCanvas';

const base = mockSnapshot();
const template = base.company.agents[0]!;
const LEAN: DeptId[] = ['recherche', 'studio', 'creation', 'growth', 'boutique', 'finance', 'rh'];
const EVERY: DeptId[] = DEPARTMENTS.map((d) => d.id).filter((id) => id !== 'direction');
const PLAZA_DESKS = 3; // what the Direction office fits, both gates kept

function person(id: string, dept: DeptId, desk?: number, isChief = false): AgentState {
  const a: AgentState = { ...template, id, name: id, dept, isChief, status: 'working', place: dept };
  if (desk !== undefined) a.desk = desk;
  else delete a.desk;
  return a;
}

/** What the stream carries: open departments in `company`, the others in `scene` (D35). */
function snapshotOf(open: readonly DeptId[], agents: AgentState[], deskHigh: Partial<Record<DeptId, number>> = {}, chiefs: Partial<Record<DeptId, string>> = {}): CompanySnapshot {
  const defs: DeptDef[] = DEPARTMENTS.map((d) => ({ ...d, grid: { ...d.grid } }));
  const isOpen = (d: DeptDef) => d.id === 'direction' || open.includes(d.id);
  const departments = defs.filter(isOpen).map((d) => {
    const out: DeptDef = { ...d, chiefId: chiefs[d.id] ?? d.chiefId };
    if (deskHigh[d.id] !== undefined) out.deskHigh = deskHigh[d.id]!;
    return out;
  });
  const scene: SceneView = { ...base.scene!, closedDepts: defs.filter((d) => !isOpen(d)) };
  return { ...base, company: { ...base.company, departments, agents }, scene };
}

function staffed(s: CompanySnapshot): { L: WorldLayout; sim: AgentSim } {
  const L = buildLayout(s);
  const sim = new AgentSim();
  sim.setLayout(L);
  sim.sync(s, 0);
  return { L, sim };
}

const team = (dept: DeptId, n: number): AgentState[] => Array.from({ length: n }, (_, i) => person(`${dept}-${i}`, dept, i, i === 0));
const deskPoints = (isl: IslandModel) => isl.seats.map((s) => ({ pos: s.pos, aisle: s.aisle, facing: s.facing }));
const localPoints = (isl: IslandModel) => isl.seats.map((s) => ({ tx: s.pos.tx - isl.x0, ty: s.pos.ty - isl.y0, facing: s.facing }));
const cellOf = (L: WorldLayout, id: string) => ({ col: L.byId.get(id)!.col, row: L.byId.get(id)!.row });

describe('headless canvas', () => {
  it('paints real pixels, mirrors them and bakes a sheet', () => {
    const { c, g } = makeCanvas(4, 1);
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 1, 1);
    const flipped = mirror(c).getContext('2d')!.getImageData(0, 0, 4, 1).data;
    expect([...flipped.slice(12, 16)]).toEqual([255, 0, 0, 255]);
    expect(flipped[3]).toBe(0);
    expect(opaquePixels(getSheet(template.avatar))).toBeGreaterThan(1000);
  });
});

describe('a hire or a departure moves nobody', () => {
  it('a hire into a department with a free desk leaves the key unchanged', () => {
    const before = snapshotOf(LEAN, team('studio', 2), { studio: 2 });
    const after = snapshotOf(LEAN, [...team('studio', 2), person('new', 'studio', 2)], { studio: 3 });
    expect(layoutKeyOf(after)).toBe(layoutKeyOf(before));
  });

  it('the engine keeps the same world through a hire, and rebuilds it on a tier change', () => {
    const engine = new WorldEngine(new FakeCanvas() as unknown as HTMLCanvasElement, { onSelectAgent: () => undefined, onSelectDept: () => undefined });
    const six = team('studio', 6);
    engine.setSnapshot(snapshotOf(LEAN, six.slice(0, 5), { studio: 5 }));
    const world = engine.islands;
    engine.setSnapshot(snapshotOf(LEAN, six, { studio: 6 }));
    expect(engine.islands).toBe(world);
    engine.setSnapshot(snapshotOf(LEAN, [...six, person('seventh', 'studio', 6)], { studio: 7 }));
    expect(engine.islands).not.toBe(world);
  });

  it('a tier change dissolves the last frame over the new map, a hire does not', () => {
    const engine = new WorldEngine(new FakeCanvas() as unknown as HTMLCanvasElement, { onSelectAgent: () => undefined, onSelectDept: () => undefined });
    const fading = () => (engine as unknown as { dissolve: { dur: number } | null }).dissolve;
    const six = team('studio', 6);
    engine.resize(300, 150, 1);
    engine.setSnapshot(snapshotOf(LEAN, six.slice(0, 5), { studio: 5 }));
    engine.frame(performance.now());
    engine.setSnapshot(snapshotOf(LEAN, six, { studio: 6 }));
    expect(fading()).toBeNull();
    engine.setSnapshot(snapshotOf(LEAN, [...six, person('seventh', 'studio', 6)], { studio: 7 }));
    expect(fading()?.dur).toBeCloseTo(0.35);
    engine.frame(performance.now() + 100);
    expect(fading()).not.toBeNull();
    engine.frame(performance.now() + 400);
    expect(fading()).toBeNull();
  });

  it('a hire with no beat sits at its desk at once, everybody else stays', () => {
    const crew = team('studio', 3);
    const { L, sim } = staffed(snapshotOf(LEAN, crew, { studio: 3 }));
    const before = crew.map((a) => ({ ...sim.agents.get(a.id)!.pos }));
    sim.sync(snapshotOf(LEAN, [...crew, person('new', 'studio', 3)], { studio: 4 }), 1);
    expect(crew.map((a) => sim.agents.get(a.id)!.pos)).toEqual(before);
    expect(sim.agents.get('new')!.pos).toEqual(L.byId.get('studio')!.seats[3]!.pos);
  });

  it('a departure leaves every other desk where it was and the emptied desk visible', () => {
    const crew = team('studio', 4);
    const s = snapshotOf(LEAN, crew, { studio: 4 });
    const { L, sim } = staffed(s);
    const before = new Map(crew.map((a) => [a.id, sim.seatOf(a)!.seat.pos]));
    const left = crew.filter((a) => a.id !== 'studio-1');
    const after = snapshotOf(LEAN, left, { studio: 4 });
    expect(layoutKeyOf(after)).toBe(layoutKeyOf(s));
    sim.sync(after, 1);
    expect(sim.agents.has('studio-1')).toBe(false);
    for (const a of left) {
      expect(sim.agents.get(a.id)!.spot!.pos).toEqual(before.get(a.id));
      expect(sim.agents.get(a.id)!.path).toEqual([]);
    }
    const seats = L.byId.get('studio')!.seats;
    expect(seats[1]!.sprites.length).toBe(2);
    expect(seats[1]!.sprites.some((x) => x.hidden)).toBe(false);
  });

  it('a desk nobody ever used stays hidden, and shows when someone takes it', () => {
    const crew = team('studio', 2);
    const { L, sim } = staffed(snapshotOf(LEAN, crew, { studio: 2 }));
    const seats = L.byId.get('studio')!.seats;
    expect(seats.map((x) => x.sprites.every((p) => p.hidden))).toEqual([false, false, true, true, true, true]);
    for (const seat of seats) for (const p of seat.sprites) expect(L.sprites).toContain(p);
    sim.sync(snapshotOf(LEAN, [...crew, person('new', 'studio', 2)], { studio: 3 }), 1);
    expect(seats.map((x) => x.sprites.every((p) => p.hidden))).toEqual([false, false, false, true, true, true]);
  });

  it('a sprite on its way out outlives the snapshot that dropped it, staff does not', () => {
    const crew = team('studio', 3);
    const { sim } = staffed(snapshotOf(LEAN, crew, { studio: 3 }));
    sim.agents.get('studio-1')!.role = 'leaving';
    sim.sync(snapshotOf(LEAN, [crew[0]!], { studio: 3 }), 1);
    expect(sim.agents.has('studio-1')).toBe(true);
    expect(sim.agents.has('studio-2')).toBe(false);
  });

  it('a reload rebuilds identical desks', () => {
    const s = snapshotOf(EVERY, [...team('studio', 5), ...team('support', 9), person('hugo', 'direction', 1)], { studio: 7, support: 9 });
    const again = JSON.parse(JSON.stringify(s)) as CompanySnapshot;
    expect(layoutKeyOf(again)).toBe(layoutKeyOf(s));
    const a = buildLayout(s);
    const b = buildLayout(again);
    for (const isl of a.islands) expect(deskPoints(b.byId.get(isl.id)!)).toEqual(deskPoints(isl));
    const sim = staffed(s).sim;
    const reloaded = staffed(again).sim;
    for (const st of s.company.agents) expect(reloaded.agents.get(st.id)!.pos).toEqual(sim.agents.get(st.id)!.pos);
  });

  it('a new chief gets desk 0 and walks there, the others do not move', () => {
    const crew = team('studio', 4);
    const { L, sim } = staffed(snapshotOf(LEAN, crew, { studio: 4 }));
    const seats = L.byId.get('studio')!.seats;
    const swapped = [person('studio-0', 'studio', 2), person('studio-1', 'studio', 1), person('studio-2', 'studio', 0, true), person('studio-3', 'studio', 3)];
    sim.sync(snapshotOf(LEAN, swapped, { studio: 4 }, { studio: 'studio-2' }), 1);
    const promoted = sim.agents.get('studio-2')!;
    expect(promoted.spot!.pos).toEqual(seats[0]!.pos);
    expect(promoted.path.length).toBeGreaterThan(0);
    expect(seats[0]!.chief).toBe(true);
    expect(sim.agents.get('studio-1')!.spot!.pos).toEqual(seats[1]!.pos);
    expect(sim.agents.get('studio-1')!.path).toEqual([]);
    expect(sim.agents.get('studio-3')!.spot!.pos).toEqual(seats[3]!.pos);
  });

  it('a save without desks: chief 0, the others in roster order', () => {
    const roster = [person('b', 'studio'), person('boss', 'studio', undefined, true), person('c', 'studio'), person('x', 'support'), person('elise', 'creation')];
    const desks = deskIndexes(roster, (dept) => (dept === 'creation' ? 'elise' : undefined));
    expect(Object.fromEntries(desks)).toEqual({ boss: 0, b: 1, c: 2, x: 0, elise: 0 });
  });

  it('a save half-way: agents with a desk keep it, the others skip the taken ones, a duplicate loses', () => {
    const roster = [person('a', 'studio', 1), person('b', 'studio'), person('c', 'studio', 1), person('d', 'studio', 3)];
    expect(Object.fromEntries(deskIndexes(roster, () => undefined))).toEqual({ a: 1, d: 3, b: 0, c: 2 });
  });
});

describe('tiers', () => {
  it('each tier really fits its desks with all four corridors kept, the wide one first', () => {
    const open = LEAN;
    for (const tier of ISLAND_TIERS) {
      const isl = buildLayout(snapshotOf(open, [], { studio: tier.seats })).byId.get('studio')!;
      expect(isl.size).toBe(tier.size);
      expect(isl.seats).toHaveLength(tier.seats);
      expect(isl.seats.map((s) => s.chief)).toEqual(isl.seats.map((_, i) => i === 0));
    }
  });

  it('crossing 6 to 7 desks moves the island to size 10, desk indexes do not change, the key does', () => {
    const six = team('studio', 6);
    const before = snapshotOf(LEAN, six, { studio: 6 });
    const after = snapshotOf(LEAN, [...six, person('seventh', 'studio', 6)], { studio: 7 });
    expect(buildLayout(before).byId.get('studio')!.size).toBe(9);
    expect(layoutKeyOf(after)).not.toBe(layoutKeyOf(before));
    const { L, sim } = staffed(after);
    const isl = L.byId.get('studio')!;
    expect(isl.size).toBe(10);
    expect(isl.seats).toHaveLength(12);
    expect(after.company.agents.map((a) => sim.seatOf(a)!.desk)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(after.company.agents.map((a) => isl.seats.indexOf(sim.seatOf(a)!.seat))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('deskHigh keeps the size after the team falls back to 3', () => {
    const big = snapshotOf(LEAN, team('studio', 7), { studio: 7 });
    const small = snapshotOf(LEAN, team('studio', 3), { studio: 7 });
    expect(layoutKeyOf(small)).toBe(layoutKeyOf(big));
    const { L } = staffed(small);
    const isl = L.byId.get('studio')!;
    expect(isl.size).toBe(10);
    expect(isl.seats.map((s) => s.sprites.some((p) => p.hidden)).filter((h) => !h)).toHaveLength(7);
  });

  it('the plaza office never changes, whoever has no desk left stands at a visitor spot', () => {
    const few = staffed(snapshotOf(LEAN, [person('camille', 'direction', 0, true)])).L;
    expect(few.plaza.seats).toHaveLength(PLAZA_DESKS);
    expect(few.plaza.seats.flatMap((s) => s.sprites).some((p) => p.hidden)).toBe(false);
    const many = Array.from({ length: PLAZA_DESKS + 2 }, (_, i) => person(`d${i}`, 'direction', i, i === 0));
    const { L, sim } = staffed(snapshotOf(LEAN, many));
    expect(deskPoints(L.plaza)).toEqual(deskPoints(few.plaza));
    expect(sim.seatOf(many[PLAZA_DESKS - 1]!)?.seat).toBe(L.plaza.seats[PLAZA_DESKS - 1]);
    expect(sim.seatOf(many[PLAZA_DESKS]!)).toBeNull();
    expect(sim.agents.get(`d${PLAZA_DESKS}`)!.spot!.kind).toBe('visitor');
  });
});

describe('13 fixed cells', () => {
  const declared = new Map(DEPARTMENTS.map((d) => [d.id, d.grid]));

  it('the catalog is 13 departments on free, connected cells', () => {
    expect(DEPARTMENTS).toHaveLength(13);
    const cells = DEPARTMENTS.map((d) => `${d.grid.col},${d.grid.row}`);
    expect(new Set(cells).size).toBe(13);
    expect(cells).not.toContain(`${PIER_CELL.col},${PIER_CELL.row}`);
    expect(cells).not.toContain('0,2');
  });

  it('for all 8 192 open subsets, effectiveGrid returns the declared cells', () => {
    let moved = 0;
    for (let mask = 0; mask < 1 << DEPARTMENTS.length; mask++) {
      const open = DEPARTMENTS.filter((_, i) => mask & (1 << i));
      const closed = DEPARTMENTS.filter((_, i) => !(mask & (1 << i)));
      const grid = effectiveGrid([...open, ...closed]);
      for (const [id, cell] of declared) {
        const g = grid.get(id);
        if (g?.col !== cell.col || g.row !== cell.row) moved++;
      }
    }
    expect(moved).toBe(0);
  });

  it('world and minimap read one grid: on the lean map Growth keeps its cell behind two plots', () => {
    const s = snapshotOf(LEAN, []);
    expect(mapGrid(s).get('growth')).toEqual(declared.get('growth'));
    expect(buildLayout(s).grid).toEqual(mapGrid(s));
    expect(effectiveGrid(s.company.departments).get('growth')).not.toEqual(declared.get('growth')); // what the plots prevent
  });

  it('opening a department leaves every other island where it was', () => {
    const before = buildLayout(snapshotOf(LEAN, []));
    const after = buildLayout(snapshotOf([...LEAN, 'crm'], []));
    expect(after.byId.get('crm')!.closed).toBeUndefined();
    expect(after.byId.get('crm')!.seats).toHaveLength(6);
    for (const isl of before.islands) {
      expect(cellOf(after, isl.id)).toEqual(cellOf(before, isl.id));
      expect(after.byId.get(isl.id)!.center).toEqual(isl.center);
    }
  });

  it('a closed department draws a plot: no desk, no office, lights off, same cell', () => {
    const L = buildLayout(snapshotOf(LEAN, []));
    const plot = L.byId.get('partenariats')!;
    expect(plot.closed).toBe(true);
    expect(plot.deptId).toBe('partenariats');
    expect(cellOf(L, 'partenariats')).toEqual(declared.get('partenariats'));
    expect(plot.size).toBe(ISLAND_TIERS[0].size);
    expect(plot.seats).toEqual([]);
    expect(plot.room).toBeNull();
    expect(plot.gates).toEqual([]);
    expect(plot.lights).toEqual([]);
    expect(plot.wanderSpots.length).toBeGreaterThan(0);
    expect(L.deptIsland.get('partenariats')).toBe(plot);
  });

  it('a plot keeps its tier 1 whatever deskHigh it closed with, and bridges stay: Growth is reached through Partenariats', () => {
    const s = snapshotOf(LEAN, team('growth', 2), { growth: 2 });
    const closed = (s.scene!.closedDepts as DeptDef[]).map((d) => ({ ...d, deskHigh: 9 }));
    const { L, sim } = staffed({ ...s, scene: { ...s.scene!, closedDepts: closed } });
    expect(L.byId.get('partenariats')!.size).toBe(ISLAND_TIERS[0].size);
    expect(L.adjacency.get('growth')!.every((n) => L.byId.get(n.to)!.closed)).toBe(true);
    const start = sim.agents.get('growth-1')!;
    const walk = sim.routeToDock(start.pos, start.island);
    expect(walk.some((p) => L.byId.get(p.island)!.closed)).toBe(true);
    expect(walk[walk.length - 1]!.island).toBe('quai');
  });

  it('a dept on (0,1) or (0,2) in an old save moves away, the pier keeps its cell', () => {
    const old = (id: DeptId, col: number, row: number): DeptDef => ({ ...DEPARTMENTS.find((d) => d.id === id)!, grid: { col, row } });
    const grid = effectiveGrid([old('analyse', 0, 1), old('finance', 0, 2), old('rh', -1, 0)]);
    for (const id of ['analyse', 'finance'] as const) {
      expect(`${grid.get(id)!.col},${grid.get(id)!.row}`).not.toBe(`${PIER_CELL.col},${PIER_CELL.row}`);
      expect(`${grid.get(id)!.col},${grid.get(id)!.row}`).not.toBe('0,2');
    }
    const L = buildLayout(mockSnapshot()); // the mock's Analyse sits on (0,1)
    expect(cellOf(L, 'quai')).toEqual(PIER_CELL);
    expect(cellOf(L, 'analyse')).not.toEqual(PIER_CELL);
    expect(new Set(L.islands.map((i) => `${i.col},${i.row}`)).size).toBe(L.islands.length);
  });

  it('nothing connects through the pier: an old cell behind it is brought back to the group', () => {
    const grid = effectiveGrid([{ ...DEPARTMENTS.find((d) => d.id === 'support')!, grid: { col: 1, row: 1 } }]);
    expect(Math.abs(grid.get('support')!.col) + Math.abs(grid.get('support')!.row)).toBe(1);
    expect(grid.get('support')).not.toEqual(PIER_CELL);
  });
});

describe('the pier', () => {
  const pair = (b: Bridge) => [b.a, b.b].sort().join('|');

  it('bridges to the plaza and to nobody else, whatever the tiers', () => {
    for (const s of [snapshotOf(EVERY, []), snapshotOf(EVERY, [], { finance: 31, support: 31, rh: 31 })]) {
      const L = buildLayout(s);
      expect(L.bridges.filter((b) => b.a === 'quai' || b.b === 'quai').map(pair)).toEqual(['plaza|quai']);
      expect(L.adjacency.get('quai')!.map((n) => n.to)).toEqual(['plaza']);
      expect(L.pier).toBe(L.byId.get('quai'));
      expect(L.pier.kind).toBe('pier');
      expect(L.byId.get('finance')!.gates.map((g) => g.side)).not.toContain('x+');
      expect(L.byId.get('support')!.gates.map((g) => g.side)).not.toContain('x-');
    }
  });

  // ui §4.2, plaza local tiles: nobody walks through the stage
  const STAGE = [
    { x0: 11.4, y0: 10.7, x1: 13.9, y1: 11.0 }, // trophy wall
    { x0: 11.3, y0: 11.6, x1: 13.5, y1: 12.8 }, // podium
    { x0: 1.6, y0: 11.6, x1: 2.4, y1: 12.4 },   // league board
    { x0: 3.2, y0: 10.6, x1: 5.2, y1: 11.4 },   // duel table and its two spots
    { x0: 8.4, y0: 14.2, x1: 12.9, y1: 14.7 },  // channel slots, front edge
    { x0: 14.2, y0: 8.4, x1: 14.7, y1: 13.3 },  // channel slots, side edge
  ];

  function crossesStage(plaza: IslandModel, a: Pt, b: Pt): boolean {
    const steps = Math.ceil(Math.hypot(b.tx - a.tx, b.ty - a.ty) / 0.05) + 1;
    for (let i = 0; i <= steps; i++) {
      const x = a.tx + ((b.tx - a.tx) * i) / steps - plaza.x0;
      const y = a.ty + ((b.ty - a.ty) * i) / steps - plaza.y0;
      if (STAGE.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) return true;
    }
    return false;
  }

  it('from every desk, the walk to the dock ends on the pier and crosses no stage rectangle', () => {
    for (const s of [snapshotOf(EVERY, []), snapshotOf(LEAN, []), snapshotOf(EVERY, [], { boutique: 31, crm: 21, recherche: 12 })]) {
      const { L, sim } = staffed(s);
      let walks = 0;
      for (const isl of L.islands) {
        for (const seat of isl.seats) {
          const walk = sim.routeToDock(seat.pos, isl.id);
          const last = walk[walk.length - 1]!;
          expect(last.island).toBe('quai');
          expect({ tx: last.tx, ty: last.ty }).toEqual(L.pier.pier!.dock);
          let from: Pt = seat.pos;
          for (const p of walk) {
            expect(crossesStage(L.plaza, from, p), `${isl.id} ${from.tx},${from.ty} → ${p.tx},${p.ty}`).toBe(false);
            from = p;
          }
          walks++;
        }
      }
      expect(walks).toBeGreaterThanOrEqual(4);
    }
  });

  it('the walk back from the dock crosses no stage rectangle either', () => {
    const { L, sim } = staffed(snapshotOf(EVERY, team('support', 2), { support: 2 }));
    const dock = L.pier.pier!.dock;
    const v = sim.agents.get('support-1')!;
    v.pos = { ...dock };
    v.island = 'quai';
    v.spot = { key: 'dock', kind: 'dock', island: L.pier, pos: dock, pose: 'stand', facing: 'se' };
    sim.sync(snapshotOf(EVERY, team('support', 2), { support: 2 }), 1);
    expect(v.path.length).toBeGreaterThan(2);
    let from: Pt = dock;
    for (const p of v.path) {
      expect(crossesStage(L.plaza, from, p)).toBe(false);
      from = p;
    }
    expect(v.path[v.path.length - 1]!.island).toBe('support');
  });
});

describe('buildDeptIsland', () => {
  const input = (bridgeSides: Side[]) => ({
    id: 'studio', def: DEPARTMENTS[2]!, name: 'Studio', sign: 'STUDIO', color: '#e76f51', col: -1, row: -1, center: { tx: 3, ty: -2 }, size: 10, seats: 12, bridgeSides,
  });

  it('a new neighbour does not change the desks, only the fence', () => {
    const alone = buildDeptIsland(input(['y-']));
    const surrounded = buildDeptIsland(input(['x-', 'x+', 'y-', 'y+']));
    expect(localPoints(surrounded)).toEqual(localPoints(alone));
    expect(alone.gates.map((g) => g.side).sort()).toEqual(['y+', 'y-']);
    expect(surrounded.gates.map((g) => g.side).sort()).toEqual(['x+', 'x-', 'y+', 'y-']);
  });
});
