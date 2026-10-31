/**
 * What the list reads (scale §6.2): the free guide that earns an address, the five welcome mails, the mail of the week.
 * Every mail is built on what customers said and on the guide it speaks of: their words first, one thing to do, the way to
 * the guide, the way out. A mail never carries the price: it stays in the inbox, the price moves. A worked case keeps its
 * label: it is an example, never a person with a result.
 */
import type { Broadcast, ChapterContent, EmailStep, PdfContent, Product, VisualSpec, VoiceOfCustomer } from '../../shared.js';
import { findBannedClaims } from '../../sim/compliance.js';
import { bare, cap, clauseLabel, clean, lf, plainTitle, q, sentence, uniqStrings, withArticle, wordCount, type LocalRng } from '../util.js';
import { nicheFromProduct } from './commerce.js';
import type { MistakePair } from './knowledge.js';
import { buildNicheCtx, type NicheCtx } from './niche.js';

export interface LifecycleRules { name: string; brand: string }

const SUBJECT = { min: 15, max: 60 } as const;
/** Mistakes a lead magnet walks through: enough to be worth an address, few enough for a page. */
const MAGNET_MISTAKES = 5;
const MAGNET_TICKS = 6;
const QUOTE_MAX = 90;
/** A sum in a mail reads as the price: the page reprints it, a mail stays as it was sent. */
const PRICED = /\d\s*€/;
const OUT = 'Pour vous désabonner, un clic sur le lien en bas de ce message suffit, sans justification.';

interface Writer {
  c: NicheCtx;
  product: Product;
  says: string[];         // customers' words a mail may quote: never a claim the platform refuses
  pairs: MistakePair[];
  tips: string[];
  examples: string[];
  guide: string;          // « title »
  rules: LifecycleRules;
}

function writerFor(input: { product: Product; voc: VoiceOfCustomer; bannedClaims?: readonly string[] }, rng: LocalRng, rules: LifecycleRules): Writer {
  const c = buildNicheCtx(nicheFromProduct(input.product, input.voc), input.voc);
  const banned = input.bannedClaims ?? input.voc?.bannedClaims ?? [];
  const safe = (s: string): boolean => findBannedClaims([s], banned).length === 0;
  const pairs = c.pairs.filter((p) => safe(`${p.mistake} ${p.why} ${p.fix ?? ''}`));
  return {
    c, product: input.product, rules, pairs,
    says: rng.shuffle(uniqStrings([...c.phrases, ...c.pains]).filter((s) => safe(s) && !PRICED.test(s) && bare(s).length <= QUOTE_MAX)),
    tips: rng.shuffle(c.tips.filter(safe)),
    examples: rng.shuffle(c.examples.filter(safe)),
    guide: q(plainTitle(input.product.title)),
  };
}

const at = <T,>(xs: readonly T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);

/** An objection of the page with its answer, none that names a sum. */
const objectionOf = (p: Product): { q: string; a: string } | null => p.salesPage?.objections.find((o) => o.q && o.a && !PRICED.test(`${o.q} ${o.a}`)) ?? null;

/** A mail's first words: the customer's, whole, or the problem as the brief says it. */
const said = (w: Writer, i: number, fallback: string): string => {
  const s = at(w.says, i);
  return s ? q(s) : fallback;
};

const signature = (w: Writer): string => `${w.rules.name}, pour ${w.rules.brand}`;

function mail(w: Writer, paragraphs: readonly (string | null | undefined)[]): string {
  return ['Bonjour,', ...paragraphs.filter((p): p is string => !!p), signature(w), OUT].join('\n\n');
}

/** A subject the list reads to the end, else the one that always fits. */
function subjectOf(text: string | null | undefined, fallback: string): string {
  const t = clean(text);
  return t.length >= SUBJECT.min && t.length <= SUBJECT.max ? t : fallback;
}

const asked = (text: string | null | undefined): string | null => {
  const t = clauseLabel(text, SUBJECT.max - 2, { min: 8, tiers: 1 });
  return t ? `${t} ?` : null;
};

