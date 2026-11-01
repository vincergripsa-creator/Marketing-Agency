/** What a reader sees must be what happened: each test comes from a false line found on a real world. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentId, AgentState, Campaign, DailyKpi, Mission, Product, ScenarioConfig, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { createRng, quietDay } from '../src/core/index.js';
import { fullProduct, trimProduct } from '../src/api/trim.js';
import { orgDetail, leagueDetail } from '../src/api/views.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { buildDigest } from '../src/runtime/digest.js';
import { compactWorld } from '../src/runtime/compaction.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { activeHolds, adsHold, firingHold, hiringHold, addHold, pinHold } from '../src/runtime/holds.js';
import { orderAction, ordersIn, requestBeside } from '../src/runtime/missions.js';
import { currentBudget } from '../src/runtime/metrics.js';
import { sim } from '../src/runtime/modules.js';
import { CANDIDATES, ROLES } from '../src/runtime/org/catalog.js';
import { reconcileOrg } from '../src/runtime/org/reconcile.js';
import { createTask } from '../src/runtime/tasks.js';
import { addReview, reviewBasis, reviewText } from '../src/sim/feedback.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function mount(world: WorldState): { company: Company; ctx: RuntimeCtx } {
  const root = mkdtempSync(join(tmpdir(), 'pixel-truth-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain: createBrainVault(paths) });
  return { company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx };
}

const legacyWorld = (over: Partial<ScenarioConfig> = {}, seed = 5): WorldState => createWorld(defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), `test-truth-${seed}`);
const leanWorld = (over: Partial<ScenarioConfig> = {}, seed = 7): WorldState => createWorld(defaultScenario({ seed, mindMode: 'heuristic', maxComputeEur: 0, ...over }), `test-truth-lean-${seed}`);

function liveProduct(world: WorldState, id: string, nicheId: string): Product {
  const p: Product = {
    id, nicheId, title: `Guide ${id}`, subtitle: '', audience: 'Parents', problem: 'Un problème', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
  world.company.products.push(p);
  return p;
}

function campaign(world: WorldState, id: string, productId: string, over: Partial<Campaign> = {}): Campaign {
  const c: Campaign = { id, productId, name: `Campagne ${id}`, creativeIds: [`cre_${id}`], dailyBudget: 20, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 54 }, startDay: 1, createdBy: 'adam', ...over };
  world.company.campaigns.push(c);
  return c;
}

/** A second holder of a role: the person can leave at once. */
function teammate(world: WorldState, id: AgentId): AgentState {
  const { legacyDept: _, ...def } = CANDIDATES[id]!;
  const role = ROLES[def.roleId];
  const agent: AgentState = {
    ...def, dept: role.dept, taskKinds: [...role.core, ...role.assist], avatar: { ...def.avatar }, status: 'idle', place: role.dept, currentTaskId: null, energy: 100, level: 1, xp: 0,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 }, bubble: null, hatKinds: [], hatDepts: [], hiredDay: 0, rampUntilDay: 0, notice: null, founder: false,
  };
  world.company.agents.push(agent);
  world.company.playbooks[id] = [];
  reconcileOrg(world);
  return agent;
}

const missionOf = (w: WorldState, id: string): Mission => w.company.missions.find((m) => m.id === id)!;

