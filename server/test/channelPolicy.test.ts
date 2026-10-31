/**
 * The company's side of the channels (channels §7, §11): what unlocks one and who has to say yes, where a small test lands,
 * what a line has proved, and how TikTok's run stays untouched until the first buyer is asked for (D24). The rules are
 * arithmetic over the world, so a world built by hand can pin them exactly. Only the first and the last test run the company.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DayPlanItem, MindContext, RunPaths } from '../src/contracts.js';
import type { AdCreative, AgentState, Campaign, ChannelId, DailyAdStats, Lesson, Order, PortfolioLine, PortfolioVerdict, Product, RoleId, ScenarioConfig, Task, WorldState } from '../src/shared.js';
import { CHANNELS, DROPPED_REASON } from '../src/shared.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { adHistory, adBanActive, companyPaidBlock, cutLesson, launchableCreatives, productPaidBlock, TEST_CAMPAIGN_BUDGET } from '../src/runtime/acquisition.js';
import { CHANNEL_POLICY, CHANNEL_ROLE } from '../src/runtime/channelPolicy.js';
import { adjusted, channelPaused, channelsPillar, creditOf, ensureChannelArms, lineOf, multiChannel, openChannels, planChannels, settleLines, submitToChannel, unlockProgress, unlockReason } from '../src/runtime/channels.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { stopLossReason } from '../src/runtime/handlers/growth.js';
import { adsHold } from '../src/runtime/holds.js';
import { currentBudget, type CampaignMetrics } from '../src/runtime/metrics.js';
import { learning, sim } from '../src/runtime/modules.js';
import { ROLES } from '../src/runtime/org/catalog.js';
import { drawCandidates, hireAgent, openPosition } from '../src/runtime/org/hiring.js';
import { refreshPressure } from '../src/runtime/org/load.js';
import { writeWeekNote } from '../src/runtime/org/notes.js';
import { officerOf, roleHolders } from '../src/runtime/org/officers.js';
import { keywordMission, resumeCampaigns } from '../src/runtime/strategy.js';
import { capableAgents, createTask } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx }

async function lab(over: Partial<ScenarioConfig> = {}): Promise<Lab> {
  const world = createWorld(defaultScenario({ talent: 'off', seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), 'test-channel-policy');
  const root = mkdtempSync(join(tmpdir(), 'pixel-channels-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx };
}

const book = (w: WorldState) => w.company.channels!;

/** Days up to `last` are closed, and the world stands on the morning after. */
function closeDays(w: WorldState, last: number): void {
  for (let d = 1; d <= last; d++) {
    w.day = d;
    sim.recordLedger(w, { type: 'platform_fee', amount: 0, memo: 'Clôture', ref: `fixed:${d}` });
  }
  w.day = last + 1;
}

function addProduct(w: WorldState, nicheId: string, id = 'prd_1', over: Partial<Product> = {}): Product {
  const n = w.market.niches.find((x) => x.id === nicheId)!;
  const p = {
    id, nicheId, title: n.name, subtitle: '', audience: n.audience, problem: n.problem, price: 19, status: 'live', version: 1, content: null, salesPage: null,
    design: { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'paw', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 },
    files: { pdf: `files/${id}/guide.pdf`, cover: null, salesPage: null },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [{ day: 1, price: 19 }],
    ...over,
  } as unknown as Product;
  w.company.products.push(p);
  return p;
}

function addCreative(w: WorldState, p: Product, over: Partial<AdCreative> = {}): AdCreative {
  const c: AdCreative = {
    id: `cre_${w.company.creatives.length + 1}`, productId: p.id, hook: 'Trois gestes simples pour commencer ce soir', hookStyle: 'question', format: 'faceless_voiceover',
    scenes: [{ visual: 'Gros plan sur le carnet', onScreenText: 'Trois gestes simples', voiceover: 'Trois gestes simples pour commencer ce soir.', durationSec: 4 }],
    caption: 'Le guide est en lien.', hashtags: ['#guide', '#conseil', '#astuce'], cta: 'Télécharge le guide',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'leo',
    ...over,
  };
  w.company.creatives.push(c);
  return c;
}

function addCampaign(w: WorldState, p: Product, ch: ChannelId, over: Partial<Campaign> = {}): Campaign {
  const id = `cpg_${w.company.campaigns.length + 1}`;
  const c: Campaign = {
    id, productId: p.id, name: `Campagne ${id}`, creativeIds: over.creativeIds ?? [addCreative(w, p).id], dailyBudget: 20, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 },
    startDay: 1, createdBy: 'adam', ...(ch === 'tiktok' ? {} : { channel: ch }), ...over,
  };
  w.company.campaigns.push(c);
  return c;
}

function addRow(w: WorldState, c: Campaign, day: number, spend: number, revenue: number, over: Partial<DailyAdStats> = {}): DailyAdStats {
  const row: DailyAdStats = {
    day, campaignId: c.id, creativeId: c.creativeIds[0]!, productId: c.productId, spend, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 0, cpm: 0,
    landingViews: 15, purchases: revenue > 0 ? 1 : 0, revenue, roas: spend > 0 ? revenue / spend : 0, frequency: 1.2, comments: [],
    ...(c.channel ? { channel: c.channel } : {}), ...over,
  };
  w.market.adStats.push(row);
  return row;
}

function openUp(w: WorldState, ...channels: ChannelId[]): void {
  for (const ch of channels) {
    book(w).open.push(ch);
    book(w).requested[ch] = 1;
    w.market.channels!.accounts[CHANNELS[ch].account as 'meta' | 'google' | 'pinterest'].openDay = 1;
  }
}

async function hire(l: Lab, role: RoleId): Promise<AgentState> {
  const position = openPosition(l.ctx, role, 'channel', 'test', undefined, { noTask: true })!;
  const [candidate] = drawCandidates(l.ctx, role, l.world.company.org!.positions.length - 1, 1);
  return hireAgent(l.ctx, position, candidate!);
}

/** The bandit's arms of a niche leave one reading: this channel, far ahead of everything. */
function favour(w: WorldState, nicheId: string, ch: ChannelId): void {
  w.company.bandits[`channel:${nicheId}`] = openChannels(w).map((key) => ({ key, alpha: key === ch ? 5000 : 1, beta: key === ch ? 1 : 5000, pulls: 0, reward: 0 }));
}

function plan(l: Lab): DayPlanItem[] {
  const items: DayPlanItem[] = [];
  planChannels(l.ctx, items, []);
  return items;
}

const of = (items: DayPlanItem[], kind: Task['kind']) => items.filter((i) => i.kind === kind);

function mindOf(l: Lab, agent: AgentState): MindContext {
  return { agent, playbook: [], brainNotes: [], lessons: [], day: l.world.day, brand: l.world.company.name };
}

/** A task through its handler, as the company runs it, onDone included. */
async function runTask(l: Lab, task: Task, agent: AgentState) {
  const spec = HANDLERS[task.kind];
  const outcome = await spec.run(l.ctx, task, agent, mindOf(l, agent));
  task.output = { ...(task.output ?? {}), ...(outcome.output ?? {}) };
  if (!outcome.awaitFounder && !outcome.fail) await spec.onDone?.(l.ctx, task);
  return outcome;
}

/** A guide that sold: Meta's two conditions hold on the closed days. */
function provenOnTikTok(l: Lab): Product {
  const w = l.world;
  const p = addProduct(w, 'sommeil-bebe');
  p.stats.sales = 20;
  closeDays(w, 20);
  const c = addCampaign(w, p, 'tiktok');
  for (let d = 10; d <= 20; d++) {
    addRow(w, c, d, 10, 15);
    w.market.orders.push({ id: `ord_${d}`, day: d, customerId: 'c', productId: p.id, price: 15, source: 'ads', campaignId: c.id, creatorId: null, refunded: false, chargeback: false });
  }
  return p;
}

const dailyTest = (ch: ChannelId): number => Math.max(CHANNELS[ch].minDailyBudget, TEST_CAMPAIGN_BUDGET);

/** Spend over a campaign's days, so ROAS and days read as a sample would. */
function metricsOf(spend: number, roas: number): CampaignMetrics {
  const rows = [1, 2].map((day) => ({ day, spend: spend / 2 }) as DailyAdStats);
  return { spend, revenue: spend * roas, roas, impressions: 0, clicks: 0, ctr: 0, purchases: 0, rows };
}

// ───────────────────────────── D24 ─────────────────────────────

