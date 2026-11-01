/**
 * What the world and the tabs read (ui §2, §3, §8): the size of the stream, the truth behind `god`, and pure reads. One real run
 * feeds them, blown up by hand where a test needs a big old company: playing 200 days here would prove nothing more about a size.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunPaths } from '../src/contracts.js';
import type {
  AgentState, ChannelsDetail, CompanySnapshot, CreativeVideo, DailyAdStats, Deliverable, FounderDigest, GrowthState, LeagueDetail, OrgDetail, Product, SceneView, WorldState,
} from '../src/shared.js';
import { CHANNEL_IDS, CHANNELS, kpiBaselineOf, TICKS_PER_DAY } from '../src/shared.js';
import { chronicleOf } from '../src/api/chronicle.js';
import { loadWorld, flushSaves } from '../src/api/persist.js';
import { createAgencyServer, sessionViews, unavailableSession, type SessionLike } from '../src/api/server.js';
import { liveVideos } from '../src/api/session.js';
import { liveSnapshotJson, safeFinance, snapshotJson, viewOf } from '../src/api/snapshot.js';
import { adTotalsOf, buildSnapshot, fullProduct, LIVE_BUDGET_BYTES, LIVE_LIMITS, LIVE_TIGHT_LIMITS, serializeLiveSnapshot, stubProduct, trimAdStats } from '../src/api/trim.js';
import { channelsDetail, deliverablesPage, digestPeopleOf, leagueDetail, orgDetail, sceneOf, type DeliverablePage } from '../src/api/views.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { payOf } from '../src/runtime/org/payroll.js';

const scratch = vi.hoisted(() => ({ root: `${process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? '/tmp'}/agency-views-${process.pid}` }));

vi.mock('../src/core/index.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/core/index.js')>()), repoRoot: () => scratch.root }));

const SENTINEL = 0.739127;
const DAYS = 30;

interface Lab { world: WorldState; company: Company; paths: RunPaths; reopen(w: WorldState): Company }

async function lab(): Promise<Lab> {
  const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90 }), 'test-views');
  const root = await mkdtemp(join(tmpdir(), 'pixel-views-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  return { world, paths, company: new Company(world, opts), reopen: (w) => new Company(w, opts) };
}

const roots: string[] = [];
let world: WorldState;
let paths: RunPaths;

beforeAll(async () => {
  const run = await lab();
  await run.company.runDays(DAYS);
  ({ world, paths } = run);
}, 120_000);

afterAll(async () => {
  await flushSaves();
  for (const root of [...roots, scratch.root]) await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

const clone = <T>(v: T): T => structuredClone(v);
const video = (id: string): CreativeVideo => ({
  status: 'ready', reason: null, poster: `video/${id}/poster.png`, captions: `video/${id}/captions.vtt`, cards: [], voice: 'fr-denise',
  videos: [{ ratio: '9:16', path: `video/${id}/9x16.mp4`, durationSec: 28.4, bytes: 4_800_000 }, { ratio: '4:5', path: `video/${id}/4x5.mp4`, durationSec: 28.4, bytes: 4_500_000 }],
  qa: { ok: true, failed: [], lufs: -14.2, cuts: 19, avgShotSec: 1.5, mb: 4.8 },
});

/** A company at its widest: 60 agents, 100 guides, 240 videos, 400 deliverables, day 200, every log at its cap. */
function bigWorld(): { w: WorldState; videos: Record<string, CreativeVideo> } {
  const w = clone(world);
  const { company: c, market: m } = w;
  const org = c.org!;
  const league = c.league!;
  w.day = 200;
  const person = c.agents.find((a) => league.entries[a.id]?.primary)!;
  const entry = league.entries[person.id]!;
  const history = Array.from({ length: 40 }, (_, i) => ({ day: i * 5, rating: 1500 + i }));
  for (let i = c.agents.length; i < 60; i++) {
    const id = `agent_${i}`;
    c.agents.push({ ...clone(person), id, name: `Personne ${i}`, desk: i });
    league.entries[id] = { ...clone(entry), agentId: id, name: `Personne ${i}`, ratings: { copy: { ...clone(entry.ratings[entry.primary!]!), skill: 'copy', history } }, primary: 'copy' };
  }
  const guide = c.products.find((p) => p.status === 'live')!;
  for (let i = c.products.length; i < 100; i++) c.products.push({ ...clone(guide), id: `prd_x${i}`, status: i % 3 === 0 ? 'live' : i % 3 === 1 ? 'paused' : 'killed', decision: { day: 150, status: 'killed', reason: 'Trop peu de ventes.' } });
  const ad = c.creatives.at(-1)!;
  for (let i = c.creatives.length; i < 300; i++) c.creatives.push({ ...clone(ad), id: `crv_x${i}` });
  const deliverable = c.deliverables.at(-1)!;
  for (let i = c.deliverables.length; i < 400; i++) c.deliverables.push({ ...deliverable, id: `liv_x${i}`, kind: i % 2 ? 'pdf' : 'ad_preview' });
  for (let i = 0; i < 200; i++) org.alumni.push({ id: `parti_${i}`, name: `Ancien ${i}`, gender: 'f', roleId: 'ghostwriter', dept: 'studio', founder: false, hiredDay: 10, leftDay: 100, reason: 'fin de plan', level: 2, kind: 'fired', replacedBy: null, perf: person.perf, avatar: person.avatar });
  for (let i = 0; i < 200; i++) org.decisions.push({ id: `org_x${i}`, day: 190, kind: i % 2 ? 'hire' : 'leave', roleId: 'ghostwriter', agentId: `parti_${i}`, text: 'Une décision écrite en français, avec ses chiffres : '.repeat(3), numbers: { pay: 0.8, monthly: 24, interview: 72, recruiting: 5.6, headcount: 60 } });
  c.growth!.weeks = Array.from({ length: 28 }, (_, i) => ({ ...c.growth!.weeks[0]!, week: i + 1 }));
  c.growth!.decisions = Array.from({ length: 500 }, (_, i) => ({ id: `dec_x${i}`, day: 190, kind: 'budget', who: 'system', text: 'Le CFO déplace du budget'.repeat(3), why: 'ROAS 1,8 sur 14 jours, 240 € de pub'.repeat(3) }));
  c.lessons = Array.from({ length: 300 }, (_, i) => ({ id: `les_${i}`, day: 100, topic: 'ads', insight: `Le hook « stat » bat « question » de 40 % sur cette niche (${i})`, evidence: 'CTR 3,1 % contre 1,4 %', confidence: 0.7, source: 'zoe', appliesTo: [], notePath: `lecons/l-${i}.md` }));
  const message = m.inbox[0];
  if (message) for (let i = m.inbox.length; i < 300; i++) m.inbox.push({ ...clone(message), id: `msg_x${i}` });
  for (let i = 0; i < 300; i++) {
    const row = m.adStats.at(-1)!;
    m.adStats.push({ ...row, day: 197 + (i % 3) });
  }
  const ids = c.creatives.slice(-240).map((x) => x.id);
  return { w, videos: Object.fromEntries(ids.map((id) => [id, video(id)])) };
}

