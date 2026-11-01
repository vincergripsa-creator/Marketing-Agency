/**
 * The market behind the channels (channels §3, §4.1, §11 sim rows on identity, pools, learning, Search, tail, assist).
 * Sim level: no company, campaigns are written by hand so nothing here waits for the tools or the allocator.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildSnapshot } from '../src/api/trim.js';
import { createRng, streamRng } from '../src/core/index.js';
import type { MarketTools, Rng } from '../src/contracts.js';
import { CHANNELS } from '../src/shared.js';
import type {
  AdCreative, AdFormat, AdRatio, Campaign, ChannelControl, ChannelId, DailyAdStats, HookStyle, NicheTruth, PdfContent, Product, SalesPage, ScenarioConfig, WorldState,
} from '../src/shared.js';
import { virtualAdapter } from '../src/sim/adapters.js';
import { ADS, CONVERSION, REVIEWS } from '../src/sim/balance.js';
import { nichePool, poolSaturation } from '../src/sim/capacity.js';
import { ASSIST, CHANNEL_FIT, CHANNEL_SIM, CHANNEL_VARIATION, FAMILY_FATIGUE, FORMAT_FIT, LEARNING, PAID_TAIL } from '../src/sim/channelBalance.js';
import {
  accountBanned, cellOf, channelSignals, deliverySpec, ensureChannelMarket, familyPrior, inLearning, reachOf, rollChannelEvents, updateWarmth, warmth,
} from '../src/sim/channels.js';
import { createMarketState, createMarketTools, financeSnapshot, findNiche, recordLedger, tickMarket } from '../src/sim/index.js';
import { fmtNum } from '../src/sim/text.js';

// ───────────────────────────── fixtures ─────────────────────────────

const CASH = 500_000;

function makeWorld(seed: number, channelControl: ChannelControl = 'none', cash = CASH): WorldState {
  const scenario: ScenarioConfig = {
    name: 'test', companyName: 'Pixel Agency', seed, startingCash: cash, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic',
    founderApproval: false, chargeCompute: false, maxComputeEur: 0, goal: { targetProfit: 1000, byDay: 60 }, channelControl,
  };
  const world: WorldState = {
    version: 2, runId: 'test', createdAt: '2026-01-01T00:00:00.000Z', scenario, day: 1, tick: 10, phase: 'market', rngState: 0, idCounter: 0,
    mind: { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    status: 'running',
    company: {
      name: 'Pixel Agency', agents: [], departments: [], tasks: [], missions: [], products: [], creatives: [], campaigns: [], deliverables: [],
      research: { trends: [], voc: {}, competitors: {}, shortlist: [] }, lessons: [], experiments: [], bandits: {}, playbooks: {}, kpis: [],
      chats: {}, pendingApprovals: [],
    },
    market: createMarketState(scenario, createRng(seed)),
    ledger: [], activity: [],
  };
  recordLedger(world, { type: 'capital', amount: cash, memo: 'Capital de départ' });
  return world;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const at = <T,>(xs: readonly T[], i: number): T => xs[i % xs.length]!;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function goodContent(n: NicheTruth): PdfContent {
  const k = n.voc.knowledge;
  return {
    title: `${n.name} : la méthode en 6 étapes`, subtitle: lower(n.problem), audience: n.audience, promise: `En 14 jours, ${lower(at(n.voc.desiredOutcomes, 0))}.`,
    introduction: [`Vous êtes ${lower(n.audience)} : « ${at(n.voc.phrases, 0)} ».`],
    chapters: Array.from({ length: 6 }, (_, i) => ({
      title: `Étape ${i + 1} : ${at(k.steps, i).replace(/\.$/, '')}`, intro: lower(at(n.voc.pains, i)),
      paragraphs: [at(k.tips, i * 2), at(k.tips, i * 2 + 1), at(k.facts, i), `Prévoyez 15 minutes par jour pendant 7 jours. ${at(k.mistakes, i)}`],
      steps: [at(k.steps, i), at(k.steps, i + 1), at(k.tips, i + 3)], example: at(k.examples, i),
      checklist: [`J'ai appliqué l'étape ${i + 1}`, 'J\'ai noté mes observations'], visual: null,
    })),
    bonus: { title: 'Bonus', intro: 'Un récapitulatif.', paragraphs: [k.tips.slice(0, 3).join(' ')], steps: k.steps.slice(0, 4), example: null, checklist: k.tips.slice(3, 7), visual: null },
    nextStep: { title: 'La suite', text: 'Le guide suivant vous accompagne.', upsellProductId: null }, wordCount: 0,
  };
}

function goodSalesPage(n: NicheTruth, c: PdfContent): SalesPage {
  return {
    headline: `${n.name} : la méthode en 6 étapes pour ${lower(n.audience)}`, subheadline: `Des étapes concrètes pour en finir avec ce problème : ${lower(n.problem)}.`,
    painBullets: n.voc.phrases.slice(0, 5).map((p) => `« ${p} »`), solution: 'Un guide en 6 étapes numérotées, construit à partir de centaines de témoignages.',
    chapterBlurbs: c.chapters.map((ch) => ({ title: ch.title, blurb: 'Ce que vous allez appliquer concrètement, avec un exemple réel.' })),
    bonusBlurb: 'Cadeau inclus : la checklist imprimable.', objections: n.voc.objections.slice(0, 4).map((q) => ({ q, a: 'Ce guide part de vrais témoignages.' })),
    guarantee: 'Satisfait ou remboursé pendant 14 jours, sans justification.', cta: 'Je télécharge le guide', hypeLevel: 0.4,
  };
}

function addProduct(world: WorldState, id: string, nicheId: string): Product {
  const n = findNiche(world, nicheId)!;
  const content = goodContent(n);
  const p: Product = {
    id, nicheId: n.id, title: `Guide ${id}`, subtitle: content.subtitle, audience: n.audience, problem: n.problem, price: n.wtp.sweet, status: 'live', version: 1,
    content, design: { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'paw', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 },
    salesPage: goodSalesPage(n, content), files: { pdf: 'g.pdf', cover: 'c.svg', salesPage: 's.html' }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [{ day: 1, price: n.wtp.sweet }],
  };
  world.company.products.push(p);
  return p;
}

function addCreative(world: WorldState, id: string, p: Product, opts: { format?: AdFormat; ratio?: AdRatio; on?: ChannelId[]; style?: HookStyle; masterId?: string } = {}): AdCreative {
  const n = findNiche(world, p.nicheId)!;
  const phrase = at(n.voc.phrases, world.company.creatives.length);
  const hook = `POV : « ${phrase.slice(0, 50)} »`;
  const c: AdCreative = {
    id, productId: p.id, hook, hookStyle: opts.style ?? 'pov', format: opts.format ?? 'faceless_voiceover',
    scenes: opts.format === 'search_text' ? [] : [
      { visual: 'Gros plan', onScreenText: hook.slice(0, 60), voiceover: hook, durationSec: 4 },
      { visual: 'Scène du quotidien', onScreenText: at(n.voc.pains, 0).slice(0, 60), voiceover: at(n.voc.pains, 0), durationSec: 5 },
      { visual: 'Pages du guide', onScreenText: 'Le guide : 6 étapes concrètes', voiceover: `Une méthode en 6 étapes pour ${lower(n.audience)}.`, durationSec: 6 },
      { visual: 'Couverture', onScreenText: 'Lien en bio : télécharge le guide', voiceover: 'Le lien est en bio.', durationSec: 5 },
    ],
    caption: `${at(n.voc.pains, 0)} Le guide est en bio.`, hashtags: n.keywords.slice(0, 4).map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, '')}`), cta: 'Lien en bio : télécharge le guide',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
    ...(opts.ratio ? { ratio: opts.ratio } : {}), ...(opts.masterId ? { masterId: opts.masterId } : {}),
  };
  if (opts.format === 'search_text') c.search = { headlines: [n.name.slice(0, 30), 'Méthode en 6 étapes'], descriptions: [at(n.voc.pains, 0).slice(0, 90), 'Guide PDF, satisfait ou remboursé.'], keywords: n.keywords.slice(0, 4) };
  for (const ch of opts.on ?? []) (c.channelReviews ??= {})[ch] = { status: 'approved', reason: null, day: 1 };
  world.company.creatives.push(c);
  return c;
}

function addCampaign(world: WorldState, id: string, p: Product, creatives: AdCreative[], budget: number, channel?: ChannelId): Campaign {
  const camp: Campaign = {
    id, productId: p.id, name: `Campagne ${id}`, creativeIds: creatives.map((c) => c.id), dailyBudget: budget, status: 'active',
    targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay: 1, createdBy: 'test',
    ...(channel ? { channel } : {}),
  };
  world.company.campaigns.push(camp);
  return camp;
}

const metaCut = (world: WorldState, id: string, p: Product) => addCreative(world, id, p, { format: 'carousel', ratio: '4:5', on: ['meta'] });
const pin = (world: WorldState, id: string, p: Product) => addCreative(world, id, p, { format: 'static_image', ratio: '2:3', on: ['pinterest'] });
const searchAd = (world: WorldState, id: string, p: Product) => addCreative(world, id, p, { format: 'search_text', ratio: 'text', on: ['google'] });

/** Closes days `from` to `to`. Each close takes its rng from the day, so a world can be cloned between two days. */
function play(world: WorldState, from: number, to: number, each?: (day: number) => void): void {
  for (let d = from; d <= to; d++) {
    world.day = d;
    each?.(d);
    tickMarket(world, streamRng(world.scenario.seed, 3, d));
  }
}

