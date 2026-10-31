// Pure-logic tests of the world module (no DOM needed): grid layout, mock data, time of day.
// Run: cd server && npx vitest run --root ../web/src/world
import { describe, expect, it } from 'vitest';
import type { DeptDef, Office, TaskKind } from '../../../shared/types';
import { CANDIDATES, KIND_HATS, OFFICES, ROLES } from '../../../server/src/runtime/org/catalog';
import { DEPARTMENTS } from '../../../server/src/runtime/roster';
import { effectiveGrid } from './layout';
import { SCENE_ACTIONS, mockOrgState, mockSnapshot } from './mockSnapshot';
import { hourForTick, skyAt } from './scenery';
import { facingFrom, isoX, isoY, pointInPoly, toTile } from './iso';

const dept = (id: string, col: number, row: number): DeptDef => ({
  id: id as DeptDef['id'], name: id, color: '#888888', icon: id.toUpperCase(), description: '', chiefId: `${id}-chief`, grid: { col, row },
});

function connected(grid: Map<string, { col: number; row: number }>): boolean {
  const cells = new Set([...grid.values()].map((g) => `${g.col},${g.row}`));
  const seen = new Set(['0,0']);
  const q = [[0, 0]];
  while (q.length) {
    const [c, r] = q.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`;
      if (cells.has(k) && !seen.has(k)) {
        seen.add(k);
        q.push([c + dc, r + dr]);
      }
    }
  }
  return [...cells].every((k) => seen.has(k));
}

describe('effectiveGrid', () => {
  it('puts direction on the plaza and keeps valid positions', () => {
    const g = effectiveGrid([dept('direction', 2, 2), dept('recherche', 0, -1), dept('studio', -1, 0)]);
    expect(g.get('direction')).toEqual({ col: 0, row: 0 });
    expect(g.get('recherche')).toEqual({ col: 0, row: -1 });
    expect(g.get('studio')).toEqual({ col: -1, row: 0 });
  });

  it('resolves collisions and the plaza cell', () => {
    const g = effectiveGrid([dept('recherche', 0, 0), dept('studio', 1, 0), dept('creation', 1, 0)]);
    const cells = [...g.values()].map((p) => `${p.col},${p.row}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(connected(g)).toBe(true);
  });

  it('reconnects islands that float alone', () => {
    const g = effectiveGrid([dept('recherche', 3, 3), dept('studio', -3, 2), dept('growth', 0, 1)]);
    expect(connected(g)).toBe(true);
  });

  it('survives empty or broken input', () => {
    expect(effectiveGrid([]).get('direction')).toEqual({ col: 0, row: 0 });
    const broken = { ...dept('rh', 0, 0), grid: undefined as unknown as DeptDef['grid'] };
    const g = effectiveGrid([broken]);
    expect(g.has('rh')).toBe(true);
    expect(connected(g)).toBe(true);
  });
});

