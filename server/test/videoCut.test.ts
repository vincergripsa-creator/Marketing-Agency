/**
 * The cut of an ad (video §3, §12). Real scripts of the heuristic writer, on real guides of all 16 niches: a rule that only
 * holds on a hand-written line would not hold in a run. Editing is talent: it changes decisions, the text only by deleting.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdCreative, AdFormat, AgentState, BeatKind, Product, ScenarioConfig, VideoCut, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { MindContext, Rng, RunPaths } from '../src/contracts.js';
import { createRng, streamRng } from '../src/core/index.js';
import { EDIT_BASELINE, leadOut, planCut, reviewQuote, roleOf, saidSpan, TEMPOS, tightenSpoken } from '../src/deliverables/videoCut.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { inline } from '../src/minds/heuristic/studio.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { channelHandlers } from '../src/runtime/handlers/channels.js';
import { growthHandlers } from '../src/runtime/handlers/growth.js';
import { hireAgent, drawCandidates, openPosition } from '../src/runtime/org/hiring.js';
import { roleHolders } from '../src/runtime/org/officers.js';
import { STREAM } from '../src/runtime/streams.js';
import { benchFor, scoreCandidates, TEST_BY_SKILL, testDeliverable } from '../src/runtime/talent/challenge.js';
import { craftFor } from '../src/runtime/talent/craft.js';
import { onReviewed } from '../src/runtime/talent/evidence.js';
import { createTask } from '../src/runtime/tasks.js';
import { createMarketTools, scoreCreative, scoreCut } from '../src/sim/index.js';
import { NICHE_CATALOG } from '../src/sim/niches.js';
import { norm } from '../src/sim/text.js';
import { QA } from '../src/video/qa.js';
import { estimatedWords } from '../src/video/speech.js';
import { buildTimeline, TEMPO_BPM } from '../src/video/timeline.js';

const spy = vi.hoisted(() => ({ scored: [] as { draft: Partial<AdCreative>; score: number; noCut: number }[] }));

vi.mock('../src/runtime/talent/craft.js', async (original) => {
  const real = await original<typeof import('../src/runtime/talent/craft.js')>();
  return {
    ...real,
    bestDraft: (...[ctx, a, mind, purpose, write, score]: Parameters<typeof real.bestDraft<Partial<AdCreative>>>) =>
      real.bestDraft(ctx, a, mind, purpose, write, (d) => {
        const value = score(d);
        spy.scored.push({ draft: d, score: value, noCut: score({ ...d, cut: undefined }) });
        return value;
      }),
  };
});

const FORMATS: AdFormat[] = ['faceless_voiceover', 'ugc_avatar', 'text_slideshow', 'carousel'];
const BEAT_KINDS: readonly BeatKind[] = ['title_card', 'hook', 'pain_bubble', 'page_proof', 'fact_card', 'bonus_stack', 'narrator', 'slide', 'end_card'];

interface Guide { product: Product; voc: VoiceOfCustomer; ads: Record<string, AdCreative> }

const guides: Guide[] = [];

function creativeOf(draft: Pick<AdCreative, 'hook' | 'hookStyle' | 'format' | 'scenes' | 'caption' | 'hashtags' | 'cta'>, product: Product): AdCreative {
  return { ...draft, id: 'cre_1', productId: product.id, files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: 1, createdBy: 'zoe' };
}

function productOf(id: string, nicheId: string, title: string, audience: string, problem: string, content: Product['content']): Product {
  return {
    id, nicheId, title, subtitle: content?.subtitle ?? '', audience, problem, price: 19, status: 'live', version: 1, content, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
}

beforeAll(async () => {
  const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-cut');
  const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
  const tools = createMarketTools(world, createRng(5));
  const mind: MindContext = { agent: world.company.agents[0]!, playbook: [], brainNotes: [], lessons: [], day: 1 };
  for (const niche of world.market.niches) {
    const brief = tools.nicheBrief(niche.id)!;
    const voc = tools.minePains(niche.id, 'deep');
    const outline = await engine.writeOutline({ title: brief.name, niche: brief, voc }, mind);
    const content = await engine.writePdfContent({ title: brief.name, outline, niche: brief, voc, upsellTitle: null }, mind);
    const product = productOf(`prd_${guides.length}`, niche.id, content.title, brief.audience, brief.problem, content);
    const [hook] = await engine.writeAdHooks({ product, voc, styles: ['question'], upsellOf: null, usedHooks: [] }, mind);
    const ads: Guide['ads'] = {};
    for (const format of FORMATS) ads[format] = creativeOf(await engine.writeAd({ product, voc, hook: hook!.hook, hookStyle: hook!.hookStyle, format, bannedClaims: voc.bannedClaims, upsellOf: null }, mind), product);
    guides.push({ product, voc, ads });
  }
}, 60_000);

/** The editor on the day is `skill`: what a draw adds is what the test about draws looks at. */
const steady = (): Rng => ({ normal: () => 0 }) as unknown as Rng;

function cutFor(g: Guide, format: AdFormat, skill: number, tempo: VideoCut['tempo'] = 'standard', rng: Rng = steady()): VideoCut {
  return planCut({ creative: g.ads[format]!, product: g.product, voc: g.voc, skill, tempo, rng });
}

const wordsOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Every word of `cut` is in `whole`, in order: only deletions, and nothing that was not there. */
function isCutOf(cut: string, whole: string): boolean {
  const words = wordsOf(whole);
  let i = 0;
  return wordsOf(cut).every((w) => {
    while (i < words.length && words[i] !== w) i++;
    return i++ < words.length;
  });
}

const eachCut = (formats: AdFormat[], skills: number[]) => guides.flatMap((g) => formats.flatMap((f) => skills.map((s) => ({ g, format: f, skill: s, cut: cutFor(g, f, s) }))));

