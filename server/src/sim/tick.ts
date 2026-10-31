/**
 * Market close for world.day: paid ads → organic → creators → sales → upsells → refunds → reviews →
 * inbox → escalations → random events → fixed costs. Every money move goes through the ledger.
 */
import { clamp, emit, nextId, round2, streamRng } from '../core/index.js';
import type { DifficultyProfile, MarketDayResult, Rng } from '../contracts.js';
import { CHANNELS, CHANNEL_IDS, channelOf } from '../shared.js';
import type {
  AdCreative, Campaign, ChannelId, Customer, DailyAdStats, InboxMessage, MessageIntent, NicheTruth, Order, Product, QualityReport, WorldEvent, WorldEventKind, WorldState,
} from '../shared.js';
import { addAdTotals } from './adTotals.js';
import { ADS, CONVERSION, CREATORS, ESCALATION, FEES, INBOX, ORGANIC, REFUNDS, REVIEWS, SCAM, STATS, UPSELL } from './balance.js';
import { nichePool, poolSaturation } from './capacity.js';
import { CHANNEL_STREAM } from './channelBalance.js';
import {
  accountBanned, accountOf, addImpressions, approvedOn, deliverSearch, deliverySpec, familyPrior, overlapOf, reachOf, rollChannelEvents, runPaidTails, searchCampaigns, updateWarmth,
  type DeliverySpec,
} from './channels.js';
import { runClaims } from './claims.js';
import { findBannedClaims } from './compliance.js';
import { buyerArchetype, createCustomer, customerById, senderArchetype } from './customers.js';
import { releaseHolds, rollEvents, seasonalBoostActive } from './events.js';
import { adComments } from './feedback.js';
import { SETUP_REF, cashOf, recordLedger } from './finance.js';
import { createMessage, followUpText } from './inbox.js';
import { difficultyProfile, isScammer } from './market.js';
import { chargebackOrder, creativeById, nicheOf, orderById, productById, pushEvent, refundOrder, repayableLeft, reviewProduct, type EventRefs } from './ops.js';
import { genericPhraseHits, guideOverlap, scoreCreative, scorePdf, scoreSalesPage, vocPhraseHits } from './quality.js';
import { fmtEur, fmtInt, fmtNum, fmtPct, keyTokens, lognormal, norm, overlap, pickWeighted, plural, short, stemSet, uniform } from './text.js';
import { tempoFit } from './videoCraft.js';
import { visualCvr, visualRating, visualRefund, visualWtp } from './visual.js';

interface Traffic {
  productId: string;
  source: Order['source'];
  landingViews: number;
  cvrMult: number;
  campaignId: string | null;
  creativeId: string | null;
  creatorId: string | null;
  partnershipId: string | null;
  postId: string | null;
  stat: DailyAdStats | null;
  channel: ChannelId;           // TikTok organic and creators sit in TikTok's pool
}

const NEUTRAL_REPORT: QualityReport = {
  overall: 35, specificity: 30, structure: 30, actionability: 30, humanTone: 50, design: 20, promiseMatch: 100, compliance: 100,
  issues: [], evaluator: 'heuristic',
};

/** Per-day caches + running totals. */
class Day {
  readonly day: number;
  /** The day's key: every phase and every later step takes its stream from it. */
  dayKey = 0;
  cash: number;
  readonly traffic: Traffic[] = [];
  readonly newOrders: Order[] = [];
  readonly notes: string[] = [];
  readonly eventIds: string[] = [];
  sales = 0; revenue = 0; upsells = 0; refunds = 0; refundAmount = 0; adSpend = 0; messages = 0;
  chargebacks = 0; badReviews = 0;
  /** The day's ads per channel, for the summary. */
  readonly ads = new Map<ChannelId, { spend: number; impressions: number; clicks: number }>();
  readonly outage: boolean;
  readonly boost: boolean;
  readonly storeRating: number;
  private pdfCache = new Map<string, QualityReport>();
  private salesCache = new Map<string, QualityReport>();
  private creativeCache = new Map<string, QualityReport>();
  private echoCache = new Map<string, number>();
  private customers = new Map<string, Customer>();

  constructor(readonly world: WorldState, public rng: Rng, readonly diff: DifficultyProfile) {
    this.day = world.day;
    for (const c of world.market.customers) this.customers.set(c.id, c);
    this.cash = cashOf(world);
    this.outage = world.market.modifiers.outageDay === world.day;
    this.boost = seasonalBoostActive(world);
    this.storeRating = storeRating(world);
  }

  niche(p: Product): NicheTruth { return nicheOf(this.world, p); }

  adsOf(ch: ChannelId): { spend: number; impressions: number; clicks: number } {
    let t = this.ads.get(ch);
    if (!t) this.ads.set(ch, t = { spend: 0, impressions: 0, clicks: 0 });
    return t;
  }

  /** O(1) customer lookup (customers created during the tick fall back to a scan, then get cached). */
  customer(id: string): Customer | undefined {
    let c = this.customers.get(id);
    if (!c) {
      c = customerById(this.world, id);
      if (c) this.customers.set(id, c);
    }
    return c;
  }

  /** The market's own reading of the PDF (blended with a non-heuristic evaluator's verdict when present). */
  pdfQ(p: Product): QualityReport {
    let r = this.pdfCache.get(p.id);
    if (!r) {
      const n = this.niche(p);
      r = p.content ? scorePdf(p.content, { audience: p.audience, problem: p.problem, voc: n.voc, design: p.design, visual: p.visual }) : NEUTRAL_REPORT;
      if (p.quality && p.quality.evaluator !== 'heuristic') {
        r = { ...r, overall: Math.round(0.6 * r.overall + 0.4 * p.quality.overall), specificity: Math.round(0.6 * r.specificity + 0.4 * p.quality.specificity) };
      }
      this.pdfCache.set(p.id, r);
    }
    return r;
  }

  pageQ(p: Product): QualityReport {
    let r = this.salesCache.get(p.id);
    if (!r) {
      r = p.salesPage ? scoreSalesPage(p.salesPage, { ...p, quality: this.pdfQ(p) }, this.niche(p).voc) : { ...NEUTRAL_REPORT, overall: 20 };
      if (p.salesQuality && p.salesQuality.evaluator !== 'heuristic') r = { ...r, overall: Math.round(0.6 * r.overall + 0.4 * p.salesQuality.overall) };
      this.salesCache.set(p.id, r);
    }
    return r;
  }

  adQ(c: AdCreative, p: Product): QualityReport {
    let r = this.creativeCache.get(c.id);
    if (!r) {
      r = scoreCreative(c, p, this.niche(p).voc);
      if (c.quality && c.quality.evaluator !== 'heuristic') r = { ...r, overall: Math.round(0.6 * r.overall + 0.4 * c.quality.overall) };
      this.creativeCache.set(c.id, r);
    }
    return r;
  }