describe('the live stream', () => {
  it(`60 agents, 100 products, 240 videos, 400 deliverables, day 200: under the live limit (D70), with the stream's own 30 videos at most`, () => {
    const { w, videos } = bigWorld();
    const shown = liveVideos(w, videos);
    expect(Object.keys(shown).length).toBeLessThanOrEqual(30);
    const json = serializeLiveSnapshot(w, safeFinance(w), false, { videos: shown, session: { runId: w.runId } });
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(LIVE_BUDGET_BYTES);
    expect(LIVE_BUDGET_BYTES).toBeLessThanOrEqual(500_000);
    const snapshot = JSON.parse(json) as CompanySnapshot;
    expect(snapshot.company.agents).toHaveLength(60);
    expect(snapshot.counts).toMatchObject({ products: 100, deliverables: 400, creatives: 300, messages: w.market.inbox.length, lessons: 300 });
    expect(snapshot.company.products.filter((p) => p.status === 'paused' || p.status === 'killed')).toHaveLength(12); // ui §3.1
    expect(snapshot.company.products.filter((p) => p.status === 'live')).toHaveLength(w.company.products.filter((p) => p.status === 'live').length);
    expect(snapshot.company.playbooks).toEqual({});
  });

  it('counts bytes, not characters: an accent weighs two on the wire', () => {
    const w = clone(world);
    w.activity = Array.from({ length: 600 }, (_, i) => ({ ...w.activity[0]!, id: `act_${i}` }));
    const budget = LIVE_BUDGET_BYTES - JSON.stringify(buildSnapshot(w, safeFinance(w), false, LIVE_LIMITS)).length;
    const accents = 'é'.repeat(Math.ceil(budget * 0.75));
    const json = serializeLiveSnapshot(w, safeFinance(w), false, { padding: accents });
    expect(json.length).toBeLessThanOrEqual(LIVE_BUDGET_BYTES);
    expect(JSON.parse(json).activity.length).toBeLessThan(LIVE_LIMITS.activity); // it had to fall back
  });

  it('the scene stays under 25 000 bytes at the widest', () => {
    expect(Buffer.byteLength(JSON.stringify(sceneOf(bigWorld().w)))).toBeLessThanOrEqual(25_000);
  });

  it('carries the scene and the counts, never company.org, league or channels, on the stream and on GET /api/state (D34)', () => {
    for (const json of [liveSnapshotJson(world), snapshotJson(world)]) {
      const s = JSON.parse(json) as CompanySnapshot;
      expect(s.scene?.closedDepts.map((d) => d.id)).toEqual(world.company.org!.closedDepts.map((d) => d.id)); // D35
      expect(s.scene?.stage.id).toBe(world.company.growth!.stage);
      expect(s.counts?.products).toBe(world.company.products.length);
      expect(Object.keys(s.company)).not.toEqual(expect.arrayContaining(['org']));
      expect(s.company.league).toBeUndefined();
      expect(s.company.channels).toBeUndefined();
      expect(s.company.org).toBeUndefined();
    }
  });

  it('carries company.growth trimmed: the founder for the digest, the niches and the old rows stay on the server', () => {
    const { w } = bigWorld();
    const live = JSON.parse(liveSnapshotJson(w)) as CompanySnapshot;
    const growth = live.company.growth as GrowthState;
    expect(growth.founder).toEqual(w.company.growth!.founder);
    expect(growth.niches).toEqual({});
    expect(growth.weeks.length).toBeLessThanOrEqual(LIVE_LIMITS.growthWeeks);
    expect(growth.decisions.length).toBeLessThanOrEqual(LIVE_LIMITS.growthDecisions);
  });

  it('shows every ad account and the mailing list, the numbers the company can see', () => {
    const s = JSON.parse(snapshotJson(world)) as CompanySnapshot;
    expect(Object.keys(s.market.channelAccounts!).sort()).toEqual(['google', 'meta', 'pinterest', 'tiktok']);
    expect(s.market.channelAccounts!.tiktok).toMatchObject({ strikes: world.market.adAccount.strikes, openDay: 1 });
    const withList = clone(world);
    withList.market.audience ??= { buckets: [], welcome: {}, sequences: [], queue: [], sent: [], totals: { leads: 0, buyers: 0, unsubscribed: 0, delivered: 0, opens: 0, clicks: 0, sales: 0, revenue: 0 } };
    expect((JSON.parse(snapshotJson(withList)) as CompanySnapshot).market.audience).toMatchObject({ dailyCost: expect.any(Number) as number });
  });
});

/** A company past the stream's window: `days` closed days, the money and the ads climbing all along. */
function oldWorld(days: number): WorldState {
  const w = clone(world);
  const k = w.company.kpis[0]!;
  w.day = days + 1;
  w.tick = 0;
  w.ledger.push({ id: 'led_close', day: days, type: 'platform_fee', amount: -1, memo: 'Jour clos', ref: `fixed:${days}` });
  w.company.kpis = Array.from({ length: days }, (_, i) => ({ ...k, day: i + 1, adSpend: 10, roas: 1 + i / 100, impressions: 1000, clicks: 10, ctr: 0.01, sales: 2, refunds: 0, profit: i, channels: undefined }));
  return w;
}

