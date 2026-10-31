/** Claims run above the shop, reconciliation never invents a euro, each platform answers for its own invoice. */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/index.js';
import type { Rng } from '../src/contracts.js';
import { RECON, reconcile } from '../src/learning/attribution.js';
import { computeDailyKpi } from '../src/learning/kpi.js';
import { channelPnls, reconcileDay, weeklyPnl } from '../src/runtime/accounting.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { CLAIMS } from '../src/sim/channelBalance.js';
import { reachOf } from '../src/sim/channels.js';
import { runClaims } from '../src/sim/claims.js';
import { recordLedger } from '../src/sim/finance.js';
import { tickMarket } from '../src/sim/tick.js';
import { CHANNEL_IDS } from '../src/shared.js';
import type { AdCreative, ChannelId, DailyAdStats, Product, WorldState } from '../src/shared.js';
import { LEGACY } from './legacy.js';

const DAY = 5;
const HUGE = 10_000_000; // more impressions than any niche's touch threshold: touched = 1

function world(seed = 7): WorldState {
  const w = createWorld(defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic' }), 'test-attribution');
  w.day = DAY;
  return w;
}

function addProduct(w: WorldState, id: string, nicheIndex: number, price = 19): Product {
  const p: Product = {
    id, nicheId: w.market.niches[nicheIndex]!.id, title: `Guide ${id}`, subtitle: '', audience: 'Parents', problem: 'Un problème précis', price, status: 'live', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
  w.company.products.push(p);
  return p;
}

let serial = 0;
/** A campaign's day: its row, and its ledger line unless `billed` says otherwise (a platform and the books can disagree). */
function run(w: WorldState, productId: string, channel: ChannelId, spend: number, shop: { purchases?: number; revenue?: number; impressions?: number; billed?: number | null; day?: number } = {}): DailyAdStats {
  const id = `cmp_${++serial}`;
  w.company.campaigns.push({
    id, productId, name: id, creativeIds: [], dailyBudget: spend, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 1, createdBy: 'test',
    ...(channel === 'tiktok' ? {} : { channel }),
  });
  const day = shop.day ?? DAY;
  const row: DailyAdStats = {
    day, campaignId: id, creativeId: `crv_${id}`, productId, spend, impressions: shop.impressions ?? HUGE, clicks: 100, ctr: 0.01, cpc: 0.1, cpm: 1, landingViews: 80,
    purchases: shop.purchases ?? 0, revenue: shop.revenue ?? 0, roas: 0, frequency: 1, comments: [], ...(channel === 'tiktok' ? {} : { channel }),
  };
  w.market.adStats.push(row);
  const billed = shop.billed === undefined ? spend : shop.billed;
  if (billed !== null && billed > 0) {
    const today = w.day;
    w.day = day;
    recordLedger(w, { type: 'ad_spend', amount: -billed, memo: `Ads ${id}`, ref: id });
    w.day = today;
  }
  return row;
}

/** Every draw at its median: claims become the formula of channels §5.1, nothing else. */
function noNoise(): Rng {
  return { ...createRng(1), normal: (mean: number) => mean };
}
const noDraw = (): Rng => ({ ...createRng(1), normal: () => { throw new Error('nothing to draw'); } });

const cents = (eur: number): number => Math.round(eur * 100);
const totalCents = (values: number[]): number => values.reduce((s, v) => s + cents(v), 0);
const touchOf = (w: WorldState, nicheIndex: number): number => CLAIMS.touchShare * reachOf(w.market.niches[nicheIndex]!);

describe('runClaims', () => {
  it('a niche with one channel writes no field and draws nothing, even when another niche runs elsewhere', () => {
    const w = world();
    const a = addProduct(w, 'prd_a', 0);
    const b = addProduct(w, 'prd_b', 1);
    const rows = [run(w, a.id, 'tiktok', 30, { purchases: 2, revenue: 38 }), run(w, a.id, 'tiktok', 10), run(w, b.id, 'meta', 20, { purchases: 1, revenue: 19 })];
    runClaims(w, noDraw());
    for (const r of rows) {
      expect(r).not.toHaveProperty('claimedRevenue');
      expect(r).not.toHaveProperty('claimedPurchases');
    }
  });

  it('two channels: each claims the other\'s sales at its own greed, spread over its rows by spend', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    const big = run(w, p.id, 'tiktok', 30, { purchases: 10, revenue: 190 });
    const small = run(w, p.id, 'tiktok', 10);
    const meta = run(w, p.id, 'meta', 20, { purchases: 3, revenue: 57 });
    runClaims(w, noNoise());
    const tiktokExtra = Math.round(57 * CLAIMS.greed.tiktok * 100) / 100;
    expect(cents(big.claimedRevenue! - 190) + cents(small.claimedRevenue!)).toBe(cents(tiktokExtra));
    expect(big.claimedRevenue! - 190).toBeCloseTo(tiktokExtra * 0.75, 1);
    expect(small.claimedRevenue!).toBeCloseTo(tiktokExtra * 0.25, 1);
    expect(meta.claimedRevenue).toBe(Math.round((57 + 190 * CLAIMS.greed.meta) * 100) / 100);
    expect(meta.claimedPurchases).toBe(3 + Math.round((190 * CLAIMS.greed.meta) / 19));
    expect(small.claimedPurchases).toBe(Math.round(small.claimedRevenue! / 19));
  });

  it('a platform that barely touched the audience claims in proportion', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { purchases: 10, revenue: 190 });
    const meta = run(w, p.id, 'meta', 20, { impressions: Math.floor(touchOf(w, 0) / 4) });
    runClaims(w, noNoise());
    expect(meta.claimedRevenue).toBeCloseTo((190 * CLAIMS.greed.meta) / 4, 1);
    expect(meta.claimedRevenue).toBeLessThan(190 * CLAIMS.greed.meta * 0.3);
  });

  it('claims only: a channel without a shop sale can claim, the shop\'s own columns and a free tail row do not move', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    const tiktok = run(w, p.id, 'tiktok', 30, { purchases: 10, revenue: 190 });
    const pin = run(w, p.id, 'pinterest', 20);
    const tail: DailyAdStats = { ...run(w, p.id, 'pinterest', 0, { purchases: 1, revenue: 19, impressions: 0 }), tail: true };
    w.market.adStats[w.market.adStats.length - 1] = tail;
    const before = JSON.stringify([tiktok.purchases, tiktok.revenue, tiktok.roas, pin.purchases, pin.revenue]);
    runClaims(w, createRng(3));
    expect(pin.revenue).toBe(0);
    expect(pin.claimedRevenue!).toBeGreaterThan(0);
    expect(tail).not.toHaveProperty('claimedRevenue');
    expect(JSON.stringify([tiktok.purchases, tiktok.revenue, tiktok.roas, pin.purchases, pin.revenue])).toBe(before);
    const shop = [tiktok, pin, tail].reduce((s, r) => s + r.revenue, 0);
    const claimed = [tiktok, pin, tail].reduce((s, r) => s + (r.claimedRevenue ?? r.revenue), 0);
    expect(claimed).toBeGreaterThan(shop);
  });

  it('one seed, one claim; the noise is real', () => {
    const claimed = (seed: number) => {
      const w = world();
      const p = addProduct(w, 'prd_a', 0);
      run(w, p.id, 'tiktok', 30, { purchases: 10, revenue: 190 });
      const meta = run(w, p.id, 'meta', 20, { purchases: 3, revenue: 57 });
      runClaims(w, createRng(seed));
      return meta.claimedRevenue!;
    };
    expect(claimed(11)).toBe(claimed(11));
    expect(claimed(11)).not.toBe(claimed(12));
  });
});

