/**
 * What a buyer of a 39 € guide reads (pdf §9.2, §10) and what a writer's talent changes in it (talent §4.4). Numbered tests
 * are those of talent §11. Every sweep runs on the whole catalogue: a topic that misses the floor is named by the test.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentState, ChapterContent, NicheBrief, PdfContent, Product, Task, VisualSpec, VoiceOfCustomer } from '../src/shared.js';
import type { Craft, MindContext, UpsellContext } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { effortFor } from '../src/deliverables/effort.js';
import { normalizeDesign } from '../src/deliverables/design.js';
import { designFor } from '../src/deliverables/index.js';
import { paraBlock } from '../src/deliverables/layout/blocks.js';
import { renderPdf } from '../src/deliverables/pdf.js';
import { themeFor } from '../src/deliverables/pdfVisuals.js';
import { VOICES } from '../src/deliverables/voices.js';
import { createContentEngine, upsellTopics } from '../src/minds/index.js';
import { findCliches, heuristicHumanize } from '../src/minds/heuristic/editing.js';
import { parseKnowledge, type MethodStep } from '../src/minds/heuristic/knowledge.js';
import { buildPlan } from '../src/minds/heuristic/plan.js';
import { buildNicheCtx } from '../src/minds/heuristic/niche.js';
import { archetypeDef, heuristicPdfContent } from '../src/minds/heuristic/studio.js';
import { CLICHE_TEMPLATES } from '../src/minds/lexicon.js';
import { ensurePdf } from '../src/minds/shapes.js';
import { speakable } from '../src/minds/heuristic/voice.js';
import { allText, bare, endsDangling, lf, mapStrings, norm, q, seededRng } from '../src/minds/util.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { studioHandlers } from '../src/runtime/handlers/studio.js';
import { craftOf } from '../src/runtime/talent/craft.js';
import { createTask } from '../src/runtime/tasks.js';
import { createMarketTools } from '../src/sim/index.js';
import { NICHE_CATALOG } from '../src/sim/niches.js';
import { genericPhraseHits, guideSubstance, scorePdf } from '../src/sim/quality.js';
import { LEGACY } from './legacy.js';
import { pdfPagesText } from './pdfText.js';

const SEED = 7;
const ALL_NICHES = NICHE_CATALOG.map((n) => n.id);
const engineOf = (seed: number) => createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
const writer = { id: 'ecrivain', name: 'Léa', role: 'Rédactrice', dept: 'studio', persona: '', skills: [], tools: [], tier: 'sonnet', hiredDay: 0 } as unknown as AgentState;
const mindOn = (day = 3, craft?: Craft): MindContext => ({ agent: writer, playbook: [], brainNotes: [], lessons: [], day, ...(craft ? { craft } : {}) });

interface Guides { nicheId: string; brief: NicheBrief; voc: VoiceOfCustomer; parent: PdfContent; follow: PdfContent; topicId: string; upsellOf: UpsellContext; title: string }

function research(seed: number, nicheId: string): { brief: NicheBrief; voc: VoiceOfCustomer } {
  const world = createWorld(defaultScenario({ ...LEGACY, seed }), `test-content-${seed}`);
  const tools = createMarketTools(world, createRng(seed));
  return { brief: tools.nicheBrief(nicheId)!, voc: tools.minePains(nicheId, 'deep') };
}

/** Parent then follow-up of a niche, as the pipeline writes them: draft, humanizer, fact-checker. */
async function guidesOf(nicheId: string, seed = SEED): Promise<Guides> {
  const { brief, voc } = research(seed, nicheId);
  const eng = engineOf(seed);
  const mind = mindOn();
  const write = async (b: NicheBrief, title: string, upsell: UpsellContext | null) => {
    const outline = await eng.writeOutline({ title, niche: b, voc, upsellOf: upsell }, mind);
    const draft = await eng.writePdfContent({ title, outline, niche: b, voc, upsellTitle: null, upsellOf: upsell }, mind);
    const human = await eng.humanize({ content: draft, flagged: findCliches(draft), voc }, mind);
    return (await eng.factCheck({ content: human, voc }, mind)).content;
  };
  const title = (await eng.writeTitles({ niche: brief, voc, count: 3 }, mind))[0]!;
  const parent = await write(brief, title, null);
  const topic = upsellTopics(nicheId)[0]!;
  const upsellOf: UpsellContext = { parentTitle: title, parentPromise: parent.promise, parentChapterTitles: parent.chapters.map((c) => c.title), topicId: topic.id };
  const follow = await write({ ...brief, problem: topic.pain, name: topic.title }, topic.title, upsellOf);
  return { nicheId, brief, voc, parent, follow, topicId: topic.id, upsellOf, title };
}

let all: Guides[] = [];
beforeAll(async () => { for (const id of ALL_NICHES) all.push(await guidesOf(id)); }, 120_000);

const figuresOf = (g: PdfContent): VisualSpec[] => g.chapters.flatMap((c) => [c.visual, c.figure]).filter((v): v is VisualSpec => !!v);
const planGrids = (g: PdfContent) => g.chapters.map((c) => c.visual?.grid).filter((x): x is NonNullable<typeof x> => !!x?.cells);
const of = (g: PdfContent, type: VisualSpec['type']): VisualSpec[] => figuresOf(g).filter((v) => v.type === type);

/** The guide as printed, its diagrams aside: every sheet counts, a diagram has no right to prove itself. */
const proofText = (g: PdfContent): string => allText({ ...g, chapters: g.chapters.map((c) => ({ ...c, figure: null, visual: c.visual?.type === 'grid' ? c.visual : null })) });

const numbers = (s: string): string[] => s.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** Every number a diagram says, axes and rulers aside: those count, they claim nothing. */
function claimedNumbers(v: VisualSpec): string[] {
  const { cycle, plan, tree, pairs, matrix, gauge, path } = v;
  const tracks = plan?.tracks.map((t) => t.label) ?? [];
  return numbers(allText([v.title, v.labels, cycle?.nodes, cycle?.center, tracks, tree, pairs, matrix, gauge, path]));
}

// ───────────────────────────── worth 39 € ─────────────────────────────

