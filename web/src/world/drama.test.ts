// The company's life on the map, under Node on the headless canvas: beats, leavers, arrivals, duels, the season's end, markers.
// Run: cd server && npx vitest run --root ../web/src world/drama
import './testCanvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, ChronicleEntry, CompanySnapshot, DeptDef, DeptId, PersonCard, SceneView } from '../../../shared/types';
import { DEPARTMENTS } from '../../../server/src/runtime/roster';
import { FADE_SECONDS, MAX_WALKERS, DUEL_SECONDS, opacityOf, type AgentSim, type AgentVis } from './agents';
import type { Bubbles } from './bubbles';
import { BADGE_ZOOM, DUEL_GAP, DuelQueue, MAX_AGE_DAYS, MAX_BEATS, MAX_DUELS_WAITING, WHY_CHARS, badgeIcon, dramaState, grownIslands, leaveLine, nameTagRole, takeBeats, type Drama } from './drama';
import type { Effects } from './effects';
import { WorldEngine } from './engine';
import { isoX, isoY, type Pt } from './iso';
import { buildLayout } from './layout';
import { mockSnapshot } from './mockSnapshot';
import { statusIcon } from './sprites';
import { FakeCanvas, FakeContext2D } from './testCanvas';

const base = mockSnapshot();
const template = base.company.agents[0]!;
const LEAN: DeptId[] = ['recherche', 'studio', 'creation', 'growth', 'boutique', 'finance', 'rh'];
const DAY = 20;
const DT = 0.05;

function person(id: string, dept: DeptId, desk: number, isChief = false): AgentState {
  return { ...template, id, name: id, dept, desk, isChief, status: 'working', place: dept, bubble: null, founder: false };
}

const entry = (key: string, kind: ChronicleEntry['kind'], extra: Partial<ChronicleEntry> = {}): ChronicleEntry => ({ key, day: DAY, kind, text: key, ...extra });
const cardOf = (a: AgentState): PersonCard => ({ id: a.id, name: a.name, role: a.role, dept: a.dept, avatar: a.avatar });

/** What the stream carries, with a small team of our own: this file must not lean on the mock's roster. */
function snapshotOf(agents: AgentState[], recent: ChronicleEntry[] = [], scene: Partial<SceneView> = {}, deskHigh: Partial<Record<DeptId, number>> = {}): CompanySnapshot {
  const defs: DeptDef[] = DEPARTMENTS.map((d) => ({ ...d, grid: { ...d.grid } }));
  const isOpen = (d: DeptDef) => d.id === 'direction' || LEAN.includes(d.id);
  const chiefs = new Map(agents.filter((a) => a.isChief).map((a) => [a.dept, a.id]));
  const departments = defs.filter(isOpen).map((d): DeptDef => ({ ...d, chiefId: chiefs.get(d.id) ?? d.chiefId, deskHigh: deskHigh[d.id] ?? agents.filter((a) => a.dept === d.id).length }));
  return {
    ...base, day: DAY, company: { ...base.company, departments, agents },
    scene: { ...base.scene!, recent, people: {}, duels: [], openSeats: {}, closedDepts: defs.filter((d) => !isOpen(d)), ...scene },
  };
}

const crew = (): AgentState[] => [
  person('boss', 'studio', 0, true), person('lea', 'studio', 1), person('sam', 'studio', 2),
  person('nora', 'growth', 0, true), person('yan', 'growth', 1), person('ines', 'finance', 0, true),
];

interface Internals { sim: AgentSim; drama: Drama; effects: Effects; bubbles: Bubbles; pick(x: number, y: number): { agent?: string; dept?: DeptId; place?: string } }

function stage(first: CompanySnapshot) {
  const clock = { t: 1000 };
  vi.spyOn(performance, 'now').mockImplementation(() => clock.t * 1000);
  const engine = new WorldEngine(new FakeCanvas() as unknown as HTMLCanvasElement, { onSelectAgent: () => undefined, onSelectDept: () => undefined });
  engine.resize(300, 150, 1);
  engine.setSnapshot(first);
  const { sim, drama, effects, bubbles, pick } = engine as unknown as Internals;
  /** Sim time only, no drawing, stopping as soon as `until` holds. */
  const run = (seconds: number, until?: () => boolean): void => {
    for (let i = 0; i < seconds / DT && !until?.(); i++) {
      clock.t += DT;
      sim.update(DT, clock.t);
      drama.update(clock.t);
      effects.update(DT);
    }
  };
  return { engine, sim, drama, effects, bubbles, clock, run, pick: pick.bind(engine) };
}

