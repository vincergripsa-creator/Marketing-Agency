/**
 * What the market reads of a cut (video §3.5, §3.6). Craft reaches CTR through `scoreCreative` and `adQ`, with no term of
 * its own, so the league sees it. Tempo is the one market fact: hidden per niche, it draws nothing and shifts no stream.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdCreative, AdScene, Campaign, CutMetrics, DailyAdStats, NicheTruth, PdfContent, Product, ScenarioConfig, VideoBeat, VideoCut, VideoTempo, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { MindContext, Rng } from '../src/contracts.js';
import { toSnapshot } from '../src/api/snapshot.js';
import { createRng, streamRng } from '../src/core/index.js';
import { planCut, TEMPOS } from '../src/deliverables/videoCut.js';
import { applyDailyRewards } from '../src/learning/retro.js';
import { createContentEngine } from '../src/minds/index.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { createMarketState, createMarketTools, scoreCreative, scoreCut, tickMarket } from '../src/sim/index.js';
import { nicheTempo, tempoFit, VIDEO_MARKET } from '../src/sim/videoCraft.js';
import { LEGACY } from './legacy.js';

const steady = (): Rng => ({ normal: () => 0 }) as unknown as Rng;

function metrics(over: Partial<CutMetrics> = {}): CutMetrics {
  return { estSec: 22, hookWordSec: 0, productSec: 0.45, avgShotSec: 1.5, kinds: 5, captionWords: 2, endHoldSec: 2, ...over };
}

function beat(over: Partial<VideoBeat> = {}): VideoBeat {
  return { kind: 'hook', scene: 0, spoken: 'Une ligne', screen: 'Une ligne', estSec: 4, shots: 3, ...over };
}

function cut(over: Partial<CutMetrics> = {}, beats: VideoBeat[] = [beat({ kind: 'page_proof', proof: { chapter: 0, needle: 'Une phrase du guide' } })]): VideoCut {
  return { v: 1, tempo: 'standard', beats, metrics: metrics(over), sfx: true, craft: 0 };
}

const slides = (screen = 'Une ligne de texte'): VideoBeat[] => [beat({ kind: 'slide', spoken: '', screen }), beat({ kind: 'slide', spoken: '', screen }), beat({ kind: 'end_card', spoken: '', screen })];

describe('scoreCut', () => {
  it('a perfect cut is worth 100, with its pace and its look at 1', () => {
    const s = scoreCut(cut());
    expect(s.pace).toBeCloseTo(1, 9);
    expect(s.look).toBeCloseTo(1, 9);
    expect(s.craft).toBe(100);
    expect(s.notes).toEqual([]);
  });

  it.each([
    [0.1, 1], [0.25, 0.85], [0.3, 0.85], [0.6, 0.5], [0.8, 0.15],
  ])('hook at %d s reads %d', (hookWordSec, hookP) => {
    expect(scoreCut(cut({ hookWordSec })).pace).toBeCloseTo(0.4 * hookP + 0.6, 9);
  });

  it.each([
    [0.5, 0.6], [0.8, 0.6], [1, 0.8], [1.2, 1], [1.8, 1], [2, 0.9], [2.2, 0.8], [2.9, 0.5], [3.6, 0.2], [5, 0.2],
  ])('shots of %d s read %d, linear between', (avgShotSec, shotP) => {
    expect(scoreCut(cut({ avgShotSec })).pace).toBeCloseTo(0.65 + 0.35 * shotP, 9);
  });

  it.each([
    [8, 0.8], [12, 0.8], [13.5, 0.9], [15, 1], [28, 1], [31, 0.75], [34, 0.5], [45, 0.1], [60, 0.1],
  ])('%d s read %d', (estSec, durP) => {
    expect(scoreCut(cut({ estSec, productSec: 0 })).pace).toBeCloseTo(0.75 + 0.25 * durP, 9);
  });

  it('looks at where the guide comes in, and whether a real page shows', () => {
    const plate = [beat({ kind: 'fact_card' })];
    expect(scoreCut(cut({ estSec: 20, productSec: 4 })).look).toBeCloseTo(1, 9);
    expect(scoreCut(cut({ estSec: 20, productSec: 4.1 })).look).toBeCloseTo(0.85, 9);
    expect(scoreCut(cut({ productSec: 0.45 }, plate)).look).toBeCloseTo(0.85, 9);
    expect(scoreCut(cut({ productSec: 15 }, plate)).look).toBeCloseTo(0.7, 9);
    expect(scoreCut(cut({ productSec: null })).look).toBeCloseTo(0.85, 9);
  });

  it.each([[5, 1], [6, 1], [4, 0.8], [3, 0.5], [2, 0.2]])('%d kinds read %d', (kinds, varP) => {
    expect(scoreCut(cut({ kinds })).look).toBeCloseTo(0.75 + 0.25 * varP, 9);
  });

  it.each([[2, 1], [3, 1], [4, 0.7], [6, 0.3]])('%d words a caption read %d', (captionWords, capP) => {
    expect(scoreCut(cut({ captionWords })).look).toBeCloseTo(0.8 + 0.2 * capP, 9);
  });

  it.each([[2, 1], [1.8, 1], [1.5, 0.85], [1.2, 0.7], [0.8, 0.3], [0.6, 0.3]])('a hold of %d s reads %d', (endHoldSec, endP) => {
    expect(scoreCut(cut({ endHoldSec })).look).toBeCloseTo(0.85 + 0.15 * endP, 9);
  });

  it('a text too long for its box costs its share of the beats', () => {
    const long = 'Une phrase beaucoup trop longue pour tenir sur trois lignes à la taille minimale de la zone sûre du format vertical, même bien coupée';
    const half = cut({}, [beat({ kind: 'page_proof', proof: { chapter: 0, needle: 'Une phrase du guide' } }), beat({ screen: long })]);
    expect(scoreCut(half).look).toBeCloseTo(0.95, 9);
  });

  it('an empty screen is nothing to fit', () => {
    expect(scoreCut(cut({}, [beat({ kind: 'page_proof', proof: { chapter: 0, needle: 'Une phrase du guide' } }), beat({ kind: 'title_card', screen: '' })])).look).toBeCloseTo(1, 9);
  });

  it('craft is half pace, half look, rounded', () => {
    const s = scoreCut(cut({ hookWordSec: 0.8, avgShotSec: 3.6, estSec: 45, productSec: 40, kinds: 3, captionWords: 6, endHoldSec: 0.8 }, [beat({ kind: 'fact_card' })]));
    expect(s.pace).toBeCloseTo(0.4 * 0.15 + 0.35 * 0.2 + 0.25 * 0.1, 9);
    expect(s.look).toBeCloseTo(0.25 * 0.5 + 0.2 * 0.3 + 0.15 * 0.3 + 0.1, 9);
    expect(s.craft).toBe(Math.round(50 * s.pace + 50 * s.look));
  });

  it('a slideshow reads words per slide, its first slide as the hook', () => {
    const under = cut({ estSec: 20, kinds: 2, captionWords: 12, hookWordSec: 0 }, slides());
    expect(scoreCut(under).look).toBeCloseTo(0.3 * 0.5 + 0.25 * 0.2 + 0.2 + 0.15 + 0.1, 9);
    const over = cut({ estSec: 20, kinds: 2, captionWords: 20, hookWordSec: 0 }, slides());
    expect(scoreCut(over).look).toBeLessThan(scoreCut(under).look);
    expect(scoreCut(cut({ estSec: 20, kinds: 2, captionWords: 12, hookWordSec: 0.8 }, slides())).pace).toBeLessThan(scoreCut(under).pace);
  });

  it('a carousel reads its cards, not a clock', () => {
    const cards = (n: number): VideoBeat[] => Array.from({ length: n }, () => beat({ kind: 'slide', spoken: '', shots: 1 }));
    const pace = (n: number) => scoreCut(cut({ estSec: 90, kinds: 2, avgShotSec: 0, captionWords: 9 }, cards(n))).pace;
    expect(pace(4)).toBeCloseTo(1, 9);
    expect(pace(8)).toBeCloseTo(1, 9);
    expect(pace(3)).toBeLessThan(1);
    expect(pace(12)).toBeLessThan(pace(3));
    expect(pace(5)).toBeCloseTo(pace(6), 9);
    const titled = [beat({ kind: 'title_card', screen: '', shots: 1 }), ...cards(8)];
    expect(scoreCut(cut({ estSec: 90, kinds: 2, avgShotSec: 0, captionWords: 9 }, titled)).pace).toBeCloseTo(1, 9); // the logo card is not a card
  });

  it('says what is wrong in French, with the number', () => {
    const { notes } = scoreCut(cut({ hookWordSec: 0.8, avgShotSec: 2.9, productSec: 30, captionWords: 6, endHoldSec: 0.9 }, [beat({ kind: 'fact_card' })]));
    expect(notes).toEqual(expect.arrayContaining([
      'Le texte arrive à 0,8 s : le hook doit être là dès la première image.',
      'Plans trop longs (2,9 s en moyenne).',
      'Le vrai guide n’apparaît qu’à la fin.',
    ]));
  });

  it('does not write a note about shots on a carousel', () => {
    expect(scoreCut(cut({ avgShotSec: 0, kinds: 2, captionWords: 9 }, slides())).notes.join(' ')).not.toContain('Plans');
  });
});

// ───────────────────────────── in the score ─────────────────────────────

const SCENES: AdScene[] = [
  { visual: 'Accroche plein écran', onScreenText: 'Bébé se réveille toutes les 2 h ?', voiceover: 'Bébé se réveille toutes les 2 h ?', durationSec: 4 },
  { visual: 'Bulle de commentaire', onScreenText: '« je n’en peux plus »', voiceover: 'Si toi aussi tu te dis « je n’en peux plus », reste deux secondes.', durationSec: 5 },
  { visual: 'Vraie page du guide', onScreenText: '1. Noter chaque réveil', voiceover: 'La méthode commence par un geste tout simple : noter chaque réveil pendant 3 nuits.', durationSec: 6 },
  { visual: 'Couverture du guide', onScreenText: 'Guide PDF — lien en bio', voiceover: 'Le guide complet est en lien dans ma bio.', durationSec: 5 },
];

const VOC: VoiceOfCustomer = {
  nicheId: 'sommeil-bebe', pains: ['Il se réveille toutes les 2 heures'], phrases: ['je n’en peux plus'], objections: [], desiredOutcomes: [], bannedClaims: [], sources: [],
} as unknown as VoiceOfCustomer;

function adOf(over: Partial<AdCreative> = {}): AdCreative {
  return {
    id: 'cre_1', productId: 'prd_1', hook: 'Bébé se réveille toutes les 2 h ?', hookStyle: 'question', format: 'faceless_voiceover', scenes: SCENES,
    caption: 'Bébé se réveille toutes les 2 h ? Le guide est en lien.', hashtags: ['#bebe', '#sommeil', '#parents'], cta: 'Télécharge le guide (lien en bio)',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'zoe', ...over,
  };
}

const CONTENT: PdfContent = {
  title: 'Bébé se réveille toutes les 2 heures', subtitle: 'Le plan en 14 nuits', audience: 'Parents de bébés de 6 à 12 mois', promise: 'Des nuits plus longues', introduction: ['Une introduction.'],
  chapters: [{ title: 'Noter', intro: 'Noter chaque réveil pendant 3 nuits.', paragraphs: [], steps: ['Notez chaque réveil pendant 3 nuits.'], example: '', checklist: [], visual: null }],
  bonus: null, nextStep: null,
} as unknown as PdfContent;

function productOf(over: Partial<Product> = {}): Product {
  return {
    id: 'prd_1', nicheId: 'sommeil-bebe', title: 'Bébé se réveille toutes les 2 heures', subtitle: '', audience: 'Parents de bébés de 6 à 12 mois', problem: 'Bébé se réveille toutes les 2 heures la nuit',
    price: 19, status: 'live', version: 1, content: CONTENT, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
    createdDay: 1, launchedDay: 1, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [], ...over,
  };
}

describe('scoreCreative with a cut', () => {
  const weak = (): VideoCut => cut({ hookWordSec: 0.8, avgShotSec: 3, estSec: 38, productSec: 30, kinds: 3, captionWords: 6, endHoldSec: 0.9 }, [beat({ kind: 'fact_card' })]);

  it('without a cut, today\'s value exactly', () => {
    // both pinned on the code of the commit before this package: an old save must not move by a point
    expect(scoreCreative(adOf(), productOf(), VOC)).toEqual({
      overall: 99, specificity: 100, structure: 100, actionability: 100, humanTone: 96, design: 100, promiseMatch: 100, compliance: 100, issues: [], blocking: [], evaluator: 'heuristic',
    });
    const long = 'et encore un texte beaucoup trop long pour un écran'.repeat(2);
    const flawed = adOf({ hook: 'Ça change tout', scenes: SCENES.slice(0, 2).map((s) => ({ ...s, onScreenText: `${s.onScreenText} ${long}`, visual: 'x', durationSec: 3 })), cta: 'ok', hashtags: [] });
    const q = scoreCreative(flawed, productOf(), VOC);
    expect({ ...q, issues: [], blocking: [] }).toEqual({ overall: 58, specificity: 75, structure: 30, actionability: 0, humanTone: 96, design: 20, promiseMatch: 100, compliance: 100, issues: [], blocking: [], evaluator: 'heuristic' });
    expect(q.issues).toEqual([
      'Durée 6 s hors format (12 à 30 secondes).', 'Textes à l\'écran trop longs : 12 mots maximum par scène.', 'Le hook doit apparaître dans la première scène (2 premières secondes).',
      'Hook trop court ou trop long : visez 25 à 90 caractères.', 'La solution (le guide, la méthode) n\'apparaît pas clairement.', 'Pas d\'appel à l\'action à la fin (« lien en bio », « télécharge le guide »).', '2 scène(s) : visez 3 à 7 scènes.',
    ]);
  });

  it('`cut: null` reads as no cut', () => {
    expect(scoreCreative(adOf({ cut: null }), productOf(), VOC)).toEqual(scoreCreative(adOf(), productOf(), VOC));
  });

  it('structure gives its 20 points through pace, design is the look, overall follows', () => {
    const product = productOf();
    const none = scoreCreative(adOf(), product, VOC);
    const best = scoreCreative(adOf({ cut: cut() }), product, VOC);
    const worst = scoreCreative(adOf({ cut: weak() }), product, VOC);
    expect(best.structure).toBe(none.structure);
    const { pace, look } = scoreCut(weak());
    expect(worst.structure).toBe(Math.round(none.structure - 20 + 20 * pace));
    expect(worst.design).toBe(Math.round(100 * look));
    expect(best.design).toBe(100);
    expect(best.overall).toBeGreaterThan(worst.overall);
  });

  it('the duration points read the cut, same bands', () => {
    const product = productOf();
    const at = (estSec: number) => scoreCreative(adOf({ cut: cut({ estSec, productSec: 0 }) }), product, VOC).actionability;
    expect(at(12)).toBe(100);
    expect(at(30)).toBe(100);
    expect(at(31)).toBe(80);
    expect(at(40)).toBe(80);
    expect(at(41)).toBe(60);
    expect(at(8)).toBe(60);
    expect(scoreCreative(adOf({ cut: cut({ estSec: 38, productSec: 0 }) }), product, VOC).issues.join(' ')).toContain('Durée 38 s');
  });

  it('a format that breaks its rule is still a block', () => {
    const silent = SCENES.map((s) => ({ ...s, voiceover: '' }));
    const q = scoreCreative(adOf({ scenes: silent, cut: cut() }), productOf(), VOC);
    expect(q.blocking?.some((b) => b.dimension === 'design')).toBe(true);
    expect(q.design).toBe(100);
  });

  it('hands the rework its notes, in French', () => {
    const { issues } = scoreCreative(adOf({ cut: weak() }), productOf(), VOC);
    expect(issues).toEqual(expect.arrayContaining(['Le texte arrive à 0,8 s : le hook doit être là dès la première image.', 'Le vrai guide n’apparaît qu’à la fin.', 'Plans trop longs (3,0 s en moyenne).']));
  });

  it('a 38 s voice-over scores under a 26 s one, whatever `durationSec` claims', () => {
    const product = productOf();
    const padding = ' Et une phrase de plus pour bien insister sur ce point précis du guide, encore et encore.';
    const padded = (n: number): AdScene[] => SCENES.map((s, i) => ({ ...s, voiceover: `${s.voiceover}${padding.repeat(Math.floor(n / 4) + (i < n % 4 ? 1 : 0))}` }));
    const planned = (scenes: AdScene[]) => planCut({ creative: adOf({ scenes }), product, voc: VOC, skill: 0.33, tempo: 'standard', rng: steady() }); // no tightening: the words are the voice
    const [long, short] = [padded(5), padded(3)];
    const [a, b] = [planned(long), planned(short)];
    expect(Math.round(a.metrics.estSec)).toBe(38);
    expect(Math.round(b.metrics.estSec)).toBe(28);
    for (const scenes of [long, short]) expect(scenes.reduce((s, x) => s + x.durationSec, 0)).toBe(20);
    expect(scoreCreative(adOf({ scenes: long, cut: a }), product, VOC).overall).toBeLessThan(scoreCreative(adOf({ scenes: short, cut: b }), product, VOC).overall);
  });
});

// ───────────────────────────── in the market ─────────────────────────────

/** One campaign on one approved creative: everything but the cut is the same, seed included. */
function market(c: VideoCut | null, over: Partial<ScenarioConfig> = {}): { world: WorldState; niche: NicheTruth } {
  const world = createWorld(defaultScenario({ seed: 11, mindMode: 'heuristic', maxComputeEur: 0, ...LEGACY, ...over }), 'test-score');
  const niche = world.market.niches[0]!;
  const product = productOf({ nicheId: niche.id });
  const campaign: Campaign = {
    id: 'cmp_1', productId: product.id, name: 'Test', status: 'active', creativeIds: ['cre_1'], dailyBudget: 40, targeting: { interests: [], ageMin: 25, ageMax: 45 }, createdBy: 'zoe', startDay: 1,
  } as unknown as Campaign;
  world.company.products.push(product);
  world.company.creatives.push(adOf(c ? { cut: c } : {}));
  world.company.campaigns.push(campaign);
  return { world, niche };
}

