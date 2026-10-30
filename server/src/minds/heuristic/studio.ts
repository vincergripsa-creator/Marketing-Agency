/**
 * Studio PDF: 10 titles → outline that sells → full first draft (deliberately "correct mais plat":
 * a few generic AI sentences and one or two risky claims the humanizer / fact-checker must catch).
 */
import type { ChapterContent, NicheBrief, PdfContent, VisualSpec, VoiceOfCustomer } from '../../shared.js';
import type { Outline } from '../../contracts.js';
import { CLICHE_TEMPLATES } from '../lexicon.js';
import { conflictsWith, scrubDeep } from '../playbook.js';
import {
  bare, cap, clean, extractAgeRange, fit, lf, lowerFirst, norm, ofAud, Pool, q, sentence, shortLabel, strArr, theUnit, uniqStrings, wordCount, type LocalRng,
} from '../util.js';
import { buildNicheCtx, de, FALLBACK, firstPerson, isInfinitive, titleCaseKeyword, type NicheCtx } from './niche.js';

export type Kind = 'comprendre' | 'diagnostic' | 'methode' | 'erreurs' | 'situations' | 'programme' | 'durer';

const ORDER: Record<number, Kind[]> = {
  5: ['comprendre', 'methode', 'erreurs', 'programme', 'durer'],
  6: ['comprendre', 'diagnostic', 'methode', 'erreurs', 'programme', 'durer'],
  7: ['comprendre', 'diagnostic', 'methode', 'erreurs', 'situations', 'programme', 'durer'],
};

export function chapterCount(c: NicheCtx): number {
  const items = c.pains.length + c.phrases.length + c.tips.length + c.steps.length + c.mistakes.length + c.examples.length + c.facts.length;
  if (c.deep && items >= 24) return 7;
  if (items >= 14) return 6;
  return 5;
}