const rowsOf = (world: WorldState, campaignId: string): DailyAdStats[] => world.market.adStats.filter((s) => s.campaignId === campaignId);
const sum = (rows: DailyAdStats[], k: 'spend' | 'clicks' | 'impressions' | 'purchases' | 'landingViews'): number => rows.reduce((s, r) => s + r[k], 0);
/** `at` is the feed's wall clock, the one field no replay shares. */
const noClock = (world: WorldState): WorldState => JSON.parse(JSON.stringify(world, (k, v: unknown) => (k === 'at' ? undefined : v))) as WorldState;
const withoutChannels = (world: WorldState): WorldState => {
  const w = noClock(world);
  delete w.market.channels;
  for (const n of w.market.niches) delete n.channels;
  w.scenario.channelControl = 'tiktok_only';
  return w;
};
const delivery = (rows: DailyAdStats[]) => rows.map(({ day, creativeId, spend, impressions, clicks, ctr, landingViews, frequency, comments }) => ({ day, creativeId, spend, impressions, clicks, ctr, landingViews, frequency, comments }));

// ───────────────────────────── identity ─────────────────────────────

vi.setConfig({ testTimeout: 60_000 });

describe('TikTok alone keeps its bytes', () => {
  function tiktokRun(world: WorldState): WorldState {
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const q = addProduct(world, 'prd_b', 'sommeil-bebe');
    addCampaign(world, 'cpg_1', p, [addCreative(world, 'cre_1', p), addCreative(world, 'cre_2', p, { format: 'carousel' })], 60);
    addCampaign(world, 'cpg_2', q, [addCreative(world, 'cre_3', q, { format: 'ugc_avatar' })], 200);
    play(world, 1, 30);
    return world;
  }

  it('old save and tiktok_only give the same bytes', () => {
    const full = makeWorld(11);
    const oldSave = clone(full);
    delete oldSave.market.channels;
    for (const n of oldSave.market.niches) delete n.channels;
    tiktokRun(full);
    tiktokRun(oldSave);
    const tiktokOnly = tiktokRun(makeWorld(11, 'tiktok_only'));
    expect(full.company.products[0]!.stats.sales).toBeGreaterThan(0);
    expect(withoutChannels(oldSave)).toEqual(withoutChannels(full));
    expect(withoutChannels(tiktokOnly)).toEqual(withoutChannels(full));
    expect(tiktokOnly.market.channels).toBeUndefined();
    expect(tiktokOnly.market.niches.every((n) => n.channels === undefined)).toBe(true);
  });

  it('a TikTok row, order and revenue line never name a channel', () => {
    const world = tiktokRun(makeWorld(12));
    expect(world.market.adStats.some((s) => 'channel' in s)).toBe(false);
    expect(world.market.orders.some((o) => 'channel' in o)).toBe(false);
    expect(world.ledger.filter((e) => e.type === 'ad_spend').every((e) => e.memo.startsWith('TikTok Ads — '))).toBe(true);
    expect(world.ledger.some((e) => e.type === 'revenue' && e.memo.endsWith('(pubs TikTok)'))).toBe(true);
    expect(world.company.campaigns.some((c) => 'learning' in c)).toBe(false);
  });

  it('the truth takes nothing from the rng of the market', () => {
    const scenario = makeWorld(13).scenario;
    const a = createRng(13);
    const b = createRng(13);
    const full = createMarketState(scenario, a);
    const alone = createMarketState({ ...scenario, channelControl: 'tiktok_only' }, b);
    expect(a.next()).toBe(b.next());
    expect(full.channels).toBeDefined();
    expect(full.creators).toEqual(alone.creators);
    expect(full.niches.map((n) => ({ ...n, channels: undefined }))).toEqual(alone.niches.map((n) => ({ ...n, channels: undefined })));
  });

  it('a Meta campaign moves neither the events nor another product', () => {
    for (const seed of [21, 22, 23]) {
      const run = (withMeta: boolean) => {
        const world = makeWorld(seed);
        const p = addProduct(world, 'prd_a', 'sommeil-bebe');
        const q = addProduct(world, 'prd_b', 'potager-balcon');
        addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_1', p), addCreative(world, 'cre_2', p, { format: 'carousel' })], 90);
        if (withMeta) addCampaign(world, 'cpg_meta', q, [metaCut(world, 'cre_3', q)], 80, 'meta');
        else metaCut(world, 'cre_3', q);
        play(world, 1, 30);
        return world;
      };
      const alone = run(false);
      const both = run(true);
      expect(rowsOf(both, 'cpg_meta').length).toBeGreaterThan(20);
      expect(delivery(rowsOf(both, 'cpg_tk'))).toEqual(delivery(rowsOf(alone, 'cpg_tk')));
      expect(both.company.products[0]!.stats.views).toBe(alone.company.products[0]!.stats.views);
      expect(both.market.events.map((e) => [e.day, e.kind])).toEqual(alone.market.events.map((e) => [e.day, e.kind]));
      // sales too, until the first review of the other product can reach the store's rating
      const firstDays = (w: WorldState) => rowsOf(w, 'cpg_tk').filter((s) => s.day <= REVIEWS.minAge + 1).map((s) => s.purchases);
      expect(firstDays(both)).toEqual(firstDays(alone));
    }
  });

  it('a reload between two closes ends like an uninterrupted market', () => {
    const world = makeWorld(31);
    const p = addProduct(world, 'prd_a', 'mariage-moins-10k');
    addCampaign(world, 'cpg_pin', p, [pin(world, 'cre_1', p)], 40, 'pinterest');
    addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_2', p)], 60, 'meta');
    addCampaign(world, 'cpg_go', p, [searchAd(world, 'cre_3', p)], 20, 'google');
    play(world, 1, 12);
    const reloaded = clone(world);
    play(world, 13, 30);
    play(reloaded, 13, 30);
    expect(noClock(reloaded)).toEqual(noClock(world));
  });
});

