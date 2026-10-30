/** What talent changes in the work (talent §4). Stub until P3.1, P3.2: one draft, today's numbers. */
import type { AgentState, DailyAdStats, Skill, TaskKind, WorldState } from '../../shared.js';
import type { Craft, MindContext, Rng } from '../../contracts.js';
import type { RuntimeCtx } from '../ctx.js';

/** undefined when mode is 'off'. */
export function effectiveT(_w: WorldState, _a: AgentState, _skill: Skill): number | undefined {
  return undefined;
}

export function craftFor(_w: WorldState, _a: AgentState, _kind: TaskKind): Craft | undefined {
  return undefined;
}

export async function bestDraft<T>(_ctx: RuntimeCtx, _a: AgentState, mind: MindContext, _purpose: string, write: (m: MindContext) => Promise<T>, score: (d: T) => number): Promise<{ draft: T; drawn: number; realScore: number }> {
  const draft = await write(mind);
  return { draft, drawn: 1, realScore: score(draft) };
}

export function armSharp(_ctx: RuntimeCtx, _a: AgentState, _mind: MindContext, _purpose: string): { samples: number; rng: Rng } | undefined {
  return undefined;
}

/** Creatives this buyer drops: none. */
export function pruneRead(_rows: DailyAdStats[], _creativeIds: string[], _t: number): string[] {
  return [];
}

export function shrunkRoas(revenue: number, spend: number, _t: number): number {
  return spend > 0 ? revenue / spend : 0;
}