function run(world: WorldState, days: number): DailyAdStats[] {
  for (let d = 1; d <= days; d++) {
    world.day = d;
    tickMarket(world, streamRng(world.scenario.seed, 3, d));
  }
  return world.market.adStats;
}

const ctrOf = (rows: DailyAdStats[]): number => rows.reduce((s, r) => s + r.clicks, 0) / rows.reduce((s, r) => s + r.impressions, 0);

describe('the market', () => {
  it('a better cut raises CTR through `adQ`, with no term of its own', () => {
    const better = market(cut());
    const worse = market(cut({ hookWordSec: 0.8, avgShotSec: 3, estSec: 38, productSec: 30, kinds: 3, captionWords: 6, endHoldSec: 0.9 }, [beat({ kind: 'fact_card' })]));
    const up = run(better.world, 10);
    const down = run(worse.world, 10);
    expect(up.length).toBe(10);
    expect(ctrOf(up) / ctrOf(down)).toBeGreaterThan(1.1);
    for (const [i, row] of up.entries()) expect(row.ctr).toBeGreaterThanOrEqual(down[i]!.ctr * 0.9); // same day, same stream
  });

  it('a creative without a cut is judged as before, whatever the tempo of the niche', () => {
    const { world, niche } = market(null, { videoModel: 'on' });
    expect(niche.videoTempo).toBeDefined();
    const off = market(null);
    expect(run(world, 5).map((r) => [r.impressions, r.clicks])).toEqual(run(off.world, 5).map((r) => [r.impressions, r.clicks]));
  });

  it('a matching tempo sells more than the opposite one, on the same cut', () => {
    const on = (tempo: VideoTempo, taste: VideoTempo): number => {
      const { world, niche } = market({ ...cut(), tempo }, { videoModel: 'on' });
      niche.videoTempo = taste;
      return ctrOf(run(world, 10));
    };
    expect(on('fast', 'fast') / on('calm', 'fast')).toBeGreaterThan(1.08);
  });
});