// ───────────────────────────── hidden truth ─────────────────────────────

describe('the cells', () => {
  it('same seed, same cells; ±25 % on fit; another seed, another market', () => {
    const a = makeWorld(41).market.niches;
    const b = makeWorld(41).market.niches;
    const c = makeWorld(42).market.niches;
    expect(a.map((n) => n.channels)).toEqual(b.map((n) => n.channels));
    expect(a.map((n) => n.channels)).not.toEqual(c.map((n) => n.channels));
    const ratios: number[] = [];
    for (const n of a) {
      const row = CHANNEL_FIT[n.id]!;
      (['meta', 'youtube', 'pinterest', 'google'] as const).forEach((ch, i) => {
        const cell = n.channels![ch]!;
        ratios.push(cell.fit / row[i]!);
        expect(cell.fit).toBeGreaterThanOrEqual(0.05);
        expect(cell.fit).toBeLessThanOrEqual(1);
      });
      expect(n.channels!.google!.searchClicksPerDemand).toBe(row[4]);
      const cpc = n.channels!.google!.cpcBase! / row[5];
      expect(Math.abs(cpc - 1)).toBeLessThan(CHANNEL_VARIATION.cost + 0.03);
    }
    expect(Math.min(...ratios)).toBeGreaterThan(0.73);
    expect(Math.min(...ratios)).toBeLessThan(0.82);
    expect(Math.max(...ratios)).toBeGreaterThan(1.1); // 1 is the clamp on an authored .95
    expect(a.every((n) => CHANNEL_FIT[n.id])).toBe(true);
  });

  it('a fitting audience buys better and has more room', () => {
    const meta = makeWorld(43).market.niches.map((n) => n.channels!.meta!);
    const sorted = [...meta].sort((x, y) => x.fit - y.fit);
    const low = sorted.slice(0, 5).reduce((s, c) => s + c.poolShare, 0);
    const high = sorted.slice(-5).reduce((s, c) => s + c.poolShare, 0);
    expect(high).toBeGreaterThan(low);
    expect(meta.every((c) => c.intent > 1 && c.cpmMult > 1)).toBe(true);
  });

  it('never leaves through the snapshot', () => {
    const world = makeWorld(44);
    for (const n of world.market.niches) n.channels!.meta!.fit = 0.123456;
    world.market.channels!.warm['sommeil-bebe'] = 987654.321;
    const json = JSON.stringify(buildSnapshot(world, financeSnapshot(world)));
    expect(json).not.toContain('0.123456');
    expect(json).not.toContain('987654');
    for (const field of ['poolShare', 'cpmMult', 'searchClicksPerDemand', 'cpcBase']) expect(json).not.toContain(field);
  });

  it('a save without cells gets the same ones, and keeps them once it has them', () => {
    const world = makeWorld(45);
    const want = clone(world.market.niches.map((n) => n.channels));
    delete world.market.channels;
    for (const n of world.market.niches) delete n.channels;
    ensureChannelMarket(world);
    expect(world.market.niches.map((n) => n.channels)).toEqual(want);
    world.market.niches[0]!.channels!.meta!.fit = 0.5;
    ensureChannelMarket(world);
    expect(world.market.niches[0]!.channels!.meta!.fit).toBe(0.5);
  });

  it('TikTok gets the old numbers, and a niche with no cell the default row', () => {
    const n = makeWorld(46).market.niches[0]!;
    const spec = deliverySpec(n, 'tiktok');
    expect([spec.cpmBase, spec.fit, spec.affinityExp, spec.fatigue, spec.landingRate]).toEqual([n.cpmBase, n.tiktokAffinity, ADS.affinityExp, ADS.fatigueImpressions, ADS.landingRate]);
    expect([spec.ctrScale, spec.learningCtr, spec.learningCpm, spec.intent, spec.poolShare]).toEqual([1, 1, 1, 1, 1]);
    expect(cellOf({ ...n, channels: undefined }, 'pinterest').fit).toBe(0.4);
    expect(cellOf({ ...n, channels: undefined }, 'google').cpcBase).toBe(0.6);
  });
});

// ───────────────────────────── delivery ─────────────────────────────