const floaters = (e: Effects) => (e as unknown as { floaters: { text: string; color: string }[] }).floaters;
const sparks = (e: Effects) => (e as unknown as { sparks: { life: number }[] }).sparks;
const said = (b: Bubbles) => (b as unknown as { items: Map<string, { text: string; header: string }> }).items;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('takeBeats', () => {
  const scene = (recent: ChronicleEntry[]) => ({ recent }) as SceneView;

  it('the first snapshot of a run plays nothing, and neither does a reload', () => {
    const recent = [entry('a', 'hire'), entry('b', 'fire')];
    const st = dramaState();
    expect(takeBeats(st, scene(recent), DAY)).toEqual([]);
    expect(takeBeats(st, scene(recent), DAY)).toEqual([]);
    const reloaded = dramaState(); // a reload is a new page: a new state on the same lines
    expect(takeBeats(reloaded, scene(recent), DAY)).toEqual([]);
    expect(takeBeats(reloaded, scene([...recent, entry('c', 'hire')]), DAY).map((e) => e.key)).toEqual(['c']);
  });

  it('a snapshot with no scene is not the first one', () => {
    const st = dramaState();
    expect(takeBeats(st, undefined, DAY)).toEqual([]);
    expect(st.started).toBe(false);
    expect(takeBeats(st, scene([entry('old', 'hire')]), DAY)).toEqual([]);
  });

  it('a new key plays exactly once across two snapshots', () => {
    const st = dramaState();
    takeBeats(st, scene([]), DAY);
    const recent = [entry('a', 'hire')];
    expect(takeBeats(st, scene(recent), DAY).map((e) => e.key)).toEqual(['a']);
    expect(takeBeats(st, scene(recent), DAY)).toEqual([]);
  });

  it('24 lines after a sleep: the newest 12 play, nothing older than 2 days', () => {
    const st = dramaState();
    takeBeats(st, scene([]), DAY);
    const fresh = Array.from({ length: 24 }, (_, i) => entry(`k${i}`, 'hire'));
    const played = takeBeats(st, scene(fresh), DAY);
    expect(played).toHaveLength(MAX_BEATS);
    expect(played.map((e) => e.key)).toEqual(fresh.slice(-MAX_BEATS).map((e) => e.key));
    const old = [entry('stale', 'fire', { day: DAY - MAX_AGE_DAYS - 1 }), entry('edge', 'fire', { day: DAY - MAX_AGE_DAYS })];
    expect(takeBeats(st, scene(old), DAY).map((e) => e.key)).toEqual(['edge']);
    expect(takeBeats(st, scene(old), DAY)).toEqual([]); // what was too old is seen all the same
  });

  it('memory is bounded: past 500 keys only the lines still on screen stay', () => {
    const st = dramaState();
    takeBeats(st, scene([]), DAY);
    for (let i = 0; i <= 500; i++) takeBeats(st, scene([entry(`k${i}`, 'hire')]), DAY);
    expect(st.seen.size).toBeLessThanOrEqual(24);
    expect(takeBeats(st, scene([entry('k500', 'hire')]), DAY)).toEqual([]);
  });
});

describe('the duel table', () => {
  const started: string[] = [];
  const start = (e: ChronicleEntry) => (started.push(e.key), true);

  it('a second duel waits while one plays, and for its 30 s', () => {
    started.length = 0;
    const q = new DuelQueue();
    q.push(entry('one', 'duel_open'));
    q.push(entry('two', 'duel_open'));
    q.pump(0, false, start);
    expect(started).toEqual(['one']);
    q.pump(1, true, start);
    q.pump(10, false, start);
    q.pump(DUEL_GAP + 5, true, start);
    expect(started).toEqual(['one']);
    q.pump(DUEL_GAP + 6, false, start);
    expect(started).toEqual(['one', 'two']);
  });

  it('a line of 4 drops the oldest', () => {
    started.length = 0;
    const q = new DuelQueue();
    for (const k of ['a', 'b', 'c', 'd']) q.push(entry(k, 'duel_open'));
    expect(q.size).toBe(MAX_DUELS_WAITING);
    for (let t = 0; t < 4; t++) q.pump(t * (DUEL_GAP + 1), false, start);
    expect(started).toEqual(['b', 'c', 'd']);
  });

  it('a duel nobody can play gives its slot to the next', () => {
    const q = new DuelQueue();
    q.push(entry('gone', 'duel_open'));
    q.push(entry('here', 'duel_open'));
    const tried: string[] = [];
    q.pump(0, false, (e) => (tried.push(e.key), e.key === 'here'));
    expect(tried).toEqual(['gone', 'here']);
    expect(q.size).toBe(0);
  });
});