describe('planCut', () => {
  it('same input, same cut, byte for byte, and exactly one number drawn', () => {
    const g = guides[0]!;
    const run = () => JSON.stringify(cutFor(g, 'faceless_voiceover', 0.62, 'fast', streamRng(7, STREAM.videoCut, 123)));
    expect(run()).toBe(run());
    const rng = createRng(9);
    const counted = { ...rng, normal: vi.fn(rng.normal), next: vi.fn(rng.next), int: vi.fn(rng.int), chance: vi.fn(rng.chance), pick: vi.fn(rng.pick) };
    cutFor(g, 'faceless_voiceover', 0.62, 'fast', counted as unknown as Rng);
    expect(counted.normal).toHaveBeenCalledTimes(1);
    for (const other of [counted.next, counted.int, counted.chance, counted.pick]) expect(other).not.toHaveBeenCalled();
  });

  it('a good editor has a bad day: the draw moves the cut, the skill stays the mean', () => {
    const g = guides[0]!;
    const crafts = Array.from({ length: 40 }, (_, i) => scoreCut(cutFor(g, 'faceless_voiceover', 0.5, 'standard', streamRng(7, STREAM.videoCut, i))).craft);
    expect(new Set(crafts).size).toBeGreaterThan(1);
  });

  it('skill .2 against .9 on one creative: craft differs by at least 40, and hook, shots, kinds and product all differ', () => {
    const g = guides[2]!;
    const weak = cutFor(g, 'faceless_voiceover', 0.2, 'standard', streamRng(7, STREAM.videoCut, 42));
    const strong = cutFor(g, 'faceless_voiceover', 0.9, 'standard', streamRng(7, STREAM.videoCut, 42));
    expect(scoreCut(strong).craft - scoreCut(weak).craft).toBeGreaterThanOrEqual(40);
    for (const metric of ['hookWordSec', 'avgShotSec', 'kinds', 'productSec'] as const) expect(strong.metrics[metric]).not.toBe(weak.metrics[metric]);
  });

  it.each(['faceless_voiceover', 'ugc_avatar'] as const)('holds on every niche, %s', (format) => {
    for (const g of guides) expect(scoreCut(cutFor(g, format, 0.9)).craft - scoreCut(cutFor(g, format, 0.2)).craft).toBeGreaterThanOrEqual(40);
  });

  it.each(['faceless_voiceover', 'ugc_avatar'] as const)('the top of the league stays readable: what a strong editor adds is not paid to a middling one, %s', (format) => {
    const mean = (skill: number) => guides.reduce((n, g) => n + scoreCut(cutFor(g, format, skill)).craft, 0) / guides.length;
    expect(mean(0.9) - mean(0.45)).toBeGreaterThanOrEqual(12);
    expect(mean(0.9) - mean(0.7)).toBeGreaterThanOrEqual(6);
  });

  it('holds no reading of the editor: the end hold is one of four decisions, on every cut and in its end card', () => {
    const skills = Array.from({ length: 21 }, (_, i) => i / 20);
    const cuts = eachCut(['faceless_voiceover', 'ugc_avatar'], skills);
    expect([...new Set(cuts.map(({ cut }) => cut.metrics.endHoldSec))].sort()).toEqual([0.8, 1.2, 1.5, 1.8]);
    const g = guides[2]!;
    const end = (skill: number) => cutFor(g, 'faceless_voiceover', skill).beats.at(-1)!.estSec;
    expect(end(0.61)).toBe(end(0.74)); // one decision, and every other row reads the same: nothing in the end card tells them apart
  });

  it('every row of the table changes the plan, not a label', () => {
    const g = guides[2]!;
    const at = (skill: number) => cutFor(g, 'faceless_voiceover', skill);
    expect(at(0.2).beats[0]).toMatchObject({ kind: 'title_card', spoken: '', estSec: 0.8 });
    expect(at(0.4).beats[0]).toMatchObject({ kind: 'title_card', estSec: 0.25 });
    expect(at(0.5).beats[0]!.kind).toBe('hook');
    expect(at(0.2).metrics).toMatchObject({ hookWordSec: 0.8, captionWords: 6, endHoldSec: 0.8 });
    expect(at(0.4).metrics.captionWords).toBe(3);
    expect(at(0.9).metrics).toMatchObject({ hookWordSec: 0, productSec: 0.45, captionWords: 2, endHoldSec: 1.8 });
    expect(at(0.74).metrics.productSec).toBeGreaterThan(2);    // the guide waits for the first page: only a strong editor's opens the ad
    expect([0.29, 0.3, 0.49, 0.5, 0.74, 0.75].map((x) => at(x).metrics.endHoldSec)).toEqual([0.8, 1.2, 1.2, 1.5, 1.5, 1.8]);
    expect(at(0.3).beats.filter((b) => b.kind === 'pain_bubble')).toHaveLength(0);
    expect(at(0.4).beats.filter((b) => b.kind === 'pain_bubble')).toHaveLength(1);
    expect(at(0.09).beats.filter((b) => b.kind === 'page_proof')).toHaveLength(0);
    expect(at(0.1).beats.filter((b) => b.kind === 'page_proof')).toHaveLength(1);
    expect(at(0.29).beats.find((b) => b.kind === 'page_proof')!.shots).toBe(1);   // he holds it
    expect(at(0.3).beats.find((b) => b.kind === 'page_proof')!.shots).toBeGreaterThan(1);
    expect(at(0.49).beats.filter((b) => b.kind === 'page_proof')).toHaveLength(1);
    expect(at(0.9).beats.filter((b) => b.kind === 'page_proof').length).toBeGreaterThanOrEqual(1);
    expect([at(0.49).sfx, at(0.5).sfx]).toEqual([false, true]);
    expect(at(0.34).metrics.estSec).toBeGreaterThan(at(0.35).metrics.estSec);
    expect(at(0.59).metrics.estSec).toBeGreaterThan(at(0.6).metrics.estSec);
  });

  it('the tempo sets the length of the shots', () => {
    const g = guides[2]!;
    const shot = (tempo: VideoCut['tempo']) => cutFor(g, 'faceless_voiceover', 0.7, tempo).metrics.avgShotSec;
    expect(shot('calm')).toBeGreaterThan(shot('standard'));
    expect(shot('standard')).toBeGreaterThan(shot('fast'));
  });

  it('adds up: the metrics are read from the beats', () => {
    for (const { cut } of eachCut(FORMATS, [0.2, 0.6, 0.9])) {
      const sum = cut.beats.reduce((s, b) => s + b.estSec, 0);
      expect(cut.metrics.estSec).toBeCloseTo(sum, 1);
      expect(cut.metrics.kinds).toBe(new Set(cut.beats.filter((b) => b.kind !== 'title_card').map((b) => b.kind)).size);
      for (const b of cut.beats) expect(b.shots).toBeGreaterThanOrEqual(1);
    }
  });

  it('every spoken line is a cut of its scene\'s voice-over: no word appears that was not there', () => {
    for (const { g, format, cut } of eachCut(['faceless_voiceover', 'ugc_avatar'], [0.1, 0.45, 0.9])) {
      for (const b of cut.beats) {
        if (b.kind === 'title_card') continue;
        const voiceover = g.ads[format]!.scenes[b.scene]!.voiceover;
        expect(b.spoken.length).toBeGreaterThan(0);
        expect(isCutOf(b.spoken, voiceover), `« ${b.spoken} » / « ${voiceover} »`).toBe(true);
      }
    }
  });

  it('keeps what a talent secret would leak: no skill, no x, no ceiling', () => {
    const json = JSON.stringify(cutFor(guides[0]!, 'faceless_voiceover', 0.61803));
    expect(json).not.toMatch(/"skill"|"x"|"ceiling"|"talent"|0\.618/);
  });

  it('uses the beat kinds of the plan only (§2.2)', () => {
    for (const { cut } of eachCut(FORMATS, [0.2, 0.6, 0.9])) for (const b of cut.beats) expect(BEAT_KINDS).toContain(b.kind);
  });
});