export function inferKind(title: string, index: number, total: number): Kind {
  const t = norm(title);
  if (/erreur|piege|a eviter|ce qu'il ne faut pas/.test(t)) return 'erreurs';
  if (/diagnostic|observ|carnet|etat des lieux/.test(t)) return 'diagnostic';
  if (/situation|imprevu|deraill|cas difficile|rechute|\bsos\b|mauvais jours/.test(t)) return 'situations';
  if (/\b(plan|programme|calendrier|planning)\b|apres (nuit|jour|semaine)|\b\d+ (nuits|jours|semaines|soirs)\b/.test(t)) return 'programme';
  if (/tenir|duree|long terme|garder les acquis|maintenir|habitude/.test(t)) return 'durer';
  if (/comprendre|pourquoi|ce qui se passe|mecanisme|origine|cause/.test(t)) return 'comprendre';
  if (/methode|etape|pas a pas|technique|protocole/.test(t)) return 'methode';
  const order = ORDER[Math.min(7, Math.max(5, total))] ?? ORDER[7]!;
  return order[Math.min(order.length - 1, Math.round((index / Math.max(1, total - 1)) * (order.length - 1)))] ?? 'methode';
}

// ───────────────────────────── titles ─────────────────────────────

function sansClause(c: NicheCtx): string | null {
  for (const p of [...c.phrases, ...c.outcomes, ...c.objections]) {
    const m = /\bsans\s+([^,.;!?»]{4,40})/i.exec(p);
    if (m) return `sans ${bare(m[1]!)}`;
  }
  return null;
}

function shortPhrase(c: NicheCtx, rng: LocalRng, max = 46): string | null {
  const ok = c.phrases.filter((p) => bare(p).length <= max && bare(p).length >= 8);
  return ok.length ? bare(rng.pick(ok)) : c.phrases[0] ? fit(bare(c.phrases[0]), max) : null;
}

export function heuristicTitles(nicheIn: NicheBrief, vocIn: VoiceOfCustomer, count: number, rng: LocalRng): string[] {
  const c = buildNicheCtx(nicheIn, vocIn);
  const n = Number.isFinite(count) && count > 0 ? Math.min(30, Math.floor(count)) : 10;
  const painT = cap(fit(c.pbClause, 70));
  const audP = fit(c.audArt, 70);
  const audS = c.audShort;
  const ageSfx = c.age && !extractAgeRange([c.niche.audience]) ? ` (${c.age})` : '';
  const ph = shortPhrase(c, rng);
  const ph2 = shortPhrase(c, rng);
  const desired = lf(c.outcomes[0] ?? FALLBACK.outcomes[0]);
  const desiredQ = cap(fit(bare(c.outcomes[0] ?? FALLBACK.outcomes[0]), 50));
  const desiredB = bare(c.outcomes[1] ?? c.outcomes[0] ?? FALLBACK.outcomes[1]);
  const pbQ = c.pbShort ? cap(q(c.pbShort)) : null;
  const steps = c.stepCount;
  const errs = Math.min(5, Math.max(3, c.mistakes.length || 3));
  const kw = titleCaseKeyword(c.niche.keywords[0] ?? c.niche.name);
  const mistake = c.mistakes.find(isInfinitive);
  const sans0 = sansClause(c);
  const sans = sans0 && !norm(desired).includes(norm(sans0)) ? sans0 : null;
  const { n: d, unit } = c.dur;

  const all: string[] = [
    `${painT} : la méthode ${c.adj} en ${d} ${unit} pour ${audP}${ageSfx}`,
    ph ? `Fini ${q(ph)} : le plan pas à pas pour ${audP}` : `Fini les galères : le plan pas à pas pour ${audP}`,
    `${cap(fit(c.problem, 70))} : ${steps} étapes concrètes pour ${audP}`,
    `Objectif « ${desiredQ} » : le plan de ${d} ${unit} pour ${audP}`,
    mistake ? `${cap(audS)} : arrêtez ${de(fit(bare(mistake), 60))} (et faites plutôt ceci)` : `${cap(audS)} : l’erreur qui entretient tout (et quoi faire à la place)`,
    ph2 ? `De ${q(ph2)} à « ${fit(desiredB, 50)} » : le guide pratique pour ${audP}` : `Le guide pratique pour ${audP} : ${desired}`,
    pbQ ? `${pbQ} : les ${errs} erreurs qui entretiennent tout (et quoi faire à la place)` : `Les ${errs} erreurs qui entretiennent le problème — guide pour ${audP}`,
    `SOS ${kw} : le protocole ${c.adjM} pour ${audP}`,
    `${cap(desired)} : la méthode ${c.adj} pour ${audP}${sans ? `, ${sans}` : ''}`,
    ph ? `${d} ${unit} pour en finir avec ${q(ph)} — ${audS}` : `${d} ${unit} pour reprendre la main — ${audS}`,
    pbQ ? `${pbQ} ? Pourquoi ça arrive, et comment s’en sortir en ${d} ${unit}` : `Pourquoi ça bloque, et comment s’en sortir en ${d} ${unit} — ${audS}`,
    ph ? `${cap(audS)}${ageSfx} : le guide ${c.adjM} pour en finir avec ${q(ph)}` : `${cap(audS)}${ageSfx} : le guide ${c.adjM}, étape par étape`,
  ];
  let titles = uniqStrings(rng.shuffle(all.map(clean)));
  // keep the strongest formula (problem + method + audience) first
  const lead = clean(all[0]!);
  titles = [lead, ...titles.filter((t) => t !== lead)];
  let k = 2;
  while (titles.length < n) titles.push(`${lead} — édition ${k++}`);
  return titles.slice(0, n);
}

// ───────────────────────────── outline ─────────────────────────────

function chapterTitle(kind: Kind, c: NicheCtx, rng: LocalRng): string {
  const { n, unit, unitOne } = c.dur;
  switch (kind) {
    case 'comprendre': return rng.pick(['Comprendre ce qui se passe vraiment', 'Pourquoi ça bloque (et pourquoi ce n’est pas de votre faute)']);
    case 'diagnostic': return 'Le diagnostic en 3 jours : observer avant d’agir';
    case 'methode': return `La méthode ${c.adj} en ${c.stepCount} étapes`;
    case 'erreurs': return `Les ${Math.min(5, Math.max(3, c.mistakes.length || 3))} erreurs qui entretiennent le problème`;
    case 'situations': return 'Les situations qui font tout dérailler (et quoi faire)';
    case 'programme': return `Le plan de ${n} ${unit}, ${unitOne} après ${unitOne}`;
    case 'durer': return 'Tenir dans la durée sans s’épuiser';
  }
}

function phases(c: NicheCtx): { label: string; action: string }[] {
  const { n, unit } = c.dur;
  const U = cap(unit);
  const cuts = [0, Math.max(1, Math.round(n * 0.2)), Math.max(2, Math.round(n * 0.5)), Math.max(3, Math.round(n * 0.78)), n];
  const steps = c.steps.length >= 3 ? c.steps : [...c.steps, ...FALLBACK.steps].slice(0, 5);
  const acts = [
    steps[0]!,
    steps[1] ?? steps[0]!,
    steps.slice(2, 4).map(lf).join(', puis ') || steps[0]!,
    `consolider : garder tout ce qui marche et ne rien ajouter de nouveau`,
  ];
  const out: { label: string; action: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = cuts[i]! + 1;
    const b = Math.max(a, cuts[i + 1]!);
    out.push({ label: a === b ? `${U.replace(/s$/, '')} ${a}` : `${U} ${a} à ${b}`, action: acts[i]! });
  }
  return out;
}

function points(kind: Kind, c: NicheCtx): string[] {
  const s = (arr: readonly string[], k: number) => arr.slice(0, k).map((x) => sentence(x));
  switch (kind) {
    case 'comprendre': return [...s(c.facts, 2), ...s(c.pains, 2)].slice(0, 4).concat(c.facts.length + c.pains.length ? [] : ['Le mécanisme qui entretient le problème.', 'Pourquoi les solutions « classiques » échouent.']);
    case 'diagnostic': return ['Tenir un carnet d’observation pendant 3 jours.', 'Repérer le moment qui revient le plus.', 'Choisir une seule priorité.'];
    case 'methode': return s(c.steps.length >= 3 ? c.steps : uniqStrings([...c.steps, ...FALLBACK.steps]), c.stepCount);
    case 'erreurs': return s(c.mistakes.length ? c.mistakes : FALLBACK.mistakes, 4);
    case 'situations': return [...c.phrases.slice(0, 3).map((p) => `Quand on se dit ${q(p)}.`), 'Les jours sans énergie.'].slice(0, 4);
    case 'programme': return phases(c).map((p) => `${p.label} : ${lf(p.action)}.`);
    case 'durer': return s(c.tips.length ? c.tips : FALLBACK.tips, 4);
  }
}

function bonusTitle(c: NicheCtx, rng: LocalRng): string {
  return rng.pick([
    'Bonus : la fiche SOS à garder sous la main',
    `Bonus : le carnet de suivi de ${c.dur.n} ${c.dur.unit} à imprimer`,
    'Bonus : les phrases toutes prêtes pour les moments difficiles',
  ]);
}

export function heuristicOutline(title: string, nicheIn: NicheBrief, vocIn: VoiceOfCustomer, rng: LocalRng): Outline {
  const c = buildNicheCtx(nicheIn, vocIn);
  const kinds = ORDER[chapterCount(c)]!;
  const next = c.pains.find((p) => norm(lf(p)) !== norm(c.pbClause) && !firstPerson(p) && p.length <= 90);
  return {
    title: clean(title) || cap(c.problem),
    chapters: kinds.map((k) => ({ title: chapterTitle(k, c, rng), points: points(k, c) })),
    bonusTitle: bonusTitle(c, rng),
    nextStepTitle: next ? `La suite est ici : ${cap(fit(bare(next), 70))}` : 'La suite est ici : aller plus loin',
  };
}

// ───────────────────────────── the draft ─────────────────────────────

class Draft {
  readonly tips: Pool<string>;
  readonly steps: Pool<string>;
  readonly mistakes: Pool<string>;
  readonly examples: Pool<string>;
  readonly facts: Pool<string>;
  readonly phrases: Pool<string>;
  readonly pains: Pool<string>;
  readonly outcomes: Pool<string>;
  /** Steps of the chapter being written (method paragraphs follow the numbered list). */
  chapterSteps: string[] = [];

  constructor(readonly c: NicheCtx, readonly rng: LocalRng) {
    this.tips = new Pool(c.tips.length >= 3 ? c.tips : uniqStrings([...c.tips, ...FALLBACK.tips]));
    this.steps = new Pool(c.steps.length >= 3 ? c.steps : uniqStrings([...c.steps, ...FALLBACK.steps]));
    this.mistakes = new Pool(c.mistakes.length >= 3 ? c.mistakes : uniqStrings([...c.mistakes, ...FALLBACK.mistakes]));
    this.examples = new Pool(c.examples, rng);
    this.facts = new Pool(c.facts);
    this.phrases = new Pool(c.phrases, rng);
    this.pains = new Pool(c.pains);
    this.outcomes = new Pool(c.outcomes.length ? c.outcomes : FALLBACK.outcomes);
  }

  tip(): string { return lf(this.tips.take()!); }
  step(): string { return lf(this.steps.take()!); }
  /** i-th step of the current chapter (falls back to the shared pool). */
  cs(i: number): string { const s = this.chapterSteps[i]; return s ? lf(s) : this.step(); }
  mistake(): string { return lf(this.mistakes.take()!); }
  outcome(): string { return lf(this.outcomes.take()!); }
  /** Facts are never repeated: once used, the templates fall back to fact-free wording. */
  fact(): string | null { const f = this.facts.takeFresh(); return f ? lf(f) : null; }
  phrase(): string | null { return this.phrases.take(); }
  /** Pain as customer words, always quoted (works whatever its grammatical form). */
  painQ(): string { const p = this.pains.take(); return q(p ?? this.c.pbClause); }
}

type Para = (d: Draft) => string;

const why = [
  'On le fait parce que ça soulage sur le moment, mais le problème revient dès le lendemain, souvent plus fort.',
  'C’est logique sur le papier ; dans les faits, cela brouille les repères et rallonge tout.',
  'Le piège, c’est que l’effet négatif n’apparaît que quelques jours plus tard : on ne fait donc jamais le lien.',
  'C’est l’erreur la plus citée dans les témoignages que nous avons lus, et aussi la plus facile à corriger.',
];

const PARAS: Record<Kind, Para[]> = {
  comprendre: [
    (d) => {
      const f = d.fact();
      return f
        ? `Commençons par un repère que peu de gens connaissent : ${f}. Autrement dit, le problème n’est pas toujours là où on le cherche. Quand on relit les témoignages de près, derrière ${d.painQ()} on retrouve presque toujours le même mécanisme : une habitude installée sans le vouloir, qui se répète jour après jour.`
        : `Le problème n’est pas toujours là où on le cherche. Quand on relit les témoignages de près, derrière ${d.painQ()} on retrouve presque toujours le même mécanisme : une habitude installée sans le vouloir, qui se répète jour après jour jusqu’à devenir « normale ».`;
    },
    (d) => {
      const p = d.phrase();
      return p
        ? `Quand on lit ${q(p)} dans un commentaire, on entend de l’épuisement. Mais on entend aussi un cercle : plus la situation dure, moins on a d’énergie pour tenir une règle, et plus on improvise. Or l’improvisation, c’est précisément ce qui entretient le problème. Ce guide sert d’abord à sortir de ce cercle.`
        : `Plus la situation dure, moins on a d’énergie pour tenir une règle, et plus on improvise. Or l’improvisation, c’est précisément ce qui entretient le problème. Ce guide sert d’abord à sortir de ce cercle, avec des gestes simples et toujours les mêmes.`;
    },
    (d) => `La bonne nouvelle, c’est qu’un mécanisme appris peut se désapprendre. Ce qui entretient la difficulté, ce sont souvent de petits gestes répétés, par exemple : ${d.mistake()}. Personne ne vous l’a dit, vous ne pouviez donc pas le savoir. À partir d’aujourd’hui, vous allez le savoir.`,
    (d) => {
      const f = d.fact();
      return f
        ? `Deuxième repère utile : ${f}. Gardez cette phrase en tête pendant tout le programme. Elle évite de paniquer au premier écart et de tout recommencer à zéro.`
        : `Retenez une idée simple : un écart n’annule pas les progrès. Ce qui compte, c’est la direction sur plusieurs jours, pas la perfection d’une seule journée.`;
    },
  ],
  diagnostic: [
    () => 'Pourquoi observer d’abord ? Parce que la mémoire ment quand on est épuisé. On a l’impression que « c’est tout le temps », alors qu’un carnet révèle souvent deux ou trois moments précis où tout se joue. Ces moments-là sont vos leviers.',
    (d) => `Le carnet tient sur une page : l’heure, ce qui s’est passé juste avant, votre réaction, et le résultat. Pas besoin d’application ni de tableau compliqué. Un détail compte : notez aussi les bons moments. Ce sont eux qui montrent ce qui marche déjà, par exemple quand vous pensez à ${d.tip()}.`,
    (d) => {
      const p = d.phrase();
      return `${p ? `Beaucoup nous ont écrit ${q(p)}. ` : ''}En relisant leur carnet après trois jours, la plupart repèrent un schéma qui se répète : même heure, même déclencheur, même réaction. C’est ce schéma, et lui seul, que vous allez travailler en premier.`;
    },
    () => 'Pendant ces trois jours, ne changez rien. C’est frustrant, mais c’est ce qui rend le diagnostic fiable : si vous modifiez tout en même temps, vous ne saurez jamais ce qui a vraiment fonctionné.',
  ],
  methode: [
    (d) => `Première étape : ${d.cs(0)}. Elle paraît simple, et c’est voulu : une méthode qu’on n’arrive pas à tenir un soir de fatigue ne sert à rien. Astuce de terrain : ${d.tip()}.`,
    (d) => `Ensuite, ${d.cs(1)}. C’est souvent l’étape qu’on saute quand on est pressé, et c’est pourtant elle qui fait la différence au bout d’une semaine. Faites-la au même moment chaque jour, même quand tout semble aller mieux.`,
    (d) => {
      const p = d.phrase();
      return `La troisième étape demande un peu de constance : ${d.cs(2)}. ${p ? `Si vous vous dites ${q(p)}, c’est normal` : 'Les premiers jours sont les plus durs, c’est normal'} : le nouveau repère met quelques ${d.c.dur.unit} à s’installer, puis il devient automatique.`;
    },
    (d) => `Un détail qui change tout : ${d.tip()}. Ce n’est pas un gadget, c’est ce qui rend les étapes précédentes plus faciles à tenir. Les témoignages qui parlent de réussite mentionnent presque tous ce genre de petit ajustement.`,
  ],
  erreurs: [
    (d) => `Erreur n°1 : ${d.mistake()}. ${why[0]} À la place : ${d.tip()}.`,
    (d) => `Erreur n°2 : ${d.mistake()}. ${why[1]} À la place, revenez à la méthode du chapitre précédent : ${d.step()}.`,
    (d) => `Erreur n°3 : ${d.mistake()}. ${why[2]} La parade est simple : décidez à l’avance de ce que vous ferez, et écrivez-le.`,
    (d) => `Dernier piège, plus discret : ${d.mistake()}. ${why[3]}`,
  ],
  situations: [
    (d) => {
      const p = d.phrase();
      return `Situation n°1 : les jours où vous êtes à bout${p ? ` et où vous vous dites ${q(p)}` : ''}. Que faire ? Revenir à la version minimale du plan : une seule action, toujours la même — ${d.step()}. Une mauvaise journée n’efface pas les progrès.`;
    },
    (d) => `Situation n°2 : l’entourage n’applique pas la même règle. C’est la cause de rechute la plus fréquente. Prenez cinq minutes pour vous mettre d’accord sur une seule consigne, écrite noir sur blanc, et affichez-la. Exemple de consigne : ${d.tip()}.`,
    () => 'Situation n°3 : un imprévu casse le rythme (maladie, voyage, changement d’horaires). Ne cherchez pas à « tenir quand même ». Mettez le plan en pause, puis reprenez au début de la phase où vous étiez, pendant 48 heures, avant de continuer.',
    (d) => `Situation n°4 : ça marchait, et tout recommence. C’est fréquent et ce n’est pas un échec. Vérifiez d’abord qu’une ancienne habitude n’est pas revenue, par exemple : ${d.mistake()}.`,
  ],
  programme: [
    (d) => {
      const ph = phases(d.c);
      return `${ph[0]!.label} : ${lf(ph[0]!.action)}. On ne cherche pas encore de résultat, on installe le cadre. ${ph[1]!.label} : ${lf(ph[1]!.action)}. C’est la phase la plus exigeante, celle où l’on a envie d’abandonner ; tenez bon, c’est elle qui fait basculer la suite.`;
    },
    (d) => {
      const ph = phases(d.c);
      return `${ph[2]!.label} : ${lf(ph[2]!.action)}. À ce stade, la plupart des témoignages décrivent les premiers vrais changements. ${ph[3]!.label} : ${lf(ph[3]!.action)}. Résistez à l’envie d’en faire plus : la stabilité est le meilleur signe de réussite.`;
    },
    (d) => `Chaque soir, cochez la case du jour et notez un seul chiffre ou un seul mot sur la journée. Au bout de ${d.c.dur.n} ${d.c.dur.unit}, vous aurez une preuve concrète de vos progrès, bien plus fiable que l’impression du moment.`,
  ],
  durer: [
    (d) => `À quoi ressemble la réussite ? Concrètement : ${d.outcome()}. Notez la date du jour où cela arrive pour la première fois. Les soirs de doute, cette date sera votre meilleure preuve.`,
    (d) => `Pour garder les acquis, trois réflexes suffisent. D’abord, ${d.tip()}. Ensuite, ${d.tip()}. Enfin, gardez votre carnet à portée de main : il vous dira tout de suite si une ancienne habitude revient.`,
    (d) => `Si un jour tout semble remis en cause, rouvrez le chapitre des erreurs. Dans la grande majorité des rechutes décrites par nos lecteurs, une seule chose avait changé, par exemple : ${d.mistake()}. Corrigez ce point, et le reste suit.`,
  ],
};

const FILLERS: Para[] = [
  (d) => `Ce chapitre ne vous demande pas d’être parfait. Il vous demande de faire la même chose, au même moment, plusieurs ${d.c.dur.unit} de suite. C’est cette répétition qui transforme une bonne idée en résultat concret.`,
  (d) => {
    const o = d.outcome();
    return `Gardez le cap en vous rappelant pourquoi vous faites tout ça : ${o}. Écrivez-le sur un post-it, collez-le là où vous le verrez chaque jour. Ça paraît anodin ; c’est souvent ce qui fait tenir la deuxième semaine.`;
  },
  (d) => `Si vous ne deviez garder qu’une idée de ce chapitre : ${d.tip()}. Le reste vient en complément, quand ce premier réflexe est bien installé.`,
  () => 'Un repère pratique : bloquez dans votre agenda un créneau fixe de dix minutes pour ce chapitre. Ce qui est planifié se fait ; ce qui reste « à faire quand j’aurai le temps » ne se fait presque jamais.',
  () => 'Parlez-en autour de vous. Expliquer la méthode à quelqu’un de votre entourage vous oblige à la clarifier, et vous donne un allié les jours où la motivation baisse.',
  (d) => `Soyez précis dans vos notes : « mieux » ou « moins bien » ne suffit pas. Notez l’heure, la durée et ce qui a changé. Au bout de ${d.c.dur.n} ${d.c.dur.unit}, ces détails sépareront une impression d’une preuve.`,
];

/** One natural mention of the reader per chapter (the reader must feel the guide was written for them). */
const AUDIENCE_LINE: Record<Kind, (c: NicheCtx) => string> = {
  comprendre: (c) => `Chez ${c.audArt}, c’est presque toujours le même scénario.`,
  diagnostic: (c) => `Pour ${c.audArt}, ces trois jours d’observation changent souvent tout le regard sur le problème.`,
  methode: (c) => `Chaque étape a été pensée pour ${c.audArt} : courte, concrète, réaliste.`,
  erreurs: (c) => `Ce sont celles qui reviennent le plus souvent chez ${c.audArt}.`,
  situations: (c) => `Ce sont les situations les plus décrites par ${c.audArt}.`,
  programme: (c) => `Ce rythme est pensé pour le quotidien ${ofAud(c.audArt)}.`,
  durer: (c) => `C’est l’étape la plus négligée par ${c.audArt}, et pourtant celle qui fait durer les résultats.`,
};

function intro(kind: Kind, c: NicheCtx, rng: LocalRng): string {
  const { n, unit } = c.dur;
  const by: Record<Kind, string[]> = {
    comprendre: [
      `Avant de changer quoi que ce soit, il faut comprendre le mécanisme qui se cache derrière ${q(fit(c.pbClause, 80))}, et pourquoi les solutions « classiques » échouent si souvent.`,
      `On ne règle bien que ce qu’on comprend. Ici, vous allez voir le mécanisme qui entretient la situation — et pourquoi ce n’est pas de votre faute.`,
    ],
    diagnostic: ['On ne corrige bien que ce qu’on a observé. Pendant trois jours, vous allez simplement noter ce qui se passe, sans rien changer. C’est la base de tout le reste.'],
    methode: [
      'Voici le cœur du guide : la méthode, étape par étape. Chaque étape s’appuie sur la précédente — l’ordre compte plus que la perfection.',
      'Place à l’action. Les étapes qui suivent sont courtes, concrètes, et pensées pour être tenues même un jour de grande fatigue.',
    ],
    erreurs: ['Ces erreurs, presque tout le monde les fait, souvent par amour ou par fatigue. Les repérer, c’est déjà faire la moitié du chemin.'],
    situations: ['Même avec la meilleure méthode, il y a des jours où tout déraille. Voici les situations qui reviennent le plus dans les témoignages, et la réponse à donner à chacune.'],
    programme: [`Voici le plan concret sur ${n} ${unit}. Il est volontairement progressif : chaque phase n’ajoute qu’une seule nouveauté.`],
    durer: ['Le vrai défi n’est pas de réussir une semaine : c’est de tenir quand la vie reprend ses droits. Ce chapitre vous aide à garder les acquis.'],
  };
  return rng.pick(by[kind]);
}

function stepsFor(kind: Kind, points: string[], d: Draft): string[] {
  const fromPoints = points.map(bare).filter((p) => p.length > 6 && !/^quand on se dit/i.test(p));
  let steps: string[];
  switch (kind) {
    case 'comprendre':
      steps = [
        'Noter, pendant 24 heures, chaque moment difficile : l’heure et ce qui s’est passé juste avant',
        'Relire les mécanismes de ce chapitre et entourer celui qui vous ressemble le plus',
        `Repérer une habitude à arrêter dès cette semaine, par exemple : ${d.mistake()}`,
      ];
      break;
    case 'diagnostic':
      steps = [
        'Préparer une page avec quatre colonnes : heure, contexte, réaction, résultat',
        'Tout noter pendant 3 jours, sans rien changer',
        'Surligner les moments qui reviennent au moins deux fois',
        'Choisir UN seul moment à travailler en priorité',
      ];
      break;
    case 'methode':
      steps = fromPoints.length >= 3 ? fromPoints : uniqStrings([...fromPoints, ...d.c.steps, ...FALLBACK.steps]);
      break;
    case 'erreurs':
      steps = [
        'Relire la liste et entourer les erreurs que vous faites aujourd’hui',
        'Pour chacune, écrire ce que vous ferez à la place (voir le tableau)',
        'Corriger une erreur à la fois, en commençant par la plus fréquente',
      ];
      break;
    case 'situations':
      steps = [
        'Préparer à l’avance votre « plan minimal » pour les jours sans énergie',
        'Mettre tout le foyer d’accord sur une seule consigne écrite',
        'Après un imprévu, reprendre la phase en cours pendant 48 heures avant de continuer',
      ];
      break;
    case 'programme':
      steps = phases(d.c).map((p) => `${p.label} : ${lf(p.action)}`);
      break;
    case 'durer':
      steps = fromPoints.length >= 3 ? fromPoints : uniqStrings([...fromPoints, ...d.c.tips, ...FALLBACK.tips]);
      break;
  }
  return uniqStrings(steps).slice(0, 6).map(sentence);
}

function checklistFor(kind: Kind, steps: string[], c: NicheCtx): string[] {
  const short = (s: string) => lowerFirst(shortLabel(s, 60));
  switch (kind) {
    case 'comprendre': return ['J’ai noté 24 heures d’observation', 'J’ai identifié le mécanisme principal', 'Je connais l’habitude à arrêter en premier', ...(c.facts[0] && c.facts[0].length <= 70 ? [`Je retiens : ${lf(c.facts[0])}`] : ['Je connais les repères clés du chapitre'])];
    case 'diagnostic': return ['Mon carnet est prêt', 'J’ai noté 3 jours complets', 'J’ai repéré le moment qui revient le plus', 'J’ai choisi une seule priorité'];
    case 'erreurs': return (c.mistakes.length ? c.mistakes : FALLBACK.mistakes).slice(0, 5).map((m) => `Je ne fais plus : ${short(m)}`);
    case 'programme': return phases(c).map((p) => `Phase « ${p.label} » terminée`).concat('Carnet rempli chaque soir');
    default: return steps.slice(0, 5).map((s) => `Fait : ${short(s)}`);
  }
}

function descending(rng: LocalRng, k: number): number[] {
  let v = rng.int(72, 88);
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    out.push(Math.max(8, Math.min(95, v)));
    v -= rng.int(8, 15);
  }
  return out;
}