describe('a departure', () => {
  const fired = (team: AgentState[], id: string, extra: Partial<ChronicleEntry> = {}) => {
    const leaver = team.find((a) => a.id === id)!;
    // `deskHigh` never goes down: the emptied desk stays
    return snapshotOf(team.filter((a) => a !== leaver), [entry(`org:${id}`, 'fire', { agentId: id, person: cardOf(leaver), why: 'Note sous la barre depuis 14 jours.', ...extra })], {}, { [leaver.dept]: team.filter((a) => a.dept === leaver.dept).length });
  };

  it('the id is gone from the snapshot: a leaver with a box walks to the dock, fades, and is deleted', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    const before = sim.agents.get('sam')!;
    const seat = sim.seatOf(team[2]!)!;
    engine.setSnapshot(fired(team, 'sam'));
    expect(sim.agents.has('sam')).toBe(false);
    const v = sim.agents.get('leaver:org:sam')!;
    expect(v.role).toBe('leaving');
    expect(v.carry).toBe('box');
    expect(v.sheet).toBe(before.sheet);
    expect(v.pos).toEqual(seat.seat.pos);
    expect(v.state.name).toBe('sam');
    expect(v.path.length).toBeGreaterThan(2);
    expect(seat.seat.sprites.some((x) => x.hidden)).toBe(false);
    const dock = (engine as unknown as { layout: { pier: { pier: { dock: Pt } } } }).layout.pier.pier.dock;
    run(120, () => !v.path.length);
    expect(v.pos).toEqual(dock);
    expect(v.island).toBe('quai');
    expect(sim.agents.has(v.id)).toBe(true);
    run(DT * 2);
    expect(opacityOf(v, v.fadeAt! + FADE_SECONDS / 2)).toBeCloseTo(0.5);
    run(FADE_SECONDS + 0.2);
    expect(sim.agents.has(v.id)).toBe(false);
  });

  it('a leaver walks 1,6 times as fast as a colleague on the same path', () => {
    const team = crew();
    const { engine, sim, clock } = stage(snapshotOf(team));
    engine.setSnapshot(fired(team, 'sam'));
    const v = sim.agents.get('leaver:org:sam')!;
    const twin: AgentVis = { ...v, id: 'twin', role: 'staff', pos: { ...v.pos }, path: v.path.map((p) => ({ ...p })) };
    sim.agents.set('twin', twin);
    const from = { ...v.pos };
    sim.update(0.01, clock.t + 0.01); // short enough to stay on the first leg
    const moved = (p: Pt) => Math.hypot(isoX(p.tx, p.ty) - isoX(from.tx, from.ty), isoY(p.tx, p.ty) - isoY(from.tx, from.ty));
    expect(moved(v.pos) / moved(twin.pos)).toBeCloseTo(1.6, 1);
  });

  it('says why, cut at 60 characters, in a bubble of its own', () => {
    const team = crew();
    const { engine, bubbles } = stage(snapshotOf(team));
    const why = 'Note sous la barre depuis 14 jours, plan de progrès non tenu, deux duels perdus de suite.';
    engine.setSnapshot(fired(team, 'sam', { why }));
    const line = said(bubbles).get('leaver:org:sam')!;
    expect(line.text.startsWith('Je pars : Note sous la barre')).toBe(true);
    expect(line.text.length).toBeLessThanOrEqual('Je pars : '.length + WHY_CHARS);
    expect(line.text.endsWith('…')).toBe(true);
    expect(line.header).toBe('SAM');
  });

  it('a layoff walks out the same way', () => {
    const team = crew();
    const { engine, sim } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team.filter((a) => a.id !== 'yan'), [entry('org:y', 'layoff', { agentId: 'yan', person: cardOf(team[4]!) })]));
    expect(sim.agents.get('leaver:org:y')?.carry).toBe('box');
  });

  it('with no sprite left it starts from the card, at the middle of its island', () => {
    const team = crew();
    const { engine, sim } = stage(snapshotOf(team));
    const ghost = person('ghost', 'finance', 3);
    engine.setSnapshot(snapshotOf(team, [entry('org:g', 'fire', { agentId: 'ghost', person: cardOf(ghost) })]));
    const v = sim.agents.get('leaver:org:g')!;
    const finance = (engine as unknown as { layout: { deptIsland: Map<string, { center: Pt }> } }).layout.deptIsland.get('finance')!;
    expect(v.pos).toEqual(finance.center);
    expect(v.state.name).toBe('ghost');
    expect(v.path.length).toBeGreaterThan(0);
  });

  it('a replacement lands in one tick: the leaver walks out as the new hire walks in', () => {
    const team = crew();
    const { engine, sim } = stage(snapshotOf(team));
    const sam = team[2]!;
    const mina = person('mina', 'studio', 2);
    engine.setSnapshot(snapshotOf([...team.filter((a) => a !== sam), mina], [
      entry('org:hire', 'hire', { agentId: 'mina', person: cardOf(mina) }), entry('org:leave', 'fire', { agentId: 'sam', person: cardOf(sam) }),
    ], {}, { studio: 3 }));
    expect(sim.agents.get('leaver:org:leave')?.carry).toBe('box');
    expect(sim.agents.get('mina')?.carry).toBe('bag');
    expect(sim.agents.get('mina')?.island).toBe('quai');
    expect(sim.agents.has('sam')).toBe(false);
  });

  it('hired and gone in the same snapshot: one leaver, from the card, and no arrival left waiting', () => {
    const team = crew();
    const { engine, sim } = stage(snapshotOf(team));
    const ghost = person('ghost', 'finance', 3);
    engine.setSnapshot(snapshotOf(team, [entry('org:h', 'hire', { agentId: 'ghost' }), entry('org:f', 'fire', { agentId: 'ghost', person: cardOf(ghost) })]));
    expect(sim.agents.has('ghost')).toBe(false);
    expect(sim.agents.get('leaver:org:f')?.state.name).toBe('ghost');
    engine.setSnapshot(snapshotOf([...team, ghost]));
    expect(sim.agents.get('ghost')?.role).toBe('staff'); // the expected arrival died with its snapshot
  });

  it('a first snapshot that already lacks the agent stages nothing', () => {
    const team = crew();
    const { sim } = stage(fired(team, 'sam'));
    expect([...sim.agents.keys()].some((id) => id.startsWith('leaver:'))).toBe(false);
  });

  it('a leaver cannot be picked', () => {
    const team = [...crew(), person('solo', 'rh', 0, true)];
    const { engine, sim, pick } = stage(snapshotOf(team));
    const v = sim.agents.get('solo')!;
    const [sx, sy] = engine.camera.worldToScreen(isoX(v.pos.tx, v.pos.ty), isoY(v.pos.tx, v.pos.ty) - 8);
    expect(pick(sx, sy).agent).toBe('solo');
    engine.setSnapshot(fired(team, 'solo'));
    expect(sim.agents.has('leaver:org:solo')).toBe(true);
    expect(pick(sx, sy).agent).toBeUndefined();
  });

  it('past 6 leavers at once the sprite is skipped', () => {
    const team = Array.from({ length: MAX_WALKERS + 2 }, (_, i) => person(`p${i}`, 'studio', i, i === 0));
    const { engine, sim } = stage(snapshotOf(team));
    const recent = team.slice(1).map((a) => entry(`org:${a.id}`, 'fire', { agentId: a.id, person: cardOf(a) }));
    engine.setSnapshot(snapshotOf(team.slice(0, 1), recent, {}, { studio: team.length }));
    expect([...sim.agents.values()].filter((v) => v.role === 'leaving')).toHaveLength(MAX_WALKERS);
    expect(sim.agents.size).toBe(MAX_WALKERS + 1);
  });

  it('a rebuild of the map does not send a walker back to its desk: it carries on to the dock', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    engine.setSnapshot(fired(team, 'sam'));
    run(2);
    const v = sim.agents.get('leaver:org:sam')!;
    const grown = snapshotOf(team.filter((a) => a.id !== 'sam'), [], {}, { growth: 7 }); // a neighbour goes up a tier
    engine.setSnapshot(grown);
    expect(sim.agents.get(v.id)).toBe(v);
    expect(v.path[v.path.length - 1]!.island).toBe('quai');
    run(120, () => !sim.agents.has(v.id));
    expect(sim.agents.has(v.id)).toBe(false);
  });
});

