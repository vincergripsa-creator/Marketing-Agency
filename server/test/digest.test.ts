/**
 * The founder's digest (scale §3, test 6). Its money is the ledger's over any window, compaction or not; what went wrong is in it,
 * in French, a loss as a loss; the weekly note is written from the same object, and never in the control arm.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionRecord } from '../src/api/persist.js';
import type { AgentState, Alumnus, Campaign, DailyAdStats, LedgerType, Order, Product, ScenarioConfig, WeekRollup, WorldState } from '../src/shared.js';
import type { BrainVault, RunPaths } from '../src/contracts.js';
import { HOLD_REF, summarizeLedger } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { compactWorld, COMPACT } from '../src/runtime/compaction.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { buildDigest, logDecision, weeklyNote, weekRollup } from '../src/runtime/digest.js';
import { growthPillar } from '../src/runtime/growthPillar.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { killProduct } from '../src/runtime/pipeline.js';
import { advanceStage } from '../src/runtime/stages.js';
import { createTask } from '../src/runtime/tasks.js';
import { clip, eur, round2 } from '../src/runtime/util.js';
import { recordLedger } from '../src/sim/index.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

function pathsOf(): RunPaths {
  const root = mkdtempSync(join(tmpdir(), 'pixel-digest-'));
  roots.push(root);
  return { root, brain: join(root, 'brain'), files: join(root, 'files') };
}

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function world(over: Partial<ScenarioConfig> = {}): WorldState {
  const w = createWorld(defaultScenario({ ...LEGACY, seed: 5, mindMode: 'heuristic', maxComputeEur: 0, startingCash: 500, ...over }), 'test-digest');
  growthPillar.mount!(w);
  return w;
}

const growth = (w: WorldState) => w.company.growth!;

function book(w: WorldState, day: number, type: LedgerType, amount: number, ref: string | null = null): void {
  w.day = day;
  recordLedger(w, { type, amount, memo: 'test', ref });
}

/** What a reader who adds up the rows himself finds: no capital, no hold. */
const profitOf = (w: WorldState, from: number, to: number): number =>
  round2(w.ledger.filter((e) => e.day >= from && e.day <= to && e.type !== 'capital' && !e.ref?.startsWith(HOLD_REF)).reduce((s, e) => s + e.amount, 0));

const cashOn = (w: WorldState, day: number): number => round2(w.ledger.filter((e) => e.day <= day).reduce((s, e) => s + e.amount, 0));

const rollWeek = (w: WorldState, toDay: number): WeekRollup => {
  const week = weekRollup(w, toDay - 6, toDay);
  growth(w).weeks.push(week);
  return week;
};

function addProduct(w: WorldState, id: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    id, nicheId: w.market.niches[0]!.id, title: `Guide ${id}`, subtitle: '', audience: 'Parents', problem: `Le problème ${id}`, price: 19, status: 'live', version: 1, content: null,
    design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [], ...over,
  };
  w.company.products.push(p);
  return p;
}

const order = (id: string, day: number, productId: string, source: Order['source'], price = 19): Order => ({ id, day, customerId: `c_${id}`, productId, price, source, campaignId: null, creatorId: null, refunded: false, chargeback: false });

const campaign = (id: string, productId: string, over: Partial<Campaign> = {}): Campaign => ({
  id, productId, name: `Campagne ${id}`, creativeIds: [], dailyBudget: 10, status: 'paused', targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay: 1, createdBy: 'zoe', ...over,
});

const adRow = (day: number, campaignId: string, productId: string, spend: number, revenue: number, over: Partial<DailyAdStats> = {}): DailyAdStats => ({
  day, campaignId, creativeId: 'c', productId, spend, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 0, cpm: 0, landingViews: 0, purchases: 0, revenue, roas: 0, frequency: 1, comments: [], ...over,
});

