/**
 * The pillar seam. company.ts is the hottest file of the repo: after S2 no pillar touches it again, it calls these fixed
 * hooks in the fixed order of PILLARS. A hook draws from no stream it does not own, and a pillar with nothing to say on
 * a legacy run says nothing: the golden run must not see them.
 */
import type { AgentId, AgentState, Task, TaskKind, WorldState } from '../shared.js';
import type { MindContext } from '../contracts.js';
import type { RuntimeCtx } from './ctx.js';
import { channelsPillar } from './channels.js';
import { desksPillar } from './desks.js';
import { growthPillar } from './growthPillar.js';
import { orgPillar } from './org/index.js';
import { talentPillar } from './talent/index.js';

export interface Worked { agentId: AgentId; taskId: string; kind: TaskKind; review?: boolean }

export interface Pillar {
  mount?(world: WorldState): void;                                    // end of the Company constructor. No draw. Migrations, ensure*
  morning?(ctx: RuntimeCtx): Promise<void>;                           // after budget_review and reactToOutage, before buildHeuristicPlan
  worked?(ctx: RuntimeCtx, worked: Worked[]): void;                   // end of workTick. Reviewers too: ownerUtil counts them
  marketClosed?(ctx: RuntimeCtx): void;                               // right after sim.tickMarket
  evening?(ctx: RuntimeCtx): Promise<void>;                           // after performance_review, before closeMissions
  eveningEnd?(ctx: RuntimeCtx): Promise<void>;                        // last line of evening()
  reviewed?(ctx: RuntimeCtx, task: Task, res: { verdict: string; score: number | null }): void; // after reviewTask, before the verdict is applied
  taskDone?(ctx: RuntimeCtx, task: Task): void;                       // in finishTask, before spec.onDone
  refused?(ctx: RuntimeCtx, task: Task): void;                        // approve(id, false), after honourRefusal. No draw
  mind?(ctx: RuntimeCtx, task: Task, agent: AgentState): Partial<MindContext>; // merged in runHandler, both branches
  stepEnd?(world: WorldState): void;                                  // end of stepNow
}

export const PILLARS: readonly Pillar[] = [orgPillar, growthPillar, channelsPillar, talentPillar, desksPillar];
