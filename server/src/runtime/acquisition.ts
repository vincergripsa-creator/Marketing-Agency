/**
 * Acquisition policy shared by the CEO's plan and the growth handlers (observable data only):
 *   - product health of the CURRENT version (rating, refunds) → promotable or not, severe or not;
 *   - paid-ads history per product (consecutive losing campaigns, cumulative ROAS) → cooldown / "ads-dead";
 *   - which creatives are worth (re)launching (fresh, or proven and not fatigued);
 *   - why paid acquisition is blocked today (ad ban, negative cash, survival, CFO envelope);
 *   - the ranking of the candidates, so ads and posts always go to the best products first.
 */
import type { AdCreative, ChannelId, Lesson, Product, Review, WorldState } from '../shared.js';
import { acceptance, CHANNELS, channelOf } from '../shared.js';
import { productPnls } from './accounting.js';
import { CHANNEL_POLICY } from './channelPolicy.js';
import { adsHold } from './holds.js';
import { activeCampaigns, averageRating, campaignMetrics, committedAdBudget, currentBudget, isUpsellProduct, productMetrics, recentReviews, reviewCount } from './metrics.js';
import { learning, sim } from './modules.js';
import { growthOn } from './stages.js';
import { isOpen } from './tasks.js';
import { clamp, dec, eur, pct, sum } from './util.js';

/** Below this many reviews of the current version, the rating is not judged. */
export const MIN_REVIEWS_FOR_RATING = 5;
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
/**
 * The one stop-loss rule (Budget et garde-fous, Playbook Growth): ROAS under STOP_LOSS_ROAS after STOP_LOSS_SPEND €
 * spent over at least STOP_LOSS_DAYS days → pause, not a smaller budget; under NO_TRACTION_ROAS, without waiting for
 * the second day.
 */
export const STOP_LOSS_ROAS = 0.8;
export const STOP_LOSS_SPEND = 25;
export const STOP_LOSS_DAYS = 2;
export const NO_TRACTION_ROAS = 0.4;
/** A creative shown this often to the same people is tired, on any channel. */
export const TIRED_FREQUENCY = 2.5;
/** For relaunch decisions, a stopped campaign that did not pay back its spend counts as a loser. */
export const LOSER_ROAS = 1;
/** After this many losing campaigns in a row with a weak ROAS over the streak, paid ads stop for this version. */
export const ADS_DEAD_LOSERS = 4;
export const ADS_DEAD_ROAS = 0.7;
/** An "ads-dead" version gets one fresh test this many days after its last campaign. */
export const ADS_DEAD_RETRY_DAYS = 7;
/** Share of the CFO's envelope one product leaves free while another promotable product waits for its first test. */
export const EXPLORATION_SHARE = 0.25;
/** Max days without paid acquisition while a promotable product and cash exist (the CEO's watchdog). */
export const MAX_IDLE_DAYS = 2;

/** Kinds that promote a product (ads or organic): never for a product that fails the quality gates. */
export const ACQUISITION_KINDS = ['write_ad_hooks', 'produce_ad', 'launch_campaign', 'post_organic', 'find_creators', 'negotiate_deal'] as const;

// ───────────────────────────── product health ─────────────────────────────