describe('a week of the books', () => {
  it('puts each line in its column, keeps capital and holds out of profit, and ties to the ledger', () => {
    const w = world();
    addProduct(w, 'prd_a');
    book(w, 3, 'revenue', 100, 'prd_a');
    book(w, 3, 'refund', 10);
    book(w, 3, 'chargeback', 5);
    book(w, 3, 'ad_spend', 30, 'cmp_a');
    book(w, 4, 'payment_fee', 3);
    book(w, 4, 'platform_fee', 2);
    book(w, 4, 'creator_payout', 7);
    book(w, 4, 'salary', 4);
    book(w, 4, 'recruiting', 6);
    book(w, 5, 'tool_subscription', 1);
    book(w, 5, 'compute', 1);
    book(w, 5, 'discount', 2);
    book(w, 5, 'platform_fee', -50, `${HOLD_REF}evt_1`); // a hold keeps the sign it is given
    book(w, 8, 'revenue', 999, 'prd_a'); // next week
    const week = weekRollup(w, 1, 7);
    expect(week).toMatchObject({ week: 1, fromDay: 1, toDay: 7, revenue: 100, refunds: 15, adSpend: 30, fees: 5, creators: 7, payroll: 10, other: 4, profit: 29 });
    expect(week.revenue - week.refunds - week.adSpend - week.fees - week.creators - week.payroll - week.other).toBeCloseTo(week.profit, 6);
    expect(week.profit).toBe(summarizeLedger(w.ledger.filter((e) => e.day <= 7), 7).profit);
    expect(week.cashEnd).toBe(479); // 500 of capital, 29 of profit, 50 held
    expect(week.roas).toBe(3.33);
  });

  it('reads the company as it stands: sales by source, ads, mains, list, stage, team', () => {
    const w = world();
    const main = addProduct(w, 'prd_a', { upsellProductId: 'prd_up' });
    addProduct(w, 'prd_up');
    addProduct(w, 'prd_kit', { kind: 'kit' });
    addProduct(w, 'prd_b', { nicheId: w.market.niches[1]!.id });
    addProduct(w, 'prd_off', { status: 'killed' });
    w.market.orders.push(order('o1', 2, main.id, 'ads'), order('o2', 3, main.id, 'ads', 21), order('o3', 3, main.id, 'email'), order('o4', 9, main.id, 'ads'));
    w.market.adStats.push(adRow(2, 'c1', main.id, 10, 19), adRow(3, 'c1', main.id, 10, 19, { impressions: 3000, clicks: 20 }));
    w.market.audience = { buckets: [{ nicheId: 'n', kind: 'lead', month: 1, size: 40, fatigue: 0 }, { nicheId: 'n', kind: 'buyer', month: 1, size: 2, fatigue: 0 }], welcome: { n: [3, 0, 5] }, sequences: [], queue: [], sent: [], totals: { leads: 0, buyers: 0, unsubscribed: 0, delivered: 0, opens: 0, clicks: 0, sales: 0, revenue: 0 } };
    Object.assign(growth(w), { stage: 'acceleration', ltvFactor: 1.3 });
    const t = createTask(w, { kind: 'plan_day' });
    Object.assign(t, { status: 'done', dayDone: 6 });
    Object.assign(createTask(w, { kind: 'plan_day' }), { status: 'done', dayDone: 8 });
    expect(weekRollup(w, 1, 7)).toMatchObject({
      sales: 3, bySource: { ads: { n: 2, revenue: 40 }, email: { n: 1, revenue: 19 } }, ctr: 0.01,
      mains: 2, niches: 2, listSize: 50, ltvFactor: 1.3, stage: 'acceleration', agents: w.company.agents.length, tasksDone: 1,
    });
  });

  it('a week with no ads has no ROAS and no CTR, not a zero', () => {
    expect(weekRollup(world(), 1, 7)).toMatchObject({ roas: null, ctr: null, sales: 0, bySource: {} });
  });
});

describe('the decision log', () => {
  it('keeps the last 500, each with its own id, its day and its words', () => {
    const w = world();
    w.day = 12;
    const first = logDecision(w, { kind: 'budget', who: 'system', text: 'Premier', why: 'parce que', impactEur: -4 });
    expect(first).toMatchObject({ day: 12, kind: 'budget', who: 'system', text: 'Premier', why: 'parce que', impactEur: -4 });
    expect(growth(w).decisions).toEqual([first]);
    const second = logDecision(w, { kind: 'budget', who: 'system', text: 'Second', why: 'x' });
    expect(second.id).not.toBe(first.id);
    for (let i = 0; i < 600; i++) logDecision(w, { kind: 'budget', who: 'system', text: `n${i}`, why: 'x' });
    expect(growth(w).decisions).toHaveLength(500);
    expect(growth(w).decisions.at(-1)!.text).toBe('n599');
    expect(growth(w).decisions[0]!.text).toBe('n100');
  });
});