describe('a hire', () => {
  const hired = (team: AgentState[], a: AgentState, deskHigh?: Partial<Record<DeptId, number>>) => snapshotOf([...team, a], [entry(`org:${a.id}`, 'hire', { agentId: a.id, person: cardOf(a) })], {}, deskHigh);

  it('a new id starts at the dock with its bag and ends seated with empty hands', () => {
    const team = crew();
    const { engine, sim, run, clock } = stage(snapshotOf(team));
    const a = person('mina', 'studio', 3);
    engine.setSnapshot(hired(team, a));
    const v = sim.agents.get('mina')!;
    const L = (engine as unknown as { layout: ReturnType<typeof buildLayout> }).layout;
    expect(v.role).toBe('arriving');
    expect(v.carry).toBe('bag');
    expect(v.pos).toEqual(L.pier.pier!.dock);
    expect(v.island).toBe('quai');
    expect(opacityOf(v, clock.t)).toBe(0);
    expect(opacityOf(v, clock.t + FADE_SECONDS)).toBeCloseTo(1);
    run(120, () => v.role !== 'arriving');
    expect(v.role).toBe('staff');
    expect(v.carry).toBeNull();
    expect(v.pos).toEqual(L.byId.get('studio')!.seats[3]!.pos);
    expect(v.pose).toBe('shake');
    expect(v.poseUntil).toBeCloseTo(clock.t + 1.5, 1);
    expect(opacityOf(v, clock.t)).toBe(1);
  });

  it('a known sprite goes to the dock too', () => {
    const team = crew();
    const { engine, sim } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [entry('org:lea', 'hire', { agentId: 'lea' })]));
    const v = sim.agents.get('lea')!;
    expect(v.role).toBe('arriving');
    expect(v.island).toBe('quai');
  });

  it('its chief gets up on its way in, and goes back to work', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    engine.setSnapshot(hired(team, person('mina', 'studio', 3)));
    const chief = sim.agents.get('boss')!;
    const other = sim.agents.get('lea')!;
    expect(chief.override).toBeNull();
    const v = sim.agents.get('mina')!;
    run(120, () => v.island === 'studio');
    run(DT * 2);
    expect(chief.override).toMatchObject({ kind: 'visit', target: 'mina' });
    expect(other.override).toBeNull();
    run(60, () => !chief.override);
    expect(chief.override).toBeNull();
    run(30, () => !chief.path.length);
    expect(chief.spot?.kind).toBe('seat');
  });

  it('dust lands with it', () => {
    const team = crew();
    const { engine, sim, effects, run } = stage(snapshotOf(team));
    engine.setSnapshot(hired(team, person('mina', 'studio', 3)));
    const v = sim.agents.get('mina')!;
    run(120, () => v.role === 'staff');
    expect(effects.particleCount).toBeGreaterThan(0);
    expect(sim.cues).toHaveLength(0);
  });

  it('a hire that rebuilds the map still walks in from the dock', () => {
    const team = Array.from({ length: 6 }, (_, i) => person(`p${i}`, 'studio', i, i === 0));
    const { engine, sim } = stage(snapshotOf(team));
    engine.setSnapshot(hired(team, person('seventh', 'studio', 6)));
    const v = sim.agents.get('seventh')!;
    expect(v.role).toBe('arriving');
    expect(v.island).toBe('quai');
    expect(v.path[v.path.length - 1]!.island).toBe('studio');
  });

  it('the same hire arriving in two snapshots walks in once', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    const s = hired(team, person('mina', 'studio', 3));
    engine.setSnapshot(s);
    const v = sim.agents.get('mina')!;
    run(120, () => v.role === 'staff');
    engine.setSnapshot({ ...s, tick: s.tick + 1 });
    expect(v.role).toBe('staff');
    expect(v.carry).toBeNull();
  });

  it('past 6 arrivals the seventh simply sits at its desk', () => {
    const team = [person('boss', 'studio', 0, true)];
    const { engine, sim } = stage(snapshotOf(team));
    const recruits = Array.from({ length: MAX_WALKERS + 1 }, (_, i) => person(`r${i}`, 'finance', i));
    engine.setSnapshot(snapshotOf([...team, ...recruits], recruits.map((a) => entry(`org:${a.id}`, 'hire', { agentId: a.id }))));
    const walking = recruits.filter((a) => sim.agents.get(a.id)!.role === 'arriving');
    expect(walking).toHaveLength(MAX_WALKERS);
    const last = sim.agents.get(`r${MAX_WALKERS}`)!;
    expect(last.role).toBe('staff');
    expect(last.carry).toBeNull();
  });

  it('nothing pulls a newcomer off its way', () => {
    const team = crew();
    const { engine, sim, clock } = stage(snapshotOf(team));
    engine.setSnapshot(hired(team, person('mina', 'studio', 3)));
    const v = sim.agents.get('mina')!;
    sim.onActivity({ id: 'x', day: DAY, tick: 1, at: 0, agentId: 'mina', kind: 'coffee', text: 'café' }, clock.t);
    expect(v.override).toBeNull();
  });
});

