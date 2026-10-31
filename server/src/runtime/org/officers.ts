/** Who holds an office today, and who reads a kind's work. The legacy holders stand in on any world without `company.org`. */
import type { AgentId, AgentState, Office, RoleId, TaskKind, WorldState } from '../../shared.js';
import { agentLoad } from '../tasks.js';
import { LEGACY_OFFICES, OFFICES, REVIEW_OFFICE } from './catalog.js';

export { LEGACY_OFFICES };

export function officerId(w: WorldState, o: Office): AgentId {
  return w.company.org?.offices[o] ?? LEGACY_OFFICES[o];
}

export function officerOf(w: WorldState, o: Office): AgentState {
  const id = officerId(w, o);
  const agent = w.company.agents.find((a) => a.id === id);
  if (!agent) throw new Error(`Office sans titulaire : ${o}`);
  return agent;
}

/** The least loaded holder of the office's first role (ties by id), else whoever holds the office. No office reads the kind: nobody does. */
export function reviewerFor(w: WorldState, kind: TaskKind): AgentId | null {
  const office = REVIEW_OFFICE[kind];
  if (!office) return null;
  if (!w.company.org) return officerId(w, office); // a hand-built world: the legacy holders are all it knows
  const holders = roleHolders(w, OFFICES[office].roles[0]!);
  if (!holders.length) return officerId(w, office);
  const load = new Map(holders.map((a) => [a.id, agentLoad(w, a.id)]));
  return [...holders].sort((a, b) => load.get(a.id)! - load.get(b.id)! || a.id.localeCompare(b.id))[0]!.id;
}

export function ownersOfAny(w: WorldState, kinds: readonly TaskKind[]): AgentState[] {
  return w.company.agents.filter((a) => kinds.some((k) => a.taskKinds.includes(k)));
}

export function roleHolders(w: WorldState, role: RoleId): AgentState[] {
  return w.company.agents.filter((a) => a.roleId === role);
}