describe('the money of a digest', () => {
  /** 60 days of a real book, a hold included, each Sunday rolled the way the growth pillar does it. */
  function run(days = 60, compact = false): WorldState {
    const w = world();
    addProduct(w, 'prd_a');
    book(w, 1, 'tool_subscription', 60, 'setup');
    for (let d = 1; d <= days; d++) {
      book(w, d, 'revenue', 20 + (d * 7) % 13, 'prd_a');
      book(w, d, 'ad_spend', 8 + (d * 3) % 11);
      book(w, d, 'payment_fee', 1.37);
      if (d % 5 === 0) book(w, d, 'refund', 19);
      if (d % 11 === 0) book(w, d, 'platform_fee', -30, `${HOLD_REF}evt_${d}`);
      if (d % 7 === 0) {
        rollWeek(w, d);
        if (compact) compactWorld(w);
      }
    }
    return w;
  }

  it('is the ledger\'s on any window, whole weeks or not', () => {
    const w = run();
    for (const [from, to] of [[1, 60], [1, 7], [8, 14], [3, 17], [10, 10], [50, 60], [15, 49]] as const) {
      const { money, fromDay, toDay } = buildDigest(w, from, to);
      expect([fromDay, toDay]).toEqual([from, to]);
      expect(money.profit).toBe(profitOf(w, from, to));
      expect(round2(money.revenue - money.refunds - money.adSpend - money.costs)).toBe(money.profit);
      expect(money.cashEnd).toBe(cashOn(w, to));
      expect(money.cashStart).toBe(from === 1 ? 500 : cashOn(w, from - 1));
    }
    expect(buildDigest(w, 1, 60).money.profit).toBe(summarizeLedger(w.ledger, 60).profit);
  });

  it('two windows side by side add up to the whole', () => {
    const w = run();
    expect(round2(buildDigest(w, 1, 23).money.profit + buildDigest(w, 24, 60).money.profit)).toBe(buildDigest(w, 1, 60).money.profit);
  });

  it('compares with the period of the same length before it, when there is one', () => {
    const w = run();
    expect(buildDigest(w, 8, 14).money.previousProfit).toBe(profitOf(w, 1, 7));
    expect(buildDigest(w, 20, 30).money.previousProfit).toBe(profitOf(w, 9, 19));
    expect(buildDigest(w, 5, 14).money.previousProfit).toBeNull();
  });

  it('a Sunday that was skipped leaves no rollup, and its week still counts, from the raw rows', () => {
    const w = run();
    const whole = buildDigest(w, 1, 60).money;
    growth(w).weeks = growth(w).weeks.filter((r) => r.week !== 3);
    expect(buildDigest(w, 1, 60).money).toEqual(whole);
  });

  it('a week rolled twice, by a tick played again, counts once', () => {
    const w = run();
    const whole = buildDigest(w, 1, 60).money;
    growth(w).weeks.push(weekRollup(w, 8, 14));
    expect(buildDigest(w, 1, 60).money).toEqual(whole);
  });

  it('clamps a window to what happened: no day past today, none before the first', () => {
    const w = run();
    expect(buildDigest(w, -5, 900)).toMatchObject({ fromDay: 1, toDay: 60 });
    expect(buildDigest(w, 90, 95)).toMatchObject({ fromDay: 60, toDay: 60 });
  });

  it('a Sunday that never played rolls the next evening: a year of compaction later, its money is still there', async () => {
    const w = world();
    addProduct(w, 'prd_a');
    const ctx = { world: w } as unknown as RuntimeCtx;
    const skipped = 77;
    let total = 0, week11 = 0;
    for (let d = 1; d <= 400; d++) {
      const revenue = 20 + (d * 7) % 13, ads = 8 + (d * 3) % 11;
      book(w, d, 'revenue', revenue, 'prd_a');
      book(w, d, 'ad_spend', ads);
      total = round2(total + revenue - ads);
      if (d >= 71 && d <= 77) week11 = round2(week11 + revenue - ads);
      if (d !== skipped) await growthPillar.eveningEnd!(ctx);
    }
    expect(w.company.archive!.throughDay).toBeGreaterThan(skipped + COMPACT.ledgerDays);
    expect(growth(w).weeks.map((r) => r.week)).toEqual(Array.from({ length: 57 }, (_, i) => i + 1));
    expect(buildDigest(w, 1, 400).money.profit).toBe(total);
    const d = buildDigest(w, 71, 77);
    expect([d.fromDay, d.toDay, d.money.profit]).toEqual([71, 77, week11]);
  });

  describe('after a year of compaction', () => {
    const days = 400;
    const full = run(days);
    const compacted = run(days, true);

    it('has really let go of its raw rows', () => {
      expect(compacted.ledger.length).toBeLessThan(full.ledger.length / 2);
      expect(compacted.company.archive!.throughDay).toBe(399);
    });

    it('reads the same whole year, and the same last weeks', () => {
      expect(buildDigest(compacted, 1, days).money).toEqual(buildDigest(full, 1, days).money);
      expect(buildDigest(compacted, 1, days).money.profit).toBe(profitOf(full, 1, days));
      expect(buildDigest(compacted, 330, days).money).toEqual(buildDigest(full, 330, days).money);
    });

    it('widens a window that starts or ends inside a compacted week, rather than guess a part of it', () => {
      expect(COMPACT.ledgerDays).toBeLessThan(399 - 100);
      const d = buildDigest(compacted, 12, 100);
      expect([d.fromDay, d.toDay]).toEqual([8, 105]);
      expect(d.money.profit).toBe(profitOf(full, 8, 105));
      expect(d.money.cashStart).toBe(cashOn(full, 7));
      expect(d.money.cashEnd).toBe(cashOn(full, 105));
    });

    it('a window across the edge of the raw ledger stays exact', () => {
      const from = 399 - COMPACT.ledgerDays - 20;
      const d = buildDigest(compacted, from, days);
      expect(d.money.profit).toBe(profitOf(full, d.fromDay, days));
      expect(d.fromDay).toBeLessThanOrEqual(from);
    });
  });
});

describe('the headline', () => {
  const after = (amount: number): string => {
    const w = world();
    if (amount) book(w, 2, amount > 0 ? 'revenue' : 'tool_subscription', Math.abs(amount), null);
    return buildDigest(w, 1, 7).headline;
  };

  it('states a loss as a loss', () => expect(after(-312.5)).toContain(`Perte de ${eur(312.5)}`));
  it('states a profit as a profit', () => expect(after(80)).toContain(`Profit de ${eur(80)}`));
  it('says when nothing moved', () => expect(after(0)).toContain('Ni profit ni perte'));

  it('says what the money became, against the period before', () => {
    const w = world();
    book(w, 2, 'tool_subscription', 40);
    book(w, 9, 'revenue', 100);
    book(w, 9, 'ad_spend', 30);
    w.day = 14;
    expect(buildDigest(w, 8, 14).headline).toBe(`Profit de ${eur(70)} en 7 jours, contre ${eur(-40)} la période d'avant : ${eur(100)} de ventes, ${eur(0)} remboursés, ${eur(30)} de pub, ${eur(0)} de frais.`);
  });
});