describe('a follow-up is thick by structure (pdf §10.1)', () => {
  it('every topic of every niche: 2 300 words, 0.8 × the fresh words of its parent, 6 chapters', () => {
    expect(all).toHaveLength(16);
    for (const g of all) {
      const where = `${g.nicheId} / ${g.topicId}`;
      expect(g.follow.wordCount, where).toBeGreaterThanOrEqual(2300);
      expect(guideSubstance(g.follow).freshWords, where).toBeGreaterThanOrEqual(0.8 * guideSubstance(g.parent).freshWords);
      expect(g.follow.chapters.length, where).toBeGreaterThanOrEqual(6);
    }
  });

  it('whatever the research sampled: the same floors on other seeds', async () => {
    for (const seed of [3, 11]) {
      for (const id of ALL_NICHES) {
        const g = await guidesOf(id, seed);
        const where = `seed ${seed}, ${id}`;
        expect(g.follow.wordCount, where).toBeGreaterThanOrEqual(2300);
        expect(guideSubstance(g.follow).freshWords, where).toBeGreaterThanOrEqual(0.8 * guideSubstance(g.parent).freshWords);
      }
    }
  }, 120_000);

  it('the floor is never met by repeating text: no sentence printed twice, and the bulk is new to the reader', () => {
    for (const g of all) {
      const s = guideSubstance(g.follow);
      expect(s.repeatedSentences, g.nicheId).toEqual([]);
      expect(s.freshWords / s.words, g.nicheId).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('a guide on a free pain, with no prepared sub-problem, stays 5 chapters', async () => {
    const { brief, voc } = research(SEED, 'sommeil-bebe');
    const upsellOf: UpsellContext = { parentTitle: 'Un guide', parentPromise: 'une promesse', parentChapterTitles: [], topicId: 'aucun' };
    const outline = await engineOf(SEED).writeOutline({ title: 'Un autre guide', niche: { ...brief, problem: 'il refuse le biberon' }, voc, upsellOf }, mindOn());
    expect(outline.chapters).toHaveLength(5);
    expect(outline.chapters.map((c) => c.kind)).not.toContain('point-de-depart');
  });

  it('the starting point of a follow-up is its own sheet, never the bonus sheet printed a second time', () => {
    for (const g of all) {
      const start = g.follow.chapters[1]!;
      expect(start.visual?.type, g.nicheId).toBe('grid');
      expect(start.visual!.title, g.nicheId).not.toBe(g.follow.bonus.visual!.title);
      expect(start.visual!.grid!.rows.length, g.nicheId).toBeGreaterThanOrEqual(3);
      expect(start.steps.length, g.nicheId).toBeGreaterThanOrEqual(3);
      expect(start.paragraphs.length, g.nicheId).toBeGreaterThanOrEqual(2);
    }
  });

  it('every chapter of a follow-up has its worked case', () => {
    for (const g of all) expect(g.follow.chapters.filter((c) => (c.example ?? '').length > 40).length, g.nicheId).toBeGreaterThanOrEqual(5);
  });

  it('what was authored for a topic stays honest: no cliché, no claim the niche forbids, no reader statistic', () => {
    for (const g of all) {
      const text = allText(g.follow);
      expect(findCliches(g.follow), g.nicheId).toEqual([]);
      for (const b of g.voc.bannedClaims) expect(norm(text), `${g.nicheId} : ${b}`).not.toContain(norm(b));
      expect(text, g.nicheId).not.toMatch(/\d+\s*%\s+des\s+(lecteurs|parents|clients)/);
    }
  });

  it('a follow-up never prints the research of its parent', () => {
    for (const g of all) {
      const { core } = parseKnowledge(g.voc.knowledge);
      const text = norm(allText(g.follow));
      for (const f of core.facts) expect(text, `${g.nicheId} : ${f}`).not.toContain(norm(f).slice(0, 50));
    }
  });
});

describe('value blocks (pdf §10.3)', () => {
  it('a step\'s detail has its own run-in head, and it says the right thing: why, or how', () => {
    for (const g of all) {
      const method = [...g.parent.chapters, ...g.follow.chapters].filter((c) => c.visual?.type === 'step_path');
      expect(method.length, g.nicheId).toBe(2);
      for (const c of method) {
        const details = c.paragraphs.filter((p) => /^(Pourquoi ça marche|Comment faire) : /.test(p));
        expect(details.length, `${g.nicheId} : ${c.title}`).toBeGreaterThan(0);
        for (const p of details) if (p.startsWith('Pourquoi')) expect(p.slice(20).replace(/\b(?:chez|assez)\b/giu, ''), p).not.toMatch(/(?<![\p{L}’'])[\p{L}’']{2,}ez\b/u);
      }
    }
    expect(all.flatMap((g) => g.parent.chapters.flatMap((c) => c.paragraphs)).filter((p) => p.startsWith('Pourquoi ça marche : ')).length).toBeGreaterThan(30);
  });

  it('a ready-to-copy model is announced as one', () => {
    const models = all.flatMap((g) => [...g.parent.chapters, ...g.follow.chapters].flatMap((c) => c.paragraphs)).filter((p) => p.startsWith('Modèle à copier : '));
    expect(models.length).toBeGreaterThanOrEqual(all.length);
  });

  it('the annex holds every situation of the guide, plus the answers of its family', () => {
    for (const g of all) {
      const tree = of(g.parent, 'decision_tree')[0]!.tree!;
      const c = buildNicheCtx(g.brief, g.voc);
      const written = c.situations.slice(0, 6).map((s) => norm(s.what));
      const printed = tree.cases.map((k) => norm(k.then));
      for (const w of written) expect(printed, g.nicheId).toContain(w);
      for (const s of archetypeDef(c).situationsFallback) expect(printed, g.nicheId).toContain(norm(s.what));
    }
  });
});

// ───────────────────────────── the plan ─────────────────────────────

describe('the plan stops repeating itself (pdf §10.2)', () => {
  it('no catalogue plan has two identical adjacent rows', () => {
    let rows = 0;
    for (const g of all) {
      for (const grid of [...planGrids(g.parent), ...planGrids(g.follow)]) {
        rows += grid.cells!.length;
        grid.cells!.forEach((row, i) => {
          if (i && row[0]) expect(row[0], `${g.nicheId} : ligne ${i + 1}`).not.toBe(grid.cells![i - 1]![0]);
        });
      }
    }
    expect(rows).toBeGreaterThan(100);
  });

  it('a free day rotates through what is started, and says what to look at when it fits the cell', () => {
    const habits = all.filter((g) => archetypeDef(buildNicheCtx(g.brief, g.voc)).plan === 'parallele');
    expect(habits).toHaveLength(4);
    let looked = 0;
    for (const g of habits) {
      const cells = planGrids(g.parent).find((x) => x.cells!.length >= 8)!.cells!.map((r) => String(r[0]));
      const started: string[] = [];
      for (const cell of cells) {
        expect(cell, g.nicheId).not.toMatch(/^Continuer/);
        if (/^Démarrer/.test(cell)) started.push(cell);
        if (!/^Focus : /.test(cell)) continue;
        const action = cell.replace('Focus : ', '').split(' — ')[0]!;
        expect(started.join(' '), `${g.nicheId} : ${cell}`).toContain(action);
        if (cell.includes(' — ') && !cell.endsWith('noter ce qui a changé')) looked += 1;
      }
      const focus = cells.filter((x) => /^Focus : /.test(x));
      expect(new Set(focus).size, g.nicheId).toBeGreaterThan(1);
    }
    expect(looked).toBeGreaterThan(0);
  });

  it('the weekly and the final checks stay', () => {
    const cells = planGrids(all.find((g) => g.nicheId === 'chat-griffe-canape')!.parent).find((x) => x.cells!.length === 21)!.cells!.map((r) => String(r[0]));
    expect(cells[13]).toMatch(/^Bilan de la semaine/);
    expect(cells[20]).toMatch(/^Bilan final/);
  });

  it('with one step left, two free days in a row still differ', () => {
    const c = buildNicheCtx(all[0]!.brief, all[0]!.voc);
    const lone: MethodStep = { text: 'Tenir le rituel', detail: '', rank: 1, when: null, duration: null, diagnostic: false, from: 1, to: 14 };
    const grid = buildPlan({ ...c, method: [lone] }, { plan: 'parallele' } as never).sheet.cells!;
    grid.forEach((row, i) => { if (i) expect(row[0]).not.toBe(grid[i - 1]![0]); });
  });
});

describe('the plan figure (pdf §9.2, programme)', () => {
  it('every plan has its bars: the grid stays the visual, the path is the figure', () => {
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) {
        const ch = guide.chapters.find((c) => c.figure?.type === 'plan_path')!;
        expect(ch, g.nicheId).toBeDefined();
        expect(ch.visual?.type, g.nicheId).toBe('grid');
        const { days, tracks } = ch.figure!.plan!;
        expect(tracks.length, g.nicheId).toBeGreaterThan(0);
        for (const t of tracks) {
          expect(t.from, g.nicheId).toBeGreaterThanOrEqual(1);
          expect(t.to, g.nicheId).toBeGreaterThanOrEqual(t.from);
          expect(t.to, g.nicheId).toBeLessThanOrEqual(days);
        }
      }
    }
  });

  it('a track keeps the real span of its step', () => {
    const g = all.find((x) => x.nicheId === 'sommeil-bebe')!;
    const plan = of(g.parent, 'plan_path')[0]!.plan!;
    expect(plan).toMatchObject({ days: 14, unit: 'Nuit' });
    const c = buildNicheCtx(g.brief, g.voc);
    for (const m of c.method) expect(plan.tracks.some((t) => t.from === m.from && t.to === m.to), m.text).toBe(true);
  });

  it('an axis counts in the unit of its moments, whatever the title announces', () => {
    const plan = of(all.find((x) => x.nicheId === 'freelance-linkedin')!.parent, 'plan_path')[0]!.plan!;
    expect(plan).toMatchObject({ days: 8, unit: 'Semaine' });
  });

  it('moments that are no numbers go in reading order: no made-up date on the axis', () => {
    const plan = of(all.find((x) => x.nicheId === 'mariage-moins-10k')!.parent, 'plan_path')[0]!.plan!;
    expect(plan.unit).toBe('Étape');
    plan.tracks.forEach((t, i) => expect([t.from, t.to]).toEqual([i + 1, i + 1]));
    expect(plan.tracks[0]!.label).toMatch(/mois avant/);
  });
});

// ───────────────────────────── diagrams ─────────────────────────────

describe('each role has its diagram (pdf §9.2)', () => {
  it('a habit guide draws its loop as a loop, the link broken where the method attacks first', () => {
    for (const id of ['sommeil-bebe', 'proprete-chiot', 'chat-griffe-canape', 'ventre-apres-40']) {
      const g = all.find((x) => x.nicheId === id)!;
      const v = of(g.parent, 'cycle')[0]!;
      expect(v.cycle!.nodes, id).toEqual(v.labels);
      expect(v.cycle!.nodes.length, id).toBeGreaterThanOrEqual(3);
      expect(v.cycle!.breakAt, id).toBeLessThan(v.cycle!.nodes.length);
      expect(v.cycle!.center, id).toBeTruthy();
    }
    // its first step makes the sofa less pleasant: the loop breaks at « Le canapé est là, il griffe », not at the default
    expect(of(all.find((x) => x.nicheId === 'chat-griffe-canape')!.parent, 'cycle')[0]!.cycle!.breakAt).toBe(2);
  });

  it('a guide without a loop keeps its grid of whole labels', () => {
    for (const g of all.filter((x) => !['sommeil-bebe', 'proprete-chiot', 'chat-griffe-canape', 'ventre-apres-40'].includes(x.nicheId))) {
      expect(of(g.parent, 'cycle'), g.nicheId).toEqual([]);
      expect(of(g.parent, 'icon_grid').length, g.nicheId).toBeGreaterThan(0);
    }
    for (const g of all) expect(of(g.follow, 'cycle'), g.nicheId).toEqual([]);
  });

  it('a diagnostic has a blank gauge beside its sheet', () => {
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) {
        const ch = guide.chapters.find((c) => c.figure?.type === 'gauge')!;
        expect(ch, g.nicheId).toBeDefined();
        expect(ch.visual?.type, g.nicheId).toBe('grid');
        const { rows, low, high } = ch.figure!.gauge!;
        expect(rows.length, g.nicheId).toBeGreaterThan(0);
        expect(ch.figure!.values, g.nicheId).toEqual([]);
        expect(low && high, g.nicheId).toBeTruthy();
        for (const r of rows) expect(r, g.nicheId).not.toMatch(/\d/);
      }
    }
  });

  it('a ladder starts from the reader’s own problem: it never says again what the title of its figure said', () => {
    const generic = norm('Que faire dans ce cas ?');
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) {
        const v = of(guide, 'decision_tree')[0]!;
        const c = buildNicheCtx(g.brief, g.voc);
        expect(norm(v.tree!.question), g.nicheId).not.toBe(generic);
        expect(v.tree!.question, g.nicheId).toMatch(/quel cas ressemble au vôtre \?$/iu);
        expect(norm(v.tree!.question), g.nicheId).not.toBe(norm(v.title));
        if (guide === g.parent && c.pbShort) expect(norm(v.tree!.question), g.nicheId).toContain(norm(c.pbShort));
      }
    }
  });

  it('every cell of the matrix reads on its own, and no line comes twice', () => {
    let lines = 0;
    for (const g of all) {
      const { cells } = of(g.parent, 'matrix')[0]!.matrix!;
      const all4 = cells.flat();
      lines += all4.length;
      expect(new Set(all4.map(norm)).size, g.nicheId).toBe(all4.length);
      expect(cells.every((c) => c.length > 0), `${g.nicheId} : ${cells.map((c) => c.length).join()}`).toBe(true);
      for (const l of all4) {
        expect(endsDangling(l), `${g.nicheId} « ${l} »`).toBe(false);
        expect(l, g.nicheId).not.toMatch(/^(?:Il|Elle|Ils|Elles|On|Ce|C[’']|Ça|Cela|Son|Sa|Ses|Seuls?|Seules?)\b/u);
      }
    }
    expect(lines).toBeGreaterThan(all.length * 6);
  });

  it('a method is a line of stations, each with its real moment and duration, and nothing when it has none', () => {
    for (const g of all) {
      const c = buildNicheCtx(g.brief, g.voc);
      const { stations } = of(g.parent, 'step_path')[0]!.path!;
      expect(stations.map((s) => s.when), g.nicheId).toEqual(c.method.slice(0, 8).map((m) => m.when));
      expect(stations.map((s) => s.duration), g.nicheId).toEqual(c.method.slice(0, 8).map((m) => m.duration));
    }
    expect(of(all[0]!.parent, 'do_dont')).toEqual([]);
  });

  it('each mistake stays beside its own fix', () => {
    for (const g of all) {
      const { pairs } = of(g.parent, 'before_after')[0]!;
      const c = buildNicheCtx(g.brief, g.voc);
      expect(pairs!.length, g.nicheId).toBeGreaterThanOrEqual(1);
      for (const p of pairs!) {
        const own = c.pairs.find((x) => norm(x.mistake) === norm(p.before));
        expect(own, p.before).toBeDefined();
        if (own!.fix) expect(norm(own!.fix)).toContain(norm(p.after));
      }
    }
  });

  it('a choice is a ladder of « Si … », with the answer on each rung', () => {
    for (const g of all) {
      const tree = of(g.follow, 'decision_tree')[0]!.tree!;
      expect(tree.question, g.nicheId).toBeTruthy();
      expect(tree.cases.length, g.nicheId).toBeGreaterThanOrEqual(3);
      for (const k of tree.cases) {
        expect(k.when, g.nicheId).toMatch(/^Si /);
        expect(k.then.length, g.nicheId).toBeGreaterThan(10);
      }
    }
  });

  it('a last chapter is four lists of words, under its four heads', () => {
    for (const g of all) {
      const m = of(g.parent, 'matrix')[0]!.matrix!;
      expect(m.heads, g.nicheId).toEqual(['À garder', 'À arrêter', 'À tester', 'À surveiller']);
      expect(m.cells.filter((c) => c.length).length, g.nicheId).toBeGreaterThanOrEqual(3);
      for (const l of m.cells.flat()) expect(l, g.nicheId).not.toMatch(/\d/);
    }
  });

  it('`labels` keep a plain version of every diagram', () => {
    for (const g of all) for (const guide of [g.parent, g.follow]) for (const v of figuresOf(guide)) if (v.type !== 'grid') expect(v.labels.length, `${g.nicheId} : ${v.type}`).toBeGreaterThan(0);
  });

  it('every digit of a figure exists in the guide', () => {
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) {
        const known = new Set(numbers(proofText(guide)));
        for (const v of figuresOf(guide)) {
          if (v.type === 'grid') continue;
          for (const n of claimedNumbers(v)) expect(known.has(n), `${g.nicheId} : ${v.type} dit ${n}`).toBe(true);
        }
      }
    }
  });

  it('diagrams and the rail survive the second pass and the fact-checker', () => {
    for (const g of all) {
      const types = new Set(figuresOf(g.parent).map((v) => v.type));
      for (const t of ['step_path', 'before_after', 'decision_tree', 'matrix', 'gauge', 'plan_path'] as const) expect(types.has(t), `${g.nicheId} : ${t}`).toBe(true);
    }
    expect(all.flatMap((g) => g.parent.chapters).some((c) => !!c.margin)).toBe(true);
  });

  it('a save from before stays readable: new fields are optional, an old guide comes through unchanged', () => {
    const old: ChapterContent = { title: 'T', intro: 'I', paragraphs: ['P'], steps: ['a', 'b', 'c'], example: null, checklist: ['x', 'y'], visual: { type: 'do_dont', title: 'D', labels: ['À faire : x', 'À éviter : y'], values: [] } };
    const out = ensurePdf({ title: 'G', chapters: [old], bonus: old }).chapters[0]!;
    expect(out).toEqual(old);
  });
});

