/**
 * The CEO's heuristic daily plan: a state machine over the company situation
 *   no product → find a niche · building → unblock the chain · live → acquisition (ads, organic, creators)
 *   failing → kill + post-mortem + next niche · profitable → scale + upsell · low cash → survival mode.
 * Then the ContentEngine (Claude mode) may adjust it; the runtime materializes the plan into tasks.
 */
import type { DayPlanItem, DayPlan } from '../contracts.js';
import type { Product, Task, TaskKind } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { nameOf, productOf, say } from './ctx.js';
import { sim } from './modules.js';
import { activeCampaigns, claimedMessageIds, committedAdBudget, currentBudget, detectedComplaints, isUpsellProduct, productMetrics } from './metrics.js';
import { createProductPipeline, createUpsellPipeline, createV2Pipeline, excludedNiches, killProduct, openTasksForProduct, pauseProduct, resumePipeline } from './pipeline.js';
import { createTask, isOpen, KIND_META, logTask, openTasks, PLAN_KINDS, PRODUCT_KINDS } from './tasks.js';
import { openMessages, urgency } from './handlers/support.js';
import { experimentCandidate } from './handlers/ops.js';
import {
  ACQUISITION_KINDS, acquisitionCandidates, bestCandidate, companyPaidBlock, daysWithoutAds, isReworking, launchableCreatives,
  MAX_IDLE_DAYS, MIN_CAMPAIGN_BUDGET, productHealth, promotionBlock, versionSince as versionSinceOf,
} from './acquisition.js';

/**
 * Kill rule of a main product (after at least 7 days online): fewer than KILL_MAX_SALES sales and ROAS < KILL_MAX_ROAS,
 * on a real sample — KILL_MIN_VIEWS paid landing views, or KILL_NO_TRACTION_DAYS days online.
 */
export const KILL_MAX_SALES = 3;
export const KILL_MAX_ROAS = 0.7;
export const KILL_MIN_VIEWS = 450;
export const KILL_NO_TRACTION_DAYS = 14;
/** Cautious mode of paid acquisition: company-wide ad ROAS over 10 days below this (with enough spend). */
const CAUTIOUS_ROAS = 0.9;
const CAUTIOUS_MIN_SPEND = 150;
import { clamp, dec, eur, includesCI, pct, short, str, strArr, uniq } from './util.js';

/** Organic TikTok posts per day across all products (the platform throttles reach above 5). */
export const ORGANIC_POSTS_PER_DAY = 4;
/** Organic posts per product and per day (the rest of the slots go to the other products). */
export const ORGANIC_POSTS_PER_PRODUCT = 2;

function planItem(kind: TaskKind, input: Record<string, unknown>, why: string, priority: 1 | 2 | 3 = 2, title?: string): DayPlanItem {
  return { kind, title: title ?? KIND_META[kind].label, dept: KIND_META[kind].dept, priority, input, why };
}

function titled(kind: TaskKind, p: Product, extra = ''): string {
  return `${KIND_META[kind].label}${extra} — « ${short(p.title, 42)} »`;
}

/** Day the current version of a product went (back) online. */
function versionSince(ctx: RuntimeCtx, p: Product): number {
  return versionSinceOf(ctx.world, p);
}

function reworkItem(ctx: RuntimeCtx, p: Product, why: string, priority: 1 | 2 | 3 = 1): DayPlanItem {
  return planItem('write_pdf', { productId: p.id, pipeline: 'v2', feedback: customerFeedback(ctx, p, versionSince(ctx, p)) }, why, priority, `Réécrire le guide (v${p.version + 1}) — « ${short(p.title, 40)} »`);
}

function customerFeedback(ctx: RuntimeCtx, p: Product, since: number): string[] {
  const out: string[] = [];
  for (const t of ctx.world.company.tasks) {
    if (t.kind !== 'reply_inbox' || t.status !== 'done' || (t.dayDone ?? 0) < since) continue;
    const replies = Array.isArray(t.output?.replies) ? (t.output!.replies as Record<string, unknown>[]) : [];
    for (const r of replies) if (r.productId === p.id && typeof r.complaint === 'string') out.push(r.complaint);
  }
  for (const r of p.stats.reviews) if (r.day >= since && r.rating <= 2) out.push(`Avis ${r.rating}/5 : ${r.text}`);
  return uniq(out).slice(0, 6);
}

/**
 * CEO decisions taken at the stand-up (they change the world before the plan is written):
 *   - quality gate: a live version rated < 3/5 (≥ 3 reviews) or refunded > 15 % is paused, then reworked (v2/v3) or killed;
 *   - a paused product whose rework died is reworked again or killed;
 *   - products that never sold, or whose v3 is still disliked, are killed (post-mortem).
 */