describe('what the founder types (T10)', () => {
  it('« ne coupe pas les pubs » stops nothing and says so', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    const id = await company.giveMission('ne coupe pas les pubs');
    expect(c.status).toBe('active');
    expect(adsHold(w)).toBeNull();
    expect(missionOf(w, id).status).toBe('done');
    expect(missionOf(w, id).outcome).toContain('je ne change rien');
  });

  it('every way of refusing an order is read as a refusal, and reads nothing else', () => {
    for (const text of ['ne touche pas aux pubs', "n'arrête pas les pubs", 'ne stoppe jamais les pubs', 'pas besoin de couper les pubs', 'inutile de couper les pubs', 'arrête de couper les pubs',
      'ne reprends pas les pubs', 'ne relance pas les pubs', 'ne supprime pas le guide sur le chiot', 'ne bloque pas les embauches', 'ne double pas le budget pub']) {
      expect(orderAction(text), text).toBe('negated');
    }
    // These stop something: the « ne » is the order.
    for (const text of ['ne lance plus de pub', 'ne publie plus de pubs', 'ne fais plus de pub']) expect(orderAction(text), text).toBe('stop_ads');
    expect(orderAction('ne touche pas à la marge')).toBeNull();
    expect(orderAction("n'hésite pas à couper les pubs")).toBe('stop_ads');
    expect(orderAction('ne vire pas Sarah')).toBe('pin_agent');
  });

  it('a refused resume keeps his standing order', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    await company.giveMission('coupe toutes les pubs');
    await company.giveMission('ne reprends pas les pubs');
    expect(c.status).toBe('paused');
    expect(adsHold(w)).not.toBeNull();
  });

  it('« arrête la campagne 2 » stops that one and no other', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [one, two, three] = [campaign(w, 'cmp_1', p.id), campaign(w, 'cmp_2', p.id), campaign(w, 'cmp_3', p.id)];
    const id = await company.giveMission('arrête la campagne 2');
    expect(two).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect([one.status, three.status]).toEqual(['active', 'active']);
    expect(adsHold(w)).toBeNull();
    expect(missionOf(w, id).outcome).toMatch(/n° 2 « Campagne cmp_2 » est en pause, les autres continuent/);
    await company.giveMission('reprends la campagne 2');
    expect(two.status).toBe('active');
    expect(two.pausedFor).toBeUndefined();
  });

  it('a number nobody carries stops nothing and shows what runs', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const a = campaign(w, 'cmp_1', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    const id = await company.giveMission('arrête la campagne 9');
    expect(a.status).toBe('active');
    expect(missionOf(w, id).status).toBe('failed');
    expect(missionOf(w, id).outcome).toMatch(/aucune campagne ne porte le n° 9.*En cours : n° 1/);
  });

  it('his order on every ad stands over one campaign', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_1', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    await company.giveMission('coupe toutes les pubs');
    const id = await company.giveMission('reprends la campagne 1');
    expect(c.status).toBe('paused');
    expect(missionOf(w, id).status).toBe('failed');
    expect(missionOf(w, id).outcome).toMatch(/Je n'ai rien relancé.*reprends les pubs/);
  });

  it('« vire Sarah et Tom » takes both, and names who it took', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const [a, b] = [teammate(w, 'tom'), teammate(w, 'sarah')];
    const id = await company.giveMission(`vire ${a.name} et ${b.name}`);
    expect(w.company.org!.alumni.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(missionOf(w, id).outcome).toContain(a.name);
    expect(missionOf(w, id).outcome).toContain(b.name);
  });

  it('a list goes on past two names, and a stranger in it is said back', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const [a, b] = [teammate(w, 'tom'), teammate(w, 'sarah')];
    const id = await company.giveMission(`vire ${a.name}, Zorglub et ${b.name}`);
    expect(w.company.org!.alumni.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(missionOf(w, id).outcome).toContain('Personne ne s\'appelle Zorglub');
    expect(ordersIn('garde Sarah et Tom').map((o) => o.action)).toEqual(['pin_agent', 'pin_agent']);
    expect(ordersIn('ne vire pas Sarah ni Tom').map((o) => o.action)).toEqual(['pin_agent', 'pin_agent']);
  });

  it('a doubt fires nobody, even in a list', () => {
    expect(ordersIn('Il faudrait virer Nadia et Tom')).toEqual([]);
    expect(orderAction('vire Sarah ?')).toBeNull();
  });

  it('a comma inside a lift is still a lift', async () => {
    for (const text of ["lève, s'il te plaît, le gel des embauches", 'annule, stp, le gel des embauches', 'lève, le gel des embauches']) expect(orderAction(text), text).toBe('resume_hiring');
    expect(orderAction('lève, stp, la protection de Sarah')).toBe('unpin_agent');
    const w = leanWorld();
    const { company } = mount(w);
    addHold(w, { kind: 'hiring', productId: null, until: null, reason: 'gel' });
    await company.giveMission("lève, s'il te plaît, le gel des embauches");
    expect(hiringHold(w)).toBeNull();
  });

  it('an order beside a plain request runs, and the request goes on', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'proprete-chiot').id);
    const id = await company.giveMission('coupe les pubs et lance un guide sur le sommeil du bébé');
    const m = missionOf(w, id);
    expect(c.status).toBe('paused');
    expect(adsHold(w)).not.toBeNull();
    expect(m.wantsProduct).toBe(true);
    expect(m.nicheId).toBe('sommeil-bebe');
    expect(m.status).toBe('open');
    expect(m.taskIds.length).toBeGreaterThan(0);
    expect(m.outcome).toContain('Aucune pub ne repartira');
    expect(m.outcome).toContain('Compris : un guide');
  });

  it('a media trim beside a request keeps both', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const id = await company.giveMission('coupe les pubs non rentables et réponds aux clients');
    const kinds = w.company.tasks.filter((t) => t.missionId === id).map((t) => t.kind);
    expect(kinds).toContain('optimize_ads');
    expect(kinds).toContain('reply_inbox');
  });

  it('a comment beside an order is no request', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'proprete-chiot').id);
    expect(requestBeside('coupe la pub, ça coûte trop cher')).toBe('');
    expect(requestBeside('coupe tout sauf TikTok, Meta')).toBe('');
    expect(requestBeside('vire Sarah et Tom')).toBe('');
    expect(requestBeside('lance un guide sur le sommeil')).toBe('');
    const id = await company.giveMission('coupe la pub, ça coûte trop cher');
    expect(w.company.tasks.filter((t) => t.missionId === id)).toEqual([]);
    expect(missionOf(w, id).status).toBe('done');
  });

  it('a list reads each person through the same guardrails: the pin of the second name, approval mode on', async () => {
    const w = leanWorld({ founderApproval: true });
    const { company } = mount(w);
    const [a, b] = [teammate(w, 'tom'), teammate(w, 'sarah')];
    await company.giveMission(`garde ${b.name}`);
    const id = await company.giveMission(`vire ${a.name} et ${b.name}`);
    expect(missionOf(w, id).outcome).toContain(a.name);
    expect(missionOf(w, id).outcome).toContain(b.name);
    expect(w.company.org!.alumni.map((x) => x.id).sort()).toEqual([a.id, b.id].sort()); // his latest word on each, as for one name
    expect(pinHold(w, b.id)).toBeNull();
    const kept = w.company.agents.find((x) => x.roleId === 'cfo')!;
    await company.giveMission(`ne vire pas ${kept.name} ni ${a.name}`);
    expect(pinHold(w, kept.id)).not.toBeNull();
    expect(w.company.agents.map((x) => x.id)).toContain(kept.id);
  });

  it('« sauf la campagne 2 » is what stays: every other one stops, and a hold stops what is new', async () => {
    for (const text of ['coupe les pubs sauf la campagne 2', 'arrête toutes les pubs sauf la campagne 2', 'coupe tout sauf la campagne 2', 'coupe les pubs hors campagne 2', 'coupe les pubs à part la campagne 2', 'coupe les pubs sans toucher à la campagne 2']) {
      const w = legacyWorld();
      const { company } = mount(w);
      const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
      const [one, two, three] = [campaign(w, 'cmp_1', p.id), campaign(w, 'cmp_2', p.id), campaign(w, 'cmp_3', p.id)];
      const id = await company.giveMission(text);
      expect(two.status, text).toBe('active');
      expect([one.status, three.status], text).toEqual(['paused', 'paused']);
      expect(one.pausedFor, text).toBe('founder');
      expect(adsHold(w), text).not.toBeNull();
      expect(missionOf(w, id).outcome, text).toMatch(/2 campagne\(s\) en pause.*Restent en cours sur ton ordre : n° 2/);
    }
  });

  it('what « sauf » keeps runs under the hold: the buyer leaves it, « reprends les pubs » brings back the others', async () => {
    const w = legacyWorld();
    const { company, ctx } = mount(w);
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [one, two] = [campaign(w, 'cmp_1', p.id), campaign(w, 'cmp_2', p.id)];
    await company.giveMission('coupe les pubs sauf la campagne 2');
    const buyer = w.company.agents.find((a) => a.taskKinds.includes('optimize_ads'))!;
    const task = createTask(w, { kind: 'optimize_ads', title: 'Optimiser', input: {}, createdBy: 'system' });
    await HANDLERS.optimize_ads.run(ctx, task, buyer, { agent: buyer, playbook: [], brainNotes: [], lessons: [], day: w.day });
    expect(two.status).toBe('active');
    await company.giveMission('reprends les pubs');
    expect(adsHold(w)).toBeNull();
    expect(one.status).toBe('active');
  });

  it('« sauf le guide » keeps what runs on that guide, and only that', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const [chiot, bebe] = [liveProduct(w, 'prd_c', 'proprete-chiot'), liveProduct(w, 'prd_b', 'sommeil-bebe')];
    const [a, b] = [campaign(w, 'cmp_c', chiot.id), campaign(w, 'cmp_b', bebe.id)];
    await company.giveMission('coupe les pubs sauf le guide du chiot');
    expect(a.status).toBe('active');
    expect(b.status).toBe('paused');
    const other = legacyWorld();
    const lab = mount(other);
    const [c2, b2] = [liveProduct(other, 'prd_c', 'proprete-chiot'), liveProduct(other, 'prd_b', 'sommeil-bebe')];
    const [a2, d2] = [campaign(other, 'cmp_c', c2.id), campaign(other, 'cmp_b', b2.id)];
    await lab.company.giveMission('coupe les pubs sans toucher au guide du chiot');
    expect(a2.status).toBe('active');
    expect(d2.status).toBe('paused');
  });

  it('a number nobody carries after « sauf » stops nothing: he is shown what runs', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const a = campaign(w, 'cmp_1', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    const id = await company.giveMission('coupe les pubs sauf la campagne 9');
    expect(a.status).toBe('active');
    expect(adsHold(w)).toBeNull();
    expect(missionOf(w, id).status).toBe('failed');
    expect(missionOf(w, id).outcome).toMatch(/aucune campagne ne porte le n° 9.*En cours : n° 1/);
  });

  it('« reprends les pubs sauf la campagne 2 » leaves that one stopped', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    sim.recordLedger(w, { type: 'revenue', amount: 5000, memo: 'Ventes', ref: null });
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [one, two] = [campaign(w, 'cmp_1', p.id, { channel: 'tiktok' }), campaign(w, 'cmp_2', p.id, { channel: 'tiktok' })];
    await company.giveMission('coupe toutes les pubs');
    await company.giveMission('reprends les pubs sauf la campagne 2');
    expect(one.status).toBe('active');
    expect(two).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(adsHold(w)).toBeNull();
  });

  it('several campaigns in one order: each one named stops, whatever the list looks like', async () => {
    for (const text of ['arrête la campagne 2 et la campagne 3', 'arrête les campagnes 2 et 3', 'coupe la campagne 2, la campagne 3']) {
      const w = legacyWorld();
      const { company } = mount(w);
      const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
      const [one, two, three] = [campaign(w, 'cmp_1', p.id), campaign(w, 'cmp_2', p.id), campaign(w, 'cmp_3', p.id)];
      await company.giveMission(text);
      expect([one.status, two.status, three.status], text).toEqual(['active', 'paused', 'paused']);
      expect(adsHold(w), text).toBeNull();
    }
  });

  it('a limit on a stop is no refusal of it: the order stands, and what the limit names stays', async () => {
    for (const text of ['coupe les pubs sans toucher au reste', 'arrête toutes les pubs sans annuler les lancements', 'stoppe les pubs sans annuler les tâches', 'coupe tout sans toucher aux guides']) {
      expect(orderAction(text), text).toBe('stop_ads');
      const w = legacyWorld();
      const { company } = mount(w);
      const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
      const id = await company.giveMission(text);
      expect(c.status, text).toBe('paused');
      expect(adsHold(w), text).not.toBeNull();
      expect(missionOf(w, id).outcome, text).toContain('Aucune pub ne repartira');
    }
    expect(ordersIn(`vire Tom sans toucher à Sarah`)).toEqual([{ action: 'fire_agent', text: 'vire Tom sans toucher à Sarah' }]);
    const w = legacyWorld();
    const { company } = mount(w);
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [tiktok, meta] = [campaign(w, 'cmp_t', p.id, { channel: 'tiktok' }), campaign(w, 'cmp_m', p.id, { channel: 'meta' })];
    await company.giveMission('coupe les pubs sans toucher à TikTok');
    expect([tiktok.status, meta.status]).toEqual(['active', 'paused']);
  });

  it('a request under a limit stays the request: « lance un guide sans couper les pubs »', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'proprete-chiot').id);
    expect(ordersIn('lance un guide sans couper les pubs')).toEqual([]);
    expect(requestBeside('lance un guide sans couper les pubs')).toBe('lance un guide');
    expect(requestBeside('coupe les pubs sans toucher au reste')).toBe('');
    expect(requestBeside('coupe Meta et lance un guide sans toucher à TikTok')).toBe('lance un guide');
    const id = await company.giveMission('lance un guide sans couper les pubs');
    expect(c.status).toBe('active');
    expect(adsHold(w)).toBeNull();
    expect(missionOf(w, id).status).toBe('open');
    expect(w.company.tasks.filter((t) => t.missionId === id).length).toBeGreaterThan(0);
  });

  it('a word that only looks like a refusal stops all the same', async () => {
    for (const text of ['pas le choix coupe les pubs', 'pas grave coupe les pubs', 'en plus coupe les pubs', 'au plus vite coupe les pubs', 'de plus coupe les pubs', 'en plus couper les pubs', 'de plus couper les pubs']) {
      expect(orderAction(text), text).toBe('stop_ads');
      const w = legacyWorld();
      const { company } = mount(w);
      const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
      await company.giveMission(text);
      expect(c.status, text).toBe('paused');
    }
  });

  it('a refusal reads through an adverb, a ni, a que: nothing is paused and he is told', async () => {
    for (const text of ['ne coupe absolument pas les pubs', 'ne coupe vraiment pas les pubs', 'ne coupe ni les pubs ni les lancements', "je ne veux pas que tu coupes les pubs", "je ne veux plus qu'on coupe les pubs", 'ne bouge pas les pubs', 'ne change pas les pubs', 'il ne faut surtout pas couper les pubs', 'il ne faut pas du tout couper les pubs', 'hors de question de couper les pubs']) {
      const w = legacyWorld();
      const { company } = mount(w);
      const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
      const id = await company.giveMission(text);
      expect(c.status, text).toBe('active');
      expect(activeHolds(w), text).toEqual([]);
      expect(missionOf(w, id).outcome, text).toContain('je ne change rien');
    }
  });

  it('a question stops nothing and lifts nothing', async () => {
    for (const text of ['pourquoi as-tu coupé les pubs ?', 'tu as coupé les pubs ?', 'faut-il couper les pubs ?', 'tu crois que je coupe les pubs ?', 'faut-il tout arrêter ?', 'faut-il arrêter de dépenser ?', 'faut-il retirer le guide sur le chiot ?', 'coupe les pubs, tu crois ?']) {
      expect(ordersIn(text), text).toEqual([]);
    }
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    await company.giveMission('pourquoi as-tu coupé les pubs ?');
    expect(c.status).toBe('active');
    expect(activeHolds(w)).toEqual([]);
    await company.giveMission('coupe toutes les pubs');
    for (const text of ['faut-il reprendre les pubs ?', 'tu peux relancer les pubs ?', 'on reprend les pubs ?', 'lève le gel ?']) {
      await company.giveMission(text);
      expect(adsHold(w), text).not.toBeNull();
      expect(c.status, text).toBe('paused');
    }
  });

  it('a question lifts no freeze on people, and neither does a doubt', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    await company.giveMission('Gèle les départs');
    await company.giveMission('gèle les embauches');
    for (const text of ['tu peux virer ?', 'regarde si tu peux virer Tom', 'dis-moi si on peut recruter', 'tu peux embaucher ?', 'garde Sarah ?']) {
      expect(ordersIn(text), text).toEqual([]);
      await company.giveMission(text);
    }
    expect(firingHold(w)).not.toBeNull();
    expect(hiringHold(w)).not.toBeNull();
  });

  it('an order in good manners is an order when it stops, and a question beside a stop takes nothing from it', () => {
    for (const text of ['tu peux couper les pubs ?', 'peux-tu couper les pubs ?', 'Bon, tu pourrais couper les pubs ?', 'pouvez-vous arrêter toutes les pubs ?', 'coupe les pubs. Tu as vu les chiffres ?']) {
      expect(orderAction(text), text).toBe('stop_ads');
    }
    expect(orderAction('tu peux tuer le guide sur le chiot ?')).toBeNull(); // a stop, not what cannot be undone
    for (const text of ['tu peux me dire si on coupe les pubs ?', 'tu peux regarder si on doit couper les pubs ?']) expect(orderAction(text), text).toBeNull();
    expect(orderAction('tu peux me couper les pubs ?')).toBe('stop_ads');
    expect(orderAction('vire Sarah. Tu as vu ses chiffres ?')).toBeNull();
  });

  it('what he reports is no order: the past tense stops nothing', async () => {
    for (const text of ["j'ai coupé les pubs", 'hier on a coupé les pubs', "on n'a pas coupé les pubs", 'tu as déjà arrêté les pubs', 'nous avons repris les pubs', 'ils ont relancé les pubs']) expect(ordersIn(text), text).toEqual([]);
    for (const text of ['il reste à couper les pubs', "je t'ai dit de couper les pubs", 'tu as à couper les pubs']) expect(orderAction(text), text).toBe('stop_ads');
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_a', liveProduct(w, 'prd_a', 'sommeil-bebe').id);
    await company.giveMission("j'ai coupé les pubs");
    expect(c.status).toBe('active');
    expect(adsHold(w)).toBeNull();
    await company.giveMission("j'ai coupé les pubs Meta, coupe aussi les pubs TikTok");
    expect(c.status).toBe('paused');
  });

  it('« tout sauf les pubs » leaves the ads, and « tout sauf les guides » the guides', async () => {
    expect(orderAction('coupe tout sauf les pubs')).toBeNull();
    expect(orderAction('coupe tout sauf les guides')).toBe('stop_ads');
    expect(orderAction('coupe tout sauf les embauches')).toBe('stop_ads');
    expect(orderAction('mets le guide sur le chiot hors ligne')).toBe('pause_product');
    const w = legacyWorld();
    const { company } = mount(w);
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const c = campaign(w, 'cmp_a', p.id);
    await company.giveMission('coupe tout sauf les pubs');
    expect(c.status).toBe('active');
    await company.giveMission('coupe tout sauf les guides');
    expect(c.status).toBe('paused');
    expect(p.status).toBe('live');
  });

  it('every channel but one, whatever stands around it', async () => {
    for (const text of ['coupe tout, garde TikTok', 'coupe le reste sauf TikTok', 'arrête la création sauf sur TikTok']) expect(orderAction(text), text).toBe('stop_ads');
    const w = legacyWorld();
    const { company } = mount(w);
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [tiktok, meta] = [campaign(w, 'cmp_t', p.id, { channel: 'tiktok' }), campaign(w, 'cmp_m', p.id, { channel: 'meta' })];
    await company.giveMission('coupe tout, garde TikTok');
    expect([tiktok.status, meta.status]).toEqual(['active', 'paused']);
  });

  it('« ne vire ni Sarah ni Tom » protects both', () => {
    expect(ordersIn('ne vire ni Sarah ni Tom').map((o) => o.action)).toEqual(['pin_agent', 'pin_agent']);
  });

  it('an « et » closes a list only with a name: what follows may be another order', () => {
    expect(ordersIn('vire Tom, Sarah et lance un guide').filter((o) => o.action === 'fire_agent')).toHaveLength(1);
    expect(ordersIn('vire Tom, Sarah et coupe les pubs').map((o) => o.action).sort()).toEqual(['fire_agent', 'stop_ads']);
    expect(ordersIn('vire Tom, Sarah et Léa').filter((o) => o.action === 'fire_agent')).toHaveLength(3);
    expect(ordersIn('vire Tom, Sarah et Léa B.').filter((o) => o.action === 'fire_agent')).toHaveLength(3);
  });

  it('a name after a bare comma is who he speaks to, never a second firing', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const [a, b] = [teammate(w, 'tom'), teammate(w, 'sarah')];
    expect(ordersIn(`vire ${a.name}, ${b.name}`).map((o) => o.action)).toEqual(['fire_agent']);
    await company.giveMission(`vire ${a.name}, ${b.name}`, b.id);
    expect(w.company.org!.alumni.map((x) => x.id)).toEqual([a.id]);
    expect(b.notice ?? null).toBeNull();
  });

  it('in a list too, the person he is talking to is not on it', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const [a, b] = [teammate(w, 'tom'), teammate(w, 'sarah')];
    await company.giveMission(`vire ${a.name} et ${b.name}`, b.id);
    expect(w.company.org!.alumni.map((x) => x.id)).toEqual([a.id]);
    const other = leanWorld();
    const lab = mount(other);
    const c = teammate(other, 'tom');
    await lab.company.giveMission(`vire ${c.name}`, c.id); // named on its own, it is an order to her face
    expect(other.company.org!.alumni.map((x) => x.id)).toEqual([c.id]);
  });

  it('a verb alone joins what follows only when what follows has no verb of its own', () => {
    for (const text of ['stop, vire Tom', 'arrête, vire Tom', 'coupe, vire Tom']) expect(orderAction(text), text).toBe('fire_agent');
    expect(orderAction('stop, coupe les pubs')).toBe('stop_ads');
    expect(orderAction('lève, stp, le gel des embauches')).toBe('resume_hiring');
    expect(orderAction("n'hésite pas à virer Tom")).toBeNull(); // no pin, and a push is not a firing
  });

  it('a refused resume keeps his stop, and the next try goes through', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    sim.recordLedger(w, { type: 'revenue', amount: 5000, memo: 'Ventes', ref: null });
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [one, two] = [campaign(w, 'cmp_1', p.id, { channel: 'tiktok' }), campaign(w, 'cmp_2', p.id, { channel: 'tiktok' })];
    await company.giveMission('arrête la campagne 2');
    one.dailyBudget = currentBudget(w).adCap; // no room left today
    const refused = await company.giveMission('reprends la campagne 2');
    expect(two).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(missionOf(w, refused).status).toBe('failed');
    expect(missionOf(w, refused).outcome).toMatch(/son produit, son budget ou les règles de la pub/);
    one.dailyBudget = 5;
    const back = await company.giveMission('reprends la campagne 2');
    expect(missionOf(w, back).status).toBe('done');
    expect(two.status).toBe('active');
    expect(two.pausedFor).toBeUndefined();
  });

  it('a campaign that nothing of his stopped is said to be that', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const c = campaign(w, 'cmp_1', liveProduct(w, 'prd_a', 'sommeil-bebe').id, { status: 'paused' });
    const id = await company.giveMission('reprends la campagne 1');
    expect(c.status).toBe('paused');
    expect(missionOf(w, id).outcome).toMatch(/elle n'est pas en pause sur ton ordre/);
  });

  it('a stop of one campaign says the team may come back, and the sentence it gives stops it for good', async () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const [one, two] = [campaign(w, 'cmp_1', p.id), campaign(w, 'cmp_2', p.id)];
    const id = await company.giveMission('arrête la campagne 2');
    const said = missionOf(w, id).outcome!;
    expect(said).toMatch(/L'équipe peut relancer une autre campagne sur ce guide/);
    expect(adsHold(w, p.id)).toBeNull();
    await company.giveMission(/dis « (coupe les pubs du guide [^»]+) »/.exec(said)![1]!);
    expect(adsHold(w, p.id)).not.toBeNull();
    expect(adsHold(w)).toBeNull();
    expect([one.status, two.status]).toEqual(['paused', 'paused']);
  });
});

