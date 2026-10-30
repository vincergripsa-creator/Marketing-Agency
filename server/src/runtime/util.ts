/** Small pure helpers shared by the runtime (formatting in French, input accessors, text utils). */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, min = 0, max = 1): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function slugify(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'note';
}

/** "12 €", "12,50 €", "-3,20 €". */
export function eur(n: number): string {
  const v = round2(Number.isFinite(n) ? n : 0);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  return `${s} €`;
}

/** 0.0321 → "3,2 %". */
export function pct(x: number, digits = 1): string {
  return `${((Number.isFinite(x) ? x : 0) * 100).toFixed(digits).replace('.', ',')} %`;
}

/** 1.234 → "1,23". */
export function dec(x: number, digits = 2): string {
  return (Number.isFinite(x) ? x : 0).toFixed(digits).replace('.', ',');
}

export function pad3(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(3, '0');
}

export function short(text: string, max = 48): string {
  const t = (text ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function uniq<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

export function sum(nums: readonly number[]): number {
  let s = 0;
  for (const n of nums) if (Number.isFinite(n)) s += n;
  return s;
}

export function mean(nums: readonly number[]): number {
  return nums.length ? sum(nums) / nums.length : 0;
}

export function median(nums: readonly number[]): number | null {
  const v = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** Numeric part of an id like "tsk_42" (0 when absent) — used for stable ordering. */
export function idNum(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

// ── Untyped task.input accessors ──
export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
export function numOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
export function bool(v: unknown): boolean {
  return v === true;
}

// ── Text ──
export function splitSentences(text: string): string[] {
  return (text ?? '')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function includesCI(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return (text ?? '').toLocaleLowerCase('fr').includes(phrase.toLocaleLowerCase('fr'));
}

/** Words of 4+ letters, lowercase, accents kept — for overlap scoring. */
export function keywords(text: string): string[] {
  return uniq(
    (text ?? '')
      .toLocaleLowerCase('fr')
      .split(/[^a-zà-ÿœæ0-9]+/i)
      .filter((w) => w.length >= 4),
  );
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
