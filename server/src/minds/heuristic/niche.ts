/**
 * Everything the writers need to know about a niche, pre-digested from the research
 * (NicheBrief + VoiceOfCustomer). Richer research → more raw material → richer content.
 */
import type { GuideArchetype, NicheBrief, VoiceOfCustomer } from '../../shared.js';
import type { UpsellContext } from '../../contracts.js';
import {
  bare, bestLabel, cap, clauseLabel, clean, endsDangling, extractAgeRange, labelOf, lf, lowerFirst, norm, programmeDuration, shortAudience,
  subjectNoun, uniqStrings, withArticle, type Duration,
} from '../util.js';
import { parseKnowledge, parseMistake, parseStep, type Material, type MethodStep, type MistakePair, type Situation } from './knowledge.js';
import { archetypeOf, knownProfile, type GuideProfile, type TopicSpec } from './profiles.js';
import { speakable } from './voice.js';

export interface NicheCtx {
  niche: NicheBrief;
  voc: VoiceOfCustomer;
  aud: string;            // "parents épuisés de bébés de 6 à 12 mois"
  audArt: string;         // "les parents épuisés de bébés de 6 à 12 mois"
  audShort: string;       // short label for hooks / captions
  audTitle: string;       // audience for titles, whole phrase ≤ 52 chars, with article ("les parents épuisés d'un bébé de 6 à 12 mois")
  audCore: string;        // tighter audience for titles, ≤ 40 chars ("les propriétaires d'un chiot")
  problem: string;        // lowercase-first clause (the PAIN, even when the brief states a goal)
  goal: string | null;    // the brief's "problem" when it is in fact a desired outcome (upsell guides)
  pbClause: string;       // main problem, lowercase-first ("bébé se réveille toutes les 2 heures")
  pbIsClause: boolean;    // pbClause reads as subject + verb (usable after « pourquoi », « quand », « si »)
  pbShort: string | null; // the problem in ≤ 56 chars, whole phrase, for quotes in titles / hooks (null when nothing fits)
  painTitle: string;      // the main pain as a clean title piece (≤ 55 chars, never cut mid-phrase)
  care: boolean;          // the reader looks after someone (baby, child, pet): « par amour », « l'entourage »…
  stepCount: number;      // steps of the method chapter (research steps, completed when thin)
  age: string | null;
  dur: Duration;
  subj: { noun: string; fem: boolean };
  adj: string;            // feminine form: "douce", "simple" (la méthode …)
  adjM: string;           // masculine form: "doux", "simple" (le guide …)
  archetype: GuideArchetype;
  profile: GuideProfile | null;
  topic: TopicSpec | null;        // sub-problem of a follow-up guide
  upsellOf: UpsellContext | null; // the guide this one follows
  method: MethodStep[];   // ranked steps, without the diagnostic one
  diag: MethodStep | null;
  pairs: MistakePair[];   // each mistake with its own fix
  situations: Situation[];
  observe: string[]; keep: string[]; models: string[];
  pains: string[]; phrases: string[]; objections: string[]; outcomes: string[];
  ownPains: string[];     // the pains this very guide treats: all of them, or only those of a follow-up's sub-problem
  tips: string[]; steps: string[]; mistakes: string[]; examples: string[]; facts: string[];
  priceAnchors: number[]; bannedClaims: string[];
  richness: number;       // 0..1
  deep: boolean;
}

const EMPTY_VOC: VoiceOfCustomer = {
  nicheId: '', depth: 'quick', pains: [], phrases: [], objections: [], desiredOutcomes: [],
  knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [],
};

