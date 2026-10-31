/**
 * The CEO's heuristic daily plan: a state machine over the company situation
 *   no product → find a niche · building → unblock the chain · live → acquisition (ads, organic, creators)
 *   failing → kill + post-mortem + next niche · profitable → scale + upsell · low cash → survival mode.
 * Then the ContentEngine (Claude mode) may adjust it; the runtime materializes the plan into tasks.
 */
import type { DayPlanItem, DayPlan } from '../contracts.js';
import type { ChannelId, Lesson, Product, Task, TaskKind, WorldState } from '../shared.js';
import { CHANNELS, channelOf } from '../shared.js';
import { multiChannel, openChannels, planChannels } from './channels.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, latestOutput, nameOf, productOf, speak, vocOf } from './ctx.js';
import { learning, sim } from './modules.js';
import { activeCampaigns, claimedMessageIds, committedAdBudget, currentBudget, detectedComplaints, feedbackOf, isProductFeedback, isUpsellProduct, parentOf, priceCeiling, productMetrics, PRICE_EVIDENCE_VIEWS, PRICE_ROLLBACK_RATIO, recentReviews, referenceChannel } from './metrics.js';
import { adsHeldSince, launchHold, productHold } from './holds.js';
import { officerId, ownersOfAny } from './org/officers.js';
import { createProductPipeline, createUpsellPipeline, createV2Pipeline, excludedNiches, killProduct, openTasksForProduct, pauseProduct, resumePipeline } from './pipeline.js';
import { guideGaps } from './redteam.js';
import { growthOn, policyOf } from './stages.js';
import { createTask, isOpen, KIND_META, logTask, openTasks, PLAN_KINDS, PRODUCT_KINDS, taskChannel } from './tasks.js';
import { openMessages, urgency } from './handlers/support.js';
import { experimentCandidate } from './handlers/ops.js';
import {
  ACQUISITION_KINDS, acquisitionCandidates, adBanActive, bestCandidate, channelPaused, companyPaidBlock, daysWithoutAds, isReworking, launchableCreatives,
  lessonDay, LOSS_WINDOW_DAYS, MAX_IDLE_DAYS, MIN_CAMPAIGN_BUDGET, productHealth, productPaidBlock, promotionBlock, recentLoss, recentProfits, refundsTooHigh, refundsWorthRework, versionSince as versionSinceOf,
} from './acquisition.js';

/**
 * Kill rule of a main product, on the current version's last KILL_WINDOW_DAYS days (after at least 7 days online):
 * fewer than KILL_MAX_SALES sales and ROAS < KILL_MAX_ROAS, on a real sample — KILL_MIN_VIEWS paid landing views, or
 * KILL_NO_TRACTION_DAYS days online. What a guide sold months ago says nothing about what it earns now.
 */
export const KILL_WINDOW_DAYS = 14;
export const KILL_MAX_SALES = 3;
export const KILL_MAX_ROAS = 0.7;
export const KILL_MIN_VIEWS = 450;
export const KILL_NO_TRACTION_DAYS = 14;
export const KILL_MIN_POSTS = 5;
/** Cautious mode of paid acquisition: company-wide ad ROAS over 10 days below this (with enough spend). */
const CAUTIOUS_ROAS = 0.9;
const CAUTIOUS_MIN_SPEND = 150;
import { clamp, dec, eur, includesCI, numOf, pct, short, str, strArr, uniq } from './util.js';

/** Organic TikTok posts per day across all products (the platform throttles reach above 5). */
export const ORGANIC_POSTS_PER_DAY = 4;
/** Organic posts per product and per day (the rest of the slots go to the other products). */
export const ORGANIC_POSTS_PER_PRODUCT = 2;

/** A main product needs room in the CFO's daily envelope: one per this many euros of adCap. */
export const AD_ROOM_PER_MAIN = 30;
/** While cash is comfortable, a new niche every this many days, whatever the others do. */
export const GROWTH_NICHE_DAYS = 7;
/** With a main losing money and cash to spare, a new niche does not wait for the plateau rule. */
export const REPLACE_NICHE_DAYS = 4;
/** Weekly market watch while the company can afford to look ahead. */
export const RESEARCH_REFRESH_DAYS = 7;
/** Runway under which the company does not start anything new. */
export const COMFORTABLE_RUNWAY_DAYS = 30;
/** Days between two rewrites of a sales page: a page needs traffic before it is judged again. */
export const PAGE_REWORK_GAP_DAYS = 7;
/** Guides waiting for the founder's word before the company stops starting new ones: enough to choose from. */
export const MAX_AWAITED_PUBLISHES = 2;
/** Client messages answered a day: this much at least, and this much per person who answers them. */
const REPLIES_FLOOR = 24;
const REPLIES_PER_OWNER = 12;

/** Under growth, production grows with the people who write: a writer more, one guide more, or the second writer has nothing to write (D40). */
export function chainSlots(w: WorldState): number {
  return clamp(ownersOfAny(w, ['write_pdf']).filter((a) => !a.hatKinds.includes('write_pdf')).length + 1, 2, 6);
}

/** Under growth, support grows with the team that answers: a fixed cap turns into chargebacks past 100 sales a day (D40). */
export function replyCap(w: WorldState): number {
  return Math.max(REPLIES_FLOOR, REPLIES_PER_OWNER * ownersOfAny(w, ['reply_inbox']).length);
}

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

