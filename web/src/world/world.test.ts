// Pure-logic tests of the world module (no DOM needed): grid layout, mock data, time of day.
// Run: cd server && npx vitest run --root ../web/src/world
import { describe, expect, it } from 'vitest';
import type { DeptDef } from '../../../shared/types';
import { effectiveGrid } from './layout';
import { mockSnapshot } from './mockSnapshot';
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
  it('has 31 agents in 11 departments with unique ids', () => {
    expect(s.company.agents).toHaveLength(31);
    expect(s.company.departments).toHaveLength(11);
    expect(new Set(s.company.agents.map((a) => a.id)).size).toBe(31);
    const depts = new Set(s.company.departments.map((d) => d.id));
    for (const a of s.company.agents) expect(depts.has(a.dept)).toBe(true);
    for (const d of s.company.departments) {
      expect(Math.abs(d.grid.col)).toBeLessThanOrEqual(3);
      expect(Math.abs(d.grid.row)).toBeLessThanOrEqual(3);
      expect(s.company.agents.find((a) => a.id === d.chiefId)?.isChief).toBe(true);
    }
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