/** Day the current version of a product went (back) online: `versionDay` holds what compaction took away. */
export function versionSince(world: WorldState, p: Product): number {
  let since = Math.max(p.launchedDay ?? world.day, p.versionDay ?? 0);
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

/** Days a version's sales, refunds and spend are read on. Before: orders of its whole life against 90 days of spend, so an old guide's ROAS only rose. */
export const HEALTH_WINDOW_DAYS = 90;

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
  const kept = recentReviews(p);
  const reviews = p.version > 1 ? kept.filter((r) => r.day >= since) : kept;
  const rating = p.version > 1 ? (reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0) : averageRating(p);
  const m = productMetrics(world, p.id, Math.max(p.version > 1 ? since : 1, world.day - HEALTH_WINDOW_DAYS + 1));
  // …but only for a while: buyers see the store rating, so after FRESH_VERSION_DAYS without enough reviews of
  // its own, a reworked version is judged on the rating displayed in the store.
  const fresh = p.version > 1 && reviews.length < MIN_REVIEWS_FOR_RATING && world.day - since < FRESH_VERSION_DAYS;
  const shown = reviewCount(p);
  let severe: string | null = null;
  if (reviews.length >= MIN_REVIEWS_FOR_RATING && rating < MIN_RATING) severe = `note ${dec(rating, 1)}/5 sur ${p.version > 1 ? reviews.length : shown} avis`;
  else if (!fresh && shown >= MIN_REVIEWS_FOR_RATING && p.stats.rating > 0 && p.stats.rating < MIN_RATING) severe = `note affichée ${dec(p.stats.rating, 1)}/5 sur ${shown} avis`;
  // Refunds stop a version only when they are significant AND they make it lose money (or are extreme): in a
  // market full of refund hunters (cauchemar: 10-17 % of orders) a guide that still pays back its ads net of refunds
  // is worth selling — pausing, then killing it at v3 threw away the best product of the run.
  else if (refundsTooHigh(m.refunds, m.sales) && (m.refundRate >= SEVERE_REFUND_RATE || (m.spend > 0 && m.roas < REFUND_GATE_MIN_ROAS))) {
    severe = `${pct(m.refundRate, 0)} de remboursements sur ${m.sales} ventes`;
  }
  return { since, reviews, rating, sales: m.sales, refundRate: m.refundRate, severe };
}

/** Off the ads and still on sale: the portfolio harvests it. Its one paid test lifts this while it runs (scale §5.2). */
export const harvesting = (p: Product): boolean => !!p.harvest && !p.harvest.retest?.open;

/** Mild quality signal: a rewrite is only worth its cost when refunds are significantly high, not a few refund hunters. */
export const MILD_REFUND_RATE = 0.1;
export const MIN_SALES_FOR_REWORK = 12;
export function refundsWorthRework(refunds: number, sales: number): boolean {
  return sales >= MIN_SALES_FOR_REWORK && refunds >= 3 && wilsonLower(refunds, sales) > MILD_REFUND_RATE;
}

// ───────────────────────────── is it making money? ─────────────────────────────

/** A version is judged on money over its last LOSS_WINDOW_DAYS closed days, never on what it sold in the past… */
export const LOSS_WINDOW_DAYS = 14;
/** …across at least 2 campaigns (one is a bad angle, two are a bad offer) and a real spend, with ads that do not pay back. */
export const LOSS_MIN_CAMPAIGNS = 2;
export const LOSS_MIN_SPEND = 100;
export const LOSS_MAX_ROAS = 0.9;
/** The last days pay back their ads again: the turnaround is left alone. */
const RECOVERY_DAYS = 4;
const RECOVERY_ROAS = 1.3;
const RECOVERY_MIN_SPEND = 20;

export interface RecentLoss { fromDay: number; toDay: number; profit: number; roas: number; adSpend: number; campaigns: number; sales: number }

/**
 * The current version loses money over the last 14 closed days, whatever it sold before: profit from the accountant's
 * books (refunds, fees and creators included) with outage days left out. Upsells live off their parent: not judged here.
 */
export function recentLoss(world: WorldState, p: Product): RecentLoss | null {
  if (p.status !== 'live' || p.harvest || isUpsellProduct(world, p.id)) return null; // the loss of a harvested guide is behind it, the Monday review reads its test
  const toDay = sim.lastClosedDay(world);
  if (toDay - versionSince(world, p) + 1 < LOSS_WINDOW_DAYS) return null;
  const fromDay = toDay - LOSS_WINDOW_DAYS + 1;
  const outage = sim.announcedOutageDays(world);
  const ads = world.market.adStats.filter((s) => s.productId === p.id && s.day >= fromDay && s.day <= toDay && s.spend > 0 && !outage.includes(s.day));
  const campaigns = new Set(ads.map((s) => s.campaignId)).size;
  const adSpend = sum(ads.map((s) => s.spend));
  if (campaigns < LOSS_MIN_CAMPAIGNS || adSpend < LOSS_MIN_SPEND) return null;
  const row = productPnls(world, fromDay, toDay, outage).products.find((r) => r.productId === p.id);
  if (!row || row.profit >= 0 || (row.roas ?? 0) >= LOSS_MAX_ROAS) return null;
  const last = ads.filter((s) => s.day > toDay - RECOVERY_DAYS);
  const lastSpend = sum(last.map((s) => s.spend));
  if (lastSpend >= RECOVERY_MIN_SPEND && sum(last.map((s) => s.revenue)) / lastSpend >= RECOVERY_ROAS) return null;
  return { fromDay, toDay, profit: row.profit, roas: row.roas ?? 0, adSpend, campaigns, sales: row.sales };
}