/** Defensive copy: the research may be partial (quick scan) or missing fields. */
export function safeVoc(voc: VoiceOfCustomer | null | undefined, nicheId = ''): VoiceOfCustomer {
  const v = voc ?? { ...EMPTY_VOC, nicheId };
  const k = v.knowledge ?? EMPTY_VOC.knowledge;
  return {
    nicheId: v.nicheId ?? nicheId,
    depth: v.depth === 'deep' ? 'deep' : 'quick',
    pains: uniqStrings(v.pains ?? []),
    phrases: uniqStrings(v.phrases ?? []),
    objections: uniqStrings(v.objections ?? []),
    desiredOutcomes: uniqStrings(v.desiredOutcomes ?? []),
    knowledge: {
      tips: uniqStrings(k.tips ?? []), steps: uniqStrings(k.steps ?? []), mistakes: uniqStrings(k.mistakes ?? []),
      examples: uniqStrings(k.examples ?? []), facts: uniqStrings(k.facts ?? []),
      ...(k.archetype ? { archetype: k.archetype } : {}),
    },
    priceAnchors: (v.priceAnchors ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0),
    bannedClaims: uniqStrings(v.bannedClaims ?? []),
  };
}

export function safeNiche(n: Partial<NicheBrief> | null | undefined, fallbackName = 'cette niche'): NicheBrief {
  return {
    nicheId: clean(n?.nicheId) || 'niche',
    name: clean(n?.name) || fallbackName,
    audience: clean(n?.audience) || 'lecteurs pressés qui veulent une méthode claire',
    problem: clean(n?.problem) || clean(n?.name) || 'un problème concret du quotidien',
    category: clean(n?.category) || 'vie pratique',
    keywords: uniqStrings(n?.keywords ?? []),
  };
}

const SOFT_HINT = /doux|douce|sans pleur|bienveill|sans crier|sans punition|en douceur|respectueu/;

const EMPTY_MATERIAL: Material = { steps: [], pairs: [], situations: [], tips: [], facts: [], examples: [], observe: [], keep: [], models: [] };

/** A customer item that carries a claim the platform refuses is not quoted, whatever its wording. */
const claimFree = (banned: readonly string[]) => (s: string): boolean => !banned.some((b) => norm(s).includes(norm(b)));

/** Stops at the first follow-up sub-problem the parent guide does not cover yet. */
function pickTopic(profile: GuideProfile | null, upsell: UpsellContext, niche: NicheBrief): TopicSpec | null {
  const topics = profile?.topics ?? [];
  if (upsell.topicId !== undefined) return topics.find((t) => t.id === upsell.topicId) ?? null;
  const asked = norm(niche.problem);
  // a sub-problem already treated by the parent is not written twice (a guide's title and promise say what it is
  // about, its chapters do not); the writer then falls back on a free pain
  const fresh = (t: TopicSpec): boolean => norm(upsell.parentTitle) !== norm(t.title) && !norm(upsell.parentPromise).includes(norm(lf(t.goal)));
  return topics.find((t) => asked && norm(t.pain).includes(asked) && fresh(t)) ?? topics.find(fresh) ?? null;
}

/** A pain the parent guide does not treat, the one the brief names when it can, for a guide without a prepared sub-problem. */
function freePain(pains: readonly string[], upsell: UpsellContext): string | null {
  const covered = norm([upsell.parentTitle, upsell.parentPromise, ...upsell.parentChapterTitles].join(' '));
  return pains.find((p) => !firstPerson(p) && !covered.includes(norm(bare(p)).slice(0, 24))) ?? null;
}

/** An outcome the parent guide does not promise. */
function freeOutcome(outcomes: readonly string[], upsell: UpsellContext): string | null {
  const promised = norm(upsell.parentPromise);
  return outcomes.find((o) => !promised.includes(norm(bare(o)))) ?? null;
}