describe('a full run is a TikTok run until a buyer is asked for', () => {
  /** Everything a channel may add is set aside, and the feed's wall-clock stamps: whatever else differs, a byte moved. */
  function view(w: WorldState): string {
    const { scenario, market, company, ...rest } = w;
    const { channelControl: _control, ...scenarioRest } = scenario;
    const { channels: _book, ...companyRest } = company;
    const { channels: _market, niches, ...marketRest } = market;
    return JSON.stringify({ rest, scenarioRest, companyRest, marketRest, niches: niches.map(({ channels: _cells, ...n }) => n) }, (k, v) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));
  }

  const asked = (w: WorldState): boolean => w.company.org!.positions.some((p) => p.reason === 'channel') || w.company.org!.decisions.some((d) => d.kind === 'refused' && !!d.roleId?.startsWith('media_buyer'));

  it('until the first requestRole for a channel, full and tiktok_only are the same run day by day', async () => {
    // Seed 7's road to the first request, set before the growth pillar: under it that request comes past D40, too long to compare tick by tick.
    const full = await lab({ channelControl: 'none', startingCash: 300, scaling: false });
    const only = await lab({ channelControl: 'tiktok_only', startingCash: 300, scaling: false });
    let ticks = 0;
    for (; ticks < 12 * 20; ticks++) {
      await full.company.step();
      await only.company.step();
      if (asked(full.world)) break;
      expect(view(full.world)).toBe(view(only.world));
    }
    expect(asked(full.world)).toBe(true);
    expect(only.world.company.channels).toBeUndefined();
    expect(ticks).toBeGreaterThan(12 * 10); // a real stretch of run was compared, products and ads included
    expect(full.world.company.products.some((p) => p.status === 'live')).toBe(true);
  }, 120_000);

  it('tiktok_only plans nothing, whatever its numbers', async () => {
    const l = await lab({ ...LEGACY });
    provenOnTikTok(l);
    expect(l.world.company.channels).toBeUndefined();
    expect(unlockReason(l.world, 'meta')).toMatch(/Ventes/);
    expect(plan(l)).toEqual([]);
    expect(openChannels(l.world)).toEqual(['tiktok']);
    expect(multiChannel(l.world)).toBe(false);
  });
});

// ───────────────────────────── unlock ─────────────────────────────

describe('unlock (channels §7.1)', () => {
  it('each channel reads its own conditions, on observable data', async () => {
    const l = await lab({ startingCash: 500 });
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 20);
    expect(unlockReason(w, 'meta')).toBeNull();
    p.stats.sales = 14;
    const c = addCampaign(w, p, 'tiktok');
    addRow(w, c, 18, 100, 150);
    expect(unlockReason(w, 'meta')).toBeNull();
    p.stats.sales = 15;
    expect(unlockReason(w, 'meta')).toMatch(/Ventes 15 ventes \(seuil 15\), ROAS 14 jours 1,50/);
    addRow(w, c, 19, 200, 100); // the ROAS falls under 1
    expect(unlockReason(w, 'meta')).toBeNull();

    expect(unlockReason(w, 'youtube')).toBeNull(); // no master yet
    addCreative(w, p, { quality: { overall: 69 } as AdCreative['quality'] });
    expect(unlockReason(w, 'youtube')).toBeNull();
    addCreative(w, p, { quality: { overall: 80 } as AdCreative['quality'] });
    expect(unlockReason(w, 'youtube')).toMatch(/Meilleure créa/);
    addCreative(w, p, { format: 'carousel', quality: { overall: 99 } as AdCreative['quality'] }); // YouTube refuses a carousel: it proves nothing
    expect(unlockProgress(w, 'youtube').find((s) => s.label.startsWith('Meilleure'))!.value).toBe(80);

    expect(unlockReason(w, 'google')).toBeNull();
    p.stats.rating = 4.4;
    p.stats.reviews = Array.from({ length: 5 }, () => ({ day: 3, rating: 4 })) as unknown as Product['stats']['reviews'];
    expect(unlockReason(w, 'google')).toBeNull(); // the page is not there yet
    p.salesQuality = { overall: 80 } as Product['salesQuality'];
    expect(unlockReason(w, 'google')).toMatch(/Page de vente 80/);

    expect(unlockReason(w, 'pinterest')).toMatch(/Trésorerie/);
    sim.recordLedger(w, { type: 'ad_spend', amount: -400, memo: 'Pub', ref: null });
    expect(unlockReason(w, 'pinterest')).toBeNull();
  });

  it('the screen gets each condition and the buyer, met or not', async () => {
    const l = await lab();
    const p = provenOnTikTok(l);
    p.stats.sales = 3;
    const steps = unlockProgress(l.world, 'meta');
    expect(steps.map((s) => s.label)).toEqual(['Ventes', 'ROAS 14 jours', 'Media buyer']);
    expect(steps[0]).toMatchObject({ value: 3, target: 15, met: false });
    expect(steps[1]).toMatchObject({ value: 1.5, target: 1, met: true });
    expect(steps[2]).toMatchObject({ value: 0, target: 1, met: false });
  });

  it('no holder of the channel\'s role, no channel, and requestRole was called', async () => {
    const l = await lab({ startingCash: 5000 });
    provenOnTikTok(l);
    expect(roleHolders(l.world, 'media_buyer_meta')).toEqual([]);
    const items = plan(l);
    expect(of(items, 'open_channel')).toEqual([]);
    expect(book(l.world).requested.meta).toBeUndefined();
    const position = l.world.company.org!.positions.find((p) => p.roleId === CHANNEL_ROLE.meta)!;
    expect(position).toMatchObject({ reason: 'channel', status: 'open' });
    expect(position.detail).toMatch(/Facebook & Instagram/);
  });

  it('the money gates can say no: no channel, and the refusal carries its numbers', async () => {
    const l = await lab({ startingCash: 60 });
    provenOnTikTok(l);
    expect(of(plan(l), 'open_channel')).toEqual([]);
    expect(l.world.company.org!.positions).toEqual([]);
    const refused = l.world.company.org!.decisions.find((d) => d.kind === 'refused' && d.roleId === 'media_buyer_meta')!;
    expect(refused.text).toMatch(/refuse/);
    expect(refused.numbers).toMatchObject({ cash: expect.any(Number), margin: expect.any(Number), cost: expect.any(Number) });
  });

  it('with its buyer the channel is asked for once, and nothing is on sale, nobody is hired', async () => {
    const l = await lab({ startingCash: 5000 });
    const w = l.world;
    closeDays(w, 5); // past the hire cooldown: only the empty shop can stop this one
    expect(unlockReason(w, 'pinterest')).toBeTruthy();
    expect(plan(l)).toEqual([]); // cash for Pinterest, but no guide to sell
    expect(w.company.org!.positions).toEqual([]);
    expect(w.company.org!.decisions).toEqual([]);
    provenOnTikTok(l);
    await hire(l, 'media_buyer_meta');
    const items = of(plan(l), 'open_channel');
    expect(items.map((i) => i.input.channel)).toContain('meta');
    book(w).requested.meta = w.day;
    expect(of(plan(l), 'open_channel').map((i) => i.input.channel)).not.toContain('meta');
  });

  it('youtube and Search share one account and one buyer', async () => {
    expect(CHANNEL_ROLE.youtube).toBe(CHANNEL_ROLE.google);
    const l = await lab();
    const w = l.world;
    const buyer = await hire(l, 'media_buyer_google');
    expect(capableAgents(w, 'optimize_ads', 'growth', 'google').map((a) => a.id)).toContain(buyer.id);
    expect(capableAgents(w, 'launch_campaign', 'growth', 'youtube').map((a) => a.id)).toContain(buyer.id); // D3
    expect(capableAgents(w, 'optimize_ads', 'growth', 'youtube').map((a) => a.id)).toContain(buyer.id);
    expect(capableAgents(w, 'optimize_ads', 'growth', 'tiktok').map((a) => a.id)).not.toContain(buyer.id); // D25
    expect(capableAgents(w, 'optimize_ads', 'growth', 'meta').map((a) => a.id)).not.toContain(buyer.id);
  });

  it('with YouTube open and Search closed, the Google buyer is a role the agency can fill, and its work is on the chart', async () => {
    const l = await lab({ startingCash: 5000 });
    const w = l.world;
    openUp(w, 'youtube');
    w.day = 8;
    const wait = { optimize_ads: 40 };
    w.company.org!.load.push({ day: 8, wait, reviewWait: {}, work: {}, busy: {}, headcount: w.company.agents.length, payroll: 0 });
    expect(refreshPressure(w).map((p) => p.roleId)).toContain('media_buyer_google');
    expect(refreshPressure(w).map((p) => p.roleId)).not.toContain('media_buyer_pinterest'); // no channel to buy on
    await writeWeekNote(l.ctx);
    const note = await l.ctx.brain.read(`rh/effectif-semaine-${Math.ceil(w.day / 7)}.md`);
    expect(note?.body).toContain(ROLES.media_buyer_google.title);
    expect(note?.body).not.toContain(ROLES.media_buyer_pinterest.title);
  });

  it('the account opens verificationDays later, with its event', async () => {
    const l = await lab();
    const w = l.world;
    provenOnTikTok(l);
    const lead = officerOf(w, 'growth');
    await hire(l, 'media_buyer_meta');
    const task = createTask(w, { kind: 'open_channel', input: { channel: 'meta' }, assignee: lead.id });
    const opened = await runTask(l, task, lead);
    expect(opened.summary).toMatch(/vérification/);
    expect(book(w).requested.meta).toBe(w.day);
    const day = w.day;
    await channelsPillar.morning!(l.ctx);
    expect(openChannels(w)).toEqual(['tiktok']); // Meta takes 3 days
    w.day = day + CHANNELS.meta.verificationDays;
    await channelsPillar.morning!(l.ctx);
    expect(openChannels(w)).toEqual(['tiktok', 'meta']);
    expect(multiChannel(w)).toBe(true);
    expect(w.market.events.filter((e) => e.kind === 'channel_opened').map((e) => e.title)).toEqual(['Facebook & Instagram ouvert']);
    await channelsPillar.morning!(l.ctx);
    expect(w.market.events.filter((e) => e.kind === 'channel_opened')).toHaveLength(1);
  });

  it('a mission that names a closed channel asks for it, through the gates, and one on an open channel does not', async () => {
    const l = await lab({ startingCash: 5000 });
    const w = l.world;
    addProduct(w, 'sommeil-bebe');
    closeDays(w, 5);
    const items = keywordMission(l.ctx, 'Ouvre Pinterest cette semaine');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'open_channel', input: { channel: 'pinterest' } });
    const lead = officerOf(w, 'growth');
    const task = createTask(w, { kind: 'open_channel', input: { channel: 'pinterest' }, assignee: lead.id, createdBy: 'founder' });
    await runTask(l, task, lead);
    expect(w.company.org!.positions[0]).toMatchObject({ roleId: 'media_buyer_pinterest', reason: 'founder' });
    expect(book(w).requested.pinterest).toBeUndefined();
    openUp(w, 'pinterest');
    expect(keywordMission(l.ctx, 'Ouvre Pinterest cette semaine').map((i) => i.kind)).not.toContain('open_channel');
  });
});

