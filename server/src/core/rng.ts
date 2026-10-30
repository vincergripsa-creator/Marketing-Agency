import type { Rng } from '../contracts.js';

/** Deterministic PRNG (mulberry32). Same seed + same decisions = same simulation. */
export function createRng(seedOrState: number): Rng {
  let s = seedOrState >>> 0 || 0x9e3779b9;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (mean: number, sd: number): number => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    chance: (p) => next() < p,
    normal,
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 50) return Math.max(0, Math.round(normal(lambda, Math.sqrt(lambda))));
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k++; p *= next(); } while (p > l);
      return k - 1;
    },
    binomial: (n, p) => {
      if (n <= 0 || p <= 0) return 0;
      if (p >= 1) return n;
      if (n > 200) return Math.max(0, Math.min(n, Math.round(normal(n * p, Math.sqrt(n * p * (1 - p))))));
      let k = 0;
      for (let i = 0; i < n; i++) if (next() < p) k++;
      return k;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      }
      return arr;
    },
    state: () => s,
  };
}
