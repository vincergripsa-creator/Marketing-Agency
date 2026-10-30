/**
 * Machine-readable playbook rules (French sentences in world.company.playbooks[agentId]):
 *   Ne jamais écrire « X » · Privilégier le hook « style » · Privilégier le format « format »
 *   Prix cible « N » · Niveau de promesse max « 0.4 » · Ton support « ton »
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

const QUOTED = String.raw`\s*[«"“']\s*([^»"”']+?)\s*[»"”']`;
const RE_BANNED = new RegExp(String.raw`ne\s+jamais\s+[ée]crire` + QUOTED, 'giu');
const RE_HOOK = new RegExp(String.raw`privil[ée]gier\s+le\s+hook` + QUOTED, 'iu');
const RE_FORMAT = new RegExp(String.raw`privil[ée]gier\s+le\s+format` + QUOTED, 'iu');
const RE_PRICE = new RegExp(String.raw`prix\s+cible` + QUOTED, 'iu');
const RE_HYPE = new RegExp(String.raw`niveau\s+de\s+promesse\s+max` + QUOTED, 'iu');
const RE_TONE = new RegExp(String.raw`ton\s+support` + QUOTED, 'iu');

export function parsePlaybook(rules: readonly string[] | null | undefined): PlaybookRules {
  const out: PlaybookRules = { banned: [], preferredHooks: [], preferredFormats: [], targetPrice: null, maxHype: null, supportTone: null, freeText: [] };
  for (const raw of rules ?? []) {
    const rule = clean(raw);
    if (!rule) continue;
    let machine = false;
    for (const m of rule.matchAll(RE_BANNED)) {
      const w = clean(m[1]);
      if (w && !out.banned.some((b) => norm(b) === norm(w))) out.banned.push(w);
      machine = true;
    }
    const hook = RE_HOOK.exec(rule)?.[1];
    if (hook) {
      const h = norm(hook).replace(/[\s-]+/g, '_') as HookStyle;
      if (HOOK_STYLES.includes(h) && !out.preferredHooks.includes(h)) out.preferredHooks.push(h);
      machine = true;
    }
    const fmt = RE_FORMAT.exec(rule)?.[1];
    if (fmt) {
      const f = norm(fmt).replace(/[\s-]+/g, '_') as AdFormat;
      if (AD_FORMATS.includes(f) && !out.preferredFormats.includes(f)) out.preferredFormats.push(f);
      machine = true;
    }
    const price = RE_PRICE.exec(rule)?.[1];
    if (price) {
      const n = Number(price.replace(',', '.').replace(/[^\d.]/g, ''));
      if (Number.isFinite(n) && n > 0) out.targetPrice = n;
      machine = true;
    }
    const hype = RE_HYPE.exec(rule)?.[1];
    if (hype) {
      const n = Number(hype.replace(',', '.').replace(/[^\d.]/g, ''));
      if (Number.isFinite(n)) out.maxHype = Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
      machine = true;
    }
    const tone = RE_TONE.exec(rule)?.[1];
    if (tone) {
      const t = norm(tone) as SupportTone;
      if (SUPPORT_TONES.includes(t)) out.supportTone = t;
      machine = true;
    }
    if (!machine) out.freeText.push(rule);
  }
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

export function bannedRegex(term: string): RegExp {
  const t = clean(term);
  const s = stem(t);
  const body = escapeRe(s).replace(/\s+/g, String.raw`[\s  ]*`);
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

/** Remove every banned term from a text, with light grammatical cleanup. */
export function scrubText(text: string, banned: readonly string[]): string {
  if (!text || banned.length === 0) return text;
  let out = text;
  let touched = false;
  for (const term of banned) {
    if (countMatches(out, term) === 0) continue;
    touched = true;
    // natural soft replacement first, when the replacement itself is allowed
    for (const s of SOFT) {
      const cand = out.replace(s.re, s.to);
      if (cand !== out && countMatches(cand, term) < countMatches(out, term) && !containsBanned(s.to.replace('$1', ''), banned)) out = cand;
    }
    if (/100/.test(term)) {
      out = out
        .replace(/dans[\s  ]*100[\s  ]*%[\s  ]*des cas/giu, 'dans la plupart des cas')
        .replace(/(?:à|a)[\s  ]*100[\s  ]*%/giu, '');
    }
    out = out.replace(bannedRegex(term), '');
  }
  return touched ? tidy(out) : out;
}

/** Clean spaces/punctuation left behind by removals. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t ]{2,}/g, ' ')
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
  return banned.some((b) => bannedRegex(b).test(text));
}

/** Two risky phrases conflict when one contains the other's stem (e.g. « garanti » vs « résultats garantis »). */
export function conflictsWith(phrase: string, banned: readonly string[]): boolean {
  const p = norm(phrase);
  return banned.some((b) => {
    const nb = norm(b);
    if (!nb) return false;
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