describe('the rail (pdf §9.2)', () => {
  it('a margin quote is a customer\'s words, whole, or nothing', () => {
    let quotes = 0;
    for (const g of all) {
      for (const q of g.parent.chapters.flatMap((c) => (c.margin?.quote ? [c.margin.quote] : []))) {
        quotes += 1;
        expect(g.voc.phrases.map((p) => norm(bare(speakable(p)))), q).toContain(norm(bare(q)));
      }
    }
    expect(quotes).toBeGreaterThan(0);
  });

  it('a margin note adds what the page does not say: research the text never used', () => {
    let notes = 0;
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) {
        const text = norm(allText({ ...guide, chapters: guide.chapters.map((c) => ({ ...c, margin: null })) }));
        for (const c of guide.chapters) {
          if (!c.margin?.note) continue;
          notes += 1;
          expect(text, c.margin.note).not.toContain(norm(c.margin.note).slice(0, 40));
        }
      }
    }
    expect(notes).toBeGreaterThan(0);
  });
});

describe('what a proofreader would circle', () => {
  it('a verbatim that ends on a quoted word keeps both its marks, and only the quotes around the whole text go', () => {
    expect(bare('On a peur que le mariage fasse “cheap”')).toBe('On a peur que le mariage fasse “cheap”');
    expect(q(lf('On a peur que le mariage fasse “cheap”'))).toBe('« on a peur que le mariage fasse “cheap” »');
    expect(bare('Il répète “ça va passer”.')).toBe('Il répète “ça va passer”');
    expect(bare('“cheap”')).toBe('cheap');
    expect(bare('fasse cheap”')).toBe('fasse cheap');
    expect(bare('viser « toutes les entreprises »')).toBe('viser « toutes les entreprises »');
    expect(bare('« viser les entreprises »')).toBe('viser les entreprises');
  });

  it('a mark answered inside the text belongs to it, and a doubled closing mark loses only what is spare', () => {
    expect(bare('“Bio” ne veut rien dire.')).toBe('“Bio” ne veut rien dire');
    expect(bare('« Bio » ne veut rien dire')).toBe('« Bio » ne veut rien dire');
    expect(bare('“ça va” et “ça vient”')).toBe('“ça va” et “ça vient”');
    expect(bare('il répète “oui””')).toBe('il répète “oui”');
    expect(bare('« viser « toutes les entreprises » »')).toBe('viser « toutes les entreprises »');
    expect(bare('il répète « oui » »')).toBe('il répète « oui »');
  });

  it('no guide of the catalogue prints half a pair of quotes', () => {
    const pair = (s: string, where: string): string => {
      expect((s.match(/“/g) ?? []).length, `${where} : ${s}`).toBe((s.match(/”/g) ?? []).length);
      return s;
    };
    expect(allText(all.map((g) => [g.parent, g.follow]))).toContain('“');
    for (const g of all) for (const guide of [g.parent, g.follow]) mapStrings(guide, (s) => pair(s, g.nicheId));
  });

  it('a cliché of the draft stays, and never takes a step of the ladder out of its bold', () => {
    const theme = themeFor(normalizeDesign(designFor({ nicheName: 'Propreté du chiot', category: 'animaux', seed: 3 })), VOICES.conte);
    const texts = CLICHE_TEMPLATES.map((t) => t.replace(/[.]/g, '\\.').replace('{sujet}', '\\S+').replace('{diff}', '\\S+'));
    const opening = new RegExp(`^(?:${texts.join('|')})\\s+`, 'u');
    const closing = new RegExp(`\\s(?:${texts.join('|')})$`, 'u');
    const outline = { title: 'Un titre', chapters: [], bonusTitle: '', nextStepTitle: '' };
    let first = 0;
    let last = 0;
    let headed = 0;
    let draws = 0;
    for (const seed of [3, 7, 13, 42]) {
      for (const id of ALL_NICHES) {
        const { brief, voc } = research(seed, id);
        const rng = seededRng(seed, 'draft', id);
        const counted = { ...rng, chance: (p: number) => { if (p === 0.35) draws += 1; return rng.chance(p); } };
        const draft = heuristicPdfContent({ title: 'Un titre', outline, niche: brief, voc, upsellTitle: null }, counted, { banned: [] });
        for (const p of [...draft.introduction, ...draft.chapters.flatMap((c) => c.paragraphs)]) {
          const open = opening.exec(p);
          if (open) {
            first += 1;
            expect(paraBlock(p.slice(open[0].length), theme)?.head, p).toBeUndefined();
          }
          if (closing.test(p)) {
            last += 1;
            if (paraBlock(p, theme)?.head) headed += 1;
          }
        }
      }
    }
    expect(first).toBeGreaterThan(0); // the flaw still opens a paragraph where it harms nothing
    expect(headed).toBeGreaterThan(0); // and closes the ones that open on a head
    expect(last).toBeGreaterThan(first);
    expect(draws).toBeGreaterThanOrEqual(first + last); // one draw per cliché, wherever it lands: the stream does not shift
  }, 60_000);

  it('the wedding’s words stay in the wedding guide: a trip has nobody to contact and no quote to check', () => {
    const printed = (nicheId: string): string => {
      const { parent } = all.find((g) => g.nicheId === nicheId)!;
      return allText({ howTo: parent.howTo, titles: parent.chapters.map((c) => c.title), steps: parent.chapters.map((c) => c.steps) });
    };
    expect(printed('mariage-moins-10k')).toContain('contacter qui que ce soit');
    expect(printed('mariage-moins-10k')).toContain('Vérifier le devis');
    expect(printed('japon-petit-budget')).not.toMatch(/contacter qui que ce soit|le devis/);
    expect(printed('japon-petit-budget')).toContain('réserver quoi que ce soit');
  });
});

