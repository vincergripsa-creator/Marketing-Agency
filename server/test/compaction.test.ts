/**
 * Bounded memory (scale §7.2, tests 20 to 23): a compacted world answers every reader as the full one did. Test 19, the same
 * run on and off, needs months: it lives in longrun.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdCreative, Campaign, CompanySnapshot, Customer, DailyAdStats, DailyKpi, Deliverable, Experiment, InboxMessage, LedgerEntry, Mission, Order, PdfContent, Product, Review, ScenarioConfig, TaskKind, WorldState } from '../src/shared.js';
import type { ArchiveBatch, BrainVault, RunPaths } from '../src/contracts.js';
import { appendArchive, readArchive } from '../src/api/archive.js';
import { buildSnapshot, LIVE_BUDGET_BYTES, LIVE_LIMITS, LIVE_TIGHT_LIMITS, serializeLiveSnapshot, serializeSnapshot, SNAPSHOT_BUDGET_BYTES, taskStatsOf, TIGHT_LIMITS } from '../src/api/trim.js';
import { createRng, HOLD_REF, summarizeLedger } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { computeDailyKpi } from '../src/learning/kpi.js';
import { createContentEngine } from '../src/minds/index.js';
import { versionSince } from '../src/runtime/acquisition.js';
import { COMPACT, compactWorld } from '../src/runtime/compaction.js';
import { latestOutput } from '../src/runtime/ctx.js';
import { growthPillar } from '../src/runtime/growthPillar.js';
import { redTeamFixes } from '../src/runtime/handlers/common.js';
import { hookPool } from '../src/runtime/handlers/growth.js';
import { detectedComplaints, recordFeedback, reviewCount } from '../src/runtime/metrics.js';
import { missionStatusLine } from '../src/runtime/missions.js';
import { redTeamGate } from '../src/runtime/redteam.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { customerFeedback } from '../src/runtime/strategy.js';
import { closeMissions, createTask, depState, taskById } from '../src/runtime/tasks.js';
import { addReview, recentReviews, REVIEWS_KEPT } from '../src/sim/feedback.js';
import { heldAmount } from '../src/sim/finance.js';
import { createMarketTools, financeSnapshot, recordLedger, tickMarket } from '../src/sim/index.js';
import { storeRating } from '../src/sim/tick.js';
import { LEGACY } from './legacy.js';

function world(day = 365): WorldState {
  const w = createWorld(defaultScenario({ ...LEGACY, seed: 5, mindMode: 'heuristic' }), 'test-compaction');
  w.day = day;
  return w;
}

function addProduct(w: WorldState, id: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    id, nicheId: w.market.niches[0]!.id, title: `Guide ${id}`, subtitle: '', audience: 'Parents', problem: `Le problème ${id}`, price: 19, status: 'live', version: 1, content: null,
    design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [], ...over,
  };
  w.company.products.push(p);
  return p;
}

function doneTask(w: WorldState, kind: TaskKind, input: Record<string, unknown>, day: number, output: Record<string, unknown> | null = {}) {
  const t = createTask(w, { kind, input });
  Object.assign(t, { status: 'done', dayCreated: day, dayDone: day, output });
  return t;
}

const guide = (promise: string): PdfContent => ({
  title: 'Guide', subtitle: '', audience: 'Parents', promise, introduction: ['Le problème.'], wordCount: 900,
  chapters: [{ title: 'Un', intro: 'Intro', paragraphs: ['Texte.'], steps: [], example: null, checklist: [], visual: null }],
  bonus: { title: 'Bonus', intro: 'Intro', paragraphs: ['Texte.'], steps: [], example: null, checklist: [], visual: null },
  nextStep: { title: 'La suite', text: 'Texte', upsellProductId: null },
});

const creative = (id: string, productId: string, over: Partial<AdCreative> = {}): AdCreative => ({
  id, productId, hook: `Accroche ${id}`, hookStyle: 'question', format: 'text_slideshow', caption: 'Légende', hashtags: ['#a'], cta: 'Lien en bio',
  scenes: [{ visual: 'Plan', onScreenText: 'Texte', voiceover: 'Voix', durationSec: 3 }, { visual: 'Plan', onScreenText: 'Texte', voiceover: 'Voix', durationSec: 3 }],
  files: { storyboard: [`files/${productId}/ads/${id}/frame-1.svg`, `files/${productId}/ads/${id}/frame-2.svg`], preview: `files/${productId}/ads/${id}/preview.html` },
  quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'zoe', ...over,
});

const campaign = (id: string, productId: string, startDay: number, over: Partial<Campaign> = {}): Campaign => ({
  id, productId, name: `Campagne ${id}`, creativeIds: [], dailyBudget: 10, status: 'paused', targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay, createdBy: 'zoe', ...over,
});

describe('the ledger', () => {
  /** 400 days of a real book: capital, the setup line, sales, ads, a released hold, an open one. */
  function book(): WorldState {
    const w = world(1);
    recordLedger(w, { type: 'tool_subscription', amount: -60, memo: 'Frais de démarrage', ref: 'setup' });
    for (let day = 1; day <= 400; day++) {
      w.day = day;
      recordLedger(w, { type: 'revenue', amount: 31.37, memo: 'Ventes', ref: 'prd_1' });
      recordLedger(w, { type: 'ad_spend', amount: -12.11, memo: 'Pubs', ref: 'cpg_1' });
      recordLedger(w, { type: 'platform_fee', amount: -0.97, memo: 'Boutique', ref: `fixed:${day}` });
      if (day === 40) recordLedger(w, { type: 'platform_fee', amount: -80, memo: 'Réserve', ref: `${HOLD_REF}evt_1` });
      if (day === 54) recordLedger(w, { type: 'platform_fee', amount: 80, memo: 'Libération', ref: `${HOLD_REF}release:54` });
      if (day === 60) recordLedger(w, { type: 'platform_fee', amount: -25.5, memo: 'Réserve', ref: `${HOLD_REF}evt_2` });
    }
    return w;
  }

  it('keeps every total, a year on: cash, profit, holds, KPIs, and no id is spent', () => {
    const w = book();
    const before = summarizeLedger(w.ledger, w.day);
    const kpi = computeDailyKpi(w, w.day);
    const held = heldAmount(w);
    const counter = w.idCounter;
    const rows = w.ledger.length;
    compactWorld(w);
    expect(w.ledger.length).toBeLessThan(rows / 2);
    expect(summarizeLedger(w.ledger, w.day)).toEqual(before);
    expect(computeDailyKpi(w, w.day)).toEqual(kpi);
    expect(heldAmount(w)).toBe(held);
    expect(w.idCounter).toBe(counter);
    expect(w.company.archive!.ledger).toBe(rows - w.ledger.length + w.ledger.filter((e) => e.id.startsWith('led_roll_')).length);
  });

  it('never swallows the setup line: the next close does not book it again', () => {
    const w = book();
    w.market = { ...w.market, adStats: [] };
    compactWorld(w);
    expect(w.ledger.filter((e) => e.ref === 'setup')).toHaveLength(1);
    w.day = 401;
    tickMarket(w, createRng(3));
    expect(w.ledger.filter((e) => e.ref === 'setup')).toHaveLength(1);
  });

  it('leaves an open hold whole, and folds a released pair under a hold: ref, out of profit', () => {
    const w = book();
    compactWorld(w);
    const rolled = w.ledger.filter((e) => e.id.startsWith('led_roll_') && e.ref?.startsWith(`${HOLD_REF}rollup:`));
    expect(rolled.reduce((s, e) => s + e.amount, 0)).toBe(0);
    expect(w.ledger.find((e) => e.ref === `${HOLD_REF}evt_2`)?.amount).toBe(-25.5); // day 60, a year ago, never released
  });

  it('names rollups by month and type, and a second pass adds to them instead of forking', () => {
    const w = book();
    compactWorld(w);
    const ids = w.ledger.filter((e) => e.id.startsWith('led_roll_')).map((e) => e.id);
    expect(ids).toContain('led_roll_0001_revenue');
    expect(new Set(ids).size).toBe(ids.length);
    const before = summarizeLedger(w.ledger, w.day);
    w.day += 7;
    compactWorld(w);
    expect(summarizeLedger(w.ledger, w.day - 7).cash).toBe(before.cash);
    expect(w.ledger.filter((e) => e.id === 'led_roll_0009_revenue')).toHaveLength(1);
  });

  it('is byte-stable when run twice on one day', () => {
    const w = book();
    compactWorld(w);
    const once = JSON.stringify(w.ledger);
    compactWorld(w);
    expect(JSON.stringify(w.ledger)).toBe(once);
  });
});

