/**
 * The company's side of the channels' market (channels §2.3, §6, §7.5): every tool answers, each format lands where it is
 * accepted, each channel judges with its own rules, and a strike only ever costs its own account.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createRng } from '../src/core/index.js';
import type { ClaudeClientLike } from '../src/minds/claude/engine.js';
import type { AdDraft, MarketTools, MindContext, Rng, SearchAdDraft } from '../src/contracts.js';
import { HeuristicEngine } from '../src/minds/heuristic/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { AD_FORMATS } from '../src/minds/playbook.js';
import type { AdCreative, AdFormat, AgentState, ChannelControl, ChannelId, DailyAdStats, NicheTruth, Order, Product, ScenarioConfig, WorldState } from '../src/shared.js';
import { CHANNELS, acceptance } from '../src/shared.js';
import { virtualAdapter } from '../src/sim/adapters.js';
import { CHANNEL_SIM } from '../src/sim/channelBalance.js';
import { CHANNEL_RULES, findChannelViolation } from '../src/sim/compliance.js';
import { createMarketState, createMarketTools, recordLedger, scoreCreative, tickMarket } from '../src/sim/index.js';
import { NICHE_CATALOG } from '../src/sim/niches.js';
import { scoreSearchAd, scoreStaticAd } from '../src/sim/quality.js';

// ───────────────────────────── fixtures ─────────────────────────────

function makeWorld(channelControl: ChannelControl = 'none', seed = 7): { world: WorldState; rng: Rng; tools: MarketTools } {
  const rng = createRng(seed);
  const scenario: ScenarioConfig = {
    name: 'test', companyName: 'Pixel Agency', seed, startingCash: 5000, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic',
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
    market: createMarketState(scenario, rng),
    ledger: [], activity: [],
  };
  recordLedger(world, { type: 'capital', amount: 5000, memo: 'Capital de départ' });
  return { world, rng, tools: createMarketTools(world, rng) };
}

const nicheOf = (world: WorldState, id: string): NicheTruth => world.market.niches.find((n) => n.id === id)!;

function addProduct(world: WorldState, nicheId: string, id = 'prd_1'): Product {
  const n = nicheOf(world, nicheId);
  const p = {
    id, nicheId, title: n.name, subtitle: '', audience: n.audience, problem: n.problem, price: 19, status: 'live', version: 1, content: null, salesPage: null,
    design: { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'paw', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 },
    files: { pdf: `files/${id}/guide.pdf`, cover: null, salesPage: null },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [{ day: 1, price: 19 }],
  } as unknown as Product;
  world.company.products.push(p);
  return p;
}

const SEARCH = { headlines: ['Un plan clair, pas à pas', 'Les erreurs à éviter', 'Guide PDF à télécharger'], descriptions: ['Le plan en 7 étapes.', 'Télécharge le guide PDF.'], keywords: ['chat griffe', 'guide chat griffe', 'griffoir'] };

/** A creative that breaks no rule, in the shape asked for. Video by default. */
function addCreative(world: WorldState, p: Product, over: Partial<AdCreative> = {}): AdCreative {
  const c: AdCreative = {
    id: `cre_${world.company.creatives.length + 1}`, productId: p.id, hook: 'Trois gestes simples pour commencer ce soir', hookStyle: 'question', format: 'faceless_voiceover',
    scenes: [{ visual: 'Gros plan sur le carnet', onScreenText: 'Trois gestes simples', voiceover: 'Trois gestes simples pour commencer ce soir.', durationSec: 4 }],
    caption: 'Le guide est en lien.', hashtags: ['#guide', '#conseil', '#astuce'], cta: 'Télécharge le guide',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
    ...over,
  };
  world.company.creatives.push(c);
  return c;
}

const addPin = (world: WorldState, p: Product, over: Partial<AdCreative> = {}): AdCreative =>
  addCreative(world, p, { format: 'static_image', ratio: '2:3', ...over });

const addSearch = (world: WorldState, p: Product, search: AdCreative['search'] = SEARCH): AdCreative =>
  addCreative(world, p, { format: 'search_text', ratio: 'text', hook: search!.headlines[0], caption: search!.descriptions[0], hashtags: search!.keywords, scenes: [], cta: '', search });

/** Opens the channel's account for good, verification done. */
function openChannel(world: WorldState, tools: MarketTools, ch: ChannelId): void {
  expect(tools.requestChannel(ch).ok).toBe(true);
  world.market.channels!.accounts[CHANNELS[ch].account as 'meta' | 'google' | 'pinterest'].openDay = 1;
}

/** Automatic moderation can refuse a clean ad with no strike: tomorrow's draw is another one. */
function approve(world: WorldState, tools: MarketTools, id: string, ch: ChannelId): void {
  const day = world.day;
  for (let i = 0; i < 40 && tools.submitCreative(id, ch).status !== 'approved'; i++) world.day += 1;
  world.day = day;
  expect(world.company.creatives.find((c) => c.id === id)?.channelReviews?.[ch]?.status).toBe('approved');
}

const campaign = (p: Product, creativeIds: string[], channel?: ChannelId, dailyBudget = 20) =>
  ({ productId: p.id, name: 'Test', creativeIds, dailyBudget, targeting: { interests: [], ageMin: 25, ageMax: 45 }, createdBy: 'test', ...(channel ? { channel } : {}) });

const adSpend = (world: WorldState): number => world.ledger.filter((e) => e.type === 'ad_spend').length;
const statusOf = (tools: MarketTools, id: ChannelId) => tools.channelStatus().find((s) => s.id === id)!;

function row(over: Partial<DailyAdStats>): DailyAdStats {
  return {
    day: 3, campaignId: 'cpg_1', creativeId: 'cre_1', productId: 'prd_1', spend: 10, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 0.5, cpm: 10,
    landingViews: 15, purchases: 1, revenue: 19, roas: 1.9, frequency: 1.1, comments: [], ...over,
  };
}

function order(over: Partial<Order>): Order {
  return { id: 'ord_1', day: 3, customerId: 'cus_1', productId: 'prd_1', price: 19, source: 'ads', campaignId: 'cpg_1', creatorId: null, refunded: false, chargeback: false, ...over };
}

// ───────────────────────────── formats ─────────────────────────────