describe('on the page (pdf §10.4)', () => {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'content-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('no printed line starts with « Fait : », and every new diagram prints without a defect', async () => {
    const seen = new Set<string>();
    for (const g of all.slice(0, 4)) {
      for (const content of [g.parent, g.follow]) {
        const product = { id: 'prd_1', title: content.title, subtitle: content.subtitle, audience: content.audience, problem: g.brief.problem, content, price: 19, files: {}, stats: { rating: 0, reviews: [] } } as unknown as Product;
        const design = designFor({ nicheName: g.brief.name, category: g.brief.category, seed: 3 });
        const out = join(dir, `${g.nicheId}-${content === g.follow ? 'f' : 'p'}.pdf`);
        const res = await renderPdf({ product, content, design, brand: 'Pixel Agency', outFile: out, upsell: null });
        expect(res.audit.overflow, g.nicheId).toBe(0);
        expect(res.audit.strandedHeadings, g.nicheId).toBe(0);
        const text = pdfPagesText(out).join(' ');
        expect(text.match(/(?<![\p{L}])(?:Fait|Je ne fais plus)\s*:\s/gu) ?? [], g.nicheId).toEqual([]);
        expect(text.toLowerCase(), g.nicheId).toContain('à arrêter');
        for (const v of figuresOf(content)) seen.add(v.type);
      }
    }
    expect(seen).toEqual(expect.objectContaining(new Set(['cycle', 'gauge', 'step_path', 'before_after', 'decision_tree', 'plan_path', 'matrix', 'grid'])));
  }, 60_000);
});

