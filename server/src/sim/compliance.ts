/** Ad-platform compliance: claims TikTok refuses everywhere, each niche's own list, and each channel's rules. */
import type { AdCreative, ChannelId, Product } from '../shared.js';
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

// ───────────────────────────── Channel rules ─────────────────────────────

/** One platform rule. The label is public (brain note), the pattern is not. */
export interface ChannelRule {
  id: string;
  label: string;
  scope: 'copy' | 'headlines' | 'landing'; // copy = hook + scenes, or all a search ad shows; landing also reads the product's title and problem
  strike: boolean;
  test: RegExp;                            // on norm(text), unless raw
  raw?: boolean;
}

const INCOME: Omit<ChannelRule, 'id'> = { label: 'promesse de revenu chiffrée', scope: 'copy', strike: true, test: /\b\d+\s*(?:€|euros?)\s*(?:par|\/)\s*(?:mois|jour|semaine)\b/ };
const GOOGLE_HEALTH: ChannelRule = { id: 'google.sante', label: 'allégation de santé', scope: 'copy', strike: true, test: /\b(?:guerir|soigner|traitement|therapie|maigrir)\b/ };

/** A strike rule comes first: the rule that costs the account must never hide behind one that does not. */
export const CHANNEL_RULES: Record<ChannelId, readonly ChannelRule[]> = {
  tiktok: [], // its review is findBannedClaims, in submitCreative
  meta: [
    { id: 'meta.image_du_corps', label: 'image du corps', scope: 'copy', strike: true, test: /\b(?:ventre|tour de taille|silhouette|bourrelets|kilos|poids|menopause|cellulite)\b/ },
    { ...INCOME, id: 'meta.revenu' },
    { id: 'meta.detresse', label: 'détresse de la personne visée', scope: 'copy', strike: false, test: /\b(?:je craque|zombie|j'en peux plus|burn-?out|depression|deprimee?|epuisee)\b/ },
  ],
  youtube: [GOOGLE_HEALTH], // same account, same health policy as Search
  pinterest: [
    { ...INCOME, id: 'pinterest.revenu' },
    { id: 'pinterest.perte_de_poids', label: 'perte de poids', scope: 'landing', strike: false, test: /\b(?:maigrir|perdre du poids|ventre|minceur|regime|kilos|silhouette|tour de taille|brule-graisse)\b/ },
  ],
  google: [
    GOOGLE_HEALTH,
    { id: 'google.marque', label: 'marque ou organisme tiers', scope: 'headlines', strike: false, test: /\b(?:urssaf|toeic|caf|france travail|pole emploi|impots)\b/ },
    { id: 'google.superlatif', label: 'superlatif non prouvé', scope: 'copy', strike: false, test: /\b(?:l[ea] meilleure?|n°1|l[ea] seule?)\b/ },
    { id: 'google.ponctuation', label: 'ponctuation et capitales', scope: 'headlines', strike: false, test: /!|\p{Lu}{6}/u, raw: true },
  ],
};

function ruleText(c: AdCreative, rule: ChannelRule, product: Product): string {
  const search = c.search;
  const copy = [c.hook, ...(c.scenes ?? []).flatMap((s) => [s.onScreenText, s.voiceover]), ...(search?.headlines ?? []), ...(search?.descriptions ?? [])];
  const parts = rule.scope === 'headlines' ? search?.headlines ?? [c.hook]
    : rule.scope === 'landing' ? [...copy, product.title, product.problem] : copy;
  return parts.filter(Boolean).join(' \n ');
}

/** What the rule caught, as the writer has to read it. Null when the creative passes. */
function ruleHit(c: AdCreative, rule: ChannelRule, product: Product): string | null {
  const text = ruleText(c, rule, product);
  return rule.test.exec(rule.raw ? text : norm(text))?.[0] ?? null;
}

/** The first rule of the channel the creative breaks, strike rules first. */
export function findChannelViolation(c: AdCreative, ch: ChannelId, product: Product): ChannelRule | null {
  return CHANNEL_RULES[ch].find((rule) => ruleHit(c, rule, product) !== null) ?? null;
}

/** The words a violation caught, for the reason the company reads: a writer cannot avoid a rule, only a word. */
export function channelViolationWord(c: AdCreative, rule: ChannelRule, product: Product): string {
  return ruleHit(c, rule, product) ?? '';
}
