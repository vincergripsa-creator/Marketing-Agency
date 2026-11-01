/** What the founder says is what happens: orders, refusals, approval limits, the Red Team's last word, chat. Each test comes from a defect found on real runs. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentState, Campaign, Lesson, PdfContent, Product, SalesPage, Task, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { BrainVault, ContentEngine, MindContext, RunPaths } from '../src/contracts.js';
import { heuristicHumanize } from '../src/minds/heuristic/editing.js';
import { seededRng } from '../src/minds/util.js';
import { companyPaidBlock, productPaidBlock } from '../src/runtime/acquisition.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { activeHolds, adsHold, launchHold, productHold, REFUSAL_COOLDOWN_DAYS } from '../src/runtime/holds.js';
import { asksForProduct, daysIn, orderAction } from '../src/runtime/missions.js';
import { endTimedStops } from '../src/runtime/orders.js';
import { guideGaps, MAX_REWORK_CYCLES, settleRedTeam } from '../src/runtime/redteam.js';
import { closeLoop, reviewTask } from '../src/runtime/review.js';
import { situationFor } from '../src/runtime/situation.js';
import { buildHeuristicPlan } from '../src/runtime/strategy.js';
import { createTask } from '../src/runtime/tasks.js';
import { currentBudget } from '../src/runtime/metrics.js';
import { killProduct } from '../src/runtime/pipeline.js';
import { findBannedClaims, findPageClaims } from '../src/sim/compliance.js';
import { scoreSalesPage } from '../src/sim/quality.js';
import { LESSON_KEYS } from '../src/learning/index.js';
import { LEGACY } from './legacy.js';

async function setup(scenario: Record<string, unknown> = {}, seed = 5) {
  const { createWorld, defaultScenario, Company } = await import('../src/runtime/index.js');
  const { sim } = await import('../src/runtime/modules.js');
  const { createRng } = await import('../src/core/index.js');
  const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
  const learning = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-orders-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const world = createWorld(defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic', horizonDays: 90, ...scenario }), 'test-orders');
  const engine = minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
  const brain = learning.createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine, brain });
  const rng = createRng(world.rngState);
  const ctx = { world, engine, brain, tools: sim.createMarketTools(world, rng), rng, channelRng: rng, ritual: async () => undefined, paths, incidents: [] as string[], lastMarketNotes: [] as string[] };
  return { world, company, ctx, root, sim, engine };
}

/** Runs a test on a fresh company, then deletes its files. */
function withCompany(scenario: Record<string, unknown>, run: (s: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  return async () => {
    const s = await setup(scenario);
    try { await run(s); } finally { rmSync(s.root, { recursive: true, force: true }); }
  };
}

function addProduct(world: WorldState, id: string, nicheId: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    id, nicheId, title: `Guide ${id}`, subtitle: '', audience: 'Parents', problem: 'Un problème précis', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [], ...over,
  };
  world.company.products.push(p);
  return p;
}

function addCampaign(world: WorldState, id: string, productId: string, dailyBudget = 20, over: Partial<Campaign> = {}): Campaign {
  const c: Campaign = { id, productId, name: `Campagne ${id}`, creativeIds: [`cre_${id}`], dailyBudget, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 1, createdBy: 'adam', ...over };
  world.company.campaigns.push(c);
  return c;
}

function adDays(world: WorldState, campaignId: string, productId: string, days: number[], spend: number, roas: number) {
  for (const day of days) {
    world.market.adStats.push({ day, campaignId, creativeId: `cre_${campaignId}`, productId, spend, impressions: 5000, clicks: 100, ctr: 0.02, cpc: spend / 100, cpm: spend / 5, landingViews: 90, purchases: Math.round((spend * roas) / 19), revenue: spend * roas, roas, frequency: 1.4, comments: [] });
  }
}

const missionOf = (world: WorldState, id: string) => world.company.missions.find((m) => m.id === id)!;
const tasksOf = (world: WorldState, id: string) => world.company.tasks.filter((t) => t.missionId === id);
const agent = (world: WorldState, id: string) => world.company.agents.find((a) => a.id === id)!;
const mind = (a: AgentState): MindContext => ({ agent: a, playbook: [], brainNotes: [], lessons: [], day: 1 });
const PAID = ['write_ad_hooks', 'produce_ad', 'launch_campaign'];

