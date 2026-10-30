/**
 * Machine-readable playbook rules (French sentences in world.company.playbooks[agentId]):
 *   Ne jamais écrire « X » · Privilégier le hook « style » · Privilégier le format « format »
 *   Prix cible « N » · Niveau de promesse max « 0.4 » · Ton support « ton »
 * A directive followed by « sur « Niche » » only applies to that niche (rules written by the retro).
 * Everything else is free text (shown in UI, injected into Claude prompts).
 */
import type { AdFormat, HookStyle } from '../shared.js';
import { clean, norm } from './util.js';

export const HOOK_STYLES: readonly HookStyle[] = ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'];
export const AD_FORMATS: readonly AdFormat[] = ['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel'];
export type SupportTone = 'chaleureux' | 'concis' | 'formel';
export const SUPPORT_TONES: readonly SupportTone[] = ['chaleureux', 'concis', 'formel'];

export interface PlaybookRules {
  banned: string[];
  preferredHooks: HookStyle[];
  preferredFormats: AdFormat[];
  targetPrice: number | null;
  maxHype: number | null;
  supportTone: SupportTone | null;
  freeText: string[];
}

/**
 * A quoted value. « … » and “ … ” may contain apostrophes (« n'hésitez pas à »): the plain
 * apostrophe is NOT a delimiter, otherwise « n'hésitez pas à » would be read as the banned word « n »
 * and every word starting with n (ne, n’, ni, nous, nuit, n°…) would be deleted from the guides.
 */
const QUOTED = String.raw`\s*(?:«\s*([^»]+?)\s*»|“\s*([^”]+?)\s*”|"\s*([^"]+?)\s*")`;
const RE_BANNED = new RegExp(String.raw`ne\s+jamais\s+[ée]crire` + QUOTED, 'giu');
const RE_HOOK = new RegExp(String.raw`privil[ée]gier\s+le\s+hook` + QUOTED, 'iu');
const RE_FORMAT = new RegExp(String.raw`privil[ée]gier\s+le\s+format` + QUOTED, 'iu');
const RE_PRICE = new RegExp(String.raw`prix\s+cible` + QUOTED, 'iu');
const RE_HYPE = new RegExp(String.raw`niveau\s+de\s+promesse\s+max` + QUOTED, 'iu');
const RE_TONE = new RegExp(String.raw`ton\s+support` + QUOTED, 'iu');
/** « … sur « Niche » » right after a directive (optionally « (label) » / « à tester ») scopes it to one niche. */
const RE_SCOPE = /^\s*(?:\([^)]*\)\s*)?(?:à\s+tester\s+)?sur\s*(?:«\s*([^»]+?)\s*»|“\s*([^”]+?)\s*”|"\s*([^"]+?)\s*")/iu;

const quoted = (m: RegExpExecArray | RegExpMatchArray): string => clean(m[1] ?? m[2] ?? m[3] ?? '');

/** Banned terms shorter than this (in letters/digits) are ignored: « n », « à » would wreck any text. */
const MIN_BANNED_CHARS = 3;

function usableBanned(term: string): boolean {
  return norm(term).replace(/[^a-z0-9%]/g, '').length >= MIN_BANNED_CHARS;
}

const SCOPE_STOP = new Set(['pour', 'avec', 'sans', 'dans', 'votre', 'notre', 'leur', 'leurs', 'plus', 'tous', 'toutes', 'comme', 'entre', 'apres', 'avant', 'quand', 'faire', 'cette', 'chez', 'sous', 'depuis', 'moins', 'guide', 'methode']);

function scopeStems(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !SCOPE_STOP.has(w)).map((w) => w.slice(0, 5));
}

/** Does a niche scope (« Chat qui griffe le canapé ») designate the subject of this call (niche / product texts)? */
export function scopeMatches(scope: string, subjects: readonly (string | null | undefined)[]): boolean {
  const sc = norm(scope);
  const subj = subjects.map((x) => norm(x ?? '')).filter(Boolean);
  if (!sc || subj.length === 0) return false;
  if (subj.some((x) => x === sc || x.includes(sc) || (x.length >= 8 && sc.includes(x)))) return true;
  const want = uniqueStems(scope);
  if (want.length === 0) return false;
  const have = new Set(subj.flatMap(scopeStems));
  const hits = want.filter((w) => have.has(w)).length;
  return hits / want.length >= 0.6;
}

function uniqueStems(s: string): string[] {
  return [...new Set(scopeStems(s))];
}

interface Directive<T> { value: T; scope: string | null }

function scopeAfter(rule: string, m: RegExpExecArray): string | null {
  const s = RE_SCOPE.exec(rule.slice(m.index + m[0].length));
  return s ? quoted(s) || null : null;
}

