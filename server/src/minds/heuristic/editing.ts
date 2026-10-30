/**
 * Second pass on a draft: the humanizer (generic sentences → specific market details) and the
 * fact-checker (risky / unsupported claims → honest wording, with a French issue list).
 */
import type { PdfContent, VoiceOfCustomer } from '../../shared.js';
import type { GuideGaps } from '../../contracts.js';
import { CONNECTORS, isCliche, RISK_RULES } from '../lexicon.js';
import { ensurePdf, forEachText } from '../shapes.js';
import { allText, bare, cap, clean, fit, lf, norm, sentence, splitSentences, strArr, type LocalRng } from '../util.js';
import { parseKnowledge, type Material } from './knowledge.js';
import { safeVoc } from './niche.js';
import { dropRepeats, inline, pdfWordCount } from './studio.js';

// ───────────────────────────── humanize ─────────────────────────────

function flagMatcher(flagged: readonly string[]): (s: string) => boolean {
  const flags = strArr(flagged).map((f) => norm(bare(f))).filter((f) => f.length >= 4);
  return (s: string) => {
    if (isCliche(s)) return true;
    const n = norm(bare(s));
    if (!n) return false;
    return flags.some((f) => n.includes(f) || (f.includes(n) && n.length >= f.length * 0.6));
  };
}

/**
 * Research details the guide has not stated yet, each with a lead-in used once. A detail the document
 * already contains is never handed out: when the bank runs dry, a flat sentence is simply removed.
 * Customer phrases stay out of it: glued to any paragraph, a quote lands next to an unrelated topic.
 */
class DetailBank {
  private readonly queue: { text: string; key: string }[] = [];

  constructor(voc: VoiceOfCustomer, rng: LocalRng, private doc: string) {
    const core = materialOf(voc, doc);
    const tipLead = rng.shuffle(['Détail concret à retenir', 'Petit ajustement qui aide beaucoup', 'À tester cette semaine']);
    const factLead = rng.shuffle(['Bon à savoir', 'Repère utile', 'À garder en tête']);
    const fresh = (arr: readonly string[]) => arr.map((raw) => ({ raw, key: keyOf(raw) })).filter((x) => !this.doc.includes(x.key));
    fresh(core.tips).slice(0, tipLead.length).forEach((x, j) => this.queue.push({ text: `${tipLead[j]} : ${inline(x.raw)}.`, key: x.key }));
    fresh(core.facts).slice(0, factLead.length).forEach((x, j) => this.queue.push({ text: `${factLead[j]} : ${inline(x.raw)}.`, key: x.key }));
  }

  /** The first detail that talks about the same thing as the paragraph it will join. */
  next(paragraph: string): string | null {
    const here = new Set(stems(paragraph));
    for (let i = 0; i < this.queue.length; i++) {
      const d = this.queue[i]!;
      if (this.doc.includes(d.key) || !stems(d.key).some((w) => here.has(w))) continue;
      this.queue.splice(i, 1);
      this.doc += ` ${d.key}`;
      return d.text;
    }
    return null;
  }

  /** Any detail left: only when a chapter would otherwise have no prose at all. */
  any(): string | null {
    const d = this.queue.shift();
    return d ? d.text : null;
  }
}

const stems = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 6).map((w) => w.slice(0, 6));