describe('a duel', () => {
  const open = (key: string, a: string, b: string) => entry(key, 'duel_open', { agentId: a, otherId: b });

  it('both walk to the table, the 8 s start once both stand there, then back to work', () => {
    const team = crew();
    const { engine, sim, effects, run, clock } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [open('duel:1:open', 'lea', 'yan')]));
    run(DT);
    const [a, b] = [sim.agents.get('lea')!, sim.agents.get('yan')!];
    expect(a.override).toMatchObject({ kind: 'duel', slot: 0 });
    expect(b.override).toMatchObject({ kind: 'duel', slot: 1 });
    const stageOf = (engine as unknown as { layout: ReturnType<typeof buildLayout> }).layout.plaza.stage!;
    expect(a.spot!.pos).toEqual(stageOf.duel.spots[0]);
    expect(b.spot!.pos).toEqual(stageOf.duel.spots[1]);
    expect(sparks(effects)).toHaveLength(0);
    run(60, () => !a.path.length && !b.path.length);
    run(DT * 2);
    expect(sparks(effects)).toHaveLength(1);
    expect(sparks(effects)[0]!.life).toBe(DUEL_SECONDS);
    expect(a.facing).toBe(stageOf.duel.facing[0]);
    const end = a.override!.holdUntil!;
    expect(b.override!.holdUntil).toBe(end);
    expect(end).toBeGreaterThan(clock.t + DUEL_SECONDS - 0.5);
    run(DUEL_SECONDS - 1);
    expect(a.override?.kind).toBe('duel');
    run(2);
    expect(a.override).toBeNull();
    expect(b.override).toBeNull();
    run(60, () => !a.path.length);
    expect(a.spot?.kind).toBe('seat');
  });

  it('a rebuild of the map during the 8 s neither restarts them nor lights a second spark', () => {
    const team = crew();
    const { engine, sim, effects, run, clock } = stage(snapshotOf(team, [], {}, { growth: 6 }));
    const recent = [open('d1', 'lea', 'yan')];
    engine.setSnapshot(snapshotOf(team, recent, {}, { growth: 6 }));
    run(DT);
    const [a, b] = [sim.agents.get('lea')!, sim.agents.get('yan')!];
    run(60, () => a.override?.holdUntil !== undefined);
    run(3);
    const end = a.override!.holdUntil!;
    engine.setSnapshot(snapshotOf(team, recent, {}, { growth: 7 })); // a hire takes a neighbour up a tier
    run(DT * 2);
    expect(a.override?.holdUntil).toBe(end);
    expect(b.override?.holdUntil).toBe(end);
    expect(sparks(effects)).toHaveLength(1);
    run(end - clock.t + 0.2);
    expect(a.override).toBeNull();
    expect(b.override).toBeNull();
  });

  it('a rebuild while they walk puts them at the table: one spark, 8 s, and it ends', () => {
    const team = crew();
    const { engine, sim, effects, run } = stage(snapshotOf(team, [], {}, { growth: 6 }));
    const recent = [open('d1', 'lea', 'yan')];
    engine.setSnapshot(snapshotOf(team, recent, {}, { growth: 6 }));
    run(DT);
    const a = sim.agents.get('lea')!;
    expect(a.path.length).toBeGreaterThan(0);
    engine.setSnapshot(snapshotOf(team, recent, {}, { growth: 7 }));
    run(DT * 2);
    expect(a.path).toEqual([]);
    expect(sparks(effects)).toHaveLength(1);
    run(DUEL_SECONDS + 0.5);
    expect(a.override).toBeNull();
  });

  it('a second duel_open waits for the table, then plays', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [open('d1', 'lea', 'yan'), open('d2', 'sam', 'ines')]));
    run(DT);
    expect(sim.agents.get('lea')!.override?.kind).toBe('duel');
    expect(sim.agents.get('sam')!.override).toBeNull();
    run(DUEL_GAP - 1);
    expect(sim.agents.get('sam')!.override).toBeNull();
    run(60, () => sim.agents.get('sam')!.override !== null);
    expect(sim.agents.get('sam')!.override?.kind).toBe('duel');
  });

  it('a duellist who left drops the duel, the partner stays at work', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team.filter((a) => a.id !== 'yan'), [open('d1', 'lea', 'yan')]));
    run(DT);
    expect(sim.agents.get('lea')!.override).toBeNull();
    expect(sim.inDuel).toBe(false);
  });

  it('a coffee does not pull anyone out of a duel', () => {
    const team = crew();
    const { engine, sim, run, clock } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [open('d1', 'lea', 'yan')]));
    run(DT);
    sim.onActivity({ id: 'x', day: DAY, tick: 1, at: 0, agentId: 'lea', kind: 'coffee', text: 'café' }, clock.t);
    expect(sim.agents.get('lea')!.override?.kind).toBe('duel');
  });

  it('its end floats both scores, one cheers and one slumps for 2 s', () => {
    const team = crew();
    const { engine, sim, effects, clock } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [entry('d1:end', 'duel_end', { agentId: 'lea', otherId: 'yan', numbers: { ratingDeltaA: 18, ratingDeltaB: -12 } })]));
    expect(floaters(effects).map((f) => f.text)).toEqual(['+18', '-12']);
    expect(sim.agents.get('lea')!.pose).toBe('cheer');
    expect(sim.agents.get('yan')!.pose).toBe('slump');
    expect(sim.agents.get('lea')!.poseUntil).toBeCloseTo(clock.t + 2);
  });

  it('a draw floats nothing', () => {
    const team = crew();
    const { engine, effects } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [entry('d1:end', 'duel_end', { agentId: 'lea', otherId: 'yan', numbers: { ratingDeltaA: 0, ratingDeltaB: -0 } })]));
    expect(floaters(effects)).toEqual([]);
  });
});