describe('delivery on another channel', () => {
  it('one ledger line per campaign and day, named after the channel, and every euro in it', () => {
    const world = makeWorld(51);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const camp = addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_1', p), metaCut(world, 'cre_2', p)], 90, 'meta');
    play(world, 1, 20);
    const lines = world.ledger.filter((e) => e.type === 'ad_spend');
    expect(lines).toHaveLength(20);
    expect(lines.every((e) => e.ref === camp.id && e.memo.startsWith(`${CHANNELS.meta.label} Ads — `))).toBe(true);
    expect(sum(rowsOf(world, camp.id), 'spend')).toBeCloseTo(-lines.reduce((s, e) => s + e.amount, 0), 2);
    expect(rowsOf(world, camp.id).every((s) => s.channel === 'meta')).toBe(true);
    expect(world.ledger.some((e) => e.type === 'revenue' && e.memo.endsWith(`(pubs ${CHANNELS.meta.label})`))).toBe(true);
    expect(world.market.orders.filter((o) => o.campaignId === camp.id).every((o) => o.channel === 'meta')).toBe(true);
    expect(world.market.orders.filter((o) => o.campaignId === camp.id).length).toBeGreaterThan(0);
    expect(world.market.creativeImpressions.cre_1).toBeUndefined();
    expect(world.market.channels!.impressions.meta!.cre_1).toBeGreaterThan(0);
  });

  it('says what each channel did, TikTok first', () => {
    const world = makeWorld(52);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_1', p)], 40, 'meta');
    addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_2', p)], 40);
    world.day = 1;
    const { notes } = tickMarket(world, streamRng(52, 3, 1));
    expect(notes[0]).toMatch(/^Pubs TikTok : /);
    expect(notes[1]).toContain(`Pubs ${CHANNELS.meta.label} : `);
  });

  it('each channel\'s line reads its own ROAS, never the day\'s', () => {
    const world = makeWorld(60);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_1', p)], 400, 'meta');
    addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_2', p)], 400);
    world.day = 1;
    const { notes } = tickMarket(world, streamRng(60, 3, 1));
    const roas = (id: string) => rowsOf(world, id).reduce((t, r) => t + r.revenue, 0) / sum(rowsOf(world, id), 'spend');
    expect(roas('cpg_tk')).toBeGreaterThan(0);
    expect(roas('cpg_meta')).toBeGreaterThan(0);
    expect(fmtNum(roas('cpg_tk'), 2)).not.toBe(fmtNum(roas('cpg_meta'), 2));
    expect(notes.find((n) => n.startsWith('Pubs TikTok : '))).toContain(`ROAS ${fmtNum(roas('cpg_tk'), 2)}.`);
    expect(notes.find((n) => n.startsWith(`Pubs ${CHANNELS.meta.label} : `))).toContain(`ROAS ${fmtNum(roas('cpg_meta'), 2)}.`);
  });

  it('books one revenue line per source and channel, TikTok\'s as it always read', () => {
    let tiktok = 0;
    let meta = 0;
    for (const seed of [57, 58]) {
      const world = makeWorld(seed);
      const p = addProduct(world, 'prd_a', 'sommeil-bebe');
      addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_1', p)], 150);
      addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_2', p)], 150, 'meta');
      play(world, 1, 8);
      const booked = (label: string) => world.ledger.filter((e) => e.type === 'revenue' && e.memo.endsWith(`(pubs ${label})`)).reduce((t, e) => t + e.amount, 0);
      const sold = (id: string) => rowsOf(world, id).reduce((t, r) => t + r.revenue, 0);
      expect(booked('TikTok')).toBeCloseTo(sold('cpg_tk'), 2);
      expect(booked(CHANNELS.meta.label)).toBeCloseTo(sold('cpg_meta'), 2);
      tiktok += booked('TikTok');
      meta += booked(CHANNELS.meta.label);
    }
    expect(tiktok).toBeGreaterThan(0);
    expect(meta).toBeGreaterThan(0);
  });

  it('an upsell stays with the channel that brought the buyer: the shop never files it under TikTok', () => {
    const world = makeWorld(59);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    p.upsellProductId = addProduct(world, 'prd_b', 'sommeil-bebe').id;
    addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_1', p)], 400, 'meta');
    play(world, 1, 12);
    const upsells = world.market.orders.filter((o) => o.source === 'upsell');
    expect(upsells.length).toBeGreaterThan(0);
    expect(upsells.every((o) => o.channel === 'meta')).toBe(true);
    const shop = createMarketTools(world, createRng(1)).getShopAttribution();
    expect(new Set(shop.map((r) => r.channel))).toEqual(new Set(['meta']));
  });

  it('a landing view is worth the cell\'s intent: Meta\'s buys about twice as often as TikTok\'s', () => {
    const rate = (channel: 'tiktok' | 'meta') => {
      let views = 0;
      let bought = 0;
      for (const seed of [59, 60, 61, 62, 63, 64]) {
        const world = makeWorld(seed);
        const p = addProduct(world, 'prd_a', 'sommeil-bebe');
        const camp = channel === 'meta' ? addCampaign(world, 'cpg', p, [metaCut(world, 'cre_1', p)], 40, 'meta') : addCampaign(world, 'cpg', p, [addCreative(world, 'cre_1', p)], 40);
        play(world, 1, 12);
        views += sum(rowsOf(world, camp.id), 'landingViews');
        bought += sum(rowsOf(world, camp.id), 'purchases');
      }
      return bought / views;
    };
    expect(rate('meta') / rate('tiktok')).toBeGreaterThan(1.5);
  });

  it('a channel reads its own format and ratio factors, and its frequency on its own reach', () => {
    const world = makeWorld(65);
    const n = findNiche(world, 'sommeil-bebe')!;
    const p = addProduct(world, 'prd_a', n.id);
    const portrait = addCreative(world, 'cre_1', p, { format: 'carousel', ratio: '4:5', on: ['meta'] });
    const reel = addCreative(world, 'cre_2', p, { format: 'carousel', ratio: '9:16', on: ['meta'] });
    const spec = deliverySpec(n, 'meta');
    expect(spec.formatFit(portrait)).toBeCloseTo((n.formatAffinity.carousel ?? 1) * FORMAT_FIT.meta.carousel!, 10);
    expect([spec.ratioFit(portrait), spec.ratioFit(reel)]).toEqual([1, 0.85]);
    expect(spec.ctrScale).toBe(CHANNEL_SIM.meta.ctrScale);
    expect(spec.cpmBase).toBeCloseTo(n.cpmBase * n.channels!.meta!.cpmMult, 10);

    const ctrOf = (ratio: AdRatio) => {
      const w = makeWorld(66);
      const q = addProduct(w, 'prd_a', n.id);
      const camp = addCampaign(w, 'cpg', q, [addCreative(w, 'cre_1', q, { format: 'carousel', ratio, on: ['meta'] })], 200, 'meta');
      play(w, 1, 6);
      return { rows: rowsOf(w, camp.id), w };
    };
    const feed = ctrOf('4:5');
    const reels = ctrOf('9:16');
    const ratio = (sum(reels.rows, 'clicks') / sum(reels.rows, 'impressions')) / (sum(feed.rows, 'clicks') / sum(feed.rows, 'impressions'));
    expect(ratio).toBeGreaterThan(0.78);
    expect(ratio).toBeLessThan(0.92);

    const first = feed.rows[0]!;
    const cell = findNiche(feed.w, n.id)!.channels!.meta!;
    expect(first.frequency).toBeCloseTo(1 + first.impressions / (reachOf(findNiche(feed.w, n.id)!) * cell.poolShare), 2);
  });

  it('the cpm_spike event stays TikTok\'s', () => {
    const cpm = (spike: boolean, channel?: ChannelId) => {
      const world = makeWorld(67);
      const p = addProduct(world, 'prd_a', 'sommeil-bebe');
      const camp = addCampaign(world, 'cpg', p, channel ? [metaCut(world, 'cre_1', p)] : [addCreative(world, 'cre_1', p)], 100, channel);
      if (spike) Object.assign(world.market.modifiers, { cpmMultiplier: 1.4, cpmUntilDay: 3 });
      play(world, 1, 2);
      return sum(rowsOf(world, camp.id), 'spend') / sum(rowsOf(world, camp.id), 'impressions');
    };
    expect(cpm(true) / cpm(false)).toBeCloseTo(1.4, 1);
    expect(cpm(true, 'meta')).toBe(cpm(false, 'meta'));
  });

  it('a Meta ad\'s comments draw on their own stream: the follow-ups of the day keep theirs', () => {
    const run = (meta: boolean) => {
      const world = makeWorld(68);
      const p = addProduct(world, 'prd_a', 'sommeil-bebe');
      const camp = addCampaign(world, 'cpg_meta', p, Array.from({ length: 6 }, (_, i) => metaCut(world, `cre_${i}`, p)), 1800, 'meta');
      camp.status = meta ? 'active' : 'paused';
      world.market.modifiers.outageDay = 2; // no sale that day: only the comments can move the inbox's stream
      const replied = Array.from({ length: 24 }, (_, i) => ({
        id: `msg_${i}`, day: 1, customerId: 'x', channel: 'email' as const, subject: 's', body: 'b', intent: 'question' as const, productId: p.id, orderId: null,
        mood: 0, status: 'replied' as const, deadlineDay: 9, resolution: null, thread: [{ from: 'agent', text: 'réponse', day: 1 }],
      }));
      world.market.inbox.push(...replied);
      world.day = 2;
      tickMarket(world, streamRng(68, 3, 2));
      return { statuses: replied.map((m) => m.status), comments: world.market.inbox.filter((m) => m.channel === 'commentaire_pub').length };
    };
    const quiet = run(false);
    const loud = run(true);
    expect(loud.comments).toBeGreaterThan(0);
    expect(new Set(quiet.statuses).size).toBe(2);
    expect(loud.statuses).toEqual(quiet.statuses);
  });

  it('a creative with no verdict on the channel does not run there', () => {
    const world = makeWorld(53);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const master = addCreative(world, 'cre_1', p); // approved on TikTok, nothing on Meta
    const refused = addCreative(world, 'cre_2', p, { format: 'static_image', ratio: '4:5', on: ['youtube'] }); // YouTube takes no image
    addCampaign(world, 'cpg_meta', p, [master], 40, 'meta');
    addCampaign(world, 'cpg_yt', p, [refused], 40, 'youtube');
    play(world, 1, 3);
    expect(world.market.adStats).toHaveLength(0);
  });

  it('comments under another channel\'s ad reach the inbox as such', () => {
    const world = makeWorld(54);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_1', p)], 300, 'meta');
    play(world, 1, 12);
    const fromAds = world.market.inbox.filter((m) => m.subject === 'Commentaire sous votre pub');
    expect(fromAds.length).toBeGreaterThan(0);
    expect(fromAds.every((m) => m.channel === 'commentaire_pub')).toBe(true);
  });

  it('a cut shares its master\'s fatigue, at a quarter of what the family showed elsewhere', () => {
    const world = makeWorld(55);
    const m = world.market;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const master = addCreative(world, 'cre_1', p);
    const cut = addCreative(world, 'cre_2', p, { format: 'carousel', ratio: '4:5', on: ['meta'], masterId: master.id });
    m.creativeImpressions[master.id] = 40_000;
    m.channels!.impressions.meta = { [master.id]: 10_000 };
    m.channels!.impressions.youtube = { [master.id]: 4_000 };
    expect(familyPrior(m, cut, 'meta')).toBe(10_000 + FAMILY_FATIGUE * 44_000);
    expect(familyPrior(m, master, 'tiktok')).toBe(40_000 + FAMILY_FATIGUE * 14_000);
    expect(familyPrior(m, addCreative(world, 'cre_3', p), 'tiktok')).toBe(0);
  });

  it('a ban stops its own account: Search and YouTube together, Meta and TikTok keep running', () => {
    const world = makeWorld(56);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_1', p, { on: ['youtube'] })], 40);
    addCampaign(world, 'cpg_yt', p, [world.company.creatives[0]!], 40, 'youtube');
    addCampaign(world, 'cpg_go', p, [searchAd(world, 'cre_2', p)], 40, 'google');
    addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_3', p)], 40, 'meta');
    Object.assign(world.market.channels!.accounts.google, { banned: true, strikes: 2, bannedUntilDay: 4 });
    expect(accountBanned(world.market, 'youtube', 3)).toBe(true);
    expect(accountBanned(world.market, 'google', 3)).toBe(true);
    expect(accountBanned(world.market, 'meta', 3)).toBe(false);
    world.day = 1;
    const { notes } = tickMarket(world, streamRng(56, 3, 1));
    expect(notes.filter((n) => n.includes('suspendu'))).toHaveLength(2);
    play(world, 2, 3);
    expect(rowsOf(world, 'cpg_yt')).toHaveLength(0);
    expect(rowsOf(world, 'cpg_go')).toHaveLength(0);
    expect(rowsOf(world, 'cpg_meta')).toHaveLength(3);
    expect(rowsOf(world, 'cpg_tk')).toHaveLength(3);
    play(world, 4, 5);
    expect(rowsOf(world, 'cpg_yt').map((s) => s.day)).toEqual([4, 5]);
    expect(rowsOf(world, 'cpg_go').map((s) => s.day)).toEqual([4, 5]);
    expect(world.market.channels!.accounts.google).toMatchObject({ banned: false, strikes: 0 });
  });
});

