/**
 * Desks (ui §2.1): a hire, a departure, a chief who changes or a reload moves nobody, because the desk is a number the world keeps.
 * Built by hand where the rule is arithmetic, played on a real run for the proof that it draws nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunPaths } from '../src/contracts.js';
import type { AgentState, DeptDef, DeptId, WorldState } from '../src/shared.js';
import { TICKS_PER_DAY } from '../src/shared.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { syncDesks } from '../src/runtime/desks.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

const leanWorld = (): WorldState => createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-desks');

const teamOf = (w: WorldState, dept: DeptId): AgentState[] => w.company.agents.filter((a) => a.dept === dept);
const deskOf = (w: WorldState, id: string): number | undefined => w.company.agents.find((a) => a.id === id)?.desk;
const desks = (w: WorldState): Record<string, number | undefined> => Object.fromEntries(w.company.agents.map((a) => [a.id, a.desk]));
const defOf = (w: WorldState, dept: DeptId): DeptDef => w.company.departments.find((d) => d.id === dept)!;

function hire(w: WorldState, id: string, dept: DeptId): AgentState {
  const { desk: _desk, ...twin } = w.company.agents[0]!;
  const a: AgentState = { ...twin, id, name: id, dept, isChief: false };
  w.company.agents.push(a);
  return a;
}

function leave(w: WorldState, id: string): void {
  w.company.agents = w.company.agents.filter((a) => a.id !== id);
}

function expectOneDeskEach(w: WorldState): void {
  for (const d of w.company.departments) {
    const held = teamOf(w, d.id).map((a) => a.desk);
    expect(held.every((n) => Number.isInteger(n))).toBe(true);
    expect(new Set(held).size, d.id).toBe(held.length);
  }
}

describe('syncDesks', () => {
  it('gives each department its desks, the chief first, and a second call changes nothing', () => {
    const w = leanWorld();
    expect(w.company.agents.every((a) => a.desk === undefined)).toBe(true);
    syncDesks(w);
    expectOneDeskEach(w);
    for (const d of w.company.departments) if (teamOf(w, d.id).length) expect(deskOf(w, d.chiefId)).toBe(0);
    const once = JSON.stringify(w);
    syncDesks(w);
    expect(JSON.stringify(w)).toBe(once);
  });

  it('lean team, 12 hires, 3 departures: nobody shares a desk, nobody moves, and a freed desk goes back lowest first', () => {
    const w = leanWorld();
    syncDesks(w);
    for (let i = 0; i < 12; i++) hire(w, `h${i}`, i % 2 ? 'studio' : 'growth');
    syncDesks(w);
    expectOneDeskEach(w);
    expect(teamOf(w, 'studio').map((a) => a.desk).sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const before = desks(w);
    const high = defOf(w, 'studio').deskHigh;
    expect(high).toBe(7);
    for (const id of ['h3', 'h1', 'h4']) leave(w, id);
    syncDesks(w);
    expect(desks(w)).toEqual(Object.fromEntries(Object.entries(before).filter(([id]) => !['h3', 'h1', 'h4'].includes(id))));
    expect(defOf(w, 'studio').deskHigh).toBe(high); // an island never shrinks

    hire(w, 'late1', 'studio');
    hire(w, 'late2', 'studio');
    syncDesks(w);
    expect([deskOf(w, 'late1'), deskOf(w, 'late2')]).toEqual([before.h1, before.h3].sort((a, b) => a! - b!));
    expectOneDeskEach(w);
  });

  it('the same id with a new person keeps the desk', () => {
    const w = leanWorld();
    hire(w, 'seat', 'studio');
    syncDesks(w);
    const desk = deskOf(w, 'seat');
    Object.assign(w.company.agents.find((a) => a.id === 'seat')!, { name: 'Une autre', persona: 'Quelqu’un d’autre.' });
    syncDesks(w);
    expect(deskOf(w, 'seat')).toBe(desk);
  });

  it('a new chief takes desk 0, the old one takes the new chief\'s desk, and nobody else moves', () => {
    const w = leanWorld();
    for (const id of ['a', 'b', 'c']) hire(w, id, 'studio');
    syncDesks(w);
    const before = desks(w);
    const old = defOf(w, 'studio').chiefId;
    defOf(w, 'studio').chiefId = 'b';
    syncDesks(w);
    expect(deskOf(w, 'b')).toBe(0);
    expect(deskOf(w, old)).toBe(before.b);
    expect(desks(w)).toEqual({ ...before, b: 0, [old]: before.b });
  });

  it('a chief who arrives without a desk sends the old holder to the lowest free one', () => {
    const w = leanWorld();
    hire(w, 'a', 'studio');
    syncDesks(w);
    const old = defOf(w, 'studio').chiefId;
    hire(w, 'boss', 'studio');
    defOf(w, 'studio').chiefId = 'boss';
    syncDesks(w);
    expect([deskOf(w, 'boss'), deskOf(w, 'a'), deskOf(w, old)]).toEqual([0, 1, 2]);
  });

  it('two people on one desk: the first in the team keeps it', () => {
    const w = leanWorld();
    for (const id of ['a', 'b']) hire(w, id, 'studio');
    syncDesks(w);
    w.company.agents.find((a) => a.id === 'b')!.desk = deskOf(w, 'a')!;
    syncDesks(w);
    expectOneDeskEach(w);
    expect(deskOf(w, 'b')).toBe(2);
  });

  it('a save older than desks gets them on its first tick, in team order', () => {
    const w = createWorld(defaultScenario({ ...LEGACY, seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-desks');
    syncDesks(w);
    for (const d of w.company.departments) {
      const team = teamOf(w, d.id);
      const others = team.filter((a) => a.id !== d.chiefId);
      expect(others.map((a) => a.desk), d.id).toEqual(others.map((_, i) => i + (team.length > others.length ? 1 : 0)));
    }
  });
});

describe('a real run', () => {
  async function play(ticks: number, twice: boolean): Promise<string> {
    const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 60 }), 'test-desks');
    const root = mkdtempSync(join(tmpdir(), 'pixel-desks-'));
    roots.push(root);
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
    for (let i = 0; i < ticks; i++) {
      await company.step();
      if (twice) syncDesks(world);
    }
    expectOneDeskEach(world);
    return JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));
  }

  it('draws nothing: 25 days with syncDesks called twice per step stay byte-identical', async () => {
    const ticks = 25 * TICKS_PER_DAY;
    const [once, twice] = [await play(ticks, false), await play(ticks, true)];
    expect(twice).toBe(once);
    expect(once).toContain('"desk":0');
    expect(once).toContain('"deskHigh":');
  });
});
