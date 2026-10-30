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
  const head = clean(s).replace(/^[«"“'\s]+/, '').replace(/[\s.;:,!?…]+$/, '');
  // a closing guillemet that answers one inside the text stays: « viser « toutes les entreprises » » must not lose it
  const unmatched = (head.match(/»/g) ?? []).length > (head.match(/«/g) ?? []).length;
  return head.replace(unmatched ? /[»"”\s]+$/ : /["”\s]+$/, '').replace(/[\s.;:,!?…]+$/, '').trim();
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

/** Verbatim in running prose: like q(), but a customer's question keeps its « ? » inside the quotes. */
export function qv(s: string): string {
  const quoted = q(s);
  return /\?\s*[»"”]?\s*$/.test(clean(s)) ? quoted.replace(/ »$/, ' ? »') : quoted;
}

/** Full sentence: capitalised, ends with punctuation. */
export function sentence(s: string): string {
  const t = clean(s);
  if (!t) return '';
  if (/[.!?…»]$/.test(t)) return cap(t);
  return cap(t.replace(/[\s,;:]+$/, '')) + '.';
}

/** « verbatim » customer words. */
export function q(s: string): string {
  // nested quotes inside a verbatim are French “ ” (« il me dit “ça va passer” »), never stray apostrophes
  return `« ${bare(s).replace(/(^|[\s(])['‘’]([^'‘’]+?)['‘’](?=[\s,.;:!?)]|$)/g, '$1“$2”')} »`;
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
  // a sentence may also end on a closing guillemet: « … ? » Suite.
  return t.split(/(?<=[.!?…]|[.!?…]\s»)\s+(?=[«"\p{Lu}\p{N}—–-])/u).map((x) => x.trim()).filter(Boolean);
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

/** Short audience label for tight spaces (hooks, captions): a whole phrase, never an ellipsis. */
export function shortAudience(audience: string, max = 42): string {
  const a = lf(audience).replace(/\s*\([^)]*\)/g, '');
  if (a.length <= max) return a;
  const l = clauseLabel(a, max, 6);
  return l ? lowerFirst(l) : lowerFirst(labelOf(a, max));
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

/** A title without its own guillemets, to print inside ours (« « La peur… » : … » is never right). */
export function plainTitle(s: string): string {
  return clean(s).replace(/«\s*/g, '').replace(/\s*»/g, '');
}

/** Whole short label for diagrams / checklists (never cut mid-phrase, no ellipsis). */
export function shortLabel(s: string, max = 34): string {
  return labelOf(s, max);
}



// ───────────────────────────── clean labels (never cut a phrase mid-sentence) ─────────────────────────────

/** Words a label / title can never end on (« Les accidents de », « malgré les », « le vernis fait »). */
const DANGLING = new Set([
  'de', 'd', 'du', 'des', 'a', 'au', 'aux', 'le', 'la', 'les', 'l', 'un', 'une', 'et', 'ou', 'en', 'pour', 'par', 'sur', 'sous',
  'dans', 'avec', 'sans', 'malgre', 'que', 'qu', 'qui', 'ne', 'n', 'se', 's', 'son', 'sa', 'ses', 'leur', 'leurs', 'mon', 'ma', 'mes',
  'ton', 'ta', 'tes', 'votre', 'vos', 'notre', 'nos', 'ce', 'cet', 'cette', 'ces', 'tres', 'plus', 'moins', 'si', 'quand',
  'comme', 'chez', 'entre', 'vers', 'avant', 'apres', 'mais', 'donc', 'car', 'lorsqu', 'lorsque', 'puis',
  'il', 'elle', 'ils', 'elles', 'on', 'je', 'j', 'tu', 'dont', 'jusqu', 'pendant', 'depuis', 'c', 'est', 'sont',
  'tout', 'tous', 'toute', 'toutes', 'juste', 'trop', 'encore', 'deja', 'presque', 'plutot', 'assez',
  'fait', 'font', 'met', 'mettent', 'rend', 'rendent', 'donne', 'prend', 'devant', 'derriere', 'pres', 'loin', 'autour',
  'ni', 'sauf', 'hormis', 'excepte', 'sinon', 'surtout', 'notamment',
]);

/**
 * « pas » and « jamais » close a phrase only after their « ne » (« il ne dort pas »). Without it they open
 * the clause that was cut: « Nettoyer au vinaigre, jamais » reads as if the first half were forbidden.
 */
function danglingNegation(s: string, last: string): boolean {
  if (last !== 'pas' && last !== 'jamais') return false;
  const clause = norm(s.split(/[,;:]/).pop() ?? '').split(/[\s']+/);
  return !clause.includes('ne') && !clause.includes('n');
}

/** True when the phrase ends on a preposition / article / auxiliary / contrast word / bare number (an obviously cut fragment). */
export function endsDangling(s: string): boolean {
  const words = norm(s).replace(/[^a-z0-9'\s-]/g, ' ').trim().split(/[\s']+/).filter(Boolean);
  const last = words[words.length - 1] ?? '';
  // a capitalised last word is a name / acronym / letter (« Plan B », « TOEIC »), never « à », « le »…
  const rawLast = clean(s).split(/[\s'’]+/).filter(Boolean).pop() ?? '';
  if (words.length > 1 && /^\p{Lu}/u.test(rawLast)) return false;
  if (danglingNegation(s, last)) return true;
  // adverbial « juste avant », « peu après », « et après » end a phrase legitimately
  if ((last === 'avant' || last === 'apres') && /^(juste|peu|bien|longtemps|et|d|jour|semaine|mois|l)$/.test(words[words.length - 2] ?? '')) return false;
  // locutions that need their complement (« facturé au lieu », « à cause », « en fonction »)
  if (/(?:^|\s)(?:au lieu|a cause|grace|en raison|a partir|en fonction|par rapport|lors|a l aide|au moment|au niveau|en cas)$/.test(words.join(' '))) return true;
  return !last || DANGLING.has(last) || /^\d+$/.test(last);
}

/** « ne / n’ » without its second half (« je ne savais ») is a cut negation. « Nettoyer », « neuf » are not one. */
function brokenNegation(s: string): boolean {
  const n = ` ${norm(s)} `.replace(/\sn'importe\s/g, ' importe ');
  const i = n.search(/\s(?:ne\s|n')/);
  if (i < 0) return false;
  return !/\b(pas|plus|jamais|rien|personne|aucun|aucune|guere|que|qu'|ni)\b/.test(n.slice(i + 2));
}

/** Cut points tried, strongest first: punctuation, then subordinate words (the head keeps its meaning). */
const COLON_SEPARATOR = /\s*[:;]\s+/;
const LABEL_SEPARATORS: RegExp[] = [COLON_SEPARATOR, /\s+[—–]\s+/, /\s+-\s+/, /,\s+/, /\s+\(/];

/**
 * Tier 1 = clause boundaries (the head is a whole clause: « Il se retient dehors | et se lâche… »).
 * Tier 2 = prepositions (« Peur de se tromper dans la déclaration | de chiffre d'affaires »), only when no
 * clause head fits. « sans », « avec », « chaque » are never cut points: they carry the meaning
 * (« Laisser des questions | sans réponse » would say the opposite).
 */
const LABEL_CUTWORDS: readonly (readonly string[])[] = [
  [' qui ', ' quand ', ' lorsqu', ' parce ', ' alors ', ' afin ', ' pour ', ' malgré ', ' dès ', ' avant ', ' après ',
    ' même ', ' mais ', ' et ', ' ou ', ' vivant ', ' habitant ', ' à cause ', ' depuis ', ' pendant ', ' juste ', ' tous les ', ' toutes les '],
  [' dans ', ' sur ', ' en ', ' de ', ' du ', ' des '],
];

/** A head before a comma that is only a circumstance (« En micro-entreprise, … », « Après un imprévu, … »). */
const CIRCUMSTANCE = /^(après|avant|pendant|en|dans|si|quand|chaque|même|dès|pour|le soir|le matin|la nuit|au début|à|avec|sans|entre|une fois|au quotidien|concrètement|sinon|ensuite|enfin|d’abord|d'abord)\b/iu;

/** A head that only announces what follows its colon (« L’erreur de presque tous : … »): the meaning is after it. */
const LEAD_IN = /^(?:l['’](?:erreur|astuce|idée|objectif)|le (?:secret|conseil|piège|truc|déclic|plus)|la (?:règle|clé|vraie|seule)|ce qui|ce que|voici|voilà|attention|astuce|rappel|résultat|objectif|bonus|pov|exemple|conseil|règle)\b/iu;

/** A negative head keeps its limit: « Ne pas nourrir le chiot | juste avant de sortir » cut there forbids all meals. */
const NEGATIVE = /(?:^|[\s'])(?:ne|n|jamais|sans|aucun|aucune|eviter|interdit)(?=[\s']|$)/;
const REASON_CUTS: ReadonlySet<string> = new Set([' et ', ' ou ', ' mais ', ' parce ', ' afin ', ' alors ']);

function labelOk(s: string, min: number, max: number): boolean {
  const t = s.trim();
  return t.length >= min && t.length <= max && !endsDangling(t) && !brokenNegation(t) && !/[«“(]$/.test(t)
    && (t.match(/«/g) ?? []).length === (t.match(/»/g) ?? []).length;
}

/** A cut head must still say something: two words at least. */
function headOk(s: string, min: number, max: number): boolean {
  return labelOk(s, min, max) && s.trim().split(/\s+/).length >= 2;
}

/** « personnelles et professionnelles », « mensuellement ou trimestriellement » : cut between two alike words, the phrase says less, or something false. */
function pairedWords(head: string, rest: string): boolean {
  const a = norm(head).split(/[\s']+/).pop() ?? '';
  const b = norm(rest).split(/[\s,.;:']+/)[0] ?? '';
  return a.length >= 5 && b.length >= 5 && a.slice(-3) === b.slice(-3);
}

export interface LabelOptions { min?: number; tiers?: 1 | 2 }

/**
 * A whole short phrase usable as a label / title piece (≤ max chars), or null.
 * Never cuts mid-phrase: the text is kept whole, or reduced to its head at a natural boundary
 * (« : », « , », « qui », « malgré »…), and never ends on a dangling word. No ellipsis.
 * `tiers: 1` forbids prepositional cuts (strict, for chart labels).
 */
export function clauseLabel(s: string | null | undefined, max: number, min: number | LabelOptions = 8, depth = 0): string | null {
  const o: LabelOptions = typeof min === 'number' ? { min } : min;
  const mn = o.min ?? 8;
  const tiers = o.tiers ?? 2;
  const t = bare(String(s ?? '').replace(/\s*\([^)]*\)/g, '')).replace(/\s+/g, ' ');
  if (!t) return null;
  if (labelOk(t, Math.min(mn, t.length), max)) return cap(t);
  for (const sep of LABEL_SEPARATORS) {
    const parts = t.split(sep);
    const head = bare(parts[0] ?? '');
    if (head === t) continue;
    // « En micro-entreprise, on déclare… » : the circumstance alone says nothing, the rest carries the meaning
    const payoffAfter = sep === COLON_SEPARATOR && (LEAD_IN.test(head) || !headOk(head, mn, max));
    if ((CIRCUMSTANCE.test(head) || payoffAfter) && parts.length > 1 && depth === 0) {
      const tail = clauseLabel(parts.slice(1).join(', '), max, o, 1);
      if (tail) return tail;
      continue;
    }
    if (headOk(head, mn, max)) return cap(head);
  }
  // longest head before a subordinate word (clause boundaries first, then prepositions)
  const low = ` ${t} `.toLowerCase();
  for (const tier of LABEL_CUTWORDS.slice(0, tiers)) {
    let best: string | null = null;
    for (const w of tier) {
      let from = 0;
      for (;;) {
        const i = low.indexOf(w, from);
        if (i < 0) break;
        from = i + 1;
        const head = bare(t.slice(0, Math.max(0, i - 1)));
        if (NEGATIVE.test(norm(head)) && !REASON_CUTS.has(w)) continue;
        if ((w === ' et ' || w === ' ou ') && pairedWords(head, t.slice(i - 1 + w.length))) continue;
        if (headOk(head, mn, max) && (!best || head.length > best.length)) best = head;
      }
    }
    if (best) return cap(best);
  }
  return null;
}

/** First candidate that yields a clean label. */
export function bestLabel(cands: readonly (string | null | undefined)[], max: number, min: number | LabelOptions = 8): string | null {
  for (const c of cands) {
    const l = clauseLabel(c, max, min);
    if (l) return l;
  }
  return null;
}

/** A cut can also stop on a number or a quantifier (« plus de deux »): the end of the sentence is what counted. */
const CUT_QUANTITY = /(?:^|\s)(?:deux|trois|quatre|cinq|six|sept|huit|dix|quelques|plusieurs|chaque|aucune?|certaine?s)$/;

/** Words are dropped from the end until what remains is a phrase: no dangling word, no open quote, no half negation. */
function trimCut(s: string): string {
  let out = s;
  for (;;) {
    out = bare(out);
    const open = (out.match(/«/g) ?? []).length > (out.match(/»/g) ?? []).length;
    if (!out || !(endsDangling(out) || CUT_QUANTITY.test(norm(out)) || brokenNegation(out) || open)) return out;
    out = out.split(/\s+/).slice(0, -1).join(' ');
  }
}

/** Clean label, else a word-boundary cut WITHOUT ellipsis and without dangling words (last resort). */
export function labelOf(s: string, max: number): string {
  const l = clauseLabel(s, max);
  if (l) return l;
  const words = bare(s).replace(/\s*\([^)]*\)/g, '').split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return cap(trimCut(out) || bare(s).slice(0, max));
}

/** First candidate (in order) that is ≤ max chars, has at most one « : », no ellipsis, no dangling end. */
export function composeTitle(variants: readonly (string | null | undefined)[], max = 95): string | null {
  for (const v of variants) {
    const t = clean(v ?? '');
    if (!t || t.length > max || /…|\.\.\./.test(t)) continue;
    if ((t.match(/\s:\s/g) ?? []).length > 1) continue;
    if (endsDangling(t.replace(/\s*\([^)]*\)$/, ''))) continue;
    return t;
  }
  return null;
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
