/** A/B experiments: results recomputed from world data, concluded on sample size or after 7 days. */
import type { Experiment, WorldState } from '../shared.js';
import { nextId } from '../core/index.js';
import { nearestArm } from './bandits.js';
import { addRow, adRows, emptyAgg, indexWorld, priceOnDay, productOfRow, type FunnelAgg } from './data.js';
import { fold, round, safeDiv, unique } from './text.js';

export const EXPERIMENT_MAX_DAYS = 7;

interface VariantAgg extends FunnelAgg {
  orders: number;
  refunded: number;
  refundAmount: number;
}

function emptyVariant(): VariantAgg {
  return { ...emptyAgg(), orders: 0, refunded: 0, refundAmount: 0 };
}

/** Sample size every variant needs before the experiment can conclude early. */
export function experimentThreshold(e: Pick<Experiment, 'dimension' | 'metric'>): number {
  if (e.dimension === 'support_tone' || e.metric === 'resolution') return 20;   // replies
  if (e.metric === 'ctr') return 3000;                                          // impressions
  if (e.metric === 'refund_rate') return 30;                                    // orders
  if (e.dimension === 'price') return 120;                                     // landing views (a price needs sales, not clicks)
  return 60;                                                                    // landing views
}

export function lowerIsBetter(e: Pick<Experiment, 'metric'>): boolean {
  return e.metric === 'refund_rate';
}

/** What the result "value" means, for display. */
export function experimentValueKind(e: Pick<Experiment, 'dimension' | 'metric'>): 'pct' | 'eur' | 'ratio' | 'score' {
  if (e.dimension === 'support_tone' || e.metric === 'resolution') return 'score';
  if (e.dimension === 'price' && e.metric !== 'refund_rate') return 'eur';
  if (e.metric === 'roas') return 'ratio';
  return 'pct';
}

/** Dimensions measured on a product's market data (and therefore scoped to its niche). */
const NICHE_SCOPED: ReadonlySet<Experiment['dimension']> = new Set(['hook_style', 'ad_format', 'price', 'sales_hype']);

/**
 * Niche an experiment is about. An explicit `nicheId` (even null = global) wins; otherwise it is inferred
 * from the product named in the hypothesis (« Titre… »), so a test on one guide never mixes another
 * niche's traffic (old saves and callers that do not pass the field).
 */
export function experimentNiche(world: WorldState, e: Pick<Experiment, 'dimension' | 'hypothesis'> & { nicheId?: string | null }): string | null {
  if (e.nicheId !== undefined) return e.nicheId;
  if (!NICHE_SCOPED.has(e.dimension)) return null;
  const hyp = fold(e.hypothesis ?? '');
  let best: { nicheId: string; len: number } | null = null;
  for (const p of world.company.products ?? []) {
    const title = fold(p.title ?? '').trim();
    if (!title || !p.nicheId) continue;
    // hypotheses quote the title, sometimes cut with « … »: match on the longest common prefix (≥ 20 chars)
    for (const len of [title.length, 49, 40, 30, 20]) {
      if (len > title.length) continue;
      if (hyp.includes(title.slice(0, len))) {
        if (!best || len > best.len) best = { nicheId: p.nicheId, len };
        break;
      }
    }
  }
  return best?.nicheId ?? null;
}

export function startExperiment(
  world: WorldState,
  e: Omit<Experiment, 'id' | 'status' | 'results' | 'winner' | 'endDay'>,
): Experiment {
  const variants = unique((e.variants ?? []).map((v) => String(v).trim()).filter(Boolean));
  const exp: Experiment = {
    ...e,
    nicheId: experimentNiche(world, e),
    day: Number.isFinite(e.day) ? e.day : world.day,
    variants,
    id: nextId(world, 'exp'),
    status: 'running',
    results: Object.fromEntries(variants.map((v) => [v, { n: 0, value: 0 }])),
    winner: null,
    endDay: null,
  };
  (world.company.experiments ??= []).push(exp);
  return exp;
}

