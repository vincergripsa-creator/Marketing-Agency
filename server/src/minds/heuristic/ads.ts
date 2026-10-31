/**
 * Growth: TikTok hooks (one per style, ≤ 90 chars), full ad scripts (4-6 scenes, 12-30 s), one-frame pins, Search ads and
 * creator outreach DMs. Without a learned rule, hype-ish styles sometimes slip a risky word —
 * that is how the agency gets ads rejected, and learns.
 * An ad never carries the price (it changes, the ad stays) and never shows a named person with a result:
 * the only social proof it may use is a review a buyer really left on the product.
 * Talent (talent §4.2) acts through `t` and `flaw`: absent, this file writes today's text, draw for draw.
 */
import type { AdFormat, AdScene, CreatorProfile, HookStyle, Product, Review, VoiceOfCustomer } from '../../shared.js';
import type { AdDraft, SearchAdDraft, UpsellContext } from '../../contracts.js';
import { NAMED_CASE, RISK_RULES, RISKY_AD_PHRASES } from '../lexicon.js';
import { AD_FORMATS, conflictsWith, containsBanned, HOOK_STYLES } from '../playbook.js';
import { bare, bestLabel, cap, clauseLabel, clean, fit, fmtEur, fmtNum, fmtPct, labelOf, lf, lowerFirst, norm, ofAud, plainTitle, q, theUnit, uniqStrings, withArticle, type LocalRng } from '../util.js';
import { nicheFromProduct } from './commerce.js';
import { buildNicheCtx, de, FALLBACK, isInfinitive, looksLikeClause, type NicheCtx } from './niche.js';
import { inline } from './studio.js';

const HOOK_MAX = 90;
const SCREEN_MAX = 50;
const STATIC_HOOK_MAX = 60;
const HEADLINE_MAX = 30;
const DESCRIPTION_MAX = 90;
const MIN_NAMED_HOOKS = 3;

/** Whole customer phrases (never cut): ≤ max chars, no inner colon. */
function shortPhrases(c: NicheCtx, max = 40): string[] {
  return c.phrases.map(clean).filter((x) => bare(x).length >= 6 && bare(x).length <= max && !/[:;]/.test(bare(x)));
}

const isQuestion = (p: string | undefined): boolean => !!p && /\?\s*$/.test(p);

/** « … » keeping the customer's question mark inside the quotes. */
function qKeep(p: string): string {
  return isQuestion(p) ? `« ${bare(p)} ? »` : q(p);
}

function audWord(c: NicheCtx): string {
  const w = lf(c.niche.audience).split(/\s+/)[0] ?? 'gens';
  return /[sx]$/.test(w) ? w : 'gens';
}

/** « presque tous les parents », « presque toutes les femmes ». */
function everyone(c: NicheCtx): string {
  const w = audWord(c);
  return /^(femmes|mamans|mères|personnes|lycéennes|étudiantes)$/i.test(w) ? `toutes les ${w}` : `tous les ${w}`;
}

/** « faire sa déclaration » said to « tu »: the possessives follow. */
const toTu = (s: string): string => s.replace(/(^|\s)sa\s/g, '$1ta ').replace(/(^|\s)son\s/g, '$1ton ').replace(/(^|\s)ses\s/g, '$1tes ');

/** The same for a mistake, where the possessive may be someone else's: in « forcer bébé à finir son assiette », the plate is the baby's. */
const toTuMistake = (m: string): string => (/\b(?:bebe|chiot|chat|enfants?|patient|personne|client)\b/.test(norm(m)) ? m : toTu(m)).replace(/\bvotre\b/g, 'ton').replace(/\bvos\b/g, 'tes');

