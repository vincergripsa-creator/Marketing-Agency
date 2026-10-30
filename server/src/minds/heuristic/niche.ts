/**
 * Everything the writers need to know about a niche, pre-digested from the research
 * (NicheBrief + VoiceOfCustomer). Richer research → more raw material → richer content.
 */
import type { NicheBrief, VoiceOfCustomer } from '../../shared.js';
import {
  bare, bestLabel, cap, clauseLabel, clean, endsDangling, extractAgeRange, labelOf, lf, lowerFirst, norm, programmeDuration, shortAudience,
  subjectNoun, uniqStrings, withArticle, type Duration,
} from '../util.js';

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
  pains: string[]; phrases: string[]; objections: string[]; outcomes: string[];
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

export function buildNicheCtx(nicheIn: Partial<NicheBrief> | null | undefined, vocIn: VoiceOfCustomer | null | undefined): NicheCtx {
  const niche = safeNiche(nicheIn);
  const voc = safeVoc(vocIn, niche.nicheId);
  const k = voc.knowledge;
  const corpus = [niche.audience, niche.problem, niche.name, ...voc.pains, ...voc.phrases, ...k.steps, ...k.facts, ...k.tips, ...voc.desiredOutcomes];
  const age = extractAgeRange([niche.audience, niche.problem, ...voc.pains, ...voc.phrases, ...k.facts]);
  // An upsell brief may carry a desired outcome as its "problem": the pain then comes from the research.
  const goal = isGoal(niche.problem, voc.desiredOutcomes) ? niche.problem : null;
  const painCands = [...(goal ? [] : [niche.problem]), ...voc.pains].filter((p) => !firstPerson(p));
  const mainPain = painCands.find((p) => p.length <= 90) ?? painCands[0] ?? voc.pains[0] ?? niche.problem;
  const items = voc.pains.length + voc.phrases.length + k.tips.length + k.steps.length + k.mistakes.length + k.examples.length + k.facts.length;
  const adj = SOFT_HINT.test(norm(corpus.join(' '))) ? 'douce' : 'simple';
  const audArt = withArticle(niche.audience);
  const subj = subjectNoun(corpus);
  return {
    niche, voc,
    aud: lf(niche.audience),
    audArt,
    audShort: shortAudience(niche.audience),
    audTitle: titleAudience(audArt, 52),
    audCore: titleAudience(audArt, 40),
    problem: lf(goal ? mainPain : niche.problem),
    goal: goal ? lf(goal) : null,
    pbClause: lf(mainPain),
    pbIsClause: looksLikeClause(lf(mainPain)),
    pbShort: bestLabel([mainPain, ...voc.pains.filter((p) => !firstPerson(p))].map(headOf), 56, 10),
    painTitle: bestLabel([mainPain, ...painCands, niche.name].map(headOf), 55, 10) ?? cap(bare(niche.name)),
    care: ['bébé', 'enfant', 'chien', 'chat'].includes(subj.noun),
    stepCount: k.steps.length >= 3 ? Math.min(5, k.steps.length) : Math.min(6, uniqStrings([...k.steps, ...FALLBACK.steps]).length),
    age,
    dur: programmeDuration(corpus, niche.category, niche.keywords),
    subj,
    adj,
    adjM: adj === 'douce' ? 'doux' : adj,
    pains: voc.pains, phrases: voc.phrases, objections: voc.objections, outcomes: voc.desiredOutcomes,
    tips: k.tips, steps: k.steps, mistakes: k.mistakes, examples: k.examples, facts: k.facts,
    priceAnchors: voc.priceAnchors, bannedClaims: voc.bannedClaims,
    richness: Math.min(1, items / 32),
    deep: voc.depth === 'deep',
  };
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
    'Observer la situation quelques jours, sans rien changer',
    'Choisir un seul changement prioritaire',
    'Appliquer ce changement chaque jour, au même moment',
    'Mesurer le résultat dans un carnet',
    'Ajouter le changement suivant seulement quand le premier est acquis',
  ],
  mistakes: [
    'Changer de méthode tous les deux jours',
    'Vouloir tout corriger en même temps',
    'Abandonner après une seule mauvaise journée',
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
  const w = words.slice(1, 5);
  return w.some((x) => /^(s'|n')[a-z]/.test(x) || /^(se|ne|est|sont|a|ont|fait|font|va|vont|peut|veut|reste|refuse|pleure|mange|dort|aboie|tire|mord|crie|boude|arrive|oublie|perd|prend|bloque|griffe|detruit|ignore|tombe|ecaille|coule|seche)$/.test(x));
}