function visualFor(kind: Kind, steps: string[], d: Draft): VisualSpec {
  const c = d.c;
  switch (kind) {
    case 'comprendre': {
      const labels = (c.pains.length >= 3 ? c.pains : [...c.pains, ...c.mistakes, ...FALLBACK.mistakes]).slice(0, 5).map((p) => shortLabel(p, 48));
      return { type: 'bar_chart', title: 'Ce qui revient le plus dans les témoignages (indice de fréquence)', labels, values: descending(d.rng, labels.length) };
    }
    case 'diagnostic':
      return { type: 'checklist_card', title: 'Votre grille d’observation (3 jours)', labels: ['Heure', 'Ce qui s’est passé juste avant', 'Ma réaction', 'Le résultat'], values: [] };
    case 'methode':
      return { type: 'steps_diagram', title: `La méthode en ${steps.length} étapes`, labels: steps.map((s) => shortLabel(s, 48)), values: [] };
    case 'erreurs': {
      const dont = (c.mistakes.length ? c.mistakes : FALLBACK.mistakes).slice(0, 3);
      const dos = [...c.tips, ...c.steps, ...FALLBACK.tips].slice(0, dont.length);
      return { type: 'do_dont', title: 'À éviter / à faire à la place', labels: [...dont.map((m) => shortLabel(m, 44)), ...dos.map((t) => shortLabel(t, 44))], values: [] };
    }
    case 'situations': {
      const p = c.phrases[1] ?? c.phrases[0];
      return { type: 'quote', title: 'Ce qu’on lit le plus souvent', labels: [p ? cap(bare(p)) : 'Une mauvaise journée n’efface pas les progrès', p ? 'Un commentaire parmi des dizaines du même genre' : 'La règle d’or des jours difficiles'], values: [] };
    }
    case 'programme':
      return { type: 'timeline', title: `Votre plan sur ${c.dur.n} ${c.dur.unit}`, labels: phases(c).map((p) => `${p.label} : ${lowerFirst(shortLabel(p.action, 44))}`), values: [] };
    case 'durer': {
      const labels = (c.tips.length >= 4 ? c.tips : [...c.tips, ...FALLBACK.tips]).slice(0, 6).map((t) => shortLabel(t, 40));
      return { type: 'icon_grid', title: 'Vos réflexes pour tenir', labels, values: [] };
    }
  }
}

