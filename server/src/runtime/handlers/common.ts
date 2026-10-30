/** Handler contract + helpers shared by every department's handlers. */
import type { AgentState, Product, Task } from '../../shared.js';
import type { MindContext } from '../../contracts.js';
import type { RuntimeCtx } from '../ctx.js';
import { productOf } from '../ctx.js';
import { strArr } from '../util.js';
import { GENERIC_FALLBACK } from './phrases.js';
import { sim } from '../modules.js';

export interface HandlerOutcome {
  summary: string;                    // French one-liner (task log + feed)
  output?: Record<string, unknown>;
  skipReview?: boolean;               // nothing worth reviewing (e.g. nothing to do)
  fail?: string;                      // the task failed (reason)
  retryLater?: string;                // not possible yet: back to pending
  awaitFounder?: string;              // founderApproval: wait for the founder before acting
  dependsOn?: string[];               // extra dependencies to wait for (with retryLater)
}

export interface HandlerSpec {
  run(ctx: RuntimeCtx, task: Task, agent: AgentState, mind: MindContext): Promise<HandlerOutcome>;
  /** Runs once the task is done (after review): pipeline follow-ups, irreversible actions. */
  onDone?(ctx: RuntimeCtx, task: Task): Promise<void>;
}

export type HandlerMap = Partial<Record<Task['kind'], HandlerSpec>>;

/** Notes of the latest "changes" review — what the assignee must fix on this attempt. */
export function reworkNotes(task: Task): string[] {
  for (let i = task.reviews.length - 1; i >= 0; i--) {
    const r = task.reviews[i]!;
    if (r.verdict === 'changes') return r.notes;
  }
  return [];
}

/** Fixes requested by the Red Team (verdict fix) for a product. */
export function redTeamFixes(ctx: RuntimeCtx, productId: string): string[] {
  for (let i = ctx.world.company.tasks.length - 1; i >= 0; i--) {
    const t = ctx.world.company.tasks[i]!;
    if (t.kind === 'red_team' && t.status === 'done' && t.input.productId === productId && t.output?.finalVerdict === 'fix') {
      return strArr(t.output.fixes);
    }
  }
  return [];
}

/** MindContext enriched with temporary rules (review notes, Red Team fixes, customer feedback). */
export function mindWith(mind: MindContext, extra: readonly string[]): MindContext {
  if (!extra.length) return mind;
  return { ...mind, playbook: [...mind.playbook, ...extra] };
}

export function studioMind(ctx: RuntimeCtx, task: Task, mind: MindContext): MindContext {
  const extra: string[] = [];
  for (const n of reworkNotes(task).slice(0, 4)) extra.push(`Correction demandée en relecture : ${n}`);
  const pid = typeof task.input.productId === 'string' ? task.input.productId : '';
  for (const f of redTeamFixes(ctx, pid).slice(0, 3)) extra.push(`Correctif Red Team : ${f}`);
  for (const f of strArr(task.input.feedback).slice(0, 4)) extra.push(`Retour client à corriger : ${f}`);
  for (const f of strArr(task.input.fixes).slice(0, 3)) extra.push(`Correctif demandé : ${f}`);
  return mindWith(mind, extra);
}

export function requireProduct(ctx: RuntimeCtx, task: Task): Product | null {
  const p = productOf(ctx, task.input.productId);
  return p && p.status !== 'killed' ? p : null;
}

/** Generic phrases from the sim (fallback list if the sim exports an empty one). */
export function genericPhrases(): readonly string[] {
  const list = sim.GENERIC_PHRASES;
  return list && list.length ? list : GENERIC_FALLBACK;
}

export const NO_PRODUCT: HandlerOutcome = { summary: 'Produit introuvable ou arrêté : rien à faire.', skipReview: true, output: { skipped: true } };
