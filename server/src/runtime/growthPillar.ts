/** The growth pillar: what a week closes. Monday's CFO, stage and portfolio land with P10.1, behind growthOn. */
import type { GrowthState, WorldState } from '../shared.js';
import { compactWorld } from './compaction.js';
import { weeklyNote, weekRollup } from './digest.js';
import type { Pillar } from './pillars.js';

export function emptyGrowth(w: WorldState): GrowthState {
  return {
    stage: 'survie', stageSinceDay: w.day, gateWeeks: 0, floorWeeks: 0, gate: null,
    allocation: null, portfolio: null, niches: {}, weeks: [], decisions: [], ltvFactor: 1,
    founder: { lastSeenDay: w.day, lastSeenAt: null },
  };
}

export const growthPillar: Pillar = {
  // Every version 2 world, scaling or not: growthOn gates decisions, the rollup writes in both arms (D54).
  mount(w) {
    w.company.growth ??= emptyGrowth(w);
  },
  async eveningEnd(ctx) {
    const w = ctx.world;
    if (w.day % 7 !== 0) return;
    const week = weekRollup(w, w.day - 6, w.day);
    if (week) w.company.growth?.weeks.push(week);
    const batch = compactWorld(w); // outside the optional call, or a run with no archive would never compact
    await ctx.archive?.(batch);
    if (week) await weeklyNote(ctx, week);
  },
};