describe('founder approval (D49)', () => {
  async function waiting(): Promise<Lab & { task: Task }> {
    const l = await lab({ founderApproval: true, startingCash: 5000 });
    const w = l.world;
    const p = provenOnTikTok(l);
    p.stats.sales = 20;
    await hire(l, 'media_buyer_meta');
    for (let i = 0; i < 12 && !w.company.tasks.some((t) => t.kind === 'open_channel' && t.status === 'awaiting_founder'); i++) await l.company.step();
    return { ...l, task: w.company.tasks.find((t) => t.kind === 'open_channel' && t.input.channel === 'meta')! };
  }

  it('founderApproval: opening a channel waits for him, and nothing moves before his yes', async () => {
    const { world: w, company, task, ctx } = await waiting();
    expect(task.status).toBe('awaiting_founder');
    expect(task.input.founderAsk).toBe('Ouvrir le canal Facebook & Instagram');
    expect(w.company.pendingApprovals).toContain(task.id);
    expect(w.market.channels!.accounts.meta.openDay).toBeNull();
    expect(book(w).requested.meta).toBeUndefined();
    const day = w.day;
    company.approve(task.id, true);
    for (let i = 0; i < 12 && book(w).requested.meta === undefined; i++) await company.step();
    expect(book(w).requested.meta).toBeGreaterThanOrEqual(day);
    expect(w.market.channels!.accounts.meta.openDay).toBe(book(w).requested.meta! + CHANNELS.meta.verificationDays);
    expect(ctx.tools.channelStatus().find((s) => s.id === 'meta')!.state).toBe('verifying');
  }, 60_000);

  it('his no holds that channel for a week, TikTok keeps running, and the ask comes back after', async () => {
    const l = await waiting();
    const { world: w, company, task } = l;
    const day = w.day;
    company.approve(task.id, false);
    expect(w.company.tasks.find((t) => t.id === task.id)!.status).toBe('cancelled');
    const hold = adsHold(w, null, 'meta')!;
    expect(hold).toMatchObject({ kind: 'ads', channel: 'meta', productId: null });
    expect(hold.until).toBe(day + 7);
    expect(adsHold(w)).toBeNull();
    expect(companyPaidBlock(w, 'tiktok') ?? '').not.toMatch(/fondateur/);
    expect(of(plan(l), 'open_channel').map((i) => i.input.channel)).not.toContain('meta');
    w.day = day + 8;
    expect(of(plan(l), 'open_channel').map((i) => i.input.channel)).toContain('meta');
  }, 60_000);
});

// ───────────────────────────── money rules ─────────────────────────────

