/**
 * What talent changes in the work (talent §4). Talent never touches the market: it changes the text an engine writes and
 * the decisions a handler takes, and the market reads those through its usual scorers.
 */
import type { AgentState, DailyAdStats, ModelTier, Skill, TaskKind, WorldState } from '../../shared.js';
import type { Craft, MindContext, Rng } from '../../contracts.js';
import { clamp, streamRng } from '../../core/index.js';
import { hashString } from '../../core/ids.js';
import type { RuntimeCtx } from '../ctx.js';
import { STREAM } from '../streams.js';
import { TALENT } from './constants.js';
import { skillOf } from './skills.js';
import { talentMode, truthOf } from './truth.js';

const TIER_BELOW: Record<ModelTier, ModelTier> = { opus: 'sonnet', sonnet: 'haiku', haiku: 'haiku' };

/** Quality comes up over a week after a hire (D10). The team of day 1 never ramps: `hiredDay` is 0. */
export function rampOf(a: Pick<AgentState, 'hiredDay'>, day: number): number {
  const days = day - a.hiredDay;
  if (a.hiredDay <= 0 || days >= TALENT.rampDays) return 1;
  return TALENT.rampFrom + (1 - TALENT.rampFrom) * days / TALENT.rampDays;
}

/** undefined when mode is 'off'. */
export function effectiveT(w: WorldState, a: AgentState, skill: Skill): number | undefined {
  if (talentMode(w) === 'off') return undefined;
  const t = truthOf(w, a)?.talent[skill];
  return t === undefined ? undefined : clamp(t * rampOf(a, w.day), 0, 1);
}

/**
 * Talent as a way of working. Pure, so that a candidate can sit a test with the craft of a talent no agent holds yet.
 * `tier` and `effort` only speak to Claude (§4.9): a weak draft is a smaller model, a strong one looks twice.
 */
export function craftOf(skill: Skill, t: number, tier: ModelTier, extraDraw = false): Craft {
  const x = clamp(t, 0, 1);
  const { claude } = TALENT;
  const flawless = TALENT.flawless.includes(skill);
  const craft: Craft = {
    skill,
    t: x,
    flaw: flawless ? 0 : TALENT.flawBase * (1 - x) ** TALENT.flawPower,
    draws: 1 + Math.floor(x * 3) + (extraDraw ? TALENT.perkDraws : 0),
    eye: TALENT.eyeSd * (1 - x),
    sharp: 1 + Math.round(x * TALENT.sharpSpan),
    passes: x >= TALENT.passes.three ? 3 : x >= TALENT.passes.two ? 2 : 1,
    reach: flawless ? 1 : TALENT.reachBase + TALENT.reachSpan * x,
  };
  if (x < claude.lowBelow) return { ...craft, tier: TIER_BELOW[tier], effort: 'low' };
  return x >= claude.highFrom ? { ...craft, effort: 'high' } : craft;
}

/** undefined when the mode is 'off' or the kind has no skill: every lever then reads as today. */
export function craftFor(w: WorldState, a: AgentState, kind: TaskKind): Craft | undefined {
  const skill = skillOf(kind);
  const t = skill ? effectiveT(w, a, skill) : undefined;
  if (!skill || t === undefined) return undefined;
  const league = w.company.league;
  const perk = league?.perks.some((p) => p.agentId === a.id && p.season === league.season) ?? false;
  return craftOf(skill, t, a.tier, perk);
}

const EYE = 1;
const SHARP = 2;

/**
 * The stream of one reading: nothing here touches the company's rng, so a talent moves no other draw. `purpose` names the
 * decision: an agent runs one handler a tick, so (day, tick, agent) already is the task. A handler that reads twice in
 * one task folds an index into its purpose (`hook:0`), never a generated id.
 */
export function talentRng(ctx: RuntimeCtx, a: Pick<AgentState, 'id'>, use: number, purpose: string): Rng {
  const w = ctx.world;
  return streamRng(w.scenario.seed, STREAM.talent, w.day, w.tick, hashString(a.id), use, hashString(purpose));
}