async function ceoDecisions(ctx: RuntimeCtx, notes: string[], items: DayPlanItem[]): Promise<void> {
  const w = ctx.world;
  const handled = new Set<string>();
  for (const p of w.company.products.filter((x) => x.status === 'live')) {
    const h = productHealth(w, p);
    if (!h.severe || isReworking(w, p.id)) continue;
    handled.add(p.id);
    if (p.version >= 3) {
      await killProduct(ctx, p, `même la v${p.version} reste inacceptable pour les acheteurs (${h.severe})`, 'camille');
      notes.push(`« ${p.title} » arrêté : ${h.severe} malgré ${p.version - 1} réécriture(s).`);
      continue;
    }
    await pauseProduct(ctx, p, h.severe, 'camille');
    items.push(reworkItem(ctx, p, `Produit mis en pause (${h.severe}) : on le retravaille avant de le revendre.`));
    notes.push(`« ${p.title} » mis en pause (${h.severe}) → v${p.version + 1}.`);
  }
  for (const p of w.company.products.filter((x) => x.status === 'paused')) {
    if (handled.has(p.id) || openTasksForProduct(ctx, p.id).length) continue;
    if (p.version >= 3) {
      await killProduct(ctx, p, `en pause depuis la v${p.version} sans version acceptable`, 'camille');
      notes.push(`« ${p.title} » arrêté après ${p.version - 1} réécriture(s).`);
      continue;
    }
    items.push(reworkItem(ctx, p, 'Produit en pause sans réécriture en cours : on relance la nouvelle version.'));
    notes.push(`« ${p.title} » : la réécriture reprend (v${p.version + 1}).`);
  }
  for (const p of w.company.products.filter((x) => x.status === 'live')) {
    if (!p.launchedDay || w.day - p.launchedDay < 7) continue;
    const m = productMetrics(w, p.id);
    // Upsells live off their parent's buyers: they are not judged on their own acquisition.
    // "Failing" needs a real sample: either enough paid visitors to see that nobody buys, or two weeks without
    // traction. (Before: < 3 sales after 7 days, i.e. ~100 € of ads and 200 visitors — at a 2 % conversion that
    // is bad luck one time in five, and it killed the first niche, often the best one, in a third of the runs.)
    const live = w.day - p.launchedDay;
    const failing = !isUpsellProduct(w, p.id) && m.sales < KILL_MAX_SALES && (m.spend > 0 ? m.roas < KILL_MAX_ROAS : true)
      && (m.landingViews >= KILL_MIN_VIEWS || live >= KILL_NO_TRACTION_DAYS);
    // Quality dead-end: even the v3 is rated badly by its own buyers → stop selling it, it hurts the brand.
    const h = productHealth(w, p);
    const hopeless = p.version >= 3 && w.day - h.since >= 5 && h.reviews.length >= 5 && h.rating > 0 && h.rating < 3.2;
    if (!failing && !hopeless) continue;
    const roas = Number.isFinite(m.roas) ? dec(m.roas) : '—';
    const reason = hopeless
      ? `même la v${p.version} reste notée ${dec(h.rating, 1)}/5 par ses acheteurs (${h.reviews.length} avis)`
      : `en ligne depuis ${w.day - p.launchedDay} jours : ${m.sales} vente(s), ROAS ${roas} pour ${eur(m.spend)} de pub`;
    await killProduct(ctx, p, reason, 'camille');
    notes.push(`« ${p.title} » arrêté (${hopeless ? 'qualité perçue trop basse' : `${m.sales} ventes en ${w.day - p.launchedDay} jours`}).`);
  }
}

// ───────────────────────────── pricing ─────────────────────────────

/** Paid landing views needed on each side of a price change before judging it (revenue per visitor). */
export const PRICE_EVIDENCE_VIEWS = 150;
/** A raise is rolled back when revenue per paid visitor falls below this share of what it was before the raise. */
export const PRICE_ROLLBACK_RATIO = 0.85;
/** Days at a price before it may be raised again (with PRICE_RAISE_SALES sales since the change). */
export const PRICE_RAISE_DAYS = 5;
export const PRICE_RAISE_SALES = 10;
/** Below this paid conversion on PRICE_DOWN_VIEWS visitors since the last change, the price goes one tier down. */
export const PRICE_DOWN_CVR = 0.008;
export const PRICE_DOWN_VIEWS = 300;
const PRICE_TIERS = [9, 14, 19, 24, 29, 39, 49];

/** Ad revenue per paid landing view of a product over [from, to] (what one more visitor is worth at that price). */
export function revenuePerVisitor(w: RuntimeCtx['world'], productId: string, from: number, to: number): { views: number; rpv: number } {
  let views = 0, revenue = 0;
  for (const s of w.market.adStats) {
    if (s.productId !== productId || s.day < from || s.day > to) continue;
    views += s.landingViews; revenue += s.revenue;
  }
  return { views, rpv: views > 0 ? revenue / views : 0 };
}

/**
 * The price decision of the day for a live product (observable data only), or null:
 *   1. a concluded A/B price test whose winner is not applied → apply it (before, the price stayed on whatever
 *      variant was set last, e.g. 39 € after a test that said 29 €);
 *   2. the last raise lowered the revenue per paid visitor (≥ 150 views each side) → back to the previous price;
 *   3. otherwise the usual raise (10 sales and 5 days at this price, good reviews, few refunds), never back to a
 *      tier that was already tried and abandoned.
 */
