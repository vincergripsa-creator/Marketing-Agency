/**
 * Customer phrases are quoted as they were said, but not as they were typed: a guide sold 19 € does
 * not print « jai », « lol » or « 200 balles ». The quote stays recognisable; only slang and typing
 * accidents go. A phrase that cannot be cleaned without changing its meaning is dropped by the caller.
 */
import { clean } from '../util.js';

/** Fillers that add nothing to the quote, removed wherever they are. */
const FILLERS = /(?:^|\s)(?:lol|mdr|ptdr|wtf|svp|stp|beurk|oups|bref)(?=$|[\s,.;:!?…])/giu;

/** Missing apostrophes and spoken contractions, the words of the quote are kept. */
const REWRITES: readonly [RegExp, string][] = [
  [/\bjai\b/giu, 'j’ai'],
  [/\bjsuis\b/giu, 'je suis'],
  [/\bjpasse\b/giu, 'je passe'],
  [/\bjveux\b/giu, 'je veux'],
  [/\bjcomprends\b/giu, 'je comprends'],
  [/\bjsais\b/giu, 'je sais'],
  [/\bcoeur\b/giu, 'cœur'],
  [/\bhauts le cœur\b/giu, 'haut-le-cœur'],
  [/\ba chaque\b/giu, 'à chaque'],
  [/\bbelle mère\b/giu, 'belle-mère'],
  [/\bl'oeuf\b/giu, 'l’œuf'],
  [/\by'a\b/giu, 'il y a'],
  [/\bballes\b/giu, '€'],
  [/\bgosses\b/giu, 'enfants'],
  [/\bproprio\b/giu, 'propriétaire'],
  [/\btaf\b/giu, 'travail'],
  [/\bpresta\b/giu, 'prestation'],
  [/\bdu mat\b/giu, 'du matin'],
  [/\brelou\b/giu, 'lassant'],
];

/** The cleaned quote: same words and same tone, without slang markers. */
export function speakable(raw: string): string {
  let t = clean(raw).replace(FILLERS, '');
  for (const [re, to] of REWRITES) t = t.replace(re, to);
  // « 200 € » keeps its number; a run of punctuation is one mark
  t = t.replace(/(\d)\s*€/g, '$1 €').replace(/([?!])[?!]+/g, '$1').replace(/\s+([,.;:!?])/g, ' $1').replace(/\s{2,}/g, ' ').trim();
  return t.replace(/\s*[,;:]\s*$/, '').replace(/\s\?$/, ' ?');
}
