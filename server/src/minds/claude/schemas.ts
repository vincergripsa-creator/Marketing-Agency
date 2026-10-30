/**
 * JSON schemas for structured outputs (output_config.format). Every object is closed
 * (additionalProperties: false) with all properties required, as the API expects;
 * numeric/length constraints are enforced by the normalisers instead.
 */
import type { MessageIntent, TaskKind } from '../../shared.js';
import { AD_FORMATS, HOOK_STYLES } from '../playbook.js';
import { VISUAL_TYPES } from '../shapes.js';

export type Schema = Record<string, unknown>;

const S: Schema = { type: 'string' };
const N: Schema = { type: 'number' };
const I: Schema = { type: 'integer' };
const list = (items: Schema): Schema => ({ type: 'array', items });
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });
const oneOf = (values: readonly string[]): Schema => ({ type: 'string', enum: [...values] });
export const obj = (props: Record<string, Schema>): Schema => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });

const VISUAL = obj({ type: oneOf(VISUAL_TYPES), title: S, labels: list(S), values: list(N) });
const CHAPTER = obj({ title: S, intro: S, paragraphs: list(S), steps: list(S), example: nullable(S), checklist: list(S), visual: nullable(VISUAL) });

export const INTENTS: readonly MessageIntent[] = ['question', 'non_recu', 'remboursement', 'plainte_qualite', 'sur_mesure', 'partenariat', 'arnaque', 'compliment', 'troll', 'menace_chargeback', 'bug_paiement'];
export const ACTIONS = ['none', 'refund', 'resend_link', 'discount_code', 'escalate', 'ignore', 'block'] as const;
export const LESSON_TOPICS = ['ads', 'pricing', 'product', 'support', 'niche', 'finance', 'process', 'partnership'] as const;

export const SCHEMAS = {
  ranking: (ids: string[]): Schema => obj({
    ranked: list(obj({ nicheId: ids.length ? oneOf(ids) : S, score: N, why: S, angle: S, audience: S, problem: S, suggestedPrice: N })),
  }),
  titles: obj({ titles: list(S) }),
  outline: obj({ title: S, chapters: list(obj({ title: S, points: list(S) })), bonusTitle: S, nextStepTitle: S }),
  pdf: obj({ title: S, subtitle: S, audience: S, promise: S, introduction: list(S), chapters: list(CHAPTER), bonus: CHAPTER, nextStep: obj({ title: S, text: S }) }),
  edits: obj({ issues: list(S), replacements: list(obj({ original: S, replacement: S })) }),
  redTeam: obj({ verdict: oneOf(['go', 'fix', 'kill']), reasons: list(S), fixes: list(S) }),
  salesPage: obj({
    headline: S, subheadline: S, painBullets: list(S), solution: S,
    chapterBlurbs: list(obj({ title: S, blurb: S })), bonusBlurb: S,
    objections: list(obj({ q: S, a: S })), guarantee: S, cta: S,
  }),
  hooks: obj({ hooks: list(obj({ hookStyle: oneOf(HOOK_STYLES), hook: S })) }),
  ad: obj({
    hook: S, format: oneOf(AD_FORMATS),
    scenes: list(obj({ visual: S, onScreenText: S, voiceover: S, durationSec: N })),
    caption: S, hashtags: list(S), cta: S,
  }),
  support: obj({ detectedIntent: oneOf(INTENTS), action: oneOf(ACTIONS), text: S }),
  text: obj({ text: S }),
  planDay: obj({ focus: S, memo: S, items: list(obj({ index: I, priority: I, why: S })) }),
  mission: (kinds: readonly TaskKind[]): Schema => obj({
    items: list(obj({ kind: kinds.length ? oneOf(kinds) : S, title: S, priority: I, why: S, price: nullable(N) })),
  }),
  lessons: obj({ lessons: list(obj({ topic: oneOf(LESSON_TOPICS), insight: S, evidence: S, confidence: N, appliesToRoles: list(S) })) }),
};
