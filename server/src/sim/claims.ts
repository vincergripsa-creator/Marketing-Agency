/**
 * What each platform claims to have sold (channels §5.1). A platform counts a sale as its own when its ad touched the
 * buyer, whichever channel got the click, so over-claiming needs a second channel in the niche: no constant, and alone a
 * platform's dashboard equals the shop, with no field written. `purchases`, `revenue`, `roas` stay the shop's.
 */
import { round2 } from '../core/index.js';
import type { Rng } from '../contracts.js';
import { CHANNEL_IDS, channelOf } from '../shared.js';
import type { ChannelId, DailyAdStats, NicheTruth, WorldState } from '../shared.js';
import { CLAIMS } from './channelBalance.js';
import { reachOf } from './channels.js';
import { nicheOf, productById } from './ops.js';
import { lognormal } from './text.js';

/** A channel's day in one niche. */
interface Line { rows: DailyAdStats[]; spend: number; revenue: number; impressions: number }

/** Spreads a platform's extra claim over its paid rows, by spend, to the cent. A free tail row has no invoice to claim on. */
function spreadBySpend(world: WorldState, line: Line, extra: number): void {
  const paid = line.rows.filter((r) => r.spend > 0);
  let left = extra;
  paid.forEach((r, i) => {
    const share = i === paid.length - 1 ? left : Math.min(left, round2((extra * r.spend) / line.spend));
    left = round2(left - share);
    const price = productById(world, r.productId)?.price ?? 0;
    r.claimedRevenue = round2(r.revenue + share);
    r.claimedPurchases = r.purchases + (price > 0 ? Math.round(share / price) : 0);
  });
}

export function runClaims(world: WorldState, rng: Rng): void {
  const niches = new Map<NicheTruth, Map<ChannelId, Line>>();
  for (const r of world.market.adStats) {
    if (r.day !== world.day) continue;
    const n = nicheOf(world, productById(world, r.productId));
    const lines = niches.get(n) ?? new Map<ChannelId, Line>();
    const line = lines.get(channelOf(r)) ?? { rows: [], spend: 0, revenue: 0, impressions: 0 };
    line.rows.push(r);
    line.spend += r.spend;
    line.revenue += r.revenue;
    line.impressions += r.impressions;
    lines.set(channelOf(r), line);
    niches.set(n, lines);
  }
  for (const [n, lines] of niches) {
    const spending = CHANNEL_IDS.filter((ch) => (lines.get(ch)?.spend ?? 0) > 0);
    if (spending.length < 2) continue;
    const sold = [...lines.values()].reduce((s, l) => s + l.revenue, 0);
    for (const ch of spending) {
      const line = lines.get(ch)!;
      const touched = Math.min(1, line.impressions / (CLAIMS.touchShare * reachOf(n)));
      spreadBySpend(world, line, round2((sold - line.revenue) * CLAIMS.greed[ch] * touched * lognormal(rng, 1, CLAIMS.noiseSd)));
    }
  }
}