describe('what a digest tells', () => {
  it('stages: the moves of the real gate, with their day, and the two ends', () => {
    const w = world({ scaling: true });
    growth(w).stage = 'adequation';
    rollWeek(w, 7);
    book(w, 10, 'tool_subscription', 480);
    advanceStage({ world: w } as unknown as RuntimeCtx); // cash under 30 % of the start: back to Survie, on a Wednesday
    expect(growth(w).stage).toBe('survie');
    expect(buildDigest(w, 8, 10).stage).toEqual({ from: 'adequation', to: 'survie', changes: [{ day: 10, to: 'survie' }] });
    expect(buildDigest(w, 1, 7).stage).toEqual({ from: 'survie', to: 'adequation', changes: [] });
  });

  it('products: launched, stopped with why, reworked, best and worst', () => {
    const w = world();
    const good = addProduct(w, 'prd_good', { launchedDay: 3 });
    const bad = addProduct(w, 'prd_bad', { launchedDay: 20, status: 'killed', decision: { day: 9, status: 'killed', reason: 'perd 12 € sur 14 jours' } });
    addProduct(w, 'prd_back', { launchedDay: 1, status: 'live', decision: { day: 8, status: 'paused', reason: 'pause levée depuis' } });
    const reworked = addProduct(w, 'prd_v2', { launchedDay: 1, version: 2, versionDay: 9 });
    const harvested = addProduct(w, 'prd_hv', { launchedDay: 1 });
    addProduct(w, 'prd_quiet', { launchedDay: 1 });
    w.market.orders.push(order('o1', 9, good.id, 'ads'));
    w.company.campaigns.push(campaign('cmp_bad', bad.id));
    book(w, 9, 'revenue', 19, good.id);
    book(w, 9, 'ad_spend', 12, 'cmp_bad');
    w.day = 10;
    logDecision(w, { kind: 'harvest', who: 'system', text: 'x', why: 'perd sur la pub, acheteurs contents', productId: harvested.id });
    const d = buildDigest(w, 8, 14).products;
    expect(d.launched).toEqual([]);
    expect(d.stopped).toEqual([{ title: bad.title, why: 'perd 12 € sur 14 jours' }, { title: harvested.title, why: 'perd sur la pub, acheteurs contents', harvest: true }]);
    expect(d.reworked).toEqual([reworked.title]);
    expect(d.best).toEqual({ title: good.title, profit: 19 });
    expect(d.worst).toEqual({ title: bad.title, profit: -12 });
    expect(buildDigest(w, 1, 7).products.launched).toContain(good.title);
    expect(buildDigest(w, 8, 14).products.stopped.map((s) => s.title)).not.toContain('Guide prd_back');
  });

  it('a very long reason is cut, not the digest', () => {
    const w = world();
    addProduct(w, 'prd_x', { status: 'killed', decision: { day: 2, status: 'killed', reason: 'mot '.repeat(200) } });
    w.day = 7;
    expect(buildDigest(w, 1, 7).products.stopped[0]!.why.length).toBeLessThanOrEqual(160);
  });

  it('people: hires and departures with their role, founders on day one are no hire', () => {
    const w = world();
    const head = w.company.agents.length;
    const hire = { ...w.company.agents[0]!, id: 'lea', name: 'Léa', roleId: 'media_buyer_meta', founder: false, hiredDay: 10 } as AgentState;
    w.company.agents.push(hire);
    w.company.org!.alumni.push({ id: 'tom', name: 'Tom', roleId: 'media_buyer_google', founder: false, hiredDay: 5, leftDay: 12, reason: 'noté sous le seuil' } as unknown as Alumnus);
    w.day = 20;
    const d = buildDigest(w, 8, 14).people;
    expect(d.hired).toEqual(['Léa (Media buyer Facebook & Instagram)']);
    expect(d.left).toEqual(['Tom (Media buyer Google) : noté sous le seuil']);
    expect(d).toMatchObject({ headFrom: head + 1, headTo: head + 1 });
    expect(buildDigest(w, 1, 7).people).toMatchObject({ hired: [expect.stringContaining('Tom')], left: [], headFrom: head, headTo: head + 1 });
  });

  it('channels: opened, closed, banned, and the best by reconciled ROAS', () => {
    const w = world();
    addProduct(w, 'prd_a');
    w.company.campaigns.push(campaign('cmp_t', 'prd_a'), campaign('cmp_m', 'prd_a', { channel: 'meta' }));
    w.market.adStats.push(adRow(3, 'cmp_t', 'prd_a', 10, 10), adRow(3, 'cmp_m', 'prd_a', 10, 30, { channel: 'meta' }));
    book(w, 3, 'ad_spend', 10, 'cmp_t');
    book(w, 3, 'ad_spend', 10, 'cmp_m');
    logDecision(w, { kind: 'channel', who: 'system', text: 'Google Search ouvert', why: 'x' });
    logDecision(w, { kind: 'channel', who: 'system', text: 'Pinterest mis en pause', why: 'x' });
    w.market.events.push({ id: 'evt_b', day: 3, kind: 'channel_account_banned', title: 'Compte Facebook & Instagram suspendu', description: '', severity: 'danger' });
    w.day = 7;
    const d = buildDigest(w, 1, 7).channels;
    expect(d.opened).toEqual(['Google Search']);
    expect(d.closed).toEqual(['Pinterest', 'Compte Facebook & Instagram suspendu']);
    expect(d.best).toMatchObject({ id: 'meta', name: 'Facebook & Instagram', reconciledRoas: 3 });
  });

  it('the list: what it weighs, what came and left, what it sold', () => {
    const w = world();
    addProduct(w, 'prd_a');
    const totals = { leads: 0, buyers: 0, unsubscribed: 0, delivered: 0, opens: 0, clicks: 0, sales: 0, revenue: 0 };
    w.market.audience = { buckets: [{ nicheId: 'n', kind: 'lead', month: 1, size: 100, fatigue: 0 }], welcome: {}, sequences: [], queue: [], sent: [], totals };
    w.market.orders.push(order('o1', 3, 'prd_a', 'email', 10));
    w.day = 7;
    rollWeek(w, 7);
    w.market.audience.buckets[0]!.size = 130;
    const sent = { id: 'b', nicheId: 'n', productId: 'prd_a', audience: 'niche', subject: '', body: '', angle: '', score: 70, hasUnsubscribe: true, status: 'sent', delivered: 100, opens: 30, clicks: 5, sales: 1, revenue: 19 } as const;
    w.market.audience.sent.push({ ...sent, day: 9, unsubscribed: 5 }, { ...sent, day: 2, unsubscribed: 50 });
    w.market.orders.push(order('o2', 9, 'prd_a', 'email', 19));
    w.day = 10;
    expect(buildDigest(w, 8, 10).audience).toEqual({ size: 130, added: 35, unsubscribed: 5, revenue: 19 });
    expect(buildDigest(w, 1, 7).audience).toMatchObject({ size: 100, revenue: 10 });
  });

  it('the decisions that matter: largest impact first, then newest, 12 at most, incidents apart', () => {
    const w = world();
    for (let d = 1; d <= 20; d++) {
      w.day = d;
      logDecision(w, { kind: 'budget', who: 'system', text: `Jour ${d}`, why: 'x' });
    }
    w.day = 3;
    logDecision(w, { kind: 'launch', who: 'system', text: 'Le gros pari', why: 'x', impactEur: -90 });
    logDecision(w, { kind: 'double_down', who: 'system', text: 'Le moyen', why: 'x', impactEur: 40 });
    logDecision(w, { kind: 'incident', who: 'system', text: 'Panne', why: 'x', impactEur: -500 });
    w.day = 20;
    const texts = buildDigest(w, 1, 20).decisions.map((d) => d.text);
    expect(texts).toHaveLength(12);
    expect(texts.slice(0, 4)).toEqual(['Le gros pari', 'Le moyen', 'Jour 20', 'Jour 19']);
    expect(texts).not.toContain('Panne');
  });
});

