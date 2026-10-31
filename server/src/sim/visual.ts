/**
 * What the object itself does to the market (pdf §12.4): the page shows the book, a superb one carries a higher price, a
 * buyer judges what he received. Reads a public report on a public artefact, draws nothing, and no report is exactly
 * neutral. `ref` sits at a starting agency's level, so the mechanism does not shift the economy on day 1.
 * `thumbFactor` is cut (D30): no feed shows the cover yet.
 */
import { clamp } from '../core/index.js';
import type { NicheTruth, VisualReport } from '../shared.js';

export const VISUAL = {
  ref: 70, span: 30,
  cvr: { slope: 0.15, min: 0.85, max: 1.15 },
  wtp: { slope: 0.10, min: 0.92, max: 1.10 },
  rating: { slope: 0.30, max: 0.30 },
  refund: { slope: 0.02, max: 0.02 },
};

/** How far a score sits from the reference, in spans. */
const lift = (score: number): number => (score - VISUAL.ref) / VISUAL.span;

export function visualCvr(v?: VisualReport | null): number {
  if (!v) return 1;
  const { slope, min, max } = VISUAL.cvr;
  return clamp(1 + slope * lift(v.overall), min, max);
}

/** Scales `sweet` and `max`, the floor stays: the price bandit finds the room on its own. */
export function visualWtp<T extends NicheTruth['wtp']>(w: T, v?: VisualReport | null): T {
  if (!v) return w;
  const { slope, min, max } = VISUAL.wtp;
  const f = clamp(1 + slope * lift(v.overall), min, max);
  return { ...w, sweet: w.sweet * f, max: w.max * f };
}

/** Stars added to a review, on the pages the buyer really holds. */
export function visualRating(v?: VisualReport | null): number {
  if (!v) return 0;
  const { slope, max } = VISUAL.rating;
  return clamp(slope * lift(v.interior), -max, max);
}

/** Refund probability taken off: « ça fait bas de gamme » is a refund reason, and it reads on the same pages. */
export function visualRefund(v?: VisualReport | null): number {
  if (!v) return 0;
  const { slope, max } = VISUAL.refund;
  return clamp(slope * lift(v.interior), -max, max);
}