export function priceMove(ctx: RuntimeCtx, p: Product): { input: Record<string, unknown>; why: string } | null {
  const w = ctx.world;
  const day = w.day;
  const hist = p.priceHistory;
  const last = hist[hist.length - 1];
  const lastChange = last ? last.day : (p.launchedDay ?? day);
  const key = p.title.slice(0, 30);
  const tests = w.company.experiments.filter((e) => e.dimension === 'price' && e.hypothesis.includes(key));
  const done = [...tests].reverse().find((e) => e.status === 'concluded');
  if (done && (done.endDay ?? done.day) >= lastChange) {
    const winner = Number(done.winner);
    // Inconclusive test → back to the price before the test (its control), not to whichever variant ran last.
    const control = [...hist].reverse().find((h) => h.day < done.day)?.price ?? Number(done.variants[0]);
    const target = done.winner !== null && Number.isFinite(winner) && winner > 0 ? winner : control;
    if (Number.isFinite(target) && target > 0 && target !== p.price) {
      return {
        input: { productId: p.id, reason: 'winner', price: target },
        why: done.winner !== null
          ? `Le test A/B de prix a conclu : ${eur(target)} rapporte le plus par visiteur (on était resté à ${eur(p.price)}).`
          : `Test de prix non concluant : retour au prix d'avant le test (${eur(target)}).`,
      };
    }
  }
  const prev = hist.length >= 2 ? hist[hist.length - 2]! : null;
  const testedSince = prev ? tests.some((e) => (e.endDay ?? day) >= prev.day) : false;
  if (prev && last && last.price > prev.price && !testedSince) {
    const span = Math.max(3, day - last.day);
    const after = revenuePerVisitor(w, p.id, last.day, day - 1);
    const before = revenuePerVisitor(w, p.id, Math.max(prev.day, last.day - span), last.day - 1);
    if (after.views >= PRICE_EVIDENCE_VIEWS && before.views >= PRICE_EVIDENCE_VIEWS && after.rpv < before.rpv * PRICE_ROLLBACK_RATIO) {
      return {
        input: { productId: p.id, reason: 'baisse', price: prev.price },
        why: `La hausse à ${eur(last.price)} fait chuter le revenu par visiteur (${eur(after.rpv)} contre ${eur(before.rpv)} à ${eur(prev.price)}) : retour à ${eur(prev.price)}.`,
      };
    }
  }
  // Almost nobody buys at this price (hundreds of paid visitors since the change) → one tier down.
  const atPrice = revenuePerVisitor(w, p.id, lastChange, day - 1);
  const lower = [...PRICE_TIERS].reverse().find((t) => t < p.price);
  if (lower !== undefined && atPrice.views >= PRICE_DOWN_VIEWS && atPrice.rpv < p.price * PRICE_DOWN_CVR) {
    return {
      input: { productId: p.id, reason: 'baisse', price: lower },
      why: `${atPrice.views} visiteurs payants à ${eur(p.price)} pour ${dec((atPrice.rpv / p.price) * 100, 1)} % de conversion : trop cher, on descend à ${eur(lower)}.`,
    };
  }
  const up = PRICE_TIERS.find((t) => t > p.price);
  if (up === undefined) return null;
  // A tier we already left for a lower price (rolled back, or lost an A/B test) is not tried again.
  const abandoned = hist.some((h, i) => h.price === up && i < hist.length - 1 && hist[i + 1]!.price < up);
  if (abandoned) return null;
  const sinceChange = productMetrics(w, p.id, lastChange);
  const goodRating = p.stats.reviews.length < 3 || p.stats.rating >= 4.2;
  if (sinceChange.sales >= PRICE_RAISE_SALES && goodRating && sinceChange.refundRate < 0.08 && day - lastChange >= PRICE_RAISE_DAYS) {
    return { input: { productId: p.id, reason: 'hausse' }, why: `${sinceChange.sales} ventes depuis le dernier prix, avis bons : on monte d'un palier.` };
  }
  return null;
}

interface AcquisitionPlan { launchedFor: Product | null; blocked: string | null }

/**
 * Paid acquisition of the day. Every promotable product without a running campaign gets concrete tasks
 * (launch_campaign when good creatives wait, else write_ad_hooks → produce_ad ×2 → launch_campaign), best
 * candidate first, inside the CFO envelope. Anything that blocks it (ad ban, cash, envelope, cooldown, quality)
 * is said out loud. Watchdog: after MAX_IDLE_DAYS days without paid ads, the best candidate is relaunched even
 * during its cooldown.
 */