describe('what went wrong', () => {
  it('names the weeks in the red, the worst one with its number', () => {
    const w = world();
    book(w, 2, 'tool_subscription', 30);
    rollWeek(w, 7);
    book(w, 9, 'revenue', 100);
    rollWeek(w, 14);
    book(w, 16, 'tool_subscription', 55);
    w.day = 21;
    rollWeek(w, 21);
    expect(buildDigest(w, 1, 21).mistakes).toContain(`2 semaine(s) en perte sur 3, la pire à ${eur(-55)} (semaine 3)`);
  });

  it('names a stopped test that lost money, and not one that earned', () => {
    const w = world();
    const lost = addProduct(w, 'prd_lost', { status: 'killed', decision: { day: 5, status: 'killed', reason: 'x' } });
    const paid = addProduct(w, 'prd_paid', { status: 'killed', decision: { day: 5, status: 'killed', reason: 'x' } });
    w.company.campaigns.push(campaign('cmp_lost', lost.id));
    book(w, 3, 'ad_spend', 37.2, 'cmp_lost');
    book(w, 3, 'revenue', 50, paid.id);
    w.day = 7;
    const { mistakes } = buildDigest(w, 1, 7);
    expect(mistakes).toContain(`« ${lost.title} » arrêté sans gagnant : perte de ${eur(37.2)}`);
    expect(mistakes.join(' ')).not.toContain(paid.title);
  });

  it('counts the chargebacks of the window', () => {
    const w = world();
    book(w, 3, 'chargeback', 19);
    book(w, 4, 'chargeback', 21.5);
    book(w, 12, 'chargeback', 99);
    w.day = 14;
    expect(buildDigest(w, 1, 7).mistakes).toContain(`2 rétrofacturation(s) : perte de ${eur(40.5)}`);
  });

  it('a stop-loss that came late is named with its numbers, one in time is not, nor a winner, nor a campaign still running', () => {
    const w = world();
    addProduct(w, 'prd_a');
    w.company.campaigns.push(campaign('late', 'prd_a'), campaign('sharp', 'prd_a'), campaign('winner', 'prd_a'), campaign('running', 'prd_a', { status: 'active' }), campaign('outage', 'prd_a', { pausedFor: 'outage' }));
    w.market.adStats.push(adRow(2, 'late', 'prd_a', 40, 10), adRow(3, 'late', 'prd_a', 30, 10), adRow(2, 'sharp', 'prd_a', 26, 5), adRow(3, 'winner', 'prd_a', 80, 200), adRow(3, 'running', 'prd_a', 80, 5), adRow(3, 'outage', 'prd_a', 80, 5));
    w.day = 7;
    const lines = buildDigest(w, 1, 7).mistakes.filter((m) => m.startsWith('Stop-loss tardif'));
    expect(lines).toEqual([`Stop-loss tardif sur « Campagne late » : ${eur(70)} dépensés pour un seuil à ${eur(25)}, ROAS 0,29`]);
    expect(buildDigest(w, 8, 14).mistakes.some((m) => m.startsWith('Stop-loss tardif'))).toBe(false);
  });

  it('sees cash asleep past the reserve, once the CFO has one to read and a guide could use it', () => {
    const w = world();
    book(w, 3, 'revenue', 2000);
    w.day = 7;
    expect(buildDigest(w, 1, 7).mistakes.join(' ')).not.toContain('dort');
    growth(w).allocation = { free: 1800 } as NonNullable<WorldState['company']['growth']>['allocation'];
    expect(buildDigest(w, 1, 7).mistakes.join(' ')).not.toContain('dort');
    addProduct(w, 'prd_a');
    expect(buildDigest(w, 1, 7).mistakes).toContain(`Trésorerie qui dort : ${eur(1800)} au-delà de la réserve et de 14 jours de pub`);
  });
});

