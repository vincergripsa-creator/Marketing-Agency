/** The growth pillar: what a week closes. Monday's CFO, stage and portfolio land with P10.1, behind growthOn. */
import type { ArchiveBatch } from '../contracts.js';
import type { CompanyState, GrowthState, WorldState } from '../shared.js';
import { compactWorld } from './compaction.js';
import type { RuntimeCtx } from './ctx.js';
import { weeklyNote, weekRollup } from './digest.js';
import type { Pillar } from './pillars.js';

export function emptyGrowth(w: WorldState): GrowthState {
  return {
    stage: 'survie', stageSinceDay: w.day, gateWeeks: 0, floorWeeks: 0, gate: null,
    allocation: null, portfolio: null, niches: {}, weeks: [], decisions: [], ltvFactor: 1,
    founder: { lastSeenDay: w.day, lastSeenAt: null },
  };
}

/**
 * The rows have left the world by now, so a disk that refuses them must not fail the tick: the retry would find nothing to archive
 * and play the evening twice. What it refused waits in the world, a reload included, and goes first next Sunday.
 */
async function archiveBatches({ world, archive }: RuntimeCtx, batch: ArchiveBatch): Promise<void> {
  const queue: ArchiveBatch[] = [...(world.company.archivePending ?? []), batch];
  delete world.company.archivePending;
  for (const [i, next] of queue.entries()) {
    try {
      await archive?.(next);
    } catch (err) {
      console.error(`[archive] ${world.runId}, jour ${next.day} : ${(err as Error).message}. Nouvel essai dimanche prochain.`);
      world.company.archivePending = queue.slice(i) as NonNullable<CompanyState['archivePending']>;
      return;
    }
  }
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
    await archiveBatches(ctx, compactWorld(w)); // outside the optional call, or a run with no archive would never compact
    if (week) await weeklyNote(ctx, week);
  },
};