describe('the end of a season', () => {
  const season = (agentId: string | null) => entry('season:3', 'season_end', { agentId, numbers: { season: 3 } });

  it('confetti for 4 s over the podium, and the champion comes to cheer', () => {
    const team = crew();
    const { engine, sim, effects, run } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team, [season('lea')]));
    const v = sim.agents.get('lea')!;
    const stageOf = (engine as unknown as { layout: ReturnType<typeof buildLayout> }).layout.plaza.stage!;
    run(DT);
    expect(effects.particleCount).toBeGreaterThan(0);
    run(3);
    expect(effects.particleCount).toBeGreaterThan(0); // the last burst is still in the air
    run(1.2);
    expect(effects.particleCount).toBe(0);
    expect(v.override?.kind).toBe('cheer');
    expect(v.spot!.pos).toEqual(stageOf.podium.champion);
    run(60, () => !v.path.length);
    run(DT * 2);
    expect(v.pos).toEqual(stageOf.podium.champion);
    expect(v.pose).toBe('cheer');
    run(6);
    expect(v.override).toBeNull();
    expect(v.path.length).toBeGreaterThan(0);
  });

  it('a rebuild of the map on the way puts the champion on the spot: she cheers her 4 s and goes back', () => {
    const team = crew();
    const { engine, sim, run, clock } = stage(snapshotOf(team, [], {}, { growth: 6 }));
    const recent = [season('lea')];
    engine.setSnapshot(snapshotOf(team, recent, {}, { growth: 6 }));
    const v = sim.agents.get('lea')!;
    expect(v.path.length).toBeGreaterThan(0);
    engine.setSnapshot(snapshotOf(team, recent, {}, { growth: 7 }));
    expect(v.pose).toBe('cheer');
    expect(v.poseUntil).toBeCloseTo(clock.t + 4);
    run(4.2);
    expect(v.override).toBeNull();
  });

  it('a champion who left is not called, the confetti still falls', () => {
    const team = crew();
    const { engine, sim, effects, run } = stage(snapshotOf(team));
    engine.setSnapshot(snapshotOf(team.filter((a) => a.id !== 'lea'), [season('lea')]));
    run(DT);
    expect(effects.particleCount).toBeGreaterThan(0);
    expect([...sim.agents.values()].some((v) => v.override?.kind === 'cheer')).toBe(false);
  });

  it('the walk to the podium goes round the steps, there and back', () => {
    // plaza local tiles of ui §4.2
    const STEPS = [{ x0: 11.4, y0: 10.7, x1: 13.9, y1: 11.0 }, { x0: 11.3, y0: 11.6, x1: 13.5, y1: 12.8 }];
    const team = [...crew(), person('zed', 'rh', 0, true)];
    const { engine, sim, run, clock } = stage(snapshotOf(team));
    const plaza = (engine as unknown as { layout: ReturnType<typeof buildLayout> }).layout.plaza;
    const clear = (from: Pt, path: Pt[]): boolean => {
      let a = from;
      for (const b of path) {
        for (let i = 0; i <= 200; i++) {
          const x = a.tx + ((b.tx - a.tx) * i) / 200 - plaza.x0;
          const y = a.ty + ((b.ty - a.ty) * i) / 200 - plaza.y0;
          if (STEPS.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) return false;
        }
        a = b;
      }
      return true;
    };
    for (const id of ['boss', 'nora', 'ines', 'zed']) {
      const v = sim.agents.get(id)!;
      sim.callToPodium(id, clock.t);
      expect(clear(v.pos, v.path), id).toBe(true);
      run(60, () => !v.path.length);
      run(DT * 2);
      run(6, () => !v.override);
      expect(v.path.length, id).toBeGreaterThan(0);
      expect(clear(plaza.stage!.podium.champion, v.path), id).toBe(true);
      run(60, () => !v.path.length);
    }
  });
});