const pairLine = (p: MistakePair): string => [sentence(p.mistake), p.why ? sentence(p.why) : null, p.fix ? `À la place : ${lf(p.fix)}.` : null].filter(Boolean).join(' ');

/** A worked case says what it is, whoever it names. */
const typed = (example: string): string => (/^exemple type/i.test(clean(example)) ? sentence(example) : `Exemple type : ${sentence(example)}`);

const promiseOf = (p: Product): string | null => (p.content?.promise ? sentence(p.content.promise) : null);

/** What the guide holds, in counts the reader can check. */
function holds(p: Product): string {
  const chapters = p.content?.chapters.length ?? 0;
  const sheets = p.pdfFacts?.sheets ?? 0;
  const parts = [chapters ? `${chapters} chapitres` : null, sheets ? `${sheets} fiche${sheets > 1 ? 's' : ''} à imprimer` : null].filter(Boolean);
  return parts.length ? `${parts.join(', ')} : le plan complet, dans l’ordre.` : 'Le plan complet, dans l’ordre.';
}

const TO_GUIDE = 'Découvrez le guide avec le lien juste en dessous.';

// ───────────────────────────── the sequence ─────────────────────────────

function welcome(w: Writer): Omit<EmailStep, 'score'> {
  const gift = w.product.leadMagnet?.title ? q(w.product.leadMagnet.title) : 'votre guide offert';
  const first = at(w.pairs, 0);
  const count = Math.min(MAGNET_MISTAKES, w.pairs.length);
  return {
    day: 0, kind: 'value',
    subject: count >= 2 ? `Vos ${count} erreurs à éviter : le guide offert` : 'Votre guide offert, à lire en 5 minutes',
    body: mail(w, [
      `Merci de votre confiance. Voici ce que vous êtes venu chercher : ${gift}, à télécharger avec le lien ci-dessous.`,
      `Si vous êtes ici, vous vous êtes sans doute déjà dit ${said(w, 0, `que ${w.c.problem} n’allait pas se régler tout seul`)}. C’est la phrase qui revient le plus souvent chez ${withArticle(w.c.audShort)}, avec ${said(w, 1, 'celle-ci : « je ne sais plus par où commencer »')}.`,
      first ? `Commencez par une seule chose. ${pairLine(first)}` : null,
      'Dans deux jours, je vous écris ce qui débloque le plus souvent la situation.',
    ]),
  };
}

function firstMove(w: Writer): Omit<EmailStep, 'score'> {
  const tip = at(w.tips, 0);
  const pair = at(w.pairs, 1);
  return {
    day: 2, kind: 'value',
    subject: 'Une seule chose à changer cette semaine ?',
    body: mail(w, [
      `Beaucoup de lecteurs nous écrivent ${said(w, 2, `que ${w.c.problem} les épuise`)}. Avant de tout changer, essayez ceci pendant trois jours et notez ce qui bouge.`,
      tip ? sentence(tip) : null,
      pair ? pairLine(pair) : null,
      `Si une étape coince, le guide offert vous dit quoi regarder en premier. Gardez-le sous la main.`,
    ]),
  };
}

function firstPitch(w: Writer): Omit<EmailStep, 'score'> {
  return {
    day: 4, kind: 'pitch',
    subject: 'Et maintenant, par quoi commencer ?',
    body: mail(w, [
      `Le guide offert vous a montré ce qui bloque. Reste la question que beaucoup se posent ensuite : ${said(w, 3, 'par quoi commencer, et dans quel ordre ?')}`,
      `C’est pour ça que nous avons écrit ${w.guide}. ${promiseOf(w.product) ?? ''} ${holds(w.product)}`,
      TO_GUIDE,
    ]),
  };
}

function caseMail(w: Writer): Omit<EmailStep, 'score'> {
  const example = at(w.examples, 0);
  const pair = at(w.pairs, 2);
  return {
    day: 7, kind: 'value',
    subject: 'Un exemple concret, en 3 lignes',
    body: mail(w, [
      `Un cas vaut mieux qu’un long discours, surtout quand on se dit ${said(w, 4, `que ${w.c.problem} ne changera jamais`)}.`,
      example ? typed(example) : null,
      pair ? `Ce qu’il faut retenir. ${pairLine(pair)}` : null,
      'Regardez ce qui ressemble à votre situation, et changez une seule chose avant demain.',
    ]),
  };
}

