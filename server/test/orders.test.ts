/** What the founder says is what happens: orders, refusals, approval limits, the Red Team's last word, chat. Each test comes from a defect found on real runs. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentState, Allocation, Campaign, Lesson, PdfContent, Product, SalesPage, Task, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { BrainVault, ContentEngine, MindContext, RunPaths } from '../src/contracts.js';
import { heuristicHumanize } from '../src/minds/heuristic/editing.js';
import { seededRng } from '../src/minds/util.js';
import { companyPaidBlock, productPaidBlock } from '../src/runtime/acquisition.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { activeHolds, adsHold, launchHold, productHold, REFUSAL_COOLDOWN_DAYS } from '../src/runtime/holds.js';
import { asksForProduct, daysIn, loweringIn, orderAction, ordersIn, requestBeside } from '../src/runtime/missions.js';
import { endTimedStops } from '../src/runtime/orders.js';
import { guideGaps, MAX_REWORK_CYCLES, settleRedTeam } from '../src/runtime/redteam.js';
import { closeLoop, reviewTask } from '../src/runtime/review.js';
import { situationFor } from '../src/runtime/situation.js';
import { buildHeuristicPlan, reactToOutage } from '../src/runtime/strategy.js';
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
    // …even a launch the founder asked for before their order…
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
    // A launch the founder asked for earlier does not pass it: this is the block a founder request used to override.
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

  it('no new guide starts under their order, what is in production goes on, and their next request lifts it', withCompany({}, async ({ world, company, ctx }) => {
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

describe('« baisse le budget de pub »', () => {
  /** What a founder really types, slips and missing accents included. */
  const LOWERING = [
    'Baisse le budget de pub', 'baisse le budget pub', 'baisse le budjet pub', 'baise le budget de pub', 'bisse le bugdet pub', 'baisser le budget pub', 'on baisse le buget pub',
    'reduis le budget publicitaire', 'Réduis les dépenses de pub', 'reduit le budget ads', 'réduction du budget pub', 'diminue le budget des pubs', 'dimunue le budget pub', 'Divise le budget pub par deux',
    'coupe le budget pub de moitié', 'on dépense trop en pub', 'depense moins en pub', 'on depence trop en pub', 'moins de pub', 'fais moins de pubs', 'trop de pub', 'lève le pied sur la pub', 'calme le jeu sur les pubs',
    'Enlève 10 € au budget pub', 'Retire 20 % du budget pub', 'Coupe 20 % du budget pub', 'Coupe 20 % sur TikTok', 'Baisse de 20 % sur TikTok', 'Redescends le budget pub', 'Descends le budget pub', 'Ramène le budget pub à 20 €', 'Divise par trois le budget pub',
    'Mets la pédale douce sur les pubs', 'Va doucement sur les pubs', 'Serre le budget pub', 'Resserre le budget pub', 'Rogne sur la pub', 'Économise sur la pub', 'Fais des économies sur les pubs', 'Arrête de dépenser autant', 'Ne dépense pas autant',
    'Peux-tu baisser le budget pub ?', 'Pourrais-tu réduire le budget pub ?', 'Pouvez-vous baisser le budget pub ?', 'Pourriez-vous baisser le budget pub ?', 'Vous pourriez baisser le budget pub ?',
    'mets moins d\'argent dans la pub', 'le budget pub est trop élevé', 'baisse la pub', 'tu peux baisser le budget pub ?', 'il faudrait baisser le budget pub', 'je veux que tu baisses le budget pub', 'plafonne la pub à 20 € par jour', 'ne dépense pas trop en pub', 'réduis Meta',
  ];

  it('reads a lowering however the founder types it', () => {
    expect(LOWERING.length).toBeGreaterThanOrEqual(12);
    for (const text of LOWERING) expect(orderAction(text), text).toBe('lower_budget');
  });

  it('what only looks like it is no lowering', () => {
    for (const text of ['Baisse le prix du guide', 'Baisse le prix du guide sur le sommeil à 14 €', 'le CA baisse et la pub coûte cher', 'laisse le budget pub', 'laisse la pub tranquille', 'faut-il baisser le budget pub ?', "j'ai baissé le budget pub", 'on a dépensé trop en pub', 'redis-moi le budget pub', 'fais plus de pubs', 'Lance une nouvelle pub TikTok', 'Fais un guide pour dépenser moins', 'Lance un guide pour réduire ses dépenses', 'on a trop de pubs refusées', 'Baisse le prix du guide budget']) {
      expect(orderAction(text), text).toBe(null);
    }
    expect(orderAction('double le budget pub')).toBe('raise_budget');
    expect(orderAction('coupe le budget pub')).toBe('stop_ads');
    expect(orderAction('coupe la pub, on dépense trop')).toBe('stop_spending');
    expect(orderAction('baisse le budget des pubs non rentables')).toBe('trim_ads');
    expect(orderAction('ne baisse pas le budget pub')).toBe('negated');
    expect(orderAction('ne baise pas le budjet pub')).toBe('negated');
  });

  it('another budget, or where and not how much, moves nothing', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    for (const text of ['Limite les pubs à TikTok', 'Limite les dépenses en outils', 'Réduis le budget recrutement', 'Dépense autant que tu veux sur TikTok', 'Dépense autant qu\'hier']) {
      expect(orderAction(text), text).toBe(null);
      await company.giveMission(text);
      expect(c.dailyBudget, text).toBe(20);
      expect(activeHolds(world), text).toEqual([]);
    }
  }));

  it('a lowering refused stops nothing, whatever the verb', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    for (const text of ['Ne descends pas le budget pub', 'Ne redescends pas la pub', 'Ne ramène pas le budget pub à 20 €', 'Ne resserre pas le budget pub', 'Ne rogne pas sur la pub', "N'économise pas sur la pub", 'Évite de descendre le budget pub', 'Il ne faut pas descendre le budget pub', 'Il ne faut pas ramener le budget pub à 20 €']) {
      expect(orderAction(text) ?? 'negated', text).toBe('negated');
      const id = await company.giveMission(text);
      expect(c, text).toMatchObject({ status: 'active', dailyBudget: 20 });
      expect(activeHolds(world), text).toEqual([]);
      expect(tasksOf(world, id), text).toEqual([]);
    }
  }));

  it('how much is read in the clause that lowers, a comment beside it is no amount', () => {
    expect(loweringIn('Baisse le budget pub, le panier moyen est à 12 euros')).toEqual({});
    expect(loweringIn('Baisse le budget à 12,50 € par jour')).toEqual({ amount: 12.5 });
    expect(loweringIn('Coupe 20 % du budget pub')).toEqual({ share: 0.8 });
    expect(loweringIn('Retire 20 % du budget pub')).toEqual({ share: 0.8 });
    expect(loweringIn('Baisse de 20 % sur TikTok')).toEqual({ share: 0.8 });
    expect(loweringIn('Enlève 10 € au budget pub')).toEqual({ less: 10 });
    expect(loweringIn('Divise par trois le budget pub').share).toBeCloseTo(1 / 3);
    expect(loweringIn('Divise par 4 le budget pub').share).toBe(0.25);
  });

  it('a stop on one channel leaves the other running, and the lowering said beside it comes back to the founder', async () => {
    for (const text of ['Coupe les pubs sur Meta et baisse le budget sur TikTok', 'Baisse le budget sur TikTok et coupe Meta']) {
      const s = await setup();
      try {
        const { world, company } = s;
        world.day = 20;
        const p = addProduct(world, 'prd_a', 'sommeil-bebe');
        const tiktok = addCampaign(world, 'cmp_t', p.id, 20);
        const meta = addCampaign(world, 'cmp_m', p.id, 40, { channel: 'meta' });
        const id = await company.giveMission(text);
        expect(meta.status, text).toBe('paused');
        expect(tiktok, text).toMatchObject({ status: 'active', dailyBudget: 20 });
        expect(adsHold(world, null, 'tiktok'), text).toBeNull();
        expect(adsHold(world, null, 'meta'), text).not.toBeNull();
        expect(missionOf(world, id).outcome, text).toMatch(/Pas fait : « .*baisse le budget sur TikTok/i);
      } finally { rmSync(s.root, { recursive: true, force: true }); }
    }
  });

  it('work asked in so many words stays work, whatever it is about', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    const hooks = await company.giveMission('Écris des hooks pour réduire les dépenses');
    expect(tasksOf(world, hooks).map((t) => t.kind)).toEqual(['write_ad_hooks']);
    const launch = await company.giveMission('Lance une campagne avec un budget pub de 20 €');
    expect(tasksOf(world, launch).map((t) => t.kind)).toContain('launch_campaign');
    // Each on its own morning: the tasks above would answer for them.
    for (const text of ['Écris 5 accroches sur comment diminuer ses dépenses', 'Fais une pub pour le guide sur la réduction des dépenses', 'Produis une pub sur le thème réduire ses dépenses']) {
      const s = await setup();
      try {
        s.world.day = 20;
        addCampaign(s.world, 'cmp_a', addProduct(s.world, 'prd_a', 'sommeil-bebe').id, 20);
        const id = await s.company.giveMission(text);
        expect(missionOf(s.world, id).outcome ?? '', text).not.toMatch(/Je n'ai rien changé/);
        expect(tasksOf(s.world, id).map((t) => t.kind), text).toContain('write_ad_hooks');
      } finally { rmSync(s.root, { recursive: true, force: true }); }
    }
  }));

  it('every phrasing lowers what runs, launches nothing and says what it leaves alone', async () => {
    for (const text of LOWERING.filter((t) => !/Meta/.test(t))) {
      const s = await setup();
      try {
        const { world, company } = s;
        world.day = 20;
        const p = addProduct(world, 'prd_a', 'sommeil-bebe');
        const running = addCampaign(world, 'cmp_a', p.id, 40);
        const id = await company.giveMission(text);
        expect(missionOf(world, id).status, text).toBe('done');
        expect(tasksOf(world, id), text).toEqual([]);
        expect(running.status, text).toBe('active');
        expect(running.dailyBudget, text).toBeLessThan(40);
        expect(adsHold(world), text).not.toBeNull();
        expect(world.company.tasks.filter((t) => PAID.includes(t.kind)), text).toEqual([]);
        expect(missionOf(world, id).outcome, text).toMatch(/Je ne touche pas à l'enveloppe du CFO/);
      } finally { rmSync(s.root, { recursive: true, force: true }); }
    }
  });

  it('what is on its way stops, the plan starts nothing, and a kept campaign runs under the hold', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20, { startDay: 15 });
    adDays(world, c.id, p.id, [17, 18, 19], 20, 2.4);
    const launch = createTask(world, { kind: 'launch_campaign', input: { productId: p.id, nicheId: p.nicheId }, createdBy: 'founder' });
    const id = await company.giveMission('Baisse le budget de pub');
    expect(c.dailyBudget).toBe(14);
    expect(launch.status).toBe('cancelled');
    expect(missionOf(world, id).outcome).toMatch(/1 campagne\(s\) baissée\(s\), de 20 € à 14 €\/jour.*jusqu'au jour 26 inclus, 1 tâche\(s\) de pub annulée\(s\)/);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(c.status).toBe('active');
    const ask = await company.giveMission('Fais une pub pour le guide sur le sommeil');
    expect(missionOf(world, ask).status).toBe('failed');
    expect(missionOf(world, ask).outcome).toMatch(/nouvelles pubs gelées, budget baissé sur ordre du fondateur \(jour 20\).*reprends les pubs/);
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.items.filter((i) => PAID.includes(i.kind))).toEqual([]);
  }));

  it('the stop-loss still reads a kept campaign', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20, { startDay: 15 });
    adDays(world, c.id, p.id, [16, 17, 18, 19], 20, 0);
    await company.giveMission('Baisse le budget de pub');
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(c.status).toBe('paused');
  }));

  it('ends on its day: new ads can start, and the campaigns kept under it are the company\'s again', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20);
    const forced = addCampaign(world, 'cmp_f', p.id, 20, { founderForced: true });
    await company.giveMission('Baisse le budget de pub pendant 3 jours');
    expect(activeHolds(world).find((h) => h.kind === 'ads')).toMatchObject({ until: 22, kept: ['cmp_a'], resumes: [] });
    expect(c.founderForced).toBe(true);
    world.day = 23;
    endTimedStops(ctx);
    expect(adsHold(world)).toBeNull();
    expect(c.founderForced).toBeUndefined();
    expect(c.status).toBe('active');
    expect(forced.founderForced).toBe(true);
  }));

  it('on an outage day a lowering lowers: what is off for the day stays off for the day, and comes back at what they said', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20, { status: 'paused', pausedFor: 'outage' });
    const id = await company.giveMission('Baisse le budget de pub pendant 2 jours');
    expect(missionOf(world, id).outcome).toMatch(/1 campagne\(s\) baissée\(s\), de 20 € à 14 €\/jour/);
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'outage', dailyBudget: 14 });
    world.day = 21;
    expect(reactToOutage(ctx)).toBe(false);
    expect(c).toMatchObject({ status: 'active', dailyBudget: 14 });
  }));

  it('on an outage day the week\'s ceiling counts what is off for the day', withCompany({ scaling: true }, async ({ world, company }) => {
    world.day = 31;
    const allocation = { week: 5, day: 29, adTarget: 120, testWeek: 0, scaleRoas: 1.8, trimRoas: 1.3, reserve: 0, note: '' } as Allocation;
    world.company.growth!.allocation = allocation;
    addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20, { status: 'paused', pausedFor: 'outage' });
    const id = await company.giveMission('Baisse le budget de pub');
    expect(allocation.adTarget).toBe(14);
    expect(missionOf(world, id).outcome).toMatch(/Plafond de la semaine ramené à 14 €\/jour/);
  }));

  it('an outage inside the hold gives back what the hold kept, at the budget they said', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20);
    await company.giveMission('Baisse le budget de pub');
    world.day = 21;
    world.market.events.push({ id: 'evt_x', day: 20, kind: 'platform_outage', title: 'Panne', description: '', severity: 'danger', refs: { day: 21 } });
    expect(reactToOutage(ctx)).toBe(true);
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'outage' });
    world.day = 22;
    expect(reactToOutage(ctx)).toBe(false);
    expect(c).toMatchObject({ status: 'active', dailyBudget: 14 });
    expect(c.pausedFor).toBeUndefined();
  }));

  it('a stop inside a lowering: once the last order over a campaign ends, nothing keeps it forced', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20);
    await company.giveMission('Baisse le budget de pub');
    await company.giveMission('Coupe les pubs');
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'founder', founderForced: true });
    world.day = 27;
    endTimedStops(ctx); // the lowering is over, the stop still stands
    expect(c.founderForced).toBe(true);
    await company.giveMission('Reprends les pubs');
    expect(c.status).toBe('active');
    expect(c.founderForced).toBeUndefined();
  }));

  it('a stop with a length inside a lowering: the campaign comes back with the last order, and free', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20);
    await company.giveMission('Baisse le budget de pub');
    await company.giveMission('Coupe les pubs pendant 2 jours');
    world.day = 22;
    endTimedStops(ctx);
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    world.day = 27;
    endTimedStops(ctx);
    expect(c.status).toBe('active');
    expect(c.founderForced).toBeUndefined();
  }));

  it('two stops with a length: the one that ends last gives back what the first paused', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    await company.giveMission('Coupe les pubs pendant 2 jours');
    await company.giveMission('Coupe TikTok pendant 5 jours');
    world.day = 22;
    endTimedStops(ctx);
    expect(c.status).toBe('paused');
    world.day = 25;
    endTimedStops(ctx);
    expect(c.status).toBe('active');
  }));

  it('a campaign stopped by its number stays stopped when the lowering ends', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    await company.giveMission('Baisse le budget de pub');
    await company.giveMission('Coupe la campagne 1');
    world.day = 27;
    endTimedStops(ctx);
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(c.founderForced).toBeUndefined();
  }));

  it('once the stop-loss took all it kept, the hold ends and says so: a lowering is no stop, and the week\'s ceiling stays', withCompany({ scaling: true }, async ({ world, company, ctx }) => {
    world.day = 31;
    const allocation = { week: 5, day: 29, adTarget: 120, testWeek: 0, scaleRoas: 1.8, trimRoas: 1.3, reserve: 0, note: '' } as Allocation;
    world.company.growth!.allocation = allocation;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20, { startDay: 25 });
    adDays(world, c.id, p.id, [27, 28, 29, 30], 20, 0);
    await company.giveMission('Baisse le budget de pub');
    expect(adsHold(world)).not.toBeNull();
    world.day = 32;
    endTimedStops(ctx);
    expect(adsHold(world)).not.toBeNull(); // it still runs: the hold stands
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(c.status).toBe('paused');
    world.day = 33;
    endTimedStops(ctx);
    expect(adsHold(world)).toBeNull();
    expect(world.activity.at(-1)!.text).toContain('plus aucune des campagnes gardées le jour 31 ne tourne : le gel des nouvelles pubs s\'arrête ce matin');
    expect(c.founderForced).toBeUndefined();
    expect(allocation.adTarget).toBe(14);
  }));

  it('what it says of a guide keeps its title whole: no word cut, no quote left open', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe', { title: 'Les couples fiancés : en finir avec « on ne se parle plus » avant le mariage' });
    addCampaign(world, 'cmp_a', p.id, 20);
    const id = await company.giveMission('Baisse le budget du guide sur le sommeil de bébé');
    for (const line of [missionOf(world, id).outcome!, adsHold(world, p.id)!.reason]) {
      expect(line.split('«').length, line).toBe(line.split('»').length);
      expect(line, line).toContain('« Les couples fiancés : en finir avec « on ne se… » »');
    }
  }));

  it('with nothing on the air nothing freezes: a stop nobody ordered is no answer', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const launch = createTask(world, { kind: 'launch_campaign', input: { productId: p.id, nicheId: p.nicheId }, createdBy: 'founder' });
    const id = await company.giveMission('Baisse le budget de pub');
    expect(missionOf(world, id).outcome).toBe('Rien à baisser : aucune campagne ne tourne.');
    expect(activeHolds(world)).toEqual([]);
    expect(launch.status).not.toBe('cancelled');
  }));

  it('a second lowering carries what the first one kept', withCompany({}, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 40);
    await company.giveMission('Baisse le budget de pub pendant 2 jours');
    await company.giveMission('Baisse encore le budget de pub pendant 5 jours');
    expect(c.dailyBudget).toBe(19.6);
    world.day = 22;
    endTimedStops(ctx);
    expect(c.founderForced).toBe(true);
    world.day = 25;
    endTimedStops(ctx);
    expect(c.founderForced).toBeUndefined();
  }));

  it('« reprends les pubs » lifts it early, and frees what it kept', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20);
    await company.giveMission('Baisse le budget de pub');
    const back = await company.giveMission('reprends les pubs');
    expect(missionOf(world, back).status).toBe('done');
    expect(adsHold(world)).toBeNull();
    expect(c).toMatchObject({ status: 'active', dailyBudget: 14 });
    expect(c.founderForced).toBeUndefined();
  }));

  it('stays on what the founder named: a channel, a guide, one campaign', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const chiot = addProduct(world, 'prd_c', 'proprete-chiot');
    const bebe = addProduct(world, 'prd_b', 'sommeil-bebe');
    const tiktok = addCampaign(world, 'cmp_t', chiot.id, 20);
    const meta = addCampaign(world, 'cmp_m', bebe.id, 40, { channel: 'meta' });
    const sur = await company.giveMission('Baisse le budget de pub sur TikTok');
    expect(missionOf(world, sur).outcome).toMatch(/C'est fait sur TikTok/);
    expect([tiktok.dailyBudget, meta.dailyBudget]).toEqual([14, 40]);
    expect(adsHold(world, null, 'tiktok')).not.toBeNull();
    expect(adsHold(world, null, 'meta')).toBeNull();
    await company.giveMission('reprends les pubs');
    await company.giveMission('Baisse le budget du guide sur le sommeil');
    expect([tiktok.dailyBudget, meta.dailyBudget]).toEqual([14, 28]);
    expect(adsHold(world, bebe.id, 'meta')).not.toBeNull();
    expect(adsHold(world, chiot.id, 'tiktok')).toBeNull();
    await company.giveMission('reprends les pubs');
    await company.giveMission('Baisse le budget de la campagne 1');
    expect(tiktok.dailyBudget).toBe(9.8);
    expect(meta.dailyBudget).toBe(28);
    expect(activeHolds(world).filter((h) => h.kind === 'ads')).toEqual([]);
    const none = await company.giveMission('Baisse le budget de la campagne 9');
    expect(missionOf(world, none).status).toBe('failed');
    expect(missionOf(world, none).outcome).toMatch(/Je n’ai baissé aucun budget : aucune campagne ne porte le n° 9/);
    const nobody = await company.giveMission('Baisse le budget du guide sur le TOEIC');
    expect(missionOf(world, nobody).outcome).toMatch(/Je n’ai baissé aucun budget : je ne trouve aucun guide sur « TOEIC »/);
  }));

  it('goes as far as they say, and never under what the platform takes', async () => {
    const lowered = (over: number, text: string) => withCompany({}, async ({ world, company }) => {
      world.day = 20;
      const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 40);
      const id = await company.giveMission(text);
      expect(c.dailyBudget, text).toBe(over);
      if (text.includes('2 €')) expect(missionOf(world, id).outcome).toMatch(/Plus bas que 2 €\/jour, les minimums des canaux refusent/);
    });
    for (const [over, text] of [[20, 'Baisse le budget pub de moitié'], [32, 'Baisse le budget pub de 20 %'], [10, 'Baisse le budget pub à 10 € par jour'], [25, 'Baisse le budget pub de 15 €'], [5, 'Baisse le budget pub à 2 € par jour'], [40, 'Baisse le budget pub à 60 € par jour']] as const) await lowered(over, text)();
  });

  it('in approval mode, what goes back up asks them first', withCompany({ founderApproval: true }, async ({ world, company, ctx }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe', { stats: { views: 0, sales: 10, revenue: 190, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 } });
    const c = addCampaign(world, 'cmp_a', p.id, 20, { founderCap: 20, startDay: 15 });
    adDays(world, c.id, p.id, [17, 18, 19], 14, 2.4);
    const id = await company.giveMission('Baisse le budget de pub');
    expect(c).toMatchObject({ dailyBudget: 14, founderCap: 14 });
    expect(missionOf(world, id).outcome).toMatch(/une hausse passera par toi/);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(c.dailyBudget).toBe(14);
  }));

  it('with the CFO\'s week written, a winner stays down until their next Monday, and the week says so', withCompany({ scaling: true }, async ({ world, company, ctx }) => {
    world.day = 31;
    const allocation = { week: 5, day: 29, adTarget: 120, testWeek: 0, scaleRoas: 1.8, trimRoas: 1.3, reserve: 0, note: 'La pub peut monter jusqu’à 120 €/jour cette semaine.' } as Allocation;
    world.company.growth!.allocation = allocation;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = addCampaign(world, 'cmp_a', p.id, 20, { startDay: 15 });
    adDays(world, c.id, p.id, [28, 29, 30], 20, 3);
    const id = await company.giveMission('Baisse le budget de pub');
    expect(missionOf(world, id).outcome).toMatch(/Plafond de la semaine ramené à 14 €\/jour, tous canaux confondus : rien ne monte avant la revue du CFO du jour 36/);
    expect(allocation.adTarget).toBe(14);
    expect(allocation.note).toMatch(/sur ordre du fondateur \(jour 31\)/);
    await HANDLERS.optimize_ads.run(ctx, createTask(world, { kind: 'optimize_ads', input: {} }), agent(world, 'adam'), mind(agent(world, 'adam')));
    expect(c).toMatchObject({ status: 'active', dailyBudget: 14 });
    // One campaign is no week: the ceiling stays where the CFO left it.
    allocation.adTarget = 120;
    await company.giveMission('reprends les pubs');
    await company.giveMission('Baisse le budget de la campagne 1');
    expect(allocation.adTarget).toBe(120);
    expect(c.dailyBudget).toBe(9.8);
  }));

  it('a question gets the numbers, moves nothing and orders no ad', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    for (const text of ['faut-il baisser le budget pub ?', "j'ai baissé le budget pub", 'le budget pub baisse', 'Budget pub à 20 € par jour', 'Passe le budget pub à 20 € par jour', 'Mets le budget pub à 20 €', 'Fixe le budget pub à 20 €', 'Quel est le budget pub ?']) {
      const id = await company.giveMission(text);
      expect(missionOf(world, id).status, text).toBe('done');
      expect(missionOf(world, id).outcome, text).toMatch(/Je n'ai rien changé : l'enveloppe pub du jour est de .*, 20 € engagés sur 1 campagne\(s\)/);
      expect(tasksOf(world, id), text).toEqual([]);
    }
    expect(c.dailyBudget).toBe(20);
    expect(activeHolds(world)).toEqual([]);
    // A guide about money is a request for a guide: the numbers of the ads answer nothing there.
    const guide = await company.giveMission('Lance un guide pour réduire ses dépenses');
    expect(missionOf(world, guide).outcome ?? '').not.toMatch(/l'enveloppe pub du jour/);
    expect(c.dailyBudget).toBe(20);
  }));

  it('nothing lowered, no ceiling: a channel with nothing on it leaves the week as the CFO wrote it', withCompany({ scaling: true }, async ({ world, company }) => {
    world.day = 31;
    const allocation = { week: 5, day: 29, adTarget: 120, testWeek: 0, scaleRoas: 1.8, trimRoas: 1.3, reserve: 0, note: '' } as Allocation;
    world.company.growth!.allocation = allocation;
    addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    const id = await company.giveMission('Baisse le budget de pub sur Meta');
    expect(missionOf(world, id).outcome).toMatch(/Rien à baisser sur Facebook & Instagram : aucune campagne ne tourne/);
    expect(allocation.adTarget).toBe(120);
    expect(adsHold(world, null, 'meta')).toBeNull();
  }));
});