function exampleFor(d: Draft): string | null {
  const ex = d.examples.takeFresh();
  if (ex) return sentence(ex);
  const p = d.phrase();
  if (!p) return null;
  // no invented testimonial: an explicit, second-person scenario built from real customer words
  const k = d.rng.int(0, 2);
  const unit = d.c.dur.unitOne;
  if (k === 0) return `Mise en situation : un soir, vous vous surprenez à penser ${q(p)}. Au lieu de tout changer d’un coup, vous appliquez une seule chose : ${d.step()}. Le lendemain, vous notez dans le carnet ce qui s’est passé, sans juger.`;
  if (k === 1) return `Mise en situation : c’est ${theUnit(unit)} 4, et ${q(p)} vous revient en tête. C’est exactement le moment de tenir la règle choisie — ${d.step()} — plutôt que d’improviser. Cochez la case du jour : c’est cette régularité qui paie.`;
  return `Mise en situation : vous lisez ce chapitre en vous disant ${q(p)}. Commencez petit, dès aujourd’hui : ${d.step()}. Ne jugez le résultat qu’après plusieurs ${d.c.dur.unit}, carnet en main.`;
}

function buildChapter(title: string, pts: string[], kind: Kind, d: Draft, nParas: number): { chapter: ChapterContent; spare: Para[] } {
  // numbered kinds keep their natural order, the others vary per seed
  const ordered = kind === 'erreurs' || kind === 'programme' || kind === 'situations' || kind === 'methode' ? PARAS[kind].slice() : d.rng.shuffle(PARAS[kind]);
  const used = ordered.slice(0, Math.min(nParas, ordered.length));
  const steps = stepsFor(kind, pts, d);
  d.chapterSteps = steps;
  const chapter: ChapterContent = {
    title: clean(title),
    intro: `${intro(kind, d.c, d.rng)} ${AUDIENCE_LINE[kind](d.c)}`,
    paragraphs: used.map((p) => p(d)),
    steps,
    example: exampleFor(d),
    checklist: checklistFor(kind, steps, d.c).map((x) => cap(clean(x))),
    visual: visualFor(kind, steps, d),
  };
  return { chapter, spare: ordered.slice(used.length) };
}