/** Profit of each product over the last `days` closed days, from the books (outage days left out). */
export function recentProfits(world: WorldState, days: number): Map<string, number> {
  const toDay = sim.lastClosedDay(world);
  const rows = productPnls(world, Math.max(1, toDay - days + 1), toDay, sim.announcedOutageDays(world)).products;
  return new Map(rows.map((r) => [r.productId, r.profit]));
}

const CUT_LESSON = /^\s*(couper|arr[êe]ter|stopper)\b.*\bpubs?\b/i;

/** The day a lesson last said what it says now. */
export function lessonDay(l: Lesson): number {
  return l.changedDay ?? l.day;
}

/**
 * The retro's « Couper les pubs de la niche … » about this version: the team does not spend against its own lesson.
 * A rewrite alone does not make it about this version: its numbers must not hold ads shown before it went online.
 */
export function cutLesson(world: WorldState, p: Product, ch: ChannelId = 'tiktok'): Lesson | null {
  const key = learning.LESSON_KEYS.niche(p.nicheId);
  const since = versionSince(world, p);
  const inNiche = (id: string): boolean => world.company.products.some((x) => x.id === id && x.nicheId === p.nicheId);
  return world.company.lessons.find((l) => {
    if (l.key !== key || lessonDay(l) < since || !CUT_LESSON.test(l.insight)) return false;
    const from = lessonDay(l) - learning.NICHE_WINDOW_DAYS + 1;
    const spent = (s: { day: number; spend: number; productId: string }) => s.day >= from && s.spend > 0 && inNiche(s.productId);
    // A lesson only knows the channels that spent behind its numbers: it says nothing of one the guide has not tried.
    if (ch !== 'tiktok' && !world.market.adStats.some((s) => spent(s) && s.day <= lessonDay(l) && channelOf(s) === ch)) return false;
    return !world.market.adStats.some((s) => spent(s) && s.day < since);
  }) ?? null;
}

/** A rework (rewrite → republish) of the product is in progress. */
export function isReworking(world: WorldState, productId: string): boolean {
  return world.company.tasks.some((t) => isOpen(t) && t.input.productId === productId
    && ['write_pdf', 'humanize_pdf', 'fact_check', 'render_pdf', 'write_sales_page', 'publish_product'].includes(t.kind)
    && t.input.reason !== 'upsell_link');
}