// ───────────────────────────── pools ─────────────────────────────

describe('pools', () => {
  it('saturates as the one-pool market did while a channel is alone', () => {
    for (const [pool, views] of [[480, 200], [480, 850], [300, 3000]] as const) {
      expect(poolSaturation(pool, views, 0, 0.35)).toBe((pool * (1 - Math.exp(-views / pool))) / views);
    }
    expect(poolSaturation(480, 0, 0, 0.3)).toBe(1);
    expect(poolSaturation(480, 500, 500, 0.3)).toBeLessThan(poolSaturation(480, 500, 0, 0.3));
    expect(poolSaturation(480, 500, 500, 0.3)).toBeGreaterThan(poolSaturation(480, 1000, 0, 0.3));
  });

  it('a channel adds room: 480 views on TikTok, 842 on Meta at demand 0,8 and fit 0,85', () => {
    const world = makeWorld(61);
    const n: NicheTruth = { ...world.market.niches[0]!, demand: 0.8 };
    n.channels = { ...n.channels, meta: { ...cellOf(n, 'meta'), poolShare: CHANNEL_SIM.meta.pool * (0.5 + 0.85) } };
    expect(nichePool(world, n)).toBe(CONVERSION.poolBase + CONVERSION.poolDemand * 0.8);
    expect(nichePool(world, n, 'tiktok')).toBe(480);
    expect(nichePool(world, n, 'meta')).toBeCloseTo(842.4, 1);
  });

  it('two channels sell more than one past saturation, overlap below the sum', () => {
    const totals = { tiktok: 0, meta: 0, both: 0, tiktokWithMeta: 0, metaWithTiktok: 0 };
    for (const seed of [62, 63, 64, 65]) {
      const run = (tiktok: boolean, meta: boolean) => {
        const world = makeWorld(seed);
        const p = addProduct(world, 'prd_a', 'sommeil-bebe');
        const t = Array.from({ length: 4 }, (_, i) => addCreative(world, `cre_t${i}`, p, { format: 'carousel' }));
        const m = Array.from({ length: 4 }, (_, i) => metaCut(world, `cre_m${i}`, p));
        if (tiktok) addCampaign(world, 'cpg_tk', p, t, 800);
        if (meta) addCampaign(world, 'cpg_meta', p, m, 500, 'meta');
        play(world, 1, 6);
        return world;
      };
      const alone = run(true, false);
      const elsewhere = run(false, true);
      const both = run(true, true);
      // past saturation: a pool is full before the day ends
      expect(sum(rowsOf(alone, 'cpg_tk'), 'landingViews') / 6).toBeGreaterThan(nichePool(alone, findNiche(alone, 'sommeil-bebe')!));
      totals.tiktok += alone.company.products[0]!.stats.sales;
      totals.meta += elsewhere.company.products[0]!.stats.sales;
      totals.both += both.company.products[0]!.stats.sales;
      totals.tiktokWithMeta += sum(rowsOf(both, 'cpg_tk'), 'purchases');
      totals.metaWithTiktok += sum(rowsOf(both, 'cpg_meta'), 'purchases');
    }
    expect(totals.both).toBeGreaterThan(Math.max(totals.tiktok, totals.meta) * 1.1);
    expect(totals.both).toBeLessThan(totals.tiktok + totals.meta);
    expect(totals.tiktokWithMeta).toBeLessThan(totals.tiktok); // the other channel's views ate into TikTok's pool
    expect(totals.metaWithTiktok).toBeLessThan(totals.meta);
  });

  it('Search sits outside the pools: its queries are its cap, and its clicks saturate nobody', () => {
    const run = (search: boolean) => {
      const world = makeWorld(66);
      const p = addProduct(world, 'prd_a', 'urssaf-micro');
      addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_1', p)], 500);
      if (search) addCampaign(world, 'cpg_go', p, [searchAd(world, 'cre_2', p)], 80, 'google');
      else searchAd(world, 'cre_2', p);
      play(world, 1, 15);
      return world;
    };
    const alone = run(false);
    const both = run(true);
    expect(sum(rowsOf(both, 'cpg_go'), 'purchases')).toBeGreaterThan(0);
    expect(rowsOf(both, 'cpg_tk').map((s) => s.purchases)).toEqual(rowsOf(alone, 'cpg_tk').map((s) => s.purchases));
  });
});

// ───────────────────────────── learning ─────────────────────────────