function buildBonus(title: string, d: Draft): ChapterContent {
  const c = d.c;
  const t = clean(title) || 'Bonus : la fiche SOS à garder sous la main';
  const isCarnet = /carnet|suivi/i.test(t);
  const isPhrases = /phrase/i.test(t);
  const steps = isCarnet
    ? [`Imprimer une grille de ${c.dur.n} cases`, 'Chaque soir, noter l’heure clé et un mot sur la journée', 'Le dimanche, relire la semaine et entourer le meilleur jour', 'Comparer la première et la dernière semaine']
    : isPhrases
      ? ['Pour vous-même : « Une mauvaise journée n’efface pas les progrès. »', 'Pour l’entourage : « On applique tous la même règle, même si c’est dur ce soir. »', `Pour les remarques : « On suit un plan de ${c.dur.n} ${c.dur.unit}, on fera le bilan à la fin. »`, 'Pour vous encourager : « Hier était plus difficile qu’aujourd’hui. »']
      : ['Respirer et revenir au plan minimal : une seule action, toujours la même', `Relire la règle affichée : ${d.tip()}`, 'Noter ce qui s’est passé dans le carnet, sans jugement', 'Reprendre le plan normal dès le lendemain'];
  return {
    title: t,
    intro: isCarnet
      ? `Ce carnet est l’outil le plus simple et le plus efficace du guide : en ${c.dur.n} ${c.dur.unit}, il transforme des impressions en preuves.`
      : isPhrases
        ? 'Dans les moments difficiles, on manque de mots. Voici des phrases prêtes à l’emploi, à dire à voix haute ou à garder en tête.'
        : 'Imprimez cette page et gardez-la à portée de main. Elle résume quoi faire, dans l’ordre, quand tout déraille.',
    paragraphs: [
      `Ce bonus a été conçu à partir des situations les plus citées par ${c.audArt}. ${c.phrases[0] ? `Quand on se dit ${q(c.phrases[0])}, on n’a ni le temps ni l’énergie de relire un guide entier : il faut une réponse immédiate.` : 'Dans ces moments-là, on n’a ni le temps ni l’énergie de relire un guide entier : il faut une réponse immédiate.'}`,
      'Gardez-le simple : une page, quatre lignes, toujours les mêmes. C’est sa répétition qui le rend efficace, pas sa sophistication.',
    ],
    steps: steps.map(sentence),
    example: null,
    checklist: ['Fiche imprimée', 'Fiche affichée là où elle sert', 'Entourage prévenu'],
    visual: { type: 'checklist_card', title: shortLabel(t.replace(/^bonus\s*:\s*/i, ''), 48), labels: steps.map((s) => shortLabel(s, 42)), values: [] },
  };
}