function squash(s: string): string {
  return norm(s).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The research this guide was written from: a follow-up guide must not receive the main guide's details. */
function materialOf(voc: VoiceOfCustomer, doc: string): Material {
  const { core, topics } = parseKnowledge(voc.knowledge);
  const used = (m: Material): number => [...m.steps.map((s) => s.text), ...m.facts].filter((x) => doc.includes(keyOf(x))).length;
  return Object.values(topics).find((t) => used(t) >= 2) ?? core;
}

/** Comparable form of a research item: a detail is « seen » whatever the sentence around it. */
function keyOf(raw: string): string {
  return squash(inline(raw)).slice(0, 40);
}

const SAFE_TO_LOWER = new Set(['le', 'la', 'les', 'il', 'elle', 'on', 'vous', 'ce', 'cette', 'ces', 'un', 'une', 'si', 'quand', 'pour', 'dans', 'en', 'et', 'mais', 'votre', 'vos', 'chaque', 'plus', 'c\'est', 'cela', 'ça', 'tout', 'il y a']);

function firstWord(s: string): string {
  return norm(s).replace(/^[^a-z0-9']+/, '').split(/[\s,]+/)[0] ?? '';
}

function varyOpenings(sents: string[], rng: LocalRng): string[] {
  const out = sents.slice();
  for (let i = 1; i < out.length; i++) {
    const w = firstWord(out[i]!);
    if (w && w === firstWord(out[i - 1]!) && SAFE_TO_LOWER.has(w)) {
      out[i] = `${rng.pick(CONNECTORS)}${out[i]!.charAt(0).toLowerCase()}${out[i]!.slice(1)}`;
    }
  }
  return out;
}

/** Words that say nothing about the subject of a pain. */
const GAP_STOP = new Set(['pour', 'avec', 'sans', 'dans', 'plus', 'tout', 'tous', 'toute', 'toutes', 'mais', 'nous', 'vous', 'elle', 'elles', 'sont', 'fait', 'faire', 'cette', 'comme', 'quand', 'encore', 'toujours', 'bien', 'trop', 'avant', 'apres', 'leur', 'votre', 'notre', 'meme', 'peut', 'rien', 'etre', 'avoir', 'donc', 'alors']);

/** Words shared with the customer's: how close a chapter or an answer is to a pain. */
function overlapWith(a: string, b: string): number {
  const shortStems = (t: string): string[] => norm(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GAP_STOP.has(w)).map((w) => w.slice(0, 5));
  const have = new Set(shortStems(b));
  return new Set(shortStems(a).filter((w) => have.has(w))).size;
}

/**
 * A fix pass adds what the Red Team found missing, from the research only: the situation or tip that answers a
 * pain nobody treated, in the chapter closest to it, and an example for a chapter without one. A gap the research
 * cannot fill stays open: the Red Team sees it again rather than a sentence made up to tick the box.
 */
function fillGaps(out: PdfContent, gaps: GuideGaps, known: Material): void {
  const doc = (): string => squash(allText(out));
  const answers = [
    ...known.situations.map((s) => ({ when: s.when, text: `Si ${lf(s.when)} : ${inline(s.what)}` })),
    ...known.pairs.filter((p) => p.fix).map((p) => ({ when: p.mistake, text: `À éviter : ${lf(p.mistake)}. À la place : ${inline(p.fix!)}` })),
    ...known.tips.map((t) => ({ when: t, text: cap(inline(t)) })),
  ];
  for (const pain of strArr(gaps.pains)) {
    const here = doc();
    const fresh = answers.filter((a) => !here.includes(squash(a.text).slice(0, 40)));
    const scored = fresh.map((a) => ({ a, n: overlapWith(pain, `${a.when} ${a.text}`) })).sort((x, y) => y.n - x.n);
    const best = scored[0];
    if (!best || best.n === 0) continue;
    const chapter = [...out.chapters].sort((x, y) => overlapWith(pain, allText({ chapters: [y] })) - overlapWith(pain, allText({ chapters: [x] })))[0];
    chapter?.paragraphs.push(`On lit souvent : « ${bare(pain)} ». ${sentence(best.a.text)}`);
  }
  // Examples of the research first, then its documented situations and ready-made models: each one used once.
  const examples = [...known.examples, ...known.situations.map((s) => `si ${lf(s.when)}, ${lf(s.what)}`), ...known.models];
  for (const title of strArr(gaps.chapters)) {
    const ch = out.chapters.find((c) => c.title === title && !c.example);
    if (!ch) continue;
    const here = doc();
    const fresh = examples.filter((e) => !here.includes(squash(e).slice(0, 40)));
    const best = fresh.sort((a, b) => overlapWith(b, allText({ chapters: [ch] })) - overlapWith(a, allText({ chapters: [ch] })))[0];
    if (best) { ch.example = `Exemple type : ${sentence(best)}`; examples.splice(examples.indexOf(best), 1); }
  }
}

export function heuristicHumanize(contentIn: PdfContent, flagged: string[], vocIn: VoiceOfCustomer, rng: LocalRng, gaps: GuideGaps | null = null): PdfContent {
  const voc = safeVoc(vocIn);
  const content = ensurePdf(contentIn);
  const isFlat = flagMatcher(flagged);
  const bank = new DetailBank(voc, rng, squash(allText(content)));
  const known = materialOf(voc, squash(allText(content)));
  const stepPool = [...known.steps.map((s) => s.text), ...known.tips].map(sentence);
  let stepI = 0;

  const fixProse = (text: string): string => {
    const sents = splitSentences(text);
    if (sents.length === 0) return text;
    const kept: string[] = [];
    const tail: string[] = [];
    sents.forEach((s, i) => {
      if (!isFlat(s)) { kept.push(s); return; }
      const rep = bank.next(text);
      // a detail replacing the opening sentence goes to the end: « Situation n°3 : … » must still open its paragraph
      if (rep) (i === 0 && sents.length > 1 ? tail : kept).push(rep);
    });
    return varyOpenings([...kept, ...tail], rng).join(' ');
  };
  const fixShort = (text: string): string => (isFlat(text) ? (stepPool[stepI++] ?? '') : text);

  const out = forEachText(content, (text, loc) => {
    if (!text) return text;
    // titles stay as they are; list items are replaced whole; prose sentence by sentence
    if (loc === 'Titre' || loc === 'Sous-titre') return text;
    return splitSentences(text).length > 1 || text.length > 140 ? fixProse(text) : (isFlat(text) ? fixShort(text) || fixProse(text) : text);
  });
  // never leave a chapter without prose
  for (const ch of [...out.chapters, out.bonus]) {
    if (ch.paragraphs.length === 0) ch.paragraphs.push(bank.any() ?? sentence(ch.intro || ch.title));
  }
  if (out.introduction.length === 0) out.introduction.push(bank.any() ?? sentence(out.promise || out.title));
  if (gaps) fillGaps(out, gaps, known);
  dropRepeats(out);
  out.wordCount = pdfWordCount(out);
  return out;
}

/** Sentences of the content that match the cliché list (what a QA pass would flag). */
export function findCliches(content: PdfContent): string[] {
  const found: string[] = [];
  forEachText(ensurePdf(content), (text) => {
    for (const s of splitSentences(text)) if (isCliche(s)) found.push(s);
    return text;
  });
  return found;
}

// ───────────────────────────── fact-check ─────────────────────────────

const MASK = '\u0000';

function maskQuotes(text: string): { masked: string; quotes: string[] } {
  const quotes: string[] = [];
  const masked = text.replace(/«[^»]*»/g, (m) => {
    quotes.push(m);
    return `${MASK}${quotes.length - 1}${MASK}`;
  });
  return { masked, quotes };
}

function unmask(text: string, quotes: string[]): string {
  return text.replace(new RegExp(`${MASK}(\\d+)${MASK}`, 'g'), (_, i: string) => quotes[Number(i)] ?? '');
}

interface NumberIssue { token: string }

function unsourcedNumbers(s: string, corpus: string): NumberIssue[] {
  const out: NumberIssue[] = [];
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)[\s  ]*%/g)) {
    const tok = `${m[1]}%`;
    if (!corpus.includes(tok)) out.push({ token: m[0] });
  }
  for (const m of s.matchAll(/(\d+)\s+([\p{L}]+)\s+sur\s+(\d+)/gu)) {
    const tok = `${m[1]}${m[2]}sur${m[3]}`;
    if (!corpus.includes(norm(tok))) out.push({ token: m[0] });
  }
  return out;
}