describe('stop-loss, credits and bans (channels §7.3)', () => {
  it('stop-loss: Meta at 45 €, TikTok at 25 €, credit applied', () => {
    const at = (spend: number) => metricsOf(spend, 0.5);
    expect(stopLossReason(at(24), at(24))).toBeNull();
    expect(stopLossReason(at(25), at(25))).toMatch(/stop-loss/);
    expect(stopLossReason(at(44), at(44), 'meta')).toBeNull();
    expect(stopLossReason(at(45), at(45), 'meta')).toMatch(/stop-loss/);
    expect(stopLossReason(at(29), at(29), 'youtube')).toBeNull();
    const shop = metricsOf(60, 0.6);
    expect(stopLossReason(shop, shop, 'meta')).toMatch(/stop-loss/);
    const reconciled = adjusted(shop, 1.5);
    expect(reconciled.roas).toBeCloseTo(0.9);
    expect(reconciled.revenue).toBeCloseTo(54);
    expect(stopLossReason(reconciled, reconciled, 'meta')).toBeNull();
    expect(adjusted(shop, 1)).toBe(shop); // nothing to read twice
  });

  it('a stale attribution counts as 1, a fresh one reads the niche first', async () => {
    const l = await lab();
    const w = l.world;
    w.day = 20;
    expect(creditOf(w, 'meta', 'sommeil-bebe')).toBe(1); // no report yet
    book(w).attribution = {
      day: 18, fromDay: 5, toDay: 17, by: 'raphael',
      rows: [{ channel: 'meta', spend: 100, shopRevenue: 100, claimedRevenue: 180, reconciledRevenue: 130, credit: 1.3, inflation: 1.8 }],
      niches: { 'sommeil-bebe': { meta: 1.6 } },
    };
    expect(creditOf(w, 'meta', 'sommeil-bebe')).toBe(1.6);
    expect(creditOf(w, 'meta', 'potager-balcon')).toBe(1.3);
    expect(creditOf(w, 'pinterest', 'potager-balcon')).toBe(1);
    w.day = 22;
    expect(creditOf(w, 'meta', 'sommeil-bebe')).toBe(1.6); // 4 days old still counts
    w.day = 23;
    expect(creditOf(w, 'meta', 'sommeil-bebe')).toBe(1);
    w.day = 20;
    w.scenario.channelControl = 'last_click';
    expect(creditOf(w, 'meta', 'sommeil-bebe')).toBe(1);
  });

  it('a ban on Meta blocks no TikTok launch', async () => {
    const l = await lab({ startingCash: 500 });
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 10);
    addCreative(w, p);
    openUp(w, 'meta');
    Object.assign(w.market.channels!.accounts.meta, { banned: true, bannedUntilDay: w.day + 5 });
    expect(adBanActive(w, 'meta')).toBe(true);
    expect(adBanActive(w)).toBe(false);
    expect(companyPaidBlock(w, 'meta')).toMatch(/Facebook & Instagram suspendu/);
    expect(companyPaidBlock(w, 'tiktok')).toBeNull();
    expect(companyPaidBlock(w)).toBeNull(); // one account is still open
    const adam = roleHolders(w, 'media_buyer_tiktok')[0] ?? officerOf(w, 'growth');
    const task = createTask(w, { kind: 'launch_campaign', input: { productId: p.id }, assignee: adam.id });
    const outcome = await runTask(l, task, adam);
    expect(outcome.output?.campaignId).toBeTruthy();
    expect(w.company.campaigns).toHaveLength(1);
    favour(w, p.nicheId, 'meta');
    expect(of(plan(l), 'launch_campaign')).toEqual([]); // and the banned account gets no test
  });

  it('a TikTok ban leaves the other accounts alone, and blocks everything once they all are', async () => {
    const l = await lab();
    const w = l.world;
    openUp(w, 'youtube');
    Object.assign(w.market.adAccount, { banned: true, bannedUntilDay: w.day + 5 });
    expect(companyPaidBlock(w, 'tiktok')).toMatch(/TikTok suspendu/);
    expect(companyPaidBlock(w, 'youtube')).toBeNull();
    expect(companyPaidBlock(w)).toBeNull();
    Object.assign(w.market.channels!.accounts.google, { banned: true, bannedUntilDay: w.day + 5 });
    expect(adBanActive(w, 'google')).toBe(true); // one account, two channels
    expect(companyPaidBlock(w)).toMatch(/suspendu/);
  });

  it('with TikTok alone the block reads as it always did', async () => {
    const l = await lab({ ...LEGACY });
    const w = l.world;
    Object.assign(w.market.adAccount, { banned: true, bannedUntilDay: w.day + 5 });
    expect(companyPaidBlock(w)).toBe(`compte publicitaire TikTok suspendu jusqu'au jour ${w.day + 5}`);
  });

  it('a guide dead on TikTok can still get its Meta test, a hold or a loss stops every channel', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 6);
    for (let i = 0; i < 4; i++) {
      const c = addCampaign(w, p, 'tiktok', { status: 'paused', startDay: i + 1 });
      addRow(w, c, i + 1, 30, 10);
    }
    expect(adHistory(w, p.id).losers).toBe(4);
    expect(adHistory(w, p.id, 1, 'meta')).toMatchObject({ campaigns: 0, losers: 0 });
    expect(productPaidBlock(w, p)?.hard).toBe(true);
    expect(productPaidBlock(w, p, 'meta')).toBeNull();
    w.company.holds = [{ id: 'hld_1', day: 1, kind: 'ads', productId: p.id, until: null, reason: 'le fondateur a coupé ce guide' }];
    expect(productPaidBlock(w, p, 'meta')).toMatchObject({ final: true });
  });

  it('a « couper » lesson only reaches the channels that spent behind it', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 12);
    const tiktok = addCampaign(w, p, 'tiktok');
    addRow(w, tiktok, 8, 30, 10);
    w.company.lessons.push({ key: learning.LESSON_KEYS.niche(p.nicheId), id: 'les_1', day: 10, topic: 'ads', insight: 'Couper les pubs de la niche : ROAS 0,3', evidence: '', confidence: 0.8, source: 'hana', appliesTo: [], notePath: 'x.md' });
    expect(cutLesson(w, p)).not.toBeNull();
    expect(cutLesson(w, p, 'meta')).toBeNull();
    addRow(w, addCampaign(w, p, 'meta'), 9, 30, 5);
    expect(cutLesson(w, p, 'meta')).not.toBeNull();
  });

  it('a creative is launchable by the channel\'s own review, formats and fatigue', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    const master = addCreative(w, p);
    const cut = addCreative(w, p, { ratio: '4:5', masterId: master.id, review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    expect(launchableCreatives(w, p.id).map((c) => c.id)).toEqual([master.id]);
    expect(launchableCreatives(w, p.id, 'meta').map((c) => c.id)).toEqual([cut.id]);
    expect(launchableCreatives(w, p.id, 'youtube')).toEqual([]); // no verdict there
    // a master running on TikTok stays free for YouTube, and what it did on TikTok does not make it old news there
    master.channelReviews = { youtube: { status: 'approved', reason: null, day: 2 } };
    const running = addCampaign(w, p, 'tiktok', { creativeIds: [master.id] });
    addRow(w, running, 1, 10, 20, { frequency: 4 });
    w.market.creativeImpressions[master.id] = 50_000;
    expect(launchableCreatives(w, p.id)).toEqual([]);
    expect(launchableCreatives(w, p.id, 'youtube').map((c) => c.id)).toEqual([master.id]);
    // outside TikTok, frequency alone says tired: impressions are TikTok's rule
    const shown = addCampaign(w, p, 'meta', { creativeIds: [cut.id], status: 'paused' });
    addRow(w, shown, 1, 10, 20, { frequency: 1.5, impressions: 60_000, clicks: 1200 });
    expect(launchableCreatives(w, p.id, 'meta').map((c) => c.id)).toEqual([cut.id]);
    addRow(w, shown, 2, 10, 20, { frequency: 2.6, clicks: 1200 });
    expect(launchableCreatives(w, p.id, 'meta')).toEqual([]);
  });

  it('cuts do not fill TikTok\'s shelf: a guide with six of them still gets new hooks', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 3);
    const master = addCreative(w, p, { review: { status: 'rejected', reason: 'non', day: 1 } });
    for (let i = 0; i < 6; i++) addCreative(w, p, { ratio: '4:5', masterId: master.id, review: { status: 'pending', reason: null, day: null } });
    const adam = roleHolders(w, 'media_buyer_tiktok')[0] ?? officerOf(w, 'growth');
    const task = createTask(w, { kind: 'launch_campaign', input: { productId: p.id }, assignee: adam.id });
    await runTask(l, task, adam);
    expect(w.company.tasks.some((t) => t.kind === 'write_ad_hooks' && t.input.productId === p.id)).toBe(true);
  });
});

// ───────────────────────────── discovery ─────────────────────────────