describe('reviews (T5)', () => {
  const niche = { voc: { phrases: ['on ne dort plus'], pains: ['Les réveils à répétition'] } } as unknown as Parameters<typeof addReview>[5];
  const withChapters = (w: WorldState, id: string): Product => {
    const p = liveProduct(w, id, 'sommeil-bebe');
    p.content = { chapters: [{ title: 'Le premier soir' }, { title: 'Les réveils' }] } as Product['content'];
    return p;
  };

  it('no line twice on one product, far past what any bank of sentences held', () => {
    const w = legacyWorld();
    const p = withChapters(w, 'prd_a');
    const rng = createRng(1);
    for (let i = 0; i < 400; i++) addReview(w, rng, p, `c${i}`, 1 + (i % 5), niche, i % 11 === 0 ? 'support_bad' : i % 13 === 0 ? 'support_good' : i % 17 === 0 ? 'troll' : 'product');
    const texts = p.stats.reviews.map((r) => r.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.join(' ')).not.toContain('{');
  });

  it('two products read differently, and a replay reads the same', () => {
    const write = (seed: number, id: string): string[] => {
      const w = legacyWorld({}, seed);
      const p = withChapters(w, id);
      const rng = createRng(2);
      for (let i = 0; i < 30; i++) addReview(w, rng, p, `c${i}`, 5, niche);
      return p.stats.reviews.map((r) => r.text);
    };
    expect(write(5, 'prd_a')).toEqual(write(5, 'prd_a'));
    const [a, b] = [write(5, 'prd_a'), write(5, 'prd_b')];
    expect(a.filter((line) => b.includes(line)).length).toBeLessThan(3);
    expect(write(6, 'prd_a')).not.toEqual(a);
  });

  it('the market stream draws what it always drew: same rating, same basis, same position', () => {
    const w = legacyWorld();
    const p = withChapters(w, 'prd_a');
    const q = withChapters(w, 'prd_b');
    const bank = createRng(3);
    const plain = createRng(3);
    for (let i = 0; i < 60; i++) {
      const rating = 1 + (i % 5);
      const kind = i % 7 === 0 ? 'support_bad' : i % 9 === 0 ? 'troll' : 'product';
      const review = addReview(w, bank, p, `c${i}`, rating, niche, kind);
      const basis = reviewText(plain, rating, q, niche, kind); // the old law, alone on its stream
      q.stats.reviews.push({ ...review, text: basis, basis: undefined });
      expect(reviewBasis(review)).toBe(basis);
      expect(review.rating).toBe(rating);
    }
    expect(bank.next()).toBe(plain.next());
  });

  it('the public never receives what the simulation reads', () => {
    const w = legacyWorld();
    const p = withChapters(w, 'prd_a');
    addReview(w, createRng(4), p, 'c1', 5, niche);
    expect(p.stats.reviews[0]!.basis).toBeTruthy();
    expect(JSON.stringify(fullProduct(p))).not.toContain('"basis"');
    expect(JSON.stringify(trimProduct(p))).not.toContain('"basis"');
  });

  it('a review written before the bank reads as its own text', () => {
    expect(reviewBasis({ id: 'r', day: 1, customerId: 'c', rating: 5, text: 'Une vieille ligne.' })).toBe('Une vieille ligne.');
  });
});