/**
 * Machine rules of a playbook. `subjects` = texts naming the niche of the current call (niche name,
 * niche id, product title / problem / audience). A rule scoped to a niche (« … sur « Niche » ») only
 * applies when it matches the subjects; unscoped rules apply everywhere; banned words are always global.
 * For singletons (price, hype, tone) a matching scoped rule beats an unscoped one, then the last rule wins.
 */
export function parsePlaybook(rules: readonly string[] | null | undefined, subjects: readonly (string | null | undefined)[] = []): PlaybookRules {
  const out: PlaybookRules = { banned: [], preferredHooks: [], preferredFormats: [], targetPrice: null, maxHype: null, supportTone: null, freeText: [] };
  const hooks: Directive<HookStyle>[] = [];
  const formats: Directive<AdFormat>[] = [];
  const prices: Directive<number>[] = [];
  const hypes: Directive<number>[] = [];
  const tones: Directive<SupportTone>[] = [];
  for (const raw of rules ?? []) {
    const rule = clean(raw);
    if (!rule) continue;
    let machine = false;
    for (const m of rule.matchAll(RE_BANNED)) {
      const w = quoted(m);
      if (w && usableBanned(w) && !out.banned.some((b) => norm(b) === norm(w))) out.banned.push(w);
      machine = true;
    }
    const hook = RE_HOOK.exec(rule);
    if (hook) {
      const h = norm(quoted(hook)).replace(/[\s-]+/g, '_') as HookStyle;
      if (HOOK_STYLES.includes(h)) hooks.push({ value: h, scope: scopeAfter(rule, hook) });
      machine = true;
    }
    const fmt = RE_FORMAT.exec(rule);
    if (fmt) {
      const f = norm(quoted(fmt)).replace(/[\s-]+/g, '_') as AdFormat;
      if (AD_FORMATS.includes(f)) formats.push({ value: f, scope: scopeAfter(rule, fmt) });
      machine = true;
    }
    const price = RE_PRICE.exec(rule);
    if (price) {
      const n = Number(quoted(price).replace(',', '.').replace(/[^\d.]/g, ''));
      if (Number.isFinite(n) && n > 0) prices.push({ value: n, scope: scopeAfter(rule, price) });
      machine = true;
    }
    const hype = RE_HYPE.exec(rule);
    if (hype) {
      const n = Number(quoted(hype).replace(',', '.').replace(/[^\d.]/g, ''));
      if (Number.isFinite(n)) hypes.push({ value: Math.min(1, Math.max(0, n > 1 ? n / 100 : n)), scope: scopeAfter(rule, hype) });
      machine = true;
    }
    const tone = RE_TONE.exec(rule);
    if (tone) {
      const t = norm(quoted(tone)) as SupportTone;
      if (SUPPORT_TONES.includes(t)) tones.push({ value: t, scope: scopeAfter(rule, tone) });
      machine = true;
    }
    if (!machine) out.freeText.push(rule);
  }
  const applies = <T>(d: Directive<T>) => d.scope === null || scopeMatches(d.scope, subjects);
  const ordered = <T>(ds: Directive<T>[]): T[] => [...ds.filter((d) => d.scope !== null && applies(d)), ...ds.filter((d) => d.scope === null)].map((d) => d.value);
  const single = <T>(ds: Directive<T>[]): T | null => {
    const scoped = ds.filter((d) => d.scope !== null && applies(d));
    const pool = scoped.length ? scoped : ds.filter((d) => d.scope === null);
    return pool.length ? pool[pool.length - 1]!.value : null;
  };
  out.preferredHooks = [...new Set(ordered(hooks))];
  out.preferredFormats = [...new Set(ordered(formats))];
  out.targetPrice = single(prices);
  out.maxHype = single(hypes);
  out.supportTone = single(tones);
  return out;
}

// ───────────────────────────── banned words ─────────────────────────────

const L = String.raw`[\p{L}\p{N}]`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stem so that « garanti » also catches « garantie(s) », « guérir » catches « guérit », « guérison ». */
function stem(word: string): string {
  const w = word.trim();
  if (/\s/.test(w) || /[^\p{L}]/u.test(w)) return w;
  const s = w.replace(/(ir|er|re|es|e|s)$/iu, '');
  return s.length >= 5 ? s : w;
}

/** Never matches anything (used for unusable terms such as « n »). */
const NEVER = /(?!)/gu;