  /** How far this follow-up guide repeats the guide its buyer already owns: 0 for a guide of its own, 1 for the same text. */
  echo(p: Product): number {
    let e = this.echoCache.get(p.id);
    if (e === undefined) {
      const parent = this.world.company.products.find((x) => x.upsellProductId === p.id && x.id !== p.id);
      const share = parent?.content && p.content ? guideOverlap(p.content, parent.content) : 0;
      e = clamp((share - UPSELL.echoTolerated) / (1 - UPSELL.echoTolerated), 0, 1);
      this.echoCache.set(p.id, e);
    }
    return e;
  }

  noise(sd: number): number { return Math.exp(this.rng.normal(0, sd)); }

  /** Moves the phase to the stream of one campaign or product: what happens to it does not depend on the ones before. */
  focus(phase: number, item: number): Rng {
    this.rng = streamRng(phase, item);
    return this.rng;
  }
}

/** What the buyer finds missing: the page's promises above what the guide holds, and the guide's own promises it does not keep. */
function promiseShortfall(d: Day, p: Product): number {
  return ((100 - d.pageQ(p).promiseMatch) + (100 - d.pdfQ(p).promiseMatch)) / 150;
}

// ───────────────────────────── conversion model ─────────────────────────────

export function priceFactor(price: number, wtp: { min: number; sweet: number; max: number }): number {
  const { min, sweet, max } = wtp;
  if (price <= sweet) {
    const span = Math.max(1, sweet - min);
    return Math.min(CONVERSION.priceBelowCap, 1 + CONVERSION.priceBelowBoost * ((sweet - price) / span));
  }
  if (price <= max) {
    const t = (price - sweet) / Math.max(1, max - sweet);
    return 1 - CONVERSION.priceAboveDrop * Math.pow(t, CONVERSION.priceAboveExp);
  }
  // beyond the max willingness to pay, demand keeps falling at (at least) the slope it had just below max:
  // no cliff where +6 € suddenly divides sales by 3, but still a steep, clearly losing zone
  const atMax = 1 - CONVERSION.priceAboveDrop;
  const slopeAtMax = (CONVERSION.priceAboveDrop * CONVERSION.priceAboveExp) / Math.max(1, max - sweet);
  const scale = clamp(atMax / slopeAtMax, CONVERSION.priceOverMaxDecay * max, CONVERSION.priceOverMaxDecayMax * max);
  return atMax * Math.exp(-(price - max) / Math.max(1, scale));
}

/** How far a price paid went beyond what the niche accepts to pay: 0 up to wtp.max, 1 at twice it. Within the max there is nothing to regret. */
function overprice(price: number, wtp: { max: number }): number {
  return clamp((price - wtp.max) / Math.max(1, wtp.max), 0, 1);
}

/**
 * Chance that a buyer takes the follow-up guide right after his purchase. Both guides' quality sets the base rate;
 * the price acts as for any visitor, only harder (exponent): revenue per buyer peaks close to the sweet price and
 * an upsell priced above what the niche pays collapses.
 */
export function upsellRate(qualityPct: number, price: number, wtp: { min: number; sweet: number; max: number }): number {
  const base = UPSELL.minRate + (UPSELL.maxRate - UPSELL.minRate) * clamp(qualityPct / 100, 0, 1);
  return base * Math.pow(priceFactor(price, wtp), UPSELL.priceExp);
}

function ratingEffect(r: number): number {
  if (r >= 4.5) return CONVERSION.ratingHigh;
  if (r < 3.5) return CONVERSION.ratingLow;
  return 1 + (CONVERSION.ratingHigh - 1) * ((r - 3.5) / 1);
}

/** Average of every review the store has received, or 0 while it has too few to mean anything. */
export function storeRating(world: WorldState): number {
  let total = 0;
  let count = 0;
  for (const p of world.company.products) for (const r of p.stats.reviews) { total += r.rating; count++; }
  return count >= CONVERSION.storeMinReviews ? total / count : 0;
}

/** A guide is judged on its own reviews; without any, a visitor only has the store's reputation to go on. */
export function trustFactor(p: Product, store: number): number {
  if (p.stats.reviews.length && p.stats.rating > 0) return ratingEffect(p.stats.rating);
  return store > 0 ? CONVERSION.ratingNone + (ratingEffect(store) - CONVERSION.ratingNone) * CONVERSION.storeTrust : CONVERSION.ratingNone;
}

/** Conversion rate of a landing view for this product today (before source multiplier & noise). */
function baseCvr(d: Day, p: Product): number {
  const n = d.niche(p);
  const sq = d.pageQ(p).overall;
  const sqF = clamp(Math.pow(Math.max(1, sq) / CONVERSION.salesQualityRef, CONVERSION.salesQualityExp), CONVERSION.salesQualityMin, CONVERSION.salesQualityMax);
  const specF = CONVERSION.specificityMin + CONVERSION.specificitySpan * (d.pdfQ(p).specificity / 100);
  const demandF = CONVERSION.demandMin + CONVERSION.demandSpan * n.demand;
  const dow = n.seasonality[(d.day - 1) % 7] ?? 1;
  const compF = 1 - CONVERSION.competitionWeight * n.competition;
  const hypeF = 1 + CONVERSION.hypeBoost * clamp(p.salesPage?.hypeLevel ?? 0.5, 0, 1);
  const boost = d.boost ? CONVERSION.seasonalBoost : 1;
  return CONVERSION.base * sqF * priceFactor(p.price, visualWtp(n.wtp, p.visual)) * trustFactor(p, d.storeRating) * specF * demandF * dow * compF * hypeF * boost * visualCvr(p.visual);
}

// ───────────────────────────── 1. paid ads ─────────────────────────────

/** One row of the day and the traffic it sends to the shop. Returns what it spent: the campaign books one ledger line. */
function addAdRow(d: Day, camp: Campaign, c: AdCreative, ch: ChannelId, spec: DeliverySpec, row: Pick<DailyAdStats, 'spend' | 'impressions' | 'clicks' | 'landingViews' | 'frequency' | 'comments'>): number {
  const { spend, impressions, clicks, landingViews, frequency, comments } = row;
  const stat: DailyAdStats = {
    day: d.day, campaignId: camp.id, creativeId: c.id, productId: camp.productId,
    spend, impressions, clicks,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
    cpc: clicks > 0 ? round2(spend / clicks) : 0,
    cpm: impressions > 0 ? round2((spend / impressions) * 1000) : 0,
    landingViews, purchases: 0, revenue: 0, roas: 0, frequency, comments,
    ...(ch === 'tiktok' ? {} : { channel: ch }),
  };
  d.world.market.adStats.push(stat);
  d.traffic.push({ productId: camp.productId, source: 'ads', landingViews, cvrMult: spec.intent, campaignId: camp.id, creativeId: c.id, creatorId: null, partnershipId: null, postId: null, stat, channel: ch });
  const t = d.adsOf(ch);
  t.impressions += impressions;
  t.clicks += clicks;
  return spend;
}

/** Free clicks of paid pins: they reach runSales the same day, on a stream of their own. */
function addPaidTails(d: Day): void {
  if (!d.world.market.channels) return;
  for (const stat of runPaidTails(d.world, streamRng(d.dayKey, CHANNEL_STREAM.tails))) {
    const ch = channelOf(stat);
    const cvrMult = deliverySpec(d.niche(productById(d.world, stat.productId)!), ch).intent;
    d.traffic.push({ productId: stat.productId, source: 'ads', landingViews: stat.landingViews, cvrMult, campaignId: stat.campaignId, creativeId: stat.creativeId, creatorId: null, partnershipId: null, postId: null, stat, channel: ch });
  }
}