describe('reconcile', () => {
  it('Σ reconciled = Σ shop to the cent, on any split', () => {
    const rng = createRng(2026);
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    for (let round = 0; round < 500; round++) {
      w.market.adStats = [];
      const rows = rng.int(2, 12);
      for (let i = 0; i < rows; i++) {
        const revenue = rng.chance(0.2) ? 0 : rng.int(1, 40_000) / 100;
        const row = run(w, p.id, CHANNEL_IDS[rng.int(0, CHANNEL_IDS.length - 1)]!, rng.int(1, 9_000) / 100, { revenue, billed: null });
        if (rng.chance(0.7)) row.claimedRevenue = revenue + rng.int(0, 60_000) / 100;
      }
      const result = reconcile(w.market.adStats);
      expect(totalCents(result.map((a) => a.reconciledRevenue))).toBe(totalCents(w.market.adStats.map((r) => r.revenue)));
      for (const a of result) expect(a.credit).toBeGreaterThanOrEqual(RECON.creditMin);
      for (const a of result) expect(a.credit).toBeLessThanOrEqual(RECON.creditMax);
    }
  });

  it('one channel: credit 1 exactly, whatever it claims', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'meta', 20, { revenue: 57.33 }).claimedRevenue = 400;
    expect(reconcile(w.market.adStats)).toEqual([{ channel: 'meta', spend: 20, shopRevenue: 57.33, claimedRevenue: 400, reconciledRevenue: 57.33, credit: 1, inflation: 6.9771 }]);
  });

  it('half of what a platform claims above the shop moves the split, not the total', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { revenue: 100 }).claimedRevenue = 120;
    run(w, p.id, 'meta', 20, { revenue: 100 }).claimedRevenue = 180;
    // blended 110 and 140 of 250, so 88 and 112 of the shop's 200
    expect(reconcile(w.market.adStats)).toEqual([
      { channel: 'tiktok', spend: 30, shopRevenue: 100, claimedRevenue: 120, reconciledRevenue: 88, credit: 0.8812, inflation: 1.2 },
      { channel: 'meta', spend: 20, shopRevenue: 100, claimedRevenue: 180, reconciledRevenue: 112, credit: 1.1188, inflation: 1.8 },
    ]);
  });

  it('a channel with no shop sale earns a share, the credit stays inside its bounds', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { revenue: 1000 });
    run(w, p.id, 'pinterest', 20).claimedRevenue = 20000;
    const [tiktok, pin] = reconcile(w.market.adStats);
    expect(pin!.reconciledRevenue).toBeGreaterThan(0);
    expect(cents(tiktok!.reconciledRevenue) + cents(pin!.reconciledRevenue)).toBe(100_000);
    expect(tiktok!.credit).toBe(RECON.creditMin);
    expect(pin!.credit).toBe(RECON.creditMax);
    expect(Number.isFinite(pin!.inflation)).toBe(true);
  });

  it('rows absent means channel absent, and nothing sold is credit 1', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    expect(reconcile([])).toEqual([]);
    run(w, p.id, 'google', 5);
    expect(reconcile(w.market.adStats)).toEqual([{ channel: 'google', spend: 5, shopRevenue: 0, claimedRevenue: 0, reconciledRevenue: 0, credit: 1, inflation: 1 }]);
  });
});

