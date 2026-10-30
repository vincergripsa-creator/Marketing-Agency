// French number / money formatting, safe against NaN, Infinity and missing values.

const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

export const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** 1 234,50 € */
export function fmtEur(n: number | null | undefined, digits: 0 | 2 = 2): string {
  if (!ok(n)) return '—';
  return digits === 0 ? eur0.format(n) : eur2.format(n);
}

/** +12,30 € / −4,00 € */
export function fmtEurSigned(n: number | null | undefined, digits: 0 | 2 = 2): string {
  if (!ok(n)) return '—';
  const s = fmtEur(Math.abs(n), digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

/** Compact euros for axes and tiles: 1,2 k€ */
export function fmtEurShort(n: number | null | undefined): string {
  if (!ok(n)) return '—';
  if (Math.abs(n) < 1000) return `${int.format(n)} €`;
  return `${compact.format(n)} €`;
}

export function fmtInt(n: number | null | undefined): string {
  return ok(n) ? int.format(n) : '—';
}

export function fmtCompact(n: number | null | undefined): string {
  if (!ok(n)) return '—';
  return Math.abs(n) < 10_000 ? int.format(n) : compact.format(n);
}

/** 0.034 → 3,4 % */
export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (!ok(ratio)) return '—';
  const v = ratio * 100;
  return `${digits === 0 ? int.format(v) : digits === 2 ? dec2.format(v) : dec1.format(v)} %`;
}

export function fmtDec(n: number | null | undefined, digits: 1 | 2 = 1): string {
  if (!ok(n)) return '—';
  return digits === 2 ? dec2.format(n) : dec1.format(n);
}

/** ROAS 1,84 */
export function fmtRoas(n: number | null | undefined): string {
  return ok(n) ? `${dec2.format(n)}×` : '—';
}

export function safeDiv(a: number, b: number, fallback = 0): number {
  return b && Number.isFinite(a / b) ? a / b : fallback;
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function sum<T>(arr: readonly T[] | undefined, f: (x: T) => number): number {
  if (!arr) return 0;
  let s = 0;
  for (const x of arr) {
    const v = f(x);
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

export function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${Math.abs(n) >= 2 ? many : one}`;
}

export function pad3(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(3, '0');
}

/** Relative clock time for chat bubbles (hh:mm). */
export function fmtClock(at: number | undefined): string {
  if (!ok(at)) return '';
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function stars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

/** Deterministic small hash (UI-only jitter, never simulation). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
