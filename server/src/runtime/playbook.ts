/**
 * Playbooks = learned French rules per agent (max 12). A few machine-readable patterns are honoured
 * by the runtime (and by the content engine): see SHARED CONVENTIONS.
 */
import type { AdFormat, AgentId, HookStyle, WorldState } from '../shared.js';
import { includesCI } from './util.js';

export const MAX_PLAYBOOK_RULES = 12;

export const HOOK_STYLES: readonly HookStyle[] = ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'];
export const AD_FORMATS: readonly AdFormat[] = ['faceless_voiceover', 'text_slideshow', 'ugc_avatar', 'carousel'];
export const PRICE_ARMS: readonly string[] = ['9', '14', '19', '24', '29', '39', '49'];
export const HYPE_ARMS: readonly string[] = ['0.2', '0.4', '0.6', '0.8'];
export const SUPPORT_TONES: readonly string[] = ['chaleureux', 'concis', 'formel'];

export interface PlaybookDirectives {
  banned: string[];
  hook: HookStyle | null;
  format: AdFormat | null;
  targetPrice: number | null;
  maxHype: number | null;
  tone: string | null;
}

const RX = {
  banned: /Ne jamais écrire\s*«\s*([^»]+?)\s*»/i,
  hook: /Privilégier le hook\s*«\s*([^»]+?)\s*»/i,
  format: /Privilégier le format\s*«\s*([^»]+?)\s*»/i,
  price: /Prix cible\s*«\s*([^»]+?)\s*»/i,
  hype: /Niveau de promesse max\s*«\s*([^»]+?)\s*»/i,
  tone: /Ton support\s*«\s*([^»]+?)\s*»/i,
};

const SINGLETONS = [RX.hook, RX.format, RX.price, RX.hype, RX.tone];

function parseNumber(s: string): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** « … sur « Niche » » right after a directive scopes it to one niche (rules written by the retro). */
const SCOPE = /^\s*(?:\([^)]*\)\s*)?sur\s*«\s*([^»]+?)\s*»/i;

function scopeOf(rule: string, m: RegExpExecArray): string | null {
  const s = SCOPE.exec(rule.slice(m.index + m[0].length));
  return s ? s[1]!.trim() : null;
}

/**
 * Extracts the machine-readable directives (last rule wins for singleton patterns).
 * With `niche`, rules scoped to another niche (« … sur « Autre niche » ») are ignored; banned words stay global.
 */
export function parsePlaybook(rules: readonly string[], niche?: string): PlaybookDirectives {
  const d: PlaybookDirectives = { banned: [], hook: null, format: null, targetPrice: null, maxHype: null, tone: null };
  const inScope = (rule: string, m: RegExpExecArray): boolean => {
    const scope = scopeOf(rule, m);
    if (!scope || !niche) return true;
    return includesCI(niche, scope) || includesCI(scope, niche);
  };
  for (const rule of rules) {
    let m = RX.banned.exec(rule);
    if (m) { d.banned.push(m[1]!.trim()); continue; }
    if (SINGLETONS.some((rx) => { const hit = rx.exec(rule); return hit && !inScope(rule, hit); })) continue;
    m = RX.hook.exec(rule);
    if (m && (HOOK_STYLES as readonly string[]).includes(m[1]!.trim())) { d.hook = m[1]!.trim() as HookStyle; continue; }
    m = RX.format.exec(rule);
    if (m && (AD_FORMATS as readonly string[]).includes(m[1]!.trim())) { d.format = m[1]!.trim() as AdFormat; continue; }
    m = RX.price.exec(rule);
    if (m) { const n = parseNumber(m[1]!); if (n !== null && n > 0) d.targetPrice = n; continue; }
    m = RX.hype.exec(rule);
    if (m) { const n = parseNumber(m[1]!); if (n !== null) d.maxHype = Math.min(1, Math.max(0, n)); continue; }
    m = RX.tone.exec(rule);
    if (m) d.tone = m[1]!.trim();
  }
  return d;
}

export function playbookOf(world: WorldState, agentId: AgentId): string[] {
  return world.company.playbooks[agentId] ?? [];
}

/** Directives of an agent, optionally for one niche (scoped rules of other niches are ignored). */
export function directivesOf(world: WorldState, agentId: AgentId, niche?: string): PlaybookDirectives {
  return parsePlaybook(playbookOf(world, agentId), niche);
}

/** Adds a rule (dedup; a singleton pattern replaces its previous value; capped at 12 rules, oldest dropped). */
export function addPlaybookRule(world: WorldState, agentId: AgentId, rule: string): boolean {
  const list = (world.company.playbooks[agentId] ??= []);
  if (list.some((r) => r.trim().toLowerCase() === rule.trim().toLowerCase())) return false;
  const singleton = SINGLETONS.find((rx) => rx.test(rule));
  if (singleton) {
    const idx = list.findIndex((r) => singleton.test(r));
    if (idx >= 0) { list[idx] = rule; return true; }
  }
  list.push(rule);
  while (list.length > MAX_PLAYBOOK_RULES) list.shift();
  return true;
}

/** A playbook copy where the support tone is forced (bandit arm or experiment variant). */
export function withTone(rules: readonly string[], tone: string): string[] {
  return [...rules.filter((r) => !RX.tone.test(r)), `Ton support « ${tone} »`];
}

/** Banned words/phrases that appear in a text. */
export function bannedHits(text: string, banned: readonly string[]): string[] {
  return banned.filter((b) => includesCI(text, b));
}