describe('tempoFit', () => {
  const niche = (videoTempo?: VideoTempo): NicheTruth => ({ videoTempo }) as NicheTruth;
  const ad = (tempo?: VideoTempo): AdCreative => adOf(tempo ? { cut: { ...cut(), tempo } } : {});

  it.each([
    ['fast', 'fast', VIDEO_MARKET.tempoMatch], ['calm', 'calm', VIDEO_MARKET.tempoMatch], ['standard', 'standard', VIDEO_MARKET.tempoMatch],
    ['calm', 'fast', VIDEO_MARKET.tempoOpposite], ['fast', 'calm', VIDEO_MARKET.tempoOpposite],
    ['standard', 'fast', 1], ['calm', 'standard', 1], ['fast', 'standard', 1], ['standard', 'calm', 1],
  ] as [VideoTempo, VideoTempo, number][])('%s in a %s niche is worth %d', (tempo, taste, fit) => {
    expect(tempoFit(niche(taste), ad(tempo))).toBe(fit);
  });

  it('is 1 without a cut or a truth', () => {
    expect(tempoFit(niche('fast'), ad())).toBe(1);
    expect(tempoFit(niche(), ad('fast'))).toBe(1);
  });
});

describe('the truth of a niche', () => {
  const scenario = (videoModel?: 'on' | 'off'): ScenarioConfig => ({ ...defaultScenario({ seed: 5 }), videoModel });

  it('comes from the seed and draws nothing from the market', () => {
    const on = createRng(5);
    const off = createRng(5);
    const withTaste = createMarketState(scenario('on'), on);
    const without = createMarketState(scenario('off'), off);
    expect(on.state()).toBe(off.state());
    expect(withTaste.niches.map(({ videoTempo: _, ...n }) => n)).toEqual(without.niches);
    expect(without.niches.every((n) => n.videoTempo === undefined)).toBe(true);
    expect(createMarketState(scenario(undefined), createRng(5)).niches.every((n) => n.videoTempo === undefined)).toBe(true);
    expect(withTaste.niches.map((n) => n.videoTempo)).toEqual(withTaste.niches.map((_, i) => nicheTempo(5, i)));
    expect(new Set(withTaste.niches.map((n) => n.videoTempo)).size).toBeGreaterThan(1);
    for (const n of withTaste.niches) expect(TEMPOS).toContain(n.videoTempo);
  });

  it('is the same at every load of a seed', () => {
    const first = createMarketState(scenario('on'), createRng(5)).niches.map((n) => n.videoTempo);
    expect(createMarketState(scenario('on'), createRng(5)).niches.map((n) => n.videoTempo)).toEqual(first);
  });

  it('never leaves the server, the cut\'s own tempo being a decision anyone can read', () => {
    const { world } = market({ ...cut(), tempo: 'fast' }, { videoModel: 'on' });
    expect(world.market.niches.some((n) => n.videoTempo)).toBe(true);
    expect(JSON.stringify(toSnapshot(world))).not.toContain('videoTempo');
    expect(JSON.stringify(toSnapshot(world, true))).not.toContain('videoTempo');
  });
});

