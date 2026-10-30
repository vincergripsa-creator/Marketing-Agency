/** The real test of a candidate (D16). Stub until P3.5: a role without a skill scores 50, and today every role is one. */
import type { Candidate, RoleId } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';

export async function scoreCandidates(_ctx: RuntimeCtx, _role: RoleId, candidates: Candidate[]): Promise<void> {
  for (const c of candidates) {
    c.interview = 50;
    c.deliverable = null;
  }
}
