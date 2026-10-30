/** What a buyer reads: follow-up guides, sales pages, hooks, lists. Each test comes from a defect found on real output. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentState, HookStyle, NicheBrief, PdfContent, Product, VoiceOfCustomer } from '../src/shared.js';
import type { MindContext, UpsellContext } from '../src/contracts.js';
import { createContentEngine, upsellTopics } from '../src/minds/index.js';
import { findCliches, heuristicHumanize } from '../src/minds/heuristic/editing.js';
import { screenText } from '../src/minds/heuristic/ads.js';
import { looksLikeClause } from '../src/minds/heuristic/niche.js';
import { parseKnowledge } from '../src/minds/heuristic/knowledge.js';
import { allText, clauseLabel, norm, seededRng, splitSentences } from '../src/minds/util.js';
import { createRng } from '../src/core/index.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { followUpLimit, priceCeiling } from '../src/runtime/metrics.js';
import { createMarketTools } from '../src/sim/index.js';
import { reviewText } from '../src/sim/feedback.js';
import { scorePdf, guideSubstance, untreatedPains } from '../src/sim/quality.js';
import { catalogNiche, NICHE_CATALOG } from '../src/sim/niches.js';
import { renderSalesPageHtml } from '../src/deliverables/index.js';
import { LEGACY } from './legacy.js';

const ALL_NICHES = NICHE_CATALOG.map((n) => n.id);
const heuristic = (seed = 7) => createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
const ctx = (over: Partial<MindContext> = {}): MindContext => ({
  agent: { id: 'ag', name: 'Margaux', role: 'Rédactrice', dept: 'studio', persona: '', skills: [], tools: [] } as unknown as AgentState,
  playbook: [], brainNotes: [], lessons: [], day: 3, ...over,
});

function research(seed: number, nicheId: string): { brief: NicheBrief; voc: VoiceOfCustomer } {
  const world = createWorld(defaultScenario({ ...LEGACY, seed }), `test-followups-${seed}`);
  const tools = createMarketTools(world, createRng(seed));
  return { brief: tools.nicheBrief(nicheId)!, voc: tools.minePains(nicheId, 'deep') };
}

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'prd_1', nicheId: 'sommeil-bebe', title: 'Un guide', subtitle: '', audience: 'Parents', problem: 'Un problème', price: 19, status: 'writing', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null,
    upsellProductId: null, createdDay: 1, launchedDay: null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [], ...over,
  };
}

/** Parent then follow-up of a niche, as the pipeline writes them. */
async function guides(nicheId: string, seed = 7): Promise<{ brief: NicheBrief; voc: VoiceOfCustomer; parent: PdfContent; follow: PdfContent; upsellOf: UpsellContext; item: Product }> {
  const { brief, voc } = research(seed, nicheId);
  const eng = heuristic(seed);
  const c = ctx();
  const write = async (b: NicheBrief, title: string, upsell: UpsellContext | null) => {
    const outline = await eng.writeOutline({ title, niche: b, voc, upsellOf: upsell }, c);
    const draft = await eng.writePdfContent({ title, outline, niche: b, voc, upsellTitle: null, upsellOf: upsell }, c);
    const human = await eng.humanize({ content: draft, flagged: findCliches(draft), voc }, c);
    return (await eng.factCheck({ content: human, voc }, c)).content;
  };
  const titles = await eng.writeTitles({ niche: brief, voc, count: 3 }, c);
  const parent = await write(brief, titles[0]!, null);
  const topic = upsellTopics(nicheId)[0]!;
  const upsellOf: UpsellContext = { parentTitle: titles[0]!, parentPromise: parent.promise, parentChapterTitles: parent.chapters.map((x) => x.title), topicId: topic.id };
  const follow = await write({ ...brief, problem: topic.pain, name: topic.title }, topic.title, upsellOf);
  return { brief, voc, parent, follow, upsellOf, item: product({ nicheId, title: topic.title, audience: brief.audience, problem: topic.pain, content: follow }) };
}