function runAds(d: Day): void {
  const { world, diff } = d;
  const key = d.rng.int(0, 0x7fffffff);
  const m = world.market;
  const eventCpm = m.modifiers.cpmUntilDay >= d.day ? m.modifiers.cpmMultiplier : 1; // the cpm_spike event stays TikTok's (D22)
  const dowCpm = ADS.dayOfWeekCpm[(d.day - 1) % 7] ?? 1;
  const blocked = new Map<ChannelId, number>(); let capped = false;
  for (const [index, camp] of world.company.campaigns.entries()) {
    if (camp.status !== 'active') continue;
    const p = productById(world, camp.productId);
    if (!p || p.status !== 'live') continue;
    const ch = channelOf(camp);
    const creatives = camp.creativeIds.map((id) => creativeById(world, id)).filter((c): c is AdCreative => !!c && approvedOn(c, ch) && c.productId === p.id);
    if (!creatives.length) continue;
    if (accountBanned(m, ch, d.day)) { blocked.set(ch, (blocked.get(ch) ?? 0) + 1); continue; }
    const rng = d.focus(key, index);
    const wanted = Math.max(0, camp.dailyBudget) * uniform(rng, ADS.deliveryMin, ADS.deliveryMax);
    const spendTotal = round2(Math.min(wanted, Math.max(0, d.cash)));
    if (spendTotal < wanted - 0.01) capped = true;
    if (spendTotal < 0.5) continue;
    const n = d.niche(p);
    const spec = deliverySpec(n, ch, camp);
    const narrow = (camp.targeting?.ageMax ?? 55) - (camp.targeting?.ageMin ?? 18) < 10 ? ADS.narrowAgeCpm : 1;
    const reach = reachOf(n);
    const event = ch === 'tiktok' ? eventCpm : 1;
    const search = CHANNELS[ch].buying === 'cpc';
    let campSpend = 0;
    for (const c of creatives) {
      const spend = round2(spendTotal / creatives.length);
      if (spend <= 0) continue;
      const q = d.adQ(c, p);
      if (search) {
        const buy = deliverSearch(world, n, spec, q.overall, spend, creatives.length * searchCampaigns(world, n.id), rng);
        campSpend += addAdRow(d, camp, c, ch, spec, { ...buy, landingViews: rng.binomial(buy.clicks, spec.landingRate), frequency: 1, comments: [] });
        continue;
      }
      const cpm = Math.max(ADS.minCpm, spec.cpmBase * diff.cpmMultiplier * event * dowCpm * narrow * spec.learningCpm * d.noise(ADS.cpmNoiseSd));
      const impressions = Math.floor((spend / cpm) * 1000);
      const prior = familyPrior(m, c, ch);
      const fatigue = 1 / (1 + prior / spec.fatigue);
      const ctrRaw = ADS.baseCtr * Math.pow(Math.max(1, q.overall) / ADS.qualityRef, ADS.qualityExp)
        * Math.pow((n.hookAffinity[c.hookStyle] ?? 1) * spec.formatFit(c), spec.affinityExp) * (0.6 + 0.8 * spec.fit)
        * spec.ctrScale * spec.ratioFit(c) * spec.learningCtr * fatigue * tempoFit(n, c) * d.noise(ADS.ctrNoiseSd);
      const ctr = clamp(ctrRaw, ADS.minCtr, ADS.maxCtr);
      const clicks = rng.binomial(impressions, ctr);
      const landingViews = rng.binomial(clicks, spec.landingRate);
      addImpressions(m, c, ch, impressions);
      const nComments = Math.min(ADS.maxCommentsPerRow, rng.poisson(impressions / ADS.commentsPerImpressions));
      campSpend += addAdRow(d, camp, c, ch, spec, {
        spend, impressions, clicks, landingViews,
        frequency: round2(1 + (prior + impressions) / (reach * spec.poolShare)),
        comments: adComments(rng, nComments, q.overall, p.salesPage?.hypeLevel ?? 0.5, diff.annoyingShare, n, p.audience),
      });
    }
    if (campSpend > 0) {
      recordLedger(world, { type: 'ad_spend', amount: -campSpend, memo: `${CHANNELS[ch].label} Ads — ${short(camp.name, 50)}`, ref: camp.id });
      d.cash = round2(d.cash - campSpend);
      d.adSpend = round2(d.adSpend + campSpend);
      const t = d.adsOf(ch);
      t.spend = round2(t.spend + campSpend);
    }
  }
  for (const [ch, count] of blocked) {
    d.notes.push(`Compte ${ch === 'tiktok' ? 'publicitaire' : CHANNELS[ch].label} suspendu jusqu'au jour ${accountOf(m, ch)?.bannedUntilDay} : ${plural(count, 'campagne bloquée', 'campagnes bloquées')}.`);
  }
  if (capped) d.notes.push('Trésorerie insuffisante : la diffusion des pubs a été plafonnée.');
  addPaidTails(d);
}

// ───────────────────────────── 2. organic ─────────────────────────────

/** 0..100 hook strength for organic reach (no full creative available). */
export function hookStrength(hook: string, p: Product | undefined, n: NicheTruth | undefined): number {
  let s = 50;
  const h = hook.trim();
  if (h.length >= 25 && h.length <= 90) s += 15; else if (h.length > 140 || h.length < 12) s -= 15;
  if (/\d/.test(h)) s += 8;
  if (h.includes('?')) s += 5;
  if (p) {
    const stems = stemSet(h);
    if (Math.max(overlap(keyTokens(p.audience), stems), overlap(keyTokens(p.problem), stems)) > 0) s += 12;
  }
  if (n && vocPhraseHits(norm(h), n.voc) > 0) s += 10;
  s -= 15 * Math.min(2, genericPhraseHits(norm(h)).total);
  return clamp(s, 10, 100);
}