describe('the tempo bandit', () => {
  it('learns from the same rows as the hook and the format', () => {
    const { world, niche } = market({ ...cut(), tempo: 'fast' });
    run(world, 1);
    const rewards = applyDailyRewards(world, 1);
    const arms = world.company.bandits[`video_tempo:${niche.id}`]!;
    expect(arms.find((a) => a.key === 'fast')?.pulls).toBeGreaterThan(0);
    const without = market(null);
    run(without.world, 1);
    expect(rewards).toBe(applyDailyRewards(without.world, 1) + 1);
    expect(without.world.company.bandits[`video_tempo:${niche.id}`]).toBeUndefined();
  });
});

describe('the writer\'s scenes hold up against the score', () => {
  let product: Product;
  let voc: VoiceOfCustomer;
  let creative: AdCreative;

  beforeAll(async () => {
    const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-score');
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
    const tools = createMarketTools(world, createRng(5));
    const mind: MindContext = { agent: world.company.agents[0]!, playbook: [], brainNotes: [], lessons: [], day: 1 };
    const niche = world.market.niches[2]!;
    const brief = tools.nicheBrief(niche.id)!;
    voc = tools.minePains(niche.id, 'deep');
    const outline = await engine.writeOutline({ title: brief.name, niche: brief, voc }, mind);
    const content = await engine.writePdfContent({ title: brief.name, outline, niche: brief, voc, upsellTitle: null }, mind);
    product = productOf({ nicheId: niche.id, title: content.title, audience: brief.audience, problem: brief.problem, content });
    const [hook] = await engine.writeAdHooks({ product, voc, styles: ['question'], upsellOf: null, usedHooks: [] }, mind);
    creative = adOf({ ...(await engine.writeAd({ product, voc, hook: hook!.hook, hookStyle: hook!.hookStyle, format: 'faceless_voiceover', bannedClaims: voc.bannedClaims, upsellOf: null }, mind)) });
  }, 60_000);

  it('the predicted curve of video §3.5: weak far below, flat past .85, nothing lost at the top', () => {
    const craft = (skill: number): VideoCut => planCut({ creative, product, voc, skill, tempo: 'standard', rng: steady() });
    const overall = (skill: number): number => scoreCreative({ ...creative, cut: craft(skill) }, product, voc).overall;
    const none = scoreCreative(creative, product, voc).overall;
    expect(scoreCut(craft(0.2)).craft).toBeLessThan(55);
    expect(scoreCut(craft(0.9)).craft).toBeGreaterThanOrEqual(90);
    expect(overall(0.9)).toBeGreaterThanOrEqual(none - 3);
    expect(none - overall(0.2)).toBeGreaterThanOrEqual(6);
    expect(overall(0.9)).toBe(overall(0.95));
  });
});
