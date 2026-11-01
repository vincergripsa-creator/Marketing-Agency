/**
 * Studio PDF: 10 titles → outline that sells → full first draft (deliberately "correct mais plat":
 * a few generic AI sentences and one or two risky claims the humanizer / fact-checker must catch).
 * Structure and framing come from the guide's archetype, substance from the research: the Draft hands
 * out each research item and each framing sentence once, so nothing is repeated inside a guide.
 */
import type { ChapterContent, NicheBrief, PdfContent, VisualSpec, VoiceOfCustomer } from '../../shared.js';
import type { Outline, UpsellContext } from '../../contracts.js';
import { CLICHE_TEMPLATES } from '../lexicon.js';
import { stripNextPrefix } from '../shapes.js';
import { conflictsWith, containsBanned, scrubDeep } from '../playbook.js';
import {
  allText, bare, bestLabel, cap, clauseLabel, clean, composeTitle, endsDangling, hashString, labelOf, lf, lowerFirst, norm, q, qv, sentence, splitSentences, uniqStrings, wordCount, type LocalRng,
} from '../util.js';
import { ARCHETYPES, asStep, chaptersFor, SUITES, topicExamples, topicFillers, type ArchetypeDef, type ChapterDef, type Para, type Role } from './archetypes.js';
import { belongsToFollowUp, buildNicheCtx, de, FALLBACK, firstPerson, headOf, isInfinitive, titleCaseKeyword, type NicheCtx } from './niche.js';
import { buildPlan, type PlanModel } from './plan.js';
import type { BonusSpec, SheetSpec } from './profiles.js';
import type { MethodStep, MistakePair, Situation } from './knowledge.js';

/** Research item embedded after a colon of ours: lowercase start, its own « : » turned into « — », no final dot. */
export function inline(s: string): string {
  return lf(s).replace(/\s+:\s+/g, ' — ').replace(/\s*;\s+/g, ', ');
}

/** Guillemets inside a quote become “ ”: a quote inside a quote never breaks the outer pair. */
const inner = (s: string): string => s.replace(/«\s*/g, '“').replace(/\s*»/g, '”');

/** The outcome promised on the cover: an upsell brief's goal, else the first desired outcome its follow-up guide does not keep for itself. */
export function promiseOutcome(c: NicheCtx): string {
  if (c.goal) return lf(c.goal);
  const own = c.outcomes.find((o) => !belongsToFollowUp(o, c));
  return lf(own ?? c.outcomes[0] ?? FALLBACK.outcomes[0]);
}

/** The archetype that writes this guide. */
export function archetypeDef(c: NicheCtx): ArchetypeDef {
  return (c.upsellOf ? SUITES : ARCHETYPES)[c.archetype];
}

/** Whole short labels for visuals (≤ max chars, never cut mid-phrase), completed by fallbacks. */
function labelsFrom(items: readonly string[], max: number, k: number, fallback: readonly string[] = []): string[] {
  const out: string[] = [];
  // whole phrases and clause heads first; prepositional cuts only to complete the list
  for (const tiers of [1, 2] as const) {
    for (const it of [...items, ...fallback]) {
      if (out.length >= k) break;
      const l = clauseLabel(it, max, { tiers });
      if (l && !out.some((o) => norm(o) === norm(l))) out.push(l);
    }
  }
  return out.slice(0, k);
}

export type Kind = Role;

export function chapterCount(c: NicheCtx): number {
  if (c.upsellOf) return c.topic ? 6 : 5;
  const items = c.pains.length + c.phrases.length + c.tips.length + c.steps.length + c.mistakes.length + c.examples.length + c.facts.length;
  if (c.deep && items >= 24) return 7;
  if (items >= 14) return 6;
  return 5;
}

const ORDER: Record<number, Kind[]> = {
  5: ['comprendre', 'methode', 'erreurs', 'programme', 'durer'],
  6: ['comprendre', 'diagnostic', 'methode', 'erreurs', 'programme', 'durer'],
  7: ['comprendre', 'diagnostic', 'methode', 'erreurs', 'situations', 'programme', 'durer'],
};