function planPaidAcquisition(ctx: RuntimeCtx, items: DayPlanItem[], notes: string[]): AcquisitionPlan {
  const w = ctx.world;
  const candidates = acquisitionCandidates(w);
  const waiting = candidates.filter((c) => !activeCampaigns(w, c.product.id).length);
  const companyBlock = companyPaidBlock(w);
  const idle = daysWithoutAds(w);
  const budget = currentBudget(w);
  let room = budget.adCap - committedAdBudget(w);
  const perLaunch = clamp(budget.cash * 0.04, MIN_CAMPAIGN_BUDGET, 40);
  const reasons: string[] = [];
  let launchedFor: Product | null = null;
  let forced = false;
  // Cautious mode: paid ads lost money over the last 10 days → one new test at a time, smaller budgets.
  const recent = w.market.adStats.filter((s) => s.day >= w.day - 10);
  const spend10 = recent.reduce((s, r) => s + r.spend, 0);
  const roas10 = spend10 > 0 ? recent.reduce((s, r) => s + r.revenue, 0) / spend10 : 1;
  const cautious = spend10 >= CAUTIOUS_MIN_SPEND && roas10 < CAUTIOUS_ROAS;
  let newLaunches = 0;
  for (const cand of waiting) {
    const p = cand.product;
    let inFlight = openTasks(w, (t) => t.input.productId === p.id && (t.kind === 'launch_campaign' || t.kind === 'write_ad_hooks' || t.kind === 'produce_ad'));
    // Watchdog: acquisition tasks that have been sitting for 2+ days while nothing runs are stuck → start again.
    if (inFlight.length && idle >= MAX_IDLE_DAYS && !companyBlock && (!cand.block || !cand.block.hard)
      && inFlight.every((t) => t.status !== 'awaiting_founder' && t.status !== 'in_progress' && t.dayCreated <= w.day - MAX_IDLE_DAYS)) {
      for (const t of inFlight) { t.status = 'cancelled'; t.dayDone = w.day; logTask(t, `Jour ${w.day} : annulée — bloquée depuis le jour ${t.dayCreated}, on repart de zéro.`); }
      say(ctx, 'camille', `Camille : ${idle} jours sans pub et ${inFlight.length} tâche(s) d'acquisition bloquée(s) sur « ${short(p.title, 40)} » — on repart de zéro`, 'thought', { productId: p.id });
      inFlight = [];
    }
    if (inFlight.length) {
      const awaiting = inFlight.find((t) => t.status === 'awaiting_founder');
      if (awaiting) { reasons.push(`« ${short(p.title, 40)} » : campagne en attente de l'accord du fondateur`); continue; }
      if (cand.block?.hard || companyBlock) continue; // creatives may be in production, but nothing will be launched
      // Creatives in production without a launch planned: plug the launch behind them (concrete next step).
      const launching = inFlight.some((t) => t.kind === 'launch_campaign' || (t.kind === 'write_ad_hooks' && t.input.launch === true));
      if (!launching && !cand.block) {
        const hooks = inFlight.find((t) => t.kind === 'write_ad_hooks');
        if (hooks) hooks.input = { ...hooks.input, launch: true };
        else createTask(w, { kind: 'launch_campaign', title: titled('launch_campaign', p), input: { productId: p.id, nicheId: p.nicheId }, dependsOn: inFlight.map((t) => t.id), createdBy: 'camille', priority: 2 });
      }
      if (!cand.block) launchedFor ??= p;
      continue;
    }
    if (companyBlock) break;
    if (cautious && newLaunches >= 1) { reasons.push(`« ${short(p.title, 40)} » : pub globalement perdante sur 10 jours (ROAS ${dec(roas10)}), un seul nouveau test à la fois`); continue; }
    const force = !forced && !!cand.block && !cand.block.hard && idle >= MAX_IDLE_DAYS;
    if (cand.block && !force) { reasons.push(`« ${short(p.title, 40)} » : ${cand.block.reason}`); continue; }
    if (room < MIN_CAMPAIGN_BUDGET) { reasons.push(`« ${short(p.title, 40)} » : enveloppe pub du jour déjà engagée`); continue; }
    const extra = { ...(force ? { force: true } : {}), ...(cautious ? { cautious: true } : {}) };
    const why = force
      ? `${idle} jours sans pub payante alors qu'on a de la trésorerie : on relance « ${short(p.title, 40)} » avec un nouvel angle.`
      : launchedFor ? 'Deuxième produit à pousser dans l’enveloppe du CFO.' : 'Meilleur produit à pousser (note, qualité, historique pub) : acquisition payante.';
    if (launchableCreatives(w, p.id).length) items.push(planItem('launch_campaign', { productId: p.id, ...extra }, `${why} Des créas validées attendent.`, force ? 1 : 2, titled('launch_campaign', p)));
    else items.push(planItem('write_ad_hooks', { productId: p.id, produce: 2, launch: true, ...extra }, `${why} Plus de créa fraîche : nouveaux angles d'abord.`, force ? 1 : 2, titled('write_ad_hooks', p)));
    if (force) { forced = true; notes.push(`Garde-fou : ${idle} jours sans pub, relance forcée de « ${short(p.title, 40)} ».`); }
    room -= perLaunch;
    newLaunches++;
    launchedFor ??= p;
  }
  if (cautious && newLaunches) notes.push(`Pub globalement perdante sur 10 jours (ROAS ${dec(roas10)} pour ${eur(spend10)}) : un seul nouveau test, budget réduit.`);
  const running = activeCampaigns(w).length > 0;
  // Watchdog, last resort: every promotable product is "ads-dead" and nothing has run for MAX_IDLE_DAYS days →
  // one small test campaign on the best of them (fresh angle, minimum budget) instead of staying idle.
  if (!launchedFor && !running && !companyBlock && idle >= MAX_IDLE_DAYS && room >= MIN_CAMPAIGN_BUDGET) {
    const test = waiting.find((c) => c.block?.hard && !openTasks(w, (t) => t.input.productId === c.product.id && ['launch_campaign', 'write_ad_hooks', 'produce_ad'].includes(t.kind)).length);
    if (test) {
      const p = test.product;
      const input = { productId: p.id, force: true, test: true, ...(cautious ? { cautious: true } : {}) };
      const why = `${idle} jours sans pub payante : petit test à budget minimum sur « ${short(p.title, 40)} » avec un angle neuf.`;
      if (launchableCreatives(w, p.id).length) items.push(planItem('launch_campaign', input, why, 1, titled('launch_campaign', p, ' (test)')));
      else items.push(planItem('write_ad_hooks', { ...input, produce: 2, launch: true }, why, 1, titled('write_ad_hooks', p, ' (test)')));
      notes.push(`Garde-fou : ${idle} jours sans pub, test à petit budget sur « ${short(p.title, 40)} ».`);
      launchedFor = p;
    }
  }
  let blocked: string | null = null;
  if (!launchedFor && !running && waiting.length) blocked = companyBlock ?? reasons[0] ?? null;
  else if (!launchedFor && !running && !candidates.length && w.company.products.some((p) => p.status === 'live' || p.status === 'paused')) blocked = 'aucun produit en ligne ne passe les critères de qualité pour la pub';
  // Say why nothing is launched (the founder must never wonder why the agency is idle).
  if (!launchedFor && waiting.length && companyBlock) say(ctx, 'leo', `Léo : pas de nouvelle campagne aujourd'hui — ${companyBlock}`, 'ad');
  for (const r of reasons.slice(0, 2)) say(ctx, 'leo', `Léo : pas de pub aujourd'hui pour ${r}`, 'ad');
  if (blocked && !launchedFor) notes.push(`Acquisition payante bloquée : ${blocked}.`);
  return { launchedFor, blocked };
}