describe('reading a request for a guide', () => {
  it('a guide asked in any words is a product request, verbless and conditional included', () => {
    for (const text of ['un guide sur la permaculture', 'guide TOEIC', 'il faudrait un guide sur le TOEIC', "j'aimerais un guide sur le TOEIC", "je veux qu'on fasse un guide sur le TOEIC", "ce serait bien d'avoir un guide sur le TOEIC", 'on pourrait faire un guide sur le TOEIC', 'fais-moi un truc sur le TOEIC', 'lance quelque chose sur le TOEIC', "sors-nous un guide sur l'urssaf", 'je veux vendre un guide sur la diversification alimentaire', 'on se lance sur le TOEIC', 'lance-toi sur la niche TOEIC']) {
      expect(asksForProduct(text), text).toBe(true);
    }
  });

  it('work on what exists is no product request', () => {
    for (const text of ['Baisse le prix du guide sur le sommeil à 14 €', 'Fais une pub pour le guide sur le TOEIC', 'réponds aux clients', 'le guide sur le chiot se vend bien ?', 'guide du chiot : refais la couverture', 'fais quelque chose pour les remboursements', 'Écris de nouveaux hooks TikTok pour notre guide']) {
      expect(asksForProduct(text), text).toBe(false);
    }
  });

  it('a subject nobody covers is refused the same way with or without a verb, never closed as a report', withCompany({}, async ({ world, company }) => {
    const id = await company.giveMission('un guide sur la permaculture');
    expect(missionOf(world, id)).toMatchObject({ status: 'failed' });
    expect(missionOf(world, id).outcome).toMatch(/Je ne lance rien sur « permaculture »/);
    expect(tasksOf(world, id)).toEqual([]);
  }));

  it('« lance quelque chose » on a niche we know starts that niche', withCompany({}, async ({ world, company }) => {
    const id = await company.giveMission('lance quelque chose sur les impôts des micro-entrepreneurs');
    expect(missionOf(world, id)).toMatchObject({ status: 'open', wantsProduct: true, nicheId: 'urssaf-micro' });
    expect(tasksOf(world, id).map((t) => t.kind)).toContain('pick_opportunity');
  }));

  it('a subject with nothing to do is an open question, not a report closed as done', withCompany({}, async ({ world, company }) => {
    const known = await company.giveMission('on parle du TOEIC');
    expect(missionOf(world, known).status).toBe('failed');
    expect(missionOf(world, known).outcome).toMatch(/TOEIC 800\+/);
    expect(tasksOf(world, known)).toEqual([]);
    const unknown = await company.giveMission('pense à la fête des voisins');
    expect(missionOf(world, unknown).status).toBe('failed');
    expect(tasksOf(world, unknown)).toEqual([]);
    // Without any subject, a plain status report stays the answer.
    const hello = await company.giveMission('bonjour');
    expect(tasksOf(world, hello).map((t) => t.kind)).toEqual(['daily_report']);
  }));

  it('« déjà en cours » is said of the task that really does the work, and the mission follows it', withCompany({}, async ({ world, company }) => {
    const first = await company.giveMission('coupe les pubs non rentables');
    const task = tasksOf(world, first)[0]!;
    expect(task.kind).toBe('optimize_ads');
    const second = await company.giveMission('coupe les pubs non rentables');
    const mission = missionOf(world, second);
    expect(mission.status).toBe('open');
    expect(mission.taskIds).toContain(task.id);
    expect(mission.outcome).toMatch(/Déjà en cours : « /);
  }));
});

describe('natural wording of a catalogued subject', () => {
  const cases: [string, string][] = [
    ['fais un guide pour faire dormir mon bébé', 'sommeil-bebe'], ['écris un guide pour aider les bébés à dormir', 'sommeil-bebe'], ['je veux un guide pour que mon bébé dorme', 'sommeil-bebe'],
    ['lance un guide pour endormir un nourrisson', 'sommeil-bebe'], ['fais un guide pour maigrir', 'ventre-apres-40'], ['fais un guide pour vendre sur Vinted', 'revendre-vinted'],
    ['fais un guide sur la rénovation de meubles', 'relooker-meuble'], ['on pourrait faire un guide sur le TOEIC', 'toeic-800'], ['lance un guide sur le TOEIC pour les parents', 'toeic-800'],
  ];
  it('the founder\'s words find the niche', withCompany({}, async ({ world, company }) => {
    for (const [text, nicheId] of cases) {
      const id = await company.giveMission(text);
      expect(missionOf(world, id), text).toMatchObject({ status: 'open', wantsProduct: true, nicheId });
      for (const t of tasksOf(world, id)) { t.status = 'cancelled'; t.dayDone = world.day; }
    }
  }));

  it('a near match is proposed by name, and nothing starts on it', withCompany({}, async ({ world, company }) => {
    const id = await company.giveMission('fais un guide sur le dressage du chiot');
    expect(missionOf(world, id).status).toBe('failed');
    expect(missionOf(world, id).outcome).toMatch(/Le plus proche que nous ayons : « Propreté du chiot en appartement »/);
    expect(tasksOf(world, id)).toEqual([]);
  }));

  it('« vendre » only means Vinted in a request about a subject', withCompany({}, async ({ world, company }) => {
    addProduct(world, 'prd_a', 'sommeil-bebe');
    const id = await company.giveMission('aide-nous à vendre plus de hooks');
    expect(missionOf(world, id).nicheId ?? null).toBe(null);
  }));
});

