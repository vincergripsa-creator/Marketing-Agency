/**
 * Acquisition policy shared by the CEO's plan and the growth handlers (observable data only):
 *   - product health of the CURRENT version (rating, refunds) → promotable or not, severe or not;
 *   - paid-ads history per product (consecutive losing campaigns, cumulative ROAS) → cooldown / "ads-dead";
 *   - which creatives are worth (re)launching (fresh, or proven and not fatigued);
 *   - why paid acquisition is blocked today (ad ban, negative cash, survival, CFO envelope);
 *   - the ranking of the candidates, so ads and posts always go to the best products first.
 */
import type { AdCreative, Product, Review, WorldState } from '../shared.js';
import { activeCampaigns, campaignMetrics, committedAdBudget, currentBudget, isUpsellProduct, productMetrics } from './metrics.js';
import { isOpen } from './tasks.js';
import { clamp, dec, eur, pct } from './util.js';

/** Below this many reviews of the current version, the rating is not judged. */
export const MIN_REVIEWS_FOR_RATING = 3;
/** A version rated below this (with enough reviews) is never promoted: paused, reworked or killed. */
export const MIN_RATING = 3;
/** A version refunded more than this (with enough sales) is never promoted: paused, reworked or killed. */
export const MAX_REFUND_RATE = 0.15;
export const MIN_SALES_FOR_REFUND_RATE = 8;
/** Above MAX_REFUND_RATE, refunds stop a version if it no longer pays back its ads net of refunds (ROAS below this)… */
export const REFUND_GATE_MIN_ROAS = 1.1;
/** …or whatever its ROAS once refunds reach this rate. */
export const SEVERE_REFUND_RATE = 0.25;
/** A reworked version gets this many days to earn its own reviews before the store rating judges it again. */
export const FRESH_VERSION_DAYS = 10;
/** Smallest daily budget TikTok accepts for a campaign (and the CFO's smallest useful envelope). */
export const MIN_CAMPAIGN_BUDGET = 5;
/** Daily budget of the watchdog's small test campaign on an "ads-dead" version. */
export const TEST_CAMPAIGN_BUDGET = 8;
/** Stop-loss threshold (Budget et garde-fous): a campaign below this ROAS on a sufficient sample is paused. */
export const STOP_LOSS_ROAS = 0.8;
/** For relaunch decisions, a stopped campaign that did not pay back its spend counts as a loser. */
export const LOSER_ROAS = 1;
/** After this many losing campaigns in a row with a weak ROAS over the streak, paid ads stop for this version. */
export const ADS_DEAD_LOSERS = 4;
export const ADS_DEAD_ROAS = 0.7;
/** An "ads-dead" version gets one fresh test this many days after its last campaign. */
export const ADS_DEAD_RETRY_DAYS = 7;
/** Max days without paid acquisition while a promotable product and cash exist (the CEO's watchdog). */
export const MAX_IDLE_DAYS = 2;

/** Kinds that promote a product (ads or organic): never for a product that fails the quality gates. */
export const ACQUISITION_KINDS = ['write_ad_hooks', 'produce_ad', 'launch_campaign', 'post_organic', 'find_creators', 'negotiate_deal'] as const;

// ───────────────────────────── product health ─────────────────────────────

/** Day the current version of a product went (back) online. */
export function versionSince(world: WorldState, p: Product): number {
  let since = p.launchedDay ?? world.day;
  for (const t of world.company.tasks) {
    if (t.kind === 'publish_product' && t.status === 'done' && t.input.productId === p.id && t.input.republish === true && t.dayDone) since = Math.max(since, t.dayDone);
  }
  return since;
}

export interface ProductHealth {
  since: number;
  reviews: Review[];          // reviews of the current version (all of them for a v1)
  rating: number;             // 0 when no review
  sales: number;              // sales of the current version
  refundRate: number;         // refunds of the current version
  /** French reason why the current version must not be sold any more (rating / refunds), or null. */
  severe: string | null;
}

