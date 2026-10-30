/**
 * Claude models and prices (USD per million tokens, first-party API) → cost in EUR per call.
 * Cache writes (5 min TTL) cost 1.25× input; cache reads are billed at the model's cache-read rate.
 */
import type { ModelTier } from '../../shared.js';

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

export const USD_TO_EUR = 0.92;

interface Price { input: number; output: number; cacheRead: number }

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

const TIER_PRICE: Record<ModelTier, Price> = {
  opus: PRICES['claude-opus-5-5']!,
  sonnet: PRICES['claude-sonnet-5-5']!,
  haiku: PRICES['claude-haiku-5-5']!,
};

export function priceFor(model: string, tier: ModelTier): Price {
  const id = model.replace(/^anthropic\./, '').replace(/@.*$/, '');
  return PRICES[id] ?? TIER_PRICE[tier];
}

export interface TokenUsage { input: number; output: number; cacheWrite: number; cacheRead: number }

export function costEur(model: string, tier: ModelTier, u: TokenUsage): number {
  const p = priceFor(model, tier);
  const usd = (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
  return usd * USD_TO_EUR;
}