describe('founder orders', () => {
  it('reads orders before keywords', () => {
    const orders: [string, string][] = [
      ['coupe toutes les pubs', 'stop_ads'], ["mets toutes les pubs en pause jusqu'à nouvel ordre", 'stop_ads'], ['arrête la pub sur le guide du chiot', 'stop_ads'], ['ne lance plus de pub', 'stop_ads'], ['stop pub', 'stop_ads'],
      ['coupe les pubs non rentables', 'trim_ads'], ['coupe les pubs qui ne marchent pas', 'trim_ads'],
      ['ne dépense plus rien', 'stop_spending'], ['arrête de dépenser', 'stop_spending'],
      ['arrête de lancer de nouveaux guides', 'stop_launches'], ['ne lance plus de guide', 'stop_launches'], ['plus de nouveaux guides', 'stop_launches'],
      ['tue le guide sur le chiot', 'kill_product'], ['supprime le produit sur le chiot', 'kill_product'],
      ['arrête de vendre le guide sur le chiot', 'pause_product'], ['retire le guide sur le chiot de la boutique', 'pause_product'], ['mets le guide sur le chiot en pause', 'pause_product'],
      ['reprends les pubs', 'resume_ads'], ['remets le guide sur le chiot en ligne', 'resume_product'], ['double le budget pub', 'raise_budget'],
    ];
    for (const [text, action] of orders) expect(orderAction(text), text).toBe(action);
    for (const text of ['Lance une nouvelle pub TikTok', 'Baisse le prix du guide sur le sommeil à 14 €', 'fais plus de pubs', 'Écris de nouveaux hooks TikTok', 'coupe le prix du guide', 'réponds aux clients', 'Lance un guide sur le sommeil du bébé']) {
      expect(orderAction(text), text).toBe(null);
    }
  });

  it('« coupe toutes les pubs » pauses what runs, cancels what leads to a launch, and holds until lifted', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const running = addCampaign(world, 'cmp_a', p.id);
    const launch = createTask(world, { kind: 'launch_campaign', input: { productId: p.id, nicheId: p.nicheId }, createdBy: 'founder' });
    const id = await company.giveMission('coupe toutes les pubs');
    expect(missionOf(world, id).status).toBe('done');
    expect(missionOf(world, id).outcome).toMatch(/1 campagne\(s\) en pause/);
    expect(tasksOf(world, id)).toEqual([]);
    expect(running).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(launch.status).toBe('cancelled');
    expect(companyPaidBlock(world)).toMatch(/ordre du fondateur/);
    expect(productPaidBlock(world, p)).toMatchObject({ hard: true, final: true });
    // The plan respects it…
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.filter((i) => PAID.includes(i.kind))).toEqual([]);
    // …even a launch the founder himself asked for before his order…
    const old = createTask(world, { kind: 'launch_campaign', input: { productId: p.id }, createdBy: 'founder' });
    const out = await HANDLERS.launch_campaign.run(ctx, old, agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(out.output).toMatchObject({ skipped: true });
    old.status = 'cancelled';
    // …and a new request for ads is told how to lift it.
    const ask = await company.giveMission('Fais une pub pour le guide sur le sommeil');
    expect(missionOf(world, ask).status).toBe('failed');
    expect(missionOf(world, ask).outcome).toMatch(/reprends les pubs/);
    expect(tasksOf(world, ask)).toEqual([]);
    const back = await company.giveMission('reprends les pubs');
    expect(missionOf(world, back).status).toBe('done');
    expect(running.status).toBe('active');
    expect(running.pausedFor).toBeUndefined();
    expect(adsHold(world)).toBe(null);
  }));

  it('an order on one product leaves the others alone, and a product we cannot find stops nothing', withCompany({}, async ({ world, company, ctx }) => {
    const chiot = addProduct(world, 'prd_c', 'proprete-chiot');
    const bebe = addProduct(world, 'prd_b', 'sommeil-bebe');
    const a = addCampaign(world, 'cmp_c', chiot.id);
    const b = addCampaign(world, 'cmp_b', bebe.id);
    await company.giveMission('arrête la pub sur le guide du chiot');
    expect(a.status).toBe('paused');
    expect(b.status).toBe('active');
    expect(adsHold(world, chiot.id)).not.toBe(null);
    expect(adsHold(world, bebe.id)).toBe(null);
    expect(adsHold(world)).toBe(null);
    // A launch he asked for earlier does not pass it: this is the block a founder request used to override.
    const old = createTask(world, { kind: 'launch_campaign', input: { productId: chiot.id }, createdBy: 'founder' });
    const out = await HANDLERS.launch_campaign.run(ctx, old, agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(out.output).toMatchObject({ skipped: true, reason: 'founder' });
    const none = await company.giveMission('arrête la pub sur le guide du TOEIC');
    expect(missionOf(world, none).status).toBe('failed');
    expect(missionOf(world, none).outcome).toMatch(/Je n’ai coupé aucune pub : je ne trouve aucun guide sur « TOEIC »/);
    expect(b.status).toBe('active');
  }));

  it('words around an order name no product: the order still stands', withCompany({}, async ({ world, company }) => {
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    const c = addCampaign(world, 'cmp_c', p.id);
    await company.giveMission('coupe la pub, ça coûte trop cher');
    expect(c.status).toBe('paused');
    expect(adsHold(world)).not.toBe(null);
  }));

  it('a budget per day is no price; useless spending is not an order to stop everything', async () => {
    const { heuristicMission } = await import('../src/minds/heuristic/direction.js');
    const kinds = (text: string) => heuristicMission({ text, allowedKinds: ['set_price', 'write_ad_hooks', 'budget_review', 'daily_report'] }).map((i) => i.kind);
    expect(kinds('mets 20 € par jour sur la pub')).not.toContain('set_price');
    expect(kinds('mets le budget à 30 €')).not.toContain('set_price');
    expect(kinds('mets le guide à 29 €')).toContain('set_price');
    expect(orderAction('coupe les dépenses inutiles')).toBe(null);
  });

  it('a product taken off sale stays there: no rework, until the founder puts it back', withCompany({}, async ({ world, company, ctx }) => {
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    const c = addCampaign(world, 'cmp_c', p.id);
    const post = createTask(world, { kind: 'post_organic', input: { productId: p.id } });
    const id = await company.giveMission('retire le guide sur le chiot de la boutique');
    expect(missionOf(world, id).status).toBe('done');
    expect(p.status).toBe('paused');
    expect(c.status).toBe('paused');
    expect(post.status).toBe('cancelled');
    expect(productHold(world, p.id)).not.toBe(null);
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.filter((i) => i.input.productId === p.id)).toEqual([]);
    // Asking for the same subject is not answered with « déjà en cours ».
    const again = await company.giveMission('Lance un guide sur le chiot');
    expect(missionOf(world, again).status).toBe('failed');
    expect(missionOf(world, again).outcome).toMatch(/de côté/);
    const back = await company.giveMission('remets le guide sur le chiot en ligne');
    expect(productHold(world, p.id)).toBe(null);
    expect(tasksOf(world, back).map((t) => t.kind)).toEqual(['publish_product']);
    expect(tasksOf(world, back)[0]!.input).toMatchObject({ founderApproved: true, republish: true });
  }));

  it('a guide can be killed by name; a killed guide is not relaunched for an open mission', withCompany({}, async ({ world, company, ctx }) => {
    const mission = await company.giveMission('Lance un guide sur le TOEIC');
    const p = addProduct(world, 'prd_t', 'toeic-800', { status: 'writing', launchedDay: null });
    missionOf(world, mission).productId = p.id;
    const id = await company.giveMission('tue le guide sur le TOEIC');
    expect(p.status).toBe('killed');
    expect(missionOf(world, id).status).toBe('done');
    expect(missionOf(world, mission).status).toBe('failed');
    expect(situationFor(ctx, agent(world, 'camille'))).toMatch(/Décision produit : « Guide prd_t » \(.*\) arrêté le jour 1, décision du fondateur/);
  }));

  it('a stated price is set on the product named, without the word « prix »', withCompany({}, async ({ world, company }) => {
    const p = addProduct(world, 'prd_c', 'proprete-chiot', { price: 19 });
    addProduct(world, 'prd_b', 'sommeil-bebe');
    const id = await company.giveMission('mets le guide sur le chiot à 49 €');
    expect(tasksOf(world, id).find((t) => t.kind === 'set_price')!.input).toMatchObject({ productId: p.id, price: 49, reason: 'fondateur' });
  }));

  it('no new guide starts under his order, what is in production goes on, and his next request lifts it', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const wip = addProduct(world, 'prd_w', 'toeic-800', { status: 'writing', launchedDay: null });
    const write = createTask(world, { kind: 'write_pdf', input: { productId: wip.id } });
    const pick = createTask(world, { kind: 'pick_opportunity', input: {} });
    const id = await company.giveMission('arrête de lancer de nouveaux guides');
    expect(missionOf(world, id).status).toBe('done');
    expect(launchHold(world)).not.toBe(null);
    expect(pick.status).toBe('cancelled');
    expect(write.status).toBe('pending');
    wip.status = 'killed';
    write.status = 'cancelled';
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.filter((i) => i.kind === 'pick_opportunity' || i.input.chain === 'opportunity')).toEqual([]);
    // A pick already on its way when the order came ends there too.
    const late = createTask(world, { kind: 'pick_opportunity', input: {} });
    const out = await HANDLERS.pick_opportunity.run(ctx, late, agent(world, 'nadia'), mind(agent(world, 'nadia')));
    expect(out.output).toMatchObject({ skipped: true });
    late.status = 'cancelled';
    await company.giveMission('Lance un guide sur le potager sur le balcon');
    expect(launchHold(world)).toBe(null);
  }));

  it('« ne dépense plus rien » stops ads and advances, and says what it cannot stop', withCompany({}, async ({ world, company }) => {
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    addCampaign(world, 'cmp_c', p.id);
    const id = await company.giveMission('ne dépense plus rien');
    expect(adsHold(world)).not.toBe(null);
    expect(activeHolds(world).map((h) => h.kind).sort()).toEqual(['ads', 'advances']);
    expect(missionOf(world, id).outcome).toMatch(/frais fixes/);
  }));

  it('an order it cannot carry out is refused out loud, with the numbers, and creates nothing', withCompany({}, async ({ world, company }) => {
    const id = await company.giveMission('double le budget pub');
    expect(missionOf(world, id).status).toBe('failed');
    expect(missionOf(world, id).outcome).toMatch(/plafonnée par le CFO/);
    expect(tasksOf(world, id)).toEqual([]);
  }));

  it('cutting what loses money stays media buying: no hold, no hook chain', withCompany({}, async ({ world, company }) => {
    const id = await company.giveMission('coupe les pubs non rentables');
    expect(tasksOf(world, id).map((t) => t.kind)).toEqual(['optimize_ads']);
    expect(activeHolds(world)).toEqual([]);
  }));
});