describe('discovery (channels §7.2)', () => {
  /** A guide whose master waits, in a world where these channels are open. */
  async function testing(channels: ChannelId[], over: Partial<ScenarioConfig> = {}): Promise<Lab & { p: Product }> {
    const l = await lab({ startingCash: 2000, ...over });
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 10);
    openUp(w, ...channels);
    addCreative(w, p, { quality: { overall: 80 } as AdCreative['quality'] });
    addCreative(w, p, { quality: { overall: 90 } as AdCreative['quality'], format: 'text_slideshow' });
    return { ...l, p };
  }

  it('second niche of a category starts with the first one\'s best arm ahead', async () => {
    const arms = async (taught: boolean) => {
      const l = await lab();
      const w = l.world;
      openUp(w, 'pinterest', 'meta');
      if (taught) {
        for (let i = 0; i < 10; i++) {
          learning.rewardArm(w, 'channel_cat:Maison & jardin', 'pinterest', 0.9, 2);
          learning.rewardArm(w, 'channel_cat:Maison & jardin', 'meta', 0.1, 2);
        }
      }
      ensureChannelArms(l.ctx, 'relooker-meuble');
      return Object.fromEntries(w.company.bandits['channel:relooker-meuble']!.map((a) => [a.key, a]));
    };
    const blank = await arms(false);
    const taught = await arms(true);
    const mean = (a: { alpha: number; beta: number }) => a.alpha / (a.alpha + a.beta);
    // the same noisy signals on both sides: only the category moved them
    expect(taught.pinterest!.alpha - blank.pinterest!.alpha).toBeGreaterThan(2);
    expect(taught.meta!.beta - blank.meta!.beta).toBeGreaterThan(2);
    expect(mean(taught.pinterest!)).toBeGreaterThan(mean(blank.pinterest!));
    expect(mean(taught.meta!)).toBeLessThan(mean(blank.meta!));
    expect(mean(taught.pinterest!)).toBeGreaterThan(mean(taught.meta!));
    expect(taught.pinterest!.pulls).toBe(0);
  });

  it('the prior weighs at most categoryPriorMax, and arms are built once', async () => {
    const l = await lab();
    const w = l.world;
    openUp(w, 'meta');
    for (let i = 0; i < 40; i++) learning.rewardArm(w, 'channel_cat:Parentalité', 'meta', 1, 1);
    ensureChannelArms(l.ctx, 'sommeil-bebe');
    const arm = w.company.bandits['channel:sommeil-bebe']!.find((a) => a.key === 'meta')!;
    expect(arm.alpha + arm.beta).toBeCloseTo(3 + CHANNEL_POLICY.categoryPriorMax, 1);
    const before = { ...arm };
    learning.rewardArm(w, 'channel_cat:Parentalité', 'meta', 0, 3);
    ensureChannelArms(l.ctx, 'sommeil-bebe');
    expect(w.company.bandits['channel:sommeil-bebe']!.find((a) => a.key === 'meta')).toEqual(before);
  });

  it('the bandit may stay on TikTok: then nothing is tested and nothing is launched', async () => {
    const l = await testing(['meta']);
    const { world: w, p } = l;
    favour(w, p.nicheId, 'tiktok');
    const items = plan(l);
    expect(of(items, 'adapt_creative')).toEqual([]);
    expect(of(items, 'launch_campaign')).toEqual([]);
  });

  it('a guide TikTok has closed has no arm to stay on: its paid test can only run elsewhere', async () => {
    const closedOnTikTok = async (over: Partial<ScenarioConfig>) => {
      const l = await testing(['meta'], over);
      const { world: w, p } = l;
      favour(w, p.nicheId, 'tiktok');
      w.company.lessons.push({ key: learning.LESSON_KEYS.niche(p.nicheId), insight: 'Couper les pubs de la niche : elles perdent.', day: w.day } as Lesson);
      expect(productPaidBlock(w, p)?.hard).toBe(true);
      expect(productPaidBlock(w, p, 'meta')?.hard).toBeFalsy();
      return of(plan(l), 'adapt_creative').map((i) => i.input.channel);
    };
    expect(await closedOnTikTok({})).toEqual(['meta', 'meta']);
    expect(await closedOnTikTok({ scaling: false })).toEqual([]); // the control keeps its old draw
  });

  it('the Monday queue goes first: one test left goes to the guide waiting for its paid test, not to one that only keeps', async () => {
    const l = await testing(['meta'], { startingCash: 500 });
    const { world: w, p: keep } = l;
    const wait = addProduct(w, 'potager-balcon', 'prd_2');
    for (const x of [keep, wait]) {
      addCreative(w, x, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
      favour(w, x.nicheId, 'meta');
    }
    const launched = () => of(plan(l), 'launch_campaign').map((i) => i.input.productId);
    expect(launched()).toEqual([keep.id]); // no review yet: the score, then the id
    const line = (productId: string, verdict: PortfolioVerdict) => ({ productId, verdict }) as PortfolioLine;
    w.company.growth!.portfolio = { day: w.day, week: 2, lines: [line(keep.id, 'keep'), line(wait.id, 'test')], slots: { used: 2, max: 3 }, notes: [] };
    expect(launched()).toEqual([wait.id]);
  });

  it('a Privilégier lesson weighs one alpha while it stands, and writes nothing to the arm', async () => {
    const l = await testing(['meta']);
    const { world: w, p } = l;
    w.company.bandits[`channel:${p.nicheId}`] = [
      { key: 'meta', alpha: 0.01, beta: 1, pulls: 0, reward: 0 }, // next to nothing: one alpha more is all that can bring it back
      { key: 'tiktok', alpha: 1, beta: 30, pulls: 0, reward: 0 },
    ];
    const picks = () => Array.from({ length: 40 }, () => of(plan(l), 'adapt_creative').length > 0).filter(Boolean).length;
    const arms = JSON.stringify(w.company.bandits[`channel:${p.nicheId}`]);
    expect(picks()).toBeLessThan(4);
    w.company.playbooks[officerOf(w, 'growth').id] = [`Privilégier le canal « meta » sur « ${w.market.niches.find((n) => n.id === p.nicheId)!.name} »`];
    expect(picks()).toBeGreaterThan(20);
    expect(JSON.stringify(w.company.bandits[`channel:${p.nicheId}`])).toBe(arms);
  });

  it('a test asks for two cuts of the best masters first, then launches once one came back', async () => {
    const l = await testing(['meta']);
    const { world: w, p } = l;
    favour(w, p.nicheId, 'meta');
    const asked = plan(l);
    expect(of(asked, 'launch_campaign')).toEqual([]);
    const cuts = of(asked, 'adapt_creative');
    expect(cuts.map((i) => i.input.slot)).toEqual([0, 1]);
    expect(cuts[0]).toMatchObject({ input: { productId: p.id, channel: 'meta', ratio: '4:5', masterId: 'cre_2' } });
    addCreative(w, p, { ratio: '4:5', masterId: 'cre_2', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: w.day } } });
    const launch = of(plan(l), 'launch_campaign');
    expect(launch).toHaveLength(1);
    expect(launch[0]).toMatchObject({ input: { productId: p.id, channel: 'meta', test: true } });
  });

  it('Pinterest asks for images, Search for text, YouTube reuses the master at once', async () => {
    const pin = await testing(['pinterest']);
    favour(pin.world, pin.p.nicheId, 'pinterest');
    expect(of(plan(pin), 'adapt_creative')[0]).toMatchObject({ input: { channel: 'pinterest', ratio: '2:3' } });

    const search = await testing(['google']);
    favour(search.world, search.p.nicheId, 'google');
    expect(of(plan(search), 'write_search_ads')[0]).toMatchObject({ input: { productId: search.p.id, channel: 'google' } });

    const yt = await testing(['youtube']);
    favour(yt.world, yt.p.nicheId, 'youtube');
    const items = plan(yt);
    expect(of(items, 'adapt_creative')).toEqual([]);
    expect(yt.world.company.creatives.filter((c) => c.channelReviews?.youtube?.status === 'approved')).toHaveLength(2);
    expect(of(items, 'launch_campaign')[0]).toMatchObject({ input: { channel: 'youtube', test: true } });
  });

  it('tests stop at the envelope and at maxTests', async () => {
    const small = await testing(['meta', 'pinterest'], { startingCash: 500 });
    const w = small.world;
    const other = addProduct(w, 'potager-balcon', 'prd_2');
    addCreative(w, other);
    addCreative(w, small.p, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    addCreative(w, other, { format: 'static_image', ratio: '2:3', review: { status: 'pending', reason: null, day: null }, channelReviews: { pinterest: { status: 'approved', reason: null, day: 2 } } });
    favour(w, small.p.nicheId, 'meta');
    favour(w, other.nicheId, 'pinterest');
    const envelope = currentBudget(w).adCap * CHANNEL_POLICY.testShare;
    expect(envelope).toBeGreaterThanOrEqual(dailyTest('meta')); // one test fits,
    expect(envelope).toBeLessThan(dailyTest('meta') + dailyTest('pinterest')); // the second one does not
    expect(of(plan(small), 'launch_campaign')).toHaveLength(1);

    const rich = await lab({ startingCash: 20000 });
    closeDays(rich.world, 10);
    openUp(rich.world, 'meta');
    const niches = ['sommeil-bebe', 'potager-balcon', 'proprete-chiot', 'relooker-meuble'];
    for (const [i, nicheId] of niches.entries()) {
      const p = addProduct(rich.world, nicheId, `prd_${i + 1}`);
      addCreative(rich.world, p, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
      favour(rich.world, nicheId, 'meta');
    }
    expect(of(plan(rich), 'launch_campaign')).toHaveLength(CHANNEL_POLICY.maxTests);
  });

  it('a line already testing, proven, blocked or killed takes no new test, until a killed one reopens', async () => {
    const l = await testing(['meta']);
    const { world: w, p } = l;
    addCreative(w, p, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    favour(w, p.nicheId, 'meta');
    const line = lineOf(w, 'meta', p.nicheId);
    const launches = () => of(plan(l), 'launch_campaign').length;
    expect(launches()).toBe(1);
    const running = addCampaign(w, p, 'meta', { test: true, creativeIds: [] });
    expect(launches()).toBe(0);
    running.status = 'paused';
    expect(launches()).toBe(1); // the stop-loss paused it: the test goes on with what is left
    Object.assign(line, { status: 'blocked', reason: 'refusé deux fois' });
    expect(launches()).toBe(0);
    Object.assign(line, { status: 'killed', since: w.day - 1, retestDay: w.day + 5 });
    expect(launches()).toBe(0);
    p.priceHistory = [{ day: 1, price: 19 }];
    w.company.tasks.push({ ...createTask(w, { kind: 'publish_product', input: { productId: p.id, republish: true } }), status: 'done', dayDone: w.day });
    expect(launches()).toBe(1); // a new version of the guide clears it
    w.company.tasks.splice(-2, 2);
    expect(launches()).toBe(0);
    w.day += 5;
    expect(launches()).toBe(1);
  });

  it('a category doing well on the channel clears a killed line early', async () => {
    const l = await testing(['meta']);
    const { world: w, p } = l;
    addCreative(w, p, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    favour(w, p.nicheId, 'meta');
    Object.assign(lineOf(w, 'meta', p.nicheId), { status: 'killed', retestDay: w.day + 5 });
    expect(of(plan(l), 'launch_campaign')).toEqual([]);
    for (let i = 0; i < 5; i++) learning.rewardArm(w, 'channel_cat:Parentalité', 'meta', 0.9, 1);
    expect(of(plan(l), 'launch_campaign')).toHaveLength(1);
  });

  it('a tired campaign asks a cut of the newest master, and a proven line comes back without the bandit', async () => {
    const l = await testing(['meta']);
    const { world: w, p } = l;
    const cut = addCreative(w, p, { ratio: '4:5', masterId: 'cre_1', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    const campaign = addCampaign(w, p, 'meta', { creativeIds: [cut.id] });
    Object.assign(lineOf(w, 'meta', p.nicheId), { status: 'proven' });
    addRow(w, campaign, 9, 20, 40, { frequency: 2.6 });
    const asked = of(plan(l), 'adapt_creative');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ input: { channel: 'meta', masterId: 'cre_2', attachTo: campaign.id } });

    campaign.status = 'paused';
    w.company.bandits[`channel:${p.nicheId}`] = [];
    addCreative(w, p, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    const back = of(plan(l), 'launch_campaign');
    expect(back).toHaveLength(1);
    expect(back[0]!.input).toMatchObject({ channel: 'meta' });
    expect(back[0]!.input.test).toBeUndefined();
  });

  it('rewards of the day feed the niche and, at half weight, the category, with the credit, from 2 channels on', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 5);
    const meta = addCampaign(w, p, 'meta');
    addRow(w, meta, w.day, 20, 30);
    await channelsPillar.evening!(l.ctx);
    expect(w.company.bandits[`channel:${p.nicheId}`]).toBeUndefined(); // one channel open: nothing to learn
    openUp(w, 'meta');
    book(w).attribution = { day: w.day, fromDay: 1, toDay: 5, by: 'raphael', rows: [], niches: { [p.nicheId]: { meta: 2 } } };
    await channelsPillar.evening!(l.ctx);
    const arm = w.company.bandits[`channel:${p.nicheId}`]!.find((a) => a.key === 'meta')!;
    expect(arm.pulls).toBe(1);
    expect(arm.reward).toBeCloseTo(1); // ROAS 1,5 × credit 2 / 3
    const category = w.company.bandits['channel_cat:Parentalité']!.find((a) => a.key === 'meta')!;
    expect(category.alpha - 1).toBeCloseTo(0.5);
    addRow(w, meta, w.day, 2, 30); // under the 3 € floor once alone
    w.market.adStats.splice(-2, 1);
    await channelsPillar.evening!(l.ctx);
    expect(w.company.bandits[`channel:${p.nicheId}`]!.find((a) => a.key === 'meta')!.pulls).toBe(1);
  });
});

// ───────────────────────────── verdicts ─────────────────────────────

describe('line verdicts and kills (channels §7.2, §7.3)', () => {
  /** A Meta test that has run `days`, every euro of `spend` and `revenue` on one row. */
  async function verdict(spend: number, revenue: number, days = CHANNELS.meta.testDays): Promise<Lab & { p: Product; campaign: Campaign }> {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta');
    const campaign = addCampaign(w, p, 'meta', { test: true, startDay: w.day - days });
    addRow(w, campaign, w.day - days, spend, revenue);
    settleLines(l.ctx);
    return { ...l, p, campaign };
  }

  it('a test proves itself after testDays and 3 × stopLossSpend, and enters the allocator', async () => {
    const { world: w, p, campaign } = await verdict(140, 160);
    expect(lineOf(w, 'meta', p.nicheId)).toMatchObject({ status: 'proven', spend: 140, revenue: 160, retestDay: null });
    expect(campaign.test).toBeUndefined();
  });

  it('no verdict before the sample, on time or on money', async () => {
    const short = await verdict(140, 160, CHANNELS.meta.testDays - 1);
    expect(lineOf(short.world, 'meta', short.p.nicheId).status).toBe('testing');
    const thin = await verdict(CHANNEL_POLICY.prove.spendTimes * 45 - 1, 160);
    expect(lineOf(thin.world, 'meta', thin.p.nicheId).status).toBe('testing');
    expect(thin.campaign.test).toBe(true);
  });

  it('under 0,8 the line dies, its campaigns stop and a retest day is set', async () => {
    const { world: w, p, campaign } = await verdict(140, 70);
    const line = lineOf(w, 'meta', p.nicheId);
    expect(line).toMatchObject({ status: 'killed', retestDay: w.day + CHANNEL_POLICY.retestDays });
    expect(line.reason).toMatch(/ROAS réconcilié 0,50/);
    expect(campaign.status).toBe('paused');
  });

  it('between the two: one extension, then it stays above 1,0 or dies', async () => {
    const first = await verdict(140, 133);
    expect(lineOf(first.world, 'meta', first.p.nicheId).status).toBe('testing');
    const kept = await verdict(280, 290, 2 * CHANNELS.meta.testDays);
    expect(lineOf(kept.world, 'meta', kept.p.nicheId).status).toBe('proven');
    const lost = await verdict(280, 266, 2 * CHANNELS.meta.testDays);
    expect(lineOf(lost.world, 'meta', lost.p.nicheId).status).toBe('killed');
  });

  it('verdicts read the reconciled credit, not the shop alone', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta');
    book(w).attribution = { day: w.day, fromDay: 1, toDay: 30, by: 'raphael', rows: [], niches: { [p.nicheId]: { meta: 1.5 } } };
    const campaign = addCampaign(w, p, 'meta', { test: true, startDay: w.day - 6 });
    addRow(w, campaign, w.day - 6, 140, 112); // 0,8 at the shop, 1,2 reconciled
    settleLines(l.ctx);
    expect(lineOf(w, 'meta', p.nicheId)).toMatchObject({ status: 'proven', revenue: 168 });
  });

  it('a retest starts its count from zero', async () => {
    const { world: w, p, ctx } = await verdict(140, 70);
    const again = addCampaign(w, p, 'meta', { test: true, startDay: w.day });
    settleLines(ctx);
    expect(lineOf(w, 'meta', p.nicheId)).toMatchObject({ status: 'testing', since: w.day, spend: 0, revenue: 0, retestDay: null, reason: null });
    expect(again.status).toBe('active');
  });

  it('line kill: 2 stopped campaigns under ROAS 1, on a real sample', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta');
    const line = Object.assign(lineOf(w, 'meta', p.nicheId), { status: 'proven', since: 5 });
    const a = addCampaign(w, p, 'meta', { status: 'paused', startDay: 6 });
    addRow(w, a, 7, 80, 40);
    settleLines(l.ctx);
    expect(line.status).toBe('proven'); // one bad campaign is a bad angle
    const b = addCampaign(w, p, 'meta', { status: 'paused', startDay: 9 });
    addRow(w, b, 10, 80, 40);
    const outage = addCampaign(w, p, 'meta', { status: 'paused', pausedFor: 'outage', startDay: 9 });
    addRow(w, outage, 11, 80, 0);
    settleLines(l.ctx);
    expect(line.status).toBe('killed');
    expect(line.reason).toMatch(/2 campagnes arrêtées/); // a campaign on a day off for an outage is no loser
  });

  it('channel kill: company-wide losses pause everything there, no test for 14 days, then it comes back', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta', 'pinterest');
    const meta = addCampaign(w, p, 'meta');
    const pin = addCampaign(w, p, 'pinterest');
    const tiktok = addCampaign(w, p, 'tiktok');
    addRow(w, meta, 25, 150, 90);
    addRow(w, pin, 25, 150, 300);
    addRow(w, tiktok, 25, 150, 30);
    await channelsPillar.morning!(l.ctx);
    expect(meta.status).toBe('paused');
    expect(pin.status).toBe('active');
    expect(tiktok.status).toBe('active'); // TikTok has its own brakes
    expect(openChannels(w)).toEqual(['tiktok', 'pinterest']);
    expect(channelPaused(w, 'meta')).toBe(true);
    favour(w, p.nicheId, 'pinterest');
    expect(of(plan(l), 'open_channel').map((i) => i.input.channel)).not.toContain('meta');
    closeDays(w, w.day + CHANNEL_POLICY.channelKill.reopenDays - 1);
    await channelsPillar.morning!(l.ctx);
    expect(openChannels(w)).toContain('meta');
    expect(channelPaused(w, 'meta')).toBe(false);
  });

  /** A proven line of Meta, sold through two approved cuts, and a morning that kills the channel. */
  async function killedChannel(): Promise<Lab & { p: Product; meta: Campaign }> {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta', 'pinterest');
    const approved = () => addCreative(w, p, { ratio: '4:5', masterId: 'cre_1', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    const meta = addCampaign(w, p, 'meta', { creativeIds: [approved().id], startDay: 22 });
    approved();
    Object.assign(lineOf(w, 'meta', p.nicheId), { status: 'proven', since: 20 });
    addRow(w, meta, 25, 160, 80);
    await channelsPillar.morning!(l.ctx);
    return { ...l, p, meta };
  }

  it('a paused channel takes no campaign: not from its proven lines, not from a task already queued, until it comes back', async () => {
    const l = await killedChannel();
    const { world: w, p } = l;
    expect(channelPaused(w, 'meta')).toBe(true);
    expect(companyPaidBlock(w, 'meta')).toMatch(/Facebook & Instagram en pause/);
    expect(companyPaidBlock(w, 'tiktok')).toBeNull();
    expect(plan(l).filter((i) => i.input.channel === 'meta')).toEqual([]);
    const buyer = await hire(l, 'media_buyer_meta');
    const queued = createTask(w, { kind: 'launch_campaign', input: { productId: p.id, channel: 'meta' }, assignee: buyer.id });
    expect((await runTask(l, queued, buyer)).output).toMatchObject({ skipped: true, reason: 'company' });
    queued.status = 'done';
    expect(w.company.campaigns.filter((c) => c.channel === 'meta' && c.status === 'active')).toEqual([]);
    closeDays(w, w.day + CHANNEL_POLICY.channelKill.reopenDays - 1);
    await channelsPillar.morning!(l.ctx);
    expect(of(plan(l), 'launch_campaign').map((i) => i.input.channel)).toContain('meta');
  });

  it('a kill outlives the day off of a campaign: the outage ends, nothing resumes it', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    const other = addProduct(w, 'ventre-apres-40', 'prd_2');
    closeDays(w, 30);
    openUp(w, 'meta', 'pinterest');
    const channel = addCampaign(w, p, 'meta', { status: 'paused', pausedFor: 'outage', startDay: 22 });
    addRow(w, channel, 25, 160, 80);
    await channelsPillar.morning!(l.ctx);
    expect(channelPaused(w, 'meta')).toBe(true);

    const line = Object.assign(lineOf(w, 'pinterest', other.nicheId), { status: 'testing', since: 16 });
    const inLine = addCampaign(w, other, 'pinterest', { status: 'paused', pausedFor: 'outage', startDay: 16, test: true });
    addRow(w, inLine, 20, 100, 10);
    settleLines(l.ctx);
    expect(line.status).toBe('killed');

    const { resumed } = resumeCampaigns(l.ctx, 'outage');
    expect(resumed).toEqual([]);
    expect([channel.status, inLine.status]).toEqual(['paused', 'paused']);
    expect([channel.pausedFor, inLine.pausedFor]).toEqual([undefined, undefined]);
  });

  it('a resume reads the channel: what was off when it paused stays off', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta');
    const off = addCampaign(w, p, 'meta', { status: 'paused', pausedFor: 'founder' });
    book(w).open = ['tiktok'];
    book(w).requested.meta = w.day + 3;
    expect(resumeCampaigns(l.ctx, 'founder')).toEqual({ resumed: [], left: [off.name] });
    expect(off.status).toBe('paused');
  });

  it('under the sample nothing is killed, however bad the ROAS', async () => {
    const l = await lab();
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 30);
    openUp(w, 'meta');
    const meta = addCampaign(w, p, 'meta');
    addRow(w, meta, 25, CHANNEL_POLICY.channelKill.spend - 1, 10);
    await channelsPillar.morning!(l.ctx);
    expect(meta.status).toBe('active');
    expect(openChannels(w)).toContain('meta');
  });
});