export function pdfWordCount(p: Omit<PdfContent, 'wordCount'> | PdfContent): number {
  const ch = (c: ChapterContent) => [c.title, c.intro, ...c.paragraphs, ...c.steps, c.example ?? '', ...c.checklist].join(' ');
  return wordCount([p.title, p.subtitle, p.promise, ...p.introduction, ...p.chapters.map(ch), ch(p.bonus), p.nextStep.title, p.nextStep.text].join(' '));
}

function introduction(d: Draft, nChapters: number, promise: string): string[] {
  const c = d.c;
  const [p1, p2] = [d.phrase(), d.phrase()];
  const pains = uniqStrings([d.painQ(), d.painQ()]);
  const out: string[] = [];
  out.push(
    p1
      ? `Si vous avez ouvert ce guide, votre quotidien ressemble sans doute à ceci : ${c.pbClause}. Peut-être l’avez-vous dit avec vos mots à vous : ${q(p1)}${p2 && p2 !== p1 ? `, ou encore ${q(p2)}` : ''}. Ces phrases, nous ne les avons pas inventées : elles reviennent sans cesse dans les commentaires, les forums et les avis que nous avons épluchés pour préparer ce guide.`
      : `Si vous avez ouvert ce guide, votre quotidien ressemble sans doute à ceci : ${c.pbClause}. Ce n’est pas une impression : c’est l’une des difficultés les plus citées par ${c.audArt} dans les commentaires et les avis que nous avons épluchés pour préparer ce guide.`,
  );
  out.push(
    pains.length >= 2
      ? `Le problème ne s’arrête jamais à un seul symptôme. On lit ${pains[0]}, puis ${pains[1]}, et au bout de quelques semaines s’installe cette impression d’avoir tout essayé sans que rien ne tienne. Ce n’est ni un manque de volonté ni un manque d’amour : c’est un manque de méthode claire, appliquée dans le bon ordre.`
      : `Au bout de quelques semaines, la situation finit par peser sur tout le reste : l’humeur, l’énergie, la vie de famille ou le travail. Et s’installe cette impression d’avoir tout essayé sans que rien ne tienne. Ce n’est pas un manque de volonté : c’est un manque de méthode claire, appliquée dans le bon ordre.`,
  );
  out.push(`Ce guide a été écrit pour une seule personne : ${c.audArt}. Il traite un seul problème — ${c.problem} — et il le traite à fond. À la fin, vous aurez ${lf(promise)}. Pas de théorie interminable : ${nChapters} chapitres courts, des étapes numérotées, des exemples réels et une checklist à la fin de chaque chapitre.`);
  if (c.facts.length >= 3) {
    out.push(`Avant de commencer, deux repères issus de nos recherches. D’abord : ${d.fact()}. Ensuite : ${d.fact()}. Garder ces deux points en tête évite une bonne partie des erreurs décrites plus loin.`);
  }
  out.push(`Comment lire ce guide ? Lisez le premier chapitre ce soir, puis avancez d’un chapitre à la fois. Cochez la checklist avant de passer au suivant. Et si vous ne deviez retenir qu’une chose dès maintenant : ${lf(c.tips[0] ?? FALLBACK.tips[0])}.`);
  return out;
}