const proseOf = (p: PdfContent): string[] => [...p.introduction, ...p.chapters.flatMap((c) => [c.intro, ...c.paragraphs])];
const sentences = (p: PdfContent): Set<string> => new Set(proseOf(p).flatMap((t) => splitSentences(t)).map((s) => norm(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()).filter((s) => s.split(' ').length >= 5));
const allFixes = (): string[] => NICHE_CATALOG.flatMap((n) => n.voc.knowledge.mistakes.map((m) => m.split(' → ')[1]!));

describe('a follow-up guide is sold for what it contains (V-D1)', () => {
  it('its sales page has its own promise, plan length and pains', async () => {
    const { voc, follow, item, upsellOf } = await guides('urssaf-micro');
    const sp = await heuristic().writeSalesPage({ product: item, content: follow, voc, hype: 0.4, upsellOf }, ctx());
    const page = norm([sp.headline, sp.solution, ...sp.painBullets].join(' \n '));
    expect(page).toContain('plan de 12 mois');
    expect(page).toContain('premiere annee fiscale');
    expect(page).not.toContain('plan de 7 jours');
    expect(page).not.toContain('declaration en 10 minutes');
    expect(page).not.toMatch(/facture ou encaisse|bic bnc/);
  });

  it('a puppy left alone is not sold with quotes about puddles', async () => {
    const { voc, follow, item, upsellOf } = await guides('proprete-chiot');
    const sp = await heuristic().writeSalesPage({ product: item, content: follow, voc, hype: 0.4, upsellOf }, ctx());
    const text = norm([sp.headline, sp.solution, ...sp.painBullets].join(' \n '));
    expect(text).toMatch(/seul/);
    expect(text).not.toMatch(/pipi|flaque|propre en quelques semaines/);
  });

  it('every niche: the follow-up quotes its own sub-problem, its hooks promise its own outcome', async () => {
    for (const id of ALL_NICHES) {
      const { brief, voc, follow, item, upsellOf } = await guides(id);
      const hooks = await heuristic().writeAdHooks({ product: item, voc, styles: ['question', 'stat', 'pov', 'before_after', 'listicle'], upsellOf }, ctx());
      const parentOutcomes = voc.desiredOutcomes.map((o) => norm(o)).filter((o) => !norm(upsellOf.parentPromise).includes(o) && !norm(follow.promise).includes(o));
      for (const h of hooks) {
        expect(norm(h.hook), `${id} : ${h.hook}`).not.toContain('quotidien plus serein');
        for (const o of parentOutcomes) expect(norm(h.hook), `${id} : ${h.hook}`).not.toContain(o);
      }
      expect(brief.nicheId).toBe(id);
    }
  });

  it('a title that carries its own guillemets is never quoted twice', async () => {
    const { brief, voc } = research(7, 'dme-diversification');
    const item = product({ nicheId: brief.nicheId, title: '« La peur que bébé s’étouffe avec un morceau » : les 5 erreurs à éviter', audience: brief.audience, problem: brief.problem });
    const ad = await heuristic().writeAd({ product: item, voc, hook: 'Un hook', hookStyle: 'question', format: 'faceless_voiceover', bannedClaims: [] }, ctx());
    expect(allText(ad)).not.toMatch(/«\s*«/);
  });
});

describe('a follow-up is worth what it costs (V-D2)', () => {
  it('every chapter has a worked case, and the models of the research are printed', async () => {
    let cases = 0;
    for (const id of ALL_NICHES) {
      const { follow } = await guides(id);
      const s = guideSubstance(follow);
      cases += s.cases;
      expect(s.cases, id).toBeGreaterThanOrEqual(2);
      expect(s.words, id).toBeGreaterThanOrEqual(1250);
    }
    expect(cases / ALL_NICHES.length).toBeGreaterThanOrEqual(4);
  });

  it('the URSSAF calendar has monthly and quarterly rows with real deadlines', async () => {
    const { follow } = await guides('urssaf-micro');
    const g = follow.bonus.visual!.grid!;
    expect(g.rows.length).toBeGreaterThanOrEqual(10);
    for (const date of ['31 janvier', '30 avril', '31 juillet', '30 septembre', '31 octobre', '15 décembre']) expect(g.rows, date).toContain(date);
    expect(norm(JSON.stringify(g.cells))).toContain('mensuel');
    expect(norm(JSON.stringify(g.cells))).toContain('trimestriel');
    expect(allText(follow)).not.toContain('Date limite pour demander certaines options');
  });

  it('a follow-up is capped below a deeper guide, and never above it', async () => {
    const { parent, follow } = await guides('urssaf-micro');
    const world = createWorld(defaultScenario({ ...LEGACY, seed: 3 }), 'test-cap');
    const up = product({ id: 'prd_up', content: follow, nicheId: 'urssaf-micro' });
    const main = product({ id: 'prd_main', content: parent, nicheId: 'urssaf-micro', price: 24, upsellProductId: 'prd_up' });
    world.company.products.push(main, up);
    expect(followUpLimit(world, main)).toBeNull();
    expect(followUpLimit(world, up)).toBeLessThan(24);
    expect(priceCeiling(world, up).ceiling).toBeLessThan(24);
    up.content = { ...parent };
    expect(followUpLimit(world, up)).toBe(24);
  });

  it('the read time is no selling point, on the page or in the guide', () => {
    const source = ['src/deliverables/pdf.ts', 'src/deliverables/salesPage.ts', 'src/minds/heuristic/commerce.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(source).not.toMatch(/Se lit en|de lecture'|se lit en \$\{/);
  });
});

describe('a follow-up speaks the language of its subject (V-D3)', () => {
  it('less than 20 % of the prose is shared between two follow-ups, whatever the niches', async () => {
    const all: { id: string; s: Set<string> }[] = [];
    for (const id of ALL_NICHES) all.push({ id, s: sentences((await guides(id)).follow) });
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const common = [...a.s].filter((x) => b.s.has(x));
        expect(common.length / Math.min(a.s.size, b.s.size), `${a.id} / ${b.id} : ${common.slice(0, 5).join(' | ')}`).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('no habit advice in a tax guide, no canned quote anywhere', async () => {
    const { follow } = await guides('urssaf-micro');
    expect(allText(follow)).not.toMatch(/une seule observation|Demander à l’entourage|entourage|abandonné sans regret|testez-le pendant/);
    for (const id of ALL_NICHES) {
      const { parent, follow: f } = await guides(id);
      for (const ch of [...parent.chapters, ...f.chapters]) expect(JSON.stringify(ch.visual), id).not.toContain('Un imprévu ne défait pas');
    }
  });
});

describe('the DME guide is safe to follow (V-D4)', () => {
  it('the week example introduces one non-allergen food at a time', () => {
    const models = catalogNiche('dme-diversification')!.voc.knowledge.examples.filter((e) => /semaine simple/.test(e));
    expect(models).toHaveLength(1);
    expect(norm(models[0]!)).not.toMatch(/poisson|oeuf|arachide|lentilles|gluten/);
    expect(norm(models[0]!)).toContain('tous les 2 a 3 jours');
  });

  it('the rescue gesture is described, with a named source, and the promise no longer speaks of months', () => {
    const tips = catalogNiche('dme-diversification')!.voc.knowledge.tips.join(' ');
    expect(tips).toMatch(/Croix-Rouge française/);
    expect(tips).toMatch(/5 claques/);
    expect(tips).toMatch(/5 compressions/);
    expect(catalogNiche('dme-diversification')!.voc.desiredOutcomes.join(' ')).not.toMatch(/mois par mois/);
  });
});

describe('a list item stands on its own (V-D5)', () => {
  it('no fix of the research needs its mistake to be understood', () => {
    for (const fix of allFixes()) {
      expect(fix, fix).not.toMatch(/^(Le|La|Les|Lui|Leur|En|Y) (?!\d)[\p{L}’]+(er|ir|re)\b/u);
      expect(fix, fix).not.toMatch(/\b(cette|ce|ces) (sieste|place|budget)\b/);
      expect(fix, fix).not.toMatch(/\bavant\.$/);
    }
  });

  it('the errors chapter lists no fix as a step', async () => {
    const { parent, voc } = await guides('urssaf-micro');
    const errors = parent.chapters.find((c) => c.paragraphs.some((p) => /^Erreur n°/.test(p)))!;
    const fixes = parseKnowledge(voc.knowledge).core.pairs.map((p) => norm(p.fix ?? ''));
    for (const s of errors.steps) expect(fixes, s).not.toContain(norm(s));
  });
});

describe('hooks and screens are French and true (V-D6)', () => {
  it('a noun phrase with a relative clause is not a clause', () => {
    for (const s of ['la peur que bébé s’étouffe avec un morceau', 'le chiot qui pleure et fait des dégâts', 'Le chat qui griffe la porte']) expect(looksLikeClause(s), s).toBe(false);
    for (const s of ['bébé se réveille plusieurs fois par nuit', 'le chiot fait ses besoins partout', 'les plantations ne donnent presque rien']) expect(looksLikeClause(s), s).toBe(true);
  });

  it('two alike words joined by « ou » or « et » are never cut apart', () => {
    expect(clauseLabel('Le chiffre d’affaires se déclare mensuellement ou trimestriellement selon l’option', 46)).not.toBe('Le chiffre d’affaires se déclare mensuellement');
    expect(clauseLabel('Mélanger dépenses personnelles et professionnelles sur le même compte', 48)).not.toBe('Mélanger dépenses personnelles');
  });

  it('every niche: no noun phrase after « pourquoi », and a fact is whole on screen', async () => {
    const styles: HookStyle[] = ['question', 'pov', 'mistake', 'listicle'];
    for (const id of ALL_NICHES) {
      const { brief, voc } = research(7, id);
      const item = product({ nicheId: id, title: brief.name, audience: brief.audience, problem: brief.problem });
      for (let day = 1; day <= 8; day++) {
        for (const h of await heuristic().writeAdHooks({ product: item, voc, styles }, ctx({ day }))) {
          expect(h.hook, id).not.toMatch(/(pourquoi|quand|si) (la peur|le chiot qui|le chat qui|peur de)/i);
          const ad = await heuristic().writeAd({ product: item, voc, hook: h.hook, hookStyle: h.hookStyle, format: 'faceless_voiceover', bannedClaims: [] }, ctx({ day }));
          const proof = ad.scenes[3]!.onScreenText;
          const whole = voc.knowledge.facts.some((f) => norm(f).replace(/[.\s]+$/, '').startsWith(norm(proof).replace(/[.\s]+$/, ''))) ;
          if (/^(les?|la) /i.test(proof) && !/^« /.test(proof)) expect(whole && voc.knowledge.facts.some((f) => norm(f).replace(/[.\s]+$/, '') === norm(proof).replace(/[.\s]+$/, '')), `${id} : ${proof}`).toBe(true);
          expect(ad.scenes[3]!.voiceover, id).not.toContain('peu de gens connaissent');
        }
      }
    }
  });

  it('« tu » only takes over what belongs to the reader', async () => {
    const { brief, voc } = research(7, 'urssaf-micro');
    const item = product({ nicheId: brief.nicheId, title: brief.name, audience: brief.audience, problem: brief.problem });
    const texts: string[] = [];
    for (let day = 1; day <= 30; day++) texts.push(...(await heuristic().writeAdHooks({ product: item, voc, styles: ['contrarian', 'mistake'] }, ctx({ day }))).map((h) => h.hook));
    expect(texts.join(' ')).not.toMatch(/\bdans son budget\b/);
    const dme = research(7, 'dme-diversification');
    const baby = product({ nicheId: 'dme-diversification', title: dme.brief.name, audience: dme.brief.audience, problem: dme.brief.problem });
    const out: string[] = [];
    for (let day = 1; day <= 30; day++) out.push(...(await heuristic().writeAdHooks({ product: baby, voc: dme.voc, styles: ['contrarian', 'mistake'] }, ctx({ day }))).map((h) => h.hook));
    expect(out.join(' ')).not.toContain('finir ton assiette');
  });

  it('a stop keeps its limit on screen', () => {
    expect(screenText('Arrête de sortir les plants de tomates avant mi-mai. C’est ça qui entretient tout.')).toBe('Stop : sortir les plants de tomates avant mi-mai');
  });
});

describe('no template filler in a guide (V-D7)', () => {
  it('every niche: no bare label, no fake step, no double negative', async () => {
    for (const id of ALL_NICHES) {
      const { parent, follow } = await guides(id);
      for (const g of [parent, follow]) {
        const text = JSON.stringify(g);
        expect(text, id).not.toMatch(/Garder en vue|Écrire ce que vous ferez|Réponse notée|Je garde :|Exemple type : Si |Je ne fais plus : (ne|n['’])/);
      }
    }
  });

  it('the last chapter gives maintenance actions, not the method again', async () => {
    const { parent, voc } = await guides('relooker-meuble');
    const last = parent.chapters[parent.chapters.length - 1]!;
    expect(last.steps.join(' ')).toMatch(/chiffon|retouches/);
    const method = parseKnowledge(voc.knowledge).core.steps.map((s) => norm(s.text));
    for (const l of last.visual!.labels) expect(method, l).not.toContain(norm(l));
  });

  it('the how-to box follows the kind of guide', async () => {
    const meuble = await guides('relooker-meuble');
    expect(JSON.stringify(meuble.parent.howTo)).toContain('avant d’acheter');
    expect(JSON.stringify(meuble.follow.howTo)).not.toContain('Passez à la suite');
    const sommeil = await guides('sommeil-bebe');
    expect(JSON.stringify(sommeil.parent.howTo)).toContain('un chapitre à la fois');
  });
});

describe('a customer question gets its answer, or is not printed (V-D8)', () => {
  it('a quote is paired only with an item about the same thing', async () => {
    for (const id of ALL_NICHES) {
      const { voc, parent } = await guides(id);
      const gaps = { pains: untreatedPains(parent, voc), chapters: [] };
      const out = heuristicHumanize(parent, [], voc, seededRng(1, 'gaps'), gaps);
      for (const p of out.chapters.flatMap((c) => c.paragraphs).filter((x) => /^On lit souvent/.test(x))) {
        const [, quote, answer] = /^On lit souvent : « (.+?) »\. (.+)$/su.exec(p)!;
        const words = norm(quote!).split(/[^a-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
        const pointed = /plus haut : (.+)\.$/.exec(answer!)?.[1];
        const text = pointed ? out.chapters.flatMap((c) => c.paragraphs).find((x) => norm(x).startsWith(norm(pointed)))! : answer!;
        expect(words.some((w) => norm(text).includes(w)), p).toBe(true);
      }
    }
  });

  it('every pain of the research has an answer the writer can find', async () => {
    for (const id of ALL_NICHES) {
      const { voc, parent } = await guides(id);
      const out = heuristicHumanize(parent, [], voc, seededRng(1, 'all'), { pains: untreatedPains(parent, voc), chapters: [] });
      expect(untreatedPains(out, voc).length, `${id} : ${untreatedPains(out, voc).join(' | ')}`).toBeLessThanOrEqual(2);
    }
  });

  it('the furniture guide says which paint to buy', () => {
    const k = catalogNiche('relooker-meuble')!.voc.knowledge;
    const all = [...k.facts, ...k.tips].join(' ');
    for (const w of ['acrylique', 'craie', 'glycéro']) expect(all).toContain(w);
  });

  it('a printed question is the one its answer treats, on the real gap', () => {
    const niche = catalogNiche('relooker-meuble')!;
    const content = { title: 'T', subtitle: '', audience: '', promise: '', introduction: ['Intro.'], chapters: [{ title: 'Peinture', intro: 'Intro.', paragraphs: ['Un paragraphe.'], steps: [], example: null, checklist: [], visual: null }], bonus: { title: 'B', intro: 'B.', paragraphs: [], steps: [], example: null, checklist: [], visual: null }, nextStep: { title: '', text: '', upsellProductId: null }, wordCount: 0 } as PdfContent;
    const out = heuristicHumanize(content, [], niche.voc, seededRng(1, 'paint'), { pains: ['Je ne sais pas quelle peinture acheter (craie, acrylique, glycéro)'], chapters: [] });
    expect(out.chapters[0]!.paragraphs.join(' ')).toMatch(/acrylique pour un meuble de tous les jours/);
  });
});

describe('smaller leftovers (V-D9 to V-D13)', () => {
  it('V-D9: every error keeps its fix after a gap pass, every step is ticked', async () => {
    for (const id of ['sommeil-bebe', 'dme-diversification', 'proprete-chiot', 'relooker-meuble']) {
      const { voc, parent } = await guides(id);
      const out = heuristicHumanize(parent, [], voc, seededRng(1, id), { pains: voc.pains, chapters: [] });
      const errors = out.chapters.flatMap((c) => c.paragraphs).filter((p) => /^Erreur n°/.test(p));
      for (const e of errors) expect(e, id).toMatch(/À la place/);
      const method = out.chapters.find((c) => c.visual?.type === 'steps_diagram' && c.steps.length > 0)!;
      expect(method.checklist.length, id).toBe(method.steps.length);
    }
  });

  it('V-D10: nobody asks for « real cases » any more', () => {
    const empty = { title: 'T', subtitle: '', audience: '', promise: '', introduction: [], chapters: [1, 2, 3, 4, 5].map((i) => ({ title: `C${i}`, intro: 'I', paragraphs: ['P'], steps: [], example: null, checklist: [], visual: null })), bonus: { title: 'B', intro: 'B', paragraphs: [], steps: [], example: null, checklist: [], visual: null }, nextStep: { title: '', text: '', upsellProductId: null }, wordCount: 0 } as PdfContent;
    const issues = scorePdf(empty, { audience: 'a', problem: 'p' }).issues.join(' ');
    expect(issues).not.toMatch(/cas réels/);
    expect(issues).toMatch(/exemples types/);
    expect(readFileSync('src/runtime/roster.ts', 'utf8')).not.toContain('exemples réels');
    expect(readFileSync('src/sim/feedback.ts', 'utf8')).not.toContain('vraies familles');
  });

  it('V-D11: no timed result for a baby, no second review with the same sentence', () => {
    const outcomes = catalogNiche('sommeil-bebe')!.voc.desiredOutcomes.join(' ');
    expect(outcomes).not.toMatch(/10 minutes|6 à 8 heures/);
    expect(catalogNiche('urssaf-micro')!.voc.desiredOutcomes.join(' ')).not.toMatch(/10 minutes/);
    const p = product({ content: { chapters: [{ title: 'Chapitre' }] } as unknown as PdfContent });
    const niche = catalogNiche('sommeil-bebe')!;
    const rng = createRng(5);
    const heads: string[] = [];
    for (let i = 0; i < 7; i++) {
      const text = reviewText(rng, 5, p, niche);
      heads.push(text.slice(0, 14));
      p.stats.reviews.push({ id: `r${i}`, day: 1, customerId: 'c', rating: 5, text });
    }
    expect(new Set(heads).size).toBe(7);
  });

  it('V-D12: a pool with one named hook does not repeat it, and used hooks wait', async () => {
    const { brief, voc } = research(3, 'relooker-meuble');
    const item = product({ nicheId: brief.nicheId, title: brief.name, audience: brief.audience, problem: brief.problem });
    const seen = new Map<string, number>();
    for (let day = 1; day <= 14; day++) {
      const [h] = await heuristic().writeAdHooks({ product: item, voc, styles: ['before_after'] }, ctx({ day }));
      seen.set(h!.hook, (seen.get(h!.hook) ?? 0) + 1);
    }
    expect(Math.max(...seen.values())).toBeLessThan(14);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    const first = (await heuristic().writeAdHooks({ product: item, voc, styles: ['before_after'] }, ctx()))[0]!.hook;
    const next = (await heuristic().writeAdHooks({ product: item, voc, styles: ['before_after'], usedHooks: [first] }, ctx()))[0]!.hook;
    expect(next).not.toBe(first);
  });

  it('V-D13: a night is feminine, free days keep the latest rule, a procedure does not claim one step a day', async () => {
    const { parent } = await guides('sommeil-bebe');
    expect(allText(parent)).not.toMatch(/\bun nuit\b/);
    const chiot = await guides('proprete-chiot');
    const grid = chiot.parent.chapters.map((c) => c.visual?.grid).find((g) => g?.cells && g.rows[0] === 'Jour 1')!;
    const started: string[] = [];
    for (const row of grid.cells!) {
      const cell = String(row[0]);
      if (/^Démarrer/.test(cell)) started.push(cell);
      if (/^Continuer : /.test(cell)) expect(started.join(' '), cell).toContain(cell.replace('Continuer : ', ''));
      expect(cell).not.toMatch(/^Priorité/);
    }
    expect(allText((await guides('urssaf-micro')).parent)).not.toContain('Une étape par jour');
  });
});

describe('the sales page sells no reading time', () => {
  it('the facts of the page say what is inside', async () => {
    const { follow, item } = await guides('urssaf-micro');
    const html = renderSalesPageHtml({ product: { ...item, content: follow }, salesPage: { headline: 'H', subheadline: 'S', painBullets: [], solution: '', chapterBlurbs: [], bonusBlurb: '', objections: [], guarantee: '', cta: 'Je commence', hypeLevel: 0.3 }, coverSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', design: { palette: {} } as never, brand: 'Pixel' });
    expect(html).not.toMatch(/Se lit en/);
  });
});
