/**
 * The market behind the channels (channels §3, §4.1): a niche's hidden cells, what a channel changes in delivery, Search,
 * the paid tail, the warm audience and the silent drift. Absent means TikTok everywhere: a run with no other channel takes
 * none of the branches below and keeps its bytes. Hidden truth: only channelSignals leaves for an agent, noisy, and nothing
 * here reaches a snapshot or the UI.
 */
import { clamp, round2, streamRng } from '../core/index.js';
import type { ChannelSignal, Rng } from '../contracts.js';
import { CHANNELS, CHANNEL_IDS, acceptance, channelOf } from '../shared.js';
import type { AdCreative, Campaign, ChannelCell, ChannelId, ChannelMarketState, DailyAdStats, MarketState, NicheTruth, WorldState } from '../shared.js';
import { ADS } from './balance.js';
import {
  ASSIST, CHANNEL_EVENTS, CHANNEL_FIT, CHANNEL_FIT_DEFAULT, CHANNEL_SIM, CHANNEL_STREAM, CHANNEL_VARIATION, COST_HINT, FAMILY_FATIGUE, FORMAT_FIT, LEARNING, PAID_TAIL, SEARCH,
  TIKTOK_OVERLAP, type PaidChannel,
} from './channelBalance.js';
import { uniform } from './text.js';

const PAID_CHANNELS: readonly PaidChannel[] = ['meta', 'youtube', 'pinterest', 'google'];

const closedAccount = (): ChannelMarketState['accounts']['meta'] => ({ strikes: 0, banned: false, bannedUntilDay: 0, openDay: null });

function drawCell(n: NicheTruth, ch: PaidChannel, column: number, rng: Rng): ChannelCell {
  const sim = CHANNEL_SIM[ch];
  const row = CHANNEL_FIT[n.id] ?? CHANNEL_FIT_DEFAULT;
  const vary = (x: number) => 1 + uniform(rng, -x, x);
  const fit = clamp(round2(row[column]! * vary(CHANNEL_VARIATION.fit)), 0.05, 1);
  const cell: ChannelCell = {
    fit,
    cpmMult: round2(sim.cpmMult * vary(CHANNEL_VARIATION.cost)),
    intent: round2(sim.intent * (0.7 + 0.6 * fit) * vary(CHANNEL_VARIATION.intent)), // a fitting audience also buys better
    poolShare: round2(sim.pool * (0.5 + fit)),
  };
  if (ch === 'google') {
    cell.searchClicksPerDemand = row[4];
    cell.cpcBase = round2(row[5] * vary(CHANNEL_VARIATION.cost));
  }
  return cell;
}

/**
 * Fills `market.channels` and the niches' cells, once. Never with the rng of createMarketState: each niche has its own stream
 * of the seed, so a `tiktok_only` world and a full one share every other byte. Safe on a reload, a save keeps its cells.
 */
export function ensureChannelMarket(world: Pick<WorldState, 'market' | 'scenario'>): void {
  const { market: m, scenario } = world;
  if ((scenario?.channelControl ?? 'tiktok_only') === 'tiktok_only') return;
  m.channels ??= { accounts: { meta: closedAccount(), google: closedAccount(), pinterest: closedAccount() }, impressions: {}, warm: {} };
  m.niches.forEach((n, index) => {
    if (n.channels) return;
    const rng = streamRng(scenario.seed, CHANNEL_STREAM.truth, index);
    n.channels = {};
    PAID_CHANNELS.forEach((ch, column) => { n.channels![ch] = drawCell(n, ch, column, rng); });
  });
}

/** A niche's truth on a channel. A niche without cells (the market's fallback one) reads the default row, with no variation. */
export function cellOf(n: NicheTruth, ch: PaidChannel): ChannelCell {
  const cell = n.channels?.[ch];
  if (cell) return cell;
  const sim = CHANNEL_SIM[ch];
  const fit = CHANNEL_FIT_DEFAULT[PAID_CHANNELS.indexOf(ch)]!;
  return {
    fit, cpmMult: sim.cpmMult, intent: sim.intent * (0.7 + 0.6 * fit), poolShare: sim.pool * (0.5 + fit),
    ...(ch === 'google' ? { searchClicksPerDemand: CHANNEL_FIT_DEFAULT[4], cpcBase: CHANNEL_FIT_DEFAULT[5] } : {}),
  };
}

/** The account a channel buys on: TikTok keeps `adAccount`, YouTube and Search share Google's. Undefined on a TikTok-only world. */
export function accountOf(m: MarketState, ch: ChannelId): MarketState['adAccount'] | undefined {
  const id = CHANNELS[ch].account;
  return id === 'tiktok' ? m.adAccount : m.channels?.accounts[id];
}