/** Why a product must not be promoted at all (organic, ads, creators), or null when it may be. */
export function promotionBlock(world: WorldState, p: Product): string | null {
  if (p.kind === 'kit') return 'vendu à la commande, jamais seul';
  if (p.status !== 'live') return p.status === 'paused' ? 'produit en pause' : 'produit pas en ligne';
  const h = productHealth(world, p);
  if (h.severe) return h.severe;
  const loss = recentLoss(world, p);
  if (loss) return `perd ${eur(-loss.profit)} en ${LOSS_WINDOW_DAYS} jours sur ${loss.campaigns} campagnes (ROAS ${dec(loss.roas)})`;
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

export function adHistory(world: WorldState, productId: string, sinceDay = 1, ch: ChannelId = 'tiktok'): AdHistory {
  const camps = world.company.campaigns.filter((c) => c.productId === productId && c.startDay >= sinceDay && channelOf(c) === ch).sort((a, b) => a.startDay - b.startDay);
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
    if (c.status === 'active' || c.pausedFor) continue; // a day off for an outage ends nothing
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

/** hard = until a new version; soft = cooldown; final = not even the CEO's watchdog test: the numbers already decided. */
export interface PaidBlock { reason: string; hard: boolean; final?: boolean }

/**
 * Product-level reason not to start a new paid campaign today. Holds, quality and money stay product-wide. Cooldowns and
 * "ads-dead" are a channel's own history: a guide dead on TikTok can still get its Meta test.
 */
export function productPaidBlock(world: WorldState, p: Product, ch: ChannelId = 'tiktok'): PaidBlock | null {
  const held = adsHold(world, p.id, ch);
  if (held) return { reason: held.reason, hard: true, final: true };
  if (harvesting(p)) return { reason: `en récolte depuis le jour ${p.harvest!.day} : plus de pub ni de créa`, hard: true, final: true };
  const promo = promotionBlock(world, p);
  if (promo) return { reason: promo, hard: true, final: true };
  if (isUpsellProduct(world, p.id)) return { reason: 'upsell vendu via « La suite est ici », pas en pub froide', hard: true };
  const cut = cutLesson(world, p, ch);
  if (cut) return { reason: `leçon du jour ${lessonDay(cut)} : ${cut.insight.split(' : ')[0]}`, hard: true, final: true };
  const since = versionSince(world, p);
  const h = adHistory(world, p.id, since, ch);
  // "Ads-dead": stop paying for this version; one fresh test is allowed a week after the last campaign.
  if (h.losers >= ADS_DEAD_LOSERS && (h.streakRoas ?? 0) < ADS_DEAD_ROAS && (h.lastEndDay === null || world.day <= h.lastEndDay + ADS_DEAD_RETRY_DAYS)) {
    return { reason: `${h.losers} campagnes perdantes d'affilée (ROAS ${dec(h.streakRoas ?? 0)}) : plus de pub payante sur cette version avant le jour ${(h.lastEndDay ?? world.day) + ADS_DEAD_RETRY_DAYS + 1}`, hard: true };
  }
  const wait = cooldownDays(h.losers);
  if (wait > 0 && h.lastEndDay !== null && world.day <= h.lastEndDay + wait) {
    return { reason: `${h.losers} campagnes perdantes d'affilée : on laisse ${wait} jour(s) avant un nouvel angle (reprise le jour ${h.lastEndDay + wait + 1})`, hard: false };
  }
  // A plan stop holds (channels §7.4): an average can look fine while the next euro loses money. The line stays out while the days
  // that stopped it are in the plan's window: back any sooner, it would read the same curve and stop again. A new version starts over.
  const planStop = Math.max(0, ...world.company.campaigns.filter((c) => c.productId === p.id && channelOf(c) === ch).map((c) => c.planStopped ?? 0));
  const back = planStop + CHANNEL_POLICY.alloc.windowDays;
  if (planStop >= since && world.day < back) return { reason: `le plan du CFO a arrêté cette ligne le jour ${planStop} : reprise le jour ${back}`, hard: false };
  return null;
}

/** The account behind a channel: TikTok keeps `adAccount`, YouTube and Search share Google's. */
function adAccountOf(world: WorldState, ch: ChannelId) {
  const id = CHANNELS[ch].account;
  return id === 'tiktok' ? world.market.adAccount : world.market.channels?.accounts[id];
}

/** Same rule as the ad platform: a suspension ends on `bannedUntilDay`. Bans are per account. */
export function adBanActive(world: WorldState, ch: ChannelId = 'tiktok'): boolean {
  const acc = adAccountOf(world, ch);
  return !!acc && acc.banned && world.day < acc.bannedUntilDay;
}

/** Set on a channel kill: `requested` then holds the day it may come back, and until that day the channel is off the book. */
export function channelPaused(world: WorldState, ch: ChannelId): boolean {
  const day = world.company.channels?.requested[ch];
  return day !== undefined && day > world.day && !world.company.channels!.open.includes(ch);
}

/**
 * Company-level reason why no paid campaign can start today, or null. With a channel it speaks for that account alone.
 * Without one, a ban blocks only once every open account is banned.
 */
export function companyPaidBlock(world: WorldState, ch?: ChannelId): string | null {
  const held = adsHold(world, null, ch);
  if (held) return held.reason;
  if (ch && channelPaused(world, ch)) return `${CHANNELS[ch].label} en pause après ses pertes : pas de campagne avant le jour ${world.company.channels!.requested[ch]}`;
  if (currentBudget(world).outage) return `panne de paiement annoncée aujourd'hui : aucune vente possible, aucune dépense pub`;
  const accounts = ch ? [ch] : world.company.channels?.open ?? ['tiktok'];
  if (accounts.every((c) => adBanActive(world, c))) return `compte publicitaire ${CHANNELS[accounts[0]!].label} suspendu jusqu'au jour ${adAccountOf(world, accounts[0]!)!.bannedUntilDay}`;
  const b = currentBudget(world);
  if (b.bankrupt || world.status === 'bankrupt') return 'trésorerie négative : aucune dépense pub';
  if (b.survival) return `mode survie (trésorerie ${eur(b.cash)} < 30 % du départ)`;
  const room = b.adCap - committedAdBudget(world);
  if (room < (ch ? CHANNELS[ch].minDailyBudget : MIN_CAMPAIGN_BUDGET)) return `enveloppe pub du CFO déjà engagée (${eur(Math.max(0, room))} libres sur ${eur(b.adCap)})`;
  return null;
}

// ───────────────────────────── creatives ─────────────────────────────

export interface CreativeStats { impressions: number; clicks: number; spend: number; revenue: number; ctr: number; lastFrequency: number }

/** What a creative did on one channel: a CTR only compares with the CTRs of its own channel. */
export function creativeStats(world: WorldState, creativeId: string, ch: ChannelId = 'tiktok'): CreativeStats {
  let impressions = 0, clicks = 0, spend = 0, revenue = 0, lastDay = -1, lastFrequency = 0;
  for (const s of world.market.adStats) {
    if (s.creativeId !== creativeId || channelOf(s) !== ch) continue;
    impressions += s.impressions; clicks += s.clicks; spend += s.spend; revenue += s.revenue;
    if (s.day >= lastDay) { lastDay = s.day; lastFrequency = s.frequency; }
  }
  return { impressions, clicks, spend, revenue, ctr: impressions > 0 ? clicks / impressions : 0, lastFrequency };
}

/** `review` stays TikTok's verdict on a master. Every other channel keeps its own, and its own formats. */
function approvedOn(c: AdCreative, ch: ChannelId): boolean {
  const review = ch === 'tiktok' ? c.review : c.channelReviews?.[ch];
  return review?.status === 'approved' && acceptance(ch, c) !== null;
}

/**
 * Approved creatives of a product that are worth putting in a new campaign on a channel, best first:
 * never shown (by quality), then proven ones (good CTR, not fatigued, not money-losing).
 * Frequency alone says "tired" outside TikTok: it is public, the 40 000 impressions rule is TikTok's.
 */
export function launchableCreatives(world: WorldState, productId: string, ch: ChannelId = 'tiktok'): AdCreative[] {
  const inUse = new Set(activeCampaigns(world).filter((c) => channelOf(c) === ch).flatMap((c) => c.creativeIds));
  const shown = (id: string): number | undefined => (ch === 'tiktok' ? world.market.creativeImpressions[id] : undefined);
  const fresh: AdCreative[] = [];
  const proven: { c: AdCreative; ctr: number }[] = [];
  for (const c of world.company.creatives) {
    if (c.productId !== productId || !approvedOn(c, ch) || inUse.has(c.id)) continue;
    const s = creativeStats(world, c.id, ch);
    if (s.impressions === 0 && !((shown(c.id) ?? 0) > 0)) { fresh.push(c); continue; }
    const tired = s.lastFrequency >= TIRED_FREQUENCY || (ch === 'tiktok' && (shown(c.id) ?? s.impressions) >= 40_000);
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

/**
 * The envelope a campaign of this product may grow into. A winner does not eat the whole of it while another guide
 * waits for a test: the budget would go to a saturating audience and the other guide would die untested. Under growth the
 * CFO's Monday target sets it, tests' share out. A target is room, not an order: what already runs stays, inside the cap,
 * and only what would grow waits for it (scale §4.3).
 */
export function scalingRoom(world: WorldState, p: Product, adCap: number): number {
  const waiting = acquisitionCandidates(world).some((c) => c.product.id !== p.id && !c.block && !activeCampaigns(world, c.product.id).length);
  const allocation = growthOn(world) ? world.company.growth?.allocation : null;
  if (allocation?.adTarget === undefined) return waiting ? adCap * (1 - EXPLORATION_SHARE) : adCap;
  return Math.min(adCap, Math.max(allocation.adTarget - (waiting ? allocation.testWeek / 7 : 0), committedAdBudget(world)));
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