describe('tasks and what their readers keep', () => {
  it('lets finished rows go after 21 days, and keeps open ones', () => {
    const w = world();
    const old = doneTask(w, 'daily_report', {}, 300);
    const recent = doneTask(w, 'daily_report', {}, 350);
    const open = createTask(w, { kind: 'daily_report' });
    const batch = compactWorld(w);
    expect(taskById(w, old.id)).toBeUndefined();
    expect(taskById(w, recent.id)).toBeDefined();
    expect(taskById(w, open.id)).toBeDefined();
    expect(batch.rows.tasks).toEqual([old]);
    expect(w.company.archive!.tasks).toBe(1);
  });

  it('keeps a row an open task depends on: a failed step still breaks what waits on it', () => {
    const w = world();
    const failed = doneTask(w, 'write_pdf', {}, 100);
    failed.status = 'failed';
    const waiting = createTask(w, { kind: 'render_pdf', dependsOn: [failed.id] });
    compactWorld(w);
    expect(depState(w, waiting)).toBe('broken');
  });

  describe('an open mission', () => {
    const open = (id: string, over: Partial<Mission> = {}): Mission => ({ id, day: 100, from: 'zoe', text: 'Suivi', ownerId: 'zoe', taskIds: [], status: 'open', ...over });

    // Scale §7.2 had it pin every row: a chain that always has a child open then held them for good, which D15 forbids.
    it('lets its old rows go and still reads as it did', () => {
      const w = world();
      const done = doneTask(w, 'daily_report', {}, 100);
      const failed = doneTask(w, 'daily_report', {}, 100, null);
      failed.status = 'failed';
      const child = createTask(w, { kind: 'daily_report' });
      const mission = open('mis_1', { taskIds: [done.id, failed.id, child.id] });
      w.company.missions.push(mission);
      compactWorld(w);
      expect(taskById(w, done.id)).toBeUndefined();
      expect(mission.taskIds).toEqual([child.id]);
      expect(mission.gone).toEqual({ tasks: 2, done: 1 });
      expect(closeMissions(w)).toEqual([]); // the child still runs
      child.status = 'failed';
      expect(closeMissions(w).map((m) => m.status)).toEqual(['done']); // one row done, gone or not, as if nothing had left
    });

    it('still closes when every row left, as failed when none was done', () => {
      const w = world();
      const lost = doneTask(w, 'daily_report', {}, 100, null);
      lost.status = 'failed';
      const won = doneTask(w, 'daily_report', {}, 100);
      w.company.missions.push(open('mis_lost', { taskIds: [lost.id] }), open('mis_won', { taskIds: [won.id] }));
      // the world closes open missions every day: here the fold runs first, the worst case
      compactWorld(w);
      expect(closeMissions(w).map((m) => [m.id, m.status])).toEqual([['mis_lost', 'failed'], ['mis_won', 'done']]);
    });

    it('a mission of the founder tells the same progress once its rows left, and so does the snapshot', () => {
      const w = world();
      const rows = [doneTask(w, 'daily_report', {}, 100), doneTask(w, 'daily_report', {}, 100)];
      const child = createTask(w, { kind: 'daily_report' });
      const mission = open('mis_me', { from: 'founder', text: 'Une demande', taskIds: [...rows.map((t) => t.id), child.id] });
      w.company.missions.push(mission);
      const ctx = { world: w } as RuntimeCtx;
      const before = missionStatusLine(ctx, mission);
      expect(before).toContain('2/3 tâches terminées');
      compactWorld(w);
      expect(missionStatusLine(ctx, mission)).toBe(before);
      const shown = buildSnapshot(w, financeSnapshot(w)).company.missions.find((m) => m.id === 'mis_me')!;
      expect([shown.doneTasks, shown.totalTasks]).toEqual([2, 3]);
    });

    it('a closed mission of the founder keeps its count too: it stays in the world for good, its rows do not', () => {
      const w = world();
      const t = doneTask(w, 'daily_report', {}, 100);
      w.company.missions.push(open('mis_me', { from: 'founder', status: 'done', taskIds: [t.id] }));
      compactWorld(w);
      const shown = buildSnapshot(w, financeSnapshot(w)).company.missions[0]!;
      expect([shown.doneTasks, shown.totalTasks]).toEqual([1, 1]);
    });

    it('a task another mission only shows counts on that mission too', () => {
      const w = world();
      const t = doneTask(w, 'daily_report', {}, 100);
      t.missionId = 'mis_owner';
      w.company.missions.push(open('mis_owner', { taskIds: [t.id] }), open('mis_shown', { from: 'founder', taskIds: [t.id] }));
      compactWorld(w);
      expect(w.company.missions.map((m) => [m.id, m.taskIds, m.gone])).toEqual([['mis_owner', [], { tasks: 1, done: 1 }], ['mis_shown', [], { tasks: 1, done: 1 }]]);
    });

    it('holds nothing for ever: 400 days on one mission with a child always open', () => {
      const w = world(1);
      const mission = open('mis_long', { day: 1 });
      w.company.missions.push(mission);
      let child = createTask(w, { kind: 'scan_trends', missionId: mission.id });
      const held: number[] = [];
      for (let day = 1; day <= 400; day++) {
        w.day = day;
        Object.assign(child, { status: 'done', dayDone: day });
        child = createTask(w, { kind: 'scan_trends', missionId: mission.id });
        if (day % 7) continue;
        compactWorld(w);
        expect(closeMissions(w)).toEqual([]);
        held.push(w.company.tasks.length);
      }
      expect(Math.max(...held)).toBeLessThanOrEqual(COMPACT.taskDays + 8);
      expect(held.at(-1)).toBeLessThanOrEqual(held[3]!);
      expect(mission.taskIds.length).toBeLessThanOrEqual(COMPACT.taskDays + 8);
      expect(mission.gone!.tasks + mission.taskIds.length).toBe(401);
      expect(mission.gone!.done).toBe(mission.gone!.tasks);
      expect(w.company.archive!.tasks).toBe(mission.gone!.tasks);
    });
  });

  it('keeps the latest done row per (kind, product), a pick under the product it created, and the task an agent still points at', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    doneTask(w, 'write_outline', { productId: p.id }, 40, { outline: 'vieux' });
    doneTask(w, 'write_outline', { productId: p.id }, 90, { outline: 'récent' });
    const pick = doneTask(w, 'pick_opportunity', {}, 10, { productId: p.id });
    const stale = doneTask(w, 'daily_report', {}, 10);
    w.company.agents[0]!.currentTaskId = stale.id;
    compactWorld(w);
    expect(latestOutput(w, 'write_outline', p.id)).toEqual({ outline: 'récent' });
    expect(w.company.tasks.filter((t) => t.kind === 'write_outline')).toHaveLength(1);
    expect(taskById(w, pick.id)).toBeDefined();
    expect(taskById(w, stale.id)).toBeDefined();
  });

  it('keeps what the Red Team said for each reader: the last fix after a later go, the last pass on a version after a reread of the live guide', () => {
    const w = world();
    const p = addProduct(w, 'prd_1', { version: 1 });
    const ctx = { world: w } as unknown as RuntimeCtx;
    doneTask(w, 'red_team', { productId: p.id, subject: 'pdf', version: 1 }, 30, { finalVerdict: 'fix', fixes: ['Resserrer la promesse'] });
    doneTask(w, 'red_team', { productId: p.id, subject: 'pdf', version: 1 }, 35, { finalVerdict: 'go' });
    doneTask(w, 'red_team', { productId: p.id, subject: 'pdf' }, 60, { finalVerdict: 'kill', onLive: true });
    const gate = redTeamGate(w, p);
    compactWorld(w);
    expect(redTeamFixes(ctx, p.id)).toEqual(['Resserrer la promesse']);
    expect(redTeamGate(w, p)).toEqual(gate);
  });

  it('a send-back of a produce_ad marks the product after its row is old', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    const sent = doneTask(w, 'produce_ad', { productId: p.id }, 30);
    sent.reviews.push({ by: 'zoe', day: 30, verdict: 'changes', notes: ['Hors sujet'] });
    compactWorld(w);
    expect(taskById(w, sent.id)).toBeDefined();
  });

  it('a republished version keeps its day', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    doneTask(w, 'publish_product', { productId: p.id, republish: true }, 90);
    const since = versionSince(w, p);
    compactWorld(w);
    expect(w.company.tasks.some((t) => t.kind === 'publish_product')).toBe(false);
    expect(versionSince(w, p)).toBe(since);
    expect(p.versionDay).toBe(90);
  });

  it('folds lastScan, lastScout and lastPage, and the creators who only want cash', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    doneTask(w, 'scan_trends', {}, 80);
    doneTask(w, 'find_creators', { productId: p.id }, 81);
    doneTask(w, 'write_sales_page', { productId: p.id }, 82);
    doneTask(w, 'write_sales_page', { productId: p.id }, 90); // the latest stays, for talent's author
    doneTask(w, 'negotiate_deal', { productId: p.id, creatorId: 'crt_1' }, 83, { cashOnly: true });
    doneTask(w, 'negotiate_deal', { productId: p.id, creatorId: 'crt_2' }, 84, { cashOnly: false });
    compactWorld(w);
    expect(w.company.lastDone).toEqual({ 'scan_trends:': 80, [`find_creators:${p.id}`]: 81, [`write_sales_page:${p.id}`]: 82 });
    expect(w.company.cashOnlyCreators).toEqual(['crt_1']);
  });

  it('the HR review of someone with no perf counters still reads a whole career', async () => {
    const { performanceReview } = await import('../src/learning/review.js');
    const score = async (compact: boolean) => {
      const w = world(70);
      const ceo = w.company.agents[0]!;
      for (let i = 0; i < 12; i++) { const t = doneTask(w, 'daily_report', {}, 3 + i, {}); t.assignee = ceo.id; t.reviews.push({ by: 'zoe', day: 3 + i, verdict: i ? 'approve' : 'reject', notes: [] }); }
      for (const a of w.company.agents.slice(1, 4)) a.perf = { ...a.perf, done: 12, approved: 12 };
      if (compact) compactWorld(w);
      const brain = { read: async () => null, write: async () => undefined, append: async () => undefined } as unknown as BrainVault;
      await performanceReview(w, brain);
      return ceo.perf.score;
    };
    expect(await score(true)).toBe(await score(false));
  });

  it('counts the whole run: the stats of the rows that left add to those of the rows that stayed', () => {
    const w = world();
    doneTask(w, 'daily_report', {}, 100);
    const cancelled = doneTask(w, 'daily_report', {}, 101);
    cancelled.status = 'cancelled';
    doneTask(w, 'daily_report', {}, 360);
    const stats = taskStatsOf(w.company.tasks, w.day);
    compactWorld(w);
    expect(w.company.tasks).toHaveLength(1);
    const after = taskStatsOf(w.company.tasks, w.day, w.company.taskTotals);
    expect(after).toEqual(stats);
  });
});