describe('the learning phase', () => {
  const run = (exited: boolean) => {
    const world = makeWorld(71);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const camp = addCampaign(world, 'cpg_meta', p, [metaCut(world, 'cre_1', p)], 60, 'meta');
    camp.learning = { events: 0, exitedDay: exited ? 0 : null };
    return { world, camp };
  };

  it('lowers the CTR and raises the CPM until it ends', () => {
    const learning = run(false);
    const done = run(true);
    play(learning.world, 1, 4);
    play(done.world, 1, 4);
    const [a, b] = [rowsOf(learning.world, 'cpg_meta'), rowsOf(done.world, 'cpg_meta')];
    const cpm = (r: DailyAdStats[]) => sum(r, 'spend') / sum(r, 'impressions');
    const ctr = (r: DailyAdStats[]) => sum(r, 'clicks') / sum(r, 'impressions');
    expect(cpm(a) / cpm(b)).toBeCloseTo(LEARNING.cpm, 1);
    expect(ctr(a) / ctr(b)).toBeGreaterThan(LEARNING.ctr - 0.05);
    expect(ctr(a) / ctr(b)).toBeLessThan(LEARNING.ctr + 0.05);
  });

  it('ends at the sales of the channel or at its days, and a phase nobody opened still counts', () => {
    const bySales = run(false);
    bySales.camp.learning!.events = CHANNELS.meta.learning!.events - 1;
    play(bySales.world, 1, 6);
    const firstSale = rowsOf(bySales.world, 'cpg_meta').find((s) => s.purchases > 0)!.day;
    expect(firstSale).toBeLessThan(CHANNELS.meta.learning!.days);
    expect(bySales.camp.learning!.exitedDay).toBe(firstSale);

    const world = makeWorld(72);
    const p = addProduct(world, 'prd_a', 'freelance-linkedin');
    p.price = 199; // nobody buys: only the days can end it
    const pins = addCampaign(world, 'cpg_pin', p, [pin(world, 'cre_1', p)], 10, 'pinterest');
    expect(inLearning(pins)).toBe(true);
    play(world, 1, CHANNELS.pinterest.learning!.days - 1);
    expect(pins.learning).toMatchObject({ exitedDay: null, days: CHANNELS.pinterest.learning!.days - 1 });
    play(world, CHANNELS.pinterest.learning!.days, CHANNELS.pinterest.learning!.days);
    expect(pins.learning!.exitedDay).toBe(CHANNELS.pinterest.learning!.days);
    expect(inLearning(pins)).toBe(false);
  });

  it('+50 % on the budget starts it over, +20 % does not, a change of creatives does', () => {
    const fresh = () => {
      const r = run(true);
      r.camp.learning = { events: 9, exitedDay: 5, days: 5 };
      r.world.market.channels!.accounts.meta.openDay = 1;
      return { ...r, tools: createMarketTools(r.world, createRng(1)) };
    };
    const small = fresh();
    expect(small.tools.updateCampaign('cpg_meta', { dailyBudget: 72 }).ok).toBe(true);
    expect(small.camp.learning).toEqual({ events: 9, exitedDay: 5, days: 5 });
    const big = fresh();
    expect(big.tools.updateCampaign('cpg_meta', { dailyBudget: 90 }).ok).toBe(true);
    expect(big.camp.learning).toEqual({ events: 0, exitedDay: null });
    expect(inLearning(big.camp)).toBe(true);
    const swap = fresh();
    metaCut(swap.world, 'cre_2', swap.world.company.products[0]!);
    expect(swap.tools.updateCampaign('cpg_meta', { creativeIds: ['cre_2'] }).ok).toBe(true);
    expect(swap.camp.learning).toEqual({ events: 0, exitedDay: null });
    const down = fresh();
    expect(down.tools.updateCampaign('cpg_meta', { dailyBudget: 30 }).ok).toBe(true);
    expect(down.camp.learning!.exitedDay).toBe(5);
  });

  it('leaves TikTok out of it', () => {
    const world = makeWorld(73);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const camp = addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_1', p)], 50);
    expect(createMarketTools(world, createRng(1)).updateCampaign(camp.id, { dailyBudget: 200 }).ok).toBe(true);
    expect(camp.learning).toBeUndefined();
    expect(deliverySpec(findNiche(world, p.nicheId)!, 'tiktok', camp).learningCtr).toBe(1);
  });
});

// ───────────────────────────── Search ─────────────────────────────

describe('Search', () => {
  const run = (nicheId: string, budget: number, seed = 81, days = 20) => {
    const world = makeWorld(seed);
    const p = addProduct(world, 'prd_a', nicheId);
    const camp = addCampaign(world, 'cpg_go', p, [searchAd(world, 'cre_1', p)], budget, 'google');
    camp.learning = { events: 0, exitedDay: 0 };
    play(world, 1, days);
    return { world, rows: rowsOf(world, 'cpg_go') };
  };

  it('spends under budget in a small niche: its queries run out', () => {
    const { rows, world } = run('stress-bac', 60);
    expect(rows).toHaveLength(20);
    expect(sum(rows, 'spend')).toBeLessThan(0.3 * 60 * 20);
    expect(sum(rows, 'spend')).toBeGreaterThan(0);
    expect(rows.every((s) => s.frequency === 1 && s.comments.length === 0)).toBe(true);
    const spent = -world.ledger.filter((e) => e.type === 'ad_spend').reduce((s, e) => s + e.amount, 0);
    expect(spent).toBeCloseTo(sum(rows, 'spend'), 2);
    expect(world.ledger.find((e) => e.type === 'ad_spend')!.memo).toMatch(/^Google Search Ads — /);
  });

  it('×2 budget gives under ×1,5 clicks: the next euros buy less', () => {
    for (const seed of [81, 82, 83]) {
      const small = run('urssaf-micro', 30, seed).rows;
      const large = run('urssaf-micro', 60, seed).rows;
      const [one, two] = [sum(small, 'clicks'), sum(large, 'clicks')];
      expect(two).toBeGreaterThan(one);
      expect(two).toBeLessThan(1.5 * one);
      expect(sum(large, 'spend') / two).toBeGreaterThan(1.15 * (sum(small, 'spend') / one)); // each click costs more
    }
  });

  it('never tires: a month of queries still clicks like the first week', () => {
    const { rows } = run('urssaf-micro', 30, 84, 28);
    const week = (from: number) => rows.filter((s) => s.day >= from && s.day < from + 7);
    const ctr = (r: DailyAdStats[]) => sum(r, 'clicks') / sum(r, 'impressions');
    expect(ctr(week(22)) / ctr(week(1))).toBeGreaterThan(0.85);
  });

  it('two campaigns of a niche share its queries', () => {
    const world = makeWorld(85);
    const p = addProduct(world, 'prd_a', 'urssaf-micro');
    addCampaign(world, 'cpg_a', p, [searchAd(world, 'cre_1', p)], 300, 'google');
    addCampaign(world, 'cpg_b', p, [searchAd(world, 'cre_2', p)], 300, 'google');
    play(world, 1, 15);
    const alone = run('urssaf-micro', 300, 85, 15);
    const both = sum(rowsOf(world, 'cpg_a'), 'clicks') + sum(rowsOf(world, 'cpg_b'), 'clicks');
    expect(both / sum(alone.rows, 'clicks')).toBeGreaterThan(0.8);
    expect(both / sum(alone.rows, 'clicks')).toBeLessThan(1.25);
  });

  it('converts better than a cold view, without saturation', () => {
    const { world } = run('urssaf-micro', 100);
    const cell = findNiche(world, 'urssaf-micro')!.channels!.google!;
    expect(cell.intent).toBeGreaterThan(1.9);
    expect(sum(rowsOf(world, 'cpg_go'), 'landingViews')).toBeGreaterThan(0.85 * sum(rowsOf(world, 'cpg_go'), 'clicks'));
    expect(world.market.orders.every((o) => o.channel === 'google')).toBe(true);
  });
});

// ───────────────────────────── paid tail ─────────────────────────────

