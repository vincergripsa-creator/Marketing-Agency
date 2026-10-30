/**
 * Small helpers shared by both minds: a local seeded PRNG (content variation must never touch
 * the simulation Rng nor Math.random) and French text utilities.
 */

// ───────────────────────────── seeded PRNG ─────────────────────────────

export interface LocalRng {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  sample<T>(arr: readonly T[], n: number): T[];
}

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 seeded from the engine seed + a hash of the inputs. */
export function seededRng(seed: number, ...parts: (string | number | null | undefined)[]): LocalRng {
  let s = (hashString(parts.map((p) => String(p ?? '')).join('␟')) ^ Math.imul((seed >>> 0) || 1, 0x9e3779b1)) >>> 0;
  if (s === 0) s = 0x2545f491;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    chance: (p) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    shuffle,
    sample: <T>(arr: readonly T[], n: number): T[] => shuffle(arr).slice(0, Math.max(0, n)),
  };
}

/** Cycling pool over a list: take() never fails while the list is non-empty. */
export class Pool<T> {
  private i = 0;
  private readonly items: T[];
  constructor(items: readonly T[], rng?: LocalRng) {
    this.items = rng ? rng.shuffle(items) : items.slice();
  }
  get size(): number { return this.items.length; }
  get used(): number { return this.i; }
  /** True while some items were never handed out. */
  get fresh(): boolean { return this.i < this.items.length; }
  take(): T | null {
    if (this.items.length === 0) return null;
    const v = this.items[this.i % this.items.length]!;
    this.i += 1;
    return v;
  }
  /** Only items never handed out before (null once exhausted). */
  takeFresh(): T | null {
    return this.fresh ? this.take() : null;
  }
  all(): T[] { return this.items.slice(); }
}

// ───────────────────────────── French text ─────────────────────────────