describe('what buyers said', () => {
  function complaint(w: WorldState, p: Product, id: string, day: number, text: string) {
    const order = { id: `ord_${id}`, productId: p.id, customerId: `cus_${id}`, day } as Order;
    w.market.orders.push(order);
    w.market.inbox.push({ id: `msg_${id}`, orderId: order.id, customerId: `cus_${id}`, day } as InboxMessage);
    const t = doneTask(w, 'reply_inbox', {}, day, { replies: [{ productId: p.id, messageId: `msg_${id}`, detected: 'plainte_qualite', complaint: text }] });
    recordFeedback(w, t);
  }

  it('stays once the reply tasks and the messages are gone: a complaint counts for its version', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    const ctx = { world: w } as unknown as RuntimeCtx;
    complaint(w, p, 'a', 200, 'Il y a des répétitions partout.');
    complaint(w, p, 'b', 201, 'Les exemples ne parlent pas de notre cas.');
    w.market.inbox = []; // what `prune` does to a message past 60 days: `fromBuyer` no longer answers
    expect(detectedComplaints(w, p.id, 100)).toBe(2);
    compactWorld(w);
    expect(w.company.tasks.some((t) => t.kind === 'reply_inbox')).toBe(false);
    expect(detectedComplaints(w, p.id, 100)).toBe(2);
    expect(detectedComplaints(w, p.id, 201)).toBe(1);
    expect(customerFeedback(ctx, p, 100)).toEqual(['Il y a des répétitions partout.', 'Les exemples ne parlent pas de notre cas.']);
  });

  it('holds 30 complaints, the newest', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    for (let i = 0; i < 35; i++) complaint(w, p, `n${i}`, 100 + i, `Plainte ${i}`);
    expect(p.feedback).toHaveLength(30);
    expect(p.feedback![0]!.text).toBe('Plainte 5');
  });
});