// ───────────────────────────── creatives ─────────────────────────────

describe('creatives for a channel (channels §7.5)', () => {
  async function studio(channels: ChannelId[], nicheId = 'sommeil-bebe'): Promise<Lab & { p: Product; master: AdCreative; agent: AgentState }> {
    const l = await lab();
    const w = l.world;
    closeDays(w, 3);
    const p = addProduct(w, nicheId);
    openUp(w, ...channels);
    return { ...l, p, master: addCreative(w, p), agent: officerOf(w, 'growth') };
  }

  it('a Meta cut keeps the script, gets its ratio, a new id and its own frames, and lands on Meta alone', async () => {
    const l = await studio(['meta']);
    const { world: w, p, master, agent } = l;
    const before = master.review.status;
    const task = createTask(w, { kind: 'adapt_creative', input: { productId: p.id, channel: 'meta', masterId: master.id, ratio: '4:5' }, assignee: agent.id });
    const outcome = await runTask(l, task, agent);
    const cut = w.company.creatives.find((c) => c.id === task.output!.creativeId)!;
    expect(cut.id).not.toBe(master.id);
    expect(cut).toMatchObject({ masterId: master.id, ratio: '4:5', hook: master.hook, format: master.format, scenes: master.scenes, files: { storyboard: [`files/${p.id}/ads/${cut.id}/frame-1.svg`], preview: null } });
    expect(cut.quality?.overall).toBeGreaterThan(0);
    expect(outcome.summary).toMatch(/Facebook & Instagram/);
    expect(cut.channelReviews?.meta?.status).toBe('approved');
    expect(cut.review.status).toBe('pending');
    expect(master.review.status).toBe(before);
    expect(launchableCreatives(w, p.id, 'meta').map((c) => c.id)).toEqual([cut.id]);
    expect(launchableCreatives(w, p.id).map((c) => c.id)).toEqual([master.id]);
  });

  it('a rework overwrites its creative, and a landed cut joins the tired campaign', async () => {
    const l = await studio(['meta']);
    const { world: w, p, master, agent } = l;
    const campaign = addCampaign(w, p, 'meta', { creativeIds: [] });
    const task = createTask(w, { kind: 'adapt_creative', input: { productId: p.id, channel: 'meta', masterId: master.id, ratio: '4:5', attachTo: campaign.id }, assignee: agent.id });
    await runTask(l, task, agent);
    const n = w.company.creatives.length;
    await HANDLERS.adapt_creative.run(l.ctx, task, agent, mindOf(l, agent));
    expect(w.company.creatives).toHaveLength(n);
    expect(campaign.creativeIds).toEqual([task.output!.creativeId]);
  });

  it('a Pinterest pin is one image in 2:3, and writes no video', async () => {
    const l = await studio(['pinterest']);
    const { world: w, p, master, agent } = l;
    const task = createTask(w, { kind: 'adapt_creative', input: { productId: p.id, channel: 'pinterest', masterId: master.id, ratio: '2:3' }, assignee: agent.id });
    await runTask(l, task, agent);
    const pin = w.company.creatives.find((c) => c.id === task.output!.creativeId)!;
    expect(pin).toMatchObject({ format: 'static_image', ratio: '2:3', masterId: master.id });
    expect(pin.scenes).toHaveLength(1);
    expect(pin.channelReviews?.pinterest?.status).toBe('approved');
  });

  it('Search ads are stored as a creative of text, and nothing is written with no product', async () => {
    const l = await studio(['google']);
    const { world: w, p, agent } = l;
    const task = createTask(w, { kind: 'write_search_ads', input: { productId: p.id, channel: 'google' }, assignee: agent.id });
    await runTask(l, task, agent);
    const ad = w.company.creatives.find((c) => c.id === task.output!.creativeId)!;
    expect(ad).toMatchObject({ format: 'search_text', ratio: 'text', scenes: [] });
    expect(ad.search!.headlines.length).toBeGreaterThanOrEqual(3);
    expect(ad.hook).toBe(ad.search!.headlines[0]);
    expect(ad.caption).toBe(ad.search!.descriptions[0]);
    expect(ad.hashtags).toEqual(ad.search!.keywords);
    expect(ad.channelReviews?.google?.status).toBeDefined();
    const lost = createTask(w, { kind: 'write_search_ads', input: { productId: 'nope', channel: 'google' }, assignee: agent.id });
    expect((await HANDLERS.write_search_ads.run(l.ctx, lost, agent, mindOf(l, agent))).skipReview).toBe(true);
  });

  it('2 rule rejections stop a line: no more submissions, the word goes to the writers, no euro spent', async () => {
    const l = await studio(['meta'], 'ventre-apres-40');
    const { world: w, p } = l;
    const writer = roleHolders(w, 'hook_writer')[0] ?? officerOf(w, 'growth');
    const bad = (i: number) => addCreative(w, p, { hook: `Ce ventre qui ne part plus, épisode ${i}`, ratio: '4:5', masterId: 'cre_1', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'pending', reason: null, day: null } } });
    expect(submitToChannel(l.ctx, bad(1), p, 'meta')).toMatchObject({ status: 'rejected', rule: 'meta.image_du_corps', strike: true });
    expect(lineOf(w, 'meta', p.nicheId).status).toBe('untested');
    expect((w.company.playbooks[writer.id] ?? []).some((r) => /Sur Facebook & Instagram, ne jamais écrire « ventre »/.test(r))).toBe(true);
    submitToChannel(l.ctx, bad(2), p, 'meta');
    const line = lineOf(w, 'meta', p.nicheId);
    expect(line.status).toBe('blocked');
    expect(line.reason).toMatch(/ventre/);
    addCreative(w, p, { ratio: '4:5', review: { status: 'pending', reason: null, day: null }, channelReviews: { meta: { status: 'approved', reason: null, day: 2 } } });
    favour(w, p.nicheId, 'meta');
    const items = plan(l);
    expect(of(items, 'launch_campaign')).toEqual([]);
    expect(of(items, 'adapt_creative')).toEqual([]);
    expect(w.market.adStats).toEqual([]);
  });

  it('drafts our own review keeps dropping stop the orders for a while, then the writers get one more try', async () => {
    const l = await lab({ startingCash: 2000 });
    const w = l.world;
    const p = addProduct(w, 'sommeil-bebe');
    closeDays(w, 10);
    openUp(w, 'google', 'pinterest');
    addCreative(w, p, { quality: { overall: 80 } as AdCreative['quality'] });
    addCreative(w, p, { quality: { overall: 90 } as AdCreative['quality'], format: 'text_slideshow' });
    const search = (status: 'approved' | 'rejected', reason: string | null, day: number) => addCreative(w, p, { format: 'search_text', ratio: 'text', review: { status: 'pending', reason: null, day: null }, channelReviews: { google: { status, reason, day } } });
    const drop = (day: number) => search('rejected', `${DROPPED_REASON} : Pas d'appel à l'action dans les descriptions (« télécharge le guide »).`, day);
    const orders = (ch: ChannelId, kind: Task['kind']) => { favour(w, p.nicheId, ch); return of(plan(l), kind).length; };

    expect(orders('google', 'write_search_ads')).toBe(1);
    drop(w.day - 1);
    expect(orders('google', 'write_search_ads')).toBe(1); // one weak draft is one weak draft
    drop(w.day);
    expect(orders('google', 'write_search_ads')).toBe(0);
    expect(orders('pinterest', 'adapt_creative')).toBe(2); // this channel's writers, this channel's streak
    expect(lineOf(w, 'google', p.nicheId).status).toBe('untested'); // a drop is no platform's verdict: the line stays open

    const last = w.day;
    closeDays(w, last + CHANNEL_POLICY.retestDays - 2);
    expect(w.day - last).toBe(CHANNEL_POLICY.retestDays - 1);
    expect(orders('google', 'write_search_ads')).toBe(0);
    closeDays(w, last + CHANNEL_POLICY.retestDays - 1);
    expect(orders('google', 'write_search_ads')).toBe(1);

    drop(w.day);
    expect(orders('google', 'write_search_ads')).toBe(0); // the next try fails as well: back to waiting
    closeDays(w, w.day);
    search('rejected', 'Google Search refuse cette annonce.', w.day);
    drop(w.day);
    expect(orders('google', 'write_search_ads')).toBe(1); // that one passed our review: the streak is over
  });

  it('a false positive does not block a line', async () => {
    const l = await studio(['meta']);
    const { world: w, p, master } = l;
    Object.assign(master, { review: { status: 'pending', reason: null, day: null } });
    w.company.creatives.push({ ...master, id: 'cre_x', channelReviews: { meta: { status: 'rejected', reason: 'modération', day: 2 } } });
    w.company.creatives.push({ ...master, id: 'cre_y', channelReviews: { meta: { status: 'rejected', reason: 'modération', day: 2 } } });
    const res = submitToChannel(l.ctx, addCreative(w, p), p, 'meta');
    expect(res.rule).toBeUndefined();
    expect(w.company.channels!.lines.filter((x) => x.status === 'blocked')).toEqual([]);
  });
});