/** Lower bound of the Wilson interval (z = 1,28 → 90 % one-sided): "the true rate is at least this". */
export function wilsonLower(k: number, n: number, z = 1.28): number {
  if (n <= 0) return 0;
  const p = k / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** Refunds are "too high" only when the excess is significant, not a couple of refund hunters on a small sample. */
export function refundsTooHigh(refunds: number, sales: number): boolean {
  return sales >= MIN_SALES_FOR_REFUND_RATE && refunds >= 3 && refunds / sales > MAX_REFUND_RATE && wilsonLower(refunds, sales) > 0.1;
}

export function productHealth(world: WorldState, p: Product): ProductHealth {
  const since = versionSince(world, p);
  // A reworked version is judged on its own reviews and sales (the old ones described the old guide)…
  const reviews = p.version > 1 ? p.stats.reviews.filter((r) => r.day >= since) : p.stats.reviews;
  const rating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const m = productMetrics(world, p.id, p.version > 1 ? since : 1);
  // …but only for a while: buyers see the store rating, so after FRESH_VERSION_DAYS without enough reviews of
  // its own, a reworked version is judged on the rating displayed in the store.
  const fresh = p.version > 1 && reviews.length < MIN_REVIEWS_FOR_RATING && world.day - since < FRESH_VERSION_DAYS;
  const shown = p.stats.reviews;
  let severe: string | null = null;
  if (reviews.length >= MIN_REVIEWS_FOR_RATING && rating < MIN_RATING) severe = `note ${dec(rating, 1)}/5 sur ${reviews.length} avis`;
  else if (!fresh && shown.length >= MIN_REVIEWS_FOR_RATING && p.stats.rating > 0 && p.stats.rating < MIN_RATING) severe = `note affichée ${dec(p.stats.rating, 1)}/5 sur ${shown.length} avis`;
  // Refunds stop a version only when they are significant AND they make it lose money (or are extreme): in a
  // market full of refund hunters (cauchemar: 10-17 % of orders) a guide that still pays back its ads net of refunds
  // is worth selling — pausing, then killing it at v3 threw away the best product of the run.
  else if (refundsTooHigh(m.refunds, m.sales) && (m.refundRate >= SEVERE_REFUND_RATE || (m.spend > 0 && m.roas < REFUND_GATE_MIN_ROAS))) {
    severe = `${pct(m.refundRate, 0)} de remboursements sur ${m.sales} ventes`;
  }
  return { since, reviews, rating, sales: m.sales, refundRate: m.refundRate, severe };
}

/** A rework (rewrite → republish) of the product is in progress. */
export function isReworking(world: WorldState, productId: string): boolean {
  return world.company.tasks.some((t) => isOpen(t) && t.input.productId === productId
    && ['write_pdf', 'humanize_pdf', 'fact_check', 'render_pdf', 'write_sales_page', 'publish_product'].includes(t.kind)
    && t.input.reason !== 'upsell_link');
}

/** Why a product must not be promoted at all (organic, ads, creators), or null when it may be. */
export function promotionBlock(world: WorldState, p: Product): string | null {
  if (p.status !== 'live') return p.status === 'paused' ? 'produit en pause' : 'produit pas en ligne';
  const h = productHealth(world, p);
  if (h.severe) return h.severe;
  return null;
}

// ───────────────────────────── paid-ads history ─────────────────────────────

export interface AdHistory {
  campaigns: number;          // campaigns of the current version
  losers: number;             // consecutive losing campaigns, most recent first (active ones ignored)
  lastEndDay: number | null;  // last day with spend of the most recent stopped campaign
  streakRoas: number | null;  // ROAS of the losing streak itself
  spend: number; revenue: number; roas: number | null; // cumulative (ad-attributed) over the version
  landingViews: number; purchases: number;
}

export function adHistory(world: WorldState, productId: string, sinceDay = 1): AdHistory {
  const camps = world.company.campaigns.filter((c) => c.productId === productId && c.startDay >= sinceDay).sort((a, b) => a.startDay - b.startDay);
  const stats = world.market.adStats.filter((s) => s.productId === productId);
  let losers = 0;
  let lastEndDay: number | null = null;
  let counting = true;
  let spend = 0, revenue = 0, landingViews = 0, purchases = 0, streakSpend = 0, streakRevenue = 0;
  for (const c of camps) {
    const m = campaignMetrics(stats, c.id);
    spend += m.spend; revenue += m.revenue; purchases += m.purchases;
    landingViews += m.rows.reduce((s, r) => s + r.landingViews, 0);
  }
  for (let i = camps.length - 1; i >= 0 && counting; i--) {
    const c = camps[i]!;
    if (c.status === 'active') continue;
    const m = campaignMetrics(stats, c.id);
    const last = m.rows.reduce((d, r) => Math.max(d, r.day), c.startDay);
    if (lastEndDay === null) lastEndDay = last;
    if (m.spend >= 10 && m.roas < LOSER_ROAS) { losers++; streakSpend += m.spend; streakRevenue += m.revenue; }
    else counting = false;
  }
  return {
    campaigns: camps.length, losers, lastEndDay, streakRoas: streakSpend > 0 ? streakRevenue / streakSpend : null,
    spend, revenue, roas: spend > 0 ? revenue / spend : null, landingViews, purchases,
  };
}

/** Days to wait after `losers` losing campaigns in a row before relaunching (0, 1, 2 — never more than MAX_IDLE_DAYS). */
export function cooldownDays(losers: number): number {
  return Math.max(0, Math.min(MAX_IDLE_DAYS, losers - 1));
}

export interface PaidBlock { reason: string; hard: boolean }

/** Product-level reason not to start a new paid campaign today (hard = until a new version; soft = cooldown). */
export function productPaidBlock(world: WorldState, p: Product): PaidBlock | null {
  const promo = promotionBlock(world, p);
  if (promo) return { reason: promo, hard: true };
  if (isUpsellProduct(world, p.id)) return { reason: 'upsell vendu via « La suite est ici », pas en pub froide', hard: true };
  const h = adHistory(world, p.id, versionSince(world, p));
  // "Ads-dead": stop paying for this version; one fresh test is allowed a week after the last campaign.
  if (h.losers >= ADS_DEAD_LOSERS && (h.streakRoas ?? 0) < ADS_DEAD_ROAS && (h.lastEndDay === null || world.day <= h.lastEndDay + ADS_DEAD_RETRY_DAYS)) {
    return { reason: `${h.losers} campagnes perdantes d'affilée (ROAS ${dec(h.streakRoas ?? 0)}) : plus de pub payante sur cette version avant le jour ${(h.lastEndDay ?? world.day) + ADS_DEAD_RETRY_DAYS + 1}`, hard: true };
  }
  const wait = cooldownDays(h.losers);
  if (wait > 0 && h.lastEndDay !== null && world.day <= h.lastEndDay + wait) {
    return { reason: `${h.losers} campagnes perdantes d'affilée : on laisse ${wait} jour(s) avant un nouvel angle (reprise le jour ${h.lastEndDay + wait + 1})`, hard: false };
  }
  return null;
}

/** Same rule as the ad platform: a suspension ends on `bannedUntilDay`. */
export function adBanActive(world: WorldState): boolean {
  const acc = world.market.adAccount;
  return acc.banned && world.day < acc.bannedUntilDay;
}

/** Company-level reason why no paid campaign can start today, or null. */
export function companyPaidBlock(world: WorldState): string | null {
  if (adBanActive(world)) return `compte publicitaire TikTok suspendu jusqu'au jour ${world.market.adAccount.bannedUntilDay}`;
  const b = currentBudget(world);
  if (b.bankrupt || world.status === 'bankrupt') return 'trésorerie négative : aucune dépense pub';
  if (b.survival) return `mode survie (trésorerie ${eur(b.cash)} < 30 % du départ)`;
  const room = b.adCap - committedAdBudget(world);
  if (room < MIN_CAMPAIGN_BUDGET) return `enveloppe pub du CFO déjà engagée (${eur(Math.max(0, room))} libres sur ${eur(b.adCap)})`;
  return null;
}

// ───────────────────────────── creatives ─────────────────────────────

export interface CreativeStats { impressions: number; clicks: number; spend: number; revenue: number; ctr: number; lastFrequency: number }

export function creativeStats(world: WorldState, creativeId: string): CreativeStats {
  let impressions = 0, clicks = 0, spend = 0, revenue = 0, lastDay = -1, lastFrequency = 0;
  for (const s of world.market.adStats) {
    if (s.creativeId !== creativeId) continue;
    impressions += s.impressions; clicks += s.clicks; spend += s.spend; revenue += s.revenue;
    if (s.day >= lastDay) { lastDay = s.day; lastFrequency = s.frequency; }
  }
  return { impressions, clicks, spend, revenue, ctr: impressions > 0 ? clicks / impressions : 0, lastFrequency };
}

/**
 * Approved creatives of a product that are worth putting in a new campaign, best first:
 * never shown (by quality), then proven ones (good CTR, not fatigued, not money-losing).
 */
export function launchableCreatives(world: WorldState, productId: string): AdCreative[] {
  const inUse = new Set(activeCampaigns(world).flatMap((c) => c.creativeIds));
  const fresh: AdCreative[] = [];
  const proven: { c: AdCreative; ctr: number }[] = [];
  for (const c of world.company.creatives) {
    if (c.productId !== productId || c.review.status !== 'approved' || inUse.has(c.id)) continue;
    const s = creativeStats(world, c.id);
    if (s.impressions === 0 && !(world.market.creativeImpressions[c.id] > 0)) { fresh.push(c); continue; }
    const tired = s.lastFrequency >= 2.5 || (world.market.creativeImpressions[c.id] ?? s.impressions) >= 40_000;
    const losing = s.spend >= 10 && s.revenue / s.spend < 1;
    if (!tired && !losing && s.ctr >= 0.008) proven.push({ c, ctr: s.ctr });
  }
  fresh.sort((a, b) => (b.quality?.overall ?? 0) - (a.quality?.overall ?? 0));
  proven.sort((a, b) => b.ctr - a.ctr);
  return [...fresh, ...proven.map((x) => x.c)];
}

// ───────────────────────────── ranking ─────────────────────────────

export interface AcquisitionCandidate { product: Product; score: number; block: PaidBlock | null; history: AdHistory; health: ProductHealth }

/**
 * Promotable live products (quality gates passed), best first. Score = current-version rating, PDF and page
 * quality, paid history (ROAS, conversion), recent sales momentum; refunds and losing streaks count against.
 */
export function acquisitionCandidates(world: WorldState, opts: { includeUpsells?: boolean } = {}): AcquisitionCandidate[] {
  const out: AcquisitionCandidate[] = [];
  for (const p of world.company.products) {
    if (p.status !== 'live') continue;
    if (!opts.includeUpsells && isUpsellProduct(world, p.id)) continue;
    const health = productHealth(world, p);
    if (health.severe) continue;
    const history = adHistory(world, p.id, health.since);
    const rating = health.reviews.length >= MIN_REVIEWS_FOR_RATING ? health.rating / 5 : 0.75;
    const quality = ((p.quality?.overall ?? 70) + (p.salesQuality?.overall ?? 70)) / 200;
    const roas = history.spend >= 20 && history.roas !== null ? clamp(history.roas / 2, 0, 1.5) : 0.6;
    const cvr = history.landingViews >= 30 ? clamp(history.purchases / history.landingViews / 0.04, 0, 1.5) : 0.6;
    const m7 = productMetrics(world, p.id, Math.max(1, world.day - 6));
    const momentum = Math.min(1, Math.log1p(m7.sales) / 3);
    const score = 0.3 * rating + 0.15 * quality + 0.3 * roas + 0.1 * cvr + 0.15 * momentum - 0.5 * health.refundRate - 0.05 * Math.min(4, history.losers);
    out.push({ product: p, score: Math.round(score * 1000) / 1000, block: productPaidBlock(world, p), history, health });
  }
  return out.sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
}

/** The best product to promote right now (paid candidates first), for vague instructions. */
export function bestCandidate(world: WorldState): Product | undefined {
  const list = acquisitionCandidates(world);
  return (list.find((c) => !c.block) ?? list[0])?.product;
}

/** Days since the last paid impression (0 = spent yesterday or a campaign is active), counted from the first launch. */
export function daysWithoutAds(world: WorldState): number {
  if (activeCampaigns(world).length) return 0;
  const firstLive = Math.min(...world.company.products.map((p) => p.launchedDay ?? Number.POSITIVE_INFINITY));
  if (!Number.isFinite(firstLive)) return 0;
  let last = firstLive - 1;
  for (const s of world.market.adStats) if (s.spend > 0 && s.day > last) last = s.day;
  return Math.max(0, world.day - 1 - last);
}