// ───────────────────────────── talent §4.4 ─────────────────────────────

/** A draft of a catalogue niche as this writer hands it in: `heuristicPdfContent` itself, without the humanizer. */
function draftOf(id: string, i: number, flaw: number): { content: PdfContent; plain: PdfContent } {
  const { brief, voc } = research(SEED, id);
  const outline = { title: 'Un titre', chapters: [], bonusTitle: '', nextStepTitle: '' };
  const write = (o: { flaw?: number; flawRng?: ReturnType<typeof seededRng> }) => heuristicPdfContent({ title: 'Un titre', outline, niche: brief, voc, upsellTitle: null }, seededRng(SEED, 'draft', i), { banned: [], ...o });
  return { content: write({ flaw, flawRng: seededRng(SEED, 'flaw', i) }), plain: write({}) };
}

describe('`longform`: what a writer leaves in a guide (talent §4.4)', () => {
  it('without talent the text is the same with or without a flaw stream: a lever at 0 is no lever', () => {
    const { brief, voc } = research(SEED, 'urssaf-micro');
    const outline = { title: 'T', chapters: [], bonusTitle: '', nextStepTitle: '' };
    const a = heuristicPdfContent({ title: 'T', outline, niche: brief, voc, upsellTitle: null }, seededRng(1, 'x'), { banned: [] });
    const b = heuristicPdfContent({ title: 'T', outline, niche: brief, voc, upsellTitle: null }, seededRng(1, 'x'), { banned: [], flaw: 0, flawRng: seededRng(1, 'flaw') });
    expect(b).toEqual(a);
  });

  it('a heavy flaw adds real clichés: `humanTone` reads them', () => {
    const { content, plain } = draftOf('urssaf-micro', 1, 0.9);
    const hits = (c: PdfContent) => genericPhraseHits(norm(allText(c.chapters.flatMap((x) => x.paragraphs)))).total;
    expect(hits(content)).toBeGreaterThan(hits(plain) + 1);
    const { brief, voc } = research(SEED, 'urssaf-micro');
    const q = (c: PdfContent) => scorePdf(c, { audience: brief.audience, problem: brief.problem, voc });
    expect(q(content).humanTone).toBeLessThan(q(plain).humanTone);
  });

  it('half as often, a chapter loses its example', () => {
    let lost = 0;
    let stripped = 0;
    for (let i = 0; i < 12; i++) {
      const { content, plain } = draftOf('sommeil-bebe', i, 0.5);
      content.chapters.forEach((c, k) => {
        if (plain.chapters[k]!.example && !c.example) lost += 1;
        if (c.steps.join(' ') !== plain.chapters[k]!.steps.join(' ')) stripped += 1;
      });
    }
    expect(lost).toBeGreaterThan(0);
    expect(stripped).toBeGreaterThan(lost);
  });

  it('a chapter that lost its durations says less about how long: `actionability` reads it, and the French holds', () => {
    let fell = 0;
    for (const id of ALL_NICHES) {
      const { brief, voc } = research(SEED, id);
      const outline = { title: 'T', chapters: [], bonusTitle: '', nextStepTitle: '' };
      const always = { ...seededRng(1, 'all'), chance: () => true };
      const content = heuristicPdfContent({ title: 'T', outline, niche: brief, voc, upsellTitle: null }, seededRng(1, 'x'), { banned: [], flaw: 1, flawRng: always });
      const plain = heuristicPdfContent({ title: 'T', outline, niche: brief, voc, upsellTitle: null }, seededRng(1, 'x'), { banned: [] });
      const [a, b] = [guideSubstance(content).concreteSteps, guideSubstance(plain).concreteSteps];
      expect(a, id).toBeLessThanOrEqual(b);
      if (a < b) fell += 1;
      expect(content.chapters.every((c) => c.example === null), id).toBe(true);
      for (const s of content.chapters.flatMap((c) => c.steps)) expect(s, id).not.toMatch(/(?:^|\s)(?:de|à|en|pendant|sur|pour)\s*[,.]|\s[,.]/u);
    }
    expect(fell).toBeGreaterThanOrEqual(8);
  });
});

/** A live company with a written guide: the handlers of the studio on the real engine. */
async function live(seed = SEED) {
  const world = createWorld(defaultScenario({ ...LEGACY, seed }), `test-studio-${seed}`);
  const niche = NICHE_CATALOG.find((n) => n.id === 'sommeil-bebe')!;
  const product = { id: 'prd_1', nicheId: niche.id, title: 'Bébé se réveille plusieurs fois par nuit : la méthode douce', subtitle: '', audience: niche.audience, problem: niche.problem, price: 19, status: 'writing', version: 1, content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: null, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [] } as unknown as Product;
  world.company.products.push(product);
  world.company.research.voc[niche.id] = niche.voc;
  const engine = engineOf(seed);
  const ctx = { world, engine, brain: { addNote: async () => undefined, search: async () => [] }, say: () => undefined } as unknown as RuntimeCtx;
  const brief: NicheBrief = { nicheId: niche.id, name: niche.name, audience: niche.audience, problem: niche.problem, category: niche.category, keywords: niche.keywords };
  const outline = await engine.writeOutline({ title: product.title, niche: brief, voc: niche.voc }, mindOn());
  return { world, ctx, engine, product, voc: niche.voc, brief, outline };
}