describe('a day with no numbers (T6)', () => {
  const kpi = (over: Partial<DailyKpi>): DailyKpi => ({ sales: 0, refunds: 0, adSpend: 0, ...over }) as DailyKpi;

  it('is a day with no sale, no refund, no ad', () => {
    expect(quietDay(kpi({}))).toBe(true);
    expect(quietDay(kpi({ sales: 1 }))).toBe(false);
    expect(quietDay(kpi({ refunds: 1 }))).toBe(false);
    expect(quietDay(kpi({ adSpend: 3 }))).toBe(false);
  });
});

describe('a bankruptcy is one event (T7)', () => {
  const closeAt = (w: WorldState, day: number, cash: number): void => {
    w.day = day;
    w.company.kpis.push({ day, cash } as DailyKpi);
    w.ledger.push({ id: `led_${day}`, day, type: 'platform_fee', amount: cash - sim.financeSnapshot(w).cash, memo: 'test', ref: null });
  };
  const check = (company: Company): void => (company as unknown as { checkStatus(): void }).checkStatus();
  const events = (w: WorldState) => w.market.events.filter((e) => e.kind === 'bankrupt');
  const said = (w: WorldState, text: string) => w.activity.filter((a) => a.text.includes(text)).length;

  it('cash flickering around zero fails once, and spends the same ids as before', () => {
    const w = legacyWorld();
    const { company } = mount(w);
    const flips = [-5, 4, -3, 2, -1, 6, -2];
    let ids = 0;
    flips.forEach((cash, i) => {
      const before = w.idCounter;
      closeAt(w, 40 + i, cash);
      check(company);
      ids = w.idCounter - before;
      expect(w.status).toBe(cash < 0 ? 'bankrupt' : 'running'); // the law of the status does not move
    });
    expect(ids).toBeGreaterThan(0);
    expect(events(w)).toHaveLength(1);
    expect(said(w, 'toutes les pubs sont coupées')).toBe(1);
    expect(said(w, 'redevient positive')).toBe(1);
  });

  it('a dip after a real recovery is a new episode', () => {
    const w = legacyWorld();
    const { company } = mount(w);
    closeAt(w, 40, -5);
    check(company);
    for (let day = 41; day <= 48; day++) { closeAt(w, day, 50); check(company); }
    closeAt(w, 49, -2);
    check(company);
    expect(events(w)).toHaveLength(2);
  });

  it('a run that ends below zero says so', async () => {
    const w = legacyWorld({ horizonDays: 3 });
    const { company } = mount(w);
    w.ledger.push({ id: 'led_x', day: 1, type: 'platform_fee', amount: -1e6, memo: 'test', ref: null });
    await company.runDays(4);
    expect(w.status).toBe('finished');
    expect(said(w, "Faillite : la simulation s'arrête après 3 jours")).toBe(1);
    expect(said(w, 'Fin de la simulation')).toBe(0);
  });
});

