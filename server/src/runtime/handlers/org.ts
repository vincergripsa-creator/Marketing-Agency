/** RH: the review of the team and the recruiting behind each position (org §9). */
import { ROLES } from '../org/catalog.js';
import { payOfTier } from '../org/constants.js';
import { bestCandidate, cancelPosition, checkGates, hireAgent, positionOf, reviewHeadcount } from '../org/hiring.js';
import { eur, round2 } from '../util.js';
import type { HandlerMap } from './common.js';

const NOTHING = { skipReview: true, output: { skipped: true } };

export const orgHandlers: HandlerMap = {
  headcount_review: {
    async run(ctx) {
      const { agents, org } = ctx.world.company;
      return { summary: reviewHeadcount(ctx), output: { headcount: agents.length, pressure: org?.pressure ?? [] } };
    },
  },

  recruit: {
    async run(ctx, task, agent) {
      const w = ctx.world;
      const position = positionOf(w, task);
      if (!position || position.status !== 'open') return { summary: 'Poste déjà fermé : rien à faire.', ...NOTHING };
      const best = await bestCandidate(ctx, position);
      const check = checkGates(w, position.roleId, position.reason, position);
      if (!check.ok) {
        cancelPosition(ctx, position, check);
        return { summary: `Poste annulé : ${check.why ?? 'le moment est passé'}.`, ...NOTHING };
      }
      const { title } = ROLES[position.roleId];
      if (w.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: `${best.name} attend l'accord du fondateur.`, awaitFounder: `Embaucher ${best.name} (${title}) à ${eur(round2(payOfTier(best.tier) * 30))}/mois` };
      }
      return { summary: `${agent.name} retient ${best.name} (${best.interview}/100 au test) pour le poste : ${title}.`, skipReview: true, output: { positionId: position.id, candidateId: best.id } };
    },
    async onDone(ctx, task) {
      const position = positionOf(ctx.world, task);
      const chosen = position?.candidates.find((c) => c.id === task.output?.candidateId);
      if (position && chosen) await hireAgent(ctx, position, chosen);
    },
  },
};
