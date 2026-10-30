/** Leaving (org §10). Stub until P2.4: nobody can leave. */
import type { AgentId, Alumnus, TaskKind, WorldState } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';

export function canLeave(_w: WorldState, _id: AgentId): { ok: boolean; blockers: TaskKind[] } {
  return { ok: false, blockers: [] };
}

export async function requestDeparture(_ctx: RuntimeCtx, _id: AgentId, _reason: string, _by: AgentId, _kind: Alumnus['kind']): Promise<'left' | 'notice' | 'refused'> {
  return 'refused';
}

/** Only hireAgent and requestDeparture lead here, and neither does before P2.4. */
export async function completeDeparture(_ctx: RuntimeCtx, _id: AgentId): Promise<void> {
  throw new Error('not landed');
}

export async function layoffsEvening(_ctx: RuntimeCtx): Promise<void> {
  /* P2.4 */
}