describe('computeDailyKpi', () => {
  it('TikTok alone: no key at all, the day reads as it always did', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { purchases: 2, revenue: 38 });
    expect(computeDailyKpi(w, DAY)).not.toHaveProperty('channels');
  });

  it('Σ channel spend = adSpend = ledger to the cent, and the ledger wins over the rows', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    const q = addProduct(w, 'prd_b', 1);
    run(w, p.id, 'tiktok', 33.33, { purchases: 1, revenue: 19, billed: 33.34 });
    run(w, q.id, 'tiktok', 0.07, { billed: 0.07 });
    run(w, p.id, 'meta', 16.67, { purchases: 2, revenue: 38, billed: 16.66 });
    run(w, q.id, 'google', 11.11);
    const kpi = computeDailyKpi(w, DAY);
    const ledger = -w.ledger.filter((e) => e.type === 'ad_spend' && e.day === DAY).reduce((s, e) => s + cents(e.amount), 0);
    expect(cents(kpi.adSpend)).toBe(ledger);
    expect(Object.values(kpi.channels!).reduce((s, c) => s + cents(c.spend), 0)).toBe(ledger);
    expect(kpi.channels!.tiktok!.spend).toBe(33.41);
    expect(kpi.channels!.meta!.spend).toBe(16.66);
    expect(kpi.channels!.google!.spend).toBe(11.11);
  });

  it('a day per channel: three readings, the same shop total, roas on reconciled revenue', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    const tiktok = run(w, p.id, 'tiktok', 50, { purchases: 10, revenue: 190 });
    const meta = run(w, p.id, 'meta', 40, { purchases: 3, revenue: 57 });
    runClaims(w, noNoise());
    const { tiktok: t, meta: m } = computeDailyKpi(w, DAY).channels!;
    expect(t).toMatchObject({ impressions: HUGE, clicks: 100, landingViews: 80, shopSales: 10, shopRevenue: 190, claimedRevenue: tiktok.claimedRevenue, claimedSales: tiktok.claimedPurchases });
    expect(m).toMatchObject({ shopSales: 3, shopRevenue: 57, claimedRevenue: meta.claimedRevenue, claimedSales: meta.claimedPurchases });
    expect(m!.claimedRevenue).toBeGreaterThan(m!.shopRevenue);
    expect(cents(t!.reconciledRevenue) + cents(m!.reconciledRevenue)).toBe(cents(247));
    expect(m!.reconciledRevenue).toBeGreaterThan(57);
    expect(m!.roas).toBeCloseTo(m!.reconciledRevenue / 40, 2);
  });

  it('a day on another channel alone is still written: absent would read as TikTok', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'meta', 40, { purchases: 3, revenue: 57 });
    const { channels } = computeDailyKpi(w, DAY);
    expect(Object.keys(channels!)).toEqual(['meta']);
    expect(channels!.meta).toMatchObject({ spend: 40, shopRevenue: 57, reconciledRevenue: 57, claimedRevenue: 57, roas: 1.43 });
  });
});