function variantOfOrder(e: Experiment, ix: ReturnType<typeof indexWorld>, productId: string, price: number): string | null {
  const p = ix.products.get(productId);
  switch (e.dimension) {
    case 'price': return nearestArm(price, e.variants);
    case 'sales_hype': return p?.salesPage ? nearestArm(p.salesPage.hypeLevel, e.variants) : null;
    case 'niche': return p && e.variants.includes(p.nicheId) ? p.nicheId : null;
    default: return null;
  }
}

export interface ReplyRecord { messageId: string; day: number; score: number; tone: string | null }

/**
 * Support replies with their score and tone. Score/day come from the message (InboxMessage.replyScore /
 * repliedDay, stamped by the sim); the tone used comes from the support task's structured output
 * (`output.replies[].tone`). Saves made before those fields existed fall back to the task output alone.
 */
export function replyRecords(world: WorldState, fromDay: number, toDay: number): ReplyRecord[] {
  const toneOf = new Map<string, { tone: string; score: number | null; day: number }>();
  for (const t of world.company.tasks ?? []) {
    if (t.kind !== 'reply_inbox') continue;
    const replies = (t.output as { replies?: unknown } | null)?.replies;
    if (!Array.isArray(replies)) continue;
    for (const r of replies) {
      const x = (r ?? {}) as { messageId?: unknown; tone?: unknown; score?: unknown };
      if (typeof x.messageId !== 'string' || typeof x.tone !== 'string' || !x.tone) continue;
      const score = Number(x.score);
      toneOf.set(x.messageId, { tone: x.tone, score: Number.isFinite(score) ? score : null, day: t.dayDone ?? t.dayCreated });
    }
  }
  const out: ReplyRecord[] = [];
  const seen = new Set<string>();
  for (const m of world.market?.inbox ?? []) {
    if (m.repliedDay === null || m.repliedDay === undefined || m.replyScore === null || m.replyScore === undefined) continue;
    seen.add(m.id);
    if (m.repliedDay < fromDay || m.repliedDay > toDay || !Number.isFinite(Number(m.replyScore))) continue;
    out.push({ messageId: m.id, day: m.repliedDay, score: Number(m.replyScore), tone: toneOf.get(m.id)?.tone ?? null });
  }
  for (const [messageId, r] of toneOf) {
    if (seen.has(messageId) || r.score === null || r.day < fromDay || r.day > toDay) continue;
    out.push({ messageId, day: r.day, score: r.score, tone: r.tone });
  }
  return out;
}