describe('the digest and the money it names (T1, T2)', () => {
  it('names what channel tests really cost, and nothing when none ran', () => {
    const w = legacyWorld();
    const p = liveProduct(w, 'prd_a', 'sommeil-bebe');
    const test = campaign(w, 'cmp_t', p.id, { test: true, channel: 'meta' });
    const plain = campaign(w, 'cmp_p', p.id);
    w.day = 12;
    w.tick = 0;
    w.ledger.push({ id: 'led_close', day: 11, type: 'platform_fee', amount: -1, memo: 'Jour clos', ref: 'fixed:11' });
    const row = (c: Campaign, day: number, spend: number) => w.market.adStats.push({ day, campaignId: c.id, creativeId: 'x', productId: p.id, spend, impressions: 100, clicks: 1, ctr: 0.01, cpc: 1, cpm: 1, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [] });
    expect(buildDigest(w, 1, 11).next.join(' ')).not.toContain('Tests de canaux');
    row(plain, 10, 100);
    expect(buildDigest(w, 1, 11).next.join(' ')).not.toContain('Tests de canaux');
    row(test, 10, 25);
    row(test, 2, 900); // out of the week
    expect(buildDigest(w, 1, 11).next.join(' ')).toMatch(/Tests de canaux : 25 € dépensés sur 7 jours/);
  });
});

