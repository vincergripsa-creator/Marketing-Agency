/**
 * What a page may never do, from French law (design plan D208, research `marche_francais_et_regles.md` §2): a crossed-out
 * price is the lowest price of the 30 days before the reduction (L112-1-1, CJUE Aldi Süd), no false urgency nor false
 * scarcity (L121-4 7° and 17°), reviews say how they are verified (L121-3), the refund promise is a commercial guarantee
 * (L121-4 10°), and the waiver of the 14-day withdrawal right on a download is never hidden (L221-28 13°).
 */
import { normalizeKey } from '../text.js';

export interface PricePoint { day: number; price: number }
/** A real reduction: `was` is the reference the page may cross out, `since` the day the current price started. */
export interface PriceDrop { was: number; since: number; pct: number }

export const REFERENCE_DAYS = 30;
const CENT = 0.005;

const same = (a: number, b: number): boolean => Math.abs(a - b) <= CENT;

/** One price per day, the last one set that day, in day order. */
function daily(history: readonly PricePoint[]): PricePoint[] {
  const byDay = new Map<number, number>();
  const valid = history.filter((p) => p && Number.isFinite(p.day) && Number.isFinite(p.price) && p.price > 0);
  for (const p of [...valid].sort((a, b) => a.day - b.day)) byDay.set(p.day, p.price);
  return [...byDay].map(([day, price]) => ({ day, price }));
}

/** Every price in force on a day of [from, to): the one standing at `from`, then each change before `to`. */
function pricesIn(h: readonly PricePoint[], from: number, to: number): number[] {
  const standing = h.filter((p) => p.day <= from).at(-1);
  return [...(standing ? [standing.price] : []), ...h.filter((p) => p.day > from && p.day < to).map((p) => p.price)];
}

/**
 * The reference price a page may cross out, or null. Only a real drop counts: the current price follows a higher one, and
 * the reference is the lowest price applied during the 30 days before the reduction, the first of a run of successive ones
 * (each within 30 days of the last). A price test that alternates 19 € and 24 € day by day never shows 24 € crossed out:
 * 19 € was applied inside the window. With `today`, the drop stops being announced 30 days after it started, when the
 * reduced price has become the price of the month.
 */
export function priceDrop(history: readonly PricePoint[] | null | undefined, price: number, today?: number): PriceDrop | null {
  const h = daily(history ?? []);
  if (!h.length || !(price > 0) || !same(h.at(-1)!.price, price)) return null; // a price the history does not hold has no known start
  let start = h.length - 1;
  while (start > 0 && same(h[start - 1]!.price, price)) start--;
  if (start === 0 || h[start - 1]!.price <= price + CENT) return null; // the first price, or a rise: no reduction
  let first = start;
  while (first > 1 && h[first - 1]!.price < h[first - 2]!.price - CENT && h[first]!.day - h[first - 1]!.day < REFERENCE_DAYS) first--;
  const at = h[first]!.day;
  const was = Math.min(...pricesIn(h, at - REFERENCE_DAYS, at));
  if (!(was > price + CENT)) return null;
  if (today !== undefined && Number.isFinite(today) && today - h[start]!.day >= REFERENCE_DAYS) return null;
  return { was, since: h[start]!.day, pct: Math.round((1 - price / was) * 100) };
}

/** What the page prints of a drop: when this changes, the page must be drawn again (the last day of the announcement included). */
export function priceDropPrint(history: readonly PricePoint[] | null | undefined, price: number, today?: number): string {
  const d = priceDrop(history, price, today);
  return d ? `${d.was}|${d.since}` : '';
}

// A digital guide never runs out and no offer of the shop ends on a date: every one of these would be false.
const URGENCY: readonly RegExp[] = [
  /\bplus que \d+\s*(?:exemplaires?|places?|copies?|unites?|ventes?|jours?|heures?|minutes?)\b/,
  /\bderni(?:er|ere)s? (?:exemplaires?|places?|chances?|heures?|jours? pour)\b/,
  /\b(?:offre|prix|promotion|promo|tarif|reduction|remise)s? (?:limitee?s?|exceptionnel(?:le)?s? limitee?s?|valables? (?:jusqu|aujourd|ce soir|seulement|uniquement))/,
  /\b(?:expire|se termine|prend fin|s'arrete|disparait)\w* (?:ce soir|demain|bientot|dans|a minuit|aujourd)/,
  /\bcompte a rebours\b/, /\bstocks? limitee?s?\b/, /\bquantites? limitees?\b/, /\bplaces? limitees?\b/, /\btemps limite\b/,
  /\b(?:seulement|uniquement) (?:aujourd'hui|ce soir|pendant \d+)/, /\bavant (?:minuit|ce soir|demain)\b/,
  /\bdans les \d+ (?:prochaines|dernieres) (?:heures|minutes)\b/, /\bdepechez[- ]vous\b/, /\bne tardez pas\b/,
];

const key = (s: string): string => normalizeKey(s).replace(/[’`´]/g, "'");

/** True when a sentence presses with a deadline or a stock that does not exist. */
export function isFalseUrgency(text: string): boolean {
  const k = key(text);
  return URGENCY.some((re) => re.test(k));
}

/** The text without its sentences of false urgency or scarcity. Whatever the writer said, the page never prints them. */
export function noFalseUrgency(text: string | null | undefined): string {
  const t = String(text ?? '').trim();
  if (!t || !isFalseUrgency(t)) return t;
  const sentences = t.split(/(?<=[.!?…])\s+(?=[«"\p{Lu}\p{N}])/u);
  return sentences.filter((s) => !isFalseUrgency(s)).join(' ').trim();
}

export const BANNER = '<div class="demo-banner">Boutique virtuelle Pixel Agency — environnement de test, aucun paiement réel</div>';
export const NO_BANK_DATA = 'Aucune donnée bancaire n’est collectée.';
export const NO_FAKE_REVIEWS = 'Nous n’affichons jamais de faux témoignages.';
export const GUARANTEE_TITLE = 'Garantie commerciale';
export const REVIEWS_VERIFIED = 'Seuls les acheteurs peuvent laisser un avis, une fois leur commande passée. Chaque avis compte dans la note, positif ou négatif, et nous affichons les plus récents sans les retoucher.';
export const DROP_NOTE = 'Prix barré : le prix le plus bas pratiqué pendant les 30 jours qui ont précédé la baisse.';

export const guaranteeNote = (brand: string): string => `Cette garantie est un engagement de ${brand}. Elle s’ajoute à vos droits et ne les remplace pas.`;

/** The withdrawal right, said plainly where a buyer looks for it: the immediate download waives it, with their express consent. */
export function withdrawalFaq(noun: 'guide' | 'kit', guarantee: boolean): { q: string; a: string } {
  return {
    q: 'Et le droit de rétractation de 14 jours ?',
    a: `Le ${noun} se télécharge tout de suite après le paiement. Pour cela, nous vous demandons votre accord exprès au moment de payer : en le donnant, vous renoncez au droit de rétractation de 14 jours, comme la loi le prévoit pour un contenu numérique livré immédiatement.${guarantee ? ' Notre garantie commerciale reste valable : un e-mail suffit pour être remboursé.' : ''}`,
  };
}

/** The days a guarantee states, when it states them: the note under a button never says more than the guarantee does. */
export function guaranteeDays(text: string | null | undefined): number | null {
  const m = /(\d+)\s*jours/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}