describe('mockSnapshot', () => {
  const s = mockSnapshot();
  const { agents, departments } = s.company;
  const org = mockOrgState();

  it('has unique people, in cells of the catalog', () => {
    expect(new Set(agents.map((a) => a.id)).size).toBe(agents.length);
    expect(new Set(agents.map((a) => a.name)).size).toBe(agents.length);
    for (const d of [...departments, ...s.scene!.closedDepts]) {
      expect(d.grid, d.id).toEqual(DEPARTMENTS.find((c) => c.id === d.id)!.grid);
    }
  });

  it('I1: every kind has a living owner', () => {
    for (const kind of Object.keys(KIND_HATS) as TaskKind[]) expect(agents.some((a) => a.taskKinds.includes(kind)), kind).toBe(true);
  });

  it('I2: every office resolves to a living agent', () => {
    for (const office of Object.keys(OFFICES) as Office[]) expect(agents.some((a) => a.id === org.offices[office]), office).toBe(true);
  });

  it('I3: every open department has a member and exactly one chief, who is that member', () => {
    for (const d of departments) {
      const members = agents.filter((a) => a.dept === d.id);
      expect(members.length, d.id).toBeGreaterThan(0);
      expect(members.filter((a) => a.isChief).map((a) => a.id), d.id).toEqual([d.chiefId]);
    }
  });

  it('I4: every agent sits in an open department, and the catalog is open or a vacant plot', () => {
    const open = new Set(departments.map((d) => d.id));
    for (const a of agents) expect(open.has(a.dept), a.id).toBe(true);
    const closed = s.scene!.closedDepts.map((d) => d.id);
    expect(closed.filter((id) => open.has(id))).toEqual([]);
    expect([...open, ...closed].sort()).toEqual(DEPARTMENTS.map((d) => d.id).sort());
    expect(org.closedDepts.map((d) => d.id)).toEqual(closed);
  });

  it('every kind an agent holds comes from their role or from a hat of the catalog', () => {
    for (const a of agents) {
      expect(a.dept, a.id).toBe(ROLES[a.roleId].dept);
      expect(a.taskKinds, a.id).toEqual([...ROLES[a.roleId].core, ...ROLES[a.roleId].assist, ...a.hatKinds]);
      for (const hat of a.hatKinds) expect(KIND_HATS[hat], `${a.id} ${hat}`).toContain(a.roleId);
    }
  });

  it('a closed department is carried by an open one, by whoever wears its hats', () => {
    for (const d of org.closedDepts) {
      const host = org.deptHost[d.id];
      expect(departments.some((x) => x.id === host), d.id).toBe(true);
      expect(agents.some((a) => a.dept === host && a.hatDepts.includes(d.id)), d.id).toBe(true);
    }
  });

  it('the org block keeps out of the snapshot, as in the stream', () => {
    expect(s.company.org).toBeUndefined();
    expect(org.load.map((l) => l.day)).toEqual(s.company.kpis.map((k) => k.day));
    expect(org.load.at(-1)!.headcount).toBe(agents.length);
    expect(org.positions.map((p) => p.status).sort()).toEqual(['filled', 'open']);
    expect(org.decisions.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(s.scene!.names)).toEqual(org.alumni.map((a) => a.id));
  });

  it('whatever the mock says someone did, that someone exists', () => {
    const c = s.company;
    const named = [
      ...c.tasks.flatMap((t) => [t.assignee, t.reviewer]), ...c.missions.flatMap((m) => [m.from, m.ownerId]),
      ...c.creatives.map((x) => x.createdBy), ...c.campaigns.map((x) => x.createdBy), ...c.deliverables.map((x) => x.createdBy),
      ...c.lessons.flatMap((l) => [l.source, ...l.appliesTo]), ...c.experiments.map((e) => e.owner), ...Object.keys(c.chats),
      ...s.market.inbox.flatMap((m) => m.thread.map((t) => t.from)), ...Object.keys(s.scene!.people), ...s.scene!.board.map((r) => r.agentId),
    ].filter((id): id is string => !!id && id !== 'customer' && id !== 'founder');
    const ids = new Set(agents.map((a) => a.id));
    expect(named.filter((id) => !ids.has(id))).toEqual([]);
    for (const a of agents) expect(c.playbooks[a.id], a.id).toBeDefined();
  });

  it('nobody reviews their own work, and a current task is one they hold', () => {
    for (const t of s.company.tasks) expect(t.reviewer, t.id).not.toBe(t.assignee);
    for (const a of agents.filter((x) => x.currentTaskId)) {
      const t = s.company.tasks.find((x) => x.id === a.currentTaskId);
      expect([t?.assignee, t?.reviewer], a.id).toContain(a.id);
    }
    for (const t of s.company.tasks) {
      if (t.assignee) expect(agents.find((a) => a.id === t.assignee)!.taskKinds, t.id).toContain(t.kind);
    }
  });

  it('hires are dated after the founders, founders stay on day 0', () => {
    for (const a of agents) {
      if (a.founder) expect(a.hiredDay, a.id).toBe(0);
      else expect(a.hiredDay, a.id).toBeGreaterThan(0);
    }
    expect(agents.filter((a) => a.founder).map((a) => a.id).sort()).toEqual(Object.values(CANDIDATES).filter((c) => c.founder).map((c) => c.id).sort());
  });

  it('a recruit is one more person of their role, wherever the department stands', () => {
    let next = s;
    for (let i = 0; i < 6; i++) next = SCENE_ACTIONS.find((a) => a.id === 'hire')!.apply(next);
    const added = next.company.agents.slice(agents.length);
    expect(new Set(next.company.agents.map((a) => a.id)).size).toBe(next.company.agents.length);
    for (const a of added) {
      expect(a.isChief, a.id).toBe(false);
      expect(a.dept, a.id).toBe(ROLES[a.roleId].dept);
    }
    const again = SCENE_ACTIONS.find((a) => a.id === 'hire')!.apply(SCENE_ACTIONS.find((a) => a.id === 'fire')!.apply(next));
    expect(new Set(again.company.agents.map((a) => a.id)).size).toBe(again.company.agents.length);
  });

  it('keeps finance and KPIs consistent', () => {
    const k = s.company.kpis;
    expect(k).toHaveLength(10);
    const last = k[k.length - 1];
    expect(last.cumulativeProfit).toBeCloseTo(s.finance.profit, 2);
    expect(s.finance.cash).toBeCloseTo(500 + s.finance.profit, 2);
    const sales = k.reduce((n, d) => n + d.sales, 0);
    expect(s.company.products[0].stats.sales).toBe(sales);
    const ledgerSum = s.ledger.reduce((n, e) => n + e.amount, 0);
    expect(ledgerSum).toBeCloseTo(s.finance.cash, 1);
  });

  it('contains varied statuses and the key activity kinds', () => {
    const statuses = new Set(s.company.agents.map((a) => a.status));
    for (const st of ['working', 'coffee', 'blocked', 'thinking', 'meeting', 'idle', 'reviewing', 'walking']) expect(statuses.has(st as never)).toBe(true);
    const kinds = new Set(s.activity.map((a) => a.kind));
    for (const k of ['delegate', 'brain_read', 'walk', 'coffee', 'deliverable']) expect(kinds.has(k as never)).toBe(true);
    const ids = new Set(s.company.agents.map((a) => a.id));
    for (const a of s.activity) {
      if (a.agentId) expect(ids.has(a.agentId)).toBe(true);
      if (a.toAgentId) expect(ids.has(a.toAgentId)).toBe(true);
    }
  });
});

describe('time of day', () => {
  it('maps ticks to a day that ends at night', () => {
    expect(hourForTick(0)).toBeLessThan(9);
    expect(hourForTick(11)).toBeGreaterThan(19);
    expect(skyAt(hourForTick(5)).night).toBe(0);
    expect(skyAt(23).night).toBeGreaterThan(0.9);
    expect(skyAt(19.8).sunset).toBeGreaterThan(0.9);
  });
});

describe('iso helpers', () => {
  it('projects and unprojects', () => {
    const p = toTile(isoX(3.5, -2), isoY(3.5, -2));
    expect(p.tx).toBeCloseTo(3.5);
    expect(p.ty).toBeCloseTo(-2);
    expect(facingFrom(1, 0)).toBe('se');
    expect(facingFrom(0, -1)).toBe('ne');
    expect(pointInPoly(0, 0, [[-1, -1], [1, -1], [1, 1], [-1, 1]])).toBe(true);
    expect(pointInPoly(2, 0, [[-1, -1], [1, -1], [1, 1], [-1, 1]])).toBe(false);
  });
});