describe('hooks', () => {
  it('the pool survives its tasks, newest first, 60 at most, from `onDone` on', async () => {
    const { growthHandlers } = await import('../src/runtime/handlers/growth.js');
    const w = world();
    const p = addProduct(w, 'prd_1');
    const ctx = { world: w } as unknown as RuntimeCtx;
    const write = async (day: number, hooks: string[]) => {
      const t = doneTask(w, 'write_ad_hooks', { productId: p.id }, day, { hooks: hooks.map((hook) => ({ hook, hookStyle: 'question' })) });
      await growthHandlers.write_ad_hooks!.onDone!(ctx, t);
    };
    await write(100, ['Vieille']);
    await write(101, ['Récente', 'Récente bis']);
    expect(hookPool(ctx, p.id).map((h) => h.hook)).toEqual(['Récente', 'Récente bis', 'Vieille']);
    compactWorld(w);
    expect(w.company.tasks.some((t) => t.kind === 'write_ad_hooks')).toBe(false);
    expect(hookPool(ctx, p.id).map((h) => h.hook)).toEqual(['Récente', 'Récente bis', 'Vieille']);
    for (let i = 0; i < 70; i++) await write(102 + i, [`H${i}`]);
    expect(hookPool(ctx, p.id)).toHaveLength(60);
    expect(hookPool(ctx, p.id)[0]!.hook).toBe('H69');
  });
});

describe('orders, customers, messages', () => {
  const order = (id: string, day: number): Order => ({ id, day, customerId: `cus_${id}`, productId: 'prd_1', price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false });
  const customer = (id: string): Customer => ({ id, name: 'Client', email: 'c@x.fr', archetype: 'normal', patience: 0.5, orders: [], satisfaction: 0 });

  it('keeps 120 days of orders, those a message or an open task still names, and their customers', () => {
    const w = world();
    w.market.orders.push(order('old', 100), order('asked', 101), order('refund', 102), order('hot', 300));
    w.market.customers.push(customer('cus_old'), customer('cus_asked'), customer('cus_refund'), customer('cus_hot'), customer('cus_writer'));
    w.market.inbox.push({ id: 'msg_1', orderId: 'asked', customerId: 'cus_writer', day: 350, status: 'open' } as InboxMessage);
    createTask(w, { kind: 'handle_refund', input: { orderId: 'refund' } });
    const batch = compactWorld(w);
    expect(w.market.orders.map((o) => o.id)).toEqual(['asked', 'refund', 'hot']);
    expect(w.market.customers.map((c) => c.id)).toEqual(['cus_asked', 'cus_refund', 'cus_hot', 'cus_writer']);
    expect(batch.rows.orders).toHaveLength(1);
    expect(w.company.archive!.customers).toBe(1);
  });

  it('a snapshot counts the customers who left', () => {
    const w = world();
    w.market.customers.push(customer('cus_a'));
    compactWorld(w);
    const snapshot = JSON.parse(serializeLiveSnapshot(w, financeSnapshot(w))) as { market: { customersCount: number }; archive: { customers: number } };
    expect(snapshot.market.customersCount).toBe(1);
    expect(snapshot.archive.customers).toBe(1);
  });
});

describe('reviews', () => {
  it('keep rating, store rating and count exact past the cap', () => {
    const w = world(200);
    const p = addProduct(w, 'prd_1');
    const rng = createRng(1);
    for (let i = 0; i < 90; i++) addReview(w, rng, p, `cus_${i}`, i < 30 ? 2 : 5, undefined);
    const shown = [p.stats.rating, storeRating(w)];
    w.day = 365;
    compactWorld(w);
    expect(p.stats.reviews.length).toBe(REVIEWS_KEPT);
    expect(reviewCount(p)).toBe(90);
    expect([p.stats.rating, storeRating(w)]).toEqual(shown);
    addReview(w, rng, p, 'cus_next', 5, undefined);
    expect(p.stats.ratingCount).toBe(91);
    expect(p.stats.rating).toBe(Math.round(((30 * 2 + 61 * 5) / 91) * 100) / 100);
  });

  it('keep the days a new order can still review, whatever their number, and readers stop at the same 60 either way', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    const row = (i: number, day: number): Review => ({ id: `rev_${i}`, day, customerId: `cus_${i}`, rating: 5, text: 'Bien' });
    p.stats.reviews = Array.from({ length: 100 }, (_, i) => row(i, w.day - 2));
    p.stats.reviews.unshift(row(1000, 100));
    const seen = recentReviews(p).map((r) => r.id);
    compactWorld(w);
    expect(p.stats.reviews).toHaveLength(100);
    expect(recentReviews(p).map((r) => r.id)).toEqual(seen);
  });
});

