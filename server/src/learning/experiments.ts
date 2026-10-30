/** A/B experiments: results recomputed from world data, concluded on sample size or after 7 days. */
import type { Experiment, WorldState } from '../shared.js';
import { nextId } from '../core/index.js';
import { empiricalMean, nearestArm } from './bandits.js';
import { addRow, adRows, emptyAgg, indexWorld, priceOnDay, productOfRow, type FunnelAgg } from './data.js';
import { round, safeDiv, unique } from './text.js';

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

export function startExperiment(
  world: WorldState,
  e: Omit<Experiment, 'id' | 'status' | 'results' | 'winner' | 'endDay'>,
): Experiment {
  const variants = unique((e.variants ?? []).map((v) => String(v).trim()).filter(Boolean));
  const exp: Experiment = {
    ...e,
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

/** Recomputes the results of one experiment from world data (days e.day..world.day). */
export function computeExperimentResults(world: WorldState, e: Experiment): Record<string, { n: number; value: number }> {
  const results: Record<string, { n: number; value: number }> = {};
  if (e.dimension === 'support_tone') {
    // Reply scores are only recorded through the 'support_tone' bandit (runtime rewards score / 100 after each reply).
    const arms = world.company.bandits?.support_tone ?? [];
    for (const v of e.variants) {
      const arm = arms.find((a) => a.key === v);
      results[v] = { n: arm?.pulls ?? 0, value: arm ? round(empiricalMean(arm) * 100, 1) : 0 };
    }
    return results;
  }

  const ix = indexWorld(world);
  const aggs = new Map<string, VariantAgg>(e.variants.map((v) => [v, emptyVariant()]));
  for (const r of adRows(world, e.day, world.day)) {
    const product = productOfRow(ix, r);
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
    if (o.day < e.day || o.day > world.day) continue;
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

function pickWinner(e: Experiment): string | null {
  const threshold = experimentThreshold(e);
  const candidates = Object.entries(e.results).filter(([, r]) => r.n >= Math.max(1, threshold * 0.25));
  if (candidates.length === 0 || (candidates.length < 2 && e.variants.length > 1)) return null;
  candidates.sort((a, b) => (lowerIsBetter(e) ? a[1].value - b[1].value : b[1].value - a[1].value) || b[1].n - a[1].n);
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