function runOrganic(d: Day): void {
  const { world, rng } = d;
  const perDay = new Map<number, number>();
  for (const post of world.market.organicPosts) {
    if (post.views > 0 || post.day > d.day) continue;
    const rank = (perDay.get(post.day) ?? 0) + 1;
    perDay.set(post.day, rank);
    const p = productById(world, post.productId);
    const n = p ? d.niche(p) : undefined;
    const q = hookStrength(post.hook, p, n);
    const aff = n ? (n.hookAffinity[post.hookStyle] ?? 1) * (n.formatAffinity[post.format] ?? 1) : 1;
    const tik = n ? n.tiktokAffinity : 0.5;
    const throttled = findBannedClaims([post.hook], n?.voc.bannedClaims ?? []).length > 0;
    const reach = (1 / (1 + ORGANIC.sameDayDecay * (rank - 1))) * (throttled ? ORGANIC.bannedReach : 1);
    const viralP = clamp(ORGANIC.viralChance * (q / 70) * (0.5 + tik) * Math.sqrt(aff) * reach, 0, 0.06);
    if (rng.chance(viralP)) {
      post.viral = true;
      post.views = Math.round(clamp(lognormal(rng, 60000, 0.6), ORGANIC.viralMin, ORGANIC.viralMax));
    } else {
      post.views = Math.max(30, Math.round(lognormal(rng, ORGANIC.medianViews * Math.pow(q / 70, 1.2) * Math.pow(aff, 0.7) * (0.5 + tik) * reach, ORGANIC.viewsSigma)));
    }
    post.likes = Math.round(post.views * uniform(rng, ORGANIC.likeRate.min, ORGANIC.likeRate.max));
    const rate = post.viral ? uniform(rng, ORGANIC.viralClickRate.min, ORGANIC.viralClickRate.max) : uniform(rng, ORGANIC.clickRate.min, ORGANIC.clickRate.max);
    post.clicks = p && p.status === 'live' ? rng.binomial(post.views, rate) : 0;
    if (p && post.clicks > 0) {
      d.traffic.push({ productId: p.id, source: 'organic', landingViews: rng.binomial(post.clicks, ADS.landingRate), cvrMult: CONVERSION.organicCvrMultiplier, campaignId: null, creativeId: null, creatorId: null, partnershipId: null, postId: post.id, stat: null, channel: 'tiktok' });
    }
    if (post.viral) {
      const ev = pushEventSafe(d, 'viral_organic', 'Vidéo organique virale !', `« ${short(post.hook, 60)} » dépasse ${fmtInt(post.views)} vues sur TikTok.`, 'good',
        { productId: p?.id ?? null, nicheId: p?.nicheId ?? null });
      if (ev) d.notes.push(`Post organique viral : ${fmtInt(post.views)} vues.`);
    }
  }
  const posts = world.market.organicPosts;
  if (posts.length > ORGANIC.keepPosts) posts.splice(0, posts.length - ORGANIC.keepPosts);
}

// ───────────────────────────── 3. creators ─────────────────────────────

function runCreators(d: Day): void {
  const { world, rng } = d;
  for (const pt of world.market.partnerships) {
    const creator = world.market.creators.find((c) => c.id === pt.creatorId);
    if (!creator) continue;
    if (pt.status === 'accepted' && pt.day < d.day) {
      if (isScammer(world, creator)) {
        pt.status = 'scam';
        if (pt.upfront > 0) {
          recordLedger(world, { type: 'creator_payout', amount: pt.upfront, memo: `Requalification de l'avance versée à @${creator.handle}`, ref: `reversal:${pt.id}` });
          recordLedger(world, { type: 'scam_loss', amount: -pt.upfront, memo: `Arnaque : @${creator.handle} a encaissé l'avance sans publier`, ref: pt.id });
        }
        d.notes.push(`Arnaque : @${creator.handle} a encaissé ${fmtEur(pt.upfront)} d'avance et a disparu.`);
        emit(world, { agentId: null, kind: 'event', text: `@${creator.handle} ne répond plus : l'avance de ${fmtEur(pt.upfront)} est perdue.`, refs: { productId: pt.productId } });
        continue;
      }
      if (d.day >= pt.day + CREATORS.deliveryDelayDays) pt.status = 'delivered';
    }
    if (pt.status !== 'delivered') continue;
    const k = d.day - (pt.day + CREATORS.deliveryDelayDays);
    if (k < 0 || k >= CREATORS.tail.length) continue;
    const p = productById(world, pt.productId);
    if (!p) continue;
    const match = creator.nicheId === p.nicheId ? 1 : CREATORS.offNicheReach;
    const views = Math.round(creator.avgViews * CREATORS.tail[k]! * match * d.noise(0.35));
    const clicks = p.status === 'live' ? rng.binomial(views, uniform(rng, CREATORS.clickRate.min, CREATORS.clickRate.max)) : 0;
    if (clicks > 0) {
      d.traffic.push({ productId: p.id, source: 'creator', landingViews: rng.binomial(clicks, ADS.landingRate), cvrMult: CREATORS.cvrMultiplier, campaignId: null, creativeId: null, creatorId: creator.id, partnershipId: pt.id, postId: null, stat: null, channel: 'tiktok' });
    }
    if (k === 0) d.notes.push(`@${creator.handle} a publié sa vidéo sur « ${short(p.title, 40)} » (${fmtInt(views)} vues).`);
  }
}

// ───────────────────────────── 4. sales ─────────────────────────────

function newOrder(d: Day, p: Product, source: Order['source'], t: Pick<Traffic, 'campaignId' | 'creatorId'> & { channel?: ChannelId }, customer?: Customer): Order {
  const { world, rng } = d;
  const c = customer ?? createCustomer(world, rng, buyerArchetype(rng, world.scenario?.difficulty ?? 'normal'));
  const o: Order = {
    id: nextId(world, 'ord'), day: d.day, customerId: c.id, productId: p.id, price: p.price, source,
    campaignId: t.campaignId, creatorId: t.creatorId, refunded: false, chargeback: false, charges: 1, downloads: 1,
    ...(t.channel && t.channel !== 'tiktok' ? { channel: t.channel } : {}),
  };
  c.orders.push(o.id);
  world.market.orders.push(o);
  d.newOrders.push(o);
  p.stats.sales += 1;
  p.stats.revenue = round2(p.stats.revenue + p.price);
  d.sales += 1;
  d.revenue = round2(d.revenue + p.price);
  return o;
}

const SOURCE_LABEL: Record<Exclude<Order['source'], 'ads'>, string> = { organic: 'TikTok organique', creator: 'créateurs', upsell: 'upsell « La suite est ici »', email: 'e-mails', bump: 'offre à la commande' };

function bookRevenue(d: Day, p: Product, source: Order['source'], count: number, amount: number, channel: ChannelId = 'tiktok'): void {
  if (count <= 0 || amount <= 0) return;
  const label = source === 'ads' ? `pubs ${CHANNELS[channel].label}` : SOURCE_LABEL[source];
  recordLedger(d.world, { type: 'revenue', amount, memo: `${count} vente${count > 1 ? 's' : ''} « ${short(p.title, 40)} » (${label})`, ref: p.id });
}

