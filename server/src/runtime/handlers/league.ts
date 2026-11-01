/** RH: the close of a season, and a replacement or a layoff the founder signed. A ritual never waits for the founder: what needs a yes comes back here as a normal task (D48). */
import { decidedLayoff, layOff, layoffAsk, layoffTarget } from '../org/departure.js';
import { closeSeason } from '../talent/season.js';
import { confirmSwap, decidedSwap, swapAsk } from '../talent/challenge.js';
import type { HandlerMap } from './common.js';

export const leagueHandlers: HandlerMap = {
  league_review: {
    async run(ctx, task) {
      const layoff = decidedLayoff(task);
      if (layoff) {
        const target = layoffTarget(ctx.world, layoff);
        if (!target) return { summary: 'Licenciement sans objet : la situation a changé depuis la demande.', skipReview: true, output: { left: null } };
        if (task.input.founderApproved !== true) return { summary: 'Licenciement décidé : il attend l\'accord du fondateur.', awaitFounder: layoffAsk(ctx.world, target, layoff) };
        await layOff(ctx, target, layoff.why);
        return { summary: `${target.name} quitte l'agence.`, skipReview: true, output: { left: target.id } };
      }
      const decided = decidedSwap(task);
      if (!decided) {
        const report = await closeSeason(ctx);
        return { summary: `Saison ${report.season} close : ${report.probations.length} plan(s), ${report.hires.length} remplacement(s).`, output: { season: report.season, employee: report.employee?.agentId ?? null } };
      }
      if (ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: 'Remplacement décidé : il attend l\'accord du fondateur.', awaitFounder: swapAsk(ctx, decided) };
      }
      const hire = await confirmSwap(ctx, decided);
      return { summary: hire ? `${hire.name} prend le poste.` : 'Remplacement sans objet : la situation a changé depuis la demande.', skipReview: true, output: { hired: hire?.id ?? null } };
    },
  },
};