/** What buyers said about the current version: a v2 brief never quotes someone who did not buy, nor an insult. */
export function customerFeedback(ctx: RuntimeCtx, p: Product, since: number): string[] {
  const out = feedbackOf(ctx.world, p.id).filter((f) => f.day >= since && f.text && isProductFeedback(f.text)).map((f) => f.text);
  for (const r of recentReviews(p)) if (r.day >= since && r.rating <= 2 && isProductFeedback(r.text)) out.push(`Avis ${r.rating}/5 : ${r.text}`);
  return uniq(out).slice(0, 6);
}

/** Buyers themselves say something is wrong: a rewrite can help. Otherwise the problem is the market, not the text. */
function buyersUnhappy(ctx: RuntimeCtx, p: Product): boolean {
  const h = productHealth(ctx.world, p);
  const m = productMetrics(ctx.world, p.id, h.since);
  return (h.reviews.length >= 3 && h.rating > 0 && h.rating < 4) || detectedComplaints(ctx.world, p.id, h.since) >= 2 || refundsTooHigh(m.refunds, m.sales);
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
      await killProduct(ctx, p, `même la v${p.version} reste inacceptable pour les acheteurs (${h.severe})`);
      notes.push(`« ${p.title} » arrêté : ${h.severe} malgré ${p.version - 1} réécriture(s).`);
      continue;
    }
    await pauseProduct(ctx, p, h.severe);
    items.push(reworkItem(ctx, p, `Produit mis en pause (${h.severe}) : on le retravaille avant de le revendre.`));
    notes.push(`« ${p.title} » mis en pause (${h.severe}) → v${p.version + 1}.`);
  }
  for (const p of w.company.products.filter((x) => x.status === 'paused')) {
    if (handled.has(p.id) || productHold(w, p.id) || openTasksForProduct(ctx, p.id).length) continue;
    if (p.version >= 3) {
      await killProduct(ctx, p, `en pause depuis la v${p.version} sans version acceptable`);
      notes.push(`« ${p.title} » arrêté après ${p.version - 1} réécriture(s).`);
      continue;
    }
    items.push(reworkItem(ctx, p, 'Produit en pause sans réécriture en cours : on relance la nouvelle version.'));
    notes.push(`« ${p.title} » : la réécriture reprend (v${p.version + 1}).`);
  }
  const budget = currentBudget(w);
  const adsOff = budget.survival || budget.outage || adBanActive(w);
  for (const p of w.company.products.filter((x) => x.status === 'live')) {
    if (handled.has(p.id)) continue;
    const h = productHealth(w, p);
    const online = w.day - h.since;
    if (!p.launchedDay || online < 7) continue;
    const m = productMetrics(w, p.id, Math.max(h.since, w.day - KILL_WINDOW_DAYS));
    const upsell = isUpsellProduct(w, p.id);
    // Upsells live off their parent's buyers: they are not judged on their own acquisition, and neither is an orphan
    // before a paid test of its own (it had no ads by design: those weeks say nothing about what it can sell alone).
    const unjudged = upsell || (m.spend <= 0 && !!parentOf(w, p.id));
    // "Failing" needs a real sample: either enough paid visitors to see that nobody buys, or two weeks without
    // traction. (Before: < 3 sales after 7 days, i.e. ~100 € of ads and 200 visitors — at a 2 % conversion that
    // is bad luck one time in five, and it killed the first niche, often the best one, in a third of the runs.)
    // Without ads, "no traction" only counts for a guide that was really shown (organic posts): one the budget went
    // past has proved nothing, it costs nothing to keep and its turn may come.
    const posts = w.market.organicPosts.filter((x) => x.productId === p.id && x.day >= w.day - KILL_WINDOW_DAYS).length;
    // Neither has one the founder kept off the ads: his refusal is not the market's.
    const failing = !unjudged && !isReworking(w, p.id) && m.sales < KILL_MAX_SALES && (m.spend > 0 ? m.roas < KILL_MAX_ROAS : !adsOff && posts >= KILL_MIN_POSTS && !adsHeldSince(w, p.id, w.day - KILL_WINDOW_DAYS))
      && (m.landingViews >= KILL_MIN_VIEWS || online >= KILL_NO_TRACTION_DAYS);
    // Quality dead-end: even the v3 is rated badly by its own buyers → stop selling it, it hurts the brand.
    const hopeless = p.version >= 3 && online >= 5 && h.reviews.length >= 5 && h.rating > 0 && h.rating < 3.2;
    if (failing || hopeless) {
      const roas = Number.isFinite(m.roas) ? dec(m.roas) : '—';
      const reason = hopeless
        ? `même la v${p.version} reste notée ${dec(h.rating, 1)}/5 par ses acheteurs (${h.reviews.length} avis)`
        : `${Math.min(online, KILL_WINDOW_DAYS)} derniers jours de la v${p.version} : ${m.sales} vente(s), ROAS ${roas} pour ${eur(m.spend)} de pub`;
      await killProduct(ctx, p, reason);
      notes.push(`« ${p.title} » arrêté (${hopeless ? 'qualité perçue trop basse' : `${m.sales} ventes en ${Math.min(online, KILL_WINDOW_DAYS)} jours`}).`);
      continue;
    }
    // Sold a lot once, loses money now: no more budget. Unhappy buyers can be answered by a rewrite; a guide its
    // readers like but that never pays back its ads cannot, the market is the problem.
    const loss = isReworking(w, p.id) ? null : recentLoss(w, p);
    if (!loss) continue;
    const verdict = `perd ${eur(-loss.profit)} sur ${LOSS_WINDOW_DAYS} jours malgré ${loss.campaigns} campagnes (ROAS ${dec(loss.roas)})`;
    if (p.version < 3 && buyersUnhappy(ctx, p)) {
      items.push(reworkItem(ctx, p, `« ${short(p.title, 40)} » ${verdict} et ses acheteurs se plaignent : plus de budget avant la v${p.version + 1}.`));
      notes.push(`« ${p.title} » ${verdict} → v${p.version + 1}, sans budget d'ici là.`);
      continue;
    }
    await killProduct(ctx, p, verdict);
    notes.push(`« ${p.title} » arrêté : ${verdict}.`);
  }
}