export async function buildHeuristicPlan(ctx: RuntimeCtx): Promise<DayPlan> {
  const w = ctx.world;
  const day = w.day;
  const items: DayPlanItem[] = [];
  const notes: string[] = [];
  await ceoDecisions(ctx, notes, items);

  const budget = currentBudget(w);
  const products = w.company.products;
  const live = products.filter((p) => p.status === 'live');
  const building = products.filter((p) => !['live', 'killed', 'paused'].includes(p.status));
  const open = (kind: TaskKind, pid?: string) => openTasks(w, (t) => t.kind === kind && (!pid || t.input.productId === pid)).length > 0;

  // 1. Nothing to sell and nothing in the oven → find the next niche.
  if (!live.length && !building.length && !open('scan_trends') && !open('pick_opportunity') && !open('mine_pains')) {
    const excluded = excludedNiches(ctx, { includeActive: true });
    const shortlist = w.company.research.shortlist.filter((id) => !excluded.includes(id));
    if (w.company.research.trends.length && shortlist.length) items.push(planItem('pick_opportunity', {}, 'La shortlist a encore des niches non testées : on choisit la suivante.', 1));
    else items.push(planItem('scan_trends', { chain: 'opportunity' }, day === 1 ? 'Jour 1 : trouver un problème précis pour lequel les gens paient déjà.' : 'Plus aucune piste exploitable : nouveau scan du marché.', 1));
  }

  // 1b. Diversify: the portfolio has an upsell, is plateauing, or has nothing left to push in paid ads
  //     → open a new niche (one product in production at a time).
  const mains = live.filter((p) => !isUpsellProduct(w, p.id));
  if ((live.length || products.some((p) => p.status === 'paused')) && !building.length && mains.length < 3 && !open('scan_trends') && !open('pick_opportunity') && !budget.survival && w.status !== 'bankrupt') {
    const lastCreated = Math.max(0, ...products.map((p) => p.createdDay));
    const settled = mains.every((p) => {
      const m7 = productMetrics(w, p.id, Math.max(1, day - 6));
      const mature = (p.launchedDay ?? day) <= day - 7;
      return p.upsellProductId !== null || (mature && (m7.spend > 0 ? m7.roas < 1.2 : m7.sales < 5));
    });
    // Nothing can take paid ads now or soon (all paused, disliked or "ads-dead"): do not wait 8 days.
    const nothingToPush = !acquisitionCandidates(w).some((c) => !c.block || !c.block.hard);
    if ((day - lastCreated >= 8 && settled) || (nothingToPush && day - lastCreated >= 4)) {
      const excluded = excludedNiches(ctx, { includeActive: true });
      const shortlist = w.company.research.shortlist.filter((id) => !excluded.includes(id));
      const why = 'Le portefeuille plafonne : on ouvre une nouvelle niche pour ne pas dépendre d’un seul produit.';
      if (shortlist.length) items.push(planItem('pick_opportunity', {}, why, 2, 'Choisir une nouvelle niche (diversification)'));
      else items.push(planItem('scan_trends', { chain: 'opportunity' }, why, 2, 'Scanner les tendances (diversification)'));
      notes.push('Diversification : nouvelle niche à l’étude.');
    }
  }

  // 2. Production chains stuck without any open task → resume them.
  for (const p of building) {
    if (!openTasksForProduct(ctx, p.id).length) items.push(planItem('write_pdf', { productId: p.id, pipeline: 'resume' }, `La chaîne de « ${short(p.title, 40)} » est bloquée : on relance les étapes manquantes.`, 1, `Relancer la production — « ${short(p.title, 42)} »`));
  }

  // 3. Live products: acquisition, quality loop, pricing, upsell.
  // Organic first: TikTok throttles reach beyond ~5 posts a day, so Tom gets 4 slots shared by priority
  // (products without paid ads first, then the best sellers of the week), at most 2 per product. A product
  // that fails the quality gate (bad rating, refunds) is never promoted.
  const promotable = live.filter((p) => !promotionBlock(w, p));
  const postOrder = [...promotable].sort((a, b) => {
    const ca = activeCampaigns(w, a.id).length ? 1 : 0, cb = activeCampaigns(w, b.id).length ? 1 : 0;
    return ca - cb || productMetrics(w, b.id, Math.max(1, day - 6)).sales - productMetrics(w, a.id, Math.max(1, day - 6)).sales;
  });
  let postSlots = ORGANIC_POSTS_PER_DAY;
  for (let round = 0; round < ORGANIC_POSTS_PER_PRODUCT; round++) {
    for (const p of postOrder) {
      if (postSlots <= 0) break;
      const upsell = isUpsellProduct(w, p.id);
      const wants = upsell ? 1 : budget.survival || !activeCampaigns(w, p.id).length ? ORGANIC_POSTS_PER_PRODUCT : 1;
      if (round >= wants) continue;
      items.push(planItem('post_organic', { productId: p.id, slot: round }, upsell ? 'Faire connaître la suite au même public.' : 'Parler du point de douleur gratuitement, tous les jours.', 3, titled('post_organic', p)));
      postSlots--;
    }
  }

  const acquisition = planPaidAcquisition(ctx, items, notes);

  for (const p of live) {
    const pid = p.id;
    const upsell = isUpsellProduct(w, pid);
    const all = productMetrics(w, pid);
    const m7 = productMetrics(w, pid, Math.max(1, day - 6));
    const canPromote = !promotionBlock(w, p);

    const lastScout = Math.max(0, ...w.company.tasks.filter((t) => t.kind === 'find_creators' && t.input.productId === pid).map((t) => t.dayCreated));
    const deals = w.market.partnerships.filter((x) => x.productId === pid).length;
    if (canPromote && p.stats.sales >= 3 && !open('find_creators', pid) && !open('negotiate_deal', pid) && (lastScout === 0 || day - lastScout >= 7) && deals < 6) {
      items.push(planItem('find_creators', { productId: pid }, `${p.stats.sales} ventes : assez de preuve sociale pour recruter des créateurs à la commission.`, 3, titled('find_creators', p)));
    }

    // Quality loop (mild signals, the guide stays on sale meanwhile) — judged on the CURRENT version.
    const health = productHealth(w, p);
    const since = health.since;
    const v = productMetrics(w, pid, since);
    const complaints = detectedComplaints(w, pid, since);
    const ratingBad = health.reviews.length >= 5 && health.rating > 0 && health.rating < 3.8;
    const refundBad = v.sales >= 8 && v.refundRate > 0.1;
    const reworking = isReworking(w, pid);
    if ((complaints >= 3 || ratingBad || refundBad) && p.version < 3 && !reworking && day - since >= 2) {
      const why = complaints >= 3 ? `${complaints} plaintes qualité remontées par le support` : ratingBad ? `note moyenne ${dec(health.rating, 1)}/5` : `taux de remboursement ${pct(v.refundRate)}`;
      items.push(reworkItem(ctx, p, `Boucle qualité : ${why} → v${p.version + 1}.`));
    }

    const priceExp = w.company.experiments.find((e) => e.status === 'running' && e.dimension === 'price' && e.hypothesis.includes(p.title.slice(0, 30)));
    if (priceExp && !open('set_price', pid)) {
      items.push(planItem('set_price', { productId: pid, reason: 'experiment' }, `Test de prix en cours (${priceExp.variants.join(' € vs ')} €) : on alterne.`, 2, titled('set_price', p)));
    } else if (!open('set_price', pid)) {
      const move = priceMove(ctx, p);
      if (move) items.push(planItem('set_price', move.input, move.why, 2, titled('set_price', p)));
    }

    const liked = p.stats.reviews.length < 3 || p.stats.rating >= 3.8;
    const profitable = all.sales >= 10 && liked && (m7.spend > 0 ? m7.roas >= 1.5 : m7.sales >= 5);
    if (!upsell && !p.upsellProductId && profitable && !open('design_upsell', pid)) {
      items.push(planItem('design_upsell', { productId: pid }, `Produit rentable (ROAS 7 j ${Number.isFinite(m7.roas) ? dec(m7.roas) : '∞'}, ${all.sales} ventes) : la suite pour le même public.`, 2, titled('design_upsell', p)));
    }
  }

  // 4. Media buying.
  if (activeCampaigns(w).length) items.push(planItem('optimize_ads', {}, budget.survival ? 'Mode survie : on coupe tout ce qui ne rapporte pas.' : 'Stop-loss, scale progressif et créas fatiguées.', 1));

  // 5. Inbox: batches of 6, most urgent first.
  const claimed = claimedMessageIds(w);
  const inbox = openMessages(ctx).filter((m) => !claimed.has(m.id)).sort((a, b) => urgency(b, day) - urgency(a, day) || a.day - b.day);
  for (let i = 0; i < inbox.length && i < 24; i += 6) {
    const batch = inbox.slice(i, i + 6);
    items.push(planItem('reply_inbox', { messageIds: batch.map((m) => m.id) }, `${batch.length} message(s) en attente, réponse sous 24 h.`, batch.some((m) => urgency(m, day) >= 5) ? 1 : 2, `Répondre à ${batch.length} client(s)`));
  }
  // Escalated refund/chargeback threats: refund before it becomes a chargeback (amount + 15 € fees).
  let refunds = 0;
  for (const m of w.market.inbox) {
    if (refunds >= 3 || m.status !== 'escalated' || !m.orderId || claimed.has(m.id)) continue;
    const order = w.market.orders.find((o) => o.id === m.orderId);
    if (!order || order.refunded || order.chargeback) continue;
    if (!['rembours', 'chargeback', 'banque', 'litige'].some((k) => includesCI(`${m.subject} ${m.body}`, k))) continue;
    if (openTasks(w, (t) => t.kind === 'handle_refund' && t.input.orderId === order.id).length) continue;
    items.push(planItem('handle_refund', { orderId: order.id, messageId: m.id, productId: order.productId, reason: 'Client escaladé : on rembourse avant le chargeback' }, 'Un chargeback coûte le montant + 15 € : on rembourse de bonne foi.', 1, `Rembourser ${eur(order.price)} avant chargeback`));
    refunds++;
  }

  // 6. Analysis.
  if (day >= 2) items.push(planItem('daily_report', { day: day - 1 }, 'Raconter la veille en chiffres.', 3, `Rapport du jour ${day - 1}`));
  if (day >= 3 && !open('run_experiment') && (experimentCandidate(ctx) || w.company.experiments.some((e) => e.status === 'running'))) {
    items.push(planItem('run_experiment', {}, 'Transformer les intuitions en tests A/B mesurés.', 3));
  }

  // Focus + memo.
  const fin = sim.financeSnapshot(w);
  const lead = live[0] ?? building[0];
  let focus: string;
  if (w.status === 'bankrupt') focus = 'Trésorerie négative : zéro dépense, support et organique uniquement';
  else if (budget.survival) focus = 'Mode survie : organique, créateurs à la commission, aucune pub non rentable';
  else if (!live.length && !building.length) focus = 'Trouver une niche rentable (règle du un)';
  else if (!live.length && lead) focus = `Sortir « ${short(lead.title, 50)} » : la chaîne de production tourne`;
  else if (live.some((p) => activeCampaigns(w, p.id).length)) focus = fin.roas7d >= 1.5 ? 'Scaler ce qui marche et préparer la suite' : 'Rendre les pubs rentables : couper, tester, itérer';
  else if (acquisition.launchedFor) focus = `Lancer l'acquisition de « ${short(acquisition.launchedFor.title, 50)} »`;
  else if (acquisition.blocked) focus = `Pub payante en pause (${short(acquisition.blocked, 90)}) : organique, créateurs et support`;
  else if (live.length) focus = 'Organique et créateurs : aucun produit à pousser en pub aujourd’hui';
  else focus = 'Retravailler les guides en pause et préparer la prochaine niche';
  const memo = [
    `Jour ${day} — trésorerie ${eur(fin.cash)}, profit cumulé ${eur(fin.profit)}, ROAS 7 j ${dec(fin.roas7d)}${fin.runwayDays !== null ? `, runway ${fin.runwayDays} j` : ''}.`,
    `Enveloppe pub ${eur(budget.adCap)}. ${live.length} produit(s) en ligne, ${building.length} en production.`,
    ...notes,
  ].join(' ');
  return { focus, items, memo };
}