describe('formats (video §3.4)', () => {
  it('a voiced ad ends on its card, and a strong edit uses five kinds or more', () => {
    const cut = cutFor(guides.find((g) => g.ads.faceless_voiceover!.scenes.length === 6)!, 'faceless_voiceover', 0.9);
    expect(cut.beats[0]!.kind).toBe('hook');
    expect(cut.beats.at(-1)!.kind).toBe('end_card');
    expect(cut.beats.map((b) => b.kind)).toEqual(expect.arrayContaining(['pain_bubble', 'bonus_stack']));
    expect(cut.metrics.kinds).toBeGreaterThanOrEqual(5);
  });

  it('`text_slideshow`: slides with no voice, words on reading time', () => {
    const g = guides[0]!;
    const cut = cutFor(g, 'text_slideshow', 0.9);
    expect(cut.beats.slice(0, -1).every((b) => b.kind === 'slide' && b.spoken === '')).toBe(true);
    expect(cut.beats.at(-1)).toMatchObject({ kind: 'end_card', spoken: '' });
    const words = wordsOf(cut.beats[0]!.screen).length;
    expect(cut.beats[0]!.estSec).toBeCloseTo(Math.max(1.8, words / 2.6 + 0.5), 1);
    expect(cut.metrics.captionWords).toBe(Math.max(...cut.beats.map((b) => wordsOf(b.screen).length)));
    expect(cut.metrics.avgShotSec).toBeGreaterThan(0);
  });

  it('`carousel`: cards, no shots, no sound', () => {
    const cut = cutFor(guides[0]!, 'carousel', 0.9);
    expect(cut.beats.every((b) => b.shots === 1 && b.spoken === '')).toBe(true);
    expect(cut.metrics.avgShotSec).toBe(0);
    expect(cut.sfx).toBe(false);
  });

  it('the guide counts as early only where the file shows it: slides and cards have no hook to raise it in (D9)', () => {
    for (const format of ['text_slideshow', 'carousel'] as const) {
      for (const g of guides) {
        const cut = cutFor(g, format, 0.95);
        const end = cut.beats.findIndex((b) => b.kind === 'end_card');
        expect(cut.metrics.productSec).toBeCloseTo(cut.beats.slice(0, end).reduce((s, b) => s + b.estSec, 0), 1);
        expect(cut.metrics.productSec!).toBeGreaterThan(0.2 * cut.metrics.estSec);
      }
    }
  });

  it('what the plan says of the guide is what the timeline draws, in every format', () => {
    for (const format of FORMATS) {
      for (const g of guides) {
        const cut = cutFor(g, format, 0.95);
        const speech = cut.beats.map((b) => ({ text: b.spoken, voice: null, wav: null, words: estimatedWords(b.spoken), speechSec: b.estSec }));
        const hook = cut.beats.find((b) => b.kind === 'hook' || b.kind === 'slide')!;
        const inHook = cut.metrics.productSec! < cut.metrics.hookWordSec + hook.estSec;
        expect(buildTimeline(cut, speech, TEMPO_BPM.standard).bookSec !== null).toBe(inHook);
      }
    }
  });

  it('the weakest editor on the longest script stays under the QA ceiling: a bad cut is a worse file, never no file (D9)', () => {
    const longest = Math.max(...eachCut(['faceless_voiceover', 'ugc_avatar'], [0, 0.3, 0.45]).map((c) => c.cut.metrics.estSec));
    expect(longest).toBeGreaterThan(34);
    expect(longest * (1 + QA.estGapWarn)).toBeLessThan(QA.maxSec); // the file may run this far past the model before QA even warns
  });

  it('`ugc_avatar`: a narrator instead of bubbles, with a page in inset when the step has a needle', () => {
    const cuts = guides.map((g) => cutFor(g, 'ugc_avatar', 0.9));
    expect(cuts.flatMap((c) => c.beats).some((b) => b.kind === 'pain_bubble')).toBe(false);
    expect(cuts.every((c) => c.beats.some((b) => b.kind === 'narrator'))).toBe(true);
    expect(cuts.flatMap((c) => c.beats).some((b) => b.kind === 'narrator' && !!b.proof)).toBe(true);
  });

  it('survives a script with no scene, and one with a silent scene', () => {
    const g = guides[0]!;
    const empty = planCut({ creative: { ...g.ads.faceless_voiceover!, scenes: [] }, product: g.product, voc: g.voc, skill: 0.9, tempo: 'standard', rng: steady() });
    expect(empty.beats).toEqual([]);
    expect(Number.isFinite(scoreCut(empty).craft)).toBe(true);
    const creative = g.ads.faceless_voiceover!;
    const silent = planCut({ creative: { ...creative, scenes: creative.scenes.map((s) => ({ ...s, voiceover: '' })) }, product: g.product, voc: g.voc, skill: 0.9, tempo: 'standard', rng: steady() });
    expect(silent.beats.every((b) => b.spoken === '' && b.estSec > 0)).toBe(true);
  });
});

describe('the needle', () => {
  const VOICE = 'Un repère à garder en tête : le terreau du pot épuise ses réserves très vite en été.';
  const scenes = (voiceover: string) => [
    { visual: '', onScreenText: 'Le terreau', voiceover: 'Le terreau du pot s’épuise.', durationSec: 3 },
    { visual: '', onScreenText: 'Le terreau du pot', voiceover, durationSec: 4 },
    { visual: '', onScreenText: 'Guide PDF', voiceover: 'Le guide complet est en lien dans ma bio.', durationSec: 3 },
  ];
  const cut = (chapter: Record<string, unknown>) => {
    const product = { id: 'prd_1', title: 'Le balcon', content: { chapters: [{ title: 'Le sol', intro: '', paragraphs: [], steps: [], example: null, checklist: [], ...chapter }] }, pdfFacts: { pages: 30 } } as unknown as Product;
    const creative = { hook: 'Le terreau', format: 'faceless_voiceover', scenes: scenes(VOICE) } as unknown as AdCreative;
    return planCut({ creative, product, voc: { phrases: [], bannedClaims: [] } as unknown as VoiceOfCustomer, skill: 0.9, tempo: 'standard', rng: steady() });
  };
  const proofOf = (chapter: Record<string, unknown>) => cut(chapter).beats.find((b) => b.proof)?.proof?.needle;
  const INTRO = 'Le terreau du pot épuise ses réserves'; // the voice says it first: in one pass it would win
  const PARAGRAPH = 'Le pot épuise ses réserves très vite';

  it('leaves the chapter\'s opener for last: its intro prints under a giant numeral, a poor close-up', () => {
    expect(proofOf({ intro: `${INTRO}.`, paragraphs: [`${PARAGRAPH}.`] })).toBe(PARAGRAPH);
    expect(proofOf({ intro: `${INTRO}.`, checklist: [`${PARAGRAPH}.`] })).toBe(PARAGRAPH);
  });

  it('still lands on the intro rather than lose the page: `proof` stays', () => {
    expect(proofOf({ intro: `${INTRO}.` })).toBe(INTRO);
  });
});