describe('formats are rules, not labels', () => {
  it('a static pin is refused on YouTube, a 9:16 accepted at 0,7 on Pinterest, a video refused on Google', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    for (const ch of ['youtube', 'pinterest', 'google'] as const) openChannel(world, tools, ch);
    const pin = addPin(world, p);
    const video = addCreative(world, p);
    expect(acceptance('youtube', pin)).toBeNull();
    expect(acceptance('pinterest', video)).toBe(0.7);
    expect(acceptance('google', video)).toBeNull();

    const onYoutube = tools.submitCreative(pin.id, 'youtube');
    expect(onYoutube).toMatchObject({ status: 'rejected', strike: false, channel: 'youtube' });
    expect(onYoutube.reason).toContain('YouTube Shorts');
    expect(tools.createCampaign(campaign(p, [pin.id], 'youtube')).message).toBe('Aucune créa acceptée par YouTube Shorts : il faut du 9:16.');
    expect(tools.createCampaign(campaign(p, [video.id], 'google')).message).toBe('Aucune créa acceptée par Google Search : il faut du texte.');

    approve(world, tools, video.id, 'pinterest');
    expect(tools.createCampaign(campaign(p, [video.id], 'pinterest')).ok).toBe(true);
  });

  it('an accepted creative is not enough: the channel must have approved it, and a refused format is dropped from a mix', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'pinterest');
    const pin = addPin(world, p);
    const cover = addCreative(world, p, { ratio: '4:5' }); // a Meta cut: refused on Pinterest even if someone approved it
    cover.channelReviews = { pinterest: { status: 'approved', reason: null, day: 1 } };
    expect(tools.createCampaign(campaign(p, [pin.id], 'pinterest')).message).toContain('soumettez');
    approve(world, tools, pin.id, 'pinterest');
    const res = tools.createCampaign(campaign(p, [pin.id, cover.id], 'pinterest'));
    expect(res.ok).toBe(true);
    expect(world.company.campaigns.find((c) => c.id === res.id)?.creativeIds).toEqual([pin.id]);
  });

  it('a TikTok campaign takes no cut made for another channel', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    const cut = addCreative(world, p, { ratio: '4:5' });
    expect(tools.createCampaign(campaign(p, [cut.id])).ok).toBe(false);
    const master = addCreative(world, p);
    const res = tools.createCampaign(campaign(p, [cut.id, master.id]));
    expect(res.ok).toBe(true);
    expect(world.company.campaigns.find((c) => c.id === res.id)?.creativeIds).toEqual([master.id]);
  });
});

// ───────────────────────────── compliance ─────────────────────────────

describe('each channel judges with its own rules', () => {
  it('Meta rejects the ventre guide, strike on Meta, TikTok account untouched', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'ventre-apres-40');
    openChannel(world, tools, 'meta');
    const c = addCreative(world, p, { hook: 'Ce ventre qui reste malgré tes efforts', scenes: [{ visual: 'Plan serré', onScreenText: 'Ce ventre qui reste', voiceover: 'Ce ventre qui reste malgré tes efforts.', durationSec: 4 }] });
    const res = tools.submitCreative(c.id, 'meta');
    expect(res).toMatchObject({ status: 'rejected', strike: true, rule: 'meta.image_du_corps', channel: 'meta' });
    expect(res.reason).toContain('Facebook & Instagram');
    expect(res.reason).toContain('« ventre »'); // what a writer can avoid is a word
    expect(c.channelReviews?.meta).toMatchObject({ status: 'rejected', rule: 'meta.image_du_corps', day: 1 });
    expect(statusOf(tools, 'meta').strikes).toBe(1);
    expect(world.market.adAccount.strikes).toBe(0);
    expect(c.review.status).toBe('approved'); // TikTok's own verdict did not move
    expect(world.market.events.filter((e) => e.kind === 'ad_rejected')).toHaveLength(1);
    expect(world.market.events[0]!.title).toContain('Facebook & Instagram');
  });

  it('a channel rule without a strike refuses and costs the account nothing', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'sommeil-bebe');
    openChannel(world, tools, 'meta');
    const c = addCreative(world, p, { hook: 'Je craque, il se réveille toutes les 2 heures', scenes: [] });
    expect(tools.submitCreative(c.id, 'meta')).toMatchObject({ status: 'rejected', strike: false, rule: 'meta.detresse' });
    expect(statusOf(tools, 'meta').strikes).toBe(0);
  });

  it('a strike rule is never hidden behind a rule that does not cost one', () => {
    const { world } = makeWorld();
    const p = addProduct(world, 'sommeil-bebe');
    const c = addCreative(world, p, { hook: 'Je craque avec ce ventre', scenes: [] });
    expect(findChannelViolation(c, 'meta', p)?.id).toBe('meta.image_du_corps');
    for (const rules of Object.values(CHANNEL_RULES)) {
      const firstSoft = rules.findIndex((r) => !r.strike);
      if (firstSoft >= 0) expect(rules.slice(firstSoft).every((r) => !r.strike)).toBe(true);
    }
  });

  it('Pinterest rejects the ventre niche even with a clean hook, no spend', () => {
    const { world, rng, tools } = makeWorld();
    const p = addProduct(world, 'ventre-apres-40');
    openChannel(world, tools, 'pinterest');
    const pin = addPin(world, p); // the hook says nothing of the body: the rule reads the landing
    expect(tools.submitCreative(pin.id, 'pinterest')).toMatchObject({ status: 'rejected', strike: false, rule: 'pinterest.perte_de_poids' });
    expect(tools.createCampaign(campaign(p, [pin.id], 'pinterest')).ok).toBe(false);
    tickMarket(world, rng);
    expect(adSpend(world)).toBe(0);
    expect(statusOf(tools, 'pinterest').strikes).toBe(0);
    // the same pin for another guide passes: the rule is the landing's, not the pin's
    expect(findChannelViolation(addPin(world, addProduct(world, 'chat-griffe-canape', 'prd_2')), 'pinterest', world.company.products[1]!)).toBeNull();
  });

  it('an income promise is refused with a strike on Meta and Pinterest, a generic banned claim everywhere', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    openChannel(world, tools, 'pinterest');
    const money = addCreative(world, p, { hook: 'Gagne 300 € par mois avec ton chat', scenes: [] });
    expect(tools.submitCreative(money.id, 'meta')).toMatchObject({ strike: true, rule: 'meta.revenu' });
    const pin = addPin(world, p, { hook: 'Gagne 300 euros / semaine', scenes: [] });
    expect(tools.submitCreative(pin.id, 'pinterest')).toMatchObject({ strike: true, rule: 'pinterest.revenu' });
    const claim = addCreative(world, p, { hook: 'Un canapé sauvé, résultat assuré', scenes: [] });
    const res = tools.submitCreative(claim.id, 'meta');
    expect(res).toMatchObject({ status: 'rejected', strike: true });
    expect(res.rule).toBeUndefined();
    expect(res.reason).toContain('résultat assuré');
    expect(statusOf(tools, 'meta').strikes).toBe(2);
    expect(statusOf(tools, 'pinterest').strikes).toBe(1);
  });

  it('Google reads each rule on its own text: titles for the brand, titles and descriptions for superlatives, the raw text for punctuation', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'urssaf-micro');
    openChannel(world, tools, 'google');
    const ad = (over: Partial<SearchAdDraft>) => addSearch(world, p, { ...SEARCH, ...over });
    const verdict = (c: AdCreative) => tools.submitCreative(c.id, 'google');
    expect(verdict(ad({ headlines: ['Guide URSSAF micro', ...SEARCH.headlines.slice(1)] })).rule).toBe('google.marque');
    expect(verdict(ad({ headlines: ['Le meilleur plan', ...SEARCH.headlines.slice(1)] })).rule).toBe('google.superlatif');
    expect(verdict(ad({ descriptions: ['La méthode n°1 du marché.', SEARCH.descriptions[1]!] })).rule).toBe('google.superlatif');
    expect(verdict(ad({ headlines: ['Enfin un plan !', ...SEARCH.headlines.slice(1)] })).rule).toBe('google.ponctuation');
    expect(verdict(ad({ headlines: ['DÉCLARE AUJOURDHUI', ...SEARCH.headlines.slice(1)] })).rule).toBe('google.ponctuation');
    expect(findChannelViolation(ad({ descriptions: ['Pour vos cotisations URSSAF.', SEARCH.descriptions[1]!] }), 'google', p)).toBeNull(); // brand: titles only
    expect(findChannelViolation(ad({ keywords: ['urssaf micro', 'guide urssaf', 'cotisations'] }), 'google', p)).toBeNull(); // a keyword bids, it does not show
    expect(statusOf(tools, 'google').strikes).toBe(0);
  });

  it('a video is judged on its hook and scenes, not on a caption the rule does not read', () => {
    const { world } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    expect(findChannelViolation(addCreative(world, p, { caption: 'Pour ton ventre' }), 'meta', p)).toBeNull();
    expect(findChannelViolation(addCreative(world, p, { hook: 'Une aventure au ventre', scenes: [] }), 'meta', p)?.id).toBe('meta.image_du_corps');
    expect(findChannelViolation(addCreative(world, p, { hook: 'Une aventure à vivre', scenes: [] }), 'meta', p)).toBeNull(); // word boundary: « aventure »
  });
});