export function buildNicheCtx(nicheIn: Partial<NicheBrief> | null | undefined, vocIn: VoiceOfCustomer | null | undefined, upsellOf: UpsellContext | null = null): NicheCtx {
  const niche = safeNiche(nicheIn);
  const voc = safeVoc(vocIn, niche.nicheId);
  const k = voc.knowledge;
  const parsed = parseKnowledge(k);
  const profile = knownProfile(niche.nicheId);
  const topic = upsellOf ? pickTopic(profile, upsellOf, niche) : null;
  const mat = topic ? parsed.topics[topic.id] ?? EMPTY_MATERIAL : parsed.core;
  const clear = claimFree(voc.bannedClaims);
  const allPains = voc.pains.filter(clear);
  const pains = topic ? allPains.filter((p) => norm(p) !== norm(topic.pain)) : allPains;
  // An upsell brief may carry a desired outcome as its "problem": the pain then comes from the research.
  const briefIsGoal = isGoal(niche.problem, voc.desiredOutcomes);
  const free = upsellOf && !topic ? freePain(briefIsGoal ? allPains : [niche.problem, ...allPains], upsellOf) : null;
  // a follow-up guide only quotes the customers who talk about its sub-problem: the parent's words sell the parent
  const onTopic = (p: string): boolean => {
    if (topic) return topic.quotes.test(norm(p));
    if (!free) return true;
    const about = subjectWords(free);
    for (const w of subjectWords(niche.audience)) about.delete(w);
    return [...subjectWords(p)].some((w) => about.has(w));
  };
  const phrases = uniqStrings(voc.phrases.map(speakable)).filter((p) => p.length >= 6 && clear(p) && onTopic(p));
  const corpus = [niche.audience, niche.problem, niche.name, ...voc.pains, ...voc.phrases, ...k.steps, ...k.facts, ...k.tips, ...voc.desiredOutcomes];
  const age = extractAgeRange([niche.audience, niche.problem, ...voc.pains, ...voc.phrases, ...k.facts]);
  const goal = topic ? topic.goal : (free && freeOutcome(voc.desiredOutcomes, upsellOf!)) || (briefIsGoal ? niche.problem : null);
  const painCands = [...(topic ? [topic.pain] : free ? [free] : []), ...(goal ? [] : [niche.problem]), ...pains].filter((p) => !firstPerson(p));
  const mainPain = painCands.find((p) => p.length <= 90) ?? painCands[0] ?? pains[0] ?? niche.problem;
  const items = pains.length + phrases.length + mat.tips.length + mat.steps.length + mat.pairs.length + mat.examples.length + mat.facts.length;
  const adj = SOFT_HINT.test(norm(corpus.join(' '))) ? 'douce' : 'simple';
  const audArt = withArticle(niche.audience);
  const subj = subjectNoun(corpus);
  const steps = mat.steps.length ? mat.steps : [];
  const diag = steps.find((s) => s.diagnostic) ?? null;
  const ranked = steps.filter((s) => !s.diagnostic);
  const method = ranked.length >= 3 ? ranked : [...ranked, ...FALLBACK.steps.map((s, i) => parseStep(s, i + 1))].filter((s, i, a) => a.findIndex((x) => norm(x.text) === norm(s.text)) === i).slice(0, Math.max(5, ranked.length));
  // a sub-problem keeps its own mistakes, even two: the generic ones are about changing a habit
  const pairs = mat.pairs.length >= 3 || (topic && mat.pairs.length) ? mat.pairs : [...mat.pairs, ...FALLBACK.pairs.map(parseMistake)].filter((p, i, a) => a.findIndex((x) => norm(x.mistake) === norm(p.mistake)) === i);
  return {
    niche, voc,
    aud: lf(niche.audience),
    audArt,
    audShort: shortAudience(niche.audience),
    audTitle: titleAudience(audArt, 52),
    audCore: titleAudience(audArt, 46), // long enough for its age: « les parents épuisés d’un bébé » reads as tired of the baby
    problem: lf(topic ? topic.pain : free ?? (goal ? mainPain : niche.problem)),
    goal: goal ? lf(goal) : null,
    pbClause: lf(mainPain),
    pbIsClause: looksLikeClause(lf(mainPain)),
    pbShort: bestLabel([mainPain, ...pains.filter((p) => !firstPerson(p))].map(headOf), 56, 10),
    painTitle: bestLabel([mainPain, ...painCands, niche.name].map(headOf), 55, 10) ?? cap(bare(niche.name)),
    care: ['bébé', 'enfant', 'chien', 'chat'].includes(subj.noun),
    stepCount: method.length,
    age,
    dur: topic?.dur ?? profile?.dur ?? programmeDuration(corpus, niche.category, niche.keywords),
    subj,
    adj,
    adjM: adj === 'douce' ? 'doux' : adj,
    archetype: archetypeOf(niche, voc),
    profile,
    topic,
    upsellOf,
    method,
    diag,
    pairs,
    situations: mat.situations,
    observe: mat.observe, keep: mat.keep, models: mat.models,
    pains, phrases, objections: voc.objections, outcomes: voc.desiredOutcomes,
    ownPains: uniqStrings([...(topic ? [topic.pain] : free ? [free] : []), ...allPains.filter(onTopic)]),
    tips: mat.tips, steps: steps.map((s) => s.text), mistakes: mat.pairs.map((p) => p.mistake), examples: mat.examples, facts: mat.facts,
    priceAnchors: voc.priceAnchors, bannedClaims: voc.bannedClaims,
    richness: Math.min(1, items / 32),
    deep: voc.depth === 'deep',
  };
}