/** Role of a chapter from its title alone (outlines written by another mind carry no kind). */
export function inferKind(title: string, index: number, total: number): Kind {
  const t = norm(title);
  if (/erreur|piege|a eviter|ce qu'il ne faut pas|faux pas/.test(t)) return 'erreurs';
  if (/diagnostic|observ|carnet|etat des lieux|point de depart|preparer|feux verts|sous la main|cadre avant|ce que vous avez deja/.test(t)) return 'diagnostic';
  if (/situation|imprevu|deraill|cas difficile|cas particuliers?|cas qui|rechute|\bsos\b|mauvais jours|rate|coince|moments (difficiles|qui)/.test(t)) return 'situations';
  if (/\b(plan|programme|calendrier|planning|retroplanning|deroule|progression sur)\b|apres (nuit|jour|semaine)|\b\d+ (nuits|jours|semaines|soirs)\b/.test(t)) return 'programme';
  if (/tenir|duree|long terme|garder les acquis|maintenir|habitude|rituel|rythme|derniere ligne|quotidien|faire durer/.test(t)) return 'durer';
  if (/comprendre|pourquoi|ce qui se passe|mecanisme|origine|cause|regles|ce que l'epreuve|securite|ou part|avant de commencer/.test(t)) return 'comprendre';
  if (/methode|etape|pas a pas|technique|protocole|procedure|gestes|decisions|cycle|paliers|reglages/.test(t)) return 'methode';
  const order = ORDER[Math.min(7, Math.max(5, total))] ?? ORDER[7]!;
  return order[Math.min(order.length - 1, Math.round((index / Math.max(1, total - 1)) * (order.length - 1)))] ?? 'methode';
}

// ───────────────────────────── titles ─────────────────────────────

/** A short customer phrase usable inside a title / hook: whole, no colon, no first-person « je… » cut. */
function shortPhrase(c: NicheCtx, rng: LocalRng, max = 46): string | null {
  // a question (« c'est normal ? ») cannot follow « Fini … » / « en finir avec … »
  const ok = c.phrases.filter((p) => !/[?]\s*$/.test(p)).map(bare).filter((p) => p.length <= max && p.length >= 8 && !/[:;]/.test(p));
  return ok.length ? rng.pick(ok) : null;
}

export const TITLE_MAX = 95;

function upsellTitles(c: NicheCtx, n: number, parent: UpsellContext): string[] {
  const { n: dn, unit } = c.dur;
  const P = c.painTitle;
  const Ac = c.audCore;
  const desired = bestLabel([c.goal, ...c.outcomes], 50, 10);
  const all = [
    c.topic?.title,
    `${P} : le plan ciblé de ${dn} ${unit}`,
    `${P} : le guide ciblé pour ${Ac}`,
    desired ? `${cap(desired)} : le plan ciblé de ${dn} ${unit}` : null,
    `Le guide ciblé pour ${Ac} : ${lf(P)}`,
    `${dn} ${unit} pour régler ce point : ${lf(P)}`,
  ].map((t) => (t ? composeTitle([cap(clean(t))], TITLE_MAX) : null)).filter((t): t is string => !!t && norm(t) !== norm(parent.parentTitle));
  const titles = uniqStrings(all);
  for (let k = 2; titles.length < n; k++) titles.push(`${titles[0] ?? cap(P)} (version ${k})`);
  return titles.slice(0, n);
}

export function heuristicTitles(nicheIn: NicheBrief, vocIn: VoiceOfCustomer, count: number, rng: LocalRng, upsellOf: UpsellContext | null = null): string[] {
  const c = buildNicheCtx(nicheIn, vocIn, upsellOf);
  const n = Number.isFinite(count) && count > 0 ? Math.min(30, Math.floor(count)) : 10;
  if (upsellOf) return upsellTitles(c, n, upsellOf);
  const def = archetypeDef(c);
  const P = c.painTitle;
  const A = c.audTitle;
  const Ac = c.audCore;
  const age = c.age && !/\d/.test(Ac) ? ` (${c.age})` : '';
  const ph = shortPhrase(c, rng);
  const ph2 = shortPhrase(c, rng);
  const desired = bestLabel([promiseOutcome(c), ...c.outcomes], 50, 10);
  const desired2 = bestLabel([...c.outcomes.slice(1), ...c.outcomes], 46, 10);
  const pbQ = c.pbShort ? q(c.pbShort) : null;
  const steps = c.stepCount;
  const errs = Math.min(6, c.pairs.length);
  const kw = titleCaseKeyword(clauseLabel(c.niche.keywords[0] ?? '', 24) ?? c.niche.keywords[0] ?? c.niche.name);
  // « arrêtez de ne pas déclarer » : a negative mistake cannot follow « arrêtez de »
  const mistake = bestLabel(c.mistakes.filter((m) => isInfinitive(m) && !/^(ne|n['’])/i.test(bare(m))), 48, 10);
  const D = `${c.dur.n} ${c.dur.unit}`;
  const pour = (head: string): string[] => [`${head} pour ${A}`, `${head} pour ${Ac}`, `${head}${age}`, head];
  // a shorter pain keeps the strongest formula (problem + method + duration) under 95 characters
  const Ps = clauseLabel(P, 42, { min: 12 }) ?? P;
  const habit = c.archetype === 'habitude';

  const formulas: (string | null)[][] = [
    def.titles(c, { P, Ps, D, steps, desired }).flatMap(pour),
    ph ? pour(`Fini ${q(ph)} : le plan pas à pas`) : pour('Fini les galères : le plan pas à pas'),
    pour(`${P} : ${steps} étapes concrètes`),
    desired ? [...pour(`Objectif « ${desired} » : le plan de ${D}`), `Objectif « ${desired} » en ${D}`] : [],
    mistake ? [`${cap(Ac)} : arrêtez ${de(mistake)} (et faites plutôt ceci)`, `Arrêtez ${de(mistake)} : faites plutôt ceci`] : [],
    ph2 && desired2 ? pour(`De ${q(ph2)} à « ${desired2} » : le guide pratique`) : [],
    pbQ ? [`${cap(pbQ)} : les ${errs} erreurs à éviter`, `${P} : les ${errs} erreurs à éviter`] : [`${P} : les ${errs} erreurs à éviter`],
    habit ? pour(`SOS ${kw} : le protocole ${c.adjM}`) : pour(`${cap(kw)} : le guide ${c.adjM} et complet`),
    desired ? [...pour(`${cap(desired)} : le guide pas à pas`), `${cap(desired)} en ${D} : le guide pas à pas`] : [],
    ph ? [`${D} pour en finir avec ${q(ph)} — ${Ac}`, `${D} pour en finir avec ${q(ph)}`] : [`${D} pour reprendre la main — ${Ac}`],
    [`${P} : comment s’en sortir en ${D}`, `Comment s’en sortir en ${D}`],
    ph ? [`${cap(Ac)}${age} : le guide ${c.adjM} pour en finir avec ${q(ph)}`, `${cap(Ac)} : en finir avec ${q(ph)}`] : [`${cap(Ac)}${age} : le guide ${c.adjM}, étape par étape`],
    [`${cap(Ac)} : le plan de ${D}, étape par étape`, `Le plan de ${D}, étape par étape`],
    [`${P} : le guide ${c.adjM} en ${steps} étapes`],
  ];
  const all = formulas.map((f) => composeTitle(f.map((x) => (x ? cap(clean(x)) : x)), TITLE_MAX)).filter((t): t is string => !!t);
  const lead = all[0] ?? composeTitle([`${P} : le plan de ${D}`, `Le plan de ${D}`], TITLE_MAX) ?? `Le plan de ${D}`;
  let titles = uniqStrings([lead, ...rng.shuffle(all.slice(1))]);
  let k = 0;
  const extra = [`Le guide ${c.adjM} pour ${Ac}`, `${cap(Ac)} : le guide pas à pas`, `Le plan de ${D}`, `${steps} étapes pour reprendre la main`];
  while (titles.length < n && k < extra.length) titles = uniqStrings([...titles, cap(extra[k++]!)]);
  k = 2;
  while (titles.length < n) titles.push(`${lead} (version ${k++})`);
  return titles.slice(0, n);
}

// ───────────────────────────── counts and points ─────────────────────────────

const MAX_ERRORS = 6;
const MAX_SITUATIONS = 6;
const MAX_STEPS = 8;
/** Two lines of a cell of the matrix. */
const STAND_ALONE = 72;
const MIN_WORDS = 2300;
const MIN_WORDS_SUITE = 2300;
/** What the humanizer and the fact-checker take out of a follow-up: the draft leaves them the room, the reader still gets the floor. */
const PASSES_TAKE = 50;

function situationsOf(c: NicheCtx, def: ArchetypeDef): Situation[] {
  const own = c.situations.slice(0, MAX_SITUATIONS);
  return own.length >= 3 ? own : [...own, ...def.situationsFallback].slice(0, Math.max(3, own.length));
}

function rendered(c: NicheCtx): MistakePair[] {
  return c.pairs.slice(0, MAX_ERRORS);
}

/** The number a chapter title announces: always what the chapter really develops. */
function countOf(role: Role, c: NicheCtx, def: ArchetypeDef): number {
  if (role === 'erreurs') return rendered(c).length;
  if (role === 'situations') return situationsOf(c, def).length;
  return Math.min(MAX_STEPS, c.method.length);
}

const titleOf = (ch: ChapterDef, c: NicheCtx, def: ArchetypeDef): string => ch.title(c, countOf(ch.role, c, def));

function pointsFor(ch: ChapterDef, c: NicheCtx, def: ArchetypeDef): string[] {
  const s = (arr: readonly string[], k: number) => arr.slice(0, k).map((x) => sentence(x));
  switch (ch.role) {
    case 'comprendre': return [...s(c.facts, 2), ...s(c.pains, 2)].slice(0, 4).concat(c.facts.length + c.pains.length ? [] : ['Le mécanisme qui entretient le problème.', 'Ce qui change quand on le voit.']);
    case 'diagnostic': return (ch.steps?.(c) ?? []).map(sentence);
    case 'methode': return s(c.method.map((m) => m.text), MAX_STEPS);
    case 'erreurs': return s(rendered(c).map((p) => p.mistake), MAX_ERRORS);
    case 'situations': return situationsOf(c, def).map((x) => sentence(cap(x.when)));
    case 'programme': return buildPlan(c, def).rows.map((r) => `${r.label} : ${r.actions.join(' ; ')}.`);
    case 'durer': return s(c.tips.length ? c.tips.slice(-3) : FALLBACK.tips, 3);
  }
}

export function heuristicOutline(title: string, nicheIn: NicheBrief, vocIn: VoiceOfCustomer, _rng: LocalRng, upsellOf: UpsellContext | null = null): Outline {
  const c = buildNicheCtx(nicheIn, vocIn, upsellOf);
  const def = archetypeDef(c);
  const chapters = chaptersFor(def, chapterCount(c));
  return {
    title: clean(title) || cap(c.problem),
    chapters: chapters.map((ch) => ({ title: titleOf(ch, c, def), points: pointsFor(ch, c, def), kind: ch.kind })),
    bonusTitle: bonusFor(c).title,
    nextStepTitle: nextGuideTitle(c),
  };
}

/** Title of the next guide for the same reader (no « La suite est ici » prefix: the layout adds it). */
export function nextGuideTitle(c: NicheCtx): string {
  const planned = c.upsellOf ? null : c.profile?.topics[0]?.title;
  if (planned) return planned;
  const used = norm(c.pbClause);
  const next = bestLabel(c.pains.filter((p) => norm(lf(p)) !== used && !firstPerson(p)), 64, 12);
  return next ? `En finir avec ${q(lf(next))}` : `Le guide suivant pour ${c.audCore}`;
}

/** The guide's last page, correct with or without a follow-up guide, and safe to recompute when one is linked. */
export function nextStepFor(input: { audience: string; upsell: { title: string; productId?: string | null } | null }): PdfContent['nextStep'] {
  const aud = clean(input.audience) || 'nos lecteurs';
  const title = input.upsell ? stripNextPrefix(input.upsell.title) : '';
  const opening = ['Vous avez maintenant une méthode et un plan pour la tenir.', 'Vous avez toutes les cartes en main.', 'Le plus dur est derrière vous : vous savez quoi faire et dans quel ordre.'][hashString(aud) % 3]!;
  if (input.upsell && title) {
    const plain = title.replace(/«\s*/g, '“').replace(/\s*»/g, '”');
    return {
      title,
      text: `${opening} Si vous voulez aller plus loin, « ${plain} » traite un autre point, à part, dans le même format pensé pour ${aud}. Vous le trouverez sur notre boutique.`,
      upsellProductId: input.upsell.productId ?? null,
    };
  }
  return {
    title: 'Votre prochaine étape',
    text: `${opening} Il reste une chose à faire : ouvrir le plan à la première ligne, et noter ce qui change. Si un guide complémentaire paraît pour ${aud}, vous en serez informé à l’adresse utilisée pour votre achat.`,
    upsellProductId: null,
  };
}

// ───────────────────────────── the draft ─────────────────────────────

/** Hands out each research item once, and each framing sentence once. */
export class Draft {
  private readonly tips: string[];
  private readonly factsLeft: string[];
  private readonly phrases: string[];
  private readonly painsLeft: string[];
  private readonly outcomes: string[];
  private readonly examples: string[];
  private readonly models: string[];
  private readonly said = new Set<string>();
  /** Kinds of the chapters of this guide: a paragraph may refer to a chapter only when it exists. */
  readonly kinds = new Set<string>();

  constructor(readonly c: NicheCtx, readonly rng: LocalRng) {
    this.tips = (c.tips.length >= 3 || c.topic ? c.tips : uniqStrings([...c.tips, ...FALLBACK.tips])).slice();
    this.factsLeft = c.facts.slice();
    this.phrases = rng.shuffle(c.phrases);
    this.examples = [...rng.shuffle(c.examples), ...topicExamples(c)];
    this.models = c.models.slice();
    // the main pain is quoted by the introduction itself: the pool hands out the others
    this.painsLeft = c.pains.filter((p) => norm(lf(p)) !== norm(c.pbClause));
    // the promised outcome lives on the cover / promise page: chapters use the OTHER outcomes
    const promised = norm(promiseOutcome(c));
    const rest = c.outcomes.filter((o) => norm(lf(o)) !== promised);
    this.outcomes = (rest.length ? rest : [...FALLBACK.outcomes]).slice();
  }

  /** A framing sentence, the first time it is used. */
  once(text: string | null | undefined): string | null {
    const t = clean(text);
    const k = norm(t);
    if (!k || this.said.has(k)) return null;
    this.said.add(k);
    return t;
  }

  private take(list: string[]): string | null {
    return list.shift() ?? null;
  }

  tip(): string | null { const t = this.take(this.tips); return t ? inline(t) : null; }
  tipsLeft(k: number): string[] { return this.tips.splice(0, k); }
  /** Full sentence of the research, ready to open a paragraph. */
  fact(): string | null { const f = this.take(this.factsLeft); return f ? sentence(f) : null; }
  /** A research item the guide does not print: the rail adds substance to a page, it never repeats it. A checklist may have printed one already. */
  note(printed: string): string | null {
    const unsaid = (s: string): boolean => !printed.includes(norm(bare(s)).slice(0, 40));
    const take = (list: string[]): string | null => { const i = list.findIndex(unsaid); return i >= 0 ? list.splice(i, 1)[0]! : null; };
    const item = take(this.factsLeft) ?? take(this.tips);
    return item ? sentence(item) : null;
  }
  facts(k: number): string { return Array.from({ length: k }, () => this.fact()).filter(Boolean).join(' '); }
  outcome(): string | null { const o = this.take(this.outcomes); return o ? inline(o) : null; }
  phrase(): string | null { const p = this.take(this.phrases); return p ? inner(p) : null; }
  /** The first customer phrase fit for a pull quote: short, and whole. */
  pullQuote(): string | null {
    const i = this.phrases.findIndex((p) => bare(p).length <= 110 && !endsDangling(bare(p)));
    return i >= 0 ? this.phrases.splice(i, 1)[0]! : null;
  }
  /** Customer words between quotes. */
  quote(): string | null { const p = this.phrase(); return p ? qv(p) : null; }
  /** Pain as customer words, always quoted (works whatever its grammatical form). */
  painQ(): string | null { const p = this.take(this.painsLeft); return p ? q(lf(inner(p))) : null; }
  example(): string | null { const e = this.take(this.examples); return e ? `Exemple type : ${sentence(e)}` : null; }
  /** A ready-to-copy model of the research. */
  model(): string | null { return this.take(this.models); }
  /** Each is read once: the diagnostic and last chapters are the only ones to use them. */
  observations(): string[] { return this.c.observe.slice(); }
  upkeep(): string[] { return this.c.keep.slice(); }
}

const ORD_M = ['Premier', 'Deuxième', 'Troisième', 'Quatrième', 'Cinquième', 'Sixième', 'Septième', 'Huitième'];
const ORD_F = ['Première', ...ORD_M.slice(1)];

/** A detail that gives an order says how, one that does not says why: its head must say which. */
const detailHead = (detail: string): string => (/(?<![\p{L}’'])[\p{L}’']{2,}ez\b/u.test(detail.replace(/\b(?:chez|assez)\b/giu, '')) ? 'Comment faire' : 'Pourquoi ça marche');

/** A paragraph per step: the action, then its detail under a run-in head of its own, so a tired reader finds it. */
function methodParas(d: Draft, def: ArchetypeDef): string[] {
  const ord = def.stepNoun.fem ? ORD_F : ORD_M;
  return d.c.method.slice(0, MAX_STEPS).flatMap((s, i) => {
    const head = `${ord[i] ?? ORD_M[7]} ${def.stepNoun.word} : ${inline(s.text)}.`;
    if (s.detail) return [head, `${detailHead(s.detail)} : ${s.detail}`];
    return [clean(`${head} ${def.whyFallback.map((w) => d.once(w)).find(Boolean) ?? ''}`)];
  });
}

/** The counter-move of an unpaired mistake: the tip or step that talks about the same thing. */
function fixFor(p: MistakePair, c: NicheCtx): string | null {
  if (p.fix) return p.fix;
  const stems = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 6));
  const want = new Set(stems(p.mistake));
  const pool = [...c.method.map((m) => m.text), ...c.tips];
  const best = pool.map((t) => ({ t, n: stems(t).filter((w) => want.has(w)).length })).sort((a, b) => b.n - a.n)[0];
  return best && best.n > 0 ? sentence(best.t) : null;
}

const GENERIC_FIX = [
  'Tenir une seule règle pendant au moins une semaine avant de la juger.',
  'Écrire à l’avance ce que vous ferez la prochaine fois, en une phrase.',
  'Revenir à la dernière chose qui a bien fonctionné.',
];

function errorParas(d: Draft): string[] {
  return rendered(d.c).map((p, i) => {
    const fix = fixFor(p, d.c) ?? d.once(GENERIC_FIX[i % GENERIC_FIX.length]) ?? GENERIC_FIX[0]!;
    return clean(`Erreur n°${i + 1} : ${inline(p.mistake)}. ${p.why} À la place : ${inline(fix)}.`);
  });
}

function situationParas(d: Draft, def: ArchetypeDef): string[] {
  return situationsOf(d.c, def).map((s, i) => `Situation n°${i + 1} : ${inline(s.when)}. ${sentence(s.what)}`);
}

function gridVisual(s: SheetSpec): VisualSpec {
  return { type: 'grid', title: s.title, labels: [], values: [], grid: { columns: s.columns, rows: s.rows, ...(s.cells ? { cells: s.cells } : {}) } };
}

const DEFAULT_SHEET: SheetSpec = {
  title: 'Votre feuille de relevé',
  columns: ['Moment', 'Ce qui s’est passé', 'Ce que vous avez fait', 'Résultat'],
  rows: ['', '', '', '', '', ''],
};

/** A follow-up prints its bonus sheet once: its starting point is read against its own method, line by line. */
function sheetFor(c: NicheCtx): SheetSpec {
  if (!c.topic) return c.profile?.sheet ?? DEFAULT_SHEET;
  return { title: 'Votre point de départ', columns: ['Ce que vous vérifiez', 'Où vous en êtes', 'À faire en premier'], rows: c.method.slice(0, MAX_STEPS).map((m) => labelOf(m.text, 46)) };
}

/** The link of a loop the method attacks first: the first step that talks about one of its nodes. */
function breakOf(loop: readonly string[], method: readonly MethodStep[]): number {
  const stems = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
  for (const m of method) {
    const want = new Set(stems(`${m.text} ${m.detail}`));
    const node = loop.findIndex((n) => stems(n).some((w) => want.has(w)));
    if (node >= 0) return node;
  }
  return 1;
}

const LEANS_ON = /^(?:il|elle|ils|elles|on|ce|c|ca|cela|cette|ces|celui|celle|ceux|son|sa|ses|leur|leurs|seul|seule|seuls|seules|qui|que|qu|dont|puis|ensuite|alors|mais|donc|car|et)\b|\b(?:suivante?s?|precedente?s?)$/;

/**
 * A cell of a matrix has no sentence around it: whole sentences that stand on their own feet, then the head of an order
 * (« Notez la hauteur griffée »), or nothing. Any other head of a sentence (« À chaque changement de rythme ») and a sentence
 * that leans on the one before (« Il dit à quel moment… ») read as broken.
 */
export function standAlone(items: readonly string[]): string[] {
  const sentences = items.flatMap(splitSentences);
  const whole = sentences.map(bare).filter((t) => t.length <= STAND_ALONE && !endsDangling(t));
  const orders = labelsFrom(sentences, STAND_ALONE, sentences.length).filter((l) => /^\p{L}+ez\b/u.test(l));
  return [...whole, ...orders].map(cap).filter((l, k, all) => !LEANS_ON.test(norm(l)) && all.findIndex((x) => norm(x) === norm(l)) === k);
}

/** A figure says nothing the guide does not: a list item that is not printed elsewhere comes without a number. */
const noDigit = (labels: readonly string[]): string[] => labels.filter((l) => !/\d/.test(l));

/**
 * The chapter's visual, fed by what the writer already has (pdf §9.2). `labels` stay filled with a plain version of the same
 * data, for a renderer without the type. A number never appears here unless it was measured: see the bar_chart note in shared/types.ts.
 */
function visualFor(ch: ChapterDef, d: Draft, def: ArchetypeDef, plan: PlanModel, steps: string[]): VisualSpec {
  const c = d.c;
  switch (ch.role) {
    case 'comprendre': {
      const loop = c.profile?.loop;
      if (loop && !c.upsellOf && c.archetype === 'habitude') return { type: 'cycle', title: 'La boucle à casser', labels: loop, values: [], cycle: { nodes: loop, breakAt: breakOf(loop, c.method), center: 'Un seul maillon à casser' } };
      // the few words of a sub-problem are quoted whole: « Versement libératoire oui » is nobody's sentence
      const labels = c.upsellOf ? uniqStrings([...c.ownPains, ...c.phrases].map((x) => cap(bare(headOf(x)))).filter((x) => x.length <= 60)).slice(0, 6)
        : labelsFrom([...c.pains.map(headOf), ...c.phrases], 40, 6, ['Le même problème, encore et encore']);
      return { type: 'icon_grid', title: 'Ce que vous nous décrivez', labels, values: [] };
    }
    case 'diagnostic':
      return gridVisual(sheetFor(c));
    case 'methode': {
      const stations = c.method.slice(0, MAX_STEPS).map((m) => ({ label: cap(bare(m.text)), when: m.when, duration: m.duration }));
      return { type: 'step_path', title: `Les ${steps.length} ${def.stepNoun.word}s en un coup d’œil`, labels: steps.map((s) => labelOf(s, 64)), values: [], path: { stations } };
    }
    case 'erreurs': {
      // whole phrases only: a cut label can say the opposite of the sentence, and each « à faire » stays with its « à éviter »
      const whole = (s: string | null): string | null => { const t = bare(s ?? ''); return t && t.length <= 72 && !endsDangling(t) ? cap(t) : null; };
      const pairs = rendered(c).flatMap((p) => { const fix = fixFor(p, c); return fix ? [{ before: cap(bare(p.mistake)), after: cap(bare(fix)) }] : []; });
      const short = rendered(c).map((p) => ({ m: whole(p.mistake), f: whole(fixFor(p, c)) })).filter((p): p is { m: string; f: string } => !!p.m && !!p.f).slice(0, 3);
      const use = short.length ? short : [{ m: 'Tout changer d’un coup', f: 'Commencer par un seul point' }];
      return { type: 'before_after', title: 'À éviter, à faire à la place', labels: [...use.map((p) => `À éviter : ${lowerFirst(p.m)}`), ...use.map((p) => `À faire : ${lowerFirst(p.f)}`)], values: [], pairs: pairs.length ? pairs : use.map((p) => ({ before: p.m, after: p.f })) };
    }
    case 'situations': {
      const own = situationsOf(c, def);
      const known = new Set(own.map((s) => norm(s.when)));
      const cases = [...own, ...def.situationsFallback.filter((s) => !known.has(norm(s.when)))].map((s) => ({ when: `Si ${lf(s.when)}`, then: sentence(s.what) }));
      // the ladder starts from the reader's own problem: the title of the figure has already said « que faire »
      const question = c.pbShort ? `${cap(c.pbShort)} : quel cas ressemble au vôtre ?` : 'Quel cas ressemble au vôtre ?';
      return { type: 'decision_tree', title: 'Si ça coince, que faire ?', labels: labelsFrom(own.map((s) => s.when), 56, 6), values: [], tree: { question, cases } };
    }
    case 'programme':
      return gridVisual(plan.sheet);
    case 'durer': {
      const labels = labelsFrom(steps, 56, 6, c.keep);
      const seen = new Set<string>();
      const pick = (items: readonly string[]): string[] => noDigit(standAlone(items)).filter((l) => !seen.has(norm(l)));
      // the method is what a thin cell falls back on: it has to last for all four
      const list = (items: readonly string[]): string[] => {
        const own = pick(items).slice(0, 3);
        const cell = own.length ? own : pick(c.method.map((m) => m.text)).slice(0, 2);
        for (const l of cell) seen.add(norm(l));
        return cell;
      };
      const cells: [string[], string[], string[], string[]] = [list(c.keep), list(rendered(c).map((p) => p.mistake)), list(c.tips), list(c.observe)];
      return { type: 'matrix', title: 'Vos réflexes pour la suite', labels, values: [], matrix: { heads: ['À garder', 'À arrêter', 'À tester', 'À surveiller'], cells } };
    }
  }
}

/** The second visual of a chapter: its `visual` stays the tool the reader fills in. */
function figureFor(ch: ChapterDef, c: NicheCtx, plan: PlanModel): VisualSpec | null {
  if (ch.role === 'diagnostic') {
    // the ruler stays blank: the reader circles, nothing on it is a value. A follow-up has no `observe`: its own mistakes are what to measure
    const rows = noDigit(labelsFrom([...c.observe, ...rendered(c).map((p) => p.mistake)], 60, 5)).slice(0, 4);
    if (!rows.length) return null;
    return { type: 'gauge', title: 'Où vous en êtes aujourd’hui', labels: rows, values: [], gauge: { rows, low: 'Pas du tout', high: 'Tout à fait' } };
  }
  if (ch.role !== 'programme') return null;
  const tracks = plan.rows.flatMap((r) => r.tracks);
  if (!tracks.length) return null;
  return { type: 'plan_path', title: `Votre plan de ${c.dur.n} ${c.dur.unit}, en un coup d’œil`, labels: tracks.map((t) => t.label), values: [], plan: { ...plan.span, tracks } };
}

const DURER_STEPS = ['Noter ce qui a le mieux marché', 'Choisir ce que vous gardez pour la suite', 'Prévoir une date pour refaire le point'];
const DURER_CHECKS = ['Ce qui a marché est noté', 'La date de bilan est fixée', 'Les notes restent à portée de main'];

/** Lists are built from the niche's own material; the framing lists only complete a thin research. */
function stepsFor(ch: ChapterDef, d: Draft, plan: PlanModel): string[] {
  const c = d.c;
  const framing = ch.steps?.(c) ?? DURER_STEPS;
  const research = (k: number): string[] => { const t = d.tipsLeft(k); return t.length >= 3 ? t : [...t, ...framing].slice(0, Math.max(3, t.length)); };
  switch (ch.role) {
    case 'methode': return c.method.slice(0, MAX_STEPS).map((m) => m.text);
    // one line per method step: no step of the method can disappear from the plan
    case 'programme': return plan.rows.flatMap((r) => r.actions.map((a) => `${r.label} : ${a}`)).slice(0, MAX_STEPS);
    case 'comprendre': return research(3);
    // a fix without its mistake is not a step (« Déclarer 0 € à chaque échéance »), and an answer printed above is not one to write
    case 'durer':
    case 'erreurs':
    case 'situations': return framing;
    case 'diagnostic': {
      const sheet = c.topic || c.profile ? sheetFor(c) : null;
      return sheet ? [framing[0]!, `Remplir chaque ligne : ${sheet.columns.map((x) => lf(x)).join(', ')}`, ...framing.slice(2)] : framing;
    }
  }
}

/** A checklist line wraps on two lines of the page: an action is shortened only beyond that. */
const CHECK_MAX = 130;

function checklistFor(ch: ChapterDef, steps: string[], c: NicheCtx): string[] {
  const short = (s: string): string => lowerFirst(bare(s).length <= CHECK_MAX ? inline(bare(s)) : labelOf(s, CHECK_MAX));
  switch (ch.role) {
    case 'comprendre': {
      // a fact is kept whole or not at all: its first half alone can say something else
      const kept = c.facts.map((f) => bare(f)).filter((f) => f.length <= 90).slice(0, 3);
      return kept.length >= 2 ? kept.map((f) => `Je retiens : ${inline(f)}`) : ch.checks?.(c) ?? DURER_CHECKS;
    }
    case 'diagnostic': {
      const framing = ch.checks?.(c) ?? DURER_CHECKS;
      return c.profile ? [`${sheetFor(c).title} : fait`, framing[0]!, framing[2]!] : framing;
    }
    // « Je ne fais plus : ne pas déclarer » says the opposite of what it means
    case 'erreurs': return rendered(c).map((p) => `${/^(ne|n['’])/i.test(bare(p.mistake)) ? 'Je corrige' : 'Je ne fais plus'} : ${short(p.mistake)}`);
    case 'situations': return steps.map((s) => `Fait : ${short(s)}`);
    case 'durer':
    case 'programme': return ch.checks?.(c) ?? DURER_CHECKS;
    case 'methode': return steps.map((s) => `Fait : ${short(s)}`);
  }
}

/** One scene built on the reader's own words, used once when the research lacks examples. */
function situationExample(d: Draft): string | null {
  if (!d.once('mise en situation')) return null;
  const p = d.quote();
  return p ? `Mise en situation : un soir, vous vous surprenez à penser ${p}. Au lieu de tout changer d’un coup, relisez ce chapitre et appliquez une seule chose. Le lendemain, notez ce qui s’est passé, sans vous juger.` : null;
}

function buildChapter(ch: ChapterDef, title: string, d: Draft, def: ArchetypeDef, plan: PlanModel): { chapter: ChapterContent; role: Role } {
  const c = d.c;
  const paragraphs = [
    ...ch.role === 'methode' ? methodParas(d, def) : ch.role === 'erreurs' ? errorParas(d) : ch.role === 'situations' ? situationParas(d, def) : [],
    ...ch.paras.map((p: Para) => d.once(p(d))).filter((x): x is string => !!x),
  ];
  const steps = uniqStrings(stepsFor(ch, d, plan)).map(asStep);
  const visual = visualFor(ch, d, def, plan, steps);
  const figure = figureFor(ch, c, plan);
  const chapter: ChapterContent = {
    title: clean(title),
    intro: ch.intro(c),
    paragraphs,
    steps,
    example: d.example() ?? situationExample(d),
    checklist: checklistFor(ch, steps, c).map((x) => cap(clean(x))),
    visual,
    ...(figure ? { figure } : {}),
  };
  return { chapter, role: ch.role };
}

/** A generic printable when the niche has no prepared one. */
function defaultBonus(c: NicheCtx): BonusSpec {
  const n = c.dur.n;
  const unit = cap(c.dur.unitOne);
  const rows = n <= 31 ? Array.from({ length: n }, (_, i) => `${unit} ${i + 1}`) : c.method.map((m) => labelOf(m.text, 40));
  const title = `Bonus : le carnet de suivi de ${n} ${c.dur.unit} à imprimer`;
  return {
    title,
    lead: `Ce carnet est l’outil le plus simple du guide : en ${n} ${c.dur.unit}, il transforme des impressions en repères.`,
    paragraphs: ['Une ligne, deux minutes, toujours au même moment. C’est cette régularité qui donne au carnet sa valeur, bien plus que le détail de ce que vous y écrivez.'],
    steps: ['Imprimer le carnet', 'Remplir une ligne à chaque étape du plan', 'Relire vos notes à mi-parcours', 'Comparer le début et la fin'],
    checklist: ['Carnet imprimé', 'Moment de remplissage choisi'],
    sheet: { title: `Votre carnet de ${n} ${c.dur.unit}`, columns: [unit, 'Fait', 'Ce qui a changé', 'À ajuster'], rows },
  };
}

function bonusFor(c: NicheCtx): BonusSpec {
  return c.topic?.bonus ?? c.profile?.bonus ?? defaultBonus(c);
}

function buildBonus(c: NicheCtx): ChapterContent {
  const b = bonusFor(c);
  return { title: b.title, intro: b.lead, paragraphs: b.paragraphs.slice(), steps: b.steps.map(sentence), example: null, checklist: b.checklist.slice(), visual: gridVisual(b.sheet) };
}

export function pdfWordCount(p: Omit<PdfContent, 'wordCount'> | PdfContent): number {
  const ch = (c: ChapterContent) => [c.title, c.intro, ...c.paragraphs, ...c.steps, c.example ?? '', ...c.checklist].join(' ');
  return wordCount([p.title, p.subtitle, p.promise, ...p.introduction, ...p.chapters.map(ch), ch(p.bonus), p.nextStep.title, p.nextStep.text].join(' '));
}

/**
 * The introduction restates the PAIN with the customers' words (never the promise), says who the
 * guide is for, then announces the promise ONCE (the intro page box repeats it: two mentions max).
 * It draws from the same pools as the chapters: what it quotes is not quoted again.
 */
function introduction(d: Draft, def: ArchetypeDef, nChapters: number, promise: string): string[] {
  const c = d.c;
  const [p1, p2] = [d.quote(), d.quote()];
  const pains = [d.painQ(), d.painQ()].filter((p): p is string => !!p);
  const tip = d.tip();
  return [
    def.introOpen(c, { pain: q(inner(c.pbClause)), p1, p2 }),
    def.introWhy(c, { pains }),
    def.introUse(c, { chapters: nChapters, promise }),
    clean(`${def.introRead(c)}${tip ? ` Et si vous ne deviez retenir qu’une chose dès maintenant : ${tip}.` : ''}`),
  ];
}

/** Removes any prose sentence that already appeared earlier in the guide. */
export function dropRepeats(content: PdfContent): void {
  const seen = new Set<string>();
  const key = (s: string): string => norm(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const pass = (text: string): string => {
    const kept = splitSentences(text).filter((s) => {
      const k = key(s);
      if (k.split(' ').length < 4) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return kept.join(' ');
  };
  content.introduction = content.introduction.map(pass).filter(Boolean);
  for (const ch of [...content.chapters, content.bonus]) {
    ch.intro = pass(ch.intro);
    ch.paragraphs = ch.paragraphs.map(pass).filter(Boolean);
    if (ch.example) ch.example = pass(ch.example) || null;
  }
}

/** `flaw` and `flawRng` come with a writer's talent (talent §4.4): absent, the draft reads as it always did. */
export interface DraftOptions { banned: string[]; t?: number; flaw?: number; flawRng?: LocalRng; draw?: number }

/** A time or a quantity in a step: what makes it something to do rather than something to think about. */
const DURATIONS = /\s*\([^()]*\d[^()]*\)|,?\s+(?:au bout de|pendant|durant|en|sur|pour|sous|dans|à|a|de|d’|chaque|tous les|toutes les)?\s*\d+(?:\s*(?:à|ou|et)\s*\d+)?\s*(?:min(?:utes?)?|h|heures?|jours?|nuits?|soirs?|semaines?|mois|fois)\b(?:\s+près)?/giu;

/**
 * What a weak writer leaves in a guide, chapter by chapter, each one read by the usual scorers: a real cliché in a paragraph
 * (`humanTone`), the worked example forgotten (`structure`, half as often), a chapter's steps that lost their durations (`actionability`).
 */
function applyGuideFlaws(content: PdfContent, banned: readonly string[], c: NicheCtx, f: number, flawRng: LocalRng): void {
  const pool = flawRng.shuffle(CLICHE_TEMPLATES.filter((t) => !containsBanned(t, banned)));
  content.chapters.forEach((ch, i) => {
    const cliche = pool[i % Math.max(1, pool.length)];
    if (flawRng.chance(f) && cliche && ch.paragraphs.length) {
      const last = ch.paragraphs.length - 1;
      ch.paragraphs[last] = `${ch.paragraphs[last]} ${cliche.replace('{sujet}', c.subj.noun).replace('{diff}', c.subj.fem ? 'différente' : 'différent')}`;
    }
    if (flawRng.chance(f / 2)) ch.example = null;
    if (flawRng.chance(f)) ch.steps = ch.steps.map((s) => s.replace(DURATIONS, ''));
  });
}

/** Chapter definition of each outline chapter: by kind, else by role, else by position. */
function matchChapters(outline: Outline, c: NicheCtx, def: ArchetypeDef): ChapterDef[] {
  const all = def.chapters;
  const free = all.slice();
  const pick = (test: (ch: ChapterDef) => boolean): ChapterDef | undefined => {
    const i = free.findIndex(test);
    return i >= 0 ? free.splice(i, 1)[0] : undefined;
  };
  const raw = outline.chapters.slice(0, 7);
  const out = raw.map((ch, i) => (ch.kind ? pick((x) => x.kind === ch.kind) : undefined)
    ?? pick((x) => x.role === inferKind(ch.title ?? '', i, raw.length))
    ?? free.shift()
    ?? all[i % all.length]!);
  // a sparse outline (3-4 chapters) is completed up to 5
  while (out.length < 5 && free.length) out.push(free.shift()!);
  return out;
}

export function heuristicPdfContent(
  input: { title: string; outline: Outline; niche: NicheBrief; voc: VoiceOfCustomer; upsellTitle: string | null; upsellOf?: UpsellContext | null },
  rng: LocalRng,
  opts: DraftOptions,
): PdfContent {
  const upsellOf = input.upsellOf ?? null;
  const c = buildNicheCtx(input.niche, input.voc, upsellOf);
  const def = archetypeDef(c);
  const d = new Draft(c, rng);
  const outline = input.outline && Array.isArray(input.outline.chapters) && input.outline.chapters.length >= 3
    ? input.outline
    : heuristicOutline(input.title, input.niche, input.voc, rng, upsellOf);
  const defs = matchChapters(outline, c, def);
  for (const x of defs) d.kinds.add(x.kind);
  const plan = buildPlan(c, def);
  const parent = norm(upsellOf?.parentTitle ?? '');
  const given = clean(input.title) || clean(outline.title);
  const title = (given && norm(given) !== parent ? given : '') || c.topic?.title || cap(c.problem);
  const outcome = inline(promiseOutcome(c));
  const promise = def.promise(c, outcome);
  // the introduction is written first: it gets the first customer words and research items
  const intro0 = introduction(d, def, defs.length, promise);
  const built = defs.map((ch, i) => {
    const given0 = clean(outline.chapters[i]?.title);
    const reused = given0 && upsellOf ? upsellOf.parentChapterTitles.some((t) => norm(t) === norm(given0)) : false;
    // a count in a title is the count of the chapter, whatever the outline said earlier
    const n = countOf(ch.role, c, def);
    const titled = !given0 || reused ? titleOf(ch, c, def)
      : ['methode', 'erreurs', 'situations'].includes(ch.role) ? given0.replace(/\b\d+\b/, String(n)) : given0;
    return buildChapter(ch, titled, d, def, plan);
  });
  const chapters = built.map((b) => b.chapter);
  const upsell = clean(input.upsellTitle);
  const content: PdfContent = {
    title,
    subtitle: def.subtitle(c),
    audience: c.niche.audience,
    promise: cap(promise),
    introduction: intro0,
    chapters,
    bonus: buildBonus(c),
    howTo: def.howTo(c),
    nextStep: nextStepFor({ audience: c.audArt, upsell: upsell ? { title: upsell } : null }),
    wordCount: 0,
  };

  // padding is for thin research only: a well-researched guide stays dense, and it is trimmed if it runs over 4500 words
  let wc = pdfWordCount(content);
  const fillers = [...topicFillers(c), ...def.fillers];
  const floor = c.topic ? MIN_WORDS_SUITE + PASSES_TAKE : MIN_WORDS;
  while (wc < floor && fillers.length) {
    const target = built.map((b) => b.chapter).filter((ch) => ch.paragraphs.length < 8).sort((a, b) => a.paragraphs.length - b.paragraphs.length)[0];
    if (!target) break;
    const text = d.once(fillers.shift()!(d));
    if (!text) continue;
    target.paragraphs.push(text);
    wc = pdfWordCount(content);
  }
  // never a chapter with a single paragraph, whatever the research gave
  for (const b of built) {
    while (b.chapter.paragraphs.length < 2 && fillers.length) {
      const text = d.once(fillers.shift()!(d));
      if (text) b.chapter.paragraphs.push(text);
    }
  }
  let guard = 0;
  while (wc > 4500 && guard++ < 24) {
    // numbered paragraphs stay: the title announces them
    const target = built.filter((b) => !['erreurs', 'situations', 'methode'].includes(b.role)).map((b) => b.chapter).sort((a, b) => b.paragraphs.length - a.paragraphs.length)[0];
    if (!target || target.paragraphs.length <= 2) break;
    target.paragraphs.pop();
    wc = pdfWordCount(content);
  }

  // the rail comes last: it gets what the text left, so a page never says the same thing twice
  const printed = norm(allText(content));
  for (const b of built) {
    const quote = d.pullQuote();
    const note = d.note(printed);
    if (note || quote) b.chapter.margin = { note, quote: quote ? cap(bare(quote)) : null };
  }

  insertFlatSentences(content, c, rng, opts.banned, built.findIndex((b) => b.role === 'programme'));
  if (opts.flaw && opts.flawRng) applyGuideFlaws(content, opts.banned, c, opts.flaw, opts.flawRng);
  dropRepeats(content);
  const out = scrubDeep(content, opts.banned);
  out.wordCount = pdfWordCount(out);
  return out;
}

/** A paragraph that opens on its own head, as the layout reads it (`RUN_IN`): the bold exists only at the very start. */
const OPENS_ON_HEAD = /^[^:.!?]{4,34}\s:\s+\S/u;

/** The reference video: the first draft is "correct mais plat" → 4-8 generic sentences + risky claims. */
function insertFlatSentences(content: PdfContent, c: NicheCtx, rng: LocalRng, banned: readonly string[], planIndex: number): void {
  const n = Math.min(8, 4 + rng.int(0, 3) + (c.deep ? 1 : 0));
  const subj = c.subj;
  // a cliché the agent learned to ban (« Ne jamais écrire … ») is no longer written at all
  const cliches = rng.shuffle(CLICHE_TEMPLATES.filter((t) => !containsBanned(t, banned))).slice(0, n).map((t) => t.replace('{sujet}', subj.noun).replace('{diff}', subj.fem ? 'différente' : 'différent'));
  const slots: { arr: string[]; i: number }[] = [];
  content.introduction.forEach((_, i) => slots.push({ arr: content.introduction, i }));
  for (const ch of content.chapters) ch.paragraphs.forEach((_, i) => slots.push({ arr: ch.paragraphs, i }));
  const chosen = rng.shuffle(slots).slice(0, cliches.length);
  chosen.forEach((s, k) => {
    // the flaw stays and the draw with it, only its place changes: before a head it would take a step of the ladder out of it
    const atStart = rng.chance(0.35) && !OPENS_ON_HEAD.test(s.arr[s.i]!);
    s.arr[s.i] = atStart ? `${cliches[k]} ${s.arr[s.i]}` : `${s.arr[s.i]} ${cliches[k]}`;
  });
  // risky claims a careful fact-checker must catch (skipped when the agent learned to ban them)
  const prog = content.chapters[planIndex] ?? content.chapters[content.chapters.length - 1];
  const guarantee = `Avec ce plan, le résultat est garanti en ${c.dur.n} ${c.dur.unit}.`;
  if (prog && prog.paragraphs.length && rng.chance(0.75) && !conflictsWith('garanti', banned)) {
    prog.paragraphs[0] = `${prog.paragraphs[0]} ${guarantee}`;
  }
  const stat = 'Plus de 80 % des lecteurs qui appliquent ces étapes voient une nette différence dès la première semaine.';
  if (content.introduction.length >= 3 && rng.chance(0.65) && !conflictsWith('80 %', banned)) {
    content.introduction[2] = `${content.introduction[2]} ${stat}`;
  }
}