describe('creatives and campaigns', () => {
  it('leaves the creatives of a living product whole: each can still run, seed a cut or fill the count of `requestCreatives`', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    w.company.creatives.push(...Array.from({ length: 30 }, (_, i) => creative(`cre_${i}`, p.id)));
    compactWorld(w);
    expect(w.company.creatives).toHaveLength(30);
    expect(w.company.creatives.every((c) => c.scenes.length === 2)).toBe(true);
  });

  it('a killed product lets the text go: the hook, the verdicts and the score stay, the files except the first frame leave', () => {
    const w = world();
    const p = addProduct(w, 'prd_1', { status: 'killed', decision: { day: 100, status: 'killed', reason: 'pertes' } });
    const live = creative('cre_1', p.id, { channelReviews: { meta: { status: 'approved', reason: null, day: 2 } }, quality: { overall: 80 } as AdCreative['quality'] });
    const refused = creative('cre_2', p.id, { review: { status: 'rejected', reason: 'Refusée : « miracle »', day: 2 } });
    w.company.creatives.push(live, refused);
    w.market.creativeImpressions.cre_1 = 900;
    const batch = compactWorld(w);
    expect(batch.rows.creatives).toHaveLength(1);
    expect((batch.rows.creatives![0] as AdCreative).scenes).toHaveLength(2);
    expect(live).toMatchObject({ scenes: [], caption: '', hook: 'Accroche cre_1', review: { status: 'approved' }, channelReviews: { meta: { status: 'approved' } }, quality: { overall: 80 } });
    expect(live.files.storyboard).toEqual(['files/prd_1/ads/cre_1/frame-1.svg']);
    expect(live.files.preview).toBe('files/prd_1/ads/cre_1/preview.html');
    expect(batch.dropFiles).toEqual(['files/prd_1/ads/cre_1/frame-2.svg']);
    expect(w.market.creativeImpressions.cre_1).toBeUndefined();
    expect(refused.scenes).toHaveLength(2); // the retro quotes a refusal's text for the whole run
    expect(compactWorld(w).rows.creatives).toBeUndefined();
  });

  it('D50: every campaign keeps its stream key once a row before it left, and a new one takes the index it would have had', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    w.company.creatives.push(creative('cre_1', p.id));
    w.company.campaigns.push(campaign('cpg_1', p.id, 10), campaign('cpg_2', p.id, 20, { status: 'active', creativeIds: ['cre_1'] }), campaign('cpg_3', p.id, 300));
    const batch = compactWorld(w);
    expect(batch.rows.campaigns).toEqual([expect.objectContaining({ id: 'cpg_1' })]);
    expect(w.company.campaigns.map((c) => [c.id, c.seq])).toEqual([['cpg_2', 1], ['cpg_3', 2]]);
    expect(p.campaignCount).toBe(1);
    recordLedger(w, { type: 'capital', amount: 500, memo: 'Capital', ref: 'capital' });
    const tools = createMarketTools(w, createRng(1));
    const res = tools.createCampaign({ productId: p.id, name: 'Nouvelle', creativeIds: ['cre_1'], dailyBudget: 10, targeting: campaign('x', p.id, 1).targeting, createdBy: 'zoe' });
    expect(res.ok).toBe(true);
    expect(w.company.campaigns.at(-1)!.seq).toBe(3);
  });

  it('a world never compacted has no seq: the index stays the key and golden does not move', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    w.company.creatives.push(creative('cre_1', p.id));
    recordLedger(w, { type: 'capital', amount: 500, memo: 'Capital', ref: 'capital' });
    createMarketTools(w, createRng(1)).createCampaign({ productId: p.id, name: 'Nouvelle', creativeIds: ['cre_1'], dailyBudget: 10, targeting: campaign('x', p.id, 1).targeting, createdBy: 'zoe' });
    expect(w.company.campaigns[0]!.seq).toBeUndefined();
  });

  it('keeps a campaign the founder holds, whatever its age: his word brings it back', () => {
    const w = world();
    const p = addProduct(w, 'prd_1');
    w.company.campaigns.push(campaign('cpg_1', p.id, 10, { pausedFor: 'founder' }));
    compactWorld(w);
    expect(w.company.campaigns).toHaveLength(1);
  });

  it('drops ad comments after 14 days, nothing else of the row', () => {
    const w = world();
    const row = (day: number) => ({ day, campaignId: 'c', creativeId: 'c', productId: 'p', spend: 1, comments: [{ author: 'a', text: 'b', tone: 'positive' }] }) as unknown as DailyAdStats;
    w.market.adStats.push(row(300), row(360));
    compactWorld(w);
    expect(w.market.adStats.map((s) => s.comments.length)).toEqual([0, 1]);
    expect(w.market.adStats[0]!.spend).toBe(1);
  });
});

describe('products', () => {
  it('a guide killed 30 days ago keeps its promise and loses its text; its row goes to the archive whole', () => {
    const w = world();
    const killed = addProduct(w, 'prd_1', { status: 'killed', content: guide('Un chiot propre'), salesPage: { hypeLevel: 0.4 } as Product['salesPage'], decision: { day: 330, status: 'killed', reason: 'pertes' } });
    const fresh = addProduct(w, 'prd_2', { status: 'killed', content: guide('Un chat calme'), decision: { day: 340, status: 'killed', reason: 'pertes' } });
    const batch = compactWorld(w);
    expect(killed.content).toMatchObject({ promise: 'Un chiot propre', chapters: [], introduction: [] });
    expect(killed.salesPage).toBeNull();
    expect(fresh.content!.chapters).toHaveLength(1);
    expect(batch.rows.products).toEqual([expect.objectContaining({ id: 'prd_1', content: expect.objectContaining({ chapters: expect.any(Array) }) })]);
    expect((batch.rows.products![0] as Product).content!.chapters).toHaveLength(1);
    expect(w.company.products).toHaveLength(2);
    expect(compactWorld(w).rows.products).toBeUndefined();
  });

  it('a killed parent keeps its text while its follow-up is on sale: price limit and repeats read it', () => {
    const w = world();
    const child = addProduct(w, 'prd_2', { content: guide('La suite') });
    const parent = addProduct(w, 'prd_1', { status: 'killed', content: guide('Le début'), upsellProductId: child.id, decision: { day: 100, status: 'killed', reason: 'pertes' } });
    compactWorld(w);
    expect(parent.content!.chapters).toHaveLength(1);
  });
});

