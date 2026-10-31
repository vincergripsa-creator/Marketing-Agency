/**
 * « L'agence s'améliore-t-elle ? »: what each reading takes from a closed day. Shared because the two ends of a comparison live
 * apart: a snapshot keeps only the latest days, so the server reads the first days and the tab the last ones, on the same rules.
 */
import type { DailyKpi, KpiBaseline, TrendId } from './types.js';

export const TREND_IDS: readonly TrendId[] = ['ctr', 'cvr', 'roas', 'refund', 'reply', 'profit'];
const TREND_DAYS = 7;

const READ: Record<TrendId, (k: DailyKpi) => number | null> = {
  ctr: (k) => (k.impressions > 0 ? k.ctr : null),
  cvr: (k) => (k.clicks > 0 || k.sales > 0 ? k.cvr : null),
  roas: (k) => (k.adSpend > 0 ? k.roas : null),
  refund: (k) => (k.sales > 0 ? k.refunds / k.sales : null),
  reply: (k) => (k.avgReplyScore > 0 ? k.avgReplyScore : null),
  profit: (k) => k.profit,
};

/** A day's reading, null on a day with nothing to measure. */
export const trendValue = (id: TrendId, k: DailyKpi): number | null => READ[id](k);

/** Days on each side of the comparison: up to 7, and the two sides never overlap. */
export const trendSpan = (measured: number): number => Math.max(1, Math.min(TREND_DAYS, Math.floor(measured / 2)));

const average = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** The first measured days of each reading, null while two days are not measured yet. */
export function firstValue(values: readonly (number | null)[]): number | null {
  const measured = values.filter((v): v is number => v !== null);
  return measured.length < 2 ? null : average(measured.slice(0, trendSpan(measured.length)));
}

export function lastValue(values: readonly (number | null)[]): number | null {
  const measured = values.filter((v): v is number => v !== null);
  return measured.length < 2 ? null : average(measured.slice(measured.length - trendSpan(measured.length)));
}

/** The start of the run, on every closed day it ever had. */
export function kpiBaselineOf(kpis: readonly DailyKpi[]): KpiBaseline {
  const out: KpiBaseline = {};
  for (const id of TREND_IDS) {
    const first = firstValue(kpis.map((k) => trendValue(id, k)));
    if (first !== null) out[id] = first;
  }
  return out;
}