describe('reconcileDay', () => {
  it('one invoice per channel with spend, no gap', () => {
    const alone = world();
    run(alone, addProduct(alone, 'prd_a', 0).id, 'tiktok', 30);
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30);
    run(w, p.id, 'tiktok', 12.5);
    run(w, p.id, 'meta', 20);
    run(w, p.id, 'google', 7.25);
    const r = reconcileDay(w, DAY);
    expect(r.gaps).toEqual([]);
    expect(r.checks).toBe(reconcileDay(alone, DAY).checks + 2);
    expect(r.adSpend).toBe(69.75);
  });

  it('a gap names its platform, even when the day\'s total still ties', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { billed: 25 });
    run(w, p.id, 'meta', 20, { billed: 25 });
    run(w, p.id, 'pinterest', 9);
    const { gaps } = reconcileDay(w, DAY);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatch(/^facture TikTok : /);
    expect(gaps[1]).toMatch(/^facture Facebook & Instagram : /);
  });

  it('an invoice the books never saw, and a line no platform sent, are both caught', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30);
    run(w, p.id, 'youtube', 20, { billed: null });
    const unsent = run(w, p.id, 'pinterest', 9);
    w.market.adStats.splice(w.market.adStats.indexOf(unsent), 1);
    const { gaps } = reconcileDay(w, DAY);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatch(/^facture YouTube Shorts : /);
    expect(gaps[1]).toMatch(/^facture Pinterest : /);
  });

  it('TikTok alone keeps its single line, with or without spend', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    expect(reconcileDay(w, DAY).checks).toBe(3);
    run(w, p.id, 'tiktok', 30, { billed: 20 });
    const r = reconcileDay(w, DAY);
    expect(r.checks).toBe(3);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatch(/^facture TikTok : /);
  });
});