// ───────────────────────────── Plan merge & materialization ─────────────────────────────

function itemKey(kind: TaskKind, input: Record<string, unknown>): string {
  return [kind, input.productId, input.nicheId, input.campaignId, input.creatorId, input.orderId, strArr(input.messageIds).join(','), input.slot, input.reason, input.pipeline]
    .map((x) => (x === undefined || x === null ? '' : String(x))).join('|');
}

/** Validates an item coming from the engine (Claude may invent kinds or forget inputs). */
export function normalizeItem(ctx: RuntimeCtx, item: Partial<DayPlanItem> | null | undefined): DayPlanItem | null {
  if (!item || typeof item.kind !== 'string' || !PLAN_KINDS.includes(item.kind as TaskKind)) return null;
  const kind = item.kind as TaskKind;
  const input: Record<string, unknown> = item.input && typeof item.input === 'object' ? { ...item.input } : {};
  const acquisitionKind = (ACQUISITION_KINDS as readonly string[]).includes(kind);
  if (PRODUCT_KINDS.includes(kind)) {
    const p = productOf(ctx, input.productId);
    if (!p || p.status === 'killed') {
      const focus = acquisitionKind ? bestCandidate(ctx.world) ?? focusProduct(ctx) : focusProduct(ctx);
      if (!focus) return null;
      input.productId = focus.id;
    }
  }
  // Never promote a product that fails the quality gate (Claude's plan or a vague founder mission included).
  if (acquisitionKind) {
    const p = productOf(ctx, input.productId);
    if (p && p.status === 'live' && promotionBlock(ctx.world, p)) {
      const alt = bestCandidate(ctx.world);
      if (!alt || alt.id === p.id) return null;
      input.productId = alt.id;
    }
  }
  const priority = item.priority === 1 || item.priority === 2 || item.priority === 3 ? item.priority : 2;
  return { kind, title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : KIND_META[kind].label, dept: KIND_META[kind].dept, priority, input, why: typeof item.why === 'string' ? item.why : '' };
}