export function accountBanned(m: MarketState, ch: ChannelId, day: number): boolean {
  const a = accountOf(m, ch);
  return !!a && a.banned && day < a.bannedUntilDay;
}

/** `review` stays TikTok's moderation of a master. Every other channel keeps its own verdict, and its own format rules. */
export function approvedOn(c: AdCreative, ch: ChannelId): boolean {
  if (ch === 'tiktok') return c.review.status === 'approved';
  return c.channelReviews?.[ch]?.status === 'approved' && acceptance(ch, c) !== null;
}

// ───────────────────────────── delivery ─────────────────────────────

export interface DeliverySpec {
  cpmBase: number; fit: number; affinityExp: number; fatigue: number; landingRate: number;
  ctrScale: number; learningCtr: number; learningCpm: number;
  intent: number;              // CVR multiplier of a landing view
  poolShare: number;           // of the niche's reach, for the frequency
  formatFit(c: AdCreative): number;
  ratioFit(c: AdCreative): number;
}

/** True until a campaign of a channel with a learning phase has left it. A campaign the phase has not seen yet is in it. */
export function inLearning(camp: Pick<Campaign, 'channel' | 'learning'> | undefined): boolean {
  return !!camp && !!CHANNELS[channelOf(camp)].learning && (camp.learning?.exitedDay ?? null) === null;
}

/** What a channel changes in runAds. For TikTok, exactly the ADS values, n.cpmBase and n.tiktokAffinity, and neutral factors. */
export function deliverySpec(n: NicheTruth, ch: ChannelId, camp?: Pick<Campaign, 'channel' | 'learning'>): DeliverySpec {
  if (ch === 'tiktok') {
    return {
      cpmBase: n.cpmBase, fit: n.tiktokAffinity, affinityExp: ADS.affinityExp, fatigue: ADS.fatigueImpressions, landingRate: ADS.landingRate,
      ctrScale: 1, learningCtr: 1, learningCpm: 1, intent: 1, poolShare: 1,
      formatFit: (c) => n.formatAffinity[c.format] ?? 1,
      ratioFit: () => 1,
    };
  }
  const sim = CHANNEL_SIM[ch];
  const cell = cellOf(n, ch);
  const learning = inLearning(camp);
  return {
    cpmBase: n.cpmBase * cell.cpmMult, fit: cell.fit, affinityExp: sim.affinityExp, fatigue: sim.fatigue, landingRate: sim.landingRate,
    ctrScale: sim.ctrScale, learningCtr: learning ? LEARNING.ctr : 1, learningCpm: learning ? LEARNING.cpm : 1, intent: cell.intent, poolShare: cell.poolShare,
    formatFit: (c) => (n.formatAffinity[c.format] ?? 1) * (FORMAT_FIT[ch][c.format] ?? 1),
    ratioFit: (c) => acceptance(ch, c) ?? 1,
  };
}

/** A cut shares its master's fatigue. */
const familyOf = (c: Pick<AdCreative, 'id' | 'masterId'>): string => c.masterId ?? c.id;

/** Impressions that weigh on this creative: its own on this channel, plus a quarter of what its family showed elsewhere. */
export function familyPrior(m: MarketState, c: AdCreative, ch: ChannelId): number {
  const family = familyOf(c);
  const own = ch === 'tiktok' ? m.creativeImpressions[c.id] ?? 0 : m.channels?.impressions[ch]?.[family] ?? 0;
  let elsewhere = ch === 'tiktok' ? 0 : m.creativeImpressions[family] ?? 0;
  for (const o of PAID_CHANNELS) if (o !== ch) elsewhere += m.channels?.impressions[o]?.[family] ?? 0;
  return own + FAMILY_FATIGUE * elsewhere;
}

export function addImpressions(m: MarketState, c: AdCreative, ch: ChannelId, impressions: number): void {
  if (ch === 'tiktok') {
    m.creativeImpressions[c.id] = (m.creativeImpressions[c.id] ?? 0) + impressions;
    return;
  }
  const seen = ((m.channels!.impressions[ch] ??= {}));
  const family = familyOf(c);
  seen[family] = (seen[family] ?? 0) + impressions;
}

/** Other views at 0 leave a pool as it is. `overlap` is the share of them that also lands in this channel's pool. */
export function overlapOf(ch: ChannelId): number {
  return ch === 'tiktok' ? TIKTOK_OVERLAP : CHANNEL_SIM[ch].overlap;
}

export function reachOf(n: NicheTruth): number {
  return ADS.reachBase + ADS.reachDemand * n.demand;
}

/** 0..1, from yesterday's stock of paid exposure in the niche. */
export function warmth(m: MarketState, n: NicheTruth): number {
  const warm = m.channels?.warm[n.id] ?? 0;
  return warm / (warm + ASSIST.halfStock * reachOf(n));
}

// ───────────────────────────── Search ─────────────────────────────