function runSales(d: Day): void {
  const { world } = d;
  if (!d.traffic.length) return;
  const key = d.rng.int(0, 0x7fffffff);
  const byProduct = new Map<string, Traffic[]>();
  for (const t of d.traffic) {
    const list = byProduct.get(t.productId) ?? [];
    list.push(t);
    byProduct.set(t.productId, list);
  }
  // niche saturation: each channel's daily buyer pool is finite (demand-scaled). Search is capped by its queries instead
  const pooled = (t: Traffic) => CHANNELS[t.channel].buying === 'cpm';
  const nicheViews = new Map<string, { n: NicheTruth; views: Map<ChannelId, number> }>();
  for (const t of d.traffic) {
    const p = productById(world, t.productId);
    if (!p || !pooled(t)) continue;
    const n = d.niche(p);
    const line = nicheViews.get(n.id) ?? { n, views: new Map<ChannelId, number>() };
    line.views.set(t.channel, (line.views.get(t.channel) ?? 0) + t.landingViews);
    nicheViews.set(n.id, line);
  }
  const saturation = new Map<string, number>();
  for (const [id, { n, views }] of nicheViews) {
    let total = 0;
    for (const v of views.values()) total += v;
    for (const [ch, v] of views) saturation.set(`${id}:${ch}`, poolSaturation(nichePool(world, n, ch), v, total - v, overlapOf(ch)));
  }
  for (const [productId, entries] of byProduct) {
    const p = productById(world, productId);
    if (!p) continue;
    const views = entries.reduce((s, t) => s + t.landingViews, 0);
    p.stats.views += views;
    if (d.outage || p.status !== 'live') continue;
    const rng = d.focus(key, world.company.products.indexOf(p));
    const cvr0 = baseCvr(d, p) * d.noise(CONVERSION.noiseSd);
    const nicheId = d.niche(p).id;
    const bySource = new Map<string, { source: Order['source']; channel: ChannelId; n: number; amount: number }>();
    for (const t of entries) {
      const sat = pooled(t) ? saturation.get(`${nicheId}:${t.channel}`) ?? 1 : 1;
      const eff = Math.round(t.landingViews * sat);
      const n = rng.binomial(eff, Math.min(CONVERSION.maxCvr, cvr0 * t.cvrMult));
      if (n <= 0) continue;
      for (let i = 0; i < n; i++) newOrder(d, p, t.source, t);
      const amount = round2(n * p.price);
      const slot = `${t.source}:${t.channel}`;
      const agg = bySource.get(slot) ?? { source: t.source, channel: t.channel, n: 0, amount: 0 };
      agg.n += n; agg.amount = round2(agg.amount + amount);
      bySource.set(slot, agg);
      if (t.stat) {
        t.stat.purchases += n;
        t.stat.revenue = round2(t.stat.revenue + amount);
        t.stat.roas = t.stat.spend > 0 ? round2(t.stat.revenue / t.stat.spend) : 0;
      }
      if (t.postId) {
        const post = world.market.organicPosts.find((x) => x.id === t.postId);
        if (post) post.sales += n;
      }
      if (t.partnershipId) {
        const pt = world.market.partnerships.find((x) => x.id === t.partnershipId);
        const creator = world.market.creators.find((c) => c.id === t.creatorId);
        if (pt) {
          pt.sales += n;
          pt.revenue = round2(pt.revenue + amount);
          const commission = round2(amount * pt.commission);
          if (commission > 0) recordLedger(world, { type: 'creator_payout', amount: -commission, memo: `Commission @${creator?.handle ?? 'créateur'} (${fmtPct(pt.commission, 0)} de ${fmtEur(amount)})`, ref: pt.id });
        }
      }
    }
    for (const agg of bySource.values()) bookRevenue(d, p, agg.source, agg.n, agg.amount, agg.channel);
  }
  if (d.outage) d.notes.push('Panne de paiement de la boutique : aucune vente possible aujourd\'hui malgré le trafic.');
}

// ───────────────────────────── 5. upsells ─────────────────────────────

function runUpsells(d: Day): void {
  const { world, rng } = d;
  const base = d.newOrders.filter((o) => o.source !== 'upsell');
  const agg = new Map<string, { n: number; amount: number }>();
  for (const o of base) {
    const p = productById(world, o.productId);
    if (!p) continue;
    const upId = p.content?.nextStep?.upsellProductId ?? p.upsellProductId;
    if (!upId || upId === p.id) continue;
    const up = productById(world, upId);
    if (!up || up.status !== 'live') continue;
    if (!rng.chance(upsellRate((d.pdfQ(p).overall + d.pdfQ(up).overall) / 2, up.price, d.niche(up).wtp))) continue;
    const customer = d.customer(o.customerId);
    newOrder(d, up, 'upsell', { campaignId: o.campaignId, creatorId: o.creatorId, ...(o.channel ? { channel: o.channel } : {}) }, customer);
    p.stats.upsellSales += 1;
    d.upsells += 1;
    const a = agg.get(up.id) ?? { n: 0, amount: 0 };
    a.n += 1; a.amount = round2(a.amount + up.price);
    agg.set(up.id, a);
  }
  for (const [id, a] of agg) {
    const up = productById(world, id);
    if (up) bookRevenue(d, up, 'upsell', a.n, a.amount);
  }
  // payment processing fees for every sale of the day
  if (d.newOrders.length) {
    const fee = round2(d.newOrders.reduce((s, o) => s + o.price * FEES.paymentPct + FEES.paymentFixed, 0));
    recordLedger(world, { type: 'payment_fee', amount: -fee, memo: `Frais de paiement (${d.newOrders.length} transaction${d.newOrders.length > 1 ? 's' : ''})`, ref: `fees:${d.day}` });
  }
}

// ───────────────────────────── 6. refunds ─────────────────────────────

export { SETUP_REF };

const REFUND_WEIGHTS: number[] = (() => {
  const w = Array.from({ length: REFUNDS.windowDays }, (_, i) => Math.exp(-i / REFUNDS.decayDays));
  const total = w.reduce((s, x) => s + x, 0);
  return w.map((x) => x / total);
})();

const INBOX_REFUNDERS: ReadonlySet<string> = new Set(['karen', 'sceptique', 'menace_chargeback', 'impatient']);

export function refundProbability(d: Day, p: Product, c: Customer | undefined, order: Pick<Order, 'price' | 'source'>): number {
  const n = d.niche(p);
  const pdf = d.pdfQ(p);
  const base = d.diff.refundBase * (REFUNDS.sensitivityMin + REFUNDS.sensitivitySpan * n.refundSensitivity);
  const gap = promiseShortfall(d, p) * REFUNDS.gapWeight;
  const lowQ = (Math.max(0, REFUNDS.lowQualityThreshold - pdf.overall) / 100) * REFUNDS.lowQualityWeight;
  const arche = c ? REFUNDS.archetypeBonus[c.archetype] ?? 0 : 0;
  const regret = overprice(order.price, visualWtp(n.wtp, p.visual)) * REFUNDS.overpriceWeight;
  const paidTwice = order.source === 'upsell' ? d.echo(p) * REFUNDS.echoWeight : 0;
  return clamp(base + gap + lowQ + arche + regret + paidTwice - visualRefund(p.visual), 0, REFUNDS.maxCumulative);
}

function hasRequest(world: WorldState, orderId: string): boolean {
  return world.market.inbox.some((m) => m.orderId === orderId && (m.intent === 'remboursement' || m.intent === 'menace_chargeback' || m.intent === 'plainte_qualite' || m.intent === 'arnaque'));
}

