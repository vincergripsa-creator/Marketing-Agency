/**
 * One archetype per kind of guide. Each brings its own chapter kinds, paragraph bank, plan logic and
 * promise: a furniture project is never written like a change of habit. Niche substance comes from the
 * research; the banks only frame it. A sentence here appears at most once in a guide (Draft.once).
 */
import type { GuideArchetype } from '../../shared.js';
import { bare, cap, lf, ofAud, q, sentence } from '../util.js';
import type { Situation } from './knowledge.js';
import type { NicheCtx } from './niche.js';
import { archetypeSlot } from './profiles.js';
import type { Draft } from './studio.js';

export type Role = 'comprendre' | 'diagnostic' | 'methode' | 'erreurs' | 'situations' | 'programme' | 'durer';
export type Para = (d: Draft) => string | null;

export interface ChapterDef {
  kind: string;
  role: Role;
  title(c: NicheCtx, count: number): string;
  intro(c: NicheCtx): string;
  paras: Para[];
  steps?(c: NicheCtx): string[];
  checks?(c: NicheCtx): string[];
}

export interface ArchetypeDef {
  id: GuideArchetype | 'suite';
  /** Word for one step of the method (« Premier geste : … », « Première étape : … »). */
  stepNoun: { word: string; fem: boolean };
  plan: 'parallele' | 'phases';
  planColumn: string;
  chapters: ChapterDef[];
  /** Kinds kept when the research is thin, by number of chapters. */
  short: { 5: string[]; 6: string[] };
  promise(c: NicheCtx, outcome: string): string;
  subtitle(c: NicheCtx): string;
  /** The « Comment utiliser ce guide » box of the promise page: what the introduction says, in three steps. */
  howTo: [string, string][];
  /** Lead title formulas, strongest first. */
  titles(c: NicheCtx, a: { P: string; Ps: string; D: string; steps: number; desired: string | null }): string[];
  introOpen(c: NicheCtx, a: { pain: string; p1: string | null; p2: string | null }): string;
  introWhy(c: NicheCtx, a: { pains: string[] }): string;
  introUse(c: NicheCtx, a: { chapters: number; promise: string }): string;
  introRead(c: NicheCtx): string;
  /** Used when a step of a thin research has no detail of its own. */
  whyFallback: string[];
  situationsFallback: Situation[];
  fillers: Para[];
}

const D = (c: NicheCtx): string => `${c.dur.n} ${c.dur.unit}`;
const femUnit = (c: NicheCtx): boolean => /^(nuit|semaine)$/.test(c.dur.unitOne);
/** « un jour », « une nuit » : the plan's unit with its article. */
const aUnit = (c: NicheCtx): string => `${femUnit(c) ? 'une' : 'un'} ${c.dur.unitOne}`;
/** Framing wording of this niche: two guides of the same archetype do not read alike. */
const v = (c: NicheCtx, ...xs: string[]): string => xs[archetypeSlot(c.niche.nicheId) % xs.length]!;
/** « à » + the short audience (aux parents, à la famille). */
const toAud = (c: NicheCtx): string => (/^les\s/i.test(c.audCore) ? `aux ${c.audCore.slice(4)}` : `à ${c.audCore}`);
const pb = (c: NicheCtx): string => q(lf(c.pbShort ?? c.pbClause));
/** A research item after a colon of ours: lowercase, its own colon turned into a dash. */
const low = (s: string): string => lf(s).replace(/\s+:\s+/g, ' — ');
const orJoin = (a: string | null, b: string | null): string => (a && b ? `${a} et ${b}` : a ?? b ?? '');

const obsLabel = (c: NicheCtx): string => {
  const m = /(\d+)\s+(nuits?|jours?)/iu.exec(c.diag?.text ?? '');
  if (m) return `${m[1]} ${m[2]!.toLowerCase()}`;
  if (/semaine/i.test(c.diag?.text ?? '')) return 'une semaine';
  return '3 jours';
};

const columnsOf = (c: NicheCtx): string => {
  const cols = c.profile?.sheet.columns ?? ['le moment', 'ce qui s’est passé', 'ce que vous avez fait', 'le résultat'];
  return cols.map((x) => lf(x)).join(', ');
};

const loopPara: Para = (d) => {
  const loop = d.c.profile?.loop;
  if (loop && loop.length) return `Regardez la boucle : ${loop.map((x) => lf(x)).join(', puis ')}. ${v(d.c, 'Chaque tour rend le tour suivant plus probable, sans que personne ne l’ait décidé. Votre travail consiste à casser un seul maillon, pas à tout changer.', 'Personne n’a choisi ce cercle, et il se renforce à chaque passage. Pour en sortir, il suffit d’en casser un seul maillon.', 'Le cercle tourne seul, et chaque passage le rend plus solide. Vous n’avez pas à tout changer : un seul maillon cassé suffit.', 'Ce cercle s’entretient tout seul. Le bon levier n’est pas de tout reprendre, mais de toucher un seul point de la chaîne.')}`;
  return 'Regardez ce qui se répète : un déclencheur, une réaction, puis un soulagement de courte durée. Chaque tour rend le tour suivant plus probable, sans que personne ne l’ait décidé.';
};

/** What to look for during the diagnostic: niche research when there is some. */
const lookFor: Para = (d) => {
  const items = d.observations();
  return items.length ? items.join(' ') : null;
};

/** How to keep the result: niche research when there is some. */
const keepUp: Para = (d) => {
  const items = d.upkeep();
  return items.length ? items.join(' ') : null;
};

/** A ready-to-copy model, placed in the chapter where it is used. */
const modelPara: Para = (d) => d.model();

/** A research fact with a neutral lead: what follows a fact must fit any fact. */
const nextFact = (lead: string): Para => (d) => {
  const f = d.fact();
  return f ? `${lead} ${f}` : null;
};

const usePlain = (c: NicheCtx, a: { chapters: number; promise: string }, tools: string): string =>
  `Ce guide a été écrit pour un seul profil de lecteur : ${c.audArt}. À la fin, vous aurez ${lf(a.promise)}. Au programme : ${a.chapters} chapitres courts, ${tools}.`;

const genericFillers: Para[] = [
  () => 'Bloquez dans votre agenda un créneau fixe de dix minutes pour ce chapitre. Ce qui est planifié se fait ; ce qui reste « à faire quand j’aurai le temps » ne se fait presque jamais.',
  () => 'Expliquer votre démarche à quelqu’un de votre entourage vous oblige à la clarifier, et vous donne un allié les jours où la motivation baisse.',
  (d) => { const o = d.outcome(); return o ? `Gardez le cap en vous rappelant pourquoi vous faites tout ça : ${o}. Écrivez-le et collez-le là où vous le verrez chaque jour.` : null; },
  (d) => { const t = d.tip(); return t ? `Si vous ne deviez garder qu’une idée de ce chapitre : ${t}.` : null; },
  () => 'Avant de passer à la suite, relisez la page en vous demandant ce que vous allez faire dans les prochaines 24 heures. Une seule action notée vaut mieux qu’un chapitre souligné en entier.',
  () => 'Si un passage ne correspond pas à votre situation, passez-le sans culpabiliser. Ce guide se suit dans l’ordre, mais il s’adapte : gardez ce qui vous concerne, et notez ce que vous changez.',
  (d) => { const t = d.tip(); return t ? `Autre détail qui mérite sa place dans vos notes : ${t}.` : null; },
  () => 'Commencez plus petit que ce que vous croyez possible. Une première action qui tient en cinq minutes se refait le lendemain ; une première séance trop ambitieuse se transforme vite en excuse pour arrêter.',
  () => 'Décidez à l’avance du moment précis où vous ferez ce qui est prévu, plutôt que de compter sur la motivation du jour. Une décision prise au calme tient mieux qu’une décision prise fatigué.',
  () => 'Préparez ce dont vous avez besoin avant d’en avoir besoin. Moins il y a de choses à chercher au moment d’agir, moins il y a de raisons de remettre à plus tard.',
  () => 'Si vous êtes plusieurs, répartissez clairement qui fait quoi. Une tâche partagée sans responsable finit presque toujours par ne pas être faite, et le reproche prend la place de la solution.',
  () => 'Gardez une trace écrite, même courte. Quelques mots notés chaque semaine suffisent à voir ce qui avance, et à ne pas juger tout le parcours sur le dernier mauvais moment.',
  () => 'Quand un conseil extérieur contredit ce guide, ne changez pas tout de suite. Terminez ce que vous avez commencé, regardez le résultat, puis décidez : c’est la seule façon de savoir ce qui marche pour vous.',
  () => 'Prévoyez dès maintenant quoi faire si vous décrochez. Une reprise décidée à l’avance évite de transformer une pause de deux jours en abandon complet.',
  () => 'Regardez où part votre temps pendant une semaine ordinaire. Dix minutes bien placées valent souvent mieux qu’une heure prise sur le sommeil, et elles se tiennent plus longtemps.',
  () => 'Quand un jour se passe mal, cherchez une seule cause et une seule correction. Vouloir tout analyser épuise, et la plupart des mauvais jours n’ont pas besoin d’autre chose qu’un retour au plan.',
  () => 'Avant de demander un avis autour de vous, notez ce que vous avez déjà essayé et ce que cela a donné. Vous gagnerez du temps, et les réponses que vous recevrez seront bien plus utiles, parce qu’elles partiront de votre situation réelle.',
  () => 'Choisissez un seul indicateur simple pour suivre vos progrès, et regardez-le toujours au même rythme. Trop de mesures finissent par se contredire, et un chiffre regardé trop souvent décourage plus qu’il n’aide.',
  () => 'Relisez vos premières notes de temps en temps. On oublie très vite d’où l’on est parti, et mesurer le chemin parcouru redonne de l’élan bien plus sûrement qu’un nouvel objectif.',
  () => 'Fêtez les petites avancées. Elles paraissent dérisoires sur le moment, et ce sont pourtant elles qui donnent envie de continuer quand le résultat final est encore loin.',
];

// ───────────────────────────── habitude ─────────────────────────────