/** Lowercase, accent-free, straight apostrophes, collapsed spaces — for matching only. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .replace(/[  ]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function clean(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Remove surrounding quotes and trailing punctuation. */
export function bare(s: string | null | undefined): string {
  return clean(s)
    .replace(/^[«"“'\s]+/, '')
    .replace(/[»"”\s]+$/, '')
    .replace(/[\s.;:,!?…]+$/, '')
    .trim();
}

export function cap(s: string): string {
  const m = /^([^\p{L}\p{N}]*)(\p{L})/u.exec(s);
  if (!m) return s;
  return m[1] + m[2]!.toUpperCase() + s.slice(m[0].length);
}

/** Lowercase the first letter unless the first word looks like an acronym / proper noun ("TikTok", "SOS"). */
export function lf(s: string): string {
  const t = bare(s);
  const first = t.split(/\s+/)[0] ?? '';
  if (/^\p{Lu}.*\p{Lu}/u.test(first)) return t;
  if (KEEP_CAPS.has(norm(first).replace(/[^a-z]/g, ''))) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}
const KEEP_CAPS = new Set(['tiktok', 'instagram', 'youtube', 'paris', 'noel', 'google', 'amazon', 'excel', 'linkedin']);

/** Full sentence: capitalised, ends with punctuation. */
export function sentence(s: string): string {
  const t = clean(s);
  if (!t) return '';
  if (/[.!?…»]$/.test(t)) return cap(t);
  return cap(t.replace(/[\s,;:]+$/, '')) + '.';
}

/** « verbatim » customer words. */
export function q(s: string): string {
  return `« ${bare(s)} »`;
}

export function fit(s: string, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(1, max - 1));
  const sp = cut.lastIndexOf(' ');
  const base = (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—(«]+$/, '');
  return base + '…';
}

/** First candidate that fits, else the first one truncated. */
export function firstFit(cands: string[], max: number): string {
  const ok = cands.map(clean).filter((c) => c.length > 0);
  for (const c of ok) if (c.length <= max) return c;
  return fit(ok[0] ?? '', max);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Split a paragraph into sentences (keeps «…» quotes intact as long as they contain no final dot). */
export function splitSentences(p: string): string[] {
  const t = clean(p);
  if (!t) return [];
  return t.split(/(?<=[.!?…])\s+(?=[«"\p{Lu}\p{N}—–-])/u).map((x) => x.trim()).filter(Boolean);
}

export function uniqBy<T>(arr: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of arr) {
    const k = key(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function uniqStrings(arr: readonly (string | null | undefined)[]): string[] {
  return uniqBy(arr.map(clean).filter(Boolean), norm);
}

export function fmtNum(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(decimals).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function fmtEur(n: number): string {
  if (!Number.isFinite(n)) return '0 €';
  return Number.isInteger(Math.round(n * 100) / 100) ? `${fmtNum(n)} €` : `${fmtNum(n, 2)} €`;
}

export function fmtPct(ratio: number, decimals = 1): string {
  return `${fmtNum((Number.isFinite(ratio) ? ratio : 0) * 100, decimals)} %`;
}

export function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

export function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isStr).map(clean) : [];
}

export function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** Apply `fn` to every string inside a JSON-like value (returns a new value). */
export function mapStrings<T>(v: T, fn: (s: string) => string): T {
  if (typeof v === 'string') return fn(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = mapStrings(x, fn);
    return out as T;
  }
  return v;
}

/** Concatenate every string of a JSON-like value. */
export function allText(v: unknown): string {
  const parts: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === 'string') parts.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x as Record<string, unknown>).forEach(walk);
  };
  walk(v);
  return parts.join(' ');
}

// ───────────────────────────── niche-aware wording ─────────────────────────────

/** "parents épuisés de bébés de 6 à 12 mois" → "les parents épuisés de bébés de 6 à 12 mois". */
export function withArticle(audience: string): string {
  const a = lf(audience);
  if (!a) return 'les lecteurs';
  if (/^(les|des|le|la|l'|un|une|vos|nos|mes|ceux|celles|tous|toutes)\b/i.test(a)) return a;
  const first = a.split(/\s+/)[0] ?? '';
  if (/[sx]$/i.test(first)) return `les ${a}`;
  return a;
}

/** Short audience label for tight spaces (hooks, captions). */
export function shortAudience(audience: string, max = 42): string {
  const a = lf(audience).replace(/\s*\([^)]*\)/g, '');
  if (a.length <= max) return a;
  const cut = a.split(/\s+(?:qui|dont|avec|et|lorsqu|quand)\s+/i)[0] ?? a;
  return fit(cut, max);
}

const AGE_RE = /(\d{1,2})\s*(?:-|–|à|a|et)\s*(\d{1,2})\s*(mois|ans)/i;
const AFTER_RE = /(?:après|apres|plus de)\s+(\d{2})\s*ans/i;

/** First age range found ("6-12 mois", "après 40 ans"), or null. */
export function extractAgeRange(texts: readonly string[]): string | null {
  for (const t of texts) {
    const m = AGE_RE.exec(t);
    if (m) return `${m[1]}-${m[2]} ${m[3]!.toLowerCase()}`;
  }
  for (const t of texts) {
    const m = AFTER_RE.exec(t);
    if (m) return `après ${m[1]} ans`;
  }
  return null;
}

export interface Duration { n: number; unit: string; unitOne: string }

const UNIT_ONE: Record<string, string> = { nuits: 'nuit', jours: 'jour', semaines: 'semaine', soirs: 'soir', séances: 'séance', matins: 'matin' };

/** Programme length: most frequent "<n> nuits/jours/semaines" in the research, else a sensible default. */
export function programmeDuration(texts: readonly string[], category: string, keywords: readonly string[]): Duration {
  const counts = new Map<string, number>();
  const re = /\b(7|10|14|21|28|30)\s*(nuits|jours|soirs|matins)\b/gi;
  for (const t of texts) {
    for (const m of t.matchAll(re)) {
      const k = `${m[1]} ${m[2]!.toLowerCase()}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) {
    const [n, unit] = best[0].split(' ');
    return { n: Number(n), unit: unit!, unitOne: UNIT_ONE[unit!] ?? unit!.replace(/s$/, '') };
  }
  const k = norm([category, ...keywords].join(' '));
  if (/sommeil|nuit|dormir|coucher|reveil/.test(k)) return { n: 14, unit: 'nuits', unitOne: 'nuit' };
  if (/sport|fitness|course|muscu|ventre|poids|minceur|yoga/.test(k)) return { n: 21, unit: 'jours', unitOne: 'jour' };
  if (/argent|budget|finance|dette|epargne|business|freelance|vente/.test(k)) return { n: 30, unit: 'jours', unitOne: 'jour' };
  return { n: 14, unit: 'jours', unitOne: 'jour' };
}

/** Subject noun for the "Chaque X est différent" family of clichés. */
export function subjectNoun(texts: readonly string[]): { noun: string; fem: boolean } {
  const k = norm(texts.join(' '));
  if (/\bbebe/.test(k)) return { noun: 'bébé', fem: false };
  if (/\b(enfant|ado|fils|fille)/.test(k)) return { noun: 'enfant', fem: false };
  if (/\bchien|chiot/.test(k)) return { noun: 'chien', fem: false };
  if (/\bchat\b|chaton/.test(k)) return { noun: 'chat', fem: false };
  if (/\bcorps|ventre|poids|peau/.test(k)) return { noun: 'corps', fem: false };
  if (/\bcouple|conjoint/.test(k)) return { noun: 'couple', fem: false };
  return { noun: 'situation', fem: true };
}

/** "Tenir un carnet" → "Tenir un carnet" (steps stay infinitive, short form for diagrams). */
export function shortLabel(s: string, max = 34): string {
  const t = bare(s).replace(/\s*\([^)]*\)/g, '');
  const head = t.split(/\s*[,;:]\s+|\s+(?:pour|afin|en pensant|parce)\s+/i)[0] ?? t;
  return cap(fit(head.length >= 8 ? head : t, max));
}



/** Lowercase the first letter only (keeps any trailing ellipsis, unlike lf). */
export function lowerFirst(s: string): string {
  const t = clean(s);
  const first = t.split(/\s+/)[0] ?? '';
  if (/^\p{Lu}.*\p{Lu}/u.test(first) || KEEP_CAPS.has(norm(first).replace(/[^a-z]/g, ''))) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** "la nuit", "le jour" — article for a programme unit. */
export function theUnit(unitOne: string): string {
  return /^(nuit|semaine|séance|seance|soirée)$/i.test(unitOne) ? `la ${unitOne}` : `le ${unitOne}`;
}

/** "de" + an audience with article: les parents → des parents, le lecteur → du lecteur. */
export function ofAud(audArt: string): string {
  const a = clean(audArt);
  if (/^les\s/i.test(a)) return `des ${a.slice(4)}`;
  if (/^le\s/i.test(a)) return `du ${a.slice(3)}`;
  if (/^(la\s|l['’])/i.test(a)) return `de ${a}`;
  return /^[aeiouyàâéèêëîïôûùh]/i.test(a) ? `d’${a}` : `de ${a}`;
}