describe('« vire X » and « pendant 3 jours »', () => {
  it('reads a firing however the founder wishes it, and fires nobody on a doubt', () => {
    for (const text of ['Je veux que tu vires Clara', 'il faut que tu vires Clara', "il faut qu'on vire Clara", "j'aimerais que tu vires Clara", 'vire Clara', 'je veux virer Clara']) expect(orderAction(text), text).toBe('fire_agent');
    for (const text of ['je ne veux pas que tu vires Clara', 'faut-il que tu vires Clara ?', 'si tu vires Clara, on perd le support', 'tu as viré Clara']) expect(orderAction(text), text).not.toBe('fire_agent');
  });

  it('« Je veux que tu vires Zoé » gets the same answer as « vire Zoé »: the fixed team says it cannot', withCompany({}, async ({ world, company }) => {
    world.day = 15;
    const id = await company.giveMission('Je veux que tu vires Zoé');
    expect(missionOf(world, id).status).toBe('failed');
    expect(missionOf(world, id).outcome).toMatch(/équipe de cette partie est fixe, Zoé reste/);
  }));

  it('reads how long a stop lasts', () => {
    expect(daysIn('coupe toutes les pubs pendant 3 jours')).toBe(3);
    expect(daysIn('Coupe les pubs pendant une semaine')).toBe(7);
    expect(daysIn('arrête les pubs pour deux semaines')).toBe(14);
    expect(daysIn('coupe toutes les pubs')).toBeUndefined();
    expect(daysIn('un guide pour les 3 jours de vacances')).toBeUndefined();
    expect(daysIn('coupe les pubs pendant 0 jour')).toBeUndefined();
  });

  it('« coupe toutes les pubs pendant 3 jours » stops them for 3 days, then what it paused starts again by itself', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const running = addCampaign(world, 'cmp_a', p.id);
    const stoppedForGood = addCampaign(world, 'cmp_b', p.id, 20, { status: 'paused', pausedFor: 'founder' });
    const id = await company.giveMission('Coupe toutes les pubs pendant 3 jours');
    expect(missionOf(world, id).status).toBe('done');
    expect(missionOf(world, id).outcome).toMatch(/avant le jour 18 : ce matin-là, elles repartent seules/);
    expect(running).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(activeHolds(world).find((h) => h.kind === 'ads')).toMatchObject({ until: 17, resumes: ['cmp_a'] });
    world.day = 17;
    endTimedStops(ctx);
    expect(companyPaidBlock(world)).toMatch(/ordre du fondateur/);
    expect(running.status).toBe('paused');
    world.day = 18;
    expect(adsHold(world, p.id)).toBeNull();
    endTimedStops(ctx);
    expect(running.status).toBe('active');
    expect(running.pausedFor).toBeUndefined();
    expect(stoppedForGood).toMatchObject({ status: 'paused', pausedFor: 'founder' });
  }));

  it('an order that still stands, or a stop lifted early, holds its campaigns', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const running = addCampaign(world, 'cmp_a', p.id);
    await company.giveMission('Coupe toutes les pubs pendant 3 jours');
    await company.giveMission('Coupe toutes les pubs');
    world.day = 18;
    endTimedStops(ctx);
    expect(running.status).toBe('paused');
  }));

  it('other stops hold for their days, and a guide off sale says it will not come back alone', withCompany({}, async ({ world, company }) => {
    world.day = 15;
    const launches = await company.giveMission('Arrête de lancer de nouveaux guides pendant 2 jours');
    expect(missionOf(world, launches).outcome).toMatch(/jusqu'au jour 16 inclus/);
    expect(launchHold(world)).not.toBeNull();
    world.day = 17;
    expect(launchHold(world)).toBeNull();
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const off = await company.giveMission('Retire le guide sur le sommeil de la boutique pendant 3 jours');
    expect(missionOf(world, off).outcome).toMatch(/Je ne sais pas le remettre seul dans 3 jour\(s\)/);
    expect(p.status).toBe('paused');
  }));
});