describe('strikes count on the account', () => {
  it('2 Google strikes stop Search and YouTube', () => {
    const { world, rng, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'google');
    openChannel(world, tools, 'youtube');
    openChannel(world, tools, 'meta');
    const video = addCreative(world, p);
    const metaVideo = addCreative(world, p, { ratio: '4:5' });
    const ad = addSearch(world, p);
    approve(world, tools, video.id, 'youtube');
    approve(world, tools, ad.id, 'google');
    approve(world, tools, metaVideo.id, 'meta');
    const youtube = tools.createCampaign(campaign(p, [video.id], 'youtube'));
    expect(youtube.ok).toBe(true);
    const meta = tools.createCampaign(campaign(p, [metaVideo.id], 'meta'));
    expect(meta.ok).toBe(true);

    // one strike from each side of the same account
    const health = addSearch(world, p, { ...SEARCH, descriptions: ['Ce traitement pour griffes.', SEARCH.descriptions[1]!] });
    expect(tools.submitCreative(health.id, 'google')).toMatchObject({ strike: true, rule: 'google.sante' });
    expect(statusOf(tools, 'youtube').state).toBe('open');
    expect(statusOf(tools, 'youtube').strikes).toBe(1);
    const healthVideo = addCreative(world, p, { hook: 'Soigner un chat griffeur', scenes: [] });
    expect(tools.submitCreative(healthVideo.id, 'youtube')).toMatchObject({ strike: true, rule: 'google.sante' });

    for (const ch of ['google', 'youtube'] as const) {
      expect(statusOf(tools, ch)).toMatchObject({ state: 'banned', strikes: 2, bannedUntilDay: 1 + CHANNEL_SIM[ch].banDays });
      expect(tools.createCampaign(campaign(p, [ch === 'google' ? ad.id : video.id], ch)).ok).toBe(false);
      expect(tools.submitCreative(ch === 'google' ? ad.id : video.id, ch)).toMatchObject({ status: 'rejected', strike: false });
    }
    expect(world.market.events.filter((e) => e.kind === 'channel_account_banned')).toHaveLength(1);
    expect(world.market.events.find((e) => e.kind === 'channel_account_banned')?.title).toContain('YouTube Shorts et Google Search');
    expect(statusOf(tools, 'meta').state).toBe('open');
    expect(statusOf(tools, 'tiktok').state).toBe('open');

    tickMarket(world, rng); // the running YouTube campaign stops, Meta's goes on
    const today = world.market.adStats.filter((s) => s.day === 1);
    expect(today.some((s) => s.channel === 'youtube')).toBe(false);
    expect(today.some((s) => s.channel === 'meta')).toBe(true);
    const paused = world.company.campaigns.find((c) => c.id === youtube.id)!;
    expect(tools.updateCampaign(paused.id, { status: 'paused' }).ok).toBe(true);
    expect(tools.updateCampaign(paused.id, { status: 'active' }).ok).toBe(false);
  });

  it('Meta bans at 3 strikes and Pinterest keeps running; the ban ends with its term', () => {
    const { world, rng, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    openChannel(world, tools, 'pinterest');
    for (let i = 0; i < CHANNEL_SIM.meta.strikes; i++) {
      expect(statusOf(tools, 'meta').state).toBe('open');
      expect(tools.submitCreative(addCreative(world, p, { hook: 'Perdre du poids', scenes: [] }).id, 'meta').strike).toBe(true);
    }
    expect(statusOf(tools, 'meta')).toMatchObject({ state: 'banned', bannedUntilDay: 1 + CHANNEL_SIM.meta.banDays });
    expect(statusOf(tools, 'pinterest').state).toBe('open');
    const pin = addPin(world, p);
    approve(world, tools, pin.id, 'pinterest');
    expect(tools.createCampaign(campaign(p, [pin.id], 'pinterest')).ok).toBe(true);
    world.day = 1 + CHANNEL_SIM.meta.banDays;
    expect(statusOf(tools, 'meta').state).toBe('open');
    tickMarket(world, rng);
    expect(statusOf(tools, 'meta')).toMatchObject({ state: 'open', strikes: 0 });
  });

  it('a strike on the day the ban ends starts a new count, it does not ban again', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'google');
    const bad = () => addCreative(world, p, { hook: 'Soigner un chat griffeur', scenes: [] }).id;
    tools.submitCreative(bad(), 'youtube');
    tools.submitCreative(bad(), 'youtube');
    world.day = 1 + CHANNEL_SIM.youtube.banDays; // the market has not ticked yet today
    expect(tools.submitCreative(bad(), 'youtube').strike).toBe(true);
    expect(statusOf(tools, 'youtube')).toMatchObject({ state: 'open', strikes: 1 });
  });

  it('a TikTok strike costs TikTok alone', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    const c = addCreative(world, p, { hook: 'Résultat assuré', review: { status: 'pending', reason: null, day: null } });
    const res = tools.submitCreative(c.id);
    expect(res).toMatchObject({ status: 'rejected', strike: true });
    expect(res.channel).toBeUndefined();
    expect(c.channelReviews).toBeUndefined();
    expect(statusOf(tools, 'tiktok').strikes).toBe(1);
    expect(statusOf(tools, 'meta').strikes).toBe(0);
  });
});