describe('the other beats', () => {
  it('a promotion sparkles, CHEF floats over the new chief', () => {
    const team = crew();
    const { engine, effects } = stage(snapshotOf(team));
    const next = team.map((a) => (a.id === 'lea' ? { ...a, desk: 0, isChief: true } : a.id === 'boss' ? { ...a, desk: 1, isChief: false } : a));
    engine.setSnapshot(snapshotOf(next, [entry('org:chief', 'promote', { agentId: 'lea' })]));
    expect(sparks(effects)).toHaveLength(1);
    expect(floaters(effects).map((f) => f.text)).toEqual(['CHEF']);
  });

  it('a channel opens with dust and its name over the totem', () => {
    const team = crew();
    const { engine, effects } = stage(snapshotOf(team));
    const chip = { id: 'meta', name: 'Facebook & Instagram', glyph: 'F', color: '#1877f2', state: 'open', share: 0.2 } as const;
    engine.setSnapshot(snapshotOf(team, [entry('channel:d1', 'channel_open', { channel: 'meta' })], { channels: [chip] }));
    expect(effects.particleCount).toBeGreaterThan(0);
    expect(floaters(effects)).toMatchObject([{ text: 'Facebook & Instagram', color: '#1877f2' }]);
  });

  it('a probation and a closing channel move nobody', () => {
    const team = crew();
    const { engine, sim, effects } = stage(snapshotOf(team));
    const spots = [...sim.agents.values()].map((v) => v.spot?.key);
    engine.setSnapshot(snapshotOf(team, [entry('plan:lea', 'probation', { agentId: 'lea' }), entry('ban:1', 'channel_close', { channel: 'meta' })]));
    expect([...sim.agents.values()].map((v) => v.spot?.key)).toEqual(spots);
    expect(effects.particleCount).toBe(0);
    expect(floaters(effects)).toEqual([]);
  });

  it('the camera stays where it is', () => {
    const team = crew();
    const { engine } = stage(snapshotOf(team));
    const at = [engine.camera.x, engine.camera.y, engine.camera.zoom];
    engine.setSnapshot(snapshotOf(team.filter((a) => a.id !== 'sam'), [entry('org:s', 'fire', { agentId: 'sam', person: cardOf(team[2]!) })]));
    expect([engine.camera.x, engine.camera.y, engine.camera.zoom]).toEqual(at);
  });

  it('a plot that opens and a bigger tier raise dust, a hire does not', () => {
    const open = snapshotOf(crew(), [], {}, { studio: 6 });
    const a = buildLayout(open);
    const tier = buildLayout(snapshotOf(crew(), [], {}, { studio: 7 }));
    expect(grownIslands(a, tier).map((i) => i.id)).toEqual(['studio']);
    const closed = buildLayout({ ...open, company: { ...open.company, departments: open.company.departments.filter((d) => d.id !== 'rh') }, scene: { ...open.scene!, closedDepts: [...open.scene!.closedDepts, DEPARTMENTS.find((d) => d.id === 'rh')!] } });
    expect(grownIslands(closed, a).map((i) => i.id)).toEqual(['rh']);
    expect(grownIslands(tier, a)).toEqual([]);
    expect(grownIslands(a, buildLayout(open))).toEqual([]);

    const team = crew();
    const { engine, effects, run } = stage(snapshotOf(team, [], {}, { growth: 6 }));
    engine.frame(1000 * 1000);
    engine.setSnapshot(snapshotOf(team, [], {}, { growth: 7 }));
    expect(effects.particleCount).toBe(0); // the dissolve comes first
    run(0.4);
    expect(effects.particleCount).toBeGreaterThan(0);
  });

  it('the map of a new run raises no dust: nothing grew, it is another company', () => {
    const team = crew();
    const { engine, effects, run, clock } = stage(snapshotOf(team, [], {}, { growth: 6 }));
    engine.frame(clock.t * 1000);
    engine.setSnapshot({ ...snapshotOf(team, [], {}, { growth: 7 }), runId: 'autre' });
    run(0.5);
    expect(effects.particleCount).toBe(0);
  });

  it('a new run forgets the lines, the walkers and the duels of the last one', () => {
    const team = crew();
    const { engine, sim, run } = stage(snapshotOf(team));
    const recent = [entry('org:s', 'fire', { agentId: 'sam', person: cardOf(team[2]!) }), entry('d1', 'duel_open', { agentId: 'lea', otherId: 'yan' })];
    engine.setSnapshot(snapshotOf(team.filter((a) => a.id !== 'sam'), recent));
    expect(sim.agents.has('leaver:org:s')).toBe(true);
    engine.setSnapshot({ ...snapshotOf(team, recent), runId: 'autre' });
    expect(sim.agents.has('leaver:org:s')).toBe(false);
    run(DT);
    expect(sim.inDuel).toBe(false);
    // its own first snapshot plays nothing, its lines are read from zero
    engine.setSnapshot({ ...snapshotOf(team.filter((a) => a.id !== 'sam'), [...recent, entry('org:new', 'fire', { agentId: 'sam', person: cardOf(team[2]!) })]), runId: 'autre' });
    expect([...sim.agents.keys()].filter((id) => id.startsWith('leaver:'))).toEqual(['leaver:org:new']);
  });
});