// ───────────────────────────── attribution ─────────────────────────────

describe('reconcile_channels (channels §5.2)', () => {
  function order(w: WorldState, p: Product, c: Campaign, price: number): void {
    w.market.orders.push({ id: `ord_${w.market.orders.length + 1}`, day: 8, customerId: 'c', productId: p.id, price, source: 'ads', campaignId: c.id, creatorId: null, refunded: false, chargeback: false, ...(c.channel ? { channel: c.channel } : {}) } as Order);
  }

  it('the analyst reads the two reports, keeps the shop\'s total, writes a note, and credits start to count', async () => {
    const l = await lab();
    const w = l.world;
    closeDays(w, 9);
    openUp(w, 'meta');
    const p = addProduct(w, 'sommeil-bebe');
    const tiktok = addCampaign(w, p, 'tiktok');
    const meta = addCampaign(w, p, 'meta');
    addRow(w, tiktok, 8, 50, 100);
    addRow(w, meta, 8, 50, 60, { claimedRevenue: 120 });
    order(w, p, tiktok, 100);
    order(w, p, meta, 60);
    expect(of(plan(l), 'reconcile_channels')).toHaveLength(1);
    const analyst = officerOf(w, 'cfo');
    const task = createTask(w, { kind: 'reconcile_channels', input: {}, assignee: analyst.id });
    const outcome = await runTask(l, task, analyst);
    const report = book(w).attribution!;
    expect(report).toMatchObject({ day: w.day, fromDay: 1, toDay: 9, by: analyst.id });
    expect(report.rows.reduce((s, r) => s + r.reconciledRevenue, 0)).toBeCloseTo(160);
    expect(report.rows.find((r) => r.channel === 'meta')!.credit).toBeGreaterThan(1);
    expect(report.rows.find((r) => r.channel === 'tiktok')!.credit).toBeLessThan(1);
    expect(report.niches[p.nicheId]).toBeDefined();
    expect(creditOf(w, 'meta', p.nicheId)).toBe(report.niches[p.nicheId]!.meta);
    expect(outcome.summary).toMatch(/Facebook & Instagram s'attribue 2,0 fois/);
    expect((await l.ctx.brain.read('rapports/attribution-canaux.md'))?.body).toMatch(/Facebook & Instagram s'attribue 2,0 fois/);
  });

  it('with one channel in a week there is nothing to reconcile, and a small niche keeps the channel\'s credit', async () => {
    const l = await lab();
    const w = l.world;
    closeDays(w, 9);
    openUp(w, 'meta');
    const p = addProduct(w, 'sommeil-bebe');
    const meta = addCampaign(w, p, 'meta');
    addRow(w, meta, 8, 50, 20);
    order(w, p, meta, 20);
    expect(of(plan(l), 'reconcile_channels')).toEqual([]);
    const analyst = officerOf(w, 'cfo');
    await runTask(l, createTask(w, { kind: 'reconcile_channels', input: {}, assignee: analyst.id }), analyst);
    expect(book(w).attribution!.niches).toEqual({}); // 20 € of sales: under the 30 € a credit needs
  });
});

// ───────────────────────────── the real company ─────────────────────────────

describe('the real company', () => {
  it('opens a channel through a hire, plans one optimize_ads per channel, and its money stays in the ledger', async () => {
    const l = await lab({ startingCash: 500, difficulty: 'normal', horizonDays: 60 });
    const w = l.world;
    await l.company.runDays(26);
    const { positions } = w.company.org!;
    expect(positions.some((p) => p.reason === 'channel' && p.status === 'filled')).toBe(true);
    expect(multiChannel(w)).toBe(true);
    expect(w.market.events.some((e) => e.kind === 'channel_opened')).toBe(true);
    const buying = w.company.tasks.filter((t) => t.kind === 'optimize_ads' && typeof t.input.channel === 'string').map((t) => t.input.channel);
    expect(new Set(buying).size).toBeGreaterThanOrEqual(1);
    expect(w.ledger.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(sim.financeSnapshot(w).cash, 1);
  }, 120_000);
});