export function bannedRegex(term: string): RegExp {
  const t = clean(term);
  if (!usableBanned(t)) return new RegExp(NEVER.source, 'gu');
  const s = stem(t);
  const body = escapeRe(s)
    .replace(/['’`´]/g, `['’]`)                 // n'hésitez = n’hésitez
    .replace(/\s+/g, String.raw`[\s  ]*`);
  const tail = /\p{L}$/u.test(s) ? `${L}*` : '';
  const head = /^\p{L}/u.test(s) ? `(?<!${L})` : '';
  return new RegExp(`${head}${body}${tail}`, 'giu');
}

/** Natural replacements for the usual risky words; anything else is removed. */
const SOFT: { re: RegExp; to: string }[] = [
  { re: /(?<![\p{L}\p{N}])garanti(e|es|s)?(?![\p{L}\p{N}])/giu, to: 'visé$1' },
  { re: /(?<![\p{L}\p{N}])gu[ée]ri(r|t|s|ssez|ssent)?(?![\p{L}\p{N}])/giu, to: 'apaiser' },
  { re: /(?<![\p{L}\p{N}])gu[ée]rison(?![\p{L}\p{N}])/giu, to: 'apaisement' },
  { re: /(?<![\p{L}\p{N}])miracles?(?![\p{L}\p{N}])/giu, to: 'efficace' },
  { re: /(?<![\p{L}\p{N}])à coup sûr(?![\p{L}\p{N}])/giu, to: 'le plus souvent' },
  { re: /(?<![\p{L}\p{N}])sans effort(?![\p{L}\p{N}])/giu, to: 'pas à pas' },
];

function countMatches(text: string, term: string): number {
  return (text.match(bannedRegex(term)) ?? []).length;
}

/** Sentences of a text (same rule as util.splitSentences, kept local to avoid a cycle). */
function sentencesOf(t: string): string[] {
  return t.split(/(?<=[.!?…]|[.!?…]\s»)\s+(?=[«"\p{Lu}\p{N}—–-])/u).map((x) => x.trim()).filter(Boolean);
}

function capFirst(s: string): string {
  const m = /^([^\p{L}\p{N}]*)(\p{L})/u.exec(s);
  return m ? m[1] + m[2]!.toUpperCase() + s.slice(m[0].length) : s;
}

/**
 * Remove every banned term from a text, with light grammatical cleanup. A banned multi-word phrase
 * (« n'hésitez pas à ») takes its whole sentence with it when the text has other sentences: cutting
 * the phrase out of the middle of a sentence leaves broken French.
 */
export function scrubText(text: string, banned: readonly string[]): string {
  const terms = banned.filter(usableBanned);
  if (!text || terms.length === 0) return text;
  let out = text;
  let touched = false;
  for (const term of terms) {
    if (countMatches(out, term) === 0) continue;
    touched = true;
    if (/\s/.test(clean(term))) {
      const sents = sentencesOf(out);
      if (sents.length > 1) {
        const kept = sents.filter((s) => countMatches(s, term) === 0);
        if (kept.length > 0) { out = kept.join(' '); continue; }
      }
      const removed = out.replace(bannedRegex(term), '').trim();
      out = removed ? capFirst(removed) : removed;
      continue;
    }
    // natural soft replacement first, when the replacement itself is allowed
    for (const s of SOFT) {
      const cand = out.replace(s.re, s.to);
      if (cand !== out && countMatches(cand, term) < countMatches(out, term) && !containsBanned(s.to.replace('$1', ''), terms)) out = cand;
    }
    if (/100/.test(term)) {
      out = out
        .replace(/dans[\s  ]*100[\s  ]*%[\s  ]*des cas/giu, 'dans la plupart des cas')
        .replace(/(?:à|a)[\s  ]*100[\s  ]*%/giu, '');
    }
    out = out.replace(bannedRegex(term), '');
  }
  return touched ? tidy(out) : out;
}

/** Clean spaces/punctuation left behind by removals. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t ]{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/«\s*»/g, '')
    .replace(/,\s*,/g, ',')
    .replace(/:\s*\./g, '.')
    .replace(/^\s*[,;:]\s*/gm, '')
    .replace(/ +\n/g, '\n')
    .trim();
}

export function containsBanned(text: string, banned: readonly string[]): boolean {
  return banned.some((b) => usableBanned(b) && bannedRegex(b).test(text));
}

/** Two risky phrases conflict when one contains the other's stem (e.g. « garanti » vs « résultats garantis »). */
export function conflictsWith(phrase: string, banned: readonly string[]): boolean {
  const p = norm(phrase);
  return banned.some((b) => {
    const nb = norm(b);
    if (!nb || !usableBanned(b)) return false;
    if (p.includes(nb) || nb.includes(p)) return true;
    const sb = norm(stem(b));
    return sb.length >= 4 && (p.includes(sb) || bannedRegex(b).test(phrase));
  });
}

/** Deep scrub of any JSON-like output. */
export function scrubDeep<T>(v: T, banned: readonly string[]): T {
  if (banned.length === 0) return v;
  if (typeof v === 'string') return scrubText(v, banned) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, banned)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = scrubDeep(x, banned);
    return out as T;
  }
  return v;
}
