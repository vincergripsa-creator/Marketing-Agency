/** What a designer's talent buys (pdf §13). */
import type { DesignEffort } from '../shared.js';
import { clamp } from '../core/index.js';

/**
 * `finish` is what gets drawn, and what opens the real gap: search alone is worth under 3 points of `overall`.
 *
 *   0  below .2   column only, no rail, no drop cap, chapter visuals only
 *   1  up to .6   adds drop cap, rail notes, pull quotes, models, openers with « Dans ce chapitre »
 *   2  from .6    adds the second figures, the memo page, the « Si ça coince » annex
 *
 * `interior` read once on the three written guides of `visual.test.ts`: 0 ≈ 79, 1 ≈ 95, 2 ≈ 96, against the 55, 72, 88
 * pdf §12.2 aimed at; `cover` on 24 designs: 75, 77, 78. `covers` are the candidates seen, `layouts` stays a label
 * (`layoutOf`), `taste` the eye.
 */
export function effortFor(talent: number, attempt = 0): DesignEffort {
  const t = clamp(talent, 0, 1);
  return { covers: 1 + Math.round(7 * t) + 2 * attempt, layouts: 2 + Math.round(22 * t), taste: 0.4 + 0.6 * t, finish: t < 0.2 ? 0 : t < 0.6 ? 1 : 2 };
}
