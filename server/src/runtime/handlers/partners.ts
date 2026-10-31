/** Partenariats: find small creators (anti-fraud screening) and negotiate commission-first deals. */
import type { CreatorProfile, Product, WorldState } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { incident, nameOf, productOf, say } from '../ctx.js';
import { advancesHold } from '../holds.js';
import { currentBudget, type Budget } from '../metrics.js';
import { learning, sim } from '../modules.js';
import { productNote } from '../notes.js';
import { officerId } from '../org/officers.js';
import { createTask } from '../tasks.js';
import { clamp, eur, pct, round2, short, str, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { NO_PRODUCT, requireProduct } from './common.js';

/** Where honest profiles stay, on public numbers. Each signal alone is noisy; two together are a pattern. */
export const CREATOR_NORMS = { minViewRate: 0.08, minEngagement: 0.03, maxPricePerKViews: 30, minCommission: 0.2 } as const;
export const SIGNALS_TO_DECLINE = 2;
/** What an advance is swapped for, at most: a creator who wanted cash gets a better commission. */
export const ADVANCE_SWAP_COMMISSION = 0.1;
/** Days before a delivered deal's results are read: its video keeps selling for a few days. */
export const CREATOR_RESULT_DAYS = 7;
/** Share of the cash an advance may never exceed (Budget et garde-fous). */
const MAX_ADVANCE_CASH_SHARE = 0.1;

/** What a public profile gives away: views for its audience, engagement, price of its reach, how little it asks on results. */
export function profileSignals(c: CreatorProfile): string[] {
  const out: string[] = [];
  if (c.followers > 0 && c.avgViews / c.followers < CREATOR_NORMS.minViewRate) out.push('peu de vues pour son nombre d’abonnés');
  if (c.engagement < CREATOR_NORMS.minEngagement) out.push('engagement faible');
  if (c.askUpfront > 0 && c.avgViews > 0 && (c.askUpfront * 1000) / c.avgViews > CREATOR_NORMS.maxPricePerKViews) out.push('prix élevé pour 1 000 vues');
  if (c.askCommission < CREATOR_NORMS.minCommission) out.push('commission demandée anormalement basse');
  return out;
}

/** Why this creator is declined, empty when not: a scam tell, or two signals (a soft red flag counts as one). */
export function fraudSignals(c: CreatorProfile): string[] {
  const tells = c.redFlags.filter((f) => sim.isScamFlag(f));
  if (tells.length) return tells;
  const signals = [...c.redFlags, ...profileSignals(c)];
  if (c.engagement > 0.25) signals.push('engagement trop beau pour être vrai');
  return signals.length >= SIGNALS_TO_DECLINE ? signals : [];
}

export interface CreatorRecord { salesPerKViews: number | null; advances: number; advanceRoi: number | null }

/** What past deals really brought: read only once a delivered video had time to sell. */
export function creatorRecord(world: WorldState): CreatorRecord {
  const profiles = new Map(world.market.creators.map((c) => [c.id, c]));
  const settled = world.market.partnerships.filter((p) => (p.status === 'delivered' || p.status === 'scam') && world.day - p.day >= CREATOR_RESULT_DAYS);
  const delivered = settled.filter((p) => p.status === 'delivered');
  const kViews = delivered.reduce((n, p) => n + (profiles.get(p.creatorId)?.avgViews ?? 0) / 1000, 0);
  const paid = settled.filter((p) => p.upfront > 0);
  const spent = paid.reduce((n, p) => n + p.upfront, 0);
  const earned = paid.reduce((n, p) => n + p.revenue * (1 - p.commission), 0);
  return {
    salesPerKViews: kViews > 0 ? delivered.reduce((n, p) => n + p.sales, 0) / kViews : null,
    advances: paid.length,
    advanceRoi: spent > 0 ? earned / spent : null,
  };
}

export interface AdvanceDecision { pay: boolean; why: string; expected: number | null }

/**
 * An advance is an investment: paid only if what this creator should bring, at the rate past creators really sold, covers
 * it. Without results to read, the lesson on advances, or past advances that did not pay back, it is commission only.
 */
export function advanceDecision(world: WorldState, c: CreatorProfile, product: Product, budget: Budget, commission: number): AdvanceDecision {
  const no = (why: string, expected: number | null = null): AdvanceDecision => ({ pay: false, why, expected });
  if (c.askUpfront <= 0) return no('aucune avance demandée');
  if (budget.survival || budget.bankrupt) return no('trésorerie trop basse');
  if (c.askUpfront > MAX_ADVANCE_CASH_SHARE * budget.cash) return no('avance au-dessus de 10 % de la trésorerie');
  if (profileSignals(c).length) return no('profil à confirmer');
  if (world.company.lessons.some((l) => l.key === learning.LESSON_KEYS.advance)) return no('la leçon sur les avances vaut : commission seulement');
  const record = creatorRecord(world);
  if (record.advanceRoi !== null && record.advanceRoi < 1) return no(`nos avances ne se sont pas remboursées (${Math.round(record.advanceRoi * 100)} %)`);
  if (record.salesPerKViews === null) return no('aucun résultat de créateur observé à ce jour');
  const expected = (c.avgViews / 1000) * record.salesPerKViews * product.price * (1 - commission);
  if (expected < c.askUpfront) return no(`il devrait rapporter ${eur(expected)} pour ${eur(c.askUpfront)} d'avance`, expected);
  return { pay: true, why: `il devrait rapporter ${eur(expected)} pour ${eur(c.askUpfront)} d'avance`, expected };
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
      // Who refused any commission deal has shown he only wants the cash: never again, whatever the product.
      const cashOnly = new Set(ctx.world.company.tasks.filter((t) => t.kind === 'negotiate_deal' && t.output?.cashOnly === true).map((t) => str(t.input.creatorId)));
      const creators = listCreators(ctx, product.nicheId).filter((c) => !already.has(c.id) && !cashOnly.has(c.id));
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
          input: { productId: product.id, nicheId: product.nicheId, creatorId }, createdBy: officerId(ctx.world, 'partners'), missionId: task.missionId, priority: 2,
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
      const held = advancesHold(ctx.world);
      const advance = held ? { pay: false, why: held.reason, expected: null } : advanceDecision(ctx.world, creator, product, budget, commission);
      const upfront = advance.pay ? round2(creator.askUpfront) : 0;
      const finalCommission = creator.askUpfront > 0 && !advance.pay ? round2(Math.min(0.5, commission + ADVANCE_SWAP_COMMISSION)) : commission;
      if (creator.askUpfront > 0) say(ctx, agent.id, `${agent.name} : ${advance.pay ? 'avance acceptée' : 'pas d’avance'} pour @${creator.handle} — ${short(advance.why, 80)}`, 'thought', { productId: product.id });
      if (upfront > 0 && ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: `Deal prêt avec @${creator.handle} (${eur(upfront)} d'avance + ${pct(finalCommission, 0)}) : en attente du fondateur.`, awaitFounder: `Payer ${eur(upfront)} d'avance à @${creator.handle}` };
      }
      const text = await ctx.engine.writeOutreach({ creator, product, offer: { upfront, commission: finalCommission } }, mind);
      const res = ctx.tools.proposePartnership({ creatorId: creator.id, productId: product.id, upfront, commission: finalCommission });
      const cashOnly = !res.ok && /rien à la commission/i.test(res.message);
      const deal = upfront > 0 ? `${eur(upfront)} d'avance + ${pct(finalCommission, 0)}` : `commission seule ${pct(finalCommission, 0)}`;
      say(ctx, agent.id, `${agent.name} propose à @${creator.handle} : ${deal} — ${res.ok ? short(res.message || 'proposition envoyée', 60) : 'refusé'}`, 'thought', { productId: product.id });
      if (!res.ok) incident(ctx, `@${creator.handle} refuse le partenariat (${deal}) : ${res.message}`);
      if (cashOnly) say(ctx, agent.id, `${agent.name} raye @${creator.handle} de la liste : il ne veut que de l'argent d'avance, le profil type de l'arnaque`, 'thought', { productId: product.id });
      await productNote(ctx, product, agent.id, 'Partenariat', `- @${creator.handle} (${creator.followers} abonnés, ${creator.avgViews} vues moyennes) : ${deal} → ${res.ok ? 'proposé' : 'refusé'}\n\n> ${short(text, 400)}`);
      return {
        summary: `Proposition à @${creator.handle} : ${deal}${res.ok ? '' : ' (refusée)'}.`,
        output: { creatorId: creator.id, upfront, commission: finalCommission, ok: res.ok, partnershipId: res.id ?? null, message: text, negotiator: nameOf(ctx, agent.id), advanceWhy: advance.why, cashOnly },
      };
    },
  },
};
