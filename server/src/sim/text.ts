/** Small text + number helpers shared by the market (French formatting, matching, templating). */
import type { Rng } from '../contracts.js';

/** Lowercase, no diacritics, straight apostrophes, single spaces, "100 %" → "100%". */
export function norm(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/(\d)\s+%/g, '$1%')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'par', 'qui', 'que', 'quoi', 'est', 'sont', 'aux', 'son', 'ses',
  'leur', 'leurs', 'mon', 'mes', 'ton', 'tes', 'vos', 'votre', 'notre', 'nos', 'plus', 'moins', 'sans', 'tout', 'tous',
  'toute', 'toutes', 'cette', 'ces', 'cet', 'mais', 'donc', 'car', 'pas', 'peu', 'tres', 'bien', 'fait', 'faire',
  'quand', 'comme', 'meme', 'apres', 'avant', 'entre', 'chez', 'elle', 'ils', 'elles', 'nous', 'vous', 'lui', 'leur',
  'etre', 'avoir', 'qu', 'jusqu', 'malgre', 'encore', 'deja', 'ont', 'the', 'and', 'ans', 'mois', 'jours',
]);

/** Significant tokens of a string (normalised, ≥ 3 chars, no stopwords). */
export function keyTokens(s: string): string[] {
  const out: string[] = [];
  for (const w of norm(s).split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.push(w);
  }
  return [...new Set(out)];
}

/** Crude French stem: the first 6 letters are enough to match plural/feminine/verb forms. */
export function stem(w: string): string {
  return w.length > 6 ? w.slice(0, 6) : w;
}

export function stemSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const w of norm(text).split(/[^a-z0-9]+/)) if (w.length >= 3) set.add(stem(w));
  return set;
}

/** Share (0..1) of `tokens` whose stem appears in `stems`. Empty token list → 0. */
export function overlap(tokens: string[], stems: Set<string>): number {
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const t of tokens) if (stems.has(stem(t))) hit++;
  return hit / tokens.length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const phraseCache = new Map<string, RegExp>();

/** Does the normalised `text` contain `phrase` starting at a word boundary (light suffix tolerance)? */
export function hasPhrase(normText: string, phrase: string): boolean {
  const p = norm(phrase);
  if (!p) return false;
  let re = phraseCache.get(p);
  if (!re) {
    const tail = /[a-z]$/.test(p) ? '[a-z]{0,3}' : '';
    re = new RegExp(`(^|[^a-z0-9])${escapeRe(p)}${tail}(?=$|[^a-z0-9])`);
    phraseCache.set(p, re);
  }
  return re.test(normText);
}

/** Number of (non-overlapping) occurrences of `phrase` in normalised text. */
export function countPhrase(normText: string, phrase: string): number {
  const p = norm(phrase);
  if (!p) return 0;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(p)}`, 'g');
  return (normText.match(re) ?? []).length;
}

export function countWords(s: string): number {
  const m = (s ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** "{prenom} a acheté {produit}" + vars → text. Unknown keys are left empty. */
export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? '' : String(vars[k])));
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 133 → "133 €", 19.9 → "19,90 €", 1234.5 → "1 234,50 €". */
export function fmtEur(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const neg = v < 0;
  const abs = Math.abs(Math.round(v * 100) / 100);
  const [i, d] = abs.toFixed(2).split('.');
  const body = d === '00' ? groupThousands(i!) : `${groupThousands(i!)},${d}`;
  return `${neg ? '-' : ''}${body} €`;
}

export function fmtInt(n: number): string {
  return groupThousands(String(Math.round(Number.isFinite(n) ? n : 0)));
}

/** 0.0134 → "1,3 %". */
export function fmtPct(x: number, digits = 1): string {
  const v = Number.isFinite(x) ? x * 100 : 0;
  return `${v.toFixed(digits).replace('.', ',')} %`;
}

export function fmtNum(x: number, digits = 1): string {
  return (Number.isFinite(x) ? x : 0).toFixed(digits).replace('.', ',');
}

export function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n > 1 || n === 0 ? many : one}`;
}

export function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  if (total <= 0) return entries[0]![0];
  let r = rng.next() * total;
  for (const [v, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return entries[entries.length - 1]![0];
}

/** Lognormal draw around `median` (sigma in log space). */
export function lognormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(rng.normal(0, sigma));
}

export function uniform(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng.next();
}

/** Seeded subset keeping the original order: ceil(len × ratio) items (at least 1 when the list is non-empty). */
export function subset<T>(rng: Rng, arr: readonly T[], ratio: number): T[] {
  if (arr.length === 0) return [];
  const k = Math.min(arr.length, Math.max(1, Math.ceil(arr.length * ratio)));
  const idx = rng.shuffle(arr.map((_, i) => i)).slice(0, k).sort((a, b) => a - b);
  return idx.map((i) => arr[i]!);
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Short version of a long title for feed lines. */
export function short(s: string, max = 48): string {
  const t = (s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