/** Recomputes the results of one experiment from world data (days e.day..world.day, its niche only). */
export function computeExperimentResults(world: WorldState, e: Experiment): Record<string, { n: number; value: number }> {
  const results: Record<string, { n: number; value: number }> = {};
  if (e.dimension === 'support_tone') {
    // only the replies sent during the experiment, with the tone actually used (never the all-time bandit)
    const per = new Map<string, { n: number; sum: number }>(e.variants.map((v) => [v, { n: 0, sum: 0 }]));
    for (const r of replyRecords(world, e.day, world.day)) {
      const agg = r.tone ? per.get(r.tone) : undefined;
      if (!agg) continue;
      agg.n += 1;
      agg.sum += r.score;
    }
    for (const [v, a] of per) results[v] = { n: a.n, value: a.n ? round(a.sum / a.n, 1) : 0 };
    return results;
  }

  const ix = indexWorld(world);
  const nicheId = experimentNiche(world, e);
  const inScope = (p: { nicheId: string } | undefined): boolean => !nicheId || p?.nicheId === nicheId;
  const aggs = new Map<string, VariantAgg>(e.variants.map((v) => [v, emptyVariant()]));
  for (const r of adRows(world, e.day, world.day)) {
    const product = productOfRow(ix, r);
    if (!inScope(product)) continue;
    let key: string | null = null;
    if (e.dimension === 'hook_style') key = ix.creatives.get(r.creativeId)?.hookStyle ?? null;
    else if (e.dimension === 'ad_format') key = ix.creatives.get(r.creativeId)?.format ?? null;
    else if (e.dimension === 'price') key = product ? nearestArm(priceOnDay(product, r.day), e.variants) : null;
    else if (e.dimension === 'sales_hype') key = product?.salesPage ? nearestArm(product.salesPage.hypeLevel, e.variants) : null;
    else if (e.dimension === 'niche') key = product?.nicheId ?? null;
    const agg = key ? aggs.get(key) : undefined;
    if (agg) addRow(agg, r);
  }
  for (const o of world.market?.orders ?? []) {
    if (o.day < e.day || o.day > world.day || !inScope(ix.products.get(o.productId))) continue;
    const key = variantOfOrder(e, ix, o.productId, o.price);
    const agg = key ? aggs.get(key) : undefined;
    if (!agg) continue;
    agg.orders += 1;
    if (o.refunded || o.chargeback) {
      agg.refunded += 1;
      agg.refundAmount += Math.abs(o.price);
    }
  }

  for (const [v, a] of aggs) {
    const refundRate = safeDiv(a.refunded, a.orders);
    let n = 0;
    let value = 0;
    if (e.metric === 'refund_rate') {
      n = a.orders;
      value = refundRate;
    } else if (e.dimension === 'price') {
      n = a.landingViews; // profit per visitor (Prix: "on compare le profit par visiteur")
      value = safeDiv(a.revenue - a.refundAmount, a.landingViews);
    } else if (e.metric === 'ctr') {
      n = a.impressions;
      value = safeDiv(a.clicks, a.impressions);
    } else if (e.metric === 'roas') {
      n = a.landingViews;
      value = safeDiv(a.revenue, a.spend);
    } else {
      n = a.landingViews;
      value = safeDiv(a.purchases, a.landingViews);
      // over-promising buys conversions with refunds: hype is judged on conversion net of refunds
      if (e.dimension === 'sales_hype') value *= 1 - Math.min(1, refundRate * 4);
    }
    results[v] = { n: Math.round(n), value: round(value, 4) };
  }
  return results;
}

/** A price test only names a winner on at least this many (estimated) sales across its variants… */
export const PRICE_TEST_MIN_SALES = 8;
/** …and when the winner earns at least this much more per visitor than the runner-up. */
export const PRICE_TEST_MIN_LIFT = 1.1;

export function pickWinner(e: Pick<Experiment, 'dimension' | 'metric' | 'variants' | 'results'>): string | null {
  const threshold = experimentThreshold(e);
  const candidates = Object.entries(e.results).filter(([, r]) => r.n >= Math.max(1, threshold * 0.25));
  if (candidates.length === 0 || (candidates.length < 2 && e.variants.length > 1)) return null;
  candidates.sort((a, b) => (lowerIsBetter(e) ? a[1].value - b[1].value : b[1].value - a[1].value) || b[1].n - a[1].n);
  if (e.dimension === 'price' && candidates.length >= 2) {
    // Revenue per visitor on a few dozen visitors is one or two sales: "19 € wins" on 1 sale vs 0 is noise, and
    // the runtime would then keep the guide at a price nobody pays. Inconclusive → null (the control stays).
    const sales = candidates.reduce((s, [v, r]) => s + (Number(v) > 0 ? (r.value * r.n) / Number(v) : 0), 0);
    const [best, second] = [candidates[0]![1], candidates[1]![1]];
    if (sales < PRICE_TEST_MIN_SALES || best.value < second.value * PRICE_TEST_MIN_LIFT) return null;
  }
  return candidates[0]![0];
}

export function updateExperiments(world: WorldState): Experiment[] {
  const concluded: Experiment[] = [];
  for (const e of world.company.experiments ?? []) {
    if (e.status !== 'running') continue;
    e.results = computeExperimentResults(world, e);
    const threshold = experimentThreshold(e);
    const enough = e.variants.length > 0 && e.variants.every((v) => (e.results[v]?.n ?? 0) >= threshold);
    const expired = world.day - e.day >= EXPERIMENT_MAX_DAYS;
    if (!enough && !expired) continue;
    e.status = 'concluded';
    e.endDay = world.day;
    e.winner = pickWinner(e);
    concluded.push(e);
  }
  return concluded;
}