/** Claude writes 1 draft, 2 from `highFrom` (§4.9): a draft there costs real money, and most of what a heuristic draw varies it does not. */
function draftsFor(ctx: RuntimeCtx, c: Craft): number {
  return ctx.engine.mode !== 'claude' ? c.draws : c.t >= TALENT.claude.highFrom ? TALENT.claude.highDraws : 1;
}

/**
 * Drafts `craft.draws` versions and keeps the one this agent believes is best (§4.1). A weak agent writes one draft or
 * misjudges two, a strong one screens its own flaws out. Draft 0 is the text of a single draft, `score` the company's scorer.
 */
export async function bestDraft<T>(ctx: RuntimeCtx, a: AgentState, mind: MindContext, purpose: string, write: (m: MindContext) => Promise<T>, score: (d: T) => number): Promise<{ draft: T; drawn: number; realScore: number }> {
  const c = mind.craft;
  const n = c ? draftsFor(ctx, c) : 1;
  if (!c || n <= 1) {
    const draft = await write(mind);
    return { draft, drawn: 1, realScore: score(draft) };
  }
  const rng = talentRng(ctx, a, EYE, purpose);
  let best!: T;
  let seen = -Infinity;
  let real = 0;
  for (let i = 0; i < n; i++) {
    const draft = await write(i ? { ...mind, draw: i } : mind);
    const s = score(draft);
    const perceived = s + rng.normal(0, c.eye);
    if (perceived > seen) {
      seen = perceived;
      best = draft;
      real = s;
    }
  }
  return { draft: best, drawn: n, realScore: real };
}

/** How sharply this agent reads a bandit (§4.8). It needs the same data as anyone: it knows nothing more. */
export function armSharp(ctx: RuntimeCtx, a: AgentState, mind: MindContext, purpose: string): { samples: number; rng: Rng } | undefined {
  const c = mind.craft;
  return c ? { samples: c.sharp, rng: talentRng(ctx, a, SHARP, purpose) } : undefined;
}

/**
 * The creatives this buyer drops, on its reading of a campaign's last 4 days (§4.5). Stop-loss is not touched, a dropped
 * creative stays approved, and the best one always stays: it is the yardstick.
 */
export function pruneRead(rows: DailyAdStats[], creativeIds: string[], t: number): string[] {
  const p = TALENT.prune;
  const lastDay = rows.reduce((max, r) => Math.max(max, r.day), -Infinity);
  const window = rows.filter((r) => r.day > lastDay - p.windowDays && creativeIds.includes(r.creativeId));
  const days = new Set(window.map((r) => r.day)).size;
  const minImp = p.minImp - p.minImpSlope * t;
  const ratio = p.ratio + p.ratioSlope * t;
  const zNeed = p.zNeed - p.zNeedSlope * t;

  const read = creativeIds.map((id) => {
    const own = window.filter((r) => r.creativeId === id);
    const imp = own.reduce((sum, r) => sum + r.impressions, 0);
    const clicks = own.reduce((sum, r) => sum + r.clicks, 0);
    return { id, imp, ctr: imp > 0 ? clicks / imp : 0 };
  }).filter((c) => c.imp >= minImp);
  const best = read.reduce<(typeof read)[number] | null>((top, c) => (!top || c.ctr > top.ctr ? c : top), null);
  if (!best) return [];

  const zAgainstBest = (c: (typeof read)[number]): number => {
    const noise = (p.dayNoise ** 2 / days) * (best.ctr ** 2 + c.ctr ** 2);
    const se2 = (best.ctr * (1 - best.ctr)) / best.imp + (c.ctr * (1 - c.ctr)) / c.imp + noise;
    return se2 > 0 ? (best.ctr - c.ctr) / Math.sqrt(se2) : 0;
  };
  return read.filter((c) => c !== best && c.ctr < best.ctr * ratio && zAgainstBest(c) >= zNeed).map((c) => c.id);
}

/** ROAS as a strong buyer reads it for scale and trim: one lucky day does not count. t = 0 is the raw number (§4.5). */
export function shrunkRoas(revenue: number, spend: number, t: number): number {
  const k = TALENT.shrink.k * t;
  return spend + k > 0 ? (revenue + k * TALENT.shrink.prior) / (spend + k) : 0;
}
