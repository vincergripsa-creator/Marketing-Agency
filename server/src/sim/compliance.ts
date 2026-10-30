/** Ad-platform compliance: claims TikTok refuses everywhere, plus each niche's own list. */
import { hasPhrase, norm } from './text.js';

/** Refused in every niche (guarantees, health, easy money, fake urgency). */
export const GENERIC_BANNED_CLAIMS: readonly string[] = [
  'garanti', '100%', 'guérir', 'guérit', 'devenir riche', 'sans effort', 'zéro effort', 'miracle',
  'en 3 jours seulement', 'résultat assuré', 'résultats assurés', 'à coup sûr', 'remplace votre médecin',
  'revenu passif garanti', 'argent facile', 'enrichissez-vous', 'plus que 2 exemplaires', 'offre expire dans 10 minutes',
  'méthode secrète', 'sans aucun risque',
];

/** Legit phrasings removed before scanning (a money-back guarantee is not a result guarantee). */
const ALLOWED_PHRASES: readonly string[] = [
  'garantie satisfait ou rembourse', 'satisfait ou rembourse', 'garantie de remboursement', 'garantie 14 jours',
  'garantie de 14 jours', 'rembourse sous 14 jours', 'paiement 100% securise', '100% securise', 'garantie 30 jours',
];

function stripAllowed(normText: string): string {
  let t = normText;
  for (const p of ALLOWED_PHRASES) t = t.split(p).join(' ');
  return t;
}

/** Banned claims found in the texts (deduplicated, in list order). */
export function findBannedClaims(texts: readonly (string | null | undefined)[], extra: readonly string[] = []): string[] {
  const hay = stripAllowed(norm(texts.filter(Boolean).join(' \n ')));
  if (!hay) return [];
  const found: string[] = [];
  for (const claim of [...GENERIC_BANNED_CLAIMS, ...extra]) {
    if (!claim || found.includes(claim)) continue;
    if (hasPhrase(hay, claim)) found.push(claim);
  }
  return found;
}

/** Words that deny what follows, up to three words before it: « sans chiffre inventé ni promesse miracle ». */
const DENIAL = "(^|[^a-z0-9])((?:sans|ni|pas de|pas d'|aucune?|jamais de|jamais d')(?:\\s+[a-z0-9'-]+){0,3}\\s+)";

/**
 * What a sales page claims itself, unlike what it quotes (« Ça doit encore être une arnaque minceur ») or denies
 * (« ni promesse miracle »). The platform's own review stays literal: it is findBannedClaims.
 */
export function findPageClaims(texts: readonly (string | null | undefined)[], extra: readonly string[] = []): string[] {
  let page = texts.filter(Boolean).join(' \n ');
  for (let unquoted = page.replace(/«[^«»]*»/g, ' '); unquoted !== page; unquoted = page.replace(/«[^«»]*»/g, ' ')) page = unquoted;
  const hay = stripAllowed(norm(page));
  return findBannedClaims([page], extra).filter((claim) => hasPhrase(hay.replace(new RegExp(`${DENIAL}${norm(claim).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '$1$2'), claim));
}

/** Exaggeration markers: not banned, but they inflate promises (refunds, promise gap). */
export const HYPE_WORDS: readonly string[] = [
  'révolutionnaire', 'ultime', 'incroyable', 'magique', 'définitif', 'le seul guide', 'la seule méthode', 'choquant',
  'en quelques jours', 'tout ce qu\'il faut', 'secret', 'explosif', 'jamais vu',
];

export function countHype(texts: readonly (string | null | undefined)[]): number {
  const hay = norm(texts.filter(Boolean).join(' \n '));
  let n = 0;
  for (const w of HYPE_WORDS) if (hasPhrase(hay, w)) n++;
  n += Math.min(3, Math.floor(((hay.match(/!/g) ?? []).length) / 3));
  return n;
}