const planted = (content: PdfContent, phrases: readonly string[]): PdfContent => ({
  ...content,
  chapters: content.chapters.map((c) => ({ ...c, paragraphs: [...c.paragraphs, ...phrases] })),
});

/** `humanize_pdf` at talent `t` on a guide with planted clichés; `null` is an editor without talent. `passes` counts the calls the handler made. */
async function polish(t: number | null, seed: number) {
  const { world, ctx, engine, product, voc, brief, outline } = await live(seed);
  const clean = await engine.writePdfContent({ title: product.title, outline, niche: brief, voc, upsellTitle: null }, mindOn(seed));
  const stripped = await engine.humanize({ content: clean, flagged: findCliches(clean), voc }, mindOn(seed));
  product.content = planted(stripped, CLICHE_TEMPLATES.filter((x) => !x.includes('{')));
  let passes = 0;
  ctx.engine = new Proxy(engine, { get: (e, k) => (k === 'humanize' ? (input: Parameters<typeof engine.humanize>[0], m: MindContext) => { passes += 1; return e.humanize(input, m); } : Reflect.get(e, k)) });
  const task = createTask(world, { kind: 'humanize_pdf', input: { productId: product.id } });
  const out = await studioHandlers.humanize_pdf!.run(ctx, task, writer, mindOn(seed, t === null ? undefined : craftOf('polish', t, 'sonnet')));
  return { product, output: out.output as { flagged: number; left?: number }, passes };
}

async function polished(t: number, seed: number): Promise<number> {
  const { product } = await polish(t, seed);
  return genericPhraseHits(norm(allText(product.content!.chapters.flatMap((c) => c.paragraphs)))).total;
}

describe('`polish`: the passes run, and since D144 they print the same guide (talent §4.4)', () => {
  // D144: `polish` is flawless, its `reach` is 1 at any t, so the first pass takes every flat sentence it sees.
  it('8. on a guide with planted clichés, none stays after humanize_pdf, at t=.1 as at t=.9: a weak hand leaves nothing behind', async () => {
    for (const seed of [1, 2, 3]) {
      for (const t of [0.1, 0.3, 0.5, 0.9]) expect(await polished(t, seed), `t=${t}, seed ${seed}`).toBe(0);
    }
  }, 60_000);

  it('without a reach, one pass fixes everything it sees: an editor without talent reads as today', () => {
    const { voc } = research(SEED, 'sommeil-bebe');
    const content = { ...all[0]!.parent, chapters: all[0]!.parent.chapters.map((c) => ({ ...c, paragraphs: [...c.paragraphs, 'Soyez patient. Prenez soin de vous.'] })) };
    const out = heuristicHumanize(content, [], voc, seededRng(1, 'h'));
    expect(findCliches(out)).toEqual([]);
    const missed = heuristicHumanize(content, [], voc, seededRng(1, 'h'), null, { reach: 0, flawRng: seededRng(1, 'r') });
    expect(findCliches(missed).length).toBeGreaterThanOrEqual(content.chapters.length);
  });

  it('one roll per flat text: a list item is fixed at `reach`, like a sentence of prose', () => {
    const { voc } = research(SEED, 'sommeil-bebe');
    const chapter = all[0]!.parent.chapters[0]!;
    const content = {
      ...all[0]!.parent,
      chapters: [{ ...chapter, paragraphs: [`${chapter.paragraphs[0]} Prenez soin de vous. Le soir, gardez la même routine.`], checklist: ['Soyez patient.', 'Noter l’heure du coucher.'] }],
    };
    const rates = (reach: number, voice: VoiceOfCustomer): { list: number; prose: number } => {
      const rolls = 400;
      let list = 0;
      let prose = 0;
      for (let i = 0; i < rolls; i++) {
        const c = heuristicHumanize(content, [], voice, seededRng(i, 'h'), null, { reach, flawRng: seededRng(i, 'roll') }).chapters[0]!;
        if (!c.checklist.includes('Soyez patient.')) list += 1;
        if (!c.paragraphs.join(' ').includes('Prenez soin de vous')) prose += 1;
      }
      return { list: list / rolls, prose: prose / rolls };
    };
    for (const reach of [0.58, 0.76, 0.94]) {
      const { list, prose } = rates(reach, voc);
      expect(Math.abs(list - reach), `liste à ${reach} : ${list}`).toBeLessThan(0.06);
      expect(Math.abs(prose - reach), `prose à ${reach} : ${prose}`).toBeLessThan(0.06);
    }
    // nothing to replace it with, the sentence goes: still one roll
    const dry = rates(0.5, { ...voc, knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] } });
    expect(Math.abs(dry.list - 0.5), `sans réserve : ${dry.list}`).toBeLessThan(0.06);
  }, 60_000);

  it('what an editor leaves is on the task: `left` reads 0 at any t, and talent only buys passes that print the same guide', async () => {
    for (const seed of [1, 2, 3]) {
      const none = await polish(null, seed);
      expect(none.output.flagged).toBeGreaterThan(0);
      expect(none.output.left).toBe(0);
      for (const [t, passes] of [[0.1, 1], [0.3, 1], [0.5, 2], [0.8, 3], [0.9, 3]] as const) {
        const at = await polish(t, seed);
        expect(at.output, `t=${t}, seed ${seed}`).toMatchObject({ flagged: none.output.flagged, left: 0 });
        expect(at.passes, `t=${t}, seed ${seed}`).toBe(passes);
        expect(at.product.content, `t=${t}, seed ${seed}`).toEqual(none.product.content);
      }
    }
  }, 120_000);

  it('a pass that was dropped left everything, the task says so', async () => {
    const { world, ctx, engine, product, voc, brief, outline } = await live();
    product.content = planted(await engine.writePdfContent({ title: product.title, outline, niche: brief, voc, upsellTitle: null }, mindOn()), ['Soyez patient.']);
    ctx.engine = new Proxy(engine, { get: (e, k) => (k === 'humanize' ? async (input: { content: PdfContent }) => ({ ...input.content, chapters: input.content.chapters.slice(0, 2) }) : Reflect.get(e, k)) });
    const out = await studioHandlers.humanize_pdf!.run(ctx, createTask(world, { kind: 'humanize_pdf', input: { productId: product.id } }), writer, mindOn(4, craftOf('polish', 0.9, 'sonnet')));
    expect(out.output).toMatchObject({ kept: false, left: 1 });
  }, 30_000);

  it('`passes` humanize calls at most, each its own draw, the first one with the gaps', async () => {
    const { world, ctx, engine, product, voc, brief, outline } = await live();
    product.content = await engine.writePdfContent({ title: product.title, outline, niche: brief, voc, upsellTitle: null }, mindOn());
    const calls: { draw: number | undefined; gaps: boolean }[] = [];
    ctx.engine = new Proxy(engine, { get: (e, k) => (k === 'humanize' ? (input: Parameters<typeof engine.humanize>[0], m: MindContext) => { calls.push({ draw: m.draw, gaps: !!input.gaps }); return e.humanize(input, m); } : Reflect.get(e, k)) });
    const task = createTask(world, { kind: 'humanize_pdf', input: { productId: product.id, gaps: { pains: [], chapters: [] } } });
    await studioHandlers.humanize_pdf!.run(ctx, task, writer, mindOn(4, craftOf('polish', 0.9, 'sonnet')));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.map((c) => c.draw)).toEqual([undefined, 1, 2].slice(0, calls.length));
    expect(calls.map((c) => c.gaps)).toEqual([true, false, false].slice(0, calls.length));
  }, 30_000);

  it('a pass that lowers the score is dropped, the guide stays the previous one', async () => {
    const { world, ctx, engine, product, voc, brief, outline } = await live();
    const before = await engine.writePdfContent({ title: product.title, outline, niche: brief, voc, upsellTitle: null }, mindOn());
    product.content = before;
    ctx.engine = new Proxy(engine, { get: (e, k) => (k === 'humanize' ? async (input: { content: PdfContent }) => ({ ...input.content, chapters: input.content.chapters.slice(0, 2) }) : Reflect.get(e, k)) });
    const task = createTask(world, { kind: 'humanize_pdf', input: { productId: product.id } });
    const out = await studioHandlers.humanize_pdf!.run(ctx, task, writer, mindOn(4, craftOf('polish', 0.9, 'sonnet')));
    expect(product.content).toBe(before);
    expect(out.output?.kept).toBe(false);
  }, 30_000);

  it('Claude writes one pass: `passes` is a heuristic lever, a pass there costs money', async () => {
    const { world, ctx, engine, product, voc, brief, outline } = await live();
    product.content = await engine.writePdfContent({ title: product.title, outline, niche: brief, voc, upsellTitle: null }, mindOn());
    let calls = 0;
    ctx.engine = new Proxy(engine, { get: (e, k) => (k === 'mode' ? 'claude' : k === 'humanize' ? (input: Parameters<typeof engine.humanize>[0], m: MindContext) => { calls++; return e.humanize(input, m); } : Reflect.get(e, k)) });
    await studioHandlers.humanize_pdf!.run(ctx, createTask(world, { kind: 'humanize_pdf', input: { productId: product.id } }), writer, mindOn(4, craftOf('polish', 0.9, 'sonnet')));
    expect(calls).toBe(1);
  }, 30_000);
});