describe('incidents', () => {
  it('holds every skipped tick and crash recovery of the log, outages and bans too, in the window only', () => {
    const w = world();
    w.day = 3;
    logDecision(w, { kind: 'incident', who: 'system', text: 'Créneau 4 du jour 3 sauté', why: 'disque plein' });
    w.market.events.push(
      { id: 'evt_o', day: 5, kind: 'platform_outage', title: 'Panne de la boutique annoncée', description: '', severity: 'danger' },
      { id: 'evt_r', day: 5, kind: 'cpm_spike', title: 'Enchères en hausse', description: '', severity: 'warn' },
      { id: 'evt_b', day: 6, kind: 'ad_account_banned', title: 'Compte pub suspendu', description: '', severity: 'danger' },
    );
    w.day = 14;
    expect(buildDigest(w, 1, 7).incidents).toEqual(['Jour 3 : Créneau 4 du jour 3 sauté (disque plein)', 'Jour 5 : Panne de la boutique annoncée', 'Jour 6 : Compte pub suspendu']);
    expect(buildDigest(w, 8, 14).incidents).toEqual([]);
  });

  const session: SessionRecord[] = [
    { startAt: '2026-10-01T08:00:00.000Z', stopAt: '2026-10-01T09:00:00.000Z', clean: true, day: 2 },
    { startAt: '2026-10-01T12:20:00.000Z', stopAt: '2026-10-01T13:00:00.000Z', clean: false, day: 4 },
    { startAt: '2026-10-03T15:00:00.000Z', stopAt: '2026-10-03T16:00:00.000Z', clean: true, day: 5 },
    { startAt: '2026-10-03T16:00:30.000Z', stopAt: '2026-10-03T17:00:00.000Z', clean: false, day: 6 },
    { startAt: '2026-10-03T17:00:10.000Z', clean: false, day: 9 },
  ];

  it('tells how long the agency stood still and when it crashed, from the session log it is handed', () => {
    const w = world();
    w.day = 7;
    expect(buildDigest(w, 1, 7, session).incidents).toEqual([
      'Jour 4 : agence à l\'arrêt 3 h 20 min, son temps s\'est arrêté avec elle',
      'Jour 5 : arrêt brutal de l\'agence, 2 j 2 h à l\'arrêt',
    ]);
  });

  it('a crash followed by an instant restart is still a crash, a clean restart is nothing', () => {
    const w = world();
    w.day = 12;
    expect(buildDigest(w, 6, 12, session).incidents).toEqual(['Jour 9 : arrêt brutal de l\'agence']);
  });

  it('needs no session log: the world alone gives a digest', () => {
    expect(buildDigest(world(), 1, 7).incidents).toEqual([]);
  });
});