describe('automatic moderation of a channel', () => {
  /** Verdicts of many clean creatives of a risky niche, in order. */
  function verdicts(seed: number): string[] {
    const { world, tools } = makeWorld('none', seed);
    const p = addProduct(world, 'chat-griffe-canape');
    nicheOf(world, p.nicheId).complianceRisk = 1;
    openChannel(world, tools, 'meta');
    return Array.from({ length: 120 }, () => tools.submitCreative(addCreative(world, p).id, 'meta').status);
  }

  it('refuses some clean ads, with no strike, at the channel rate, and the same seed gives the same verdicts', () => {
    const a = verdicts(7);
    expect(a).toEqual(verdicts(7));
    expect(a).not.toEqual(verdicts(8));
    const refused = a.filter((s) => s === 'rejected').length / a.length;
    expect(refused).toBeGreaterThan(CHANNEL_SIM.meta.falsePositive / 2);
    expect(refused).toBeLessThan(CHANNEL_SIM.meta.falsePositive * 1.75);
  });

  it('draws from its own stream, never from the tools rng', () => {
    const { world, rng, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    const before = rng.state();
    for (let i = 0; i < 20; i++) tools.submitCreative(addCreative(world, p).id, 'meta');
    expect(rng.state()).toBe(before);
  });

  it('never re-rolls an approved creative', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    nicheOf(world, p.nicheId).complianceRisk = 1;
    openChannel(world, tools, 'meta');
    const c = addCreative(world, p);
    approve(world, tools, c.id, 'meta');
    for (let day = 1; day < 60; day++) {
      world.day = day;
      expect(tools.submitCreative(c.id, 'meta').status).toBe('approved');
    }
  });
});

// ───────────────────────────── the tools of §2.3 ─────────────────────────────

describe('channel accounts', () => {
  it('a channel opens through verification, each with its own days', () => {
    const { world, tools } = makeWorld();
    expect(tools.channelStatus().map((s) => [s.id, s.state])).toEqual([['tiktok', 'open'], ['meta', 'closed'], ['youtube', 'closed'], ['pinterest', 'closed'], ['google', 'closed']]);
    world.day = 10;
    const res = tools.requestChannel('meta');
    expect(res.ok).toBe(true);
    expect(res.message).toContain('jour 13');
    expect(statusOf(tools, 'meta')).toMatchObject({ state: 'verifying', openDay: 13 });
    expect(tools.requestChannel('meta').ok).toBe(true); // asked twice: same day
    expect(statusOf(tools, 'meta').openDay).toBe(13);
    world.day = 13;
    expect(statusOf(tools, 'meta').state).toBe('open');
    expect(tools.requestChannel('meta').message).toContain('déjà ouvert');
    expect(statusOf(tools, 'pinterest').state).toBe('closed');
  });

  it('YouTube and Search are one account: asking for the second finds it verified', () => {
    const { world, tools } = makeWorld();
    tools.requestChannel('youtube');
    expect(statusOf(tools, 'google')).toMatchObject({ state: 'verifying', openDay: 2 });
    world.day = 2;
    expect(tools.requestChannel('google').ok).toBe(true);
    expect(statusOf(tools, 'google')).toMatchObject({ state: 'open', openDay: 2 });
  });

  it('a campaign needs an open account, its minimum budget, and carries its channel, its learning phase and its test flag', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    const c = addCreative(world, p, { ratio: '4:5' });
    expect(tools.createCampaign(campaign(p, [c.id], 'meta')).message).toContain("n'est pas ouvert");
    tools.requestChannel('meta');
    expect(tools.submitCreative(c.id, 'meta').reason).toContain('jour 4');
    expect(tools.createCampaign(campaign(p, [c.id], 'meta')).message).toContain('jour 4');
    world.day = 4;
    approve(world, tools, c.id, 'meta');
    expect(tools.createCampaign(campaign(p, [c.id], 'meta', 11)).message).toContain('12 €');
    const res = tools.createCampaign({ ...campaign(p, [c.id], 'meta', 12), test: true });
    expect(res.ok).toBe(true);
    expect(world.company.campaigns.find((x) => x.id === res.id)).toMatchObject({ channel: 'meta', learning: { events: 0, exitedDay: null }, test: true });
  });

  it('a TikTok campaign keeps its bytes: no channel, no learning, no test', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    const res = tools.createCampaign(campaign(p, [addCreative(world, p).id]));
    const c = world.company.campaigns.find((x) => x.id === res.id)!;
    expect(Object.keys(c)).toEqual(['id', 'productId', 'name', 'creativeIds', 'dailyBudget', 'status', 'targeting', 'startDay', 'createdBy']);
  });

  it('a raise over 30 % or new creatives start the learning phase over, a smaller raise does not, and the channel minimum holds', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    const [a, b] = [addCreative(world, p, { ratio: '4:5' }), addCreative(world, p, { ratio: '4:5' })];
    approve(world, tools, a.id, 'meta');
    approve(world, tools, b.id, 'meta');
    const id = tools.createCampaign(campaign(p, [a.id], 'meta', 40)).id!;
    const camp = world.company.campaigns.find((c) => c.id === id)!;
    const leftLearning = () => { camp.learning = { events: 12, exitedDay: 3 }; };

    leftLearning();
    expect(tools.updateCampaign(id, { dailyBudget: 48 }).ok).toBe(true); // +20 %
    expect(camp.learning?.exitedDay).toBe(3);
    leftLearning();
    tools.updateCampaign(id, { dailyBudget: 62.4 }); // +30 % exactly, what the allocator may do
    expect(camp.learning?.exitedDay).toBe(3);
    tools.updateCampaign(id, { dailyBudget: 93.6 }); // +50 %
    expect(camp.learning).toEqual({ events: 0, exitedDay: null });
    leftLearning();
    tools.updateCampaign(id, { creativeIds: [a.id, b.id] });
    expect(camp.learning).toEqual({ events: 0, exitedDay: null });
    expect(tools.updateCampaign(id, { dailyBudget: 11 }).ok).toBe(false);
    expect(camp.dailyBudget).toBe(93.6);
  });

  it('a refused patch changes nothing: no budget slips through, no learning restarts, and the next good patch still reads it', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    const [a, b] = [addCreative(world, p, { ratio: '4:5' }), addCreative(world, p, { ratio: '4:5' })];
    approve(world, tools, a.id, 'meta');
    approve(world, tools, b.id, 'meta');
    const id = tools.createCampaign(campaign(p, [a.id], 'meta', 20)).id!;
    const camp = world.company.campaigns.find((c) => c.id === id)!;
    camp.learning = { events: 12, exitedDay: 3, days: 3 };
    const before = structuredClone(camp);

    expect(tools.updateCampaign(id, { dailyBudget: 200, creativeIds: ['nope'] }).ok).toBe(false);
    expect(camp).toEqual(before);

    camp.status = 'paused';
    p.status = 'paused'; // a resume that cannot happen takes the raise and the new mix down with it
    const paused = structuredClone(camp);
    expect(tools.updateCampaign(id, { dailyBudget: 200, creativeIds: [b.id], status: 'active' }).ok).toBe(false);
    expect(camp).toEqual(paused);
    p.status = 'live';

    expect(tools.updateCampaign(id, { dailyBudget: 200 }).ok).toBe(true);
    expect(camp.dailyBudget).toBe(200);
    expect(camp.learning).toEqual({ events: 0, exitedDay: null }); // the raise that was refused still counts in full once accepted
  });

  it('a patch that holds applies whole: budget, mix and status land together', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'meta');
    const [a, b] = [addCreative(world, p, { ratio: '4:5' }), addCreative(world, p, { ratio: '4:5' })];
    approve(world, tools, a.id, 'meta');
    approve(world, tools, b.id, 'meta');
    const id = tools.createCampaign(campaign(p, [a.id], 'meta', 40)).id!;
    const camp = world.company.campaigns.find((c) => c.id === id)!;
    camp.status = 'paused';
    camp.learning = { events: 12, exitedDay: 3, days: 3 };
    const res = tools.updateCampaign(id, { dailyBudget: 44, creativeIds: [a.id, b.id], status: 'active' });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('budget');
    expect(res.message).toContain('2 créatif(s)');
    expect(res.message).toContain('réactivée');
    expect(camp).toMatchObject({ dailyBudget: 44, creativeIds: [a.id, b.id], status: 'active', learning: { events: 0, exitedDay: null } });
  });

  it('asking again while verifying never pushes the opening back: a daily request still opens the channel', () => {
    const { world, tools } = makeWorld();
    world.day = 10;
    tools.requestChannel('meta');
    for (world.day = 11; world.day < 13; world.day++) {
      expect(tools.requestChannel('meta').message).toContain('jour 13');
      expect(statusOf(tools, 'meta')).toMatchObject({ state: 'verifying', openDay: 13 });
    }
    expect(world.day).toBe(13);
    expect(statusOf(tools, 'meta').state).toBe('open');
  });

  it('on a TikTok-only world the channels stay closed and the tools say so', () => {
    const { world, tools } = makeWorld('tiktok_only');
    const p = addProduct(world, 'chat-griffe-canape');
    expect(tools.channelStatus().map((s) => s.state)).toEqual(['open', 'closed', 'closed', 'closed', 'closed']);
    expect(tools.requestChannel('meta').ok).toBe(false);
    expect(tools.channelSignals('chat-griffe-canape')).toEqual([]);
    expect(tools.createCampaign(campaign(p, [addCreative(world, p).id], 'meta')).ok).toBe(false);
    expect(tools.submitCreative(addCreative(world, p).id, 'meta')).toMatchObject({ status: 'rejected', strike: false });
    expect(world.market.channels).toBeUndefined();
  });
});