describe('founder refusals', () => {
  function awaiting(world: WorldState, kind: Task['kind'], p: Product, ask: string): Task {
    const t = createTask(world, { kind, input: { productId: p.id, nicheId: p.nicheId, founderAsk: ask }, assignee: 'clara' });
    t.status = 'awaiting_founder';
    world.company.pendingApprovals.push(t.id);
    return t;
  }

  it('a refused publish shelves the guide: the watchdog leaves it, the mission ends, the company moves on', withCompany({ founderApproval: true }, async ({ world, company, ctx }) => {
    world.day = 8;
    const mission = await company.giveMission('Lance un guide sur le TOEIC');
    for (const t of tasksOf(world, mission)) { t.status = 'done'; t.dayDone = 8; }
    const p = addProduct(world, 'prd_t', 'toeic-800', { status: 'ready', launchedDay: null });
    missionOf(world, mission).productId = p.id;
    const publish = awaiting(world, 'publish_product', p, 'Mettre en ligne');
    company.approve(publish.id, false);
    expect(p.status).toBe('paused');
    expect(productHold(world, p.id)).not.toBe(null);
    expect(missionOf(world, mission).status).toBe('failed');
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.filter((i) => i.input.productId === p.id)).toEqual([]);
    expect(plan.items.some((i) => i.kind === 'pick_opportunity' || i.kind === 'scan_trends')).toBe(true);
    expect(plan.focus).not.toMatch(/la chaîne de production tourne/);
  }));

  it('a refused launch stops that product\'s ads for the cooldown, then it may ask again', withCompany({ founderApproval: true }, async ({ world, company, ctx }) => {
    world.day = 10;
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    const other = addProduct(world, 'prd_b', 'sommeil-bebe');
    const hooks = createTask(world, { kind: 'write_ad_hooks', input: { productId: p.id } });
    const launch = awaiting(world, 'launch_campaign', p, 'Lancer une campagne');
    company.approve(launch.id, false);
    expect(hooks.status).toBe('cancelled');
    expect(productPaidBlock(world, p)).toMatchObject({ final: true });
    expect(productPaidBlock(world, other)).toBe(null);
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.filter((i) => PAID.includes(i.kind) && i.input.productId === p.id)).toEqual([]);
    expect(plan.items.some((i) => PAID.includes(i.kind) && i.input.productId === other.id)).toBe(true);
    world.day += REFUSAL_COOLDOWN_DAYS;
    expect(productPaidBlock(world, p)).not.toBe(null);
    world.day += 1;
    expect(productPaidBlock(world, p)).toBe(null);
  }));

  it('days the founder kept a guide off the ads are not « no traction »', withCompany({}, async ({ world, ctx }) => {
    const { addHold } = await import('../src/runtime/holds.js');
    world.day = 20;
    const posted = (p: Product) => { for (let i = 0; i < 6; i++) world.market.organicPosts.push({ id: `post_${p.id}_${i}`, productId: p.id, hook: 'h', hookStyle: 'question', format: 'carousel', day: 12 + i, views: 10, clicks: 0 } as never); };
    const refused = addProduct(world, 'prd_r', 'proprete-chiot');
    const plain = addProduct(world, 'prd_p', 'sommeil-bebe');
    posted(refused);
    posted(plain);
    addHold(world, { kind: 'ads', productId: refused.id, until: 15, reason: 'refus du fondateur' });
    await buildHeuristicPlan(ctx);
    expect(refused.status).toBe('live');
    expect(plain.status).toBe('killed');
  }));

  it('a guide waiting for his word does not stop the next one, within reason', withCompany({ founderApproval: true }, async ({ world, ctx }) => {
    world.day = 8;
    const first = addProduct(world, 'prd_a', 'toeic-800', { status: 'ready', launchedDay: null });
    awaiting(world, 'publish_product', first, 'Mettre en ligne');
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.some((i) => i.kind === 'pick_opportunity' || i.kind === 'scan_trends')).toBe(true);
    expect(plan.focus).toMatch(/attend la décision du fondateur/);
    const second = addProduct(world, 'prd_b', 'proprete-chiot', { status: 'ready', launchedDay: null });
    awaiting(world, 'publish_product', second, 'Mettre en ligne');
    const held = await buildHeuristicPlan(ctx);
    expect(held.items.some((i) => i.kind === 'pick_opportunity' || (i.kind === 'scan_trends' && i.input.chain === 'opportunity'))).toBe(false);
  }));
});