function runRefunds(d: Day): void {
  const { world, rng } = d;
  const orders = world.market.orders;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]!;
    const age = d.day - o.day;
    if (age > REFUNDS.windowDays) break;
    if (age < 1 || o.refunded || o.chargeback) continue;
    const p = productById(world, o.productId);
    if (!p) continue;
    const c = d.customer(o.customerId);
    if (c?.archetype === 'chasseur_de_remboursement') {
      if (age <= REFUNDS.hunterWindow && rng.chance(REFUNDS.hunterRequestChance) && !hasRequest(world, o.id)) {
        createMessage(world, rng, { intent: 'remboursement', customer: c, product: p, order: o, niche: d.niche(p) });
        d.messages++;
      }
      continue;
    }
    const hazard = refundProbability(d, p, c, o) * (REFUND_WEIGHTS[age - 1] ?? 0);
    if (!rng.chance(hazard)) continue;
    if (c && INBOX_REFUNDERS.has(c.archetype)) {
      if (hasRequest(world, o.id)) continue;
      const intent: MessageIntent = c.archetype === 'menace_chargeback' ? 'menace_chargeback'
        : c.archetype === 'karen' ? (rng.chance(0.5) ? 'plainte_qualite' : 'remboursement')
          : c.archetype === 'sceptique' ? (rng.chance(0.5) ? 'plainte_qualite' : 'remboursement') : 'remboursement';
      createMessage(world, rng, { intent, customer: c, product: p, order: o, niche: d.niche(p) });
      d.messages++;
      continue;
    }
    const amount = refundOrder(world, o, `Remboursement via la plateforme — « ${short(p.title, 40)} »`);
    if (amount > 0) { d.refunds++; d.refundAmount = round2(d.refundAmount + amount); }
  }
}

// ───────────────────────────── 7. reviews ─────────────────────────────

const RATING_SHIFT: Partial<Record<Customer['archetype'], number>> = { karen: -1, troll: -2, sceptique: -0.5, superfan: 0.8, chasseur_de_remboursement: -0.7 };

/** The rating this buyer leans to, before his mood of the day. */
export function reviewMean(d: Day, p: Product, c: Customer | undefined, o: Pick<Order, 'price' | 'source' | 'refunded'>): number {
  const paidTwice = o.source === 'upsell' ? d.echo(p) * REVIEWS.echoPenalty : 0;
  return REVIEWS.ratingIntercept + REVIEWS.ratingSlope * d.pdfQ(p).overall - REVIEWS.promiseGapPenalty * promiseShortfall(d, p) - paidTwice
    - REVIEWS.overpricePenalty * overprice(o.price, visualWtp(d.niche(p).wtp, p.visual)) + (c ? RATING_SHIFT[c.archetype] ?? 0 : 0) - (o.refunded ? 1.5 : 0) + visualRating(p.visual);
}

function runReviews(d: Day): void {
  const { world, rng } = d;
  const reviewed = new Set<string>();
  for (const p of world.company.products) for (const r of p.stats.reviews) reviewed.add(`${r.customerId}|${p.id}`);
  const orders = world.market.orders;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]!;
    const age = d.day - o.day;
    if (age > REVIEWS.maxAge) break;
    if (age < REVIEWS.minAge) continue;
    const key = `${o.customerId}|${o.productId}`;
    if (reviewed.has(key)) continue;
    const c = d.customer(o.customerId);
    const chance = o.refunded ? REVIEWS.refundedChance : (c ? REVIEWS.archetypeChance[c.archetype] : undefined) ?? REVIEWS.dailyChance;
    if (!rng.chance(chance)) continue;
    const p = productById(world, o.productId);
    if (!p) continue;
    const rating = Math.round(clamp(rng.normal(reviewMean(d, p, c, o), REVIEWS.ratingSd), 1, 5));
    reviewProduct(world, rng, p, c, rating, 'product');
    reviewed.add(key);
  }
}

// ───────────────────────────── 8. inbox ─────────────────────────────

const BUYER_INTENTS: Record<Customer['archetype'], [MessageIntent, number][]> = {
  normal: [['question', 0.4], ['non_recu', 0.25], ['compliment', 0.15], ['bug_paiement', 0.1], ['plainte_qualite', 0.1]],
  impatient: [['non_recu', 0.6], ['question', 0.3], ['bug_paiement', 0.1]],
  sceptique: [['plainte_qualite', 0.5], ['question', 0.3], ['remboursement', 0.2]],
  chasseur_de_remboursement: [['question', 0.5], ['non_recu', 0.5]],
  troll: [['troll', 1]],
  karen: [['plainte_qualite', 0.5], ['non_recu', 0.3], ['bug_paiement', 0.2]],
  perdu: [['non_recu', 0.5], ['bug_paiement', 0.3], ['question', 0.2]],
  superfan: [['compliment', 0.7], ['sur_mesure', 0.3]],
  arnaqueur: [['arnaque', 1]],
  menace_chargeback: [['menace_chargeback', 0.6], ['non_recu', 0.4]],
  demande_sur_mesure: [['sur_mesure', 0.8], ['question', 0.2]],
};

/**
 * Friendly fraud: a real buyer who keeps the guide and files a false claim to get his money back. The rate scales
 * with the difficulty's scam rate; the claim reads like an honest one and only the order's logs contradict it.
 */
function runFriendlyFraud(d: Day): void {
  const { world, rng, diff } = d;
  const chance = (diff.scamRate * SCAM.friendlyFraudPerRate) / SCAM.friendlyFraudWindowDays;
  const orders = world.market.orders;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]!;
    const age = d.day - o.day;
    if (age > SCAM.friendlyFraudWindowDays) break;
    if (age < 1 || o.refunded || o.chargeback || !rng.chance(chance) || hasRequest(world, o.id)) continue;
    const p = productById(world, o.productId);
    const c = d.customer(o.customerId);
    if (!p || !c) continue;
    createMessage(world, rng, { intent: 'arnaque', customer: c, product: p, order: o, niche: d.niche(p), channel: 'email' });
    d.messages++;
  }
}