describe('the paid tail', () => {
  const pinned = (seed = 91) => {
    const world = makeWorld(seed);
    const p = addProduct(world, 'prd_a', 'mariage-moins-10k');
    const camp = addCampaign(world, 'cpg_pin', p, [pin(world, 'cre_1', p)], 150, 'pinterest');
    return { world, p, camp };
  };

  it('a paused pin keeps earning clicks for 3 days, spends nothing, books no ledger line', () => {
    const { world, camp } = pinned();
    play(world, 1, 3);
    const paid = sum(rowsOf(world, camp.id).filter((s) => !s.tail), 'clicks');
    const lines = world.ledger.filter((e) => e.type === 'ad_spend').length;
    camp.status = 'paused';
    const viewsBefore = world.company.products[0]!.stats.views;
    play(world, 4, 8);
    const tails = rowsOf(world, camp.id).filter((s) => s.day >= 4);
    expect(tails.map((s) => s.day)).toEqual([4, 5, 6]);
    for (const s of tails) expect(s).toMatchObject({ spend: 0, impressions: 0, tail: true, channel: 'pinterest', cpc: 0 });
    expect(sum(tails, 'clicks')).toBeGreaterThan(0);
    expect(sum(tails, 'clicks')).toBeLessThan(paid);
    expect(world.ledger.filter((e) => e.type === 'ad_spend')).toHaveLength(lines);
    expect(world.company.products[0]!.stats.views).toBe(viewsBefore + sum(tails, 'landingViews'));
  });

  it('adds up to about 43 % more clicks, for free', () => {
    const { world, camp } = pinned(92);
    play(world, 1, 14);
    const rows = rowsOf(world, camp.id);
    const ratio = sum(rows.filter((s) => s.tail), 'clicks') / sum(rows.filter((s) => !s.tail), 'clicks');
    const shares = PAID_TAIL.shares.reduce((s, x) => s + x, 0);
    expect(ratio).toBeGreaterThan(shares * 0.6);
    expect(ratio).toBeLessThan(shares * 1.3);
    expect(rows.filter((s) => s.tail).every((s) => s.ctr > 0)).toBe(true); // the fatigue test reads the last row
  });

  it('stops with the product off sale, and on Meta there is none', () => {
    const { world, p, camp } = pinned(93);
    play(world, 1, 2);
    p.status = 'paused';
    play(world, 3, 6);
    expect(rowsOf(world, camp.id).some((s) => s.day >= 3)).toBe(false);

    const other = makeWorld(94);
    const q = addProduct(other, 'prd_a', 'sommeil-bebe');
    const meta = addCampaign(other, 'cpg_meta', q, [metaCut(other, 'cre_1', q)], 60, 'meta');
    play(other, 1, 2);
    meta.status = 'paused';
    play(other, 3, 5);
    expect(rowsOf(other, meta.id).some((s) => s.tail)).toBe(false);
  });

  it('stops while the account is banned', () => {
    const { world, camp } = pinned(99);
    play(world, 1, 2);
    expect(rowsOf(world, camp.id).filter((s) => !s.tail)).toHaveLength(2);
    Object.assign(world.market.channels!.accounts.pinterest, { banned: true, bannedUntilDay: 20 });
    play(world, 3, 6);
    expect(rowsOf(world, camp.id).some((s) => s.day >= 3)).toBe(false);
  });

  it('a free click converts at the cell\'s intent, as a paid click of the same pin does', () => {
    const sold = (intent: number) => {
      let total = 0;
      for (const seed of [201, 202, 203, 204, 205, 206]) {
        const { world, p, camp } = pinned(seed);
        findNiche(world, p.nicheId)!.channels!.pinterest!.intent = intent;
        play(world, 1, 14);
        total += sum(rowsOf(world, camp.id).filter((s) => s.tail), 'purchases');
      }
      return total;
    };
    expect(sold(1)).toBeGreaterThan(0);
    expect(sold(3)).toBeGreaterThan(sold(1) * 2);
  });

  it('a tail row sells on the campaign it belongs to', () => {
    let sold = 0;
    for (const seed of [95, 96, 97, 98]) {
      const { world, camp } = pinned(seed);
      play(world, 1, 12);
      sold += sum(rowsOf(world, camp.id).filter((s) => s.tail), 'purchases');
    }
    expect(sold).toBeGreaterThan(0);
  });
});

// ───────────────────────────── assist ─────────────────────────────

describe('the warm audience', () => {
  it('reads the spec\'s numbers: 8 300 impressions a day make a stock of 41 500, warmth 0,38', () => {
    const world = makeWorld(101);
    const n = findNiche(world, 'sommeil-bebe')!;
    n.demand = 0.8;
    const p = addProduct(world, 'prd_a', n.id);
    for (let d = 1; d <= 60; d++) {
      world.day = d;
      world.market.adStats.push({ day: d, campaignId: 'c', creativeId: 'x', productId: p.id, spend: 50, impressions: 8300, clicks: 0, ctr: 0, cpc: 0, cpm: 0, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [] });
      updateWarmth(world);
    }
    expect(world.market.channels!.warm[n.id]).toBeCloseTo(41_500, -1);
    expect(reachOf(n)).toBe(136_000);
    expect(warmth(world.market, n)).toBeCloseTo(0.38, 2);
    for (let d = 61; d <= 70; d++) { world.day = d; updateWarmth(world); }
    expect(world.market.channels!.warm[n.id]).toBeLessThan(41_500 * 0.11); // cut the line and it fades within days
  });

  it('weighs a channel by its exposure, and leaves Search out', () => {
    const world = makeWorld(102);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const row = (channel: ChannelId): DailyAdStats => ({ day: 1, campaignId: 'c', creativeId: 'x', productId: p.id, spend: 1, impressions: 1000, clicks: 0, ctr: 0, cpc: 0, cpm: 0, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [], ...(channel === 'tiktok' ? {} : { channel }) });
    world.market.adStats.push(row('tiktok'), row('youtube'), row('pinterest'), row('google'));
    updateWarmth(world);
    expect(world.market.channels!.warm[p.nicheId]).toBe(1000 * (ASSIST.weights.tiktok! + ASSIST.weights.youtube! + ASSIST.weights.pinterest!));
  });

  it('Search clicks with TikTok running beat Search alone, same seed', () => {
    let alone = 0;
    let warmed = 0;
    for (const seed of [103, 104, 105]) {
      const run = (tiktok: boolean) => {
        const world = makeWorld(seed);
        const p = addProduct(world, 'prd_a', 'urssaf-micro');
        const camp = addCampaign(world, 'cpg_go', p, [searchAd(world, 'cre_1', p)], 400, 'google');
        camp.learning = { events: 0, exitedDay: 0 };
        addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_2', p)], 120);
        if (!tiktok) world.company.campaigns[1]!.status = 'paused';
        play(world, 1, 25);
        return sum(rowsOf(world, 'cpg_go').filter((s) => s.day >= 8), 'clicks');
      };
      alone += run(false);
      warmed += run(true);
    }
    expect(warmed).toBeGreaterThan(alone * 1.12);
    expect(warmed).toBeLessThan(alone * (1 + ASSIST.maxLift));
  });

  it('cut the TikTok line and Search shrinks within a week', () => {
    const world = makeWorld(106);
    const p = addProduct(world, 'prd_a', 'urssaf-micro');
    addCampaign(world, 'cpg_go', p, [searchAd(world, 'cre_1', p)], 400, 'google').learning = { events: 0, exitedDay: 0 };
    addCampaign(world, 'cpg_tk', p, [addCreative(world, 'cre_2', p)], 200);
    play(world, 1, 14);
    const n = findNiche(world, 'urssaf-micro')!;
    const lifted = warmth(world.market, n);
    world.company.campaigns[1]!.status = 'paused';
    play(world, 15, 21);
    expect(lifted).toBeGreaterThan(0.2);
    expect(warmth(world.market, n)).toBeLessThan(lifted * 0.55);
  });
});

// ───────────────────────────── silent drift ─────────────────────────────