describe('what a tab adds up past a trimmed list', () => {
  it('the start of the run survives the tightest stream, on the days the tab would have read (Apprentissage)', () => {
    const w = oldWorld(200);
    const s = buildSnapshot(w, safeFinance(w), false, LIVE_TIGHT_LIMITS);
    expect(s.company.kpis[0]!.day).toBeGreaterThan(7);
    expect(s.kpiBaseline!.roas).toBeCloseTo(1.03, 6); // days 1 to 7, not the first days the stream still holds
    expect(s.kpiBaseline!.profit).toBeCloseTo(3, 6);
    expect(s.kpiBaseline!.ctr).toBeCloseTo(0.01, 6);
  });

  it('a reading waits for its first measured day, and a run of a few days splits in two', () => {
    const k = oldWorld(10).company.kpis;
    const noAds = k.map((x, i) => (i < 4 ? { ...x, adSpend: 0, roas: 0 } : x));
    expect(kpiBaselineOf(noAds).roas).toBeCloseTo(1.05, 6); // days 5 to 7 of 6 measured days: 3 of them
    expect(kpiBaselineOf(k.slice(0, 4)).profit).toBeCloseTo(0.5, 6);
    expect(kpiBaselineOf(k.slice(0, 1))).toEqual({});
    expect(kpiBaselineOf([])).toEqual({});
  });

  it('the week of Publicité is the week of Canaux, whatever the stream keeps of the rows', () => {
    const w = oldWorld(30);
    const held = w.market.adStats.filter((r) => r.day <= 30).length;
    expect(held).toBeGreaterThan(0);
    w.company.kpis = clone(world.company.kpis);
    const s = buildSnapshot(w, safeFinance(w), false, LIVE_TIGHT_LIMITS);
    const spend = (s.adTotals!.week ?? []).reduce((n, r) => n + r.spend, 0);
    expect(new Set(s.market.adStats.map((r) => r.day)).size).toBeLessThanOrEqual(LIVE_TIGHT_LIMITS.adStatsDays);
    expect(spend).toBeGreaterThan(s.market.adStats.reduce((n, r) => n + r.spend, 0));
    expect(spend).toBeCloseTo(channelsDetail(w).totals.spend7d, 1);
  });

  it('adds a week up by campaign, creative and channel: 7 closed days, the day under way stays out', () => {
    const base = clone(world.market.adStats[0]!);
    const row = (day: number, o: Partial<DailyAdStats> = {}): DailyAdStats => ({ ...base, day, campaignId: 'cmp', creativeId: 'cre', spend: 10, impressions: 100, clicks: 5, landingViews: 4, purchases: 1, revenue: 20, frequency: day / 10, comments: [], channel: undefined, ...o });
    const stats = [row(3), ...[4, 5, 6, 7, 8, 9, 10].map((d) => row(d)), row(11), row(9, { channel: 'meta', spend: 7 })];
    const { week } = adTotalsOf({ ...world.market, adStats: stats }, [], 10);
    expect(week).toEqual([
      { campaignId: 'cmp', creativeId: 'cre', channel: 'tiktok', spend: 70, impressions: 700, clicks: 35, landingViews: 28, purchases: 7, revenue: 140, frequency: 1 },
      { campaignId: 'cmp', creativeId: 'cre', channel: 'meta', spend: 7, impressions: 100, clicks: 5, landingViews: 4, purchases: 1, revenue: 20, frequency: 0.9 },
    ]);
  });

  it('the tightest stream keeps the comments the tab prints, the latest first, and no more', () => {
    const base = clone(world.market.adStats[0]!);
    const comment = { author: 'lea', text: 'Merci', tone: 'positive' as const };
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...base, day: 200, creativeId: `cre_${i}`, comments: [comment, comment] }));
    const kept = trimAdStats(rows, 200, LIVE_TIGHT_LIMITS);
    expect(kept.map((r) => r.creativeId)).toEqual(rows.map((r) => r.creativeId));
    expect(kept.reduce((n, r) => n + r.comments.length, 0)).toBe(14);
    expect(kept.at(-1)!.comments).toHaveLength(1);
    expect(kept[0]!.comments).toHaveLength(0);
    expect(trimAdStats(rows, 200, LIVE_LIMITS).reduce((n, r) => n + r.comments.length, 0)).toBe(40);
  });

  it('a stopped guide leaves the stream, not the figures of the catalogue (Produits)', () => {
    const w = clone(world);
    const guide = w.company.products[0]!;
    w.company.products = Array.from({ length: 30 }, (_, i) => ({ ...clone(guide), id: `prd_x${i}`, status: i < 25 ? 'killed' as const : 'live' as const, stats: { ...guide.stats, revenue: 100, sales: 4, refunds: 1, rating: i % 2 ? 4 : 0 } }));
    const s = buildSnapshot(w, safeFinance(w), false, LIVE_TIGHT_LIMITS);
    expect(s.company.products).toHaveLength(17);
    expect(s.counts!.catalogue).toEqual({ stopped: 25, revenue: 3000, sales: 120, refunds: 30, rating: 4 });
  });

  it('the stream holds the days Finance and Calendrier draw, on its tightest limits too', () => {
    const w = oldWorld(200);
    expect(buildSnapshot(w, safeFinance(w), false, LIVE_TIGHT_LIMITS).company.kpis).toHaveLength(60);
  });
});