/** A reflexive outcome (« s’endormir seul ») belongs to someone else: no POV for it. */
function povOutcome(desired: string): string {
  const d = lowerFirst(desired);
  if (/^savoir\s/i.test(d)) return `POV : tu sais enfin ${toTu(d.replace(/^savoir\s+/i, ''))}.`;
  if (isInfinitive(d)) return /^(s['’]|se\s)/i.test(d) ? '' : `POV : tu as enfin réussi à ${toTu(d)}.`;
  return `POV : ${d}, et tu n’y croyais plus.`;
}

const HAS_DURATION = /\b(\d+|quelques|deux|trois)\s+(jours?|nuits?|semaines?|mois|minutes?|heures?)\b/i;

/** The gift of this guide, named as in the guide itself (null while it has none). */
function bonusOf(p: Product | null | undefined): string | null {
  return bare(clean(p?.content?.bonus?.title).replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '')) || null;
}

/** What follows a cut and made it true: « lancer une nouvelle étape | pendant une maladie ». */
const LIMIT_AFTER = /^\s*(?:avant|pendant|apres|des|depuis|tant|tard|trop|sans|juste|a chaque|tous les)\b/;

/** A sentence said in few words: whole when it fits, else its head, unless what is left out is what makes it true. */
function told(m: string, max: number): string | null {
  const t = bare(m);
  if (t.length <= max) return cap(t);
  const head = clauseLabel(m, max, { min: 8, tiers: 1 });
  return head && !LIMIT_AFTER.test(norm(t).slice(norm(head).length)) ? head : null;
}

const stoppable = (m: string): boolean => isInfinitive(m) && !/^(ne|n['’])/i.test(m);

/** What the pack already tells every buyer is no discovery: never « ce que personne ne te dit ». */
const COMMON_KNOWLEDGE = /sur (?:le|chaque) pot\b|sur l['’]emballage|sur la notice/i;

/** Each variable of a hook comes from the guide or its research: one sentence is never shared by two audiences. */
function hookCandidates(style: HookStyle, c: NicheCtx, rng: LocalRng, bonus: string | null): string[] {
  const ph = rng.shuffle(shortPhrases(c));
  const says = ph.filter((p) => !isQuestion(p)).slice(0, 5);
  // an outcome is quoted whole or not at all: « Après 60 jours de plan : un profil » promises nothing. A follow-up only promises its own.
  const outcomes = uniqStrings([c.goal, ...(c.upsellOf ? [] : c.outcomes)].map((o) => bare(o ?? ''))).filter((o) => o.length >= 8 && o.length <= 50);
  const desired = outcomes[0] ?? (c.upsellOf ? '' : FALLBACK.outcomes[0]);
  const desiredL = lowerFirst(desired);
  const sayable = uniqStrings(rng.shuffle([...c.mistakes.filter(isInfinitive), ...c.mistakes]).map((m) => told(m, 48)).filter((m): m is string => !!m && !/\bvous\b/i.test(m)));
  const mistakes = uniqStrings([...sayable.filter((m) => c.mistakes.some((x) => bare(x) === m)), ...sayable]).slice(0, 5).map(toTuMistake);
  if (!mistakes.length) mistakes.push(bestLabel(FALLBACK.mistakes, 48, 8)!);
  // « arrêtez de ne pas déclarer » : a negative mistake cannot follow « arrête de »
  const toStop = mistakes.filter(stoppable);
  const pairs = rng.shuffle(c.pairs).filter((p) => p.fix).map((p) => ({ m: told(p.mistake, 34), f: told(p.fix!, 34) }))
    .filter((p): p is { m: string; f: string } => !!p.m && !!p.f).slice(0, 3).map((p) => ({ m: toTuMistake(p.m), f: toTuMistake(p.f) }));
  // a pain usable after « pourquoi / quand / si » must be a whole subject + verb clause
  const pb = c.pbShort && looksLikeClause(c.pbShort) ? lf(c.pbShort) : null;
  const pbQ = c.pbShort && c.pbShort.length <= 48 ? q(c.pbShort) : null;
  const { n, unit, unitOne } = c.dur;
  const k = Math.min(5, Math.max(3, c.mistakes.length || 3));
  const facts = c.facts.map(bare).filter((f) => /\d/.test(f) && f.length <= 80 && !/[:;]/.test(f) && !NAMED_CASE.test(f) && !COMMON_KNOWLEDGE.test(f)).slice(0, 3);
  const afters = outcomes.filter((o) => o.length <= 40 && !HAS_DURATION.test(o)).slice(0, 2);
  const step = bestLabel(rng.shuffle(c.method.map((m) => m.text)), 48, 8);
  const timeless = !!desiredL && !HAS_DURATION.test(desiredL);
  switch (style) {
    case 'question': return [
      ...ph.slice(0, 4).map((p) => (isQuestion(p) ? `${cap(qKeep(p))} Voilà ce que personne ne te dit.` : `Tu te dis ${q(p)} ? Regarde ça avant ce soir.`)),
      ...says.slice(0, 2).map((p) => `${cap(q(p))} : voilà ce que personne ne te dit.`),
      pb ? `Pourquoi ${pb} ? La vraie raison va te surprendre.` : '',
      pb ? `Pourquoi ${pb} ? Voici la vraie raison.` : '',
      ...toStop.slice(0, 2).map((m) => `Et si tout venait de là : ${lowerFirst(m)} ?`),
      ...outcomes.slice(0, 2).map((o) => `Tu veux ${toTu(lowerFirst(o))} ? Commence par ça.`),
    ];
    case 'contrarian': return [
      ...toStop.map((m) => `Arrête ${de(m)}. C’est ça qui entretient tout.`),
      ...pairs.filter((p) => stoppable(p.m)).map((p) => `Arrête ${de(p.m)}. Fais plutôt ça : ${lowerFirst(p.f)}.`),
      pbQ ? `${cap(pbQ)}, ce n’est pas une fatalité. Vraiment pas.` : '',
      step ? `Oublie les astuces. Commence par ça : ${lowerFirst(step)}.` : '',
      'Le conseil qu’on te répète partout ? C’est lui qui aggrave tout.',
    ];
    case 'story': return [
      ...says.map((p) => `Un commentaire nous a marqués : ${q(p)}. Voilà ce qu’on a répondu.`),
      ...says.map((p) => `Cette phrase revient dans les commentaires : ${q(p)}. Écoute la suite.`),
      ...says.slice(0, 3).map((p) => `Tout est parti d’une phrase lue en commentaire : ${q(p)}.`),
      c.pbShort ? `On a écrit ce guide à cause d’une galère : ${lowerFirst(c.pbShort)}.` : '',
      ...mistakes.slice(0, 3).map((m) => `Au début, tout le monde fait la même erreur : ${lowerFirst(m)}.`),
      step ? `Le déclic vient souvent d’un geste simple : ${lowerFirst(step)}.` : '',
      `On a épluché les commentaires ${ofAud(c.audCore)}. Une phrase revient tout le temps.`,
    ];
    case 'stat': return [
      ...facts.map((f) => `${cap(f)}. Et personne ne te le dit.`),
      `${n} ${unit}, ${c.stepCount} étapes, zéro prise de tête : la méthode ${c.adj}.`,
      `1 erreur, ${n} ${unit}, 1 plan : voilà comment on s’en sort.`,
      timeless ? `${c.stepCount} étapes, ${n} ${unit} : ${desiredL}.` : '',
      `${c.pairs.length} erreurs à éviter, ${c.stepCount} étapes à suivre, ${n} ${unit} de plan.`,
    ];
    case 'pov': return [
      ...ph.slice(0, 4).map((p) => `POV : tu tapes ${q(p)} sur Google pour la 10e fois.`),
      desired ? povOutcome(desired) : '',
      pb ? `POV : tu découvres enfin pourquoi ${pb}.` : 'POV : tu comprends enfin pourquoi ça bloque.',
      ...toStop.slice(0, 3).map((m) => `POV : tu arrêtes enfin ${de(m)}.`),
      `POV : ${theUnit(unitOne)} ${n} du plan, et tu coches la dernière case.`,
    ];
    case 'mistake': return [
      ...mistakes.map((m) => `L’erreur que font presque ${everyone(c)} : ${lowerFirst(m)}.`),
      ...mistakes.slice(0, 3).map((m) => `Si tu fais ça, arrête tout de suite : ${lowerFirst(m)}.`),
      ...mistakes.slice(0, 3).map((m) => `${cap(lowerFirst(m))} ? C’est l’erreur qui bloque tout.`),
      pb ? `L’erreur n°1 quand ${pb} (et comment l’éviter).` : pbQ ? `L’erreur n°1 derrière ${pbQ} (et comment l’éviter).` : '',
      ...pairs.map((p) => `Erreur : ${lowerFirst(p.m)}. À la place : ${lowerFirst(p.f)}.`),
    ];
    case 'before_after': return [
      ...says.filter((p) => bare(p).length <= 32).flatMap((p) => afters.map((a) => `Avant : ${q(p)}. Après ${n} ${unit} : ${lowerFirst(a)}.`)),
      ...afters.map((a) => `Avant : ${c.care ? 'l’épuisement' : 'le stress'}. Après ${n} ${unit} de plan : ${lowerFirst(a)}.`),
      ...pairs.map((p) => `Avant : ${lowerFirst(p.m)}. Après : ${lowerFirst(p.f)}.`),
      `Ce qui a changé entre ${theUnit(unitOne)} 1 et ${theUnit(unitOne)} ${n}.`,
    ];
    case 'listicle': return [
      pb ? `${k} choses à arrêter si ${pb}.` : pbQ ? `${cap(pbQ)} : ${k} choses à arrêter dès ce soir.` : '',
      `${k} gestes simples qui changent tout (surtout le 2e).`,
      pbQ ? `${k} erreurs qui entretiennent ${pbQ}.` : '',
      `${k} erreurs que font presque ${everyone(c)}.`,
      timeless ? `${c.stepCount} étapes pour ${desiredL}.` : '',
      `${c.stepCount} étapes, ${n} ${unit} de plan, et ${bonus ? lf(bonus) : 'une checklist par chapitre'}.`,
    ];
  }
}

/** Words of the problem / audience a viewer must recognise in the first 2 seconds. */
function relevance(hook: string, c: NicheCtx): number {
  const key = new Set(norm(`${c.niche.problem} ${c.niche.audience} ${c.pbClause}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 5));
  return norm(hook).split(/[^a-z0-9]+/).filter((w) => key.has(w)).length;
}

export function makeHook(style: HookStyle, c: NicheCtx, rng: LocalRng, bonus: string | null = null, used: ReadonlySet<string> = new Set(), t?: number): string {
  const every = rng.shuffle(uniqStrings(hookCandidates(style, c, rng, bonus)).filter((x) => x.length <= HOOK_MAX));
  // a hook this product already said comes back only when nothing else is left
  const fresh = every.filter((h) => !used.has(h));
  const fitting = fresh.length ? fresh : every;
  // never a hook cut with « … »: a short generic hook of the same style instead
  if (!fitting.length) return SAFE_HOOKS[style];
  // most of the time the writer picks among the hooks that best name the problem or the audience, not always the same one;
  // one or two named hooks are not a choice, they would take most of the draws
  const named = fitting.map((h) => ({ h, r: relevance(h, c) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r);
  if (named.length < MIN_NAMED_HOOKS) return fitting[0]!;
  const best = named.slice(0, Math.max(MIN_NAMED_HOOKS, Math.ceil(named.length / 2)));
  return rng.chance(t === undefined ? 0.7 : 0.35 + 0.6 * t) ? rng.pick(best).h : fitting[0]!;
}

/** Short hooks (≤ 90 chars) used only when every niche-specific candidate is too long. */
const SAFE_HOOKS: Record<HookStyle, string> = {
  question: 'Tu as l’impression d’avoir tout essayé ? Regarde ça avant ce soir.',
  contrarian: 'Le conseil qu’on te répète partout ? C’est lui qui aggrave tout.',
  story: 'On a épluché les commentaires sur ce sujet. Une phrase revient tout le temps.',
  stat: '1 erreur, 1 plan, quelques minutes par jour : voilà comment on s’en sort.',
  pov: 'POV : tu comprends enfin pourquoi ça bloque.',
  mistake: 'L’erreur que presque tout le monde fait (et comment l’éviter).',
  before_after: 'Avant / après : ce qui change quand on suit un vrai plan.',
  listicle: '3 gestes simples qui changent tout (surtout le 2e).',
};

export function heuristicHooks(
  input: { product: Product; voc: VoiceOfCustomer; styles: HookStyle[]; upsellOf?: UpsellContext | null; usedHooks?: string[] },
  rng: LocalRng,
  preferred: HookStyle[],
  t?: number,
): { hookStyle: HookStyle; hook: string }[] {
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc, input.upsellOf ?? null);
  const asked = (input.styles ?? []).filter((s) => HOOK_STYLES.includes(s));
  const styles = uniqStrings([...preferred, ...(asked.length ? asked : ['question', 'mistake', 'pov'])]) as HookStyle[];
  const bonus = bonusOf(input.product);
  const used = new Set(input.usedHooks ?? []);
  return styles.map((s) => {
    const hook = makeHook(s, c, rng, bonus, used, t);
    used.add(hook);
    return { hookStyle: s, hook };
  });
}

const VISUALS: Record<AdFormat, string[]> = {
  faceless_voiceover: [
    'Fond sombre animé, l’accroche claque mot par mot au centre',
    'Plaque claire, les mots des clients en bulles de commentaires',
    'Vraie page du guide, zoom sur la ligne surlignée au marqueur',
    'Vraie page du guide, deuxième repère surligné au marqueur',
    'Pages du guide en éventail derrière le livre, sticker du bonus',
    'Couverture du guide en plein écran, flèche vers la bio',
  ],
  text_slideshow: [
    'Fond uni à la couleur de la marque, texte noir très gros',
    'Slide 2 : la phrase client entre guillemets, fond clair',
    'Slide 3 : étape 1 en grand, numéro en couleur',
    'Slide 4 : repère ou avis d’acheteur, une seule ligne',
    'Slide 5 : aperçu du bonus offert',
    'Slide finale : couverture du guide + « lien en bio »',
  ],
  ugc_avatar: [
    'Narrateur illustré en carte, regard direct, accroche à côté de lui',
    'Narrateur illustré qui soupire, sous-titres dynamiques',
    'Narrateur illustré, une vraie page du guide en incrustation',
    'Vraie page du guide, zoom sur la ligne surlignée au marqueur',
    'Pages du guide en éventail derrière le livre, sticker du bonus',
    'Couverture du guide, le narrateur pointe : « lien en bio »',
  ],
  carousel: [
    'Carte 1 : accroche en gros sur fond clair',
    'Carte 2 : la phrase qu’on lit partout, en citation',
    'Carte 3 : étape 1 illustrée par une icône',
    'Carte 4 : repère ou avis d’acheteur en deux lignes',
    'Carte 5 : le bonus offert',
    'Carte finale : couverture du guide + appel à l’action',
  ],
  static_image: ['Image unique : accroche en gros, couverture du guide, appel à l’action'],
  search_text: [], // text only, no scene
};

/** Customer quotes hidden behind a filler of the same length: their punctuation is not the sentence's. */
const maskQuotes = (t: string): string => t.replace(/«[^»]*»/g, (m) => '_'.repeat(m.length));

function firstSentence(t: string): string {
  const end = /(?:[.!?]|_)\s+(?=\p{Lu})/u.exec(maskQuotes(t));
  return end ? t.slice(0, end.index + 1) : t;
}

/** A phrase of the hook with its colon: the part after it is what the viewer came for. */
function colonParts(t: string): { head: string; tail: string } | null {
  const i = maskQuotes(t).search(/\s*:\s/);
  if (i <= 0) return null;
  const tail = firstSentence(t.slice(i).replace(/^\s*:\s*/, '')).replace(/[\s.,;!]+$/, '');
  return tail ? { head: t.slice(0, i), tail } : null;
}

/**
 * What stands for a long head on screen. A mistake alone would read as an instruction
 * (« Rentrer dès qu’il a fait »): it keeps a word that says it is one.
 */
function screenHead(head: string): string {
  if (/\berreurs?\b/i.test(head)) return 'L’erreur';
  if (/\b(?:arrête|arrêtez|stop|évite|évitez|ne fais pas)\b/i.test(head)) return 'Stop';
  return head.length <= 14 ? head : '';
}

function withPayoff(head: string, tail: string): string | null {
  const room = SCREEN_MAX - (head ? head.length + 3 : 0);
  const body = tail.length <= room ? tail : clauseLabel(tail, room, 8);
  if (!body) return null;
  return head ? `${head} : ${lowerFirst(body)}` : body.startsWith('«') ? body : cap(body);
}

/** « Avant : … Après 14 jours : le résultat » and « Head : le point » keep the end of the sentence, the part that pays off. */
function screenPayoff(t: string): string | null {
  const after = /^avant\s*:.*\bapr[eè]s\b\s*(.*?)\s*:\s*(.+)$/iu.exec(t);
  if (after) {
    const when = `Après ${after[1]!.replace(/\s+de plan$/i, '')}`.trim();
    return withPayoff(when, after[2]!.replace(/[\s.,;!]+$/, '')) ?? withPayoff('', after[2]!.replace(/[\s.,;!]+$/, ''));
  }
  const parts = colonParts(t);
  if (!parts) return null;
  // « Je perds mes moyens » : … the customer's words are the hook, what follows only introduces the answer
  if (/^«.*»$/.test(parts.head) && parts.head.length <= SCREEN_MAX) return parts.head;
  return withPayoff(screenHead(parts.head), parts.tail);
}

/** On-screen text ≤ 50 chars, and never a lead-in without its payoff: the first clause, TikTok-style compaction, then a clean cut. */
export function screenText(s: string): string {
  const t = clean(s).replace(/[\s:]+$/, '');
  if (t.length <= SCREEN_MAX) return t;
  const compact = t
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bheures?\b/g, 'h')
    .replace(/\bminutes?\b/g, 'min')
    .replace(/\bkilos?\b/g, 'kg')
    .replace(/\s+(vraiment|simplement|enfin|toujours)\b/g, '')
    .replace(/:\s+voilà (?:comment )?/i, ': ')
    .replace(/\s{2,}/g, ' ');
  if (compact.length <= SCREEN_MAX) return compact;
  // « Arrête de sortir les plants de tomates avant mi-mai. » : cut short, the ban would cover the whole season
  const stop = /^arrête\s+d(?:e\s+|['’])(.+?)[.!]/iu.exec(compact);
  if (stop && stop[1]!.length + 7 <= SCREEN_MAX) return `Stop : ${stop[1]}`;
  const payoff = screenPayoff(compact);
  if (payoff) return payoff;
  const head = firstSentence(compact);
  const base = head.length >= 12 ? head : compact;
  if (base.length <= SCREEN_MAX) return base;
  // « Tu veux un chien calme ? » : the wish alone reads better than half of the question
  const wish = /^tu veux\s+(.+?)\s*\?$/iu.exec(base);
  if (wish && wish[1]!.length <= SCREEN_MAX) return cap(wish[1]!);
  const noTail = base.replace(/\s+(la nuit|le soir|le matin|au quotidien|tous les jours)(\s*[?!.])?$/i, '$2');
  if (noTail.length <= SCREEN_MAX) return noTail;
  // never an ellipsis on screen: a whole head (« POV : tu découvres enfin pourquoi… » → its clean head)
  const quoted = /«\s*([^»]+?)\s*»/.exec(base);
  const asks = /\?$/.test(base);
  const label = clauseLabel(base, asks ? SCREEN_MAX - 2 : SCREEN_MAX, 10);
  if (label) return asks ? `${label} ?` : label;
  return quoted && quoted[1]!.length + 4 <= SCREEN_MAX ? `« ${quoted[1]} »` : labelOf(base, SCREEN_MAX);
}

/** « Guide PDF 24 € — lien en bio » → « Guide PDF — lien en bio »: the shop shows the price of the day, an ad cannot. */
export function noPrice(s: string, price: number | null | undefined): string {
  const t = s.replace(/\b(guide(?:\s+pdf)?|pdf)\s+(?:à\s+)?\d+(?:[.,]\d+)?\s*(?:€|euros?)(?![\p{L}])/giu, '$1');
  if (!price || !(price > 0)) return t;
  const amount = Number.isInteger(price) ? `${price}(?:[.,]0+)?` : `${String(price).replace('.', '[.,]')}0*`;
  const re = new RegExp(`(?:\\s*[—–-]\\s*|\\s+(?:à|pour|seulement)\\s+)?(?<![\\d.,])${amount}\\s*(?:€|euros?)(?![\\p{L}])`, 'giu');
  return t.replace(re, '').replace(/\s{2,}/g, ' ').trim();
}

function hashtagify(s: string): string {
  return `#${norm(s).replace(/[^a-z0-9]/g, '')}`;
}

function hashtags(c: NicheCtx, rng: LocalRng): string[] {
  const k = norm([c.niche.name, c.niche.audience, c.niche.problem, ...c.niche.keywords].join(' '));
  const themed: string[] = [];
  if (/bebe|nourrisson/.test(k)) themed.push('#bebe', '#parentalite', '#mamanfatiguee');
  if (/sommeil|dormir|nuit/.test(k)) themed.push('#sommeil');
  if (/chien|chiot/.test(k)) themed.push('#chien', '#educationcanine');
  if (/argent|budget|epargne/.test(k)) themed.push('#budget', '#financesperso');
  if (/sport|ventre|poids|muscu/.test(k)) themed.push('#fitness', '#motivation');
  const kw = c.niche.keywords.slice(0, 3).map(hashtagify).filter((h) => h.length > 3 && h.length <= 26);
  const base = ['#astuce', '#conseil', '#pourtoi', '#guidepdf'];
  const tags = uniqStrings([...kw, ...themed, ...rng.shuffle(base)]).slice(0, 6);
  return tags.length >= 4 ? tags : uniqStrings([...tags, ...base]).slice(0, 4);
}

function riskyLine(phrase: string, c: NicheCtx): { vo: string; screen: string } {
  const { n, unit } = c.dur;
  switch (phrase) {
    case 'garanti': return { vo: `Résultat garanti en ${n} ${unit}, même si tu as tout essayé.`, screen: `Résultat garanti en ${n} ${unit}` };
    case '100 %': return { vo: 'Une méthode efficace à 100 %, testée et approuvée.', screen: 'Efficace à 100 %' };
    case 'à coup sûr': return { vo: 'Suis le plan et ça marche à coup sûr.', screen: 'Ça marche à coup sûr' };
    default: return { vo: 'Des résultats visibles en 3 jours seulement.', screen: 'Résultats en 3 jours seulement' };
  }
}

/** A buyer's good review about the guide itself, short enough to be read out, free of any claim the platform refuses. */
function quotableReviews(p: Product | null | undefined): Review[] {
  return (p?.stats?.reviews ?? []).filter((r) => r && r.rating >= 4 && bare(r.text).length >= 12 && bare(r.text).length <= 110
    && !/support|service client/i.test(r.text) && !RISK_RULES.some((x) => x.re.test(r.text)));
}

/** Stock lines of a tired writer: each holds a cliché the scorer really counts. */
export const AD_CLICHES: readonly string[] = [
  'Chaque petit pas compte.',
  'La patience est la clé.',
  'Ça peut faire toute la différence.',
  'Alors lance-toi sans plus attendre.',
  'En fin de compte, tout se joue là.',
  'Un véritable atout au quotidien.',
];

/**
 * What a weak writer gets wrong (talent §4.2): each site changes the text, the scorer does the rest. A4 and A5 fire half
 * as often and block, so the reviewer sends them back. Runs on the script, before the durations are clamped.
 */
function applyAdFlaws(scenes: AdScene[], draft: AdDraft, flawRng: LocalRng, f: number, c: NicheCtx): void {
  const [lostWords, cliche, longScreen, noHook, weakCta] = [f, f, f, f / 2, f / 2].map((p) => flawRng.chance(p));
  const middle = scenes[flawRng.int(1, scenes.length - 2)]!;
  const line = flawRng.pick(AD_CLICHES);
  // A1: the customer's words give way to a line that fits any guide
  if (lostWords) Object.assign(scenes[1]!, { onScreenText: 'Tu te reconnais ?', voiceover: 'Si toi aussi tu en as assez, reste deux secondes.' });
  if (cliche) middle.voiceover = `${middle.voiceover} ${line}`; // A2
  // A3: the step goes on screen whole
  if (longScreen) scenes[2]!.onScreenText = `1. ${bare(c.steps[0] ?? FALLBACK.steps[0])}, puis ${lowerFirst(bare(c.steps[1] ?? FALLBACK.steps[1]))}, une étape à la fois, sans sauter la suivante`;
  // A4: the first screen forgets the hook
  if (noHook) Object.assign(scenes[0]!, { onScreenText: 'Deux secondes de ton temps', voiceover: 'Deux secondes de ton temps, pas plus.' });
  // A5: the ad ends without saying where to go
  if (weakCta) {
    Object.assign(scenes[scenes.length - 1]!, { onScreenText: 'À toi de jouer', voiceover: 'À toi de jouer maintenant.' });
    draft.cta = '';
  }
}

export function heuristicAd(
  input: { product: Product; voc: VoiceOfCustomer; hook: string; hookStyle: HookStyle; format: AdFormat; bannedClaims: string[]; upsellOf?: UpsellContext | null },
  rng: LocalRng,
  rules: { banned: string[]; preferredFormats: AdFormat[]; t?: number; flaw?: number; flawRng?: LocalRng },
): AdDraft {
  // tested before AD_FORMATS, the four bandit arms: past that line a pin would turn into a TikTok format
  if (input.format === 'static_image') return heuristicStaticAd(input, rng, rules);
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc, input.upsellOf ?? null);
  const style: HookStyle = HOOK_STYLES.includes(input.hookStyle) ? input.hookStyle : 'question';
  const format: AdFormat = AD_FORMATS.includes(input.format) ? input.format : (rules.preferredFormats[0] ?? 'faceless_voiceover');
  const bonus = bonusOf(input.product);
  const hook = fit(clean(input.hook) || makeHook(style, c, rng, bonus, undefined, rules.t), HOOK_MAX);
  const vis = VISUALS[format];
  const title = plainTitle(clean(input.product?.title)) || 'le guide';
  const phrases = shortPhrases(c, 44);
  const phrase = phrases.length ? rng.pick(phrases) : '';
  const pain = c.pbClause;
  const painScreen = clauseLabel(c.pbShort ?? pain, 46) ?? 'Tu te reconnais ?';
  const step = c.steps[0] ?? FALLBACK.steps[0];
  const step2 = c.steps[1] ?? FALLBACK.steps[1];
  const fact = c.facts.find((f) => f.length <= 120 && !NAMED_CASE.test(f) && !COMMON_KNOWLEDGE.test(f));
  // on screen, a fact is whole or absent: half of a fact is another fact (« Le chiffre d’affaires se déclare mensuellement »)
  const factScreen = c.facts.map((f) => bare(f)).find((f) => f.length <= SCREEN_MAX && !/[:;]/.test(f) && !NAMED_CASE.test(f) && !COMMON_KNOWLEDGE.test(f)) ?? null;
  const stepScreen = clauseLabel(step, 46);
  const { n, unit } = c.dur;

  const scenes: AdScene[] = [];
  scenes.push({ visual: vis[0]!, onScreenText: screenText(hook), voiceover: hook, durationSec: rng.int(2, 3) });
  scenes.push({
    visual: vis[1]!,
    onScreenText: screenText(phrase ? q(phrase) : painScreen),
    voiceover: phrase ? `Si toi aussi tu te dis ${q(phrase)}, reste deux secondes.` : `${cap(pain)}… et l’impression d’avoir tout essayé.`,
    durationSec: rng.int(3, 4),
  });
  scenes.push({
    visual: vis[2]!,
    // a step on screen is a whole clause, or the screen just announces the method
    onScreenText: stepScreen ? screenText(`1. ${stepScreen}`) : 'La méthode, étape par étape',
    voiceover: `La méthode commence par un geste tout simple : ${inline(step)}. Ensuite : ${inline(step2)}. Une étape à la fois.`,
    durationSec: rng.int(4, 6),
  });
  // the proof is a buyer's real review, else a fact from the research: a fictional persona never appears in an ad
  const reviews = quotableReviews(input.product);
  const review = reviews.length ? rng.pick(reviews) : null;
  const quote = review ? q(review.text) : '';
  const proofVo = review ? `Un acheteur a écrit sur le guide : ${quote}.`
    : fact ? `Un repère à garder en tête : ${inline(factScreen ?? fact)}.` : `Le plan tient en ${n} ${unit}, avec une checklist à chaque chapitre.`;
  scenes.push({
    visual: vis[3]!,
    onScreenText: screenText(review ? (quote.length <= SCREEN_MAX ? quote : `Avis vérifié : ${review.rating}/5`) : factScreen ?? `Plan de ${n} ${unit}`),
    voiceover: proofVo,
    durationSec: rng.int(4, 5),
  });
  // the ad promises the bonus the guide really contains, under its real name
  if (rng.chance(0.6) && bonus) {
    const gift = clauseLabel(lf(bonus).replace(/\s+à imprimer$/i, ''), SCREEN_MAX - 8, { min: 12, tiers: 1 });
    scenes.push({
      visual: vis[4]!,
      onScreenText: gift ? `Bonus : ${lowerFirst(gift)}` : 'Un bonus offert dans le guide',
      voiceover: `Dans le guide : le plan de ${n} ${unit} et, en cadeau, ${lf(bonus)}.`,
      durationSec: rng.int(3, 4),
    });
  }
  scenes.push({
    visual: vis[5]!,
    onScreenText: 'Guide PDF — lien en bio',
    voiceover: `Le guide complet, « ${title} », est en lien dans ma bio.`,
    durationSec: 3,
  });

  // hype-ish styles occasionally slip a risky claim, unless the agency learned to avoid it
  const banned = [...(input.bannedClaims ?? []), ...rules.banned].map(clean).filter(Boolean);
  if ((style === 'before_after' || style === 'stat') && rng.chance(rules.t === undefined ? 0.25 : 0.45 * (1 - rules.t))) {
    const allowed = RISKY_AD_PHRASES.filter((p) => !conflictsWith(p, banned));
    if (allowed.length) {
      const r = riskyLine(rng.pick(allowed), c);
      const proof = scenes[3]!;
      proof.voiceover = `${proof.voiceover} ${r.vo}`;
      if (rng.chance(0.5)) proof.onScreenText = screenText(r.screen);
    }
  }

  const caption = fit(`${hook} Le guide « ${title} » est en lien dans la bio. Sauvegarde pour ce soir.`, 260);
  const draft: AdDraft = {
    hook,
    hookStyle: style,
    format,
    scenes,
    caption,
    hashtags: hashtags(c, rng),
    cta: format === 'carousel' ? 'Swipe jusqu’au bout et télécharge le guide (lien en bio)' : 'Télécharge le guide (lien en bio)',
  };
  if (rules.flaw && rules.flawRng) applyAdFlaws(scenes, draft, rules.flawRng, rules.flaw, c);

  // total 12-30 s
  let total = scenes.reduce((s, x) => s + x.durationSec, 0);
  while (total > 30) { const longest = scenes.reduce((a, b) => (b.durationSec > a.durationSec ? b : a)); longest.durationSec -= 1; total -= 1; }
  while (total < 12) { scenes[2]!.durationSec += 1; total += 1; }
  return draft;
}

/** One frame over the guide's cover, no voice: a pin or a feed image, never a script cut down to a scene. */
function heuristicStaticAd(
  input: { product: Product; voc: VoiceOfCustomer; hook: string; hookStyle: HookStyle; upsellOf?: UpsellContext | null },
  rng: LocalRng,
  rules: { t?: number; flaw?: number; flawRng?: LocalRng },
): AdDraft {
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc, input.upsellOf ?? null);
  const style: HookStyle = HOOK_STYLES.includes(input.hookStyle) ? input.hookStyle : 'question';
  const written = clean(input.hook) || makeHook(style, c, rng, bonusOf(input.product), undefined, rules.t);
  // no voice to catch up: a line that names neither the problem nor the reader gives way to the problem itself
  const line = relevance(written, c) > 0 ? written : cap(c.pbShort ?? c.pbClause);
  const hook = line.length <= STATIC_HOOK_MAX ? line : screenText(line);
  const title = plainTitle(clean(input.product?.title)) || 'le guide';
  const scene: AdScene = { visual: VISUALS.static_image[0]!, onScreenText: screenText(hook), voiceover: '', durationSec: 5 };
  const draft: AdDraft = {
    hook,
    hookStyle: style,
    format: 'static_image',
    scenes: [scene],
    caption: fit(`${hook} Le guide « ${title} », à télécharger.`, 260),
    hashtags: hashtags(c, rng),
    cta: 'Télécharge le guide',
  };
  if (rules.flaw && rules.flawRng) applyStaticFlaws(scene, draft, rules.flawRng, rules.flaw, c);
  return draft;
}

/** A weak writer's image: too much text to read in a feed, a hook that fits any guide, no way out. */
function applyStaticFlaws(scene: AdScene, draft: AdDraft, flawRng: LocalRng, f: number, c: NicheCtx): void {
  const [longScreen, noHook, weakCta] = [f, f / 2, f / 2].map((p) => flawRng.chance(p));
  if (longScreen) scene.onScreenText = `1. ${bare(c.steps[0] ?? FALLBACK.steps[0])}, puis ${lowerFirst(bare(c.steps[1] ?? FALLBACK.steps[1]))}, une étape à la fois, sans sauter la suivante`;
  if (noHook) { draft.hook = 'Deux secondes de ton temps'; scene.onScreenText = draft.hook; }
  if (weakCta) draft.cta = '';
}

/** Titles any guide can sign: they fill a thin ad, they never lead one. */
const SAFE_HEADLINES: readonly string[] = ['Guide PDF à télécharger', 'Un plan clair, pas à pas', 'Checklist à chaque chapitre', 'Les erreurs à éviter'];

/** What a buyer types for this guide: the niche's own words, spelled as the research spells them. */
function searchHead(input: { product: Product; voc: VoiceOfCustomer }, c: NicheCtx): { typed: string; spelled: string } {
  const slug = norm(input.product?.nicheId ?? input.voc?.nicheId ?? '').split(/[^a-z0-9]+/).filter(Boolean);
  const words = slug.filter((w) => w.length >= 2).length >= 2 ? slug
    : norm(plainTitle(clean(input.product?.title))).split(/[^a-z0-9]+/).filter((w) => w.length >= 4).slice(0, 3);
  const research = [clean(input.product?.title), c.niche.problem, c.niche.audience, ...c.pains, ...c.phrases, ...c.outcomes, ...c.tips, ...c.mistakes, ...c.facts]
    .join(' ').split(/[^\p{L}\p{N}]+/u);
  const spell = (w: string): string => {
    const forms = research.filter((x) => norm(x) === w);
    const seen = (f: string): number => forms.filter((x) => x === f).length;
    return forms.slice().sort((a, b) => seen(b) - seen(a) || Number(a === w) - Number(b === w))[0] ?? w;
  };
  return { typed: words.join(' '), spelled: words.map(spell).join(' ') };
}

/** A weak writer's ad: the title forgets what was searched, the end fits any guide or leads nowhere. */
function applySearchFlaws(ad: SearchAdDraft, flawRng: LocalRng, f: number): void {
  const [lostKeyword, cliche, noCta] = [f, f, f / 2].map((p) => flawRng.chance(p));
  if (lostKeyword) ad.headlines = uniqStrings([SAFE_HEADLINES[0], ...ad.headlines.slice(1)]);
  if (cliche) ad.descriptions[1] = `${flawRng.pick(AD_CLICHES)} Télécharge le guide.`;
  if (noCta) ad.descriptions[1] = 'Un plan clair, une étape à la fois.';
}

/**
 * A Search ad: 3 to 5 titles of 30 characters and 2 descriptions of 90 (channels §7.5). The first title says what was typed.
 * A refused word leaves the text and stays in the keywords: a platform lets you bid on what it will not let you write.
 */
export function heuristicSearchAd(
  input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] },
  rng: LocalRng,
  rules: { banned: string[]; t?: number; flaw?: number; flawRng?: LocalRng },
): SearchAdDraft {
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc, null);
  const refused = uniqStrings(input.bannedClaims ?? []);
  const banned = uniqStrings([...refused, ...rules.banned]);
  const usable = (s: string): boolean => !containsBanned(s, banned);
  const { typed, spelled } = searchHead(input, c);
  const { n, unit } = c.dur;
  const others = rng.shuffle(uniqStrings([
    c.outcomes.map(bare).find((o) => usable(o) && o.length <= HEADLINE_MAX),
    c.pbShort ? told(c.pbShort, HEADLINE_MAX) : null,
    `Plan de ${n} ${unit}, pas à pas`,
    `${c.stepCount} étapes concrètes`,
    c.pairs.length >= 3 ? `${c.pairs.length} erreurs à éviter` : null,
  ]));
  const headlines = uniqStrings([`Guide ${spelled}`, ...others, ...SAFE_HEADLINES])
    .filter((h) => usable(h) && h.length <= HEADLINE_MAX && !/[!:]/.test(h)).slice(0, rng.int(4, 5));

  const plan = `Le plan de ${n} ${unit}, étape par étape.`;
  const quoted = shortPhrases(c, 44).filter((p) => usable(p) && !RISK_RULES.some((x) => x.re.test(p))).map((p) => `${qKeep(p)} ${plan}`);
  const opening = rng.chance(rules.t === undefined ? 0.7 : 0.35 + 0.6 * rules.t) ? rng.shuffle(quoted) : [];
  const painLine = c.pbShort ? [`${cap(lf(c.pbShort))} : ${lowerFirst(plan)}`] : [];
  const first = [...opening, ...painLine, plan].find((d) => usable(d) && d.length <= DESCRIPTION_MAX) ?? plan;
  const second = [`Télécharge le guide PDF : ${c.stepCount} étapes, les erreurs à éviter et une checklist par chapitre.`, 'Télécharge le guide PDF : le plan complet, étape par étape.']
    .find((d) => usable(d) && d.length <= DESCRIPTION_MAX) ?? 'Télécharge le guide PDF.';

  const keywords = uniqStrings([typed, `guide ${typed}`, `${typed} pdf`, `methode ${typed}`, c.pbShort ? norm(bare(c.pbShort)) : null])
    .filter((k) => !containsBanned(k, refused));
  const ad: SearchAdDraft = { headlines, descriptions: [first, second], keywords };
  if (rules.flaw && rules.flawRng) applySearchFlaws(ad, rules.flawRng, rules.flaw);
  return ad;
}

function sentence(s: string): string {
  const t = clean(s);
  return /[.!?…]$/.test(t) ? cap(t) : `${cap(t)}.`;
}

export function heuristicOutreach(
  input: { creator: CreatorProfile; product: Product; offer: { upfront: number; commission: number } },
  rng: LocalRng,
  agent: { name: string },
  brand: string,
): string {
  const cr = input.creator;
  const handle = clean(cr?.handle).replace(/^@?/, '@') || '@toi';
  const title = clean(input.product?.title) || 'notre guide';
  const aud = clean(input.product?.audience) ? withArticle(input.product.audience) : 'ta communauté';
  const up = Number.isFinite(input.offer?.upfront) ? Math.max(0, input.offer.upfront) : 0;
  const com = Number.isFinite(input.offer?.commission) ? Math.min(1, Math.max(0, input.offer.commission)) : 0.3;
  const comTxt = fmtPct(com, 0);
  const avg = cr?.avgViews && cr.avgViews > 0 ? cr.avgViews : 0;
  const views = avg > 0 ? `${avg >= 1000 ? `${fmtNum(avg / 1000, avg >= 10000 ? 0 : 1)} k` : fmtNum(avg)} vues en moyenne` : null;
  const opener = rng.pick([
    `Salut ${handle} ! Je suis ${agent.name}, chez ${brand}.`,
    `Hello ${handle}, ${agent.name} de ${brand} ici.`,
  ]);
  const compliment = rng.pick([
    `On suit tes vidéos${views ? ` (${views}, bravo)` : ''} : ta façon de parler à ${aud} sonne juste.`,
    `Ta communauté ressemble exactement aux lecteurs de notre guide${views ? `, et tes ${views} le prouvent` : ''}.`,
  ]);
  const offer = up > 0
    ? `Notre proposition : ${fmtEur(up)} pour une vidéo, plus ${comTxt} de commission sur chaque vente faite avec ton lien.`
    : `Notre proposition : ${comTxt} de commission sur chaque vente faite avec ton lien, sans rien à avancer de ton côté.`;
  return [
    opener,
    compliment,
    `On a créé « ${title} », un guide PDF pour ${aud}.`,
    offer,
    'On t’envoie le guide gratuitement pour que tu juges par toi-même, sans engagement. Ça te dit qu’on en parle ?',
  ].join(' ');
}