// ───────────────────────────── pricing ─────────────────────────────

export { PRICE_EVIDENCE_VIEWS, PRICE_ROLLBACK_RATIO };
/** Days at a price before it may be raised again (with PRICE_RAISE_SALES sales since the change). */
export const PRICE_RAISE_DAYS = 4;
export const PRICE_RAISE_SALES = 6;
/** Below this paid conversion on PRICE_DOWN_VIEWS visitors since the last change, the price goes one tier down. */
export const PRICE_DOWN_CVR = 0.008;
export const PRICE_DOWN_VIEWS = 300;
/** Under this price a guide cannot pay for its ads however well it sells: a paid visitor costs about 0,30 € and 2 % of them buy. */
export const PAID_PRICE_FLOOR = 14;
const PRICE_TIERS = [9, 14, 19, 24, 29, 39, 49];
/** How far back the sales behind a raise are read: a price that held for months says little of this month. */
const PRICE_READ_DAYS = 60;

/** Ad revenue per paid landing view of a product over [from, to] (what one more visitor is worth at that price), on its reference channel. */
export function revenuePerVisitor(w: RuntimeCtx['world'], productId: string, from: number, to: number): { views: number; rpv: number } {
  const channel = referenceChannel(w, productId);
  let views = 0, revenue = 0;
  for (const s of w.market.adStats) {
    if (s.productId !== productId || s.day < from || s.day > to || channelOf(s) !== channel) continue;
    views += s.landingViews; revenue += s.revenue;
  }
  return { views, rpv: views > 0 ? revenue / views : 0 };
}

/**
 * The price decision of the day for a live product (observable data only), or null:
 *   1. a finished A/B price test whose winner is not applied → apply it (before, the price stayed on whatever
 *      variant was set last, e.g. 39 € after a test that said 29 €); no winner → back to the control price;
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
  const done = [...tests].reverse().find((e) => e.status !== 'running');
  if (done && (done.endDay ?? done.day) >= lastChange) {
    const winner = Number(done.winner);
    const won = done.winner !== null && Number.isFinite(winner) && winner > 0;
    // Inconclusive test → back to the price before the test (its control), not to whichever variant ran last.
    const control = [...hist].reverse().find((h) => h.day < done.day)?.price ?? Number(done.variants[0]);
    const target = won ? winner : control;
    if (Number.isFinite(target) && target > 0 && target !== p.price) {
      return {
        input: { productId: p.id, reason: won ? 'winner' : 'controle', price: target },
        why: won
          ? `Le test A/B de prix a conclu : ${eur(target)} rapporte le plus par visiteur (on était resté à ${eur(p.price)}).`
          : `Test de prix ${done.status === 'cancelled' ? 'annulé' : 'non concluant'} : retour au prix de contrôle (${eur(target)}).`,
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
  const lower = [...PRICE_TIERS].reverse().find((t) => t < p.price && t >= PAID_PRICE_FLOOR);
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
  if (abandoned || up > priceCeiling(w, p).ceiling) return null;
  if (p.price < PAID_PRICE_FLOOR && !isUpsellProduct(w, p.id)) return { input: { productId: p.id, reason: 'hausse' }, why: `À ${eur(p.price)}, un guide ne rembourse jamais sa pub : on passe au palier suivant sans attendre.` };
  const sinceChange = productMetrics(w, p.id, Math.max(lastChange, day - PRICE_READ_DAYS));
  const goodRating = p.stats.reviews.length < 3 || p.stats.rating >= 4.2;
  if (sinceChange.sales >= PRICE_RAISE_SALES && goodRating && sinceChange.refundRate < 0.08 && day - lastChange >= PRICE_RAISE_DAYS) {
    return { input: { productId: p.id, reason: 'hausse' }, why: `${sinceChange.sales} ventes depuis le dernier prix, avis bons : on monte d'un palier.` };
  }
  return null;
}

/**
 * Announced payment outage: nothing can sell today, so nothing is spent. The CFO's envelope is at 0 (no launch, no
 * scale); every running campaign is paused for the day and resumed the next morning, inside the new envelope.
 * Read from the public announcement only, as a real company would.
 */
export function reactToOutage(ctx: RuntimeCtx): boolean {
  const w = ctx.world;
  if (sim.isAnnouncedOutage(w, w.day)) {
    const running = activeCampaigns(w);
    for (const c of running) {
      if (ctx.tools.updateCampaign(c.id, { status: 'paused' }).ok) c.status = 'paused';
      c.pausedFor = 'outage';
    }
    const paused = w.company.campaigns.filter((c) => c.pausedFor === 'outage').length;
    speak(ctx, 'ceo', `panne de paiement annoncée aujourd'hui, aucune vente possible. ${paused ? `${paused} campagne(s) en pause` : 'Aucune campagne à couper'}, enveloppe pub à 0, ni lancement ni hausse de budget. On reprend demain matin.`, 'meeting');
    incident(ctx, `Panne de paiement du jour ${w.day} : pubs en pause, aucune vente possible`);
    return true;
  }
  const { resumed, left } = resumeCampaigns(ctx, 'outage');
  if (resumed.length) speak(ctx, 'growth', `la panne est passée, ${resumed.length} campagne(s) reprennent ce matin`, 'ad');
  if (left.length) speak(ctx, 'growth', `${left.length} campagne(s) restent en pause après la panne (produit, budget ou compte) : ${short(left.join(', '), 90)}`, 'ad');
  return false;
}

