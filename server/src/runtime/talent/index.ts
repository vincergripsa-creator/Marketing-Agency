/** The talent pillar: the hooks of §2.5, wired once and asleep while talentMode says 'off'. */
import { officerId } from '../org/officers.js';
import type { Pillar } from '../pillars.js';
import { swapRefused } from './challenge.js';
import { craftFor } from './craft.js';
import { scheduleDuel, settleDuels } from './duels.js';
import { applyDailyEvidence, onDone, onReviewed } from './evidence.js';
import { dueSeasonClose } from './season.js';
import { leagueSeats, primaryOf } from './skills.js';
import { coachTick, emptyLeague, practice, sampleTalent, seedTruth, talentMode } from './truth.js';

export * from './challenge.js';
export * from './constants.js';
export * from './craft.js';
export * from './duels.js';
export * from './evidence.js';
export * from './season.js';
export * from './skills.js';
export * from './truth.js';

export const talentPillar: Pillar = {
  mount(w) {
    if (talentMode(w) === 'off') return;
    w.talentTruth ??= seedTruth(w);
    w.company.league ??= emptyLeague(w);
    for (const a of leagueSeats(w)) { // an older save holds the primary of its day
      const entry = w.company.league.entries[a.id];
      if (entry) entry.primary = primaryOf(a.roleId);
    }
  },
  async morning(ctx) {
    if (talentMode(ctx.world) === 'off') return;
    scheduleDuel(ctx);
    coachTick(ctx.world);
  },
  reviewed(ctx, task, res) {
    if (talentMode(ctx.world) !== 'off') onReviewed(ctx, task, res);
  },
  taskDone(ctx, task) {
    if (talentMode(ctx.world) !== 'off') onDone(ctx, task);
  },
  mind(ctx, task, agent) {
    const craft = craftFor(ctx.world, agent, task.kind);
    return craft ? { craft } : {};
  },
  async evening(ctx) {
    const w = ctx.world;
    if (talentMode(w) === 'off') return;
    applyDailyEvidence(w, w.day);
    practice(w);
    sampleTalent(w);
    settleDuels(ctx);
    if (dueSeasonClose(w)) await ctx.ritual('league_review', officerId(w, 'hr'), `Clôture de la saison ${w.company.league?.season ?? 1}`);
  },
  refused(ctx, task) {
    if (task.kind === 'league_review') swapRefused(ctx, task);
  },
};
