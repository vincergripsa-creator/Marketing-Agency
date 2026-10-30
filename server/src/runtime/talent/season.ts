/** Seasons and routing (talent §6). Stub until P3.4, P3.5: no season closes, nobody is favoured. */
import type { AgentState, TaskKind, WorldState } from '../../shared.js';

export function dueSeasonClose(_w: WorldState): boolean {
  return false;
}

export function routeBonus(_w: WorldState, _a: AgentState, _kind: TaskKind): number {
  return 0;
}