/** Campaigns paused for this reason start again inside the CFO's envelope, unless their product or their channel can no longer take ads. */
export function resumeCampaigns(ctx: RuntimeCtx, reason: 'outage' | 'founder', productId?: string, channels?: readonly ChannelId[]): { resumed: string[]; left: string[] } {
  const w = ctx.world;
  let room = currentBudget(w).adCap - committedAdBudget(w);
  const resumed: string[] = [];
  const left: string[] = [];
  for (const c of w.company.campaigns.filter((x) => x.pausedFor === reason && (!productId || x.productId === productId) && (!channels || channels.includes(channelOf(x))))) {
    delete c.pausedFor;
    const p = productOf(ctx, c.productId);
    const daily = Math.min(c.dailyBudget, Math.floor(room));
    if (!p || p.status !== 'live' || channelPaused(w, channelOf(c)) || productPaidBlock(w, p, channelOf(c))?.final || daily < CHANNELS[channelOf(c)].minDailyBudget) { left.push(c.name); continue; }
    if (daily < c.dailyBudget && ctx.tools.updateCampaign(c.id, { dailyBudget: daily }).ok) c.dailyBudget = daily;
    if (!ctx.tools.updateCampaign(c.id, { status: 'active' }).ok) { left.push(c.name); continue; }
    c.status = 'active';
    room -= c.dailyBudget;
    resumed.push(c.name);
  }
  return { resumed, left };
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
  // This is TikTok's plan: a test running on another channel leaves a guide waiting here, and a ban there stops nothing.
  const waiting = candidates.filter((c) => !activeCampaigns(w, c.product.id).some((x) => channelOf(x) === 'tiktok'));
  const companyBlock = companyPaidBlock(w, 'tiktok');
  const idle = daysWithoutAds(w);
  const budget = currentBudget(w);
  let room = budget.adCap - committedAdBudget(w);
  const perLaunch = clamp(budget.cash * 0.04, MIN_CAMPAIGN_BUDGET, policyOf(w).testDailyEur);
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
    let inFlight = openTasks(w, (t) => t.input.productId === p.id && taskChannel(t) === 'tiktok' && (t.kind === 'launch_campaign' || t.kind === 'write_ad_hooks' || t.kind === 'produce_ad'));
    // Watchdog: acquisition tasks that have been sitting for 2+ days while nothing runs are stuck → start again.
    // Waiting for the founder is not being stuck, and neither is a task he just approved: it runs at the next work tick.
    if (inFlight.length && idle >= MAX_IDLE_DAYS && !companyBlock && (!cand.block || !cand.block.hard)
      && inFlight.every((t) => t.status !== 'awaiting_founder' && t.input.founderApproved !== true && t.status !== 'in_progress' && t.dayCreated <= w.day - MAX_IDLE_DAYS)) {
      for (const t of inFlight) { t.status = 'cancelled'; t.dayDone = w.day; logTask(t, `Jour ${w.day} : annulée — bloquée depuis le jour ${t.dayCreated}, on repart de zéro.`); }
      speak(ctx, 'ceo', `${idle} jours sans pub et ${inFlight.length} tâche(s) d'acquisition bloquée(s) sur « ${short(p.title, 40)} » — on repart de zéro`, 'thought', { productId: p.id });
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
        else createTask(w, { kind: 'launch_campaign', title: titled('launch_campaign', p), input: { productId: p.id, nicheId: p.nicheId }, dependsOn: inFlight.map((t) => t.id), createdBy: officerId(w, 'ceo'), priority: 2 });
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
    const test = waiting.find((c) => c.block?.hard && !c.block.final && !openTasks(w, (t) => t.input.productId === c.product.id && ['launch_campaign', 'write_ad_hooks', 'produce_ad'].includes(t.kind)).length);
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
  if (!launchedFor && waiting.length && companyBlock) speak(ctx, 'growth', `pas de nouvelle campagne aujourd'hui — ${companyBlock}`, 'ad');
  for (const r of reasons.slice(0, 2)) speak(ctx, 'growth', `pas de pub aujourd'hui pour ${r}`, 'ad');
  if (blocked && !launchedFor) notes.push(`Acquisition payante bloquée : ${blocked}.`);
  return { launchedFor, blocked };
}

/** The active lesson with this key, if the retro last confirmed it on the current version. */
function lessonOf(ctx: RuntimeCtx, key: string, since: number): Lesson | null {
  return ctx.world.company.lessons.find((l) => l.key === key && lessonDay(l) >= since) ?? null;
}

export async function buildHeuristicPlan(ctx: RuntimeCtx): Promise<DayPlan> {
  const w = ctx.world;
  const day = w.day;
  const items: DayPlanItem[] = [];
  const notes: string[] = [];
  await ceoDecisions(ctx, notes, items);

  const budget = currentBudget(w);
  if (budget.outage) notes.push(`Panne de paiement annoncée aujourd'hui : pubs en pause, reprise demain matin.`);
  const products = w.company.products;
  const live = products.filter((p) => p.status === 'live');
  const building = products.filter((p) => !['live', 'killed', 'paused'].includes(p.status));
  const open = (kind: TaskKind, pid?: string) => openTasks(w, (t) => t.kind === kind && (!pid || t.input.productId === pid)).length > 0;
  // A guide waiting for the founder's word is out of the team's hands: the company does not stop for it.
  const awaited = (p: Product) => openTasks(w, (t) => t.kind === 'publish_product' && t.status === 'awaiting_founder' && t.input.productId === p.id).length > 0;
  const producing = building.filter((p) => !awaited(p));
  const growth = growthOn(w);
  const chains = growth ? chainSlots(w) : MAX_AWAITED_PUBLISHES;
  const mayStart = !launchHold(w) && building.length - producing.length < chains;

  // 1. Nothing to sell and nothing in the oven → find the next niche.
  if (mayStart && !live.length && !producing.length && !open('scan_trends') && !open('pick_opportunity') && !open('mine_pains')) {
    const excluded = excludedNiches(ctx, { includeActive: true });
    const shortlist = w.company.research.shortlist.filter((id) => !excluded.includes(id));
    if (w.company.research.trends.length && shortlist.length) items.push(planItem('pick_opportunity', {}, 'La shortlist a encore des niches non testées : on choisit la suivante.', 1));
    else items.push(planItem('scan_trends', { chain: 'opportunity' }, day === 1 ? 'Jour 1 : trouver un problème précis pour lequel les gens paient déjà.' : 'Plus aucune piste exploitable : nouveau scan du marché.', 1));
  }

  // 1b. Diversify on capacity and evidence: mains that lose money do not fill the portfolio, the envelope says how many
  //     products the company can feed, and a comfortable cash position keeps the production going.
  const mains = live.filter((p) => !isUpsellProduct(w, p.id));
  const profits14 = recentProfits(w, LOSS_WINDOW_DAYS);
  const profits7 = recentProfits(w, 7);
  const launchedLately = (p: Product) => (p.launchedDay ?? day) > day - 7;
  const earning = mains.filter((p) => launchedLately(p) || (profits14.get(p.id) ?? 0) > 0);
  const { maxMains } = policyOf(w);
  const capacity = growth ? maxMains : clamp(Math.floor(budget.adCap / AD_ROOM_PER_MAIN), 1, maxMains);
  const comfortable = !budget.survival && !budget.bankrupt && budget.cash >= w.scenario.startingCash && (budget.runwayDays === null || budget.runwayDays >= COMFORTABLE_RUNWAY_DAYS);
  // One main in production at a time, under growth one per writer: more guides waiting alone would still leave a second writer idle.
  const inProduction = producing.filter((p) => !isUpsellProduct(w, p.id)).length >= (growth ? chains - 1 : 1);
  if (mayStart && (live.length || products.some((p) => p.status === 'paused')) && !inProduction && earning.length < capacity && !open('scan_trends') && !open('pick_opportunity') && !budget.survival && w.status !== 'bankrupt') {
    const lastCreated = Math.max(0, ...products.filter((p) => !isUpsellProduct(w, p.id)).map((p) => p.createdDay));
    const sinceLast = day - lastCreated;
    const settled = earning.every((p) => {
      const m7 = productMetrics(w, p.id, Math.max(1, day - 6));
      const mature = (p.launchedDay ?? day) <= day - 7;
      return p.upsellProductId !== null || (mature && (m7.spend > 0 ? m7.roas < 1.2 : m7.sales < 5));
    });
    // Nothing can take paid ads now or soon (all paused, disliked or "ads-dead"): do not wait 8 days.
    const nothingToPush = !acquisitionCandidates(w).some((c) => !c.block || !c.block.hard);
    const losing = mains.find((p) => !launchedLately(p) && (profits7.get(p.id) ?? 0) < 0);
    const why = nothingToPush && sinceLast >= REPLACE_NICHE_DAYS ? 'Plus rien à pousser en pub : on ouvre une nouvelle niche.'
      : sinceLast >= 8 && settled ? 'Le portefeuille plafonne : on ouvre une nouvelle niche pour ne pas dépendre d’un seul produit.'
        : comfortable && losing && sinceLast >= REPLACE_NICHE_DAYS ? `« ${short(losing.title, 40)} » perd de l'argent depuis une semaine et la trésorerie suit : on prépare la relève.`
          : comfortable && sinceLast >= GROWTH_NICHE_DAYS ? `Trésorerie confortable (${eur(budget.cash)}), ${earning.length} produit(s) rentable(s) pour ${capacity} possibles : on lance le suivant.` : null;
    const excluded = excludedNiches(ctx, { includeActive: true });
    const untested = w.company.research.trends.filter((t) => !excluded.includes(t.nicheId)).length > 0 || !w.company.research.trends.length;
    if (why && untested) {
      const shortlist = w.company.research.shortlist.filter((id) => !excluded.includes(id));
      if (shortlist.length) items.push(planItem('pick_opportunity', {}, why, 2, 'Choisir une nouvelle niche (diversification)'));
      else items.push(planItem('scan_trends', { chain: 'opportunity' }, why, 2, 'Scanner les tendances (diversification)'));
      notes.push('Diversification : nouvelle niche à l’étude.');
    }
  }

  // 1c. The market moves: a weekly watch (trends, competitors of what we sell) while the company can look ahead.
  const lastDone = w.company.lastDone ?? {};
  const lastScan = Math.max(lastDone['scan_trends:'] ?? 0, ...w.company.tasks.filter((t) => t.kind === 'scan_trends' && t.status !== 'cancelled' && t.status !== 'failed').map((t) => t.dayDone ?? t.dayCreated));
  if ((live.length || building.length > producing.length) && day - lastScan >= RESEARCH_REFRESH_DAYS && !open('scan_trends') && !budget.survival && w.status !== 'bankrupt') {
    items.push(planItem('scan_trends', { refresh: true }, 'Veille hebdomadaire : nouvelles tendances, prix et concurrents.', 3, 'Rafraîchir la veille du marché'));
  }

  // 2. Production chains stuck without any open task → resume them.
  for (const p of building) {
    if (!openTasksForProduct(ctx, p.id).length) items.push(planItem('write_pdf', { productId: p.id, pipeline: 'resume' }, `La chaîne de « ${short(p.title, 40)} » est bloquée : on relance les étapes manquantes.`, 1, `Relancer la production — « ${short(p.title, 42)} »`));
  }

  // 3. Live products: acquisition, quality loop, pricing, upsell.
  // Organic first: TikTok throttles reach beyond ~5 posts a day, so the community manager gets 4 slots: a guide just launched first (it
  // has no numbers yet), then by what each product earned over two weeks, at most 2 per product. A product that fails
  // the quality gate (bad rating, refunds) or loses money is never promoted.
  const promotable = live.filter((p) => !promotionBlock(w, p));
  const justLaunched = (p: Product) => !isUpsellProduct(w, p.id) && launchedLately(p);
  const postOrder = [...promotable].sort((a, b) => Number(justLaunched(b)) - Number(justLaunched(a)) || (profits14.get(b.id) ?? 0) - (profits14.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  let postSlots = ORGANIC_POSTS_PER_DAY;
  for (let round = 0; round < ORGANIC_POSTS_PER_PRODUCT; round++) {
    for (const p of postOrder) {
      if (postSlots <= 0) break;
      const upsell = isUpsellProduct(w, p.id);
      const wants = upsell ? 1 : ORGANIC_POSTS_PER_PRODUCT;
      if (round >= wants) continue;
      items.push(planItem('post_organic', { productId: p.id, slot: round }, upsell ? 'Faire connaître la suite au même public.' : 'Parler du point de douleur gratuitement, tous les jours.', 3, titled('post_organic', p)));
      postSlots--;
    }
  }

  const acquisition = planPaidAcquisition(ctx, items, notes);
  planChannels(ctx, items, notes);

  for (const p of live) {
    const pid = p.id;
    const upsell = isUpsellProduct(w, pid);
    const sold = Math.max(p.stats.sales, productMetrics(w, pid).sales); // a life's sales: the orders held only reach back 120 days
    const m7 = productMetrics(w, pid, Math.max(1, day - 6));
    const canPromote = !promotionBlock(w, p);

    const lastScout = Math.max(lastDone[`find_creators:${pid}`] ?? 0, ...w.company.tasks.filter((t) => t.kind === 'find_creators' && t.input.productId === pid).map((t) => t.dayCreated));
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
    const refundBad = refundsWorthRework(v.refunds, v.sales);
    const reworking = isReworking(w, pid);
    // A quality lesson of the retro is an order, as long as the numbers of the current version still back it.
    const qualityLesson = lessonOf(ctx, learning.LESSON_KEYS.quality(pid), since);
    const lessonBacked = !!qualityLesson && (refundBad || (health.reviews.length >= 3 && health.rating > 0 && health.rating < 3.8));
    if ((complaints >= 3 || ratingBad || refundBad || lessonBacked) && p.version < 3 && !reworking && day - since >= 2) {
      const why = complaints >= 3 ? `${complaints} plaintes qualité remontées par le support` : ratingBad ? `note moyenne ${dec(health.rating, 1)}/5` : lessonBacked ? `leçon du jour ${lessonDay(qualityLesson!)}` : `taux de remboursement ${pct(v.refundRate)}`;
      items.push(reworkItem(ctx, p, `Boucle qualité : ${why} → v${p.version + 1}.`));
    }
    // A conversion lesson of the retro rewrites the page; it does not stay a sentence in a playbook.
    const pageLesson = lessonOf(ctx, learning.LESSON_KEYS.page(pid), since);
    const lastPage = Math.max(p.launchedDay ?? 0, lastDone[`write_sales_page:${pid}`] ?? 0, ...w.company.tasks.filter((t) => t.kind === 'write_sales_page' && t.status === 'done' && t.input.productId === pid).map((t) => t.dayDone ?? 0));
    if (pageLesson && lessonDay(pageLesson) >= lastPage && day - lastPage >= PAGE_REWORK_GAP_DAYS && !reworking && !open('write_sales_page', pid)) {
      items.push(planItem('write_sales_page', { productId: pid, reason: 'lesson', fixes: ['Reprendre les mots exacts des clients et traiter leurs objections avant qu’ils les posent.'] }, `Leçon du jour ${lessonDay(pageLesson)} : ${short(pageLesson.insight, 110)}`, 2, titled('write_sales_page', p, ' (leçon de conversion)')));
    }

    const priceExp = w.company.experiments.find((e) => e.status === 'running' && e.dimension === 'price' && e.hypothesis.includes(p.title.slice(0, 30)));
    if (priceExp && !open('set_price', pid)) {
      items.push(planItem('set_price', { productId: pid, reason: 'experiment' }, `Test de prix en cours (${priceExp.variants.join(' € vs ')} €) : on alterne.`, 2, titled('set_price', p)));
    } else if (!open('set_price', pid)) {
      const move = priceMove(ctx, p);
      if (move) items.push(planItem('set_price', move.input, move.why, 2, titled('set_price', p)));
    }

    const liked = p.stats.reviews.length < 3 || p.stats.rating >= 3.8;
    const profitable = sold >= 10 && liked && (m7.spend > 0 ? m7.roas >= 1.5 : m7.sales >= 5);
    const noSubject = latestOutput(w, 'design_upsell', pid)?.noSubject === true; // already looked: nothing distinct to sell them
    if (!upsell && !p.upsellProductId && profitable && !noSubject && !launchHold(w) && !open('design_upsell', pid)) {
      items.push(planItem('design_upsell', { productId: pid }, `Produit rentable (ROAS 7 j ${Number.isFinite(m7.roas) ? dec(m7.roas) : '∞'}, ${sold} ventes) : la suite pour le même public.`, 2, titled('design_upsell', p)));
    }
  }

  // 4. Media buying.
  const buyWhy = budget.survival ? 'Mode survie : on coupe tout ce qui ne rapporte pas.' : 'Stop-loss, scale progressif et créas fatiguées.';
  if (multiChannel(w)) {
    // One task per channel, so each buyer holds their own campaigns (D25).
    const running = new Set(activeCampaigns(w).map(channelOf));
    for (const ch of [...running].sort()) items.push(planItem('optimize_ads', { channel: ch }, buyWhy, 1, `Optimiser les campagnes ${CHANNELS[ch].label}`));
  } else if (activeCampaigns(w).length) items.push(planItem('optimize_ads', {}, buyWhy, 1));

  // 5. Inbox: batches of 6, most urgent first.
  const claimed = claimedMessageIds(w);
  const inbox = openMessages(ctx).filter((m) => !claimed.has(m.id)).sort((a, b) => urgency(b, day) - urgency(a, day) || a.day - b.day);
  const replies = growth ? replyCap(w) : REPLIES_FLOOR;
  for (let i = 0; i < inbox.length && i < replies; i += 6) {
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
    items.push(planItem('handle_refund', { orderId: order.id, messageId: m.id, productId: order.productId, reason: 'Client escaladé : on rembourse avant le chargeback' }, 'Un chargeback coûte le montant + 15 € : on rembourse de bonne foi.', 1, `Rembourser ${eur(sim.repayableLeft(order))} avant chargeback`));
    refunds++;
  }

  // 6. Analysis.
  if (day >= 2) items.push(planItem('daily_report', { day: day - 1 }, 'Raconter la veille en chiffres.', 3, `Rapport du jour ${day - 1}`));
  // Rituals of the back office: the books of yesterday, the week's P&L, the follow-up of what is open.
  if (day >= 2) items.push(planItem('reconcile_ledger', { day: day - 1 }, 'Chaque ligne de la veille doit coller aux ventes, à TikTok et aux remboursements.', 2, `Rapprocher le grand livre du jour ${day - 1}`));
  if (day >= 8 && (day - 1) % 7 === 0) items.push(planItem('weekly_pnl', {}, 'Savoir ce que chaque produit rapporte vraiment, frais et remboursements compris.', 2, `P&L de la semaine ${Math.ceil((day - 1) / 7)} par produit`));
  if (day >= 2) items.push(planItem('follow_missions', {}, 'Rien ne doit dormir : les missions du fondateur avancent, les tâches bloquées repartent.', 2));
  if (day >= 3 && !open('run_experiment') && (experimentCandidate(ctx) || w.company.experiments.some((e) => e.status === 'running'))) {
    items.push(planItem('run_experiment', {}, 'Transformer les intuitions en tests A/B mesurés.', 3));
  }

  // Focus + memo.
  const fin = sim.financeSnapshot(w);
  const lead = live[0] ?? producing[0] ?? building[0];
  let focus: string;
  if (w.status === 'bankrupt') focus = 'Trésorerie négative : zéro dépense, support et organique uniquement';
  else if (budget.outage) focus = 'Panne de paiement annoncée : pubs en pause, on avance sur le support et la production';
  else if (budget.survival) focus = 'Mode survie : organique, créateurs à la commission, aucune pub non rentable';
  else if (!live.length && !building.length) focus = 'Trouver une niche rentable (règle du un)';
  else if (!live.length && lead) focus = awaited(lead) ? `« ${short(lead.title, 50)} » attend la décision du fondateur` : `Sortir « ${short(lead.title, 50)} » : la chaîne de production tourne`;
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
  return [kind, input.productId, input.nicheId, input.campaignId, input.creatorId, input.orderId, strArr(input.messageIds).join(','), input.slot, input.reason, input.pipeline, input.day, input.channel]
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
    // What the founder took off the shelf stays there, whatever the engine plans.
    if (it && !(typeof it.input.productId === 'string' && productHold(ctx.world, it.input.productId))) out.set(itemKey(it.kind, it.input), it);
  }
  for (const it of heuristic.items) {
    const key = itemKey(it.kind, it.input);
    if (!out.has(key)) out.set(key, it);
  }
  return [...out.values()];
}

export interface MaterializeOpts { createdBy: Task['createdBy']; missionId: string | null; priority?: 1 | 2 | 3; assignee?: string | null }

/** A rewrite waits for fresh research and is told what this version leaves out, or it would print the same guide again. */
function planRewrite(ctx: RuntimeCtx, product: Product, v2: Task[], research: Task): Task[] {
  const first = v2[0];
  if (first) first.dependsOn.push(research.id);
  const human = v2.find((t) => t.kind === 'humanize_pdf');
  if (human && product.content) human.input.gaps = guideGaps(product.content, vocOf(ctx, product.nicheId));
  return v2;
}

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
      if (pipeline === 'v2') {
        const v2 = createV2Pipeline(ctx, product, strArr(input.feedback), pOpts);
        const listen = createTask(w, { kind: 'mine_pains', title: `Réécouter les clients avant la v${product.version} — ${short(product.audience, 40)}`, input: { nicheId: product.nicheId, depth: 'deep' }, createdBy: opts.createdBy, missionId: opts.missionId, priority });
        created.push(listen, ...planRewrite(ctx, product, v2, listen));
      } else if (pipeline === 'resume') created.push(...resumePipeline(ctx, product, pOpts));
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
  [/prix|tarif|\b(?:mets?|passe|fixe|vends?)\b(?!.*\b(?:budget|par jour)\b).*\d\s*(?:€|euros?)(?!\s*\/)/i, 'set_price'],
  [/page de vente|copywriting/i, 'write_sales_page'],
  [/couverture/i, 'design_cover'],
  [/r[ée][ée]cri|am[ée]liore|qualit[ée]|humanis|v2/i, 'humanize_pdf'],
  [/rembours/i, 'reply_inbox'],
  [/mail|support|message|client/i, 'reply_inbox'],
  [/cr[ée]ateur|influenc|partenari|affili/i, 'find_creators'],
  [/rapport|kpi|chiffres|bilan/i, 'daily_report'],
  [/compta|grand livre|rapprochement/i, 'reconcile_ledger'],
  [/p&l|pnl|compte de r[ée]sultat|marge|tr[ée]sorerie/i, 'weekly_pnl'],
  [/suivi|relance|en retard|bloqu/i, 'follow_missions'],
  [/test|exp[ée]rience|a\/b/i, 'run_experiment'],
  [/red team|critique|tuer|risque/i, 'red_team'],
];

/** A channel the founder names, in his words. */
const CHANNEL_WORDS: [RegExp, ChannelId][] = [
  [/\b(?:meta|facebook|instagram)\b/i, 'meta'],
  [/\bpinterest\b/i, 'pinterest'],
  [/\byoutube\b/i, 'youtube'],
  [/\bgoogle\b/i, 'google'],
];

/** The founder names a closed channel: its account is asked for, through the buyer and the money gates like any other. */
function channelMission(ctx: RuntimeCtx, text: string): DayPlanItem | null {
  const ch = CHANNEL_WORDS.find(([rx]) => rx.test(text))?.[1];
  if (!ch || !ctx.world.company.channels || openChannels(ctx.world).includes(ch)) return null;
  return planItem('open_channel', { channel: ch }, `Mission du fondateur : ${short(text, 80)}`, 1, `Ouvrir le canal ${CHANNELS[ch].label} (mission du fondateur)`);
}

/** Keyword routing when the engine could not interpret a founder mission. */
export function keywordMission(ctx: RuntimeCtx, text: string): DayPlanItem[] {
  const opening = channelMission(ctx, text);
  const kinds = uniq(MISSION_RULES.filter(([rx]) => rx.test(text)).map(([, k]) => k)).slice(0, 3);
  const vague = !kinds.length;
  if (vague) kinds.push('daily_report');
  const out: DayPlanItem[] = opening ? [opening] : [];
  if (opening && vague) return out;
  for (const kind of kinds) {
    const input: Record<string, unknown> = {};
    if (kind === 'scan_trends') input.chain = 'opportunity';
    if (kind === 'write_ad_hooks') { input.produce = 2; input.launch = !activeCampaigns(ctx.world).length; }
    if (kind === 'red_team') input.subject = 'pdf';
    if (kind === 'daily_report') input.day = Math.max(1, ctx.world.day - 1);
    if (vague) input.vague = true;
    const it = normalizeItem(ctx, { kind, title: `${KIND_META[kind].label} (mission du fondateur)`, dept: KIND_META[kind].dept, priority: 1, input, why: `Mission du fondateur : ${short(text, 80)}` });
    if (it) out.push(it);
  }
  return out;
}

/**
 * The founder's price decision: a stated amount, else one tier up or down when the text says so.
 * The other price tasks follow the company's own rules (tests, playbook, bandit).
 */
function founderPrice(ctx: RuntimeCtx, input: Record<string, unknown>): void {
  const stated = numOf(input.price);
  const text = str(input.missionText) ?? '';
  const current = productOf(ctx, input.productId)?.price ?? 0;
  const tier = /baiss|diminu|r[ée]dui|moins cher/i.test(text) ? [...PRICE_TIERS].reverse().find((t) => t < current)
    : /augment|hausse|monte|plus cher/i.test(text) ? PRICE_TIERS.find((t) => t > current) : undefined;
  const price = stated && stated > 0 ? stated : tier;
  if (price) { input.price = price; input.reason = 'fondateur'; }
}

/** Fills the inputs a founder item needs (e.g. a launch needs creatives, a scan feeds a pick only if a product is wanted). */
export function prepareFounderItem(ctx: RuntimeCtx, it: DayPlanItem, wantsProduct = false): DayPlanItem {
  const input = { ...it.input };
  if (it.kind === 'scan_trends') { if (wantsProduct) input.chain = 'opportunity'; else delete input.chain; }
  if (it.kind === 'set_price') founderPrice(ctx, input);
  if (it.kind === 'write_ad_hooks' && input.produce === undefined) input.produce = 2;
  if (it.kind === 'red_team' && input.subject === undefined) input.subject = productOf(ctx, input.productId)?.content ? 'pdf' : 'idea';
  return { ...it, input, priority: 1, title: it.title.includes('fondateur') ? it.title : `${it.title} (mission du fondateur)` };
}

export function describePlan(ctx: RuntimeCtx, plan: DayPlan): string {
  return `${nameOf(ctx, officerId(ctx.world, 'ceo'))} : ${plan.focus}`;
}