describe('budget raises in approval mode', () => {
  const adam = (world: WorldState) => agent(world, 'adam');

  it('a campaign stays at the approved amount, a raise asks first and states the new amount', withCompany({ founderApproval: true }, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_c', 'proprete-chiot', { stats: { views: 0, sales: 10, revenue: 190, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 } });
    const c = addCampaign(world, 'cmp_c', p.id, 18, { founderCap: 18, startDay: 15 });
    adDays(world, c.id, p.id, [17, 18, 19], 18, 2.4);
    const daily = createTask(world, { kind: 'optimize_ads', input: {} });
    await HANDLERS.optimize_ads.run(ctx, daily, adam(world), mind(adam(world)));
    expect(c.dailyBudget).toBe(18);
    const ask = world.company.tasks.find((t) => t.input.campaignId === c.id)!;
    expect(ask.input.raiseTo).toBe(23.4);
    const asked = await HANDLERS.optimize_ads.run(ctx, ask, adam(world), mind(adam(world)));
    expect(asked.awaitFounder).toMatch(/de 18 € à 23,40 €\/jour/);
    // Only one question at a time.
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), adam(world), mind(adam(world)));
    expect(world.company.tasks.filter((t) => t.input.campaignId === c.id).length).toBe(1);
    // His yes moves the budget and becomes the new limit.
    ask.status = 'awaiting_founder';
    company.approve(ask.id, true);
    await HANDLERS.optimize_ads.run(ctx, ask, adam(world), mind(adam(world)));
    expect(c).toMatchObject({ dailyBudget: 23.4, founderCap: 23.4 });
  }));

  it('reductions stay free, a raise back up to the approved amount too, and a refusal is not asked again for a week', withCompany({ founderApproval: true }, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    const c = addCampaign(world, 'cmp_c', p.id, 10, { founderCap: 18, startDay: 15 });
    adDays(world, c.id, p.id, [17, 18, 19], 14, 2.4);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), adam(world), mind(adam(world)));
    expect(c.dailyBudget).toBe(13);
    expect(world.company.pendingApprovals).toEqual([]);
    c.dailyBudget = 18;
    world.market.adStats.length = 0;
    adDays(world, c.id, p.id, [17, 18, 19], 18, 2.4);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), adam(world), mind(adam(world)));
    const ask = world.company.tasks.find((t) => t.input.campaignId === c.id)!;
    ask.status = 'awaiting_founder';
    company.approve(ask.id, false);
    expect(c.raiseRefusedDay).toBe(20);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), adam(world), mind(adam(world)));
    expect(world.company.tasks.filter((t) => t.input.campaignId === c.id).length).toBe(1);
    world.day += REFUSAL_COOLDOWN_DAYS + 1;
    adDays(world, c.id, p.id, [world.day - 2, world.day - 1], 18, 2.4);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), adam(world), mind(adam(world)));
    expect(world.company.tasks.filter((t) => t.input.campaignId === c.id).length).toBe(2);
  }));

  it('his yes does not widen the CFO\'s envelope, and a question on a stopped campaign goes away', withCompany({ founderApproval: true }, async ({ world, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    const c = addCampaign(world, 'cmp_c', p.id, 18, { founderCap: 18 });
    const big = createTask(world, { kind: 'optimize_ads', input: { campaignId: c.id, productId: p.id, raiseTo: 900, founderApproved: true } });
    await HANDLERS.optimize_ads.run(ctx, big, adam(world), mind(adam(world)));
    expect(c.dailyBudget).toBeLessThan(900);
    expect(c.dailyBudget).toBeLessThanOrEqual(currentBudget(world).adCap);
    const ask = createTask(world, { kind: 'optimize_ads', input: { campaignId: c.id, productId: p.id, raiseTo: 40 } });
    ask.status = 'awaiting_founder';
    world.company.pendingApprovals.push(ask.id);
    c.status = 'paused';
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), adam(world), mind(adam(world)));
    expect(ask.status).toBe('cancelled');
    expect(world.company.pendingApprovals).toEqual([]);
  }));

  it('a launch runs at the amount he agreed to, even if the envelope grew since', withCompany({ founderApproval: true }, async ({ world, ctx }) => {
    world.day = 10;
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    world.company.creatives.push({ id: 'cre_1', productId: p.id, hook: 'h', hookStyle: 'question', format: 'carousel', scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 5 }, createdDay: 5, createdBy: 'leo' });
    const t = createTask(world, { kind: 'launch_campaign', input: { productId: p.id, nicheId: p.nicheId, askedBudget: 6, founderApproved: true } });
    const out = await HANDLERS.launch_campaign.run(ctx, t, adam(world), mind(adam(world)));
    expect(out.output?.dailyBudget).toBe(6);
    expect(world.company.campaigns.at(-1)).toMatchObject({ dailyBudget: 6, founderCap: 6 });
  }));
});

describe('the founder\'s deadline', () => {
  const close = (company: unknown) => (company as { checkStatus(): void }).checkStatus();

  it('a goal reached after its deadline keeps the status flow but says so', withCompany({ goal: { targetProfit: -1, byDay: 20 } }, async ({ world, company }) => {
    world.status = 'running';
    world.day = 31;
    close(company);
    expect(world.status).toBe('goal_reached');
    const ev = world.market.events.find((e) => e.kind === 'goal_reached')!;
    expect(ev.title).toBe("Objectif atteint après l'échéance");
    expect(ev.description).toContain('au jour 31');
    expect(ev.description).toContain('avant le jour 20');
    expect(world.activity.at(-1)!.text).toContain("après l'échéance du jour 20");
  }));

  it('on the deadline itself, the goal is simply reached', withCompany({ goal: { targetProfit: -1, byDay: 20 } }, async ({ world, company }) => {
    world.status = 'running';
    world.day = 20;
    close(company);
    expect(world.market.events.find((e) => e.kind === 'goal_reached')!.title).toBe('Objectif atteint !');
  }));
});