describe('vacancy tags', () => {
  it('one tag on the next free desk of a department with an open position', () => {
    const team = crew();
    const { engine, sim, drama } = stage(snapshotOf(team, [], { openSeats: { studio: 2 } }));
    const L = (engine as unknown as { layout: ReturnType<typeof buildLayout> }).layout;
    const seat = L.byId.get('studio')!.seats[3]!;
    expect(sim.nextFreeSeat('studio')).toBe(seat);
    expect(drama.items()).toHaveLength(1);
    expect(drama.items()[0]!.depth).toBeGreaterThan(seat.deskDepth);
  });

  it('the tag follows the desks: a departure frees the lower one', () => {
    const team = crew();
    const { engine, sim } = stage(snapshotOf(team, [], { openSeats: { studio: 1 } }));
    engine.setSnapshot(snapshotOf(team.filter((a) => a.id !== 'lea'), [], { openSeats: { studio: 1 } }, { studio: 3 }));
    const L = (engine as unknown as { layout: ReturnType<typeof buildLayout> }).layout;
    expect(sim.nextFreeSeat('studio')).toBe(L.byId.get('studio')!.seats[1]);
  });

  it('none without an open position, and none on a plot', () => {
    const team = crew();
    const { engine, drama } = stage(snapshotOf(team, [], { openSeats: { studio: 0 } }));
    expect(drama.items()).toEqual([]);
    engine.setSnapshot(snapshotOf(team, [], { openSeats: { crm: 1 } }));
    expect(drama.items()).toEqual([]);
  });
});

describe('markers', () => {
  it('the crown shows at any zoom, the others up close, a red card on focus', () => {
    const far = BADGE_ZOOM - 0.25;
    expect(badgeIcon('champion', far, false)).toBe('crown');
    expect(badgeIcon('podium', far, false)).toBeNull();
    expect(badgeIcon('podium', BADGE_ZOOM, false)).toBe('medal');
    expect(badgeIcon('new', far, true)).toBeNull();
    expect(badgeIcon('new', BADGE_ZOOM, false)).toBe('star');
    expect(badgeIcon('probation', far, false)).toBeNull();
    expect(badgeIcon('probation', far, true)).toBe('card');
    expect(badgeIcon('probation', BADGE_ZOOM, false)).toBe('card');
    expect(badgeIcon(null, 4, true)).toBeNull();
    expect(badgeIcon(undefined, 4, true)).toBeNull();
  });

  it('the name tag adds the rating only to whoever has one', () => {
    const chip = { rating: 1284.4, rank: 1, of: 3, delta7d: 0, contract: 'active', badge: null } as const;
    expect(nameTagRole('Rédactrice', chip)).toMatch(/^Rédactrice · 1\s284$/);
    expect(nameTagRole('Rédactrice', undefined)).toBe('Rédactrice');
  });

  it('a marker fades in with its sprite: no star hangs over an empty dock', () => {
    const team = crew();
    const people = { mina: { rating: 1500, rank: 1, of: 1, delta7d: 0, contract: 'trial', badge: 'champion' } as const };
    const { engine, clock } = stage(snapshotOf(team, [], { people }));
    engine.setSnapshot(snapshotOf([...team, person('mina', 'studio', 3)], [entry('org:m', 'hire', { agentId: 'mina' })], { people }));
    const crown = statusIcon('crown', 0);
    const real = FakeContext2D.prototype.drawImage;
    const alphas: number[] = [];
    vi.spyOn(FakeContext2D.prototype, 'drawImage').mockImplementation(function (this: FakeContext2D, src: FakeCanvas, ...n: number[]) {
      if ((src as unknown) === crown) alphas.push(this.globalAlpha);
      real.call(this, src, ...n);
    });
    engine.frame((clock.t + FADE_SECONDS / 2) * 1000);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeCloseTo(0.5);
  });

  it('a departure line without a reason still says it', () => {
    expect(leaveLine(undefined)).toBe('Je pars.');
    expect(leaveLine('  ')).toBe('Je pars.');
    expect(leaveLine('Trop cher.')).toBe('Je pars : Trop cher.');
  });

  it('a real frame draws walkers, badges and tags, and hands alpha back', () => {
    const team = crew();
    const people = { lea: { rating: 1584, rank: 1, of: 3, delta7d: 4, contract: 'active', badge: 'champion' } as const };
    const { engine, clock } = stage(snapshotOf(team, [], { people, openSeats: { studio: 1 } }));
    engine.frame(clock.t * 1000);
    const a = person('mina', 'studio', 3);
    engine.setSnapshot(snapshotOf([...team.filter((x) => x.id !== 'sam'), a], [
      entry('org:s', 'fire', { agentId: 'sam', person: cardOf(team[2]!) }), entry('org:m', 'hire', { agentId: 'mina' }), entry('d1', 'duel_open', { agentId: 'lea', otherId: 'yan' }), entry('s:1', 'season_end', { agentId: 'nora' }),
    ], { people, openSeats: { studio: 1 } }));
    for (let i = 1; i <= 5; i++) engine.frame((clock.t + i * 0.1) * 1000);
    const ctx = (engine as unknown as { g: { globalAlpha: number } }).g;
    expect(ctx.globalAlpha).toBe(1);
  });
});
