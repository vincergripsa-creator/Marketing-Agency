/** Who holds an office today. The legacy holders stand in on any world without `company.org`. */
import type { AgentId, AgentState, Office, RoleId, TaskKind, WorldState } from '../../shared.js';

export const LEGACY_OFFICES: Record<Office, AgentId> = {
  ceo: 'camille', chief_of_staff: 'hugo', cfo: 'gabriel', accountant: 'alice', hr: 'nora', analyst: 'raphael', research: 'nadia', editor: 'elise',
  fact_checker: 'samuel', art: 'zoe', growth: 'leo', shop: 'clara', pricing: 'paul', support: 'ines', partners: 'rayan', red_team: 'axel',
};

export function officerId(w: WorldState, o: Office): AgentId {
  return w.company.org?.offices[o] ?? LEGACY_OFFICES[o];
}

export function officerOf(w: WorldState, o: Office): AgentState {
  const id = officerId(w, o);
  const agent = w.company.agents.find((a) => a.id === id);
  if (!agent) throw new Error(`Office sans titulaire : ${o}`);
  return agent;
}

/** The reviewers of today live in tasks.ts until P1.1 moves them to REVIEW_OFFICE: nothing calls this before. */
export function reviewerFor(_w: WorldState, _kind: TaskKind): AgentId | null {
  throw new Error('not landed');
}

export function ownersOfAny(w: WorldState, kinds: readonly TaskKind[]): AgentState[] {
  return w.company.agents.filter((a) => kinds.some((k) => a.taskKinds.includes(k)));
}

export function roleHolders(w: WorldState, role: RoleId): AgentState[] {
  return w.company.agents.filter((a) => a.roleId === role);
}
