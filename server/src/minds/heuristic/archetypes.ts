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
  howTo(c: NicheCtx): [string, string][];
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

const duringObs = (c: NicheCtx): string => (obsLabel(c) === 'une semaine' ? 'Pendant cette semaine' : `Pendant ces ${obsLabel(c)}`);

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
const modelPara: Para = (d) => { const m = d.model(); return m ? sentence(`Modèle à copier : ${low(m)}`) : null; };

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
  howTo: () => [['Lisez un chapitre à la fois', 'Chaque chapitre règle une partie précise du problème, et l’observation vient avant le plan.'], ['Appliquez le jour même', 'Les gestes sont pensés pour être testés tout de suite.'], ['Cochez la checklist', 'Passez à la suite quand tout est coché.']],
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
        (d) => { const f = d.facts(2); return f ? f : 'Le problème n’est pas toujours là où on le cherche. Ce qui entretient la difficulté, ce sont rarement de grandes erreurs : ce sont de petits gestes répétés, faits de bonne foi, qui finissent par devenir la règle.'; },
        loopPara,
        (d) => { const p = orJoin(d.painQ(), d.painQ()); return p ? `${v(d.c, `C’est le même enchaînement qu’on retrouve derrière ${p}. Les symptômes changent, la boucle reste.`, `Le même enchaînement se cache derrière ${p}, même si cela n’y ressemble pas au premier regard.`, `On le retrouve aussi derrière ${p} : deux formes différentes, un seul fonctionnement.`, `Derrière ${p}, c’est encore ce fonctionnement qui joue.`)}` : 'Les symptômes changent d’une semaine à l’autre, la boucle reste la même.'; },
        (d) => nextFact('Autre repère utile.')(d) ?? 'Retenez une idée simple : un écart n’annule pas les progrès. Ce qui compte, c’est la direction sur plusieurs jours.',
      ],
      steps: () => ['Repérer dans votre semaine le moment où la boucle démarre', 'Entourer le mécanisme de ce chapitre qui vous ressemble le plus', 'Écrire en une phrase le geste que vous voulez arrêter'],
      checks: () => ['J’ai repéré le moment où tout démarre', 'Je sais quel maillon je veux casser'],
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
        (d) => `${duringObs(d.c)}, ne changez rien. ${v(d.c, 'C’est frustrant, mais c’est ce qui rend vos notes fiables : si vous modifiez tout en même temps, vous ne saurez jamais ce qui a vraiment fonctionné.', 'L’envie d’agir sera forte : tenez bon, car une observation modifiée en route ne vous apprend plus rien.', 'Ce n’est pas du temps perdu : c’est la photo de départ à laquelle vous comparerez tout le reste.', 'Vous comparerez tout le reste à cette photo de départ : mieux vaut qu’elle soit fidèle.')}`,
      ],
      steps: (c) => [c.diag?.text ?? 'Remplir la grille de ce chapitre sans rien changer', 'Surligner ce qui revient au moins deux fois', 'Choisir un seul moment à travailler en priorité'],
      checks: () => ['Ma grille est prête', 'J’ai tout noté sans rien changer', 'J’ai choisi une seule priorité'],
    },
    {
      kind: 'gestes', role: 'methode',
      title: (_c, n) => `Les ${n} gestes à installer`,
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
  howTo: () => [['Lisez tout avant d’acheter', 'Vous saurez ce qui vous attend, et ce qu’il est inutile de payer.'], ['Reprenez chapitre par chapitre', 'Le matériel à portée de main, une étape après l’autre.'], ['Cochez la checklist', 'Elle évite d’oublier une préparation qui ne se rattrape pas.']],
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
    { when: 'un outil vous manque au milieu du projet', what: 'Mettez le projet en pause plutôt que d’improviser avec ce que vous avez sous la main.' },
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
      checks: () => ['Je sais à quoi j’ai affaire', 'Je connais le point qui ne se rattrape pas'],
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
  howTo: () => [['Gardez votre espace ouvert', 'Faites chaque étape au moment où vous la lisez.'], ['Gardez chaque preuve', 'Une attestation, un seul dossier, nommé avec la date.'], ['Cochez la checklist', 'Vous voyez d’un coup d’œil ce qui reste à faire.']],
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
  howTo: () => [['Commencez par l’épreuve', 'Sachez ce qui est évalué avant de réviser quoi que ce soit.'], ['Mesurez votre point de départ', 'Le plan se règle sur ce que vous aurez mesuré.'], ['Cochez la checklist', 'Elle montre ce qui est solide et ce qu’il reste à travailler.']],
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
  howTo: (c) => [['Lisez avant de réserver', 'C’est l’ordre des décisions qui fait le budget.'], ['Remplissez le budget', v(c, 'Avant de contacter qui que ce soit.', 'Avant de réserver quoi que ce soit.')], ['Cochez la checklist', 'Chaque décision prise libère la suivante.']],
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
      title: (c) => v(c, 'Fixer le cadre avant de contacter qui que ce soit', 'Fixer le cadre avant de réserver quoi que ce soit'),
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
      steps: (c) => ['Relire cette liste avant chaque signature ou réservation', v(c, 'Vérifier le devis ou les conditions ligne par ligne', 'Vérifier les conditions de chaque réservation ligne par ligne'), 'Demander ce qui manque par écrit'],
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
  howTo: () => [['Lisez le cycle en entier', 'Vous verrez comment les étapes s’enchaînent.'], ['Lancez un premier tour', 'Sans chercher à tout réussir du premier coup.'], ['Cochez, puis ajustez', 'C’est le deuxième tour qui montre quoi changer.']],
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
  howTo: () => [['Lisez à deux', 'Chaque adulte qui donne à manger doit avoir les mêmes repères.'], ['Un palier à la fois', 'Passez au suivant quand celui-ci est devenu facile.'], ['Cochez la checklist', 'Elle dit ce qui est en place avant le prochain repas.']],
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
 * What a follow-up says beyond its research items, authored per sub-problem (pdf §10.1). The items alone stop near 1,800 words,
 * and a floor is never met by repeating text. A guide on a free pain has none: it stays 5 chapters.
 */
interface TopicDepth {
  start: { title: string; intro: string; look: string[] };
  examples?: string[];  // worked cases, used once the research has none left
  spare: string[];      // reserve: printed only when the research sampled for this guide leaves it under the floor
  rail: string[];       // notes of the rail, one per chapter: the floor spends the research and the reserve, and a note says what the page does not
  angle: string[]; gear: string[]; fault?: string[]; cases: string[]; plan: string[];
}

const TOPIC_DEPTH: Record<string, TopicDepth> = {
  siestes: {
    rail: [
      'Un bébé change vite à cet âge : ce qui marchait il y a un mois peut simplement ne plus lui aller.',
      'Notez aussi son humeur au réveil : elle en dit parfois plus que la durée de la sieste.',
      'Une pièce assombrie aide souvent, sans chercher le noir complet : gardez ce qui se refait facilement ailleurs.',
      'Si vous êtes deux, mettez-vous d’accord sur le mini-rituel : bébé repère vite les différences.',
      'Un mauvais jour n’annule pas les précédents : notez-le, et reprenez le lendemain à l’heure habituelle.',
      'Gardez pour vous une sieste sur deux : un parent reposé tient mieux le plan.',
    ],
    spare: [],
    start: {
      title: 'Où en sont vos siestes aujourd’hui',
      intro: 'Une sieste courte ne se corrige pas à l’aveugle : il faut d’abord voir à quelle heure elle arrive et ce qui la précède.',
      look: [
        'Commencez par relever trois journées ordinaires, sans rien modifier : l’heure du lever, le début et la fin de chaque sieste, l’endroit où elle a eu lieu. Trois jours suffisent à montrer si les siestes courtes tombent toujours au même moment, ou seulement après une matinée agitée. Une sieste du matin qui tient et une sieste d’après-midi qui casse ne demandent pas la même réponse qu’une journée où tout s’écourte.',
        'Regardez ensuite ce qui se passe juste avant. Un bébé couché en plein jeu ne s’endort pas comme un bébé qui a eu cinq minutes calmes. Notez aussi ce qui se passe au réveil : un bébé qui se réveille gai après 35 minutes n’a pas le même besoin qu’un bébé qui pleure et se frotte les yeux. Le premier a peut-être assez dormi pour cette fois, le second n’a pas enchaîné.',
      ],
    },
    examples: [
      'Camille relève trois journées de sa fille Lou, 9 mois : la sieste du matin dure 1 h 10, celle de 15 h ne dépasse jamais 30 minutes. Elle ne touche pas au matin et avance seulement la seconde sieste de 20 minutes.',
    ],
    angle: ['Le réveil au bout de 30 ou 40 minutes n’a rien d’un caprice. Bébé remonte à la surface entre deux cycles, regarde si tout est comme au moment où il s’est endormi, et il repart ou non selon ce qu’il trouve. Ce passage se travaille la journée de la même façon que la nuit : un endormissement au calme, un décor qui ne change pas, et un adulte qui laisse à bébé le temps d’essayer.'],
    gear: [
      'Tenez ces gestes dans l’ordre où ils sont écrits. Les horaires repères viennent d’abord, parce qu’un bébé trop fatigué ou pas assez fatigué n’enchaîne pas ses cycles, quoi qu’on fasse ensuite. Le mini-rituel vient après, et l’attente de 10 minutes seulement quand le reste tient. Si vous démarrez tout le même jour, vous ne saurez pas ce qui a aidé.',
      'Parlez de ce plan à tous ceux qui s’occupent de bébé, mamie comprise. Il n’est pas nécessaire que chacun fasse exactement pareil : il suffit que l’heure repère et le mini-rituel restent reconnaissables. Un bébé s’adapte très bien à deux lieux différents tant que les grandes lignes de sa journée ne changent pas.',
    ],
    fault: [
      'Le point commun de ces erreurs est de réagir à la sieste d’aujourd’hui au lieu de regarder la semaine. Une sieste ratée ne dit presque rien, trois journées lues ensemble disent beaucoup. Avant de changer un horaire, relisez la feuille et demandez-vous si le problème revient vraiment.',
      'Observez aussi votre propre fatigue. Quand bébé dort, la tentation est de tout rattraper. Gardez au moins une sieste par jour pour souffler, même dix minutes : un parent reposé attend plus facilement la fin d’un réveil et tient mieux le cadre de ces deux semaines.',
    ],
    cases: [
      'Un rhume, une poussée dentaire ou une nouvelle acquisition peuvent raccourcir les siestes pendant quelques jours. Ne reprenez pas le plan à zéro : gardez les horaires repères, aidez bébé autant qu’il en a besoin, puis revenez à la ligne du plan où vous étiez dès que la journée redevient normale. Si bébé paraît souffrir, ou si quelque chose vous inquiète, parlez-en au professionnel qui le suit.',
      'Gardez aussi une place pour les journées ordinaires de la vie de famille. Une sieste en poussette pendant une course, une sieste écourtée par un rendez-vous, cela arrive chaque semaine. Le plan tient compte de ces journées : ce qui compte est le retour au rythme le lendemain, pas une semaine parfaite.',
    ],
    plan: [
      'À mi-parcours, comparez deux choses : le total de sommeil de la journée, et l’humeur de bébé en fin d’après-midi. La longueur de chaque sieste vient ensuite. Une journée qui devient prévisible est déjà un progrès, même si certaines siestes restent courtes.',
      'Quand les deux horaires repères tiennent depuis quelques jours, ne les changez plus pour gagner dix minutes. Bébé a besoin de retrouver le même enchaînement pour que le signal fasse son travail. Les ajustements viendront d’eux-mêmes, quand sa fenêtre d’éveil s’allongera : vous le verrez sur la feuille, avec des premiers signes de fatigue qui arrivent plus tard.',
    ],
  },
  allergenes: {
    rail: [
      'Votre inquiétude est légitime : ce qui la calme, c’est de savoir à l’avance quoi surveiller et qui appeler.',
      'Apportez votre tableau à chaque consultation : il dit en une minute ce qui a déjà été proposé.',
      'Un essai se prépare comme un rendez-vous : aliment prêt, adulte disponible, téléphone à portée de main.',
      'Le jour d’un essai, gardez le reste du repas habituel : un seul changement à la fois se lit mieux.',
      'Un doute après un essai ne se tranche pas seul : décrivez ce que vous avez vu au professionnel qui suit bébé.',
      'Une semaine chargée n’annule rien : reprenez l’essai suivant quand le calme revient.',
    ],
    spare: [
      'Choisissez la forme de l’aliment avec soin. Un allergène se propose adapté à l’âge : cuit quand il doit l’être, en poudre ou en purée lisse plutôt qu’en morceau, jamais entier quand il présente un risque d’étouffement. Le professionnel qui suit bébé peut vous dire quelle forme convient pour commencer, et vous évitez ainsi de mélanger deux inquiétudes le même jour.',
      'Pensez aussi aux journées qui suivent un essai réussi. Un aliment bien passé reste un aliment à reproposer : écrivez à côté de sa ligne la date du prochain repas où il reviendra. Cette petite organisation évite qu’il disparaisse du menu pendant des semaines parce qu’un autre sujet a pris toute la place.',
      'Parlez-en aussi entre adultes avant de commencer. Si l’un des deux est plus inquiet, il peut choisir de faire les essais avec l’autre, ou de préparer le carnet. Une répartition claire évite les tensions à table. Bébé sent très bien quand tout le monde retient son souffle : un repas ordinaire se passe mieux dans une ambiance ordinaire.',
      'Prévenez les personnes qui gardent bébé de ce qui a été introduit et de ce qui ne l’a pas encore été. Une simple note sur le frigo ou dans le sac de crèche suffit. Elle évite qu’un nouvel aliment soit proposé le jour où vous n’êtes pas là pour regarder comment il se passe.',
      'Lisez les étiquettes des produits du commerce pendant ces semaines. Les allergènes y figurent en évidence dans la liste des ingrédients, et certains se cachent là où on ne les attend pas : biscuits, sauces, plats préparés. Tant qu’un aliment n’a pas été introduit, gardez la main sur ce que bébé reçoit.',
      'Gardez une trace de tout ce qui s’est bien passé, pas seulement des doutes. Quand un autre enfant arrivera, ou qu’une nouvelle personne s’occupera de bébé, ce carnet répondra à bien des questions. Il rassure aussi le jour où un professionnel vous demande ce qui a déjà été proposé.',
    ],
    start: {
      title: 'Avant le premier essai : ce qu’il faut vérifier',
      intro: 'Un allergène se prépare avant le repas : on sait ce qu’on propose, à quel moment, et qui appeler si quelque chose vous inquiète.',
      look: [
        'Regardez d’abord le terrain de votre enfant. Eczéma important, allergie déjà connue, allergie chez un parent ou un frère : ces points se disent au professionnel qui suit bébé avant tout essai, car ils peuvent changer le calendrier. Sans aucun de ces signes, la liste reste la même, et c’est l’ordre qui se décide avec vous.',
        'Vérifiez ensuite ce que bébé mange déjà sans difficulté. Un allergène s’introduit plus facilement dans un aliment bien accepté : une texture connue, à un moment de la journée où il mange de bon appétit. Choisissez aussi votre créneau : un jour calme, en matinée ou à midi, avec un adulte disponible pendant les heures qui suivent. Bébé doit être en forme ce jour-là : pas d’essai s’il couve quelque chose.',
        'Préparez enfin ce qui rassure : le numéro à appeler affiché dans la cuisine, le carnet ouvert, et la liste écrite des signes à surveiller. En cas de gêne pour respirer, de gonflement ou de malaise, on appelle le 15 sans attendre. Le savoir avant le repas permet de garder une table calme.',
      ],
    },
    examples: [
      'Nadia et Paul notent sur le carnet : mardi, 11 h 30, œuf bien cuit écrasé dans la purée de Sami, 7 mois, une toute petite quantité. Rien à signaler l’après-midi, ils recommencent jeudi avec un peu plus.',
    ],
    angle: ['La peur vient souvent d’un mélange : on ne sait plus ce qui est normal et ce qui doit inquiéter. Une petite rougeur autour de la bouche après une tomate n’a pas le même sens qu’un gonflement du visage. Ce guide sépare ces situations, pour que chaque essai reste un repas ordinaire, préparé à l’avance, et non une épreuve pour toute la famille.'],
    gear: ['Écrivez votre ordre d’introduction sur une feuille et n’y touchez plus chaque matin. Moins il reste de décisions à prendre au moment du repas, plus vous êtes disponible pour regarder votre enfant. Un essai reporté parce que bébé est fatigué n’est pas un retard : la liste reprend simplement à la ligne suivante, un autre jour calme.'],
    cases: ['Quand un doute reste après un essai, notez l’heure, la quantité et ce que vous avez vu, prenez une photo si la peau a réagi, et gardez ces éléments pour le rendez-vous. N’essayez pas de refaire le test seul pour vérifier : c’est le professionnel qui dit quand et comment reprendre. Les autres essais attendent son avis.'],
    plan: ['Au fil des semaines, le carnet devient le vrai outil : chaque ligne dit ce qui est acquis et reste au menu. Relisez-le avant chaque rendez-vous, il répond à la plupart des questions qu’on vous posera. Un allergène toléré qui disparaît des repas pendant longtemps mérite de revenir régulièrement.'],
  },
  solitude: {
    rail: [
      'Un chiot qui vient d’arriver a toujours vécu entouré : être seul est une nouveauté pour lui, pas un caprice.',
      'Regardez la vidéo jusqu’au bout : le moment où il se calme compte autant que celui où il s’agite.',
      'Changez parfois l’ordre de vos gestes de départ : clés et manteau finissent par annoncer votre absence.',
      'Une absence ratée se corrige le lendemain, un cran plus court : pas besoin de recommencer tout le plan.',
      'Prévenez vos voisins pendant l’apprentissage : une phrase dans l’escalier évite bien des tensions.',
      'Une fois le plan terminé, variez vos heures de départ : le chiot apprend que vous revenez, quelle que soit l’heure.',
    ],
    spare: [
      'Pensez à ce que votre chiot entend quand vous n’êtes pas là. Une radio à faible volume, un rideau tiré sur le passage du couloir ou un parc éloigné de la porte d’entrée réduisent ce qui le met en alerte. Un chiot qui ne guette pas chaque bruit de l’immeuble se pose beaucoup plus vite.',
      'Faites participer toute la maison. Si un seul adulte s’entraîne et que l’autre reprend le chiot dans ses bras à la première plainte, le travail ne tient pas. Fixez ensemble les règles du retour, du coin calme et de la porte : quelques phrases écrites sur le frigo suffisent à ce que tout le monde applique la même chose.',
      'Acceptez aussi que les progrès ne soient pas réguliers. Une absence très bien vécue peut être suivie d’une mauvaise, sans raison apparente : un bruit, une dent qui pousse, une journée trop excitante. Reprenez simplement la durée de l’avant-veille et remontez ensuite.',
    ],
    start: {
      title: 'Ce qui se passe vraiment quand vous fermez la porte',
      intro: 'Vous voyez le résultat à votre retour, pas ce qui s’est passé pendant l’absence : c’est ce vide qu’il faut combler d’abord.',
      look: [
        'Filmez deux ou trois départs ordinaires avec un téléphone posé dans la pièce. Vous cherchez trois choses : combien de temps le chiot met à réagir, ce qu’il fait pendant les premières minutes, et s’il finit par se poser. Un chiot qui gémit une minute puis s’endort n’a pas le même besoin qu’un chiot qui fait les cent pas devant la porte jusqu’à votre retour.',
        'Notez aussi ce qui précède le départ. Les clés, les chaussures, le manteau : beaucoup de chiots ont compris ces signaux bien avant que vous ayez touché la poignée. S’il s’agite dès que vous prenez votre sac, le travail commence par là, avant même de parler de durée d’absence.',
        'Regardez enfin ce qu’il détruit et à quel endroit. Des dégâts près de la porte parlent d’une envie de vous rejoindre, des dégâts au milieu de la pièce parlent plutôt d’ennui ou d’énergie à dépenser. Une flaque peut venir d’une vessie encore petite plutôt que du stress : comptez le temps écoulé depuis la dernière sortie.',
      ],
    },
    examples: [
      'Léa filme Pixel, 4 mois, pendant trois départs : il pleure 2 minutes, s’allonge devant la porte, puis dort. Le problème est plus léger qu’elle ne le pensait, et elle commence par rendre le départ plus banal.',
      'Marc et Inès habitent au 3e, avec un voisin qui travaille de nuit. Ils préviennent celui-ci, placent le parc loin du mur mitoyen et gardent les premières absences en journée, quand un aboiement gêne le moins.',
    ],
    angle: ['Un chiot ne fait pas de dégâts par vengeance. Il vient de quitter sa portée, il n’a jamais été seul, et sa seule stratégie est d’appeler ou de s’occuper avec ce qui se trouve sous ses dents. Ce qui semble être une bêtise est le plus souvent une émotion mal gérée ou un trop-plein d’énergie. C’est pour cela que la punition n’apprend rien : au moment où vous rentrez, il ne relie plus votre colère à ce qu’il a fait une heure plus tôt.'],
    gear: [
      'Le plus important est le rythme. Une absence réussie est une absence dont il sort calme : c’est elle qui compte, pas sa durée. Mieux vaut cinq sorties de deux minutes bien vécues qu’une heure subie. Quand il se met à pleurer systématiquement avant votre retour, vous êtes allé trop loin : redescendez d’un cran pendant deux jours, puis reprenez plus lentement.',
      'Rendez aussi les départs et les retours ennuyeux. Pas de grands adieux, pas de fête à votre retour : vous entrez, vous posez vos affaires, et vous le saluez quand il s’est calmé. Le coin calme doit servir à d’autres moments que vos absences, sinon il devient le signal du départ. Donnez-lui son jouet à mâcher quand vous êtes là, pendant que vous lisez ou que vous cuisinez.',
    ],
    fault: ['Ces erreurs ont un point commun : elles partent de la culpabilité. On le garde contre soi parce qu’il pleure, on le gronde parce qu’on a eu peur pour le canapé, on ouvre parce que les voisins entendent. Le chiot apprend alors que son bruit fait revenir l’humain. Tenez plutôt la règle inverse : on ouvre pendant un moment de silence, même très court.'],
    cases: ['Quand une journée de travail ne peut pas se faire autrement, ne laissez pas tout le plan s’effondrer. Prévoyez une solution de repli pour ces jours-là : une pause à midi, un voisin, un proche, un promeneur. Une longue absence imposée ne détruit pas le travail, à condition de reprendre ensuite les absences courtes. Si le chiot se blesse, salive beaucoup ou ne mange plus quand vous êtes parti, parlez-en au vétérinaire.'],
    plan: ['Lisez le plan comme un escalier et non comme un calendrier. Une ligne se passe en une journée si tout reste calme, en trois si le chiot a besoin de temps. À la fin de chaque semaine, regardez la dernière vidéo : il doit se poser plus vite que la semaine précédente. C’est ce délai, plus que la durée totale, qui montre que l’apprentissage avance.'],
  },
  nuits: {
    rail: [
      'Un chat qui griffe une porte ne se venge pas : il a appris que ce geste produit quelque chose.',
      'Notez aussi les nuits calmes : elles montrent ce qui a changé la veille.',
      'Rangez la canne à pêche après la séance : un jouet laissé à disposition perd vite son intérêt.',
      'Mettez-vous d’accord avec toute la maison : il suffit d’une personne qui se lève pour relancer le cycle.',
      'Des bouchons d’oreilles peuvent aider les premières nuits, le temps que la hausse des sollicitations passe.',
      'Une rechute après un voyage ou un déménagement n’a rien d’anormal : reprenez la séance du soir sans rien changer d’autre.',
    ],
    spare: [
      'Pensez aussi au matin. Si le chat apprend que vous vous levez à 6 h pour remplir la gamelle, il attend ce moment avec impatience et commence à réclamer plus tôt. Décalez le premier repas quelques minutes après votre lever, le temps de boire un café. Il comprendra que votre réveil ne déclenche pas son repas, et les appels de l’aube perdront leur intérêt.',
      'Regardez enfin la chambre elle-même. Une porte fermée attire plus qu’une porte ouverte pour beaucoup de chats, qui veulent simplement vérifier ce qui se passe de l’autre côté. Si vous pouvez le laisser entrer sans gêne pour votre sommeil, essayez quelques nuits : certains chats cessent de griffer dès que la pièce n’est plus interdite.',
      'Fermez aussi ce qui peut entretenir le jeu. Une gamelle automatique réglée à heure fixe, posée loin de la chambre, retire votre personne du lien entre le réveil et le repas : le chat apprend que la nourriture arrive sans que vous vous leviez. Ce simple déplacement suffit parfois à calmer les réveils de l’aube.',
      'Occupez sa journée, même si vous travaillez. Un arbre à chat près d’une fenêtre, un carton à explorer, quelques friandises cachées avant de partir : un chat qui a vécu quelque chose le jour dort mieux la nuit. Changez ces petits décors de temps en temps pour garder son intérêt.',
      'Si vous avez plusieurs chats, regardez qui lance les réveils. L’un réclame et l’autre suit, ou l’un provoque l’autre pour jouer. Le jeu du soir se fait alors séparément, chacun avec son propre jouet, pour que le plus timide en profite aussi et que chacun soit bien fatigué au moment d’éteindre.',
    ],
    start: {
      title: 'Ce qui réveille vraiment la maison',
      intro: 'À 3 h du matin, tout se ressemble. Sur le papier, ces réveils ont souvent une heure et une cause.',
      look: [
        'Pendant trois nuits, notez l’heure de chaque réveil et ce que vous avez cru comprendre : le chat griffe la porte, réclame sa gamelle, court, ou appelle. Ajoutez l’heure du dernier repas et celle du dernier jeu. Ces deux chiffres expliquent souvent pourquoi il a tant d’énergie quand vous éteignez la lumière.',
        'Regardez ensuite comment se passe sa journée. Un chat seul de 8 h à 18 h a dormi pendant que vous travailliez : il se lève au moment où vous vous couchez. Comptez le temps de jeu réel, celui où il court et attrape quelque chose. Un jouet posé par terre ne compte pas. Si ce temps est proche de zéro, le plan commencera là.',
        'Vérifiez enfin ce qui a pu changer. Un déménagement, un nouveau voisin à quatre pattes sur le palier, un changement d’horaire de la gamelle peuvent suffire. Si le comportement est apparu d’un coup, ou si votre chat est âgé, boit plus, maigrit ou semble désorienté, un passage chez le vétérinaire vient avant tout le reste.',
      ],
    },
    examples: [
      'Julie note trois nuits : Moka griffe la porte à 3 h 10, 3 h 30 et 2 h 50. Son dernier repas tombe à 19 h et il dort toute la soirée sur le canapé. Elle déplace le repas à 22 h 30, juste après une partie de plumeau.',
    ],
    angle: ['Le chat ne vous provoque pas. Il répète ce qui a fonctionné : un jour il a griffé et quelqu’un s’est levé, a parlé ou a rempli la gamelle. Pour lui, cette réponse vaut une récompense, même quand elle vient avec une voix agacée. Tant que la porte finit par répondre une nuit sur quelques-unes, il continue, parce qu’il sait que ça peut marcher.'],
    gear: [
      'L’enchaînement du soir compte plus que la durée. Une dizaine de minutes de jeu qui imite la chasse, un repas juste après, et le chat va naturellement faire sa toilette puis dormir. Tenez cet ordre tous les soirs, à la même heure, y compris le week-end. Si vous ne devez garder qu’un seul réglage de ce guide les soirs chargés, gardez celui-là.',
      'La nuit doit aussi lui offrir quelque chose sans vous : une fenêtre avec un perchoir, un griffoir placé près de la porte qu’il griffe, quelques croquettes cachées dans un jouet distributeur. Le griffoir au bon endroit répond à deux choses à la fois : il protège la porte et donne une issue à son envie de griffer.',
    ],
    fault: ['Ces erreurs viennent toutes de la fatigue. À 5 h, on se lève parce que c’est la solution la plus rapide pour dormir encore un peu. Le prix se paie le lendemain : la scène est rejouée, souvent plus tôt. Si vous vivez à deux, décidez ensemble avant de vous coucher : aucun des deux ne répond, et personne ne cède pour l’autre.'],
    cases: ['Attendez-vous à une nuit ou deux plus bruyantes au début : quand une réponse disparaît, le chat insiste avant de renoncer. C’est le signe que la règle commence à compter, pas que le plan échoue. Si cette période vous fait craindre pour les voisins, prévenez-les, et placez un tapis épais ou une protection sur le bas de la porte pour étouffer le bruit.'],
    plan: ['Pour lire vos progrès, comparez l’heure du premier réveil d’une semaine à l’autre et le nombre de fois où le chat a insisté. Une nuit difficile au milieu d’une bonne série ne remet rien en cause : cherchez seulement si le jeu du soir a sauté ce jour-là. Une fois les nuits calmes, gardez le rituel du soir plusieurs semaines avant de l’assouplir.'],
  },
  situations: {
    rail: [
      'Une mise en situation n’a pas une seule bonne réponse : plusieurs conduites sont justes si elles protègent la personne.',
      'Repérez la situation qui vous met le plus mal à l’aise : c’est elle qu’il faut travailler en premier.',
      'Prenez deux secondes avant de répondre : un court silence se voit comme de la réflexion, pas comme un blanc.',
      'Évitez « il faut » et « on doit » : dites ce que vous faites, et pour qui.',
      'Si vous ne savez pas, dites-le et expliquez à qui vous transmettriez : c’est déjà une réponse de soignant.',
      'Répétez au moins une fois devant quelqu’un qui ne connaît pas le métier : s’il comprend, le jury comprendra.',
    ],
    spare: [
      'Observez les soignants que vous croisez, si vous en avez l’occasion : en stage, à l’hôpital, en maison de retraite ou chez un proche. La façon de frapper à une porte, de se présenter, d’expliquer un geste avant de le faire nourrit vos réponses bien mieux qu’un cours appris par cœur. Le jury sent tout de suite ce qui vient de l’observation réelle.',
      'Préparez aussi quelques exemples tirés de votre vie à vous. Une aide apportée à un parent âgé, un moment où vous avez dû rester calme, une erreur que vous avez reconnue : ces souvenirs donnent du poids à vos réponses. Une phrase vraie vaut mieux qu’une formule que tous les candidats ont lue au même endroit.',
      'Pensez enfin à votre posture pendant que vous écoutez. Le jury vous regarde aussi quand il parle : un regard posé, des mains calmes, une écoute jusqu’au bout de la question. Reformuler la situation en une phrase avant de répondre montre que vous avez entendu, et vous laisse quelques secondes pour organiser votre pensée.',
    ],
    start: {
      title: 'Votre point de départ : comment vous raisonnez aujourd’hui',
      intro: 'Avant de travailler les réponses, il faut entendre comment vous répondez aujourd’hui, sans préparation et à voix haute.',
      look: [
        'Prenez trois situations au hasard : un refus de toilette, une chute, une famille mécontente. Répondez à voix haute, en deux minutes, en vous enregistrant avec votre téléphone. Ne préparez rien. Réécoutez ensuite sans vous juger, et notez ce que vous avez fait en premier. La question à poser est simple : ai-je regardé la personne, ou ai-je tout de suite cherché la solution ?',
        'Comptez ensuite ce qui revient dans vos réponses. Parlez-vous de sécurité, de dignité, de consentement ? Citez-vous l’infirmier ? Un candidat qui oublie d’appeler peut avoir un excellent sens du contact. Un autre appelle tout de suite et n’a pas un mot pour le patient. Chacun perd des points à un endroit différent, et c’est ce repérage qui oriente l’entraînement.',
        'Notez enfin ce qui vous fait perdre vos moyens : le silence du jury, une question inattendue, la peur de dire une bêtise médicale. Ces trois peurs ne se travaillent pas de la même façon. La première demande de la répétition devant une personne, la deuxième une méthode qui se déroule toute seule, la troisième de savoir clairement ce qui n’est pas de votre rôle.',
      ],
    },
    examples: [
      'Sonia s’enregistre sur le refus de toilette : elle parle 1 minute 30 de technique et ne dit jamais ce qu’elle ferait pour comprendre le refus. Elle note cette ligne sur sa fiche, et c’est par là qu’elle commence.',
      'Karim répond très bien sur la chute, mais il oublie à chaque fois de dire qu’il prévient l’infirmier. Sa sœur tient une liste des quatre temps et lève la main à chaque oubli pendant ses répétitions.',
    ],
    angle: [
      'Une mise en situation n’a pas de bonne réponse à réciter. Le jury regarde dans quel ordre vous pensez : est-ce que vous observez avant d’agir, est-ce que vous parlez à la personne, est-ce que vous restez dans votre rôle, est-ce que vous transmettez. C’est pour cela qu’une réponse courte et bien ordonnée vaut mieux qu’une longue démonstration de connaissances.',
      'Quand la question semble vous piéger, c’est souvent qu’elle teste une limite : ce qui relève de l’infirmier, ce qui relève du secret, ce qu’on ne fait pas seul. Dire « je ne décide pas cela seule, j’appelle l’infirmière » n’est jamais un aveu de faiblesse dans ce métier : c’est très exactement la réponse d’une professionnelle.',
    ],
    gear: [
      'Travaillez toujours à voix haute. On croit savoir une réponse tant qu’elle reste dans la tête, et on découvre le contraire dès qu’il faut la dire devant quelqu’un. Chronométrez-vous sans chercher la vitesse : deux minutes posées disent mieux votre sérieux que quatre minutes précipitées. Une phrase d’attaque toujours identique, comme « je commence par observer la personne », évite le trou du début.',
      'Variez ensuite les situations plutôt que de perfectionner une seule carte. Le jour de l’oral, la question ressemblera à vos cartes sans être exactement l’une d’elles. La méthode en quatre temps doit donc tenir quand le détail change : un patient, un résident, une famille, un collègue. Si vous déroulez les quatre temps sur une situation que vous n’aviez pas prévue, vous êtes prêt.',
    ],
    fault: ['Ces pièges ont le même défaut : ils montrent ce que vous savez au lieu de montrer comment vous travaillez. Un jury préfère une candidate qui dit ce qu’elle observe et qui transmet à une candidate qui propose un diagnostic. Quand vous hésitez entre deux réponses, gardez celle qui protège la personne et qui respecte votre rôle.'],
    cases: ['Si vous bloquez devant le jury, nommez ce qui se passe plutôt que de vous taire : « je reprends, je commence par la sécurité de la personne ». Vous avez le droit de prendre quelques secondes. Le silence paraît toujours plus long à celui qui parle qu’à celui qui écoute, et une reprise calme montre justement la maîtrise que le jury cherche chez une future soignante.'],
    plan: ['Gardez une trace de chaque répétition : la carte travaillée, le temps, et le point à reprendre. À la fin de la deuxième semaine, refaites les trois situations du premier jour et réécoutez les deux enregistrements l’un après l’autre. La différence s’entend tout de suite, et elle vous servira le matin de l’épreuve, au moment où le doute arrive.'],
  },
  impots: {
    rail: [
      'L’URSSAF et les impôts ont chacun leur calendrier : aucun des deux ne vous rappelle les dates de l’autre.',
      'Gardez vos avis et vos attestations dans un seul dossier, classés par année : vous les retrouverez en une minute.',
      'Vérifiez chaque date sur le site officiel avant de la noter : seuils et échéances changent d’une année à l’autre.',
      'Une mise de côté mensuelle, même petite, pèse moins qu’un gros paiement en fin d’année.',
      'Si un montant vous semble faux, écrivez depuis votre espace en ligne : votre demande reste datée et tracée.',
      'Bloquez un moment chaque trimestre pour relire ce calendrier : rien ne passe alors à travers.',
    ],
    spare: [
      'Faites relire votre calendrier une fois par une personne qui connaît le sujet, si vous en avez l’occasion : une chambre de métiers, une chambre de commerce, un service d’aide aux créateurs. Ces interlocuteurs répondent souvent sans frais à une question précise. Préparez votre question par écrit, avec vos chiffres sous les yeux.',
      'Prévoyez un rendez-vous d’une heure avec vous-même en fin d’année. Vous y relisez ce qui a été payé, ce qui reste dû et ce qui change pour l’année suivante. Une fin d’année préparée évite les mauvaises surprises de janvier et vous donne une vision claire de ce que votre activité vous a réellement laissé.',
      'Gardez une méthode simple pour vos paiements : une date fixe pour chaque échéance, un rappel une semaine avant, une confirmation enregistrée dans le dossier. Si vous passez par un prélèvement automatique, vérifiez que le compte sera approvisionné ce jour-là. Un rejet de paiement coûte plus de temps que le paiement lui-même.',
      'En cas de changement dans votre situation, comme une activité ajoutée, un déménagement ou un mariage, posez-vous la question fiscale tout de suite. Ces événements peuvent modifier votre foyer, votre commune ou vos options. Mieux vaut vérifier le jour même sur les sites officiels que de le découvrir au moment de la déclaration.',
    ],
    start: {
      title: 'Où vous en êtes de votre première année',
      intro: 'Une première année se pilote avec quelques dates et quelques chiffres, à condition de savoir lesquels vous concernent.',
      look: [
        'Rassemblez d’abord ce que vous avez déjà : la date de création, votre activité exacte, l’attestation de l’ACRE si vous l’avez obtenue, le chiffre d’affaires encaissé depuis le début. Ces éléments décident de presque tout le reste. Une date de création en cours d’année, par exemple, change la période sur laquelle portent vos premières obligations.',
        'Vérifiez ensuite dans quels espaces vous êtes inscrit. Il en faut deux : celui de l’URSSAF pour vos déclarations de chiffre d’affaires, celui des impôts pour votre déclaration de revenus et votre avis de CFE. Beaucoup de créateurs n’ouvrent le second qu’au moment où un courrier les inquiète. Ouvrez-le aujourd’hui, même si aucune somme n’est encore due : tout y arrive sans prévenir.',
        'Faites enfin le tri entre ce qui est décidé et ce qui reste ouvert. L’ACRE a-t-elle été demandée ? Le versement libératoire a-t-il été choisi ? Votre activité est-elle bien classée ? Une ligne « je ne sais pas » sur votre fiche n’est pas un problème : c’est votre liste de vérifications pour la semaine, à faire sur les sites officiels ou auprès de l’organisme concerné.',
      ],
    },
    examples: [
      'Thomas crée son activité en mars. Sur sa fiche, il note ses deux espaces en ligne, la date limite de sa déclaration de revenus et le mois où il devra consulter son avis de CFE. Il met un rappel dans son agenda pour chacune.',
    ],
    angle: ['La difficulté de la première année ne vient pas des montants. Elle vient de ce que chaque sujet dépend d’un organisme et d’un calendrier différents : l’URSSAF pour les cotisations, les impôts pour le revenu, votre commune pour la CFE. Personne ne vous envoie de vue d’ensemble, et l’on découvre souvent une obligation au moment où elle tombe. Le travail de ce guide consiste à mettre ces trois calendriers sur une seule page.'],
    gear: ['Traitez chaque rendez-vous au moment où il arrive, pas tous ensemble un dimanche de décembre. Une séance de trente minutes suffit pour la plupart, à condition d’avoir vos chiffres sous la main. Gardez dans un seul dossier chaque avis, chaque attestation et chaque confirmation de dépôt : le jour où on vous demande une pièce, vous la retrouvez en deux minutes.'],
    fault: ['Ces oublis se ressemblent : on pense qu’une démarche faite auprès d’un organisme vaut pour les autres. Déclarer son chiffre d’affaires à l’URSSAF ne dispense pas de le reporter dans sa déclaration de revenus. Créer son entreprise ne déclenche pas seul l’ACRE dans tous les cas. Avant de cocher une ligne, demandez-vous auprès de qui elle se fait et où vous en gardez la preuve.'],
    cases: ['Quand une date est passée, le réflexe utile est de régulariser tout de suite et de garder la trace de la démarche. Un organisme traite bien mieux un retard signalé qu’un silence. Si un montant vous semble anormal, lisez l’avis en entier, comparez-le à votre situation et contactez le service indiqué sur le document, en passant par votre espace personnel et jamais par un lien reçu par courriel.'],
    plan: ['Ce calendrier sert aussi de budget : à chaque ligne qui annonce un paiement, notez une estimation et mettez la somme de côté dès que vous encaissez. Un compte séparé, même modeste, évite de découvrir en décembre que l’argent a déjà été dépensé. Les montants exacts se vérifient chaque année sur les sites officiels.'],
  },
  tarif: {
    rail: [
      'Votre prix dit aussi quel client vous attirez : un tarif trop bas peut inquiéter autant qu’un tarif trop haut.',
      'Reprenez vos trois dernières missions et calculez ce qu’elles vous ont vraiment rapporté par jour.',
      'Entraînez-vous à dire votre prix à voix haute : une phrase répétée dix fois sort sans trembler.',
      'Un « non » sur le prix n’est pas un échec : c’est une information sur le marché que vous visez.',
      'Quand un client hésite, demandez ce qui le retient : la réponse est rarement le prix seul.',
      'Écrivez votre tarif dans un document daté : vous verrez vos progrès d’une année à l’autre.',
    ],
    spare: [
      'Regardez aussi ce que votre client achète vraiment. Il paie rarement des jours de travail : il paie un problème réglé, un délai tenu, un risque en moins. Quand vous décrivez votre mission dans ces termes, le prix se compare à ce que coûterait de ne rien faire, et non au tarif d’un autre freelance trouvé en ligne.',
      'Écrivez vos conditions une fois pour toutes dans un modèle de devis : acompte, nombre d’allers-retours inclus, délai de paiement, ce qui se facture en plus. Vous n’avez plus à les renégocier à chaque mission, et le client les découvre comme une règle normale de votre activité plutôt que comme une demande personnelle.',
      'Parlez de vos tarifs avec d’autres freelances de votre domaine, quand c’est possible. Un échange honnête entre pairs vous donne un ordre de grandeur bien plus utile qu’un classement trouvé en ligne, et il rassure sur ce que le marché accepte. Gardez vos calculs comme référence : le prix des autres informe, il ne décide pas.',
      'Préparez une phrase simple pour les demandes de remise. Par exemple : « je peux réduire le prix si nous réduisons le périmètre, voici ce que je propose d’enlever ». Écrite à l’avance, elle vous évite d’improviser, et elle garde la discussion sur le travail à faire. Vous n’avez alors plus à défendre votre valeur.',
      'Présentez votre prix en dernier, après avoir décrit le problème du client et ce que vous allez livrer. Un chiffre annoncé trop tôt est jugé seul. Le même chiffre, placé après une description précise du résultat attendu, se discute sur la valeur. Cette seule question d’ordre rend la conversation beaucoup plus confortable.',
      'Entraînez-vous à le dire à voix haute. Annoncez votre tarif devant un miroir ou à un ami, puis taisez-vous. Le silence qui suit est le moment le plus difficile : c’est là que beaucoup de freelances se mettent à se justifier ou à baisser d’eux-mêmes. Quelques répétitions suffisent à le rendre supportable.',
      'Gardez une trace de ce que vous avez proposé et de ce qui a été accepté ou refusé. Après une dizaine de propositions, vous saurez si votre prix bloque vraiment ou si c’est votre offre qui n’est pas claire. Un taux d’acceptation très élevé est d’ailleurs souvent le signe d’un tarif encore trop bas.',
    ],
    start: {
      title: 'Votre tarif actuel, regardé en face',
      intro: 'Avant de calculer un nouveau prix, il faut savoir ce que votre tarif actuel vous rapporte vraiment.',
      look: [
        'Reprenez vos trois dernières missions et notez le prix facturé, puis le temps réellement passé, réunions, allers-retours et corrections compris. Divisez. Ce chiffre est votre vrai taux, celui qui dit ce que vaut une de vos journées aujourd’hui. Il est souvent plus bas que le tarif affiché, et c’est utile à savoir avant d’entrer dans une négociation.',
        'Notez ensuite ce qui n’était pas prévu : l’appel en plus, la version en plus, la petite demande glissée à la fin. Ces ajouts sont rarement énormes, mais ils s’additionnent. Regardez aussi combien de temps vous avez mis à être payé, et si un acompte a été versé. Votre prix ne se limite pas à un chiffre : il inclut les conditions dans lesquelles vous travaillez.',
        'Listez enfin vos clients en face de ce qu’ils vous apportent. Un client qui paie un peu moins, à l’heure, sans surprise, peut valoir mieux qu’un client mieux payé qui remet tout en cause. Vous verrez où un tarif plus élevé est le plus facile à poser : sur un nouveau client, sur une nouvelle mission, ou à la date anniversaire d’un contrat.',
      ],
    },
    examples: [
      'Sarah facture 450 € par jour, mais sa dernière mission a pris 6 jours au lieu des 5 vendus. Son vrai taux tombe à 375 €. Elle écrit ce chiffre en haut de sa fiche avant de préparer sa prochaine proposition.',
    ],
    angle: ['Si vous n’osez pas annoncer votre prix, c’est rarement une question de confiance en vous. C’est qu’il ne repose sur rien de solide : un chiffre vu ailleurs, un ancien salaire, le tarif d’un ami. Un prix calculé se dit plus facilement, parce que vous savez ce qu’il y a derrière. Le jour où un client le discute, vous parlez de ce que vous livrez et non de ce que vous valez.'],
    gear: ['Faites ces calculs avec vos propres chiffres, même approximatifs, plutôt qu’avec une moyenne trouvée en ligne. Un TJM plancher est une limite pour vous, il ne se montre pas au client : c’est le prix en dessous duquel une mission vous coûte de l’argent. Le TJM cible est celui que vous annoncez. L’écart entre les deux est votre marge de discussion, et elle se dépense contre une contrepartie.'],
    fault: ['Ces erreurs partent de la peur de perdre le client. Pourtant une remise accordée au premier « c’est cher » apprend surtout au client que votre prix n’était pas vrai. Répondez plutôt par le périmètre : à ce prix-là, voici ce qu’on enlève. Si vous cédez, ce sera en échange de quelque chose : un acompte plus élevé, un délai plus long, une référence.'],
    cases: ['Quand un client historique paie trop peu, ne changez pas tout d’un coup. Annoncez la hausse à une date fixe, par écrit, en expliquant ce qui évolue, et laissez-lui le temps de s’organiser. Si la réponse est non, vous saurez au moins si cette relation vaut encore la place qu’elle occupe dans votre semaine. Un refus clair libère du temps pour un client mieux payé.'],
    plan: ['À la fin de ces sept jours, testez votre nouveau tarif sur une vraie proposition, de préférence auprès d’un prospect qui ne vous connaît pas. Notez sa réaction et ce que vous avez répondu. La première fois est la plus difficile : dès la troisième, le chiffre sort tout seul. Revoyez vos calculs une fois par an, ou à chaque changement important dans vos charges.'],
  },
  nord: {
    rail: [
      'À l’ombre, une plante pousse moins vite : cela ne dit rien de votre main verte.',
      'Refaites votre relevé de lumière en été : un coin sombre en mars peut s’éclaircir quand le soleil monte.',
      'Tournez les pots d’un quart de tour de temps en temps : les plantes penchent vers la lumière.',
      'Un très grand pot garde l’eau longtemps : à l’ombre, plusieurs petits contenants se gèrent mieux.',
      'Une jardinière ratée ne coûte qu’un sachet de graines : videz, ressemez, et notez ce qui n’a pas marché.',
      'Gardez vos notes de semis d’une année sur l’autre : elles deviennent votre propre calendrier.',
    ],
    spare: [
      'Protégez aussi vos plantes du vent, souvent plus gênant que l’ombre sur un balcon exposé au nord. Un brise-vue léger, une jardinière lourde placée du côté du courant d’air ou un simple treillage suffisent à garder un peu de chaleur autour des salades. La terre sèche moins vite, et les jeunes semis tiennent mieux pendant leurs premières semaines.',
      'Pensez aussi à la hauteur. Des étagères, une échelle à jardinières ou des suspensions gagnent de la lumière sans prendre de place au sol, et elles laissent passer l’air. Installez les plantes les plus gourmandes en haut, les herbes qui aiment la fraîcheur en bas, et gardez un accès facile pour arroser et cueillir.',
      'Soignez la terre comme le ferait un jardinier en plein champ. Un terreau neuf et de bonne qualité compense en partie le manque de lumière, parce que les racines trouvent de quoi se développer. Renouvelez une partie du contenant chaque année, et ajoutez un peu de compost si vous en avez, plutôt que d’accumuler les engrais.',
      'Récoltez souvent, même de petites quantités. Une cueillette régulière relance la plante, et une feuille ramassée jeune a plus de goût qu’une grande feuille restée trop longtemps. Sur un petit balcon, le plaisir vient de ces quelques poignées cueillies au moment de cuisiner, bien plus que d’une grosse récolte.',
    ],
    start: {
      title: 'Ce que votre balcon reçoit vraiment',
      intro: 'Un balcon au nord n’est pas un balcon sans lumière. Tout dépend de ce qu’il reçoit, et cela se mesure en une journée.',
      look: [
        'Choisissez un jour clair et passez sur le balcon à trois moments : le matin, à midi, en fin de journée. Notez sur la fiche quelles zones reçoivent du soleil direct, quelles zones reçoivent seulement une lumière vive, et lesquelles restent sombres. Refaites le tour une fois à la fin du printemps : le soleil monte, et certains coins s’éclairent en mai alors qu’ils étaient dans l’ombre en mars.',
        'Levez ensuite les yeux. Un mur clair en face, une façade qui renvoie la lumière ou un ciel bien dégagé changent beaucoup de choses, même sans soleil direct. Un balcon du premier étage dans une rue étroite n’offre pas la même lumière qu’un dernier étage ouvert sur le ciel. Regardez aussi l’avancée du balcon du dessus : c’est souvent elle qui plonge le fond dans l’ombre.',
        'Vérifiez enfin les contraintes pratiques : d’où vient le vent, où l’eau de pluie arrive, ce que le règlement de la copropriété autorise sur la rambarde, et le poids que vous allez poser. Une jardinière humide pèse lourd : placez les plus grands contenants près du mur porteur. Ce relevé prend une heure et il décide de tout ce que vous achèterez.',
      ],
    },
    examples: [
      'Hélène relève son balcon au 2e étage : la rambarde reçoit une lumière vive toute la journée, le sol reste sombre. Elle accroche ses jardinières de salades à la rambarde et garde le sol pour les outils et la réserve de terreau.',
      'Nicolas sème des radis et de la roquette début avril sur son balcon nord. Il garde un petit carnet : date du semis, zone, première récolte. L’année suivante, il sait quelle jardinière démarre le plus tôt.',
    ],
    angle: ['La plupart des déceptions viennent d’un mauvais choix de plantes, pas d’un mauvais balcon. On reprend ce qui pousse au soleil, on regarde les tomates s’étioler, et l’on en conclut que rien ne pousse ici. Or les plantes dont on mange les feuilles n’ont pas besoin de fabriquer des fruits : elles se contentent de moins de lumière. Changer de liste de plantes change donc tout le résultat.'],
    gear: [
      'Accordez à la lumière la meilleure place, même si ce n’est pas la plus jolie. Quelques dizaines de centimètres vers la rambarde peuvent séparer une salade fournie d’une salade filante. Surélevez les jardinières si le garde-corps est plein, et choisissez des pots clairs : ils renvoient un peu de lumière et chauffent moins les racines. Un mur peint en blanc au fond du balcon aide aussi.',
      'Gardez le même rythme de petites quantités tout au long de la saison. Une jardinière semée toutes les trois semaines donne de quoi cueillir régulièrement, alors qu’un seul grand semis arrive d’un coup puis monte en graines. À l’ombre, tout pousse plus lentement : comptez quelques jours de plus que ce qu’indique le sachet, et n’en concluez pas que quelque chose ne va pas.',
    ],
    fault: ['Le piège de l’ombre est de vouloir compenser. On arrose plus parce que ça pousse mal, on ajoute de l’engrais, on rapproche les plants, et les racines finissent par souffrir. À l’ombre, la terre sèche lentement : enfoncez un doigt avant d’arroser, et attendez qu’elle soit sèche en surface. Moins d’eau et plus d’air règlent une bonne partie des soucis.'],
    cases: ['Une feuille qui s’allonge et pâlit réclame de la lumière, pas de l’eau. Déplacez le contenant vers l’endroit le plus clair, ou changez de plante pour la saison suivante. Quand une culture ne donne rien malgré tout, ne vous acharnez pas : notez la zone et la date, et essayez autre chose. C’est de cette façon qu’un balcon se découvre, année après année.'],
    plan: ['Tenez un carnet très simple : ce qui a été semé, où, quand, et ce que cela a donné. À la fin de la saison, vous aurez la vraie carte de votre balcon. Elle vaut mieux que n’importe quel tableau de culture, car elle tient compte de votre étage, de votre rue et de votre vent. Commencez l’année suivante avec les trois plantes qui ont le mieux donné.'],
  },
  grignotage: {
    rail: [
      'Le soir, on décide moins bien qu’au matin : ce plan prépare les choses à l’avance, quand vous avez encore les idées claires.',
      'Notez aussi les soirs sans envie : ils montrent ce qui vous protège déjà.',
      'Brossez-vous les dents après le dîner : ce simple geste marque la fin des repas.',
      'Un soir raté n’efface pas la semaine : reprenez simplement le rituel le lendemain.',
      'Dites à votre entourage ce que vous changez : un paquet ouvert sur la table basse ne vous aidera pas.',
      'À la fin du plan, gardez ce qui a le mieux marché et laissez le reste s’alléger.',
    ],
    spare: [
      'Parlez de votre démarche à la personne qui partage vos soirées. Il ne s’agit pas de lui demander de vous surveiller, mais de changer une habitude à deux : un paquet qui reste au placard, une tisane partagée, une promenade courte après le dîner. Ce qui se fait ensemble tient bien mieux qu’une décision prise seule.',
      'Prévoyez les soirs particuliers : les apéritifs, les dîners dehors, les retours de voyage. Ils ne remettent rien en cause et il n’y a rien à rattraper. Choisissez à l’avance ce qui vous fait vraiment plaisir, savourez-le à table, et revenez le lendemain à vos repères habituels.',
      'Regardez aussi votre sommeil. Une nuit trop courte rend la soirée suivante bien plus difficile, car la fatigue pousse vers ce qui sucre et ce qui rassure. Avancer le coucher d’un quart d’heure est parfois le geste le plus simple de tout ce plan : on ne grignote pas devant la télé quand on est déjà couché.',
    ],
    start: {
      title: 'Vos soirées, vues de près',
      intro: 'Le grignotage du soir paraît toujours arriver par hasard. Cinq soirs notés montrent en général le contraire.',
      look: [
        'Pendant cinq soirs, sans rien changer à ce que vous mangez, notez l’heure de l’envie, l’endroit où vous êtes et ce que vous ressentez : faim dans le ventre, fatigue, ennui, tension de la journée. Notez aussi ce que vous avez pris. Il ne s’agit pas de compter quoi que ce soit, mais de voir ce qui se répète. La plupart des gens découvrent une heure et un endroit précis.',
        'Regardez ensuite le reste de la journée. Un déjeuner pris sur le pouce ou un dîner trop léger rendent la soirée difficile, quelle que soit votre motivation. Notez à quelle heure vous avez mangé pour la dernière fois avant l’envie. Si cinq ou six heures se sont écoulées, votre corps a simplement faim, et le problème ne se trouve pas dans le placard.',
        'Faites enfin le tour de ce qui est à portée de main. Ce qui se trouve à hauteur des yeux dans la cuisine, ce qui reste sur la table basse, ce qui s’achète en grand format : ces détails décident souvent à votre place. Sur votre fiche, entourez les soirs où l’envie est arrivée alors que vous étiez déjà fatiguée : ce sont ceux qui demanderont le plus de préparation.',
      ],
    },
    examples: [
      'Claire note cinq soirs : l’envie arrive toujours vers 21 h 15, sur le canapé, à la fin de son premier épisode. Elle mange moins bien à midi les jours de réunion. Elle travaille d’abord son déjeuner du mardi et du jeudi.',
      'Sylvie remplace le paquet ouvert sur la table basse par une tisane et un carré de chocolat servi dans une petite assiette, à table. Elle garde ce qu’elle aime, seulement plus au même endroit.',
    ],
    angle: ['Le grignotage du soir n’est pas un manque de volonté. C’est une habitude installée par la répétition : même canapé, même heure, même écran, même récompense à la fin d’une longue journée. Votre cerveau a associé ce moment à quelque chose de bon et il vous le rappelle chaque soir. Lutter de front contre ce rappel fatigue. Le déplacer, lui donner une autre forme, réussit bien mieux.'],
    gear: [
      'Commencez par la journée avant de toucher à la soirée. Un dîner qui tient, avec des légumes, de quoi caler et un plaisir, évite une bonne partie des envies de 22 h. Prévoyez aussi les soirs difficiles : quand vous savez à l’avance ce que vous prendrez si la faim est réelle, vous n’avez plus à décider sous le coup de la fatigue.',
      'Le rituel de fin de journée sert à dire au corps que la journée est finie. Il doit être agréable, sinon il ne tiendra pas : une tisane, une douche, dix minutes de lecture, un appel à une amie. Choisissez-le selon ce que votre journal a montré. Si l’envie vient de la tension, cherchez ce qui détend. Si elle vient de l’ennui, cherchez ce qui occupe les mains.',
    ],
    fault: ['Ces erreurs reviennent toutes à se punir. On s’interdit, on saute un repas pour compenser, on culpabilise, et la frustration prépare le prochain soir difficile. Un écart n’appelle aucune réparation : le repas suivant reste un repas normal. Regardez ce qui l’a déclenché, notez-le sans jugement, et reprenez simplement le plan à la ligne du soir suivant.'],
    cases: ['Certains soirs, rien de tout cela ne suffit, et ce n’est pas grave. Si vous mangez vraiment beaucoup, de façon incontrôlable et souvent, ou si la nourriture occupe une grande place dans vos pensées et votre humeur, parlez-en à votre médecin : il existe de l’aide, et ce guide ne la remplace pas. Pour tous les autres soirs, un seul écart ne dit rien de votre semaine.'],
    plan: ['Chaque semaine, relisez votre journal et posez-vous deux questions : combien de soirs l’envie est-elle arrivée, et combien de fois avez-vous choisi ce que vous vouliez faire ? La seconde réponse compte le plus. Une envie qui se présente et qui passe est une victoire, même si elle revient le lendemain. Elle deviendra plus discrète à mesure que le nouveau rituel s’installera.'],
  },
  listening: {
    rail: [
      'On ne va jamais plus vite que l’audio : le but est d’arriver avant lui sur la question.',
      'Un test blanc est la photo d’un jour : comparez plutôt vos types d’erreurs d’un test à l’autre.',
      'Le jour du test, on ne prend pas de notes : entraînez-vous à retenir sans écrire.',
      'Ne laissez aucune case vide : une mauvaise réponse ne retire aucun point.',
      'Quand la fatigue arrive, redressez-vous et respirez une fois : une seconde suffit pour revenir à la question.',
      'Gardez le même créneau pour vos séances : une habitude se prend plus vite à heure fixe.',
    ],
    spare: [
      'Entraînez-vous aussi à reconnaître les pièges de sons proches. Le test aime les mots qui se ressemblent à l’oreille et qui n’ont aucun rapport. Quand une réponse contient un son entendu dans l’enregistrement sans rien avoir à voir avec la situation, méfiez-vous. Noter ces paires dans votre carnet vous aidera à les repérer plus vite.',
      'Choisissez des contenus proches du test : des annonces d’aéroport, des messages de répondeur, des réunions, de courtes actualités d’entreprise. Le vocabulaire du TOEIC vient du monde du travail, et le reconnaître à l’oreille vous fait gagner du temps sur chaque question. Une série en anglais détend, mais elle ne remplace pas cet entraînement ciblé.',
      'Notez les mots que vous ne reconnaissez pas à l’oreille alors que vous les connaissez à l’écrit. C’est votre vraie liste de travail. Les nombres, les noms de lieux et les horaires reviennent très souvent et se ressemblent à l’oral : quelques minutes par jour dessus rapportent plus qu’une longue liste de vocabulaire rare.',
      'Le jour du test, entrez dans la salle avec votre routine en tête : lire, écouter, cocher, passer à la suite. Mangez avant, arrivez en avance et prévoyez une montre si elle est autorisée. Votre attention est votre principale ressource dans cette partie, et un peu de calme avant de commencer vaut plusieurs points.',
    ],
    start: {
      title: 'Où vous perdez vraiment vos points',
      intro: 'Dire « je ne comprends rien » n’aide pas à progresser. Un test blanc corrigé question par question dit où passent les points.',
      look: [
        'Faites une partie Listening complète, en conditions réelles, sans mettre en pause et sans réécouter. Corrigez ensuite question par question et classez chaque erreur : vous n’avez pas compris, vous avez compris mais vous avez choisi trop vite, vous avez perdu le fil à cause de la question d’avant, ou vous n’avez pas eu le temps de lire. Quatre colonnes suffisent, et elles racontent déjà quelque chose.',
        'Regardez ensuite où se concentrent les pertes. Des erreurs réparties au hasard ne se traitent pas comme une série de questions ratées à la suite, signe d’un décrochage. Notez aussi le type de locuteur et de sujet : des annonces, des réunions, des appels téléphoniques. Beaucoup de candidats découvrent qu’ils comprennent bien les conversations et décrochent sur les monologues de la part 4.',
        'Testez enfin votre lecture des questions. Dans le silence entre deux enregistrements, avez-vous le temps de lire les trois questions et leurs réponses ? Si ce n’est pas le cas, le problème n’est pas seulement votre oreille : il vient d’une lecture trop lente, ou d’un réflexe qui vous fait revenir sur la question précédente. Ce point se corrige plus vite que le vocabulaire.',
      ],
    },
    examples: [
      'Mehdi classe ses 26 erreurs de part 3 et 4 : plus de la moitié viennent de questions qu’il n’a pas eu le temps de lire. Il travaille d’abord la lecture anticipée et laisse le vocabulaire pour la deuxième semaine.',
    ],
    angle: ['Ce qui va trop vite, ce n’est pas seulement l’anglais. Le cerveau essaie de tout comprendre et de tout traduire, et pendant ce temps la phrase suivante est déjà passée. Le TOEIC ne vous demande pas de tout saisir : il pose des questions précises sur quelques informations. Quand vous savez à l’avance ce que vous cherchez, vous écoutez autrement, et beaucoup de ce qui semblait trop rapide devient suffisant.'],
    gear: [
      'Installez une courte séance d’écoute chaque jour plutôt qu’une longue le week-end. L’oreille progresse par fréquence : quinze minutes d’écoute attentive valent mieux qu’une heure en fond sonore. Écoutez une fois sans le texte, une fois avec, puis répétez à voix haute en imitant le rythme. C’est cette dernière étape qui fixe les mots tels qu’ils se prononcent vraiment, et non tels qu’ils s’écrivent.',
      'Entraînez aussi votre attention à revenir vite. Quand vous ratez une information, choisissez une réponse, cochez, et passez à la question suivante. Cet abandon rapide s’apprend, et il faut le répéter en conditions réelles pour qu’il tienne le jour du test. Sur une série de questions, une réponse sacrifiée coûte beaucoup moins cher que trois réponses perdues en s’y accrochant.',
    ],
    fault: ['Ces erreurs ont une cause commune : on écoute les mots et non le sens. Une réponse qui reprend un mot de l’enregistrement est souvent le piège prévu, car le test aime les reformulations. Quand une option semble trop évidente, vérifiez qu’elle répond bien à la question posée. Vous gagnerez plus de points à repérer ces reprises qu’à apprendre une nouvelle liste de vocabulaire.'],
    cases: ['Il y aura des jours où l’oreille ne suit pas : fatigue, mauvaise nuit, accent qui surprend. Ces séances ne sont pas perdues : raccourcissez-les et revenez à un extrait déjà connu, pour retrouver la sensation de comprendre. Évitez d’enchaîner un test blanc complet les jours de fatigue. Un mauvais score ces jours-là ne mesure pas votre niveau et il ne fait que vous décourager.'],
    plan: ['Gardez le même type de test pour comparer d’une semaine à l’autre, et regardez le nombre d’erreurs par colonne plutôt que le seul total. Une colonne qui se vide dit ce qui a été acquis. Dans les trois derniers jours, n’ajoutez plus de nouvelles ressources : faites des séries courtes, dormez, et gardez intact le réflexe de lire à l’avance.'],
  },
  enfants: {
    rail: [
      'Un enfant qui refuse un plat ne vous juge pas : il teste souvent sa place à table autant que le goût.',
      'Notez ce qu’il mange sur toute la semaine : un repas raté pèse moins qu’il n’en a l’air.',
      'Servez de petites quantités : une assiette trop pleine décourage avant la première bouchée.',
      'Évitez les compliments appuyés quand il goûte : une réaction discrète garde le repas tranquille.',
      'Un soir difficile se joue sur l’ambiance : mieux vaut un repas simple et calme qu’un beau plat et une dispute.',
      'Affichez le menu de la semaine : un enfant prévenu discute moins au moment de passer à table.',
    ],
    spare: [
      'Faites les courses et le menu avec eux une fois par semaine. Un enfant qui a choisi la couleur des poivrons ou qui a coché le plat de mardi arrive à table avec une autre disposition. Il ne s’agit pas de lui laisser le menu, mais de lui donner une petite place dans ce qui se décide pour lui.',
      'Mangez ensemble quand c’est possible, et mangez la même chose. Un enfant apprend beaucoup en regardant les adultes, sans qu’on ait besoin de commenter quoi que ce soit. Un seul repas partagé dans la journée suffit souvent, et il compte plus que le contenu exact de l’assiette de ce soir-là.',
      'Servez de petites portions et laissez l’enfant se resservir. Une grande assiette décourage avant même de commencer, alors qu’une petite cuillère d’un aliment nouveau à côté d’un plat connu reste abordable. Enlevez l’assiette à la fin du repas, sans remarque, et laissez la prochaine fois arriver naturellement.',
    ],
    start: {
      title: 'Ce que vos enfants mangent déjà',
      intro: 'On retient les refus et l’on oublie ce qui passe. Le plan part pourtant de ce que chaque enfant accepte aujourd’hui.',
      look: [
        'Prenez une semaine ordinaire et notez, pour chaque enfant, ce qu’il mange sans discuter, ce qu’il mange selon les jours, et ce qu’il refuse. Soyez précis : « les carottes crues mais pas cuites » est une information bien plus utile que « il n’aime pas les légumes ». La liste est souvent plus longue qu’on ne le croit, et elle devient la base de vos menus.',
        'Regardez ensuite le contexte des refus. Arrivent-ils en fin de journée, quand tout le monde est fatigué ? Après un goûter tardif ? Face à un plat mélangé, alors que les mêmes aliments passent séparés ? Beaucoup d’enfants refusent une sauce plutôt qu’un légume, ou un mélange plutôt qu’un ingrédient. Ce simple repérage change la façon de cuisiner le dimanche sans ajouter un plat.',
        'Faites enfin le point sur vos propres réactions à table. Qui négocie, qui insiste, qui prépare autre chose ? Si deux adultes appliquent deux règles, les enfants le voient très vite. Mettez-vous d’accord sur une seule règle pour le dîner, simple et tenable un soir de fatigue. C’est elle qui rendra la table plus calme, avant même que le contenu de l’assiette ne change.',
      ],
    },
    examples: [
      'Anaïs note que Léo, 5 ans, refuse le gratin mais mange pommes de terre, jambon et fromage séparés. Le dimanche, elle garde ces trois éléments à part dans une boîte, et le gratin reste pour les adultes et les enfants qui en veulent.',
    ],
    angle: ['Un enfant qui refuse n’essaie pas de vous contrarier. Entre 2 et 7 ans, se méfier de ce qui est nouveau fait partie de son développement, et un plat mélangé contient beaucoup d’inconnues à la fois. La pression à table a souvent l’effet inverse de ce qu’on cherche : plus l’aliment devient un enjeu, plus il est refusé. C’est pourquoi ce guide travaille sur ce qui entoure le repas plutôt que sur chaque bouchée.'],
    gear: ['Gardez la règle la plus simple possible : un élément accepté dans chaque repas, et le reste proposé sans commentaire. L’adulte décide de ce qui est servi, l’enfant décide de ce qu’il en mange et de la quantité. Cela vous évite de cuisiner en double, et cela retire à l’enfant le pouvoir de tout bloquer. Les premiers soirs, il mangera peut-être peu : un repas léger n’a rien de grave.'],
    fault: ['Ces erreurs viennent toutes de la peur qu’il n’ait pas assez mangé. Alors on négocie, on promet le dessert, on prépare autre chose, et le repas devient une discussion. Regardez plutôt sur la semaine : la plupart des enfants équilibrent bien mieux sur plusieurs jours que sur une assiette. Si son poids ou sa croissance vous inquiètent, c’est un sujet à aborder avec votre médecin.'],
    cases: ['Pendant un rhume, une rentrée ou une période chargée, les refus reviennent souvent : ne concluez pas que tout est perdu. Revenez quelques jours aux plats les plus sûrs, gardez la règle du repas, et remettez un aliment nouveau au menu quand le rythme reprend. Quand un enfant ne mange presque plus rien, perd l’appétit durablement ou s’étouffe souvent, parlez-en à votre médecin.'],
    plan: ['Pour suivre vos progrès, relisez votre liste à la fin de chaque semaine et déplacez les aliments d’une colonne à l’autre. Un aliment passé de « pas encore » à « parfois » est une vraie avancée, même s’il n’a été goûté que du bout des lèvres. Comparez aussi l’ambiance : un dîner plus calme compte autant que ce qui reste dans l’assiette.'],
  },
  negociation: {
    rail: [
      'Discuter un prix n’a rien d’impoli : les prestataires reçoivent ces demandes toutes les semaines.',
      'Posez les devis côte à côte avant d’appeler : on négocie mieux quand on sait déjà ce qu’on veut.',
      'Gardez un seul interlocuteur par prestataire : deux voix différentes donnent des messages qui se contredisent.',
      'Parlez de budget et de choix, jamais de la valeur de son travail : un prestataire vexé ne fera aucun geste.',
      'Un refus poli n’est pas une porte fermée : revenez avec une autre date ou un autre périmètre.',
      'Remerciez par écrit quand un geste est accordé : c’est aussi la trace qu’il a bien été convenu.',
    ],
    spare: [
      'Gardez enfin une trace des prestataires que vous n’avez pas retenus, avec leur devis. Un refus poli laisse la porte ouverte : si un partenaire se désiste à quelques mois de la date, vous saurez qui rappeler et à quel prix. Remerciez-les d’un court message, cela ne coûte rien et le milieu est souvent plus petit qu’on ne le croit.',
      'Pensez aussi à regrouper. Un même prestataire qui assure deux prestations, un lieu qui inclut le mobilier, un traiteur qui fournit la vaisselle : un ensemble se négocie souvent mieux que des lignes séparées. Demandez ce que coûterait une formule groupée, puis comparez-la ligne par ligne avec vos autres devis avant de décider.',
      'Regardez aussi ce qui peut se faire autrement qu’avec de l’argent. Un prestataire accepte parfois une date moins demandée, des horaires plus souples, le droit d’utiliser ses photos, une recommandation écrite. Ces contreparties ne vous coûtent rien et elles comptent pour lui. Pensez-y avant de demander une baisse sèche.',
      'Répartissez les rôles à deux. L’un suit les chiffres et le tableau, l’autre garde le contact avec le prestataire. Vous évitez ainsi les messages contradictoires et vous avez toujours quelqu’un pour dire « je dois en parler à l’autre avant de décider ». Cette phrase vous donne le temps de réfléchir quand on vous presse.',
      'Terminez toujours un échange par un écrit. Un simple message qui reprend ce qui a été dit : le montant, ce qui est inclus, la date. Il évite les malentendus et il protège les deux côtés. Un bon prestataire appréciera cette clarté, et un prestataire que cela dérange vous aura appris quelque chose d’utile.',
    ],
    start: {
      title: 'Vos devis, posés sur la table',
      intro: 'Avant de négocier, il faut savoir ce qui vous tient à cœur et ce que chaque devis comprend vraiment.',
      look: [
        'Commencez sans regarder les prix : chacun écrit de son côté les trois éléments qui comptent le plus pour lui, puis vous comparez. Ces trois lignes sont votre boussole. Elles disent où vous pouvez dépenser sans regret et où vous êtes prêts à réduire. Sans ce travail, on négocie partout de la même façon et l’on finit par rogner sur ce qui comptait vraiment.',
        'Reprenez ensuite vos devis déjà reçus et cherchez ce qui n’y figure pas. La durée de présence, le déplacement, l’installation, les heures supplémentaires, le service, la TVA, le repas du prestataire : ce sont ces lignes qui font varier un total. Deux devis au même prix peuvent cacher des prestations très différentes. Une ligne vide est une question à poser, pas une économie.',
        'Regardez enfin votre calendrier. Votre date tombe-t-elle en pleine saison, ou un vendredi, ou en basse saison ? Avez-vous encore du temps avant les dates limites ? Votre marge de négociation dépend beaucoup de ce recul. Notez pour chaque poste la date à laquelle vous devez avoir choisi : vous négocierez sans vous laisser presser par une offre valable quelques jours.',
      ],
    },
    examples: [
      'Emma et Yanis comparent deux traiteurs à 58 € par personne. Le premier compte le service et la vaisselle, le second les facture à part. Sur leur tableau, l’écart apparaît tout de suite, et ils repartent de cette ligne pour discuter.',
      'Pauline et Karim décident que la musique et le repas passent avant la décoration. Ils demandent au fleuriste une version réduite aux tables et à la cérémonie, et ils gardent leur budget pour le groupe qu’ils aiment.',
    ],
    angle: ['Négocier fait peur parce qu’on croit devoir demander une faveur. Or un prestataire vit de ces discussions : il sait ce que coûte chaque ligne et ce qu’il peut ajuster. La question utile n’est pas « pouvez-vous faire un geste ? », mais « que pouvons-nous enlever pour arriver à ce montant ? ». Vous gardez ainsi son respect, et son travail reste payé à sa juste valeur.'],
    gear: [
      'Faites vos demandes par écrit, en phrases courtes et polies : ce que vous avez aimé, ce qui vous pose problème, la solution que vous proposez. Un message écrit laisse au prestataire le temps de regarder ses chiffres, et il garde une trace de ce qui a été convenu. Évitez de négocier au téléphone le soir, fatigués, avec le devis sous les yeux pour la première fois.',
      'Gardez le plus fort argument pour le moment où vous êtes prêts à signer. Un prestataire accepte plus volontiers un ajustement face à un client décidé qu’à quelqu’un qui compare encore dix options. Dites clairement : « nous aimerions travailler avec vous, voici ce qu’il nous faudrait pour signer cette semaine ». Cela rend la discussion simple pour les deux côtés.',
    ],
    fault: ['Ces erreurs ont le même effet : elles vous privent de marge. Annoncer son budget maximum revient à fixer le prix à la place du prestataire. Accepter un accord oral revient à le renégocier le jour où il compte. Avant chaque échange, relisez vos trois priorités : elles vous évitent de gagner quelques euros sur ce qui comptait, et d’en perdre beaucoup sur le reste.'],
    cases: ['Si la discussion se tend, reprenez les faits : le devis, la prestation, le montant. Vous n’avez pas à justifier votre budget, ni à expliquer votre situation. Quand un prestataire que vous aimez ne bouge vraiment pas, regardez si un autre poste peut compenser avant de renoncer. Certains prix sont justes, et mieux vaut payer le bon professionnel que chercher une économie sur ce qui comptait le plus.'],
    plan: ['Tenez votre tableau à jour après chaque échange : le montant de départ, le montant obtenu et ce qui a changé dans la prestation. À la fin du mois, additionnez et comparez à votre budget. Si vous êtes encore au-dessus, retirez un poste entier plutôt que de grignoter partout. Gardez aussi une marge pour les imprévus : il y a toujours quelque chose qui dépasse.'],
  },
  litiges: {
    rail: [
      'La plupart des acheteurs sont de bonne foi : votre méthode sert pour les rares qui ne le sont pas.',
      'Relisez les règles de temps en temps : une plateforme les modifie sans toujours prévenir.',
      'Pesez le colis avant de choisir le format d’envoi : une étiquette au mauvais poids complique tout litige.',
      'Une photo prise à la lumière du jour vaut mieux que dix photos sombres : le défaut doit se voir clairement.',
      'Un litige perdu n’est pas une faute : notez ce qui a manqué à votre dossier pour la prochaine fois.',
      'Tenez une petite liste des ventes en cours avec leur date limite : vous saurez quand chacune se clôt.',
    ],
    spare: [
      'Faites enfin le tri dans ce que vous vendez. Certains articles attirent plus de réclamations que d’autres : les vêtements de marque, l’électronique, les pièces très fragiles. Si un type d’objet vous a déjà causé plusieurs soucis, décrivez-le encore plus précisément, ou réservez-le à une remise en main propre lorsque la plateforme le permet.',
      'Traitez les petites ventes comme les grandes pendant ces deux semaines. C’est en répétant les mêmes gestes sur des articles à quelques euros que la routine s’installe : photo avant fermeture, reçu gardé, message poli à l’envoi. Le jour où vous vendrez un article plus cher, tout sera devenu automatique, et vous n’aurez plus à y penser.',
      'Prévenez les malentendus au moment de la vente. Un court message après l’achat, qui confirme l’article, le délai d’envoi et le mode de livraison, installe un ton correct et montre que vous êtes sérieux. Un acheteur qui a déjà échangé poliment avec vous ouvre beaucoup moins facilement un litige pour un détail.',
      'Regardez le profil avant de vendre un article cher : ancienneté, évaluations, premiers messages. Un acheteur pressé qui pose des questions étranges ou veut changer les conditions mérite une réponse prudente. Vous pouvez refuser une transaction : mieux vaut attendre quelques jours de plus qu’entrer dans un litige de plusieurs semaines.',
      'Gardez tout jusqu’à la clôture de la vente : photos, reçu de dépôt, messages. Une fois la transaction confirmée et les délais passés, vous pouvez trier. Un simple dossier sur le téléphone, avec un sous-dossier par vente importante, suffit largement et vous fera gagner beaucoup de temps le jour où il faudra répondre vite.',
      'Répondez aussi aux acheteurs satisfaits. Un message de remerciement et un avis laissé rapidement construisent un profil solide, et ce profil pèse dans la confiance des acheteurs suivants. Un vendeur avec de nombreuses évaluations claires attire moins les personnes qui cherchent à profiter d’un profil récent.',
    ],
    start: {
      title: 'Votre façon de vendre, passée au crible',
      intro: 'La plupart des litiges se gagnent avant la vente : dans l’annonce, dans le colis, et dans les échanges écrits.',
      look: [
        'Reprenez vos cinq dernières annonces et lisez-les comme un acheteur méfiant. Le défaut est-il écrit et photographié ? La taille réelle est-elle indiquée ? La matière, l’état, les mesures ? Chaque information absente peut servir de prise le jour d’un désaccord. Sur votre fiche, notez ce qui manque le plus souvent : c’est ce que vous corrigerez d’abord dans votre modèle d’annonce.',
        'Regardez ensuite comment vous emballez et expédiez. Prenez-vous une photo de l’article avant de fermer le colis ? Gardez-vous le bordereau et le reçu de dépôt jusqu’à la fin de la transaction ? Ces deux gestes prennent une minute et ils changent tout quand un acheteur affirme avoir reçu autre chose ou n’avoir rien reçu.',
        'Relisez enfin vos anciens échanges difficiles, s’il y en a eu. Combien de temps avez-vous mis à répondre ? Avez-vous répondu sous le coup de l’agacement ? Quel argument de l’acheteur vous a fait céder ? Cette relecture montre vos réflexes. Elle aide aussi à repérer les profils qui posent problème : compte très récent, demandes étranges, insistance pour discuter ailleurs que sur la messagerie.',
      ],
    },
    examples: [
      'Marine vend un manteau avec un petit accroc sous le bras. Elle le photographie de près et l’écrit dans l’annonce. Trois jours après la vente, l’acheteuse se plaint du défaut : Marine renvoie à la photo n°4 et le dossier se clôt en sa faveur.',
      'Olivier filme la fermeture de chaque colis de plus de 30 €, le bordereau visible. Le jour où un acheteur déclare avoir reçu un carton vide, il joint la vidéo et le poids indiqué sur le reçu de dépôt.',
    ],
    angle: ['Un litige n’est pas une affaire de bonne ou de mauvaise foi : c’est un dossier. La plateforme ne connaît ni vous ni l’acheteur, elle regarde ce qui est écrit, ce qui est photographié et ce qui s’est passé dans ses délais. Celui qui a des preuves claires et qui reste dans la procédure a un avantage très net. C’est une bonne nouvelle : ce sont des habitudes, et elles se prennent en quelques ventes.'],
    gear: [
      'Faites de votre annonce un contrat. Quelques photos nettes en lumière du jour, le défaut visible de près, les mesures à plat, une phrase claire sur l’état réel : tout cela prend deux minutes de plus par article et évite des semaines d’échanges. Gardez un modèle d’annonce et de messages, que vous n’avez plus qu’à adapter : on écrit beaucoup mieux au calme qu’au moment où une réclamation arrive.',
      'Répondez sur la messagerie de la plateforme, jamais ailleurs. Cherchez d’abord à comprendre ce que veut l’acheteur : un remboursement, un geste, ou simplement une réponse. Une réponse courte, polie, avec les faits et une proposition, désamorce la plupart des tensions. Attendez une heure si le message vous a énervé : personne n’a jamais gagné un litige avec une phrase écrite sous le coup de la colère.',
    ],
    fault: ['Ces erreurs viennent de l’envie d’en finir vite. On répond à chaud, on accepte un arrangement hors procédure, on cède à une menace d’avis, et l’on perd les protections que la plateforme offrait. Avant toute réponse, demandez-vous si ce que vous allez faire laisse une trace dans le dossier. Si ce n’est pas le cas, ne le faites pas.'],
    cases: ['Parfois, céder est le bon choix. Un article à quelques euros, un acheteur de bonne foi, une erreur de votre part : un remboursement rapide vous coûte moins que plusieurs jours de messages. Fixez-vous une règle à l’avance, par exemple un montant en dessous duquel vous ne discutez pas. Pour les autres cas, suivez la procédure jusqu’au bout, et contactez le service client avec votre dossier complet.'],
    plan: ['À la fin de ces deux semaines, vous devez avoir trois outils prêts : un modèle d’annonce, une routine d’expédition et vos réponses types. Gardez un petit tableau des litiges : date, motif, issue, ce que vous changez. Quelques lignes suffisent pour voir si un type d’article ou d’acheteur revient, et décider de ce que vous ne vendez plus de cette façon.'],
  },
  'sur-place': {
    rail: [
      'Sur place, le budget file rarement sur un gros achat : ce sont les petites dépenses répétées qui pèsent.',
      'Gardez les tickets de la journée dans une seule poche : le soir, vos comptes se font en deux minutes.',
      'Repérez le dernier train de votre ligne dès l’arrivée : il passe souvent plus tôt qu’on ne le pense.',
      'Une application de conversion aide à sentir la vraie valeur des yens, le temps de prendre vos repères.',
      'Une journée trop chère ne gâche pas le voyage : elle se rattrape sur les deux suivantes.',
      'Gardez une petite réserve pour un plaisir imprévu : un budget sans marge finit par être abandonné.',
    ],
    spare: [
      'Regardez aussi vos habitudes du matin. Un petit-déjeuner pris dans un konbini ou un café de quartier coûte bien moins que celui de l’hôtel, et il vous fait sortir plus tôt. Vous profitez ainsi des temples avant l’arrivée des groupes, et votre journée commence par une petite économie, au lieu d’une dépense faite par habitude.',
      'Regardez les pass de transport avec votre itinéraire sous les yeux, et non par habitude. Un pass rentable pour un voyageur qui change de ville tous les deux jours peut être une dépense inutile pour un séjour tranquille dans deux villes. Faites le calcul avec vos trajets réels avant de payer, sur les sites officiels des compagnies.',
      'Gardez une journée libre de temps en temps. Une matinée sans programme, un quartier ordinaire, un parc ou un marché coûtent peu et laissent souvent les meilleurs souvenirs. Elles offrent aussi une pause au budget et aux jambes, ce qui évite les dépenses de fatigue des jours suivants.',
      'Apprenez quelques mots de politesse et les noms de vos plats préférés. Ils vous ouvrent les petits restaurants de quartier, où les prix sont souvent les plus doux. Une application de traduction hors ligne aide à lire une carte, et un sourire avec un mot de japonais fait le reste dans la plupart des situations.',
    ],
    start: {
      title: 'Votre budget réel, avant de partir',
      intro: 'Un budget de voyage tient rarement par hasard : il tient parce qu’il est découpé en chiffres simples, avant d’atterrir.',
      look: [
        'Prenez votre budget total et retirez ce qui est déjà payé : vols, hébergements réservés, assurance. Divisez ce qui reste par le nombre de jours. Ce chiffre est votre vrai budget quotidien, celui qui couvre les repas, les transports, les visites et les petits achats. Si le résultat vous surprend, mieux vaut le savoir chez vous que le quatrième jour à Kyoto.',
        'Regardez ensuite votre programme, ville par ville. Les grandes journées de visites coûtent plus cher, les journées de quartier beaucoup moins. Repérez les trajets longs déjà prévus et les entrées payantes qui comptent vraiment pour vous. Ces lignes ne sont pas à supprimer : elles sont à prévoir, pour qu’elles ne viennent pas casser le plafond du jour où elles tombent.',
        'Préparez enfin votre façon de payer. De quelle carte disposez-vous, avec quels frais ? Combien de liquide emporter pour commencer ? Le Japon reste un pays où certains restaurants et petits temples n’acceptent que l’espèce. Notez les frais de votre banque et votre plafond de retrait sur la fiche, avec le numéro à appeler en cas de carte bloquée.',
      ],
    },
    examples: [
      'Lucie et Tom partent 14 jours. Une fois les vols et les hôtels retirés, il leur reste de quoi vivre avec 9 000 yens par jour à deux. Ils écrivent ce chiffre sur leur carnet, en première page, et le relisent chaque matin.',
    ],
    angle: ['Le budget file rarement à cause d’une grosse dépense. Il s’en va par petites touches : un café pris en passant, un taxi le soir, un déjeuner à côté d’un grand temple. Au Japon, ces écarts paraissent modestes pris un par un, et le pays offre pourtant de très bonnes options bon marché, à condition de savoir où regarder. Il suffit de quelques réflexes pris dès le premier jour.'],
    gear: [
      'Faites votre point du matin en deux minutes : où vous êtes, ce qui est prévu, ce qu’il reste dans le plafond. Le soir, notez le total du jour avant de vous coucher, pendant que les tickets sont encore dans votre poche. Un écart repéré le lendemain se rattrape sans effort visible : un déjeuner plus simple, une marche plutôt qu’un métro.',
      'Mangez bien à midi. Les menus du déjeuner offrent souvent le meilleur rapport entre qualité et prix, dans les mêmes restaurants qui coûtent bien plus cher le soir. Gardez le soir pour un plat simple, un konbini ou un marché quand la journée a été chère. Sortez aussi des rues les plus touristiques : deux rues plus loin, les prix changent et les clients sont des habitués.',
    ],
    fault: ['Ces erreurs viennent toutes de la fatigue et de la peur de se tromper. On mange près du grand site parce qu’on a faim, on prend un taxi parce que les jambes ne suivent plus. Prévoyez donc ces moments : un en-cas dans le sac, un arrêt repéré à l’avance, une pause dans l’après-midi. Une journée trop chargée coûte plus cher qu’une journée bien découpée.'],
    cases: ['Si le budget dérape malgré tout, ne vous privez pas de ce qui justifie le voyage. Regardez ce qu’il reste de jours et divisez à nouveau. Allégez une journée de transport, remplacez une visite payante par un quartier ou un jardin gratuit, et gardez ce qui comptait le plus pour vous. Vous serez bien plus content d’un souvenir choisi que de quelques yens gardés.'],
    plan: ['Tous les trois jours, comparez le total dépensé au plafond prévu et décidez une seule chose pour la suite : on continue, on allège, ou on se fait plaisir. Ce rendez-vous évite de découvrir l’écart le dernier soir. Gardez une petite réserve pour les derniers jours : les cadeaux et les dernières envies arrivent toujours à la fin du voyage.'],
  },
  'grand-oral': {
    rail: [
      'Le trac n’est pas un défaut : il montre que l’épreuve compte pour vous, et il baisse après les premières phrases.',
      'Enregistrez-vous une fois au téléphone : on entend vite ce que personne n’ose vous dire.',
      'Répétez aussi dans une autre pièce : un discours appris dans un seul lieu tient moins bien ailleurs.',
      'Ne remplissez pas chaque silence : une courte pause aide le jury à suivre votre idée.',
      'Un jury qui vous relance ne vous piège pas : il vous donne une occasion de montrer ce que vous savez.',
      'La veille, préparez votre tenue et votre trajet, puis arrêtez de répéter à l’heure du dîner.',
    ],
    spare: [
      'Pensez aussi à votre tenue et à votre arrivée. Choisissez des vêtements dans lesquels vous êtes à l’aise, préparés la veille, et prévoyez d’arriver en avance pour marcher un peu avant d’entrer. Vous ne serez pas évalué là-dessus, mais tout ce qui est réglé à l’avance laisse de la place dans votre tête pour ce qui compte.',
      'Pendant les 20 minutes de préparation, ne réécrivez pas tout. Reprenez votre plan, vos mots-clés et votre phrase d’ouverture, puis relisez la question choisie par le jury. Le support que vous préparez n’est pas noté : il vous sert à vous rassurer et à montrer votre plan. Gardez-le simple et lisible d’un coup d’œil.',
      'Travaillez votre respiration avant d’entrer. Quelques expirations lentes, debout, épaules basses, ralentissent le rythme et posent la voix. Répétez-les à chaque répétition à la maison, pour qu’elles deviennent un réflexe. Le jour de l’épreuve, elles vous occupent pendant les minutes d’attente où le stress a tendance à monter.',
      'Variez votre public. Répéter devant un parent, un ami, puis un professeur vous habitue à des regards différents et à des questions inattendues. Une personne qui ne connaît rien au sujet est très utile : si elle comprend votre explication, votre présentation est claire, et le jury suivra sans difficulté.',
      'Soignez aussi la fin. Beaucoup d’élèves s’arrêtent net ou s’excusent. Préparez une dernière phrase qui reprend votre réponse à la question, puis regardez le jury et attendez. Une fin nette laisse une bonne impression, et elle ouvre l’échange sur ce que vous venez de dire plutôt que sur un flottement.',
    ],
    start: {
      title: 'Où vous en êtes de votre oral',
      intro: 'Avant de répéter, il faut savoir ce que vous dites aujourd’hui et ce qui vous fait le plus peur dans cette épreuve.',
      look: [
        'Prenez une de vos questions et présentez-la à voix haute pendant cinq minutes, sans préparation, en vous enregistrant. Réécoutez sans chercher les défauts de votre voix : cherchez si l’on comprend la question, si vous avez un fil, et si vous arrivez à la fin. Cet enregistrement ne sert qu’à vous : il sera très utile de le réécouter dans trois semaines.',
        'Faites ensuite la liste de ce qui vous inquiète précisément : parler debout, le regard du jury, le trou de mémoire, la voix qui tremble, les questions de l’échange. Une peur générale de l’oral ne se travaille pas, une liste de petites peurs si. Pour chacune, ce guide propose un exercice. Vous verrez que deux d’entre elles pèsent presque toujours plus que les autres.',
        'Vérifiez enfin l’état de vos deux questions. Sont-elles assez précises pour tenir en cinq minutes ? Pouvez-vous expliquer pourquoi elles vous intéressent, en une phrase et avec vos mots ? Le lien avec votre projet d’orientation est-il clair ? Si une question vous ennuie déjà, changez-la maintenant : on parle bien mieux de ce qui nous intéresse, et le jury l’entend tout de suite.',
      ],
    },
    examples: [
      'Inès s’enregistre 5 minutes sur sa question de SVT : elle lit presque tout et finit en 3 minutes 20. Elle note deux priorités sur sa grille : poser ses feuilles, et préparer un exemple de plus pour sa deuxième idée.',
      'Hugo a surtout peur de l’échange. Son frère lui pose dix questions au hasard sur son sujet. Il répond d’abord en une phrase, puis ajoute un exemple : à la troisième répétition, il attend presque les questions.',
    ],
    angle: ['Le Grand oral fait peur parce qu’il ressemble à une performance. Il mesure pourtant autre chose : votre capacité à expliquer ce que vous avez compris, à argumenter, et à échanger avec deux adultes. Le jury ne cherche pas un acteur et il ne vous demande pas de tout savoir. Il cherche quelqu’un qui parle de son sujet avec ses mots. C’est pour cela qu’un élève qui récite perd souvent face à un élève qui hésite un peu, mais qui pense vraiment.'],
    gear: [
      'Debout, à voix haute, chronomètre en main : c’est la seule répétition qui compte. Relire ses notes assis donne l’impression d’avancer, mais la bouche et le corps n’ont rien appris. Commencez par des répétitions imparfaites plutôt que d’attendre d’être prêt. Une répétition de cinq minutes par jour dans votre chambre vaut mieux qu’une longue séance la veille de l’épreuve.',
      'Soignez les trente premières secondes. Sachez exactement comment vous commencez : une phrase pour poser la question, une phrase pour dire pourquoi elle vous intéresse. Ces deux phrases, répétées vingt fois, vous portent au moment où le stress est le plus fort. Le reste vient ensuite, avec vos mots-clés. Regardez vos examinateurs à tour de rôle, comme si vous leur expliquiez quelque chose d’intéressant.',
    ],
    fault: ['Ces erreurs partent toutes du besoin de se rassurer. Apprendre par cœur semble plus sûr, mais le moindre oubli fait tout tomber. Une question très large paraît plus facile à remplir, mais elle se transforme vite en récitation de cours. Préférez un plan simple et trois idées que vous savez raconter : si vous perdez une phrase, vous retrouverez toujours la suivante.'],
    cases: ['Quand une question du jury vous échappe, dites-le simplement : « je n’ai pas étudié ce point précisément, mais voici comment je le relierais à ce que je sais ». C’est une très bonne réponse. Le jury évalue votre raisonnement, pas votre mémoire. Si le stress vous empêche de dormir ou de travailler pendant plusieurs jours, parlez-en à un adulte de confiance, à l’infirmière ou à un professeur.'],
    plan: ['À la fin de chaque semaine, refaites votre présentation entière devant une personne, et demandez-lui une seule chose à améliorer. Une remarque à la fois suffit. La dernière semaine, réécoutez l’enregistrement du premier jour : vous mesurerez le chemin parcouru. La veille, faites une dernière répétition courte, préparez votre tenue et votre convocation, puis faites autre chose.'],
  },
  reparer: {
    rail: [
      'Un meuble ancien a souvent déjà été réparé : regardez comment, avant de refaire.',
      'Photographiez le meuble sous tous les angles avant de démonter : ces images servent au remontage.',
      'Protégez le sol avec un vieux drap : la colle et la sciure vont partout.',
      'Avant de poncer une vieille peinture, portez un masque : on ne sait pas toujours ce qu’elle contient.',
      'Quand une réparation résiste, laissez-la une nuit : la colle et le bois se règlent rarement dans l’impatience.',
      'Laissez le meuble reposer dans la pièce où il vivra avant de peindre : le bois s’y stabilise.',
    ],
    spare: [
      'Avant de commencer, faites un essai de chaque produit sur une zone cachée : le dessous du plateau, l’arrière d’un tiroir. Vous verrez comment la pâte à bois prend, comment la colle réagit sur ce vieux bois, et combien de temps tout cela met à sécher dans votre pièce. Cet essai de cinq minutes évite une mauvaise surprise sur la face visible.',
      'Préparez votre poste de travail avant de commencer : une bâche, une bonne lampe, de quoi caler le meuble, les outils à portée de main. Travailler à hauteur évite de mal doser un geste. Quelques tréteaux ou une vieille table suffisent, et votre dos vous remerciera dès le deuxième soir.',
      'Photographiez le meuble avant de démonter quoi que ce soit, puis à chaque étape. Ces photos vous diront comment remonter une charnière, où allait une cale, dans quel sens tenait un tiroir. Numérotez les pièces au crayon sous les tiroirs et à l’arrière des portes : ce détail évite les mauvaises surprises au remontage.',
      'Achetez juste ce qu’il faut pour ce meuble, en petites quantités. Un pot de colle à bois, un peu de pâte à bois de la bonne teinte, quelques vis adaptées : un petit panier suffit. Conservez les produits fermés et notés dans un coin : ils serviront pour le prochain meuble ou pour une retouche.',
    ],
    start: {
      title: 'L’état réel de votre meuble',
      intro: 'Un meuble se juge à l’envers, tiroirs sortis et lumière en main. Ce quart d’heure décide de ce que vous ferez pendant trois soirs.',
      look: [
        'Videz le meuble, sortez les tiroirs, retournez-le si vous pouvez. Secouez-le doucement par le haut et regardez ce qui bouge : un pied, un assemblage, un montant. Puis passez la main partout. Une zone qui accroche, un placage qui sonne creux, une colle qui s’effrite : notez tout zone par zone sur votre fiche. Ce relevé évite de découvrir un défaut quand la peinture est déjà posée.',
        'Cherchez ensuite ce qui pourrait vous arrêter. De petits trous ronds avec de la sciure fraîche signalent des insectes, à traiter avant toute chose. Une odeur de moisi ou une tache noire parlent d’humidité. Un bois qui s’effrite sous l’ongle a perdu sa résistance. Ces cas ne se règlent pas avec de la pâte à bois : ils méritent un traitement adapté ou l’avis d’un artisan.',
        'Décidez enfin de ce qui se répare et de ce qui se garde. Un meuble ancien a le droit d’avoir vécu : une rayure légère disparaît sous la peinture, alors qu’un pied bancal se verra chaque jour. Classez vos défauts en trois lignes : ce qui touche à la solidité, ce qui se verra, ce qui peut rester. Vous traiterez dans cet ordre, sans y passer une semaine.',
      ],
    },
    examples: [
      'Julien retourne le buffet de sa grand-mère : le pied arrière gauche bouge, deux tiroirs frottent et le placage se soulève sur 10 cm. Il garde les rayures du plateau, qui passeront sous la peinture, et commence par le pied.',
    ],
    angle: ['Un meuble ancien bouge. Le bois travaille avec les saisons et les assemblages d’origine ont été pensés pour accompagner ce mouvement. Si vous bloquez tout avec une colle très rigide, l’effort se reporte ailleurs et le meuble se fend plus tard. C’est pourquoi la réparation part de la structure et respecte ce qui existe : on resserre, on recolle avec une colle adaptée, on garde les pièces d’origine dès que c’est possible.'],
    gear: [
      'Respectez les temps de séchage, même si le soir suivant paraît loin. Une colle à bois a besoin d’un serrage et de plusieurs heures pour tenir. Une pâte à bois appliquée trop épaisse se rétracte et se fissure. Travaillez par petites couches et laissez chaque soir faire son travail. C’est pour cela que ce guide se déroule sur trois soirs plutôt qu’en un seul week-end pressé.',
      'Protégez aussi ce que vous ne réparez pas. Des serre-joints mal placés marquent le bois : glissez une cale de chute entre les mâchoires et le meuble. Essuyez la colle qui déborde avec un chiffon humide avant qu’elle ne sèche, car une trace de colle refuse ensuite la teinte et se voit sous la peinture. Rangez les vis et les ferrures dans une boîte, tiroir par tiroir.',
    ],
    fault: ['Ces erreurs viennent de l’impatience de voir la couleur. On a acheté la peinture, on a envie de commencer, et l’on se dit qu’une couche cachera tout. Elle fait le contraire : un pied bancal le reste, et un éclat mal rebouché ressort sous la lumière. Rappelez-vous la règle de ce guide : d’abord solide, ensuite propre, enfin beau.'],
    cases: ['Quand une réparation vous dépasse, arrêtez-vous avant d’aggraver le problème. Un assemblage cassé, une pièce sculptée fendue, un meuble de valeur méritent l’avis d’un ébéniste : demandez un devis pour cette seule pièce, et faites le reste vous-même. Si vous doutez d’un ancien vernis ou d’une vieille peinture, protégez-vous avant de poncer : une peinture très ancienne peut contenir du plomb.'],
    plan: ['À la fin du troisième soir, faites le test de contrôle : posez le meuble sur un sol plat, ouvrez chaque tiroir, chaque porte, appuyez sur le plateau, et passez une lampe en lumière rasante. Tout ce qui ne vous convient pas se reprend maintenant, pas après la peinture. Laissez ensuite le meuble reposer une journée complète avant la première couche, dans la pièce où vous allez peindre.'],
  },
};

const depthOf = (c: NicheCtx): TopicDepth | null => (c.topic ? TOPIC_DEPTH[c.topic.id] ?? null : null);

/** The reserve of a sub-problem, first in line for the floor: the fillers of its family are the last resort. */
export const topicFillers = (c: NicheCtx): Para[] => (depthOf(c)?.spare ?? []).map((p) => () => p);

/** The worked cases written for a sub-problem: a chapter of the follow-up gets one when the research runs out. */
export const topicExamples = (c: NicheCtx): readonly string[] => depthOf(c)?.examples ?? [];

/** The notes written for the rail of a sub-problem. */
export const topicNotes = (c: NicheCtx): readonly string[] => depthOf(c)?.rail ?? [];

/** The paragraphs of one list of a sub-problem, for the paragraph bank of its chapter. */
const deep = (pick: (t: TopicDepth) => readonly string[] | undefined): Para[] => [0, 1, 2].map((k) => (d) => { const t = depthOf(d.c); return (t && pick(t)?.[k]) ?? null; });

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
    short: { 5: ['angle', 'reglages', 'ecueils', 'resistances', 'mini-plan'], 6: ['angle', 'point-de-depart', 'reglages', 'ecueils', 'resistances', 'mini-plan'] },
    howTo: () => s.howTo,
    promise: (c, o) => `un plan ciblé de ${D(c)} pour arriver à ceci : ${o}`,
    subtitle: (c) => `Le guide ciblé pour ${c.audArt}`,
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
        paras: [(d) => d.facts(2) || null, (d) => d.facts(2) || null, (d) => d.facts(2) || null, ...deep((t) => t.angle), (d) => v(d.c, ...s.calm)],
        steps: () => ['Noter à quel moment ce sujet vous pose le plus de difficultés', 'Entourer dans ce chapitre ce qui vous surprend', 'Décider du jour où vous commencez'],
        checks: () => ['Je comprends pourquoi ce sujet résiste', 'Je sais à quel moment il se pose', 'Ma date de départ est fixée'],
      },
      {
        kind: 'point-de-depart', role: 'diagnostic',
        title: (c) => depthOf(c)?.start.title ?? 'Votre point de départ',
        intro: (c) => `${depthOf(c)?.start.intro ?? 'Avant de changer quoi que ce soit, il faut voir où vous en êtes.'} Ce chapitre aide ${c.audCore} à partir de leur situation réelle.`,
        paras: [lookFor, ...deep((t) => t.start.look)],
        steps: () => ['Lire ce chapitre en entier, crayon en main', 'Remplir la fiche de ce chapitre', 'Choisir le premier point à traiter'],
        checks: () => ['Mon point de départ est noté', 'La fiche est remplie', 'Je sais par quoi je commence'],
      },
      {
        kind: 'reglages', role: 'methode',
        title: (_c, n) => s.gearTitle(n),
        intro: (c) => `${v(c, ...s.gear)} Tout est écrit pour ${c.audCore}.`,
        paras: [...deep((t) => t.gear), modelPara],
      },
      {
        kind: 'ecueils', role: 'erreurs',
        title: (_c, n) => s.faultTitle(n),
        intro: (c) => `${s.fault} Voici ce que ${c.audCore} rencontrent le plus.`,
        paras: deep((t) => t.fault),
        steps: () => ['Repérer ce qui vous concerne dans cette liste', 'Appliquer la correction dès aujourd’hui', 'Noter la date du changement'],
      },
      {
        kind: 'resistances', role: 'situations',
        title: (_c, n) => s.caseTitle(n),
        intro: (c) => `${s.cases} Ces réponses sont pensées pour ${c.audCore}.`,
        paras: deep((t) => t.cases),
        steps: () => ['Repérer le cas qui vous concerne', 'Appliquer la réponse de ce chapitre', 'Reprendre le plan à la ligne suivante'],
      },
      {
        kind: 'mini-plan', role: 'programme',
        title: (c) => `Votre plan ciblé de ${D(c)}, étape par étape`,
        intro: (c) => `${s.plan} Objectif, sur ${D(c)} : ${lf(c.goal ?? c.pbClause)}.`,
        paras: [(d) => v(d.c, ...s.planRead), modelPara, keepUp, ...deep((t) => t.plan), () => s.planEnd],
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
  if (count >= 7 && def.id !== 'suite') return def.chapters;
  const kinds = count === 6 ? def.short[6] : def.short[5];
  return kinds.map((k) => def.chapters.find((c) => c.kind === k)!).filter(Boolean);
}

/** Reads a step without its final dot as a bullet item. */
export const asStep = (s: string): string => sentence(bare(s));