const COMMON_WORDS = new Set(['avec', 'sans', 'pour', 'dans', 'plus', 'tout', 'toute', 'tous', 'vous', 'nous', 'leur', 'cette', 'votre', 'etre', 'avoir', 'faire', 'savoir', 'quoi', 'chaque', 'quelque', 'sous', 'minute', 'jour', 'semaine', 'mois', 'plan']);

/** Words of a text that can tell two subjects apart (singular, without the small words). */
function subjectWords(text: string): Set<string> {
  return new Set(norm(text).split(/[^a-z0-9]+/).map((w) => w.replace(/[sx]$/, '')).filter((w) => w.length >= 4 && !COMMON_WORDS.has(w)));
}

/** A desired outcome about the sub-problem of the niche's follow-up guide: the main guide does not promise it, the follow-up does. */
export function belongsToFollowUp(outcome: string, c: Pick<NicheCtx, 'niche' | 'profile'>): boolean {
  const niche = subjectWords(`${c.niche.name} ${c.niche.problem} ${c.niche.audience}`);
  const said = subjectWords(outcome);
  return (c.profile?.topics ?? []).some((t) => [...subjectWords(`${t.pain} ${t.goal}`)].some((w) => said.has(w) && !niche.has(w)));
}

/** Head of a phrase before its own « : » / « ; » (« Les accidents de nuit : tous les matins… » → « Les accidents de nuit »). */
export function headOf(s: string): string {
  const head = clean(s).split(/\s+[:;]\s+/)[0] ?? '';
  return head.length >= 10 ? head : clean(s);
}

/** The brief's problem is one of the desired outcomes (« Un chiot propre en quelques semaines »). */
export function isGoal(problem: string, outcomes: readonly string[]): boolean {
  const p = norm(bare(problem));
  if (!p) return false;
  return outcomes.some((o) => {
    const n = norm(bare(o));
    return n.length >= 8 && (n === p || p.includes(n) || n.includes(p));
  });
}