describe('missions, experiments, deliverables', () => {
  const mission = (id: string, over: Partial<Mission> = {}): Mission => ({ id, day: 100, from: 'zoe', text: 'Suivi', ownerId: 'zoe', taskIds: [], status: 'done', ...over });

  it('closed missions leave after 14 days, except the founder\'s and those an open task still names', () => {
    const w = world();
    w.company.missions.push(mission('mis_old'), mission('mis_recent', { day: 360 }), mission('mis_founder', { from: 'founder' }), mission('mis_named'));
    createTask(w, { kind: 'daily_report', missionId: 'mis_named' });
    compactWorld(w);
    expect(w.company.missions.map((m) => m.id)).toEqual(['mis_recent', 'mis_founder', 'mis_named']);
  });

  const experiment = (id: string, over: Partial<Experiment> = {}): Experiment => ({
    id, day: 100, endDay: 107, status: 'concluded', dimension: 'hook_style', nicheId: 'n1', hypothesis: 'h', variants: ['a', 'b'], metric: 'ctr', results: {}, winner: 'a', owner: 'zoe', ...over,
  });

  it('keep the latest answer to a question, and the latest test of a guide', () => {
    const w = world();
    w.company.experiments.push(
      experiment('exp_1'), experiment('exp_2', { endDay: 120 }), experiment('exp_3', { status: 'running', endDay: null, day: 360, variants: ['c', 'd'] }),
      experiment('exp_4', { day: 340, endDay: 345, variants: ['e', 'f'] }), experiment('exp_5', { dimension: 'price', nicheId: 'n1', productId: 'prd_1', variants: ['19', '24'] }), experiment('exp_6', { dimension: 'price', nicheId: 'n1', productId: 'prd_2', variants: ['19', '24'], endDay: 110 }),
    );
    compactWorld(w);
    expect(w.company.experiments.map((e) => e.id)).toEqual(['exp_2', 'exp_3', 'exp_4', 'exp_5', 'exp_6']);
  });

  it('keep the last 300 deliverables and every one of a live product', () => {
    const w = world();
    addProduct(w, 'prd_1');
    const row = (i: number, productId: string | null) => ({ id: `liv_${i}`, day: 1, kind: 'report', title: 't', productId, creativeId: null, path: 'p', createdBy: 'zoe', quality: null }) as const;
    w.company.deliverables.push(row(0, 'prd_1'), row(1, null), ...Array.from({ length: 300 }, (_, i) => row(i + 2, null)));
    compactWorld(w);
    expect(w.company.deliverables).toHaveLength(301);
    expect(w.company.deliverables[0]!.id).toBe('liv_0');
    expect(w.company.archive!.deliverables).toBe(1);
  });
});