function soften(s: string, corpus: string): string {
  let t = s
    .replace(/le résultat est garanti en (\d+) ([\p{L}]+)/giu, 'l’objectif est un vrai progrès en $1 $2, à condition de s’y tenir')
    .replace(/(?:plus de |près de |environ |pres de )?(\d+(?:[.,]\d+)?)[\s  ]*% (des|de|d’|d')\s?/giu, (m, n: string, art: string) => {
      if (corpus.includes(`${n}%`)) return m;
      return /^d[’']/.test(art) ? 'beaucoup d’' : 'beaucoup de ';
    })
    .replace(/(\d+)\s+([\p{L}]+)\s+sur\s+(\d+)/gu, (m, a: string, w: string, b: string) => (corpus.includes(norm(`${a}${w}sur${b}`)) ? m : `la plupart des ${w}`))
    .replace(/dès la première (nuit|semaine)/giu, 'au fil des premières $1s')
    .replace(/dès le premier (soir|jour)/giu, 'au fil des premiers $1s')
    .replace(/dès demain/giu, 'dans les jours qui viennent')
    .replace(/dans[\s  ]*100[\s  ]*% des cas/giu, 'dans la plupart des cas')
    .replace(/(?:à|a)[\s  ]*100[\s  ]*%/giu, 'pleinement')
    .replace(/100[\s  ]*%[\s  ]*/giu, '')
    .replace(/(?<![\p{L}])garanti(e|es|s)?(?![\p{L}])/giu, 'visé$1')
    .replace(/(?<![\p{L}])gu[ée]rir(?![\p{L}])/giu, 'apaiser')
    .replace(/(?<![\p{L}])gu[ée]rit(?![\p{L}])/giu, 'apaise')
    .replace(/(?<![\p{L}])gu[ée]rison(?![\p{L}])/giu, 'apaisement')
    .replace(/(?<![\p{L}])soign(er|e|ez)(?![\p{L}])/giu, 'accompagn$1')
    .replace(/remplace (votre|le) médecin/giu, 'complète les conseils de $1 médecin')
    .replace(/à coup sûr/giu, 'le plus souvent')
    .replace(/sans effort/giu, 'pas à pas')
    .replace(/définitivement|pour toujours/giu, 'durablement')
    .replace(/(?<!pas de |aucune |aucun |sans )(?<![\p{L}])miracle(s)?(?![\p{L}])/giu, 'efficace$1')
    .replace(/(en|sous) (\d+|deux|trois|quelques) (jours?|nuits?|semaines?|heures?|minutes?) (seulement|chrono|top chrono|maximum|max)/giu, '$1 $2 $3 environ')
    .replace(/du jour au lendemain/giu, 'progressivement')
    .replace(/instantanément/giu, 'rapidement')
    .replace(/devenir riche/giu, 'mieux gérer son argent')
    .replace(/revenu passif garanti|argent facile/giu, 'revenu complémentaire');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return cap(t);
}

function risks(s: string, corpus: string): string[] {
  const labels = RISK_RULES.filter((r) => r.re.test(s)).map((r) => r.label);
  if (unsourcedNumbers(s, corpus).length) labels.push('Chiffre sans source');
  return labels;
}

export function heuristicFactCheck(contentIn: PdfContent, vocIn: VoiceOfCustomer): { issues: string[]; content: PdfContent; claims: string[] } {
  const voc = safeVoc(vocIn);
  const corpus = norm([...voc.pains, ...voc.phrases, ...voc.desiredOutcomes, ...Object.values(voc.knowledge).flat()].join(' ')).replace(/\s+/g, '');
  const content = ensurePdf(contentIn);
  const issues: string[] = [];
  // the invented sentences themselves (removed or reworded): the writer must not write them again
  const claims: string[] = [];
  const out = forEachText(content, (text, loc) => {
    if (!text) return text;
    const { masked, quotes } = maskQuotes(text);
    const sents = splitSentences(masked);
    const fixed: string[] = [];
    for (const s of sents.length ? sents : [masked]) {
      const labels = risks(s, corpus);
      if (labels.length === 0) { fixed.push(s); continue; }
      const soft = soften(s, corpus);
      const before = clean(unmask(s, quotes));
      claims.push(before);
      // « Beaucoup de lecteurs voient… » is still a claim about readers nobody measured: drop it
      const unverifiable = /\bbeaucoup d(?:e |['’])(?:lecteurs|clients|parents|utilisateurs|acheteurs)\b/i.test(soft);
      if (unverifiable && sents.length > 1) {
        issues.push(`${loc} — ${labels.join(' + ')} : « ${fit(before, 110)} » → phrase retirée (témoignage chiffré invérifiable).`);
        continue;
      }
      if (risks(soft, corpus).length === 0 && soft.length > 3) {
        fixed.push(soft);
        issues.push(`${loc} — ${labels.join(' + ')} : « ${fit(before, 110)} » → reformulé en « ${fit(clean(unmask(soft, quotes)), 110)} ».`);
      } else if (sents.length > 1) {
        issues.push(`${loc} — ${labels.join(' + ')} : « ${fit(before, 110)} » → phrase retirée (impossible à rendre vérifiable).`);
      } else {
        fixed.push(soft);
        issues.push(`${loc} — ${labels.join(' + ')} : « ${fit(before, 110)} » → adoucie, à relire par un humain.`);
      }
    }
    return unmask(fixed.join(' '), quotes);
  });
  out.wordCount = pdfWordCount(out);
  return { issues, content: out, claims: [...new Set(claims)] };
}