/** Audience for a title: whole phrase with its article, shortened at a natural boundary (never « vivant en… »). */
export function titleAudience(audArt: string, max: number): string {
  const a = clean(audArt).replace(/\s*\([^)]*\)/g, '');
  if (a.length <= max) return a;
  const l = clauseLabel(a, max, 8);
  if (l) return lowerFirst(l);
  // « les propriétaires d'un chiot de 2 à 6 mois » → « les propriétaires d'un chiot »
  const m = /^(.{8,}?)\s+(?:de|d['’]|du|des)\s+\d/u.exec(a);
  if (m && m[1]!.length <= max && !endsDangling(m[1]!)) return m[1]!;
  return lowerFirst(labelOf(a, max));
}

/** "de" + elision: de(« allumer ») → "d'allumer". */
export function de(word: string): string {
  const w = lf(word);
  return /^[aeiouyàâéèêëîïôûùh]/i.test(w) ? `d'${w}` : `de ${w}`;
}

/** Starts with an infinitive verb ("Coucher bébé…", "Tenir un carnet…")? */
export function isInfinitive(s: string): boolean {
  const first = norm(bare(s)).split(/\s+/)[0] ?? '';
  if (/^(notre|votre|leur|entre|autre|quatre|chaque|mer|hier|cher|fier|super|premier|dernier|soir|noir|espoir|loisir|plaisir|desir|avenir|souvenir|pouvoir|devoir|savoir)$/.test(first)) return false;
  return /^(ne|n')$/.test(first) || /(er|ir|re|oir)$/.test(first);
}

/** Domain-neutral raw material used only when the research is thin (never invented numbers). */
export const FALLBACK = {
  tips: [
    'Préparer la veille ce qui demande de l’énergie',
    'Garder les mêmes horaires sept jours sur sept',
    'Noter chaque soir une chose qui a mieux marché',
    'Demander à l’entourage d’appliquer exactement la même règle',
    'Prévoir une solution de repli pour les jours sans énergie',
  ],
  steps: [
    'Choisir un seul changement prioritaire',
    'Appliquer ce changement chaque jour, au même moment',
    'Mesurer le résultat dans un carnet',
    'Ajouter le changement suivant seulement quand le premier est acquis',
    'Faire le point une fois par semaine et ajuster un seul élément',
  ],
  mistakes: [
    'Changer de méthode tous les deux jours',
    'Vouloir tout corriger en même temps',
    'Abandonner après une seule mauvaise journée',
  ],
  pairs: [
    'Changer de méthode tous les deux jours. Rien n’a le temps de produire un effet, et l’on conclut que rien ne marche. → Tenir une seule façon de faire pendant au moins une semaine avant de la juger.',
    'Vouloir tout corriger en même temps. Quand tout change, impossible de savoir ce qui a aidé, et l’énergie s’épuise vite. → Commencer par un seul point, le plus fréquent.',
    'Abandonner après une seule mauvaise journée. Un écart paraît énorme sur le moment, alors qu’il pèse peu sur plusieurs semaines. → Reprendre le plan dès le lendemain, à l’endroit où vous en étiez.',
  ],
  outcomes: ['retrouver un quotidien plus serein', 'savoir exactement quoi faire, même les mauvais jours'],
} as const;

export function titleCaseKeyword(k: string): string {
  return cap(bare(k));
}

/** "Je suis épuisée…", "on a tout essayé" — customer voice that cannot be used as a clause. */
export function firstPerson(s: string): boolean {
  return /^(je|j['’]|on|nous|mon|ma|mes|moi)\b/i.test(bare(s)) || /^j['’]/i.test(bare(s));
}

/** Rough check that a phrase is "subject + conjugated verb" (bébé se réveille…, il ne mange pas…). */
export function looksLikeClause(s: string): boolean {
  if (isInfinitive(s) || firstPerson(s)) return false;
  const words = norm(bare(s)).split(/\s+/);
  // a clause starts with a subject: pronoun, determiner + noun, or a bare « bébé »
  if (!/^(il|elle|ils|elles|bebe|le|la|les|l'.*|mon|ma|mes|son|sa|ses|leur|leurs|notre|votre|ce|cet|cette|un|une)$/.test(words[0] ?? '')) return false;
  if (/[:;]/.test(s)) return false;
  // « la peur que bébé s’étouffe », « le chiot qui pleure » : the verb of a relative clause does not make a sentence
  const rel = words.findIndex((x, i) => i > 0 && /^(qui|que|qu'.*|qu’.*|dont)$/.test(x));
  const w = words.slice(1, rel > 0 ? Math.min(5, rel) : 5);
  return w.some((x) => /^(s'|n')[a-z]/.test(x) || /^(se|ne|est|sont|a|ont|fait|font|va|vont|peut|veut|reste|refuse|pleure|mange|dort|aboie|tire|mord|crie|boude|arrive|oublie|perd|prend|bloque|griffe|detruit|ignore|tombe|ecaille|coule|seche)$/.test(x));
}