function lastPitch(w: Writer): Omit<EmailStep, 'score'> {
  const objection = objectionOf(w.product);
  const worry = objection?.q ?? at(w.c.objections, 0) ?? null;
  return {
    day: 10, kind: 'pitch',
    subject: subjectOf(asked(worry), 'Une dernière question avant de vous laisser ?'),
    body: mail(w, [
      worry ? `Une dernière question nous revient souvent : ${q(worry)}` : 'Une dernière chose avant de vous laisser tranquille.',
      objection?.a ? sentence(objection.a) : `Le guide ${w.guide} y répond pas à pas, chapitre par chapitre.`,
      `Si vous reconnaissez encore ${said(w, 5, 'cette situation')}, le guide reprend tout dans l’ordre. ${holds(w.product)}`,
      TO_GUIDE,
      'C’est mon dernier mail de bienvenue. Vous recevrez ensuite nos conseils une fois par semaine.',
    ]),
  };
}

export function heuristicSequence(input: { product: Product; voc: VoiceOfCustomer; bannedClaims: string[] }, rng: LocalRng, rules: LifecycleRules): Omit<EmailStep, 'score'>[] {
  const w = writerFor(input, rng, rules);
  return [welcome(w), firstMove(w), firstPitch(w), caseMail(w), lastPitch(w)];
}

// ───────────────────────────── the broadcast ─────────────────────────────

type Draft = { subject: string; lines: (string | null)[] };

const ANGLES: Record<string, (w: Writer) => Draft> = {
  erreur(w) {
    const pair = at(w.pairs, 0);
    return {
      subject: subjectOf(asked(pair?.mistake), 'L’erreur que presque tout le monde fait ?'),
      lines: [`Cette semaine, une erreur que nous voyons partout, chez ceux qui nous écrivent ${said(w, 0, `que ${w.c.problem} les épuise`)}.`, pair ? pairLine(pair) : null, sentence(`Le guide ${w.guide} reprend ce point et ceux qui viennent ensuite`)],
    };
  },
  astuce(w) {
    const tip = at(w.tips, 0);
    return {
      subject: 'Une chose à tester cette semaine ?',
      lines: [`Pour ceux qui se disent ${said(w, 0, `que ${w.c.problem} ne bougera plus`)}, voici un geste à tester pendant trois jours.`, tip ? sentence(tip) : null, `C’est un des gestes du guide ${w.guide}. Notez ce qui change, puis passez au suivant.`],
    };
  },
  histoire(w) {
    const example = at(w.examples, 0);
    return {
      subject: 'Un exemple type, en 3 lignes',
      lines: [`Une situation qui revient souvent, chez ceux qui nous écrivent ${said(w, 0, `que ${w.c.problem} les épuise`)}.`, example ? typed(example) : null, `Tout le chemin est dans le guide ${w.guide}.`],
    };
  },
  objection(w) {
    const objection = objectionOf(w.product);
    return {
      subject: subjectOf(asked(objection?.q), 'La question qu’on nous pose le plus ?'),
      lines: [objection ? `La question de la semaine : ${q(objection.q)}` : `La question de la semaine vient de ceux qui nous écrivent ${said(w, 0, `que ${w.c.problem} les épuise`)}.`, objection ? sentence(objection.a) : promiseOf(w.product), `Le guide ${w.guide} y répond pas à pas.`],
    };
  },
};

function launch(w: Writer): Draft {
  return {
    subject: subjectOf(`Nouveau guide : ${clauseLabel(plainTitle(w.product.title), SUBJECT.max - 16, 8) ?? ''}`, 'Un nouveau guide pour vous ?'),
    lines: [`Vous nous avez écrit ${said(w, 0, `que ${w.c.problem} vous épuise`)}, et ${said(w, 1, 'que rien ne semblait bouger')}. Nous avons écrit le guide qui manquait.`, `${w.guide} : ${promiseOf(w.product) ?? 'un plan clair, dans l’ordre.'}`, holds(w.product), 'Vous êtes les premiers à le recevoir : vos retours nous aident à l’améliorer.'],
  };
}

