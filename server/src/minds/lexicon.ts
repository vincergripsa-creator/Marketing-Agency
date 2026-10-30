/**
 * French vocabulary of the minds: generic "AI" clichés (inserted in first drafts, hunted by the
 * humanizer), risky claims (hunted by the fact-checker / ad compliance) and sentence connectors.
 */
import { norm } from './util.js';

/** Flat first-draft sentences ("correct mais plat"). {sujet}/{diff} are filled per niche. */
export const CLICHE_TEMPLATES: readonly string[] = [
  'Chaque {sujet} est {diff}.',
  'Soyez patient.',
  'Il est important de noter que chaque étape demande du temps.',
  'N’hésitez pas à adapter ces conseils à votre rythme.',
  'En conclusion, la régularité reste la clé.',
  'Dans le monde d’aujourd’hui, tout va très vite.',
  'Prenez soin de vous.',
  'Faites confiance au processus.',
  'Chaque petit pas compte.',
  'Le plus important, c’est de commencer.',
  'Il est essentiel de rester positif.',
  'Rome ne s’est pas faite en un jour.',
];

/** Detection patterns (run on norm()-ed text). Broader than the templates on purpose. */
export const CLICHE_PATTERNS: readonly RegExp[] = [
  /chaque (bebe|enfant|personne|situation|famille|chien|chat|corps|couple|cas|parcours|individu|ado|adolescent) est (different|differente|unique)/,
  /chacun (est different|a son rythme|est unique)/,
  /soyez patiente?s?\b/,
  /il est important de (noter|souligner|rappeler|comprendre)/,
  /il est essentiel de/,
  /il convient de (noter|souligner)/,
  /n'hesitez pas a/,
  /\ben conclusion\b/,
  /\bpour conclure\b/,
  /dans le monde (d'aujourd'hui|actuel|moderne)/,
  /de nos jours,/,
  /prenez soin de vous/,
  /faites confiance au processus/,
  /chaque petit pas compte/,
  /le plus important,? c'est de commencer/,
  /rester positi(f|ve)/,
  /rome ne s'est pas faite? en un jour/,
  /force est de constater/,
  /\bplongeons\b/,
  /la cle du succes/,
  /il n'y a pas de recette miracle/,
  /ecoutez votre (corps|instinct|intuition)/,
  /la communication est (la cle|essentielle)/,
  /un voyage,? pas une destination/,
  /\ben fin de compte\b/,
  /il va sans dire/,
  /que vous soyez debutant ou expert/,
  /liberez votre potentiel|votre plein potentiel/,
  /le secret reside dans/,
  /la patience est la cle/,
  /faites-vous confiance/,
  /rappelez-vous que/,
  /gardez a l'esprit que/,
  /sans plus attendre/,
  /un veritable atout|un outil puissant/,
  /\bpour resumer\b/,
  /\ben somme\b/,
  /dans ce guide complet/,
  /\bau c(œ|oe)ur de\b/,
  /faire toute la difference/,
  /a l'ere du numerique/,
  /il n'y a pas de solution miracle/,
];

export function isCliche(sentence: string): boolean {
  const n = norm(sentence);
  return CLICHE_PATTERNS.some((re) => re.test(n));
}

/** Words the ad platform / fact-checker treat as risky claims. */
export const RISKY_AD_PHRASES: readonly string[] = ['garanti', '100 %', 'à coup sûr', 'en 3 jours seulement'];

export interface RiskRule { id: 'garantie' | 'absolu' | 'sante' | 'delai' | 'argent'; label: string; re: RegExp }

/** Run on the original text (case-insensitive, unicode). */
export const RISK_RULES: readonly RiskRule[] = [
  { id: 'garantie', label: 'Promesse de résultat garanti', re: /(?<![\p{L}])garanti(e|es|s)?(?![\p{L}])/iu },
  { id: 'absolu', label: 'Promesse absolue', re: /100[\s  ]*%|à coup sûr|sans effort|définitivement|pour toujours|(?<!pas de |aucune |aucun |sans )(?<![\p{L}])miracles?(?![\p{L}])/iu },
  { id: 'sante', label: 'Allégation santé', re: /(?<![\p{L}])(gu[ée]ri(r|t|s|ssez|ssent|son)?|soigner|soigne|soignez|traitement médical|remplace (votre|le) médecin)(?![\p{L}])/iu },
  { id: 'delai', label: 'Promesse de délai', re: /(en|sous) (\d+|deux|trois|quelques) (jours?|nuits?|semaines?|heures?|minutes?) (seulement|chrono|top chrono|maximum|max)|dès (le premier soir|la première nuit|la première semaine|le premier jour|demain)|du jour au lendemain|instantanément/iu },
  { id: 'argent', label: 'Promesse d’argent facile', re: /devenir riche|revenu passif garanti|argent facile/iu },
];

export const CONNECTORS: readonly string[] = ['Concrètement, ', 'Dans les faits, ', 'Au quotidien, ', 'En pratique, '];
