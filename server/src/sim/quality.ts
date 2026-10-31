/**
 * Heuristic quality scorers (0..100) with French, actionable issues. Used by QA agents AND by the
 * market itself (the conversion model trusts these, not the company's self-assessment).
 */
import { clamp } from '../core/index.js';
import type {
  AdCreative, ChapterContent, DesignSpec, InboxMessage, MessageIntent, PdfContent, Product, QualityReport, SalesPage,
  SupportReplyInput, VisualReport, VoiceOfCustomer,
} from '../shared.js';
import { countHype, findBannedClaims, findPageClaims } from './compliance.js';
import { countPhrase, countWords, hasPhrase, keyTokens, norm, overlap, stemSet } from './text.js';
import { scoreCut } from './videoCraft.js';

/** French AI clichés: each occurrence costs human tone. */
export const GENERIC_PHRASES: readonly string[] = [
  'chaque bébé est différent', 'chaque enfant est différent', 'chaque situation est unique', 'chaque parcours est unique',
  'soyez patient', 'soyez patiente', 'soyez patients', 'il est important de noter', 'il est important de souligner',
  "n'hésitez pas à", 'en conclusion', "dans le monde d'aujourd'hui", 'dans le monde actuel', 'il est essentiel de',
  'plongeons dans', 'plongeons ensemble', 'en fin de compte', 'il convient de souligner', 'il convient de noter',
  'force est de constater', 'à l\'ère du numérique', 'il va sans dire', 'que vous soyez débutant ou expert',
  'libérez votre potentiel', 'votre plein potentiel', 'le secret réside dans', 'la clé du succès', 'la patience est la clé',
  'faites-vous confiance', 'écoutez votre corps', 'prenez soin de vous', 'rappelez-vous que', "gardez à l'esprit que",
  "il n'y a pas de solution miracle", 'sans plus attendre', 'un véritable atout', 'un outil puissant', 'pour résumer',
  'en somme', 'dans ce guide complet', 'au cœur de', 'faire toute la différence', 'chaque petit pas compte',
];

type Parts = Pick<QualityReport, 'specificity' | 'structure' | 'actionability' | 'humanTone' | 'design' | 'promiseMatch' | 'compliance'>;
type Weights = Record<keyof Parts, number>;

/** Issues grouped by dimension, so the final list covers every weak spot instead of the first one only. */
class IssueList {
  private groups = new Map<keyof Parts, string[]>();
  private current: keyof Parts = 'structure';
  /** What a reviewer cannot let through, whatever the global score. */
  readonly blocking: { dimension: keyof Parts; text: string }[] = [];
  section(k: keyof Parts): void { this.current = k; }
  push(msg: string): void {
    const g = this.groups.get(this.current) ?? [];
    g.push(msg);
    this.groups.set(this.current, g);
  }
  block(msg: string): void {
    this.push(msg);
    this.blocking.push({ dimension: this.current, text: msg });
  }
  /** Round-robin: compliance first, then the weakest dimensions first. */
  merge(parts: Parts, max = 12): string[] {
    const keys = [...this.groups.keys()].sort((a, b) => (a === 'compliance' ? -1 : b === 'compliance' ? 1 : parts[a] - parts[b]));
    const out: string[] = [];
    for (let i = 0; out.length < max; i++) {
      let added = false;
      for (const k of keys) {
        const g = this.groups.get(k)!;
        if (i < g.length && out.length < max) { out.push(g[i]!); added = true; }
      }
      if (!added) break;
    }
    return out;
  }
}

function report(parts: Parts, weights: Weights, issues: IssueList, cap?: number): QualityReport {
  const p = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(clamp(v, 0, 100))])) as Parts;
  let overall = 0;
  for (const k of Object.keys(weights) as (keyof Parts)[]) overall += p[k] * weights[k];
  if (cap !== undefined) overall = Math.min(overall, cap);
  return { overall: Math.round(clamp(overall, 0, 100)), ...p, issues: issues.merge(p), blocking: issues.blocking, evaluator: 'heuristic' };
}

function quote(xs: string[], n = 3): string {
  return xs.slice(0, n).map((x) => `« ${x} »`).join(', ');
}

/** Generic phrases present in a normalised text (with total occurrence count). */
export function genericPhraseHits(normText: string): { total: number; found: string[] } {
  let total = 0;
  const found: string[] = [];
  for (const g of GENERIC_PHRASES) {
    const c = countPhrase(normText, g);
    if (c > 0) { total += c; found.push(g); }
  }
  return { total, found };
}

