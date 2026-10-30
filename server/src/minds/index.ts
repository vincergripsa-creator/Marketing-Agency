/**
 * minds/ — the agents' ContentEngine.
 *   heuristic : offline, free, deterministic French generators fed by the market research.
 *   claude    : every call goes to Claude (model per agent tier) with the agent persona, playbook,
 *               brain notes and lessons; any error / invalid JSON / budget cap → heuristic for that call.
 */
import type { MindMode, ModelTier } from '../shared.js';
import type { ContentEngine, MindsModule, UsageEvent } from '../contracts.js';
import { ClaudeEngine, type ClaudeClientLike } from './claude/engine.js';
import { HeuristicEngine } from './heuristic/index.js';

export interface EngineOptions {
  mode: 'auto' | MindMode;
  apiKey?: string;
  maxComputeEur: number;
  models?: Partial<Record<ModelTier, string>>;
  seed: number;
  onUsage?: (u: UsageEvent) => void;
  /** Brand used in signatures / outreach (defaults to the brain "Identité" note, then "Pixel Agency"). */
  brand?: string;
  /** Internal / tests: inject a Messages client (no network). */
  client?: ClaudeClientLike;
  /** Internal: where one-off warnings go (default console.warn). */
  log?: (msg: string) => void;
}

let warnedNoKey = false;

export function createContentEngine(opts: EngineOptions): ContentEngine {
  const seed = Number.isFinite(opts?.seed) ? opts.seed : 1;
  const heuristic = new HeuristicEngine({ seed, brand: opts?.brand });
  const key = (opts?.apiKey ?? '').trim();
  const mode = opts?.mode ?? 'auto';
  const log = opts?.log ?? ((m: string) => console.warn(m));
  const wantsClaude = mode === 'claude' || (mode === 'auto' && key.length > 0);
  if (!wantsClaude) return heuristic;
  if (!key && !opts.client) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      log('[minds] Mode « claude » demandé sans clé ANTHROPIC_API_KEY : repli sur le cerveau heuristique.');
    }
    return heuristic;
  }
  return new ClaudeEngine({
    apiKey: key,
    client: opts.client,
    maxComputeEur: Number.isFinite(opts.maxComputeEur) ? Math.max(0, opts.maxComputeEur) : 0,
    models: opts.models ?? {},
    onUsage: opts.onUsage,
    heuristic,
    brand: opts.brand,
    log,
  });
}

export type { ClaudeClientLike };

// compile-time check: this module satisfies the MindsModule contract
const _contract: MindsModule = { createContentEngine };
void _contract;