describe('what the agency reads', () => {
  it('channelSignals answers per channel, Search with its volume and cost, and never gives the truth away', () => {
    const { world, tools } = makeWorld();
    const signals = tools.channelSignals('urssaf-micro');
    expect(signals.map((s) => s.channel)).toEqual(['tiktok', 'meta', 'youtube', 'pinterest', 'google']);
    for (const s of signals) {
      expect(s.audience).toBeGreaterThanOrEqual(0);
      expect(s.audience).toBeLessThanOrEqual(100);
      expect(['bas', 'moyen', 'élevé']).toContain(s.costHint);
    }
    const search = signals.find((s) => s.channel === 'google')!;
    expect(search.searchClicks).toBeGreaterThan(0);
    expect(search.cpc).toBeGreaterThan(0);
    expect(tools.channelSignals('urssaf-micro')).toEqual(signals); // the same day reads the same
    expect(tools.channelSignals('inconnue')).toEqual([]);
    expect(JSON.stringify(signals)).not.toMatch(/fit|cpmMult|intent|poolShare/);
    world.day = 2;
    expect(tools.channelSignals('urssaf-micro')).not.toEqual(signals);
  });

  it('getAdStats keeps each channel apart, TikTok by default', () => {
    const { world, tools } = makeWorld();
    world.market.adStats.push(row({ day: 2 }), row({ day: 3 }), row({ day: 3, channel: 'meta' }), row({ day: 3, channel: 'youtube' }));
    expect(tools.getAdStats().map((s) => s.day)).toEqual([2, 3]);
    expect(tools.getAdStats(3).map((s) => s.channel ?? 'tiktok')).toEqual(['tiktok']);
    expect(tools.getAdStats(3, 'meta').map((s) => s.channel)).toEqual(['meta']);
    expect(tools.getAdStats(0, 'pinterest')).toEqual([]);
  });

  it('getPlatformReport adds the rows of a campaign up, and says what the platform claims', () => {
    const { world, tools } = makeWorld();
    world.market.adStats.push(
      row({ channel: 'meta', campaignId: 'cpg_2', spend: 10.1, purchases: 1, revenue: 19, claimedPurchases: 2, claimedRevenue: 38.4 }),
      row({ channel: 'meta', campaignId: 'cpg_2', creativeId: 'cre_2', spend: 5.2, purchases: 1, revenue: 19 }), // no claim written: the shop's numbers
      row({ channel: 'meta', campaignId: 'cpg_3', day: 4, spend: 7, purchases: 0, revenue: 0 }),
      row({ channel: 'youtube', campaignId: 'cpg_4' }),
    );
    expect(tools.getPlatformReport('meta')).toEqual([
      { day: 3, channel: 'meta', campaignId: 'cpg_2', spend: 15.3, claimedPurchases: 3, claimedRevenue: 57.4 },
      { day: 4, channel: 'meta', campaignId: 'cpg_3', spend: 7, claimedPurchases: 0, claimedRevenue: 0 },
    ]);
    expect(tools.getPlatformReport('meta', 4)).toHaveLength(1);
    expect(tools.getPlatformReport('google')).toEqual([]);
  });

  it('getShopAttribution reads the orders by last click: an ad order names its campaign, any other reads null', () => {
    const { world, tools } = makeWorld();
    world.market.orders.push(
      order({ id: 'a' }), order({ id: 'b', price: 21.5 }),
      order({ id: 'c', channel: 'meta', campaignId: 'cpg_2' }),
      order({ id: 'd', source: 'organic', campaignId: null }),
      order({ id: 'e', source: 'upsell', campaignId: 'cpg_1', day: 4 }), // the parent's campaign: its ad did not sell this one
    );
    expect(tools.getShopAttribution()).toEqual([
      { day: 3, channel: 'tiktok', campaignId: 'cpg_1', sales: 2, revenue: 40.5 },
      { day: 3, channel: 'meta', campaignId: 'cpg_2', sales: 1, revenue: 19 },
      { day: 3, channel: 'tiktok', campaignId: null, sales: 1, revenue: 19 },
      { day: 4, channel: 'tiktok', campaignId: null, sales: 1, revenue: 19 },
    ]);
    expect(tools.getShopAttribution(4)).toHaveLength(1);
  });

  it('a real market day: the shop agrees with the ad rows, campaign by campaign, on every channel', () => {
    const { world, rng, tools } = makeWorld();
    const p = addProduct(world, 'sommeil-bebe');
    openChannel(world, tools, 'meta');
    const tiktok = addCreative(world, p);
    const meta = addCreative(world, p, { ratio: '4:5' });
    approve(world, tools, meta.id, 'meta');
    expect(tools.createCampaign(campaign(p, [tiktok.id], undefined, 80)).ok).toBe(true);
    expect(tools.createCampaign(campaign(p, [meta.id], 'meta', 80)).ok).toBe(true);
    for (let d = 1; d <= 6; d++) { world.day = d; tickMarket(world, rng); }
    const byCampaign = new Map<string, number>();
    for (const s of world.market.adStats) byCampaign.set(s.campaignId, (byCampaign.get(s.campaignId) ?? 0) + s.revenue);
    const shop = tools.getShopAttribution().filter((r) => r.campaignId);
    expect(new Set(shop.map((r) => r.channel))).toEqual(new Set(['tiktok', 'meta']));
    for (const [id, revenue] of byCampaign) expect(shop.filter((r) => r.campaignId === id).reduce((s, r) => s + r.revenue, 0)).toBeCloseTo(revenue, 2);
    const spend = tools.getPlatformReport('meta').reduce((s, r) => s + r.spend, 0);
    expect(spend).toBeCloseTo(tools.getAdStats(0, 'meta').reduce((s, r) => s + r.spend, 0), 2);
  });

  it('five virtual adapters answer through the same tools', () => {
    const { world, tools } = makeWorld();
    const p = addProduct(world, 'chat-griffe-canape');
    openChannel(world, tools, 'pinterest');
    const adapter = virtualAdapter('pinterest', tools);
    const pin = addPin(world, p);
    expect(adapter.review(pin.id).channel).toBe('pinterest');
    approve(world, tools, pin.id, 'pinterest');
    const res = adapter.createCampaign(campaign(p, [pin.id]));
    expect(res.ok).toBe(true);
    expect(world.company.campaigns.find((c) => c.id === res.id)?.channel).toBe('pinterest');
    expect(adapter.updateCampaign(res.id!, { dailyBudget: 7 }).ok).toBe(true);
    expect(adapter.report()).toEqual([]);
  });
});