describe('the Red Team\'s last word', () => {
  function review(world: WorldState, p: Product, cycle: number, unchanged: boolean): Task {
    const t = createTask(world, { kind: 'red_team', input: { productId: p.id, subject: 'pdf', version: p.version, cycle } });
    t.status = 'done';
    t.output = { subject: 'pdf', verdict: 'fix', finalVerdict: 'fix', reasons: ['Le fichier n’a pas changé', '2 douleurs absentes'], fixes: ['Traiter ces douleurs'], unchanged, fingerprint: 'abc', onLive: false };
    return t;
  }

  it('an unchanged file at the last cycle is rebuilt from its plan, not waived', withCompany({}, async ({ world, ctx }) => {
    const p = addProduct(world, 'prd_u', 'urssaf-micro', { status: 'qa', launchedDay: null });
    const t = review(world, p, MAX_REWORK_CYCLES, true);
    await settleRedTeam(ctx, t, p);
    expect(t.output?.waiver).toBeUndefined();
    expect(world.company.tasks.filter((x) => x.kind === 'write_outline' && x.status === 'pending').length).toBe(1);
    const next = world.company.tasks.filter((x) => x.kind === 'red_team').at(-1)!;
    expect(next.input.cycle).toBe(MAX_REWORK_CYCLES + 1);
  }));

  it('a guide even the rebuild left as it was is held and the founder is told; his word ships it', withCompany({}, async ({ world, company, ctx }) => {
    const p = addProduct(world, 'prd_u', 'urssaf-micro', { status: 'qa', launchedDay: null });
    const t = review(world, p, MAX_REWORK_CYCLES + 1, true);
    await settleRedTeam(ctx, t, p);
    expect(t.output?.waiver).toBeUndefined();
    expect(p.status).toBe('paused');
    expect(productHold(world, p.id)).not.toBe(null);
    expect(world.activity.some((a) => a.kind === 'founder' && /je ne signe pas de dérogation/.test(a.text))).toBe(true);
    await company.giveMission('remets le guide sur les impôts en ligne');
    expect(t.output?.waiver).toMatchObject({ by: 'founder' });
  }));

  it('a file that did change still ends on a waiver at the last cycle', withCompany({}, async ({ world, ctx }) => {
    const p = addProduct(world, 'prd_u', 'urssaf-micro', { status: 'qa', launchedDay: null });
    const t = review(world, p, MAX_REWORK_CYCLES, false);
    await settleRedTeam(ctx, t, p);
    expect(t.output?.waiver).toMatchObject({ by: 'camille' });
  }));

  it('the targeted pass answers a pain and fills an example from the follow-up research when the guide\'s own has none left', async () => {
    const pain = 'Le versement libératoire, je ne sais pas si je dois le prendre';
    const voc: VoiceOfCustomer = {
      nicheId: 'urssaf-micro', depth: 'deep', pains: [pain], phrases: [], objections: [], desiredOutcomes: [], priceAnchors: [], bannedClaims: [],
      knowledge: {
        tips: ['[impots] Si vous hésitez sur le versement libératoire : comparez les deux scénarios avant la date limite.'], steps: [], mistakes: [],
        examples: ['[impots] Nora, 36 ans, photographe, compare avant le 30 septembre l’impôt classique et le versement libératoire sur une année type.', '[impots] Yanis, 29 ans, développeur, garde une feuille par année pour voir ce que chaque option lui aurait coûté.'], facts: [],
      },
    };
    const chapter = (title: string, example: string | null) => ({ title, intro: 'Une introduction précise.', paragraphs: ['Déclarez chaque trimestre sur le site officiel.'], steps: [], example, checklist: [], visual: null });
    const content = { title: 'Déclarer', subtitle: '', audience: 'Micro-entrepreneurs', promise: 'Déclarer sans erreur', introduction: ['Une ouverture.'], chapters: [chapter('La procédure', null), chapter('Le rituel', 'Trop court.')], bonus: chapter('Bonus', null), nextStep: { title: 'La suite', text: '', upsellProductId: null }, wordCount: 10 } as unknown as PdfContent;
    const gaps = guideGaps(content, voc);
    expect(gaps.pains).toEqual([pain]);
    expect(gaps.chapters).toEqual(['La procédure', 'Le rituel']);
    const out = heuristicHumanize(content, [], voc, seededRng(3), gaps);
    expect(JSON.stringify(out)).not.toBe(JSON.stringify(content));
    expect(guideGaps(out, voc).pains).toEqual([]);
    expect(guideGaps(out, voc).chapters).toEqual([]);
    expect(out.chapters.map((c) => c.example ?? '').join(' ')).toMatch(/Nora, 36 ans/);
  });
});

describe('forbidden claims on a sales page', () => {
  const page = (over: Partial<SalesPage> = {}): SalesPage => ({
    headline: 'Un plan clair pour le ventre après 40 ans', subheadline: 'Une étape à la fois', painBullets: ['Je ne sais plus quoi manger'], solution: 'Chaque repère vient de la recherche, sans chiffre inventé ni promesse miracle.',
    chapterBlurbs: [{ title: 'Le bilan', blurb: 'On part de votre semaine.' }], bonusBlurb: 'Une fiche à imprimer', objections: [{ q: 'Ça doit encore être une arnaque minceur', a: 'Vous avez 14 jours pour demander un remboursement.' }], guarantee: 'Satisfait ou remboursé', cta: 'Je télécharge', hypeLevel: 0.3, ...over,
  });

  it('what a page quotes or denies is not what it claims', () => {
    expect(findPageClaims(['Vos questions : « Ça doit encore être une arnaque minceur »'], ['minceur'])).toEqual([]);
    expect(findPageClaims(['« Ça doit être une arnaque à la « liberté financière » »'], ['liberté financière'])).toEqual([]);
    expect(findPageClaims(['sans chiffre inventé ni promesse miracle'])).toEqual([]);
    expect(findPageClaims(['La méthode miracle pour perdre du poids'])).toEqual(['miracle']);
    expect(findPageClaims(['Une méthode sans effort'])).toEqual(['sans effort']);
    expect(findPageClaims(['Résultat garanti, sans promesse miracle'])).toEqual(['garanti']);
    // TikTok's review stays literal.
    expect(findBannedClaims(['sans chiffre inventé ni promesse miracle'])).toEqual(['miracle']);
  });

  it('a customer objection or a denial blocks nothing on the page score', () => {
    const product = addProduct({ company: { products: [] } } as unknown as WorldState, 'prd_v', 'ventre-apres-40');
    const voc = { bannedClaims: ['minceur'], pains: [], phrases: [], objections: [] } as unknown as VoiceOfCustomer;
    const q = scoreSalesPage(page(), product, voc);
    expect(q.compliance).toBe(100);
    expect(q.blocking?.some((b) => b.dimension === 'compliance') ?? false).toBe(false);
  });

  it('a genuine claim cannot ship on a waiver: it ends the product, or takes a live one off sale', withCompany({}, async ({ world, ctx }) => {
    const claim = page({ headline: 'Ventre plat garanti', solution: 'Une méthode claire.' });
    const building = addProduct(world, 'prd_v', 'ventre-apres-40', { status: 'qa', launchedDay: null, salesPage: claim });
    const task = createTask(world, { kind: 'write_sales_page', input: { productId: building.id }, assignee: 'paul' });
    const res = await reviewTask(ctx, task, agent(world, 'clara'));
    expect(res).toMatchObject({ verdict: 'changes', noWaiver: true });
    await closeLoop(ctx, task, res);
    expect(building.status).toBe('killed');
    const live = addProduct(world, 'prd_l', 'japon-petit-budget', { salesPage: claim });
    const again = createTask(world, { kind: 'write_sales_page', input: { productId: live.id }, assignee: 'paul' });
    await closeLoop(ctx, again, await reviewTask(ctx, again, agent(world, 'clara')));
    expect(live.status).toBe('paused');
    expect(again.output?.waiver).toBeUndefined();
  }));
});