describe('a real close, tickMarket on three channels', () => {
  const APPROVED = { status: 'approved', reason: null, day: 1 } as const;
  const DAYS = 14;

  function creative(w: WorldState, productId: string, id: string, over: Partial<AdCreative>): AdCreative {
    const c: AdCreative = {
      id, productId, hook: 'Bébé se réveille toutes les 2 h ?', hookStyle: 'question', format: 'faceless_voiceover',
      scenes: [{ visual: 'Gros plan', onScreenText: 'Bébé se réveille', voiceover: 'Bébé se réveille toutes les 2 h.', durationSec: 5 }],
      caption: 'Le guide est en bio.', hashtags: [], cta: 'Lien en bio', files: { storyboard: [], preview: null }, quality: null, review: APPROVED, createdDay: 1, createdBy: 'test', ...over,
    };
    w.company.creatives.push(c);
    return c;
  }

  function campaign(w: WorldState, productId: string, ch: ChannelId, creativeId: string, dailyBudget: number): void {
    w.company.campaigns.push({
      id: `cmp_${ch}`, productId, name: ch, creativeIds: [creativeId], dailyBudget, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 1, createdBy: 'test',
      ...(ch === 'tiktok' ? {} : { channel: ch }),
    });
  }

  function market(seed: number, channels: readonly ChannelId[] = ['tiktok', 'meta', 'google']): { w: WorldState; rng: Rng } {
    const w = createWorld(defaultScenario({ ...LEGACY, channelControl: 'none', seed, startingCash: 100_000, mindMode: 'heuristic' }), 'test-attribution');
    const n = w.market.niches[0]!;
    const p = addProduct(w, 'prd_a', 0, n.wtp.sweet);
    if (channels.includes('tiktok')) campaign(w, p.id, 'tiktok', creative(w, p.id, 'crv_tiktok', {}).id, 120);
    if (channels.includes('meta')) campaign(w, p.id, 'meta', creative(w, p.id, 'crv_meta', { ratio: '4:5', channelReviews: { meta: APPROVED } }).id, 120);
    if (channels.includes('google')) {
      const search = { headlines: ['Bébé se réveille', 'Guide du sommeil'], descriptions: ['Une méthode en 6 étapes.', 'À lire ce soir.'], keywords: n.keywords.slice(0, 4) };
      campaign(w, p.id, 'google', creative(w, p.id, 'crv_google', { format: 'search_text', ratio: 'text', search, channelReviews: { google: APPROVED } }).id, 40);
    }
    return { w, rng: createRng(seed) };
  }

  function close(w: WorldState, rng: Rng, from: number, to: number): void {
    for (let day = from; day <= to; day++) {
      w.day = day;
      tickMarket(w, rng);
    }
  }

  it('each day: one invoice per channel and no gap, spend = ledger, reconciled = the shop\'s own orders', () => {
    const { w, rng } = market(7);
    close(w, rng, 1, DAYS);
    let shop = 0;
    let claimed = 0;
    for (let day = 1; day <= DAYS; day++) {
      const billing = new Set(w.market.adStats.filter((r) => r.day === day && r.spend > 0).map((r) => r.channel ?? 'tiktok'));
      expect(billing.size).toBe(3);
      const lines = reconcileDay(w, day);
      expect(lines.gaps).toEqual([]);
      const kpi = computeDailyKpi(w, day);
      const rows = Object.values(kpi.channels!);
      const orders = w.market.orders.filter((o) => o.day === day && o.source === 'ads');
      const ledger = -w.ledger.filter((e) => e.day === day && e.type === 'ad_spend').reduce((s, e) => s + cents(e.amount), 0);
      expect(rows.reduce((s, c) => s + cents(c.spend), 0)).toBe(ledger);
      expect(cents(kpi.adSpend)).toBe(ledger);
      expect(cents(lines.adSpend)).toBe(ledger);
      expect(rows.reduce((s, c) => s + c.shopSales, 0)).toBe(orders.length);
      expect(totalCents(rows.map((c) => c.shopRevenue))).toBe(totalCents(orders.map((o) => o.price)));
      expect(totalCents(rows.map((c) => c.reconciledRevenue))).toBe(totalCents(orders.map((o) => o.price)));
      shop += totalCents(rows.map((c) => c.shopRevenue));
      claimed += totalCents(rows.map((c) => c.claimedRevenue));
    }
    expect(shop).toBeGreaterThan(0);
    expect(claimed).toBeGreaterThan(shop);
  });

  it('one channel in the niche: its dashboard is the shop, to the cent, and the KPI stays as it was', () => {
    const { w, rng } = market(7, ['tiktok']);
    close(w, rng, 1, DAYS);
    expect(w.market.orders.some((o) => o.source === 'ads')).toBe(true);
    for (const r of w.market.adStats) expect(r).not.toHaveProperty('claimedRevenue');
    for (let day = 1; day <= DAYS; day++) expect(computeDailyKpi(w, day)).not.toHaveProperty('channels');
    expect(reconcile(w.market.adStats).map((a) => [a.channel, a.credit, a.inflation])).toEqual([['tiktok', 1, 1]]);
  });

  it('a reload in the middle ends exactly like a straight run', () => {
    const straight = market(11);
    close(straight.w, straight.rng, 1, DAYS);
    const first = market(11);
    close(first.w, first.rng, 1, 6);
    const reloaded = JSON.parse(JSON.stringify(first.w)) as WorldState;
    close(reloaded, createRng(first.rng.state()), 7, DAYS);
    expect(JSON.stringify(reloaded.market.adStats)).toBe(JSON.stringify(straight.w.market.adStats));
    expect(JSON.stringify(reloaded.ledger)).toBe(JSON.stringify(straight.w.ledger));
    expect(straight.w.market.adStats.some((r) => r.claimedRevenue !== undefined)).toBe(true);
  });
});

describe('channelPnls', () => {
  it('a week per channel: ledger spend, reconciled revenue, Σ = the shop', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { revenue: 100, day: 2 }).claimedRevenue = 120;
    run(w, p.id, 'meta', 20, { revenue: 100, day: 3, billed: 25 }).claimedRevenue = 180;
    run(w, p.id, 'pinterest', 0, { revenue: 0, day: 3 });
    run(w, p.id, 'tiktok', 999, { revenue: 999, day: 9 });
    expect(channelPnls(w, 1, 7)).toEqual([
      { channel: 'tiktok', spend: 30, reconciledRevenue: 88, roas: 2.93 },
      { channel: 'meta', spend: 25, reconciledRevenue: 112, roas: 4.48 },
      { channel: 'pinterest', spend: 0, reconciledRevenue: 0, roas: null },
    ]);
  });

  it('the weekly P&L carries them only once a second channel exists', () => {
    const w = world();
    const p = addProduct(w, 'prd_a', 0);
    run(w, p.id, 'tiktok', 30, { revenue: 100, day: 2 });
    expect(weeklyPnl(w, 1, 7)).not.toHaveProperty('channels');
    run(w, p.id, 'meta', 20, { revenue: 50, day: 3 });
    expect(weeklyPnl(w, 1, 7).channels!.map((c) => c.channel)).toEqual(['tiktok', 'meta']);
  });
});