/** Active Search campaigns of a niche: they share its queries. */
export function searchCampaigns(world: WorldState, nicheId: string): number {
  const live = (id: string) => world.company.products.some((p) => p.id === id && p.status === 'live' && p.nicheId === nicheId);
  return world.company.campaigns.filter((c) => c.status === 'active' && channelOf(c) === 'google' && live(c.productId)).length;
}

export interface SearchBuy { impressions: number; clicks: number; spend: number }

/**
 * Bought per click, capped by the queries of the day. The price climbs with the share of queries covered, and the next
 * euros buy less than the last ones: that falling marginal is what the allocator has to find. `budget` may stay unspent.
 */
export function deliverSearch(world: WorldState, n: NicheTruth, spec: DeliverySpec, quality: number, budget: number, sharers: number, rng: Rng): SearchBuy {
  const cell = cellOf(n, 'google');
  const dow = n.seasonality[(world.day - 1) % 7] ?? 1;
  const volume = ((cell.searchClicksPerDemand ?? 0) * n.demand * dow * (SEARCH.fitReach.min + SEARCH.fitReach.span * cell.fit)
    * (1 + ASSIST.maxLift * warmth(world.market, n))) / Math.max(1, sharers);
  const unit = (cell.cpcBase ?? 0) * Math.pow(SEARCH.qualityRef / Math.max(1, quality), SEARCH.qualityCpcExp) * spec.learningCpm * Math.exp(rng.normal(0, ADS.cpmNoiseSd));
  const cpcAt = (s: number) => unit * (SEARCH.cpc.min + SEARCH.cpc.span * Math.pow(s, SEARCH.cpc.exp));
  let share = 1;
  if (volume * cpcAt(1) > budget) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < SEARCH.bisections; i++) {
      const mid = (lo + hi) / 2;
      if (volume * mid * cpcAt(mid) <= budget) lo = mid; else hi = mid;
    }
    share = lo;
  }
  const relevance = clamp(quality / SEARCH.qualityRef, SEARCH.minRelevance, SEARCH.maxRelevance);
  const impressions = Math.round((volume * share) / (SEARCH.baseCtr * relevance));
  const clicks = rng.binomial(impressions, Math.min(1, SEARCH.baseCtr * relevance * spec.learningCtr * Math.exp(rng.normal(0, ADS.ctrNoiseSd))));
  return { impressions, clicks, spend: round2(Math.min(budget, clicks * cpcAt(share))) };
}

// ───────────────────────────── after the sales ─────────────────────────────

function rowsOfDay(m: MarketState, day: number): DailyAdStats[] {
  let i = m.adStats.length;
  while (i > 0 && m.adStats[i - 1]!.day === day) i--;
  return m.adStats.slice(i);
}

/** Phase 16, no draw. Today's rows feed the warm audience (§4.1) and the learning phases (§3.3). Nothing reads either with TikTok alone. */
export function updateWarmth(world: WorldState): void {
  const m = world.market;
  if (!m.channels) return;
  const warm = m.channels.warm;
  for (const id of Object.keys(warm)) warm[id] = warm[id]! * ASSIST.decay;
  const sold = new Map<string, number>();
  for (const s of rowsOfDay(m, world.day)) {
    const ch = channelOf(s);
    const weight = ASSIST.weights[ch] ?? 0;
    const nicheId = world.company.products.find((p) => p.id === s.productId)?.nicheId;
    if (nicheId && weight > 0 && s.impressions > 0) warm[nicheId] = (warm[nicheId] ?? 0) + s.impressions * weight;
    if (CHANNELS[ch].learning) sold.set(s.campaignId, (sold.get(s.campaignId) ?? 0) + s.purchases);
  }
  for (const [id, purchases] of sold) {
    const camp = world.company.campaigns.find((c) => c.id === id);
    if (!camp || !inLearning(camp)) continue;
    const phase = CHANNELS[channelOf(camp)].learning!;
    const l = (camp.learning ??= { events: 0, exitedDay: null });
    l.events += purchases;
    l.days = (l.days ?? 0) + 1;
    if (l.events >= phase.events || l.days >= phase.days) l.exitedDay = world.day;
  }
}

/**
 * The platforms' rule, for `updateCampaign` once its changes hold: a raise above 30 % or a change of creatives starts the
 * phase over. So small split budgets learn longer, and the allocator's +30 % a day is a real limit, not only a guardrail.
 */
export function learningAfterUpdate(camp: Campaign, before: Pick<Campaign, 'dailyBudget' | 'creativeIds'>): void {
  if (!CHANNELS[channelOf(camp)].learning) return;
  const raised = camp.dailyBudget > round2(before.dailyBudget * (1 + LEARNING.raise));
  const swapped = camp.creativeIds.length !== before.creativeIds.length || camp.creativeIds.some((id, i) => id !== before.creativeIds[i]);
  if (raised || swapped) camp.learning = { events: 0, exitedDay: null };
}