describe('the archive', () => {
  it('written twice, gives each id once: a crash between it and the save writes the same rows again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-archive-'));
    try {
      const batch = { day: 28, rows: { tasks: [{ id: 'tsk_1', kind: 'daily_report' }, { id: 'tsk_2', kind: 'retro' }] }, dropFiles: [] };
      await appendArchive(root, batch);
      await appendArchive(root, batch);
      await appendArchive(root, { day: 35, rows: { tasks: [{ id: 'tsk_3', kind: 'retro' }] }, dropFiles: [] });
      expect(readFileSync(join(root, 'archive', 'tasks.ndjson'), 'utf8').trim().split('\n')).toHaveLength(5);
      expect(await readArchive(root, 'tasks')).toEqual([{ id: 'tsk_1', kind: 'daily_report' }, { id: 'tsk_2', kind: 'retro' }, { id: 'tsk_3', kind: 'retro' }]);
      expect(await readArchive(root, 'orders')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('folds the journals of the brain past 60 days into their month, and a search finds them there', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-archive-'));
    try {
      const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
      const brain = createBrainVault(paths);
      await brain.init();
      for (const day of [10, 31, 100]) await brain.write({ path: `journal/jour-${String(day).padStart(3, '0')}.md`, title: `Journal ${day}`, tags: ['journal'], body: `Le lamantin du jour ${day}.`, day });
      await appendArchive(root, { day: 150, rows: {}, dropFiles: [] });
      expect((await brain.list()).filter((n) => /^journal.(jour|mois)-/.test(n.path)).map((n) => n.path).sort()).toEqual(['journal/jour-100.md', 'journal/mois-01.md', 'journal/mois-02.md']);
      expect((await brain.read('journal/mois-01.md'))!.body).toContain('## Jour 10');
      expect((await brain.search('lamantin', 5)).map((r) => r.path).sort()).toEqual(['journal/jour-100.md', 'journal/mois-01.md', 'journal/mois-02.md']);
      await appendArchive(root, { day: 155, rows: {}, dropFiles: [] }); // nothing left to fold: the second pass moves nothing
      expect((await brain.read('journal/mois-01.md'))!.body.match(/## Jour/g)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('survives a torn last line, and drops only files inside the run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-archive-'));
    const outside = mkdtempSync(join(tmpdir(), 'pixel-archive-out-'));
    try {
      mkdirSync(join(root, 'archive'));
      writeFileSync(join(root, 'archive', 'tasks.ndjson'), '{"id":"tsk_1"}\n{"id":"ts');
      expect(await readArchive(root, 'tasks')).toEqual([{ id: 'tsk_1' }]);
      mkdirSync(join(root, 'files'));
      writeFileSync(join(root, 'files', 'frame-2.svg'), '<svg/>');
      writeFileSync(join(outside, 'keep.txt'), 'x');
      await appendArchive(root, { day: 7, rows: {}, dropFiles: ['files/frame-2.svg', `../${outside.split(/[\\/]/).pop()}/keep.txt`] });
      expect(existsSync(join(root, 'files', 'frame-2.svg'))).toBe(false);
      expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('a synthetic year', () => {
  it('fits the live stream: ≤ 400 kB, with no market truth and no rival in it', () => {
    const w = createWorld(defaultScenario({ seed: 5, mindMode: 'heuristic' }), 'test-year');
    w.day = 365;
    for (let i = 0; i < 80; i++) {
      addProduct(w, `prd_${i}`, { title: `Guide numéro ${i} pour des parents fatigués`, status: i % 8 ? 'killed' : 'live', content: guide(`Promesse ${i}`), decision: { day: 200, status: 'killed', reason: 'Perd de l’argent depuis deux semaines.' } });
    }
    // the shape of a real D120: every ad has a cut, a score and a campaign, and most campaigns are paused, not ended
    const cut = { v: 1, tempo: 'calm', beats: Array.from({ length: 6 }, (_, s) => ({ kind: 'hook', text: `Plan ${s} du montage`, durationSec: 3, music: 'calme' })), metrics: { hookAt: 0, avgShotSec: 1.4 }, sfx: false, craft: 72 } as unknown as AdCreative['cut'];
    const quality = { overall: 80, hook: 80, clarity: 80, specificity: 80, compliance: 100, nativeFeel: 80, offerFit: 80, issues: ['Une remarque de relecture sur ce script.'.repeat(4)] } as unknown as AdCreative['quality'];
    for (let i = 0; i < 480; i++) w.company.creatives.push(creative(`cre_${i}`, `prd_${i % 80}`, { cut, quality, search: { headlines: ['Titre'.repeat(10)], descriptions: ['Texte'.repeat(20)], keywords: ['mot'] } }));
    for (let i = 0; i < 160; i++) w.company.campaigns.push(campaign(`cpg_${i}`, `prd_${i % 80}`, 300, { status: i % 12 ? 'paused' : 'active', creativeIds: [0, 1, 2].map((n) => `cre_${i * 3 + n}`) }));
    for (let i = 0; i < 700; i++) doneTask(w, 'daily_report', { day: 300 + (i % 60) }, 300 + (i % 60), { memo: 'Mémo du jour '.repeat(40) });
    for (let i = 0; i < 60; i++) createTask(w, { kind: 'reply_inbox', input: { messageIds: ['msg_1'] } });
    const channelDay = Object.fromEntries(['tiktok', 'meta', 'google', 'pinterest'].map((id) => [id, { spend: 120.5, impressions: 40_000, clicks: 700, sales: 12, revenue: 228, roas: 1.9, cpm: 8.4, ctr: 0.017, claimed: 240, reconciled: 228 }]));
    for (let day = 1; day <= 365; day++) {
      w.company.kpis.push({ ...computeDailyKpi(w, 1), day, channels: channelDay as DailyKpi['channels'] });
      w.day = day;
      recordLedger(w, { type: 'revenue', amount: 31.37, memo: 'Ventes', ref: 'prd_0' });
      recordLedger(w, { type: 'ad_spend', amount: -12.11, memo: 'Pubs', ref: 'cpg_1' });
    }
    for (let i = 0; i < 2400; i++) w.company.deliverables.push({ id: `liv_${i}`, day: 1, kind: 'ad_preview', title: 'Aperçu', productId: null, creativeId: null, path: `files/${i}.html`, createdBy: 'zoe', quality: null });
    w.market.niches[0]!.voc.pains.push('SENTINELLE_VERITE');
    w.market.rivals = [{ id: 'SENTINELLE_RIVAL', nicheId: w.market.niches[0]!.id, day: 300, pressure: 0.2, price: 9 }];
    compactWorld(w);
    const finance = financeSnapshot(w);
    const live = serializeLiveSnapshot(w, finance);
    expect(live.length).toBeLessThanOrEqual(400_000);
    expect(live).not.toContain('SENTINELLE');
    const shown = (JSON.parse(live) as CompanySnapshot).company;
    expect(shown.products.filter((p) => p.status === 'killed')).toHaveLength(12);
    expect(shown.products.filter((p) => p.status === 'killed').every((p) => !p.content && !p.design)).toBe(true);
    expect(shown.creatives.every((c) => !c.search && !c.quality?.issues && !c.cut?.beats.length)).toBe(true);
    expect(shown.creatives.some((c) => c.cut?.metrics)).toBe(true); // the panel « Montage » reads them
    expect(shown.kpis.every((k) => !k.channels)).toBe(true);
    expect(shown.creatives.length).toBeLessThanOrEqual(LIVE_LIMITS.creatives + 42); // running campaigns count, paused ones do not
    // GET /api/state fits with TIGHT limits, never by falling back to the live view
    expect(JSON.stringify(buildSnapshot(w, finance, false, TIGHT_LIMITS)).length).toBeLessThanOrEqual(SNAPSHOT_BUDGET_BYTES);
    expect(serializeSnapshot(w, finance)).toContain('Mémo du jour');
    expect(buildSnapshot(w, finance, false, TIGHT_LIMITS).company.kpis.every((k) => !k.channels)).toBe(true);
    expect(w.company.campaigns.filter((k) => k.status === 'paused').length).toBeGreaterThan(100); // they stay in the world, not in the stream
  });

  it('a company too big for the live budget falls to tighter limits, it never goes past it', () => {
    const w = world();
    w.company.lessons = Array.from({ length: 40 }, (_, i) => ({ id: `les_${i}`, insight: 'Une leçon très détaillée. '.repeat(600) })) as unknown as WorldState['company']['lessons'];
    const finance = financeSnapshot(w);
    expect(JSON.stringify(buildSnapshot(w, finance, false, LIVE_LIMITS)).length).toBeGreaterThan(LIVE_BUDGET_BYTES);
    const live = serializeLiveSnapshot(w, finance);
    expect(live.length).toBeLessThanOrEqual(LIVE_BUDGET_BYTES);
    expect((JSON.parse(live) as CompanySnapshot).company.lessons).toHaveLength(LIVE_TIGHT_LIMITS.lessons);
  });
});

describe('what was counted before it left', () => {
  const row = (id: string, kind: Deliverable['kind']): Deliverable => ({ id, day: 1, kind, title: id, productId: null, creativeId: null, path: `files/${id}`, createdBy: 'zoe', quality: null });

  it('deliverableCounts is the whole run, week after week', () => {
    const w = world();
    for (let i = 0; i < 500; i++) w.company.deliverables.push(row(`ad_${i}`, 'ad_preview'));
    for (let i = 0; i < 40; i++) w.company.deliverables.push(row(`pdf_${i}`, 'pdf'));
    const before = buildSnapshot(w, financeSnapshot(w)).deliverableCounts;
    expect(before).toEqual({ ad_preview: 500, pdf: 40 });
    compactWorld(w);
    expect(w.company.deliverables.length).toBeLessThan(540);
    expect(buildSnapshot(w, financeSnapshot(w)).deliverableCounts).toEqual(before);
    for (let i = 0; i < 100; i++) w.company.deliverables.push(row(`late_${i}`, 'ad_preview'));
    compactWorld(w);
    expect(buildSnapshot(w, financeSnapshot(w)).deliverableCounts).toEqual({ ad_preview: 600, pdf: 40 });
  });
});

describe('a disk that refuses the archive', () => {
  const close = (w: WorldState, archive: RuntimeCtx['archive']) => growthPillar.eveningEnd!({ world: w, archive } as RuntimeCtx);
  const taskIds = (b: ArchiveBatch) => (b.rows.tasks as { id: string }[] | undefined ?? []).map((t) => t.id);

  it('costs no row: what left the world waits there, through a reload, and goes first next Sunday', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = world(84);
    const week12 = doneTask(w, 'daily_report', {}, 10);
    const sent: ArchiveBatch[] = [];
    let refuse = true;
    const archive = async (b: ArchiveBatch) => { if (refuse) throw new Error('EBUSY'); sent.push(b); };
    await close(w, archive); // and it does not throw: the tick is not played twice
    expect(taskById(w, week12.id)).toBeUndefined();
    expect(sent).toEqual([]);
    expect(w.company.archivePending!.map(taskIds)).toEqual([[week12.id]]);

    await close(Object.assign(w, { day: 91 }), archive); // still refused: both wait, oldest first
    expect(w.company.archivePending!.map((b) => b.day)).toEqual([84, 91]);

    const reloaded = JSON.parse(JSON.stringify(w)) as WorldState;
    reloaded.day = 98;
    const week14 = doneTask(reloaded, 'daily_report', {}, 20);
    refuse = false;
    await close(reloaded, archive);
    expect(sent.map((b) => b.day)).toEqual([84, 91, 98]);
    expect(sent.flatMap(taskIds)).toEqual([week12.id, week14.id]);
    expect('archivePending' in reloaded.company).toBe(false);
    quiet.mockRestore();
  });

  it('stops at the first refusal: nothing overtakes a batch that waits, and a sink that fails half way loses nothing', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = world(98);
    w.company.archivePending = [{ day: 84, rows: {}, dropFiles: [] }, { day: 91, rows: {}, dropFiles: [] }];
    const days: number[] = [];
    await close(w, async (b) => { days.push(b.day); if (b.day === 91) throw new Error('ENOSPC'); });
    expect(days).toEqual([84, 91]);
    expect(w.company.archivePending.map((b) => b.day)).toEqual([91, 98]);
    quiet.mockRestore();
  });

  it('a run with no sink drops its rows and keeps nothing waiting', async () => {
    const w = world(84);
    doneTask(w, 'daily_report', {}, 10);
    await close(w, undefined);
    expect('archivePending' in w.company).toBe(false);
  });

  it('never fails the tick of a real company: the evening of the week runs once', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'pixel-compaction-sink-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const w = createWorld(defaultScenario({ ...LEGACY, seed: 7, mindMode: 'heuristic', horizonDays: 90 }), 'test-sink');
    const received: ArchiveBatch[] = [];
    let refused = 0;
    const archive = async (b: ArchiveBatch) => { if (b.day === 7 && !refused) { refused += 1; throw new Error('EBUSY'); } received.push(b); };
    const company = new Company(w, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain: createBrainVault(paths), archive });
    try {
      await company.runDays(15);
      expect(refused).toBe(1);
      expect(received.map((b) => b.day)).toEqual([7, 14]);
      expect(w.company.archivePending).toBeUndefined();
      expect(w.company.kpis.filter((k) => k.day === 7)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      quiet.mockRestore();
    }
  }, 60_000);
});

describe('a reloaded run', () => {
  async function play(ticks: number, reloadEvery: number, scenario: Partial<ScenarioConfig>): Promise<{ text: string; world: WorldState }> {
    const root = mkdtempSync(join(tmpdir(), 'pixel-compaction-reload-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain: createBrainVault(paths) };
    let world = createWorld(defaultScenario({ ...scenario, seed: 7, mindMode: 'heuristic', horizonDays: 90 }), 'test-reload');
    let company = new Company(world, opts);
    try {
      for (let i = 1; i <= ticks; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = new Company(world, opts);
        }
      }
      return { text: JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v)), world };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it.each([['legacy', LEGACY], ['lean', {}]] as const)('goes on like a straight run through the compaction of day 28: %s company', async (_name, scenario) => {
    const ticks = 29 * 12;
    const straight = await play(ticks, 0, scenario);
    expect(straight.world.company.archive!.tasks).toBeGreaterThan(0);
    expect(straight.world.company.archive!.throughDay).toBe(28);
    expect((await play(ticks, 7, scenario)).text === straight.text).toBe(true); // 7 and 12 share no divisor: a reload falls on every tick of the day
  }, 240_000);
});

describe('constants', () => {
  it('the cap of the sim and the cap of compaction are one number', () => {
    expect(COMPACT.reviewsPerProduct).toBe(REVIEWS_KEPT);
  });

  it('sim and runtime agree on how long orders stay', () => {
    expect(readFileSync(new URL('../src/sim/events.ts', import.meta.url), 'utf8')).toContain(`HOT_ORDER_DAYS = ${COMPACT.orderDays}`);
  });

  it('every ledger line a rollup holds still counts for its type', () => {
    const w = world();
    const line = (type: LedgerEntry['type'], amount: number, day: number): LedgerEntry => ({ id: `led_${day}`, day, type, amount, memo: '', ref: null });
    w.ledger.push(line('refund', -9, 10), line('refund', -1, 11), line('chargeback', -15, 12));
    const before = summarizeLedger(w.ledger, w.day);
    compactWorld(w);
    expect(summarizeLedger(w.ledger, w.day)).toEqual(before);
  });
});