describe('tightenSpoken', () => {
  it.each([
    ['Si toi aussi tu te dis « Je n’en peux plus. Vraiment. », reste deux secondes. Une étape à la fois.', 'Si toi aussi tu te dis « Je n’en peux plus. Vraiment. », reste deux secondes.'],
    ['1. Mesure le balcon à midi. Ensuite, note le chiffre.', '1. Mesure le balcon à midi.'],
    ['Il hurle dès qu’on le pose… et l’impression d’avoir tout essayé. Une étape à la fois.', 'Il hurle dès qu’on le pose… et l’impression d’avoir tout essayé.'],
    ['Une seule phrase ici, sans suite', 'Une seule phrase ici, sans suite'],
  ])('level 1 stops at a real sentence: %s', (text, expected) => {
    expect(tightenSpoken(text, 0)).toBe(text);
    expect(tightenSpoken(text, 1)).toBe(expected);
  });

  it('level 2 cuts a clause that stands alone, and what it cuts is a whole clause', () => {
    const line = 'Un repère à garder en tête : punir un chiot après un accident ne lui apprend pas la propreté — il n’associe pas la punition à l’acte passé.';
    expect(tightenSpoken(line, 1)).toBe(line);
    expect(tightenSpoken(line, 2)).toBe('Un repère à garder en tête : punir un chiot après un accident ne lui apprend pas la propreté');
  });

  it.each([
    ['a head too short to say anything', 'Bébé dort mal — il a faim la nuit.'],
    ['a dash that opens an aside', 'Laisse la porte de la chambre — celle du fond — ouverte la nuit.'],
    ['a « ne » waiting for its « pas »', 'Un chiot de trois mois ne retient — il oublie, pas toi — rien la nuit.'],
    ['a « ne » left alone by the dash', 'Le soir venu, ton chiot ne sortira — il dort déjà.'],
    ['a condition without its answer', 'Si les plantes grillent en juillet — installez un voile d’ombrage.'],
    ['the same, after a lead-in', 'Un repère à garder en tête : si les plantes grillent en juillet — installez un voile.'],
    ['a head on a dangling word', 'Tu peux commencer le plan avec — ou sans — le carnet.'],
    ['a tail that takes back the head', 'Le tapis éducateur fonctionne très bien — mais pas la nuit.'],
    ['the same, with « sans »', 'Le ventre fond en quelques semaines — sans avis médical, jamais.'],
  ])('level 2 refuses %s', (_why, text) => {
    expect(tightenSpoken(text, 2)).toBe(text);
  });

  it('from level 1 drops the title in apposition, in the last scene only, and never one the sentence needs', () => {
    const line = 'Le guide complet, « Le chiot : 6 étapes concrètes (2-6 mois) », est en lien dans ma bio.';
    for (const level of [1, 2]) {
      expect(tightenSpoken(line, level, true)).toBe('Le guide complet est en lien dans ma bio.');
      expect(tightenSpoken(line, level, false)).toBe(line);
    }
    expect(tightenSpoken(line, 0, true)).toBe(line); // the plain editor reads it all
    const needed = 'Télécharge « Le chiot propre » dans ma bio.';
    expect(tightenSpoken(needed, 2, true)).toBe(needed);
  });

  it('holds the end card a level-1 cut spends on its title: the voice stops at the link', () => {
    for (const g of guides) {
      const last = (skill: number) => cutFor(g, 'faceless_voiceover', skill).beats.at(-1)!;
      expect(last(0.45).estSec, g.product.title).toBeLessThan(last(0.2).estSec - 1);
      expect(last(0.45).spoken).not.toContain('«');
    }
  });

  function strings(x: unknown, out: string[] = []): string[] {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) for (const y of x) strings(y, out);
    else if (x && typeof x === 'object') for (const y of Object.values(x)) strings(y, out);
    return out;
  }

  it('never leaves a clause cut mid-way, on all 4 catalogs', () => {
    // the writer turns a « : » into a dash when it reads a fact out (`inline`): every sentence of the catalogs, as it would be spoken
    const said = [...new Set(NICHE_CATALOG.flatMap((n) => strings(n)))].map((s) => `Un repère à garder en tête : ${inline(s.replace(/^\[[^\]]+\]\s*/, ''))}`).filter((s) => s.includes(' — '));
    expect(said.length).toBeGreaterThan(300);
    let cut = 0;
    for (const text of said) {
      const out = tightenSpoken(text, 2);
      expect(text.startsWith(out), text).toBe(true);
      if (out === text) continue;
      const clause = norm(out).split(' : ').at(-1)!;
      const rest = text.slice(out.length);
      expect(/^(?: — |\s*[.!?…]| )/.test(rest), text).toBe(true);
      if (rest.startsWith(' — ')) {
        cut++;
        expect(/^(?:si|quand|lorsque?)\b/.test(clause), text).toBe(false);
        if (/(?:^|[^a-z])n(?:e |')/.test(clause)) expect(/\b(?:pas|jamais|plus|rien|aucune?|personne|ni|que)\b/.test(clause), text).toBe(true);
      }
    }
    expect(cut).toBeGreaterThan(100);
  });
});

describe('roleOf', () => {
  const scene = (onScreenText: string, voiceover: string) => ({ visual: '', onScreenText, voiceover, durationSec: 3 });

  it.each([
    ['pain', scene('« je n’en peux plus »', 'Si toi aussi tu te dis « je n’en peux plus », reste deux secondes.')],
    ['step', scene('1. Noter les repas', 'Note les repas pendant trois jours.')],
    ['step', scene('La méthode', 'Une étape à la fois.')],
    ['bonus', scene('Bonus : le carnet', 'Et en cadeau, le carnet.')],
    ['proof', scene('Plan de 14 jours', 'Un repère à garder en tête : le lait reste l’aliment principal.')],
    ['proof', scene('« Très clair »', 'Un acheteur a écrit sur le guide : « très clair ».')],
  ])('a middle scene is %s', (role, s) => {
    expect(roleOf(s, 2, 6)).toBe(role);
  });

  it('the first scene is the hook and the last the end, whatever they say', () => {
    const s = scene('Bonus', '« Une étape »');
    expect(roleOf(s, 0, 6)).toBe('hook');
    expect(roleOf(s, 5, 6)).toBe('end');
  });
});

describe('proof', () => {
  it('a needle always exists verbatim in its chapter, 18 to 70 characters, once per cut', () => {
    const proofs = eachCut(['faceless_voiceover', 'ugc_avatar'], [0.5, 0.9]).flatMap(({ g, cut }) => {
      const found = cut.beats.flatMap((b) => (b.proof ? [{ ...b.proof, g }] : []));
      expect(new Set(found.map((p) => p.needle)).size).toBe(found.length);
      return found;
    });
    expect(proofs.length).toBeGreaterThan(guides.length);
    for (const { chapter, needle, g } of proofs) {
      expect(JSON.stringify(g.product.content!.chapters[chapter]), needle).toContain(JSON.stringify(needle).slice(1, -1));
      expect(needle.length).toBeGreaterThanOrEqual(18);
      expect(needle.length).toBeLessThanOrEqual(70);
    }
  });

  it('two scenes saying the same thing do not sweep the same line twice', () => {
    const g = guides[2]!;
    const creative = g.ads.faceless_voiceover!;
    const proved = cutFor(g, 'faceless_voiceover', 0.9).beats.find((b) => b.proof)!;
    const scene = creative.scenes[proved.scene]!;
    const scenes = [creative.scenes[0]!, scene, { ...scene }, creative.scenes.at(-1)!];
    const cut = planCut({ creative: { ...creative, scenes }, product: g.product, voc: g.voc, skill: 0.9, tempo: 'standard', rng: steady() });
    const needles = cut.beats.flatMap((b) => (b.proof ? [b.proof.needle] : []));
    expect(needles[0]).toBe(proved.proof!.needle);
    expect(new Set(needles).size).toBe(needles.length);
    expect(cut.beats[2]!.proof?.needle).not.toBe(needles[0]);
  });

  it('nearly every guide offers a strong editor a real page', () => {
    const cuts = guides.map((g) => cutFor(g, 'faceless_voiceover', 0.9));
    expect(cuts.filter((c) => c.beats.some((b) => b.kind === 'page_proof')).length).toBeGreaterThanOrEqual(guides.length - 1);
  });

  it('no bubble repeats the voice: a phrase it nearly says is no second voice', () => {
    const g = guides[0]!;
    const ad = g.ads.faceless_voiceover!;
    const scenes = ad.scenes.map((s, i) => (i === 1 ? { ...s, voiceover: 'Si toi aussi tu te dis « le tapis éducateur il le mange », reste deux secondes.' } : s));
    const phrases = ['le tapis éducateur il le mange lol', 'il pleure dès que je ferme la porte'];
    const cut = planCut({ creative: { ...ad, scenes }, product: g.product, voc: { ...g.voc, phrases, bannedClaims: [] }, skill: 0.9, tempo: 'standard', rng: steady() });
    expect(cut.beats.find((b) => b.kind === 'pain_bubble')?.items).toEqual([phrases[1]]);
  });

  it('without a guide, or under .1, a plate stands in for the page: proof is never invented', () => {
    const g = guides[0]!;
    const noGuide = planCut({ creative: g.ads.faceless_voiceover!, product: { ...g.product, content: null }, voc: g.voc, skill: 0.9, tempo: 'standard', rng: steady() });
    expect(noGuide.beats.some((b) => b.kind === 'page_proof' || b.proof)).toBe(false);
    expect(noGuide.beats.some((b) => b.kind === 'fact_card')).toBe(true);
    expect(cutFor(g, 'faceless_voiceover', 0.09).beats.some((b) => b.proof)).toBe(false);
  });

  it('pain bubbles carry real customer phrases, none the platform refuses', () => {
    for (const g of guides) {
      const bubble = cutFor(g, 'faceless_voiceover', 0.9).beats.find((b) => b.kind === 'pain_bubble');
      for (const item of bubble?.items ?? []) expect(g.voc.phrases).toContain(item);
    }
    const g = guides[2]!;
    const phrase = g.voc.phrases.find((p) => p.length <= 70 && !g.ads.faceless_voiceover!.scenes[1]!.voiceover.includes(p))!;
    const cut = planCut({ creative: g.ads.faceless_voiceover!, product: g.product, voc: { ...g.voc, phrases: [phrase], bannedClaims: [phrase.slice(0, 12)] }, skill: 0.9, tempo: 'standard', rng: steady() });
    expect(cut.beats.find((b) => b.kind === 'pain_bubble')?.items).toEqual([]);
  });
});

// ───────────────────────────── in a run ─────────────────────────────

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => {
  spy.scored.length = 0;
});

