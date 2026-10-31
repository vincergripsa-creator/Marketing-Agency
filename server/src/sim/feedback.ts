/** Public feedback in French: product reviews (stars + text) and TikTok ad comments. */
import { nextId } from '../core/index.js';
import type { Rng } from '../contracts.js';
import type { AdComment, NicheTruth, Product, Review, WorldState } from '../shared.js';
import { handleFor } from './customers.js';
import { fill } from './text.js';

const GOOD = [
  "Enfin un guide qui va droit au but. Le chapitre « {chapitre} » m'a été le plus utile, on l'a appliqué dès le premier soir.",
  'Très concret, avec des étapes numérotées faciles à suivre. On se reconnaît dans les exemples, surtout « {phrase} ».',
  "J'avais tout lu sur internet sans résultat. Ici il y a une vraie méthode et des checklists. Je recommande.",
  'Clair, bien illustré, et pas de blabla. Le chapitre « {chapitre} » vaut à lui seul le prix du guide.',
  "Je craignais un énième PDF générique, mais non : c'est précis et pensé pour notre situation.",
  "Les exemples m'ont parlé : on s'y retrouve tout de suite, et on sait par quoi commencer.",
  'Lu en une soirée, appliqué le lendemain. Le bonus est une vraie bonne surprise.',
  "Guide sérieux, honnête sur ce qu'il promet. Les étapes du chapitre « {chapitre} » marchent chez nous.",
];
const MID = [
  "Correct, quelques bonnes idées dans « {chapitre} », mais j'attendais plus d'exemples concrets.",
  'Pas mal pour débuter, mais certaines parties restent assez générales.',
  'Le contenu est bon, la mise en page un peu chargée sur téléphone.',
  'Utile, même si une partie des conseils se trouve gratuitement ailleurs.',
  "Bien structuré, mais il manque des réponses pour notre cas précis : {pain}.",
];
const BAD = [
  'Beaucoup de généralités, on dirait un texte écrit par une IA. Rien de nouveau.',
  "La page de vente promettait beaucoup plus que ce que contient le guide. Déçu(e).",
  'Trop court pour le prix, et aucun exemple concret.',
  "Rien qu'on ne trouve pas gratuitement en dix minutes de recherche.",
  'Des répétitions partout, des conseils vagues. Je me suis fait rembourser.',
  "Le guide ne parle presque pas de notre vrai problème : {pain}.",
  'Mise en page bâclée et conseils contradictoires. À éviter.',
];
const ANGRY_SUPPORT = [
  'Aucune réponse du support depuis plusieurs jours. Je déconseille fortement.',
  'Service client inexistant : message ignoré, problème jamais réglé.',
  "J'ai écrit trois fois, zéro réponse. Boutique à fuir.",
  'Réponse hautaine du support, aucune solution proposée. 1 étoile, et encore.',
];
const GOOD_SUPPORT = [
  'Petit souci au téléchargement, réglé en quelques heures par un support adorable. Merci !',
  "Service client au top : réponse rapide, humaine et efficace.",
  "J'étais énervé(e), mais le support a été très pro et a trouvé une solution. Respect.",
];
const TROLL_REVIEWS = ['Arnaque. Fuyez.', 'Encore un PDF ChatGPT vendu une fortune. Nul.', '1 étoile parce que 0 n\'est pas possible.', 'Vendeurs de vent.'];

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function vars(rng: Rng, product: Product, niche?: NicheTruth): Record<string, string> {
  const chapters = product.content?.chapters ?? [];
  return {
    chapitre: chapters.length ? rng.pick(chapters).title : product.title,
    phrase: niche?.voc.phrases.length ? rng.pick(niche.voc.phrases) : 'notre quotidien',
    pain: niche?.voc.pains.length ? lowerFirst(rng.pick(niche.voc.pains)) : 'notre situation',
  };
}

export type ReviewKind = 'product' | 'support_bad' | 'support_good' | 'troll';

/** Reviews a product keeps: compaction cuts the older ones, so nothing that decides reads past them, cut or not. */
export const REVIEWS_KEPT = 60;

export function recentReviews(product: Product): Review[] {
  return (product.stats?.reviews ?? []).slice(-REVIEWS_KEPT);
}