describe('what the views read (T8, T9)', () => {
  it('output keeps the whole 30 days once compaction took the rows', () => {
    const w = leanWorld();
    const a = w.company.agents[1]!;
    w.day = 40;
    w.tick = 0;
    w.ledger.push({ id: 'led_close', day: 39, type: 'platform_fee', amount: -1, memo: 'Jour clos', ref: 'fixed:39' });
    const task = (id: string, day: number) => ({ id, kind: 'daily_report', title: id, dept: a.dept, assignee: a.id, reviewer: null, status: 'done', priority: 2, input: {}, output: {}, dependsOn: [], createdBy: 'system', dayCreated: day, dayDone: day, workLeft: 0, attempts: 0, reviews: [], log: [], missionId: null }) as unknown as WorldState['company']['tasks'][number];
    w.company.tasks.push(task('tsk_old', 5), task('tsk_mid', 15), task('tsk_new', 35));
    const output = (): number => orgDetail(w).depts.flatMap((d) => d.heads).find((h) => h.agentId === a.id)!.output30d;
    expect(output()).toBe(2); // day 5 sits out of the window
    compactWorld(w);
    expect(w.company.tasks.some((t) => t.id === 'tsk_mid')).toBe(false);
    expect(output()).toBe(2);
    expect(Object.keys(w.company.taskTotals!.agents![a.id]!.days!)).toContain('15');
  });

  it('whoever has no rating is told why, and only a post no result reads is called hors ligue', () => {
    const w = leanWorld();
    mount(w);
    const view = leagueDetail(w, false);
    const why = (roleId: string): string | undefined => view.outside.find((o) => o.agentId === w.company.agents.find((a) => a.roleId === roleId)?.id)?.why;
    expect(view.outside).toHaveLength(w.company.agents.length);
    expect(why('ceo')).toMatch(/^Hors ligue/);
    expect(why('ghostwriter') ?? why('head_of_content') ?? 'Pas encore noté').toMatch(/^Pas encore noté/);
    expect(view.outside.filter((o) => o.why.includes('ne sépare pas')).length).toBeGreaterThan(0);
    expect(view.season.cut).toMatch(/Sous la barre de 1 500 : après 2 clôtures de suite, un plan d'amélioration de 14 jours, puis, si le plan échoue, le poste passe au marché\./);
  });

  it('a family whose test sees no talent reads its own cut, and the rules give both counts of sits', () => {
    const w = leanWorld();
    mount(w);
    const { season } = leagueDetail(w, false);
    expect(season.cutBlind).toMatch(/un plan d'amélioration de 14 jours\. Ce métier n'a pas de test fiable : le poste est conservé\./);
    expect(season.cutBlind).not.toContain('marché');
    expect(season.rules.join(' ')).toContain('24 fois (3 fois quand Claude écrit)');
  });

  it('someone rated on two skills stands once on a podium', () => {
    const w = leanWorld();
    mount(w);
    const [a, b, c] = w.company.agents.slice(1, 4) as [AgentState, AgentState, AgentState];
    const row = (agent: AgentState, rating: number) => ({ agentId: agent.id, name: agent.name, role: agent.role, rating, status: 'active' });
    const report = { season: 1, toDay: 14, employee: { agentId: a.id, name: a.name }, probations: [], hires: [], tables: { page: [row(a, 1560), row(b, 1500)], polish: [row(a, 1550), row(c, 1490)] } };
    w.company.league!.seasons = [report as never];
    const [hall] = leagueDetail(w, false).hallOfFame;
    expect([hall!.champion.id, hall!.second?.id, hall!.third?.id]).toEqual([a.id, b.id, c.id]);
  });
});