describe('write_pdf keeps its best draft (talent §4.4)', () => {
  const firstDraft = async (craft?: Craft, attempts = 0): Promise<{ draws: (number | undefined)[]; flaws: (number | undefined)[]; product: Product }> => {
    const { world, ctx, engine, product } = await live();
    const draws: (number | undefined)[] = [];
    const flaws: (number | undefined)[] = [];
    ctx.engine = new Proxy(engine, { get: (e, k) => (k === 'writePdfContent' ? (input: Parameters<typeof engine.writePdfContent>[0], m: MindContext) => { draws.push(m.draw); flaws.push(m.craft?.flaw); return e.writePdfContent(input, m); } : Reflect.get(e, k)) });
    const task = createTask(world, { kind: 'write_pdf', input: { productId: product.id } }) as Task;
    task.attempts = attempts;
    await studioHandlers.write_pdf!.run(ctx, task, writer, mindOn(4, craft));
    return { draws, flaws, product };
  };

  it('a strong writer drafts several versions, draft 0 first', async () => {
    const craft = craftOf('longform', 0.9, 'sonnet');
    const { draws, product } = await firstDraft(craft);
    expect(draws).toEqual([undefined, 1, 2].slice(0, craft.draws));
    expect(product.content!.chapters.length).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it('without craft a task is one draft, as before', async () => {
    expect((await firstDraft()).draws).toEqual([undefined]);
  }, 30_000);

  it('the talent of a guide shows in its score, on the market\'s own scorer', async () => {
    const score = async (t: number): Promise<number> => {
      const { world, ctx, product, voc, brief } = await live();
      await studioHandlers.write_pdf!.run(ctx, createTask(world, { kind: 'write_pdf', input: { productId: product.id } }), writer, mindOn(4, craftOf('longform', t, 'sonnet')));
      return scorePdf(product.content!, { audience: brief.audience, problem: brief.problem, voc }).overall;
    };
    expect(await score(0.9)).toBeGreaterThan(await score(0.1));
  }, 60_000);
});

/** What a chapter prints beyond its prose, each with a claim planted where the review must find it. */
const CLAIM = 'Résultat garanti, méthode secrète : guérit en 3 jours seulement.';
const EXTRA_FIELDS: [string, Partial<ChapterContent>][] = [
  ['margin.note', { margin: { note: CLAIM, quote: null } }],
  ['margin.quote', { margin: { note: null, quote: CLAIM } }],
  ['figure.title', { figure: { type: 'icon_grid', title: CLAIM, labels: ['a', 'b'], values: [] } }],
  ['visual.labels', { visual: { type: 'icon_grid', title: 'Repères', labels: [CLAIM, 'b'], values: [] } }],
  ['figure.plan', { figure: { type: 'plan_path', title: 'Plan', labels: ['a'], values: [], plan: { days: 7, unit: 'Jour', tracks: [{ from: 1, to: 3, label: CLAIM }] } } }],
  ['visual.pairs', { visual: { type: 'before_after', title: 'Avant', labels: ['a'], values: [], pairs: [{ before: 'a', after: CLAIM }] } }],
  ['visual.tree', { visual: { type: 'decision_tree', title: 'Choix', labels: ['a'], values: [], tree: { question: 'q', cases: [{ when: 'a', then: CLAIM }] } } }],
  ['visual.cycle', { visual: { type: 'cycle', title: 'Boucle', labels: ['a'], values: [], cycle: { nodes: ['a', 'b', 'c'], breakAt: 1, center: CLAIM } } }],
  ['visual.matrix', { visual: { type: 'matrix', title: 'Bilan', labels: ['a'], values: [], matrix: { heads: ['a', 'b', 'c', 'd'], cells: [[CLAIM], [], [], []] } } }],
  ['figure.gauge', { figure: { type: 'gauge', title: 'Mesure', labels: ['a'], values: [], gauge: { rows: [CLAIM], low: 'bas', high: 'haut' } } }],
  ['visual.path', { visual: { type: 'step_path', title: 'Méthode', labels: ['a'], values: [], path: { stations: [{ label: 'a', when: CLAIM, duration: null }] } } }],
  ['visual.grid', { visual: { type: 'grid', title: 'Fiche', labels: [], values: [], grid: { columns: ['a', 'b'], rows: ['c'], cells: [[CLAIM]] } } }],
];

describe('the compliance gate reads all that is printed (pdf §9.2)', () => {
  const ctxOf = (g: Guides) => ({ audience: g.brief.audience, problem: g.brief.problem, voc: g.voc });
  /** The prose of a guide, nothing of what the gate must learn to read. */
  const proseOf = (g: PdfContent): PdfContent => ({
    ...g, howTo: undefined,
    chapters: g.chapters.map(({ margin: _m, figure: _f, ...c }) => ({ ...c, visual: null })),
    bonus: (({ margin: _m, figure: _f, ...c }) => ({ ...c, visual: null }))(g.bonus),
  });

  it.each(EXTRA_FIELDS)('a claim in %s blocks the guide, and moves no other scorer', (_, extra) => {
    const base = structuredClone(all[0]!.parent);
    const after = { ...base, chapters: base.chapters.map((c, i) => (i === 1 ? { ...c, ...extra } : c)) };
    const was = scorePdf(base, ctxOf(all[0]!));
    const now = scorePdf(after, ctxOf(all[0]!));
    expect(was.compliance).toBe(100);
    expect(now.compliance).toBeLessThan(60);
    expect(now.blocking?.filter((b) => b.dimension === 'compliance').map((b) => b.text).join(' ')).toMatch(/Allégations risquées/);
    expect({ ...now, compliance: 0, overall: 0, issues: [], blocking: [], design: 0, structure: 0 }).toEqual({ ...was, compliance: 0, overall: 0, issues: [], blocking: [], design: 0, structure: 0 });
  });

  it('the bonus and the « how to » box count too', () => {
    const base = structuredClone(all[0]!.parent);
    expect(scorePdf({ ...base, bonus: { ...base.bonus, margin: { note: CLAIM, quote: null } } }, ctxOf(all[0]!)).compliance).toBeLessThan(60);
    expect(scorePdf({ ...base, howTo: [['a', CLAIM], ['b', 'c'], ['d', 'e']] }, ctxOf(all[0]!)).compliance).toBeLessThan(60);
  });

  it('the real guides pay for it with nothing: their rail, figures and sheets hold no claim', () => {
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) expect(scorePdf(guide, ctxOf(g)).compliance, g.nicheId).toBe(scorePdf(proseOf(guide), ctxOf(g)).compliance);
    }
  });
});