describe('a sentence that asks for two things', () => {
  it('the sentence of the defect: the budget goes down and the guide starts on its own niche', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    const id = await company.giveMission('Baisse le budget de pub sur TikTok et prépare un nouveau guide sur le jardinage en balcon');
    expect(missionOf(world, id)).toMatchObject({ status: 'open', wantsProduct: true, nicheId: 'potager-balcon' });
    expect(c.dailyBudget).toBe(14);
    expect(adsHold(world, null, 'tiktok')).not.toBeNull();
    expect(tasksOf(world, id).map((t) => t.kind)).toContain('pick_opportunity');
    expect(tasksOf(world, id).filter((t) => PAID.includes(t.kind))).toEqual([]);
    expect(missionOf(world, id).outcome).toMatch(/C'est fait sur TikTok/);
  }));

  it('a subject nobody covers fails alone: the order stands, and both are said', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const c = addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    const id = await company.giveMission('Baisse le budget pub, fais un guide sur la fête des voisins');
    expect(c.dailyBudget).toBe(14);
    expect(missionOf(world, id).outcome).toMatch(/C'est fait : 1 campagne/);
    expect(missionOf(world, id).outcome).toMatch(/Je ne lance rien sur « fête voisins »/);
  }));

  it('two requests, one of them a guide: the first goes, the other is said back', withCompany({}, async ({ world, company }) => {
    const first = await company.giveMission('Prépare un guide sur le TOEIC et écris des hooks TikTok');
    expect(missionOf(world, first)).toMatchObject({ status: 'open', nicheId: 'toeic-800' });
    expect(tasksOf(world, first).filter((t) => PAID.includes(t.kind))).toEqual([]);
    expect(missionOf(world, first).outcome).toMatch(/Pas fait : « écris des hooks TikTok »/);
    const second = await company.giveMission('Réponds aux clients et lance un guide sur le chiot');
    expect(tasksOf(world, second).map((t) => t.kind)).toEqual(['reply_inbox']);
    expect(missionOf(world, second).outcome).toMatch(/Pas fait : « lance un guide sur le chiot »/);
    // A word that adds nothing is no second request, and requests that go together stay together.
    expect(requestBeside('Lance un guide sur le chiot et publie-le')).toBe('Lance un guide sur le chiot');
    const whole = await company.giveMission('Lance un guide sur le mariage et publie-le');
    expect(missionOf(world, whole).outcome ?? '').not.toMatch(/Pas fait/);
    addProduct(world, 'prd_a', 'sommeil-bebe');
    const both = await company.giveMission('Écris des hooks TikTok et produis une pub');
    expect(tasksOf(world, both).map((t) => t.kind)).toContain('write_ad_hooks');
    expect(missionOf(world, both).outcome ?? '').not.toMatch(/Pas fait/);
  }));

  it('a second money order is said back, not lost', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    const p = addProduct(world, 'prd_c', 'proprete-chiot');
    const c = addCampaign(world, 'cmp_c', p.id, 20);
    const id = await company.giveMission('Baisse le budget de pub et retire le guide sur le chiot');
    expect(c.dailyBudget).toBe(14);
    expect(p.status).toBe('live');
    expect(adsHold(world)).not.toBeNull(); // the guide of the other clause is not the target of this one
    expect(missionOf(world, id).outcome).toMatch(/Pas fait : « retire le guide sur le chiot »/);
    const price = await company.giveMission('Baisse le budget de pub et augmente le prix du guide');
    expect(tasksOf(world, price).map((t) => t.kind)).toEqual(['set_price']);
    // What an order already does is no second order.
    expect(ordersIn('coupe les pubs, ne dépense plus rien').map((o) => o.action)).toEqual(['stop_spending']);
  }));

  it('a vague clause beside an order is said back too', withCompany({}, async ({ world, company }) => {
    world.day = 20;
    addCampaign(world, 'cmp_a', addProduct(world, 'prd_a', 'sommeil-bebe').id, 20);
    const id = await company.giveMission('Baisse le budget de pub et regarde ça');
    expect(tasksOf(world, id)).toEqual([]);
    expect(missionOf(world, id).outcome).toMatch(/Pas fait : « regarde ça »/);
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

  it('a guide waiting for their word does not stop the next one, within reason', withCompany({ founderApproval: true }, async ({ world, ctx }) => {
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
    // The founder's yes moves the budget and becomes the new limit.
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

  it('their yes does not widen the CFO\'s envelope, and a question on a stopped campaign goes away', withCompany({ founderApproval: true }, async ({ world, ctx }) => {
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

  it('a launch runs at the amount they agreed to, even if the envelope grew since', withCompany({ founderApproval: true }, async ({ world, ctx }) => {
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

  it('a guide even the rebuild left as it was is held and the founder is told; their word ships it', withCompany({}, async ({ world, company, ctx }) => {
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