function runInbox(d: Day): void {
  const { world, rng, diff } = d;
  const live = world.company.products.filter((p) => p.status === 'live');

  // a) buyers who write in
  const buyers = d.newOrders.filter((o) => o.source !== 'upsell');
  const k = rng.binomial(buyers.length, diff.inboxPerSale);
  for (const o of rng.shuffle(buyers.slice()).slice(0, k)) {
    const c = d.customer(o.customerId);
    const p = productById(world, o.productId);
    if (!c || !p) continue;
    const intent = pickWeighted(rng, BUYER_INTENTS[c.archetype] ?? BUYER_INTENTS.normal);
    createMessage(world, rng, { intent, customer: c, product: p, order: o, niche: d.niche(p) });
    d.messages++;
  }

  // b) background noise: scams, spam partnerships, trolls, prospects
  const difficulty = world.scenario?.difficulty ?? 'normal';
  const noise = rng.poisson((INBOX.baseNoise[difficulty] ?? 0.45) + diff.scamRate * 0.5);
  for (let i = 0; i < noise; i++) {
    const intent = pickWeighted<MessageIntent>(rng, [
      ['arnaque', 0.3 + diff.scamRate], ['partenariat', 0.3], ['troll', live.length ? 0.15 : 0.05],
      ['question', live.length ? 0.25 : 0], ['sur_mesure', live.length ? 0.06 : 0],
    ]);
    const p = live.length ? rng.pick(live) : null;
    const c = createCustomer(world, rng, senderArchetype(rng, intent));
    createMessage(world, rng, { intent, customer: c, product: p, order: null, niche: p ? d.niche(p) : undefined });
    d.messages++;
  }

  // c) ad comments that turn into conversations. Another channel's row draws on its own stream: the follow-ups below keep theirs
  for (const [index, s] of world.market.adStats.entries()) {
    if (s.day !== d.day) continue;
    const p = productById(world, s.productId);
    if (!p) continue;
    const tiktok = channelOf(s) === 'tiktok';
    const rowRng = tiktok ? rng : streamRng(d.dayKey, CHANNEL_STREAM.comments, index);
    for (const cm of s.comments) {
      const chance = INBOX.commentToMessage[cm.tone] ?? 0;
      if (!chance || !rowRng.chance(chance)) continue;
      const intent: MessageIntent = cm.tone === 'troll' ? 'troll' : 'question';
      const c = createCustomer(world, rowRng, senderArchetype(rowRng, intent));
      c.name = `@${cm.author}`;
      const msg = createMessage(world, rowRng, { intent, customer: c, product: p, order: null, niche: d.niche(p), channel: tiktok ? 'commentaire_tiktok' : 'commentaire_pub' });
      msg.subject = 'Commentaire sous votre pub';
      msg.body = cm.text;
      msg.thread = [{ from: 'customer', text: cm.text, day: d.day }];
      d.messages++;
    }
  }

  // d) follow-ups on unsatisfying replies, quiet closing of the rest
  for (const msg of world.market.inbox) {
    if (msg.status !== 'replied') continue;
    const lastAgent = [...msg.thread].reverse().find((t) => t.from !== 'customer');
    const lastDay = lastAgent?.day ?? msg.day;
    if (lastDay >= d.day) continue;
    const c = d.customer(msg.customerId);
    const agentReplies = msg.thread.filter((t) => t.from !== 'customer').length;
    const chance = c ? INBOX.followUpChance[c.archetype] ?? INBOX.followUpDefault : INBOX.followUpDefault;
    if (agentReplies <= INBOX.maxFollowUps && lastDay === d.day - 1 && rng.chance(chance)) {
      const text = followUpText(rng, msg, c?.archetype ?? 'normal');
      msg.thread.push({ from: 'customer', text, day: d.day });
      msg.status = 'open';
      msg.deadlineDay = d.day + 1;
      msg.mood = round2(clamp(msg.mood - 0.15, -1, 1));
      d.messages++;
    } else if (d.day - lastDay >= INBOX.quietCloseDays) {
      msg.status = 'resolved';
      msg.resolution = msg.resolution ?? 'Le client n\'a pas relancé.';
    }
  }
}

// ───────────────────────────── 9. escalations ─────────────────────────────

function badSupportReview(d: Day, msg: InboxMessage, c: Customer | undefined): boolean {
  const p = productById(d.world, msg.productId);
  if (!p || !msg.orderId) return false; // only buyers can review
  reviewProduct(d.world, d.rng, p, c, d.rng.chance(0.65) ? 1 : 2, 'support_bad');
  d.badReviews++;
  return true;
}

/** The customer goes to his bank. Returns the cost (0 when the order was already refunded or disputed). */
function dispute(d: Day, order: Order): number {
  const left = repayableLeft(order);
  const cost = chargebackOrder(d.world, order);
  if (cost > 0) { d.chargebacks++; d.refunds++; d.refundAmount = round2(d.refundAmount + left); }
  return cost;
}