describe('ensurePdf keeps a guide printable (shapes.ts)', () => {
  const VISUAL = { type: 'icon_grid', title: 'Repères', labels: ['a', 'b'], values: [] };
  const BAD: [string, Record<string, unknown>][] = [
    ['margin: a number note', { margin: { note: 42 } }],
    ['margin: a quote that is a list', { margin: { note: null, quote: ['x'] } }],
    ['margin: a string', { margin: 'x' }],
    ['visual.pairs: a string', { visual: { ...VISUAL, type: 'before_after', pairs: 'x' } }],
    ['visual.pairs: a null row', { visual: { ...VISUAL, type: 'before_after', pairs: [null] } }],
    ['visual.pairs: numbers', { visual: { ...VISUAL, type: 'before_after', pairs: [{ before: 1, after: 2 }] } }],
    ['visual.plan: tracks a string', { visual: { ...VISUAL, type: 'plan_path', plan: { days: 7, unit: 'Jour', tracks: 'none' } } }],
    ['visual.plan: a null track', { visual: { ...VISUAL, type: 'plan_path', plan: { days: 7, unit: 'Jour', tracks: [null] } } }],
    ['visual.path: stations a string', { visual: { ...VISUAL, type: 'step_path', path: { stations: 'x' } } }],
    ['visual.path: a null station', { visual: { ...VISUAL, type: 'step_path', path: { stations: [null] } } }],
    ['figure.gauge: rows a number', { figure: { ...VISUAL, type: 'gauge', gauge: { rows: 3 } } }],
    ['visual.tree: a null case', { visual: { ...VISUAL, type: 'decision_tree', tree: { question: 'q', cases: [null] } } }],
    ['visual.tree: cases a string', { visual: { ...VISUAL, type: 'decision_tree', tree: { question: 'q', cases: 'x' } } }],
    ['visual.matrix: cells a string', { visual: { ...VISUAL, type: 'matrix', matrix: { heads: ['a', 'b', 'c', 'd'], cells: 'xyzw' } } }],
    ['visual.matrix: heads a number', { visual: { ...VISUAL, type: 'matrix', matrix: { heads: 4, cells: [[1], null, 2, 'x'] } } }],
    ['visual.cycle: nodes a string', { visual: { ...VISUAL, type: 'cycle', cycle: { nodes: 'abc', breakAt: 1, center: 'x' } } }],
    ['visual.cycle: a string', { visual: { ...VISUAL, type: 'cycle', cycle: 'x' } }],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'pixel-shapes-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const product = { id: 'prd_1', title: 'T', subtitle: '', audience: 'a', problem: 'p', price: 19, files: {}, stats: { rating: 0, reviews: [] } } as unknown as Product;
  const print = (content: PdfContent, name: string) => renderPdf({ product, content, design: designFor({ nicheName: all[0]!.brief.name, category: all[0]!.brief.category, seed: 3 }), brand: 'Pixel Agency', outFile: join(dir, name), upsell: null, effort: effortFor(1) });

  it.each(BAD)('%s prints, on `labels` or without it', async (name, bad) => {
    const parent = structuredClone(all[0]!.parent);
    const answer = { ...parent, chapters: parent.chapters.map((c, i) => (i === 1 ? { ...c, ...bad } : c)) };
    const file = name.replace(/\W+/g, '-');
    expect((await print(ensurePdf(answer, parent), `${file}.pdf`)).pages).toBeGreaterThan(5);
    expect((await print(ensurePdf(answer), `${file}-2.pdf`)).pages).toBeGreaterThan(5);
  }, 30_000);

  it('a calendar with no end stays out: `planPath` would count its days for ever', () => {
    const parent = structuredClone(all[0]!.parent);
    const planOf = (days: number) => ensurePdf({ ...parent, chapters: parent.chapters.map((c, i) => (i === 1 ? { ...c, visual: { ...VISUAL, type: 'plan_path', plan: { days, unit: 'Jour', tracks: [{ from: 1, to: 2, label: 'a' }] } } } : c)) }).chapters[1]!.visual?.plan;
    expect(planOf(365)?.days).toBe(365);
    expect(planOf(1e12)).toBeUndefined();
  });

  it('a bad value falls back on the chapter it replaces, a good one beside it stays', () => {
    const parent = structuredClone(all[0]!.parent);
    const put = (margin: unknown) => ({ ...parent, chapters: parent.chapters.map((x, i) => (i === 1 ? { ...x, margin } : x)) });
    expect(ensurePdf(put({ note: 42, quote: 'Ses mots à elle' }), parent).chapters[1]!.margin).toEqual({ note: null, quote: 'Ses mots à elle' });
    expect(ensurePdf(put(7), parent).chapters[1]!.margin).toEqual(parent.chapters[1]!.margin);
  });

  it.each([['a string', 'abc'], ['numbers', [1, 2, 3]], ['rows of one', [['a'], ['b'], ['c']]]])('howTo as %s falls back on the box of the guide', async (name, howTo) => {
    const parent = structuredClone(all[0]!.parent);
    expect(ensurePdf({ ...parent, howTo }, parent).howTo).toEqual(parent.howTo);
    expect((await print(ensurePdf({ ...parent, howTo }), `howto-${name.replace(/\W+/g, '-')}.pdf`)).pages).toBeGreaterThan(5);
  }, 30_000);

  it('every real figure and rail comes through untouched: the guard is no filter', () => {
    for (const g of all) {
      for (const guide of [g.parent, g.follow]) {
        const safe = ensurePdf(guide, guide);
        expect(figuresOf(safe), g.nicheId).toEqual(figuresOf(guide));
        expect(safe.chapters.map((c) => c.margin), g.nicheId).toEqual(guide.chapters.map((c) => c.margin));
        expect(safe.howTo, g.nicheId).toEqual(guide.howTo);
      }
    }
  });
});

describe('determinism', () => {
  it('two writers with the same craft on the same day write the same guide, flaws included', async () => {
    const craft = craftOf('longform', 0.3, 'sonnet');
    const { brief, voc, outline, product } = await live();
    const write = () => engineOf(SEED).writePdfContent({ title: product.title, outline, niche: brief, voc, upsellTitle: null }, mindOn(4, craft));
    expect(await write()).toEqual(await write());
  }, 30_000);
});
