/** Thompson-sampling bandits with Beta posteriors, stored in world.company.bandits[dimension]. */
import type { Rng } from '../contracts.js';
import type { BanditArm, WorldState } from '../shared.js';
import { clamp } from '../core/index.js';
import { finite, round } from './text.js';

export const PRICE_ARMS = ['9', '14', '19', '24', '29', '39', '49'] as const;
export const HYPE_ARMS = ['0.2', '0.4', '0.6', '0.8'] as const;
export const SUPPORT_TONE_ARMS = ['chaleureux', 'concis', 'formel'] as const;

function banditsOf(world: WorldState): Record<string, BanditArm[]> {
  world.company.bandits ??= {};
  return world.company.bandits;
}

/** Returns the arm list of a dimension, creating missing arms lazily with a flat Beta(1, 1) prior. */
export function ensureArms(world: WorldState, dimension: string, keys: readonly string[]): BanditArm[] {
  const all = banditsOf(world);
  const arms = (all[dimension] ??= []);
  for (const key of keys) {
    if (key && !arms.some((a) => a.key === key)) arms.push({ key, alpha: 1, beta: 1, pulls: 0, reward: 0 });
  }
  return arms;
}

/** Gamma(shape, 1) — Marsaglia & Tsang (2000), with the shape < 1 boost. */
export function sampleGamma(shape: number, rng: Rng): number {
  const k = finite(shape, 1);
  if (k <= 0) return 0;
  if (k < 1) {
    const u = Math.max(rng.next(), 1e-12);
    return sampleGamma(k + 1, rng) * u ** (1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 200; i++) {
    const x = rng.normal(0, 1);
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = Math.max(rng.next(), 1e-12);
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // practically unreachable: the acceptance rate is > 95 %
}

/** Beta(a, b) = X / (X + Y) with X ~ Gamma(a), Y ~ Gamma(b). */
export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(Math.max(1e-3, finite(a, 1)), rng);
  const y = sampleGamma(Math.max(1e-3, finite(b, 1)), rng);
  const s = x + y;
  return s > 0 ? x / s : 0.5;
}

/**
 * Thompson sampling. `sharp` is talent reading the same posterior (talent §4.8): each arm's first sample comes from `rng`
 * exactly as without it, the others from `sharp.rng`, and their mean has the posterior's mean with a tighter spread. A weak
 * read explores by accident, a strong one exploits what the company learned. It knows nothing more.
 */
export function chooseArm(world: WorldState, dimension: string, arms: readonly string[], rng: Rng, sharp?: { samples: number; rng: Rng }): string {
  let keys = [...new Set((arms ?? []).map((a) => String(a)).filter(Boolean))];
  if (keys.length === 0) keys = (banditsOf(world)[dimension] ?? []).map((a) => a.key);
  if (keys.length === 0) return '';
  if (keys.length === 1) {
    ensureArms(world, dimension, keys);
    return keys[0]!;
  }
  const stored = ensureArms(world, dimension, keys);
  if (world.scenario?.control?.noLearning) return rng.pick(keys);
  let best = keys[0]!;
  let bestDraw = -1;
  const extra = Math.max(0, (sharp?.samples ?? 1) - 1);
  for (const key of keys) {
    const arm = stored.find((a) => a.key === key)!;
    let draw = sampleBeta(arm.alpha, arm.beta, rng);
    if (extra > 0) {
      for (let i = 0; i < extra; i++) draw += sampleBeta(arm.alpha, arm.beta, sharp!.rng);
      draw /= extra + 1;
    }
    if (draw > bestDraw) {
      bestDraw = draw;
      best = key;
    }
  }
  return best;
}

export function rewardArm(world: WorldState, dimension: string, arm: string, reward: number, weight = 1): void {
  const key = String(arm ?? '');
  if (!key) return;
  const r = clamp(finite(reward, 0));
  const w = Math.max(0, finite(weight, 1));
  const a = ensureArms(world, dimension, [key]).find((x) => x.key === key)!;
  a.alpha = round(a.alpha + r * w, 4);
  a.beta = round(a.beta + (1 - r) * w, 4);
  a.pulls += 1;
  a.reward = round(a.reward + r, 4); // unweighted sum → reward / pulls = mean observed reward
}

/** Posterior means, best first. */
export function armStats(world: WorldState, dimension: string): { key: string; mean: number; pulls: number }[] {
  return (banditsOf(world)[dimension] ?? [])
    .map((a) => ({ key: a.key, mean: round(a.alpha / Math.max(1e-9, a.alpha + a.beta), 4), pulls: a.pulls }))
    .sort((x, y) => y.mean - x.mean || y.pulls - x.pulls);
}

/** Empirical mean reward per pull (not the posterior), used for evidence in lessons. */
export function empiricalMean(arm: BanditArm): number {
  return arm.pulls > 0 ? arm.reward / arm.pulls : 0;
}

/** Nearest numeric arm ("19" for a 21 € price). Non-numeric value → exact match or null. */
export function nearestArm(value: number | string | null | undefined, arms: readonly string[]): string | null {
  if (value === null || value === undefined || arms.length === 0) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return arms.includes(String(value)) ? String(value) : null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const a of arms) {
    const n = Number(a);
    if (!Number.isFinite(n)) continue;
    const d = Math.abs(n - v);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}
