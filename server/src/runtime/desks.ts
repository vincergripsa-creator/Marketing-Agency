/**
 * Stable desks of the pixel world (ui §2.1). `AgentState.desk` is an index inside the department, so a hire, a departure, a
 * reload or a second browser moves nobody. Runs at the end of every step, old saves included. No draw, no ledger line, no id.
 */
import type { AgentId, AgentState, DeptDef, DeptId, WorldState } from '../shared.js';
import type { Pillar } from './pillars.js';

function seat(team: readonly AgentState[], chiefId: AgentId | undefined): void {
  const taken = new Set<number>();
  for (const a of team) {
    if (a.desk === undefined) continue;
    if (taken.has(a.desk)) delete a.desk;
    else taken.add(a.desk);
  }
  const chief = team.find((a) => a.id === chiefId);
  if (chief && chief.desk !== 0) {
    const holder = team.find((a) => a.desk === 0);
    const old = chief.desk;
    chief.desk = 0;
    if (holder) {
      if (old === undefined) delete holder.desk;
      else holder.desk = old;
    }
  }
  const used = new Set(team.flatMap((a) => (a.desk === undefined ? [] : [a.desk])));
  let free = 0;
  for (const a of team) {
    if (a.desk !== undefined) continue;
    while (used.has(free)) free += 1;
    a.desk = free;
    used.add(free);
  }
}

export function syncDesks(world: WorldState): void {
  const teams = new Map<DeptId, AgentState[]>();
  for (const a of world.company.agents) {
    const team = teams.get(a.dept);
    if (team) team.push(a);
    else teams.set(a.dept, [a]);
  }
  const defs = new Map<DeptId, DeptDef>(world.company.departments.map((d) => [d.id, d]));
  for (const [id, team] of teams) {
    const def = defs.get(id);
    seat(team, def?.chiefId);
    if (def) def.deskHigh = Math.max(def.deskHigh ?? 0, ...team.map((a) => (a.desk ?? 0) + 1));
  }
}

export const desksPillar: Pillar = { stepEnd: syncDesks };