export interface DraftOptions { banned: string[] }

export function heuristicPdfContent(
  input: { title: string; outline: Outline; niche: NicheBrief; voc: VoiceOfCustomer; upsellTitle: string | null },
  rng: LocalRng,
  opts: DraftOptions,
): PdfContent {
  const c = buildNicheCtx(input.niche, input.voc);
  const d = new Draft(c, rng);
  const outline = input.outline && Array.isArray(input.outline.chapters) && input.outline.chapters.length >= 3
    ? input.outline
    : heuristicOutline(input.title, input.niche, input.voc, rng);
  const chapters0 = outline.chapters.slice(0, 7);
  const kinds = chapters0.map((ch, i) => inferKind(ch.title ?? '', i, chapters0.length));
  // a sparse outline (3-4 chapters) is completed up to 5 with the missing kinds
  while (chapters0.length < 5) {
    const missing = (ORDER[5]!).find((k) => !kinds.includes(k)) ?? 'durer';
    chapters0.push({ title: chapterTitle(missing, c, rng), points: points(missing, c) });
    kinds.push(missing);
  }
  const nParas = c.richness > 0.6 ? 3 : 2;
  const title = clean(input.title) || clean(outline.title) || cap(c.problem);
  const outcome = lf(c.outcomes[0] ?? FALLBACK.outcomes[0]);
  const promise = `un plan clair de ${c.dur.n} ${c.dur.unit} pour arriver à ceci : ${outcome}`;
  // the introduction is written first: it gets the first customer words and research facts
  const intro0 = introduction(d, chapters0.length, promise);
  const built = chapters0.map((ch, i) => buildChapter(clean(ch.title) || chapterTitle(kinds[i]!, c, rng), strArr(ch.points), kinds[i]!, d, nParas));
  const chapters = built.map((b) => b.chapter);
  const bonus = buildBonus(outline.bonusTitle, d);
  const upsell = clean(input.upsellTitle);
  const content: PdfContent = {
    title,
    subtitle: `La méthode ${c.adj}, pas à pas, pour ${c.audArt}`,
    audience: c.niche.audience,
    promise: cap(promise),
    introduction: intro0,
    chapters,
    bonus,
    nextStep: {
      title: upsell ? `La suite est ici : ${upsell}` : clean(outline.nextStepTitle) || 'La suite est ici',
      text: upsell
        ? `Vous avez maintenant une méthode qui fonctionne et un plan pour la tenir. La prochaine étape logique, c’est « ${upsell} » : le même format, pensé pour ${c.audArt}, qui reprend là où ce guide s’arrête. Les lecteurs de ce guide y ont accès en priorité, directement depuis le lien de votre e-mail d’achat.`
        : `Vous avez maintenant une méthode qui fonctionne et un plan pour la tenir. Notre prochain guide pour ${c.audArt} est en préparation : il reprendra exactement là où celui-ci s’arrête. Vous le recevrez en priorité, à l’adresse utilisée pour votre achat.`,
      upsellProductId: null,
    },
    wordCount: 0,
  };

  // length target 2500-4500 words (aim ≥ 3000): add fillers / trim the longest chapters
  let wc = pdfWordCount(content);
  let guard = 0;
  let filler = 0;
  while (wc < 3000 && guard++ < 24) {
    const open = built.filter((b) => b.chapter.paragraphs.length < 6).sort((a, b) => a.chapter.paragraphs.length - b.chapter.paragraphs.length);
    const b = open[0];
    if (!b) break;
    const next = b.spare.shift() ?? FILLERS[filler++ % FILLERS.length]!;
    d.chapterSteps = b.chapter.steps;
    b.chapter.paragraphs.push(next(d));
    wc = pdfWordCount(content);
  }
  guard = 0;
  while (wc > 4500 && guard++ < 24) {
    const target = content.chapters.slice().sort((a, b) => b.paragraphs.length - a.paragraphs.length)[0];
    if (!target || target.paragraphs.length <= 2) break;
    target.paragraphs.pop();
    wc = pdfWordCount(content);
  }

  insertFlatSentences(content, c, rng, opts.banned);
  const out = scrubDeep(content, opts.banned);
  out.wordCount = pdfWordCount(out);
  return out;
}