describe('lessons confirmed on the current version', () => {
  const lesson = (key: string, over: Partial<Lesson> = {}): Lesson => ({ id: 'les_1', key, day: 5, topic: 'pricing', insight: 'Réécrire la page de vente', evidence: 'seulement 0,4 %', confidence: 0.8, source: 'nora', appliesTo: [], notePath: 'lecons/x.md', ...over });

  it('a page lesson the retro confirmed after the last page counts from that day, and is cited with it', withCompany({}, async ({ world, ctx }) => {
    world.day = 25;
    const p = addProduct(world, 'prd_c', 'proprete-chiot', { launchedDay: 10 });
    world.company.lessons.push(lesson(LESSON_KEYS.page(p.id)));
    const stale = await buildHeuristicPlan(ctx);
    expect(stale.items.filter((i) => i.kind === 'write_sales_page')).toEqual([]);
    world.company.lessons[0]!.changedDay = 20;
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.find((i) => i.kind === 'write_sales_page')?.why).toMatch(/Leçon du jour 20/);
  }));
});

describe('what the chat answers', () => {
  const ask = async (world: WorldState, engine: ContentEngine, text: string, situation: string) => engine.chat({ history: [], text, situation }, { ...mind(agent(world, 'camille')), brand: 'Pixel Agency' });
  const situation = [
    'Hier : 7 ventes, 153 € de CA, 51,04 € de pub, ROAS 2,53, résultat 82,54 €.',
    'Semaine : sur les 7 derniers jours, 27 ventes, 633 € de CA, 321,38 € de pub, résultat 257,76 €.',
    'Tendance : CA de 633 € sur 7 jours contre 912 € les 7 jours d\'avant, 27 ventes contre 41, pub 321 € contre 300 €.',
    'Décision produit : « Le stress avant le bac » (Gérer le stress des examens) arrêté le jour 23, tuée par la Red Team avant production.',
    'Fiche produit : « Le chiot fait ses besoins » (Propreté du chiot) en ligne, 23 ventes, note 3,0/5 sur 5 avis, prix 14 €.',
    "Cause d'hier : pub non rentable, 6,12 € dépensés pour 0 € de CA, ROAS 0,00.",
  ].join('\n');

  it('a question about a product gets that product\'s line, not yesterday\'s ads', withCompany({}, async ({ world, engine }) => {
    expect(await ask(world, engine, 'pourquoi tu as arrêté le guide sur le stress du bac ?', situation)).toMatch(/arrêté le jour 23/);
    expect(await ask(world, engine, 'pourquoi le guide sur le chiot a une mauvaise note ?', situation)).toMatch(/note 3,0\/5/);
  }));

  it('a product nobody knows gets a plain « nothing », never another line', withCompany({}, async ({ world, engine }) => {
    const reply = await ask(world, engine, 'pourquoi le guide bébé a une mauvaise note ?', situation);
    expect(reply).toMatch(/je n’ai rien sur « bebe »/i);
    expect(reply).not.toMatch(/non rentable/);
    expect(await ask(world, engine, 'pourquoi on a arrêté le chat ?', situation)).toMatch(/je n’ai rien sur « chat »/i);
  }));

  it('the week and a fall get their own numbers; a plain why still gets the cause', withCompany({}, async ({ world, engine }) => {
    expect(await ask(world, engine, 'combien on a gagné cette semaine ?', situation)).toMatch(/257,76 €/);
    expect(await ask(world, engine, 'pourquoi le CA baisse ?', situation)).toMatch(/633 € sur 7 jours contre 912 €/);
    expect(await ask(world, engine, "pourquoi on a perdu de l'argent hier ?", situation)).toMatch(/non rentable/);
  }));

  it('the situation carries the reason and the day of a stop, and the week\'s total', withCompany({}, async ({ world, ctx }) => {
    world.day = 12;
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    await killProduct(ctx, p, '1 vente(s), ROAS 0,20 pour 80 € de pub', 'camille');
    const base = { sales: 2, revenue: 40, adSpend: 10, profit: 20, day: 3 } as never as WorldState['company']['kpis'][number];
    world.company.kpis.push({ ...base, day: 3 }, { ...base, day: 11, revenue: 30 });
    const text = situationFor(ctx, agent(world, 'camille'));
    expect(text).toMatch(/Décision produit : .* arrêté le jour 12, 1 vente\(s\)/);
    expect(text).toMatch(/Semaine : sur les 7 derniers jours, 2 ventes, 30 € de CA/);
    expect(text).toMatch(/Tendance : CA de 30 € sur 7 jours contre 40 €/);
  }));
});