// ───────────────────────────── scorers ─────────────────────────────

describe('scorers of the new formats', () => {
  const { world } = makeWorld();
  const n = nicheOf(world, 'urssaf-micro');
  const p = addProduct(world, 'urssaf-micro');
  const pinOf = (over: Partial<AdCreative>) => ({
    ...addPin(world, p, { hook: 'Peur de te tromper dans la déclaration ?', scenes: [{ visual: 'Image unique sur la couverture', onScreenText: 'Peur de te tromper dans la déclaration ?', voiceover: '', durationSec: 5 }] }), ...over,
  });
  const scene = (onScreenText: string) => [{ visual: 'Image unique sur la couverture', onScreenText, voiceover: '', durationSec: 5 }];

  it('scoreCreative hands a pin to the static scorer, a text ad to the search scorer, and a video stays a script', () => {
    const pin = pinOf({});
    expect(scoreCreative(pin, p, n.voc)).toEqual(scoreStaticAd(pin, p, n.voc));
    const ad = addSearch(world, p);
    expect(scoreCreative(ad, p, n.voc)).toEqual(scoreSearchAd(ad, p, n.voc));
    expect(scoreCreative({ ...pin, format: 'carousel' }, p, n.voc)).not.toEqual(scoreStaticAd(pin, p, n.voc));
  });

  it('a pin is short, names the problem, says where to go and stays legible', () => {
    const good = scoreStaticAd(pinOf({}), p, n.voc);
    expect(good.blocking).toEqual([]);
    expect(good.overall).toBeGreaterThanOrEqual(70);
    const longHook = 'Peur de te tromper dans la déclaration de chiffre d’affaires et de payer une pénalité ?';
    const long = scoreStaticAd(pinOf({ hook: longHook, scenes: scene(longHook) }), p, n.voc);
    expect(long.overall).toBeLessThan(good.overall);
    expect(long.issues.join(' ')).toContain('caractères');
    const vague = scoreStaticAd(pinOf({ hook: 'Deux secondes de ton temps', scenes: scene('Deux secondes de ton temps') }), p, n.voc);
    expect(vague.overall).toBeLessThan(good.overall);
    expect(vague.blocking?.map((b) => b.dimension)).toContain('specificity');
    const noCta = scoreStaticAd(pinOf({ cta: '' }), p, n.voc);
    expect(noCta.overall).toBeLessThan(good.overall);
    expect(noCta.blocking?.map((b) => b.dimension)).toContain('actionability');
    const wall = `${'Peur de te tromper dans la déclaration '.repeat(3)}?`;
    expect(scoreStaticAd(pinOf({ scenes: scene(wall) }), p, n.voc).design).toBeLessThan(good.design);
    const claim = scoreStaticAd(pinOf({ hook: 'Peur de la déclaration ? Résultat assuré' }), p, n.voc);
    expect(claim.compliance).toBeLessThan(good.compliance);
  });

  it('a search ad needs what was typed in a title, its limits and a call to action', () => {
    const search = { headlines: ['Guide URSSAF micro', 'Peur de te tromper', 'Plan de 7 jours, pas à pas'], descriptions: ['La déclaration de chiffre d’affaires, sans pénalité.', 'Télécharge le guide PDF : 7 étapes.'], keywords: ['urssaf micro', 'guide urssaf micro', 'declaration urssaf'] };
    const score = (over: Partial<SearchAdDraft>) => scoreSearchAd(addSearch(world, p, { ...search, ...over }), p, n.voc);
    const good = score({});
    expect(good.blocking).toEqual([]);
    expect(good.overall).toBeGreaterThanOrEqual(70);

    const withoutBrand = score({ headlines: ['Un guide micro-entreprise', 'Peur de te tromper', 'Plan de 7 jours, pas à pas'] });
    expect(withoutBrand.overall).toBeLessThan(good.overall - 5); // the price of google.marque: the click costs more
    expect(score({ headlines: ['Un plan', 'Une méthode', 'Un guide'] }).blocking?.map((b) => b.text).join(' ')).toContain('mot-clé principal');
    expect(score({ headlines: ['Guide URSSAF micro', 'Peur de te tromper'] }).blocking?.map((b) => b.dimension)).toContain('structure');
    expect(score({ headlines: ['Guide URSSAF micro avec bien trop de mots', 'Peur de te tromper', 'Plan de 7 jours'] }).structure).toBeLessThan(good.structure);
    expect(score({ descriptions: [search.descriptions[0]!, 'x'.repeat(91)] }).structure).toBeLessThan(good.structure);
    expect(score({ descriptions: ['Une explication.', 'Encore une autre.'] }).blocking?.map((b) => b.dimension)).toContain('actionability');
    expect(score({ headlines: ['Guide URSSAF micro', 'Guide URSSAF micro', 'Plan de 7 jours'] }).design).toBeLessThan(good.design);
    expect(scoreSearchAd(addCreative(world, p, { format: 'search_text', ratio: 'text', scenes: [] }), p, n.voc).overall).toBeLessThan(40);
  });
});