const HABITUDE: ArchetypeDef = {
  id: 'habitude',
  howTo: [['Lisez un chapitre à la fois', 'Chaque chapitre règle une partie précise du problème, et l’observation vient avant le plan.'], ['Appliquez le jour même', 'Les gestes sont pensés pour être testés tout de suite.'], ['Cochez la checklist', 'Passez à la suite quand tout est coché.']],
  stepNoun: { word: 'geste', fem: false },
  plan: 'parallele',
  planColumn: 'Jour',
  short: { 5: ['mecanisme', 'gestes', 'erreurs', 'plan', 'durer'], 6: ['mecanisme', 'observation', 'gestes', 'erreurs', 'plan', 'durer'] },
  promise: (c, o) => `un plan de ${D(c)} pour arriver à ceci : ${o}`,
  subtitle: (c) => `La méthode ${c.adj}, pas à pas, pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : la méthode ${c.adj} en ${a.D}`, `${a.Ps} : la méthode ${c.adj} en ${a.D}`],
  introOpen: (c, a) => `Si vous avez ouvert ce guide, vous vous reconnaissez sans doute dans cette situation : ${a.pain}.${a.p1 ? ` Peut-être l’avez-vous dit avec vos mots à vous : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}. ${v(c, 'Ces phrases, nous ne les avons pas inventées : elles viennent des commentaires, des forums et des avis lus pour préparer ce guide.', 'Ces mots ne sortent pas de notre imagination : ils viennent des forums et des commentaires épluchés pour écrire ce guide.', 'Nous avons repris ces phrases telles quelles, depuis les avis et les discussions lus pour préparer ces pages.', 'Ce sont des phrases relevées dans les forums et les avis, au moment de préparer ce guide.')}` : ` C’est l’une des difficultés qui reviennent le plus chez ${c.audArt}.`}`,
  introWhy: (c, a) => `${c.care ? v(c, 'Ce n’est ni un manque de volonté ni un manque d’amour : il manque une méthode claire, appliquée dans le bon ordre.', 'Vous ne manquez ni d’amour ni de patience : il vous manque un ordre de marche.', 'L’affection et la bonne volonté ne sont pas en cause : ce qui manque, c’est une méthode tenue dans la durée.') : 'Ce n’est ni un manque de volonté ni un manque de sérieux : il manque une méthode claire, appliquée dans le bon ordre.'}${a.pains.length >= 2 ? ` On lit ${a.pains[0]}, puis ${a.pains[1]}, et au bout de quelques semaines s’installe l’impression d’avoir tout essayé.` : ' Au bout de quelques semaines, la situation pèse sur l’humeur et l’énergie de toute la maison.'}`,
  introUse: (c, a) => usePlain(c, a, v(c, 'des gestes à installer en parallèle, un plan à cocher et un carnet à imprimer', 'un plan à suivre chaque jour, des réponses aux jours difficiles et un carnet à imprimer', 'les bons gestes, le plan à cocher et un carnet pour suivre vos progrès', 'des habitudes à installer, un plan semaine après semaine et un carnet à imprimer')),
  introRead: (c) => v(c, 'Comment lire ce guide ? Lisez le premier chapitre ce soir, puis avancez d’un chapitre à la fois, sans sauter l’observation. Cochez la checklist avant de passer au suivant.', 'Pour bien l’utiliser, lisez un chapitre par jour et ne sautez pas l’observation : tout le plan s’appuie dessus.', 'Le mieux est de lire d’abord les deux premiers chapitres, de faire l’observation, puis de revenir au reste.', 'Prenez-le dans l’ordre, un chapitre à la fois : l’observation vient avant le plan, et ce n’est pas un hasard.'),
  whyFallback: [
    'Elle paraît simple, et c’est voulu : un geste qu’on n’arrive pas à tenir un soir de fatigue ne sert à rien.',
    'C’est souvent celui qu’on saute quand on est pressé, et c’est pourtant lui qui change la suite.',
    'Il demande un peu de constance : le nouveau repère met du temps à s’installer, puis il devient automatique.',
  ],
  situationsFallback: [
    { when: 'vous êtes à bout', what: 'Revenez à la version minimale du plan : une seule action, toujours la même. Une mauvaise journée n’efface pas ce qui est acquis.' },
    { when: 'votre entourage n’applique pas la même règle', what: 'Prenez cinq minutes pour vous mettre d’accord sur une seule consigne, écrite noir sur blanc, et affichez-la.' },
    { when: 'un imprévu casse le rythme', what: 'Ne cherchez pas à tenir quand même. Mettez le plan en pause, puis reprenez deux jours plus tôt que là où vous en étiez.' },
  ],
  fillers: [
    () => 'Ce plan ne demande pas d’être parfait. Il demande de refaire la même chose assez longtemps pour qu’elle devienne normale : c’est la répétition, pas l’intensité, qui change une habitude.',
    (d) => `Soyez précis dans vos notes : « mieux » ou « moins bien » ne suffit pas. Notez le moment, la durée et ce qui a changé. Au bout de ${D(d.c)}, ces détails sépareront une impression d’une preuve.`,
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'mecanisme', role: 'comprendre',
      title: () => 'Pourquoi ça recommence malgré vos efforts',
      intro: (c) => `${v(c, 'Tant que le mécanisme reste invisible, chaque nouvelle astuce tombe à plat.', 'Une astuce ne tient pas tant qu’on ne voit pas ce qu’elle doit changer.', 'Avant d’agir, il faut voir ce qui se répète.', 'On ne change bien que ce qu’on a compris.')} Ce chapitre montre ce qui se joue derrière ${pb(c)}, et pourquoi ${c.audCore} n’ont rien à se reprocher.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `${f} Le problème n’est donc pas là où on le cherche d’habitude.` : 'Le problème n’est pas toujours là où on le cherche. Ce qui entretient la difficulté, ce sont rarement de grandes erreurs : ce sont de petits gestes répétés, faits de bonne foi, qui finissent par devenir la règle.'; },
        loopPara,
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? `${v(d.c, `C’est le même enchaînement qu’on retrouve derrière ${p}. Les symptômes changent, la boucle reste.`, `Le même enchaînement se cache derrière ${p}, même si cela n’y ressemble pas au premier regard.`, `On le retrouve aussi derrière ${p} : deux formes différentes, un seul fonctionnement.`, `Derrière ${p}, c’est encore ce fonctionnement qui joue.`)}` : 'Les symptômes changent d’une semaine à l’autre, la boucle reste la même.'; },
        (d) => nextFact('Autre repère utile.')(d) ?? 'Retenez une idée simple : un écart n’annule pas les progrès. Ce qui compte, c’est la direction sur plusieurs jours.',
      ],
      steps: () => ['Repérer dans votre semaine le moment où la boucle démarre', 'Entourer le mécanisme de ce chapitre qui vous ressemble le plus', 'Écrire en une phrase le geste que vous voulez arrêter'],
      checks: () => ['J’ai repéré le moment où tout démarre', 'Je sais quel maillon je veux casser', 'J’ai écrit ma phrase'],
    },
    {
      kind: 'observation', role: 'diagnostic',
      title: (c) => `${cap(obsLabel(c))} d’observation avant de changer quoi que ce soit`,
      intro: (c) => `${v(c, 'On ne corrige bien que ce qu’on a observé.', 'Avant de corriger, il faut voir.', 'Un bon plan part de ce qui se passe vraiment.', 'Ce qu’on croit faire et ce qu’on fait vraiment diffèrent souvent.')} Pendant ${obsLabel(c)}, ${c.audCore} notent simplement ce qui se passe : c’est ce qui évite de traiter le mauvais problème.`,
      paras: [
        (d) => v(d.c, 'Pourquoi observer d’abord ? Parce que la fatigue déforme la mémoire. On a l’impression que « c’est tout le temps », alors qu’une grille remplie montre souvent deux ou trois moments précis où tout se joue.', 'Pourquoi commencer par noter ? Parce qu’une impression n’est pas un repère. Sur le papier, le problème se resserre souvent sur quelques moments précis.', 'Noter d’abord, c’est se donner une base solide : les souvenirs d’une semaine difficile sont rarement fiables, une grille remplie l’est.', 'Commencer par une semaine de notes peut sembler lent. C’est pourtant ce qui évite de changer ce qui marchait déjà.'),
        (d) => `La grille tient sur une page : ${columnsOf(d.c)}. ${v(d.c, 'Un stylo suffit. Notez aussi les bons moments : ils montrent ce qui marche déjà.', 'Pas besoin d’application : une feuille posée au bon endroit fait le travail.', 'Gardez-la à portée de main, pour noter sur le moment plutôt que de mémoire.', 'Quelques mots par ligne suffisent, l’important est de ne pas sauter de jour.')}`,
        (d) => d.c.diag?.detail || null,
        (d) => lookFor(d) ?? 'Avec ces notes sous les yeux, cherchez ce qui se répète : même heure, même déclencheur, même réaction. C’est ce schéma, et lui seul, que vous allez travailler en premier.',
        (d) => `Pendant ces ${obsLabel(d.c)}, ne changez rien. ${v(d.c, 'C’est frustrant, mais c’est ce qui rend vos notes fiables : si vous modifiez tout en même temps, vous ne saurez jamais ce qui a vraiment fonctionné.', 'L’envie d’agir sera forte : tenez bon, car une observation modifiée en route ne vous apprend plus rien.', 'Ce n’est pas du temps perdu : c’est la photo de départ à laquelle vous comparerez tout le reste.', 'Vous comparerez tout le reste à cette photo de départ : mieux vaut qu’elle soit fidèle.')}`,
      ],
      steps: (c) => [c.diag?.text ?? 'Remplir la grille de ce chapitre sans rien changer', 'Surligner ce qui revient au moins deux fois', 'Choisir un seul moment à travailler en priorité'],
      checks: () => ['Ma grille est prête', 'J’ai tout noté sans rien changer', 'J’ai choisi une seule priorité'],
    },
    {
      kind: 'gestes', role: 'methode',
      title: (_c, n) => `Les ${n} gestes qui changent la donne`,
      intro: (c) => `${v(c, 'Voici le cœur du guide.', 'Passons à l’action.', 'C’est ici que tout se joue.', 'Voici ce qui va vraiment changer votre quotidien.')} Ces gestes sont pensés pour ${c.audCore} : courts, concrets, et faits pour tenir un jour de grande fatigue.`,
      paras: [modelPara],
    },
    {
      kind: 'erreurs', role: 'erreurs',
      title: (_c, n) => `Les ${n} erreurs qui entretiennent le problème`,
      intro: (c) => `Ces erreurs partent presque toujours d’une bonne intention, souvent ${c.care ? 'par amour ou par fatigue' : 'par manque de temps ou par habitude'}. Ce sont celles que ${c.audCore} font le plus souvent.`,
      paras: [],
      steps: () => ['Relire la liste et entourer les erreurs que vous faites aujourd’hui', 'Commencer par la plus fréquente, une seule à la fois', 'Noter la date à laquelle vous l’avez arrêtée'],
    },
    {
      kind: 'situations', role: 'situations',
      title: (_c, n) => `Les ${n} situations qui font tout dérailler`,
      intro: (c) => `${v(c, 'Même avec la meilleure méthode, il y a des jours où tout déraille.', 'Un plan rencontre toujours la vraie vie.', 'Certains jours, rien ne se passe comme prévu.', 'Les bonnes semaines ont aussi leurs mauvais moments.')} Voici ce que vivent ${c.audCore}, et la réponse à donner à chaque fois.`,
      paras: [],
      steps: () => ['Préparer à l’avance votre plan minimal pour les jours sans énergie', 'Afficher les réponses de ce chapitre là où elles servent', 'Après un imprévu, reprendre deux jours en arrière avant de continuer'],
    },
    {
      kind: 'plan', role: 'programme',
      title: (c) => `Le plan de ${D(c)}, ${c.dur.unitOne} après ${c.dur.unitOne}`,
      intro: (c) => `Voici le plan concret sur ${D(c)}, pensé pour le quotidien ${ofAud(c.audCore)}. ${v(c, 'Les gestes s’additionnent : rien ne s’arrête en route.', 'Chaque nouveauté s’ajoute à ce qui tient déjà.', 'On ajoute sans jamais rien retirer.', 'Rien ne disparaît en route : tout s’additionne.')}`,
      paras: [
        (d) => `${d.kinds.has('observation') ? 'Ce plan commence une fois l’observation terminée. ' : ''}${v(d.c, 'Il ne fonctionne pas par phases qui se remplacent : ce qui est en place le reste.', 'Rien ne remplace rien : vous gardez les premiers gestes jusqu’au bout.', 'Les premiers gestes restent actifs du début à la fin.', 'Les habitudes des premières semaines restent en place jusqu’à la fin.')}`,
        modelPara,
        (d) => v(d.c, `Chaque ${d.c.dur.unitOne}, lisez la ligne du tableau, faites ce qu’elle dit, cochez. Si une ligne saute, ne la rattrapez pas : reprenez simplement à la suivante.`, `Le tableau se lit ligne par ligne : une ligne, une case. Une case manquée ne se rattrape pas, on passe à la suivante.`, `Une ligne par ${d.c.dur.unitOne}, une case à cocher. Si vous en manquez une, continuez avec la suivante, sans doubler.`, `Une ligne par ${d.c.dur.unitOne}, cochée le soir. Une ligne ratée ne compte pas double : vous reprenez simplement à la suivante.`),
        (d) => v(d.c, `Résistez à l’envie d’en faire plus. La stabilité est le meilleur signe que le plan fonctionne, et ${aUnit(d.c)} calme vaut mieux qu’${aUnit(d.c)} héroïque suivi${femUnit(d.c) ? 'e' : ''} d’un abandon.`, `N’ajoutez rien au plan pendant ces ${D(d.c)}, même si vous avez de l’énergie : la régularité compte plus que l’élan.`, `Quand tout va bien, la tentation est d’accélérer. Gardez le rythme prévu : c’est lui qui installe l’habitude.`, `Ne cherchez pas à compenser une semaine moyenne : tenez le rythme prévu, et laissez le temps faire sa part.`),
      ],
      checks: (c) => ['Tableau imprimé ou recopié', `Première ligne cochée`, `Bilan prévu à la fin des ${D(c)}`],
    },
    {
      kind: 'durer', role: 'durer',
      title: () => 'Garder les acquis quand la vie reprend le dessus',
      steps: () => ['Choisir un jour fixe par mois pour relire votre carnet', 'Reprendre la première semaine du plan dès qu’une ancienne habitude revient', 'Noter la date du jour où le résultat est acquis'],
      checks: () => ['Mon rendez-vous du mois est dans l’agenda', 'Je sais par quoi reprendre en cas de recul', 'Mon carnet reste à portée de main'],
      intro: (c) => `${v(c, 'Le vrai défi n’est pas de réussir une semaine, c’est de tenir quand tout redevient normal.', 'Une fois le plan terminé, le plus important reste à faire.', 'La fin du plan n’est pas la fin de l’histoire.', 'Tenir longtemps demande moins d’efforts qu’on ne le croit, à condition de garder quelques repères.')} C’est l’étape la plus négligée par ${c.audCore}.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? v(d.c, `À quoi ressemble la réussite ? Concrètement : ${o}. Notez la date du jour où cela arrive pour la première fois : les soirs de doute, cette date sera votre meilleure preuve.`, `Votre repère de réussite : ${o}. Le jour où c’est acquis, notez la date dans le carnet.`, `Gardez ce cap en tête : ${o}. Quand vous y êtes, écrivez-le : les périodes de doute reviennent, et cette note aide.`, `Votre objectif reste simple : ${o}. Mesurez-le à la fin du plan, et une fois par mois ensuite.`) : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Pour garder les acquis, deux réflexes suffisent. D’abord : ${a}. Ensuite : ${b}. Gardez aussi votre carnet à portée de main : il vous dira tout de suite si une ancienne habitude revient.` : null; },
        (d) => v(d.c, 'Si un jour tout semble remis en cause, rouvrez le chapitre des erreurs. Une rechute vient rarement de nulle part : une seule chose a changé, et c’est elle qu’il faut retrouver.', 'En cas de retour en arrière, ne repartez pas de zéro : cherchez ce qui a changé récemment, et corrigez ce point seul.', 'Une mauvaise passe ne remet pas tout en cause. Reprenez le chapitre des erreurs et cherchez celle qui est revenue.', 'Si les anciennes habitudes reviennent, reprenez seulement la première semaine du plan : le reste suivra.'),
      ],
    },
  ],
};

// ───────────────────────────── projet ─────────────────────────────

const PROJET: ArchetypeDef = {
  id: 'projet',
  howTo: [['Lisez tout avant d’acheter', 'Vous saurez ce qui vous attend, et ce qu’il est inutile de payer.'], ['Reprenez chapitre par chapitre', 'Le matériel à portée de main, une étape après l’autre.'], ['Cochez la checklist', 'Elle évite d’oublier une préparation qui ne se rattrape pas.']],
  stepNoun: { word: 'étape', fem: true },
  plan: 'phases',
  planColumn: 'Quand',
  short: { 5: ['lire', 'etapes', 'erreurs', 'deroule', 'finitions'], 6: ['lire', 'preparer', 'etapes', 'erreurs', 'deroule', 'finitions'] },
  promise: (_c, o) => `toutes les étapes, dans l’ordre, pour arriver à ceci : ${o}`,
  subtitle: (c) => `Le pas-à-pas complet pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : le pas-à-pas en ${a.steps} étapes`, `${a.Ps} : le pas-à-pas en ${a.steps} étapes`, ...(a.desired ? [`${cap(a.desired)} : les ${a.steps} étapes, dans l’ordre`] : [])],
  introOpen: (_c, a) => `Vous avez un projet précis, et une inquiétude tout aussi précise : ${a.pain}.${a.p1 ? ` Sur les forums, elle prend cette forme : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''} ${v(_c, 'Bonne nouvelle : ce type de projet s’apprend, et il tient en quelques gestes faits dans le bon ordre.', 'Rassurez-vous : personne ne naît avec ce savoir-faire, et il tient en quelques gestes simples.')}`,
  introWhy: (c, a) => `${v(c, 'Un projet comme celui-ci se joue rarement au dernier moment. Il se joue au début, quand on décide quoi faire et dans quel ordre.', 'Tout se décide en amont : ce que l’on choisit au départ pèse plus lourd que ce que l’on fait à la fin.')}${a.pains.length >= 2 ? ` Quand on lit ${a.pains[0]}, ou ${a.pains[1]}, c’est presque toujours une étape sautée qui se paie plus tard.` : ''}`,
  introUse: (c, a) => usePlain(c, a, v(c, 'chaque étape avec son temps de travail, les pannes les plus courantes et leur solution', 'un calendrier complet, les problèmes les plus fréquents et un tableau à garder sous les yeux')),
  introRead: (c) => v(c, 'Comment lire ce guide ? Lisez-le une fois en entier avant d’acheter quoi que ce soit, puis reprenez-le chapitre par chapitre, le matériel à portée de main.', 'Avant tout achat, lisez ce guide d’une traite. Vous saurez ainsi ce qui vous attend, et ce que vous pouvez éviter de payer.'),
  whyFallback: [
    'Ne la raccourcissez pas : c’est elle qui permet à la suivante de tenir.',
    'Prenez le temps de la finir avant d’attaquer la suite, même si le résultat ne se voit pas encore.',
    'Vérifiez le résultat à la lumière rasante avant de passer à la suite : c’est là que les défauts apparaissent.',
  ],
  situationsFallback: [
    { when: 'le résultat ne ressemble pas à ce que vous attendiez', what: 'Arrêtez-vous, notez ce qui diffère, et revenez à la dernière étape réussie avant de continuer.' },
    { when: 'il vous manque un outil au milieu du projet', what: 'Mettez le projet en pause plutôt que d’improviser avec ce que vous avez sous la main.' },
    { when: 'vous prenez du retard', what: 'Ne supprimez aucune étape de préparation : décalez simplement la suivante, et gardez les temps de séchage ou d’attente.' },
  ],
  fillers: [
    () => 'Prenez une photo à chaque étape. Elle vous rassure sur l’avancement, et elle vous aidera à comprendre ce qui s’est passé si un défaut apparaît plus tard.',
    () => 'Préparez votre poste de travail la veille : tout à portée de main, sans rien à chercher. Une séance qui commence par vingt minutes de recherche d’outils se termine rarement bien.',
    () => 'Ne jugez pas le résultat à mi-chemin. Tout projet passe par un moment où il paraît pire qu’avant : c’est normal, et c’est rarement le moment de changer de plan.',
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'lire', role: 'comprendre',
      title: () => 'Avant de commencer : ce que votre projet impose',
      intro: (c) => `${v(c, 'Un projet réussi se décide avant le premier geste.', 'Tout commence avant de mettre les mains dans la terre.')} Ce chapitre explique ${toAud(c)} ce qui fait tenir le résultat, et d’où vient ${pb(c)}.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `${v(d.c, 'Commençons par ce que le projet impose.', 'Quelques réalités décident de la suite.')} ${f}` : 'La matière décide avant vous : avant de choisir comment faire, il faut savoir à quoi vous avez affaire.'; },
        (d) => v(d.c, 'Un résultat qui déçoit vient rarement d’un mauvais geste de finition. Il vient d’une préparation trop courte, ou d’un produit mal choisi pour le support. C’est pour cela que ce guide passe autant de temps sur ce qui se fait avant de peindre.', 'Une récolte décevante vient rarement d’un oubli d’arrosage isolé. Elle vient d’un mauvais choix de départ : la plante, le contenant ou l’emplacement. C’est pour cela que ce guide passe autant de temps sur ce qui se décide avant de planter.'),
        nextFact('Autre point à connaître.'),
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? v(d.c, `Quand on lit ${p}, on pense à un manque de talent. C’est presque toujours un manque de méthode, et donc quelque chose qui se corrige.`, `Derrière ${p}, il n’y a pas de mauvaise main verte : il y a surtout une méthode à apprendre.`) : null; },
      ],
      steps: () => ['Lire ce chapitre une fois, sans rien acheter', 'Noter ce qui correspond à votre situation', 'Écrire le résultat que vous visez en une phrase'],
      checks: () => ['Je sais à quoi j’ai affaire', 'Je connais le point qui ne se rattrape pas', 'Mon objectif tient en une phrase'],
    },
    {
      kind: 'preparer', role: 'diagnostic',
      title: () => 'Préparer le terrain : ce qu’il faut vérifier et réunir',
      intro: (c) => `${v(c, 'Ce chapitre évite les trois allers-retours en magasin.', 'Ce chapitre vous évite d’acheter pour rien.')} ${cap(c.audCore)} y trouvent ce qu’il faut vérifier, et ce qu’il faut réunir avant de commencer.`,
      paras: [
        (d) => d.c.diag ? `La première chose à faire : ${low(d.c.diag.text)}. ${d.c.diag.detail}` : 'La première chose à faire : regarder ce que vous avez vraiment devant vous, et le noter, avant de décider quoi que ce soit.',
        lookFor,
        (d) => `Le tableau de ce chapitre tient sur une page : ${columnsOf(d.c)}. ${v(d.c, 'Remplissez-le avant de partir faire les courses : vous saurez ce que vous avez déjà, et ce que le projet coûtera.', 'Remplissez-le un jour clair : ce relevé décidera de ce que vous achèterez.')}`,
        (d) => v(d.c, 'Achetez une qualité correcte pour les outils que vous gardez, et le minimum pour ce qui sert une seule fois. Un bon outil se réutilise ; un outil médiocre se paie sur le résultat.', 'Ne dépensez pas tout en pots décoratifs : le terreau et la taille du contenant comptent bien plus que l’apparence.'),
      ],
      steps: (c) => [c.diag?.text ?? 'Inspecter ce que vous avez devant vous', 'Remplir le tableau de ce chapitre', 'Acheter en une seule fois ce qui manque', 'Installer votre poste de travail'],
      checks: () => ['J’ai vérifié mon point de départ', 'Mon tableau est rempli', 'Tout est réuni avant de commencer'],
    },
    {
      kind: 'etapes', role: 'methode',
      title: (_c, n) => `Les ${n} étapes, dans l’ordre`,
      intro: (c) => `Voici le déroulé complet, pensé pour ${c.audCore}. ${v(c, 'L’ordre n’est pas une préférence : chaque étape prépare la suivante.', 'Le calendrier impose son ordre : mieux vaut le suivre que le précipiter.')}`,
      paras: [modelPara],
    },
    {
      kind: 'erreurs', role: 'erreurs',
      title: (_c, n) => `Les ${n} erreurs qui ruinent le résultat`,
      intro: (c) => `${v(c, 'Aucune de ces erreurs ne vient d’un manque de talent : elles viennent de l’envie d’aller plus vite.', 'Ces erreurs partent d’une bonne intention, et elles se paient quelques semaines plus tard.')} Ce sont celles qui coûtent le plus cher ${toAud(c)}.`,
      paras: [],
      steps: () => ['Relire cette liste avant de commencer', 'Repérer celle qui vous guette le plus', 'La garder en tête au moment de l’étape concernée'],
    },
    {
      kind: 'depannage', role: 'situations',
      title: (_c, n) => `Réparer un raté : ${n} problèmes et leur solution`,
      intro: (c) => `${v(c, 'Un défaut n’est presque jamais définitif.', 'Une plante en difficulté se rattrape souvent.')} Voici les problèmes que rencontrent ${c.audCore}, et comment les rattraper sans tout recommencer.`,
      paras: [],
      steps: () => ['Identifier le défaut précis', 'Trouver la cause dans ce chapitre', 'Corriger, laisser reposer, vérifier'],
    },
    {
      kind: 'deroule', role: 'programme',
      title: (c) => `Votre déroulé sur ${D(c)}, étape par étape`,
      intro: (c) => `${v(c, 'Le plan suit l’ordre imposé par la matière et par le temps de séchage.', 'Le plan suit le calendrier des saisons, qui ne se négocie pas.')} Il est pensé pour ${c.audCore}, et chaque ligne se termine avant de passer à la suivante.`,
      paras: [
        (d) => v(d.c, 'Ici, rien ne se fait en parallèle : chaque ligne a besoin que la précédente soit terminée. Une étape sautée ne fait pas gagner de temps, elle le déplace à la fin, en plus cher.', 'Chaque mois prépare le suivant : ce qui n’a pas été semé en avril ne se rattrape pas en juillet.'),
        modelPara,
        (d) => v(d.c, 'Les durées indiquées sont des temps de travail. Le temps d’attente entre deux lignes n’est pas du temps perdu : c’est là que la peinture durcit, et il ne se raccourcit pas.', 'Les dates sont des repères pour un climat moyen : regardez la météo de la semaine et les nuits fraîches avant de planter.'),
      ],
      checks: () => ['Dates bloquées dans l’agenda', 'Tableau imprimé ou recopié', 'Temps d’attente respectés'],
    },
    {
      kind: 'finitions', role: 'durer',
      title: () => 'Faire durer le résultat',
      steps: (c) => [
        v(c, 'Attendre plusieurs jours avant de poser un objet lourd sur le meuble', 'Vider et nettoyer les pots à la fin de la saison'),
        v(c, 'Nettoyer avec un chiffon à peine humide, sans produit abrasif', 'Noter ce qui a donné, où et avec quel arrosage'),
        v(c, 'Garder un petit pot de peinture pour les retouches', 'Prévoir dès janvier les semis du printemps suivant'),
      ],
      checks: (c) => [
        v(c, 'Le temps de durcissement est respecté', 'Les pots sont nettoyés'),
        v(c, 'Un pot de retouche est gardé', 'Mes notes de la saison sont rangées'),
        v(c, 'Les produits utilisés sont notés', 'Les semis du printemps sont prévus'),
      ],
      intro: (c) => `${v(c, 'Le meuble est terminé, mais c’est maintenant qu’il faut en prendre soin.', 'La saison se termine, et c’est le moment de préparer la suivante.')} Ce dernier chapitre aide ${c.audCore} à faire durer le résultat.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? v(d.c, `Ce que vous visiez : ${o}. Prenez une photo du résultat, et notez ce que vous avez utilisé : vous en aurez besoin pour le prochain meuble.`, `Votre objectif pour l’an prochain : ${o}. Notez ce qui a poussé, où, et avec quel arrosage.`) : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Deux habitudes font la différence sur la durée. D’abord : ${a}. Ensuite : ${b}.` : null; },
        (d) => v(d.c, 'Notez ce que vous referiez autrement. Le deuxième meuble va deux fois plus vite que le premier, à condition d’avoir gardé la trace de ce qui a coincé.', 'Gardez vos étiquettes et vos notes de la saison : au printemps prochain, elles vaudront mieux que n’importe quel calendrier.'),
      ],
    },
  ],
};

// ───────────────────────────── démarche ─────────────────────────────

const DEMARCHE: ArchetypeDef = {
  id: 'demarche',
  howTo: [['Gardez votre espace ouvert', 'Faites chaque étape au moment où vous la lisez.'], ['Gardez chaque preuve', 'Une attestation, un seul dossier, nommé avec la date.'], ['Cochez la checklist', 'Vous voyez d’un coup d’œil ce qui reste à faire.']],
  stepNoun: { word: 'étape', fem: true },
  plan: 'phases',
  planColumn: 'Quand',
  short: { 5: ['regles', 'procedure', 'erreurs', 'calendrier', 'rituel'], 6: ['regles', 'preparer', 'procedure', 'erreurs', 'calendrier', 'rituel'] },
  promise: (_c, o) => `une procédure claire pour arriver à ceci : ${o}`,
  subtitle: (c) => `La procédure pas à pas pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : la procédure pas à pas`, `${a.Ps} : la procédure pas à pas`, `${cap(c.audCore)} : la procédure en ${a.steps} étapes`],
  introOpen: (_c, a) => `Vous n’êtes pas seul à vous poser la question : ${a.pain}.${a.p1 ? ` On la retrouve partout, sous cette forme : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''} La démarche n’est pas compliquée ; ce qui la rend inquiétante, c’est que personne ne l’explique dans l’ordre.`,
  introWhy: (_c, a) => `Une erreur administrative fait peur parce qu’on ne sait pas ce qu’elle coûte.${a.pains.length >= 2 ? ` Entre ${a.pains[0]} et ${a.pains[1]}, on finit par repousser, et c’est ce report qui crée le vrai problème.` : ' On finit par repousser, et c’est ce report qui crée le vrai problème.'}`,
  introUse: (c, a) => `${usePlain(c, a, 'une procédure pas à pas, les cas particuliers et un calendrier de l’année')} Les règles évoluent : pour tout montant ou taux, la référence reste le site officiel, et le guide vous dit où regarder.`,
  introRead: () => 'Comment lire ce guide ? Gardez votre espace personnel ouvert à côté, et faites chaque étape au moment où vous la lisez. Une démarche comprise mais non faite ne sert à rien.',
  whyFallback: [
    'Faites-la une fois pour toutes : elle ne vous demandera plus d’y repenser.',
    'Gardez la preuve de cette étape dans un seul dossier, numérique ou papier.',
    'Si un écran ne correspond pas à ce que vous attendez, vérifiez sur le site officiel avant de valider.',
  ],
  situationsFallback: [
    { when: 'vous avez un doute sur un montant', what: 'Ne devinez pas : notez la question et vérifiez sur le site officiel, ou contactez l’organisme.' },
    { when: 'vous avez raté une échéance', what: 'Régularisez dès que vous vous en rendez compte. Un retard se traite bien mieux qu’un silence.' },
    { when: 'un courrier vous inquiète', what: 'Lisez-le en entier, vérifiez qu’il vient bien de l’organisme, et connectez-vous directement à votre espace plutôt que de suivre un lien.' },
  ],
  fillers: [
    () => 'Créez un seul dossier pour tout ce qui concerne cette démarche. Le jour où on vous demande une pièce, vous mettez deux minutes au lieu de deux heures.',
    () => 'Notez la date et l’heure de chaque démarche importante, avec une capture d’écran de la confirmation. Elle ne sert presque jamais, et elle sert toujours le jour où il y a un doute.',
    () => 'Quand une règle vous paraît floue, cherchez la réponse sur le site officiel plutôt que sur un forum. Les forums parlent de cas particuliers, souvent anciens.',
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'regles', role: 'comprendre',
      title: () => 'Les règles du jeu, sans jargon',
      intro: (c) => `Une règle comprise ne fait plus peur. Ce chapitre pose ce que ${c.audCore} doivent savoir, à partir de ce qui inquiète le plus : ${pb(c)}.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `Voici la base. ${f}` : 'Quelques règles suffisent à éviter la plupart des mauvaises surprises : elles sont simples, mais rarement expliquées dans l’ordre.'; },
        (d) => { const f = d.facts(3); return f ? `${f} Rien de cela n’exige de connaissances comptables : il faut seulement savoir où regarder.` : null; },
        () => 'Gardez une règle en tête : ce guide explique la logique, et le site officiel donne les chiffres de l’année. Un montant lu ailleurs peut être périmé, la logique ne l’est pas.',
      ],
      steps: () => ['Lire les règles de ce chapitre une fois', 'Vérifier sur le site officiel celles qui vous concernent', 'Noter ce qui change pour votre situation'],
      checks: () => ['Je comprends la règle principale', 'Je sais où vérifier un chiffre', 'J’ai noté ce qui me concerne'],
    },
    {
      kind: 'preparer', role: 'diagnostic',
      title: () => 'Ce qu’il faut avoir sous la main',
      intro: (c) => `Une démarche qui bloque, c’est souvent une information qui manque. ${cap(c.audCore)} réunissent ici tout ce qu’il faut, une fois pour toutes.`,
      paras: [
        (d) => d.c.diag ? `Point de départ : ${low(d.c.diag.text)}. ${d.c.diag.detail}` : 'Point de départ : réunir les informations qui décident de tout le reste.',
        lookFor,
        (d) => `La fiche de ce chapitre rassemble l’essentiel : ${columnsOf(d.c)}. Remplissez-la une fois, gardez-la à portée de main, et vous n’aurez plus à chercher.`,
        () => 'Si une ligne reste vide, ne passez pas à la suite : c’est le signe que quelque chose n’est pas clair, et c’est le bon moment pour le vérifier.',
      ],
      steps: (c) => [c.diag?.text ?? 'Identifier votre situation exacte', 'Remplir la fiche de ce chapitre', 'Vérifier chaque ligne dans votre espace personnel'],
      checks: () => ['Ma fiche est remplie', 'Mes identifiants sont retrouvés', 'Mon dossier unique est créé'],
    },
    {
      kind: 'procedure', role: 'methode',
      title: (_c, n) => `La procédure en ${n} étapes`,
      intro: (c) => `Voici la procédure complète, écrite pour ${c.audCore}. Chaque étape se fait une fois, puis devient une routine de quelques minutes.`,
      paras: [modelPara],
    },
    {
      kind: 'erreurs', role: 'erreurs',
      title: (_c, n) => `Les ${n} erreurs qui coûtent cher`,
      intro: (c) => `Ces erreurs ne viennent pas d’un manque de sérieux, mais de règles que personne n’explique ${toAud(c)}.`,
      paras: [],
      steps: () => ['Vérifier chaque point de cette liste sur votre dernière démarche', 'Corriger ce qui peut encore l’être', 'Ajouter un rappel pour ne pas recommencer'],
    },
    {
      kind: 'cas', role: 'situations',
      title: (_c, n) => `Les ${n} cas particuliers, et quoi faire`,
      intro: (c) => `La règle générale ne couvre pas tout. Voici les cas qui inquiètent le plus ${c.audCore}, et la conduite à tenir.`,
      paras: [],
      steps: () => ['Repérer le cas qui vous concerne', 'Appliquer la réponse de ce chapitre', 'Garder une trace écrite de ce que vous avez fait'],
    },
    {
      kind: 'calendrier', role: 'programme',
      title: (c) => `Votre mise en place en ${D(c)}, étape par étape`,
      intro: (c) => `En une semaine, ${c.audCore} mettent tout en place. Ensuite, il ne reste qu’un rendez-vous récurrent de quelques minutes.`,
      paras: [
        () => 'Ces étapes se font dans l’ordre, chacune en une séance courte. Elles ne se reproduisent pas : une fois posées, elles travaillent pour vous.',
        modelPara,
        () => 'Ne cherchez pas à tout faire en une soirée. Une séance à la fois laisse le temps de vérifier une information sur le site officiel, ou de poser une question, avant de passer à la suivante.',
      ],
      checks: () => ['Semaine de mise en place bloquée', 'Rappels programmés', 'Première échéance notée'],
    },
    {
      kind: 'rituel', role: 'durer',
      title: () => 'Votre rituel pour ne plus y penser',
      steps: () => ['Bloquer dans l’agenda un rendez-vous de 15 minutes avant chaque échéance', 'Télécharger chaque attestation et la ranger dans le même dossier', 'Relire chaque janvier votre taux, votre périodicité et les seuils de l’année'],
      checks: () => ['Mon rendez-vous récurrent est noté', 'Mon dossier d’attestations est à jour', 'Mon rappel de janvier est programmé'],
      intro: (c) => `La bonne démarche est celle qu’on oublie entre deux échéances. Ce chapitre donne ${toAud(c)} un rituel court, à répéter.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? `Ce que vous visez maintenant : ${o}. Cela tient à un rendez-vous fixe avec vous-même, noté dans l’agenda comme un client.` : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Deux gestes rendent ce rendez-vous très court. D’abord : ${a}. Ensuite : ${b}.` : null; },
        () => 'Une fois par an, relisez le guide en entier et vérifiez ce qui a changé sur le site officiel : les règles évoluent, et une habitude installée peut devenir une erreur.',
      ],
    },
  ],
};

// ───────────────────────────── examen ─────────────────────────────

const EXAMEN: ArchetypeDef = {
  id: 'examen',
  howTo: [['Commencez par l’épreuve', 'Sachez ce qui est évalué avant de réviser quoi que ce soit.'], ['Mesurez votre point de départ', 'Le plan se règle sur ce que vous aurez mesuré.'], ['Cochez la checklist', 'Elle montre ce qui est solide et ce qu’il reste à travailler.']],
  stepNoun: { word: 'étape', fem: true },
  plan: 'phases',
  planColumn: 'Quand',
  short: { 5: ['epreuve', 'technique', 'pieges', 'planning', 'finale'], 6: ['epreuve', 'niveau', 'technique', 'pieges', 'planning', 'finale'] },
  promise: (c, o) => `un plan de préparation de ${D(c)} pour arriver à ceci : ${o}`,
  subtitle: (c) => `Le plan de préparation de ${D(c)} pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : le plan de préparation en ${a.D}`, `${a.Ps} : le plan de préparation en ${a.D}`, `${cap(c.audCore)} : le plan de ${a.D}`],
  introOpen: (_c, a) => `Vous connaissez ce moment où tout se bloque : ${a.pain}.${a.p1 ? ` Beaucoup l’écrivent exactement ainsi : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''} ${v(_c, 'Une préparation sérieuse ne supprime pas l’enjeu, mais elle change ce qui se passe le jour J.', 'Personne ne supprime le stress d’un jury, mais on peut lui enlever presque tout son pouvoir.', 'Vous n’êtes pas moins capable que les autres : vous avez besoin d’une préparation plus adaptée.')}`,
  introWhy: (c, a) => `${v(c, 'Le plus souvent, le problème n’est pas le niveau : c’est la façon de se préparer.', 'Ce qui fait la différence n’est pas d’en savoir plus, c’est de savoir le dire.', 'Ce n’est pas une question d’heures passées, c’est une question de méthode.')}${a.pains.length >= 2 ? ` Quand on vit ${a.pains[0]}, puis ${a.pains[1]}, on travaille plus, et pas forcément mieux.` : ' On travaille plus, et pas forcément mieux.'}`,
  introUse: (c, a) => usePlain(c, a, v(c, 'une méthode de travail, des simulations, une préparation du jour J et un tableau de suivi', 'des réponses à construire, des simulations et une grille à faire remplir par un proche', 'une façon de réviser, une méthode contre le stress et un planning à imprimer')),
  introRead: (c) => v(c, 'Comment lire ce guide ? Commencez par le chapitre sur l’épreuve, puis mesurez votre point de départ avant toute révision. Le reste du guide se règle sur ce que vous aurez mesuré.', 'Prenez ce guide un crayon à la main : les réponses que vous écrivez vous-même sont celles que vous retiendrez.', 'Lisez un chapitre par jour, entre deux révisions : c’est une pause utile, pas une matière de plus.'),
  whyFallback: [
    'Elle compte plus qu’elle n’en a l’air : l’entraînement n’est utile que s’il ressemble à l’épreuve.',
    'Chronométrez-vous dès maintenant, même si le résultat est moins bon au début.',
    'Faites-la à voix haute ou par écrit : on ne sait vraiment que ce qu’on sait restituer.',
  ],
  situationsFallback: [
    { when: 'vous perdez vos moyens', what: 'Respirez lentement, revenez à la question posée, et commencez par ce que vous savez.' },
    { when: 'vous n’avancez plus', what: 'Changez d’exercice plutôt que de durée : un autre type de question relance l’attention.' },
    { when: 'vous prenez du retard sur le planning', what: 'Ne doublez pas les séances. Retirez ce qui rapporte le moins, et gardez ce qui rapporte le plus.' },
  ],
  fillers: [
    () => 'Gardez le même créneau chaque jour. Le cerveau s’habitue vite : à force, l’heure de travail arrive sans qu’il faille se motiver.',
    () => 'Travaillez d’abord ce qui rapporte le plus, pas ce qui vous rassure le plus. C’est inconfortable, et c’est la raison pour laquelle c’est efficace.',
    () => 'Après chaque simulation, notez une seule chose à changer. Dix remarques ne servent à rien ; une seule, appliquée à la séance suivante, change vraiment quelque chose.',
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'epreuve', role: 'comprendre',
      title: () => 'Ce que l’épreuve mesure vraiment',
      intro: (c) => `${v(c, 'On se prépare mal à ce qu’on connaît mal.', 'Le jour J fait moins peur quand on sait ce qui vous attend.', 'Une épreuve se prépare mieux quand on sait ce qu’elle mesure.')} Ce chapitre montre ${toAud(c)} ce qui est évalué et ce qui ne l’est pas, à partir de ce qui bloque le plus : ${pb(c)}.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `${v(d.c, 'Premier repère, avant toute révision.', 'Commençons par le cadre.', 'Voici le cadre.')} ${f}` : 'Avant toute révision, il faut savoir comment l’épreuve se déroule et ce qu’elle récompense : c’est ce qui décide de votre façon de travailler.'; },
        (d) => { const f = d.facts(3); return f ? `${f} ${v(d.c, 'Autrement dit, on ne vous demande pas de tout savoir : on vous demande de bien utiliser ce que vous savez.', 'Le jury ne cherche pas la bonne réponse : il cherche la bonne personne.', 'En clair, le corps et la mémoire travaillent ensemble : ce chapitre compte autant que les révisions.')}` : null; },
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? v(d.c, `Cela change votre lecture de ${p}. Ce n’est pas un manque de niveau : c’est le signe qu’il faut s’entraîner autrement.`, `Vous voyez maintenant ${p} autrement : c’est un point à travailler, pas un obstacle définitif.`, `Si vous vivez ${p}, retenez ceci : ce n’est pas une question de niveau, et cela se travaille.`) : null; },
      ],
      steps: () => ['Lire le déroulé exact de votre épreuve', 'Noter ce qui rapporte le plus de points', 'Vérifier les modalités officielles pour votre session'],
      checks: () => ['Je connais le déroulé de l’épreuve', 'Je sais ce qui est évalué', 'J’ai vérifié les modalités de ma session'],
    },
    {
      kind: 'niveau', role: 'diagnostic',
      title: () => 'Mesurer votre point de départ',
      intro: (c) => `${v(c, 'Un plan se construit à partir d’un point de départ réel.', 'Avant de préparer quoi que ce soit, il faut savoir ce que vous avez déjà.', 'Avant d’ouvrir un cahier, prenez une photo de la situation.')} ${cap(c.audCore)} mesurent ici où ils en sont.`,
      paras: [
        (d) => d.c.diag ? `Premier réflexe : ${low(d.c.diag.text)}. ${d.c.diag.detail}` : 'Premier geste : faire le point honnêtement, en conditions proches de l’épreuve.',
        lookFor,
        (d) => `Le relevé de ce chapitre tient sur une page : ${columnsOf(d.c)}. ${v(d.c, 'Il ne sert pas à vous juger, mais à décider où mettre votre temps.', 'Il vous montrera que votre parcours contient déjà beaucoup de réponses.', 'En le remplissant, vous verrez aussitôt où se trouvent les points faciles à gagner.')}`,
        (d) => v(d.c, 'Regardez ce relevé comme une carte : une zone faible n’est pas un défaut, c’est l’endroit où chaque heure de travail rapporte le plus.', 'Ne cherchez pas à tout rendre exceptionnel : cherchez ce qui est vrai, et que vous pourrez raconter simplement.', 'Commencez par ce qui a le plus gros coefficient : c’est là qu’un point gagné pèse le plus.'),
      ],
      steps: (c) => [c.diag?.text ?? 'Faire une évaluation complète de votre niveau', 'Remplir le relevé de ce chapitre', 'Choisir les deux points à travailler en premier'],
      checks: () => ['Mon point de départ est mesuré', 'Mon relevé est rempli', 'Mes deux priorités sont choisies'],
    },
    {
      kind: 'technique', role: 'methode',
      title: (_c, n) => `La méthode de travail en ${n} étapes`,
      intro: (c) => `Voici comment travailler, écrit pour ${c.audCore}. ${v(c, 'Chaque étape remplace une habitude qui donne l’impression d’avancer sans faire progresser.', 'Chaque étape vous rapproche d’un discours qui vous ressemble.', 'Ces étapes s’appuient sur ce qui fait vraiment retenir.')}`,
      paras: [modelPara],
    },
    {
      kind: 'pieges', role: 'erreurs',
      title: (_c, n) => `Les ${n} pièges qui font perdre des points`,
      intro: (c) => `${v(c, 'Ces pièges coûtent des points à des candidats qui connaissent pourtant leur sujet.', 'Ces réflexes sont naturels, et ils jouent contre vous devant un jury.', 'Ces habitudes rassurent, mais elles font perdre de l’énergie.')} Ce sont ceux où ${c.audCore} tombent le plus.`,
      paras: [],
      steps: () => ['Relire ces pièges avant chaque simulation', 'Noter celui qui vous a coûté le plus cher', 'Le travailler en priorité à la séance suivante'],
    },
    {
      kind: 'jourj', role: 'situations',
      title: (_c, n) => `Les ${n} moments qui font décrocher, et comment réagir`,
      intro: (c) => `${v(c, 'Pendant la préparation comme le jour J, tout ne se passe jamais comme prévu.', 'Un moment de flottement n’a rien de grave devant un jury.', 'Même bien préparé, vous aurez des moments de doute.')} Voici les moments qui déstabilisent ${c.audCore}, et comment reprendre la main.`,
      paras: [],
      steps: () => ['Lire ces situations à voix haute une fois', 'Choisir votre réaction pour les deux qui vous font le plus peur', 'La répéter en simulation'],
    },
    {
      kind: 'planning', role: 'programme',
      title: (c) => `Le planning de ${D(c)}, phase par phase`,
      intro: (c) => `Voici le planning de ${D(c)}, conçu pour ${c.audCore}. ${v(c, 'Chaque phase prépare la suivante, et la dernière ressemble à l’épreuve.', 'On écrit d’abord, on répète ensuite, on simule à la fin.', 'Il laisse de la place au sommeil, au sport et à une vraie pause par semaine.')}`,
      paras: [
        (d) => v(d.c, 'Le planning est volontairement chargé au début et plus léger à la fin. Les derniers jours servent à consolider et à dormir, pas à découvrir du nouveau.', 'La première semaine est faite d’écriture, la dernière de répétition à voix haute : on ne devient pas à l’aise à l’oral en relisant.', 'Le planning s’allège à l’approche de l’examen : vous n’arrivez pas à la dernière semaine avec un retard à rattraper.'),
        modelPara,
        (d) => v(d.c, 'Si vous prenez du retard, ne décalez pas tout. Retirez une tâche de la phase en cours, et gardez la simulation : c’est elle qui vous dira où vous en êtes vraiment.', 'Si une semaine saute, gardez avant tout la simulation avec un proche : c’est le meilleur entraînement que vous ayez.', 'En cas de retard, retirez un chapitre secondaire plutôt qu’une heure de sommeil.'),
      ],
      checks: () => ['Dates de l’épreuve notées', 'Planning imprimé ou recopié', 'Simulations bloquées dans l’agenda'],
    },
    {
      kind: 'finale', role: 'durer',
      title: () => 'La dernière ligne droite',
      steps: () => ['Arrêter les nouveautés 3 jours avant l’épreuve', 'Préparer la veille la tenue, la convocation et le trajet', 'Se coucher à l’heure habituelle la veille'],
      checks: () => ['Plus rien de nouveau à apprendre', 'Mon sac et mon trajet sont prêts', 'Mon heure de coucher est fixée'],
      intro: (c) => `${v(c, 'Les derniers jours ne servent pas à en faire plus.', 'La dernière semaine n’est pas faite pour apprendre encore.', 'À quelques jours de l’examen, le travail change de nature.')} Ce temps sert à arriver reposé, avec tout ce que ${c.audCore} ont déjà construit.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? `${v(d.c, 'Ce que vous visez, concrètement', 'Votre objectif pour ce jour-là', 'Gardez ce cap')} : ${o}. ${v(d.c, 'Écrivez-le, et relisez-le quand le doute arrive.', 'Dites-le à voix haute avant d’entrer.', 'Notez-le en haut de votre planning.')}` : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Deux réflexes pour ces derniers jours. D’abord : ${a}. Ensuite : ${b}.` : null; },
        (d) => v(d.c, 'La veille, arrêtez tôt. Ce que vous n’avez pas appris à ce stade ne se gagnera pas cette nuit, alors qu’une bonne nuit, elle, se voit le lendemain.', 'La veille, préparez votre dossier et votre tenue, relisez une seule fois votre présentation, et faites autre chose.', 'La veille, fermez les cahiers en fin d’après-midi : le cerveau a besoin de cette soirée pour ranger ce qu’il sait.'),
      ],
    },
  ],
};

// ───────────────────────────── événement ─────────────────────────────

const EVENEMENT: ArchetypeDef = {
  id: 'evenement',
  howTo: [['Lisez avant de réserver', 'C’est l’ordre des décisions qui fait le budget.'], ['Remplissez le budget', 'Avant de contacter qui que ce soit.'], ['Cochez la checklist', 'Chaque décision prise libère la suivante.']],
  stepNoun: { word: 'décision', fem: true },
  plan: 'phases',
  planColumn: 'Quand',
  short: { 5: ['cadre', 'decisions', 'erreurs', 'retroplanning', 'derniere'], 6: ['cadre', 'budget', 'decisions', 'erreurs', 'retroplanning', 'derniere'] },
  promise: (_c, o) => `un budget et un rétroplanning pour arriver à ceci : ${o}`,
  subtitle: (c) => `Le budget et le rétroplanning pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : budget et rétroplanning sur ${a.D}`, `${a.Ps} : budget et rétroplanning sur ${a.D}`, `${cap(c.audCore)} : le rétroplanning sur ${a.D}`],
  introOpen: (_c, a) => `Vous avez commencé à regarder les prix, et le constat tombe : ${a.pain}.${a.p1 ? ` D’autres l’écrivent aussi : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''} ${v(_c, 'Ce qui fait peur n’est pas le montant : c’est de ne pas savoir où passe l’argent.', 'Le plus dur n’est pas le prix : c’est de ne pas savoir à quoi s’attendre.')}`,
  introWhy: (c, a) => `${v(c, 'Un budget ne dérape pas d’un coup. Il dérape par petites décisions prises dans le désordre, sous la pression du moment.', 'Un budget de voyage se perd rarement sur une grosse dépense : il se perd sur une suite de réservations faites sans vue d’ensemble.')}${a.pains.length >= 2 ? ` Entre ${a.pains[0]} et ${a.pains[1]}, chaque choix semble raisonnable, et le total ne l’est plus.` : ''}`,
  introUse: (c, a) => usePlain(c, a, v(c, 'un budget poste par poste, les décisions dans le bon ordre et un rétroplanning', 'un itinéraire logique, un budget clair et un calendrier des réservations')),
  introRead: (c) => v(c, 'Comment lire ce guide ? Lisez-le à deux, un chapitre à la fois, et remplissez le budget avant de contacter qui que ce soit.', 'Avant de réserver quoi que ce soit, lisez ce guide en entier : c’est l’ordre des réservations qui fait le budget.'),
  whyFallback: [
    'Prenez-la tôt : plus elle arrive tard, moins vous avez de choix.',
    'Une fois prise, ne la rediscutez plus sauf nouvelle information : c’est elle qui libère toutes les suivantes.',
    'Notez-la par écrit, avec son montant : une décision orale se renégocie toute seule.',
  ],
  situationsFallback: [
    { when: 'le budget dépasse', what: 'Revenez à vos priorités écrites, et retirez un poste entier plutôt que de rogner partout.' },
    { when: 'un prestataire ou une réservation vous lâche', what: 'Relisez les conditions, activez votre plan B, et utilisez la marge d’imprévus prévue pour cela.' },
    { when: 'vous n’êtes plus d’accord', what: 'Reprenez la liste de vos priorités et décidez à partir d’elle, pas du dernier avis entendu.' },
  ],
  fillers: [
    () => 'Une feuille partagée vaut mieux que dix conversations. Tout ce qui est décidé y entre, avec son montant et sa date : plus personne n’a à se souvenir de rien.',
    () => 'Pour chaque dépense, posez-vous une seule question : est-ce que cela se verra, se sentira ou se souviendra dans cinq ans ? Si la réponse est non, c’est là qu’il faut économiser.',
    () => 'Demandez toujours ce qui se passe en cas d’annulation avant de payer quoi que ce soit. La réponse dit beaucoup de la personne en face.',
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'cadre', role: 'comprendre',
      title: () => 'Où part vraiment l’argent',
      intro: (c) => `${v(c, 'Avant de chercher des économies, il faut savoir où elles sont.', 'Un petit budget ne se gère pas sur place : il se construit avant de partir.')} Ce chapitre montre ${toAud(c)} ce qui pèse vraiment, et d’où vient ${pb(c)}.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `Partons des faits. ${f}` : 'Quelques postes font presque tout le budget : c’est là que se trouvent les vraies marges de manœuvre.'; },
        (d) => { const f = d.facts(3); return `${f ? `${f} ` : ''}Les plus grosses économies ne se font pas sur les détails, mais sur quelques décisions prises tôt.`; },
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? `Quand on lit ${p}, on voit bien le piège : réagir poste par poste, au lieu de décider de l’ensemble.` : null; },
      ],
      steps: () => ['Lister ce qui compte vraiment pour vous', 'Repérer les postes qui pèsent le plus', 'Accepter ce que vous ne ferez pas'],
      checks: () => ['Je sais où part l’argent', 'Je connais mes trois postes les plus lourds', 'J’ai noté ce que je ne ferai pas'],
    },
    {
      kind: 'budget', role: 'diagnostic',
      title: () => 'Fixer le cadre avant de contacter qui que ce soit',
      intro: (c) => `${v(c, 'Un cadre fixé tôt évite cent discussions plus tard.', 'Quelques réponses simples évitent bien des mauvaises réservations.')} ${cap(c.audCore)} posent ici les chiffres et les priorités qui décideront de tout le reste.`,
      paras: [
        (d) => d.c.diag ? `Tout commence par là : ${low(d.c.diag.text)}. ${d.c.diag.detail}` : 'Tout commence par là : poser vos chiffres et vos priorités, avant de demander le moindre prix.',
        lookFor,
        (d) => `La feuille de ce chapitre tient en quelques lignes : ${columnsOf(d.c)}. ${v(d.c, 'Remplissez-la avant de regarder les prix : vous éviterez de vous laisser guider par la première offre.', 'Faites-le avant d’ouvrir un site de réservation : les prix affichés influencent vite vos choix.')}`,
        (d) => v(d.c, 'Gardez une marge. Elle ne sert pas à faire plus beau : elle sert à absorber ce qui dépasse, et il y a toujours quelque chose qui dépasse.', 'Prévoyez une réserve. Les taux de change, un train manqué ou une nuit de plus finiront par la justifier.'),
      ],
      steps: (c) => [c.diag?.text ?? 'Définir vos priorités', 'Remplir la feuille de ce chapitre', 'Bloquer une marge pour les imprévus'],
      checks: () => ['Mes priorités sont écrites', 'Mon budget total est fixé', 'Ma marge est bloquée'],
    },
    {
      kind: 'decisions', role: 'methode',
      title: (_c, n) => `Les ${n} décisions, dans le bon ordre`,
      intro: (c) => `${v(c, 'L’ordre des décisions compte autant que les décisions elles-mêmes.', 'Une réservation prise trop tôt ou trop tard coûte cher.')} Voici l’ordre qui protège le budget ${ofAud(c.audCore)}.`,
      paras: [modelPara],
    },
    {
      kind: 'erreurs', role: 'erreurs',
      title: (_c, n) => `Les ${n} erreurs qui font exploser le budget`,
      intro: (c) => `${v(c, 'Aucune de ces erreurs ne semble grave sur le moment, et c’est leur danger.', 'Prises une à une, ces erreurs ont l’air anodines : additionnées, elles pèsent lourd.')} Ce sont celles qui coûtent le plus cher ${toAud(c)}.`,
      paras: [],
      steps: () => ['Relire cette liste avant chaque signature ou réservation', 'Vérifier le devis ou les conditions ligne par ligne', 'Demander ce qui manque par écrit'],
    },
    {
      kind: 'imprevus', role: 'situations',
      title: (_c, n) => `Les ${n} imprévus à anticiper`,
      intro: (c) => `${v(c, 'Il y aura des imprévus, et ce n’est pas grave quand ils sont prévus.', 'Sur place, tout ne se passera pas comme sur le papier.')} Voici ceux qui attendent ${c.audCore}, et la réponse à préparer.`,
      paras: [],
      steps: () => ['Choisir les deux imprévus qui vous inquiètent le plus', 'Écrire votre plan B pour chacun', 'Le partager avec la personne concernée'],
    },
    {
      kind: 'retroplanning', role: 'programme',
      title: (c) => `Le rétroplanning sur ${D(c)}, étape par étape`,
      intro: (c) => `${v(c, 'Le rétroplanning part de la date et remonte dans le temps.', 'Tout se compte à rebours depuis le jour du départ.')} ${cap(c.audCore)} savent ainsi ce qui doit être fait à chaque moment, et ce qui peut attendre.`,
      paras: [
        (d) => v(d.c, 'Lisez ce tableau de bas en haut une fois : vous verrez que les dernières semaines sont calmes si les premières ont été tenues. Tout ce qui reste à faire au dernier moment coûte plus cher.', 'Les premières lignes sont les plus importantes : ce sont elles qui fixent le prix du voyage. Les dernières ne sont plus que de l’organisation.'),
        modelPara,
        (d) => v(d.c, 'Bloquez ces moments dans votre agenda dès aujourd’hui, comme de vrais rendez-vous. Une décision sans date finit toujours par être prise dans l’urgence.', 'Notez ces dates dans votre calendrier : les prix montent souvent à mesure que le départ approche, et chaque semaine de retard se paie.'),
      ],
      checks: () => ['Dates bloquées dans l’agenda', 'Tableau partagé', 'Prochaine échéance notée'],
    },
    {
      kind: 'derniere', role: 'durer',
      title: () => 'La dernière ligne droite, sans stress',
      steps: (c) => ['Confirmer chaque réservation une semaine avant', 'Réunir les documents et les montants sur une seule page', v(c, 'Confier à quelqu’un de confiance ce qui reste à suivre le jour même', 'Garder une réserve pour les imprévus des derniers jours')],
      checks: () => ['Les réservations sont confirmées', 'Tout tient sur une seule page', 'Le dernier budget est à jour'],
      intro: (c) => `${v(c, 'Quand tout est prévu, les derniers jours deviennent les meilleurs.', 'Une fois sur place, votre seul travail est de profiter.')} Ce chapitre aide ${c.audCore} à le vivre sereinement.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? v(d.c, `Rappelez-vous ce que vous êtes en train de construire : ${o}. C’est ce repère qui permet de dire non aux dernières idées qui coûtent cher.`, `Gardez ce cap : ${o}. Il aide à dire non aux dépenses de dernière minute.`) : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Deux réflexes pour finir sereinement. D’abord : ${a}. Ensuite : ${b}.` : null; },
        (d) => v(d.c, 'La dernière semaine, n’ajoutez plus rien. Confiez à quelqu’un de confiance les détails du jour même : votre rôle, ce jour-là, est d’en profiter.', 'Les derniers jours avant le départ, n’ajoutez plus de réservation : gardez de la place pour les découvertes sur place.'),
      ],
    },
  ],
};

// ───────────────────────────── système ─────────────────────────────

const SYSTEME: ArchetypeDef = {
  id: 'systeme',
  howTo: [['Lisez le cycle en entier', 'Vous verrez comment les étapes s’enchaînent.'], ['Lancez un premier tour', 'Sans chercher à tout réussir du premier coup.'], ['Cochez, puis ajustez', 'C’est le deuxième tour qui montre quoi changer.']],
  stepNoun: { word: 'maillon', fem: false },
  plan: 'phases',
  planColumn: 'Quand',
  short: { 5: ['logique', 'cycle', 'erreurs', 'semaines', 'rythme'], 6: ['logique', 'depart', 'cycle', 'erreurs', 'semaines', 'rythme'] },
  promise: (c, o) => `un système à faire tourner pendant ${D(c)} pour arriver à ceci : ${o}`,
  subtitle: (c) => `Le système pas à pas pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : le système en ${a.steps} étapes`, `${a.Ps} : le système en ${a.steps} étapes`, `${cap(c.audCore)} : le système de ${a.D}`],
  introOpen: (_c, a) => `Vous avez sans doute déjà tout essayé par à-coups, et le résultat reste le même : ${a.pain}.${a.p1 ? ` On le lit partout, en ces termes : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''} ${v(_c, 'Ce n’est pas une question d’astuce de plus : c’est une question de système.', 'Une astuce de plus n’y changera rien : c’est l’organisation qui manque.', 'Il ne vous manque pas une idée : il vous manque une routine.')}`,
  introWhy: (c, a) => `${v(c, 'Une astuce marche une fois, un système marche chaque semaine.', 'Ce qui rapporte, ce n’est pas le bon coup : c’est la répétition.', 'Les résultats viennent de ce que l’on fait chaque semaine, pas d’un seul grand effort.')}${a.pains.length >= 2 ? ` Tant que ${a.pains[0]} et ${a.pains[1]} se règlent au coup par coup, chaque semaine repart de zéro.` : ' Tant que tout se règle au coup par coup, chaque semaine repart de zéro.'}`,
  introUse: (c, a) => usePlain(c, a, v(c, 'un cycle à répéter, ce qu’il faut mesurer et un tableau de suivi', 'une routine simple, les bons chiffres à suivre et un tableau à imprimer', 'une méthode en étapes, les réponses aux blocages et un tableau de suivi')),
  introRead: (c) => v(c, 'Comment lire ce guide ? Lisez d’abord le cycle en entier, puis lancez-le une première fois sans chercher à tout réussir. C’est la deuxième semaine qui montre ce qu’il faut ajuster.', 'Le meilleur usage de ce guide : le lire une fois, puis commencer petit, dès cette semaine, avec une poignée d’articles.', 'Lisez-le une fois en entier, choisissez votre cible, puis suivez les semaines dans l’ordre, sans en sauter.'),
  whyFallback: [
    'Tenez-le même quand tout va bien : c’est lui qui empêche le système de se dérégler.',
    'Faites-le toujours au même moment : un maillon qui change de place finit par sauter.',
    'Mesurez ce qu’il produit au bout de deux cycles, jamais au bout d’un seul.',
  ],
  situationsFallback: [
    { when: 'une semaine déraille', what: 'Faites le cycle le plus court possible, et reprenez la version normale la semaine suivante.' },
    { when: 'le résultat stagne', what: 'Regardez vos chiffres et changez un seul maillon à la fois.' },
    { when: 'ça vous prend trop de temps', what: 'Retirez une étape, et regroupez ce qui peut se faire en une seule séance.' },
  ],
  fillers: [
    () => 'Un système se juge sur quatre semaines, pas sur une. La première sert à découvrir, la deuxième à corriger, et c’est seulement ensuite que le résultat devient lisible.',
    () => 'Faites une fois par semaine une pause de dix minutes pour regarder vos chiffres. Le reste du temps, appliquez sans vous poser de questions : c’est ce qui rend le système reposant.',
    () => 'Cherchez ce qui se répète dans votre semaine et préparez-le une fois pour toutes. Un modèle, une liste ou un kit prêt à l’emploi vous évite de réfléchir à ce qui ne le mérite pas.',
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'logique', role: 'comprendre',
      title: () => 'Pourquoi ça ne tient pas sur la durée',
      intro: (c) => `${v(c, 'Si les efforts ne paient pas, ce n’est pas par manque de bonne volonté.', 'Le temps passé ne fait pas le résultat.', 'Beaucoup de travail n’apporte pas forcément de réponses, et ce n’est pas votre faute.')} Ce chapitre montre ${toAud(c)} ce qui se joue derrière ${pb(c)}.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `${v(d.c, 'Quelques faits, pour commencer.', 'Partons de ce qui est établi.', 'Voici ce qu’il faut savoir avant tout.')} ${f}` : 'Quelques points décident du résultat, semaine après semaine : tout le reste n’est que du bruit.'; },
        (d) => v(d.c, 'Sans système, on prend les mêmes décisions chaque semaine, dans l’urgence, avec la même fatigue. Avec un système, on les prend une fois, au calme, et on les applique ensuite.', 'Sans méthode, chaque article redevient une petite décision : quel prix, quelle photo, quand l’envoyer. Avec une méthode, ces choix sont déjà faits.', 'Sans routine, on prospecte quand on a le moral et on s’arrête dès qu’on a une mission. Avec une routine, le prochain client se prépare toutes les semaines.'),
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? `C’est pour cela qu’on retrouve toujours ${p} : le problème revient parce que rien, dans la semaine, ne l’empêche de revenir.` : null; },
        nextFact('Un dernier repère.'),
      ],
      steps: () => ['Noter ce qui se répète dans vos semaines', 'Repérer où part votre temps ou votre argent', 'Choisir ce que vous voulez cesser de décider chaque semaine'],
      checks: () => ['Je vois ce qui se répète', 'Je sais où part mon temps', 'J’ai choisi ce que je veux automatiser'],
    },
    {
      kind: 'depart', role: 'diagnostic',
      title: () => 'Partir de ce que vous avez déjà',
      intro: (c) => `${v(c, 'On ne construit pas un système sur du vide.', 'Le premier gisement se trouve déjà chez vous.', 'Votre point de départ vaut plus que vous ne le pensez.')} ${cap(c.audCore)} commencent par regarder ce qu’ils ont déjà sous la main.`,
      paras: [
        (d) => d.c.diag ? `Pour commencer : ${low(d.c.diag.text)}. ${d.c.diag.detail}` : 'Pour commencer : faire le tour de ce que vous avez déjà.',
        lookFor,
        (d) => `La feuille de ce chapitre sert à garder une trace : ${columnsOf(d.c)}. ${v(d.c, 'Elle se remplit en une demi-heure, et elle évite de repartir de zéro.', 'Elle prend moins d’une heure, et elle vous épargne de vendre au hasard.', 'Une demi-heure suffit, et vous saurez enfin à qui vous parlez.')}`,
        (d) => v(d.c, 'Ne visez pas l’exhaustivité. Une feuille remplie aux trois quarts aujourd’hui vaut mieux qu’une feuille parfaite qui n’existe pas encore.', 'Commencez par ce qui se vend vite : le reste attendra la deuxième vague.', 'Ne cherchez pas la formulation parfaite : vous l’affinerez avec les premières réponses.'),
      ],
      steps: (c) => [c.diag?.text ?? 'Faire le tour de ce que vous avez déjà', 'Remplir la feuille de ce chapitre', 'Repérer ce qui peut servir tout de suite'],
      checks: () => ['Ma feuille est remplie', 'Je sais ce que j’ai déjà', 'Je sais par quoi commencer'],
    },
    {
      kind: 'cycle', role: 'methode',
      title: (_c, n) => `Le cycle en ${n} étapes`,
      intro: (c) => `Voici le cycle complet, écrit pour ${c.audCore}. ${v(c, 'Il se répète à l’identique : c’est cette répétition qui rend le résultat prévisible.', 'Chaque étape se refait à chaque vague d’articles : c’est ce qui fait gagner du temps.', 'Vous le tiendrez plusieurs semaines : la régularité compte plus que le talent.')}`,
      paras: [modelPara],
    },
    {
      kind: 'erreurs', role: 'erreurs',
      title: (_c, n) => `Les ${n} erreurs qui cassent le système`,
      intro: (c) => `${v(c, 'Un système ne casse presque jamais d’un coup : il se dérègle sur un détail.', 'Quelques détails font la différence entre une vente rapide et une annonce oubliée.', 'Ces erreurs sont discrètes : elles ne se voient que dans l’absence de réponses.')} Voici celles qui coûtent le plus ${toAud(c)}.`,
      paras: [],
      steps: () => ['Vérifier cette liste à la fin de chaque cycle', 'Corriger un seul point par cycle', 'Noter ce que le changement a donné'],
    },
    {
      kind: 'blocages', role: 'situations',
      title: (_c, n) => `Quand ça coince : ${n} blocages et leur solution`,
      intro: (c) => `${v(c, 'Tout système finit par coincer quelque part.', 'Même une annonce parfaite peut rester sans réponse.', 'Tout le monde passe par des semaines sans retour.')} Voici les blocages que rencontrent ${c.audCore}, et comment les lever sans tout arrêter.`,
      paras: [],
      steps: () => ['Identifier le blocage de la semaine', 'Appliquer la solution de ce chapitre', 'Vérifier le résultat au cycle suivant'],
    },
    {
      kind: 'semaines', role: 'programme',
      title: (c) => `Le plan de ${D(c)}, étape par étape`,
      intro: (c) => `Voici comment installer le système sur ${D(c)}, au rythme ${ofAud(c.audCore)}. ${v(c, 'Chaque moment a sa tâche, et rien ne déborde sur le reste de la semaine.', 'Quelques minutes par jour suffisent, sur des moments bien choisis.', 'Le plan monte en charge progressivement, sans vous demander de tout faire d’un coup.')}`,
      paras: [
        (d) => v(d.c, 'Chaque ligne correspond à une tâche unique, à un moment fixe. Si elle est faite, tout le reste suit ; si elle saute, reportez-la au moment suivant sans rien ajouter.', 'Avancez ligne par ligne, sans chercher à tout publier d’un coup : la régularité vaut mieux qu’un grand déballage.', 'Tenez les lignes dans l’ordre : on ne prospecte pas avant d’avoir un profil clair, et on ne relance pas avant d’avoir écrit.'),
        modelPara,
        (d) => v(d.c, 'Le système se répète : une fois la première série terminée, reprenez le tableau au début, en gardant ce qui a bien marché et en retirant ce qui a coincé.', 'À la fin du mois, faites le compte de ce qui est parti et de ce qui reste, puis relancez une nouvelle vague.', 'Au bout de huit semaines, regardez ce qui a ouvert de vraies conversations, et gardez uniquement cela.'),
      ],
      checks: () => ['Moments fixés dans l’agenda', 'Tableau imprimé ou recopié', 'Bilan de fin de cycle prévu'],
    },
    {
      kind: 'rythme', role: 'durer',
      title: () => 'Trouver votre rythme de croisière',
      steps: () => ['Fixer un bilan de 10 minutes chaque mois', 'Garder ce qui a marché et retirer une tâche qui n’a rien donné', 'Relancer le cycle au début, sans le réinventer'],
      checks: () => ['Mon bilan du mois est dans l’agenda', 'Je sais ce que je garde', 'Mon prochain cycle est lancé'],
      intro: (c) => `${v(c, 'Après quelques cycles, le système doit coûter moins d’énergie qu’au début.', 'Une fois le rythme pris, tout devient plus léger.', 'Le plus dur est de tenir une fois les premiers résultats arrivés.')} Ce chapitre aide ${c.audCore} à trouver un rythme qui dure.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? `${v(d.c, 'Le cap reste le même', 'Votre objectif', 'Ce que vous visez')} : ${o}. ${v(d.c, 'Mesurez ce résultat une fois par mois, pas tous les jours.', 'Regardez ce chiffre une fois par mois.', 'Faites le point à la fin de chaque mois.')}` : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Deux habitudes allègent le système. D’abord : ${a}. Ensuite : ${b}.` : null; },
        (d) => v(d.c, 'Quand tout tourne, résistez à l’envie de tout changer. Un système qui fonctionne est ennuyeux : c’est son principal mérite.', 'Quand les ventes s’enchaînent, gardez la même méthode : ce qui a marché une fois marchera encore la saison suivante.', 'Quand une mission arrive, ne coupez pas tout : gardez une petite part de prospection, même minime.'),
      ],
    },
  ],
};

// ───────────────────────────── paliers ─────────────────────────────

const PALIERS: ArchetypeDef = {
  id: 'paliers',
  howTo: [['Lisez à deux', 'Chaque adulte qui donne à manger doit avoir les mêmes repères.'], ['Un palier à la fois', 'Passez au suivant quand celui-ci est devenu facile.'], ['Cochez la checklist', 'Elle dit ce qui est en place avant le prochain repas.']],
  stepNoun: { word: 'palier', fem: false },
  plan: 'phases',
  planColumn: 'Quand',
  short: { 5: ['securite', 'paliers', 'erreurs', 'calendrier', 'quotidien'], 6: ['securite', 'feux', 'paliers', 'erreurs', 'calendrier', 'quotidien'] },
  promise: (c, o) => `une progression par paliers sur ${D(c)} pour arriver à ceci : ${o}`,
  subtitle: (c) => `La progression pas à pas pour ${c.audArt}`,
  titles: (c, a) => [`${a.P} : la progression sur ${a.D}`, `${a.Ps} : la progression sur ${a.D}`, `${cap(c.audCore)} : la progression sur ${a.D}`],
  introOpen: (_c, a) => `Vous avez envie de bien faire, et une peur très concrète vous arrête : ${a.pain}.${a.p1 ? ` Beaucoup de parents l’écrivent ainsi : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''} Cette peur est saine : elle mérite des réponses précises, pas des slogans.`,
  introWhy: (_c, a) => `On ne franchit pas une telle étape d’un coup. On la franchit par paliers, avec des signaux clairs pour passer au suivant.${a.pains.length >= 2 ? ` Sans ces repères, on oscille entre ${a.pains[0]} et ${a.pains[1]}, sans savoir si tout va bien.` : ''}`,
  introUse: (c, a) => `${usePlain(c, a, 'des repères de sécurité, des paliers clairs, des réponses aux repas difficiles et un carnet à tenir')} Ce guide ne remplace pas l’avis du professionnel qui suit votre enfant : il vous aide à préparer cette conversation.`,
  introRead: () => 'Comment lire ce guide ? Lisez le premier chapitre avant tout repas, et une deuxième fois à deux, pour que chaque adulte qui donne à manger ait les mêmes repères.',
  whyFallback: [
    'Ne passez au suivant que lorsque celui-ci est devenu banal.',
    'Si le suivant se passe mal, redescendez d’un cran : ce n’est pas un échec, c’est le fonctionnement normal.',
    'Observez plutôt que de compter : c’est le comportement qui dit si le moment est venu.',
  ],
  situationsFallback: [
    { when: 'un palier se passe mal', what: 'Revenez au palier précédent quelques jours, puis retentez sans insister.' },
    { when: 'votre entourage s’inquiète', what: 'Expliquez ce que vous faites et pourquoi, avec les repères de ce guide, et demandez-lui de suivre les mêmes règles.' },
    { when: 'vous avez un doute', what: 'Notez ce que vous avez observé et parlez-en au professionnel qui suit votre enfant.' },
  ],
  fillers: [
    () => 'Le rythme de votre enfant n’est pas celui du voisin. Les paliers donnent un ordre, pas une date : un palier qui prend deux fois plus de temps reste un palier réussi.',
    () => 'Filmez un repas de temps en temps. Quand on doute, revoir ce qui s’est passé il y a trois semaines montre souvent un progrès qu’on ne voyait plus.',
    () => 'Tout adulte qui s’occupe de l’enfant doit connaître les mêmes repères. Un temps de partage de dix minutes évite bien des inquiétudes et des contradictions.',
    ...genericFillers,
  ],
  chapters: [
    {
      kind: 'securite', role: 'comprendre',
      title: () => 'La sécurité d’abord : ce qu’il faut savoir',
      intro: (c) => `On ne peut être serein qu’en sachant quoi surveiller. Ce chapitre donne ${toAud(c)} les repères qui répondent à ${pb(c)}.`,
      paras: [
        (d) => { const f = d.facts(2); return f ? `Commençons par les repères. ${f}` : 'Quelques repères simples changent le regard que vous portez sur les premiers repas.'; },
        (d) => { const f = d.facts(3); return f ? `${f} Connaître ces points est le meilleur moyen de ne pas transmettre votre inquiétude à table.` : null; },
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? `Derrière ${p}, il y a presque toujours le même besoin : savoir ce qui est normal et ce qui ne l’est pas. C’est exactement ce que ce chapitre pose.` : null; },
      ],
      steps: () => ['Lire ce chapitre à deux', 'Retenir la différence entre ce qui est normal et ce qui ne l’est pas', 'Noter les numéros d’urgence près de la table'],
      checks: () => ['Je connais les signes à surveiller', 'Tous les adultes ont lu ce chapitre', 'Les numéros d’urgence sont notés'],
    },
    {
      kind: 'feux', role: 'diagnostic',
      title: () => 'Les feux verts avant de commencer',
      intro: (c) => `L’âge seul ne suffit pas. ${cap(c.audCore)} vérifient ici les signes qui disent que le moment est venu.`,
      paras: [
        (d) => d.c.diag ? `Première chose à faire : ${low(d.c.diag.text)}. ${d.c.diag.detail}` : 'Première vérification : confirmer avec un professionnel que le moment est venu.',
        lookFor,
        (d) => `La grille de ce chapitre liste ce qu’il faut vérifier : ${columnsOf(d.c)}. Cochez seulement ce que vous avez vraiment observé, sur plusieurs jours.`,
        () => 'Si une ligne reste en « pas encore », attendez quelques jours et regardez à nouveau. Rien ne se perd à attendre ce feu vert.',
      ],
      steps: (c) => [c.diag?.text ?? 'Vérifier avec un professionnel que le moment est venu', 'Cocher les signes observés dans la grille', 'Choisir la date du premier essai'],
      checks: () => ['Les signes sont vérifiés', 'Le professionnel a donné son avis', 'La date du premier essai est choisie'],
    },
    {
      kind: 'paliers', role: 'methode',
      title: (_c, n) => `Les ${n} paliers de la progression`,
      intro: (c) => `Voici la progression, écrite pour ${c.audCore}. On ne passe au palier suivant que lorsque le précédent est devenu facile.`,
      paras: [modelPara],
    },
    {
      kind: 'erreurs', role: 'erreurs',
      title: (_c, n) => `Les ${n} erreurs à ne pas commettre`,
      intro: (c) => `Certaines de ces erreurs viennent de l’inquiétude, d’autres de conseils dépassés. Toutes se corrigent, et ce sont celles que ${c.audCore} rencontrent le plus.`,
      paras: [],
      steps: () => ['Lire cette liste avant le premier repas', 'La partager avec chaque adulte concerné', 'Vérifier que le matériel et les gestes sont en place'],
    },
    {
      kind: 'difficultes', role: 'situations',
      title: (_c, n) => `Les ${n} moments difficiles et comment réagir`,
      intro: (c) => `Il y aura des repas ratés et des moments d’inquiétude. Voici comment ${c.audCore} peuvent réagir, sans dramatiser ni minimiser.`,
      paras: [],
      steps: () => ['Repérer les situations qui vous inquiètent le plus', 'Relire la conduite à tenir', 'Noter dans le carnet ce qui s’est passé'],
    },
    {
      kind: 'calendrier', role: 'programme',
      title: (c) => `La progression sur ${D(c)}, palier par palier`,
      intro: (c) => `Voici un calendrier indicatif sur ${D(c)}, pensé pour ${c.audCore}. Les durées sont des repères : c’est votre enfant qui donne le rythme.`,
      paras: [
        () => 'Ce calendrier indique un ordre plus qu’une date. Un palier qui prend deux semaines de plus ne pose aucun problème ; un palier sauté en pose souvent.',
        modelPara,
        () => 'Avancez quand le palier précédent est devenu banal. Si un repas se passe mal, ne concluez rien : regardez plutôt ce qui s’est passé sur plusieurs jours.',
      ],
      checks: () => ['Calendrier affiché', 'Carnet tenu à jour', 'Point prévu avec le professionnel de santé'],
    },
    {
      kind: 'quotidien', role: 'durer',
      title: () => 'Installer tout ça dans le quotidien',
      steps: () => ['Prévoir deux repas par semaine à la table familiale', 'Revoir les aliments à risque avec chaque nouvelle personne qui garde bébé', 'Noter dans le carnet tout aliment à reproposer la semaine suivante'],
      checks: () => ['Les repas en famille sont en place', 'Chaque adulte connaît les repères', 'Le carnet reste à jour'],
      intro: (c) => `Une fois les paliers franchis, il reste à faire entrer tout ça dans une vraie semaine. Ce chapitre aide ${c.audCore} à le faire sans y passer ses journées.`,
      paras: [
        (d) => { const o = d.outcome(); return o ? `Le cap, c’est ceci : ${o}. Il se construit repas après repas, sans pression.` : null; },
        keepUp,
        (d) => { const [a, b] = [d.tip(), d.tip()]; return a && b ? `Deux habitudes simplifient la semaine. D’abord : ${a}. Ensuite : ${b}.` : null; },
        () => 'Gardez une chose en tête les jours difficiles : un repas ne se juge pas seul. C’est la semaine, et non l’assiette du soir, qui dit si tout va bien.',
      ],
    },
  ],
};

// ───────────────────────────── guide de suite ─────────────────────────────

/** What a follow-up guide says in its own name: the framing of a tax calendar is not the framing of a puppy's habits. */
interface SuiteVoice {
  stepNoun: { word: string; fem: boolean };
  howTo: [string, string][];
  open: string[]; why: string[]; read: string[]; tools: string[];
  angle: string[]; calm: string[];
  gearTitle(n: number): string; gear: string[];
  faultTitle(n: number): string; fault: string;
  caseTitle(n: number): string; cases: string;
  plan: string; planRead: string[]; planEnd: string;
}

const VOICES: Record<GuideArchetype, SuiteVoice> = {
  habitude: {
    stepNoun: { word: 'geste', fem: false },
    howTo: [['Lisez-le en une fois', 'Ce guide ne traite qu’un seul moment.'], ['Observez avant d’agir', 'Le plan s’appuie sur vos notes.'], ['Cochez au fil du plan', 'Une ligne à la fois, sans rattraper celles qui sautent.']],
    open: ['Le reste de la journée peut s’améliorer, un moment continue de tout dérégler', 'Le plus gros peut être réglé, il reste ce moment où tout repart de travers', 'On peut avoir apaisé la journée et rester coincé sur ce point précis', 'Les bonnes habitudes tiennent jusqu’au moment où celle-ci reprend le dessus'],
    why: ['Ce moment a sa propre mécanique : ce qui marche ailleurs ne s’y applique pas tel quel.', 'Ici, le déclencheur n’est pas le même, et les gestes habituels ne suffisent pas.', 'Ce comportement suit son propre rythme, et c’est ce rythme qu’il faut déplacer.', 'Cette habitude se nourrit d’un contexte précis : c’est ce contexte qu’il faut changer.'],
    read: ['Lisez-le en une fois, puis commencez par observer : le plan s’appuie sur vos notes, pas sur une règle générale.', 'Lisez-le en une fois, puis suivez le plan dans l’ordre, sans sauter de palier.', 'Prenez-le le soir, avant de changer quoi que ce soit : les premières nuits servent à comprendre.', 'Commencez par noter vos soirées : c’est cette page qui dira par quoi commencer.'],
    tools: ['des gestes à installer dans l’ordre, un plan à cocher et une fiche à imprimer', 'un escalier d’exercices, un plan à cocher et un tableau à imprimer', 'une routine du soir, un plan nuit après nuit et un journal à imprimer', 'un rituel du soir, un plan à cocher et un journal à imprimer'],
    angle: ['Avant de changer quoi que ce soit, il faut voir ce qui déclenche ce moment.', 'Avant de partir plus longtemps, il faut voir ce qui se passe quand la porte se ferme.', 'Avant de fermer une porte, il faut comprendre ce qui réveille la maison.', 'Avant de vous interdire quoi que ce soit, il faut voir ce qui déclenche l’envie.'],
    calm: ['Rien de ce qui fonctionne déjà n’a besoin de bouger : on ajoute seulement quelques gestes, au bon moment.', 'Cela s’apprend comme le reste, par toutes petites étapes, sans brusquer personne.', 'Ce rythme se déplace en quelques nuits, à condition de ne plus y répondre.', 'Il ne s’agit pas de se priver : il s’agit de changer ce qui se passe autour de ce moment.'],
    gearTitle: (n) => `Les ${n} gestes à mettre en place`,
    gear: ['Ces gestes visent uniquement ce moment. Ils s’installent l’un après l’autre, pas tous le même jour.', 'Chaque geste s’ajoute au précédent, et on ne passe au suivant que si tout reste calme.', 'Ces gestes se regroupent le soir : c’est là que se prépare la nuit.', 'Ces gestes changent le décor de la soirée, un par un, sans toucher au reste de la journée.'],
    faultTitle: (n) => `Les ${n} faux pas propres à ce moment`,
    fault: 'Ces faux pas partent d’un bon réflexe : ils calment sur l’instant et entretiennent le problème ensuite.',
    caseTitle: (n) => `Les ${n} cas qui résistent`,
    cases: 'Certains jours, le geste de base ne suffit pas.',
    plan: 'Le plan installe ces gestes dans l’ordre, sans toucher au reste de votre organisation.',
    planRead: ['Une ligne à la fois, cochée le soir. Si une ligne saute, reprenez simplement à la suivante.', 'Allongez seulement quand tout est resté calme, et redescendez d’un cran au moindre signe de stress.', 'Une réponse donnée à 3 h relance tout : tenez les lignes du plan, même les nuits difficiles.', 'Une ligne par soir, notée avant de vous coucher. Une soirée ratée ne compte pas double.'],
    planEnd: 'À la fin du plan, gardez ce qui a fait bouger les choses et laissez le reste.',
  },
  projet: {
    stepNoun: { word: 'étape', fem: true },
    howTo: [['Lisez avant de commencer', 'Vous saurez quoi acheter, et dans quel ordre agir.'], ['Reprenez étape par étape', 'Le projet sous les yeux, une étape terminée à la fois.'], ['Cochez la checklist', 'Elle évite de sauter ce qui ne se rattrape pas.']],
    open: ['Avant la belle finition, il y a souvent un obstacle qu’on préfère ne pas regarder', 'Certains projets semblent impossibles dès le départ, à cause d’un seul point'],
    why: ['Ce point se traite avant le reste : ce qui n’est pas réglé ici se verra à la fin.', 'Cette contrainte change les choix de départ : ce qui marche ailleurs échoue ici.'],
    read: ['Lisez-le une fois avant de sortir les outils, puis reprenez-le chapitre par chapitre, le projet sous les yeux.', 'Lisez-le avant d’acheter quoi que ce soit : les choix du premier chapitre décident de toute la saison.'],
    tools: ['les étapes dans l’ordre, les problèmes les plus courants et une fiche à imprimer', 'un calendrier de semis, les problèmes les plus courants et une carte à remplir'],
    angle: ['Ce chapitre montre ce que cette contrainte impose, avant le premier geste.', 'Ce chapitre montre ce que ce balcon permet vraiment, avant le premier semis.'],
    calm: ['Une fois ce point compris, le reste du projet redevient un enchaînement d’étapes simples.', 'Un balcon sans soleil direct a ses propres atouts : il suffit de choisir ce qui s’y plaît.'],
    gearTitle: (n) => `Les ${n} étapes, une par une`,
    gear: ['Chaque étape se termine avant de passer à la suivante : l’ordre n’est pas une préférence.', 'Le calendrier impose son ordre : chaque étape a sa période.'],
    faultTitle: (n) => `Les ${n} erreurs à éviter sur ce point`,
    fault: 'Ces erreurs viennent presque toujours de l’envie d’aller trop vite.',
    caseTitle: (n) => `Les ${n} problèmes et leur solution`,
    cases: 'Un défaut se rattrape presque toujours, à condition de le traiter dans le bon ordre.',
    plan: 'Voici comment répartir le travail, à votre rythme et sans rien sauter.',
    planRead: ['Chaque ligne a besoin que la précédente soit terminée : une étape sautée se paie à la fin.', 'Suivez les mois dans l’ordre : ce qui n’a pas été semé à temps se rattrape rarement.'],
    planEnd: 'Une fois le plan terminé, notez ce que vous avez fait et ce que vous avez utilisé : ce sera votre repère la prochaine fois.',
  },
  demarche: {
    stepNoun: { word: 'étape', fem: true },
    howTo: [['Gardez votre agenda ouvert', 'Notez chaque date au moment où vous la lisez.'], ['Vérifiez sur les sites officiels', 'Une date ou un seuil peut changer d’une année à l’autre.'], ['Cochez au fil de l’année', 'Chaque ligne a son moment : inutile de tout faire d’un coup.']],
    open: ['Une fois les déclarations en place, ce sont d’autres échéances qui arrivent sans prévenir'],
    why: ['Ces sujets dépendent d’un autre calendrier et d’autres organismes que vos déclarations habituelles.'],
    read: ['Gardez votre agenda ouvert à côté, et notez chaque date au moment où vous la lisez.'],
    tools: ['un calendrier de l’année, les cas qui posent problème et un tableau à imprimer'],
    angle: ['Ce chapitre pose ce qui distingue ce sujet du reste de vos démarches.'],
    calm: ['Rien de tout cela n’exige de comptable : il faut surtout savoir quelle date regarder, et où.'],
    gearTitle: (n) => `Les ${n} rendez-vous de l’année`,
    gear: ['Ces étapes se répartissent sur l’année : chacune a son moment, et aucune ne demande plus d’une séance.'],
    faultTitle: (n) => `Les ${n} oublis qui coûtent cher`,
    fault: 'Ces erreurs coûtent cher parce qu’on les découvre à l’échéance, quand il est trop tard pour les corriger.',
    caseTitle: (n) => `Les ${n} cas particuliers à connaître`,
    cases: 'La règle générale ne couvre pas tout : voici ce qu’on fait quand une date est passée ou qu’un doute reste.',
    plan: 'Ce calendrier se lit dans l’ordre de l’année : chaque ligne tombe à une période précise.',
    planRead: ['Notez chaque ligne dans votre agenda dès aujourd’hui, avec un rappel une semaine avant.'],
    planEnd: 'Chaque année, vérifiez sur les sites officiels ce qui a changé : une date ou un seuil peut bouger, la logique reste.',
  },
  examen: {
    stepNoun: { word: 'étape', fem: true },
    howTo: [['Mesurez d’abord', 'Repérez ce qui vous fait perdre des points.'], ['Entraînez-vous en conditions', 'À voix haute et chronométré, jamais en simple relecture.'], ['Cochez au fil du plan', 'Une séance tenue vaut mieux qu’un rattrapage.']],
    open: ['Le score global peut progresser, une partie de l’épreuve continue de tout faire perdre', 'Un candidat bien préparé peut encore perdre ses moyens sur ce point', 'Même quand les révisions avancent, une partie de l’épreuve fait encore peur'],
    why: ['Cette partie demande un entraînement à part : l’enchaînement et la fatigue y comptent autant que le niveau.', 'Cet exercice ne se prépare pas en apprenant : il se prépare en répondant à voix haute.', 'Cette épreuve ne se révise pas comme les autres : elle se répète.'],
    read: ['Commencez par mesurer ce qui vous fait perdre des points, puis suivez le plan jour après jour.', 'Gardez ce guide à côté de vos cartes : chaque chapitre se travaille à voix haute.', 'Prenez-le avec un chronomètre et une personne pour vous écouter : cette préparation se fait debout, pas à un bureau.'],
    tools: ['une méthode d’entraînement, les pièges à connaître et une grille à imprimer', 'une méthode en quatre temps, des cartes d’entraînement et une grille à imprimer', 'un plan d’oral, des répétitions minutées et une grille à imprimer'],
    angle: ['Ce chapitre montre ce qui est vraiment évalué ici, et ce qui ne l’est pas.', 'Ce chapitre montre ce que le jury observe vraiment dans ces moments-là.', 'Ce chapitre montre comment l’épreuve se déroule, et ce qui est noté.'],
    calm: ['Vous n’avez pas besoin d’en savoir plus : vous avez besoin de vous entraîner autrement.', 'Personne n’attend de vous une réponse de soignant diplômé : on attend une façon de raisonner.', 'Le jury n’attend pas un texte parfait : il attend une réflexion que vous savez défendre.'],
    gearTitle: (n) => `Les ${n} étapes de l’entraînement`,
    gear: ['Chaque étape se travaille dans les conditions de l’épreuve, jamais en simple relecture.', 'Chaque étape se travaille à voix haute, chronomètre en main.', 'Chaque étape se répète debout, devant quelqu’un, jamais en silence.'],
    faultTitle: (n) => `Les ${n} pièges de cette partie`,
    fault: 'Ces pièges coûtent cher à des candidats qui connaissent pourtant leur sujet.',
    caseTitle: (n) => `Les ${n} moments de flottement, et quoi faire`,
    cases: 'Même avec un bon entraînement, il y aura un moment de flottement : voici comment le traverser.',
    plan: 'Ce plan va du plus simple à la mise en conditions réelles.',
    planRead: ['Si une séance saute, gardez avant tout la suivante : un entraînement régulier vaut mieux qu’un rattrapage.', 'Une carte par jour vaut mieux que dix la veille : gardez le rythme, même court.', 'Une répétition courte chaque jour vaut mieux qu’une longue le week-end.'],
    planEnd: 'Les derniers jours, n’ajoutez rien de nouveau : répétez ce qui est déjà solide.',
  },
  evenement: {
    stepNoun: { word: 'décision', fem: true },
    howTo: [['Lisez avant d’engager de l’argent', 'L’ordre des décisions fait le prix.'], ['Gardez le tableau à jour', 'Chaque montant y entre dès qu’il est connu.'], ['Cochez au fil du plan', 'Une décision prise libère la suivante.']],
    open: ['Le budget global peut être posé, c’est ensuite que les montants dérapent', 'Le budget peut être juste sur le papier et filer dès le premier jour'],
    why: ['Tout se joue dans un moment précis, face à une personne ou à un prix : il faut savoir quoi dire et quoi regarder.', 'Tout se joue dans de petites décisions quotidiennes, prises sur place et sans recul.'],
    read: ['Lisez-le à deux avant de répondre au moindre devis : c’est l’ordre des demandes qui fait le prix.', 'Lisez-le avant de partir, et gardez le plan sur votre téléphone : c’est là-bas qu’il vous servira.'],
    tools: ['une méthode en étapes, les pièges à éviter et un tableau à imprimer', 'un plafond quotidien, les bons réflexes sur place et un carnet à imprimer'],
    angle: ['Ce chapitre montre où se cachent les vrais écarts de prix.', 'Ce chapitre montre où part l’argent une fois sur place, jour après jour.'],
    calm: ['Il ne s’agit pas de renoncer à ce qui compte : il s’agit de savoir où part l’argent.', 'On peut très bien manger et se déplacer sans se ruiner, à condition de connaître les bons réflexes.'],
    gearTitle: (n) => `Les ${n} décisions à prendre dans l’ordre`,
    gear: ['Ces décisions se prennent dans l’ordre : chacune prépare la suivante.', 'Ces décisions se prennent avant d’arriver, puis chaque matin sur place.'],
    faultTitle: (n) => `Les ${n} erreurs qui font déraper la note`,
    fault: 'Aucune de ces erreurs ne paraît grave sur le moment : c’est le total qui le montre.',
    caseTitle: (n) => `Les ${n} imprévus et comment réagir`,
    cases: 'Tout ne se passera pas comme prévu : voici comment réagir sans sortir du budget.',
    plan: 'Le plan répartit ces décisions dans le temps, pour qu’aucune ne soit prise dans l’urgence.',
    planRead: ['Bloquez chaque ligne dans votre agenda : une décision sans date finit prise à la dernière minute.', 'Une ligne par étape du voyage : relisez-la le matin, avant de sortir.'],
    planEnd: 'À la fin, comparez le prévu et le réel : cet écart vous dira quoi ajuster.',
  },
  systeme: {
    stepNoun: { word: 'étape', fem: true },
    howTo: [['Lisez-le une fois', 'Vous verrez la règle à poser, et pourquoi.'], ['Appliquez une nouveauté à la fois', 'À côté de ce qui tourne déjà.'], ['Cochez, puis ajustez', 'La fin du plan dit ce qu’il faut garder.']],
    open: ['Le système tourne, jusqu’au moment où ce point vient tout bloquer', 'Tout se passe bien jusqu’au jour où ce problème arrive', 'La méthode peut être en place, ce point continue de vous coûter'],
    why: ['Ce point revient chaque semaine : tant qu’il n’a pas sa règle, il se rejoue à chaque repas.', 'Ce problème arrive rarement, mais il coûte cher quand il arrive : mieux vaut avoir sa réponse prête.', 'Ce point se décide une fois, au calme, avant la prochaine conversation.'],
    read: ['Lisez-le une fois, puis appliquez une seule nouveauté par semaine.', 'Lisez-le avant votre prochaine vente : une annonce se protège avant le litige, pas après.', 'Lisez-le avec une calculatrice : vos chiffres à vous valent mieux qu’une moyenne.'],
    tools: ['une routine en étapes, les blocages les plus fréquents et un tableau à imprimer', 'une procédure en étapes, des réponses prêtes et un tableau à imprimer', 'un calcul en étapes, des réponses aux objections et une feuille à imprimer'],
    angle: ['Ce chapitre montre pourquoi ce point se répète, et ce qui l’entretient.', 'Ce chapitre montre comment naît un litige, et ce qui décide de son issue.', 'Ce chapitre montre d’où vient un prix, et pourquoi il se défend.'],
    calm: ['Il ne s’agit pas de tout revoir : une règle claire suffit souvent à sortir de ce cercle.', 'Une annonce précise et une réponse calme règlent déjà l’essentiel.', 'Un prix calculé se défend bien plus facilement qu’un prix deviné.'],
    gearTitle: (n) => `Les ${n} étapes de votre nouvelle routine`,
    gear: ['Une fois posées, ces étapes se répètent sans y repenser : c’est ce qui fait gagner du temps.', 'Ces étapes se mettent en place avant le problème, pas pendant.', 'Ces étapes se font une fois, au calme, puis servent à chaque nouveau client.'],
    faultTitle: (n) => `Les ${n} erreurs qui reviennent`,
    fault: 'Ces erreurs sont discrètes : elles ne se voient qu’à la fin, dans le résultat.',
    caseTitle: (n) => `Les ${n} blocages et leur solution`,
    cases: 'Même avec une bonne règle, certains cas coincent : voici comment les débloquer sans tout arrêter.',
    plan: 'Le plan installe cette règle progressivement, à côté de ce qui tourne déjà.',
    planRead: ['Tenez les lignes dans l’ordre : si l’une saute, reportez-la sans rien ajouter.', 'Appliquez ces lignes dès votre prochaine annonce, sans attendre le premier litige.', 'Faites ces lignes dans l’ordre : le calcul vient avant la discussion.'],
    planEnd: 'À la fin, regardez ce qui a vraiment changé et gardez uniquement cela.',
  },
  paliers: {
    stepNoun: { word: 'étape', fem: true },
    howTo: [['Lisez à deux', 'Chaque adulte concerné doit avoir les mêmes repères.'], ['Parlez-en au professionnel', 'Avant le premier essai, surtout en cas d’antécédents.'], ['Un essai à la fois', 'Notez-le, puis attendez avant le suivant.']],
    open: ['Les premiers repas se passent bien, et une nouvelle inquiétude prend toute la place'],
    why: ['Cette étape se prépare à part, avec des repères de sécurité qui lui sont propres.'],
    read: ['Lisez-le à deux, et parlez-en au professionnel qui suit votre enfant avant le premier essai.'],
    tools: ['des repères de sécurité, des étapes claires et un tableau à imprimer'],
    angle: ['Ce chapitre pose ce qu’il faut savoir avant le premier essai, et ce qu’il faut surveiller ensuite.'],
    calm: ['Une inquiétude devient plus légère quand elle a une liste de repères et un numéro à appeler.'],
    gearTitle: (n) => `Les ${n} étapes de l’introduction`,
    gear: ['On avance un pas après l’autre, et seulement quand le précédent s’est bien passé.'],
    faultTitle: (n) => `Les ${n} erreurs à éviter`,
    fault: 'Ces erreurs viennent de l’inquiétude ou de conseils dépassés, et toutes se corrigent.',
    caseTitle: (n) => `Les ${n} situations qui inquiètent`,
    cases: 'Voici comment réagir quand quelque chose vous inquiète, sans dramatiser ni minimiser.',
    plan: 'Ce calendrier est indicatif : c’est votre enfant et le professionnel qui le suit qui donnent le rythme.',
    planRead: ['Un essai à la fois, noté dans le tableau. En cas de doute, attendez avant le suivant.'],
    planEnd: 'Une fois un aliment accepté, gardez-le au menu : la suite se joue dans la répétition.',
  },
};

/**
 * A follow-up guide treats one sub-problem: its own chapters, never the parent's sections, in the words of its
 * family of guides. Its padding comes from that family too: the generic bank is about changing a habit.
 */
function suiteOf(base: ArchetypeDef, s: SuiteVoice): ArchetypeDef {
  return {
    id: 'suite',
    stepNoun: s.stepNoun,
    plan: 'phases',
    planColumn: 'Quand',
    short: { 5: ['angle', 'reglages', 'ecueils', 'resistances', 'mini-plan'], 6: ['angle', 'reglages', 'ecueils', 'resistances', 'mini-plan'] },
    howTo: s.howTo,
    promise: (c, o) => `un plan ciblé de ${D(c)} pour arriver à ceci : ${o}`,
    subtitle: (c) => `Le guide ciblé pour ${c.audArt} qui veulent régler ce point précis`,
    titles: (c) => [c.topic?.title ?? ''],
    introOpen: (c, a) => `${v(c, ...s.open)} : ${a.pain}.${a.p1 ? ` Vous l’avez peut-être dit ainsi : ${a.p1}${a.p2 ? `, ou encore ${a.p2}` : ''}.` : ''}`,
    introWhy: (c, a) => `${v(c, ...s.why)}${a.pains.length ? ` On peut régler ${a.pains[0]} et rester bloqué ici pendant des mois.` : ''}`,
    introUse: (c, a) => `Il a été écrit pour ${c.audArt}, et il part de zéro sur ce sujet. À la fin, vous aurez ${lf(a.promise)}. Au programme : ${a.chapters} chapitres ciblés, ${v(c, ...s.tools)}.`,
    introRead: (c) => `Comment l’utiliser ? ${v(c, ...s.read)}`,
    whyFallback: base.whyFallback,
    situationsFallback: base.situationsFallback,
    fillers: base.fillers.filter((f) => !genericFillers.includes(f)),
    chapters: [
      {
        kind: 'angle', role: 'comprendre',
        title: (c) => `Pourquoi ce sujet résiste : ${lf(c.pbShort ?? c.pbClause)}`,
        intro: (c) => `${v(c, ...s.angle)} Point de départ pour ${c.audCore} : ${pb(c)}.`,
        paras: [(d) => d.facts(2) || null, (d) => d.facts(2) || null, (d) => d.facts(2) || null, (d) => v(d.c, ...s.calm)],
        steps: () => ['Noter à quel moment ce sujet vous pose le plus de difficultés', 'Entourer dans ce chapitre ce qui vous surprend', 'Décider du jour où vous commencez'],
        checks: () => ['Je comprends pourquoi ce sujet résiste', 'Je sais à quel moment il se pose', 'Ma date de départ est fixée'],
      },
      {
        kind: 'reglages', role: 'methode',
        title: (_c, n) => s.gearTitle(n),
        intro: (c) => `${v(c, ...s.gear)} Tout est écrit pour ${c.audCore}.`,
        paras: [modelPara],
      },
      {
        kind: 'ecueils', role: 'erreurs',
        title: (_c, n) => s.faultTitle(n),
        intro: (c) => `${s.fault} Voici ce que ${c.audCore} rencontrent le plus.`,
        paras: [],
        steps: () => ['Repérer ce qui vous concerne dans cette liste', 'Appliquer la correction dès aujourd’hui', 'Noter la date du changement'],
      },
      {
        kind: 'resistances', role: 'situations',
        title: (_c, n) => s.caseTitle(n),
        intro: (c) => `${s.cases} Ces réponses sont pensées pour ${c.audCore}.`,
        paras: [],
        steps: () => ['Repérer le cas qui vous concerne', 'Appliquer la réponse de ce chapitre', 'Reprendre le plan à la ligne suivante'],
      },
      {
        kind: 'mini-plan', role: 'programme',
        title: (c) => `Votre plan ciblé de ${D(c)}, étape par étape`,
        intro: (c) => `${s.plan} Objectif, sur ${D(c)} : ${lf(c.goal ?? c.pbClause)}.`,
        paras: [(d) => v(d.c, ...s.planRead), modelPara, keepUp, () => s.planEnd],
        checks: () => ['Plan noté dans l’agenda', 'Fiche imprimée', 'Bilan de fin de plan prévu'],
      },
    ],
  };
}

export const ARCHETYPES: Record<GuideArchetype, ArchetypeDef> = {
  habitude: HABITUDE, projet: PROJET, demarche: DEMARCHE, examen: EXAMEN, evenement: EVENEMENT, systeme: SYSTEME, paliers: PALIERS,
};

/** The follow-up guides of each family. */
export const SUITES = Object.fromEntries((Object.keys(ARCHETYPES) as GuideArchetype[]).map((a) => [a, suiteOf(ARCHETYPES[a], VOICES[a])])) as Record<GuideArchetype, ArchetypeDef>;

/** Chapter defs for a chapter count; an empty result never happens (the 5-chapter list is the minimum). */
export function chaptersFor(def: ArchetypeDef, count: number): ChapterDef[] {
  if (def.id === 'suite') return def.chapters;
  if (count >= 7) return def.chapters;
  const kinds = count === 6 ? def.short[6] : def.short[5];
  return kinds.map((k) => def.chapters.find((c) => c.kind === k)!).filter(Boolean);
}

/** Reads a step without its final dot as a bullet item. */
export const asStep = (s: string): string => sentence(bare(s));
