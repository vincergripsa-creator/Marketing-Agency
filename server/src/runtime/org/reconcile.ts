/** The org state and its invariants (org §7). `legacyOrgState` stands, the rest is a stub until P2.1: one team, every kind at full speed, in its home department. */
import type { AgentState, DeptId, OrgState, TaskKind, WorldState } from '../../shared.js';
import { DEPARTMENTS } from '../roster.js';
import { KIND_META } from '../tasks.js';
import { LEGACY_OFFICES } from './officers.js';

export function reconcileOrg(_w: WorldState): void {
  /* P2.1 */
}

export function auditOrg(_w: WorldState): string[] {
  return [];
}

/** What a new world starts from, and what a save from before the org pillar stands for: the legacy offices, nothing open, nothing owed. */
export function legacyOrgState(w: WorldState): OrgState {
  return {
    offices: { ...LEGACY_OFFICES }, deptHost: {},
    closedDepts: DEPARTMENTS.filter((d) => !w.company.departments.some((x) => x.id === d.id)).map((d) => ({ ...d, grid: { ...d.grid } })),
    load: [], pressure: [], positions: [], decisions: [], alumni: [],
    lastHireDay: 0, lastLayoffDay: 0, lossDays: 0,
    stats: { hires: 0, departures: 0, layoffs: 0, lastResortHats: 0, violations: 0 },
  };
}

export function fitOf(a: AgentState, kind: TaskKind): 'core' | 'assist' | 'hat' {
  return a.hatKinds.includes(kind) ? 'hat' : 'core';
}

export function speedFor(_w: WorldState, _a: AgentState, _kind: TaskKind): number {
  return 1;
}

export function workFor(_w: WorldState, kind: TaskKind): number {
  return KIND_META[kind].work;
}

export function deptFor(_w: WorldState, kind: TaskKind): DeptId {
  return KIND_META[kind].dept;
}
