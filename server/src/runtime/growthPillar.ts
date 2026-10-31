/** The growth pillar: Monday's CFO, stage and portfolio and the list's morning behind growthOn, and what a week closes, in both arms. */
import type { ArchiveBatch } from '../contracts.js';
import type { CompanyState, GrowthState, WorldState } from '../shared.js';
import { audienceMorning, queueLaunch, refuseEmail, rewardAngles } from './audience.js';
import { cfoMonday } from './cfo.js';
import { compactWorld } from './compaction.js';
import type { RuntimeCtx } from './ctx.js';
import { weeklyNote, weekRollup } from './digest.js';
import { officerId } from './org/officers.js';
import type { Pillar } from './pillars.js';
import { advanceStage, dropStage, growthOn } from './stages.js';

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

/**
 * The Sundays this evening rolls: today's, again if a failed tick plays it twice, and any whose evening never ran. The next evening
 * closes those while their rows are still raw: past `COMPACT.ledgerDays` nothing could, and the week's money would leave every digest.
 */
function sundaysDue(w: WorldState): number[] {
  const days: number[] = [];
  for (let day = (w.company.growth?.weeks.at(-1)?.toDay ?? 0) + 7; day < w.day; day += 7) days.push(day);
  return w.day % 7 === 0 ? [...days, w.day] : days;
}

export const growthPillar: Pillar = {
  // Every version 2 world, scaling or not: growthOn gates decisions, the rollup writes in both arms (D54).
  mount(w) {
    w.company.growth ??= emptyGrowth(w);
  },
  async morning(ctx) {
    const w = ctx.world;
    if (!growthOn(w)) return;
    // A tick that failed plays its morning again: the same Monday must not count as a second check of a gate.
    if (w.day % 7 !== 1 || w.company.growth?.allocation?.day === w.day) dropStage(ctx);
    else {
      cfoMonday(ctx);
      advanceStage(ctx);
      await ctx.ritual('portfolio_review', officerId(w, 'ceo'), `Revue du portefeuille, semaine ${Math.ceil(w.day / 7)}`);
    }
    await audienceMorning(ctx);
  },
  marketClosed(ctx) {
    if (growthOn(ctx.world)) rewardAngles(ctx);
  },
  taskDone(ctx, task) {
    if (task.kind === 'publish_product') queueLaunch(ctx, task);
  },
  refused: refuseEmail,
  async eveningEnd(ctx) {
    const w = ctx.world;
    const weeks = sundaysDue(w).map((day) => weekRollup(w, day - 6, day));
    w.company.growth?.weeks.push(...weeks);
    if (w.day % 7 === 0) await archiveBatches(ctx, compactWorld(w)); // outside the optional call, or a run with no archive would never compact
    for (const week of weeks) await weeklyNote(ctx, week);
  },
};
