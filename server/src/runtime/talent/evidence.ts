/** Ratings from evidence (talent §5). Stub until P3.4. */
import type { AgentId, EvidenceSource, Skill, Task, WorldState } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';

export function recordEvidence(_w: WorldState, _agentId: AgentId, _skill: Skill, _source: EvidenceSource, _s: number, _weight: number, _label: string, _opponent?: number, _x?: number): void {
  /* P3.4 */
}

export function onReviewed(_ctx: RuntimeCtx, _task: Task, _res: { verdict: string; score: number | null }): void {
  /* P3.4 */
}

export function onDone(_ctx: RuntimeCtx, _task: Task): void {
  /* P3.4 */
}

export function applyDailyEvidence(_w: WorldState, _day: number): void {
  /* P3.4 */
}