/** The reference video: the first draft is "correct mais plat" → 4-8 generic sentences + risky claims. */
function insertFlatSentences(content: PdfContent, c: NicheCtx, rng: LocalRng, banned: readonly string[]): void {
  const n = Math.min(8, 4 + rng.int(0, 3) + (c.deep ? 1 : 0));
  const subj = c.subj;
  const cliches = rng.shuffle(CLICHE_TEMPLATES).slice(0, n).map((t) => t.replace('{sujet}', subj.noun).replace('{diff}', subj.fem ? 'différente' : 'différent'));
  const slots: { arr: string[]; i: number }[] = [];
  content.introduction.forEach((_, i) => slots.push({ arr: content.introduction, i }));
  for (const ch of content.chapters) ch.paragraphs.forEach((_, i) => slots.push({ arr: ch.paragraphs, i }));
  const chosen = rng.shuffle(slots).slice(0, cliches.length);
  chosen.forEach((s, k) => {
    const atStart = rng.chance(0.35);
    s.arr[s.i] = atStart ? `${cliches[k]} ${s.arr[s.i]}` : `${s.arr[s.i]} ${cliches[k]}`;
  });
  // risky claims a careful fact-checker must catch (skipped when the agent learned to ban them)
  const prog = content.chapters.find((ch, i) => inferKind(ch.title, i, content.chapters.length) === 'programme') ?? content.chapters.find((ch, i) => inferKind(ch.title, i, content.chapters.length) === 'methode') ?? content.chapters[content.chapters.length - 1];
  const guarantee = `Avec ce plan, le résultat est garanti en ${c.dur.n} ${c.dur.unit}.`;
  if (prog && prog.paragraphs.length && rng.chance(0.75) && !conflictsWith('garanti', banned)) {
    prog.paragraphs[0] = `${prog.paragraphs[0]} ${guarantee}`;
  }
  const stat = 'Plus de 80 % des lecteurs qui appliquent ces étapes voient une nette différence dès la première semaine.';
  if (content.introduction.length >= 3 && rng.chance(0.65) && !conflictsWith('80 %', banned)) {
    content.introduction[2] = `${content.introduction[2]} ${stat}`;
  }
}