function runEscalations(d: Day): void {
  const { world, rng } = d;
  for (const msg of world.market.inbox) {
    if (msg.status !== 'open' || msg.deadlineDay >= d.day) continue;
    const c = d.customer(msg.customerId);
    const order = orderById(world, msg.orderId);
    const angry = c?.archetype === 'karen' || c?.archetype === 'menace_chargeback';
    switch (msg.intent) {
      case 'arnaque': case 'troll': case 'partenariat': {
        // a false claim left unanswered can still end at the buyer's bank: the order is real
        const cost = msg.intent === 'arnaque' && order && rng.chance(SCAM.friendlyDisputeIgnored) ? dispute(d, order) : 0;
        msg.status = cost > 0 ? 'escalated' : 'resolved';
        msg.resolution = cost > 0 ? `Message ignoré → litige bancaire (${fmtEur(cost)}).` : 'Ignoré : aucune conséquence.';
        continue;
      }
      case 'compliment':
        msg.status = 'resolved';
        msg.resolution = 'Resté sans réponse.';
        if (c) c.satisfaction = round2(clamp(c.satisfaction - 0.1, -1, 1));
        continue;
      default: break;
    }
    let outcome = 'Client sans réponse : abandon.';
    const cbChance = (ESCALATION.chargeback[msg.intent] ?? 0) + (angry ? ESCALATION.angryArchetypeBoost : 0);
    if (order && !order.refunded && cbChance > 0 && rng.chance(Math.min(0.95, cbChance))) {
      const cost = dispute(d, order);
      if (cost > 0) outcome = `Message ignoré → litige bancaire (${fmtEur(cost)}).`;
    } else if (rng.chance(Math.min(1, (ESCALATION.badReview[msg.intent] ?? 0) + (angry ? 0.3 : 0)))) {
      if (badSupportReview(d, msg, c)) outcome = 'Message ignoré → avis négatif publié.';
    }
    msg.status = 'escalated';
    msg.resolution = outcome;
    msg.thread.push({ from: 'customer', text: c?.archetype === 'karen' ? 'AUCUNE RÉPONSE. Vous allez le regretter.' : 'Toujours aucune réponse… tant pis.', day: d.day });
    if (c) c.satisfaction = round2(clamp(c.satisfaction - 0.4, -1, 1));
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function pushEventSafe(d: Day, kind: WorldEventKind, title: string, description: string, severity: WorldEvent['severity'], refs?: EventRefs): WorldEvent {
  const ev = pushEvent(d.world, kind, title, description, severity, refs);
  d.eventIds.push(ev.id);
  return ev;
}

function housekeeping(d: Day): void {
  const m = d.world.market;
  if (m.adAccount.banned && d.day >= m.adAccount.bannedUntilDay) {
    m.adAccount.banned = false;
    m.adAccount.strikes = 0;
    d.notes.push('Compte publicitaire réactivé : les campagnes peuvent reprendre.');
    emit(d.world, { agentId: null, kind: 'ad', text: 'Fin de suspension : le compte publicitaire TikTok est réactivé.' });
  }
  for (const [id, acc] of Object.entries(m.channels?.accounts ?? {})) {
    if (!acc.banned || d.day < acc.bannedUntilDay) continue;
    acc.banned = false;
    acc.strikes = 0;
    const label = id === 'google' ? 'Google' : CHANNELS[id as ChannelId].label; // the account also carries YouTube
    d.notes.push(`Compte ${label} réactivé : les campagnes peuvent reprendre.`);
    emit(d.world, { agentId: null, kind: 'ad', text: `Fin de suspension : le compte publicitaire ${label} est réactivé.` });
  }
  if (m.modifiers.cpmUntilDay < d.day && m.modifiers.cpmMultiplier !== 1) m.modifiers.cpmMultiplier = 1;
  const released = releaseHolds(d.world);
  if (released > 0) {
    d.cash = round2(d.cash + released); // the released money is spendable today (ads are capped by cash)
    d.notes.push(`Réserve de paiement libérée : ${fmtEur(released)} de retour en trésorerie.`);
  }
}

function prune(d: Day): void {
  const m = d.world.market;
  const minDay = d.day - STATS.keepAdStatsDays;
  if (m.adStats.length && m.adStats[0]!.day < minDay) {
    const retired = (m.retiredAdTotals ??= {});
    for (const s of m.adStats) if (s.day < minDay) addAdTotals(retired, s);
    m.adStats = m.adStats.filter((s) => s.day >= minDay);
  }
  const inboxMin = d.day - INBOX.keepDays;
  if (m.inbox.length && m.inbox[0]!.day < inboxMin) m.inbox = m.inbox.filter((x) => x.day >= inboxMin || x.status === 'open' || x.status === 'replied');
}

function summarize(d: Day, result: MarketDayResult): void {
  const { world } = d;
  const adLines: string[] = [];
  for (const ch of CHANNEL_IDS) {
    const t = d.ads.get(ch);
    if (!t || t.spend <= 0) continue;
    const ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
    const adRevenue = world.market.adStats.filter((s) => s.day === d.day && channelOf(s) === ch).reduce((s, x) => s + x.revenue, 0);
    adLines.push(`Pubs ${CHANNELS[ch].label} : ${fmtEur(t.spend)} dépensés, ${fmtInt(t.impressions)} impressions, ${fmtInt(t.clicks)} clics (CTR ${fmtPct(ctr)}), ROAS ${fmtNum(adRevenue / t.spend, 2)}.`);
  }
  d.notes.unshift(...adLines);
  for (const line of adLines) emit(world, { agentId: null, kind: 'ad', text: line });
  const live = world.company.products.some((p) => p.status === 'live');
  if (d.sales > 0) {
    const line = `${plural(d.sales, 'vente', 'ventes')} aujourd'hui (${fmtEur(d.revenue)})${d.upsells ? `, dont ${plural(d.upsells, 'upsell', 'upsells')}` : ''}.`;
    d.notes.push(line);
    emit(world, { agentId: null, kind: 'sale', text: line });
  } else if (live && !d.outage) d.notes.push('Aucune vente aujourd\'hui.');
  if (d.refunds > 0) {
    const line = `${plural(d.refunds, 'remboursement', 'remboursements')} (${fmtEur(d.refundAmount)})${d.chargebacks ? `, dont ${plural(d.chargebacks, 'litige bancaire', 'litiges bancaires')}` : ''}.`;
    d.notes.push(line);
    emit(world, { agentId: null, kind: 'refund', text: line });
  }
  if (d.badReviews > 0) d.notes.push(`${plural(d.badReviews, 'avis négatif', 'avis négatifs')} suite à des messages restés sans réponse.`);
  if (d.messages > 0) {
    const line = `${plural(d.messages, 'nouveau message client', 'nouveaux messages clients')} dans la boîte de réception.`;
    d.notes.push(line);
    emit(world, { agentId: null, kind: 'message', text: line });
  }
  result.sales = d.sales;
  result.revenue = round2(d.revenue);
  result.refunds = d.refunds;
  result.refundAmount = round2(d.refundAmount);
  result.adSpend = round2(d.adSpend);
  result.newMessages = d.messages;
  result.events = d.eventIds.slice();
  result.notes = d.notes.slice();
}

// ───────────────────────────── phases still empty ─────────────────────────────
// Their place and stream are already fixed in DAY_PHASES: the package that fills one writes its body and shifts nothing.

/** P10.2 */
function runEmail(_d: Day): void { /* empty */ }
/** P10.2 */
function runCapture(_d: Day): void { /* empty */ }
/** P10.2 */
function runBumps(_d: Day): void { /* empty */ }
/** P10.2 */
function runRivals(_d: Day): void { /* empty */ }

function rollDayEvents(d: Day): void {
  const before = d.world.market.events.length;
  rollEvents(d.world, d.rng, d.diff);
  for (const ev of d.world.market.events.slice(before)) {
    d.eventIds.push(ev.id);
    d.notes.push(`Événement : ${ev.title}.`);
  }
}

// ───────────────────────────── entry point ─────────────────────────────

/**
 * The order of a close. Each phase draws from its own stream: one more click in the ads does not change who refunds, nor
 * which event comes. A number is given once and for good, so a new phase takes a new number. null: the phase draws nothing.
 */
export const DAY_PHASES: readonly { run: (d: Day) => void; stream: number | null }[] = [
  { run: housekeeping, stream: 0 },
  { run: runAds, stream: 1 },
  { run: runOrganic, stream: 2 },
  { run: runCreators, stream: 3 },
  { run: runEmail, stream: 100 },
  { run: runSales, stream: 4 },
  { run: runCapture, stream: 102 },
  { run: runBumps, stream: 103 },
  { run: runUpsells, stream: 5 },
  { run: runRefunds, stream: 6 },
  { run: runReviews, stream: 7 },
  { run: runFriendlyFraud, stream: 8 },
  { run: runInbox, stream: 9 },
  { run: runEscalations, stream: 10 },
  { run: (d) => runClaims(d.world, d.rng), stream: 1004 },
  { run: (d) => updateWarmth(d.world), stream: null },
  { run: rollDayEvents, stream: 11 },
  { run: (d) => rollChannelEvents(d.world, d.rng), stream: 1005 },
  { run: runRivals, stream: 101 },
];

export function tickMarket(world: WorldState, rng: Rng): MarketDayResult {
  const day = world.day;
  const result: MarketDayResult = { day, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, adSpend: 0, newMessages: 0, events: [], notes: [] };
  if (world.ledger.some((e) => e.ref === `fixed:${day}`)) {
    result.notes.push(`Le marché du jour ${day} est déjà clôturé.`);
    return result;
  }
  const d = new Day(world, rng, difficultyProfile(world.scenario?.difficulty ?? 'normal'));
  d.dayKey = rng.int(0, 0x7fffffff);
  for (const { run, stream } of DAY_PHASES) {
    if (stream !== null) d.rng = streamRng(d.dayKey, stream);
    run(d);
  }
  // One-off launch costs, booked at the very first market close (store theme, domain, ad pixel, e-mail tool):
  // the agency starts slightly in the red, as any real one does, instead of "profitable" after its first sale.
  if (FEES.setupCost > 0 && !world.ledger.some((e) => e.ref === SETUP_REF)) {
    recordLedger(world, { type: 'tool_subscription', amount: -FEES.setupCost, memo: 'Frais de démarrage : thème de boutique, nom de domaine, pixel publicitaire, outil e-mail', ref: SETUP_REF });
  }
  recordLedger(world, { type: 'platform_fee', amount: -FEES.boutiqueDaily, memo: 'Abonnement boutique (29 €/mois)', ref: `fixed:${day}` });
  recordLedger(world, { type: 'tool_subscription', amount: -FEES.toolsDaily, memo: 'Outils (12 €/mois)', ref: `fixed:${day}:outils` });
  prune(d);
  summarize(d, result);
  return result;
}