/** How many customer phrases / pains are reused (4-word windows) in the text. */
export function vocPhraseHits(normText: string, voc?: VoiceOfCustomer): number {
  if (!voc) return 0;
  let hits = 0;
  for (const phrase of [...voc.phrases, ...voc.pains]) {
    const words = norm(phrase).split(/[^a-z0-9']+/).filter(Boolean);
    if (words.length === 0) continue;
    const size = Math.min(4, words.length);
    for (let i = 0; i + size <= words.length; i++) {
      const win = words.slice(i, i + size).join(' ');
      if (win.length >= 12 && normText.includes(win)) { hits++; break; }
    }
  }
  return hits;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => countWords(s) >= 3);
}

/** Share of sentences starting with the most frequent first word (0 when < 12 sentences). */
function repetitiveStarts(text: string): { share: number; word: string } {
  const ss = sentences(text);
  if (ss.length < 12) return { share: 0, word: '' };
  const counts = new Map<string, number>();
  for (const s of ss) {
    const w = norm(s).split(/[^a-z0-9']+/).find(Boolean) ?? '';
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let best = ''; let n = 0;
  for (const [w, c] of counts) if (c > n) { best = w; n = c; }
  return { share: n / ss.length, word: best };
}

function capsShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return 0;
  const upper = letters.filter((l) => l === l.toUpperCase() && l !== l.toLowerCase()).length;
  return upper / letters.length;
}

function chapterText(c: ChapterContent): string {
  return [c.title, c.intro, ...(c.paragraphs ?? []), ...(c.steps ?? []), c.example ?? '', ...(c.checklist ?? [])].join('\n');
}

export function pdfText(content: PdfContent): string {
  return [
    content.title, content.subtitle, content.promise, ...(content.introduction ?? []),
    ...(content.chapters ?? []).map(chapterText), content.bonus ? chapterText(content.bonus) : '',
    content.nextStep?.title ?? '', content.nextStep?.text ?? '',
  ].join('\n');
}

function stringsIn(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(stringsIn);
  return v && typeof v === 'object' ? Object.values(v).flatMap(stringsIn) : [];
}

/**
 * What a guide prints outside its prose: the rail, the figures, the sheets, the « how to » box. The scorers of the text stay
 * on `pdfText`, a table cell is no sentence. A claim is a claim wherever the reader meets it: compliance reads this too.
 */
function printedAside(content: PdfContent): string[] {
  const chapters = [...(content?.chapters ?? []), ...(content?.bonus ? [content.bonus] : [])];
  return stringsIn([content?.howTo, chapters.map((c) => [c.margin, c.visual, c.figure])]);
}

const CONCRETE_RE = /\d|\bmin\b|minutes?|heures?|\bh\b|jours?|semaines?|fois|€|%/i;

// ───────────────────────────── what a guide really contains ─────────────────────────────

/** Consecutive words that make a passage recognisable when it comes back. */
const ECHO_WINDOW = 5;
/** A pain is treated when one chapter uses at least this share of its significant words. */
const PAIN_TREATED = 0.5;

function wordsOf(text: string): string[] {
  return norm(text).split(/[^a-z0-9']+/).filter(Boolean);
}

function windowsOf(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + ECHO_WINDOW <= words.length; i++) out.push(words.slice(i, i + ECHO_WINDOW).join(' '));
  return out;
}

/** Every passage of a chapter, in reading order. */
function chapterBlocks(c: ChapterContent): string[] {
  return [c.intro, ...(c.paragraphs ?? []), ...(c.steps ?? []), c.example ?? '', ...(c.checklist ?? [])].filter(Boolean);
}

/** The whole guide, in the order a reader meets it. */
function guideBlocks(content: PdfContent): string[] {
  return [...(content?.introduction ?? []), ...(content?.chapters ?? []).flatMap(chapterBlocks), ...(content?.bonus ? chapterBlocks(content.bonus) : [])];
}

/** How many words of `words` belong to a window already in `seen`. */
function echoedWords(words: readonly string[], seen: ReadonlySet<string>): number {
  const echoed = new Array<boolean>(words.length).fill(false);
  windowsOf(words).forEach((w, i) => { if (seen.has(w)) echoed.fill(true, i, i + ECHO_WINDOW); });
  return echoed.filter(Boolean).length;
}

/** A table the reader fills in or keeps: an empty frame or a two-line table is not a tool. */
function isSheet(c: ChapterContent | null | undefined): boolean {
  const g = c?.visual?.type === 'grid' ? c.visual.grid : undefined;
  return !!g && (g.rows?.length ?? 0) >= 3 && (g.columns?.length ?? 0) >= 2;
}

export interface GuideSubstance {
  words: number;
  /** Words the reader has not met earlier in the guide: what he really paid for. */
  freshWords: number;
  /** Share (0..1) of the text that says again what an earlier passage said. */
  repeatedShare: number;
  /** Whole sentences printed more than once. */
  repeatedSentences: string[];
  /** Printable tables, bonus included. */
  sheets: number;
  /** Chapters with a worked case of their own: a situation with a detail that the guide does not tell elsewhere. */
  cases: number;
  /** Share (0..1) of the steps that carry a duration, a quantity or a number. */
  concreteSteps: number;
}

/** Deterministic reading of what a guide contains, whatever its length: padding does not count as value. */
export function guideSubstance(content: PdfContent): GuideSubstance {
  const chapters = content?.chapters ?? [];
  const seen = new Set<string>();
  const sentencesSeen = new Set<string>();
  const repeatedSentences = new Set<string>();
  const uses = new Map<string, number>();
  const blocks = guideBlocks(content);
  for (const b of blocks) for (const w of windowsOf(wordsOf(b))) uses.set(w, (uses.get(w) ?? 0) + 1);
  let words = 0;
  let echoed = 0;
  for (const block of blocks) {
    const ws = wordsOf(block);
    words += ws.length;
    echoed += echoedWords(ws, seen);
    for (const w of windowsOf(ws)) seen.add(w);
    for (const s of sentences(block)) {
      const key = wordsOf(s).join(' ');
      if (key.split(' ').length < ECHO_WINDOW) continue;
      if (sentencesSeen.has(key)) repeatedSentences.add(s);
      sentencesSeen.add(key);
    }
  }
  const cases = chapters.filter((c) => {
    const ex = c.example ?? '';
    if (ex.length <= 40 || !/\d|\p{Lu}\p{Ll}+,/u.test(ex.slice(1))) return false;
    const ws = windowsOf(wordsOf(ex));
    return ws.filter((w) => (uses.get(w) ?? 0) > 1).length / Math.max(1, ws.length) < 0.5;
  }).length;
  const steps = chapters.flatMap((c) => c.steps ?? []);
  return {
    words,
    freshWords: words - echoed,
    repeatedShare: words ? echoed / words : 0,
    repeatedSentences: [...repeatedSentences],
    sheets: [...chapters, content?.bonus].filter(isSheet).length,
    cases,
    concreteSteps: steps.length ? steps.filter((s) => CONCRETE_RE.test(s)).length / steps.length : 0,
  };
}

/** The customers' pains no chapter treats (none without research). */
export function untreatedPains(content: PdfContent, voc?: VoiceOfCustomer): string[] {
  const chapters = (content?.chapters ?? []).map((c) => stemSet(chapterText(c)));
  return (voc?.pains ?? []).filter((pain) => {
    const tokens = keyTokens(pain);
    return tokens.length > 0 && !chapters.some((set) => overlap(tokens, set) >= PAIN_TREATED);
  });
}

/**
 * Share (0..1) of a follow-up guide its buyer has already read in the first one. Two guides of a niche share words,
 * not sentences: a high share means he paid twice for the same text. The same promise sold again counts as half a
 * guide even when every sentence was rewritten.
 */
export function guideOverlap(content: PdfContent, parent: PdfContent): number {
  const known = new Set(guideBlocks(parent).flatMap((b) => windowsOf(wordsOf(b))));
  let words = 0;
  let echoed = 0;
  for (const block of guideBlocks(content)) {
    const ws = wordsOf(block);
    words += ws.length;
    echoed += echoedWords(ws, known);
  }
  const text = words ? echoed / words : 0;
  const promise = keyTokens(content?.promise ?? '');
  const samePromise = promise.length > 0 && overlap(promise, stemSet(parent?.promise ?? '')) >= 0.8;
  const sameTitle = !!content?.title && norm(content.title) === norm(parent?.title ?? '');
  return Math.max(text, samePromise || sameTitle ? 0.5 : 0);
}

const NAMES_A_TOOL = /imprimer|imprimable|carnet|grille|tableau|fiche|planning|calendrier|feuille|journal|modele|planificateur/;
const PERIOD_UNIT: Record<string, string> = { jour: 'jour', jours: 'jour', nuit: 'nuit', nuits: 'nuit', soir: 'soir', soirs: 'soir', semaine: 'semaine', semaines: 'semaine' };

/** The furthest point (« Jour 12 », « Semaines 3-4 ») a chapter's plan really reaches, in the unit of its duration. */
function planReach(c: ChapterContent, unit: string): number {
  const rows = [...(c.steps ?? []), ...(c.paragraphs ?? []), ...(c.visual?.grid?.rows ?? []), ...(c.visual?.labels ?? [])];
  let reach = 0;
  for (const m of rows.join('\n').matchAll(/(?<![\p{L}\d])(\p{L}+)\s+(\d+)(?:\s*(?:-|à|a|–)\s*(\d+))?/gu)) {
    if (PERIOD_UNIT[norm(m[1]!)] === unit) reach = Math.max(reach, Number(m[3] ?? m[2]));
  }
  return reach;
}

/** What a guide announces and does not contain: the first things a buyer checks. */
export function brokenPromises(content: PdfContent): string[] {
  const out: string[] = [];
  const chapters = content?.chapters ?? [];
  const bonus = content?.bonus;
  const front = [content?.title, content?.subtitle, content?.promise, ...(content?.introduction ?? [])].join('\n');
  const heads = norm([content?.title, content?.subtitle, ...chapters.map((c) => c.title)].join('\n'));
  const bonusName = norm(bonus?.title ?? '');
  const bonusBody = countWords([bonus?.intro, ...(bonus?.paragraphs ?? []), ...(bonus?.steps ?? []), ...(bonus?.checklist ?? [])].join(' '));
  if (!bonusName && /\bbonus\b|\bcadeau\b|offert/.test(norm([front, ...chapters.map(chapterText)].join('\n')))) {
    out.push('Un bonus est annoncé, mais le guide n\'en contient aucun.');
  } else if (bonusName && (bonusBody < 30 || (NAMES_A_TOOL.test(bonusName) && !isSheet(bonus) && (bonus?.checklist?.length ?? 0) < 6))) {
    out.push(`Le bonus « ${bonus!.title} » est annoncé, mais le guide ne contient pas l'outil lui-même : ajoutez la grille à remplir.`);
  }
  for (const m of norm(front).matchAll(/\bbonus(?: offert)? ?: ?([^.\n]{8,80})/g)) {
    if (bonusName && overlap(keyTokens(m[1]!), stemSet(bonusName)) < 0.5) out.push(`L'introduction promet « ${m[1]!.trim()} », mais le bonus du guide est « ${bonus!.title} ».`);
  }
  for (const m of heads.matchAll(/\b(\d+) chapitres\b/g)) {
    if (Number(m[1]) !== chapters.length) out.push(`Le guide annonce ${m[1]} chapitres et en contient ${chapters.length}.`);
  }
  const widest = Math.max(chapters.length, ...chapters.map((c) => c.steps?.length ?? 0));
  for (const m of heads.matchAll(/\b(\d+) etapes\b/g)) {
    if (Number(m[1]) > widest) out.push(`Le guide annonce ${m[1]} étapes et n'en développe que ${widest}.`);
  }
  for (const c of chapters) {
    const m = /\b(\d+) (?:erreurs|problemes|pieges|situations)\b/.exec(norm(c.title));
    const developed = Math.max(c.paragraphs?.length ?? 0, c.steps?.length ?? 0);
    if (m && Number(m[1]) > developed) out.push(`« ${c.title} » annonce ${m[1]} cas et n'en développe que ${developed}.`);
  }
  // « le plan de 14 jours » : the plan must really go that far
  const span = /\b(\d+) (jours?|nuits?|soirs?|semaines?)\b/.exec(norm(`${content?.title ?? ''} ${content?.subtitle ?? ''}`));
  if (span) {
    const unit = PERIOD_UNIT[span[2]!]!;
    const reach = Math.max(0, ...chapters.map((c) => planReach(c, unit)));
    if (reach > 0 && reach < Number(span[1]) * 0.75) out.push(`Le guide annonce ${span[1]} ${span[2]} et son plan s'arrête à ${reach}.`);
  }
  return out;
}

/**
 * What a sales page says about the guide and the guide does not back: `lies` sell something that is not there (a
 * chapter, a bonus), `stretches` overstate what is there (a longer plan, examples the guide barely has).
 */
export function unbackedClaims(sp: SalesPage, content: PdfContent | null | undefined): { lies: string[]; stretches: string[] } {
  const lies: string[] = [];
  const stretches: string[] = [];
  if (!content) return { lies, stretches };
  const chapters = content.chapters ?? [];
  const blurbs = sp?.chapterBlurbs ?? [];
  const page = norm([sp?.headline, sp?.subheadline, sp?.solution, sp?.bonusBlurb, ...blurbs.map((b) => `${b.title} ${b.blurb}`), ...(sp?.objections ?? []).map((o) => o.a)].join('\n'));
  const guide = norm(pdfText(content));
  for (const m of page.matchAll(/\b(\d+) chapitres\b/g)) {
    if (Number(m[1]) !== chapters.length) lies.push(`La page annonce ${m[1]} chapitres, le guide en a ${chapters.length}.`);
  }
  const titles = stemSet(chapters.map((c) => c.title).join(' '));
  const foreign = blurbs.filter((b) => overlap(keyTokens(b.title ?? ''), titles) < 0.5);
  if (foreign.length) lies.push(`La page présente des chapitres que le guide n'a pas : ${quote(foreign.map((b) => b.title), 2)}.`);
  const bonusBlurb = sp?.bonusBlurb ?? '';
  if (bonusBlurb.length > 15) {
    const bonusWords = keyTokens((content.bonus?.title ?? '').replace(/^bonus\s*:/i, ''));
    if (!bonusWords.length || overlap(bonusWords, stemSet(bonusBlurb)) < 0.5) lies.push(`La page annonce un bonus qui n'est pas celui du guide (« ${content.bonus?.title || 'aucun'} »).`);
    else if (brokenPromises(content).some((b) => b.startsWith('Le bonus'))) lies.push('La page vend un bonus que le guide ne contient pas vraiment.');
  }
  for (const m of norm(`${sp?.headline ?? ''} ${sp?.subheadline ?? ''} ${sp?.solution ?? ''}`).matchAll(/\b(?:plan|programme|protocole) (?:de|sur) (\d+) (jours?|nuits?|soirs?|semaines?)\b/g)) {
    if (!hasPhrase(guide, `${m[1]} ${m[2]}`)) stretches.push(`La page promet un plan de ${m[1]} ${m[2]} que le guide ne contient pas.`);
  }
  if (/chaque chapitre se termine par une checklist/.test(page) && chapters.some((c) => (c.checklist?.length ?? 0) === 0)) stretches.push('La page promet une checklist par chapitre : il en manque.');
  if (/\bexemples\b/.test(page) && chapters.filter((c) => (c.example ?? '').length > 40).length < 2) stretches.push('La page promet des exemples : le guide n\'en a presque pas.');
  return { lies, stretches };
}

// ───────────────────────────── PDF ─────────────────────────────

/** From this many generic « IA » phrases, the text cannot ship whatever its score. */
const GENERIC_BLOCKING = 3;
/** From this many sentences printed twice, the guide reads as padding whatever its score. */
const REPEAT_BLOCKING = 3;
/** Recaps are normal: a guide starts to feel padded above this share of already-read text. */
const REPEAT_TOLERATED = 0.1;
/** What a thorough guide gives per chapter, once its repeats are removed. */
const FRESH_WORDS_PER_CHAPTER = 550;
/** Share of steps with a duration or a quantity expected from a guide that really tells what to do. */
const CONCRETE_STEPS_TARGET = 0.75;
/** Per chapter, the lists a reader can tick off. */
const ITEMS_PER_CHAPTER = 7;
/** promiseMatch lost per thing the deliverable announces and does not hold. */
const BROKEN_PROMISE_COST = 30;
/** promiseMatch lost per claim that overstates what the guide really holds. */
const STRETCHED_CLAIM_COST = 15;
/** Under this `interior`, the pages cannot ship whatever the text is worth. */
const HOLLOW_INTERIOR = 50;

export function scorePdf(content: PdfContent, ctx: { audience: string; problem: string; voc?: VoiceOfCustomer; design?: DesignSpec | null; visual?: VisualReport | null }): QualityReport {
  const issues = new IssueList();
  const chapters = content?.chapters ?? [];
  const nCh = chapters.length;
  const full = pdfText(content);
  const normFull = norm(full);
  const words = countWords(full);
  const audTok = keyTokens(`${ctx.audience} ${content?.audience ?? ''}`);
  const probTok = keyTokens(ctx.problem);
  const titleStems = stemSet(`${content?.title ?? ''} ${content?.subtitle ?? ''}`);
  const substance = guideSubstance(content);

  // specificity — rule of one (one problem, one audience), then the customers' real problems: how many the guide treats
  issues.section('specificity');
  let spec = 0;
  if (/\d/.test(`${content?.title ?? ''} ${content?.subtitle ?? ''}`)) spec += 8;
  else issues.push('Le titre ne contient aucun repère précis (âge, durée, nombre) : ajoutez-en un, par ex. « de 6 à 12 mois » ou « en 30 jours ».');
  const audInTitle = overlap(audTok, titleStems);
  spec += 12 * Math.min(1, audInTitle * 2.5);
  if (audInTitle === 0) issues.push(`Le titre ne dit pas pour qui est le guide : nommez l'audience (« ${ctx.audience} »).`);
  const probInTitle = overlap(probTok, titleStems);
  spec += 12 * Math.min(1, probInTitle * 2.5);
  if (probInTitle === 0) issues.push('Le titre ne nomme pas le problème avec les mots des clients.');
  const aud = content?.audience ?? '';
  if (aud.length >= 15 && (/\d/.test(aud) || keyTokens(aud).length >= 3)) spec += 4;
  else issues.push('Audience trop vague : précisez âge, situation ou métier (règle du un).');
  if (nCh > 0) {
    const audShare = chapters.filter((c) => overlap(audTok, stemSet(chapterText(c))) > 0).length / nCh;
    spec += 12 * audShare;
    if (audShare < 0.5) issues.block("L'audience disparaît au fil des chapitres : parlez-lui directement dans chaque chapitre.");
    const probShare = chapters.filter((c) => overlap(probTok, stemSet(chapterText(c))) > 0).length / nCh;
    spec += 12 * probShare;
    if (probShare < 0.5) issues.block('Plusieurs chapitres s\'éloignent du problème central : un guide = un seul problème.');
    if (nCh > 12) { spec -= 10; issues.push(`${nCh} chapitres : le guide se disperse, regroupez en 5 à 9 chapitres.`); }
  }
  const pains = ctx.voc?.pains.length ?? 0;
  const untreated = untreatedPains(content, ctx.voc);
  spec += 40 * (pains ? 1 - untreated.length / pains : 0.6);
  if (untreated.length) issues.push(`${untreated.length} douleur(s) client sur ${pains} ne sont traitées dans aucun chapitre (${quote(untreated, 2)}).`);

  // structure — intro, ≥5 chapters, numbered steps, worked cases, bonus, printable tools, next step
  issues.section('structure');
  let struct = 0;
  const intro = content?.introduction ?? [];
  struct += intro.length >= 2 ? 8 : intro.length === 1 ? 4 : 0;
  if (intro.length === 0) issues.block("Pas d'introduction : reformulez le problème et dites ce que le lecteur aura à la fin.");
  struct += nCh >= 5 ? 17 : nCh === 4 ? 10 : nCh === 3 ? 7 : nCh * 2;
  if (nCh < 5) issues.block(`Seulement ${nCh} chapitre(s) : visez au moins 5 chapitres en étapes.`);
  if (nCh > 0) {
    const stepShare = chapters.filter((c) => (c.steps?.length ?? 0) >= 3).length / nCh;
    struct += 10 * stepShare;
    if (stepShare < 0.6) issues.block('Trop de chapitres sans étapes numérotées (au moins 3 par chapitre).');
    const exShare = chapters.filter((c) => (c.example ?? '').length > 40).length / nCh;
    struct += 35 * (substance.cases / nCh);
    if (exShare === 0) issues.block('Aucun exemple concret : ajoutez des exemples types réalistes, annoncés comme tels (prénom, âge, situation, ce qui a été fait).');
    else if (substance.cases / nCh < 0.4) issues.push('Peu de cas concrets : un exemple type propre à chaque chapitre (qui, quelle situation, quel geste) rend le guide crédible.');
  }
  const bonus = content?.bonus;
  if (bonus && bonus.title && ((bonus.paragraphs?.length ?? 0) + (bonus.steps?.length ?? 0) + (bonus.checklist?.length ?? 0)) > 0) struct += 15;
  else issues.block('Pas de chapitre bonus : il permet d\'annoncer un « cadeau inclus » sur la page de vente.');
  if (content?.nextStep?.title && (content.nextStep.text ?? '').length > 30) struct += 5;
  else issues.block('Pas de page finale « La suite est ici » vers le guide suivant (upsell).');
  struct += 10 * Math.min(1, substance.sheets / 2);

  // actionability — lists to follow, steps that say how much and how long, chapters with something new to say
  issues.section('actionability');
  const allSteps = chapters.flatMap((c) => c.steps ?? []);
  const items = allSteps.length + chapters.reduce((s, c) => s + (c.checklist?.length ?? 0), 0);
  const perChapter = items / Math.max(1, nCh);
  let action = 30 * Math.min(1, perChapter / ITEMS_PER_CHAPTER);
  if (allSteps.length > 0) {
    action += 10 * (allSteps.filter((s) => countWords(s) >= 6).length / allSteps.length);
    action += 25 * Math.min(1, substance.concreteSteps / CONCRETE_STEPS_TARGET);
  }
  const freshPerChapter = substance.freshWords / Math.max(5, nCh);
  action += 35 * Math.min(1, freshPerChapter / FRESH_WORDS_PER_CHAPTER);
  if (perChapter < 5) issues.push('Pas assez d\'actions concrètes : ajoutez étapes et checklists (au moins 5 par chapitre).');
  if (allSteps.length > 0 && substance.concreteSteps < CONCRETE_STEPS_TARGET / 2) issues.push('Trop d\'étapes sans durée ni quantité : dites combien, combien de temps, à quel moment.');
  if (words < 1500) { action *= 0.6; issues.block(`Guide trop mince (${words} mots) : un acheteur attend au moins 3 000 mots utiles.`); }
  else if (freshPerChapter < FRESH_WORDS_PER_CHAPTER / 2) issues.push(`Contenu un peu court (${substance.freshWords} mots nouveaux sur ${words}) : développez les étapes et les exemples.`);

  // human tone — generic AI clichés, repetitive sentence starts, customer words reused, text served twice
  issues.section('humanTone');
  const generic = genericPhraseHits(normFull);
  let human = 70 - Math.min(60, generic.total * 7);
  if (generic.total > 0) issues[generic.total >= GENERIC_BLOCKING ? 'block' : 'push'](`${generic.total} phrase(s) générique(s) « IA » détectée(s) (${quote(generic.found)}) : remplacez-les par des détails tirés des avis clients.`);
  const rep = repetitiveStarts(full);
  if (rep.share > 0.2) {
    human -= Math.min(20, (rep.share - 0.2) * 100);
    issues.push(`Trop de phrases commencent par « ${rep.word} » : variez les débuts de phrase.`);
  }
  const voc = vocPhraseHits(normFull, ctx.voc);
  human += Math.min(26, voc * 4);
  if (ctx.voc && voc === 0) issues.block('Aucune phrase de client reprise : citez leurs mots exacts (« il se réveille toutes les 2 h »…).');
  human -= Math.min(35, Math.max(0, substance.repeatedShare - REPEAT_TOLERATED) * 100);
  const twice = substance.repeatedSentences.length;
  human -= Math.min(30, twice * 5);
  if (twice > 0) issues[twice >= REPEAT_BLOCKING ? 'block' : 'push'](`${twice} phrase(s) imprimée(s) plusieurs fois (${quote(substance.repeatedSentences, 2)}) : un acheteur le voit, supprimez les répétitions.`);

  // design — visuals per chapter, design spec, variety
  issues.section('design');
  let design = 0;
  if (nCh > 0) {
    const visuals = chapters.filter((c) => !!c.visual);
    design += 55 * (visuals.length / nCh);
    const kinds = new Set(visuals.map((c) => c.visual!.type)).size;
    design += kinds >= 3 ? 20 : kinds === 2 ? 10 : 0;
    if (visuals.length / nCh < 0.5) issues.block('Moins d\'un chapitre sur deux a un visuel : ajoutez frises, checklists ou schémas d\'étapes.');
  }
  if (ctx.design) design += 25;
  else issues.push('Aucune charte graphique (DesignSpec) : la mise en page sera générique.');
  // the real pages, once they exist. The weight stays .04: visual has its own way to the market (sim/visual.ts)
  if (ctx.visual) {
    design = ctx.visual.interior;
    if (design < HOLLOW_INTERIOR) issues.block(ctx.visual.issues[0] ?? 'Mise en page creuse : des pages à moitié vides.');
  }

  // compliance — risky claims (health, money, guarantees)
  issues.section('compliance');
  const banned = findBannedClaims([full, ...printedAside(content)], ctx.voc?.bannedClaims ?? []);
  const compliance = 100 - banned.length * 18;
  if (banned.length) issues.block(`Allégations risquées à retirer : ${quote(banned, 4)}.`);

  // promise — what the guide announces is in the guide: bonus, number of steps, length of the plan
  issues.section('promiseMatch');
  const broken = brokenPromises(content);
  for (const b of broken) issues.block(b);

  return report(
    { specificity: spec, structure: struct, actionability: action, humanTone: human, design, promiseMatch: 100 - broken.length * BROKEN_PROMISE_COST, compliance },
    { specificity: 0.23, structure: 0.18, actionability: 0.3, humanTone: 0.17, design: 0.04, promiseMatch: 0.05, compliance: 0.03 },
    issues,
    compliance < 60 ? 40 + compliance / 2 : undefined,
  );
}

// ───────────────────────────── Sales page ─────────────────────────────

const INFORMAL_RE = /\b(je|j'|mon|ma|mes|il se|elle se|on |tu )|«|"/i;
const CTA_VERBS = /^(je |j'|télécharg|telecharg|obten|recev|commenc|accéd|acced|découvr|decouvr|profit|prends|récupèr|recuper|lire|essayer|ajouter)/i;
/** Answers that would fit any objection. */
const STOCK_ANSWER = /y repond concretement|question que beaucoup se posent|essayer le premier chapitre/;

/** Objections that get an answer of their own: a sentence said twice, or one that fits anything, answers nothing. */
function answeredObjections(objections: SalesPage['objections']): number {
  const count = new Map<string, number>();
  for (const o of objections) count.set(norm(o.a ?? ''), (count.get(norm(o.a ?? '')) ?? 0) + 1);
  return objections.filter((o) => {
    const a = norm(o.a ?? '');
    return a.length >= 40 && count.get(a) === 1 && !STOCK_ANSWER.test(a);
  }).length;
}

/** Promise gap measured on hype + exaggeration words vs. the PDF's real quality (0 = matched). */
export function promiseGap(hypeLevel: number, hypeWords: number, pdfOverall: number): number {
  const promise = clamp(hypeLevel, 0, 1) + 0.05 * hypeWords;
  const allowed = pdfOverall / 100 - 0.15;
  return Math.max(0, promise - allowed);
}

export function scoreSalesPage(sp: SalesPage, product: Product, voc?: VoiceOfCustomer): QualityReport {
  const issues = new IssueList();
  const audTok = keyTokens(product.audience);
  const probTok = keyTokens(product.problem);
  const headline = sp?.headline ?? '';
  const hStems = stemSet(`${headline} ${sp?.subheadline ?? ''}`);
  const pains = sp?.painBullets ?? [];
  const blurbs = sp?.chapterBlurbs ?? [];
  const objections = sp?.objections ?? [];
  const pageWords = stemSet([headline, sp?.subheadline, sp?.solution, sp?.bonusBlurb, ...blurbs.map((b) => `${b.title} ${b.blurb}`)].join(' '));
  const answered = answeredObjections(objections);

  issues.section('specificity');
  let spec = 0;
  if (/\d/.test(headline)) spec += 10; else issues.push('Le titre de la page ne contient aucun repère chiffré (âge, durée, résultat).');
  const aud = overlap(audTok, hStems); spec += 15 * Math.min(1, aud * 2.5);
  if (aud === 0) issues.block("Le titre de la page ne dit pas à qui s'adresse le guide.");
  const prob = overlap(probTok, hStems); spec += 15 * Math.min(1, prob * 2.5);
  if (prob === 0) issues.block('Le titre de la page ne nomme pas la douleur principale.');
  if (headline.length >= 25 && headline.length <= 110) spec += 5; else issues.push('Titre de page trop court ou trop long (25 à 110 caractères).');
  if ((sp?.subheadline ?? '').length >= 20) spec += 5; else issues.push('Ajoutez un sous-titre qui précise la promesse.');
  // showing what is inside: the printable tools a buyer will really get, named on the page
  const tools = [...(product.content?.chapters ?? []), product.content?.bonus].filter(isSheet).map((c) => keyTokens(c!.visual!.title));
  const shown = tools.filter((t) => overlap(t, pageWords) >= 0.5).length;
  spec += 35 * (tools.length ? Math.min(1, shown / Math.min(3, tools.length)) : 0.4);
  if (tools.length && shown === 0) issues.push('La page ne montre aucun des outils du guide : nommez les grilles et fiches que l\'acheteur recevra.');
  if (voc && vocPhraseHits(norm(headline), voc) > 0) spec += 15;
  else if (voc) issues.push('Le titre de la page n\'est pas écrit avec les mots des clients.');

  issues.section('structure');
  let struct = 0;
  struct += pains.length >= 4 ? 10 : pains.length >= 2 ? 5 : 0;
  if (pains.length < 4) issues.push('Moins de 4 puces de douleur : appuyez sur le problème avec les mots des clients.');
  const chCount = product.content?.chapters?.length ?? 5;
  struct += blurbs.length >= Math.min(5, chCount) ? 10 : blurbs.length > 0 ? 5 : 0;
  if (blurbs.length === 0) issues.push('Le contenu n\'est pas détaillé chapitre par chapitre.');
  if ((sp?.bonusBlurb ?? '').length > 15) struct += 10; else issues.push('Le bonus offert n\'est pas mis en avant.');
  struct += objections.length >= 3 ? 5 : objections.length > 0 ? 2 : 0;
  if (objections.length < 3) issues.block('Traitez au moins 3 objections (« encore un PDF ChatGPT ? », « j\'ai déjà tout essayé »…).');
  struct += 30 * (objections.length ? answered / objections.length : 0);
  if (objections.length && answered < objections.length) issues.push(`${objections.length - answered} objection(s) sur ${objections.length} reçoivent une réponse passe-partout : répondez à ce que le client dit vraiment.`);
  const known = voc?.objections ?? [];
  const treated = known.filter((k) => objections.some((o) => overlap(keyTokens(k), stemSet(o.q ?? '')) >= 0.5)).length;
  struct += 15 * (known.length ? Math.min(1, treated / Math.min(5, known.length)) : 0.6);
  if ((sp?.guarantee ?? '').length > 15) struct += 10; else issues.block('Aucune garantie claire (ex. « satisfait ou remboursé 14 jours »).');
  if ((sp?.cta ?? '').length > 3) struct += 10; else issues.block('Pas d\'appel à l\'action.');

  issues.section('actionability');
  let action = 0;
  const cta = (sp?.cta ?? '').trim();
  if (cta && CTA_VERBS.test(cta) && cta.length <= 45) action += 50;
  else if (cta) { action += 25; issues.push('Appel à l\'action peu clair : commencez par un verbe (« Je télécharge le guide »).'); }
  const sol = sp?.solution ?? '';
  if (sol.length >= 80 && sol.length <= 700) action += 30; else issues.push('La section solution doit expliquer la méthode en 2 à 5 phrases.');
  if (blurbs.length) action += 20 * (blurbs.filter((b) => countWords(b.blurb ?? '') >= 8).length / blurbs.length);

  const allText = [headline, sp?.subheadline, ...pains, sol, ...blurbs.map((b) => `${b.title} ${b.blurb}`), sp?.bonusBlurb, ...objections.map((o) => `${o.q} ${o.a}`), cta].join('\n');
  const normAll = norm(allText);
  issues.section('humanTone');
  const generic = genericPhraseHits(normAll);
  let human = 50 - Math.min(50, generic.total * 8);
  if (generic.total) issues.push(`Phrases génériques sur la page : ${quote(generic.found)}.`);
  if (pains.length) {
    const vocHit = voc ? pains.filter((p) => vocPhraseHits(norm(p), voc) > 0).length : 0;
    const informal = pains.filter((p) => INFORMAL_RE.test(p)).length;
    human += 27 * Math.min(1, (Math.max(vocHit * 1.5, informal) / pains.length));
    if (vocHit === 0 && informal === 0) issues.push('Les puces de douleur ne reprennent pas les mots des clients (formulations vécues, à la première personne).');
  }
  if (objections.length) human += 15 * (answered / objections.length);

  let design = product.visual ? 0.7 * product.visual.cover : 40 + (product.design ? 30 : 0);
  if (blurbs.length) design += 30 * (blurbs.filter((b) => (b.title ?? '').length > 3).length / blurbs.length);
  if (objections.length) design = Math.min(100, design) * (0.85 + 0.15 * (objections.filter((o) => (o.a ?? '').length >= 20).length / objections.length));

  issues.section('promiseMatch');
  const hype = countHype([headline, sp?.subheadline, sol, cta]);
  const pdfQ = product.quality?.overall ?? 60;
  const gap = promiseGap(sp?.hypeLevel ?? 0.5, hype, pdfQ);
  const unbacked = unbackedClaims(sp, product.content);
  const promiseMatch = 100 - gap * 150 - unbacked.lies.length * BROKEN_PROMISE_COST - unbacked.stretches.length * STRETCHED_CLAIM_COST;
  if (gap > 0.15) issues.block(`La page promet plus que le guide ne livre (niveau de promesse ${Math.round((sp?.hypeLevel ?? 0) * 100)} % pour un PDF à ${Math.round(pdfQ)}/100) : risque de remboursements.`);
  for (const u of unbacked.lies) issues.block(u);
  for (const u of unbacked.stretches) issues.push(u);

  issues.section('compliance');
  // An objection's question is the customer's sentence, whether the page prints it in quotes or not: only the answer is ours.
  const nonGuarantee = [headline, sp?.subheadline, ...pains, sol, ...blurbs.map((b) => `${b.title} ${b.blurb}`), sp?.bonusBlurb, ...objections.map((o) => o.a), cta];
  const banned = [...findPageClaims(nonGuarantee, voc?.bannedClaims ?? [])];
  for (const b of findPageClaims([sp?.guarantee], voc?.bannedClaims ?? [])) if (!banned.includes(b)) banned.push(b);
  const compliance = 100 - banned.length * 20;
  if (banned.length) issues.block(`Allégations interdites sur la page : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: action, humanTone: human, design, promiseMatch, compliance },
    { specificity: 0.35, structure: 0.27, actionability: 0.05, humanTone: 0.15, design: 0.03, promiseMatch: 0.1, compliance: 0.05 },
    issues,
    compliance < 60 ? 40 + compliance / 2 : undefined,
  );
}

// ───────────────────────────── Ad creative ─────────────────────────────

const SOLUTION_RE = /guide|methode|pdf|etapes?|plan|routine|programme|checklist|fiches?|astuces?|technique/;
const CTA_RE = /lien|bio|telecharg|clique|decouvr|recupere|commande|profil|guide/;

/** A still is read in a second: the hook must fit under the eye, the screen must stay short. */
const STATIC_AD = { hookMax: 60, hookMin: 15, screenChars: 70, screenWords: 12 } as const;
/** A search ad's limits: 3 to 5 titles of 30 characters, 2 descriptions of 90. */
const SEARCH_AD = { titles: { min: 3, max: 5, chars: 30 }, descriptions: { count: 2, chars: 90 }, keywords: { min: 3, max: 15 } } as const;

/** A Pinterest pin or a Meta feed image: one frame, no voice. New format, it never reads the video rules below. */
export function scoreStaticAd(c: AdCreative, product: Product, voc?: VoiceOfCustomer): QualityReport {
  const issues = new IssueList();
  const hook = (c?.hook ?? '').trim();
  const screen = (c?.scenes?.[0]?.onScreenText ?? '').trim();
  const visible = `${hook} ${screen}`;
  const allText = [hook, screen, c?.caption, c?.cta, (c?.hashtags ?? []).join(' ')].join('\n');
  const normAll = norm(allText);
  const stems = stemSet(visible);

  issues.section('specificity');
  const rel = Math.max(overlap(keyTokens(product.audience), stems), overlap([...keyTokens(product.problem), ...keyTokens(product.title)], stems));
  let spec = 50 * Math.min(1, rel * 3);
  if (rel === 0) issues.block('L\'image ne parle ni du problème ni de la cible : on doit se reconnaître d\'un coup d\'œil.');
  const vocHits = vocPhraseHits(normAll, voc);
  spec += voc ? Math.min(30, vocHits * 15) : 15;
  if (voc && vocHits === 0) issues.push('Aucun mot de client repris : une image vit de la phrase qu\'on reconnaît.');
  spec += (c?.hashtags?.length ?? 0) >= 3 ? 10 : 0;
  spec += genericPhraseHits(norm(hook)).total ? 0 : 10;

  issues.section('structure');
  let struct = 0;
  if (hook.length >= STATIC_AD.hookMin && hook.length <= STATIC_AD.hookMax) struct += 60;
  else if (hook.length > 0 && hook.length <= 90) { struct += 25; issues.push(`Accroche de ${hook.length} caractères : visez moins de ${STATIC_AD.hookMax} sur une image.`); }
  else issues.block('Accroche absente ou beaucoup trop longue pour une image.');
  if ((c?.scenes?.length ?? 0) === 1) struct += 40;
  else issues.push('Une image fixe, c\'est une seule scène.');

  issues.section('actionability');
  const ctaOk = (c?.cta ?? '').length > 3 && CTA_RE.test(norm(c.cta));
  if (!ctaOk) issues.block('Pas d\'appel à l\'action sur l\'image (« télécharge le guide »).');

  issues.section('humanTone');
  let human = 80 - Math.min(40, genericPhraseHits(normAll).total * 10);
  if (voc) human += Math.min(20, vocHits * 8);
  const hype = countHype([hook, screen, c?.caption]);
  human -= Math.min(20, hype * 6);

  issues.section('design');
  let design = 0;
  const legible = screen.length > 0 && screen.length <= STATIC_AD.screenChars && countWords(screen) <= STATIC_AD.screenWords;
  if (legible) design += 70; else issues.push(`Texte de l'image illisible en miniature : ${STATIC_AD.screenWords} mots maximum.`);
  if ((c?.scenes?.[0]?.visual ?? '').length >= 10) design += 30;

  issues.section('promiseMatch');
  const promiseMatch = 100 - hype * 15;
  if (hype >= 2) issues.push('Trop de superlatifs (« incroyable », « secret »…) : ça sonne arnaque et augmente les refus.');

  issues.section('compliance');
  const banned = findBannedClaims([allText], voc?.bannedClaims ?? []);
  const compliance = 100 - banned.length * 30;
  if (banned.length) issues.block(`Refus probable : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: ctaOk ? 100 : 0, humanTone: human, design, promiseMatch, compliance },
    { specificity: 0.25, structure: 0.2, actionability: 0.15, humanTone: 0.1, design: 0.15, promiseMatch: 0.05, compliance: 0.1 },
    issues,
    compliance < 60 ? 35 + compliance / 2 : undefined,
  );
}

/**
 * A Search ad: what the buyer typed must come back in a title. That is why a word the platform refuses has a price: the
 * keyword stays bid on, the title loses it, the score falls and the click costs more (channels §6).
 */
export function scoreSearchAd(c: AdCreative, product: Product, voc?: VoiceOfCustomer): QualityReport {
  const issues = new IssueList();
  const { headlines = [], descriptions = [], keywords = [] } = c?.search ?? {};
  const titles = headlines.join('\n');
  const body = descriptions.join('\n');
  const shown = `${titles}\n${body}`;
  const titleStems = stemSet(titles);

  issues.section('specificity');
  const head = keyTokens(keywords[0] ?? '');
  const headHit = overlap(head, titleStems);
  let spec = 40 * headHit;
  if (headHit === 0) issues.block('Le mot-clé principal n\'apparaît dans aucun titre : l\'annonce ne répond pas à la recherche.');
  const allKeys = keyTokens(keywords.join(' '));
  spec += 20 * Math.min(1, overlap(allKeys, titleStems) * 2);
  const probTok = [...keyTokens(product.problem), ...keyTokens(product.title)];
  const rel = overlap(probTok, stemSet(shown));
  spec += 25 * Math.min(1, rel * 3);
  if (rel === 0) issues.push('L\'annonce ne dit pas le problème du lecteur.');
  const vocHits = vocPhraseHits(norm(shown), voc);
  spec += voc ? Math.min(15, vocHits * 15) : 8;

  issues.section('structure');
  let struct = 0;
  const { titles: t, descriptions: d, keywords: k } = SEARCH_AD;
  const titlesFit = headlines.length >= t.min && headlines.length <= t.max && headlines.every((h) => h.length > 0 && h.length <= t.chars);
  if (titlesFit) struct += 40; else issues.block(`Titres hors limites : ${t.min} à ${t.max} titres de ${t.chars} caractères maximum.`);
  const descFit = descriptions.length === d.count && descriptions.every((x) => x.length > 0 && x.length <= d.chars);
  if (descFit) struct += 40; else issues.block(`Descriptions hors limites : ${d.count} descriptions de ${d.chars} caractères maximum.`);
  if (keywords.length >= k.min && keywords.length <= k.max) struct += 20; else issues.push(`${keywords.length} mot(s)-clé(s) : visez ${k.min} à ${k.max} requêtes.`);

  issues.section('actionability');
  const ctaOk = CTA_RE.test(norm(body));
  if (!ctaOk) issues.block('Pas d\'appel à l\'action dans les descriptions (« télécharge le guide »).');
  const solOk = SOLUTION_RE.test(norm(shown));
  if (!solOk) issues.push('L\'annonce ne dit pas ce qu\'on vend (le guide, la méthode).');

  issues.section('humanTone');
  let human = 85 - Math.min(40, genericPhraseHits(norm(shown)).total * 15);
  const hype = countHype([shown]);
  human -= Math.min(20, hype * 6);
  if (voc) human += Math.min(15, vocHits * 8);

  issues.section('design');
  const shouts = headlines.filter((h) => /!|\p{Lu}{6}/u.test(h)).length;
  const repeats = headlines.length - new Set(headlines.map(norm)).size;
  const design = 100 - shouts * 25 - repeats * 25;
  if (shouts) issues.push('Pas de point d\'exclamation ni de mot en capitales dans un titre.');
  if (repeats) issues.push('Deux titres identiques : chaque titre doit apporter autre chose.');

  issues.section('promiseMatch');
  const promiseMatch = 100 - hype * 15;

  issues.section('compliance');
  const banned = findBannedClaims([shown], voc?.bannedClaims ?? []);
  const compliance = 100 - banned.length * 30;
  if (banned.length) issues.block(`Refus probable : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: (ctaOk ? 70 : 0) + (solOk ? 30 : 0), humanTone: human, design, promiseMatch, compliance },
    { specificity: 0.35, structure: 0.2, actionability: 0.15, humanTone: 0.1, design: 0.05, promiseMatch: 0.05, compliance: 0.1 },
    issues,
    compliance < 60 ? 35 + compliance / 2 : undefined,
  );
}

export function scoreCreative(c: AdCreative, product: Product, voc?: VoiceOfCustomer): QualityReport {
  if (c?.format === 'static_image') return scoreStaticAd(c, product, voc);
  if (c?.format === 'search_text') return scoreSearchAd(c, product, voc);
  const issues = new IssueList();
  const scenes = c?.scenes ?? [];
  const cut = c?.cut ? scoreCut(c.cut) : null; // absent on old saves: the old formulas below
  const hook = (c?.hook ?? '').trim();
  const normHook = norm(hook);
  const audTok = keyTokens(product.audience);
  const probTok = [...keyTokens(product.problem), ...keyTokens(product.title)];
  const sceneText = scenes.map((s) => `${s.onScreenText} ${s.voiceover}`).join('\n');
  const allText = [hook, sceneText, c?.caption, c?.cta, (c?.hashtags ?? []).join(' ')].join('\n');
  const normAll = norm(allText);

  issues.section('specificity');
  let spec = 0;
  const hookStems = stemSet(`${hook} ${scenes[0]?.onScreenText ?? ''} ${scenes[0]?.voiceover ?? ''}`);
  const hookRel = Math.max(overlap(audTok, hookStems), overlap(probTok, hookStems));
  spec += 30 * Math.min(1, hookRel * 3);
  if (hookRel === 0) issues.block('Le hook ne parle ni du problème ni de la cible : on doit se reconnaître en 2 secondes.');
  if (/\d/.test(hook)) spec += 15;
  const vocHits = vocPhraseHits(normAll, voc);
  spec += voc ? Math.min(30, vocHits * 15) : 15;
  if (voc && vocHits === 0) issues.push('Aucun mot de client repris dans la pub : citez une phrase vraie (« dès que je le pose il hurle »).');
  const tags = c?.hashtags?.length ?? 0;
  spec += tags >= 3 && tags <= 8 ? 10 : tags > 0 ? 5 : 0;
  const genericHook = genericPhraseHits(normHook).total;
  spec += genericHook ? 0 : 15;

  issues.section('structure');
  let struct = 0;
  const first = norm(`${scenes[0]?.onScreenText ?? ''} ${scenes[0]?.voiceover ?? ''}`);
  const hookTokens = keyTokens(hook);
  const hookInFirst = hookTokens.length > 0 && overlap(hookTokens, stemSet(first)) >= 0.5;
  if (hookInFirst) struct += 20; else issues.block('Le hook doit apparaître dans la première scène (2 premières secondes).');
  if (hook.length >= 25 && hook.length <= 90) struct += 15;
  else if (hook.length > 0 && hook.length <= 120) { struct += 7; issues.push('Hook trop court ou trop long : visez 25 à 90 caractères.'); }
  else issues.block('Hook absent ou beaucoup trop long.');
  const restStems = stemSet(scenes.slice(0, Math.max(1, scenes.length - 1)).map((s) => `${s.onScreenText} ${s.voiceover}`).join(' '));
  const painOk = overlap(probTok, restStems) > 0 || (voc ? vocPhraseHits(norm(sceneText), voc) > 0 : false);
  if (painOk) struct += 15; else issues.block('La douleur n\'est pas montrée avant la solution.');
  const solOk = SOLUTION_RE.test(norm(sceneText));
  if (solOk) struct += 15; else issues.block('La solution (le guide, la méthode) n\'apparaît pas clairement.');
  const last = norm(`${scenes[scenes.length - 1]?.onScreenText ?? ''} ${scenes[scenes.length - 1]?.voiceover ?? ''} ${c?.cta ?? ''}`);
  const ctaOk = CTA_RE.test(last);
  if (ctaOk) struct += 15; else issues.block('Pas d\'appel à l\'action à la fin (« lien en bio », « télécharge le guide »).');
  if (cut) {
    struct += 20 * cut.pace;
    for (const note of cut.notes) issues.push(note);
  } else {
    struct += scenes.length >= 3 && scenes.length <= 7 ? 20 : scenes.length === 2 || scenes.length === 8 || scenes.length === 9 ? 8 : 0;
    if (scenes.length < 3 || scenes.length > 7) issues.push(`${scenes.length} scène(s) : visez 3 à 7 scènes.`);
  }

  issues.section('actionability');
  let action = 0;
  if ((c?.cta ?? '').length > 3 && CTA_RE.test(norm(c.cta))) action += 60; else if ((c?.cta ?? '').length > 3) action += 30;
  // `durationSec` is fiction: a cut knows what the voice really takes
  const duration = c?.cut ? c.cut.metrics.estSec : scenes.reduce((s, x) => s + (Number.isFinite(x.durationSec) ? x.durationSec : 0), 0);
  if (duration >= 12 && duration <= 30) action += 40;
  else if (duration >= 9 && duration <= 40) { action += 20; issues.push(`Durée ${Math.round(duration)} s : le format idéal est 12 à 30 secondes.`); }
  else issues.push(`Durée ${Math.round(duration)} s hors format (12 à 30 secondes).`);

  issues.section('humanTone');
  let human = 80 - Math.min(40, genericPhraseHits(normAll).total * 10);
  if (voc) human += Math.min(20, vocHits * 8);
  const hype = countHype([hook, sceneText, c?.caption]);
  human -= Math.min(20, hype * 6);

  issues.section('design');
  let design = 0;
  if (scenes.length) {
    if (!cut) {
      const shortText = scenes.filter((s) => (s.onScreenText ?? '').length > 0 && (s.onScreenText ?? '').length <= 70 && countWords(s.onScreenText) <= 12).length / scenes.length;
      design += 50 * shortText;
      if (shortText < 0.7) issues.push('Textes à l\'écran trop longs : 12 mots maximum par scène.');
      design += 30 * (scenes.filter((s) => (s.visual ?? '').length >= 10).length / scenes.length);
    }
    const fmtOk = c.format === 'text_slideshow' ? scenes.every((s) => (s.onScreenText ?? '').length > 0)
      : c.format === 'carousel' ? scenes.length >= 4
        : scenes.every((s) => (s.voiceover ?? '').length > 0);
    design = cut ? 100 * cut.look : design + (fmtOk ? 20 : 0);
    if (!fmtOk) issues.block(`Les scènes ne respectent pas le format « ${c.format} » (voix off / texte / nombre de slides).`);
  }

  issues.section('promiseMatch');
  const promiseMatch = 100 - hype * 15;
  if (hype >= 2) issues.push('Trop de superlatifs (« incroyable », « secret »…) : ça sonne arnaque et augmente les refus.');

  issues.section('compliance');
  const banned = findBannedClaims([allText], voc?.bannedClaims ?? []);
  const compliance = 100 - banned.length * 30;
  if (banned.length) issues.block(`Refus probable par TikTok : ${quote(banned, 4)}.`);

  return report(
    { specificity: spec, structure: struct, actionability: action, humanTone: human, design, promiseMatch, compliance },
    { specificity: 0.22, structure: 0.25, actionability: 0.1, humanTone: 0.13, design: 0.1, promiseMatch: 0.05, compliance: 0.15 },
    issues,
    compliance < 60 ? 35 + compliance / 2 : undefined,
  );
}

// ───────────────────────────── E-mail ─────────────────────────────

/** Read on a phone, between two other mails. */
const EMAIL = { subject: { min: 15, max: 60, tolerated: 90 }, words: { min: 40, max: 260 } } as const;

/** An e-mail, as the list reads it: an object that gets it opened, a short text that sounds like someone, one thing to click. Same generic-phrase and banned-claim checks as the ads. */
export function scoreEmail(subject: string, body: string, voc: VoiceOfCustomer | undefined, bannedClaims: readonly string[]): { score: number; issues: string[] } {
  const issues: string[] = [];
  const object = (subject ?? '').trim();
  const text = (body ?? '').trim();
  const all = norm(`${object}\n${text}`);
  let score = 0;

  if (object.length >= EMAIL.subject.min && object.length <= EMAIL.subject.max) score += 20;
  else if (object.length > 0 && object.length <= EMAIL.subject.tolerated) { score += 8; issues.push(`Objet de ${object.length} caractères : visez entre ${EMAIL.subject.min} et ${EMAIL.subject.max}.`); }
  else issues.push('Objet absent ou beaucoup trop long.');
  if (/\d|\?/.test(object) || vocPhraseHits(norm(object), voc) > 0) score += 10;
  else issues.push('Objet sans chiffre, sans question ni mot de client : rien ne donne envie d\'ouvrir.');

  const words = countWords(text);
  if (words >= EMAIL.words.min && words <= EMAIL.words.max) score += 20;
  else if (words > 0) { score += 8; issues.push(`Texte de ${words} mots : visez entre ${EMAIL.words.min} et ${EMAIL.words.max}.`); }
  else issues.push('E-mail vide.');
  if (CTA_RE.test(norm(text))) score += 10;
  else issues.push('Pas d\'appel à l\'action : le lecteur ne sait pas quoi faire ensuite.');

  const hits = vocPhraseHits(all, voc);
  score += voc ? Math.min(20, hits * 10) : 10;
  if (voc && hits === 0) issues.push('Aucun mot de client repris : un e-mail vit de la phrase qu\'on reconnaît.');

  const generic = genericPhraseHits(all);
  const hype = countHype([object, text]);
  score += 20 - Math.min(20, generic.total * 7 + hype * 5);
  if (generic.total) issues.push(`Formules creuses : ${quote(generic.found)}.`);
  if (hype >= 2) issues.push('Trop de superlatifs (« incroyable », « secret »…) : ça sonne arnaque et fait fuir la liste.');

  const banned = findBannedClaims([object, text], bannedClaims);
  if (banned.length) {
    score = Math.min(score, 35 - banned.length * 5);
    issues.unshift(`Allégation interdite : ${quote(banned, 4)}.`);
  }
  return { score: Math.round(clamp(score, 0, 100)), issues: issues.slice(0, 8) };
}

// ───────────────────────────── Support reply ─────────────────────────────

type Action = SupportReplyInput['action'];
interface ActionRule { right: Action[]; ok: Action[]; danger: Action[] }

export const DOUBLE_CHARGE_RE = /deux fois|2 fois|double|debite deux|preleve deux/;

export function actionRule(msg: Pick<InboxMessage, 'intent' | 'body'> & { orderId?: string | null }): ActionRule {
  switch (msg.intent) {
    case 'question': return { right: ['none', 'resend_link'], ok: ['discount_code', 'escalate'], danger: [] };
    case 'non_recu': return { right: ['resend_link'], ok: ['refund'], danger: ['block'] };
    case 'remboursement': return { right: ['refund'], ok: ['discount_code', 'escalate'], danger: ['block'] };
    case 'plainte_qualite': return { right: ['refund', 'discount_code'], ok: ['none', 'escalate'], danger: ['block'] };
    case 'sur_mesure': return { right: ['none', 'escalate'], ok: ['discount_code'], danger: ['block'] };
    case 'partenariat': return { right: ['none', 'ignore', 'block'], ok: ['escalate'], danger: ['refund', 'discount_code'] };
    case 'arnaque':
      // a false claim from a real buyer: answering from the order's logs is as good as blocking, the file is already his
      return msg.orderId
        ? { right: ['none', 'block', 'ignore'], ok: ['resend_link', 'escalate'], danger: ['refund', 'discount_code'] }
        : { right: ['block', 'ignore'], ok: ['none'], danger: ['refund', 'discount_code', 'resend_link'] };
    case 'compliment': return { right: ['none'], ok: ['discount_code'], danger: ['block'] };
    case 'troll': return { right: ['ignore', 'none'], ok: ['block'], danger: ['refund', 'discount_code'] };
    case 'menace_chargeback': return { right: ['refund'], ok: ['escalate'], danger: ['block', 'ignore'] };
    case 'bug_paiement':
      return DOUBLE_CHARGE_RE.test(norm(msg.body ?? ''))
        ? { right: ['refund'], ok: ['resend_link', 'escalate'], danger: ['block'] }
        : { right: ['resend_link', 'none'], ok: ['escalate', 'refund'], danger: ['block'] };
    default: return { right: ['none'], ok: ['escalate'], danger: [] };
  }
}

const RELATED: [MessageIntent, MessageIntent][] = [
  ['remboursement', 'menace_chargeback'], ['remboursement', 'plainte_qualite'], ['non_recu', 'bug_paiement'],
  ['question', 'sur_mesure'], ['question', 'non_recu'], ['troll', 'arnaque'], ['partenariat', 'arnaque'], ['plainte_qualite', 'troll'],
];

function related(a: MessageIntent, b: MessageIntent): boolean {
  return RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

const EMPATHY = ['desole', 'navre', 'je comprends', 'nous comprenons', 'merci', 'toutes nos excuses', 'excusez', 'pardon pour', 'je suis vraiment', 'avec plaisir', 'ravi', 'ravie'];
const SIGN_OFF = ['cordialement', 'bien a vous', 'belle journee', 'bonne journee', 'bonne soiree', 'a bientot', "l'equipe", 'service client', 'au plaisir', 'chaleureusement'];
const RUDE = ['ridicule', "n'importe quoi", 'pas notre probleme', 'debrouillez', 'vous avez tort', 'menteur', 'mensonge', 'arretez de', 'lisez mieux', 'aucun effort', 'pathetique'];
const CONCRETE: Record<Action, RegExp> = {
  resend_link: /lien|telecharg|renvoy|nouvel envoi|spam|courrier indesirable/,
  refund: /rembours/,
  discount_code: /code|reduction|remise|geste/,
  none: /chapitre|page|etape|guide|pdf|methode|delai|heure|jours?|exemple/,
  escalate: /transmis|transmets|equipe|reviens|revenons|responsable|studio/,
  ignore: /./,
  block: /./,
};
const SILENT_OK: ReadonlySet<MessageIntent> = new Set<MessageIntent>(['arnaque', 'troll', 'partenariat']);

export function scoreSupportReply(msg: InboxMessage, reply: SupportReplyInput): { score: number; issues: string[] } {
  const issues: string[] = [];
  const text = (reply?.text ?? '').trim();
  const t = norm(text);
  const action = reply?.action ?? 'none';
  const rule = actionRule(msg);
  const silent = SILENT_OK.has(msg.intent) && (action === 'ignore' || action === 'block');
  let score = 0;

  if (reply?.detectedIntent === msg.intent) score += 20;
  else if (reply?.detectedIntent && related(reply.detectedIntent, msg.intent)) { score += 10; issues.push('Intention à moitié identifiée : relisez le message, la vraie demande est ailleurs.'); }
  else issues.push('Intention du client mal identifiée.');

  let danger = false;
  if (rule.right.includes(action)) score += 35;
  else if (rule.ok.includes(action)) { score += 18; issues.push(`Action acceptable mais pas idéale (« ${action} »).`); }
  else {
    danger = rule.danger.includes(action);
    issues.push(danger ? `Action dangereuse pour ce type de message (« ${action} »).` : `Action inadaptée (« ${action} ») pour ce message.`);
  }

  if (silent) {
    score += 15 + 10 + 10 + 10;
  } else {
    const empathy = EMPATHY.filter((e) => t.includes(e)).length;
    if (SILENT_OK.has(msg.intent)) score += text.length <= 220 ? 15 : 8;
    else { score += empathy >= 2 ? 15 : empathy === 1 ? 9 : 0; if (empathy === 0) issues.push('Aucune marque d\'empathie (excuses, remerciements, « je comprends »).'); }

    const len = text.length;
    if (msg.intent === 'troll') {
      score += len <= 220 ? 10 : len <= 400 ? 4 : 0;
      if (len > 300) { score -= 20; issues.push('On ne débat pas avec un troll : une phrase courte et polie suffit, ou ignorer.'); }
    } else if (len >= 120 && len <= 900) score += 10;
    else if ((len >= 60 && len < 120) || (len > 900 && len <= 1400)) { score += 5; issues.push(len < 120 ? 'Réponse un peu sèche : ajoutez une phrase de contexte.' : 'Réponse trop longue : allez à l\'essentiel.'); }
    else issues.push(len < 60 ? 'Réponse beaucoup trop courte.' : 'Réponse beaucoup trop longue.');

    const signed = SIGN_OFF.some((s) => t.includes(s)) || /\n\s*[—–-]\s*\S+\s*$/.test(text);
    if (signed) score += 10; else issues.push('Pas de signature ni de formule de politesse.');

    if ((CONCRETE[action] ?? /./).test(t)) score += 10; else issues.push('La réponse n\'annonce pas de solution concrète (lien, délai, remboursement…).');
  }

  const rude = RUDE.filter((r) => t.includes(r));
  if (rude.length) { score -= Math.min(40, rude.length * 25); issues.push(`Ton agressif à proscrire : ${quote(rude)}.`); }
  if (capsShare(text) > 0.4) { score -= 15; issues.push('Réponse en majuscules : ça se lit comme un cri.'); }
  if (msg.intent === 'arnaque' && !msg.orderId && /paie|paye|virement|carte bancaire|coordonnees|rib|iban|cliqu/.test(t) && !/jamais|ne .*pas|aucun|refus/.test(t)) {
    score -= 15; issues.push('Ne jamais accepter de payer, de cliquer ni de transmettre des coordonnées à un arnaqueur.');
  }
  if (hasPhrase(t, 'garanti') && !t.includes('satisfait ou rembourse')) { score -= 10; issues.push('Évitez de promettre un résultat « garanti ».'); }

  if (danger) score = Math.min(score, 15);
  return { score: Math.round(clamp(score, 0, 100)), issues: issues.slice(0, 8) };
}
