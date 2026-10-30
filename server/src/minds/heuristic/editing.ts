/**
 * Second pass on a draft: the humanizer (generic sentences → specific market details) and the
 * fact-checker (risky / unsupported claims → honest wording, with a French issue list).
 */
import type { PdfContent, VoiceOfCustomer } from '../../shared.js';
import { CONNECTORS, isCliche, RISK_RULES } from '../lexicon.js';
import { ensurePdf, forEachText } from '../shapes.js';
import { allText, bare, cap, clean, fit, lf, norm, q, sentence, splitSentences, strArr, type LocalRng } from '../util.js';
import { safeVoc } from './niche.js';
import { pdfWordCount } from './studio.js';

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

/** Specific sentences drawn from the research, handed out once each. */
class DetailBank {
  private readonly queue: string[] = [];
  private i = 0;

  constructor(voc: VoiceOfCustomer, rng: LocalRng, docText = '') {
    const k = voc.knowledge;
    const lanes: string[][] = [
      rng.shuffle(voc.phrases).map((p, j) => (j % 2 === 0
        ? `Une phrase revient sans cesse dans les commentaires : ${q(p)}. C’est précisément la situation que ce passage traite.`
        : `${cap(q(p))} : c’est mot pour mot ce que nous ont écrit plusieurs lecteurs avant de commencer.`)),
      k.tips.map((t) => `Détail concret qui change tout : ${lf(t)}.`),
      k.facts.map((f) => `Repère précis issu de nos recherches : ${lf(f)}.`),
      k.examples.map((e) => sentence(e)),
      voc.desiredOutcomes.map((o) => `Ce que décrivent ceux qui ont réussi : ${lf(o)}.`),
      k.mistakes.map((m) => `Le piège à éviter ici : ${lf(m)}.`),
    ];
    const max = Math.max(0, ...lanes.map((l) => l.length));
    const all: string[] = [];
    for (let j = 0; j < max; j++) for (const lane of lanes) if (lane[j]) all.push(lane[j]!);
    // details the document does not quote yet come first
    const doc = norm(docText);
    const seen = (s: string): boolean => {
      const m = /«\s*([^»]+?)\s*»/.exec(s);
      return doc.includes(norm(m ? m[1]! : bare(s)).slice(0, 40));
    };
    this.queue.push(...all.filter((s) => !seen(s)), ...all.filter(seen));
  }

  next(avoid: string): string | null {
    const a = norm(avoid);
    while (this.i < this.queue.length) {
      const s = this.queue[this.i++]!;
      const core = norm(bare(s)).slice(0, 40);
      if (!a.includes(core)) return s;
    }
    return null;
  }
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

export function heuristicHumanize(contentIn: PdfContent, flagged: string[], vocIn: VoiceOfCustomer, rng: LocalRng): PdfContent {
  const voc = safeVoc(vocIn);
  const content = ensurePdf(contentIn);
  const isFlat = flagMatcher(flagged);
  const bank = new DetailBank(voc, rng, allText(content));
  const stepPool = [...voc.knowledge.steps, ...voc.knowledge.tips].map(sentence);
  let stepI = 0;

  const fixProse = (text: string): string => {
    const sents = splitSentences(text);
    if (sents.length === 0) return text;
    const kept: string[] = [];
    for (const s of sents) {
      if (!isFlat(s)) { kept.push(s); continue; }
      const rep = bank.next(text);
      if (rep) kept.push(rep);
    }
    return varyOpenings(kept, rng).join(' ');
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
    if (ch.paragraphs.length === 0) ch.paragraphs.push(bank.next('') ?? sentence(ch.intro || ch.title));
  }
  if (out.introduction.length === 0) out.introduction.push(bank.next('') ?? sentence(out.promise || out.title));
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
    .replace(/le résultat est garanti en (\d+) ([\p{L}]+)/giu, 'l’objectif est un vrai progrès en $1 $2, à condition d’appliquer les étapes chaque jour')
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

export function heuristicFactCheck(contentIn: PdfContent, vocIn: VoiceOfCustomer): { issues: string[]; content: PdfContent } {
  const voc = safeVoc(vocIn);
  const corpus = norm([...voc.pains, ...voc.phrases, ...voc.desiredOutcomes, ...Object.values(voc.knowledge).flat()].join(' ')).replace(/\s+/g, '');
  const content = ensurePdf(contentIn);
  const issues: string[] = [];
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
  return { issues, content: out };
}