describe('what comes next', () => {
  it('waiting: approvals first, then his open requests and the orders only he can lift', () => {
    const w = world();
    w.company.missions.push({ id: 'mis_a', day: 2, from: 'founder', text: 'Lancer un guide sur le sommeil', ownerId: 'nora', taskIds: [], status: 'open' }, { id: 'mis_b', day: 2, from: 'founder', text: 'Finie', ownerId: 'nora', taskIds: [], status: 'done' });
    w.company.holds = [{ id: 'hold_a', kind: 'ads', productId: null, day: 3, until: null, reason: 'plus de pub' }, { id: 'hold_b', kind: 'ads', productId: null, day: 3, until: 40, reason: 'refus' }];
    Object.assign(createTask(w, { kind: 'publish_product', title: 'Publier le guide' }), { status: 'awaiting_founder', priority: 2 });
    Object.assign(createTask(w, { kind: 'launch_campaign', title: 'Lancer la campagne' }), { status: 'awaiting_founder', priority: 1 });
    createTask(w, { kind: 'plan_day', title: 'Rien à valider' });
    w.day = 7;
    expect(buildDigest(w, 1, 7).waiting).toEqual([
      'À valider : Lancer la campagne', 'À valider : Publier le guide', 'Ta demande du jour 2 : Lancer un guide sur le sommeil', 'Ton ordre du jour 3 tient toujours : plus de pub',
    ]);
  });

  it('a budget line prints no amount and outranks nothing: it moved money, it earned none', () => {
    const w = world();
    logDecision(w, { kind: 'budget', who: 'system', text: 'Semaine 6 : plafond 210 €/jour', why: 'x', impactEur: 802 });
    logDecision(w, { kind: 'double_down', who: 'system', text: 'On double', why: 'x', impactEur: 90 });
    const { decisions } = buildDigest(w, 1, 7);
    expect(decisions.map((d) => d.text)).toEqual(['On double', 'Semaine 6 : plafond 210 €/jour']);
    expect(decisions[1]).not.toHaveProperty('impactEur');
    expect(growth(w).decisions.find((d) => d.kind === 'budget')?.impactEur).toBe(802);
  });

  it('says what the founder\'s silence costs: the cash gone since the oldest ask, and nothing while the cash holds', () => {
    const w = world();
    book(w, 2, 'revenue', 400);
    w.day = 3;
    const ask = Object.assign(createTask(w, { kind: 'publish_product', title: 'Publier le guide' }), { status: 'awaiting_founder' });
    book(w, 5, 'platform_fee', -30);
    book(w, 9, 'platform_fee', -20);
    w.day = 10;
    expect(buildDigest(w, 1, 10).waiting).toEqual([`1 demande(s) t'attendent depuis le jour 3 : la trésorerie a perdu ${eur(50)} depuis, et rien ne repart sans ta réponse.`, 'À valider : Publier le guide']);
    book(w, 10, 'revenue', 100);
    expect(buildDigest(w, 1, 10).waiting).toEqual(['À valider : Publier le guide']);
    ask.status = 'done';
    expect(buildDigest(w, 1, 10).waiting).toEqual([]);
  });

  it('a Red Team reason stops on a whole word and closes its quote', () => {
    const w = world();
    const title = 'Revendre sur Vinted sans y passer ses soirées : la méthode pas à pas pour les débutants pressés';
    const p = addProduct(w, 'prd_a', { status: 'killed', decision: { day: 1, status: 'killed', reason: clip(`Marché trop bon marché pour « ${title} » : les clients citent 9 €.`, 60) } as Product['decision'] });
    const { why } = buildDigest(w, 1, 7).products.stopped.find((s) => s.title === p.title)!;
    expect(why).toBe('Marché trop bon marché pour « Revendre sur Vinted sans y… »');
  });

  it('next: the allocation of the week first, then the open bets', () => {
    const w = world();
    growth(w).allocation = { adTarget: 83.5, testWeek: 70, note: 'Cible pub 83,50 €/jour.' } as NonNullable<WorldState['company']['growth']>['allocation'];
    growth(w).portfolio = { day: 1, week: 1, slots: { used: 1, max: 2 }, notes: [], lines: [
      { productId: 'a', nicheId: 'n', title: 'Guide a', verdict: 'test', reason: '30 € sur 100', contribution28: 0, roas14: null, paidTested: 30, share: 0 },
      { productId: 'b', nicheId: 'n', title: 'Guide b', verdict: 'keep', reason: 'tient', contribution28: 10, roas14: 1, paidTested: 200, share: 1 },
    ] };
    w.company.experiments.push({ id: 'exp', day: 1, owner: 'nora', hypothesis: 'Le hook liste bat le POV', dimension: 'hook_style', variants: [], metric: 'ctr', status: 'running', results: {}, winner: null, endDay: null });
    const { next } = buildDigest(w, 1, 7);
    expect(next[0]).toBe('Cible pub 83,50 €/jour.'); // the CFO's own line: `testWeek` is room in a formula, no code spends it
    expect(next.join(' ')).not.toContain('pour les tests');
    expect(next).toContain('« Guide a » : 30 € sur 100');
    expect(next).toContain('Test en cours : Le hook liste bat le POV');
    expect(next.join(' ')).not.toContain('Guide b');
  });
});

describe('the weekly note', () => {
  async function sunday(over: Partial<ScenarioConfig>): Promise<{ ctx: RuntimeCtx; brain: BrainVault; w: WorldState }> {
    const w = world(over);
    const brain = createBrainVault(pathsOf());
    await brain.init();
    book(w, 3, 'tool_subscription', 12);
    w.day = 14;
    return { ctx: { world: w, brain } as unknown as RuntimeCtx, brain, w };
  }

  it('lands in journal/semaine-NNN.md from the same object as the digest, for the agents to read', async () => {
    const { ctx, brain, w } = await sunday({ scaling: true });
    const week = weekRollup(w, 8, 14);
    logDecision(w, { kind: 'stage', who: 'system', text: 'Une décision de la semaine', why: 'avec ses chiffres' });
    await weeklyNote(ctx, week);
    const note = await brain.read('journal/semaine-002.md');
    expect(note?.title).toBe('Semaine 2, jours 8 à 14');
    expect(note?.tags).toEqual(['journal', 'semaine']);
    expect(note?.body).toContain(buildDigest(w, 8, 14).headline);
    expect(note?.body).toContain('Une décision de la semaine : avec ses chiffres');
    expect((await brain.search('Une décision de la semaine', 3)).map((n) => n.path)).toContain('journal/semaine-002.md');
  });

  it('the control arm stays the old company: no note, no id spent, nothing in the feed', async () => {
    const { ctx, brain, w } = await sunday({ scaling: false });
    const ids = w.idCounter;
    const feed = w.activity.length;
    await weeklyNote(ctx, weekRollup(w, 8, 14));
    expect(await brain.read('journal/semaine-002.md')).toBeNull();
    expect(w.idCounter).toBe(ids);
    expect(w.activity).toHaveLength(feed);
  });
});

