/** Salaries (org §5). Stub until P2.2: agents are free, as on a `payroll: false` team. */
import type { AgentState, ScenarioConfig, WorldState } from '../../shared.js';
import { round2 } from '../../core/index.js';
import { minStartingCash } from '../../sim/balance.js';
import type { RuntimeCtx } from '../ctx.js';
import { ORG } from './constants.js';

export function payOf(a: AgentState): number {
  return round2(ORG.payPerDay[a.tier] * (1 + ORG.levelRaise * (a.level - 1)));
}

export function payrollToday(_w: WorldState): number {
  return 0;
}

export function bookPayroll(_ctx: RuntimeCtx): void {
  /* P2.2 */
}

export function minRunCash(_s: Pick<ScenarioConfig, 'org'>): number {
  return minStartingCash();
}
