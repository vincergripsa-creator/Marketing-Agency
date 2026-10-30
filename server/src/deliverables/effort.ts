/** What a designer's talent buys (pdf §13). */
import type { DesignEffort } from '../shared.js';
import { clamp } from '../core/index.js';

export function effortFor(talent: number, attempt = 0): DesignEffort {
  const t = clamp(talent, 0, 1);
  return { covers: 1 + Math.round(7 * t) + 2 * attempt, layouts: 2 + Math.round(22 * t), taste: 0.4 + 0.6 * t, finish: t < 0.2 ? 0 : t < 0.6 ? 1 : 2 };
}