describe('a real company closing its weeks', () => {
  async function company(seed: number) {
    const w = createWorld(defaultScenario({ startingCash: 500, difficulty: 'normal', seed, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-digest-week');
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
    w.mind.mode = engine.mode;
    const paths = pathsOf();
    const brain = createBrainVault(paths);
    await brain.init();
    return { w, engine, brain, company: new Company(w, { paths, engine, brain }) };
  }

  it('a paid mind: the Claude cost of Sunday evening is in the week it closes', async () => {
    const { w, engine, company: c } = await company(7);
    const usage = engine.usage.bind(engine);
    let extra = 0;
    engine.usage = () => { const u = usage(); return { ...u, costEur: u.costEur + extra }; };
    while (w.day <= 14) {
      if (w.tick === 11) extra += 0.37; // what retro and memo spend, on the evening's own tick
      await c.step();
    }
    expect(w.ledger.filter((e) => e.type === 'compute' && e.day === 14).map((e) => e.amount)).toEqual([-0.37]);
    for (const r of growth(w).weeks) {
      expect(r.profit).toBe(profitOf(w, r.fromDay, r.toDay));
      expect(r.cashEnd).toBe(cashOn(w, r.toDay));
    }
    expect(buildDigest(w, 1, 14).money.profit).toBe(profitOf(w, 1, 14));
    expect(buildDigest(w, 1, 14).money.cashEnd).toBe(cashOn(w, 14));
  }, 120_000);

  it('a Sunday evening skipped: Monday evening closes the week, to the cent, and writes its note', async () => {
    const { w, brain, company: c } = await company(7);
    while (w.day < 7 || w.tick < 11) await c.step();
    c.skipTick('panne de test');
    expect(growth(w).weeks).toEqual([]);
    await c.runDays(1);
    expect(growth(w).weeks.map((r) => [r.week, r.fromDay, r.toDay])).toEqual([[1, 1, 7]]);
    expect(growth(w).weeks[0]!.profit).toBe(profitOf(w, 1, 7));
    expect(growth(w).weeks[0]!.cashEnd).toBe(cashOn(w, 7));
    expect((await brain.read('journal/semaine-001.md'))?.title).toBe('Semaine 1, jours 1 à 7');
    await c.runDays(6);
    expect(growth(w).weeks.map((r) => r.week)).toEqual([1, 2]);
  }, 120_000);
});

/** Scale test 6 on the real company, and the Done of P10.3: 60 days of seed 7, a tick skipped and a guide killed on the way. */
describe('a digest over 60 days of a real run', () => {
  let w: WorldState;
  let brain: BrainVault;
  let killed: Product;

  beforeAll(async () => {
    const seed = 7;
    w = createWorld(defaultScenario({ startingCash: 500, difficulty: 'normal', seed, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-digest-60');
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
    w.mind.mode = engine.mode;
    const paths = pathsOf();
    brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(w, { paths, engine, brain });
    await company.runDays(20);
    company.skipTick('panne de test');
    await company.runDays(10);
    killed = w.company.products.find((p) => p.status === 'live')!;
    await killProduct((company as unknown as { ctx: RuntimeCtx }).ctx, killed, 'arrêté pour le test du résumé');
    await company.runDays(30);
  }, 300_000);

  it('its profit is the ledger\'s, to the cent', () => {
    const d = buildDigest(w, 1, 60);
    expect(d.money.profit).toBe(summarizeLedger(w.ledger, w.day).profit);
    expect(d.money.cashEnd).toBe(summarizeLedger(w.ledger, w.day).cash);
    expect(round2(d.money.revenue - d.money.refunds - d.money.adSpend - d.money.costs)).toBe(d.money.profit);
    expect(round2(buildDigest(w, 1, 30).money.profit + buildDigest(w, 31, 60).money.profit)).toBe(d.money.profit);
  });

  it('every Sunday left its rollup, and they add up to the ledger', () => {
    const { weeks } = growth(w);
    expect(weeks.map((r) => r.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of weeks) expect(r.profit).toBe(profitOf(w, r.fromDay, r.toDay));
    expect(weeks.at(-1)!.cashEnd).toBe(cashOn(w, 56));
  });

  it('a skipped tick and a killed product both appear', () => {
    const d = buildDigest(w, 1, 60);
    expect(d.incidents.join(' ')).toContain('panne de test');
    expect(d.incidents.join(' ')).toMatch(/Créneau \d+ du jour 21 sauté/);
    expect(d.products.stopped).toContainEqual({ title: killed.title, why: 'arrêté pour le test du résumé' });
  });

  it('names its losses in French', () => {
    const d = buildDigest(w, 1, 60);
    const red = growth(w).weeks.filter((r) => r.profit < 0);
    expect(red.length).toBeGreaterThan(0); // the first week pays the launch and sells nothing
    expect(d.mistakes.join(' ')).toMatch(new RegExp(`^${red.length} semaine\\(s\\) en perte sur 8, la pire à -`));
    for (const r of red) {
      const week = buildDigest(w, r.fromDay, r.toDay);
      expect(week.headline.startsWith(`Perte de ${eur(-r.profit)} en 7 jours`)).toBe(true);
      expect(week.money.profit).toBeLessThan(0);
    }
  });

  it('is a pure read', () => {
    const before = JSON.stringify(w);
    buildDigest(w, 1, 60);
    expect(JSON.stringify(w)).toBe(before);
    expect(buildDigest(w, 1, 60)).toEqual(buildDigest(w, 1, 60));
  });

  it('wrote its weekly notes along the way, for the agents', async () => {
    const note = await brain.read('journal/semaine-008.md');
    expect(note?.body).toContain('Palier');
    expect(note?.body).toMatch(/(Perte|Profit) de .+ en 7 jours/);
  });
});