describe('the silent drift', () => {
  /** An rng that answers `chance` by the book it is given, and everything else honestly. */
  const scripted = (answers: boolean[]): Rng => ({ ...createRng(1), chance: () => answers.shift() ?? false, pick: <T,>(xs: readonly T[]) => xs[0]! });

  const spending = (ch: ChannelId, spend = 30) => {
    const world = makeWorld(111);
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    world.day = 5;
    world.market.adStats.push({ day: 5, campaignId: 'c', creativeId: 'x', productId: p.id, spend, impressions: spend > 0 ? 5000 : 0, clicks: 50, ctr: 0.01, cpc: 0.6, cpm: 6, landingViews: 40, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [], ...(ch === 'tiktok' ? {} : { channel: ch }) });
    return { world, n: findNiche(world, p.nicheId)! };
  };

  it('moves the fit of a line that spent, for good, in silence', () => {
    const { world, n } = spending('meta');
    const before = n.channels!.meta!.fit;
    const events = world.market.events.length;
    const activity = world.activity.length;
    rollChannelEvents(world, scripted([true, true]));
    expect(n.channels!.meta!.fit).toBeCloseTo(before * 0.75, 2);
    rollChannelEvents(world, scripted([true, false]));
    expect(n.channels!.meta!.fit).toBeCloseTo(Math.min(1, before * 0.75 * 1.25), 1);
    expect(world.market.events).toHaveLength(events);
    expect(world.activity).toHaveLength(activity);
  });

  it('picks among the lines that can move: a TikTok line in the day takes nothing from them', () => {
    const { world, n } = spending('meta');
    const before = n.channels!.meta!.fit;
    world.market.adStats.unshift({ ...world.market.adStats[0]!, channel: 'tiktok' });
    rollChannelEvents(world, scripted([true, true]));
    expect(n.channels!.meta!.fit).toBeLessThan(before);
  });

  it('rolls 3 % a day, and leaves TikTok and the lines with no spend alone', () => {
    const { world, n } = spending('meta');
    const cells = clone(n.channels);
    rollChannelEvents(world, scripted([false]));
    expect(n.channels).toEqual(cells);
    const alone = spending('tiktok');
    const tiktok = alone.n.tiktokAffinity;
    const all = clone(alone.n.channels);
    rollChannelEvents(alone.world, scripted([true, true]));
    expect(alone.n.tiktokAffinity).toBe(tiktok);
    expect(alone.n.channels).toEqual(all);
    const free = spending('pinterest', 0); // a tail day: free clicks, no spend, nothing the drift may move
    const untouched = clone(free.n.channels);
    rollChannelEvents(free.world, scripted([true, true]));
    expect(free.n.channels).toEqual(untouched);
  });
});

// ───────────────────────────── planners and adapters ─────────────────────────────

describe('what the tools read', () => {
  it('channelSignals is noisy, stable within a day, and silent on a TikTok-only world', () => {
    const world = makeWorld(121);
    world.day = 3;
    const a = channelSignals(world, 'urssaf-micro');
    expect(a.map((s) => s.channel)).toEqual(['tiktok', 'meta', 'youtube', 'pinterest', 'google']);
    expect(channelSignals(world, 'urssaf-micro')).toEqual(a);
    const google = a.find((s) => s.channel === 'google')!;
    const cell = findNiche(world, 'urssaf-micro')!.channels!.google!;
    expect(google.cpc).toBeGreaterThanOrEqual(cell.cpcBase! * 0.69);
    expect(google.cpc).toBeLessThanOrEqual(cell.cpcBase! * 1.31);
    expect(a.every((s) => s.audience >= 0 && s.audience <= 100)).toBe(true);
    world.day = 4;
    expect(channelSignals(world, 'urssaf-micro')).not.toEqual(a);
    expect(channelSignals(makeWorld(121, 'tiktok_only'), 'urssaf-micro')).toEqual([]);
    expect(channelSignals(world, 'pas-une-niche')).toEqual([]);
  });

  /** Every noise of the guardrail, each on its own: the signals are all an agent ever reads of the cells. */
  describe('the noise that keeps the cells hidden', () => {
    const DAYS = Array.from({ length: 40 }, (_, i) => i + 1);
    const read = (world: WorldState, nicheId: string) => DAYS.map((day) => { world.day = day; return channelSignals(world, nicheId); });
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

    it('the audience is the true fit, ±20, never the fit itself for long', () => {
      const world = makeWorld(122);
      const n = findNiche(world, 'sommeil-bebe')!;
      const days = read(world, n.id);
      for (const ch of ['tiktok', 'meta', 'youtube', 'pinterest', 'google'] as const) {
        const fit = deliverySpec(n, ch).fit * 100;
        const seen = days.map((s) => s.find((x) => x.channel === ch)!.audience);
        expect(seen.every((a) => Math.abs(a - fit) <= 20.5)).toBe(true);
        expect(seen.filter((a) => a === Math.round(fit)).length).toBeLessThan(seen.length / 4);
        expect(spread(seen)).toBeGreaterThan(15);
      }
    });

    it('the planner\'s CPC stays within 30 % of the cell, and does not give it away', () => {
      const world = makeWorld(123);
      const n = findNiche(world, 'urssaf-micro')!;
      const { cpcBase } = n.channels!.google!;
      const seen = read(world, n.id).map((s) => s.find((x) => x.channel === 'google')!.cpc!);
      expect(seen.every((c) => c >= cpcBase! * 0.69 && c <= cpcBase! * 1.31)).toBe(true);
      expect(seen.filter((c) => c === cpcBase).length).toBeLessThan(seen.length / 4);
      expect(spread(seen)).toBeGreaterThan(cpcBase! * 0.3);
    });

    it('the planner\'s volume stays within 30 % of the queries, and does not give them away', () => {
      const world = makeWorld(124);
      const n = findNiche(world, 'urssaf-micro')!;
      const truth = n.channels!.google!.searchClicksPerDemand! * n.demand;
      const seen = read(world, n.id).map((s) => s.find((x) => x.channel === 'google')!.searchClicks!);
      expect(seen.every((c) => c >= truth * 0.69 && c <= truth * 1.31)).toBe(true);
      expect(seen.filter((c) => c === Math.round(truth)).length).toBeLessThan(seen.length / 4);
      expect(spread(seen)).toBeGreaterThan(truth * 0.3);
    });
  });

  it('one virtual adapter per platform passes its channel down', () => {
    const calls: unknown[][] = [];
    const tools = {
      submitCreative: (id: string, ch?: ChannelId) => { calls.push(['review', id, ch]); return { status: 'approved', reason: null, strike: false }; },
      createCampaign: (input: { channel?: ChannelId }) => { calls.push(['create', input.channel]); return { ok: true, message: '' }; },
      updateCampaign: (id: string) => { calls.push(['update', id]); return { ok: true, message: '' }; },
      getPlatformReport: (ch: ChannelId, since?: number) => { calls.push(['report', ch, since]); return []; },
    } as unknown as MarketTools;
    const meta = virtualAdapter('meta', tools);
    expect(meta.id).toBe('meta');
    meta.review('cre_1');
    meta.createCampaign({ productId: 'p', name: 'n', creativeIds: [], dailyBudget: 12, targeting: { interests: [], ageMin: 18, ageMax: 55 }, createdBy: 'x' });
    meta.updateCampaign('cpg_1', { status: 'paused' });
    meta.report(4);
    expect(calls).toEqual([['review', 'cre_1', 'meta'], ['create', 'meta'], ['update', 'cpg_1'], ['report', 'meta', 4]]);
    calls.length = 0;
    virtualAdapter('tiktok', tools).createCampaign({ productId: 'p', name: 'n', creativeIds: [], dailyBudget: 12, targeting: { interests: [], ageMin: 18, ageMax: 55 }, createdBy: 'x' });
    expect(calls).toEqual([['create', undefined]]);
  });
});