interface Lab { world: WorldState; ctx: RuntimeCtx; company: Company; reopen(w: WorldState): Company }

async function lab(over: Partial<ScenarioConfig> = {}): Promise<Lab> {
  const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), 'test-cut');
  const root = mkdtempSync(join(tmpdir(), 'pixel-cut-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w) => new Company(w, opts) };
}

function liveProduct(w: WorldState): Product {
  const g = guides.find((x) => x.product.nicheId === w.market.niches[0]!.id)!;
  const product: Product = { ...g.product, id: 'prd_live', design: null };
  w.company.products.push(product);
  w.company.research.voc[product.nicheId] = g.voc;
  return product;
}

const editor = (w: WorldState): AgentState => w.company.agents.find((a) => a.taskKinds.includes('produce_ad') || a.hatKinds.includes('produce_ad'))!;

async function produce(l: Lab, product: Product, rework?: AdCreative): Promise<AdCreative> {
  const { world: w, ctx } = l;
  const agent = editor(w);
  const task = createTask(w, { kind: 'produce_ad', input: { productId: product.id, nicheId: product.nicheId, variant: 0 } });
  task.assignee = agent.id;
  if (rework) Object.assign(task, { attempts: 1, output: { creativeId: rework.id } });
  const craft = craftFor(w, agent, 'produce_ad');
  const mind: MindContext = { agent, playbook: [], brainNotes: [], lessons: [], day: w.day, ...(craft ? { craft } : {}) };
  const out = await growthHandlers.produce_ad!.run(ctx, task, agent, mind);
  task.output = out.output ?? null;
  return w.company.creatives.find((c) => c.id === out.output?.creativeId)!;
}

describe('produce_ad', () => {
  it('writes the cut in the world, and the score reads it', async () => {
    const l = await lab();
    const product = liveProduct(l.world);
    const c = await produce(l, product);
    expect(c.cut?.beats.length).toBeGreaterThan(2);
    expect(TEMPOS).toContain(c.cut!.tempo);
    expect(c.cut!.craft).toBe(scoreCut(c.cut!).craft);
    expect(c.cut!.craft).toBeGreaterThan(0);
    const voc = l.world.company.research.voc[product.nicheId]!;
    expect(c.quality!.overall).toBe(scoreCreative(c, product, voc).overall);
    expect(c.quality!.overall).not.toBe(scoreCreative({ ...c, cut: undefined }, product, voc).overall);
  }, 30_000);

  it('ranks each draft with its cut (D31), and keeps the cut of the draft it kept', async () => {
    const l = await lab({ control: { talentOverride: { skills: ['copy'], value: 0.9 } } });
    const product = liveProduct(l.world);
    const c = await produce(l, product);
    expect(spy.scored.length).toBeGreaterThan(1);
    expect(spy.scored.every(({ draft }) => !!draft.cut?.beats.length)).toBe(true);
    expect(spy.scored.some(({ score, noCut }) => score !== noCut)).toBe(true);
    const kept = spy.scored.find(({ draft }) => draft.hook === c.hook && JSON.stringify(draft.scenes) === JSON.stringify(c.scenes));
    expect(kept?.draft.cut).toEqual(c.cut);
  }, 30_000);

  it('`videoModel: off` plans nothing and opens no bandit', async () => {
    const l = await lab({ videoModel: 'off' });
    const product = liveProduct(l.world);
    const c = await produce(l, product);
    expect('cut' in c).toBe(false);
    expect(Object.keys(l.world.company.bandits).filter((k) => k.startsWith('video_tempo'))).toEqual([]);
  }, 30_000);

  it('the tempo comes from the niche\'s bandit, the control forces it past the bandit', async () => {
    const l = await lab();
    const product = liveProduct(l.world);
    const dim = `video_tempo:${product.nicheId}`;
    l.world.company.bandits[dim] = TEMPOS.map((key) => (key === 'fast' ? { key, alpha: 300, beta: 3, pulls: 90, reward: 88 } : { key, alpha: 3, beta: 300, pulls: 90, reward: 2 }));
    expect((await produce(l, product)).cut!.tempo).toBe('fast');
    const forced = await lab({ control: { videoTempo: 'calm' } });
    const other = liveProduct(forced.world);
    expect((await produce(forced, other)).cut!.tempo).toBe('calm');
    expect(forced.world.company.bandits[`video_tempo:${other.nicheId}`]).toBeUndefined();
  }, 30_000);

  it('`control.videoSkill` makes the editor, with talent on or off, and the agent\'s talent otherwise', async () => {
    const craftAt = async (over: Partial<ScenarioConfig>): Promise<number> => {
      const l = await lab(over);
      return (await produce(l, liveProduct(l.world))).cut!.craft;
    };
    expect(await craftAt({ control: { videoSkill: 0.95 } })).toBeGreaterThan(await craftAt({ control: { videoSkill: 0.1 } }));
    expect(await craftAt({ talent: 'off', control: { videoSkill: 0.95 } })).toBeGreaterThan(await craftAt({ talent: 'off', control: { videoSkill: 0.1 } }));
    expect(EDIT_BASELINE).toBe(0.62);
  }, 60_000);

  it('a rework replaces the cut with the script it rewrites', async () => {
    const l = await lab();
    const product = liveProduct(l.world);
    const first = await produce(l, product);
    const before = JSON.stringify(first.cut);
    const again = await produce(l, product, first);
    expect(again.id).toBe(first.id);
    expect(JSON.stringify(again.cut)).not.toBe(before);
    for (const b of again.cut!.beats) if (b.spoken) expect(isCutOf(b.spoken, again.scenes[b.scene]!.voiceover)).toBe(true);
  }, 30_000);

  it('a cut of a creative for another channel keeps its master\'s cut, a pin has none', async () => {
    const l = await lab();
    const { world: w, ctx } = l;
    const product = liveProduct(w);
    const master = await produce(l, product);
    const agent = editor(w);
    const mind: MindContext = { agent, playbook: [], brainNotes: [], lessons: [], day: w.day };
    const adapt = async (ratio: string, channel: string): Promise<AdCreative> => {
      const task = createTask(w, { kind: 'adapt_creative', input: { productId: product.id, masterId: master.id, ratio, channel } });
      task.assignee = agent.id;
      const out = await channelHandlers.adapt_creative!.run(ctx, task, agent, mind);
      return w.company.creatives.find((c) => c.id === out.output?.creativeId)!;
    };
    expect((await adapt('4:5', 'meta')).cut).toEqual(master.cut);
    expect((await adapt('2:3', 'pinterest')).cut).toBeNull();
  }, 30_000);
});

describe('video evidence (D12)', () => {
  it('the first review of a produce_ad is a game on `video`, at par 80, and a rework is none', async () => {
    const l = await lab();
    const { world: w, ctx } = l;
    const product = liveProduct(w);
    const c = await produce(l, product);
    const agent = editor(w);
    const task = createTask(w, { kind: 'produce_ad', input: { productId: product.id } });
    Object.assign(task, { assignee: agent.id, output: { creativeId: c.id } });
    onReviewed(ctx, task, { verdict: 'approve', score: 85 });
    const league = w.company.league!;
    expect(league.parStats['video:cut']).toEqual({ n: 1, sum: c.cut!.craft, sq: c.cut!.craft ** 2 });
    const rating = league.entries[agent.id]!.ratings.video!;
    expect(rating).toMatchObject({ n: 1, metric: c.cut!.craft });
    expect(rating.rating > 1500).toBe(c.cut!.craft > 80);
    expect(league.events.at(-1)).toMatchObject({ skill: 'video', source: 'cut', agentId: agent.id, w: 1 });
    task.attempts = 1;
    onReviewed(ctx, task, { verdict: 'approve', score: 85 });
    expect(league.parStats['video:cut']!.n).toBe(1);
  }, 30_000);

  it('a creative with no cut, and any other kind, say nothing about video', async () => {
    const l = await lab();
    const { world: w, ctx } = l;
    const product = liveProduct(w);
    const c = await produce(l, product);
    delete c.cut;
    const agent = editor(w);
    const task = createTask(w, { kind: 'produce_ad', input: { productId: product.id } });
    Object.assign(task, { assignee: agent.id, output: { creativeId: c.id } });
    onReviewed(ctx, task, { verdict: 'approve', score: 85 });
    const other = createTask(w, { kind: 'write_sales_page', input: { productId: product.id } });
    Object.assign(other, { assignee: agent.id, output: { creativeId: c.id } });
    onReviewed(ctx, other, { verdict: 'approve', score: 85 });
    expect(w.company.league!.parStats['video:cut']).toBeUndefined();
  }, 30_000);
});

describe('the script and its cut are two works (D12)', () => {
  /** One first review of `c` with its real score: what it gave `copy`, read off `parStats`. */
  const copyGame = (l: Lab, product: Product, c: AdCreative): number => {
    const { world: w, ctx } = l;
    const task = createTask(w, { kind: 'produce_ad', input: { productId: product.id } });
    Object.assign(task, { assignee: editor(w).id, output: { creativeId: c.id } });
    const before = w.company.league!.parStats['copy:qa']?.sum ?? 0;
    onReviewed(ctx, task, { verdict: 'approve', score: scoreCreative(c, product, w.company.research.voc[product.nicheId]!).overall });
    return w.company.league!.parStats['copy:qa']!.sum - before;
  };

  it('the writer answers for the script alone: a weak cut and a strong one of one script leave the same `copy` game', async () => {
    const l = await lab();
    const product = liveProduct(l.world);
    const c = await produce(l, product);
    const voc = l.world.company.research.voc[product.nicheId]!;
    const cutAt = (skill: number): VideoCut => {
      const cut = planCut({ creative: c, product, voc, skill, tempo: 'standard', rng: steady() });
      return { ...cut, craft: scoreCut(cut).craft };
    };
    const weak = cutAt(0.1), strong = cutAt(0.95);
    const overall = (cut: VideoCut) => scoreCreative({ ...c, cut }, product, voc).overall;
    expect(overall(strong) - overall(weak)).toBeGreaterThan(3);

    const script = scoreCreative({ ...c, cut: null }, product, voc).overall;
    c.cut = weak;
    expect(copyGame(l, product, c)).toBe(script);
    c.cut = strong;
    expect(copyGame(l, product, c)).toBe(script);
    const games = l.world.company.league!.events.filter((e) => e.skill === 'copy' && e.source === 'qa');
    expect(games.map((e) => e.s)).toEqual([games[0]!.s, games[0]!.s]);
  }, 30_000);

  it('the review still reads the whole ad, and the cut still goes to `video`', async () => {
    const l = await lab();
    const product = liveProduct(l.world);
    const c = await produce(l, product);
    const voc = l.world.company.research.voc[product.nicheId]!;
    expect(c.quality!.overall).toBe(scoreCreative(c, product, voc).overall);
    expect(c.quality!.overall).not.toBe(scoreCreative({ ...c, cut: null }, product, voc).overall);
    copyGame(l, product, c);
    expect(l.world.company.league!.parStats['video:cut']).toEqual({ n: 1, sum: c.cut!.craft, sq: c.cut!.craft ** 2 });
  }, 30_000);

  it('with no cut in the world, the review\'s own score stays the game', async () => {
    const l = await lab();
    const product = liveProduct(l.world);
    const c = await produce(l, product);
    delete c.cut;
    expect(copyGame(l, product, c)).toBe(scoreCreative(c, product, l.world.company.research.voc[product.nicheId]!).overall);
  }, 30_000);
});

describe('the video test (D16)', () => {
  it('has its row, at the par of `cut`', () => {
    expect(TEST_BY_SKILL.video?.par()).toBe(80.31);
  });

  it('is the real thing: writes nothing, the same day gives the same score, a stronger editor scores higher', async () => {
    const l = await lab();
    const { world: w, ctx } = l;
    const product = liveProduct(w);
    await produce(l, product);
    const a = roleHolders(w, 'art_director')[0] ?? w.company.agents[0]!;
    const bench = benchFor(ctx, 'video', a);
    const before = JSON.stringify(w);
    const once = await testDeliverable(bench, { ...a }, 0);
    expect(JSON.stringify(w)).toBe(before);
    expect((await testDeliverable(bench, { ...a }, 0))?.score).toBe(once?.score);
    expect(once?.deliverable).toContain('Montage');
    const at = async (t: number): Promise<number> => {
      w.talentTruth!.agents[a.id]!.talent.video = t;
      return (await testDeliverable(bench, { ...a }, 0))!.score;
    };
    expect(await at(0.9)).toBeGreaterThanOrEqual((await at(0.2)) + 40);
  }, 30_000);

  it('a candidate motion designer sits it, and nothing to cut still gives 50', async () => {
    const l = await lab();
    const { world: w, ctx } = l;
    const product = liveProduct(w);
    const none = drawCandidates(ctx, 'motion_designer', 0, 2);
    await scoreCandidates(ctx, 'motion_designer', none);
    expect(none.map((c) => [c.interview, c.deliverable])).toEqual([[50, null], [50, null]]);

    await produce(l, product);
    const position = openPosition(ctx, 'motion_designer', 'founder', 'Pour le test')!;
    const candidates = drawCandidates(ctx, 'motion_designer', 1, 6); // scores stand on bands: three of them can land on one
    const before = JSON.stringify(w);
    await scoreCandidates(ctx, 'motion_designer', candidates);
    expect(JSON.stringify(w)).toBe(before);
    for (const c of candidates) expect(c.deliverable).toContain('Montage');
    expect(new Set(candidates.map((c) => c.interview)).size).toBeGreaterThan(1);
    const hire = await hireAgent(ctx, position, candidates[0]!);
    expect(w.company.league!.entries[hire.id]!.ratings.video?.rating).not.toBe(1500);
  }, 30_000);
});

describe('the page a cut shows', () => {
  const chapter = (over: Partial<NonNullable<Product['content']>['chapters'][number]>) => ({ title: 'Le soleil', intro: '', paragraphs: [], steps: [], example: null, checklist: [], visual: null, ...over });
  const guideOf = (chapters: unknown[], pages = 30): Product => ({ ...guides[0]!.product, pdfFacts: { pages, sheets: 1 }, content: { ...guides[0]!.product.content!, chapters } as Product['content'] });
  const scenes = (step: string, proof: string): AdCreative['scenes'] => [
    { visual: '', onScreenText: 'Le hook', voiceover: 'Le hook du jour.', durationSec: 3 },
    { visual: '', onScreenText: '1. Mesurer', voiceover: step, durationSec: 4 },
    { visual: '', onScreenText: 'Plan de 8 mois', voiceover: proof, durationSec: 4 },
    { visual: '', onScreenText: 'Guide PDF — lien en bio', voiceover: 'Le guide complet est en lien dans ma bio.', durationSec: 3 },
  ];
  const plan = (product: Product, script: AdCreative['scenes'], skill: number, format: AdFormat = 'faceless_voiceover'): VideoCut => planCut({ creative: { ...guides[0]!.ads[format]!, scenes: script }, product, voc: guides[0]!.voc, skill, tempo: 'standard', rng: steady() });
  const STEP = 'La méthode commence par un geste : mesurer le soleil du balcon chaque matin.';

  it('takes a needle as the page prints it: no box label, no step number', () => {
    const tick = plan(guideOf([chapter({ checklist: ['Fait : mesurer le soleil du balcon chaque matin'] })]), scenes(STEP, 'Un repère à garder.'), 0.9);
    expect(tick.beats[1]!.proof?.needle).toBe('mesurer le soleil du balcon chaque matin');
    const step = plan(guideOf([chapter({ steps: ['1. Mesurer le soleil du balcon chaque matin'] })]), scenes(STEP, 'Un repère à garder.'), 0.9);
    expect(step.beats[1]!.proof?.needle).toBe('Mesurer le soleil du balcon chaque matin');
    const example = plan(guideOf([chapter({ example: 'Exemple type : Karim mesure le soleil du balcon chaque matin.' })]), scenes(STEP, 'Un repère à garder.'), 0.9);
    expect(example.beats[1]!.proof?.needle).toBe('Karim mesure le soleil du balcon chaque matin');
  });

  it('a digest prints its steps, not its running text: the needle stays on a line it has', () => {
    const chapters = [chapter({ paragraphs: ['Mesurer le soleil du balcon chaque matin, sans exception.'], steps: ['Noter les heures de plein soleil sur le carnet'] })];
    expect(plan(guideOf(chapters), scenes(STEP, 'Un repère à garder.'), 0.9).beats[1]!.proof?.needle).toBe('Mesurer le soleil du balcon chaque matin, sans exception');
    expect(plan(guideOf(chapters, 9), scenes(STEP, 'Un repère à garder.'), 0.9).beats[1]!.proof?.needle).toBe('Noter les heures de plein soleil sur le carnet');
  });

  it('a scene about the method shows the method, even when no line repeats the voice', () => {
    const product = guideOf([chapter({ steps: ['Tailler les tomates une fois par semaine'] })]);
    const cut = plan(product, scenes('La méthode tient en peu de gestes, et ça change tout pour toi.', 'Un repère à garder.'), 0.9);
    expect(cut.beats[1]).toMatchObject({ kind: 'page_proof', proof: { chapter: 0, needle: 'Tailler les tomates une fois par semaine' } });
    expect(cut.beats[2]!.kind).toBe('fact_card'); // a loose scene with nothing on its subject stays a plate: proof is not decoration
  });

  it('a plain editor shows one page, a strong one every page it can', () => {
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin', 'Le terreau du pot s’épuise vite en été'] })]);
    const script = scenes(STEP, 'Un repère à garder : le terreau du pot s’épuise vite en été.');
    const pages = (skill: number) => plan(product, script, skill).beats.filter((b) => b.kind === 'page_proof').length;
    expect([pages(0.09), pages(0.2), pages(0.49), pages(0.5), pages(0.9)]).toEqual([0, 1, 1, 2, 2]);
  });

  it('a narrator keeps the page beside it and still gets its full-bleed page', () => {
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin', 'Le terreau du pot s’épuise vite en été'] })]);
    const cut = plan(product, scenes(STEP, 'Un repère à garder : le terreau du pot s’épuise vite en été.'), 0.45, 'ugc_avatar');
    expect(cut.beats.map((b) => [b.kind, !!b.proof]).slice(-3, -1)).toEqual([['narrator', true], ['page_proof', true]]);
  });

  it('a narrated cut with nothing else to fill the frame shows its step full bleed, the voice on the line: an inset does not read on a phone', () => {
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin'] })]);
    const cut = plan(product, scenes(STEP, 'Un repère à garder.'), 0.9, 'ugc_avatar');
    expect(cut.beats[1]).toMatchObject({ kind: 'page_proof', proof: { needle: 'Mesurer le soleil du balcon chaque matin' } });
    expect(cut.beats.some((b) => b.kind === 'narrator' && b.proof)).toBe(false);
  });

  it('a narrator stands in every narrated cut, at every skill, with a page beside him only past a plain editor', () => {
    const pain = 'Si toi aussi tu te dis « rien ne pousse », reste deux secondes.';
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin', 'Le terreau du pot s’épuise vite en été'] })]);
    const script = (first: string): AdCreative['scenes'] => { const s = scenes(STEP, 'Un repère à garder : le terreau du pot s’épuise vite en été.'); return [s[0]!, { visual: '', onScreenText: '« rien ne pousse »', voiceover: first, durationSec: 3 }, ...s.slice(1)]; };
    for (const skill of [0, 0.09, 0.2, 0.35, 0.45, 0.9]) {
      const cut = plan(product, script(pain), skill, 'ugc_avatar');
      expect(cut.beats.filter((b) => b.kind === 'narrator').length, `skill ${skill}`).toBeGreaterThanOrEqual(2);
      expect(cut.beats.some((b) => b.kind === 'narrator' && b.proof), `skill ${skill}`).toBe(skill >= 0.4);
    }
    expect(plan(product, script('Rien ne pousse, et l’impression d’avoir tout essayé.'), 0.2, 'ugc_avatar').beats.some((b) => b.kind === 'narrator')).toBe(true); // no quote: still his to say
    for (const skill of [0.2, 0.9]) { // the scene after the hook is his, on what a faceless cut shows as a proof
      const unquoted = script('Rien ne pousse, et l’impression d’avoir tout essayé.').map((s, i) => (i === 1 ? { ...s, onScreenText: 'Rien ne pousse' } : s));
      expect(plan(product, unquoted, skill, 'ugc_avatar').beats.find((b) => b.scene === 1)!.kind, `skill ${skill}`).toBe('narrator');
      expect(plan(product, unquoted, skill).beats.find((b) => b.scene === 1)!.kind, `skill ${skill}`).not.toBe('narrator');
    }
  });

  it('marks what the viewer hears: the spoken line, not the script an editor cut', () => {
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin', 'Verser le terreau du pot avant les plantations'] })]);
    const long = `${STEP} Ensuite : verser le terreau du pot avant les plantations. Une étape à la fois.`;
    expect(plan(product, scenes(long, 'Un repère à garder.'), 0.9).beats[1]!.spoken).toBe(STEP);
    expect(plan(product, scenes(long, 'Un repère à garder.'), 0.9).beats[1]!.proof?.needle).toBe('Mesurer le soleil du balcon chaque matin');
  });

  it('of two lines the voice says, marks the one it says first, not the longest', () => {
    const first = 'Mesurer le soleil du balcon';
    const second = 'Noter les heures de plein soleil sur un carnet de bord';
    const product = guideOf([chapter({ steps: [second, first] })]);
    const voice = 'La méthode commence par un geste tout simple : mesurer le soleil du balcon, et noter les heures de plein soleil sur un carnet de bord.';
    expect(plan(product, scenes(voice, 'Un repère à garder.'), 0.9).beats[1]!.proof?.needle).toBe(first);
  });

  it('a lead-in opens every ad: it matches no line', () => {
    const product = guideOf([chapter({ paragraphs: ['La garder en tête au moment de l’étape concernée'], steps: ['Tailler les tomates une fois par semaine'] })]);
    const cut = plan(product, scenes(STEP, 'Un repère à garder en tête : le soleil tourne vite en été.'), 0.9);
    expect(cut.beats.map((b) => b.proof?.needle).filter(Boolean)).not.toContain('La garder en tête au moment de l’étape concernée');
    expect(cut.beats[2]!.kind).toBe('fact_card');
    expect(leadOut('Un repère à garder en tête : le soleil tourne.')).toBe('le soleil tourne.');
    expect(leadOut('La méthode commence par un geste tout simple : mesurer.')).toBe('mesurer.');
    expect(leadOut('Le plan tient en 8 mois.')).toBe('Le plan tient en 8 mois.');
  });

  it('a line too long for the marker is marked up to its first clause, as the page prints it', () => {
    const step = 'Identifier sa catégorie d’activité : vente, prestation commerciale ou prestation de service libérale';
    const product = guideOf([chapter({ steps: [step] })]);
    const cut = plan(product, scenes('La méthode commence par un geste tout simple : identifier sa catégorie d’activité.', 'Un repère à garder.'), 0.9);
    expect(cut.beats[1]!.proof?.needle).toBe('Identifier sa catégorie d’activité');
    expect(step.startsWith(cut.beats[1]!.proof!.needle)).toBe(true);
  });

  it('finds where the voice says a line, word by word, anchors on no small word', () => {
    const spoken = 'La méthode commence par un geste tout simple : mesurer le soleil de ton balcon chaque matin.'.split(' ');
    expect(saidSpan('Mesurer le soleil du balcon', spoken)).toEqual({ from: 9, to: 14 });
    expect(saidSpan('Tailler les tomates', spoken)).toBeNull();
    expect(saidSpan('L’ensoleillement du balcon', 'Il faut mesurer l’ensoleillement du balcon.'.split(' '))).toEqual({ from: 3, to: 5 });
  });

  it('a card that reads a buyer stays up long enough to read him, on a silent format', () => {
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin'] })]);
    const quote = 'J’avais tout lu sur internet sans résultat, ici il y a une vraie méthode et des checklists que je peux suivre';
    const short = plan(product, scenes(STEP, 'Un repère à garder.'), 0.9, 'text_slideshow').beats[2]!;
    const read = plan(product, scenes(STEP, `Un acheteur a écrit sur le guide : « ${quote} ».`), 0.9, 'text_slideshow').beats[2]!;
    expect(read.estSec).toBeGreaterThan(short.estSec + 2);
    expect(read.spoken).toBe('');
  });

  it('a scene where the voice reads a buyer stays a plate, without a page: its card is the proof', () => {
    const product = guideOf([chapter({ steps: ['Mesurer le soleil du balcon chaque matin'] })]);
    const cut = plan(product, scenes(STEP, 'Un acheteur a écrit sur le guide : « mesurer le soleil du balcon chaque matin a tout changé ».'), 0.9);
    expect(cut.beats[2]).toMatchObject({ kind: 'fact_card' });
    expect(cut.beats[2]!.proof).toBeUndefined();
    expect(reviewQuote('Un acheteur a écrit sur le guide : « très clair ».')).toBe('très clair');
    expect(reviewQuote('Si toi aussi tu te dis « rien ne pousse », reste deux secondes.')).toBeNull();
  });

  it('the league still reads the editor: below the page, on the page, past it', () => {
    for (const g of guides) {
      const craft = [0.1, 0.2, 0.3, 0.4, 0.6, 0.9].map((s) => scoreCut(cutFor(g, 'faceless_voiceover', s)).craft);
      expect([...craft].sort((a, b) => a - b)).toEqual(craft);
      expect(craft[5]! - craft[1]!).toBeGreaterThanOrEqual(40);
      expect(craft[3]! - craft[0]!).toBeGreaterThanOrEqual(35);
    }
  });
});

describe('reload', () => {
  it('a reload at any tick ends like a straight run, with cuts in the world', async () => {
    const play = async (reloadEvery: number): Promise<{ dump: string; cuts: number }> => {
      const l = await lab();
      let world = l.world;
      let company = l.company;
      for (let i = 1; i <= 15 * 12; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = l.reopen(world);
        }
      }
      const dump = JSON.stringify({ creatives: world.company.creatives, bandits: world.company.bandits, ledger: world.ledger.map((e) => [e.day, e.type, e.amount, e.ref]) });
      return { dump, cuts: world.company.creatives.filter((c) => c.cut).length };
    };
    const straight = await play(0);
    expect(straight.cuts).toBeGreaterThan(0);
    expect((await play(7)).dump === straight.dump).toBe(true);
  }, 120_000);
});
