/** Partenariats: find small creators (anti-fraud screening) and negotiate commission-first deals. */
import type { CreatorProfile } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { incident, nameOf, productOf, say } from '../ctx.js';
import { currentBudget } from '../metrics.js';
import { productNote } from '../notes.js';
import { createTask } from '../tasks.js';
import { clamp, eur, pct, round2, short, str, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct } from './common.js';

/** Visible fraud signals (declared red flags + suspicious ratios). */
export function fraudSignals(c: CreatorProfile): string[] {
  const out = [...c.redFlags];
  if (c.followers > 0 && c.avgViews / c.followers < 0.02) out.push('vues très faibles pour le nombre d’abonnés');
  if (c.engagement > 0.25) out.push('engagement trop beau pour être vrai');
  if (c.askUpfront > 0 && c.avgViews > 0 && c.askUpfront / c.avgViews > 0.05) out.push('avance démesurée par rapport aux vues');
  return out;
}

function creatorScore(c: CreatorProfile): number {
  const reach = Math.log10(Math.max(10, c.avgViews));
  const engagement = clamp(c.engagement / 0.08, 0, 1.5);
  const cheap = c.askUpfront === 0 ? 1.4 : 1;
  return reach * (0.6 + engagement) * cheap;
}

function listCreators(ctx: RuntimeCtx, nicheId: string): CreatorProfile[] {
  try { return ctx.tools.listCreators(nicheId); } catch { return ctx.world.market.creators.filter((c) => c.nicheId === nicheId); }
}

export const partnerHandlers: HandlerMap = {
  find_creators: {
    async run(ctx, task, agent) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const already = new Set(ctx.world.market.partnerships.filter((p) => p.productId === product.id).map((p) => p.creatorId));
      const creators = listCreators(ctx, product.nicheId).filter((c) => !already.has(c.id));
      const rejected: { handle: string; reasons: string[] }[] = [];
      const clean: CreatorProfile[] = [];
      for (const c of creators) {
        const flags = fraudSignals(c);
        if (flags.length) rejected.push({ handle: c.handle, reasons: flags }); else clean.push(c);
      }
      const picks = clean.sort((a, b) => creatorScore(b) - creatorScore(a)).slice(0, 2);
      if (rejected[0]) say(ctx, agent.id, `${agent.name} écarte @${rejected[0].handle} : ${short(rejected[0].reasons.join(', '), 70)}`, 'thought', { productId: product.id });
      if (!picks.length) return { summary: `${creators.length} créateur(s) examiné(s), aucun profil fiable.`, skipReview: true, output: { candidates: [], rejected } };
      say(ctx, agent.id, `${agent.name} présélectionne ${picks.map((c) => `@${c.handle}`).join(' et ')} pour « ${short(product.title, 40)} »`, 'thought', { productId: product.id });
      return {
        summary: `${picks.length} créateur(s) retenu(s) sur ${creators.length}, ${rejected.length} écarté(s) pour signaux d'alerte.`,
        output: { candidates: picks.map((c) => c.id), rejected },
      };
    },
    async onDone(ctx, task) {
      const product = productOf(ctx, task.input.productId);
      if (!product || product.status === 'killed') return;
      for (const creatorId of strArr(task.output?.candidates)) {
        const c = ctx.world.market.creators.find((x) => x.id === creatorId);
        createTask(ctx.world, {
          kind: 'negotiate_deal', title: `Négocier avec @${c?.handle ?? creatorId} — « ${short(product.title, 36)} »`,
          input: { productId: product.id, nicheId: product.nicheId, creatorId }, createdBy: 'rayan', missionId: task.missionId, priority: 2,
        });
      }
    },
  },

  negotiate_deal: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const creatorId = str(task.input.creatorId);
      const creator = creatorId ? listCreators(ctx, product.nicheId).find((c) => c.id === creatorId) ?? ctx.world.market.creators.find((c) => c.id === creatorId) : undefined;
      if (!creator) return { summary: 'Créateur introuvable.', skipReview: true, output: { skipped: true } };
      const flags = fraudSignals(creator);
      if (flags.length) {
        say(ctx, agent.id, `${agent.name} refuse de signer avec @${creator.handle} : ${short(flags.join(', '), 70)}`, 'thought', { productId: product.id });
        return { summary: `Pas de deal : ${flags.join(', ')}.`, skipReview: true, output: { skipped: true, flags } };
      }
      const budget = currentBudget(ctx.world);
      const commission = round2(clamp(Math.max(creator.askCommission, 0.2), 0.15, 0.5));
      const upfrontOk = creator.askUpfront > 0 && !budget.survival && !budget.bankrupt && creator.askUpfront <= 0.1 * budget.cash;
      const upfront = upfrontOk ? round2(creator.askUpfront) : 0;
      const finalCommission = creator.askUpfront > 0 && !upfrontOk ? round2(Math.min(0.5, commission + 0.1)) : commission;
      if (upfront > 0 && ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: `Deal prêt avec @${creator.handle} (${eur(upfront)} d'avance + ${pct(finalCommission, 0)}) : en attente du fondateur.`, awaitFounder: `Payer ${eur(upfront)} d'avance à @${creator.handle}` };
      }
      const text = await ctx.engine.writeOutreach({ creator, product, offer: { upfront, commission: finalCommission } }, mind);
      const res = ctx.tools.proposePartnership({ creatorId: creator.id, productId: product.id, upfront, commission: finalCommission });
      const deal = upfront > 0 ? `${eur(upfront)} d'avance + ${pct(finalCommission, 0)}` : `commission seule ${pct(finalCommission, 0)}`;
      say(ctx, agent.id, `${agent.name} propose à @${creator.handle} : ${deal} — ${res.ok ? short(res.message || 'proposition envoyée', 60) : 'refusé'}`, 'thought', { productId: product.id });
      if (!res.ok) incident(ctx, `@${creator.handle} refuse le partenariat (${deal}) : ${res.message}`);
      await productNote(ctx, product, agent.id, 'Partenariat', `- @${creator.handle} (${creator.followers} abonnés, ${creator.avgViews} vues moyennes) : ${deal} → ${res.ok ? 'proposé' : 'refusé'}\n\n> ${short(text, 400)}`);
      return {
        summary: `Proposition à @${creator.handle} : ${deal}${res.ok ? '' : ' (refusée)'}.`,
        output: { creatorId: creator.id, upfront, commission: finalCommission, ok: res.ok, partnershipId: res.id ?? null, message: text, negotiator: nameOf(ctx, agent.id) },
      };
    },
  },
};