describe('pure reads', () => {
  it('leave the world as they found it', () => {
    const w = clone(world);
    const before = JSON.stringify(w);
    sceneOf(w);
    chronicleOf(w);
    orgDetail(w);
    leagueDetail(w, true);
    channelsDetail(w);
    digestPeopleOf(w, 1, w.day);
    deliverablesPage(w, {});
    buildSnapshot(w, safeFinance(w), true);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('a world with no pillar state has an empty chronicle and a valid scene', () => {
    const w = clone(world);
    for (const k of ['org', 'league', 'channels', 'growth'] as const) delete w.company[k];
    w.market.events = [];
    expect(chronicleOf(w)).toEqual([]);
    const scene = sceneOf(w);
    expect(scene).toMatchObject({ people: {}, board: [], podium: null, duels: [], recent: [], openSeats: {}, closedDepts: [], names: {} });
    expect(scene.stage).toMatchObject({ level: 0, total: 4, id: 'survie', name: 'Survie', gate: null });
    expect(scene.channels.map((c) => [c.id, c.state])).toEqual([['tiktok', 'open']]);
    expect(orgDetail(w).depts.length).toBeGreaterThan(0);
    expect(leagueDetail(w, false)).toMatchObject({ roles: [], plans: [], duels: [], alumni: [], lastHire: null });
    expect(channelsDetail(w).rows).toHaveLength(5);
  });
});

describe('the chronicle', () => {
  it('keys are unique, and a run reloaded mid-way tells the same story', async () => {
    const run = await lab();
    let { world: w, company } = run;
    for (let i = 0; i < DAYS * TICKS_PER_DAY; i++) {
      await company.step();
      if (i === 150) {
        w = JSON.parse(JSON.stringify(w)) as WorldState;
        company = run.reopen(w);
      }
    }
    const entries = chronicleOf(w);
    expect(entries.length).toBeGreaterThan(5);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    expect(entries).toEqual(chronicleOf(world));
    expect(entries.map((e) => e.day)).toEqual([...entries.map((e) => e.day)].sort((a, b) => a - b));
  }, 120_000);

  /** Every source of the table of ui §2.1 bis, by hand: seed 7 fires nobody in 30 days. */
  function eventful(): WorldState {
    const w = clone(world);
    const { org, league, growth } = w.company;
    const person = w.company.agents.at(-1)!;
    w.company.agents = w.company.agents.filter((a) => a.id !== person.id);
    org!.alumni.push({ id: person.id, name: person.name, gender: person.gender, roleId: person.roleId, dept: person.dept, founder: false, hiredDay: person.hiredDay, leftDay: 30, reason: 'plan raté, ROAS 0,8', level: 1, kind: 'fired', replacedBy: null, perf: person.perf, avatar: person.avatar });
    league!.entries[person.id] = { ...league!.entries[person.id]!, status: 'gone', leftBecause: 'plan raté, ROAS 0,8 pour 1,2 visé' };
    org!.decisions.push(
      { id: 'org_leave', day: 30, kind: 'leave', roleId: person.roleId, agentId: person.id, text: `${person.name} quitte l'agence`, numbers: { severance: 5 } },
      { id: 'org_layoff', day: 30, kind: 'layoff', roleId: person.roleId, agentId: person.id, text: 'Licenciement', numbers: {} },
      { id: 'org_refused', day: 30, kind: 'refused', roleId: person.roleId, agentId: null, text: 'Le CFO refuse', numbers: {} },
    );
    league!.duels.push(
      { id: 'duel_a', season: 2, skill: 'copy', kind: 'formal', agents: ['zoe', person.id], productId: 'p', campaignId: 'c', creativeIds: [], taskIds: [], experimentId: null, status: 'settled', startDay: 24, endDay: 29, result: { ctr: [0.03, 0.01], n: [5000, 5000], z: 3, s: 0.9, delta: 12.5 } },
      { id: 'duel_b', season: 2, skill: 'copy', kind: 'formal', agents: ['zoe', person.id], productId: 'p', campaignId: 'c', creativeIds: [], taskIds: [], experimentId: null, status: 'running', startDay: 30, endDay: null, result: null },
      { id: 'duel_c', season: 2, skill: 'copy', kind: 'natural', agents: ['zoe', person.id], productId: 'p', campaignId: 'c', creativeIds: [], taskIds: [], experimentId: null, status: 'settled', startDay: 30, endDay: 30, result: { ctr: [0.02, 0.02], n: [900, 900], z: 0, s: 0.5, delta: 0 } },
    );
    league!.plans.push({ agentId: 'zoe', skill: 'copy', openedSeason: 1, deadlineDay: 28, metricLabel: 'qualité', baseline: 70, target: 73, coachId: null, text: 'Plan de Zoé', outcome: 'open' });
    growth!.decisions.push(
      { id: 'dec_down', day: 30, kind: 'stage', who: 'system', text: "l'agence quitte l'étape Accélération pour l'étape Adéquation", why: 'perte sur 28 jours' },
      { id: 'dec_close', day: 30, kind: 'channel', who: 'system', text: 'Pinterest mis en pause', why: 'ROAS réconcilié 0,4' },
    );
    // the wording of sim/tools.ts, both events
    w.market.events.push(
      { id: 'evt_ban', day: 30, kind: 'channel_account_banned', title: 'Compte Facebook & Instagram suspendu', description: '3 avertissements', severity: 'danger' },
      { id: 'evt_google', day: 30, kind: 'channel_account_banned', title: 'Compte YouTube Shorts et Google Search suspendu', description: '3 refus', severity: 'danger' },
      { id: 'evt_tiktok', day: 30, kind: 'ad_account_banned', title: 'Compte publicitaire suspendu', description: 'Trois refus pour allégations interdites', severity: 'danger' },
    );
    return w;
  }

  it('reads every source, in its own words, and names who left', () => {
    const w = eventful();
    const person = w.company.org!.alumni.at(-1)!;
    const of = (key: string) => chronicleOf(w).find((e) => e.key === key);
    expect(of('org:org_leave')).toMatchObject({ kind: 'fire', day: 30, why: 'plan raté, ROAS 0,8 pour 1,2 visé', person: { name: person.name, dept: person.dept }, numbers: { severance: 5 } });
    expect(of('org:org_layoff')?.kind).toBe('layoff');
    expect(of('org:org_refused')).toBeUndefined();
    expect(of('duel:duel_a:open')).toMatchObject({ kind: 'duel_open', day: 24, agentId: 'zoe', otherId: person.id });
    expect(of('duel:duel_a:end')).toMatchObject({ kind: 'duel_end', day: 29, numbers: { ratingDeltaA: 12.5, ratingDeltaB: -12.5 } });
    expect(of('duel:duel_a:end')?.text).toContain('gagne son duel');
    expect(of('duel:duel_b:open')?.kind).toBe('duel_open');
    expect(of('duel:duel_b:end')).toBeUndefined();
    expect(of('duel:duel_c:end')).toBeUndefined(); // natural duels would drown the rest
    expect(of('plan:zoe:1')).toMatchObject({ kind: 'probation', day: w.company.league!.seasons.find((s) => s.season === 1)!.toDay, why: 'Plan de Zoé' });
    expect(of('season:1')).toMatchObject({ kind: 'season_end', numbers: { season: 1 } });
    expect(of('stage:dec_down')).toMatchObject({ kind: 'stage_down', numbers: { stage: 1 } });
    expect(of('channel:dec_close')).toMatchObject({ kind: 'channel_close', channel: 'pinterest' });
    expect(of('ban:evt_ban')).toMatchObject({ kind: 'channel_close', channel: 'meta' });
    expect(chronicleOf(w, 30).every((e) => e.day === 30)).toBe(true);
  });

  it('every ban closes its channel: TikTok has its own event, a shared account stops two and reads as one line', () => {
    const of = (key: string) => chronicleOf(eventful()).find((e) => e.key === key);
    expect(of('ban:evt_tiktok')).toMatchObject({ kind: 'channel_close', channel: 'tiktok', text: 'Compte TikTok suspendu', why: 'Trois refus pour allégations interdites' });
    expect(of('ban:evt_google')).toMatchObject({ kind: 'channel_close', channel: 'youtube', text: 'Compte YouTube Shorts et Google Search suspendu' });
    expect(chronicleOf(eventful()).filter((e) => e.key.startsWith('ban:evt_google'))).toHaveLength(1);
  });

  it('a stage climbed reads as a step up, a filled position as filled, a department as it opens and closes', () => {
    const w = clone(world);
    const org = w.company.org!;
    const hired = w.company.agents.find((a) => !a.founder)!;
    org.positions.push({ id: 'pos_x', roleId: 'video_editor', reason: 'bottleneck', detail: 'File de montage pleine', openedDay: 28, closedDay: 29, status: 'filled', candidates: [], hiredId: hired.id, replaces: null, taskId: null });
    w.company.growth!.decisions.push({ id: 'dec_up', day: 29, kind: 'stage', who: 'system', text: "l'agence quitte l'étape Survie pour l'étape Adéquation", why: 'cap franchi' });
    const editor = { ...hired, id: 'ed', dept: 'video' as const, hiredDay: 20 };
    w.company.agents.push(editor);
    org.alumni.push({ id: 'lena', name: 'Léna', gender: 'f', roleId: 'accountant', dept: 'crm', founder: false, hiredDay: 1, leftDay: 2, reason: 'test', level: 1, kind: 'fired', replacedBy: null, perf: hired.perf, avatar: hired.avatar });
    const of = (key: string) => chronicleOf(w).find((e) => e.key === key);
    expect(of('stage:dec_up')).toMatchObject({ kind: 'stage_up', numbers: { stage: 1 } });
    expect(of('req:pos_x:open')).toMatchObject({ kind: 'req_open', why: 'File de montage pleine', dept: 'video' });
    expect(of('req:pos_x:filled')).toMatchObject({ kind: 'req_filled', day: 29, agentId: hired.id });
    expect(of('dept:video:open:20')).toMatchObject({ kind: 'dept_open', dept: 'video', day: 20 });
    expect(of('dept:crm:close:2')).toMatchObject({ kind: 'dept_close', dept: 'crm', day: 2 });
  });

  it('digestPeopleOf: no hire on a quiet window, 12 highlights at most, 3 of a kind at most, biggest first', () => {
    const w = eventful();
    const quiet = digestPeopleOf(w, 1, 1);
    expect(quiet.people.hired).toEqual([]);
    expect(quiet.highlights).toEqual([]);
    for (let i = 0; i < 20; i++) {
      w.company.org!.decisions.push({ id: `org_h${i}`, day: 28, kind: 'hire', roleId: 'ghostwriter', agentId: null, text: `Embauche ${i}`, numbers: {} });
      w.company.growth!.decisions.push({ id: `dec_c${i}`, day: 28, kind: 'channel', who: 'system', text: 'Pinterest ouvert', why: 'test' });
    }
    const { highlights, people } = digestPeopleOf(w, 1, w.day);
    expect(highlights.length).toBeLessThanOrEqual(12);
    const byKind = new Map<string, number>();
    for (const h of highlights) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
    expect(Math.max(...byKind.values())).toBeLessThanOrEqual(3);
    expect(highlights[0]!.kind.startsWith('stage_')).toBe(true);
    expect(highlights.filter((h) => h.kind === 'hire').every((h) => h.day === 28)).toBe(true); // newest first, inside a kind
    expect(people.headTo).toBeGreaterThanOrEqual(8);
  });
});

describe('the detail views', () => {
  it('a stopped guide keeps its stats and its decision, and drops its text', () => {
    const live = world.company.products.find((p) => p.content)!;
    const stub = stubProduct({ ...live, status: 'killed', decision: { day: 20, status: 'killed', reason: 'Pas de ventes' } });
    expect(stub.stats.sales).toBe(live.stats.sales);
    expect(stub.decision?.reason).toBe('Pas de ventes');
    expect(stub.content).toBeNull();
    expect(stub.salesPage).toBeNull();
    expect(stub.visual).toBeUndefined();
  });

  it('GET /api/product/:id is the whole guide, without what reads the designer or the market back', () => {
    const live = world.company.products.find((p) => p.visual && p.content)!;
    const full = viewOf(world, 'product', new URLSearchParams({ id: live.id })) as Product;
    expect(full.content!.chapters.map((c) => c.paragraphs)).toEqual(live.content!.chapters.map((c) => c.paragraphs));
    const json = JSON.stringify(fullProduct({ ...live, artExplored: 4, paidRead: { since: 1, eur: 80 }, hooks: [{ hook: 'x', hookStyle: 'stat' }], feedback: [] }));
    for (const key of ['"effort"', '"explored"', '"artExplored"', '"paidRead"', '"hooks"', '"feedback"']) expect(json).not.toContain(key);
    expect(viewOf(world, 'product', new URLSearchParams({ id: 'absent' }))).toBeNull();
  });

  it('no department carries the name of one channel: the team that buys ads buys them on all five', () => {
    const printed = orgDetail(world).depts.flatMap((d) => [d.name, ...world.company.departments.filter((x) => x.id === d.id).map((x) => x.icon)]);
    expect(printed).toContain('Acquisition');
    for (const ch of CHANNEL_IDS) expect(printed.join(' ').toLowerCase()).not.toContain(CHANNELS[ch].label.toLowerCase());
  });

  it('a recruiting fee weighs on a person while it sits in the 30 days, not after', () => {
    const w = oldWorld(90);
    const hire = w.company.agents.find((a) => !a.founder)!;
    const fee = w.ledger.find((e) => e.ref === `hire:${hire.id}`)!;
    const payOfRow = () => orgDetail(w).depts.flatMap((x) => x.heads).find((h) => h.agentId === hire.id)!.pay30d;
    expect(payOfRow()).toBeCloseTo(payOf(hire) * 30, 1);
    fee.day = 80;
    expect(payOfRow()).toBeCloseTo(payOf(hire) * 30 - fee.amount, 1);
  });

  it('the departments add up to the ledger: in survival the founders take their cut, hires keep their contract', () => {
    const w = clone(world);
    for (const e of w.ledger) {
      const day = e.type === 'salary' && /^payroll:(\d+)$/.exec(e.ref ?? '')?.[1];
      if (day) e.amount = -w.company.agents.filter((a) => a.hiredDay <= Number(day)).reduce((n, a) => n + payOf(a) * (a.founder ? 0.5 : 1), 0);
    }
    const d = orgDetail(w);
    const heads = d.depts.flatMap((x) => x.heads);
    const founder = w.company.agents.find((a) => a.founder)!;
    const hire = w.company.agents.find((a) => !a.founder)!;
    const fee = -(w.ledger.find((e) => e.ref === `hire:${hire.id}`)?.amount ?? 0);
    const closed = w.day - 1;
    expect(heads.find((h) => h.agentId === founder.id)!.pay30d).toBeCloseTo(payOf(founder) * 0.5 * (closed - Math.max(1, founder.hiredDay) + 1), 0);
    expect(heads.find((h) => h.agentId === hire.id)!.pay30d).toBeCloseTo(payOf(hire) * (closed - hire.hiredDay + 1) + fee, 1);
    expect(d.depts.reduce((n, x) => n + x.cost30d, 0)).toBeCloseTo(d.cost30d, 0);
  });

  it('Effectif reads money from the ledger and pay from payOf, position details in full (D45, D46)', () => {
    const w = clone(world);
    const hire = w.company.agents.find((a) => !a.founder)!;
    w.company.org!.positions.push({ id: 'pos_y', roleId: 'video_editor', reason: 'bottleneck', detail: 'Il faut 12 tâches de montage par semaine', openedDay: 29, closedDay: null, status: 'open', candidates: [{ id: 'c', name: 'Clé', gender: 'f', roleId: 'video_editor', tier: 'sonnet', persona: '', skills: [], avatar: hire.avatar, interview: 71, deliverable: null, lineage: null }, { id: 'd', name: 'Dan', gender: 'm', roleId: 'video_editor', tier: 'sonnet', persona: '', skills: [], avatar: hire.avatar, interview: 64, deliverable: null, lineage: hire.id }], hiredId: null, replaces: null, taskId: null });
    w.company.org!.decisions.push({ id: 'org_no', day: w.day, kind: 'refused', roleId: 'video_editor', agentId: null, text: 'Le CFO refuse : marge 3 € par jour', numbers: { margin: 3 } });
    const d = orgDetail(w);
    const row = d.depts.flatMap((x) => x.heads).find((h) => h.agentId === hire.id)!;
    const recruiting = -w.ledger.find((e) => e.ref === `hire:${hire.id}`)!.amount;
    expect(row.pay30d).toBeCloseTo(payOf(hire) * (w.day - 1 - hire.hiredDay + 1) + recruiting, 1);
    expect(row.contract).toBe(w.day - hire.hiredDay < 7 ? 'trial' : 'active');
    expect(d.headcount).toBe(w.company.agents.length);
    expect(d.cost30d).toBeGreaterThan(0);
    expect(d.costPerHead30d).toBeCloseTo(d.cost30d / d.headcount, 1);
    const req = d.reqs.find((r) => r.id === 'pos_y')!;
    expect(req).toMatchObject({ dept: 'video', why: 'Il faut 12 tâches de montage par semaine', status: 'open', blockedBy: 'Le CFO refuse : marge 3 € par jour', candidates: [{ name: 'Clé', score: 71, source: 'marché' }, { name: 'Dan', score: 64, source: `élève de ${hire.name}` }] });
    expect(d.lastRefusal).toMatchObject({ text: 'Le CFO refuse : marge 3 € par jour', numbers: { margin: 3 } });
    expect(d.closed.map((c) => c.id)).toEqual(w.company.org!.closedDepts.map((c) => c.id));
    expect(d.closed.every((c) => c.hostedBy)).toBe(true);
    expect(d.stage.level).toBeGreaterThanOrEqual(0);
    expect(d.decisions.length).toBeGreaterThan(0);
  });

  it('a contract reads notice, then an open plan, then the trial, and a founder never was on trial', () => {
    const w = clone(world);
    const [founder, other] = [w.company.agents.find((a) => a.founder && w.company.league!.entries[a.id]?.primary)!, w.company.agents.find((a) => !a.founder)!];
    w.day = 3;
    expect(orgDetail(w).depts.flatMap((d) => d.heads).find((h) => h.agentId === founder.id)!.contract).toBe('active');
    w.day = world.day;
    other.hiredDay = w.day - 2;
    other.notice = { day: w.day, reason: 'x', by: 'zoe', kind: 'fired' };
    w.company.league!.plans.push({ agentId: founder.id, skill: 'copy', openedSeason: 1, deadlineDay: 40, metricLabel: 'q', baseline: 1, target: 2, coachId: null, text: 'p', outcome: 'open' });
    const heads = orgDetail(w).depts.flatMap((d) => d.heads);
    expect(heads.find((h) => h.agentId === other.id)!.contract).toBe('notice');
    expect(heads.find((h) => h.agentId === founder.id)!.contract).toBe('probation');
  });

  it('Compétition: observed numbers ranked, the cut line where rating + 0,75 rd falls under par, the truth only with god', () => {
    const w = clone(world);
    const league = w.company.league!;
    const rated = Object.values(league.entries).find((e) => e.primary && e.ratings[e.primary])!;
    const twin = { ...clone(rated), agentId: 'twin', name: 'Jumelle' };
    twin.ratings[rated.primary!]!.rating = 1300;
    twin.ratings[rated.primary!]!.rd = 100;
    league.entries.twin = twin;
    const d = leagueDetail(w, false);
    const role = d.roles.find((r) => r.key === rated.primary)!;
    expect(role.rows.map((r) => r.rank)).toEqual(role.rows.map((_, i) => i + 1));
    expect(role.rows.map((r) => r.rating)).toEqual([...role.rows.map((r) => r.rating)].sort((a, b) => b - a));
    expect(role.cutLine).toBe(role.rows.findIndex((r) => r.agentId === 'twin') + 1);
    expect(role.label).toBeTruthy();
    expect(d.season).toMatchObject({ no: league.season, fromDay: league.seasonStartDay });
    expect(d.season.daysLeft).toBe(d.season.toDay - w.day);
    expect(d.season.rules.length).toBeGreaterThan(2);
    expect(d.god).toBeUndefined();
    expect(Object.keys(leagueDetail(w, true).god ?? {}).length).toBeGreaterThan(0);
  });

  it('alumni and duels are told in full, with the reason, the delta and the winner', () => {
    const w = clone(world);
    const person = w.company.agents.at(-1)!;
    const replacement = w.company.agents[0]!;
    w.company.org!.alumni.push({ id: 'old', name: 'Ancienne', gender: 'f', roleId: 'ghostwriter', dept: 'studio', founder: false, hiredDay: 5, leftDay: 25, reason: 'plan raté', level: 2, kind: 'fired', replacedBy: replacement.id, perf: { ...person.perf, done: 17 }, avatar: person.avatar });
    w.company.league!.entries.old = { ...clone(Object.values(w.company.league!.entries)[0]!), agentId: 'old', name: 'Ancienne', status: 'gone', leftBecause: 'plan raté : 1,1 pour 1,4 visé', trophies: [{ season: 1, title: 'Employée' }], ratings: { longform: { skill: 'longform', rating: 1520, rd: 90, n: 5, seasonN: 0, metric: null, history: [{ day: 7, rating: 1560 }] } } };
    w.ledger.push({ id: 'led_l', day: 25, type: 'recruiting', amount: -5, memo: 'Départ', ref: 'leave:old' });
    w.company.league!.duels.push({ id: 'duel_z', season: 2, skill: 'copy', kind: 'formal', agents: ['old', replacement.id], productId: 'p', campaignId: 'c', creativeIds: [], taskIds: [], experimentId: null, status: 'settled', startDay: 10, endDay: 15, result: { ctr: [0.01, 0.03], n: [100, 100], z: 3, s: 0.1, delta: -8 } });
    const d = leagueDetail(w, false);
    const row = d.alumni.find((a) => a.person.id === 'old')!;
    expect(row).toMatchObject({ why: 'plan raté : 1,1 pour 1,4 visé', bestRating: 1560, titles: 1, tasksDone: 17, kind: 'fired', hiredDay: 5, leftDay: 25, replacedBy: { id: replacement.id, name: replacement.name } });
    expect(row.cost).toBeGreaterThan(5);
    expect(row.person.name).toBe('Ancienne');
    expect(d.duels.find((x) => x.id === 'duel_z')).toMatchObject({ status: 'done', metric: 'CTR', winnerId: replacement.id, a: { name: 'Ancienne', score: 0.01, ratingDelta: -8 }, b: { score: 0.03, ratingDelta: 8 } });
  });

  it('Canaux: the three readings side by side, money from the ledger, five rows and what is missing to open', () => {
    const d = channelsDetail(world);
    expect(d.rows.map((r) => r.id)).toEqual(['tiktok', 'meta', 'youtube', 'pinterest', 'google']);
    const tiktok = d.rows[0]!;
    expect(tiktok).toMatchObject({ name: 'TikTok', glyph: 'TK', state: 'open', creatives: expect.any(Number) as number });
    const lastDay = world.company.kpis.at(-1)!.day;
    const week = world.ledger.filter((e) => e.type === 'ad_spend' && e.day > lastDay - 7 && e.day <= lastDay);
    expect(d.totals.spend7d).toBeCloseTo(-week.reduce((s, e) => s + e.amount, 0), 1);
    expect(tiktok.spend7d).toBeGreaterThan(0);
    expect(tiktok.reconciledRoas7d).toBeCloseTo(tiktok.reconciledRevenue7d / tiktok.spend7d, 1);
    expect(tiktok.inflation).toBeCloseTo(tiktok.claimedRevenue7d / tiktok.shopRevenue7d, 1);
    expect(tiktok.daily.length).toBeLessThanOrEqual(30);
    const closed = d.rows.find((r) => r.state === 'closed');
    if (closed) {
      expect(closed.unlock.some((s) => s.label === 'Media buyer')).toBe(true);
      expect(closed.why).toMatch(/^(Fermé|En pause)/);
    }
    expect(d.matrix).toEqual(world.company.channels!.lines);
    expect(d.plan).toEqual(world.company.channels!.plan);
  });

  it('a TikTok-only day has no kpi.channels: its figures come back from the rows, a banned account says until when', () => {
    const w = clone(world);
    for (const k of w.company.kpis) delete k.channels;
    w.market.adAccount = { strikes: 3, banned: true, bannedUntilDay: w.day + 5 };
    const d = channelsDetail(w);
    const [tiktok, ...others] = d.rows;
    expect(tiktok!.spend30d).toBeGreaterThan(0);
    expect(tiktok!.shopRevenue7d).toBe(tiktok!.reconciledRevenue7d);
    expect(tiktok!.inflation === null || tiktok!.inflation === 1).toBe(true);
    expect(tiktok).toMatchObject({ state: 'banned', strikes: 3, why: `Compte suspendu jusqu'au jour ${w.day + 5}.` });
    expect(others.every((r) => r.spend30d === 0)).toBe(true);
  });

  it('the gallery pages the whole run, newest first: archive included, one tile per video, a cover on each guide (D27)', () => {
    const w = clone(world);
    const guide = w.company.products.find((p) => p.files?.cover)!;
    const archived: Deliverable[] = Array.from({ length: 70 }, (_, i) => ({ id: `old_${i}`, kind: 'ad_preview', title: 'Ancien', productId: null, creativeId: null, path: `files/${i}.html`, createdBy: 'zoe', day: 1, quality: null }));
    w.company.deliverables.push({ id: 'dlv_guide', kind: 'pdf', title: 'Guide', productId: guide.id, creativeId: null, path: 'files/g.pdf', createdBy: 'zoe', day: 29, quality: 80 });
    const creative = w.company.creatives.at(-1)!;
    const videos = { [creative.id]: video(creative.id), evicted: { ...video('evicted'), videos: [] }, nothing: { ...video('nothing'), videos: [], poster: null } };
    const first = deliverablesPage(w, {}, videos, [...archived, { ...archived[0]!, id: w.company.deliverables[0]!.id }]);
    expect(first).toMatchObject({ page: 1, pageSize: 60 });
    expect(first.total).toBe(w.company.deliverables.length + 70 + 2);
    expect(first.pages).toBe(Math.ceil(first.total / 60));
    expect(first.items).toHaveLength(60);
    expect(first.items.map((t) => t.day)).toEqual([...first.items.map((t) => t.day)].sort((a, b) => b - a));
    const last = deliverablesPage(w, { page: 99 }, videos, archived);
    expect(last.page).toBe(last.pages);
    expect(last.items.map((t) => t.id)).toContain('old_0');

    const only = deliverablesPage(w, { kinds: ['ad_video', 'pdf'] }, videos, archived);
    expect(new Set(only.items.map((t) => t.kind))).toEqual(new Set(['ad_video', 'pdf']));
    const tile = only.items.find((t) => t.creativeId === creative.id)!;
    expect(tile).toMatchObject({ id: `vid_${creative.id}`, kind: 'ad_video', title: creative.hook, path: `video/${creative.id}/9x16.mp4`, poster: `video/${creative.id}/poster.png`, productId: creative.productId });
    expect(only.items.find((t) => t.id === 'vid_evicted')).toMatchObject({ path: 'video/evicted/poster.png', creativeId: 'evicted' });
    expect(only.items.some((t) => t.id === 'vid_nothing')).toBe(false);
    expect(only.items.find((t) => t.id === 'dlv_guide')?.poster).toBe(guide.files.cover);
    expect(w.company.deliverables.every((d) => (d.kind as string) !== 'ad_video')).toBe(true);
  });
});

describe('the routes', () => {
  let port: number;
  let close: () => Promise<void>;
  let served: WorldState;
  let truthAgent: string;
  const items: Record<string, CreativeVideo> = {};

  const session = (w: WorldState): SessionLike => ({
    info: () => ({ runId: w.runId, playing: false, speed: 1, mindMode: 'heuristic' }),
    status: () => w.status,
    snapshotJson: (god) => snapshotJson(w, god, { videos: items }),
    liveSnapshotJson: (god) => liveSnapshotJson(w, god, { videos: items }),
    tickJson: () => JSON.stringify({ type: 'tick', day: w.day, tick: w.tick }),
    control: async () => ({ runId: w.runId, playing: false, speed: 1, mindMode: 'heuristic' }),
    newRun: async () => undefined,
    loadRun: async () => undefined,
    mission: async () => 'mis_1',
    chat: async () => '',
    approve: async () => undefined,
    brainList: async () => [],
    brainNote: async () => null,
    brainGraph: async () => ({}),
    listRuns: async () => [],
    ...sessionViews({ world: w, paths, videoIndex: () => ({ level: 'full', reason: null, items }) }),
  });

  const get = (path: string, init?: RequestInit): Promise<Response> => fetch(`http://127.0.0.1:${port}${path}`, init);
  const json = async <T>(path: string): Promise<T> => (await get(path)).json() as Promise<T>;

  /** Everything the stream says up to its first snapshot. */
  async function firstFrames(path: string): Promise<string> {
    const stop = new AbortController();
    const res = await get(path, { signal: stop.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('"company"') || !text.endsWith('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    stop.abort();
    return text;
  }

  beforeAll(async () => {
    served = clone(world);
    const { entries } = served.company.league!;
    truthAgent = Object.keys(served.talentTruth!.agents).find((id) => entries[id]?.primary)!;
    served.talentTruth!.agents[truthAgent]!.talent[entries[truthAgent]!.primary!] = SENTINEL;
    const creative = served.company.creatives.at(-1)!;
    items[creative.id] = video(creative.id);
    await mkdir(join(paths.root, 'archive'), { recursive: true });
    await writeFile(join(paths.root, 'archive', 'deliverables.ndjson'), `${JSON.stringify({ id: 'liv_archived', kind: 'pdf', title: 'Archivé', productId: null, creativeId: null, path: 'files/a.pdf', createdBy: 'zoe', day: 2, quality: 70 })}\n`);
    const app = createAgencyServer({ session: session(served), runsRoot: join(paths.root, 'runs'), webDist: join(paths.root, 'no-dist'), sse: { heartbeatMs: 60_000, snapshotMinIntervalMs: 0 } });
    close = app.close;
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => { await close(); });

  it('the sentinel of the truth is nowhere without ?god=1, and god mode serves it on the league alone', async () => {
    const productId = served.company.products[0]!.id;
    for (const path of ['/api/state', '/api/org', '/api/league', '/api/channels', '/api/digest', '/api/growth', '/api/deliverables', `/api/playbook?agentId=${truthAgent}`, `/api/product/${productId}`, '/api/org?god=1', '/api/digest?god=1', '/api/channels?god=1']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).not.toContain(String(SENTINEL));
    }
    expect(await firstFrames('/api/stream')).not.toContain(String(SENTINEL));
    expect(await (await get('/api/state?god=1')).text()).toContain(String(SENTINEL));
    expect((await json<LeagueDetail>('/api/league?god=1')).god?.[truthAgent]?.truth).toBe(SENTINEL);
    expect(await firstFrames('/api/stream?god=1')).toContain(String(SENTINEL));
  });

  it('serves each view as its tab reads it', async () => {
    expect((await json<OrgDetail>('/api/org')).headcount).toBe(served.company.agents.length);
    expect((await json<LeagueDetail>('/api/league')).roles.length).toBeGreaterThan(0);
    expect((await json<ChannelsDetail>('/api/channels')).rows).toHaveLength(5);
    const growth = await json<GrowthState>('/api/growth');
    expect(growth.weeks).toEqual(served.company.growth!.weeks);
    expect(growth.decisions).toEqual(served.company.growth!.decisions);
    expect(growth.niches).toEqual(served.company.growth!.niches);
    const agent = served.company.agents.find((a: AgentState) => served.company.playbooks[a.id]?.length)!;
    expect(await json<string[]>(`/api/playbook?agentId=${agent.id}`)).toEqual(served.company.playbooks[agent.id]);
    expect(await json<string[]>('/api/playbook?agentId=personne')).toEqual([]);
    const page = await json<DeliverablePage>('/api/deliverables?kinds=pdf,ad_video');
    expect(page.items.some((t) => t.kind === 'ad_video')).toBe(true);
    expect(page.items.map((t) => t.id)).toContain('liv_archived'); // what compaction took away still shows
    const guide = served.company.products[0]!;
    expect((await json<Product>(`/api/product/${encodeURIComponent(guide.id)}`)).id).toBe(guide.id);
  });

  it('refuses what is not a view, in French', async () => {
    expect((await get('/api/product/absent')).status).toBe(404);
    expect(((await (await get('/api/product/absent')).json()) as { error: string }).error).toContain('Produit inconnu');
    expect((await get('/api/playbook')).status).toBe(400);
    expect((await get('/api/org', { method: 'POST' })).status).toBe(405);
    expect((await get('/api/product/x', { method: 'POST' })).status).toBe(405);
    expect((await get('/api/digest/seen')).status).toBe(405);
    expect((await get('/api/product/a/b')).status).toBe(404);
    expect((await get('/api/inconnue')).status).toBe(404);
  });

  it('the digest starts where he left, and « vu » moves that day, on the world and in the save', async () => {
    served.company.growth!.founder = { lastSeenDay: 20, lastSeenAt: null };
    const digest = await json<FounderDigest>('/api/digest');
    expect(digest.fromDay).toBe(20);
    expect(digest.toDay).toBe(served.day);
    expect(digest.highlights.every((h) => h.day >= 20)).toBe(true);
    expect((await json<FounderDigest>('/api/digest?since=7&to=14')).toDay).toBe(14);

    const res = await get('/api/digest/seen', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { founder: GrowthState['founder'] }).founder.lastSeenDay).toBe(served.day);
    expect(served.company.growth!.founder.lastSeenDay).toBe(served.day);
    expect(Date.parse(served.company.growth!.founder.lastSeenAt!)).toBeGreaterThan(0);
    expect((await json<FounderDigest>('/api/digest')).fromDay).toBe(served.day);
    expect((JSON.parse(snapshotJson(served)) as CompanySnapshot).company.growth!.founder.lastSeenDay).toBe(served.day);
    await flushSaves();
    expect((await loadWorld(served.runId))?.company.growth?.founder.lastSeenDay).toBe(served.day);
  });

  it('a server without a mounted agency answers 503, like every other route', async () => {
    const down = createAgencyServer({ session: unavailableSession('panne'), runsRoot: join(paths.root, 'runs'), webDist: join(paths.root, 'no-dist'), sse: { heartbeatMs: 60_000 } });
    await new Promise<void>((r) => down.server.listen(0, '127.0.0.1', () => r()));
    const at = (down.server.address() as AddressInfo).port;
    for (const [path, method] of [['/api/org', 'GET'], ['/api/product/x', 'GET'], ['/api/digest/seen', 'POST']] as const) {
      expect((await fetch(`http://127.0.0.1:${at}${path}`, { method })).status, path).toBe(503);
    }
    await down.close();
  });
});