export function heuristicBroadcast(input: { product: Product; voc: VoiceOfCustomer; angle: string; audience: Broadcast['audience']; bannedClaims: string[] }, rng: LocalRng, rules: LifecycleRules): { subject: string; body: string; hasUnsubscribe: boolean } {
  const w = writerFor(input, rng, rules);
  const draft = input.audience === 'launch' ? launch(w) : (ANGLES[input.angle] ?? ANGLES.erreur!)(w);
  return { subject: draft.subject, body: mail(w, [...draft.lines, TO_GUIDE]), hasUnsubscribe: true };
}

// ───────────────────────────── the lead magnet ─────────────────────────────

const printable = (v: VisualSpec | null | undefined): v is VisualSpec => v?.type === 'grid';

/** The sheet the magnet gives away: the bonus's when it can spare one, a taste of what the guide holds. */
function sampleSheet(content: PdfContent): VisualSpec | null {
  const sheets = [content.bonus?.visual, ...content.chapters.flatMap((ch) => [ch.visual, ch.figure])].filter(printable);
  return sheets[0] ?? null;
}

function magnetSteps(w: Writer, content: PdfContent): string[] {
  const pairs = w.pairs.slice(0, MAGNET_MISTAKES).map(pairLine);
  return pairs.length >= 3 ? pairs : uniqStrings([...pairs, ...content.chapters.flatMap((ch) => ch.steps)]).slice(0, MAGNET_MISTAKES);
}

export function heuristicLeadMagnet(input: { product: Product; content: PdfContent; voc: VoiceOfCustomer }, rng: LocalRng, rules: LifecycleRules): PdfContent {
  const { product, content } = input;
  const w = writerFor(input, rng, rules);
  const { c } = w;
  const steps = magnetSteps(w, content);
  const ticks = uniqStrings(content.chapters.flatMap((ch) => ch.checklist)).slice(0, MAGNET_TICKS);
  const example = w.examples.find((e) => /^exemple type/i.test(clean(e))) ?? null;
  const count = steps.length;
  const words = c.pbShort ?? c.painTitle;
  const chapter: ChapterContent = {
    title: `Les ${count} erreurs à éviter quand on veut ${c.goal ? lf(c.goal) : 'en sortir'}`,
    intro: `Elles reviennent dans presque tous les messages que nous recevons. Aucune n’est grave, et chacune se corrige dès aujourd’hui.`,
    paragraphs: [], steps, example, checklist: ticks, visual: null,
  };
  const sheet = sampleSheet(content);
  const out: PdfContent = {
    title: `Les ${count} erreurs à éviter : ${lf(words)}`,
    subtitle: `Le guide offert pour ${withArticle(c.aud)}`,
    audience: product.audience, promise: `Savoir ce qui bloque et quoi faire à la place, dès aujourd’hui.`,
    introduction: [`${cap(said(w, 0, c.problem))} : si cette phrase vous parle, ce guide offert est pour vous. Il tient en quelques pages : ce qui bloque le plus souvent, et quoi faire à la place.`],
    chapters: [chapter],
    bonus: { title: sheet?.title ?? 'La fiche à imprimer', intro: '', paragraphs: [], steps: [], example: null, checklist: [], visual: sheet },
    nextStep: {
      title: plainTitle(product.title),
      text: `Ces erreurs évitées, reste à tenir le plan. ${promiseOf(product) ?? ''} ${holds(product)} Le guide complet est en vente sur notre boutique, et les prochains e-mails vous en reparlent. Bon courage, de la part de toute l’équipe ${rules.brand}.`,
      upsellProductId: null,
    },
    wordCount: 0,
  };
  out.wordCount = wordCount([...out.introduction, chapter.intro, ...steps, example ?? '', ...ticks].join(' '));
  return out;
}