/** The product a vague instruction is about: best promotable one, else newest live one, else newest in production. */
export function focusProduct(ctx: RuntimeCtx): Product | undefined {
  const ps = ctx.world.company.products;
  return bestCandidate(ctx.world) ?? [...ps].reverse().find((p) => p.status === 'live') ?? [...ps].reverse().find((p) => p.status !== 'killed');
}

/** The engine may add or re-prioritize items; heuristic items it omitted are kept (safety: support, stop-loss…). */
export function mergePlans(ctx: RuntimeCtx, heuristic: DayPlan, engine: DayPlan | null): DayPlanItem[] {
  const out = new Map<string, DayPlanItem>();
  for (const raw of engine?.items ?? []) {
    const it = normalizeItem(ctx, raw);
    if (it) out.set(itemKey(it.kind, it.input), it);
  }
  for (const it of heuristic.items) {
    const key = itemKey(it.kind, it.input);
    if (!out.has(key)) out.set(key, it);
  }
  return [...out.values()];
}

export interface MaterializeOpts { createdBy: Task['createdBy']; missionId: string | null; priority?: 1 | 2 | 3; assignee?: string | null }

/** Turns plan items into tasks (dedup against open tasks; pipeline items expand into task graphs). */
export function materialize(ctx: RuntimeCtx, items: DayPlanItem[], opts: MaterializeOpts): Task[] {
  const w = ctx.world;
  const created: Task[] = [];
  for (const it of items) {
    const input = { ...it.input };
    const priority = opts.priority ?? it.priority;
    const product = productOf(ctx, input.productId);
    const pOpts = { createdBy: opts.createdBy, missionId: opts.missionId, priority };
    const pipeline = str(input.pipeline);
    if (pipeline && product && product.status !== 'killed') {
      if (pipeline === 'v2') created.push(...createV2Pipeline(ctx, product, strArr(input.feedback), pOpts));
      else if (pipeline === 'resume') created.push(...resumePipeline(ctx, product, pOpts));
      else if (pipeline === 'full' && !openTasksForProduct(ctx, product.id).length) created.push(...createProductPipeline(ctx, product, pOpts));
      else if (pipeline === 'upsell' && !openTasksForProduct(ctx, product.id).length) created.push(...createUpsellPipeline(ctx, product, pOpts));
      continue;
    }
    // nicheId first: the open tasks carry it, so the dedup key must too (otherwise yesterday's open task is duplicated).
    if (product) input.nicheId ??= product.nicheId;
    const key = itemKey(it.kind, input);
    if (w.company.tasks.some((t) => isOpen(t) && itemKey(t.kind, t.input) === key)) continue;
    const task = createTask(w, { kind: it.kind, title: it.title, input: { ...input, why: it.why }, priority, createdBy: opts.createdBy, missionId: opts.missionId, assignee: opts.assignee ?? null });
    created.push(task);
    // A requested rewrite of a published guide must reach the files and the store.
    if (it.kind === 'humanize_pdf' && product?.files.pdf) {
      const render = createTask(w, { kind: 'render_pdf', title: titled('render_pdf', product), input: { productId: product.id, nicheId: product.nicheId }, dependsOn: [task.id], priority, createdBy: opts.createdBy, missionId: opts.missionId });
      created.push(render);
      if (product.status === 'live') {
        created.push(createTask(w, { kind: 'publish_product', title: `Remettre en ligne — « ${short(product.title, 42)} »`, input: { productId: product.id, nicheId: product.nicheId, republish: true }, dependsOn: [render.id], priority, createdBy: opts.createdBy, missionId: opts.missionId }));
      }
    }
  }
  return created;
}