// ───────────────────────────── writers ─────────────────────────────

function context(over: Partial<MindContext> = {}): MindContext {
  const agent = { id: 'sarah', name: 'Sarah', role: 'Rédactrice', dept: 'growth', isChief: false, persona: '', skills: [], tools: [] } as unknown as AgentState;
  return { agent, playbook: [], brainNotes: [], lessons: [], day: 3, ...over };
}

const CRAFT = { skill: 'copy', t: 0.2, flaw: 0.9, draws: 1, eye: 0, sharp: 1, passes: 0, reach: 0 } as const;

function guide(n: NicheTruth): Product {
  return { id: 'prd_1', nicheId: n.id, title: n.name, subtitle: '', audience: n.audience, problem: n.problem, price: 19, stats: { reviews: [] }, content: null } as unknown as Product;
}

const asCreative = (ad: SearchAdDraft): AdCreative => ({
  id: 'cre_1', productId: 'prd_1', format: 'search_text', ratio: 'text', hook: ad.headlines[0]!, hookStyle: 'question', caption: ad.descriptions[0]!, hashtags: ad.keywords, scenes: [], cta: '', search: ad,
  files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: 1, createdBy: 'sarah',
});

describe('writers of the new formats', () => {
  const engine = () => new HeuristicEngine({ seed: 7 });

  it('a pin never carries a sentence cut in two: its line gives way to the problem, whole', async () => {
    for (const n of NICHE_CATALOG) {
      const hook = `5 choses à arrêter si ${n.voc.pains[0]!.toLowerCase()} et que rien de tout ce que vous avez essayé ne change quoi que ce soit à la situation`;
      const ad = await engine().writeAd({ product: guide(n), voc: n.voc, hook, hookStyle: 'listicle', format: 'static_image', bannedClaims: [] }, context());
      expect(hook.startsWith(ad.hook), n.id).toBe(false);
    }
  });

  it('AD_FORMATS stays the four bandit arms, and a static_image comes back a static_image of one scene', async () => {
    expect([...AD_FORMATS]).toEqual(['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel']);
    for (const n of NICHE_CATALOG) {
      const hook = `On a lu tous les commentaires sur ${n.keywords[0]}, une phrase revient tout le temps, et elle dit tout du problème.`;
      const ad = await engine().writeAd({ product: guide(n), voc: n.voc, hook, hookStyle: 'story', format: 'static_image', bannedClaims: n.voc.bannedClaims }, context());
      expect(ad.format).toBe('static_image');
      expect(ad.scenes).toHaveLength(1);
      expect(ad.hook.length).toBeLessThanOrEqual(60);
      expect(ad.scenes[0]!.onScreenText.length).toBeLessThanOrEqual(50);
      expect(ad.scenes[0]!.voiceover).toBe('');
      expect(ad.hook).not.toContain('…');
      const quality = scoreCreative({ ...asCreative({ headlines: [], descriptions: [], keywords: [] }), ...ad, ratio: '2:3', search: undefined }, guide(n), n.voc);
      expect(quality.blocking).toEqual([]);
    }
  });

  it('a video format keeps being a script: the static branch moved nothing', async () => {
    const n = NICHE_CATALOG[0]!;
    const ad = await engine().writeAd({ product: guide(n), voc: n.voc, hook: 'Bébé se réveille toutes les 2 heures ?', hookStyle: 'question', format: 'carousel', bannedClaims: [] }, context());
    expect(ad.format).toBe('carousel');
    expect(ad.scenes.length).toBeGreaterThanOrEqual(4);
    const unknown = await engine().writeAd({ product: guide(n), voc: n.voc, hook: 'Bébé se réveille', hookStyle: 'question', format: 'search_text' as AdFormat, bannedClaims: [] }, context());
    expect(AD_FORMATS).toContain(unknown.format);
  });

  it('a weak writer spoils a pin: the flaws reach the score, and a pin with no flaw has none', async () => {
    const n = NICHE_CATALOG[0]!;
    const write = (ctx: MindContext, day = 3) => engine().writeAd({ product: guide(n), voc: n.voc, hook: 'Bébé se réveille toutes les 2 heures ?', hookStyle: 'question', format: 'static_image', bannedClaims: [] }, { ...ctx, day });
    const score = (ad: AdDraft) => scoreCreative({ ...asCreative({ headlines: [], descriptions: [], keywords: [] }), ...ad, ratio: '2:3', search: undefined }, guide(n), n.voc).overall;
    const clean = score(await write(context()));
    const flawed = await Promise.all(Array.from({ length: 12 }, (_, day) => write(context({ craft: { ...CRAFT } }), day + 1)));
    expect(Math.min(...flawed.map(score))).toBeLessThan(clean);
  });

  it('every niche gets a search ad inside the limits, with what was typed in its first title', async () => {
    for (const n of NICHE_CATALOG) {
      const ad = await engine().writeSearchAd({ product: guide(n), voc: n.voc, bannedClaims: n.voc.bannedClaims }, context());
      expect(ad.headlines.length).toBeGreaterThanOrEqual(3);
      expect(ad.headlines.length).toBeLessThanOrEqual(5);
      for (const h of ad.headlines) { expect(h.length).toBeLessThanOrEqual(30); expect(h).not.toMatch(/[!…]/); }
      expect(ad.descriptions).toHaveLength(2);
      for (const d of ad.descriptions) expect(d.length).toBeLessThanOrEqual(90);
      expect(ad.keywords.length).toBeGreaterThanOrEqual(3);
      expect(ad.headlines[0]!.startsWith('Guide ')).toBe(true);
      const quality = scoreSearchAd(asCreative(ad), guide(n), n.voc);
      expect(quality.blocking).toEqual([]);
      expect(quality.overall).toBeGreaterThanOrEqual(70);
    }
  });

  it('the same inputs write the same ad, another draft another one', async () => {
    const n = NICHE_CATALOG[0]!;
    const input = { product: guide(n), voc: n.voc, bannedClaims: [] };
    const first = await engine().writeSearchAd(input, context());
    expect(await engine().writeSearchAd(input, context())).toEqual(first);
    const drafts = await Promise.all([1, 2, 3, 4].map((draw) => engine().writeSearchAd(input, context({ draw }))));
    expect(drafts.some((d) => JSON.stringify(d) !== JSON.stringify(first))).toBe(true);
  });

  it('a word the platform refused leaves the titles, stays bid on, and the ad pays for it', async () => {
    const n = NICHE_CATALOG.find((x) => x.id === 'urssaf-micro')!;
    const input = { product: guide(n), voc: n.voc, bannedClaims: n.voc.bannedClaims };
    const free = await engine().writeSearchAd(input, context());
    expect(free.headlines[0]).toBe('Guide URSSAF micro');
    expect(findChannelViolation(asCreative(free), 'google', guide(n))?.id).toBe('google.marque');
    const taught = await engine().writeSearchAd(input, context({ playbook: ['Ne jamais écrire « URSSAF »'] }));
    expect([...taught.headlines, ...taught.descriptions].join(' ')).not.toMatch(/urssaf/i);
    expect(taught.headlines.some((h) => /^Guide\s+micro/.test(h))).toBe(false); // written without the word, not a title with a hole
    expect(taught.keywords[0]).toBe('urssaf micro');
    expect(findChannelViolation(asCreative(taught), 'google', guide(n))).toBeNull();
    expect(scoreSearchAd(asCreative(taught), guide(n), n.voc).overall).toBeLessThan(scoreSearchAd(asCreative(free), guide(n), n.voc).overall - 5);
  });

  it('a claim of the niche reaches neither the text nor the keywords', async () => {
    const n = NICHE_CATALOG.find((x) => x.id === 'ventre-apres-40')!;
    const ad = await engine().writeSearchAd({ product: { ...guide(n), problem: 'Perdre du ventre, maigrir vite' }, voc: n.voc, bannedClaims: ['maigrir vite'] }, context());
    expect(JSON.stringify(ad)).not.toMatch(/maigrir vite/i);
  });

  it('a weak writer spoils a search ad', async () => {
    const n = NICHE_CATALOG[0]!;
    const input = { product: guide(n), voc: n.voc, bannedClaims: [] };
    const score = (ad: SearchAdDraft) => scoreSearchAd(asCreative(ad), guide(n), n.voc).overall;
    const clean = score(await engine().writeSearchAd(input, context()));
    const flawed = await Promise.all(Array.from({ length: 12 }, (_, day) => engine().writeSearchAd(input, context({ day, craft: { ...CRAFT } }))));
    expect(Math.min(...flawed.map(score))).toBeLessThan(clean - 10);
  });

  it('with Claude on, a pin and a search ad stay the heuristic writer\'s: no call, no script cut into a pin', async () => {
    const n = NICHE_CATALOG[0]!;
    let calls = 0;
    const scene = { visual: 'Un plan de bébé endormi', onScreenText: 'Une scène de plus', voiceover: 'Une scène de plus.', durationSec: 3 };
    const script = { hook: 'Un hook de Claude', scenes: [scene, scene, scene, scene, scene], caption: 'Une légende', hashtags: ['#a', '#b', '#c', '#d'], cta: 'Télécharge le guide' };
    const client: ClaudeClientLike = {
      messages: {
        create: async () => {
          calls += 1;
          return { id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: JSON.stringify(script), citations: null }], usage: { input_tokens: 10, output_tokens: 10 } } as unknown as Anthropic.Message;
        },
      },
    };
    const claude = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 7, client, log: () => {} });
    const heuristic = engine();
    const input = { product: guide(n), voc: n.voc, hook: 'Bébé se réveille toutes les 2 heures ?', hookStyle: 'question' as const, format: 'static_image' as const, bannedClaims: [] };
    expect(await claude.writeAd(input, context())).toEqual(await heuristic.writeAd(input, context()));
    const search = { product: guide(n), voc: n.voc, bannedClaims: [] };
    expect(await claude.writeSearchAd(search, context())).toEqual(await heuristic.writeSearchAd(search, context()));
    expect(calls).toBe(0);
  });

  it('the Claude prompt tells every writer the channels have their own rules', async () => {
    const n = NICHE_CATALOG[0]!;
    const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: ClaudeClientLike = {
      messages: { create: async (body) => { bodies.push(body); throw new Error('fall back'); } },
    };
    const claude = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 7, client, log: () => {} });
    await claude.writeAdHooks({ product: guide(n), voc: n.voc, styles: ['question'] }, context());
    expect(JSON.stringify(bodies[0]?.system)).toContain('Conformité pub par canal');
  });
});

describe('the public note', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const note = readFileSync(join(REPO, 'brain', 'politiques', 'Conformité pub par canal.md'), 'utf8');

  it('names every rule by its public label, never its pattern', () => {
    for (const rule of Object.values(CHANNEL_RULES).flat()) expect(note.toLowerCase()).toContain(rule.label.toLowerCase());
    expect(note).not.toMatch(/\bventre\b|\burssaf\b|\btoeic\b|\bkilos\b/i);
  });

  it('every channel but TikTok has rules, and every rule says its channel', () => {
    for (const [ch, rules] of Object.entries(CHANNEL_RULES)) {
      if (ch === 'tiktok') continue;
      expect(rules.length).toBeGreaterThan(0);
      const account = ch === 'youtube' ? 'google' : ch;
      for (const r of rules) expect(r.id.startsWith(`${account}.`)).toBe(true);
    }
  });
});