/**
 * A paid pin keeps earning: free clicks on the campaign, even paused, while the product is on sale. Writes the rows, spends
 * nothing, and gives them back for the day's traffic. A tail row keeps the CTR and frequency of the row it follows, so a
 * reader of the campaign's latest row does not take free clicks for fatigue.
 */
export function runPaidTails(world: WorldState, rng: Rng): DailyAdStats[] {
  const m = world.market;
  const ch = PAID_TAIL.channel;
  if (!m.channels || accountBanned(m, ch, world.day)) return [];
  const tails = new Map<string, DailyAdStats>();
  const from = world.day - PAID_TAIL.shares.length;
  for (let i = m.adStats.length - 1; i >= 0 && m.adStats[i]!.day >= from; i--) {
    const s = m.adStats[i]!;
    const share = PAID_TAIL.shares[world.day - s.day - 1];
    if (share === undefined || s.tail || channelOf(s) !== ch || s.clicks <= 0) continue;
    if (world.company.products.find((p) => p.id === s.productId)?.status !== 'live') continue;
    const clicks = Math.round(s.clicks * share * Math.exp(rng.normal(0, PAID_TAIL.noiseSd)));
    if (clicks <= 0) continue;
    const key = `${s.campaignId}:${s.creativeId}`;
    const row = tails.get(key);
    if (row) row.clicks += clicks;
    else {
      tails.set(key, {
        day: world.day, campaignId: s.campaignId, creativeId: s.creativeId, productId: s.productId,
        spend: 0, impressions: 0, clicks, ctr: s.ctr, cpc: 0, cpm: 0,
        landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: s.frequency, comments: [], channel: ch, tail: true,
      });
    }
  }
  const rows = [...tails.values()];
  for (const row of rows) {
    row.landingViews = rng.binomial(row.clicks, CHANNEL_SIM[ch].landingRate);
    m.adStats.push(row);
  }
  return rows;
}

/** The silent drift: one (channel, niche) that spent today moves for good. No event, no note: only the numbers show it. */
export function rollChannelEvents(world: WorldState, rng: Rng): void {
  const m = world.market;
  if (!m.channels || !rng.chance(CHANNEL_EVENTS.drift.chance)) return;
  const seen = new Map<string, { ch: PaidChannel; nicheId: string }>();
  for (const s of rowsOfDay(m, world.day)) {
    const ch = channelOf(s);
    const nicheId = world.company.products.find((p) => p.id === s.productId)?.nicheId;
    if (ch !== 'tiktok' && nicheId && s.spend > 0) seen.set(`${ch}:${nicheId}`, { ch, nicheId });
  }
  const lines = [...seen.values()];
  if (!lines.length) return;
  const { ch, nicheId } = rng.pick(lines);
  const cell = m.niches.find((n) => n.id === nicheId)?.channels?.[ch];
  if (cell) cell.fit = clamp(round2(cell.fit * (rng.chance(0.5) ? CHANNEL_EVENTS.drift.down : CHANNEL_EVENTS.drift.up)), 0.05, 1);
}

// ───────────────────────────── what a planner tool shows ─────────────────────────────

function costHint(cost: number, limits: readonly [number, number]): ChannelSignal['costHint'] {
  return cost < limits[0] ? 'bas' : cost < limits[1] ? 'moyen' : 'élevé';
}

/** Noisy public reading of a niche on each channel: what Pinterest Trends, an audience planner or Keyword Planner would say. */
export function channelSignals(world: WorldState, nicheId: string): ChannelSignal[] {
  const m = world.market;
  const index = m.niches.findIndex((n) => n.id === nicheId);
  const n = m.niches[index];
  if (!m.channels || !n) return [];
  const rng = streamRng(world.scenario.seed, CHANNEL_STREAM.signals, world.day, index);
  return CHANNEL_IDS.map((channel) => {
    const fit = deliverySpec(n, channel).fit;
    const audience = Math.round(clamp(fit * 100 + rng.int(-20, 20), 0, 100));
    if (channel !== 'google') return { channel, audience, costHint: costHint(deliverySpec(n, channel).cpmBase, COST_HINT.cpm) };
    const cell = cellOf(n, channel);
    const cpc = round2((cell.cpcBase ?? 0) * (1 + uniform(rng, -COST_HINT.planner, COST_HINT.planner)));
    const searchClicks = Math.round((cell.searchClicksPerDemand ?? 0) * n.demand * (1 + uniform(rng, -COST_HINT.planner, COST_HINT.planner)));
    return { channel, audience, costHint: costHint(cpc, COST_HINT.cpc), searchClicks, cpc };
  });
}
