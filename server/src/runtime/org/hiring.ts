/** Positions, candidates, hires (org §9). Stub until P2.3: nobody asks, nobody is hired. */
import type { AgentId, AgentState, Candidate, Position, PositionReason, RoleId, Task } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';

export function requestRole(_ctx: RuntimeCtx, _role: RoleId, _reason: PositionReason, _detail: string): Position | null {
  return null;
}

export function openPosition(_ctx: RuntimeCtx, _role: RoleId, _reason: PositionReason, _detail: string, _replaces?: AgentId, _opts?: { noTask?: boolean }): Position | null {
  return null;
}

export function drawCandidates(_ctx: RuntimeCtx, _role: RoleId, _positionIndex: number, _n: number): Candidate[] {
  return [];
}

/** No position exists before P2.3, so nothing reaches it. */
export async function hireAgent(_ctx: RuntimeCtx, _position: Position, _c: Candidate): Promise<AgentState> {
  throw new Error('not landed');
}

export async function headcountEvening(_ctx: RuntimeCtx): Promise<void> {
  /* P2.3 */
}

/** The founder said no to a hire: the position closes and a `hiring` hold stands (D49). */
export function recruitRefused(_ctx: RuntimeCtx, _task: Task): void {
  /* P2.3 */
}