export function reviewText(rng: Rng, rating: number, product: Product, niche: NicheTruth | undefined, kind: ReviewKind = 'product'): string {
  if (kind === 'support_bad') return rng.pick(ANGRY_SUPPORT);
  if (kind === 'support_good') return rng.pick(GOOD_SUPPORT);
  if (kind === 'troll') return rng.pick(TROLL_REVIEWS);
  const pool = rating >= 4 ? GOOD : rating === 3 ? MID : BAD;
  // two buyers do not write the same sentence: a template already on this product waits for the others
  const seen = recentReviews(product).map((r) => r.text);
  const fresh = pool.filter((t) => !seen.some((text) => text.startsWith(t.split('{')[0]!)));
  return fill(rng.pick(fresh.length ? fresh : pool), vars(rng, product, niche));
}

/** Pushes a review on the product and refreshes its average rating. */
export function addReview(world: WorldState, rng: Rng, product: Product, customerId: string, rating: number, niche: NicheTruth | undefined, kind: ReviewKind = 'product'): Review {
  const r = Math.max(1, Math.min(5, Math.round(rating))) as Review['rating'];
  const review: Review = { id: nextId(world, 'rev'), day: world.day, customerId, rating: r, text: reviewText(rng, r, product, niche, kind) };
  const { stats } = product;
  stats.ratingSum = (stats.ratingSum ?? stats.reviews.reduce((s, x) => s + x.rating, 0)) + r;
  stats.ratingCount = (stats.ratingCount ?? stats.reviews.length) + 1;
  stats.reviews.push(review);
  stats.rating = Math.round((stats.ratingSum / stats.ratingCount) * 100) / 100;
  return review;
}

// ───────────────────────────── Ad comments ─────────────────────────────

const POSITIVE = [
  'Exactement ma vie en ce moment', 'Je prends, il me le faut', 'Enfin quelqu\'un qui en parle !', '« {phrase} » … pareil ici',
  'Trop vrai', 'Enregistré pour plus tard', 'Je tague ma sœur, elle en a besoin', 'Ça me rassure de voir que je suis pas la seule',
];
const NEGATIVE = [
  'Encore une pub pour un PDF à 20 balles…', "C'est gratuit sur YouTube tout ça", 'Franchement ça sent l\'IA', "J'ai déjà tout essayé, rien ne marche",
  'Les pubs TikTok c\'est devenu que ça', 'Pas convaincu(e)', 'Ça a l\'air très général',
];
const TROLL = ['Arnaque', 'lol qui achète ça', 'ratio', 'Le mec vend du vent', 'Signalé', 'mdr les pigeons en commentaire'];
const QUESTION = [
  'Ça marche aussi si {pain} ?', "C'est combien ?", 'Le PDF fait combien de pages ?', 'Il y a une version papier ?', 'Le lien est où ?',
  'Ça vaut le coup pour {audience} ?', 'Quelqu\'un l\'a testé ?',
];

export function adComments(rng: Rng, n: number, quality: number, hype: number, trollShare: number, niche?: NicheTruth, audience?: string): AdComment[] {
  const out: AdComment[] = [];
  const q = Math.max(0, Math.min(1, quality / 100));
  const weights: [AdComment['tone'], number][] = [
    ['positive', 0.15 + 0.35 * q],
    ['negative', 0.3 - 0.2 * q + 0.1 * hype],
    ['troll', 0.08 + trollShare * 0.25 + 0.05 * hype],
    ['question', 0.25],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    let tone: AdComment['tone'] = 'question';
    for (const [t, w] of weights) { r -= w; if (r <= 0) { tone = t; break; } }
    const pool = tone === 'positive' ? POSITIVE : tone === 'negative' ? NEGATIVE : tone === 'troll' ? TROLL : QUESTION;
    const text = fill(rng.pick(pool), {
      phrase: niche?.voc.phrases.length ? rng.pick(niche.voc.phrases) : 'pareil',
      pain: niche?.voc.pains.length ? lowerFirst(rng.pick(niche.voc.pains)) : 'on a un cas particulier',
      audience: lowerFirst(audience ?? niche?.audience ?? 'nous'),
    });
    out.push({ author: handleFor(rng), text, tone });
  }
  return out;
}