// ───────────────────────────── Founder missions ─────────────────────────────

const MISSION_RULES: [RegExp, TaskKind][] = [
  [/nouveau (pdf|guide|produit)|second (pdf|guide|produit)|2e (pdf|guide|produit)|autre niche|nouvelle niche/i, 'pick_opportunity'],
  [/niche|tendance|march[ée]|opportunit/i, 'scan_trends'],
  [/concurren/i, 'scan_competitors'],
  [/douleur|commentaire|voix du client|forum/i, 'mine_pains'],
  [/upsell|la suite/i, 'design_upsell'],
  [/hook|cr[ée]a|pub tiktok|nouvelle pub|vid[ée]o/i, 'write_ad_hooks'],
  [/campagne|budget pub|scale|stop-loss|roas/i, 'optimize_ads'],
  [/organique|poster|post /i, 'post_organic'],
  [/prix|tarif/i, 'set_price'],
  [/page de vente|copywriting/i, 'write_sales_page'],
  [/couverture/i, 'design_cover'],
  [/r[ée][ée]cri|am[ée]liore|qualit[ée]|humanis|v2/i, 'humanize_pdf'],
  [/rembours/i, 'reply_inbox'],
  [/mail|support|message|client/i, 'reply_inbox'],
  [/cr[ée]ateur|influenc|partenari|affili/i, 'find_creators'],
  [/rapport|kpi|chiffres|bilan/i, 'daily_report'],
  [/test|exp[ée]rience|a\/b/i, 'run_experiment'],
  [/red team|critique|tuer|risque/i, 'red_team'],
];

/** Keyword routing when the engine could not interpret a founder mission. */
export function keywordMission(ctx: RuntimeCtx, text: string): DayPlanItem[] {
  const kinds = uniq(MISSION_RULES.filter(([rx]) => rx.test(text)).map(([, k]) => k)).slice(0, 3);
  if (!kinds.length) kinds.push('daily_report');
  const out: DayPlanItem[] = [];
  for (const kind of kinds) {
    const input: Record<string, unknown> = {};
    if (kind === 'scan_trends') input.chain = 'opportunity';
    if (kind === 'write_ad_hooks') { input.produce = 2; input.launch = !activeCampaigns(ctx.world).length; }
    if (kind === 'red_team') input.subject = 'pdf';
    if (kind === 'daily_report') input.day = Math.max(1, ctx.world.day - 1);
    const it = normalizeItem(ctx, { kind, title: `${KIND_META[kind].label} (mission du fondateur)`, dept: KIND_META[kind].dept, priority: 1, input, why: `Mission du fondateur : ${short(text, 80)}` });
    if (it) out.push(it);
  }
  return out;
}

/** Fills the inputs a founder item needs (e.g. a launch needs creatives, a scan feeds a pick). */
export function prepareFounderItem(ctx: RuntimeCtx, it: DayPlanItem): DayPlanItem {
  const input = { ...it.input };
  if (it.kind === 'scan_trends' && input.chain === undefined) input.chain = 'opportunity';
  if (it.kind === 'write_ad_hooks' && input.produce === undefined) input.produce = 2;
  if (it.kind === 'red_team' && input.subject === undefined) input.subject = productOf(ctx, input.productId)?.content ? 'pdf' : 'idea';
  return { ...it, input, priority: 1, title: it.title.includes('fondateur') ? it.title : `${it.title} (mission du fondateur)` };
}

export function describePlan(ctx: RuntimeCtx, plan: DayPlan): string {
  return `${nameOf(ctx, 'camille')} : ${plan.focus}`;
}
